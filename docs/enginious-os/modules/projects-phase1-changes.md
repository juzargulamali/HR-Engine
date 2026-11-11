# Projects & Tasks Phase 1: what changed, per workflow

Status: written with the Projects & Tasks Phase 1 PR (branch `claude/admiring-cray-uky379`, draft, **not merged**). Verified against the code on that branch by reading the files cited and by the tests named; **not** verified signed in (see "Verification gaps"). One additive migration, `20261230000100_chat_project_groups.sql`, **not applied anywhere by Claude; hosted status `Unverified`**. The full index is [`projects-coverage-index.md`](./projects-coverage-index.md) and the actions are in [`projects-action-catalogue.md`](./projects-action-catalogue.md); rows marked `Gap` in section 1 below are now covered by the per-control references listed there.

Roles used below: **Member** = actively enrolled in the project and still eligible (`proj_is_active_member`); **Manager** = Project Manager, temporary leader or founder of the project's company (`view.canManage`, `proj_can_manage`); **Head** = head of a department team; **Assigner** = holds `assign_pm`. The database enforces every one of these; the screens only hide what would be refused.

## 1. Screens (15 rows)

| # | Screen | Route | Who can open it | Source | Status |
|---|---|---|---|---|---|
| 1 | My Work | `/projects/work` | Any Projects grant (others get a notice) | `app/(app)/projects/work/page.tsx`, `lib/projects/my-work.ts`, `lib/projects/work-logic.ts` | Documented (section 2.1) |
| 2 | Projects directory | `/projects` | Any Projects grant, or linked to a project as Sales | `app/(app)/projects/page.tsx`, `lib/projects/directory.ts` | Documented for filters and unread (2.6); the rest `Gap` |
| 3 | Calendar (cross-project) | `/projects/calendar` | Any Projects grant | `app/(app)/projects/calendar/page.tsx` | `Gap`: unchanged in Phase 1, not re-read |
| 4 | Handovers | `/projects/handovers` | Assigners and named Project Managers (row-level security on `proj_handovers`) | `app/(app)/projects/handovers/page.tsx`, `lib/projects/handover-list.ts`, `components/projects/handover-brief.tsx` | Documented (2.4) |
| 5 | Work (project landing) | `/projects/[id]/work` (also `/projects/[id]`) | Member or founder with details | `app/(app)/projects/[id]/work/page.tsx`, `lib/projects/work-attention.ts`, `components/projects/work-parts.tsx` | Documented (2.2) |
| 6 | Task detail | side panel `?task=<id>` on Work and My Work; page `/projects/[id]/work/tasks/[taskId]` | Member or founder with details | `components/projects/tasks/task-detail.tsx` (one body for both), `task-detail-data.ts`, `task-logic.ts` | Documented (2.3) |
| 7 | Timeline | `/projects/[id]/plan` (old `/timeline`, `/calendar` addresses light it up) | Member or founder | `app/(app)/projects/[id]/plan/page.tsx` | `Gap`: unchanged, entry points only (2.2) |
| 8 | Project Chat | the project's group in the app-wide Chat panel; old address `/projects/[id]/discussion` | **Members only** (active enrolment). A founder who is not enrolled is not a member | `supabase/migrations/20261230000100_chat_project_groups.sql`, `components/chat/*`, `app/(app)/projects/[id]/discussion/page.tsx` | Documented (`app-chat.md` section 9) |
| 9 | Equipment | `/projects/[id]/equipment` | Member or founder; managing it needs `canManageProjectEquipment` | `app/(app)/projects/[id]/equipment/page.tsx` | `Gap`: unchanged; its states are surfaced on Work (2.2) |
| 10 | Budget | `/projects/[id]/budget` | Project Manager, or Finance / view access in the owning company (`pbx_budget_view`) | `app/(app)/projects/[id]/budget/page.tsx` | `Gap`: unchanged |
| 11 | People | `/projects/[id]/people` | Member or founder; changes need Manager | `app/(app)/projects/[id]/people/page.tsx` | `Gap`: unchanged. Adding or removing a person now also adds or removes them from the project's chat (membership is computed) |
| 12 | Files & client plan | `/projects/[id]/documents` | Member or founder | `app/(app)/projects/[id]/documents/page.tsx` | `Gap`: unchanged, entry point only |
| 13 | Changes (feedback and scope) | `/projects/[id]/changes`, `/projects/scope-decisions/[id]` | Member or founder; deciding scope needs `approve_scope` | `app/(app)/projects/[id]/changes/page.tsx` | `Gap`: unchanged |
| 14 | History | `/projects/[id]/history` | Member or founder | `app/(app)/projects/[id]/history/page.tsx`, `history/change-log.ts` | `Gap`: unchanged; its change log feeds the Work preview (2.2) |
| 15 | Completion | `/projects/[id]/complete` | Manager only | `app/(app)/projects/[id]/complete/page.tsx`, `complete-client.tsx`, `complete-helpers.ts` | Documented (2.5) |

