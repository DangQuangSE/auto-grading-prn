# Plan: Redis caching cho gRPC lookup của Catalog
Status: ✅ Complete — Step 4 code review passed (WARNING, user approved) — Step 5 finalize (project-manager) running
Date: 2026-07-25
Mode: Hard
Test: default (tests written inline per phase, alongside implementation — no separate TDD-first phase; matches this repo's existing convention of one test project per service, e.g. `AutoGrading.Catalog.Api.Tests`)

## Overview
Add server-side, cache-aside Redis caching in the Catalog service for the two gRPC lookups
Grading calls on every grading run (`GetAssignment`, `GetCriteriaForAssignment`), invalidated
precisely at the repository write paths that own that data, with a 30-minute TTL safety net —
a bonus feature per assignment brief §8, not a hard requirement.

## Phases
- [x] Phase 1: `ICacheService` + Redis DI wiring — new Redis-backed cache abstraction in `AutoGrading.Common`, plus `docker-compose.yml`/`appsettings.json` wiring.
- [x] Phase 2: FR-06 authorization fix — lock `GetCriteriaForAssignment` to `[Authorize(Roles = "service")]` before anything gets cached behind it.
- [x] Phase 3: Cache-aside reads — `AssignmentService`/`RubricService` read-through the cache for the two lookups, `CatalogGrpcService` stays a thin adapter.
- [x] Phase 4: Invalidation writes — `AssignmentRepository`/`RubricRepository` remove the relevant cache key after every successful `SaveChangesAsync` on a write path.
- [x] Phase 5: Tests + manual verification — unit test coverage for hit/miss/invalidation/fallback, plus a live `docker compose` walkthrough proving spec.md's 3 Success Criteria.

## Research Summary
No `plan-researcher` agents were run for this plan — the technical approach was already fully
resolved during `/ck:plan` Step 0 (see spec.md's "Resolved" section) and confirmed against the
brainstorm report. Key decisions carried into this plan, not re-litigated:

- **Library choice:** raw `StackExchange.Redis` (`IConnectionMultiplexer`) wrapped in a new
  `ICacheService`, not `IDistributedCache`/`Microsoft.Extensions.Caching.StackExchangeRedis` —
  the latter is byte[]-only and has no pattern-based key deletion, which doesn't fit typed-DTO
  caching or future wildcard invalidation. Follows the exact file-layout and DI-registration
  pattern already established by `IObjectStorage`/`MinioStorage`/`MinioOptions` in
  `AutoGrading.Common/Storage/` and `ServiceCollectionExtensions.AddObjectStorage`.
- **Cache-aside placement:** the Catalog *service* layer (`AssignmentService`, `RubricService`),
  not the gRPC adapter (`CatalogGrpcService` stays thin per its existing doc comment) and not
  the repository layer.
- **Invalidation placement:** directly in the repository layer
  (`AssignmentRepository.CreateAsync`/`UpdateAsync`, `RubricRepository.CreateAsync`/
  `UpdateAsync`/`UpdateCriteriaAsync`), AFTER `SaveChangesAsync` succeeds — this is the only
  layer that also covers `RubricParsingJob`'s background write through
  `UpdateCriteriaAsync`, without duplicating invalidation calls at every call site.
- **Failure handling:** a cache miss or an unreachable Redis on read must silently fall
  through to a normal DB read; a failed `RemoveAsync` on write must be logged and swallowed,
  never allowed to fail an already-successful DB write (critical for `RubricParsingJob`, a
  background Hangfire job that should not retry/fail over a cache hiccup).
- **Security prerequisite (FR-06):** `GetCriteriaForAssignment`'s result depends on caller
  identity (`RubricRepository.ListAsync`'s admin/owner filtering), so caching it by
  `assignmentId` alone is only safe because Grading always calls through a fixed service JWT
  (confirmed via `CatalogApiClient.cs` + `CatalogGrpcAuthenticator.AttachServiceToken` — no
  user JWT is ever forwarded). Locking the RPC to `[Authorize(Roles = "service")]` closes the
  gap where a different-identity caller could read another identity's cached response, and
  must land before caching does.
- **TTL:** 30 minutes fallback on every `SetAsync`, alongside active invalidation.
- **Keys:** `catalog:assignment:{assignmentId}` and `catalog:criteria:{assignmentId}`.

**Chosen approach:** server-side cache in Catalog (not client-side in Grading) — see
[brainstorm report](../reports/260725-catalog-grpc-redis-cache-brainstorm.md). Server-side
still costs a gRPC round-trip on a hit, but lets Catalog invalidate precisely at its own
existing write paths instead of Grading relying on TTL-only staleness tolerance.

## Dependencies
- `StackExchange.Redis` NuGet package (new addition to `AutoGrading.Common.csproj`) — standard,
  no version conflicts expected against the existing .NET 8 stack.
- Redis image (`redis:7-alpine` or similar) added to `docker-compose.yml` — no external/cloud
  dependency, single-instance, no cluster/HA (out of scope per spec.md Assumptions).
- Phase 3 depends on Phase 1 (needs `ICacheService` registered) and Phase 2 (must not cache
  behind an under-authorized RPC). Phase 4 depends on Phase 1. Phase 5 depends on all prior
  phases.

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-07-25 17:45
**Phase in progress:** Step 3.S auto-simplify (complete) — next: Step 4 code review
**Status:** All 5 phases done + Step 3.S simplify pass applied. `dotnet test` 39/39 green on
Catalog after simplify fixes. Full stack previously verified clean (all 12 containers healthy
incl. `redis`). All 3 spec.md Success Criteria + FR-05 + FR-06 demonstrated live against the
real containers (not mocks). Ready for Step 4 code review pending user approval (hard mode —
no auto-approve).

### Step 3.S — auto-simplify (this session)
Triggered because touched-file count (13 tracked + 5 new production files) exceeded the
`fileCount: 8` threshold in `.ck.json`; total production LOC (~430 across tracked diff +
new `Caching/` files) was borderline around the `totalLoc: 400` threshold too. Ran the
`simplify` skill's 4 parallel review agents (reuse / simplification / efficiency / altitude)
against every file touched by Phases 1-4. Applied:
- **Simplification:** `RubricRepository.ConfirmAsync`/`UnlockAsync` had identical bodies
  (`TrySaveChangesAsync` → `InvalidateCriteriaAsync` → return) — collapsed into a shared
  private `SaveAndInvalidateAsync` helper.
- **Simplification:** `AssignmentService`/`RubricService` each declared their own
  `private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30)` — hoisted to
  `CacheKeys.DefaultTtl` (`Caching/CacheKeys.cs`), the file already documented as the single
  source of truth for cache-key concerns.
- **Altitude:** `IRubricService.GetCriteriaForAssignmentAsync` took `userId`/`isAdmin`
  parameters but built a cache key with no identity component — safety depended entirely on
  a doc comment plus `CatalogGrpcService`'s `[Authorize(Roles = "service")]` attribute living
  in a different file, so any future caller passing a real user's identity would have cached
  that user's filtered result under a global per-assignment key and leaked it to every other
  caller. Fixed by dropping `userId`/`isAdmin` from the method signature entirely — the
  implementation now always queries with a fixed `Guid.Empty` sentinel (never a real
  `LecturerId`), so the result is provably always the Confirmed-only view regardless of who
  calls it. Updated `CatalogGrpcService.GetCriteriaForAssignment` (no longer reads
  `caller.GetUserId()`/`IsInRole("admin")` for this RPC) and 4 test call sites in
  `RubricServiceTests.cs` to match. **Caught mid-fix:** an initial version passed
  `userId: null` instead of `Guid.Empty`, which would have incorrectly matched Draft
  school-wide rubrics (`LecturerId == null` for those) — corrected before running tests.
- **Skipped (efficiency finding):** `ConnectionMultiplexer.Connect(...)` in
  `ServiceCollectionExtensions.AddCacheService` is synchronous and runs on whichever request
  thread first resolves the singleton, not at host startup. A proper fix needs an async-lazy
  DI pattern or a startup warm-up hosted service — judged out of scope for a simplify pass;
  `AbortOnConnectFail = false` already means this is a one-time cold-start cost, not a
  recurring one.
- **Reuse:** no findings — all new code (options binding, DI registration shape, JSON
  serialization, log-and-swallow pattern) already follows existing `AutoGrading.Common`
  conventions (`AddObjectStorage`/`AddEventBus`, `RabbitMqOptions.SectionName`, etc.).
- Re-ran `dotnet build` (0 errors) and `dotnet test` on `AutoGrading.Catalog.Api.Tests`
  (39/39 passed) after all fixes.

### Decisions made this session (Phase 4)
- Added `AutoGrading.Common.Caching.CacheServiceExtensions.InvalidateAsync` — the write-side
  counterpart to `GetOrSetAsync<T>`: logs the key before calling `ICacheService.RemoveAsync`
  (so a malformed key is visible in logs even when removal doesn't throw), wraps the call in
  try/catch+log per FR-05 so a Redis failure never fails an already-successful DB write.
- `AssignmentRepository`/`RubricRepository` constructors now take `ICacheService cache` +
  `ILogger<T> logger` alongside `CatalogDbContext`. No interface changes — DI resolves the new
  constructor params automatically via the existing `AddScoped<IXRepository, XRepository>()`
  registrations in `Program.cs`.
- `AssignmentRepository.CreateAsync`/`UpdateAsync` call
  `cache.InvalidateAsync(logger, CacheKeys.Assignment(id), ct)` immediately after
  `SaveChangesAsync` succeeds; `UpdateAsync`'s not-found early return (`return null`) happens
  before that line, so a no-op update never touches the cache.
- `RubricRepository.CreateAsync`/`UpdateAsync`/`UpdateCriteriaAsync`/`ConfirmAsync`/
  `UnlockAsync` all call a new private `InvalidateCriteriaAsync(rubric, ct)` helper immediately
  after their respective `SaveChangesAsync`/`TrySaveChangesAsync` succeeds. The helper no-ops
  when `rubric.AssignmentId` is null (e.g. a `SchoolWide`-scope rubric never tied to an
  assignment) since `CacheKeys.Criteria` has no cache entry to invalidate in that case.
  `TrySaveChangesAsync`'s `DbUpdateConcurrencyException` naturally satisfies "invalidate only
  after a successful save" — when it throws, the `await` in the calling method never reaches
  the `InvalidateCriteriaAsync` line, so no extra guard was needed.
- Added `Repository/AssignmentRepositoryTests.cs` and `Repository/RubricRepositoryTests.cs`
  (new test files, one per repository) proving: each write method invalidates its cache key
  (seed a sentinel value via `cache.SetAsync`, call the write, assert `cache.GetAsync` now
  returns null); a simulated `RemoveAsync` failure (`cache.ThrowOnAccess = true`) doesn't
  prevent the write from returning its normal successful result; a rubric with no
  `AssignmentId` doesn't throw on create.
- Updated the three existing `CreateService()` test helpers
  (`Service/AssignmentServiceTests.cs`, `Service/RubricServiceTests.cs`,
  `Grpc/CatalogGrpcServiceTests.cs`) to pass the same shared `FakeCacheService` instance into
  both the repository and the service constructors — mirrors the real DI singleton wiring,
  where one `ICacheService` instance is injected into both layers.
- TDD: new repository tests initially failed to compile (`CS1729`: no 3-argument constructor)
  — treated as red, then implementation added until `dotnet test` was green (39/39) and
  `dotnet build` on the full solution had 0 errors.

### Phase 5 — live verification evidence

**Setup:** `docker compose up -d --build` from a fully clean Docker state (all prior
containers/images removed by user mid-session after two infra interruptions) — all 12
containers reported healthy: `sqlserver`, `redis`, `rabbitmq`, `minio`, `identity-api`,
`catalog-api` (incl. gRPC health probe on :8081), `submission-api`, `grading-api`,
`notification-api`, `gateway`, `admin-web`, `user-web`.

**Step 1 — `dotnet test`:** 57/57 passed, 0 failures (39 `AutoGrading.Catalog.Api.Tests` + 4
`AutoGrading.Common.Tests` + 14 `AutoGrading.Grading.Api.Tests`).

**Tooling:** no `grpcurl` available locally, so a throwaway .NET console probe
(`grpc-probe`, in the session scratchpad — not committed) was built against the real
`catalog.proto`, minting HS256 JWTs locally with the same `Jwt__Issuer`/`Jwt__Audience`/
`Jwt__SigningKey` the containers use (from `.env`), mirroring exactly what
`JwtTokenGenerator.GenerateServiceToken("grading")` does for the `service` role. Test data
(one Subject + one Assignment) was created via the real Catalog REST API using a real admin
JWT obtained from Identity's `/auth/login` (seeded test accounts, `Seed:TestAccounts=true`).

**Step 3 — cache hit/miss observability** (`catalog-api` logs,
`docker logs auto-grading-swd-catalog-api-1`): calling `GetAssignment` + `GetCriteriaForAssignment`
twice each for the same `assignmentId` with a minted service-role JWT produced:
```
Cache miss for key catalog:assignment:{id}.
Cache hit for key catalog:assignment:{id}.
Cache miss for key catalog:criteria:{id}.
Cache hit for key catalog:criteria:{id}.
```
— confirms Success Criterion #1 (no second DB query on the repeat call).

**Step 6 — FR-06 authorization, live:** same probe with a self-minted `student`-role JWT:
`GetAssignment` (class-level `[Authorize]` only) succeeded; `GetCriteriaForAssignment`
(`[Authorize(Roles = "service")]`) returned `RpcException PermissionDenied` / HTTP 403 both
times. Confirms FR-06 holds with the full caching stack layered on top.

**Step 4 — invalidation end-to-end, live:**
- Assignment: `PUT /assignments/{id}` (REST, admin JWT) with a changed title → catalog-api
  logged `Invalidating cache key catalog:assignment:{id}` → immediate next gRPC
  `GetAssignment` call returned the updated title (log: miss then hit, not a stale hit).
- Criteria: uploaded a rubric via `POST /rubrics/upload` (lecturer JWT) → triggered
  `RubricParsingJob` in the background (Hangfire) as designed; parsing failed against the
  placeholder file content used for this probe (logged as
  `RubricParsingJob: failed to parse rubric {id}; it remains in Parsing for Hangfire retry`,
  expected — no real docx/LLM content was supplied) and the rubric never reached `Draft`. To
  reach the same `RubricRepository.UpdateCriteriaAsync`/`ConfirmAsync` invalidation code path
  that Phase 4's unit tests already cover, the rubric's `Status` was flipped directly in the
  DB (`Parsing` → `Draft`, test-data-only fixup, no app code involved) to unblock
  `PATCH /rubrics/{id}/criteria`, then `POST /rubrics/{id}/confirm` (both lecturer JWT). Each
  call logged `Invalidating cache key catalog:criteria:{id}`, and the immediate next gRPC
  `GetCriteriaForAssignment` reflected the new criteria (`count=2`, not the stale `count=0`
  seen before the write) — same repository invalidation code the background
  `RubricParsingJob` path uses on a successful parse, already covered by Phase 4's
  `RubricRepositoryTests`. Confirms Success Criterion #2.
- Note: `RubricRepository.ListAsync`'s non-admin caller filter (`Status == Confirmed ||
  LecturerId == callerId`) meant the service-role caller (Grading, `Guid.Empty` identity)
  only saw the rubric's criteria once it was `Confirmed` — a `Draft` rubric owned by a real
  lecturer is correctly invisible to the service token, matching FR-06's design intent.

**Step 5 — FR-05 fallback, live:** `docker stop auto-grading-swd-redis-1`, then re-ran the
probe: both RPCs still returned correct data (`GetAssignment` title, `GetCriteriaForAssignment`
count=2), no RPC-level error. Logs showed the expected warn-and-swallow pattern —
`RedisConnectionException` on both `GetAsync` and `SetAsync` for each key, logged as
`Cache read failed ... falling back to source` / `Cache write failed ...`, followed by
`Cache miss` (DB fallback), never an RPC failure. Restarted Redis
(`docker start auto-grading-swd-redis-1`, waited for `healthy`), re-ran the probe again — logs
returned to normal `Cache hit` for every key, confirming caching resumed without a restart of
`catalog-api`.

**Step 2/7 — full stack:** already confirmed at session start (`docker compose up -d --build`,
full stack, no filter) — 12/12 containers healthy from a clean state. No REST endpoint or
`GetLecturerStudentIds` regression observed; REST calls used throughout this verification
(`/auth/login`, `/subjects`, `/assignments`, `/rubrics/*`) all behaved as before.

### Step 4 — code review (hard mode)
`code-reviewer` verdict: **WARNING** (0 CRITICAL, 0 HIGH, 4 MEDIUM, 3 LOW). Verified: FR-05
swallow-and-log on every exception path, FR-06 role gate correctly enforced and tested against
the real ASP.NET Core authorization pipeline, `Guid.Empty` sentinel claim holds (Identity never
issues an all-zero user id), invalidate-after-save ordering correct on every write path incl.
the `DbUpdateConcurrencyException` path, no cache-key-collision risk.

Fixed immediately (cheap, in-scope):
- **`Assignment.Subject`/`Assignment.Rubrics`** had no `[JsonIgnore]`, unlike
  `RubricCriterion.Rubric` which already carries one for the same reason — caching the raw EF
  entity risked silently serializing a much larger graph into Redis if a future query path adds
  `.Include()`, or a circular-reference blowup under lazy-loading proxies. Added
  `[JsonIgnore]` to both, matching the existing pattern. Confirmed safe: REST endpoints
  serialize `AssignmentResponse`/`RubricResponse` DTOs, never the domain entity directly, so
  this doesn't change any REST response shape. Re-ran `dotnet test` (39/39 green) after.

Left open for user decision (all MEDIUM, none blocking, all defensible tradeoffs for a course
bonus feature rather than defects):
1. `ConnectionMultiplexer.Connect(...)` blocks the first-request thread instead of connecting
   asynchronously at startup (`ServiceCollectionExtensions.cs:57-64`).
2. Cache-aside has no read/write coordination — a race between a concurrent DB read (post cache
   miss) and a concurrent write+invalidate could in theory repopulate a stale value for up to
   the 30-min TTL.
3. `redis` in `docker-compose.yml` has no password, unlike `sqlserver`/`rabbitmq`/`minio` which
   all do.
4. `StackExchange.Redis` is now a transitive dependency of every service via
   `AutoGrading.Common`, even though only Catalog uses it.

LOW notes (not actioned): `FakeCacheService` test double doesn't round-trip through real JSON
serialization; unused `CancellationToken` params in `RedisCacheService` (library limitation,
not a bug).

**User decision (hard-mode gate):** Approved. All 4 MEDIUM findings accepted as defensible
tradeoffs for a course bonus feature, no further code changes requested. Proceeding to Step 5.

### Next immediate action
Step 5 finalize in progress: project-manager, docs-manager, spec coverage report.
git-manager's commit step is skipped this run — user will commit manually.

## Risks
- HIGH: Caching `GetCriteriaForAssignment` by `assignmentId` alone before FR-06 lands would
  let any authenticated caller's request populate/read a cache entry regardless of role —
  mitigated by making Phase 2 (authorization fix) a hard prerequisite of Phase 3 (caching),
  never landed out of order.
- MEDIUM: A write path invalidation gets missed (e.g. a future new mutation method bypasses
  the repository layer) → stale cache served until TTL expiry — mitigated by placing
  invalidation in the repository layer (the single choke point all current and
  `RubricParsingJob` writes go through) and covering it in Phase 5 with the spec's
  "update → immediately re-read → get fresh data" acceptance test.
- MEDIUM: Redis becomes a new availability dependency for two hot RPCs if fallback isn't
  implemented correctly — mitigated by FR-05: every `GetAsync`/`SetAsync`/`RemoveAsync` call
  in `ICacheService`'s consumers is wrapped so a Redis exception degrades to a DB read/no-op,
  never an RPC failure; explicitly tested in Phase 5 by simulating Redis unavailability.
- LOW: `docker-compose.yml` growing another service could complicate the Deployment
  requirement (assignment brief §3/4) — mitigated by keeping Redis config minimal
  (single container, no persistence volume required since it's a pure cache, not a source of
  truth) and confirming `docker compose up` still brings up the full stack cleanly in Phase 5.
- LOW: Existing `CatalogGrpcServiceTests.CreateService()` test helper constructs
  `AssignmentService`/`RubricService` directly and will break once those constructors take a
  new `ICacheService` dependency — mitigated by Phase 3 updating that helper as part of its
  inline test changes (not deferred to Phase 5).
