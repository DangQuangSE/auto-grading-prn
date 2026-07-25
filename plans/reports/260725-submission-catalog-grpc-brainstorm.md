# Brainstorm: Submission → Catalog over gRPC

**Date:** 2026-07-25

## Ideas Explored

- **Keep REST, add caching/retry** — dismissed early; user's stated motive is raw performance, and Catalog already exposes a gRPC surface, so REST-side optimization would be solving a problem that's already solved elsewhere.
- **Mirror the Grading service's existing gRPC client pattern** — Grading already migrated its Catalog calls to gRPC in a prior effort (`plans/catalog-grading-grpc/`). Both RPCs Submission needs (`GetAssignment`, `GetLecturerStudentIds`) already exist on `CatalogGrpcService` with the right `[Authorize(Roles=...)]` shape. This became the chosen direction — no new server-side RPCs needed, only a new client + one proto field.
- **Extract shared gRPC client scaffolding to `AutoGrading.Common` now** — considered as the "clean" alternative to copying Grading's `CatalogGrpcAuthenticator`/`ServicesOptions` a third time. Rejected for this task: it would require touching Grading's already-working wiring, raising regression risk for a performance-motivated change that doesn't need it. Matches the repo's existing precedent (`ServiceAuthHandler` is already duplicated per-service for REST-to-REST calls).
- **New dedicated RPC for Submission's assignment shape** (e.g. `GetAssignmentForSubmission`) — dismissed. The only gap is one missing field (`max_attempts`); adding an optional field to the existing `AssignmentReply` is additive and backward-compatible with Grading's current parsing, so a parallel RPC would just duplicate logic for no benefit.

## User's Direction

Replace both of Submission's REST calls to Catalog (`GetAssignmentAsync`, `GetLecturerStudentIdsAsync`) with gRPC, motivated purely by performance. Follow the pattern Grading already established rather than inventing a new one. Accept a third copy of the authenticator/options boilerplate rather than refactoring Grading's working code.

## Open Questions

- Whether the REST client (`CatalogApiClient` + `Services:CatalogApiBaseUrl`) is deleted outright or kept as a fallback — plan should default to full removal (matches Grading precedent, avoids dead code) unless the user says otherwise during `/ck:plan`.
- Exact docker-compose / appsettings wiring for `Services:CatalogGrpcAddress` on `submission-api` (port 8081, same as Grading already uses) — mechanical, to confirm during planning.

## Risks

- **Proto field addition must stay backward-compatible.** `max_attempts` must be added as a new optional field (not reordering/renumbering existing fields), so Grading's existing `AssignmentDto` parsing keeps working unchanged.
- **Auth token minting duplicated a third time.** `CatalogGrpcAuthenticator`/`ServicesOptions` copied into Submission instead of shared — accepted tradeoff, but means any future fix to the gRPC auth pattern has to be applied in three places (Grading, Submission, and eventually wherever else calls Catalog via gRPC).
- **Test coverage parity.** Grading has `CatalogApiClientTests.cs`/`CatalogGrpcAuthenticatorTests.cs`/`ServicesOptionsTests.cs` covering this exact pattern — Submission's migration should get equivalent coverage, not less.