Totals: 15 rows; 6 `Documented` (1, 4, 5, 6, 8, 15), 1 partly (2), 8 `Gap`.

## 2. Changed workflows: who can act, what it does, where the user goes next

### 2.1 My Work
| Control | What it does | Who | Next |
|---|---|---|---|
| Cards **My tasks**, **Waiting for my review**, **Blockers I can help clear** | Three separate lists; each card's number is the number of rows its list shows. My tasks = open tasks assigned to or shared with the person, **without** their own work that is in review. Blockers = open blocked tasks that name the person as the one to unblock, plus blocked tasks with nobody named on a project they manage | Any Projects grant; lists come from the person's own session (row-level security) | The chosen list, same page (`?show=`) |
| Chips **Overdue**, **Sent for review: waiting on someone else**, **My team's open tasks** | Overdue = My tasks past their due date. Sent for review = the person's own tasks in review (nothing for them to do). My team = every open task of projects they manage and departments they head | My team only for people who lead something (`parseMyWorkShow` refuses it otherwise) | Same page |
| Search, Show, Project, Table / Board, Columns | The shared list toolbar (applies as chosen, chips, Clear); the address holds it all | same | A task opens in the side panel (`?task=`); closing it returns to the same list |
Source: `lib/projects/my-work.ts` (`loadWorkRows`: `blockers`, `waiting`), `lib/projects/work-logic.ts`. Tests: `work-logic.test.ts`.

### 2.2 Work (project landing)
| Section (in reading order) | What it shows | Who | Next |
|---|---|---|---|
| **What needs doing** (first, on a phone too) | **Needs you**: blockers the viewer can clear, reviews they may give, their own overdue and due-today tasks; for a Manager also overdue milestones, a failed equipment import and equipment drafts. **Waiting on someone else**: blockers someone else clears, the viewer's work in review, requests waiting for Warehouse; for a non-manager the milestones and drafts. Each line: a label (never colour alone), the title as a link, the owner, the due date or "No due date recorded" | Member or founder with details | The task (side panel), the milestone list, or Equipment |
| Equipment lines | Only what the system can confirm: **Equipment draft needs submission** (a request in `draft`), **Import failed — review** (the last handover import failed and no handover request exists), **Waiting for Warehouse** (a request `submitted`). A failed read says the equipment state could not load | as above; the import control only for a Manager | **Import the handover equipment** runs the existing import again (idempotent). Submitting stays an explicit action on Equipment |
| **Delivery summary** | Next milestone, next site booking, equipment state, each with a link | Manager only | Timeline, the site bookings, Equipment |
| Task list, review queue, milestones | As before (Table / Board, grouping, filters) | as before | Task side panel |
| **Recent activity** (right rail) | The four newest lines of the member-visible change log (dates, status, people), each linked to where that record lives. **No chat message and no task comment is copied here** (`entity_type = message` is excluded) | Member or founder | The record's screen; "Full history" |
| **Go to** | Files & client plan, Timeline, Dependencies (when one is not confirmed), Site bookings (when one is upcoming), each with the fact that makes it relevant | same | That screen |
| **Chat** (project header) | Opens the project's group in the Chat panel over the current page | Members only (the button is absent otherwise) | The Chat panel |
Source: `lib/projects/work-attention.ts`, `lib/projects/equipment-state.ts`, `components/projects/work-parts.tsx`. Tests: `work-attention.test.ts`.

### 2.3 Task detail (side panel and full page: one component)
| Part | What it shows | Who can act | Next |
|---|---|---|---|
| **Next step** (first) | Status, priority, due date or "No due date recorded", one sentence saying whose step it is; for a blocked task the reason and who can unblock it (or that nobody is named) | Everyone who can read the task | |
| Main button | Only moves the person is already allowed: **Start**; **Send for review** (or **Mark done** on a task without review); for a reviewer **Accept and complete** and **Request changes**. A blocked task shows no main button (the blocker leads) | Assignee; Head or Manager as reviewer (`allowedTaskMoves`, `proj_set_task_status`) | Saved in place; a move needing a reason opens the existing small form |
| Status, Assignee, Due, More | As before (reassign, block, unblock, edit) | As before | |
| **Comments** | Moved up, directly under the controls. About this task only | Any reader of the task (not on a finished project) | |
| Details, Dependencies, History | Below, unchanged | | |
Source: `task-detail.tsx`, `task-logic.ts` (`primaryMoves`, `nextStep`), `task-controls.tsx` (`TaskPrimaryAction`). Tests: `task-logic.test.ts`. Quick add task was already three fields with the rest under More details; it is unchanged.

