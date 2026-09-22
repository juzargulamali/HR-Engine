# 6. Implementation Phases

Each phase ends with a working, deployed increment and its own tests — not a "big bang" at the end.
Phases are sequential dependencies; a phase should not start implementation until the prior phase's
domain logic has unit tests green.

## Company context

Enginious LLC FZ is headquartered in the **UAE**, with **Saudi Arabia** and **Poland** run as
smaller satellite offices with limited headcount today. This shapes the plan in three concrete
ways:

- **UAE is the build-and-pilot country**, not just an equal third of the initial scope — its policy
  set, approval structure, and letter templates are built and validated first, with KSA and Poland
  proven against the same generic engine afterward (§ Phase 7 rollout order).
- **Role coverage can be thin at the satellite offices without special-casing the schema.** A KSA
  or Poland employee's Line Manager, HR Admin, or Finance approver can be a HQ-based person holding
  a role scoped to that `country_code`/`company_id` (see `user_roles` in the schema doc) — there is
  no requirement to staff a full local HR/Finance function before onboarding employees there.
- **Growth headroom is assumed.** KSA/Poland having "limited employees currently" is a headcount
  fact, not a design constraint — the schema and policy engine are already headcount-agnostic, so
  no rework is needed if either office grows.

## Phase 0 — Foundations (auth, tenancy, RLS skeleton)
- Next.js + TypeScript + Tailwind + shadcn/ui scaffold; Supabase project provisioning
  (dev/staging/prod).
- `countries`, `companies`, `departments`, `profiles`, `user_roles`, `employees` (core columns
  only), helper functions (`current_employee_id`, `has_role`, `is_manager_of`, `same_company`).
- Supabase Auth wired up (email/password), role assignment UI for Sys Admin.
- RLS enabled on every table from day one (even if a table only has one policy at first) — never a
  "add RLS later" step.
- CI: lint, typecheck, a first RLS policy test harness (spin up local Supabase, run pgTAP or
  Vitest-driven policy assertions as different simulated JWTs).
- **Exit criteria**: a Sys Admin can create a company/country and create a user and assign a role
  (per the permission matrix, §3.6 — company/country structure is Sys Admin's, not HR Admin's), an
  Employee can log in and see only their own (empty) profile.

## Phase 1 — Employee master data & contracts
- Full `employees`, `employment_contracts`, `compensation_details`, `identity_documents` tables +
  RLS from schema.sql.
- Employee profile UI (self-service contact info edit; HR Admin full edit).
- Storage buckets `employee-documents`, `identity-documents` with path-based policies.
- Soft delete pattern implemented and tested (a "deleted" employee disappears from default queries
  but is recoverable by HR Admin/Sys Admin).
- **Tests**: RLS — employee cannot read another employee's compensation; manager can read team
  profile but not compensation; contract history query returns "as of date" correctly across
  versions.

## Phase 2 — Country policy engine
- `policy_versions`, `policy_leave_types`, `public_holidays`, `resolve_policy()`.
- Policy authoring UI (HR Admin drafts a version; activation requires a second approver — either a
  second HR Admin or CEO, per the permission matrix).
- Seed initial UAE/KSA/Poland leave, holiday, notice-period, probation policies as data (not code).
- **Tests**: exclusion constraint rejects overlapping active versions; `resolve_policy` returns the
  correct version across a boundary date; adding a 4th country requires zero code changes (proven
  by a test that inserts a fictitious country's policy and exercises the same functions).

## Phase 3 — Leave, comp-off ledger, deduction priority, approvals engine
- `leave_requests`, `leave_ledger`, `comp_day_ledger`, `deduction_priority_rules`,
  `approval_workflows`/`approval_workflow_steps`/`approvals` (generic engine, first consumer =
  leave).
- Domain package: `computeLeaveDays`, `resolveDeductionSources`, approval routing resolver
  (including self-approval skip).
- Leave request UI (employee), approval queue (manager/HR Admin), balance views.
- Scheduled jobs: monthly accrual, comp-day expiry sweep.
- **Tests** (explicitly required by the task): balance math (accrual, deduction, carryover cap,
  negative-balance prevention), overlap rejection, comp-day FIFO expiry, multi-level approval
  routing including the self-approval skip and rejection-stops-chain behavior.

## Phase 4 — Reimbursements, projects, attendance & timesheets
- `projects`, `project_allocations`, `reimbursement_claims`/`lines`, `attendance_records`,
  `timesheets`/`entries`.
- Receipts bucket + upload UI; claim submission and threshold-based approval routing (reuses the
  Phase 3 approval engine — proves it's genuinely generic).
- Overtime → comp-day accrual job (reuses Phase 3 ledger + Phase 2 policy resolver).
- **Tests**: threshold routing (small vs. large claim goes to different approver sets), overtime
  conversion respects country policy, timesheet hour caps.

## Phase 5 — Performance, onboarding/offboarding, documents, assets
- `performance_cycles`, `goals`, `appraisals` with their separate RLS tier.
- `checklist_templates`/`items`, `employee_checklist_items` for onboarding/offboarding, wired to
  the offboarding final-settlement calculation (reuses Phase 3 ledgers + Phase 2 policy for
  EOSB/severance).
- `employee_documents`, expiry status transitions, reminder scheduled job.
- `assets`/`asset_assignments`.
- **Tests**: appraisal RLS excludes Finance; final settlement calculation per country; document
  expiry status transitions and reminder de-duplication (no repeat reminder for the same lead-day
  window).

## Phase 6 — Letters, payroll export, audit log surfacing, dashboards/reports
- `letter_templates`, `generated_letters` with approval gating.
- Payroll-variable export job + Finance/CEO authorization step.
- Audit log viewer (HR Admin/Sys Admin scoped), dashboards per role (§4), downloadable reports
  (CSV/PDF) for headcount, leave liability, claims, attrition.
- `ai_drafts` table + AI Suggestions queue UI, with at least one real AI-assisted flow wired end to
  end (e.g. balance-discrepancy detection) to prove the draft-only boundary in practice, not just
  in the schema.
- **Tests**: payroll export line aggregation matches ledger/claim source data exactly (reconciliation
  test); AI draft authorize/reject flow never bypasses the normal Server Action path (a test that
  asserts there is no insert policy on `leave_ledger` etc. for the AI service identity).

## Phase 7 — Hardening, security review, deployment
- Full pass on RLS test coverage across every table (not just the ones touched most recently).
- Load/perf check on nightly balance materialization and payroll export for realistic headcount.
- Secrets audit: confirm `SUPABASE_SERVICE_ROLE_KEY` never appears in any client bundle (automated
  CI check, not just code review).
- Backup/restore drill on Supabase project; disaster-recovery runbook.
- Accessibility pass (keyboard nav, screen reader labels) on core journeys, mobile responsiveness
  check on the same set.
- Staged rollout: UAE headquarters first — it carries the fullest role coverage and the most
  employees, so it's the strongest validation of the whole system — then KSA and Poland, whose
  smaller headcount today makes them lower-risk to bring on once the policy engine has proven
  itself against a second and third country's real rules.

Proceed to [07-risk-register.md](./07-risk-register.md).
