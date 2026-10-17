# Scheduled routes: diagnosis, evidence and owner runbook

Status: **diagnosis plus a proposed fix that is switched OFF by default.** Merging and deploying this change alters nothing in
Production. It does not dispatch, replay or unblock any job. The owner turns the fix on deliberately, after reading this page.

Files in this change:

| File | What it is |
|---|---|
| `apps/web/src/proxy.ts` | One added condition: skip the sign-in redirect for an allowlisted scheduled path only when `ALLOW_SCHEDULED_ROUTES_WITHOUT_SESSION` is exactly `on`. |
| `apps/web/src/lib/cron/scheduled-routes.ts` | The single exported allowlist (`SCHEDULED_ROUTE_PATHS`), the flag name, and two tiny helpers. |
| `apps/web/src/proxy-scheduled-routes.test.ts` | Runs the real `proxy()` with a mocked `@supabase/ssr`; also pins the allowlist to `vercel.json`. |
| `supabase/manual-sql/scheduled_routes_00_hosted_outcomes_readonly.sql` | One read-only SELECT the owner runs in the Supabase SQL Editor. |
| `docs/scheduled-routes-diagnosis.md` | This page. |

## 1. The defect

`apps/web/src/proxy.ts` (the Next.js 16 request proxy) redirects every request that has no Supabase session user to
`/login?next=...`, except `/login`, `/set-password`, `/forgot-password`, `/reset-password`. Its matcher excludes only static
assets, **not** `/api/*`. Vercel Cron calls the scheduled routes with `Authorization: Bearer $CRON_SECRET` and no cookie, so
`supabase.auth.getUser()` returns no user and the proxy answers **307 -> /login** before the route handler, and therefore its own
`CRON_SECRET` check, runs. Consequence if this is what happens in Production: none of the five scheduled jobs has ever run there.

Evidence, and its limits (section 8 lists what is not proven):

* Read from code: `proxy.ts` lines for `isPublicPath` and the redirect, and `config.matcher`.
* Demonstrated in a unit test: with the flag unset, `proxy()` returns 307 to `/login` for a cookie-less, Bearer-carrying request to each
  of the five paths (`proxy-scheduled-routes.test.ts`, "flag unset (the default)"). The Supabase client is mocked to return no user.
* Reported by the person who raised it, not reproduced by me: a local `curl -H "Authorization: Bearer local" .../api/cron/leave-accrual`
  returned `307 -> /login?next=...`.
* Not observable from here: Vercel's logs for these paths, and the hosted database.

## 2. Inventory, one section per scheduled route

All five handlers export **GET only** (no POST/PUT/DELETE: Next answers any other method with 405). In every handler the first
statement is `if (!isAuthorizedCronRequest(request)) return 401`, executed before the admin (service-role) client is even created.
That was checked by reading each file, not assumed.

`isAuthorizedCronRequest` (`apps/web/src/lib/cron/auth.ts`) fails closed: it returns false when `CRON_SECRET` is unset or empty, when the
header is missing, or when the header is not exactly `Bearer <CRON_SECRET>`; the comparison is constant-time (`timingSafeEqual`).

**Auth finding: no scheduled route has a missing or weak secret check. All five reject a request lacking the secret with 401 before doing
any work.** Nothing was left out of the allowlist for that reason. Residual caveat: the gate is only as strong as the secret itself
(`.env.example` shows a placeholder sentence; the owner should confirm the Production value is a long random string).

Summary:

| # | Route (file) | vercel.json schedule (UTC) | Auth, before any work | Idempotent | Missed-run catch-up |
|---|---|---|---|---|---|
| 1 | `/api/cron/leave-accrual` (`apps/web/src/app/api/cron/leave-accrual/route.ts`) | `0 0 1 * *` (1st of month) | 401 yes | yes, per employee/type/month | `monthly_accrual` types: **no**, current month only. `per_service_year` / `annual_grant` (Annual Leave AE/SA/PL): **yes, all at once** |
| 2 | `/api/cron/comp-day-expiry` (`.../cron/comp-day-expiry/route.ts`) | `0 1 * * *` | 401 yes | yes, one row per earned entry ever | **yes, fully** (stateless, re-derived from whole ledger) |
| 3 | `/api/cron/document-expiry` (`.../cron/document-expiry/route.ts`) | `0 2 * * *` | 401 yes | yes for reminders (unique key); status moves are naturally idempotent | **yes, but as a burst**: every reminder window already crossed fires at once |
| 4 | `/api/ai/detect-balance-discrepancies` (`.../api/ai/detect-balance-discrepancies/route.ts`) | `0 3 * * *` | 401 yes | mostly (see below) | not applicable, stateless: looks at balances as they are today |
| 5 | `/api/cron/recovery-windows` (`.../cron/recovery-windows/route.ts`) | `30 0 * * *` (daily safety net) | 401 yes | yes, enforced in the database | **yes**, `recovery_process_due()` derives every boundary passed since the last run |

