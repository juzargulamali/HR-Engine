# Recovery Leave windows redesign — deployment guide

This is the owner's runbook for the "final attendance and recovery redesign": working periods and
24-elapsed-hour recovery windows, the automatic read-first attendance register, HR alerts and a protected
background processor.

**Nothing in this change runs Production SQL, activates a policy, deploys, merges or starts a scheduler on its
own.** The pull request is a draft. You run the SQL by hand in the existing Supabase SQL Editor, in the order
below. The database migration is **dormant**: applying it does not change how a single clock-in is calculated.
The new window calculation only starts for an employee's country once someone deliberately activates a
Recovery Leave windows policy there (step 7), and only for clock-ins that start on or after the effective date
chosen at that moment.

> Honest status: everything in this change was verified locally — unit tests, real-PostgreSQL/RLS tests with a
> controlled clock, component tests, lint, typecheck and a production build. **None of it has run against your
> live Supabase project, a Vercel deployment or a real browser session.** The steps below include the checks
> that prove it live, and the dedicated end-to-end workflow is manual-only.

---

## 1. What changes, in plain English

| Area | Before | After (once the policy is activated) |
|---|---|---|
| What counts | Same-calendar-day segments, a ≤4h / >4h rule, weekends and holidays only (overnight shifts handled separately) | Recorded clocked-in time only. Lunch while clocked in counts; clocked-out gaps never do. No break buttons. |
| Grouping | One local calendar day | A **working period**: sessions separated by clocked-out gaps shorter than 8 hours. A gap of 8h or more ends it. |
| Unit of decision | The day | A **recovery window**: at most 24 *real elapsed* hours from the period's first clock-in, then from each previous boundary. It rolls over by itself — no clock-out needed, not tied to midnight. Maximum 1 day per window. |
| Normal working day | nothing | up to and including 13h = 0 · over 13h up to and including 17h = 0.5 · over 17h = 1 |
| Rest day / public holiday | ≤4h = 0.5, >4h = 1 | under 2h = 0 · 2h up to and including 6h = 0.5 · over 6h = 1 |
| Work modes | Site work only qualified at night | Office, WFH, Site work and Client meeting all count. Business travel is recorded but always reviewed by HR. |
| Region | Country timezone for dates | Employee's own country and configured time zone (never the browser): UAE/Poland Mon–Fri, Saudi Sun–Thu, plus public holidays. A window is classified by the local date it **starts** on. |
| HR alert | none | At 20 accumulated recorded hours with no 8-hour rest (warning only) and at each automatic 24-hour rollover. In-app only. |
| Approvals | Same four routes | Same four routes, kept. Final approval needs a **closed** window (enforced in the database) and, for unusual cases, explicit HR verification. |
| Corrections | Typed hours | HR edits the evidence (reason required, original and corrected both kept). Windows, alerts and requests recalculate. After credit: only the **difference** is requested (0.5 → 1 asks for +0.5). |
| HR attendance page | All-row manual bulk-edit register | Automatic read-first register; HR-only Edit; "Add missing attendance". The old manual tool is still at `/attendance?manual=1`. |

