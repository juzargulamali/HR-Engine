# 3. Permission Matrix

Legend: **F** full (create/read/update per business rules) · **R** read-only · **O** own records
only · **A** approve/authorize action · **–** no access. A blank distinction between "own" and
"team" matters most for Line Manager; "team" means the manager's reporting chain (recursive), not
the whole company.

A user can hold multiple roles simultaneously (e.g. a Line Manager who is also an Employee for
their own requests) — permissions are the union of all roles held, evaluated per row by the RLS
helper functions in §2.6 of the schema doc.

*CTO*: every `has_role('ceo', ...)` check in the schema is paired with an identical
`has_role('cto', ...)` check — CTO is a deliberate, complete mirror of CEO throughout this system
(read access, resolving as `role:ceo` in approval workflows, letters/payroll storage access), not a
partial or accidental grant. The tables below list CTO alongside CEO with the same values for this
reason; see §3.7.

## 3.1 Employee master data

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | CTO | Sys Admin |
|---|---|---|---|---|---|---|---|
| Own profile (name, contact, job info) | O (view; edit contact only) | – | F | – | – | – | – |
| Team profiles (reports) | – | R (team) | F | – | – | – | – |
| All employee profiles (company) | – | – | F | R | R | R | R (metadata only, see note) |
| Employment contracts | O (view own) | R (team, current only) | F | R | R | R | – |
| Compensation & bank details | O (view own, read-only) | – | F | F | R (aggregate reports only) | R (aggregate reports only) | – |
| Identity documents (passport/ID) | O (view own) | – | F | – | – | – | – |
| Appraisal content & goals | O (own) | F (team, as appraiser) | F | – | R (aggregate) | R (aggregate) | – |

*Note on Sys Admin*: Sys Admin manages accounts, roles, companies, and system configuration. They
do **not** get standing read access to HR content (salary, bank, ID, appraisal text) — their access
to `audit_log` shows *that* a record changed and *who* changed it, not necessarily the field values,
per the redaction note in the schema. Any exception (e.g. investigating a data issue) goes through a
time-boxed, logged elevation procedure, not a standing role grant.

## 3.2 Leave & compensatory days

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | CTO | Sys Admin |
|---|---|---|---|---|---|---|---|
| Submit leave request | O | O (own) | O (own) | O (own) | O (own) | O (own) | – |
| View leave requests | O | R/A (team) | F | R | R | R | – |
| Approve/reject leave request | – | A (team, step 1) | A (escalation step / any) | – | A (executive-level exceptions) | A (executive-level exceptions) | – |
| View leave ledger / balance | O | R (team) | F | R | R | R | – |
| Post manual ledger adjustment | – | – | F (with reason, logged) | – | – | – | – |
| View comp-day ledger | O | R (team) | F | – | – | – | – |
| Configure deduction priority | – | – | F | – | – | – | – (config table, not data) |
| Configure leave policy (per country) | – | – | F (draft), A (activate needs 2nd HR Admin, CEO, or CTO sign-off) | – | A (activation) | A (activation) | – |

## 3.3 Reimbursements & timesheets

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | CTO | Sys Admin |
|---|---|---|---|---|---|---|---|
| Submit reimbursement claim | O | O (own) | O (own) | O (own) | O (own) | O (own) | – |
| Upload receipt | O (own claim) | – | R | R | – | – | – |
| Approve claim (≤ threshold) | – | A (team) | – | – | – | – | – |
| Approve claim (> threshold) | – | – | – | A | A | A | – |
| Pay / mark claim paid | – | – | – | F | – | – | – |
| Submit timesheet | O | O (own) | – | – | – | – | – |
| Approve timesheet | – | A (team) | R | R | – | – | – |
| Manage projects & allocations | – | R (team) | F | R | R | R | – |

## 3.4 Performance

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | CTO | Sys Admin |
|---|---|---|---|---|---|---|---|
| Set/view own goals | O | R (team) | R | – | – | – | – |
| Write appraisal (as appraiser) | – | F (team) | F (any, calibration) | – | – | – | – |
| Acknowledge own appraisal | O | – | – | – | – | – | – |
| View company-wide performance dashboard | – | R (team) | F | – | R | R | – |

