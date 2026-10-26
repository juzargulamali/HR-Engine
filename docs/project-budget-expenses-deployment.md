# Project Budget & Expenses — deployment guide

This is the owner's runbook for **Project Budget & Expenses**, the fourth module of ENGINIOUS OS (after Sales & CRM, Projects & Tasks and Inventory). It is written so you can run
it step by step in the Supabase SQL Editor of **Enginious HR Engine_V2** and then decide when to merge. Design and decisions: [project-budget-expenses-design.md](./project-budget-expenses-design.md).

**Nothing in this change runs Production SQL, grants anyone real access, creates Production data, merges, deploys, enables a scheduled job, sends e-mail or uses a paid service.**
The pull request is a draft. Every step below is yours to run, in this order, and each step has a check before the next one.

> **Honest status.** Verified locally: real-PostgreSQL tests of every migration and rule (51 scenario tests, run together with the whole existing database suite), every owner script
> of this guide rehearsed against **throwaway local databases**, and a real-browser walk through the whole life of a budget (23 checks) on a local stack. **Not verified live:**
> nothing has run against your hosted Supabase project or Vercel. The exact Production deployment commit of the earlier redesign, and a signed-in Production smoke check of My Day,
> Sales, Projects, Inventory and HR, were **not confirmed** after PR #48 was merged (`20d0abf`; CI on that merge passed) and are not claimed here.

---

## 1. What this adds (and what it leaves alone)

| | |
|---|---|
| **Added** | A **Budget** tab on a project (for the Project Manager, and for Finance / CEO-CTO approver / read-only grantees of the owning company) with four sections — **Budget, Funds, Actual expenses, Settlement** — and a **Finance** menu entry with the **Project budgets** inbox (Budget approvals / Final expense approvals / Outstanding settlement). Both open the *same* record; there is no second approval form. |
| **Database** | Tables, functions, triggers and policies named `pbx_…` only (migrations `20261210000000` … `000400`). Additive: no existing table, column, policy, function, trigger or grant is changed. `pbx_05_preservation_check_readonly.sql` proves this (see §6). |
| **Not touched** | Attendance, Recovery Leave, payroll, leave, existing expense claims and their approval rules, Sales, Projects (including project status), Inventory, HR roles. A claim can be *linked* from an actual-expense line; the claim is never changed, paid or checked for duplicates by amount. |
| **Not built, on purpose** | Receipt upload or OCR, bank connections, Pluto integration, supplier purchasing, tax accounting, Zoho sync, payment execution, payroll deduction, e-mail, scheduled jobs. Receipts are handed to Finance outside the application; Finance records whether they arrived. |
| **Separate access** | Its own table `pbx_company_grants` (capabilities `finance`, `executive_approver`, `view`, `manage_access`), per company. **Nobody receives any automatically:** not a CEO or CTO by title or HR role (the company's authorised CEO / CTO approvers are *named* with `executive_approver`), HR Admin, System Admin, the HR *finance* role, a Projects founder, or a test account. A Project Manager needs no grant (they reach their own project's budget). |
| **Notifications** | The existing in-app notifications table only. Finance people who are not project participants see waiting decisions in the **Finance inbox**; the project-based *My Work* notification list shows them only to project participants. |

## 2. Rules built in

* **Approval routing (enforced in the database, fixed when something is submitted).** Applies alike to the initial budget, additional budget requests and final expenses.
  * A Project Manager **without Finance access** submits → an authorised **Finance** person of that company decides. **One Finance person is enough.**
  * A submitter **with Finance access for that company** (even when also the Project Manager) submits → the company's authorised **CEO / CTO approver** decides. Either a CEO or a CTO is sufficient; both are not required.
  * **Nobody approves their own submission** (nor anything they prepared), whatever else they hold; nobody outside the company's grants can decide or even see it.
  * If no eligible independent approver exists for the route, the request is **held** (*On hold*) with an explanation; nothing is approved or lost, and it is released as soon as an eligible person is authorised.
  * One decision per version (approve / return with a reason / reject with a reason); simultaneous decisions produce exactly one outcome. No overwriting: an approved budget is never edited; more money is a separate **additional budget request** with its own decision, and the revised total is original + approved additions (pending or rejected additions never count).
