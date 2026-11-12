# Operations (Projects & Tasks Phase 2B): rollout

Migration `supabase/migrations/20270102000100_ops_phase2b.sql` (install-order row 30). **Status (2026-11-12): on branch `claude/projects-phase-2b-operations`; draft pull request not yet opened; not merged; required CI not recorded. The migration is not applied anywhere by Claude and no owner result is recorded: hosted `Unverified`. Production: not deployed. Nothing was checked signed in.** Reference: `docs/enginious-os/modules/operations.md`.

Claude runs no hosted SQL, gives nobody access and creates no Production test data (`CLAUDE.md`). Every step below that touches the hosted database or a signed-in session is the owner's.

## What it adds
* **Operations Manager:** the Projects capability `operations`, per company, given on People & Access. It opens **Operations** (Overview, Upcoming Work), implies PM assignment for handovers and for reassigning a live project's Project Manager, lets its holder read that company's projects in full without joining them, and is an explicit path into that company's project chats. The migration gives it to nobody.
* **Operations planning on an enquiry:** eight planning columns on the enquiry that Sales owns, one row per flagged enquiry that Operations owns (`ops_enquiry_planning`), and the allowlisted read `ops_upcoming_work`.
* **Event edition on projects:** the handover takes a copy of the enquiry's edition; the project takes the handover's copy at acceptance.
* **Equipment:** `proj_equipment_reviews` (a committed date changed while a request is with the warehouse), the readiness statement per request, and the report of a failed release at completion while something is left.
* **Chat:** Operations Managers in the company's project groups; the project status and an "open through Operations" marker on the group list.
* **Closeout evidence:** the structured edition, when the project has one.

Two tables, twelve columns, five triggers. Signed-in users can only read the two tables; every change goes through a function that checks the caller. Nothing here reserves, releases, dispatches or receives stock, creates a project, completes one or changes a task (verify pack row 8).

## Order
Apply **after** rows 27, 28 and 29 (`20261230000100_chat_project_groups.sql`, `20261231000100_proj_delivery_plan.sql`, `20270101000100_proj_closeout_reports.sql`): it replaces Chat functions, reads the Delivery Plan tables and wraps the closeout evidence. The preflight checks all of them.

1. `supabase/manual-sql/ops_phase2b_00_preflight_readonly.sql` (read-only, 8 rows). Expect rows 1 to 5 `OK`; row 6 `not installed yet` (`already installed` on a second run); rows 7 and 8 are numbers for information: the open handovers that will take their enquiry's event edition, and the people who hold `assign_pm` today. Any row that starts with `STOP` names the migration to apply first.
2. Apply `supabase/migrations/20270102000100_ops_phase2b.sql` (changes the database; one transaction; safe to apply again).
3. `supabase/manual-sql/ops_phase2b_20_verify_readonly.sql` (read-only, one table of 16 rows). **Rows 1, 3 to 15 must say `OK`.** Rows 2 and 16 say `INFO`: row 2 is the number of people who hold Operations (0 straight after the migration), row 16 the numbers of flagged enquiries, projects with an edition and open equipment reviews. What the rows check: (1) the capability exists and implies PM assignment; (3, 4) the two tables have row-level security and are read-only to signed-in users, nothing for anon; (5) the sixteen functions the app calls exist and only signed-in users can call them; (6) the internal helpers cannot be called; (7) Upcoming Work names no commercial field; (8) the Operations functions touch no stock and create no project or task; (9) the five triggers are installed; (10) an accepted handover and its project hold the same edition; (11) at most one open review per request and date; (12) the closeout evidence is the wrapped function; (13) the Chat path needs the capability itself; (14) reading projects, with restricted files and the commercial record on their own rule; (15) an internal project and Sales links still need `assign_pm` itself. A row that says `MISSING`, `FAIL` or `CHANGED`: stop and report it; do not give anyone access.
4. Deploy the app (merge only when the owner asks, after required CI is green on the exact head).

Preview and Production share one database: the migration is visible to both as soon as it is applied.

## What changes the moment it is applied, before the new app is deployed
Checked in the SQL and against the application code that reads it. None of this was observed on a hosted project: `Unverified` by a run.

