# Phase 3: Grading gRPC client conversion

**Covers:** P1 story #1 (AiGradingJob uses gRPC with no visible behavior change), P1 story #3
(client-side JWT attachment). FR-04, FR-05.

## Requirements
Grading's `ICatalogApiClient` implementation calls Catalog over gRPC instead of HTTP for all
3 methods, attaching the internal service JWT to every call the same way `ServiceAuthHandler`
does today for HTTP. The `ICatalogApiClient` interface itself, and everything that depends on
it (`AiGradingJob`, handlers), is unchanged.

### Tests to Write First
- Mapping tests for each of the 3 methods (proto reply → existing DTO shape) against a test
  double of the generated gRPC client, written before `CatalogApiClient`'s gRPC
  reimplementation exists, so they fail red until the mapping code is written.
- Not-found and empty-result-collection tests for each method — written first to lock in
  parity with today's HTTP behavior (e.g. `GetAssignmentAsync` returning `null` on
  not-found) before the gRPC version can silently change that contract.
- A test asserting the credentials interceptor attaches a `Bearer` token to outgoing call
  metadata — written first against the interceptor's expected behavior, before the h2c
  switch and interceptor wiring (steps 1a–2) are implemented.

## Steps
1. Reference the same `catalog.proto` from Grading's `.csproj` (client-codegen mode, relative
   path per the locked decision) and add the client-side gRPC packages.
1a. Enable HTTP/2 cleartext (h2c) support on the client before the channel is ever used:
   `Grpc.Net.Client` refuses insecure HTTP/2 connections by default and throws on the first
   call otherwise. Set
   `AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true)`
   (or equivalent `SocketsHttpHandler` configuration) during Grading's startup, before the
   Catalog gRPC channel/client is registered or used. This is required specifically because
   Catalog's gRPC port is deliberately non-TLS (h2c) inside the Docker network — without this
   switch, Phase 3/4's own success criteria (a real gRPC call succeeding) cannot pass.
2. Register the generated gRPC client for Catalog's address, composed with a call-credentials
   interceptor that mints and attaches a fresh internal service JWT per call — the gRPC
   equivalent of the existing `ServiceAuthHandler`, reusing the same token generator and
   trust model.
3. Add the Catalog gRPC address to Grading's services configuration, alongside (not
   replacing) the existing REST base URL config still used for Submission.
4. Reimplement `CatalogApiClient`'s 3 methods against the generated gRPC client, mapping
   proto reply messages to the existing DTOs and collection shapes exactly as the HTTP
   implementation does today (including not-found and empty-result cases).
5. Remove the now-unused HttpClient/`ServiceAuthHandler` registration for Catalog
   specifically, leaving Submission's HttpClient-based registration untouched.
6. Add unit tests (new xUnit test project registered in the solution) for the gRPC-based
   client using a test double of the generated client, covering: successful mapping for
   each of the 3 methods, not-found assignment, empty criteria/student-id results, and that
   the credentials interceptor attaches a bearer token to outgoing calls.
7. Confirm no caller of `ICatalogApiClient` (e.g. `AiGradingJob`) required any code change.

## Success Criteria
- The h2c cleartext switch is set before channel use, and a real (non-mocked) gRPC call from
  Grading to a running Catalog instance succeeds without a `Http2UnencryptedSupport`-related
  exception — verified manually once Phase 2's Catalog gRPC port is available.
- `dotnet build` succeeds on `AutoGrading.Grading.Api` with `ICatalogApiClient`'s interface
  unchanged.
- `dotnet test` passes for the new client unit tests (mapping, not-found/empty cases, and
  token attachment all covered).
- A diff review confirms `AiGradingJob` and other `ICatalogApiClient` callers have zero
  changes, and Submission's Catalog/Grading HTTP clients are untouched.

## Risks
- Forgetting the h2c cleartext client switch (step 1a): `Grpc.Net.Client` throws on the
  first call against an insecure HTTP/2 endpoint without it — mitigated by making it an
  explicit early step and an explicit success-criteria check, not an assumed default.
- DTO/proto mapping drift (e.g. a field renamed in one place but not the other) surfacing
  as a runtime error rather than a compile error: mitigated by the mapping unit tests added
  in this phase.
- Interceptor minting an expired or malformed token: mitigated by reusing the existing,
  already-proven `JwtTokenGenerator.GenerateServiceToken` exactly as `ServiceAuthHandler`
  does today, rather than writing new token logic.
