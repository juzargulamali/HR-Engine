# 02. Screens and navigation

Verified at `551f615` (2026-11-04). Route list from `apps/web/src/app/(app)/**/page.tsx`; menu rules from `apps/web/src/components/nav/nav-groups.ts`; guard column from layouts and from spec 4.3.1 (`docs/launch-refinement/specification.md`, branch `docs/launch-refinement-spec`, written at `76c121b`; guard wording not re-read in each page: `Unverified` where marked).

**Guard types:** Own = only the person's own rows (database RLS); Layout = module `layout.tsx` shows an access notice; Page = page checks a role; RLS = no page gate, database filters; Ctx = contextual (reached from a parent page, checked by relationship in SQL).

## 1. Routes by module

### My Day, account, public

| Path | Shows | Reach / guard |
|---|---|---|
| `/` | My Day (section 4) | Everyone; widgets by access (Own + RLS) |
| `/approvals` | Decisions waiting on the person; empty page if none | No page gate; RLS `approvals_select` (spec 4.3.1) |
| `/account/security` | Own sign-in info, change password | Everyone (`auth.getUser()`) |
| `/login`, `/set-password`, `/forgot-password`, `/reset-password` | Sign-in flow | Public (`apps/web/src/proxy.ts` PUBLIC_PATHS) |
| `/api/cron/*`, `/api/ai/*` | Scheduled jobs | Bearer `CRON_SECRET`; sign-in proxy redirects all but `/api/cron/crm-reminders` (`proxy.ts`) |
| `/api/reports/headcount` | CSV of what RLS lets the caller list | Session; RLS (spec 4.3.1) |
| `/os-preview/*` | Design previews | 404 in Production (`os-preview/layout.tsx`) |

### Me (own pages)

| Path | Shows | Reach / guard |
|---|---|---|
| `/profile` | Redirects to own `/employees/[id]` (or "no employee record") | Own |
| `/attendance-clock` | Own clock-in/out incl. project-lead picker | Own (`clock_in`, lead-candidates function) |
| `/attendance` | Own attendance; **for HR Admin it is the company register** | Page branch + RLS `attendance_select` |
| `/leave`, `/leave/new` | Own balances and requests; new request | Own |
| `/reimbursements`, `/reimbursements/[id]` | Own claims; claim detail | Own; other id 404 |
| `/letters` | Own letters; **for HR Admin the letters desk** | Own / Page |
| `/performance`, `/performance/appraisals/[id]` | Own goals and appraisals | Own |
| `/performance/cycles` | Cycles, managed by HR Admin | Page `hr_admin` |
| `/timesheets`, `/timesheets/[id]` | Own timesheets; **no menu entry** | Own |
| `/inventory/mine` | Own assigned equipment | Own (`inv_my_equipment()`) |

### People & HR and company information

| Path | Shows | Reach / guard |
|---|---|---|
| `/employees`, `/employees/[id]` | Directory (a plain employee sees only self; managers their reports); profile tabs | RLS `employees_select`; other id 404 |
| `/employees/new` | Add employee | Page `hr_admin` |
| `/alerts` | HR alerts (contracts, probation, documents, identity) | Page `canViewHrAlerts` (HR, CEO, CTO) |
| `/payroll`, `/payroll/[id]` | Payroll runs | Page: HR Admin, Finance, CEO, CTO |
| `/assets` | Asset register | Page: HR Admin, Finance |
| `/ai-suggestions`, `/audit-log` | Reviewed drafts; audit trail | Page: HR Admin or System Administrator |
| `/admin/companies` | Companies | Layout: System Administrator |
| `/people-access` | Manage HR roles, module grants, accounts | Page + RLS: sys admin, HR Admin, module access managers |

