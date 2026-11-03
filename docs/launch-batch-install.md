# Launch refinement: install migrations 3 to 14 in three runs

**Nothing here has been run on any hosted project.** You have already applied launch migrations 1 and 2 with their own packs, and their verify and preservation comparisons passed. This page installs the other twelve (3 to 14, the list and the order are in `docs/launch-refinement-install-order.md`) with **three runs** instead of about 50: one read-only check, one installation, one read-only verification. The SQL of the twelve migrations is the SQL that was already reviewed, copied by a script, not retyped or changed.

**The individual packs are untouched and stay available for troubleshooting** (`<prefix>_00_preflight_readonly.sql`, `_05_preservation_check_readonly.sql`, `_20_verify_readonly.sql`, `_90_rollback.sql` for each change, listed in the install-order page). Use them if you want to go one change at a time, or to look closer at one change after the batch says something is wrong.

## 1. What each file is (read this before running anything)

| File (`supabase/manual-sql/`) | Kind | What it does |
|---|---|---|
| `launch_batch_00_preflight_and_snapshot_readonly.sql` | **Read-only** (SELECT only) | Run 1. Checks the prerequisites (PASS / FAIL rows) and takes the "before" picture of everything the changes must not change. Changes nothing. |
| `launch_batch_20_install_3_to_14.sql` | **Changes the database** (one transaction, all or nothing) | Run 2. Installs migrations 3 to 14 in order. If anything fails, it rolls back to exactly where it started. |
| `launch_batch_90_verify_and_compare_readonly.sql` | **Read-only** (SELECT only) | Run 3. Verifies the twelve changes and compares with the "before" picture: every difference is listed as INTENDED (by migration) or UNEXPECTED. Changes nothing. |
| `launch_batch_21_install_part_a_3_to_13.sql` and `launch_batch_22_install_part_b_14.sql` | **Change the database** (each its own transaction) | **Fallback only**, for the unlikely case that the SQL Editor refuses the one large paste of file 20 (section 6). Same migrations, split in two. You will not need them. |
| `scripts/build-launch-batch.mjs` | Developer tool, not SQL | Generates the files above from the migrations and the packs; `--check` proves they match (section 5). Run by us, not by you. |

## 2. Before you start (once)

1. **Record the schedulers' baselines first, as two separate records** (`docs/launch-refinement-hosted-checklist.md`): the Vercel cron run history and the PostgreSQL `pg_cron` job list and history. Nothing in this batch touches either scheduler (the check below proves it for `pg_cron`), and activating them is a separate, deferred decision.
2. **The dispatch / return notes switch stays OFF.** Turning it on (`inv_notes_30_switch_one_company_OPTIONAL_writes.sql`) is a later, separate decision. `deact_30_align_deactivated_accounts_OPTIONAL_writes.sql` is **not** part of this and is not run.
3. Pick a quiet moment for Run 2. It holds a few short locks until it commits (it replaces functions, narrows SELECT on one table and adds tables). It gives up after 15 seconds of waiting for a lock and rolls back; then simply run it again.
4. Use the SQL Editor of **Enginious HR Engine_V2** only. Run each file once, the whole file, one at a time.

## 3. The three runs

### Run 1: file 00 (read-only) before anything changes

Paste the whole of `launch_batch_00_preflight_and_snapshot_readonly.sql` and run it. One result table comes back (about 60 rows).