* **Funding, returns, reimbursements and receipt delivery are recorded by Finance, as declarations.** Finance records what was handed over (funding), what came back (returns), what was repaid (reimbursements) and that physical receipts arrived. These are declarations of Finance's own knowledge, not independent verification. Entries that involve the recorder themselves (Finance funding or reimbursing themselves) are allowed and are **flagged** "declared by the person it involves"; every entry keeps who, when and a reversible audit trail. One Finance person is enough: no second Finance person is ever required.
* **Settlement authority follows the final expenses.** For an ordinary Project Manager's settlement, Finance records receipts and closes it. Where the approved final expenses were submitted by someone with Finance access (the CEO/CTO route), Finance still records everything, but **an authorised, independent CEO / CTO approver must confirm the receipts and authorise closure**: Finance cannot independently verify its own receipts or close its own settlement. The approver must not have prepared or submitted the expenses or recorded the receipts; recording receipts again withdraws a confirmation. The CEO/CTO approver records no funds, returns, reimbursements or receipts. If no eligible approver exists, closure simply waits (the page says so); Finance may reopen a closed settlement with a reason but cannot re-close it.
* **No duplicate money or closure.** A retry or double click returns the same entry (request id); an identical funding or payment entry under a new click is refused unless it has its own reference or note; returns and reimbursements cannot exceed what is owed; settlement closes exactly once (a late second click changes nothing) and nothing can be recorded after closure until it is reopened.
* **Money is exact.** Totals are calculated on the server in decimal arithmetic and rounded once to the budget currency's decimals (AED/SAR/EUR 2, KWD 3, JPY 0). One currency per budget; nothing is converted. A foreign-currency payment is recorded in the line's note (original amount, currency, rate).
* **Actual expenses are typed by the Project Manager.** Approved amounts are shown for comparison and are never copied in. An empty line is *not entered*; a typed `0` is a confirmed zero. Submission needs every line entered, a completeness confirmation, and a note when the total is more than 10% away from the approved budget.
* **Settlement is per person and per source.** A cash/bank advance held by a person is separate from company-card / Pluto allocations (never owed back), direct company payments, and expenses paid personally (owed back). Spending is never simply subtracted from all funding. Partial returns and reimbursements are allowed. Lines already in an employee claim count as project expense but take no part in any balance.
* **Closing** needs approved final expenses, a reconciled advance and reimbursement balance, and receipts confirmed (or an approved exception with a reason). Closing never pays anyone. Settlement is independent of project completion: a completed or archived project still settles.
* **History is kept.** Submitted versions, decisions, funding entries and payments are immutable; a mistake is fixed with a reversal (reason required) and every change is audited in `pbx_audit_log`. Retries and double clicks cannot record twice; a stale page is refused with a plain message.
* **Petrol and meal rates** are Finance's, per company *and currency*. The page only *suggests* AED 0.50 per km and AED 30 per meal (flagged "not yet confirmed by Finance") until Finance enters the rate; it never applies a number to SAR, EUR or any other currency.

## 3. Files, in the order you use them

| Step | File | Writes? |
|---|---|---|
| 1 | `supabase/manual-sql/pbx_00_preflight_readonly.sql` | no |
| 2 | `supabase/manual-sql/pbx_05_preservation_check_readonly.sql` (snapshot mode) | no |
| 3 | the five migrations below, in this order | yes (additive) |
| 4 | `supabase/manual-sql/pbx_20_verify_readonly.sql` | no |
| 5 | `supabase/manual-sql/pbx_05_preservation_check_readonly.sql` (compare mode) | no |
| 6 | `supabase/manual-sql/pbx_30_bootstrap_access.sql` (**only when Finance has named the people**) | yes: access grants |
| – | `supabase/manual-sql/pbx_80_safe_disable_and_restore.sql` (pause / resume) | yes: one switch |
| – | `supabase/manual-sql/pbx_90_rollback.sql` (removal; refuses once data exists) | yes: destructive |

Migrations (supabase/migrations), apply **in exactly this order**:

1. `20261210000000_pbx_access_audit_settings.sql` — access grants, audit log, categories, company rates, company switch
2. `20261210000100_pbx_core_tables.sql` — budgets, versions, rows, funding, actual expenses, payments, guards and triggers
3. `20261210000200_pbx_budget_functions.sql` — create / save / submit / decide / revise budgets, additions
4. `20261210000300_pbx_funding_actuals_settlement.sql` — funding, actual expenses, receipts, payments, closing
5. `20261210000400_pbx_views.sql` — what the screens read

`schema/schema.sql` section 21 mirrors them verbatim. **Prerequisite:** Projects & Tasks (migrations `20261120…`) is installed; the preflight checks this.

## 4. Step by step

1. **Preflight.** Run `pbx_00_preflight_readonly.sql`. Every row of section B must say `OK`; section C must say "no Project Budget & Expenses objects exist yet". Section E lists people who *could* be named as Finance people or CEO / CTO approvers — information only (HR roles are not used for approval).
2. **Snapshot.** Run `pbx_05_preservation_check_readonly.sql` exactly as it is. Export the whole result and keep the **paste** column.
3. **Apply the five migrations** in the order above (SQL Editor, one file at a time; each is safe to re-run).
4. **Verify.** Run `pbx_20_verify_readonly.sql`: the last row (`SUMMARY`) must say `OK … 0 failing`. It checks tables, row-level security, that browsers cannot write tables directly, which functions browsers may call, the guard / calculation / audit triggers, and that no `pbx_` trigger sits on an existing table.
5. **Preservation compare.** Paste the saved lines into `pbx_05_…` where marked and run it again: the summary must say **PASS** (every non-`pbx_` structure fingerprint identical, no trigger added to an existing table).
6. **Access.** Ask Finance who they are, and name each company's authorised CEO / CTO approver(s). Edit `pbx_30_bootstrap_access.sql` (one line per person: `email => company => finance, manage_access` or `… => executive_approver`) and run it. It stops with a clear message on a placeholder, an unknown email or company, or a bad capability, changing nothing, and reports (information only) which route a company cannot serve yet: no Finance person, or no CEO / CTO approver. Read-only access (`view`) is a separate, explicit grant for people such as a founder you decide should see budgets.
7. **Finance sets the rates** in the app (Budget tab → *Company rates and categories*), per currency.
8. **Try it** with the acceptance checklist (§7) on one real project, then decide about merging. The module is dormant for everyone without a grant or a Project Manager role.

