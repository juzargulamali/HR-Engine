# Operations (Projects & Tasks Phase 2B): Operations Manager, Overview, Upcoming Work, Operations planning on an enquiry, event edition on projects, equipment readiness and booking review

Part of the Projects & Tasks Map: [coverage index](./projects-coverage-index.md) (section 9) and [action catalogue](./projects-action-catalogue.md) (section 11). The Sales side is also in the [Sales coverage index](./sales-coverage-index.md) (rows 82 and 83) and the [Sales action catalogue](./sales-action-catalogue.md) (section 3.10).

Status: written on branch `claude/projects-phase-2b-operations` (2026-11-12) against the files cited below. Re-read against commit `3e7e348` ("fixes from the independent review"). **Code read only by the author of this reference; nothing was run signed in, in Preview or in Production.** The database rules have their own test file on a real PostgreSQL (`packages/rls-tests/test/ops-phase2b.rls.test.ts`, 11 tests, counted in the file) and the screens have unit tests (section 13); this reference states what those files contain and does not claim a run. The full database suite was last run locally at 76 files / 1,977 tests **before** the review fixes of `3e7e348` and has not been rerun since (reported by the author of the code). Draft pull request: not yet opened. Migration `supabase/migrations/20270102000100_ops_phase2b.sql` (install-order row 30): **not applied anywhere by Claude; hosted status `Unverified`.**

**Release status (four facts kept apart, 2026-11-12):** merged: no (branch only, no pull request yet). Required CI on the exact head: not recorded (no pull request). Hosted database: migration not applied by Claude, owner result none, `Unverified`. Production: not deployed, `Unverified`.

Sources (short letters used below):

* **M** `supabase/migrations/20270102000100_ops_phase2b.sql`; owner packs `supabase/manual-sql/ops_phase2b_00_preflight_readonly.sql`, `ops_phase2b_20_verify_readonly.sql`, `ops_phase2b_90_rollback.sql`; tests `packages/rls-tests/test/ops-phase2b.rls.test.ts` (**T**).
* **D** `packages/domain/src/permissions/proj.ts`; **PA** `packages/domain/src/peopleAccess.ts`, `accessProfiles.ts`.
* **N** `apps/web/src/components/nav/nav-groups.ts`, `nav-icons.ts`, `shell-chrome.tsx`.
* **OL** `apps/web/src/app/(app)/operations/layout.tsx`; **OP** `operations/page.tsx`; **UP** `operations/upcoming/page.tsx`.
* **OV** `apps/web/src/components/operations/overview-view.tsx`; **UC** `upcoming-card.tsx`; **PD** `planning-dialog.tsx`; **PT** `parts.tsx`.
* **MO** `apps/web/src/lib/operations/model.ts`; **DA** `lib/operations/data.ts`; **A** `lib/actions/operations.ts`.
* **SP** `apps/web/src/app/(app)/sales/opportunities/[id]/ops-planning-panel.tsx`, `ops-planning-forms.tsx`, `overview-panel.tsx`; **SA** `lib/actions/crmOps.ts`; **SL** `lib/crm/ops-planning.ts`, `ops-planning-data.ts`.
* **EQ** `apps/web/src/app/(app)/projects/[id]/equipment/page.tsx`, `components/projects/equipment-readiness.tsx`, `equipment-review-form.tsx`, `lib/projects/equipment-readiness-model.ts`, `equipment-readiness.ts`, `lib/actions/projectsEquipmentReview.ts`; **WA** `lib/projects/work-attention.ts`, `projects/[id]/work/page.tsx`, `work/details-card.tsx`.
* **DI** `apps/web/src/app/(app)/projects/page.tsx`, `lib/projects/directory.ts`, `lib/projects/data.ts`; **HB** `components/projects/handover-brief.tsx`; **EV** `app/(app)/sales/events/[id]/page.tsx`; **CE** `lib/projects/closeout/evidence.ts`.
* **CH** `apps/web/src/components/chat/chat-launcher.tsx`, `chat-thread.tsx`, `lib/chat/model.ts`, `lib/chat/data.ts`; **NT** `lib/projects/notification-text.ts`; **IT** `lib/inventory/today.ts`.
* Earlier migrations named where a rule comes from them: **M200** `20261120000200_proj_projects_handover_functions.sql`, **M000** `20261120000000_proj_access_audit.sql`, **M300** `20261120000300_proj_delivery_functions.sql`, **M500** `20261120000500_proj_feedback_plans_files_completion.sql`, **M27** `20261230000100_chat_project_groups.sql`, **M28** `20261231000100_proj_delivery_plan.sql`.

## 1. What Operations is, and what it is not

Operations is a **view across one company's projects and the enquiries Sales has flagged**, for the person who decides who runs each job and who needs to see trouble early. It has two screens, **Overview** (`/operations`) and **Upcoming Work** (`/operations/upcoming`), and one small record of its own: the planning row of a flagged enquiry.

* **It reads; the owners of the work act.** Every item on the Overview is a recorded fact (a handover without a Project Manager, a blocked task, a date that changed while equipment is booked) with a link to the screen where the responsible person acts (OV, MO header). The page footer says: "Operations reads these records; it does not change tasks, bookings or stock."
* **No score, no capacity figure, no second progress tracker** (MO header; M section 7 comment). What is not recorded is shown as "Not recorded".
* **It is not a module with its own access.** It is one capability of the Projects grant (section 2).
* **It is not Sales.** An Operations Manager sees a flagged enquiry only through one allowlisted read; prices, quotes, the brief and Sales notes are never selected (section 5.2).
* **Nothing in the migration reserves, releases, dispatches or receives stock, creates a project, completes one, or changes a task** (M header; verify pack row 8 checks the Operations functions for those statements).

The one thing Operations writes itself: `ops_enquiry_planning` (provisional Project Manager, risk, capacity conflict, a question for Sales), through `ops_set_enquiry_planning` (section 6.4). The real assignment of a Project Manager is the existing handover action in Projects (`projects.handover.assign_pm`), which an Operations Manager may use (section 2.2).

## 2. Who: the Operations Manager

### 2.1 The capability and where it is given

| Point | Rule | Source |
|---|---|---|
| What it is | The Projects capability `operations`, one per company, stored in the person's Projects grant (`proj_company_grants.capabilities`). Label on People & Access: **Operations Manager** | M section 1 (`proj_capability_list`); D (`PROJ_CAPABILITIES`, `PROJ_CAPABILITY_LABELS`) |
| Where it is given | **People & Access**, the person's Projects access for that company: the working profile **Operations Manager** (saves exactly `operations`), the older preset of the same name, or the tick box under Advanced access, group "Specialist operational rights" | PA (`ACCESS_PROFILES.projects`, `ACCESS_PRESETS.projects`, `ADVANCED_GROUPS.projects`) |
| Who can give or take it | A Projects founder of that company, or someone a founder gave Projects access management to (`manage_access`). It is not founder-only (`founderOnlyCapabilities("projects")` is `founder`, `manage_access`). The existing grant functions are used unchanged: `proj_grant_access`, `proj_revoke_access`, and the existing audit trigger records it | M000 (`proj_grant_access`); PA; T test 1 (an Operations Manager cannot grant it; a founder grants and revokes; two audit rows) |
| A founder | A Projects founder holds every capability, so a founder passes `proj_has_capability(company, 'operations')`, sees the Operations menu, both reads and may save planning. **Two exceptions use the capability itself, not the founder shortcut:** the Chat path (`chat_is_ops`) and the two Operations notices (`ops_notify_managers`) | M sections 1, 2, 5; N; D (`opsCompanyIds`); T tests 1, 5, 6 |
| Who holds it after the migration | Nobody. The migration gives it to no one (preflight row 8 and verify row 2 report the count for information) | M; packs |
| Description shown to the person granting it | "Open the Operations workspace for this company, assign Project Managers, and read and post in this company's project chats. Gives no Sales, Finance, HR or Warehouse rights, and does not edit tasks or deliveries." | D (`PROJ_CAPABILITY_LABELS.operations`) |

