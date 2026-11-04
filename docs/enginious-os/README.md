# ENGINIOUS OS: app memory (index)

The written memory of the combined app after the launch-refinement release. Written so a new session or a new owner can learn what the app is, who can do what, and where to look, without re-reading the code.

## Files

| File | What it answers | Status |
|---|---|---|
| `01-overview-and-modules.md` | What the app is, stack, repo map, environments, module inventory, how modules connect, glossary, built vs deferred | Written |
| `02-screens-and-navigation.md` | Every route, who can reach it, the navigation as built, direct-URL behaviour, My Day structure, failed-read convention | Written |
| `03-roles-access-and-approvals.md` | HR roles, module grants, approval routing, People & Access | To be written |
| `04-flows-sales-to-warehouse-and-others.md` | Enquiry to handover to project to equipment to budget, plus leave, claims, Recovery Leave | To be written |
| `05-data-tests-and-release-ledger.md` | Data model map, test suites and what each proves, migration ledger | Written |
| `06-change-log.md` | One line per change to behaviour, access, navigation, flows, migrations or tests | Written |

Per-module control references (`modules/*.md`) were planned in `CLAUDE.md` and are not started.

## Verified-at stamp

| Item | Value | Source |
|---|---|---|
| Code verified at | `551f615` (main, merge of PR #56), 2026-11-04. Branch `docs/enginious-os-app-map` adds only `CLAUDE.md` and these files on top | `git log` |
| Files 01 and 02 checked against | `apps/web/src/components/nav/nav-groups.ts`, `apps/web/src/lib/my-day/attention.ts`, `apps/web/src/app/(app)/**/page.tsx` (route list), `apps/web/src/components/nav/shell-chrome.tsx`, `supabase/migrations/` file names | read at 551f615 |
| Pre-release spec used as a starting point | branch `docs/launch-refinement-spec`, `docs/launch-refinement/specification.md`, written at `76c121b` | partly stale, flagged where found |
| Hosted state | Migrations 1 to 15 of the launch stack applied on V2; Production Ready at 551f615; dispatch and return notes switch OFF | Owner-reported (`docs/launch-refinement-install-order.md` section 5, owner statement) |
| Draft-branch note | `02-screens-and-navigation.md` (People & Access) and `03-roles-access-and-approvals.md` (section 2.2a) describe branch `feat/module-access-simplify` (draft PR, not merged) until it merges | `06-change-log.md` |
| Not verified here | Anything needing a running app, a database, a phone or a hosted project | no servers or databases were started |

## Evidence conventions

* Every claim cites a source in backticks: a repo path, a migration name, a doc, or a spec section.
* `Unverified` marks anything not confirmed in code or by a run at the stamped commit. Do not remove it without evidence.
* Hosted-database facts are owner-reported unless Claude itself ran the check (Claude has run no hosted SQL).
* A statement taken from an older doc is marked "per `<doc>`" and checked against code where cheap; contradictions are listed as **Stale**.
* "Built" means code is present and wired; it does not mean it was tested on hosted data.

## Maintenance rule

Any change to behaviour, roles or permissions, navigation, a flow, a migration or the tests must update the relevant file here **and** add a line to `06-change-log.md` in the same pull request. Re-stamp the verified-at commit in the files you re-checked. Never edit an applied migration; add a new one and record it in file 05.

## Where to find things (top questions)

| Question | Go to |
|---|---|
| What modules exist and are they finished? | `01-overview-and-modules.md` (module table, built vs deferred) |
| How do Sales, Projects, Inventory and Budget connect? | `01-overview-and-modules.md` (connections); detail in `04-...` (to be written) |
| Which route shows X, and who can open it? | `02-screens-and-navigation.md` (route tables) |
| Why does a menu entry appear or not for a person? | `02-screens-and-navigation.md` (navigation conditions); source `apps/web/src/components/nav/nav-groups.ts` |
| What happens if someone types a URL they should not reach? | `02-screens-and-navigation.md` (direct-URL behaviour) |
| What does the My Day number count? | `02-screens-and-navigation.md` (My Day); `docs/os-my-day.md`; `apps/web/src/lib/my-day/attention.ts` |
| Who can approve what? | `03-...` (to be written); meanwhile `docs/03-permission-matrix.md`, `docs/people-access-design.md` |
| Which migrations are installed and in what order? | `docs/launch-refinement-install-order.md` (authoritative), later file 05 |
| How do I run and test safely? | `apps/web/os-shell-checks/README.md`, `CLAUDE.md` (boundaries) |
| What is intentionally not done yet? | `01-overview-and-modules.md` (built vs deferred); defect register `docs/launch-refinement/specification.md` on branch `docs/launch-refinement-spec` |

## Boundaries (from `CLAUDE.md`)

No SQL against hosted databases by Claude, no enabling the dispatch/return notes switch, no scheduled-job activation, no access changes, no Production test data. A failed read must say it could not load, never show empty, zero or "no access".
