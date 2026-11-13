# Projects & Tasks Phase 2: task deliverables, versioned reviews, site schedule, Work overview

Status: written from the code on branch `feat/projects-phase-2` (draft PR into `main`, after #92 and #93). Migration `20270106000100_proj_phase2_deliverables_site.sql`. **Not applied on any hosted database by Claude.** Checked on a local PostgreSQL 16 and a local production build with fictional data (RLS tests, a 14-check browser flow, a 12-check sidebar flow); signed-in Preview QA and hosted SQL are the owner's. The scope, install order, rollback and signed-in checklist are in [`docs/projects-phase-2-scope.md`](../../projects-phase-2-scope.md); this file is the Map reference (reference letter **S**).

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

The existing review and completion action (`proj_set_task_status`) is unchanged in its label and permissions; it now also refuses a required output that is missing.
