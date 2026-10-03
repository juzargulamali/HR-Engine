#!/usr/bin/env bash
# Rebuilds the throwaway local database from the migrations, seeds it, and restarts PostgREST + the gateway.
# Run from anywhere. The Next.js app does not need a restart (it holds no database state).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${LOCAL_DB_NAME:-hr_local_stack}"
"$HERE/stop.sh"
sleep 1
"$HERE/build-db.sh" "$DB"
ADMIN="${RLS_TEST_ADMIN_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
psql "${ADMIN%/*}/${DB}" -q -v ON_ERROR_STOP=1 -f "$HERE/seed.sql" >/dev/null
"$HERE/start.sh"
