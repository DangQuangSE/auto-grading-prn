# Architecture Documentation — AutoGrading

> File này tổng hợp toàn bộ tech stack, cấu hình, và cách nối dây giữa các service trong dự án.
> Cập nhật lần cuối: 2026-07-25 (gRPC Grading↔Catalog integration)

---

## 1. Tổng quan

Hệ thống gồm **6 backend services (.NET 8)**, **2 frontends (React + Vite)**, **3 infrastructure containers**.

### Sơ đồ kiến trúc tổng thể

```
┌─────────────────────────────────────────────────────────────────┐
│                        Gateway (YARP :5500)                      │
│  Định tuyến: /identity/*, /catalog/*, /submissions/*, ...       │
│  Auth policy + Rate limiting + CORS tập trung                    │
└──┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────────────┘
   │      │      │      │      │      │      │      │
   ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼
┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐
│Iden ││Cata ││Subm ││Grad ││Notif││User ││Admin││     │
│:5001││:5002││:5003││:5004││:5005││:5173││:5174││     │
└─────┘└─────┘└─────┘└─────┘└─────┘└─────┘└─────┘└─────┘
   │      │      │      │                            ▲
   │      │      │      │                            │
   └──────┴──┬───┴──────┘                    HTTP direct
             │                              (Service JWT)
        ┌────▼────┐
        │ RabbitMQ│ ←─── Event Bus (pub/sub)
        └─────────┘
             │
   ┌─────────┼─────────┐
   ▼         ▼         ▼
┌──────┐┌────────┐┌─────────┐
│SQL   ││MinIO   ││OpenCode │
│Server││:9000   ││/OpenAI  │
└──────┘└────────┘└─────────┘
```

---

## 2. Backend Runtime

### 2.1 .NET / C#

| Thông số | Giá trị |
|-----------|--------|
| Framework | `net8.0` |
| Nullable | `enable` |
| ImplicitUsings | `enable` |
| API Style | Minimal APIs (`MapGroup`/`MapGet`/`MapPost`) |

### 2.2 Danh sách Projects

**6 Services + 1 Gateway + 1 Common + 1 Contracts + 3 Tests = 12 projects**

| Project | Path | Type |
|---------|------|------|
| `AutoGrading.Gateway` | `be/src/Gateway/AutoGrading.Gateway` | YARP Reverse Proxy |
| `AutoGrading.Identity.Api` | `be/src/Services/Identity/AutoGrading.Identity.Api` | Auth + Users |
| `AutoGrading.Catalog.Api` | `be/src/Services/Catalog/AutoGrading.Catalog.Api` | Subjects, Assignments, Rubrics |
| `AutoGrading.Submission.Api` | `be/src/Services/Submission/AutoGrading.Submission.Api` | File upload, parsing |
| `AutoGrading.Grading.Api` | `be/src/Services/Grading/AutoGrading.Grading.Api` | AI Grading, scores |
| `AutoGrading.Notification.Api` | `be/src/Services/Notification/AutoGrading.Notification.Api` | SignalR notifications |
| `AutoGrading.Common` | `be/src/BuildingBlocks/AutoGrading.Common` | Shared lib (EF, RabbitMQ, MinIO, JWT, OpenCode) |
| `AutoGrading.Contracts` | `be/src/BuildingBlocks/AutoGrading.Contracts` | Events, Enums, Pagination |
| `AutoGrading.Common.Tests` | `be/src/BuildingBlocks/AutoGrading.Common.Tests` | Tests |
| `AutoGrading.Grading.Api.Tests` | `be/src/Services/Grading/AutoGrading.Grading.Api.Tests` | Tests |
| `AutoGrading.Catalog.Api.Tests` | `be/src/Services/Catalog/AutoGrading.Catalog.Api.Tests` | Tests |

### 2.3 Ports

