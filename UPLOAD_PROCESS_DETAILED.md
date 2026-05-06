# Quá Trình Upload File — Chi Tiết Đầy Đủ Từ A→Z

## 📋 OVERVIEW: 5 GIAI ĐOẠN CHÍNH

```
GIAI ĐOẠN 1: Upload & Persist (API)
    ↓ (HTTP response immediately)
GIAI ĐOẠN 2: Background Job Started
    ↓
GIAI ĐOẠN 3: Parsing (Extract + OCR)
    ↓
GIAI ĐOẠN 4: Indexing (Embed + KG)
    ↓
GIAI ĐOẠN 5: Complete (Ready for Query)
```

---

## 🔴 GIAI ĐOẠN 1: UPLOAD & PERSIST (0-2 giây)

### 1.1 User Upload Action (Frontend)

```typescript
// frontend/src/components/rag/UploadZone.tsx
const handleUpload = async (files: File[]) => {
  const formData = new FormData();
  formData.append("file", files[0]);

  // Optional: add custom metadata
  formData.append(
    "custom_metadata",
    JSON.stringify([
      { key: "year", value: "2024" },
      { key: "department", value: "Finance" },
    ]),
  );

  const response = await fetch(`/api/v1/documents/upload/${workspaceId}`, {
    method: "POST",
    body: formData,
  });

  const result = await response.json();
  console.log(
    `Document created: id=${result.document_id}, status=${result.status}`,
  );
};
```

### 1.2 API Endpoint (Upload)

**Endpoint**: `POST /api/v1/documents/upload/{workspace_id}`

```python
# backend/app/api/documents.py

@router.post("/upload/{workspace_id}", response_model=DocumentUploadResponse)
async def upload_document(
    workspace_id: int,
    file: UploadFile = File(...),
    custom_metadata: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document to a knowledge base."""

    # Step 1.2.1: Validate Workspace
    result = await db.execute(
        select(KnowledgeBase).where(KnowledgeBase.id == workspace_id)
    )
    kb = result.scalar_one_or_none()
    if kb is None:
        raise NotFoundError("KnowledgeBase", workspace_id)

    # Step 1.2.2: Parse Custom Metadata (JSON format)
    parsed_metadata = None
    if custom_metadata:
        try:
            raw_metadata = json.loads(custom_metadata)
            if not isinstance(raw_metadata, list):
                raise ValueError("Metadata must be list of key-value objects")

            parsed_metadata = {}
            for item in raw_metadata:
                if 'key' not in item or 'value' not in item:
                    raise ValueError("Each metadata item must have 'key' and 'value'")
                parsed_metadata[item['key']] = item['value']
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid custom_metadata: {e}"
            )

    # Step 1.2.3: Validate File Type
    ext = Path(file.filename).suffix.lower()
    ALLOWED_EXTENSIONS = {
        '.pdf', '.txt', '.md', '.docx', '.pptx',
        '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.webp'
    }
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type {ext} not allowed. Allowed: {ALLOWED_EXTENSIONS}"
        )

    # Step 1.2.4: Validate File Size (Max 50MB)
    content = await file.read()
    MAX_FILE_SIZE = 50 * 1024 * 1024
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Max: {MAX_FILE_SIZE // 1024 // 1024}MB"
        )

    # Step 1.2.5: Save File to Disk (Temporary)
    UPLOAD_DIR = settings.BASE_DIR / "uploads"
    UPLOAD_DIR.mkdir(exist_ok=True)

    filename = f"{uuid.uuid4()}{ext}"  # e.g., "abc123def456.pdf"
    file_path = UPLOAD_DIR / filename

    import aiofiles
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # Step 1.2.6: Create Document Record in PostgreSQL
    document = Document(
        workspace_id=workspace_id,
        filename=filename,  # UUID filename
        original_filename=file.filename,  # Original name
        file_type=ext[1:],  # "pdf", "docx", etc
        file_size=len(content),
        status=DocumentStatus.PENDING,  # Not processed yet
        custom_metadata=parsed_metadata,  # User tags
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)

    # Step 1.2.7: Trigger Background Job
    # (will process asynchronously)
    background_tasks = BackgroundTasks()
    background_tasks.add_task(
        process_document_background,
        document.id,
        str(file_path),
        workspace_id
    )

    # Step 1.2.8: Return to User (Immediate Response)
    return DocumentUploadResponse(
        document_id=document.id,
        status=DocumentStatus.PENDING,
        message="Document uploaded. Processing started..."
    )

# Response (instant, within 1 sec)
# {
#   "document_id": 42,
#   "status": "pending",
#   "message": "Document uploaded. Processing started..."
# }
```

