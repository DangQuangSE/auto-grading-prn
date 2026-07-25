# Spec: Submission → Catalog over gRPC

**Date:** 2026-07-25
**Status:** Ready

---

## Problem Statement

Submission currently calls Catalog over REST (`HttpClient` + JSON) for two lookups (`GetAssignmentAsync`, `GetLecturerStudentIdsAsync`). Catalog already exposes both as gRPC RPCs (built for Grading's prior migration). Switching Submission to the same gRPC client cuts per-call serialization/connection overhead, matching the performance win Grading already got.

---

## User Stories

- **[P1]** As the Submission service, I want to fetch assignment details (`Id`, `SubjectId`, `MaxAttempts`) from Catalog over gRPC instead of REST, so that submission creation/attempt checks have lower latency.
  Accepted when: `SubmissionService` resolves assignment data via a gRPC-backed `ICatalogApiClient` and all existing call sites (`SubmissionService.cs:50`, `:126`) behave identically (same not-found/error semantics).

- **[P1]** As the Submission service, I want to fetch a lecturer's enrolled student IDs from Catalog over gRPC instead of REST, so that grading-scope checks have lower latency.
  Accepted when: `GetLecturerStudentIdsAsync` returns the same `HashSet<Guid>` shape via the gRPC `GetLecturerStudentIds` RPC, preserving the existing `lecturer`/`service` role distinction Catalog's endpoint already enforces.

- **[P2]** As a maintainer, I want Submission's gRPC client covered by tests mirroring Grading's (`CatalogApiClientTests`, `CatalogGrpcAuthenticatorTests`, `ServicesOptionsTests`), so that the migration doesn't ship with weaker coverage than the precedent it copies.

- **[P3]** _(out of scope)_ Extracting `ServicesOptions` into `AutoGrading.Common` — deferred; it mixes per-service config (`SubjectApiBaseUrl`-style fields) with `CatalogGrpcAddress`, so it stays duplicated per service. (`CatalogGrpcAuthenticator` is *not* out of scope — see FR-03: it's a pure, stateless move and gets extracted to Common as part of this change.)

---

## Functional Requirements

1. FR-01: Add a new `optional int32 max_attempts = 5;` field to `AssignmentReply` in `catalog.proto` (new field number, numeric type — not `string`, unlike the `description` field), and populate it in `CatalogGrpcService.ToReply` from `Assignment.MaxAttempts`. This is additive/wire-compatible; Grading's existing `AssignmentDto` parsing (which doesn't read this field) keeps working unchanged.
2. FR-02: Add a new `CatalogApiClient` in `AutoGrading.Submission.Api/Clients/` implementing `ICatalogApiClient` against the generated `Catalog.CatalogClient`, replacing the current `HttpClient`-based implementation. `AssignmentDto` gains parsing of `max_attempts` from the reply. Add the matching `<Protobuf Include="..\..\Catalog\AutoGrading.Catalog.Api\Protos\catalog.proto" GrpcServices="Client" .../>` entry plus `Grpc.Net.Client`, `Grpc.Net.ClientFactory`, `Google.Protobuf`, `Grpc.Tools` package references to Submission's `.csproj`, mirroring Grading's `.csproj` exactly. (Each service compiles its own client stub directly from the shared `.proto` file — no shared NuGet package, so no cross-project staleness risk from the field addition.)
3. FR-03: Extract `CatalogGrpcAuthenticator` (currently `Grading.Api/Clients/CatalogGrpcAuthenticator.cs`) into `AutoGrading.Common.Auth` as a pure move — it's a stateless static helper with no Grading-specific state, so this is a genuine move-and-rename, not a refactor. Update Grading's `Program.cs` to reference the `Common` version and delete the old file; move `CatalogGrpcAuthenticatorTests.cs` alongside it. Submission's `Program.cs` then references the same `Common` helper — no duplication for the authenticator. Add `ServicesOptions` (with `CatalogGrpcAddress`) to Submission's `Clients/` folder as its own copy (mirroring Grading's `ServicesOptions.cs`, which stays as-is) — this one *does* stay duplicated since it mixes per-service config fields.
4. FR-04: Wire `AddGrpcClient<CatalogGrpcClient>` + call-credentials (using the `Common` `CatalogGrpcAuthenticator`, minting `GenerateServiceToken("submission")` per call, no caching) + `AddScoped<ICatalogApiClient, CatalogApiClient>` in Submission's `Program.cs`, replacing the current `AddHttpClient<ICatalogApiClient, CatalogApiClient>` registration. Use the same `using CatalogGrpcClient = AutoGrading.Catalog.Api.Grpc.Catalog.CatalogClient;` alias convention Grading's `Program.cs` uses.
5. FR-05: Remove the REST-only `Services:CatalogApiBaseUrl` config from Submission's `appsettings.json`; add `Services:CatalogGrpcAddress` (dev default `http://localhost:8081`, matching Grading's).
6. FR-06: Update `docker-compose.yml` — replace/augment `submission-api`'s `Services__CatalogApiBaseUrl` env var with `Services__CatalogGrpcAddress: http://catalog-api:8081`.
7. FR-07: Delete the now-unused REST `CatalogApiClient.cs` (HttpClient-based) once the gRPC client is wired, per the full-replacement direction (no dual-mode fallback).

---

## Non-Functional Requirements

- Performance: gRPC calls to Catalog should not regress correctness — same not-found (`RpcException` `StatusCode.NotFound` → `null`) and role-based authorization behavior as the REST endpoints they replace.
- Security: Service-to-service calls continue to authenticate via short-lived JWT service tokens (role `service`), attached as gRPC call credentials exactly as Grading does it.
- Compatibility: The `max_attempts` proto addition must not break Grading's existing `AssignmentDto` (which doesn't read that field).

