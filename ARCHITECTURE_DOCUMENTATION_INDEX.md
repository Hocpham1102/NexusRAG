# 📚 NexusRAG Architecture & Processing Flow — Documentation Index

**Tôi muốn hiểu...?**

---

## 🎯 Quick Links by Question

### 1️⃣ "Tôi muốn hiểu chi tiết luồng xử lý PDF có text + image + bảng"

📄 **Start here**: [PDF_PROCESSING_FLOW.md](./PDF_PROCESSING_FLOW.md)

**Bao gồm:**

- Upload → Background Queue → Docling Parsing
- Image Extraction & Captioning
- Table Extraction & Captioning
- Chunking + Deduplication
- Embedding (ChromaDB) + KG Ingest (LightRAG)
- Query Flow: Retrieval → Reranking → LLM Synthesis → Citations
- 3 Lớp Lưu Trữ: PostgreSQL + ChromaDB + LightRAG + FileSystem
- Minh Họa Kịch Bản 2 File

---

### 2️⃣ "Tôi muốn xem sơ đồ flowchart + mô tả chi tiết + FAQ + tuning"

🔄 **Start here**: [DETAILED_PIPELINE_DIAGRAM.md](./DETAILED_PIPELINE_DIAGRAM.md)

**Bao gồm:**

- Mermaid Flowchart đầy đủ (Upload → Parse → Embed → Query)
- Chi Tiết Từng Phase (PARSING, DEDUP, INDEXING, INDEXED)
- Cấu hình `.env` (Parser, Retrieval, KG, LLM)
- FAQ: Xử lý 2 files, Performance, Hallucination
- Tuning Recommendations (Speed vs Quality)
- Luồng Multi-File (Isolation + Dedup)

---

### 3️⃣ "Tôi muốn so sánh NexusRAG vs RAG thông thường chi tiết"

📊 **Start here**: [NEXUSRAG_VS_STANDARD_RAG.md](./NEXUSRAG_VS_STANDARD_RAG.md)

**Bao gồm:**

- Bảng so sánh (Parsing, Image, Table, Embedding, Retrieval, Citation...)
- Luồng Side-by-Side (Standard RAG vs NexusRAG)
- Ưu Điểm Của NexusRAG (Provenance, Reranking, KG, Metadata Filtering)
- Cross-Encoder vs Cosine Similarity (Why Better?)
- Self-RAG, Extended Thinking, Force-Search
- Safety & Hallucination Reduction
- When to Use Which (Standard vs NexusRAG)

---

### 4️⃣ "Tôi muốn hiểu cách xử lý 2 file cùng lúc + tránh loạn dữ liệu"

🛡️ **Start here**: [MULTI_FILE_HANDLING.md](./MULTI_FILE_HANDLING.md)

**Bao gồm:**