### 1.3 Database State After Upload

**PostgreSQL `documents` table:**

```sql
INSERT INTO documents (
  id, workspace_id, filename, original_filename,
  file_type, file_size, status, created_at,
  chunk_count, custom_metadata
) VALUES (
  42, 1, "abc123def456.pdf", "annual_report_2024.pdf",
  "pdf", 5242880, "pending", NOW(),
  0, '{"year":"2024","department":"Finance"}'
);
```

**Result in DB:**

```
id                  42
workspace_id        1
filename            abc123def456.pdf (secure UUID name)
original_filename   annual_report_2024.pdf (user-friendly)
file_type           pdf
file_size           5242880 (bytes)
status              pending ⏳
chunk_count         0 (not processed yet)
page_count          0
image_count         0
table_count         0
error_message       NULL
custom_metadata     {"year":"2024","department":"Finance"}
created_at          2024-12-01 10:00:00
updated_at          2024-12-01 10:00:00
parser_version      NULL
processing_time_ms  0
markdown_content    NULL
```

**Files on Disk:**

```
backend/uploads/
├── abc123def456.pdf  ← Temporary location (will be processed)
└── (other files)
```

---

## 🟠 GIAI ĐOẠN 2: BACKGROUND JOB STARTED (2-5 giây)

### 2.1 Background Task Initiated

```python
# backend/app/api/documents.py

async def process_document_background(
    document_id: int,
    file_path: str,
    workspace_id: int
):
    """Background task to process document for RAG indexing."""

    # Create new DB session for this background task
    from app.core.database import async_session_maker

    async with async_session_maker() as db:
        try:
            # Step 2.1.1: Fetch Workspace Settings
            result = await db.execute(
                select(KnowledgeBase).where(KnowledgeBase.id == workspace_id)
            )
            kb = result.scalar_one_or_none()
            kg_language = kb.kg_language if kb else None
            kg_entity_types = kb.kg_entity_types if kb else None

            # Step 2.1.2: Get RAG Service
            from app.services.nexus_rag_service import NexusRAGService
            rag_service = NexusRAGService(
                db=db,
                workspace_id=workspace_id,
                kg_language=kg_language,
                kg_entity_types=kg_entity_types,
            )

            # Step 2.1.3: Process Document (Main Work)
            await rag_service.process_document(document_id, file_path)

        except Exception as e:
            logger.error(f"Failed to process document {document_id}: {e}")
            # Update document status to FAILED
            await db.execute(
                update(Document)
                .where(Document.id == document_id)
                .values(
                    status=DocumentStatus.FAILED,
                    error_message=str(e)[:500]
                )
            )
            await db.commit()
```

### 2.2 Update Document Status

```python
# Update: PENDING → PARSING
update_stmt = update(Document).where(
    Document.id == document_id
).values(status=DocumentStatus.PARSING)
await db.execute(update_stmt)
await db.commit()
```

**DB Update:**

```
status: PENDING ⏳ → PARSING 🔄
```

---

## 🟡 GIAI ĐOẠN 3: PARSING (Extract + Understand) (5-30 giây)

### 3.1 Docling Parsing

**Docling là gì?**

- Open-source document parser từ IBM
- Hỗ trợ: PDF, DOCX, PPTX, HTML, images
- Output: structured markdown + chunks + images + tables + OCR

### 3.2 Parsing Process

