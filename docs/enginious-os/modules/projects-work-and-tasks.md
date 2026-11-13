# Projects & Tasks: a project's Work page, tasks, milestones and deliverables

Part of the Projects & Tasks Map: [coverage index](./projects-coverage-index.md) (every screen, numbered) and [action catalogue](./projects-action-catalogue.md) (every action that changes data). The two tables at the end of this file are their source.

Status: written against the Projects & Tasks Phase 1 branch `claude/admiring-cray-uky379` (merged as PR #82 (merge `30c7895adc75f834a60b00ed3bca7015b1654282`, 2026-11-11)). **Code read only; nothing was run** (no app, no test, no database, no hosted project). Hosted facts are not stated here. Anything that reading the code could not confirm is marked `Unverified`. The compact index for the whole module is [`projects-phase1-changes.md`](./projects-phase1-changes.md); where this file and that index overlap, the facts were re-checked in the code cited here.

Path shorthand used in the Source columns:

| Short | Full path |
|---|---|
| `W/` | `apps/web/src/app/(app)/projects/[id]/work/` |
| `T/` | `apps/web/src/components/projects/tasks/` |
| `C/` | `apps/web/src/components/` |
| `L/` | `apps/web/src/lib/` |
| `SQL-core` | `supabase/migrations/20261120000100_proj_core_tables.sql` |
| `SQL-base` | `supabase/migrations/20261120000200_proj_projects_handover_functions.sql` |
| `SQL-D` | `supabase/migrations/20261120000300_proj_delivery_functions.sql` |
| `SQL-block` | `supabase/migrations/20261216000900_proj_block_task_notifies_pm.sql` |
| `domain` | `packages/domain/src/permissions/proj.ts` |

Every database function named here was looked up with `create or replace function <name>` across `supabase/migrations/*.sql`; the file cited is the latest definition by file name. Only `proj_block_task` has more than one (`SQL-D`, then `SQL-block`, which is the one in force).

## 1. Roles and rules that apply to everything below

### 1.1 Who is who

| Role (word used below) | Meaning | Where the screen works it out | Where the database enforces it |
|---|---|---|---|
| Reader | May open the project's details: an active member of the project, or a founder of the project's company. **Phase 2B (merged as PR #86, migration `20270102000100` not applied by Claude):** also an Operations Manager of the company, who manages nothing ([`operations.md`](./operations.md) section 2) | `loadProjectView` (`L/projects/data.ts`): `projectViewLevel` must be `details`; `canViewProjectDetails` (`domain`) | `proj_can_view_details` (`SQL-core`); the select policy `<table>_select` on `proj_milestones`, `proj_deliverables`, `proj_tasks`, `proj_task_collaborators`, `proj_task_dependencies`, `proj_task_events`, `proj_task_comments`, `proj_change_log` is `using (proj_can_view_details(project_id))` (`SQL-core`, the `do $$` loop) |
| Manager | The Project Manager, a temporary project leader whose date has not passed, or a founder of the project's company | `view.canManage` = `canManageProject(standing)` (`domain`, `L/projects/data.ts`) | `proj_can_manage` (`SQL-core`: `proj_is_founder` or `proj_is_pm`, the latter includes an unexpired `acting_pm` membership); `proj_require_manager` (`SQL-base`) |
| Head | Head of the department team the task or deliverable belongs to | `standing.headOfTeamIds` (teams whose `head_user_id` is the viewer), `view.headOfTeamIds` | `proj_is_team_head` (`SQL-core`: active profile, team not removed, still an active member) |
| Assignee | The task's one accountable person, while still a member | `taskActorRole` (`domain`) | `proj_task_actor_role` (`SQL-D`) |
| Named unblocker | The person recorded on a blocked task as responsible for unblocking it | `task.unblock_owner_id` (`T/task-detail-data.ts`: `canUnblock`) | `proj_unblock_task` (`SQL-D`) |

A person's part in one task is exactly one of `manager`, `head`, `assignee` or none, in that order of precedence (`taskActorRole`, mirrored by `proj_task_actor_role`). A Manager who is also the assignee is `manager`; this matters for the review flow (section 10).

### 1.2 Shared behaviour

| Rule | What happens | Source |
|---|---|---|
| No Projects access at all | The Projects shell shows "You do not have Projects access. It is granted per company by the founders." and no page of this file is rendered | `apps/web/src/app/(app)/projects/layout.tsx` |
| Projects not installed in the environment | "Projects & Tasks is not installed in this environment yet. The database changes it needs have not been applied here, so nothing is shown." | same |
| Project absent or not visible | Not found (the two cases are not told apart) | `loadProjectView` returns null; `notFound()` in `W/page.tsx`, `W/tasks/[taskId]/page.tsx` |
| Summary-only viewer (Projects access but not on the project, or a linked Sales person) | Redirected to `/projects/[id]`, which shows the Summary panel; no task, milestone or deliverable is sent | `W/page.tsx` (`view.level !== "details"`), `apps/web/src/app/(app)/projects/[id]/page.tsx` |
| Project could not be read | The project layout shows "Could not load this project. This is a problem loading the information, not an empty list. Try again" | `apps/web/src/app/(app)/projects/[id]/layout.tsx`, `C/workspace/states.tsx` (`LoadError`). What the page slot itself renders in that case (the shared error boundary `apps/web/src/app/(app)/error.tsx`): `Unverified` |
| Finished project (`completed` or `archived`) | Everything in this file is read-only: no Add task, no Plan menu, no status, assignee or due controls, no More menu, no comment form. The page says "This project is {status}. Its plan is read-only; a founder can reopen it from History." | `isFinishedProject` in `W/page.tsx`, `T/task-logic.ts` (`buildTaskRow`), `T/task-detail-data.ts`; database: `proj_require_open_project` (`SQL-D`) raises "A completed project is read-only. Reopen it first" in every write function except `proj_comment_task` (see section 14) |
| Version check | Task status, task edit, due date, milestone edit and deliverable edit send the version the person loaded. The server action compares it first and answers "This task was changed by someone else. Reload the page to see the latest version, then make your change again." (or "This milestone ...", "This deliverable ..."); the function repeats the check (`proj_check_version`: "This was changed by someone else. Reload and try again") | `staleMessage` (`L/projects/action-utils.ts`), `proj_check_version` (`SQL-base`) |
| Error wording | Database messages are shown as written, except: a timeout becomes "The save did not finish in time. Reload the page to see whether it went through, then try again if it did not."; a permission or row-level-security refusal becomes "You are not allowed to do that."; a constraint or bad value becomes "One of the values is not allowed. Check the form and try again."; a duplicate becomes "That already exists."; a missing table or function becomes "Projects & Tasks is not installed in this environment yet." | `friendlyProjectError` (`L/projects/errors.ts`) |
| Forms | Every dialog form shows the refusal in a red alert above its button, keeps what was typed, disables the button while saving ("Saving…" unless stated), and closes the dialog on success. A form that stays on screen shows "Saved" for four seconds | `C/sales/action-form.tsx` (`ActionForm`) |
| Unsaved edits | Closing the side panel, opening another task or "Full page" with unsaved typing asks "You have changes that are not saved. Leave without saving them?" | `C/workspace/unsaved.ts`, `C/workspace/side-panel.tsx`, `C/workspace/board.tsx` |
| After any save | The Projects pages are revalidated (`/projects` layout and the project's layout), so lists, counts and the open task refresh | `refreshProjects` (`L/projects/action-utils.ts`) |
| Dates | Task, milestone and deliverable dates are plain dates (no time zone). "Today" is `todayIso()` from `L/projects/format.ts` (its time zone was not read: `Unverified`). The week is Monday to Sunday (`L/projects/week.ts`) | as cited |

## 2. Work page: route, access, data and banners

**How to reach it.** Projects (`/projects`), choose a project: members and founders land on `/projects/[id]/work` (`/projects/[id]` redirects there). It is the first tab, "Work" (`L/projects/workspace-nav.ts`). Notices, "What needs doing" lines, Recent activity and the legacy "Jump to a task…" picker link into it with `?task=<id>`.

**Who can see it.** A Reader (section 1.1). Enforced by the page (`W/page.tsx`) and by row-level security on every table it reads.

**Purpose.** One page for the project's work: what needs the viewer first, then one task list (Table or Board), the review queue, the milestones, and the milestones and deliverables section; a right rail with recent changes, shortcuts and the project's details. The address holds every choice (search, filters, view, grouping, sort, columns, open task), so it can be shared and Back works. `RememberList section="tasks-<id>"` stores the list address so the full task page's back link can return to it (`C/workspace/list-memory.tsx`).

**Reads (all with the viewer's own session).** `proj_milestones`, `proj_deliverables`, `proj_tasks`, `proj_milestone_progress` (function), `proj_feedback`, `proj_site_bookings`, `proj_completions`, `proj_plan_outdated` (Manager on a client project only), the equipment state (`L/projects/equipment-state.ts`: `inv_requests`, `inv_import_log`), the four newest `proj_change_log` rows that are not messages, `proj_external_dependencies`, `proj_plan_items`.

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| Loading state | While the page loads | Reader | none | Skeleton rows (`role="status"`, label "Loading") | | `W/loading.tsx`, `C/workspace/states.tsx` | none found |
| Failed read of the page | The milestones, deliverables, tasks or completions read failed | Reader | none | | "Could not load this project's work. This is a problem loading the information, not an empty list. Try again" (the link reloads the same address) | `W/page.tsx` (`LoadError`) | `L/projects/load-errors.test.ts` (what it asserts about this page was not re-read: `Unverified`) |
| Read-only note | Project `completed` or `archived` | Reader | none | "This project is {status}. Its plan is read-only; a founder can reopen it from History." (the raw status word is shown) | | `W/page.tsx` | none found |
| "On hold" banner | Project status `on_hold` | Reader | none | "On hold: {reason}" and "Review date {date}", with ", which has passed: decide whether to resume it." or ", which is today." when so | | `W/page.tsx`, `holdReviewState` (`apps/web/src/app/(app)/projects/[id]/overview-helpers.ts`) | `overview-helpers.test.ts` (not re-read) |
| Client timeline warning, link "Files & client plan" | Manager, client project, `proj_plan_outdated` returned true | Manager | none | "The issued client timeline is out of date: the client-facing plan has changed since it was issued. Issue a new version from Files & client plan." Link opens `/projects/[id]/documents` | A failed `proj_plan_outdated` read shows nothing (see section 14) | `W/page.tsx` | none found |
| Reopened note, link "History" | A completion record exists that was reopened and no current one | Reader | none | "This project was completed and then reopened. The earlier completion record is kept on the History page." | | `W/page.tsx` | none found |
| "Completion" panel | A completion record that was not reopened exists | Reader | none | Read-only facts: Completed, Evidence, Reference, Client confirmed on, Confirmed by, Left unfinished, and the completion note. Description: "Recorded when the project was completed. Read-only." | | `W/page.tsx` | none found |

## 3. Top of the Work page: What needs doing, Delivery summary, summary cards

> **Phase 2 (draft PR, migration `20270106000100`, not applied by Claude):** The Work page opens with Next on site, Needs attention and Recent changes (S 7); the four-line Recent activity no longer repeats output and site records. The task panel (section 8) gains Expected output, Submit output, Review and Version history (S 3, S 4); `proj_set_task_status` now refuses a required output that is missing. See [`projects-phase-2-deliverables-and-site.md`](./projects-phase-2-deliverables-and-site.md) (reference S) and `docs/projects-phase-2-scope.md`.


**How to reach it.** The first things in the main column of `/projects/[id]/work`, on a phone too. **Who.** Reader; Delivery summary and the import control only for a Manager. Hidden on a finished project (What needs doing, Delivery summary). **Purpose.** Say what needs the viewer and what is waiting on someone else, from recorded facts only.

### 3.1 What goes in "What needs doing" (`workAttention`, `L/projects/work-attention.ts`)

Only open tasks (To do, In progress, Ready for review) are considered. Order inside each list: Blocked, Review, Overdue, Due today, Milestone overdue, equipment lines, In review; within a kind by due date then title (equipment lines keep the order failed import, drafts, waiting). At most five lines per list are shown; then "Showing 5 of N. The task list below has the rest."

| Line label | Fact behind it | Under "Needs you" for | Under "Waiting on someone else" for | Owner text | Detail text |
|---|---|---|---|---|---|
| Blocked | An open task with a blocker | The named unblocker; when nobody is named, a Manager | Everyone else | "You", the unblocker's name, "You (no one is named, so it falls to the Project Manager)" or "No one named; {PM name} manages the project" | "Reason: {reason}" or "No reason recorded", then "To clear it: {action}" when one was written |
| Review | A task in the viewer's review queue (section 6) | The reviewer | not listed | "You" | "Done by {assignee}. Accept it or send it back." |
| Overdue / Due today | The viewer's own open task, not blocked, not in review, due before today or today | The assignee | not listed | "You" | none |
| In review | The viewer's own task in Ready for review, not blocked | not listed | The assignee | "A reviewer (the department head or the Project Manager)" | "You sent it for review." |
| Milestone overdue | A milestone in Planned, In progress or Ready for acceptance whose due date has passed | A Manager | Everyone else (owner: PM name) | "You" or the PM's name | none |
| Import failed — review | The newest row of `inv_import_log` for the project has outcome `failed` and no handover request (source `sales_handover`, not cancelled) exists | A Manager only (others get no line) | not listed | "You" | The log's detail, or "No reason was recorded." Title: "The handover equipment was not imported" |
| Equipment draft needs submission | An equipment request in `draft` | A Manager | Everyone else (owner: PM name) | as above | "The warehouse does not see a draft. Review the list and submit it on the Equipment page." Title: "Request {code}" |
| Waiting for Warehouse | An equipment request in `submitted` | not listed | Everyone | "Warehouse" | "Submitted. The warehouse has not started preparing it." |

Each line also shows "Owner: {owner} · Due {date}" or "Owner: {owner} · No due date recorded". The label is always a word next to the colour.

### 3.2 Controls

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "What needs doing" card with "Needs you (N)" and "Waiting on someone else (N)" | Project not finished and at least one line exists | Reader | none | Each title is a link: a task line opens the task side panel on the same address (`?task=<id>`), a milestone line opens `?ms=1#milestone-list`, an equipment line opens `/projects/[id]/equipment` (with `?request=<id>` for a request) | An empty list says "Nothing needs you right now." or "Nothing is waiting on anyone else." | `C/projects/work-parts.tsx` (`WorkAttention`), `L/projects/work-attention.ts`, `W/page.tsx` | `L/projects/work-attention.test.ts` |
| Empty "What needs doing" | Both lists empty | Reader | none | "Nothing needs you right now. No blocker, review, overdue task or equipment decision is recorded for this project." | | `WorkAttention` | `work-attention.test.ts` (render itself `Unverified`) |
| "Import the handover equipment" | Under the "Import failed — review" line only | Manager | none | Runs the existing import again (`importHandover` -> `inv_import_handover_requirements`); the button shows "Importing…". The action's own result text: "The equipment of the handover is in its request (see Requests below). Running the import again never adds a second one." or "Nothing could be imported. The reason is in the import log below." | The action's error text. The function's rules belong to the Inventory planning reference and were not read here: `Unverified` | `C/inventory/planning/import-handover.tsx`, `L/actions/inventoryPlanning.ts` (`importHandover`) | not re-read |
| Equipment state warning, link "Equipment" | The equipment read failed, project not finished | Reader | none | "Could not load this project's equipment state, so an equipment decision may be missing above. Open Equipment or reload." | This is the failed-read state | `W/page.tsx`, `L/projects/equipment-state.ts` | `work-attention.test.ts` ("never hides a failed read") |
| "Delivery summary": "Next milestone", "Next site booking", "Equipment" with links "Open Timeline", "Open the booking" / "Open site bookings", "Open Equipment" | Manager, project not finished | Manager | none | Next milestone: the earliest dated milestone in Planned, In progress or Ready for acceptance, with "Overdue · " before the date when past; otherwise "No milestone yet" or "No dated milestone open". Next site booking: location, start in the booking's time zone, who, "Confirmed" or "Tentative"; otherwise "None booked". Equipment: one of "Import failed — review", "Equipment draft needs submission", "{n} equipment drafts need submission", "Waiting for Warehouse", "No equipment request yet", "No decision waiting", "Not available to you here" | "Could not load the site bookings" (red) when that read failed; "Could not load the equipment state" (red) when that read failed | `C/projects/work-parts.tsx` (`DeliverySummary`), `equipmentSummary` (`L/projects/work-attention.ts`), `W/page.tsx` | `work-attention.test.ts` (equipment line) |
| Card "Open task" / "Open tasks" | Always | Reader | none | Opens the whole task list (`tasks=all`, every filter cleared). The number counts To do, In progress and Ready for review tasks. The card is marked active when `tasks=all` and no filter is on | | `W/page.tsx`, `C/os/stat-card.tsx` | none found |
| Card "Need attention" | Always | Reader | none | Narrows the list to open tasks that are blocked or overdue (`show=attention`). The chip reads "Narrow to: attention" because that value has no entry in the filter's own options | | `W/page.tsx`, `needsAttention` (`W/helpers.ts`) | `W/helpers.test.ts` ("This week and needs attention") |
| Card "In review" | Always | Reader | none | Narrows the list to status Ready for review (`status=ready_for_review`); chip "Show: Ready for review" | | `W/page.tsx` | none found |

**Phone and desktop.** The order is the same on both. The two attention lists sit side by side from the large breakpoint and stack below it. The three cards stay in one row; their icons are hidden on a phone.

### 3.3 Phase 2B: equipment readiness, Review equipment booking, equipment still out, the event edition

Added by PR #86 (2026-11-12; merged, merge `5b75ade`; migration `20270102000100_ops_phase2b.sql` not applied by Claude, on hosted treated as applied from the owner's reports of 2026-11-12, not checked by Claude; code read only, not seen signed in). Full reference: [`operations.md`](./operations.md) sections 8.1 and 9. Coverage index rows 250, 255 and 257.

| What | Where | Who | Behaviour | Source |
|---|---|---|---|---|
| **Review equipment booking** line in What needs doing | One line per request with an open review, title "Request <code>", detail "<date name>: was <old> · now <new>. The booking has not been changed.", link to the Equipment tab (`#equipment-review`) | Under "needs you" for a Manager, otherwise under waiting on the Project Manager | Appears after a committed date (installation start, event start, event end) changed while the request was with the warehouse; leaves when the review is marked as reviewed on the Equipment tab | `L/projects/work-attention.ts` (`workAttention`, `equipmentReviews`); `work-attention.test.ts` |
| Delivery summary, **Equipment** | The equipment line | Manager, project not finished | Order of precedence: a failed import ("Import failed — review"), then drafts to submit, then the readiness the database states for the requests with the warehouse (one request: its state and counts; several: a count per state and "N requests with the warehouse"), with "Review equipment booking" added to the detail when a review is open. A failed readiness read reads "Equipment readiness could not be loaded" and is never shown as nothing waiting | `equipmentSummary`, `readinessSummary` (`L/projects/equipment-readiness-model.ts`) |
| Warning when readiness could not be read | Above the cards | Readers | "Equipment readiness could not be loaded, so what is reserved, short or still out is not shown here. Open Equipment or reload." | `work/page.tsx` |
| **Delivery complete · equipment still out** | On a completed or archived project with units out | Readers | Per request: units out, expected back, overdue; "Completing a project does not return equipment: it stays outstanding until the warehouse records its return."; link **Open Equipment** | `StillOutNotice`; `stillOutAfterDelivery` |
| **Event edition** on the details card | Project details card, when the project has an edition | Readers | The label, "Venue: ...", "Published show dates: ...", the note "These are the dates the organiser published when the handover was submitted. Later changes to the event in Sales do not change this project." and **Open event in Sales**, offered only when the viewer's own session can read the edition in Sales (to `/sales/events/<event>?edition=<edition>`); when that check fails: "Could not check whether you can open this event in Sales. Reload to try again." Kept apart from the project's own delivery dates | `work/details-card.tsx`; `work/page.tsx`; `details-card.test.tsx` |

## 4. The task list (card "This week" / "Tasks")

**How to reach it.** Main column of the Work page, under the summary cards. **Who.** Reader. **Purpose.** One list of the project's tasks with two views of the same rows.

**This week mode.** With no filter, no `tasks=all`, Table view and no grouping, the card is titled "This week" and shows at most six tasks: open tasks due by the end of this week (so overdue ones too) or needing attention (blocked or overdue), in the chosen sort. Undated tasks are not in it. In every other case the card is titled "Tasks" and shows the rows the filters allow. The default "Show" filter is "Open tasks", so the full list still leaves out Done, Cancelled and Deferred until "Show" is set to "All tasks" or one status (`parseTaskFilters`, `filterTasks` in `W/helpers.ts`).

### 4.1 Header, toolbar and footer

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| Badge "{n} due this week" | Always | Reader | none | Returns to This week mode: clears search, every filter, view, grouping and `tasks`. The number counts open tasks due Monday to Sunday of this week | | `W/page.tsx` (`weekHref`), `L/projects/week.ts` | `W/helpers.test.ts` |
| "Back to this week" | Not in This week mode and one of: `tasks=all`, a filter, Board, a grouping | Reader | none | Same as the badge | | `W/page.tsx` | none found |
| "Plan" menu: "Add milestone" (hint "A point the project is accepted against"), "Add deliverable" (hint "A piece of work for one department team") | Manager, project not finished. In the card header when the project has tasks; inside the empty state when it has none | Manager | see section 7 | Opens the "New milestone" or "New deliverable" dialog | | `W/plan-add-menu.tsx`, `C/workspace/more-menu.tsx` | none found |
| "Add task" | Project not finished and the viewer may assign to at least one person (always at least themself for a member). Same two places as "Plan" | see section 5 | see section 5 | Opens the "Add task" dialog | | `C/workspace/quick-add.tsx`, `T/quick-add-task.tsx` | `W/helpers.test.ts` ("new task options", "quickAssigneeChoices") |
| Search box (placeholder "Search tasks") | Always | Reader | Up to 100 characters | Applied 300 ms after typing stops (`q`). Matches the title and the description, ignoring case. Shown as chip "Search: {text}" | | `C/os/filter-bar.tsx`, `filterTasks` | `W/helpers.test.ts` |
| "Filters" button (with a count of filters in use) | Always | Reader | none | Opens the filter panel in place; each filter applies as it is chosen. Two filters changed quickly are both kept | | `C/os/filter-bar.tsx` | none found for the component |
| Filter "Show" | In the panel | Reader | "Open tasks" (default), "All tasks", "To do", "In progress", "Ready for review", "Done", "Cancelled", "Deferred" | `status` in the address; chip "Show: {choice}" | An unknown value in the address is read as "Open tasks" | `W/page.tsx` (`toolbarFilters`), `parseTaskFilters` | `W/helpers.test.ts` ("parseTaskFilters") |
| Filter "Assignee" | In the panel | Reader | "Anyone" or one active member of the project | `assignee` | A value that is not an id is ignored | same | same |
| Filter "Department" | The project has at least one department team | Reader | "Any department" or a team | `team` | | same | same |
| Filter "Deliverable" | The project has at least one deliverable | Reader | "Any deliverable" or a deliverable | `deliverable` | | same | same |
| Filter "Narrow to" | In the panel | Reader | "Everything", "My tasks" (assigned to the viewer), "Overdue" (open and due before today), "Blocked" | `show`. Old addresses with `mine=1`, `overdue=1`, `blocked=1` still work | | same; `SHOW_CHOICES`, `showChoiceOf` | same |
| Filter "Group by" | Table view only | Reader | "No grouping", "Department", "Milestone", "Status", "Assignee" | `group`. Groups are collapsible blocks, open by default, headed by the group's name and "{n} task(s)". Catch-all groups come last: "No department", "Unlinked" ("Not linked to any milestone"), "Unassigned". A task belongs to a milestone through its own milestone, else its deliverable's. A milestone group also shows its status, "due {date}", "Optional" when so, and a "Deliverables" list (title, status, department or "No department", "{open} open of {total}" or "no tasks yet") | Grouping is ignored in Board view | `W/page.tsx` (`GroupBlock`), `groupTaskRows` (`T/task-logic.ts`) | `T/task-logic.test.ts` (grouping) |
| Chips with a remove control ("Remove filter: {name}") and "Clear all" | A search or filter is on ("Clear all" only when a filter other than Group by is on) | Reader | none | Removes that one choice, or all of search, Show, Assignee, Department, Deliverable and Narrow to | | `C/os/filter-bar.tsx`, `W/page.tsx` (`clearHref`, `hasActiveFilters`) | none found |
| View switch "Table" / "Board" | Always | Reader | none | Plain links; `view=board` or none. Filters carry over | | `C/workspace/view-switch.tsx` | browser flow `apps/web/os-shell-checks/projects-workspace.mjs` (local stack only, not run) |
| Footer text | The list has rows | Reader | none | This week: "Showing {x} of {y} due this week, overdue or blocked · {n} open". Otherwise: "{x} shown of {N} task(s) · {n} open" | | `W/page.tsx` | none found |
| "Columns" menu ("Show columns": "Priority", "Department", "Milestone", "Deliverable") | Table view, the list has rows | Reader | Tick boxes; none is on by default | `cols` in the address; only the chosen columns are rendered | | `C/workspace/columns-menu.tsx`, `TASK_COLUMNS` (`T/task-logic.ts`) | `projects-workspace.mjs` (not run) |
| "View all tasks ({N})" | In the footer in This week mode when the project has more tasks than are listed; in the empty state when no filter is on | Reader | none | Leaves This week mode (`tasks=all`, filters cleared). N counts every task of the project, finished ones included; the list it opens still applies "Show: Open tasks" | | `W/page.tsx` (`viewAll`, `allHref`) | none found |
| Empty state "No tasks yet" | The project has no task | Reader | none | "Add the first task. Department heads give deliverables out as tasks; any member can add one for themself." (without the first sentence for someone who cannot add). "Plan", "Add task" and "View all tasks (0)" are shown here | | `W/page.tsx` (`emptyList`) | none found |
| Empty state "Nothing due this week" | This week mode with no matching task | Reader | none | "No open task is due this week, overdue or blocked." with "View all tasks ({N})" | | same | none found |
| Empty state "No tasks match" with "Clear filters" | Filters or `tasks=all` leave no row | Reader | none | "Clear the filters, or open all tasks to include finished ones." | | same | none found |

### 4.2 Table view

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| Column headings "Task", "Assignee", "Due", "Status", and "Priority" when shown | Table view | Reader | none | Sort by that column (`sort`); a second click reverses it. Default: Due, earliest first, undated last. Ties fall back to due date then title. "Department", "Milestone" and "Deliverable" are not sortable | | `T/task-table.tsx`, `sortTaskRows`, `parseTaskSort` (`T/task-logic.ts`), `C/workspace/sort-head.tsx` | `T/task-logic.test.ts`; `projects-workspace.mjs` (not run) |
| Task title (link) and the row itself | Each row | Reader | none | Opens the task side panel beside the list (`?task=<id>`); the list keeps its filters, sort and scroll. The open row is marked selected | Unsaved typing in an open panel asks first (section 1.2) | `T/task-table.tsx`, `C/workspace/clickable-row.tsx`, `C/workspace/panel-link.tsx` | `projects-workspace.mjs` (not run) |
| Flags under the title: "Blocked", "Needs review", priority | When blocked, when the task needs review, when priority is not Normal | Reader | none | Read-only words | | `TaskFlags` (`T/task-table.tsx`), `C/projects/badges.tsx` | none found |
| Assignee cell: menu "Assignee of {title}" | Head of the task's team or a Manager, open task, more than one person to choose from. Everyone else sees the name | Head, Manager | Choose a person: a Manager from all members; a Head from the people of the task's team and themself | Saved at once (`reassignProjectTask`), "Saving…" while it runs; the new assignee is told | The reason is written under the cell, the old value stays. See section 9.3 for messages | `TaskAssigneeControl` (`T/task-controls.tsx`), `buildTaskRow` (`reassignOptions`), `C/os/choice-menu.tsx` | `T/task-logic.test.ts` ("lets the head of the task's team reassign within the team, and the PM anyone") |
| Due cell: date text and a pencil button ("Change due date of {title}") | Text for everyone: the date, "{date} · overdue by {n} day(s)" in red, "{date} · due today", or "No due date". The pencil for Assignee, Head or Manager on an open task | Assignee, Head, Manager | see section 9.2 | Opens the "Change due date" dialog | | `TaskDueControl` (`T/task-controls.tsx`) | `T/task-logic.test.ts` ("states due dates as plain dates") |
| Status cell: menu "Status of {title}" | A menu for anyone who has at least one move (section 10); otherwise the status as a badge | Assignee, Head, Manager per section 10 | Choose a move. Moves ending in "…" open a small form first | A plain move is saved at once; the others open the dialog of section 9.1 | The reason is written under the cell. A lost connection: "The change could not be saved. Check your connection and try again." | `TaskStatusControl` (`T/task-controls.tsx`), `taskMoveSpecs`, `moveMode` (`T/task-logic.ts`) | `T/task-logic.test.ts` ("moveMode", "what a viewer may change on a row") |
| Optional cells "Priority", "Department" ("None"), "Milestone" ("Unlinked"), "Deliverable" ("None") | When chosen in Columns | Reader | none | Read-only | | `T/task-table.tsx` | none found |

### 4.3 Board view

Columns: "To do", "In progress", "Ready for review", "Done" (`BOARD_COLUMNS`). Deferred and cancelled tasks are not on the board; a line below says "{n} deferred or cancelled task(s) is/are not on the board. Switch to Table to see it/them." Blocked is a flag on the card, never a column. The board shows every row the filters allow (the six-row This week cap does not apply, because Board is never This week mode).

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| Card (title link, flags, assignee, due text) | Each task on the board | Reader | none | A click on the title or the empty part of the card opens the task side panel; Ctrl or Cmd click opens it in a new tab | | `T/task-board.tsx`, `C/workspace/board.tsx` | `projects-workspace.mjs` (not run) |
| Drag a card to another column | The viewer has at least one move to a board column | Assignee, Head, Manager per section 10 | Drop on the target column | The card stays put and dims while saving; it changes column only after the server accepted the move. A move that needs a reason or a decision opens the dialog of section 9.1 (titled with the move's label) instead of saving. When two moves lead to the same column, the one that needs no reason is used | Dropped on a column the person has no move to: "That move is not available from here." (or the card's locked reason). Refused by the server: the server's message under the card. Lost connection: "The move could not be saved. Check your connection and try again." A move the rules do not contain: "You can't move this task there." | `C/workspace/board.tsx` (`request`), `T/task-board-client.tsx` (`onMove`), `boardTargets`, `moveFor` (`T/task-logic.ts`) | `T/task-logic.test.ts` ("board") |
| "Move to… (now {column})" select on each card | Same condition as dragging | same | Choose a column | Same as a drop. Works with a keyboard and on a phone | same | `C/workspace/board.tsx` | same |
| Locked card text | The viewer has no move to a board column | Reader | none | "You can't change this task's status." (no move at all) or "Open the task to defer or cancel it." (only Defer and Cancel are available) | | `T/task-board-client.tsx` | none found |
| Empty column | A column has no card | Reader | none | "No tasks" | | `T/task-board-client.tsx` | none found |

**Phone and desktop (task list).** Below the medium breakpoint each table row becomes a small card: the title first, then "Assignee", "Due", "Status" (and chosen columns) as labelled lines, with the same controls (`C/workspace/list-table.ts`). The search box takes the full width under the Filters button and view switch. The board scrolls sideways; dragging is a mouse convenience, so on a phone use the "Move to…" select on the card. The task panel covers the whole screen on a phone and is a column on the right from the large breakpoint (`C/workspace/side-panel.tsx`).

## 5. "Add task" dialog

**How to reach it.** "Add task" in the task card header (or in the empty state). The dialog also opens when the address carries `?add=1` (`C/workspace/quick-add.tsx`). Title "Add task", description "Three fields are enough. Add more details only if you need them."

**Who can use it and for whom** (`newTaskOptions`, `quickAssigneeChoices` in `W/helpers.ts`; `canCreateTaskFor` in `domain`; enforced by `proj_create_task`, `SQL-D`):

| Viewer | May assign to | Department of the task | "Needs review" |
|---|---|---|---|
| Manager | Any active member | None unless chosen under "Add more details" (or taken from the deliverable) | May tick it |
| Head of a team | People in that team, or themself | That team when assigning to a team member; own team or none for themself | May tick it (the function honours it only when the task lands in a team the person heads, or for a Manager; otherwise it is stored as not needing review) |
| Any other member | Themself only (hint: "You can add tasks for yourself. Your department head or the Project Manager assigns work to others.") | Own team or none | Not offered; always stored as not needing review |
| Founder not on the project | A Manager by rule; the assignee must still be an active member | as Manager | as Manager |

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "What needs doing" | Always | as above | Required, up to 200 characters | Becomes the title | "Give the task a title" | `T/quick-add-task.tsx`, `createProjectTask` (`L/actions/projectsDelivery.ts`) | `W/helpers.test.ts` |
| "Assignee" | Always | as above | Required; defaults to the viewer when allowed | | "The assignee must be an active member of the project"; "You can create tasks for yourself. Ask your department head or the Project Manager to assign work to others"; "A department head assigns tasks to people in their own team" | same; `proj_create_task` | `packages/rls-tests/test/projects.rls.test.ts` (member creates for themself only; head distributes inside the team) |
| "Due" | Always | as above | Optional date; cannot be earlier than the start date in the browser (hint "The due date cannot be before the start date.") | | The function does not check start against due on create (it does on edit): `proj_create_task` | same | none found |
| "Add more details" (closed by default) | Always | as above | Opens the fields below | | | `C/workspace/quick-add.tsx` (`MoreDetails`) | none |
| "Description (optional)" | Under more details | as above | Free text | | | `T/quick-add-task.tsx` | none |
| "Department team" ("Automatic" or a team; hint "Leave as automatic unless the task belongs to a department.") | The viewer has at least one team to offer | as above | Optional. Choosing a team changes the people and deliverables offered to that team's | | "Unknown department team"; "You can only add tasks to your own department" | same; `proj_create_task` | `W/helpers.test.ts` |
| "Deliverable" ("Not part of a deliverable" or one) | Under more details | as above | Optional. Only live deliverables (not accepted, not cancelled) the rules allow for the chosen team | A task with no team or milestone of its own takes the deliverable's | "Unknown deliverable" | same | `W/helpers.test.ts` |
| "Milestone" ("Not linked to a milestone" or one) | Under more details | as above | Optional; cancelled milestones are not offered | | "Unknown milestone" | same | none |
| "Start date" | Under more details | as above | Optional date | | | same | none |
| "Priority" | Under more details | as above | "Low", "Normal" (default), "High", "Urgent" | | | same | none |
| "Needs review" (tick box; "The assignee sends it for review; a department head or the Project Manager accepts it. Without this, the owner completes it.") | Manager, or head of any team of the project | Manager, Head | Optional | | | same | `projects.rls.test.ts` (review rule) |
| "Depends on (optional)" (hint "Hold Ctrl or Cmd to pick several. A dependency never moves anyone's dates.") | The project has open tasks | as above | Zero or more open tasks of this project | Rows in `proj_task_dependencies` | "A task cannot depend on itself"; "A dependency must be a task of the same project"; "That dependency would create a loop between tasks" | same; `proj_set_task_dependencies` (`SQL-D`) | none found |
| "Collaborators (optional)" (hint "One person is accountable (the assignee). Collaborators help.") | The project has members | as above | Zero or more members | Rows in `proj_task_collaborators` (the assignee is never stored as a collaborator) | "Collaborators must be active members of the project" | same; `proj_set_task_collaborators` (`SQL-D`) | none found |
| "Add task" (submit) | Always | as above | | The dialog closes, the list refreshes. History line "Created and assigned to {name}." An assignee who is not the creator is told (section 12) | Finished project: "A completed project is read-only. Reopen it first". Not a Reader: "Project not found" | `createProjectTask` -> `proj_create_task` | `projects.rls.test.ts` |

**Phone and desktop.** Same dialog. The two multi-select lists ("Depends on", "Collaborators") are native lists: the Ctrl or Cmd hint applies to a keyboard; on a phone the browser's own multi-select picker is used (`Unverified`: not seen on a device).

## 6. Review queue, milestone strip, right rail

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| Panel "Waiting for your review ({n})", description "Tasks sent for review that you may accept or send back. You never review your own work." Each row: title link, "Done by {assignee} · {due text}", button "Review" | Project not finished and the viewer's review queue is not empty. The queue is every task in Ready for review, not assigned to the viewer, where the viewer is a Manager or head of the task's team; ordered by due date, priority, title | Head, Manager | none | Title and "Review" open the task side panel, where the main buttons are "Accept and complete" and "Request changes" | | `W/page.tsx`, `reviewQueue` (`W/helpers.ts`) | `W/helpers.test.ts` ("review queue") |
| "Upcoming milestones" strip, link "Manage milestones" or "View all {n}" | The project has two or more milestones that are not cancelled or deferred. Up to six steps are drawn, keeping the next open one in view | Reader | none | Each step: title, "Overdue · " before the date when late, the date or "No date", the status, " · optional". The header shows the progress sentence and percentage, or "No required milestone yet". The link opens the milestones section (`?ms=1#milestone-list`) | | `MilestoneStrip` (`C/projects/work-parts.tsx`), `stripSteps` (`W/helpers.ts`) | `W/helpers.test.ts` ("milestone strip") |
| Single milestone row "Milestone · {title}", link "Manage milestones" | Exactly one such milestone | Reader | none | Same facts on one line | | same | same |
| "Next on site" card, link "Open site plan" or "View all {n} site bookings" | An upcoming booking (tentative or confirmed, not ended) exists and the viewer is not a Manager of a live project (a Manager has the Delivery summary instead) | Reader | none | Location, start in the booking's time zone, who, "Confirmed" or "Tentative"; link to `/projects/[id]/plan?plan=site` | A failed bookings read hides the card (section 14) | `NextOnSiteCard` (`C/projects/work-parts.tsx`), `W/page.tsx` | none found |
| "Recent activity" with "Full history" | Always | Reader | none | The four newest lines of the member-visible change log (not chat messages, not task comments): a subject link to where the record lives (milestone or deliverable: the milestones section; timeline item: Timeline; dependency or booking: the site plan; member: People; otherwise History), a sentence, and "{who} · {when}" ("Recorded by the system" when there is no actor). Empty: "No change to dates, status or people is recorded yet." | "Could not load the recent activity. Reload to try again; the full record is on History." | `RecentActivity` (`C/projects/work-parts.tsx`), `W/page.tsx`, `describeChange` (`apps/web/src/app/(app)/projects/[id]/history/change-log.ts`) | none found for this card |
| "Go to": "Files & client plan", "Timeline", "Dependencies", "Site bookings" | "Files & client plan" on a client project (note "The issued client timeline is out of date." or "Project files and the client-facing plan."); "Timeline" always (note "Next milestone: {title}, {date}." or "Dates, activities and milestones."); "Dependencies" when at least one external dependency is not confirmed ("{n} not confirmed yet (waiting on another party)."); "Site bookings" when at least one is upcoming ("{n} upcoming.") | Reader | none | Opens that screen | A failed dependencies or bookings read hides the entry (section 14) | `WorkShortcuts` (`C/projects/work-parts.tsx`), `W/page.tsx` | none found |
| "Project details" (collapsible): "Project Manager" (with "Temporary leader: ..."), "Team" ("No department team yet"; "{n} people on the project"), "Project dates", "Installation starts", "Event", "Client" (client projects; "Not recorded"), "Location" ("Site time zone {tz}"), "Client feedback" link "{n} open item(s)" | The project has a details row | Reader | none | Read-only. The feedback link opens `/projects/[id]/changes` and appears only when at least one item is open or in progress | A failed feedback read hides the feedback line (section 14) | `W/details-card.tsx`, `W/page.tsx` | none found |
| "Agreed scope" ("Scope" on an internal project): "Scope of work", "Exclusions", "Technologies" | same | Reader | none | Read-only. Client projects: "As handed over from Sales. It changes only through a recorded scope change (Manage project, Feedback & changes), which keeps the original." Empty values: "Not recorded.", "None recorded." | | `W/details-card.tsx` | none found |

**Phone and desktop.** The right rail is a second column from the extra-large breakpoint and falls below the main column on anything narrower. "Project details" and the scope card are folded on a phone and a narrow window and open where there is room (`C/os/collapsible.tsx`, per the comment in `W/details-card.tsx`; the component was not read: `Unverified`). The milestone strip is a vertical list on a phone.

## 7. "Milestones & deliverables" section

**How to reach it.** The collapsible block under the two columns of the Work page, headed "Milestones & deliverables ({n} milestone(s), {n} deliverable(s))" with the progress sentence or "No required milestone set yet". It opens by itself when the project has no milestone or the address has `ms=1` ("Manage milestones", an overdue-milestone line, a Recent activity link). **Who.** Reader to see; changes as below. **Purpose.** Define what the project is accepted against (milestones, the Manager's) and the pieces of work given to departments (deliverables).

Progress: "Progress: {basis}. Optional milestones and cancelled or deferred ones are not counted." from `proj_milestone_progress` (accepted required milestones over required milestones that are not cancelled or deferred; `milestoneProgress` in `packages/domain`, wording not re-read). With none: "Progress is shown only from accepted required milestones. No required milestone is set yet."

### 7.1 Milestones

Each row: title, status badge, "Required" or "Optional", "Can appear on client timeline" when so, the description, the due text (red when overdue), and "accepted {when} by {who}" when accepted.

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| Empty state "No milestones yet" | No milestone | Reader | none | Manager: "Add the points the Project Manager accepts as the project moves: first draft, final render, installation done." Others: "The Project Manager adds the milestones the project is accepted against." | | `W/page.tsx` | none |
| "Add milestone" (panel button, and Plan > "Add milestone"); dialog "New milestone" | Manager, project not finished | Manager | "Title" (required, up to 200); "Description (optional)"; "Due date"; tick box "Required" (on by default; "Only required milestones count toward the stated progress."); tick box "Can appear on a client timeline" (off by default; "Nothing is shared with the client until you issue a timeline."). Submit "Add milestone" | New milestone in status Planned at the end of the order | "Give the milestone a title"; "Only the Project Manager, someone holding temporary project leadership, or a founder can do that"; "A completed project is read-only. Reopen it first" | `W/milestone-forms.tsx`, `W/plan-add-menu.tsx`, `saveMilestone` -> `proj_save_milestone` (`SQL-D`) | `projects.rls.test.ts` ("lets the PM define milestones and deliverables ...") |
| "Edit"; dialog "Edit milestone" | Manager, project not finished, milestone not Accepted and not Cancelled | Manager | Same fields. When the date differs from the saved one: "Why is the date changing?" (required by the form, up to 300; "Kept with the date history. Nothing else is rescheduled automatically."). Submit "Save milestone" | Fields updated, version raised. A changed date is written to the project change log with the reason and told to the heads of the teams that have a live deliverable on this milestone (section 12) | "This milestone was changed by someone else. Reload the page to see the latest version, then make your change again."; "An accepted or cancelled milestone can no longer be edited"; "Milestone not found" | same | `projects.rls.test.ts` ("records a milestone date change with its history") |
| "Change status"; dialog "Status of "{title}"", description "Cancelling, deferring or reopening needs a reason. Accepting needs every deliverable of the milestone to be accepted, cancelled or deferred." | Manager, project not finished (also on Accepted and Cancelled milestones) | Manager | "New status": from Accepted or Cancelled only "Reopen as In progress"; otherwise every status but the current one: "Planned", "In progress", "Ready for acceptance", "Accepted", "Deferred", "Cancelled". "Reason (required)" for Deferred, Cancelled and Reopen; otherwise "Note (optional)". Submit "Change status" | Status changed, version raised, acceptance stamp set on Accepted and cleared otherwise; one change-log line with the note | "Every deliverable of this milestone must be accepted, cancelled or deferred first"; "Say why the milestone is cancelled" / "... deferred"; "Say why the milestone is being reopened"; "This milestone is {status}. Reopen it to in progress first" | `W/milestone-forms.tsx`, `milestoneMoves` (`W/helpers.ts`), `setMilestoneStatus` -> `proj_set_milestone_status` (`SQL-D`) | `projects.rls.test.ts` ("accepts a milestone only when its deliverables are closed ..."); `W/helpers.test.ts` ("status options and history") |

### 7.2 Deliverables

Panel "Deliverables", description "Pieces of work the PM gives to a department. The department head distributes the tasks and accepts the deliverable." Deliverables are grouped under their milestone's title in milestone order, then "Not linked to a milestone". Each row: title, status badge, description, "{team} (head: {name})" or "No department assigned", the due text, and "No tasks yet" or "{open} open of {total} task(s)".

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| Empty state "No deliverables yet" | No deliverable | Reader | none | Manager with no team: "Add a department team on the People page first, then give it a deliverable." Manager with teams: "Add a deliverable and choose the department team responsible for it." Others: "The Project Manager assigns deliverables to departments." | | `W/page.tsx` | none |
| "Add deliverable" (panel button, and Plan > "Add deliverable"); dialog "New deliverable", description "A deliverable is a piece of work assigned to one department team, whose head then distributes the tasks." | Manager, project not finished | Manager | "Title" (required, up to 200); "Department team" ("Not assigned to a department" or a team); "Milestone" ("Not linked to a milestone" or one that is not cancelled); "Description (optional)"; "Due date". Submit "Add deliverable" | New deliverable in status Open. The head of the chosen team is told (section 12) | "Give the deliverable a title." (action) / "Give the deliverable a title" (function); "Only the Project Manager can assign a deliverable to a department"; "Unknown department team"; "Unknown milestone" | `W/deliverable-forms.tsx`, `saveDeliverable` -> `proj_save_deliverable` (`SQL-D`) | `projects.rls.test.ts` |
| "Edit"; dialog "Edit deliverable" | Project not finished, deliverable not Accepted and not Cancelled, and the viewer is a Manager or the head of the deliverable's team | Manager: all fields. Head: only "Description (optional)" and "Due date" (the other fields are not in the form) | When the date differs: "Why is the date changing?" (required by the form, up to 300; "Kept with the date history."). Submit "Save deliverable" | Fields updated, version raised; change-log lines for a changed date (with the reason) and a changed team; a changed date is told to the Project Manager and the team's head (section 12) | "This deliverable was changed by someone else. Reload the page to see the latest version, then make your change again."; "An accepted or cancelled deliverable can no longer be edited"; "Only the Project Manager or the head of the responsible department can change this deliverable"; "Only the Project Manager can change the title, department or milestone of a deliverable" | same | none found for the head's limited edit |
| "Change status"; dialog "Status of "{title}"", description "Accepting needs every task of the deliverable to be done, cancelled or deferred. Cancelling, deferring or reopening needs a reason." | Project not finished and the viewer is a Manager or the head of the deliverable's team | Manager, Head | "New status": from Accepted or Cancelled only "Reopen as In progress"; otherwise "Open", "In progress", "Ready for review", "Accepted", "Deferred", "Cancelled" minus the current one. "Reason (required)" for Deferred, Cancelled, Reopen; otherwise "Note (optional)". Submit "Change status" | Status changed, version raised, acceptance stamp set or cleared, one change-log line. Moving a deliverable that has a team to Ready for review tells the Project Manager (section 12) | "Every task of this deliverable must be done, cancelled or deferred first"; "Say why the deliverable is cancelled" / "... deferred"; "Say why the deliverable is being reopened"; "This deliverable is {status}. Reopen it to in progress first"; "Only the Project Manager or the head of the responsible department can change this deliverable's status" | `W/deliverable-forms.tsx`, `deliverableMoves` (`W/helpers.ts`), `setDeliverableStatus` -> `proj_set_deliverable_status` (`SQL-D`) | `projects.rls.test.ts`; `W/helpers.test.ts` |

There is no "apply plan template" control on the Work page. `L/actions/projectsPlans.ts` is used by the Timeline and Files screens (`apps/web/src/app/(app)/projects/[id]/timeline/_components/*`, `documents/plan-forms.tsx`), which are outside this file.

## 8. Task detail: side panel and full page

**How to reach it.**
* Side panel: any task title or row on Work (`/projects/[id]/work?task=<id>`), a card on the board, a line of "What needs doing", "Review" in the review queue, a related task under Dependencies. My Work opens the same panel on its own address (`T/task-panel.tsx` with no `projectId`; My Work itself is outside this file).
* Full page: "Full page" in the panel header, or a notice link, at `/projects/[id]/work/tasks/[taskId]`.

**Who can see it.** A Reader of the task's project. The panel loads the project view and the task with the viewer's session; a task of another project, a summary-only project or a removed membership gives "Task not available" (`T/task-panel.tsx`). The full page answers not found for the same cases (`W/tasks/[taskId]/page.tsx`).

**Purpose.** One task, shown by the same component in both places (`TaskDetailBody`, `T/task-detail.tsx`, fed by `loadTaskDetail`, `T/task-detail-data.ts`), so what a person may see and change cannot differ between them.

### 8.1 Frame

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| Panel header: "{reference} · {project name}", the task title, "Full page", close button ("Close details") | Side panel | Reader | none | "Full page" opens the task's own page; the close button, Escape (when no dialog or menu is open) and browser Back close the panel and return to the same list | Unsaved typing asks first (section 1.2) | `C/workspace/side-panel.tsx`, `T/task-panel.tsx` | `projects-workspace.mjs` (not run) |
| "Task not available" | The task id is not readable by the viewer | anyone | none | "This task does not exist, or you cannot see it. It may have been removed, or you may no longer be part of its project." | | `T/task-panel.tsx` (`MissingTask`) | none found |
| "Task could not be loaded" | A read failed while loading the panel | anyone | none | | "Could not load this task. This is a problem loading the information, not an empty list. Reload the page; if it keeps happening, tell an administrator." | `T/task-panel.tsx` (`TaskLoadError`) | `L/projects/load-errors.test.ts` (not re-read: `Unverified`) |
| An address with a malformed `task` value | `?task=` is not a record id | anyone | none | No panel is drawn | | `parseRecordId` (`C/workspace/url-state.ts`) | none |
| Full page: "Back to the task list" and the title | Full page | Reader | none | Returns to the remembered Work list address (with its filters), else `/projects/[id]/work` | A failed read on the full page is thrown to the shared error boundary; what it shows: `Unverified` | `W/tasks/[taskId]/page.tsx`, `C/workspace/list-memory.tsx` (`BackLink`) | none found |

### 8.2 Body, in reading order

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "Next step" box: status, "Blocked", priority, "Needs review", "Due {due text}" or "No due date recorded", and one sentence | Always (first) | Reader | none | The sentence is one of: "This project is finished, so the task is read-only."; "This task is closed. A department head or the Project Manager can reopen it."; "Blocked: {reason}. {who}." where {who} is "You are named to unblock it", "{name} can unblock it" or "No one is named to unblock it; {PM} manages the project", followed by ": {action}" when one was written; "You sent this for review. A department head or the Project Manager decides; there is nothing for you to do until then."; "Waiting for your review: accept it or request changes."; "Waiting for a review by the department head or the Project Manager."; "The assignee, the department head or the Project Manager move this task on. You can comment."; "Not started yet. The assignee starts it."; "In progress with the assignee."; "Yours to start."; "Yours: when the work is finished, send it for review."; "Yours: mark it done when the work is finished." A blocked task adds "Blocked since {when}." and, for someone who may clear it, " You can clear the blocker under More." | | `T/task-detail.tsx`, `nextStep` (`T/task-logic.ts`) | `T/task-logic.test.ts` ("the task's main button and next-step sentence") |
| Main button(s): "Start"; "Send for review" or "Mark done"; "Accept and complete" and "Request changes" | Inside "Next step", only when the task is not blocked, the project is not finished and the viewer has that move: "Start" on To do; on In progress "Send for review" (a task that needs review) or else "Mark done"; on Ready for review, for a reviewer, both decision buttons | per section 10 | "Start" and "Mark done" save at once ("Saving…"); the others open the dialog of section 9.1 | The page refreshes in place | The reason in a red alert under the buttons; lost connection: "The change could not be saved. Check your connection and try again." | `TaskPrimaryAction` (`T/task-controls.tsx`), `primaryMoves` (`T/task-logic.ts`) | `T/task-logic.test.ts` |
| Description | Always | Reader | none | The text, or "No description." | | `T/task-detail.tsx` | none |
| "Status" | Always | per section 10 | as section 4.2 | as section 4.2. On a blocked task this menu still lists the allowed moves | as section 4.2 | `TaskStatusControl` | as 4.2 |
| "Assignee" | Always | Head, Manager (open task) | as section 4.2 | as section 4.2 | as section 4.2 | `TaskAssigneeControl` | as 4.2 |
| "Due" | Always | Assignee, Head, Manager (open task) | as section 9.2 | A warning line may appear under the date after saving (section 9.2) | | `TaskDueControl` | as 4.2 |
| "Report a blocker" | Viewer is Assignee, Head or Manager; the task is open and not already blocked; project not finished | Assignee, Head, Manager | section 9.4 | | | `TaskActionsMenu` (`T/task-actions-menu.tsx`) | `T/task-forms.block.test.tsx` |
| "More" menu: "Edit task" (hint "Title, dates, department, review rule, dependencies"), "Reassign", "Clear blocker" | "Edit task": Assignee, Head or Manager on an open task. "Reassign": as the Assignee control. "Clear blocker": the task is blocked and the viewer is Assignee, Head, Manager or the named unblocker. The menu is absent when none applies | as stated | sections 9.6, 9.3, 9.5 | A warning returned by "Edit task" is shown beside the menu | | same | none found |
| "Comments ({n})", description "About this task only. The project's conversation is in Chat; formal changes are in History." | Always | Reader | section 9.7 | Each comment: text, "{author} · {when}" and " · edited" when edited. Empty: "No comments yet." Finished project: "This project is read-only." instead of the form | | `T/task-detail.tsx`, `CommentForm` (`T/task-forms.tsx`) | `projects.rls.test.ts` ("members comment on any task of their project") |
| "Details": "Collaborators", "Department team", "Deliverable", "Milestone", "Start date", "Completion"; link "Project files and client documents" | Always | Reader | none | Read-only: names or "None"; "{team} (head: {name})"; "Not set"; "{when} by {who}" or "Not completed". The link opens `/projects/[id]/documents` | | `T/task-detail.tsx` | none |
| "Dependencies": "Depends on" and "Waiting on this one", description "Information, never automation: a changed date does not move anyone else's work." | Always | Reader | none | Each related task: title link (opens it in the panel, or as a full page from the full page), status, "due {date}". Empty: "Does not depend on another task." / "No task depends on this one." | | `T/task-detail.tsx` (`DependencyList`) | none |
| "History", description "Reassignments, date changes with their reasons, status changes and blockers. Nothing here can be edited." | Always | Reader | none | Newest first, each with "{when} · {who}" ("System" when there is no actor). Lines: "Created and assigned to {name}."; "Reassigned from {a} to {b}. Reason: ..."; "Due date changed from {a} to {b}. Reason: ..."; "Start date changed from ..."; "Status changed from {a} to {b}. Reason: ..."; "Blocked: {reason}. To unblock: {action}"; "Blocker cleared (was: {reason}). Reason: ..."; "Review is now required." / "Review is no longer required." Empty: "No history yet." | | `T/task-detail.tsx`, `describeTaskEvent` (`W/helpers.ts`), `proj_task_event` (`SQL-D`) | `W/helpers.test.ts` ("status options and history") |

**Phone and desktop.** Same content and order. On a phone the panel is the whole screen, so the list is reached again with the close button or Back. Status, Assignee and Due sit in one row where there is room and stack on a phone.

## 9. Task dialogs

All are thin forms over one server action each (`T/task-forms.tsx`, `L/actions/projectsDelivery.ts`). They are reached from the table, the board and the task detail.

### 9.1 Status move dialog (title = the move's label)

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "Task: {title}" | When opened from a menu or the main button | | | | | `StatusMoveForm` | |
| "Reason (required)" (hint "It is kept in the task history.") | Moves that need a reason: "Request changes", "Defer", "Cancel", "Reopen as In progress", "Reopen as To do" | per section 10 | Required text | Stored as the note of the history line | "Say what needs changing"; "Say why the task is deferred" / "... cancelled"; "Say why the task is being reopened" | `StatusMoveForm`, `proj_set_task_status` (`SQL-D`) | `projects.rls.test.ts` (review rule) |
| Confirmation text | Moves that need no reason | per section 10 | none | "Send for review": "This tells the reviewer the work is ready. You cannot complete reviewed work yourself." "Accept and complete": "This accepts the work and completes the task." | | `StatusMoveForm` | |
| Submit button (the move's label) | Always | per section 10 | | Status saved, version raised, completion stamp set on Done and cleared otherwise, a history line, notices per section 12; the dialog closes | "This task was changed by someone else. Reload the page to see the latest version, then make your change again."; "Only the assignee, the department head or the Project Manager can change this task"; "This task needs review: send it for review first"; "This task needs review by the department head or the Project Manager, not by the person who did it"; "Clear the blocker before completing the task"; "This task does not need review: mark it Done"; "Only the department head or the Project Manager can cancel or defer a task"; "Only the department head or the Project Manager can reopen a {status} task, back to To do or In progress"; "Not allowed"; "Unknown task status {x}"; "Task not found" | `setProjectTaskStatus` -> `proj_set_task_status` | `projects.rls.test.ts`; `L/actions/projectsStale.test.ts` (not re-read: `Unverified`) |

### 9.2 "Change due date" dialog (description = the task's title)

Who: Assignee, Head or Manager on an open task (`canChangeDue` in `T/task-logic.ts`); the function allows the same three roles on any task that is not Done or Cancelled (`proj_update_task`).

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "Due date" (hint "A plain date: it never moves with a time zone.") | Always | as above | A date, or empty to clear it; the browser refuses a date before the start date (hint "The due date cannot be before the start date.") | | "The due date cannot be before the start date" | `DueDateForm`, `proj_update_task` (`SQL-D`) | none found |
| "Why is the date changing?" (hint "Kept in the task history with the old and new date.") | When the date differs from the saved one | as above | Required by the form, up to 300. The function itself does not refuse an empty reason | Stored on the "Due date changed" history line | | same | none found |
| "Checking which tasks depend on this one…" then a warning "{n} dependent task(s) would start before this one finishes:" with a list ("{title} ({assignee}): starts {date}" or "due {date}" or "undated"), "Nothing is moved for you. After saving, review those tasks with their owners." and the tick box "I have seen this and will review them" | When the new date is on or after the start (or, without one, the due date) of a task that depends on this one and is not Done or Cancelled | as above | The tick box is required before saving | A read-only look; nothing is changed by it | A failed look shows no warning (the list is treated as empty) | `DueDateForm`, `previewTaskDateChange` -> `proj_task_affected` (`SQL-D`) | none found |
| "Save due date" | Always | as above | | Date saved, version raised, one history line; notices per section 12. When dependent tasks are touched, a notice appears under the Due control: "{n} dependent task(s) now start(s) before this one finishes. Nothing was moved: review them on the task." | "This task was changed by someone else. Reload the page to see the latest version, then make your change again."; "A {status} task can no longer be edited. Reopen it first"; "Only the assignee, the department head or the Project Manager can change this task" | `updateProjectTask` -> `proj_update_task` | none found |

### 9.3 "Reassign this task" dialog (More > "Reassign"), and the inline Assignee menu

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| Text "One person stays accountable. The change is kept in the history and the new assignee is told." | Dialog | | | | | `ReassignForm` | |
| "New assignee" | Dialog (the inline menu is the same choice with no note) | Manager: any active member. Head of the task's team: people of that team and themself | Required | | "Choose who takes the task."; "The assignee must be an active member of the project"; "A department head assigns tasks to people in their own team" | `ReassignForm`, `TaskAssigneeControl`, `proj_reassign_task` (`SQL-D`) | `T/task-logic.test.ts`; `projects.rls.test.ts` |
| "Note (optional)" | Dialog only | same | Up to 300 | Stored as the reason on the history line | | same | |
| "Reassign" | Dialog | same | | Assignee changed, version raised, the new assignee removed from the collaborators if they were one, history line "Reassigned from {a} to {b}.", the new assignee told (section 12). The previous assignee is not told | "Only the department head or the Project Manager can reassign a task"; "A {status} task cannot be reassigned" (Done or Cancelled); "Task not found" | `reassignProjectTask` -> `proj_reassign_task` | same |

### 9.4 "Report a blocker" dialog (description = the task's title)

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "What is blocking it" | Always | Assignee, Head, Manager | Required | | "Say what is blocking the task" | `BlockForm`, `blockProjectTask`, `proj_block_task` (`SQL-block`) | `T/task-forms.block.test.tsx`; `packages/rls-tests/test/project_block_notifies_pm.rls.test.ts` |
| "Who is responsible for unblocking it" (hint "They are told. Change it if someone else can clear it. The task cannot be completed until the blocker is cleared.") | Always | same | Required: one active member. Pre-filled with the Project Manager when that is not the reporter and is a member; else the head of the task's team when that is not the reporter; else the Project Manager; else "Choose a person" | | "Choose who is responsible for unblocking it"; "The person who can unblock it must be a member of the project" | `BlockForm`, `defaultUnblocker` (`T/task-logic.ts`) | `T/task-forms.block.test.tsx` |
| "Report blocker" ("Reporting…") | Always | same | | The task is marked blocked with the time, the reason and the named person; version raised; history line "Blocked: {reason}."; notices per section 12. The task shows "Blocked" everywhere and offers no "Mark done" | "Only the assignee, the department head or the Project Manager can block this task"; "A {status} task cannot be blocked" (Done, Cancelled, Deferred) | `blockProjectTask` -> `proj_block_task` | `project_block_notifies_pm.rls.test.ts` |

The function also accepts a written unblock action instead of a person ("Say who or what action will unblock it" when neither is given); the app's form offers only the person. A task blocked that way (through an older screen or another door) shows the action in the "Next step" sentence.

### 9.5 "Clear the blocker" dialog (More > "Clear blocker")

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "Note (optional)" (placeholder "What changed?") | Always | Assignee, Head, Manager, or the named unblocker | Optional | Stored on the history line | | `UnblockForm` | |
| "Clear blocker" | Always | same | | The blocker, its reason, the named person and the action are cleared; version raised; history line "Blocker cleared (was: {reason})." Nobody is notified | "Only the assignee, the department head, the Project Manager or the named unblocker can clear this blocker" | `unblockProjectTask` -> `proj_unblock_task` (`SQL-D`) | `projects.rls.test.ts` ("requires a reason to block ...") |

### 9.6 "Edit task" dialog (More > "Edit task")

Who: Assignee, Head or Manager on an open task. "Leader fields" below are shown to a Head or Manager only; the function refuses them from an assignee ("Ask your department head or the Project Manager to change where this task sits or whether it needs review").

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "Title" | Always | as above | Required, up to 200 | | | `EditTaskForm`, `proj_update_task` | |
| "Description" | Always | as above | Optional; emptying it clears it | | | same | |
| "Priority" | Always | as above | "Low", "Normal", "High", "Urgent" | | | same | |
| "Start date", "Due date" | Always | as above | Optional dates; due cannot be before start | A changed start or due date writes its own history line | "The due date cannot be before the start date" | same | |
| "Why is the date changing?" | When the start or the due date differs from the saved one | as above | Required by the form, up to 300 | | | same | |
| Dependent-task warning with "I have seen this and will review them" | As in section 9.2, when the due date is changed | as above | Tick required | | | same | |
| "Department team" ("No team"), "Deliverable" ("None"), "Milestone" ("None") | Leader fields | Head, Manager | Optional | | "Unknown department team"; "Unknown deliverable"; "Unknown milestone" | same | |
| "Needs review" ("A department head or the Project Manager (not the assignee) accepts it as done.") | Leader field | Head, Manager | Tick box | A change writes "Review is now required." or "Review is no longer required." | | same | |
| "Depends on" (hint "Hold Ctrl or Cmd to pick several. A loop between tasks is refused.") | Always | as above | Any other tasks of the project; the selection replaces the saved list | | "That dependency would create a loop between tasks"; "A task cannot depend on itself"; "A dependency must be a task of the same project" | same; `proj_set_task_dependencies` | |
| "Collaborators" (hint "Helpers; the assignee stays the one accountable person.") | Always | as above | Members other than the assignee; the selection replaces the saved list | | "Collaborators must be active members of the project" | same; `proj_set_task_collaborators` | |
| "Save task" | Always | as above | | Saved, version raised; notices for a changed due date (section 12); a dependent-task warning, when there is one, is shown beside the More menu | "This task was changed by someone else. Reload the page to see the latest version, then make your change again."; "A {status} task can no longer be edited. Reopen it first"; "Field {x} cannot be changed here" | `updateProjectTask` -> `proj_update_task` | none found for the form |

### 9.7 Comment form

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "Add a comment" (hint "Comments stay on this task. They never change its status or dates.") and "Add comment" | Under the comments, unless the project is finished | Any Reader of the project (member or founder), whatever their part in the task | Required, up to 4000 characters | The comment is added and the box is cleared ("Saved" for a moment). No status, date or notice changes; nobody is notified | "Write a comment"; "Task not found" (not a Reader) | `CommentForm`, `commentOnTask` -> `proj_comment_task` (`SQL-D`) | `projects.rls.test.ts` |

`proj_edit_task_comment` exists (`SQL-D`: the author may change their own comment's text) but no screen in this slice calls it; the " · edited" mark is display only.

## 10. Task status moves by role

Source: `allowedTaskMoves` (`domain`), `moveMode` and `primaryMoves` (`T/task-logic.ts`), enforced again by `proj_set_task_status` (`SQL-D`). "Leader" = Head of the task's team or a Manager. "Reviewer" = a Leader who is not the task's assignee. "Direct" = saved the moment it is chosen. "Dialog" = the form of section 9.1 opens first. On a finished project nobody has any move.

| From | Move (exact label) | To | Assignee | Leader | Offered when | Saved how | Reason | Database refusal if tried anyway |
|---|---|---|---|---|---|---|---|---|
| To do | Start | In progress | Yes | Yes | Always | Direct | No | none |
| In progress | Back to To do | To do | Yes | Yes | Always | Direct | No | none |
| To do, In progress | Mark done | Done | Yes | Yes | The task does not need review and is not blocked | Direct | No | "Clear the blocker before completing the task" |
| In progress | Send for review | Ready for review | Yes | Yes | The task needs review (a blocked task is still offered it) | Dialog (confirmation) | No | "This task does not need review: mark it Done" |
| Ready for review | Accept and complete | Done | No | Reviewer only | The task needs review | Dialog (confirmation) | No | "This task needs review by the department head or the Project Manager, not by the person who did it"; "Clear the blocker before completing the task" |
| Ready for review | Request changes | In progress | No | Reviewer only | The task needs review | Dialog | Required | "Say what needs changing" |
| Ready for review | Withdraw from review | In progress | Yes (only when their part in the task is `assignee`) | No | The task needs review | Direct | No | "Not allowed" (a Leader who is the assignee) |
| To do, In progress, Ready for review | Defer | Deferred | No | Yes | Always | Dialog | Required | "Only the department head or the Project Manager can cancel or defer a task"; "Say why the task is deferred" |
| To do, In progress, Ready for review | Cancel | Cancelled | No | Yes | Always | Dialog | Required | same, "... cancelled" |
| Done, Cancelled, Deferred | Reopen as In progress | In progress | No | Yes | Always | Dialog | Required | "Only the department head or the Project Manager can reopen a {status} task, back to To do or In progress"; "Say why the task is being reopened" |
| Done, Cancelled, Deferred | Reopen as To do | To do | No | Yes | Always | Dialog | Required | same |

Notes that follow from the code:
* A task that needs review and is in To do offers only "Start" (and, to a Leader, "Defer" and "Cancel"): it cannot be marked done.
* A Leader who is also the assignee of a task in Ready for review is offered only "Defer" and "Cancel": not "Accept and complete" (never one's own work) and not "Withdraw from review" (their part is `manager` or `head`, and the function answers "Not allowed"). Another Leader must decide.
* The main button of the task detail is a subset of this table (section 8.2) and is hidden while the task is blocked. "Withdraw from review", "Back to To do", "Defer", "Cancel" and the reopen moves are in the Status menu only.
* On the board, "Defer" and "Cancel" have no column, so they are reached from the Status menu in the table or the task.

## 11. The flows end to end

### 11.1 Review

1. A Manager, or a Head for a task in the team they head, ticks "Needs review" when adding or editing the task (sections 5, 9.6).
2. The assignee presses "Start", does the work, then "Send for review". The task moves to Ready for review. One reviewer is told: the head of the task's team when that is someone other than the assignee, otherwise the Project Manager (`proj_set_task_status`: `v_reviewer`). Any Head of that team or Manager who is not the assignee can decide, whoever was told.
3. The reviewer sees it under "Waiting for your review" on Work, under "Needs you" as "Review", and on My Work. "Accept and complete" finishes the task; "Request changes" (reason required) returns it to In progress. Either way the assignee is told the result.
4. Until a decision, the assignee may "Withdraw from review" (back to In progress, no reason, nobody told).
5. A blocked task cannot be accepted until the blocker is cleared.

### 11.2 Blockers

| Question | Answer | Source |
|---|---|---|
| Who may report one | The Assignee, the Head of the task's team, a Manager; on an open task that is not already blocked (screen). The function also refuses Done, Cancelled and Deferred tasks | `T/task-detail.tsx` (`canBlock`), `proj_block_task` (`SQL-block`) |
| What must be given | The reason and one member responsible for unblocking it | `BlockForm`, `blockProjectTask` |
| Who may clear it | The Assignee, the Head, a Manager, or the named person (who need not have any other part in the task) | `T/task-detail-data.ts` (`canUnblock`), `proj_unblock_task` |
| Who is told when it is reported | The named person ("... is blocked and needs your action: {reason}."). When the named person is not the Project Manager, the Project Manager too, as information ("... is blocked: {reason}. {name} was asked to unblock it."). Never the reporter; an inactive person or someone who can no longer open the project is skipped | `proj_block_task` (`SQL-block`), `proj_notify` (`SQL-base`), `L/projects/notification-text.ts` |
| Who is told when it is cleared | Nobody | `proj_unblock_task` |
| What a blocker stops | "Mark done" is not offered and completing is refused ("Clear the blocker before completing the task"). Other moves stay available. The main button is hidden | `allowedTaskMoves`, `proj_set_task_status`, `T/task-detail.tsx` |
| Where it shows | "Blocked" flag in the table and on the board card; "Narrow to: Blocked"; the "Need attention" card; "What needs doing" (section 3.1); the "Next step" box; My Work's blockers list (outside this file) | as cited in those sections |

### 11.3 Dependencies and collaborators

* Dependencies are information only. They are chosen when adding a task ("Depends on (optional)", open tasks only) or editing it ("Depends on", any other task). The function refuses a self-reference, a task of another project and a loop. A dependency never blocks a status move and never moves a date. Its only effects: the two lists under "Dependencies" on the task, and the warning when a due date is moved past the start of dependent work (section 9.2). Source: `proj_set_task_dependencies`, `proj_task_affected` (`SQL-D`), `T/task-forms.tsx`.
* Collaborators are helpers; the assignee stays the one accountable person. Chosen when adding or editing a task; they must be active members; the assignee is never stored as one and a person who becomes the assignee is removed from the list. A collaborator gets no right on the task from being one (their part stays none unless they are also a Head or Manager), so they can read and comment. Source: `proj_set_task_collaborators`, `proj_reassign_task`, `proj_task_actor_role` (`SQL-D`). How My Work lists shared tasks is outside this file.

### 11.4 Due-date change with a reason

Who: Assignee, Head, Manager. The form requires "Why is the date changing?" whenever the date differs; the function stores the reason on the history line but does not itself require one. Nothing else is rescheduled. Who is told: when the assignee moved the date, the Project Manager and the head of the task's team; when a Head or Manager moved it, the assignee (section 12). The same pattern applies to milestones (reason kept in the project change log; heads of teams with live deliverables on it are told) and deliverables (Project Manager and the team's head are told).

## 12. Notifications raised from this slice

All are in-app notices written by `proj_notify` (`SQL-base`) into the shared `notifications` table. Rules of `proj_notify`: never to the person who did the action; only to an active person who is an eligible member of the project or a founder of its company; an unread notice with the same type and key is not repeated. The text is built from the type and payload by `describeNotification` (`L/projects/notification-text.ts`), which My Work renders (`apps/web/src/app/(app)/projects/work/page.tsx`). Whether any other surface (a bell, My Day, e-mail) shows these types was not read: `Unverified`. No function in this slice sends e-mail or anything outside the system.

| Event | Type | Recipient | Text shown (fictional names) | Link | Function |
|---|---|---|---|---|---|
| Task created for someone else; task reassigned | `project_task_assigned` | The (new) assignee | "The task "Cable audit" on PRJ-0007 Harbour Lights was assigned to you." | The task's full page | `proj_create_task`, `proj_reassign_task` |
| Sent for review | `project_review_requested` | Head of the task's team if not the assignee, else the Project Manager | ""Cable audit" on PRJ-0007 Harbour Lights is ready for your review." | The task's full page | `proj_set_task_status` |
| Review decided by a reviewer | `project_review_result` | The assignee | ""Cable audit" on PRJ-0007 Harbour Lights was accepted and completed." or "... was sent back with changes requested." | The task's full page | `proj_set_task_status` |
| Blocker reported | `project_task_blocked` | The named person (or the Project Manager when only an action was written) | ""Cable audit" on PRJ-0007 Harbour Lights is blocked and needs your action: Power not ready." | The task's full page | `proj_block_task` (`SQL-block`) |
| Blocker reported, someone other than the Project Manager named | `project_task_blocked` with `fyi` | The Project Manager | ""Cable audit" on PRJ-0007 Harbour Lights is blocked: Power not ready. Sam Rivera was asked to unblock it." | The task's full page | `proj_block_task` (`SQL-block`) |
| Task due date changed by the assignee | `project_deadline_changed` | The Project Manager and the head of the task's team | "The task "Cable audit" on PRJ-0007 Harbour Lights changed (now 2026-12-04)." | The task's full page | `proj_update_task` |
| Task due date changed by a Head or Manager | `project_deadline_changed` | The assignee | same | The task's full page | `proj_update_task` |
| Milestone due date changed | `project_deadline_changed` | Heads of teams with a deliverable on that milestone that is not accepted or cancelled | "The milestone "First draft" on PRJ-0007 Harbour Lights changed (now 2026-12-04)." | The project | `proj_save_milestone` |
| Deliverable created with a team | `project_assignment` | The team's head | "The deliverable "Floor build" on PRJ-0007 Harbour Lights was assigned to your department." | The project's Work page | `proj_save_deliverable` |
| Deliverable due date changed | `project_deadline_changed` | The Project Manager and the head of the deliverable's team | "The deliverable "Floor build" on PRJ-0007 Harbour Lights changed (now 2026-12-04)." | The project | `proj_save_deliverable` |
| Deliverable (with a team) moved to Ready for review | `project_review_requested` | The Project Manager | "The deliverable "Floor build" on PRJ-0007 Harbour Lights is ready for your review." | The project | `proj_set_deliverable_status` |

Nothing is sent for: a comment, clearing a blocker, Start, Back to To do, Mark done on a task without review, Withdraw from review, Defer, Cancel, Reopen, a milestone status change, a deliverable status change other than to Ready for review, or a deliverable's team being changed on edit. Tests: `L/projects/notification-text.test.ts`, `packages/rls-tests/test/project_block_notifies_pm.rls.test.ts`.

## 13. "Jump to a task…" (legacy Discussion page)

| Control (exact label) | When it appears | Who can use it | Required fields / inputs | After success | If blocked or it fails (exact message where the code has one) | Source | Tests |
|---|---|---|---|---|---|---|---|
| "Jump to a task…" with groups "Open tasks" and "Finished tasks" | Only on the old Discussion page `/projects/[id]/discussion`, and that page is drawn only where the project chat groups are not installed in the database (otherwise the address redirects a member to Work with the Chat panel open, or tells a non-member where the conversation is). Hidden when the project has no task; lists up to 300 tasks, newest first | Reader | Choose a task | Opens `/projects/[id]/work?task=<id>`. Nothing is created or changed | A failed task read gives an empty picker, so it is hidden (not reported) | `C/projects/jump-to-task.tsx`, `apps/web/src/app/(app)/projects/[id]/discussion/page.tsx` | `discussion/page.test.tsx` (not re-read: `Unverified`) |

## 14. Where the screen and the database differ, and reads that fail quietly (found by reading; not run)

These are observations for whoever tests or changes this module. None was confirmed by a run.

| # | Observation | Source |
|---|---|---|
| 1 | Comments on a finished project: the screen removes the form ("This project is read-only."), but `proj_comment_task` does not call `proj_require_open_project`, so the function itself would accept a comment on a completed project from a Reader | `T/task-detail.tsx`, `proj_comment_task` (`SQL-D`). `projects.rls.test.ts` has a test named "is read-only once the project is completed, and chat never completes tasks or changes scope"; whether it covers task comments was not re-read: `Unverified` |
| 2 | The reason for a changed date (task, milestone, deliverable) is required by the forms only; the functions store whatever reason arrives, including none | `T/task-forms.tsx`, `W/milestone-forms.tsx`, `W/deliverable-forms.tsx`; `proj_update_task`, `proj_save_milestone`, `proj_save_deliverable` |
| 3 | `proj_set_task_status` has no rule for Ready for review -> To do, nor for To do -> Ready for review on a task that needs review: neither is refused by the function for a person with a part in the task. The screens never offer either | `proj_set_task_status` (`SQL-D`), `allowedTaskMoves` |
| 4 | A Deferred task can still be edited and reassigned according to the functions (only Done and Cancelled are refused); the screens offer Edit, Reassign and the due-date pencil on open tasks only | `proj_update_task`, `proj_reassign_task`; `T/task-detail-data.ts` (`canEdit`), `buildTaskRow` |
| 5 | "Report a blocker" is hidden on a task that is already blocked, but the function does not refuse a second block: it would replace the reason and the named person and write a new history line | `proj_block_task` (`SQL-block`) |
| 6 | Reassign, block, unblock, milestone status and deliverable status carry no version check; task status, task edit, due date, milestone edit and deliverable edit do | `L/actions/projectsDelivery.ts` |
| 7 | New task: the function does not compare the start and due dates (the browser's date field does); editing does ("The due date cannot be before the start date") | `proj_create_task`, `proj_update_task` |
| 8 | "View all tasks ({N})" counts every task but opens a list still narrowed to open tasks; the empty state's words "open all tasks to include finished ones" need "Show: All tasks" to be true | `W/page.tsx` (`allHref`, `emptyList`), `parseTaskFilters` |
| 9 | The "Need attention" card sets `show=attention`, which is not one of the "Narrow to" options, so its chip reads "Narrow to: attention" | `W/page.tsx`, `C/os/filter-bar.tsx` (`chipText`) |
| 10 | Reads on the Work page whose failure is not reported: `proj_milestone_progress` (the page then says "No required milestone set yet"), `proj_feedback` (the "Client feedback" line is absent), `proj_external_dependencies` and `proj_plan_items` (the "Dependencies" shortcut and some activity titles are absent), `proj_plan_outdated` (no warning), and `proj_site_bookings` for a non-manager ("Next on site" and "Site bookings" are absent; a Manager is told "Could not load the site bookings"). The project rule is that a failed read says so | `W/page.tsx` (only `msRes`, `dlRes`, `taskRes`, `completionRes`, `logRes`, `bookingRes` for the summary and the equipment state are checked) |
| 11 | `previewTaskDateChange` ignores a failed read and returns no rows, so the dependent-task warning is silently absent in that case; the save still returns the true count afterwards | `L/actions/projectsDelivery.ts`, `T/task-forms.tsx` |
| 12 | The label "Import failed — review" contains a long dash in the app (kept here as written) | `L/projects/work-attention.ts` |

## 15. Tests that cover this slice (named from the files; none was run here)

| Test file | What it covers (from its test names) |
|---|---|
| `apps/web/src/app/(app)/projects/[id]/work/helpers.test.ts` | Filter parsing, filtering and ordering, row mapping and counts, the review queue, new-task options mirroring `proj_create_task`, status options and history lines, quick assignee choices, This week and needs attention, the milestone strip |
| `apps/web/src/components/projects/tasks/task-logic.test.ts` | Direct or dialog moves, what each role may change on a row, board targets, sorting, grouping, the main button and the next-step sentence |
| `apps/web/src/components/projects/tasks/task-forms.block.test.tsx` | The blocker form: two fields, the person pre-filled, required and editable; nobody pre-selected when nobody fits |
| `apps/web/src/lib/projects/work-attention.test.ts` | Needs you and Waiting lists, equipment lines, ordering, the equipment line of the summary |
| `apps/web/src/lib/projects/notification-text.test.ts` | The notice texts and links |
| `apps/web/src/lib/projects/load-errors.test.ts`, `apps/web/src/lib/actions/projectsStale.test.ts` | Failed reads and the stale-version answer (contents not re-read: `Unverified`) |
| `packages/rls-tests/test/projects.rls.test.ts` | Task creation by role, reassignment, the review rule, blockers, comments, milestone acceptance, date history, read-only after completion |
| `packages/rls-tests/test/project_block_notifies_pm.rls.test.ts` | Who is told about a blocker |
| `apps/web/os-shell-checks/projects-workspace.mjs` | Browser flow on a local stack: table, board, columns, side panel, quick changes by role (see `apps/web/os-shell-checks/README.md`) |

No component test was found for `W/page.tsx`, `T/task-panel.tsx`, `T/task-detail.tsx`, `T/task-table.tsx`, `T/task-board-client.tsx`, the milestone and deliverable forms, `C/os/filter-bar.tsx` or `C/projects/work-parts.tsx`.

## Coverage rows

| Entry | Kind (screen / tab / panel / dialog / form / filter / download / legacy route) | How to reach it | Who can see it | Purpose | Reference (section number in this file) | Status (Documented or Unverified: what) |
|---|---|---|---|---|---|---|
| Work page | screen | `/projects/[id]/work`; Projects, choose a project; tab "Work" | Reader (member, or founder of the company) | The project's work in one place | 2 | Documented |
| `/projects/[id]` for a member | legacy route | Old links to the project | Reader | Redirects to Work (summary-only viewers get the Summary panel instead) | 1.2, 2 | Documented |
| Work page banners (read-only, On hold, client timeline out of date, reopened) | panel | Top of Work | Reader; the timeline warning for a Manager | State of the project that affects the work | 2 | Documented |
| Work page failed read | panel | Automatic | Reader | Says the work could not load, with Try again | 2 | Unverified: the render was not run; the reads listed in 14 row 10 fail quietly |
| What needs doing | panel | Top of Work | Reader, live project | Needs you / Waiting on someone else | 3 | Documented |
| Import the handover equipment | form | Under the "Import failed — review" line | Manager | Run the handover equipment import again | 3.2 | Unverified: the function behind it (`inv_import_handover_requirements`) was not read |
| Equipment state warning | panel | Automatic when the equipment read fails | Reader, live project | Says equipment facts may be missing | 3.2 | Documented |
| Delivery summary | panel | Top of Work | Manager, live project | Next milestone, next site booking, equipment | 3.2 | Documented |
| Summary cards (Open tasks, Need attention, In review) | filter | Top of Work | Reader | Counts that open the matching list | 3.2 | Documented |
| Task card: This week mode | panel | Default view of Work | Reader | Up to six tasks due this week, overdue or blocked | 4 | Documented |
| Task card: Tasks (full list) | panel | "View all tasks", any filter, Board or grouping | Reader | Every task the filters allow | 4 | Documented |
| Search tasks | filter | Task card toolbar | Reader | Search title and description | 4.1 | Documented |
| Filters panel (Show, Assignee, Department, Deliverable, Narrow to) | filter | "Filters" button | Reader | Narrow the list; chips and Clear all | 4.1 | Documented |
| Group by | filter | Filters panel, Table view | Reader | Group by department, milestone, status or assignee | 4.1 | Documented |
| Table / Board switch | filter | Task card toolbar | Reader | Two views of the same rows | 4.1 | Documented |
| Columns menu | filter | Task card footer, Table view | Reader | Optional columns | 4.1 | Documented |
| Column sort | filter | Table headings | Reader | Sort by Task, Assignee, Due, Status, Priority | 4.2 | Documented |
| Task table | panel | Table view | Reader; inline changes per role | Rows with inline Status, Assignee and Due | 4.2 | Documented |
| Task board | panel | Board view | Reader; moves per role | Cards by status with drag and "Move to…" | 4.3 | Unverified: drag behaviour was read, not seen in a browser |
| Task list empty states | panel | Automatic | Reader | No tasks yet / Nothing due this week / No tasks match | 4.1 | Documented |
| Add task | dialog | "Add task" (or `?add=1`) | Any member for themself; Head for their team; Manager for anyone | Create a task with three fields and optional details | 5 | Documented |
| Plan menu | panel | "Plan" in the task card | Manager, live project | Add milestone, Add deliverable | 4.1, 7 | Documented |
| Waiting for your review | panel | Work, under the task card | Head, Manager with something to review | The viewer's review queue | 6 | Documented |
| Upcoming milestones strip | panel | Work, main column | Reader | Where the project stands against its milestones | 6 | Documented |
| Next on site | panel | Right rail | Reader who is not managing a live project | The next site booking | 6 | Documented |
| Recent activity | panel | Right rail | Reader | Four newest change-log lines with links | 6 | Documented |
| Go to | panel | Right rail | Reader | Shortcuts with the fact that makes each relevant | 6 | Documented |
| Project details and Agreed scope | panel | Right rail | Reader | Read-only who, when, where and scope | 6 | Unverified: folding on a phone (`C/os/collapsible.tsx`) not read |
| Completion record | panel | Bottom of Work on a completed project | Reader | Read-only completion facts | 2 | Documented |
| Milestones & deliverables section | panel | Bottom of Work; `?ms=1#milestone-list` | Reader | Milestones and deliverables with their controls | 7 | Documented |
| New milestone | dialog | "Add milestone"; Plan > "Add milestone" | Manager | Add a milestone | 7.1 | Documented |
| Edit milestone | dialog | "Edit" on a milestone | Manager | Change title, description, date, flags | 7.1 | Documented |
| Milestone status | dialog | "Change status" on a milestone | Manager | Move, accept, defer, cancel, reopen | 7.1 | Documented |
| New deliverable | dialog | "Add deliverable"; Plan > "Add deliverable" | Manager | Give a piece of work to a department | 7.2 | Documented |
| Edit deliverable | dialog | "Edit" on a deliverable | Manager; Head of its team (description and date only) | Change a deliverable | 7.2 | Documented |
| Deliverable status | dialog | "Change status" on a deliverable | Manager; Head of its team | Move, accept, defer, cancel, reopen | 7.2 | Documented |
| Task side panel | panel | `?task=<id>` on Work (and on My Work) | Reader of the task's project | The task beside the list | 8 | Documented |
| Task full page | screen | `/projects/[id]/work/tasks/[taskId]`; "Full page"; notice links | Reader | The same task on its own address | 8 | Unverified: what a failed read shows on this page (shared error boundary) |
| Task not available / Task could not be loaded | panel | Automatic in the side panel | anyone | Tell a missing task from a failed read | 8.1 | Documented |
| Next step box and main button | panel | Top of the task | Reader; buttons per role | Whose step it is and the one thing to do | 8.2, 10 | Documented |
| Status menu | form | Table cell, task detail | Assignee, Head, Manager per the moves table | Change status | 4.2, 10 | Documented |
| Status move dialog | dialog | A move that needs a reason or a decision | per the moves table | Reason or confirmation before the move | 9.1 | Documented |
| Assignee menu | form | Table cell, task detail | Head of the task's team, Manager | Reassign in place | 4.2, 9.3 | Documented |
| Reassign this task | dialog | More > "Reassign" | Head of the task's team, Manager | Reassign with a note | 9.3 | Documented |
| Change due date | dialog | Pencil beside the due date | Assignee, Head, Manager | New date, reason, effect on dependent tasks | 9.2 | Documented |
| Report a blocker | dialog | "Report a blocker" on the task | Assignee, Head, Manager | Record what blocks the task and who unblocks it | 9.4 | Documented |
| Clear the blocker | dialog | More > "Clear blocker" | Assignee, Head, Manager, named unblocker | Clear the blocker | 9.5 | Documented |
| Edit task | dialog | More > "Edit task" | Assignee, Head, Manager (leader fields for Head and Manager) | Full edit, dependencies, collaborators | 9.6 | Documented |
| Task comments | form | Task detail, "Comments" | Reader (form hidden on a finished project) | Comment on this task | 8.2, 9.7 | Unverified: the function does not refuse a finished project (14 row 1) |
| Task details, dependencies, history | panel | Task detail | Reader | Read-only facts, related tasks, the task's history | 8.2 | Documented |
| Task notices | panel | My Work notices list; links open the task's full page | The recipient | Tell people about assignments, reviews, blockers, moved dates | 12 | Unverified: surfaces other than My Work that show these notices |
| Jump to a task… | legacy route | Old Discussion page `/projects/[id]/discussion`, only without chat groups installed | Reader | Open a task from the old discussion | 13 | Unverified: not seen; the page is a fallback |

## Actions

Every action below is a button or form that calls a server action in `apps/web/src/lib/actions/projectsDelivery.ts` (unless stated) with the signed-in person's session, which calls one `SECURITY DEFINER` function. A documented function is not an approved tool: nothing here authorises calling a function directly. "Manager", "Head", "Assignee", "Reader" as in section 1.1. Every write except `projects.task.comment` is refused on a completed or archived project. "Version check" = the action's `staleMessage` plus `proj_check_version` in the function.

| Id | Label in the app | Permission (and where enforced) | Starting state | Server action -> database function | Records changed | Resulting state | Notifications | Retry behaviour |
|---|---|---|---|---|---|---|---|---|
| `projects.task.create` | Add task | Reader; assign to others only as Manager (anyone) or Head (own team); `proj_create_task` | Live project | `createProjectTask` -> `proj_create_task` | `proj_tasks` (new), `proj_task_events` ("created"), `proj_task_dependencies`, `proj_task_collaborators` | Task in To do | Assignee, when not the creator (`project_task_assigned`) | Not safe: each call creates another task; no idempotency key. After an unclear failure, look for the title in the list first |
| `projects.task.start` | Start | Assignee, Head, Manager; `proj_set_task_status` | To do | `setProjectTaskStatus` -> `proj_set_task_status` | `proj_tasks` (status, version), `proj_task_events` | In progress | None | Safe: version check, and the function returns without change when the status is already the target |
| `projects.task.back_to_todo` | Back to To do | Assignee, Head, Manager; same function | In progress | same | same | To do | None | Safe: as above |
| `projects.task.mark_done` | Mark done | Assignee, Head, Manager; same function | To do or In progress, task without review, not blocked | same | `proj_tasks` (status, completed stamp, version), `proj_task_events` | Done | None | Safe: as above |
| `projects.task.send_for_review` | Send for review | Assignee, Head, Manager; same function | In progress, task needs review | same | `proj_tasks`, `proj_task_events` | Ready for review | One reviewer: head of the task's team if not the assignee, else the Project Manager (`project_review_requested`) | Safe: version check; a repeat with a fresh version returns without change and sends nothing |
| `projects.task.accept_review` | Accept and complete | Head of the task's team or Manager who is not the assignee; same function | Ready for review, not blocked | same | `proj_tasks` (status, completed stamp, version), `proj_task_events` | Done | The assignee (`project_review_result`, accepted) | Safe: as above |
| `projects.task.request_changes` | Request changes | Same reviewer; reason required; same function | Ready for review | same | `proj_tasks`, `proj_task_events` (with the reason) | In progress | The assignee (`project_review_result`, changes requested) | Safe: as above |
| `projects.task.withdraw_from_review` | Withdraw from review | The assignee whose part is `assignee` (not a Head or Manager); same function | Ready for review | same | `proj_tasks`, `proj_task_events` | In progress | None | Safe: as above |
| `projects.task.defer` | Defer | Head, Manager; reason required; same function | To do, In progress, Ready for review | same | `proj_tasks`, `proj_task_events` (with the reason) | Deferred | None | Safe: as above |
| `projects.task.cancel` | Cancel | Head, Manager; reason required; same function | To do, In progress, Ready for review | same | same | Cancelled | None | Safe: as above |
| `projects.task.reopen` | Reopen as In progress / Reopen as To do | Head, Manager; reason required; same function | Done, Cancelled, Deferred | same | `proj_tasks` (status, completed stamp cleared, version), `proj_task_events` | In progress or To do | None | Safe: as above |
| `projects.task.reassign` | Assignee menu; More > Reassign | Head of the task's team (to team members or themself), Manager (any member); `proj_reassign_task` | Task not Done or Cancelled (screen: open tasks only) | `reassignProjectTask` -> `proj_reassign_task` | `proj_tasks` (assignee, version), `proj_task_collaborators` (new assignee removed), `proj_task_events` ("reassigned") | New assignee | The new assignee (`project_task_assigned`) | Safe by idempotence: no version check, but choosing the person who already holds the task changes nothing. Two people reassigning at once: the last one wins |
| `projects.task.change_due_date` | Change due date (pencil), Save due date | Assignee, Head, Manager; `proj_update_task` | Task not Done or Cancelled (screen: open tasks only) | `updateProjectTask` -> `proj_update_task` (read-only preview: `previewTaskDateChange` -> `proj_task_affected`) | `proj_tasks` (due date, version), `proj_task_events` ("due_date_changed" with the reason) | New due date; nothing else moved | By the assignee: Project Manager and team head. By a Head or Manager: the assignee (`project_deadline_changed`) | Safe: version check; a repeat with the same date writes no history line and sends nothing |
| `projects.task.edit` | More > Edit task, Save task | Assignee (title, description, priority, dates, dependencies, collaborators); Head and Manager also department, deliverable, milestone, review rule; `proj_update_task` | Task not Done or Cancelled (screen: open tasks only) | `updateProjectTask` -> `proj_update_task` (which calls `proj_set_task_dependencies`, `proj_set_task_collaborators`) | `proj_tasks`, `proj_task_dependencies`, `proj_task_collaborators`, `proj_task_events` (date and review-rule changes only) | Fields as saved | Only for a changed due date, as above | Safe: version check; the saved lists replace the old ones, so repeating gives the same result |
| `projects.task.block` | Report a blocker, Report blocker | Assignee, Head, Manager; `proj_block_task` | Open task (screen: not already blocked) | `blockProjectTask` -> `proj_block_task` (`SQL-block`) | `proj_tasks` (blocked time, reason, named person, version), `proj_task_events` ("blocked") | Blocked | The named person; also the Project Manager when someone else was named (`project_task_blocked`) | Not safe to repeat blindly: no version check and the function accepts a second block, replacing the reason and person and adding a history line (a second notice is suppressed only while the first is unread with the same key, which changes with the version). Read the task first |
| `projects.task.unblock` | More > Clear blocker | Assignee, Head, Manager, or the named unblocker; `proj_unblock_task` | Blocked task | `unblockProjectTask` -> `proj_unblock_task` | `proj_tasks` (blocker fields cleared, version), `proj_task_events` ("unblocked") | Not blocked | None | Safe: idempotent, the function returns without change when the task is not blocked |
| `projects.task.comment` | Add comment | Any Reader of the project; `proj_comment_task` (form hidden on a finished project; the function does not refuse one) | Any task | `commentOnTask` -> `proj_comment_task` | `proj_task_comments` (new) | One more comment | None | Not safe: each call adds another comment. Read the comments before repeating |
| `projects.milestone.add` | Add milestone | Manager; `proj_save_milestone` (`proj_require_manager`) | Live project | `saveMilestone` -> `proj_save_milestone` | `proj_milestones` (new) | Milestone in Planned | None | Not safe: each call creates another milestone |
| `projects.milestone.edit` | Edit, Save milestone | Manager; same function | Milestone not Accepted or Cancelled | same | `proj_milestones` (fields, version), `proj_change_log` (a changed date, with the reason) | Fields as saved | Changed date: heads of teams with a live deliverable on it (`project_deadline_changed`) | Safe: version check |
| `projects.milestone.set_status` | Change status | Manager; `proj_set_milestone_status` | Any; from Accepted or Cancelled only back to In progress with a reason; Accepted needs every deliverable of it accepted, cancelled or deferred; Deferred and Cancelled need a reason | `setMilestoneStatus` -> `proj_set_milestone_status` | `proj_milestones` (status, acceptance stamp, version), `proj_change_log` | The chosen status | None | Safe by idempotence: no version check, but the function returns without change when the status is already the target |
| `projects.deliverable.add` | Add deliverable | Manager; `proj_save_deliverable` | Live project | `saveDeliverable` -> `proj_save_deliverable` | `proj_deliverables` (new) | Deliverable in Open | The head of the chosen team (`project_assignment`) | Not safe: each call creates another deliverable |
| `projects.deliverable.edit` | Edit, Save deliverable | Manager (all fields); Head of its team (description and date only); same function | Deliverable not Accepted or Cancelled | same | `proj_deliverables` (fields, version), `proj_change_log` (changed date with the reason, changed team) | Fields as saved | Changed date: Project Manager and the team's head (`project_deadline_changed`) | Safe: version check |
| `projects.deliverable.set_status` | Change status | Manager or Head of its team; `proj_set_deliverable_status` | Any; from Accepted or Cancelled only back to In progress with a reason; Accepted needs every task of it done, cancelled or deferred; Deferred and Cancelled need a reason | `setDeliverableStatus` -> `proj_set_deliverable_status` | `proj_deliverables` (status, acceptance stamp, version), `proj_change_log` | The chosen status | To Ready for review with a team: the Project Manager (`project_review_requested`) | Safe by idempotence: no version check, but the function returns without change when the status is already the target |
| `projects.equipment.import_handover` | Import the handover equipment | Shown to a Manager on Work; the rule in the function was not read: `Unverified` | "Import failed — review" line present | `importHandover` (`apps/web/src/lib/actions/inventoryPlanning.ts`) -> `inv_import_handover_requirements` | `Unverified` (Inventory planning; not read) | A handover equipment request, or a new line in the import log | `Unverified` | Stated safe by the code comment and the action's own text ("Running the import again never adds a second one"); the function was not read: `Unverified` |
