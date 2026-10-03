# Local full-stack browser verification (throwaway — never a hosted environment)

This folder lets the REAL Next.js app be driven by a REAL browser (Playwright + Chromium) against a REAL PostgreSQL built from
`supabase/migrations/`, with no hosted Supabase project, no Vercel and no real accounts involved:

```
Chromium  ->  Next.js app (apps/web, built + started locally)
                 |  /rest/v1/*  ->  PostgREST (the same component Supabase uses; enforces the real RLS policies)
                 |  /auth/v1/*  ->  gateway.mjs: a minimal local sign-in stand-in (NOT Supabase Auth)
                 v
              throwaway Postgres database  (stubs + every migration + grants + seed.sql)
```

`gateway.mjs` accepts one fixed local password for users that exist in the throwaway database and signs HS256 tokens PostgREST
verifies. It exists only so the app can sign in locally. **It never talks to Supabase and no credential from any real
environment is used or needed.** `env.sh` refuses to continue unless the base URL is local and drops every role it does not seed.

What this proves and what it does not — see `docs/recovery-windows-deployment.md` §9. In short: it exercises the real screens,
the real server actions, the real RLS and the real engine, but it is **not** the hosted Supabase (no Supabase Auth, no pg_cron —
the activation gate is exercised against a stub `cron.job` table inside this throwaway database — no Vercel, no real data).

## Run it

Prerequisites: local Postgres (the RLS tests already need it), Node 22, Chromium (`PLAYWRIGHT_BROWSERS_PATH`), and the PostgREST
binary (<https://github.com/PostgREST/postgrest/releases>, v12.2.x `linux-static-x64`).

```bash
export POSTGREST_BIN=/path/to/postgrest
export RLS_TEST_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
packages/e2e-tests/local-stack/reset.sh            # build + seed the throwaway DB, start PostgREST and the gateway

# the app, built against the local gateway (the keys come from `node gateway.mjs --keys`; they are local-only)
KEYS=$(node packages/e2e-tests/local-stack/gateway.mjs --keys)
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 CRON_SECRET=local
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(echo "$KEYS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["anon"])')
export SUPABASE_SERVICE_ROLE_KEY=$(echo "$KEYS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["service"])')
(cd apps/web && npx next build && npx next start -p 3000 -H 127.0.0.1)

# the specs
cd packages/e2e-tests && . local-stack/env.sh
export LOCAL_DB_URL=postgres://postgres:postgres@127.0.0.1:5432/hr_local_stack
npx playwright test --project=preview-recovery-windows-read-only --project=preview-recovery-windows-mobile   # UI only
npx playwright test --project=preview-recovery-windows-mutating                                              # UI + evidence (no credit)
npx playwright test --project=preview-recovery-windows-credit                                                # END-TO-END credit
npx playwright test --project=local-stack                                                                    # policy activation gate
local-stack/stop.sh
```

The seed (`seed.sql`) gives: a UAE and a Polish company; HR Admins (one drafts, one activates), a UAE CEO, a Line Manager, an
Employee, a colleague lead, a Sys Admin, a Polish CEO grant and a Polish employee; the active V2 same-day/4-hour policy in all
three countries; the three next-version windows DRAFTS created through the real `seed_recovery_windows_policy_drafts()`; and the
UAE windows version made active from the past (done with the activation flag, like the DB test fixtures) so past evidence can
earn credit. The Poland draft stays a draft so the real activation function is exercised through the browser.

Everything here is in `packages/e2e-tests/tests/local-stack/` or the `preview-recovery-windows-*` projects. No workflow runs the
`local-stack` project, and CI fails if any Production project can match it.
