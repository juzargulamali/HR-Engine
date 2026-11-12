# Operations (Projects & Tasks Phase 2B): Operations Manager, Overview, Upcoming Work, Operations planning on an enquiry, event edition on projects, equipment readiness and booking review, Operations on My Day

Part of the Projects & Tasks Map: [coverage index](./projects-coverage-index.md) (section 9) and [action catalogue](./projects-action-catalogue.md) (section 11). The Sales side is also in the [Sales coverage index](./sales-coverage-index.md) (rows 82 and 83) and the [Sales action catalogue](./sales-action-catalogue.md) (section 3.10).

Status: written on branch `claude/projects-phase-2b-operations` (2026-11-12) against the files cited below. Re-read against commit `3e7e348` ("fixes from the independent review") and the following commit, which adds the file and link guard and the reason on a Project Manager change. **Code read only by the author of this reference; nothing was run signed in, in Preview or in Production.** The database rules have their own test file on a real PostgreSQL (`packages/rls-tests/test/ops-phase2b.rls.test.ts`, 11 tests, counted in the file) and the screens have unit tests (section 13); this reference states what those files contain and does not claim a run. Reported by the author of the code: the full suites were run locally by the author of the code on the final code of this branch (2026-11-12): database 76 files / 1,977 tests, web 283 files / 3,282, domain 43 / 525, lint and typecheck clean. Draft pull request: #86. Migration `supabase/migrations/20270102000100_ops_phase2b.sql` (install-order row 30): **not applied by Claude. Treated as applied on the shared hosted database since 2026-11-12, on the owner's report that the signed-in Preview checks of PR #86 passed (those checks need it); the application itself is owner-reported by implication and `Unverified` by Claude. It must not be edited: any further database change is a new migration.**

**Redesign of 2026-11-12 (commits `265c516`, `4086841`, `93ec0f2`, `d9e8338`, `16d6f42`; app only, no SQL, no new migration, no change to permissions):** sections 4 (Overview), 6.2 (the Upcoming Work card), 10 (Archived now holds completed projects too), 13 (tests) and the new section 14 (Operations on My Day) were rewritten against the code at `16d6f42`; the other sections were not re-read in that pass and keep the stamp above. Code read only; nothing was seen signed in. Reported by the author of the code for these commits: lint and typecheck pass; web 286 files / 3,323 tests pass; `ops-phase2b.rls.test.ts` 12 tests pass; the full database suite: 76 files / 1,978 tests pass (run locally on `16d6f42`).

**Release status (four facts kept apart, 2026-11-12):** **Merged:** no; PR #86 is a draft. **Required CI on the exact head:** `lint-typecheck-test` and `rls-policies` green on head `5bdbf08` (reported to the author of this reference, not read from GitHub by them); on the five commits after it: green on `16d6f42` (both checks; later commits change docs and the generated guidance copy only, and their CI is read on GitHub, not recorded here). **Hosted database:** the owner reported on 2026-11-12 that the signed-in Preview checks of PR #86 passed; those checks need migration `20270102000100` on the shared database, so it is treated as applied and never edited. No preflight or verify result was reported: the application is owner-reported by implication, `Unverified` by Claude. **Production:** not deployed, not verified. *(History: until that report this line said "no pull request yet" and "owner result none".)*

Sources (short letters used below):

* **M** `supabase/migrations/20270102000100_ops_phase2b.sql`; owner packs `supabase/manual-sql/ops_phase2b_00_preflight_readonly.sql`, `ops_phase2b_20_verify_readonly.sql`, `ops_phase2b_90_rollback.sql`; tests `packages/rls-tests/test/ops-phase2b.rls.test.ts` (**T**).
* **D** `packages/domain/src/permissions/proj.ts`; **PA** `packages/domain/src/peopleAccess.ts`, `accessProfiles.ts`.
* **N** `apps/web/src/components/nav/nav-groups.ts`, `nav-icons.ts`, `shell-chrome.tsx`.
* **OL** `apps/web/src/app/(app)/operations/layout.tsx`; **OP** `operations/page.tsx`; **UP** `operations/upcoming/page.tsx`.
* **OV** `apps/web/src/components/operations/overview-view.tsx`; **UC** `upcoming-card.tsx`; **PD** `planning-dialog.tsx`; **PT** `parts.tsx`; **VS** `visuals.tsx` (health label, kind mark, readiness bar, count bar; shared with My Day).
* **MO** `apps/web/src/lib/operations/model.ts`; **DA** `lib/operations/data.ts`; **A** `lib/actions/operations.ts`; **MD** the My Day files named in section 14.
* **SP** `apps/web/src/app/(app)/sales/opportunities/[id]/ops-planning-panel.tsx`, `ops-planning-forms.tsx`, `overview-panel.tsx`; **SA** `lib/actions/crmOps.ts`; **SL** `lib/crm/ops-planning.ts`, `ops-planning-data.ts`.
* **EQ** `apps/web/src/app/(app)/projects/[id]/equipment/page.tsx`, `components/projects/equipment-readiness.tsx`, `equipment-review-form.tsx`, `lib/projects/equipment-readiness-model.ts`, `equipment-readiness.ts`, `lib/actions/projectsEquipmentReview.ts`; **WA** `lib/projects/work-attention.ts`, `projects/[id]/work/page.tsx`, `work/details-card.tsx`.
* **DI** `apps/web/src/app/(app)/projects/page.tsx`, `lib/projects/directory.ts`, `lib/projects/data.ts`; **HB** `components/projects/handover-brief.tsx`; **EV** `app/(app)/sales/events/[id]/page.tsx`; **CE** `lib/projects/closeout/evidence.ts`.
* **CH** `apps/web/src/components/chat/chat-launcher.tsx`, `chat-thread.tsx`, `lib/chat/model.ts`, `lib/chat/data.ts`; **NT** `lib/projects/notification-text.ts`; **IT** `lib/inventory/today.ts`.
* Earlier migrations named where a rule comes from them: **M200** `20261120000200_proj_projects_handover_functions.sql`, **M000** `20261120000000_proj_access_audit.sql`, **M300** `20261120000300_proj_delivery_functions.sql`, **M500** `20261120000500_proj_feedback_plans_files_completion.sql`, **M27** `20261230000100_chat_project_groups.sql`, **M28** `20261231000100_proj_delivery_plan.sql`.

## 1. What Operations is, and what it is not

Operations is a **view across one company's projects and the enquiries Sales has flagged**, for the person who decides who runs each job and who needs to see trouble early. It has two screens, **Overview** (`/operations`) and **Upcoming Work** (`/operations/upcoming`), and one small record of its own: the planning row of a flagged enquiry.

