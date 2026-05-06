# Luồng Xử Lý PDF Có Text + Image + Bảng trong NexusRAG

## 📋 Tóm Tắt Tổng Quan

Khi người dùng upload 1 file PDF chứa **text, image, bảng**, hệ thống thực hiện:

1. **Upload API** → nhận file + metadata → lưu DB + trigger background job
2. **Background Processing** → Docling parse → extract text/images/tables → chunking → embedding + KG ingest
3. **Lưu trữ** → PostgreSQL (metadata) + ChromaDB (embeddings) + LightRAG (KG) + File system (images)
4. **Khi user query** → retrieve from ChromaDB + KG → rerank → LLM synthesis + citations

---

## 🔄 CHI TIẾT LUỒNG XỬ LÝ

### Phase 0: Upload & Queue

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User Uploads PDF (annual_report_2024.pdf)                   │
│    + custom_metadata: [{"key": "year", "value": "2024"}]       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ API: POST /documents/upload/{workspace_id}                      │
│ - Xác thực file type (.pdf ✓)                                  │
│ - Xác thực kích thước (≤ 50MB)                                  │
│ - Lưu file tạm: uploads/{uuid}.pdf                             │
│ - Tạo Document record:                                         │
│   - id, workspace_id, filename, original_filename              │
│   - file_size, file_type, custom_metadata                      │
│   - status: PENDING (chưa xử lý)                               │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Trigger Background Job (BackgroundTasks)                     │
│    - process_document_background(document_id, file_path)        │
│    - Async in thread executor (không block HTTP response)       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
           HTTP 200 Return to User
        (document_id, status: PENDING)
        User can poll /documents/{id} to check status
```

**Code Location**: `backend/app/api/documents.py` - `upload_document()` + `process_document_background()`

---

### Phase 1: PARSING (Docling)

```
┌──────────────────────────────────────────────────────────────────┐
│ Phase 1: PARSING — Docling Document Converter                   │
│ (Status: PENDING → PARSING)                                     │
└────────────────────┬─────────────────────────────────────────────┘
                     │
         ┌───────────┴──────────────┬────────────────┐
         │                          │                │
         ▼                          ▼                ▼
    ┌─────────────┐           ┌──────────────┐  ┌─────────────┐
    │TEXT EXTRACT │           │IMAGE EXTRACT │  │TABLE EXTRACT│
    └──────┬──────┘           └───────┬──────┘  └──────┬──────┘
           │                          │               │
           │ Raw text                 │ PIL Images    │ Markdown
           │ + structure              │ + metadata    │ tables
           │ + metadata               │               │
           │                          ▼               ▼
           │              ┌──────────────────┐  ┌──────────────┐
           │              │ Vision LLM       │  │ Table Caption│
           │              │ Caption Images   │  │ (LLM summary)│
           │              │ (Gemini/Ollama)  │  │              │
           │              │ Output: captions │  │ Output:      │
           │              │ e.g., "Chart     │  │ "Revenue by  │
           │              │ showing revenue" │  │ region Q1-Q4"│
           │              └────────┬─────────┘  └───────┬──────┘
           │                       │                   │
           │◄──────────────────────┴───────────────────┘
           │
           ▼
    ┌─────────────────────────────────────────────────┐
    │ AUGMENT: Gắn Caption vào Chunk                  │
    │                                                  │
    │ Ví dụ chunk text:                               │
    │  "Q1 revenue reached $100M..."                  │
    │                                                  │
    │ Sau augment:                                    │
    │  "[Image: Chart showing revenue]\n             │
    │   Q1 revenue reached $100M...\n                │
    │   [Table: Revenue by region Q1-Q4]\n           │
    │   Region    Q1   Q2   Q3   Q4\n                │
    │   APAC    $50M  $60M  $70M  $80M"             │
    └────────────────────┬────────────────────────────┘
                         │
                         ▼
    ┌──────────────────────────────────────────────┐
    │ Export to Markdown                           │
    │ - Full document text                         │
    │ - Image references: ![caption](url)          │
    │ - Table markdown syntax                      │
    │ - Heading hierarchy preserved                │
    └────────────────────┬─────────────────────────┘
                         │
                         ▼
    ┌──────────────────────────────────────────────┐
    │ HybridChunker (Semantic + Structural)        │
    │ - Max tokens per chunk: 512 (configurable)   │
    │ - Chia theo:                                 │
    │   • Page boundaries                          │
    │   • Heading levels                           │
    │   • Paragraph/table/code blocks              │
    │ - Preserve heading path for context          │
    └────────────────────┬─────────────────────────┘
