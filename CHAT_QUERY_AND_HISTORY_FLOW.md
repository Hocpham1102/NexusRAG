# Luồng Truy Vấn, Lưu Lịch Sử, Và Dùng History Cũ Trong NexusRAG

Tài liệu này giải thích chi tiết điều gì xảy ra từ lúc người dùng gửi một câu hỏi cho đến lúc hệ thống trả lời, đồng thời làm rõ cách NexusRAG lưu lịch sử chat và tận dụng lịch sử cũ trong các lần hỏi tiếp theo.

---

## 1) Tổng Quan Luồng

Khi người dùng gửi một câu hỏi, hệ thống đi qua 6 bước lớn:

1. Nhận request chat từ frontend.
2. Lấy các chunk liên quan từ workspace bằng retrieval.
3. Ghép context từ chunk, citation, ảnh, và knowledge graph.
4. Ghép thêm lịch sử chat gần nhất để giữ ngữ cảnh hội thoại.
5. Gọi LLM để sinh câu trả lời.
6. Lưu cả user message và assistant message vào PostgreSQL.

Điểm quan trọng nhất là:
- Retrieval lấy dữ liệu từ tài liệu đã index.
- History cũ không tự “mọc lên” từ DB trong lúc chat; frontend phải gửi history lên trong request.
- DB history chủ yếu dùng để lưu lại cuộc trò chuyện và nạp lại khi mở lại workspace.

---

## 2) Request Chat Đi Vào Đâu?

Endpoint chính của chat là:
- `backend/app/api/rag.py:866` — `chat_with_documents()`
- `backend/app/api/rag.py:853` — `chat_stream()`

Schema request là:
- `backend/app/schemas/rag.py:171` — `ChatRequest`

Trong request có các field quan trọng:
- `message`: câu hỏi hiện tại.
- `history`: lịch sử hội thoại do client gửi lên.
- `document_ids`: nếu muốn giới hạn vào một hoặc vài file cụ thể.
- `enable_thinking`: bật/tắt thinking.
- `force_search`: buộc đi tìm trước khi trả lời.
- `rag_mode`: `rag` hoặc `graphrag`.

Nói ngắn gọn: request chat không chỉ chứa câu hỏi hiện tại, mà còn có thể chứa lịch sử và filter file, để backend tạo context phù hợp hơn.

---

## 3) Bước 1: Kiểm Tra Workspace Và Chuẩn Bị Service

Trong `chat_with_documents()` hệ thống trước hết kiểm tra workspace tồn tại:
- `backend/app/api/rag.py:866`
- `backend/app/api/rag.py:89` — `verify_workspace_access()` được dùng để xác nhận knowledge base.

Sau đó backend lấy service xử lý RAG:
- `get_rag_service(db, workspace_id)`

Nếu workspace đang dùng NexusRAG, service thật sự là `NexusRAGService`. Khi đó hệ thống sẽ đi qua `query_deep()` để làm retrieval nâng cao.

---

## 4) Bước 2: Lấy Chunk Liên Quan Từ Tài Liệu

Khi là NexusRAG, code gọi:
- `backend/app/api/rag.py:883` đến `backend/app/api/rag.py:898`

Cụ thể:
- `rag_service.query_deep(...)`
- `question=request.message`
- `top_k=8`
- `document_ids=request.document_ids`
- `mode="hybrid"`
- `include_images=False`

Điều này có nghĩa:
- Nếu bạn truyền `document_ids`, hệ thống chỉ tìm trong những file đó.
- Nếu không truyền, hệ thống search trên toàn bộ collection của workspace.

Kết quả trả về gồm:
- `chunks`
- `citations`
- `knowledge_graph_summary`

Các citation này là thứ giúp hệ thống biết chunk nào đến từ file nào, trang nào.

---

## 5) Bước 3: Hệ Thống Dựng Context Từ Chunk

Sau khi có chunks, backend tạo danh sách nguồn hiển thị cho LLM.

Ở `chat_with_documents()`:
- `backend/app/api/rag.py:883` trở đi

Mỗi chunk được gán một mã nguồn ngắn dạng 4 ký tự như `a3x9`, `b2m7` để LLM dễ cite. Sau đó hệ thống dựng một khối context theo cấu trúc:

- `Source [XXXX] (filename, page, heading): content`

