# Biểu Đồ Upload Process Chi Tiết

## Diagram 1: 5 Giai Đoạn Overview

```mermaid
graph TD
    A["📤 GIAI ĐOẠN 1: Upload API<br/>POST /documents/upload/{ws_id}<br/>- Validate file<br/>- Save temp file<br/>- Create Document record<br/>- Status: PENDING"]

    B["🔄 GIAI ĐOẠN 2: Background Job<br/>process_document_background()<br/>- New DB session<br/>- Fetch workspace<br/>- Initialize NexusRAGService"]

    C["🟠 GIAI ĐOẠN 3: Parsing<br/>NexusRAGService.process_document()<br/>- Docling parsing<br/>- Extract images<br/>- Extract tables<br/>- Chunking<br/>- Status: PARSING→INDEXING"]

    D["💾 GIAI ĐOẠN 4: Indexing<br/>- Embed chunks (bge-m3)<br/>- Store in ChromaDB<br/>- Ingest KG (LightRAG)<br/>- Save to PostgreSQL"]

    E["✅ GIAI ĐOẠN 5: Complete<br/>- Update status: INDEXED<br/>- Save metrics<br/>- Ready to query"]

    A -->|Response: doc_id=42| B
    B -->|Async job| C
    C -->|Chunks ready| D
    D -->|Vectors + KG| E

    style A fill:#FFE4E1
    style B fill:#FFB6C1
    style C fill:#FFA07A
    style D fill:#90EE90
    style E fill:#98FB98
```

## Diagram 2: Database Schema — Upload After Each Phase

```mermaid
graph LR
    subgraph Phase1["PHASE 1: Upload"]
        P1A["📝 Document inserted<br/>status=PENDING<br/>chunk_count=0"]
    end

    subgraph Phase3["PHASE 3: Parsing"]
        P3A["📝 Document<br/>status=PARSING<br/>↓ INDEXING"]
        P3B["🖼️ DocumentImage<br/>×3 images<br/>page_no, caption"]
        P3C["📊 DocumentTable<br/>×2 tables<br/>num_rows, num_cols"]
        P3D["📄 markdown_content<br/>full markdown"]
        P3A -.->|relationships| P3B
        P3A -.->|relationships| P3C
        P3A -.->|text column| P3D
    end

    subgraph Phase4["PHASE 4: Indexing"]
        P4A["📝 Document<br/>status=INDEXING<br/>↓ INDEXED"]
        P4B["🔍 ChromaDB<br/>85 chunks<br/>1024-dim vectors"]
        P4C["📈 KG Graph<br/>entities+relations<br/>data/lightrag/kb_1"]
        P4D["📊 Metadata<br/>page_no, heading<br/>image_refs, table_refs"]
        P4A -.->|vectors| P4B
        P4A -.->|graph| P4C
        P4B -.->|metadata| P4D
    end

    subgraph Phase5["PHASE 5: Complete"]
        P5A["✅ Document<br/>status=INDEXED<br/>page_count=50<br/>image_count=3<br/>table_count=2<br/>chunk_count=85<br/>processing_time_ms=32500"]
    end

    Phase1 --> Phase3
    Phase3 --> Phase4
    Phase4 --> Phase5

    style Phase1 fill:#FFE4E1
    style Phase3 fill:#FFA07A
    style Phase4 fill:#90EE90
    style Phase5 fill:#98FB98
```

## Diagram 3: File Storage Architecture