* **It reads; the owners of the work act.** Every item on the Overview is a recorded fact (a handover without a Project Manager, a blocked task, a date that changed while equipment is booked) with a link to the screen where the responsible person acts (OV, MO header). The page footer says: "Operations reads these records; it does not change tasks, bookings or stock."
* **No score, no capacity figure, no second progress tracker** (MO header; M section 7 comment). The Project health label (section 4.7) is a rule read from recorded facts with its evidence shown, not a score and not a measure of anyone's performance. What is not recorded is shown as "Not recorded".
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
| Description shown to the person granting it | "Open the Operations workspace for this company, assign or change Project Managers, read this company's projects, comment on tasks, raise corrections and take part in its project chats. Gives no Sales, Finance, HR or Warehouse rights, and does not manage tasks or deliveries or add files." | D (`PROJ_CAPABILITY_LABELS.operations`) |

### 2.2 What it gives (verified in the SQL and the domain package)

| Right | How | Source |
|---|---|---|
| The Operations menu and both screens for that company | Menu: any Projects grant with `operations` or `founder`. Screens: `getOperationsContext` lists the companies from `opsCompanyIds`; each read is checked again in the database (`ops_require`, `ops_company_ids`) | N; DA; M section 1 |
| **PM assignment (`assign_pm`) is implied, for handovers and for reassigning a live project's Project Manager only** | `proj_has_capability(company, 'assign_pm')` is true for a holder of `operations` (database and domain): assign or change the Project Manager on a handover (`proj_assign_handover_pm`), change the Project Manager of a live project (`proj_assign_pm(project, person, reason)`: a **Reason** of 3 to 500 characters is now required of everyone, it is kept in the project's history, and the outgoing Project Manager is sent `project_pm_changed`; tasks keep their owners and no equipment booking is touched), read the company's handovers (`proj_handovers_select`), the **Handovers** menu entry, My Work's "waiting on you" for a submitted handover. They are told when a handover is submitted without a Project Manager (`project_handover_submitted`, trigger `trg_proj_handover_submitted_ops`) and read staff names where an assigner does (`proj_staff_directory`) | M section 1 (`proj_has_capability`); D (`hasProjCapability`); M200; `20261120000100_proj_core_tables.sql` (policy `proj_handovers_select`); T test 4 |
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

**What an Operations Manager may add to a project they are not on, under their own name** (M header and section 1):

* a comment on a task, and edits to their own comment (`proj_comment_task`, `proj_edit_task_comment`, M300);
* a Delivery Plan correction (`proj_dp_raise_correction`, M28);
* messages in the project's conversation: the Chat group (section 10), and the old Discussion functions (`proj_post_message`, `20261120000400_proj_plans_site_calendar_discussion.sql`), whose tab is gone once project chat groups exist.

**They may not add a file or a link.** The functions that add them ask only that the caller can read the project, which now includes Operations, so the migration adds a narrower guard: a signed-in person inserts into `proj_files` or `proj_upload_intents` only as a founder of the company or an active member of the project (`proj_file_contributor_guard`, triggers `trg_proj_files_contributor`, `trg_proj_upload_intents_contributor`; "Only the people on this project can add files or links to it"). The Files page says to such a reader: "You are reading this project as Operations Manager. Files and links are added by the people on the project." (`apps/web/src/app/(app)/projects/[id]/documents/page.tsx`).

**An Operations Manager cannot:** create, assign, move or review a task; edit the Delivery Plan; decide a correction or a proposed change; manage, edit or complete the project; add files or links; see restricted files or the commercial record of a scope change; create an internal project; change a project's Sales links. The description shown on People & Access ("does not edit tasks or deliveries") does not mention comments and corrections; whether T exercises them for this role was not re-read after the last change (`Unverified`).

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

**Redesigned on 2026-11-12 (commit `265c516`; this section re-read against `16d6f42`).** The reads, the access rule and the six decision kinds are unchanged; what changed is what the page draws from them. Before this commit the page had four panels (Needs my decision, Coming up from Sales, Upcoming delivery with one card per project and a "Most relevant issue", Team and warehouse pressure); that layout is history.

Heading **Operations**; description "<company>: what needs a decision, what goes on site soon and which projects may miss a date." (OP). Two reads run together: `ops_overview(company)` and `ops_upcoming_work(company)` (section 5). Everything on the page is derived from those two answers in MO; nothing else is read.

**Rules that hold for the whole page** (OV header comment; MO header):

* **Every figure is the length of the list it opens**, built from the same read, so a figure and its list cannot disagree (tests `operations-pages.test.tsx` "leads with four figures...", `model.test.ts` "the week chart and its list are the same records").
* **Nothing is scored.** There is no percentage of health, no capacity figure and no measure of a Project Manager's performance. The Project health panel says so on the screen.
* **Colour never carries a meaning alone.** Every mark has its own icon and its word beside it (VS header comment).
* **A part whose read failed says so** and is never drawn as zero, empty or "On track" (below).

**Failed reads.** If the Overview read does not succeed the page shows the heading, the company chooser and one message, and **no figure, panel or label at all**: not installed, "You are no longer an Operations Manager of this company, so the Operations Overview is not shown. ...", or the could-not-load block with a retry link (OP, PT `ReadState`; test "a refused read, a failed read and an empty company each say what happened; a failed read is never a figure or a label"). If only the Upcoming Work read fails: the fourth summary card shows "—" with "Could not be loaded" (never 0), the timeline says "Enquiry dates could not be loaded, so only project dates are shown.", and **Coming up from Sales** carries the read's own message (OV). When that read is refused or not installed the card shows "—" with "Not shown" and the timeline says "Enquiry dates are not shown." An empty result is a different sentence in each panel (below); none of the failures is shown as empty.

Order on the page (OV): the four summary cards; then **Needs my decision** and **Next installations** beside the **Delivery timeline**; then **Upcoming delivery by week** beside **Equipment issues**; then **Project health**; then **Coming up from Sales** beside **Team pressure**; then the footer.

### 4.1 Summary cards ("Operations at a glance")

Four cards, each a link. Two columns on a phone, four from the `xl` width.

| Card | Figure | Opens |
|---|---|---|
| **Needs my decision** | The number of items in the decision queue (`decisions`, section 4.2). Amber edge when above zero | The same page at `#decisions` |
| **Installations in the next 14 days** | The number of rows in Next installations (`installationsWithin`, section 4.4) | `#installations` |
| **Equipment issues** | The number of rows in Equipment issues (`equipmentIssues`, section 4.6). Amber edge when above zero | `#equipment` |
| **Upcoming Sales work** | The number of flagged enquiries the Upcoming Work read returned. "—" and "Could not be loaded" when that read failed; "—" and "Not shown" when it was refused or is not installed | `/operations/upcoming?company=<id>` |

### 4.2 Needs my decision (N)

Panel `#decisions`. Description: "Who it is with, since when, why, and one place to act." Each item: a badge with the kind (red outline for "Project Manager not assigned" and "Installation at risk", amber for the others), the title, one sentence of detail (the reason), "With <owner> · since <date>" (the date is left out when none is recorded), and one button. Empty: "Nothing recorded needs a decision right now: every submitted handover has a Project Manager, no listed blocker is waiting, and no installation in the next 14 days has a recorded problem."

Derivation (`decisions` in MO; thresholds `STALLED_DAYS = 3`, `BLOCKER_DAYS = 2`, `AT_RISK_WINDOW_DAYS = 14`). Unchanged by the redesign:

| Badge (kind) | Listed when | Detail sentence | "With" | Button and where it goes |
|---|---|---|---|---|
| **Project Manager not assigned** (`pm_unassigned`) | A handover of the company has status `submitted` | "Handover submitted <date>. No Project Manager is assigned." | Operations | **Assign a Project Manager** -> `/projects/handovers?handover=<id>` |
| **Handover stalled** (`handover_stalled`) | A handover is `pm_assigned` or `clarification_requested` and has waited **3 days or more** since it was assigned (or since the question was sent), or that date is not recorded | "Waiting N days for <PM> to accept." or "A question went back to Sales N days ago and the handover has not been resubmitted." | The named Project Manager, or Sales | **Open the handover (you can reassign)** or **Open the handover** -> the same address |
| **Blocker not resolved** (`blocker`) | A task of a listed project is blocked (open statuses only) and **either** the person named to unblock it is not the assignee (`cross_team`) **or** it has been blocked **2 days or more**. The read returns at most the 5 oldest blockers per project (and `blockers_total`, the count of all of them, used for the risk reasons) | ""<task>" is blocked since <date>: <reason>. Waiting on <name>." or "Nobody is named to unblock it." | The unblock owner, else the Project Manager | **Open the task** -> `/projects/<id>/work?task=<task>` |
| **Installation at risk** (`at_risk_installation`) | A live project that is inside the window **from 14 days before its installation start (or, with none, event start) until its event end**, and at least one recorded reason exists (below). A project with no recorded event end leaves the window the day after its start | "Installation starts <date>: <reasons>." ("started" once the date has passed; "The event starts" when no installation date) | The Project Manager | **Open the project** -> `/projects/<id>/work` |
| **Review equipment booking** (`equipment_review`) | The project has at least one open equipment review (section 9.2) | "A committed date changed while equipment is booked. N bookings to review. The booking itself has not been changed." | The Project Manager | **Review equipment booking** -> `/projects/<id>/equipment` |
| **Unused reservations not released** (`release_failed`) | A finished project whose release of unused reservations failed at completion and something is still left to release (section 9.4) | "Releasing unused reservations failed when the project finished. The warehouse releases them on the request." | Warehouse | **Open the Equipment tab** -> `/projects/<id>/equipment` |

Reasons that make an installation "at risk" (`riskReasons`, each from a record, joined with semicolons): equipment short on a named request (any short line); an equipment request not yet sent to the warehouse (a draft); N blocked tasks; N overdue tasks; N overdue milestones; N Delivery plan lines not released to the teams. A project with none of these is not listed, however close its date. A project with no recorded installation or event date is never "at risk". The count of blocked tasks is the total, not the five listed.

Order: by kind in the order of the table, then by date (undated last), then by title.

**A booking review here is oversight.** It names the Project Manager as its owner; the action itself is the Project Manager's and sits in the Project Manager's own list on My Day (section 14).

### 4.3 Delivery timeline, next 30 days

Description: "Installation, show and dismantling dates in date order. Enquiries without a project yet are marked tentative until Sales confirms the dates or wins the enquiry." (`timeline` in MO; `TIMELINE_DAYS = 30`.)

| Point | Rule |
|---|---|
| What is listed | For each live project (not completed or archived): its installation start, and its show (event start, "until <event end>" when the end differs). For each flagged enquiry **that has no project yet**: its installation start, its show and its dismantling date. An enquiry whose handover already carries a project is left out, so nothing is listed twice |
| The window | A single date is listed when it falls from today to 30 days ahead. A show is listed when it starts within 30 days and has not ended, so a show already under way is listed with its start date |
| The three kinds | **Installation** (hammer icon), **Show** (presentation icon), **Dismantling** (open box icon), each with its own tint and its word (VS `KindMark`) |
| **Tentative** | A dashed "Tentative" mark on every date of an enquiry whose dates Sales has not confirmed and that is **not won**. It is the same rule as the Upcoming Work card (`tentative = r.dates_tentative && !r.won` in `timeline`): an enquiry whose dates Sales has confirmed, or that is won, is not marked. A project's dates are never marked |
| Who | A project: the Project Manager. An enquiry: the handover's Project Manager, else "<name> (provisional)", else the Sales owner |
| Links | A project line opens `/projects/<id>/work`; an enquiry line opens Upcoming Work searched for that reference (`/operations/upcoming?company=<id>&q=<reference>`) |
| Order | By date, then installation, show, dismantling, then title. The date is printed once per day |
| Dismantling | **A project has no dismantling date**, so dismantling appears only for flagged enquiries. The panel says so: "A project has no dismantling date of its own, so dismantling appears only where Sales recorded it on an enquiry." |
| Empty | "No installation, show or dismantling date is recorded in the next 30 days." |
| Upcoming Work read failed | "Enquiry dates could not be loaded, so only project dates are shown." above the project dates |

### 4.4 Next installations (N)

Panel `#installations`. Description: "Starting within 14 days, with the Project Manager, the label and how much equipment is ready." (`installationsWithin` in MO.)

Listed: live projects whose installation start (or show start, when no installation date is recorded) is **today or within 14 days**, soonest first, then by reference. Today counts; day 15 does not; a finished project and a project with neither date never appear (test "installations in the next 14 days").

Each row: reference and name (link to `/projects/<id>/work`); the **health label** (section 4.7); the Project Manager ("No Project Manager" when none) and the venue; when the label is not On track, the first piece of evidence as a link, with "N more below" when there is more; the kind mark (Installation or Show), the date and "today", "tomorrow" or "in N days"; and the readiness bar.

**Readiness bar** (`readiness` in MO; VS `ReadinessBar`): "R of T equipment lines ready" with a small bar, green when all are ready, amber otherwise. **It is drawn only with a real denominator**: T is the number of lines on the project's requests whose state is Reserved, Partly ready or Short (with the warehouse, nothing dispatched yet), and R is the reserved lines of those requests. A draft, a dispatched or a returned request is not counted. When T is zero no bar is drawn and the row says "No equipment request recorded" (no request at all) or "No equipment lines waiting to be reserved" (test "readiness has a real denominator or is not drawn").

Empty: "No live project has a recorded installation or show start in the next 14 days."

### 4.5 Upcoming delivery by week

Description: "Live projects by the week their installation (or show) starts. The number is the count of the projects listed under it." A horizontal bar chart that is also a list (`deliveryByWeek` in MO; `CHART_WEEKS = 6`; VS `CountBar`).

| Bucket | Holds |
|---|---|
| **Already started** | Live projects whose start is before this week's Monday. Shown only when it has a project |
| **This week**, **Next week**, then four more weeks (each named by its Monday, with the range under it) | Live projects whose installation start (else show start) falls in that week. Weeks run Monday to Sunday. These six rows are always shown, with 0 when empty |
| **Later** | Start after the sixth week. Shown only when it has a project |
| **No date recorded** | Neither date recorded. Shown only when it has a project |

