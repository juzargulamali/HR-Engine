# Recovery Leave windows redesign — deployment guide

This is the owner's runbook for the "final attendance and recovery redesign": working periods and 24-elapsed-hour recovery
windows, the automatic read-first attendance register, HR alerts and a protected background processor.

**Nothing in this change runs Production SQL, activates a policy, deploys, merges or starts a scheduler on its own.** The pull
request is a draft. You run the SQL by hand in the Supabase SQL Editor of **Enginious HR Engine_V2** (the only project to use),
in the order in §12. The migration is **dormant**: applying it does not change how a single clock-in is calculated. The new
calculation starts for a country only when someone deliberately activates a Recovery Leave windows policy there, and only for
working periods that begin on or after the effective date chosen at that moment.

> **Honest status.** Verified locally on the final commit: unit tests, real-PostgreSQL/RLS tests with a controlled clock, component
> tests, lint, typecheck, a production build, **and — new — the real app driven by a real Chromium against a real Postgres +
> PostgREST** (the local full stack, §9). **Not verified live:** nothing has run against your hosted Supabase project, Vercel,
> pg_cron, Supabase Auth or real data. §9 says exactly which tests prove what.

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
| HR attendance page | All-row manual bulk-edit register | Automatic read-first register; HR-only Edit; "Add missing attendance". The old manual tool is still at `/attendance?manual=1` and now says which rules are in force. |

