# 01. Overview and modules

Verified at `551f615` (2026-11-04). Evidence rules: `README.md`. Spec = `docs/launch-refinement/specification.md` on branch `docs/launch-refinement-spec` (written at `76c121b`, partly stale).

## 1. What ENGINIOUS OS is

One web application for a small group of companies (AE, SA, PL; three entities in three countries) that replaces spreadsheets for: HR (people, attendance, leave, payroll, letters), Sales/CRM (enquiries to won deals), Projects and tasks, Inventory (equipment and stock), and Project Budgets and Expenses. Staff only; vendor/client access is a later idea (`docs/14-enginious-os-architecture-and-roadmap.md` section 6).

* One shared sign-in, one menu. What a person sees depends on HR roles (company or country scoped) and on four separate module grants (Sales, Projects, Inventory, Budget). The grant tables are independent of each other and of HR roles (`apps/web/src/components/nav/nav-groups.ts` comments).
* The menu only shapes what is offered. Access is enforced in the database (row-level security and SECURITY DEFINER functions), with a page check as a second line (`nav-groups.ts` header comment; spec 4.3.3).

## 2. Stack in plain words

| Layer | What | Source |
|---|---|---|
| Web app | Next.js (App Router, TypeScript), server components and server actions, in `apps/web` | `docs/01-architecture.md` section 1.3 (the "14+" version number there is not re-checked) |
| Shared logic | `packages/domain`: permissions, leave/claims/budget rules, date logic, pure functions with tests | `packages/domain/src/index.ts` |
| Database | Supabase Postgres. Every business table has row-level security; in the four module areas (Sales, Projects, Inventory, Budget) tables have SELECT policies only and every write is a SECURITY DEFINER function; HR-core tables also take some direct table writes from the signed-in user under RLS, triggers and column privileges (see `03-roles-access-and-approvals.md` section 1) | `docs/01-architecture.md`; spec 4.3.3 |
| Hosting | Vercel (deploys `main`; previews also use the live V2 database); Vercel cron calls `/api/cron/*` | `vercel.json`; `docs/launch-refinement-install-order.md` |
| Auth | Supabase Auth in hosted environments; **locally an in-repo stand-in** | `docs/people-access-account-controls-verification.md` |

## 3. Repo map

| Path | Holds |
|---|---|
| `apps/web/src/app/(app)/` | Signed-in screens, one folder per route (see file 02) |
| `apps/web/src/app/api/` | `cron/*` (leave-accrual, comp-day-expiry, document-expiry, recovery-windows, crm-reminders), `ai/detect-balance-discrepancies`, `reports/headcount` |
| `apps/web/src/app/os-preview/` | Design previews; 404 in Production (`os-preview/layout.tsx`, `isOsPreviewEnabled`) |
| `apps/web/src/components/nav/` | Shell: `nav-groups.ts` (who sees which menu row), `shell-chrome.tsx` (header, drawer, phone bar), `command-palette.tsx` |
| `apps/web/src/lib/` | Server logic per module: `my-day`, `crm`, `projects`, `inventory`, `budget`, `recovery`, `people-access`, `approvals`, `leave`, `attendance`... |
| `packages/domain` | Pure rules shared by app and tests |
| `packages/rls-tests`, `e2e-tests`, `e2e-account-security` | Database policy tests and browser suites (detail in `05-data-tests-and-release-ledger.md`) |
| `supabase/migrations/` | Install order = file-name order. Latest launch ones 20261216... to 20261218000100 |
| `supabase/manual-sql/` | Owner packs run by hand on hosted: read-only preflight/verify, migrations, rollbacks, optional writes |
| `docs/` | Design and deployment docs per module; `apps/web/os-shell-checks/` runnable flow checks |

## 4. Environments