Each row prints the count, a bar whose length repeats it, and under it the first four projects (reference and name as a link to the project's Work page, the date, the Project Manager or "no Project Manager"); "and N more, listed under Project health below" when there are more. **Every live project is in exactly one bucket**, so the counts add up to the live projects of the company. Finished projects are not in the chart. Empty: "No live project in this company."

### 4.6 Equipment issues (N)

Panel `#equipment`. Description: "Recorded by the warehouse or raised by a date change. Operations reads them; the owner named on each line acts." (`equipmentIssues` in MO.) Each line: a badge, the project (link to `/projects/<id>/equipment`), one sentence and "With <owner>".

| Badge (kind) | Listed when | Text | Owner |
|---|---|---|---|
| **Shortage** (`shortage`) | A request has at least one short line | The equipment line of that request (below) | Warehouse |
| **Reservations not released** (`release_failed`) | The failed release of section 9.4 is pending | "Unused reservations were not released at completion" | Warehouse |
| **Return overdue** (`overdue_return`) | Units are out and the expected return has passed | "N units from <code> due back <date>" | Warehouse |
| **Booking to review** (`booking_review`) | The project has an open equipment review (section 9.2) | "N bookings to review after a committed date changed" | The Project Manager |
| **Request not sent** (`not_sent`) | A request is still a draft **and the project is in Next installations** (starts within 14 days). A draft far ahead of its dates is not listed | "<code> has not been sent to the warehouse" | The Project Manager |
| **Complete, still out** (`still_out`) | A finished project with units out and no overdue return on any of its requests (an overdue one is listed as Return overdue instead) | "Delivery complete, N units still out" | Warehouse |

Order: by kind in the order of the table, then by project. Red outline for the first three kinds, amber for the others. Empty: "No shortage, overdue return, booking to review or unreleased reservation is recorded."

**Equipment line** (`equipmentLine`, used for a shortage): "<code>: <state>." then " R of L lines reserved." only while the state is Reserved, Partly ready or Short (a draft with lines reads " N lines on the draft, nothing reserved yet."; once stock is out the count is not said), then, when lines are short, " N lines short (a to buy, b to rent, c with no plan yet)." and, when units are out, " N units out, due back <date>" or ", no return date recorded", with " (overdue)" when the expected return has passed. State words: Not sent to the warehouse yet, Cancelled, No lines, Reserved, Partly ready, Short, Partly dispatched, Dispatched, Still out, Returned (`STATE_WORDS`). A line to buy or rent is short, never reserved (section 9.1).

### 4.7 Project health

Panel `#health`. Description: "A label read from records, with the evidence behind it. It is not a score and says nothing about a person's performance."

**Which projects** (OV `live`; `healthCounts` in MO): every project that is not completed or archived, plus a finished one while it has units out or a failed release still pending. (The read also returns a finished project with only an open equipment review; it is not given a card here and stays visible under Needs my decision and Equipment issues.) Sorted At risk first, then Needs attention, Not enough information, On track; then by date; then by reference. Above the cards, one count per label; the four counts add up to the cards shown.

**The rules** (`projectHealth` in MO, read at `16d6f42`; tests `model.test.ts` "on track needs recorded dates...", "no recorded date is 'not enough information'...", "needs attention...", "at risk..."). The first label that applies, in this order:

| Label | Applies when at least one of these is recorded | Evidence shown (each a link) |
|---|---|---|
| **At risk** (triangle icon, red) | (a) The project is inside the window of section 4.2 (from 14 days before its installation start, or show start when there is none, until its event end; a project with no event end leaves the day after its start) **and** `riskReasons` returns at least one reason: equipment short on a request, an equipment request not sent to the warehouse, blocked tasks, overdue tasks, overdue milestones, Delivery plan lines not released to the teams. (b) Unused reservations were not released at completion (`release_failed`). (c) A request has units out past its recorded return date (`return_overdue`) | (a) One line per reason, "Installation starts <date>: <reason>" ("started" once the date has passed; "The show" when no installation date), opening the Equipment tab for an equipment reason, the Delivery plan for an unreleased line, otherwise the Work page. (b) "Unused reservations were not released at completion", Equipment tab. (c) "Equipment from <code> was due back <date> and is not returned", Equipment tab |
| **Needs attention** (circle with exclamation mark, amber) | None of the above, and: no Project Manager is recorded on a project that is not finished; a blocked task (each of the listed five, and "N more blocked tasks" when there are more); a request with a short line; overdue tasks; overdue milestones; an open equipment booking review; a finished project with units still out | "No Project Manager is recorded" (People tab); "Blocked since <date>: <task> (waiting on <name>)" or "(nobody is named to unblock it)" (the task); "Equipment short on <code>: N lines" (Equipment); "N overdue tasks", "N overdue milestones" (Work); "N equipment bookings to review after a date change (with <Project Manager>)" (Equipment); "Delivery complete, N units still out" (Equipment) |
| **Not enough information** (question mark icon, grey) | None of the above, and **neither an installation date nor a show date is recorded**. There is nothing to measure "on track" against | "Neither an installation date nor a show date is recorded" (Work) |
| **On track** (tick icon, green) | A date is recorded and none of the above is recorded | "Dates are recorded; no blocker, shortage, overdue task, overdue milestone or booking review is recorded" (Work) |

Exact points of the rule, as coded:

* **A blocker, shortage, overdue task or overdue milestone makes a project At risk only inside the window; outside it the same fact makes it Needs attention.** Inside the window they are already At risk reasons, so they are not listed a second time as Needs attention evidence. The one addition inside the window is "Nobody is named to unblock "<task>"" for each listed blocker without a named person.
* **An unsent equipment request and unreleased Delivery plan lines count only inside the window.** Outside it they affect no label.
* An At risk project shows its At risk evidence first, then any Needs attention evidence (no Project Manager, a booking to review, complete but still out).
* A missing Project Manager is not said of a finished project.
* A project with no recorded date can still be Needs attention or At risk (b or c); it is Not enough information only when nothing else is recorded.
* **A read that failed has no label at all** (MO comment; the page shows the failure, section 4 "Failed reads").

**Each card**: reference and name (link to the Work page); the label; the Project Manager ("No Project Manager"), "Installation <date>" or "Show <dates>" or "No date recorded", and " · Delivery complete" on a finished project; up to **three** pieces of evidence as links, then "and N more on the project"; the readiness bar (section 4.4) or, without a denominator, "No equipment request recorded" or "N open tasks"; and **Project chat** when the project's Chat group exists **and the viewer can open it** (the read returns `chat_group_id` only to a holder of the `operations` capability itself or a member of the project; a founder with neither is not offered the link). The link is the same page with `?chat=<group id>`; the Chat panel opens it only if the server lists that group for the person (section 10).

**How the label is decided**: a closed disclosure under the cards with the four rules in one sentence each, in the words of the table above (OV).

Empty: "No live project in this company."

### 4.8 Coming up from Sales

Description: "Enquiries Sales flagged for planning. No prices or commercial documents are shown." Button **Open Upcoming Work** (to `/operations/upcoming?company=<id>`). The first **5** flagged enquiries in the read's order (expected decision date first, undated last; then installation or event start; then reference). Each: the event as the heading (the edition label, else the event name, else the enquiry's title; `eventLine`), a link to Upcoming Work searched for that reference; the reference; the installation or show start ("No date recorded" when neither); "Tentative", "Won" or "Dates confirmed"; the venue when one is recorded; and "Next: <who> (<person>): <what>" (`nextUnresolved`, section 6.3). Below it "N more in Upcoming Work." when there are more than 5. Empty: "No enquiry is flagged for Operations planning." A failed or refused read shows its own message here (section 4 "Failed reads").

