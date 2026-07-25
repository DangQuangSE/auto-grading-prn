# Plan: Submission → Catalog over gRPC
Status: ✅ Complete
Date: 2026-07-25
Mode: Hard

## Overview
Migrate Submission's two Catalog lookups (`GetAssignmentAsync`, `GetLecturerStudentIdsAsync`) from REST/`HttpClient` to gRPC, mirroring Grading's existing gRPC client pattern exactly, and add a `max_attempts` field to the shared `AssignmentReply` proto message along the way.

## Phases
- [x] Phase 1: Proto and shared authenticator — add `max_attempts` to `catalog.proto`, populate it server-side, and extract `CatalogGrpcAuthenticator` out of Grading into `AutoGrading.Common`
- [x] Phase 2: Submission gRPC client — replace Submission's REST `CatalogApiClient` with a gRPC implementation and wire it into DI/config
- [x] Phase 3: Tests, docker-compose, cleanup — bring Submission's test coverage up to Grading's precedent, update container config, remove dead REST code, verify both services' test suites

## Research Summary
Findings already folded into `plans/submission-catalog-grpc/spec.md` (source of truth for scope/FRs/acceptance criteria). Key points carried into this plan:

- Grading's `Clients/CatalogApiClient.cs`, `CatalogGrpcAuthenticator.cs`, `ServicesOptions.cs`, and `Program.cs` DI wiring (`AddGrpcClient<CatalogGrpcClient>` + `.ConfigureChannel(...UnsafeUseInsecureChannelCallCredentials = true)` + `.AddCallCredentials(...)`) are the direct template for Submission's equivalents.
- Each service compiles its own gRPC client stub straight from Catalog's `.proto` file via a `<Protobuf Include=... GrpcServices="Client" .../>` MSBuild item — there is no shared NuGet package, so the new `max_attempts` field is additive/wire-compatible and cannot cause cross-project staleness.
- `CatalogGrpcAuthenticator` is stateless and Grading-agnostic (mints a token and stamps gRPC metadata) — it is a pure move to `AutoGrading.Common.Auth`, not a refactor. `ServicesOptions` stays duplicated per service per FR-03/Out-of-Scope since it also carries per-service REST base-URL fields.
- Submission's REST `ServiceAuthHandler` (used for its other outbound REST calls) is untouched — only the Catalog client registration changes.

## Dependencies
- Catalog's gRPC service (`AutoGrading.Catalog.Api`, port 8081) must already be reachable from both Grading's and Submission's containers — no network/service-discovery change needed (per spec Assumptions).
- Phase 2 depends on Phase 1 (proto field and `Common.Auth.CatalogGrpcAuthenticator` must exist before Submission references them).
- Phase 3 depends on Phase 2 (tests target the new client; docker-compose change assumes the client is wired).

