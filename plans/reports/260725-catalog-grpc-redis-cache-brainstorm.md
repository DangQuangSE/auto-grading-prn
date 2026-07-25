# Brainstorm: Redis caching cho gRPC lookup (Catalog)

**Date:** 2026-07-25

## Ideas Explored
- Redis làm message broker thay/song song RabbitMQ — loại, vì RabbitMQ đã đáp ứng yêu cầu 2.3 (Message Broker), thêm Redis broker chỉ trùng vai trò, không phải caching.
- Cache `GET /subjects` (Catalog REST) — đơn giản nhất nhưng ít liên quan tới phần gRPC vừa hoàn thành, giá trị demo thấp hơn.
- Cache `GET /notifications/unread-count` — lợi ích rõ (polling liên tục) nhưng dữ liệu đổi thường xuyên, cần invalidation phức tạp hơn cho một feature "nhỏ, đơn giản".
- Cache gRPC lookup `GetAssignment` + `GetCriteriaForAssignment` (Grading → Catalog) — chọn.
  - Cân nhắc vị trí cache: **client-side** (trong Grading, tại call site gRPC) vs **server-side** (trong Catalog, trong gRPC handler trước khi query DB).
    - Client-side: tiết kiệm toàn bộ round-trip (network + DB), nhưng Grading không biết khi Catalog ghi dữ liệu mới → chỉ dựa TTL, có thể stale.
    - Server-side: vẫn tốn round-trip gRPC, nhưng Catalog sở hữu dữ liệu nên có thể invalidate chính xác ngay tại write path đã có sẵn (`ClassRepository`, `RubricsEndpoints`) → chọn.

## User's Direction
Triển khai Redis cache ở **server-side, trong Catalog**, cho cả hai RPC `GetAssignment` và `GetCriteriaForAssignment` ([CatalogGrpcService.cs](be/src/Services/Catalog/AutoGrading.Catalog.Api/Grpc/CatalogGrpcService.cs)). Invalidate cache trực tiếp tại thời điểm ghi dữ liệu (trong `ClassRepository.SaveAndPublishAsync` và `RubricsEndpoints` sau khi lưu), thay vì chỉ dựa TTL. Mục tiêu: một feature nhỏ, gọn, để tính bonus theo mục 8 của đề bài — không phải yêu cầu bắt buộc.

## Open Questions
- Redis chưa có trong `docker-compose.yml` — cần thêm service mới khi lên plan.
- Chưa chọn client library cụ thể (`IDistributedCache` + `Microsoft.Extensions.Caching.StackExchangeRedis` vs raw `StackExchange.Redis`) — để /ck:plan quyết định dựa trên pattern DI hiện có của Catalog.
- TTL an toàn (fallback) bên cạnh invalidation chủ động — giá trị cụ thể chưa chốt.
- Cache key nên theo `assignmentId` cho cả hai RPC; cần xác nhận `GetCriteriaForAssignment` không có tham số lọc nào khác làm key phức tạp hơn.

## Risks
- Invalidation đặt sai chỗ (bỏ sót một write path khác ngoài `ClassRepository`/`RubricsEndpoints`) → cache trả dữ liệu cũ.
- Thêm Redis vào Docker Compose có thể ảnh hưởng tới yêu cầu Deployment (mục 3/4) nếu không cấu hình đúng cho môi trường cloud.
- Scope creep: vì đây là bonus nhỏ, cần giữ chỉ 2 RPC đã chọn, không mở rộng cache sang các endpoint khác trong lúc implement.
