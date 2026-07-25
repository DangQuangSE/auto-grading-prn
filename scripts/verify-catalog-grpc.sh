#!/usr/bin/env bash
# Verifies Catalog's gRPC port (5012) is up alongside its REST port (5002), and that the
# container healthcheck actually covers both. Run against a running `docker compose up`.
# Usage: scripts/verify-catalog-grpc.sh [--expect-grpc-down]
#   --expect-grpc-down: assert the gRPC probe FAILS (used for the deliberate-break check).
set -euo pipefail

EXPECT_GRPC_DOWN="${1:-}"

echo "== REST /health (localhost:5002) =="
if curl -fsS http://localhost:5002/health; then
  echo "REST health: OK"
else
  echo "REST health: FAILED" >&2
  exit 1
fi
echo

echo "== gRPC health (localhost:5012, grpc.health.v1.Health/Check) =="
if command -v grpc_health_probe >/dev/null 2>&1; then
  PROBE_CMD=(grpc_health_probe -addr=localhost:5012)
else
  echo "grpc_health_probe not found locally; running it inside the catalog-api container instead." >&2
  PROBE_CMD=(docker compose exec -T catalog-api grpc_health_probe -addr=localhost:8081)
fi

if "${PROBE_CMD[@]}"; then
  GRPC_UP=1
else
  GRPC_UP=0
fi

if [[ "$EXPECT_GRPC_DOWN" == "--expect-grpc-down" ]]; then
  if [[ "$GRPC_UP" == "1" ]]; then
    echo "Expected gRPC probe to FAIL (deliberate-break check) but it succeeded." >&2
    exit 1
  fi
  echo "gRPC health: FAILED as expected (deliberate-break check passed)"
else
  if [[ "$GRPC_UP" != "1" ]]; then
    echo "gRPC health: FAILED" >&2
    exit 1
  fi
  echo "gRPC health: SERVING"
fi
