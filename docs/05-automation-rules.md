# 5. Automation Rules

All automation splits into two categories: **deterministic scheduled/triggered jobs** (deploy as
Supabase Edge Functions or `pg_cron` jobs, calling the same `packages/domain` code used by
Server Actions) and the **AI-draft boundary** (anything generative or judgment-based). The two
must never blur — a scheduled job is allowed to write ledgers/approvals directly (it runs under
`service_role`, is code-reviewed, and is unit-tested); an AI process is never allowed to, regardless
of how it's triggered.

## 5.1 Deterministic scheduled jobs

| Job | Trigger | What it does | Writes to |
|---|---|---|---|
| **Leave accrual run** | Monthly, per company (`pg_cron` or Edge Function on a Vercel Cron hit) | For each active employee, resolves the active `leave_rules` policy for their country as of run date, computes accrual per `policy_leave_types.accrual_method`/`accrual_rate_per_period`, respects `min_service_days_to_accrue` and `max_balance_days` cap | `leave_ledger` (`entry_type = 'accrual'`) |
| **Carryover / expiry run** | Annually (or per policy's fiscal year end) | Computes carryover amount capped at `carryover_max_days`, posts forfeiture for anything beyond the cap, schedules `carryover_expiry_months` out | `leave_ledger` (`carryover`, `adjustment` for forfeiture) |
| **Comp-day expiry sweep** | Daily | Finds `comp_day_ledger` "earned" entries whose `expiry_date` has passed and no corresponding "redeemed" consumed them (FIFO), posts an "expired" offsetting entry | `comp_day_ledger` |
| **Overtime → comp-day accrual** | On timesheet approval (event-triggered, not scheduled) | Resolves `overtime_rules` policy, converts approved overtime hours beyond threshold into comp-day entries per country rule | `comp_day_ledger` |
| **Document expiry reminders** | Daily | Joins `employee_documents`/`identity_documents` expiry dates against `document_expiry_reminder_rules` lead times; for each lead time not yet notified (`document_expiry_reminders_sent`), creates a `notifications` row + email to employee/HR Admin | `notifications`, `document_expiry_reminders_sent`; updates `employee_documents.status` (`valid` → `expiring_soon` → `expired`) |
| **Probation/contract-end reminders** | Daily | Flags `employment_contracts` with `probation_end_date`/`end_date` inside a configurable window | `notifications` |
| **Approval SLA escalation** | Daily/hourly | Finds `approvals` rows `pending` beyond an SLA (e.g. 3 business days), notifies the approver and optionally escalates to their manager per workflow config | `notifications`; optionally inserts an escalation `approvals` row |
| **Payroll-variable export generation** | On demand (Finance-triggered) or scheduled pre-payroll-cutoff reminder | Aggregates approved reimbursements, overtime, leave deductions/encashments for the period into `payroll_export_lines`; this is a **calculation** job (deterministic), not the authorization step (which stays a human Server Action, §4.8) | `payroll_export_runs`, `payroll_export_lines` |
| **Leave overlap/holiday recompute** | On public-holiday-calendar update | If a country's `public_holidays` row is added retroactively for a date inside an already-approved leave request, recomputes `total_days` and posts a correcting ledger entry (never edits the original request/ledger row) | `leave_ledger` (`adjustment`) |
| **Nightly balance materialization** | Nightly | Refreshes a materialized view/summary table of `leave_balances`/`comp_day_balances` for dashboard read performance (the live views remain the source of truth; this is a cache) | `leave_balances_cache` (materialized) |

## 5.2 Deterministic calculation rules (the "must be app code, not AI, not ad hoc SQL" list)

- **Leave day counting**: working days between `start_date` and `end_date` inclusive, minus
  weekends per `countries.week_start_day`/company work-week config, minus `public_holidays` for the
  employee's `country_code`, adjusted for `half_day_start`/`half_day_end`. One function:
  `computeLeaveDays(countryCode, startDate, endDate, halfDayFlags)`. Unit-tested against each
  country's actual weekend pattern (Fri–Sat for UAE/KSA, Sat–Sun for Poland) and a holiday-spanning
  case.
- **Balance sufficiency & deduction order**: `resolveDeductionSources(employeeId, leaveTypeCode,
  requestedDays)` reads `deduction_priority_rules` for the scope (company overrides country
  default) and draws down comp-days before annual leave (or whatever order is configured),
  returning the exact ledger entries to post. Never guesses; if insufficient balance and policy
  doesn't allow negative/unpaid leave, the Server Action rejects submission before it reaches an
  approver.
- **Overlap detection**: no two `leave_requests` for the same employee with status in
  (`submitted`,`pending_approval`,`approved`) may have overlapping date ranges — checked in the
  Server Action and backed by a partial exclusion constraint consideration (documented as a
  follow-up hardening item in the risk register, since exclusion constraints across a mutable
  `status` column need care).
- **Notice period / probation math**: `resolve_policy('notice_period'|'probation_rules', ...)` +
  employee hire/contract dates → last working day, notice pay if waived. Same function used by
  offboarding checklist due-date generation and final settlement.
- **End-of-service / severance**: `computeFinalSettlement(employeeId, terminationDate)` composes
  leave encashment (from `leave_balances` at termination date × current daily rate from
  `compensation_details`), pending approved reimbursements, and country severance formula from
  `resolve_policy('end_of_service_benefit', ...)`. Entirely data-driven per country.
- **Currency/rounding**: all monetary fields are `numeric`, never `float`; rounding follows
  ISO 4217 minor-unit rules per currency (0 decimals for some, 2 for AED/SAR/PLN in practice, but
  the rounding function is currency-parameterized, not hard-coded to "2").

## 5.3 Approval routing rules

- Workflow resolution is table-driven (`approval_workflows`/`approval_workflow_steps`), not
  branched in code by entity type beyond "look up the active workflow for this
  company/country/entity_type."
- `approver_type` resolution:
  - `direct_manager` → `employees.manager_id` of the requester.
  - `manager_of_manager` → walk one more level up the chain (reuses `is_manager_of` logic).
  - `role:hr_admin`/`role:finance`/`role:ceo` → any active holder of that role scoped to the
    requester's company; if more than one, the first to act wins (first-come), others' pending rows
    are marked `skipped`.
- **Self-approval is structurally prevented**: if a resolved approver's `user_id` equals the
  requester's `user_id`, the resolver skips to the next step automatically and logs why in
  `approvals.comments` (system-generated skip reason), never silently auto-approving.
- Rejection at any step stops the chain; already-decided steps remain in the log unchanged.

## 5.4 The AI-draft boundary — what AI may and may never do

**Never** (no code path exists for this, enforced by the schema: no RLS policy grants an AI
service identity insert/update on these tables):
- Approve or reject anything in `approvals`.
- Post to `leave_ledger`, `comp_day_ledger`, or `payroll_export_lines`.
- Set `deleted_at` on any record.
- Change `compensation_details`, `identity_documents`, or `employees.employment_status`.
- Authorize a `payroll_export_runs` row.

**Allowed, always as a draft**:
- Propose a leave-balance correction after spotting a discrepancy (e.g. import error) →
  `ai_drafts(proposed_action='adjust_balance')`.
- Draft appraisal narrative text from goal completion data, for the manager to edit and own before
  submitting — this draft lives in the manager's UI state / an `appraisals.status='draft'` row they
  control, not in `ai_drafts`, since it's assistive text entry rather than a system action; the
  manager's submit is what commits it, same as if they'd typed it themselves.
- Draft a letter body from a template + employee data for HR Admin to review before issuing.
- Summarize onboarding/offboarding checklist status for a dashboard widget (read-only synthesis,
  no write at all).
- Flag anomalies (attendance vs. timesheet mismatch, document about to expire with no reminder
  configured) as a notification, not a mutation.

Every `ai_drafts` row is visible in an **AI Suggestions** queue restricted to HR Admin/Sys Admin
(and Finance for payroll-adjacent drafts) — nothing is auto-applied on a timer, and there is no
"auto-authorize" setting exposed anywhere in the product.

Proceed to [06-implementation-phases.md](./06-implementation-phases.md).