```python
# backend/app/services/nexus_rag_service.py

async def process_document(self, document_id: int, file_path: str) -> int:
    """Main document processing pipeline."""

    # Step 3.1: Fetch document from DB
    result = await self.db.execute(
        select(Document).where(Document.id == document_id)
    )
    document = result.scalar_one_or_none()

    # Step 3.2: Update status to PARSING
    document.status = DocumentStatus.PARSING
    await self.db.commit()

    # Step 3.3: Call Docling Parser (in thread pool)
    import asyncio
    parsed = await asyncio.to_thread(
        self.parser.parse,  # Docling parser
        file_path=file_path,
        document_id=document_id,
        original_filename=document.original_filename,
    )

    # parsed object contains:
    # - markdown: Full document as markdown
    # - page_count: Number of pages (IMPORTANT!)
    # - chunks: List of EnrichedChunk (for embedding)
    # - images: List of ExtractedImage
    # - tables: List of ExtractedTable
```

### 3.3 Docling Parser Details

```python
# backend/app/services/document_parser/docling_parser.py

def _parse_with_docling(
    self,
    file_path: Path,
    document_id: int,
    original_filename: str,
) -> ParsedDocument:
    """Parse with Docling for rich structural extraction."""

    # Step 3.3.1: Initialize Docling Converter
    pipeline_options = self._build_pipeline_options(
        enable_ocr=settings.NEXUSRAG_ENABLE_OCR
    )
    converter = DocumentConverter(
        format_options={
            "pdf": PdfFormatOption(pipeline_options=pipeline_options),
        }
    )

    # Step 3.3.2: Convert Document
    print(f"Docling converting: {file_path}")
    conv_result = converter.convert(str(file_path))
    doc = conv_result.document

    # Step 3.3.3: Extract Images
    print(f"Extracting images...")
    images, pic_url_list = self._extract_images_with_urls(doc, document_id)
    # Returns:
    # - images: List[ExtractedImage]
    #   Each image has: image_id, page_no, file_path, caption, width, height
    # - pic_url_list: URLs for markdown references

    # Step 3.3.4: Extract Tables
    print(f"Extracting tables...")
    tables = self._extract_tables(doc, document_id)
    # Returns: List[ExtractedTable]
    #   Each table has: table_id, page_no, content_markdown, caption, num_rows, num_cols

    # Step 3.3.5: Caption Tables (Optional - via LLM)
    if settings.NEXUSRAG_ENABLE_TABLE_CAPTIONING and tables:
        print(f"Captioning {len(tables)} tables...")
        self._caption_tables(tables)  # LLM generates summaries

    # Step 3.3.6: Export to Markdown
    print(f"Exporting to markdown...")
    markdown = self._export_markdown(doc)

    # Step 3.3.7: Post-Process: Inject Image References
    markdown = self._inject_image_references(markdown, pic_url_list)

    # Step 3.3.8: Post-Process: Inject Table Captions
    markdown = self._inject_table_captions(markdown, tables)

    # Step 3.3.9: Get Page Count (FROM DOCLING!)
    page_count = 0
    if hasattr(doc, "pages") and doc.pages:
        page_count = len(doc.pages)  # ← Cách biết số trang!

    print(f"Page count: {page_count}")

    # Step 3.3.10: Chunk Document (Semantic + Structural)
    chunks = self._chunk_document(doc, document_id, original_filename, images, tables)

    # Step 3.3.11: Return ParsedDocument
    return ParsedDocument(
        document_id=document_id,
        original_filename=original_filename,
        markdown=markdown,
        page_count=page_count,  # ← Số trang đây!
        chunks=chunks,
        images=images,  # ← Danh sách images
        tables=tables,  # ← Danh sách tables
        tables_count=len(tables),
    )
```

### 3.4 Extract Images (Image Handling)

