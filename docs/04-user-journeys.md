# 4. User Journeys

Each journey names the screens, the Server Actions invoked, and which tables/RLS policies are
exercised, so the schema and permission matrix can be sanity-checked against real flows.

## 4.1 Employee — submit a leave request

1. Employee opens **My Leave** → sees current balances (`leave_balances`, `comp_day_balances`
   views), filtered by `leave_requests_select`/ledger `select` policies to their own
   `employee_id`.
2. Selects leave type, date range, half-day flags. Client calls a Server Action
   `previewLeaveRequest()` which runs the **same** domain function used server-side
   (`computeLeaveDays`) to show total working days, excluding weekends/`public_holidays` for their
   `country_code`, resolved via `resolve_policy('leave_rules', ...)`.
3. Submits. `submitLeaveRequest()` Server Action:
   - Re-validates dates/overlaps against existing `leave_requests` for the same employee (no two
     overlapping approved/pending requests — enforced by domain code + a DB constraint check).
   - Re-computes `total_days` deterministically (never trusts the client-sent number).
   - Checks projected balance (ledger sum + comp-day balance per `deduction_priority_rules`) is
     sufficient, or flags as "will require unpaid leave / HR approval" per policy.
   - Inserts `leave_requests` row (`status = 'submitted'`), resolves the workflow via
     `approval_workflows`/`approval_workflow_steps` for `entity_type = 'leave_request'`, inserts
     the first `approvals` row (`decision = 'pending'`, `approver_id` = resolved manager).
   - Notifies the approver (`notifications` row + email).
4. Employee sees status update in real time (Supabase Realtime subscription scoped by RLS to their
   own request).

## 4.2 Line Manager — approve leave, view team calendar

1. Manager opens **Approvals** queue: `approvals_select` policy shows rows where
   `approver_id = auth.uid()`.
2. Opens a request; sees requester's remaining balance (read via `is_manager_of` policy on
   `leave_ledger`), team calendar (overlap warnings computed client-side from already-approved team
   requests).
3. Approves or rejects with a comment. `decideApproval()` Server Action:
   - Updates the `approvals` row (`decision`, `decided_at`, `comments`) — allowed only because
     `approver_id = auth.uid()` and current `decision = 'pending'` (RLS `approvals_decide`).
   - If more workflow steps remain and the condition matches (e.g. duration > threshold requires
     HR Admin too), inserts the next `approvals` row.
   - If this was the final step and decision = approved: writes the deterministic
     `leave_ledger`/`comp_day_ledger` deduction entries (per `deduction_priority_rules`), updates
     `leave_requests.status = 'approved'`. All of this happens inside one DB transaction in the
     Server Action using the service-role client (server-only) so the ledger write and status
     update are atomic; the *decision itself* was made under the manager's own RLS identity in the
     preceding step, preserving "who approved" in `audit_log`.
   - If rejected: `leave_requests.status = 'rejected'`, no ledger entry.
4. Manager cannot edit their own leave requests' approval (skip-self rule, §3.7).

## 4.3 HR Admin — onboard a new employee

1. **New Hire Wizard**: creates `employees` row, first `employment_contracts` version, first
   `compensation_details` version (or defers compensation entry to a Finance-visible follow-up
   task if company policy separates the two).
2. Selects an onboarding `checklist_templates` row for the country/company; system generates
   `employee_checklist_items` rows with `due_date = hire_date + due_offset_days`, assigned to the
   relevant role (IT asset issuance → Sys Admin/IT-tagged HR Admin, workstation → Line Manager,
   contract signature → HR Admin).
3. Uploads identity documents (passport/Emirates ID/etc.) → `identity_documents` + Storage upload
   to `identity-documents` bucket; sets `expiry_date` which feeds the document-expiry job (§5).
4. Assigns manager (`employees.manager_id`), department, and provisions login: creates the
   `auth.users` row (Supabase Auth invite email) and links `employees.user_id`, then grants the
   `employee` role (and `line_manager` if applicable) via `user_roles`.
5. Each checklist item completion is tracked (`employee_checklist_items.status`), visible on the
   employee's onboarding progress screen and the HR dashboard.

## 4.4 HR Admin — offboard an employee

1. Initiates offboarding from the employee profile: sets `employment_status = 'terminated'`
   effective date, generates `offboarding` checklist from template (asset return, exit interview,
   final settlement calculation, access revocation).
2. Finance task in the checklist: **final settlement** — a deterministic domain function computes
   unused leave encashment (from `leave_balances`), pending reimbursements, and pro-rated salary,
   using `resolve_policy('end_of_service_benefit', country_code, termination_date)` for
   country-specific EOSB/severance rules (UAE gratuity, KSA end-of-service, Poland notice pay) —
   never hard-coded per country in application code.
3. On completion of all checklist items, Sys Admin (or an automated step triggered by the last
   checklist item, still requiring an explicit human confirmation click) revokes `user_roles` and
   disables the `auth.users` account. The `employees` row is **soft-deleted** only after final
   payroll processing closes (`deleted_at` set), never before — the record must remain queryable
   for tax/labor-law retention periods.

