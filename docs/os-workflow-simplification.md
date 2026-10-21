# Simpler Sales & CRM and Projects & Tasks (workflow simplification)

A focused usability change to the two existing modules. Nothing was rebuilt: the same pages, server actions, database functions, validation and permissions
do the work. What changed is how many places a person has to visit, and how much they have to fill in, to do everyday jobs.

**No database change, no new migration, no new environment variable, no scheduled job.** Existing records, history and functional URLs are untouched.

## The interaction model (used in both modules)

| Pattern | What it means here |
|---|---|
| **Table by default** | Enquiries, Projects, My Work and a project's Work are tables with live search and filters, sortable headings and a small **Columns** menu. |
| **Optional Board** | A **Table / Board** switch shows the *same* records by stage or status. A move is only a request: the card stays where it is until the server accepts the change; a refused move leaves it in place and says why. Dragging is a convenience, every card also has a **Move to** control that works with a keyboard and on a phone. |
| **One Add** | One prominent button per workspace opens a short **Quick Add** form (title and the few things the rules require). Everything else is behind **Add more details**. `?add=1` opens it from anywhere. |
| **Details in a side panel** | Clicking a record opens it beside the list (`?open=ID` or `?task=ID` in the address). The list, filters, sort and scroll position are exactly as they were; Back closes the panel; the address can be shared; **Full page** opens the record's own page. On a phone the panel is a full screen. |
| **Quick changes only where safe** | A status, an assignee or a date can be changed in place only where the person already has that right, and only for changes that need no reason, review or second person. Anything else opens the existing small form. |
| **Infrequent actions under More** | Hold, Reopen, Reassign, Close as won/lost, Manage project… are in one **More** menu with their normal confirmation forms. |
| **Honest saving** | A change is shown as saved only after the server says so; a failure puts the old value back with the reason; entered text survives an error; edits that are not saved ask before they are thrown away; a stale record is refused rather than silently overwritten. A failed load says it failed (it is never shown as "no records"). |

## Navigation

### Sales & CRM

| Before (9 + 2 destinations) | Now |
|---|---|
| Overview, Opportunities, Pipeline, New enquiry, Follow-ups, Proposals, Clients, Reports, Settings, Access | **Follow-ups** (default), **Enquiries**, **Reports** |
| Settings, Access (shown in the main list) | Under a **Manage** heading, only for people who may use them |
| Proposals & quotes, Clients & contacts, full New enquiry form, Pipeline board | Still there, kept out of the menu: a **Shared lists** menu on Enquiries, the *Open the full form* link in Quick Add, the Board view, and the command-palette search |

### Projects & Tasks

| Before (up to 6 + 9 tabs) | Now |
|---|---|
| Projects, My Work, Calendar, Handovers, New internal project, Access | **My Work**, **Projects**, **Calendar** |
| Handovers, Access | Under **Manage** for authorised people (Handovers also when one is waiting for you) |
| New internal project | **New internal project** button on Projects (and `/projects/new` still works) |
| A project's nine tabs: Overview, Milestones & tasks, Timelines & site, Calendar, People, Discussion, Feedback & changes, Documents, History | **Overview**, **Work**, **Plan**, **Discussion**, plus a **Manage project** menu (Edit details, People & access, Change status, Complete or Reopen, Feedback & changes, Files & client plan, History) |

The module opens on **My Work** for people who only take part in projects, and on **Projects** for founders, PM assigners and Project Managers (one click to the other).

## Where every previous action now lives

### Sales & CRM

