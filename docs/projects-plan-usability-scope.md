# Project Plan usability follow-up: scope, write paths and deployment

**Status:** draft PR stacked on the Release 1 draft (`feat/project-plan-usability` on `feat/project-plan-r1`); not merged. One additive migration, `supabase/migrations/20270105000100_proj_plan_quick_add_reorder.sql` (apply after `20270104000100`). **Nothing here was run against a hosted project by Claude.** Rules proven on a real PostgreSQL (`packages/rls-tests/test/proj-plan-quick-add-reorder.rls.test.ts`, 11 tests); screens proven in a real browser on a throwaway local database with fictional data (`apps/web/os-shell-checks/project-plan-usability-flow.mjs`, 11 steps).

Scope is the Project Plan and the shared sidebar only.

## What changed, against what already existed

| Ask | Already there | Change |
|---|---|---|
| Compact Breakdown table | `lineRow` in `delivery-plan-view.tsx`: a wrapped card per requirement | One grid row from the `md` breakpoint: Requirement (key, name, quantity, details, notes), **Supply / owner**, Dates, Status, Actions, under one column heading per section; stacked with inline labels on a phone. Same records, same Edit / Remove / Correction dialogs. Attention and **Task update pending** lines span the row. |
| Multi-row Quick add | **Add requirement** (one row), **Start from a sequence** (chain of up to 12) | **Quick add**: a wide dialog of up to 50 rows (name, quantity for hardware, owner, start, due), a **Paste a list** box (one requirement per line; quantity after a tab, or `Batak unit x 4`, or `4 x Batak unit`), an optional "each row waits for the one above" chain for work sections and an optional milestone for all rows. |
| Persistent icon-only desktop navigation | The sidebar's **Collapse** button already existed and remembered the choice in `localStorage` | (1) The choice is also kept in a cookie, read by the layout, so the page is drawn at the right width **from the first paint** (before, every load drew the wide sidebar then shrank it). Someone who collapsed it earlier keeps their choice (adopted once from `localStorage`). (2) In the icon rail a module's pages open in a flyout beside the icon on hover or keyboard focus (they were unreachable while collapsed); the icon still goes to the module. Modules with no pages keep their label tooltip. |
| Drag-to-reorder with a keyboard alternative | `sort_order` existed and drives every read, but nothing let a person change it for a line after it was created | A grip to drag (mouse / pen), **Move L0003 up / down** buttons (the keyboard and touch way: Tab, Enter), arrow keys on the grip, a live announcement ("L0003 moved to position 2 of 6") and a saved / error status line. Offered only to people who may edit that section, and only when the section has two or more rows. |

## Reused unchanged

Plan records (`proj_dp_items`, `proj_dp_lines`), the single-row save (`proj_dp_save_line`: permission `proj_dp_can_edit_section`, validation, same-name-in-a-section rule), release, proposals for released rows, the Timeline, Excel import / export, `proj_dp_plan` (it already returned lines in `sort_order`).

## Two new write paths, and why

* **`proj_dp_add_lines(item, section, rows, chain)`**: the existing single-row save cannot make many rows atomically from one screen action, and calling it once per row from the browser leaves a half-saved list when one row fails. The new function calls `proj_dp_save_line` for each row inside one transaction (it adds no insert of its own, so permission, validation and the same-name rule are the existing ones), up to 50 rows, and refuses the whole list naming the row (`Row 3: ...`).
* **`proj_dp_reorder_lines(item, line ids)`**: `proj_dp_save_line` sets `sort_order` only when a line is created or still a draft, and a released line takes changes only as proposals, so there was no way to persist an order. The new function changes `sort_order` and `updated_at` only: never a line's content or version (an open edit dialog is not invalidated), and it does not create proposals, tasks or equipment changes. Ordering is not a commitment, so released lines can be reordered. The listed lines take their new relative order **in the places they already hold**; every other line keeps its place. Each listed line must be one the person can edit (manager, or the section's delegate; a delegate cannot move another section's lines). The plan revision is raised only when something moved.