**Pause / resume.** `pbx_80_safe_disable_and_restore.sql` switches a company off: every change is refused in plain words, reading and access management keep working, nothing is deleted. **Removal** is `pbx_90_rollback.sql`; it refuses to run while any budget, funding, expense or payment data exists (prefer pausing).

## 5. Limits worth knowing

* One budget per project, one currency, no conversion; up to 200 budget lines and 400 actual-expense lines.
* A former Project Manager keeps read-only access to what they themselves prepared or submitted, and nothing else (no funds, no settlement); the new Project Manager takes over editing.
* A project has no "cancelled" status in this application: *completed* and *archived* projects behave the same here (records kept, settlement continues).
* Finance people who are not project participants do not see budget notifications in the *My Work* list (that list is project-based); they see the **Finance inbox**.
* The browser checks cover a single local company with fictional people. Multi-company isolation, concurrency and every permission rule are covered by the database tests.

## 6. How the preservation check works

The install adds only `pbx_` objects. `pbx_05` fingerprints every non-`pbx_` table, column, constraint, index, policy, function, trigger, view, enum, extension, privilege and storage rule before and after, and the set of rows that existed at the snapshot instant for every table that records creation time. Ordinary activity between the two runs (people clocking in, tasks moving) does not make it fail; a structural change or a vanished old row does. Unlike Inventory, this module adds **no trigger at all to an existing table**, so the "intended exception" list is empty and any such trigger fails the check.

## 7. Acceptance checklist (short)

**Project Manager**
- [ ] The project shows a **Budget** tab; I create the budget in the right currency and add lines (food 3 people × 2 days × 60 = 360, petrol 60 km × 0.50 = 30, metro 30 for a date range, truck 3 × 350 = 1,050); the total is 1,470.
- [ ] I save a draft, close the page, come back, and it is unchanged; I submit once and it appears as *Submitted*.
- [ ] A returned budget shows Finance's reason and lets me start a new draft; the earlier version is still there.
- [ ] After the project I start the actual expenses: nothing is pre-filled; blank lines stop me submitting; a typed 0 is accepted; unplanned expenses can be added; over/under is worded.
**Finance**
- [ ] **Finance → Project budgets** lists the waiting budget; opening it shows the same record; I can approve, return or reject a budget submitted by an ordinary Project Manager; I cannot decide one I prepared myself.
- [ ] A budget prepared by a Finance person shows *Waiting for the CEO or CTO* to Finance colleagues, and the company's CEO / CTO approver can decide it (either one is enough).
- [ ] I record a cash advance and a Pluto allocation and they are shown as different things.
- [ ] A Finance person can record funding or a reimbursement to themselves; it is shown as *declared by the person it involves*.
- [ ] For a Finance person's own project, Finance can record the receipts but only the CEO / CTO approver can confirm them and close the settlement.
- [ ] After approving the final expenses, Settlement shows the advance still to return, reimbursement owed, company-card and direct-paid spending separately; I record receipts and a part-return; Close only works when reconciled.
**Both**
- [ ] A colleague with no grant sees no Budget tab and no Finance entry; a project member without a grant sees nothing financial.
- [ ] On a phone, the screens fit without sideways scrolling.

## 8. Rehearsal evidence (what was actually run)

* `packages/rls-tests/test/project_budget.rls.test.ts`: calculations and rounding (incl. parity with the TypeScript library), decimal limits, petrol / meal rates, create / save / submit / retry, approval routing (ordinary PM → Finance; Finance-holding submitter → CEO/CTO; dual roles; route fixed at submission; initial budgets, additions and final expenses), independence (also enforced by a database guard), missing approvers, company isolation of the approver, concurrent decisions on both routes, return / reject / revise / discard, hold when no independent approver, additions, notifications, funding declarations (flagged, duplicate-proof), settlement authority (ordinary PM → Finance; Finance-submitted → independent CEO/CTO confirms receipts and authorises closure; hold; reopen), blank vs zero, unplanned lines, paid-via and claim links, foreign-currency notes, variance note, receipts and exceptions, partial returns and reimbursements, reversals, closing and reopening, company and project isolation, PM reassignment, archived project, the company switch, audit, and an HR / claims fingerprint that does not move.
* `apps/web/os-shell-checks/budget-flow.mjs` against `seed/budget.sh`: the whole life of a budget through the screens, light / dark, 390 px phone, keyboard tabs.
* Every owner script was run on throwaway databases: preflight (with and without the module), snapshot → install → compare (PASS), verify (0 failing), access setup (placeholder refusal, idempotent second run, bad capability refusal), switch-off / on, rollback (refusal with data, clean removal without, and a second install afterwards).
