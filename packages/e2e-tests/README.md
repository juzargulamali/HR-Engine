# @enginious-hr/e2e-tests

Playwright end-to-end suite that runs directly against the live
**Production** deployment, using dedicated, fixed test accounts only. There
is no staging/local target for this suite. Designed to run on a normal
GitHub Actions runner (real, unmodified TLS/certificate verification, direct
network egress) — see `.github/workflows/e2e-production-qa-readonly.yml`
and `.github/workflows/e2e-production-qa-mutating.yml`.

## Safety model — read this before running anything

- **No Supabase service-role key, and no direct database client, anywhere
  in this package.** `package.json` has no `@supabase/supabase-js`
  dependency at all — this isn't just a rule, it's structurally true.
  Every mutation this suite makes goes through the real browser UI, using a
  dedicated test account's own permissions. Baseline capture and the final
  reconciliation report (`src/baseline.ts`) are also done through
  authenticated UI reads, never a raw database read.
- **`E2E_BASE_URL` must be set explicitly.** The suite never guesses or
  defaults to a domain.
- **Required role credentials must be set** (Employee, Manager, HR Admin,
  CEO). The suite refuses to start at all if any are missing. Finance and
  Sys Admin are optional — specs needing them skip cleanly if their
  `E2E_*_EMAIL`/`_PASSWORD` are unset. The account-status
  (deactivate/reactivate) spec specifically requires Sys Admin and never
  substitutes another role for it.
- **`E2E_MUTATION_AUTHORIZED` gates every mutating spec.** Unless it is
  exactly `"true"`, every spec that creates/modifies a real record skips
  itself. Read-only specs run regardless. This name is deliberate: it is a
  per-run authorization that mutation on the dedicated test accounts is
  approved, **not** a claim that a Supabase backup exists — this suite
  never asserts that, and some of what it allows is not reversible via the
  UI at all (see "What is and isn't reversible" below).
- **Zero retries on the `mutating` project, explicitly** (see
  `playwright.config.ts`). A Playwright retry re-runs a test from scratch,
  including every action already taken — a leave/reimbursement submission
  or approval that times out mid-request must fail cleanly, never be
  blindly repeated against Production. Every read-only project (`setup`,
  `baseline`, `read-only`, `mobile-smoke`, `reconciliation`) keeps one
  retry for resilience against a one-off network hiccup.
- **Emergency stops, enforced in code** (`src/emergencyStop.ts`): a mutating
  spec refuses to act on any account that isn't one of this run's
  configured `E2E_*` test accounts, and refuses to mutate any pre-existing
  record that doesn't already carry the current run's tag.
- **Dates are chosen against the app's actual working-day rules, not
  guessed.** See `src/recordTag.ts`'s doc comment: leave submission rejects
  a date range with no working day, and attendance's
  `record_attendance_and_recovery()` automatically creates a Recovery Leave
  credit whenever a `present` day falls on a recovery day (weekend/holiday)
  for that employee's country — there is no separate UI control for it.
  `testWorkday()`/`testWeekendDay()` pick fixed-weekday synthetic 2099+
  dates that are correct under every seeded country's weekend pattern,
  rather than an arbitrary date that might silently land on the wrong day.
- **Attendance mutations target the Employee test account's own row,
  resolved from a stable identifier.** `src/identity.ts`'s
  `getEmployeeNameByAuthEmail()` looks up the display name from the
  account's auth email (globally unique) via HR Admin's Users & Roles list
  — never a self-reported name and never `employees.personal_email` (a
  separate, nullable contact field with no guaranteed relationship to the
  login email). It throws unless that email resolves to exactly one row.
  `AttendancePage`'s mutating methods then independently refuse to
  select/fill/save unless that name resolves to exactly one row on the
  attendance register too (two employees could share a display name even
  with different emails) — never "whichever row renders first", which
  lists every active employee in HR Admin's company, real employees
  included.
- **Never activates, publishes, or deletes a policy.** `PoliciesPage.ts` has
  no method that clicks "Activate"/"Delete" — enforced by code review of
  that file, not a runtime guard.
- **Never finalizes payroll.** `PayrollPage.ts` only checks which controls
  render; nothing in this suite ever clicks export/generate/run/lock.
