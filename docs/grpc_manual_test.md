# Manual Test — Catalog gRPC Endpoint

Mục tiêu: hướng dẫn test thủ công endpoint gRPC của Catalog (port riêng, độc lập với REST),
dùng để verify sau khi deploy/thay đổi, hoặc demo trực tiếp yêu cầu gRPC của assignment (§2.4).
Đây là bổ sung cho `docs/testing-happy-path.md` (happy-path REST qua Gateway) — tài liệu này chỉ
tập trung vào gRPC, gọi **trực tiếp Catalog, không qua Gateway** (đúng scope: gRPC là internal-only).

Liên quan: `plans/catalog-grading-grpc/plan.md`, `plans/catalog-grading-grpc/spec.md`,
`be/src/Services/Catalog/AutoGrading.Catalog.Api/Protos/catalog.proto`.

---

## 1. Chuẩn bị

```bash
docker compose up -d --build
docker compose ps   # catalog-api phải "healthy"
```

| | Container port | Host port | Protocol |
| --- | --- | --- | --- |
| Catalog REST | 8080 | 5002 | HTTP/1.1 |
| Catalog gRPC | 8081 | 5012 | HTTP/2 (h2c, không TLS) |

gRPC service: `catalog.Catalog` (3 RPC: `GetAssignment`, `GetCriteriaForAssignment`,
`GetLecturerStudentIds`) + `grpc.health.v1.Health` + server reflection — tất cả nghe trên 5012.

Cần cài `grpcurl` cho các bước không cần token. Cho các bước cần JWT hợp lệ, dùng project
console C# mẫu ở mục 3 (không có cách nào mint JWT hợp lệ chỉ bằng `grpcurl` vì signing key
nằm trong code/`.env`, không expose ra ngoài).

---

## 2. Kiểm tra nhanh bằng `grpcurl` (không cần JWT)

### 2.1. List service (xác nhận reflection hoạt động, endpoint tồn tại độc lập)

```bash
grpcurl -plaintext localhost:5012 list
```

Kỳ vọng thấy cả 3:
```
catalog.Catalog
grpc.health.v1.Health
grpc.reflection.v1alpha.ServerReflection
```

```bash
grpcurl -plaintext localhost:5012 list catalog.Catalog
```

Kỳ vọng thấy đúng 3 RPC: `GetAssignment`, `GetCriteriaForAssignment`, `GetLecturerStudentIds`.

### 2.2. Health check

```bash
grpcurl -plaintext localhost:5012 grpc.health.v1.Health/Check
```

Kỳ vọng: `{"status": "SERVING"}`.

Hoặc dùng script có sẵn (cũng tự fallback sang chạy `grpc_health_probe` trong container nếu máy
host không có binary):

```bash
scripts/verify-catalog-grpc.sh
```

### 2.3. Gọi RPC **không có token** → phải bị từ chối

```bash
grpcurl -plaintext -d '{"assignment_id": "00000000-0000-0000-0000-000000000000"}' \
  localhost:5012 catalog.Catalog/GetAssignment
```

Kỳ vọng: lỗi `Unauthenticated`, không phải `NotFound` hay `OK` — nếu RPC trả về bất kỳ thứ gì
khác `Unauthenticated`, auth đang bị bypass, đây là regression nghiêm trọng (FR-06 trong
`spec.md`).

### 2.4. Gọi RPC với token rác → phải bị từ chối

```bash
grpcurl -plaintext -H "Authorization: Bearer this.is.not-a-valid-jwt" \
  -d '{"assignment_id": "00000000-0000-0000-0000-000000000000"}' \
  localhost:5012 catalog.Catalog/GetAssignment
```

Kỳ vọng: vẫn `Unauthenticated` (JWT invalid signature/format bị middleware bearer-auth reject
trước khi vào `[Authorize]`).

---

## 3. Test đầy đủ với JWT hợp lệ (console client)