Đây là điểm rất quan trọng vì nó biến output retrieval thành prompt có cấu trúc rõ ràng.

Ngoài text, hệ thống còn làm thêm:
- Tìm ảnh liên quan từ `DocumentImage` theo `image_refs` hoặc theo `(document_id, page_no)`.
- Chuyển ảnh thành `ChatImageRef`.
- Đưa caption ảnh vào context text.

---

## 6) Bước 4: Dùng History Cũ Như Thế Nào?

Đây là phần quan trọng nhất nếu bạn hỏi “dựa vào lịch sử cũ thế nào?”.

### 6.1 Lịch sử cũ từ request.history

Backend không tự đọc toàn bộ lịch sử từ DB để nhét vào prompt. Thay vào đó, frontend gửi lịch sử hiện có trong `request.history`.

Trong code:
- `backend/app/api/rag.py:866`
- `backend/app/api/rag.py:930` trở đi

Backend chỉ lấy:
- tối đa 10 message gần nhất cho prompt.
- và đặc biệt chỉ lấy `last_exchange = request.history[-2:]` để tóm tắt cặp hỏi-đáp gần nhất.

Điều này có nghĩa:
- History cũ được dùng theo kiểu “context ngắn gọn”, không phải đổ toàn bộ hội thoại vào mỗi lần hỏi.
- Câu hỏi hiện tại vẫn là trọng tâm chính.

### 6.2 History cũ được nhét vào đâu?

Backend chèn thêm block:
- `CONVERSATION CONTEXT (previous exchange)`

Nó lấy 2 message cuối cùng:
- user nói gì
- assistant vừa trả lời gì

Mục tiêu là để LLM hiểu câu hỏi hiện tại đang nối tiếp mạch nào.

### 6.3 Lịch sử trong DB dùng để làm gì?

Lịch sử được lưu ở PostgreSQL trong bảng `chat_messages`:
- `backend/app/models/chat_message.py:14`

Khi mở lại workspace, frontend có thể gọi:
- `backend/app/api/rag.py:755` — `get_chat_history()`

Endpoint này đọc toàn bộ message của workspace từ DB, trả về:
- `backend/app/schemas/rag.py:236` — `ChatHistoryResponse`

Nghĩa là:
- DB history dùng cho persistence, reload, audit, và hiển thị lại cuộc trò chuyện.
- Request history dùng cho prompt hiện tại.

---

## 7) Bước 5: Tạo Prompt Gửi Cho LLM

Sau khi có retrieval context và history context, backend tạo prompt cuối cùng.

### 7.1 System prompt

System prompt được lấy từ:
- `kb.system_prompt` nếu workspace có cấu hình riêng
- hoặc `DEFAULT_SYSTEM_PROMPT`
- cộng thêm `HARD_SYSTEM_PROMPT`

### 7.2 User message

User message cuối cùng được xây theo thứ tự:
1. Document sources
2. Image references
3. IMPORTANT rules
4. Conversation context gần nhất
5. Câu hỏi hiện tại

Mục tiêu của thứ tự này là:
- cho LLM đọc nguồn trước,
- đọc luật trả lời sau,
- rồi mới đến câu hỏi.

Với local models, cách này đặc biệt quan trọng vì prompt dài dễ làm model quên phần đầu nếu sắp xếp không hợp lý.

### 7.3 Gọi LLM

Backend gọi:
- `provider.acomplete(...)`

Đây là chỗ sinh ra câu trả lời cuối cùng.

Nếu có bật thinking, `thinking_text` cũng được nhận lại và lưu.

---

## 8) Bước 6: Hệ Thống Tạo Câu Trả Lời Như Thế Nào?

Kết quả LLM không được trả ra “trần trụi”. Hệ thống còn xử lý thêm:

- Làm sạch artifact như `<unused778>:`.
- Trích entity liên quan từ KG nếu có summary.
- Chuẩn hóa lại sources, image refs, và thinking.

Sau đó response trả về cho frontend có các phần chính:
- `answer`
- `sources`
- `related_entities`
- `kg_summary`
- `image_refs`
- `thinking`

Schema response là:
- `backend/app/schemas/rag.py:180` — `ChatResponse`

---

## 9) Bước 7: Lưu Lịch Sử Chat Vào DB

Sau khi LLM trả lời, backend lưu best-effort vào bảng `chat_messages`.