## 4.5 Employee — reimbursement claim with receipts

1. **New Claim**: adds one or more lines (date, category, amount, project allocation for billable
   expenses), uploads a receipt image/PDF per line to the `receipts` bucket at
   `{company_id}/{employee_id}/{claim_id}/...` (upload allowed only for the claim's own employee
   while `status = 'draft'`).
2. Submits. Workflow resolves by amount thresholds from `approval_workflow_steps.condition`: small
   claims → manager only; large claims → manager then Finance; very large → + CEO.
3. Finance reviews approved claims in **Payables** queue, marks as paid (`reimbursement_claims`
   status progression is `submitted → pending_approval → approved → paid` — "paid" transition is a
   Finance-only action, distinct from "approved," so approval and disbursement remain separately
   auditable).
4. Approved, unpaid claims feed the next `payroll_export_lines` generation as a `reimbursement`
   component.

## 4.6 Line Manager / Employee — timesheets

1. Employee logs daily/weekly hours against `project_allocations` they're assigned to.
2. Submits timesheet for the period; manager approves per entry or per timesheet.
3. Approved timesheet hours feed: (a) billable-hours reporting per project, (b) overtime
   calculation (via `resolve_policy('overtime_rules', ...)`) which can generate `comp_day_ledger`
   "earned" entries automatically (deterministic job, §5), and (c) payroll overtime component.

## 4.7 Line Manager — performance appraisal

1. HR Admin opens a `performance_cycles` window; managers get a task per direct report.
2. Employee fills self-assessment against their `goals`; manager writes the `appraisals` row,
   ratings, strengths/improvement areas.
3. Manager submits (`status = 'submitted'`) → employee is notified, reviews, and acknowledges
   (`status = 'acknowledged'`, `acknowledged_at` set) — acknowledgement is not agreement, just
   confirmation of receipt, mirroring standard HR practice and avoiding a dispute workflow in v1.
4. HR Admin can view all appraisals in the cycle for calibration; Finance cannot.

## 4.8 Finance — payroll-variable export

1. Opens **Payroll Export** for a company + period. System runs the deterministic export job:
   aggregates approved timesheet overtime, approved unpaid reimbursements, leave
   encashments/deductions from the ledgers, into `payroll_export_lines` grouped by
   `component_code`.
2. Finance reviews the generated lines (this is a **variable-pay export**, not a full payroll run —
   base salary lives in the country's payroll system already; this feeds the variable components
   into it).
3. Finance (or CEO, per company policy) authorizes (`payroll_export_runs.authorized_by/at` set) —
   this is the gate before the file is downloadable/sendable; authorization is itself an
   `approvals`-style logged action.
4. Downloads CSV/XLSX for import into the country payroll provider.

## 4.9 CEO — dashboards and executive approvals

1. Opens **Executive Dashboard**: headcount by country/department, attrition, leave liability
   (sum of outstanding `leave_ledger` balances valued at current salary — a Finance-relevant
   number), pending high-value approvals awaiting CEO action.
2. Approves/rejects items routed to them by workflow condition (large reimbursements, policy
   activation, payroll authorization if configured) — same `approvals` mechanism as any other
   role, just a different `approver_type` in the workflow step.

## 4.10 System Administrator — access & configuration

1. Manages `companies`, `countries`, `departments` structural data; creates/deactivates
   `auth.users` accounts; assigns/revokes `user_roles`.
2. Views system-level `audit_log` entries (login events, role changes, config changes) — not
   general HR content — to investigate access issues.
3. Configures Storage bucket lifecycle, backup verification, and integration credentials (never
   exposed to the browser bundle — see architecture §1.6).

## 4.11 AI-assisted draft flow (cross-cutting)

Example: an AI assistant reviews attendance anomalies and drafts a leave-ledger correction.

1. AI process (running under its own restricted service identity, not any human's session) writes
   one row to `ai_drafts`: `proposed_action = 'adjust_balance'`, `proposed_payload` with the
   suggested ledger entry and `rationale` explaining why.
2. HR Admin sees it in the **AI Suggestions** queue (`ai_drafts_select`). They review the rationale
   against source data (still visible to them via normal RLS).
3. If they agree, they click **Authorize**, which calls the *normal* `postLedgerAdjustment()`
   Server Action (same one used for a manual correction), pre-filled from the draft. The write to
   `leave_ledger` happens under the HR Admin's own identity/RLS, is captured in `audit_log` as
   theirs, and `ai_drafts.status` flips to `authorized` with a `reference_id` back-link.
4. If they disagree, `status = 'rejected'` — no data changes anywhere else. At no point does the AI
   process have a code path that writes to `leave_ledger`, `approvals`, `payroll_export_lines`, or
   any soft-delete flag directly.

Proceed to [05-automation-rules.md](./05-automation-rules.md).
