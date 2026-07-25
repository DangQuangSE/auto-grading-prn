# Tech Stack

Tài liệu này liệt kê toàn bộ công nghệ/công cụ đang dùng trong dự án, tác dụng của từng cái, và nếu bỏ nó đi thì hệ thống sẽ phải làm gì thay thế (hoặc mất chức năng gì). Dự án là kiến trúc microservices: 5 backend service (.NET 8) + 1 API Gateway + 2 frontend app (React) + hạ tầng chạy qua Docker Compose.

---

## 1. Backend — Nền tảng & Framework

### .NET 8 / ASP.NET Core Minimal APIs
- **Dùng để làm gì:** runtime và framework viết toàn bộ 5 service (Identity, Catalog, Submission, Grading, Notification) và Gateway. Dùng Minimal API (`MapGet`, `MapPost`...) thay vì Controller truyền thống — mỗi service có 1 file `*Endpoints.cs` khai báo route.
- **Nếu không có:** phải chọn framework khác (Node/Express, Spring Boot, Django...) và viết lại 100% code backend. Vì toàn bộ domain logic, EF Core, JWT, DI đều gắn chặt vào ASP.NET Core, đây là công nghệ nền không thể bỏ mà không rewrite lại cả hệ thống.

### Entity Framework Core 8 (+ SQL Server provider)
- **Dùng để làm gì:** ORM — map các class C# (`Class`, `User`, `Rubric`, `Submission`...) sang bảng SQL Server, sinh migration (`dotnet ef migrations`), và là công cụ duy nhất mỗi service dùng để đọc/ghi database của riêng nó (mỗi service có DbContext + database riêng — pattern "database per service").
- **Nếu không có:** phải viết SQL thô + ADO.NET (SqlConnection/SqlCommand) tay cho mọi query, tự quản lý migration bằng script `.sql`, mất hết LINQ và change-tracking. Khối lượng code tăng đáng kể vì mọi endpoint hiện tại đều query qua `db.Xxx.Where(...)`.

### SQL Server 2022 (container `sqlserver`)
- **Dùng để làm gì:** database engine thật sự lưu dữ liệu — mỗi service có 1 database riêng (`AutoGrading.Identity`, `AutoGrading.Catalog`...) nhưng chung 1 SQL Server instance trong Docker.
- **Nếu không có:** phải đổi sang engine khác (PostgreSQL, MySQL...) — cần đổi cả connection string lẫn EF Core provider (`UseSqlServer` → `UseNpgsql`...), và một số cú pháp T-SQL đặc thù (nếu có) phải viết lại.

---

## 2. Giao tiếp giữa các service

### YARP (Yarp.ReverseProxy) — API Gateway
- **Dùng để làm gì:** `AutoGrading.Gateway` là cổng vào duy nhất cho frontend (`localhost:5500`). YARP định tuyến `/identity/*`, `/catalog/*`, `/submissions/*`, `/grading/*`, `/notifications/*` tới đúng service phía sau, đồng thời là nơi duy nhất áp policy xác thực JWT theo route (`AuthorizationPolicy: "authenticated"`).
- **Nếu không có:** frontend phải gọi thẳng vào từng service theo port riêng (`:5001`, `:5002`...), phải tự xử lý CORS ở từng service, và mất luôn điểm tập trung để áp auth policy — đây chính là nguyên nhân bug "Not Found" ở `/catalog/classes` vừa sửa (policy khai báo sai ở tầng Gateway).

