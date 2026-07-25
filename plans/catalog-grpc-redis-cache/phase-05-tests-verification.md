# Phase 5: Tests + manual verification

**Covers:** All FRs (FR-01–FR-06), all P1/P2 user stories, and every bullet in spec.md's
Success Criteria — this phase is the closing proof, not new product behavior.

## Requirements
The full Catalog test suite (existing + everything added in Phases 1–4) passes, and every
bullet in spec.md's Success Criteria is demonstrated against a real `docker compose up` stack,
not just unit tests — matching this repo's established verification bar (see
`plans/catalog-grading-grpc/phase-05-e2e-verification.md` for the precedent this plan follows).

## Steps
1. Run `dotnet test` across the solution (or at minimum `AutoGrading.Common.Tests` +
   `AutoGrading.Catalog.Api.Tests`) and confirm 0 failures, 0 regressions versus the
   pre-feature baseline.
2. Bring up the full stack via `docker compose up -d --build` (including the new `redis`
   service) and confirm every container, including `redis` and `catalog-api`, reports
   healthy.
3. Demonstrate cache hit/miss observability: call `GetAssignment` and
   `GetCriteriaForAssignment` twice each for the same `assignmentId` (via `grpcurl` or a
   throwaway script, service-role JWT) and show the "cache miss" log line on the first call
   and "cache hit" on the second, with no second DB query — direct evidence for spec.md
   Success Criterion #1.
4. Demonstrate invalidation correctness end-to-end: update an assignment via its existing
   REST endpoint, immediately re-call `GetAssignment`, and confirm the new data comes back;
   repeat for a rubric criteria update via the REST rubric-editing flow — direct evidence for
   spec.md Success Criterion #2. Also cover the background path: re-upload a rubric file,
   wait for `RubricParsingJob` to finish AI parsing, and confirm `GetCriteriaForAssignment`
   reflects the newly parsed criteria without a stale cache hit.
5. Demonstrate FR-05's failure fallback live: stop the `redis` container while `catalog-api`
   keeps running, call both RPCs, and confirm they still return correct data (DB fallback)
   with no RPC-level error — then restart `redis` and confirm caching resumes.
6. Demonstrate FR-06 live: call `GetCriteriaForAssignment` with a non-`service`-role JWT and
   confirm rejection; call it with a `service`-role JWT and confirm success — reconfirming
   Phase 2's fix still holds once the full caching stack is layered on top.
7. Confirm `docker compose up` (full stack, no service filter) still succeeds cleanly from a
   fresh state — direct evidence for spec.md Success Criterion #3 — and that no existing REST
   endpoint or the `GetLecturerStudentIds`/other-RPC behavior regressed.
8. Record the evidence (commands run + observed output, not just "it passed") in this plan's
   Session Notes for the finalize step, matching this repo's convention on prior plans.

## Success Criteria
- `dotnet test` reports 0 failures across all affected test projects.
- All 3 spec.md Success Criteria bullets confirmed with live, non-mocked evidence:
  cache-hit-avoids-DB-query (step 3), post-update-reads-fresh-data (step 4), and
  `docker compose up` brings up Redis + Catalog connected (step 2/7).
- FR-05's fallback (step 5) and FR-06's authorization (step 6) both independently reconfirmed
  against the live stack, not just at the unit-test level from Phases 2–4.
- No regression in existing Catalog REST endpoints or the unrelated
  `GetLecturerStudentIds` RPC.

## Risks
- A passing unit-test suite could still hide an integration-only failure (e.g. real
  `StackExchange.Redis` serialization edge case not exercised by an in-memory fake) —
  mitigated by this phase's requirement for live, non-mocked verification against a real
  Redis container, not just unit tests.
- Demoing cache-hit-avoids-DB-query convincingly requires an observable signal (log line or
  query counter) — mitigated by Phase 3 step 5 already producing hit/miss log lines
  specifically for this purpose.
- Live verification steps are manual and time-consuming to redo if a later change regresses
  caching — mitigated by capturing the exact commands/scripts used in Session Notes so they're
  re-runnable, following this repo's existing pattern from `plans/catalog-grading-grpc/`.