| Environment | What it is | Source |
|---|---|---|
| Local | Disposable stack with an auth stand-in, for development and browser suites | `apps/web/os-shell-checks/README.md`; `docs/people-access-account-controls-verification.md` |
| V2 (hosted) | Live Supabase + Vercel used by previews. Launch migrations 1 to 15 applied | Owner-reported |
| Production | Ready at `551f615` | Owner-reported |
| Dispatch/return notes | Per-company switch `inv_company_settings.project_notes_enabled`, default false; kept **OFF** on hosted | `supabase/migrations/20261217000100_inv_project_notes.sql`; owner-reported |
| Scheduled jobs | Listed in `vercel.json`; only `/api/cron/crm-reminders` passes the sign-in proxy (`apps/web/src/proxy.ts` PUBLIC_PATHS), and scheduler activation is deferred by owner decision (spec D-01); hosted Vercel cron and `pg_cron` status is `Unverified` (owner to check both histories) | `vercel.json`; `proxy.ts` |

## 5. Module inventory

Status: built = code present and wired at the stamp; partial = works with known gaps; deferred = not built.

| Module | Purpose | Main routes | Key tables / functions | Who uses it | Status | Source |
|---|---|---|---|---|---|---|
| My Day (home) | One page of what needs the person, their work, attendance clock; HR view below | `/` | `lib/my-day/attention.ts`; reads every source under the person's own session | Everyone; widgets by access | Built | `docs/os-my-day.md`; `app/(app)/page.tsx` |
| Approvals | One inbox of decisions waiting on the person. It shows two kinds of record: general approvals from the `approvals` table (leave, claims, timesheets, letters, payroll runs) and Recovery Leave credit requests, which are routed separately. Project budget decisions are **not** here (see the Budget row and the routing table below) | `/approvals` | `approvals`, `resolve_approver*`, `decide_leave_approval` (general); `recovery_credit_requests`, `recovery_route_request`, `decide_recovery_credit_request`, `recovery_decider_inbox()` (Recovery Leave) | Line managers, HR Admin, Finance, CEO/CTO, project leads when something is waiting | Built | `nav-groups.ts`; `03-roles-access-and-approvals.md` sections 4.1 to 4.4; `04-flows-sales-to-warehouse-and-others.md` approvals section |
| People & HR: employees, profile | Directory, own profile, add employee | `/employees`, `/employees/[id]`, `/employees/new`, `/profile` | `employees` (RLS: self, managers, HR/Finance/CEO/CTO, sys admin) | Everyone (own); managers; HR | Built | spec 4.3.1 |
| Attendance and clock | Own clock-in/out, own record; company register for HR | `/attendance-clock`, `/attendance` | `clock_in`, attendance lead-candidates function (migration 5) | Employees; HR (register) | Built | `nav-groups.ts`; install-order |
| Leave | Own balances and requests | `/leave`, `/leave/new` | `leave_requests`, `submit_leave_request`, accrual cron | Employees | Built | spec 4.3.1 |
| Recovery Leave | Credit for extra/weekend work, decided by project lead then manager chain | clock page, `/approvals`, `/leave` | `recovery_credit_requests`, `recovery_*` functions, `/api/cron/recovery-windows` | Employees, project leads, deciders | Built | `docs/recovery-windows-deployment.md`; migration `20261216000600` |
| Timesheets | Timesheet list/detail | `/timesheets`, `/timesheets/[id]` | `timesheets` | Own rows; **no menu entry** (orphan) | Partial | nav-groups.ts has no entry; spec 4.3.1 |
| Reimbursements | Own claims | `/reimbursements`, `/[id]` | `reimbursement*`, `lib/budget/claims.ts` | Employees | Built | spec 4.3.1 |
| Performance | Own goals, appraisals; cycles for HR | `/performance`, `/performance/cycles`, `/performance/appraisals/[id]` | `goals`, `appraisals`, `performance_cycles` | Employees; HR | Built | spec 4.3.1 |
| Payroll | Payroll runs and export | `/payroll`, `/payroll/[id]` | `payroll_runs` | HR Admin, Finance, CEO, CTO | Built | `nav-groups.ts` |
| Letters | Own letters; letters desk for HR | `/letters` | `generated_letters`, storage `letters` (issued only, migration 8) | Everyone; HR | Built | migration `20261216000800` |
| Holidays, Policies | Company reference pages | `/holidays`, `/policies`, `/policies/[id]`, `/policies/new` | `public_holidays`, `policy_versions` | All read; HR draft | Built | `nav-groups.ts` |
| Assets | HR/Finance asset register | `/assets` | `assets` | HR Admin, Finance | Built | `nav-groups.ts` |
| Alerts, AI suggestions, Audit log | HR alerts; reviewed drafts (no language model); audit trail | `/alerts`, `/ai-suggestions`, `/audit-log` | `ai_drafts`, `audit_log` | HR/C-level; HR/sys admin | Built | spec 2.10, 4.3.1 |
| Companies | Company admin | `/admin/companies` | `companies` | System Administrator | Built | `admin/layout.tsx` |
| Sales and CRM | Follow-ups, enquiries, clients, proposals, pipeline, reports, handover | `/sales/*` | `crm_company_grants`, `crm_*`, `crm_has_access()`, `crm_staff_directory()` | People with a Sales grant | Built | `docs/crm-deployment.md`; `sales/layout.tsx` |
| Projects and tasks | Projects, plan, tasks, calendar, handovers, scope decisions, equipment, budget tab | `/projects/*` | `proj_company_grants`, `proj_projects`, `proj_handovers`, `proj_can_manage`, `proj_create_internal_project` | Projects grantees, project leads, Sales-linked | Built | `docs/projects-design.md`; `projects/layout.tsx` |
| Inventory | Stock, receiving, requests, issue/return, transfers, labels, scan, history, setup, own equipment, cross-company sharing, dispatch/return notes | `/inventory/*` | `inv_company_grants`, `inv_units`, `inv_balances`, `inv_my_equipment()`, `inv_project_notes`, `inv_xshare_*` (11 functions) | Inventory grantees; project managers; every employee (own equipment) | Built; notes switch OFF | `docs/inventory-design.md`; `inventory-cross-company-receiving.md` |
| Budget and Expenses | Project budgets, funding, actual expenses, settlement; Finance inbox | `/projects/[id]/budget`, `/finance/project-budgets` | `pbx_company_grants`, `pbx_inbox`, `pbx_budget_view`, `pbx_decisions_waiting_count` | Finance, view grantees, project managers | Built | `docs/project-budget-expenses-design.md` |
| People & Access | One screen to manage HR roles, module grants, account status | `/people-access` | grant tables, `set_account_status`, `revoke_role_grant`, `module_access_managers` | Sys admin, HR Admin, module access managers | Built | `docs/people-access-design.md`; migration 13 |
| Account | Own sign-in info, password | `/account/security` | Supabase Auth | Everyone | Built | spec 4.3.1 |

