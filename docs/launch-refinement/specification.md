# ENGINIOUS OS: launch-refinement specification (for owner approval)

**Status:** planning and investigation only. **Nothing in the app has been changed.** No migration, permission change, prototype, merge, hosted SQL, message, access change or Production change was made or run while preparing this document.
**Basis:** current `main` at commit `76c121b` (includes the Inventory simplification, PR #52), read in code and SQL. Earlier design documents were treated as historical; where they disagree with code, the code is used.
**Prepared:** 2 November 2026. **Revision 2 (2 November 2026):** corrected the budget-notification finding (D-07): the notices *are* created for Finance and executive approvers; what fails is that a Finance-only person who is not on the project cannot see them. The companion implementation checklist is `implementation-checklist.md`.

## How to read this document

| If you have | Read |
|---|---|
| 10 minutes | Section 1 (recommendation), Section 8 (decisions needed), Section 9 (order of work) |
| 30 minutes | the above plus the two summary tables at the top of each register part (3.1, 3.2, 3.3) and Section 6.0–6.2 (dispatch note in brief) |
| An afternoon | everything; each register entry is self-contained (current behaviour, problem, proposal, before→after, roles, data source, technical scope, business-rule impact, acceptance checks) |

| Section | Contents |
|---|---|
| 1 | Executive recommendation |
| 2 | Current-flow findings with source references (how the app works today; 27 features verified to exist) |
| 3 | Detailed change register: **3.1 confirmed defects (D)**, **3.2 usability recommendations (U)**, **3.3 new functionality (N)** |
| 4 | Role and navigation matrix (navigation level, read/create/edit/approve/manage, direct-URL audit, "Me" experience) |
| 5 | Before-and-after everyday paths (12 paths) |
| 6 | Dispatch note, return checklist and PM acknowledgement (specification) |
| 7 | Technical impact and migration requirements |
| 8 | Decisions needed from the owner, with recommended defaults |
| 9 | Bounded implementation order |
| 10 | Acceptance and launch checklist |

## Method and what "verified" means here

* **Investigation:** eight read-only investigations (My Day/navigation/search, Sales and Projects, Inventory, dispatch/return feasibility, Budget/Expenses/Approvals, People & HR, People & Access and the permission model, reliability and scheduled jobs), plus the app's own navigation builder run against 30 responsibility combinations. Every finding cites `path:line` or a migration function/policy.
* **Verification labels used throughout:** **Confirmed (code)** = reasoning checked against code/SQL, not executed. **Confirmed (code, hosted state unverified)** = needs a read-only look at the live system (the exact check is given). **Needs runtime confirmation** = plausible from code, order- or data-dependent. **Nothing in this document was exercised against a hosted database, and almost nothing was run at all**; the only executed checks were the existing budget-rounding unit tests (31 passed) and the navigation builder.
* **Spot-checked personally** (in addition to the investigators): the sign-in proxy exempting only one cron route; the claim-line numbering defect; the employee-equipment reserve-then-issue conflict; the draft-policy status function with no role check; the Letters page creating download links regardless of letter status; deactivation updating `account_status` but not `profiles.is_active`.
* **Timing goals are targets, not measured results.** "Before" counts come from walking code paths (clicks, fields, screens); "after" counts are what the proposal is designed to achieve and are labelled as targets.
* **A correction to an early impression.** An early reading suggested ordinary staff see company-wide HR screens. The navigation audit shows that Payroll, Assets, Alerts, AI Suggestions, Audit Log and Companies are already hidden from ordinary employees. The real navigation problem is different: three links are labelled as company screens but open the person's own record ("Employees", "Attendance", "Performance reviews (HR)"), and two rows lead nowhere ("Vendors & Purchasing: coming soon", "KPIs: soon"). Section 4 is written from the audited facts.

---

# 1. Executive recommendation

## 1.1 The short version

1. **The foundations are sound and should not be disturbed.** Access is enforced in the database (row-level security and database functions), not just hidden in menus; drafts of policies are protected by the database; Inventory has strong repeat-safety and a good "could not load" pattern; the Sales-to-Projects handover, approvals independence, company boundaries and the leave/attendance/payroll calculations are intact. This spec **changes none of those rules**.
2. **The launch risk is not missing features. It is silent failure and invisible hand-offs.** The same two patterns recur across the app:
   * **A failed read looks like "nothing" or "no access".** When the data service has a blip, approvers see "Nothing waiting on you", leave pages show "0 days", project work disappears, and the menu loses entries, with no error. Inventory already shows the right behaviour ("Could not load … this is not an empty list"); most other modules do not.
   * **The next person is not told.** A won enquiry with no handover, a Project Manager's question to Sales, a budget waiting for a Finance-only approver (the notice is recorded, but the only screen that reads it shows project participants), a scope-change proposal, a dispatch to a project: each leaves work waiting for someone who has no screen that shows it.
3. **Fifteen items are recommended as launch blockers** (14 defects, 1 usability item; no new feature is a blocker). They group into **seven work packages** (1.3). Three of them are verified only by code and need a read-only check of the live system first (1.5).
4. **The two features you proposed are feasible and should be built as a bounded increment *after* the notices inbox and a "Needs me" list**, because a PM acknowledgement nobody sees is worse than none. The dispatch note comes first; the return checklist is a second increment (Section 6).
5. **A compact "Me" navigation** for ordinary staff, fixes to misleading labels, and a My Day that shows *my work*, not just counts, are the highest-value everyday improvements (Sections 4 and 5).

## 1.2 What the register contains

| Category | Entries | Launch blocker | Launch improvement | Later |
|---|---|---|---|---|
| **Confirmed defects** (D) | 59 | 14 | 35 | 10 |
| **Usability recommendations** (U) | 38 | 1 | 26 | 11 |
| **New functionality** (N) | 23 | 0 | 12 | 11 |
| **Total** | **120** | **15** | **73** | **32** |

Five of the improvement entries are marked *provisional* because a single owner answer would move them (for example, whether letter templates carry salary, which decides whether a letter-download defect becomes a blocker).

## 1.3 The launch blockers, as seven work packages

| WP | What goes wrong today | Register | Reuses existing actions or needs a migration |
|---|---|---|---|
| **WP1 Scheduled jobs** | The sign-in proxy exempts only `/api/cron/crm-reminders`. Vercel's cookie-less calls to the leave-accrual, comp-day-expiry, document-expiry, balance-discrepancy and recovery safety-net routes are very likely redirected to `/login` and never run. (The Recovery Leave processor also runs from the database scheduler, which is its primary.) **Hosted state not visible; check Vercel Cron run history first.** | D-01 (+D-25) | No migration. **Owner decision:** exempting the routes will start jobs that move leave and comp-day balances; a read-only preflight and HR review must come first. |
| **WP2 Honest failure states** | Failed reads become "Nothing waiting on you", "0 days", "No leave requests", empty project lists, "not found". | D-02, D-03, D-04 (same pattern in D-15…D-20) | Interface/server logic only, using the existing `LoadError` pattern. |
| **WP3 Hand-offs that stall** | Budget, final-expense and settlement **notices are written** for Finance and CEO/CTO approvers, but the only screen that reads them shows project participants, so a **Finance-only person who is not on the project cannot see them** (My Day has no budget row; they find the item only by opening the Finance inbox); a won enquiry with no handover is shown to nobody; the PM's handover question and acceptance reach a Sales-only owner nowhere; scope-change proposals and commercial approval requests notify nobody. | D-07, D-08, D-09, U-01 | Mostly interface and read logic using existing records; D-07's PM side and U-01 need small database functions. |
| **WP4 Money defects** | In an employee claim, deleting a line then adding one fails every time (raw database error, form wipes itself). "Advance still to be returned" shows the full advance before final expenses are approved. | D-05, D-12 | Server logic / interface; no migration needed. |
| **WP5 Employee equipment request** | The workspace says "reserve, then give", but giving equipment to an employee is refused by the request's own reservation (the system treats the reservation as a conflict and never consumes it, unlike a project dispatch). | D-06 | Fix needs a function replacement (migration) **or** an interim interface change; owner chooses (Section 8). |
| **WP6 Accounts and confidentiality** | Deactivating an account stops sign-in but the person stays "active" for access checks, people pickers and approval routing; every signed-in user can read every profile including the free-text deactivation reason. | D-10, D-11 | Migration (function/policy) + interface; hosted column privileges to be checked first. |
| **WP7 Clock and Recovery Leave display** | The "Project lead" picker on the attendance clock probably contains only the person themselves for an ordinary employee; Recovery Leave approval cards can be blank for project leads and missing for a CEO/CTO deciding an HR Admin's request. | D-13, D-14 | Migration (function/policy). **Owner decision**; these sit beside the attendance and Recovery Leave rules: the proposal widens only what a person may *see* of a request they decide, and changes no calculation or routing. Needs runtime confirmation. |

## 1.4 The highest-value improvements for daily use (included in the refinement)

1. **A compact "Me" navigation** for ordinary employees, with Holidays and published Policies under "Company information"; remove dead rows (U-03, U-04, D-42, D-43; Section 4.4).
2. **My Day that shows my work** (task titles, due today vs later, what blocks me) and one block per fact (U-02, D-21, D-40).
3. **A notices inbox and a single "Needs me" list that read the records we already have** (approvals, budget steps, task reviews, handovers, leave decisions, dispatch acknowledgements), with no new approval or task system (N-01, N-02, U-06, U-07).
4. **Fewer clicks where staff repeat themselves:** report a blocker in 2 clicks (U-11), handover "Save and submit" in one step (U-10), log a call and plan the next step in one dialog (U-14), stop re-entering "How paid / Who paid" on every expense line (U-15), set one condition for several ticked lines on return (never a default "Good") (U-23).
5. **Inventory correctness and clarity:** two return screens with opposite safety defaults (D-28), missing "Receive back" links for fulfilled/finished projects (D-30), Today queue hygiene (U-25, D-31, D-34).
6. **Access made understandable:** role packs, names of who to ask for access, onboarding that does not ask for the same facts twice (U-20, U-13, U-19, N-10).

## 1.5 Read-only checks that need the live system before work starts

Nothing here needs SQL that changes data. Each is a view-only check the owner (or an engineer with access) can do.

| # | Check | Why it matters | Register |
|---|---|---|---|
| 1 | Vercel → Cron Jobs → run history for the five HR routes; Vercel *Root Directory* (`apps/web` or repo root, which decides whether `vercel.json` applies at all); whether `CRON_SECRET` is set | If they return redirects the jobs have not been running (leave accrual, comp-day expiry, document expiry, balance detector). Has leave accrual been posted another way since go-live? | D-01, D-25 |
| 2 | Live EXECUTE privileges on `preflight_phase2b_v2_policy_status()` | Decides whether every signed-in user can read seeded **draft** policy values | D-22 |
| 3 | Column privileges on `profiles` (especially `status_reason`) | Decides whether deactivation reasons are readable by all | D-11 |
| 4 | Storage policy on the `letters` bucket, and whether letter templates carry salary | Decides whether a pending letter can be downloaded and whether that is a blocker | D-23 |
| 5 | Whether the hosted `departments` table has rows; whether `notifications` rows exist | Sizes the departments screen and the notices work | N-10, N-01 |
| 6 | Whether a deactivated user's existing session token survives until it expires | Decides how strong the deactivation fix must be | D-10 |
| 7 | Preview deployment: whether the PDF fonts/logo are bundled | Prerequisite for the dispatch-note PDF | Section 6 |
| 8 | At runtime on the local stack: clock project-lead picker for a plain employee; CEO/CTO view of an HR Admin's Recovery Leave request; employee-request reserve-then-issue | Moves three items from "Confirmed (code)" to "reproduced" | D-13, D-14, D-06 |

## 1.6 What is explicitly not proposed

No change to attendance, Recovery Leave, leave-balance or payroll calculations; HR reporting lines based on project leadership; company boundaries; independent approvals or sensitive-grant protections; Inventory booking conflicts or movement history; the single working Sales-to-Projects handover; physical project-expense receipt submission; or Zoho Books as the quote/invoice tool. No new branding. No second task or approval system. The AI assistant is a later enhancement and is **not** a launch dependency (N register, closing section).

Items that sit inside those boundaries (a System Administrator being able to give themself any HR role; CRM organisations readable across companies; the old Sales-side handover function still callable) are **reported as risks only**, with the decision left to you (Section 8).

## 1.7 What I recommend you do next

1. Approve the **launch scope** in Section 9 (or change it).
2. Answer the **decisions in Section 8** marked "before work starts" (about eight).
3. Have the **read-only checks in 1.5** done; they are quick and change nothing.
4. Tell me whether the **dispatch note and return checklist** should be in this refinement window or a second increment (my recommendation: dispatch note in, return checklist second).

---

# 2. Current-flow findings with source references

This section describes how ENGINIOUS OS works today on `main` (commit `76c121b`, which includes the Inventory simplification, PR #52). It is a description only: it proposes nothing. Defects and recommendations are in the registers (Section 4 onward) and are cross-referenced here by investigator id (`F-A-nn` and so on) so that each fact can be traced.

**How to read the references.** Paths are relative to the repository root. `W/` means `apps/web/src/`, `M/` means `supabase/migrations/`, `D/` means `packages/domain/src/`. A reference such as `W/app/(app)/page.tsx:265` is file and line. SQL objects are named by migration file plus function or policy.

**Verification status of everything in this section.** No investigator started the application, ran the full test suite or touched the hosted system. Every statement below is therefore **from code** (read in the repository at `76c121b`) unless it carries another label. The only thing executed was the pure budget-rounding test in `D/` (31 tests passed, Finding E). Where a fact depends on the hosted system it says so and gives the read-only check.

**Code is the authority.** Where `docs/` disagree with the code, the code is described. Two statements in the earlier investigator notes disagreed and were resolved against the code:
* Finding A says the leave e-mail helper "silently no-ops" when Microsoft settings are missing. Finding H is right: `W/lib/email/graph.ts:25-30` throws, and every notifier catches and logs it (`W/lib/email/leave-notifications.ts:14-16`). The effect for the user is the same (no mail, no message), but it is logged.
* Finding A says Inventory "Today" is for grantees only; Finding C adds that a Project Manager without a grant is sent to Requests and a plain employee to My equipment. Both are correct and are combined in 2.4.

---

## Table 2.0 Features verified to EXIST although they may look hidden

Each row was confirmed by finding the route, component, function and table. "Where it lives" is the shortest path a person takes today.

| # | Feature | Where it lives (what the person clicks) | Evidence | Why it looks hidden |
|---|---|---|---|---|
| 1 | **Site bookings** (book a named person on site, with preparation and travel allowance, tentative then confirmed, overlap check across every project) | Project > **Timeline** tab > "Site plan" > section "Site bookings" (`#bookings`). Also shown in "Next on site" card on the project Work tab and in the Calendar (`/projects/calendar`) | Table `proj_site_bookings` (`M/20261120000400_proj_plans_site_calendar_discussion.sql:75-102`: `location`, `starts_at`, `ends_at`, `tz`, `lead_minutes`, `trail_minutes`, `state` tentative / confirmed / cancelled, `override_reason`); functions `proj_save_booking` (:429), `proj_booking_conflicts` (:514), `proj_confirm_booking` (:542), `proj_cancel_booking` (:604); page `W/app/(app)/projects/[id]/plan/page.tsx:91,146-150` | Inside the Timeline tab, not its own tab; the sentence "Several assignments in one day are never a conflict. Only physical site bookings are compared..." is the only explanation |
| 2 | **Record search, per module** | Employees: People & HR > Employees > "Search by name or email". Projects: Projects > search (name, reference, PM). Tasks: My Work > "Search tasks or projects" and project Work tab > "Search tasks". Enquiries: Sales > Enquiries > search (title, reference, agency, client). Clients and contacts: Sales > Clients & contacts. Inventory: Stock > search (name, model, serial, equipment ID, bin label); Requests > search | `W/app/(app)/employees/page.tsx:72-77` (`ilike` on first name, last name, personal e-mail); `W/lib/inventory/stock.ts` (`ilike` on name, model, specification, manufacturer, code, serial); in-memory filtering in `filterDirectory`, `enquiry-list.ts`, `sales/clients/page.tsx:62-70` | There is **no** search across more than one record type (verified absent, see 2.11 table). The command palette (`W/components/nav/command-palette.tsx`, Ctrl/Cmd+K, placeholder "Type a page name…") searches page names only |
| 3 | **Notifications table and in-app notices** | Table `notifications(id, user_id, type, payload, read_at, created_at)` (`M/20260928000000_phase5_...sql:193-202`). Written by `proj_notify` (Projects), `pbx_notify` (Budget), and `document-expiry` cron. Read in **one** place: the "Project notices" panel at the bottom of **My Work** (`W/app/(app)/projects/work/page.tsx:88,163-190`, RPC `proj_my_notifications`) | `W/lib/projects/notification-text.ts`; grep of `from("notifications")` finds only the cron insert and the RPC read | No bell, badge, inbox page or count anywhere in the shell. The only bell icon is the HR-only link to `/alerts` (`W/components/nav/shell-chrome.tsx:87`) |
| 4 | **Internal projects** (used for Marketing, Operations and any work with no client) | Projects > **Projects** > "New internal project", or `/projects/new` (people with the Projects capability `assign_pm`, or a Projects founder) | `proj_projects.kind in ('client','internal')` (`M/20261120000100_proj_core_tables.sql:20`), `is_ongoing` flag (:40), function `proj_create_internal_project`; page copy "For work with no client or Sales opportunity: office and showroom technology, new technology development, marketing, maintenance and improvements. No purchase order, no Sales value, no handover." (`W/app/(app)/projects/new/page.tsx:21`) | "Marketing" and "Operations" are not concepts in the code (searched); they are ordinary internal projects. Entry is a secondary link |
| 5 | **Scope-change flow** | Project > "Manage project" menu > **Feedback & changes** > "Propose a scope change", then "Decide" | Tables `proj_scope_changes`, `proj_scope_change_commercial`; functions `proj_propose_scope_change`, `proj_decide_scope_change`, `proj_set_scope_change_commercial` (`M/20261120000500_proj_feedback_plans_files_completion.sql`); page `W/app/(app)/projects/[id]/changes/page.tsx` | Under a menu, not a tab. Approval replaces the project's agreed-scope text only; nothing downstream is touched (2.3) |
| 6 | **Project "Feedback & changes"** (client feedback register) | Same page: "Record feedback" (who gave it, what was asked, kind, relates to, responsible, deadline) | `proj_feedback`, `proj_record_feedback`, `proj_update_feedback` | Same menu location |
| 7 | **Reviews** (four kinds) | (a) Task review: task status "Ready for review"; My Work "Waiting for my review"; project Work tab review queue. (b) Handover review: Projects > Handovers. (c) Budget and final-expense review: Finance > Project budgets. (d) Scope-change decision: Feedback & changes | `proj_tasks.requires_review` and status `ready_for_review` (`M/20261120000100...:211-215`), `proj_set_task_status`; `proj_handovers`; `pbx_decide_budget`, `pbx_decide_actuals`; `proj_decide_scope_change` | Four different places, none in `/approvals` (2.6) |
| 8 | **Today queues** (the warehouse work queue) | Inventory > **Today** (grantees only): rows Prepare, Send out, Receive back, Transfers on their way here, Sales checks; filter "Show"; warehouse bar | `W/lib/inventory/today.ts` (`QueueKind = prepare|send|returns|transfer|sales`), `today-data.ts`, `W/app/(app)/inventory/page.tsx`, `W/components/inventory/today/today-row.tsx` | Only people with an Inventory grant see it; a Project Manager sees Requests instead |
| 9 | **Transfer flow** (warehouse to warehouse; project to project) | Send: Stock > open item > "More actions" > "Move to another warehouse" (or unit panel "Send to another location"). Receive: destination warehouse's Today row "Transfer X is on its way here" > "Receive transfer". Project to project: movement kind `transfer_project` | `inv_transfer_dispatch`, `inv_transfer_receive`, `inv_transfer_between_projects` (`M/20261201000300_inv_stock_functions.sql`, `...000700_inv_transfer_destination_check.sql`); `W/lib/inventory/today-data.ts:172` | No "send transfer" button on Today or the Stock header (`W/components/inventory/stock/header-actions.tsx` offers only Receive stock and Give equipment) |
| 10 | **Sales-to-Projects handover** (the single working handover) | Sales > enquiry (Won) > "Handover package"; Projects > Handovers | `proj_handovers`, `proj_save_handover`, `proj_submit_handover`, `proj_assign_handover_pm`, `proj_request_handover_clarification`, `proj_accept_handover` (`M/20261120000200_proj_projects_handover_functions.sql`) | Not reached automatically from "Close as won" (2.2) |
| 11 | **Task blocking with an unblock owner** | Task panel > "More" > "Block task" | `proj_block_task`, `proj_unblock_task` (`M/20261120000300_proj_delivery_functions.sql:654-682`); `blocked_at` is a flag beside status | Blocked is not a status, and My Work has no Blocked filter |
| 12 | **Acting Project Manager** (temporary leader with an end date) | Project > Manage project > People & access | `proj_set_acting_pm`; `proj_is_pm` honours an unexpired `acting_pm` member row | Menu location |
| 13 | **Issued client timelines** (versioned, "Latest" badge, sent and accepted facts, PDF) | Project > Manage project > **Files & client plan** | `proj_issued_plans`, `proj_issue_plan`; PDF route `W/app/(app)/projects/[id]/documents/plans/[planId]/pdf/route.tsx` | Page title is "Documents", menu label is "Files & client plan" |
| 14 | **Suggested timeline templates** | Timeline tab > "Apply suggested timeline" (only when the plan is empty) | `D/projectTemplates.ts` (Delivery: Moodboard to Full test; Site: access to dismantling), `proj_apply_plan_template` | Templates are content-production specific; no task or team templates |
| 15 | **Project discussion with mentions and unread badge** | Project > Discussion tab | `proj_messages`, `proj_post_message`, `proj_unread_counts` | Unread counts appear on My Day as a row under "Also open" |
| 16 | **Project completion and reopen** | Project > Manage project > Complete project / Reopen | `proj_complete_project`, `proj_reopen_project`, `proj_completions` | Menu location |
| 17 | **Budget and Expenses** (budget, additions, funding, final expenses, receipts, settlement) | Project > "Budget & Expenses" tab (PM, acting PM, budget grantees); Finance > Project budgets | `pbx_*` functions and tables (2.5) | Tab only shown when `pbx_project_access().can_open` |
| 18 | **Sales availability checks into Inventory** | Sales enquiry "Request availability"; Inventory Today row "Sales checks" > "Check availability" dialog | `crm_request_availability`, `crm_confirm_availability`, `inv_pending_sales_checks`, `inv_opportunity_compute` | "Nothing is reserved by a check" |
| 19 | **Employee equipment** (give, return, custody list, My equipment) | Stock > "Give equipment"; Stock > "With people"; Inventory > My equipment | `inv_issue_to_employee`, `inv_return_from_employee`, `inv_my_equipment`, `inv_employee_outstanding` | "With people" is a secondary link |
| 20 | **Stock counts, kits, rentals, consumables, repair** | Inventory > Setup (`/inventory/manage`), unit and item panels | `inv_start_count`, `inv_confirm_count`, `inv_pack_kit`, `inv_receive_stock(p_rental)`, `inv_consume`, `inv_repair_out/in` | Setup only in nav for catalogue managers and founders |
| 21 | **Timesheets** | Typed address `/timesheets` only | Pages `W/app/(app)/timesheets/*`; approvals still list timesheets (`W/app/(app)/approvals/page.tsx:41`) | No link anywhere in nav, palette or pages (grep of `"/timesheets"`); migration comments call timesheets deprecated (`M/20261108...:3760`) |
| 22 | **Recovery Leave end-to-end** (clock, windows, credit requests, approvals, alerts) | My Attendance Clock; Approvals "Recovery Leave credits"; HR Alerts | See 2.7 (document only) | Leave page labels the balance "Comp-off" (`W/app/(app)/leave/page.tsx:80`) |
| 23 | **Birthdays** | My Day cards for HR and C-level only | `W/app/(app)/birthdays-section.tsx` | No route; HR and C-level only |
| 24 | **Letters, Performance, Assets, Alerts, Audit log, AI suggestions** | People & HR module links (2.7) | Routes in the nav matrix | Performance sits under "KPIs & Performance", not People & HR |
| 25 | **Account security** (change password, sign out this device or all devices) | User menu > "Account & security" | `W/app/(app)/account/security/page.tsx`, `signOutEverywhere` | Only in the user menu |
| 26 | **Access presets** (add Sales, Projects, Inventory or Budget rights in one step) | People & Access > person > Module access | `D/peopleAccess.ts:135-174`, `applyModuleAccess` | Presets only add rights |
| 27 | **Design preview** (fictional data) | `/os-preview/*`, outside the signed-in app; 404 in Production | `W/app/os-preview/layout.tsx` gate; excluded from the proxy matcher (`W/proxy.ts:76-80`) | Not part of the live app |

---

## 2.1 My Day, navigation, search, notifications

**Screens and what each shows (Finding A, section 2).**

`/` (My Day) is one server-rendered page with no role switch. Every block is shown only when the viewer's own session returns data for it, so a person holding several responsibilities gets all the blocks stacked (`W/app/(app)/page.tsx`). No block lets a person act in place; every row is a link to another screen.

| Order | Block (UI wording) | Shown when | Source | Notes |
|---|---|---|---|---|
| 0 | "Enginious wishes you a very Happy Birthday" | own date of birth is today | `employees` | |
| 1 | Hero: "Your updates for today: N items need your attention." or "Nothing needs your attention right now." | always | `buildActionItems` (`W/app/(app)/action-centre.tsx:17-57`) | Primary button: first of "Review approvals (N)", "Add employee", "Request leave", "Browse employees" (`page.tsx:265-272`) |
| 2 | Weather, date, time | always | `W/lib/weather.ts` (external, 3 s abort) | Dubai time zone for HR and C-level, own country otherwise (`:344-351`) |
| 3 | "Today at a glance": Active projects, Open enquiries, Decisions waiting, Live equipment requests | each card only with that module's access; "Decisions waiting" always | `loadPortfolio`, `loadSalesToday`, `approvals`, `loadEquipment` | |
| 4 | "Needs your decision" (empty text "Nothing is waiting on you. New approvals, handovers and reviews show up here.") | always | `approvals` where `approver_id = me` and pending; `proj_handovers`; task review queue; under "Also open": overdue tasks, tasks due in the next 7 days, unread discussion messages (`W/lib/projects/my-day.ts:15-21`, `my-work.ts:84-107`) | Counts only, no titles. Approval rows queued to a role (no named approver) are not counted (F-A-12) |
| 5 | Attendance clock card | person has an employee record | RPC `recovery_live_summary` | Buttons link to `/attendance-clock` |
| 6 | People today (live clocked-in count by work mode) | hr_admin, ceo or cto in any company (`D/permissions/alerts.ts:31`) | `attendance_sessions`, `attendance_segments` | |
| 7 | Next dispatch | Inventory grant or `pm_user_id` PM | `loadRequestList` | |
| 8 | Delivery this week (Mon-Sun bars, milestones, up to 5 projects) | any Projects grant | `proj_plan_items`, `proj_milestones` for projects where the person is member or founder | |
| 9 | Sales pipeline (stage bars, "Your next follow-ups", max 3) | any Sales grant | `loadOpportunities`, `loadFollowUps` (own follow-ups only, `W/lib/crm/my-day.ts:32`) | |
| 10 | Project status donut (On track / At risk / Blocked) | any Projects grant | `proj_tasks`, `proj_milestones`; rule printed on the card (`portfolio.ts:24-34`): Blocked = an open task has `blocked_at`; At risk = open task or milestone past due | Counts only: no project names, no list |
| 11 | People & HR today (employees, recorded present, on leave, leave requests in review, per-company table, holidays, birthdays, HR attention, quick actions) | hr_admin, ceo or cto; per-company numbers only for companies where `canViewCompanyOverview` | `getCompanySnapshot` (`dashboard-data.ts`), contracts, documents, holidays | Some tiles link to the viewer's own pages (F-F-06) |
| 12 | "Coming soon to ENGINIOUS OS: Vendors & Purchasing and KPIs." | always | none | |

What each kind of person sees follows from those conditions (Finding A, 2b). An ordinary employee with no grants sees the hero, the stat row with only "Decisions waiting 0", the empty Decisions card and the clock card. A line manager gains the Approvals sidebar link and an approvals count, but no team card. A Finance person (role `finance`, not hr_admin) sees no card for budgets awaiting a decision; budget decisions are reachable only through Finance > Project budgets. A CEO or CTO sees the HR block and People today from the role alone; project health, delivery and pipeline appear only if they also hold Projects or Sales grants (those are separate tables, `W/lib/projects/context.ts:1-26`).

**Navigation (Finding A, 2c; real output in `findings/nav-matrix-raw.txt`).** The sidebar is built by the pure function `buildNavModules` in `W/components/nav/nav-groups.ts`. Nav gates are cosmetic; enforcement is in 2.8 and the module sections.

| Sidebar row | Gate | Contents |
|---|---|---|
| My Day `/` | everyone | none |
| Approvals `/approvals` | a pending approval with `approver_id = me`, or any of line_manager, hr_admin, finance, ceo, cto (any scope) (`nav-groups.ts:118-130`) | none. Boolean only: no count badge |
| Sales & CRM `/sales/follow-ups` | any `crm_company_grants` row (`:134`) | Follow-ups, Enquiries, Reports; secondary: New enquiry, Clients & contacts, Proposals & quotes, Pipeline board; "Manage": Settings |
| People & HR `/employees` | everyone | Me: My Profile, My Attendance Clock. People: Employees, Attendance, Leave, Reimbursements. Workflow: Alerts (HR, CEO, CTO), Letters, Payroll (HR, Finance, CEO, CTO). Organisation: Assets (HR, Finance), Policies, Holidays, Companies (System Administrator). Insights (HR Admin, System Administrator): AI Suggestions, Audit Log. Access: People & Access |
| Projects & Tasks `/projects/work` or `/projects` | any Projects grant, or a Sales link on a project (`:224-252`) | My Work, Projects, Calendar; secondary New internal project; "Manage": Handovers |
| Inventory `/inventory` | Inventory grantee, or `pm_user_id` PM, or linked employee; else a "Coming soon" row | see 2.4 |
| Finance `/finance/project-budgets` | own `pbx_company_grants` row with finance, view or executive_approver (`:291-299`) | Project budgets |
| Vendors & Purchasing | everyone | "Coming soon", no link |
| KPIs & Performance `/performance` | everyone | "Performance reviews (HR)" (which is the personal My Performance page for everybody) |

Facts from the nav matrix: an ordinary employee has 5 rows (My Day, People & HR, Inventory with one link "My equipment", Vendors & Purchasing as "Coming soon", KPIs & Performance). Several different working roles produce an identical sidebar: a programmer, a technician, a marketing person and a content person (no such roles exist; each is an employee with a Projects grant who is added to a project) all see the same rows. A department head with `request_for_employees` sees Inventory with Today, Stock, Requests and My equipment.

Other shell elements: header breadcrumb, command palette button, `ClockChip` for employees, an Alerts bell with no count for HR and C-level hidden below the `lg` breakpoint (`shell-chrome.tsx:87,165-169`), theme toggle. The mobile bottom bar has My Day, Sales (grant only), Clock (employees), People and More; there is no Approvals, Projects or Inventory tab (`shell-chrome.tsx:186-211`). The user menu holds name, role badges, "Account & security", theme and Sign out (`W/components/nav/user-menu.tsx:432-461`). The Sales module tab bar is mobile only (`W/app/(app)/sales/layout.tsx:34-38`).

**Search.** The command palette lists only page labels the person can already see, including secondary links. It never searches records. All record search is inside one module (Table 2.0 row 2). Employees cannot be found by ordinary staff: `employees_select` shows an ordinary employee only their own row plus reports (`M/20261018000000_cto_role_parity.sql:152-165`); names exist only in pickers (`proj_people`, `inv_employee_lookup`).

**Notifications.** See the model in 2.11.

**What works well and should not be disturbed (2.1)**
* Each My Day block is gated by data the viewer's own session can read, so RLS decides what is visible; a failure in one card usually does not blank the others (Finding H, 5.1).
* The cards with an explicit error state: portfolio ("—" with "Could not be loaded"), Sales, equipment, People today, the HR block warning "Some workforce data couldn't be loaded".
* The printed rule for Project status (Blocked, At risk, On track) on the card itself.
* `buildNavModules` is a pure function with a real evaluated matrix; the nav and breadcrumb derive from the same module data.
* A skip link and landmark labels exist (`W/components/nav/app-shell.tsx:53`, `shell-chrome.tsx:107`).

---

## 2.2 Sales, follow-ups, proposals, handover

**Access model (Finding B, 4.1).** Access is the `crm_company_grants` table only. Founder, HR Admin, Finance, CEO and System Administrator roles confer no Sales access (`D/permissions/crm.ts` header, `W/lib/crm/context.ts:35-40`). Every table is read-only to the browser; writes go through SECURITY DEFINER functions.

| Action | Who | Enforced by |
|---|---|---|
| See the module | any active Sales grant | nav, `W/app/(app)/sales/layout.tsx:18-24`, RLS `crm_has_access(company_id)` |
| Read every enquiry of the company, including value, budget note, payment terms | any grantee of that company, not only the owner | RLS `<table>_select using (crm_has_access(company_id))` (`M/20261115000100:456`) |
| Read organisations and contacts | any grantee of any company | `crm_has_any_access()` (`:444-447`) |
| Create an enquiry | any grantee (owner = self unless `assign_owner` or founder) | `crm_create_opportunity` (`M/20261115000200:222`) |
| Edit, move stage, hold, Won, Lost, proposals, Zoho references | enquiry owner or Sales founder | `crm_require_owner_or_founder`; UI mirror `canEditOpportunity` |
| Add note, file, follow-up | any grantee | `crm_lock_opportunity` |
| Complete, reschedule, cancel a follow-up | assignee, enquiry owner or founder | `crm_require_follow_up_actor` |
| Reassign owner | `assign_owner` or founder | `crm_assign_owner` |
| Decide a commercial approval | founder only, and only when the company policy is "required" (default "not configured": nothing can be requested or decided) | `crm_request_approval`, `crm_decide_approval` |
| Prepare, submit or withdraw the Projects handover | enquiry owner or Sales founder, while Won | `proj_save_handover`, `proj_submit_handover`, `proj_withdraw_handover` |

**Screens.** `/sales/follow-ups` (landing: To do Overdue/Today/Upcoming, Recently completed, "Needs attention", Mine/Everyone); `/sales/opportunities` (Enquiries, table or board, side panel `?open=ID`, quick add `?add=1`); `/sales/opportunities/[id]` (tabs Overview, Scope & dates, Activity & history, Proposals & files, Commercial); `/close`; `/handover`; `/sales/new` (full form, 21 controls in 6 cards); `/sales/clients`; `/sales/proposals`; `/sales/reports` (9 cards); `/sales/settings` (founders and `manage_settings`). Full table: Finding B, section 2.

**Stages and statuses (from code).** Enquiry stage: New enquiry, Qualified, Proposal preparation, Proposal sent, Quote sent, Negotiation, On hold, Won, Lost (`D/crmStages.ts:9-19`); closing requires `closed_at` (`M/20261115000100:131`). Follow-up: open, done, cancelled. Proposal: draft, sent, superseded, accepted. Quotes and invoices are made in Zoho Books; the app stores Zoho references only (`crm_zoho_references`, Commercial tab).

**Create an enquiry (the path the nav offers).** Sales & CRM lands on Follow-ups; "Add enquiry" opens a dialog (`W/components/sales/quick-add-enquiry-form.tsx`). The person supplies 4 required fields ("What is the enquiry?", Agency or End client, "Where did it come from?", "Next action"); Due defaults to today; owner is self, type Call, stage New. 11 optional controls sit behind "Add more details". A duplicate warning runs 700 ms after organisation, date or location is given. Minimum 7 actions on one screen (Finding B, P4). If the owner is someone other than the creator, nobody is notified: `crm_create_opportunity` writes only the follow-up and the "created" event; the owner finds it on Follow-ups, in My Day counts when due, and in the Sales in-app reminders (below).

**Follow-ups.** Three different dialogs exist: Complete a scheduled call (What happened, next-step radio, next action, date with no default); Add follow-up on an enquiry (what, date with no default, time, type, assignee); Add update (kind, what happened, internal-note flag), which does not touch follow-ups (Finding B, P4). Sales reminders live in the Sales-only table `crm_reminders` (follow-up due or overdue, hold review, no next action), generated by `crm_generate_reminders` from the daily job and also on demand, throttled to once per 5 minutes per server instance, when someone opens Follow-ups (`W/lib/crm/reminders.ts:70-85`). E-mail for reminders is off unless `CRM_REMINDER_EMAILS=on` and `CRM_REMINDER_FROM_EMAIL` are set (`reminders.ts:15-17`).

**Proposals and files.** Proposal versions are recorded per enquiry (`crm_add_proposal`, `crm_set_proposal_status`) and listed across enquiries at `/sales/proposals`. Files go through upload intents (`W/lib/actions/crmFiles.ts`). Commercial approval exists but is off by default (above).

**Won, then the handover: the single working handover, step by step (Finding B, "Won -> handover").**

| # | Who | Screen and action | What the system does |
|---|---|---|---|
| 1 | Enquiry owner or Sales founder | Enquiry > "Close as won" (button, More menu or board drop). Fields: Type of confirmation (default Purchase order), PO number or e-mail reference (required), Date on the document (required, not in the future), Note. A confirmed value must already be set | `crm_mark_won`: stage Won; evidence stored; `crm_closures` row; **open follow-ups cancelled**; a legacy `crm_handovers` draft row inserted; event logged. **No notification and no redirect.** The page says "Nothing is sent to anyone" (`close-form.tsx`). From a dialog or the board the person stays where they were (`W/lib/actions/crm.ts:208-218`) |
| 2 | Owner | Enquiry > "Handover package" (alert, button or More menu) > `/sales/opportunities/[id]/handover` | The brief is prefilled at first save from the enquiry: title, client name, location, site time zone, installation, show start and end, scope, exclusions, technologies, risks, plus "Notes for the Project Manager". 11 editable fields; **scope is required to submit**. The form warns that everything is visible to project members, so no prices or PO details |
| 3 | Owner | "Save the delivery brief", then a separate "Submit the handover" button | `proj_save_handover` (Won stage, owner or founder), then `proj_submit_handover` (scope required). Submit notifies every Projects founder and every `assign_pm` holder (`project_handover_submitted`). Sales can keep editing until acceptance; withdraw needs a reason |
| 4 | Projects founder or `assign_pm` holder | Notice in My Work "Project notices", bar "handover waiting on you" on My Work, My Day row, "Needs you" strip on Projects, "Handovers" nav link. Projects > Handovers > "Assign Project Manager" (select from Projects grant holders) | `proj_assign_handover_pm` notifies the PM (`project_handover_assigned`) |
| 5 | Named Project Manager | Same signals; reads the brief on Handovers, then "Accept and create the project" or "Ask Sales to clarify instead" (note required) | Clarification sets `clarification_requested` and notifies the Sales owner and preparer |
| 6 | Project Manager | "Accept and create the project" | `proj_accept_handover`: serialised; exactly one project per enquiry; the enquiry must still be Won; creates `proj_projects` (kind client, status Planning, reference `<code>-P-<year>-<nnnn>`, PM), `proj_project_details`, the PM as member, **Sales links for the owner and the preparer**; freezes the handover (a trigger blocks later change); notifies the Sales owner and preparer (`project_handover_accepted`). A founder must first have set the company project code or it fails |
| 7 | Project Manager | Redirect to the project's Work tab | Empty task list; details card (client, location, dates); "Agreed scope" card (scope, exclusions, technologies); no milestones, team, files; the PM is the only member. The brief's Notes show only on the History tab; risks show only on the Handovers page; client contacts, Sales files and proposals are never transferred (commercial data stays in Sales by design). The Equipment tab offers "Import from handover" (technologies) |
| 8 | Sales owner | Afterwards | Summary level of the project (reference, name, status, PM, dates, handover status) through the Sales link. A Sales person with no Projects grant gets a one-link "Projects" module |

Handover status machine: `draft -> submitted -> pm_assigned <-> clarification_requested -> accepted`, plus `withdrawn` (`M/20261120000100:117-118`). The PM no longer has the Handovers link after acceptance (`pendingHandovers` counts only submitted or pm_assigned). A legacy handover function `crm_update_handover` is still executable by owner or founder although the Sales page hides its form when Projects is installed (Finding B, F-B-20; from code).

**What works well and should not be disturbed (2.2)**
* The single Sales-to-Projects handover: one project per enquiry, serialised, frozen on acceptance, with commercial data kept out (a hard boundary).
* Server-side ownership rules: only the owner or a founder can move an enquiry; every control has a matching function check (no hidden-but-open control found).
* The quick-add dialog's silent defaults and the duplicate warning.
* The Sales in-app reminders table and its follow-up screen; the board and side panel.
* Zoho Books stays the quote and invoice tool; the app stores references only.
* `LoadError` in the Sales layout on a failed read (`W/app/(app)/sales/layout.tsx`).

---

## 2.3 Projects

**Access model (Finding B, 4.2-4.3).** All relationship checks are SQL (`M/20261120000100_proj_core_tables.sql:336-460`).

| Relationship | Meaning | Gives |
|---|---|---|
| Projects grant (`proj_company_grants`, capabilities may be empty) | Prerequisite to take part (`proj_user_eligible`: active profile and a Projects grant, or a Sales link plus a Sales grant) | Summary of every live project in the company (reference, name, PM, status, dates) |
| Founder | capability `founder` | Details of every project; manage |
| Member | active `proj_project_members` row, still eligible (includes PM, acting PM, department heads) | Details: tasks, plan, discussion, files (not restricted), feedback, scope changes, history, people |
| Project Manager / acting PM | `pm_user_id` or an unexpired `acting_pm` row | Manage: scope fields, members, teams, milestones, deliverables, bookings, feedback, scope proposals, status, completion |
| Department head | member who is `head_user_id` of an active `proj_teams` row | Create and reassign tasks within own team, review team tasks, accept team deliverables, book own team on site. The team's optional `department_id` is "for display only; never used to authorise anything" (`...0100:72`); there is no link to the line manager or HR department |
| Assignee | task assignee and active member | Change own task status and details, block it, comment |
| Sales-linked | `proj_sales_links` plus a still-active Sales grant | Summary and handover status only |

There is no Technician, Programmer, Engineer or Content role in the app, domain or SQL (searched `technician|programmer|engineer|content staff`). Such people are employees with a Projects grant who are added as members.

**Project status machine.** `planning, in_progress, ready_for_installation, on_site, on_hold, completed, archived` (`M/20261120000100:21-22`); internal projects may be flagged "ongoing" and are never forced through installation or show states (`:40`).

**Tasks (Finding B, P2).**
* Status: `todo, in_progress, ready_for_review, done, cancelled, deferred` (`:211-215`). Blocked is a flag with a reason, not a status; it needs a named person or an action to unblock; a blocked task cannot be marked Done.
* Create: any member for themselves; a department head for their team; the PM for anyone. The assignee must be an active member. A member asking to assign work to others gets: "You can create tasks for yourself. Ask your department head or the Project Manager to assign work to others."
* Update status (routine task): the status control, 2 clicks, saved at once. Review-required task: "Send for review…" then confirm (3 clicks).
* Block: My Work > open task > More > "Block task" > "What is blocking it" (required) plus either "Who can unblock it" or "Or what action will unblock it" > "Mark as blocked" (4 clicks, 2 fields). Only the assignee, team head or PM can block; clear by those or the named unblocker.
* Collaborators (`proj_task_collaborators`) and dependencies (`proj_task_dependencies`) exist. There are no subtasks (searched `parent_task`, `subtask`: `proj_tasks` has no parent column).
* Task views: My Work (My open tasks, My team, Overdue, Waiting for my review, My projects, handovers waiting, Project notices); project Work tab (stat cards, table or board, this-week list, review queue, milestone strip, "Needs action" card, "Next on site", details and agreed scope); a task panel and a full task page (`work/tasks/[taskId]`).
* My Work has no Blocked filter or stat card (`W/lib/projects/work-logic.ts:88` shows mine, team, overdue, review).

**Reviews.** The Project Manager or a department head marks a task "needs review". The assignee sends it for review; the reviewer is the head of the task's team, else the PM (`proj_notify ... project_review_requested`, `...000300:644`). A review-required task is finished only by a PM or head who is not the assignee (`proj_set_task_status`). The reviewer sees "Waiting for my review" on My Work and a My Day row "Project task(s) waiting for your review". A rejected review notifies the assignee (`project_review_result`). Self-notification is suppressed (`proj_notify` returns when the recipient is the actor).

**Timelines.** Tab "Timeline" (`/projects/[id]/plan`; legacy `/timeline` and `/calendar` redirect): a Delivery plan and a Site plan (table or calendar), dependencies on others (structure ready, power and network, access permitted, standbuilder), conflict check, suggested templates (Table 2.0 row 14), and milestones, deliverables (collapsible on the Work tab). A client-facing flag marks what may be issued; issued client timelines are versioned (2.0 row 13). Milestone statuses: `planned, in_progress, ready_for_acceptance, accepted, cancelled, deferred`; deliverable statuses: `open, in_progress, ready_for_review, accepted, cancelled, deferred`.

**Site bookings (what exists, verified).** On the Timeline tab, "Site plan" section "Site bookings": location, start and end in the site time zone, preparation and travel allowance before and after, tentative or confirmed or cancelled, notes, optional link to a site activity. Rules in SQL: only the PM or the head of the booked person's team can book or confirm (`proj_can_book`); the booked person must be a project member; overlapping confirmed bookings (including allowances) across every project are refused unless the person holds `override_site_conflict`, who must give a reason (`proj_confirm_booking`). Saving and confirming notify the booked person (`project_assignment`, `project_deadline_changed`), visible only in My Work "Project notices". **Not found anywhere (searched `venue`, `site_visit`, `site visit`, `site instruction`, `instructions`, `booking`):** a field or document purpose named "site instructions", or a marker for a current approved reference. Site information is spread over: Work-tab details card (location, time zone, installation and event dates), "Agreed scope", Site plan notes and dependencies, "Notes from Sales" on History, and Discussion (Finding B, P3: 5 to 8 clicks over 4 to 5 screens).

**Team assignment (Finding B, P5).** Order is forced: People & access > add person (select from people with a Projects grant, optional department; 2 selections and 1 click per person) > add team (name, department head who must hold a grant) > then deliverable > then task. For a team of three with three tasks about 30 interactions over three screens. The person must already hold a Projects grant; otherwise the SQL error reads "A founder gives them access first". Quick-add task defaults the assignee to the PM themself (`quick-add-task.tsx:21-24`). Each assignee gets `project_task_assigned` and `project_invitation` in "Project notices" only; My Day does not count new assignments.

**Discussion.** One thread per project, replies, mentions, jump-to-task, unread badge on the tab (`proj_messages`, `proj_post_message`). Mentions and replies notify (`project_mention`, `project_reply`) into "Project notices".

**Client feedback and scope changes (Finding B, P5).** "Manage project" > Feedback & changes. "Record feedback": who gave it, received on, what was asked, **Kind** (required, no default: "Correction to what was agreed" or "Proposed change to the scope"), relates to, responsible, deadline. "Propose a scope change": title, the whole scope as it would read (prefilled with the current scope), effect on dates (words), optional feedback link, optional cost effect (visible only with `view_commercial` or founder). The decider (`approve_scope` or founder) learns only by visiting the page: `proj_propose_scope_change` sends no notification. On approval the database replaces `proj_project_details.scope` with the proposed text and notifies the PM (`project_scope_decision`). **Nothing else changes**: no task, deliverable, milestone, equipment request, budget or date is touched or flagged (verified by searching every reader of `proj_scope_changes`: the changes page, `projectsClose.ts`, the migration). Roughly 14 interactions before any downstream work.

**Files.** "Files & client plan": flat list of files and links, newest first; purposes are Document, Feedback evidence, Completion evidence, Other (`documents/file-forms.tsx:17-22`); some files can be marked restricted. There is no approved or current marker, no version number and no supersede relation on files (verified: `proj_files` columns, `M/20261120000500:24-46`); the only versioned artefact is the issued client timeline.

**Internal projects for Marketing and Operations.** They run as `kind='internal'` projects created by an `assign_pm` holder or a Projects founder (`proj_create_internal_project`); the creator becomes PM; only Planning and In progress states are used; no handover, PO or Sales value; completion needs only a note. The built-in timeline templates are content-production specific; there are no task, milestone or team templates and no recurring work (Finding B, F-B-22).

**Completion.** Manager and live project: "Complete project" form (client confirmation, resolve unfinished items); `inv_proj_after_status` (`M/20261201000400:1953`) cancels draft and submitted equipment requests and releases unused reservations; dispatched equipment stays out (2.4).

**What works well and should not be disturbed (2.3)**
* Relationship-based access (member, PM, head, assignee, Sales-linked), enforced in SQL; the nav only mirrors it.
* The block-a-task dialog: required reason plus a named person or action; the blocked state feeds the project health card.
* Review independence: a review-required task is not closed by its own assignee.
* The site-booking overlap rule and the explicit override with reason.
* Scope change: original scope kept beside current; only a decider can approve; cost effect restricted.
* Optimistic concurrency with friendly wording: "This task was changed by someone else. Reload the page to see the latest version, then make your change again." (`W/lib/projects/action-utils.ts:50-54`).
* `LoadError` on My Work and project Work tab (`work/page.tsx:77-79`).

---

## 2.4 Inventory after the simplification

**Structure (Finding C, section 2).** Four working areas plus request pages. Nav source `W/components/nav/nav-groups.ts:254-290`.

| Area | Route | Who sees it | What it is |
|---|---|---|---|
| **Today** | `/inventory` | Inventory grantees (primary). A non-grantee PM is redirected to Requests; a plain employee to My equipment | The warehouse queue, one row per job: Prepare equipment, Send out, Receive returns (due within 7 days or late), Transfers on their way here, Sales checks. Filter "Show". Undated work sits under "Waiting, no date set": no deadline is invented (`W/lib/inventory/today.ts` header) |
| **Stock** | `/inventory/stock` | grantees, or a PM with `pm_user_id` | Item list with Available, Out, Reserved, Not counted; item and unit panels (`?open=`, `?unit=`, `?action=`); tab "With people" for custody readers. Header buttons: Receive stock, Give equipment; all other actions under "More actions" |
| **History** | `/inventory/history` | people who may see stock (`invStock`) or founders | The movement ledger, filters, "Check a transaction", correction (confirm_stock) in the panel |
| **Manage** (Setup) | `/inventory/manage` | catalogue managers and founders in nav; page also admits warehouse and confirm_stock | Checklist, locations and bins, categories, technology templates, counts, sharing, opening custody, rentals and legacy import |
| Requests | `/inventory/requests`, `/inventory/requests/[id]` | primary for a non-grantee PM; secondary for grantees | Request list; workspace with tabs 1 Prepare, 2 Send out, 3 Receive back (project), Prepare plus "Give equipment" (employee) |
| My equipment | `/inventory/mine` | plain employee primary; secondary for planners | Own equipment by RPC `inv_my_equipment`; "Overdue" flag |
| Scan, labels | `/inventory/scan`, `/inventory/labels` | secondary link "Scan a label"; labels linked from panels | QR landing; printable labels |
| Project Equipment tab | `/projects/[id]/equipment` | project members; PM manage controls | "Equipment still out", shortages, "Import from handover", requests, "Record a return" (warehouse, not a finished project) |

Old routes `/inventory/employees` and `/inventory/movements`, and old `?action=` links, redirect to the new places (`W/lib/inventory/legacy-redirect.ts:7-19`).

**Who can do what (Finding C, role-gating matrix).** Founder: everything. Warehouse operator: reserve, dispatch, return, issue, transfer, repair, check, adjust at assigned locations (or all with `cross_location`); enforced by `inv_loc()` then `inv_can_operate` in every movement function. `view_stock`: read only. `manage_catalogue`: catalogue, locations, technologies. `confirm_stock`: counts, corrections. `request_for_employees` (department head): new requests for employees. `view_employee_custody` (HR): custody lists. A Project Manager without a grant sees catalogue summary and availability counts (never units or locations of units), the requests of their own projects, and may create, edit, submit and cancel requests (`inv_can_edit_request`). A plain employee sees only own equipment. A PM, acting PM and team head count as managers in SQL, but the nav counts only `pm_user_id` PMs (`W/lib/inventory/context.ts:60`); an acting PM or team head sees only "My equipment" and "You do not have Inventory access" on Stock although RLS would allow browsing (Finding C; Finding G, mismatch 1).

**Request workspace (Finding C, P6 and P7).**
* **PM request:** project Equipment tab or Requests > "New equipment request". Nothing is required to create a draft; both dates ("Leaves the warehouse", "Due back") are needed to submit (`inv_submit_request`: "Set the planning dates (at least a start and an end)"). Hand-picked items cost 3 interactions each; "Add from a technology template" costs 4 interactions for N lines. "Submit to the warehouse". About 15 interactions for 3 hand-picked items. Request status: `draft, submitted, in_progress, fulfilled, cancelled, closed` (`M/20261201000200:55`).
* **Employee request:** needs `request_for_employees` or warehouse. "Expected back (optional)" is in fact needed to submit (F-C-02). The person who is the employee's line manager has no UI entry although SQL permits it.
* **Prepare:** per line "Reserve" (2 clicks per line, location defaults to pickup, "Pick free ones for me"); there is no "reserve all" (a disabled mock exists only in the design preview, `W/app/os-preview/inventory/project/[id]/page.tsx:133`).
* **Send out:** tab 2; warehouse and expected return carried from the request; tick units ("Tick all N of these"), type quantities for counted stock, Review, Confirm.
* **Receive back:** Today row or tab 3; tick each returned unit and choose a condition for each (required, nothing preselected); counted lines need quantity plus condition; Review, Confirm. Ten units plus two counted lines is 26 interactions with no bulk "all good". A second, older return screen (Stock > Return, or project page "Record a return") defaults condition to Good (`stock-candidates.ts:71`).
* No notification is sent when a request is submitted, prepared, sent or returned. The warehouse finds a submitted request on Today, Requests, or the My Day count "Live equipment requests"; the PM sees progress only by reopening the project Equipment page.

**Employee equipment.** Give: Stock > "Give equipment" (or With people), about 7 interactions. If units were reserved on the Prepare tab the issue is refused by the database (F-C-01). Return: Today row "Receive returns" (only if an expected date exists) or Stock > With people > "Receive returns"; condition defaults to Good. Overdue is a badge only; no reminder goes to the employee or the manager. The employee sees the item under My equipment when they next open it.

**Transfers.** See Table 2.0 row 9. Receiving is 3 interactions with "Everything on the way" preselected; the source warehouse sees no "in transit" row and the dispatcher is not told it was received (Finding C, P7b).

**Held units (damaged or needs checking).** There is no separate "held" flag: held means an active unit on the shelf whose condition is not good or fair; counted stock held means a balance row whose condition is not good (`M/20261201000100:161-163,223`). The database does not inspect: a return with condition `good` makes the unit available at once; the protection is the screens. Release is Stock > open unit > More actions > "Check condition" by any operator at that location; no inspector role, no approval, no queue, no Today row (about 9 interactions per unit).

**The reservation, dispatch, return data limits (Finding C section "6", Finding D F-D-01).** These are facts of the data model that any new design must respect.
* A request line owns its reservations (`inv_reservations.request_line_id`).
* **Dispatch** (`inv_dispatch_to_project`, `M/20261201000300:1860`) links to the request at **header level only** (`request_id` on the movement). Lines carry a unit id, or item id and quantity. Matching to reservations is by request plus item (plus unit), so two lines of the same item in one request are interchangeable (`W/lib/inventory/workspace.ts:40`). Dispatch with no request is allowed for unreserved items and shows as "unlinked" in `inv_project_equipment`. The dispatch movement has **no destination text, no receiver and no Project Manager id**; `exception_note` is never written (`:1911-1912`). `occurred_at` and `recorded_at` are both server time: no backdating.
* **Return** (`inv_return_from_project`, `:1953`) takes **no request and no line**: the header holds only project, location and note. A return is attributed to the oldest active reservation of that project and item (`inv_reservation_return`, `:654-675`), and the status of every open request of the project is then recomputed. Counted returns are therefore attributed to the oldest reservation, not to the request that physically sent them.
* The app shows this honestly: units are exact and named; counted "returned for this request" is shown only when one line exists, no other request sent that item, and held equals sent minus returned (`workspace.ts:190-195`, "Project level" rows).
* A Project Manager without a stock grant **cannot read any movement row**: RLS on `inv_movements`, `inv_movement_lines`, `inv_units`, `inv_balances` is `inv_can_view_stock` (warehouse or view_stock). What a PM can read is `inv_project_equipment(project_id)` (SECURITY DEFINER; it returns unit code and serial number) and the request, line and reservation tables through project membership. A client-side query of the ledger as a PM returns zero rows silently (Finding D, section 4).
* A project-to-project transfer can be recorded by any person who may manage both projects, not only the warehouse (`M/20261201000700:19-24`).
* Ledger corrections are a separate movement kind (`correction`) that must name the corrected movement and a non-blank reason; the ledger is not edited (`M/20261201000100:311`).
* Booking conflicts: the reservation range is `[needed_from, needed_until]` over an exclusion constraint on `reserved_during`; preparation, install, dismantle and inspection time are part of the booking window (`inv_plan_window`, `M/20261201000400:116-165`). No buffer is applied automatically after a return. A unit that is overdue is never offered as free (`inv_unit_free`).
* Cancellation and completion: cancelling releases unused reservations but keeps dispatched quantities active, so equipment still out of a cancelled request still returns through the same functions (`inv_cancel_request_internal`, `M/20261201000400:773-792`). Project completion cancels draft and submitted requests; dispatched equipment stays out and the warehouse can still record returns.

**What works well and should not be disturbed (2.4)**
* Booking conflicts and movement history (hard boundaries): the exclusion constraint, the ledger with correction-by-new-movement, idempotency key on every movement.
* `LoadError` and per-source failure banners: Today says "Equipment requests could not be loaded. The list below may be missing them; it is not an empty queue." (`today.ts:failureMessage`); the same on Stock, Requests, History, Manage, My equipment, With people, the Project Equipment tab and the My Day card.
* Today: rows built only from a record's own data, no invented deadlines; work described in lines and items, never added across units.
* The honest "Project level" rows rather than a guessed split of counted returns.
* The Send out and Receive back steps with Review then Confirm; the warehouse remembered in a cookie.
* Held units are kept out of availability by the SQL rule `inv_unit_usable` and the UI mirrors it.
* Redirects from old Inventory addresses.

---

## 2.5 Project budgets, actual expenses, funding, settlement

**Access model (Finding E, 4).** The Budget module has its own grant table `pbx_company_grants` with capabilities `finance`, `view`, `executive_approver`, `manage_access`. A founder title, the HR `finance` role, Projects membership, System Administrator or CEO or CTO titles confer nothing here (RLS test `packages/rls-tests/test/project_budget.rls.test.ts:173`). There are two different "Finance" concepts: the HR role (payroll step 1, C-level claims, Assets and Approvals links) and the budget grant; granting one does not grant the other. The Project Manager (or acting PM) prepares and submits; Finance approves; if the submitter holds Finance, the route is the executive approver (CEO or CTO holder of `executive_approver`).

**Screens.**

| Route | Who | What |
|---|---|---|
| `/projects/[id]/budget` (tab "Budget & Expenses") | PM, acting PM, budget grantees, or a former submitter (`pbx_project_access().can_open`) | Header badges, 4-figure summary, "Next:" sentence, tabs Budget, Funds, Actual expenses, Settlement (Funds and Settlement for full readers) |
| `/finance/project-budgets` | any person with a budget grant of finance, view or executive_approver | Finance inbox: Budget approvals, Final expense approvals, Outstanding settlement |
| `/finance/project-budgets/[projectId]` | via inbox rows | The same workspace plus record controls |

**Budget (Finding E, P8).** PM creates a budget (currency prefilled from the company, irreversible), adds lines in six default categories (Food, Transport, Contractor badges / access, Accommodation, Truck / logistics, Other expenses) plus company categories added by Finance. Calculation bases: fixed, per person, per person per day, per trip, per km, quantity x rate; rounded once per line, half away from zero, to the currency's decimals (31 domain tests pass). Rates: petrol per km and meal per person, per company and currency, set by Finance. One currency per budget; no conversion. No contingency or VAT (searched). No duplicate-line, copy or template. A 10-line budget is about 30 to 60 interactions. "Submit for approval" saves and submits in one action.

**Statuses (from migration guards).**
* Budget version: `draft -> submitted | discarded`; `submitted -> approved | returned | rejected`. One open version per budget; additions are separate versions holding only the increment. Returned or rejected versions are revised into a new draft copy; approved is never edited.
* Final expenses: `draft -> submitted`; `submitted -> approved | returned`; `approved -> returned` (audited send-back by Finance or the route approver).
* Funding and payments: `recorded -> reversed` only, reason mandatory; never edited or deleted.
* Receipts: `not_received | partial | received | exception` (exception needs a reason).
* Settlement: `open -> closed` (blockers empty) and `closed -> open` (reopen with reason). "On hold" is not a status: an item is on hold when no independent approver exists for its route.

**Funding.** Finance records money handed to the PM or a project member (cash, bank transfer, Pluto, other). Cash or bank is an advance the person accounts for; Pluto or card is spending power, never owed back. Flagged `self_declared` when the recorder is the recipient.

**Actual expenses.** Not a stream of entries. After the budget is approved the PM starts **one** final-expenses submission whose lines are the approved budget rows. Per non-zero line: How was it paid, Who paid, claim link or note (2 to 3 required interactions); a variance note is required if the total differs by more than 10% from the approved budget. Receipts are physical and handed to Finance in person ("Receipts are handed to Finance in person; nothing is uploaded here"): the receipt boundary is untouched.

**Settlement.** On the record's Settlement tab Finance records receipts, money returned and reimbursements paid, then "Confirm reconciliation and close". Closing requires approved final expenses, no pending decision, receipts received or an approved exception, advance balances returned, reimbursements fully recorded, no overpayment. On the executive route the CEO or CTO approver must also confirm the receipts and authorise closure. No money moves in the system: "This only records that money moved. Nothing is paid, deducted from payroll or sent to a bank" (`W/components/budget/settlement-section.tsx:140`). Employee claims are paid through the separate `/reimbursements` flow (picked up by the payroll export), not through this module.

**Independence (enforced in SQL).** The preparer or submitter cannot decide, confirm or close the same item (`pbx_decide_budget`, `pbx_version_guard`, `pbx_actual_submission_guard`); the receipts recorder cannot confirm receipts; no self-grant of access, and only an executive approver may add or remove that right (`M/20261215000000_access_grant_rules.sql`).

**Notifications.** `pbx_submit_budget` and the decision functions write `notifications` rows (`project_budget_submitted`, `project_budget_decided`, `project_funding_recorded`, `project_actuals_*`, `project_settlement_closed`). They display only in "Project notices" on My Work, and `proj_my_notifications` hides them from anyone who is not a participant of the project (`M/20261120000400:914`); the page returns early for people with no Projects grant (`W/app/(app)/projects/work/page.tsx:50`). A Finance or CEO or CTO approver who is not a project participant therefore never sees the notice (F-E-01, F-A-10). `pbx_record_receipts` and `pbx_record_payment` send no notice. No budget row appears on My Day. No e-mail.

**Reports and exports.** None (searched export, csv, print, download, pdf in budget and finance code).

**What works well and should not be disturbed (2.5)**
* The independent-approval rules and the separate grant table (hard boundary).
* The double-click protection: a per-click `requestId`, the button disabled while pending, the same id kept on failure so a retry cannot double-record (`W/components/budget/shared.tsx:52-65`); optimistic `row_version` with plain wording ("This was changed by someone else since you opened it. Reload ... Nothing of yours was saved.").
* The discriminated read result `not_installed | denied | error | ok` with `LoadError` (`W/lib/budget/data.ts`).
* Rounding once per line and refusal (not silent rounding) of over-scale inputs.
* Reversal instead of edit or delete for funding and payments; the audit log `pbx_audit_log`.
* The physical receipts rule and the "no money moves" wording.

---

## 2.6 Approvals

**`/approvals` (Finding E section 2; Finding F section 5.2).** One page showing the viewer's own decision queue, as cards per type. The nav row appears when the person has a pending approval with `approver_id = me` or holds line_manager, hr_admin, finance, ceo or cto (any scope).

**What IS in `/approvals`** (`approvals.entity_type`): `leave_request`, `reimbursement_claim`, `timesheet`, `generated_letter`, `payroll_export_run`, `recovery_credit`; plus, for HR only, "Unresolved recovery credit routing".

**What is NOT in `/approvals`** (verified from the entity list, the page queries and the Budget state machine):
* project budgets, additional budget requests, final expenses, receipt confirmation and settlement closure (Finance inbox, own `pbx_*` state machine);
* task reviews (My Work "Waiting for my review");
* Sales-to-Projects handover steps (Projects > Handovers);
* project scope-change decisions (Feedback & changes);
* Sales commercial approvals (`crm_approvals`, enquiry Commercial tab; off by default);
* inventory substitution decisions (`inv_decide_substitution`, on the request).

**The separate Finance inbox.** `/finance/project-budgets` (2.5) lists three queues (budget approvals, final-expense approvals, outstanding settlement) from `pbx_inbox()`, company scoped. It is never merged into `/approvals`. A person who is CEO and also a budget approver checks `/approvals`, the Finance inbox and My Day separately (Finding E, P11).

**How routing works.** `approval_workflows` and `approval_workflow_steps` are seeded per company and read by `resolve_approver(type, employee)`: `direct_manager` (the employee's manager, if not terminated), `manager_of_manager`, `role:*`; payroll uses `resolve_approver_for_company`. Role steps pick one person (`order by granted_at asc limit 1`). Chain: Leave and claims and timesheets: direct manager. Letters: `role:ceo`. Payroll export: `role:finance` then `role:ceo`. A CEO or CTO applicant is auto-approved for leave (`W/lib/actions/approvals.ts:70-72`). An employee with no manager gets "No approver could be resolved ... Contact HR Admin." and cannot submit. Recovery Leave credit routing is described in 2.7.

**Decision rules.** `decide_leave_approval(approval, decision, comments)` (the entity-generic decision function) requires `approver_id = auth.uid()`, or a queue role in the request's company and not the beneficiary; it locks the row and refuses "This approval has already been decided" (`M/20261108000000...:3441-3541`). A leave row shows employee, type, dates, days, reason, one "Insufficient balance" badge; Approve takes a native confirm dialog (2 interactions); Reject takes an optional reason (3 interactions; reason not required here, unlike budgets). No approve comment, no bulk action, no age or date shown, no delegation, no reassignment, no escalation (searched `delegat`, `escalat`, `reassign`, `out_of_office`, `acting_approver`). A stuck request can only be cancelled and resubmitted by the requester; HR can read the row but not reassign it.

**Status values.** Approval `decision`: pending, approved, rejected, skipped. Leave, claim and timesheet `status`: draft, submitted, pending_approval, approved, rejected, cancelled (`M/20260926000000:31-35`).

**What works well and should not be disturbed (2.6)**
* Database protection of decisions: row lock, assigned-approver check, already-decided refusal; a stale or double-clicked Approve is safe.
* Self-approval skipped or blocked (`decide_leave_approval`, `create_initial_approval`); independence for budgets.
* One merged page for everything routed to a person (own rows plus eligible queue rows), filtered by `queueDecisionEligible`.
* Seeded default workflows per company (`companies_seed_default_leave_workflow`, `M/20260926000000:177-203`).
* Approve and reject buttons disabled while pending (`decision-buttons.tsx`).

---

## 2.7 People & HR

Nothing here describes or proposes any change to attendance, Recovery Leave, leave-balance or payroll calculations; Recovery Leave is documented only.

**Roles and scope (Finding F, 4.1).** Seven roles: employee, line_manager (shown as "Reporting Manager"), hr_admin, finance, ceo, cto, sys_admin (`D/roles.ts`). Grants are `user_roles(user_id, role, company_id, country_code, revoked_at)`; a null company or country means all. SQL `has_role(role, company, country)` matches only if the grant covers the scope passed; with no scope passed only unscoped grants match. Three checking styles exist: company-scoped (most HR data); country-wide (policies, holidays: only an HR Admin grant with no company scope passes); any-scope (AI drafts, audit log nav, Assets nav). The `line_manager` role is a flag used for the Approvals link and recovery routing; the real manager relationship is `employees.manager_id` through `is_manager_of()` (a recursive chain). Job titles are not permissions. The `employee` role confers nothing.

**Profiles (`/employees`, `/employees/[id]`, `/profile`).** The list shows name, job title, company, status, with search (name, e-mail), company and status filters, 20 per page; the caption varies by role ("Everyone you administer." / "Everyone in your company." / "You and the people who report to you."). RLS `employees_select`: HR and System Administrator of the company, self, `is_manager_of`, finance, ceo, cto of that company. A System Administrator sees every employee of every company. `/employees/new`: 15 inputs (10 required) including first contract, salary and opening leave balances (`W/app/(app)/employees/new/new-employee-form.tsx`). `/employees/[id]` shows tabs only where the viewer's `can*` allows: Overview, Employment, Compensation, Leave, Attendance, Documents, Insurance & Loans, Assets, Performance; an unreachable `?tab=` falls back to Overview (`:129`). The profile applies "direct report only" for managers while RLS accepts the chain (F-F-23); a skip-level manager sees the person in the list but only the Overview tab. Self may edit personal e-mail and phone only (`employees_guard_self_update`). `/profile` redirects to the person's own page.

**Leave.** `/leave` shows one card per leave type with a ledger row plus a card labelled "Comp-off" (this is the Recovery Leave balance; `W/app/(app)/leave/page.tsx:80`), and "My requests" with status and Cancel. `/leave/new`: start, end, leave type (required), half-day start and end, reason (optional); the form shows neither the balance for the chosen type nor who will approve. Submission is one transaction (`submit_leave_request`); approval step 1 is the direct manager; HR Admins, CEOs, CTOs and the manager are e-mailed through Microsoft Graph, best effort (`W/lib/email/leave-notifications.ts:88-131`); employee e-mailed on decision. Final approval posts ledger deductions per `deduction_priority_rules`. Recovery Leave type refuses if the comp-day funding cannot cover it; annual and sick types can go negative (`M/20261108:3730-3742`). An overlapping leave request is stopped by the exclusion constraint `leave_requests_no_overlap` (`M/20261028000000:35`). Views `leave_balances` and `comp_day_balances` are `security_invoker`, so the ledgers' RLS decides what a caller sums (`M/20261112000000`). There is no team or company leave list: the only readers of `leave_requests` are the per-employee Leave tab, the viewer's own `/leave`, the approver's queue, a My Day count and the e-mail helper (Finding F, F-07). The `leave_ledger` and `comp_day_ledger` are never read by any screen (verified: only inserts and cron or AI reads).

**Recovery Leave (document only).** Earned through the attendance clock and attendance windows; the `comp_day_ledger` is the "Net Recovery Leave balance" (view comment `M/20261112000000:70-71`). Credits are created by a background processor (`recovery_process_due`), not by the employee; the route is snapshotted per applicant (`recovery_route_for_employee`): ordinary employee with a named project lead goes to project lead then HR Admin; a line manager goes to HR Admin; an HR Admin applicant goes to a shared CEO and CTO queue; an employee who names themselves lead goes to HR Admin ("independent review"); none named holds the request as `awaiting_project_lead`. Approvals labels: "Project lead -> HR", "Manager -> HR", "Shared CEO/CTO queue", "Self-led -> HR (independent review)" (`W/app/(app)/approvals/page.tsx:310-315`). The employee sees pending earning requests only on the profile Leave tab ("Recovery Leave earning (Reporting Manager -> HR Admin approval)"), and window status words on the My Day clock card, which says it is "not part of your available balance" (`attendance-clock-card.tsx:117`). Recovery credits can be read by self, chain manager, HR Admin of the company and a named project lead; there is no CEO or CTO read branch on requests (`recovery_credit_requests_select`, `M/20261106:1945`), while window evidence includes CEO and CTO (`can_view_recovery_evidence`). The daily 180-day expiry sweep and the processor safety net are in 2.9.

**Attendance.** `/attendance`: HR or company managers see the daily register (RPC `attendance_register_for_date`, filters, bulk entry, corrections, close session, add missing attendance, verify windows); everyone else sees "My Attendance ... HR fills this in daily — this is a read-only view of your record." (last 60 days). `/attendance-clock`: clock in with work mode, project name and project lead as free text, switch segment, clock out, last 10 sessions; unique index `attendance_sessions_one_open_per_employee` prevents two open sessions (`M/20261106000000:107`). Geolocation status is recorded and never blocks clocking.

**Reimbursements.** `/reimbursements` and `/[id]`: own claims, "Start a new claim" (currency), lines (each line's receipt file opens through a signed link), "Submit for approval", cancel. Approver is the direct manager (C-level claims go to Finance); the claim row in `/approvals` opens the claim page, which is read-only for the approver. `submitClaim` is two writes plus a compensating cancel, and `addClaimLine` has no idempotency key (`W/lib/actions/reimbursements.ts`). Physical project-expense receipt submission is a separate rule (2.5) and is not described as changing here.

**Payroll.** `/payroll`: export runs for the viewer's home company (hr_admin, finance, ceo, cto); two mandatory approval steps (Finance, then CEO or CTO). No payslips exist in the app (searched `payslip`: only a design-preview file and docs).

**Letters.** `/letters`: HR sees templates, the issue form and all issued letters; an employee sees "My letters" with Download. Templates default to requiring approval (`role:ceo`). The file is stored before approval and the employee's Download link is built for every letter that has a file regardless of status (`W/app/(app)/letters/page.tsx:56-64`, `W/lib/actions/letters.ts:84-112`; storage policy `letters_select` has no status condition) (F-F-05; from code). No way for an employee to request a letter (searched `request.*letter`).

**Policies and holidays.** `/policies` lists country rule versions; status is draft, active or superseded (there is no "published" state). RLS shows an ordinary employee only `active` rows, including an active row whose effective date is in the future (`M/20261018:177-183`); draft and superseded rows only for country-wide hr_admin, ceo and cto. Drafting needs 5 fields including the payload as raw JSON; activation needs a different HR Admin or CEO or CTO than the drafter (trigger `guard_policy_version_update`); leave types are added one at a time to a draft, with no edit or remove (F-F-12). A company-scoped HR Admin sees the page and no buttons and no explanation. Recovery Leave rules use their own seed and "Activate with a controlled effective date" path (`activate_recovery_windows_policy`). `/holidays` shows the calendar for all countries for everyone; add and delete only for a country-wide HR Admin (`public_holidays_write`); a yellow "2026 holidays pending confirmation" note is hard-coded (`holidays/page.tsx:16-20`). The policies page also calls `preflight_phase2b_v2_policy_status()`, a SECURITY DEFINER function with no role check (F-A-08, F-F; from code; hosted grants unverified: check `\df+` EXECUTE grants on that function).

**Performance.** `/performance` (under "KPIs & Performance"): own goals and appraisals; employees see appraisals only when submitted or acknowledged; `/performance/cycles` for HR Admin; `performance_cycles_select` is readable by any signed-in user. KPIs are "coming soon".

**Assets.** `/assets` for HR Admin and Finance: register, add, retire; assign and return live on the employee's Assets tab.

**Alerts.** `/alerts` for hr_admin, ceo, cto: contracts ending, probation ending, document expiry (30-day horizon), Recovery Leave work alerts, and the scheduler health banner (only HR Admin and System Administrator can read its RPC). Computed live; nothing is written.

**Audit log.** `/audit-log` (HR Admin, System Administrator): 50 per page with when, table name, 8-character entity id, action, actor, role, Human or AI; `audit_log_select_hr` allows an 11-table allow-list for the HR Admin of that company; the System Administrator sees `companies`, `user_roles` and what `M/20261104` adds. Triggers exist for more tables than the policy lets any screen show, and no trigger exists for policy versions, leave types, holidays, assets or documents (F-F-14; from code).

**Specialist settings with no screen (verified absent by searching tables and actions by name).** Approval workflows (who approves), deduction priority rules, document-expiry reminder rules, onboarding and offboarding checklists, company edit (name, currency, country), manual leave-balance correction (the only caller is the AI-draft authorise action), policy acknowledgement (searched `handbook`, `policy_acknowledg`, `acknowledged_policy`). These tables exist and are seeded or readable; HR changes them through the database today (Finding F, F-18).

**Terminations.** HR sets Status Terminated plus a date (`terminate_employee`: forfeits unused Recovery Leave); this touches no login and no grants (2.8).

**What works well and should not be disturbed (2.7)**
* Leave submission as one database transaction; the overlap constraint; approvals protected by the row lock; the ledgers as the source of balances (hard boundaries).
* RLS with security-invoker balance views; per-company scoping of HR data; the country-wide HR rule for policies and holidays.
* Maker-checker on policies (drafter cannot activate) and Recovery Leave activation checks.
* Recovery Leave routing with independent review and the explicit labels in Approvals.
* Per-tab permission building on profiles; unreachable tabs fall back to Overview rather than leaking.
* The Alerts scheduler-health banner for the Recovery processor, the only job with a staff-visible health surface.
* Idempotent cron jobs (2.9).
* Self-service pages deny nothing they should show and show only own data (RLS).

---

## 2.8 People & Access, onboarding, account administration

**Screens (Finding G, section 2).** `/people-access` is a nav row under People & HR > Access for a System Administrator, any hr_admin, or anyone holding founder or `manage_access` in Sales, Projects or Inventory, or `manage_access` in Budget (`nav-groups.ts:210-218`, `D/peopleAccess.ts:322-324`). Left: search, company filter and a people list with badges (Invited, Deactivated, No login yet, HR roles for System Administrator, module chips). Right: four tabs. One person with a login and an employee record appears as two rows until HR links them (`u:<userId>`, `e:<employeeId>`; `W/lib/people-access/data.ts:223-246`).

| Tab | Who | What |
|---|---|---|
| Account | System Administrator, person has a login | Status; Deactivate or Reactivate (`window.prompt` for reason); Send password reset; Check status; Resend invite (Invited only); Delete (`window.confirm`); none for self |
| Job & department | anyone who sees the employee row; edit only for HR Admin of that company | Job title, department, reporting manager (`updateJobDetails`) |
| HR roles | System Administrator | Role badges with "revoke"; "Give a role" form (role of 7, company or "All companies") |
| Module access | a person who manages at least one (module, company) | One card per company and module: preset select plus "Add preset", "Choose rights one by one", warehouse locations (Inventory), optional "Why", Save, Give access, Remove access |
| Company settings (`?view=company`) | managers of Projects or Inventory | Projects reference code (founder), Inventory equipment sharing between companies (founder) |

"Invite a person" (Full name, E-mail) is a System Administrator control (`page.tsx:44-49`).

**Who may grant what (Finding G, 4.2).**

| Area | Granted by | Protections (enforced) |
|---|---|---|
| HR roles | System Administrator only, any role, any scope | `revoke_role_grant`: no self-revoke, never the last System Administrator. A System Administrator granting HR roles is an existing, separately governed behaviour; it is reported, not redesigned |
| Account lifecycle | System Administrator only | `set_account_status`: reason required, not self, never the last active System Administrator; ban first on deactivate |
| Sales, Projects, Inventory | founder (any); a `manage_access` holder (not founder or access rights) | no self-add; only a founder changes a founder or access manager; last founder protected; Projects refuses to remove a live PM or team head; Inventory `view_costs` founder-only |
| Budget | any `manage_access` holder | only an executive approver adds or removes that right; last eligible approver protected; no self-add; per-company lock |
| First founders and first budget approver | owner-run SQL only (`supabase/manual-sql/{crm,proj,inv}_30_bootstrap_founders.sql`, `pbx_30_bootstrap_access.sql`) | a System Administrator cannot, by design |

Presets only add rights (`D/peopleAccess.ts:135-181`). Domain permission files mirror the SQL for the interface only.

**Authoritative capability tables.** Finding G, section 4.1 (HR roles, Sales, Projects, Inventory, Budget capabilities, and the relationships that act as permissions). Persona combinations: Finding G, section 6B and `findings/nav-matrix-raw.txt`.

**Onboarding a new employee today (Finding G, 5.2).** Eight steps by up to five different people: (1) HR Admin creates the employee, contract and salary (`/employees/new`: 15 inputs, 10 required; no department, manager or login e-mail); (2) HR Admin sets department and reporting manager in People & Access > Job tab (without a manager the first leave request fails with "No approver could be resolved ..."); (3) System Administrator invites (name, e-mail); (4) the new hire sets a password from the invite link; (5) HR Admin links the login to the employee ("Linked login" on the employee page, e-mail typed again); (6) a Sales access holder gives Sales access; (7) a Projects access holder gives Projects access; (8) a PM adds the person to a project. Entered twice: name, e-mail, hire date and contract start date, job title. Department can be set only in People & Access (`department_id` is written only in `peopleAccess.ts:149`). Nothing notifies the next actor. Onboarding checklist tables exist (`checklist_templates`, `checklist_template_items`, `employee_checklist_items`) but no screen or action uses them (verified).

**Offboarding today.** HR sets Terminated; the System Administrator deactivates the account (ban plus status; no admin sign-out is called, `W/lib/actions/account-status.ts:27-33`); each module access manager removes access per module and company; HR roles are revoked per role. Up to 2 + 4 + n separate actions by up to 6 people with no list of what the person still holds. `profiles.is_active` is never written to false anywhere, so SQL helpers that join `is_active` still count a deactivated person (eligibility, "last eligible approver", staff directories); HR `resolve_approver` ignores `account_status`, so a deactivated approver of record can stall requests (F-G-01; from code; whether a banned user's existing token survives until expiry on the hosted auth service is unverified).

**Edge cases (Finding G, 5.4).** PM reassigned: old PM becomes a member; budget and equipment powers follow `proj_is_pm` live; the budget's PM snapshot refreshes only on submit, so "decided" notices may go to the old PM. Terminated employee with account kept: no automatic effect. Employee without a linked account: cannot be PM, member, head or approver. Person in two companies: roles per company or unscoped; grants per module and company; `employees.company_id` is single. Removing Projects access from a live PM or team head is refused ("This person is the Project Manager of a live project. Assign another Project Manager first"). A person who is both Finance (budget) and PM has their own submissions routed to the executive approver; the item is "on hold" if no independent approver exists.

**Sign-in and passwords.** Sign-in by password; wrong password and deactivated account give the same message. Password policy: 10 characters and 3 of 4 classes (`D/passwordPolicy.ts`). Password change or reset ends other sessions; "sign out of all devices" is global. Forgot-password gives a neutral response. Resend invite uses the recovery template (`W/lib/actions/users.ts:75-101`). Invite success shows no confirmation (the form renders only errors, Finding H). `profiles_select` is open to every signed-in user, including `account_status` and `status_reason` (`M/20260922:274`; F-G-04; from code).

**Known issue cross-reference.** The "You cannot manage people or access" message on a data outage is documented in `docs/known-issues/people-access-outage-message.md`; its root cause is the session read in `W/lib/auth/session.ts:25-39` (F-A-01, F-H-04).

**What works well and should not be disturbed (2.8)**
* Separate grant tables per module, each company-scoped, joining the active profile; no HR role or title implies a module right.
* The sensitive-grant protections: no self-grant, last founder, last System Administrator, last eligible approver, refusal to remove a live PM (hard boundary).
* The audit triggers on every grant table (`*_audit_trigger`).
* Presets that only add rights, with the checklist for one-by-one rights.
* Invite, deactivate, reset as System Administrator-only with an explicit reason on deactivation.
* The "Linked login" step as the single bridge between a person and an employee record.
* Bootstrap of first founders by owner-run SQL.

---

## 2.9 Scheduled jobs and automation (read-only description)

Nothing was called, run or enabled. Schedules are in the repository-root `vercel.json` (UTC). Whether Vercel reads the repo-root file depends on the Vercel project's Root Directory, which no document states (unverified).

| Route | Schedule (UTC) | What it does | Auth | Visibility if it fails | Self-correcting if a run is missed |
|---|---|---|---|---|---|
| `/api/cron/leave-accrual` | `0 0 1 * *` (1st of month) | Posts accrual rows to `leave_ledger` per employee, type and month (idempotency key `accrual:<emp>:<type>:<month>`; `?mode=preflight` is read-only) | Bearer `CRON_SECRET` | HTTP 500 with `failures[]` in Vercel logs only; skipped employees (ambiguous baseline, blocked entitlement) appear only in that JSON | `per_service_year` and `annual_grant` are delta based; `monthly_accrual` posts a fixed amount per run, so a missed month is **not** made up (doc comment `route.ts:36-76`) |
| `/api/cron/comp-day-expiry` | `0 1 * * *` | Writes `expired` rows to `comp_day_ledger` (key `expiry:<earned id>`), re-derived from full history | same | 500 with `failures[]`; staff see a balance that stays | yes |
| `/api/cron/document-expiry` | `0 2 * * *` | Updates `employee_documents.status`; inserts `document_expiry_reminders_sent` then `notifications` rows for the employee and HR Admins | same | 500 with `failures[]`. The "sent" row is written before the notification rows (`route.ts:96-122`); if a notification insert fails the reminder is recorded as sent and not retried. No screen reads `document_expiring` notices | statuses yes; reminders still fire later |
| `/api/ai/detect-balance-discrepancies` | `0 3 * * *` | Reads `leave_balances` below zero; inserts `ai_drafts` only | same | 500 with `failures[]` | yes |
| `/api/cron/recovery-windows` | `30 0 * * *` | Calls `recovery_process_due('vercel_cron')`, idempotent, catches up missed boundaries | same | 500 on failed or partial. The only job with an in-app health surface: runs in `recovery_processor_runs` and failures in `recovery_processor_failures`; Alerts banner reads `recovery_scheduler_status()` | primary trigger is an owner-enabled `pg_cron` every 5 minutes (`supabase/manual-sql/recovery_windows_30_enable_scheduler.sql`); this route is the safety net |
| `/api/cron/crm-reminders` | `0 4 * * *` | `crm_generate_reminders`, optional e-mail (off unless env set), `purgeExpiredUploads` | same; **the only route listed in the proxy's public paths** (`W/proxy.ts:16`) | 500 on reminder failure; clean-up failure reported in the body | yes; e-mail retries with backoff |

**Authentication.** Each route calls `isAuthorizedCronRequest` (`W/lib/cron/auth.ts:25-30`): `CRON_SECRET` must be set and the `Authorization: Bearer` header must match (constant-time compare). An unset secret means every request is refused (fails closed). The jobs use the service-role client.

**The cron and proxy issue (Confirmed (code, hosted state unverified)).**
* `W/proxy.ts` runs on every path except static files and `os-preview` (matcher `:76-80`). A request with no session cookie to a path not in `PUBLIC_PATHS` is redirected to `/login` (`:60-68`). `PUBLIC_PATHS` is `["/login", "/set-password", "/forgot-password", "/reset-password", "/api/cron/crm-reminders"]` (`:16`). The proxy comment says the other cron routes "are deliberately left exactly as they were".
* The scheduler sends only `Authorization: Bearer $CRON_SECRET`, with no session cookie. By the code, the five routes `leave-accrual`, `comp-day-expiry`, `document-expiry`, `recovery-windows` and `/api/ai/detect-balance-discrepancies` are therefore answered with a redirect to `/login` before the route's own authorisation runs. Only `crm-reminders` reaches its route. The repository's own deployment note records this as a "Finding for you" (`docs/crm-deployment.md:99`) and the code at `76c121b` still has it.
* **Hosted check (read-only):** in the Vercel project, open Cron Jobs run history for each of the five routes and read the response status (a 307 or a login page means the route did not run), and confirm `CRON_SECRET` is set. For leave accrual also read `leave_ledger` for accrual rows created by the system sentinel in the latest month. For Recovery Leave read `recovery_scheduler_status()` or the Alerts banner. Until checked, the statement is: very likely does not run from the scheduler; Recovery Leave processing may still run through `pg_cron`.

**Gaps in monitoring (verified).** Besides the Recovery processor there is no `job_runs` table (grep of `M/`); "did it run" is answerable only from Vercel's dashboard. `W/lib/config-check.ts` checks only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; it does not check `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` or the Microsoft settings, so those failures are quiet. No `maxDuration` is set anywhere. The repository's architecture note records that the Vercel organisation is on the Hobby plan (`docs/14-enginious-os-architecture-and-roadmap.md:362-363`; not verified on the hosted account).

**Other automation.** E-mail through Microsoft Graph for leave only (`W/lib/email/graph.ts`), sent from the employee's own mailbox via `/users/{email}/sendMail`; a profile e-mail that is not a Microsoft 365 mailbox fails quietly. Invite and password e-mail is sent by the hosted authentication service, not by this app. Weather from Open-Meteo.

**What works well and should not be disturbed (2.9)**
* Every job is idempotent (unique keys and upserts that ignore duplicates), so a re-run is safe.
* Fail-closed secret check with constant-time compare.
* The Recovery processor's run log, failure table and Alerts health banner, with `pg_cron` as primary and the daily route as net.
* The read-only `?mode=preflight` on leave accrual.
* CRM reminder de-duplication keys, email claim and retry, and its public-path exemption written with an explanatory comment.
* The calculation rules inside these jobs (hard boundary: not described here as changing).

---

## 2.10 AI features that exist (no language model)

Nothing in the application calls a language model: searched `anthropic|openai|claude|llm|generative` across `apps/web/src` and `packages/domain/src` (Finding F, F-26).

| Piece | What it is | Evidence |
|---|---|---|
| Balance-discrepancy detector | A deterministic daily job (not a language model): reads `leave_balances` where the balance is below zero and inserts a draft row in `ai_drafts` unless an open draft already exists for that employee and type | `W/app/api/ai/detect-balance-discrepancies/route.ts`; schedule `0 3 * * *`; see 2.9 for whether the scheduler reaches it |
| AI Suggestions screen | `/ai-suggestions` (Insights group; HR Admin and System Administrator) lists pending drafts as raw JSON with Authorize and Reject | `W/app/(app)/ai-suggestions/page.tsx`, `W/lib/actions/aiDrafts.ts` |
| Authorise | Claims the draft with a compare-and-set, then posts the same adjustment a human would (`postLeaveLedgerAdjustment`) | `aiDrafts.ts:21-76`; the only handler is `leave_ledger/adjust_balance`; anything else returns "No authorize handler is wired up yet" |
| Audit log marker | Column Human or AI on the audit log; `is_ai_generated` is never set to true | `permissions/aiDrafts.ts` (also holds `canViewAuditLog`) |

Access: RLS `ai_drafts_select` and `_update` are any-scope hr_admin or System Administrator, not company-scoped; the ledger insert itself is company HR Admin (`leave_ledger_insert_hr`). The raw JSON is shown without employee name or balance context (F-F-11; from code). The pattern already approved in the code is "propose into a draft table; a human with the normal role authorises through the normal action"; anything reading employee data must use the signed-in user's RLS client, not the service role.

**What works well and should not be disturbed (2.10)**
* Draft-then-human-authorise; the job writes only drafts; authorisation uses the existing RLS-gated action.
* Compare-and-set claim, so two reviewers cannot apply one draft twice.
* No hidden model calls, nothing that reads employee data on behalf of a model.

---

## 2.11 Cross-cutting: notifications, reliability, mobile and accessibility

### Notification model: what notifies whom, who can see it

| Event | In-app notice (`notifications` table) | E-mail | Where the recipient sees it |
|---|---|---|---|
| Leave submitted | none | HR Admins, CEOs, CTOs and the line manager (Graph, best effort) | Approvals count on My Day and `/approvals` |
| Leave next step / decided | none | next approver; employee on approve or reject | same; the employee opens `/leave` |
| Reimbursement, timesheet, letter, payroll export, Recovery Leave credit submitted or decided | none | none | approver count on My Day and `/approvals` only; submitter opens the item |
| Project events: added, assigned, task assigned, review requested or result, date changed, mention, reply, handover submitted, assigned, clarification, accepted, scope decision, completed, reopened, task blocked, site booking | yes, through `proj_notify`: de-duplicated while unread, never to the actor, only to project members or founders (`M/20261120000200:77-101`) | none | **only** My Work > "Project notices" (`proj_my_notifications`); no badge, no My Day row |
| Budget submitted or decided, funding recorded, actuals submitted or decided, settlement closed | yes, `pbx_notify` | none | same panel; hidden from people who are not project participants (so from Finance and CEO or CTO approvers outside the project) |
| Document expiring | yes, written by the cron to the employee and HR Admins | none | nowhere: no screen reads that type (and the job is in the proxy issue, 2.9) |
| Sales reminders (follow-up due or overdue, hold review, no next action) | no: own table `crm_reminders` | optional (`CRM_REMINDER_EMAILS=on`) | `/sales/follow-ups` |
| HR alerts (contracts, probation, documents, long work) | none | none | computed live on `/alerts` and My Day |
| Inventory: request submitted, prepared, dispatched, returned, transfer received, held unit | none (Inventory functions never call a notify function; grep `notify|notifications` in the Inventory migrations returns nothing) | none | Today, Requests, the My Day count; the other party reopens the page |
| Sales: enquiry created for another owner, Won, scope-change proposed | none | none | the person finds it on their own list or page |
| Account: invite, password reset | n/a | by the hosted authentication service | the person's inbox |

There is no bell, inbox page, unread counter or push anywhere in the shell. The sidebar Approvals row is a yes/no, not a count. Notices are visible only to the addressed user (RPC reads by `user_id`); other people cannot read them.

### Reliability patterns

**Good patterns that exist (reuse, do not disturb).**
* Inventory: the `LoadError` component ("Could not load ... not an empty list"), per-source isolation on Today (`settleSources`, `today.ts:298`: each source reports its own failure and names fall back to "An employee" or "A project" while the row still shows), `Promise.allSettled` over the four Today sources (`W/lib/inventory/today-data.ts:59`), and the `p_key` idempotency key created when a movement form opens, with `inv_transaction_status` lookup after a timeout (`W/lib/inventory/idempotency.ts`, `inventoryStock.ts:108`). Everything on Inventory degrades to a named failure, never to an "access denied" notice (Finding C, section 5).
* Budget: `not_installed | denied | error | ok` result type; per-click `requestId`; `friendlyBudgetError` in plain words.
* Projects: `loadWorkRows` throws through `ok()`; `loadDirectoryResult` returns `{rows, error}`; task and plan actions return plain-words stale-version messages; a 20 s abort on database calls so a stalled retry ends in words (`W/lib/supabase/server.ts:5-21`).
* Sales: `ok()` helper (`W/lib/crm/data.ts:11-14`) and `LoadError` in the layout.
* My Day: `portfolio === "error"` shows "—" with "Could not be loaded"; the HR block warns "Some workforce data couldn't be loaded"; People today reports its own error.
* Shell: calm error boundaries (`W/app/(app)/error.tsx`: "This page couldn't load ... Your data is safe", with Try again; `W/app/global-error.tsx`; `not-found.tsx`) and 21 `loading.tsx` files.
* Deliberate "module not installed" handling (`isNotInstalled`, codes 42P01, 42883, PGRST205, PGRST202) shows "X is not installed in this environment yet".
* Database protection against double submission: approvals row lock; unique open session; leave overlap constraint; unique approval step.

**Weak patterns that exist (from code; numbers are Finding H's list; none is a hosted-system check).**
* A failed database read becomes empty, zero, or "no access" in many places: the approvals page ("Nothing waiting on you right now."), the My Day approvals count (false "Nothing needs your attention right now."), the session read (`W/lib/auth/session.ts:25-39`, no error check, so a failed role read is treated as "No role assigned"), nav probes whose `try/catch` never runs because supabase-js returns `{error}` rather than throwing (`W/app/(app)/layout.tsx:41-63`; module links vanish during an outage), My Work and My Day Projects counts (`W/lib/projects/my-work.ts:27-60,84-106`), Leave page ("0 days"), Leave form ("HR hasn't activated a leave policy for your country yet"), Alerts ("Nothing needs attention right now"), Employees ("No employees match these filters."), Reimbursements (currency defaults to AED), the clock ("not started"), project pages (`notFound()` with "may not have access to it"), and `employees` profile tabs. About 40 page or loader files contain database calls and no error handling (Finding H, 3.3).
* `getCurrentSession` is the root of the People & Access outage wording (known issue, cross-referenced in 2.8).
* Sequential awaits on My Day with no `Suspense` (~10 awaits before first paint); weather adds up to 3 s while the weather service is down; an uncaught throw in any server component replaces the whole page with the error boundary.
* Some Server Action errors surface as raw messages (approvals) or the generic "Could not submit the leave request" even when the cause is the overlap constraint; a rejected Server Action in some forms goes to the page error boundary and discards typed text (`decision-buttons.tsx:15-21`).
* Unsaved-changes guards exist only in Sales forms, Budget editors and Inventory forms (10 files); none in Projects task, plan or milestone forms, HR forms or People & Access forms.
* Session expiry mid-form redirects to `/login?next=<path>`; typed text is not restored. A failed `getUser()` at the proxy is indistinguishable from signed-out.
* E-mail failures are silent for the user (leave mail, mailbox that is not Microsoft 365).
* `reassignProjectTask` and `blockProjectTask` send no version (last write wins; database state checks still apply).

### Mobile and accessibility facts (from code; no device or screen-reader test was run by the investigators)

* Responsive tables: 64 `<Table stack>` uses stack to cards below the `md` breakpoint (`W/components/workspace/list-table.ts`). Still scrolling sideways on a phone: attendance register (10 columns), bulk attendance form, timesheet detail, project plan table, Inventory setup tables (count sheet, locations, technologies, counts, legacy import), employee equipment link.
* Tap targets: `W/components/ui/button.tsx` sizes are `h-9` (36 px) default and `h-8` (32 px) small; Approve and Reject are `size="sm"` side by side (`decision-buttons.tsx:56-61`).
* Mobile bottom bar has no Approvals, Projects or Inventory tab; the Alerts bell is hidden below `lg`; module tab bars: Sales is mobile only.
* Landmarks: skip link, `aria-label` on menu button, primary nav and the bell, `aria-current` on bottom-bar tabs (`app-shell.tsx:53`, `shell-chrome.tsx:69-111`).
* The repository documents axe and phone checks for Inventory, Sales, Projects and My Day (`docs/os-rollout-4-7.md:34,84`; `docs/inventory-simplification.md:157`); their outage checks cover only Inventory, Sales and Projects pages, not the HR pages. These records come from documents and were not re-run for this specification.
* Dark and light themes exist (theme toggle in the header and user menu).

### Verified absences (searched; stated as absent only because the search found nothing)

| Not found | What was searched | Source |
|---|---|---|
| A search across more than one record type | server actions, RPCs, API routes, components for `search`, `ilike`, `textSearch`, `lookup`, `omni`, `palette` | F-A (5.4) |
| A notification bell, inbox or unread count | `notification`, `notif`, `bell`, `BellRing`, `inbox`, `unread` | F-A (5.5) |
| A company-wide exceptions list (blocked or overdue projects and tasks across the company) | `blocked`, `at_risk`, `critical`, `overdue`, `health`, `escalat`, `exception`, `stuck`, `aging` | F-A (5.3) |
| Subtasks | `parent_task`, `subtask` | F-B (1) |
| An approved, current or version marker on project files; "site instructions" field | `approved|current|latest|supersed|version` in `documents/` and `proj_files`; `site instruction`, `instructions` | F-B (5, P3) |
| A dispatch note, delivery note or packing list | `dispatch note`, `delivery note`, `packing list`, `goods issue` | F-D (1) |
| Approval delegation, backup approver, reassignment or escalation | `delegat`, `escalat`, `reassign`, `out_of_office`, `acting_approver`, `on behalf` | F-E (1), F-F (1) |
| A team or company leave list | all five readers of `leave_requests` | F-F (5.2) |
| An onboarding checklist screen; a screen for approval workflows, deduction rules, document-expiry rules, manual leave adjustment | table and action names | F-F (18), F-G (1) |
| A policy acknowledgement or handbook | `handbook`, `policy_acknowledg`, `acknowledged_policy` | F-F (1) |
| Payslips; a way for staff to request a letter | `payslip`; `request.*letter` | F-A (5.6) |
| Contingency or VAT in budgets; budget export | `contingency`, `VAT`, `tax`; `export`, `csv`, `print`, `download`, `pdf` | F-E (1) |
| A role named Technician, Programmer, Engineer, Content or Marketing | `technician|programmer|engineer|content staff|marketing|operations` | F-B (1, 4.2) |
| A job-run log for any job except the Recovery processor | `cron_runs`, `job_runs` and grep of `M/` | F-H (5.3) |
| Any call to a language model | `anthropic|openai|claude|llm|generative` | F-F (1) |
| An Inventory notification | `notif` in Inventory libs, components, actions, migrations | F-C (1), F-D (1) |

**What works well and should not be disturbed (2.11)**
* The Inventory failure pattern as the template for the rest of the app.
* Database-side double-submit and stale-version protection on money, approvals, tasks and equipment.
* The `proj_notify` rules (de-duplicate while unread, never to the actor, project participants only); they are why the notice panel is safe, even though it is displayed in only one place.
* The calm global error boundaries and the 21 route-specific loading states.
* The responsive stacked tables, skip link and landmarks already present.
* The approved visual direction (design language, dark and light themes).


---

# 3. Detailed change register

The register is split into three parts so that categories stay separate: **3.1 confirmed defects (`D-nn`)**, **3.2 usability recommendations (`U-nn`)** and **3.3 new functionality (`N-nn`)**. IDs are assigned in priority order within each part. Each entry is a self-contained table: current behaviour with evidence, user problem, proposed behaviour, before→after, roles affected, data source, technical scope, business-rule impact and acceptance checks (success, failure, permission). Source ids such as `F-A-02` point to the investigators' findings and are kept for traceability.

**Priority legend.** **LB** launch blocker (staff can lose, hide or misreport money, leave, approvals, equipment custody or assigned work; or a security/confidentiality exposure; or a leave/payroll/compliance job very likely not running; or a documented core path fails with no safe workaround; or a required hand-off is invisible to the next person). **LI** launch improvement. **LT** later.

**Verification labels.** *Confirmed (code)*, *Confirmed (code, hosted state unverified)* and *Needs runtime confirmation* (see the front matter). Nothing here was exercised against a hosted database.

| Part | Entries | LB | LI | LT |
|---|---|---|---|---|
| 3.1 Defects | 59 | 14 | 35 | 10 |
| 3.2 Usability | 38 | 1 | 26 | 11 |
| 3.3 New | 23 | 0 | 12 | 11 |

**Overlaps between parts (treat each pair as one item when scheduling; counts above include both entries):**

| Entries | Same subject | Treat as |
|---|---|---|
| N-18 and U-34 | Tag employee claim lines to a project | One item (LT, owner decision) |
| N-11 and U-16 | Duplicate a budget line (U-16 also pre-ticks people and remembers choices) | One package: U-16 includes N-11 |
| N-13 and U-29 (part) | Further Today sources and entry points for the warehouse | One package, later |
| N-06 and U-25 (part) | Held-for-checking visibility on Today and follow-up for a unit held while reserved | One package: do U-25 and N-06 together |
| N-01 and U-30 | Notices outside Projects (Inventory, task comments, Sales assignment, Recovery Leave) | U-30 depends on N-01 |
| D-07 and N-02 / U-06 | Finance and CEO/CTO see what waits for them; one list of "needs my decision" | D-07 is the launch-blocking fix; N-02/U-06 generalise it |


## 3.1 Confirmed defects (`D-nn`)

Code basis: `/home/user/hr-engine` at origin/main `76c121b` (includes Inventory simplification, PR #52). Planning only: nothing below has been changed, run or tested. Code is the authority; older `docs/` text is historical.

### How to read this part

* Order: all Launch blockers (LB) first, then Launch improvements (LI), then Later (LT). Numbers follow that order. Where an item sits inside a hard boundary it is registered as a risk, its "Business-rule impact" says `owner decision; this spec does not propose changing the rule`, and the real decision is in the open questions at the end.
* Priority labels: LB / LI / LT as in the rubric. "LI (provisional)" means the priority depends on an owner answer, which is stated in the row.
* Verification labels are the three agreed ones. For the umbrella "failed read" entries each sub-row is cited from the investigator who found it (A, B, C, E, F, G, H); the pattern itself (`error` dropped, `data ?? []`, `count ?? 0`) was found independently by at least three investigators for the approvals, leave and project-work themes, and I re-opened the shared root (`lib/auth/session.ts`, `app/(app)/layout.tsx`, `proxy.ts`, `attendance-clock/page.tsx`, `reimbursements.ts`, `letters/page.tsx`, `policies/page.tsx`, `nav-groups.ts`, `employees_select`, `profiles_select`, `recovery_credit_requests_select`) myself.
* "Failed read" means a database or service call returned an error and the screen showed "none", "0", "not found" or "you do not have access" instead of "could not load". The agreed good pattern is the Inventory `LoadError` ("Could not load ... not an empty list", `components/workspace/states.tsx`). The People & Access outage wording is already documented separately (`docs/known-issues/people-access-outage-message.md`); D-15 is its shared root cause and links to it, it is not a new report.
* The `Source` column gives investigator finding ids (for example `F-H-01`).

### Summary table

| ID | One-line title | Priority | Verification | Area | Source ids |
|---|---|---|---|---|---|
| D-01 | Five scheduled jobs are redirected to `/login` by the sign-in proxy (leave accrual, Recovery Leave expiry, document expiry, discrepancy detector, recovery safety net) | LB | Confirmed (code, hosted state unverified) | Reliability / HR jobs | F-H-01, F-people-hr-01, F-A-09 (part) |
| D-02 | Failed read shows "Nothing waiting on you" to approvers (Approvals page, My Day, balance warning) | LB | Confirmed (code) | Approvals | F-A-02, F-E-03, F-H-03, F-people-hr-02, F-G-13 |
| D-03 | Failed read shows "0 days", "No leave requests" or "HR hasn't activated a leave policy" on leave pages | LB | Confirmed (code) | Leave | F-H-07, F-people-hr-02, F-A-05 |
| D-04 | Failed read hides or demotes project work (My Day rows, handovers inbox, project pages, task panel) | LB | Confirmed (code) | Projects | F-A-04, F-B-09, F-H-05, F-D-11 |
| D-05 | Reimbursement claim: delete a line then add one fails; the form clears itself on error | LB | Confirmed (code) | Money / claims | F-E-16, F-H-12 (part) |
| D-06 | Employee equipment request: reserving then issuing is refused by the system's own reservation | LB | Confirmed (code) | Inventory | F-C-01 |
| D-07 | Budget, final-expense and settlement notices are written for Finance and CEO/CTO approvers, but a Finance-only person (not on the project) cannot see them; no My Day row | LB | Confirmed (code) | Budget / Approvals | F-E-01, F-A-10 |
| D-08 | A won enquiry with no handover submitted is shown to nobody | LB | Confirmed (code) | Sales to Projects handover | F-B-01 |
| D-09 | Handover "PM asked a question" and "accepted" notices have no screen for a Sales-only owner | LB | Confirmed (code) | Sales to Projects handover | F-B-04 |
| D-10 | Deactivating an account does not make the person inactive to access and approval routing | LB | Confirmed (code) | People & Access | F-G-01 |
| D-11 | Every signed-in user can read every profile, including the deactivation reason | LB | Confirmed (code, hosted state unverified) | People & Access / confidentiality | F-G-04 |
| D-12 | "Advance still to be returned" shows the full advance before final expenses are approved | LB | Confirmed (code) | Budget / settlement | F-E-10 |
| D-13 | Attendance clock "Project lead" list contains only the person themself for an ordinary employee | LB | Confirmed (code) | Attendance / Recovery Leave | F-A-07, F-people-hr-04 |
| D-14 | Recovery Leave approval cards are blank or missing for project leads and for CEO/CTO deciding an HR Admin's request | LB | Confirmed (code) | Recovery Leave approvals | F-people-hr-03 |
| D-15 | Failed read of roles or employee row reads as "no role" and "no employee record" everywhere | LI | Confirmed (code) | Session | F-A-01, F-H-04, F-people-hr-02, F-G-13 |
| D-16 | Failed read shows "No claims", defaults currency to AED, hides the Budget tab (money entry) | LI | Confirmed (code) | Money | F-E-03, F-H-12, F-A-05 |
| D-17 | Failed read in Inventory context, availability, names and labels reads as "no access", "0 available", wrong sticker | LI | Confirmed (code) | Equipment | F-C-06, F-C-07, F-C-08, F-H-06 (part) |
| D-18 | Failed read in Sales/CRM context and pickers reads as "no Sales access", empty organisation list, silent duplicates | LI | Confirmed (code) | Sales | F-B-09 (e-g, l), F-H-06 (part), F-G-13 |
| D-19 | Failed read in navigation probes makes menu entries disappear | LI | Confirmed (code) | Navigation | F-H-09, F-A-19 (part), F-C-06 (part) |
| D-20 | Failed read on HR records, Alerts, employee list and attendance clock reads as empty, "not started" or 404 | LI | Confirmed (code) | HR records | F-H-08, F-H-10, F-H-11, F-A-03, F-A-05, F-A-06, F-people-hr-02 |
| D-21 | My Day count, hero line and primary button ignore queue-routed approvals | LI | Confirmed (code) | Approvals | F-A-12, F-E-02, F-people-hr-21 (part) |
| D-22 | `preflight_phase2b_v2_policy_status()` returns seeded draft policy values to every signed-in user | LI (provisional) | Confirmed (code, hosted state unverified) | Policies / confidentiality | F-A-08 |
| D-23 | Employee can download a letter that is still "pending approval" | LI | Confirmed (code) | Letters / approvals | F-people-hr-05 |
| D-24 | Document-expiry reminders have no rules, no reader and no recipient screen | LI | Confirmed (code) | HR compliance | F-people-hr-10, F-A-09 |
| D-25 | Scheduled jobs: no run visibility, "sent" marker written before the reminder, `CRON_SECRET` not checked | LI | Confirmed (code) | Reliability | F-H-02, F-people-hr-25, F-people-hr-19 (part) |
| D-26 | Leave and approval e-mails fail silently and `notifications` has no reader | LI | Confirmed (code) | Notifications | F-H-16, F-people-hr-21 (part) |
| D-27 | Sign-in `next` accepts protocol-relative targets | LI | Confirmed (code) | Security hygiene | F-H-18 |
| D-28 | Two return screens with opposite safety defaults; return review wording contradicts the database for "fair" | LI | Confirmed (code) | Inventory | F-C-03 |
| D-29 | Employee request: "Expected back (optional)" is required to submit | LI | Confirmed (code) | Inventory | F-C-02 |
| D-30 | Fulfilled requests, cancelled-with-equipment-out and finished projects have no "Receive back" link | LI | Confirmed (code) | Inventory | F-C-04 |
| D-31 | Today's request queue filters by pickup warehouse, not by where stock is reserved | LI | Confirmed (code) | Inventory | F-C-05 |
| D-32 | Consumable lines can be reserved but Send out cannot send them | LI | Confirmed (code) | Inventory | F-C-09 |
| D-33 | Rented counted stock cannot be dispatched against the request that asked for it | LI | Needs runtime confirmation | Inventory | F-C-10 |
| D-34 | A unit that becomes held keeps its reservation for a later request and nobody is told | LI | Confirmed (code) | Inventory | F-C-11 |
| D-35 | Inventory nav and page gate are stricter than the database for acting PMs and team heads | LI | Confirmed (code) | Inventory / navigation | F-G-05, F-A-20, F-C-19 (part) |
| D-36 | Budget or settlement "on hold" (no independent approver) is silent and incomplete | LI | Confirmed (code) | Budget | F-E-08 |
| D-37 | Status text says "Finance" when the CEO/CTO decides | LI | Confirmed (code) | Budget | F-E-09 |
| D-38 | Budget currency is free text and cannot be changed | LI | Confirmed (code) | Budget | F-E-14 |
| D-39 | A Sales-linked person added as a project member gets work they cannot see | LI (provisional) | Confirmed (code) | Projects | F-B-05 |
| D-40 | "Needs you" links on My Day and Projects do not go where they say | LI | Confirmed (code) | Projects / My Day | F-B-10 |
| D-41 | Handover risks and notes cannot be reached after acceptance | LI | Confirmed (code) | Projects | F-B-15 |
| D-42 | HR stat cards and quick actions link to personal pages while describing company data | LI | Confirmed (code) | My Day / HR | F-A-11, F-people-hr-06 |
| D-43 | On-screen statements contradict what the system does (approval chain wording, "HR fills this in", invite message) | LI | Confirmed (code) | HR copy | F-people-hr-09, F-G-06 |
| D-44 | Leave types can be added to a draft policy but never edited or removed | LI | Confirmed (code) | Policies | F-people-hr-12 |
| D-45 | Audit log hides tables it records and does not record HR configuration changes | LI | Confirmed (code) | Audit | F-people-hr-14 |
| D-46 | AI negative-balance suggestion can be authorised without context and is visible across companies | LI (provisional) | Confirmed (code) | Leave balances / AI drafts | F-people-hr-11 |
| D-47 | Linking an account to an employee is wildcard-matched and unconfirmed (risk) | LI | Confirmed (code) | People & Access | F-G-12 |
| D-48 | A System Administrator can give any HR role to themself with no second person (risk, owner decision) | LI (provisional) | Confirmed (code) | Sensitive grants | F-G-03 |
| D-49 | CRM organisations and contacts are not company-scoped (risk, owner decision) | LI (provisional) | Confirmed (code) | Company boundary | F-B-21 |
| D-50 | Silent row caps in Inventory movement-form pickers and Today transfers | LT | Confirmed (code) | Inventory | F-C-12 |
| D-51 | Late dispatch cannot be recorded from Send out | LT | Confirmed (code) | Inventory | F-C-13 |
| D-52 | Receiving a transfer "Everything on the way" cannot record transit damage | LT | Confirmed (code) | Inventory | F-C-14 |
| D-53 | A PM who gives themself a "needs review" task has no eligible reviewer and nobody is told | LT | Confirmed (code) | Projects | F-B-11 |
| D-54 | Legacy Sales-side handover RPC is still callable (owner decision) | LT | Confirmed (code) | Handover | F-B-20 |
| D-55 | Recording receipts can overwrite a concurrent change without warning | LT | Confirmed (code) | Budget | F-E-15 |
| D-56 | An existing-claim link is not checked for duplicates or claim state | LT | Confirmed (code) | Budget | F-E-18 |
| D-57 | UI "manager" tests use direct reports while the database uses the full chain | LT | Confirmed (code) | HR | F-people-hr-23 |
| D-58 | CEO/CTO are told "nothing" for identity-document expiries they cannot read | LT | Confirmed (code) | HR alerts | F-G-16 |
| D-59 | `proj_notify` silently drops notices when the recipient is the actor or has lost eligibility | LT | Confirmed (code) | Notifications | F-D-11 |

Counts: 59 entries; LB 14, LI 35 (5 provisional), LT 10.

Priority reasons are stated inside each entry. Conflicts between investigators and how I resolved them are listed at the end of this file.

---

### LB entries

#### D-01 Five scheduled jobs are redirected to `/login` by the sign-in proxy

| Row | Entry |
|---|---|
| ID / priority | `D-01` · LB (a scheduled job that supports leave, Recovery Leave and compliance very likely does not run) |
| Verification | Confirmed (code, hosted state unverified). Exact read-only checks in "Current behaviour". |
| Current behaviour | `apps/web/src/proxy.ts:16` `PUBLIC_PATHS` contains only `/login`, `/set-password`, `/forgot-password`, `/reset-password`, `/api/cron/crm-reminders`; a request with no session cookie is redirected to `/login` (`proxy.ts:62-68`) before the route's own `CRON_SECRET` check runs. `vercel.json` registers six crons; five are not exempt: `/api/cron/leave-accrual` (`0 0 1 * *`), `/api/cron/comp-day-expiry` (`0 1 * * *`), `/api/cron/document-expiry` (`0 2 * * *`), `/api/ai/detect-balance-discrepancies` (`0 3 * * *`), `/api/cron/recovery-windows` (`30 0 * * *`). Recovery windows also has a database `pg_cron` primary, so its Vercel call is a safety net only. `docs/crm-deployment.md:99` already recorded the redirect as "a finding for you, not changed here". No test covers it (`proxy-matcher.test.ts` has no `/api/cron/*`). Vercel run history is not visible to me. **Read-only checks:** (1) Vercel, Cron Jobs, run history of each route (a 307 or no run = not running); (2) `select max(txn_date) from leave_ledger where reference_type='policy_run'`; (3) `select count(*) from comp_day_ledger where entry_type='expired' and reference_type='comp_day_expiry_sweep'`; (4) `select * from recovery_processor_runs order by 1 desc limit 5` (origin `vercel_cron` versus `pg_cron`); (5) Vercel project Root Directory (repo root versus `apps/web`; if `apps/web`, none of the six crons is registered: F-H open question 2). |
| User problem | Every employee: monthly leave accrual and Recovery Leave (comp-day) expiry may never post. HR: document statuses, expiry reminders and negative-balance drafts never refresh. Nobody is told (see D-25). |
| Proposed behaviour | 1. Owner reads the hosted checks above first. 2. If confirmed, owner decides which of the five paths to allow past the sign-in redirect; add exactly those paths to `PUBLIC_PATHS` (each route already returns 401 without a valid `Authorization: Bearer $CRON_SECRET`, `lib/cron/auth.ts`). 3. **Do not enable `leave-accrual` until its read-only preflight has been run once** (`GET /api/cron/leave-accrual?mode=preflight` with the secret; `route.ts:62,82`) and HR has read `wouldPost`, `ambiguousBaselines` and `blockedEntitlementConfig`; the first live run posts accrual and expiries onto live balances. 4. Do not enable `/api/ai/detect-balance-discrepancies` before D-46 is resolved (it would start drafting "credit back to zero" suggestions for legitimate negative annual balances). 5. Add a test that a GET without a session reaches each exempt route and a request without the secret gets 401. |
| Before → after | Five jobs never reach their handler → five jobs reachable and 401 without the secret. No screens or steps change for staff. |
| Roles affected | All employees (leave, comp days), HR Admin (documents, drafts, Recovery alerts), anyone who holds HR plus other responsibilities sees the same effects once balances move. |
| Data source | `leave_ledger`, `comp_day_ledger`, `employee_documents`, `ai_drafts`, `recovery_processor_runs` (existing). |
| Technical scope | Interface-only for the allow-list and test (`proxy.ts`, test files). Operational decision for the owner (hosted settings, first-run timing). No migration. |
| Business-rule impact | **Owner decision.** Exempting routes starts monthly and daily HR jobs that may not have been running, so leave and comp-day balances will move on the first run. No accrual, expiry or balance calculation is changed by this spec; only whether the job is reachable. |
| Acceptance checks | • Success: with the Bearer secret each exempt route answers 200 JSON, not 307. • Failure: no header or wrong secret gives 401 and no database reads. • Permission: a signed-in staff browser calling the URL without the secret gets 401. • HR has reviewed the leave-accrual preflight output before the first live run. • `proxy-matcher` tests list the exempt paths. |

#### D-02 Failed read shows "Nothing waiting on you" to approvers

| Row | Entry |
|---|---|
| ID / priority | `D-02` · LB (approvers are told there is nothing to decide when the read failed; approvals are the core hand-off) |
| Verification | Confirmed (code) |
| Current behaviour | See sub-table. Quotes: "Nothing waiting on you right now. Requests routed to you for approval will show up here." (`approvals/page.tsx:398`), "Nothing needs your attention right now." (`action-centre.tsx:55`), "Nothing is waiting on you." (`components/my-day/decisions-card.tsx:28`). |
| User problem | Managers, project leads, HR, Finance, CEO/CTO can walk away from a pending request. A failed `leave_balances` read makes every leave request carry the red insufficient-balance badge (`approvals/page.tsx:435`), which can lead to wrong rejections. |
| Proposed behaviour | On `/approvals`: check `error` on the approvals query and on each entity query (leave, claims, timesheets, letters, payroll, Recovery); render `LoadError what="your approvals"` with a Retry button instead of the empty state. A row whose entity read failed shows "Details could not be loaded" instead of being dropped (`requestById.has` / `claimById.has`, `:272-273`). For the balance badge show "Balance could not be checked" when the balance read failed. On My Day make `myPendingApprovals` `number \| "error"`: tile value "—" with hint "Could not be loaded"; hero sentence "Approvals could not be loaded"; DecisionsCard shows an error row; the primary action does not fall back to "Add employee" / "Request leave". Keep the sidebar Approvals link visible when the count read failed. |
| Before → after | A failed read shows 0 / "Nothing" (0 steps to notice) → a visible error plus Retry (1 click). No steps removed. |
| Roles affected | Every approver; a person who is line manager, project lead and HR Admin sees the error once on one page, not three false empties. |
| Data source | Existing `approvals`, `leave_requests`, `leave_balances`, `comp_day_balances`, `deduction_priority_rules`; `LoadError` component. |
| Technical scope | Interface only (server components); no migration. |
| Business-rule impact | None. RLS and routing unchanged; the page still fails closed. |
| Acceptance checks | • Success: unchanged lists. • Failure: with the approvals read forced to error the page shows the error component and My Day shows "—", never 0 or "Nothing". • Failure: with only `leave_balances` forced to error no request shows "Insufficient balance". • Permission: no approver sees a request they could not see before. |

Sub-table (screens and lines):

| Screen | File:line | What it does on a failed read |
|---|---|---|
| Approvals list | `app/(app)/approvals/page.tsx:33-39`, `:364`, `:395-398` | `const { data: approvals }`, 38 reads and 0 `error` checks; empty list and "Nothing waiting" |
| Approvals, names | `approvals/page.tsx:101` | employees read failure: every name "—" |
| Approvals, balances | `approvals/page.tsx:213-240`, `:435` | balance reads failing give `?? 0`, red "Insufficient balance" on every leave row; comp-day cover ignored |
| Approvals, entities | `approvals/page.tsx:272-273` | rows whose entity read failed are silently dropped |
| My Day count | `app/(app)/page.tsx:103-114` | `catch` logs and keeps 0; tile 0 (`:362`); primary button falls back (`:265`) |
| My Day hero and card | `action-centre.tsx:55`, `decisions-card.tsx:28` | "Nothing needs your attention right now." / "Nothing is waiting on you." |
| Sidebar link | `app/(app)/layout.tsx:41-52` | `count ?? 0`; link hidden for a person whose only route is "something waiting" (`nav-groups.ts:117-120`) |

#### D-03 Failed read shows "0 days" or "HR hasn't activated a leave policy" on leave pages

| Row | Entry |
|---|---|
| ID / priority | `D-03` · LB (leave balances are named high severity; the message blames HR and blocks submitting during an outage) |
| Verification | Confirmed (code) |
| Current behaviour | `leave/page.tsx:62-80`: `leave_balances`, `comp_day_balances`, `leave_requests` errors ignored; balance cards render nothing, the tile prints "Comp-off 0 days" (`:80`), the table shows "No leave requests yet.". `leave/new/page.tsx:45-84`: a failed `employees`, `policy_versions` or `policy_leave_types` read makes `hasAnyActivePolicy` false and prints "HR hasn't activated a leave policy for your country yet ... ask HR Admin to activate one." (`:79-80`); `lib/actions/leave.ts:57-75` returns the same sentence on a read failure. Profile Leave tab `employees/[id]/leave-section.tsx:24-64` shows "0 days" and empty tables (24 profile section files, 0 error mentions). |
| User problem | An employee sees zero leave and no history, or is told HR has not activated a policy and cannot submit. HR Admins are asked to "activate" a policy that exists. |
| Proposed behaviour | `LoadError` ("Could not load your leave. This is a problem loading the information, not zero days.") with Retry for balances, requests and policy reads. Keep the "HR hasn't activated a leave policy" message only when the read succeeded with zero active versions. `leave.ts` submit returns "Could not check your leave policy, try again" on a read error. No calculation, accrual or ledger logic is touched. |
| Before → after | A false "0 days" shown (0 prompts) → explicit error with Retry. LB pages: `/leave`, `/leave/new`; LI profile tab (same fix). |
| Roles affected | Every employee; HR and line managers reading the profile Leave tab. |
| Data source | Existing `leave_balances`, `comp_day_balances`, `leave_requests`, `policy_versions`, `policy_leave_types`. |
| Technical scope | Interface only; one small server-logic change in `lib/actions/leave.ts`. |
| Business-rule impact | None (display only; leave-balance calculation untouched). |
| Acceptance checks | • Success: unchanged numbers. • Failure: balances read forced to error shows the error component, not "0 days"; policy read forced to error does not mention HR activation. • Failure: zero active versions with a successful read still shows the HR message. • Permission: RLS unchanged. |

#### D-04 Failed read hides or demotes project work

| Row | Entry |
|---|---|
| ID / priority | `D-04` · LB (work assigned to staff and the single handover inbox can vanish, and a real member can be shown as a non-member) |
| Verification | Confirmed (code) |
| Current behaviour | See sub-table. Quote: "We couldn't find that ... or you may not have access to it" (`projects/[id]/page.tsx:15`); "Summary only. Details, tasks, discussion and files are for the people working on this project". |
| User problem | The daily entry point shows no overdue tasks, no reviews, no handovers; a PM or team head can be told a project does not exist or becomes read-only; the PM and founders see "No handovers to show" while a handover waits. |
| Proposed behaviour | `loadMyWork`, `loadProjectsAttention` and `loadProjectView` return or throw on any read error, reusing the `ok()` helper (`lib/projects/my-work.ts:126-128`) and the `{ rows, error }` shape of `loadDirectoryResult` (`lib/projects/data.ts:34-38`). My Day shows one line "Project items could not be loaded." (the `projectRows = "error"` branch already exists, `page.tsx:296-299`, but is unreachable today). Project pages show `LoadError`, never `notFound()`, when the failure is not "row absent"; `loadProjectView` returns found / not found / error. Handovers page shows `LoadError`. Task panel shows "History could not be loaded". `getProjectsContext` failure also stops hiding the Projects card on My Day (`ctx.loadFailed`). |
| Before → after | Silent zeros and 404 (0 steps to notice) → "Could not load" with Retry. |
| Roles affected | PMs, team heads, project members, founders and `assign_pm` holders; a PM who is also a Sales owner sees the Projects and Sales cards fail honestly (D-18). |
| Data source | `proj_tasks`, `proj_projects`, `proj_project_people`, `proj_teams`, `proj_handovers`, `proj_task_events/comments/dependencies/collaborators`; `LoadError`. |
| Technical scope | Server logic and interface; no migration. |
| Business-rule impact | None. Access still fails closed; nobody gains access. |
| Acceptance checks | • Failure: stub `proj_project_people` error, project page says "Could not load", not 404 or read-only. • Failure: stub `proj_tasks` error, My Day Projects card shows the error line. • Failure: stub `proj_handovers` error, handovers page shows `LoadError`, not "No handovers to show". • Permission: a non-member still sees only the summary or not-found when the read succeeds. |

Sub-table:

| Screen | File:line | Behaviour on a failed read | Source |
|---|---|---|---|
| My Day project rows | `lib/projects/my-work.ts:31-60,84-106` (`loadMyWork` ignores `.error`, docstring "read as nothing"; `loadProjectsAttention` `catch { return empty }`) | counts 0, rows dropped, no message; `page.tsx:295-299` error state never produced | F-A-04, F-H-05 |
| Projects overview "needs you" | `projects/page.tsx:42` | zeros | F-B-09 d |
| Handovers inbox | `projects/handovers/page.tsx:25` (`data ?? []`) | "No handovers to show" while one may wait | F-B-09 a |
| Project view | `lib/projects/data.ts:46-71` | project error: `notFound()` on every project page; `proj_project_people`/`proj_teams` errors ignored so a real member or team head becomes `level = "none"` or loses edit rights (`work/page.tsx:60` redirect) | F-B-09 b, F-H-05 |
| Task panel | `components/projects/tasks/task-detail-data.ts:44-58`, `task-panel.tsx:25-30` | empty history, no comments, "no dependencies", "Task not available ... no longer part of its project" | F-B-09 c |
| Work tab | `projects/[id]/work/page.tsx:88,146,151` | "No required milestone", no "Next on site", 0 open feedback | F-B-09 h |
| Completion review | `projects/[id]/complete/page.tsx:43-60` | "no unfinished items" (database re-checks at submit) | F-B-09 i |
| Sub-pages | `projects/[id]/{changes,documents,discussion}/page.tsx` | blank page (`if (!view) return null`) | F-B-09 k |
| Context | `lib/projects/context.ts:73-79,83-87,107-109,127,132` | settings/people/company reads unchecked: names "Unknown" or "Former colleague"; grants error gives Projects module absence | F-B-09 e, F-H-09 |

#### D-05 Reimbursement claim: delete a line then add one fails; the form clears itself on error

| Row | Entry |
|---|---|
| ID / priority | `D-05` · LB (money entry: an ordinary employee correcting a claim hits a hard failure every time and loses what they typed) |
| Verification | Confirmed (code) (I re-checked `lib/actions/reimbursements.ts:76-84`) |
| Current behaviour | `addClaimLine` computes `nextLineNo = (count ?? 0) + 1` from a head-count of lines (`lib/actions/reimbursements.ts:76-84`); `reimbursement_claim_lines` has `unique (claim_id, line_no)` (`20260927000000...:82`) and `deleteClaimLine` does not renumber. Lines 1,2,3, delete 1, add: next number is 3, which exists, so the user sees the raw "duplicate key value violates unique constraint" message every time. `AddLineForm` calls `formRef.current?.reset()` straight after dispatch (`add-line-form.tsx:22`), so the typed expense is wiped even on error. Also: submit does not require at least one line (a zero-total claim can be submitted); error strings are raw database text (`reimbursements.ts:96,117,132`); the action has no idempotency key, so a double click can race the same number. |
| User problem | Any employee who removes a wrong line and adds the right one cannot finish the claim; typed values are lost. |
| Proposed behaviour | 1. Line number = `max(line_no) + 1` for the claim, or a database default/trigger so two clicks cannot collide; retry once on a unique conflict. 2. Reset the form only when the action returned success; on error keep the typed values and show "Could not add the line: <friendly reason>". 3. Block submit with "Add at least one expense line" when the claim has no lines. 4. Add a client key to `addClaimLine` (as Budget's `useAction`). The physical receipt submission rule is not touched. |
| Before → after | Failure on every add after a delete, values retyped (about 6 fields) → success on first attempt; form keeps values on error. |
| Roles affected | Every employee; managers and Finance see fewer broken drafts. |
| Data source | `reimbursement_claims`, `reimbursement_claim_lines` (existing). |
| Technical scope | Server logic (no migration needed for `max+1`); interface for the form reset. A database default is an optional migration. |
| Business-rule impact | None (claim approval, route and receipt rules unchanged). |
| Acceptance checks | • Success: delete line 1 of 3 then add succeeds as line 4. • Failure: a forced error keeps the typed fields and shows a plain message. • Failure: submit with no lines is refused with a message. • Permission: another employee cannot add a line to my claim (RLS unchanged). |

#### D-06 Employee equipment request: reserving then issuing is refused by the system's own reservation

| Row | Entry |
|---|---|
| ID / priority | `D-06` · LB (equipment custody: the workspace tells the warehouse to reserve then give, and the second step fails or leaves the record wrong) |
| Verification | Confirmed (code) (checked by caller). Runtime check still advised for the counted-stock case. |
| Current behaviour | The request workspace lets the warehouse "Reserve" for an employee request (`request-view.tsx` RequestLines, `showReserve` not kind-specific; `lines-editor.tsx:96`) and says "When it is reserved, give it to the employee" (`requests/[id]/page.tsx`, last section); the Inventory workspace guidance "reserve, then give" shipped in PR #52 makes this user-visible. `inv_issue_to_employee` (M3 `:1750`) calls `inv_unit_reserved_by(u.id, now(), p_expected_return_at)` without `p_ignore_request` (the parameter exists, M3 `:327`), so a unit reserved for this very request raises "X is reserved for REQ and cannot be issued to a person for that period". For counted stock `inv_qty_free(...)` (M3 `:1771`) subtracts the request's own reservation, so issue fails unless extra shelf stock exists. The function never calls `inv_reservation_take`, so reservation `dispatched_qty` stays 0: Today keeps showing "ready to send" for a partly issued request. The existing RLS test (`inventory_stock.rls.test.ts` "marks an employee request fulfilled...") issues without reserving first, so reserve-then-issue is untested. |
| User problem | Warehouse operators following the on-screen guidance hit a refusal and must release their own reservation by hand; or the record stays "ready to send" after the item is out. The requesting department head sees wrong progress. |
| Proposed behaviour | In `inv_issue_to_employee`, when `p_request_id` is given: pass `p_ignore_request => <that request>` to the reserved-by and free-quantity checks, and call `inv_reservation_take(...)` for each unit and quantity so `dispatched_qty` moves exactly as in `inv_dispatch_to_project`; keep refusing units reserved for OTHER requests. If the owner prefers, the alternative is to hide the Reserve button for employee requests (owner question). |
| Before → after | Failure plus manual release of the own reservation (about 4 interactions) → 0 extra interactions; request moves to fulfilled. |
| Roles affected | Warehouse operators; department heads and managers requesting for employees; the employee receiving the equipment. |
| Data source | `inv_reservations`, `inv_requests`, `inv_movements` (append-only, unchanged). |
| Technical scope | Migration (function replace of `inv_issue_to_employee`); no interface change. |
| Business-rule impact | None. Booking conflicts are unchanged: units reserved by other requests are still refused; movement history stays append-only. |
| Acceptance checks | • Success: reserve a unit for an employee request then issue it; succeeds, reservation `dispatched_qty = 1`, request moves to fulfilled. • Success: counted stock reserved for this request issues without spare stock. • Failure: a unit reserved by a different request is still refused with the existing message. • Permission: only a warehouse operator at the location (or founder) can issue; replay with the same key returns the same result. |

#### D-07 Budget notices are created, but a Finance-only approver cannot see them

| Row | Entry |
|---|---|
| ID / priority | `D-07` · LB (the hand-off is recorded but not surfaced to a Finance-only approver, so the PM to Finance chain can stall silently; **corrected wording, see below; may be rated LI if Finance already checks the inbox daily**) |
| Verification | Confirmed (code) |
| Current behaviour | `pbx_notify` writes `project_budget_submitted` and `project_actuals_submitted` (`20261210000200:53-69,417-420`; `...0300:535-537`). They render only in `projects/work/page.tsx:165-185` via `proj_my_notifications`, which keeps only notices whose project the viewer participates in (`proj_user_is_participant`, `20261120000400:736-749,914`), and that page returns before the panel for anyone with no Projects grant (`work/page.tsx:50`). Finance is designed to need no project access. No e-mail, no nav badge, no My Day row (`page.tsx` imports no budget loader; `action-centre.tsx`). The PM's "returned / approved / ready to enter actuals" notices are likewise only in `/projects/work`. Finance can discover items only by opening the Finance inbox (`finance/project-budgets`). |
| User problem | **Correction:** the records are created (`pbx_notify` writes a `project_budget_submitted` / `project_actuals_submitted` notice for each approver at submission). The failure is **visibility**: the only reader, `proj_my_notifications`, returns a notice only when the viewer participates in that project, so a **Finance-only** or executive approver who is not on the project (and has no Projects grant) has the row but no screen that shows it. They see the item only by opening the Finance inbox. A PM who does not use `/projects/work` has the same gap for the decision notices. |
| Proposed behaviour | Add one row to the My Day "Needs your decision" list (existing `buildActionItems(extraItems)`): "Project budgets waiting for you: N" = count of `pbx_inbox()` rows where `i_can_decide` and not `on_hold`, plus settlement rows where `i_can_close` or `i_can_confirm_receipts`; link to `/finance/project-budgets?filter=...`; show the same count on the Finance nav entry. For the PM: a row "Budget returned for changes" / "Final expenses returned" read from the PM's own `pbx_budget_versions` and `pbx_actual_submissions` with status returned (small read function), or unread `project_budget_decided` notices read without the participant filter. A failed `pbx_inbox` shows an error row (D-02 pattern), never 0. |
| Before → after | Finance remembers to open the inbox (0 prompts) → 1 click from My Day to the filtered list. |
| Roles affected | Finance (budget grant), CEO/CTO executive approvers, PMs; a CEO who is also a PM sees both rows. |
| Data source | `pbx_inbox()` (already scoped by `pbx_accessible_company_ids`), `pbx_budget_versions`, `pbx_actual_submissions`, `notifications`. |
| Technical scope | Finance side interface only; PM side one new or extended read function (migration). |
| Business-rule impact | None (visibility only; who decides, independence and routing unchanged). |
| Acceptance checks | • Success: Finance with no Projects grant sees the count. • Failure: a failed `pbx_inbox` shows an error row, not 0. • Permission: only items the person can decide (not self-authored, not other company, not on hold) are counted; a user with no budget grant sees no row. |

#### D-08 A won enquiry with no handover submitted is shown to nobody

| Row | Entry |
|---|---|
| ID / priority | `D-08` · LB (the single handover is the start of delivery; a silent stall loses a won job; B rated "improvement (high)", I raise it under the "invisible hand-off" rule) |
| Verification | Confirmed (code) |
| Current behaviour | `crm_mark_won` cancels follow-ups, inserts only a legacy draft `crm_handovers` row and notifies nobody (`20261115000200:493-531`; zero `notifications` inserts in all CRM migrations). `attentionItems` kinds are only overdue, due_today, no_next_action, hold_review, no_first_response (`lib/crm/reports.ts:299-344`). After "Confirm as won" the person stays put (`crm.ts:216`) and won opportunities leave the default "Open" list (`opportunities/page.tsx:55`). A won job whose owner never opens "Handover package" is invisible to founders, `assign_pm` holders and the PM until the owner submits. |
| User problem | Sales owners forget; founders and PMs cannot see it; the client's project start slips unnoticed. |
| Proposed behaviour | (a) After "Confirm as won" (dialog, board, detail: 3 entry points) show "Prepare the handover now" with a button to the enquiry's `/handover` page. (b) Add attention item "Won, handover not submitted" for the owner on Sales Follow-ups "Needs attention" and My Day; for Sales founders and `assign_pm` holders of the company after N working days (N a setting, default 2). (c) Show handover state as a chip or column when filtering "Won". |
| Before → after | 0 prompts at win and silent loss → 1 prompt at win and a visible row within the day. |
| Roles affected | Sales owners and preparers, Sales founders, `assign_pm` holders; a person who is Sales owner and PM sees one row, not two. |
| Data source | `crm_opportunities.stage`, `proj_handovers` / `crm_handovers` (status null = not started), `proj_handover_for_opportunity`. |
| Technical scope | Interface plus server read logic; no migration. |
| Business-rule impact | None. The single handover is unchanged; nothing is created automatically; no new approval. |
| Acceptance checks | • Success: owner sees the prompt after Won and an attention row until submit; the row disappears when status becomes submitted. • Failure: if the Projects read fails the row says "Could not check the handover" (not hidden). • Permission: only the owner or a Sales founder sees the owner prompt; no Projects grant is needed to see the Sales-side row. |

#### D-09 Handover "PM asked a question" and "accepted" notices have no screen for a Sales-only owner

| Row | Entry |
|---|---|
| ID / priority | `D-09` · LB (a clarification loop that the owner cannot see stalls the single handover) |
| Verification | Confirmed (code) |
| Current behaviour | `proj_request_handover_clarification` and `proj_accept_handover` call `proj_notify(... p_require_member=false)` for the Sales owner and preparer (`20261120000200:330-336,417`). The `notifications` table is displayed only on My Work (`projects/work/page.tsx`), and My Work shows "no tasks for you" when the person has no Projects grant (`:50-56`). Sales owners normally hold only a CRM grant; the Projects module is hidden for them (`nav-groups.ts:226`). My Day shows no handover row without a Projects grant (`page.tsx:295`). The question appears only if the owner happens to open the enquiry's Handover page. |
| User problem | Sales owners and preparers; the handover sits in `clarification_requested`. |
| Proposed behaviour | Add "Handover: the PM asked a question" and "Handover accepted" as attention items on Sales Follow-ups and My Day for the owner and preparer, linking to the enquiry's handover page, using `proj_handover_for_opportunity` (already readable by CRM grantees, returns status and clarification note). Pair with D-08 so there is one "Handover" row family. |
| Before → after | Owner finds out by chance (unbounded) → a row on next visit to Follow-ups or My Day (0 extra clicks). |
| Roles affected | Sales owners and preparers; the PM who asked. |
| Data source | `proj_handovers`, `notifications`, `proj_handover_for_opportunity`. |
| Technical scope | Interface plus read logic; no migration. |
| Business-rule impact | None. |
| Acceptance checks | • Success: PM asks, owner sees a row on next visit; accepted notice also appears. • Failure: read error shows "Could not check handovers". • Permission: only the owner and preparer see the row. |

#### D-10 Deactivating an account does not make the person inactive to access and approval routing

| Row | Entry |
|---|---|
| ID / priority | `D-10` · LB (leavers stay PM, head, member and approver of record, so approvals wait for someone who cannot sign in) |
| Verification | Confirmed (code) (checked by caller: `set_account_status` updates `profiles.account_status` only; `people-access/data.ts:206` and module pickers filter on `profiles.is_active`; the resolver ignores account status) |
| Current behaviour | `set_account_status` updates only `account_status`, reason and changed-by (`20261104:148-215`); `deactivateAccount` bans sign-in (`account-status.ts:43-75`). `profiles.is_active` is never set false in app code or migrations (only tests do). Every module helper joins `p.is_active` (`proj_has_access`, `proj_user_eligible`, `proj_is_pm`, `pbx_route_approvers`, `crm_has_access`, `inv_can_browse`) and pickers filter on it (`data.ts:206`, `crm_staff_directory`). `resolve_approver*` ignores `account_status` (`20261018:13-116`) and picks the manager or the first-granted holder (`order by granted_at limit 1`). Result: a deactivated person stays selectable and eligible as PM, head, member, assignee and "last eligible CEO/CTO approver", and remains the approver of record. No admin sign-out is issued, and the reason prompt is `window.prompt` (`account-status-controls.tsx:76-103`). |
| User problem | Leavers who hold approver roles, PM or team head; everyone waiting on them. There is no re-route action for HR. |
| Proposed behaviour | 1. In `set_account_status` also set `profiles.is_active` (false on deactivate, true on reactivate) in the same transaction. 2. `resolve_approver` / `resolve_approver_for_company` / role checks skip inactive profiles. 3. Before the reason prompt, a panel "This person still: is PM of N live projects, heads M teams, is approver of record for K pending approvals, is the only CEO/CTO approver of company X, holds equipment" with the existing refuse-or-continue guards (refuse if sole executive approver or last active Sys Admin). 4. Replace `window.prompt` with an in-page reason field. 5. Call Admin `signOut` for the user after the ban. |
| Before → after | Remember to chase stalled approvals and picks by hand → the system lists what the leaver still holds and stops routing to them. Reason prompt: 1 browser dialog → 1 labelled field. |
| Roles affected | System Administrator (only role that can deactivate); HR Admin and line managers whose requests were routed to the leaver; a person who is both HR Admin and approver is the typical case. |
| Data source | `profiles`, `proj_projects`, `proj_teams`, `approvals`, `pbx_company_grants`, `inv_units` (existing). |
| Technical scope | Migration (function and helper changes), server action, interface. |
| Business-rule impact | None to approval or grant rules; it stops a person who cannot sign in from being the approver of record. **Owner to confirm** whether HR Admin should get a re-route action for approvals already pending on the leaver (that would change who may approve and is outside this entry). |
| Acceptance checks | • Success: a deactivated approver is no longer resolved; a new request routes to the next holder. • Failure: cannot deactivate the sole executive approver or last active Sys Admin; message names the company. • Permission: only a Sys Admin; self refused; reactivate restores everything. • RLS test: a deactivated user's token yields no rows after `is_active = false`. |

#### D-11 Every signed-in user can read every profile, including the deactivation reason

| Row | Entry |
|---|---|
| ID / priority | `D-11` · LB (confidentiality exposure of HR matters; confirm on the hosted system first) |
| Verification | Confirmed (code, hosted state unverified). I re-read `20260922000000_phase0_foundations.sql:274`: `profiles_select ... using (auth.role() = 'authenticated')`, the only SELECT policy on `profiles`. Hosted check: as an ordinary employee test session run `select status_reason, status_changed_by from profiles limit 5`, and read `information_schema.column_privileges` for `profiles` (read-only). |
| Current behaviour | Migration `20261104` added `status_reason` (admin free text, "Reason for deactivating this account", up to 500 characters), `status_changed_by`, `status_changed_at`, `account_status` to `profiles` without narrowing reads; no later migration narrows it. Any ordinary employee can query `profiles` through the API and read all e-mails, names, who is Deactivated and why. |
| User problem | Leavers (reasons can be misconduct); HR confidentiality. |
| Proposed behaviour | Move `status_reason`, `status_changed_by`, `status_changed_at` to a Sys-Admin-only table (or revoke column SELECT from `authenticated` and expose them through a Sys-Admin RPC). Keep name and e-mail directory readable (approver and manager pickers need it). People & Access reads the reason through the RPC. |
| Before → after | Readable by every employee → readable only by Sys Admin. No screen changes for ordinary staff. |
| Roles affected | All staff (exposed); Sys Admin (keeps access). |
| Data source | `profiles`, new restricted table or RPC. |
| Technical scope | Migration plus `people-access/data.ts` read. |
| Business-rule impact | None; tightens confidential data without changing anyone's legitimate access (company boundaries and confidential-data access are strengthened, not redefined). |
| Acceptance checks | • Success: Sys Admin still sees the reason on the Account tab. • Failure: a plain employee session gets null or denied for the three columns (verify on hosted with a real non-admin session). • Permission: approver and manager pickers still list names. |

#### D-12 "Advance still to be returned" shows the full advance before final expenses are approved

| Row | Entry |
|---|---|
| ID / priority | `D-12` · LB (a wrong money figure that drives Finance to chase staff while the event is still running; E rated "improvement", I apply the "misreport money" rule because the figure is wrong by definition) |
| Verification | Confirmed (code) |
| Current behaviour | `pbx_settlement_figures` computes spent only from APPROVED actuals; with none, `to_return = provided - returned - 0`. `SettlementSection` prints it unconditionally (`settlement-section.tsx:212` and the By-person table `:233`) and the Finance inbox "Advance to return" column does too (`inbox-list.tsx:271`), while the Summary tile gates correctly ("Known once the final expenses are approved", `workspace.tsx:60-66`). |
| User problem | Finance and PMs read "Advance still to be returned = full advance" for projects whose spending is not yet approved. |
| Proposed behaviour | Show "—" with the existing hint "Known once the final expenses are approved" in the Settlement section, By-person table and Finance inbox column until `has_approved_actuals`. Do not change the calculation. |
| Before → after | A misleading number on 3 surfaces → "—" and the same hint as the Summary tile. |
| Roles affected | Finance, PMs, CEO/CTO closers. |
| Data source | `pbx_settlement_figures` (`has_approved_actuals` already available). |
| Technical scope | Interface only. |
| Business-rule impact | None (settlement calculation untouched). |
| Acceptance checks | • Success: with funding and no approved actuals the three surfaces read "Known once the final expenses are approved". • After approval the figures equal the database. • Failure: if the figures call fails, `LoadError` appears, not a number. • Permission: unchanged (company-scoped). |

#### D-13 Attendance clock "Project lead" list contains only the person themself for an ordinary employee

| Row | Entry |
|---|---|
| ID / priority | `D-13` · LB (documented core daily path, "Site work" clock-in, cannot be completed properly by ordinary staff; self-selection silently changes the approval route) |
| Verification | Confirmed (code). I re-read `attendance-clock/page.tsx:73-88` and `employees_select` (`20261018000000_cto_role_parity.sql:152-165`: own row, `is_manager_of`, HR Admin, Finance, CEO/CTO, Sys Admin). `20261105000000_fix_employee_manager_name_visibility.sql` states that broadening the directory is "a separate, larger decision". A test account (employee with no reports) confirms on the hosted system. |
| Current behaviour | `colleagues` is read through the viewer's own session from `employees` for the company, so an ordinary employee gets only their own row. The same list feeds `ClockControls` (`clock-controls.tsx:148-156`: `<option>None</option>` plus colleagues, required for Site work `:66-67`) and `ResolveProjectLeadForm`. The database requires a lead for Site work (`attendance_segments` check; `validate_attendance_segment_inputs`, same company and active only). Choosing themself routes the request as `self_led_hr_direct` (independent HR review) instead of `employee_lead_then_hr`. No candidates function exists (searched `lead_candidates`, `project_lead_candidates`, `list_project_leads`). |
| User problem | An ordinary employee cannot name their real project lead; recovery credit routes to "awaiting a project lead" or to HR direct. |
| Proposed behaviour | Source the picker from a narrow SECURITY DEFINER function returning only id and display name of active same-company people (or of project leaders), as `get_employee_manager_name` already does for the manager's name. The clock and the resolve form use it. Fields and steps unchanged. `validate_attendance_segment_inputs` still rejects an ineligible lead. Owner to confirm who may be offered (Open question 4). |
| Before → after | Picker with 1 entry (themself) → picker with real names; selections unchanged (3). |
| Roles affected | Every employee who clocks in; project leads who receive the first approval step; people with no reports. |
| Data source | `employees` (via new narrow function), `attendance_segments`. |
| Technical scope | Migration (function) plus server and interface wiring. |
| Business-rule impact | **Owner decision; this spec does not propose changing the rule.** It touches only the clock's picker input; no attendance, Recovery Leave calculation or routing rule is changed, and HR reporting lines based on project leadership are untouched. Whether staff may see colleague names at all is an owner question. |
| Acceptance checks | • Success: a plain employee sees names of eligible colleagues. • Failure: people outside the company are never listed; an ineligible lead is rejected by the database. • Permission: the function returns only id and name; the employee still cannot read any other `employees` column. |

#### D-14 Recovery Leave approval cards are blank or missing for project leads and for CEO/CTO deciding an HR Admin's request

| Row | Entry |
|---|---|
| ID / priority | `D-14` · LB (approvals hand-off invisible to a decider on the CEO/CTO queue route; blank applicant name for leads) |
| Verification | Confirmed (code). I re-read `recovery_credit_requests_select` (`20261106000000...:1944-1951`: self, `is_manager_of`, `hr_admin` of the employee's company, project lead; no CEO/CTO branch) and the `recoveryApprovals` filter (`approvals/page.tsx:298-305`: a queue approval is kept only if the viewer could read its `recovery_credit_requests` row). Which people are on the CEO/CTO shared queue in real data is not verified: test with accounts. |
| Current behaviour | (1) A project lead who is an ordinary employee decides step 1 of route (a). The page reads the applicant's name from `employees` as the lead (`approvals/page.tsx:100-110`); the lead sees only themself and reports, so the name renders "—" (`:753`). The lead sees the evidence (RLS includes `project_lead_employee_id`) but not whose time it is. (2) A CEO/CTO is the decider for the shared queue (HR Admin applicant). Because they cannot read the request row, the card is filtered out and the page says "Nothing waiting on you right now" although the approval exists and the database would let them decide. The lifecycle RLS test exercises the RPC, not the page query. |
| User problem | Leads approve without knowing whose request; CEO/CTO never see an HR Admin's Recovery Leave request waiting for them. |
| Proposed behaviour | (1) Read the applicant's name through a narrow RPC like `get_employee_manager_name`. (2) Let the CEO/CTO decider read the minimum of the request they are authorised to decide: add a CEO/CTO company branch to the request read, or resolve the card through a SECURITY DEFINER function returning name, dates, evidence summary. RLS widening needs a confidentiality review. |
| Before → after | Blank name and invisible card → name shown and card listed; 0 extra steps. |
| Roles affected | Project leads (ordinary employees), CEO, CTO, HR Admin applicants; a person who is CEO and project lead sees both. |
| Data source | `approvals`, `recovery_credit_requests`, `employees` via narrow function. |
| Technical scope | Migration (function and/or policy) plus server logic. |
| Business-rule impact | **Owner decision; this spec does not propose changing the rule.** It does not change who approves or any Recovery Leave calculation; it widens the read of the request row for deciders the database already authorises (Open question 4). |
| Acceptance checks | • Success: a lead sees the applicant's name; a CEO/CTO outside the reporting chain sees the HR Admin applicant's card. • Failure: a CEO/CTO of another company sees nothing. • Permission: the beneficiary cannot decide their own request; only the minimum fields are exposed. |

---

### LI entries

#### D-15 Failed read of roles or employee row reads as "no role" and "no employee record" everywhere

| Row | Entry |
|---|---|
| ID / priority | `D-15` · LI (blast radius is large but only during a data outage and it fails closed; A rated LB, H rated LI, I follow H because nobody gains access and the screens mislead rather than hide a decision) |
| Verification | Confirmed (code) (I re-read the shared root, `lib/auth/session.ts:25-41`: `{ data: roleRows }`, `{ data: employee }` with no `error`) |
| Current behaviour | A failed `user_roles` read gives `grants = []`; a failed `employees` read gives `employeeId = null`. Consequences: every personal page prints "No employee record is linked to your account yet - nothing to show here." (`leave/page.tsx:29-41`, `reimbursements/page.tsx:21-31`, `attendance-clock/page.tsx:54-66`, `timesheets`, `performance`, `profile/page.tsx:12-25`); payroll says "Payroll export is restricted to HR Admin, Finance, CEO, and CTO." (`payroll/page.tsx:34-38`); `/employees/new` "You need the HR Admin role to add an employee."; admin layout "You need the System Administrator role to view this page."; `/alerts` "Alerts are restricted to HR Admin, CEO, and CTO."; `/audit-log` "The audit log is restricted to HR Admin and System Administrator."; `ClockChip` and the Clock tab vanish (`app-shell.tsx:64`); the user menu prints "No role assigned" (`user-menu.tsx:424`); the sidebar drops HR items. **Cross-reference:** this is the root cause of the already-documented People & Access outage wording (`docs/known-issues/people-access-outage-message.md`, `lib/people-access/data.ts:116-117`); not a separate report. |
| User problem | Everyone during an outage is told they have no role or no employee record and sent to "contact HR". |
| Proposed behaviour | `getCurrentSession` returns `loadFailed: true` when the roles or employee read errors (grants stay empty: still fail-closed). `AppLayout` renders one `LoadError` banner ("Could not load your account. This is a problem loading the information, not a missing right." with Retry); pages that branch on `session.employeeId` render `LoadError` instead of "No employee record is linked ...". `getProjectsContext`, `getCrmContext` and `getInventoryContext` already return `loadFailed`; do the same for HR. |
| Before → after | Misleading dead ends on about 12 pages → one banner and Retry. |
| Roles affected | Everyone; people with several responsibilities see one banner instead of several wrong messages. |
| Data source | `user_roles`, `employees`, `LoadError`. |
| Technical scope | Server logic and interface; no migration. |
| Business-rule impact | None (grants remain empty on failure; nobody gains access). |
| Acceptance checks | • Success: unchanged. • Failure: roles read stubbed to error, `/leave` says "Could not load", sidebar shows the banner, no role-gated page opens. • Permission: nobody gains access during failure. |

#### D-16 Failed read on money screens: "No claims", AED default, hidden Budget tab

| Row | Entry |
|---|---|
| ID / priority | `D-16` · LI (money entry, but fields stay editable and the database still validates; only appears during a read failure) |
| Verification | Confirmed (code) (I re-read `reimbursements/page.tsx:34-46` currency default) |
| Current behaviour | See sub-table. |
| User problem | An employee sees "No claims yet" and may start a duplicate; the claim form pre-fills the currency "AED" for a company that uses another currency (editable 3-letter free text, `new-claim-form.tsx:19`). A PM silently loses the Budget tab. |
| Proposed behaviour | `LoadError` on the reimbursement list, detail and lines; if the company or employee read fails show an error where the currency default would be, not "AED"; `loadProjectBudgetAccess` failure shows "Could not check budget access" in place of the missing tab; `loadOwnClaims` failure shows "Your claims could not be loaded" in the picker. Keep the deliberate "module not installed" quiet branch (`isBudgetNotInstalled`). |
| Before → after | 4 screens with false empties → explicit error with Retry. |
| Roles affected | Employees submitting claims; PMs; Finance. |
| Data source | `reimbursement_claims`, `reimbursement_claim_lines`, `companies`, `employees`, `pbx_*`. |
| Technical scope | Interface and server read logic. |
| Business-rule impact | None (physical receipt submission rule untouched). |
| Acceptance checks | • Failure: forced claims read error shows `LoadError`, not "No claims yet". • Failure: forced company read error shows an error, not a pre-filled AED. • Success: unchanged. • Permission: unchanged. |

| Screen | File:line | Behaviour on failed read |
|---|---|---|
| My claims | `reimbursements/page.tsx:34-46,100` | "No claims yet." |
| Currency default | `reimbursements/page.tsx:42` | defaults to AED |
| Claim detail | `reimbursements/[id]/page.tsx:27` | `notFound()` for any error; lines error: "No expense lines yet." |
| Budget tab for PM | `lib/budget/data.ts:52-56,65-75` | no Budget tab, silent |
| Own claims picker | `lib/budget/claims.ts` | empty list |
| Finance menu | `lib/budget/data.ts:56-74` | entry disappears |

#### D-17 Failed read in Inventory context, availability, names and labels

| Row | Entry |
|---|---|
| ID / priority | `D-17` · LI (an outage presents as "you have no access" or "0 available"; the database still refuses unsafe moves) |
| Verification | Confirmed (code) |
| Current behaviour | See sub-table. Inventory main pages already use `LoadError` and named failed sources; these are the exceptions. |
| User problem | Operators see "No warehouse or location has been set up", "Inventory is switched off", the wrong default warehouse; PMs see "Available 0", lose edit controls or the New request button; a printed label says "Equipment". |
| Proposed behaviour | Treat each as a load error (`LoadError`) or show "could not check your access". Carry `null` for availability ("could not be checked", shown as "—"). Throw on item, tracking, project and employee name reads in request and label pages (the request page already has a `LoadError` path). |
| Before → after | Wrong "no access" or "0" screens → explicit error; sticker printed only from a successful read. |
| Roles affected | Warehouse operators, PMs, department heads; a PM who is also an operator sees both. |
| Data source | `inv_locations`, `inv_company_settings`, `inv_operator_locations`, `proj_projects`, `inv_availability`, `inv_items`. |
| Technical scope | Server logic and interface. |
| Business-rule impact | None. |
| Acceptance checks | • Failure: forced `inv_locations` error shows `LoadError`, not "No warehouse ... set up". • Failure: forced `inv_availability` error shows "—". • Success: unchanged. • Permission: unchanged. |

| Place | File:line | Behaviour | Source |
|---|---|---|---|
| Context, second batch | `lib/inventory/context.ts:63-77` | locations empty: "No warehouse or location has been set up for your companies yet"; settings error: "Inventory is switched off for ..." (`requests/page.tsx:~96`); assignment error: wrong default warehouse (`working-location.ts`); PM count error: PM treated as non-PM (`context.ts:60`) | F-C-06 |
| Nav access | `context.ts:91-104` | module hidden or "coming soon" row (`nav-groups.ts:303`) | F-C-06, F-H-09 |
| Project equipment edit | `planning-data.ts:254-262` `canManageProjectEquipment` | `false` on any error: PM loses edit controls | F-C-06 |
| Requests page | `requests/page.tsx:72-82` | quick-add scope `.catch(() => null)`, `loadLiveProjects().catch(() => [])`: New request button vanishes; locations empty | F-C-06 |
| Availability | `stock.ts:176-181` | `usable: totals.get(i) ?? 0`: PM sees "Available 0" | F-C-07 |
| Names and tracking | `planning-data.ts:187-203,231`, `stock.ts` `loadNames` | failed `inv_items` read treats individual item as counted in Send out (`workspace.ts:41-58`); names "Item", "A project you cannot see", "An employee" | F-C-08 |
| Labels | `labels/page.tsx` itemsRes/binsRes | printed sticker says "Equipment"/"Stock" (cannot be recalled) | F-C-08 |
| My Day equipment card | `lib/my-day/loaders.ts:81` | card disappears when `ctx.loadFailed` | F-H-06 |
| Sales-check RPC | `today-data.ts:211-213` | 42883/42501/PGRST202 treated as "nothing to show" (documented as intended) | F-C |

#### D-18 Failed read in Sales/CRM context and pickers

| Row | Entry |
|---|---|
| ID / priority | `D-18` · LI (affects enquiry entry only during an outage; B rated e and f "blocker", I treat the whole theme as LI because nothing is lost and the database still validates; escalate if outages are expected at launch) |
| Verification | Confirmed (code) |
| Current behaviour | See sub-table. |
| User problem | "You do not have Sales access to any company yet" or "<company> has no Sales settings yet ... enquiries cannot be recorded" while Submit is disabled; empty organisation pickers so people create duplicate organisations; duplicate check silently skipped; My Day Sales card disappears. |
| Proposed behaviour | `getCrmContext` returns `loadFailed` for any read in the context (layout already renders `LoadError` for it); `loadSalesToday` returns `{status: "error"}` when `ctx.loadFailed` (2 lines); organisation list load error shows "Could not load organisations, try again" and disables creating new ones; duplicate-check rpc error shows "Could not check for duplicates" and asks for confirmation. |
| Before → after | Silent empty/disabled forms → explicit error and Retry. |
| Roles affected | Sales owners and founders; a PM who is also a Sales owner. |
| Data source | `crm_company_grants`, `crm_settings`, `crm_organisations`, `crm_find_similar_organisations`. |
| Technical scope | Interface plus read logic. |
| Business-rule impact | None. |
| Acceptance checks | • Failure: each read forced to error shows "Could not load ..." with Retry, never "none". • Success: unchanged. • Permission: unchanged. • Duplicate warning: an rpc error is visible. |

| Place | File:line | Behaviour |
|---|---|---|
| Context | `lib/crm/context.ts:62-70`, `lib/projects/context.ts:73-79` | settings null: "has no Sales settings yet", Submit disabled (`new-enquiry-form.tsx:259`); companies empty: "You do not have Sales access to any company yet" (`sales/new/page.tsx:21`); people empty: names "Former colleague"/"Unknown" |
| Quick add | `components/sales/quick-add-enquiry.tsx:18-20` | empty Agency and End client pickers |
| Duplicate check | `lib/actions/crm.ts:288-300`, `new-enquiry-form.tsx:220`, `quick-add-enquiry-form.tsx:56` | rpc errors swallowed |
| Reports and clients | `sales/clients/page.tsx:59,66-70`, `sales/reports/page.tsx:82-83` | loose contacts and reopened counts empty |
| My Day Sales card | `lib/crm/my-day.ts:29` | `grants: []` plus `loadFailed` read as `{status:"none"}`: card vanishes though the error UI exists (`page.tsx:359-360`) |
| On-demand reminders | `lib/crm/reminders.ts:76-86` | rpc error dropped with no log |

#### D-19 Failed read in navigation probes makes menu entries disappear

| Row | Entry |
|---|---|
| ID / priority | `D-19` · LI (a person cannot tell a missing right from an outage; nav was never enforcement) |
| Verification | Confirmed (code) |
| Current behaviour | `app/(app)/layout.tsx:41-63` runs four probes in `try/catch` around supabase-js, which returns `{ error }` and does not throw, so the `catch` is dead code for query errors: approvals badge `count ?? 0` (`:41-52`), CRM grants `if (!error)` (`:59-63`); `lib/projects/context.ts:127,132` (`if (g.error) return { grants: [] ...}`), `lib/inventory/context.ts:99-104`, `lib/budget/data.ts:65-75`. During an outage the Sales, Projects, Finance entries and Approvals link disappear and Inventory becomes the "Coming soon" row (`nav-groups.ts:303`). The comments say "Degrades to no access on any failure"; "table not installed" is acceptable, "any failure" is not. |
| User problem | Staff lose the menu and assume their access was removed. |
| Proposed behaviour | Keep "module not installed" quiet (codes 42P01/42883/PGRST205/PGRST202). On any other error show one notice "Some menu items could not be loaded. Reload." and keep the module's entry visible where a previous value exists; check `.error` instead of relying on `try/catch`. |
| Before → after | Silent disappearance → one notice. |
| Roles affected | Everyone with Sales, Projects, Finance, Inventory or Approvals access. |
| Data source | Existing probes. |
| Technical scope | Server logic and interface. |
| Business-rule impact | None (nav is cosmetic; backend enforcement unchanged). |
| Acceptance checks | • Failure: forced grants error shows the notice and does not drop entries silently. • Success: unchanged. • Permission: a person without a grant still sees no module. • "Not installed" environments stay quiet. |

#### D-20 Failed read on HR records, Alerts, employee list and attendance clock

| Row | Entry |
|---|---|
| ID / priority | `D-20` · LI (HR-only or read-only effects; Alerts is where Recovery Leave and expiry alerts surface, so raise it if staff are told to rely on it) |
| Verification | Confirmed (code) |
| Current behaviour | See sub-table. Quote: "Nothing needs attention right now. No contracts, documents, or probation periods are due within the next 30 days." (`alerts/page.tsx:225`). |
| User problem | HR sees no alerts, no employees; a clocked-in person is shown "Not started" with Clock in buttons; HR/CEO overview shows 0 employees. |
| Proposed behaviour | `LoadError` for the Alerts reads (separate "not HR" from "failed" for `recovery_scheduler_status`), `/employees`, `/employees/[id]` (call `notFound()` only when the read succeeded with no row), policies, holidays, letters, audit-log, ai-suggestions and the 24 profile section files; HR overview sets `hrSectionError = true` when the companies read fails; clock shows "Clock status could not be checked. Reload before clocking in" and disables Clock in until a successful read (the database already blocks a second open session, `attendance_sessions_one_open_per_employee`). |
| Before → after | False empties on about 15 screens → explicit error; clock confusion removed. |
| Roles affected | HR Admin, CEO, CTO, managers, every clocking-in employee. |
| Data source | Existing reads; `LoadError`. |
| Technical scope | Interface only (server components). |
| Business-rule impact | None (attendance rules untouched; display only). |
| Acceptance checks | • Failure: each read forced to error shows the error component and a logged error; no screen shows 0 or "No ..." for an errored read. • Success: unchanged. • Permission: unchanged. • Clock: Clock in is disabled on an unknown state. |

| Screen | File:line | Behaviour | Source |
|---|---|---|---|
| Alerts | `alerts/page.tsx:35-76,222-225` | five reads unchecked; "Nothing needs attention"; processor banner dropped because "RPC error" treated as "not HR" | F-H-08 |
| Employees list | `employees/page.tsx:44,80-81,179` | "No employees match these filters." | F-H-10 |
| Employee profile | `employees/[id]/page.tsx:60-69,81-85` | 404 on error; 17 sibling sections 0 error handling | F-H-10, F-A-05 |
| My Day HR overview | `page.tsx:89-96`, `:436-461` | `allCompanies = []` and `hrSectionError` stays false: Employees 0, Present 0 | F-A-03 |
| Attendance clock page | `attendance-clock/page.tsx:73-100` | `openSession` error: not clocked in, Clock in shown | F-H-11 |
| Attendance clock card | `attendance-clock-card.tsx:33-38` | `recovery_live_summary` error: "Not started" | F-A-06 |
| Header clock badge | `layout.tsx:21-33` | same pattern | F-H-11 |
| Policies, holidays | `policies/page.tsx:20-31`, `holidays/page.tsx:25-30` | "No policies yet.", "No holidays on the calendar yet." | F-A-05 |
| Letters | `letters/page.tsx` (8-10 reads, 0 checks) | "No letters yet." | F-A-05 |
| Audit log, AI suggestions | `audit-log/page.tsx:92-97`, `ai-suggestions/page.tsx:21` | "No activity matches these filters.", "No pending AI suggestions." | F-people-hr-02 |
| Payroll, other | `payroll/page.tsx:27-39` ("restricted"), `payroll/[id]` (404), `performance`, `timesheets`, `admin/companies:12` ("No companies yet.") | denial or empty | F-A-05, F-G-13 |
| Leave accrual cron | `leave-accrual/route.ts:152,166,175` | a failed `balances` read makes the `max_balance_days` cap compute against 0 (surfaces once D-01 is fixed) | F-people-hr-02 |

#### D-21 My Day count, hero line and primary button ignore queue-routed approvals

| Row | Entry |
|---|---|
| ID / priority | `D-21` · LI (HR Admin and CEO/CTO already have the sidebar Approvals link by role, so work is findable; the My Day answer is wrong) |
| Verification | Confirmed (code) |
| Current behaviour | `page.tsx:105-109` and `layout.tsx:44-49` filter `.eq("approver_id", userId)`. `/approvals` also fetches `approver_id is null` rows and narrows with `queueDecisionEligible` (`approvals/page.tsx:34-37,290-310`; comment lines 22-33 explain Recovery Leave queue steps have `approver_id` null). Result: an HR Admin with Recovery Leave requests in the queue sees "Nothing needs your attention right now." and no primary "Review approvals" button, while `/approvals` has work. No count badge on the nav row (F-people-hr-21). |
| User problem | HR Admins, CEO/CTO. |
| Proposed behaviour | The My Day count and the sidebar condition use the same eligibility function as the page (shared helper or SECURITY DEFINER count); a requester never counts their own queue row; show the count on the nav row. |
| Before → after | 0 shown while N waiting → N shown; 1 fewer detour. |
| Roles affected | HR Admin, CEO, CTO. |
| Data source | `approvals`, existing `queueDecisionEligible` logic. |
| Technical scope | Server logic (share the function). |
| Business-rule impact | None (Recovery Leave routing unchanged; a count only). |
| Acceptance checks | • Success: HR sees N including queue rows. • Failure: a failed count shows "—" (D-02). • Permission: a requester or beneficiary never counts their own queue row. |

#### D-22 `preflight_phase2b_v2_policy_status()` returns seeded draft policy values to every signed-in user

| Row | Entry |
|---|---|
| ID / priority | `D-22` · LI (provisional: unadopted company rule values, no personal data; becomes LB if the drafts hold compensation or confidential terms; exposure is certain only after the hosted check) |
| Verification | Confirmed (code, hosted state unverified): live EXECUTE privileges are not visible to me. Read-only hosted check: `select has_function_privilege('authenticated','public.preflight_phase2b_v2_policy_status()','execute'), has_function_privilege('anon','public.preflight_phase2b_v2_policy_status()','execute')`, and call it from a non-HR test session. |
| Current behaviour | SECURITY DEFINER, `language sql`, no role check, no `revoke ... from public` anywhere in the migrations (`grep preflight_phase2b` finds only its definition, `20261103000000_phase2b_v2_policy_drafts.sql:333`). The Policies page calls it for every viewer (`policies/page.tsx:30`, comment "safe to call even for a viewer with no drafting rights"). It returns status, `effective_from` and `critical_values` of seeded drafts (leave-type accrual, max balance, carry-over, notice, probation), bypassing `policy_versions_select`. |
| User problem | Any signed-in employee, including in other companies, can read not-yet-adopted policy values. |
| Proposed behaviour | Add `if not (has_role_any_scope('hr_admin') or has_role('ceo') or has_role('cto')) then return;` or revoke EXECUTE from public, anon and authenticated and grant to a gated wrapper; the page calls it only when `canDraftAnywhere`. |
| Before → after | Visible to all signed-in users → visible to those who may draft. |
| Roles affected | All staff (exposed); HR Admin and CEO/CTO keep it. |
| Data source | `policy_versions`, the function. |
| Technical scope | Migration. |
| Business-rule impact | None to leave rules or calculations. |
| Acceptance checks | • Success: HR Admin sees the same rows. • Failure/permission: a no-grant employee gets 0 rows or an error. • RLS test added in `packages/rls-tests`. |

#### D-23 Employee can download a letter that is still "pending approval"

| Row | Entry |
|---|---|
| ID / priority | `D-23` · LI (control bypass, not a loss; becomes LB if letter templates carry salary, which I did not check) |
| Verification | Confirmed (code). I re-read `letters/page.tsx:45-60`: a 5-minute signed URL is created for every letter with `file_path` regardless of `status` (storage policy not verified). Hosted check: `select policyname, qual from pg_policies where schemaname='storage' and tablename='objects'` for the `letters` bucket. |
| Current behaviour | `issueLetter` stores the PDF and sets `file_path` before approval (`lib/actions/letters.ts:84-112`; templates default `requires_approval`, `:41`, initial status `pending_approval`, `:108`); `letters_select` storage policy has no status condition (`20260929:77-84`); `generated_letters_select` lets the employee read their own row in any status. The Download link appears beside the "pending approval" badge (`:178`). After rejection or void the file may remain downloadable. |
| User problem | An employment or salary letter that needs CEO sign-off is in the employee's hands before it is signed off. |
| Proposed behaviour | Employees see Download only when `status = 'issued'`; HR keeps downloading drafts for review. Ideally the storage read also checks status via a view or RPC. |
| Before → after | Download visible in 3 statuses → in 1 (issued). |
| Roles affected | Employees; HR Admin; CEO/CTO approvers. |
| Data source | `generated_letters`, storage bucket `letters`. |
| Technical scope | Interface now; migration for the storage policy. |
| Business-rule impact | None (enforces the existing sign-off). |
| Acceptance checks | • Success: after CEO approval the link appears. • Failure/permission: a pending letter shows status text with no Download; a direct storage URL attempt while pending is refused (needs the storage-policy change). • HR can still download for review. |

#### D-24 Document-expiry reminders have no rules, no reader and no recipient screen

| Row | Entry |
|---|---|
| ID / priority | `D-24` · LI (reminders cannot reach anyone even after D-01 is fixed) |
| Verification | Confirmed (code) |
| Current behaviour | `document-expiry/route.ts:66-84` sends reminders only for `applicableRules` from `document_expiry_reminder_rules`; no seed row exists anywhere (searched `supabase/`, `schema/`, `scripts/`) and no screen creates one. Without rules the job only updates `employee_documents.status` with a 30-day fallback. Even with rules, reminders go to `notifications` (`:114-120`, type `document_expiring`) and the only reader (`proj_my_notifications`) keeps `type like 'project\_%'` (`20261120000400:902-918`), so nothing displays them. Ordinary employees are not told their own document is expiring; the only surfaces are `/alerts` (HR/CEO/CTO) and the profile Documents tab. |
| User problem | HR and employees miss document expiries. |
| Proposed behaviour | (a) HR-only "Document reminders" settings (document type, lead days, per company) with default rows; (b) show the employee's own expiring documents on their profile and My Day and in the future notices list, using the existing mail helper for the reminder; (c) fix D-01 separately; this entry is needed even after D-01 is fixed. |
| Before → after | No reminder reaches anyone → reminders visible to the employee and HR. |
| Roles affected | HR Admin, employees, CEO/CTO (see D-58). |
| Data source | `document_expiry_reminder_rules`, `employee_documents`, `notifications`. |
| Technical scope | Interface, server logic, seed migration. |
| Business-rule impact | None to existing rules; introduces a configurable lead time (owner to confirm lead days). |
| Acceptance checks | • Success: a document inside lead days shows for the employee and HR. • Failure: a failed notice insert does not mark the reminder sent (D-25). • Permission: an employee sees only their own documents. |

#### D-25 Scheduled jobs: no run visibility, "sent" marker before the reminder, `CRON_SECRET` not checked

| Row | Entry |
|---|---|
| ID / priority | `D-25` · LI (becomes urgent once D-01 is fixed, because five jobs start running with no signal) |
| Verification | Confirmed (code) |
| Current behaviour | Only the Recovery processor has staff-visible health (`recovery_processor_runs`, `/alerts` banner, `alerts/page.tsx:123-151`). Other jobs report an HTTP status in Vercel only. `document-expiry/route.ts:96-122` inserts `document_expiry_reminders_sent` first, then `notifications`; a failed notice insert leaves the reminder marked sent forever. `generateRemindersThrottled` drops RPC errors without logging (`lib/crm/reminders.ts:81`). `lib/cron/auth.ts:27-31` returns false when `CRON_SECRET` is unset, so every cron call is 401 with no log; `lib/config-check.ts:7` checks only two settings. `leave-accrual`'s `ambiguousBaselines` and `blockedEntitlementConfig` (employees skipped on purpose) appear only in the JSON. |
| User problem | HR cannot tell that accrual skipped an employee or that a job did not run; an employee with a blocked baseline gets no accrual and no alert. |
| Proposed behaviour | A small `job_runs` table written by a shared wrapper in `lib/cron/` (name, started/finished, status, counts, truncated `failures[]`, skipped list); "Last run / status" per job beside the processor banner on `/alerts` for HR Admin and Sys Admin, amber when a monthly job is overdue (more than 35 days). In document-expiry insert the "sent" marker only after the notice succeeded (or in one RPC). Log the on-demand reminder error and a one-line "CRON_SECRET missing". Wrong-secret 401 hits are not logged as runs. |
| Before → after | Failures visible only in Vercel logs → one row per job on `/alerts`. |
| Roles affected | HR Admin, Sys Admin. |
| Data source | New table; existing routes. |
| Technical scope | Migration, server logic, one banner. |
| Business-rule impact | None (calculations untouched). |
| Acceptance checks | • Success: a forced failing run shows red on `/alerts`. • A missed monthly run turns amber. • Permission: non-HR roles see nothing. • A failed notice insert leaves the reminder unsent. |

#### D-26 Leave and approval e-mails fail silently and `notifications` has no reader

| Row | Entry |
|---|---|
| ID / priority | `D-26` · LI (e-mail is best-effort and is the only signal for leave decisions; employee never learns of a failure) |
| Verification | Confirmed (code) |
| Current behaviour | Leave e-mails use Microsoft Graph best-effort; recipient e-mail and name reads are ignored on error (`lib/email/leave-notifications.ts:44,60-66`); failures are not shown to anyone; `notifications` has no UI reader for non-project types (D-24). Recovery Leave approvers get no e-mail or notice at all (`recoveryCredit.ts`, `attendanceClocking.ts`: no `notify`). Whether Graph is live at launch is an open question (H Q3). |
| User problem | Employees are not told their leave was approved or rejected if the e-mail fails; approvers are not told of Recovery Leave requests. |
| Proposed behaviour | Use `notifications` as the in-app channel: read "Your leave request was approved/rejected" and "Document expiring" into My Day and a bell (the new-functionality part is in the N register); log Graph failures to the `job_runs`-style table so HR sees "mail not configured". |
| Before → after | E-mail is the only signal → e-mail plus an in-app notice. |
| Roles affected | Employees, line managers, HR. |
| Data source | `notifications` (`notifications_select` RLS exists), `lib/email/leave-notifications.ts`. |
| Technical scope | Interface plus a migration-free reader; server logic for the log. |
| Business-rule impact | None (no recipients change; no approval rule). |
| Acceptance checks | • Success: employee sees the decision in-app. • Failure: Graph failure is logged and visible to HR. • Permission: a person sees only their own notices. |

#### D-27 Sign-in `next` accepts protocol-relative targets

| Row | Entry |
|---|---|
| ID / priority | `D-27` · LI (security hygiene, one line; an attacker needs a crafted link and a user who signs in) |
| Verification | Confirmed (code). I re-read `lib/actions/auth.ts:33`: `redirect(parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/")`. |
| Current behaviour | `startsWith("/")` allows `//other.example` and `/\\other.example`, so a post-sign-in redirect can go off-site. |
| User problem | A phishing link on the sign-in page can send a signed-in user to another site. |
| Proposed behaviour | Require `startsWith("/") && !startsWith("//") && !startsWith("/\\")`. |
| Before → after | Off-site redirect possible → refused, goes to `/`. |
| Roles affected | All users. |
| Data source | None. |
| Technical scope | Server logic, one line, plus a test. |
| Business-rule impact | None. |
| Acceptance checks | • Success: `/leave` redirects to `/leave`. • Failure: `//evil.example` redirects to `/`. • `/\\evil.example` redirects to `/`. |

#### D-28 Two return screens with opposite safety defaults; return review wording contradicts the database for "fair"

| Row | Entry |
|---|---|
| ID / priority | `D-28` · LI (the safe-return design belongs to the new-functionality register; today the database stays safe if the operator chooses correctly; C rated the design LB) |
| Verification | Confirmed (code) |
| Current behaviour | The workspace `ReceiveStep` (`receive-step.tsx`) starts with nothing ticked, requires a condition ("Choose a condition for ...") and badges "Available again" / "Held, not available". The Stock "Return" form and the project-page button "Record a return" (`projects/[id]/equipment/page.tsx:143`) start every line at **Good** (`stock-candidates.ts:71`, `emptyDraft`) with "Add all" (`lines-editor.tsx:206`). The database trusts the caller: `inv_return_from_project` only validates the value (`inv_valid_condition`); units `good` or `fair` are available at once, counted stock only `good` (M3:1986-2008). Wording: `describeLine` says only "good" is "available" (`stock-movements.ts:491`) and the return review counts `d.condition !== "good"` as "Held back" (`:554`), but `fair` units become available immediately (M3:1989); the dropdown correctly says "Fair: available now" (`lines-editor.tsx:262`). |
| User problem | Warehouse operators on the older screens can mark a damaged unit available by leaving the default; the review contradicts the form. |
| Proposed behaviour | Wording now: make the review use `returnOutcome()` (`workspace.ts:220`) everywhere so "fair" reads "available". Safe default: route both entry points to the same workspace screen (nothing pre-ticked, condition required) as part of the return-confirmation design (N register). |
| Before → after | 2 screens with different safety → 1 behaviour; review text matches the database. |
| Roles affected | Warehouse operators; next requester of the same units. |
| Data source | `inv_units.condition`, `inv_return_from_project`. |
| Technical scope | Interface only for wording and defaults; any database refusal of `good` for flagged units is a migration and an owner decision. |
| Business-rule impact | None (movement history and booking conflicts untouched); whether the database should enforce a held state is an owner question. |
| Acceptance checks | • Success: a `fair` line reads "available now" in the review. • Failure: a return with an unchosen condition is refused on every screen. • Permission: only operators at the location can record. |

#### D-29 Employee request: "Expected back (optional)" is required to submit

| Row | Entry |
|---|---|
| ID / priority | `D-29` · LI (a failed submit after the person already added lines) |
| Verification | Confirmed (code) |
| Current behaviour | `requests-quick-add.tsx:105` labels "Expected back" optional for employee requests; `inv_plan_window` sets `o_until := null` when only one date is given and `inv_submit_request` raises "Set the planning dates (at least a start and an end)" (M4:748-770). Draft creation succeeds, submit fails. |
| User problem | Department heads and warehouse staff requesting for an employee lose the lines' progress to a late refusal and a return trip to the dates form (about 4 interactions). |
| Proposed behaviour | Smallest: label it "Expected back" and mark it `required` in the employee form with help text "Needed to submit". Alternative (owner choice): derive the end date in `inv_submit_request`. |
| Before → after | 1 failed submit plus about 4 interactions → 0. |
| Roles affected | Department heads with `request_for_employees`, warehouse staff. |
| Data source | `inv_requests`. |
| Technical scope | Interface only (label and required). |
| Business-rule impact | None. |
| Acceptance checks | • Success: with both dates it submits. • Failure: without the second date the form refuses before creating the draft with an explanation. • Permission: unchanged. |

#### D-30 Fulfilled requests, cancelled-with-equipment-out and finished projects have no "Receive back" link

| Row | Entry |
|---|---|
| ID / priority | `D-30` · LI (capability exists by direct URL and via Stock; link missing) |
| Verification | Confirmed (code) |
| Current behaviour | `RequestEditor` offers "Open the workspace" only when `live` (submitted/in_progress) (`request-view.tsx:53,92`). After the last line is dispatched the status is `fulfilled` (M3:700-706), so neither the request panel nor the project page offers the workspace. Today shows the row only when the expected return is within 9 days (`today-data.ts:29,99-101`; `today.ts:207`). The project page button "Record a return" is hidden once the project is completed or archived (`warehouse = !finished && ...`, `equipment/page.tsx:95,143`) although the same page prints "The project is completed but equipment is still out". Direct URL `/inventory/requests/{id}?step=back` works for any status. |
| User problem | Warehouse operators cannot reach the return of equipment that is out after a normal full dispatch or after a project closes. |
| Proposed behaviour | Show "Receive back" on any project request with outstanding equipment regardless of status or project state, pointing to `?step=back`; keep it warehouse-only (drop `!finished`); no link for a PM on a completed project. |
| Before → after | Direct URL or Stock form (3 screens) → 1 click. |
| Roles affected | Warehouse operators; PMs see status only. |
| Data source | `inv_requests`, `inv_project_equipment`. |
| Technical scope | Interface only. |
| Business-rule impact | None (completion still does not return equipment). |
| Acceptance checks | • Success: a fulfilled request with a unit out shows the link. • A completed project with equipment out shows it to a warehouse operator. • Permission: a PM sees no link; a cancelled request with equipment out keeps its link. |

#### D-31 Today's request queue filters by pickup warehouse, not by where stock is reserved

| Row | Entry |
|---|---|
| ID / priority | `D-31` · LI (a job can be invisible to the operator who must send it) |
| Verification | Confirmed (code) |
| Current behaviour | `today-data.ts:86` filters `pickup_location_id = working OR null`. The Reserve dialog lets the operator choose any location ("Reserve from", `lines-editor.tsx`) and dispatch requires the unit at the chosen location (`inv_unit_block_reason`, M3:308-326). A request with pickup A reserved partly at B is missing from B's Today. |
| User problem | The operator at B is never shown the job. |
| Proposed behaviour | Also include requests with an active undispatched reservation whose `location_id = working` (second query or `inv_reservations` join), without duplicating the row in A when A has nothing. |
| Before → after | Invisible → listed in B's Today. |
| Roles affected | Warehouse operators at several locations. |
| Data source | `inv_reservations`, `inv_requests`. |
| Technical scope | Server logic only. |
| Business-rule impact | None. |
| Acceptance checks | • Success: pickup A with a unit reserved at B appears in B's Today. • No duplicate in A when A has nothing. • Permission: operators see only their locations. |

#### D-32 Consumable lines can be reserved but Send out cannot send them

| Row | Entry |
|---|---|
| ID / priority | `D-32` · LI (technology templates contain cables and tape) |
| Verification | Confirmed (code) |
| Current behaviour | `inv_reserve` counted path has no consumable check (M4:~1040); Send step lists a counted box for them (`sendItemsOf`, `individual` false); `inv_dispatch_to_project` refuses: "X is a consumable. Record its use with Consume, not Dispatch" (M3:1913-1914). No hint on screen, no flag in `sendFlags` (`workspace.ts:75`). |
| User problem | Operators hit the refusal at the last moment. |
| Proposed behaviour | In Send out show consumable lines with a "Use up" button prefilled with project and request, or flag them "use Consume" before review. |
| Before → after | Refusal then search through Stock → item → "Use up" (4 interactions) → 1 prefilled button. |
| Roles affected | Warehouse operators, PMs. |
| Data source | `inv_consume` (takes the reservation with `p_also_return = true`, M3:2338). |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | • Success: a consumable line shows "Use up" prefilled. • Failure: no unexplained refusal. • Permission: unchanged. |

#### D-33 Rented counted stock cannot be dispatched against the request that asked for it

| Row | Entry |
|---|---|
| ID / priority | `D-33` · LI (verify first; rented individual units work) |
| Verification | Needs runtime confirmation |
| Current behaviour | Counted reservations come from OWNED free quantity (`inv_qty_free(..., p_rental=false)`, M4:~1070); a shortage is marked "need to rent"; rented stock is received (`inv_receive_stock p_rental`). Dispatch against the request: `inv_reservation_take` needs an active reservation (M3:1923-1926) so the operator gets "Only 0 of X is reserved for request ... Reserve the rest first", and reserving more is impossible because owned stock is short. The only route is the "unplanned dispatch (exception)", which "does not fulfil this request" (`send-step.tsx`). |
| User problem | Rental-fed jobs cannot be completed cleanly; the request never shows fulfilled. |
| Proposed behaviour | Allow `inv_reserve` to reserve rental stock of a rental that names the project or request, or let `inv_dispatch_to_project` accept `rental_id` lines against a "need to rent" shortage. |
| Before → after | Exception dispatch and a request that never fulfils → normal dispatch. |
| Roles affected | Warehouse operators, PMs. |
| Data source | `inv_rentals`, `inv_balances`, `inv_reservations`. |
| Technical scope | Migration. |
| Business-rule impact | None if booking conflicts keep counting rental stock separately (do not alter). Owner question 6 in C. |
| Acceptance checks | • Success: rented counted stock sent against the request that asked for it. • Failure: unreserved quantity is still refused. • Permission: unchanged. |

#### D-34 A unit that becomes held keeps its reservation for a later request and nobody is told

| Row | Entry |
|---|---|
| ID / priority | `D-34` · LI (the failure surfaces at dispatch, the last moment) |
| Verification | Confirmed (code) |
| Current behaviour | Planning allows reserving units that are out on a project and "returning on time" (`inv_unit_free`, M2:62-75). If such a unit returns `damaged`/`needs_inspection` (`inv_return_from_project`, M3:1983-1989) or is later set by `inv_check_condition` (M3:2780-2790), the later request's reservation stays active: `inv_line_progress` counts it as reserved (`reserved_for_window`, M4:1852-1870, no condition test), so the request shows "ready to send", the PM sees no shortage, Today says "ready to send". Dispatch then fails with "X is damaged and is held back until it has been inspected" (M3:317-319). No re-plan or notice exists. |
| User problem | PMs and operators learn at dispatch that planned equipment is unusable. |
| Proposed behaviour | Flag lines whose reserved unit is no longer free (computed with the existing `inv_unit_free`) as "Needs replacement" on the Today row and as a shortage on the request, plus one "Swap unit" action that releases that reservation and reserves another free unit (existing `inv_release_reservation` and named `inv_reserve`). |
| Before → after | Found at dispatch → flagged days earlier with 1 action to swap. |
| Roles affected | Warehouse operators, PMs. |
| Data source | `inv_unit_free`, `inv_reservations`, `inv_release_reservation`, `inv_reserve`. |
| Technical scope | Server logic and interface. |
| Business-rule impact | None. Booking conflict logic is correct and unchanged. |
| Acceptance checks | • Success: a reserved unit that returns damaged flags the line and offers Swap. • Failure: Swap refused when no free unit exists, with the reason. • Permission: operators at the location only. |

#### D-35 Inventory nav and page gate are stricter than the database for acting PMs and team heads

| Row | Entry |
|---|---|
| ID / priority | `D-35` · LI (people with legitimate database rights are told "You do not have Inventory access") |
| Verification | Confirmed (code) |
| Current behaviour | `inv_can_browse` admits project PMs, `acting_pm` members and team heads of live projects (`20261201000100:473-488`); `inv_can_edit_request` admits `proj_can_manage` (PM, acting PM, founder). The app computes `managesProjects` from `proj_projects.pm_user_id` only (`inventory/context.ts:60`, `loadInventoryNavAccess` `:97`), although comments (`context.ts:32`, `nav-groups.ts:84-87`) say "Project Manager / department head". An acting PM or team head with no Inventory grant has no Inventory row, and `/inventory/stock` says "You do not have Inventory access. Ask an Inventory founder..." (`stock/page.tsx:50-57`). A team head also has no write path (needs `proj_can_manage`). Line managers: SQL allows creating an employee request but the UI never offers it and RLS then hides it from them (`inv_can_see_request`, `20261201000200:224-236`). |
| User problem | Acting PMs and team heads cannot see equipment for their project. |
| Proposed behaviour | Compute `managesProjects` as "PM, acting PM or team head of a live project" (the predicate of `inv_can_browse`) in both loaders, so those people see Stock and Requests as the database allows. Whether team heads may prepare project equipment lists, and whether line managers may request for reports, are owner questions; do not add rights here. |
| Before → after | No nav row and a denial page → Inventory row and Stock for the 3 relationships (acting PM, team head, PM). |
| Roles affected | PMs, acting PMs, department/team heads; line managers (decision). |
| Data source | `proj_projects`, `proj_project_people`, `proj_teams`, `inv_can_browse`. |
| Technical scope | Interface and server read only. |
| Business-rule impact | None (no new rights; nav mirrors existing database rights). |
| Acceptance checks | • Success: an acting PM sees Requests; a team head sees Stock. • Failure: an ordinary member sees no Inventory row. • Permission: write controls still follow `proj_can_manage`. |

#### D-36 Budget or settlement "on hold" (no independent approver) is silent and incomplete

| Row | Entry |
|---|---|
| ID / priority | `D-36` · LI (the item stalls but only visible to people who open the record) |
| Verification | Confirmed (code) |
| Current behaviour | `pbx_approval_on_hold` flags it, visible only to people who can open the record or inbox; the message says "The owner needs to give a CEO or CTO approver access for this company" (`projectBudget.ts:430`) but nobody is notified and "owner" is not identified. Settlement on the executive route with no eligible approver has no hold flag; the inbox says "Closed by the CEO or CTO approver (Finance submitted the expenses)" (`inbox-list.tsx:276`). |
| User problem | Finance and PMs wait without a named person to fix it. |
| Proposed behaviour | Show the hold banner on the settlement too and include on-hold items in the My Day count for people with `manage_access` (they can fix it by granting access); name that role in the message. Nothing auto-approves. |
| Before → after | Silent → counted and named. |
| Roles affected | `manage_access` holders, Finance, PMs. |
| Data source | `pbx_inbox`, `pbx_approval_on_hold`, `pbx_can_close_settlement`. |
| Technical scope | Interface plus a small read change. |
| Business-rule impact | None (nothing is auto-approved; independence preserved). |
| Acceptance checks | • Success: a `manage_access` holder sees the hold count. • Failure: no row for people without the grant. • Permission: counts only own company. |

#### D-37 Status text says "Finance" when the CEO/CTO decides

| Row | Entry |
|---|---|
| ID / priority | `D-37` · LI (wrong name of the decider on budget screens and notices) |
| Verification | Confirmed (code) |
| Current behaviour | `VERSION_STATUS_LABELS.submitted = "Waiting for Finance"` (`projectBudget.ts:92`) is used by `StatusPill` for every version and actual submission (`shared.tsx:38-40`, `budget-section.tsx:135`, `actuals-section.tsx:386`) even when `approval_route = 'executive'`. Notices say "submitted for Finance approval", "was approved by Finance", "Finance closed the settlement" (`lib/projects/notification-text.ts:79-96`) regardless of route or actor. The inbox badge handles the route correctly (`inbox-list.tsx:217`). |
| User problem | PMs chase Finance when the CEO/CTO decides. |
| Proposed behaviour | Label from `approval_route` (use `APPROVER_NAME`); put the decider's name in notices (payload carries the decision; add route and actor). |
| Before → after | Wrong name → correct name. |
| Roles affected | PMs, Finance, CEO/CTO. |
| Data source | `pbx_budget_versions.approval_route`. |
| Technical scope | Interface (plus a payload field). |
| Business-rule impact | None. |
| Acceptance checks | • Success: executive-route versions read "Waiting for the CEO or CTO". • Finance-route read "Finance". • Permission unchanged. |

#### D-38 Budget currency is free text and cannot be changed

| Row | Entry |
|---|---|
| ID / priority | `D-38` · LI (a typo is permanent and recovery needs the owner to run SQL) |
| Verification | Confirmed (code) |
| Current behaviour | `budget-section.tsx:82-88` has a free 3-letter currency input with "cannot be changed once the budget exists"; `pbx_budget_header_guard` forbids change (`20261210000100:514`), budgets are never deleted; a typo such as AEF stays and Finance rates (per currency) never apply. |
| User problem | PMs creating a budget. |
| Proposed behaviour | Choose from the company default plus currencies already used by the company, with a confirmation line "AED, cannot be changed". |
| Before → after | Free typing → pick and confirm. |
| Roles affected | PMs; Finance. |
| Data source | `companies.default_currency`, existing budgets. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | • Success: currency chosen from the list. • Failure: an unknown currency cannot be typed. • Permission unchanged. |

#### D-39 A Sales-linked person added as a project member gets work they cannot see

| Row | Entry |
|---|---|
| ID / priority | `D-39` · LI (provisional: affects only Sales-linked people with no Projects grant; becomes LB if Sales staff are expected to receive tasks at launch) |
| Verification | Confirmed (code) |
| Current behaviour | `proj_add_member` accepts a Sales-linked person with a Sales grant (`20261120000100:336-348`); `proj_create_task` accepts them as assignee; `proj_notify` accepts them. `getProjectsContext` gives them `grants = []` (`lib/projects/context.ts:64-70`), My Work says "Your access here is to your own Sales projects, which have no tasks for you" (`work/page.tsx:50-56`), `loadWorkRows`, My Day and the calendar "mine" are gated on `grants.length > 0`, and nav has no My Work or Calendar (`nav-groups.ts:233-239`). |
| User problem | The Sales owner assigned a show-support task cannot find it. |
| Proposed behaviour | Gate My Work, calendar and My Day on "has any membership", or refuse to add Sales-only people with "Give them Projects access first" (owner chooses one rule). |
| Before → after | Task visible only inside that project's Work tab → visible in My Work and My Day. |
| Roles affected | Sales-linked staff, PMs. |
| Data source | `proj_project_people`, `proj_tasks`. |
| Technical scope | Interface (preferred) or server function. |
| Business-rule impact | None (access already exists in SQL); owner chooses between two display rules. |
| Acceptance checks | • Success: the assigned member sees the task in My Work and a My Day count. • A Sales-linked non-member still sees only the summary. • If the Sales link is removed, membership ends and the list empties (existing SQL). |

#### D-40 "Needs you" links on My Day and Projects do not go where they say

| Row | Entry |
|---|---|
| ID / priority | `D-40` · LI (cheap, repeated daily) |
| Verification | Confirmed (code) |
| Current behaviour | `lib/projects/my-day.ts:17` reviews link `/projects/work#reviews`; no element has id `reviews` (searched). `projects/page.tsx:89,91` reviews link `/projects/work` (lands on "My tasks"; `?show=review` exists, `work-logic.ts:88`); unread messages link `/projects/work` instead of the project's Discussion. |
| User problem | PMs and heads land on the wrong list. |
| Proposed behaviour | Reviews link to `/projects/work?show=review`; unread links to the project's Discussion when one project, otherwise to the Projects list with an unread badge. |
| Before → after | 1 extra click to find the list → 0. |
| Roles affected | PMs, department heads. |
| Data source | Existing routes. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | • Success: the link opens the review list. • Failure: with no reviews the link is absent. • Permission unchanged. |

#### D-41 Handover risks and notes cannot be reached after acceptance

| Row | Entry |
|---|---|
| ID / priority | `D-41` · LI (cheap; the PM loses what Sales recorded) |
| Verification | Confirmed (code) |
| Current behaviour | `proj_accept_handover` copies risks into `proj_project_details.risks` but no project page displays them (searched `risks`: only `handover-brief.tsx` and the Sales edit form). Notes appear only under "Manage project > History > Notes from Sales" (`history/page.tsx:89`); risks are omitted there. The PM loses the Handovers nav link after acceptance (`nav-groups.ts:243`) and members cannot reach the Handovers page from nav. |
| User problem | PMs and members cannot find risks recorded at the handover. |
| Proposed behaviour | Show Risks and "Notes from Sales" in the Work right-rail "Project details" card (members only); include risks in the History snapshot. |
| Before → after | 4 clicks to notes, risks unreachable → both visible on Work. |
| Roles affected | PMs, project members. |
| Data source | `proj_project_details.risks`, `proj_handovers.notes`. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | • Success: members see both. • Permission: a non-member sees neither. |

#### D-42 HR stat cards and quick actions link to personal pages while describing company data

| Row | Entry |
|---|---|
| ID / priority | `D-42` · LI (a click that answers a different question) |
| Verification | Confirmed (code) |
| Current behaviour | `components/my-day/hr-section.tsx:15` "Leave requests in review ... Company-wide, any approver" links to `/approvals`, which lists only items assigned to the viewer (`approvals/page.tsx:34-39`); "On leave" and the "Leave requests" quick link go to `/leave` (own leave: `leave/page.tsx:44-60` queries only the viewer's `employee_id`); "Employees" goes to `/employees`; "Recorded present" to `/attendance`. The HR Admin clicks a count of N and lands on "Nothing waiting on you right now." |
| User problem | HR Admins and CEO/CTO. |
| Proposed behaviour | Link "On leave" and "in review" to the existing filtered HR views (`/attendance` register for the date; `/approvals`) or make them non-links; remove the Quick-actions card (it repeats the sidebar). A real team/company leave list belongs to the usability register. |
| Before → after | 1 dead-end click per use → 0. |
| Roles affected | HR Admin, CEO, CTO. |
| Data source | Existing routes. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | • Success: the tile opens a list matching its number or is not a link. • Permission unchanged. |

#### D-43 On-screen statements contradict what the system does

| Row | Entry |
|---|---|
| ID / priority | `D-43` · LI (wrong approval-chain wording misleads HR and employees) |
| Verification | Confirmed (code) |
| Current behaviour | `employees/[id]/leave-section.tsx:99` "Recovery Leave earning (Reporting Manager -> HR Admin approval)" (real routes: project lead then HR, manager then HR, CEO/CTO queue, self-led then HR). `overnight-recovery-form.tsx:44-47` says "pending Reporting Manager then HR Admin approval"; migration `20261106:66-69` says a single `role_queue:hr_admin` step. `attendance/page.tsx:68` (shown to every non-HR person): "HR fills this in daily - this is a read-only view of your record." (staff now clock themselves). `approvals/page.tsx:436` badge title "approving will draw it negative" is true for annual/sick, false for Recovery Leave (the database refuses, `20261108:3730-3742`). `password-reset-form.tsx:149` "Ask HR to send you a new invite from People & Access." but only a Sys Admin can resend (`users.ts:75`; HR Admin has no Account tab). |
| User problem | Wrong person contacted; wrong expectation of approval chain. |
| Proposed behaviour | Correct each sentence: the chain wording by route, the attendance note ("Your clock-in record; HR corrects mistakes"), the badge title by leave type, the invite message "Ask your System Administrator to send a new invite". |
| Before → after | 5 wrong statements → corrected. |
| Roles affected | Employees, HR Admin, new hires. |
| Data source | None. |
| Technical scope | Interface only. |
| Business-rule impact | None (wording only; no route changed). |
| Acceptance checks | • Success: each sentence matches the routing in `resolve_*` functions. • Permission unchanged. |

#### D-44 Leave types can be added to a draft policy but never edited or removed

| Row | Entry |
|---|---|
| ID / priority | `D-44` · LI (a mistyped draft cannot be fixed or deleted through the app) |
| Verification | Confirmed (code) |
| Current behaviour | `policies/[id]/page.tsx:246` renders only `AddLeaveTypeForm`; `lib/actions/policies.ts:104-137` has only an insert; `policy_leave_types_update/delete` RLS exists (`20260925:204-222`) but nothing calls it. The Policies table says "has configured leave types - remove them first" (`policy-versions-table.tsx:86-88`) and hides Delete, yet there is no remove control. The draft form needs the version number typed by hand (`draft-policy-form.tsx:55`) and raw JSON. |
| User problem | HR Admins; a broken draft stays forever and a new version number is consumed. |
| Proposed behaviour | Edit and remove buttons on rows of draft versions only (same RLS); "next version number" prefilled. |
| Before → after | Unfixable draft → editable. |
| Roles affected | HR Admin (drafting), CEO/CTO (activation). |
| Data source | `policy_versions`, `policy_leave_types`. |
| Technical scope | Interface plus two actions. |
| Business-rule impact | None. The two-person activation rule is untouched and no active policy can be edited; this spec changes no accrual or balance calculation. |
| Acceptance checks | • Success: editing a draft row persists. • Failure: an active version offers no edit. • Permission: only HR Admin of the company. |

#### D-45 Audit log hides tables it records and does not record HR configuration changes

| Row | Entry |
|---|---|
| ID / priority | `D-45` · LI (accountability for holidays and policies) |
| Verification | Confirmed (code) |
| Current behaviour | Audit triggers exist for `recovery_alerts`, `recovery_periods`, `recovery_windows`, `recovery_credit_requests`, `attendance_sessions`, `attendance_session_corrections`, `employee_career_events`, `employee_loans`, `employee_insurance_policies`, `termination_settlement_inputs`, but `audit_log_select_hr` allows only 11 tables (`20261005:15-23`) and the page list matches it (`audit-log/page.tsx:13-25`): rows are written and no screen shows them. No audit trigger exists for `policy_versions`, `policy_leave_types`, `public_holidays`, `assets`, `asset_assignments`, `goals/appraisals`, `employee_documents`, `identity_documents`, manual `payroll_export_lines`, `deduction_priority_rules`, `ai_drafts`. The screen shows table names, first 8 characters of an id, no before/after, no employee name (`:198-200`). |
| User problem | HR cannot see who changed a holiday or draft policy. |
| Proposed behaviour | Readable labels, employee name and link, change summary; add audit triggers for the configuration tables and extend the select policy. |
| Before → after | Unreadable or missing → readable. |
| Roles affected | HR Admin, Sys Admin. |
| Data source | `audit_log`. |
| Technical scope | Migration and interface. |
| Business-rule impact | None. |
| Acceptance checks | • Success: deleting a holiday appears with actor and date. • Permission: only HR Admin and Sys Admin read; company scoping kept. • Failure: a failed read shows `LoadError` (D-20). |

#### D-46 AI negative-balance suggestion can be authorised without context and is visible across companies

| Row | Entry |
|---|---|
| ID / priority | `D-46` · LI (provisional; LB if D-01 enables `detect-balance-discrepancies` before this is fixed; today the job is redirected and not running) |
| Verification | Confirmed (code) |
| Current behaviour | `detect-balance-discrepancies/route.ts:38-78` treats every negative `leave_balances` row as an error and drafts a +amount adjustment "brings it back to exactly zero", but the approval flow knowingly allows annual/sick requests beyond the balance (`approvals/page.tsx:431-440`; `20261108:3742-3750`), so legitimate negatives become drafts that credit free days when authorised. The review screen shows `proposed_payload` as raw JSON with the `employee_id` UUID and no name, company or ledger context (`ai-suggestions/page.tsx:53-66`). `ai_drafts_select/update` are `has_role_any_scope('hr_admin') or 'sys_admin'` (`20260929:795-805`), so an HR Admin of company A sees every company's drafts; the write is stopped by `leave_ledger_insert_hr` and `authorizeAiDraft` restores the draft (`aiDrafts.ts:58-64`) so it stays visible to A. A Sys Admin can open the queue but authorise always fails. `postLeaveLedgerAdjustment` dates the row in UTC (`ledgerAdjustments.ts:44`). `is_ai_generated` is never set true. |
| User problem | HR Admins authorising blind; cross-company exposure of balances. |
| Proposed behaviour | Show employee name, company, leave type, current balance and a profile link on each draft; scope the draft query by the employee's company; show the draft's origin on the ledger note; show nothing to a Sys Admin who cannot act. Keep "draft only, human authorises". |
| Before → after | Raw JSON and UUID → readable card; cross-company drafts hidden. |
| Roles affected | HR Admin; Sys Admin. |
| Data source | `ai_drafts`, `leave_balances`, `employees`. |
| Technical scope | Migration (company on draft or policy join) and interface. |
| Business-rule impact | **Owner decision; this spec does not propose changing the rule.** The leave-balance rule that a negative annual/sick balance is an error is the detector's assumption; whether the detector should draft for negatives the approval flow allows is the owner's call. This entry changes display and visibility only. |
| Acceptance checks | • Success: an HR Admin sees only drafts for their companies' employees, with a name. • Failure: authorise by a non-owner shows a readable refusal. • Permission: a Sys Admin cannot authorise. |

#### D-47 Linking an account to an employee is wildcard-matched and unconfirmed (risk)

| Row | Entry |
|---|---|
| ID / priority | `D-47` · LI (HR Admin can point an unlinked colleague's account at a chosen employee record, giving self-access to that record's contract, compensation and leave) |
| Verification | Confirmed (code) |
| Current behaviour | `linkEmployeeToUser` (`employees.ts:361-392`): HR Admin types an e-mail, `profiles.ilike("email", d.email)` (`_` and `%` act as wildcards; `maybeSingle` with two matches silently becomes "No account found"), then `employees.update({user_id})` under HR Admin RLS. Once linked the owner gets self-access through `current_employee_id()`. The unique index blocks only a second link. The change is recorded by the generic `audit_employees` trigger (not verified in detail). |
| User problem | Mislinks and silent failures for HR Admins; confidential-data exposure risk. |
| Proposed behaviour | Exact, case-insensitive, escaped match; a confirmation naming both ("Link <account name and e-mail> to <employee name>?"). HR Admin stays the only linker. |
| Before → after | Free-text wildcard match with no confirmation → exact match and 1 confirmation. |
| Roles affected | HR Admin; the linked person. |
| Data source | `profiles`, `employees`. |
| Technical scope | Server logic and interface. |
| Business-rule impact | None to who may link (HR Admin only); stays inside "confidential-data access". |
| Acceptance checks | • Success: exact match links after confirmation. • Failure: a wildcard string finds nothing; two matches shows "More than one account". • Permission: only HR Admin. |

#### D-48 A System Administrator can give any HR role to themself with no second person (risk, owner decision)

| Row | Entry |
|---|---|
| ID / priority | `D-48` · LI (provisional: priority depends on the owner's answer; G rated LB only if more than one Sys Admin is not planned) |
| Verification | Confirmed (code) |
| Current behaviour | `assignRole` (`users.ts:114-138`) inserts `user_roles` under `user_roles_insert_sysadmin`, whose only check is `has_role('sys_admin')` (`20261030:36-37`). No self-grant rule exists (contrast `pbx_grant_access` and `crm_grant_access`, which refuse adding to one's own grant, `20261215`). The audit row for `user_roles` is system-scoped and readable only by `audit_log_select_sysadmin` (`20261104:124`, `20260929:787`), i.e. by Sys Admins. A Sys Admin can give themself `ceo`, `finance` or `hr_admin` (including "All companies"), decide payroll or leave approvals and read compensation. Module grants are unaffected. |
| User problem | Confidential HR data and payroll approvals rest on one person with no independent visibility. |
| Proposed behaviour | **Risk only. This spec does not propose changing the rule.** The existing, separately governed behaviour that a Sys Admin grants HR roles is described, not redesigned. The question for the owner (below, Q1) is whether to add the same self-grant refusal the module grants already have, and whether CEO/CTO should see `user_roles` audit entries. |
| Before → after | Not changed by this spec. |
| Roles affected | System Administrator; CEO/CTO; HR Admin; Finance. |
| Data source | `user_roles`, `audit_log`. |
| Technical scope | If the owner decides: migration (guarded RPC or trigger) and interface message. |
| Business-rule impact | **Owner decision; this spec does not propose changing the rule.** Touches the sensitive-grant protections. |
| Acceptance checks | If adopted: • Success: a different Sys Admin can grant. • Failure: self-grant refused with a message. • Permission: revoke-last-admin rules unchanged; RLS test mirroring `access_grant_rules`. |

#### D-49 CRM organisations and contacts are not company-scoped (risk, owner decision)

| Row | Entry |
|---|---|
| ID / priority | `D-49` · LI (provisional: owner decision; becomes LB if a shared address book across the group's companies is not intended) |
| Verification | Confirmed (code) |
| Current behaviour | `crm_organisations_select` and `crm_contacts_select` use `crm_has_any_access()` (`20261115000100:444-446`): any CRM grantee of any company reads every organisation and contact (names, e-mails, phones) of every company. Opportunities are company-scoped; people data is not. |
| User problem | Possible cross-company exposure of client contacts. |
| Proposed behaviour | **Risk only; no proposal.** Company boundaries and confidential-data access are protected; this spec does not propose changing them. The owner confirms whether the shared address book is intended (Q2). |
| Before → after | Not changed by this spec. |
| Roles affected | Sales grantees of any company. |
| Data source | `crm_organisations`, `crm_contacts`. |
| Technical scope | If the owner decides: migration (policies). |
| Business-rule impact | **Owner decision; this spec does not propose changing the rule.** |
| Acceptance checks | If adopted: • Success: a company-A grantee reads only company-A contacts. • Failure: cross-company search returns nothing. • Permission: founders and shared-address-book exceptions as the owner defines. |

---

### LT entries

#### D-50 Silent row caps in Inventory movement-form pickers and Today transfers

| Row | Entry |
|---|---|
| ID / priority | `D-50` · LT (rare at current volumes; safe failure) |
| Verification | Confirmed (code) |
| Current behaviour | `loadFormContext` (`stock.ts:678-681`): projects 500, requests 300, transfers 100, rentals 200, no message. Today caps requests at 400 and says so (`today-data.ts:90`) but transfers at 200 with no note (`:175`). |
| User problem | A picker silently omits older items. |
| Proposed behaviour | Show "Showing the latest N; search to find others" when a cap is reached. |
| Before → after | Silent cap → disclosed cap. |
| Roles affected | Warehouse operators, PMs. |
| Data source | Existing queries. |
| Technical scope | Interface and server read. |
| Business-rule impact | None. |
| Acceptance checks | • Success: a cap shows the note. • Failure: none. • Permission unchanged. |

#### D-51 Late dispatch cannot be recorded from Send out

| Row | Entry |
|---|---|
| ID / priority | `D-51` · LT |
| Verification | Confirmed (code) |
| Current behaviour | `inv_dispatch_to_project` requires `v_exp > now()` (M3:1880-1882) using the request's `expected_return_at` or `needed_until`; SendStep has no expected-return field. A request whose end has passed (event slipped) cannot be sent until the dates are changed with `inv_change_request_window`. |
| User problem | Operators get a refusal with no way forward on that screen. |
| Proposed behaviour | Show the refusal reason with a "Change the dates" link, or allow an expected-return field in Send out. |
| Before → after | Dead end → 1 link. |
| Roles affected | Warehouse operators, PMs. |
| Data source | `inv_change_request_window`. |
| Technical scope | Interface only (link). |
| Business-rule impact | None (booking conflicts unchanged). |
| Acceptance checks | • Success: the refusal shows the link. • Failure: dates change still obeys conflict checks. • Permission: PM edit rights as today. |

#### D-52 Receiving a transfer "Everything on the way" cannot record transit damage

| Row | Entry |
|---|---|
| ID / priority | `D-52` · LT |
| Verification | Confirmed (code) |
| Current behaviour | With `p_lines` empty `inv_transfer_receive` keeps each unit's existing condition (M3:2240-2259, `coalesce(e->>'condition', u.condition)`); transit damage is recorded only by choosing "Only some" and listing lines with a condition. |
| User problem | Damaged items arriving in transit go onto the shelf as they were. |
| Proposed behaviour | On "Everything on the way" add a required line "Anything damaged or missing?" with No (default off, must choose) or a link to "Only some". Same principle as the return confirmation design. |
| Before → after | No prompt → 1 explicit answer. |
| Roles affected | Receiving warehouse operators. |
| Data source | `inv_transfer_receive`. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | • Success: "Yes" opens the line editor. • Failure: skipping the question is refused. • Permission unchanged. |

#### D-53 A PM who gives themself a "needs review" task has no eligible reviewer and nobody is told

| Row | Entry |
|---|---|
| ID / priority | `D-53` · LT (rare path; independent review rule stays) |
| Verification | Confirmed (code) |
| Current behaviour | `allowedTaskMoves` (`permissions/proj.ts:150`, `isReviewer = leader && assigneeId !== userId`) and `proj_set_task_status` (reviewer must not be the assignee; `coalesce(head not assignee, pm)`, `20261120000300:643`). For a PM-assigned task the reviewer is the PM themself and `proj_notify` skips the actor, so a ready-for-review task nobody is told about; only a founder or acting PM other than the assignee can accept; otherwise only Defer or Cancel remain. |
| User problem | A PM's own task gets stuck. |
| Proposed behaviour | Do not alter the rule. At creation and on "Needs review" show "You are the only person who can review this. Choose another assignee or ask a founder", and notify founders when a review has no eligible reviewer. |
| Before → after | Silent stall → explicit message and notice. |
| Roles affected | PMs, founders. |
| Data source | `proj_set_task_status`, `proj_notify`. |
| Technical scope | Interface plus notification. |
| Business-rule impact | None; independent review stays. |
| Acceptance checks | • Success: the message appears. • Failure: assignee cannot accept own work. • Permission: only eligible reviewers. |

#### D-54 Legacy Sales-side handover RPC is still callable (owner decision)

| Row | Entry |
|---|---|
| ID / priority | `D-54` · LT (owner decision) |
| Verification | Confirmed (code) |
| Current behaviour | `crm_update_handover` remains granted to `authenticated` (`20261115000300:680-693`); `crm_mark_won` still inserts a `crm_handovers` draft; the Sales page hides the form when Projects is installed (`handover/page.tsx:73-77,141`) and shows an "Earlier Sales-side handover record" only if something was saved. A direct call can mark a handover `handed_over` that nothing in delivery reads. |
| User problem | A second misleading status; a Won owner could believe delivery was told. |
| Proposed behaviour | **No change proposed. This spec does not alter the single working Sales-to-Projects handover (`proj_handovers`).** Owner decides whether to retire the RPC and stop inserting the draft row (Q3). |
| Before → after | Not changed. |
| Roles affected | Sales owners. |
| Data source | `crm_handovers`, `proj_handovers`. |
| Technical scope | If decided: migration. |
| Business-rule impact | **Owner decision; this spec does not propose changing the rule.** |
| Acceptance checks | If adopted: • Success: the RPC is refused or absent. • Failure: no UI change. • Permission: `proj_handovers` unchanged. |

#### D-55 Recording receipts can overwrite a concurrent change without warning

| Row | Entry |
|---|---|
| ID / priority | `D-55` · LT |
| Verification | Confirmed (code) |
| Current behaviour | `pbx_record_receipts` has no `expected` version although `budget.row_version` is exposed (`20261210000300:615-635`; `pbx_budget_view` returns it); two Finance users can overwrite each other, and a re-record always clears the CEO/CTO confirmation. Everything else uses `row_version` or request ids. |
| User problem | Finance. |
| Proposed behaviour | Pass `expected` and use `pbx_check_version`. Physical receipt submission rule untouched. |
| Before → after | Silent overwrite → "Someone else changed this; reload". |
| Roles affected | Finance, CEO/CTO confirmers. |
| Data source | `pbx_record_receipts`. |
| Technical scope | Server logic and migration. |
| Business-rule impact | None. |
| Acceptance checks | • Success: single user records. • Failure: stale version refused with a message. • Permission unchanged. |

#### D-56 An existing-claim link is not checked for duplicates or claim state

| Row | Entry |
|---|---|
| ID / priority | `D-56` · LT (record only; no double payment; mis-stated project cost) |
| Verification | Confirmed (code) |
| Current behaviour | `pbx_save_actuals_draft` checks only that the claim is the caller's own (or Finance) (`20261210000300:438-446`); no uniqueness on `claim_id` (`...0100:201-232`); claim status is shown only in the label. |
| User problem | The same claim can be counted on two lines or projects, or a rejected claim counted as project expense. |
| Proposed behaviour | Refuse a claim already linked on another line or project; warn when the claim is not approved. |
| Before → after | Unchecked → refused or warned. |
| Roles affected | PMs, Finance. |
| Data source | `reimbursement_claims`, `pbx_actuals`. |
| Technical scope | Server logic and migration. |
| Business-rule impact | None. |
| Acceptance checks | • Success: a unique approved claim links. • Failure: a duplicate is refused. • Permission: own claims or Finance. |

#### D-57 UI "manager" tests use direct reports while the database uses the full chain

| Row | Entry |
|---|---|
| ID / priority | `D-57` · LT (owner question; the boundary must not change without an answer) |
| Verification | Confirmed (code) |
| Current behaviour | `employees/[id]/page.tsx:75` tests direct reports while `is_manager_of` is recursive; permission helpers claim to "mirror" RLS (`permissions/leave.ts:25-28`, `attendance.ts`, `assets.ts`) but test direct reports. Reporting Managers lose the Leave tab for indirect reports even though RLS allows it. |
| User problem | Skip-level managers cannot reach data they may legitimately read. |
| Proposed behaviour | **No change until the owner answers Q5** (should skip-level managers see leave, attendance and Recovery Leave of indirect reports?). If yes, use a chain-aware function instead of the direct-report test. |
| Before → after | Not changed. |
| Roles affected | Reporting Managers, HR. |
| Data source | `is_manager_of`. |
| Technical scope | Interface plus one read function if decided. |
| Business-rule impact | **Owner decision; this spec does not propose changing the rule** (HR reporting lines). |
| Acceptance checks | If adopted: • Success: a manager sees direct and indirect reports. • Failure: peers never appear. • Permission: unchanged RLS. |

#### D-58 CEO/CTO are told "nothing" for identity-document expiries they cannot read

| Row | Entry |
|---|---|
| ID / priority | `D-58` · LT |
| Verification | Confirmed (code) |
| Current behaviour | `canViewHrAlerts` lets CEO/CTO into Alerts and the HR half of My Day, but `identity_documents` RLS excludes them (comment `permissions/alerts.ts:9-16`). `identityExpiringCount` and the Alerts section return 0 and the page can print "Nothing needs attention" (`alerts/page.tsx:109`). |
| User problem | A CEO or CTO reads a false all-clear. |
| Proposed behaviour | For CEO/CTO hide that section or write "Identity documents are visible to HR Admin only." Confidential-data access is not widened. |
| Before → after | False "0" → explicit statement. |
| Roles affected | CEO, CTO. |
| Data source | `permissions/alerts.ts`. |
| Technical scope | Interface only. |
| Business-rule impact | None; confidential-data rule untouched. |
| Acceptance checks | • Success: CEO sees the statement. • HR Admin still sees counts. • Permission unchanged. |

#### D-59 `proj_notify` silently drops notices when the recipient is the actor or has lost eligibility

| Row | Entry |
|---|---|
| ID / priority | `D-59` · LT (not an incorrect result today; matters for any future obligation that relies on a notice) |
| Verification | Confirmed (code) |
| Current behaviour | `proj_notify` drops a notice when the PM has no active membership or lost Projects eligibility (`20261120000200:86-94`) or equals the acting user (`:84`; a PM who is also the warehouse operator never gets a notice about their own action) and deletes it on member removal. |
| User problem | A person's own action or an ineligible PM produces no notice. |
| Proposed behaviour | No change to display rules; any pending obligation (for example the dispatch acknowledgement) must not live only in a notice. Recorded here so the new-functionality design reads it. |
| Before → after | Not changed. |
| Roles affected | PMs who are also operators; ineligible PMs. |
| Data source | `notifications`. |
| Technical scope | Design note; none now. |
| Business-rule impact | None. |
| Acceptance checks | • Any new obligation survives a dropped notice. • Permission unchanged. |

---

### Conflicts between investigators and how I resolved them

| Topic | Investigators | My decision and reason |
|---|---|---|
| Session read failure (D-15) | F-A-01 LB, F-H-04 LI | LI: fails closed, only during an outage, nobody gains access. |
| Whether the Approvals link is hidden for queue-only approvers (D-21) | F-A-12 / F-E-02 / F-people-hr-21 imply the approver loses the entry point | Checked `nav-groups.ts:117-120`: HR Admin, line manager, Finance, CEO and CTO always get the link by role; only an ordinary employee (project lead) depends on the pending count, and a lead's step has a person-specific `approver_id`, so it is counted. So D-21 affects My Day only: LI, not LB. |
| Handover blind spot (D-08) | F-B-01 "improvement (high)" | LB under the "required hand-off invisible" rule. |
| Advance to return (D-12) | F-E-10 launch improvement | LB under the "misreport money" rule. Flag for the owner if you want it lower. |
| Project lead picker (D-13), Recovery cards (D-14) | F-A-07 and F-people-hr-04 "if confirmed"; F-people-hr-03 "static" | Policy text re-read by me; the page filter and RLS reasoning hold, so I register as Confirmed (code). Real data (who sits on the CEO/CTO queue) is verified with test accounts. |
| Document-expiry reminders (D-24) | F-A-09 LI, F-people-hr-10 later | LI; reminders cannot reach anyone even after D-01. |
| Alerts failed read (D-20) | F-H-08 LI, F-people-hr-02 "blocker for Alerts and Leave pages if staff rely on them" | LI for Alerts; leave pages carved out to D-03 (LB). |
| Letters (D-23) | F-people-hr-05 LI ("blocker if letters carry salary") | LI; I did not check template contents. |
| Inventory nav gate (D-35) | F-A-20 L, F-G-05 LI | LI; one entry, since both name the same `managesProjects` predicate. |
| Leave-accrual preflight | F-H-01 and F-people-hr-01 agree | Used the stricter wording: a first live run must follow a read-only preflight read by HR. |

### Open questions for the owner (decisions inside hard boundaries or outside investigator reach)

1. **D-48 / F-G-03:** A System Administrator can currently give any HR role (including CEO, Finance, HR Admin for all companies) to themself, with no second person and no audit entry visible to CEO/CTO. Is that intended? If not, should the same self-grant refusal that module grants already have apply, and should CEO/CTO see `user_roles` audit entries? This spec does not propose changing the rule.
2. **D-49 / F-B-21:** Is it intended that any Sales grantee of any company can read every organisation and contact of every company?
3. **D-54 / F-B-20:** Should the legacy Sales-side handover RPC and the draft row inserted at "Won" be retired? The single working handover (`proj_handovers`) is not changed either way.
4. **D-13 and D-14:** May ordinary staff see colleague names in the clock's project-lead picker, and may a project lead and a CEO/CTO read the minimum of an HR Admin's or colleague's Recovery Leave request they decide (name, dates, evidence)? Neither entry changes attendance or Recovery Leave calculation or routing.
5. **D-57:** Should a skip-level manager see leave, attendance and Recovery Leave of indirect reports (the database allows it, the screen does not)?
6. **D-01:** Have the five HR cron routes been running in production (Vercel Cron Jobs history; Vercel Root Directory repo root or `apps/web`)? If not, which paths should be exempted and when, accepting that leave and comp-day balances will move on the first live run (read-only preflight reviewed by HR first)? Has leave accrual been posted another way since go-live?
7. **D-46:** Should the negative-balance detector draft for negative annual or sick balances that the approval flow knowingly allows? (leave-balance rule; display and visibility changes in D-46 do not depend on the answer.)
8. **D-10:** After deactivation, should HR Admin get a re-route action for approvals already pending on the leaver? (This changes who may approve; not proposed here.)
9. **D-06:** For employee requests: keep Reserve and fix `inv_issue_to_employee`, or remove Reserve for employee requests?
10. **D-39:** For a Sales-linked project member with no Projects grant: show their work (gate on membership) or require a Projects grant before they can be added?
11. **D-35:** Should acting PMs and team heads see Inventory Stock and Requests and may team heads prepare project equipment lists; may line managers request equipment for their reports?
12. **D-23 / D-22:** Do letter templates carry salary, and are the seeded Phase 2B drafts safe to be seen by all staff? (Decides whether D-23 and D-22 move to LB.)

### Items investigators raised that I did NOT register as defects here, and why

| Source id | Why not registered |
|---|---|
| F-A-13, F-A-14, F-A-15, F-A-16, F-A-17, F-A-18, F-A-19 (nav labels and orphans), F-A-21, F-A-22 | Usability or new functionality; belong to the U and N registers (My Work card, notices bell, CEO/CTO attention view, record search, nav regrouping, policy and holiday staff view). The failed-read piece of F-A-19 is in D-19. |
| F-B-02, F-B-03, F-B-06, F-B-07, F-B-12, F-B-13, F-B-16, F-B-17, F-B-18, F-B-19, F-B-22, F-B-23 | Labelled usability; they work and cost steps. F-B-07 (decision requests reach nobody) is design for the notices work; F-B-03 crosses the Sales/Projects confidentiality line and needs an owner decision. |
| F-B-08, F-B-14 | New functionality (scope-change follow-through, file references). |
| F-C-15 to F-C-23 | Usability or new functionality (bulk reserve, one-click good return, Today coverage, notifications, kit contents, transfer entry). F-C-19 is split: nav gate in D-35, the rest to U. |
| F-D-01 to F-D-10, F-D-11 first four bullets and last bullet | Feasibility facts and "verified absent" items for the dispatch/return notes feature; not defects in current behaviour. The "derived counters and mutable catalogue text unsafe as acknowledged content" bullet is a design constraint for the new feature, not a bug. The `proj_notify` drop is registered as D-59; the "failed reads shown as nothing waiting" pattern is covered by D-02, D-04, D-19. |
| F-E-04, F-E-05, F-E-06, F-E-07, F-E-11, F-E-12, F-E-13, F-E-17, F-E-19, F-E-20, F-E-21, F-E-22 | Usability or new functionality. F-E-07 (delegation) changes who may approve; owner decision, not a defect. F-E-20 (contingency and VAT) is not modelled by design. |
| F-people-hr-07, 08, 13, 15, 16, 17, 18, 20, 22, 24, 26 | Usability, observation, or new functionality. F-people-hr-16 (payroll "restricted" message for a role-holder without an employee record, one-company assumption) is labelled usability by its author: referred to the U register. F-people-hr-24 (Sys Admin sees all employees) is a company-boundary observation with an open question, not changed. |
| F-people-hr-19 | Duplicate in substance of D-25 (job-run visibility); the usability angle is in the U register. |
| F-people-hr-21 (notify Recovery Leave approvers) | Count part merged into D-21; notification part is new functionality (and e-mail failure in D-26). |
| F-G-02, F-G-07, F-G-08, F-G-09, F-G-10, F-G-11, F-G-14, F-G-15, F-G-17, F-G-18, F-G-19, F-G-20, F-G-21 | Usability or new functionality (leaver checklist, role packs, departments screen, effective-access view, browser dialogs). The browser-dialog point (`window.prompt`) is mentioned inside D-10 because it sits in the same flow. |
| F-H-12 (rest), F-H-13, F-H-14, F-H-15, F-H-17, F-H-19, F-H-20 | Usability or new functionality (friendly errors, invite confirmation and config strip, unsaved-changes guard, My Day first paint, phone gaps). Currency default and claim numbering parts are in D-05 and D-16. |
| F-A-09 (cron part), F-people-hr-25 | Cron redirect merged into D-01; `CRON_SECRET` check into D-25. |



## 3.2 Usability recommendations (`U-nn`)

Scope of this part: things that work today but cost staff steps, screens, repeated entry or confusion. Defects are in Section 3.1 (`D-nn`), new functionality in Section 3.3 (`N-nn`). Cross-references to those parts use the investigators' source IDs (for example "D entry for F-G-01"), because `D-`/`N-` numbers are assigned in the other parts.

How to read the numbers
* "Before" numbers are the investigators' counted paths (A section 5, B P2/P4/P5, C P7a-P7e, E P8/P9/P11, F 5.1/5.2, G 5.2/5.3), cited per entry. A click, a selection and a typed field each count as one interaction, as the investigators counted them.
* "After" numbers are counted from the proposed layout. They are design targets, not measured results. Where I derived a number myself from the investigators' paths, the entry says "derived".
* Source IDs: `F-A-nn` (My Day/nav), `F-B-nn` (Sales/Projects), `F-C-nn` (Inventory), `F-E-nn` (Budget/Approvals), `F-people-hr-nn` (People & HR; written `F-F-nn` in the brief), `F-G-nn` (People & Access), `F-H-nn` (reliability).
* Verification: every "Current behaviour" below comes from code reading by an investigator. The label states what was done. Where I re-opened the code in this pass, the row says "Re-checked here". Nothing was run, so nothing is "tested".

Hard boundaries respected in every entry: attendance, Recovery Leave, leave-balance and payroll calculations; HR reporting lines based on project leadership; company boundaries and confidential-data access; independent approvals and sensitive-grant protections; Inventory booking conflicts and movement history; the single Sales-to-Projects handover; physical receipt submission; Zoho Books; the approved visual direction. Where a proposal sits next to one of these, the "Business-rule impact" row says what is deliberately untouched.

### Summary table

| ID | Pri | Title | Source | Technical scope | Owner decision needed |
|---|---|---|---|---|---|
| U-01 | LB | A scope proposal or commercial approval request reaches the person who must decide | F-B-07 (part F-B-06) | server logic + interface | confirm the LB rating |
| U-02 | LI | My Day shows my work, and one block per fact | F-A-13, F-A-16 (part F-B-06) | interface + server read | none |
| U-03 | LI | Navigation: a "Me" group separate from company and HR screens | F-A-19, F-people-hr-15 (note) | interface only | none |
| U-04 | LI | Navigation: no unfinished or single-link modules in the main menu | F-A-19 | interface only | yes: keep a roadmap line or not |
| U-05 | LI | Leave page: balance, approver and Recovery Leave named and found in one place | F-people-hr-22 (display), F-people-hr-08 | interface + server read | none |
| U-06 | LI | One list of "needs my decision" across Approvals and Finance | F-E-04 (part F-A-17) | server logic (read-only) + interface | where it lives (My Day or Approvals) |
| U-07 | LI | Waiting time and "who holds it" on every pending item; "approver unavailable" shown | F-E-06, F-E-07 (visibility only) | interface + one read function | amber threshold; any change of who approves stays out |
| U-08 | LI | Decision screen: readable claim rows, decide from the claim, plain errors | F-E-05 (parts F-H-14, F-H-20) | interface | one-click approve; reject reason required |
| U-09 | LI | Team view for managers and HR (leave, balances, who is away) | F-people-hr-07, F-A-17 | interface + read function | skip-level managers |
| U-10 | LI | Handover: "Save and submit" in one click, risks editable | F-B-02 | interface + server action | none |
| U-11 | LI | Report a blocker in 2 clicks and 1 field | F-B-17 | interface (+ small function edit to tell the head) | none |
| U-12 | LI | Staffing and assigning work: no forced order, no silent "assign to me" | F-B-13 | interface | none |
| U-13 | LI | "Ask for access" with names, instead of "Ask a founder" | F-G-14, F-B-12 | interface + server logic | names of access managers shown to staff |
| U-14 | LI | Sales follow-ups: log a call and plan the next step in one dialog | F-B-19 (P4 A/B/C) | interface + one action | none |
| U-15 | LI | Actual expenses: stop repeating "How paid" and "Who paid" | F-E-13 | interface | none |
| U-16 | LI | Budget lines: duplicate a line, pre-tick the people, remember choices | F-E-12 (interface part) | interface | none |
| U-17 | LI | Budget currency: choose, do not type, an irreversible code | F-E-14 | interface | none |
| U-18 | LI | Finance inbox opens on what Finance must do now | F-E-11, F-E-22 | interface | none |
| U-19 | LI | Onboarding: enter each fact once, with a "waiting for a login" hand-off | F-G-08 | migration + server logic + interface | yes: automatic linking |
| U-20 | LI | Role packs for module access | F-G-09, F-G-17 (option a) | interface only | which packs; Marketing/Operations needs |
| U-21 | LI | Account menu and grant names say what the person is | F-G-07, F-G-19 | interface only | none |
| U-22 | LI | Policies and Holidays readable by staff, own country first | F-A-21, F-people-hr-13 | interface only | yes: other countries; policy wording content |
| U-23 | LI | Receive back: set one condition for several ticked lines, never a default | F-C-16 | interface only | none |
| U-24 | LI | Reserve per line: options for a "reserve what is free" action | F-C-15 | interface or migration | yes: technical and owner |
| U-25 | LI | Inventory Today: hide what cannot be finished, show what is held for checking | F-C-20, F-C-17 (part) | server logic + interface | none |
| U-26 | LI | Plain reasons when a leave request or a decision is refused | F-H-13, F-H-14 | server logic + interface | none |
| U-27 | LI | Leaver checklist on People & Access | F-G-02 | interface + read function | none |
| U-28 | LT | Sales quick add: one organisation control, time and type | F-B-18 | interface | none |
| U-29 | LT | Inventory: remaining Today sources, "Send to another warehouse", Counts link | F-C-17 (rest), F-C-22, F-C-23, F-C-19 (part) | server logic + interface | yes: line managers requesting |
| U-30 | LT | Next-actor notices outside Projects (Inventory, task comments, Sales assignment, Recovery Leave e-mail) | F-C-18, F-B-16, F-B-07 (rest), F-people-hr-21 | migration + server logic | depends on the notices inbox (N part) |
| U-31 | LT | Client feedback to scope change in one step | F-B-23 | interface + read | none |
| U-32 | LT | Start an internal project from an earlier one | F-B-22 | migration + interface | yes |
| U-33 | LT | Share non-commercial Sales files and a delivery contact at handover | F-B-03 | migration + server logic | yes: confidentiality line |
| U-34 | LT | Tag employee claim lines to a project | F-E-17 | interface + read | yes |
| U-35 | LT | Clock-in: pick the project from Projects, one label set | F-people-hr-20 | interface | yes: attendance area |
| U-36 | LT | Payroll, letters, performance: company selector and an honest message | F-people-hr-16 | interface | check who holds such roles |
| U-37 | LT | Alerts page: plain health line, engineering text to a technical view | F-people-hr-17 | interface | none |
| U-38 | LT | Small interface corrections (decimals, dialogs, sign-in wording, unsaved work, phone tables, My Day first paint) | F-E-21, F-G-20, F-G-15, F-H-17, F-H-20, F-H-19 | interface (one with server check) | none |

Priority counts: LB 1, LI 26, LT 11. Total 38.

LB justification (the only one): U-01 is rated LB because the rubric names "a required coordination handoff is invisible to the next actor (so work silently stalls)". Investigator B rated it "improvement". If the owner prefers to keep LB only for defects, U-01 drops to LI with no change to its content.

---

### U-01 · Decision requests reach the decider

| | |
|---|---|
| ID / priority | `U-01` · LB (a required handoff, PM to scope approver and Sales owner to Sales founder, is invisible to the next actor; B rated it improvement, rubric applied) · Source F-B-07 (part F-B-06) |
| Verification | Confirmed (code). Re-checked here: `proj_propose_scope_change` (`supabase/migrations/20261120000500_proj_feedback_plans_files_completion.sql:476-506`) contains no `proj_notify`; `crm_decide_approval` is founder-only (`20261115000300...sql` ~420-423, "Only a founder can decide a commercial approval"); page text `apps/web/src/app/(app)/projects/[id]/changes/page.tsx:154`. Not re-opened: B's search showing no `notifications` insert in any CRM migration. |
| Current behaviour | PM records feedback, then "Propose a scope change" (Manage project > Feedback & changes, a menu entry, not a tab). The page says "Waiting for someone with scope approval to decide." Nobody is notified. The decider (founder or `approve_scope` holder) finds it only by opening `/projects/<id>/changes`. A Sales commercial approval (`crm_request_approval`) waits on the enquiry's Commercial tab, also unannounced. My Day Projects rows are only handovers, reviews, overdue, due in 7 days, unread messages (`apps/web/src/lib/projects/my-day.ts:15-21`). |
| User problem | Founders and `approve_scope` holders do not know a decision is theirs. The PM waits on a client change; the Sales owner waits on a quote approval; neither can tell whether the decider has seen it. |
| Proposed behaviour | 1. When a scope change is proposed, write one `project_scope_proposed` notice with the existing `proj_notify` to every active `approve_scope` holder and founder of that company (never the proposer; de-duplicated by `dedupe_key`).<br>2. My Day "Needs you" list: row "Scope change waiting for your decision" (one row per project, up to 3, then "and N more"), linking to that project's `/changes` page. Read under the viewer's own session: `proj_scope_changes` with status `proposed` for projects where the viewer holds `approve_scope` or founder.<br>3. For Sales founders: My Day row "Commercial approval waiting for you (N)" from `crm_approvals` where `state = 'pending'`, linking to the enquiry's Commercial tab.<br>4. A failed read shows "Could not check scope changes" (never 0). |
| Before → after | Decider discovery: 0 prompts today → 1 My Day row plus 1 notice. Path to the decision for someone who already knows where to look: Projects (1), the project (2), Manage project (3), Feedback & changes (4) = 4 clicks (derived from B P5) → 1 click from the My Day row. Sales founder: Sales, Enquiries, open the enquiry, Commercial tab (about 4 clicks, derived from B) → 1 click. |
| Roles affected | Projects founders and `approve_scope` holders; Sales founders; PMs and Sales owners who stop chasing. A founder who is also a PM sees both groups once each. |
| Data source | `proj_scope_changes`, `crm_approvals`, `notifications` via `proj_notify`. |
| Technical scope | Server logic (migration: edit `proj_propose_scope_change` to call `proj_notify`) and interface (My Day rows). The Sales row is interface only. |
| Business-rule impact | None. Who decides is unchanged (`approve_scope` or founder; Sales founder). Notices and rows only. |
| Acceptance checks | Success: after a proposal every holder sees the row and the notice; the row disappears when the change is approved, rejected or withdrawn. Failure: forced read error shows "Could not check ...", not an empty list. Permission: a person without `approve_scope` or founder sees no row; losing project access removes the row (RLS); the proposer is not notified; repeated proposals do not create duplicate unread notices. Needs runtime confirmation: whether an `approve_scope` holder who is neither member nor founder can read the change under `proj_can_view_details`; if not, that is a defect to report in Section 3.1 and the row must not be shown to them. |

### U-02 · My Day shows my work, and one block per fact

| | |
|---|---|
| ID / priority | `U-02` · LI (daily landing page for everyone; path works today, so not LB; A rated it LB) · Source F-A-13, F-A-16 (part F-B-06) |
| Verification | Confirmed (code). Re-checked here: Projects rows are counts only (`apps/web/src/lib/projects/my-day.ts:15-21`); "Quick actions" card exists only in the HR section (`apps/web/src/components/my-day/hr-section.tsx:65`); "Coming soon to ENGINIOUS OS: Vendors & Purchasing and KPIs." (`apps/web/src/app/(app)/page.tsx:465`). Block counts are A's (not recounted). |
| Current behaviour | A 5.1: an employee sees "Project tasks due in the next 7 days N" (a task due today is inside that count; an undated task is in no count), clicks into `/projects/work`, then reads titles. Nothing is actionable in place. For a person who is HR + PM + Sales + Inventory, A counts 4 stat cards, 7 cards and an HR section of 9 sub-blocks (about 20 blocks); stat and card repeat the same fact in four pairs (Open enquiries / Sales pipeline, Decisions waiting / Decisions, Live equipment requests / Next dispatch, Active projects / Project status). |
| User problem | Ordinary staff open My Day to learn what to do today and are shown numbers. Multi-role people scroll through repeated blocks. |
| Proposed behaviour | 1. "My work today" card for anyone with Projects access: up to 5 rows from `loadWorkRows(ctx).mine` (`apps/web/src/lib/projects/my-work.ts:135`): overdue first (oldest first), then due today, then blocked by me. Each row: title, project, due date, link to `/projects/work?task=<id>` (the existing task panel). Footer link "All my work (N)".<br>2. Optional shortcut "Report a blocker" on each row (U-11).<br>3. Keep one block per fact: where a stat tile states the same number as the card below it, drop the tile. Remove the "Coming soon" line (see U-04) and the HR "Quick actions" card (it repeats the sidebar).<br>4. Dependency: the card shows "Project items could not be loaded" on a failed read; this needs the D entry for F-A-04 (today that branch is unreachable). |
| Before → after | Read one task title: 2 screens, 2 clicks (A 5.1) → 0 clicks (visible on My Day), 1 click to open the task panel. Blocks for the 4-role person: about 20 → about 14 (target: minus 4 duplicate stat tiles, minus Quick actions, minus the Coming soon line). Rows for "new assignment, blocker named to me, feedback assigned to me" need the notices inbox (N part, F-A-14) and are not added here. |
| Roles affected | Everyone with Projects access; multi-role people most (HR, PM, Sales, Inventory). |
| Data source | `proj_tasks` via `loadWorkRows`; existing My Day loaders. |
| Technical scope | Interface plus server read (reuse the existing loader). |
| Business-rule impact | None. |
| Acceptance checks | Success: a task assigned today appears; a collaborator task appears; an overdue task sorts first. Failure: forced load error shows one "could not load" line, not an empty card. Permission: a task of a project the person has lost access to is absent (RLS); a person with no Projects grant sees no card (unchanged). |

### U-03 · Navigation: a "Me" group separate from company and HR screens

| | |
|---|---|
| ID / priority | `U-03` · LI (every member of staff sees the menu daily; interface only) · Source F-A-19 (note F-people-hr-15) |
| Verification | Confirmed (code). Re-checked here: `buildNavModules` (`apps/web/src/components/nav/nav-groups.ts:164-219`); counts from `scratchpad/findings/nav-matrix-raw.txt`. |
| Current behaviour | One module "People & HR" (row goes to `/employees`). For an ordinary employee it holds 9 links in 4 sections: Me 2 (My Profile, My Attendance Clock), People 4 (Employees, Attendance, Leave, Reimbursements), Workflow 1 (Letters), Organisation 2 (Policies, Holidays). Six of the 9 are the person's own records; "Employees" shows only the own row (RLS) and "Attendance" is an own-record view for non-HR (`attendance/page.tsx:68`: "HR fills this in daily - this is a read-only view of your record"); Policies and Holidays are company reference pages. HR sees 15 links in 6 sections (Finance 11). The personal performance page sits in a different module labelled "Performance reviews (HR)"; "My equipment" sits in Inventory; Timesheets has no link at all (F-people-hr-15). |
| User problem | Staff look for "my leave" and "my payslip-type things" inside a module named for HR administration, next to screens they cannot use. HR people see their own and company screens interleaved. |
| Proposed behaviour | 1. New module "Me" for everyone: My Profile, My Attendance Clock, My Attendance, My Leave, My Claims (Reimbursements), My Letters, My Equipment (when an employee record is linked), My Performance (renamed from "Performance reviews (HR)") = 8 links, all personal.<br>2. "People & HR" shown only to people who hold something company-level, using the gates the code already has: Employees (directory), Attendance register, Alerts, Payroll, Assets, AI Suggestions, Audit Log, People & Access. Gate for the module as a whole: any of `line_manager`, `hr_admin`, `finance`, `ceo`, `cto`, `sys_admin` (the same roles already used for the Approvals link).<br>3. "Company" module, shown to everyone: Policies, Holidays (HR keeps the same pages with their controls; only the menu entry moves, see U-22).<br>4. Update the breadcrumb and command palette (both derive from the same module data) and the test `nav-groups.test.ts:175`.<br>5. Timesheets: unchanged here (owner decision to retire or link, F-people-hr-15). |
| Before → after | Sidebar rows for an ordinary employee: 5 (My Day, People & HR, Inventory, Vendors soon, KPIs & Performance) → 3 (My Day, Me, Company) together with U-04. Links in the opened module that are the person's own: 6 of 9 → 8 of 8. Clicks to reach a personal page stay 1 to 2 (module row, then link); the gain is findability, not click count. |
| Roles affected | All staff. Multi-role people keep "Me" plus "People & HR". A manager who lacks the `line_manager` role loses the "Employees" menu entry (still reachable by the palette and by U-09). |
| Data source | None (menu structure). |
| Technical scope | Interface only (`nav-groups.ts`, its test, breadcrumb). |
| Business-rule impact | None. Showing or hiding links only; page checks and RLS are unchanged. |
| Acceptance checks | Success: ordinary employee sees My Day, Me (8 links), Company (2); HR admin additionally sees People & HR with the company screens. Failure: a failed grant lookup must not remove "Me" (it needs no grant). Permission: a plain employee still gets the existing page notice if they open `/payroll` by URL; no link is added that the person could not already open. |

### U-04 · Navigation: no unfinished or single-link modules in the main menu

| | |
|---|---|
| ID / priority | `U-04` · LI (noise for every user; cheap) · Source F-A-19 |
| Verification | Confirmed (code). Re-checked here: `nav-groups.ts:301-321` pushes "Vendors & Purchasing" with `comingSoon: true` for everyone, "Inventory" coming soon for people with no inventory access or linked employee, and "KPIs & Performance" with one real link and one "KPIs" row marked soon; the code comment says the roadmap is shown on purpose. |
| Current behaviour | Ordinary employee menu: 5 module rows, of which 1 is a pure placeholder (Vendors & Purchasing), 1 is half a placeholder (KPIs & Performance: 1 working link, 1 "soon"), 1 holds a single link (Inventory > My equipment). A System Administrator with no employee record also sees "Inventory" as a placeholder. My Day repeats the roadmap in a footer line. |
| User problem | Muted placeholder rows read as broken or missing features and push real entries down; single-link modules cost a click for one page. |
| Proposed behaviour | 1. Remove the placeholder rows from the sidebar. Owner chooses: (a) one muted line "Coming soon: Vendors & Purchasing, KPIs" in a footer, or (b) nothing.<br>2. Single-link modules fold into "Me" (U-03): "My equipment" and "My Performance". The Projects module for a Sales-linked person with one link is left as is (no change proposed).<br>3. Remove the My Day footer line (U-02). |
| Before → after | This entry alone, ordinary employee: 5 rows → 3 rows (My Day, People & HR, Inventory; the Performance link moves into the People & HR "Me" section), 2 non-working rows → 0 (or 1 footer line). Together with U-03: 5 rows → 3 (My Day, Me, Company). |
| Roles affected | All staff. |
| Data source | None. |
| Technical scope | Interface only. |
| Business-rule impact | None. Owner decision only on whether the roadmap should stay visible. |
| Acceptance checks | Success: no row without a working link in the sidebar (or exactly one footer line if option (a)). Failure: a failed lookup that today degrades Inventory to "Coming soon" must not show a placeholder; it shows nothing for that module (and the D entry for F-H-09 covers the outage wording). Permission: no new link appears for anyone. |

### U-05 · Leave page: balance, approver and Recovery Leave named and found in one place

| | |
|---|---|
| ID / priority | `U-05` · LI (every employee, every leave request) · Source F-people-hr-22 (display part), F-people-hr-08 |
| Verification | Confirmed (code). Re-checked here: card labelled "Comp-off" at `apps/web/src/app/(app)/leave/page.tsx:80` and `employees/[id]/leave-section.tsx:62`; heading "Recovery Leave earning (Reporting Manager → HR Admin approval)" at `leave-section.tsx:99` (wording defect is in Section 3.1, F-people-hr-09); form text "...then routed to your approver." at `leave/new/leave-request-form.tsx:105-108` and no balance or name. |
| Current behaviour | F 5.1: the Recovery Leave balance is called "Comp-off" on `/leave` although the request type, policy and approvals say "Recovery Leave". Pending Recovery Leave earning requests are only on the profile Leave tab (My Day > People & HR > My Profile > Leave tab = 3 clicks, 3 page loads). Expiry date and ledger are shown nowhere though `comp_day_ledger.expiry_date` exists. The request form shows no remaining balance and no approver. Required fields 3 (start, end, type), optional 3. |
| User problem | An employee cannot tell whether they have enough days, who will decide, or when Recovery Leave expires, and asks HR or the manager outside the app. |
| Proposed behaviour (display only) | 1. Rename the card "Recovery Leave" on `/leave` and on the profile tab.<br>2. On `/leave`: a "Waiting for approval" list from `recovery_credit_requests` (type, work date, days, status, next approver role in words) and a read-only line "Next expiry: <date>" from `comp_day_ledger`; link "How Recovery Leave works" to the active policy page.<br>3. On `/leave/new`: after the type is chosen show "Your balance: N days" (the same figure as the card, from `leave_balances`) and "Goes to: <manager name>" using the existing narrow name-function pattern (`get_employee_manager_name`) or `resolve_approver`. If no approver can be resolved show the existing refusal text before the person fills the form (today it appears only after submit). |
| Before → after | Pending Recovery Leave earning requests: 3 clicks, 3 page loads → 0 extra clicks (same screen as the balance, 1 click from the sidebar). Expiry date: unreachable → visible. Approver and balance: asked outside the app → shown on the form. Required fields on the form: 3 → 3 (unchanged). |
| Roles affected | All employees; managers (their own leave); employees with no manager (told before submitting). |
| Data source | `leave_balances`, `comp_day_balances`, `recovery_credit_requests`, `comp_day_ledger`, manager name function. |
| Technical scope | Interface and server read. Migration only if the existing name function cannot be reused (to be checked). |
| Business-rule impact | None. No calculation, accrual, expiry or routing is changed or recomputed; the screen only displays stored figures. Project-lead routing of Recovery Leave is untouched. |
| Acceptance checks | Success: label reads "Recovery Leave" everywhere; an entry expiring in N days shows its date; with none the page says "No Recovery Leave"; balance on the form equals the card. Failure: a failed balance read shows a load error, not "0 days" (needs the D entry for F-people-hr-02). Permission: only the person's own rows are shown (RLS); the manager name function returns a name only, no other field. |

### U-06 · One list of "needs my decision" across Approvals and Finance

| | |
|---|---|
| ID / priority | `U-06` · LI (CEO/CTO, Finance, HR, managers) · Source F-E-04 (part F-A-17) |
| Verification | Confirmed (code). Not re-opened here beyond E's reuse map (E section 7); the reuse map names existing loaders. |
| Current behaviour | E P11: decisions sit in `/approvals` (table `approvals`) and `/finance/project-budgets` (`pbx_inbox`); a CEO/CTO with letters, payroll, Recovery queue and budget decisions checks 2 screens plus My Day (3 places). Finance sees rows "Waiting for the CEO or CTO" that they cannot act on in the same list. My Day has a decisions card of counts only (`decisions-card.tsx`). |
| User problem | The person has to remember several places; Finance and executives miss the one they did not open. |
| Proposed behaviour | A "Needs your decision" list (a section at the top of `/approvals` or an expansion of the My Day decisions card; owner chooses) with one row shape {kind, title, requester or project, amount or dates, waiting since, link}. Sources are only existing readers: `approvals` person-assigned rows plus eligible queue rows (`queueDecisionEligible`), `pbx_inbox()` rows with `i_can_decide` and not `on_hold` plus settlement rows with `i_can_close` or `i_can_confirm_receipts`, task reviews, handovers waiting on me, and U-01 rows. Each row links to the existing decision screen; no decision moves. A failed source shows "Could not load <source>", never zero. |
| Before → after | Places a CEO/CTO checks: 3 (My Day, Approvals, Finance) → 1. Interactions per decision are unchanged (E counted "4+" to clear one approval and one budget decision; they stay on the existing screens). |
| Roles affected | CEO/CTO, Finance (HR role and budget grant are separate), HR Admin, line managers, project leads, PMs. |
| Data source | `approvals`, `pbx_inbox()`, `loadMyWork().reviews`, `proj_handovers`, existing `buildActionItems(extraItems)`. |
| Technical scope | Server logic (read-only aggregator) and interface; no migration for sources that already have loaders. |
| Business-rule impact | None. No new approval path; independence and routing untouched; each decision still goes through its own function one at a time. |
| Acceptance checks | Success: a row appears only for items the viewer can decide now; the count equals the page. Failure: one source failing shows its own error line and the others still list. Permission: a user with no budget grant sees no budget rows; a requester never sees their own submission as decidable; other companies never appear; an `on_hold` item shows as on hold, not decidable. Shares the queue-count helper with the D entries for F-A-12 and F-E-02. |

### U-07 · Waiting time and "who holds it" on every pending item; "approver unavailable" shown

| | |
|---|---|
| ID / priority | `U-07` · LI (visibility only, rule-free) · Source F-E-06, F-E-07 (visibility part only) |
| Verification | Confirmed (code). Re-checked here: `approvals/page.tsx` selects `created_at` but renders no age (E cites `:34,38`); `approvals.ts:123` returns raw `error?.message`. Not re-opened: `status-badge.tsx:35-38` text "Waiting for approval". |
| Current behaviour | `/approvals` orders oldest first but shows no date or age; the budget inbox shows a submitted timestamp only (`inbox-list.tsx:231`). A requester sees "Waiting for approval" without the approver's name. If the approver is on leave or has left, nothing is shown to anyone; the only way out is to cancel and resubmit (E P11, F 5.1). `decide_leave_approval` accepts only the assigned approver. |
| User problem | Requesters cannot tell whether a request is merely slow or stuck; approvers and executives cannot see what has waited longest. |
| Proposed behaviour (visibility only) | 1. A label "Waiting 3 days" on every row in `/approvals` and the Finance inbox (calendar days since `approvals.created_at` or `submitted_at`). Colour turns amber after a number of days the owner sets; no colour until the owner sets it.<br>2. The requester sees "With: <approver name>" (person step) or "With: HR Admin queue" (role step) on their leave, claim and timesheet pages. The name comes from a narrow function that returns display name only.<br>3. "Approver unavailable" state: when the approver of record cannot sign in (account Deactivated) or the employee is Terminated, the requester, HR Admin and CEO/CTO of the company see "<name> is not available" next to the item. The requester's existing options (cancel and resubmit) are unchanged.<br>4. Not proposed here: any way to reassign, delegate or escalate. That changes who may approve and is an owner decision (E question 5, F question 6, G question 7). |
| Before → after | Inboxes that show waiting time: 0 of 2 → 2 of 2. Requester learning the approver's name: by asking → on the item (0 asks). A stalled request behind an unavailable approver: invisible → one visible line on the item. |
| Roles affected | Requesters (all staff), approvers, HR Admin, CEO/CTO, Finance. |
| Data source | `approvals.created_at`, budget `submitted_at`; one new SECURITY DEFINER read returning approver display name and "can sign in" only (a requester cannot read other employees' rows; do not read `profiles.status_reason`, see the D entry for F-G-04). |
| Technical scope | Interface plus one read function (migration). |
| Business-rule impact | None to routing or independence. Owner decision (not proposed): reassignment, delegation or escalation. |
| Acceptance checks | Success: the age equals days since creation; amber appears only after the owner threshold. Failure: a failed lookup says "Could not check who has this", not blank. Permission: a requester sees the approver only on their own items; an ordinary employee cannot read anyone else's approval or the leaver's deactivation reason. Source fix for deactivated approvers is the D entry for F-G-01; this entry only displays. |

### U-08 · Decision screen: readable claim rows, decide from the claim, plain errors

| | |
|---|---|
| ID / priority | `U-08` · LI (every approver, every day) · Source F-E-05 (parts F-H-14, F-H-20) |
| Verification | Confirmed (code). Re-checked here: `apps/web/src/app/(app)/approvals/decision-buttons.tsx` (`window.confirm("Approve this request?")`; reject reason optional via `reason.trim() || undefined`; buttons `size="sm"`; no catch for a dropped connection); `approvals.ts:123`. Claim row uuid fragment `approvals/page.tsx:486` and claim detail without buttons `reimbursements/[id]/page.tsx:113` are E's citations, not re-opened. |
| Current behaviour | Approve = click + browser confirm (2 interactions); reject = click, optional reason, "Confirm reject" (3); budget return or reject requires a reason (`projectBudget.ts:99,196`). Claim rows show `claim.id.slice(0,8)...` and a raw number; opening a claim shows no decision buttons, so the manager returns to the list. Leave rows are not clickable and give no overlap context. Errors are raw database text. |
| User problem | Managers cannot tell which claim is which, take an extra screen to review a claim, and get unreadable errors; the browser confirm is unstyled. |
| Proposed behaviour | 1. Claim row: claimant name, first category or description (or "N lines"), total in the company currency with 2 decimals, instead of the uuid fragment.<br>2. Approve and Reject on the claim detail when the viewer is its pending approver (same `decideApproval`, same checks).<br>3. Replace `window.confirm` by an in-page confirmation in the app's own style. Default: keep one confirmation for every type. One-click approve for leave, claims and timesheets only if the owner agrees; payroll export, Recovery credit and letters keep the confirmation (Recovery credit posts to a ledger immediately).<br>4. Plain messages ("already decided", "not assigned to you", "could not reach the server") through one shared friendly-error mapper (see U-26).<br>5. Approve and Reject at least the default button height on phone (today `size="sm"`, about 32 px per H).<br>6. Not proposed: bulk approve (independence; E question 2); required reject reason for leave (owner decision, parity with budgets). |
| Before → after | Review a claim then decide: 3 screens (list, claim, back to list) → 1 screen (E count). Approve a normal leave or claim: 2 interactions → 2 (default) or 1 if the owner accepts one-click for low-risk types. Claim row: 0 identifying fields beyond a uuid fragment → name, category, amount. |
| Roles affected | Line managers, HR Admin, Finance, CEO/CTO, project leads. |
| Data source | `approvals`, `reimbursement_claims` and lines, `decide_leave_approval` (unchanged). |
| Technical scope | Interface only (error mapper is shared with U-26). |
| Business-rule impact | None if every decision still calls `decide_leave_approval` one at a time. Removing the confirmation or adding bulk approval would touch independent approvals and is an owner decision. |
| Acceptance checks | Success: approve from the claim detail records the same result as from the list. Failure: a decision refused because already decided shows that sentence; a dropped connection shows "did not reach the server" and keeps the screen. Permission: the buttons appear only to the pending approver; a requester never sees decision buttons on their own claim; another approver cannot decide. |

### U-09 · Team view for managers and HR

| | |
|---|---|
| ID / priority | `U-09` · LI (every manager and HR Admin; today one person at a time) · Source F-people-hr-07, F-A-17 |
| Verification | Confirmed (code). Not re-opened beyond F 5.2 and A section 5; the RLS statement ("`is_manager_of`, chain") is F's reading of `leave_requests_select` and `attendance_select`. |
| Current behaviour | F 5.2: to see one report's leave: sidebar People & HR (1), type a search (1), click the row (1), click the Leave tab (1) = 3 clicks + 1 typed search, 3 page loads; repeated for every person. A Reporting Manager gets the Leave tab only for direct reports although RLS allows the chain. No list of pending leave requests or team balances exists. The approver card shows only a red "Insufficient balance" flag, not the number, and does not link to the employee. A My Day block for managers does not exist. |
| User problem | A manager planning cover, or HR answering "who is off next week", opens profiles one by one. |
| Proposed behaviour | 1. A "Team" tab on `/leave` for anyone with reports or HR/Finance/CEO/CTO scope: one table of the people the viewer can already read (name, annual balance, Recovery Leave balance, number of pending requests, next approved leave); row click opens the profile Leave tab.<br>2. Approvals leave card: employee name as a link and the actual balance number next to the "Insufficient balance" flag.<br>3. My Day "My team today" for people with reports: reports on leave today and requests waiting. Not proposed: "not clocked in" (it implies a rule from the attendance area; owner decision).<br>4. The list is whatever RLS returns; the app does not redefine "manager". Default shows direct reports until the owner answers whether skip-level managers should appear (F question 2). |
| Before → after | For 8 reports: about 25 interactions (1 sidebar + 8 x 3) and 24 page loads (derived from F 5.2) → 2 clicks and 1 page load, then 1 click per person only to open a profile. |
| Roles affected | Line managers, HR Admin, Finance, CEO/CTO. People holding several of these roles see the union their RLS gives. |
| Data source | `leave_balances`, `comp_day_balances`, `leave_requests`, `employees` (all already RLS-scoped). |
| Technical scope | Interface plus one read function (chain-aware, instead of the direct-report approximation in the UI helpers). |
| Business-rule impact | None. Read-only; reporting lines (including those based on project leadership) are not redefined; no balance recalculated. Owner decision: skip-level visibility. |
| Acceptance checks | Success: manager sees their reports, not peers; balances equal the profile tab. Failure: a failed read shows a load error, not an empty team. Permission: HR sees their company only; a person in another company never appears; an ordinary employee has no Team tab. |

### U-10 · Handover: "Save and submit" in one click, risks editable

| | |
|---|---|
| ID / priority | `U-10` · LI (every Sales win) · Source F-B-02 |
| Verification | Confirmed (code). Re-checked here: Submit renders only when a draft row exists (`apps/web/src/app/(app)/sales/opportunities/[id]/handover/project-handover.tsx:89-92`); `proj_save_handover` already accepts `risks` in its fields (`supabase/migrations/20261120000200_proj_projects_handover_functions.sql`, insert and update branches use `p_fields->'risks'`), so the field is interface only. |
| Current behaviour | B "Won -> handover": Close as won (open enquiry 1, click 2, 3 required fields + confirm 3), enquiry page, Handover package (4), "Save the delivery brief" (5), then a second button "Submit the handover" (6) = 6 clicks + 3 typed fields, 3 screens. The brief has 11 editable fields; scope is required to submit. Risks are copied from the enquiry at first save but the form has no risks field. |
| User problem | The first visit needs Save, a refresh, then Submit; people stop after Save and believe delivery has been told (the nothing-is-sent-yet state is shown in the D entry for F-B-01). |
| Proposed behaviour | 1. Primary button "Save and submit the handover" calls the existing save then submit in one server action; "Save draft" stays as the secondary button. The existing warning (visible to project members; no prices or PO details) sits beside the button.<br>2. Add a Risks textarea ("One per line", as on the enquiry).<br>3. Show the existing missing-items list (`buildHandoverPackage` gaps) next to the button.<br>4. Single handover unchanged: same statuses, same submit checks (scope still required), same one project per opportunity. |
| Before → after | Sales owner: 6 clicks → 5 clicks (Save and submit as one); first visit: save, refresh, submit (2 clicks and a reload) → 1 click. Fields: 11 editable → 12 (risks added). |
| Roles affected | Sales owner, Sales founder (prepare); PM and founders (receive, unchanged). |
| Data source | `proj_save_handover`, `proj_submit_handover`, `proj_handovers`. |
| Technical scope | Interface plus a server action that calls both functions in sequence. No migration. |
| Business-rule impact | None. The single working handover is untouched. |
| Acceptance checks | Success: one click creates the draft and submits; PM and founders get the existing notice. Failure: if scope is missing the existing message shows and the saved draft remains. Permission: a non-owner non-founder still sees the read-only brief; no notice is sent twice if the person clicks again. |

### U-11 · Report a blocker in 2 clicks and 1 field

| | |
|---|---|
| ID / priority | `U-11` · LI (any assignee, frequent on live events) · Source F-B-17 |
| Verification | Confirmed (code). Re-checked here: "Block task" is inside the "More" menu (`apps/web/src/components/projects/tasks/task-actions-menu.tsx:31-35`); "Who can unblock it" defaults to "Nobody in particular" and "Or what action will unblock it" is separate (`task-forms.tsx:45-48`). |
| Current behaviour | B P2 counts from My Work: click the task title (1), More (2), Block task (3), "Mark as blocked" (4) = 4 clicks, 2 fields (a required reason plus either a person or an action). A counts the same path from My Day as 3 screens (My Day, My Work, task panel); the panel is on the same URL (`?task=`), so B's "1 screen" and A's "3 screens" agree on the clicks. The PM or named person gets a notice only in My Work > Project notices; the department head is not told unless named; My Work has no Blocked filter. |
| User problem | A blocker is the most time-critical thing an assignee can report and sits under a menu; the right people often learn late. |
| Proposed behaviour | 1. A visible "Report a blocker" button on the task row and in the panel.<br>2. "Who can unblock it" preselects the department head of the task's team, else the PM (changeable; the rule "a person or an action" is kept; if the reporter is that person the field stays empty and the rule applies).<br>3. "Blocked" in My Work's "Show" filter plus a stat card (`work-logic.ts:88` has `mine, team, overdue, review` only).<br>4. Notify the head and the PM, not only the named person (a small edit to `proj_block_task`'s notify call). |
| Before → after | From My Work: 4 clicks + 2 fields → 2 clicks (button, submit) + 1 field (reason). From My Day with U-02: 1 click on the row's shortcut + reason + submit. |
| Roles affected | Assignees, department heads, PMs. |
| Data source | `proj_block_task`, `proj_tasks.blocked_at`, `proj_notify`. |
| Technical scope | Interface; migration only for the extra notification. |
| Business-rule impact | None. Who may block and clear is unchanged; Done stays blocked while flagged. |
| Acceptance checks | Success: button opens the dialog with the head or PM preselected; Blocked filter lists blocked tasks. Failure: with person and action both empty the existing refusal shows. Permission: a collaborator still cannot block; the actor is never notified; a head not on the project is not notified. |

### U-12 · Staffing and assigning work: no forced order, no silent "assign to me"

| | |
|---|---|
| ID / priority | `U-12` · LI (every new client project) · Source F-B-13 |
| Verification | Confirmed (code). Re-checked here: Assignee state in `quick-add-task.tsx:21-22`; hint text "You can add tasks for yourself..." at `:37`. Empty-state text is plain at `work/page.tsx:390` (B's citation, not re-opened). |
| Current behaviour | B P5: after "Accept and create the project" the Work tab says "No tasks yet" and "Add a department team on the People page first, then give it a deliverable". Forced order: People, then team, then deliverable, then task. Quick add defaults the assignee to the current user, so for others the PM picks the assignee every time. One team of 3 and 3 tasks: about 30 interactions over 3 screens. |
| User problem | A first-time PM does not know the order; tasks meant for the team are silently assigned to the PM. |
| Proposed behaviour | 1. Empty-state checklist with direct buttons: Add people, Add team, Add deliverable, Add task (each opens its existing dialog).<br>2. In "Add task" for managers the assignee starts blank ("Choose...", required); ordinary members keep "myself" as the default.<br>3. The assignee list includes "Add someone to the project..." for eligible people (needs a Projects grant; see U-13). Department heads keep distributing within their team. |
| Before → after | 3 tasks for a team of 3: about 30 → about 20 interactions (B's estimate, a target). First-time PM no longer needs to know the menu. |
| Roles affected | PMs, department heads, ordinary members (unchanged default). |
| Data source | Existing project, team, deliverable and task functions. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | Success: empty project shows the four buttons; manager must pick an assignee. Failure: a person without a Projects grant is not offered (existing refusal text stays). Permission: heads cannot assign outside their team; ordinary members cannot assign to others. |

### U-13 · "Ask for access" with names, instead of "Ask a founder"

| | |
|---|---|
| ID / priority | `U-13` · LI · Source F-G-14, F-B-12 |
| Verification | Confirmed (code). Re-checked here: no request-access flow found by G or B (their searches); the message "A founder gives them access first" is in `proj_add_member` (B cites `20261120000200:712`, not re-opened). |
| Current behaviour | Denials say "Ask a founder" or "Ask an Inventory founder" with no name and no way to ask (`projects/new/page.tsx:23`, `sales/new/page.tsx:25`, `inventory/stock/page.tsx:56`, `with-people.tsx:42`). A PM's "Add a person" lists only people who already hold a Projects grant; anyone else needs a grant from a founder or `manage_access` holder. B counts the workaround as about 6 clicks across 2 people and 3 screens. |
| User problem | Staff and PMs hit a wall and do not know whom to ask. |
| Proposed behaviour | 1. Every denial names the access managers and founders of that module and company (names only; function limited to the requester's company).<br>2. "Ask for access" button writes one notice per access manager (new type `access_requested`; gives no right).<br>3. Access managers see these in People & Access ("Access requests") or in the shared notices inbox (N part, F-A-14). Without a reader the button must not ship; parts 1 and 4 can ship alone.<br>4. In a PM's "Add a person", a second group "Employees without Projects access" (names only) with "Ask for access". |
| Before → after | PM: about 6 clicks over 2 people and 3 screens → 2 clicks by the PM, then the access manager acts once (B). Denial screen: 0 names, 0 actions → names plus 1 click. |
| Roles affected | Everyone who is denied; PMs; access managers and founders. |
| Data source | `*_staff_directory`-style functions; `notifications`. |
| Technical scope | Server logic (notice and directory read, migration for a type or function) and interface. |
| Business-rule impact | None. No right is given; the PM still cannot grant; sensitive-grant protections unchanged. Owner confirms that names of access managers are shown to ordinary staff of the same company. |
| Acceptance checks | Success: request reaches every access manager and founder; PM still cannot add the person until a grant exists. Failure: if the directory read fails the denial shows the generic text, not a wrong name. Permission: names are limited to the requester's company; a revoked grant ends membership at once (existing `proj_user_eligible`). |

### U-14 · Sales follow-ups: log a call and plan the next step in one dialog

| | |
|---|---|
| ID / priority | `U-14` · LI (every follow-up; interface only; B rated later, raised because the completion dialog asks for a typed date every time) · Source F-B-19 (B P4 A/B/C) |
| Verification | Confirmed (code). Not re-opened here; B's count of three dialogs and defaults is from `follow-ups` components and `crm_complete_follow_up`. |
| Current behaviour | B P4: (A) "Complete" on a Follow-ups row: "What happened?" (required), then radio "What happens next?" (default "Add the next follow-up"), Next action (required), Date (required, no default), Time (10:00), Type (default Other, whereas create defaults Call) = 2 clicks + 3 required fields. (B) "Add follow-up" from an enquiry = 3 clicks + 2 required fields. (C) "Add update" (Kind default Note, What happened, Internal note) writes an activity and does not touch follow-ups, so logging an unscheduled call and planning the next step is C then B: 2 dialogs, about 10 interactions. |
| User problem | Three dialogs with different defaults for one thought: "I called, here is what happened, call again Thursday". |
| Proposed behaviour | 1. In "Add update", an optional section "Schedule the next follow-up" (what needs to happen, date, time, type, assigned to).<br>2. Date defaults to the next working day from the company calendar already stored in Sales settings (visible, editable, still required); type defaults to the type of the follow-up being completed instead of Other.<br>3. Honest about transactions: activity and follow-up are two calls; if the follow-up fails the activity stays saved, the dialog says so and keeps the follow-up fields for a retry without writing the activity twice. |
| Before → after | Log a call and plan the next step: 2 dialogs, about 10 interactions → 1 dialog, about 6 (B). Complete a follow-up: 2 clicks + 3 required fields (date typed) → 2 clicks + 2 typed fields (date prefilled). |
| Roles affected | Sales owners and follow-up assignees. |
| Data source | `crm_add_activity`, `crm_create_follow_up`, `crm_complete_follow_up`, company calendar in `crm_company_settings`. |
| Technical scope | Interface plus one server action calling two existing functions. |
| Business-rule impact | None. An active enquiry still needs a next action; ownership and assignment rules unchanged. |
| Acceptance checks | Success: one dialog saves the update and a dated follow-up. Failure: follow-up error leaves the activity saved once and the form open. Permission: "Assigned to" appears only to people allowed to assign (unchanged); a user without Sales access sees nothing. |

### U-15 · Actual expenses: stop repeating "How paid" and "Who paid"

| | |
|---|---|
| ID / priority | `U-15` · LI (every PM, every project) · Source F-E-13 |
| Verification | Confirmed (code). Not re-opened; E cites `actuals-section.tsx:192-235, 270, 351`. |
| Current behaviour | E P9: after "Start entering actual expenses" (1 click), each non-zero line needs Actual (required), "How was it paid?" (required, 5 options), "Who paid?" (required for advance or personal), and a claim select if "existing claim"; nothing carries to the next line; every zero line needs an explicit "0". A 12-line all-personal budget is about 36 entries plus 3 (start, confirm, submit) = about 39. |
| User problem | The same two answers are chosen again on every line. |
| Proposed behaviour | 1. Each new line starts with the previous line's "How paid" and "Who paid" (visible, editable), not a hidden default.<br>2. "Same payment details for all lines in this category" shortcut.<br>3. "Set all remaining blank lines to 0" with a confirmation.<br>4. Keep the single "Start entering actual expenses" button. Auto-creating the draft when the tab opens is not proposed (a page read would write a record).<br>5. The completeness checkbox "I confirm these actual expenses are complete" and the variance note stay. |
| Before → after | 12 non-zero all-personal lines: about 39 → about 18 (12 amounts, 2 payment choices once, start, confirm, submit; a target). |
| Roles affected | PMs entering actuals; Finance (reads the result unchanged). |
| Data source | Existing actuals draft functions (`pbx_start_actuals`, `pbx_save_actuals_draft`). |
| Technical scope | Interface only. |
| Business-rule impact | None. Receipts remain physical; nothing about submission or approval changes. |
| Acceptance checks | Success: second line opens with the first line's values; category shortcut fills only that category. Failure: blank lines still block submit until set or zeroed. Permission: only the PM (or Finance, as today) edits; an unsubmitted draft stays company-scoped. |

### U-16 · Budget lines: duplicate a line, pre-tick the people, remember choices

| | |
|---|---|
| ID / priority | `U-16` · LI (duplicate line only; copy from another budget is N, see below) · Source F-E-12 (interface part) |
| Verification | Confirmed (code). Not re-opened; E verified absence in `components/budget/*` and `pbx_*`. |
| Current behaviour | E P8: per line "Add line" (1), Description (1), Activity (0-1), calculation basis (0-1), dates (0-2), 1 to 3 numbers = 3 to 6 per line; a 10-line budget is about 30 to 60 interactions. "People this budget covers" checkboxes start empty. No duplicate, no copy, no template. |
| User problem | Similar lines (meals on three days, transport legs) are typed again from scratch. |
| Proposed behaviour | 1. "Duplicate line" button (client-side copy of the row, still a draft; totals recalculated by the database as today).<br>2. Pre-tick all project members in "People this budget covers" (editable).<br>3. Remember the last Activity. |
| Before → after | 10-line budget: 30 to 60 → about 15 to 35 interactions (E target). |
| Roles affected | PMs. |
| Data source | Existing draft editor and functions. |
| Technical scope | Interface only. "Copy lines from another of my project budgets" is new functionality (N part, F-E-12). |
| Business-rule impact | None. Same submission and approval; calculation rules untouched (rounding once per line). |
| Acceptance checks | Success: a duplicated line saves and totals match the database. Failure: duplicating past the line limit shows the existing message. Permission: unchanged, PM-only drafts. |

### U-17 · Budget currency: choose, do not type, an irreversible code

| | |
|---|---|
| ID / priority | `U-17` · LI (money entry; a typo is permanent) · Source F-E-14 |
| Verification | Confirmed (code). Not re-opened; E cites `budget-section.tsx:82-88` and `pbx_budget_header_guard` (`...0100:514`). |
| Current behaviour | "Expense currency" is a free 3-letter field, prefilled from the company default; the screen says it cannot be changed once the budget exists. A typo such as "AEF" stays; Finance rates are per currency and never apply to it. Recovery needs the owner (SQL). |
| User problem | An irreversible field is typed freehand. |
| Proposed behaviour | A select: the company default first, then currencies already used by the company's budgets or rates, then "Other..." validated against the currency list the app already uses for decimals; a line under the field "Budget currency will be AED and cannot be changed afterwards". |
| Before → after | Typed fields: 1 (3 letters) → 0 in the common case (default preselected); wrong codes refused before creating, instead of after. |
| Roles affected | PMs creating budgets. |
| Data source | Company default, existing budgets and rates. |
| Technical scope | Interface only. |
| Business-rule impact | None. One currency per budget, no conversion, unchanged. The sibling defect (currency silently defaults to AED when the company read fails) is in Section 3.1 (F-H-12). |
| Acceptance checks | Success: default currency preselected; an unknown code cannot be chosen. Failure: if the company read fails the form says so (not AED). Permission: unchanged; existing budgets untouched. |

### U-18 · Finance inbox opens on what Finance must do now

| | |
|---|---|
| ID / priority | `U-18` · LI · Source F-E-11, F-E-22 |
| Verification | Confirmed (code). Not re-opened; E cites `pbx_inbox` (`...0400:242-243`) and `inbox-list.tsx:286-322`. |
| Current behaviour | `pbx_inbox` lists every open budget with an approved baseline above 0 or any funding; most show "Waiting for the final expenses". "All (n)" mixes "needs Finance" with "waiting on the PM". Rows "Waiting for the CEO or CTO" and rows the person authored sit beside rows they can decide. Filters exist only by section and company. |
| User problem | Finance scans a long list to find the few rows that need them. |
| Proposed behaviour | Three groups, first expanded: "Needs Finance now" (`i_can_decide`, receipts, payments, close), "Waiting for the PM", "Waiting for the CEO or CTO / yours, you cannot decide" (collapsed). Counts per group. The Finance nav entry and My Day show the count of the first group (supplied by the D entry for F-E-01; build one helper). |
| Before → after | Rows to scan for the next action: all open budgets (n) → only the first group; filter clicks to get there: 1 or more → 0 (default view). |
| Roles affected | Finance (budget grant), CEO/CTO executive approvers, view-only grantees. |
| Data source | Existing `pbx_inbox()` flags. |
| Technical scope | Interface only. |
| Business-rule impact | None; display grouping only. Independence and on-hold behaviour unchanged. |
| Acceptance checks | Success: a decidable row is in group 1; an own-authored row is not. Failure: failed inbox read shows the existing load error. Permission: unchanged; view-only grantees see no action buttons. |

### U-19 · Onboarding: enter each fact once, with a "waiting for a login" hand-off

| | |
|---|---|
| ID / priority | `U-19` · LI (biggest repeated-entry item in People & Access) · Source F-G-08 |
| Verification | Confirmed (code). Not re-opened; G 5.2 lists the 8 steps with citations. |
| Current behaviour | G 5.2: HR creates the employee (15 inputs, 10 required, no department, manager or login e-mail), then HR in People & Access sets department and manager, Sys Admin invites (name and e-mail again), the new hire sets a password, HR links the account (types the e-mail again), a Sales grantor and a Projects grantor give access, the PM adds the person. 8 screen visits, 5 distinct people, about 14 required entries plus 4 to 6 selections. Entered twice: name (steps 1 and 3), e-mail (steps 3 and 5), hire date and contract start date (both required, not linked), job title (steps 1 and 2). Nothing tells the next person. |
| User problem | HR and the Sys Admin retype the same facts and nobody knows who is waiting for whom. |
| Proposed behaviour | 1. New-employee form gains Department, Reporting manager and Work e-mail (login) and defaults contract start date to the hire date (editable).<br>2. Sys Admin sees a "Waiting for a login" list (employees with a work e-mail and no linked account), each row with Invite prefilled with name and e-mail.<br>3. Owner decision: when an invite is sent and exactly one unlinked employee has that e-mail, link automatically. Without this, the HR Admin keeps linking by hand, but the e-mail now comes from the HR record (see the D entry for F-G-12 on wildcard matching).<br>4. Dependency: the department list is empty until departments can be created (N part, F-G-10). |
| Before → after | Screens: 8 → 3 plus module grants; typed entries saved: 6 (name once instead of twice, e-mail once instead of twice, contract start date, department and manager picked at creation); step "type the e-mail again to link" removed if (3) is approved (G's counts). |
| Roles affected | HR Admin, Sys Admin, module grantors, PMs. |
| Data source | `employees` (one new nullable work e-mail column, or `personal_email` with an explicit "use as login" flag), `profiles`. |
| Technical scope | Migration (column and audit), server logic, interface. |
| Business-rule impact | None to approvals or grants. Automatic linking moves the link act from an HR Admin action to the invite; owner decision. Invite stays Sys Admin only. |
| Acceptance checks | Success: an employee with an e-mail appears in the waiting list for the Sys Admin only. Failure: two employees with the same e-mail: no automatic link and a warning; an account already linked: error as today. Permission: HR Admin of company A cannot see company B's list; module access is still granted by each module's grantor. |

### U-20 · Role packs for module access

| | |
|---|---|
| ID / priority | `U-20` · LI · Source F-G-09, F-G-17 (option a only) |
| Verification | Confirmed (code). Presets from `peopleAccess.ts:135-174` (G); not re-opened. |
| Current behaviour | There is no "Project Manager", "Technician", "Marketing", "Operations", "Finance staff" or "Event staff" preset. Every project participant first needs a Projects grant row, which is the "Directory only" preset with zero capabilities (select preset, "Add preset" does nothing, "Give access"). People needing several modules repeat the card per module; each module is 3 interactions. |
| User problem | Grantors translate a job into several presets by memory. |
| Proposed behaviour | A "Role pack" selector at the top of Module access that fills the existing cards with a preview of the differences; each save still goes through the same function and rules per module. Starting packs, each only a list of existing preset ids: Event staff = Projects basic; Sales person = Sales basic + Projects basic; Storekeeper = Inventory storekeeper (plus location choice); Finance staff = Budget Finance; Executive (option a, no model change) = Budget approver + Sales basic + Projects basic + Inventory viewer. Modules the viewer cannot grant show "someone else gives this". No pack contains founder or `manage_access`. Marketing, Operations and Technician packs wait for the owner's answer on what those people need (G section 6B). |
| Before → after | Onboarding a Sales + Projects employee, steps 6 and 7: 6 interactions (2 x select, add, give) → 4 when two different people grant (1 pack + 1 confirm each) or 2 when one person grants both. |
| Roles affected | Module access managers and founders; the people receiving access. |
| Data source | Existing presets and grant functions. |
| Technical scope | Interface only. |
| Business-rule impact | None. No new rights; sensitive-grant protections stay inside the grant functions. A read-only "see all project details" right (G option b) is a model change and is not registered here. |
| Acceptance checks | Success: choosing "Sales person" fills Sales basic and Projects basic previews. Failure: a module the viewer cannot grant is shown as not theirs to give and is not saved. Permission: every save is checked by the existing function (founder and `manage_access` rules intact). |

### U-21 · Account menu and grant names say what the person is

| | |
|---|---|
| ID / priority | `U-21` · LI (shown to the majority of staff) · Source F-G-07, F-G-19 |
| Verification | Confirmed (code). Re-checked here: "No role assigned" at `apps/web/src/components/nav/user-menu.tsx:61` and "No role assigned yet" at `:82`; invite note "grant a role once they've accepted" at `apps/web/src/components/people-access/invite-user-form.tsx:32`. |
| Current behaviour | The user menu prints HR roles only, so an ordinary employee or module-only person reads "No role assigned"; the `employee` role row is read by nothing. The invite form tells admins to grant a role although ordinary staff need none. Two grants are both called "Finance" (HR role for compensation and payroll; Budget grant for project budgets) and two "availability" grants share a name (Sales availability confirmation vs the Warehouse availability check). |
| User problem | Staff think something is missing; admins grant the wrong "Finance". |
| Proposed behaviour | The menu shows "Employee" when a linked employee exists, plus chips for module grants ("Sales founder", "Projects access"). Drop the "grant a role" sentence for ordinary staff. Labels: "Finance (HR and payroll)" vs "Finance (project budgets)"; "Sales availability confirmation" vs "Warehouse availability check". Never require the Employee role. |
| Before → after | "No role assigned" shown to every ordinary employee → 0. Two ambiguous "Finance" labels → 2 distinct labels. |
| Roles affected | All staff; Sys Admin and access managers. |
| Data source | `user_roles`, module grants, linked employee. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | Success: ordinary employee sees "Employee". Failure: a failed role read shows a load error, not "Employee" or "No role" (D entry for F-A-01). Permission: no new right is implied by a label. |

### U-22 · Policies and Holidays readable by staff, own country first

| | |
|---|---|
| ID / priority | `U-22` · LI (every employee who opens either page) · Source F-A-21, F-people-hr-13 |
| Verification | Confirmed (code). Re-checked here: raw "Payload" JSON card at `apps/web/src/app/(app)/policies/[id]/page.tsx:201-204` (A cites `:218-224`, F cites `:199-206`; the code is at 201-204); Recovery Leave policy has database wording (`:57`); internal reference "docs/02-database-schema.md §2.4" at `policies/new/page.tsx:22`; hard-coded "2026 holidays pending confirmation" at `holidays/page.tsx:50`; "Public holidays" button `policies/page.tsx:95`. |
| Current behaviour | Staff see all countries and years of active policy versions; every policy opens a raw JSON "Payload"; holidays list all countries with no filter and never show `is_paid`; My Day's holiday card is HR and C-level only, so staff see holidays only on `/holidays` (2 clicks). Only Recovery Leave has readable wording. |
| User problem | An employee wants "which days off do I get, what does the policy say for me" and gets a configuration console. |
| Proposed behaviour | 1. Staff view of `/policies`: own country first with "Show other countries"; policy rows open a plain-language page (existing wording for Recovery Leave; for other policy types a short generated summary of entitlements, or "Details are held by HR" until text exists). Raw JSON and drafting controls only for HR Admin.<br>2. `/holidays`: own country by default, paid or unpaid shown; HR keeps add and delete.<br>3. My Day "Upcoming holidays" card for everyone (own country, from `public_holidays`).<br>4. The hard-coded "2026 holidays pending confirmation" alert is replaced by a data-driven note or removed once the owner confirms it is current. |
| Before → after | Employee sees: all countries and a raw JSON card → own country, plain wording, 0 JSON. Next holiday: 2 clicks to `/holidays` → 0 clicks (My Day). |
| Roles affected | All staff; HR Admin (controls stay on the same pages). |
| Data source | `policy_versions` (active only), `public_holidays`, employee's company or country (field to confirm in implementation). |
| Technical scope | Interface only. |
| Business-rule impact | None. Access is unchanged (active policies and holidays remain readable by every signed-in user); only the default view changes. Owner decision (A question 2): whether other countries should stay visible at all. Plain-language text for policy types without generated wording is content work for HR. |
| Acceptance checks | Success: employee in country X sees X first. Failure: a failed read shows a load error, not "No policies yet". Permission: draft and superseded versions remain hidden by RLS; a non-HR user sees no Draft button; HR Admin still activates with the existing two-person rule. |

### U-23 · Receive back: set one condition for several ticked lines, never a default

| | |
|---|---|
| ID / priority | `U-23` · LI (every return) · Source F-C-16 |
| Verification | Confirmed (code). Re-checked here: `apps/web/src/components/inventory/workspace/receive-step.tsx`: nothing is ticked; a condition select appears only after a unit is ticked or a quantity typed, starts at "Choose condition" and the review refuses lines without one (`:61-65`); no "tick all" or "set all" exists in this file; counted lines use the shorter list Good / Needs checking / Damaged (`words.ts:19`). The Send step already has "Tick all N of these" per item (`send-step.tsx:206`). |
| Current behaviour | C P7a: 10 individual units + 2 counted lines = 10 ticks + 10 condition choices + 2 quantities + 2 conditions + Review + Confirm = 26 interactions. The older Stock "Return" form starts every line at "Good"; that default is a defect (Section 3.1, F-C-03) and this entry must not be used to justify it. |
| User problem | A clean return of a crate costs 26 interactions; the temptation is to use the old form with its default. |
| Proposed behaviour | 1. Above the list, "Set the condition for all ticked lines": a select that starts empty ("Choose condition", never preselected) and a button "Apply to N ticked lines". It fills only ticked lines that have no condition yet and never overwrites a line the person already set.<br>2. Any value may be chosen, including Damaged; a value that is not valid for counted lines (Fair, Cannot be used) leaves counted lines unset and says so.<br>3. Kit units are not changed by the helper until the kit contents check exists (N part, F-C-21); each needs its own explicit choice.<br>4. Optional, owner or operator preference: per-item "Tick all N of these" as in Send out. Ticking stays an explicit assertion that the unit is physically here; there is no global "everything came back".<br>5. The "Available again" or "Held, not available" badge per line and the review page stay. |
| Before → after | Clean return (10 units + 2 counted): 26 → 16 interactions with the helper alone (10 ticks, 2 quantities, 2 for the helper, review, confirm); about 9 if the 10 units fall into 3 item groups and per-item tick-all is added (3 + 2 + 2 + 2; derived, assumption stated). C's "about 6" is not reproducible without a global tick-all, which is not proposed. |
| Roles affected | Warehouse operators, Inventory founders. |
| Data source | `inv_return_from_project` input (unchanged); `Candidate` list. |
| Technical scope | Interface only. |
| Business-rule impact | None. Movement history and the rule that damaged or unchecked equipment never becomes available automatically are untouched, because "Good" is only ever an explicit choice. |
| Acceptance checks | Success: choosing Good and applying fills only ticked lines. Failure: pressing Apply with nothing ticked or no condition chosen does nothing and says why; Review still refuses a ticked line without a condition. Permission: only operators at the location see the step (unchanged); a kit unit remains unset after Apply. |

### U-24 · Reserve per line: options for a "reserve what is free" action

| | |
|---|---|
| ID / priority | `U-24` · LI, needs an owner and technical decision (it was deliberately left out of the Inventory simplification) · Source F-C-15 |
| Verification | Confirmed (code). Re-checked here: `inv_reserve(p_line_id, p_location_id, p_unit_ids, p_qty, p_shortage_action, p_rental_reference)` (`supabase/migrations/20261201000400_inv_planning_functions.sql:957-1099`): has no idempotency key; it locks the request and the item, reserves only what remains for that line, picks free units itself when no units are given and reports the rest as a shortage (shortage is a result, not an error), raises "This line is already fully reserved" when nothing remains, and checks every unit through `inv_reserve_block_reason`, `inv_unit_free` and the exclusion constraint. `docs/inventory-simplification.md` section 5 says an app-layer loop is not atomic. Not run. |
| Current behaviour | C P7a: per line "Reserve" (1) opens a dialog (location defaults to pickup, "Pick free ones for me", quantity prefilled), "Reserve" (1) = 2 clicks per line; a 12-line handover request = 24 clicks. The dialog is already prefilled for the common case. |
| User problem | The warehouse presses the same two buttons per line. |
| Proposed behaviour | Three options, owner and engineer choose: **A. Keep per line.** Already prefilled; no change; 24 clicks for 12 lines.<br>**B. Interface button that calls the existing per-line action in sequence** ("Reserve what is free for all open lines"), with a per-line result list. Not atomic: each line commits by itself, so a failure halfway leaves earlier lines reserved. Each reserved line is valid on its own and pressing the button again continues with what remains (an already-full line is skipped), so there is no wrong state, only a partial one that is shown. No migration.<br>**C. One server function in one transaction** (`reserve all free for a request at one location`): all-or-nothing for unexpected errors (permission, window ended, status), and a shortage on a line is reported per line, not raised. Safe to repeat because it reserves only what remains. It must reuse the same availability checks as `inv_reserve`, so it should share one internal routine with `inv_reserve`; changing that routine touches the booking path, which is why it needs review and RLS tests. Lines should be processed in a fixed order to avoid lock contention between simultaneous callers (Needs runtime confirmation).<br>Common to B and C: the button reserves at one chosen location (pickup by default); shortage actions (need to buy, need to rent) are not set by it; lines left short stay visible (see U-25). |
| Before → after | 12 lines: 24 clicks → 2 (button, confirm) plus reading the result list, under B or C; unchanged under A. |
| Roles affected | Warehouse operators (location-assigned) and Inventory founders. |
| Data source | `inv_reserve` and its checks; `inv_request_lines`, `inv_reservations`. |
| Technical scope | A: none. B: interface only. C: migration (new function, possible refactor of `inv_reserve`). |
| Business-rule impact | None intended: booking conflicts are never bypassed and nobody's reservation is displaced; movement history untouched. Option C changes code on the booking path, so it needs the owner's explicit approval and RLS tests. |
| Acceptance checks | Success: a request with 3 free and 1 short line reserves 3 and lists the short one. Failure: operator without the location gets the existing refusal and nothing is reserved; with C a mid-run unexpected error leaves nothing reserved, with B earlier lines remain and are listed. Permission: only operators of that location; a unit reserved by another request is never taken; pressing twice reserves nothing extra. |

### U-25 · Inventory Today: hide what cannot be finished, show what is held for checking

| | |
|---|---|
| ID / priority | `U-25` · LI (held units are otherwise found only by filtering Stock) · Source F-C-20, F-C-17 (held-units part) |
| Verification | Confirmed (code). Not re-opened beyond C's citations (`planning.ts:224`, `today.ts:156`; held model in C section 4: held = active unit on the shelf with condition not good or fair). |
| Current behaviour | Lines marked "need to buy", "need to rent" or "nothing to buy or rent" still count as "to reserve", so the request stays a "Prepare equipment" row until reserved, substituted or cancelled. Units held back for checking have no list, queue or Today row; C P7e: release takes 9 interactions (Stock, filter Condition, open item, open unit, More actions, Check condition, pick condition, Review, Confirm). |
| User problem | Today lists work nobody can finish and omits work that is waiting for an operator. |
| Proposed behaviour | 1. Lines with a shortage action stop counting as "still to reserve"; the row says "waiting on purchase or rental".<br>2. New Today source for operators: "Held for checking" listing held units and balance rows at the working warehouse, each row opening the unit's existing "Check condition" form. Releasing is unchanged: an operator at the location chooses the condition.<br>3. A failed source shows "?" as the other Today sources do. |
| Before → after | Finding a held unit: Stock + filter + open (3 or more interactions, per visit, or never) → 0 (listed). Release: 9 interactions → about 4 (Today row, choose condition, Review, Confirm; derived from C P7e). |
| Roles affected | Warehouse operators; PMs see requests no longer stuck as "to prepare". |
| Data source | `inv_units.condition`, `inv_balances.condition`, request lines' `shortage_action`; `inv_check_condition` unchanged. |
| Technical scope | Server logic (read) and interface. |
| Business-rule impact | None. No change to who may release a held unit, to `inv_unit_usable`, to bookings or to movement history. |
| Acceptance checks | Success: a damaged returned unit appears in "Held for checking" at that warehouse; a request with only short lines shows "waiting on purchase or rental". Failure: source read failure shows "?" and the rest of Today loads. Permission: only people who can view stock at that location see unit rows; release still needs the operator right. |

### U-26 · Plain reasons when a leave request or a decision is refused

| | |
|---|---|
| ID / priority | `U-26` · LI (leave and approvals are daily) · Source F-H-13, F-H-14 |
| Verification | Confirmed (code). Re-checked here: one generic sentence for every refusal at `apps/web/src/lib/actions/leave.ts:166-168` ("Could not submit the leave request. Please try again, or contact HR Admin if the problem continues."; H cites `:157-159`, the code is now at 166-168); `approvals.ts:123` returns `error?.message`; `decision-buttons.tsx` has no catch for a dropped connection. |
| Current behaviour | `submit_leave_request` can refuse for an overlapping request, no workflow, no resolvable approver, self-approval or a stale policy; the person always sees the same sentence. Approval and claim actions show raw database messages. |
| User problem | The person retries or contacts HR without knowing the cause. |
| Proposed behaviour | A shared `friendlyError` (as Budget, Projects and Sales already have): map the overlap constraint to "You already have a leave request that overlaps these dates."; pass through the function's own sentences for no approver and similar; "already decided"; "could not reach the server" for network failure, keeping the form content. Unknown errors keep a generic sentence plus a way to report it. |
| Before → after | Distinct reasons told to the person on a refused leave request: 1 generic → at least 4 specific (overlap, no approver, stale policy, self-approval). Raw database text shown on approval actions → 0. |
| Roles affected | All staff submitting leave or claims; all approvers. |
| Data source | SQLSTATE and messages from existing functions. |
| Technical scope | Server logic and interface. |
| Business-rule impact | None. |
| Acceptance checks | Success: submitting overlapping dates shows the overlap sentence. Failure: a dropped connection keeps the form and says the request did not reach the server. Permission: messages never reveal other people's data (for example whose request overlaps). |

### U-27 · Leaver checklist on People & Access

| | |
|---|---|
| ID / priority | `U-27` · LI (pairs with the D entry for F-G-01; otherwise LT) · Source F-G-02 |
| Verification | Confirmed (code). Not re-opened; G 5.3 lists the separate actions. |
| Current behaviour | Leaving is three unconnected systems: HR sets status Terminated (touches no account or grants), the Sys Admin deactivates the account (`window.prompt` reason; touches no grants), each module access manager removes access per module and company, HR roles are revoked one by one. G counts up to 2 + 4 + n_roles actions by up to 6 people with no list of what the person still holds. |
| User problem | Nobody can see what remains to be switched off. |
| Proposed behaviour | For a Terminated employee or Deactivated account, a "Leaver checklist" in the Account tab: HR status, account status, each HR role, each module grant, each project role (PM of live projects, team head), equipment held (`view_employee_custody`), each with its existing action button. It shows only what the viewer may see; buttons are disabled with a reason where the viewer cannot act. Build the read function once with the Deactivate safety panel proposed in the D entry for F-G-01. |
| Before → after | 6 to 10 screens or dialogs across up to 6 people (G) → 1 panel, each person still does only their own part, on one screen. |
| Roles affected | Sys Admin, HR Admin, module access managers. |
| Data source | Existing grant tables, `proj_projects`, `proj_teams`, `view_employee_custody`; one read function for project and equipment holdings visible to an access manager. |
| Technical scope | Interface plus one read function (migration). |
| Business-rule impact | None. Existing guards (refuse while PM of a live project, sole executive approver) are reused; nobody gains a right. |
| Acceptance checks | Success: lists exactly what the viewer is entitled to see. Failure: a failed read says it could not load, not "holds nothing". Permission: an HR Admin does not see module grants they cannot manage; buttons act through the existing functions only. |

### U-28 · Sales quick add: one organisation control, time and type

| | |
|---|---|
| ID / priority | `U-28` · LT · Source F-B-18 |
| Verification | Confirmed (code). Not re-opened; B P4 counts. |
| Current behaviour | B P4: quick add is 7 actions on 1 screen (open, open dialog, 2 typed, 2 selections, submit); 4 required fields supplied by the person; time (10:00 Dubai) and type (Call) are fixed in the quick form; organisation is a search box plus a select (two controls); a missing organisation costs a nested dialog (+4 interactions). |
| User problem | Extra controls and a nested dialog for a common case. |
| Proposed behaviour | One searchable organisation combobox with "Add <typed name>" inline (the existing duplicate finder stays); next-action type and time beside Due; Next action prefilled "Call to qualify the brief" (editable). |
| Before → after | 7 actions → 5 for the common case (B). A new organisation: +4 → +1. |
| Roles affected | Sales owners. |
| Data source | `crm_find_similar_organisations`, `crm_create_opportunity`. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | Success: new enquiry created with chosen time and type. Failure: organisation list failure shows an error, not empty pickers (D entry for F-B-09). Permission: unchanged. |

### U-29 · Inventory: remaining Today sources, "Send to another warehouse", Counts link

| | |
|---|---|
| ID / priority | `U-29` · LT (the held-units part is U-25) · Source F-C-17 (rest), F-C-22, F-C-23, F-C-19 (Counts part) |
| Verification | Confirmed (code). Not re-opened beyond C's citations. The nav and page-gate mismatch for acting PMs and team heads is a defect in Section 3.1 (F-G-05 / F-C-19; C labelled it usability, G labelled it defect, the defect register owns it). |
| Current behaviour | Not on Today: rentals due (`inv_rentals.return_deadline`), units out for repair and their return, overdue employee equipment for HR or managers, outgoing transfers in transit (source warehouse sees no row), equipment with no expected return (`today.ts:206`); counted stock out appears only under "All warehouses". Sending a transfer has no Today or header entry: C P7b, Stock, search, open item, More actions, "Move to another warehouse", Send to, 2 for lines, Review, Confirm = about 10 interactions. Warehouse and `confirm_stock` reach Counts only by URL. A project's Today row names one request although Receive back lists everything the project holds. |
| User problem | The warehouse must remember these. |
| Proposed behaviour | Add the four read-only Today sources using existing columns; "Send to another warehouse" in the Stock header for operators; a "Counts" menu entry for people with `warehouse` or `confirm_stock`; Today return rows say "N items out for <project>" instead of naming one request. Line managers requesting equipment for employees (SQL allows it, the UI never offers it, and RLS then hides the request) is an owner decision and not proposed. |
| Before → after | Send a transfer: about 10 → about 7 interactions (header button replaces Stock, search, open, More actions, Move; derived). Rentals, repairs and overdue items: found by opening each unit or person → listed. |
| Roles affected | Warehouse operators, HR and managers (overdue equipment). |
| Data source | `inv_rentals`, `inv_units`, `inv_transfers`, `inv_movements`. |
| Technical scope | Server logic and interface. |
| Business-rule impact | None. Booking conflicts and movement history untouched. Owner decision: whether line managers may request equipment. |
| Acceptance checks | Success: an overdue rental appears on the right warehouse's Today. Failure: each source shows "?" on failure. Permission: people see only rows their location or grant allows. |

### U-30 · Next-actor notices outside Projects

| | |
|---|---|
| ID / priority | `U-30` · LT (nothing is read yet outside Projects; build after the notices inbox in the N part) · Source F-C-18, F-B-16, F-B-07 (assignment part), F-people-hr-21 |
| Verification | Confirmed (code). Re-checked here (via A): `proj_my_notifications` keeps only `type like 'project\_%'` (`20261120000400...:902-918`), so notices of other types have no reader. Others not re-opened. |
| Current behaviour | See sub-table. |
| User problem | The next person learns by visiting. |
| Proposed behaviour | Write notices into the existing `notifications` table once a reader exists (the inbox in the N part, F-A-14): see sub-table. No e-mail unless the owner turns on the Microsoft Graph mail (H question 3). |
| Before → after | See sub-table. |
| Roles affected | Warehouse, PMs, employees, Sales owners, project leads and HR. |
| Data source | `notifications`, `proj_notify` pattern. |
| Technical scope | Migration plus server logic. |
| Business-rule impact | None; recipients and decision rights unchanged. |
| Acceptance checks | Success: notice appears in the inbox once, de-duplicated. Failure: a failed notice write never fails the underlying action. Permission: only intended recipients; actor never notified. |

| Event | Today | Proposed notice | Before → after |
|---|---|---|---|
| Equipment request submitted, dispatched, returned, issued, due soon (F-C-18) | Warehouse reads Today; PM reads the project Equipment page; employee opens My equipment | Warehouse operators of the pickup location; PM; employee | learns by visiting → told on the next My Day or inbox visit |
| Task comment or due date (F-B-16) | `proj_comment_task` inserts only the comment; deadlines are counts | Assignee, PM and earlier commenters on a new comment; "due today" on My Day | 0 notices → 1 per comment |
| Follow-up assigned to someone else, enquiry owner changed (F-B-07 rest) | Assignee sees it on their Follow-ups page and My Day when due | Notice to the new owner or assignee | seen when due → seen when assigned |
| Recovery Leave step waiting (F-people-hr-21) | Nav "Approvals" row appears; no e-mail | Best-effort e-mail like leave, to the project lead or the HR queue | 0 e-mails → 1 |

### U-31 · Client feedback to scope change in one step

| | |
|---|---|
| ID / priority | `U-31` · LT · Source F-B-23 |
| Verification | Confirmed (code). Not re-opened; B P5. |
| Current behaviour | B P5: record feedback (Who gave it, Received on, What was asked, Kind with no default, Relates to, Responsible, Deadline), then separately "Propose a scope change" with the whole scope retyped (prefilled and edited by hand). About 14 interactions for a proposed change. Feedback assigned to a person appears in neither My Work nor My Day. |
| User problem | The same request is entered twice. |
| Proposed behaviour | On a feedback card of kind "Proposed change", a button "Propose scope change from this" prefilling title, link and request text. "Client feedback assigned to me" in My Work and My Day (from `proj_feedback.responsible_user_id`). |
| Before → after | About 14 → about 10 interactions (B). |
| Roles affected | PMs; people responsible for feedback. |
| Data source | `proj_feedback`, `proj_scope_changes`. |
| Technical scope | Interface plus read. |
| Business-rule impact | None; the decision still needs `approve_scope` (see U-01). |
| Acceptance checks | Success: prefilled form saves a scope change linked to the feedback. Failure: refused proposal keeps the text. Permission: only PM, acting PM or founder can propose; the cost effect stays hidden from people without `view_commercial`. |

### U-32 · Start an internal project from an earlier one

| | |
|---|---|
| ID / priority | `U-32` · LT · Source F-B-22 |
| Verification | Confirmed (code). Not re-opened; B searched for Marketing and Operations concepts and templates. |
| Current behaviour | Marketing and Operations run as internal projects created only by `assign_pm` holders or founders; the built-in timeline templates are content-production specific; no task, milestone or team templates and no recurring work. Every repeated project re-enters milestones, deliverables, teams and tasks by hand. |
| User problem | Repeated work starts from nothing. |
| Proposed behaviour | "Start from an earlier project" on `/projects/new`: copies milestones (dates cleared), deliverables, team names and unassigned task titles from a project the person can see; no people or dates copied. |
| Before → after | N items typed by hand (not counted by B) → 1 choice and 1 confirm. |
| Roles affected | Holders of `assign_pm`, founders, PMs of internal projects. |
| Data source | `proj_projects`, `proj_milestones`, `proj_deliverables`, `proj_teams`, `proj_tasks`. |
| Technical scope | Migration (new copy function) and interface. |
| Business-rule impact | None; creation still requires `assign_pm` or founder. Owner question: does Marketing/Operations need more than this (B question 9). |
| Acceptance checks | Success: copy has no dates or people. Failure: a source the person cannot read cannot be chosen. Permission: only creators of internal projects see the option. |

### U-33 · Share non-commercial Sales files and a delivery contact at handover

| | |
|---|---|
| ID / priority | `U-33` · LT (crosses the Sales/Projects confidentiality line; needs a founder decision) · Source F-B-03 |
| Verification | Confirmed (code). Not re-opened; B cites `proj_save_handover` and `proj_accept_handover`. |
| Current behaviour | The handover copies text and technologies only. Sales files (client brief, drawings) and contacts never reach the project; non-commercial files must be re-uploaded (3 clicks and a file picker per file). |
| User problem | The PM lacks the brief PDF and a client contact on site. |
| Proposed behaviour | On the handover form list the enquiry's non-commercial files (purposes other than purchase order, authorised email, proposal) each with a checkbox "Share with delivery"; on acceptance they become project files. An optional "Client contact for delivery" (name, phone) text in the brief. |
| Before → after | Per file: 3 clicks + file picker → 1 checkbox. |
| Roles affected | Sales owner (chooses), PM and members (read what was shared). |
| Data source | `crm_files`, `proj_files`, the existing upload pipeline. |
| Technical scope | Migration plus server logic. |
| Business-rule impact | Touches confidential-data access and the single handover. Only explicit per-file sharing by the owner, commercial files never; the handover rules stay. Owner decision before any work (B question 4). |
| Acceptance checks | Success: a shared file is readable by project members. Failure: if the copy fails the handover is not accepted with a silent gap. Permission: an unshared file is never readable; purchase-order and proposal files cannot be ticked. |

### U-34 · Tag employee claim lines to a project

| | |
|---|---|
| ID / priority | `U-34` · LT (owner decision first) · Source F-E-17 |
| Verification | Confirmed (code). Not re-opened; E cites `reimbursement_claim_lines.project_id` set by no screen and the picker `lib/budget/claims.ts` (own latest 40 claims). |
| Current behaviour | Staff claim, then the PM re-enters the same cost in the project's actuals. The budget "Already in an employee claim" picker lists only the PM's own claims; `pbx_save_actuals_draft` allows the PM to link only their own claim (Finance may link any). |
| User problem | Double entry of the same cost. |
| Proposed behaviour | Optional "Project" select on claim lines (projects the person belongs to); show claims tagged to the project first in the actuals picker. Physical receipt rules are untouched. The benefit depends on who may be linked (own claims only for a PM), so the owner decides first (E question 4). |
| Before → after | Per claim-covered line: about 4 entries in the actuals (amount, how paid, who paid, claim; derived from E P9) → about 2 (choose the claim, amount and payer prefilled; an estimate) once the owner decides. |
| Roles affected | Employees claiming, PMs, Finance. |
| Data source | `reimbursement_claim_lines.project_id`, existing claim reads. |
| Technical scope | Interface plus read filter. |
| Business-rule impact | None to receipts or approvals. |
| Acceptance checks | Success: tagged claims appear first. Failure: claim lookup failure shows an error. Permission: a PM sees only claims the existing rules allow them to link. |

### U-35 · Clock-in: pick the project from Projects, one label set

| | |
|---|---|
| ID / priority | `U-35` · LT (attendance is a protected area; input only) · Source F-people-hr-20 |
| Verification | Confirmed (code). Not re-opened; F cites `clock-controls.tsx:134-156`. |
| Current behaviour | Clock-in asks work mode (required), a free-text "Project or installation name" (required for Site work) and a project lead. HR's register uses a different set of work-mode labels. Typed names cannot be matched to Projects and typos split evidence screens. |
| User problem | Re-typing a project name that the system knows. |
| Proposed behaviour | Pick the project from the person's own projects with "Other" as free text; show one label set. Do not change how the lead drives routing or any Recovery Leave rule; the lead on the chosen project fills the lead field only if the owner confirms it is the same person HR routing already uses. |
| Before → after | 3 selections (mode, typed name, lead) → 2 (mode, project pick that fills the lead). |
| Roles affected | All staff who clock in. |
| Data source | `proj_projects` the person belongs to. |
| Technical scope | Interface only. |
| Business-rule impact | None to calculations or routing. Owner confirms because attendance is protected. The lead-picker defect for ordinary employees is in Section 3.1 (F-A-07, F-people-hr-04). |
| Acceptance checks | Success: choosing a project fills the name. Failure: a failed project read leaves "Other" usable. Permission: only the person's own projects are listed. |

### U-36 · Payroll, letters, performance: company selector and an honest message

| | |
|---|---|
| ID / priority | `U-36` · LT (check first whether anyone holds such roles) · Source F-people-hr-16 |
| Verification | Confirmed (code). Not re-opened; F cites `payroll/page.tsx:30-39`, `letters/page.tsx:28-34`, `performance/page.tsx:46`. |
| Current behaviour | These pages derive one company from the viewer's own employee record. A role-holder in two companies sees only their employer company; a role-holder with no employee record sees "Payroll export is restricted to HR Admin, Finance, CEO, and CTO." although they hold the role. |
| User problem | Multi-company HR cannot reach the other company's runs; the message names the wrong cause. |
| Proposed behaviour | A company selector (like `/attendance`'s manageable companies) and a message that states the cause ("no employee record linked"). |
| Before → after | Companies reachable for a two-company HR role-holder: 1 → 2 with 1 selection; wrong "restricted" message → accurate cause. |
| Roles affected | HR Admin, Finance, CEO/CTO in more than one company. |
| Data source | Existing role grants and company list. |
| Technical scope | Interface only. |
| Business-rule impact | None; RLS already scopes. |
| Acceptance checks | Success: selector lists only companies the role covers. Failure: a failed read is not reported as "restricted". Permission: a company outside the role never appears. |

### U-37 · Alerts page: plain health line, engineering text to a technical view

| | |
|---|---|
| ID / priority | `U-37` · LT · Source F-people-hr-17 |
| Verification | Confirmed (code). Not re-opened; F cites `alerts/page.tsx:127-160`. |
| Current behaviour | HR, CEO and CTO see a Recovery Leave scheduler banner with "Database fingerprint ... compare it with the value the verification SQL prints in the Supabase project you expect", "unrouted request(s)" and "scheduler must stay enabled until all are 0". Only HR Admin and Sys Admin can read the status. |
| User problem | Technical text for non-technical readers. |
| Proposed behaviour | One-line state to HR ("Recovery Leave processing: running / needs attention (N unrouted)"); the fingerprint and wording move to a technical or owner view for the Sys Admin. |
| Before → after | About 4 technical lines on the main alerts page → 1 plain line. |
| Roles affected | HR Admin, Sys Admin, CEO/CTO. |
| Data source | Existing scheduler status function. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | Success: HR sees one line. Failure: a failed status read says so rather than "running". Permission: the fingerprint is shown only to the Sys Admin. |

### U-38 · Small interface corrections

| | |
|---|---|
| ID / priority | `U-38` · LT (each is small; grouped so they can be done together) · Source F-E-21, F-G-20, F-G-15, F-H-17, F-H-20, F-H-19 |
| Verification | Confirmed (code). Not re-opened; citations are the investigators'. |
| Current behaviour | See the sub-table. |
| User problem | Small frictions that cost retries or look unfinished. |
| Proposed behaviour | See the sub-table. |
| Before → after | See the sub-table. |
| Roles affected | Varies per row. |
| Data source | Existing records. |
| Technical scope | Interface only, except the sign-in wording (server check after the sign-in error). |
| Business-rule impact | None. |
| Acceptance checks | Each row: success (new behaviour present), failure (error handled, not blanked), permission (unchanged). Sign-in wording: the "suspended" message shows only after a correct password, so account existence is not revealed. |

| Item | Current | Proposed | Before → after |
|---|---|---|---|
| Decimals in the budget editor (F-E-21) | `cleanDecimal` allows any number of decimals (`shared.tsx:105-109`); the database refuses more than 3 (4 for rates, the currency's own for amounts) after the click | Cap typing per field | refused after submit → impossible to type |
| Browser dialogs (F-G-20) | Deactivate and Reactivate reasons use `window.prompt`, delete and revoke use `window.confirm` (`account-status-controls.tsx:76-103`) | Use the existing Modal and an in-page reason field | 0 styled, accessible dialogs → all |
| Deactivated sign-in wording (F-G-15) | "That email/password combination wasn't recognized." (`auth.ts:30`) | After a failed sign-in, if the password was correct and the account is Deactivated: "This account is suspended. Contact your administrator." | wrong message → accurate, without account probing |
| Session expiry mid-form (F-H-17) | Typed work lost when the session expires; no unsaved guard on Projects and HR forms | Extend `useUnsavedChanges` to task, plan, milestone, leave, claim and attendance forms; optional per-form draft restored after sign-in | guard on 0 of these forms → all |
| HR tables on phone (F-H-20) | Attendance register (10 columns), bulk attendance, timesheet detail, Inventory setup tables scroll sideways (Approve/Reject height is in U-08) | Stacked rows with labels on phone | sideways scroll → none |
| My Day first paint (F-H-19) | About 10 sequential awaits, no Suspense; weather awaited in line (3 s abort) | Render hero and decisions first, stream each card with its own load-error fallback, weather loaded in the client | one slow card delays all → cards appear as they load |

---

### Source conflicts noted and how they were handled

| Topic | Conflict | Handling |
|---|---|---|
| Inventory nav gate for acting PMs and team heads | C labelled it `[USABILITY]` (F-C-19), G labelled it `[DEFECT]` (F-G-05) | Treated as a defect (Section 3.1). Only the Counts menu entry and the line-manager question are kept here (U-29). |
| My Day "shows counts, never my work" | A rated LB; the path works in 2 clicks | Registered LI (U-02); the silent-stall element is covered by U-01 and the N part. |
| Decision requests that reach no one | B rated improvement | Registered LB (U-01) on the rubric's wording; flagged for the owner. |
| Blocker path length | A counts 3 screens from My Day; B counts 4 clicks and 1 screen from My Work | Both agree: the task panel is the same URL; B's count is used with the starting point stated (U-11). |
| Payload JSON line numbers | A `:218-224`, F `:199-206` | Code is at `policies/[id]/page.tsx:201-204`. |
| Leave refusal sentence line | H `leave.ts:157-159` | Code is at `leave.ts:166-168`. |
| Invite note line | G `invite-user-form.tsx:155` | Code is at `:32`. |
| "Reserve all" | C proposes one function in a transaction; the simplification doc says an app-layer loop is not atomic | U-24 lays out A/B/C honestly and flags it for owner and engineer. |
| Receive-back "about 6" interactions | C's after-count assumes a global tick-all | Not reproducible with the safe design; U-23 counts 16 (helper only) or about 10 (with per-item tick-all). |

### Items not registered and why

| Source | Reason it is not a `U-` entry |
|---|---|
| All `[DEFECT]` findings (F-A-01 to -12, -20; F-B-01, -04, -05, -09, -10, -11, -15, -20, -21; F-C-01 to -14; F-E-01 to -03, -08 to -10, -15, -16, -18; F-people-hr-01 to -06, -09 to -12, -14, -23, -25; F-G-01, -03 to -06, -12, -13, -16; F-H-01 to -11, -16, -18) | Section 3.1 (`D-nn`). Where a usability entry depends on one, the entry names it. |
| `[NEW]` findings (F-A-14, -15, -18; F-B-08, -14; F-C-21; F-E-19, -20; F-G-10, -11, -18, -21; F-H-15; F-people-hr-18; the copy-lines half of F-E-12) | Section 3.3 (`N-nn`). U-02, U-13 and U-30 depend on the notices inbox (F-A-14); U-19 depends on departments (F-G-10). |
| F-A-22 (ordinary staff cannot look up a colleague by name) | Confidential-data access boundary: `employees` RLS shows own row and reports. Owner decision (A question 3). The clock project-lead list is a defect (F-A-07). |
| F-G-17 option (b), a new read-only "see all project details" right | Model change that widens confidential project access; owner decision (G question 2). Option (a) is inside U-20. |
| F-people-hr-15 (Timesheets have no link, approvals still list them) | Owner decision to retire or link (F question 8). Noted in U-03; no proposal until decided. |
| F-people-hr-19 (failed scheduled run invisible to staff) | Reliability: covered by the D entry for F-H-02. |
| F-people-hr-13 acknowledgement of policies | New functionality (N part); the readable policy page is U-22. |
| F-people-hr-24 (Sys Admin reads every employee of every company) | Company-boundary question; reported by F, not a usability change. |
| F-E-07 reassignment, delegation or escalation | Changes who may approve; owner decision. Only the visibility half is registered (U-07). |
| F-E-02, F-A-12 (queue approvals not counted) | Defects; U-06 and U-07 reuse the same helper. |
| F-C-19 line managers requesting equipment | Changes who may request; owner decision (U-29 notes it). |
| F-B-21 (CRM organisations and contacts not company-scoped) | Company-boundary risk; reported only. |
| F-H-12 (labelled usability by H) | Its content is a defect (currency silently defaults to AED when the company read fails; claim line numbering and add-line not idempotent). Section 3.1 owns it (see also F-E-16); U-17 only cross-refers. |
| F-A-17 (nothing role-shaped for warehouse) | The warehouse part is met by Today (U-25, U-29); the manager and Finance parts are U-09 and U-06. |
| F-people-hr-26 (AI features description) | Fact, not a change. |
| F-D-01 to F-D-11 (dispatch and return feasibility) | Facts for a design, not usability findings. |



## 3.3 New functionality (`N-nn`)

Scope of this part: things that do not exist today (searched in code, not assumed). Defects are `D-nn` and usability changes are `U-nn` in Parts 1 and 2; this part cross-references them but does not repeat them. Code is at `/home/user/hr-engine`, commit `76c121b`. Nothing here was run against a hosted system.

Abbreviations for migration files (all under `supabase/migrations/`): `PRJ2` = `20261120000200_proj_projects_handover_functions.sql`, `PRJ4` = `20261120000400_proj_plans_site_calendar_discussion.sql`, `PRJ5` = `20261120000500_proj_feedback_plans_files_completion.sql`, `PRJ3` = `20261120000300_proj_delivery_functions.sql`, `PBX2` = `20261210000200_pbx_budget_functions.sql`, `PBX3` = `20261210000300_pbx_funding_actuals_settlement.sql`, `PBX4` = `20261210000400_pbx_views.sql`, `INV0` = `20261201000000_inv_access_audit_settings.sql`, `INV1` = `20261201000100_inv_catalogue_stock_ledger.sql`, `INV3` = `20261201000300_inv_stock_functions.sql`, `INV8` = `20261201000800_inv_project_equipment_unlinked.sql`. `W/` = `apps/web/src/`.

### 1. Honest reading of this part

1. **No N entry is a Launch blocker (LB).** Under the rubric, the launch-blocking items in this area are the places where a required handoff is invisible to the next actor. Those are already defects, registered in Section 3.1 (for example Finance/CEO never shown a budget waiting: `F-E-01`/`F-A-10`; handover clarification with no screen for a Sales owner: `F-B-04`; a won enquiry nobody is told about: `F-B-01`). Each has a small fix that does not need anything in this part. The N entries generalise those fixes; they must not delay them.
2. Of 23 registered entries: 12 are LI (launch improvement), 11 are LT (later), of which 4 are mainly owner decisions (N-18 claim project tags, N-20 policy acknowledgement, N-22 read-only grants, N-23 contingency/VAT). Several LI items are LI only for part of their scope; each entry says which slice.
3. The two features specified in the owner's brief (dispatch note with PM acknowledgement, return checklist with PM confirmation) are N-03 and N-04, both LI. Reason: today custody and stock are already recorded correctly in the ledger (`inv_movements`, append-only), so the features close an information handoff to the PM; they do not stop a loss of money or custody. Their detail is in Section 6 of the specification; this part gives register fields only.
4. The app has no language model today (Section 5). Nothing in this register depends on one.

### 2. Summary table

| ID | Title | Priority | Needs migration? | Owner decision? | Prerequisite entries (in this part) | Source |
|---|---|---|---|---|---|---|
| N-01 | In-app notices inbox with unread count (bell, list, My Day block) | LI (slice 1 interface only; slice 2 needs migration) | Slice 2 only | Yes: which events notify (table inside entry) | none | F-A-14, F-A-09, F-A-10, F-B-04, F-B-06, F-B-07, F-C-18, F-D-06, F-H-16 |
| N-02 | One "Needs me" list that reads existing source records | LI | No (first version); one small read function for PM-side budget rows | Yes: which sources, ageing thresholds | none (shares loaders with Section 3.1 fixes F-A-12, F-E-01, F-E-02) | F-E-04, F-B-06, F-A-13, F-E-22, F-A-17 |
| N-03 | Dispatch note (numbered PDF) with PM acknowledgement | LI | Yes | Yes (Section 6 questions) | N-01 (awareness), N-02 (PM row) | F-D-01 to F-D-11 |
| N-04 | Return checklist with PM confirmation | LI | Yes | Yes (Section 6 questions) | N-03 (shared plumbing), N-05, N-06; Section 3.1 fix F-C-03 first | F-D-10, F-D-11, F-C-03, F-C-16 |
| N-05 | Kit contents check on return | LI | No | No | Section 3.1 fix F-C-03 first | F-C-21 |
| N-06 | Held-unit follow-up (Today source, request flag, notice) | LI | No (Today source); notice part needs N-01 | No | notice part: N-01 | F-C-11, F-C-17, F-C-18 |
| N-07 | Record search from the command palette | LI (own-RLS modules); LT (colleague directory for ordinary staff) | No; yes only if a staff directory is allowed | Yes: staff directory | none | F-A-18, F-A-22, F-A-07, F-B (section 8) |
| N-08 | CEO/CTO "needs attention" list from existing data | LI (lines 1 to 3); LT (other lines) | No | Yes: thresholds, and how much a CEO may see (N-22) | N-02 loaders; Section 3.1 fixes F-H-02 (job lines), F-people-hr-11 (discrepancy line) | F-A-15, F-G-21 |
| N-09 | Project file "current reference" marker and Site and references card | LI | Yes | Yes: who declares "approved" | none | F-B-14, F-B-15 |
| N-10 | Departments screen (create, rename, archive) | LI (hosted check first) | No | No | none | F-G-10 |
| N-11 | Duplicate a budget line | LI | No | No | none | F-E-12 |
| N-12 | Invite confirmation and configuration health strip | LI | No | No | none | F-H-15 |
| N-13 | Other Today sources: rentals due, repairs due, no return date, overdue employee equipment | LT | No | No | N-06 pattern | F-C-17 |
| N-14 | Onboarding checklist screen | LT | No (seed data only) | Yes: whether launch needs it | N-10 helps | F-G-11, F-G-08 |
| N-15 | Scope-change "what this touches" link list | LT | No | No | none | F-B-08 |
| N-16 | Project budget print view and company CSV | LT | No (list function optional) | Yes: print or PDF | none | F-E-19 |
| N-17 | Copy lines from an earlier project budget | LT | Yes (one function) | No | N-11 | F-E-12 |
| N-18 | Tag employee claim lines to a project | LT (owner decision) | No | Yes | none | F-E-17 |
| N-19 | Read-only "effective access" summary for access managers | LT | Yes (one read function) | No | none | F-G-18 |
| N-20 | Readable policy page and policy acknowledgement | LT (owner decision) | Yes if acknowledgement | Yes | none | F-people-hr-13 |
| N-21 | HR screens that do not exist (leave-balance adjustment, workflows, others) | LT (adjustment screen LI if HR uses SQL today) | No | Yes for workflows | none | F-people-hr-18 |
| N-22 | Read-only visibility for CEO/CTO/Operations (OWNER DECISION, permission-model change) | Decision first; no work scheduled | Yes if capability option chosen | YES | none | F-G-17, F-A-15 Q1 |
| N-23 | Contingency and VAT on project budgets (OWNER DECISION) | LT | Not decided | YES | none | F-E-20 |

An "assistant" later enhancement is described in Section 5 (not an N entry because nothing may depend on it).

### 3. Prerequisites and dependants

Read left to right: the item on the right needs the item on the left to exist first.

| Foundation | Needed by | Why |
|---|---|---|
| Section 3.1: `getCurrentSession` returns a load-failure flag (F-A-01/F-H-04); every new "waiting" count uses the `LoadError` pattern (F-A-02, F-A-04, F-D-06 note) | N-01, N-02, N-08, N-13 | A new inbox built like today's `loadProjectsAttention` (`W/lib/projects/my-work.ts:104-106`, `catch { return empty }`) would show "nothing waiting" during an outage |
| Section 3.1: one shared approvals eligibility function (F-A-12/F-E-02: person-assigned plus queue rows) | N-02 rows 1 and 2, N-08 line 1 | Otherwise the new list disagrees with `/approvals` |
| Section 3.1: Finance/CEO budget row (F-E-01) | N-02 row 4, N-08 line 3 | Same loader (`pbx_inbox`), built once |
| **N-01** (general notices reader) | N-03, N-04 (awareness only), N-06 notice, "Request access" buttons in Section 3.2 (F-G-14, F-B-12), leave/claim outcome notices | They all write a row into `notifications` and need somewhere that shows it |
| **N-02** (Needs me) | N-03, N-04, N-08 | A dispatch note waiting for the PM is an obligation, so it is a row in the list, not only a notice |
| Section 3.1: F-C-03 (two return screens with opposite safety; "fair" wording) | N-04, N-05 | A return checklist must sit on one consistent condition rule |
| N-03 (snapshot table, PM-readable function, numbering, PDF) | N-04 | N-04 reuses all four |
| N-05, N-06 | N-04 | A kit returned incomplete, or a unit returned damaged, must produce a visible follow-up, not a unit that silently becomes available or silently held |
| Section 3.1: `job_runs` table (F-H-02) | N-08 "failed or missed jobs" line | Without it there is no source |
| Section 3.1: AI-draft company scoping (F-people-hr-11) | N-08 "balance discrepancy" line | `ai_drafts` is readable by any-scope HR Admin across companies today |
| Owner decision N-22 | How much of N-08 a CEO/CTO sees | The list only shows what the viewer's own grants already allow |

Three sequencing rules that follow: (a) the Section 3.1 fixes ship first, as small fixes, not behind N-01/N-02; (b) N-01 slice 1 and N-02 can ship independently of each other; (c) N-03 must not ship before N-02 has a PM row source, otherwise the acknowledgement is a notice (which can be silently dropped; see N-03).

---

### 4. Entries

#### N-01 In-app notices inbox with unread count

| Field | Detail |
|---|---|
| ID / priority | `N-01` · LI. Reason: today's information gaps that stall work are already in Section 3.1 as targeted fixes; the inbox is the general channel, valuable daily, not required for any single fix. |
| Verification | Confirmed (code): table `notifications(id, user_id, type, payload, read_at, created_at)`, index `(user_id, read_at)`, RLS own-row select and update (`phase5` migration, per F-D-06). Only reader in the app: `proj_my_notifications`, called once at `W/app/(app)/projects/work/page.tsx:88`; only mark-read call `W/lib/actions/projectsDiscussion.ts:72`. Only writers: `proj_notify` (`PRJ2:77-101`), `pbx_notify` (`PBX2:53-70`), the document-expiry cron (`W/app/api/cron/document-expiry/route.ts:114`). No Inventory or CRM function writes one (grep `notify|notifications` in `INV*` and `crm_*` migrations: none). Hosted state unverified (row counts). |
| Current behaviour | No bell, count or inbox anywhere in the shell; the only bell icon is the HR-only link to `/alerts` with no count, hidden below `lg` (`W/components/nav/shell-chrome.tsx:84-88`). Notices appear only in the "Project notices" panel at the bottom of `/projects/work` (`:163-186`), which needs a Projects grant. `proj_my_notifications` keeps only `type like 'project\_%'` and drops any notice whose `project_id` is not one the viewer participates in (`PRJ4:902-918`, `proj_user_is_participant` `:736-748`: active member or Projects founder). Text comes from `describeNotification` (`W/lib/projects/notification-text.ts`, 25 cases; unknown type reads "A project update."). **Extra fact verified here:** `proj_accept_handover` writes `project_handover_accepted` to the Sales owner and preparer with the new project's id (`PRJ2:415-418`); a Sales owner is a Sales-linked person, not a member, so the reader drops that notice even if they were given a Projects grant. Clarification notices carry no project id (`PRJ2:330-336`) so they pass the filter but sit behind a page that says "no tasks for you" without a Projects grant (`W/app/(app)/projects/work/page.tsx:50-56`). |
| User problem | Sales owner never learns the PM asked a question or accepted; Finance and CEO/CTO approvers never see "budget submitted" (written by `pbx_notify` at `PBX2:418`, hidden by the participant filter); a PM sees a blocker only if they open My Work and scroll; document-expiry notices are written and never shown (F-A-09); leave/claim outcomes have no in-app notice, only (best-effort) email for leave. |
| Proposed behaviour | **Slice 1 (interface only, no migration):** bell button in the header (left of the theme toggle, visible on phone, unlike the HR alerts link) showing unread count ("9+" cap) and, on click, a panel of the latest 10 notices from the existing `proj_my_notifications(p_limit, p_only_unread)` with a "Mark all read" button (existing `proj_mark_notifications_read`) and a link "See all notices" to `/projects/work`. Also a "New for you" block at the top of My Day (same rows, 5 max). Row = icon, `describeNotification` sentence, project/reference, relative time, unread dot; the row links to the target. Count read failure shows "?" and "Could not load notices", never 0. **Slice 2 (migration):** a general reader `notice_inbox(p_limit, p_only_unread)` (new SECURITY DEFINER function, own user only) that shows all types addressed to the viewer, each type with its own visibility rule: project task/discussion types keep the participant test; handover types are shown to the named recipient (the writer already chose them); budget types are shown to a recipient who still has a `pbx_company_grants` row for that company or is the project PM; unknown types are not shown (fail closed). Add `mark_notice_read(id)`. Extend `describeNotification` with the new types below. A separate page `/notices` (list of last 100, filter Unread/All) replaces "Project notices" at the bottom of My Work (panel kept as a link). Notices are information with a read flag; they never carry an obligation (see rule below). |
| Before → after | Finding one notice: My Day → Projects & Tasks → My Work → scroll = 4 actions across 3 screens → 1 click (bell). For a Sales-only or Finance-only person: not possible at all (0 screens show it) → 1 click (slice 2). |
| Roles affected | Everyone signed in (bell). Newly able to see their notices: Sales owners and preparers (handover), Finance and CEO/CTO budget approvers (budget), HR admins and employees (document expiring), warehouse/PM (N-03, N-04, N-06). A person with several responsibilities (PM + Finance + Sales) has one bell; a row is per notification, so a PM who is also the Finance approver of the same budget gets one row (dedupe is per user, type and key). |
| Data source | `notifications`; `proj_my_notifications`, `proj_mark_notifications_read`, `proj_notify`, `pbx_notify`; `describeNotification`. |
| Technical scope | Slice 1: interface only. Slice 2: migration (new reader and mark-read functions, `grant execute ... to authenticated`, revoke from public), server logic (new writers calling `proj_notify`-style insert), interface. Index `(user_id, read_at)` already exists. No new table. |
| Business-rule impact | None: recipients of existing events are unchanged. New events (table below) change who is told, not who decides. |
| Acceptance checks | (1) After an assignee blocks a task, the PM sees the notice and count 1; after "Mark all read" count 0; the actor never gets one (`proj_notify` skips `auth.uid()`). (2) With the notices read forced to fail the bell shows "?" and the panel says "Could not load notices", not "No notices". (3) A Finance person with no Projects grant sees "project_budget_submitted" (slice 2); a person with no `pbx` grant for that company does not (permission). (4) A person whose project membership was removed no longer sees that project's task notices (existing deletion at `proj_remove_member`, `proj_revoke_access`; filter retained). (5) Sales owner sees "PM accepted your handover" (slice 2). (6) A user can read and mark only their own rows (RLS test in `packages/rls-tests`). |

**Event scope: which events must notify (decision table).** "Written today" = a row is inserted today. "Seen today" = a screen the recipient can reach shows it.

| Event | Recipient | Written today | Seen today | Decision for this entry |
|---|---|---|---|---|
| Handover submitted / assigned / resubmitted | `assign_pm` holders, named PM | Yes (`PRJ2:274-305`) | Only on `/projects/work` for Projects people | Seen via slice 1; no change to writers |
| Handover clarification requested | Sales owner and preparer | Yes, no project id (`PRJ2:330-336`) | No (needs Projects grant for the page) | Slice 2; also a "Needs me" row (N-02) because it is an obligation |
| Handover accepted | Sales owner and preparer | Yes, with project id (`PRJ2:415-418`) | **No: reader drops it for non-participants** | Slice 2 reader change |
| Scope-change proposed | `approve_scope` holders and founders | **No** (F-B-07; `proj_propose_scope_change` `PRJ5:476-506`) | n/a | New type `project_scope_proposed` in slice 2, plus an N-02 row (obligation) |
| Scope-change decided | PM | Yes (`PRJ5:583`) | Participants only | Seen via slice 1 |
| Commercial approval requested (Sales) | Sales founders | **No** (CRM writes no notice; F-B-07) | n/a | Do NOT add a notice at launch: show it as an N-02 row from `crm_approvals` (no write) |
| Leave/claim/timesheet/letter/payroll approval waiting | Next approver | No (leave sends email only) | `/approvals` page and count | Do NOT write notices; the Approvals count and N-02 already carry this. Double reporting would create two counts for one obligation |
| Leave/claim/letter **decided** | Requester | No (leave: email, best effort; others none) | Requester opens the item | LT. Writing it inside `decide_leave_approval` touches the approvals engine (protected). If wanted, write from the server action after a successful decision, not inside the function. Owner decision |
| Budget / final expenses submitted | Finance and executive approvers | Yes (`PBX2:418`, `PBX3:536`) | **No for non-participants** | Slice 2 reader change |
| Budget / actuals decided; funding recorded; settlement closed | Submitter, PM | Yes | Participants only | Seen via slice 1 |
| Receipts recorded, payment recorded | PM | **No** (`pbx_record_receipts`, `pbx_record_payment` write none; E section 5) | n/a | LT, add two types |
| Blocker reported | Named unblocker or PM | Yes (`PRJ3:679`) | Participants only | Seen via slice 1. Department head not told (Section 3.2 F-B-17) |
| Dispatch recorded | PM | **No** | n/a | N-03 (durable record), notice for awareness |
| Return recorded / checklist waiting | PM | **No** | n/a | N-04 |
| Transfer sent to another warehouse | Destination warehouse | No | Inventory Today "Incoming transfers" source already lists it | No notice needed at launch (Today covers it) |
| Unit held while reserved for a later request | Owner/PM of that request, warehouse | **No** | n/a | N-06 |
| Equipment overdue | Holder, HR (`view_employee_custody`), PM | No | Badges on My equipment, With people, project Equipment tab | No notice and no new job at launch: computed rows in N-02/N-08 instead. A scheduled notice job would hit the same cron defect (F-H-01) and plan limits (F-H open question 4) |
| Document expiring | Employee, HR admins | Yes (cron) but the cron is redirected by the proxy (F-H-01) | **No screen reads it** | Seen in slice 2; depends on the cron fix in Section 3.1 |
| Access requested ("Request access" button) | Access managers, founders | n/a (button does not exist; Section 3.2 F-G-14, F-B-12) | n/a | Those entries write a new type into this inbox; no right is given |

**Rules for this entry:** a notice is never the only record of an obligation (notices are deleted on member removal and silently dropped when the recipient is not an active eligible member: `PRJ2:798, 965-967`, `proj_notify` `:86-94`); keep dedupe while unread; never notify the actor; no email is added; no service-role client is used to read notices.

---

#### N-02 One "Needs me" list that reads existing source records

| Field | Detail |
|---|---|
| ID / priority | `N-02` · LI. Reason: removes the "visit 5 to 7 places to find out what waits" problem for approvers and PMs; the worst invisible handoffs are fixed separately in Section 3.1. |
| Verification | Confirmed (code). Searched: `needs me`, `needs you`, `inbox`, `pending_action`, `action-centre`. Existing aggregator: `buildActionItems`/`DecisionsCard` take `extraItems` already scoped by the caller (`W/app/(app)/action-centre.tsx:14-52`); My Day "Projects" rows exist (`W/lib/projects/my-day.ts:15-21`); `/approvals` and `/finance/project-budgets` are separate inboxes. No page lists records from more than one of these. |
| Current behaviour | A CEO with all grants checks up to 7 entry points: My Day counts, `/approvals`, `/finance/project-budgets`, `/projects/work` (reviews, notices), `/projects/handovers`, `/projects/<id>/changes` per project (scope proposals), Sales Follow-ups, Inventory Today. My Day counts only `approver_id = me` approvals, not queue rows (F-A-12), shows no budget row (F-E-01), no waiting time (F-E-06). |
| User problem | Approvers and PMs cannot tell "nothing waits" from "I did not look in the right place"; a Finance person sees rows they cannot act on beside those they can (F-E-22). |
| Proposed behaviour | A page `/needs-me` (link from the My Day hero and a nav entry shown only when at least one source has rows, like Approvals today) listing one row per waiting record, grouped by source with the source name as heading, oldest first inside a group. Row shape: `{ source, kind, title, who or project, waiting since, amount only if the source already shows it to this person, href, state }`. Each row links to the existing decision screen; **no decision happens in the list** (no Approve button, no bulk action). My Day shows the total and the top 5 rows. Each source loads independently with `Promise.allSettled`; a failed source shows "Could not load <source>. This is not an empty list." and keeps its link; a source the person has no access to is not shown at all and is named in a footer "Not included for you: ...". Counts shown per source, never one merged number alone. |
| Before → after | CEO with every grant: up to 7 screens → 1 list page plus the click into the item. Finance person: remember to open the inbox (0 prompts today) → 1 row on My Day and 1 click. |
| Roles affected | All approvers and decision holders; a person with several responsibilities sees all their sources in one list. A source never appears twice: a budget the viewer decides as executive approver and also authored is excluded by the source's own flag (`pbx_can_decide`). |
| Data source | See source table below (every source already exists and is already permission-filtered). |
| Technical scope | Server logic (read-only aggregator reusing existing loaders) and interface. Migration: none for the first version. One optional small read function for the PM-side budget rows ("returned for changes", "final expenses returned"), which today exist only as notices (E reuse map). |
| Business-rule impact | None. No approval moves; independent approvals stay independent (list below). |
| Acceptance checks | (1) Finance with no Projects grant sees the count of budget decisions they can decide, not self-authored, not other company, not on hold. (2) A user with no grant for a source sees no row and no error for it. (3) With one source forced to fail, that source shows the "Could not load" line and the others still render; the page never says "Nothing waiting" while any source failed. (4) A requester never sees their own queue-routed Recovery request (existing `queueDecisionEligible` rule). (5) Approving in the destination screen removes the row on next load; the list itself writes nothing. (6) HR with only queue-routed Recovery items sees them (fixes today's count of 0). |

**Source-by-source reuse table** (each source keeps its own function, filter and decision screen):

| # | Needs me because | Existing read | Permission filter it already applies | Row link | Not changed |
|---|---|---|---|---|---|
| 1 | Leave, claim, timesheet, letter, payroll-run decision assigned to me | `approvals` where `decision='pending'` and `approver_id = me` (`W/app/(app)/approvals/page.tsx:33-38`) | RLS `approvals_select` (latest `20261106000000:1909`: `approver_id = auth.uid()`, `has_role('hr_admin')`, entity owner, queue branch); `decide_leave_approval` re-checks | `/approvals` or `/reimbursements/[id]` | Workflow routing, `resolve_approver`, self-approval refusal |
| 2 | Recovery Leave credit in the role queue | same table, `approver_id is null`, narrowed by `queueDecisionEligible` (`approvals/page.tsx:314-323`) | Role in the beneficiary's company, beneficiary excluded in the database | `/approvals` | Recovery Leave rules |
| 3 | Leave decisions | = rows 1 and 2 (`entity_type='leave_request'`) | same | `/approvals` | Leave balance calculation |
| 4 | Budget, final expenses, settlement step | `pbx_inbox()` flags `i_can_decide`, `on_hold`, `i_can_close`, `i_can_confirm_receipts` (`PBX4:190-267`) | `pbx_accessible_company_ids()`, per-row route and independence flags | `/finance/project-budgets/[projectId]?section=...` | `pbx_approval_route`, hold rule |
| 5 | PM: budget or final expenses returned, ready for actuals | none today (notices only) | `proj_is_pm` on own `pbx_budget_versions` / `pbx_actual_submissions` with status returned | `/projects/[id]/budget?section=...` | n/a |
| 6 | Task review waiting | `loadMyWork(ctx).reviews` (`W/lib/projects/my-work.ts`) | PM, temporary leader, founder, department head; never own work | `/projects/work?show=review` (Section 3.1 F-B-10 fixes the link) | Independent review rule |
| 7 | Handover to assign or accept | `proj_handovers` status submitted or pm_assigned via `handoverWaitsOnMe` (`my-work.ts:91,100`) | `assign_pm` capability or assigned PM | `/projects/handovers` | Single handover process |
| 8 | Handover clarification asked of me (Sales) | `proj_handover_for_opportunity` | CRM grantees; owner and preparer | the enquiry's handover page | n/a |
| 9 | Won enquiry with no handover submitted | `crm_opportunities.stage='won'` left join `proj_handovers` (Section 3.1 F-B-01) | CRM RLS; owner or Sales founder | the enquiry | Single handover |
| 10 | Scope change awaiting my decision | `proj_scope_changes.status='proposed'` | `approve_scope` holders and founders | `/projects/<id>/changes` | Approval authority |
| 11 | Client feedback assigned to me or overdue | `proj_feedback.responsible_user_id`, `status`, `due_date` | project membership via RLS | `/projects/<id>/changes` | n/a |
| 12 | Task assigned, due, overdue, blocked on me | `proj_tasks` via `loadWorkRows` | membership RLS | `/projects/work?task=` | n/a |
| 13 | Sales follow-up due/overdue, no next action, hold review | `crm_follow_ups`, `attentionItems` (`W/lib/crm/reports.ts:299-344`) | CRM RLS | Sales Follow-ups | n/a |
| 14 | Commercial approval waiting | `crm_approvals.state='pending'` (`20261115000100:293-305`) | CRM RLS; Sales decision rights to be confirmed in code before launch (E flagged "to confirm") | the enquiry's Commercial tab | Approval route |
| 15 | Warehouse: equipment requests to prepare/send/receive; Sales availability checks waiting | Inventory Today sources `requests`, `returns`, `transfers`, `sales` (`W/lib/inventory/today.ts:15-20`), `inv_pending_sales_checks` | `inv_loc()` location and capability | Inventory Today | Booking conflicts, ledger |
| 16 | PM: dispatch note to acknowledge; return to confirm | new records from N-03 and N-04 | `proj_can_manage` at the time of the click | the note | n/a |
| 17 | Unread discussion, mentions | `proj_unread_counts`, `proj_message_mentions` | participants | project Discussion | n/a |

**What is not combined (independent approvals stay independent):**
1. Budget decisions are never turned into `approvals` rows, and nothing is added to the `approvable_entity` enum (irreversible; `ALTER TYPE ... ADD VALUE`). D already showed what breaks: a new type is counted by the nav and My Day and renders nowhere (`approvals/page.tsx:42-79`).
2. No "approve all" across sources, no bulk approve; every decision is made one at a time on its own screen through its own function.
3. A dispatch acknowledgement (N-03) or return confirmation (N-04) is not an approval and is not stored in `approvals`; it appears in the list as its own source.
4. HR attention items (contracts ending, probation, documents expiring) are alerts, not decisions; they stay on `/alerts` and the HR block of My Day.
5. The list stores nothing: no persisted queue table, no task copy, no "done" flag. A row exists only while its source record is in the waiting state.
6. Notices (N-01) are not rows in this list.

---

#### N-03 Dispatch note (numbered PDF) with PM acknowledgement

Full specification: Section 6. Register fields only; facts are from findings D (F-D-01 to F-D-11) and C.

| Field | Detail |
|---|---|
| ID / priority | `N-03` · LI (owner-specified). Reason: closes an information handoff to the PM; the ledger already records custody correctly, so no money or custody is at risk without it. |
| Verification | Confirmed (code): no dispatch note, delivery note, goods-issue or numbered document exists (search terms: dispatch note, delivery note, packing list, goods issue, dispatch_note; only mention is `docs/inventory-simplification.md:66`). A PM cannot read any movement row (`inv_movements`/`inv_movement_lines` RLS = `inv_can_view_stock`, `INV1:446-452, 505-509`). `exception_note` is never written on dispatch (`INV3:1911-1912`). |
| Current behaviour | Warehouse records the dispatch in one RPC `inv_dispatch_to_project` (`INV3:1860`); result gives `movement_id` and `code` (e.g. `UAE-M-00017`). Next actor: nobody is told (no Inventory function writes a notice). The PM finds it only by opening `/projects/[id]/equipment` ("Sent / Still out"), which shows current custody, not "what was sent in UAE-M-00017". |
| User problem | PM does not know when equipment left the warehouse, cannot check it against what they asked for, and has nothing to point to if the quantity or condition on site disagrees. |
| Proposed behaviour | On each `dispatch_project` movement the system creates one **dispatch note** carrying a number, a frozen snapshot (item name, model, serial, equipment ID, condition at dispatch, bin, destination text, time zone, recorder name, PM name, company header) and a PDF rendered on demand from that frozen snapshot (plan-PDF pattern, `W/app/(app)/projects/[id]/documents/plans/[planId]/pdf/route.tsx`). The PM (or acting PM, or Projects founder: `proj_can_manage`) sees it as an N-02 row, opens it, and chooses "Acknowledge" or "Report a difference" with a required note. State: sent, acknowledged, difference reported. **Acknowledging or reporting never changes stock.** A reported difference goes to the warehouse as an N-02 row for review; any correction is a new movement recorded by the warehouse (dispatch and return lines cannot be corrected, only reversed: F-D-02). Bell notice for awareness (N-01) but the obligation is the durable note record, not the notice. |
| Before → after | PM learns of a dispatch: opens project → Equipment and notices a change, 0 prompts, no document → 1 row in Needs me, 1 click to a numbered PDF, 1 click to acknowledge. Warehouse: no extra step (the note is created by the same action that records the movement). |
| Roles affected | Warehouse operators (create, no extra input), PM / acting PM / Projects founder (acknowledge), warehouse leads (review differences). A person who is both warehouse operator and PM of the project: `proj_notify` skips the actor (`PRJ2:84`), so the note row must be created regardless and shown as a row for the PM; the acknowledgement of one's own dispatch is allowed but is recorded as same-person (owner to confirm, Section 6). |
| Data source | `inv_movements`, `inv_movement_lines`, `inv_units`, `inv_items`, `inv_requests` (`destination`), `inv_bins`, `inv_locations` (time zone), `proj_projects` (PM), `proj_project_details`, `companies`, `profiles`; `inv_next_code`/`inv_reference_counters`; `proj_issued_plans` as the frozen-payload precedent (`proj_issued_plan_guard`, `PRJ5:192-209`); `@react-pdf/renderer` and fonts under `W/lib/pdf`. |
| Technical scope | Migration (new tables: note header and frozen lines with an immutability guard like `proj_issued_plan_guard` that allows only acknowledgement columns to change; new numbering kind, which needs the `inv_reference_counters` kind check and the `case` in `inv_next_code` changed (`INV0:202, 221-242`); a SECURITY DEFINER read function and RLS so PMs read their project's notes without reading ledger rows; RLS tests). Server logic (PDF route, acknowledgement action). Interface. Atomicity: a note created by a separate server-action call can be lost between two transactions (F-D-09); a wrapper RPC that calls `inv_dispatch_to_project` and creates the note in one transaction leaves the protected dispatch function body unchanged (Section 6 decides). |
| Business-rule impact | **Adds a responsibility:** the PM (or acting PM or founder) becomes the acknowledging party of each dispatch. No approval is involved and the approvals engine is not used. Inventory movement history and booking conflicts are untouched (additive only; immutability triggers `INV1:349-360` stay). Which company numbers a cross-company dispatch, and who acknowledges when the PM is unavailable, are owner decisions (F-D questions 2 and 3). |
| Acceptance checks | (1) A dispatch creates exactly one note with the next number in the company sequence; a replay of the same idempotency key does not create a second (`inv_idem_begin` replay path). (2) A PM of that project can open the note and PDF; a PM of another project, and a person with no project access, get the same 404 as a non-existent note (RLS decides, like the plan PDF). (3) The PDF content equals the snapshot after the catalogue item name or serial is edited later. (4) Acknowledge/Report writes no `inv_movements` row. (5) With the PM inactive or ineligible the note still appears for a founder, and is never dropped. (6) A failed read shows "Could not load", not "No dispatch notes". |

---

#### N-04 Return checklist with PM confirmation

Full specification: Section 6. Register fields only; facts from findings D (F-D-10, F-D-11) and C (F-C-03, F-C-16, section 4).

| Field | Detail |
|---|---|
| ID / priority | `N-04` · LI (owner-specified). Reason: closes the return handoff; correct custody already exists in the ledger. |
| Verification | Confirmed (code): no return checklist or confirmation exists. A return carries no request and no link to the dispatch it reverses (`INV3:1966-1968`); counted returns are matched by project and item (`INV3:2006`, `docs/inventory-simplification.md:69`). There is no stored shortfall, dispute or "reported missing on return" record: items not listed stay "outstanding" (F-D-10). |
| Current behaviour | Warehouse receives via the request's Receive back step or Stock → With people; each unit needs a checkbox and a condition choice (about 26 interactions for 10 units plus 2 counted lines; F-C-16). Two return screens give opposite safety and the review wording is wrong for "fair" (F-C-03, Section 3.1). The database does not inspect: a caller supplying `good` makes a unit available at once (`INV3:1953-2012`). The PM is not told. |
| User problem | PM cannot confirm what actually came back, a short return is recorded only by absence, and a returned unit can become available while a part is missing. |
| Proposed behaviour | The checklist is built from what the ledger says the project currently holds (units exact by equipment ID; counted stock per item at project level; never "per request line", which the ledger cannot support). The warehouse works through it (tick received, condition per unit, kit contents per N-05) and records the return as today. The system then creates a **return confirmation** record: received lines, condition, anything still out, anything reported missing. The PM sees it as an N-02 row and chooses "Confirm" or "Report a difference" (required note). Rules: a unit with a condition other than good or fair is held and appears in N-06; a kit that is not confirmed complete goes to `needs_inspection`; confirmation never changes stock or makes anything available; a difference goes back to the warehouse as an N-02 row; a short return becomes a visible "still out: n items" line, which is the first stored record of a shortfall. |
| Before → after | PM: no prompt, finds outcome by opening Equipment → 1 Needs me row, 1 click to a checklist, 1 click to confirm. Warehouse: the checklist replaces per-unit checkbox hunting (the one-click "good and complete" shortcut is Section 3.2 F-C-16; this entry only adds the record). |
| Roles affected | Warehouse operators (record), PM / acting PM / Projects founder (confirm), warehouse leads and `confirm_stock` holders (review differences). Project completed or archived: returns are still allowed (`inv_get_project(...,false)`), so the PM role for confirmation must follow `proj_can_manage` at click time even on a completed project (owner to confirm). |
| Data source | `inv_project_equipment(project_id)` (SECURITY DEFINER, `INV8:20-60`), `inv_units`, `inv_balances`, `inv_kit_contents`, `inv_movements`/`inv_movement_lines` (return), `inv_check_condition`; N-03 snapshot, number and PDF plumbing. |
| Technical scope | Migration (confirmation tables with the same guard pattern; read function for PMs), server logic, interface. Database enforcement that a unit flagged "needs check" cannot be recorded as `good` is a change to `inv_return_from_project` and is **not** proposed here: owner decision (C section 4 implication 5). |
| Business-rule impact | Adds a responsibility (PM confirms returns). Inventory booking conflicts and movement history unchanged; the ledger is not edited. The rule "a return confirmation can never make damaged equipment available" is met by screen rules plus N-05/N-06, not by a new database refusal, unless the owner chooses that. |
| Acceptance checks | (1) A return of 10 units and 2 counted lines creates one confirmation listing exactly those lines and the lines still out. (2) A unit returned `damaged` appears under held (N-06) and is not offered as free to any request. (3) A PM of another project cannot read the confirmation. (4) Confirming writes no stock movement. (5) A failed read shows "Could not load", not "nothing to confirm". (6) A short return produces a visible still-out line that is not lost when the project completes. |

---

#### N-05 Kit contents check on return

| Field | Detail |
|---|---|
| ID / priority | `N-05` · LI. Reason: a kit returned "Good" with a missing item becomes available and fails at the next dispatch or on site. |
| Verification | Confirmed (code): `ReceiveStep` and `inv_return_from_project` treat a kit as one unit with one condition; `kit` does not occur in `W/components/inventory/planning/receive-step.tsx`; contents are checked only in `inv_pack_kit`/`inv_unpack_kit` (`INV3:2520-2700`). Table `inv_kit_contents` exists (`INV1:259-276`, statuses incl. substituted). |
| Current behaviour | Returning a kit unit: one condition select; nothing asks whether every contained item is present. |
| User problem | Warehouse operator receiving a kit has no list to tick; PM and next request owner learn of the missing cable at the worst time. |
| Proposed behaviour | When a returned unit is a kit, show its contents (`inv_kit_contents` rows with item name and status) with a tick per item and the two choices "All contents present" or "Something missing" (missing items ticked, optional note). "Something missing" sets the kit to `needs_inspection` through the existing condition path and the missing items go into the line note; "All present" leaves the condition choice as the operator set it. |
| Before → after | 0 content checks → 1 tick-all (or 1 untick per missing item) per kit; no new screen. |
| Roles affected | Warehouse operators. |
| Data source | `inv_kit_contents`, `inv_units` (kit custody), `inv_check_condition`, return function `inv_return_from_project`. |
| Technical scope | Interface only (uses existing condition and line-note inputs). |
| Business-rule impact | None. |
| Acceptance checks | (1) Kit return shows contents; non-kit returns unchanged. (2) "Something missing" holds the kit (not available) and the note lists items. (3) Operators without `warehouse` at the location still cannot record (database refuses, `inv_loc()`). (4) A failed contents read blocks "All present" with "Could not load kit contents", not an empty list. |

---

#### N-06 Held-unit follow-up (Today source, request flag, notice)

| Field | Detail |
|---|---|
| ID / priority | `N-06` · LI. Reason: a held unit (returned damaged or needing inspection) is today found only by looking in Stock; if it was reserved for a later request, the failure appears at dispatch. |
| Verification | Confirmed (code): there is no "held" flag. Held = `lifecycle='active'`, custody `warehouse`, condition not good/fair (C section 4). Inventory Today has four sources only: requests, returns, transfers, sales (`W/lib/inventory/today.ts:15-20`); searched `needs_inspection`, `repair`, `return_deadline` in `today*.ts`: none. Reservations survive a condition change; `inv_line_progress` still counts them as reserved (C F-C-11; defect and "swap unit" action are in Section 3.1). Release is only `inv_check_condition` (`INV3:2749-2802`). |
| Current behaviour | Held units show only under Stock; the later request shows "ready to send" and the dispatch fails with "X is damaged and is held back until it has been inspected" (`inv_unit_block_reason`, `INV3:317-319`). Nobody is told. |
| User problem | Warehouse leads do not know what awaits checking; the PM of the later request does not know a unit has dropped out. |
| Proposed behaviour | (1) New Today source "Held for checking": one row per unit or counted row held at a location the viewer operates, with condition, since when, where it came from and the action "Check condition" (existing action). (2) A "Needs replacement" fact on any request line whose reserved unit is held (computed with the existing `inv_unit_free`; the swap action is the Section 3.1 fix). (3) When a unit becomes held and has an active reservation for a later request, a notice to that request's PM (N-01, after N-01 exists) and an N-02 row for the warehouse. No change to booking-conflict logic. |
| Before → after | Held unit found by browsing Stock (unknown count of screens, never prompted) → 1 Today row; PM learns at dispatch time → learns when the unit is held. |
| Roles affected | Warehouse operators and leads, PMs with later requests, employees only if the unit was theirs. |
| Data source | `inv_units.condition/lifecycle/custody_kind`, `inv_balances.condition`, `inv_reservations`, `inv_unit_free`, `inv_check_condition`. |
| Technical scope | Interface and server logic for (1) and (2) (Today source follows the existing "source failed → ?" handling). (3) needs N-01 slice 2 and a small writer (migration, because Inventory writes no notices today). |
| Business-rule impact | None (display and notice only; booking conflicts and movement history unchanged). |
| Acceptance checks | (1) A returned damaged unit appears on Today for operators at that location only. (2) The later request shows the unit as needing replacement while its reservation remains. (3) After "Check condition" to good the row disappears. (4) A failed read shows the existing "could not be loaded; not an empty queue" banner. (5) A user with no stock grant sees no held rows. |

---

#### N-07 Record search from the command palette

| Field | Detail |
|---|---|
| ID / priority | `N-07` · LI for modules whose own list already works under the viewer's RLS (projects, tasks, enquiries, clients, stock, requests, employees for HR and C-level). LT for the colleague directory for ordinary staff (owner decision). Reason: saves 0 to 2 actions per lookup, but removes the need to know which module holds a record. |
| Verification | Confirmed (code): `W/components/nav/command-palette.tsx` filters only nav labels and groups ("Type a page name…", empty "No matching page.", lines 116-124); searched `searchAll`, `globalSearch`, `searchRecords`, `search_records`, `global_search` across apps, packages and migrations: no match. Only multi-entity "search" is type-ahead pickers (`lookupEmployees`, `searchItems`). The palette is reachable on phone through a search icon button (`command-palette.tsx:76-85`). |
| Current behaviour | Finding a record = nav to its module then module search: employee 3-4 actions over 2 screens; project 3; task 4-5; enquiry 3; client or contact 3-4; inventory item 3; request 3 (A section 5.4). An ordinary employee cannot find a colleague at all (`employees_select`: own row and reports; `20261105000000_fix_employee_manager_name_visibility.sql` states a wider directory is "a separate, larger decision"). |
| User problem | Staff must know which module owns a record before they can look; people who hold several modules pay the cost most. |
| Proposed behaviour | A "Records" group in the palette fed by ONE server action `searchRecords(q)`: minimum 2 characters, 250 ms debounce with request cancel, 5 hits per source, sources run in parallel with a short timeout, each through the viewer's own session (`createClient()`); **no service-role client**. A source that fails shows a chip "Could not search Tasks" (never "no results"); a source the person has no module access to is skipped silently. Result row: type icon, primary text, one secondary line, link. Query text is never logged. |
| Before → after | 3 to 5 actions over 2 to 3 screens → 3 actions on 1 screen (Ctrl/Cmd+K or search icon, type, Enter or tap). |
| Roles affected | Everyone for the sources they hold; ordinary staff get no colleague results until the directory decision. |
| Data source | See per-module table below. |
| Technical scope | Server logic and interface. Migration only if a staff directory function is approved (the same narrow SECURITY DEFINER function shape as `get_employee_manager_name`, id and name only; it would also fix the clock project-lead list, Section 3.1 F-A-07). |
| Business-rule impact | None if every query runs under the viewer's RLS. If the owner approves a staff directory, that is a confidential-data access decision and is recorded as an owner decision, not made here. |
| Acceptance checks | (1) HR finds an employee by name; a no-grant employee searching the same name gets no employee rows. (2) A Sales user does not find a project they have no Projects grant for; a PM finds projects at summary level only unless they are a member (as the project page does). (3) An Inventory user sees only items their grant allows and never sees costs. (4) Forcing one source to fail shows its chip while the others show results. (5) Results contain no leave, claim, payroll, letter, compensation or personal contact data. (6) A search for a record in another company returns nothing (RLS), checked with a two-company test. |

**Per-module search sources and result rows:**

| Module | Source (existing) | Fields matched today | Who gets rows (enforced by) | Result row shows | Link |
|---|---|---|---|---|---|
| Employees | `employees` list query used by `/employees` (`W/app/(app)/employees/page.tsx`) | first name, last name, personal e-mail (no employee number, job title or department today) | HR Admin of the company, CEO/CTO, others the `employees_select` policy allows (line manager: own reports; sys_admin: all companies, F-people-hr-24); ordinary staff: own row only (RLS `employees_select`) | name, job title, company. Never e-mail, date of birth, pay | employee page |
| Projects | `proj_directory` (name, reference, PM) | name, reference, PM name | Projects grantees; summary for ongoing projects, details only for members and founders (`proj_can_view_details`) | name, reference, PM, status | project (the page applies its own level) |
| Tasks | `filterTasks` over `loadWorkRows` (`W/lib/projects/my-work.ts`) | title, project | your tasks and team tasks only (membership RLS) | title, project, due, status | `/projects/work?task=` |
| Enquiries | Sales opportunities list search | title, reference, agency, client | CRM grantees of the company (CRM RLS) | reference, title, client, stage, owner. No values or commercial files | enquiry |
| Clients and contacts | clients page search | organisation, place, contact, e-mail, phone | CRM grantees. **Organisations and contacts are not company-scoped today** (Section 3.1/2 F-B-21, owner question): the palette must show no more than the clients page shows | organisation and contact name only | client |
| Inventory items and units | stock list search | name, model, serial, equipment ID, bin label | `view_stock`/`warehouse` (RLS on `inv_units`, `inv_balances`); PMs browse the catalogue only (`inv_can_browse`) | item name, equipment ID, location, status. No cost | `/inventory/stock?open=` |
| Equipment requests | `loadRequestList` | code, project, destination | `inv_can_see_request` (project members, warehouse, founders) | code, project, status, dates | request |
| Files, site information | none (no index) | n/a | n/a | out of scope until N-09 | n/a |
| Approvals, leave, claims, letters, payroll | none | n/a | n/a | excluded on purpose: not searchable from the palette | n/a |

---

#### N-08 CEO/CTO "needs attention" list from existing data

| Field | Detail |
|---|---|
| ID / priority | `N-08` · LI for lines 1 to 3 (they reuse loaders from N-02 and Section 3.1); LT for the others. Reason: gives the CEO/CTO one named list instead of counts and silent zeros; each line is only as visible as the viewer's own grants. |
| Verification | Confirmed (code): searched `overdue`, `over budget`, `variance`, `health`, `escalat`, `stuck`, `aging` in My Day loaders, inventory Today, budget inbox: there is no company-wide exceptions list (A section 5.3; G section 6A). "Project status" on My Day is a donut of counts with no names, only for projects where the viewer is member or Projects founder (`W/lib/my-day/portfolio.ts:16-34`). |
| Current behaviour | See A 5.3 and G 6A: decisions count (assigned rows only), HR alerts, own overdue tasks, no money, no stuck handovers, no equipment, no failed jobs. A CEO or CTO without module grants sees only the HR half. |
| User problem | The owner's stated need ("critical company issues") has no screen; a CEO cannot tell "nothing wrong" from "not allowed to see" or "could not load". |
| Proposed behaviour | Card on My Day for CEO/CTO (and a full page if more than 8 lines) built from the lines below. Each line: count, up to 3 names, age of the oldest, link. Every line carries the three states "N items", "None", "Could not load"; a line the viewer has no access to is replaced by the footer "Not covered for you: <modules>" so absence is never read as "all clear". Thresholds are settings the owner sets (suggested starting points for the owner to confirm: approvals 3 days, handover unassigned 2 working days). |
| Before → after | CEO checks up to 7 places, with money and handovers invisible → 1 card, each line 1 click. |
| Roles affected | CEO and CTO; people who hold a CEO/CTO role plus module grants see more lines; HR Admin sees line 1 company-wide because RLS allows it (below); Finance and others do not get this card. |
| Data source | Line table below. |
| Technical scope | Server logic (loaders reusing N-02) and interface; no migration for lines 1 to 8. |
| Business-rule impact | None: read-only, existing rights only. If the owner wants a CEO to see more than their grants allow, that is N-22 (a permission-model decision), not this entry. |
| Acceptance checks | (1) A CEO with no Projects or Inventory grant sees only lines they can read, plus the "Not covered for you" footer naming them. (2) Forcing a line's read to fail shows "Could not load" for that line only. (3) A CEO sees no other company's budgets (company-isolated by `pbx_accessible_company_ids`). (4) Each line's link opens the page that handles it; the list changes nothing. (5) Equipment line shows nothing to a CEO without stock view (not "0 overdue"). |

| # | Line | Source record | Who can see it (what enforces it) | Threshold | Failure state / caveat |
|---|---|---|---|---|---|
| 1 | Approvals waiting longer than N days | `approvals` pending, `created_at` (selected but unused today, `approvals/page.tsx:34,38`) | Assigned approver sees own rows (RLS `approver_id = auth.uid()`); `has_role('hr_admin')` sees all; **a CEO/CTO without HR Admin sees only rows assigned to them**, so "company-wide stuck approvals" is not possible for a CEO under today's RLS (stating a fact; widening it is N-22) | N days | "Could not load approvals" (never 0) |
| 2 | Budget, final-expense and settlement decisions waiting; items on hold (no independent approver) | `pbx_inbox()` (`i_can_decide`, `on_hold`, `i_can_close`) | pbx grantees by company; `on_hold` also shown to `manage_access` holders (Section 3.1 F-E-08) | any waiting more than N days | "Could not load project budgets" |
| 3 | Handovers submitted and not assigned; won enquiries with no handover | `proj_handovers` (submitted, pm_assigned) with dates; `crm_opportunities.stage='won'` without handover (Section 3.1 F-B-01) | `assign_pm` holders and Projects founders; Sales owner/founder for won-without-handover | N working days (suggest 2) | Separate failure text per read |
| 4 | Scope changes awaiting decision; commercial approvals awaiting a founder | `proj_scope_changes.status='proposed'`; `crm_approvals.state='pending'` | `approve_scope` holders; Sales founders | N days | per read |
| 5 | Projects with a blocked task, or an overdue milestone, named | `proj_tasks.blocked_at`, milestone due dates (already fetched, `loaders.ts:48`) | Projects founders see details; members see their projects; other viewers see counts only ("summary only", `portfolio.ts`) | any | "Could not load projects" |
| 6 | Over-budget projects | Approved final expenses above approved budget: `approved_actual_total` versus `approved_budget` in the settlement rows of `pbx_inbox` (strings; compare with the existing `pbx` money helpers; a comparison only, no new calculation) | pbx grantees by company. **Only covers projects whose final expenses are approved**; projects still running have no actuals visible, so "over budget while running" is not available from existing data | any difference | If no approved actuals: not listed (not "within budget") |
| 7 | Overdue equipment | `inv_units.expected_return_at < now()` and custody project or employee; per project `inv_project_equipment().overdue`; employee holdings `inv_employee_outstanding` | `view_stock`/`warehouse` (units), `view_employee_custody` (employees), PM for own projects. Items with no recorded return date never appear (N-13) | any overdue | "Could not load equipment"; viewer without stock view: line omitted + footer |
| 8 | Leave balance discrepancies | `ai_drafts` pending, written by the deterministic detector (`balance-discrepancy-detector`, `leave_balances` where balance < 0) | `ai_drafts_select`: any-scope HR Admin or sys_admin; **CEO/CTO cannot read it**; and it is not company-scoped today (Section 3.1 F-people-hr-11) so the line must wait for that fix | any | The detector runs from a route that the sign-in proxy redirects (F-H-01); until fixed the line is empty for the wrong reason |
| 9 | Failed or missed scheduled jobs | none for five of six jobs today (only `recovery_scheduler_status`, HR Admin and sys_admin on `/alerts`) | needs Section 3.1 `job_runs` (F-H-02); then HR Admin and sys_admin | monthly job 35 days | LT, blocked on F-H-02 |

---

#### N-09 Project file "current reference" marker and Site and references card

| Field | Detail |
|---|---|
| ID / priority | `N-09` · LI. Reason: a PM or site team member needs 5 to 8 clicks over 4 to 5 screens to assemble site instructions, and cannot tell which file is current. |
| Verification | Confirmed (code): `proj_files` has purposes document, completion_evidence, feedback_evidence, other (`PRJ5:24-50`); no version, supersede or approved flag (searched `is_current`, `current_reference`, `site_instruction`, `supersed` in `PRJ5`: only `proj_issued_plans.superseded_at`). The issued client timeline is the only versioned artifact (`proj_issued_plans`). |
| Current behaviour | See B P3: Projects → My Work → project → Work (details) → Timeline (site plan, dependencies, bookings) → Manage project → Files & client plan (flat list, newest first) → History (notes from Sales). Handover risks are shown nowhere in the project (Section 3.2 F-B-15). |
| User problem | Site team does not know which file is the current drawing or instruction; information is spread over six places. |
| Proposed behaviour | (a) PM-only "Mark as current reference" on a file or link (`is_current_reference`, `reference_set_by`, `reference_set_at`, optional `replaces_file_id`); setting a new one for the same label marks the old one replaced, history kept, nothing deleted. Wording in the interface: "Current reference (set by the PM)", not "Approved", because it is the PM's declaration, not client sign-off (owner decides if client evidence is required: B open question 6). (b) New purpose "Site instruction" (widen the `purpose` check). (c) A "Site and references" card at the top of the Work right rail: location and time zone, access and power dependencies with confirmation state, next booking, current-reference files (one click to open), handover notes and risks. |
| Before → after | 5 to 8 clicks over 4 to 5 screens → 1 click (card) + 1 to open a file. |
| Roles affected | PM and acting PM (mark), all project members (read), restricted files stay PM-only. |
| Data source | `proj_files`, `proj_project_details`, `proj_external_dependencies`, `proj_plan_items` (site), `proj_site_bookings`, `proj_handovers.notes/risks`. |
| Technical scope | Migration (columns on `proj_files`, widened purpose check, a SECURITY DEFINER function `proj_set_current_reference` that checks `proj_can_manage`, audit already covers `proj_files` via `proj_audit_log`), server logic, interface. Yes, it needs a migration. |
| Business-rule impact | None. Restricted (PM-only) files cannot be marked current for members; confidential-data access unchanged. |
| Acceptance checks | (1) PM marks a file; members see it first with the badge and the old one greyed with its date. (2) A member cannot mark (database refuses; the button is cosmetic). (3) Marking a deleted file or a completion-evidence file is refused. (4) A restricted file does not appear on the card for non-PM members. (5) Card load failure shows "Could not load site information", not an empty card. |

---

#### N-10 Departments screen

| Field | Detail |
|---|---|
| ID / priority | `N-10` · LI. Reason: without department rows the Job tab and project teams show no department choice, but nothing requires one (project teams save with `department_id` null: `projectsCore.ts:265`). G rated it LB "if departments are used on day one"; the code shows they are optional, so LI. |
| Verification | Confirmed (code, hosted state unverified): table `departments(company_id, name, parent_department_id, deleted_at)` (`20260922000000_phase0_foundations.sql:76`); RLS `departments_select` any signed-in, `departments_write` HR Admin of the company or sys_admin; no insert outside tests and e2e seed (`packages/e2e-tests/local-stack/seed.sql:36`); `canManageDepartments` unused. Hosted check: `select company_id, count(*) from departments where deleted_at is null group by 1;`. |
| Current behaviour | The only consumers are the People & Access Job tab picker (`W/components/people-access/job-panel.tsx:20-45`) and project team creation. No screen creates a department; rows can only be inserted in the database. |
| User problem | HR cannot set up departments; the picker is empty or shows whatever was inserted by hand. |
| Proposed behaviour | A "Departments" section in People & Access (HR Admin of the company, or sys_admin): list, add, rename, archive (soft `deleted_at`). Archived departments keep existing assignments. Parent department optional. |
| Before → after | Insert in the database (not possible for HR) → 3 fields-free actions (name, Add). |
| Roles affected | HR Admin, sys_admin. |
| Data source | `departments`; `employees.department_id`; `proj_teams.department_id`. |
| Technical scope | Server logic (action under the viewer's RLS) and interface. No migration. |
| Business-rule impact | None (HR reporting lines are not based on departments here; `manager_id` unchanged). |
| Acceptance checks | (1) HR Admin of company A adds a department; it appears in the Job tab for A only. (2) HR Admin of A cannot add or rename for B (RLS). (3) Archiving does not clear existing employee assignments. (4) A failed list read shows "Could not load departments". |

---

#### N-11 Duplicate a budget line

| Field | Detail |
|---|---|
| ID / priority | `N-11` · LI. Reason: cheap, client-side, and budgets are entered line by line (30-60 interactions for 10 lines, F-E-12 target 15-35). |
| Verification | Confirmed (code): no duplicate or copy control in `W/components/budget/*` or `pbx_*` functions (grep `duplicate`, `copy`: only an error-message file). |
| Current behaviour | Each line is typed from scratch; people checkboxes start empty. |
| User problem | PM re-enters near-identical lines. |
| Proposed behaviour | "Duplicate" button on each draft line copying category, activity, people, days, rate and fixed amount into a new draft row below; people checkboxes default to all project members ticked on new rows. Totals still recalculated by the database. |
| Before → after | 30-60 interactions → about 15-35 for a 10-line budget (target, not measured). |
| Roles affected | PMs. |
| Data source | Draft rows in the editor; `pbx_save_budget_draft`. |
| Technical scope | Interface only. |
| Business-rule impact | None. |
| Acceptance checks | (1) Duplicate creates an unsaved draft row equal to the source. (2) Submitting uses the same validation and rounding. (3) Only the PM can edit (database). (4) A submitted version has no duplicate button. |

---

#### N-12 Invite confirmation and configuration health strip

| Field | Detail |
|---|---|
| ID / priority | `N-12` · LI. Reason: a Sys Admin cannot tell whether an invite or resend worked, and missing production settings fail silently. |
| Verification | Confirmed (code): `W/components/people-access/invite-user-form.tsx:26` renders only `state.error`; `W/lib/config-check.ts:7` lists only the two Supabase public settings. |
| Current behaviour | Invite and Resend give no success message; `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` and the three Graph settings are not checked. |
| User problem | Sys Admin invites again "to be sure"; HR assumes e-mails and jobs work. |
| Proposed behaviour | After Invite/Resend show "Invite sent to <e-mail>"; add a Sys-Admin-only strip listing, by name only, whether each setting above is set (never values). |
| Before → after | 0 confirmation → 1 line; 0 visibility of 6 settings → 1 strip. |
| Roles affected | System Administrator. |
| Data source | `process.env` presence (names only). |
| Technical scope | Interface and server logic. |
| Business-rule impact | None (invite stays Sys Admin only). |
| Acceptance checks | (1) Success message appears once per invite. (2) Missing setting is listed by name, never its value. (3) Non-Sys-Admin sees no strip. |

---

#### N-13 Other Today sources: rentals due, repairs due, no return date, overdue employee equipment

| Field | Detail |
|---|---|
| ID / priority | `N-13` · LT. Reason: the warehouse already has Today for requests, returns, transfers and Sales checks; these four are real gaps but lower frequency (held units are N-06, the LI one). |
| Verification | Confirmed (code): `today.ts` sources `requests/returns/transfers/sales` only (`:15-20`); rental deadlines are read only in form pickers and the unit panel (`W/lib/inventory/stock.ts:681`, `unit-panel.tsx:129`); equipment with no expected return never appears (`today.ts:206`; employee issues allow no date, `INV3:1725`). |
| Current behaviour | A rental past its `return_deadline`, a unit out for repair past its expected return, equipment issued with no date, and overdue employee equipment do not appear in Today. Counted stock out on projects or people appears only under "All warehouses". |
| User problem | Rental fees and lost equipment are found by chance. |
| Proposed behaviour | Four read-only Today sources using existing columns (`inv_rentals.return_deadline` with status open, `inv_units` custody `repair` with `expected_return_at`, units and balances out with no `expected_return_at`, employee holdings overdue via `inv_employee_outstanding` for `view_employee_custody`), each with the existing "source failed → ?" handling. |
| Before → after | Not found unless someone opens the unit panel or With people → 1 Today row each. |
| Roles affected | Warehouse operators; HR custody readers for the employee source. |
| Data source | `inv_rentals`, `inv_units`, `inv_balances`, `inv_employee_outstanding`. |
| Technical scope | Server logic and interface. |
| Business-rule impact | None. |
| Acceptance checks | (1) Overdue rental appears for operators of that company. (2) A user without stock grant sees none. (3) Failed source shows the banner, not an empty queue. |

---

#### N-14 Onboarding checklist screen

| Field | Detail |
|---|---|
| ID / priority | `N-14` · LT. Reason: onboarding works without it (8 screens, 5 actors, repeated entry is Section 3.2 F-G-08); a checklist is useful but not needed on day one. |
| Verification | Confirmed (code): tables `checklist_templates`, `checklist_template_items`, `employee_checklist_items` (`20260928000000:107-138`) and function `generate_checklist_items(employee, template, anchor_date)` exist and are covered by RLS tests (`packages/rls-tests/test/phase5.rls.test.ts:319-395`); no page or action under `apps/web/src` references them (grep). So the database side exists; the screen does not. |
| Current behaviour | No screen creates, shows or completes a checklist. |
| User problem | HR, the Sys Admin and the line manager have no shared list of "account invited, linked, department and manager set, module access given, equipment issued". |
| Proposed behaviour | On the employee page and in the "Waiting for a login" list (Section 3.2 F-G-08), show the employee's checklist items by `assignee_role`; allow marking done or skipped by the assignee role (RLS already supports line manager, finance, sys_admin, ceo, hr_admin); HR Admin picks a template when creating the employee (calls `generate_checklist_items`). Seed one standard template. |
| Before → after | Checklist lives outside the app → 1 list per new hire. |
| Roles affected | HR Admin, Sys Admin, line managers, Finance. |
| Data source | the three tables above; `generate_checklist_items`. |
| Technical scope | Interface and server logic; seed data (a migration insert for the template, if the owner wants one standard template). |
| Business-rule impact | None. Do not reuse `approvals` for it even though `onboarding_task` exists in `approvable_entity` (unused). |
| Acceptance checks | (1) Creating an employee with a template creates one row per template item with due dates offset from hire date. (2) A line manager marks only items assigned to their role for their report. (3) No cross-company access. |

---

#### N-15 Scope-change "what this touches" link list

| Field | Detail |
|---|---|
| ID / priority | `N-15` · LT. Reason: the PM can find the three places by memory; a prompt reduces misses but is not essential. |
| Verification | Confirmed (code): `proj_decide_scope_change` updates `proj_project_details.scope` and notifies the PM only (`PRJ5:549-588`); feedback links a task only as a pointer (`target_id`). |
| Current behaviour | Approving a scope change updates scope text; tasks, equipment and budget are not touched or flagged. |
| User problem | PM forgets to add tasks, update equipment or request extra budget after approved scope growth (about 7 clicks to find the three places). |
| Proposed behaviour | On an approved scope change card, a panel "What this change touches" with three links prefilled with the change title: Add tasks (Work), Update equipment (Equipment tab), Request additional budget (Budget tab, shown only if the viewer can open it). **Nothing changes automatically; the PM decides each.** The cost effect stays visible only to `view_commercial` holders; the amount is not shown to a PM without it. Optional ticks stored on the change are not proposed for launch. |
| Before → after | About 7 clicks → 3 prefilled links. |
| Roles affected | PM and acting PM. |
| Data source | `proj_scope_changes`, existing tab routes. |
| Technical scope | Interface only (a migration only if ticks were stored). |
| Business-rule impact | None: approval authority and budget approval unchanged. |
| Acceptance checks | (1) Links appear only after approval. (2) Budget link hidden for a PM without budget access. (3) No amount shown without `view_commercial`. (4) Clicking changes nothing until the PM saves in the target screen. |

---

#### N-16 Project budget print view and company CSV

| Field | Detail |
|---|---|
| ID / priority | `N-16` · LT. Reason: Finance has the on-screen views; export is convenience, and Zoho Books stays the quote/invoice tool. |
| Verification | Confirmed (code): searched `csv`, `export`, `print`, `download`, `pdf` in `W/components/budget`, `W/app/(app)/finance`, `W/lib/budget`, `W/lib/actions/projectBudget.ts`: none. |
| Current behaviour | Budgets, actuals, funding and settlement exist on screen only. |
| User problem | Finance cannot hand a one-page budget versus actual to a PM or the CEO, or take a list into a spreadsheet. |
| Proposed behaviour | (a) A print view of one project's budget versus actual (CSS print like `W/components/inventory/label-sheet.tsx:32-60`, or a generated PDF like the plan PDF; owner chooses) with currency shown per figure and no cross-currency totals. (b) A company list CSV from `pbx_inbox`/`pbx_budget_view` data. CSV cells beginning `=`, `+`, `-`, `@` are prefixed to prevent spreadsheet formula injection. |
| Before → after | Copy by hand → 1 button. |
| Roles affected | Holders of existing budget read access (Finance, executive approvers, `view`, PM for own project). |
| Data source | `pbx_budget_view`, `pbx_inbox`. |
| Technical scope | Interface; server logic for the CSV route; migration only if a list function is wanted. |
| Business-rule impact | None (same read permission; company-isolated). Zoho Books unchanged. |
| Acceptance checks | (1) Only users who can open the budget get the print view. (2) CSV contains only the viewer's accessible companies. (3) A cell `=cmd` is exported as text. (4) Figures equal the screen (same rounding). |

---

#### N-17 Copy lines from an earlier project budget

| Field | Detail |
|---|---|
| ID / priority | `N-17` · LT. Reason: needs a new function and a rule about which budgets may be copied; saves most on repeat events only. |
| Verification | Confirmed (code): no copy or template function (grep `pbx_*`, `components/budget`). `pbx_revise_budget` copy logic exists for revisions only. |
| Current behaviour | Every budget starts empty. |
| User problem | Repeat events repeat 10 to 40 lines of entry. |
| Proposed behaviour | "Copy lines from another of my project budgets": server function that reads the rows of an approved version the PM may read and inserts them into the new draft; totals recalculated by the database; copied rows are drafts only; categories re-checked for the new company. |
| Before → after | About 30-60 interactions → about 5 plus edits. |
| Roles affected | PMs. |
| Data source | `pbx_budget_versions` rows, `pbx_revise_budget` logic. |
| Technical scope | Migration (one function), interface. |
| Business-rule impact | None (same submission and approval). |
| Acceptance checks | (1) Copy of a budget the user cannot read fails. (2) Copied rows are drafts and recalculated. (3) Company-scoped categories are rechecked; a category not in the new company is refused. |

---

#### N-18 Tag employee claim lines to a project (owner decision)

| Field | Detail |
|---|---|
| ID / priority | `N-18` · LT, owner decision. Reason: removes a re-keying step for PMs but touches the claims form that Finance and HR use. |
| Verification | Confirmed (code): `reimbursement_claim_lines.project_id` and `cost_center` exist (`20260927000000...:79-80`) but no screen sets them; the actuals picker lists only the PM's own latest 40 claims (`W/lib/budget/claims.ts`). (Source labels it USABILITY/NEW; registered here for the new field; Section 3.2 should not repeat it.) |
| Current behaviour | Staff claim; the PM re-enters the same cost in actuals. |
| User problem | Duplicate entry and mis-stated project cost risk. |
| Proposed behaviour | Optional "Project" select on claim lines (projects the person belongs to); show tagged claims first in the actuals picker. Physical project-expense receipt submission is not changed. |
| Before → after | PM re-enters each claimed cost → picks the tagged claim. |
| Roles affected | Employees, PMs, Finance. |
| Data source | `reimbursement_claim_lines`, `proj_project_members`. |
| Technical scope | Interface and server logic. |
| Business-rule impact | None to approvals or receipts; owner confirms it is wanted (E question 4). |
| Acceptance checks | (1) Only the person's own projects are offered. (2) A claim tagged to a project the person left remains valid. (3) Another employee cannot edit my claim (RLS). |

---

#### N-19 Read-only "effective access" summary for access managers

| Field | Detail |
|---|---|
| ID / priority | `N-19` · LT. Reason: admins open up to 4 tabs and N module cards to answer "what can this person do"; useful but not blocking. |
| Verification | Confirmed (code): no such view (G F-G-18; searched People & Access components). |
| Current behaviour | Effective access is assembled by hand; project relationships and line-manager links are not visible on People & Access. |
| User problem | Granting and reviewing access takes guesswork. |
| Proposed behaviour | A read-only summary at the top of the person panel: HR roles, module presets in plain words, project roles, reports count, "no login yet / no manager", limited to what the viewer may see. |
| Before → after | Up to 4 tabs plus cards → 1 summary. |
| Roles affected | Access managers, HR Admin, Sys Admin. |
| Data source | grant tables; one function returning counts without project data. |
| Technical scope | Migration (one read function), interface. |
| Business-rule impact | None. |
| Acceptance checks | (1) Shows only grants the viewer may read. (2) No project content is exposed. (3) Load failure says "Could not load" (not "Basic access"). |

---

#### N-20 Readable policy page and policy acknowledgement (owner decision)

| Field | Detail |
|---|---|
| ID / priority | `N-20` · LT, owner decision. Reason: staff-readable policy wording is a usability change in Section 3.2; acknowledgement is a new feature with legal weight. |
| Verification | Confirmed (code): searched `handbook`, `policy_acknowledg`, `acknowledged_policy` in tables and routes: no company-policy document and no acknowledgement record; "Policies" means country rule versions only (F-people-hr-13). Acknowledge patterns exist for appraisals and recovery alerts (state change on the record). |
| Current behaviour | Staff open a console showing rule payload JSON. |
| User problem | Staff cannot read policy; HR cannot prove staff saw it. |
| Proposed behaviour | If the owner wants it: a per-version acknowledgement table (employee, version, time) with an employee-only write guard like `guard_appraisal_acknowledge`; HR sees who has not acknowledged. |
| Before → after | Not possible → 1 click per policy. |
| Roles affected | All employees, HR Admin. |
| Data source | `policy_versions`; new table. |
| Technical scope | Migration, interface. |
| Business-rule impact | New obligation for staff; owner decision. |
| Acceptance checks | (1) An employee records only their own acknowledgement. (2) HR sees only their company. (3) A superseded version cannot be acknowledged. |

---

#### N-21 HR screens that do not exist

| Field | Detail |
|---|---|
| ID / priority | `N-21` · LT overall; the leave-balance adjustment screen is LI only if HR currently makes adjustments in SQL (hosted check: ask HR). Reason: specialist, infrequent. |
| Verification | Confirmed (code) for each row (F-people-hr-18, searched tables and actions by name). |
| Current behaviour | See table. |
| User problem | HR works in the database for these tasks. |
| Proposed behaviour | See table; every screen reuses the existing action and RLS and shows the reason. |
| Before → after | Database work → a screen. |
| Roles affected | HR Admin (and sys_admin for company settings). |
| Data source | See table. |
| Technical scope | Interface and server logic; no migration. |
| Business-rule impact | Adjustment screen: none to the calculation (reuses `postLeaveLedgerAdjustment`; the leave-balance calculation is a protected area and is not touched). Approval-workflow editor: **changes who is responsible for approving; owner decision.** |
| Acceptance checks | (1) HR Admin of A cannot act on B. (2) Each change shows who and why (existing audit). (3) A workflow edit cannot make the requester their own approver. |

| Item | Today | Proposed screen | Owner decision? |
|---|---|---|---|
| Manual leave-balance correction | `postLeaveLedgerAdjustment` (`W/lib/actions/ledgerAdjustments.ts`), only caller is AI-draft authorise | Form with reason that calls the same action | No |
| Approval workflows | `approval_workflows`, `approval_workflow_steps` seeded; RLS lets HR write | Editor | **Yes (changes who approves)** |
| Deduction priority | `deduction_priority_rules` seeded AE/SA/PL | Read-only first | Yes for edits |
| Document-expiry reminder rules | `document_expiry_reminder_rules` | List and edit lead days | No |
| Company settings edit | `/admin/companies`: create, deactivate only | edit name, currency | No |

---

#### N-22 Read-only visibility for CEO/CTO and Operations: OWNER DECISION

This is a permission-model decision. **This register does not propose granting anyone access and does not recommend an option.**

| Field | Detail |
|---|---|
| ID / priority | `N-22` · Decision required before any work; no work scheduled. Provisional LT. |
| Verification | Confirmed (code): project details are visible only to company founders and members (`proj_can_view_details`); the read-everything route is `founder`, which also allows assigning PMs, approving scope, reopening projects and managing access; Inventory `view_costs` is founder-granted only; Sales has no read-only grant (any Sales grantee can create and own enquiries) (G F-G-17, section 6B). Hosted state unverified (who holds what today). |
| Current behaviour | A CEO/CTO or Operations manager cannot see all projects' details, stock costs or Sales read-only without a broader right. |
| User problem | Leadership visibility conflicts with least privilege. |
| Proposed behaviour | The owner chooses between (a) no model change, composing existing grants per person and accepting that details stay member-only, or (b) a new Projects capability that reads every project's details without write rights (migration of `proj_can_view_details` and policies, RLS tests), and may separately choose a read-only Sales grant. Each option needs its own decision. |
| Before → after | Not applicable until decided. |
| Roles affected | CEO, CTO, Operations. |
| Data source | `proj_company_grants`, `inv_company_grants`, `crm_company_grants`. |
| Technical scope | Option (a): none. Option (b): migration, server logic, interface, RLS tests. |
| Business-rule impact | Option (b) widens confidential project access (company-boundary and confidential-data protection): needs explicit owner approval. Option (a) changes nothing. |
| Acceptance checks | If (b): a holder reads all company projects and writes none; a user without it is unchanged; no cross-company access; the grant is a sensitive grant under existing protections. |

Effect on this part: N-08 shows a CEO only what their grants allow today; N-22 decides whether that is enough.

---

#### N-23 Contingency and VAT on project budgets: OWNER DECISION

| Field | Detail |
|---|---|
| ID / priority | `N-23` · LT, owner decision. Calculations are not changed under any option. |
| Verification | Confirmed (code): searched `contingen`, `vat`, `tax` in `20261210*pbx*` migrations, `packages/domain/src/projectBudget.ts`, `W/components/budget`, `W/lib/budget`: none; design doc excludes tax (`docs/project-budget-expenses-design.md:87`). A contingency can be an ordinary line in a Finance-added category (`pbx_add_category`). Rounding is decided and tested (once per line, half away from zero, per-currency decimals: `projectBudget.test.ts:32-44`). |
| Current behaviour | No contingency or VAT concept. |
| User problem | Finance and PMs improvise contingency as a line; VAT is outside the budget. |
| Proposed behaviour | Owner chooses: keep the ordinary Contingency line with guidance text on the budget screen; or add a flagged line type with no formula; VAT remains in Zoho Books. No change to totals or rounding. |
| Before → after | Not applicable until decided. |
| Roles affected | PMs, Finance, executive approvers. |
| Data source | `pbx_budget_lines`, categories. |
| Technical scope | Interface only for guidance text; migration if a flagged line type is chosen. |
| Business-rule impact | None to calculations; flagged type would change what approvers see, owner decides. |
| Acceptance checks | If implemented: totals equal the current database result for identical inputs; the database still refuses over-scale input. |

---

### 5. Assistant (AI) later enhancement

**Status today (Confirmed (code)).** There is no language model in the application: searched `anthropic`, `openai`, `claude`, `llm`, `generative` in `apps/web/src` and `packages/domain` (none, F-people-hr-26); `apps/web/package.json` has no model SDK. The only "AI" feature is a deterministic job (`balance-discrepancy-detector`) that writes `ai_drafts` rows for a human to authorise; `is_ai_generated` is never set to true. Nothing in this register needs an assistant.

**How an assistant could later reuse approved workflows (each is a faster route to something that already exists):**

| Capability | Reuse | Constraint |
|---|---|---|
| Read-only search and "what needs me" answers | The N-07 server action and the N-02 aggregator as tools | Runs under the signed-in user's own session, so RLS decides; never the service-role client (F-people-hr-26) |
| Drafting | Writes into existing draft states: handover draft (`proj_save_handover`), budget draft (`pbx_save_budget_draft`), equipment request draft, enquiry draft. Precedent: `ai_drafts` ("propose into a draft table; a human with the normal role authorises through the normal action", `authorizeAiDraft` with a compare-and-set claim) | Never submits, never approves |
| Calling an existing action | The same server actions and RPCs a screen calls, after a confirmation card that shows the exact parameters (inventory movements already carry idempotency keys, `lib/inventory/idempotency.ts`) | The user's session and the database re-check every permission; independent approvals stay human (an assistant never decides an approval) |
| Audit | Mark assistant-initiated writes (`is_ai_generated` exists on `ai_drafts`) and keep the existing audit tables | New columns need a migration per table |

**Why it must not be a launch dependency:**
1. No model, no contract, no data-protection review exists; sending HR, payroll or client data to an external model is an owner and legal decision.
2. Every assistant capability above is a shortcut to a screen that must exist and work first (N-02, N-07 and the Section 3.1 reliability fixes). An assistant over screens that show "0" on a failed read would repeat the error in prose.
3. Free text entered by staff (notes, enquiry text, discussion) is untrusted input to a model that can call actions; confirmation and least privilege are mandatory, which requires the action surface to be stable first.
4. Non-deterministic output cannot be an acceptance test for launch; deterministic paths can.
5. Cost, availability and rate limits would become an operational dependency of daily work.

Priority: LT. Preconditions: N-07, N-02, Section 3.1 failed-read fixes, a data-protection decision.

---

### 6. Notes

**Verified to exist in some form (not registered as new):**

| Theme | What exists | Where | Consequence |
|---|---|---|---|
| Notifications | Table, three writers, one reader, text builder with 25 cases | Section N-01 | N-01 is a surface and a wider reader, not a new table |
| Cross-record search | Per-module searches (enquiries, projects, tasks, stock, requests, employees) | `W/components/nav/command-palette.tsx` (pages only) | N-07 fans out to them |
| Departments | Table, RLS, picker in Job tab | N-10 | Only creation UI missing |
| Onboarding checklist | Tables plus `generate_checklist_items` and RLS tests | N-14 | Only screens and seed missing |
| Acknowledgement pattern | Appraisal acknowledge guard; recovery alert acknowledge | `guard_appraisal_acknowledge`, `alerts/acknowledge-alert-form.tsx` | Precedent for N-03/N-04/N-20 |
| Frozen document plus PDF | `proj_issued_plans` and plan PDF route | `PRJ5:192-209` | Precedent for N-03 |
| Held-unit defect and swap action | Section 3.1 (F-C-11) | n/a | N-06 is the Today source and notice only |
| Handover surfacing, budget row, failed-read fixes | Section 3.1 | F-B-01, F-B-04, F-E-01, F-A-02, F-A-04 | Not duplicated here |

**Not registered (no [NEW] label in findings; mentioned for completeness):** letter request by employee (no route; Section 3.2 candidate), payslips (design preview only), task comment mentions and deadline notices (F-B-16, usability), approval delegation or reassignment (F-E-07: changes who may approve, owner decision, Section 3.1/2).

**Conflicts between source findings and how resolved:**
1. A (F-A-14, F-A-15) rates the notices inbox and CEO list LB; E, B and G rate related items LI/improvement. Resolved by the rubric: the LB handoffs are the targeted Section 3.1 defects; the general inbox and list are LI.
2. A (F-A-14) says slice one needs "no migration for project/budget types if F-A-10's filter is widened". The filter is inside the SQL function `proj_my_notifications` (`PRJ4:902-918`), so widening it for non-participants is a migration. Right: interface only for Projects participants; migration for Finance, Sales-only and CEO viewers.
3. G (F-G-10) rates departments LB "if used on day one"; code shows optional use, so LI with a hosted check. Unresolved: whether hosted departments rows exist.
4. G (F-G-17) option (a) composes existing grants for a "Executive pack"; A (Q1) suggests granting CEO read grants. Both are access grants; recorded together as owner decision N-22 without a recommendation.
5. B (F-B-04) states notices are visible only in My Work; verified here that the handover accepted notice is additionally dropped by the participant filter for a Sales owner (see N-01).

**Owner decisions collected from this part:** which events notify and the ageing thresholds (N-01, N-02, N-08); Section 6 questions for N-03/N-04 (numbering company, who acknowledges when the PM is unavailable, whether a discrepancy ever changes stock, PDF storage model, letterhead); staff directory for ordinary staff (N-07); who declares a file "current reference" (N-09); claim project tags (N-18); read-only visibility (N-22); contingency/VAT (N-23); policy acknowledgement and approval-workflow editor (N-20, N-21).

**Not verified:** hosted row counts (notifications, departments), Vercel cron history, whether PDF fonts are traced into the deployment, `proj_is_pm` time-zone behaviour.


---

# 4. Role and navigation matrix

Code is the authority (`/home/user/hr-engine` at 76c121b). Nothing here was run against a hosted system. "Confirmed (code)" means the reasoning was checked against code or SQL, not executed.

**Conventions used in this section**

* Source IDs: `F-A-nn` (My Day / nav / search), `F-B-nn` (Sales + Projects), `F-C-nn` (Inventory), `F-E-nn` (Budget), `F-F-nn` (People & HR; the investigator file writes these `F-people-hr-nn`), `F-G-nn` (People & Access / permissions). Register IDs (`D-/U-/N-`) are the final ones from Section 3; where this section points to the register it uses those IDs in square brackets, and 4.6 maps the working names used while drafting.
* Navigation levels (what the code does TODAY, `buildNavModules` in `apps/web/src/components/nav/nav-groups.ts`, rendered by `sidebar-nav.tsx:117`):
  * **P** Primary: a sidebar row or a sidebar sub-link.
  * **S** Secondary: `secondary: true`. Not in the sidebar; found only by the command palette (`command-palette.tsx`, which matches page labels only) and by links on other pages.
  * **C** Contextual only: a button, tab, row link or notification link on another page. Not in the sidebar, not in the palette.
  * **H** Hidden: no link for that persona anywhere. The URL may still work; section 4.3 says what then stops it.
* Verification labels as in the rules: **Confirmed (code)**, **Confirmed (code, hosted state unverified)**, **Needs runtime confirmation**.
* The real output of `buildNavModules` for 17 combinations is in `findings/nav-matrix-raw.txt`; I added 13 more combinations in `findings/nav-matrix-extra.txt` (script `scratchpad/navmatrix2.ts`, read-only). Every nav cell below is from those outputs.

---

## 4.1 How access really works

### 4.1.1 The rules in one page

1. **There is no single permission system.** Access comes from three independent places: (a) HR roles in `user_roles`, given only by a System Administrator; (b) four company-scoped module grant tables, each given by that module's own founder or access manager; (c) relationships that exist in the data and are evaluated at read time (project manager, member, team head, line manager through `employees.manager_id`, the login linked to an employee record).
2. **Nothing implies anything across these.** An HR role never gives module access; a module founder never gives an HR role; Sales does not give Projects; the HR role `finance` is not the Budget grant `finance`; a title such as CEO or Finance gives nothing in Budget (`supabase/migrations/20261210000000`, RLS test `project_budget.rls.test.ts:173`). The System Administrator holds no module access and cannot grant any (G 4.2).
3. **Job titles are not permissions.** `employees.job_title` is read by no policy. "Department head" in the app means one of two things: the head of a project team (`proj_teams.head_user_id`) or the line manager of someone (`employees.manager_id`). HR departments have no head (F-G-10, G 4.1 C). The HR role `employee` is read by nothing; being an employee means the login is linked to an employee record (`employees.user_id`, `current_employee_id()`).
4. **Navigation is cosmetic.** Every nav gate shapes what is offered. The real gates are: page or layout check, server action check, row policy (RLS) and SECURITY DEFINER function checks. Hiding a link never protects data (4.3).
5. **A person with several responsibilities holds the union**, computed per company for module grants and per project for relationships. No combination creates a new right; the only "combination" effects are independence rules (a Finance person's own budget goes to a CEO/CTO approver; nobody decides their own request).

### 4.1.2 HR roles and scopes (`user_roles`, given by System Administrator only)

| Role (label) | Scope | What it really gives | Does not give |
|---|---|---|---|
| `sys_admin` (System Administrator) | unscoped | Invite, resend, delete accounts; deactivate/reactivate; password reset; give and revoke HR roles; companies; AI Suggestions queue (read); read every employee row in every company, cannot edit (F-F-24); read system audit (`companies`, `user_roles`, profile status) | Any module access; HR content; can grant itself any HR role with no second person (F-G-03, existing separately-governed behaviour: reported, not redesigned) |
| `hr_admin` (HR Admin) | per company, or all | Employee master data, contracts, compensation, identity documents, leave and attendance administration, assets, letters, departments, link login to employee, job title/department/manager (People & Access Job tab), alerts, audit log (11 tables of that company), AI Suggestions (any-scope: cross-company, F-F-11) | Invite, deactivate, reset, give roles. **Policies and holidays need an unscoped (all companies) HR Admin**: a company-scoped HR Admin sees active policies only and has no buttons (F 4.1, style 2: `has_role('hr_admin', null, country)`) |
| `finance` (Finance, HR sense) | per company | Compensation, loans, payroll export runs (writes), reimbursement approver (`role:finance`), asset register read, company employee list | Project budgets (that is Budget `finance`, a separate grant) |
| `ceo` / `cto` (peers) | per company, or all | Read employees, contracts, payroll runs, alerts (not identity documents, F-G-16), HR overview on My Day, approver for `role:ceo` steps, letter sign-off, activate (not edit) policies | Compensation details; attendance register rows; recovery-credit request rows unless in chain (F-F-03); module access; Budget approval (needs the explicit Budget `executive_approver` grant) |
| `line_manager` (Reporting Manager) | per company | **A flag, not the relationship.** Drives the "Approvals" nav row and how the person's OWN recovery requests route | Anything about reports: report visibility and approver-of-record come from `employees.manager_id` (`is_manager_of`, chain), not from this role |
| `employee` | any | Nothing (no policy reads it) | Everything |

Scope rule: `has_role(role, company, country)` matches a grant only if the grant's company and country are null or equal; if the caller passes no scope only unscoped grants match. Nav gates use `hasRoleAnyScope`, so a company-A HR Admin gets nav links whose pages return only company-A rows (correct, no leak).

### 4.1.3 The four module grant tables (all: one active row per person per company; `capabilities text[]`; empty = "basic")

| Module / table | Basic grant (no capability) gives | Capabilities | Who grants |
|---|---|---|---|
| Sales `crm_company_grants` | Read ALL enquiries, follow-ups, proposals, files of that company; create enquiries; edit only own; read ALL organisations and contacts of ALL companies (F-B-21) | `founder` (everything incl. commercial approval), `assign_owner`, `confirm_availability`, `manage_settings`, `manage_approval_rules`, `manage_access`, `view_audit`, `reopen_closed` | Sales founder (any); `manage_access` holder (non-founder, non-access rights) |
| Projects `proj_company_grants` | Directory of live projects (summary only). **Precondition to be named PM, member, team head or acting PM** (`proj_user_eligible`) | `founder` (every project, manage, delegate), `assign_pm` (name PM, create internal projects, link Sales people), `approve_scope`, `view_commercial`, `view_audit`, `reopen_project`, `override_site_conflict`, `manage_access` | Projects founder; `manage_access` holder (cannot revoke a live PM or team head) |
| Inventory `inv_company_grants` | Catalogue summary (names, categories, usable counts) | `founder`, `warehouse` (operate at assigned locations, implies stock read), `cross_location`, `view_stock`, `view_costs` (founder gives only), `view_audit`, `confirm_stock`, `manage_catalogue`, `request_for_employees`, `view_employee_custody`, `manage_access` | Inventory founder; `manage_access` holder |
| Budget `pbx_company_grants` (no founder concept) | Nothing. `manage_access` alone gives no read. "Any access" = `finance`, `view` or `executive_approver` | `finance` (read all company budgets, funds, receipts, payments, rates, close; decides budgets submitted by PMs WITHOUT Finance), `executive_approver` (decides what was submitted by someone WITH Finance; confirms receipts; authorises such closures), `view`, `manage_access` (R1: only an approver adds/removes the approver right) | Any `manage_access` holder; first approver by owner-run SQL only |

Presets in `packages/domain/src/peopleAccess.ts` only add capabilities; none removes. There is **no preset** called Project Manager, Technician, Programmer, Marketing, Operations or Event staff (F-G-09).

### 4.1.4 Relationships that act as permissions (no grant row)

| Relationship | Source | Gives | Enforced by | Nav sees it? |
|---|---|---|---|---|
| Project Manager | `proj_projects.pm_user_id` (+ `pm` member row), still eligible | Manage project; create, edit, submit the project budget and read it; request equipment for the project; accept handover; appoint acting PM | `proj_is_pm`, `proj_can_manage`, `pbx_require_pm`, `inv_can_edit_request` | Yes (`managesProjects` = `pm_user_id` only) |
| Acting PM | member row `acting_pm`, `acting_until >= current_date` | PM's project, budget and equipment powers (not appoint/name PM) | same | **No** (F-G-05) |
| Project member | active member row + Projects grant | Details, tasks, discussion, own-task updates, equipment requests of that project | `proj_can_view_details` | Via Projects grant only |
| Team head (a member who heads a project team) | `proj_teams.head_user_id`, live project | Review and distribute tasks inside the team; browse the Inventory catalogue (RLS) | `proj_is_team_head`, `inv_can_browse` | **No Inventory nav** (F-G-05); no write path for requests |
| Sales-linked | `proj_sales_links` + still holds a Sales grant | Project summary and handover status; details only if the PM also adds them as member (F-B-05) | `proj_sales_linked` | Projects row with one link "Projects" |
| Line manager | `employees.manager_id` chain, `is_manager_of()` | Reports' rows, current contract, leave, attendance, assets; approver of record for reports; may create an equipment request for a report in SQL (UI never offers it) | RLS, `resolve_approver` | Approvals row only if role `line_manager` or something pending |
| Employee-linked account | `employees.user_id` | Own profile, leave, claims, compensation, letters, clock, My equipment | `current_employee_id()`, `inv_my_equipment()` | Yes |
| Opportunity owner / assignee | `crm_opportunities.owner_id` etc. | Edit, stage moves, proposals, own follow-ups | `crm_require_owner_or_founder` | Via Sales grant |
| Budget preparer / submitter | `created_by`, `submitted_by` | **Excluded** from deciding, confirming, closing that item | `pbx_decide_budget`, triggers | n/a |

### 4.1.5 People with no role or preset today

| Persona | What they are today (exact) | Sufficient? |
|---|---|---|
| **Programmer / content / engineer** | Ordinary employee + Projects `projects-basic` ("Directory only", empty capability list) + member of the projects they work on. Sidebar identical to the Technician and Marketing rows (raw output). Details, tasks, discussion of their projects; own tasks; no Inventory beyond My equipment; no Sales | **Yes for task work.** Friction: invisible to PMs until the grant exists (grant = 3 interactions, F-G-09); the Projects row hides if the grant is missing and the person cannot be given a task |
| **Technician** | Identical grants to the above. Sees equipment issued to them under My equipment. Cannot see stock, cannot confirm a return (needs `warehouse` + locations) | **Yes for site tasks; owner decision** whether technicians receive returns or only the storekeeper does (G 6B). No grant is needed to be issued kit |
| **Marketing** | Same as Programmer/content. Internal marketing projects need a founder or `assign_pm` holder to create them (F-B-22) | **Yes for projects. No if Marketing needs enquiries/contacts/pipeline**: there is no read-only Sales grant; `sales-basic` also lets them create and own enquiries and reads every company's contacts. Owner decision (G Q2) |
| **Operations** | As modelled in the raw output: employee + member + `view_stock`. Real coordinators would also need `projects-coordinator` (`assign_pm`, `reopen_project`, `override_site_conflict`) and `sales-availability`; "see every project's details" needs `projects-founder`, which also manages access and approves scope (F-G-17) | **No** unless the owner picks the coordinator preset or founder. With the coordinator preset the nav shows Sales, Projects (+ New internal project, Handovers) and Inventory Today/Stock/History (`nav-matrix-extra.txt`, last-but-one persona) |

### 4.1.6 Defects that change how this section reads

* Role/employee lookup failure shows "no role / no employee record" and drops sidebar items (F-A-01, F-G-13, F-F-02). Same root as `docs/known-issues/people-access-outage-message.md` (cross-reference only).
* Nav says "project manager / department head" for Inventory but checks `pm_user_id` only (F-G-05, F-A-20, F-C role matrix). **Confirmed (code)**.
* Deactivation does not set `profiles.is_active`, so a deactivated person still counts as eligible PM, approver of record and last executive approver (F-G-01). **Confirmed (code)**.
* The user menu prints "No role assigned" for ordinary staff and module-only people (F-G-07).

---

## 4.2 The matrix

### 4.2.1 Persona definitions (exactly what the matrices model)

| Code | Persona | Grants modelled |
|---|---|---|
| EMP | Ordinary employee | Linked employee record only. No role, no module grant |
| ENG | Programmer / content / engineer | EMP + Projects basic + member of a project |
| TEC | Technician | Identical to ENG (no technician grant exists) |
| DH | Department head | `line_manager` role + Projects basic + member/team head + Inventory `request_for_employees` |
| PM | Project Manager | `line_manager` role + Projects basic + named PM of a live project; no Inventory grant |
| SAL | Sales | Sales basic |
| MKT | Marketing | Identical to ENG |
| WH | Warehouse operator | Inventory `warehouse` (+ assigned locations) |
| OPS | Operations (as modelled) | EMP + Projects basic + member + Inventory `view_stock` |
| FIN | Finance | HR role `finance` + Budget `finance` |
| HR | HR | HR role `hr_admin` (unscoped) |
| SYS | System Administrator | `sys_admin` only; no employee record; no module grants |
| CEO | CEO / CTO | `ceo` role + `founder` in Sales, Projects, Inventory + a Budget grant (the raw run set `any: true, manageAccess: true`; see note 14 under 4.2.2) |

### 4.2.2 Navigation level today, per destination and persona

Cell = P, S, C or H as defined above. A superscript points to the notes under the table. "Own" means the destination exists for the persona but shows only that person's own rows.

| # | Destination (route) | EMP | ENG | TEC | DH | PM | SAL | MKT | WH | OPS | FIN | HR | SYS | CEO |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Shell** |
| 1 | My Day `/` | P | P | P | P | P | P | P | P | P | P | P | P | P |
| 2 | Approvals `/approvals` | H¹ | H¹ | H¹ | P | P² | H¹ | H¹ | H¹ | H¹ | P | P | H¹ | P |
| 3 | Alerts bell (header, no count, hidden below `lg`) | H | H | H | H | H | H | H | H | H | H | P | H | P |
| 4 | Account & security `/account/security` (user menu) | P | P | P | P | P | P | P | P | P | P | P | P | P |
| 5 | Command palette (Ctrl/Cmd+K): pages only | P | P | P | P | P | P | P | P | P | P | P | P | P |
| **People & HR module (every persona gets this module row today)** |
| 6 | My Profile `/profile` | P | P | P | P | P | P | P | P | P | P | P | P³ | P |
| 7 | My Attendance Clock `/attendance-clock` (+ header chip, mobile tab) | P | P | P | P | P | P | P | P | P | P | P | P³ | P |
| 8 | Employees `/employees` | P(own)⁴ | P(own) | P(own) | P(team) | P(team) | P(own) | P(own) | P(own) | P(own) | P(co.) | P(co.) | P(all) | P(co.) |
| 9 | Employee record `/employees/[id]` | C | C | C | C | C | C | C | C | C | C | C | C | C |
| 10 | New employee `/employees/new` | H | H | H | H | H | H | H | H | H | H | C | H | H |
| 11 | Attendance `/attendance` | P(own) | P(own) | P(own) | P(own) | P(own) | P(own) | P(own) | P(own) | P(own) | P(own) | P(register) | P(own) | P(own) |
| 12 | Leave `/leave` (own balances and requests) | P | P | P | P | P | P | P | P | P | P | P | P | P |
| 13 | Request leave `/leave/new` | C | C | C | C | C | C | C | C | C | C | C | C | C |
| 14 | Reimbursements `/reimbursements`, `/[id]` (own claims) | P | P | P | P | P | P | P | P | P | P | P | P | P |
| 15 | Timesheets `/timesheets` (orphan) | H⁵ | H | H | H | H | H | H | H | H | H | H | H | H |
| 16 | Letters `/letters` (employee: own; HR: issue, templates) | P | P | P | P | P | P | P | P | P | P | P | P | P |
| 17 | Payroll `/payroll`, `/[id]` | H | H | H | H | H | H | H | H | H | P | P | H | P |
| 18 | Alerts `/alerts` | H | H | H | H | H | H | H | H | H | H | P | H | P |
| 19 | Assets `/assets` | H | H | H | H | H | H | H | H | H | P | P | H | H |
| 20 | Policies `/policies`, `/[id]` | P | P | P | P | P | P | P | P | P | P | P | P | P |
| 21 | Draft / activate policy (`/policies/new`, buttons on detail) | H | H | H | H | H | H | H | H | H | H | C | H | C |
| 22 | Holidays `/holidays` | P | P | P | P | P | P | P | P | P | P | P | P | P |
| 23 | Add or delete a holiday (form on `/holidays`) | H | H | H | H | H | H | H | H | H | H | C | H | H |
| 24 | Performance `/performance` (module "KPIs & Performance", link "Performance reviews (HR)") | P | P | P | P | P | P | P | P | P | P | P | P | P |
| 25 | Manage performance cycles `/performance/cycles` | H | H | H | H | H | H | H | H | H | H | C | H | H |
| 26 | AI Suggestions `/ai-suggestions` | H | H | H | H | H | H | H | H | H | H | P | P | H |
| 27 | Audit Log `/audit-log` | H | H | H | H | H | H | H | H | H | H | P | P | H |
| 28 | Companies `/admin/companies` | H | H | H | H | H | H | H | H | H | H | H | P | H |
| 29 | People & Access `/people-access` | H⁶ | H⁶ | H⁶ | H⁶ | H⁶ | H⁶ | H⁶ | H⁶ | H⁶ | H⁶ | P | P | P |
| 30 | People & Access: Company settings view, Invite a person | H | H | H | H | H | H | H | H | H | H | H | C | C |
| **Sales & CRM (row only with a Sales grant)** |
| 31 | Follow-ups `/sales/follow-ups`, Enquiries, Reports | H | H | H | H | H | P | H | H | H | H | H | H | P |
| 32 | New enquiry, Clients & contacts, Proposals & quotes, Pipeline board | H | H | H | H | H | S | H | H | H | H | H | H | S |
| 33 | Sales Settings `/sales/settings` (Manage) | H | H | H | H | H | H⁷ | H | H | H | H | H | H | P |
| 34 | Enquiry detail, close, handover `/sales/opportunities/[id]/*` | H | H | H | H | H | C | H | H | H | H | H | H | C |
| **Projects & Tasks (row only with a Projects grant or a Sales link)** |
| 35 | My Work, Projects, Calendar | H | P | P | P | P | H⁸ | P | H | P | H | H | H | P |
| 36 | New internal project `/projects/new` | H | H | H | H | H | H | H | H | H | H | H | H | S |
| 37 | Handovers `/projects/handovers` (Manage) | H | H | H | H | H⁹ | H | H | H | H | H | H | H | P |
| 38 | Project workspace `/projects/[id]/*` (tabs Work, Timeline, Discussion, Equipment) | H | C | C | C | C | H | C | H | C | H | H | H | C |
| 39 | Project Budget tab `/projects/[id]/budget` | H | H | H | H | C | H | H | H | H | H | H | H | C |
| 40 | Manage project menu (People, Changes, Files, History, Complete) | H | C¹⁰ | C¹⁰ | C¹⁰ | C | H | C¹⁰ | H | C¹⁰ | H | H | H | C |
| **Inventory (row for any grant, PM of a live project, or linked employee)** |
| 41 | Today `/inventory` | H | H | H | P | H | H | H | P | P | H | H | H | P |
| 42 | Stock `/inventory/stock` | H | H | H | P | P | H | H | P | P | H | H | H | P |
| 43 | History `/inventory/history` | H | H | H | H | H | H | H | P | P | H | H | H | P |
| 44 | Requests `/inventory/requests` | H | H | H | S | P | H | H | S | S | H | H | H | S |
| 45 | Request workspace `/inventory/requests/[id]` | H | H | H | C | C | H | H | C | C | H | H | H | C |
| 46 | My equipment `/inventory/mine` | P | P | P | S | S | P | P | S | S | P | P | H¹¹ | S |
| 47 | Scan a label `/inventory/stock?action=scan`, labels `/inventory/labels` | H | H | H | S | S | H | H | S | S | H | H | H | S |
| 48 | Equipment held by people `/inventory/stock?view=people` | H | H | H | H | H | H | H | S | H | H | H | H | S |
| 49 | Setup `/inventory/manage` (Manage) | H | H | H | H | H | H | H | H¹² | H | H | H | H | P |
| **Finance (row only with a Budget finance/view/executive_approver grant)** |
| 50 | Project budgets inbox `/finance/project-budgets` | H | H | H | H | H | H | H | H | H | P | H | H | P |
| 51 | Budget record `/finance/project-budgets/[projectId]` | H | H | H | H | H¹³ | H | H | H | H | C | H | H | C |
| **Not-yet-built rows** |
| 52 | Vendors & Purchasing (muted "Coming soon" row, no link) | row | row | row | row | row | row | row | row | row | row | row | row | row |
| 53 | KPIs (muted "KPIs soon" under KPIs & Performance) | row | row | row | row | row | row | row | row | row | row | row | row | row |
| 54 | Inventory "Coming soon" row (shown when no Inventory entry applies) | H | H | H | H | H | H | H | H | H | H | H | row | H |

Notes.

1. P whenever an approval is waiting on the person (`approver_id = me`), for example a project lead on a Recovery Leave step. If that count read fails the row disappears (F-A-02). A line manager by `manager_id` without the `line_manager` role and nothing pending has no row (G 4.3 item 2).
2. P only because this persona carries the `line_manager` role; a PM without that role and nothing waiting has no Approvals row.
3. SYS has no employee record in the raw run: the links show but the pages say the record does not exist, and there is no clock chip.
4. For EMP the page is a one-row list of themselves ("You and the people who report to you."): `employees_select` RLS. It is not a directory. **Confirmed (code)** (A 4a).
5. Orphan: no `href="/timesheets"` anywhere; URL works, own rows only (F-A-19, F-F-15). Approvals still consume timesheets.
6. Module access managers (any `manage_access` in Sales, Projects, Inventory, Budget) get P here; not modelled in the 13 personas, see combos.
7. P only if the person also holds `manage_settings` or Sales founder.
8. A Sales-linked person with no Projects grant gets a Projects row with the single link "Projects" (combos).
9. P while a handover waits on the PM (`pendingHandovers`).
10. The menu items shown depend on the person's level in that project (`lib/projects/workspace-nav.ts`); members see fewer than the PM.
11. SYS without an employee record gets the "Coming soon" Inventory row instead (`nav-groups.ts:303`).
12. A warehouse operator may open the page by URL (page allows `warehouse` or `confirm_stock`) but has no link (F-C 4).
13. The PM reaches the budget from the project tab; the Finance record route also answers for the PM (`pbx_can_read_budget_header`).
14. Raw CEO run: a real CEO needs Budget `executive_approver` (preset `budget-approver`) to read or decide; a title alone gives nothing and `manage_access` alone gives no read and no Finance row.

### 4.2.3 Combination matrix (people holding several responsibilities)

All rows from `nav-matrix-raw.txt` or `nav-matrix-extra.txt` (real `buildNavModules`). "Sidebar modules" excludes the two permanent "coming soon" rows and KPIs & Performance, which every row also has.

| Combination | Sidebar modules and entry points today | What the combination adds or breaks | Source |
|---|---|---|---|
| PM + Sales | My Day, Approvals*, Sales (`/sales/follow-ups`), People & HR, Projects (`/projects`), Inventory (`/inventory/requests`: Stock, Requests) | Two independent grants; nothing extra inside a project. Same person can prepare and accept the handover (G Q6, not proposed to change). *Approvals only via `line_manager` | raw COMBO |
| Warehouse + employee/project member | My Day, People & HR, Projects (`/projects/work`), Inventory (`/inventory`: Today, Stock, History; palette: Requests, My equipment, Scan, Held by people) | Inventory entry becomes Today; My equipment drops to palette-only | raw COMBO |
| Finance + PM | My Day, Approvals, People & HR (adds Payroll, Assets), Projects (`/projects`), Inventory (`/inventory/requests`), Finance (`/finance/project-budgets`) | Own budget and final expenses route to a CEO/CTO approver; may decide other PMs' submissions; if no independent approver exists the item is "on hold" (`pbx_approval_on_hold`) | raw COMBO, G 5.4 |
| Dept head + PM | Approvals, Projects (`/projects`), Inventory (`/inventory`: Today, Stock; palette Requests, My equipment, Scan) | Team head on project B has no Inventory nav on that basis; PM on project A does (F-G-05) | extra |
| HR + line manager | Approvals, People & HR with Alerts, Letters, Payroll, Assets, Policies, Holidays, AI Suggestions, Audit Log, People & Access | No team group appears; own recovery requests route to the CEO/CTO queue because they hold `hr_admin` | raw COMBO, G 6B |
| CEO + Finance (HR role finance + Budget finance + executive approver) | One People & HR block (adds Assets), one Finance row; Sales, Projects, Inventory rows as founder | Two meanings of "Finance" in one person (HR role vs Budget grant, F-G-19); own Finance submissions need a second independent approver | extra |
| CEO role only (no module grants) | My Day, Approvals, People & HR (Alerts, Payroll), no module rows | Sees only the HR half of My Day; no projects, pipeline, stock, budgets (F-A-15, F-G-17) | extra |
| Finance HR-role only | Approvals, People & HR (Payroll, Assets), no Finance row | No budget access | extra |
| Budget finance grant only | Finance row, no Approvals, no Payroll, no Assets | No HR finance functions. Two grants by two different people | extra |
| Acting PM / team head only (no `pm_user_id`) | Projects (`/projects/work`), Inventory: My equipment only | **Database allows catalogue browsing and acting-PM equipment requests; nav and `/inventory/stock` say "You do not have Inventory access"** (F-G-05) | extra |
| Line manager only | Approvals, People & HR; no team view anywhere | Reports reachable only one profile at a time (F-F-07, F-A-17) | extra |
| Sales-linked only (Sales grant, no Projects grant) | Sales, Projects (single link "Projects") | Summary level only; details only if the PM adds them as member (F-B-05) | extra |
| Operations coordinator (Sales `confirm_availability` + Projects `assign_pm`/`reopen_project`/`override_site_conflict` + Inventory `view_stock`) | Sales, Projects (`/projects`, New internal project\*, Handovers), Inventory (Today, Stock, History) | Cannot read all project details without `founder` (F-G-17) | extra |
| Module access manager only (Projects `manage_access`) | Projects, People & HR with "Access: People & Access" | Sees Module access cards for that module only | extra |
| Sales + warehouse | Sales, Inventory (Today, Stock, History, ...) | None | extra |
| Sys Admin + HR | Approvals, People & HR with Companies, AI, Audit, People & Access | Still no module access | extra |
| Account with no employee record (SYS) | People & HR, Inventory "Coming soon" | Personal pages say no record exists | raw/extra |

### 4.2.4 What each persona may do: R / C / E / A / M and what enforces it

Legend: **R** read, **C** create, **E** edit, **A** approve or decide, **M** manage (grant, assign, configure). Suffix: `o` own records, `t` reports (manager chain), `p` projects the person belongs to or leads, `c` company or companies where granted, `a` assigned locations, `s` summary or counts only, `–` none. ENG, TEC and MKT are one column: they are identical in every cell by construction (no grant distinguishes them). Notation in "Grants needed": `HR:` HR role, `SALES:`, `PROJ:`, `INV:`, `PBX:` module grant, `REL:` relationship.

| # | Area / action | EMP | ENG TEC MKT | DH | PM | SAL | WH | OPS | FIN | HR | SYS | CEO | Grants needed | Enforced by |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **People & HR** |
| 1 | Own profile, leave, claims, goals, letters issued, attendance record, clock, My equipment | Ro Co Eo¹ | same | same | same | same | same | same | same | same | – | same | REL: linked employee | RLS `current_employee_id()`; `submit_leave_request`; `employees_update_self` + `employees_guard_self_update`; `inv_my_equipment()` |
| 2 | Other employees' rows | –² | –² | Rt | Rt | –² | –² | –² | Rc | Rc | R (all, no edit) | Rc | REL: line manager; HR:finance/hr_admin/ceo/cto | RLS `employees_select`, `is_manager_of` |
| 3 | Employee master data: create, edit, contracts, documents, departments, link login, job title/manager | – | – | – | – | – | – | – | – | Cc Ec M(link) | – | – | HR:hr_admin(company) | RLS `employees_insert_hr`/`update_hr`; `updateJobDetails`; `linkEmployeeToUser` |
| 4 | Current contract of others | – | – | Rt | Rt | – | – | – | Rc | Rc Ec | – | Rc | as row 2 | RLS `employment_contracts_select` |
| 5 | Compensation, loans, insurance, career events | – | – | – | – | – | – | – | Rc | Rc Ec | – | – | HR:finance or hr_admin | RLS per table |
| 6 | Identity documents | – | – | – | – | – | – | – | – | Rc Ec | – | – (RLS excludes CEO/CTO) | HR:hr_admin | RLS `identity_documents` |
| 7 | Leave and Recovery requests of others | – | – | Rt | Rt | – | – | – | Rc | Rc | – | Rc³ | REL: manager; HR roles | RLS `leave_requests_select`; `recovery_credit_requests_select` (no CEO/CTO branch, F-F-03) |
| 8 | Decide approvals (leave, claim, timesheet, letter, payroll, recovery) | A(named)⁴ | A(named)⁴ | At | At | A(named)⁴ | A(named)⁴ | A(named)⁴ | Ac (reimbursements) | Ac (queue) | – | Ac (`role:ceo`) | REL: approver of record (`manager_id`); HR:role route | SECURITY DEFINER `decide_leave_approval`, `decide_recovery_credit_request`; `resolve_approver`; nobody decides their own |
| 9 | Attendance register (read, correct, close, add missing) | Ro | Ro | Rt | Rt | Ro | Ro | Ro | Ro | Rc Ec | Ro | Ro | HR:hr_admin; REL: manager | RLS `attendance_select`; `hr_*` RPCs |
| 10 | Payroll export runs | – | – | – | – | – | – | – | Rc Cc Ec | Rc A⁵ | – | Rc A⁵ | HR:finance (writes); hr_admin/ceo/cto (read) | RLS `payroll_runs_*`; `resolve_approver_for_company` |
| 11 | Letters: issue, templates, sign-off | Ro (any status today, F-F-05) | Ro | Ro | Ro | Ro | Ro | Ro | Ro | Cc Ec Rc | – | Rc A | HR:hr_admin (issue); ceo/cto (sign-off) | RLS `generated_letters_*`; storage `letters_select` (no status test, F-F-05) |
| 12 | Asset register | – | – | – | – | – | – | – | Rc | Rc Cc Ec | – | – | HR:hr_admin or finance | RLS `assets_*` |
| 13 | Policies: read active | R | R | R | R | R | R | R | R | R | R | R | any signed-in | RLS `policy_versions_select` (active only) |
| 14 | Policies: draft, edit, activate, seed Recovery windows | – | – | – | – | – | – | – | – | C E A M⁶ | – | A⁶ (read drafts, no content edit) | HR:hr_admin **unscoped**; ceo/cto | RLS `policy_versions_*` + `guard_policy_version_update` (drafter cannot activate); SECURITY DEFINER `activate_recovery_windows_policy` |
| 15 | Holidays: read all countries; add, delete | R | R | R | R | R | R | R | R | R C E⁶ | R | R | HR:hr_admin **unscoped** (write) | RLS `public_holidays_select/write` |
| 16 | Alerts | – | – | – | – | – | – | – | – | Rc (ack recovery) | – | Rc (no identity docs) | HR:hr_admin/ceo/cto | page `canViewHrAlerts` + per-table RLS |
| 17 | Audit log | – | – | – | – | – | – | – | – | Rc | R (system tables) | – | HR:hr_admin; sys_admin | page `canViewAuditLog`; RLS `audit_log_select_hr/_sysadmin` |
| 18 | AI Suggestions | – | – | – | – | – | – | – | – | R A⁷ | R (cannot act) | – | HR:hr_admin; sys_admin | page `canReviewAiDrafts`; RLS `ai_drafts_select/update` any-scope (F-F-11) |
| 19 | Companies | – | – | – | – | – | – | – | – | – | C E M | – | HR:sys_admin | `/admin` layout; RLS `companies_write` |
| 20 | Accounts and HR roles (invite, deactivate, reset, give or revoke role) | – | – | – | – | – | – | – | – | – | C M | – | HR:sys_admin | `isSysAdmin` + admin client; RLS `user_roles_insert_sysadmin`; `revoke_role_grant`, `set_account_status` |
| 21 | Module access (People & Access) | – | – | – | – | – | – | – | – | – | – | M (Sales, Projects, Inventory as founder; Budget if `manage_access`) | module `founder` or `manage_access` | `*_grant_access` / `*_revoke_access` functions, R1, R2, R3 |
| **Sales** |
| 22 | Enquiries, follow-ups, proposals of the company | – | – | – | – | Rc Cc Eo | – | – | – | – | – | Rc Cc Ec A M | SALES:basic / founder | RLS `crm_has_access(company)`; `crm_require_owner_or_founder` |
| 23 | Organisations and contacts | – | – | – | – | R(all companies) C E | – | – | – | – | – | R(all) C E | SALES:basic | RLS `crm_has_any_access()` (cross-company, F-B-21) |
| 24 | Decide commercial approval | – | – | – | – | – | – | – | – | – | – | A⁸ | SALES:founder | `crm_decide_approval` |
| 25 | Prepare and submit handover to Projects | – | – | – | – | Eo (own Won) | – | – | – | – | – | Ec | owner or SALES:founder | `proj_save_handover`, `proj_submit_handover` |
| 26 | Sales settings and rules | – | – | – | – | – | – | – | – | – | – | M | SALES:manage_settings/founder | `crm_upsert_settings` |
| **Projects** |
| 27 | Project directory (summary) | – | Rs | Rs | Rs | – | – | Rs | – | – | – | Rc | PROJ:basic | RLS `proj_can_view_summary` |
| 28 | Project details, tasks, discussion, files | – | Rp | Rp | Rp | – | – | Rp | – | – | – | Rc | REL: member/PM/head; PROJ:founder | RLS `proj_can_view_details` |
| 29 | Tasks: create, edit, block, comment | – | Co Eo | C E (team)⁹ | C E p | – | – | Co Eo | – | – | – | C E c | REL: member; head; PM | `proj_create_task`, `proj_update_task`, `proj_block_task` |
| 30 | Manage project (people, scope proposals, milestones, bookings, status, complete) | – | – | – | E M p | – | – | – | – | – | – | E M c | REL: PM/acting PM; PROJ:founder | `proj_can_manage` + functions |
| 31 | Name PM, create internal project, link Sales people | – | – | – | – | – | – | –¹⁰ | – | – | – | M | PROJ:assign_pm/founder | `proj_assign_pm`, `proj_create_internal_project` |
| 32 | Decide scope change; read its cost effect | – | – | – | – | – | – | – | – | – | – | A R | PROJ:approve_scope, view_commercial / founder | FN `proj_decide_scope_change`; RLS `proj_scope_change_commercial_select` |
| 33 | Accept handover (creates project) | – | – | – | A p (named) | – | – | – | – | – | – | – (reads only) | REL: named PM | `proj_accept_handover` |
| **Inventory** |
| 34 | Catalogue summary and availability counts | – | – | Rs | Rs | – | Rc | Rc | – | – | – | Rc | INV:any grant; REL: PM, acting PM, live team head (RLS only) | RLS `inv_can_browse`, `inv_availability` |
| 35 | Units, balances, movements, costs | – | – | – | – | – | Rc | Rc | – | – | – | Rc (costs: founder) | INV:warehouse or view_stock; view_costs | RLS `inv_can_view_stock`, `inv_costs_select` |
| 36 | Operate stock (receive, issue, return, transfer, count) | – | – | – | – | – | E a | – | – | – | – | E c | INV:warehouse@location / cross_location / founder | `inv_loc()` -> `inv_can_operate` on every movement function |
| 37 | Equipment requests | – | – | C (for employees, own) | C E p | – | C E c | – | – | – | – | C E c | PM; INV:warehouse; INV:request_for_employees | `inv_can_edit_request`, `inv_create_request` |
| 38 | Who holds what (custody) | – | – | – | – | – | Rc | – | – | – (needs `view_employee_custody`) | – | Rc | INV:view_employee_custody/warehouse/founder | FN `inv_employee_outstanding` |
| 39 | Setup, catalogue, confirm counts, corrections | – | – | – | – | – | – (counts by URL only) | – | – | – | – | M A | INV:manage_catalogue/confirm_stock/founder | `inv_save_*`, `inv_confirm_*`, `inv_correct_movement` |
| **Budget** |
| 40 | Own project budget and final expenses | – | – | – | C E Rp¹¹ | – | – | – | – | – | – | – | REL: PM / acting PM | `pbx_require_pm`, `pbx_can_read_budget` |
| 41 | Read all company budgets, funds, settlements | – | – | – | – | – | – | – | Rc | – | – | Rc¹² | PBX:finance/view/executive_approver | `pbx_can_view_company`, RLS `pbx_can_read_*` |
| 42 | Decide budget, addition, final expenses | – | – | – | – | – | – | – | A (PM submissions without Finance) | – | – | A (submissions by someone with Finance)¹² | PBX:finance; PBX:executive_approver | `pbx_decide_*`, trigger `pbx_version_guard`; submitter excluded |
| 43 | Record funds, receipts, payments, rates; confirm receipts; close settlement | – | – | – | – | – | – | – | C E M | – | – | A (confirm receipts, authorise closure on executive route)¹² | PBX:finance; PBX:executive_approver | `pbx_record_*`, `pbx_confirm_receipts`, `pbx_close_settlement` |
| 44 | Grant budget access | – | – | – | – | – | – | – | – | – | – | M¹² | PBX:manage_access (R1: only an approver changes the approver right) | `pbx_grant_access` |

Notes.

1. Own contact details only (personal e-mail, phone).
2. "Rt" applies to **any** persona that is someone's `manager_id` (a PM or a salesperson with reports also reads their reports); the columns show the personas as modelled.
3. Leave requests yes. Recovery request rows: no CEO/CTO read unless in the chain (F-F-03, **Needs runtime confirmation**: verify with a CEO outside the chain and an HR-applicant request pending).
4. Not a standing right: "A(named)" is when the workflow names that person, for example a project lead on step 1 of a Recovery Leave route. Nav shows Approvals only while something waits (note 1 of 4.2.2).
5. Sign-off steps and their order come from `approval_workflow_steps`; not re-read for this section. **Needs runtime confirmation.**
6. Needs an HR Admin grant with `company_id = null` (all companies). A company-scoped HR Admin can read active versions and nothing else (F 4.1).
7. HR Admin of any company sees and can attempt every company's drafts; the ledger write itself is company-checked (F-F-11).
8. Only when the company's approval policy is "required" (default `not_configured`: nothing can be requested or decided; B 4.1).
9. A head creates and reassigns tasks only inside their own team.
10. The OPS column is the "as modelled" persona; a coordinator preset would give M here (4.1.5).
11. PM may also read the budget header and versions they created after being replaced (G 5.4).
12. Needs the explicit Budget grant; the raw CEO run's `manageAccess` alone gives no read.

---

## 4.3 Direct-URL and backend enforcement audit

**Hiding is never enforcement.** The sidebar, the palette and every `secondary` flag only choose what to offer. Everything below says what actually stops a signed-in ordinary employee (EMP: employee record, no role, no grant) who types the address, and for every Contextual (C) or Hidden (H) destination which backend control applies. Where a page check exists it is a second line; the first line is always RLS or a SECURITY DEFINER function.

### 4.3.1 Routes

| Route | Nav level for EMP | What EMP gets by typing it | What enforces it | Gap (source, label) |
|---|---|---|---|---|
| `/` | P | My Day: clock card, empty Decisions | own-session queries + RLS | Failed counts read as 0 / "Nothing is waiting on you" (F-A-02, F-A-03, F-A-04). **Confirmed (code)** |
| `/profile` | P | Redirect to own `/employees/{id}`, or "HR hasn't created your employee record yet" | `session.employeeId` | On a failed read the page says no record (F-A-01). **Confirmed (code)** |
| `/employees` | P | A list containing only their own row | RLS `employees_select` (self, `is_manager_of`, HR/finance/ceo/cto of company, sys_admin all). No page check | Not a gap; nav label misleads (F-A-19). Failed read shows "No employees match" (F-F-02) |
| `/employees/[id]` (someone else) | C | 404 | RLS `employees_select`; per-tab `can*` + each child table's RLS | 404 also on a DB error (F-A-05) |
| `/employees/new` | H | Alert "You need the HR Admin role to add an employee." | page `hasRoleAnyScope(hr_admin)` + RLS `employees_insert_hr` | Wording appears on a failed role read too (F-G-13) |
| `/attendance` | P | "My Attendance": own last 60 records, read-only | page branch + RLS `attendance_select` | Copy says "HR fills this in daily" (F-F-09) |
| `/attendance-clock` | P | Own clock | SECURITY DEFINER `recovery_*`, `clock_in` | **Project-lead picker holds only the person themselves** (F-A-07 = F-F-04): `employees_select` limits the list. **Needs runtime confirmation** (sign in as an employee with no reports, Clock in with Site work). Touches the attendance flow inputs only; attendance is a protected area: no calculation change |
| `/leave`, `/leave/new` | P / C | Own balances and requests | RLS `leave_requests_select`, `submit_leave_request` | Failed read shows "Comp-off 0 days" (F-F-02) |
| `/reimbursements`, `/[id]` | P / C | Own claims; other id 404 | RLS `reimbursement_select` | None |
| `/timesheets`, `/[id]` | H (orphan) | Own timesheets | RLS `timesheets_select` | Orphan, not a security gap (F-A-19) |
| `/letters` | P | Own issued letters; no issue controls | RLS `generated_letters_select`; storage `letters_select` | **A letter still "pending approval" can be downloaded**: signed URL built for any row with `file_path`, no `status` test (`letters/page.tsx:56-64`; `lib/actions/letters.ts:84-112`). **Confirmed (code)** (F-F-05). `letter_templates_select` readable cross-company by name (low) |
| `/performance`, `/performance/appraisals/[id]` | P / C | Own goals, submitted appraisals | RLS `goals_select`, `appraisals_select` | `performance_cycles_select` is any signed-in user: cycle names of all companies readable (low) |
| `/performance/cycles` | H (C for HR) | Alert "managed by HR Admin" | page `hasRoleAnyScope(hr_admin)` + RLS `performance_cycles_write` | None |
| `/policies`, `/policies/[id]` | P | Table of ACTIVE versions for every country; detail shows a raw `Payload` JSON card | RLS `policy_versions_select`: `status = 'active'` or country-wide HR/CEO/CTO. Drafts and superseded rows are hidden by RLS (rls-test `policy_visibility.rls.test.ts`) | By design readable; not employee-ready (F-A-21, F-F-13). An `active` row with a future `effective_from` is readable (RLS tests status, not date). **Confirmed (code)** |
| `/policies/new`, draft/activate/delete | H (C for HR/CEO) | Red alert "You need an HR Admin grant scoped to a country ... see docs/02-database-schema.md §2.4." | page `canDraftPolicy`; RLS `policy_versions_insert/update/delete` (drafts only); trigger `guard_policy_version_update`; actions have no check of their own and rely on RLS (`lib/actions/policies.ts:70-100`) | Internal doc reference shown to staff (wording only) |
| `/holidays` | P | All countries' calendar; no add/delete controls | RLS `public_holidays_select` (any signed-in), `_write` (unscoped HR Admin) | `deleteHoliday` returns success when RLS removes zero rows (`lib/actions/policies.ts:164-168`); no data risk. No audit trigger for holiday or policy changes (F-F-14) |
| `/payroll`, `/[id]` | H | AccessNotice "Payroll export is restricted to HR Admin, Finance, CEO, and CTO." / 404 | page `canViewPayrollExport` + RLS `payroll_runs_select` | Own-employee read unchecked: failure says "restricted" (F-A-05). **Confirmed (code)** |
| `/assets` | H | AccessNotice | page + RLS `assets_select` | None |
| `/alerts` | H | AccessNotice "Alerts are restricted to HR Admin, CEO, and CTO." | page `canViewHrAlerts` + per-table RLS | A failed role read gives the same words (F-G-13) |
| `/audit-log` | H | AccessNotice | page `canViewAuditLog` + RLS `audit_log_select_hr/_sysadmin` | Triggers exist for tables the policy hides (F-F-14) |
| `/ai-suggestions` | H | AccessNotice | page `canReviewAiDrafts` + RLS `ai_drafts_select` | HR Admin of company A sees every company's drafts (F-F-11) |
| `/admin/companies` | H | AccessNotice "You need the System Administrator role to view this page." | `admin/layout.tsx` + RLS `companies_write` (select is open to any signed-in user) | None |
| `/people-access` | H | AccessNotice "You cannot manage people or access..." | `loadPeopleAccess` + grant-table RLS (self or `manage_access` holders only) + function checks | Known outage wording: `docs/known-issues/people-access-outage-message.md` (cross-reference only; same root as F-A-01/F-F-02) |
| `/approvals` | H (P when pending) | Page renders, empty ("Nothing waiting on you right now.") | no page gate; RLS `approvals_select` (`approver_id = me`, HR, owner); decisions in `decide_leave_approval` | 38 reads, 0 error checks: failure says "Nothing waiting on you" (F-A-05); queue-routed items not counted on My Day or nav (F-A-12) |
| `/account/security` | P (menu) | Own sign-in info, change password | `auth.getUser()` | None |
| `/sales/*` (follow-ups, opportunities, clients, proposals, reports, settings, new, `[id]`, `close`, `handover`) | H / S / C | AccessNotice "You do not have Sales access..." | `sales/layout.tsx` + RLS `crm_has_access(company)` on every `crm_*` table except organisations and contacts; writes via SECURITY DEFINER | Organisations and contacts readable by any CRM grantee of ANY company (`crm_has_any_access()`): by design, cross-company (F-B-21). Legacy `crm_update_handover` still executable by owner/founder (F-B-20) |
| `/projects`, `/projects/work`, `/projects/calendar` | H | AccessNotice "You do not have Projects access..." | `projects/layout.tsx` + RLS `proj_projects_select` | None |
| `/projects/new`, `/projects/handovers` | H / S | Notice, or an empty list | page filter by `assign_pm`; RLS `proj_handovers_select`; FN `proj_create_internal_project` | `handovers` swallows a read error as "no handovers" (F-G-13) |
| `/projects/[id]/*` (work, plan, discussion, equipment, people, changes, documents, history, complete) | C | 404 or redirect to summary | `[id]/layout.tsx` `view.level`; RLS `proj_can_view_details`; FN `proj_can_manage` | None found |
| `/projects/[id]/budget` | C | "You do not have access" | `pbx_budget_view` -> `pbx_can_read_budget_header` | None; denied and error are separate states |
| `/inventory` | H | Redirect to `/inventory/mine` | page | None |
| `/inventory/mine` | P | Own equipment; `LoadError` on failure | SECURITY DEFINER `inv_my_equipment()` | None |
| `/inventory/stock` | H | Alert "You do not have Inventory access..." | page + RLS `inv_can_browse`, `inv_can_view_stock` | **Page gate narrower than RLS**: an acting PM or live team head, whom `inv_can_browse` admits, gets the same alert (F-G-05, F-A-20). **Confirmed (code)** |
| `/inventory/history`, `/inventory/manage` | H | Alert "Movements are for people who may see stock..." / "Setup is for founders..." | page + RLS; functions `inv_*` | A warehouse operator may open `/manage` by URL (page allows `warehouse`/`confirm_stock`); no link (F-C) |
| `/inventory/requests`, `/[id]` | H | List via RLS (empty); id: "does not exist, or you do not have access" | RLS `inv_can_see_request` | The list shows no explicit no-access notice (A 4a, not verified further) |
| `/inventory/labels`, `/inventory/scan` | H / S | Empty label sheet / scanner with one safe message | RLS on `inv_units`, `inv_balances`; `resolveScan` | No page gate by design; relies wholly on RLS, which is correct (G 4.4) |
| `/finance/project-budgets`, `/[projectId]` | H / C | AccessNotice "You do not have access to project budgets..." | RPC `pbx_inbox`, `pbx_budget_view` (grants) | None; `LoadError` handled |
| `/api/reports/headcount` | H | CSV of what RLS lets the caller list (self and reports) | session only; RLS | Button hidden only, but data identical to `/employees` (low) |
| `/api/cron/*`, `/api/ai/detect-balance-discrepancies` | H | A request without a session cookie is redirected to `/login` by `proxy.ts` before the route runs | `isAuthorizedCronRequest` (Bearer `CRON_SECRET`), unreachable | **Only `/api/cron/crm-reminders` is allowed past sign-in** (`proxy.ts:16`, comment says the older routes were "deliberately left exactly as they were"). So leave accrual, comp-day expiry, document expiry, balance AI and recovery safety-net very likely do not run (F-F-01; A 4a; `docs/crm-deployment.md:99`). **Confirmed (code, hosted state unverified)**: check Vercel Cron run history (a 307 = not running) or `select max(txn_date) from leave_ledger where reference_type='policy_run'`. Do NOT change any accrual rule. |
| `/os-preview/*` | H | 404 in Production | `os-preview/layout.tsx` fail-closed | None |

### 4.3.2 Exposures that have no route (data reachable through the API)

| Exposure | What a no-grant employee can do | Enforcement today | Gap and label |
|---|---|---|---|
| `preflight_phase2b_v2_policy_status()` | Call the function over PostgREST and read `critical_values` (accrual rates, max balance, carry-over, payload) of the seeded v2 DRAFT policies, for AE, SA, PL | None: SECURITY DEFINER, `language sql`, no `has_role` test, no `revoke` anywhere in migrations (`20261103000000_phase2b_v2_policy_drafts.sql:333-382`). The Policies page calls it for every viewer (`policies/page.tsx:30`) | **Defect, Confirmed (code, hosted state unverified)** (F-A-08). Check: `select has_function_privilege('anon','public.preflight_phase2b_v2_policy_status()','execute'), has_function_privilege('authenticated','public.preflight_phase2b_v2_policy_status()','execute');`. Draft = not-yet-adopted company policy. Fix does not change any rule |
| `profiles` table | Read every profile: e-mail, name, `account_status`, **`status_reason`** (free-text reason for deactivation), `status_changed_by/at` | RLS `profiles_select using (auth.role() = 'authenticated')` (`20260922000000_phase0_foundations.sql:274`); the 20261104 migration added the sensitive columns to the same table and did not narrow the policy | **Defect, Confirmed (code, hosted state unverified: column-level privileges not checked)** (F-G-04). Check as a non-admin session: `select status_reason from profiles where status_reason is not null limit 1;` |
| Letter file while pending approval | Download the PDF of a salary/employment letter before CEO sign-off | Storage `letters_select` has no status test; page builds the signed URL regardless | **Defect, Confirmed (code)** (F-F-05) |
| `ai_drafts` (negative-balance suggestions) | HR Admin of company A reads every company's drafts | RLS any-scope | **Defect, Confirmed (code)** (F-F-11); not reachable by EMP |
| `crm_organisations`, `crm_contacts`, `crm_staff_directory()` | Any Sales grantee reads all companies' organisations and contacts (names, e-mail, phone); staff names | `crm_has_any_access()` | By design (shared contacts) but cross-company (F-B-21); the palette must not widen it (4.5) |
| `recovery_credit_requests` read for CEO/CTO | A CEO outside the HR Admin's chain gets no card for an HR-applicant request although the database lets them decide | RLS has no CEO/CTO branch | **Defect, needs runtime confirmation** (F-F-03). Reverse of the usual problem: backend narrower than the decider |
| Deactivated person still "active" to the access model | A deactivated PM, head, approver stays eligible; stays approver of record; token validity until expiry unverified | `profiles.is_active` is never written; `resolve_approver*` ignores `account_status` | **Defect, Confirmed (code)** (F-G-01). Hosted token behaviour unverified |
| Inventory SQL broader than UI | Acting PM / line manager can create requests in SQL; UI never offers; team head has browse only | `inv_can_browse`, `proj_can_manage`, `inv_create_request` | Mismatch, **Confirmed (code)** (F-G-05, F-C) |
| Budget SQL broader than UI | Executive approver may send approved actuals back (UI shows to Finance only); `pbx_save_actuals_draft` can link any claim | `pbx_return_approved_actuals` | Mismatch, **Confirmed (code)** (F-E 4); no unintended person gains access |
| Skip-level managers | RLS lets a chain manager read leave, attendance, recovery rows of indirect reports; profile tabs show only for direct reports | `is_manager_of` (chain) vs direct-only UI | Backend broader than UI (F-F-23), low |
| System Administrator reads all employee rows | Reads every employee of every company, cannot edit | `employees_select` `has_role('sys_admin')` | Observation; relevant to search (4.5) (F-F-24) |
| Role-lookup failure | Pages and nav behave as if the person has no role | `getCurrentSession` ignores `error` | Defect, **Confirmed (code)** (F-A-01, F-G-13): fails closed, but with wrong words |

### 4.3.3 Summary: which control applies to hidden and contextual destinations

| Destination class | Control that actually applies |
|---|---|
| Own-record pages (profile, leave, claims, attendance, letters, performance, My equipment) | RLS on the person's own rows via `current_employee_id()`; `inv_my_equipment()` function |
| HR administration (payroll, assets, alerts, audit, AI, cycles, new employee, policy drafting) | RLS per table (roles in the policy) plus a page notice; page notice alone is never relied on |
| Admin (companies, accounts, HR roles) | `isSysAdmin` in the action AND RLS `companies_write`, `user_roles_insert_sysadmin`, SECURITY DEFINER `set_account_status`, `revoke_role_grant` |
| Sales, Projects, Inventory, Budget | The module's grant table in RLS and SECURITY DEFINER functions (every write is a function; tables are read-only to clients) |
| Contextual project/enquiry/request pages | Relationship checks in SQL (`proj_can_view_details`, `proj_can_manage`, `crm_has_access`, `inv_can_see_request`) |
| Orphan or palette-only routes (Timesheets, labels, scan, Pipeline board) | Same as their class: RLS. Neither "orphan" nor "secondary" changes who can read |
| `/api/cron/*` | Bearer `CRON_SECRET` inside the route, currently unreachable (F-F-01) |

---

## 4.4 Recommended "Me" experience and sidebar

Scope: interface only plus one small read (does this person have direct reports). No migration, no change to any permission, grant, approval, boundary or calculation. `buildNavModules` and its test (`nav-groups.test.ts`), `sidebar-nav.tsx`, the palette, the mobile bottom bar and the breadcrumb change; backend does not.

### 4.4.1 What is wrong today (counted)

* An ordinary employee's sidebar is 5 rows and 12 destinations (My Day + 11). Of these, **3 labels misdescribe the page**: "Employees" is a one-row list of themselves, "Attendance" is their own record, "Performance reviews (HR)" is their own goals. One row is not built ("Vendors & Purchasing") and one is half built ("KPIs & Performance": one real page, one "soon" line). Inventory is a row with one link.
* The correction to a premise: **Payroll, Assets, Alerts, AI Suggestions, Audit Log and Companies are already hidden from ordinary employees** (`nav-groups.ts:106-124`), and there is no company-wide "Leave admin" page at all (`/leave` is the person's own leave for everyone). The only company-wide People screens are `/employees` (data scoped by RLS) and the HR attendance register. So the change is truthful labels and fewer rows, not removing admin screens.
* Policies and Holidays are readable by every signed-in user and are the only place an employee sees holidays (My Day's holiday card is HR/C-level only: F-A-21), but the Policies page shows all countries and a raw JSON card.

### 4.4.2 Rules for building any person's sidebar

| # | Rule | Why |
|---|---|---|
| R1 | **One row per route per person.** If two entries open the same route, the broader-scope label wins and the other is not shown (HR sees "Letters" and "Attendance register"; they do not also see "My letters" / "My attendance record") | No duplicate groups |
| R2 | **Fixed order for everyone:** My Day, Approvals, Me, then work modules in business order **Sales & CRM, Projects & Tasks, Inventory, Finance**, then People & HR (only when the person administers or manages others), then Company information | Position never changes between people; the work modules keep today's relative order |
| R3 | **A row exists only if the person has a working destination in it.** No "Coming soon" rows; no Inventory row whose only link is My equipment (it moves to Me) | Fewer rows |
| R4 | **Scope in the label:** "My ..." for own-record pages; plain nouns for company-wide pages; "My team" for manager scope | Labels say what the page returns |
| R5 | **Row entry = the person's most useful page** (existing `entry` logic: Projects `/projects/work` unless founder/`assign_pm`/PM; Inventory `/inventory` for grantees, `/inventory/requests` for a PM) | Unchanged |
| R6 | **Sub-links appear only for the open module; `secondary` links stay palette-only; "Manage" sections stay** | Unchanged |
| R7 | **Visibility reads fail open.** If the "has reports" read (or any new nav option) fails, the entry stays visible; a hidden link must never be the result of an error | Hiding is not enforcement, but a failed read must not remove someone's route (F-A-19) |
| R8 | **People & HR shows when the person has direct reports (by `employees.manager_id`), or holds `hr_admin`, `finance`, `ceo`, `cto` or `sys_admin`, or can use People & Access** (`canUsePeopleAccess`, which includes module access managers) | Keeps People & Access reachable by exactly who can use it |

### 4.4.3 The "Me" set

Row name **Me** (row opens `/profile`, which already has tabs Overview, Employment, Compensation, Leave, Attendance, Documents, Insurance & Loans, Assets, Performance). Order inside: the landing page, then daily items, then occasional ones.

| # | Label | Opens (route, unchanged) | Replaces |
|---|---|---|---|
| 1 | My profile | `/profile` | My Profile |
| 2 | My attendance clock | `/attendance-clock` | My Attendance Clock (also kept: header chip, mobile tab, My Day card) |
| 3 | My leave | `/leave` | Leave |
| 4 | My claims | `/reimbursements` | Reimbursements |
| 5 | My equipment | `/inventory/mine` | Inventory > My equipment (single-link module row removed) |
| 6 | My attendance record | `/attendance` (shown only when the person is not an HR attendance manager, R1) | Attendance |
| 7 | My letters | `/letters` (shown only when the person cannot manage letters, R1) | Letters |
| 8 | My performance | `/performance` | KPIs & Performance > Performance reviews (HR) |

Company information row (everyone): **Holidays** `/holidays`, **Policies** `/policies`. The same pages carry HR's controls (they appear by permission), so HR and CEO/CTO keep every control with no second copy.

**Decisions**

* **Letters: keep, in Me.** It is the only place an employee downloads an issued letter, and no request-a-letter feature exists (searched in F-A 5.6). Precondition: ship F-F-05 (Download only when `status = 'issued'`) first or together, otherwise the nav promotes a path that exposes unsigned letters.
* **Reimbursements: keep, renamed "My claims".** Daily for site staff and project spenders. Finance approvers are unaffected (decisions are in Approvals).
* **Timesheets: still not linked.** Owner decision (F-A Q7, F-F-15 describes them as deprecated). If the owner keeps them, add them as a second tab inside "My claims" rather than a new row.
* **Holidays and Policies under Company information: yes, but ship the page fixes with the move** (hide the raw `Payload` card and internal wording from non-HR, show the viewer's country first, no JSON, no "see docs/02-database-schema.md" text; F-A-21, F-F-13). Otherwise the move promotes a configuration console to every employee.

### 4.4.4 Every move or removal, with its consequence

| # | Change | For the ordinary employee | For managers / HR / others who need the same screens | Backend |
|---|---|---|---|---|
| 1 | New **Me** row replaces the personal links inside People & HR | Same pages, one row, truthful labels. The mobile bottom-bar "People" tab becomes "Me" (opens `/profile`). Habit change: People & HR row disappears for them | Managers/HR also get Me; their admin screens are no longer mixed with their own records | None |
| 2 | **Employees** removed from the sidebar of a person with no reports and no HR/finance/C-level/Sys Admin role | Loses a link to a page listing only themselves; nothing else (RLS already hides colleagues; their own record is "My profile"). Direct URL still works | Managers see **My team** (same `/employees`, their reports); HR/Finance/CEO see **Employees**; SYS sees Employees (all rows, read-only, F-F-24). Needs the has-reports read (R7) | None; RLS `employees_select` unchanged |
| 3 | **Attendance** split: "My attendance record" in Me; HR keeps "Attendance register" in People | Same page, honest name | HR loses the direct link to their own record (R1: same route); they reach it through their profile Attendance tab. No other persona has the register (RLS: self, manager, HR) | None |
| 4 | **Leave** becomes "My leave" | Same page | **No company-wide leave screen exists to move.** Managers/HR keep Approvals and the profile Leave tab; a team view is a separate new item (F-F-07 `[U-09]`) and when built is a "Team leave" link in My team/People | None |
| 5 | **Reimbursements** becomes "My claims" | Same page | Finance approvers decide in Approvals as today | None |
| 6 | **Letters** into Me as "My letters" | Same page | HR/Finance who manage letters keep "Letters" in People & HR > Workflow (R1) | None |
| 7 | **KPIs & Performance** row removed; "My performance" in Me | Same page; no "KPIs soon" line | HR "Manage performance cycles" button stays on the same page; same route | None |
| 8 | **Vendors & Purchasing** row removed from the sidebar | One fewer dead row | Roadmap visibility drops to one line in the My Day footer (it exists: `page.tsx:465`). **Owner decision**: keep the footer or drop it too (F-A-16 proposes dropping it) | None |
| 9 | **Inventory** row with only "My equipment" removed; "My equipment" in Me | Same page | People with an Inventory grant or a PM of a live project keep the Inventory row; "My equipment" stays palette-only inside it (R1) | None |
| 10 | Inventory **"Coming soon"** row removed for accounts with no employee record and no Inventory entry (today SYS) | Not applicable | SYS would otherwise be told a built module is "coming soon" | None |
| 11 | **Holidays, Policies** moved to Company information | Same pages (with the page fixes above). My Day should also show upcoming holidays for everyone (F-A-21, interface only) | HR keeps drafting, activating, holiday add/delete on the same pages; their People & HR > Organisation keeps Assets and Companies only. Breadcrumb changes from "People & HR / Policies" to "Company information / Policies" | None |
| 12 | **People & HR** row only for R8 | See 2 | Module access managers who are not HR still see it (it contains People & Access). A manager without the `line_manager` role but with reports now sees My team (improvement) | None |
| 13 | **Payroll, Assets, Alerts, AI, Audit, Companies** | No change (already hidden) | No change | None |
| 14 | **Approvals** row | No change in logic. Recommended: also show the row to anyone with direct reports (today the `line_manager` role flag decides), and keep it visible when the count read fails (F-A-02) | Count badge belongs to the notices/inbox item `[N-01]` | None |
| 15 | **People & Access** stays where it is, People & HR > Access, central screen for roles and module access | No change | Unchanged; R8 keeps it reachable. Denials should name the founders and offer "Request access" (F-G-14, a separate item) | None |

### 4.4.5 The unfinished-module rows: recommendation

| Row today | What it does | Recommendation |
|---|---|---|
| "Vendors & Purchasing" (muted, no link, all 13 personas) | Nothing | Remove from the sidebar (R3). Keep one roadmap sentence in one place (My Day footer) or none, owner decides. A muted row costs a row for everyone and promises something unscheduled |
| "KPIs & Performance" (row opens `/performance`; sub-links "Performance reviews (HR)" and muted "KPIs") | `/performance` is each person's own goals, self-ratings and appraisals (A 5.6), not an HR screen; "HR" in the label is wrong for the 12 personas who are not HR | Remove the row. Own goals and appraisals become "My performance" in Me. When real KPIs exist they get a row of their own at that point |
| "Inventory" coming-soon row (nav-groups.ts:303) | Appears when no Inventory entry applies (SYS) and when the grants lookup fails (A F-A-19) | Remove; a failed lookup must show a load error, not "Coming soon" |

### 4.4.6 People holding several responsibilities

* **No duplicate groups.** One row per module and one People & HR block however many roles feed it (CEO + Finance + HR show one block, one Finance row, one Approvals row; verified in the combination runs).
* **Order never depends on the role**: R2. What needs attention is shown by My Day and the Approvals row, not by moving rows.
* **Merged labels follow the widest scope** (R1, R4): HR + line manager sees "Employees" (company), not "Employees" and "My team".
* **Inventory** for a PM + warehouse person: one row; Today is the entry; Requests is the PM's tool and is palette-only for grantees, as today.
* **PM + Sales**: Sales row then Projects row, both full; Approvals only with the role flag, or a direct report, or something waiting.
* **Acting PM and team head** (F-G-05): `managesProjects` should mean PM, acting PM or live team head, the same predicate as `inv_can_browse`, so these people get Stock instead of the "You do not have Inventory access" notice. Interface read only; no new right `[D-35]`.

### 4.4.7 Before and after wireframes

Sub-links are shown expanded for completeness; the sidebar expands only the open module. "(own)" marks pages that show only the person's own rows.

**Ordinary employee** (5 rows, 12 destinations -> 3 rows, 11 destinations; 3 false labels removed, 2 dead rows removed)

```
BEFORE                                    AFTER
+-------------------------------------+   +-------------------------------------+
| My Day                              |   | My Day                              |
| People & HR                         |   | Me                                  |
|   Me                                |   |   My profile                        |
|     My Profile                      |   |   My attendance clock               |
|     My Attendance Clock             |   |   My leave                          |
|   People                            |   |   My claims                         |
|     Employees        (own row)      |   |   My equipment                      |
|     Attendance       (own record)   |   |   My attendance record              |
|     Leave                           |   |   My letters                        |
|     Reimbursements                  |   |   My performance                    |
|   Workflow                          |   | Company information                 |
|     Letters                         |   |   Holidays                          |
|   Organisation                      |   |   Policies                          |
|     Policies                        |   +-------------------------------------+
|     Holidays                        |
| Inventory                           |
|   My equipment                      |
| Vendors & Purchasing  (Coming soon) |
| KPIs & Performance                  |
|   Performance reviews (HR)          |
|   KPIs (soon)                       |
+-------------------------------------+
```

**Project member** (programmer, technician, marketing: identical today; 6 rows -> 4)

```
BEFORE                                    AFTER
+-------------------------------------+   +-------------------------------------+
| My Day                              |   | My Day                              |
| People & HR  (same 9 links as above)|   | Me           (same 8 links)         |
| Projects & Tasks                    |   | Projects & Tasks                    |
|   My Work                           |   |   My Work                           |
|   Projects                          |   |   Projects                          |
|   Calendar                          |   |   Calendar                          |
| Inventory                           |   | Company information                 |
|   My equipment                      |   |   Holidays                          |
| Vendors & Purchasing  (Coming soon) |   |   Policies                          |
| KPIs & Performance                  |   +-------------------------------------+
+-------------------------------------+
```

**Project Manager** (carrying the `line_manager` role; 7 rows -> 7 with direct reports, 6 without; the two dead rows go, My team appears only when it has something to show)

```
BEFORE                                    AFTER
+-------------------------------------+   +-------------------------------------+
| My Day                              |   | My Day                              |
| Approvals                           |   | Approvals                           |
| People & HR  (same 9 links)         |   | Me           (8 links, incl. My     |
| Projects & Tasks                    |   |               equipment)            |
|   My Work / Projects / Calendar     |   | Projects & Tasks                    |
| Inventory                           |   |   My Work / Projects / Calendar     |
|   Stock                             |   | Inventory                           |
|   Requests                          |   |   Stock                             |
|   (palette: My equipment, Scan)     |   |   Requests                          |
| Vendors & Purchasing  (Coming soon) |   |   (palette: Scan a label)           |
| KPIs & Performance                  |   | People & HR   only if direct reports|
+-------------------------------------+   |   My team                           |
                                          | Company information                 |
                                          +-------------------------------------+
```

**Warehouse operator** (5 rows -> 4)

```
BEFORE                                    AFTER
+-------------------------------------+   +-------------------------------------+
| My Day                              |   | My Day                              |
| People & HR  (same 9 links)         |   | Me           (8 links)              |
| Inventory                           |   | Inventory                           |
|   Today                             |   |   Today                             |
|   Stock                             |   |   Stock                             |
|   History                           |   |   History                           |
|   (palette: Requests, My equipment, |   |   (palette: Requests, Scan a label, |
|    Scan, Held by people)            |   |    Held by people)                  |
| Vendors & Purchasing  (Coming soon) |   | Company information                 |
| KPIs & Performance                  |   +-------------------------------------+
+-------------------------------------+
```
(Inventory contents are unchanged here; any change to Inventory navigation belongs to the Inventory part.)

**Finance** (HR role finance + Budget finance; 7 rows -> 6)

```
BEFORE                                    AFTER
+-------------------------------------+   +-------------------------------------+
| My Day                              |   | My Day                              |
| Approvals                           |   | Approvals                           |
| People & HR                         |   | Me           (8 links)              |
|   Me / People (4)                   |   | Finance                             |
|   Workflow: Letters, Payroll        |   |   Project budgets                   |
|   Organisation: Assets, Policies,   |   | People & HR                         |
|                 Holidays            |   |   Employees (company), Payroll,     |
| Inventory                           |   |   Assets                            |
|   My equipment                      |   | Company information                 |
| Finance                             |   |   Holidays, Policies                |
|   Project budgets                   |   +-------------------------------------+
| Vendors & Purchasing  (Coming soon) |
| KPIs & Performance                  |
+-------------------------------------+
```

**CEO / CTO** (founder everywhere + Budget approver; 9 rows -> 9 rows, two dead rows replaced by Me and Company information)

```
BEFORE                                    AFTER
+-------------------------------------+   +-------------------------------------+
| My Day                              |   | My Day                              |
| Approvals                           |   | Approvals                           |
| Sales & CRM  (+ Manage: Settings)   |   | Me           (8 links)              |
| People & HR                         |   | Sales & CRM  (+ Manage: Settings)   |
|   Me / People (4)                   |   | Projects & Tasks                    |
|   Workflow: Alerts, Letters, Payroll|   |   (+ Manage: Handovers)             |
|   Organisation: Policies, Holidays  |   | Inventory    (+ Manage: Setup)      |
|   Access: People & Access           |   | Finance                             |
| Projects & Tasks                    |   |   Project budgets                   |
|   (+ Manage: Handovers)             |   | People & HR                         |
| Inventory    (+ Manage: Setup)      |   |   Employees, Alerts, Payroll,       |
| Finance                             |   |   People & Access                   |
| Vendors & Purchasing  (Coming soon) |   | Company information                 |
| KPIs & Performance                  |   |   Holidays, Policies                |
+-------------------------------------+   +-------------------------------------+
```
A person with five modules has a long sidebar either way; the saving is the two rows that never lead anywhere and the labels that now match the page. The CEO's "Attendance" in People was only their own record (RLS has no CEO read of the register), so it moves to Me.

### 4.4.8 Acceptance checks for the navigation change

* **Success:** a snapshot test over the 30 combinations in `nav-matrix-raw.txt` and `nav-matrix-extra.txt` (script `scratchpad/navmatrix.ts`, `navmatrix2.ts`) shows EMP with exactly My Day, Me (8), Company information; HR with exactly today's admin links minus the personal ones; every route a persona reached before is still reachable by sidebar, palette or contextual link.
* **Failure:** with the has-reports read forced to fail, the Employees/My team entry is still shown and nothing says "no access"; with the grants lookup forced to fail, Inventory shows a load error, not "Coming soon" (R7).
* **Permission:** typing `/payroll`, `/alerts`, `/audit-log`, `/ai-suggestions`, `/admin/companies`, `/people-access`, `/finance/project-budgets` as EMP still returns the same notice (page) and the same empty RLS result (database); no persona gains or loses any data; a module access manager who is not HR still sees People & Access; a PM with no reports sees no People & HR row.
* **Multi-role:** HR + line manager has one People & HR block and one Approvals row; Finance + PM has one Finance row and no duplicate Letters or Attendance entry.

---

## 4.5 Search (command palette) by persona

**Today:** the palette matches only the label and group of nav links the person can see, including secondary links (`navGroupsFromModules` filters only "coming soon", `nav-groups.ts:327-334`); placeholder "Type a page name…"; empty state "No matching page." It never searches records, and no code searches across more than one record type (F-A-18 [NEW], searched 4 ways). Finding an employee costs 3-4 actions, a project 3, an enquiry 3, a task 4-5. An ordinary employee cannot find a colleague at all (RLS).

**Proposal (cross-reference: search proposal entry `N-07`):** keep pages first, then a "Records" group from ONE server action that fans out to the existing per-module loaders under the viewer's own session, 3-5 hits per type, minimum 2 characters, each hit labelled with type and context (company, project). The action must never use the service-role client, never cross company boundaries, and a source that fails must say "Could not search <source>" while the others still answer (never "No results").

| Persona | Pages offered (after 4.4) | Records to include (each limited by the persona's own RLS) | Never |
|---|---|---|---|
| EMP | Me items, Company information, plus synonyms ("time off" -> My leave, "expenses" -> My claims, "kit" -> My equipment, "holiday" -> Holidays) | Own leave requests, own claims, own equipment by name/serial, own issued letters. **Colleagues: only if the owner allows a narrow directory** (F-A Q3, via a function returning id and name of active same-company people, like `get_employee_manager_name`) | Any other person's HR data |
| ENG, TEC, MKT | + Projects & Tasks | + project directory (summary), tasks assigned to or collaborated on, projects they are members of | Project details of projects they are not on |
| DH | + Inventory Today/Stock | + team tasks, direct reports (by name), equipment requests they raised | Stock units |
| PM | + Projects, Inventory Stock/Requests | + own projects, all tasks in own projects, handovers waiting on them, their projects' budgets and equipment requests, direct reports | Other projects' details |
| SAL | + Sales pages (incl. palette-only New enquiry, Clients, Proposals, Pipeline) | Enquiries and proposals of the company; follow-ups; organisations and contacts exactly as the cross-company RLS returns today (F-B-21), shown with the company name so the viewer can tell | Opportunity values are visible to all grantees today; search must not add fields beyond the list screens |
| WH | + Inventory (Today, Stock, History; palette: Requests, Scan, Held by people) | Items by name/model/serial/equipment ID/bin label; units; equipment requests; movements by transaction ID; people who hold company equipment (custody RLS) | Costs unless `view_costs` |
| OPS | + whatever grants add | Projects (+ details only where member/founder), stock, enquiry availability checks, handovers | — |
| FIN | + Finance, People (Employees, Payroll, Assets) | Project budgets by project name or reference (inbox rows), employees of the company, approvals waiting on them | Compensation values in results |
| HR | + People (all admin links) | Employees (name, e-mail, plus employee number, job title, department which today are not searchable, F-A 5.4), leave requests, letters, assets, policies | Identity-document numbers, compensation values, loan or insurance details |
| SYS | + Admin pages | **People and accounts** (name, e-mail, account status: what People & Access lists) and companies. **Not HR employee records**, although `employees_select` lets them read every row (F-F-24): owner decision, leans on the confidential-data boundary | Employee HR data, deactivation reasons in snippets |
| CEO / CTO | + all module rows | Employees (name), projects (details where founder), enquiries, approvals waiting, budgets where executive approver, stock where founder | Identity documents, compensation, draft policy values |

Rules for every persona: results never show `status_reason` (F-G-04), draft policy values (F-A-08), letter contents, salary, audit payloads; results respect "summary only" levels (a project shown at summary level opens the summary); a pure page-jump still works when every record source is down; the placeholder becomes "Type a page or a record name".

---

## 4.6 Register hooks, conflicts and unresolved items

### Register cross-references (final IDs and ratings)

The matrix was drafted with working names; the **register in Section 3 is authoritative** for IDs and priorities.

| Working name in this section | Final register entry | Final priority and note |
|---|---|---|
| Policy-status function open to all signed-in users (F-A-08) | **D-22** | LI (provisional); becomes LB if the hosted privilege check shows `anon`/`authenticated` can execute it |
| Profiles readable including the deactivation reason (F-G-04) | **D-11** | LB; hosted column privileges unverified |
| Letter download while pending (F-F-05) | **D-23** | LI (provisional); LB if letter templates carry salary |
| Sign-in proxy redirects the HR cron routes (F-F-01) | **D-01** | LB; verify Vercel run history first; owner decision on exemption |
| Inventory nav stricter than the database for acting PM and team head (F-G-05, F-A-20) | **D-35** | LI |
| Clock "Project lead" picker (F-A-07, F-F-04) | **D-13** | LB; needs runtime confirmation; owner decision (attendance area untouched) |
| "Me" group (4.4) | **U-03** (with **U-04** for dead rows) | LI |
| Policies and Holidays readable by staff (F-A-21, F-F-13) | **U-22** | LI; precondition of moving them to "Company information" |
| Approvals row for managers without the role flag (4.4 row 14) | No separate entry; decision **DEC-15** | Decide whether "has direct reports" replaces the `line_manager` flag |
| Record search from the palette (4.5) | **N-07** | LI for modules under the user's own access; staff directory LT |
| Notices inbox (F-A-14) | **N-01** | **LI.** (This section's draft rated it LB; the launch-blocking hand-offs are the defects D-07, D-08, D-09 and U-01, which have their own small fixes and must not wait for N-01.) |
| Team/company leave view (F-F-07) | **U-09** | LI |

### Conflicts between sources

* **A vs G on counts:** A says the ordinary sidebar is "5 rows, 11 clickable destinations". Counting `nav-matrix-raw.txt` gives 12 including My Day (11 below it). Correct figure used here: 12. No conflict of substance.
* **Brief premise vs code:** the task asked to move Payroll, Leave admin and similar company-wide People screens out of an ordinary employee's nav. In the code those are already hidden (Payroll, Assets, Alerts, AI, Audit, Companies) or do not exist (a company Leave admin page). Stated in 4.4.1; the proposal is adjusted accordingly.
* **Raw CEO persona:** `nav-matrix-raw.txt` gives the CEO persona a Budget option `any: true` without saying which capability. In the database the Finance row exists only for `finance`, `view` or `executive_approver`; `manage_access` alone gives none (G 4.1 B). The CEO column assumes `executive_approver`.
* **Raw PM persona:** it carries the `line_manager` role, which is why it shows Approvals. A PM without that role does not. Both are shown in 4.2.2 note 2.
* **No conflict found** between A, C and G on the Inventory acting-PM / team-head mismatch (all three agree; code at `inventory/context.ts:60` and `:97` checked).

### Unresolved (needs the owner or a hosted check)

1. **Hosted checks:** (a) EXECUTE privilege on `preflight_phase2b_v2_policy_status()` for `anon` and `authenticated`; (b) column privileges on `profiles` for `status_reason`; (c) Vercel Cron run history for the five redirected routes; (d) whether a banned user's existing token works until expiry; (e) storage policy `letters_select` against a pending letter.
2. **Needs runtime confirmation:** the clock project-lead picker (F-A-07), the CEO's missing recovery card (F-F-03), payroll sign-off step order (note 5 in 4.2.4).
3. **Owner decisions:** keep or drop the "coming soon" roadmap line on My Day; Timesheets in or out; whether Marketing needs read access to Sales (no read-only grant exists) and whether Operations gets the coordinator preset or founder (F-G-17); whether ordinary staff may look up colleagues by name (F-A Q3, decides the search and the clock picker); whether team heads may prepare equipment requests (F-G Q5); whether the nav should treat "has reports" as manager (recommended) instead of the `line_manager` role flag.
4. **Not verified:** whether the sidebar's Approvals row should also show for chain-only (skip-level) managers; direct reports are sufficient because a skip-level manager always has direct reports.


---

# 5. Before-and-after everyday paths

Planning only. Nothing here has been built, run or timed. All times are **targets, not measurements**. Code is the authority; investigator findings are cited as `F-X-nn` (Investigator F's file writes its ids as `F-people-hr-NN`; I cite them as `F-F-NN`). D-/U-/N- ids are placeholders written `[register id]`.

## 5.0 How the numbers were computed

| Term | Meaning in this section |
|---|---|
| Screen | A distinct page load. A dialog or side panel opened on the same page is not a new screen (Investigator B and A's own 5.1 agree; A's 5.2 "Screens: 3" for the blocker path counts the panel and is not used). |
| Click | A click or a select/option choice. |
| Typed | A field the person must type or a date they must enter. |
| Repeated selection | The same kind of choice made again for the next line, person or record. |
| Default counted as 0 | If a default is correct, it costs nothing; if wrong, +1 to change. |

* "Today" counts come from the investigators' walked paths (A 5.x, B P2-P5, C P6-P7, E P8/P9/P11, F 5.1/5.2, G 6A). I recomputed any figure where I could not reproduce an investigator's number and say so.
* "After" counts are what the proposal needs if built as written, under the stated assumptions. They are designs to be checked, not results.
* Where several roles apply to one person (PM + approver + Sales), the proposals do not merge roles; they add rows to the same person's existing lists, filtered by the person's own grants (RLS decides, no service-role reads).

**Conflicts between investigators found while writing this section**

| Point | A | B / others | Which is right |
|---|---|---|---|
| Blocker path: screens | 5.2 says "Screens: 3" (My Day, My Work, task) | B P2 says the panel opens "on the same page"; A 5.1 says the panel is "same screen" | Panel = same screen (`?task=` panel, `projects/work`). Blocker from My Day = 2 screens, 5 clicks. A's "3" is internally inconsistent. |
| Quick-add enquiry after redesign | n/a | B F-B-18: "7 actions -> 5" | Recount under B's own convention (2 opens + title + organisation + source + submit) = **6**. B's 5 not reproduced; use 6. |
| Assigning work for one team of 3 + 3 tasks | n/a | B F-B-13: "about 30 -> about 20" | B's own list (accept 1, Manage + People 2, 3 people x 3 = 9, team 3, back 1, 3 tasks x 4 = 12) = **28**. The checklist and blank-default assignee alone save about 4, giving ~24, not 20. ~22 needs the "add several people at once" step proposed in 5.6. |
| Recovery return, clean | n/a | C F-C-16: "26 -> about 6" | Reproducible only if the return screen has "select all outstanding" and counted quantities prefilled with the outstanding quantity. Stated as an assumption in 5.8. |
| Approvals visible to a CEO | A F-A-15 lists "Approvals waiting more than N days" as a CEO row | `approvals_select` (`20261106000000...sql:1909`) lets a CEO read only their own rows, queue Recovery rows they are eligible for, or rows they submitted (unscoped `hr_admin` reads all) | The CEO can age **only their own** pending approvals. A company-wide "approvals waiting" list for a CEO would need a company-boundary decision; **not proposed** (5.13). |

---

## 5.1 Shared building blocks used by several paths

These are defined once; each path says which it uses. None is a new task or approval system: every row is computed from an existing record and links to the screen that already handles it.

**B1. "My work today" card (My Day).** For anyone with a Projects grant or a CRM grant. Up to 5 rows from `loadWorkRows(ctx).mine` (`lib/projects/my-work.ts:135`) plus own follow-ups (`lib/crm/my-day.ts`, `scope: "mine"`): overdue first, then due today, then blocked (mine), then awaiting my review. Row = title, project or enquiry, due, status. Row click opens the existing task panel (`/projects/work?task=`) or enquiry. Routine tasks carry the existing status control inline (reuse `task-controls.tsx`: "Start" / "Mark done"); review-required tasks carry "Send for review". Under the card: "N tasks have no due date" and "See all in My Work".

**B2. "Needs me" list.** One row shape: `{kind, title, project or requester, amount or dates, waiting since, link}`. Shown (a) as a block on My Day (oldest 8) and (b) in full at a page opened from a header chip "Needs me (N)". The list **reads** existing records and **links** to the existing decision screen; it never decides anything, so independence rules, routing and sensitive-grant protections stay exactly where they are. A row disappears only when the underlying record changes state (there is no "dismiss", no new status). Each source loads on its own; a failed source shows "Could not load <source>. This is not an empty list." with Retry, never 0. Source table in 5.14.

**B3. Honest failure states.** One shared helper turning `{ error }` into the existing `LoadError` (Inventory/Finance pattern) for the approval count, project rows and task lists (F-A-02, F-A-04, F-A-05, F-H-03).

**B4. Visual language (words only, no new branding).** ENGINIOUS OS as already approved: light and dark themes via the existing tokens, teal accent, rounded cards on a quiet background, one teal primary button per card or screen, secondary actions as outline buttons, status as small pills. All wireframes below use `[ Teal button ]` for the primary action and `( outline )` for secondary.

---

## 5.2 Path 1. Finding today's assigned work

| Item | Specification |
|---|---|
| **Today** | Ordinary employee holding a Projects grant (required to be assignable, `20261120000100_proj_core_tables.sql:336-348`) and one task: My Day (screen 1) -> click row "Project tasks due in the next 7 days N" (counts only) -> `/projects/work` (screen 2), table "My open tasks" -> click task -> panel on same screen. **2 screens, 2 clicks to read one title (3 to open it).** (A 5.1.) Via sidebar: "Projects & Tasks" lands on My Work: 1 screen, 1 click (B P2). "Due today" is merged into "next 7 days"; undated tasks are in no count (`work-logic.ts:17-27`); no blocked row; nothing actionable on My Day. Sales owner: "Your next follow-ups", max 3, own only (A 2a row 9). |
| **Proposed** | 1. Open My Day (landing page). 2. Read card B1 "My work today": titles, project, due, status, with overdue first. 3. Click a row to open the task panel, or use the inline status control (path 2). 4. "See all in My Work" for the rest. Sales users see "Follow-ups due today" rows in the same card (existing `crm_follow_ups`). |
| **Essential fields** | None (read-only). |
| **Defaults** | Scope = tasks where I am assignee or collaborator (`proj_tasks`, `proj_task_collaborators`); order = overdue, due today, blocked, awaiting my review (rules already in `work-logic.ts`); show 5 (cap is a display setting, not data). |
| **Optional (collapsed)** | "N tasks without a due date" expands to titles; "Upcoming 7 days" list. |
| **Next actor / how they learn** | None. (Assigner learns nothing from a read.) |
| **Confirmation shown** | Empty: "Nothing due today. 3 coming up this week." Failure: "Could not load your tasks. Retry." (never "Nothing"). |
| **Before -> after** | 2 screens / 2 clicks to read a title -> **1 screen / 0 clicks** (open task: +1). Repeated selections: 0. Assumption: person has >= 1 task and Projects access. **Target: under 10 seconds to see today's list.** |
| **Roles / permissions** | Anyone with a Projects grant and a task. Tasks come through the viewer's own session; a revoked project's task is absent (RLS). No-grant employees have no tasks by design and see no card. **Owner decision (F-B-05):** a Sales-linked person added as project member has tasks but is gated out of My Work and My Day today; proposal = gate on "has any membership" (interface only). |
| **Register dependencies** | F-A-13 [U-02]; F-A-04 [D-04]; F-B-10 [D-40]; F-B-05 [D-39]; F-A-16 [U-02]. |

```
+--------------------------------------------------------------+
| Good morning, Sara                                           |
| 3 things need you today                         [ Needs me ] |
+--------------------------------------------------------------+
| MY WORK TODAY                                                |
|  ! Overdue   Pack LED wall cables      Expo Hall 4   2 days  |
|              ( Mark done )                                   |
|  Today       Confirm truck booking     Expo Hall 4   today   |
|              ( Start )                                       |
|  Blocked     Stage power plan          Gala 2026     [Blocked]|
|  4 tasks have no due date          ( See all in My Work )    |
+--------------------------------------------------------------+
```

---

## 5.3 Path 2. Updating a task or reporting a blocker

| Item | Specification |
|---|---|
| **Today** | **Update (routine task):** My Day -> row click to My Work (1) -> status control (2) -> "Start" / "Mark done" (3). **2 screens, 3 clicks, 0 typed**; direct save, no confirmation (`task-controls.tsx:57-75`). Review-required: + "Send for review..." dialog = 4 clicks. From the sidebar, My Work is the landing page (1 screen, 2 clicks to update). **Blocker:** row click (1), task title (2), "More" (3), "Block task" (4), dialog "Mark as blocked": "What is blocking it" (required text), then **either** "Who can unblock it" (select) **or** "Or what action will unblock it" (text), "Mark as blocked" (5). **2 screens, 5 clicks, 2 fields.** (B P2, A 5.2.) Only the assignee, team head or PM may block (`proj_task_actor_role`). Next actor learns only in the "Project notices" panel at the bottom of My Work (`work/page.tsx:163-186`); no badge, no email, no My Day row; if the PM is the actor and names nobody, nobody is told (`proj_notify` skips the actor). |
| **Proposed** | **Update:** 1. In B1 click the inline status button ("Start" or "Mark done"). Review-required: 1. "Send for review", 2. confirm (existing dialog). **Blocker:** 1. Click "Report a blocker" (visible button on the row and in the task panel, replacing "More > Block task"). 2. Type "What is blocking it". 3. "Who can unblock it" is preselected (change only if wrong). 4. Click "Mark as blocked". |
| **Essential fields** | Update: none. Blocker: "What is blocking it" (required). The existing rule stays: a person **or** an action must be given (`proj_block_task`); the preselected person satisfies it. |
| **Defaults** | "Who can unblock it" = department head of the task's team, else the project's PM, the same pick the system already makes for reviewers (`coalesce(head who is not the assignee, pm)`, `20261120000300:643`; `proj_teams.head_user_id`, `proj_projects.pm_user_id`). If the actor **is** that person, no default: they must name someone or an action (rule kept). |
| **Optional (collapsed)** | "Or what action will unblock it" (300 chars); a note. |
| **Next actor / how they learn** | Named unblocker (or head and PM): (1) a "Needs me" row "Blocked: <task>, waiting on you to unblock" computed from `proj_tasks.blocked_at` + `unblock_owner_id` (and PM of the project), visible on My Day and the full list; (2) the existing `project_task_blocked` notice stays. The department head is notified as well as the PM (F-B-17). Review-sent: reviewer's existing row "Project task waiting for your review" (link fixed to `?show=review`). |
| **Confirmation shown** | Update: row changes pill and "Saved." Blocker: "Marked as blocked. <Name> will see it under Needs me." If nobody could be told (actor is the PM, nobody named): "You are the project manager, so nobody else was told. Name someone or an action." Never claims a notice that `proj_notify` skipped. |
| **Before -> after** | Update: 2 screens / 3 clicks -> **1 screen / 1 click** (review-required 4 -> 2). Blocker: 2 screens / 5 clicks / 2 fields -> **1 screen / 2 clicks / 1 typed field** (+1 if the default person is wrong). Repeated selections: 0. **Target: routine update about 5 seconds; blocker under one minute.** |
| **Roles / permissions** | Unchanged: assignee, head, PM may block; clear blocker by those or the named unblocker; a collaborator cannot block (`proj_task_actor_role`). A review-required task still needs an independent reviewer (`proj_set_task_status`); a task cannot be completed while blocked. Enforced in SQL, not by the new button. |
| **Register dependencies** | F-B-17 [U-11]; F-A-13; F-B-06 [N-02]; F-B-11 [D-53] (rule untouched); F-B-10. |

---

## 5.4 Path 3. Finding site instructions and current approved references

| Item | Specification |
|---|---|
| **Today** | No single place. Sidebar "Projects & Tasks" (1) -> "My projects" card (2) -> project Work tab: right rail "Project details" (location, time zone, dates, collapsible "Agreed scope"); Timeline tab (3) -> "Site plan" (site notes, "Dependencies on others", "Site bookings"); "Manage project" (4) -> "Files & client plan" (5): flat list, newest first, purposes only Document / Feedback evidence / Completion evidence / Other; "Manage project" -> History: "Notes from Sales"; handover **risks** are shown nowhere in the project. **5 to 8 clicks, 4 to 5 screens**, and the person must already know where to look. Files have no approved/current marker, no version, no supersede (`proj_files` columns, `20261120000500:24-46`); only the issued client timeline is versioned ("Latest"). (B P3.) |
| **Proposed** | 1. Open the project (sidebar -> project, or Ctrl+K, type name, Enter). 2. The Work tab opens with a top-of-rail card "Site and references". 3. Click a file or link in the card to open it. PM side: on any file row, "Mark as current reference" (1 click). |
| **Essential fields** | Reader: none. PM marking a reference: none beyond the click (the file's own label is used). |
| **Defaults** | Card content assembled from existing records: location and time zone (`proj_project_details`), access/power/network dependencies with confirmed state (`proj_external_dependencies`), next booking (`proj_site_bookings`), "Notes from Sales" and risks (`proj_handovers.notes`/`risks` copied to `proj_project_details`), current-reference files. A file's label defaults to its existing label; purpose list gains "Site instruction". |
| **Optional (collapsed)** | Earlier (superseded) references with dates; full site plan link; Discussion link. |
| **Next actor / how they learn** | Members learn that a reference changed by a project notice "Reference updated: <label>" (reuse `proj_notify`; one new notice type, text added to `notification-text.ts`) and by the badge on next visit. Not an obligation, so a notice is enough. Restricted files stay PM-only. |
| **Confirmation shown** | PM: "<Label> is now the current reference. Version dated 2 Nov replaced." Reader: current files carry a teal "Current" pill; replaced ones are greyed with the date they were replaced. |
| **Before -> after** | 5-8 clicks / 4-5 screens -> **3 clicks (sidebar, project, file) / 2 screens**; via Ctrl+K 3 actions / 1 screen to the card, +1 to open the file. Repeated selections: 0. **Target: under 30 seconds.** |
| **Roles / permissions** | Members see details-level content (PM, members, heads, founders); summary-only people (Sales-linked, bare grant) see nothing from this card (RLS `proj_can_view_details`). Marking a reference: PM, acting PM or founder (`proj_can_manage`); restricted files stay restricted. "Approved" means the PM's declaration; if the owner wants client-approved evidence, tie to feedback evidence (owner decision B Q6). |
| **Register dependencies** | F-B-14 [N-09]; F-B-15 [D-41]; F-A-18 [N-07]. |

```
+---------------------------------+
| SITE AND REFERENCES             |
| Expo Hall 4, Dubai (GST)        |
| Install 12 Nov  Event 14-16 Nov |
| Power: confirmed   Access: open |
| Next on site: Thu 08:00, 4 crew |
| CURRENT                         |
|  [Current] Stage plan v3.pdf    |
|  [Current] Site rules.pdf       |
| Notes from Sales (2)  Risks (1) |
| ( Earlier versions )            |
+---------------------------------+
```

---

## 5.5 Path 4. Creating a Sales enquiry and recording a follow-up

| Item | Specification |
|---|---|
| **Today** | **Create (quick add):** sidebar "Sales & CRM" lands on Follow-ups (screen 1, click 1); "Add enquiry" (2). Dialog: "What is the enquiry?" (typed), Agency **or** End client (search box plus select: two controls), "Where did it come from?" (select, no default), "Next action" (typed); Due (default today), Company (hidden for one company). Silent defaults: 10:00 Dubai, type Call, owner me, stage New. "Add enquiry" (submit). **Minimum 7 actions (2 opens, 2 typed, 2 selections, 1 submit), 1 screen, 4 required fields to supply, 11 optional hidden.** Organisation missing: +4 (nested dialog). **Record a follow-up:** (A) done a scheduled call: "Complete" (1) + "What happened?" (required) + "What happens next?" + next action (required) + Date (**required, no default**) + Time + Type (default Other, create defaults Call) + submit = 2 clicks + 3 required fields. (B) schedule new: open enquiry, "Add follow-up", 3 clicks + 2 required. (C) log an unscheduled call then plan the next step: "Add update" then "Add follow-up" = 2 dialogs, about 10 interactions. (B P4.) Next actor: owner = self. If another owner is chosen (needs `assign_owner`) **nobody is told** (`crm_create_opportunity` writes the follow-up and event only). |
| **Proposed** | **Create:** 1. "New enquiry" (Follow-ups header button, nav shortcut `?add=1`). 2. Type the enquiry name. 3. One searchable organisation box; pick, or "Add <typed name>" inline (existing `crm_find_similar_organisations` still warns of duplicates). 4. Pick source. 5. "Next action" is prefilled ("Call to qualify the brief", editable); type and time sit beside Due. 6. Submit. **Record:** the "Add update" dialog gets one optional section "Schedule the next follow-up" (title, date, assignee) so a call and its next step are one dialog; "Complete" gets a date default. |
| **Essential fields** | Enquiry name, agency or end client, source, next action (prefilled), due (defaulted). Follow-up: what happened, next action text. |
| **Defaults** | Owner = me; stage New; currency and company = company settings (`crm_company_settings`); due = today; next-action time/type = 10:00 / Call as now; follow-up date default = next working day from the company calendar already stored in Sales settings; follow-up type default = type of the follow-up being completed (existing record) instead of "Other". |
| **Optional (collapsed)** | "Add more details" (11 controls: dates, location, technologies, budget, note, brief, owner if allowed). Full form `/sales/new` for contacts, waiting-on, scope. |
| **Next actor / how they learn** | New owner or assignee (when not me): a "Needs me" row "Follow-up assigned to you: <title>, due <date>" computed from `crm_follow_ups` where assignee = me and open (no write needed); the existing `crm_reminders` and 04:00 UTC job keep working. Email stays off by default (existing setting). |
| **Confirmation shown** | "Enquiry ENQ-... created. Next action: Call to qualify the brief, Tue 10:00, owner Ali." Lands on the existing side panel (as now). If assigned to someone else: "Ali will see this under Needs me." |
| **Before -> after** | Create: **7 -> 6 actions** (organisation search+select become one pick; next action no longer typed), 1 screen -> 1 screen. Organisation missing: +4 -> +1 (name already typed; "Add <name>"). Log call and plan next: **about 10 interactions / 2 dialogs -> about 6 / 1 dialog** (B's estimate, not recomputed: assumes title, date, assignee defaults accepted). Complete scheduled follow-up: 3 required fields -> 2 (date defaulted). Repeated selections: org+source stay (2). **Targets: new enquiry about 2 minutes when the client details are to hand; call plus next step about 1 minute.** |
| **Roles / permissions** | Unchanged: any grantee creates (owner = self unless `assign_owner`/founder); edit/stage/won/lost owner or founder; complete follow-up assignee, owner or founder (`crm_require_follow_up_actor`); assigning to another person needs `assign_owner` or being owner. Founder, HR, Finance, CEO give no CRM access. Organisations/contacts are readable across companies by any CRM grantee (F-B-21): reported, not changed. |
| **Register dependencies** | F-B-18 [U-28]; F-B-19 [U-14]; F-B-07 [U-01]; F-B-09e/f [D-18]; F-B-01 / F-B-02 for the won stage (below). |

**Won to handover (summary, single working handover unchanged).** After "Confirm as won" the success state offers "Prepare the handover now"; the handover form has one primary "Save and submit" plus "Save draft"; "Risks" becomes an editable field. The Sales owner sees "Handover: PM asked a question" and "Handover accepted" rows (F-B-04). Owner today: 6 clicks + 3 typed over 3 screens; after about 5 clicks over 2 screens (one prompt, one submit). Registers: F-B-01 [D-08], F-B-02 [U-10], F-B-04 [D-09].

---

## 5.6 Path 5. Assigning project work and handling client feedback

| Item | Specification |
|---|---|
| **Today** | **Assign work (client project, from handover):** Handovers page "Accept and create the project" (1 click) -> project Work tab (2 screens). Work says "No tasks yet" and "Add a department team on the People page first" (text only). "Manage project" (1) -> "People & access" (2): per person Person (select, Projects-grant holders only) + Department (optional) + "Add to project" = 2 selections + 1 click; per team Name + Department head + Save = 3. Back to Work (1); "Plan" -> "Add deliverable" (title, team, due, milestone) or "Add task": "What needs doing" + Assignee (**defaults to the PM**) + Due + add = 4. **One team of 3 people and 3 tasks: 1 + 2 + 9 + 3 + 1 + 12 = 28 interactions over 3 screens** (B says "roughly 30"). A person without a Projects grant is not in the list ("A founder gives them access first"). **Client feedback:** "Manage project" (1) -> "Feedback & changes" (2) -> "Record feedback" (3): Who gave it, Received on (default today), What was asked, **Kind** (required, no default), Relates to (default whole project), Responsible, Deadline = 3 required entries. If a proposed change: "Propose a scope change": Title, the **whole scope retyped** (prefilled), effect on dates, cost (optional) = about 14 interactions end to end, 3 screens. The decider (`approve_scope`, usually a founder) learns **only by visiting** (`proj_propose_scope_change` notifies nobody). On approval the scope text changes and the PM is told; **no task, equipment, budget or date is touched or flagged** (F-B-08). (B P5.) |
| **Proposed** | **Assign work:** 1. Accept the handover (existing button). 2. The empty Work tab shows a 4-step checklist with direct buttons: "Add people", "Add teams", "Add deliverables", "Add tasks". 3. "Add people": one dialog, tick several people from the Projects-grant list, choose the Department once for the group, one "Add". 4. "Add team": name + head. 5. "Add task": Assignee has **no default for managers** (must choose; list ends with "Add someone to the project..." for eligible people). Department heads keep distributing within their team (default stays self for heads). **Feedback:** 1. "Record feedback". 2. On a "Proposed change" card: "Propose scope change from this" (title, link, request text prefilled; the scope text stays prefilled for editing). 3. After approval the PM sees "What this change touches" with three link-outs (Add tasks, Update equipment, Request additional budget if open to them); nothing changes automatically. |
| **Essential fields** | Per person: person (ticked). Per team: name, head. Per task: what needs doing, assignee, due. Feedback: who gave it, what was asked, kind. Scope change: title, scope text. |
| **Defaults** | Department for a ticked group = the department already recorded for the person (existing `employees`/`proj_people` record), else chosen once; feedback received date = today; "Relates to" = whole project; scope text = current scope (`proj_project_details.scope`); head default for tasks = self (heads only). |
| **Optional (collapsed)** | Deliverables and milestones, feedback deadline and responsible person, cost effect (only for `view_commercial`/founder, never shown to a PM without it). |
| **Next actor / how they learn** | Assignees: existing notices (`project_task_assigned`, `project_invitation`) plus a "Needs me" row "New: <task>" (task assigned to me, not yet started) and the B1 card. Scope decider (`approve_scope` holders and founders of the company): "Needs me" row "Scope change proposed: <title>" from `proj_scope_changes.status = 'proposed'` (read only, no new notice needed; a `project_scope_proposed` notice is optional). Person responsible for feedback: row "Client feedback assigned to you" (later). |
| **Confirmation shown** | Add people: "3 people added to Gala 2026 (Production): A, B, C." with any individual refusal listed ("D has no Projects access: ask a founder"). Task: "Task added and assigned to A. A will see it under Needs me." Scope proposal: "Sent. <Decider names> will see it under Needs me." |
| **Before -> after** | Assign work (1 team, 3 people, 3 tasks): **28 -> about 22** interactions (recomputed: 1 accept + 1 checklist button + 5 for people [3 ticks + department + add] + 3 team + 12 tasks = 22); screens 3 -> 3 (no menu hunting). Feedback to approved scope change: **about 14 -> about 10**, 3 screens -> 3 (decider visit becomes one click from Needs me). Repeated selections: person x3 -> ticks, department 3x -> 1x. **Targets: staffing a small team and first tasks within 5 to 6 minutes when names and tasks are known; recording client feedback about 1 minute.** |
| **Roles / permissions** | Unchanged: accept = the named PM; add member = PM, acting PM, founder (target must hold a Projects grant, `proj_add_member`); create task = member for self, head for own team, PM for anyone; decide scope change = `approve_scope` or founder, not the PM as such; PM cannot grant Projects access. The multi-add calls `proj_add_member` once per person; each person is checked individually; one failure does not hide the others. |
| **Register dependencies** | F-B-13 [U-12]; F-B-12 [U-13]; F-B-23 [U-31]; F-B-07; F-B-08 [N-15]; F-B-02/F-B-01/F-B-04 (handover). |

---

## 5.7 Path 6. Requesting equipment (PM request; employee request)

### 6a. Project Manager requests equipment for a project

| Item | Specification |
|---|---|
| **Today** | Sidebar Projects -> project -> Equipment tab (3 page loads), or Inventory -> Requests (1 load, project chosen in the dialog). "New equipment request": project (fixed on the project tab), "What is it for" (optional), Pickup location (optional), **Leaves the warehouse** and **Due back** (both needed to submit), More details: Destination, Time zone, Note. Create draft (1). Expand "Add an item" (1); per item: search + pick (2) + quantity (default 1) + "Add line" (1) = 3. Submit to the warehouse (1). **Three hand-picked items: 2 dates + 1 + 1 + 1 + 9 + 1 = 15 interactions (+3 page loads to reach).** Template route: 9. (C P6a.) Next actor (warehouse): **no notification**; they open Today, Requests, or see the My Day count "Live equipment requests". PM learns of progress by reopening the project. |
| **Proposed** | 1. Equipment tab -> "New equipment request". 2. Dates and place arrive suggested (check, edit if wrong). 3. "Create draft". 4. The "Add an item" box is already open: type, pick; picking adds the line with quantity 1 (edit the quantity in the list only when not 1). Or choose a technology template (existing). 5. "Submit to the warehouse". |
| **Essential fields** | Leaves the warehouse, Due back (the only fields a submit needs, `inv_submit_request`), at least one line. |
| **Defaults** | Leaves = installation date, else show start; Due back = show end (`proj_project_details` / project dates); Pickup = the company's only active location (`inv_locations`) when there is one, else blank; Destination = project location and Time zone = site time zone (`proj_project_details`). Dates and place stay **visible, editable fields** (they drive booking conflicts); a default is never submitted unseen. "Import from handover" (existing) still adds the technologies. |
| **Optional (collapsed)** | What is it for, Destination/time zone/note, alternative selects in templates. |
| **Next actor / how they learn** | Warehouse operators of the pickup location: "Needs me" row "Request <ref> for <project> submitted: prepare" (computed from `inv_requests.status = 'submitted'`, same data as Inventory Today), plus the Today queue they already have. PM: row/notice when dispatched or returned (see 5.8). Later: a notice type through the existing `notifications` table (F-C-18). |
| **Confirmation shown** | "Submitted to Dubai Warehouse for 12 to 16 Nov. The warehouse sees it on Today." Status pill "Submitted". |
| **Before -> after** | 3 hand-picked items **15 -> 9** (dates prefilled 2 -> 0; each item 3 -> 2; "expand" 1 -> 0); template route **9 -> 6**; page loads to reach unchanged (3, or 1 via Inventory). Repeated selections: per item 2 (search, pick). Assumption: project dates are correct. **Target: about 3 minutes for a 3-item request.** |
| **Roles / permissions** | Unchanged: `inv_can_edit_request` = warehouse capability, or `proj_can_manage` (PM, acting PM, founder), or an employee requester with the right. Enforcement in SQL. Acting PMs and founders are allowed by the database but hidden by the nav (F-C-19 / F-G-05): fix is `managesProjects` from `proj_can_manage`, interface only. |

### 6b. Request equipment for an employee

| Item | Specification |
|---|---|
| **Today** | Inventory -> Requests (1 page): "New request" (1) -> "Who is it for" (1, only if projects also allowed) -> Company (1, only if more than one) -> Employee: type 2+ letters, pick (2) -> **Collected from** (required select, 1) -> Needed from (1) -> "Expected back (optional)" (1) -> Create (1) -> expand add item (1) + 3 -> Submit (1) = **12 interactions minimum, 1 page load**. **Submit fails without the "optional" Expected back date** (`inv_submit_request`: "Set the planning dates (at least a start and an end)"): about 4 more interactions to recover (F-C-02). Warehouse then reserves per line (2 clicks) but **issuing a unit reserved for the same request is refused** (F-C-01). Line manager without grant cannot start the path (F-C-19). (C P6b.) |
| **Proposed** | Same dialog; "Expected back" labelled and required (honest label, interface only); Collected from defaulted when the company has one location; adding items as in 6a. |
| **Essential fields** | Employee, Collected from, Needed from, Expected back, at least one line. |
| **Defaults** | Company = the viewer's only company; Collected from = single active location (`inv_locations`) or the person's last working location where they operate; Needed from = today. |
| **Optional (collapsed)** | What is it for, note. |
| **Next actor / how they learn** | Warehouse: Today row "Equipment for <employee> needs to be prepared" plus the Needs me row; employee: finds issued kit under "My equipment" (no notice; later F-C-18). |
| **Confirmation shown** | "Submitted. Warehouse will prepare it for <name>." |
| **Before -> after** | **12 -> 10** (default location, item add) and the failed submit (+4) removed. Screens 1 -> 1. **Target: about 3 minutes.** |
| **Roles / permissions** | Department head with `request_for_employees`, or warehouse. Whether line managers may also request is an **owner decision** (F-C-19, G Q5); not changed here. |
| **Register dependencies (6a, 6b)** | F-C-02 [D-29]; F-C-01 [D-06]; F-C-18 [U-30, N-01]; F-C-19 [D-35]; F-C-05 [D-31]; F-C-06 [D-17]; F-C-07 [D-17]; F-A-14/F-B-06 (Needs me). |

---

## 5.8 Path 7. Preparing, dispatching and returning equipment (summary only; full specification is Section 6)

| Item | Specification |
|---|---|
| **Today** | Warehouse operator: Today (screen 1) -> row "Prepare equipment" -> workspace `?step=prepare` (screen 2). Per line: "Reserve" + dialog "Reserve" = **2 clicks per line, no bulk** (12 lines = 24). Tab "Send out" (screen 3): tick units ("Tick all N of these" per item, scan, or per unit); counted lines need a typed quantity; Review, Confirm. Example 4 individual items + 2 counted = **9 interactions**. Return: tab "Receive back" (or Today row only when due within 7 days or late); tick each unit **and** choose a condition each (required, nothing preselected); counted: quantity + condition; Review, Confirm. Example 10 units + 2 counted = **26 interactions, no bulk "all good"**. A second return screen (Stock "Return") starts every line at **Good** with "Add all" (3-6 interactions) but is unsafe (F-C-03). Fulfilled requests, cancelled-with-equipment-out and finished projects have no direct "Receive back" link (F-C-04). **Next actor: nobody is told** (no Inventory function writes a notice, F-D-06): the PM sees a dispatch only by opening `/projects/[id]/equipment`. A PM cannot read movement rows at all (RLS `inv_can_view_stock`, F-D). (C P7a, D 5.) |
| **Proposed (summary)** | **Prepare:** per-line Reserve stays, pre-filled (default, DEC-21). **Only if the owner chooses option B or C in U-24** is there one "Reserve what is free for all open lines" button (B: calls the existing per-line action in sequence, re-runnable, not atomic; C: one all-or-nothing function that touches the booking path and needs engineer sign-off); either way it lists the result per line and never displaces another request. **Send out:** unchanged steps; consumable lines show "Use up" instead of a dead end (F-C-09); on Confirm the **dispatch note** (proposed, Section 6) is created in the **same database transaction** as the movement, as an immutable record the PM can read. **PM acknowledgement:** the PM (or acting PM or founder, whoever holds `proj_can_manage` at that time) opens the note from "Needs me" or the project Equipment tab and chooses "Matches what we received" or "Something is different" (text). This sets a state **on the note**; it is not an approval, never uses the `approvals` table, and **never changes stock**; a difference becomes a "Needs me" row for the warehouse, who review it and record any correcting movement themselves. **Return:** one return screen (D-28): **ticks default to nothing** (the principle approved for Receive back: nothing is assumed to have come back); per-item "Tick all N of these" as in Send out; above the list "Set the condition for all ticked lines" whose select **starts empty and is never preselected** and applies only to ticked lines that have no condition yet (U-23); a condition is required for every received line; kits show their contents and need "complete" or a missing list (N-05, after that check exists); the review uses the one outcome function so "fair" is described correctly (F-C-03). "Receive back" appears on any request with equipment outstanding, whatever the status (F-C-04). The **return checklist** is built from what the ledger says the project holds (units exact; counted per item at project level). **PM confirmation:** the PM opens the return record and confirms or reports a difference, same mechanics as dispatch. |
| **Essential fields** | Prepare: none (button). Send out: units/quantities as now. Return: which units/quantities came back; a condition for any line that is not Good and complete. PM: one choice, plus text only for a difference. |
| **Defaults** | Reserve location = request pickup (existing); expected return carried from the request (existing); return conditions: none preselected (safety rule: damaged never auto-available); the only bulk paths are per-item "Tick all N of these" and "Set the condition for all ticked lines" (starts empty, never preselected), both deliberate person actions; nothing is ticked by default. |
| **Optional (collapsed)** | Per-line note; bin; kit contents detail; PM text. |
| **Next actor / how they learn** | PM: "Needs me" row "Equipment sent to <project>: confirm what arrived" computed from the note's state (a **record**, not only a notice, because `proj_notify` silently drops notices for an ineligible PM and a PM who is also the operator, and member removal deletes them: F-D-06, F-D-11). Warehouse: rows for submitted requests, returns due, differences reported. Persisting only a notice is rejected. |
| **Confirmation shown** | Send out: "Dispatched. Note `UAE-D-nnnnn` sent to <PM name>." Return: "Returned: 10 units back, 1 held for checking (not available)." PM: "Thank you. Recorded as matching." |
| **Before -> after** | Prepare 12 lines: **24 -> 24** by default (kept per line, pre-filled); **24 -> about 2** only under U-24 option B or C (button + review, plus reading the result list). Send out (4+2): **9 -> 9** (no saving claimed). Return (10 units + 2 counted): **26 -> about 16** with the condition helper alone (10 ticks, 2 quantities, 2 for the helper, review, confirm); **about 9** if the 10 units fall into 3 item groups and per-item "tick all" is used (assumption stated); a global "select all" that would reach about 5 is **not proposed** because it conflicts with "nothing ticked". Each exception +1, each kit +1. Screens Today -> Prepare -> Send = 3 -> 3 (not a target). PM learns of dispatch: visit (0 prompts) -> 1 row on My Day. **Targets (not measured): a clean return within about 5 minutes; reserve time depends on the U-24 option.** |
| **Roles / permissions** | Recording dispatch/return: `inv_loc()` -> `inv_can_operate` (warehouse capability + assigned location, or cross-location, or Inventory founder). Acknowledging: `proj_can_manage` at the time of the click (who counts when the PM is unavailable is an **owner decision**, D Q3). A PM without a stock grant can read the note only through a new read function (D F-D-04); the note carries a frozen payload (names, serials, destination, time zone) because catalogue text can change after the movement. Booking conflicts and movement history are unchanged. |
| **Register dependencies** | F-C-15 [U-24]; F-C-16 [U-23]; F-C-03 [D-28]; F-C-04 [D-30]; F-C-09 [D-32]; F-C-21 [N-05]; F-C-18 [U-30, N-01]; F-C-01; F-D-01..F-D-11 [N-03, N-04]. |

```
RETURN CHECKLIST  (Gala 2026, request REQ-0042)       [dark/light as set]
+-----------------------------------------------------------------+
| Out with this project: 12 lines   (tick each, or "tick all N" per item) |
| [x] LED panel 500 mm    x10 units   Condition: ( choose ) v      |
| [x] Flight case kit K-7             Contents: ( complete ) v     |
| [x] Gaffer tape (counted)  qty 2 of 2                            |
| ---------------------------------------------------------------|
| Set condition for ticked: ( choose ) v [Apply]   Held: 0          |
|                                         [ Review the return ]    |
+-----------------------------------------------------------------+
```

---

## 5.9 Path 8. Preparing and reviewing a project budget

| Item | Specification |
|---|---|
| **Today** | **PM (first budget):** project (2-3 screens) -> "Budget & Expenses" tab (1) = 3-4 loads. "Create the project budget": currency (free 3-letter text, irreversible, prefilled) + "Create budget" (1). Draft editor: period prefilled, "People this budget covers" checkboxes start **empty**, six category panels. Per line: "Add line" (1) + Description (typed) + 0-1 selects + 0-2 dates + 1-3 numbers = **3-6**; **10 lines = 30-60 interactions**; no duplicate, no copy, no template. "Submit for approval" (1; saves then submits). **Finance review:** sidebar Finance > Project budgets (1; screen 1), row (2; screen 2), read, Approve (1, no confirm) or Return/Reject (click, required reason, confirm = 3): **2 screens, 2 clicks to approve**. Next actor: `pbx_submit_budget` writes `project_budget_submitted` notices that render only in `/projects/work` for project participants, so **Finance and CEO/CTO approvers without project participation never see them** (F-E-01). (E P8.) |
| **Proposed** | **PM:** 1. Project -> Budget tab. 2. "Create the project budget": currency is a choice (company default plus currencies already used), shown as "AED, cannot be changed". 3. Project members arrive ticked. 4. Add lines; **"Duplicate line"** on each line (launch). "Copy lines from another of my project budgets" (later). 5. "Submit for approval". **Finance/CEO-CTO approver:** 1. "Needs me" row "Budget waiting for you: <project>, waiting 3 days" (from the existing Finance inbox read). 2. Click opens the budget; read; decide (Approve 1 click; Return/Reject with required reason as now). |
| **Essential fields** | Currency (once), per line: description plus the numbers its calculation basis needs. Return/Reject: reason (already required). |
| **Defaults** | Currency = company default else AED (existing); period = project start/end (existing); people = all active project members (`proj_project_members`); category defaults and Food = per person per day (existing); status label names the real approver. |
| **Optional (collapsed)** | Dates per line, activity, people list per line, notes. |
| **Next actor / how they learn** | Finance (ordinary PM) or CEO/CTO executive approver (submitter holds Finance): "Needs me" row from `pbx_inbox()` where `i_can_decide` and not `on_hold`, plus a count on the Finance nav entry. Submitter and creator are excluded by the database. If **no independent approver exists** the item is "on hold": a separate row to holders of `manage_access` ("Budget on hold: no independent approver", F-E-08). PM learns of the decision: existing `project_budget_decided` notice (PM is a participant, so visible) and a "Needs me" row "Budget returned for changes" or "Approved: start final expenses". |
| **Confirmation shown** | "Submitted. Waiting for **Finance** (or the CEO/CTO approver): label from `approval_route`, not always "Finance" (F-E-09). Next: approves, returns or rejects." Decider: "Approved. <PM> will see it under Needs me." |
| **Before -> after** | PM 10-line budget: **30-60 -> 24-48** with duplicate line at launch (assumption: 4 distinct lines at 3-6 each + 6 duplicates at 2-4 each); **about 10-25** if "copy lines" is built later (E's target 15-35 is for a half-copied budget). Screens 3-4 -> 3-4. Finance approve from My Day: **2 clicks / 2 screens (sidebar+row) -> 1 click / 2 screens (My Day row -> record)**; the real gain is discovery (0 prompts -> a row with waiting time). **Target: a 10-line budget within 5 to 6 minutes when inputs are at hand; a Finance decision about 1 minute.** |
| **Roles / permissions** | Unchanged and enforced in SQL: PM or acting PM prepares and submits (`pbx_require_pm`); decision by the route capability for the company (`finance` or `executive_approver`), never the creator/submitter (`pbx_version_guard`); route fixed at submission by `pbx_approval_route`. The Budget module has its own grant table: HR roles, founder title, CEO title give nothing. Calculations (rounding once per line, decimals per currency) are untouched. |
| **Register dependencies** | F-E-01 [D-07]; F-E-09 [D-37]; F-E-12 [U-16, N-11]; F-E-14 [D-38, U-17]; F-E-08 [D-36]; F-E-22 [U-18]; F-A-10; F-E-03 [D-02]. |

---

## 5.10 Path 9. Recording actual expenses and settling them

| Item | Specification |
|---|---|
| **Today** | **PM:** Budget & Expenses -> "Actual expenses" tab (1-2) -> "Start entering actual expenses" (1; creates a line per approved budget row). Per line: Actual (required; type 0 for nothing); if > 0: "How was it paid?" (required select), "Who paid?" (required for advance/personal), claim select or note; nothing carries to the next line. **12 non-zero lines, all personal = about 36**, + tick "I confirm these actual expenses are complete", variance note if > 10% different (required), "Submit final expenses" = 3. **About 41 interactions.** Finance approval: sidebar + row (2 screens) + Approve (1). **Settlement (Finance), one record, Settlement tab:** receipts: status select, date (default today), Save (2-3; exception needs a reason); money returned/paid: "What is being recorded?", person (default first), Amount **typed** (hint "Up to AED X", not prefilled), date, method, Record = **min 2 per person per kind**; "Confirm reconciliation and close" (1). Executive route: CEO/CTO also clicks "Confirm the receipts" then "Authorise closure and close". "Advance still to be returned" shows the full advance before final expenses are approved (F-E-10). Next actor: no notice after approval of actuals; **no notice when receipts await the CEO/CTO's confirmation**; `pbx_close_settlement` notifies the PM. (E P9.) |
| **Proposed** | **PM:** 1. Open the "Actual expenses" tab: the draft is created on opening (no Start button). 2. For each line type the amount; "Who paid" is preselected to the PM; "How paid" repeats the last choice; a "Same for all lines in this category" shortcut; "Set remaining blank lines to 0" (with confirmation). 3. Tick the completeness confirmation; variance note if needed. 4. Submit. **Finance:** 1. "Needs me" rows: "Final expenses waiting for you" and "Settlement: record receipts / payments / close" (grouped "Needs Finance now" vs "Waiting for the PM"). 2. Payment amount prefilled with the open balance (editable); "Record". 3. "Confirm reconciliation and close" (existing blockers list). |
| **Essential fields** | Actual amount per line; how paid and who paid when amount > 0 (kept required, now defaulted); completeness tick. Settlement: receipt status, amount, person, method. |
| **Defaults** | Who paid = PM (`proj_projects.pm_user_id`); How paid = previous line's choice, first line none; Payment amount = open balance from `pbx_settlement_figures`; person = first candidate (existing); date = today (existing). Zero-fill never silent: a confirmation names how many lines. |
| **Optional (collapsed)** | Note, "paid in another currency" box and note, split payment, existing-claim link. |
| **Next actor / how they learn** | Finance: "Needs me" from `pbx_inbox` (`final_expense_approvals`, `outstanding_settlement`, `i_can_close`); CEO/CTO on the executive route: row "Receipts waiting for your confirmation" (`i_can_confirm_receipts`), because today nothing tells them. PM: existing `project_actuals_decided` and `project_settlement_closed` notices plus rows "Final expenses returned". |
| **Confirmation shown** | PM: "Submitted. Waiting for Finance." Finance payment: "Recorded: AED 450 returned by A. Balance AED 0." Settlement: "Closed. <PM> was told." Tiles read "Known once the final expenses are approved" until approved actuals exist (no chasing for money mid-event). |
| **Before -> after** | PM 12 non-zero personal lines: **about 41 -> about 20** (tab 1-2 unchanged; Start button 1 -> 0; per-line 36 -> 16 [12 amounts + first "how paid" + up to 3 exceptions]; confirmation 3 unchanged). Finance payment per person per kind: **2 -> 1** when paying the full balance. Screens: unchanged (tab on the same record). Repeated selections: "How paid" 12 -> 1-4, "Who paid" 12 -> 0-3. **Targets: 12-line final expenses within 5 to 6 minutes when receipts and amounts are to hand; each payment entry about 30 seconds.** |
| **Roles / permissions** | Unchanged: PM prepares; Finance records funds, receipts, returns/reimbursements, closes (or executive approver on the executive route; the recorder or an actuals author cannot confirm); decider never the submitter. "Settled" keeps its existing definition. **Boundary respected:** physical receipt submission is untouched ("Receipts are handed to Finance in person; nothing is uploaded here"); no calculation changes (display gating of "to return" only); Zoho Books stays the invoice tool. No money moves in the system. |
| **Register dependencies** | F-E-13 [U-15]; F-E-10 [D-12]; F-E-11 [U-18]; F-E-01 (settlement part); F-E-16 [D-05]; F-E-17 [N-18, U-34]; F-E-15 [D-55]. |

---

## 5.11 Path 10. Finding an employee's leave and recovery balance and pending requests (view and navigation only)

No calculation, accrual, expiry, approval routing or Recovery Leave rule changes. Everything shown is read from records the viewer can already read.

| Item | Specification |
|---|---|
| **Today** | **Employee:** My Day -> sidebar "People & HR" -> "Leave" = **2 clicks, 2 page loads** -> `/leave`: stat cards per type with a ledger row + a card labelled **"Comp-off"** (the same balance the policy, request dropdown and approvals call **Recovery Leave**); "My requests" with status. **Pending Recovery Leave earning requests are not on `/leave`:** My Day -> People & HR -> "My Profile" -> tab "Leave" = **3 clicks, 3 loads**. When Recovery days expire: **nowhere** (no screen reads `comp_day_ledger`). The leave form shows no balance and no approver (F-F-22). **Manager/HR:** People & HR (1) -> type name (typed) -> row (2) -> tab "Leave" (3) = **3 clicks + 1 typed search, 3 page loads per person**, repeated per person; no "all pending" list, no team balances (F-F-07). For 5 reports: 1 + 5x3 = **16 interactions, 11 page loads**. A Reporting Manager gets the Leave tab only for **direct** reports although RLS allows the chain (F-F-23). HR tile "Leave requests in review" links to the viewer's own `/approvals` (F-F-06). (F 5.1, 5.2.) |
| **Proposed** | **Employee:** 1. My Day card "My leave": balances per leave type and "Recovery Leave", count of requests waiting (headline readable with no click). 2. Click it -> `/leave`: the card is renamed "Recovery Leave"; a "Waiting for approval" list includes Recovery earning requests (type, work date, days, status, and the next approver **role in words**); read-only line "Next Recovery Leave expiry: <date>" from `comp_day_ledger.expiry_date`; link "How Recovery Leave works" to the active policy. **Manager/HR/Finance/CEO-CTO:** 1. People & HR -> Leave (or My Day card "My team"). 2. A "Team" table at `/leave` for people the viewer may read: name, balance per annual-type, Recovery Leave balance, pending requests count, next approved leave. 3. Click a row for the profile Leave tab. The Approvals leave card gains the employee's name as a link and the actual balance number (not just "Insufficient balance"). |
| **Essential fields** | None (view). |
| **Defaults** | Team table scope: **direct reports** for a Reporting Manager (matches today's UI; chain-aware list waits for the owner's answer to F-F Q2); HR Admin = their company or companies; Finance, CEO and CTO = companies where those roles apply per the existing ledger policies. Sort: people with pending requests first. |
| **Optional (collapsed)** | Per-type detail, last 20 requests, ledger history (only if the existing records are exposed to the viewer). |
| **Next actor / how they learn** | None for a view. For a pending leave request the approver is the direct manager (`resolve_approver`) and learns by email (existing, best effort) plus the "Needs me" row; Recovery credit approvers (project lead, HR queue) currently get nothing: row via the same list (F-F-21). The requester can see **who** the approver is (display only). |
| **Confirmation shown** | None. Failures: "Could not load leave balances. This is not zero." (today a failed read shows "Comp-off 0 days" or 0 balances, F-F-02/F-H-07). Where a viewer's role cannot read a column (Recovery requests have no CEO/CTO read branch, F 4.2) the cell shows "-" with "Not visible to your role", **never 0**. |
| **Before -> after** | Employee balance: **2 clicks / 2 loads -> 0 clicks (My Day card) or 1 click**; pending Recovery earning request: **3 clicks / 3 loads -> 1 click / 1 load**; expiry date: unreachable -> visible. Manager with 5 reports: **16 interactions / 11 loads -> 2 clicks / 2 loads** to see all five balances and pending counts (+1 click / 1 load only when opening one person). HR "N pending" tile: dead end -> one-click list. Repeated selections: per-person search 5 -> 0. **Targets: own balance within 10 seconds; team balances within 30 seconds.** |
| **Roles / permissions (who may see whom)** | Self always; direct manager (UI) / chain manager (RLS `leave_requests_select`, `leave_ledger_select`, `comp_ledger_select`, `is_manager_of`) - launch lists direct reports only; HR Admin of that company (`has_role('hr_admin', company)`); Finance and CEO/CTO of that company (policies `20261112`, `leave_ledger_select_clevel`, `comp_ledger_select_finance_clevel`); peers see nothing; a person in another company never appears; an ordinary employee has no Team table. System Administrator reads employee rows but is not in the leave policies (F 4.2). Skip-level visibility and the direct-versus-chain mismatch are an **owner decision** (F-F-23); no boundary is changed. |
| **Register dependencies** | F-F-07 [U-09]; F-F-08 [U-05]; F-F-06 [D-42]; F-F-22 [U-05]; F-F-02 / F-H-07 [D-03]; F-F-23 [D-57]; **F-H-01 / F-F-01 [D-01]** *Confirmed (code, hosted state unverified): check Vercel Cron history. If monthly accrual and Recovery expiry are not running, balances shown here may be stale; the new screens would display them faithfully and must not be launched as "trusted" until the owner confirms the jobs run.* |

```
MY TEAM . LEAVE                                           [ Request leave ]
+-----------------------------------------------------------------------+
| Name        Annual   Sick   Recovery   Waiting   Next approved leave    |
| Omar K.     14.0     6.0    2.0        1         18 Nov - 20 Nov        |
| Priya S.    9.5      6.0    0.0        0         -                      |
| Lee T.      21.0     5.0    -(1)       0         02 Dec                 |
+-----------------------------------------------------------------------+
(1) Not visible to your role     ( Open Omar's leave tab )
```

---

## 5.12 Path 11. Reviewing approvals, and the proposed "Needs me" listing

Independent approvals stay independent: each approval, budget decision, handover acceptance, scope decision and task review keeps its own screen, function and routing. "Needs me" only reads and links.

| Item | Specification |
|---|---|
| **Today** | Line manager: My Day shows "Waiting on your decision N" (counts only rows with `approver_id = me`; **queue rows are not counted**, F-A-12/F-E-02) -> sidebar "Approvals" (1; no count; shown only when a role or pending item exists) -> per-type cards. Leave row: employee, type, dates, days, reason, "Insufficient balance" badge, Approve/Reject. **Approve = click + native confirm = 2; Reject = 3 with an optional reason**; claim row shows the first 8 characters of an id and opens the claim page which has **no** decision buttons; no bulk; no waiting time (`created_at` selected, never shown). HR: Recovery credits card (evidence, "Checked with", correction) approve+confirm = 3. **CEO/CTO checking everything once:** My Day (1 screen) -> Approvals (1) -> approve + confirm (2) -> Finance > Project budgets (1) -> row (1) -> Approve (1) = **6 clicks, 4 screens** (My Day, Approvals, Finance inbox, record), with 0 prompts telling them either inbox has items. On a failed read `/approvals` says "Nothing waiting on you right now." (F-E-03 / F-H-03). Approver unavailable: no delegation, reassignment or escalation (F-E-07). (E P11, A 2a.) |
| **Proposed** | 1. Open My Day: "Needs me" block with oldest items first and a per-source grouping, or the header chip "Needs me (N)" for the full list. 2. Each row says what, for whom, how long it has waited, and links to the existing decision screen (`/approvals` anchored to the row; `/finance/project-budgets/<id>?section=...`; `/projects/handovers`; `/projects/<id>/changes`; the task panel). 3. Decide on the existing screen. `/approvals` keeps one decision per click; the native confirm is replaced by a single inline confirm for leave, claim and timesheet only; payroll and Recovery credit keep a confirm because they post immediately (F-E-05); rejecting asks a reason (required, like budgets) with quick reasons. |
| **Essential fields** | None to list. To reject: reason. |
| **Defaults** | Source rows exist only if the person holds the matching existing right; order = longest waiting first; per-source caps (3 shown, "See all"); amber label after N days (threshold is an **owner decision**, F-G Q4; display only). |
| **Optional (collapsed)** | Source filters (later: "as approver / as PM / as HR"), items I cannot act on yet ("Waiting for the CEO or CTO"), on-hold items. |
| **Next actor / how they learn** | The requester learns the result as today (leave: email; claim/timesheet/letter: on opening the item) plus a display of the approver's **name** on their request ("Waiting for <name>", F-F-22/F-E-07, no rule change). The next approver in a chain learns from their own Needs me row. Recovery Leave approvers (project lead, HR queue, CEO/CTO queue) get rows and a count (queue rows included, F-F-21). |
| **Confirmation shown** | On decision the existing screen's message; list updates and the row disappears; failure of a source: "Could not load budgets. This is not an empty list." |
| **Before -> after** | Line manager, one leave request: My Day -> Approvals -> approve = **3 clicks, 2 screens -> 2 clicks, 2 screens** (inline confirm; row opens `/approvals` at the item; it would stay 3 if the confirm is kept for that type). CEO/CTO, one approval and one budget: **6 clicks / 4 screens -> 4 clicks / 3 screens** (row -> Approvals, approve; back to My Day row -> record, Approve). The gain that matters is discovery: **0 prompts today -> a count and a waiting time on the first screen**, including queue approvals and budgets that are invisible today. Repeated selections: sidebar hunting 2 -> 0. **Target: clearing one routine approval within 15 seconds; scanning the whole list within 1 minute.** |
| **Roles / permissions** | Each row is shown only when the viewer's own session returns it: `approvals` (`approver_id = me`, or queue rows with `queueDecisionEligible`), `pbx_inbox()` flags (`i_can_decide`, `i_can_close`, `i_can_confirm_receipts`, not `on_hold`), `proj_handovers` (`assign_pm`/named PM), `proj_scope_changes` (`approve_scope`/founder), reviews (PM/head/founder, never own work). Self-approval is refused in SQL (`decide_leave_approval`, `pbx_version_guard`); the list never offers to decide on someone's behalf and never lists a row the viewer authored. **Rejected idea:** storing a dispatch acknowledgement or any non-approval in `approvals`: it would be counted but render nowhere, and mixes a non-binding step into the independent-approvals audit trail (D F-D-06). |
| **Register dependencies** | F-E-04 [N-02, U-06]; F-E-02 / F-A-12 [D-21]; F-E-03 / F-H-03 [D-02]; F-E-05 [U-08]; F-E-06 [U-07]; F-E-07 [U-07, DEC-22]; F-E-08; F-F-21; F-B-06 / F-B-07; F-A-14. |

```
NEEDS ME  (7)                          Waiting longest first
+--------------------------------------------------------------------+
| Approvals            2   Leave: Omar K. 18-20 Nov        waiting 3 d |
|                          Claim: Priya S. AED 240         waiting 1 d |
| Budgets              1   Gala 2026 budget (Finance)      waiting 2 d |
| Handovers            1   Expo Hall 4: PM asked a question  today     |
| Scope change         1   Gala 2026: stage extension      waiting 1 d |
| Blocked              1   Stage power plan  [you can unblock]         |
| Could not load: Equipment requests   ( Retry )                       |
+--------------------------------------------------------------------+
   Rows open the screen that decides. Nothing is decided here.
```

---

## 5.13 Path 12. Identifying critical company issues as CEO (existing data only)

| Item | Specification |
|---|---|
| **Today** | There is no company-wide exceptions list (searched `blocked`, `at_risk`, `critical`, `overdue`, `health`, `escalat`, `exception`, `stuck`, `aging`). To check all areas a CEO opens: My Day (screen 1: decisions count, HR half, project status donut with **counts but no names**), `/approvals` (2), `/finance/project-budgets` (3, only with a Budget grant; not counted on My Day), `/projects` (4; no health filter, cannot name blocked projects), `/sales/follow-ups` (5), `/inventory` Today (6, only with an Inventory grant), `/alerts` (7). **At least 6 further screens and 6 clicks, and still no list of blocked projects, overdue handovers or overdue equipment by name.** Project health counts only projects where the CEO is a member or Projects founder; project, Sales and equipment cards appear only if the CEO also holds those separate grants. Failures read as zeros (F-A-02/03/04), so "nothing wrong" cannot be told from "could not load". (A 5.3, G 6A.) |
| **Proposed** | 1. Open My Day: a CEO/CTO card "Needs attention", each line a count with the first names, each linking to the existing page. 2. Click a line to open the page that handles it. Lines (each only if the CEO's own grants allow the read): **Decisions waiting on me** (own approvals incl. queue; oldest age); **Budgets and expenses awaiting my decision** (`pbx_inbox`, executive approver); **Blocked projects** (first 3 names from `proj_tasks.blocked_at` on projects the CEO can open) and **Projects with overdue milestones** (`proj_milestones`); **Handovers waiting more than N days** (`proj_handovers` submitted / pm_assigned, only where the CEO holds `assign_pm`); **Scope changes awaiting me** (`approve_scope`/founder); **Overdue equipment** (`inv_units.expected_return_at < now()` or `inv_availability` overdue, only where the CEO can view stock) and **Requests with a shortage**; **HR attention** (existing contracts/probation/documents block; Identity documents shown as "HR Admin only" instead of 0, F-G-16); **Recovery scheduler health** only for HR/Sys Admin. |
| **Essential fields** | None. |
| **Defaults** | Which lines appear = the CEO's existing grants (Projects founder or member, Inventory viewer, Budget approver, Sales founder), exactly what People & Access already grants. Thresholds N (days) are an **owner decision**; proposed starting values for review, not rules: handovers 2 working days (G 6A), approvals 3 days, equipment returns overdue by 1 day. |
| **Optional (collapsed)** | Full lists behind each line ("See all"); "Projects you cannot open: N (summary only)" so the count is not mistaken for completeness. |
| **Next actor / how they learn** | The CEO is the next actor for their own rows. Each line points to the person who must act (PM, Finance, warehouse); the CEO does not reassign anything in this proposal. |
| **Confirmation shown** | "All clear" only when every source loaded and returned none; otherwise per-line "Could not load <source>" so a false all-clear is impossible. |
| **Before -> after** | **At least 6 further screens and 6 clicks, incomplete -> 1 screen, 0 clicks to scan, 1 click to open an item.** Assumption: the CEO holds the grants whose data they want to see; without them the corresponding line is absent, honestly labelled "Not part of your access". **Target: the whole scan within 1 minute.** |
| **Roles / permissions** | **Existing data only, existing rights only.** A CEO/CTO title confers no Projects, Sales, Inventory or Budget access ("never inferred from HR roles"). Company-wide aging of **other people's** approvals is not readable to a CEO (`approvals_select`), so it is **not proposed**. Whether a CEO should hold read-everything rights is an **owner decision** (A Q1, G F-G-17): option (a) no model change, use an "Executive" set of existing grants (Sales basic, Projects founder or basic, Inventory viewer, Budget approver; Projects founder also lets the person assign PMs, approve scope, reopen and manage access); option (b) a new read-only Projects capability needs a migration and widens confidential-project access, so it is **not proposed**. Company boundaries and confidential-data access are untouched. |
| **Register dependencies** | F-A-15 [N-08]; F-G-21 [N-08]; F-G-17 [N-22]; F-A-02/03/04 [D-02, D-04]; F-E-01; F-B-01; F-G-16 [D-58]; F-H-02 [D-25]. |

```
NEEDS ATTENTION . CEO                                          Mon 2 Nov
+---------------------------------------------------------------------+
| Decisions waiting on me      3   oldest 4 days        ( Open )       |
| Budgets awaiting my decision 1   Gala 2026            ( Open )       |
| Blocked projects             2   Expo Hall 4, Gala 2026 ( Open )     |
| Handovers waiting > 2 days   1   Marina Launch        ( Open )       |
| Equipment overdue            4 units, 2 projects      ( Open )       |
| HR attention                 5   contracts 3, docs 2  ( Open )       |
| Could not load: Overdue milestones  ( Retry )                        |
| Not part of your access: Sales pipeline                              |
+---------------------------------------------------------------------+
```

---

## 5.14 "Needs me" source list (the rows B2 can show)

Every row reads an existing record under the viewer's own session. No service-role client. "Launch" means in the first release of Needs me.

| # | Row | Existing source | Shown to | Links to | Launch? | Finding |
|---|---|---|---|---|---|---|
| 1 | Approvals assigned to me | `approvals` (`decision = pending`, `approver_id = me`) | the approver | `/approvals` row | Launch | F-A-02, F-E-03 |
| 2 | Queue approvals I may decide | `approvals` with `approver_id is null` + `queueDecisionEligible` | HR, CEO/CTO per route | `/approvals` | Launch | F-A-12, F-E-02, F-F-21 |
| 3 | Budgets, final expenses, settlement I can act on | `pbx_inbox()` flags (`i_can_decide`, `i_can_close`, `i_can_confirm_receipts`, not `on_hold`) | Budget grant holders | `/finance/project-budgets/<id>` | Launch | F-E-01 |
| 4 | Budget returned / approved (PM side) | unread `project_budget_decided` notices (PM is a participant); small read function for versions is later | PM | `/projects/<id>/budget` | Launch (notices); function later | F-E-01 |
| 5 | Task reviews waiting | `loadMyWork().reviews` | PM, head, founder | `?show=review` | Launch | F-B-10 |
| 6 | Handover waiting (assign PM / accept) | `proj_handovers` submitted / pm_assigned | `assign_pm`, named PM | `/projects/handovers` | Launch | F-B-09a |
| 7 | Handover: PM asked a question / accepted | `proj_handover_for_opportunity` | Sales owner, preparer | enquiry handover page | Launch | F-B-04 |
| 8 | Won with no handover | `crm_opportunities.stage = won` left join `proj_handovers` | owner (prompt); founders after N days | handover page | Owner prompt: launch; founders after N: owner decision on N | F-B-01 |
| 9 | Scope change waiting my decision | `proj_scope_changes.status = proposed` | `approve_scope`, founder | `/projects/<id>/changes` | Launch | F-B-07 |
| 10 | Blocked: waiting on me to unblock | `proj_tasks.blocked_at`, `unblock_owner_id`, PM | named person, head, PM | task panel | Launch | F-B-17 |
| 11 | Sales follow-ups due / overdue / assigned to me | `crm_follow_ups`, `attentionItems` | Sales grantees | `/sales/follow-ups` | Launch | F-B-07 |
| 12 | Equipment: requests to prepare, returns due, transfers on the way | Inventory Today computation (`today-data.ts`) | warehouse operators | `/inventory` | Launch (count + link) | F-C-17 |
| 13 | Equipment sent: confirm what arrived; differences reported | dispatch / return note state (proposed, Section 6) | PM; warehouse | note / Equipment tab | Depends on Section 6 | F-D-01..11 |
| 14 | Unread project notices | `proj_my_notifications` | project participants | `/projects/work` notices | Launch (one row with count) | F-A-14 |
| 15 | Budget on hold: no independent approver | `pbx_approval_on_hold` | `manage_access` holders | People & Access | Later | F-E-08 |
| 16 | Client feedback assigned to me | `proj_feedback.responsible_user_id` | the person responsible | changes page | Later | F-B-23 |
| 17 | Commercial approval waiting | `crm_approvals.state = pending` | Sales founder (default policy `not_configured`) | enquiry Commercial tab | Later | F-B-07 |
| 18 | Document expiring, notices of types no screen reads | `notifications` (`document_expiring`) | employee, HR | Documents tab | Later (cron must run first) | F-A-09, F-H-01 |

---

## 5.15 Before-and-after summary (targets, not measurements)

| # | Path | Today (screens / clicks / typed) | Proposed | Target time |
|---|---|---|---|---|
| 1 | Find today's work | 2 / 2 (3 to open) / 0 | 1 / 0 (1 to open) / 0 | under 10 s |
| 2a | Update a task | 2 / 3 / 0 (review: 4) | 1 / 1 (review: 2) / 0 | about 5 s |
| 2b | Report a blocker | 2 / 5 / 2 fields | 1 / 2 / 1 field | under 1 min |
| 3 | Site instructions and references | 4-5 / 5-8 / 0 | 2 / 3 / 0 | under 30 s |
| 4a | New enquiry | 1 / 7 actions | 1 / 6 actions (+1 if organisation missing, was +4) | about 2 min |
| 4b | Call plus next follow-up | 2 dialogs / about 10 | 1 dialog / about 6 | about 1 min |
| 5a | Staff a team and assign first tasks (3 people, 1 team, 3 tasks) | 3 / 28 | 3 / about 22 | 5-6 min |
| 5b | Client feedback to approved scope change | 3 / about 14 | 3 / about 10 | 1 min to record |
| 6a | PM equipment request (3 items) | 3 loads + 15 | 3 loads + 9 (template 9 -> 6) | about 3 min |
| 6b | Employee equipment request | 1 / 12 (+4 on failed submit) | 1 / 10 | about 3 min |
| 7 | Reserve 12 lines / send out / clean return | 24 / 9 / 26 | 24 (2 only under U-24 option B or C) / 9 / about 16 (about 9 with per-item tick-all) | depends on U-24 / (n/a) / about 5 min (targets) |
| 8 | 10-line budget; Finance decision | 30-60; 2 clicks, 2 screens | 24-48 (copy later: 10-25); 1 click from My Day | 5-6 min; about 1 min |
| 9 | 12-line final expenses; payment entry | about 41; 2 per payment | about 20; 1 per full payment | 5-6 min; about 30 s |
| 10 | Own balance; pending Recovery; team of 5 | 2 clicks / 2 loads; 3 / 3; 16 / 11 | 0-1 click; 1 / 1; 2 / 2 | 10 s; 10 s; 30 s |
| 11 | Clear one routine approval; CEO checks approvals + budget | 3 clicks / 2 screens; 6 / 4 | 2 / 2; 4 / 3 | 15 s; 1 min scan |
| 12 | CEO scans critical issues | 6+ more screens, incomplete | 1 screen, 0 clicks | 1 min |

**Tally.** Screens or page loads removed: paths 1, 3, 10 (employee), 10 (team) and 12 remove 1 to 9 screens each; paths 2, 4, 5, 6, 8, 9, 11 mainly remove clicks and repeated selections; path 7 removes up to 22 of 24 prepare clicks (only if the owner chooses U-24 option B or C) and about 10 of 26 return interactions with the condition helper (about 17 with per-item tick-all). The largest honest gain across all twelve is **discovery**: the next actor currently learns by visiting in paths 2, 4, 5, 6, 7, 8, 9, 10 (Recovery), 11 and 12.

---

## 5.16 Evaluation of the three proposals

| | **A. Improved My Day** | **B. "Needs me" shared action inbox** | **C. Record search** |
|---|---|---|---|
| **What it is** | My Day shows my work (B1), honest failure states, one block per fact, a Needs me block. | One list (B2) of rows computed from existing records, on My Day and as a full page behind a header chip. | The existing command palette (Ctrl/Cmd+K, today only a page jumper, `command-palette.tsx`) gains a "Records" group fanning out to existing loaders. |
| **Pros** | Fixes the daily entry point (today counts only: 2 screens to read a title); removes false all-clear states (LB); no new data; works for people holding several responsibilities by stacking their own rows. | Solves the "next actor learns by visiting" problem across Projects, Sales, Budget, Approvals and Inventory in one place; one row shape; reuses all existing screens; no decision logic moves. | Cuts 3-5 actions across 2-3 screens to 2-3 for projects, enquiries, tasks, stock items; one fix replaces eight lists. |
| **Cons** | A busy page for multi-role people (about 20 blocks today) unless blocks are pruned (F-A-16); weather and serial loads slow first paint (F-H-19). | Is only as good as its sources: a source that fails must say so; thresholds ("waiting N days") need an owner decision; risk of becoming a second inbox if rows ever get their own state, so **no dismiss/snooze at launch**. | Fan-out under the viewer's RLS means each source can be empty or fail separately; ordinary staff cannot find colleagues (needs an owner decision on a staff directory, A Q3); files and site information are not indexed. |
| **Existing records reused** | `proj_tasks`, `crm_follow_ups`, `approvals`, `proj_handovers`, `loadWorkRows`, `buildActionItems`, `DecisionsCard`. | `approvals`, `pbx_inbox()`, `proj_handovers`, `proj_scope_changes`, `proj_tasks`, `crm_follow_ups`, `crm_approvals`, Inventory Today, `notifications`. | `proj_directory`, enquiry list, task filter, `inv_items`, `employees` (per grant). |
| **Technical scope** | Interface + server read logic. No migration. | Interface + server read logic; one small read function for PM-side budget state later. No migration for the launch rows. | Server action + interface; migration only for a staff directory function (not proposed now). |
| **What it does NOT replace** | Sidebar, module pages, the decision screens, the HR section for HR/C-level. | `/approvals`, the Finance inbox, handover, task panel, scope-change and review screens. It adds **no** new approval, status, queue or task entity. | Module list filters and the sidebar. It is a finder, not a report. |
| **Boundary check** | Unchanged: company boundaries, confidential data (rows pass through the viewer's RLS). | Independent approvals untouched: rows never decide, never list a row the viewer authored. | No service-role client; no cross-company reads; an unreadable source says "could not search", never "no results". |
| **Recommendation** | **Launch.** | **Launch (v1 as defined).** | **Later**, except a launch slice if capacity remains after A and B: Projects, Enquiries, stock items (existing loaders, no migration, no staff directory). |

**Recommended build order**

1. **Launch, first:** B3 honest failure states (F-A-02, F-A-04, F-E-03, F-H-03, all LB); B1 "My work today"; the inline status and blocker controls; fix "Needs you" links (F-B-10).
2. **Launch, second:** Needs me v1 on My Day plus the header chip and full page, with rows 1-12 and 14 from 5.14; the status labels naming the real approver (F-E-09); Finance and executive rows (F-E-01, LB).
3. **Launch, with Section 6 (recommended order):** the dispatch note and PM acknowledgement first (row 13); the return checklist and PM confirmation as the second increment, after the one safe return screen with the condition helper (D-28, U-23), the kit-contents check (N-05) and the held-unit follow-up (N-06). See Section 9, Stage 3.
4. **Launch improvements that do not depend on the above:** team leave table and Recovery Leave display (path 10); multi-add people and checklist (path 5); duplicate budget line, actuals defaults (paths 8-9); equipment request defaults and the "optional" label fix (path 6); CEO "Needs attention" card (path 12, once the owner answers thresholds and grant questions).
5. **Later:** record search beyond the launch slice, copy-budget, source filters on Needs me ("as approver / PM / HR"), configurable thresholds as company settings, a header bell with a dropdown, email digests, notices through the existing `notifications` table for inventory events (F-C-18), staff directory, on-hold row for access managers, feedback and commercial-approval rows.

---

## 5.17 Owner decisions this section depends on

*These are consolidated, with recommended defaults, in Section 8.*

1. Thresholds N for "waiting too long" (handovers, approvals, equipment returns) and whether founders see "won, no handover" after N working days (B Q1, G Q4). Display only; no rule changes.
2. Whether CEO/CTO get read-everything visibility, and by which route (option (a) existing grants; option (b) new capability not proposed) (A Q1, G Q2).
3. Skip-level (chain) managers in the Team leave table (F-F Q2). Launch lists direct reports only.
4. Who may acknowledge a dispatch or return when the PM is unavailable (D Q3), and whether differences may ever lead to a correcting movement by the warehouse (D Q4). Both belong to Section 6.
5. Whether a Sales-linked project member is gated into My Work, or must hold a Projects grant first (F-B-05, B Q3).
6. Whether line managers and acting PMs may request equipment (F-C-19, G Q5).
7. Whether staff may look up colleagues by name (A Q3); needed for full record search and for the clock's project-lead list (F-A-07, protected attendance area, flagged not changed).
8. Whether the monthly and daily jobs are actually running in production (A Q4, H F-H-01): check Vercel Cron history before launch; path 10 balances depend on it.


---

# 6. Dispatch note, return checklist and PM acknowledgement (specification)

**Status:** new functionality; proposal for owner review. Nothing here is built. Facts are from the investigation of `main` at `76c121b` (evidence: findings D and C; `path:line` references are to `supabase/migrations/…` and `apps/web/src/…`).

## 6.0 The idea in one paragraph

When the warehouse **records** a dispatch (or a return), the system keeps a **frozen, numbered copy of exactly what was recorded**, shows it to the project's Project Manager (PM) as a short list to **acknowledge** (or to dispute line by line), and can print or download it as a branded PDF. The recorded movement stays the only authority for where equipment is. The note, the PM's acknowledgement and any dispute are **separate records beside the ledger**: they never move stock, never change availability, and never rewrite what was recorded.

## 6.1 Facts that shape the design (verified)

| # | Fact | Consequence for the design | Evidence |
|---|---|---|---|
| 1 | A dispatch movement stores project, optional request, source location, expected return, one header note, who recorded it, and per-line unit/item/qty/condition. It stores **no destination text, no time zone, no PM/receiver, no serials or item names** (those live in editable tables). | The note must **snapshot** destination, zone, serials, item descriptions, names and the PM at the moment of recording. Joining live tables later would silently change an acknowledged document. | `inv_movements` / `inv_movement_lines` (INV1:284-342); INV3:1883-1946 |
| 2 | The ledger cannot be edited or deleted by anyone, and dispatch/return lines **cannot be corrected, only reversed** by recording a new movement. | A "correction" of a note is always a **new movement and a new note** that cites the old one. There is no in-place revision. | INV1:349-360; INV3:2932-2938 |
| 3 | A PM **cannot read any movement row**: ledger access needs `warehouse` or `view_stock`. A PM reads only `inv_project_equipment` and requests/reservations. | PM-facing notes need their own member-readable record (snapshot table with its own policy) or a new read function. A client query of the ledger as the PM would return nothing. | INV1:446-452, 505-509; INV8:20-23 |
| 4 | A reservation's `dispatched_qty` is a derived counter; it does not say which movement sent what. | A note is built from the **movement lines**, never from reservations or from a "prepared list". A prepared/reserved item cannot appear as dispatched. | INV2:124-146; INV3:642 |
| 5 | A return has **no link** to the dispatch it reverses or to a request line. Counted stock is matched by project + item. | The return checklist is built against **what the ledger says the project holds**: units exact, counted stock **at project level**. No request-line attribution is guessed. | INV3:1966-1968, 2006; `lib/inventory/workspace.ts` |
| 6 | A "held" unit is simply an active unit on the shelf whose condition is not good/fair (or a counted balance not good). Only `inv_check_condition` releases it, by any operator at that location. | PM confirmation must not touch conditions. Any change of availability stays a warehouse action in the ledger. | INV3:2749-2793; INV2b:50-107 |
| 7 | `notifications` exists but is information only, is read only on Projects → My Work, is dropped silently for an ineligible PM or for the actor, and is **deleted** when a member is removed. No Inventory code writes it. | A pending acknowledgement must live on the **note row**, queryable per project and in "Needs me". A notice is a convenience, never the only trace. | PRJ2:77-101, 798, 965-967; `lib/projects/my-work.ts` |
| 8 | The Approvals inbox counts `approvals` rows of any type and renders only six hard-coded types; `decision='rejected'` ends a workflow. | Do **not** store acknowledgements as approvals: it would inflate the count with items the page cannot render, mislabel "report discrepancy" as rejection, and mix a non-binding acknowledgement into the independent-approval audit trail. | `approvals/page.tsx:42-79`; `lib/actions/approvals.ts:35-47` |
| 9 | There is an existing, working pattern for "frozen content, mutable acknowledgement": `proj_issued_plans` (frozen payload + guard trigger, post-issue fact columns), and PDFs rendered on demand from the frozen payload under the caller's own RLS. | Reuse that pattern: **frozen payload + hash + guard trigger + on-demand PDF**. | PRJ5:192-209, 649-650; `projects/[id]/documents/plans/[planId]/pdf/route.tsx` |
| 10 | PDF tooling already exists (`@react-pdf/renderer`, Node runtime, brand logo and Carlito fonts under `public/brand` and `src/lib/pdf/fonts`). Whether the fonts are traced into the Vercel bundle is **unverified**. | No new library. Verify the font path on a preview deployment before relying on it. | `lib/pdf/plan-document.tsx` |
| 11 | Inventory numbering (`inv_next_code`) is per company, never reset by year, race-safe, and **rolls back with a failed movement**. | A dedicated counter gives contiguous numbers with no gaps from failures. | INV0:221-242 |
| 12 | PM identity today is `proj_projects.pm_user_id` + member row; acting PM has an expiry date; `proj_can_manage` also admits Projects founders; PM changes are logged by name in `proj_change_log`. | "Who may acknowledge" = whoever satisfies `proj_can_manage` **at the time of the click**, with the capacity recorded. | PRJ1:371-383, 432-440; PRJ2:472-498 |

## 6.2 Recommended defaults (for owner review)

| Decision | Recommended default | Why |
|---|---|---|
| What the PM's click means | "**I acknowledge this recorded dispatch list**." Not "I physically received it". | The warehouse record is the custody authority; the PM may not be on site. |
| Does dispatch wait for the PM? | **No.** Dispatch proceeds; acknowledgement is pending until the PM acts. | Warehouse speed and site schedules must not depend on one person's inbox. |
| Identity | Authenticated ENGINIOUS OS account: **name + timestamp** (+ capacity: PM / acting PM / Projects founder on behalf). No signature image. | Simplest; no legal claim. |
| Legal wording | PDF says "Acknowledged in ENGINIOUS OS by NAME on DATE (authenticated account). Internal acknowledgement, not a qualified electronic signature." | Avoids any digital-signature claim. |
| Before acknowledgement | PDF carries a clear **"ACKNOWLEDGEMENT PENDING"** band. | Printed copies must never look acknowledged. |
| After acknowledgement | Content stays exactly as recorded; later corrections create a **new** note citing the old one; the old one shows "Superseded by …". | "Do not silently rewrite." |
| Numbering | A dedicated counter per company: dispatch note `UAE-D-00017`, return checklist `UAE-RT-00005` (prefix from the company's existing reference code). Each prints the **ledger reference** (`UAE-M-00031`). | Contiguous, race-safe, one number to quote; ledger ref keeps traceability. |
| Revisions | **None in place.** One immutable note per movement. The PDF prints "Issue: original" or "Replaces UAE-D-00017". | Simplest revision rule that cannot rewrite history. |
| Which company numbers it | The **warehouse location's company** (same as the movement). The project's company is printed too when different (cross-company sharing). | Matches `inv_movements.company_id`. |
| Which movements | `dispatch_project` and `return_project` at launch. Project-to-project transfers (recorded by a PM, not the warehouse) later. | Keeps launch scope bounded. |
| PDF model | Rendered **on demand from the frozen payload** (no stored file). | No bucket/policies; cannot drift. |
| Creation | **Option A (recommended): atomically inside the movement transaction**, by appending one `perform inv_make_project_note(movement_id)` to `inv_dispatch_to_project` and `inv_return_from_project`, behind a per-company switch that is **off by default**. **Option B (fallback): leave both functions unchanged**; the server action calls a separate `inv_make_project_note(movement_id)` right after the movement is recorded. | A: no dispatch without a note, no note without a dispatch, snapshot taken at the instant of recording. B: zero change to the two critical functions, but a failure between the two calls leaves a movement without a note, so it needs a repair path (Today row "dispatch recorded, note missing: create it"; creation is idempotent because the note is unique per movement) and the snapshot is taken a moment later from catalogue text that could already have changed. Owner decision D-note-1 (6.9). |
| Notification | In-app notice **plus** a queryable "waiting for you" state. E-mail later. | Notice alone is not durable (fact 7). |
| Dispute and stock | A dispute **never** changes custody or availability. Any change is a separate, logged warehouse action. | PM confirmation must never record a second movement. |

## 6.3 Dispatch note: contents

One PDF, A4, ENGINIOUS look (the plan-PDF style: logo top-left, teal heading band, one table, fixed footer "Page N of M"), not the full letterhead.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [ENGINIOUS logo]                         DISPATCH NOTE               │
│                                          UAE-D-00017 · Issue: original │
│ ▓▓▓ ACKNOWLEDGEMENT PENDING ▓▓▓  (or: Acknowledged by … on …)        │
├──────────────────────────────────────────────────────────────────────┤
│ Project      UAE-P-2026-0007 · Mall activation                       │
│ Destination  Dubai Mall, Level 2 service entrance   (request UAE-R-…)│
│ From         Dubai warehouse                                          │
│ Dispatched   14 Nov 2026, 07:42 (Asia/Dubai)        Ledger UAE-M-00031│
│ Expected back  21 Nov 2026, 17:00 (Asia/Dubai)                       │
│ Recorded by  A. Warehouse (Warehouse operator)                       │
│ Project Manager at dispatch   M. Manager                              │
├──────────────────────────────────────────────────────────────────────┤
│ #  Item                          Equipment ID / serial     Qty   Cond│
│ 1  Laptop 14 inch · Dell XPS     ENG-E-00012 / SN-88123     1    Good│
│ 2  Laptop 14 inch · Dell XPS     ENG-E-00013 / SN-88124     1    Fair│
│ 3  HDMI cable 5 m                —                         12 each Good│
│ 4  Power cable 3x1.5 mm          —                       15.25 m Good│
├──────────────────────────────────────────────────────────────────────┤
│ Acknowledgement                                                      │
│  Pending — the Project Manager has not yet acknowledged this list.   │
│  (after) Acknowledged in ENGINIOUS OS by M. Manager (Project Manager)│
│  on 14 Nov 2026, 09:10 (Asia/Dubai). Internal acknowledgement, not a │
│  qualified electronic signature.                                      │
│  [discrepancy history, if any: reported 14 Nov 11:02, resolved …]    │
├──────────────────────────────────────────────────────────────────────┤
│ Content ID 8f3a-c21d (matches the recorded list) · Generated 14 Nov  │
│ 2026 09:12 · Status as of generation              Page 1 of 1        │
└──────────────────────────────────────────────────────────────────────┘
```

* **Source of every row:** the immutable movement lines. Counted lines that were taken from several bins are **merged per item and condition** on the note. Units show equipment ID and serial from the **snapshot**, not the live unit.
* **Not shown:** reserved-but-not-dispatched items (a separate "Prepared, not yet dispatched" list can appear on screen only, never on the PDF), purchase costs, rental supplier prices.
* **Time:** dispatch instant shown in the warehouse location's time zone, with the zone name; the zone is stored in the snapshot (the ledger stores only UTC).
* **Content ID:** short hash of the frozen payload, so a paper copy can be matched to the system record.
* **Regenerating** the PDF later reproduces the same content; only the acknowledgement block and "status as of" line change.

## 6.4 Dispatch: sequence

```
Warehouse (Send out)          System                          PM                      Others
────────────────────          ──────                          ──                      ──────
1 records dispatch  ───────►  movement UAE-M-00031 recorded
                              + note UAE-D-00017 frozen       
                              (same transaction)
                              + notice to PM (if eligible)
2 sees "Download / Print"                                     3 sees "Waiting for you:
  on the success panel                                          acknowledge UAE-D-00017"
                                                                (project Equipment, My Day,
                                                                 'Needs me', notice)
                                                              4a Acknowledge ─► state:
                                                                 acknowledged (name, time)
                                                              4b Report discrepancy ─► pick
                                                                 lines + reason + comment
                              discrepancy appears on warehouse Today ("Dispatch note
                              UAE-D-00017: PM reports a difference")                    5 Warehouse reviews
                                                                                           (6.6)
```

**Essential fields.** Warehouse: nothing new (the existing Send out flow; the note is a by-product). PM: one button, or "Report a difference" with: which line(s) (tick), what is different (one of: *Not on site / Quantity differs / Different item / Condition differs / Other*), optional comment (required for *Other*).

**Partial and multiple dispatches.** Each dispatch movement makes its **own** note. A project with three dispatches has three numbered notes listed chronologically on Project → Equipment under "Dispatch & return notes", each with its own state chip. The existing Sent / Returned / Still out table is unchanged and remains the totals view; a **project summary PDF** (all notes, running totals) is a later item.

**Corrections.** A wrong dispatch is undone by the existing path (record a return, then dispatch again). The new dispatch creates a **new note** that prints "Replaces UAE-D-00017" and the old note shows "Superseded by UAE-D-00018" (the link is recorded by the warehouse when it resolves a discrepancy, see 6.6, or by naming the replaced note in the dispatch note's optional field). The old acknowledged note and its history are never altered.

**Retries.** One note per movement is enforced by a unique constraint on the movement. A double click or retried request returns the existing note. The movement itself already has the existing one-key idempotency and "check whether it went through" path.

**PM reassignment.** The note prints the PM **at dispatch**, but "who may acknowledge" is evaluated when someone clicks. After reassignment the new PM (or acting PM, or a Projects founder) sees and can act on all pending notes of that project; the acknowledgement records **who** acted and in **what capacity**. Notices already sent to the old PM are not the record (they can be dropped); the pending state on the note is.

**PM unavailable.** Nothing blocks. The note stays "Waiting for PM" and shows its age. It appears for Projects founders and `assign_pm` holders in their "Needs me" list after a configurable age (default 2 working days, owner decision). No auto-acknowledgement ever.

## 6.5 Return checklist: contents and sequence

**Trigger:** the warehouse records a return (existing Receive back). The system freezes a **return checklist** `UAE-RT-00005` for that batch.

```
┌──────────────────────────────────────────────────────────────────────┐
│ RETURN CHECKLIST  UAE-RT-00005 · Project UAE-P-2026-0007             │
│ Received at Dubai warehouse 21 Nov 2026, 16:20 (Asia/Dubai) by A. W. │
│ Ledger UAE-M-00044 · ▓ CONFIRMATION PENDING ▓                        │
├──────────────────────────────────────────────────────────────────────┤
│ This return (what the warehouse recorded as received)                │
│  Item                        ID / serial        Qty  Recorded outcome │
│  Laptop 14 inch              ENG-E-00012/SN-…    1   Back, available  │
│  Laptop 14 inch              ENG-E-00013/SN-…    1   Back, HELD:      │
│                                                       damaged         │
│  HDMI cable 5 m              —                  10   Back, available  │
├──────────────────────────────────────────────────────────────────────┤
│ Project totals after this return                                      │
│  Item            Sent   Returned before   Received now   Still out   │
│  Laptop 14 inch   2          0                 2             0       │
│  HDMI cable 5 m  12          0                10             2  ◄ project level│
│  (units are exact; counted stock is shown for the project, not per    │
│   request: the system does not guess which request it belongs to)     │
├──────────────────────────────────────────────────────────────────────┤
│ [ Confirm this list ]      [ Report a difference ]                    │
└──────────────────────────────────────────────────────────────────────┘
```

* **Sent / previously returned / received in this return / still outstanding** are computed by the existing rules in `lib/inventory/workspace.ts` (units exact; counted stock at project level), and **frozen** into the checklist at the moment of the return.
* **Outcomes in plain words** (mapped from the recorded condition, never chosen by the PM): *Back, available* (good, fair); *Back, held for checking* (needs checking, damaged, unserviceable). Counted stock has only good / needs checking / damaged.
* **Partial returns and several batches:** each return batch makes its own checklist; the "still outstanding" column always reflects the ledger at that moment. An item missing from a batch is simply still outstanding; there is no stored "short" flag (the ledger represents a short return by absence).
* **PM actions.** *Confirm this list* means "I acknowledge this recorded return list". *Report a difference* lets the PM tick lines and give a reason: *Not actually returned / Quantity differs / Condition differs / Something returned is missing from the list / Other*, with a comment.
* **PM confirmation never records a stock movement.** It writes one event row on the checklist. Warehouse receipt determines recorded physical custody.
* **Damaged or unchecked equipment cannot become available through PM confirmation**: the PM has no control over condition; availability changes only through the existing `inv_check_condition` action by a warehouse operator.
* **No request-line attribution** is shown or implied for counted stock.
* **No photos** are required or requested.

## 6.6 Discrepancies: owner, states, outcomes

A discrepancy is an **event on the note**, not a new workflow engine.

| State | Meaning | Who owns the next action | What the screen shows |
|---|---|---|---|
| Open | PM reported a difference (lines, reason, comment) | **Warehouse** (operators of the location that recorded it) | Row on warehouse **Today**: "UAE-RT-00005: PM reports a difference (2 lines)", age, link. PM sees "Reported, waiting for the warehouse". |
| Resolved: record stands | Warehouse reviewed and confirms the recorded list is right | Warehouse closes it with a note | PM sees the note and may acknowledge. |
| Resolved: corrected | Warehouse corrected the ledger by the **existing** actions (reverse and re-record; mark a unit missing/found; check condition). The resolution **links the new movement(s)/note(s)**. | Warehouse | Old note: "Superseded by …"; new note appears for acknowledgement. |
| Withdrawn | PM withdrew the report | PM | Closed with who/when. |

* **Does a dispute affect availability?** **No, by itself.** Warehouse receipt is the custody authority. If the warehouse agrees that a unit's condition is doubtful, it records that through the existing **condition check** (explicit, logged, by an operator), which is what holds the unit. If an item is reported **not returned**, it stays visible as **still outstanding on the project** (with the PM/project as the responsible party) until the warehouse records a return or records it missing through the existing stock adjustment (reason mandatory).
* **Explicit approval rule (recommended):** no new approval. Changes of custody or availability need exactly the permission they need today (operator at the location; `confirm_stock` where that applies). Any outcome that **removes** equipment from stock (missing/retired) remains a deliberate, reasoned warehouse action.
* **Never automatic:** no write-off, no reimbursement, no payroll deduction, no penalty, no change to a project budget. A discrepancy record states facts and owners; consequences remain with people and existing processes.
* **Audit trail:** events are append-only (who, what, when, comment). A PM who confirms and later notices a problem can still report a difference; both events stay.

## 6.7 What the PM, the warehouse and others see

| Person | Where | What |
|---|---|---|
| **PM / acting PM / Projects founder** | Project → Equipment, section **Dispatch & return notes**; **My Day** ("2 notes waiting for you") and the proposed **Needs me** list; the in-app notice | Number, date, state chip (*Waiting for you / Acknowledged by … / Difference reported / Superseded*), PDF button, Acknowledge / Report a difference |
| **Warehouse operator** | Send out / Receive back success panel; **Today**; History row for the movement | Download/Print right after recording; open differences as Today rows; a quiet "waiting for PM for N days" count on the project |
| **Project members (read)** | Project → Equipment | The notes and PDF (members can already read equipment state); no acknowledge action |
| **Sales-linked, ordinary staff** | nothing | Not shown |
| **Finance / CEO / CTO** | (later) the "needs attention" list | Open differences older than a threshold, if the owner wants it |

## 6.8 Data model and technical impact (specification only)

**Needs a migration (additive; no existing table changes except where stated):**

| Object | Purpose |
|---|---|
| Counter kinds `dispatch_note`, `return_note` in `inv_reference_counters` check and `inv_next_code` | Contiguous per-company numbers (`UAE-D-`, `UAE-RT-`) |
| Table `inv_project_notes` (one row per note): `id, company_id, kind ('dispatch'|'return'), note_no unique, movement_id unique → inv_movements, project_id, project_ref, project_name, destination, site_timezone, source_location, recorded_by, recorded_by_name, pm_user_id_at_time, pm_name_at_time, occurred_at, expected_return_at, request_id/request_code, replaces_note_id, superseded_by_note_id, payload jsonb (frozen lines + totals), payload_hash, created_at` | Frozen content; member-readable via RLS (`proj_can_view_details` for the project, `view_stock`/`warehouse` for Inventory) |
| Guard trigger (same pattern as `proj_issued_plan_guard`) | Frozen columns cannot change; `superseded_by_note_id` is set once; delete blocked |
| Table `inv_project_note_events` (append-only): `note_id, event ('acknowledged'|'difference_reported'|'resolved_record_stands'|'resolved_corrected'|'withdrawn'), by_user, by_name, capacity ('pm'|'acting_pm'|'projects_founder'|'warehouse'), at, comment, lines jsonb, linked_movement_id` | Acknowledgement, dispute and resolution history; current state = latest event |
| SECURITY DEFINER functions: `inv_make_project_note(movement_id)` (called as the last step of `inv_dispatch_to_project` and `inv_return_from_project`), `inv_ack_project_note(note_id, action, lines, comment)` (checks `proj_can_manage` at click time; idempotent), `inv_resolve_note_difference(note_id, resolution, comment, linked_movement_id)` (operator at the location only) | Atomic creation; permission checked in the database |
| Notification type(s) `inv_note_waiting`, `inv_note_difference` and a reader (see N-notices inbox) | Convenience notices; **state lives on the note** |
| Optional: extend `proj_files.purpose`? **Not needed**: PDFs are not stored. | |

**Interface and server logic (no migration):** PDF route handler `/projects/[id]/equipment/notes/[noteId]/pdf` (Node runtime, caller's session, 404 for non-members, `Cache-Control: private, no-store`); PDF component reusing the plan-document styles; "Dispatch & return notes" section on Project → Equipment; success-panel buttons in Send out / Receive back; Today rows for open differences; My Day / Needs me rows with the **LoadError pattern** (a failed read must say "could not load", not "nothing waiting").

**Changes to existing functions:** one call appended to `inv_dispatch_to_project` and `inv_return_from_project`. Booking-conflict logic, availability, reservation matching and ledger writes are untouched. Re-run the existing Inventory RLS tests and the five browser flows plus a new focused flow.

**Not in scope:** e-mail, signature images, QR on the PDF (later), project summary PDF, transfer notes, kit-contents verification on return (separate N item), any approval or stock-authority change.

## 6.9 Risks and fallback

| Risk | Mitigation |
|---|---|
| Appending a call to two critical functions could break dispatch/return (Option A) | Keep it one `perform`; run the full Inventory RLS suite and browser flows; ship behind an `inv_company_settings` switch **off by default** so the owner can enable per company after a preview test. If the owner prefers not to touch the two functions at all, use **Option B** (separate call + repair row); the cost is the small window described in 6.2 and the snapshot being taken slightly later. |
| PDF fonts/logo not included in the Vercel build | Verify on the branch preview deployment first (fonts are read via `process.cwd()` today; unverified). Fallback: print-friendly HTML page (existing print-CSS pattern). |
| PM never acknowledges | Non-blocking by design; age is visible; founders/`assign_pm` see old pending items. No automatic acknowledgement. |
| Notices dropped for an ineligible PM or if the PM is the actor | State is on the note, shown in lists; the notice is secondary. |
| Cross-company dispatch (warehouse company ≠ project company) | Numbered by the warehouse's company; both company names printed. |
| A PM-recorded project-to-project transfer has no note | Out of launch scope; listed as later. |
| Letterhead | Plan-PDF style (logo + company legal name from `companies`) avoids the hard-coded single-company letterhead. Owner decision if a full letterhead is wanted. |

## 6.10 Acceptance checks

**Dispatch note**
1. Recording a dispatch of 2 units and 12 cables creates exactly one note, numbered `<ref>-D-nnnnn`, containing exactly the movement's lines (cables merged per item/condition); a reserved-but-not-sent item is absent.
2. Recording the same dispatch twice with the same key returns the same note, not a second.
3. If the movement fails or rolls back, no note and **no number is consumed**.
4. Renaming the item, editing the serial, changing the project destination or the location's time zone afterwards does **not** change the note or its PDF.
5. PDF shows "ACKNOWLEDGEMENT PENDING" until acknowledged; afterwards shows name, capacity and time; the wording contains no signature claim.
6. Project member can open the PDF; a non-member gets a 404; a signed-out user is sent to sign-in.
7. A PM without an Inventory grant can read the note (and still cannot read the ledger).
8. Two dispatches for one project give two notes; the Sent/Returned/Still-out totals are unchanged.

**Acknowledgement**
9. The PM acknowledges; the second click is harmless and shows the original acknowledgement.
10. A person who is neither PM, acting PM nor Projects founder cannot acknowledge (database refuses); the control is not shown to them.
11. After PM reassignment the new PM can act; the record shows who and in what capacity; the old PM cannot.
12. An acting PM whose period expired cannot act.
13. Acknowledging changes **no** stock, availability or reservation (verify ledger row count and balances unchanged).
14. A failed read of pending notes shows "Could not load", never "nothing waiting".

**Return checklist**
15. A partial return (1 of 2 units, 10 of 12 cables) creates a checklist whose totals match the ledger: units exact, cables at project level with the explanation; nothing is attributed to a request line.
16. A damaged unit shows "Back, held for checking"; PM confirmation does not change it; only the warehouse condition check can release it.
17. A second return batch creates a second checklist; "previously returned" includes the first.
18. PM reports a difference on one line: it appears on the warehouse Today with an age; availability and custody are unchanged.
19. Warehouse resolves: "record stands" closes it; "corrected" links the new movement and note, and the old note shows "Superseded by".
20. No write-off, deduction, budget change or reimbursement is created by any state.

**Permissions and failure**
21. Warehouse operator at another location cannot resolve a difference for this location (database refuses).
22. Events cannot be edited or deleted by any role; frozen columns reject updates.
23. With the data service stopped, the notes section and Today rows say they could not load.


---

# 7. Technical impact and migration requirements

This section separates what can reuse existing actions and records from what needs database changes. **Every entry's own "Technical scope" row is authoritative**; the lists below are a navigation aid compiled from those rows. No estimate in days is given anywhere in this document.

## 7.1 Three kinds of change

| Kind | Meaning | Typical examples | Risk profile |
|---|---|---|---|
| **A. Interface only** | Screens, labels, grouping, states; existing records and actions reused unchanged | Navigation regroup and relabel (U-03, U-04, D-42, D-43); honest failure states using the existing `LoadError` pattern (D-02, D-03, D-04, D-15…D-20); My Day layout (U-02); decision-screen readability (U-08); expense entry defaults (U-15); condition helper on Receive back (U-23); copy corrections | Low. No data or permission change. Verified by component tests, browser flows and the preview deployment. |
| **B. Server logic, no migration** | New or changed server-side reads/actions that use existing tables and functions | Claim line numbering (D-05); "won with no handover" row (D-08); handover question/acceptance visible to a Sales-only owner (D-09); first version of the "Needs me" list (N-02); CEO/CTO attention lines from data they can already read (N-08, first lines); duplicate budget line (N-11); invite confirmation and configuration strip (N-12) | Low to medium. No schema change; behaviour verified by unit tests and local-stack flows. |
| **C. Migration** | New or replaced database tables, functions, policies or counters. **Applied only by the owner** through the existing owner-run deployment pack (preflight, snapshot, apply, verify, rollback). I run no hosted SQL. | See 7.2 | Medium to high: every migration needs RLS tests, a rollback note and an owner-run verification. |
| **D. Hosted setting / external service** | Vercel, Supabase, Microsoft Graph configuration | Cron route access and Root Directory (D-01); `CRON_SECRET`; column privileges on `profiles`; storage policy for `letters`; Microsoft Graph for any e-mail; font bundling for PDFs | Operational; owner or engineer with access; some are read-only checks (1.5). |

## 7.2 Migrations the proposals need (high level; exact objects are in each entry)

| Theme | Register | What changes in the database | Why it cannot be interface-only |
|---|---|---|---|
| Employee equipment request | D-06 | **Replace** `inv_issue_to_employee` so that a unit reserved for the *same* request is consumed (as dispatch already does) | The conflict check lives inside the function |
| PM-side budget visibility | D-07 | One read function (or an extension) so a PM and approvers can list budget/settlement steps waiting | Budget rows are not otherwise readable in the shape needed |
| Account really inactive | D-10 | Helper/functions so deactivation also makes the person inactive for module access, pickers and approval routing | `profiles.is_active` is never set false today |
| Profile confidentiality | D-11 | Policy/column privilege so a signed-in user cannot read other people's deactivation reason | `profiles_select` allows every column |
| Draft-policy function | D-22 | Role check inside, or revoke public EXECUTE on, `preflight_phase2b_v2_policy_status()` | Function runs with elevated rights |
| Clock lead picker; Recovery Leave cards | D-13, D-14 | A function/policy that returns the minimum a *deciding* person may see (name, dates, evidence) | Row-level access to `employees` / `recovery_credit_requests` is the cause |
| Scope-change and commercial approval notices | U-01 | Edit `proj_propose_scope_change` (and the Sales approval request) to notify the decider | Notices are written inside those functions |
| Notices for Finance, Sales-only and CEO viewers | N-01 (slice 2) | Widen the reader (`proj_my_notifications` is filtered to Projects participants) and add event types | The filter is in the SQL function |
| **Dispatch note and return checklist** | N-03, N-04 | Counter kinds `dispatch_note`, `return_note`; table `inv_project_notes` (frozen payload + guard trigger); append-only `inv_project_note_events`; functions `inv_make_project_note`, `inv_ack_project_note`, `inv_resolve_note_difference`; policies; optionally one `perform` appended to `inv_dispatch_to_project` and `inv_return_from_project` behind a per-company switch (Section 6.8) | New records, new numbering, new permissions |
| Project files "current reference" | N-09 | A marker/version column or table on project files; site-references card | `proj_files` has no version or current flag |
| Others (each listed in its entry) | U-07, U-09, U-11, U-19, U-27, U-30, U-32, U-33, N-17, N-19, N-20 | Read functions or edits to existing functions | As stated in the entries |

**Migration discipline (reuse the existing pattern from the access-rules migration):** one additive migration per work package; a read-only preflight; a snapshot and verify script; a rollback note; RLS tests in `packages/rls-tests` that prove the new rule *and* that nothing else changed (preservation compare); the owner applies it; I never run hosted SQL.

## 7.3 What deliberately needs **no** migration (and why that matters)

* The "failed read" family (D-02, D-03, D-04, D-15…D-20) is one interface pattern repeated; fixing it needs no schema work and removes most of the launch risk.
* The first version of "Needs me" is a **read-only union of existing records** (approvals including queue approvals, budget reviews, task reviews, handovers, leave decisions); each source keeps its own permission filtering; independent approvals remain independent (Section 5.14, N-02).
* Navigation changes (the "Me" group, removing dead rows) change only which links are offered; the database and page checks that actually enforce access are untouched.

## 7.4 Tests the work will require

| Layer | Required for |
|---|---|
| Unit/component (vitest) | Every interface and server-logic change; new rule modules (for example the honest-attribution rules are already covered) |
| RLS and function tests (`packages/rls-tests`) | Every migration: the new permission, a negative case for each role that must be refused, and a preservation check on the old behaviour |
| Browser flows against the local throwaway stack (existing harness) | One focused flow per work package; the existing Inventory/People & Access flows must keep passing |
| Accessibility and outage runs (existing `inventory-a11y`-style checks) | New screens; a "data service down" run must show "could not load", never "empty" |
| Preview deployment check | PDF fonts/logo; mobile layout; sign-in redirect behaviour for any route exemption |

---

# 8. Decisions needed from the owner, with recommended defaults

Format: **ID · decision · recommended default · why · what happens if undecided.** "Before work starts" marks decisions that gate a launch-blocker or a shared design.

## 8.1 Launch blockers and security (before work starts)

| ID | Decision | Recommended default | Why | If undecided |
|---|---|---|---|---|
| **DEC-01** | Scheduled jobs: after the Vercel check (1.5 #1), if the five HR routes have not been running, may they be exempted from the sign-in redirect? | **Check first. If not running: HR reviews the read-only accrual preflight, then one change exempts exactly those routes, with `CRON_SECRET` required.** No silent catch-up. | The first live run moves leave and comp-day balances; this spec changes no calculation, only reachability. | WP1 waits; balances may be stale. |
| **DEC-02** | Draft-policy function exposure (D-22) | If the live check shows `authenticated` can execute it: **restrict it to people who may read drafts** in a migration | Draft policy values must not be visible to staff | WP6 item stays open; treat as exposed until checked. |
| **DEC-03** | Deactivation reason readable by all (D-11) | **Restrict `status_reason` to People & Access managers and HR**; show everyone else only name/active state | Confidential free text | Stays readable. |
| **DEC-04** | Letters: pending letters downloadable (D-23); do templates carry salary? | If templates carry salary or the storage policy allows it: **block download until the letter is approved/issued** and treat as launch blocker | Sensitive and approval-bound | Remains improvement-level. |
| **DEC-05** | Clock "Project lead" picker and Recovery Leave approval cards (D-13, D-14) | After runtime confirmation: **show colleague names in the picker and the minimum of a request to the person who decides it**; no change to attendance or Recovery Leave calculation or routing | These are *display* inputs to protected flows | WP7 waits; ordinary employees may be unable to name a real lead. |
| **DEC-06** | Employee equipment request (D-06) | **Fix `inv_issue_to_employee` to consume the request's own reservation** (migration). Interim if the migration slips: remove "reserve" from the employee-request guidance. | Keeps booking protection; aligns with project dispatch | Warehouse is told to do something the system refuses. |
| **DEC-07** | Deactivation: approvals already pending on a leaver (D-10) | **Do not add a re-route action at launch;** show HR a list of pending items on deactivated people | A re-route changes who may approve (not proposed) | Items stay with the leaver until HR acts as today. |

## 8.2 Boundary and risk-only items (no change proposed)

| ID | Decision | Recommended default |
|---|---|---|
| **DEC-08** | A System Administrator can give themself any HR role (D-48) | Leave as is at launch; decide separately whether the module-grant "no self-grant" rule should extend to HR roles. |
| **DEC-09** | CRM organisations and contacts readable across companies (D-49) | Confirm intent; if unintended, a separate approved fix. |
| **DEC-10** | Retire the legacy Sales-side handover function (D-54) | Later; the working handover is unaffected either way. |
| **DEC-11** | Skip-level managers seeing indirect reports' leave (D-57, U-09) | **Direct reports only** in the new team view until you decide. |
| **DEC-12** | Read-only "see everything" visibility for CEO/CTO and Operations (N-22); contingency and VAT in budgets (N-23) | **No change at launch.** The CEO attention list uses only what the CEO can already read. |

## 8.3 Navigation and everyday use

| ID | Decision | Recommended default |
|---|---|---|
| **DEC-13** | Unfinished rows in the main menu ("Vendors & Purchasing", "KPIs", Inventory "coming soon") (U-04) | **Remove from the menu;** if you want the roadmap visible, one quiet line elsewhere. |
| **DEC-14** | "Me" group and "Company information" group as in Section 4.4; whether Timesheets (currently unlinked) is in or out | **Adopt 4.4;** put Timesheets in "Me" only if it is a live process, otherwise leave unlinked. Move Policies/Holidays to "Company information" only after the Policies page is cleaned up (raw JSON removed). |
| **DEC-15** | Who sees the "People & HR" group | **People with direct reports, or an HR/Finance/CEO/CTO/System Administrator role, or People & Access access** (Section 4.4). |
| **DEC-16** | "Needs me" placement | **A block on My Day**, same list reachable from the notices bell; Approvals page unchanged. |
| **DEC-17** | Waiting-time thresholds (amber/red) | **Amber after 2 working days, red after 5**; owner-adjustable later. |
| **DEC-18** | Record search from the palette | **Later.** Launch slice only if capacity remains: projects, enquiries, stock items. A staff directory for ordinary staff is a separate decision (colleague names). |
| **DEC-19** | Role packs for Technician/Marketing/Operations/Programmer | **Packs are presets of existing capabilities only** (no new permissions). Operations needs DEC-12 first. |
| **DEC-20** | Onboarding: automatic account-to-employee linking (U-19) | **Later.** Interim: enter each fact once and show a clear "waiting for a login" hand-off. |
| **DEC-21** | Reserve per line (U-24) | **Keep per line; pre-fill.** A one-transaction "reserve what is free" only with engineer sign-off, because it touches the booking path. |
| **DEC-22** | "Approver unavailable" (U-07) | **Visibility only:** show waiting time, who holds it, and "approver inactive". Any delegation or escalation changes who may approve and is not proposed. |

## 8.4 Dispatch note and return checklist (Section 6)

| ID | Decision | Recommended default |
|---|---|---|
| **DEC-23** | Does dispatch wait for PM acknowledgement? | **No.** Pending acknowledgement is visible, not blocking. |
| **DEC-24** | What the PM's click means; identity | "I acknowledge this recorded dispatch list." Authenticated name + time + capacity; **no signature image; no legal-signature wording.** |
| **DEC-25** | Who may acknowledge if the PM is unavailable | **Whoever is PM, acting PM or Projects founder at the moment of the click**, capacity recorded. No auto-acknowledgement. |
| **DEC-26** | Numbering and company | Dedicated counters `UAE-D-nnnnn` / `UAE-RT-nnnnn`, **warehouse location's company**; no in-place revisions (a correction is a new note that cites the old). |
| **DEC-27** | Creation: atomic (Option A) or a separate call with a repair path (Option B) | **Option A behind a per-company switch, off by default.** Option B if you prefer not to touch the two movement functions. |
| **DEC-28** | PDF: regenerate from frozen content or store the file | **Regenerate** (no storage); letterhead = logo + company legal name, not the full hard-coded letterhead. |
| **DEC-29** | Scope of movements | `dispatch_project` and `return_project` first; PM-recorded project-to-project transfers later. |
| **DEC-30** | Increment order | **Dispatch note first (after notices and "Needs me"); return checklist second** (needs kit-contents check, held-unit follow-up and the single safe return screen first). |
| **DEC-31** | Dispute effect on availability | **None by itself.** Availability/custody change only through existing warehouse actions with a reason; never automatic write-off, deduction or penalty. |
| **DEC-32** | E-mail for these events | **In-app only at launch.** Microsoft Graph e-mail sends only leave and Sales reminders today. |

## 8.5 Later

| ID | Decision | Recommended default |
|---|---|---|
| **DEC-33** | AI assistant | **Later; never a launch dependency.** There is no language model in the app today (only a deterministic detector). When built, it should only read through the user's own permissions and call existing, confirmed actions. |
| **DEC-34** | Readable policy page and policy acknowledgement; other countries' policies visible to staff | Readable page at launch (own country first); acknowledgement later. |

---

# 9. Bounded implementation order

**Principles:** (1) nothing starts before approval; (2) every package ends with a verification gate before the next begins; (3) migrations are applied only by the owner; (4) **no calendar commitment is given**: the order is by dependency and risk, and package sizes are *relative* (S = one screen or one function; M = several screens or one migration; L = migration plus several screens and tests). Estimates in days can be requested after the scope is approved and the checks in 1.5 are done.

## Stage 0. Verify and decide (no app change)

| Step | Output |
|---|---|
| The read-only checks in 1.5 | Moves hosted-state items to confirmed or cleared |
| Decisions DEC-01 to DEC-07 and DEC-12, DEC-13, DEC-15 | Unblocks Stage 1 |
| Reproduce D-06, D-13, D-14 on the local stack | Items become reproduced, not just read |

## Stage 1. Launch blockers (seven work packages)

| Order | WP | Register | Size | Needs migration | Depends on |
|---|---|---|---|---|---|
| 1 | **WP2 Honest failure states** (do first: it makes every later check trustworthy) | D-02, D-03, D-04, with D-15…D-20 in the same pass | M | No | none |
| 2 | **WP4 Money defects** | D-05, D-12 | S | No | none |
| 3 | **WP3 Hand-offs** | D-07, D-08, D-09, U-01 | M | Small (D-07 PM side; U-01) | WP2 pattern; shares loaders with N-02 |
| 4 | **WP5 Employee equipment request** | D-06 (+D-29) | S/M | Yes (DEC-06) | DEC-06 |
| 5 | **WP6 Accounts and confidentiality** | D-10, D-11 (+D-22) | M | Yes | DEC-02, DEC-03, 1.5 #2, #3, #6 |
| 6 | **WP1 Scheduled jobs** | D-01, D-25 | S | No (hosted) | DEC-01 and the preflight |
| 7 | **WP7 Clock and Recovery Leave display** | D-13, D-14 | M | Yes | DEC-05 and runtime confirmation |

*Gate for Stage 1:* all blockers verified by tests and browser flows on the local stack; a "data service down" run shows "could not load" on every touched screen; preview deployment checked; owner applies migrations and runs the verify scripts.

## Stage 2. Launch improvements in the refinement window

| Package | Register | Size | Migration | Notes |
|---|---|---|---|---|
| **2A Navigation and "Me"** | U-03, U-04, D-42, D-43 (Section 4.4) | S/M | No | Policies page cleanup first if Policies move to "Company information" |
| **2B Notices and "Needs me"** | N-01 (slice 1, then slice 2), N-02, U-02, U-06, U-07, D-21, D-40 | L | Slice 2 only | Prerequisite of the dispatch note; reuse existing records only |
| **2C Everyday flow improvements** | U-08, U-10, U-11, U-14, U-15, U-16, U-17, U-18, U-23, U-26 | M | U-11 small function edit | Each is independent; can be sequenced by value |
| **2D Inventory correctness** | D-28, D-29, D-30, D-31, D-32, D-34, D-35, U-25, N-05, N-06 | M/L | Mostly no | N-05 and N-06 are prerequisites of the return checklist |
| **2E Access and onboarding** | U-13, U-19 (interim), U-20, U-21, N-10 | M | Small | Departments screen after the hosted check |

## Stage 3. Dispatch note and PM acknowledgement (N-03), then return checklist (N-04)

| Increment | Needs | Size | Migration | Gate |
|---|---|---|---|---|
| **3a Dispatch note + acknowledgement** | 2B (notices, Needs me), DEC-23…DEC-29, preview font check, D-28 resolved | L | Yes | Full acceptance list 6.10; switch **off by default** per company; enable first on one company |
| **3b Return checklist + PM confirmation** | 3a plumbing, N-05 (kit contents), N-06 (held-unit follow-up), D-28 (one safe return screen) | L | Yes (reuses 3a tables) | 6.10 return and permission checks; confirm the dispute rules DEC-31 |

## Stage 4. Later (not scheduled)

Record search (N-07), CEO/CTO attention list beyond the first lines (N-08), project file current-reference marker (N-09, owner to decide who declares "approved"), onboarding checklist (N-14), scope-change follow-through (N-15), budget print/export (N-16), copy budget (N-17), claim project tags (N-18), effective-access view (N-19), policy acknowledgement (N-20), HR screens that do not exist (N-21), read-only visibility model (N-22) and contingency/VAT (N-23), all remaining LT items, and **the AI assistant**.

## Dependency chain at a glance

```
Stage 0 checks + decisions
        │
        ▼
WP2 honest failures ──► WP3 hand-offs ──► 2B notices + Needs me ──► 3a dispatch note ──► 3b return checklist
WP4 money, WP5 equipment, WP6 accounts, WP1 jobs, WP7 clock/Recovery (independent, after their decisions)
2A navigation, 2C flows, 2D inventory fixes (N-05, N-06 → 3b), 2E access (independent)
```

---

# 10. Acceptance and launch checklist

## 10.1 Acceptance rules that apply to every change

1. **Success, failure and permission cases are all tested** (each register entry lists them). A change is not accepted on the happy path alone.
2. **A failed read must say it could not load.** For every touched screen, with the data service stopped, the screen shows a "could not load" message, never an empty list, zero, "nothing waiting" or "no access".
3. **Hiding is never enforcement.** Any new restriction is enforced in the database (policy/function) and has a test that a refused role is refused when calling it directly.
4. **No stock, balance or approval changes as a side effect** of an acknowledgement, a notice, a list or a label change; shown by unchanged ledger/balance/approval row counts in the tests.
5. **No migration without** a preflight, a verify, a rollback note, RLS tests and the owner's apply.
6. **Both themes and the phone width** are checked for every new screen (the approved ENGINIOUS OS visual language is reused; no new branding).
7. **Counts and timing in this document are targets.** Report measured results after the change, separately.

## 10.2 Launch-readiness checklist

**Environment (owner or engineer with access, read-only unless noted)**
- [ ] Vercel cron history reviewed; Root Directory and `CRON_SECRET` confirmed; DEC-01 resolved.
- [ ] Live privileges checked: `preflight_phase2b_v2_policy_status()`, `profiles` columns, `letters` storage policy.
- [ ] Microsoft Graph settings confirmed if leave e-mails are expected to send.
- [ ] Preview deployment checked for PDF fonts/logo (before Stage 3).

**Data and access**
- [ ] A real person exists for each persona to walk through (below), with grants set through People & Access.
- [ ] The first live leave-accrual run follows the read-only preflight, reviewed by HR.
- [ ] Departments exist where the hosted check showed none (N-10), or the screen is shipped.

**Release gates**
- [ ] CI green on the final commit; RLS suite green including new tests.
- [ ] Every Stage 1 blocker verified on the local stack and reproduced-then-fixed where it was marked "needs runtime confirmation".
- [ ] "Data service down" run: every touched screen says "could not load".
- [ ] Owner has applied migrations and run each verify script; nothing was applied by anyone else.
- [ ] Production deployment Ready for the final commit; smoke checks below done.

## 10.3 Persona walk-throughs for day one (each should finish without help)

| Persona | Walk-through (each step is observable) |
|---|---|
| **Ordinary employee** | Sees "Me" with 8 items and "Company information"; no company-wide screens; opens My Day and sees today's work; requests leave and sees balance, approver and pending request on one page; reads a published policy and a holiday; direct-URL to a company screen is refused. |
| **Programmer / content / engineer / technician** | Opens My Day, sees assigned tasks by title with due today first; updates a status; reports a blocker in 2 clicks and the PM sees it; finds site instructions and current references on the project. |
| **Department head / line manager** | Sees pending leave and Recovery Leave of direct reports with names and dates; team leave view; cannot see other teams. |
| **Project Manager** | Sees "Needs me" (handover, reviews, notes waiting); assigns work without the forced order; sees equipment status; (after Stage 3) acknowledges a dispatch note. |
| **Sales** | Creates an enquiry; logs a call and plans the next step in one dialog; marks Won and is shown the handover step; sees the PM's question. |
| **Marketing / Operations** | Run their work as internal projects with a role pack (no new permissions); see only what their grants allow. |
| **Warehouse operator** | Today shows the work; prepares, sends and receives back with a condition per received unit; gives equipment to an employee against a request without the reservation conflict; (after Stage 3) downloads a dispatch note. |
| **Finance** | "Needs me" shows budgets, final expenses and settlements waiting; decides; sees waiting time. |
| **HR** | Finds an employee's balance and pending requests in two steps; sees the leaver list; draft policies are not visible to staff. |
| **System Administrator** | Invites, links to the employee record, assigns grants through People & Access; deactivation makes the person inactive everywhere. |
| **CEO / CTO** | Sees what needs them (approvals, budget decisions as executive approver, handovers they may read) and a clear "could not load" if a read fails. |
| **Combinations** (PM + Sales, Finance + PM, warehouse + employee, HR + line manager) | One merged sidebar with no duplicate groups; every module available through the person's own grants. |

## 10.4 What stays unverified until the owner acts

Anything that depends on the live system (the checks in 1.5), on real staff using the screens, and on measured timings. This document gives **targets**, never measured results.

---


---

# Appendix A. Evidence base and limits

* **Investigations (read-only, code and SQL at `76c121b`):** A My Day/navigation/search/"Me"; B Sales and Projects; C Inventory after the simplification; D dispatch/return feasibility (record model, numbering, PDF, notifications, PM identity, files, idempotency, return conditions); E Budget, Expenses and Approvals; F People & HR; G People & Access and the permission model; H reliability and scheduled jobs. Plus the app's own navigation builder run for 30 responsibility combinations.
* **What was executed:** the existing budget-rounding unit tests (31 passed) and the navigation builder. Nothing else was run, and nothing touched a hosted system.
* **What was spot-checked by me against code:** the cron/proxy exemption; claim-line numbering; employee-request reserve-then-issue; the draft-policy status function; letter download links; deactivation not setting `profiles.is_active`.
* **What could not be verified from here:** Vercel run history and settings; live privileges (`preflight_phase2b_v2_policy_status()`, `profiles` columns, `letters` storage policy); whether hosted `departments`/`notifications` rows exist; PDF font bundling on Vercel; how a deactivated user's existing session behaves until expiry; real-user timings.
* **Known and documented separately, not repeated as new:** People & Access says "You cannot manage people or access" during a data outage (`docs/known-issues/people-access-outage-message.md`); it shares its root cause with D-15 (a failed role/employee read looks like "no role").
* **Working notes:** the investigators' full findings files (about 350 KB) are available on request; every register entry cites them by source id.