### 2.1 `/api/cron/leave-accrual`

* **Reads:** `policy_versions` (active `leave_rules` in force), `policy_leave_types`, `employees` (active, not deleted),
  `employment_contracts` (FTE history), `leave_ledger` (this month's `policy_run` accruals, and the full history of the Annual Leave type
  codes), `leave_balances`.
* **Writes:** only `leave_ledger` rows: `entry_type = 'accrual'`, `reference_type = 'policy_run'`, `created_by =
  00000000-0000-0000-0000-000000000000`, `idempotency_key = accrual:<employee>:<leave_type>:<YYYY-MM>`. Upserted in chunks of 500 with
  `ignoreDuplicates`. No notifications, no emails, no AI drafts.
* **Preflight:** `?mode=preflight` (after the secret check) runs the whole computation and returns before any insert: counts of what would
  post and be skipped, plus every ambiguous baseline. It is the only route with a read-only mode.
* **Idempotency:** the database column `leave_ledger.idempotency_key text unique` (migration
  `20261013000000_ledger_cron_idempotency_keys.sql`; `schema/schema.sql` `create table leave_ledger`) rejects a second row for the same
  employee/type/month, so a retried or overlapping invocation cannot double-post. The route also skips a pair that already has a
  `policy_run` accrual in the employee's own business-local month (cheap sequential-case check).
* **Catch-up on a missed run:**
  * `accrual_method = 'monthly_accrual'`: each run computes one fixed `accrual_rate_per_period` for the **current** month key only
    (capped at `max_balance_days`). A month with no run is **never repaired**; the next run does not add the missing months.
  * `per_service_year` (UAE, Saudi) and `annual_grant` (Poland), i.e. Annual Leave: each run computes the cumulative entitlement as of today
    (`computeAnnualLeaveEntitlementToDate`), subtracts every historical grant it can identify unambiguously (accruals, carryovers,
    `opening_balance` and `termination_settlement` adjustments, with reversals netted; see `classifyLedgerRows`) and posts the positive
    difference, capped at `max_balance_days`. A long gap is therefore repaired **in one posting**, dated the run date, not spread across the
    months it covers.
  * Employees with any untagged `adjustment` row for that type are skipped and reported (`ambiguousBaselines`); Poland employees whose FTE
    history is unusable are skipped and reported (`blockedEntitlementConfig`).
* **Retry:** none in the application. A 500 (some chunk failed) leaves those rows unposted; re-running the same month is safe.
* **First run after the block is lifted (be cautious):**
  * It fires at the next `00:00 UTC` on the 1st of a month after the flag is on, i.e. up to a month later, unless someone calls it by hand.
  * `monthly_accrual` leave types: one month's rate per active employee per type, nothing for the months already missed. Bounded and small.
  * **Annual Leave: the whole shortfall since hire, or since the opening balance, in one posting per employee.** If opening balances were
    typed in as "what the employee has left" rather than "entitlement to date", the delta equals lifetime entitlement minus that figure,
    limited only by `max_balance_days`. This is the one that needs a deliberate decision first. Use `?mode=preflight` (read-only, needs the
    secret) to see `wouldPost` and `skipped`; the ledger is append-only, so a wrong posting can only be corrected by adjusting entries.
  * Nothing is emailed or notified. Rows appear in every affected employee's ledger and balance at once.

### 2.2 `/api/cron/comp-day-expiry`

* **Reads:** `employees` (country), the whole `comp_day_ledger`.
* **Writes:** `comp_day_ledger` rows `entry_type = 'expired'`, `reference_type = 'comp_day_expiry_sweep'`, `created_by` the system actor,
  `idempotency_key = expiry:<earned entry id>`, `txn_date` = the employee's business-local date today. No notifications or emails.
* **Idempotency:** stateless re-derivation (`computeCompDayExpiry`, `packages/domain/src/compDayExpiry.ts`): earned entries are consumed
  first-in-first-out by `expiry_date`, the run's own earlier `expired` postings count as consumption, so a re-run posts nothing more for an
  entry already accounted for. Races are closed by `comp_day_ledger.idempotency_key text unique` (same migration as above): at most one
  `expired` row per earned entry, ever.
