# Spec: Grading → Catalog gRPC service

**Date:** 2026-07-24
**Status:** Draft

---

## Problem Statement

The PRN232 assignment requires an independent gRPC service with demonstrated REST↔gRPC
interaction (§2.4, 15% of grade). The project currently has zero gRPC usage. Grading already
calls Catalog over plain HTTP/JSON for rubric criteria, assignment info, and enrolled-student
lookups during the AI-grading job — this call path is the natural candidate to convert.

---

## User Stories

<!-- P1 = MVP (must ship), P2 = nice-to-have, P3 = future/out-of-scope -->

- **[P1]** As the Grading service's `AiGradingJob`, I want to fetch rubric criteria and
  assignment info from Catalog over gRPC instead of HTTP, so that the assignment's gRPC
  requirement is satisfied using a real, already-exercised production code path.
  Accepted when: `AiGradingJob` runs end-to-end (submission upload → extraction →
  AI grading → grade published) using the gRPC client, with no behavior change visible to
  the frontend.

- **[P1]** As a grader/reviewer of this assignment, I want to see a distinct gRPC port and
  `.proto` contract for Catalog, so that the gRPC requirement is unambiguous during
  demonstration.
  Accepted when: Catalog exposes a gRPC endpoint on its own port (separate from the REST
  port), backed by a checked-in `.proto` file, callable independently of the REST API (e.g.
  via `grpcurl` or a test client) without going through the Gateway.

- **[P1]** As the internal auth model, I want gRPC calls from Grading to Catalog to carry the
  same internal service JWT used today for HTTP, so that gRPC doesn't introduce an
  unauthenticated internal surface.
  Accepted when: Catalog's gRPC service rejects calls without a valid service JWT
  (`[Authorize]`), and Grading's gRPC client attaches the token via a `CallCredentials`/
  interceptor equivalent to today's `ServiceAuthHandler`.

- **[P2]** As a future maintainer, I want the `.proto` contract to be the single source of
  truth for the 3 converted methods (`GetAssignment`, `GetCriteriaForAssignment`,
  `GetLecturerStudentIds`), so that Catalog (server) and Grading (client) can't drift.
  Accepted when: one `.proto` file is referenced by both `Catalog.Api.csproj` (server-mode
  codegen) and `Grading.Api.csproj` (client-mode codegen).

- **[P3]** _(out of scope) Converting Submission→Catalog or Grading→Submission to gRPC._
- **[P3]** _(out of scope) Removing the existing REST endpoints on Catalog
  (`/assignments/{id}`, `/rubrics`, `/enrollments/lecturer-student-ids`)._

---

## Functional Requirements

1. FR-01: Catalog exposes a gRPC service (`CatalogGrpcService` or similar) with 3 unary RPCs
   mapping 1:1 to the existing `ICatalogApiClient` methods used by Grading:
   `GetAssignment(GetAssignmentRequest) → AssignmentReply`,
   `GetCriteriaForAssignment(GetCriteriaRequest) → CriteriaReply`,
   `GetLecturerStudentIds(GetLecturerStudentIdsRequest) → StudentIdsReply`.
2. FR-02: Catalog's Kestrel config adds a second endpoint (distinct port, HTTP/2, no TLS
   required for the Docker-internal network) dedicated to gRPC, alongside the existing REST
   port.
3. FR-03: `docker-compose.yml` maps the new Catalog gRPC port so it's reachable by
   `grading-api` on the internal network, and (optionally, for manual verification) exposes
   it to the host.
4. FR-04: Grading's `CatalogApiClient` (in `Grading.Api/Clients/`) is reimplemented against
   the generated gRPC client instead of `HttpClient`, preserving the existing
   `ICatalogApiClient` interface so callers (`AiGradingJob`, handlers) require no changes.
5. FR-05: Grading attaches the internal service JWT to every gRPC call (equivalent of
   `ServiceAuthHandler`) via gRPC `CallCredentials` or a client interceptor.
6. FR-06: Catalog's gRPC service validates the same JWT via `[Authorize]`, reusing the JWT
   bearer authentication already configured for its REST endpoints.
7. FR-07: The 3 REST endpoints on Catalog that overlap with these RPCs remain unchanged and
   fully functional (no removal, no behavior change) — gRPC is additive.

---

## Non-Functional Requirements

- Performance: no specific target — parity with existing HTTP call latency is acceptable;
  this is a compliance/demo requirement, not a performance optimization.
- Security: gRPC calls must be authenticated with the same internal service JWT trust model
  as existing HTTP inter-service calls (no weaker auth surface introduced).
- Availability: Catalog gRPC endpoint must come up as part of the existing
  `catalog-api` container/healthcheck lifecycle — no new container.

---

## Success Criteria

- [ ] `docker compose up` brings up `catalog-api` with both REST (existing port) and gRPC
      (new port) reachable.
- [ ] A full submission → extraction → AI-grading → publish run succeeds using the gRPC
      client path (verified via existing smoke-test flow, per `docs/testing-happy-path.md`).
- [ ] Catalog's gRPC endpoint rejects an unauthenticated/invalid-token call (401/UNAUTHENTICATED).
- [ ] Existing REST endpoints on Catalog (`/assignments/{id}`, `/rubrics`,
      `/enrollments/lecturer-student-ids`) still pass their current behavior unchanged.
- [ ] `.proto` file is checked into the repo and referenced by both Catalog and Grading
      `.csproj` files (no duplicated/hand-copied proto content).

---

## Out of Scope

- Converting Submission→Catalog or Grading→Submission HTTP calls to gRPC.
- Removing or deprecating the 3 existing REST endpoints on Catalog.
- Routing gRPC traffic through the YARP Gateway (internal Docker-network call only).
- TLS for the internal gRPC port (Docker-internal network, same trust boundary as existing
  internal HTTP calls which are also unencrypted TLS-wise).

---

## Assumptions

- The 3 REST endpoints on Catalog are not confirmed to be free of frontend/admin-web usage
  — spec keeps them untouched rather than verifying this, since removal is out of scope
  regardless.
- Reusing `JwtTokenGenerator.GenerateServiceToken("grading")` (already used for HTTP) is
  valid for gRPC metadata — no new token type needed, since the token itself is
  transport-agnostic (it's just a Bearer JWT).
- Grpc.AspNetCore / Grpc.Net.Client (and Grpc.Tools for codegen) are the intended libraries —
  standard for .NET 8 gRPC, no alternative considered.

---

## Resolved Decisions

- `.proto` file lives at `be/src/Services/Catalog/AutoGrading.Catalog.Api/Protos/catalog.proto`,
  referenced by relative path (`<Protobuf Include="../../Catalog/AutoGrading.Catalog.Api/Protos/catalog.proto" GrpcServices="Client" />`)
  from `Grading.Api.csproj`. No new shared/BuildingBlocks project — a single proto file
  doesn't warrant one, and relative-path `<Protobuf>` include is the standard .NET pattern for
  same-solution client/server proto sharing.
- Host port for Catalog's new gRPC endpoint: container port `8081` (internal), mapped to
  `5012` on the host in `docker-compose.yml` — confirmed free against all current port
  mappings (1433, 5672, 15672, 9000, 9001, 5001–5005, 5500, 5173, 5174).