```python
def _extract_images_with_urls(self, doc, document_id: int):
    """Extract images from Docling document."""

    images = []
    pic_url_list = []

    # Iterate through document pages
    if not hasattr(doc, "pages"):
        return images, pic_url_list

    for page_no, page in enumerate(doc.pages, start=1):
        # Each page can have pictures
        if not hasattr(page, "cells"):
            continue

        for cell in page.cells:
            for item in cell.items:
                # Check if item is a picture/image
                if hasattr(item, "image") and item.image:
                    # Step 3.4.1: Generate unique ID
                    image_id = str(uuid.uuid4())

                    # Step 3.4.2: Save image to disk
                    output_dir = settings.BASE_DIR / "data" / "docling" / f"kb_{document_id}"
                    output_dir.mkdir(parents=True, exist_ok=True)

                    img_path = output_dir / "images" / f"{image_id}.png"
                    img_path.parent.mkdir(exist_ok=True)

                    # Docling returns PIL Image
                    item.image.save(str(img_path), format="PNG")

                    # Step 3.4.3: Generate caption via Vision LLM
                    caption = ""
                    if settings.NEXUSRAG_ENABLE_IMAGE_CAPTIONING:
                        caption = self._caption_image(item.image)
                        # LLM returns: "Chart showing Q1-Q4 revenue trend, ..."

                    # Step 3.4.4: Create ExtractedImage object
                    extracted_img = ExtractedImage(
                        image_id=image_id,
                        page_no=page_no,  # ← Track which page!
                        file_path=str(img_path),
                        caption=caption,
                        width=item.image.width,
                        height=item.image.height,
                        mime_type="image/png",
                    )
                    images.append(extracted_img)

                    # Step 3.4.5: Generate markdown URL
                    url = f"/static/doc-images/kb_{document_id}/images/{image_id}.png"
                    pic_url_list.append(url)

    return images, pic_url_list
```

**Database: DocumentImage Table**

```sql
INSERT INTO document_images (
  document_id, image_id, page_no, file_path,
  caption, width, height, mime_type, created_at
) VALUES (
  42, "img_001", 5, "backend/data/docling/kb_1/images/img_001.png",
  "Chart showing Q1-Q4 revenue trend, +15% growth",
  800, 600, "image/png", NOW()
);
```

**Files on Disk:**

```
backend/data/docling/kb_1/images/
├── img_001.png  (size: 150KB)
├── img_002.png  (size: 200KB)
└── img_003.jpeg (size: 180KB)
```

### 3.5 Extract Tables (Table Handling)

```python
def _extract_tables(self, doc, document_id: int):
    """Extract tables from Docling document."""

    tables = []

    # Docling HybridChunker also identifies tables
    if not hasattr(doc, "pages"):
        return tables

    for page_no, page in enumerate(doc.pages, start=1):
        # Iterate through document blocks/items
        if hasattr(page, "children"):
            for element in page.children:
                # Check if element is a table
                if hasattr(element, "to_markdown"):
                    # It's likely a table
                    table_id = str(uuid.uuid4())

                    # Step 3.5.1: Convert table to markdown
                    table_markdown = element.to_markdown()
                    # Example: "| Region | Q1 | Q2 |\n|--------|----|----|"

                    # Step 3.5.2: Count rows and columns
                    # Simple parsing
                    lines = table_markdown.split("\n")
                    num_rows = len(lines) - 2  # Exclude header + separator

                    cells = lines[0].split("|")
                    num_cols = len([c for c in cells if c.strip()])

                    # Step 3.5.3: Generate caption via LLM (optional)
                    caption = ""
                    if settings.NEXUSRAG_ENABLE_TABLE_CAPTIONING:
                        caption = self._caption_table(table_markdown)
                        # LLM returns: "Revenue by region for Q1-Q4 2024"

                    # Step 3.5.4: Create ExtractedTable object
                    extracted_table = ExtractedTable(
                        table_id=table_id,
                        page_no=page_no,  # ← Track which page!
                        content_markdown=table_markdown,
                        caption=caption,
                        num_rows=num_rows,
                        num_cols=num_cols,
                    )
                    tables.append(extracted_table)

    return tables
```

**Database: DocumentTable Table**