* **Catch-up:** complete. Any run, however late, expires every earned entry whose `expiry_date <= today` and is not already consumed.
  What a gap costs is that balances stayed overstated meanwhile, and the postings are dated the run date, not the expiry date.
* **Retry:** none; a 500 means a chunk failed, re-running is safe.
* **First run:** every already-expired, unconsumed earned entry in the company is expired in one go (one ledger row each). Employees see
  their comp-day / Recovery Leave balance drop at once. No message goes out. SQL section D, row "WOULD POST NOW", sizes this exactly:
  postings, employees, days and the oldest `expiry_date`.

### 2.3 `/api/cron/document-expiry`

* **Reads:** `employee_documents` (with an expiry date, not deleted), `employees`, `document_expiry_reminder_rules`,
  `document_expiry_reminders_sent`, `user_roles` (HR Admins).
* **Writes:** `employee_documents.status` (`valid` -> `expiring_soon` -> `expired`); `document_expiry_reminders_sent` rows; `notifications`
  rows of `type = 'document_expiring'` for the employee and for every active `hr_admin` in scope. **No email is sent by this route**, although
  `docs/05-automation-rules.md` §5.1 says "notification + email": the code inserts in-app notifications only.
* **Idempotency:** `document_expiry_reminders_sent` has `unique (employee_document_id, lead_days)` (`schema/schema.sql`; migration
  `20260928000000_phase5_...`). The route inserts that row before the notifications and skips a pair already recorded. Status updates
  only run when the computed status differs. Two overlapping runs make the loser's insert fail, which is reported as a failure (500) but writes nothing twice.
* **Weakness worth knowing:** the reminder row is recorded before the notification. If a notification insert fails, the pair is
  already marked sent and is **never retried**. SQL section E row 3 counts reminders with no matching notification.
* **Catch-up:** stateless against today's date. A document already inside several lead windows gets **one reminder per crossed window at
  once** (for example rules 60/30/7 and 10 days left: the 60 and 30 reminders both fire now), not only the nearest. Documents already past
  expiry get their status set to `expired` and no reminder.
* **Retry:** none; next day's run retries only what is not yet recorded.
* **First run:** a burst of status changes and in-app notifications: reminders x (employee + every HR Admin in scope). SQL section E rows
  "WOULD CHANGE NOW" and "WOULD SEND NOW" size it. No email.

### 2.4 `/api/ai/detect-balance-discrepancies`

* **Reads:** `leave_balances` where `balance_days < 0`, and `ai_drafts` (existing drafts).
* **Writes:** only `ai_drafts` (`created_by_agent = 'balance-discrepancy-detector'`, `proposed_action = 'adjust_balance'`). It has no path to
  any ledger; a human must authorize a draft through the normal action. No notifications or emails.
* **Idempotency:** application check only, no unique constraint: skip when an open draft (`status = 'draft'`) for the same employee and
  leave type exists. Two gaps: (a) once a draft is authorized, rejected or discarded, a still-negative balance gets a **new draft on the next
  run**, every night; (b) the lookup uses `.maybeSingle()`, which errors when two or more drafts already match, and the code ignores that error,
  so it would insert another. SQL section F row 32 counts case (b).
* **Catch-up:** none needed; it reflects balances as of the run.
* **First run:** one draft per currently negative balance that has no open draft. SQL section F rows 30 and 31 give the count. Drafts only.

### 2.5 `/api/cron/recovery-windows`

* **Reads/writes:** all work is the database function `recovery_process_due('vercel_cron')` (migration
  `20261108000000_recovery_windows_attendance_redesign.sql`): recalculates employees with an open working period, creates approval requests and
  HR alerts, retries earlier failures, and records each run in `recovery_processor_runs` and each failure in `recovery_processor_failures`.
  Audit rows carry `origin = 'processor'`.
* **Idempotency:** a transaction-level advisory lock (a second concurrent run returns `skipped_already_running`), derivation of every
  boundary from the evidence, `recovery_alerts.dedup_key unique`, `unique (period_id, window_index)` on windows.
* **Catch-up:** yes; the function header says a delayed or repeated run only finishes unfinished work, deriving every 24-hour boundary
  passed since the last run.
* **Role:** this route is only the **daily safety net**. The primary trigger is pg_cron every 5 minutes (owner-enabled; see
  `docs/recovery-windows-deployment.md` §7 and `supabase/manual-sql/recovery_windows_30_enable_scheduler.sql`). `recovery_scheduler_ready()`
  counts only runs with `origin = 'pg_cron'`, so this route never substitutes for pg_cron.
