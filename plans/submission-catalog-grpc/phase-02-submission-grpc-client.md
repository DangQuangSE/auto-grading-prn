# Phase 2: Submission gRPC Client

## Requirements
Submission's Catalog lookups (assignment details, lecturer's enrolled student IDs) go through the generated gRPC client instead of `HttpClient`, authenticated the same way Grading's gRPC calls are, with identical not-found and role-based behavior to the REST endpoints being replaced.

## Steps
1. Add Submission's own per-service gRPC address configuration (mirroring Grading's options class), reading a new gRPC address setting rather than the old REST base-URL setting.
2. Write Submission's new Catalog client against the generated gRPC stub, implementing both lookups so a not-found assignment still resolves to `null` and the lecturer/service role distinction on the student-IDs lookup is preserved.
3. Extend the assignment data shape returned to Submission's business logic to include the new attempt-limit value now available from the gRPC reply.
4. Add the gRPC package references and the direct `.proto` file include to Submission's project file, mirroring Grading's project file configuration exactly.
5. Replace Submission's HTTP-client-based Catalog registration in startup wiring with gRPC client registration plus call-credentials that mint a Submission-identified service token via the shared authenticator from Phase 1.
6. Replace the old REST base-URL configuration entry in Submission's application settings with the new gRPC address entry, matching Grading's default.
7. Confirm no other part of Submission's startup wiring (its own REST auth handler for other outbound calls) is touched by this change.

## Success Criteria
- Submission's business logic (`SubmissionService`) compiles and runs against the new client with no change to its own call sites' expectations — same not-found and authorization semantics as before.
- Submission's project builds and generates the gRPC client stub from Catalog's `.proto` file with no manual stub editing.
- Submission's application settings and startup wiring reference only the new gRPC address configuration — no remaining reference to the old REST base-URL setting in code.

## Risks
- Missing or misconfigured call-credentials means every gRPC call to Catalog fails authentication: verify by exercising both lookups against a running Catalog gRPC endpoint before moving to Phase 3.
- Forgetting to update the data shape consumed by Submission's business logic to include the new attempt-limit field leaves it silently defaulted: cross-check every place the assignment lookup result is read.
