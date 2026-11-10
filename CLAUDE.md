# ENGINIOUS OS: notes for Claude sessions

## How to use the app memory (`docs/enginious-os/`)
1. **Read `docs/enginious-os/README.md` first.** It is a short index (files, verified-at stamps, "where to find things"). Then open **only the section(s) relevant to the task**; do not read the whole map.
2. **Use the map to find the source quickly.** Each section cites the paths (components, domain code, migrations, functions) behind its claims. Start from those paths.
   * `01-overview-and-modules.md`: app, modules, how they connect, built vs deferred.
   * `02-screens-and-navigation.md`: routes, navigation, My Day.
   * `03-roles-access-and-approvals.md`: roles, module grants, working profiles, approvals, company isolation.
   * `04-flows-sales-to-warehouse-and-others.md`: Sales, Projects, Inventory, Budget, HR flows, approvals, scheduled work.
   * `05-data-tests-and-release-ledger.md`: data model, migration ledger, test map, current state.
   * `06-change-log.md`: one entry per change, with PR numbers and SHAs.
3. **The map can be stale.** Before changing permissions, calculations or approval logic, read and verify the specific code (policy SQL, function, domain module) and cite it. Trust the code over the map; if they differ, fix the map.
4. **Update the map in the same PR as any behaviour change**: the affected section(s) of `docs/enginious-os/` **and** a new entry in `06-change-log.md`; re-stamp only the sections you re-checked (README stamp table). A change not reflected there is not finished. This covers behaviour, roles or permissions, navigation, a flow, a migration and the tests.
   * **If the module you change has an incomplete Map, complete it in that PR.** Write or finish the module reference against the implementation, not from memory or the PR description: every screen, every button and control, the functions behind them, the API routes and server calls, who is permitted (and where that is enforced), and the workflows end to end. Add its rows to the module's coverage index with unique numbers and keep the totals equal to the entries.
   * **Update the guidance people read.** When a screen, label or step changes, update the affected staff-facing guidance that JARVIS answers from (today `apps/web/src/lib/jarvis/help/guidance.ts`; once draft PR #74 merges, the topics in `docs/enginious-os/staff-guidance/` with each topic's `screens`, published by `npm run build:jarvis-knowledge`), and update the JARVIS reference (`docs/enginious-os/modules/jarvis.md`, and the rulebook that PR #74 adds beside it) when what JARVIS may do, show or send changes.
   * **At handoff, list the docs.** Name every changed document and every verification gap that remains (what was not run, not seen or not re-read), so the next person does not have to rediscover them.
   * **After a merge or a hosted verification, reconcile the release status** in the same sitting or the next PR: the Map (`README.md` files and stamp tables, the module reference's status line, the coverage index), the release ledger (`05-data-tests-and-release-ledger.md`, `06-change-log.md`) and the install-order guide (`docs/launch-refinement-install-order.md`: a row per migration, in file-name order, with its verify and rollback files). Keep four facts apart and never fold one into another: merged (checked on GitHub), required CI on the exact head, the hosted database result (owner-reported unless Claude ran it), and Production (verified or not). Correct stale "draft", "not merged" and "not applied" wording where it describes the present; leave dated history in place and label it as history.
5. **Module references.** The **Sales & CRM** baseline is documented with named verification gaps: start from the [Sales & CRM coverage index](docs/enginious-os/modules/sales-coverage-index.md) (every reachable screen, with its detailed reference or a named gap) and the [action catalogue](docs/enginious-os/modules/sales-action-catalogue.md) (actions that change data, move a workflow or communicate externally, with permissions, starting states, stop-and-ask and retry guidance; a documented function is not an approved tool). The detailed per-control references for the other modules remain deferred until that module is worked on. **Still not written (deliberately deferred):** the bounded launch test pass (existing browser suites on the merged build, ordinary-staff journeys, a per-role breakage matrix, hosted and real-phone checks by the owner); and the open product decisions listed in `05-data-tests-and-release-ledger.md` section D ("Open owner decisions"), which remain open until the owner decides. Write a module reference only when about to test or change that module.

## Evidence rules
* Cite the source (repo path, migration, doc) for every claim.
* Mark anything not confirmed in code or by a run at the stamped commit as `Unverified`; do not remove it without evidence.
* Hosted facts (database state, Vercel, cron history, phones) are owner-reported unless Claude itself ran the check. Scheduler activation is an owner decision, and hosted scheduler status is `Unverified`.

## Other documents
Older design docs in `docs/` (`00` to `14`, module designs, deployment guides) are inputs, not authority; parts are stale (see the stale lists in the map). The authoritative migration list and order is `docs/launch-refinement-install-order.md`; runnable browser flows are in `apps/web/os-shell-checks/README.md`. Local auth is an in-repo stand-in, not Supabase Auth (`docs/people-access-account-controls-verification.md`).

## Boundaries that have applied to every release so far
* Never run SQL against the hosted database, enable the dispatch/return notes switch, activate scheduled jobs, change access, or create Production test data. The owner runs hosted SQL from the owner packs in `supabase/manual-sql` (read-only preflight / preservation / verify files are labelled; migrations and rollbacks change the database).
* Migrations are additive and idempotent, timestamp order is install order (`docs/launch-refinement-install-order.md`), and an applied migration is never edited: add a new one.
* Merge only when the owner asks, with merge commits, after required CI (`lint-typecheck-test`, `rls-policies`) is green on the exact head.
* A failed read must say it could not load, never show empty, zero or "no access".
