#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-meeting-ai-kit-postgres-dev}"

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker stop "$CONTAINER_NAME" >/dev/null
  echo "Stopped PostgreSQL container $CONTAINER_NAME."
else
  echo "PostgreSQL container $CONTAINER_NAME is not running."
fi
