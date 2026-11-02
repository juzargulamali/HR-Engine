# My Day on the ENGINIOUS OS design (Stage 3)

One page: a CEO-style overview on top, **People & HR today** continuing below. One greeting, one header, one navigation. Every figure is read through the signed-in person's own session (row-level security decides what they see), every widget appears only for people whose module access allows it, and no figure is shown twice. No database change.

## Page order

1. **Header**: the greeting, the one-sentence "what needs you" (counted from the same list the cards below are built from), the Dubai date, time and weather, and the same primary and secondary actions as before.
2. **Overview strip** (only the figures the person has access to): Active projects, Open enquiries, Live equipment requests. (The decisions count is stated once, in *Needs me*, so it is not repeated as a tile.)
3. **Overview**: *Delivery this week*, *Sales pipeline*, *Project status* on the left; *Needs me* (with *Waiting on others* under it), *My work today*, *Attendance clock* (the existing card), *People today* (live), *Next dispatch* on the right. On a phone: what needs you first, then your own tasks, your clock, then the rest.
4. **People & HR today** (HR view only): four recorded figures, *Attendance today*, *Companies* (expandable), *Upcoming holidays*, *On leave today*, *Birthdays*, *Team distribution*, *HR attention*. (The Quick actions card is gone: it repeated the sidebar. "On leave" opens the attendance register; "Leave requests in review" is a figure only, because the Approvals page lists only what waits on the viewer.)

## Where each widget's data comes from

| Widget | Source | Who sees it |
| --- | --- | --- |
| Active projects | `proj_directory()`: projects that are not completed or archived (the "Ongoing" count of the Projects page) | Projects access |
| Open enquiries, Sales pipeline | the same opportunity loader as Sales (`openPipelineByStage`): open opportunities by stage, counts only (no values or currencies are read) | Sales access |
| Your follow-ups (in the pipeline card) | the existing My Day Sales rules (`attentionItems`, scope "mine") | Sales access |
| Needs me | pending approvals, project budgets waiting for the person (`pbx_inbox()`), Project handovers, scope changes, commercial approvals, Sales handover rows and Project work waiting for the person's review: the same counts as before, each linking to the screen that handles it (task reviews open `/projects/work?show=review`). Other open items (unread discussion) are under "Also open". Every source is read on its own (`Promise.allSettled`): one that fails is its own "could not be loaded" row | everyone (rows only when there is something) |
| My work today | the person's own open tasks (assigned or shared as collaborator) from `loadMyWork`: overdue (oldest first), due today, blocked (reason and who can unblock it), later; each title opens the task panel (`/projects/work?task=`). A task already sent for review is left out (it waits on someone else). The overdue count is not repeated in Needs me | Projects access |
| Waiting on others | what the person submitted themselves, still with someone else: budgets and final expenses (`pbx_inbox()`), their own leave requests, expense claims and Recovery Leave requests (filtered to their own employee record, with the age of the oldest), and their own tasks sent for review. Never counted as a decision for them; no new approval or task system | everyone (rows only when there is something) |
| Delivery this week | the delivery plan items and milestones of live projects the person may open in detail (members and founders), laid on Monday to Sunday; nothing else is drawn | Projects access |
| Project status | the same projects grouped by two facts: a task marked blocked, or a task or milestone past its due date (rule printed on the card) | Projects access |
| Live equipment requests, Next dispatch | the Inventory request list: submitted and in-progress requests, and the first one with lines still to dispatch ("lines dispatched" = equipment that has actually gone out; a shortage is a line stock cannot cover) | Inventory access |
| People today (live) | open clock sessions and the work mode of each open segment | HR view; counts only people the viewer's access lets them read |
| Attendance clock | the existing live card for the signed-in employee | anyone linked to an employee |
| Employees, Recorded present, On leave, Leave requests in review, Attendance today, Companies, Team distribution | the existing company snapshots (recorded attendance and leave, each in the employee's own country calendar and time zone) | HR view (per company overview) |
| HR attention | contracts ending, probation reviews, documents and identity documents expiring: the same counts as before | HR view |

**Live is not recorded.** *People today* is who has a clock session open right now. *Recorded present* is the day's attendance record. They are labelled as different things in both places, and each appears once.

## Render widgets that have no reliable source (flagged)

- **"Dispatches ready" / "3 of 4 equipment lines ready"**: the product has reservations, dispatches and availability checks, but no "ready to dispatch" state. Shown instead: live requests, lines dispatched and lines short, which are real and keep those three things apart.
- **Project "health" donut**: there is no health score and none is invented. It is shown as a count by the two plain facts above, with the rule on the card.
- **Gantt colours by department** (Programming, Content, Engineering) and "Equipment short" bars: plan items have no department and nothing marks a plan item as short of equipment. Bars are coloured by status (in progress, planned, done); milestones are diamonds.
- **Weather-style extras, "Concept · sample data" badges**: not shown; the data is real.
- **Per-item decision titles in "Needs me"** (for example "Approve storyboard revision"): the existing sources are counts; each row is a real count that links to where it is handled. Task titles are on My Day only for the person's own work ("My work today"). Waiting time is shown on "Waiting on others"; it is not shown on the "Needs me" rows (the counts have no age).
- **Notes on scope**: *People today* counts only people the viewer can read under existing access (HR administrators see everyone; a CEO without the HR administrator role sees the people they manage), and says so on the card. *Open enquiries*, *Sales pipeline* and the projects widgets are likewise whatever the person's own access shows.

## Known limits

- The outage state (a data service that does not answer) was not exercised here; each card has its own "could not be loaded" text and a failed read is never shown as zero.
- The Gantt shows a project only when something is scheduled this week; a project with an empty delivery plan is not listed.
