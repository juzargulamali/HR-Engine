# Project Budget & Expenses: integration design and handover note

Status table (kept current; the last section says where work stopped):

| Stage | Scope | Status |
| --- | --- | --- |
| A | Review existing structures, this design | Implemented |
| B | Domain library (decimal maths, rounding, settlement helpers, next action) | Implemented |
| C | Migrations, RLS, grants, functions, `schema.sql` mirror, owner-run SQL | Implemented and tested (36 database scenarios; owner scripts rehearsed on throwaway databases) |
| D | Server actions, loaders, types | Implemented |
| E | Project "Budget" tab and the Finance inbox | Implemented (23-step real-browser flow passes; contrast and clipping audits clean) |
| F | Tests (unit, database, browser) and owner-run SQL guides | Implemented |
| G | Final verification, documentation, draft PR | Verification results are in the PR; awaiting owner review |

Statuses: Not started, In progress, Implemented, Verified.

## 1. What was reviewed and what it means

| Existing structure | Finding | Decision |
| --- | --- | --- |
| **Projects** (`proj_*`): `proj_projects.pm_user_id`, acting PM, members, company, `proj_is_pm()`, `proj_can_view_details()`, site details and timezone | Writes are `SECURITY DEFINER` functions with row locks and a `version` column for stale edits; reads are RLS-only; each module has its own grant table and audit log. There is **no "cancelled" project status**: the ones that end a project are `completed` and `archived`. | Reuse `proj_is_pm()` (PM or unexpired acting PM) for "who manages the budget" and the project's own fields for the form header. Follow the same function/RLS/audit style. A finished or archived project keeps its budget and can still be settled: nothing in this module reads the project status to block settlement. Project completion is never changed. |
| **Finance role** (`user_roles.role = 'finance'`, company or country scoped) | It is an *HR* role (payroll, compensation, leave visibility, claims). Granting it to somebody so they can approve project budgets would also give them HR data. A title also is not an explicit, company-scoped, revocable grant. | **A new explicit grant table, `pbx_company_grants`**, exactly like `proj_/crm_/inv_company_grants`. The owner-run setup SQL may *propose* grantees from the existing company-scoped Finance role, but nothing is inferred automatically and nothing is granted by the migrations. |
| **Approval infrastructure** (`approvals`, `approval_workflows`, `resolve_approver*`) | Tied to the `approvable_entity` enum and to HR employees and managers. Reusing it would change HR approval routing and could expose these records to HR approvers. `crm_approvals` already sets the precedent of a module-owned decision record. | **Module-owned decision records** (state, decided_by, decided_at, note) on the version rows, decided by a function that locks the row. The existing approval tables and paths are not touched. |
| **Employee claims** (`reimbursement_claims`, lines) | `numeric(12,2)` + free currency text; lines point at the HR `projects` cost-centre table, not `proj_projects`; readable by the claimant, manager, HR and Finance only. | Not changed. An actual-expense line can be *marked* "recorded in an employee claim" with the claim's id; it still counts as project expense but is **never** counted as advance-funded or reimbursable here. The link is accepted only if the claim belongs to the person linking it or the person is a Finance grantee. Matching amounts are never used to guess duplicates. |
| **Audit** (`audit_log` HR, `proj_audit_log` Projects, `crm_audit_log`, `inv_audit_log`) | Each module keeps its own log readable only with its own capability. | `pbx_audit_log`, written by a trigger on every `pbx_` table (old and new row images), readable by Finance and view grantees of the company. |
| **Notifications** (`notifications`, insert-only, free `type`, rendered by `describeNotification`) | Projects already adds `project_*` types. No e-mail. | New `project_budget_*` types, inserted only for the people concerned; rendered in My Work like other project notices. No e-mail, no scheduled job. |
| **Currency** | Money columns carry an ISO 3-letter code (`^[A-Z]{3}$`), amounts `numeric(12,2)` or `(14,2)`; nothing is ever added across currencies. | One currency per budget (fixed at creation). Amounts `numeric(16,3)`, rounded half-up to the currency's own decimals (0, 2 or 3) by one SQL function mirrored in TypeScript. |
| **Existing financial data protection** | Sales value/PO and Projects commercial data live in separate tables, readable only through explicit capabilities. | Budgets live in their own tables with their own RLS: **no** Projects membership, directory access, Sales grant, HR role or founder title reveals them. |

### Genuine incompatibilities (documented, not worked around)

1. The HR approval engine cannot carry project budgets without changing HR routing, so a separate decision model is used.
2. The Finance HR role is too broad and not module-explicit, so a separate explicit grant is required (one owner-run setup step).
3. Employee claims cannot be linked to project budgets by the HR cost-centre `project_id`, which refers to a different table; the link is by claim id and is optional.
4. There is no "cancelled" project status; `archived` and `completed` are treated alike.

## 2. Access model (database-enforced)

`pbx_company_grants (user_id, company_id, capabilities)`, one active row per person and company. Capabilities:

| Capability | Meaning |
| --- | --- |
| `finance` | Approve, return or reject budgets and actuals; record funding, receipts, returns, reimbursements; close or reopen settlement; manage rates and categories; read everything of that company. |
| `view` | Read-only access to the company's budgets (explicit, for example for a founder; a title confers nothing). |
| `manage_access` | Grant and revoke these capabilities for the company. |