```mermaid
graph TD
    Upload["📤 Upload<br/>annual_report_2024.pdf"]

    TempStore["📁 Temp Upload<br/>backend/uploads/<br/>abc123def456.pdf"]

    DocParse["🔍 Docling Parse<br/>Extract structure<br/>Extract images<br/>Extract tables<br/>Get page_count=50"]

    FileSystem["💾 Filesystem Storage"]

    subgraph Images["🖼️ Images"]
        Img1["data/docling/kb_1/images/<br/>img_001.png"]
        Img2["img_002.png"]
        Img3["img_003.jpeg"]
    end

    Database["🗄️ PostgreSQL Database"]

    subgraph DocRecord["📝 documents"]
        D1["id=42<br/>filename=abc123def456.pdf<br/>page_count=50<br/>image_count=3<br/>table_count=2<br/>chunk_count=85"]
    end

    subgraph ImgRecord["🖼️ document_images ×3"]
        I1["image_id=img_001<br/>page_no=5<br/>caption='Chart...'<br/>width=800, height=600"]
        I2["image_id=img_002<br/>page_no=8"]
        I3["image_id=img_003<br/>page_no=12"]
    end

    subgraph TblRecord["📊 document_tables ×2"]
        T1["table_id=tbl_001<br/>page_no=10<br/>num_rows=5, num_cols=4<br/>caption='Revenue by region'"]
        T2["table_id=tbl_002<br/>page_no=15"]
    end

    subgraph VectorStore["🔍 ChromaDB (kb_1)"]
        V1["doc_42_chunk_0<br/>embedding: [0.23, -0.15...]<br/>metadata: page=5, image_ids=img_001"]
        V2["doc_42_chunk_1"]
        V3["... 85 chunks total"]
    end

    Upload --> TempStore
    TempStore --> DocParse
    DocParse --> FileSystem
    DocParse --> Database

    FileSystem --> Images
    Images --> Img1
    Images --> Img2
    Images --> Img3

    Database --> DocRecord
    Database --> ImgRecord
    ImgRecord --> I1
    ImgRecord --> I2
    ImgRecord --> I3
    Database --> TblRecord
    TblRecord --> T1
    TblRecord --> T2

    DocParse --> VectorStore
    VectorStore --> V1
    VectorStore --> V2
    VectorStore --> V3

    style Upload fill:#E8F4F8
    style TempStore fill:#FFE4E1
    style DocParse fill:#FFA07A
    style FileSystem fill:#87CEEB
    style Database fill:#90EE90
    style VectorStore fill:#98FB98
```

## Diagram 4: Data Flow — From File to Query-Ready

```mermaid
graph LR
    File["📄 PDF<br/>5MB"]

    API["FastAPI<br/>upload_document()"]

    Validate["✓ Validate<br/>ext, size<br/>workspace"]

    SaveTemp["💾 Save Temp<br/>uploads/abc123.pdf"]

    CreateDB["🗄️ Create Record<br/>Document(status=PENDING)"]

    BGTask["🔄 Background Task<br/>process_document()"]

    Docling["🔍 Docling Parser<br/>DocumentConverter"]

    Extract["📊 Extract<br/>Images, Tables<br/>Markdown, Pages"]

    subgraph ExtractDetail["Extract Results"]
        Pages["Pages: 50"]
        Imgs["Images: 3<br/>with captions"]
        Tbls["Tables: 2<br/>with captions"]
    end

    SaveExtracted["💾 Save Extracted<br/>DB + Filesystem"]

    Chunk["🔗 Chunking<br/>HybridChunker<br/>→ 85 chunks"]

    Augment["➕ Augment<br/>+ image captions<br/>+ table captions<br/>+ heading path"]

    Embed["🔢 Embed<br/>bge-m3<br/>→ 1024-dim"]

    Vector["💾 Store Vectors<br/>ChromaDB<br/>kb_1 collection"]

    KG["📈 KG Ingest<br/>LightRAG<br/>Entity extraction"]

    Complete["✅ Complete<br/>Document.status<br/>= INDEXED"]

    Ready["🚀 Ready to Query!"]

    File --> API
    API --> Validate
    Validate --> SaveTemp
    SaveTemp --> CreateDB
    CreateDB -->|Response| BGTask

    BGTask --> Docling
    Docling --> Extract
    Extract --> ExtractDetail
    ExtractDetail --> Pages
    ExtractDetail --> Imgs
    ExtractDetail --> Tbls

    Extract --> SaveExtracted
    SaveExtracted -->|Document.page_count=50<br/>Document.image_count=3<br/>Document.table_count=2| Chunk

    Chunk --> Augment
    Augment --> Embed
    Embed --> Vector
    Extract --> KG

    Vector --> Complete
    KG --> Complete
    Complete --> Ready

    style File fill:#E8F4F8
    style API fill:#FFE4E1
    style BGTask fill:#FFA07A
    style Docling fill:#FFB6C1
    style ExtractDetail fill:#FFA500
    style Embed fill:#FFD700
    style Vector fill:#90EE90
    style KG fill:#90EE90
    style Complete fill:#98FB98
    style Ready fill:#00FF00
```

