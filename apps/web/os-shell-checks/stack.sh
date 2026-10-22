#!/usr/bin/env bash
# One-stop helper for the LOCAL browser-check stack (throwaway database, PostgREST, local sign-in gateway, the built app).
# Never points at anything hosted. Usage:  stack.sh reset | build | start | stop | all
#   POSTGREST_BIN   path of the PostgREST binary (v12.2.x linux-static-x64), default /home/user/tools/postgrest
#   LOCAL_STACK_LOG_DIR  where logs go, default /tmp/inv-stack
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export POSTGREST_BIN="${POSTGREST_BIN:-/home/user/tools/postgrest}"
export LOCAL_STACK_LOG_DIR="${LOCAL_STACK_LOG_DIR:-/tmp/inv-stack}"
export RLS_TEST_ADMIN_URL="${RLS_TEST_ADMIN_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
mkdir -p "$LOCAL_STACK_LOG_DIR"
appenv() {
  local KEYS; KEYS=$(node "$ROOT/packages/e2e-tests/local-stack/gateway.mjs" --keys)
  export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 CRON_SECRET=local NEXT_TELEMETRY_DISABLED=1
  NEXT_PUBLIC_SUPABASE_ANON_KEY=$(echo "$KEYS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["anon"])'); export NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY=$(echo "$KEYS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["service"])'); export SUPABASE_SERVICE_ROLE_KEY
}
case "${1:-all}" in
  reset) "$ROOT/packages/e2e-tests/local-stack/reset.sh" >/dev/null 2>&1; echo "database reset" ;;
  build) appenv; (cd "$ROOT/apps/web" && VERCEL_ENV=production npx next build > "$LOCAL_STACK_LOG_DIR/build.log" 2>&1) && echo "build ok" || { tail -30 "$LOCAL_STACK_LOG_DIR/build.log"; exit 1; } ;;
  start) appenv; (cd "$ROOT/apps/web" && VERCEL_ENV=production nohup npx next start -p 3000 -H 127.0.0.1 > "$LOCAL_STACK_LOG_DIR/app.log" 2>&1 &)
         for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3000/login && break; sleep 1; done; curl -s -o /dev/null -w "app %{http_code}\n" http://127.0.0.1:3000/login ;;
  stop)  pkill -f "next start -p 3000" || true; pkill -f "next-server" || true; "$ROOT/packages/e2e-tests/local-stack/stop.sh" >/dev/null 2>&1 || true; echo stopped ;;
  all)   "$0" reset; "$0" build; "$0" start ;;
esac