### 9.1 Lưu user message

Tạo một dòng với:
- `role = "user"`
- `content = request.message`
- `message_id = uuid`

### 9.2 Lưu assistant message

Tạo một dòng khác với:
- `role = "assistant"`
- `content = answer`
- `sources = list nguồn`
- `related_entities = entities liên quan`
- `image_refs = danh sách ảnh`
- `thinking = nội dung thinking nếu có`

### 9.3 Commit

Nếu lưu thành công:
- `await db.commit()`

Nếu lỗi:
- hệ thống rollback và chỉ log warning, không làm hỏng câu trả lời đã trả cho user.

Model DB là:
- `backend/app/models/chat_message.py:14`

Field đáng chú ý:
- `workspace_id`
- `message_id`
- `role`
- `content`
- `sources`
- `related_entities`
- `image_refs`
- `thinking`
- `ratings`
- `agent_steps`
- `created_at`

---

## 10) Lịch Sử Được Đọc Lại Như Thế Nào?

Khi cần xem lịch sử chat của một workspace, frontend hoặc client gọi:
- `GET /chat/{workspace_id}/history`

Hàm xử lý là:
- `backend/app/api/rag.py:755`

Nó đọc toàn bộ `ChatMessage` theo `workspace_id`, sắp xếp theo thời gian tăng dần, rồi trả về list message.

Điều này giúp:
- mở lại cuộc trò chuyện,
- tiếp tục hỏi theo ngữ cảnh cũ,
- hiển thị lại nguồn đã dùng trong các câu trả lời trước.

---

## 11) Nếu Có 2 File Thì Hệ Thống Làm Gì?

Khi có nhiều file trong cùng workspace, hệ thống vẫn hoạt động theo nguyên tắc:

- Retrieval search trên workspace.
- Nếu không lọc, chunk từ nhiều file có thể cùng vào context.
- Citation và `document_id` giúp biết chunk thuộc file nào.
- Nếu muốn chỉ hỏi một file, truyền `document_ids` trong `ChatRequest`.

Vì vậy, lịch sử hội thoại không “tự chọn file”; chính retrieval + document filter mới quyết định file nào được dùng làm nguồn.

---

## 12) Tóm Tắt Ngắn

Luồng thực tế của NexusRAG là:

1. User gửi câu hỏi + history + optional document_ids.
2. Backend tìm chunk liên quan trong tài liệu.
3. Backend ghép context từ nguồn, ảnh, KG, và history gần nhất.
4. Backend gọi LLM để sinh câu trả lời grounded.
5. Backend lưu user/assistant messages vào `chat_messages`.
6. Lần sau có thể đọc lại lịch sử từ DB hoặc gửi history cũ lên prompt.

Điểm mấu chốt là:
- `request.history` = history ngắn để prompt hiểu ngữ cảnh hiện tại.
- `chat_messages` = history bền vững trong DB.
- `document_ids` = cách khóa phạm vi vào file cụ thể.
- `query_deep()` = nơi quyết định tài liệu nào được trích ra làm nguồn.

---

## 13) Các File Code Nên Xem

- [backend/app/api/rag.py](backend/app/api/rag.py#L866)
- [backend/app/api/rag.py](backend/app/api/rag.py#L755)
- [backend/app/models/chat_message.py](backend/app/models/chat_message.py#L14)
- [backend/app/schemas/rag.py](backend/app/schemas/rag.py#L171)
- [backend/app/schemas/rag.py](backend/app/schemas/rag.py#L236)
- [backend/app/services/nexus_rag_service.py](backend/app/services/nexus_rag_service.py#L87)
- [backend/app/services/deep_retriever.py](backend/app/services/deep_retriever.py#L61)

---

## 14) Kết Luận

NexusRAG không chỉ trả lời câu hỏi bằng vector search đơn thuần. Nó làm 3 việc cùng lúc:

- tìm nguồn đúng trong tài liệu,
- dùng history cũ để giữ mạch hội thoại,
- lưu lại toàn bộ cuộc chat để dùng về sau.

Nếu bạn muốn, bước tiếp theo tôi có thể viết thêm một file riêng chỉ tập trung vào:
- “chat endpoint hoạt động từng dòng code như thế nào”, hoặc
- “làm sao prompt được ghép để LLM không quên nguồn và history”.
