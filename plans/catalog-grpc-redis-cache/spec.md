# Spec: Redis caching cho gRPC lookup của Catalog

**Date:** 2026-07-25
**Status:** Draft

---

## Problem Statement
Mỗi lần Grading chấm bài, nó gọi gRPC `GetAssignment` và `GetCriteriaForAssignment` sang Catalog, tạo query DB lặp lại cho dữ liệu gần như bất biến (assignment/criteria hiếm khi đổi sau khi tạo). Thêm Redis cache ở server-side (Catalog) giảm tải DB và là bonus feature theo mục 8 của đề bài — không phải yêu cầu bắt buộc (mục 2, 4).

---

## User Stories

- **[P1]** Là gRPC client (Grading service), tôi muốn `GetAssignment` trả kết quả từ cache khi có sẵn, để giảm độ trễ và tải DB của Catalog.
  Accepted when: gọi `GetAssignment` 2 lần liên tiếp với cùng `assignmentId` → lần 2 không phát sinh query DB (verify qua log/metric).

- **[P1]** Là gRPC client (Grading service), tôi muốn `GetCriteriaForAssignment` trả kết quả từ cache khi có sẵn, để giảm độ trễ và tải DB của Catalog.
  Accepted when: gọi `GetCriteriaForAssignment` 2 lần liên tiếp với cùng `assignmentId` → lần 2 không phát sinh query DB.

- **[P1]** Là Catalog service, khi assignment hoặc rubric/criteria bị cập nhật, cache tương ứng phải bị xóa ngay lập tức, để Grading không đọc dữ liệu cũ.
  Accepted when: update một assignment/rubric qua REST endpoint hiện có → gọi lại gRPC ngay sau đó trả về dữ liệu mới (không phải bản cache cũ).

- **[P2]** Là dev, tôi muốn cache có TTL an toàn (fallback) bên cạnh invalidation chủ động, để tránh cache treo vĩnh viễn nếu một write path bỏ sót invalidation.
  Accepted when: cache entry tự hết hạn sau TTL cấu hình được, ngay cả khi không có invalidation nào xảy ra.

- **[P3]** _(out of scope)_ Cache các RPC khác (`GetLecturerStudentIds`) hoặc các REST endpoint khác của Catalog.

---

## Functional Requirements