Unchanged on purpose: Annual Leave, payroll, 180-day expiry (counted from the window's own date), oldest-first consumption, no cash
conversion on termination, the statutory-safeguard wording, the four approval routes, and every existing session, request, credit,
policy version and audit row. **Old policies, pending requests and balances are preserved** (§11 shows the check).

## 2. What was added (files)

- `supabase/migrations/20261108000000_recovery_windows_attendance_redesign.sql` — **the one new SQL file** (canonical; run it as a
  single script). Additive and dormant. Mirrored into `schema/schema.sql` (section 17 plus seven replaced function bodies).
- Read-only/owner scripts in `supabase/manual-sql/`: `recovery_windows_00_preflight_readonly.sql`,
  `recovery_windows_50_preservation_snapshot_readonly.sql`, `recovery_windows_20_post_migration_verify_readonly.sql`,
  `recovery_windows_30_enable_scheduler.sql` (**required before activation**), `recovery_windows_40_disable_and_reconcile.sql`.
- Application code (register, dashboard card, approval evidence, alerts, policy screens), the protected `/api/cron/recovery-windows`
  route, unit/component/RLS tests, the browser specs and the local full-stack harness (`packages/e2e-tests/local-stack/`), and two
  GitHub workflows (CI isolation guard, manual Preview E2E).

## 3. Confirm everything points at Enginious HR Engine_V2 (no credentials are shown or needed)

The old Supabase project is deleted. This branch contains **no** project address, ref or key anywhere (`.env.example` has
placeholders; CI uses placeholders; the e2e suite reads its URL and accounts from your secrets; `supabase/config.toml` is the
local-dev stack only). The pg_cron job runs *inside* the database, so it can only ever act on the database it is created in. What I
**could not** see from here — and you must confirm — is the configuration that lives outside the repository:

| Where | Setting (names only) | What to confirm |
|---|---|---|
| Vercel project → Settings → Environment Variables (Production **and** Preview) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | They belong to **Enginious HR Engine_V2** (Supabase → Project Settings → API shows the URL and which keys are current). Re-deploy after changing any. |
| Vercel | `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` | Set; the site URL is also in V2's Authentication → URL Configuration → Redirect URLs. |
| GitHub → Settings → Environments → `production-qa` | secrets `E2E_*_EMAIL/PASSWORD`, `E2E_BASE_URL`; variable `E2E_ATTENDANCE_CLOCK_TIMEZONE` | The test accounts exist in V2 and `E2E_BASE_URL` is the V2-bound deployment. |
| Supabase V2 → Database → Extensions | `pg_cron` | Enabled **in V2** (§7). |

**One-step proof that the deployed app and the SQL you run are the same database — the fingerprint.** The migration stamps the
database with a random fingerprint. After deploying, an HR Admin opens **Alerts**: the "Recovery Leave background processing" panel
shows `Database fingerprint: xxxxxxxx` (first 8 characters). In the V2 SQL Editor, `recovery_windows_20_post_migration_verify_readonly.sql`
(check 2.0) prints the same 8 characters. **If they match, the app is bound to V2. If they differ, or the app shows none, stop** —
Vercel's Supabase variables point somewhere else. Nothing secret is displayed by either side.

## 4. Unresolved dependencies (decide or confirm before activation)

1. **Who activates** — see §6 (governance). You need, per country, one HR Admin (or more) to draft and a **different** HR Admin or
   CEO/CTO to activate. Their grants need not be global: a grant limited to that country (company not set) is enough.
2. **Public holidays** must be loaded for the coming year for AE, SA and PL (preflight 0.9 shows the counts). A missing holiday
   would classify that window as a normal day.
3. **Business travel** is recorded and always sent to HR for explicit verification. The brief asks HR to define when passive travel
   is working time; until it is defined, HR verifies each case by hand. No automatic rule was invented.
4. **The staff test workbook** (the old 180-check Excel) was not available to me. Its recovery/attendance rows describe the *old*
   rules and are obsolete once this is live. Replacement plain-English cases are in `docs/recovery-windows-staff-test-checklist.md`;
   **updating the workbook itself is still pending.**
5. **Policy wording sign-off** — the generated wording (statutory safeguard included) should be read by HR/legal before activation.

## 5. Continuity across policy changes — what happens to a period that straddles an activation or a disable

**Rule: a working period is one unit and keeps the rules it started under.** A clock-in that restarts **less than the rest threshold
(8 h) after the end of an earlier session** of the same employee *inherits that session's calculation model* (a retroactive HR entry
that ends less than 8 h before a later session inherits that session's). Only a rest of 8 h or more lets the policy in force decide.
Consequences, all covered by database tests (`recovery_windows_policy.rls.test.ts`, "continuity") **and** the rule that the engine
snapshots each period's policy version and rules:

| Situation | Result |
|---|---|
| Activation day: legacy session ends 20:00, restart 02:00 on the effective date (6 h later) | Stays **legacy**; no windowed period is created; nothing can be awarded twice. |
| 7 h 59 m 59 s later / exactly 8 h later | 7:59:59 → legacy (same period). Exactly 8 h → the new policy starts. |
| Disable: windowed session on the last effective day, restart after the end date (2 h later) | Stays **windowed**: ONE period, ONE window, ONE award for the combined hours (10 h + 5 h = 15 h → 0.5 day), under the rules it started with. |
| Disable: restart 8 h or more later | A legacy session (a new period under the policy status then in force). |
| HR adds a missing session the day before activation that sits within 8 h of a windowed session | It joins that windowed period (not judged by the old rules); the period re-derives from the earliest evidence; no work is dropped. |
| Manual daily total on a date where the employee has windowed evidence (even after the policy ended) | Never creates a second legacy credit; flagged for review. |
| A session already open at the effective instant, or a windowed session still open at the end date | Keeps its model (set at clock-in); it is never switched mid-session. |

This **resolves the limitation I reported earlier** ("sessions clocked in after a deactivation date are legacy even if they continue
a windowed period"). The remaining boundary is deliberate and visible: the policy can only change *between* periods.

## 6. Who may activate and disable — and why my first design was wrong

**What I had built (and have corrected):** activation by an unscoped HR Admin only, "two global HR Admins", CEO/CTO excluded. That
was an accidental narrowing of the existing governance, and calling the grants "global" was inaccurate. The existing mechanism
(`policy_versions` RLS + `guard_policy_version_update`, `docs/03-permission-matrix.md` row "Configure leave policy") is:

| | Existing for every policy version | This release (Recovery Leave windows) |
|---|---|---|
| Who may create/edit a draft | HR Admin with `has_role('hr_admin', null, country)` — a grant with no company set; a grant limited to *that country* is enough | Same predicate |
| Who may activate | The same HR Admin, **or** the CEO/CTO under the same predicate; never the drafter. The CEO/CTO may *activate but not change* the draft | **Same people, same predicate, never the drafter.** The CEO/CTO can only activate on the effective date HR already set on the draft |
| Effective date / ending the version in force | Fixed in the draft by HR; an active version cannot be edited at all by anyone through the app | Set by HR (typed at activation, or saved on the draft for the CEO/CTO). The function also ends the version in force the day before — the one thing the app cannot do for ordinary policies — and records who/when |
| Disable | **Does not exist** (only ad-hoc SQL) | **New capability**, identified here: HR Admin or CEO/CTO (same predicate) may end the windows version on a *future* date. It cannot touch evidence or history |
| New global access | — | **None.** Operational actions (corrections, verification, alerts) keep the company-scoped checks the existing attendance code uses; only the read-only processor status needs "HR Admin or Sys Admin" in any scope |

The one code change to existing governance is a **7th replaced function**, `guard_policy_version_update`: while the controlled
activation/disable function (the only setter of a transaction-local flag) runs, the "CEO/CTO may not edit content" check is skipped,
because activation legitimately sets the date and ends the previous one. The two-person rule, `approved_by`/`approved_at` and every
other check are unchanged (verification 2.10 in the verify script proves the rule text is still there).

## 7. The 5-minute scheduler is a verified prerequisite for activation

`activate_recovery_windows_policy()` **refuses to run** unless `recovery_scheduler_ready()` is true: pg_cron installed; the
`recovery-window-processor` job scheduled, active and calling `recovery_process_due()`; and a **successful run started by that job
within the last 15 minutes** (a daily Vercel run does not count). The refusal names each missing condition. The HR Alerts page and the
policy draft page show the same verdict and the work still being finished. To satisfy it:

1. Supabase Dashboard (V2) → Database → Extensions → enable **pg_cron**.
2. Run `recovery_windows_30_enable_scheduler.sql` (schedules `recovery_process_due('pg_cron')` every 5 minutes).
3. Wait ~10 minutes; run the same file's gate query — it must say `ready = true`.

**Disabling never switches the processor off by itself.** Deactivating a policy only ends the version on a future date; periods
already running (including ones a short restart continues past the end date) must still be closed, requested and alerted. Keep the
scheduler enabled until `recovery_windowed_work_remaining()` is all zeros (open periods, open windowed sessions, unresolved failures,
unrouted requests — shown on the Alerts page). The retire step in `recovery_windows_40_disable_and_reconcile.sql` is a **guarded**
`DO` block that refuses (changing nothing) while any of that remains, or while a windows policy is still active or has a future end date.

## 8. Policies — drafting and activating

1. As an HR Admin (country grant is enough), open **Policies** → **Create Recovery Leave (windows) drafts**: the *next available*
   version (V2 untouched) as a **draft** for UAE, Saudi Arabia, Poland — exact bands, 9 h requirement, 8 h rest, 20 h alert, 24 h
   windows, 1-day cap, mode eligibility, closure rule, routes, travel review, correction rules, 180-day expiry, no cash conversion
   and the statutory-safeguard wording, generated from the machine-readable rules so wording and calculation cannot disagree.
2. Review each draft's rules table and wording.
3. A **different** HR Admin (or the CEO/CTO) opens the draft, confirms the scheduler line says "verified running", and activates with
   an effective date of tomorrow or later in that country's time zone. HR may type the date; for the CEO/CTO HR first uses "Save as
   the draft's planned date". There is no SQL shortcut: a plain status update is refused by a trigger and the functions refuse the SQL
   Editor (no signed-in user).
4. Sessions in flight and short restarts follow §5. Requests already pending under the old rule keep their original approval chain.

## 9. Verification — what each test proves (and does not)

**Database/engine (real PostgreSQL, controlled clock)** — `packages/rls-tests`: the full suite, including the Recovery windows suites
(engine, lifecycle, operations, policy/continuity/governance/scheduler-gate). Proves the calculation boundaries to the second
(13h/17h/2h/6h ±1 s, 7h59m59s vs 8h, 20 h alert, rollover, DST), request routing, corrections/top-ups/reductions, ledger posting,
RLS, and activation/disable behaviour. *Not live Supabase.*

**Browser, UI-only checks** (they prove the screens show the right things; they never create a credit) — `preview-recovery-windows-read-only`
and `-mobile`: register columns, text clock states (never colour alone), filters, "last updated"/live states, "Clocked in now" separate
from "Present", dashboard card (status text, action, no break buttons), alerts page, phone layout. `preview-recovery-windows-mutating`:
an employee clock-in/out reaching the register, HR "Add missing attendance" and a correction keeping original **and** corrected evidence —
short sessions only, so it can never earn a credit. `local-stack`: the activation form, the scheduler gate banner, the fingerprint,
the CEO-only-the-planned-date rule, and disabling deleting nothing (UI + DB state).

**Browser, END-TO-END credit proof** — `preview-recovery-windows-credit`: HR records 3 h 30 m of site work on a past rest day → ONE
request appears, routed "Project lead → HR", with the exact evidence → the lead approves (no credit yet) → HR approves → the
employee's Comp-off balance rises by exactly 0.5 → HR corrects the clock-out (6 h 30 m) → **only the +0.5 difference** is requested,
approved, posted with the original's expiry → the balance ends at exactly 1.0 (never 1.5). A second test proves the **HR verification
gate**: business-travel evidence cannot be approved by HR (button disabled, reason on screen) until HR records what was verified;
then the credit posts once. These create real, permanent credits on the dedicated Employee test account, so they carry their own
authorization (`E2E_RECOVERY_CREDIT_AUTHORIZED`) and, in the workflow, a second typed confirmation.

**Where each ran.** All of the above passed on the final commit against the **local full stack** (`packages/e2e-tests/local-stack/README.md`:
the real Next.js app, real Chromium, real Postgres + PostgREST enforcing the real RLS, a local sign-in stand-in, a stub for pg_cron).
**None has run against Vercel, hosted Supabase Auth, real pg_cron or your data.** The Preview workflow
(`e2e-preview-recovery-windows.yml`, manual only) is how you run the same specs against a Preview; its read-only job always runs, the
mutating job and the credit-proof job are separate opt-ins.

**Legacy Production specs, updated in this release.** `20-attendance.spec.ts` (typed-total credit + two approval chains) and
`25-attendance-clock.spec.ts` (overnight routing) describe the *previous* calculation. They now read the rules marker the manual tool
renders and **skip, with the reason, once the windows policy is in force**; while the previous rules apply they run exactly as before.
Their window-based replacement is `30-recovery-credit-end-to-end.spec.ts`. No Production workflow can run any recovery-windows or
local-stack spec (CI fails if a Production project matches one).

## 10. Disable / rollback

Because the migration is additive, there is nothing to roll back in the database. To stop using the window model:

1. In the app (Policies → the active windows version → "Stop using these rules"), as an HR Admin or CEO/CTO, choose the last day the
   rules apply (tomorrow or later). Clock-ins after that day return to the old rule, except a restart less than 8 h after a windowed
   session (§5). **No session, period, window, request, credit or audit row is deleted or changed**; the earlier version's wording is
   re-drafted for normal reactivation. (Emergency owner fallback, a plain `UPDATE … SET effective_to`, is in the disable script.)
2. **Keep the 5-minute processor running** until `recovery_windowed_work_remaining()` is all zeros. Then, and only then, run the guarded
   retire block in `recovery_windows_40_disable_and_reconcile.sql` (and remove the `vercel.json` cron in a normal change if wanted).
3. **Reconcile** with the read-only queries in the same file (periods/windows by state, requests by type, credits posted with source
   `recovery_window*`, sessions still running under the model, alerts, processor failures). Decide pending requests in the app as
   normal; reverse any credit that should not stand through HR's normal process.

## 11. Preserving old policies, pending requests and balances

The migration only adds objects and replaces seven function bodies (each unchanged for legacy rows). It writes no policy, rewrites no
session/request/ledger row and starts nothing. Prove it: run `recovery_windows_50_preservation_snapshot_readonly.sql` before and after
with the **same cut-off**; every `row_count`/`fingerprint` must match (policy versions, pending requests, balances, role grants,
routing). The only expected difference after a later activation is the previous version's `effective_to` (the day before). Requests
pending at activation keep their original approval chain.

## 12. The deployment checklist (short) and the exact SQL files

1. **Confirm V2 binding** (§3): Vercel and GitHub settings point at *Enginious HR Engine_V2*; no credential is needed for this check.
2. SQL Editor (V2) — `supabase/manual-sql/recovery_windows_50_preservation_snapshot_readonly.sql` (set the cut-off; save the output),
   then `supabase/manual-sql/recovery_windows_00_preflight_readonly.sql`. Read-only.
3. SQL Editor (V2) — run **once, as one script**: `supabase/migrations/20261108000000_recovery_windows_attendance_redesign.sql`
   (single `begin; … commit;` — all or nothing; on error run `rollback;` and report it).
4. SQL Editor (V2) — `supabase/manual-sql/recovery_windows_20_post_migration_verify_readonly.sql` (expect 8 tables with RLS, no write
   grants, processor not callable by signed-in roles, all zeros, 7 functions, `scheduler_ready = false` for now) and the snapshot again
   with the same cut-off (must match). **Note the fingerprint (2.0).**
5. Merge and deploy the PR when satisfied (database before app, never the reverse). Open **Alerts** as HR Admin: the fingerprint
   must match step 4.
6. Enable pg_cron in V2, run `supabase/manual-sql/recovery_windows_30_enable_scheduler.sql`, wait ~10 minutes, and confirm
   `recovery_scheduler_ready()` is `true` (also visible on Alerts). **Activation is refused until it is.**
7. HR Admin A: Policies → *Create Recovery Leave (windows) drafts*. Review rules and wording (HR/legal sign-off).
8. HR Admin B (or the CEO/CTO) activates each country with an effective date of tomorrow or later (HR may save a planned date first
   for the CEO/CTO). Nothing is activated automatically.
9. Run the Preview workflow's read-only job, then (opt-in) the mutating job, then (opt-in, after one rest day has passed since the
   effective date) the credit-proof job. Work through `docs/recovery-windows-staff-test-checklist.md`. Never auto-rerun a failed
   mutating test.
10. To switch off: §10 — end the policy on a future date; keep the scheduler until the work remaining is zero; then retire it with the
    guarded block in `recovery_windows_40_disable_and_reconcile.sql`.

## 13. Known limits (stated, not hidden)

- Alerts are **in-app only** (no email or push).
- The Hobby-plan Vercel cron is daily only; sub-daily processing needs pg_cron (verified before activation).
- Register presence and dashboard figures between background runs are computed live from the evidence, so they are right to the second;
  requests, alerts and window closure follow the processor cadence.
- Closing a window by 24 elapsed hours while someone is still clocked in creates its request at the next processor run (or the next
  clock event for that employee), not at the exact second.
- Corrections that would restructure a working period that already has an approved credit are **refused** (nothing changes); adjust the
  evidence so the period start does not move, or review the credit separately.
- A manual daily total can never prove gaps or windows, so under the new policy it never creates a credit; it is flagged for review and
  HR records exact times with "Add missing attendance" instead.
- Business-travel working-time policy is left to HR verification (§4.3). The staff workbook update is pending (§4.4).
