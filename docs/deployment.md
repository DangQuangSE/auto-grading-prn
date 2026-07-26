# Deployment — AutoGrading

Hướng dẫn triển khai hệ thống AutoGrading bằng Docker Compose.

---

## Prerequisites

- Docker Desktop (Windows/Mac) hoặc Docker Engine + Docker Compose (Linux)
- Git
- File `.env` với đầy đủ secrets (xem bên dưới)

---

## Quick Start

```bash
# 1. Clone repo
git clone <repo-url>
cd auto-grading-prn

# 2. Copy và điền secrets
cp .env.example .env
# Mở .env và điền giá trị thực cho tất cả biến

# 3. Build và khởi động toàn bộ stack
docker compose up -d --build

# 4. Kiểm tra health (chờ ~30-60s để các service khởi động)
docker compose ps
# Tất cả 11 container phải ở trạng thái "healthy"

# 5. Truy cập
# User Web (student):   http://localhost:5173
# Admin Web (lecturer): http://localhost:5174
# Gateway API:          http://localhost:5500
# RabbitMQ Dashboard:   http://localhost:15672  (user/pass theo .env)
# MinIO Console:        http://localhost:9001   (user/pass theo .env)
# Hangfire (Catalog):   http://localhost:5002/hangfire
# Hangfire (Submission):http://localhost:5003/hangfire
# Hangfire (Grading):   http://localhost:5004/hangfire
```

---

## Environment Variables

Tất cả secrets được inject qua file `.env` ở thư mục gốc.

| Variable | Required | Ví dụ | Mô tả |
|----------|----------|-------|-------|
| `SA_PASSWORD` | ✅ | `YourStr0ng!Passw0rd` | SQL Server SA password (phải đủ mạnh) |
| `JWT_ISSUER` | ✅ | `AutoGrading.Identity` | JWT issuer claim |
| `JWT_AUDIENCE` | ✅ | `AutoGrading` | JWT audience claim |
| `JWT_SIGNING_KEY` | ✅ | `<32+ char random string>` | HMAC-SHA256 signing key — phải đổi ở production |
| `RABBITMQ_USER` | ✅ | `autograding` | RabbitMQ admin username |
| `RABBITMQ_PASSWORD` | ✅ | `<strong password>` | RabbitMQ admin password |
| `MINIO_ROOT_USER` | ✅ | `autograding` | MinIO root username |
| `MINIO_ROOT_PASSWORD` | ✅ | `<strong password>` | MinIO root password (min 8 chars) |
| `OPENCODE_API_KEY` | ✅ | `sk-...` | OpenCode Zen API key (cho AI grading) |
| `GOOGLE_CLIENT_ID` | ✅ | `xxx.apps.googleusercontent.com` | Google OAuth Client ID |

> Xem `.env.example` để biết format đầy đủ.

---

## Container Startup Order

```
sqlserver ──────────────────────────────────┐
rabbitmq  ───────────────────────────────── │ ──► identity-api
minio     ───────────────────────────────── │ ──► catalog-api
           (healthy checks phải pass)        │ ──► submission-api ──► catalog-api (HTTP)
                                             │ ──► grading-api    ──► catalog-api (HTTP)
                                             │                    ──► submission-api (HTTP)
                                             └──► notification-api
                                                       │
                                                  gateway ──────────────────────┐
                                                       │                         │
                                               user-web (nginx)          admin-web (nginx)
```

EF Core migrations chạy tự động khi mỗi service khởi động (`MigrateDatabase<TContext>()`).

---

## Service Ports

| Container | External Port | Internal Port | Access |
|-----------|--------------|---------------|--------|
| `sqlserver` | 1433 | 1433 | Internal only |
| `rabbitmq` | 5672, 15672 | 5672, 15672 | 15672 = management UI |
| `minio` | 9000, 9001 | 9000, 9001 | 9001 = console UI |
| `identity-api` | 5001 | 8080 | Direct (dev only) |
| `catalog-api` | 5002 | 8080 | Direct (dev only) |
| `submission-api` | 5003 | 8080 | Direct (dev only) |
| `grading-api` | 5004 | 8080 | Direct (dev only) |
| `notification-api` | 5005 | 8080 | Direct (dev only) |
| `gateway` | 5500 | 8080 | Primary entry point |
| `user-web` | 5173 | 80 | Student app |
| `admin-web` | 5174 | 80 | Lecturer/Admin app |

---

## Useful Commands

```bash
# Rebuild một service cụ thể
docker compose up -d --build grading-api

# Xem logs realtime
docker compose logs -f grading-api

# Xem tất cả logs
docker compose logs --tail=100

# Dừng toàn bộ (giữ volumes)
docker compose down

# Dừng và xóa data (DB, RabbitMQ, MinIO)
docker compose down -v

# Reset một service
docker compose restart submission-api
```

---

## Test Accounts (Seed tự động)

Được seed khi `Seed__TestAccounts=true` (đã bật trong docker-compose.yml). Mật khẩu chung: `Test@12345`

| Email | Role |
|-------|------|
| `testlecturer1@fpt.edu.vn` | Lecturer |
| `testlecturer2@fpt.edu.vn` | Lecturer |
| `teststudent1@fpt.edu.vn` | Student |
| `teststudent2@fpt.edu.vn` | Student |
| `testadmin1@fpt.edu.vn` | Admin |

> Xem `docs/testing-happy-path.md` để biết đầy đủ flow test end-to-end.

---

## Production Checklist

Trước khi deploy production, cần xử lý các vấn đề sau:

- [ ] **JWT signing key**: Đổi `JWT_SIGNING_KEY` thành random string ≥ 32 characters
- [ ] **SQL Server password**: Đổi `SA_PASSWORD` thành strong password
- [ ] **Hangfire auth**: Thay `AllowAllDashboardAuthorizationFilter` bằng JWT admin-role check (3 services)
- [ ] **HTTPS**: Thêm TLS termination (nginx/Traefik/cloud load balancer) trước Gateway
- [ ] **CORS**: Đổi localhost origins thành production domain
- [ ] **`.dockerignore`**: Thêm file `.dockerignore` vào mỗi service để tránh copy `.env` vào image
- [ ] **CSP headers**: Thêm Content Security Policy headers tại Gateway/nginx
- [ ] **Rate limiting**: Xem lại threshold 100 req/min và 10 req/min có đủ không
- [ ] **Log aggregation**: Cấu hình Serilog → Seq hoặc ELK Stack cho centralized logging
- [ ] **MinIO production**: Cân nhắc dùng S3-compatible cloud storage thay MinIO self-hosted
- [ ] **Database per service**: Nếu scale, tách ra 5 SQL Server instances riêng thay vì 1 shared instance
- [ ] **CI/CD**: Xem `docs/ARCHITECTURE.md` section 15 để biết recommended pipeline
