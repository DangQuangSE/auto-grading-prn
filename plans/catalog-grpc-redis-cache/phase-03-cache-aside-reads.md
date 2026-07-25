# Phase 3: Cache-aside reads in `AssignmentService`/`RubricService`

**Covers:** FR-01, FR-02, FR-05 (read-side fallback), User Stories P1 #1 and #2.

## Requirements
Calling `GetAssignment` or `GetCriteriaForAssignment` twice in a row for the same
`assignmentId` results in only one DB query — the second call is served from Redis. A cache
miss, or Redis being unreachable at read time, transparently falls through to the existing DB
read with no behavior change visible to the gRPC caller. `CatalogGrpcService` itself is
untouched beyond continuing to call the service layer exactly as before.

## Steps
1. Inject `ICacheService` into `AssignmentService` and `RubricService` (constructor
   parameter, alongside the existing repository dependency).
2. In `AssignmentService.GetByIdAsync`, wrap the existing repository call in cache-aside
   logic: look up `catalog:assignment:{id}` first; on a hit, return the cached value; on a
   miss, read the DB as today and populate the cache with a 30-minute TTL before returning.
3. Add an equivalent cache-aside path for the criteria lookup used by
   `GetCriteriaForAssignment`, keyed as `catalog:criteria:{assignmentId}` — since the cache key
   has no caller-identity component, this path must document (and the code must reflect) that
   it is only correct because Phase 2's `service`-role restriction guarantees a single,
   consistent caller identity for this RPC. Populate the cache with the same 30-minute TTL.
4. Make every cache read/write wrapped in this phase resilient per FR-05: any exception from
   `ICacheService.GetAsync`/`SetAsync` (e.g. Redis unreachable) is logged and swallowed, never
   propagated to the gRPC caller — the method must behave exactly as it did pre-cache when
   Redis is down.
5. Log a distinguishable message on cache hit vs. cache miss (per spec.md's Success
   Criteria — hit rate must be observable via logs during a demo).
6. Update `CatalogGrpcServiceTests.CreateService()` (and any other direct construction of
   `AssignmentService`/`RubricService` in tests) to supply an `ICacheService`, using this
   repo's hand-rolled-test-double convention (no mocking library) — an in-memory fake is
   sufficient.
7. Add test cases proving: a second `GetAssignment`/`GetCriteriaForAssignment` call for the
   same id does not hit the DB (assert against the in-memory `DbContext`'s query count or an
   equivalent observable), and that a simulated cache failure still returns the correct
   DB-backed result.
8. Add one reflection-based test asserting `CatalogGrpcService.GetCriteriaForAssignment`
   carries `[Authorize(Roles = "service")]` before any cache-aside test for it runs. This turns
   the Phase 2-before-Phase 3 ordering dependency (see Risks) into a hard, automated gate — an
   out-of-order implementation or a later regression that drops the attribute fails the test
   suite loudly instead of silently reopening the identity-leak.

## Success Criteria
- `dotnet test` on `AutoGrading.Catalog.Api.Tests` passes, including new hit/miss/fallback
  cases for both RPCs.
- Two consecutive `GetAssignment` calls (same `assignmentId`) against a live stack produce
  only one DB query, observable via logs (matches spec.md Success Criterion #1).
- Two consecutive `GetCriteriaForAssignment` calls (same `assignmentId`, `service`-role
  caller) behave identically.
- With Redis stopped, both RPCs still return correct data with no error surfaced to the
  caller (manual check, full live verification deferred to Phase 5).

## Risks
- Caching `GetCriteriaForAssignment` by `assignmentId` alone re-introduces the FR-06 gap if
  this phase is ever implemented or reordered before Phase 2 — mitigated by treating Phase 2
  as a strict prerequisite (see plan.md Dependencies) and keeping the identity-invariant
  documented directly on the new cache-aside method.
- A poorly-scoped `try/catch` around the cache read could accidentally swallow a real DB
  exception too, masking genuine failures as silent fallbacks — mitigated by scoping the
  try/catch tightly around only the `ICacheService` calls, letting DB exceptions propagate
  normally.
- Serialization mismatch between the cached DTO shape and the domain type returned by the
  repository (e.g. missing navigation properties after JSON round-trip) — mitigated by caching
  only the flat data actually needed for the gRPC reply (already effectively DTO-shaped:
  `Assignment` fields, `RubricCriterion` list), verified by the new tests in step 7.
