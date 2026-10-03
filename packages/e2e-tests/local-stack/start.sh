#!/usr/bin/env bash
# Starts the LOCAL full-stack: PostgREST + the local gateway (sign-in stand-in) in the background. Requires:
#   * local Postgres with the throwaway DB (build-db.sh + seed.sql),
#   * a PostgREST binary (https://github.com/PostgREST/postgrest/releases — v12.2.3 linux-static-x64) at $POSTGREST_BIN.
# Then run the app against it: see README.md. Stop with stop.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${LOCAL_DB_NAME:-hr_local_stack}"
export LOCAL_JWT_SECRET="${LOCAL_JWT_SECRET:-local-stack-only-secret-0123456789abcdef}"
export LOCAL_DB_URL="${LOCAL_DB_URL:-postgres://postgres:postgres@127.0.0.1:5432/${DB}}"
PGRST_DB_URI="postgres://authenticator:authenticator@127.0.0.1:5432/${DB}" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$LOCAL_JWT_SECRET" PGRST_SERVER_PORT=3001 PGRST_SERVER_HOST=127.0.0.1 \
  nohup "${POSTGREST_BIN:?set POSTGREST_BIN}" >"${LOCAL_STACK_LOG_DIR:-/tmp}/postgrest.log" 2>&1 &
echo $! >"${LOCAL_STACK_LOG_DIR:-/tmp}/postgrest.pid"
nohup node "$HERE/gateway.mjs" >"${LOCAL_STACK_LOG_DIR:-/tmp}/gateway.log" 2>&1 &
echo $! >"${LOCAL_STACK_LOG_DIR:-/tmp}/gateway.pid"
sleep 2
echo "PostgREST :3001, gateway :54321 started (logs in ${LOCAL_STACK_LOG_DIR:-/tmp})"