## 6. How modules connect

| From to | How | Source |
|---|---|---|
| Sales to Projects | A won enquiry gets a handover (`/sales/opportunities/[id]/handover`); the Project Manager accepts or asks a question at `/projects/handovers`; acceptance creates the project | `attention.ts` (handoverCandidates, projectDecisionCandidates); `docs/projects-design.md` |
| Projects to Inventory | Project's Equipment tab raises equipment requests; warehouse reserves, dispatches and takes returns; completing a project does not return equipment | `app/(app)/projects/[id]/equipment/page.tsx` comment |
| Dispatch / return notes | Warehouse records a note on dispatch/return; the project side acknowledges; shown in My Day Needs me when waiting. Only when the company switch is on | `inv_project_notes`; `attention.ts` noteCandidates |
| Projects to Budget | Each project has a budget, funding, actual expenses and settlement; PM works at `/projects/[id]/budget`, Finance decides in `/finance/project-budgets` | `docs/project-budget-expenses-design.md`; `nav-groups.ts` |
| Approval routing: three separate paths | **(1) General approvals** (leave, claims, timesheets, letters, payroll runs): `create_initial_approval` writes an `approvals` row, the approver is resolved by `resolve_approver` (payroll: `resolve_approver_for_company`), decided with `decide_leave_approval`, shown at `/approvals`. **(2) Recovery Leave credit**: a `recovery_credit_requests` row routed by `recovery_route_request` (not `resolve_approver`): project lead, then HR Admin, HR direct, or a shared CEO/CTO queue; decided by `decide_recovery_credit_request`; surfaced in `/approvals` as a card read through `recovery_decider_inbox()`. **(3) Project budget decisions** (budgets, additional requests, final expenses, settlement): the `pbx_*` functions, read from `pbx_inbox()` and decided in the Finance inbox `/finance/project-budgets`; they do not use the `approvals` table or the `/approvals` page and reach My Day through `pbx_inbox` | `03-roles-access-and-approvals.md` sections 4.1 to 4.5; `04-flows-sales-to-warehouse-and-others.md` approvals section; migrations `20261216000300`, `20261210000200/300` |
| My Day to every module | "Needs me" merges ten sources into one list; "Waiting on others" lists what the person submitted | `attention.ts`; `app/(app)/page.tsx` |
| People & Access to all | Writes the grant tables every module's access reads | `docs/people-access-design.md` |
| Cross-company inventory sharing | An owner company shares a location with another; receiving, transfers and trace via `inv_xshare_*` | migration `20261218000100`; `docs/inventory-cross-company-receiving.md` |

