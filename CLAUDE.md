# ENGINIOUS OS: notes for Claude sessions

## Where the app is documented today
There is **not yet** a single written map of the whole app. It was planned (`docs/enginious-os/`: overview, screens and navigation, roles and approvals, the Sales → Projects → Inventory → Budget flow, data model, test map, migration ledger, change log) and deliberately postponed to be done later in a more practical, module-by-module way. Do not assume those files exist.

What exists now, in `docs/`:
* Architecture, schema, permissions, journeys: `00`–`14` (some parts predate the launch release; verify against code).
* Per module: `projects-*`, `inventory-*`, `project-budget-expenses-*`, `people-access-*`, `recovery-windows-*`, `crm-deployment.md`, `os-my-day.md`, `os-shell-integration.md`.
* The launch release (15 migrations, PRs #53–#56, merged at `551f615`): `launch-refinement-install-order.md` (the one authoritative migration list and sequence), `launch-refinement-hosted-checklist.md`, `launch-p*-deployment.md`, `launch-batch-install.md`.
* Runnable flows and what each proves: `apps/web/os-shell-checks/README.md`. Local auth is an in-repo stand-in, not Supabase Auth (`docs/people-access-account-controls-verification.md`).
* The pre-release specification (role/navigation matrix, everyday paths, dispatch design) is on branch `docs/launch-refinement-spec` only, written at `76c121b`; parts are stale.

## App-map task: started, stopped on 2026-11-03, to be resumed later
Status: **attempted and stopped by the owner to save credits. Nothing from it was written** (no `docs/enginious-os/` files exist; the only output is this file).

What was planned (resume from here, do not start from zero):
* Seven core files in `docs/enginious-os/`: `README.md` (index, "verified at commit" stamp, maintenance rule), `01-overview-and-modules.md`, `02-screens-and-navigation.md`, `03-roles-access-and-approvals.md`, `04-flows-sales-to-warehouse-and-others.md`, `05-data-tests-and-release-ledger.md`, `06-change-log.md`.
* Per-module control references in `docs/enginious-os/modules/`: `people-and-hr.md`, `sales-and-crm.md`, `projects.md`, `inventory.md`, `budget-access-and-admin.md` (every tab, dropdown, filter, button and form field: what it does, which server action and database function it triggers, who can use it, validation, failed-read behaviour).
* Content rules: every claim cites its source path; unknowns are marked `Unverified`; hosted facts are owner-reported; verified against the commit current at writing time (stamp it; the last full release was `551f615`).

What went wrong and how to do it better next time: nine agents were run in parallel, each reading a large part of the code, which was too costly. Run **one module at a time**, only when about to test or change that module, starting from the existing docs listed above and then checking the code. Do the cross-module files (overview, roles, Sales → warehouse flow) once, one agent each, sequentially.

Related plan, also not started: a bounded launch test pass (existing browser suites once on the merged build, ordinary-staff journeys, a per-role security and breakage matrix, hosted and real-phone checks by the owner), awaiting the owner's approval of its scope.

## When the app map is written, keep it current
Any change to behaviour, roles or permissions, navigation, a flow, a migration or the tests must update the relevant document and be recorded in a change log in the same pull request. Evidence rules: cite the source path for every claim, mark anything not verified as `Unverified`, and record hosted-database facts as owner-reported unless Claude itself ran the check.

## Boundaries that have applied to every release so far
* Never run SQL against the hosted database, enable the dispatch/return notes switch, activate scheduled jobs, change access, or create Production test data. The owner runs hosted SQL from the owner packs in `supabase/manual-sql` (read-only preflight / preservation / verify files are labelled; migrations and rollbacks change the database).
* Migrations are additive and idempotent, timestamp order is install order (`docs/launch-refinement-install-order.md`), and an applied migration is never edited: add a new one.
* Merge only when the owner asks, with merge commits, after required CI (`lint-typecheck-test`, `rls-policies`) is green on the exact head.
* A failed read must say it could not load, never show empty, zero or "no access".