| Service | Dev HTTP | Dev HTTPS | Docker REST | Docker gRPC |
|---------|----------|-----------|-------------|------------|
| **Gateway** | `:5213` | `:7203` | `:5500` (exposed) → `:8080` | — |
| **Identity** | `:5265` | `:7259` | `:5001` (exposed) → `:8080` | — |
| **Catalog** | `:5029` | `:7234` | `:5002` (exposed) → `:8080` | `:5012` (exposed) → `:8081` |
| **Submission** | `:5226` | `:7194` | `:5003` (exposed) → `:8080` | — |
| **Grading** | `:5108` | `:7077` | `:5004` (exposed) → `:8080` | — |
| **Notification** | `:5280` | `:7039` | `:5005` (exposed) → `:8080` | — |
| **user-web** | `:5173` | — | `:80` → `:5173` (exposed) | — |
| **admin-web** | `:5174` | — | `:80` → `:5174` (exposed) | — |

Cấu hình: `Properties/launchSettings.json` mỗi service + `be/src/Gateway/AutoGrading.Gateway/appsettings.Docker.json`

**Ghi chú gRPC:** Catalog gRPC service (port 8081 internal / 5012 host) dùng HTTP/2 h2c (unencrypted, tin tưởng qua Docker network), chỉ cho internal service-to-service calls, không expose qua Gateway.

### 2.4 NuGet Packages chính

| Package | Version | Service(s) | Mục đích |
|---------|---------|-----------|----------|
| `Yarp.ReverseProxy` | 2.3.0 | Gateway | Reverse proxy |
| `RabbitMQ.Client` | 6.8.1 | Common → all | Event bus |
| `Microsoft.EntityFrameworkCore` | 8.0.10 | Common → all | ORM |
| `Microsoft.EntityFrameworkCore.SqlServer` | 8.0.10 | Common → all | SQL Server provider |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | 8.0.10 | Common → all | JWT auth |
| `Hangfire.AspNetCore` | 1.8.14 | Catalog, Submission, Grading | Background jobs |
| `Hangfire.SqlServer` | 1.8.14 | Catalog, Submission, Grading | Hangfire storage |
| `Minio` | 6.0.3 | Common → all | Object storage |
| `Swashbuckle.AspNetCore` | 6.6.2 | Mỗi Web service | OpenAPI/Swagger |
| `Google.Apis.Auth` | 1.75.0 | Identity | Google OAuth |
| `DocumentFormat.OpenXml` | 3.1.0 | Identity, Catalog, Submission | DOCX parsing |
| `Microsoft.AspNetCore.SignalR` | (built-in) | Notification | Real-time push |
| `Microsoft.AspNetCore.SignalR.Client` | 8.0.10 | User-web, admin-web | SignalR client (JS) |

---

## 3. Communication

### 3.1 YARP Gateway

**File:** `be/src/Gateway/AutoGrading.Gateway/Program.cs`

Gateway là điểm vào duy nhất cho frontend (`localhost:5500`). YARP định tuyến HTTP request dựa trên path prefix.

**Routes:**

| # | Route | Path | Cluster | Auth Policy | Transform |
|---|-------|------|---------|-------------|-----------|
| 1 | `identity-route` | `/identity/{**catch-all}` | `identity-cluster` | Rate limit 10/min | strip `/identity` |
| 2 | `catalog-classes-anonymous-route` | `GET /catalog/classes` | `catalog-cluster` | **Anonymous** | strip `/catalog` |
| 3 | `catalog-route` | `/catalog/{**catch-all}` | `catalog-cluster` | `authenticated` | strip `/catalog` |
| 4 | `submissions-route` | `/submissions/{**catch-all}` | `submission-cluster` | `authenticated` | strip `/submissions` |
| 5 | `grading-route` | `/grading/{**catch-all}` | `grading-cluster` | `authenticated` | strip `/grading` |
| 6 | `notifications-route` | `/notifications/{**catch-all}` | `notification-cluster` | `authenticated` | strip `/notifications` |

**Clusters:** (5 destinations)

