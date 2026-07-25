# Phase 1: Proto contract + Catalog gRPC server

**Covers:** P1 story #2 (distinct gRPC port + checked-in `.proto` contract), P1 story #3
(server-side JWT enforcement), P2 story (single proto source of truth). FR-01, FR-06, FR-07.

## Requirements
Catalog exposes a gRPC service with 3 unary RPCs (`GetAssignment`, `GetCriteriaForAssignment`,
`GetLecturerStudentIds`) backed by a single checked-in `.proto` contract at
`be/src/Services/Catalog/AutoGrading.Catalog.Api/Protos/catalog.proto`. Each RPC delegates to
the existing `IAssignmentService`/`IRubricService`/`IEnrollmentService` — no new business or
authorization logic — and is protected by Catalog's existing JWT bearer authentication. The
3 existing REST endpoints remain fully functional and unchanged.

### Tests to Write First
- Found/not-found assignment lookup test, against the generated gRPC service contract
  (written against the interface/DTO shape before the adapter implementation exists, so it
  fails red until the RPC is wired to `IAssignmentService`).
- Confirmed-only rubric filtering test for a service-role caller (`Sub = Guid.Empty`) —
  written first so it locks in parity with `RubricRepository.ListAsync`'s existing REST
  behavior before the gRPC adapter is written, catching any accidental re-implementation of
  the filter.
- Missing-claims rejection test (no `[Authorize]`-satisfying token) — written first against
  the bare `[Authorize]` requirement.
- Wrong-role rejection test on `GetLecturerStudentIds` (valid claims, role = `student`) —
  written first per step 5a, so the role-gate fix is proven necessary (red) before it's
  implemented (green), directly closing the plan-reviewer's CRITICAL finding.

## Steps
1. Author `catalog.proto`: one service with the 3 unary RPCs named in FR-01, with request/reply
   messages that map 1:1 onto the existing `AssignmentDto`, `RubricCriterionDto`, and the
   lecturer-student-id list shape already used by Grading's `ICatalogApiClient`.
2. Reference the proto from Catalog's own `.csproj` in server-codegen mode and add the
   `Grpc.AspNetCore` package.
3. Implement the gRPC service class as a thin adapter: each RPC calls the corresponding
   existing service method and maps domain objects to proto reply messages — do not
   reimplement lookup, filtering, or validation logic that already lives in those services.
4. Derive the caller's identity/role from the gRPC call context the same way the REST
   endpoints derive it from `ClaimsPrincipal` (user id, admin/service role), so the
   criteria-lookup RPC reproduces the REST path's existing behavior of only returning
   confirmed rubrics for a service-role caller.
5. Protect the gRPC service class with `[Authorize]`, reusing Catalog's already-registered
   JWT bearer authentication — no new auth handler.
5a. `GetLecturerStudentIds` specifically must additionally enforce the same
   `RequireRole("lecturer", "service")` restriction that `LecturerEnrollmentEndpoints`
   applies on the REST path — a plain `[Authorize]` is not sufficient here. Add a per-RPC
   role check (attribute or explicit in-method check against the gRPC call context's
   claims) so a caller with a valid-but-wrong-role JWT (e.g. `student`) is rejected exactly
   like the REST endpoint rejects it today. Without this, gRPC would open a roster/enrollment
   data exposure regression versus the REST path it replaces.
6. Register the gRPC service in `Program.cs` alongside the existing Minimal API endpoint
   groups (purely additive; no existing route registration is touched or reordered).
7. Add unit tests for the new gRPC service class (new xUnit test project registered in the
   solution, EF Core InMemory-backed, following `AutoGrading.Common.Tests` conventions)
   covering: found and not-found assignment lookup, criteria lookup returning only confirmed
   rubrics for a service-role caller, lecturer-student-id lookup, a call missing the
   required claims being rejected, and a call with valid claims but the wrong role (e.g.
   `student`) being rejected specifically on `GetLecturerStudentIds`.
8. Confirm the 3 existing REST endpoints (`/assignments/{id}`, `/rubrics`,
   `/enrollments/lecturer-student-ids`) are present and byte-for-byte unchanged in behavior.

## Success Criteria
- `dotnet build` succeeds on `AutoGrading.Catalog.Api` with the new `Protos/catalog.proto`
  and generated server-side stubs.
- `dotnet test` passes for the new gRPC service unit tests (found/not-found, confirmed-only
  filtering, unauthenticated rejection, and wrong-role rejection on `GetLecturerStudentIds`
  all covered).
- A diff review shows the 3 REST endpoint files/routes are unmodified — only additive files
  (Protos, gRPC service class, Program.cs registration, new test project) changed.

## Risks
- Reimplementing authorization/filtering logic instead of delegating to existing services:
  mitigate by writing the gRPC service as a pure adapter and by the unit test that asserts
  only confirmed rubrics are returned for a service-role caller.
- Proto message shape drifting from the DTOs Grading actually needs (discovered in Phase 3):
  mitigate by reviewing `ICatalogApiClient`'s 3 method signatures and DTOs before finalizing
  the proto, not after.