```
Sales (enquiry, won) --handover--> Projects (PM accepts) --equipment requests--> Inventory (reserve, dispatch, return, notes)
                                        |                                                  ^ cross-company sharing (inv_xshare_*)
                                        +--budget, funding, expenses--> Finance (Budget inbox)
Leave / Claims / Timesheets / Letters / Payroll runs ---------------> Approvals page (approvals table; resolve_approver*)
Recovery Leave credit (recovery_route_request) -------------------> Approvals page (cards via recovery_decider_inbox)
Project budgets / expenses / settlement (pbx_*) ------------------> Finance inbox (pbx_inbox), not the Approvals page
All three ----------------------------------------------------------> My Day "Needs me"
People & Access (HR roles + 4 module grants) ---------------------------> read by every module and by RLS
```

## 7. Glossary

| Term | Meaning |
|---|---|
| AE / SA / PL | The three companies/countries (company-scoped roles and grants) |
| Grant | A row giving a person a capability in one company for one module (`*_company_grants`) |
| HR role | `user_roles` row: employee, line_manager, hr_admin, finance, ceo, cto, sys_admin (company or country scoped) |
| Needs me / Waiting on others | My Day lists: decisions on the person / what the person submitted |
| Handover | Sales-to-Projects package sent when an enquiry is won |
| PM | Project Manager, a person assigned to a project (not an HR role) |
| Recovery Leave | Leave earned by approved extra work, decided by project lead then manager |
| Secondary link | Real page left out of the sidebar, found by search (`nav-groups.ts`) |
| Failed read | A load error; must be shown as "could not load", never as empty or zero |
| Owner pack | SQL file in `supabase/manual-sql` the owner runs on hosted |

## 8. Built vs deferred

Items below are from the owner's release notes and the spec register; the code was not re-searched for each unless marked.

| Item | State | Evidence |
|---|---|---|
| Global notification bell | Deferred; the header has alerts and search only (no bell found in `shell-chrome.tsx`; `notifications` table has no screen, spec D-26) | grep of `shell-chrome.tsx` |
| Kit-contents checking | Deferred | owner notes; `Unverified` in code |
| Scheduled-job activation | Deferred (owner decision); `vercel.json` lists jobs, proxy blocks all but one | `proxy.ts`; install-order |
| Cross-project expense copying | Deferred | owner notes; `Unverified` |
| Next-expiry line | Deferred | owner notes; `Unverified` |
| Departments screen | Deferred (no `/departments` route) | route list in file 02 |
| Defects U-19, U-20, N-10; D-43 wording | Open/deferred per owner notes | `Unverified`; spec register D-19 is the nav failed-read item |
| Inventory staff-directory failed-read sweep | Deferred | owner notes; `Unverified` |
| Timesheets menu entry | Not in menu | `nav-groups.ts` |
| Hosted dispatch/return notes | Built, switch OFF | owner-reported |

**Stale in older docs:** spec 4.3.1 says `/inventory` redirects to `/inventory/mine`; now `/inventory` is "Today" for grantees and redirects only people without a grant (`inventory/page.tsx` line 41). `docs/01-architecture.md` describes Edge Functions and SSO as future; not re-checked.