| Cluster | Dev Address | Docker Address |
|---------|------------|----------------|
| `identity-cluster` | `http://localhost:5265` | `http://identity-api:8080` |
| `catalog-cluster` | `http://localhost:5029` | `http://catalog-api:8080` |
| `submission-cluster` | `http://localhost:5226` | `http://submission-api:8080` |
| `grading-cluster` | `http://localhost:5108` | `http://grading-api:8080` |
| `notification-cluster` | `http://localhost:5280` | `http://notification-api:8080` |

**CORS:** Cho phép `http://localhost:5173` (user-web) và `http://localhost:5174` (admin-web).

**Rate Limiting:** Global 100 req/min/IP; auth-strict 10 req/min/IP.

**Auth Policy:** `"authenticated"` = `RequireAuthenticatedUser()`. Định nghĩa 1 lần duy nhất ở Gateway.

### 3.2 RabbitMQ Event Bus

**File:** `be/src/BuildingBlocks/AutoGrading.Common/Messaging/RabbitMqEventBus.cs`

| Thuộc tính | Giá trị |
|-----------|--------|
| Exchange name | `autograding.events` |
| Exchange type | `Topic` |
| Queue pattern | `{ServiceName}.{EventName}` |
| Durable | `true` (cả exchange và queue) |
| Delivery | Persistent messages + manual ack (`BasicAck`) |

#### Event Table

| Event | Publisher | Consumer(s) | Queue(s) | Handler |
|-------|-----------|-------------|----------|---------|
| **UserRegistered** | Identity | Notification | `notification.UserRegistered` | `UserRegisteredConsumer` |
| **ClassLecturerAssigned** | Catalog | Identity | `identity.ClassLecturerAssigned` | `ClassLecturerAssignedHandler` |
| **SubmissionUploaded** | Submission | Identity, Submission | `identity.SubmissionUploaded`, `submission.SubmissionUploaded` | `SubmissionUploadedHandler` |
| **SubmissionStatusChanged** | Submission, Grading | Notification | `notification.SubmissionStatusChanged` | `SubmissionStatusChangedConsumer` |
| **ArtifactsExtracted** | Submission | Grading | `grading.ArtifactsExtracted` | `ArtifactsExtractedHandler` |
| **RubricParsed** | Catalog | Notification | `notification.RubricParsed` | `RubricParsedConsumer` |
| **RubricConfirmed** | Catalog | Grading | `grading.RubricConfirmed` | `RubricConfirmedHandler` |
| **AiGradingCompleted** | Grading | Notification | `notification.AiGradingCompleted` | `AiGradingCompletedConsumer` |
| **GradePublished** | Grading | Identity, Notification | `identity.GradePublished`, `notification.GradePublished` | `GradePublishedHandler` (Identity), `GradePublishedConsumer` (Notification) |

**Có bao nhiêu service dùng RabbitMQ?** Cả 5 backend service (Identity, Catalog, Submission, Grading, Notification) đều dùng. Gateway và Frontend không dùng.

**Cơ chế:** Service A publish event → RabbitMQ gửi đến queue của từng consumer → mỗi service consume độc lập (pub/sub fan-out). Queue được tạo và bind tại thời điểm `Subscribe<>()`.

### 3.3 Service-to-Service Communication (HTTP + gRPC)

**Service JWT:** Khác với User JWT, Service JWT có:
- `sub` = `Guid.Empty`
- `email` = `"{service}@internal.autograding"`
- `role` = `"service"`

**HTTP Service-to-Service calls** (REST):

| Source | → | API Endpoint | DTO trả về | Auth |
|--------|---|-------------|------------|------|
| **Grading** | → | `GET /submissions/{id}` | `SubmissionDto` + `ExtractedArtifactDto[]` (Content, ImagesJson) | Service JWT |
| **Submission** | → | `GET /assignments/{id}` | `AssignmentDto` (MaxAttempts) | Service JWT |

**gRPC Service-to-Service calls** (protobuf) — 2026-07-25 thêm:

