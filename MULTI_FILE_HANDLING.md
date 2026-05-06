# Multi-File Handling in NexusRAG — Chi Tiết

## 🎯 Tóm Tắt: Làm Sao Hệ Thống Không Loạn Khi Upload 2 File?

**3 lớp isolation:**

1. **Workspace isolation** (database level)
2. **Document-level provenance** (metadata in every chunk)
3. **Scope filtering** (UI + query-time filtering)

---

## 📋 SCENARIO: Upload 2 Files Cùng Workspace

```
Workspace: "Q1 Financial Analysis" (workspace_id=1)
├── File A: annual_report_2024.pdf (doc_id=42)
│   └── 50 pages, 5 images, 3 tables → 55 unique chunks
│
└── File B: budget_2024.docx (doc_id=43)
    └── 20 pages, 2 images, 1 table → 23 unique chunks

Total: 78 chunks in kb_1 collection
```

---

## 🔒 LAYER 1: WORKSPACE ISOLATION (Database Level)

### How It Works

```sql
-- PostgreSQL Schema

KnowledgeBase table:
  id: 1
  name: "Q1 Financial Analysis"
  description: "..."

Document table:
  id: 42
  workspace_id: 1  ← Link to KB
  filename: abc123.pdf
  original_filename: annual_report_2024.pdf
  status: INDEXED

  id: 43
  workspace_id: 1  ← Same KB
  filename: def456.docx
  original_filename: budget_2024.docx
  status: INDEXED

ChromaDB Collections:
  collection: kb_1  ← One collection per workspace
    ├── doc_42_chunk_0: [embedding], {doc_id: 42, filename: annual_report...}
    ├── doc_42_chunk_1: [embedding], {doc_id: 42, ...}
    ├── doc_43_chunk_0: [embedding], {doc_id: 43, filename: budget...}
    ├── doc_43_chunk_1: [embedding], {doc_id: 43, ...}
    └── ...

LightRAG KG storage:
  directory: data/lightrag/kb_1/  ← Per-workspace
    ├── graph.pickle (all entities from both docs)
    ├── entities_db.pkl
    └── vector_db/ (entity embeddings)
```

### Query Isolation

```python
# Backend: Get RAG service for workspace 1
rag_service = get_rag_service(db, workspace_id=1)

# Query operation:
# 1. ChromaDB search happens ONLY in kb_1 collection
# 2. LightRAG query happens ONLY in data/lightrag/kb_1/
# 3. Metadata filtering can scope further

# If user from workspace 2 queries:
rag_service = get_rag_service(db, workspace_id=2)
# → Completely different collection + graph
# → No cross-workspace data leak
```

**Query Code Pattern:**

```python
@router.post("/rag/chat/{workspace_id}/stream")
async def chat_stream(
    workspace_id: int,
    request: ChatRequest,
    db: AsyncSession
):
    # Workspace isolation enforced at endpoint level
    rag_service = get_rag_service(db, workspace_id)  # Safe!

    # Only kb_{workspace_id} collection used
    result = await rag_service.query_deep(
        query=request.message,
        metadata_filter=request.metadata_filter  # User can further scope
    )
    return result
```

**Result**: Even if you have 10 workspaces, each is completely isolated. No chance of cross-workspace contamination.

---

## 📍 LAYER 2: DOCUMENT-LEVEL PROVENANCE (Metadata in Every Chunk)

### What Gets Stored Per Chunk

```python
# When indexing File A (annual_report.pdf):
chunk_0 = {
    "id": "doc_42_chunk_0",
    "embedding": [0.23, -0.15, ..., 0.05],  # 1024-dim
    "document": "Q1 revenue reached $100M...",
    "metadata": {
        # Core provenance:
        "document_id": 42,                    ← Which document?
        "filename": "annual_report_2024.pdf", ← Original name
        "file_type": "pdf",                  ← Format
        "chunk_index": 0,                    ← Position in doc
        "page_no": 5,                        ← Exact page
        "heading_path": ["Financial Results", "Revenue"],  ← Context path

        # Content type:
        "has_table": False,
        "has_code": False,

        # References to visual elements:
        "image_refs": ["img_001", "img_002"],  ← Which images?
        "image_urls": ["/static/.../img_001.png", ...],
        "table_refs": ["tbl_001"],             ← Which tables?

        # User-defined tags:
        "year": "2024",
        "category": "financial",
        "confidential": "false"
    }
}

# When indexing File B (budget.docx):
chunk_0 = {
    "id": "doc_43_chunk_0",
    "embedding": [...],
    "document": "2024 budget allocation...",
    "metadata": {
        "document_id": 43,                    ← DIFFERENT document
        "filename": "budget_2024.docx",       ← DIFFERENT name
        "file_type": "docx",                 ← DIFFERENT type
        "chunk_index": 0,
        "page_no": 1,
        "heading_path": ["Summary", "Overview"],

        # User-defined tags (same tags as File A):
        "year": "2024",
        "category": "budget",                ← DIFFERENT category!
        "confidential": "false"
    }
}
```