```sql
INSERT INTO document_tables (
  document_id, table_id, page_no, content_markdown,
  caption, num_rows, num_cols, created_at
) VALUES (
  42, "tbl_001", 10,
  "| Region | Q1 | Q2 | Q3 | Q4 |\n|--------|----|----|----|----|
   | APAC | $50M | $60M | $70M | $80M |",
  "Revenue by region Q1-Q4 2024",
  4, 5, NOW()
);
```

### 3.6 Chunking (Semantic Split)

```python
def _chunk_document(self, doc, document_id: int, ...):
    """Chunk document using HybridChunker."""

    # Step 3.6.1: Initialize Docling HybridChunker
    from docling_core.transforms.chunker import HybridChunker

    chunker = HybridChunker(
        max_tokens=settings.NEXUSRAG_CHUNK_MAX_TOKENS,  # 512
        merge_peers=True,
    )

    # Step 3.6.2: Build page→images lookup
    page_images: dict[int, list[ExtractedImage]] = {}
    for img in images:
        page_images.setdefault(img.page_no, []).append(img)

    # Step 3.6.3: Build page→tables lookup
    page_tables: dict[int, list[ExtractedTable]] = {}
    for tbl in tables:
        page_tables.setdefault(tbl.page_no, []).append(tbl)

    # Step 3.6.4: Chunk with HybridChunker
    chunks = []
    assigned_images: set[str] = set()
    assigned_tables: set[str] = set()

    for i, chunk in enumerate(chunker.chunk(doc)):
        # Step 3.6.5: Extract metadata from chunk
        page_no = 0
        if hasattr(chunk, "meta") and chunk.meta:
            if hasattr(chunk.meta, "page"):
                page_no = chunk.meta.page or 0

        # Extract heading path
        heading_path = []
        if hasattr(chunk, "meta") and chunk.meta:
            if hasattr(chunk.meta, "headings") and chunk.meta.headings:
                heading_path = list(chunk.meta.headings)

        # Step 3.6.6: Get chunk text
        chunk_text = chunk.text if hasattr(chunk, "text") else str(chunk)

        # Step 3.6.7: Augment chunk with image/table captions
        contextualized = ""
        if heading_path:
            contextualized = " > ".join(heading_path) + ": "

        contextualized += chunk_text

        # Append image captions
        if page_no in page_images:
            for img in page_images[page_no]:
                if img.image_id not in assigned_images:
                    contextualized += f"\n[Image on page {page_no}]: {img.caption}"
                    assigned_images.add(img.image_id)

        # Append table captions
        if page_no in page_tables:
            for tbl in page_tables[page_no]:
                if tbl.table_id not in assigned_tables:
                    contextualized += f"\n[Table on page {page_no}]: {tbl.caption}"
                    assigned_tables.add(tbl.table_id)

        # Step 3.6.8: Create EnrichedChunk
        enriched_chunk = EnrichedChunk(
            content=contextualized,  # ← Augmented text
            chunk_index=i,
            page_no=page_no,
            heading_path=heading_path,
            source_file=document.original_filename,
            has_table=any(tbl.page_no == page_no for tbl in tables),
            has_code=False,
            image_refs=list(
                img.image_id for img in page_images.get(page_no, [])
            ),
            table_refs=list(
                tbl.table_id for tbl in page_tables.get(page_no, [])
            ),
        )
        chunks.append(enriched_chunk)

    return chunks
```

**Example Chunk:**

```python
EnrichedChunk(
    content="Financial Results > Revenue: Q1 revenue reached $100M,
             up 15% from Q4. Revenue by region distributed as follows.
             [Image on page 5]: Chart showing Q1-Q4 revenue trend
             [Table on page 5]: Revenue by region Q1-Q4",
    chunk_index=0,
    page_no=5,
    heading_path=["Financial Results", "Revenue"],
    source_file="annual_report_2024.pdf",
    has_table=True,
    has_code=False,
    image_refs=["img_001"],
    table_refs=["tbl_001"],
)
```

### 3.7 Deduplication

