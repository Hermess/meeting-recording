#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-meeting-ai-kit-postgres-dev}"
IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
DB="${POSTGRES_DB:-meeting_ai}"
USER="${POSTGRES_USER:-meeting_ai}"
PASSWORD="${POSTGRES_PASSWORD:-meeting_ai}"
PORT="${POSTGRES_PORT:-5432}"

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "PostgreSQL is already running in container $CONTAINER_NAME."
  exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker start "$CONTAINER_NAME" >/dev/null
  echo "Started existing PostgreSQL container $CONTAINER_NAME."
  exit 0
fi

docker run \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_DB="$DB" \
  -e POSTGRES_USER="$USER" \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  -p "$PORT:5432" \
  -d "$IMAGE" >/dev/null

echo "Started PostgreSQL container $CONTAINER_NAME on localhost:$PORT."
