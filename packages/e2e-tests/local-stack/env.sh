# Environment for running the e2e specs against the LOCAL full-stack (never a hosted environment). Source it, then run
# `npx playwright test --project=<name>` from packages/e2e-tests. The accounts exist only in the throwaway local database.
export E2E_BASE_URL=http://127.0.0.1:3000
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export E2E_ATTENDANCE_CLOCK_TIMEZONE=Asia/Dubai
export E2E_MUTATION_AUTHORIZED=true
export E2E_RECOVERY_CREDIT_AUTHORIZED=true
for pair in EMPLOYEE:emp MANAGER:mgr HR:hr CEO:ceo ADMIN:admin; do
  export "E2E_${pair%%:*}_EMAIL=${pair##*:}@e2e.local"
  export "E2E_${pair%%:*}_PASSWORD=local-stack-password"
done
# Safety: an environment may already carry REAL dedicated-test-account credentials for a hosted environment. Drop every
# role this local seed does not define, so nothing from there can ever be sent to the local app (or the other way round).
unset E2E_FINANCE_EMAIL E2E_FINANCE_PASSWORD E2E_ALLOW_BROWSER_TLS_BYPASS
case "$E2E_BASE_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "refusing: E2E_BASE_URL is not local" >&2; return 1 ;; esac