* **PM (current PM or unexpired acting PM, via `proj_is_pm`)**: creates and edits drafts, submits, requests additions, enters actuals, submits them. Reads the project's budget, funding and settlement summary.
* **Prior submitter** (a former PM): read-only on the versions and submissions they created or submitted; nothing else.
* **Everyone else** (members, directory-only, Sales, founders without a grant, HR roles, sys admin): nothing, by RLS, by function checks and by the page.
* **Independence**: a Finance decision is refused when the decider created or submitted that version, whatever else they hold. If no other Finance grantee exists, the submission shows "No independent Finance approver is available" and stays in the inbox on hold; nothing is auto-approved.
* **Concurrency**: a decision takes a row lock and requires `status = 'submitted'`; the second approver gets "already decided by ...", never a duplicate decision.

## 3. Data model (all `pbx_`, read-only to clients, written by functions)

* `pbx_budgets`: one per project (`project_id` unique), `company_id`, `currency`, display snapshot (reference, name, PM, location), receipts status/exception, settlement status, `row_version`.
* `pbx_budget_versions`: `kind` original | addition, `status` draft | submitted | returned | rejected | approved | discarded, period, relevant people, note, server-calculated `total`, submit and decision attribution, `row_version`. At most one open (draft or submitted) version per budget.
* `pbx_budget_rows`: category, dates, activity, description, basis, people, days, quantity, rate, fixed amount, server-calculated `total` (a trigger; the client value is never trusted).
* `pbx_categories`: the six defaults plus company categories added by Finance.
* `pbx_rates`: per company and currency (`petrol_per_km`, `meal_per_person`), entered by Finance. AED 0.50/km and AED 30/meal are only *suggestions* shown until Finance confirms; no other currency gets a suggestion.
* `pbx_funding`: instalments (recipient, date, amount, method, `is_advance`, reference, note), reversible with a reason. Pluto/card allocations are not advances.
* `pbx_actual_submissions` + `pbx_actual_rows`: the PM's actuals. Blank (`null`) is not zero; paid-via (advance, company card, direct company payment, personal, existing claim) and who paid; submission requires confirmation that entry is complete.
* `pbx_payments`: money returned and reimbursements paid, per person, reversible with a reason.
* `pbx_company_grants` (explicit access), `pbx_company_settings` (the on/off switch; no row means on) and `pbx_audit_log`.

Per-person settlement (SQL function `pbx_settlement_summary`, the single source of the figures):

```
advance balance(p)   = advances provided to p - advance-funded actuals paid by p - returned by p
reimbursement owed(p) = personal actuals by p + max(0, advance-funded actuals by p - advances provided to p)
reimbursement outstanding(p) = owed(p) - reimbursements paid to p
company-card and direct-paid spending are totals only; card allocations are never an amount owed back
existing-claim lines count as expense but are excluded from every balance above
```

Settlement can close only when: an approved actuals version exists, receipts are `received` or an exception with a reason is recorded, every advance balance is zero, no reimbursement is outstanding, and no budget or actuals version is awaiting a decision.

## 4. Screens

* **Project → Budget & Expenses** (`/projects/[id]/budget`, shown only to people with access): one summary strip, the next required action, and four sections: Budget, Funds, Actual expenses, Settlement.
* **Finance inbox** (`/finance/project-budgets`): Budget approvals, Final expense approvals, Outstanding settlement across the person's companies, with filters. A row opens the same record (`/finance/project-budgets/[projectId]`), which renders the very same workspace component and calls the same actions as the project page.
* Finance needs no Projects access (and gains none): the inbox reads names from the budget's own snapshot.

## 5. Explicit limits of this release

No receipt upload, OCR, bank or Pluto connection, purchasing, tax, Zoho sync, payment execution, payroll deduction, e-mail or scheduled job. One currency per budget; genuine foreign-currency costs are entered in the budget currency at the rate paid, with the original amount in the row note (a flag requires it). Project expense totals are labelled as such and are not project profitability.

## Handover: where work stopped

All stages are implemented. What remains is the owner's: review the draft PR, run the SQL in `supabase/manual-sql/pbx_*.sql` in the order of [project-budget-expenses-deployment.md](./project-budget-expenses-deployment.md), name the Finance people (`pbx_30_bootstrap_access.sql`), and try the acceptance checklist on one real project.

Where things are: domain rules `packages/domain/src/projectBudget.ts`; migrations `supabase/migrations/20261210000000..400_pbx_*.sql` (mirrored in `schema/schema.sql` section 21); server actions `apps/web/src/lib/actions/projectBudget.ts`; loaders `apps/web/src/lib/budget/`; screens `apps/web/src/components/budget/` and the routes `/projects/[id]/budget`, `/finance/project-budgets`, `/finance/project-budgets/[projectId]`; tests `packages/rls-tests/test/project_budget.rls.test.ts`, `packages/domain/test/projectBudget.test.ts`, `apps/web/os-shell-checks/budget-flow.mjs` (seed `seed/budget.sh`, optional `STAGE=draft|submitted|approved`).

Decisions worth remembering: the module has its own grants and its own decision records (not the HR approvals engine, not the HR finance role); Finance reads names from the budget's snapshot so it needs no Projects access; the claim link has no foreign key so existing claims behave exactly as before; there is no "cancelled" project status, so completed / archived projects keep their records and still settle.

Not done on purpose: receipt upload, OCR, bank / Pluto connections, supplier purchasing, tax, Zoho sync, payment execution, payroll deduction, e-mail, scheduled jobs; Vendors & Purchasing is not started. Not verified live: anything on the hosted Supabase project or Vercel, and the Production deployment commit and signed-in Production smoke check after PR #48 (merged as `20d0abf`, CI on that merge passed) remain unconfirmed.