## Diagram 5: Database Operations — Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant FastAPI
    participant PostgreSQL
    participant Filesystem
    participant Docling
    participant ChromaDB
    participant LightRAG

    User->>FastAPI: POST /upload (file + metadata)
    FastAPI->>Filesystem: Save temp file
    FastAPI->>PostgreSQL: INSERT documents (status=PENDING)
    FastAPI-->>User: Response: doc_id=42

    Note over FastAPI: Background task started

    FastAPI->>PostgreSQL: UPDATE documents SET status=PARSING

    FastAPI->>Docling: parse(file_path)
    Docling->>Docling: Extract images (PIL)
    Docling->>Docling: Vision LLM: caption images
    Docling->>Filesystem: Save images to data/docling/kb_1/images/

    Docling->>Docling: Extract tables (Markdown)
    Docling->>Docling: LLM: caption tables

    Docling->>Docling: HybridChunk: 100→85 chunks
    Docling->>Docling: Dedup + augment chunks

    FastAPI->>PostgreSQL: DELETE old document_images
    loop For each image
        FastAPI->>PostgreSQL: INSERT document_images
    end

    loop For each table
        FastAPI->>PostgreSQL: INSERT document_tables
    end

    FastAPI->>PostgreSQL: UPDATE documents SET<br/>page_count=50,<br/>image_count=3,<br/>table_count=2,<br/>markdown_content='...'

    FastAPI->>PostgreSQL: UPDATE documents SET status=INDEXING

    loop For each chunk
        FastAPI->>ChromaDB: add_documents(id, embedding, metadata)
    end

    FastAPI->>LightRAG: ingest(markdown)
    LightRAG->>LightRAG: LLM: extract entities+relations
    LightRAG->>Filesystem: Save graph (data/lightrag/kb_1/)

    FastAPI->>PostgreSQL: UPDATE documents SET<br/>status=INDEXED,<br/>chunk_count=85,<br/>processing_time_ms=32500

    Note over PostgreSQL,ChromaDB: ✅ Ready to query!
```

## Diagram 6: Docling Parsing — Detail

```mermaid
graph TD
    File["📄 Input File<br/>annual_report_2024.pdf"]

    DC["🔍 DocumentConverter<br/>Docling initialization"]

    Convert["🔄 Convert<br/>conv_result = converter.convert(file)"]

    Doc["📋 Docling Document<br/>doc = conv_result.document"]

    subgraph DocProps["Document Properties"]
        Pages["doc.pages<br/>→ page_count=50"]
        Children["doc.children<br/>→ blocks"]
        Meta["doc.metadata"]
    end

    Iterate["🔁 Iterate doc.pages"]

    subgraph PageContent["Per Page:"]
        Pic["Pictures/Images<br/>→ PIL Image"]
        Txt["Text blocks<br/>→ Markdown"]
        Tbl["Tables<br/>→ Markdown"]
        Heading["Headings<br/>→ hierarchy"]
    end

    VisionLLM["👁️ Vision LLM<br/>Gemini/Ollama<br/>caption_image()"]

    TextLLM["🔤 LLM<br/>caption_table()"]

    Extract["✅ Extract:<br/>- Images: 3<br/>- Tables: 2<br/>- page_count: 50"]

    Export["📝 Export Markdown<br/>doc.export_to_markdown()"]

    InjectRefs["➕ Inject references<br/>- Image URLs<br/>- Table captions"]

    Chunk["🔗 Chunking<br/>HybridChunker<br/>max_tokens=512"]

    Result["📦 ParsedDocument"]

    File --> DC
    DC --> Convert
    Convert --> Doc
    Doc --> DocProps

    Pages -.->|len(doc.pages)| Iterate
    Children -.->|iterate| Iterate

    Iterate --> PageContent
    PageContent --> Pic
    PageContent --> Txt
    PageContent --> Tbl
    PageContent --> Heading

    Pic --> VisionLLM
    VisionLLM -->|"[Image]: Chart showing..."| Extract

    Tbl --> TextLLM
    TextLLM -->|"[Table]: Revenue summary"| Extract

    Extract --> Export
    Export --> InjectRefs
    InjectRefs --> Chunk
    Chunk --> Result

    Result -->|markdown<br/>chunks<br/>images<br/>tables<br/>page_count| RES["ParsedDocument object"]

    style File fill:#E8F4F8
    style DC fill:#FFB6C1
    style DocProps fill:#FFA500
    style VisionLLM fill:#FFD700
    style TextLLM fill:#FFD700
    style Extract fill:#90EE90
    style Result fill:#98FB98