### 4.9 Team pressure (N)

Description: "People on two projects whose dates overlap, and reviews past the task's date. Only what is recorded; it is not a capacity figure." Empty: "Nothing recorded. An overlap shows only when both projects have their dates and people recorded."

Two kinds of line, each a link (`pressure` in MO, filtered in OV to `overlap` and `reviews_overdue`):

| Line | Exists when | Text | Goes to |
|---|---|---|---|
| Overlap | The same person is an active member of two live projects of the company whose recorded windows overlap. A window is installation start (else event start) to event end; **both projects need a start and an event end**, and both must end today or later. The read returns at most 60 pairs | "<Person> is on <A> and <B>, whose delivery dates overlap <from> to <to>." | `/projects/<A>/people` |
| Overdue reviews | A project has tasks in Ready for review whose due date has passed | "<Ref>: N reviews past the task's due date." | `/projects/<id>/work` |

There is no threshold in this panel: every recorded case is listed. Shortages and overdue returns moved to Equipment issues (section 4.6). **Partial dispatch is no longer listed on the Overview**: `pressure` still returns it, the page does not draw it; a partly dispatched request shows on the project's Equipment tab (section 9.1).

Footer of the page: "Read <date>. Operations reads these records; it does not change tasks, bookings or stock. Each link opens the screen where the responsible person acts."

### 4.10 Phone and layout

On a phone everything is one column in this order: the summary cards (two across), **Needs my decision first**, then **Next installations** with their readiness, then the timeline, the week chart, Equipment issues, Project health, Coming up from Sales and Team pressure (OV: `order-1`, `order-2`, `order-3`). From the `xl` width the decision queue and Next installations sit in the left column and the timeline in the right. Labels always stand beside the colour. `docs/projects-phase2b-screenshots/` holds eight pictures taken on 2026-11-12 from a temporary, uncommitted page with fictional data, not signed in: `operations-overview`, `operations-upcoming`, `my-day-operations-manager` and `my-day-project-manager`, each as `-desktop-harness.png` and `-phone-harness.png` (commit `16d6f42`; the four older Operations pictures with the same names were replaced). Nothing was seen signed in or on a real phone: `Unverified`.

### 4.11 In the code, no longer on the screen

`topIssue` ("Most relevant issue"), `upcomingDelivery` and the shortage, partial dispatch and overdue return lines of `pressure` are still in MO and still tested in `model.test.ts`, but the Overview does not call or draw them after `265c516` (checked by searching `apps/web/src` for their names at `16d6f42`). The project card with Status, Venue, Dismantling "Not recorded on the project", Next milestone and Tasks is gone with them.

## 5. The two reads

Both are `security definer` functions callable by signed-in users only (M grants; verify pack rows 5 and 6). Both check the caller in the database on every call.

### 5.1 `ops_overview(company)` (M section 7)

Refuses with "Operations is open to the Operations Managers of this company" unless the caller holds `operations` (or `founder`) for that company (`ops_require`). Returns one object:

| Key | Rows | Selected fields (and only these) |
|---|---|---|
| `handovers` | Handovers of the company in `submitted`, `pm_assigned`, `clarification_requested`, oldest submitted first | id, Sales reference, title, status, submitted at, Project Manager id and name, assigned at, installation start, event start, event end, venue (location), event edition label, clarification requested at |
| `projects` | Every project of the company that is not completed or archived, plus finished ones with units out, an open equipment review, or a pending failed release | id, reference, name, kind, status, Project Manager id and name, Chat group id (only when the caller can open it), venue, installation start, event start, event end, edition label; counts: open tasks, overdue tasks, reviews waiting, reviews overdue, overdue milestones, open corrections, proposed plan changes, unreleased plan lines, open equipment reviews; `blockers_total`; up to 5 blockers (task id, title, since, reason cut to 200 characters, assignee, unblock owner, cross-team flag); the next open milestone; one state object per equipment request that is not cancelled (`inv_request_state`, section 9.1); `release_failed` |
| `overlaps` | Section 4.9, at most 60 | person id and name, the two projects' ids and references, from, to |
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

Redesigned on 2026-11-12 (commit `265c516`) to be scanned: a heading, four facts, and the rest under one disclosure. The row is the allowlisted read of section 5.2, unchanged: there is no price, quote, commercial document or Sales note in it to show (UC header comment; test "is scannable: event and venue, dates, expected decision, provisional PM and the next unresolved item; the rest is one tap away").

