# ENGINIOUS OS: notes for Claude sessions

## Where the app is documented today
There is **not yet** a single written map of the whole app. It was planned (`docs/enginious-os/`: overview, screens and navigation, roles and approvals, the Sales → Projects → Inventory → Budget flow, data model, test map, migration ledger, change log) and deliberately postponed to be done later in a more practical, module-by-module way. Do not assume those files exist.

What exists now, in `docs/`:
* Architecture, schema, permissions, journeys: `00`–`14` (some parts predate the launch release; verify against code).
* Per module: `projects-*`, `inventory-*`, `project-budget-expenses-*`, `people-access-*`, `recovery-windows-*`, `crm-deployment.md`, `os-my-day.md`, `os-shell-integration.md`.
* The launch release (15 migrations, PRs #53–#56, merged at `551f615`): `launch-refinement-install-order.md` (the one authoritative migration list and sequence), `launch-refinement-hosted-checklist.md`, `launch-p*-deployment.md`, `launch-batch-install.md`.
* Runnable flows and what each proves: `apps/web/os-shell-checks/README.md`. Local auth is an in-repo stand-in, not Supabase Auth (`docs/people-access-account-controls-verification.md`).
* The pre-release specification (role/navigation matrix, everyday paths, dispatch design) is on branch `docs/launch-refinement-spec` only, written at `76c121b`; parts are stale.

## When the app map is written, keep it current
Any change to behaviour, roles or permissions, navigation, a flow, a migration or the tests must update the relevant document and be recorded in a change log in the same pull request. Evidence rules: cite the source path for every claim, mark anything not verified as `Unverified`, and record hosted-database facts as owner-reported unless Claude itself ran the check.

## Boundaries that have applied to every release so far
* Never run SQL against the hosted database, enable the dispatch/return notes switch, activate scheduled jobs, change access, or create Production test data. The owner runs hosted SQL from the owner packs in `supabase/manual-sql` (read-only preflight / preservation / verify files are labelled; migrations and rollbacks change the database).
* Migrations are additive and idempotent, timestamp order is install order (`docs/launch-refinement-install-order.md`), and an applied migration is never edited: add a new one.
* Merge only when the owner asks, with merge commits, after required CI (`lint-typecheck-test`, `rls-policies`) is green on the exact head.
* A failed read must say it could not load, never show empty, zero or "no access".