### Query Time: Provenance Visible

```
User Query: "Q1 revenue?"

Retrieved chunks (reranked top-8):

1️⃣  Chunk: "Q1 revenue reached $100M..."
   Source: annual_report_2024.pdf
   Page: 5
   Heading: Financial Results
   Relevance: 0.92
   ✅ From File A (doc_id=42)

2️⃣  Chunk: "APAC region contributed $50M..."
   Source: annual_report_2024.pdf
   Page: 12
   Heading: Regional Breakdown
   Relevance: 0.87
   ✅ From File A (doc_id=42)

3️⃣  Chunk: "Budget allocation per region..."
   Source: budget_2024.docx
   Page: 3
   Heading: Allocation Strategy
   Relevance: 0.65
   ✅ From File B (doc_id=43)

LLM sees all chunks and their sources
→ Generates answer with citations
→ Frontend displays source cards showing which file
→ User is ALWAYS aware of source
```

---

## 🎯 LAYER 3: SCOPE FILTERING (Query-Time Pre-filtering)

### ChromaDB Metadata Filtering

```python
# Option 1: Retrieve from ALL files (default)
results = vector_store.search(
    query_vector=query_embedding,
    top_k=20,
    metadata_filter=None  # No filter, search all 78 chunks
)
# Result: mix of doc_42 and doc_43 chunks, ranked by reranker

# Option 2: Scope to File A only
results = vector_store.search(
    query_vector=query_embedding,
    top_k=20,
    metadata_filter={"document_id": 42}  # Only doc_id=42 chunks
)
# Result: only 55 File A chunks searched, doc_43 completely excluded

# Option 3: Scope by category
results = vector_store.search(
    query_vector=query_embedding,
    top_k=20,
    metadata_filter={"category": "financial"}  # Only financial chunks
)
# Result: "financial" tagged chunks only

# Option 4: Complex filter (AND logic)
results = vector_store.search(
    query_vector=query_embedding,
    top_k=20,
    metadata_filter={
        "document_id": 42,
        "year": "2024",
        "has_table": True
    }
)
# Result: chunks from File A, year 2024, that contain tables
```

### Frontend UI for Scope Control

```
┌─────────────────────────────────────────┐
│ Search Panel                            │
├─────────────────────────────────────────┤
│                                         │
│ Scope Selector:                         │
│ ┌─────────────────────────────────┐    │
│ │ All Documents ▼                 │    │
│ ├─────────────────────────────────┤    │
│ │ All Documents (78 chunks)       │    │
│ │ annual_report_2024.pdf (55)     │    │
│ │ budget_2024.docx (23)           │    │
│ └─────────────────────────────────┘    │
│                                         │
│ OR Filter by tags:                      │
│ ☑️ year = 2024                          │
│ ☑️ category = financial                 │
│ ☐ category = budget                     │
│ ☐ confidential = true                   │
│                                         │
│ [Apply Filter]                          │
│                                         │
│ Your Query: _____________________       │
│ [Search]                                │
│                                         │
└─────────────────────────────────────────┘
```

### API Usage Example

```bash
# Retrieve from all files
curl -X POST http://localhost:8080/api/v1/rag/query/1 \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Q1 revenue?",
    "metadata_filter": null
  }'

# Retrieve from File A only
curl -X POST http://localhost:8080/api/v1/rag/query/1 \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Q1 revenue?",
    "metadata_filter": {"document_id": 42}
  }'

# Retrieve from files tagged "2024" and "financial"
curl -X POST http://localhost:8080/api/v1/rag/query/1 \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Q1 revenue?",
    "metadata_filter": {
      "year": "2024",
      "category": "financial"
    }
  }'
```

---

## ⚡ CONFLICT DETECTION & RESOLUTION

### Scenario: Files Contain Conflicting Data

