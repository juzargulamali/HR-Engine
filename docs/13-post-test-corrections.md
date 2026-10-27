# 13. Post-test corrections and missing features

A single list of everything we decided to fix or add **after the one-week internal test (Tue 6 – Sun 11 Oct 2026)**.
Nothing here is being built during the test week. When the test is over we go through the list together, decide what is
in, and do the agreed items in separate pull requests (database changes as manual SQL, the usual way: read-only preflight,
tested migration, verification SQL).

**How to add an item:** append a row to the table and a section below it. Give it the next number (`PTC-NN`), say who found
it and when, what happens today, what we want instead, and any open question. Keep one problem per item. The test team's own
findings live in the *Bug log* sheet of the test workbook; copy the ones we agree to fix into this list.

| ID | Item | Type | Found | Proposed priority | Status |
|---|---|---|---|---|---|
| PTC-01 | Warn when someone clocks in on a day of approved leave | Missing feature | Owner, 6 Oct | Medium | Open |
| PTC-02 | HR "Adjust balance" form on the employee's Leave tab (plus a ledger history) | Missing feature | Owner, 6 Oct | High | Open |
| PTC-03 | Old Recovery Leave section and form still show on the Leave tab under the new rules | To confirm | Owner screenshot, 6 Oct | Medium | Open |
| PTC-04 | A CEO/CTO's claim can be routed to themselves when they also hold the Finance role | Known issue (code parked) | Owner, 4 Oct | Low | Parked |
| PTC-05 | "Leave submitted" email wording for auto-approved CEO/CTO leave | Wording | Claude, 4 Oct | Low | Parked |
| PTC-06 | Preview deployments have no Supabase settings (every preview shows "Internal Server Error") | Infrastructure | Owner, 5 Oct | Low | Open |

---

## PTC-01 — Warn when someone clocks in on approved leave

**Today.** Nothing stops or warns an employee who clocks in on a day they have approved leave for. What the system does do:
the leave stays deducted; the HR Attendance register shows the person as "On leave"; and if the 24-hour work window that
starts on that day earns Recovery credit, the request is marked *"Overlaps approved leave"* and HR has to verify it before it
can be approved (`leave_conflict` in `apps/web/src/lib/recovery/labels.ts`). A normal day earns nothing, so usually nobody notices.

**Wanted.** A clear message on the My Attendance Clock card (and the dashboard clock card) when today is an approved leave day,
for example: *"You have approved leave today. If you are working, ask HR to return the leave day."*

**Open questions.** Warn only, or ask for a confirmation before clock-in? Should HR get an alert when it happens? Half-day leave?

**Where.** `apps/web/src/app/(app)/attendance-clock-card.tsx` and the clock-in path; the leave check already exists in the
database (`leave_requests` with status `approved`).

## PTC-02 — HR "Adjust balance" form (and a ledger history)

**Today.** There is no screen for HR to add or remove leave days. The save logic exists
(`postLeaveLedgerAdjustment` in `apps/web/src/lib/actions/ledgerAdjustments.ts`, protected by the `leave_ledger_insert_hr` policy
and recorded in the audit log) but only the AI-suggestions page uses it. This matters because an approved leave request
**cannot be cancelled once it has started** (`cancel_leave_request()`: "ask HR for a manual adjustment instead"), so today the
only way to return a day is SQL. The Leave tab also shows balances and requests but **no ledger history**.

**Wanted.**
- On the employee's **Leave** tab, for **HR Admin of that company only**: an *Adjust balance* form — leave type, signed number of
  days (not zero), **required reason**, a confirmation step. Posts through the existing action.
- A readable **history** of ledger entries (accruals, deductions, adjustments, reversals) with who and why.
- Decide whether the same form should cover Recovery Leave (comp-off) balances (`comp_day_ledger` already has `comp_ledger_insert_hr`).
- Tests: HR can adjust their own company's employee; an employee, a manager and another company's HR cannot; the balance and the
  audit log change; amount zero and empty reason are refused.

**Workaround until then (owner runs it once in the Supabase SQL Editor):**

```sql
insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, note, created_by)
select e.id, 'annual', current_date, 'adjustment', 1, 'manual_adjustment',
       'Reason for the adjustment here', u.id
from employees e join auth.users u on u.id = e.user_id
where u.email = 'person@enginious.ae'
returning id, leave_type_code, amount_days, txn_date, note;
```

Use a negative `amount_days` to take days away. Ledger rows are never edited or deleted: a mistake is corrected with another row.

## PTC-03 — Old Recovery Leave section and form on the Leave tab

**Seen.** On the employee Leave tab (owner screenshot, 6 Oct) the section *"Recovery Leave earning (Line Manager → HR Admin
approval)"* still lists old same-day-rule requests (30 Sep, 1 Oct, 3 Oct, all "submitted") and offers *"Record an exceptional
overnight extension"*, although UAE now runs on the 24-hour window rules and a CEO/CTO's own Recovery credit needs no approver.

**To confirm together.** Should the old section and the old form be hidden for countries on the window rules? Should the title
say who approves, per person? Should the three old "submitted" items be cancelled (they are also workbook check K7)?

## PTC-04 — A CEO/CTO's claim routed to themselves (parked)

**Today.** A reimbursement claim by a CEO/CTO goes to the Finance role holder with the earliest grant. If that is the same person
(as with the owner's account, which holds every role for now), the claim lands with themselves. A fix is ready and **not shipped**
on branch `fix/executive-claims-never-to-self` (commit `33398ef`): the claim goes to a Finance holder other than the claimant.

**Decision needed.** Ship it, or leave it because the owner will hold only the CEO role later.

## PTC-05 — "Leave submitted" email for auto-approved CEO/CTO leave (parked)

The notification a CEO/CTO gets still reads as a submission although the leave was approved on the spot. Cosmetic: reword so it says
"approved automatically".

## PTC-06 — Preview deployments show "Internal Server Error"

Vercel preview deployments (the per-pull-request addresses) have no Supabase variables, so `apps/web/src/proxy.ts` throws on every
request ("Your project's URL and Key are required"). Production is fine and CI does not need previews. Do **not** simply point
previews at the live database: unreviewed code would run on real company data. Proper fix: a separate Supabase project for
previews with test data, and its URL and keys in the Vercel **Preview** variables (plus its auth redirect list).

---

## From the test week

Add the agreed items from the test workbook's *Bug log* here (one row in the table at the top, one section below), then we decide
what goes in, in what order.
