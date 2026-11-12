# Projects & Tasks coverage index

Status: built from the code on the Projects & Tasks Phase 1 branch `claude/admiring-cray-uky379` (merged as PR #82 (merge `30c7895adc75f834a60b00ed3bca7015b1654282`, 2026-11-11)). **Code read only; nothing was run to produce it** (no app, database or hosted project). It lists every reachable Projects & Tasks screen, tab, panel, dialog, form, filter, download and legacy route, how to reach it, who can see it, what it is for and where its detailed reference is. It was assembled from the `## Coverage rows` table at the end of each reference file; the row text is theirs. **Status values:** `Documented` = a per-control reference exists and was written against the code; `Unverified: ...` = documented, with the named point not confirmed in code or by a run. Hosted facts (database state, Preview, Production) are not stated anywhere in these files.

Reference files (all under `docs/enginious-os/modules/`):

* **D** [`projects-directory-and-my-work.md`](./projects-directory-and-my-work.md): Module shell, directory, My Work, cross-project calendar, the project frame and lifecycle.
* **W** [`projects-work-and-tasks.md`](./projects-work-and-tasks.md): A project's Work page, tasks, milestones and deliverables.
* **T** [`projects-timeline-site-and-files.md`](./projects-timeline-site-and-files.md): Timeline, site bookings, dependencies, Files & client plan.
* **P** [`projects-people-changes-history-completion.md`](./projects-people-changes-history-completion.md): People & access, Feedback & changes, History, Completion and reopening.
* **H** [`projects-handovers-equipment-and-workflow.md`](./projects-handovers-equipment-and-workflow.md): Handovers, the Equipment tab, the Budget tab, the end-to-end workflow trace.
* **L** [`projects-delivery-plan.md`](./projects-delivery-plan.md): the Delivery Plan (Phase 2, part 1; merged in PR #84, `e12c22f`; migration `20261231000100` applied on hosted, owner-reported): deliverables by zone, breakdown, release, corrections, proposals, Excel import and export.
* **R** [`projects-closeout-report.md`](./projects-closeout-report.md): the Project Closeout Report (Phase 2, part 2; merged in PR #84, `e12c22f`; migration `20270101000100` applied on hosted, owner-reported): evidence snapshot, Review data to be sent, the AI or facts-only draft, checks, approval, PDF.
* **C** [`app-chat.md`](./app-chat.md) section 9: the project's Chat group (membership, the end of the Discussion tab, old Discussion links).
* **O** [`operations.md`](./operations.md): Operations (Phase 2B; branch `claude/projects-phase-2b-operations`, not merged; migration `20270102000100` not applied by Claude; on hosted it is treated as applied from the owner's report of 2026-11-12 that the signed-in Preview checks of PR #86 passed, `Unverified` by Claude): the Operations Manager, Overview, Upcoming Work, the event edition on projects, equipment readiness and booking review, the Operations path into project Chat and the Archived section.
* [`projects-action-catalogue.md`](./projects-action-catalogue.md): every action that changes data. [`projects-phase1-changes.md`](./projects-phase1-changes.md): what Phase 1 changed, per workflow (who can act, what it does, where the user goes next), the Phase 2 boundary and the verification gaps.

Who can see: **Member** = actively enrolled in the project and still eligible (`proj_is_active_member`); **Operations Manager** = holds the Projects capability `operations` for the project's company (Phase 2B): reads the project in full without being enrolled; they can comment on a task, raise a correction and post in the project's conversation, under their own name; they cannot add a file or a link (that needs a place on the project or founder: triggers `trg_proj_files_contributor`, `trg_proj_upload_intents_contributor`), create, assign, move or review tasks, edit the Delivery Plan, decide corrections or changes, manage or complete the project, or see restricted files or the commercial record (`operations.md` section 2; where a row below says "Member (details view)" or "Readers of the project's details", an Operations Manager is included once migration `20270102000100` is applied); **Manager** = Project Manager, temporary leader or founder of the project's company (`proj_can_manage`); **Head** = head of a department team; **Assigner** = holds `assign_pm`. Capabilities are in `packages/domain/src` (Projects permissions) and `docs/enginious-os/03-roles-access-and-approvals.md`. The database enforces each rule; the screens only hide what would be refused.

**Planned, not built (Phase 2):** calendar integration. It has no row below. (The Delivery Plan, Phase 2 part 1, is section 7; the Project Closeout Report, part 2, is section 8; Operations, Phase 2B, with the event edition on the handover and project, the equipment booking review after a date change and the readiness statement, is section 9. Phase 2B is on a branch: not merged, its migration not applied by Claude.)


## 1. Module shell, directory, My Work, cross-project calendar, the project frame and lifecycle (D)

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 1 | 1. Projects shell: "not installed" notice, load failure, access notice | screen | Any `/projects/*` address | Signed-in people; data only with Projects access or a Sales link | Decide whether anything of Projects is shown | D 1 | Documented |
| 2 | 2. Menu entries My Work, Projects, Calendar, New internal project (search only), Handovers | panel | Sidebar and phone menu drawer, group "Projects & Tasks" | Projects access; Sales-linked people get "Projects" only | Reach the module | D 2 | Documented |
| 3 | 3. Projects directory, table | screen | Menu > Projects, `/projects` | Projects access, or Sales-linked | Find a project; see what needs the person | D 3 | Documented |
| 4 | 4. "Needs you" strip | panel | Top of `/projects` | Projects access with something waiting | Handovers, reviews, overdue tasks, unread chat | D 3 | Documented |
| 5 | 5. Directory search and filters (Show, Kind, Status, Company), chips, Clear | filter | Toolbar on `/projects` | Everyone on the page (Company only with more than one) | Narrow the list | D 3 | Documented |
| 6 | 6. Directory sort headings | filter | Table headings on `/projects` | Everyone on the page | Order the list | D 3 | Documented |
| 7 | 7. Next milestone column | panel | Table on `/projects`, Show "Ongoing" | Members and founders (others see "Members only") | The next dated open milestone | D 3 | Documented |
| 8 | 8. Unread chat badge on a project row or card | panel | `/projects` table and board | Enrolled members | Unread messages of that project's chat | D 3 | Unverified: a failed unread read shows no badge and no message |
| 9 | 9. Directory board | screen | `/projects?view=board` | Projects access | Projects by status; request a status move | D 3.1 | Documented |
| 10 | 10. Summary side panel | panel | Row or card of a project the person is not part of; `/projects?open=<id>` | Anyone who sees the row | The authorised summary; handover status for linked Sales | D 3.2 | Unverified: an unreadable handover row is shown as no handover section |
| 11 | 11. Change status dialog | dialog | Board card "Move to…"; Manage project > Change status | Manager (board: Project Manager or founder only) | Move, hold, resume or archive a project | D 4, 10 | Documented |
| 12 | 12. New internal project dialog | dialog | Button "New internal project" on `/projects`; `/projects?add=1` | Assigner or founder | Create an internal project in three fields | D 5 | Documented |
| 13 | 13. New internal project page | form | Menu search "New internal project"; `/projects/new` | Projects shell; the form only for an Assigner or founder | Create an internal project with all fields | D 5 | Documented |
| 14 | 14. Project reference code form | form | Inside the "no project reference code yet" warning of both new-project forms | Founder of that company | Set the company's project reference code | D 5 | Documented |
| 15 | 15. My Work | screen | Menu > My Work, `/projects/work` | Projects access (Sales-linked people get a notice) | The person's tasks, reviews and blockers | D 6 | Documented |
| 16 | 16. My Work cards and chips (My tasks, Waiting for my review, Blockers I can help clear, Overdue, Sent for review, My team) | filter | Top of `/projects/work`; `?show=` | Projects access; My team only for people who lead something | Choose the list | D 6 | Documented |
| 17 | 17. My Work toolbar: search, Show, Project, Clear, Columns, Table / Board | filter | `/projects/work` | Projects access | Narrow and arrange the list | D 6 | Documented |
| 18 | 18. Handovers waiting notice | panel | `/projects/work` | Assigners and named Project Managers with a waiting handover | Go to Handovers | D 6 | Documented |
| 19 | 19. My projects | panel | `/projects/work` | Members of an ongoing project | Open a project or its chat in one click | D 6 | Unverified: failed directory, milestone or unread reads are not reported in this section |
| 20 | 20. Project notices with "Mark all as read (N)" | panel | Bottom of `/projects/work` | The person's own notices | Read and clear project notices | D 6 | Unverified: a failed "Mark all as read" shows no message; no test found |
| 21 | 21. Task side panel on My Work | panel | A task row; `/projects/work?task=<id>` | Anyone who can read the task | Task detail (documented with task detail, `projects-coverage-index.md` 2.3) | D 6 | Documented (entry point only) |
| 22 | 22. Calendar, My calendar | tab | Menu > Calendar, `/projects/calendar` | Projects access | Own deadlines, reviews, milestones, site bookings | D 7 | Documented |
| 23 | 23. Calendar, Company calendar with Project spans | tab | `/projects/calendar?scope=company` | Projects access; Sales-linked people (own linked projects only) | Project dates at summary level | D 7 | Unverified: the empty text is drawn under a load error; the company list silently loses companies when the directory read fails |
| 24 | 24. Calendar controls: Month / Week / Agenda, previous, Today, next, Show times in, Show only, Apply, Company and Show | filter | `/projects/calendar` | as rows 22 and 23 | Choose period, zone and kinds | D 7 | Documented |
| 25 | 25. One-project frame: back link, banner, tabs | screen | Any project row or link, `/projects/<id>/...` | Members and founders; summary viewers get the banner and a notice | Identify the project and move between its sections | D 8 | Documented |
| 26 | 26. Chat button in the project banner | panel | Project banner | Enrolled members | Open the project's group in the Chat panel | D 8 | Documented (the Chat panel itself is in `app-chat.md`) |
| 27 | 27. Manage project menu | panel | Project banner | Members and founders (items by right) | Edit details, Change status, People & access, Feedback & changes, Files & client plan, History, Complete project, Reopen project | D 8 | Unverified: no test of the menu's rules was found |
| 28 | 28. Edit project details dialog | dialog | Manage project > Edit details | Manager, ongoing project | Change name, priority, dates, client, location, time zone (and scope for internal projects) | D 8.1 | Documented |
| 29 | 29. Reopen project dialog | dialog | Manage project > Reopen project | Holder of the reopen right, on a completed or archived project | Reopen with a reason | D 8.2 | Documented |
| 30 | 30. Discussion tab (old) | tab | Project tabs, only where project chat groups do not exist yet | Members and founders | The old conversation page | D 8 | Unverified: which environments are in that state (hosted) |
| 31 | 31. Summary-only project page | screen | `/projects/<id>` for a summary viewer; "Full page" in the side panel | Projects access holders who are not members (ongoing projects); Sales-linked people | The authorised summary | D 9 | Documented |
| 32 | 32. `/projects/<id>` for a member or founder | legacy route | Any link to the project | Members and founders | Redirects to Work | D 9, 12 | Documented |
| 33 | 33. `/projects?view=finished` | legacy route | Old bookmark | Everyone on the directory | Same as Show "Completed and archived" | D 12 | Documented |
| 34 | 34. `/projects/access` | legacy route | Old address | Anyone | Redirects to People & Access | D 2, 12 | Documented |
| 35 | 35. `/projects/<id>/discussion` | legacy route | "Chat" in My projects; mention and reply notices | Members and founders | Sends an enrolled member to Work with the chat group open | D 12 | Documented |
| 36 | 36. My Day entries from Projects | panel | My Day (`/`) | Projects access | Tasks, reviews, handovers, scope decisions, unread chat, delivery and status cards | D 11 | Unverified: the link of the "tasks sent for review" count row was not read |

## 2. A project's Work page, tasks, milestones and deliverables (W)

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 37 | Work page | screen | `/projects/[id]/work`; Projects, choose a project; tab "Work" | Reader (member, or founder of the company) | The project's work in one place | W 2 | Documented |
| 38 | `/projects/[id]` for a member | legacy route | Old links to the project | Reader | Redirects to Work (summary-only viewers get the Summary panel instead) | W 1.2, 2 | Documented |
| 39 | Work page banners (read-only, On hold, client timeline out of date, reopened) | panel | Top of Work | Reader; the timeline warning for a Manager | State of the project that affects the work | W 2 | Documented |
| 40 | Work page failed read | panel | Automatic | Reader | Says the work could not load, with Try again | W 2 | Unverified: the render was not run; the reads listed in 14 row 10 fail quietly |
| 41 | What needs doing | panel | Top of Work | Reader, live project | Needs you / Waiting on someone else | W 3 | Documented |
| 42 | Import the handover equipment | form | Under the "Import failed — review" line | Manager | Run the handover equipment import again | W 3.2 | Unverified: the function behind it (`inv_import_handover_requirements`) was not read |
| 43 | Equipment state warning | panel | Automatic when the equipment read fails | Reader, live project | Says equipment facts may be missing | W 3.2 | Documented |
| 44 | Delivery summary | panel | Top of Work | Manager, live project | Next milestone, next site booking, equipment | W 3.2 | Documented |
| 45 | Summary cards (Open tasks, Need attention, In review) | filter | Top of Work | Reader | Counts that open the matching list | W 3.2 | Documented |
| 46 | Task card: This week mode | panel | Default view of Work | Reader | Up to six tasks due this week, overdue or blocked | W 4 | Documented |
| 47 | Task card: Tasks (full list) | panel | "View all tasks", any filter, Board or grouping | Reader | Every task the filters allow | W 4 | Documented |
| 48 | Search tasks | filter | Task card toolbar | Reader | Search title and description | W 4.1 | Documented |
| 49 | Filters panel (Show, Assignee, Department, Deliverable, Narrow to) | filter | "Filters" button | Reader | Narrow the list; chips and Clear all | W 4.1 | Documented |
| 50 | Group by | filter | Filters panel, Table view | Reader | Group by department, milestone, status or assignee | W 4.1 | Documented |
| 51 | Table / Board switch | filter | Task card toolbar | Reader | Two views of the same rows | W 4.1 | Documented |
| 52 | Columns menu | filter | Task card footer, Table view | Reader | Optional columns | W 4.1 | Documented |
| 53 | Column sort | filter | Table headings | Reader | Sort by Task, Assignee, Due, Status, Priority | W 4.2 | Documented |
| 54 | Task table | panel | Table view | Reader; inline changes per role | Rows with inline Status, Assignee and Due | W 4.2 | Documented |
| 55 | Task board | panel | Board view | Reader; moves per role | Cards by status with drag and "Move to…" | W 4.3 | Unverified: drag behaviour was read, not seen in a browser |
| 56 | Task list empty states | panel | Automatic | Reader | No tasks yet / Nothing due this week / No tasks match | W 4.1 | Documented |
| 57 | Add task | dialog | "Add task" (or `?add=1`) | Any member for themself; Head for their team; Manager for anyone | Create a task with three fields and optional details | W 5 | Documented |
| 58 | Plan menu | panel | "Plan" in the task card | Manager, live project | Add milestone, Add deliverable | W 4.1, 7 | Documented |
| 59 | Waiting for your review | panel | Work, under the task card | Head, Manager with something to review | The viewer's review queue | W 6 | Documented |
| 60 | Upcoming milestones strip | panel | Work, main column | Reader | Where the project stands against its milestones | W 6 | Documented |
| 61 | Next on site | panel | Right rail | Reader who is not managing a live project | The next site booking | W 6 | Documented |
| 62 | Recent activity | panel | Right rail | Reader | Four newest change-log lines with links | W 6 | Documented |
| 63 | Go to | panel | Right rail | Reader | Shortcuts with the fact that makes each relevant | W 6 | Documented |
| 64 | Project details and Agreed scope | panel | Right rail | Reader | Read-only who, when, where and scope | W 6 | Unverified: folding on a phone (`C/os/collapsible.tsx`) not read |
| 65 | Completion record | panel | Bottom of Work on a completed project | Reader | Read-only completion facts | W 2 | Documented |
| 66 | Milestones & deliverables section | panel | Bottom of Work; `?ms=1#milestone-list` | Reader | Milestones and deliverables with their controls | W 7 | Documented |
| 67 | New milestone | dialog | "Add milestone"; Plan > "Add milestone" | Manager | Add a milestone | W 7.1 | Documented |
| 68 | Edit milestone | dialog | "Edit" on a milestone | Manager | Change title, description, date, flags | W 7.1 | Documented |
| 69 | Milestone status | dialog | "Change status" on a milestone | Manager | Move, accept, defer, cancel, reopen | W 7.1 | Documented |
| 70 | New deliverable | dialog | "Add deliverable"; Plan > "Add deliverable" | Manager | Give a piece of work to a department | W 7.2 | Documented |
| 71 | Edit deliverable | dialog | "Edit" on a deliverable | Manager; Head of its team (description and date only) | Change a deliverable | W 7.2 | Documented |
| 72 | Deliverable status | dialog | "Change status" on a deliverable | Manager; Head of its team | Move, accept, defer, cancel, reopen | W 7.2 | Documented |
| 73 | Task side panel | panel | `?task=<id>` on Work (and on My Work) | Reader of the task's project | The task beside the list | W 8 | Documented |
| 74 | Task full page | screen | `/projects/[id]/work/tasks/[taskId]`; "Full page"; notice links | Reader | The same task on its own address | W 8 | Unverified: what a failed read shows on this page (shared error boundary) |
| 75 | Task not available / Task could not be loaded | panel | Automatic in the side panel | anyone | Tell a missing task from a failed read | W 8.1 | Documented |
| 76 | Next step box and main button | panel | Top of the task | Reader; buttons per role | Whose step it is and the one thing to do | W 8.2, 10 | Documented |
| 77 | Status menu | form | Table cell, task detail | Assignee, Head, Manager per the moves table | Change status | W 4.2, 10 | Documented |
| 78 | Status move dialog | dialog | A move that needs a reason or a decision | per the moves table | Reason or confirmation before the move | W 9.1 | Documented |
| 79 | Assignee menu | form | Table cell, task detail | Head of the task's team, Manager | Reassign in place | W 4.2, 9.3 | Documented |
| 80 | Reassign this task | dialog | More > "Reassign" | Head of the task's team, Manager | Reassign with a note | W 9.3 | Documented |
| 81 | Change due date | dialog | Pencil beside the due date | Assignee, Head, Manager | New date, reason, effect on dependent tasks | W 9.2 | Documented |
| 82 | Report a blocker | dialog | "Report a blocker" on the task | Assignee, Head, Manager | Record what blocks the task and who unblocks it | W 9.4 | Documented |
| 83 | Clear the blocker | dialog | More > "Clear blocker" | Assignee, Head, Manager, named unblocker | Clear the blocker | W 9.5 | Documented |
| 84 | Edit task | dialog | More > "Edit task" | Assignee, Head, Manager (leader fields for Head and Manager) | Full edit, dependencies, collaborators | W 9.6 | Documented |
| 85 | Task comments | form | Task detail, "Comments" | Reader (form hidden on a finished project) | Comment on this task | W 8.2, 9.7 | Unverified: the function does not refuse a finished project (14 row 1) |
| 86 | Task details, dependencies, history | panel | Task detail | Reader | Read-only facts, related tasks, the task's history | W 8.2 | Documented |
| 87 | Task notices | panel | My Work notices list; links open the task's full page | The recipient | Tell people about assignments, reviews, blockers, moved dates | W 12 | Unverified: surfaces other than My Work that show these notices |
| 88 | Jump to a task… | legacy route | Old Discussion page `/projects/[id]/discussion`, only without chat groups installed | Reader | Open a task from the old discussion | W 13 | Unverified: not seen; the page is a fallback |

## 3. Timeline, site bookings, dependencies, Files & client plan (T)

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 89 | Timeline (the Plan section) | tab | Project > Timeline; `/projects/<id>/plan` | Member | The project's Delivery and Site plans in three forms | T 2 | Documented |
| 90 | Which plan: Delivery / Site | filter | Top of the Timeline tab; `plan=` | Member | Choose the plan | T 2 | Documented |
| 91 | How to show it: List / Calendar / Timeline | filter | Top of the Timeline tab; `mode=` | Member | Choose the form | T 2 | Documented |
| 92 | Delivery timeline | panel | Timeline > Delivery > List or Timeline | Member; Manager edits | The build stages | T 3 | Documented |
| 93 | Site production timeline | panel | Timeline > Site > List or Timeline | Member; Manager edits | The site stages | T 3 | Documented |
| 94 | Use the suggested timeline (Create suggested stages) | form | Empty Delivery or Site plan | Manager | Start from the suggested stages | T 3.1 | Documented |
| 95 | Add to the delivery timeline / Add to the site production timeline | dialog | Add item | Manager | Add a timeline item | T 3.1, 3.2 | Documented |
| 96 | Edit “<title>” | dialog | Edit on an item row | Manager | Change a timeline item | T 3.1, 3.2 | Documented |
| 97 | Delete “<title>”? (timeline item) | dialog | Delete on an item row | Manager | Remove a timeline item | T 3.1 | Documented |
| 98 | Delivery timeline as bars / Site production timeline as bars | panel | Timeline > How to show it > Timeline | Member | A bar picture of the dated items | T 3.1 | Documented |
| 99 | Dependencies on others | panel | Timeline > Site > List or Timeline | Member; Manager edits | What the project waits for from outside | T 4 | Documented; order of undated rows Unverified: not seen |
| 100 | Add a dependency | dialog | Add dependency | Manager | Record a dependency | T 4 | Documented |
| 101 | Edit dependency (including setting Confirmation) | dialog | Edit on a dependency row | Manager | Change or confirm a dependency | T 4 | Documented |
| 102 | Delete “<label>”? (dependency) | dialog | Delete on a dependency row | Manager | Remove a dependency | T 4 | Documented |
| 103 | Site bookings | panel | Timeline > Site > List or Timeline; `#bookings` | Member; Booker acts | People reserved on site | T 5 | Documented |
| 104 | Book someone on site | dialog | Add booking | Booker | Add a tentative booking | T 5 | Documented |
| 105 | Edit booking | dialog | Edit on a booking card | Booker of that person | Change a booking | T 5 | Documented |
| 106 | Overlaps for <person> at <location> (Check conflicts) | panel | Check conflicts on a card; `check=<bookingId>` | Booker of that person | List overlapping bookings across projects | T 5 | Documented; failed read shown as no overlap (gap G2) |
| 107 | Confirm booking | form | Tentative booking card | Booker of that person | Confirm with the overlap check | T 5 | Documented |
| 108 | Confirm even if it overlaps (needs a reason) | form | Tentative booking card | Booker who is an Override holder | Confirm despite an overlap with a recorded reason | T 5 | Documented |
| 109 | Cancel this booking? | dialog | Cancel booking on a card | Booker of that person | Cancel a booking | T 5 | Documented |
| 110 | Plan calendar | panel | Timeline > How to show it > Calendar; `mode=calendar` | Member | The plan's dates on a calendar | T 6 | Documented |
| 111 | Calendar view (Month / Week / Agenda), Previous period, Today, Next period | filter | Calendar toolbar; `view=`, `date=` | Member | Choose the period | T 6 | Documented; helper test titles Unverified: not re-read |
| 112 | Show times in / Show only / Apply | filter | Calendar toolbar; `tz=`, `kind=` | Member | Viewing zone and kinds | T 6 | Documented |
| 113 | Timelines & site (old page) | legacy route | `/projects/<id>/timeline` (also `?check=`) | Lands on section 2 rules | Forwards to the Plan section | T 8 | Documented |
| 114 | Project Calendar (old page) | legacy route | `/projects/<id>/calendar` | Lands on section 2 rules | Forwards to the Plan calendar | T 8 | Documented |
| 115 | Files & client plan | screen | Manage project > Files & client plan; `/projects/<id>/documents` | Member | Files, links and the client timeline | T 9, 10 | Documented; failed reads shown as empty (gap G1) |
| 116 | Files and links | panel | Top of Files & client plan | Member (restricted rows: Manager) | The project's files and links | T 9 | Documented |
| 117 | Upload a file | form | Add a file or a link > Upload a file | Member (completion evidence, Restricted: Manager) | Add a checked private file | T 9 | Documented |
| 118 | Add a link | form | Add a file or a link > Add a link | Member (completion evidence, Restricted: Manager) | Add an https link | T 9 | Documented |
| 119 | Open (file or link) | download | Open on a file row | Anyone who can see the row | Open a link or download a file through a 60 second signed address | T 9 | Documented |
| 120 | Remove / Confirm remove / Keep | form | Remove on a file row | The person who added it, or a Manager | Remove a file or link | T 9 | Documented |
| 121 | Client timeline | panel | Second panel of Files & client plan | Member (client projects) | Issued versions of what the client is told | T 10 | Documented |
| 122 | What would be issued now | panel | Client timeline panel | Manager | Preview of the next version | T 10 | Documented |
| 123 | Issue the client timeline | dialog | Issue this timeline / Issue a new version | Manager | Freeze a numbered version | T 10 | Documented |
| 124 | Issued versions (Version <n> cards, Outdated badge and warning) | panel | Client timeline panel | Member | Versions with issued, sent and accepted facts and the out-of-date rule | T 10 | Documented |
| 125 | Record that version <n> was sent | dialog | Record as sent | Manager | Record the fact that it was sent | T 10 | Documented |
| 126 | Record that the client accepted version <n> | dialog | Record client acceptance | Manager | Record the client's acceptance | T 10 | Documented |
| 127 | Show this version as a table | panel | Disclosure on a version card | Member | The frozen content as a table | T 10 | Documented |
| 128 | Client timeline PDF | download | Download PDF; `/projects/<id>/documents/plans/<planId>/pdf` | Member | The issued version as a PDF | T 11 | Documented; behaviour when rendering throws Unverified: no handler in the route |

## 4. People & access, Feedback & changes, History, Completion and reopening (P)

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 129 | Manage project menu items People & access, Feedback & changes, History, Complete project, Reopen project | panel | Project banner, **Manage project** | Founder or member (details level); Complete: Manager on a live project; Reopen: Reopener on a finished project | Entry to every screen below | P 0.2 | Documented |
| 130 | People & access | screen | Manage project > People & access; `/projects/[id]/people` | Founder or member | Who is on the project and in which role | P 1 | Documented |
| 131 | Members | panel | On People & access | Founder or member; Actions column: Manager, live project | Member list, roles, department, open tasks | P 1.1 | Documented |
| 132 | Change Project Manager | dialog | Members panel header | Assigner who can open the page, live project | Name another Project Manager | P 1.1 | Documented |
| 133 | Department (of a member) | dialog | Member row, **Department** | Manager, live project | Put a member in a department team | P 1.1 | Documented |
| 134 | Remove from project | dialog | Member row, **Remove** | Manager, live project; not for the Project Manager or a department head | End a person's access, hand over their open tasks | P 1.1 | Documented |
| 135 | Add a person | form | Under the Members table | Manager, live project | Enrol a person with Projects access or a linked Sales person | P 1.1 | Unverified: where "Projects > Access" named in its empty text is |
| 136 | Department teams | panel | On People & access | Founder or member; Actions: Manager, live project | Teams inside the project and their heads | P 1.2 | Documented |
| 137 | Add department team / Edit department team | dialog | Panel header **Add department team**; team row **Edit** | Manager, live project | Create or change a team and its head | P 1.2 | Documented |
| 138 | Remove department team | dialog | Team row **Remove** | Manager, live project | Remove a team with no open work | P 1.2 | Documented |
| 139 | Temporary project leadership | panel | On People & access | Project Manager or founder, live project | Give a member the Project Manager's project powers until a date | P 1.3 | Documented |
| 140 | Appoint (temporary leader) | form | In that panel | Project Manager or founder | Appoint until a date | P 1.3 | Documented |
| 141 | End temporary leadership | dialog | **End now** on a leader's line | Project Manager or founder | End it before the date | P 1.3 | Documented |
| 142 | Sales relationship | panel | On People & access | Manager, client project | Sales people linked to the project | P 1.4 | Documented |
| 143 | Link another Sales person | form | In that panel | Assigner or founder, live project | Add a Sales link | P 1.4 | Documented |
| 144 | Remove Sales link | dialog | **Remove link** on a line | Assigner or founder | End a Sales link | P 1.4 | Documented |
| 145 | What each role can do | panel | On People & access | Founder or member | Plain description of the four project roles | P 1.5 | Documented |
| 146 | Feedback & changes | screen | Manage project > Feedback & changes; `/projects/[id]/changes` | Founder or member | Client feedback, scope, scope change proposals | P 2 | Documented |
| 147 | Client feedback | panel | On Feedback & changes | Founder or member | List of what the client asked for | P 2.1 | Documented |
| 148 | Record client feedback | dialog | **Record feedback** | Manager, live project | Record a request, its kind, target, person and deadline | P 2.1 | Unverified: wording of the notification to the responsible person |
| 149 | Update this feedback | dialog | **Update** on an entry | Manager, or the responsible member, live project | Status, resolution, evidence; reassign (Manager) | P 2.1 | Documented |
| 150 | Scope | panel | On Feedback & changes | Founder or member | Original agreed scope beside the current scope | P 2.2 | Documented |
| 151 | Propose a scope change | dialog | **Propose a scope change** | Manager, live project | Record a proposal and, optionally, its cost effect | P 2.2 | Documented |
| 152 | Scope change proposals | panel | On Feedback & changes | Founder or member; cost effect: commercial reader | List of proposals and decisions | P 2.3 | Documented |
| 153 | Decide this scope change | dialog | **Decide** on a Proposed entry, or on the stand-alone page | Scope approver, live project | Approve or reject with a reason | P 2.3, 3 | Documented |
| 154 | Withdraw this proposal? | dialog | **Withdraw** on a Proposed entry | Manager, live project | Withdraw an undecided proposal | P 2.3 | Documented |
| 155 | Cost effect (restricted) | dialog | **Edit cost effect** on an entry | Commercial reader, live project | Record or change the cost effect | P 2.3 | Documented |
| 156 | Scope change decision | screen | My Day row "Scope change waiting for your decision"; `/projects/scope-decisions/[scopeChangeId]` | Scope approver or founder of the project's company, member or not (founders and members are redirected to the project's page) | Read one proposal and decide it without project access | P 3 | Unverified: what the page shows immediately after a decision |
| 157 | History | screen | Manage project > History; `/projects/[id]/history` | Founder or member | Handover snapshot, completions, change log | P 4 | Documented |
| 158 | Sales handover | panel | On History, client projects | Founder or member | The brief as accepted | P 4 | Documented |
| 159 | Completion and reopening | panel | On History | Founder or member | Every completion and its reopening | P 4 | Documented |
| 160 | Change log | panel | On History | Founder or member | Latest 100 member-visible changes | P 4 | Documented |
| 161 | Audit note | panel | Under the change log | Holder of the audit right, or founder | Says the audit trail exists and is not shown here | P 4 | Unverified: where the audit trail itself is read |
| 162 | Complete project | screen | Manage project > Complete project; `/projects/[id]/complete` | Details level can open it; the form: Manager on a live project | Completion review, evidence, note | P 5 | Documented |
| 163 | Complete project: already finished, not a Manager, refused | panel | Same address in those states | As stated per state | Says why there is no form | P 5.1 | Unverified: which database answer produces the refused state |
| 164 | Completion review and evidence form (with failed-read states and Retry) | form | On Complete project | Manager | Decide every unfinished item, record the confirmation and note | P 5.2 | Unverified: whether typed decisions survive a visit to Documents in the same tab |
| 165 | Reopen project | dialog | Manage project > Reopen project | Reopener who can open the project, finished project | Reopen with a reason | P 6 | Documented |

## 5. Handovers, the Equipment tab, the Budget tab, the end-to-end workflow trace (H)

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 166 | Handovers | screen | Sidebar, Projects, Manage: Handovers; `/projects/handovers` | Projects access; rows per `proj_handovers_select` | Assign a Project Manager, accept, ask Sales | H 1, 1.1 | Documented |
| 167 | The handover you opened | panel | `/projects/handovers?handover=<id>` (My Day, Open brief) | Reader of that row | One brief in full, first | H 1.1 | Documented |
| 168 | Waiting on you as Project Manager | panel | Handovers | Named Project Manager | Handovers to accept or question | H 1.1 | Documented |
| 169 | Waiting for a Project Manager to be named | panel | Handovers | Assigner | Handovers to assign | H 1.1 | Documented |
| 170 | Open, waiting on someone else | panel | Handovers | Reader of the rows | Open handovers that are another person's step | H 1.1 | Documented |
| 171 | Accepted and withdrawn (history, Newer / Older) | filter | Handovers, `?page=` | Reader of the rows | Paged history, 20 per page | H 1.1 | Documented |
| 172 | Assign Project Manager / Change Project Manager | form | On a handover shown in full | Assigner | Name the Project Manager | H 1.1, 1.2 | Documented |
| 173 | Your decision as Project Manager (Accept handover) | form | On a handover waiting on the viewer | Named Project Manager | Create the project | H 1.1, 1.2 | Documented |
| 174 | Ask Sales a question | form | Decision box | Named Project Manager | Send the brief back with a question | H 1.1, 1.2 | Documented |
| 175 | Handover brief (clarification, scope, site and dates, equipment, risks, notes) | panel | On every handover shown in full | Reader of the row | The delivery brief, read only | H 1.1 | Documented |
| 176 | Handover process strip | panel | On every handover shown in full | Reader of the row | Five steps and what is next | H 1.1 | Documented |
| 177 | Handover notices | panel | Notification list, My Day, My Work, Projects | The receiver | Tell the next person | H 1.3 | Documented |
| 178 | Equipment | tab | Project, tab Equipment; `/projects/[id]/equipment` | Member (details view); summary viewers get a notice | Requests, what is out, notes | H 2.1 | Documented |
| 179 | Equipment page states (not installed, could not load, no access, switched off, finished) | panel | Equipment tab | As the state says | Never show a failed read as empty | H 2.1 | Unverified: no page test found |
| 180 | New equipment request | dialog | Equipment tab, button | Manager, Warehouse | Create a draft request | H 2.2 | Documented |
| 181 | Equipment still out | panel | Equipment tab | Member | What is dispatched and not returned | H 2.2, 2.7 | Documented |
| 182 | Not covered yet | panel | Equipment tab, when a line is short | Member | Shortages and their plan | H 2.2 | Documented |
| 183 | Sales handover (import log, Import the handover equipment / Run the import again) | panel | Equipment tab, client project | Manager, Warehouse | Import the brief's equipment as a draft | H 2.2 | Unverified: failed import-log read is ignored |
| 184 | Requests list and request row | panel | Equipment tab; `?request=<id>` | Member | One row per request | H 2.2 | Documented |
| 185 | Request (facts, notices, Submit to the warehouse, Open the workspace) | panel | Open a request row | Member reads; Manager and Warehouse act | Prepare and submit | H 2.3 | Documented |
| 186 | Cancel this request | dialog | Request, More | Manager, Warehouse | Cancel a request | H 2.3 | Documented |
| 187 | Planning dates (Save the dates / Change the dates) | form | Request | Manager, Warehouse | Eight dates and the time zone | H 2.3 | Documented |
| 188 | Sent and returned | panel | Request, once something was dispatched | Member | Sent, Returned, Still out | H 2.3, 2.7 | Documented |
| 189 | Add an item | form | Request, Equipment lines | Manager, Warehouse | Add one line | H 2.3 | Documented |
| 190 | Add from a technology template | form | Request, Equipment lines | Manager, Warehouse | Add a template's lines | H 2.3 | Documented |
| 191 | Equipment lines table | panel | Request | Member | Needed, Reserved, Dispatched, Returned, Outstanding | H 2.4 | Documented |
| 192 | Change quantity or note | dialog | Line, More | Manager, Warehouse | Edit a line | H 2.4 | Documented |
| 193 | Propose a substitute | dialog | Line, More | Manager, Warehouse | Offer a listed alternative | H 2.4 | Documented |
| 194 | Accept or decline the substitute | dialog | Line, button | Manager | Decide a proposed substitute | H 2.4 | Documented |
| 195 | Need to buy or rent | dialog | Line, More | Manager, Warehouse | Record a shortage plan | H 2.4 | Documented |
| 196 | Cancel this line | dialog | Line, More | Manager, Warehouse | Cancel a line | H 2.4 | Documented |
| 197 | Reservations list and Release this reservation | dialog | Under a line | Member reads; Manager and Warehouse release | See and release reservations | H 2.4 | Documented |
| 198 | Reserve | dialog | Line, button | Warehouse who can see the project | Reserve stock for a line | H 2.4 | Documented |
| 199 | Dispatch & return notes | panel | Equipment tab; `?note=<id>#notes` (My Day) | Member; drawn only when the project has notes | The warehouse's recorded lists | H 2.5 | Documented |
| 200 | Acknowledge / Confirm this list | form | On a waiting note | Manager | Acknowledge the recorded list | H 2.5 | Documented |
| 201 | Report a difference | form | On a note | Manager | Tell the warehouse what differs | H 2.5 | Documented |
| 202 | Withdraw the report | form | On a note with an open difference | Manager | Withdraw a difference | H 2.5 | Documented |
| 203 | Answer the difference | form | On a note with an open difference | Warehouse who can see the project | The warehouse's answer | H 2.5 | Documented |
| 204 | Note PDF (Download PDF, Open to print) | download | On every note; `/projects/[id]/equipment/notes/[noteId]/pdf` | Readers of the note | The note as a document | H 2.6 | Unverified: document content not read |
| 205 | Budget | tab | Project, tab Budget; `/projects/[id]/budget` | Project Manager; budget readers of the owning company | Budget, funds, expenses, settlement | H 3 | Unverified: Project Budget & Expenses reference not written |
| 206 | Budget page states (not installed, denied, error) | panel | Budget tab | As the state says | Denied and failed are told apart | H 3 | Documented |
| 207 | Budget sections (Budget, Funds, Actual expenses, Settlement) | panel | Budget tab, `?section=` | Per the budget's own rules | The four sections, heading level | H 3 | Unverified: Project Budget & Expenses reference not written |
| 208 | Discussion address | legacy route | `/projects/[id]/discussion` (old links and notices) | Member is sent to `/projects/[id]/work?chat=<group>`; a non-member is told where the chat is | Keep old links working | H 4 (step 5); `app-chat.md` section 9 | Documented |
| 209 | Workflow trace | panel | This file | Not a screen | Who does what, end to end | H 4 | Unverified: Inventory send-out and receive-back labels |

## 6. Project Chat (C)

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 210 | Project Chat group | panel | The floating **Chat** button on any signed-in page, then the project under **Projects**; or the **Chat** button in the project header | Members only (active enrolment; `chat_is_member`). A founder who is not enrolled is not a member | The project's one conversation: read, reply, @mention, unread counts | C app-chat.md 9 | Documented (database tests `chat-project-groups.rls.test.ts`; the thread for a project group was not seen in a browser) |
| 211 | Chat button in the project header | panel | Project banner, beside the team avatars | Members only; absent for anyone else and on a database without project groups | Opens the project's group over the current page | C app-chat.md 9 | Documented |
| 212 | `?chat=<group id>` on any signed-in page | legacy route | A link (old Discussion links arrive this way) | Opens only a group the server lists for the person; otherwise a notice says it is not available | Opens one group in the panel and removes the parameter | C app-chat.md 9 | Documented |
| 213 | `/projects/[id]/discussion` | legacy route | Old links and old mention or reply notices | Member: redirected to `/projects/[id]/work?chat=<group>`. Can open the project but not enrolled: a notice, no conversation. Summary only: back to the project | Keeps old Discussion addresses working after the tab is removed | C app-chat.md 9 | Documented (`discussion/page.test.tsx`) |
| 214 | Discussion tab and page (old) | tab | Only on a database WITHOUT project chat groups | Members and founders (the old rule) | The earlier conversation surface; also the rollback state | C app-chat.md 9; `discussion/discussion-client.tsx` | Unverified: the old page's controls were not re-documented (it is replaced once the migration is applied) |
| 215 | Group search in the Chat panel | filter | Chat panel, when the person has more than eight groups | Anyone with groups | Finds a group by name or reference | C app-chat.md 9 | Documented |

## 7. Delivery Plan and its Excel import and export (L)

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 216 | Delivery plan tab | tab | Project, tab **Delivery plan**; `/projects/[id]/delivery` | Readers of the project's details | The plan by zone, what waits for a decision, who defines each section | L 3 | Documented |
| 217 | Add deliverable / Edit deliverable | dialog | **Add deliverable**; **Edit** on a deliverable | Manager | Create or change a deliverable row; a released row becomes a proposal | L 3, 4 | Documented |
| 218 | Add breakdown line / Edit line | dialog | **Add line**; **Edit** on a line | Manager; the section's delegate | Create or change a line; released becomes a proposal; booked equipment is refused | L 3, 4 | Documented |
| 219 | Remove deliverable / Remove line | dialog | **Remove** | Manager; the section's delegate (lines) | Take unreleased rows out of the plan | L 3 | Documented |
| 220 | Release the plan / Release this deliverable | dialog | **Release plan**; **Release** | Manager | Says what will be created, then creates tasks and draft equipment lines once | L 3 | Documented |
| 221 | Who defines each section | form | Bottom of the tab | Manager | Delegate a section to a member | L 3 | Documented |
| 222 | Raise a correction | dialog | **Correction** on a deliverable or line; the scope button; "Raise a correction" in task detail | Readers of the project's details | Send a correction to the relevant lead; tells the Project Manager | L 3 | Documented |
| 223 | Corrections waiting for a decision | panel | Top of the tab while one is open | Readers; decided by the lead or the manager | Accept or decline, with a note | L 3 | Documented |
| 224 | Proposed changes to released work | panel | Top of the tab while one is proposed | Readers; decided by the manager | Approve, reject or withdraw a proposal | L 3, 4 | Documented |
| 225 | Decisions | panel | Bottom of the tab | Readers | The latest decided corrections and changes, with who and why | L 3 | Documented |
| 226 | Download template | download | **Download template**; `/api/projects/[id]/delivery-plan/template` | Readers | The empty workbook with examples and instructions | L 5 | Documented |
| 227 | Export Excel | download | **Export Excel**; `/api/projects/[id]/delivery-plan/export` | Readers | The plan as a workbook with read-only progress | L 5 | Documented |
| 228 | Import Excel | screen | **Import Excel**; `/projects/[id]/delivery/import` | Manager; section delegates | Upload, preview (Add, Update, Unchanged, Needs attention), resolve, confirm | L 5 | Documented |

## 8. Project Closeout Report (R)

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 229 | Closeout report | screen | **Manage project > Closeout report**; `/projects/[id]/closeout` | Manager (others are told who the Project Manager is) | The internal report: review, draft, approve, download | R 5 | Documented |
| 230 | Generate closeout report | link | The **Closeout report** panel on Files & client plan; the link under Complete project | Manager | Opens the Closeout report screen | R 5 | Documented |
| 231 | Review data to be sent | panel | First thing on the screen; **Review data and write again** | Manager | Source categories, team names, optional text with tick boxes, what is withheld, missing or cut, and that generating sends the reviewed content to Anthropic | R 5.1 | Documented |
| 232 | Send to Anthropic and write the draft / Write a facts-only draft | form | Bottom of the review | Manager | Write or rewrite the one draft, with or without the AI provider | R 5.1, 5.2 | Documented |
| 233 | The draft (Recorded facts, sections, Sources, marks) | panel | After a draft is written | Manager | Read and edit the narrative against its sources | R 5.3, 5.4 | Documented |
| 234 | Save edits / Approve version / Discard draft | form | Bottom of the draft | Manager | Save, fix a version, or drop the draft | R 5.4 | Documented |
| 235 | Approved versions | panel | Bottom of the screen | Manager | Each fixed version, readable in place | R 5.5 | Documented |
| 236 | Download PDF | download | On an approved version; `/projects/[id]/closeout/[reportId]/pdf` | Manager | The approved report as a PDF marked internal | R 5.5 | Documented |

## 9. Operations (O) (Phase 2B; branch `claude/projects-phase-2b-operations`, draft PR #86, not merged; code read only, nothing seen signed in by Claude; rows 240 to 244, 247, 258 and 261 to 267 written against commit `16d6f42`)

### 9.1 The Operations screens

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 237 | Operations (menu module with Overview and Upcoming Work) | panel | Sidebar, **Operations**, directly before Projects & Tasks; on a phone, **More**, then the menu drawer | Operations Manager or Projects founder of at least one company | Entry to the two screens | O 3.1 | Documented |
| 238 | Operations shell states (not installed, could not load, "You are not an Operations Manager", no longer an Operations Manager) | panel | `/operations`, `/operations/upcoming` | As the state says | Never show a refusal or a failed read as empty | O 3.2, 4, 5.3 | Documented |
| 239 | Company chooser | filter | Both screens, `?company=<id>` | Operations Manager of two or more companies | One company at a time | O 3.3 | Documented |
| 240 | Operations Overview | screen | **Operations > Overview**; `/operations` | Operations Manager or founder of the company (`ops_require`) | What needs a decision, what goes on site soon and which projects may miss a date. Redesigned 2026-11-12: rows 241 to 244 and 261 to 265 are its parts. A failed read shows no figure or label | O 4, 5.1 | Documented |
| 241 | Needs my decision (N) | panel | Overview, `#decisions`; first on a phone | Same | Six recorded situations with their owner, since when, the reason and one action | O 4.2 | Documented |
| 242 | Coming up from Sales, **Open Upcoming Work** | panel | Overview, lower left | Same | The first five flagged enquiries by event, with date, venue and the next unresolved item | O 4.8 | Documented |
| 243 | Project health (label counts, one card per project with evidence links, readiness bar and **Project chat**; **How the label is decided**) | panel | Overview, `#health` | Same | On track, Needs attention, At risk or Not enough information, from recorded facts; not a score. Replaces the Upcoming delivery cards and "Most relevant issue" of the first version | O 4.7 | Documented |
| 244 | Team pressure (N) | panel | Overview, lower right | Same | People on two projects whose dates overlap, and overdue reviews. Shortages and overdue returns moved to row 265; partial dispatch is no longer listed | O 4.9 | Documented |
| 245 | Upcoming Work | screen | **Operations > Upcoming Work**; `/operations/upcoming` | Operations Manager or founder of the company | The enquiries Sales flagged, through the allowlisted read | O 5.2, 6 | Documented |
| 246 | Upcoming Work search and filters (**Stage**, **Next step with**), Clear | filter | Toolbar; `?q=`, `?stage=`, `?next=` | Same | Narrow the flagged enquiries | O 6.1 | Documented |
| 247 | Flagged enquiry card (event and venue; Dates, Expected decision, Provisional Project Manager, Next unresolved item; the rest under **More**) | panel | Upcoming Work | Same | One flagged enquiry made to be scanned, with no commercial data | O 6.2, 6.3 | Documented |
| 248 | **Plan** (dialog "Plan <reference>": provisional Project Manager, risk, capacity conflict, Ask Sales to confirm) | dialog | On a flagged enquiry card | Same; saved by the Operations Manager or founder of the enquiry's company | Record Operations' planning note; books nothing | O 6.4 | Documented |
| 249 | **Assign a Project Manager** / **Open the handover** | link | On a flagged enquiry card with a handover; on Needs my decision | Same | Opens the handover at `/projects/handovers?handover=<id>` (rows 167, 172) | O 6.2, 8 | Documented |
| 261 | Summary cards: Needs my decision, Installations in the next 14 days, Equipment issues, Upcoming Sales work | link | Overview, top (`#decisions`, `#installations`, `#equipment`, `/operations/upcoming`) | Same | Four figures, each the length of the list it opens; "—" and "Could not be loaded" when the Upcoming Work read failed | O 4.1 | Documented |
| 262 | Delivery timeline, next 30 days | panel | Overview, beside the decision queue | Same | Installation, show and dismantling dates in date order; enquiry dates marked Tentative until won; dismantling only for flagged enquiries | O 4.3 | Documented |
| 263 | Next installations (N), with health label and readiness bar | panel | Overview, `#installations`; second on a phone | Same | Projects starting within 14 days; the bar only with a real number of lines to reserve | O 4.4 | Documented |
| 264 | Upcoming delivery by week | panel | Overview | Same | A bar chart that is also a list: this week and five more, Later, Already started, No date recorded | O 4.5 | Documented |
| 265 | Equipment issues (N) | panel | Overview, `#equipment` | Same | Shortage, reservations not released, return overdue, booking to review, request not sent (within 14 days), complete still out, each with its owner | O 4.6 | Documented |

### 9.2 Changes on existing Projects screens

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 250 | Event edition on the project details card, **Open event in Sales** | panel | Project, Work, details card | Readers of the project's details; the link only for someone who can read the edition in Sales | The edition the project was handed over with (a copy) | O 8.1; W (Phase 2B note) | Documented |
| 251 | Event edition line and **Event edition** filter in the directory | filter | `/projects`, toolbar; `?edition=<id>` | Everyone who sees the row; the filter only when a visible project has an edition | Find the projects of one edition | O 8.1; D (Phase 2B note) | Documented |
| 252 | Event edition on the handover brief | panel | On every handover shown in full | Reader of the row | The edition as submitted | O 8.1; H 2.8 | Documented |
| 253 | Readiness line on each equipment request | panel | Project, Equipment, request rows | Readers of the tab | Not sent to the warehouse yet, No lines, Reserved, Partly ready, Short, Partly dispatched, Dispatched, Still out, Returned, with counts | O 9.1; H 2.8 | Documented |
| 254 | Review equipment booking, **Open request <code> to change its dates**, **Mark as reviewed** | form | Project, Equipment, top (`#equipment-review`), also on a finished project; and on the request's own page in Inventory, `/inventory/requests/[id]` | Readers of the tab read; Manager or Warehouse mark as reviewed | Say that a committed date changed after equipment was requested; record that someone looked | O 9.2 | Documented |
| 255 | Delivery complete · equipment still out | panel | Project, Equipment and Work, on a completed or archived project with units out | Readers | What is out per request and when it is expected back | O 9.3 | Documented |
| 256 | Releasing unused reservations failed when the project finished | panel | Project, Equipment, finished project, while something is left to release | Readers | Say that the release failed and that the warehouse releases by hand | O 9.4 | Documented |
| 257 | Equipment readiness in the delivery summary; **Review equipment booking** line in What needs doing | panel | Project, Work | Manager (delivery summary); readers (What needs doing) | The same readiness and review, where the Project Manager starts | O 9.1, 9.2; W 3 (Phase 2B note) | Documented |
| 258 | Chat: **Archived (N)** section | panel | Chat panel, below Sales and Projects | Anyone with the group of a completed or archived project (both since commit `93ec0f2`; archived only before) | Keep finished projects' conversations out of the way, read-only, without dropping their unread counts; a direct link still opens them | O 10; C app-chat.md 10 | Documented |
| 259 | Chat: project groups through Operations (tag **Operations**, the note at the top of the thread, "(Operations)" after the name in the mention list) | panel | Chat panel; **Open project chat** on the Overview | Holders of the `operations` capability itself for the project's company | Read and post in the company's project chats without joining the project | O 10; C app-chat.md 10 | Documented |
| 260 | Project notices: Review equipment booking, Sales flagged an enquiry, Sales answered your question | panel | Project notices (My Work, My Day) | The receiver | Tell the Project Manager and the Operations Managers | O 11 | Documented |

### 9.3 Operations on My Day (added 2026-11-12, commit `4086841`)

| # | Entry | Kind | How to reach it | Who can see it | Purpose | Reference | Status |
|---|---|---|---|---|---|---|---|
| 266 | My Day: **Operations** summary card (Waiting for a decision, Next installations, Most urgent issue, **Open Operations**) | panel | My Day `/`, above the main grid | Operations Manager of a company, or Projects founder; nobody else | Oversight from the same two Operations reads; a company whose read failed is named and never counted as zero | O 14.1 | Documented |
| 267 | My Day, Needs me: "Sales answered the Operations question" and "Review equipment booking" | panel | My Day `/`, the attention list | The Operations Managers of the enquiry's company; the Project Manager of the project | What the person can act on; a handover to assign is listed once by the existing Projects source, not again | O 14.2 | Documented |

## Totals

267 entries: 238 `Documented`, 29 `Unverified` (each names its open point). Per section: D 36, W 52, T 40, P 37, H 44, C 6, L 13, R 8, O 31 (section 9: 18 Operations screens, rows 237 to 249 and 261 to 265; 11 changes on existing Projects screens, rows 250 to 260; 2 on My Day, rows 266 and 267; all 31 are `Documented` from the code, none was seen signed in by Claude). *(260 entries and O 24 until the Overview redesign of 2026-11-12; rows 240 to 244, 247 and 258 were rewritten in place and keep their numbers.)*