* **Retry:** failed employees are recorded and retried by the next run.
* **First run:** the function only visits employees with an open recovery period, an open failure, or a request waiting on routing. Until a
  `recovery_windows` policy has been activated there are none and it examines 0 employees. Activation itself requires the pg_cron scheduler to
  be verified, so in practice pg_cron has been doing this work already. This is the lowest-risk route to unblock.

## 3. Behaviour of the proposed fix

* Default (variable unset or any value other than exactly `on`): `proxy()` behaves exactly as before. The only code that runs additionally is
  one boolean computation that is false, so the redirect condition is unchanged.
* With `ALLOW_SCHEDULED_ROUTES_WITHOUT_SESSION=on`: a request with no session whose pathname is **exactly** one of the five paths passes
  through to the route. Everything else still redirects: any other `/api/*`, `/api/cron/leave-accrual-evil`, `/api/cron/leave-accrual/extra`,
  a trailing slash, different case, `/api/cron/leave-accrual/../x` (normalised by the URL parser to `/api/cron/x`), encoded variants, and
  every application page. `true`, `1`, `ON`, `On`, ` on` and the empty string do not enable it.
* The route's `CRON_SECRET` check remains the real gate. The exemption only lets a request reach it. With the flag on, anyone on the
  internet can reach those five URLs and will get 401 without the secret.
* A test fails if `SCHEDULED_ROUTE_PATHS` and the `crons` in `vercel.json` ever differ.
* Unrelated observation, not changed: `PUBLIC_PATHS` is matched with `startsWith`, so any path beginning `/login` etc. is public.

**The flag is all-or-nothing.** Once on, Vercel Cron's next invocations of all five routes reach their handlers. There is no per-route switch.
To keep one route off, remove its entry from `vercel.json` (and from `SCHEDULED_ROUTE_PATHS`, since the test pins them together) in a separate
change before flipping the flag.

When each route would first fire after the flag is on and the app is redeployed (UTC; on Vercel's Hobby plan a daily cron fires somewhere within
its scheduled hour): recovery 00:30, comp-day expiry 01:00, document expiry 02:00, balance detector 03:00, all within about a day; leave accrual
on the next 1st of a month at 00:00. **No human has to do anything for these to run, so every decision in section 7 must be made before the flag is set.**

## 4. What is and is not proven

Proven here:

* The proxy code path: a unit test of the real `proxy()` (mocked `@supabase/ssr`) shows that, with the flag unset, a cookie-less request to each
  scheduled path gets 307 to `/login`; with the flag exactly `on`, only the five exact paths pass; the negative cases above redirect.
* Each handler's auth check order, by reading the code; every handler is GET-only.
* Every query in the SQL file executes without error against a database built from `supabase/migrations/` (Postgres 16, stubbed auth and
  storage schemas), both empty and with synthetic rows, and inside a `BEGIN READ ONLY` transaction.

Not proven, and I cannot see from here:

* Hosted Vercel logs: what status Vercel Cron actually received. The 307 is inferred from code and the local curl someone reported.
* The hosted database: whether any job ever wrote anything. That is what the SQL file answers.
* Whether `CRON_SECRET` is set in Vercel Production, and that its value is strong.
* How Vercel behaves in detail: that crons run only on Production deployments, send GET with `Authorization: Bearer $CRON_SECRET`, do not retry a
  failed invocation, can occasionally deliver the same event twice, and fire a daily cron anywhere in its hour on Hobby. This is from Vercel's
  documentation as I know it, not verified here; please confirm in the dashboard. (The idempotency analysis above does not depend on it.)
* Function timeouts on real data volumes (the accrual and document routes loop over everything).
* The numbers of employees, documents, balances, i.e. the actual size of any first run.

The owner must check: the Vercel items in SQL section H and the SQL results (runbook step a).

## 5. How to read the SQL result

Run `supabase/manual-sql/scheduled_routes_00_hosted_outcomes_readonly.sql` in the SQL Editor of the hosted project. One result table,
sections A to H. The decisive rows:

| Question | Where | A "never ran" answer looks like |
|---|---|---|
| Has the accrual cron ever posted? Which months are missing? | C rows 1, 4 and the per-month rows | `0 rows ... never`; every month since the first ledger row listed as missing |
| Has comp-day expiry ever posted? What would it expire now? | D rows 1 and 51 | `0 rows`; a non-zero "WOULD POST NOW" with an old oldest-expiry date |
| Have document reminders ever gone out? What would burst? | E rows 1, 2, 20+, 30 | `0 rows`; non-zero "WOULD SEND NOW" |
| Has the detector ever drafted? Negative balances waiting? | F rows 1, 30, 31 | `0 drafts`; non-zero negative pairs |
| Is anything running recovery processing, and from where? | G runs by origin; pg_cron job and run rows | no `vercel_cron` rows. `pg_cron` rows present means the database scheduler is working |