```python
# Step 3.7: Deduplicate chunks
parsed.chunks, dedup_stats = deduplicate_chunks(parsed.chunks)

# Result:
# Input: 100 chunks
# Output: 85 chunks (15 removed as duplicates/noise)
```

### 3.8 Save Markdown + Images + Tables to DB

```python
# Step 3.8.1: Save markdown content
document.markdown_content = parsed.markdown
document.page_count = parsed.page_count  # ← Page count!
document.table_count = len(parsed.tables)

await self.db.commit()

# Step 3.8.2: Clean old images (for re-processing)
await self.db.execute(
    delete(DocumentImage).where(DocumentImage.document_id == document_id)
)

# Step 3.8.3: Save images to DB
for img in parsed.images:
    db_image = DocumentImage(
        document_id=document_id,
        image_id=img.image_id,
        page_no=img.page_no,
        file_path=img.file_path,
        caption=img.caption,
        width=img.width,
        height=img.height,
        mime_type=img.mime_type,
    )
    self.db.add(db_image)

document.image_count = len(parsed.images)
await self.db.commit()

# Step 3.8.4: Save tables to DB
for tbl in parsed.tables:
    db_table = DocumentTable(
        document_id=document_id,
        table_id=tbl.table_id,
        page_no=tbl.page_no,
        content_markdown=tbl.content_markdown,
        caption=tbl.caption,
        num_rows=tbl.num_rows,
        num_cols=tbl.num_cols,
    )
    self.db.add(db_table)

await self.db.commit()
```

**Database State After Parsing:**

```
documents table:
  id: 42
  status: PARSING ↓ (about to become INDEXING)
  page_count: 50  ← TRACKED!
  image_count: 3  ← TRACKED!
  table_count: 2  ← TRACKED!
  markdown_content: "# Annual Report 2024\n...[full markdown]..."
  parser_version: "docling"

document_images table (3 rows):
  (img_001, page 5, caption: "Chart showing...")
  (img_002, page 8, caption: "Growth trend...")
  (img_003, page 12, caption: "Regional breakdown...")

document_tables table (2 rows):
  (tbl_001, page 10, "| Region | Q1 |...", caption: "Revenue by region")
  (tbl_002, page 15, "| Date | Amount |...", caption: "Monthly revenue")
```

---

## 🟢 GIAI ĐOẠN 4: INDEXING (Embedding + KG) (10-40 giây)

### 4.1 Update Status

```python
document.status = DocumentStatus.INDEXING
await self.db.commit()
```

### 4.2 Embedding (Vector Search Index)

```python
# Step 4.2.1: Embed all chunks
chunk_texts = [c.content for c in parsed.chunks]
embeddings = self.embedder.embed_texts(chunk_texts)
# Returns: List[List[float]] — 85 chunks × 1024-dim

# Step 4.2.2: Create ChromaDB IDs
ids = [
    f"doc_{document_id}_chunk_{i}"
    for i in range(len(parsed.chunks))
]
# Example: ["doc_42_chunk_0", "doc_42_chunk_1", ...]

# Step 4.2.3: Build metadata per chunk
metadatas = []
for c in parsed.chunks:
    meta = {
        "document_id": document_id,
        "chunk_index": c.chunk_index,
        "source": c.source_file,
        "file_type": document.file_type,
        "page_no": c.page_no,  # ← Page tracked!
        "heading_path": " > ".join(c.heading_path) if c.heading_path else "",
        "has_table": c.has_table,
        "has_code": c.has_code,
        "image_ids": "|".join(c.image_refs) if c.image_refs else "",
        "table_ids": "|".join(c.table_refs) if c.table_refs else "",
        "image_urls": "|".join([
            f"/static/doc-images/kb_{workspace_id}/images/{iid}.png"
            for iid in c.image_refs
        ]),
        # Custom metadata from upload
        **document.custom_metadata if document.custom_metadata else {}
    }
    metadatas.append(meta)

# Step 4.2.4: Add to ChromaDB
self.vector_store.add_documents(
    ids=ids,
    embeddings=embeddings,
    documents=chunk_texts,
    metadatas=metadatas,
)
```

