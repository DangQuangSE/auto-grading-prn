# Auto Grading

Platform for grading IT project reports and architecture diagrams. Split into an independent
**frontend / backend** architecture:

- `fe/` — React + Vite + TypeScript frontends.
  - `fe/user-web` — student/lecturer app. See `fe/user-web/README.md`.
  - `fe/admin-web` — admin app. See `fe/admin-web/README.md`.
- `be/` — ASP.NET Core microservices backend (Identity, Catalog, Submission, Grading,
  Notification) behind a YARP API Gateway, replacing the previous Supabase backend
  (Auth/Postgres/Storage/Edge Functions) with SQL Server, RabbitMQ, MinIO, Redis, and Hangfire.
  See `be/README.md`.
- `docker-compose.yml` (root) — runs the full stack: gateway, all 5 services, SQL Server,
  RabbitMQ, MinIO, Redis, and both frontends.

The target architecture, functional requirements, event/job tables, and requirements
checklist are documented in `requirment.md`. The refactor from the original single-source
Supabase app is tracked in `plans/split-fe-be-microservices/` (`spec.md`, `plan.json`).

## Running the full stack

```bash
cp .env.example .env   # fill in SA_PASSWORD, RABBITMQ_*, JWT_SIGNING_KEY, MINIO_*, OPENROUTER_API_KEY
docker compose up --build
```

- Gateway: http://localhost:5500
- User web: http://localhost:5173
- Admin web: http://localhost:5174
- RabbitMQ management: http://localhost:15672
- MinIO console: http://localhost:9001
- Per-service Hangfire dashboards: `http://localhost:5003/hangfire` (Submission),
  `http://localhost:5004/hangfire` (Grading)

`.env` holds live secrets for local Docker use only — it is gitignored and must never be
committed; copy `.env.example` and fill in your own values.

## Running the frontend standalone

```bash
cd fe/user-web
npm install
npm run dev
```

Copy `fe/user-web/.env.example` to `fe/user-web/.env.local` (or `fe/admin-web/.env.example`
for the admin app) and point `VITE_API_BASE_URL` at a running gateway (see above).

## Running the backend standalone

See `be/README.md` for building the ASP.NET Core solution directly with `dotnet build`.

## Rubric and Submission Docs

- `docs/rubric-docx-format.md`
- `docs/submission-template-guidelines.md`
- `docs/deployment.md`

## Status

Fully split and verified end-to-end: `fe/user-web` ported off the Supabase SDK onto the
gateway REST API, `fe/admin-web` scaffolded, and `be/` implements all 5 microservices + YARP
gateway. The full Docker Compose stack (11 containers) has been verified healthy with a live
smoke test covering JWT login through the gateway, cross-service RabbitMQ event flow, the
submission → extraction → AI-grading Hangfire pipeline, and both Hangfire dashboards. See
`plans/split-fe-be-microservices/plan.json` for the phase-by-phase build/verification log.