```
File A (annual_report.pdf):
"Q1 revenue reached $100M, up 15% from Q4"
(page 5, financial results)

File B (budget_2024.docx):
"Q1 budget estimate: $110M
 Actual revenue expected: $105M"
(page 3, budget strategy)

User Query: "What's Q1 revenue?"
```

### How NexusRAG Handles It

```
Step 1: Retrieve from both files
├─ Chunk A: "Q1 revenue $100M (↑15%)" — relevance 0.92 (doc_42)
├─ Chunk B: "Q1 budget $110M" — relevance 0.85 (doc_43)
└─ Chunk C: "Actual revenue expected $105M" — relevance 0.82 (doc_43)

Step 2: Rerank (cross-encoder)
├─ Chunk A: 0.92 ✓
├─ Chunk B: 0.80 ✓
└─ Chunk C: 0.78 ✓

Step 3: LLM Synthesis with Citations

Output 1 (if using both):
"According to the annual report, Q1 revenue
 reached $100M, up 15% from Q4 [a3z1].
 However, the budget document estimated
 $110M [b7w2], with actual expectations
 at $105M [b7w2].

 Note: There's a discrepancy between the
 reported actual ($100M) and budgeted
 estimate ($110M)."

Output 2 (if scoped to File A only):
"Q1 revenue reached $100M, up 15% from Q4 [a3z1]."

Output 3 (if scoped to File B only):
"The budget document shows Q1 allocation at $110M [b7w2],
 with actual revenue expectations at $105M [b7w2]."
```

### Clarification Prompt (Optional Agentic)

If LLM detects strong conflicts and `auto_clarify=true`:

```
LLM Response:
"I found conflicting information:
- annual_report (doc_42): $100M actual
- budget_2024 (doc_43): $110M budgeted vs $105M expected

Which would you like to know?
a) Actual reported revenue (from annual report)
b) Budgeted vs actual expectations (from budget)
c) Comparison of both"

User: "a) Actual reported revenue"

Re-query with scope: document_id=42
Result: Only annual_report chunks retrieved
```

---

## 🛡️ MECHANISMS TO PREVENT "LOẠN" (Chaos)

### 1. Strict Chunk Ownership

```python
# Each chunk permanently tied to ONE document
chunk = {
    "id": f"doc_{document_id}_chunk_{chunk_index}",
    "metadata": {
        "document_id": document_id,  # Immutable
        "filename": filename,         # Immutable
        ...
    }
}

# Cannot accidentally "move" chunk between documents
# Cannot accidentally mix sources
```

### 2. Metadata Immutability

```python
# Metadata set at index time, never changed
# Even if documents updated later:

# Scenario: User re-uploads annual_report.pdf
# Old chunks (doc_id=42) still tagged with old filename
# New chunks (doc_id=44) tagged with new filename
# → Traceability maintained, no overwrites

# Query can distinguish:
metadata_filter = {
    "document_id": 42  # Old version
}
# vs
metadata_filter = {
    "document_id": 44  # New version
}
```

### 3. Reranker Diversity

```python
# If multiple chunks from same file score high,
# reranker can apply diversity penalty:

candidate_chunks = [
    {"id": "doc_42_chunk_0", "cosine": 0.88},
    {"id": "doc_42_chunk_1", "cosine": 0.86},  ← Same doc
    {"id": "doc_43_chunk_0", "cosine": 0.84},
]

# Standard reranking: sort by cross-encoder score
# Diversity reranking: penalize same-doc clustering
after_diversity_penalty = [
    {"id": "doc_42_chunk_0", "score": 0.92},
    {"id": "doc_43_chunk_0", "score": 0.84},    ← Boosted from doc_43
    {"id": "doc_42_chunk_1", "score": 0.76},    ← Penalized (from doc_42)
]
# Result: more balanced cross-document sources
```

### 4. Citation Enforcement

```python
# LLM policy:
# - MUST cite sources
# - Must reference chunk_id or doc_id
# - Max 3 cites per sentence

System Prompt:
"You must cite every claim using [citation_id].
 For example: 'Revenue was $100M [a3z1]'

 Example citation format:
 [a3z1] = chunk from annual_report.pdf, page 5
 [b7w2] = chunk from budget_2024.docx, page 3

 If a fact is not supported by provided chunks,
 explicitly say: 'This information is not
 available in the provided documents.'

 Do NOT make claims without citations."

Result:
LLM cannot accidentally mix file A + B
without showing it via citations
→ User can verify source
```

### 5. Knowledge Graph Entity Linking

