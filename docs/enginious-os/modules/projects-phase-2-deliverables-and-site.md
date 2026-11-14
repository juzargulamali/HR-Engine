# Projects & Tasks Phase 2: task deliverables, versioned reviews, site schedule, Work overview

Status: written from the code on branch `feat/projects-phase-2` (draft PR into `main`, after #92 and #93). Migrations `20270106000100_proj_phase2_deliverables_site.sql` (owner-reported applied and verified on hosted; not edited) and the follow-up `20270107000100_proj_phase2_teams_crew_ops_review.sql` (section 11; not applied). **Nothing here was applied on a hosted database by Claude.** Checked on a local PostgreSQL 16 and a local production build with fictional data (RLS tests, a 14-check browser flow, a 12-check sidebar flow); signed-in Preview QA and hosted SQL are the owner's. The scope, install order, rollback and signed-in checklist are in [`docs/projects-phase-2-scope.md`](../../projects-phase-2-scope.md); this file is the Map reference (reference letter **S**).

## 1. Words and rules

* **Expected output** (a task's "deliverable"): optional name, optional quantity, required or not. Not the same thing as `proj_deliverables` (a work package given to a team), which is unchanged.
* **Version**: one submission against a task's output. It holds the attached time, the submitter, a reference to one **existing project file or an approved https link** (and optionally a snapshot file), a review status (`awaiting`, `changes_requested`, `approved`, `replaced`) and, separately, the approved time. Versions are never edited or deleted.
* **Reference, not access**: a version stores only the id of a `proj_files` row. Opening it goes through the file's own row security: a restricted file opens only for the Project Manager, in the task panel, the Deliverables view and the CSV export alike. The database refuses a reference to a file the submitter cannot open.
* **Required output**: `proj_set_task_status` (the one review and completion path) refuses Ready for review and Done while a required output has no version, or fewer items than the quantity. Without a required output it behaves as before.
* **Times** show in the project's site time zone with the zone printed; with none set the screen says so and shows UTC.

## 2. Roles (enforced in the database functions)

| Action | Who |
|---|---|
| Set the expected output | Project Manager; the head of the task's team |
| Submit a version | The assignee; the head of the task's team; the Project Manager |
| Approve or request changes on a version | The head of the task's team; the Project Manager. Never the submitter or the assignee |
| Link client feedback to a version or an activation | Project Manager |
| Add, edit or confirm a site activity; set its crew; add, edit or remove a shipment | Project Manager (an open project only). Changing a confirmed activity's date or time needs a reason |
| Read the register, the site schedule, the overview | Readers of the project's details (the same rule as the rest of the project) |
| Operations | Reads like any detail reader; changes nothing here |

A person in another company, or without access to the project, gets "Project not found" from every read and a refusal from every write.

## 3. Task panel: expected output and versions

Beside the assignee's action the panel shows the expected output, whether it is required, what is missing ("Add the expected output: Moodboard. The task cannot be sent for review or completed without it."), the current version with its attachment time and status, and a compact **Version history** (every version, its decision and note). Buttons: **Set expected output** / **Edit expected output**, **Submit output** / **Submit version N**, **Review**, **Link client feedback**. A submit dialog offers **Upload a file**, **Choose a project file** or **Add a link**. A link to a document that can change is flagged "can change after approval", with an optional snapshot and a version-specific link. Submitting the same link again makes a new version; a retry of the same dialog makes none. The task history shows output events (submitted, replacing the earlier version, approved, changes requested).

## 4. Review of the exact version

The review dialog is bound to one version. If a newer version arrives first, Approve is refused with "Version N is no longer the current one: version M was submitted. Review that one" and nothing is approved; reloading shows the current version. Version 1's "changes requested" and note stay on version 1; version 2 starts at "awaiting review".

## 5. Deliverables view (Project Plan) and register export

`/projects/[id]/delivery?view=deliverables`. Rows grouped by activation (or "Not part of an activation"): deliverable, linked task, owner, current version, status, attached and approved times, Open / Download where permitted, version history, milestone. Filters **All / Missing / Awaiting review / Changes requested / Approved** with counts. **Export register (CSV)** (`/api/projects/[id]/deliverables/export`) uses the same database read under the requester's own session, so it never holds more than the screen; a failed read sends an error, never a partial file.

## 6. Site schedule

Project Plan → Site shows the **Site schedule** panel and strip (and Timeline → Site keeps its List / Calendar / Timeline modes on the same records; the old item list remains under "All site items"). Labels explain the difference between the **Project Plan work schedule** (tasks) and the **Site schedule** (the venue), with links both ways.

* Activities: kind (mockup, setup, show, dismantling, other), run label, location, owner, date or time window with its own zone, **Tentative / Confirmed**. Several of each kind can exist. **Add activity**, **Quick add** (several runs in one save, retry-safe), **Edit**.
* Crew per activity: installation, standby, backup, dismantling (**Assign crew** / **Crew**). Saving the same crew twice changes nothing.
* Shipments: departure, expected arrival, return, each with its own zone; optional link to a setup and to an equipment request. Inventory's reservation, dispatch and return state is read from the request ("from Inventory"). A shipment arriving after the setup it supports is flagged.
* An incomplete plan saves. What is missing (date, time, crew) is shown on the row and in Needs attention with a link to the fix.
* Names stay visible while scrolling; short schedules show daily labels, long ones weekly; rows show exact dates.

## 7. Work overview and history wording

The Work page opens with **Next on site**, **Needs attention** (missing required output, changes requested, review waiting, incomplete site plan, late shipment; each says who can act and links to the record; at most two lines per kind plus "And N more") and **Recent changes** (newest output, review and site records). The four-line "Recent activity" on the right no longer repeats these. History describes output, site and shipment entries in plain sentences.

## 8. Shared sidebar

The collapsed rail's tooltip and flyout are drawn in body-level layers (above sticky headers and tabs, below native dialogs). Tooltip: the whole label on hover and keyboard focus, icon has an accessible name. Flyout: anchored to the icon, inside the viewport, scrolls when long, the pointer can enter it, arrow keys move, Escape closes and returns focus. The saved collapsed preference, the active route, role-filtered links and the phone drawer are unchanged.

## 9. Gaps and what is Unverified

* Hosted application of the migration and signed-in Preview behaviour are unverified by Claude (owner-run).
* A restricted-file check was run with a Project Manager and a non-manager on the local stack only.
* The CSV export was checked through the same read as the screen and in a browser download on the local stack; a hosted download is unverified.
* Operations TV (Phase 3) will read these records; no read here is shaped for it beyond `proj_work_overview` and `proj_site_schedule`.

## 10. Tests that cover this slice

`packages/rls-tests/test/proj-phase2-deliverables-site.rls.test.ts` (15); `apps/web/src/lib/projects/phase2/model.test.ts`; `apps/web/src/components/projects/phase2-views.test.tsx`; `apps/web/src/components/nav/sidebar-rail.test.tsx`; browser flows `apps/web/os-shell-checks/project-phase2-flow.mjs` (14) and `sidebar-rail-flow.mjs` (12), local stack only.

## 11. Follow-up: team setup, site-only technicians, Operations review, Work schedule, Work page

Migration `20270107000100_proj_phase2_teams_crew_ops_review.sql`, applied after `20270106000100`, never edited into it. Full text of scope, install order and rollback: `docs/projects-phase-2-scope.md` section 13.

### 11.1 Project team setup

On Work, a project with incomplete team setup shows **Set up your project team** as its first action (`team-setup-card`). The dialog (`TeamSetupDialog`) offers presets **Content, Programming, Engineering, Site / Installation** and **Add custom team**, one lead per team (eligible people only: Projects access in the company), and states which people will be added to the project and what that gives them (workspace, tasks, files, Project Chat); the save needs that confirmation, also checked in `proj_setup_teams`. A team may be saved with no lead: it carries **Lead needed**. Leads are labelled by team (for example "Programming Lead"). Saving creates only the selected teams, never duplicates one (same name, case and spacing ignored), fills a missing lead and never replaces an existing one, and keeps rosters. Afterwards Work shows a compact summary and **Manage team** (`team-summary-card`, `team-manage-open`). The old "Department" selector is **Project team**; HR departments are separate. **Site / Installation** is a project team and never enrols technicians. Needs attention lists a team without a lead (`team_lead_needed`, link to People).

### 11.2 Site-only technicians and the brief

Assign crew accepts members of the project and company employees who are not on it (`proj_site_technician_candidates`); the latter are labelled **site-only**. Each row can have a call time (with its zone) and instructions; **Brief** records Hardware, Content and App readiness (Ready, Not ready, Not known), a note and crew instructions (`proj_set_activity_readiness`); hardware also shows Inventory's request state, read not stored. A confirmed activity's overlap with a confirmed booking (with preparation and travel) or another confirmed activity is refused unless an override reason is given by someone with `override_site_conflict`; on a tentative one it is a warning.

A site-only technician reads only `proj_my_site_assignments()`: activity, own role, venue, call time, relevant instructions and brief readiness, on `/site-assignments` and the My Day card. No policy is widened: tasks, files, Project Chat, reviews, exports and commercial data are refused, including by direct link. The access ends when the crew row is removed, the activity is done or cancelled or ended more than a day ago, or the project is completed.

### 11.3 Operations review of PM-submitted outputs

`proj_submit_task_output` sets the route to Operations when the submitter is the Project Manager (on anyone's task) and refuses a restricted file as evidence on that route. The eligible pool (`proj_output_reviewer_pool`) is the company's Operations Managers except the submitter and the task's assignee; with one person the version is assigned to them, otherwise the pool is notified. `proj_decide_task_output` refuses the submitter and the assignee even holding Operations; the screen mirrors it (`can_decide`). The version shows **Awaiting Operations review** and the reviewer, or **Needs an Operations reviewer** with **Assign reviewer** for the PM and Operations Managers (`proj_assign_output_reviewer`). It appears in the Operations decision queue and on My Day with a link to the version; each new version has its own review and an old link shows "no longer current" and approves nothing. Other submissions keep the team head / Project Manager review.

### 11.4 Work schedule

Project Plan **Timeline** is **Work schedule** (`?view=timeline` and `?view=work-schedule`). Each day is at least 56 px wide (7 days fit beside the 12rem pinned names on a normal desktop; 9 and 30 days scroll inside the chart, never the page); names and the date header stay pinned; **Today** marker and jump; exact dates on every row; **Day / Week**; an edge cue for offscreen dates; trackpad, touch and keyboard scrolling (smooth unless reduced motion); tooltip on hover, focus and tap; bars are read-only (dates change through the task edit action and its approval rules). The Site schedule stays the top-level place for installation, show, dismantling, crew and shipments; the sequence dialog starts blank.

### 11.5 Work page

Compact **Milestones** and **Task outputs** summary with links; older department deliverables are **Work packages**; feedback linked to a removed activation shows **Activation removed**; the Files & client plan shortcut opens the same project's documents page (the reported problem was not reproduced locally; browser check `project-work-files-shortcut-flow.mjs`).

### 11.6 Tests

`proj-phase2-teams-crew-ops.rls.test.ts` (18) with the reworked `proj-phase2-deliverables-site.rls.test.ts` (33 of 33 together); `apps/web/src/lib/projects/teams/model.test.ts`, `lib/projects/work-summary.test.ts`, `components/projects/delivery/plan-timeline.test.tsx`, `lib/projects/delivery-plan/insights.test.ts`; browser flows `project-phase2b-flow.mjs` (17), `project-work-schedule-flow.mjs` (12), `project-work-files-shortcut-flow.mjs` (3), local stack only. Hosted use and signed-in behaviour are unverified by Claude.

## 12. Follow-up 2: crew card and briefing, Files & client plan, one help control (draft PR; migration `20270108000100`, not applied by Claude)

### 12.1 Files & client plan

The page read `FILE_PURPOSES` from a `"use client"` module, so it threw (`find is not a function`) for any project with a file or link: "This page couldn't load" (hosted reference 177030816; the hosted log entry was not read, the error was reproduced locally). The purposes now live in the plain module `lib/projects/file-purposes.ts` (`FILE_PURPOSES`, `filePurposeLabel`). File permissions (restricted files are Project Manager only) and client timeline issuing are unchanged. Guard: `app/(app)/projects/client-boundary.test.ts`; browser check `project-work-files-shortcut-flow.mjs` with real file rows and an issued timeline.

### 12.2 The crew card and the briefing

* **Sources.** Venue: the activity's own location, else `proj_project_details.location` (labelled "the project's venue"). Date: the activity's own date or window, else the project's `install_start` (a Setup) or `event_start` to `event_end` (a Show), **only when exactly one activity of that kind exists** (labelled "from the project dates"); with several runs nothing is guessed. Call time: `proj_site_crew.call_at`, personal and explicit. Readiness: `proj_plan_items.ready_*` set by the Project Manager, else derived from Project Plan lines (`proj_dp_lines` of section hardware, content or apps: a task that is done, or an Inventory request that is reserved, dispatched, still out or returned), shown as counts ("1 of 2 ready, from the Project Plan"). **Not applicable** (set by the Project Manager, or the plan has lines but none of that kind) and **Not recorded** (nothing anywhere) are different states.
* **Project Manager.** `proj_site_briefing` returns, per open activity, the effective venue, date and readiness and the gaps: venue, date, choose a run, call times, readiness. They appear as **Still missing from the briefing** beside **Assign crew**, each with its own fix: **This run** (`proj_apply_project_dates`: copies the project date to that activity only, logged "Taken from the project dates"), **Set call times** / **Crew** with **Use the activity start** (only when the activity has a time window), **Set readiness** (the Brief dialog; Not recorded lets the Project Plan speak), **Add the venue**, **Add the date**.
* **Technician.** `proj_my_site_assignments()` still returns only their own assignment; it adds the effective venue and date and the readiness states and counts (never a task, file or person name).
* **Partial.** The Work overview "Next on site" card still shows only the activity's own venue.
* Packs `proj_phase2_crew_briefing_*` (preflight, verify with 6 rows, rollback that stops while a readiness is Not applicable); tests `proj-phase2-crew-briefing.rls.test.ts` (7), `lib/projects/site-briefing.test.ts`, browser flow `project-crew-briefing-flow.mjs`.

### 12.3 The ⓘ help control and the copy pass

`components/ui/info-hint.tsx` (hover, keyboard focus, tap; Escape, outside tap and focus-away close; portal popover above cards and sticky headers, kept inside the screen). `Panel hint=`, `FormDialog help=`, `Modal help=` and `Field help=` place it beside a heading or label; related help shares one icon. Optional explanations, examples and calculation rules sit behind it; ⚠ marks real warnings; errors, blockers, required inputs, who acts next and the consequences of submitting, approving or publishing stay visible. Covered: every Projects & Tasks screen in the Site schedule, Work, Project Plan, Work schedule, Deliverables, Equipment, Budget, Manage team, Feedback & changes, Files & client plan, History and Closeout, plus the Projects list, My Work, Calendar and Handovers; Operations Overview, Upcoming Work and the decision, review and planning panels. Left as they were: the Inventory request forms (shared with Inventory), the Sales-side Operations planning panel. Test: `components/ui/info-hint.test.tsx` (8).

## 13. Finish Phase 2: one site story everywhere (draft PR; migration `20270109000100`, not applied by Claude)

Source: `docs/projects-phase-2-scope.md` section 15. The three earlier migrations are applied on hosted and not edited.

* **Phase words (`lib/projects/site-state.ts`, from `proj_site_phase_json`).** A suggested project date reads "Tentative Setup on 11 Nov (from the project header)"; an activity's own date reads "Tentative / Confirmed <Kind> on <date>"; today reads "<Kind> today"; a passed date with no start record reads "Scheduled installation date passed · start unconfirmed"; no date reads "No date" (or "No date · choose which run" when several runs of that kind share the header date). **Started** appears only when the Project Manager recorded it (`recordSiteStart`; `clearSiteStart` corrects it).
* **Preview briefing (`previewSiteAssignment`).** Beside Crew: pick a crew member; the dialog draws the same technician card in a phone frame labelled "As <name> sees it" (`proj_preview_site_assignment`, which uses the same builder as `proj_my_site_assignments`). Missing date, venue and call time are listed with shortcuts. The call time stays on the individual assignment.
* **Technician card order:** reporting status, call time, venue, the named contact (site lead, else Project Manager), then instructions and readiness. A tentative assignment whose date passed with details missing reads "Provisional date passed · contact <name> for updated details". Access is unchanged: the technician's own assignment and briefing only.
* **Readiness:** this run's value (Project Manager, else linked evidence, else Not recorded; Not applicable when scope or the Project Manager says so) and, on a separate line, **Project-wide readiness**. A finished task alone never makes an output approved or equipment ready.
* **Crew notices:** when a confirmed date or venue moves, or a personal call time moves, the affected crew get one unread `project_site_change` notice (previous and new values, link `/site-assignments?activity=<id>`); the card shows "Changed: field · from → to". Visiting the page does not mark it read. Three triggers write them: `trg_proj_site_activity_moved` (date, the venue the crew actually read, and a zone change that moves the clock time of a call time with no zone of its own), `trg_proj_site_call_moved` (a call time or only its zone, each side read in the zone it carried) and `trg_proj_site_project_details_moved` on `proj_project_details` (the project's venue, installation / event dates or zone, told only to crew of CONFIRMED activities that inherit the changed value: no own venue; no own date and the only activity of its kind; no own zone). A site-only technician has no notification bell, so **My Day "On site next"** also shows "⚠ Changed: field · from → to" with a "See your briefing" link (`my-day-site-changed`, from `loadSiteChanges` in `lib/my-day/site-assignments.ts`; if that read fails the assignment still shows, without the note). Re-saving the Crew dialog interprets the clock text it shows in the activity's current zone, so changing an activity's zone and saving the crew moves the call instant; the notice now says from which zone to which. The Crew dialog has no per-person zone control (a zone-only change comes from the crew function).
* **Work (queues):** Needs you, Waiting on someone else, Next on site first; counters Tasks in review and Outputs awaiting approval; "Task done · Output awaiting Operations review"; each line names the owner (the named Operations reviewer, team lead or Project Manager) and links the exact version. My Work cards Do next, Changes requested, Waiting for review, Waiting for my review (and the Operations reviews waiting for the viewer). Deliverables filters. Earlier feedback sits beside a new version.
* **Operations, Projects list, Calendar, Equipment, Files & client plan:** see `operations.md` section 15, `projects-timeline-site-and-files.md`, `projects-directory-and-my-work.md` and `docs/projects-phase-2-scope.md` section 15.
* **Tests:** `proj-phase2-site-state.rls.test.ts` 8 of 8; browser flows `project-phase2-finish-flow` 12/12, `project-phase2-queues-flow` 10/10 and `project-phase2-notices-flow` 5/5 (plus the earlier Phase 2 flows, all green).

## Coverage rows

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 268 | Task panel: Expected output and what is missing | panel | A task with an expected output | Readers of the project | Show the expected output, required or not, and the next step beside the assignee's action | S 3 | Documented |
| 269 | Set expected output / Edit expected output | dialog | Task panel | Project Manager; the team head | Name the output, quantity, required | S 2, 3 | Documented |
| 270 | Submit output / Submit version N | dialog | Task panel | Assignee, team head, Project Manager | Add a version by upload, project file or link | S 3 | Documented |
| 271 | Review (Approve / Request changes) | dialog | Task panel | Team head, Project Manager (never the submitter) | Decide on the exact version | S 4 | Documented |
| 272 | Version history | panel | Task panel; Deliverables view | Readers of the project | Every version with its decision, note and times | S 3 | Documented |
| 273 | Link client feedback | dialog | Task panel; Feedback & changes | Project Manager | Tie feedback to a version and activation | S 2 | Documented |
| 274 | Deliverables view | view | Project Plan, **Deliverables** | Readers of the project | Register by activation with filters | S 5 | Documented |
| 275 | Export register (CSV) | download | Deliverables view | Readers of the project | Same rows as the screen, nothing more | S 5 | Documented |
| 276 | Site schedule panel and strip | panel | Project Plan, Site | Readers of the project | The venue schedule, labelled apart from the work schedule | S 6 | Documented |
| 277 | Add activity / Edit (site) | dialog | Site schedule | Project Manager | One activity with owner, location, window, zone, state | S 6 | Documented |
| 278 | Quick add (site runs) | dialog | Site schedule | Project Manager | Several runs in one save | S 6 | Documented |
| 279 | Assign crew / Crew | dialog | An activity | Project Manager | Crew by role per activity | S 6 | Documented |
| 280 | Add shipment / Edit / Remove | dialog | Site schedule | Project Manager | Departure, arrival, return and the Inventory link | S 6 | Documented |
| 281 | Next on site | panel | Work page | Readers of the project | The next activity, window, owner, state | S 7 | Documented |
| 282 | Needs attention | panel | Work page | Readers of the project | What is missing or waiting, who can act, where to fix it | S 7 | Documented |
| 283 | Recent changes | panel | Work page | Readers of the project | Newest output, review and site records | S 7 | Documented |
| 284 | History wording for outputs, activities, shipments | list | History tab | Readers of the project | Plain sentences, not raw field names | S 7 | Documented |
| 285 | Collapsed sidebar tooltip | overlay | Hover or focus an icon | Signed-in staff | The whole label outside the rail | S 8 | Documented |
| 286 | Collapsed sidebar flyout | overlay | Open a module icon | Signed-in staff | Module pages above the page content | S 8 | Documented |
| 287 | Set up your project team (card and dialog) | dialog | Work page, first action while team setup is incomplete | Project Manager (others see the state) | Pick Content, Programming, Engineering, Site / Installation and custom teams and a lead per team in one save; saving twice never duplicates | S 11.1 | Documented |
| 288 | Team summary and Manage team | panel | Work page, once teams exist | Readers of the project; Manage team for the Project Manager | Teams with their leads, **Lead needed** flag, and the way back into the same dialog | S 11.1 | Documented |
| 289 | Project team filter (was Department) | filter | Work page, task filters | Readers of the project | Filter tasks by project team; HR departments stay separate | S 11.1 | Documented |
| 290 | Milestones and Task outputs summary | panel | Work page | Readers of the project | Compact counts with links to Project Plan and Deliverables filtered by state | S 11.5 | Documented |
| 291 | Work packages (was Deliverables, department level) | panel | Work page | Readers of the project | The older team-level work packages; the empty state tells the PM the next step | S 11.5 | Documented |
| 292 | Work schedule (was Timeline) | view | Project Plan, **Work schedule** (`?view=timeline` or `?view=work-schedule`) | Readers of the project | Read-only chart: Day / Week, Today, pinned names and dates, tooltip, scrolls inside the chart | S 11.4 | Documented |
| 293 | Awaiting Operations review / Needs an Operations reviewer / Assign reviewer | panel and dialog | Task panel and task page, current version | Readers of the project; Assign reviewer for the PM and Operations Managers | Show who reviews a PM-submitted version and let the PM or Operations assign one | S 11.3 | Documented |
| 294 | Output review in the Operations decision queue and on My Day | panel | Operations Overview `#decisions`; My Day | Operations Managers of the company | Decide one version, linked directly (`?task=&version=`) | S 11.3; O 4.2, 14.3 | Documented |
| 295 | Crew call time, instructions and site-only label | dialog | Assign crew / Crew | Project Manager | Per person: role, call time, instructions, overlap warning; site-only technicians are named as such | S 11.2 | Documented |
| 296 | Brief (activity readiness) | dialog | An activity in the Site schedule | Project Manager | Hardware, Content and App readiness with a note and crew instructions | S 11.2 | Documented |
| 297 | My site assignments | screen | `/site-assignments`; My Day card link | Anyone with a site assignment, including site-only technicians | Own assignments only: activity, role, venue, call time, instructions, brief readiness | S 11.2 | Documented |
| 298 | My site assignments card | panel | My Day | Anyone with a site assignment | The next assignments with a link to the page | S 11.2 | Documented |
| 299 | Feedback linked to a removed activation | list | Feedback & changes | Readers of the project | The feedback stays readable and says **Activation removed** (no broken link) | S 11.5 | Documented |
| 300 | Files & client plan shortcut | link | Work page shortcuts; Manage menu | People who can read the project's details | Open the same project's `/documents` page | S 11.5 | Unverified: the reported hosted problem was not reproduced locally; if it persists send the URL and role |
| 301 | Still missing from the briefing | list | Site schedule, beside Assign crew | Project Manager | Per activity: no venue, no date, choose which run, crew without a call time, readiness not recorded; each with its fix | S 12.2 | Documented |
| 302 | This run (use the project date) | dialog | Site schedule, an undated run when several runs share a kind | Project Manager | Copies the project's installation or event date to that activity only | S 12.2 | Documented |
| 303 | Use the activity start | button | Crew dialog, beside a call time | Project Manager | Fills the person's call time from the activity's start (only when it has a time window); the call time stays personal | S 12.2 | Documented |
| 304 | Crew card: venue, date and readiness | panel | My site assignments, My Day card, Site schedule | Anyone assigned; the Project Manager | The effective venue (labelled), the effective date (labelled), Hardware / Content / App readiness with Not applicable and Not recorded in different words; counts only | S 12.2 | Documented |
| 305 | The ⓘ help control | control | Beside headings and field labels across Projects & Tasks and Operations | Everyone | Opens on hover, keyboard focus and tap; Escape or a tap elsewhere closes it | S 12.3 | Documented |
| 306 | Files & client plan page | screen | `/projects/[id]/documents` | People who can read the project's details | Files and links (restricted ones for the Project Manager only), the client timeline and its issued versions | S 12.1 | Documented |

## Actions

| # | Id | Label in the app | Permission (and where enforced) | Starting state | Server action -> database function | Records changed | Resulting state | Notifications | Retry behaviour |
|---|---|---|---|---|---|---|---|---|---|
| 110 | `projects.task.set_expected_output` | Set / Edit expected output | Manager or team head (`proj_task_actor_role`, in `proj_set_task_output`) | Open project; task not cancelled or deferred | `saveTaskOutput` -> `proj_set_task_output` | `proj_tasks` output columns; change log | Output named, quantity, required | None | Safe: same values change nothing; a stale task version is refused |
| 111 | `projects.task.submit_output` | Submit output / Submit version N | Assignee, team head or manager; the file must be one the submitter can open | Open project | `submitTaskOutput` -> `proj_submit_task_output` (file via the existing prepare, signed upload, finalize and `proj_add_link`) | `proj_task_output_versions`; change log | A new version, status awaiting | None | Safe: a client key makes a retry add nothing; version numbers are allocated under the task lock |
| 112 | `projects.task.decide_output` | Approve this version / Request changes | Team head or manager, never the submitter or assignee | A version that is the current one | `decideTaskOutput` -> `proj_decide_task_output` | The version's status, note, approver, approved time; change log | Approved or changes requested, for that version only | None | Safe: the same decision again reports unchanged; a stale version is refused |
| 113 | `projects.feedback.link_output` | Link client feedback | Manager | Feedback item exists | `linkFeedbackToOutput` -> `proj_link_feedback_output` | `proj_feedback` links | Feedback shown beside the version and activation | None | Safe: same link again changes nothing; links nothing to the client |
| 114 | `projects.site.save_activity` | Add activity / Edit | Manager (`proj_require_manager`), open project | Project exists | `saveSiteActivity` -> `proj_save_site_activity` | `proj_plan_items` (site); change log | Activity saved, incomplete allowed | None | Safe: a client key returns the existing activity; a confirmed activity's date change needs a reason |
| 115 | `projects.site.add_activities` | Quick add | Manager | Project exists | `addSiteActivities` -> `proj_add_site_activities` | `proj_plan_items` (site) in one transaction | Several runs added | None | Safe: the same list again adds nothing; one refused row refuses all |
| 116 | `projects.site.set_crew` | Assign crew / Crew | Manager | An activity | `setSiteCrew` -> `proj_set_site_crew` | `proj_site_crew`; change log | Crew replaced by the list sent | None | Safe: the same list changes nothing |
| 117 | `projects.site.save_shipment` | Add shipment / Edit | Manager | Project exists | `saveShipment` -> `proj_save_shipment` | `proj_site_shipments`; change log | Shipment saved; late arrival flagged on read | None | Safe: a client key returns the existing shipment |
| 118 | `projects.site.remove_shipment` | Remove | Manager | A shipment | `removeShipment` -> `proj_remove_shipment` | `proj_site_shipments`; change log | Shipment removed; the Inventory request is untouched | None | Safe: removing twice is refused as not found |

| 119 | `projects.team.setup` | Set up your project team / Manage team (Save teams) | Manager (`proj_require_manager`); leads need Projects access; a lead not yet on the project needs the access confirmation | Open project | `setupProjectTeams` -> `proj_setup_teams` | `proj_teams` (preset, lead), `proj_project_members` (leads), change log (`team`) | Only the selected teams exist; a team with the same name is kept; a missing lead is filled, an existing lead never replaced; site team enrols no technicians | `project_assigned` to each new lead | Safe: the same list changes nothing; a retry never duplicates a team |
| 120 | `projects.site.set_readiness` | Brief (Hardware, Content, App, note, instructions) | Manager, open project | An activity | `setActivityReadiness` -> `proj_set_activity_readiness` | `proj_plan_items` readiness and crew instruction columns; change log | Readiness stored; shown to everyone assigned | None | Safe: the same values report unchanged |
| 121 | `projects.task.assign_output_reviewer` | Assign reviewer / Release to the Operations queue | Manager or an Operations Manager of the company; the reviewer must be an Operations Manager who is neither the submitter nor the task's assignee | The current version, awaiting, routed to Operations | `assignOutputReviewer` -> `proj_assign_output_reviewer` | `proj_task_output_versions` reviewer columns; change log | Reviewer named (or released to the pool) | `project_review_requested` to the reviewer | Safe: the same reviewer reports unchanged; a newer version is refused |

Changed by the follow-up (migration `20270107000100`): `projects.site.set_crew` (116) now also takes a call time and instructions per person, accepts a **site-only technician** (an active company employee who is not a project member), warns on an overlap with confirmed bookings or other confirmed activities and refuses it on a confirmed activity without an override reason and the `override_site_conflict` capability; `projects.task.submit_output` (111) routes a Project Manager's version to Operations and refuses a restricted file as its evidence on that route; `projects.task.decide_output` (112) refuses the submitter and the task's assignee even holding Operations. Reads added: `proj_my_site_assignments` (a person's own assignments, the only read a site-only technician has) and `proj_site_technician_candidates` (who the PM may assign).

The existing review and completion action (`proj_set_task_status`) is unchanged in its label and permissions; it now also refuses a required output that is missing.