```

**Output**:

- `markdown`: Full document text + images + tables
- `chunks`: List[EnrichedChunk] với:
  - `content`: augmented text (text + image captions + table summaries)
  - `page_no`: page number
  - `heading_path`: ["Annual Report", "Financial Results", "Revenue"]
  - `has_table`: True/False
  - `has_code`: True/False
  - `image_refs`: ["img_001", "img_002"] (image IDs)
  - `table_refs`: ["tbl_001"] (table IDs)
  - `source_file`: "annual_report_2024.pdf"

**Code Location**: `backend/app/services/document_parser/docling_parser.py`

- `_parse_with_docling()` - chính parser
- `_extract_images_with_urls()` - extract images
- `_extract_tables()` - extract tables
- `_caption_tables()` - caption tables via LLM
- `_chunk_document()` - HybridChunker

---

### Phase 1.5: DEDUPLICATION

```
┌──────────────────────────────────────────────────────┐
│ Chunk Deduplication                                  │
│ - Exact duplicates: remove nếu text identical       │
│ - Near-duplicates: remove nếu similarity > threshold│
│ - Noise removal: remove chunks quá ngắn/quá ngây   │
│                                                      │
│ Input:  100 chunks → Output: 85 chunks (15 removed) │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
         Các chunk unique được forward
         tới Phase 2 (Indexing)
```

**Code Location**: `backend/app/services/chunk_dedup.py`

---

### Phase 2: INDEXING

```
┌──────────────────────────────────────────────────────────────────┐
│ Phase 2: INDEXING — Embed + Store                               │
│ (Status: PARSING → INDEXING)                                    │
└────────────────────┬─────────────────────────────────────────────┘
                     │
        ┌────────────┴──────────────┐
        │                           │
        ▼                           ▼
   ┌─────────────────────────┐  ┌─────────────────────────┐
   │ A. VECTOR INDEXING      │  │ B. KNOWLEDGE GRAPH INGEST│
   │ (ChromaDB + Vector DB)  │  │ (LightRAG)              │
   └──────────┬──────────────┘  └────────┬────────────────┘
              │                          │
              ▼                          ▼
   ┌─────────────────────────────────────────────────────┐
   │ Embedding Service (BAAI/bge-m3)                     │
   │                                                      │
   │ Input: chunks augmented text                        │
   │ "Q1 revenue reached $100M...                        │
   │  [Image: Chart...]                                  │
   │  [Table: Revenue...]"                              │
   │                                                      │
   │ Output: 1024-dim embedding (normalized)             │
   │ Processing: batch_size=32, local GPU/CPU            │
   │                                                      │
   │ Chunk 1 → [0.23, -0.15, 0.89, ..., 0.05] (1024d)   │
   │ Chunk 2 → [0.12, 0.45, -0.23, ..., 0.88] (1024d)   │
   │ ...                                                  │
   └──────────────┬────────────────────────────────────┘
                  │
                  ▼
   ┌───────────────────────────────────────┐
   │ ChromaDB: Add Documents               │
   │                                        │
   │ Per chunk:                             │
   │ - id: "doc_{doc_id}_chunk_{i}"       │
   │ - embedding: 1024-dim vector          │
   │ - document: chunk text                │
   │ - metadata:                           │
   │   {                                    │
   │     "document_id": 42,                │
   │     "chunk_index": 0,                 │
   │     "source": "annual_report_2024.pdf"│
   │     "page_no": 5,                     │
   │     "heading_path": "Financial > Revenue",        │
   │     "has_table": true,                │
   │     "has_code": false,                │
   │     "image_ids": "img_001|img_002",  │
   │     "table_ids": "tbl_001",           │
   │     "image_urls": "/static/doc-images/kb_1/images/img_001.png|...",│
   │     "year": "2024",  # custom metadata│
   │     "category": "financial"           │
   │   }                                    │
   │                                        │
   │ Collection: kb_{workspace_id}         │
   │ → Can query via cosine similarity     │
   │   + metadata filtering                │
   └───────────────────────────────────────┘

              PARALLEL
                 │
                 ▼
   ┌──────────────────────────────────────────┐
   │ KG Ingest (LightRAG)                    │
   │                                           │
   │ Input: Full markdown (text + images     │
   │        + tables captions)               │
   │                                           │
   │ Process:                                 │
   │ 1. LLM extracts entities:               │
   │    - PERSON: ["John CEO", ...]         │
   │    - ORG: ["Apple Inc", ...]           │
   │    - PRODUCT: ["iPhone 15", ...]       │
   │    - LOCATION: ["California", ...]     │
   │    - FINANCIAL_METRIC: ["$100M", ...] │
   │                                           │
   │ 2. LLM extracts relations:              │
   │    - ("CEO", "works_at", "Apple Inc") │
   │    - ("iPhone 15", "released_in", "California") │
   │    - ("Revenue", "increased_by", "15%") │
   │                                           │
   │ 3. Build graph:                        │
   │    - Nodes: entities + properties      │
   │    - Edges: relationships + strength   │
   │    - Back-references: entity → chunk_id│
   │                                           │
   │ 4. Embed entities: 3072-dim (Gemini)  │
   │    or 1024-dim (sentence-transformers)│
   │                                           │
   │ 5. Store: NetworkX graph + NanoVectorDB│
   │    Location: data/lightrag/kb_{workspace_id}/│
   └───────────────────────────────────────┘
