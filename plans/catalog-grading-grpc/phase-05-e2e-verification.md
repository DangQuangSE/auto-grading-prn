# Phase 5: End-to-end verification

**Covers:** P1 stories #1, #2, #3 (full acceptance), FR-07, and spec.md's Success Criteria
checklist in full.

## Requirements
The full submission -> extraction -> AI-grading -> publish flow works unchanged end-to-end
using the gRPC-backed Grading->Catalog path; unauthenticated/invalid gRPC calls are
rejected; the 3 existing Catalog REST endpoints are provably unaffected; every bullet in
`spec.md`'s Success Criteria section is checked off with observed evidence.

### Tests to Write First
- Not new unit tests (this phase is integration/acceptance-level) — instead, write out
  `spec.md`'s Success Criteria checklist as the literal test plan before running anything,
  so each manual/automated check in Steps 1–6 below maps 1:1 to a spec bullet decided in
  advance, rather than improvising verification after the fact.

## Steps
1. Bring up the full docker-compose stack and run the existing happy-path smoke test
   (`docs/testing-happy-path.md`) end-to-end: submission upload -> extraction -> AI grading
   -> grade publish.
2. Call Catalog's gRPC endpoint directly with no token and with an invalid/expired token
   (via `grpcurl` or a throwaway test client) and confirm both are rejected with
   `UNAUTHENTICATED`/permission-denied.
3. Call Catalog's 3 REST endpoints directly and compare responses against pre-change
   behavior to confirm no regression from the additive gRPC service.
4. Re-run Submission's own Catalog HTTP calls (`GetAssignmentAsync`,
   `GetLecturerStudentIdsAsync`) to confirm they're unaffected, since they share the
   Catalog process but are explicitly out of scope for conversion.
5. Run the full automated test suite (`dotnet test` across the solution) and confirm all
   Catalog/Grading unit tests from Phases 1 and 3, plus pre-existing tests, pass.
6. Walk `spec.md`'s Success Criteria checklist line by line and record the evidence for
   each bullet.

## Success Criteria
- The happy-path smoke test completes successfully (grade published) using the
  gRPC-backed Grading->Catalog path.
- A `grpcurl` call without a valid token, and one with an invalid token, both return
  `UNAUTHENTICATED`/permission-denied from Catalog's gRPC endpoint.
- Catalog's 3 REST endpoints and Submission's Catalog HTTP calls show no behavior change.
- `dotnet test` across the solution exits 0.
- Every bullet in `spec.md`'s Success Criteria section is checked off.

## Risks
- Hidden coupling between the new gRPC listener and Catalog's existing REST/Hangfire
  pipeline surfacing only under full-stack load: mitigated by running the full
  docker-compose stack (not just Catalog in isolation) for this phase's verification.
- Scope creep discovered late (e.g. temptation to also convert Submission->Catalog once the
  pattern works): explicitly out of scope per spec.md — flag and defer rather than
  expanding this phase.