`grpcurl` không tự mint JWT hợp lệ được vì cần ký bằng `Jwt:SigningKey` (đọc từ `.env` biến
`JWT_SIGNING_KEY`, xem `docker-compose.yml`). Dùng project console tối giản dưới đây — tái sử
dụng `JwtTokenGenerator` thật của repo (`AutoGrading.Common.Auth`) để không tự chế lại logic ký
token.

### 3.1. Tạo project

```bash
mkdir -p /tmp/grpc-manual-test && cd /tmp/grpc-manual-test
dotnet new console
```

`grpc-manual-test.csproj` — thêm reference tới `AutoGrading.Common` (chứa `JwtTokenGenerator`)
và tới project Catalog (chứa client gRPC generated từ `catalog.proto`), cùng version gRPC pin
theo repo (`2.63.0`, khớp `Grpc.AspNetCore`/`Grpc.Net.Client` trong 2 service thật):

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Grpc.Net.Client" Version="2.63.0" />
    <PackageReference Include="Google.Protobuf" Version="3.24.0" />
    <PackageReference Include="Grpc.Tools" Version="2.63.0" PrivateAssets="All" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="/absolute/path/to/be/src/BuildingBlocks/AutoGrading.Common/AutoGrading.Common.csproj" />
    <Protobuf Include="/absolute/path/to/be/src/Services/Catalog/AutoGrading.Catalog.Api/Protos/catalog.proto" GrpcServices="Client" />
  </ItemGroup>
</Project>
```

Chỉnh 2 đường dẫn tuyệt đối cho khớp máy bạn.

### 3.2. `Program.cs`

```csharp
using AutoGrading.Common.Auth;
using AutoGrading.Contracts.Enums;
using Grpc.Core;
using Grpc.Net.Client;
using Microsoft.Extensions.Options;
using CatalogGrpcClient = AutoGrading.Catalog.Api.Grpc.Catalog.CatalogClient;
using AutoGrading.Catalog.Api.Grpc;

AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);

var tokenGenerator = new JwtTokenGenerator(Options.Create(new JwtOptions
{
    Issuer = "AutoGrading.Identity",
    Audience = "AutoGrading",
    SigningKey = Environment.GetEnvironmentVariable("JWT_SIGNING_KEY")
        ?? throw new InvalidOperationException("set JWT_SIGNING_KEY (copy the value from .env)"),
}));

using var channel = GrpcChannel.ForAddress("http://localhost:5012");
var client = new CatalogGrpcClient(channel);

Metadata WithServiceToken(string callingService = "grading")
{
    var token = tokenGenerator.GenerateServiceToken(callingService);
    return new Metadata { { "Authorization", $"Bearer {token}" } };
}

// --- GetAssignment (token hợp lệ, GUID không tồn tại -> phải NotFound, KHÔNG phải Unauthenticated) ---
try
{
    var reply = await client.GetAssignmentAsync(
        new GetAssignmentRequest { AssignmentId = Guid.NewGuid().ToString() },
        headers: WithServiceToken());
    Console.WriteLine($"UNEXPECTED: got a reply for a random GUID: {reply}");
}
catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
{
    Console.WriteLine("GetAssignment: OK (auth passed, NotFound for random GUID as expected)");
}