| Source | → | gRPC Method | Proto | Auth |
|--------|---|-------------|-------|------|
| **Grading** | → **Catalog** | `GetAssignment` | `catalog.proto` | Service JWT (CallCredentials) |
| **Grading** | → **Catalog** | `GetCriteriaForAssignment` | `catalog.proto` | Service JWT (CallCredentials) |
| **Grading** | → **Catalog** | `GetLecturerStudentIds` | `catalog.proto` | Service JWT (CallCredentials) |

**Proto File:** `be/src/Services/Catalog/AutoGrading.Catalog.Api/Protos/catalog.proto` — referenced by cả Catalog.Api (server codegen) và Grading.Api (client codegen).

**Tổng quan DI Registration:**

| Source | Client | BaseUrl/Addr (dev) | Protocol | Handler |
|--------|--------|------------------|----------|---------|
| Grading | `ISubmissionApiClient` | `http://localhost:5226` | HTTP | `ServiceAuthHandler` (grading) |
| Grading | `ICatalogApiClient` | `http://localhost:5029` (gRPC: `:8081` internal) | **gRPC** | `CatalogGrpcAuthenticator` (interceptor) |
| Submission | `ICatalogApiClient` | `http://localhost:5002` | HTTP | `ServiceAuthHandler` (submission) |

### 3.4 External API — OpenCode / OpenRouter

| Service | Provider | BaseUrl | Model | Mục đích |
|---------|----------|---------|-------|----------|
| **Grading** | OpenCode Zen | `https://opencode.ai/zen/v1` | `mimo-v2.5-free` | Chấm điểm submission (vision) |
| **Catalog** | OpenRouter | `https://openrouter.ai/api/v1` | `deepseek/deepseek-chat` | Parse rubric DOCX → criteria |

Cả 2 gọi `POST {BaseUrl}/chat/completions` (OpenAI-compatible), với system prompt `"You are an assistant that returns strict JSON and nothing else."`. Retry 3 lần với exponential backoff.

---

## 4. Data Layer

### 4.1 Database-per-Service (SQL Server)

5 services, 5 databases riêng biệt, cùng 1 SQL Server instance (`localhost,1433`).

| Service | DB Name | DbContext File | DbSets |
|---------|---------|----------------|--------|
| **Identity** | `AutoGrading.Identity` | `IdentityDbContext.cs` | Users, ClassLecturerCaches, SubmissionStudents, SubmissionGraders |
| **Catalog** | `AutoGrading.Catalog` | `CatalogDbContext.cs` | Subjects, Assignments, Rubrics, RubricCriteria, Classes, StudentEnrollments |
| **Submission** | `AutoGrading.Submission` | `SubmissionDbContext.cs` | Submissions, ExtractedArtifacts |
| **Grading** | `AutoGrading.Grading` | `GradingDbContext.cs` | AiGradingRuns, AiCriterionScores, FinalGrades, GradePublications, GradePublishedOutbox, LocalRubrics, LocalRubricCriteria |
| **Notification** | `AutoGrading.Notification` | `NotificationDbContext.cs` | Notifications, AuditEvents |

**EF Core Migrations:** Tất cả 5 service đều dùng `app.MigrateDatabase<TContext>()` trong `Program.cs` → tự động chạy migration khi startup.

### 4.2 MinIO Object Storage

**File:** `be/src/BuildingBlocks/AutoGrading.Common/Storage/MinioStorage.cs`

**Có 2 service dùng MinIO:** Catalog và Submission.

| Config | Default value |
|--------|--------------|
| Endpoint | `localhost:9000` |
| AccessKey | `minioadmin` |
| SecretKey | `minioadmin` |
| Bucket | `autograding` |

**Key patterns:**
- `submissions/{guid}-{filename}` — file bài nộp (DOCX, DRAWIO)
- `rubrics/{guid}-{filename}` — file rubric (DOCX)

**File nào upload/download từ MinIO:**

