# ENGINIOUS OS: notes for Claude sessions

## The app memory: `docs/enginious-os/`
Start every session by reading `docs/enginious-os/README.md`. It indexes the written description of the whole app, verified against commit `551f615` (2026-11-04):
* `01-overview-and-modules.md`: what the app is, modules, how they connect, built vs deferred.
* `02-screens-and-navigation.md`: routes, navigation, My Day structure.
* `03-roles-access-and-approvals.md`: roles and grants, scopes, what each role can do, approval routing, company isolation, known limits.
* `04-flows-sales-to-warehouse-and-others.md`: Sales → Projects → Inventory → Budget end to end, Inventory, HR flows, approvals, scheduled work.
* `05-data-tests-and-release-ledger.md`: data model, migration ledger, test map, coverage gaps, current state.
* `06-change-log.md`: merged changes with PR numbers and SHAs.
Each file marks anything it could not verify as `Unverified` and lists stale statements it found in older docs.

**Not written yet (deliberately postponed to save credits):** the per-control module references (`docs/enginious-os/modules/`: for each screen, what every tab, dropdown, filter, button and form field does, which server action and database function it triggers, who can use it, validation and failed-read behaviour). Write them one module at a time, only when about to test or change that module, starting from the existing module docs and then the code. Also not started: a bounded launch test pass (existing browser suites once on the merged build, ordinary-staff journeys, a per-role security and breakage matrix, hosted and real-phone checks by the owner), awaiting the owner's approval of its scope.

## Keep the app memory current (a rule, not a suggestion)
Any change to behaviour, roles or permissions, navigation, a flow, a migration or the tests must update the relevant file(s) in `docs/enginious-os/`, add an entry to `docs/enginious-os/06-change-log.md` and refresh the "verified at commit" stamp in the README, in the same pull request. A change that is not reflected there is not finished. Evidence rules: cite the source path for every claim, mark anything not verified as `Unverified`, and record hosted-database facts as owner-reported unless Claude itself ran the check.

## Other documents
Older design docs in `docs/` (`00`–`14`, module designs and deployment guides) are inputs, not authority: parts are stale (see the stale lists in the app memory). The launch release's authoritative migration list and sequence is `docs/launch-refinement-install-order.md`; runnable browser flows are listed in `apps/web/os-shell-checks/README.md`. Local auth is an in-repo stand-in, not Supabase Auth (`docs/people-access-account-controls-verification.md`). The pre-release specification is on branch `docs/launch-refinement-spec` only (written at `76c121b`, partly stale).

## Boundaries that have applied to every release so far
* Never run SQL against the hosted database, enable the dispatch/return notes switch, activate scheduled jobs, change access, or create Production test data. The owner runs hosted SQL from the owner packs in `supabase/manual-sql` (read-only preflight / preservation / verify files are labelled; migrations and rollbacks change the database).
* Migrations are additive and idempotent, timestamp order is install order (`docs/launch-refinement-install-order.md`), and an applied migration is never edited: add a new one.
* Merge only when the owner asks, with merge commits, after required CI (`lint-typecheck-test`, `rls-policies`) is green on the exact head.
* A failed read must say it could not load, never show empty, zero or "no access".
