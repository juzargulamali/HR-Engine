# Project Closeout Report (Projects & Tasks Phase 2, part 2): rollout

Migration `supabase/migrations/20270101000100_proj_closeout_reports.sql` (install-order row 29). **Status: not applied anywhere by Claude; hosted status `Unverified`.** Reference: `docs/enginious-os/modules/projects-closeout-report.md`.

## What it adds
Two tables (`proj_closeout_reports` and the small counter `proj_closeout_usage`) and seven functions. Nothing existing is altered. Signed-in users can read the table through row-level security (only whoever manages the project) and cannot write them; every change goes through a function that checks the caller. Nothing here completes a project, notifies anyone or touches stock.

## Order
Apply **after** row 28 (`20261231000100_proj_delivery_plan.sql`): the evidence reads the Delivery Plan tables.
1. `supabase/manual-sql/proj_closeout_reports_00_preflight_readonly.sql` (read-only): rows 1 to 3 `OK`; row 4 `not installed yet`.
2. Apply `supabase/migrations/20270101000100_proj_closeout_reports.sql` (changes the database; idempotent).
3. `supabase/manual-sql/proj_closeout_reports_20_verify_readonly.sql` (read-only): every row `OK` (the last row is `INFO`).
4. Deploy the app. If the app is deployed first, the Closeout report screen says "The closeout report is not installed in this environment yet." and nothing else changes.

Preview and Production share one database: applying the migration is visible to both, but until the app with the screen is merged nothing in Production reads or writes this table.

## The AI provider
The AI draft uses the provider settings that already exist (`ANTHROPIC_API_KEY`, `JARVIS_PROVIDER`, `JARVIS_DISABLED`). It does not need the JARVIS pilot list and adds no setting. AI drafts are limited to 10 per project per day; a facts-only draft does not count. Where no provider is set up, or `JARVIS_DISABLED=1`, the screen offers only the facts-only draft, which sends nothing. The simulated provider is refused in Production, as before.

## Checks that do not write and send nothing (signed-in Preview)
* As the Project Manager of a project: **Manage project > Closeout report** opens "Review data to be sent" with the source categories, the team names and the optional text. Tick and untick a text: the count changes. Do not press either button.
* Files & client plan shows the **Closeout report** panel with **Generate closeout report**; Complete project shows the link.
* As a member who does not manage the project: the Manage project menu has no Closeout report, and opening `/projects/<id>/closeout` says who the Project Manager is.
* As someone not on the project: the project opens as a summary; the closeout address shows no report.

## Checks that write (need the owner's go-ahead; use a clearly named test project)
* **Facts-only draft (sends nothing):** press "Write a facts-only draft". Edit a paragraph, save, approve, download the PDF. Confirm that the project's status, tasks, notices and equipment are unchanged.
* **Live Anthropic call (separately authorised):** press "Send to Anthropic and write the draft" once on the test project. Confirm the draft cites sources, says that client sign-off is not recorded where none is, and shows equipment still out. Press it again without changing anything: it says nothing was sent again.
* To clean up: discard the draft. An approved test version stays (it can only be removed with the rollback, which removes all reports).

## Recovery
* The migration fails part-way: it is one transaction; fix the cause and apply again.
* The feature must be withdrawn: export `proj_closeout_reports`, then run `supabase/manual-sql/proj_closeout_reports_90_rollback.sql`. Nothing else is affected.
* The provider must be stopped at once: set `JARVIS_DISABLED=1` (this also switches JARVIS off). The facts-only draft keeps working.