| File | Service | Action |
|------|---------|--------|
| `SubmissionsEndpoints.cs` | Submission | Upload report + diagram |
| `ExtractionJob.cs` | Submission | Download → parse |
| `RubricsEndpoints.cs` | Catalog | Upload rubric, download file |
| `RubricParsingJob.cs` | Catalog | Download → parse |

### 4.3 Hangfire Background Jobs

**Có 3 service dùng Hangfire:** Catalog, Submission, Grading.

| Job | Service | File | Trigger | Mục đích |
|-----|---------|------|---------|----------|
| **ExtractionJob** | Submission | `Jobs/ExtractionJob.cs` | `SubmissionUploaded` event | Parse DOCX/Drawio → text + images |
| **AiGradingJob** | Grading | `Jobs/AiGradingJob.cs` | `ArtifactsExtracted` event | Gọi AI chấm điểm |
| **RubricParsingJob** | Catalog | `Jobs/RubricParsingJob.cs` | `POST /rubrics/upload` | Parse rubric DOCX → criteria |

**Dashboard:** `/hangfire` ở 3 service, dùng `AllowAllDashboardAuthorizationFilter` (không auth).

---

## 5. Authentication & Authorization

### 5.1 JWT Config

| Config | Dev value | Docker override |
|--------|-----------|----------------|
| Issuer | `AutoGrading.Identity` | `${JWT_ISSUER}` |
| Audience | `AutoGrading` | `${JWT_AUDIENCE}` |
| SigningKey | `CHANGE_ME_dev_...` | `${JWT_SIGNING_KEY}` |
| ExpiryMinutes | `60` | `${JWT_EXPIRY_MINUTES}` |

### 5.2 Two types of JWT

| Claim | User JWT | Service JWT |
|-------|----------|-------------|
| `sub` | Real user GUID | `Guid.Empty` |
| `email` | User email | `{service}@internal.autograding` |
| `role` | `student`/`lecturer`/`admin` | `service` |
| `jti` | Random GUID | Random GUID |
| Issuer | `AutoGrading.Identity` | `AutoGrading.Identity` |
| Audience | `AutoGrading` | `AutoGrading` |
| Expiry | 60 min | 60 min |

### 5.3 AppRole Enum

```csharp
public enum AppRole { Student, Lecturer, Admin, Service }
```

File: `be/src/BuildingBlocks/AutoGrading.Contracts/Enums/AppRole.cs`

---

## 6. Frontend

### 6.1 User Web (student-facing)

- **Port:** `:5173` (dev) / `:80` → `:5173` (Docker)
- **Frameworks:** React 18, react-router-dom 7, TanStack Query 5
- **Auth:** Google OAuth (`@react-oauth/google`), JWT (localStorage key: `auto-grading.session`)
- **API Base URL:** `http://localhost:5500` (Gateway)
- **Real-time:** SignalR (`@microsoft/signalr`)
- **Build:** Vite + TypeScript + Vitest

**Pages:** LoginPage, StudentProfilePage, StudentSubmissionPage, StudentResultPage

### 6.2 Admin Web (lecturer/admin-facing)

- **Port:** `:5174` (dev) / `:80` → `:5174` (Docker)
- **Frameworks:** React 18, react-router-dom 7, TanStack Query 5
- **Auth:** Google OAuth, JWT (localStorage key: `auto-grading-admin.session`)
- **API Base URL:** `http://localhost:5500` (Gateway)
- **Build:** Vite + TypeScript + Vitest
- **Extra:** `xlsx` (Excel export), `zod` (validation)

**Pages:** LoginPage, DashboardPage, AssignmentsPage, ClassManagementPage, RosterPage, SubjectsPage, RubricUploadPage, BulkImportPage, GradeExportPage, SubmissionReviewPage

---

## 7. Infrastructure (Docker)

### 7.1 Docker Compose

**File:** `docker-compose.yml` — **12 containers**, network `autograding-net`.