- 3 Lớp Isolation (Workspace, Document-level, Scope Filtering)
- Metadata per Chunk (Document_id, Filename, Page, Heading, Custom Tags)
- Query-Time Filtering (All vs File A only vs Tags)
- Frontend UI Scope Selector
- Conflict Detection & Resolution
- Deduplication (Exact + Near-Duplicate)
- Practical Example: Multi-File Query Flow (Chi Tiết Step-by-Step)
- Best Practices (DO / DON'T)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     NexusRAG Pipeline                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  UPLOAD PHASE (API)                                         │
│  ├─ PDF/DOCX/PPTX/HTML/Image File                          │
│  └─ Custom Metadata Tags                                    │
│                                                             │
│  PARSING PHASE (Docling)                                    │
│  ├─ Extract Text (with structure)                           │
│  ├─ Extract Images (PIL format)                             │
│  ├─ Caption Images (Vision LLM)                             │
│  ├─ Extract Tables (Markdown)                               │
│  └─ Caption Tables (LLM summary)                            │
│                                                             │
│  CHUNKING PHASE (HybridChunker)                             │
│  ├─ Semantic + Structural boundaries                        │
│  ├─ Augment with image/table captions                       │
│  └─ Preserve heading paths                                  │
│                                                             │
│  DEDUP PHASE                                                │
│  ├─ Exact match removal                                     │
│  ├─ Near-duplicate removal                                  │
│  └─ Noise filtering                                         │
│                                                             │
│  INDEXING PHASE (Parallel)                                  │
│  ├─ A. VECTOR: Embed (bge-m3, 1024-d)                       │
│  │   └─ ChromaDB: vectors + metadata                        │
│  │                                                          │
│  └─ B. KG: Entity & Relation Extraction (LLM)               │
│      └─ LightRAG: graph + entity embeddings                │
│                                                             │
│  STORAGE (Distributed)                                      │
│  ├─ PostgreSQL: Document metadata, images, tables, chat    │
│  ├─ ChromaDB: Embeddings (1024-d) + metadata               │
│  ├─ FileSystem: Images (PNG), Markdown                      │
│  └─ LightRAG: KG graph (NetworkX) + entity vectors         │
│                                                             │
│  QUERY PHASE (Retrieval Pipeline)                           │
│  ├─ Vector Search (top-20 candidates)                       │
│  ├─ KG Multi-Hop Query                                      │
│  ├─ Merge & Deduplicate                                     │
│  ├─ Cross-Encoder Rerank (top-8)                            │
│  ├─ Filtering (threshold ≥ 0.15)                            │
│  └─ LLM Synthesis with Citations                            │
│                                                             │
│  OUTPUT (Frontend Display)                                  │
│  ├─ Answer (streaming)                                      │
│  ├─ Inline Citation Badges                                  │
│  ├─ Source Cards (filename, page, heading, relevance)       │
│  ├─ Related Images & Tables                                 │
│  └─ Clickable Links to Document Viewer                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📂 File Structure

```
backend/
├── app/
│   ├── api/
│   │   ├── documents.py          ← Upload endpoint
│   │   ├── chat_agent.py         ← Chat streaming
│   │   ├── rag.py                ← Query endpoint
│   │   └── router.py             ← API routing
│   │
│   ├── services/
│   │   ├── document_parser/      ← Docling + Marker parsers
│   │   │   ├── docling_parser.py
│   │   │   └── marker_parser.py
│   │   ├── deep_document_parser.py ← Backward compat
│   │   ├── chunker.py            ← Text chunking
│   │   ├── chunk_dedup.py        ← Deduplication
│   │   ├── embedder.py           ← bge-m3 embeddings
│   │   ├── vector_store.py       ← ChromaDB wrapper
│   │   ├── knowledge_graph_service.py ← LightRAG wrapper
│   │   ├── deep_retriever.py     ← Hybrid retrieval
│   │   ├── reranker.py           ← Cross-encoder
│   │   ├── nexus_rag_service.py  ← Main orchestrator
│   │   ├── rag_service.py        ← Legacy RAG
│   │   └── llm/                  ← LLM providers
│   │       ├── gemini.py         ← Google Gemini
│   │       ├── ollama.py         ← Ollama local
│   │       └── sentence_transformer.py
│   │
│   ├── models/
│   │   ├── document.py           ← Document ORM
│   │   ├── chat_message.py       ← Chat ORM
│   │   └── knowledge_base.py     ← Workspace ORM
│   │
│   ├── core/
│   │   ├── config.py             ← Settings (.env)
│   │   ├── database.py           ← PostgreSQL async
│   │   └── deps.py               ← Dependency injection
│   │
│   └── main.py                   ← FastAPI app

data/
├── docling/
│   ├── kb_1/
│   │   ├── images/               ← Extracted images
│   │   └── ...
│   └── kb_2/
│
└── lightrag/
    ├── kb_1/                      ← Per-workspace KG
    │   ├── graph.pickle
    │   ├── entities_db.pkl
    │   └── vector_db/
    └── kb_2/

frontend/
├── src/
│   ├── components/rag/
│   │   ├── ChatPanel.tsx         ← Chat UI
│   │   ├── SearchBar.tsx         ← Query input
│   │   ├── ResultCard.tsx        ← Chunk display
│   │   ├── ThinkingTimeline.tsx  ← Thinking panel
│   │   ├── DocumentViewer.tsx    ← PDF/DOCX viewer
│   │   ├── KnowledgeGraphView.tsx ← KG visualization
│   │   └── ...
│   └── hooks/
│       ├── useRAGChatStream.ts   ← SSE streaming
│       └── ...
```

---

## 🔑 Key Technologies

| Component       | Technology                          | Purpose                                | Docs                         |
| --------------- | ----------------------------------- | -------------------------------------- | ---------------------------- |
| Parsing         | Docling / Marker                    | Extract structure + images + tables    | PDF_PROCESSING_FLOW.md       |
| Chunking        | HybridChunker                       | Semantic + structural split            | PDF_PROCESSING_FLOW.md       |
| Embedding       | sentence-transformers (BAAI/bge-m3) | 1024-d multilingual vectors            | NEXUSRAG_VS_STANDARD_RAG.md  |
| Vector Store    | ChromaDB                            | Cosine similarity + metadata filtering | MULTI_FILE_HANDLING.md       |
| Reranking       | BAAI/bge-reranker-v2-m3             | Cross-encoder joint scoring            | NEXUSRAG_VS_STANDARD_RAG.md  |
| Knowledge Graph | LightRAG                            | Entity extraction + multi-hop          | PDF_PROCESSING_FLOW.md       |
| LLM             | Gemini / Ollama                     | Generation + extended thinking         | DETAILED_PIPELINE_DIAGRAM.md |
| API             | FastAPI                             | Async streaming endpoints              | PDF_PROCESSING_FLOW.md       |
| Frontend        | React 19 + Vite                     | Real-time chat + document viewer       | PDF_PROCESSING_FLOW.md       |

---

## ⚡ Performance Benchmarks

| Metric                   | Value           | Notes                                |
| ------------------------ | --------------- | ------------------------------------ |
| Parse Time (50-page PDF) | 10-15s          | Docling + images                     |
| Image Captioning         | 2-3s per image  | Vision LLM (Gemini)                  |
| Query Latency            | 1-2s            | Vector + reranker + LLM              |
| Embedding Throughput     | 32 chunks/batch | 1024-d vectors                       |
| Storage per Document     | 60MB avg        | Text + images + vectors + KG         |
| Accuracy (RAGAS)         | 0.83+           | Better than standard RAG (0.75-0.80) |
| Hallucination Rate       | <5%             | With citation enforcement            |

---

## 🚀 Configuration Quick Start

### For Speed (Fast):

```bash
NEXUSRAG_DOCUMENT_PARSER=marker
NEXUSRAG_ENABLE_IMAGE_CAPTIONING=false
NEXUSRAG_ENABLE_TABLE_CAPTIONING=false
NEXUSRAG_ENABLE_KG=false
LLM_THINKING_LEVEL=minimal
```

### For Quality (Accurate):

```bash
NEXUSRAG_DOCUMENT_PARSER=docling
NEXUSRAG_ENABLE_IMAGE_CAPTIONING=true
NEXUSRAG_ENABLE_TABLE_CAPTIONING=true
NEXUSRAG_ENABLE_KG=true
KG_EMBEDDING_PROVIDER=gemini
LLM_THINKING_LEVEL=high
```

See [DETAILED_PIPELINE_DIAGRAM.md](./DETAILED_PIPELINE_DIAGRAM.md#-sơ-đồ-chi-tiết-kỳ-2-multi-file-handling) for full config options.

---

## ❓ FAQ

**Q: Nếu upload 2 file cùng lúc, chúng sẽ mix không?**
A: Không. Xem [MULTI_FILE_HANDLING.md](./MULTI_FILE_HANDLING.md#-layer-1-workspace-isolation-database-level) — 3 lớp isolation ngăn chặn.

**Q: Làm sao hệ thống tránh hallucination?**
A: Citation enforcement + cross-encoder reranking + relevance threshold. Xem [NEXUSRAG_VS_STANDARD_RAG.md#-safety--hallucination-reduction](./NEXUSRAG_VS_STANDARD_RAG.md#-safety--hallucination-reduction).

**Q: Chi phí của image/table captioning là bao nhiêu?**
A: Tùy LLM provider (Gemini: ~$0.05/1M tokens, Ollama local: free). Xem [DETAILED_PIPELINE_DIAGRAM.md](./DETAILED_PIPELINE_DIAGRAM.md#-performance-performance-comparison).

**Q: Có thể tắt KG để nhanh hơn không?**
A: Có. Set `NEXUSRAG_ENABLE_KG=false` trong `.env`. Xem [DETAILED_PIPELINE_DIAGRAM.md](./DETAILED_PIPELINE_DIAGRAM.md#-recommendation-tuning).

**Q: Query chỉ từ 1 file cụ thể được không?**
A: Có. Dùng scope selector UI hoặc `metadata_filter: {document_id: 42}`. Xem [MULTI_FILE_HANDLING.md#-layer-3-scope-filtering-query-time-pre-filtering](./MULTI_FILE_HANDLING.md#-layer-3-scope-filtering-query-time-pre-filtering).

---

## 📖 Reading Paths

### Path 1: I'm New to NexusRAG

1. [PDF_PROCESSING_FLOW.md](./PDF_PROCESSING_FLOW.md) — Start here (basic overview)
2. [DETAILED_PIPELINE_DIAGRAM.md](./DETAILED_PIPELINE_DIAGRAM.md) — Diagrams + FAQ
3. [MULTI_FILE_HANDLING.md](./MULTI_FILE_HANDLING.md) — Multi-file scenarios

### Path 2: Comparing with Standard RAG

1. [NEXUSRAG_VS_STANDARD_RAG.md](./NEXUSRAG_VS_STANDARD_RAG.md) — Full comparison
2. [PDF_PROCESSING_FLOW.md](./PDF_PROCESSING_FLOW.md#-so-sanh-voi-rag-thong-thuong-chi-tiet) — Specific section
3. [DETAILED_PIPELINE_DIAGRAM.md](./DETAILED_PIPELINE_DIAGRAM.md#-chi-tiết-luồng-query) — Query flow details

### Path 3: Understanding Multi-File Safety

1. [MULTI_FILE_HANDLING.md](./MULTI_FILE_HANDLING.md) — Comprehensive guide
2. [PDF_PROCESSING_FLOW.md](./PDF_PROCESSING_FLOW.md#-lam-sao-he-thong-tranh-loan-khi-upload-nhieu-file) — Best practices
3. [NEXUSRAG_VS_STANDARD_RAG.md](./NEXUSRAG_VS_STANDARD_RAG.md#-multi-file-scenarios) — Comparison section

### Path 4: Deep Dive into Technologies

1. Each document has technology sections
2. See [Cách triển khai UX/Policy](./PDF_PROCESSING_FLOW.md#-cách-triển-khai-uxpolicy-để-tránh-nhầm-lẫn-best-practices) for best practices

---

## 🎯 Next Steps

1. **Read** one of the main documents based on your interest
2. **Understand** the layers (Workspace → Document → Chunk → Token)
3. **Try** uploading 2 files and querying with scope filtering
4. **Verify** citations in the answer to understand provenance
5. **Tune** `.env` for your speed/accuracy tradeoff

---

## 📞 Troubleshooting

| Issue                          | Likely Cause                                | See Document                                                                                                                   |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 2 files seem to mix in results | Not using scope selector                    | [MULTI_FILE_HANDLING.md](./MULTI_FILE_HANDLING.md#-layer-3-scope-filtering-query-time-pre-filtering)                           |
| Images not searchable          | `NEXUSRAG_ENABLE_IMAGE_CAPTIONING=false`    | [PDF_PROCESSING_FLOW.md](./PDF_PROCESSING_FLOW.md)                                                                             |
| Tables missing from chunks     | `NEXUSRAG_ENABLE_TABLE_CAPTIONING=false`    | [PDF_PROCESSING_FLOW.md](./PDF_PROCESSING_FLOW.md)                                                                             |
| Hallucination happening        | Low reranker score, no citation enforcement | [NEXUSRAG_VS_STANDARD_RAG.md#-safety--hallucination-reduction](./NEXUSRAG_VS_STANDARD_RAG.md#-safety--hallucination-reduction) |
| Slow query latency             | KG ingest enabled or thinking level high    | [DETAILED_PIPELINE_DIAGRAM.md#-recommendation-tuning](./DETAILED_PIPELINE_DIAGRAM.md#-recommendation-tuning)                   |

---

## 📝 Document Versions

- **PDF_PROCESSING_FLOW.md** (v1.0)
  - Upload → Parse → Index → Query workflows
  - Detailed examples for text + image + table PDFs
- **DETAILED_PIPELINE_DIAGRAM.md** (v1.0)
  - Mermaid flowcharts
  - Configuration reference
  - FAQ & Tuning
- **NEXUSRAG_VS_STANDARD_RAG.md** (v1.0)
  - Comparative analysis
  - Technology trade-offs
  - Use case recommendations
- **MULTI_FILE_HANDLING.md** (v1.0)
  - Multi-file scenarios
  - Isolation mechanisms
  - Conflict detection & resolution

---

**Created**: May 2026  
**For**: NexusRAG Architecture Documentation  
**Status**: Complete & Comprehensive

---

## 🔗 Related Resources

- Main README: [../../README.md](../../README.md)
- Backend Source: `backend/app/`
- Frontend Source: `frontend/src/`
- Evaluation Report: `showcase/rag_evaluation_report.md`

---

**Last Updated**: May 6, 2026