## Risks
- HIGH: Phase 1 modifies Grading (moving `CatalogGrpcAuthenticator` into `Common`, changing its namespace and Grading's `Program.cs` reference) even though this feature is scoped to Submission and Grading's runtime behavior must not change. **Flag for plan-reviewer**: confirm the authenticator move is genuinely behavior-preserving (same token contents, same metadata key) and that Grading's existing gRPC tests are re-run, not just moved, before this is considered safe.
- CRITICAL (plan-review finding, fixed): the authenticator move requires adding a `Grpc.Core.Api` package reference to `AutoGrading.Common.csproj`/`AutoGrading.Common.Tests.csproj` — moving the file as-is without this would not compile, since `Common` currently has zero `Grpc.*` references. Now an explicit step in phase-01 (step 3) before the move happens.
- NOTED (plan-review finding): adding a `Grpc.Core.Api` reference to `AutoGrading.Common` makes it a transitive dependency of every project that references `Common` — Identity, Notification, and Gateway included, none of which build gRPC clients today. Accepted tradeoff (three of six consumers already do gRPC, and it's a thin metadata-only package), but called out here as a conscious decision rather than an incidental side effect.
- HIGH (plan-review finding, fixed): deploy-order gap between Catalog's field population (Phase 1) and Submission's gRPC client (Phase 2) — if Submission's client shipped against a Catalog instance still on the old `ToReply`, `max_attempts` decodes to proto3 default `0`, and Submission's `used >= maxAttempts` check would reject every first submission attempt. Low practical severity here since `docker-compose up` rebuilds all services from one commit (no independent deploy path exists in this repo), but Phase 1 must land and its tests pass before Phase 2 is cut over in any environment that *does* deploy independently. Documented explicitly in phase-01's Risks.
- MEDIUM: `max_attempts` being `optional int32` on the wire — if Catalog's `ToReply` forgets to set it (e.g. only sets it inside an `if` like the existing `Description` pattern), Submission's `AssignmentDto` parsing must handle the "field not present" case explicitly (default 0) rather than assuming it's always populated. Mitigation: always set `MaxAttempts` unconditionally in `ToReply` since it's a non-nullable domain `int`, unlike `Description`.
- MEDIUM: Deleting the REST `CatalogApiClient.cs` and its config (`Services:CatalogApiBaseUrl`) is a one-way door (FR-07, no dual-mode fallback) — if the gRPC wiring has a bug, Submission loses all Catalog access, not just a fallback path. Mitigation: land and verify Phase 2/3 tests and a local `docker-compose up` smoke check before merging.
- LOW: `docker-compose.yml` still has stray references to the old `Services__CatalogApiBaseUrl` var for `submission-api` if the edit is incomplete. Mitigation: grep the file for `CatalogApiBaseUrl` after the edit to confirm zero remaining hits for `submission-api`.

## Plan Review
Reviewed by `plan-reviewer` on 2026-07-25. Verdict: BLOCK → all findings resolved below, plan now clear to proceed.
- CRITICAL "missing Grpc.Core.Api package reference" → **ACCEPTED**, fixed in phase-01 step 3.
- HIGH "deploy-order gap / max_attempts=0 rollout window" → **ACCEPTED**, fixed in phase-01 Risks with explicit sequencing note.
- HIGH "transitive gRPC dependency spillover into Identity/Notification/Gateway" → **NOTED** above as a conscious tradeoff, not blocking.
- 6 additional questions investigated (test re-run mandate, namespace reference completeness, DI/assembly ordering, proto/DTO compatibility, JWT allowlist model, docker-compose reachability) → all **REJECTED** as gaps; reviewer confirmed the plan's existing claims held up against the actual codebase.

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-07-25 22:30
**Phase in progress:** phase-01-proto-and-shared-authenticator (complete)
**Status:** Phase 1 implemented (TDD red→green), simplify pass run, awaiting code-reviewer + Hard-mode approval gate before Phase 2

### Decisions made this session
- `max_attempts` added as plain `int32` (not `optional`), populated unconditionally in `ToReply` — avoids proto3 "field not set" ambiguity.
- `CatalogGrpcAuthenticator` moved to `AutoGrading.Common.Auth` with a new `callingServiceName` parameter (previously hardcoded `"grading"`), since it's now shared by Grading and (Phase 2) Submission.
- `Grpc.Core.Api 2.63.0` added to `AutoGrading.Common.csproj` before the move, matching the version already used elsewhere in the solution.
- Simplify pass (4 parallel review agents) ran on all 7 Phase 1 files; 4 findings surfaced, all skipped as either already-accepted tradeoffs or pre-existing codebase conventions out of scope for this phase — see below.
- Test suites green: Catalog 39/39, Common 15/15 (net of the 3 moved from Grading), Grading 12/12.

### Simplify findings — all skipped, no code changes
1. **Reuse** (hardcoded `"grading"`/`"submission"` literal instead of a config-sourced service name) — matches the existing `ServiceAuthHandler.cs` convention verbatim in both Grading and Submission; fixing it would mean refactoring that pre-existing pattern too, out of Phase 1 scope.
2. **Altitude** (`Grpc.Core.Api` dependency now transitive on all 5 `Common` consumers) — already surfaced by `plan-reviewer` and explicitly accepted by the user as a conscious tradeoff (see Risks/Plan Review above), not a new problem.
3. **Efficiency** (JWT minted fresh per gRPC call instead of cached until near-expiry) — mirrors the existing REST `ServiceAuthHandler`'s identical per-call minting behavior (by design, per this file's own XML doc comment); caching would be a separate cross-cutting change touching both transports, not specific to this diff.
4. **Simplification** (3 authenticator tests have overlapping coverage) — stylistic; keeping Bearer-prefix/Role/Email as separate assertions preserves per-concern test isolation on failure. `MaxAttempts` unconditional-vs-`Description`-guarded pattern was confirmed correct (non-nullable field), no action needed.

### Next immediate action
Spawn `code-reviewer` (Hard mode — no auto-approve) on the same diff, then surface the Review Gate for explicit user approval before starting Phase 2.

---

**Last active:** 2026-07-25 22:45
**Phase in progress:** phase-02-submission-grpc-client (complete)
**Status:** Phase 2 implemented (TDD red→green), full solution build + test suite green, awaiting code-reviewer + Hard-mode approval gate before Phase 3

### Decisions made this session
- `Submission`'s `ServicesOptions` only carries `CatalogGrpcAddress` (no `SubmissionApiBaseUrl` equivalent — Submission has no outbound peer calls of its own).
- `ServiceAuthHandler`/`AddTransient<ServiceAuthHandler>()` left untouched even though the Catalog REST call was its only consumer — removing it is out of scope for this phase (not flagged by the plan; Phase 3 only owns deleting the REST `CatalogApiClient.cs`).
- TDD applied by writing `CatalogApiClientTests.cs` against the new gRPC-based constructor signature first (confirmed RED: `CS1503` — old client still took `HttpClient`), then rewriting `CatalogApiClient.cs` to the gRPC implementation (confirmed GREEN).
- Test scope mirrors Grading's `CatalogApiClientTests.cs` pattern but only for the 2 RPCs Submission's `ICatalogApiClient` exposes (no `GetCriteriaForAssignmentAsync`), plus asserts `MaxAttempts` mapping instead of `Title`/`Description`.
- Full solution build (`dotnet build AutoGrading.sln`) and full test run (`dotnet test AutoGrading.sln`) both green: Common 15, Grading 12, Submission 36 (32 pre-existing + 4 new), Catalog 39, Identity 38 — confirms Phase 1's Common/Grading changes and Phase 2's Submission changes coexist with no regressions anywhere in the solution.

### Next immediate action
Spawn `code-reviewer` (Hard mode — no auto-approve) on Phase 2's diff, then surface the Review Gate for explicit user approval before starting Phase 3.

---

**Last active:** 2026-07-25 22:55
**Phase in progress:** phase-02-submission-grpc-client (complete, reviewed)
**Status:** code-reviewer verdict WARNING (1 HIGH, 1 LOW) — LOW fixed, HIGH confirmed as already-scheduled Phase 3 work, not a Phase 2 defect. Awaiting Hard-mode approval before Phase 3.

### Code review findings
- **HIGH — `docker-compose.yml`'s `submission-api` block still sets `Services__CatalogApiBaseUrl` (old REST var), not `Services__CatalogGrpcAddress`.** Verified as correctly out of scope: phase-03's step 6 explicitly owns "update the container environment configuration for Submission's service to point at Catalog's gRPC address" — this is expected to still be the old value until Phase 3 runs, not a Phase 2 regression. No action taken now; tracked as Phase 3's first-class deliverable.
- **LOW — unused `using Microsoft.Extensions.Options;` in `Program.cs` (copy-pasted from Grading's template, Submission has no `IOptions<T>` consumer).** Fixed: removed. Rebuilt clean, 0 warnings/errors.

### Next immediate action
Surface Review Gate to user for explicit approval before starting Phase 3 (tests, docker-compose env var swap — which resolves the HIGH finding above, dead REST client deletion, full-suite verification).

---

**Last active:** 2026-07-25 23:15
**Phase in progress:** phase-03-tests-config-cleanup (complete)
**Status:** All 7 steps done. `docker-compose.yml`'s HIGH finding resolved. Full solution green (144/144). Live Docker smoke test confirmed a genuine Submission→Catalog gRPC round-trip. Awaiting code-reviewer + Hard-mode approval gate.

### Decisions made this session
- `docker-compose.yml`'s `submission-api` block env var swapped: `Services__CatalogApiBaseUrl` → `Services__CatalogGrpcAddress: http://catalog-api:8081` — resolves Phase 2's code-review HIGH finding. Grepped the file after the edit: zero remaining `CatalogApiBaseUrl` references anywhere for `submission-api`.
- `ServicesOptionsTests.cs` added, mirroring Grading's exact test shape (configured-address happy path + 3 missing-address `[Theory]` cases asserting the error message names the field).
- No dead REST `CatalogApiClient.cs` file existed to delete — Phase 2 rewrote the file in-place rather than leaving a parallel REST implementation, so phase-03 step 5 was already satisfied as a byproduct.
- Confirmed `CatalogGrpcAuthenticatorTests.cs` (moved to `Common.Tests` in Phase 1) already covers Submission's authentication usage generically (`callingServiceName` parameter), no Submission-specific authenticator test needed.
- Grepped Submission's test suite for stale references to the old REST `CatalogApiClient`/`HttpClient` construction — none found; `TestDoubles.cs`'s `FakeCatalogApiClient` implements `ICatalogApiClient` (the interface), unaffected by the REST→gRPC swap.
- Full solution build + test green: Common 15, Grading 12, Identity 38, Submission 40 (36 + 4 new `ServicesOptionsTests`), Catalog 39 — 144 total, 0 failures.
- **Live Docker smoke test performed** (`docker compose up -d --build sqlserver rabbitmq minio catalog-api submission-api`, plus `redis` auto-started as catalog-api's dependency): both containers reported `healthy`. Recognized that `AddGrpcClient`'s channel config is resolved lazily on first client use, so a clean boot log alone doesn't prove an actual RPC succeeded — minted a manual local-only test JWT (HS256, signed with the `.env` dev `JWT_SIGNING_KEY`/`Issuer`/`Audience`, role claim `student`) and called `POST /submissions/upload` on `submission-api:5003` with a random, non-existent `AssignmentId`. Result: clean `404 {"error":"Assignment not found."}` — confirmed via `docker compose logs` that this exercised the full path: Submission's `CatalogGrpcClient` → `catalog-api:8081` gRPC call → Catalog's EF query (cache miss, then DB `SELECT`) → gRPC `NotFound` status → Submission's `RpcException` catch → `SubmissionAssignmentNotFoundException` → 404. This is definitive proof of a genuine Submission→Catalog gRPC round-trip (auth, wire format, and error mapping all verified), not just a boot-time check. Stack torn down afterward (`docker compose down`); no containers left running; temp JWT script and scratch files were local-only and discarded.

### Code review findings
- **MEDIUM — orphaned `ServiceAuthHandler` DI registration and class left over from the REST client**, missed by Phase 2 since it was never the file directly touched by that phase's `CatalogApiClient.cs` rewrite. Reviewer correctly tied it to Phase 3's own "no dead REST-based Catalog code remains" success criterion. Fixed: deleted `Clients/ServiceAuthHandler.cs` and its `AddTransient<ServiceAuthHandler>()` registration in `Program.cs`. Confirmed via grep zero remaining references in Submission. Rebuilt clean (0 errors) and re-ran Submission's suite: 40/40 green.
- Verdict after fix: all Phase 3 findings resolved, 0 CRITICAL/HIGH/MEDIUM/LOW outstanding.

### Next immediate action
Surface Review Gate to user for explicit Hard-mode approval, then proceed to Step 5 Finalize (project-manager, docs-manager, git-manager).