```

**Code Location**:

- Vector indexing: `backend/app/services/nexus_rag_service.py` - `_index_sync()`
- KG ingest: `backend/app/services/knowledge_graph_service.py` - `ingest()`

---

### Phase 3: INDEXED (Complete)

```
┌───────────────────────────────────────────────────────┐
│ Phase 3: INDEXED — Update Status                      │
│ (Status: INDEXING → INDEXED)                          │
└────────────────────┬──────────────────────────────────┘
                     │
                     ▼
         Update Document in PostgreSQL:
         - status = INDEXED
         - chunk_count = 85
         - page_count = 50
         - image_count = 3
         - table_count = 2
         - processing_time_ms = 15234
         - markdown_content = full text
         - parser_version = "docling"

         ✓ Ready for querying!
```

---

## 🔍 LƯU TRỮ DỮ LIỆU LIÊN KẾT

### PostgreSQL (Metadata)

```sql
Documents table:
├── id: 42
├── workspace_id: 1
├── filename: "abc123def456.pdf"
├── original_filename: "annual_report_2024.pdf"
├── status: "INDEXED"
├── chunk_count: 85
├── image_count: 3
├── table_count: 2
├── page_count: 50
├── markdown_content: "# Annual Report 2024\n..."
├── custom_metadata: {"year": "2024", "category": "financial"}
├── created_at: 2024-12-01 10:00:00

DocumentImages table:
├── id: 1001
├── document_id: 42
├── image_id: "img_001"
├── page_no: 5
├── file_path: "data/docling/kb_1/images/img_001.png"
├── caption: "Chart showing Q1-Q4 revenue trend, +15% YoY"
├── width: 800
├── height: 600

DocumentTables table:
├── id: 2001
├── document_id: 42
├── table_id: "tbl_001"
├── page_no: 10
├── content_markdown: "| Region | Q1 | Q2 | ... |"
├── caption: "Revenue by region Q1-Q4"
├── num_rows: 5
├── num_cols: 5
```

### ChromaDB (Vector Store)

```python
Collection: kb_1

Documents:
├── id: "doc_42_chunk_0"
│  ├── embedding: [0.23, -0.15, 0.89, ..., 0.05]  (1024-dim)
│  ├── document: "Q1 revenue reached $100M [Image: Chart] [Table: Revenue...]"
│  ├── metadata: {
│  │    "document_id": 42,
│  │    "chunk_index": 0,
│  │    "page_no": 5,
│  │    "heading_path": "Financial Results > Revenue",
│  │    "has_table": true,
│  │    "image_ids": "img_001",
│  │    "table_ids": "tbl_001",
│  │    "year": "2024",  # custom metadata
│  │  }
│
├── id: "doc_42_chunk_1"
│  ├── embedding: [0.12, 0.45, -0.23, ..., 0.88]
│  ├── document: "Operating expenses increased..."
│  ├── metadata: { ... }

Supports:
- Cosine similarity search
- Metadata filtering: year="2024", has_table=true, page_no≥5
- Hybrid: vector + metadata_filter
```

### LightRAG (Knowledge Graph)

```
File-based storage:
data/lightrag/kb_1/
├── graph.pickle  (NetworkX DiGraph)
├── entities_db.pkl  (entity→node mapping)
└── vector_db/  (NanoVectorDB for embeddings)

