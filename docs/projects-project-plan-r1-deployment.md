# Project Plan, Release 1: owner deployment pack

**Status:** draft PR, not merged. One additive migration, `supabase/migrations/20270104000100_proj_project_plan_r1.sql` (apply after `20270103000100`). **Nothing here was run against a hosted project by Claude**: the hosted run is the owner's. The rules below are proven on a real PostgreSQL (`packages/rls-tests/test/proj-project-plan-r1.rls.test.ts`, 12 tests) and the screens in a real browser on a throwaway local database with fictional data (`apps/web/os-shell-checks/project-plan-flow.mjs`).

Release 1 turns the Delivery Plan into the Project Manager's working screen, **Project Plan** (same records, same address `/projects/[id]/delivery`). Later releases (task output uploads and version history, the Deliverables register, client feedback and approval tracing, detailed site and shipment scheduling, the Operations TV) are not part of this one; the activation (`proj_dp_items`) and task links they will need are stable.

## Existing versus new

| Area | Already there (reused, unchanged in behaviour) | New in Release 1 |
|---|---|---|
| Accepted Sales handover to project | `proj_handovers.technologies` (`[{name, qty}]`) and `scope` are copied to `proj_project_details` on acceptance (`proj_accept_handover`). Inventory imports the frozen technologies into one draft request. | `proj_dp_seed_scope` brings each technology into the plan **once** (keyed `tech:<name>`; never duplicated, never overwrites the Project Manager's edits, a removed row is not brought back). A scope that exists only as a brief is shown beside the plan. After acceptance the Project Manager lands on the plan (`?from=handover`). |
| Delivery Plan | Deliverables by zone, breakdown lines per section, delegation, one task / one draft equipment line per released line (idempotent through stored links and unique indexes), proposals for released rows, corrections, Excel template / import / export, plan revision counter. | Presented as **Project Plan**. Zone is optional (a project without zones works). Each row is a technology / activation with a **quantity**. |
| Sections | hardware, content, programming, installation, testing | **Hardware, Content, Apps, Engineering & integration, Site work** (new values `apps`, `engineering`, `site`). The earlier five stay valid and are drawn with their old names; delegation works per family (programming = apps; installation and testing = site work). |
| Requirement fields | description, quantity, stock item, assignee, needed-by, notes | planned start, supply route (Inventory / Buy / Rent / Client supplied), a small validated detail object per section (content type, count, format, resolution, orientation; app name/purpose, app count, platform, device count; engineering kind; site kind; expected date and supplier for outside supply), milestone, waits-for (other lines), `task_pending`. |
| Tasks | `proj_create_task`, status and review workflow, dependencies (`proj_set_task_dependencies`, loop check), milestones (`proj_milestones`, `milestone_id`), blockers on the task | Release passes the planned start and the milestone; dependencies between released lines become ordinary task dependencies as soon as both tasks exist. The task description names `Project Plan D001 / L0003`; the task panel links back to its activation. **No new task table, status or workflow.** |
| Equipment | `inv_create_request` / `inv_add_request_line` (draft only), submission on the Equipment tab, booked equipment cannot be changed from the plan | Hardware without a stock match stays a visible manual line (**Specification pending** / **Needs stock match**), supplied-from-outside lines are followed in the plan (**Needs sourcing**, owner, expected date). Matching later and releasing again adds it once. Reserved / Sent / Returned still come only from Inventory records. A draft line shows **Review and send to Warehouse**. |
| After release | A change to a released row is a proposal a manager approves. | An approved owner, date or milestone change is applied to the task through `proj_reassign_task` / `proj_update_task` (their roles and rules decide). If the task cannot take it, the line shows **Task update pending** with a manager's **Resolve** (retry, or keep the task as it is). |
| Views | One list | **Breakdown** (summary strip, milestones, activations to expand) and **Timeline** (activations and requirements left, dates across, unscheduled work listed), both from the same records. |
| Entry points | Delivery plan tab | Tab renamed **Project Plan**; a prominent card on **Work** (the Work overview stays); the handovers list has **Open the Project Plan**; accepting a handover opens the plan. |

## Install: migration first, then the app

Preview and Production share one database, so the order matters.

1. Run `supabase/manual-sql/proj_project_plan_r1_00_preflight_readonly.sql` (read-only). Rows 1 to 4 must say `OK`; row 5 `not installed yet`. Rows 6 and 7 are numbers for information (existing plan lines and released lines).
2. Apply `supabase/migrations/20270104000100_proj_project_plan_r1.sql`. Additive: two CHECK lists are widened, nullable columns and one partial index are added, seven functions are replaced by versions that keep every existing behaviour, four are new. No row is changed, no table is dropped. Idempotent where PostgreSQL allows.
3. Run `supabase/manual-sql/proj_project_plan_r1_20_verify_readonly.sql` (read-only). Every row must say `OK`; rows marked `INFO` report numbers.
4. Deploy the app. If the app is deployed first, nothing breaks: the page draws the earlier plan (every new field is optional in the reader) and the new actions are refused by the database until step 2.

Existing plan records, the Excel template / import / export, links to `/projects/[id]/delivery`, `/projects/[id]/delivery/import` and `/api/projects/[id]/delivery-plan/*`, section delegations and every released task and equipment line keep working. Excel carries the original columns (and now offers the five current sections); start dates, supply routes, details, milestones and dependencies are edited on screen.

## What release creates, and what Warehouse sees

* One task per released work line: title `<activation>: <requirement>`, assignee (the line's, else the activation's owner), planned start, due date (the line's, else the activation's), milestone. The description starts `Project Plan D001 / L0003 (Content)`.
* One line on the project's **draft** equipment request per released, stock-matched hardware line. Warehouse sees nothing until the Project Manager presses **Submit to the warehouse** on the Equipment tab (unchanged). Nothing in Release submits it.
* Hardware that is bought, rented or client supplied creates **nothing** for Warehouse; it stays in the plan with its owner and expected date.
* Repeating, retrying or running Release at the same time creates nothing twice (`proj_lock_project` serialises; `uq_proj_dp_lines_task` and `uq_proj_dp_lines_request_line` back it).

## Rollback

`supabase/manual-sql/proj_project_plan_r1_90_rollback.sql`. Deploy the app from before Release 1 first. The script **stops** if the plan already holds anything only Release 1 can hold (lines or delegations in Apps / Engineering / Site work, supply routes, start dates, details, milestones, dependencies, quantities) and tells you to export it and clean it up; it then restores the previous bodies of the seven functions, drops the four new ones and the helpers, drops the added columns and index, and puts the section lists back. Tasks, equipment lines, milestones and dependencies are never touched. Safe to run twice.

## Signed-in checks on Preview (Preview and Production share data: steps that write real records are marked **WRITES**)

Use a **test project** you create for this (a fictional "Preview test: Kids Photobooth"), never a live one.

1. Read only: open an existing live project's **Project Plan** as its Project Manager. It loads; its sections, tasks and equipment links are as before; the summary strip says what is true. (No write.)
2. Read only: open **Work** on that project: the **Project Plan** card is there and the Work overview is unchanged.
3. **WRITES** (test project only): create an internal test project, add two colleagues. On the plan press **Add technology / activation**; add Hardware (one stock item from the catalogue, one not in the catalogue), a Content sequence (**Start from a sequence**) with a milestone, an App with a device count, Site work.
4. **WRITES**: **Release plan** twice. Tasks appear on Work once; the project's equipment request is a **draft** with one line per stock-matched item; the unmatched one is still in the plan.
5. **WRITES**: sign in as an assignee, move a task to In progress then Done in My Work; as the Project Manager, reload the Project Plan and the Timeline: same status; the milestone says "N of M complete" and lists what is outstanding.
6. **WRITES**: as the Project Manager propose an owner or date change on a released line, approve it; the task changes. Finish a task, propose a date change on it, approve: **Task update pending**; press **Resolve**, **Keep the task as it is**.
7. Clean up: cancel the test project's tasks and equipment lines where they live, and complete or archive the test project. **Do not submit the draft equipment request.**
8. Accepting a real handover also seeds nothing by itself: the **Bring in accepted technologies** button is pressed by the Project Manager (**WRITES** on a live project; do it only on a project you are about to plan).

## Verification done and not done

Done (fictional data, throwaway local database): the rules in the RLS test file (legacy plan unchanged, scope seeded once, requirement details validated, section delegation by family, sequences, concurrent release, task dependencies, assignee status visible in the plan and milestone, approved change applied to the task or flagged pending, matched-later hardware released once, booked equipment untouched, another company cannot read or call anything, internal helpers not callable, owner packs, rollback); unit tests for the model, the summary, milestones and the Timeline; and the browser flow of the two workflows (Kids Photobooth, and a supply-and-install project stored as the previous release stored it).

Not done by Claude: anything signed in on the hosted Preview; the hosted migration and its verify pack; a hosted rollback.

## Screenshots (local stack, fictional data)

`docs/projects-project-plan-r1-screenshots/`: `breakdown-desktop.png` (summary strip, milestone, activations with their sections), `timeline-desktop.png` (the Timeline with a blocked storyboard, a late first draft and unscheduled work), `breakdown-phone.png` and `timeline-phone.png` (390 px wide, no horizontal scroll), `supply-install-plan.png` (the supply-and-install project stored as the previous release stored it).