Unchanged on purpose: Annual Leave, payroll, 180-day expiry (counted from the window's own date), oldest-first
consumption, no cash conversion on termination, the statutory-safeguard wording, the four approval routes, and
every existing session, request, credit and audit row.

## 2. What was added (files)

- `supabase/migrations/20261108000000_recovery_windows_attendance_redesign.sql` — **the one new SQL file** (canonical; run it
  as a single script). Additive and dormant. Mirrored into `schema/schema.sql` (section 17 plus six replaced function bodies).
- `supabase/manual-sql/recovery_windows_00_preflight_readonly.sql` — step 0, read-only.
- `supabase/manual-sql/recovery_windows_50_preservation_snapshot_readonly.sql` — before/after fingerprints.
- `supabase/manual-sql/recovery_windows_20_post_migration_verify_readonly.sql` — step 2, read-only.
- `supabase/manual-sql/recovery_windows_30_enable_scheduler.sql` — step 4, optional pg_cron.
- `supabase/manual-sql/recovery_windows_40_disable_and_reconcile.sql` — rollback/disable and reconcile.
- Application code (register, dashboard card, approval evidence, alerts, policy screens), the protected
  `/api/cron/recovery-windows` route, tests, and two GitHub workflows (CI isolation guard, manual Preview E2E).

## 3. Unresolved dependencies (decide or confirm before step 7)

1. **Two different HR Admins with a company-unscoped grant** for each of UAE, Saudi Arabia and Poland: one drafts, the other
   activates (the existing two-person rule is kept, and activation sets the effective date, which is policy content, so
   the CEO/CTO "activate only" path cannot be used for this policy type).
2. **Public holidays** must be loaded for the coming year for AE, SA and PL (preflight 0.9 shows the counts; the sandbox
   fixtures are not a substitute). A missing holiday would classify that window as a normal day.
3. **Business travel** is recorded and always sent to HR for explicit verification. The brief asks HR to define when passive
   travel is working time; until it is defined, HR verifies each case by hand. No automatic rule was invented.
4. **The 5-minute scheduler is the owner's switch** (step 4). If you never enable it, only the daily Vercel safety net runs and
   windows will close, and alerts appear, once a day. Vercel's Hobby plan cannot schedule more often than daily.
5. **The staff test workbook** (the old 180-check Excel) was not available to me. It describes the *old* rules, so its
   recovery/attendance rows are obsolete once this is live. Replacement plain-English cases are in
   `docs/recovery-windows-staff-test-checklist.md`; updating the workbook itself is pending.
6. The previous overnight-routing Production E2E (`tests/mutating/25-attendance-clock.spec.ts`) and the previous manual-register
   credit assertions (`20-attendance.spec.ts`) describe the old calculation. They are untouched; retire or rewrite them when
   you activate the new policy (see section 10).

## 4. Pre-flight (read-only) — step 0

1. Take the **preservation snapshot** first: open `recovery_windows_50_preservation_snapshot_readonly.sql`, set the cut-off to
   *now* (UTC, one line), run it, and save the output. You will run it again later with the **same** cut-off.
2. Run `recovery_windows_00_preflight_readonly.sql`. Expected: prerequisites all `true`; the new objects all `false`;
   no policy with `model = recovery_windows`; open sessions and pending requests noted (they keep their old chain);
   every country in your data is AE/SA/PL (otherwise it falls back to Dubai time); working weekdays AE/PL `{1,2,3,4,5}`,
   SA `{0,1,2,3,4}`; holidays present; `pg_cron` availability (0.10).

None of these queries changes anything or shows a credential.

## 5. Apply the database migration — step 1

- Open the Supabase **SQL Editor** for the existing project and paste the **entire** contents of
  `supabase/migrations/20261108000000_recovery_windows_attendance_redesign.sql`. Run it once.
- **Transaction strategy:** the file begins with `begin;` and ends with `commit;`, so it is all-or-nothing. If any statement
  fails, nothing is applied; run `rollback;` to clear the aborted session and tell me the error. It is also re-runnable
  (`IF NOT EXISTS` / `CREATE OR REPLACE`), but there is no reason to run it twice.
- **Compatibility with the code currently deployed:** safe. Every new column on an existing table is nullable or has a default
  (`attendance_sessions.recovery_model` defaults to `'legacy'`), the six replaced functions behave exactly as before for
  legacy rows, and the old app never calls the new functions. Deploy the database **before** the app, never the other way round
  (the new screens call new functions).
- **It does not enable anything.** No policy is created or activated, no scheduler started, no row rewritten.

## 6. Verify — step 2 (read-only)

Run `recovery_windows_20_post_migration_verify_readonly.sql`. Expected: 8 tables, `rls = true` on all; **zero** INSERT/UPDATE/DELETE
grants for `anon`/`authenticated`; only `SELECT` policies; the processor and engine **not** executable by signed-in roles
(`false`/`false`/`false`); `windowed_sessions = 0` and every count 0; `active_windows_policies = 0`; the new columns nullable or
defaulted; the five triggers present; the six replaced functions present.

Run the preservation snapshot again with the **same cut-off**. Every row must show the **same** `row_count` and
`fingerprint` as before (the script never clears data, edits grants or touches test-account routing).
Expected differences after activation only: the previous Recovery Leave version gains an `effective_to` the day before the new
one starts (that is the controlled end of the old version; nothing else in it changes).

## 7. Deploy the app — step 3 (your normal merge/deploy)

I have not merged or deployed. When you are ready: mark the PR ready, merge, and let Vercel deploy as usual. Required environment
(unchanged from today): `CRON_SECRET` and the Supabase keys. The new `vercel.json` cron `/api/cron/recovery-windows` (daily,
00:30 UTC) is a safety net; it requires `Authorization: Bearer $CRON_SECRET`.

Until a policy is activated the deployed app calculates Recovery Leave exactly as before. The new register and dashboard card
still show real clock states (from real sessions), but there are no working periods, windows, window figures or work alerts yet.

## 8. Enable the 5-minute scheduler — step 4 (optional, recommended before activation)

1. In the Supabase Dashboard enable the **pg_cron** extension (Database → Extensions).
2. Run `recovery_windows_30_enable_scheduler.sql` (it schedules `recovery_process_due()` every 5 minutes).
3. Wait about 10 minutes and run the verification queries in that file; the Alerts page (HR Admin) also shows the scheduler
   banner (last successful run, overdue warning, whether pg_cron is enabled).

**Do not treat the 5-minute processing as live until a recent `succeeded` run appears.** The function is idempotent and
catches up every boundary missed since the last run, so a delay is never unsafe, only late.

## 9. Policies — step 5/6 (draft, review, activate)

1. As a **company-unscoped HR Admin**, open **Policies** and press **Create Recovery Leave (windows) drafts**. It creates the
   *next available* version (not overwriting V2) as a **draft** for UAE, Saudi Arabia and Poland, with the exact bands, the
   9h requirement, 8h rest, 20h alert, 24h windows, 1-day cap, mode eligibility, closure rule, approval routes, travel review,
   correction rules, 180-day expiry, no cash conversion and the statutory-safeguard wording. The policy text is generated from
   the machine-readable rules, so wording and calculation cannot disagree. Annual Leave is untouched.
2. Review each draft's page (rules table plus generated wording).
3. A **different** unscoped HR Admin opens the draft and uses **Activate with a controlled effective date**. The date must be
   tomorrow or later in that country's time zone (never retroactive). The version in force ends the day before; nothing is
   edited. There is no SQL shortcut: a plain status update is refused by a trigger, and `seed_…`/`activate_…` refuse the SQL
   Editor (no signed-in user).
4. **What happens to sessions in flight:** a session that started before the effective date finishes under the old same-day
   rule. The first clock-in on or after the effective date starts the first working period. History is never recalculated.
   Requests already pending under the old rule keep their original approval chain. Each new working period snapshots its policy
   version and rules, so a later policy change never moves a period in progress.

## 10. Live checks — step 7

- **Dedicated Preview workflow:** `E2E Recovery Leave windows (Preview) — manual only`
  (`.github/workflows/e2e-preview-recovery-windows.yml`). Run it against a Vercel Preview of this branch. It needs the typed
  confirmation `RUN_PREVIEW_E2E_SAME_DB` (a Preview uses the same database and the same dedicated test accounts as Production)
  and, for the mutating job, `mutation_authorized = true`.
  - Read-only job (always): the register columns, text clock states, filters, "Last updated"/live/stale states, the dashboard
    card, the alerts page, and phone layout. Mutates nothing.
  - Mutating job (opt-in, zero retries, never auto-rerun): an Office clock-in/out by the Employee test account, an HR
    "Add missing attendance" (1 hour, a random past date) and HR's correction of it (to 1.5 hours). Every duration is under
    2 hours, which earns nothing under any band on any day type, so it **cannot create a credit, a pending approval or a ledger
    entry**, and it never approves or rejects anything. Left behind, permanently, tagged with the run id in each free-text field:
    those sessions and the correction record. Nothing is cleaned up automatically; failed mutating tests must be inspected, not
    re-run. If the windows policy is not yet active the correction step skips itself with a clear message.
- These specs live in `packages/e2e-tests/tests/recovery-windows/` and their own Playwright projects
  (`preview-recovery-windows-*`). CI fails if any of them is ever matched by a Production project, so the PR-triggered
  Production QA workflow cannot run them.
- Existing Production specs that describe the **old** calculation (`25-attendance-clock.spec.ts` overnight routing,
  the recovery-credit expectations in `20-attendance.spec.ts`) will no longer match reality in countries where the new policy is
  active; retire or rewrite them at activation. The old manual register page object now opens `/attendance?manual=1`.
- Staff cases: `docs/recovery-windows-staff-test-checklist.md`.

## 11. Disable / rollback

Because the migration is additive, there is nothing to roll back in the database. To stop using the window model:

1. In the app, as an unscoped HR Admin, call `deactivate_recovery_windows_policy(<version id>, <last effective date>)`
   (tomorrow or later). Clock-ins after that date return to the old rule; **no session, period, window, request, credit or audit
   row is deleted or changed**; periods already running finish under their own rules; the earlier version's wording is re-drafted
   for normal reactivation. (Emergency owner fallback, plain `UPDATE … SET effective_to`, is in
   `recovery_windows_40_disable_and_reconcile.sql`.)
2. Optionally stop the processor: `select cron.unschedule('recovery-window-processor');` and remove the cron from `vercel.json`.
3. **Reconcile** what the window model created with the read-only queries in the same file (periods/windows by state, requests by
   type, credits posted with source `recovery_window*`, sessions still running under the model, alerts, processor failures).
   Decide any pending requests in the app as normal; reverse any credit that should not stand through HR's normal process.

## 12. Owner checklist (short)

1. Run the snapshot (set the cut-off), then the preflight. Read the results.
2. Run the migration file once in the SQL Editor. Run the verify script and the snapshot again; compare.
3. Merge and deploy the PR when you are satisfied.
4. (Recommended) Enable pg_cron and run the scheduler script; wait for a successful run.
5. HR Admin A drafts the windows policies; check the rules and wording; HR Admin B activates each country with an effective date.
6. Run the dedicated Preview workflow (read-only first; mutating only if you authorise it; never auto-rerun a failed mutating test).
7. Work through the staff checklist cases. Report anything unexpected before widening use.

## 13. Known limits (stated, not hidden)

- Alerts are **in-app only** (no email or push).
- The Hobby-plan Vercel cron is daily only; sub-daily processing needs pg_cron (your switch).
- Daily presence in the register and the dashboard figures between background runs are computed live from the evidence, so they
  are right to the second; requests, alerts and window closure follow the processor cadence.
- Closing a window by 24 elapsed hours while someone is still clocked in creates its request at the next processor run (or the
  next clock event for that employee), not at the exact second.
- Corrections that would restructure a working period that already has an approved credit are **refused** (nothing changes);
  adjust the evidence so the period start does not move, or review the credit separately.
- A manual daily total can never prove gaps or windows, so under the new policy it never creates a credit; it is flagged for review
  and HR records exact times with "Add missing attendance" instead.