```python
# LightRAG maintains entity→chunk mapping

Entities extracted from File A:
- "Apple Inc" → source_chunks: [doc_42_chunk_5, doc_42_chunk_12]
- "CEO Tim Cook" → source_chunks: [doc_42_chunk_8]

Entities extracted from File B:
- "Apple Inc" → source_chunks: [doc_43_chunk_2]
  (same entity, different doc)

KG linking:
- Same entity "Apple Inc" gets merged node
- But edges track source_chunks per relation
- Query: "Who runs Apple?"
  → Found nodes: Tim Cook (from doc_42)
  → Citation shows origin: doc_42_chunk_8

Result:
- Entities properly linked across files when same
- Provenance maintained for each fact
- No confusion about which doc said what
```

---

## 📊 DEDUPLICATION: HANDLING DUPLICATE CONTENT

### Scenario: Both Files Mention Same Info

```
File A (annual_report.pdf), page 5:
"Q1 revenue reached $100M, up 15% from Q4.
 This represents strong market growth."

File B (budget_2024.docx), page 1:
"Q1 revenue reached $100M, up 15% from Q4.
 [copied from annual report]"

Chunking result:
- File A → chunk_A: "Q1 revenue reached..."
- File B → chunk_B: "Q1 revenue reached..." (identical text)

Deduplication process:
```

### Dedup Algorithm

```python
def deduplicate_chunks(chunks):
    """
    Remove exact and near-duplicate chunks.
    Return canonical chunks with source tracking.
    """

    seen_fingerprints = {}
    seen_embeddings = {}

    for chunk in chunks:
        # Step 1: Exact match (hash)
        fp = hash(chunk.content)
        if fp in seen_fingerprints:
            # Exact duplicate found
            canonical = seen_fingerprints[fp]
            canonical.source_files.append(chunk.source_file)
            continue

        # Step 2: Near-duplicate (cosine similarity)
        embedding = embed(chunk.content)
        for seen_emb, canonical_chunk in seen_embeddings.items():
            sim = cosine_similarity(embedding, seen_emb)
            if sim > 0.95:  # Near-duplicate threshold
                canonical_chunk.duplicate_sources.append(chunk.source_file)
                continue

        # Step 3: Unique chunk, keep it
        seen_fingerprints[fp] = chunk
        seen_embeddings[embedding] = chunk

    return canonical_chunks

# Result:
Input:  chunk_A + chunk_B (identical)
        2 chunks

Output: 1 canonical chunk
        metadata: {
            "source_files": ["annual_report_2024.pdf", "budget_2024.docx"]
        }

Citation: "[a3z1] (annual_report_2024.pdf, budget_2024.docx, page 5)"
→ User knows fact exists in both files
```

---

## 🔍 PRACTICAL EXAMPLE: Multi-File Query Flow

### Setup

```
Workspace: Finance KB (workspace_id=1)
├── File A: annual_report_2024.pdf (doc_id=42)
│   └── 55 chunks after dedup
└── File B: budget_2024.docx (doc_id=43)
    └── 23 chunks after dedup

ChromaDB kb_1: 78 total chunks
LightRAG kb_1: Merged KG with entities from both files
```

### Query Execution

