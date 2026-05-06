# Deduplication Và Cách Biết Chunk Thuộc File Nào (Theo Code Hiện Tại)

## 1) Deduplication là làm gì?

Deduplication là bước **lọc nhiễu + bỏ trùng** trước khi embedding vào ChromaDB.
Mục tiêu:
- Giảm rác trong vector store.
- Giảm chi phí embedding.
- Tăng độ chính xác retrieval/rerank.
- Tránh cùng 1 ý bị lặp nhiều chunk.

Vị trí chạy trong pipeline:
- `backend/app/services/nexus_rag_service.py:163`

Ở đây hệ thống gọi:
```python
parsed.chunks, dedup_stats = deduplicate_chunks(parsed.chunks)
```

---

## 2) Dedup hiện tại có mấy tầng?

### Tầng A: Noise Filter
- Hàm: `filter_noise(...)`
- File: `backend/app/services/chunk_dedup.py:142`

Nó loại:
- Chunk quá ngắn (dựa theo meaningful chars).
- Boilerplate như header/footer, page number, legal disclaimer.
- Chunk rỗng/chỉ định dạng.

Điểm quan trọng:
- Nếu chunk có `image_refs` hoặc `table_refs` thì **giữ lại** dù text ngắn.

Config liên quan:
- `NEXUSRAG_DEDUP_MIN_CHUNK_LENGTH`

---

### Tầng B: Exact Dedup
- Hàm: `dedup_exact(...)`
- File: `backend/app/services/chunk_dedup.py:191`

Cách làm:
- Normalize text (lowercase + gom whitespace).
- Hash SHA-256.
- Hash trùng thì bỏ chunk đến sau, giữ chunk đầu tiên.

---

### Tầng C: Near Dedup
- Hàm: `dedup_near(...)`
- File: `backend/app/services/chunk_dedup.py:217`

Cách làm:
- Tạo char n-gram shingles (n=5).
- Tính Jaccard similarity giữa cặp chunk.
- Nếu similarity >= threshold thì bỏ chunk phía sau.

Config liên quan:
- `NEXUSRAG_DEDUP_NEAR_THRESHOLD` (mặc định 0.85)

---

### Public API dedup
- Hàm tổng: `deduplicate_chunks(...)`
- File: `backend/app/services/chunk_dedup.py:264`

Nó trả về:
- `filtered_chunks`
- `stats` gồm:
  - input
  - noise_removed
  - exact_removed
  - near_removed
  - output

Sau khi lọc, code sẽ **re-index chunk_index liên tục** để tránh lỗ hổng index.

---

## 3) Làm sao biết chunk thuộc file nào?

Có 3 lớp nhận diện song song:

## Lớp 1: Khi tạo chunk đã gắn source_file

Trong parser Docling:
- Hàm chunking: `backend/app/services/document_parser/docling_parser.py:232`
- Chỗ tạo EnrichedChunk: `backend/app/services/document_parser/docling_parser.py:344`

Ở đây chunk được gắn:
- `chunk_index`
- `source_file=original_filename`
- `page_no`

Ví dụ code:
```python
EnrichedChunk(
    content=contextualized,
    chunk_index=i,
    source_file=original_filename,
    document_id=document_id,
    page_no=page_no,
    ...
)
```

Model `EnrichedChunk` nằm ở:
- `backend/app/services/models/parsed_document.py:41`
- `chunk_index`: `:44`
- `source_file`: `:45`

---

## Lớp 2: Khi index vào ChromaDB, metadata có document_id/source/page_no

Trong NexusRAG index step:
- `backend/app/services/nexus_rag_service.py:200` (build metadata)
- `backend/app/services/nexus_rag_service.py:203` (`document_id`)
- `backend/app/services/nexus_rag_service.py:205` (`source`)
- `backend/app/services/nexus_rag_service.py:207` (`page_no`)

Chunk ID chuẩn:
- `doc_{document_id}_chunk_{i}`

Metadata lưu vào Chroma chứa tối thiểu:
- `document_id`
- `source`
- `page_no`
- `heading_path`
- `image_ids`, `table_ids`

=> Nên mỗi chunk truy ra đúng file gốc được.

---

## Lớp 3: Lúc query, metadata được map lại thành citation

Trong deep retriever:
- Hàm query: `backend/app/services/deep_retriever.py:61`
- Nếu có filter file: `backend/app/services/deep_retriever.py:177`
- Mapping chunk từ metadata: `backend/app/services/deep_retriever.py:209`
- Tạo citation: `backend/app/services/deep_retriever.py:223`

Ở API response `/rag/query/{workspace_id}`:
- gọi query_deep: `backend/app/api/rag.py:102`
- truyền `document_ids`: `backend/app/api/rag.py:105`
- truyền `metadata_filter`: `backend/app/api/rag.py:107`

Schema request hỗ trợ lọc file:
- `backend/app/schemas/rag.py:12` (`document_ids`)
- `backend/app/schemas/rag.py:13` (`metadata_filter`)

=> Kết quả trả về có citation gồm `source_file`, `document_id`, `page_no` nên biết chính xác chunk từ file nào.

---

## 4) Trường hợp upload 2 file thì hệ thống xác định sao?

Mặc định (không filter):
- Search trên toàn bộ collection của workspace.
- Collection tách theo workspace tại:
  - `backend/app/services/vector_store.py:49`
  - `backend/app/services/vector_store.py:53`

=> Có thể lấy chunk từ cả file A và B nếu cùng liên quan.

Muốn chỉ 1 file:
- Truyền `document_ids: [id_file_muon_hoi]`.

Ví dụ payload:
```json
{
  "question": "Doanh thu quý 4 bao nhiêu?",
  "top_k": 5,
  "mode": "hybrid",
  "document_ids": [12]
}
```

---

## 5) Quan hệ DB hỗ trợ truy nguồn

Model `Document` có quan hệ:
- images: `backend/app/models/document.py:48`
- tables: `backend/app/models/document.py:51`

Khi query deep, hệ thống còn lấy ảnh/bảng theo `(document_id, page_no)`
để gắn về đúng chunk đúng trang.

---

## 6) Ví dụ end-to-end ngắn

1. Upload 2 file:
- File A -> document_id=12
- File B -> document_id=13

2. Parse/chunk/dedup/index:
- A tạo chunk ID dạng `doc_12_chunk_x`
- B tạo chunk ID dạng `doc_13_chunk_y`

3. User hỏi không filter:
- Retriever có thể trả cả doc 12 và 13.

4. User hỏi có filter `document_ids=[12]`:
- Query thêm where `document_id IN [12]`.
- Chỉ trả chunk của file A.

---

## 7) Tuning dedup nhanh (khuyến nghị)

Nếu bị mất ý quan trọng do lọc mạnh:
- tăng `NEXUSRAG_DEDUP_NEAR_THRESHOLD` từ `0.85` lên `0.90` hoặc `0.92`.

Nếu còn nhiều header/footer rác:
- giảm `NEXUSRAG_DEDUP_MIN_CHUNK_LENGTH` hoặc bổ sung pattern boilerplate trong:
  - `backend/app/services/chunk_dedup.py`

---

## 8) Kết luận ngắn

- Dedup là bước làm sạch trước embedding, gồm 3 tầng: noise, exact, near.
- Chunk biết thuộc file nào nhờ `document_id + source_file + page_no` được gắn từ parser và lưu vào metadata Chroma.
- Khi query nhiều file, mặc định hệ thống tìm trên toàn workspace; muốn ép đúng file thì dùng `document_ids`.