**Heading.** The **event** (the edition label, else the event name, else the enquiry's own title; `eventLine` in MO). Under it the **venue** (the edition's venue and city, else the enquiry's location; "Venue not recorded"), the reference, and the enquiry's title when the heading is not already that title.

**Badges.** The stage (`STAGE_WORDS`); the dates badge: **Tentative dates** (amber, dashed) while Sales has the tick on and the enquiry is not won, **Confirmed (won)** (green) once won, **Dates confirmed, not won** (green) once Sales has unticked it (`datesWord`); a red **Capacity conflict** when Operations flagged one; **Risk: Low / Medium / High** when Operations assessed one.

Buttons:

| Button | Shown when | Goes to / does |
|---|---|---|
| **Assign a Project Manager** (filled) | The enquiry has a handover in `submitted` | `/projects/handovers?handover=<id>`, where the existing **Assign Project Manager** form is (section 8, step 6) |
| **Open the handover** (outline) | The handover is in any other status except draft | The same address |
| **Plan** | Always | Opens the dialog in section 6.4 |

**The four facts** (always visible):

| Fact | Shows |
|---|---|
| **Dates** (label "Dates (tentative)" while tentative) | Three lines, each with its kind mark: **Installation** (date), **Show** (date range), **Dismantling** (date). "Not recorded" for an empty one |
| **Expected decision** | The date Sales gave, or "Not recorded" |
| **Provisional Project Manager** | The name with "Provisional: nothing is booked", or "Nobody yet". The label becomes **Project Manager** and shows the real one once the handover names one |
| **Next unresolved item** | What is next and "With <Sales, Operations or Project Manager> (<person>)" (section 6.3). While Operations' question has no answer: "Your question to Sales is not answered yet" |

**More** (closed until pressed; summary "More: teams, equipment, what Sales still has to confirm, risk and questions"): **Sales owner**; **Event edition** (label, or "Not linked to an event"); **Expected teams** (Engineering, Content, Programming, Installation, Warehouse); **Expected equipment** ("<name> x <qty>"); **Sales still to confirm** ("Nothing listed"); **Note for Operations** ("None"); **Handover** (the status in words: "Being prepared by Sales", "Waiting for a Project Manager", "Waiting for the Project Manager to accept", "Question sent back to Sales", with the Project Manager's name; "Not prepared yet" when won with no handover; "Starts when the enquiry is won" otherwise); **Operational risk** (Not assessed, Low, Medium, High, with its note); **Capacity** ("Conflict: <note>" or "No conflict flagged"); and, when Operations asked something, **Question for Sales** with "Sales answered <date>: <answer>" or "Not answered yet". Anything empty reads "Not recorded".

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
| 8 | (automatic) | The enquiry leaves Upcoming Work; the project is on the Overview (timeline, week chart, Project health, and Next installations once it is within 14 days) | Nothing | | M `ops_upcoming_work`, `ops_overview`; T test 4 |
| 9 | Project Manager | Changes a committed date while a request is with the warehouse | A review row per request and date (section 9.2) | The Project Manager, unless they made the change themselves. A date changed back to the original closes the review by itself | M section 6; T test 7 |
| 10 | Project Manager | Completes the project while equipment is out | As before; the project stays on the Overview (Project health card marked "Delivery complete", evidence "Delivery complete, N units still out"; Equipment issues "Complete, still out") until the warehouse records the return | | M section 7; T test 9 |

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
| Operations | A flagged enquiry is headed by its edition label in Upcoming Work and under Coming up from Sales, with **Event edition** under More (read live from the enquiry, not a copy). Since the redesign of 2026-11-12 the Overview no longer prints a project's edition label (the read still returns it) | Operations Managers | OV, UC |
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
* **Operations Overview**: the readiness bar on Next installations and Project health (section 4.4) and the Equipment issues panel (section 4.6).

**Inventory Today** (IT): the readiness sentence of a request no longer counts a line to buy or rent as fully reserved. The fact now reads "F of L lines fully reserved · R still to reserve · B to buy or rent", the three counts always add up to the open lines, the fact about lines that can go reads "N line has reserved stock to send" / "N lines have reserved stock to send" (not "ready to send", because a partly reserved line is counted there and among the short ones), the title says "ready to send in part" (never plain "ready to send") while any line is still to reserve or to buy or rent, and a separate fact "N lines to buy or rent" is added (test `today.test.ts`).

### 9.2 Review equipment booking

**When a review is recorded** (trigger `trg_proj_details_dates_changed`): the project's installation start, event start or event end changes while the project has a request in `submitted`, `in_progress` or `fulfilled`. One row per request and date in `proj_equipment_reviews`: the old date, the new date, who changed it and when. A second change of the same date before the review is resolved keeps the first "old" date and updates the new one. **A date changed back to the date the booking was made for closes the review by itself** (the open row is deleted; no notice). **It changes no reservation and no request date** (T test 7 compares the reservations before and after). The Project Manager is sent **Review equipment booking: <request code>** (once per request while unread; not when the Project Manager made the change, because `proj_notify` never tells the caller).

**Where it shows:**

* **Equipment tab**, panel **Review equipment booking** ("A project date changed after the equipment was requested."): the sentence "The booking has not been changed. The warehouse changes it on the request, where conflicts are checked."; per review the request code, which date (Installation start, Event start, Event end), "was <old> · now <new>" ("not set" for an empty date), "Changed by <name> on <time>", the link **Open request <code> to change its dates** (`/inventory/requests/<id>`), and the form below. Shown on a finished project too.
* **Work page**, What needs doing: one line per request, label **Review equipment booking**, "Request <code>", the dates and "The booking has not been changed.", linking to the Equipment tab; under "needs you" for whoever manages the project, otherwise under waiting on the Project Manager (WA).
* **Inventory request page** (`/inventory/requests/<id>`), for a project request: the same panel, filtered to that request, so the warehouse sees it where the booking is changed. **Mark as reviewed** is offered to someone who operates a warehouse location or manages the request. If the read fails: "Whether a project date changed for this request could not be loaded. Reload to check before changing the booking." (`apps/web/src/app/(app)/inventory/requests/[id]/page.tsx`).
* **Operations Overview**: Needs my decision (section 4.2), Equipment issues as "Booking to review" (4.6) and as Needs attention evidence on the project's health card (4.7), each naming the Project Manager as owner.
* **My Day**: an item in the Project Manager's own list, one per project (section 14.2).

**Mark as reviewed** (EQ `EquipmentReviewForm`; `resolveEquipmentReview` -> `proj_resolve_equipment_review`): optional **Note (optional)** up to 500 characters (placeholder "What was decided, for example: the warehouse moved the booking").

* **Who:** whoever manages the project (Project Manager, temporary leader, founder) or the warehouse of its company; the function decides. The page offers the form on the same rule; anyone else reads "The Project Manager or the warehouse marks this as reviewed." **An Operations Manager cannot mark it** (not a manager, not warehouse).
* **What it changes:** the review row only (resolved at, by, note). **It records that someone looked. It moves no booking:** changing the booking stays the warehouse's work on the request, with its own conflict checks.
* **After:** the review leaves the panel, the Work page and the Overview. A second press does nothing.
* **Refused:** "This review was not found, or you are not allowed to mark it. The Project Manager or the warehouse can."

### 9.3 A finished project with equipment still out

Completing a project never returns equipment (unchanged). New in this phase:

* **Equipment tab and Work page:** the notice **Delivery complete · equipment still out**, listing per request "N units out · expected back <time>" or "no expected return recorded", with " · overdue" when it is; "Completing a project does not return equipment: it stays outstanding until the warehouse records its return." (EQ `StillOutNotice`, `stillOutAfterDelivery`). On the Work page the request codes are plain text with a link **Open Equipment**.
* **Operations Overview:** the project keeps a Project health card (marked "Delivery complete", label Needs attention with "Delivery complete, N units still out", or At risk once a return is overdue) and a line under Equipment issues until everything is back (section 4.6, 4.7; the read keeps returning it, T test 9).
* **The finished-project sentence on the Equipment tab** now says "unused reservations were released when it finished" **only when the readiness read succeeded and reports no failed release**; otherwise it says only that the list is read-only.

### 9.4 When releasing unused reservations failed at completion

The existing completion trigger logs a failed release and lets the project complete. New: the failure is **reported while something is still left to release** (`inv_project_release_pending`: a request still in draft or submitted, or an active reservation with stock not dispatched) and the latest failed log line exists. Then:

* **Equipment tab:** a red notice "Releasing unused reservations failed when the project finished." / "It failed on <time>. <detail>" / "Ask the warehouse to release the unused lines on the request." with **Open request <code>** links (EQ `ReleaseFailedNotice`).
* **Operations Overview:** "Unused reservations not released" in Needs my decision, owner "Warehouse"; "Reservations not released" under Equipment issues; and the project is labelled At risk (section 4.7).

**There is no automatic recovery and no retry button.** Nothing re-runs the release for a project; the warehouse releases or cancels the lines by hand on each request, and the notice clears by itself once nothing is left (EQ page comment; M comment on `proj_equipment_readiness`; T test 9).

## 10. Chat

Reference for Chat as a whole: [`app-chat.md`](./app-chat.md) (section 10 covers this phase).

* **Operations path** (`chat_is_ops`): a person who holds the `operations` capability **itself** for the project's company is a member of that project's Chat group: listed in `chat_my_groups`, may read, post and mark read, and `chat_project_group` returns the group. The founder shortcut is **not** this permission: a founder who is not on the project still has no path (T test 6).
* **Groups appear before anyone has posted:** `chat_my_groups` creates the missing group of each live project (not completed or archived) of an Operations Manager's companies.
* **Tag and note:** a group the person reads through Operations and not as a team member shows a small tag **Operations** in the list and, at the top of the thread, "You are reading this as Operations Manager. You are not on this project's team." (`via_operations`; CH).
* **Archived (N):** the groups of **completed and archived** projects are listed under a collapsed heading "Archived (N)" after Sales and Projects (changed on 2026-11-12, commit `93ec0f2`: before it only archived projects were there and a completed project's group stayed under Projects). Both are read-only, by the unchanged server rule. Pressing the heading opens and closes the section; a search opens it; while closed, the heading carries the section's unread count and a mention marker, so nothing is dropped from the totals. A direct link still opens such a group. A reopened or restored project's group is back under Projects on the next refresh. Where the chat is listed changes nothing on the project: its lifecycle and its equipment-return tracking are as before. On a database that does not send the project's status, the server's read-only flag (set for exactly these two statuses) decides (CH `isArchivedGroup`, `groupSections`, `archivedHeading`; `project_status` from the read; T test 10; `lib/chat/model.test.ts`, `chat-launcher.test.tsx`).
* **Mentions:** `chat_group_members` for a project group now lists the people on the project and, marked "(Operations)" after their name, the company's Operations Managers who are not on the project. They can be chosen in the @ picker and mentioned. The membership line under a project group's name reads "The people on this project, and the company's Operations Managers" (`lib/chat/model.ts`).
* **"Project chat"** on a Project health card of the Overview is offered only when the viewer can open the group (section 4.7) and opens `?chat=<group>`. A link to a group the person cannot open says "That conversation is not available to you. A project's chat is open to the people on that project and to the company's Operations Managers." (CH).
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
2. **A project has no dismantling date.** Sales records one on the enquiry for planning (shown in Upcoming Work); it is not carried into the handover or the project, so the Overview timeline shows dismantling only for flagged enquiries and says why (section 4.3). (An equipment request has its own "Dismantling finished" planning date in Inventory; Operations does not read it.)
3. **Sales has no notice list.** Sales sees what Operations recorded on the enquiry (From Operations) and in its history; no notice is sent, and the Plan dialog says so. (Sales Follow-ups reads one kind of notice, the person's own "handover accepted", only to offer Dismiss: [`sales-followups.md`](./sales-followups.md) section 2.1. It is not a list of notices.)
4. **The Chat list costs more for an Operations Manager with very many projects:** about 1.5 s at 3,000 groups in the reviewer's measurement (section 10).
5. **Overlaps need both projects' dates** (a start and an event end) and the people recorded on both; an unrecorded clash does not show.
6. **Participation open to an Operations Manager** (task comments, corrections, the project's conversation; not files or links) is intended (section 2.3) and is named in the description shown on People & Access (`packages/domain/src/permissions/proj.ts`, `accessProfiles.ts`).
7. **The warehouse gets no notice of a booking to review.** The notice goes to the Project Manager only; the warehouse sees the panel on the request page in Inventory and on the project's Equipment tab, not in a list of its own (Inventory Today does not show it).
8. **A question sent back by the Project Manager re-takes the edition on the next update of the handover** (section 8.1), including a reassignment made while it is in that state.
9. **JARVIS:** guidance only. No JARVIS action, read or capability was added (`jarvis-rulebook.md` section 7).
10. **Nothing was checked signed in by Claude; Claude ran no hosted migration; no browser flow exists for this phase** (`apps/web/os-shell-checks/README.md` lists none). The owner reported on 2026-11-12 that the signed-in Preview checks of PR #86 passed; that was before the redesign commits, which nobody has checked signed in.
11. **A Sales answer is shown to every Operations Manager of the company on My Day**, not only to the one who asked, because the read gives the asker's name and not their id (section 14.2).
12. **Health is only as good as the records.** A project with dates and nothing recorded against it reads On track; a problem nobody recorded does not show. The label is not a forecast.
13. **Partial dispatch is no longer listed on the Overview** (section 4.9).

## 13. Rollout and tests

Rollout guide: [`docs/projects-operations-deployment.md`](../../projects-operations-deployment.md). Install order: `docs/launch-refinement-install-order.md` row 30.

Tests in the repository (counts are the number of `it(...)` blocks in each file; whether they pass on this branch is for the person who ran them to state):

| File | Count | What it covers |
|---|---|---|
| `packages/rls-tests/test/ops-phase2b.rls.test.ts` | 12 (counted at `16d6f42`; 11 at `3e7e348`) | The capability and what it implies; flagging and the allowlist; planning writes nothing else; won, assign, accept, the edition copy; Overview access and revocation; Chat path; date-change review; readiness states; equipment out after completion and the failed release; Chat status and the closeout edition; removing the flag, the owner packs, rollback and re-apply; **added in `d9e8338`:** the Sales owner dismisses their own "handover accepted" notice (only their own row; nobody else can see or mark it; other people's notices and the handover unchanged; twice is harmless) |
| `apps/web/src/lib/operations/model.test.ts` | 19 (8 before `265c516`) | Dates word, next step, filters, equipment line, Needs my decision, at-risk window, complete-but-out, pressure; **added:** the four health labels and their evidence, the label counts, readiness with a real denominator, installations within 14 days, equipment issues with owners, the week chart (every live project in exactly one bucket), the timeline (three kinds, tentative until won, nothing listed twice), event and venue of a flagged enquiry |
| `apps/web/src/app/(app)/operations/operations-pages.test.tsx` | 9 (6 before `265c516`) | Four figures that open their records and the decision queue beside the timeline; installation, show and dismantling in words and "Tentative"; the week chart as a list and a readiness bar only with a denominator; labels from recorded facts with evidence links and no score; refused / failed / empty, a failed read never a figure or a label; company chooser; the scannable Upcoming Work card; won and submitted; the three empty and failure messages |
| `apps/web/src/lib/my-day/operations.test.ts`, `app/(app)/page.operations.test.tsx` | 8, 4 (new in `4086841`) | Section 14: the summary, failed companies never zero, company scope, the Sales answer item for seven days, a handover listed once, a failed read is an error, the booking review as the Project Manager's item; on the page: regular staff see nothing of Operations, the Operations Manager's card, the Project Manager's item, the failure wording |
| `apps/web/src/app/(app)/sales/opportunities/[id]/ops-planning-panel.test.tsx` | 18 | The Sales panel in each state |
| `apps/web/src/lib/actions/crmOps.test.ts` | 11 | The three Sales actions |
| `apps/web/src/lib/projects/equipment-readiness-model.test.ts`, `components/projects/equipment-readiness.test.tsx` | 12, 5 | Readiness words, review text, the notices |
| Changed existing files | | `nav-groups.test.ts`, `chat-launcher.test.tsx` (17) and `lib/chat/model.test.ts` (19), both changed again in `93ec0f2` for completed projects under Archived, `today.test.ts`, `work-attention.test.ts`, `directory.test.ts`, `details-card.test.tsx`, `handover-brief.test.tsx`, `notification-text.test.ts`, `closeout.test.ts`, `module-access-panel.test.tsx`, `peopleAccess.test.ts`; domain `projPermissions.test.ts`, `accessProfiles.test.ts`, `peopleAccess.test.ts` |

Not run by the author of this reference: the database suite and the web suite as a whole (the guidance build and the guidance and JARVIS tests were run after the guidance was republished; see the change log entries). Reported by the author of the code for the redesign commits (2026-11-12): lint and typecheck pass; web 286 files / 3,323 tests pass; `ops-phase2b.rls.test.ts` 12 tests pass; the full database suite: 76 files / 1,978 tests pass (run locally on `16d6f42`).

## 14. Operations on My Day

Added on 2026-11-12 (commit `4086841`; read at `16d6f42`). Sources: **MD** `apps/web/src/app/(app)/page.tsx`, `lib/my-day/operations.ts`, `lib/my-day/operations-day.ts`, `components/my-day/operations-summary.tsx`, `lib/my-day/attention.ts`; tests `lib/my-day/operations.test.ts` (8), `app/(app)/page.operations.test.tsx` (4). My Day as a whole: `../02-screens-and-navigation.md` section 4.

### 14.1 The Operations summary card

| Point | Rule | Source |
|---|---|---|
| Who sees it | Only a person with Operations access: Operations Manager of at least one company, or a Projects founder (the same test as the Operations menu and screens, `getOperationsContext`). Everyone else: nothing is read and no card is drawn | MD `loadOperationsDay`; test "regular staff see no Operations summary and no Operations items" |
| Where | Above the main grid of My Day, under the "Today at a glance" figures. Title **Operations**, link **Open Operations** | MD `page.tsx` |
| What it reads | The same two reads as the Operations pages, `ops_overview` and `ops_upcoming_work`, once per company the person has Operations access to. Each read checks the caller for that company in the database (section 5), so the counts and links can only come from those companies, and a company the person has lost drops out. **There is no second copy of the data and no new read.** No commercial field exists in those reads | MD `operations-day.ts` header; test "only the companies it was given are counted or linked" |
| **Waiting for a decision** | The number of items in Needs my decision (`decisions`, section 4.2), added up over the companies that loaded, with "recorded situation(s)". It opens Operations at `#decisions` (the company when only one loaded, else the company of the most urgent item). Under it: "Across Operations, each with its owner. Yours are in the list below." | MD `opsDaySummary` |
| **Next installations** | The first **three** of Next installations (`installationsWithin`, section 4.4) across those companies, soonest first: reference and name (link to the project's Work page), the kind mark, the date, "today / tomorrow / in N days", the Project Manager and the health label (section 4.7). "and N more in Operations" when there are more. Empty: "None recorded in the next 14 days." | MD; `OPS_DAY_INSTALLATIONS = 3` |
| **Most urgent issue** | The first item of the decision queue across the companies (by kind in the order of section 4.2, then by date): its badge, title, detail, "With <owner>", as one link to the screen where that owner acts. Empty: "Nothing recorded needs a decision." | MD |
| Several companies | Each title carries " · <company>" | MD `tag` |
| **A company whose read failed** | It is named: "Operations for <company> could not be loaded, so it is not counted below. Reload in a moment." Its figures are left out, **never counted as zero** | MD; test "a company whose read failed is named and never counted as zero; when none loaded there is no figure at all" |
| **No company loaded** | The figure is "—" with "could not be loaded", and the other two parts say "Could not be loaded." | MD (`decisions: null`) |
| **The access lookup or the whole read failed** | The card says "Operations could not be loaded right now. Reload in a moment." and the attention list names Operations as not loaded | MD (`opsDay === "error"`); test "a failed Operations read says so on the card and in the attention list, and is never an empty summary" |
| Refused for every company, or this phase not installed | No card | MD `loadOperationsDay` (returns null) |

**It is oversight, not a to-do list.** The card shows what Operations watches, each item with its owner. What the person can act on themselves is in the attention list (below).

### 14.2 Two new sources in the attention list

The attention list is My Day's single list, titled **Needs me** on the screen (`buildAttention`; the code comments also call it "What needs my attention"). Two sources were added to `AttentionSource`, making twelve:

| Source (label on a failed read) | Item | Shown to | Key | Link |
|---|---|---|---|---|
| `operations` ("Operations") | "Sales answered the Operations question: decide the planning", titled with the enquiry and its reference. Listed when a flagged enquiry has a question, an answer and the time of the answer, has no project yet, and the answer is **at most 7 days old** (`OPS_ANSWER_DAYS`). Changing the question clears the answer (section 6.4), which also removes the item | **Every Operations Manager (or founder) of that company**, not only the person who asked: the read gives the asker's name, not their id, so the app cannot tell which manager asked (`question_by` in section 5.2; `Unverified` whether the owner wants it narrower) | `opp:<enquiry id>`, the same key as every other item about that enquiry, so it merges with them into one row | Upcoming Work searched for the reference |
| `project-equipment` ("Equipment bookings to review") | "Review equipment booking: a committed date changed" (or "Review N equipment bookings: committed dates changed"), **one item per project** | The **Project Manager** of a live project with an open review. Read directly: the person's own live projects (`proj_projects` where they are the Project Manager, not completed or archived), then the open rows of `proj_equipment_reviews` for those projects, both under row-level security | `equipment-review:<project id>` | The project's Equipment tab |

**Not added twice.**

* **A handover the viewer can assign is not added by Operations.** The existing Projects source already lists it once per handover for everyone who may assign (`projectDecisionCandidates`, key `opp:<opportunity id>`), and an Operations Manager is one of them (section 2.2). So it appears once. A Sales answer on the same enquiry merges into that row (test "a handover the viewer can assign is listed once...").
* **A booking review is the Project Manager's action and Operations' oversight.** It is an item in the Project Manager's list. For an Operations Manager it is counted in the summary card and shown on the Overview with the Project Manager named as owner; it is not an item in the Operations Manager's list unless they are also that project's Project Manager (tests "a booking review is shown as oversight with the Project Manager named as its owner", "the Project Manager sees the booking review as their own item, with no Operations summary").

**Failures.** A failed Upcoming Work read for any company makes the `operations` source "could not be loaded" in the headline and the list, never an empty one (`opsCandidatesFailed`). A failed read of the person's projects or reviews does the same for `project-equipment`. A database without the reviews table gives an empty list, not an error (`isNotInstalled`).

**Not verified:** nothing was seen signed in. The two screenshots `my-day-operations-manager-*` and `my-day-project-manager-*` are from a temporary page with fictional data.