---

## Success Criteria

- [x] Submission's `SubmissionService` no longer references `HttpClient`-based Catalog calls — both lookups go through the generated gRPC client.
- [x] `dotnet test` passes for `AutoGrading.Submission.Api.Tests`, including new/updated tests for the gRPC client, authenticator, and `ServicesOptions`. (40/40 green)
- [x] Grading's existing gRPC tests (`AutoGrading.Grading.Api.Tests`) still pass unchanged after the proto field addition. (12/12 green)
- [x] `docker-compose up` brings up `submission-api` successfully resolving `catalog-api` over gRPC (port 8081), with no remaining reference to `Services:CatalogApiBaseUrl` for Submission. Verified with a live smoke test: an authenticated `POST /submissions/upload` against a non-existent assignment produced a clean `404 Assignment not found`, confirmed via container logs to have round-tripped through the actual gRPC call to Catalog (not just a clean boot).

---

## Out of Scope

- Extracting `ServicesOptions` into `AutoGrading.Common` (noted as a future cleanup, not this change — only `CatalogGrpcAuthenticator` is extracted, see FR-03).
- Token caching/reuse for the per-call service JWT — signing is local/cheap, matching the existing REST `ServiceAuthHandler` cost model; not worth the added expiry-tracking complexity.
- Any change to Grading's or the Catalog gRPC service's existing RPC behavior beyond the additive `max_attempts` field and the authenticator's new location.
- Migrating any other Submission↔service REST calls (e.g. Grading→Submission REST) to gRPC — out of scope for this spec.

---

## Assumptions

- `Assignment.MaxAttempts` (`be/src/Services/Catalog/AutoGrading.Catalog.Api/Domain/Assignment.cs:12`) is the correct source value for the new proto field.
- Catalog's gRPC endpoint (port 8081) is already reachable from Submission's container network in `docker-compose.yml` the same way it is for Grading (no network/service-discovery changes needed).
- No other consumers depend on Submission's REST `CatalogApiClient` being present (safe to delete outright).

