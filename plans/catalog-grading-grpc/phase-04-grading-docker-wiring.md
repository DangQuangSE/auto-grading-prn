# Phase 4: Grading Docker Compose wiring

**Covers:** P1 story #1 (end-to-end path reachable in the real deployment topology). FR-03
(Grading side), FR-04.

## Requirements
The `grading-api` container is configured with Catalog's gRPC address and can reach it over
the Docker network at startup, with dependency ordering that still gates `grading-api` on
`catalog-api` being healthy.

### Tests to Write First
- A config-binding test (or startup assertion) that the gRPC client registration throws a
  clear error when Catalog's gRPC address config is absent — written first so "fail fast on
  missing config" is proven before the environment variable is wired in docker-compose.

## Steps
1. Add the Catalog gRPC address as an environment variable on `grading-api` in
   `docker-compose.yml`, pointing at `catalog-api`'s internal gRPC port from Phase 2.
2. Confirm `grading-api`'s existing `depends_on`/healthcheck ordering (gated on
   `catalog-api: service_healthy`) now correctly reflects "Catalog is fully up" for both
   its REST and gRPC surfaces, since Phase 2 changed the healthcheck to probe both.
3. Rebuild `grading-api` and bring up the `catalog-api` + `grading-api` subset (with their
   shared dependencies) via docker compose.
4. Exercise the gRPC path directly by triggering `AiGradingJob` against a seeded
   assignment/rubric/enrollment and confirm Grading's logs show the gRPC client succeeding.

## Success Criteria
- `docker compose up catalog-api grading-api` (with declared dependencies) starts both
  containers healthy.
- A manual smoke run of the AI-grading job against seeded data completes with Grading's
  logs showing successful gRPC calls to Catalog (no `UNAVAILABLE`/`UNAUTHENTICATED`
  entries, no fallback to any HTTP call for these 3 methods).

## Risks
- A missing or misnamed gRPC address environment variable causing a startup-time or
  first-call failure instead of a build-time error: mitigated by failing fast (the gRPC
  client registration should throw clearly if the address config is absent) and confirming
  via the manual smoke run in this phase before moving to full end-to-end verification.
