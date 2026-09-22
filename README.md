# Enginious HR

Multi-country HR platform for Enginious LLC FZ (UAE headquarters; Saudi Arabia and Poland as
satellite offices). Start with [`docs/00-overview.md`](./docs/00-overview.md) — it's the design
package this codebase implements, phase by phase.

**Currently implemented: Phases 0–5** — auth, roles, companies, departments, employee core
records (Phase 0); employment contracts, compensation, identity documents, private document
storage, and soft-delete recovery (Phase 1); the country policy engine — versioned, effective-dated
leave/notice/probation rules and public holidays for UAE/KSA/Poland, with two-person draft-then-
activate control (Phase 2); leave requests, the leave and comp-day ledgers, deduction-priority
rules, and a generic approval-workflow engine (auto-provisioned per company, multi-step routing,
self-approval prevention, atomic approve/finalize with priority-ordered ledger deduction), plus the
monthly accrual and daily comp-day expiry sweep as Vercel Cron-triggered Route Handlers (Phase 3);
projects, reimbursement claims (with receipt uploads and threshold-based routing that escalates
past the manager to Finance/CEO for large claims), timesheets with attendance records, and
event-triggered overtime-to-comp-day conversion on timesheet approval — all three new entity types
routed and decided through the exact same approval engine from Phase 3, no schema change needed
(Phase 4); performance goals and appraisals (a separate RLS tier Finance never touches),
onboarding/offboarding checklists generated from a template in one call, employee documents with a
daily expiry-status/reminder sweep, assets, and a deterministic, country-agnostic final-settlement
calculator surfaced on a terminated employee's profile (Phase 5). Every table has RLS enabled and
tested from the migration that creates it. See
[`docs/06-implementation-phases.md`](./docs/06-implementation-phases.md) for what's next.

Starter policy content for UAE, Saudi Arabia, and Poland is seeded as **drafts only** — see the
comment at the top of `supabase/seed.sql`. None of it takes effect until a real HR Admin reviews it
and a different HR Admin or the CEO activates it; treat the numbers as a starting point, not legal
advice.

## Layout

```
apps/web/            Next.js app (App Router, TypeScript, Tailwind, hand-rolled shadcn-style UI kit)
packages/domain/      Deterministic business logic + role/permission checks, shared by the app
                       and future scheduled jobs — see docs/01-architecture.md §1.5
packages/rls-tests/   Automated tests that prove the Postgres RLS policies do what they claim,
                       run against a real (throwaway) Postgres database, not mocked
supabase/
  migrations/         One file per schema change, applied in order, never edited after the fact
  seed.sql            Local/dev seed data (countries) — never run against production by hand
  tests/              Local-Postgres stand-ins for what Supabase provides automatically
                       (auth schema, role grants) — used only by packages/rls-tests
schema/schema.sql      The full target schema (all phases) for review — supabase/migrations/ is
                       what's actually been built so far, a subset of this
docs/                 The design package: architecture, schema, permissions, journeys,
                       automation, phases, risks, decisions log, and how to extend the system
```

## Prerequisites

- Node.js 20+
- A Postgres 16 server for running the RLS test suite locally (the CI workflow uses a
  `postgres:16` service container; locally, any local Postgres 16 install works — see
  `RLS_TEST_ADMIN_URL` below)
- A Supabase project for actually running the app (`apps/web`) against real data — not needed to
  run the domain unit tests or the RLS test suite, which run against a plain Postgres

## Getting started

```bash
npm install

# apps/web needs Supabase project credentials to run for real:
cp .env.example apps/web/.env.local
# fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
# from a Supabase project with supabase/migrations/ applied and supabase/seed.sql loaded

npm run dev      # apps/web on http://localhost:3000
```

To apply the migrations to a Supabase project (local `supabase start` or a hosted project), use
the Supabase CLI: `supabase db push` (hosted) or `supabase db reset` (local, also runs
`supabase/seed.sql`).

## Everyday commands (all run from the repo root, across every workspace)

```bash
npm run lint         # eslint (apps/web)
npm run typecheck    # tsc --noEmit in every workspace
npm test             # fast unit tests (packages/domain) — no database needed
npm run test:rls     # RLS policy tests against a real Postgres — see below
npm run build        # production build of apps/web
```

## Running the RLS test suite locally

This is the suite that proves "who can see/do what" actually holds, by running real queries
against a real Postgres database as different simulated users — not a mock, not a read of the SQL
by eye. See [`docs/09-extending-the-system.md`](./docs/09-extending-the-system.md) for how to add
to it when a new module lands.

```bash
# Point it at any Postgres 16 server you can create/drop scratch databases on.
# Defaults to postgres://postgres:postgres@127.0.0.1:5432/postgres if unset.
export RLS_TEST_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres

npm run test:rls
```

Each run creates a throwaway database (`hr_rls_test_<timestamp>_<random>`), applies
`supabase/tests/stub-auth-schema.sql` (a stand-in for what the Supabase platform provides
automatically — `auth.users`, `auth.uid()`, the `anon`/`authenticated` roles), then every file in
`supabase/migrations/` in order, then drops the database when the suite finishes. Nothing here
touches a real Supabase project.

## Regenerating Supabase types

Once a real Supabase project exists with the migrations applied:

```bash
npm run db:types
```

This overwrites `apps/web/src/types/database.types.ts`, currently hand-written to match
`supabase/migrations/` exactly (see the comment at the top of that file for why its shape matters —
`@supabase/supabase-js`'s generic types silently collapse to `never` if a required key is missing).

## Scheduled jobs

`vercel.json` schedules three Cron-triggered Route Handlers (see `docs/05-automation-rules.md` §5.1):
monthly leave accrual (`/api/cron/leave-accrual`), the daily comp-day expiry sweep
(`/api/cron/comp-day-expiry`), and the daily employee-document expiry/reminder sweep
(`/api/cron/document-expiry`). All three run under the service-role client (they're trusted backend
jobs writing rows no user-scoped RLS policy allows) and refuse every request unless it carries
`Authorization: Bearer $CRON_SECRET` — set `CRON_SECRET` in the Vercel project's env to the same
value Vercel Cron is configured to send.

## Security notes for anyone extending this

- `SUPABASE_SERVICE_ROLE_KEY` is used in exactly one place:
  `apps/web/src/lib/supabase/admin.ts`, which starts with `import "server-only"` so importing it
  from anything reachable by the browser bundle is a build error, not a code-review nit.
- Every table has Row-Level Security enabled from the migration that creates it — see
  `docs/02-database-schema.md` §2.6 for the helper functions every policy is built from, and
  `docs/09-extending-the-system.md` for the checklist a new table follows.