| # | Container | Image | Ports | Depends on |
|---|-----------|-------|-------|------------|
| 1 | **sqlserver** | `mcr.microsoft.com/mssql/server:2022-latest` | `1433:1433` | — |
| 2 | **rabbitmq** | `rabbitmq:3-management-alpine` | `5672:5672`, `15672:15672` | — |
| 3 | **redis** | `redis:7-alpine` | — | — |
| 4 | **minio** | `minio/minio` | `9000:9000`, `9001:9001` | — |
| 5 | **identity-api** | Dockerfile | `5001:8080` | sqlserver, rabbitmq |
| 6 | **catalog-api** | Dockerfile | `5002:8080`, `5012:8081` (gRPC) | sqlserver, rabbitmq, minio, redis |
| 7 | **submission-api** | Dockerfile | `5003:8080` | sqlserver, rabbitmq, minio, catalog |
| 8 | **grading-api** | Dockerfile | `5004:8080` | sqlserver, rabbitmq, catalog, submission |
| 9 | **notification-api** | Dockerfile | `5005:8080` | sqlserver, rabbitmq |
| 10 | **gateway** | Dockerfile | `5500:8080` | 5 backend APIs |
| 11 | **user-web** | Dockerfile (node + nginx) | `5173:80` | gateway |
| 12 | **admin-web** | Dockerfile (node + nginx) | `5174:80` | gateway |

**Lưu ý:** `catalog-api` healthcheck (lần cuối cập nhật 2026-07-25) giờ probes cả REST `/health` và gRPC health service (`grpc_health_probe -addr=localhost:8081`). `catalog-api` phụ thuộc Redis để cache gRPC lookup responses (30-min TTL, cache-aside pattern).

### 7.2 Dockerfiles

**Backend (.NET 8):** 3-stage build (base → build → publish → final), `mcr.microsoft.com/dotnet/aspnet:8.0` runtime.
**Frontend (React):** 2-stage build (node:20-alpine build → nginx:alpine serve).

⚠️ **Không có `.dockerignore`** — `COPY . .` copy toàn bộ repo context vào image (rủi ro bảo mật).

---

## 8. Full Wiring Diagram

### 8.1 Event Bus Connections

```
                    ┌──────────────────────┐
                    │     RabbitMQ          │
                    │  autograding.events    │
                    └──┬──┬──┬──┬──┬──┬────┘
          ┌────────────┘  │  │  │  │  └──────────────┐
          ▼               ▼  ▼  ▼  ▼                 ▼
    ┌─────────┐   ┌─────────┐   ┌────────┐   ┌────────────┐
    │Identity │   │Catalog  │   │Grading │   │Notification│
    │         │   │         │   │        │   │            │
    │ SUB:    │   │ PUB:    │   │ SUB:   │   │ SUB:       │
    │ •Class  │   │ •Rubric │   │ •Artif │   │ •UserRegis │
    │  Lectur │   │  Confir │   │  Extra │   │ •AiGradCom │
    │ •Submis │   │ •Rubric │   │ •Rubric│   │ •GradePub  │
    │ •Grade  │   │  Parsed │   │        │   │ •RubricPars│
    │         │   │ •Class  │   │ PUB:   │   │ •SubmStatus│
    │ PUB:    │   │  Lectur │   │ •AiGra │   │            │
    │ •UserRe │   │         │   │  Comp  │   │            │
    │  gister │   │         │   │ •Grade │   │            │
    │         │   │         │   │  Pub   │   │            │
    └─────────┘   └─────────┘   └────────┘   └────────────┘
```

### 8.2 Service-to-Service Connections (HTTP + gRPC)

```
HTTP (REST):
  Grading ──GET /submissions/{id}──→ Submission API
  Submission ──GET /assignments/{id}──→ Catalog API

gRPC (protobuf) — thêm 2026-07-25:
  Grading ──GetAssignment (RPC)──→ Catalog API (port 8081)
  Grading ──GetCriteriaForAssignment (RPC)──→ Catalog API (port 8081)
  Grading ──GetLecturerStudentIds (RPC)──→ Catalog API (port 8081)

External:
  Grading ──POST /chat/completions──→ OpenCode Zen (opencode.ai)
  Catalog ──POST /chat/completions──→ OpenRouter (openrouter.ai)
```

