# People & HR Phase 1: employee directory, profile and onboarding (working scope)

Branch `feat/people-hr-phase1` from `main` (after Inventory Phase 2, PR #103). One draft PR. Reference docs written with it: `docs/enginious-os/modules/people-hr.md`, `people-hr-coverage-index.md`, `people-hr-workflows.md`, `people-hr-action-catalogue.md`.

## 1. What already exists (traced, reused)

| Need | Source of truth | Existing code reused |
|---|---|---|
| Employee identity, job, company, manager, department, status | `employees` (company, country, number, names, hire date, DOB, job title, department_id, manager_id, status, user_id); unique `(company_id, employee_number)` among live rows | `createEmployee`, `updateEmployee`, `updateJobDetails` (People & Access), domain `canCreateEmployee`/`canEditEmployeeCore` |
| Company defaults | `companies.country_code`, `companies.default_currency` (both NOT NULL) | the create form's company-first country/currency |
| Contract | `employment_contracts` (versions, `is_current`, `resolveContractAsOf`) | `addContractVersion`, `ContractHistory` |
| Pay | `compensation_details` (versions, `effective_from`, `is_current`; payroll reads the current one) | `addCompensationVersion`, `recordCareerEvent` (two duplicate entry points, replaced by one) |
| Job and pay history | `employee_career_events` | `CareerHistorySection` |
| Documents | `identity_documents` (number, optional scan, HR Admin and the person) and `employee_documents` (file, expiry tracked by the daily job); private storage buckets, signed links | `addIdentityDocument`, `addEmployeeDocument` (two duplicate forms, replaced by one) |
| Opening balances | `leave_ledger` rows with `reference_type = 'opening_balance'`; `comp_day_ledger` rows with `source = 'opening_balance'` (the leave-accrual baseline depends on that tag) | written once at create today |
| Accounts | `employees.user_id` association; invite is a System Administrator action in People & Access; HR Admin links an existing account | `linkEmployeeToUser`, People & Access `?person=u:<user>|e:<employee>&tab=` |
| Insurance, loans, goals | `employee_insurance_policies`, `employee_loans`, performance goals and appraisals | existing sections and authorised forms |
| Permissions | `packages/domain/src/permissions/employees.ts` mirrors the RLS policies | all unchanged |
| Shared UI | `InfoHint` (the circled "i"), `Table stack`, `ListToolbar`, `RememberList`/`BackLink`, `Modal`, `Alert`, `LoadError` | used, not rebuilt |

## 2. Decisions

* **No new permission, no new table.** Reads stay RLS-scoped (a viewer only gets what the existing policies return); a count of `null` means "cannot see" and the step or flag is hidden, never "to do".
* **Create is retry-safe without a migration:** the form carries a client-generated id that becomes `employees.id`; a repeat click or retry hits the primary key, the action then resumes the existing record (opens its profile) and writes nothing else.
* **Contract, pay and opening balances become optional at create.** They can still be entered in the same step; whatever is left is a visible setup step on the profile.
* **Setup status is derived**, never stored (`lib/hr/setup.ts`): contract, compensation, documents, opening balances (optional), account invitation. Terminated or removed records show Not applicable.
* **One job-and-pay change process** (`recordEmploymentChange`): effective date today or earlier applies now; later dates are **scheduled** and applied by a daily job on their date. Job title and pay save together or not at all (one database transaction). "Change salary" is a shortcut into the same form. Finance (pay only) uses the same form for pay changes dated today or earlier; scheduling is HR Admin's, as the career-event record is.
* **One Add document flow.** The type decides the table and the fields (`lib/hr/document-types.ts`): identity types keep the tighter access (number, optional scan), other types require a file and keep the daily expiry tracking. Renewal opens with employee, company and type filled in and keeps the earlier document in the history.
* **Opening balances** are recorded once: an application check plus partial unique indexes make a repeat or a concurrent second click impossible.
* **Migration** `20270115000100_people_hr_phase1.sql` (additive): `employee_career_events.applied_at` (default `now()` so rows written by the previous build count as applied), the apply and record functions, the two partial unique indexes, with preflight, verify and rollback packs and RLS tests.

## 3. Out of scope (later phases)

HR work queue redesign (Phase 2); Letters, Payroll, Assets and Admin redesigns (Phase 3). Profile tabs not touched here: Leave (ledger), Attendance, Assets, final settlement.

## 4. Verified where

* **Local, isolated stack only; nothing hosted.** At the first head (`e42a067`): full RLS suite 95 files, 2198 tests passed; web suite 382 files, 4251 tests passed. After the date, allowance, stale-pay and cancel correction: `people-hr-phase1.rls.test.ts` 20 tests passed, the focused web files passed, `tsc`, `eslint` and the JARVIS knowledge check clean; the full suites are left to required CI.
* **One signed-in walkthrough at 390 px** (`apps/web/os-shell-checks/people-hr-phase1-flow.mjs`, 20 of 20 steps at the earlier head `e42a067`; not re-run after the correction): UAE, Saudi Arabia and Poland company defaults, a company with a missing default currency, add an employee, leave midway, resume the same record, finish contract, pay, documents, opening balances and the account link without retyping; an HR Admin of one company, Finance, a line manager and the employee each see only what they may; the Sales, Projects, Operations, Inventory, Finance and HR grants are unchanged afterwards. Screenshots: `docs/people-hr-screenshots/`.
* **Not verified:** the hosted migration, Preview or Production, a real phone, invitation delivery, Vercel's scheduler calling `/api/cron/employment-changes` with the cron secret, and the hosted storage paths for new document submissions.