## 3.5 Onboarding / offboarding / documents / assets

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | CTO | Sys Admin |
|---|---|---|---|---|---|---|---|
| Onboarding/offboarding checklist | O (assigned tasks) | O (assigned tasks) | F | O (assigned finance tasks, e.g. final settlement) | – | – | – |
| Employee documents (visa, labor card, certs) | O (upload own, view own) | – | F | – | – | – | – |
| Document expiry reminders config | – | – | F | – | – | – | R |
| Assets issued | O (view own) | R (team) | F | R | – | – | – |
| HR letter templates | – | – | F | – | A (some templates, e.g. salary certs for loans, per policy) | A (same templates as CEO) | – |
| Generate/issue letter | O (request) | – | F | – | A (as configured) | A (as configured) | – |

## 3.6 Payroll, audit, system

| Resource | Employee | Line Manager | HR Admin | Finance | CEO | CTO | Sys Admin |
|---|---|---|---|---|---|---|---|
| Run payroll-variable export | – | – | R | F | R | R | – |
| Authorize payroll export for sending | – | – | – | A (step 1, reviews figures) | A (step 2, **mandatory on every export**) | A (step 2, **mandatory on every export** — fulfills this step in place of CEO, not in addition to) | – |
| View audit log | – | – | R (HR-scoped entries) | – | – | – | R (system-scoped entries) |
| Manage roles / user access | – | – | R (request only) | – | – | – | F |
| Manage companies / countries / policy activation | – | – | F (draft + propose) | – | A | A | F (structural: create company/country records) |
| Dashboards & standard reports | O (own) | R (team) | F | F (financial) | F (executive) | F (executive) | R (system health only) |
| AI draft review queue | – | – | F (authorize/reject) | F (for payroll-adjacent drafts) | – | – | R |

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
- **CTO is a deliberate, complete mirror of CEO**, not a partial or accidental grant — every
  `has_role('ceo', ...)` RLS policy also checks `has_role('cto', ...)`, and every workflow step
  configured as `role:ceo` resolves to *either* a CEO or a CTO holder (`resolve_approver()` /
  `resolve_approver_for_company()` in the schema; `isCLevel()` in `packages/domain`). Concretely,
  this means the payroll export's **mandatory** final sign-off (§3.6) can be satisfied by a CTO
  alone, with no CEO ever involved in that specific export — this is intentional (either C-level
  executive may act), not a gap, but it is worth stating plainly since "mandatory CEO sign-off" can
  otherwise read as requiring that specific person. Any new `has_role('ceo', ...)` check added in
  future work should pair it with `has_role('cto', ...)` (schema) / use `isCLevel()` (app layer)
  unless there's a specific reason for CEO alone to act — otherwise the two drift apart silently.
- **Sys Admin is infrastructure, not HR.** This is the role most likely to be over-granted by
  habit; the matrix deliberately keeps it near-zero on HR content to satisfy "separate access
  controls for salary, bank, ID and appraisal data."

## 3.8 Sales & CRM (Stage B) — separate, company-scoped access

Sales & CRM does **not** use `user_roles`. Access is the table `crm_company_grants` (user, company, capabilities), granted per
company by a founder. HR Admin, Finance, CEO/CTO and Sys Admin hold **no** Sales rights by virtue of those roles, and a Sales
grant gives **no** HR access; neither side's policies consult the other. Enforced by RLS plus `SECURITY DEFINER` functions (the
CRM tables have SELECT policies only); mirrored for the UI in `packages/domain/src/permissions/crm.ts`. Verified by
`packages/rls-tests/test/crm.rls.test.ts`.

| Capability / action | Plain Sales user (granted company) | Opportunity owner | Delegated capability | Founder (per company) | HR Admin / Finance / CEO / Sys Admin (no grant) |
|---|---|---|---|---|---|
| See the company's opportunities, clients, follow-ups, values and budgets | R | R | R | R | – |
| Create an enquiry (becomes the owner) | F | F | F | F | – |
| Add notes, links and files; add follow-ups for themselves | F | F | F | F | – |
| Edit details, move stage, hold/resume, mark Won/Lost, proposals, Zoho references | – | F (own) | – | F (any) | – |
| Change the value of a **Won** opportunity | – | – | – | F | – |
| Assign / reassign owner | – | – | `assign_owner` | F | – |
| Record equipment availability | – | – | `confirm_availability` | F | – |
| Set the commercial approval policy / decide an approval | – | – | `manage_approval_rules` (policy only) | F | – |
| Edit Sales settings (reference code, currency, targets, calendar, emails) | – | – | `manage_settings` | F | – |
| Grant / revoke Sales access (cannot grant founder or `manage_access`) | – | – | `manage_access` | F (incl. founder rights) | – |
| Read the Sales audit trail (`crm_audit_log`, not the HR audit log) | – | – | `view_audit` | F | – |
| Reopen a Won or Lost opportunity (reason + new next action; closure kept) | – | – | `reopen_closed` | F | – |
| Link / unlink a shared contact on an opportunity; change its role | – | F (own, not lost) | – | F (any, not lost) | – |
| Edit a shared contact's details | creator only | F (if on one of their live opportunities) | – | F | – |
| Complete / reschedule / cancel a follow-up | assignee only | F | – | F | – |