- **Never sends a real password-reset email.** The forgot-password spec
  only ever submits definitely-nonexistent addresses.
- **Never touches a real employee or the System Administrator account.**
  Every mutating action targets one of the fixed `E2E_*` test accounts by
  email (or, for attendance, by a display name resolved FROM that email —
  see above), checked against `src/emergencyStop.ts` before acting.
- **Every record this suite creates is tagged** with the current run's ID
  (`E2E-YYYYMMDD-HHMMSS`, see `src/recordTag.ts`), embedded in whatever
  free-text field the record has (a leave reason, a reimbursement
  description); for tables with no free-text field (attendance,
  recovery-credit), identity comes from a synthetic date in the year 2099+,
  deterministically derived from the run ID, so no real attendance day is
  ever touched.
- **Credentials are never logged, printed, or written to a report/trace
  file.** They live only in environment secrets and are read once per
  process via `process.env`.

## What is and isn't reversible

Some mutations this suite makes have no safe "undo" via the app's own UI —
that is reported, never hidden. See `tests/reconcile/verify.reconcile.ts`
and the reconciliation report it produces (`test-results/reconciliation/
<runId>.md`, and posted to the GitHub Actions job summary). The report
correlates a balance change with the SPECIFIC approved request that caused
it and its exact expected day count (via an expectations file
`10-leave.spec.ts` writes) — tagged text being visible somewhere is not,
by itself, treated as sufficient evidence that it explains a particular
number:

- An **approved** leave request permanently changes the Employee test
  account's leave balance. There is no "un-approve" — this is reported as
  an expected, quantified, permanent change if the numeric delta matches
  what was requested, or as an unexplained problem if it doesn't. If you
  want the balance restored, the exact record (identified by its
  `[<runId>] annual-leave-approve...` tagged reason) needs to be reversed
  directly in Supabase.
- An **approved or rejected** reimbursement claim is a real, permanent
  record. It is never progressed past that state — no export, payment, or
  accounting integration is triggered — but it isn't deleted either. If you
  want it removed rather than left as identified test data, delete the
  specific tagged row(s) directly in Supabase.
- Attendance/recovery-credit rows on the synthetic 2099+ test dates are
  left in place — there's no delete UI for them, and there's no real day
  for them to collide with. The reconciliation report lists both dates and
  what the UI shows on them, before and after.