**ChromaDB Collection (kb_1):**

```
Document:
  id: "doc_42_chunk_0"
  embedding: [0.23, -0.15, 0.89, ..., 0.05]  (1024-dim)
  document: "Financial Results > Revenue: Q1 revenue $100M..."
  metadata: {
    "document_id": 42,
    "chunk_index": 0,
    "page_no": 5,
    "heading_path": "Financial Results > Revenue",
    "has_table": true,
    "image_ids": "img_001",
    "image_urls": "/static/doc-images/kb_1/images/img_001.png",
    "year": "2024",  ← Custom metadata
    "department": "Finance"
  }

Document:
  id: "doc_42_chunk_1"
  embedding: [0.12, 0.45, -0.23, ..., 0.88]
  document: "Regional breakdown: APAC $50M..."
  metadata: { ... }

... (85 total documents)
```

### 4.3 Knowledge Graph Ingest (Optional)

```python
if self.kg_service and parsed.markdown:
    try:
        # Step 4.3.1: Ingest full markdown into KG
        await self.kg_service.ingest(parsed.markdown)

        # Inside KG ingest:
        # - LLM extracts entities: Person, Org, Location, Date, Metric
        # - LLM extracts relations: works_at, revenue, competes_with
        # - Build graph: nodes (entities) + edges (relations)
        # - Store in: data/lightrag/kb_1/

    except Exception as e:
        logger.error(f"KG ingest failed: {e}")
        # Continue without KG (not critical)
```

---

## 🟣 GIAI ĐOẠN 5: COMPLETE (Finalize)

### 5.1 Update Status

```python
# Step 5.1: Update document metadata
elapsed_ms = int((time.time() - start_time) * 1000)

document.status = DocumentStatus.INDEXED  # ✅ Complete
document.chunk_count = len(parsed.chunks)  # 85
document.processing_time_ms = elapsed_ms  # e.g., 32500ms
await self.db.commit()

logger.info(
    f"Processed document {document_id}: "
    f"{len(parsed.chunks)} chunks, "
    f"{len(parsed.images)} images, "
    f"{len(parsed.tables)} tables in {elapsed_ms}ms"
)
```

**Final Database State:**

```
documents:
  id: 42
  status: INDEXED ✅
  chunk_count: 85
  page_count: 50
  image_count: 3
  table_count: 2
  processing_time_ms: 32500
  markdown_content: "[full markdown]"

document_images: (3 rows)
document_tables: (2 rows)

Files on disk:
  backend/uploads/abc123def456.pdf ✓
  backend/data/docling/kb_1/images/ ✓
    - img_001.png
    - img_002.png
    - img_003.jpeg

ChromaDB kb_1: 85 vectors ✓
LightRAG kb_1/: KG graph ✓
```

### 5.2 User Can Now Query

```
User can now:
1. Query the document
2. See images in results
3. See tables in results
4. Know which page results came from
5. Get citations with page numbers
```

---

## 📊 ĐẠI LOẠI CÔNG NGHỆ DÙNG TRONG QUÁN TRÌNH

| Giai Đoạn         | Công Nghệ             | Tác Dụng                        | Cách Hiểu         |
| ----------------- | --------------------- | ------------------------------- | ----------------- |
| **Upload**        | FastAPI               | Nhận file, validate, save       | FormData          |
| **Persist**       | PostgreSQL            | Lưu metadata                    | SQLAlchemy ORM    |
| **Background**    | AsyncIO               | Async task                      | BackgroundTasks   |
| **Parsing**       | Docling               | Extract structure+images+tables | DocumentConverter |
| **OCR**           | Tesseract/RapidOCR    | Scan images text                | Pipeline options  |
| **Image Caption** | Gemini Vision/Ollama  | Generate descriptions           | Vision LLM        |
| **Table Caption** | Gemini/Ollama         | Generate summaries              | LLM (text)        |
| **Chunking**      | HybridChunker         | Semantic+structural split       | Docling built-in  |
| **Dedup**         | Hash+Similarity       | Remove duplicates               | Fingerprint       |
| **Embedding**     | sentence-transformers | 1024-dim vectors                | BAAI/bge-m3       |
| **Vector Store**  | ChromaDB              | Store embeddings                | HTTP client       |
| **KG**            | LightRAG              | Entity extraction               | NetworkX + LLM    |
| **File Storage**  | FileSystem            | Save images/markdown            | aiofiles          |

