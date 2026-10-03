#!/usr/bin/env bash
# Builds a THROWAWAY local database for the local full-stack browser verification: the same stubs + every migration +
# the same grants the RLS harness uses (packages/rls-tests/src/harness.ts), plus the PostgREST "authenticator" login role.
# Nothing here touches Supabase, Vercel or any real data. Usage: build-db.sh [dbname]
set -euo pipefail
DB="${1:-hr_local_stack}"
ADMIN="${RLS_TEST_ADMIN_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "drop database if exists ${DB} with (force)" -c "create database ${DB}"
DBURL="${ADMIN%/*}/${DB}"
run() { psql "$DBURL" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null; }
run "$ROOT/supabase/tests/stub-auth-schema.sql"
run "$ROOT/supabase/tests/stub-storage-schema.sql"
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do run "$f"; done
run "$ROOT/supabase/tests/grant-authenticated-access.sql"
psql "$DBURL" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'authenticator' noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
SQL
echo "built ${DB}"
