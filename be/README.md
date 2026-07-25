# AutoGrading — Backend (ASP.NET Core Microservices)

Replaces the previous Supabase implementation (`supabase/`) with 5 independent ASP.NET Core
services behind a YARP API Gateway, per `requirment.md`.

## Structure

```
be/
  AutoGrading.sln
  Directory.Build.props     # shared TFM (net8.0) + nullable/implicit usings
  global.json                # pinned .NET SDK
  src/
    BuildingBlocks/
      AutoGrading.Contracts/   # integration events, shared enums/DTOs
      AutoGrading.Common/      # JWT, RabbitMQ IEventBus, MinIO wrapper, EF Core base, health checks, Hangfire dashboard auth
    Services/
      Identity/AutoGrading.Identity.Api/         # register/login, JWT issuance
      Catalog/AutoGrading.Catalog.Api/           # subjects, assignments, rubrics
      Submission/AutoGrading.Submission.Api/     # submission upload, artifact extraction
      Grading/AutoGrading.Grading.Api/           # AI grading (OpenRouter), final grade publish
      Notification/AutoGrading.Notification.Api/ # audit log + per-user notifications
    Gateway/
      AutoGrading.Gateway/      # YARP reverse proxy, JWT validation, CORS
```

Each service owns its own SQL Server database (database-per-service, auto-migrated on
startup) and exposes a `GET /health` endpoint. Cross-service communication goes through
RabbitMQ integration events defined in `AutoGrading.Contracts` — see `requirment.md` §6 for
the full event table (publisher/subscriber/purpose).

Submission and Grading also run Hangfire background jobs (SQL Server storage), enqueued from
event handlers rather than on a fixed schedule: `ExtractionJob` (on `SubmissionUploaded`) and
`AiGradingJob` (on `ArtifactsExtracted`). Dashboards at `/hangfire` on each service.

## Running locally

Full stack (recommended) — from the repo root:

```bash
cp .env.example .env   # fill in SA_PASSWORD, RABBITMQ_*, JWT_SIGNING_KEY, MINIO_*, OPENROUTER_API_KEY
docker compose up --build
```

This starts SQL Server, RabbitMQ, MinIO, all 5 services, the gateway (`:5500`), and both
frontends (`user-web` on `:5173`, `admin-web` on `:5174`). Each service is also reachable
directly on its own port (Identity `:5001`, Catalog `:5002`, Submission `:5003`, Grading
`:5004`, Notification `:5005`) for debugging. Catalog also exposes a gRPC endpoint on `:5012`
(internal service-to-service only, not exposed via Gateway).

To build the solution standalone (requires a local SQL Server/RabbitMQ, e.g. via
`docker compose up sqlserver rabbitmq minio`):

```bash
cd be
dotnet build
```

## Status

All 5 services + gateway implemented and verified end-to-end via the root Docker Compose
stack: JWT login through the gateway, cross-service event publish/subscribe
(`UserRegistered` → Notification), and the full submission pipeline
(`SubmissionUploaded` → extraction → `ArtifactsExtracted` → AI grading job). See
`plans/split-fe-be-microservices/plan.json` (step 11) for the detailed verification log.