The last founder of a company cannot be revoked. The shared `audit_log` (readable by HR) never receives CRM rows.

## 3.9 Projects & Tasks (Release 2) — separate, company-scoped access, three data tiers

Projects & Tasks does **not** use `user_roles` or `crm_company_grants`. Access is the table `proj_company_grants` (user, company,
capabilities), granted per company by a founder. An empty capability list means *Projects access*: the directory only. HR Admin,
Finance, CEO/CTO and Sys Admin roles, a Sales grant, an employee record or an e-mail domain confer **no** Projects access, and a
Projects grant gives **no** HR or Sales access. Project roles (PM, temporary leader, department head, member) are Projects
concepts: **none of them creates attendance, awards Recovery Leave, changes `employees.manager_id`, or gives access to confidential
HR data** (a test scans every `proj_` function for HR tables and `manager_id`). Enforced by RLS plus `SECURITY DEFINER` functions (every
`proj_` table has SELECT policies only); mirrored for the UI in `packages/domain/src/permissions/proj.ts`. Verified by
`packages/rls-tests/test/projects.rls.test.ts`. Design: [projects-design.md](./projects-design.md).

**Three tiers, in different tables, because row-level security cannot hide columns:**

| Tier | Tables | Who reads it |
|---|---|---|
| Summary-safe | `proj_projects` (reference, name, company, kind, status, PM, start/end) | Founders; active members; any Projects-access holder for *ongoing* projects of their company; a Sales user only for projects linked to them |
| Member-only | details (client name, location, scope, time zone, install/event dates), members, teams, milestones, deliverables, tasks, plans, bookings, discussion, feedback, scope changes, issued plans, files, completions, change log, handover (after acceptance) | Founders of the company and **active** members only |
| Commercially restricted | `proj_scope_change_commercial` (cost effect of a scope change) | People with `view_commercial` (founders hold it) — nobody else, including the PM |

No Sales value, budget, payment terms, purchase order or evidence reference is copied into any Projects table; commercial reading stays in Sales & CRM.

| Capability / action | Directory user (Projects access) | Member | Department head | PM / temporary leader | Delegated capability | Founder (per company) | HR / Sales roles with no grant |
|---|---|---|---|---|---|---|---|
| See the summary of ongoing projects of the company | R | R | R | R | R | R (all, incl. finished) | – |
| See details, tasks, plans, discussion, files | – | R | R | R | – | R | – |
| Update own assigned task; comment; post in discussion | – | F | F | F | – | F | – |
| Create a task for themself (own team or none) | – | F | F | F | – | F | – |
| Distribute tasks / reassign inside the team; review the team's tasks; accept the team's deliverables | – | – | F (own team) | F | – | F | – |
| Define milestones/deliverables, change scope fields (internal), edit dates, add/remove members and teams, book people on site, issue client timelines, record feedback, propose scope changes | – | – | – | F | – | F | – |
| Accept a milestone; complete a project (with client evidence); archive | – | – | – | F | – | F | – |
| Appoint temporary project leadership | – | – | – | F (the PM only) | – | F | – |
| Assign / reassign the PM; create an internal project; link/unlink Sales people | – | – | – | – | `assign_pm` | F | – |
| Grant / revoke Projects access (founder and `manage_access` rights themselves need a founder) | – | – | – | – | `manage_access` | F | – |
| Decide a scope change | – | – | – | – | `approve_scope` | F | – |
| See cost effects of scope changes | – | – | – | – | `view_commercial` | F | – |
| Read the Projects audit trail (includes member-only fields) | – | – | – | – | `view_audit` | F | – |
| Reopen a completed project (reason required; completion record kept) | – | – | – | – | `reopen_project` | F | – |
| Confirm a site booking that overlaps another (reason recorded) | – | – | – | – | `override_site_conflict` | F | – |
| Sales user linked to the project (no membership) | summary + handover status only | | | | | | |

A **reviewer is never the person whose work is reviewed.** Removing a member (or revoking their Projects access) ends their access at once everywhere (details, discussion, files, downloads, notifications, calendars): membership only counts while the person is still eligible. The last founder of a company cannot be revoked.

Proceed to [04-user-journeys.md](./04-user-journeys.md).