| Previously | Now |
|---|---|
| `/sales` Overview | Redirects to Follow-ups. Reminders (and the throttled reminder refresh, mark-read) and "needs attention" (hold review due, no next action, no first response; mine/everyone) are at the top of Follow-ups; overdue and due-today are its groups; "my opportunities" is Enquiries filtered to **Mine**; recent activity is in the enquiry panel; per-currency pipeline totals are in the Board column headings and in Reports |
| Pipeline | Enquiries → **Board** (`/sales/pipeline` redirects there, keeping the company filter) |
| Opportunities list | Enquiries table (default columns: Enquiry, Agency/client, Owner, Stage, Next action, Due, Installation/show date; optional: Value, Source, Availability, Created, Company) |
| New enquiry | Quick Add (title, agency or end client, source, next action + due; owner picker only where the full form shows it). `/sales/new` is unchanged and linked from Quick Add |
| Complete / reschedule / cancel a follow-up | **Complete** is the row action (what happened, then what happens next, or a hold with reason and review date); reschedule and cancel under the row's More |
| Enquiry page tabs (Overview, Scope & dates, Activity, Proposals & files, Commercial) | The enquiry panel (same sections: Overview, Updates, Proposals & files, Scope & dates, Commercial) and the unchanged full page |
| Add note / call / client response | **Add update** in the panel |
| Move stage, Hold, Resume, Close as won/lost, Reopen, Reassign owner, Edit details | The panel's **More actions** and, for stage moves, the Board (Hold, Won and Lost open their normal forms; Reopen stays a restricted, audited action) |
| Contacts, proposals, files, availability, quote reference, closure history, handover package | Inside the panel or one click away on the full page; unchanged |
| Settings, Access | Same pages, under Manage |

### Projects & Tasks

| Previously | Now |
|---|---|
| Directory (filter form + Apply, Live/Finished tabs) | Projects table or Board with live filters; **Show** = Ongoing or Completed and archived |
| New internal project page | Quick Add on Projects; Board status moves open the existing status form (reason / review date), Completed has no lane (use Complete) |
| "Needs you" card, handover queue | One line of links on Projects; "Handovers waiting on you" strip in My Work and Projects |
| My Work (three groups + review list) | My Work table or Board: **My tasks / My team / Overdue / Waiting for review**; **My projects** strip (next milestone and a direct Discussion link); notices below |
| Task page actions (Start, Send for review, Accept, Request changes, Reopen, Defer, Cancel) | Status control in the table, board and panel: plain moves save at once, anything needing a reason or review opens the existing small form |
| Edit task, Reassign, Block / Clear blocker, comments, dependencies, history, due-date change | The task panel (and the unchanged full task page, which uses the same component) |
| New task | **Add task**: title, assignee, due date; rest under *Add more details* |
| New milestone / deliverable, edits, acceptance | **Plan** menu on Work and the collapsible *Milestones & deliverables* section |
| Timelines & site, Calendar tabs | **Plan**: Delivery or Site, as List, Calendar or Timeline (`/timeline` and `/calendar` of a project redirect there) |
| People, Feedback & changes, Documents, History, Complete | Same pages, from **Manage project** |
| Discussion | Same (replies, mentions, unread, older-message paging); a **Jump to task** list and a **Files** link were added. Sending a message never creates or completes work |

## What did not change (on purpose)

* Every stage rule: Hold needs a reason and review date, Won needs evidence (and value rules), Lost needs a reason, Reopen needs the capability and is audited, a completed follow-up of the last open one needs a next action or a hold.
* Review rules: a person never approves their own reviewed work; Ready for review is distinct from Done; reassigning is limited to the PM, acting PM, founder or the department head of the team.
* Access: Sales sees only its linked projects (summary and handover status); people with Projects access see ongoing company-project summaries and, for projects they are not on, no private detail (the **Next milestone** column is not even requested for those rows); membership revocation still cuts every path; commercial data stays restricted.
* HR is independent: no attendance, Recovery Leave, manager-line, payroll or reimbursement change.
* Client projects still come only from an accepted Sales handover (one project, idempotent); Quick Add on Projects creates internal projects only.

## Measured effort (same sample scenario, real browser)

Method and script: `apps/web/os-shell-checks/workflow-steps.mjs`. Every click and every field filled or chosen counts as one step, starting on My Day; a job counts only when its result is in the database. The same seeded scenario was used on the old build (current `main`) and the new one.

