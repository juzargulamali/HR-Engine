# Launch usability package 2: manual database steps

**Nothing here has been run on any hosted project.** Package 2 (usability) adds **two small database changes**, applied by you in the Supabase SQL Editor of **Enginious HR Engine_V2** when you decide to. Everything else in package 2 is application code and needs no database step. Each change has the same five steps as packages 1b, 1c and 1d (the file names start with the prefix shown in each heading, in `supabase/manual-sql/`):

1. **Preflight (read-only):** `<prefix>_00_preflight_readonly.sql`. Section B must say `OK` on every row and *not applied yet*.
2. **Snapshot (read-only):** `<prefix>_05_preservation_check_readonly.sql`, exactly as it is. Keep the whole `paste` column.
3. **Apply:** paste the migration into the SQL Editor and run it once (safe to run twice).
4. **Verify (read-only):** `<prefix>_20_verify_readonly.sql`; the last row must say `OK … 0 failing`.
5. **Preservation compare (read-only):** paste the step 2 lines where the comment says `>>> PASTE <<<` and run the same file again. The summary must start with **PASS**.

Rollback for each: `<prefix>_90_rollback.sql` (read its header first). Each pack was run end to end on a throwaway database built from every earlier migration (preflight, snapshot, apply twice, verify, compare = PASS, rollback twice, verify shows the change as missing or the old definition back, apply again).

## The one installation order (packages stack: 1 -> 2 -> 3)

The single authoritative list of all 14 database changes and the sequence (database first, then the application merges) is **`docs/launch-refinement-install-order.md`**; if this guide and that page differ, that page wins. In short: the two package 2 changes are #12 (`20261216000900_proj_block_task_notifies_pm.sql`, needs Projects) and #13 (`20261216000910_module_access_managers.sql`, needs the access tables of the modules you use), applied in file-name order after #1 to #11 of package 1 and before #14 of package 3.

Both changes below are **migrations, not read-only**: they replace or add database functions (they insert, edit or delete no existing rows) and are additive and safe to run twice. Only the preflight, snapshot, verify and compare files are read-only; the rollback changes things back. Neither changes anything for the current `main` application; the new screens say they could not load that part when a change is missing, never an empty list.

## 1. A blocker that names someone else also tells the Project Manager (prefix `blocknotify`, `20261216000900_proj_block_task_notifies_pm.sql`)

**Why.** `proj_block_task` told only the person named as able to unblock the task. When that was a colleague, the Project Manager, who is accountable for the project, only learned of the blocker by opening the task. (Reproduced locally before the fix.)

**The rule.** The person named to unblock (or the PM when only an action is written) is told exactly as before. **New:** when a person is named and is not the PM, the PM also gets a notice, worded as information ("Pia was asked to unblock it"), not as a request to act. One notice per person: if the named person **is** the PM there is one notice; the person who reports the blocker is **never** told about their own action (also when the reporter is the PM); an unread notice is not repeated. Notices go through the existing `proj_notify`, so only active people who can open the project are reached; nobody gains access to anything.

**Unchanged:** who may block (assignee, department head, PM), the required reason, the required unblock responsibility (a project member, or a written action), the event record, and who can clear a blocker.

**Hosted check first.** Preflight section D says how many tasks are blocked today and for how many a non-PM is named. Those PMs are not told retroactively; the change applies to blockers reported after it.

**Tested locally:** `packages/rls-tests/test/project_block_notifies_pm.rls.test.ts` (PM told when a colleague is named; one notice when the PM is named; action-only blocker; the PM reporting; the reporter naming themselves; blocking again after clearing; an inactive PM not notified; reason, responsibility, membership and who-may-block refused when called directly; the notice carries no extra project data).

## 2. Who can grant access, shown to people who have none (prefix `modaccess`, `20261216000910_module_access_managers.sql`)

**Why.** A person denied Sales, Projects, Inventory or Project Budgets was told "Ask a founder" with no name, and the grant tables are readable only by people who hold access, so the names could not be looked up. (B12 / U-13.)

**What it does.** `module_access_managers(p_module)` (`sales`, `projects`, `inventory`, `budget`) returns one row per person who can manage that module's access **in the caller's own company**, with **only** `user_id` and `display_name`. The denial screens turn it into "Ask Sara Lead or Sam Manager to give you access." If the read fails the screen says **"Could not load who can grant access"** (never blank, never "nobody"); if nobody is listed, the old generic wording stays.

**Exactly who is listed.** The same rule the module's own grant functions use, in the caller's company only: Sales, Projects and Inventory: a founder or a holder of `manage_access`; Project Budgets: a holder of `manage_access` (a budget grant has no founder right). Only active, un-revoked grants, held by **active** people. Module grants are always for one company (they have no country or global form), so there are no country-limited or company-less holders to consider, and another company's holders are never returned. A signed-in person with no employee record gets no rows (there is no company to derive); an inactive caller gets none.

**Not returned, and tested as not returned:** emails, the grant row, capabilities, who granted it, any other company's holders, any other personnel data. The grant tables themselves stay unreadable to a person with no grant. Anonymous callers have no execute right; an unknown module is refused.

**Giving a name grants nothing.** There is no "request access" button in this package: it would need a notice reader for access managers, which is deliberately not built here.

**Hosted check first.** Preflight section D lists how many active managers each module has today (information only; a module with none will show the generic wording).

**Tested locally:** `packages/rls-tests/test/module_access_managers.rls.test.ts` and `apps/web/src/components/os/ask-for-access.test.tsx`.

## Application changes that need no database step

* **My Day and Approvals:** how long each item has waited and who it is with. "Needs me" shows the oldest wait on approvals and budget decisions; "Waiting on others" shows who decides (the person, or the HR / Finance / CEO or CTO **queue**; a shared queue is named as a queue, never as one invented person), read from the approval steps the requester can already read. If that read fails the row says "who decides could not be loaded". The Approvals list shows how long each request has waited on you. No new function, no wider visibility.
* Navigation (Me, Company information), My Day sections, and the other package 2 screens are application only.

## Browser flows (local stack only)

`apps/web/os-shell-checks/workflow-steps.mjs` was repaired (the task status control is a menu, not a select) and rerun on the local disposable stack with assertions that the status changed in the screen and persisted in the database. Nothing was run against a hosted project.
