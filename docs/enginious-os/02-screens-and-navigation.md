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
| `/admin/companies` | Companies (now with "Issuer details": legal name, TRN, address, contacts, logo of the issuer) | Layout: System Administrator |
| `/people-access` | Manage HR roles, module grants, accounts | Page + RLS: sys admin, HR Admin, module access managers |

**People & Access, Module access tab (PR #57, merged at `28549dd`; re-verified at `28549dd`, 2026-11-07).** After choosing a person: an "Access for company" selector (separate from the people-list company filter; defaults to the person's employment company when the viewer manages it; switching saves nothing and, with unsaved edits, asks "Discard unsaved changes?" before switching; choosing another person in the list is guarded the same way and shows the other person only after Discard; only one module editor is open at a time), then one card per module (profile or "Custom access", extra rights, assigned warehouses, Edit access). A card says "No access" only after a successful read, "Could not load ... Try again" after a failed read, and "You can't manage this module" for a module the viewer does not manage. Editing: pick a working profile (draft only), optional collapsed "Advanced access", a review (rights added / removed / custom rights kept / warehouse scope / resulting access), one "Save changes" and Cancel; "Remove all access to this module" is separate. Account, Job & department and HR roles tabs are unchanged. Sources: `apps/web/src/components/people-access/module-access-{panel,card,editor}.tsx`, `unsaved-access-guard.tsx`, `packages/domain/src/accessProfiles.ts` (`28549dd`).
| `/holidays`, `/policies`, `/policies/[id]` | Reference pages | Everyone read |
| `/policies/new` | Draft a policy | Page `canDraftPolicy` (country-scoped HR/CEO) |

### Sales and CRM (`sales/layout.tsx`: "You do not have Sales access...")

Every Sales route, tab, dialog, download and old route is listed with its detailed reference and action-catalogue entries in [`modules/sales-coverage-index.md`](./modules/sales-coverage-index.md) (reviewed at `d4a9dc3`); the action catalogue is [`modules/sales-action-catalogue.md`](./modules/sales-action-catalogue.md). Per-control references: [`modules/sales-enquiries.md`](./modules/sales-enquiries.md), [`sales-followups.md`](./modules/sales-followups.md), [`sales-pipeline-and-stages.md`](./modules/sales-pipeline-and-stages.md), [`sales-proposals-and-zoho.md`](./modules/sales-proposals-and-zoho.md), [`sales-close-and-handover.md`](./modules/sales-close-and-handover.md), [`sales-reports.md`](./modules/sales-reports.md), [`sales-settings.md`](./modules/sales-settings.md).

| Path | Shows | Menu |
|---|---|---|
| `/sales`, `/sales/follow-ups` | Follow-ups (entry point; `/sales` redirects here, `sales/page.tsx`); also lists dated follow-ups placed on an account that has no inquiry (row opens the account). Reminders, handover and "Needs attention" cards. `?view=today` (My Day's "N due today" link) shows only the Today group, with "Show all to-do" (fixed 2026-11-08). A "Handover accepted" row on the handover card has a per-person **Dismiss** (2026-11-12, PR #86, not merged; `modules/sales-followups.md` section 2.1). See [`modules/sales-followups.md`](./modules/sales-followups.md) | Menu |
| `/sales/opportunities`, `/sales/opportunities/[id]` | Enquiries (table or board `?view=board`; side panel `?open=<id>`; quick filters `?need=overdue|due_today|no_first_response|no_next_action|handover`; search and filters applied in the database before any row limit); the enquiry page opens with the guide cards Next action, Where it stands (or Delivery handover once Won) and Latest activity; enquiry detail with tabs Overview, Scope & dates, Activity & history, Proposals & files, Estimates, Commercial (`?tab=`); Edit details has role-aware Agency and End client pickers. See [`modules/sales-enquiries.md`](./modules/sales-enquiries.md) | Menu / Ctx |
| `/sales/opportunities/[id]/close`, `.../handover` | Close as won/lost; handover to Projects | Ctx |
| `/sales/accounts`, `/sales/accounts/[id]` | Clients & Agencies: directory (search and filters in the Enquiries toolbar, applied as chosen with no Apply button: role, outreach priority, account owner, and under More filters country, lead source, exhibition; buttons Import from Excel, Export filtered results, Export all accounts) and account page (profile, contacts, inquiries direct or through an agency, quotes, follow-ups on its inquiries or on the account itself when it has none). Import confirm checks the preview is still current ("preview is out of date" then "Run a fresh preview"). Control reference: `modules/sales-clients-and-agencies.md` | Menu |
| `/sales/events`, `/sales/events/[id]`, `/sales/events/import` | Events & Exhibitions: shared list of editions, as a List or a month Calendar (`?view=calendar&month=YYYY-MM`; names by day, each opening its edition); Add event saves the event with its first edition (list: default upcoming; filters in the Enquiries toolbar, applied as chosen with no Apply button and keeping the List or Calendar view and the month: name, country, dates, past, archived; enquiry figures for the current company or, with several, all of them) and one event (editions across years, exhibitors compared with their agencies per edition, agencies to contact, linked enquiries, Record an observation, Archive on events and editions), plus `/sales/events/import` (Import events: template, preview, confirm; .xlsx or .csv into the one shared calendar). See [sales-events-and-exhibitions.md](./modules/sales-events-and-exhibitions.md) | Any Sales grant |
| `/sales/outreach` | Pre-inquiry outreach: My outreach (own assignments: objective, target date, status, last contact and latest outcome, next action and due date, Overdue marker) and, for holders of `assign_owner` / founders, All outreach (filters Assigned to, Status, Overdue only, in the Enquiries toolbar, applied as chosen with no Apply button). The account page has an Outreach section (log call/email/meeting, next action, status, create or link a real inquiry, append-only history); the directory has multi-select and Assign outreach for leads. `/sales/new` accepts `?company=&org=&outreach=` to pre-fill. Control reference: `modules/sales-clients-and-agencies.md` section 10 | Menu (Sales tab "Outreach") |
| `/sales/accounts/import` | Guided Excel import: Upload, Preview, Confirm, Result (template download). Routes `/api/sales/accounts/import`, `/api/sales/accounts/import/template`, `/api/sales/accounts/export` | Any Sales grant for the company; changes need the existing organisation edit rules |
| `/sales/new` | Full new-enquiry form (`/sales/opportunities?add=1` opens the quick-add dialog instead); Agency, End client and the optional Event / Exhibition are search-as-you-type fields; the party fields offer only organisations holding that role | Secondary |
| `/sales/clients`, `/sales/proposals`, `/sales/pipeline` | `/sales/clients`: the older shared contacts page, **still a working page** (not redirected). `/sales/proposals`: proposal versions across enquiries. `/sales/pipeline`: **redirects** to `/sales/opportunities?view=board` (`sales/pipeline/page.tsx`); there is no separate pipeline page. `/sales/access` redirects to `/people-access` (`next.config.ts`); `/sales/contacts` does not exist (404). See [`modules/sales-coverage-index.md`](./modules/sales-coverage-index.md) section 3 | Secondary |
| `/sales/reports` | Reports (read-only; cards and definitions in [`modules/sales-reports.md`](./modules/sales-reports.md)); a failed read is a per-card "Could not load" plus an "incomplete" notice; Enquiries by source shows readable names | Menu |
| `/sales/settings` | Sales settings per company (reference code, currency, response target, working calendar, duplicate window, owner e-mail, approval policy) and the estimate VAT choices; the standard-terms editor was removed (the template is stored, unused). See [`modules/sales-settings.md`](./modules/sales-settings.md) | Menu (Manage), settings capability or founder |
| `/sales/opportunities/[id]` tab "Estimates", `/sales/opportunities/[id]/quotations/[proposalId]` (URL kept) | Estimates: list on the enquiry; builder in three steps (Details, BOQ, Preview & finalise) with one Save draft, inline items (sections optional, 1, 2 then 1.1), live totals, More options (client notes, indicative payment schedule, Review pricing after, internal notes), Review for approval, Finalise estimate, frozen read-only view, Create revision, Download PDF / Download Excel (`/api/sales/quotations/[proposalId]/pdf` and `/xlsx`). Proposal versions show estimate rows as "Estimate, draft / finalised" with no "Record as sent". Control reference: `modules/sales-estimates-and-quotations.md` | Any Sales grant reads; owner or founder changes (database) |

### Operations (`operations/layout.tsx`: "You are not an Operations Manager...") (Projects & Tasks Phase 2B; branch `claude/projects-phase-2b-operations`, not merged; migration `20270102000100` not applied by Claude; on hosted it is treated as applied from the owner's report of 2026-11-12 that the signed-in Preview checks of PR #86 passed, `Unverified` by Claude)

Reference: [`modules/operations.md`](./modules/operations.md). Rows 237 to 249 and 261 to 265 of [`modules/projects-coverage-index.md`](./modules/projects-coverage-index.md). The two rows below were re-checked against commit `16d6f42` (the redesign of 2026-11-12, app only).

| Path | Shows | Menu |
|---|---|---|
| `/operations` | **Operations Overview** for one company (`?company=<id>` when the person is Operations Manager of several): four summary cards (Needs my decision, Installations in the next 14 days, Equipment issues, Upcoming Sales work; each figure is the length of the list it opens: `#decisions`, `#installations`, `#equipment`, Upcoming Work), then Needs my decision and Next installations beside the Delivery timeline for the next 30 days, Upcoming delivery by week, Equipment issues, Project health (On track, Needs attention, At risk, Not enough information, each with its evidence; a rule, not a score), Coming up from Sales and Team pressure. A failed read shows no figure or label; a failed Upcoming Work read shows "—" and "Could not be loaded" on its card. Read `ops_overview` and `ops_upcoming_work`. Every item links to the Projects, Handovers or Equipment screen where the responsible person acts; Operations changes none of it | Menu (Operations > Overview). SQL: `ops_require` (the capability `operations`, or founder, for that company) |
| `/operations/upcoming` | **Upcoming Work**: the enquiries Sales flagged for Operations planning (`?q=`, `?stage=open|won`, `?next=operations|sales|project-manager`), each a card headed by the event and venue with four facts (Dates, Expected decision, Provisional Project Manager, Next unresolved item) and the rest under **More**, with **Plan** (provisional Project Manager, risk, capacity conflict, a question for Sales) and, once a handover exists, **Assign a Project Manager** or **Open the handover**. No price, quote, brief or Sales note is read | Menu (Operations > Upcoming Work). SQL: `ops_upcoming_work`, `ops_set_enquiry_planning` |

**Changed screens in the same phase:** `/sales/opportunities/[id]` (Overview tab: panel **Operations planning**, `modules/sales-enquiries.md` 4.6); `/sales/events/[id]` (card **Delivery projects for <edition>**); `/projects` (line "Event edition: ..." and the filter **Event edition**, `?edition=`); `/projects/handovers` (Event edition on the brief); `/projects/[id]/work` (Event edition on the details card, equipment readiness in the delivery summary, **Review equipment booking** in What needs doing, **Delivery complete · equipment still out**); `/projects/[id]/equipment` (Readiness per request, panel **Review equipment booking** with **Mark as reviewed**, the still-out and failed-release notices); `/inventory/requests/[id]` (the same **Review equipment booking** panel for the warehouse); `/inventory` (Today: the readiness sentence counts lines to buy or rent apart); the Chat panel (**Archived (N)**, which holds the groups of completed and archived projects since commit `93ec0f2`, and the **Operations** tag); My Day `/` (the **Operations** summary card for people with Operations access, and two more sources in Needs me: section 4). An Operations Manager opens every project of their company at the details level without being enrolled.

### Projects and tasks (`projects/layout.tsx`: "You do not have Projects access...")

| Path | Shows | Menu |
|---|---|---|
| `/projects/work` | My Work: My tasks, Waiting for my review (`?show=review`), Blockers I can help clear (`?show=blockers`), Sent for review (`?show=waiting`), Overdue, My team | Menu |
| `/projects`, `/projects/calendar` | Directory; cross-project calendar | Menu |
| `/projects/new` | New internal project | Secondary, needs `assign_pm` |
| `/projects/handovers` | Handovers: open ones first (oldest first), accepted and withdrawn ones paged separately (`?page=`); `?handover=<id>` opens one brief by id (My Day links here) | Menu (Manage) |
| `/projects/scope-decisions/[scopeChangeId]` | Scope-change decision | Ctx (from My Day) |
| `/projects/[id]/delivery`, `/projects/[id]/delivery/import`, `/api/projects/[id]/delivery-plan/{template,export,import}` | **Delivery plan** tab (Phase 2 part 1; merged in PR #84): deliverables by zone with breakdown sections, release into tasks and the draft equipment request, corrections and proposed changes, Download template / Import Excel / Export Excel. Reference `modules/projects-delivery-plan.md` | Ctx: SQL (`proj_can_view_details` to read; `proj_can_manage`, `proj_dp_can_edit_section` to change) |
| `/projects/[id]/closeout`, `/projects/[id]/closeout/[reportId]/pdf` | **Closeout report** (Phase 2 part 2; merged in PR #84), from Manage project, Files & client plan and Complete project: Review data to be sent, the AI or facts-only draft, edit, approve, approved versions and their PDF. Internal only; it completes nothing and sends nothing to the client. Reference `modules/projects-closeout-report.md` | Ctx: SQL (`proj_can_manage` for every read and write; a draft is not downloadable) |
| `/projects/[id]` plus `work`, `work/tasks/[taskId]`, `plan`, `timeline`, `calendar`, `discussion`, `documents`, `people`, `changes`, `history`, `complete`, `equipment`, `budget` | One project: summary and tabs (Work, Timeline, Equipment, Budget; **the Discussion tab is removed once project chat groups exist**: `/discussion` then sends a member to `/work?chat=<group>`, and the conversation is the project's group in Chat, opened from the header's Chat button or `?chat=<group id>` on any page). Equipment tab holds equipment requests and dispatch/return notes; Budget tab is the project budget (denied and error are separate states) | Ctx: SQL checks (`proj_can_view_details`, `proj_can_manage`, `pbx_budget_view`) |

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
| Sales & CRM | Follow-ups, Enquiries, Clients & Agencies, Outreach, Events & Exhibitions, Reports; Manage: Settings | Any Sales grant. Settings: `manage_settings` capability or Sales founder. Secondary (search only): New enquiry, Clients & contacts, Proposals & quotes, Pipeline board |
| Me | My Profile, My Attendance Clock, My Attendance, My Leave, My Reimbursements, My Letters, My Equipment, My Performance | Always. My Attendance and My Letters hidden for HR Admin (they move to People & HR). My Equipment only if the person has a linked employee record |
| People & HR | People: Employees, Attendance register. Workflow: Alerts, Letters, Payroll. Organisation: Assets, Companies. Insights: AI Suggestions, Audit Log. Access: People & Access | Group appears if any section has a row. Employees: role line_manager/hr_admin/finance/ceo/cto/sys_admin **or** any direct report. Attendance register and Letters: HR Admin. Alerts: `canViewHrAlerts`. Payroll: HR/Finance/CEO/CTO. Assets: HR or Finance. Companies: System Administrator. Insights: HR Admin or sys admin. People & Access: `canUsePeopleAccess` (sys admin, HR Admin, or a module access manager in Sales/Projects/Inventory/Budget) |
| Operations (Phase 2B; branch `claude/projects-phase-2b-operations`, not merged) | Overview, Upcoming Work | A Projects grant whose capabilities include `operations` (Operations Manager) or `founder`, in any company. `assign_pm` alone does not show it. Listed directly before Projects & Tasks. On a phone it is in the More drawer, not on the bottom bar |
| Projects & Tasks | My Work, Projects, Calendar; Manage: Handovers; secondary: New internal project | Any Projects grant, or linked to a project as Sales (then only "Projects"). Lands on `/projects/work` unless founder, `assign_pm` or manages projects. Handovers: `assign_pm` or a handover is waiting. New internal project: `assign_pm` (Phase 2B: an Operations Manager counts as holding `assign_pm` for Handovers, because `hasProjCapability` implies it; New internal project needs `assign_pm` itself or founder, `holdsAssignPm`) |
| Inventory | Today, Stock, History, Requests; Manage: Setup; secondary: My equipment, Scan a label, Equipment held by people | Any Inventory grant, or manages projects. Today: grantee. History: can view stock or founder. Requests is secondary for grantees. Setup: `manage_catalogue` or founder. Held by people: `view_employee_custody`, founder or warehouse. Lands on `/inventory` or `/inventory/requests` |
| Finance | Project budgets (shows a waiting count if more than 0 and readable) | Any Budget grant (`budget.any`). A PM without a grant reaches the budget from the project |
| Company information | Holidays, Policies | Always |

Notes
* Timesheets, Departments and a notification bell have no menu entry (`nav-groups.ts`, `shell-chrome.tsx`).
* `navGroupsFromModules` feeds the command palette (search); secondary links appear there only.
* The header shows a breadcrumb "Module / Page" (`breadcrumbFor`); the most specific link wins (`/attendance-clock` is not swallowed by `/attendance`).
* **Phone bottom bar** (`shell-chrome.tsx`): My Day; Sales (only with a Sales grant, to `/sales/follow-ups`); Clock (employees only; reads "Clocked in" when a shift is open); Me (`/profile`); More (opens the full menu drawer). Shown below the `lg` breakpoint.
* **JARVIS launcher** (not a menu entry): one floating button "Open JARVIS" on the right edge of every signed-in page (a round button above the bottom bar on phones), drawn by `apps/web/src/app/(app)/layout.tsx` only when the server says the person may use JARVIS (`lib/jarvis/launcher.ts`: environment ready, the pilot switch on, the person on the pilot list, an active Sales grant for a company the pilot covers). OFF by default and absent for everyone otherwise; hiding it is cosmetic, every JARVIS call is checked again on the server. Opens a side panel (desktop) or a full-height sheet (phone) with a mode chip per enabled action (new enquiry from a brief, draft a reply, update an enquiry, change status, meeting notes, register a client or agency, ask how something works); see [`modules/jarvis.md`](./modules/jarvis.md).
* **Chat button** (not a menu entry): one floating round button on every signed-in page (bottom-right on desktop, above the bottom bar on phones, stacked clear of the JARVIS button), drawn by `apps/web/src/app/(app)/layout.tsx` only when the person belongs to at least one Chat group (an active Sales grant for that company; no eligible group, no button). It shows the person's total unread and opens the Chat panel over the current page (a bottom sheet on a phone): a list of groups with their own unread counts, then the thread with composer, @mentions and Share item. Only the three Sales groups exist in this release; project groups are planned. See [app-chat.md](./modules/app-chat.md).
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
2a. **Operations summary** (`components/my-day/operations-summary.tsx`; added 2026-11-12, PR #86, not merged; read at `16d6f42`): shown **only to people with Operations access** (Operations Manager of a company, or Projects founder), above the main grid. Three parts: **Waiting for a decision** (the count of recorded situations, linking to Operations at `#decisions`), **Next installations** (the next three, with date, Project Manager and health label) and **Most urgent issue** (with its owner and a direct link). It uses the same two reads as the Operations pages (`ops_overview`, `ops_upcoming_work`), once per company, each checked for that company in the database; there is no second copy and no commercial field. A company whose read failed is named and never counted as zero; if the whole read failed the card says "Operations could not be loaded right now." Oversight, not a to-do list. Detail: [`modules/operations.md`](./modules/operations.md) section 14.
3. **Needs me** (`components/my-day/decisions-card.tsx`): ordered overdue first, then due today, then the rest by how long they have waited; a record reached by two sources is listed once. Twelve sources (`AttentionSource`; ten before 2026-11-12):

| Source | What it adds | Link |
|---|---|---|
| `approvals` | Decisions waiting (leave, claims, Recovery Leave, queue-routed) | `/approvals` |
| `project-tasks` | Own tasks overdue or due today; tasks waiting for review | `/projects/work?task=...` |
| `project-decisions` | Handovers and scope decisions | `/projects/handovers?handover=<id>` (that brief), `/projects/scope-decisions/...` |
| `sales` | Overdue/today follow-ups; enquiries awaiting first response | `/sales/follow-ups` (overdue), `/sales/follow-ups?view=today` (due today, now lands on the Today view), enquiry |
| `sales-handover` | Won enquiry needing handover | `/sales/opportunities/[id]/handover` |
| `sales-approvals` | Commercial approvals waiting | enquiry `?tab=commercial` |
| `budgets`, `budget-projects` | Budget decisions and returned budgets of own projects | from `lib/budget/my-day.ts` |
| `notes` | Dispatch and return notes waiting acknowledgement | project notes link |
| `hr` | Contracts, probation, documents, identity (counts) | `/alerts` |
| `operations` (new) | "Sales answered the Operations question: decide the planning", for 7 days after the answer, for the Operations Managers of that company (the read gives the asker's name, not their id). Key `opp:<id>`, so it merges with any other row about that enquiry | `/operations/upcoming?company=<id>&q=<reference>` |
| `project-equipment` (new) | "Review equipment booking" on projects where the viewer is the Project Manager, one item per project (`proj_equipment_reviews`, under row-level security) | `/projects/<id>/equipment` |

**Listed once.** A handover the viewer can assign is **not** added by the `operations` source: `project-decisions` already lists it once (`projectDecisionCandidates`, key `opp:<opportunityId>`). A booking review is the Project Manager's item here; for an Operations Manager it is an oversight signal in the Operations summary and on the Overview, with the Project Manager named as owner. A failed Operations or booking-review read is an error entry naming "Operations" or "Equipment bookings to review", never an empty list (`lib/my-day/operations.ts`, `operations-day.ts`; tests `lib/my-day/operations.test.ts`, `app/(app)/page.operations.test.tsx`).

**Also open** (information, not counted): the "Handover accepted" line is built from the same rows as Sales Follow-ups, so a notice the person dismissed there leaves My Day too (`handoverNotice` in `app/(app)/action-centre.ts`; `modules/sales-followups.md` section 2.1).

4. **Waiting on others**: what the person submitted (budgets, leave, claims, Recovery Leave, tasks sent for review). Never counted in the headline and never a decision for them.
5. **My work today**: own tasks by title. Then Attendance clock card, People today, Next dispatch, Delivery this week, Sales pipeline, Project status (widgets appear by access).
6. **People & HR today** (HR view only): attendance, companies, upcoming holidays, on leave, birthdays, team distribution, HR attention.

Phone order: what needs you first, then your tasks (`docs/os-my-day.md`).

## 5. Failed-read convention

* A load error must say it could not load; it must never show empty, zero, "nothing waiting" or "no access" (`CLAUDE.md`).
* Mechanics on My Day: every source is read with `Promise.allSettled`; a failed source becomes `failed(source)` and an error entry naming it (`SOURCE_LABEL`) in both the headline and Needs me (`attention.ts`, `page.tsx` lines ~106, 333).
* Menu: Finance's waiting number is simply absent when unreadable ("never 0, never a guess", `nav-groups.ts`). Inventory shows `LoadError`.
* Known residual gaps: failed role or navigation-probe reads can still hide menu rows or read as "no role" (spec D-15, D-19, D-20; status after launch `Unverified`). Inventory staff-directory failed-read sweep is deferred (file 01, section 8).