Graph Structure:
Nodes:
├── "Apple Inc" (type: ORG, embedding: 3072-dim)
│  └── properties: {"revenue": "$365B", "founded": "1976"}
│  └── source_chunks: [doc_42_chunk_5, doc_42_chunk_12]
│
├── "$100M" (type: FINANCIAL_METRIC)
│  └── source_chunks: [doc_42_chunk_0]

Edges:
├── ("CEO", "works_at", "Apple Inc")
│  └── strength: 0.95
│  └── source_chunks: [doc_42_chunk_8]
│
├── ("Revenue", "increased_to", "$100M")
│  └── strength: 0.88
```

### File System (Images)

```
Directory structure:
backend/data/docling/kb_1/images/
├── img_001.png  (Chart)
├── img_002.png  (Table graphic)
└── img_003.jpeg (Photo)

Accessible via HTTP:
GET /static/doc-images/kb_1/images/img_001.png
```

---

## 🎯 KHI USER HỎI QUESTION

```
User: "Q1 revenue tăng bao nhiêu?"

                     │
                     ▼
        ┌─────────────────────────────┐
        │ 1. Self-RAG Query Analysis  │
        │ (Tool search if needed)     │
        └────────────┬────────────────┘
                     │
        ┌────────────┴──────────────┐
        │                           │
        ▼                           ▼
   ┌─────────────┐           ┌──────────────┐
   │ Vector Search           │ KG Query     │
   │ (ChromaDB)              │ (LightRAG)   │
   │                         │              │
   │ Query: "Q1 revenue"     │ Find entities│
   │ Embed: 1024-dim         │ "Revenue",   │
   │ Cosine similarity       │ "Q1", "$"    │
   │ Top-20 candidates       │ Multi-hop    │
   │ (may include related    │ reasoning    │
   │  chunks from other      │ Connected    │
   │  tables/pages)          │ chunks       │
   │                         │              │
   │ Output: chunks          │ Output:      │
   │ [chunk_0, chunk_1, ...] │ [chunk_5,...]
   └────────────┬────────────┘              │
                │◄─────────────────────────┘
                │
                ▼
        Merge Candidates
        (Dedup by chunk_id)

                │
                ▼
        Cross-Encoder Reranker
        (BAAI/bge-reranker-v2-m3)

        Score (query, chunk) jointly:
        - chunk_0: 0.92 ✓ KEEP
        - chunk_1: 0.87 ✓ KEEP
        - chunk_2: 0.45 ✗ DROP
        ...

        Top-K=8: keep highest scored

                │
                ▼
        Filter by relevance threshold (≥0.15)
        + Fallback to top-3 if all low

                │
                ▼
        ┌─────────────────────────────────┐
        │ Retrieved Context               │
        │ (Max 8 chunks merged):          │
        │                                  │
        │ [chunk_0] (page 5):             │
        │ "Q1 revenue reached $100M,      │
        │  up 15% from Q4..."             │
        │ Source: annual_report_2024.pdf  │
        │ [Relevance: 0.92]               │
        │                                  │
        │ [chunk_5] (page 12):            │
        │ "Detailed breakdown:            │
        │  APAC: $50M (↑20%)              │
        │  EMEA: $30M (↑10%)              │
        │  ..."                           │
        │ [Relevance: 0.87]               │
        │                                  │
        │ [IMG-chunk_0]: Chart...         │
        │ [TBL-chunk_5]: Revenue table... │
        └──────────────┬────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │ 2. Prompt Assembly               │
        │                                   │
        │ System: "You are an analyst..."  │
        │                                   │
        │ History: [prev messages...]      │
        │                                   │
        │ Context:                         │
        │ "[a3z1] Q1 revenue reached       │
        │  $100M, up 15% from Q4..."       │
        │  (page 5, annual_report...)     │
        │                                   │
        │ "[b7w2] Breakdown by region:    │
        │  APAC $50M (↑20%), ..."         │
        │  (page 12, annual_report...)    │
        │                                   │
        │ User Question: "Q1 revenue      │
        │ tăng bao nhiêu?"                │
        │                                   │
        │ LLM directive:                   │
        │ "Respond only using provided    │
        │  citations. Max 3 cites/sentence.│
        │  If unsupported, say             │
        │  'Tôi không có thông tin'."      │
        └────────────┬─────────────────────┘
                     │
                     ▼
        ┌──────────────────────────────┐
        │ 3. LLM Generation (Streaming) │
        │ Provider: Gemini/Ollama       │
        │ Model: gemini-2.5-flash       │
        │ Temperature: 0.3 (factual)    │
        │ Max tokens: 1024              │
        │                               │
        │ Extended Thinking:            │
        │ (nếu LLM_THINKING_LEVEL set) │
        │ - Level: "medium"             │
        │ - Thinking budget: auto       │
        │ - Output: chain-of-thought    │
        │ (hiện ở thinking panel)       │
        └────────────┬──────────────────┘
                     │
                     ▼
        (Streaming via SSE)

        "Q1 revenue tăng 15% từ Q4 [a3z1]
         và tăng 20% YoY so với Q1 năm
         trước [a3z1]. Cụ thể:
         - APAC: $50M (↑20%) [b7w2]
         - EMEA: $30M (↑10%) [b7w2]"

                     │
                     ▼
        ┌──────────────────────────────┐
        │ 4. Post-generation           │
        │ - Attach source cards        │
        │ - Build citation links       │
        │ - Save to chat history       │
        │ - Optional: call image/      │
        │   table retrieval for        │
        │   visual context             │
        └──────────────────────────────┘
                     │
                     ▼
        Frontend receives:
        {
          "message": "Q1 revenue tăng 15%...",
          "citations": [
            {
              "id": "a3z1",
              "source": "annual_report_2024.pdf",
              "page": 5,
              "heading": "Financial Results",
              "relevance": 0.92,
              "snippet": "Q1 revenue reached $100M..."
            },
            ...
          ],
          "images": [
            {"id": "img_001", "caption": "Chart..."}
          ],
          "tables": [
            {"id": "tbl_001", "markdown": "..."}
          ]
        }

        Display:
        ✓ Answer with inline citation badges [a3z1]
        ✓ Hover badges → show source card
        ✓ Click → jump to section in document viewer
        ✓ Show chart + table below
