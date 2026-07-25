# Brainstorm: Add gRPC service (Grading → Catalog)

**Date:** 2026-07-24

## Context

PRN232 assignment compliance check (`requirements/PRN232_Final_Assignment.md`) found the
project has zero gRPC usage (§2.4, 15% of grade) despite an otherwise complete microservices
stack (REST, background jobs via Hangfire, RabbitMQ message broker, Docker Compose).

## Ideas Explored

- **Convert an existing HTTP inter-service call to gRPC** — reuse an already-working call
  path, smallest amount of new code, directly satisfies "REST API demonstrates interaction
  with gRPC service."
- **Stand up a brand-new gRPC-only service** (e.g. Recommendation/Pricing, per the
  assignment's suggested list) — cleaner separation, but requires inventing new business
  logic not already in the domain; more work for a bolt-on requirement.
- **Both** (convert one call + add a new gRPC-only flow) — richest demo, most effort.

Three existing HTTP-based service-to-service call pairs were found via `Clients/` folders:

| Caller → Callee | Methods |
| :--- | :--- |
| Submission → Catalog | `GetAssignmentAsync`, `GetLecturerStudentIdsAsync` |
| **Grading → Catalog** | `GetCriteriaForAssignmentAsync`, `GetAssignmentAsync`, `GetLecturerStudentIdsAsync` |
| Grading → Submission | `GetSubmissionAsync` (submission + extracted report/diagram content) |

All three currently go through plain `HttpClient` + JSON with a `ServiceAuthHandler` that
attaches a short-lived internal service JWT (`JwtTokenGenerator.GenerateServiceToken`) as a
Bearer token — the same JWT bearer auth pipeline Catalog already validates for its REST
endpoints.

## User's Direction

Convert **Grading → Catalog** to gRPC. Rationale: this is the core AI-grading flow
(rubric criteria + assignment lookup), easiest to demo end-to-end (upload → grading job →
gRPC call to Catalog → AI score), and reuses logic that already exists rather than inventing
a new domain.

Sub-decisions locked in:
- **Separate gRPC port** on Catalog (not multiplexed on the REST port) — clearer to explain
  in a demo/presentation ("this port is REST, this port is gRPC"), avoids YARP/h2c
  complications if gRPC traffic ever needs to cross the Gateway.
- **Keep the 3 REST endpoints on Catalog untouched** (`/assignments/{id}`, `/rubrics`,
  `/enrollments/lecturer-student-ids`) — add the gRPC service *alongside* them rather than
  replacing them, since it isn't confirmed whether the frontend also calls these directly
  through the Gateway. Only Grading's client switches from `HttpClient` to a generated gRPC
  client.

## Open Questions

- Where should the shared `.proto` file live so both Catalog (server) and Grading (client)
  can generate stubs from it at build time — a new shared project under `BuildingBlocks`, or
  duplicated `.proto` copies per project with `<Protobuf>` include? (Proposed default: shared
  `.proto` file referenced by relative path from both `.csproj`s — no new BuildingBlocks
  project needed since gRPC codegen doesn't require a shared assembly, only a shared contract
  file.)
- Should the internal service JWT (`ServiceAuthHandler` equivalent) be reused for gRPC via a
  `CallCredentials`/interceptor, or is unauthenticated internal gRPC acceptable since it's
  Docker-network-only? (Proposed default: reuse the JWT — Catalog's gRPC service should sit
  behind the same `[Authorize]` pipeline as its REST endpoints for consistency and because the
  assignment likely expects auth to be demonstrated consistently.)
- Does `/ck:plan` need to also touch `docker-compose.yml` port mapping and `appsettings.*`
  Kestrel endpoint config for the new gRPC port on `catalog-api`? (Yes — flagged in spec.)

## Risks

1. **Kestrel dual-protocol config** — REST (HTTP/1.1) and gRPC (HTTP/2) on separate ports is
   the safe default, but Program.cs `WebApplication` builder needs explicit endpoint
   configuration (`UseKestrel(...).ConfigureEndpointDefaults`) rather than relying on
   ASP.NET Core's implicit single-port behavior. Getting this wrong causes silent gRPC
   connection failures (UNAVAILABLE) that look like a network/Docker issue.
2. **Proto/codegen drift** — if the `.proto` file location or `Grpc.Tools` package version
   differs between Catalog (server-mode codegen) and Grading (client-mode codegen), stub
   mismatches surface as runtime deserialization errors, not compile errors.
3. **Scope creep into "convert everything"** — only Grading→Catalog is in scope for this
   pass; Submission→Catalog and Grading→Submission stay on HTTP. Resist consolidating all
   three just because the pattern is now established.