### RabbitMQ (RabbitMQ.Client) + `IEventBus`/`RabbitMqEventBus`
- **Dùng để làm gì:** message broker chính cho giao tiếp bất đồng bộ giữa các service — ví dụ Catalog publish `ClassLecturerAssigned`, Grading publish `GradePublished`, và Identity subscribe để cập nhật cache nội bộ (`ClassLecturerCache`, `SubmissionStudent`...). Ưu tiên bất đồng bộ để tránh single-point-of-failure.
- **Ghi chú (2026-07-25):** Ngoài RabbitMQ, có một số gọi đồng bộ trực tiếp giữa services: Grading gọi Submission qua HTTP (`GET /submissions/{id}`), và gọi Catalog qua gRPC (3 methods: `GetAssignment`, `GetCriteriaForAssignment`, `GetLecturerStudentIds`). Những gọi này cần response ngay (không chờ bất đồng bộ) nên không thể qua RabbitMQ.
- **Nếu không có:** phải dùng toàn bộ gọi HTTP/gRPC đồng bộ giữa các service, tạo ra coupling chặt và single-point-of-failure. Toàn bộ kiến trúc "event-driven cache" ở Identity sẽ phải thiết kế lại.

### Hangfire (Hangfire.Core / AspNetCore / SqlServer)
- **Dùng để làm gì:** chạy background job — ví dụ Submission service tự extract nội dung file sau khi upload, Grading service tự chạy AI grading sau khi có artifact, Catalog service parse rubric Word file ở background. Job lưu trạng thái trong chính SQL Server (không cần Redis).
- **Nếu không có:** các tác vụ nặng (extract file, gọi AI) phải chạy đồng bộ ngay trong request HTTP → request bị treo lâu, hoặc phải tự viết queue thủ công (BackgroundService + Channel/Queue riêng), mất luôn dashboard theo dõi job và cơ chế retry có sẵn của Hangfire.

### MinIO (Minio SDK)
- **Dùng để làm gì:** object storage (tương thích S3 API) — nơi lưu file thật (Word rubric, file report/diagram sinh viên nộp). Database chỉ lưu `ObjectKey` (đường dẫn), file thật nằm trong MinIO.
- **Nếu không có:** phải lưu file trực tiếp vào ổ đĩa server (`wwwroot`/local filesystem) — mất khả năng scale ngang (nhiều instance cùng service không share được file), hoặc phải đổi sang AWS S3/Azure Blob thật (tốn phí, cần internet).

---

## 3. Authentication & Authorization

### JWT (Microsoft.AspNetCore.Authentication.JwtBearer)
- **Dùng để làm gì:** cấp và xác thực token sau khi login/register — Identity service ký token, Gateway + mọi service khác chỉ verify (không cần gọi lại Identity mỗi request nhờ shared signing key).
- **Nếu không có:** phải quay lại session-based auth (cookie + server-side session store), cần thêm Redis/sticky-session để share session giữa các service, không hợp với kiến trúc stateless hiện tại.

### Google.Apis.Auth + `@react-oauth/google` (frontend)
- **Dùng để làm gì:** cho phép đăng nhập bằng Google — backend verify ID token Google gửi lên (`Google.Apis.Auth`), frontend hiển thị nút "Continue with Google" (`@react-oauth/google`).
- **Nếu không có:** chỉ còn cách đăng nhập bằng email/password (`/auth/register`, `/auth/login`) — vẫn hoạt động bình thường vì đây là 2 luồng độc lập, chỉ mất tùy chọn Google.

---

## 4. Xử lý tài liệu & AI

### DocumentFormat.OpenXml
- **Dùng để làm gì:** đọc nội dung file `.docx` (rubric Word do giảng viên upload, báo cáo sinh viên nộp) để trích xuất text/bảng, phục vụ AI chấm điểm.
- **Nếu không có:** phải tự parse định dạng `.docx` (thực chất là file ZIP chứa XML) bằng tay hoặc dùng thư viện khác (ví dụ NPOI) — tốn công viết lại toàn bộ logic extract ở Submission/Catalog service.

### OpenRouter (`OpenRouterClient`, model mặc định `deepseek/deepseek-chat`)
- **Dùng để làm gì:** gọi LLM để (a) tự động trích xuất tiêu chí chấm điểm từ file rubric Word, (b) chấm điểm AI gợi ý cho bài nộp dựa trên rubric. OpenRouter là lớp trung gian gọi được nhiều model khác nhau qua 1 API key.
- **Nếu không có:** mất tính năng "AI gợi ý điểm" và "tự trích rubric từ Word" — giảng viên phải nhập tay toàn bộ tiêu chí và chấm điểm hoàn toàn thủ công. Có thể thay bằng gọi thẳng OpenAI/Anthropic API, nhưng phải đổi request/response shape trong `OpenRouterClient.cs`.

