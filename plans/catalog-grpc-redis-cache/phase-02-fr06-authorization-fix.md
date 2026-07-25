# Phase 2: FR-06 authorization fix on `GetCriteriaForAssignment`

**Covers:** FR-06. Hard prerequisite for FR-02/Phase 3 — caching this RPC's result by
`assignmentId` alone is only safe once this phase lands.

## Requirements
`GetCriteriaForAssignment` rejects any caller that doesn't hold the `service` role, closing
the gap where a non-`service` authenticated caller could trigger or read a cache entry keyed
only by `assignmentId` despite the underlying data being caller-identity-filtered
(`RubricRepository.ListAsync`'s admin/owner rules). No other RPC's authorization changes.

## Steps
1. Add `[Authorize(Roles = "service")]` directly on `CatalogGrpcService.GetCriteriaForAssignment`,
   the same way `GetLecturerStudentIds` already carries its own method-level
   `[Authorize(Roles = "lecturer,service")]` override on top of the class-level `[Authorize]`.
2. Confirm Grading's existing call path (`CatalogApiClient` → `CatalogGrpcAuthenticator
   .AttachServiceToken`) already sends a `service`-role JWT for this RPC, so no client-side
   change is needed — this is a server-only authorization tightening.
3. Add a negative test case to `CatalogGrpcServiceTests` asserting a non-`service`-role caller
   (e.g. a plain `student`/`lecturer` token, no role at all) is rejected before reaching
   `RubricService`/`RubricRepository`.
4. Confirm the existing happy-path test(s) for `GetCriteriaForAssignment` still pass with a
   `service`-role caller context, updating the test's role claim if it wasn't already
   `"service"`.
5. Run the full Catalog test suite to confirm no other test relied on `GetCriteriaForAssignment`
   being reachable by a non-`service` role.

## Success Criteria
- `dotnet test` on `AutoGrading.Catalog.Api.Tests` passes, including the new negative
  authorization test for `GetCriteriaForAssignment`.
- A manual gRPC call to `GetCriteriaForAssignment` with a valid JWT lacking the `service` role
  returns `Unauthenticated`/`PermissionDenied` (per standard ASP.NET Core `[Authorize(Roles)]`
  behavior), while the same call with a `service`-role JWT still succeeds.
- No other gRPC method's authorization behavior changed (`GetAssignment` and
  `GetLecturerStudentIds` unaffected).

## Risks
- Tightening this role gate could break an as-yet-undiscovered legitimate non-service caller
  of `GetCriteriaForAssignment` — mitigated by the spec.md finding that Grading is the only
  confirmed caller and always uses the service token (`CatalogApiClient.cs` +
  `Program.cs:48`); re-confirm via a repo-wide grep for other callers of this RPC before
  landing.
- Landing this phase out of order (after Phase 3's caching) would leave a real security window
  live in the caching code path, even briefly — mitigated by treating this as a hard
  prerequisite gate before Phase 3 begins, per plan.md's Dependencies section.