### 8.3 MinIO Connections

```
Submission API ──upload/download──→ MinIO bucket autograding
Catalog API ──upload/download──→ MinIO bucket autograding

Grading, Identity, Notification → KHÔNG dùng MinIO
```

### 8.4 Database Connections

```
Identity API ───── AutoGrading.Identity DB
Catalog API ────── AutoGrading.Catalog DB
Submission API ─── AutoGrading.Submission DB
Grading API ────── AutoGrading.Grading DB
Notification API ─ AutoGrading.Notification DB

Tất cả trên cùng SQL Server instance (localhost,1433)
```

---

## 9. Pipeline Flow

```
Student upload (.docx + .drawio)
    │
    ▼
Submission API → MinIO (file thô)
                → DB (ObjectKey, State=Uploaded)
                → RabbitMQ: SubmissionUploaded
    │
    ▼
ExtractionJob (Hangfire)
    → MinIO (download file)
    → DocxReportParser / DrawioDiagramParser
    → DB (ExtractedArtifact: Content + ImagesJson, State=Extracted)
    → RabbitMQ: ArtifactsExtracted
    │
    ▼
AiGradingJob (Hangfire)
    → HTTP: GET /submissions/{id} (lấy text + images)
    → HTTP: GET /rubrics?assignmentId= (lấy criteria)
    → POST OpenCode Zen /chat/completions (prompt + images)
    → DB (AiGradingRun + AiCriterionScore, State=Completed)
    → RabbitMQ: AiGradingCompleted
    │
    ▼
Lecturer review (admin-web)
    → POST /grades/{submissionId}/publish {finalScore}
    → DB (FinalGrade + GradePublication)
    → RabbitMQ: GradePublished
    │
    ▼
Student xem kết quả (user-web)
```

---

## 10. Tóm tắt Tech Stack

| Layer | Technology | Số service dùng | Config file |
|-------|-----------|----------------|-------------|
| **Runtime** | .NET 8 (C#) | 6 backend | `.csproj` (net8.0) |
| **API** | ASP.NET Core Minimal APIs | 5 service | `Endpoints/*.cs` |
| **Gateway** | YARP ReverseProxy 2.3.0 | 1 (Gateway) | `appsettings.json:ReverseProxy` |
| **Message Queue** | RabbitMQ (topic exchange) | 5 service | `appsettings.json:RabbitMq` |
| **ORM** | EF Core 8.0.10 | 5 service | `Data/*DbContext.cs` (Submission, Grading, Identity, Catalog: `Repository/*DbContext.cs`, per the ongoing layered-architecture rollout — only Notification remains on `Data/`) |
| **Database** | SQL Server 2022 | 5 DB riêng | `appsettings.json:ConnectionStrings` |
| **Caching** | Redis 7 | 1 service (Catalog) | `appsettings.json:Redis` |
| **Object Storage** | MinIO | 2 service (Catalog, Submission) | `appsettings.json:Minio` |
| **Background Jobs** | Hangfire 1.8.14 | 3 service (Catalog, Submission, Grading) | `Program.cs` |
| **Auth** | JWT Bearer + Google OAuth | 6 service | `appsettings.json:Jwt` |
| **AI Provider** | OpenCode Zen + OpenRouter | 2 service (Grading, Catalog) | `appsettings.json:OpenCode` |
| **Frontend** | React 18 + Vite + TanStack Query | 2 (user-web, admin-web) | `package.json`, `vite.config.ts` |
| **Real-time** | SignalR | 1 (Notification) | `Hubs/NotificationHub.cs` |
| **Container** | Docker Compose | 11 containers | `docker-compose.yml` |
| **CI** | Không có | — | — |
