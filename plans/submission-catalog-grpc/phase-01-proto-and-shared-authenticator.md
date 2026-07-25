# Phase 1: Proto and Shared Authenticator

## Requirements
Catalog's gRPC `AssignmentReply` carries a `max_attempts` value populated from the domain model, and the gRPC service-token-signing helper that Grading currently owns privately becomes a shared, reusable building block — with no observable change to Grading's own behavior.

## Steps
1. Add the new numeric `max_attempts` field (next available field number) to `AssignmentReply` in `catalog.proto`, keeping it wire-compatible with existing consumers.
2. Populate the new field from the assignment's existing attempt-limit value wherever `AssignmentReply` is constructed on the Catalog side.
3. **Before moving any code**: add a `Grpc.Core.Api` package reference (the minimal package providing `Grpc.Core.Metadata`, which the authenticator uses) to `AutoGrading.Common.csproj` and to `AutoGrading.Common.Tests.csproj`. Without this the move in step 4 will not compile — `AutoGrading.Common` currently has zero `Grpc.*` package references. Note this makes `Grpc.Core.Api` a transitive dependency of every project that references `AutoGrading.Common` (Identity, Notification, Gateway, Catalog, Submission, Grading) — accepted as a conscious tradeoff since it's the natural shared home given three of those six already build gRPC clients/servers.
4. Move the existing gRPC service-token authenticator helper out of Grading and into the shared building-blocks library, updating its namespace to match the shared library's conventions.
5. Move its existing unit tests into the shared library's test project alongside it, and delete Grading's now-empty local copy of both the helper and its tests.
6. Update Grading's startup wiring to reference the relocated shared helper instead of its own local one, with no other change to Grading's DI or runtime configuration.
7. Run Catalog's and Grading's existing test suites to confirm the proto addition and the authenticator relocation introduced no regressions.

## Success Criteria
- `AutoGrading.Common.csproj` and `AutoGrading.Common.Tests.csproj` build with the new `Grpc.Core.Api` reference before the authenticator file is moved into place.
- `catalog.proto` compiles for both Catalog and Grading, and Grading's existing assignment-parsing logic (which ignores the new field) still passes unchanged.
- The relocated authenticator helper and its tests live only in the shared building-blocks library — no duplicate copy remains under Grading.
- `dotnet test` passes for both `AutoGrading.Catalog.Api` (if it has a test project covering the gRPC service) and `AutoGrading.Grading.Api.Tests` with zero changes required to existing Grading test assertions.

## Risks
- Moving the authenticator changes its namespace, which is a breaking change for any other in-flight branch referencing the old location: mitigate by searching the whole repo for the old namespace/using before deleting the original file.
- The new proto field must be set unconditionally (not left as an `if`-guarded optional like `description`) since the domain value is a non-nullable int — otherwise gRPC's "has field" semantics silently produce `0` for every assignment: verify this explicitly in a test that asserts the reply's `max_attempts` matches a non-zero domain value.
- **Deploy-order gap**: if Submission's new gRPC client (Phase 2) were ever deployed against a Catalog instance that hasn't yet shipped this phase's `ToReply` change, `max_attempts` would decode to the proto3 default `0` on the wire, and Submission's attempt-limit check (`used >= maxAttempts`) would reject every first submission attempt (`0 >= 0` is true). This repo's `docker-compose up` rebuilds every image from the same commit, so Catalog and Submission always ship together in practice — but this phase must land and be verified (step 7) *before* Phase 2 is cut over in any environment that deploys services independently.