// --- GetLecturerStudentIds: role gate. Dùng GenerateToken trực tiếp để kiểm soát role claim
// thật (GenerateServiceToken luôn gắn role "service", không dùng được để test role khác). ---
foreach (var role in Enum.GetValues<AppRole>())
{
    var tokenForRole = tokenGenerator.GenerateToken(Guid.NewGuid(), $"{role}@test.local", role);
    var md = new Metadata { { "Authorization", $"Bearer {tokenForRole}" } };
    try
    {
        await client.GetLecturerStudentIdsAsync(
            new GetLecturerStudentIdsRequest { SubjectId = Guid.NewGuid().ToString() },
            headers: md);
        Console.WriteLine($"[{role}] ALLOWED");
    }
    catch (RpcException ex) when (ex.StatusCode is StatusCode.PermissionDenied or StatusCode.Unauthenticated)
    {
        Console.WriteLine($"[{role}] REJECTED: {ex.StatusCode}");
    }
}
```

Kỳ vọng: `Student` → `PermissionDenied`, `Admin` → `PermissionDenied` (endpoint này chỉ cho
`lecturer`/`service`, admin không có ngoại lệ ở gRPC layer — khác với REST layer nơi nhiều
endpoint khác cho phép admin bypass, xem `LecturerEnrollmentEndpoints.cs`), `Lecturer` → allowed
(nhưng trả về danh sách rỗng vì `subjectId` là GUID ngẫu nhiên không có enrollment), `Service` →
allowed.

### 3.3. Chạy

```bash
export JWT_SIGNING_KEY="$(grep '^JWT_SIGNING_KEY=' /path/to/.env | cut -d= -f2-)"
dotnet run
```

---

## 4. Bảng kịch bản test tổng hợp

| # | Kịch bản | Cách gọi | Kỳ vọng |
| --- | --- | --- | --- |
| 1 | Không token | `grpcurl` (mục 2.3) | `Unauthenticated` |
| 2 | Token rác/sai định dạng | `grpcurl -H` (mục 2.4) | `Unauthenticated` |
| 3 | Token hợp lệ, GUID không tồn tại | console client (mục 3.2) | `NotFound` (auth pass, business logic reject) |
| 4 | Token hợp lệ, GUID tồn tại | console client, đổi GUID thành assignment thật (lấy từ REST `GET /catalog/assignments`) | `OK`, dữ liệu khớp với REST response cho cùng assignment |
| 5 | `GetLecturerStudentIds`, role `student`/`admin` | console client (mục 3.2, vòng `foreach`) | `PermissionDenied` — chỉ `lecturer`/`service` được phép |
| 6 | `GetCriteriaForAssignment`, rubric ở trạng thái `Draft`, caller không phải chủ sở hữu | dùng GUID của một assignment có rubric `Draft` do lecturer khác tạo | `criteria` rỗng (không lộ rubric chưa confirm) — parity với REST `GET /catalog/rubrics` |
| 7 | Health check | `grpcurl grpc.health.v1.Health/Check` (mục 2.2) | `SERVING` |
| 8 | Container health khi gRPC listener chết | `scripts/verify-catalog-grpc.sh --expect-grpc-down` sau khi cố tình phá gRPC (xem ghi chú Phase 2 trong `plan.md`) | `docker compose ps` chuyển `unhealthy` |

Kịch bản 3–6 chính là 4 vùng rủi ro được `code-reviewer` xác nhận đã fix thật (không chỉ đúng về
mặt code mà có test tự động tương ứng trong `AutoGrading.Catalog.Api.Tests`) — mục đích của bảng
này là cho phép verify lại bằng tay, độc lập với bộ test tự động, khi cần demo hoặc debug.

---

## 5. Troubleshooting

- **`UNAVAILABLE: Connection refused`** — `catalog-api` chưa healthy, hoặc port 5012 chưa map
  (`docker compose ps` để check), hoặc gọi nhầm port 5002 (REST) thay vì 5012 (gRPC).
- **Exception `Http2UnencryptedSupport` / HTTP/1.1 vs HTTP/2 mismatch** — thiếu dòng
  `AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true)`
  trước khi tạo `GrpcChannel` (bắt buộc với .NET client gọi h2c cleartext, xem mục 3.2).
- **`grpcurl` báo lỗi TLS handshake** — thiếu cờ `-plaintext` (endpoint này cố ý không dùng TLS,
  chỉ chấp nhận trong Docker-internal network, xem `spec.md` mục Out of Scope).
- **Token hợp lệ nhưng vẫn `Unauthenticated`** — kiểm tra `JWT_SIGNING_KEY` dùng để mint token có
  khớp với `Jwt__SigningKey` mà `catalog-api` container đang chạy không (cả hai đọc từ cùng biến
  `.env`, nhưng dễ lệch nếu bạn hardcode key khác trong script test).
