# 3. Permission Matrix

Legend: **F** full (create/read/update per business rules) · **R** read-only · **O** own records
only · **A** approve/authorize action · **–** no access. A blank distinction between "own" and
"team" matters most for Line Manager; "team" means the manager's reporting chain (recursive), not
the whole company.

A user can hold multiple roles simultaneously (e.g. a Line Manager who is also an Employee for
their own requests) — permissions are the union of all roles held, evaluated per row by the RLS
helper functions in §2.6 of the schema doc.

## 3.1 Employee master data

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | Sys Admin |
|---|---|---|---|---|---|---|
| Own profile (name, contact, job info) | O (view; edit contact only) | – | F | – | – | – |
| Team profiles (reports) | – | R (team) | F | – | – | – |
| All employee profiles (company) | – | – | F | R | R | R (metadata only, see note) |
| Employment contracts | O (view own) | R (team, current only) | F | R | R | – |
| Compensation & bank details | O (view own, read-only) | – | F | F | R (aggregate reports only) | – |
| Identity documents (passport/ID) | O (view own) | – | F | – | – | – |
| Appraisal content & goals | O (own) | F (team, as appraiser) | F | – | R (aggregate) | – |

*Note on Sys Admin*: Sys Admin manages accounts, roles, companies, and system configuration. They
do **not** get standing read access to HR content (salary, bank, ID, appraisal text) — their access
to `audit_log` shows *that* a record changed and *who* changed it, not necessarily the field values,
per the redaction note in the schema. Any exception (e.g. investigating a data issue) goes through a
time-boxed, logged elevation procedure, not a standing role grant.

## 3.2 Leave & compensatory days

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | Sys Admin |
|---|---|---|---|---|---|---|
| Submit leave request | O | O (own) | O (own) | O (own) | O (own) | – |
| View leave requests | O | R/A (team) | F | R | R | – |
| Approve/reject leave request | – | A (team, step 1) | A (escalation step / any) | – | A (executive-level exceptions) | – |
| View leave ledger / balance | O | R (team) | F | R | R | – |
| Post manual ledger adjustment | – | – | F (with reason, logged) | – | – | – |
| View comp-day ledger | O | R (team) | F | – | – | – |
| Configure deduction priority | – | – | F | – | – | – (config table, not data) |
| Configure leave policy (per country) | – | – | F (draft), A (activate needs 2nd HR Admin or CEO sign-off) | – | A (activation) | – |

## 3.3 Reimbursements & timesheets

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | Sys Admin |
|---|---|---|---|---|---|---|
| Submit reimbursement claim | O | O (own) | O (own) | O (own) | O (own) | – |
| Upload receipt | O (own claim) | – | R | R | – | – |
| Approve claim (≤ threshold) | – | A (team) | – | – | – | – |
| Approve claim (> threshold) | – | – | – | A | A | – |
| Pay / mark claim paid | – | – | – | F | – | – |
| Submit timesheet | O | O (own) | – | – | – | – |
| Approve timesheet | – | A (team) | R | R | – | – |
| Manage projects & allocations | – | R (team) | F | R | R | – |

## 3.4 Performance

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | Sys Admin |
|---|---|---|---|---|---|---|
| Set/view own goals | O | R (team) | R | – | – | – |
| Write appraisal (as appraiser) | – | F (team) | F (any, calibration) | – | – | – |
| Acknowledge own appraisal | O | – | – | – | – | – |
| View company-wide performance dashboard | – | R (team) | F | – | R | – |

## 3.5 Onboarding / offboarding / documents / assets

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | Sys Admin |
|---|---|---|---|---|---|---|
| Onboarding/offboarding checklist | O (assigned tasks) | O (assigned tasks) | F | O (assigned finance tasks, e.g. final settlement) | – | – |
| Employee documents (visa, labor card, certs) | O (upload own, view own) | – | F | – | – | – |
| Document expiry reminders config | – | – | F | – | – | R |
| Assets issued | O (view own) | R (team) | F | R | – | – |
| HR letter templates | – | – | F | – | A (some templates, e.g. salary certs for loans, per policy) | – |
| Generate/issue letter | O (request) | – | F | – | A (as configured) | – |

## 3.6 Payroll, audit, system

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | Sys Admin |
|---|---|---|---|---|---|---|
| Run payroll-variable export | – | – | R | F | R | – |
| Authorize payroll export for sending | – | – | – | A | A (final sign-off, configurable) | – |
| View audit log | – | – | R (HR-scoped entries) | – | – | R (system-scoped entries) |
| Manage roles / user access | – | – | R (request only) | – | – | F |
| Manage companies / countries / policy activation | – | – | F (draft + propose) | – | A | F (structural: create company/country records) |
| Dashboards & standard reports | O (own) | R (team) | F | F (financial) | F (executive) | R (system health only) |
| AI draft review queue | – | – | F (authorize/reject) | F (for payroll-adjacent drafts) | – | R |

## 3.7 Design notes

- **No role can self-approve.** RLS on `approvals` requires `approver_id = auth.uid()`; the app
  layer never assigns the requester as their own approver, and the workflow-step resolver
  (`packages/domain/approvals.ts`) explicitly skips a step if the computed approver equals the
  requester, escalating to the next level instead of silently passing.
- **Finance never touches identity documents or appraisal content** — their remit is compensation,
  claims, and payroll, which is why those tables are split out (§2.3 of the schema doc).
- **CEO is mostly read + high-value approval**, not an operational role — this keeps the CEO's
  access footprint small (least privilege) while still allowing executive sign-off where the
  business wants it (e.g. large reimbursements, policy activation, payroll authorization).
- **Sys Admin is infrastructure, not HR.** This is the role most likely to be over-granted by
  habit; the matrix deliberately keeps it near-zero on HR content to satisfy "separate access
  controls for salary, bank, ID and appraisal data."

Proceed to [04-user-journeys.md](./04-user-journeys.md).