```

---

## 💡 LÝ DO HỆ THỐNG KHÔNG "LOẠN" KHI UPLOAD 2 FILE

### 1. **Workspace Isolation**

- Mỗi workspace (knowledge base) → riêng ChromaDB collection
- Query chỉ search trong workspace hiện hành
- User không thể mix data từ workspace khác

### 2. **Per-Document Provenance**

```
Mỗi chunk lưu:
- document_id: biết chunk từ file nào
- filename: tên file gốc
- file_type: loại file

Khi retrieve:
- Source card hiển thị: "annual_report_2024.pdf"
- User nhìn thấy nguồn → không nhầm lẫn
```

### 3. **Metadata Filtering Pre-query**

```
User có thể:
- Scope selector: "All files" / "annual_report_2024.pdf" / "budget_2024.docx"
- Tag filter: "year=2024", "category=financial"

System:
- ChromaDB hỗ trợ metadata filtering
- Query: embeddings + metadata_filter
- Tối ưu: reduce search space → fewer false positives
```

### 4. **Chunk Deduplication**

```
Nếu 2 file có duplicate content:
- dedup service loại bỏ exact duplicates
- Giữ canonical chunk với source_files list

Example:
- annual_report_2024.pdf: "Revenue $100M"
- summary_2024.docx: "Revenue $100M" (copy-paste)

Dedup:
- 1 chunk canonical với source_files=["annual_report_2024.pdf", "summary_2024.docx"]
- Source card: hiển thị cả 2 files
```

### 5. **Diversity in Reranking**

```
Reranker có thể penalize chunks từ cùng file:
- Nếu top-3 từ file A, reduce score cho file A
- Tăng diversity: mix sources

Tùy cấu hình: có thể bật/tắt
```

### 6. **Explicit Clarification (Agentic)**

```
Nếu query ambiguous + top sources contradict:

LLM: "Tôi tìm thấy 2 thông tin khác nhau:
  - annual_report: Revenue $100M
  - budget_plan: Revenue $110M

  Bạn muốn so sánh, hay chỉ từ file nào?"