**People & Access, Module access tab (in draft PR, branch `feat/module-access-simplify`, not merged; describes that branch until merge).** After choosing a person: an "Access for company" selector (separate from the people-list company filter; defaults to the person's employment company when the viewer manages it; switching saves nothing and warns before discarding edits), then one card per module (profile or "Custom access", extra rights, assigned warehouses, Edit access). A card says "No access" only after a successful read, "Could not load ... Try again" after a failed read, and "You can't manage this module" for a module the viewer does not manage. Editing: pick a working profile (draft only), optional collapsed "Advanced access", a review (rights added / removed / custom rights kept / warehouse scope / resulting access), one "Save changes" and Cancel; "Remove all access to this module" is separate. Account, Job & department and HR roles tabs are unchanged. Sources on the branch: `apps/web/src/components/people-access/module-access-{panel,card,editor}.tsx`, `packages/domain/src/accessProfiles.ts`.
| `/holidays`, `/policies`, `/policies/[id]` | Reference pages | Everyone read |
| `/policies/new` | Draft a policy | Page `canDraftPolicy` (country-scoped HR/CEO) |

### Sales and CRM (`sales/layout.tsx`: "You do not have Sales access...")

| Path | Shows | Menu |
|---|---|---|
| `/sales`, `/sales/follow-ups` | Follow-ups (entry point) | Menu |
| `/sales/opportunities`, `/sales/opportunities/[id]` | Enquiries; enquiry detail (tab `commercial` for approvals) | Menu / Ctx |
| `/sales/opportunities/[id]/close`, `.../handover` | Close as won/lost; handover to Projects | Ctx |
| `/sales/new` | Full new-enquiry form (`/sales/opportunities?add=1` also) | Secondary |
| `/sales/clients`, `/sales/proposals`, `/sales/pipeline` | Shared contacts, proposals search, pipeline board | Secondary |
| `/sales/reports` | Reports | Menu |
| `/sales/settings` | Sales settings | Menu (Manage), settings capability or founder |

### Projects and tasks (`projects/layout.tsx`: "You do not have Projects access...")

| Path | Shows | Menu |
|---|---|---|
| `/projects/work` | My Work (tasks, review queue `?show=review`) | Menu |
| `/projects`, `/projects/calendar` | Directory; cross-project calendar | Menu |
| `/projects/new` | New internal project | Secondary, needs `assign_pm` |
| `/projects/handovers` | Handovers waiting for a PM | Menu (Manage) |
| `/projects/scope-decisions/[scopeChangeId]` | Scope-change decision | Ctx (from My Day) |
| `/projects/[id]` plus `work`, `work/tasks/[taskId]`, `plan`, `timeline`, `calendar`, `discussion`, `documents`, `people`, `changes`, `history`, `complete`, `equipment`, `budget` | One project: summary and tabs. Equipment tab holds equipment requests and dispatch/return notes; Budget tab is the project budget (denied and error are separate states) | Ctx: SQL checks (`proj_can_view_details`, `proj_can_manage`, `pbx_budget_view`) |

### Inventory (`inventory/layout.tsx`: "not installed here" notice, `LoadError` on failure; access per page)

| Path | Shows | Menu / guard |
|---|---|---|
| `/inventory` | Today (warehouse work); redirects people with no grant to `/inventory/requests` (project managers) or `/inventory/mine` | Menu, grantees |
| `/inventory/stock` | Stock: search, scan (`?action=scan`), receive, give equipment, who holds what (`?view=people`) | Menu; page gate narrower than RLS for acting PMs (spec F-G-05, `Unverified` after launch) |
| `/inventory/history` | Movement ledger | Menu for people who may view stock or founders |
| `/inventory/requests`, `/inventory/requests/[id]` | Equipment requests | Menu (secondary for grantees); RLS `inv_can_see_request` |
| `/inventory/manage` | Setup: catalogue, locations, settings | Menu (Manage): `manage_catalogue` or founder |
| `/inventory/transfers/[id]` | One transfer (incl. cross-company) | Ctx |
| `/inventory/scan`, `/inventory/labels` | Scanner, label sheet | Palette/Ctx; RLS only |
| `/inventory/employees`, `/inventory/movements` | **Redirect** to `stock?view=people` and `history` (legacy) | Redirect pages |

### Finance

| Path | Shows | Guard |
|---|---|---|
| `/finance/project-budgets`, `.../[projectId]` | Budgets and final expenses waiting for Finance; budget detail | No layout; `pbx_inbox` / `pbx_budget_view` grants decide; AccessNotice if none (spec 4.3.1) |

## 2. Navigation as built

Source: `buildNavModules` in `nav-groups.ts`. Order is as listed. "Always" = no grant needed.

| Group (module) | Entries | Condition for the group / entry |
|---|---|---|
| My Day | `/` | Always |
| Approvals | `/approvals` | Role `line_manager`, `hr_admin`, `finance`, `ceo` or `cto` in any scope, **or** something is currently waiting on the person (`hasPendingApprovals`, e.g. a project lead's Recovery Leave step) |
| Sales & CRM | Follow-ups, Enquiries, Reports; Manage: Settings | Any Sales grant. Settings: `manage_settings` capability or Sales founder. Secondary (search only): New enquiry, Clients & contacts, Proposals & quotes, Pipeline board |
| Me | My Profile, My Attendance Clock, My Attendance, My Leave, My Reimbursements, My Letters, My Equipment, My Performance | Always. My Attendance and My Letters hidden for HR Admin (they move to People & HR). My Equipment only if the person has a linked employee record |
| People & HR | People: Employees, Attendance register. Workflow: Alerts, Letters, Payroll. Organisation: Assets, Companies. Insights: AI Suggestions, Audit Log. Access: People & Access | Group appears if any section has a row. Employees: role line_manager/hr_admin/finance/ceo/cto/sys_admin **or** any direct report. Attendance register and Letters: HR Admin. Alerts: `canViewHrAlerts`. Payroll: HR/Finance/CEO/CTO. Assets: HR or Finance. Companies: System Administrator. Insights: HR Admin or sys admin. People & Access: `canUsePeopleAccess` (sys admin, HR Admin, or a module access manager in Sales/Projects/Inventory/Budget) |
| Projects & Tasks | My Work, Projects, Calendar; Manage: Handovers; secondary: New internal project | Any Projects grant, or linked to a project as Sales (then only "Projects"). Lands on `/projects/work` unless founder, `assign_pm` or manages projects. Handovers: `assign_pm` or a handover is waiting. New internal project: `assign_pm` |
| Inventory | Today, Stock, History, Requests; Manage: Setup; secondary: My equipment, Scan a label, Equipment held by people | Any Inventory grant, or manages projects. Today: grantee. History: can view stock or founder. Requests is secondary for grantees. Setup: `manage_catalogue` or founder. Held by people: `view_employee_custody`, founder or warehouse. Lands on `/inventory` or `/inventory/requests` |
| Finance | Project budgets (shows a waiting count if more than 0 and readable) | Any Budget grant (`budget.any`). A PM without a grant reaches the budget from the project |
| Company information | Holidays, Policies | Always |

Notes
* Timesheets, Departments and a notification bell have no menu entry (`nav-groups.ts`, `shell-chrome.tsx`).
* `navGroupsFromModules` feeds the command palette (search); secondary links appear there only.
* The header shows a breadcrumb "Module / Page" (`breadcrumbFor`); the most specific link wins (`/attendance-clock` is not swallowed by `/attendance`).
* **Phone bottom bar** (`shell-chrome.tsx`): My Day; Sales (only with a Sales grant, to `/sales/follow-ups`); Clock (employees only; reads "Clocked in" when a shift is open); Me (`/profile`); More (opens the full menu drawer). Shown below the `lg` breakpoint.
* The menu is only an offer. Hiding a row grants and removes nothing; the page and database decide (`nav-groups.ts` header).

## 3. Direct-URL behaviour

| Situation | What the person gets | Source |
|---|---|---|
| No Sales / Projects grant, types `/sales/...` or `/projects/...` | Access notice naming the module and who grants it, with an "ask for access" control | `sales/layout.tsx`, `projects/layout.tsx` |
| Not a System Administrator, `/admin/companies` | Notice "You need the System Administrator role" | `admin/layout.tsx` |
| HR/finance pages (`/payroll`, `/alerts`, `/assets`, `/audit-log`, `/ai-suggestions`) | Notice naming the restricted audience (the role check and RLS both apply) | spec 4.3.1 |
| Someone else's employee, project, reimbursement, request | 404 or "does not exist, or you do not have access" | spec 4.3.1; `Unverified` for each page after launch |
| Inventory when its database changes are missing | "Inventory is not installed in this environment yet" | `inventory/layout.tsx` |
| Inventory load error | `LoadError` "could not load", not empty | `inventory/layout.tsx` |
| `/os-preview/*` in Production | 404 | `os-preview/layout.tsx` |
| Secondary or legacy URL (`/inventory/employees`) | Works as a bookmark or redirects | `inventory/employees/page.tsx` |
| `/approvals` with nothing waiting | An empty-state page (menu entry may be hidden) | spec 4.3.1 |

Whatever the page shows, the database is the enforcement (`docs/03-permission-matrix.md`, file 03 when written).

## 4. My Day structure (`app/(app)/page.tsx`, `docs/os-my-day.md`)

1. **Greeting and the attention headline** (`components/my-day/attention-line.tsx`): one sentence, the number links to the list. The number is the **length of the single list** built by `buildAttention` in `lib/my-day/attention.ts`; the list on the page is that same list, so they cannot disagree. Birthday banner above when applicable.
2. **Overview strip** (access-dependent): Active projects, Open enquiries, Live equipment requests.
3. **Needs me** (`components/my-day/decisions-card.tsx`): ordered overdue first, then due today, then the rest by how long they have waited; a record reached by two sources is listed once. Ten sources (`AttentionSource`):

| Source | What it adds | Link |
|---|---|---|
| `approvals` | Decisions waiting (leave, claims, Recovery Leave, queue-routed) | `/approvals` |
| `project-tasks` | Own tasks overdue or due today; tasks waiting for review | `/projects/work?task=...` |
| `project-decisions` | Handovers and scope decisions | `/projects/handovers`, `/projects/scope-decisions/...` |
| `sales` | Overdue/today follow-ups; enquiries awaiting first response | `/sales/follow-ups`, enquiry |
| `sales-handover` | Won enquiry needing handover | `/sales/opportunities/[id]/handover` |
| `sales-approvals` | Commercial approvals waiting | enquiry `?tab=commercial` |
| `budgets`, `budget-projects` | Budget decisions and returned budgets of own projects | from `lib/budget/my-day.ts` |
| `notes` | Dispatch and return notes waiting acknowledgement | project notes link |
| `hr` | Contracts, probation, documents, identity (counts) | `/alerts` |

4. **Waiting on others**: what the person submitted (budgets, leave, claims, Recovery Leave, tasks sent for review). Never counted in the headline and never a decision for them.
5. **My work today**: own tasks by title. Then Attendance clock card, People today, Next dispatch, Delivery this week, Sales pipeline, Project status (widgets appear by access).
6. **People & HR today** (HR view only): attendance, companies, upcoming holidays, on leave, birthdays, team distribution, HR attention.

Phone order: what needs you first, then your tasks (`docs/os-my-day.md`).

## 5. Failed-read convention

* A load error must say it could not load; it must never show empty, zero, "nothing waiting" or "no access" (`CLAUDE.md`).
* Mechanics on My Day: every source is read with `Promise.allSettled`; a failed source becomes `failed(source)` and an error entry naming it (`SOURCE_LABEL`) in both the headline and Needs me (`attention.ts`, `page.tsx` lines ~106, 333).
* Menu: Finance's waiting number is simply absent when unreadable ("never 0, never a guess", `nav-groups.ts`). Inventory shows `LoadError`.
* Known residual gaps: failed role or navigation-probe reads can still hide menu rows or read as "no role" (spec D-15, D-19, D-20; status after launch `Unverified`). Inventory staff-directory failed-read sweep is deferred (file 01, section 8).
