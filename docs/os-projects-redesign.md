# Projects & Tasks on the ENGINIOUS OS design (Stage 2)

The approved visual direction applied to the real, signed-in Projects module. No database change, no new data: every number and list is read from the same tables and functions as before, through the signed-in person's own session (so row-level security still decides what they see).

## Where everything is now

| Before | Now |
| --- | --- |
| Tabs: Overview, Work, Plan, Discussion (and Equipment under Manage) | Four tabs: **Work**, **Timeline** (the Plan page: Delivery/Site, List/Calendar/Timeline, and the old `/timeline` and `/calendar` addresses), **Discussion**, **Equipment**. Everything else stays under **Manage project**. |
| Overview page `/projects/[id]` | Members and founders are redirected to **Work**, which now carries the overview: summary cards, milestone strip, "Needs action" (blocked tasks, work waiting for your review, overdue milestones), project details (Project Manager, temporary leader, team, dates, installation, event, client, location, open client feedback), agreed scope and exclusions, technologies, the on-hold notice, the out-of-date client-timeline notice, the "completed then reopened" notice, and the completion record. Summary-only people (directory users, linked Sales) still get the summary page at `/projects/[id]`. |
| "Current blockers", "Next milestone", progress bar | "Needs action" and the milestone strip (progress sentence still comes from `proj_milestone_progress`: accepted required milestones). |
| Work page task list | **This week** (default): open tasks due this week, overdue or blocked, at most six, with "showing X of Y" and **View all tasks (N)**. **All tasks** (`?tasks=all`, or any filter, grouping or the Board) keeps the full toolbar, Columns, Table/Board, grouping by department/milestone/status/assignee, sort, and the side panel. Old links with `?group=`, `?show=`, `?status=`, `?view=board`, `?task=` keep working. |
| Status and assignee `<select>`s | The same controls as pills that open a menu of the moves the person may make. The same server actions run (`setProjectTaskStatus`, `reassignProjectTask`); moves that need a reason, a review or a decision still open their form first; stale edits are refused in words and the old value returns. |
| Review queue | Still on the Work page (below the list) and in "Needs action". |
| Milestones & deliverables (add/edit/status) | Unchanged section on the Work page ("Manage milestones" in the strip opens it). |
| My Work | Same lists, filters, Board and notices; header and summary cards (My open tasks, Overdue, Waiting for my review, My team's open tasks) now link to the same `?show=` filters. |

## What the cards count

| Card | Counted as | Opens |
| --- | --- | --- |
| Open tasks | tasks that are to do, in progress or ready for review | All tasks |
| Due this week | open tasks due Monday to Sunday of the current week (Dubai date) | This week |
| Need attention | open tasks that are blocked or overdue (same definition as the filter) | All tasks, filter "Need attention" |
| In review | tasks ready for review | All tasks, status "Ready for review" |

Nothing is estimated: no health score, trend or percentage is shown except "accepted required milestones" as it was before.

## Known limits

- "Team activity" from the concept render is not shown: there is no reliable activity feed to read yet, and the rail shows only what is real.
- The Equipment tab keeps its existing page; it is restyled only through the shared components.
