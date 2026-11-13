# Projects & Tasks Phase 2: deliverables, versioned reviews, site schedule, Work overview, sidebar fixes

**Status:** draft PR from `feat/projects-phase-2` into `main` (after #92 and #93 merged). One additive migration, `supabase/migrations/20270106000100_proj_phase2_deliverables_site.sql` (apply after `20270105000100`). **Nothing here was run against a hosted project by Claude.** Everything below was checked on a local PostgreSQL 16 and a local production build with fictional data; hosted SQL and signed-in Preview checks are the owner's (see "What was checked where").

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
| Hosted preflight, migration, verify | **Owner** | Not run by Claude |
| Signed-in Preview QA | **Owner** | Not run by Claude (Claude cannot sign in to Preview) |

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