- Deactivation of the Employee test account is always attempted to be fully
  reversed by this suite itself, in the same test, before it ends (see
  `50-account-status.spec.ts`'s recovery structure) — if that automated
  reactivation itself fails, the test fails loudly with exact manual
  recovery steps rather than silently leaving the account deactivated.

## Run IDs

Every invocation gets a run ID of the form `E2E-YYYYMMDD-HHMMSS` (UTC),
generated once (`src/config.ts`'s `generateRunId()`), or set explicitly via
`E2E_RUN_ID`. The mutating GitHub Actions workflow computes ONE run ID in
its `guard` job and passes it to every subsequent job (baseline, read-only,
mutating, reconciliation — each a separate `playwright test` process
invocation), so they all tag the same run and the reconciliation step
compares against the right baseline.

## Read-only vs. mutating

Read-only and mutating specs live in separate directories
(`tests/read-only/`, `tests/mutating/`), which are separate Playwright
**projects** (see `playwright.config.ts`), not just a grep tag — the
mutating project is never included when only `--project=read-only` is
requested. Every mutating describe block also calls
`test.skip(!isMutationAuthorized(), ...)` as a second, independent gate.
Filenames under `tests/mutating/` carry a numeric prefix
(`10-leave`, `20-attendance`, `30-reimbursements`, `40-document-upload`,
`50-account-status`, `60-audit-verification`) that fixes their execution
order under this suite's `workers: 1` / `fullyParallel: false` config —
account-status runs deliberately last (nothing after it mutates anything),
since deactivating the Employee test account could otherwise disrupt any
later mutating test that depends on that account's session.

There are also two extra projects, `baseline` and `reconciliation`
(`tests/baseline/`, `tests/reconcile/`), which capture and compare the
Employee test account's status/leave-balance/reimbursement/attendance state
via the same authenticated UI reads the functional specs use — never a
service-role key.

## Running

```bash
npm install --workspace @enginious-hr/e2e-tests

# Safe to run any time:
npm run test:e2e:baseline    # capture pre-run state
npm run test:e2e:read-only   # read-only + mobile-smoke projects

# Only after E2E_MUTATION_AUTHORIZED=true and a baseline has been captured:
npm run test:e2e:mutating
npm run test:e2e:reconcile   # always run this after mutating, even if it failed
```

The two GitHub Actions workflows drive this in the right order for CI —
see their own comments for the exact job sequence and gating:

- `.github/workflows/e2e-production-qa-readonly.yml` — read-only only,
  triggerable by a PR touching this package or by manual dispatch.
- `.github/workflows/e2e-production-qa-mutating.yml` — **manual dispatch
  only**, requires typing `RUN_PRODUCTION_E2E` exactly and choosing
  `mutation_authorized: true`, or the job fails immediately before any
  secret is read or browser launched. Runs baseline → read-only (must
  pass) → mutating (a failed mutating test fails the job/workflow, always)
  → reconciliation (always runs regardless, and fails the workflow if
  account status or leave balances differ from baseline in a way that
  doesn't match what this run's own mutations expected).

## Evidence policy

`trace.zip`, `.auth/` (storageState), and the HTML reporter (which embeds
full trace data, including live session cookies) are **never** uploaded as
CI artifacts — both workflows only upload JUnit XML, screenshots, videos,
and error-context.md files with test-account emails redacted
(`scripts/redact-error-context.ts`), all with 14-day retention.

## Selector confidence

Page objects verified directly against real component source this round:
`LoginPage`, `Nav`/RBAC route table, `AttendancePage`, `LeavePage` +
`ApprovalsPage`, `PoliciesPage`, `ReimbursementsPage` (against
`new-claim-form.tsx`/`[id]/add-line-form.tsx`/`[id]/claim-actions.tsx`),
the account-menu/sign-out selector in `tests/read-only/auth.spec.ts`
(grounded in `user-menu.tsx`'s known lucide-react icon class, not guessed),
`src/identity.ts`'s email-to-name lookup (grounded in `admin/users/page.tsx`'s
actual table columns), and the automatic Recovery Leave trigger and its
verification in `20-attendance.spec.ts` (grounded in
`record_attendance_and_recovery()`'s actual SQL and
`bulk-attendance-form.tsx`'s save-result message — not a guessed UI control,
and not the Approvals page, which a direct read of
`apps/web/src/app/(app)/approvals/page.tsx` shows never renders
`recovery_credit` approvals at all, despite fetching them). Best-effort,
kept generic (text/role-based rather than DOM-structure-based) so a first
live run mostly needs small text tweaks: `EmployeesPage`, `HolidaysPage`,
`AuditLogPage`, `PayrollPage`, `DashboardPage`.

## Known application gap found while building this suite

Reading `apps/web/src/app/(app)/approvals/page.tsx` directly: its query
fetches every pending `approvals` row for the signed-in approver regardless
of `entity_type`, but the page only ever builds a display section for
`leave_request`, `reimbursement_claim`, `timesheet`, `generated_letter`, and
`payroll_export_run`. A `recovery_credit` approval (created automatically by
`record_attendance_and_recovery()`) is fetched but never rendered anywhere
on that page — not even counted toward whether the page shows its "nothing
waiting on you" empty state. This suite works around it by verifying the
attendance page's own save-result message instead (see
`20-attendance.spec.ts`), but a manager currently has no UI-visible way to
actually approve or reject a Recovery Leave credit request. This looks like
a real application gap, not a test-design issue, and is worth a look outside
this suite.

## What this suite has NOT verified

- Whether Annual Leave approval is a single manager step or manager + a
  separate HR stage.
- Exact per-country leave balance arithmetic beyond "a 2-day request
  deducts 2 days" (covered more precisely by `packages/domain`'s own unit
  tests).
- Genuine cross-company/cross-tenant data isolation — the configured test
  accounts all belong to one company (see
  `tests/read-only/isolation.spec.ts`'s doc comment).
- Which of the three seeded countries (UAE, Saudi Arabia, Poland) the
  Employee test account actually belongs to — every date this suite uses
  is chosen to be correct under any of them rather than assuming one (see
  `src/recordTag.ts`).