---

## 🔍 CÁC CÂU HỎI THƯỜNG GẶP

### Q1: Làm sao biết được số trang?

**A:** `doc.pages` từ Docling → `len(doc.pages)` → `page_count` field

```python
page_count = len(doc.pages)  # ← Docling attribute
document.page_count = page_count  # ← Save to DB
```

### Q2: Làm sao biết chunk nào ở trang nào?

**A:** Mỗi chunk có `page_no` → lưu trong chunk metadata

```python
page_no = chunk.meta.page  # ← From Docling
enriched_chunk.page_no = page_no
metadata['page_no'] = page_no  # ← In ChromaDB
```

### Q3: Làm sao có thể search ảnh?

**A:** Vision LLM caption images → gắn vào chunk text → embed chung

```python
caption = vision_llm(image)  # "Chart showing revenue..."
chunk.content += f"\n[Image]: {caption}"
embedding = embed(chunk.content)  # Includes caption!
```

### Q4: Làm sao biết bảng có bao nhiêu hàng/cột?

**A:** Parse markdown table → count rows/cols

```python
table_markdown = element.to_markdown()
num_rows = len([l for l in lines if l.startswith("|")])
num_cols = len(lines[0].split("|")) - 2
```

### Q5: Nếu OCR thất bại thì sao?

**A:** Docling fallback: nếu OCR fail with `enable_ocr=True`, retry với `enable_ocr=False`

```python
try:
    converter = self._get_converter(enable_ocr=True)
    result = converter.convert(file_path)
except:
    converter = self._get_converter(enable_ocr=False)
    result = converter.convert(file_path)  # Retry
```

### Q6: Custom metadata được lưu ở đâu?

**A:** PostgreSQL `documents.custom_metadata` (JSON) → ChromaDB metadata fields

```python
custom_metadata = {"year": "2024", "department": "Finance"}
document.custom_metadata = custom_metadata  # → DB

# Later in ChromaDB
metadata['year'] = "2024"
metadata['department'] = "Finance"
# Can filter: metadata_filter={"year": "2024"}
```

---

## ⏱️ TIMELINE (Tổng thời gian)

```
Upload API: 1-2s ✓ (instant to user)
    ↓ (background starts)
Parsing: 10-15s (Docling)
    ├─ Extract images: 2-3s (per image × N)
    ├─ Caption images: 2-3s per image (LLM)
    ├─ Caption tables: 1-2s total (LLM)
    └─ Chunking: 1s
    ↓
Embedding: 5-10s (batch processing)
    ↓
KG Ingest: 10-20s (LLM entity/relation extraction)
    ↓
Total: 30-60s (Depending on document size + LLM latency)
    ↓
Ready to Query ✅
```

---

## 📁 FILE LOCATIONS AFTER UPLOAD

```
ProjectRoot/
├── backend/
│   ├── uploads/
│   │   └── abc123def456.pdf  ← Original upload (temp)
│   │
│   └── data/
│       ├── docling/
│       │   └── kb_1/
│       │       ├── images/
│       │       │   ├── img_001.png
│       │       │   ├── img_002.png
│       │       │   └── img_003.jpeg
│       │       └── (parsed data cache)
│       │
│       └── lightrag/
│           └── kb_1/  ← Per-workspace KG
│               ├── graph.pickle
│               ├── entities_db.pkl
│               └── vector_db/
│
└── (PostgreSQL)
    └── documents, document_images, document_tables
        ChromaDB: kb_1 collection
        LightRAG: kb_1 workspace
```

---

**COMPLETE OVERVIEW READY!**
