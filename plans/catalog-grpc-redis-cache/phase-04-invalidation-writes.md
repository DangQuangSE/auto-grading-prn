# Phase 4: Invalidation writes in the repositories

**Covers:** FR-03, FR-05 (write-side failure swallowing), User Story P1 #3.

## Requirements
Any successful write to an assignment or a rubric/its criteria immediately removes the
matching cache entry, so the next `GetAssignment`/`GetCriteriaForAssignment` call after an
update never returns stale cached data — including writes made by the background
`RubricParsingJob`, not just the REST endpoints. A cache invalidation failure never fails an
otherwise-successful DB write.

## Steps
1. Inject `ICacheService` into `AssignmentRepository` and `RubricRepository` (constructor
   parameter, alongside the existing `CatalogDbContext` dependency).
2. In `AssignmentRepository.CreateAsync` and `UpdateAsync`, call
   `RemoveAsync("catalog:assignment:{id}")` immediately after `SaveChangesAsync` succeeds,
   using the newly created/updated assignment's id.
3. In `RubricRepository.CreateAsync`, `UpdateAsync`, `UpdateCriteriaAsync`, `ConfirmAsync`, and
   `UnlockAsync`, call `RemoveAsync("catalog:criteria:{assignmentId}")` immediately after the
   corresponding `SaveChangesAsync`/`TrySaveChangesAsync` succeeds, using the rubric's
   `AssignmentId` (all five methods take the `Rubric` entity, which carries `AssignmentId`).
   `ConfirmAsync`/`UnlockAsync` are not optional here: `RubricRepository.ListAsync` filters
   non-admin/non-owner callers to `Status == Confirmed` rubrics only, and `GetCriteriaForAssignment`'s
   only real caller (Grading, via a fixed service JWT — see FR-06) is always non-admin. So
   `Confirm`/`Unlock` are exactly the transitions that flip whether criteria are visible at
   all to that caller — skipping their invalidation would let the cache serve a stale
   visibility decision (empty pre-confirm result, or a since-unlocked/mid-edit result) for up
   to the 30-minute TTL.
4. Wrap every new `RemoveAsync` call in a narrow try/catch: log the exception and continue —
   never let a Redis failure surface as an exception from a repository method that already
   completed its DB write successfully. This is what keeps `RubricParsingJob` (a background
   Hangfire job) from retrying/failing solely because of a cache hiccup.
5. Confirm placement is strictly after `SaveChangesAsync`/`TrySaveChangesAsync`, never before
   — an invalidation that runs before a write that then fails (e.g.
   `DbUpdateConcurrencyException` in `RubricRepository`'s `TrySaveChangesAsync`) must not have
   already cleared a still-valid cache entry.
6. Add test cases proving: creating/updating an assignment removes its cache key; creating a
   rubric, updating rubric metadata, updating rubric criteria, confirming a rubric, and
   unlocking a rubric each remove the matching criteria cache key; and a simulated
   `RemoveAsync` failure does not prevent any of these calls from returning its normal
   successful result.
7. Confirm no other write path exists for assignments/rubrics/criteria outside these two
   repositories (`ClassRepository`, `SubjectRepository`, `EnrollmentRepository` don't touch
   this data — matches spec.md's Assumptions) so invalidation coverage is complete without
   duplicating calls elsewhere.

## Success Criteria
- `dotnet test` on `AutoGrading.Catalog.Api.Tests` passes, including new invalidation and
  swallowed-failure cases for both repositories.
- Updating an assignment or a rubric/its criteria via the existing REST endpoints, then
  immediately calling the matching gRPC RPC, returns the new data — not a stale cached copy
  (matches spec.md Success Criterion #2), verified live in Phase 5.
- A rubric criteria update triggered by `RubricParsingJob` (not just the REST endpoint) also
  invalidates the criteria cache — verified live in Phase 5 by re-uploading a rubric and
  waiting for AI parsing to complete.
- Simulated Redis failure during a `RemoveAsync` call does not change the HTTP/DB-level
  outcome of the write (still 200/success), confirmed by the new unit tests.

## Risks
- Placing invalidation before `SaveChangesAsync` instead of after would clear a cache entry
  for a write that then fails, leaving no cache miss to naturally repopulate it until TTL
  expiry — mitigated by step 5's explicit ordering check and a corresponding test.
- Missing `UpdateCriteriaAsync`'s invalidation would leave `RubricParsingJob`'s AI-parsed
  criteria uncached-fresh until the 30-minute TTL — this is the exact scenario spec.md calls
  out as the reason invalidation lives in the repository layer rather than only at REST
  endpoints; mitigated by explicitly including `UpdateCriteriaAsync` in step 3 and testing it
  in step 6.
- A broad try/catch around the invalidation call could mask a genuine bug in key construction
  (e.g. wrong key format silently "succeeding" by catching its own exception) — mitigated by
  catching only around the `ICacheService.RemoveAsync` call itself, with the key string built
  and logged before the call so a malformed key is visible in logs even when the removal
  itself doesn't throw.
- Cache-aside invalidate-then-stale-repopulate race: a reader that started its DB read before
  a concurrent writer's `SaveChangesAsync`+`RemoveAsync` could still call `SetAsync` afterward
  with the pre-update value, leaving stale data cached with a fresh 30-minute TTL. Not fixed
  in this plan — accepted as a residual risk bounded by the 30-minute TTL, given how
  infrequently assignments/rubrics change relative to how often they're read (per
  plan-reviewer NOTED finding).
