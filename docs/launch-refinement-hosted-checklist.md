# Launch refinement: hosted verification checklist

What local testing **cannot** establish, to be checked by the owner on **Enginious HR Engine_V2** and Vercel. Sequence and the list of the 14 migrations: `docs/launch-refinement-install-order.md` (this page never repeats it). Nothing here is a hosted action until the owner runs it.

**Rules.** Previews and the hosted app use the **live** V2 database: on a preview only **look**; do not create projects or enquiries, move stock, record a dispatch or return, switch anything on, or save anything. The SQL in this checklist is only the read-only files (`*_00_preflight_readonly.sql`, `*_05_preservation_check_readonly.sql`, `*_20_verify_readonly.sql`, and the two scheduler SELECTs below). The migrations, the rollbacks and the three data-writing files (`deact_30_…`, `inv_notes_30_…`, `inv_notes_80_…`) are **not** read-only and are not part of this checklist; the notes switch stays **off**.

## A. Expected BEFORE installation (a preflight that finds an existing defect is not a failed installation)

Each `_00` preflight must say section B "not applied yet". Section D rows are findings about the live state, not pass/fail:

| Preflight (section D) | What it may show today | Meaning |
|---|---|---|
| `polstat_00` | can a signed-in employee / anonymous call the policy status function: `true` | The existing exposure that #7 closes. `false` means V2 is already narrower. Either is information |
| `profstat_00` | `status_reason` readable by signed-in users: `true` | The existing exposure that #4 closes (D-11) |
| `letters_00` | letters with a stored file that are not issued; employee read policy without the issued test | The existing exposure that #8 closes |
| `apprscope_00` | list of country-limited role grants (`none` = #9 changes nothing today) | Information |
| `deact_00` | deactivated accounts still flagged active, approvals pending on them | Information for the owner's decision on `deact_30` (unrun) |
| `scopectx_00`, `proj_scope_notify_00`, `blocknotify_00` | scope approvers who are not on the project; blockers naming a non-PM | Information; nobody gains access |
| `modaccess_00` | modules with no active access manager | The denial screens then use the generic wording |
| `inv_notes_00` | the three functions #14 replaces say yes (they are the tested versions); the note tables do not exist yet; Inventory companies | Yes x3 is required before #14; "no" means the hosted copy has drifted: stop and send the result |

## B. Required AFTER installation

Every `_20_verify_readonly.sql` ends `OK … 0 failing`, and the matching `_05` compare starts with **PASS**. Plus these results, which distinguish permission to **execute** a function from the checks **inside** it (Supabase grants EXECUTE by default, so each migration revokes it from anonymous callers; the verify files test this):

| Function (migration) | Anonymous | Ordinary signed-in employee | Authorised caller |
|---|---|---|---|
| `user_is_active`, `account_deactivation_blockers` (#3), `inv_make_project_note`, `inv_project_notes_enabled` (#14) | No EXECUTE | **No EXECUTE** (internal helpers) | Only other database functions call them |
| `account_holdings` (#3), `account_status_details` (#4) | No EXECUTE | EXECUTE yes; the function **refuses** ("Only a System Administrator…") | System Administrator gets the data |
| `preflight_phase2b_v2_policy_status` (#7) | No EXECUTE | EXECUTE yes; **returns no rows** | HR Admin / CEO / CTO whose role is unscoped by company gets the rows of their countries |
| `attendance_lead_candidates` (#5) | No EXECUTE | Id and display name of active people of their **own** company only | Same (no extra rights) |
| `recovery_decider_inbox` (#6), `proj_scope_decisions_waiting`, `proj_scope_decision_context` (#10), `inv_notes_waiting_for_me` (#14) | No EXECUTE | EXECUTE yes; **empty** result (nothing they may decide) | A decider gets only the rows they may decide now |
| `pbx_decisions_waiting_count` (#11) | No EXECUTE | EXECUTE yes; returns **0** | A budget decider gets the number |
| `module_access_managers` (#13) | No EXECUTE | Names of that module's access managers in their own company (intended for everyone signed in) | Same |
| `inv_set_project_notes`, `inv_ack_project_note`, `inv_resolve_note_difference` (#14) | No EXECUTE | EXECUTE yes; **refused inside** (founder / current or acting PM / warehouse operator only) | Allowed by role; with the switch off no note exists |

Other results: `profstat_20` says signed-in users cannot read `status_reason`, `status_changed_by`, `status_changed_at` (names, e-mails, status stay readable); `letters_20` OK (an employee reads only issued letters' files); `inv_notes_20` reports the switch column present and defaulting to off, and **no company with it on** (`none`); `public_privileges_00_preflight_readonly.sql` gives the same answer as the last time you ran it.

## C. Scheduled jobs: two separate checks, neither is activated or changed

1. **Vercel cron history** (the entries in `vercel.json`): in the Vercel project, Settings > Cron Jobs and the runtime logs for those paths. Record the last run time and result of each path.
2. **PostgreSQL `pg_cron` history**: in the SQL Editor, `select jobid, jobname, schedule, active from cron.job;` and the newest rows of `select * from cron.job_run_details order by start_time desc limit 50;` (SELECT only; `recovery_windows_00_preflight_readonly.sql` row 0.10 shows whether `pg_cron` is installed).

Compare each with the baseline recorded before step 1 of the install order. **If no baseline exists, record the current state now and say so: before/after equality cannot be established**, only that nothing new appeared afterwards. This stack adds no job to either scheduler; activating them is a separate deferred owner decision.

## D. What is NOT hosted-verified in this release

* **Issued timeline PDF (asset loading only).** On the branch preview, as a project member, open an **already issued** timeline PDF (Project > Documents > Plans > PDF) without creating anything: ENGINIOUS logo top left, text in the screen's typeface (Carlito), not a plain default face. This checks that the **logo and fonts load on Vercel** and nothing more. It does **not** verify the new dispatch / return workflow.
* **Dispatch notes and return checklists.** There is no hosted verification of the workflow in this release: the switch stays off and previews write to the live V2 database, so none may be recorded there. It is verified locally only (`docs/launch-p3-deployment.md` on #55, "Local verification") and checked on the real company only if the owner later decides to switch it on.

If any result differs from what is stated here, stop and send the whole result; nothing here asks you to change data to get a pass.