## Retrying a save never duplicates rows (verified)

* Quick add: a line is identified by item + section + name (case and spacing ignored), the rule the single-row save already enforces (and a unique index backs). A row that exists is returned as `existing` and is **left exactly as it is** (a later edit survives, the revision does not move). RLS tests: the same list again adds 0; a partly new list adds only the new rows; the same name twice in one list is one row; two saves at the same time make one of each; a refused row leaves nothing behind; the chain survives a retry. Browser: the same list pasted and saved again reports "0 new rows added; 6 already in the plan were left as they are", and a double click on **Add rows** adds one row.
* Reorder: sending the same order again reports `moved: 0` and does not change the plan revision (RLS test); the screen sends saves one after another, each with the whole order at that moment, and puts the saved order back if one is refused.

## Permissions

Unchanged model: the database decides on every call; the screen only hides controls. Manager and section delegates can Quick add and reorder their sections; an ordinary member sees neither (browser check) and the database refuses the call (RLS tests: member, wrong section, outsider, completed project). Another company cannot call them.

## Install order

1. `supabase/manual-sql/proj_plan_quick_add_reorder_00_preflight_readonly.sql` (read-only; rows 1 and 2 `OK`, row 3 `not installed yet`).
2. Apply `supabase/migrations/20270105000100_proj_plan_quick_add_reorder.sql` (two functions and their grants; no table, column or policy changes).
3. `supabase/manual-sql/proj_plan_quick_add_reorder_20_verify_readonly.sql` (every row `OK`).
4. Deploy the app. If the app goes first, the page still loads and draws the table; **Quick add** and the reorder controls are refused by the database until step 2 (the message says Projects is not installed).

Rollback: `supabase/manual-sql/proj_plan_quick_add_reorder_90_rollback.sql` (drops the two functions; rows added and the saved order stay). Deploy the app from before this follow-up first.

## Demo that was run (local, fictional)

The real Batak hardware list was **not** provided, so a stand-in list was used (Batak unit 4, Power distribution box 2, Network switch 1, Spare sensors 12, Flight case 3, Cable ties 100): pasted into Quick add with an owner and dates on the first rows; saved again (nothing added); a Moodboard -> Storyboard sequence with owners and dates; two rows reordered (one by dragging, one with the keyboard button, plus an arrow-key move); the page reloaded and the order, owners, dates and quantities were identical to the database; the same at 390 px (stacked rows, Quick add fits, the buttons reorder and persist); a plain member sees none of the controls; the collapsed sidebar is drawn collapsed by the server on the first paint and on other pages, and its flyout reaches the module's pages. Screenshots: `docs/projects-plan-usability-screenshots/`.

## Not done by Claude

Anything signed in on the hosted Preview; the hosted migration and verify pack; entering the real Batak list. Touch **dragging** is not offered (browsers do not fire drag events for touch): the up / down buttons are the touch path.

## Signed-in checks on Preview (Preview and Production share data: **WRITES** marked; use a test project)

1. Read only: open a live project's Project Plan: rows are one line each from a laptop width, stacked on a phone; nothing is missing against the old layout.
2. **WRITES (test project)**: **Quick add** on a technology, paste the Batak list, give two rows an owner and dates, **Add rows**. Press it again with the same list: the message says nothing was added twice.
3. **WRITES (test project)**: **Start from a sequence** Moodboard -> Storyboard with owners and dates.
4. **WRITES (test project)**: drag one row, use the arrow buttons on another, reload: same order.
5. Press **Collapse** in the sidebar, reload and open another page: it stays collapsed from the first paint; hover Projects & Tasks to reach its pages.
6. Clean up: remove the test rows (draft rows can be removed) or archive the test project. Nothing was released, so no task or equipment line exists.