```

## Diagram 7: Chunk Augmentation — How Images/Tables Stay With Chunks

```mermaid
graph TD
    Chunk["🔗 Raw Chunk<br/>page_no=5<br/>heading=[Financial, Revenue]<br/>text='Q1 revenue $100M...'"]

    BuildLookup["🔨 Build Lookups<br/>page_images: {5: [img_001]}<br/>page_tables: {5: [tbl_001]}"]

    FindImages["🔍 Find Images on Page 5<br/>→ img_001 from DocumentImage"]
    GetCaption["📜 Get Caption<br/>→ 'Chart showing revenue trend'"]

    FindTables["🔍 Find Tables on Page 5<br/>→ tbl_001 from DocumentTable"]
    GetTableCaption["📜 Get Table Caption<br/>→ 'Revenue by region'"]

    Augment["➕ Augment Chunk Text"]

    Final["✅ Enriched Chunk<br/>content='Financial > Revenue: Q1 $100M<br/>[Image p5]: Chart showing...<br/>[Table p5]: Revenue by region'<br/><br/>image_refs=['img_001']<br/>table_refs=['tbl_001']<br/>page_no=5<br/>heading_path=['Financial','Revenue']"]

    Embed["🔢 Embed (all together)<br/>bge-m3: 1024-dim"]

    ChromaDB["💾 ChromaDB<br/>id='doc_42_chunk_0'<br/>metadata={<br/>  page_no: 5,<br/>  image_ids: 'img_001',<br/>  table_ids: 'tbl_001',<br/>  image_urls: '/static/...img_001.png'<br/>}"]

    Query["🔍 User Query<br/>'revenue by region'"]

    Retrieve["📊 Retrieved Chunk<br/>- Text + image caption + table caption<br/>- Can fetch actual image from URL<br/>- Can fetch table from database"]

    Chunk --> BuildLookup
    BuildLookup --> FindImages
    BuildLookup --> FindTables

    FindImages --> GetCaption
    FindTables --> GetTableCaption

    GetCaption --> Augment
    GetTableCaption --> Augment

    Augment --> Final
    Final --> Embed
    Embed --> ChromaDB

    Query -.->|cosine similarity| ChromaDB
    ChromaDB -.->|matched chunk| Retrieve

    style Chunk fill:#FFE4E1
    style BuildLookup fill:#FFB6C1
    style Final fill:#FFA07A
    style Embed fill:#FFD700
    style ChromaDB fill:#90EE90
    style Retrieve fill:#98FB98
```

## Diagram 8: Timeline — Processing Durations

```mermaid
gantt
    title Document Upload Processing Timeline

    section Upload
    API Receive:api1, 0, 1s
    File Validation:api2, 1s, 1s
    File Save:api3, 2s, 0s
    DB Record Insert:api4, 2s, 1s
    Response to User:crit, api5, 3s, 0s

    section Background (Async)
    Background Job Starts:bg1, 4s, 1s
    Docling Parse:parse1, 5s, 8s
    Extract Images:parse2, 5s, 5s
    Image Captioning (LLM):parse3, 10s, 4s
    Extract Tables:parse2, 5s, 3s
    Table Captioning (LLM):parse4, 8s, 3s
    Chunking:chunk1, 13s, 1s
    Deduplication:chunk2, 14s, 1s
    DB Save:db1, 15s, 2s

    section Indexing
    Embedding (bge-m3):embed1, 17s, 5s
    ChromaDB Store:vec1, 22s, 2s
    KG Ingest:kg1, 17s, 10s
    Final DB Update:db2, 27s, 1s
    Complete:crit, end1, 28s, 0s

    section State
    PENDING:state1, 0s, 3s
    PARSING:state2, 3s, 15s
    INDEXING:state3, 18s, 10s
    INDEXED:crit, state4, 28s, 2s
    Ready to Query:state5, 30s, 1s
```

## Diagram 9: Custom Metadata Flow

```mermaid
graph LR
    User["👤 User Upload<br/>custom_metadata=[<br/>  {key: 'year', value: '2024'},<br/>  {key: 'dept', value: 'Finance'}<br/>]"]

    Parse["🔍 Parse JSON<br/>→ Dict<br/>{<br/>  'year': '2024',<br/>  'dept': 'Finance'<br/>}"]

    DBStore["💾 PostgreSQL<br/>Document.custom_metadata<br/>(JSON type)"]

    ChromaMeta["🔍 ChromaDB Metadata<br/>metadata={<br/>  ...,<br/>  'year': '2024',<br/>  'dept': 'Finance'<br/>}"]

    Query["🔍 User Query<br/>where: {year: '2024'}"]

    Filter["🔎 Metadata Filter<br/>WHERE year='2024'<br/>→ 50 matching chunks<br/>(only from 2024 docs)"]

    Result["📊 Results<br/>Filtered by custom_metadata"]

    User --> Parse
    Parse --> DBStore
    DBStore --> ChromaMeta
    ChromaMeta --> Filter
    Query --> Filter
    Filter --> Result

    style User fill:#E8F4F8
    style Parse fill:#FFB6C1
    style DBStore fill:#90EE90
    style ChromaMeta fill:#90EE90
    style Filter fill:#FFD700
    style Result fill:#98FB98
```