---

## 5. API Documentation

### Swashbuckle.AspNetCore (Swagger/OpenAPI)
- **Dùng để làm gì:** tự sinh trang `/swagger` cho từng service (chỉ bật khi `Environment.IsDevelopment()`) để xem/test API thủ công.
- **Nếu không có:** vẫn gọi API bình thường qua Postman/curl/frontend — chỉ mất giao diện tự động để khám phá API, không ảnh hưởng vận hành.

---

## 6. Frontend (2 app: `admin-web` port 5174, `user-web` port 5173)

### React 18 + Vite + TypeScript
- **Dùng để làm gì:** nền tảng dựng UI. Vite là dev server + build tool (nhanh hơn Create React App), TypeScript để có type-safety giữa FE và BE (khớp shape response API).
- **Nếu không có:** phải viết lại toàn bộ UI bằng framework khác (Vue/Angular) hoặc HTML/JS thuần — mất hết component, hooks, toàn bộ 2 app phải build lại từ đầu.

### @tanstack/react-query
- **Dùng để làm gì:** quản lý state cho dữ liệu lấy từ API (cache, refetch, loading/error state) — mọi hook trong `hooks/use*.ts` (`useClasses`, `useRosterUsers`, `useGradeTable`...) đều dùng `useQuery`/`useMutation` của thư viện này.
- **Nếu không có:** phải tự viết `useState` + `useEffect` + fetch thủ công cho từng trang, tự tay xử lý loading/error/cache/invalidate — code sẽ dài hơn nhiều và dễ bug (race condition khi fetch lại).

### react-router-dom
- **Dùng để làm gì:** điều hướng giữa các trang trong 1 app (SPA routing) — toàn bộ cấu trúc route nằm ở `routes/AppRoutes.tsx`, kèm `RequireAuth` (route guard) để chặn trang cần đăng nhập.
- **Nếu không có:** phải tự viết cơ chế switch trang bằng tay (show/hide component theo state), mất luôn URL-based navigation (không back/forward được bằng nút trình duyệt).

### zod
- **Dùng để làm gì:** validate dữ liệu ở frontend trước khi gửi lên server (ví dụ validate rubric criteria, submission metadata) — định nghĩa schema 1 lần, dùng để parse + báo lỗi rõ ràng.
- **Nếu không có:** phải viết validate tay bằng `if/else` rải rác khắp nơi, dễ thiếu sót và không có type inference tự động từ schema.

### xlsx (SheetJS)
- **Dùng để làm gì:** đọc/ghi file Excel ở trình duyệt, không cần backend — dùng để (a) preview vài dòng đầu khi admin upload file roster (Bulk Import), (b) xuất file `.xlsx` bảng điểm (Grade Export).
- **Nếu không có:** phải làm export ở backend (endpoint riêng sinh file Excel bằng thư viện .NET như ClosedXML rồi trả về blob) — tốn thêm 1 network round-trip, và mất khả năng preview file ngay trên trình duyệt trước khi upload.

### lucide-react
- **Dùng để làm gì:** thư viện icon (SVG) dùng khắp UI (nút Upload, Download, Trash...).
- **Nếu không có:** vẫn chạy bình thường, chỉ mất icon — có thể thay bằng thư viện icon khác hoặc emoji/text, không ảnh hưởng logic.

### CSS thuần (`styles.css`, không dùng Tailwind/CSS framework)
- **Dùng để làm gì:** toàn bộ style viết tay bằng class thường (`.page-grid`, `.form-panel`, `.table-panel`...), không qua framework CSS nào.
- **Nếu không có:** không áp dụng — đây là lựa chọn thiết kế (không phải phụ thuộc bên ngoài), muốn đổi sang Tailwind/Chakra/MUI thì phải viết lại toàn bộ class trong JSX.

---

## 7. Kiểm thử (Testing)