An important cross-check: if the hosted database shows `policy_run` rows, `expired` sweep rows, `document_expiring` notifications or
detector drafts with recent dates, then the routes **are** being reached and my diagnosis is wrong for Production (for example the hosted
proxy differs from this code); tell me before changing anything.

## Owner runbook

**(a) Gather evidence first. Change nothing yet.**

1. Run the read-only SQL file in the Supabase SQL Editor of the hosted project and send the full result (export CSV or screenshot).
2. In the Vercel dashboard (Production): Settings -> Cron Jobs (are the five listed and enabled?) and the cron/runtime logs for the five paths
   (what status did recent invocations return: 307, 401 or 200? and the 1st of last month at 00:00 UTC for accrual); Settings -> Environment
   Variables (is `CRON_SECRET` set for Production, with a long random value; is `ALLOW_SCHEDULED_ROUTES_WITHOUT_SESSION` **not** set);
   Settings -> General for the plan. Send names and "set / not set" only, never secret values.

**(b) Decide, per route, whether it should start running.** Because the flag is all-or-nothing, a route you do not want must be removed from
`vercel.json` (and the allowlist) first, in a separate change.

| Route | Safe to start as is? | Decision needed first |
|---|---|---|
| `recovery-windows` | Yes. Does nothing until a windows policy is active; idempotent; pg_cron remains primary. | Only confirm pg_cron is the primary and healthy (SQL section G). |
| `detect-balance-discrepancies` | Yes in effect: writes drafts only, never the ledger. | Accept one draft per currently negative balance, and the nightly re-draft after a draft is authorized/rejected while the balance is still negative. Fix negative balances first if the count is large (SQL F). |
| `document-expiry` | Idempotent, but the first run is a burst. | Accept the burst of status changes and in-app notifications to employees and every HR Admin (SQL E "WOULD SEND NOW"), or first load/adjust `document_expiry_reminder_rules`. No emails. |
| `comp-day-expiry` | Idempotent and fully catches up, so the first run expires the entire expired backlog at once. | Review SQL D "WOULD POST NOW"; confirm HR is comfortable with those balance reductions being dated the run date. |
| `leave-accrual` | **Not without a decision.** Monthly types never backfill; Annual Leave posts the whole shortfall in one go. | Decide how opening balances were entered; get HR to review the `?mode=preflight` result (see below) before the first 1st of the month after the flag is on. Decide whether the missed months (SQL C row 4) should be backfilled by a separate, reviewed step. This change does not do that. |

For the accrual preflight: it needs the real `CRON_SECRET`, is read-only, and is only reachable once the flag is on. Because turning the flag on
also schedules every route, either run it from a Preview deployment you control (cron does not run on Previews) with the flag on and the
same Supabase variables, or run the app locally against that database. Choose where deliberately; do not paste the secret anywhere shared.

**(c) Only then set the variable.** In Vercel -> Settings -> Environment Variables, add `ALLOW_SCHEDULED_ROUTES_WITHOUT_SESSION` with the
exact value `on` for Production, then redeploy Production (environment changes apply to new deployments). Do this at a time when you can
watch the first runs (section 3 gives the clock times).

**(d) Observe the first run.** In Vercel's cron/runtime logs, each path should now show 200 (or 500 with a `failures` array in the body,
which Vercel records), not 307. Re-run the SQL file after each run: C, D, E, F and G show new rows with the new timestamps; section G should
show `vercel_cron` runs. Compare the counts with the "WOULD ... NOW" estimates you recorded in step (a).

**(e) Switch it off.** Unset (delete) `ALLOW_SCHEDULED_ROUTES_WITHOUT_SESSION` in Vercel and redeploy. The proxy returns to today's
behaviour and the routes are unreachable by cron again. Rows already written are not undone: the ledgers are append-only, and correcting
them needs adjusting entries made by a person.

**(f) Explicit statements.**

* Nothing in this change dispatches, replays or unblocks any Production job. Deploying it with the variable unset changes no behaviour.
* Nothing here calls a hosted URL or runs SQL against any hosted database.
* **Do not call these routes by hand to "catch up".** In particular `/api/cron/leave-accrual` without `?mode=preflight` writes real ledger
  rows for every employee, and the other four also write for real (there is no dry-run mode on them). Read the catch-up analysis in
  section 2 first, and make the decisions in step (b).
