# Phase 1: `ICacheService` + Redis DI wiring

**Covers:** FR-04 (Redis added to `docker-compose.yml`), part of the technical foundation for
FR-01/FR-02/FR-03/FR-05 (nothing in later phases can cache or invalidate without this).

## Requirements
Catalog can talk to a Redis instance through a new `ICacheService` abstraction living in
`AutoGrading.Common`, registered the same way `IObjectStorage`/`IEventBus` already are, with
Redis running as its own container in `docker-compose.yml` and reachable from Catalog by
service name on the Docker network.

## Steps
1. Add the `StackExchange.Redis` package reference to `AutoGrading.Common.csproj`, matching
   how `RabbitMQ.Client`/`Minio` are already referenced there.
2. Create `AutoGrading.Common/Caching/ICacheService.cs` with three methods —
   `GetAsync<T>(key)`, `SetAsync<T>(key, value, TimeSpan ttl)`, `RemoveAsync(key)` — mirroring
   the doc-comment style and file placement of `IObjectStorage.cs`.
3. Create `AutoGrading.Common/Caching/RedisCacheOptions.cs` (connection string / config
   section name), following `MinioOptions.cs`'s shape exactly (a `SectionName` const + plain
   settable properties with dev-friendly defaults).
4. Implement `RedisCacheService : ICacheService` in the same folder: constructor takes
   `IConnectionMultiplexer` (never `IDatabase` directly — fetch a fresh `IDatabase` via
   `multiplexer.GetDatabase()` inside every method call), serialize/deserialize values with
   `System.Text.Json`.
5. Add `AddCacheService(IServiceCollection, IConfiguration)` to
   `AutoGrading.Common/Extensions/ServiceCollectionExtensions.cs`: binds the config section,
   registers `IConnectionMultiplexer` as a singleton built with `AbortOnConnectFail = false`
   (so Catalog can start even if Redis isn't up yet — required for FR-05's fallback
   behavior), and registers `ICacheService` as a singleton.
6. Wire `builder.Services.AddCacheService(builder.Configuration)` into Catalog's
   `Program.cs` alongside the existing `AddEventBus`/`AddObjectStorage`/`AddOpenCodeClient`
   calls, and add a `"Redis"` config section to Catalog's `appsettings.json` matching the
   `"Minio"`/`"RabbitMq"` section shape already there.
7. Add a new `redis` service to `docker-compose.yml` using the `redis:7-alpine` image (no persistence volume needed
   since this is a pure cache, a healthcheck via `redis-cli ping`, on `autograding-net`), then
   add `Redis__ConnectionString` (or equivalent) to `catalog-api`'s environment block and a
   `redis: { condition: service_started }` entry to `catalog-api`'s `depends_on` — NOT
   `condition: service_healthy`. `service_healthy` would block `catalog-api` from starting at
   all until Redis's healthcheck passes, which reintroduces at the orchestration layer the
   exact hard dependency that `AbortOnConnectFail = false` (step 5) was meant to remove, and
   would violate FR-05 / Success Criterion #3 if Redis is ever slow or fails to become healthy.
8. Bring up `redis` and `catalog-api` via `docker compose up` in isolation and confirm both
   report healthy with no connection errors in `catalog-api` logs.

## Success Criteria
- `dotnet build` succeeds for `AutoGrading.Common` and `AutoGrading.Catalog.Api` with the new
  package and files.
- `docker compose up redis catalog-api` (with declared dependencies) reports both containers
  healthy.
- Catalog's startup logs show no Redis connection errors when Redis is up.
- Starting `catalog-api` with Redis intentionally stopped still results in a healthy,
  functioning REST/gRPC surface (proves `AbortOnConnectFail = false` + singleton
  `IConnectionMultiplexer` registration doesn't crash the app on startup) — this is a
  pre-check for FR-05, fully exercised in Phase 5.

## Risks
- `IConnectionMultiplexer` registered with `AbortOnConnectFail = true` (the StackExchange.Redis
  default) would crash Catalog's startup whenever Redis is briefly unavailable — mitigated by
  explicitly setting `AbortOnConnectFail = false` in the options used to build the
  multiplexer, called out as a locked decision in step 5.
- Injecting `IDatabase` directly (instead of `IConnectionMultiplexer` + per-call
  `GetDatabase()`) would hold a stale/broken database reference across Redis reconnects —
  mitigated by only ever injecting `IConnectionMultiplexer` and re-resolving `IDatabase`
  inside every `ICacheService` method, per the locked decision.