```
User Query: "Compare Q1 actual vs budgeted revenue"
Scope: None (search all files)
Custom Metadata Filter: None

╔════════════════════════════════════════════════════════╗
║ Step 1: Vector Search (ChromaDB)                       ║
╚════════════════════════════════════════════════════════╝

Embed query: "Compare Q1 actual vs budgeted revenue"
→ 1024-dim vector

Cosine similarity search:
- Top-20 results from 78 chunks
- Mix of doc_42 (actual) + doc_43 (budget)

Results:
1. doc_42_chunk_0: "Q1 actual revenue $100M" (cosine: 0.88)
2. doc_43_chunk_2: "Q1 budget $110M" (cosine: 0.87)
3. doc_42_chunk_3: "YoY growth 15%" (cosine: 0.82)
4. doc_43_chunk_1: "Budget strategy" (cosine: 0.81)
... (16 more)

╔════════════════════════════════════════════════════════╗
║ Step 2: KG Query (LightRAG)                            ║
╚════════════════════════════════════════════════════════╝

Entity extraction: Q1, revenue, actual, budget
Multi-hop lookup:
- Q1 → [chunks: doc_42_0, doc_42_1, doc_43_2]
- revenue → [chunks: doc_42_0, doc_43_2]
- actual → [chunks: doc_42_0]
- budget → [chunks: doc_43_2]

KG results: ~8 additional chunks

╔════════════════════════════════════════════════════════╗
║ Step 3: Merge + Deduplicate                            ║
╚════════════════════════════════════════════════════════╝

Vector results: 20 chunks
KG results: 8 chunks
→ Merge: ~25 unique chunks (deduplicated by chunk_id)

╔════════════════════════════════════════════════════════╗
║ Step 4: Cross-Encoder Reranking                        ║
╚════════════════════════════════════════════════════════╝

Model: BAAI/bge-reranker-v2-m3
Input: (query, chunk) pairs × 25

Scores:
1. doc_42_chunk_0: "Q1 actual revenue $100M" → 0.94 ✓
2. doc_43_chunk_2: "Q1 budget $110M" → 0.91 ✓
3. doc_42_chunk_3: "YoY growth 15%" → 0.88 ✓
4. doc_43_chunk_1: "Budget strategy overview" → 0.84 ✓
5. doc_42_chunk_5: "Regional breakdown" → 0.82 ✓
6. doc_43_chunk_4: "Allocation strategy" → 0.81 ✓
7. doc_42_chunk_1: "Q4 comparison" → 0.79 ✓
8. doc_43_chunk_3: "Risk analysis" → 0.76 ✓

(Anything below 0.15 threshold would be dropped)

╔════════════════════════════════════════════════════════╗
║ Step 5: Retrieved Context Assembly                     ║
╚════════════════════════════════════════════════════════╝

Top-8 Chunks (all above threshold):

[a3z1] doc_42, page 5:
  "Q1 actual revenue reached $100M,
   up 15% from Q4"
  Relevance: 0.94
  Source: annual_report_2024.pdf

[b7w2] doc_43, page 2:
  "Q1 budget allocation: $110M
   strategic investment"
  Relevance: 0.91
  Source: budget_2024.docx

[a3z3] doc_42, page 8:
  "Q1 vs Q4: $85.7M → $100M growth"
  Relevance: 0.88
  Source: annual_report_2024.pdf

[b7w4] doc_43, page 1:
  "Budget strategy: Conservative estimate $110M
   with upside potential $120M"
  Relevance: 0.84
  Source: budget_2024.docx

[a3z5] doc_42, page 12:
  "Regional: APAC $50M, EMEA $30M, US $20M"
  Relevance: 0.82
  Source: annual_report_2024.pdf

... (3 more chunks)

╔════════════════════════════════════════════════════════╗
║ Step 6: Prompt Assembly                                ║
╚════════════════════════════════════════════════════════╝

System: "You are a financial analyst..."

Context:
"[a3z1] Q1 actual revenue reached $100M,
 up 15% from Q4 (annual_report_2024.pdf, page 5)

 [b7w2] Q1 budget allocation: $110M strategic
 investment (budget_2024.docx, page 2)

 [a3z3] Q1 vs Q4: $85.7M → $100M growth
 (annual_report_2024.pdf, page 8)

 [b7w4] Budget strategy: Conservative estimate $110M
 with upside potential $120M (budget_2024.docx, page 1)

 [a3z5] Regional: APAC $50M, EMEA $30M, US $20M
 (annual_report_2024.pdf, page 12)

 ... [3 more citations]"

Question: "Compare Q1 actual vs budgeted revenue"

LLM Directive:
"Cite every claim. Max 3 cites per sentence.
 If unsupported, say 'Not available in documents.'
 Use only provided context."

╔════════════════════════════════════════════════════════╗
║ Step 7: LLM Generation (Streaming)                     ║
╚════════════════════════════════════════════════════════╝

Output (streaming tokens):

"Q1 comparison: actual vs budget
──────────────────────────────

Actual Revenue (from annual report):
$100M realized [a3z1], representing 15% growth
from Q4's $85.7M [a3z3].

Budgeted Amount (from budget document):
$110M was allocated as strategic investment [b7w2],
with a conservative budget estimate against upside
potential of $120M [b7w4].

Analysis:
• Actual $100M vs Budget $110M = $10M under budget
• However, both strong growth signals:
  - Actual: 15% QoQ growth [a3z1]
  - Budget: Within strategic allocation range [b7w4]

Regional Performance:
APAC led with $50M, followed by EMEA $30M and
US $20M [a3z5].

Conclusion:
Q1 performed well against actual targets [a3z1],
though slightly below budget forecast [b7w2].
The variance appears strategic rather than
shortfall-driven [b7w4]."

╔════════════════════════════════════════════════════════╗
║ Step 8: Post-Generation (Citations + Sources)          ║
╚════════════════════════════════════════════════════════╝

Citation Cards (backend → frontend):
{
  "citations": [
    {
      "id": "a3z1",
      "source": "annual_report_2024.pdf",
      "page": 5,
      "heading": "Financial Results",
      "snippet": "Q1 actual revenue reached $100M, up 15%",
      "relevance": 0.94,
      "document_id": 42
    },
    {
      "id": "b7w2",
      "source": "budget_2024.docx",
      "page": 2,
      "heading": "Budget Allocation",
      "snippet": "$110M strategic investment",
      "relevance": 0.91,
      "document_id": 43
    },
    ...
  ]
}

╔════════════════════════════════════════════════════════╗
║ Step 9: Frontend Display                               ║
╚════════════════════════════════════════════════════════╝

Answer Panel:
┌──────────────────────────────────────────────────┐
│ Q1 comparison: actual vs budget                  │
│ ─────────────────────────────────────────────    │
│                                                   │
│ Actual Revenue (from annual report):             │
│ $100M realized [a3z1], representing 15% growth   │
│ from Q4's $85.7M [a3z3].                        │
│                                                   │
│ Budgeted Amount (from budget document):          │
│ $110M was allocated as strategic investment [b7w2],│
│ ...                                               │
│                                                   │
│ [Source Cards Below Answer]                      │
│ ┌──────────────────────┐ ┌──────────────────────┐
│ │ [a3z1]               │ │ [b7w2]               │
│ │ annual_report...pdf  │ │ budget_2024.docx    │
│ │ Page 5               │ │ Page 2               │
│ │ Financial Results    │ │ Budget Allocation    │
│ │ "Q1 actual revenue   │ │ "$110M strategic     │
│ │  reached $100M..."   │ │  investment..."      │
│ │ Relevance: 0.94      │ │ Relevance: 0.91      │
│ │ [View in Doc ↗]      │ │ [View in Doc ↗]      │
│ └──────────────────────┘ └──────────────────────┘
└──────────────────────────────────────────────────┘

User can:
✓ See which file each fact comes from
✓ Click [a3z1] to jump to page 5 in annual_report
✓ Click [b7w2] to jump to page 2 in budget
✓ Trust sources because citations are enforced
✓ Detect conflicts (different files say $100M vs $110M)
```