User clarifies → agent re-query
```

### 7. **Citation Limits**

```
Policy: Max 3 cites per sentence
- Giảm overwhelming citations
- Force LLM focus on most relevant sources
```

---

## 🛠️ CÔNG NGHỆ VÀ TRÁCH NHIỆM

| Thành Phần           | Công Nghệ                         | Trách Nhiệm                               |
| -------------------- | --------------------------------- | ----------------------------------------- |
| **API Layer**        | FastAPI                           | Nhận upload, trigger job, respond quickly |
| **Document Parsing** | Docling                           | Extract text, images, tables, structure   |
| **Image Captioning** | Gemini Vision / Ollama Multimodal | Generate captions cho images              |
| **Table Captioning** | Gemini / Ollama                   | Generate summaries cho tables             |
| **Chunking**         | Docling HybridChunker             | Chia semantic + structural                |
| **Deduplication**    | Custom hash + similarity          | Loại duplicates                           |
| **Embeddings**       | BAAI/bge-m3 (1024-d)              | Vector embeddings cho retrieval           |
| **Vector Store**     | ChromaDB                          | Store + similarity search                 |
| **Reranking**        | BAAI/bge-reranker-v2-m3           | Cross-encoder ranking                     |
| **Knowledge Graph**  | LightRAG + LLM                    | Entity extraction + relation building     |
| **LLM Synthesis**    | Gemini / Ollama                   | Generate answer + citations               |
| **Metadata Storage** | PostgreSQL + SQLAlchemy           | Document metadata, images, tables, chat   |
| **File Storage**     | File system                       | Images, tables, markdown                  |

---

## 📊 MEMORY & PERFORMANCE

### Overhead khi xử lý PDF lớn

```
PDF: 50 pages, 100 images, 20 bảng

Parsing: ~5-10 seconds (Docling)
  → Extract text, images, tables

Image Captioning: ~2-3 seconds per image (Gemini)
  → 100 images × 2s = 200s parallel

Chunking: ~1 second

Dedup: ~0.5 second

Embedding: ~5 seconds (batch_size=32)
  → 85 chunks / 32 = 3 batches

KG Ingest: ~10-15 seconds
  → LLM entity extraction

Total: ~30-50 seconds (depending on LLM latency + parallelism)

Storage:
  - PostgreSQL: ~500KB (metadata)
  - ChromaDB: ~85 × 1024 float32 = ~346KB (embeddings)
  - Images: ~100 × 500KB avg = ~50MB
  - Markdown: ~1-2MB
  - LightRAG: ~2-5MB (graph + vectors)

  Total: ~60MB per document
```

---

## ✅ QUY TRÌNH ĐẢM BẢO CHẤT LƯỢNG

1. ✓ **Parsing Quality**: Docling xử lý cấu trúc tốt → preserve formatting, headings
2. ✓ **Image Captioning**: Vision LLM → specific, not generic descriptions
3. ✓ **Table Understanding**: Table captions + markdown → searchable
4. ✓ **Chunk Quality**: HybridChunker → semantic boundaries, not random splits
5. ✓ **Dedup**: Remove noise → focused search
6. ✓ **Reranking**: Cross-encoder → accurate relevance (not just cosine)
7. ✓ **Citation Grounding**: LLM directed to cite sources → reduce hallucination
8. ✓ **Provenance**: Full traceability: chunk → document → page → heading

---

## 🔧 CÁCH CUSTOMIZE

### `.env` Configuration

```bash
# Parser
NEXUSRAG_DOCUMENT_PARSER=docling  # or "marker"
NEXUSRAG_ENABLE_IMAGE_EXTRACTION=true
NEXUSRAG_ENABLE_IMAGE_CAPTIONING=true
NEXUSRAG_ENABLE_TABLE_CAPTIONING=true

# Chunking
NEXUSRAG_CHUNK_MAX_TOKENS=512
NEXUSRAG_CHUNK_OVERLAP=50

# Embedding
NEXUSRAG_EMBEDDING_MODEL=BAAI/bge-m3
NEXUSRAG_RERANKER_MODEL=BAAI/bge-reranker-v2-m3

# Retrieval
NEXUSRAG_VECTOR_PREFETCH=20  # over-fetch
NEXUSRAG_RERANKER_TOP_K=8    # final results

# Knowledge Graph
NEXUSRAG_ENABLE_KG=true
NEXUSRAG_KG_LANGUAGE=Vietnamese
KG_EMBEDDING_PROVIDER=gemini  # or "sentence_transformers"

# LLM
LLM_PROVIDER=gemini
LLM_MODEL_FAST=gemini-2.5-flash
LLM_THINKING_LEVEL=medium
```

---

**End of Document**
