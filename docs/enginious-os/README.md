# ENGINIOUS OS: app memory (index)

The written memory of the combined app after the launch-refinement release. Written so a new session or a new owner can learn what the app is, who can do what, and where to look, without re-reading the code.

## Files

Seven files: this README (index) and `01` to `06`.

| File | What it answers | Status |
|---|---|---|
| [`01-overview-and-modules.md`](./01-overview-and-modules.md) | What the app is, stack, repo map, environments, module inventory, how modules connect, glossary, built vs deferred | Written |
| [`02-screens-and-navigation.md`](./02-screens-and-navigation.md) | Every route, who can reach it, the navigation as built, direct-URL behaviour, My Day structure, failed-read convention | Written |
| [`03-roles-access-and-approvals.md`](./03-roles-access-and-approvals.md) | HR roles, module grants, approval routing, People & Access | Written |
| [`04-flows-sales-to-warehouse-and-others.md`](./04-flows-sales-to-warehouse-and-others.md) | Enquiry to handover to project to equipment to budget, plus leave, claims, Recovery Leave | Written |
| [`05-data-tests-and-release-ledger.md`](./05-data-tests-and-release-ledger.md) | Data model map, test suites and what each proves, migration ledger | Written |
| [`06-change-log.md`](./06-change-log.md) | One line per change to behaviour, access, navigation, flows, migrations or tests | Written |

Per-module control references (`modules/*.md`) are deliberately deferred and not started (see `CLAUDE.md`).

## Verified-at stamp

