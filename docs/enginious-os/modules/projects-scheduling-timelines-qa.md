# Projects & Tasks: scheduling, client timelines and QA (reference letter Q)

Status (four facts kept apart): **merged:** no (branch `claude/pr3-project-scheduling-timelines-qa`, from `main` at `0dffeba`; draft PR #97). **Required CI:** see the PR. **Hosted database:** both migrations applied by the owner under the file names `20270113000100` and `20270113000200`, both verify files passed, and the signed-in Preview checks passed (owner-reported, 2026-11-15); Claude ran no hosted SQL. **Production:** not deployed. Written from the code, the RLS suite and local browser runs on the isolated stack; nothing was seen signed in on Preview or on a real phone, which is `Unverified`.

Sources: `supabase/migrations/20270113000100_proj_client_timeline_tasks.sql`, `20270113000200_ops_crew_overlaps.sql`; `apps/web/src/app/(app)/projects/[id]/documents/` (`page.tsx`, `client-timeline-task-picker.tsx`, `plan-forms.tsx`, `plan-table.tsx`), `lib/actions/projectsTimelineSelect.ts`, `lib/actions/projectsPlans.ts`, `packages/domain/src/projectPlan.ts`, `lib/pdf/plan-layout.ts`; `lib/operations/model.ts`, `lib/operations/data.ts`, `components/operations/overview-view.tsx`, `app/(app)/operations/page.tsx`; `lib/projects/site-state.ts`, `components/projects/calendar/` (`helpers.ts`, `calendar-views.tsx`, `back-to-calendar.tsx`), `app/(app)/projects/[id]/plan/page.tsx`, `app/(app)/projects/calendar/page.tsx`, `app/(app)/projects/[id]/layout.tsx`, `components/projects/site/site-views.tsx`; `lib/projects/list-extras.ts`, `app/(app)/projects/page.tsx`, `components/projects/project-board.tsx`; `components/projects/delivery/plan-timeline.tsx`; browser checks `apps/web/os-shell-checks/projects-flow.mjs`, `project-scheduling-flow.mjs`, `phone-fit.mjs`.

## 1. Individual tasks on a client timeline

**Where:** a client project's **Files & client plan** (`/projects/[id]/documents`), panel **Client timeline**, under **1. Choose what the client sees**, heading **Individual tasks (optional)**. Shown to the people who may manage the project only (the Project Manager, someone holding temporary project leadership, a founder: `proj_can_manage`); a member sees the issued versions and nothing of the choice.

| Control | What it does | Enforced where |
|---|---|---|
| A tick box per task (never ticked by default; there is no "all tasks") | Puts that task on the next issued timeline | `proj_set_client_timeline_tasks` (manager, open client project, the project's own task, not cancelled, at most 100) |
| **Title the client sees** (appears when a task is ticked; offered from the task's title, required) | The only name of the task a client ever reads | The same function refuses a blank title; the payload uses this title, never the task's own |
| **Save the chosen tasks** | Sends the whole choice (the ticked tasks and their titles) | `saveClientTimelineTasks` -> `proj_set_client_timeline_tasks`; saving twice changes nothing; an empty list clears the choice |
| **2. Preview: what would be issued now** | The payload exactly as it would be issued, with a **Tasks** section when a task is chosen | `proj_plan_preview` (payload and its fingerprint; null for anyone who may not manage) |
| **Issue this timeline** / **Issue a new version** | Freezes exactly the preview | `issueClientTimeline` -> `proj_issue_plan_checked(project, fingerprint, ...)`: refuses, and issues nothing, when the content is no longer the preview ("The timeline changed after you opened the preview...") |

**The allowlist is in SQL** (`proj_client_timeline_tasks_json`): of a chosen task the payload carries `title` (the client title), `start_date`, `due_date` and `status` in client words (`proj_client_task_status`: Planned, In progress (also for a task waiting for review), Done, Postponed). Nothing else of a task is read into a payload: not its internal title, description, assignee, collaborators, priority, the blocked flag or reason, the unblock owner or action, comments, files, outputs or review notes. A cancelled task leaves the timeline; a deleted task leaves with it. The readable form (`planTableRows`) reads those four fields only, so the page table and the PDF cannot show more than the payload allowlist.

**Issued versions are preserved byte for byte.** `proj_issued_plans` is not altered; its guard trigger still refuses any change to an issued payload. The `tasks` key exists in a payload only when at least one task is chosen, so the payload and hash of every project with no chosen task are exactly what they were: applying the migration makes no issued version "outdated", and a version issued before tasks could be chosen renders its own sections only.

**Failed reads say so:** when the tasks cannot be loaded the chooser says so (the preview still shows tasks already chosen); when the preview cannot be loaded the page says so and offers no Issue button.

## 2. Who is booked twice (Operations Overview, Team pressure)

`ops_crew_overlaps(company)` (Operations Manager or founder of that company: `ops_require`) returns each person holding two **confirmed** site commitments whose windows overlap and are not wholly past: a crew place on a confirmed, unfinished site activity of a live project, or a confirmed site booking with its preparation and travel allowance (the two kinds, and the windows, `proj_crew_overlaps` already counts for the Site schedule warning). Each side carries its instants and its local date and time **in the site's own time zone**, worked out in the database.

On the Overview each such person is one item of **Team pressure**: the name, then both assignments, each with its project, its window (for example "18 Nov, 09:00 to 17:00 (Asia/Dubai)") and a link to its exact row on the Site schedule (a booking links to its conflict check). These replace the earlier activity-level line that could not say which person was on both; that line remains only when the new read is not installed or fails, and a failed read says "Who is booked twice could not be loaded".

**Company boundary.** The first assignment is always in the company being viewed. The other is described in full only when the reader holds the Operations right (or is a founder) in that company too. Otherwise it is shown as **"A confirmed assignment in another company (details not shown)"** with its time window: no project name or reference, no title, no venue, no link, and none of these is in the read's answer.

**The office board is unchanged.** `ops_tv_board` is not edited and does not call the new read; a display identity is refused by `ops_crew_overlaps`. Names of people booked twice and links stay off the board (the display contract, `docs/operations-tv-scope.md`, does not list them).

## 3. One site state on every calendar view

`siteActivityState(phase, itemStatus)` in `lib/projects/site-state.ts` is the one function every screen uses for a site activity: **Finished** when the plan item is done, Cancelled when cancelled, otherwise the words of `describeSitePhase` for the phase the database worked out (`proj_site_phase_json`). The project's Plan calendar (`/projects/[id]/plan?mode=calendar`, Site schedule) now words each site activity through it, in **Month, Week and Agenda** alike, from the same read the Site schedule, Work and Operations use (`proj_site_activities_read`); it no longer prints the plan item's stored status. The Projects calendar's site activities, the Site schedule row and Work's Next on site use the same function. An activity reads **Started** only when the phase is `started`, which the database gives only for an explicit start record (`proj_record_site_start`); a start time or a date that has passed, or a stored status of In progress, never reads Started. When the phases cannot be loaded the calendar says so and each open activity reads "State not available".

**Back to Calendar.** A calendar entry's link carries `from=calendar` (the Projects calendar) or `from=plan-calendar` (a project's Plan calendar). On the project it opens, **Back to Calendar** is shown beside "All projects" and returns to the calendar's remembered address: date, view, time zone and Show only filters (`RememberList` / `BackLink` of `components/workspace/list-memory.tsx`, sections `calendar` and `plan-calendar-<project>`). Without a remembered address it opens the plain calendar. A record not opened from a calendar has no such link.

Limit: the Projects calendar's site activities come from a read that leaves finished activities out, so a finished activity is not on My calendar; it reads Finished on the project's Plan calendar and its Site schedule.

## 4. Work package count on the Projects list

A project that has work packages (the team-level packages on its Work page, `proj_deliverables`) shows a small count under its name on the Projects table and on its Board card: accepted of total, for example "1/3 work packages", with "review" beside it when one waits for review. It opens the project's Work page at its work packages. Cancelled packages are not counted; a project with none shows nothing; the count is shown only for projects the person may open in detail. It comes from **one read for the whole list** (beside the existing team and activity reads), never one per row. When that read fails the list says "Work packages could not be loaded just now".

## 5. Work schedule on a phone

Below 640 px the pinned names column is 9 rem (was 10 rem) with tighter padding, and Day, Week and Today are 40 px tall. The chart scrolls sideways inside itself; the page does not. Checked at 390 and 360 px, light and dark, with long names, **in an emulated browser only**.

### Real-device check for the owner (Preview, on an actual phone)
Claude could only emulate a phone. Run this once on a real one:
1. Sign in on the phone as a Project Manager and open a project that has a Project Plan with at least four requirements, one with a long name.
2. Press **Project Plan**, then **Work schedule**. The page must not move sideways when you swipe the page itself.
3. Swipe sideways **inside the chart**: the dates move, the names on the left stay in view, and the page stays still.
4. Read a long name: it wraps onto several lines and is not cut off.
5. Press **Week**, then **Day**: the scale changes each time. Press **Today**: the chart jumps so the column marked Today is in view.
6. Tap a bar: its details open and stay fully on the screen. Tap elsewhere: they close.
7. Turn the phone to landscape and back: nothing overlaps and the page still does not move sideways.
8. Repeat steps 2 to 6 in the other theme (light or dark).

## 6. Tests

RLS: `packages/rls-tests/test/proj-client-timeline-tasks.rls.test.ts` (8), `ops-crew-overlaps.rls.test.ts` (6). Unit: `lib/pdf/plan-document.test.tsx`, `lib/actions/projectsTimelineSelect.test.ts`, `documents/client-timeline-picker.test.tsx`, `lib/operations/model.test.ts`, `operations/operations-pages.test.tsx`, `components/projects/calendar/site-phase-views.test.tsx`, `helpers.test.ts`, `lib/projects/list-extras.test.ts`. Browser (local stack): `projects-flow.mjs` (repaired, and extended with the client timeline tasks), `project-scheduling-flow.mjs` (sections 2 to 5). Counts and verdicts: change log entry of 2026-11-15.