| Job | Steps before | Steps after | Screens before | Screens after |
|---|---|---|---|---|
| 1. Add an enquiry | 7 | 7 | 3 | 2 |
| 2. Complete a follow-up | 7 | 6 | 2 | 1 |
| 3. Find and update an assigned task | 4 | 2 | 3 | 1 |
| 4. Open a project discussion | 3 | 2 | 3 | 2 |
| 5. Find the next milestone | 2 | 1 | 2 | 1 |

Honest reading: adding an enquiry takes the same number of entries (the information required is the same), it just needs one fewer screen. The "before" column was measured on current `main`; the "after" column was **re-measured on the final build** (all five jobs completed and were confirmed in the database): 7, 6, 2, 2 and 1 steps over 2, 1, 1, 2 and 1 screens. These are the shortest scripted paths on one machine, not a usability study with staff.

## Screenshots

`docs/os-workflow-screenshots/` holds 24 `before-*` and 34 `after-*` images of the same sample scenario: Follow-ups, Enquiries Table and Board, Quick Add, the enquiry panel, My Work (Table and Board), the project directory (Table and Board), project Overview, Work, the task panel, Plan and Discussion, in dark and soft light at laptop width, and the Table, panel and task panel at 390 px. Each was inspected after the final build. Two problems found that way were fixed: the side-panel heading drew a stray focus box when it took focus, and the project Work toolbar showed six controls at once (the less used Department, Deliverable and Narrow to filters now sit under **More filters**, which opens by itself while one of them is set). Full-page captures at phone width show the fixed bottom bar in the middle of the page; that is a capture artefact of a fixed bar, the phone-fit check confirms nothing sits under it in use.

## Accessibility, keyboard and failure states

`os-shell-checks/a11y-states.mjs` checks, in a real browser: every Tab stop to Add enquiry has a visible focus ring; Add enquiry opens with focus inside, Tab stays in the dialog, Escape closes it and focus returns to the button; a row opens its panel from the keyboard, focus moves into the panel, Escape closes it and focus returns to the row; Board **Move to** and My Work status controls are reachable by Tab, named for their record and show a ring; axe (WCAG 2.1 A and AA plus best practice) reports no serious or critical finding on 13 pages in desktop and phone, dark and light; a search with no match says so; and with the data service stopped, Enquiries, Follow-ups, Projects, My Work and a project's Work say they could not load and that it is not an empty list. That last check found a real fault, now fixed: when the access lookup itself failed, Sales and Projects told people "You do not have access". They now say the information could not be loaded, and nothing is granted when the lookup fails. It also found a link on Follow-ups that was not underlined (links inside text must not rely on colour alone).

## Verification (local throwaway database and a production build of the final commit)

| Check | Result |
|---|---|
| `tsc --noEmit`, `eslint .` (apps/web) | clean |
| Unit tests (apps/web) | 656 passed |
| `sales-actions.mjs` (on the Sales-only seed it expects) | 22 of 22 |
| `sales-workspace.mjs` | 30 of 30 |
| `projects-flow.mjs` | 48 of 48 |
| `projects-workspace.mjs` | 37 of 37 |
| `shell-checks.mjs` | 141 of 141 |
| `a11y-states.mjs` (keyboard, focus, axe on 13 pages x 4 variants, outage) | 16 of 16 |
| `phone-fit.mjs` | 256 page views, 0 with problems |
| `contrast-audit.mjs` | 178 pages, 12,778 text nodes, 0 failing combinations |

No database migration changed, so the database and security suites were not re-run (the repository CI runs them, `rls-policies`).

## Known limitations

* Drag and drop uses the browser's native drag events; touch and keyboard use each card's **Move to** control.
* Quick Add of an enquiry needs an agency or an end client (the database rule), not just a contact.
* The step counts are the shortest path a competent user would take in scripted runs, not a usability study with staff.
* Board column headings say "No value yet" when no card in the column has a value; this is true but repeated when nothing has a value.
* Nothing here was tried on the hosted preview by a person; all browser runs used a local throwaway database.