| Item | Value | Source |
|---|---|---|
| Code verified at (all sections except the Module access sections below) | `551f615` (main, merge of PR #56), 2026-11-04. This PR adds only `CLAUDE.md` and these files | `git log` |
| Files 01 and 02 checked against | `apps/web/src/components/nav/nav-groups.ts`, `apps/web/src/lib/my-day/attention.ts`, `apps/web/src/app/(app)/**/page.tsx` (route list), `apps/web/src/components/nav/shell-chrome.tsx`, `supabase/migrations/` file names | read at 551f615 |
| Pre-release spec used as a starting point | branch `docs/launch-refinement-spec`, `docs/launch-refinement/specification.md`, written at `76c121b` | partly stale, flagged where found |
| Hosted state | Migrations 1 to 15 of the launch stack applied on V2; Production Ready at 551f615; dispatch and return notes switch OFF | Owner-reported (`docs/launch-refinement-install-order.md` section 5, owner statement) |
| Module access sections of 02/03/06 | `28549dd` (2026-11-07). PR #57 (`feat/module-access-simplify`) MERGED at `28549dd` (2026-11-04); required CI green on PR head `2200c36` and on `main` at `28549dd`; no migration. Re-checked against `packages/domain/src/accessProfiles.ts`, `apps/web/src/components/people-access/module-access-panel.tsx`, `unsaved-access-guard.tsx`. Every other section stays at `551f615` | `06-change-log.md` |
| Clients & Agencies sections (02 Sales routes and menu row, `modules/sales-clients-and-agencies.md`, 06 entry) | Parts 1 and 2 as before (verified at `7d97600` and `2bd1569`). The three corrections (module doc section 9; the Confirm, Add follow-up and picker rows of 2.2 and 8.1; 02 Sales rows; 06 entry) verified at `0a02d2b` (docs-only stamp commit on top): lint, typecheck, root `npm test` (web 200 files / 2057 tests, domain 41 files / 474 tests), `cd apps/web && npx vitest run` (200 / 2057), placeholder-env build, `npm run check:secrets`, the FULL RLS suite (57 files / 1550 tests, including `crm-import-safety.rls.test.ts` with separate sessions) and one local-stack browser run, `apps/web/os-shell-checks/clients-agencies-flow.mjs` (15 of 15 steps passed, fictional data only). Branch `feat/clients-agencies` (draft PR, not merged), 2026-11-07. Migration `20261219000100` was corrected in place and is applied to no hosted project Pre-inquiry outreach (module doc section 10 including outcomes per activity kind and the reassignment history-access rule, the 02 `/sales/outreach` row and Sales menu row, 06 entries, deployment note) verified at `30c996c` (docs-only stamp commit on top): lint, typecheck, root `npm test` (web 204 files / 2083 tests, domain 41 / 474), `cd apps/web && npx vitest run` (204 / 2083), placeholder-env build, `npm run check:secrets`, the FULL RLS suite (58 files / 1572 tests, incl. `crm-outreach.rls.test.ts` 22 tests which also runs owner-pack file 20; one unrelated inventory cross-company test failed once in an earlier parallel run and passed on two single runs and on the clean full run) and one local-stack browser journey, `apps/web/os-shell-checks/clients-agencies-outreach-flow.mjs` (8 of 8 steps passed, fictional data only). Migration `20261219000100` corrected in place again, still applied to no hosted project. | `modules/sales-clients-and-agencies.md` sections 7 and 9.6 |
| Clients & Agencies directory table (`modules/sales-clients-and-agencies.md` sections 2.1, 4.1, 4.2 and the export row of 8.1; 06 entry of 2026-11-08) | Verified at `3574599` (docs and screenshots only on top): lint, typecheck, root `npm test` (web 207 files / 2130 tests, domain 41 / 474), `cd apps/web && npx vitest run` (207 / 2130), placeholder-env build, `npm run check:secrets`, and on the local stack (fictional data) `os-shell-checks/clients-agencies-table-flow.mjs` (7 of 7 steps), `clients-agencies-flow.mjs` (15 of 15) and `clients-agencies-outreach-flow.mjs` (8 of 8). No migration, no RLS suite needed. Branch `feat/clients-table` (not merged), 2026-11-08. Other Clients & Agencies sections keep their earlier stamps | `git log`, test output |
| Estimates & Quotations sections (`modules/sales-estimates-and-quotations.md`, the identifier parts of `modules/sales-clients-and-agencies.md`, 02 rows for the estimate routes, Sales settings and Admin Companies, 06 entry) | Part 1 first verified at `3b9f1a8`; part 2 and the owner changes (section numbering, Exclusions block, version-bound approval, pinned assets, PDF and Excel export) verified at `e840bf6` (docs-only stamp commit on top): lint, typecheck, root `npm test`, `cd apps/web && npx vitest run`, placeholder-env build, `npm run check:secrets`, the full RLS suite (1606 tests in 59 files, incl. `crm-quotations.rls.test.ts` which also runs owner pack files 00, 05, 20 and the rollback refusal), and the local-stack browser flow `apps/web/os-shell-checks/quotations-flow.mjs` (all steps PASS, including the stale-approval refusal, PDF and Excel downloads and the frozen re-export); at `e840bf6`: root `npm test` 2121 tests, web vitest 485 (export, pinning, approval-binding and action tests among them). Not run: any hosted SQL. Real object storage was later verified on an isolated local Supabase stack (quotations at `f90c915`, existing CRM compatibility at `2fef1f1`, which is not claimed to be the Production commit; see `docs/estimates-quotations-deployment.md` "Local release check"); hosted V2 is not yet verified | `git log` |
| Estimates-only change (`modules/sales-estimates-and-quotations.md` section 0 and the rewritten controls, 02 estimate row, 06 entry of 2026-11-08, deployment note) | Code verified at `158740c` (docs and stamp only on top): lint, typecheck, root `npm test` (web 215 files / 2213 tests, domain 43 / 496), `cd apps/web && npx vitest run` (215 / 2213), placeholder-env build, `npm run check:secrets`, and on the local stack (fictional data, in-memory storage seam for the evidence files because the stack has no object storage) `os-shell-checks/quotations-flow.mjs` (15 of 15 steps: finalising changes no status, stage or reservation/booking/follow-up/reminder/Zoho row; a frozen pre-change quotation is byte-identical and exports as issued). No migration, so the RLS suite was not run. Branch `feat/estimates-only` (not merged), 2026-11-08. Photo upload and storage-backed export were not re-verified; hosted V2 not verified | `git log`, test output |
| Estimates-only database guard and EST- references (`modules/sales-estimates-and-quotations.md` section 0 rows Reference prefix and Shared proposal status, controls, section 4; 06 entry; install-order section 6; deployment guide section "Estimates-only database guard (owner-run)") | Verified at the commit that added the migration (docs-only stamp commit on top): lint, typecheck, root `npm test` (web 215 files / 2214 tests, domain 43 / 496), `cd apps/web && npx vitest run` (215 / 2214), placeholder-env build, `npm run check:secrets`, the FULL RLS suite (60 files / 1622 tests, including the new `crm-estimates-only-guards.rls.test.ts` (16 tests, with the owner pack rehearsal and rollback) and the unchanged `crm-quotations.rls.test.ts`), and on the local stack (fictional data) `os-shell-checks/quotations-flow.mjs` (15 of 15 steps, including a direct database refusal by the owner and a founder). Migration `20261221000100`, owner pack `crm_estguard_*`. **Not applied on hosted V2; nothing hosted verified.** Branch `feat/estimates-only` (PR #64 draft, not merged), 2026-11-08 | `git log`, test output |
| Vercel Production status for `28549dd` | not verified by Claude (owner to confirm) | none |
| Hosted scheduler status | Scheduler activation is deferred by owner decision (not enabled or changed here). Vercel cron and `pg_cron` histories: `Unverified` (owner to check) | `04-flows-sales-to-warehouse-and-others.md` section 5 |
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
| How do Sales, Projects, Inventory and Budget connect? | `01-overview-and-modules.md` (connections); detail in `04-flows-sales-to-warehouse-and-others.md` |
| Which route shows X, and who can open it? | `02-screens-and-navigation.md` (route tables) |
| Why does a menu entry appear or not for a person? | `02-screens-and-navigation.md` (navigation conditions); source `apps/web/src/components/nav/nav-groups.ts` |
| What happens if someone types a URL they should not reach? | `02-screens-and-navigation.md` (direct-URL behaviour) |
| What does the My Day number count? | `02-screens-and-navigation.md` (My Day); `docs/os-my-day.md`; `apps/web/src/lib/my-day/attention.ts` |
| Who can approve what? | [`03-roles-access-and-approvals.md`](./03-roles-access-and-approvals.md) (section 4); budgets use the separate `pbx_*` path (03 section 4.5); older: `docs/03-permission-matrix.md`, `docs/people-access-design.md` |
| Which migrations are installed and in what order? | `docs/launch-refinement-install-order.md` (authoritative), [`05-data-tests-and-release-ledger.md`](./05-data-tests-and-release-ledger.md) section B |
| How do I run and test safely? | `apps/web/os-shell-checks/README.md`, `CLAUDE.md` (boundaries) |
| What is intentionally not done yet? | `01-overview-and-modules.md` (built vs deferred); defect register `docs/launch-refinement/specification.md` on branch `docs/launch-refinement-spec` |

## Boundaries (from `CLAUDE.md`)

No SQL against hosted databases by Claude, no enabling the dispatch/return notes switch, no scheduled-job activation, no access changes, no Production test data. A failed read must say it could not load, never show empty, zero or "no access".
