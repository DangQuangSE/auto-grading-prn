# Phase 2: Catalog Kestrel + Docker Compose wiring

**Covers:** P1 story #2 (distinct gRPC port, callable independently of REST/Gateway). FR-02, FR-03.

## Requirements
Catalog's container exposes gRPC on its own dedicated HTTP/2 port (container `8081`),
separate from the existing REST port (`8080`, HTTP/1.1), reachable by other containers on
the Docker network and, for manual verification, from the host on port `5012`. The existing
REST port and healthcheck are unaffected. The container healthcheck also verifies the gRPC
port itself (not just REST), so a Kestrel dual-protocol misconfiguration is caught by
orchestration, not only by a one-time manual check.

### Tests to Write First
- A test asserting Kestrel's Catalog `Program.cs` config produces two distinct listen
  endpoints (REST HTTP/1.1 on 8080, gRPC HTTP/2-only on 8081) — or, if a unit test isn't
  practical for Kestrel binding config, a scripted `grpcurl`/health-probe check written
  before the Kestrel change lands, so it fails red against today's single-port setup and
  passes green only once both endpoints exist.
- A scripted assertion that the container healthcheck fails when the gRPC listener is down
  but REST is up (simulate by misconfiguring one endpoint locally) — written before adding
  the gRPC health probe, to prove the healthcheck actually covers gRPC and isn't just
  decorative.

## Steps
1. Configure Kestrel in Catalog's `Program.cs` with two explicit listen endpoints: the
   existing REST port restricted to HTTP/1.1, and a new port restricted to HTTP/2 (h2c,
   no TLS) for gRPC — never both protocols on one insecure port.
2. Add the `Grpc.HealthCheck` package and register `grpc.health.v1.Health` alongside the
   Catalog gRPC service from Phase 1, so the gRPC port itself is queryable for liveness.
3. Update Catalog's `Dockerfile` to expose the new gRPC port alongside the existing one.
4. Update `docker-compose.yml`'s `catalog-api` service: map the new container port to host
   `5012`, and change the container healthcheck to probe **both** surfaces — keep the
   existing REST `/health` curl check and add a `grpc_health_probe` (or equivalent, e.g. a
   `grpcurl -plaintext localhost:8081 grpc.health.v1.Health/Check`) call, failing the
   healthcheck if either probe fails.
5. Rebuild and bring up `catalog-api` (with its dependencies) via docker compose in
   isolation to confirm both ports start cleanly with no Kestrel binding errors.
6. Verify the gRPC port is reachable and serving the Catalog service (e.g. via `grpcurl`
   reflection/list or a raw unary call) while confirming the REST port still answers
   `/health` and an existing endpoint unaffected.
7. Deliberately break the gRPC endpoint locally (e.g. temporarily misconfigure the Kestrel
   port) and confirm the container healthcheck now reports unhealthy — proving the added
   gRPC probe actually gates `depends_on: service_healthy` for `grading-api` in Phase 4.

## Success Criteria
- `docker compose up catalog-api` (with its declared dependencies) reports the container
  healthy, with the healthcheck covering both REST and gRPC.
- `grpcurl -plaintext localhost:5012 list` (or equivalent) successfully lists the Catalog
  gRPC service defined in Phase 1.
- `grpcurl -plaintext localhost:5012 grpc.health.v1.Health/Check` (or equivalent probe)
  returns `SERVING`.
- `curl http://localhost:5002/health` (existing REST healthcheck) continues to return 200
  with no change in response.
- A deliberately broken gRPC listener causes the container healthcheck to report unhealthy
  (step 7) — proving the probe isn't a no-op.

## Risks
- Kestrel `Http1AndHttp2` single-port misconfiguration causing silent gRPC `UNAVAILABLE`
  errors: mitigated by using two fully separate listen endpoints/ports per the locked
  technical approach, verified immediately via `grpcurl` before any client work begins, and
  now also caught continuously by the gRPC health probe rather than only at implementation
  time.
- Host port `5012` collision with a pre-existing local process: mitigated by pre-verified
  freedom against all current port mappings; remap if it recurs.
- Healthcheck script complexity (probing 2 protocols in one Docker `HEALTHCHECK`): keep the
  combined check simple (two sequential probes, fail if either fails) to avoid the
  healthcheck itself becoming a new source of flakiness.