### xUnit + Microsoft.EntityFrameworkCore.InMemory (backend)
- **Dùng để làm gì:** unit/integration test cho các service .NET (`*.Api.Tests` projects) — dùng EF Core InMemory provider để test logic mà không cần SQL Server thật.
- **Nếu không có:** vẫn build và chạy được service bình thường, chỉ mất lưới an toàn tự động — mọi thay đổi phải test tay qua Postman/UI, dễ bug âm thầm khi refactor.

### Vitest + @testing-library/react (frontend — cả admin-web và user-web)
- **Dùng để làm gì:** unit/component test cho React (`*.test.tsx`) — giả lập DOM bằng `jsdom`, render component thật và assert hành vi (click, submit form, hiển thị lỗi...).
- **Nếu không có:** giống trên — vẫn chạy app bình thường, chỉ mất khả năng phát hiện regression tự động khi sửa code UI.

---

## 8. Hạ tầng chạy (Infrastructure)

### Docker + Docker Compose
- **Dùng để làm gì:** đóng gói và chạy toàn bộ hệ thống (9 container: 5 service + Gateway + SQL Server + RabbitMQ + MinIO, cộng 2 container FE tùy chọn) bằng 1 lệnh `docker compose up`, không cần cài .NET/SQL Server/RabbitMQ/MinIO thật lên máy.
- **Nếu không có:** phải tự cài đặt và cấu hình từng phần mềm (SQL Server, RabbitMQ, MinIO...) trực tiếp lên máy hoặc máy chủ, chạy từng service bằng `dotnet run` tay, khó đồng bộ môi trường dev giữa các máy khác nhau trong nhóm.

### Nginx (trong Dockerfile của `admin-web`/`user-web`)
- **Dùng để làm gì:** serve file tĩnh (HTML/JS/CSS) sau khi Vite build xong, khi chạy 2 app FE qua Docker (khác với `npm run dev` chạy Vite dev server trực tiếp).
- **Nếu không có:** vẫn dùng `npm run dev`/`vite preview` để chạy FE cục bộ — chỉ mất cách deploy FE dưới dạng container nhẹ, không ảnh hưởng lúc phát triển.

---

## Tổng quan nhanh (bảng)

| Nhóm | Công cụ | Vai trò chính |
|---|---|---|
| Runtime BE | .NET 8 / ASP.NET Core | Chạy 5 service + Gateway |
| ORM | EF Core 8 | Map C# ↔ SQL Server |
| Database | SQL Server 2022 | Lưu dữ liệu, mỗi service 1 DB riêng |
| Gateway | YARP | Cổng vào duy nhất, định tuyến + auth policy |
| Message broker | RabbitMQ | Giao tiếp bất đồng bộ giữa service |
| gRPC | Grpc.Tools + protobuf | Gọi đồng bộ Grading→Catalog (3 methods), HTTP/2 h2c |
| Background job | Hangfire | Extract file, AI grading chạy nền |
| Object storage | MinIO | Lưu file Word/report/diagram thật |
| Auth | JWT + Google OAuth | Đăng nhập email hoặc Google |
| Document parsing | DocumentFormat.OpenXml | Đọc file `.docx` |
| AI | OpenRouter (DeepSeek) | Trích rubric + gợi ý điểm |
| API docs | Swashbuckle/Swagger | Trang test API tự sinh (dev only) |
| FE framework | React 18 + Vite + TS | Dựng UI 2 app admin-web/user-web |
| FE data | TanStack Query | Fetch/cache API |
| FE routing | react-router-dom | Điều hướng SPA |
| FE validate | zod | Validate schema |
| FE Excel | xlsx (SheetJS) | Đọc/ghi Excel ngay trình duyệt |
| FE icon | lucide-react | Icon SVG |
| Test BE | xUnit + EF InMemory | Unit/integration test |
| Test FE | Vitest + Testing Library | Component test |
| Hạ tầng | Docker Compose | Chạy toàn bộ hệ thống 1 lệnh |
| FE serving | Nginx | Serve static build trong container |
