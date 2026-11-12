# Projects & Tasks: Delivery Plan and its Excel import and export

Part of the Projects & Tasks Map: [coverage index](./projects-coverage-index.md) (section 7) and [action catalogue](./projects-action-catalogue.md) (section 8).

Status: written with Projects & Tasks Phase 2, part 1 (branch `claude/admiring-cray-uky379`, PR #84, merged; see the release status below). Written by the author of the code against the files cited; the database rules are proven on a real PostgreSQL (`packages/rls-tests/test/proj-delivery-plan.rls.test.ts`), the screens and the Excel flow by unit tests and a temporary browser page with fictional data. **Nothing was checked signed in.** Migration `20261231000100_proj_delivery_plan.sql` (install-order row 28): applied on hosted, owner-reported.

**Release status (2026-11-12):** merged to `main` in PR #84, merge commit `e12c22f` (checked on GitHub); required CI `lint-typecheck-test` and `rls-policies` green on the exact head `4ca6da3` (read from GitHub); migrations 28 and 29 applied on the hosted database with their preflight and verify packs, and the signed-in Preview tests passed (**owner-reported**, 2026-11-12; Claude ran no hosted SQL); Production: deployment of the merge commit not seen by Claude and the signed-in smoke check not done by Claude (`Unverified`). Whether the owner's tests included a live Anthropic call was not stated (`Unverified`). The wording above about what was verified describes the work as it was written (history).

Sources: `supabase/migrations/20261231000100_proj_delivery_plan.sql` (M); `apps/web/src/lib/projects/delivery-plan/model.ts`, `data.ts`; `apps/web/src/lib/actions/projectsDeliveryPlan.ts`; `apps/web/src/app/(app)/projects/[id]/delivery/page.tsx`; `apps/web/src/components/projects/delivery/delivery-plan-view.tsx`, `delivery-forms.tsx`; Excel: `apps/web/src/lib/projects/delivery-plan/excel/*`, `apps/web/src/app/api/projects/[id]/delivery-plan/{template,export,import}/route.ts`, `apps/web/src/app/(app)/projects/[id]/delivery/import/*`.

## 1. What it is

One row is a **deliverable in a zone** (for example Entrance: Interactive LED welcome wall) with specifications, **one accountable owner**, a needed-by date and an optional reference image (an image already in Files & client plan; nothing is fetched from the internet). Under it are **breakdown lines** in the sections that apply: Hardware, Content / UI / UX, Programming, Installation, Testing. A simple supply-and-install job has a few rows and only the lines it needs.

**Entered once.** Release turns each work line into ONE task (`proj_create_task`, the existing task rules and notices) and each hardware line into ONE line on the project's **draft** equipment request (`inv_add_request_line`). The plan line stores the link, so saving, importing or releasing again never creates a second one. Submitting the request to the warehouse stays the existing button on the Equipment tab. **Progress is never stored in the plan**: it is read from the linked task and equipment line each time (`proj_dp_plan`, `lineProgress` in `model.ts`).

**Stable identifiers.** Every deliverable has a key (`D001`, ...) and every line a key (`L0001`, ...), unique per project and never reused. A deliverable is also unique by zone + name and a line by deliverable + section + description (case and surrounding spaces ignored), so a workbook row without a key finds the same record.

## 2. Who can do what (enforced in the database functions; the screen only hides what would be refused)

| Action | Who | Enforced by |
|---|---|---|
| Read the whole plan, every section | Anyone who can read the project's details: active members, and founders of the company | `proj_can_view_details` in the six `proj_dp_*` select policies and in `proj_dp_plan` |
| Add, edit, remove a deliverable row | Whoever manages the project (Project Manager, temporary leader, founder) | `proj_can_manage` in `proj_dp_save_item`, `proj_dp_remove_item` |
| Add, edit, remove a breakdown line | The manager; and the person the line's **section** was delegated to, while they are an active member | `proj_dp_can_edit_section` in `proj_dp_save_line`, `proj_dp_remove_line` |
| Delegate a section | The manager; the delegate must be an active member | `proj_dp_delegate` |
| Release (the whole plan or one deliverable) | The manager only | `proj_dp_release` |
| Raise a correction | Anyone who can read the project's details | `proj_dp_raise_correction` |
| Decide a correction | The lead it was routed to, or the manager | `proj_dp_decide_correction` |
| Approve or reject a proposed change to released work | The manager only. The proposer (or the manager) may withdraw it | `proj_dp_decide_change` |
| Import a workbook | The manager (everything); a section delegate (lines of their section only). One row outside the person's rights refuses the whole file | every row goes through `proj_dp_save_item` / `proj_dp_save_line` inside `proj_dp_apply_import` |
| Export, download the template | Anyone who can read the project's details | the routes call `loadProjectView` and `proj_dp_plan` under the person's own session |

The plan holds no price, cost or margin, so there is nothing commercial to hide in it; commercial data elsewhere keeps its existing rules. A finished project (completed or archived) is read-only for everyone (`proj_require_open_project`). The tables grant signed-in users SELECT only; every write goes through the functions.

## 3. The Delivery plan tab (`/projects/[id]/delivery`)

**How to reach it:** open a project; **Delivery plan** is the tab after Work and Timeline (`lib/projects/workspace-nav.ts`). Also "Delivery plan" under Go to on the Work page. Someone with the summary only is sent back to the project. On a database without the migration the page says "The Delivery plan is not installed in this environment yet."; a failed read says "Could not load the delivery plan" with Try again.

| Control (exact label) | When it appears | Who | Required | After success | If blocked or it fails |
|---|---|---|---|---|---|
| **Download template** | Always | Any reader | | An .xlsx with the Deliverables, Breakdown and Instructions sheets (section 5) | |
| **Import Excel** | The person can edit at least one section and the project is open | Manager; section delegates | | Opens `/projects/[id]/delivery/import` (section 5) | |
| **Export Excel** | Always | Any reader | | The plan as an .xlsx, with read-only progress columns | A failed read answers with an error, not an empty file |
| **Add deliverable** (dialog "Add deliverable") | Open project | Manager | Deliverable (name). Optional: Zone, Specifications, Accountable owner, Needed by, Reference image | The row appears under its zone with the next key | "Another deliverable in this zone already has that name"; the same zone and name again answers "That is already in the plan, so nothing was added twice." |
| **Edit** on a deliverable (dialog "Edit deliverable") | Open project | Manager | Deliverable. On a released row also "Why is it changing?" (optional) | Draft row: saved. **Released row: "Propose change"**; the differences in zone, name, specifications, owner and needed-by become ONE proposal (section 4) and nothing changes; the image changes directly | "This deliverable was changed by someone else. Reload and try again" |
| **Remove** on a deliverable | The row and all its lines are unreleased | Manager | | The row and its lines leave the plan | "This deliverable has released work. Cancel its tasks or equipment lines where they live; the row stays in the plan" |
| **Add line** (dialog "Add breakdown line") | The person can edit at least one section | Manager; delegates (their sections only are offered) | Section, What is needed. Optional: Quantity, Needed by, Stock item (Hardware) or Assigned to (work sections), Notes | The line appears under its section as "Draft: not released" | "Only the Project Manager, or the person this section was delegated to, can change this section"; a repeated line answers that it is already in the plan |
| **Edit** on a line (dialog "Edit line") | The person can edit that section | Same | What is needed | Draft: saved. **Released: "Propose change"** for description, quantity, stock item, assignee, needed-by; Notes change directly | **Booked equipment:** when the linked equipment request has left Draft the form says "This equipment is already with the warehouse. Change it on the Equipment tab; the plan cannot change a booking." and its button is off; the function refuses the same way |
| **Remove** on a line | The line is unreleased | Same | | The line leaves the plan | "This line was released. Cancel its task or equipment line where it lives; the line stays in the plan" |
| **Release plan (N draft lines)** / **Release** on one deliverable (dialog) | There are unreleased lines | Manager | | The dialog first says how many tasks will be created, how many hardware lines will be added to the **draft** equipment request ("It is not sent to the warehouse: you review and submit it on the Equipment tab") and which lines will wait and why. Then: tasks exist on Work for their assignees (line's person, else the accountable owner; due = the line's date, else the deliverable's), hardware lines are on the draft request, and the summary says what was created | A hardware line with no stock item, and a work line with nobody named and no accountable owner, wait (listed with the reason); nothing else is held back. Repeating Release creates nothing twice |
| **Open task** / **Open equipment request** on a released line | The line is released | Any reader | | The task's side panel on Work; the request on the Equipment tab | |
| Progress badge on a line | Always | | | Draft: not released; Task not started / in progress / in review / done / blocked / cancelled / deferred; On draft request (not submitted to Warehouse); Waiting for Warehouse; Reserved n of m; Sent n of m with what is returned and **what is still out**; Returned. A linked record that cannot be read says "could not be read", never "not started" | |
| **Correction** on a deliverable or a line; **Raise a correction about the agreed scope**; and "Raise a correction" on a task (task detail, under Comments) | Open project | Any reader | What needs correcting? | "Correction sent. The lead and the Project Manager were told; you will see the decision on the Delivery plan." It is listed under "Corrections waiting for a decision". It changes nothing by itself | |
| **Accept correction** / **Decline correction** | An open correction | The lead it was sent to; the manager | Declining needs "Why" | It moves to **Decisions** with who decided and the note; the person who raised it is told | "The lead this correction was sent to, or the Project Manager, decides it" |
| **Approve change** / **Reject change** / **Withdraw proposal** | A proposed change | Manager (approve, reject); the proposer (withdraw) | Rejecting needs "Why" | Approved: the plan record takes the new values; a line still on a DRAFT equipment request follows an approved quantity; the linked task's assignee is told and the task itself is not moved. Rejected or withdrawn: nothing changes. All move to **Decisions** | "This equipment is already with the warehouse..." when the request left Draft meanwhile |
| **Who defines each section** (one Save per section) | Open project | Manager | | The chosen member can add and edit that section's lines on every deliverable and is told. "Project Manager only" takes it back | "A section is delegated to an active member of the project" |
| **Decisions** | There is a decided correction or change | Any reader | | The latest ten of each, with who decided, when and why | |

**Where a correction goes** (`proj_dp_raise_correction`): on a line, the section's delegate, else the deliverable's accountable owner; on a deliverable, its accountable owner; on a task, the head of the task's department team; on the agreed scope, the Project Manager. With no lead recorded, a lead who left the project, or a lead who is the person raising it, it goes to the Project Manager. The Project Manager is always told. **No text a person wrote is copied into a notice**: a notice says what the correction is about.

**The agreed scope itself** is still changed only through Feedback & changes (scope change proposal and decision by a holder of scope approval): a correction about the scope is a question to the Project Manager, who proposes the scope change there if it is one. Committed dates and released work change through a proposal on this tab. Booked equipment changes on the Equipment tab. Cross-team dependencies stay on Timeline.

**Phone and desktop:** the same page; panels stack, line controls wrap under the line text, dialogs are bottom sheets. No control is desktop-only. Checked at 1280 and 390 wide on a temporary page (`docs/projects-phase2-screenshots/`).

## 4. Released work never changes silently

A change to a released deliverable (zone, name, specifications, owner, needed-by) or line (description, quantity, stock item, assignee, needed-by), from the screen or from Excel, is stored as a row in `proj_dp_changes` with only the fields that differ (`from` and `to`), who proposed it, an optional reason and whether it came from Excel. One open proposal per record: a newer one replaces (withdraws) the older. Approving applies it; rejecting needs a reason. The linked task is never rewritten: its assignee gets a notice and adjusts the task. A hardware line whose request is still a Draft takes an approved quantity (`inv_update_request_line`); once the request is with the warehouse the function refuses the change outright, so **an import or an edit cannot alter a booking or a reservation**.

## 5. Excel: Download template, Import Excel, Export Excel

Conventions follow the Clients & Agencies and Events imports (`lib/crm/clients-agencies/import/xlsx.ts`): .xlsx only, no macros, 4 MB, formulas are never run (cell values are read as data), cells are neutralised against spreadsheet formula injection on export, preview first and nothing saved until Confirm.

**Workbook.** Sheet **Deliverables**: Deliverable ID, Zone, Deliverable, Specifications, Accountable owner, Needed by, Reference image (export only), and on export the read-only columns Released and Progress. Sheet **Breakdown** (optional): Line ID, Deliverable ID (or Zone + Deliverable for a row that is new in the same workbook), Section, Description, Quantity, Stock item (Hardware), Assigned to (work sections), Needed by, Notes, and on export the read-only columns Released and Progress. Sheet **Instructions**. A simple job fills only Deliverables.

**Never read from a workbook:** progress, approvals, stock states, reservations, handover completion, the Released and Progress columns, the Reference image column. They stay in their own workflows.

**Import flow** (`/projects/[id]/delivery/import`):
1. Upload. The file is parsed and compared with the current plan. **Nothing changes.**
2. Preview: rows grouped as **Add**, **Update**, **Unchanged** and **Needs attention**, each error shown against its sheet, row and field. A person or stock item name that matches nobody, or more than one, needs an explicit choice (or "leave as it is"). Rows on released work are marked as proposals for the Project Manager. A changed quantity or stock item on equipment that is with the warehouse is Needs attention and is never sent. A stock item name equal to the one already recorded on the line is not looked up at all, so an untouched export stays Unchanged for a delegate who cannot read the stock list and for a retired item (fixed after the independent review, 2026-11-12).
3. Confirm ("Import N changes", off while anything needs attention). One transaction (`proj_dp_apply_import`): every row goes through the same functions as the screen. **Blank cells and missing rows never delete or clear anything.** If the plan changed after the preview was prepared (the plan revision differs) nothing is imported and the person is asked to upload again. If any row is refused, nothing of the file is saved.
4. Back to the Delivery plan. **Importing does not release anything**: tasks and equipment lines are still created only by Release.

Repeating the same import adds nothing (rows are matched by ID, else by zone + name, or deliverable + section + description).

## 6. What is not built (Phase 2 items still in their plan)

The Project Closeout Report is built separately ([`projects-closeout-report.md`](./projects-closeout-report.md)). The Operations Manager dashboard; structured event-edition links; calendar integration; equipment booking review after a delivery-date change (a date change on released work is a proposal here, and booked equipment is not touched); the Inventory readiness calculation. The Project Closeout Report is the next part of Phase 2 and reads the plan's records; it is not in this PR.

## 7. Verification gaps

* Nothing signed in; the app's calls through the real data service (`proj_dp_*`) are proven against stand-ins, and the SQL on a real PostgreSQL as the signed-in roles.
* `inv_create_request` and `inv_add_request_line` are called from `proj_dp_release` under the manager's own identity; their own rules (Inventory enabled for the company, item not retired, quantity allowed) apply and their refusals surface as the release error. Tested with a quantity-tracked item only.
* The reference image is a link to Files & client plan by name; the image is not drawn in the plan or embedded in the workbook.

## Coverage rows

| Entry | Kind (screen / tab / panel / dialog / form / filter / download / legacy route) | How to reach it | Who can see it | Purpose | Reference (section number in this file) | Status (Documented or Unverified: what) |
|---|---|---|---|---|---|---|
| Delivery plan tab | tab | Project, tab **Delivery plan**; `/projects/[id]/delivery` | Readers of the project's details | The plan by zone, what waits for a decision, who defines each section | 3 | Documented |
| Add deliverable / Edit deliverable | dialog | **Add deliverable**; **Edit** on a deliverable | Manager | Create or change a deliverable row; a released row becomes a proposal | 3, 4 | Documented |
| Add breakdown line / Edit line | dialog | **Add line**; **Edit** on a line | Manager; the section's delegate | Create or change a line; released becomes a proposal; booked equipment is refused | 3, 4 | Documented |
| Remove deliverable / Remove line | dialog | **Remove** | Manager; the section's delegate (lines) | Take unreleased rows out of the plan | 3 | Documented |
| Release the plan / Release this deliverable | dialog | **Release plan**; **Release** | Manager | Says what will be created, then creates tasks and draft equipment lines once | 3 | Documented |
| Who defines each section | form | Bottom of the tab | Manager | Delegate a section to a member | 3 | Documented |
| Raise a correction | dialog | **Correction** on a deliverable or line; the scope button; "Raise a correction" in task detail | Readers of the project's details | Send a correction to the relevant lead; tells the Project Manager | 3 | Documented |
| Corrections waiting for a decision | panel | Top of the tab while one is open | Readers; decided by the lead or the manager | Accept or decline, with a note | 3 | Documented |
| Proposed changes to released work | panel | Top of the tab while one is proposed | Readers; decided by the manager | Approve, reject or withdraw a proposal | 3, 4 | Documented |
| Decisions | panel | Bottom of the tab | Readers | The latest decided corrections and changes, with who and why | 3 | Documented |
| Download template | download | **Download template**; `/api/projects/[id]/delivery-plan/template` | Readers | The empty workbook with examples and instructions | 5 | Documented |
| Export Excel | download | **Export Excel**; `/api/projects/[id]/delivery-plan/export` | Readers | The plan as a workbook with read-only progress | 5 | Documented |
| Import Excel | screen | **Import Excel**; `/projects/[id]/delivery/import` | Manager; section delegates | Upload, preview (Add, Update, Unchanged, Needs attention), resolve, confirm | 5 | Documented |

## Actions

| Id | Label in the app | Permission (and where enforced) | Starting state | Server action -> database function | Records changed | Resulting state | Notifications | Retry behaviour |
|---|---|---|---|---|---|---|---|---|
| `projects.plan.save_deliverable` | Add deliverable / Save deliverable / Propose change | Manager (`proj_can_manage` in the function) | Open project | `saveDeliverable` -> `proj_dp_save_item` | `proj_dp_items` (draft row), or `proj_dp_changes` (released row); `proj_dp_state.rev` | Row added or changed; or one proposal waiting | None | Safe: the same zone and name returns the existing row; an edit carries the row version and a stale one is refused |
| `projects.plan.remove_deliverable` | Remove | Manager | Row and lines unreleased | `removeDeliverable` -> `proj_dp_remove_item` | `proj_dp_items.removed_at`, its lines | Out of the plan | None | Safe: a second call finds nothing |
| `projects.plan.save_line` | Add line / Save line / Propose change | Manager or the section's delegate (`proj_dp_can_edit_section`) | Open project; not booked equipment | `savePlanLine` -> `proj_dp_save_line` | `proj_dp_lines`, or `proj_dp_changes`; rev | Line added or changed; or one proposal | None | Safe: the same deliverable, section and description returns the existing line; version check on edit |
| `projects.plan.remove_line` | Remove | Manager or the section's delegate | Line unreleased | `removePlanLine` -> `proj_dp_remove_line` | `proj_dp_lines.removed_at` | Out of the plan | None | Safe |
| `projects.plan.delegate_section` | Save (Who defines each section) | Manager | Open project | `delegatePlanSection` -> `proj_dp_delegate` | `proj_dp_delegations` | The member can edit that section | The delegate: `project_plan_delegated` | Safe: idempotent |
| `projects.plan.release` | Release plan / Release | Manager | Unreleased lines exist | `releaseDeliveryPlan` -> `proj_dp_release` -> `proj_create_task`, `inv_create_request` (only if the project has no draft request), `inv_add_request_line` | `proj_tasks` (+ task events), `inv_requests` (a draft, at most one new), `inv_request_lines`, `proj_dp_lines.task_id / request_line_id / released_at`, `proj_dp_items.released_at` | Tasks assigned; hardware on the DRAFT request (never submitted) | The task notices of `proj_create_task` | Safe: a released line is skipped (the stored link; unique indexes on `task_id` and `request_line_id`); the project is locked for the call |
| `projects.plan.raise_correction` | Correction / Raise a correction | Readers of the project's details | Open project | `raisePlanCorrection` -> `proj_dp_raise_correction` | `proj_dp_corrections` | Open, routed to one lead | The lead and the Project Manager: `project_plan_correction` (no correction text) | Not idempotent: a second press files a second correction |
| `projects.plan.decide_correction` | Accept correction / Decline correction | The routed lead or the manager | Correction open | `decidePlanCorrection` -> `proj_dp_decide_correction` | `proj_dp_corrections` (status, who, when, note) | Accepted or declined | The person who raised it and the Project Manager: `project_plan_correction_decided` | Safe: the same decision again is ignored; a different one is refused |
| `projects.plan.decide_change` | Approve change / Reject change / Withdraw proposal | Manager (approve, reject); proposer or manager (withdraw) | Change proposed; equipment not booked | `decidePlanChange` -> `proj_dp_decide_change` (-> `inv_update_request_line` for an approved quantity on a DRAFT request) | `proj_dp_changes`; on approval `proj_dp_items` or `proj_dp_lines`; possibly `inv_request_lines.qty` | Applied, or closed without change | The proposer: `project_plan_change_decided`; the linked task's assignee on approval: `project_plan_change` | Safe: the same decision again is ignored |
| `projects.plan.import` | Import N changes | Manager; a section delegate for their section (each row checked by the save functions) | Open project; preview made at the current plan revision | POST `/api/projects/[id]/delivery-plan/import` -> `proj_dp_apply_import` | As `save_deliverable` and `save_line`, in one transaction | Rows added or updated; released rows proposed; nothing released | None | Safe: the same workbook again changes nothing; a stale revision is refused; any refused row rolls back the whole file |
