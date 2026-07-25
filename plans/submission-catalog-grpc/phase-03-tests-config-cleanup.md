# Phase 3: Tests, Config, and Cleanup

## Requirements
Submission's gRPC migration has test coverage matching Grading's precedent, the container environment resolves Catalog over gRPC end to end, and no dead REST-based Catalog code remains in the codebase.

## Steps
1. Add tests for Submission's new gRPC Catalog client covering the not-found path and both lookups' happy paths, mirroring Grading's existing client tests.
2. Add tests for Submission's new gRPC address configuration class covering both the happy path and the missing-configuration error path, mirroring Grading's existing options tests.
3. Confirm the shared authenticator's relocated tests (from Phase 1) also validate Submission's usage pattern (a Submission-identified service token), extending them if the existing assertions are Grading-specific.
4. Review and update any existing Submission test that directly constructed the old REST-based client, replacing it with the gRPC-based equivalent or removing it if superseded.
5. Delete the now-unused REST-based Catalog client file from Submission once every reference to it is gone.
6. Update the container environment configuration for Submission's service to point at Catalog's gRPC address instead of its old REST base URL, matching Grading's existing entry.
7. Run the full test suite for both Submission and Grading, and bring the stack up locally to confirm Submission resolves Catalog over gRPC with no remaining REST-based Catalog configuration.

## Success Criteria
- `dotnet test` passes for `AutoGrading.Submission.Api.Tests`, including new/updated tests for the gRPC client, the shared authenticator's Submission usage, and the gRPC address configuration.
- `dotnet test` passes for `AutoGrading.Grading.Api.Tests` unchanged, confirming the Phase 1 proto addition and authenticator relocation caused no regression.
- No file in the repository still defines or references a REST-based `CatalogApiClient` for Submission, and no config file still sets a REST Catalog base URL for Submission's container.
- Bringing the stack up locally resolves Submission's Catalog calls over gRPC (port 8081) successfully.

## Risks
- Deleting the REST client before every reference (tests, DI registration) is updated breaks the build: delete it last, only after the build is green with the new client wired.
- Stale container environment variables (old REST var left alongside the new gRPC var) mask a misconfiguration until runtime: grep the container config after editing to confirm only the gRPC entry remains for Submission.