---

## ✅ SAFEGUARDS SUMMARY

| Safeguard               | When Applied    | Prevents                             |
| ----------------------- | --------------- | ------------------------------------ |
| Workspace isolation     | Index time      | Cross-workspace data leak            |
| Document_id in metadata | Index time      | Chunk source ambiguity               |
| Citation enforcement    | Generation time | Unsourced claims                     |
| Cross-encoder reranking | Retrieval time  | False relevance from cosine-only     |
| Relevance threshold     | Retrieval time  | Irrelevant chunks included           |
| Deduplication           | Index time      | Redundant noise                      |
| Metadata filtering      | Query time      | User can scope to specific files     |
| KG entity linking       | KG ingest time  | Separate entity nodes for same thing |
| Source card display     | Frontend time   | User can verify each claim           |

---

## 🚀 BEST PRACTICES FOR MULTI-FILE USAGE

### ✅ DO:

```
1. Add custom_metadata on upload:
   {"key": "type", "value": "financial"}
   {"key": "year", "value": "2024"}

2. Use scope selector before querying:
   - All files for comprehensive view
   - Single file for focused analysis
   - Tags for cross-cutting concerns

3. Verify citations in answer:
   - Hover citations to see source
   - Read heading path for context
   - Check relevance scores

4. Flag contradictions:
   - If File A says $100M and File B says $110M
   - NexusRAG will show both citations
   - You can clarify with follow-up query

5. Use analytics dashboard:
   - See which documents indexed
   - Document counts per workspace
   - Entity distribution
```

### ❌ DON'T:

```
1. Assume files won't mix:
   - Always scope or verify citations

2. Trust unsourced claims:
   - If answer has no citations, be suspicious
   - Ask LLM to cite sources

3. Upload conflicting data without tagging:
   - Tag "type: budget" vs "type: actual"
   - Helps scope later

4. Ignore relevance scores:
   - 0.92 is confident, 0.50 is weak
   - Filter out low-confidence results

5. Mix workspace data:
   - Each workspace is isolated
   - Don't expect cross-workspace queries
```

---

**End of Multi-File Handling Guide**
