# Account Control & Security Settings — E2E tests

Playwright coverage for the forgot/reset-password flow, self-service change-
password and session controls, and the admin account-status/password-admin
controls added in `20261104000000_account_security_controls.sql`.

## Read-only vs. mutating

- `tests/read-only/` — never changes account/auth state. Safe to point at
  any environment, Production included, though there is normally no reason
  to run E2E UI tests against Production at all.
- `tests/mutating/` — actually deactivates/reactivates an account, completes
  a password reset, or signs out sessions. **Never run these against
  Production without an explicit backup/rollback plan and sign-off.** They
  are written to run against a local `supabase start` stack or a disposable
  preview project, using dedicated, disposable test accounts seeded by
  `src/seed.ts` (not real employee/company data).

## Configuration

Set these before running (see `.env.example` at the repo root for what each
one means):

```
E2E_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # only needed by src/seed.ts, never by a browser-facing test
```

## Running

```
npm install --workspace @enginious-hr/e2e-account-security
npm run test:e2e:read-only --workspace @enginious-hr/e2e-account-security
npm run test:e2e:mutating --workspace @enginious-hr/e2e-account-security   # local/preview only
```