### 2.4 Handovers
| Control | What it does | Who | Next |
|---|---|---|---|
| The page's three reads | (1) every open handover (submitted, PM assigned, clarification asked), oldest first; (2) one page of accepted and withdrawn ones (`?page=`, 20 per page); (3) the brief named by `?handover=<id>`, read by id. History can never push out an open one | Row-level security on `proj_handovers` decides each read | |
| **The handover you opened** | The brief from a direct link, in full, first | Whoever may read that row; otherwise "That handover is not available to you" | |
| **Accept handover** | `proj_accept_handover`: creates exactly one project with the viewer as Project Manager | Only the assigned Project Manager, status PM assigned | **The new project's Work page.** A repeated accept opens the same project (unchanged database behaviour) |
| **Ask Sales a question** | `proj_request_handover_clarification`: the handover goes back to Sales with the question | Only the assigned Project Manager | Stays on Handovers; the brief shows "Current clarification" until Sales resubmits |
| **Assign / Change Project Manager** | `proj_assign_handover_pm` | Assigner | Stays |
| Brief layout | Current clarification, **Agreed scope** (with exclusions), **Site and dates**, **Equipment**, **Dependencies and risks**, then notes. The Sales reference links to the enquiry's handover page (opens only with Sales access) | Reader of the row | |
| My Day link | Each waiting handover links to `/projects/handovers?handover=<id>` | | That brief |
Source: `handovers/page.tsx`, `lib/projects/handover-list.ts`, `handover-brief.tsx`, `handover-actions.tsx`, `lib/actions/projectsCore.ts` (`acceptHandover`), `lib/my-day/attention.ts`. Tests: `handovers/page.test.tsx`, `handover-list.test.ts`. Submission, PM assignment, clarification, resubmission and acceptance rules are unchanged (no SQL changed for handovers). The structured event-edition link is Phase 2: the edition still arrives as text in the notes.

### 2.5 Completion
| State | What the page shows | Confirmation |
|---|---|---|
| Review read failed | "Could not load the unfinished work of this project", what it covers, **Retry** (reads again in place; typed decisions are kept) | Off |
| Evidence read failed (client project) | "Could not load the uploaded completion evidence", **Retry** | Off |
| Database refused the person | "You do not have access to this project's completion review" (no Retry: it is not a loading problem) | No form |
| Successful empty review | "Nothing is unfinished" | On once the evidence and note are valid |
| Successful empty evidence | "No completion evidence uploaded yet" | As before |
The server-side checks (`proj_complete_project`) and the evidence rules are unchanged. Source: `complete/page.tsx`, `complete-client.tsx`, `complete-helpers.ts` (`completionReadState`, `completionLoadProblems`). Tests: `complete-client.test.tsx`.

### 2.6 Filters (Projects directory, My Work, Work)
All three already used the shared toolbar the Enquiries list uses (`components/workspace/list-toolbar.tsx`; Work uses its compact form `components/os/filter-bar.tsx`): the same filter icon, applied as chosen, a count and chips for filters in use, Clear. Phase 1 adds one behaviour to the compact form: two filters changed in quick succession are both kept. None of the three lists is paged, so there is no page to reset; the compact form now accepts `resetKeys` for a list that is. Opening a record keeps search, sort, view and filters (they are in the address; `RememberList` / `BackLink` restore them from a full page).

## 3. Phase 2 boundary (not built, on purpose)
Structured event-edition links on the handover and project; calendar integration; equipment booking review after a delivery-date change; the Inventory readiness calculation. Phase 1 uses the current equipment request states only.

## 4. Verification gaps
* No signed-in run: the session cannot reach the Preview host or run the local data service. Layout and interaction were checked on a temporary, uncommitted page with the real components and fictional data at 1280 and 390 wide (`docs/projects-phase1-screenshots/*-harness.png`).
* The app's calls through the real data service (`chat_project_group`, `chat_my_groups` with the new columns, the three Handovers reads, `inv_requests` and `inv_import_log` for the Work page) are proven only against stand-ins and, for the SQL, on a real PostgreSQL as the signed-in roles.
* The Chat thread itself (posting, mention picker) was not seen in a browser for a project group; it is the same component as for Sales groups.
* `Gap` rows above were not re-read.