1. FR-01: Cache kết quả `GetAssignment` trong `CatalogGrpcService` ([CatalogGrpcService.cs](be/src/Services/Catalog/AutoGrading.Catalog.Api/Grpc/CatalogGrpcService.cs)), key theo `assignmentId`.
2. FR-02: Cache kết quả `GetCriteriaForAssignment` trong cùng service, key theo `assignmentId`.
3. FR-03: Invalidate (xóa key liên quan) ngay tại tầng repository sau khi `SaveChangesAsync` thành công — `AssignmentRepository.CreateAsync`/`UpdateAsync` ([AssignmentRepository.cs](be/src/Services/Catalog/AutoGrading.Catalog.Api/Repository/AssignmentRepository.cs)) và `RubricRepository.CreateAsync`/`UpdateAsync`/`UpdateCriteriaAsync` ([RubricRepository.cs](be/src/Services/Catalog/AutoGrading.Catalog.Api/Repository/RubricRepository.cs)). Invalidate ở tầng repository (không phải endpoint) để bao phủ luôn `RubricParsingJob`, vốn ghi criteria qua `UpdateCriteriaAsync` sau khi AI parsing xong.
4. FR-04: Redis được thêm như một service mới trong `docker-compose.yml`, chỉ Catalog kết nối tới nó cho phần cache này.
5. FR-05: Cache miss hoặc Redis unavailable phải fallback về đọc DB trực tiếp (không làm gRPC call fail vì lỗi cache). Lỗi khi invalidate (Redis không phản hồi lúc `RemoveAsync` sau write) phải bị nuốt (log + tiếp tục), không được làm fail transaction ghi DB đã thành công — quan trọng vì `RubricParsingJob` là background job, không nên retry/fail chỉ vì cache lỗi.
6. FR-06: Thêm `[Authorize(Roles = "service")]` vào `GetCriteriaForAssignment` trong `CatalogGrpcService` ([CatalogGrpcService.cs:34](be/src/Services/Catalog/AutoGrading.Catalog.Api/Grpc/CatalogGrpcService.cs#L34)) trước khi cache — hiện method này chỉ có `[Authorize]` ở class-level (bất kỳ ai có JWT hợp lệ), trong khi kết quả phụ thuộc `caller.GetUserId()`/`IsInRole("admin")` (rubric draft chỉ hiển thị cho admin/owner qua `RubricRepository.ListAsync`). Cache key theo `assignmentId` một mình an toàn CHỈ KHI caller identity cố định (Grading gọi qua service token — xác nhận tại [CatalogApiClient.cs](be/src/Services/Grading/AutoGrading.Grading.Api/Clients/CatalogApiClient.cs) + `Program.cs:48` dùng `CatalogGrpcAuthenticator.AttachServiceToken`, không forward JWT người dùng gốc). Khóa method lại bằng role `service` loại bỏ khả năng một caller khác (identity khác) đọc nhầm cache của service.

---

## Non-Functional Requirements

- Performance: cache hit loại bỏ hoàn toàn round-trip DB cho `GetAssignment`/`GetCriteriaForAssignment`.
- Availability: Redis down không được làm gRPC service down — fallback DB bắt buộc (FR-05).
- Security: không cache dữ liệu nhạy cảm ngoài phạm vi assignment/criteria đã public qua gRPC hiện tại.

---

## Success Criteria

- [ ] Cache hit rate quan sát được qua log (ví dụ log "cache hit"/"cache miss") khi demo gọi lặp lại cùng assignmentId.
- [ ] Sau khi update rubric/criteria, lần gọi gRPC kế tiếp trả dữ liệu mới, không phải bản cache cũ.
- [ ] Redis service khởi động thành công cùng `docker-compose up`, Catalog kết nối được.

---

## Out of Scope

- Cache client-side ở Grading (đã cân nhắc, không chọn — xem [brainstorm report](../reports/260725-catalog-grpc-redis-cache-brainstorm.md)).
- Cache `GetLecturerStudentIds` hoặc bất kỳ REST endpoint nào khác.
- Dùng Redis làm message broker (yêu cầu 2.3 đã được đáp ứng bằng RabbitMQ).

---

## Assumptions

- Catalog là nơi duy nhất ghi dữ liệu assignment/criteria (không có service khác ghi trực tiếp vào DB Catalog), nên invalidate tại Catalog là đủ chính xác.
- Redis chạy local/single-instance trong Docker Compose, không cần cluster/HA cho scope bonus này.
- `assignmentId` là key duy nhất đủ để phân biệt cache entry cho cả hai RPC — đúng cho `GetAssignment` (không lọc theo caller). Đúng cho `GetCriteriaForAssignment` chỉ vì caller luôn là service token cố định của Grading (không forward JWT người dùng) — xem FR-06.

---

## Resolved (during /ck:plan Step 0)

- TTL fallback: 30 phút.
- Write paths cần invalidate: `AssignmentRepository.CreateAsync`/`UpdateAsync`, `RubricRepository.CreateAsync`/`UpdateAsync`/`UpdateCriteriaAsync`/`ConfirmAsync`/`UnlockAsync`. Invalidate ở tầng repository bao phủ luôn `RubricParsingJob` (ghi qua `UpdateCriteriaAsync`). `ConfirmAsync`/`UnlockAsync` bắt buộc phải invalidate vì chúng đổi `Rubric.Status` — chính field mà `RubricRepository.ListAsync` lọc theo cho caller non-admin (service token của Grading luôn non-admin), nên confirm/unlock đổi hẳn việc criteria có hiển thị hay không, không chỉ đổi nội dung. `ClassRepository` không ghi assignment/rubric nên không liên quan. (Phát hiện bởi plan-reviewer, xem [plan.md](plan.md) Risks.)
- Client library: theo pattern DI có sẵn của `AutoGrading.Common` (`IEventBus`/`IObjectStorage` — interface riêng + extension method `AddXxx(configuration)`), dùng raw `StackExchange.Redis` bọc trong `ICacheService` mới trong `AutoGrading.Common`, không dùng `IDistributedCache` (byte[]-only, ít linh hoạt hơn cho việc cache DTO có cấu trúc và xóa theo key pattern).