* **Nobody gains access.** No grant is changed; nobody holds `operations`. `proj_has_capability`, `proj_can_view_details` and `proj_can_view_summary` give the same answer as before for everyone who does not hold it. The Operations reads refuse everyone but founders, and the deployed app has no screen that calls them.
* **Chat keeps working.** `chat_my_groups` returns two more columns (`project_status`, `via_operations`). The app reads the columns it uses by name (`apps/web/src/lib/chat/data.ts`), so the extra ones are ignored: the same groups, counts and order; archived projects' groups stay under Projects until the new app is live. `chat_is_member`, `chat_project_group` and `chat_group_members` answer as before while nobody holds the capability.
* **Open handovers take their enquiry's event edition at once** (drafts, submitted, assigned, question sent back; preflight row 7 says how many). Accepted handovers and existing projects are not touched. The deployed app does not show the two new columns.
* **Three triggers start working with the old app:** a handover saved or submitted takes the edition; a project created by acceptance takes the handover's copy; and **a change to a project's installation start, event start or event end while a request is with the warehouse records an equipment review and sends the Project Manager a notice of a type the old app does not know.** The old app shows that notice as "A project update." linked to the project, and has no panel to show or resolve the review. Reviews recorded in that window appear on the Equipment tab once the new app is deployed. To avoid the gap, deploy the app soon after applying.
* **Internal projects and Sales links:** the new guard and wrapper ask for `assign_pm` itself or founder, which is what the earlier rule gave before anyone held `operations`: no change for existing users. SQL run by the owner without a signed-in user is not refused by the guard.
* **Closeout Report:** the evidence gains the edition only for a project that has one, which no existing project has.
* **Enquiries:** the new columns default to "not flagged"; the deployed Sales screens do not show them.
* **Give the capability only after the new app is deployed.** People & Access in the old app does not know `operations`: it cannot offer it, and how it displays or re-saves a person who already holds it was not checked (`Unverified`).

If the app is deployed first instead: the Operations screens say "Operations is not installed in this environment yet", the enquiry panel says "Operations planning is not available yet, so nothing was saved", the directory shows no edition, the Equipment tab shows no readiness, and Chat lists archived groups under Projects. Nothing else changes.

## Giving the first Operations Manager access (owner decision; after the app is deployed)
1. Sign in as a Projects founder of the company, or as someone a founder gave Projects access management to.
2. Open **People & Access**, find the person and open their module access for **Projects**; check **Access for company** shows the right company.
3. Under **Working profile** choose **Operations Manager**. (It also exists as a tick box under **Advanced access**, in Specialist operational rights.) Any custom rights the person already has are kept and listed.
4. Read **Review before saving**: it should show "Operations Manager" under the rights added and nothing removed that you did not intend.
5. Press **Save changes**. The person sees **Operations** in the menu on their next page load.

To take it away: choose another profile (for example **Project directory viewer**) or untick it under Advanced access, review, and **Save changes**; or **Remove all access to this module** if they should have no Projects access at all. It takes effect on their next read: Operations refuses them and the company's project chats leave their list. A live Project Manager's Projects access cannot be removed while they are the Project Manager.

What the person can then do, to say to them plainly: open Operations for that company; assign and reassign Project Managers; open every project of the company and read it; comment on tasks, raise corrections, add unrestricted files and links; read and post in the company's project chats. Not: Sales screens, prices, stock, budgets, HR; creating or editing tasks; editing the Delivery Plan; managing or completing a project; creating an internal project.

## Signed-in Preview checks that do not write (one role at a time)
Open and read only; press no button that saves.

