# Projects & Tasks Phase 2: deliverables, versioned reviews, site schedule, Work overview, sidebar fixes

**Status:** draft PR from `feat/projects-phase-2` into `main` (after #92 and #93 merged), kept in draft for signed-in QA. Three additive migrations: `supabase/migrations/20270106000100_proj_phase2_deliverables_site.sql` (apply after `20270105000100`) and the follow-up `supabase/migrations/20270107000100_proj_phase2_teams_crew_ops_review.sql` (section 13); **the owner reports both applied and verified on the hosted project, and neither is edited**; and `supabase/migrations/20270108000100_proj_phase2_crew_briefing.sql` (section 14.2; **not applied anywhere**). **Nothing here was run against a hosted project by Claude.** Everything below was checked on a local PostgreSQL 16 and a local production build with fictional data; hosted SQL and signed-in Preview checks are the owner's (see "What was checked where"). Owner-reported, not run by Claude: the hosted Phase 2 migration and its verify script passed, and the sidebar fix (section 7) passed signed-in QA.

Operations TV is **not** part of this release. It follows in Phase 3 and will read the records created here (task outputs and versions, site activities, crew, shipments, the work overview read).

## 1. What already existed, and what this reuses

| Area | Already there (reused unchanged) | Added by this release |
|---|---|---|
| Task review and completion | `proj_set_task_status` (review, done, rework), `proj_task_actor_role`, review queue, task panel and full page, task history | The same function now **refuses review or completion while a required output is missing or short of its quantity**. A task with no required output behaves exactly as before. |
| Files and links | `proj_files` (restricted = Project Manager only), upload (prepare, signed upload, finalize), `proj_add_link`, `getProjectFileUrl` (signs only after the row-level read) | Nothing new for files. A version only **references** a `proj_files` row, and the database refuses a reference to a file the submitter cannot open. A reference never grants access. |
| Site Timeline | `proj_plan_items` with `plan = 'site'`, `proj_save_plan_item`, List / Calendar / Timeline modes, committed dates in `proj_project_details`, site bookings | Activity fields on the same rows (kind, run label, location, owner, Tentative / Confirmed, time window, zone), new `proj_site_crew` and `proj_site_shipments`, a Site schedule panel on Project Plan. The old item list stays below it (`site-all-items`). |
| Inventory | `inv_request_state(request_id)` and the equipment request | A shipment can link to an equipment request. Its **reservation / dispatch / return state is read from Inventory** and labelled "from Inventory"; nothing is stored or edited here. |
| Feedback and approvals | `proj_feedback`, scope / date / booking approval paths | A feedback item can be linked to a task version and an activation. Publishing to the client is unchanged and explicit. |
| Work page | What needs doing, summary cards, tasks | Three overview areas on top (Next on site, Needs attention, Recent changes), each linking to the record behind it. |
| Sidebar | Shared rail from #93 | Tooltip and flyout moved to body-level layers (section 7). |

The existing `proj_deliverables` (a work package given to a team) is **not changed**. In this release a "deliverable" is a task's **expected output** and the versions submitted against it.

## 2. Who enters each fact, where it shows, who can change it

| Fact | Entered by (where) | Shown in | Who can change it |
|---|---|---|---|
| Expected output (name, optional quantity, required or not) | Project Manager or the head of the task's team: task panel, **Set expected output** (**Edit expected output** later) | Task panel beside the assignee's action; Deliverables view; overview | Same two people (database enforced) |
| Submitted version (file, project file, or https link; note; count) | Assignee, team head or Project Manager: task panel, **Submit output** (**Submit version 2**, and so on) | Task panel with version history; Deliverables view; History; overview | Nobody edits a version: a change is a new version |
| Review decision (approve or request changes) on one version | Team head or Project Manager (never the submitter or the assignee) | Same places; approval time shown separately from the attachment time | A later decision on the same version replaces it; other versions keep theirs |
| Link to feedback / version / activation | Project Manager: Feedback & changes | Deliverables view and task panel | Project Manager |
| Site activity (kind, run, date or time window, zone, location, owner, Tentative / Confirmed) | Project Manager: Project Plan → Site schedule (**Add activity**, **Quick add**) or Timeline → Site | Site schedule, Timeline, overview "Next on site" | Project Manager. A confirmed activity's date or time needs a reason. |
| Crew per activity (installation, standby, backup, dismantling) | Project Manager: **Assign crew** (**Crew** once set) on the activity | Site schedule; "Needs attention" when empty | Project Manager |
| Shipment (departure, expected arrival, return, each with its own zone; optional link to a setup and an equipment request) | Project Manager: **Add shipment** | Site schedule; flagged when it arrives after the setup it supports | Project Manager |
| Inventory state of the linked request | Inventory only | Read-only line "from Inventory" | Inventory's own screens |

Times show in the **project's site time zone**; when none is set the screen says so and shows UTC (explicit fallback). Each activity and each shipment leg can carry its own zone, and the zone is always printed beside the time.

## 3. Versioned reviews

* One row per submitted version (`proj_task_output_versions`): version number, attached time, submitter, review status, decision note, **approved time (separate)**. Version numbers are allocated under the task row lock, so two submits can never share a number.
* A decision applies to the **exact version**. If a newer version arrives while a reviewer has the dialog open, the database refuses with "Version N is no longer the current one: version M was submitted. Review that one" and nothing is approved. Version 1's "changes requested" stays on version 1 while version 2 starts at "awaiting review".
* Submitting the same link again creates a **new version** (a retry with the same client key does not). A link to a document that can change (a shared document, a cloud folder) is flagged "can change after approval"; the submitter can attach a snapshot file or a version-specific link.
* Approval records who approved and when; the task moves to Done only through the existing completion path, which now checks the required output.

## 4. Deliverables view and export

Project Plan → **Deliverables**: one row per task with an expected output, grouped by activation (deliverable, linked task, owner, current version, status, attachment time, approval time, Open / Download where permitted, compact version history). Filters: **Missing / Awaiting review / Changes requested / Approved**. **Export register (CSV)** is built from the same database read as the screen, under the requester's own session, so a restricted file shows as "restricted file" (no name, address or size) to everyone but the Project Manager, in the screen and in the file. A failed read says so; a partial file is never sent.

## 5. Site schedule

Several occurrences of mockup, setup, show and dismantling can exist at once, each with its own run label. Each row shows owner, location, date or time window, zone and Tentative / Confirmed. An incomplete plan saves: what is missing (date, time, crew) is listed on the row and in "Needs attention" with a direct link to fix it. A shipment that arrives after the setup it supports is flagged when both times are known (when the setup has only a date, arrival on a later day is flagged). Date changes follow the committed-date and booking rules already in place (the equipment review trigger is unchanged). The Project Plan "work schedule" (tasks) and the Site schedule (what happens at the venue) now carry labels and links to each other.

RAF scenario, as tested: setup 11 Nov; show 12 Nov then dismantling; a second setup before the 14 Nov show with its time still to confirm; show 14 to 15 Nov. The two runs are separate rows and never imply equipment stays installed between them. One overseas shipment arrives after its setup and is flagged.

## 6. Work overview

* **Next on site:** the next activity not yet done, with window, owner, location, state.
* **Needs attention:** missing required output, changes requested, review waiting, incomplete site plan, late shipment. Each line names who can act and links to the record. At most two lines per kind are shown (so many missing outputs cannot hide a late shipment) plus "And N more".
* **Recent changes:** the newest output, review and site records, in the project zone, linking to History.

## 7. Sidebar fixes (both collapsed-rail defects)

| Defect | Cause found | Fix |
|---|---|---|
| "My Day" label clipped | Label was drawn inside the rail whose `overflow` clipped it | Tooltip is a body-level layer anchored to the icon: full label on hover and keyboard focus, accessible name on the icon |
| Flyout behind the project header | The rail's stacking context sits below the sticky header and tabs, and the rail clips overflow | Flyout is a body-level layer above page content (below native dialogs), anchored to the icon, kept inside the viewport, scrolls when long, the pointer can move into it, arrows move, Escape closes and returns focus to the icon |

Unchanged: the saved collapsed preference (cookie, drawn collapsed on the first paint), the active route, role-filtered links, the phone drawer. Before and after screenshots are in `docs/projects-phase-2-screenshots/`.

## 8. Retry and concurrency

Idempotency keys: version submit (per task), activity and shipment saves (per project), crew set (same crew twice changes nothing). Quick add of runs is one transaction. Concurrent submits serialize on the task row lock; a stale decision is refused (section 3). A server refusal uses a plain error code: PostgREST retries SQLSTATE `40001` for a long time, which would hide the message.

## 9. Install order and rollback

1. `supabase/manual-sql/proj_phase2_deliverables_site_00_preflight_readonly.sql`: rows 1 to 5 `OK`, row 6 "not installed yet" (a second run says "already installed"), rows 7 and 8 are counts for information.
2. Apply `supabase/migrations/20270106000100_proj_phase2_deliverables_site.sql` (after row 33 of `docs/launch-refinement-install-order.md`).
3. `supabase/manual-sql/proj_phase2_deliverables_site_20_verify_readonly.sql`: rows 1 to 7 `OK`; row 8 is a count for information (restricted files referenced by versions; expected `0` on a fresh install).
4. Deploy the app. Safe in either order: without the migration the new panels say they are not installed and the old screens work.

Rollback: deploy the app from before Phase 2 first (it calls these functions), then run `supabase/manual-sql/proj_phase2_deliverables_site_90_rollback.sql`. It stops while any Phase 2 data exists (export `proj_task_output_versions`, `proj_site_crew`, `proj_site_shipments` the new `proj_plan_items` columns and the Phase 2 change-log entries first); otherwise it restores the previous `proj_set_task_status` body, drops the new functions, tables and columns and puts the change-log check back. No task, file, plan item, booking or Inventory record is deleted by it.

## 10. What was checked where

| Check | Where | Result |
|---|---|---|
| RLS suites: Phase 2 (15 tests: Storyboard v1 to changes to v2 to approval, stale decision refused, concurrent submits, quantity rule, restricted file, RAF runs, crew idempotency, confirmed-date reason, overseas shipment, overview, cross-company denial, PM / assignee / reviewer / Operations roles), Release 1, Quick add and reorder | Local PostgreSQL 16 | 43 of 43 passed |
| Unit and component tests (model, views, history wording, sidebar rail, nav) | Local | Passed (see the PR for the final run) |
| Browser flow, 14 checks: output panel, submit v1, changes requested, v2 and the stale review, approval, register, restricted file, RAF Quick add and schedule, shipment conflict, confirmed-date reason, Work overview links, phone | Local production build, fictional data | 14 of 14 passed |
| #93 smoke: Quick add, retry adds nothing, saved reorder after reload, collapsed sidebar on first paint | Local | 11 of 11 passed |
| Sidebar rail: icons, tooltip, flyout, keyboard, another module, phone, at normal width, narrow window and zoom | Local | 12 of 12 passed |
| Follow-up RLS: `proj-phase2-teams-crew-ops.rls.test.ts` (18: team setup idempotency, site-only access and revocation, an assignment that stops showing when same-company employment ends while the sign-in stays active (leaving, a past leaving date, a removed record, a transfer out; members keep access; no HR field returned), pending Project Manager versions reaching Operations at install and by one click with decided history untouched, crew overlap and override, Operations routing, self and assignee refusal, no eligible reviewer, stale version, cross-company) with the reworked `proj-phase2-deliverables-site.rls.test.ts`; owner packs applied, verified and rolled back on the same scratch database | Local PostgreSQL 16 | 33 of 33 passed (both Phase 2 suites together); the employment regression was run against the migration with the check removed and fails there |
| Follow-up browser flow `project-phase2b-flow.mjs`: new PM selects Content and Programming, assigns a lead, reopens setup without duplicates, submits an output that a different Operations Manager reviews, dual-role self-approval refused, old-version link, "Needs an Operations reviewer", site-only technician denied direct links and export, revocation; employment ended with the sign-in active; a pending team-route PM version sent to Operations without a new upload | Local production build, fictional data | 19 of 19 passed |
| Follow-up browser flow `project-work-schedule-flow.mjs`: 7-, 9- and 30-day plans on desktop and phone (fit, inner scroll, pinned names and header), wheel, touch swipe, keyboard, Day / Week, Today, tooltip on hover, focus and tap, read-only bars, reduced motion | Local production build, fictional data | 12 of 12 passed |
| Follow-up browser flow `project-work-files-shortcut-flow.mjs`: Files & client plan shortcut as Project Manager and member, no access | Local production build, fictional data | 3 of 3 passed on a project with real file rows and an issued client timeline; see 14.1 for the cause that was found |
| Earlier flows rerun after the follow-up: `project-phase2-flow.mjs` (14 checks; its restricted-file step was updated because a Project Manager's own version can no longer carry a restricted file), `sidebar-rail-flow.mjs` (12), `project-plan-usability-flow.mjs` (11: Quick add, retry, saved reorder) | Local production build, fictional data | 14 of 14, 12 of 12, 11 of 11 passed |
| Crew briefing RLS: `proj-phase2-crew-briefing.rls.test.ts` (7: venue from the project, one run uses the project date, several runs are never guessed and the PM chooses, a kind with no project date stays undated, readiness from the Project Plan as counts only with Not applicable vs Not recorded, personal call time, cross-company denial, packs verified and rolled back) | Local PostgreSQL 16 | 7 of 7 passed |
| Files page guard: `client-boundary.test.ts` (no Projects server module reads a constant or helper exported from a client module; it fails on the old code) and the browser check with real file rows | Local | Passed; the guard fails against the old page |
| Shared ⓘ help control: `info-hint.test.tsx` (hover, keyboard focus, Escape, tap, outside tap, drawn outside the card) | Local | 8 of 8 passed |
| Browser flow `project-crew-briefing-flow.mjs`: technician card on a two-run project, a single-run project and a new project; the PM's missing-briefing list; choosing the run; "Use the activity start"; the ⓘ on desktop hover and focus and on phone tap | Local production build, fictional data | Results in the PR body |
| Hosted preflight, migration, verify (20270106000100) | **Owner** | Reported passed by the owner (not run by Claude) |
| Hosted preflight, migration, verify (20270107000100) | **Owner** | Reported applied and verified by the owner (not run by Claude) |
| Hosted preflight, migration, verify (20270108000100) | **Owner** | Not run by Claude |
| Hosted preflight, migration, verify (20270109000100) | **Owner** | Not run by Claude |
| Sidebar fix, signed-in | **Owner** | Reported passed by the owner (not run by Claude) |
| Signed-in Preview QA of the follow-up | **Owner** | Not run by Claude (Claude cannot sign in to Preview) |

## 11. Signed-in Preview checklist (the owner)

Preview shares Production data. Steps marked **WRITES** change real records: use a test project, not a live one.

1. Open a project's Work page. Check the three overview areas show and every link opens the right record. *(read only)*
2. Collapse the sidebar on Projects → Timeline. Hover "My Day": the whole label shows outside the rail. Open a module flyout: it sits above the project header and tabs. Reload: the rail stays collapsed. *(read only)*
3. **WRITES.** On a test task, as Project Manager, set an expected output marked required. As the assignee, try Ready for review: it is refused and the panel says what is missing.
4. **WRITES.** Submit version 1 (a link). As the reviewer, request changes. Submit version 2. Check version 1 still says changes requested and version 2 awaits review, with the attachment times in the project zone.
5. **WRITES.** Open the review dialog on version 2 in one window, submit version 3 in another, then press Approve in the first: it must refuse. Reload and approve version 3.
6. Open Project Plan → Deliverables: the row, filters and version history match; **Export register (CSV)** holds the same rows. If a restricted file exists, check a non-manager sees "restricted file". *(read only)*
7. **WRITES.** On a test project add the RAF runs with **Quick add**; leave run 2's time empty; add crew to run 1; add a shipment arriving after setup. Check the missing time and crew show with fix links and the shipment is flagged.
8. Phone width: task panel, Deliverables, Site schedule and Work overview have no sideways scroll. *(read only)*

## 12. Left for later releases

Operations TV (Phase 3), AI-generated submissions, meeting-transcript automation. No polling, no per-row requests and no parallel tracking system were added: each screen makes one scoped read.

## 13. Follow-up increment: team setup, site-only technicians, Operations review, Work schedule, Work page

Same draft PR. The applied `20270106000100` is untouched; every database change below is in the new additive migration `supabase/migrations/20270107000100_proj_phase2_teams_crew_ops_review.sql` (apply **after** `20270106000100`). Owner pack: `supabase/manual-sql/proj_phase2_teams_crew_ops_review_00_preflight_readonly.sql`, `..._20_verify_readonly.sql`, `..._90_rollback.sql`.

### 13.1 Project team setup (first step on Work)

* A new project whose team setup is incomplete shows **Set up your project team** first on Work. The Project Manager picks departments from presets (**Content, Programming, Engineering, Site / Installation**) in one go, or **Add custom team** for an exception, and picks a lead per team in the same dialog. A team can be saved before its lead is known: it shows **Lead needed** until one is named. The lead is shown as, for example, "Programming Lead". Only people eligible for the project (Projects access in the company) are offered; the dialog says plainly who will be **added to the project** (and can then read its workspace, tasks, files and Project Chat) and the save needs that confirmation (enforced in the database).
* `proj_setup_teams` (server action `setupProjectTeams`) creates only the selected teams. A team with the same name (case and spacing ignored) is never duplicated; a missing lead is filled; an **existing lead is never overwritten**; rosters are kept. Reopening and saving again therefore changes nothing. Once complete, Work shows a compact **team summary** and **Manage team** (`team-summary-card`, `team-manage-open`). The project-level "Department" filter is now **Project team**; HR departments stay separate.
* **Site / Installation** is a team of project members: it never enrols technicians. Technicians are assigned to an activity (13.2).

### 13.2 Site-only technicians

* **Assign crew** (a Project Manager action) may name a company employee who is **not** on the project. They are labelled **site-only**; the dialog explains it. Each crew row can carry a **call time** and **instructions**; the activity carries a brief **readiness** (Hardware, Content, App: Ready / Not ready / Not known, with a note; hardware also shows Inventory's request state, read).
* A site-only technician reads **only** `proj_my_site_assignments()`: activity, role, venue, call time, relevant instructions and the brief readiness. They see it on **My site assignments** (`/site-assignments`) and a card on My Day. No table policy was widened: they cannot open Project Chat, tasks, files, reviews, exports or commercial data, directly or by link (checked with direct URLs, and the register export is refused). A project engineer and a site-only technician can be on the same activity.
* The access ends when the crew row is removed (revocation), the activity is done or cancelled, the activity ended more than a day ago, or the project is completed. **It also ends when the person stops being an eligible employee of the project's company** (they leave, transfer out, or their employment record is removed): `proj_my_site_assignments()` re-runs the same same-company employment check that is used when they are assigned (`proj_site_technician_eligible`), so the old assignment stops showing even though their sign-in stays active. The crew row is kept as history; it just grants nothing. A person who is a project member keeps what membership already gives them, whatever their employment record says. The response carries no employment or HR field.
* Conflicts reuse the existing rules: confirmed site bookings (with preparation and travel) and other **confirmed** activities of the same person. On a tentative activity an overlap is returned as a warning; on a **confirmed** one it is refused unless an **override reason** is given by someone holding `override_site_conflict`.

**One deliberate boundary exception (owner decision needed if you disagree).** Until now no `proj_*` function read an HR table (a database test enforces it). Deciding who counts as an eligible site-only technician needs "active employee of this company", and Projects has no other source for that, so `proj_site_technician_eligible` and `proj_site_technician_candidates` read `employees` for exactly five columns (user, company, status, deleted, termination date): no name, pay, reporting line, leave or attendance. The guard test now allows only those two functions and a second test pins the columns they may read. Nothing else changed in that boundary.

### 13.3 Operations review of outputs the Project Manager submits

* A version submitted by the Project Manager (even on someone else's task) is routed to an eligible **Operations Manager** of the project's company (`proj_company_grants.capabilities` contains `operations`; founders do not count by themselves). Other submissions keep the normal Project Manager / team-lead review.
* **Neither the submitter nor the task's assignee can decide it, even holding Operations**: enforced in `proj_decide_task_output` and mirrored in the screen. With exactly one eligible reviewer the version is assigned to them; otherwise the pool is notified and it waits. Operations gets review authority and evidence access only inside the existing file restrictions (a PM version that references a restricted file is refused for the Operations route).
* The version shows **Awaiting Operations review** and the reviewer's name. It appears in the existing Operations decision queue and on My Day with a direct link to the version (`/projects/<id>/work?task=<task>&version=<version>`). With no eligible reviewer it shows **Needs an Operations reviewer**, and the Project Manager or an Operations Manager can **assign** one (`proj_assign_output_reviewer`). A new version gets its own review; an old link to an earlier version never approves the newer one (the screen says the version is no longer current and the database refuses).

* **Versions already waiting from the first Phase 2 migration.** The new review-route column starts as `team` for every earlier row, so a version the Project Manager submitted before this release would otherwise wait for a team review. Two things move it without uploading it again: (a) applying `20270107000100` moves each such pending version (the current, still-waiting version the Project Manager submitted, on an open project, whose files Operations can open) to Operations once, with the reviewer assigned when exactly one is eligible, a notice to the Operations pool and a change-log line "review route: Team to Operations"; (b) on the version, the Project Manager or an Operations Manager can press **Send to Operations review** (`proj_reroute_output_review`) at any time. A version whose file is restricted is not moved silently: the button explains that the file must be made unrestricted first. Approved, changes-requested and superseded versions are never touched, so completed review history stays exactly as it was. The verify script's row 10 fails if a movable pending version is still on the team route.

### 13.4 Work schedule (was Timeline)

* Project Plan → **Timeline** is renamed **Work schedule**; the old `?view=timeline` link still opens it. The **Site schedule** stays the top-level place for installation, show, dismantling, crew and shipments. Delivery schedule records, links and client timeline issuing are unchanged. The "start from a sequence" dialog starts blank (no default Moodboard / Storyboard prompt).
* Chart (`plan-timeline.tsx`): each day is at least **56 px** wide, so a 7-day plan fits beside the pinned **12rem** names column in a normal desktop window, while 9 and 30 days extend and **scroll inside the chart** (the page itself never scrolls sideways). Task names and the date header are pinned; a **Today** marker and a **Today** jump button; exact dates on every row; a compact **Day / Week** switch (Week groups by week, rows keep exact dates); a subtle edge cue when dates are offscreen. Scrolling works by trackpad, touch swipe and keyboard (arrows, PageUp/PageDown, Home/End), smooth unless the person prefers reduced motion. Hover or keyboard focus on a bar shows a tooltip (name, owner, status, exact dates) clear of the chart edges; on touch a tap does the same. Bars are **read-only**: dates change through the existing task edit action and approval rules.

### 13.5 Work page

* A compact **Milestones** and **Task outputs** summary on Work with links (Task outputs links to Deliverables filtered by Missing / Awaiting / Changes requested / Approved).
* The older department-level deliverables are now called **Work packages** (an empty state tells the Project Manager the next step). Task outputs stay "Deliverables" under Project Plan.
* A feedback item linked to an activation that was later removed stays readable and says **Activation removed** (no broken link).
* **Files & client plan shortcut.** The first local check used a project with no files and could not reproduce the hosted error. Signed-in Preview QA then showed "This page couldn't load" (reference 177030816) on a project that had files; the cause was found by adding files to the local fixture and is described in 14.1. The shortcut and the direct link now open the page for the Project Manager and for a project member, and only people who can read the project get either.

### 13.6 Install order and rollback for the follow-up

1. `supabase/manual-sql/proj_phase2_teams_crew_ops_review_00_preflight_readonly.sql` (read only): requires the applied `20270106000100`; a second run says "already installed".
2. Apply `supabase/migrations/20270107000100_proj_phase2_teams_crew_ops_review.sql` (row 35 of `docs/launch-refinement-install-order.md`).
3. `supabase/manual-sql/proj_phase2_teams_crew_ops_review_20_verify_readonly.sql` (read only): 11 rows; rows 1 to 10 `OK`; row 11 is for information (counts of site-only technicians, versions waiting for Operations review, teams needing a lead).
4. Deploy the app. Safe in either order for the old screens; the new team, site-only and Operations review screens need the migration.

Rollback: deploy the app from before this increment first, then run `..._90_rollback.sql`. It **stops** while any of this exists: teams without a lead, crew rows with a call time or instructions or site-only technicians, versions routed to Operations, readiness or crew instructions, or team change-log entries (export them first). Otherwise it restores the previous function bodies, unwraps `ops_overview` and restores the earlier constraints. It does not touch `20270106000100` data.

### 13.7 Screenshots (fictional data, local stack)

`docs/projects-phase-2-screenshots/`: `team-setup-dialog-desktop.png`, `team-summary-work-desktop.png`, `operations-review-awaiting-task-desktop.png`, `operations-review-queue-desktop.png`, `my-site-assignments-desktop.png`, `my-site-assignments-phone.png`, `work-schedule-7-days-desktop.png`, `work-schedule-30-days-desktop.png`, `work-schedule-7-days-phone.png`, `work-schedule-30-days-phone.png`, `work-schedule-tooltip-desktop.png`.

## 14. Follow-up 2: Files & client plan crash, the crew card, and one help control

### 14.1 Files & client plan: "This page couldn't load" (reference 177030816)

* **Cause.** The page (a server component) read `FILE_PURPOSES` from `documents/file-forms.tsx`, a `"use client"` module. A server component receives a reference, not the array, so `FILE_PURPOSES.find` was not a function the moment the page drew its first file row. Any project with at least one file or link crashed; a project with none did not, which is why the first local check passed.
* **Not found in a log.** The hosted entry for reference 177030816 could not be read from the build session; the cause above was reproduced locally (same error, `s.FILE_PURPOSES.find is not a function`, on a project with one link) and is the only code path on that page that reads such a constant.
* **Fix.** `lib/projects/file-purposes.ts` is a plain module with the purposes and `filePurposeLabel`; the page and the add-file forms both import it. File permissions, restricted files and client timeline issuing are unchanged.
* **Guard.** `app/(app)/projects/client-boundary.test.ts` scans the Projects routes and fails when a server module imports a constant or lower-case helper from a client module (it fails against the old page). The browser check now adds a link, a restricted unnamed link, completion evidence and an issued client timeline, then opens the page as the Project Manager and as a member (the member must not see the restricted link) from the Work shortcut and by direct link.

### 14.2 The crew card and the site briefing (new additive migration `20270108000100_proj_phase2_crew_briefing.sql`)

Both earlier Phase 2 migrations are applied on hosted and are not edited. This one is additive: a wider readiness check, five new functions, and a replaced body for two functions it rewrites (`proj_my_site_assignments`, `proj_set_activity_readiness`).

Why: a site-only technician saw a tentative Setup with no date, venue, call time or readiness, because those facts lived in different records. Where each one now comes from:

| On the card | Source, in order | Stated on screen |
|---|---|---|
| Venue | The activity's own location, else the project's recorded venue (`proj_project_details.location`) | "(the project's venue)"; "Not recorded yet" when neither |
| Date | The activity's own date or time window, else the project's committed date (installation start for a Setup; event start to end for a Show) **only when exactly one activity of that kind exists** | "(from the project dates; the time is not set yet)"; otherwise "Date not set yet" |
| Several runs | Nothing is guessed. The Project Manager sees "choose which run it belongs to" with a **This run** button on each undated run; it copies the project date to that activity only (`proj_apply_project_dates`, logged as "Taken from the project dates") | The other runs keep asking |
| Call time | Personal, per person (`proj_site_crew.call_at`); never inferred | "Not set yet: your Project Manager will confirm it"; in the Crew dialog **Use the activity start** fills it when the activity has a time window (dates-only activities say to add a start time first) |
| Hardware, Content, App | The Project Manager's own value when set; otherwise derived from the Project Plan lines of that kind (a task that is done, or an Inventory request that is reserved, dispatched or returned) | "Not ready (1 of 2 ready, from the Project Plan)", "Ready" |
| Not applicable / Not recorded | Not applicable = set by the Project Manager, or the plan has lines but none of that kind. Not recorded = nothing is recorded anywhere | Different words; nothing recorded never reads as Not applicable |

* The Project Manager sees **Still missing from the briefing** beside Assign crew: no venue, no date, which run to choose, how many crew have no call time, readiness not recorded (`proj_site_briefing`, project readers only). Each gap has its own fix button.
* The technician view is unchanged in scope: the technician reads only their own assignment through `proj_my_site_assignments()`. It now adds the effective venue and date and readiness **counts** ("2 of 5 ready"), never a line, task, file or person name; the verify script checks the function does not read the task, file or version tables itself.
* Readiness set by hand may now be **Not applicable** (the Brief dialog says Not recorded lets the Project Plan speak). The old check is restored by the rollback, which stops while a Not applicable value exists.
* **Partial.** The Work overview's "Next on site" card still shows only the activity's own venue (it is built by a function this migration does not replace).

Install order: (1) `supabase/manual-sql/proj_phase2_crew_briefing_00_preflight_readonly.sql` (rows 1 to 4: `OK`, `OK`, `OK`, then "not installed yet" or "already installed"; rows 5 and 6 are counts for information: open site activities without their own venue or date, crew without a call time); (2) apply `supabase/migrations/20270108000100_proj_phase2_crew_briefing.sql` (row 36 of `docs/launch-refinement-install-order.md`); (3) `..._20_verify_readonly.sql` (6 rows; rows 1 to 5 `OK`; row 6 counts activities that borrow the project venue or date, runs still waiting for a choice, and Not applicable values); (4) deploy the app (without the migration the new lines are simply absent and the old card still works). Rollback: `..._90_rollback.sql`, after deploying the previous app; it stops while any readiness is Not applicable, restores the applied bodies of the two replaced functions, drops the new functions and puts the narrower check back. Nothing else is deleted; dates a Project Manager copied stay as ordinary dates.

### 14.3 One help control, and less explanatory text

* `components/ui/info-hint.tsx` is the shared ⓘ: it opens on mouse hover, on keyboard focus and on a tap; Escape, a tap elsewhere or moving focus away closes it. The popover is drawn in the page body at a fixed position taken from the icon, so no card edge clips it and it sits above sticky headers and tabs (below a dialog); it stays inside the screen and flips above the icon when there is no room. `Panel hint=`, `FormDialog help=`, `Modal help=` and `Field help=` (Sales action form and Budget) place it beside a heading or a field label; related help is grouped under one icon.
* Rules applied: copy that repeated a heading or button was removed; optional explanations, examples and calculation rules moved behind the ⓘ; ⚠ marks real warnings; errors, blockers, required inputs, who acts next and the consequences of submitting, approving or publishing stay on the page (for example "Set planning dates before submitting" stays beside Submit; who reviews and what approving does stays beside the review).
* Screens covered in Projects & Tasks: Projects list, My Work, Calendar, Handovers, Work, Project Plan, Work schedule, Deliverables, Site schedule, Equipment, Budget, Manage team, Feedback & changes, Files & client plan, History, Closeout, and the Complete, Edit details, Change status and Manage dialogs; in Operations: Overview, Upcoming Work and the decision, review and planning panels.
* Exceptions, left as they were: the Inventory request, prepare, send and receive forms (`components/inventory/planning/**`, shared with the Inventory module), the Sales-side Operations planning panel, `/projects/scope-decisions`, and screens with no explanatory copy (summary panel, project board).
* One effect to know: an ⓘ button is named "More about <label>", so a browser test that finds a field by a partial label must match the label exactly.

### 14.4 Screenshots (fictional data, local stack)

`docs/projects-phase-2-screenshots/`: `technician-two-runs-desktop.png` and `technician-two-runs-phone.png` (the crew card on a project with two setup runs: the project's venue labelled, no guessed date, "Not set yet" call time, readiness from the Project Plan), `pm-gaps-desktop.png` (Still missing from the briefing beside Assign crew, with This run on each undated run), `info-hint-desktop.png` and `info-hint-phone.png` (the ⓘ open beside the Site schedule title).


## 15. Finish Phase 2: one site story everywhere, actionable queues, simpler navigation (new additive migration `20270109000100_proj_phase2_site_state.sql`)

Same draft PR #94 into `main` (kept in draft). `20270106000100`, `20270107000100` and `20270108000100` are applied on hosted and are **not edited**. **`20270109000100` is not applied anywhere; the owner runs it.**

### 15.1 What changed in the database

| Topic | Rule |
|---|---|
| Suggested date, scheduled activity, actual start | Three different facts. `proj_plan_items.actual_started_at / actual_started_by / actual_start_note` is the **explicit start record** (`proj_record_site_start`, `proj_clear_site_start`; Project Manager only; never in the future). `proj_site_phase_json` states the phase: `started` only with that record; `scheduled` / `due_today`; `date_passed` ("Scheduled installation date passed · start unconfirmed"); `no_date`; and whether the date is the activity's own or borrowed from the project header. A passed date alone never means started. |
| Readiness | Run-specific: the Project Manager's value, else evidence linked to that run (plan lines sharing its milestone; Inventory requests reached through its shipments), else **Not recorded**; **Not applicable** when the run's scope or the Project Manager establishes it. The Project Plan counts are **Project-wide readiness** and are shown separately. A finished task alone proves neither an approved output nor equipment readiness: content and app need an **approved** output version, hardware needs a reserved or sent Inventory request. |
| One technician shape | `proj_site_assignment_json` is used by `proj_my_site_assignments` (the technician) and `proj_preview_site_assignment` (the Project Manager's preview), so the preview is exactly what the technician reads. It adds `phase`, `contact` (site lead, else Project Manager) and `reporting` (what is still missing). `proj_site_briefing` also carries `phase`. |
| Dated activities, once each | `proj_site_activities_read(company, project default null, limit default 300)` for Operations, Work, Calendar and the Projects list, under the viewer's own access. |
| Crew notices | Type `project_site_change`. Triggers write one notice (previous and new values) to the **affected assignments only** when a **confirmed** date or venue moves or a personal call time moves; several changes merge into one unread notice per person and activity. Link: `/site-assignments?activity=<id>`. |

Replaced (same signatures): `proj_my_site_assignments`, `proj_site_briefing`, `proj_activity_readiness_effective`. New callable by signed-in users: `proj_record_site_start`, `proj_clear_site_start`, `proj_preview_site_assignment`, `proj_site_activities_read`. Internal (not callable): `proj_site_phase_json`, `proj_site_assignment_json`, the readiness helpers, the trigger functions.

Packs: `supabase/manual-sql/proj_phase2_site_state_00_preflight_readonly.sql` (rows 1 to 3 `OK`, row 4 "not installed yet" or "already installed", rows 5 and 6 counts for information); `proj_phase2_site_state_20_verify_readonly.sql` (7 rows: 1 to 6 `OK`, 7 for information); `proj_phase2_site_state_90_rollback.sql` (stops while any activity has a start record; restores the applied `20270108000100` bodies; drops the new functions, triggers and columns; safe to run twice). Install order row 37 in `docs/launch-refinement-install-order.md`. Apply it **before deploying this build**: the technician card, the Site schedule briefing and Preview briefing call the replaced and new functions.

### 15.2 What changed on screen

* **Site schedule:** a phase line on every activity; **Preview briefing** beside Crew (the technician card in a phone frame, "As <name> sees it", person selector, missing date, venue and call time with shortcuts); **Record started** and **Clear start record**; this run's readiness separate from **Project-wide readiness**; the ⓘ help rewritten.
* **Technician card and My Day card:** phone-first order: reporting status, call time, venue, the named contact, then instructions and readiness; a tentative assignment whose date passed with details missing reads "Provisional date passed · contact <name> for updated details". `/site-assignments?activity=<id>` highlights the card and shows "Changed: field · from → to".
* **Work:** Needs you, Waiting on someone else and Next on site come first (Next on site uses the shared phase wording through one bounded read of this project); counters **Tasks in review** and **Outputs awaiting approval**; output rows read "Task done · Output awaiting Operations review"; queues come from `lib/projects/work-queues.ts` with the exact version link and the named reviewer. **My Work:** Do next, Changes requested, Waiting for review, Waiting for my review, plus the Operations reviews waiting for the viewer. **Deliverables:** filters All, Do next, Waiting for review, Changes requested, Missing, Approved; earlier feedback sits beside a new version; closing a task panel keeps the filters.
* **Operations Overview:** the company is always visible (switcher when there are several; the last permitted company is remembered in the `ops_company` cookie and re-validated, else the first permitted company by name); Decisions assigned to me, follow-ups with the owner they wait on and Next on site come before the summaries; one `proj_site_activities_read` per page feeds Next on site, the timeline and team pressure, so each dated activity appears once with its exact link (`/projects/<id>/plan?plan=site&mode=list#site-<id>`); a project header date is used only where the project has no dated activity and is labelled; Sales dates are labelled tentative and disappear once the enquiry is a project; "Installation started" is gone (phase wording, week bucket "Date passed · start unconfirmed"); team pressure lists both commitments and an activity-level overlap of confirmed crewed activities; an equipment request code links to the request with "Next: Set planning dates before submitting to Warehouse". **Upcoming Work and Handovers:** installation, show and dismantling grouped per enquiry or run; the button "Name a provisional Project Manager"; an owner and next-step line on pending handovers; after acceptance "Start the project plan" and an "Accepted brief" link in the project header.
* **Projects list and Calendar:** Next commitment (exact row link; "No dated commitment" naming the Project Manager), "Team leads not set" versus "No other members yet", Manage team, one merged recent-activity preview with one History link; Calendar Month / Week / Agenda with an opt-in "Site activities" filter and exact row links. **Equipment:** a Submit → Reserve → Dispatch → Return line, the request link, a Project Plan origin badge and **Shipments by site run**.
* **Project Plan and Files & client plan:** the schedules are named **Delivery timeline** and **Site schedule** with their purposes behind an ⓘ; suggested stages are hidden once the Project Plan holds work; Files & client plan reads 1 Choose what the client sees (tick boxes over milestones and plan items, saved through `proj_save_milestone` / `proj_save_plan_item`), 2 Preview, 3 Issued versions (frozen, never changed by a new choice); the Release plan dialog has a needs-attention block with links; Feedback & changes link both ways.

### 15.3 Implemented, partial and missing

| Item | Status | Concrete dependency and impact |
|---|---|---|
| Phase wording, start record, readiness scope, preview, notices, one activity read | Implemented | Needs `20270109000100` applied by the owner. |
| Individual tasks on the client timeline | **Missing** | Needs a migration: tasks have no client-facing flag and `proj_build_plan_payload` has no slot for them. Milestones carry the task dates the client sees. |
| Naming the person in a crew overlap on Operations | **Partial** | The activity read returns crew counts, not people; the page says "check whether the same people are on both". Needs crew user ids per activity or a company crew-overlap read (a migration). |
| Phase wording on the three existing calendar reads | **Partial** | They return no `phase`; only the new "Site activities" filter uses it. Needs a database change. |
| Work-package indicator on the Projects list | Missing | Needs a per-project read. |
| "Back to calendar" on plan links | Missing | Plan pages have no return parameter. |
| Draft equipment origin on the Operations request state | Partial | Origin is not on `RequestState`; Project Equipment shows it. |
| My Day task-review entry with `&version=` | Partial | My Day reads tasks only; Operations review entries and the Operations queue already link the exact version. Needs a version read in `loadMyWork`. |
| My Work version lookup | Capped | 300 task ids; a note shows when the read fails. |
| Notices after visiting the page | Deliberate | They stay unread (no write on read). |
| Rail "Recent activity" merged with overview "Recent changes" | Not done | They show different records. |
| Site reads on Operations, Calendar, Projects list | Capped | 300 activities; a warning shows when reached. |
| Work schedule on phones | Partial | Touch targets and text sizes only; not otherwise redesigned. |

### 15.4 Evidence (local isolated stack, production build; fictional data)

RLS: `proj-phase2-site-state.rls.test.ts` 7 of 7; 47 of 47 across the four Phase 2 RLS files (the earlier crew-briefing and teams tests were adjusted for the new readiness rules and run the site-state rollback first). Web unit tests: 317 files, 3585 tests; `tsc` and `eslint` clean. Browser flows, all green after this round: `project-crew-briefing-flow` 10/10, `project-phase2b-flow` 19/19, `project-phase2-flow` 14/14, `project-work-schedule-flow` 12/12, `project-plan-flow` 19/19, `project-plan-usability-flow` 11/11, `project-plan-sequence-flow` 7/7, `project-plan-timeline-flow` 7/7, `sidebar-rail-flow` 12/12; new `project-phase2-finish-flow` 12/12 (Project Manager, technician and Operations sessions: the preview equals the technician's phone view, a passed date never reads started, the provisional note, call time versus activity start, record and clear start, a confirmed move notifies only the affected crew with previous and new values, Operations lists each activity once with exact links and the equipment request link, team pressure shows both commitments, Files & client plan chooser with an issued version staying frozen and opening); new `project-phase2-queues-flow` 7/7 (the output waiting on Operations in the Project Manager's Waiting list with the exact version, the author side cannot self-review, the assigned reviewer reaches the exact version from My Day, Operations and My Work, changes requested follows across views, Projects list next commitment and Manage team, phone Projects list and Calendar Agenda without sideways scroll).

Hosted status for this round: `20270109000100` preflight, migration and verify are **owner steps, not run by Claude**; signed-in Preview QA of this round is **not run by Claude** (Claude cannot sign in to Preview).

Also run on the final build: `project-work-files-shortcut-flow.mjs` 3 of 3 (its assertion now reads the renamed "Project files" panel) and the full RLS suite, 83 files and 2067 tests. `projects-workspace.mjs` (the Stage 2 directory and My Work check) is **not green and was not repaired in this round**: it still asserts the older Work, Timeline, Discussion, Equipment tabs, the older My Work list and the older Work card counts, so 13 of its 40 checks fail on the current build. It was not run against the commit before this round, so whether any of those failures predates this round is not established here.

Screenshots from the two new flows (`docs/projects-phase-2-screenshots/finish-*.png`): the Project Manager's Preview briefing, the technician's phone card (phase and reporting status first), a passed date reading "start unconfirmed" with the provisional note, a crew change notice, Operations with the activities listed once, a populated Files & client plan with an issued version, the two-run Site schedule, Work waiting on Operations review, the reviewer's exact version, and the Projects list and Calendar Agenda on a phone.