### 2.2 What it gives (verified in the SQL and the domain package)

| Right | How | Source |
|---|---|---|
| The Operations menu and both screens for that company | Menu: any Projects grant with `operations` or `founder`. Screens: `getOperationsContext` lists the companies from `opsCompanyIds`; each read is checked again in the database (`ops_require`, `ops_company_ids`) | N; DA; M section 1 |
| **PM assignment (`assign_pm`) is implied, for handovers and for reassigning a live project's Project Manager only** | `proj_has_capability(company, 'assign_pm')` is true for a holder of `operations` (database and domain): assign or change the Project Manager on a handover (`proj_assign_handover_pm`), change the Project Manager of a live project (`proj_assign_pm`), read the company's handovers (`proj_handovers_select`), the **Handovers** menu entry, My Work's "waiting on you" for a submitted handover. They are told when a handover is submitted without a Project Manager (`project_handover_submitted`, trigger `trg_proj_handover_submitted_ops`) and read staff names where an assigner does (`proj_staff_directory`) | M section 1 (`proj_has_capability`); D (`hasProjCapability`); M200; `20261120000100_proj_core_tables.sql` (policy `proj_handovers_select`); T test 4 |
| **Not implied: creating an internal project and changing a project's Sales links.** Both need `assign_pm` itself or founder | `proj_holds_assign_pm` (the literal capability); trigger `trg_proj_internal_project_guard` on `proj_projects` for `kind = 'internal'`; `proj_set_sales_link` wraps the earlier function (kept as `proj_set_sales_link_base`) and refuses an Operations Manager who does not hold `assign_pm`. Domain `holdsAssignPm`; the menu shows "New internal project", `/projects/new` lists companies, and the People page offers the Sales link controls on that test | M section 1; D; N; `projects/new/page.tsx`, `projects/[id]/people/page.tsx`; verify pack row 15 |
| Read that company's projects **in full without joining them** | `proj_can_view_details` and `proj_can_view_summary` return true for a holder. Every select policy and read function that uses them follows: directory row, Work, tasks, milestones, Timeline, people, site dates, the Delivery plan, unrestricted files, Equipment, History | M section 1; D (`canViewProjectDetails`, `canViewProjectSummary`); T test 6 (reads the task and the unrestricted file) |
| Read and post in that company's project Chat groups | `chat_is_ops`, added to `chat_is_member` and `chat_project_group` (section 10) | M section 5; T test 6 |
| Read readiness and open equipment reviews of that company's projects | `proj_equipment_readiness`, policy `proj_equipment_reviews_select` | M section 6 |

### 2.3 What it does not give

| Not given | Evidence |
|---|---|
| Any Sales access: no enquiry row, no Sales screen, no Sales chat group | T test 1 (`select 1 from crm_opportunities` returns nothing; `crm_has_access` false) |
| Any Inventory or warehouse right | T test 1 (`inv_has_capability(..., 'warehouse')` false); the readiness read only reports |
| Finance, HR | No statement in M touches a Budget or HR table or helper |
| Managing a project: `proj_can_manage` stays founder, Project Manager, temporary leader | T test 6 (`proj_can_manage` false; `proj_create_task` for someone else, `proj_set_task_status`, `proj_update_project`, `proj_complete_project` all refused) |
| Accepting a handover for the Project Manager | T test 4 (`proj_accept_handover` refused) |
| Restricted files; the commercial record of a scope change | `proj_files` policy keeps "restricted AND proj_can_manage"; `proj_scope_change_commercial` keeps `view_commercial` (verify pack row 14; T test 6) |
| Scope approval, access management, reopening, overriding a site conflict, the audit trail | T test 1 (`manage_access`, `approve_scope` false); nothing in M implies them |
| Another company's Operations | T tests 1, 5 (company B refused) |