* **Admin (Projects founder or Projects access manager):** People & Access offers the profile **Operations Manager** for Projects with its description; choosing it shows the review and nothing is saved until **Save changes** (leave without saving). The menu shows **Operations** for a founder.
* **Sales (owner of an enquiry):** the enquiry's Overview tab shows **Operations planning** with "Operations cannot see this enquiry until it is flagged. Prices, quotes and notes are never shown to Operations." and the button **Flag for Operations planning**; opening the dialog and cancelling saves nothing. A Sales colleague who is not the owner sees no button. An event page shows **Delivery projects** only if a project with that edition is visible to the viewer.
* **Operations Manager (once one exists):** **Operations > Overview** shows the four panels for their company and no other; **Upcoming Work** lists flagged enquiries with no value, quote or note anywhere on the page; a project of the company opens in full with no Manage project actions; the Chat panel shows the company's project groups with the tag **Operations**; the Sales menu is absent.
* **Project Manager:** the project's Work page shows the event edition on the details card where the project has one; the Equipment tab shows a **Readiness** line on each request; the directory offers the **Event edition** filter only when a project has an edition. `/operations` says "You are not an Operations Manager."
* **Warehouse:** Inventory Today's sentence for a request with a line to buy or rent says "ready to send in part" and counts those lines apart; a project request's page in Inventory shows **Review equipment booking** when one is open. `/operations` shows the same notice as above.
* **Ordinary staff (a project member):** Chat shows **Archived (N)** only if they are on an archived project with messages; `/operations` shows the notice; nothing else is new.

## Checks that write (need the owner's go-ahead; use a clearly named test enquiry and test project)
Not to be run on Production data. Name the records so they cannot be mistaken, for example "TEST Operations planning, do not use".

* **Give and take away Operations Manager** for one test person in one company (steps above); confirm the menu appears and disappears.
* **Flag, plan, answer:** as the owner of the test enquiry, flag it with every field; as the Operations Manager, press **Plan**, name a provisional Project Manager and ask a question; confirm that no project, booking or reservation exists; as Sales, read "From Operations" and send an answer; then **Remove from Operations planning** and confirm it leaves Upcoming Work.
* **Won to project:** link the test enquiry to an event edition, close it as won, submit the handover, assign the Project Manager from Operations, accept as that person; confirm the project's details card shows the edition and that editing the edition in Sales afterwards does not change it.
* **Date change:** on the test project with a request submitted to the warehouse, change the installation start; confirm **Review equipment booking** appears, the reservation is unchanged, and **Mark as reviewed** clears it; change a date and change it back, and confirm the review closes by itself.
* To clean up: remove the flag, withdraw or leave the test handover, and take the capability away from the test person. Test rows in `ops_enquiry_planning` and resolved reviews stay (they can only be removed with the rollback).

## Recovery and rollback
* **The migration fails part-way:** it is one transaction; fix the cause and apply again.
* **A verify row is not `OK`:** do not give the capability to anyone; report the row.
* **A failed release of unused reservations at completion** has no automatic recovery: the warehouse releases or cancels the lines on each request, and the notice clears when nothing is left.
* **The feature must be withdrawn:** deploy (or keep) an app version without Operations, export what will be deleted (the rollback file lists the queries: the planning columns of flagged enquiries, `ops_enquiry_planning`, `proj_equipment_reviews`, the edition columns of projects and handovers, and who holds `operations`), then run `supabase/manual-sql/ops_phase2b_90_rollback.sql` (changes the database; one transaction; safe to run twice).
  * **It deletes:** the `operations` capability from every Projects grant that has it (the grant and its other capabilities stay; a grant that held only Operations stays as plain Projects access: remove it in People & Access if that is not wanted); the eight planning columns; `ops_enquiry_planning`; `proj_equipment_reviews`; the edition columns on handovers and projects; the Operations functions; the five triggers.
  * **It restores, as they were before:** `proj_capability_list`, `proj_has_capability`, `proj_can_view_details`, `proj_can_view_summary`, `proj_staff_directory`, `proj_set_sales_link`, the Chat functions `chat_is_member`, `chat_project_group`, `chat_group_members`, `chat_my_groups` (as installed by row 27), and `proj_closeout_evidence` (the earlier function takes its name back).
  * **It keeps:** every enquiry, handover, project, task, request, reservation and chat message. Nothing in Inventory is touched.
  * The migration can be applied again afterwards (rehearsed in `packages/rls-tests/test/ops-phase2b.rls.test.ts`, last test).

## Known limits
No automatic recovery for a failed release at completion; no dismantling date on a project; Sales has no notice list (it reads Operations' updates on the enquiry and in its history); the Chat list slows for an Operations Manager with thousands of projects (about 1.5 s at 3,000 groups in the independent reviewer's measurement); overlaps need both projects' dates. JARVIS received guidance only.
