# Delivery Plan (Projects & Tasks Phase 2, part 1): rollout

Migration `supabase/migrations/20261231000100_proj_delivery_plan.sql` (install-order row 28). **Status (2026-11-12): applied on the hosted database by the owner with the preflight and verify packs, all passed (owner-reported); the app is merged in PR #84 (`e12c22f`); Production: Vercel deployed `e12c22f` and the signed-in smoke check of the Delivery plan passed (owner-reported).** Reference: `docs/enginious-os/modules/projects-delivery-plan.md`.

## What it adds
Six tables (`proj_dp_state`, `proj_dp_items`, `proj_dp_lines`, `proj_dp_delegations`, `proj_dp_corrections`, `proj_dp_changes`) and sixteen functions. Nothing existing is altered. Signed-in users can read the tables through row-level security (people who can read the project's details) and cannot write them; every change goes through a function that checks the caller.

## Order (either order is safe; migration first is recommended)
1. `supabase/manual-sql/proj_delivery_plan_00_preflight_readonly.sql` (read-only): rows 1 to 3 `OK`; row 4 `not installed yet`.
2. Apply `supabase/migrations/20261231000100_proj_delivery_plan.sql` (changes the database; idempotent).
3. `supabase/manual-sql/proj_delivery_plan_20_verify_readonly.sql` (read-only): every row `OK` (the last row is `INFO`).
4. Deploy the app. If the app is deployed first, the Delivery plan tab says "The Delivery plan is not installed in this environment yet." and nothing else changes.

Preview and Production share one database: applying the migration is visible to both, but until the app with the tab is merged nothing in Production reads or writes these tables.

## Checks that do not write (signed-in Preview)
* Open a project you are on: the **Delivery plan** tab is there, empty, with Download template and Export Excel.
* Download template opens in Excel with the Deliverables, Breakdown and Instructions sheets.
* As someone not on the project: the project opens as a summary and has no Delivery plan.

## Checks that write (need the owner's go-ahead; use a clearly named test project)
Add a deliverable and lines, delegate a section, release, confirm that the tasks are on Work and the hardware is on the DRAFT equipment request (not submitted), raise and decide a correction, propose and approve a change to a released line, import the exported workbook twice and confirm that nothing is added. To clean up: cancel the test tasks and the draft request where they live; the plan rows of a released test deliverable stay.

## Recovery
* The migration fails part-way: it is one transaction; fix the cause and apply again.
* The feature must be withdrawn: export the six tables, then run `supabase/manual-sql/proj_delivery_plan_90_rollback.sql`. Tasks and equipment lines that Release created are ordinary records and stay.