**What every reader of a project can do, and so an Operations Manager can too, under their own name** (M header and section 1 say so; these functions ask only that the caller can read the project's details):

* comment on a task and edit their own comment (`proj_comment_task`, `proj_edit_task_comment`, M300);
* raise a Delivery Plan correction (`proj_dp_raise_correction`, M28);
* add an unrestricted link or file to a project that is not finished (`proj_add_link`, `proj_create_upload_intent`, `proj_register_uploaded_file`, M500). Whether the storage bucket accepts the upload for someone who is not enrolled: `Unverified`;
* post in the project's old Discussion (`proj_post_message`, own edit and delete, `20261120000400_proj_plans_site_calendar_discussion.sql`); the Discussion tab itself is gone once project chat groups exist.

These are participation, not management. **An Operations Manager cannot:** create, assign, move or review a task; edit the Delivery Plan; decide a correction or a proposed change; manage, edit or complete the project; see restricted files or the commercial record of a scope change; create an internal project; change a project's Sales links. The description shown on People & Access ("does not edit tasks or deliveries") does not mention the four kinds of participation above; they are not exercised for this role in T (`Unverified` by a test).

### 2.4 Revocation and deactivation

Removing `operations` from the grant, revoking the Projects grant, or deactivating the person takes effect **on the next read**: `ops_overview` refuses, `ops_upcoming_work` returns nothing for them, `ops_company_ids` is empty, the project groups leave Chat and posting is refused (T tests 5 and 6). The screens then say "You are no longer an Operations Manager of this company, so <what> is not shown. People & Access shows who can give it back." (PT `ReadState`, state `denied`), or, when the person holds it for no company, the notice in section 3.2. A live Project Manager's Projects access cannot be withdrawn (existing guard, `03-roles-access-and-approvals.md` section 2.3); that guard is not changed here.

## 3. Navigation and the shell

### 3.1 Menu

| Entry | Where | Condition | Source |
|---|---|---|---|
| Module **Operations**, section "Operations", links **Overview** (`/operations`) and **Upcoming Work** (`/operations/upcoming`); icon Workflow | Sidebar, directly before **Projects & Tasks** | The person holds a Projects grant whose capabilities include `operations` or `founder`, in any company. Holding `assign_pm` alone does not show it. The Projects menu's "New internal project" is shown only to holders of `assign_pm` itself or founders, so not to an Operations Manager | N (`buildNavModules`; `NAV_ICONS.operations`); test `nav-groups.test.ts` |
| Phone | Not on the bottom bar (My Day, Sales, Clock, Me, More). **More** opens the menu drawer, which lists the same modules, so Operations is reached there | N (`shell-chrome.tsx`: the bottom bar's five entries; `ModuleNavigation` inside the drawer) |
| Command palette | The two links are ordinary links, so they are searchable | N (`navGroupsFromModules`); `Unverified`: not seen |

The menu is only an offer: hiding it removes nothing and showing it grants nothing (N header).

### 3.2 Shell states (OL), for both screens

| State | What the person sees | When |
|---|---|---|
| Not signed in / no Projects context | Nothing is drawn by this layout (`return null`); the signed-in shell handles sign-in | `getOperationsContext` returned null |
| Not installed | Heading "Operations" and: "Operations is not installed in this environment yet. The database changes it needs have not been applied here, so nothing is shown." | The Projects context says Projects is not installed (`ctx.installed` false) |
| Could not load | Heading "Operations" and the standard "could not load" block for "Operations" | The Projects context failed to load |
| Not an Operations Manager | Access notice titled "Operations": "You are not an Operations Manager. It is given per company in People & Access by a founder or someone who manages Projects access. Your projects and tasks are in Projects & Tasks as before." | Signed in, but Operations Manager (or founder) of no company |
| Open | The page | Otherwise |

A database that has Projects but **not this migration** passes the shell; each page read then reports "Operations is not installed in this environment yet. Nothing else is affected." (PT `ReadState`, state `not_installed`; DA `isNotInstalled`).

### 3.3 Company chooser (PT `CompanyTabs`)

Shown on both screens only when the person is Operations Manager of **two or more** companies: one link per company (`?company=<id>`), the current one marked. The page shows the company asked for when the person is its Operations Manager, otherwise their first (DA `pickCompany`). All reads are for one company at a time.

## 4. Operations Overview (`/operations`)

Heading **Operations**; description "What needs a decision and what is coming up for <company>. Project Managers run each project in Projects & Tasks; Sales owns enquiries; the warehouse owns stock." (OP). Two reads run together: `ops_overview(company)` and `ops_upcoming_work(company)` (section 5).

**Failed reads.** If the Overview read does not succeed the page shows the heading, the company chooser and one message: not installed, "You are no longer an Operations Manager of this company, so the Operations Overview is not shown. ...", or the could-not-load block with a retry link (OP, PT). If only the Upcoming Work read fails, the three other panels are shown and **Coming up from Sales** carries the message (OV). An empty result is a different sentence in each panel (below); none of the failures is shown as empty.

Four panels, in this order (OV):

### 4.1 Needs my decision (N)

Description: "Recorded situations that wait for someone. Each one names who it is with and opens the screen where they act." Each item: a badge with the kind (red outline for "Project Manager not assigned" and "Installation at risk", amber for the others), the title, one sentence of detail, "With: <owner> · <date>", and one button. Empty: "Nothing recorded needs a decision right now: every submitted handover has a Project Manager, no listed blocker is waiting, and no installation in the next 14 days has a recorded problem."

Derivation (`decisions` in MO; thresholds `STALLED_DAYS = 3`, `BLOCKER_DAYS = 2`, `AT_RISK_WINDOW_DAYS = 14`):

| Badge (kind) | Listed when | Detail sentence | "With" | Button and where it goes |
|---|---|---|---|---|
| **Project Manager not assigned** (`pm_unassigned`) | A handover of the company has status `submitted` | "Handover submitted <date>. No Project Manager is assigned." | Operations | **Assign a Project Manager** -> `/projects/handovers?handover=<id>` |
| **Handover stalled** (`handover_stalled`) | A handover is `pm_assigned` or `clarification_requested` and has waited **3 days or more** since it was assigned (or since the question was sent), or that date is not recorded | "Waiting N days for <PM> to accept." or "A question went back to Sales N days ago and the handover has not been resubmitted." | The named Project Manager, or Sales | **Open the handover (you can reassign)** or **Open the handover** -> the same address |
| **Blocker not resolved** (`blocker`) | A task of a listed project is blocked (open statuses only) and **either** the person named to unblock it is not the assignee (`cross_team`) **or** it has been blocked **2 days or more**. The read returns at most the 5 oldest blockers per project (and `blockers_total`, the count of all of them, used for the task line and the risk reasons) | ""<task>" is blocked since <date>: <reason>. Waiting on <name>." or "Nobody is named to unblock it." | The unblock owner, else the Project Manager | **Open the task** -> `/projects/<id>/work?task=<task>` |
| **Installation at risk** (`at_risk_installation`) | A live project that is inside the window **from 14 days before its installation start (or, with none, event start) until its event end**, and at least one recorded reason exists (below). A project with no recorded event end leaves the window the day after its start | "Installation starts <date>: <reasons>." ("started" once the date has passed; "The event starts" when no installation date) | The Project Manager | **Open the project** -> `/projects/<id>/work` |
| **Review equipment booking** (`equipment_review`) | The project has at least one open equipment review (section 9.2) | "A committed date changed while equipment is booked. N bookings to review. The booking itself has not been changed." | The Project Manager | **Review equipment booking** -> `/projects/<id>/equipment` |
| **Unused reservations not released** (`release_failed`) | A finished project whose release of unused reservations failed at completion and something is still left to release (section 9.4) | "Releasing unused reservations failed when the project finished. The warehouse releases them on the request." | Warehouse | **Open the Equipment tab** -> `/projects/<id>/equipment` |

Reasons that make an installation "at risk" (`riskReasons`, each from a record, joined with semicolons): equipment short on a named request (any short line); an equipment request not yet sent to the warehouse (a draft); N blocked tasks; N overdue tasks; N overdue milestones; N Delivery plan lines not released to the teams. A project with none of these is not listed, however close its date. A project with no recorded installation or event date is never "at risk". The count of blocked tasks is the total, not the five listed.

Order: by kind in the order of the table, then by date (undated last), then by title.

### 4.2 Coming up from Sales

Description: "Enquiries Sales flagged for planning. Tentative until the enquiry is won." Button **Open Upcoming Work** (to `/operations/upcoming?company=<id>`). The first **6** flagged enquiries in the read's order (expected decision date first, undated last; then installation or event start; then reference): reference, title, stage and the dates word (section 6.2), the installation or event start ("No date recorded" when neither), and "Next: <who>, <what>" (section 6.3). Below it "N more in Upcoming Work." when there are more than 6. Empty: "No enquiry is flagged for Operations planning."

### 4.3 Upcoming delivery

Description: "Projects by their next recorded date, with the Project Manager, the venue and the most relevant open issue. A finished project stays here while its equipment is out." Empty: "No live project in this company."

Which projects (`upcomingDelivery` in MO, on top of the read's own filter): every project that is not completed or archived, plus a finished one while it has units out, an open equipment review, or a failed release still pending. Sorted by installation start, else event start, undated last, then reference.

Each project card:

| Element | What it shows | Link |
|---|---|---|
| Reference and name | | `/projects/<id>/work` |
| Status badge | The project status in words | |
| Badge **Delivery complete · equipment still out** | A completed or archived project with at least one unit out (`completeButOut`) | |
| **Open project chat** | Only when the project's Chat group exists **and the viewer can open it** (the read returns `chat_group_id` only to a holder of the `operations` capability itself or a member of the project; a founder with neither is not offered the link) | The same page with `?chat=<group id>`; the Chat panel opens it only if the server lists that group for the person (section 10) |
| Project Manager | Name | |
| Venue | The project's location, then " · <event edition label>" when the project has one; "Not recorded" | |
| Installation, Show | Dates or "Not recorded" | |
| **Dismantling** | Always "Not recorded on the project": a project has no dismantling date (section 12) | |
| Next milestone | The earliest open milestone with its date, or "None open" | |
| Tasks | "N open", then ", N overdue" and ", N blocked" (all blocked tasks, `blockedCount`) when above zero | |
| **Most relevant issue** | One sentence (below), or "Nothing recorded" | |
| Equipment | One line per request that is not cancelled (`equipmentLine`), each linking to `/projects/<id>/equipment`; or "Equipment: no request recorded." | |

**Most relevant issue** (`topIssue` in MO): the first of these that applies, in this order: (1) "Unused reservations were not released at completion"; (2) "Delivery complete · equipment still out (N units)"; (3) "Blocked: <first blocked task>"; (4) "Review equipment booking: a committed date changed"; (5) "Equipment short on <request>"; (6) "Equipment return overdue on <request>"; (7) "N overdue tasks"; (8) "N overdue milestones"; (9) "N delivery plan decisions waiting" (open corrections plus proposed changes); (10) "N tasks waiting for review"; otherwise nothing.

**Equipment line** (`equipmentLine`): "<code>: <state>." then " R of L lines reserved." only while the state is Reserved, Partly ready or Short (a draft with lines reads " N lines on the draft, nothing reserved yet."; once stock is out the count is not said), then, when lines are short, " N lines short (a to buy, b to rent, c with no plan yet)." and, when units are out, " N units out, due back <date>" or ", no return date recorded", with " (overdue)" when the expected return has passed. State words: Not sent to the warehouse yet, Cancelled, No lines, Reserved, Partly ready, Short, Partly dispatched, Dispatched, Still out, Returned (`STATE_WORDS`). A line to buy or rent is short, never reserved (section 9.1).

### 4.4 Team and warehouse pressure

Description: "Only what is recorded: people on two projects whose dates overlap, reviews past their date, shortages, partial dispatch and overdue returns. It is not a capacity figure." Empty: "Nothing recorded. Overlaps need both projects to have their dates and people recorded, so a clash that is not recorded will not show here."

Groups, each with its count, each line a link (`pressure` in MO; headings from OV `PRESSURE_WORDS`):

| Heading | A line exists when | Text | Goes to |
|---|---|---|---|
| **Overlapping commitments** | The same person is an active member of two live projects of the company whose recorded windows overlap. A window is installation start (else event start) to event end; **both projects need a start and an event end**, and both must end today or later. The read returns at most 60 pairs | "<Person> is on <A> and <B>, whose delivery dates overlap <from> to <to>." | `/projects/<A>/people` |
| **Overdue reviews** | A project has tasks in Ready for review whose due date has passed | "<Ref>: N reviews past the task's due date." | `/projects/<id>/work` |
| **Equipment shortages** | A request has at least one short line | "<Ref>: " and the equipment line | `/projects/<id>/equipment` |
| **Partial dispatch** | A request's state is partly dispatched | "<Ref>: <code> is partly dispatched (d of L lines)." | same |
| **Overdue returns** | Units are out and the expected return has passed | "<Ref>: N units from <code> due back <date> and not returned", with " (the project is complete)" on a finished project | same |

There is no threshold in this panel: every recorded case is listed.

Footer of the page: "Read <date>. Operations reads these records; it does not change tasks, bookings or stock. Each link opens the screen where the responsible person acts."

**Mobile.** The panels stack; fact grids are one column on a phone, two from `sm`, four from `lg`; item rows wrap (OV class names). `docs/projects-phase2b-screenshots/` holds four pictures of a harness page with fictional data (Overview and Upcoming Work, desktop and phone), added by the author of the code; nothing was seen signed in or on a real phone: `Unverified`.

## 5. The two reads

Both are `security definer` functions callable by signed-in users only (M grants; verify pack rows 5 and 6). Both check the caller in the database on every call.

### 5.1 `ops_overview(company)` (M section 7)

Refuses with "Operations is open to the Operations Managers of this company" unless the caller holds `operations` (or `founder`) for that company (`ops_require`). Returns one object:

| Key | Rows | Selected fields (and only these) |
|---|---|---|
| `handovers` | Handovers of the company in `submitted`, `pm_assigned`, `clarification_requested`, oldest submitted first | id, Sales reference, title, status, submitted at, Project Manager id and name, assigned at, installation start, event start, event end, venue (location), event edition label, clarification requested at |
| `projects` | Every project of the company that is not completed or archived, plus finished ones with units out, an open equipment review, or a pending failed release | id, reference, name, kind, status, Project Manager id and name, Chat group id (only when the caller can open it), venue, installation start, event start, event end, edition label; counts: open tasks, overdue tasks, reviews waiting, reviews overdue, overdue milestones, open corrections, proposed plan changes, unreleased plan lines, open equipment reviews; `blockers_total`; up to 5 blockers (task id, title, since, reason cut to 200 characters, assignee, unblock owner, cross-team flag); the next open milestone; one state object per equipment request that is not cancelled (`inv_request_state`, section 9.1); `release_failed` |
| `overlaps` | Section 4.4, at most 60 | person id and name, the two projects' ids and references, from, to |
| `company_id`, `taken_at` | | |

**Never selected:** any Sales field (the handover's scope, exclusions, risks and notes are not in the list either), task descriptions and comments, files, chat text, budgets, costs, any HR data. A handover or project of another company cannot appear (every sub-select is by `company_id`).

### 5.2 `ops_upcoming_work(company or null)` (M section 3)

Returns the flagged enquiries (`ops_flagged_at` set, stage not Lost) of the companies the caller is Operations Manager of (`ops_company_ids`), optionally of one company (then `ops_require` applies), **excluding any enquiry whose handover is accepted** (the project exists; the work is then in Projects and on the Overview). Someone with no Operations company gets an empty list, not a refusal.

**Selected, by name:** id, company, reference, title, stage, owner id and name, flagged at, expected decision date, `dates_tentative` (false once the stage is Won, whatever the tick says), `won`, location, installation start, event start, event end, dismantling date, the linked event edition (event name, label, venue, city, country, published start and end), expected teams, equipment as name and quantity from the enquiry's technologies, "still to confirm", the note for Operations, Operations' planning row (provisional Project Manager id and name, risk, risk note, capacity conflict and note, question with when and who, answer and when), and the latest handover that is not withdrawn (id, status, submitted at, Project Manager name, project id).

**Never selected:** value, currency, budget note, payment terms, the brief, scope, exclusions, risks, win evidence, estimates, proposals, files, activity notes (M header; verify pack row 7 searches the function's source for those names; T test 2 searches the result for seeded secret values).

### 5.3 How the app treats the answers (DA)

Four outcomes are kept apart for each read: data (possibly empty), not installed, refused (`42501` or `P0002`), failed. An answer of an unexpected shape is treated as failed, never as empty.

## 6. Upcoming Work (`/operations/upcoming`)

Heading **Upcoming Work**; description "Enquiries that Sales flagged for operational planning. Tentative work is planned here; nothing is booked until the enquiry is won and its handover is accepted." (UP).

### 6.1 Toolbar

| Control | Options | Effect |
|---|---|---|
| Search ("Search Upcoming Work"; placeholder "Reference, title, Sales owner, place or event") | Free text | Matches reference, title, owner name, location and the edition label, case-insensitive (`filterUpcoming`) |
| **Stage** | "Tentative and won" (default), "Not won yet (tentative)", "Won (confirmed)" | `stage=open` hides won enquiries; `stage=won` shows only them. Note: "Not won yet" also lists enquiries whose dates Sales confirmed; the filter is about the stage, not the tick |
| **Next step with** | "Anyone" (default), "Operations", "Sales", "Project Manager" | Keeps rows whose next step is with that party (section 6.3) |
| Clear | | Back to `?company=<id>` |

Under it: "N of M flagged enquiries for <company>. Prices, quotes and Sales notes are never shown here." Filters are applied in the page to the rows the read returned; they are address parameters (`q`, `stage`, `next`), so a filtered view can be reloaded or linked.

Empty states: no flagged enquiry at all: "No enquiry is flagged for Operations" / "Sales flags an enquiry on its page with Flag for Operations planning. It then appears here with its dates and what is expected."; none matches: "No flagged enquiry matches these filters" / "Clear the filters to see all of them." A refused or failed read shows its own message instead (section 4, "Failed reads").

### 6.2 One flagged enquiry (UC)

Top row: reference, title, stage badge (`STAGE_WORDS`), the **dates badge**, a red **Capacity conflict** badge when Operations flagged one, then the buttons.

The dates badge (`datesWord`): "Confirmed: this enquiry is won" (green) once Won; otherwise "Tentative" (amber) while Sales has the tick on, or "Dates confirmed by Sales; the enquiry is not won yet" (green) once Sales has unticked it.

Buttons:

| Button | Shown when | Goes to / does |
|---|---|---|
| **Assign a Project Manager** (filled) | The enquiry has a handover in `submitted` | `/projects/handovers?handover=<id>`, where the existing **Assign Project Manager** form is (section 8, step 6) |
| **Open the handover** (outline) | The handover is in any other status except draft | The same address |
| **Plan** | Always | Opens the dialog in section 6.4 |

First block, what Sales recorded: **Sales owner**; **Expected decision**; **Event edition** (label, or "Not linked to an event"); **Venue or city** (edition venue and the enquiry's location); **Installation**; **Show**; **Dismantling**; **Expected teams** (Engineering, Content, Programming, Installation, Warehouse); **Expected equipment** ("<name> x <qty>"); **Sales still to confirm** ("Nothing listed"); **Note for Operations** ("None"); **Handover** (the status in words: "Being prepared by Sales", "Waiting for a Project Manager", "Waiting for the Project Manager to accept", "Question sent back to Sales", with the Project Manager's name; "Not prepared yet" when won with no handover; "Starts when the enquiry is won" otherwise). Anything empty reads "Not recorded".

Second block, what Operations recorded: **Provisional Project Manager** ("<name> (provisional, nothing is booked)" or "Nobody yet"; the label becomes **Project Manager** and shows the real one once the handover names one); **Operational risk** (Not assessed, Low, Medium, High, with its note); **Capacity** ("Conflict: <note>" or "No conflict flagged"); **Next step**; and, when Operations asked something, **Question for Sales** with "Sales answered <date>: <answer>" or "Not answered yet".

### 6.3 Who has the next step (`nextResponsible` in MO)

The first rule that applies:

| Recorded state | Next step |
|---|---|
| Handover: question sent back to Sales | Sales (the owner): "Answer the Project Manager's question on the handover" |
| Handover: Project Manager assigned | Project Manager (the name): "Accept the handover" |
| Handover: submitted | Operations: "Assign a Project Manager" |
| Enquiry won, handover in draft or none | Sales (the owner): "Submit the handover" or "Prepare the handover" |
| Operations asked a question, no answer | Sales (the owner): "Answer the question from Operations" |
| Sales listed something still to confirm | Sales (the owner): "Confirm the open details" |
| No provisional Project Manager | Operations: "Name a provisional Project Manager" |
| Otherwise | Sales (the owner): "Decision expected <date>" or "Waiting for the client's decision (no date recorded)" |

### 6.4 The **Plan** dialog (PD, A)

Title "Plan <reference>"; description "What Operations records about this enquiry. Sales sees it on the enquiry."

| Field | Input | Notes |
|---|---|---|
| **Provisional Project Manager** | List: "Nobody yet", then the people with Projects access in this company (from the Projects context) | Hint: "A note for planning. It creates no project, books nobody and reserves no stock. The real assignment happens on the handover once the enquiry is won." The database requires the person to be assignable (`proj_user_eligible`) |
| **Operational risk** | Not assessed, Low, Medium, High | |
| **Why** | Text, up to 500 | |
| **Capacity conflict: this job clashes with other work** | Tick box | |
| **What it clashes with** | Text, up to 500 | |
| **Ask Sales to confirm** | Text, up to 1000 | Hint "Sales sees the question on the enquiry, in its Operations planning panel and its history, and answers there. No separate notice is sent." or, once answered, "Sales has answered. Changing the question clears that answer and asks again." The question is sent **only when its text changed**, and the database also keeps who asked, when and the answer when the text is the same, so saving the form again does not clear an answer |
| **Save planning** | | `saveEnquiryPlanning` -> `ops_set_enquiry_planning` |

**Who can act:** an Operations Manager (or founder) of the enquiry's company, checked in the function. **What it changes:** the one `ops_enquiry_planning` row of that enquiry, and a line in the enquiry's history **only for what actually changed**: a provisional Project Manager named or removed, a capacity conflict flagged or cleared, a new question ("Operations: provisional Project Manager named: <name>; capacity conflict flagged; asked Sales to confirm details"). A repeated identical save writes no new history line. **It writes nothing else:** no project, no member, no booking, no reservation (T test 3 compares the counts before and after). **What happens next:** the dialog shows "Saved. The provisional Project Manager is a note for planning: no project, crew or stock was booked." (or "Saved." when nobody is named) and the page refreshes; Sales sees the result on the enquiry (section 7.3).

**Sales is not sent a notice.** Sales has no notice list, so Sales finds out on the enquiry: the "From Operations" block and the history line. The dialog's hint says so (M comment in `ops_set_enquiry_planning`; section 12).

**Refusals** (A `FRIENDLY`): "This enquiry is not available to you in Operations. It may have been removed from Operations planning, or your Operations access for this company has ended."; "Sales has removed this enquiry from Operations planning. Reload the page."; "This enquiry was lost, so it can no longer be planned."; "Choose someone who has Projects access for this company."; a field over its length says so; a value the database does not accept (an unknown risk, a malformed id, an over-long text) is refused there with "Check the planning details: a choice is not valid or a text is too long" and shown as the general message; anything else: "The planning details could not be saved. Try again." There is no version check: two Operations Managers saving at once, the later save wins.

## 7. The Sales side: "Operations planning" on an enquiry

On the enquiry page (`/sales/opportunities/[id]`), **Overview** tab, left column, after Follow-ups (SP `overview-panel.tsx`). It loads on its own ("Loading the Operations planning details…"), so it never holds up the tab. Reference for the rest of the page: [`sales-enquiries.md`](./sales-enquiries.md).

**Who sees it:** anyone with Sales access who can open the enquiry. **Who can act:** the enquiry's owner or a Sales founder of that company (`canEdit`; `crm_require_owner_or_founder` in `crm_set_ops_planning`). Everyone else sees the same state without buttons, and on an unflagged enquiry: "Only the owner of this enquiry or a Sales founder can flag it."

### 7.1 Not flagged

Text: "Operations cannot see this enquiry until it is flagged. Prices, quotes and notes are never shown to Operations." Button **Flag for Operations planning** (owner or founder; not on a Lost enquiry, which says "A lost enquiry cannot be flagged for Operations planning."). Nothing is read from Operations for an unflagged enquiry.

### 7.2 The dialog (**Flag for Operations planning** / **Edit planning details**)

Description when flagging: "Operations will see this enquiry in Upcoming Work so they can plan ahead. Nothing is booked, reserved or created by flagging it." A note at the top: "Operations also reads these from the enquiry itself: the location, the installation and event dates, the technologies and quantities, and the linked event edition. Keep them up to date with Edit details. Prices, quotes and notes are never shown to Operations."

| Field | Input | Stored as |
|---|---|---|
| **Expected decision date** | Date; hint "When you expect the client to decide." | `ops_decision_date` |
| **Dismantling date** | Date | `ops_dismantle_date` |
| **Dates are tentative** | Tick box, on by default. Hint: "Untick this once the client has confirmed the installation, event and dismantling dates."; on a Won enquiry: "This enquiry is won, so Operations sees the dates as confirmed whatever is ticked here." | `ops_dates_tentative` |
| **Expected teams** | Tick boxes: Engineering, Content, Programming, Installation, Warehouse | `ops_teams` |
| **Still to confirm** | Text, up to 1000; hint "What you are still waiting to hear from the client, in plain words." | `ops_to_confirm` |
| **Note for Operations** | Text, up to 1000; hint "Operations can read this note. Do not put prices or commercial terms here." | `ops_note` |
| Submit **Flag for Operations planning** / **Save planning details**; **Cancel** | | `setOpsPlanning` -> `crm_set_ops_planning(id, true, fields, version)` |

**What "tentative" means.** It is Sales' statement that the dates are not confirmed by the client. It changes nothing but the word Operations reads: "Tentative" while ticked, "Dates confirmed by Sales; the enquiry is not won yet" once unticked, "Confirmed: this enquiry is won" once Won, whatever the tick says (the read clears it for a won enquiry; SL `opsDatesText`; MO `datesWord`; T test 4). Nothing is booked in any of the three states.

**What saving changes:** the eight planning columns on the enquiry, the enquiry's version (plus one), and on first flagging the history line "Flagged for Operations planning" and the notice **Sales flagged <reference> for Operations planning** to each Operations Manager of the company (section 11). Every field of the dialog is sent, so an emptied field is cleared. The flag date is kept when the details are edited later.

### 7.3 Flagged

Description: "Operations can see this enquiry in Upcoming Work. Prices, quotes and notes are never shown to Operations." Buttons for the owner or a founder: **Edit planning details** (not on a Lost enquiry) and **Remove from Operations planning**. Facts: **Flagged on**, **Expected decision date**, **Dates** (the three wordings above), **Dismantling date**, **Expected teams**, **Still to confirm**, **Note for Operations**. On a Lost enquiry: "This enquiry was lost, so its planning details can no longer be changed. It can still be removed from Operations planning."

Block **From Operations** (read `crm_ops_planning`, any Sales access to the company):

| State | Shown |
|---|---|
| Read failed | In red: "What Operations recorded could not be loaded. This does not mean Operations has recorded nothing. Reload the page to try again." No answer box is offered |
| Nothing recorded | "Operations has not recorded anything for this enquiry yet." |
| Recorded | **Provisional Project Manager** (name or "Nobody named yet") with "Provisional. No project, crew or stock is booked by this."; **Risk** (badge Not assessed, Low, Medium, High, and the note); **Capacity conflict** (badge, or "None flagged", and the note); **Question from Operations** with who asked and when, the answer with its time or "Not answered yet.", or "Operations has not asked anything." |

**Answer** (owner or founder, enquiry not Lost, a question exists): field **Your answer** (or **Change your answer**), hint "Operations can read this. Do not put prices or commercial terms here.", button **Send answer to Operations** (or **Replace the answer**). `answerOpsQuestion` -> `crm_set_ops_planning(id, null, {answer}, version)`: a flag of null leaves the flag as it is, so an answer never flags an enquiry that was removed. It stores the answer with who and when where a question exists, and only then sends **Sales answered your question on <reference>** to the Operations Managers.

**Remove from Operations planning** (confirmation dialog: "Operations will no longer see this enquiry in Upcoming Work." / "The planning details you entered stay on the enquiry, and what Operations recorded is kept. Flag the enquiry again to show it to Operations again. Nothing was booked, so nothing is released."). `removeOpsPlanning` -> `crm_set_ops_planning(id, false, {}, version)`. It clears the flag date and who flagged, writes the history line "Removed from Operations planning", and the enquiry leaves Upcoming Work on the next read (T test 11). No notice is sent.

**Refusals and failures (SA).** A stale page: "This enquiry was changed by someone else. Reload the page to see the latest version, then make your change again." (checked in the app first, then by the function). Not the owner or a founder, a Lost enquiry, an unknown field: the function refuses and the message is the standard Sales wording (`friendlyCrmError`). A date that is not a real date is refused in the form ("Use a valid date"); a value in the wrong form reaching the function is refused with "Check the planning details: ..." and nothing is saved. Database without this migration: "Operations planning is not available yet, so nothing was saved. Trying again will not help until a required database update is installed. Ask the system owner to complete the Operations database update."

## 8. Workflow end to end: flag, plan, won, handover, assign, accept, project with its edition

| # | Who | Step | What is written | Who is told | Source |
|---|---|---|---|---|---|
| 1 | Sales (owner or founder) | **Flag for Operations planning** on the enquiry | Planning columns; history "Flagged for Operations planning" | Operations Managers of the company: notice `project_ops_enquiry_flagged` | M `crm_set_ops_planning`; T test 2 |
| 2 | Operations Manager | **Plan** in Upcoming Work: provisional Project Manager, risk, capacity conflict, a question | `ops_enquiry_planning`; history line "Operations: ..." | Nobody by notice; Sales reads it on the enquiry | M `ops_set_enquiry_planning`; T test 3 |
| 3 | Sales | Answers the question; unticks **Dates are tentative** when the client confirms | The answer; the tick | Operations Managers: `project_ops_sales_answered` (for the answer only) | M; T test 3 |
| 4 | Sales | Closes the enquiry as Won (existing flow) | As before | As before | `sales-close-and-handover.md` |
| 4a | (automatic) | Upcoming Work now reads "Confirmed: this enquiry is won"; next step "Prepare the handover" | Nothing | | M `ops_upcoming_work`; MO |
| 5 | Sales | Saves and submits the handover (existing flow) | The handover; **the handover takes the enquiry's event edition and a snapshot of it** (trigger `trg_proj_handover_edition`) | Existing handover notices; an Operations Manager who holds neither `founder` nor `assign_pm` is sent the same `project_handover_submitted` by the new trigger `trg_proj_handover_submitted_ops` when no Project Manager was named | M section 4; T test 4 |
| 6 | Operations Manager (or a founder or `assign_pm` holder) | **Assign a Project Manager** on the handover, from the Overview, Upcoming Work or Handovers | The handover (existing `proj_assign_handover_pm`) | The person named (existing `project_handover_assigned`) | M200; T test 4 |
| 7 | The named Project Manager | **Accept handover** (existing) | The project, its details, the member row, the Sales links; **the project's details take the handover's edition copy** (trigger `trg_proj_details_edition`) | Existing | M section 4; T test 4 (a second Accept returns the same project) |
| 8 | (automatic) | The enquiry leaves Upcoming Work; the project is on the Overview under Upcoming delivery, with the edition label beside the venue | Nothing | | M `ops_upcoming_work`, `ops_overview`; T test 4 |
| 9 | Project Manager | Changes a committed date while a request is with the warehouse | A review row per request and date (section 9.2) | The Project Manager, unless they made the change themselves. A date changed back to the original closes the review by itself | M section 6; T test 7 |
| 10 | Project Manager | Completes the project while equipment is out | As before; the project stays on the Overview with "Delivery complete · equipment still out" until the warehouse records the return | | M section 7; T test 9 |

### 8.1 The event edition, exactly

* **Snapshot** (`ops_edition_snapshot`): edition id, event id, event name, label ("<event name> · <year of the start date> · <city>"), venue, city, country code, published start and end dates, and when it was taken.
* **When the handover takes it** (`proj_handover_edition`, before insert or update): on insert; on any update while the handover is a draft; on any update whose earlier status was draft or "question sent back to Sales"; and on the change to submitted. It reads the enquiry's current `event_edition_id`. An enquiry with no edition leaves both columns empty. An accepted handover is never changed (none of the conditions holds, and the existing freeze trigger still applies).
* **When the project takes it** (`proj_details_edition`, before insert on the project's details): from the handover the project was created from. An internal project, and a project from a handover with no edition, stay unlinked.
* **It is a copy.** A later edit to the edition in Sales reaches neither the submitted handover nor the project, and never moves a project date (T test 4 edits the venue, dates and city afterwards).
* **Existing rows:** open handovers (draft, submitted, assigned, question sent back) take their enquiry's edition when the migration is applied (preflight row 7 counts them). **Handovers already accepted and existing projects stay unlinked**; nothing backfills them.

Where the edition is shown:

| Place | What | Who | Source |
|---|---|---|---|
| Work page, details card | Fact **Event edition**: the label, "Venue: ...", "Published show dates: ...", the note "These are the dates the organiser published when the handover was submitted. Later changes to the event in Sales do not change this project.", and **Open event in Sales** only when the viewer's own session can read the edition in Sales; "Could not check whether you can open this event in Sales. Reload to try again." when that check fails | Readers of the project's details | WA (`details-card.tsx`, `work/page.tsx`); test `details-card.test.tsx` |
| Projects directory | Under the project name "Event edition: <label>"; filter **Event edition** ("All editions", then each edition once, latest show first), offered only when at least one visible project has an edition; address parameter `edition`. A failed read: "Event editions could not be loaded just now, so no project shows its edition and the edition filter is not offered. Everything else is shown." | Everyone who sees the row (`proj_project_editions` returns only projects the caller may see in the directory) | DI; test `directory.test.ts` |
| Handover brief | Fact **Event edition** (label), only when the handover has one | Readers of the handover | HB; test `handover-brief.test.tsx` |
| Sales event page | Card **Delivery projects for <edition> (N)**: "Projects delivered for this edition that you can see in Projects. A project keeps the edition it was handed over with.", each with its reference (link to `/projects/<id>`), name and status. Drawn only when at least one project is visible to the viewer; a failed read says "The delivery projects of <edition> could not be loaded. Reload to try again." | Sales access to open the page; rows only for projects the viewer may see in Projects (`proj_projects_for_edition`) | EV; [`sales-events-and-exhibitions.md`](./sales-events-and-exhibitions.md) |
| Operations | Edition label beside the venue (Overview) and **Event edition** on a flagged enquiry (Upcoming Work, read live from the enquiry, not a copy) | Operations Managers | OV, UC |
| Closeout Report evidence | A line "Event edition: <label>. Venue: ... Published show dates: ..." or "Event edition: not recorded." | Whoever manages the project | CE; M section 8; [`projects-closeout-report.md`](./projects-closeout-report.md) section 3 |

## 9. Equipment: readiness, booking review, finished projects

### 9.1 Readiness per request (`inv_request_state`, `proj_equipment_readiness`)

`proj_equipment_readiness(project)` is readable by anyone who can read the project's details, the company's Operations Managers and its warehouse (`inv_has_capability(..., 'warehouse')`); everyone else gets "Project not found". It returns the project status, one state per request that is not cancelled, the open reviews, and the failed release if one is pending.

One request's state, from its lines that are not cancelled and their reservations (`inv_line_progress`):

| State (word on screen) | When (first rule that applies) |
|---|---|
| Not sent to the warehouse yet | The request is a draft. A draft is never counted as reserved |
| Cancelled | The request is cancelled (not listed in readiness) |
| No lines | The request has no line that is not cancelled ("The request has no lines, so nothing is reserved") |
| Partly dispatched | Something was dispatched and either a line is short or not every line has been dispatched. **A request with a short line is never "Dispatched" or "Returned"** |
| Returned | Something was dispatched and nothing is out |
| Still out | Units are out and some have come back |
| Dispatched | Units are out, nothing returned yet |
| Partly ready | Some, not all, lines are short; or no line is short but not every line is fully reserved |
| Short | Every line is short |
| Reserved | Every line is fully reserved for the request's dates |

A line is **short** by what is asked and neither reserved for the window nor already sent, counted only while the request is with the warehouse (submitted, in progress, fulfilled) and the line is open.

**A line whose shortage is to be bought or rented is short. It is never counted as reserved** until stock is reserved for it (M comment; `short_buy`, `short_rent`, `short_no_plan`; T test 8). `return_overdue` is true when units are out and the expected return has passed.

Where it is shown:

* **Equipment tab**, on each request row: "Readiness: <badge> · <detail>" (EQ `ReadinessLine`, `readinessLine`), for example "Partly ready · 2 of 3 lines reserved · 1 line short: 1 to buy". If the read failed: "Equipment readiness could not be loaded. Reload to try again; the requests below are still shown." and the same sentence on each row.
* **Work page**, delivery summary, **Equipment**: a failed import or a draft still comes first; then the readiness (one request: its word and detail; several: counts per state, "N requests with the warehouse"), with " · Review equipment booking" when a review is open; a failed read says "Equipment readiness could not be loaded" and is never shown as nothing waiting (WA `equipmentSummary`, `readinessSummary`).
* **Operations Overview**: the equipment lines and the pressure panel (section 4).

**Inventory Today** (IT): the readiness sentence of a request no longer counts a line to buy or rent as fully reserved. The fact now reads "F of L lines fully reserved · R still to reserve · B to buy or rent", the three counts always add up to the open lines, the fact about lines that can go reads "N line has reserved stock to send" / "N lines have reserved stock to send" (not "ready to send", because a partly reserved line is counted there and among the short ones), the title says "ready to send in part" (never plain "ready to send") while any line is still to reserve or to buy or rent, and a separate fact "N lines to buy or rent" is added (test `today.test.ts`).

### 9.2 Review equipment booking

**When a review is recorded** (trigger `trg_proj_details_dates_changed`): the project's installation start, event start or event end changes while the project has a request in `submitted`, `in_progress` or `fulfilled`. One row per request and date in `proj_equipment_reviews`: the old date, the new date, who changed it and when. A second change of the same date before the review is resolved keeps the first "old" date and updates the new one. **A date changed back to the date the booking was made for closes the review by itself** (the open row is deleted; no notice). **It changes no reservation and no request date** (T test 7 compares the reservations before and after). The Project Manager is sent **Review equipment booking: <request code>** (once per request while unread; not when the Project Manager made the change, because `proj_notify` never tells the caller).

**Where it shows:**

* **Equipment tab**, panel **Review equipment booking** ("A project date changed after the equipment was requested."): the sentence "The booking has not been changed. The warehouse changes it on the request, where conflicts are checked."; per review the request code, which date (Installation start, Event start, Event end), "was <old> · now <new>" ("not set" for an empty date), "Changed by <name> on <time>", the link **Open request <code> to change its dates** (`/inventory/requests/<id>`), and the form below. Shown on a finished project too.
* **Work page**, What needs doing: one line per request, label **Review equipment booking**, "Request <code>", the dates and "The booking has not been changed.", linking to the Equipment tab; under "needs you" for whoever manages the project, otherwise under waiting on the Project Manager (WA).
* **Inventory request page** (`/inventory/requests/<id>`), for a project request: the same panel, filtered to that request, so the warehouse sees it where the booking is changed. **Mark as reviewed** is offered to someone who operates a warehouse location or manages the request. If the read fails: "Whether a project date changed for this request could not be loaded. Reload to check before changing the booking." (`apps/web/src/app/(app)/inventory/requests/[id]/page.tsx`).
* **Operations Overview**: Needs my decision and Most relevant issue (section 4).

**Mark as reviewed** (EQ `EquipmentReviewForm`; `resolveEquipmentReview` -> `proj_resolve_equipment_review`): optional **Note (optional)** up to 500 characters (placeholder "What was decided, for example: the warehouse moved the booking").

* **Who:** whoever manages the project (Project Manager, temporary leader, founder) or the warehouse of its company; the function decides. The page offers the form on the same rule; anyone else reads "The Project Manager or the warehouse marks this as reviewed." **An Operations Manager cannot mark it** (not a manager, not warehouse).
* **What it changes:** the review row only (resolved at, by, note). **It records that someone looked. It moves no booking:** changing the booking stays the warehouse's work on the request, with its own conflict checks.
* **After:** the review leaves the panel, the Work page and the Overview. A second press does nothing.
* **Refused:** "This review was not found, or you are not allowed to mark it. The Project Manager or the warehouse can."

### 9.3 A finished project with equipment still out

Completing a project never returns equipment (unchanged). New in this phase:

* **Equipment tab and Work page:** the notice **Delivery complete · equipment still out**, listing per request "N units out · expected back <time>" or "no expected return recorded", with " · overdue" when it is; "Completing a project does not return equipment: it stays outstanding until the warehouse records its return." (EQ `StillOutNotice`, `stillOutAfterDelivery`). On the Work page the request codes are plain text with a link **Open Equipment**.
* **Operations Overview:** the project stays under Upcoming delivery with the same badge until everything is back (T test 9).
* **The finished-project sentence on the Equipment tab** now says "unused reservations were released when it finished" **only when the readiness read succeeded and reports no failed release**; otherwise it says only that the list is read-only.

### 9.4 When releasing unused reservations failed at completion

The existing completion trigger logs a failed release and lets the project complete. New: the failure is **reported while something is still left to release** (`inv_project_release_pending`: a request still in draft or submitted, or an active reservation with stock not dispatched) and the latest failed log line exists. Then:

* **Equipment tab:** a red notice "Releasing unused reservations failed when the project finished." / "It failed on <time>. <detail>" / "Ask the warehouse to release the unused lines on the request." with **Open request <code>** links (EQ `ReleaseFailedNotice`).
* **Operations Overview:** "Unused reservations not released" in Needs my decision, owner "Warehouse", and the first-ranked Most relevant issue.

**There is no automatic recovery and no retry button.** Nothing re-runs the release for a project; the warehouse releases or cancels the lines by hand on each request, and the notice clears by itself once nothing is left (EQ page comment; M comment on `proj_equipment_readiness`; T test 9).

## 10. Chat

Reference for Chat as a whole: [`app-chat.md`](./app-chat.md) (section 10 covers this phase).

* **Operations path** (`chat_is_ops`): a person who holds the `operations` capability **itself** for the project's company is a member of that project's Chat group: listed in `chat_my_groups`, may read, post and mark read, and `chat_project_group` returns the group. The founder shortcut is **not** this permission: a founder who is not on the project still has no path (T test 6).
* **Groups appear before anyone has posted:** `chat_my_groups` creates the missing group of each live project (not completed or archived) of an Operations Manager's companies.
* **Tag and note:** a group the person reads through Operations and not as a team member shows a small tag **Operations** in the list and, at the top of the thread, "You are reading this as Operations Manager. You are not on this project's team." (`via_operations`; CH).
* **Archived (N):** the groups of **archived** projects are listed under a collapsed heading "Archived (N)" after Sales and Projects. Pressing it opens and closes the section; a search opens it; while closed, the heading carries the section's unread count and a mention marker, so nothing is dropped from the totals. A completed project that is not archived stays under Projects; a restored project's group is back under Projects on the next refresh (CH `groupSections`, `archivedHeading`; `project_status` from the read; T test 10).
* **Mentions:** `chat_group_members` for a project group now lists the people on the project and, marked "(Operations)" after their name, the company's Operations Managers who are not on the project. They can be chosen in the @ picker and mentioned. The membership line under a project group's name reads "The people on this project, and the company's Operations Managers" (`lib/chat/model.ts`).
* **"Open project chat"** on the Overview is offered only when the viewer can open the group (section 4.3) and opens `?chat=<group>`. A link to a group the person cannot open says "That conversation is not available to you. A project's chat is open to the people on that project and to the company's Operations Managers." (CH).
* **Cost:** `chat_my_groups` works through every project group of the caller's Operations companies, so the list gets slower as projects accumulate: about 1.5 s at 3,000 groups in the independent reviewer's measurement (reported, not measured by the author of this reference).
* **Unchanged:** the three Sales groups, the read-only rule for finished projects, the membership rule for team members, messages and their storage.

## 11. Notices

Three new types and one wider audience, all shown in the existing Project notices list (My Work, My Day; `proj_my_notifications`), worded in NT:

| Type | Text | Opens | Sent to | When |
|---|---|---|---|---|
| `project_equipment_review` | "Review equipment booking: <request code>" | The project's Equipment tab | The Project Manager (never the person who made the change) | A committed date changed while a request is with the warehouse |
| `project_handover_submitted` (existing type) | The existing handover wording | The handover | Now also holders of `operations` who hold neither `founder` nor `assign_pm` (trigger `trg_proj_handover_submitted_ops`) | A handover is submitted without a Project Manager |
| `project_ops_enquiry_flagged` | "Sales flagged <reference> for Operations planning" | `/operations/upcoming` | Holders of the `operations` capability itself for that company (not a founder without it; never the caller) | An enquiry is flagged for the first time (or again after being removed) |
| `project_ops_sales_answered` | "Sales answered your question on <reference>" | `/operations/upcoming` | Same | Sales sends an answer to a question that exists |

The Operations notices carry the enquiry's reference and id, never what was written. A second identical notice is not added while the first is unread (`dedupe_key`). Nothing is sent by email or outside the app.

## 12. Limits and known gaps (stated plainly)

1. **No automatic recovery when releasing unused reservations fails at completion.** The warehouse releases by hand; the notice clears when nothing is left (section 9.4).
2. **A project has no dismantling date.** Sales records one on the enquiry for planning (shown in Upcoming Work); it is not carried into the handover or the project, so the Overview always says "Not recorded on the project". (An equipment request has its own "Dismantling finished" planning date in Inventory; Operations does not read it.)
3. **Sales has no notice list.** Sales sees what Operations recorded on the enquiry (From Operations) and in its history; no notice is sent, and the Plan dialog says so.
4. **The Chat list costs more for an Operations Manager with very many projects:** about 1.5 s at 3,000 groups in the reviewer's measurement (section 10).
5. **Overlaps need both projects' dates** (a start and an event end) and the people recorded on both; an unrecorded clash does not show.
6. **Participation open to an Operations Manager** (task comments, corrections, unrestricted files and links, the old Discussion) is intended (section 2.3) and is not named in the description shown on People & Access; it is not exercised for this role in the database tests.
7. **The warehouse gets no notice of a booking to review.** The notice goes to the Project Manager only; the warehouse sees the panel on the request page in Inventory and on the project's Equipment tab, not in a list of its own (Inventory Today does not show it).
8. **A question sent back by the Project Manager re-takes the edition on the next update of the handover** (section 8.1), including a reassignment made while it is in that state.
9. **JARVIS:** guidance only. No JARVIS action, read or capability was added (`jarvis-rulebook.md` section 7).
10. **Nothing was checked signed in; no hosted migration was run; no browser flow exists for this phase** (`apps/web/os-shell-checks/README.md` lists none).

## 13. Rollout and tests

Rollout guide: [`docs/projects-operations-deployment.md`](../../projects-operations-deployment.md). Install order: `docs/launch-refinement-install-order.md` row 30.

Tests in the repository (counts are the number of `it(...)` blocks in each file; whether they pass on this branch is for the person who ran them to state):

| File | Count | What it covers |
|---|---|---|
| `packages/rls-tests/test/ops-phase2b.rls.test.ts` | 11 (counted at `3e7e348`) | The capability and what it implies; flagging and the allowlist; planning writes nothing else; won, assign, accept, the edition copy; Overview access and revocation; Chat path; date-change review; readiness states; equipment out after completion and the failed release; Chat status and the closeout edition; removing the flag, the owner packs, rollback and re-apply |
| `apps/web/src/lib/operations/model.test.ts` | 8 | Dates word, next step, filters, equipment line, Needs my decision, at-risk window, complete-but-out, pressure |
| `apps/web/src/app/(app)/operations/operations-pages.test.tsx` | 6 | Overview order and links, refused / failed / empty, company chooser, Upcoming Work fields, won and submitted, the three empty and failure messages |
| `apps/web/src/app/(app)/sales/opportunities/[id]/ops-planning-panel.test.tsx` | 18 | The Sales panel in each state |
| `apps/web/src/lib/actions/crmOps.test.ts` | 11 | The three Sales actions |
| `apps/web/src/lib/projects/equipment-readiness-model.test.ts`, `components/projects/equipment-readiness.test.tsx` | 12, 5 | Readiness words, review text, the notices |
| Changed existing files | | `nav-groups.test.ts`, `chat-launcher.test.tsx`, `lib/chat/model.test.ts`, `today.test.ts`, `work-attention.test.ts`, `directory.test.ts`, `details-card.test.tsx`, `handover-brief.test.tsx`, `notification-text.test.ts`, `closeout.test.ts`, `module-access-panel.test.tsx`, `peopleAccess.test.ts`; domain `projPermissions.test.ts`, `accessProfiles.test.ts`, `peopleAccess.test.ts` |

Not run by the author of this reference: the database suite and the web suite as a whole (the JARVIS guidance tests were run after the guidance was republished; see the change log entry).