* **Expected:** the first row (`0 RESULT`) says **`PASS: every prerequisite is in place and migrations 3 to 14 are not applied yet.`** Every row in sections B (prerequisites) and C (migrations 3 to 14) says PASS.
* **Send back:** the first row, every row that is not PASS or INFO, and the **last row (`DIGEST`)**. The digest is one long line (about 5.6 KB, starts `{"v": 1`); copy that cell (the grid's copy-cell action, or Export to CSV). It is the "before" picture. **Keep it** for Run 3.
* **If the first row says something else:**
  * `FAIL`: a prerequisite is missing (the access grant rules migration, migration 1 or 2, or an object the later changes build on). The rows marked FAIL say which. **Do not run file 20. Send the whole result.**
  * `PARTIALLY APPLIED`: some of 3 to 14 are already in place (it names them). **Send the whole result before running file 20.** Running file 20 would still be safe (every migration can be repeated and a repeat changes nothing), but we want to know why they are partly there first. The digest it produced still works: file 90 treats those migrations as "already in place before the snapshot".
  * `ALREADY APPLIED`: all twelve are in place. There is nothing to install; run file 90 without pasting a digest to verify them.

### Run 2: file 20 (changes the database; one transaction)

Paste the whole of `launch_batch_20_install_3_to_14.sql` (about 157 KB, 2,400 lines) and run it once.

* **Expected:** one row: **`COMMITTED`** with a sentence saying migrations 3 to 14 are installed. (The editor shows only the last statement's result; the many lines of "CREATE FUNCTION" are not shown.)
* **If it shows an error:** the whole file is one transaction (`begin` ... `commit`), so a failed run **changed nothing**. Copy the whole error message and send it. **Do not run anything else.** Error messages from the file's own checks start with "Batch install refused" (a prerequisite is missing) or "Batch install rolled back" (the final check after the twelve changes did not find what it expected; the rollback then undid all of it).
* If the next thing you run in the same editor tab says "current transaction is aborted", run the single line `rollback;` once and continue (this is how PostgreSQL behaves when a script that began a transaction stops at an error; whether the Supabase editor keeps the same session open between runs is not something we could verify).
* **Running it again is safe** (for example if you are unsure whether it ran). A second run changes nothing it already changed.

### Run 3: file 90 (read-only) after the install

Open `launch_batch_90_verify_and_compare_readonly.sql`. Near the top, replace the single line that starts `>>> PASTE THE DIGEST HERE` with the one long digest line from Run 1 (keep the two `$digest$` markers around it). Then run the whole file. One result table comes back (about 80 rows; set the marked `false` to `true` to list every check, not only the exceptions).

* **Expected:** the first row (`0 RESULT`) says **`PASS: verification OK (N checks, 0 failing), preservation comparison PASS (61 unchanged, 51 intended, 0 unexpected), notes switch OFF, scheduler untouched.`** N is about 320 on a database with two companies (the number is not important; **0 failing** and **0 unexpected** are). The `1 verification` section ends with `OK: N checks, 0 failing`; the `3 comparison` section lists 51 `INTENDED` rows by migration and ends with `PASS`.
* **Send back:** the first row, and every row that is not OK, SAME or INTENDED (on a PASS there are none).
* **If it says `FAIL` or lists `UNEXPECTED` rows:** **send the whole result and do not run anything else.** An UNEXPECTED row means something changed that the batch is not supposed to change (or an expected change is missing). A changed row count on a live table (`notifications`, `approvals`, `attendance_segments`, ...) between Run 1 and Run 3 can simply be real use by people in those minutes (the migrations insert, edit and delete no rows): say so, and run Run 1 and Run 3 close together.
* `INCOMPLETE`: the digest is missing, was cut short or was damaged when pasted (the file checks its checksum). Copy the DIGEST cell again; if the editor shows `invalid input syntax for type json` that is the same cause.

## 4. If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Run 1 says FAIL | A prerequisite is missing | Do not run file 20. Send the whole result. |
| Run 2 error | Nothing changed (one transaction) | Send the error text. Do not run anything else. |
| Run 3 says FAIL or UNEXPECTED | Installed, but a check failed or something unplanned changed | Send the whole result. Do not run anything else. The individual packs (`<prefix>_20_verify_readonly.sql`, `<prefix>_05_preservation_check_readonly.sql`) look closer at one change. |

There is **no new combined rollback script**. A failed Run 2 needs none (the transaction is the rollback). After a successful install, if a change must be taken back later, use that change's own `<prefix>_90_rollback.sql`, **in the reverse of the install order (14, 13, ... 3)** and read each file's header first. What each restores (all are idempotent and change no rows):

| Rollback file | Restores |
|---|---|
| `inv_notes_90_rollback.sql` (14) | the earlier `inv_dispatch_to_project`, `inv_return_from_project`, `inv_next_code`; also removes the new tables, functions and column when no note has been issued. First response to any note problem is the smaller `inv_notes_80_switch_off_writes.sql` |
| `modaccess_90_rollback.sql` (13) | drops `module_access_managers` (denial screens say "Could not load who can grant access") |
| `blocknotify_90_rollback.sql` (12) | the earlier `proj_block_task` |
| `pbxwait_90_rollback.sql` (11) | drops `pbx_decisions_waiting_count` (Finance menu shows no number) |
| `scopectx_90_rollback.sql` (10) | drops the two scope-decision read functions |
| `apprscope_90_rollback.sql` (9) | the post-3 `resolve_approver` and `resolve_approver_for_company` (country scope off). **Before** rolling back 3 |
| `letters_90_rollback.sql` (8) | the earlier letters storage policy (**re-opens**: an employee can fetch a pending letter's file) |
| `polstat_90_rollback.sql` (7) | the earlier `preflight_phase2b_v2_policy_status` and its default EXECUTE (**re-opens** the draft-status exposure) |
| `reccard_90_rollback.sql` (6) | drops `recovery_decider_inbox` |
| `leadpick_90_rollback.sql` (5) | drops `attendance_lead_candidates` |
| `profstat_90_rollback.sql` (4) | grants SELECT on the whole of `profiles` to signed-in users again (**re-opens** the deactivation-reason exposure) |
| `deact_90_rollback.sql` (3) | the earlier routing and status functions; accounts deactivated while it was live keep `is_active = false` |

## 5. How the files are made safe

* **The migration text is copied, never typed.** `node scripts/build-launch-batch.mjs` writes file 20 by copying each `supabase/migrations/*.sql` between `-- ==== BEGIN MIGRATION <file> (<bytes>, sha256 <hash>) ====` and `-- ==== END MIGRATION <file> ====` lines. **No migration file was edited.**
* **A check that cannot drift.** `npm run check:launch-batch` (`node scripts/build-launch-batch.mjs --check`, needs no database) rebuilds everything in memory and fails if a committed batch file differs, if any embedded migration body is not byte-for-byte equal to its migration file (it also checks each marker's size and sha256), or if the wrong migrations are embedded. It was also cross-checked independently with `awk` extraction and `cmp`: 12 of 12 bodies identical.
* **Nothing in the migrations is unsafe inside one transaction.** The same script lexes every migration (comments, strings, dollar-quoted bodies) and refuses to build if a top-level statement is `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT`, `VACUUM`, `CREATE INDEX CONCURRENTLY`, `ALTER TYPE ... ADD VALUE`, `CREATE EXTENSION`, a session `SET`, a psql meta-command, or a DO block that ends the transaction. Result: 88 top-level statements, all `create or replace function`, `revoke` / `grant`, `create` / `alter table` / `create index` / `create policy` / `create trigger`, `drop policy` / `drop trigger if exists`; no dollar-quote tag other than `$$` (the wrapper uses `$batch_check$`, which no migration contains).
* **The checks are the existing packs' checks.** The verification in files 00, 20 (prerequisites) and 90 is generated from the existing `<prefix>_20_verify_readonly.sql` files; the lists of what must not change are the union of the existing `<prefix>_05_preservation_check_readonly.sql` lists (key table rows, privileges, policies, the rest of the schema, the earlier migrations' functions). File 20 starts with assertions that migrations 1 and 2 and the access grant rules migration are in place and refuses otherwise; it ends, before `commit`, with an assertion that each of the twelve is in place, that the profiles reason column is not readable by signed-in or anonymous users, that the policy-status function is not callable by anonymous users, and that the notes switch is **OFF for every company**; any failure raises an error and rolls everything back.
* **Scheduler untouched.** Files 00 and 90 fingerprint `cron.job` (if the `cron` schema exists; otherwise "not present") and the list of installed extensions, and file 90 fails if either changed. No migration touches either.
* **Verified here:** the whole of the above on a throwaway PostgreSQL 16 (section 7). **Assumed, not verifiable here:** that the hosted SQL Editor treats one pasted script like psql does (below).

## 6. Size, the SQL Editor and one transaction

* **Size.** File 20 is about 157 KB; file 00 is 62 KB, file 90 is 131 KB. The fallback parts are 104 KB (A: migrations 3 to 13) and 75 KB (B: migration 14). For comparison, the repository's earlier deployment guides already asked you to paste single migration files of 215 KB (the Inventory stock functions) and 198 KB (Recovery Leave windows) into the same editor. We found no documented limit below 157 KB, but we **could not test the hosted editor itself**: if it refuses or truncates the paste of file 20 (it would say so; a truncated paste cannot do harm because the script would then lack its `commit` and nothing is saved), use the fallback.
* **Fallback rules (only if needed).** Run `launch_batch_21_install_part_a_3_to_13.sql`, then `launch_batch_22_install_part_b_14.sql`. Each is its own all-or-nothing transaction with the same prerequisite and final checks. If A fails, nothing changed: send the message. If A succeeds and B fails, 3 to 13 are installed and 14 is not: run B again (safe) or send the message. After B, run file 90 as usual. Tested here: A then B ends in exactly the same state as file 20 (all 112 digest items equal).
* **One explicit `begin` ... `commit` inside the editor.** *Verified* with `psql` and with the `pg` driver sending the whole file as one simple query (what a SQL editor sends): the explicit `begin`/`commit` inside one multi-statement query works, the editor-style result is the last statement's (`COMMITTED`), a failure in any statement rolls everything back and leaves that session in "current transaction is aborted" until `rollback;` is sent, and a refused or failed run changed nothing (digest identical before and after). *Not verified (assumption):* that the Supabase SQL Editor itself sends a pasted script as one query on a session it then reuses. The repository already ships several owner scripts that begin their own transaction (for example the `_90_rollback.sql` files and `public_privileges_30_default_probe.sql`), which is the only local evidence of how the editor is used; the rollback note in Run 2 covers the one visible consequence.

## 7. Rehearsal evidence (throwaway database only; never hosted)

Disposable PostgreSQL 16 database built from the migrations of `main` (which already contains the access grant rules migration) plus launch migrations 1 and 2 only, the harness stubs and grants, then seeded through the real functions (sample company, Sales/Projects/Inventory scenario, budget scenario, a letter, approvals; 30 key tables, 112 digest items). Hosted grants were emulated (the four access-grant tables read-only for signed-in and anonymous users). The files tested are the committed files, run with `psql -v ON_ERROR_STOP=1 -f` on copies of that database (`create database ... template ...`), file 90 with the digest line pasted into its marked place.

| # | Test | Result |
|---|---|---|
| a | file 00 on the pre-batch database | `PASS` (78 + 14 + 11 prerequisite checks pass, 77 required objects present, 12 of 12 markers absent); digest 112 items, 5,633 bytes |
| b | file 20 | `COMMITTED`, 0.18 s |
| c | file 90 with the digest | `PASS: verification OK (320 checks, 0 failing), preservation comparison PASS (61 unchanged, 51 intended, 0 unexpected), notes switch OFF, scheduler untouched`; the 51 INTENDED rows: 13 replaced functions, 17 added functions, 9 privilege / policy / column / table changes, 12 migration markers; 0 UNEXPECTED |
| d | file 20 run again, then file 90 again | `COMMITTED`; same `PASS` (identical counts: a second run changes nothing) |
| e | injected failure (a failing statement inside migration 14's section; a second copy inside migration 13's), copies kept out of the repo | each stopped with its error; file 00's digest after is **identical** to the digest before, all 12 markers still absent: everything rolled back |
| f | prerequisite negatives (migration 1 not applied; migration 2 not applied; a changed access-grant function) | file 20 aborts with `Batch install refused, nothing was changed` and names the missing rules; digest unchanged, no marker of 3 to 14 present; file 00 reports `FAIL` with the same rows |
| extra | partially applied (3, 5 and 12 applied by hand) | file 00 says `PARTIALLY APPLIED: 3 of the 12 ... (3, 5, 12)`; file 20 then file 90 ends `PASS` (75 unchanged, 37 intended) |
| extra | fallback A then B | same final state as file 20 (112 of 112 items equal), file 90 `PASS` |
| extra | tampering after the install (a table row, migration 1's function, an unrelated function, the notes switch on, a fake `cron.job` change) | file 90 reports `FAIL` / `UNEXPECTED` and names each (migration 1's function, other functions, row fingerprints, the notes switch, the scheduler fingerprint) |
| extra | missing, damaged and cut-short digest | `INCOMPLETE`, comparison NOT RUN, no false PASS |
| g | compatibility with **current production code** (below) | see below |

### (g) Current `main` against the migrated database

`main`'s RLS test suite (`packages/rls-tests`, from a `git worktree` of `origin/main`, 37 files, 1,307 tests), with the harness patched only in that scratch worktree to apply migrations 1 and 2, then `main`'s own grants file, then **file 20 itself** (the hosted order: grants exist first, the migrations come later): **1,304 pass, 3 fail, and all 3 are intended changes**; on `main`'s own database without the batch the same two files pass (78 of 78), and applying only migration 4, or only migration 8, reproduces exactly its failures:

| Failing `main` test | Why (intended change) |
|---|---|
| `account_security_controls`: "lets Sys Admin set any profile's account_status directly" and "lets a Sys Admin deactivate a plain user, recording who/why/when" | After migration 4, `status_reason` / `status_changed_by` are not readable directly by anyone signed in (a System Administrator reads them through `account_status_details()`); the tests `select` those columns directly. Migration 4's own test is `profiles_status_columns.rls.test.ts`. No code of `main` reads those columns or uses `select *` on `profiles` (searched) |
| `phase6`: "lets the owning employee, HR Admin, and CEO read a stored letter file; blocks a peer" | After migration 8 an employee reads the stored file only of an **issued** letter that has a letters row for that exact file; the test stores a file with no letter row. HR Admin and CEO branches are unchanged |

No unexplained failure. (The suite had no failure for any of migrations 3, 5 to 7, 9 to 14.)

Browser flows of `main`'s own application (built from the `main` worktree, `VERCEL_ENV=production next build`, served locally against a database built the same way and seeded with `main`'s own seed scripts) are listed in the last section.

## 8. Order of everything, and what is not part of this

1. Baselines (section 2). 2. Run 1, Run 2, Run 3. 3. **Merge the pull requests only after the database is verified, in the order #53, #54, #55** (each retargeted to `main` after the one before it merges, CI green first); the application merge is a **separate later step** (database first: the old application keeps working with the new database, see column A of the install-order page). 4. The notes switch stays OFF; `deact_30` is not run; the schedulers are not activated.
