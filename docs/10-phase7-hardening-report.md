# Phase 7 — Hardening report

Scope per [`06-implementation-phases.md`](./06-implementation-phases.md)'s Phase 7 section. This
report separates what was actually verified/fixed in this codebase from what is inherently an
operational activity against a real, provisioned Supabase/Vercel project — the second category
can't be completed inside this repository no matter how much code is written, and is documented
here as a runbook instead of a checkbox.

## 1. RLS test coverage audit — done in code

Every table in `schema/schema.sql` (44 tables) has `alter table ... enable row level security`
applied — confirmed by diffing the full `create table` list against the full
`enable row level security` list; there is no gap.

Cross-referencing every table name against `packages/rls-tests/test/*.rls.test.ts` found exactly
one table with **zero** test coverage: `project_allocations`. Its policies (self/manager/HR
Admin/Finance/CEO read, HR Admin-only write) had never been exercised by a test, unlike its sibling
`projects` table. Fixed by adding a `project_allocations` describe block to `phase4.rls.test.ts`
covering: HR Admin write, self-read, manager-read, an unrelated peer blocked from both reading and
writing. The full RLS suite is now **135/135 passing** (134 before this fix, 21 of which were new
in Phase 6).

Every other table already had at least one policy assertion from the phase that introduced it.

## 2. Load/perf check — partially done in code, partially deferred

A full load test against a realistic headcount needs a real (or realistic staging) Supabase
project — this sandbox's local Postgres has no network latency to a hosted database, so a raw
timing number measured here would not transfer to production and would be misleading to report as
a "load test passed." What **was** done: a code-level review of every scheduled job for the
scalability shape that matters once round-trip latency is non-zero — sequential per-row writes
inside a loop, one HTTP round trip per row, executed inside a single serverless function
invocation with a wall-clock timeout.

Found and fixed two real instances of that pattern:

- **`/api/cron/leave-accrual`**: was issuing one `insert` per employee × leave-type pair,
  sequentially awaited. At realistic headcount (hundreds of employees × several leave types) this
  is hundreds of sequential round trips in one function invocation — a real risk of hitting
  Vercel's function timeout on a real deployment. Fixed by collecting all rows first and issuing
  one bulk `insert(rows)` at the end; behavior (idempotency check, skip conditions, cap logic) is
  unchanged, only the write is batched.
- **`/api/cron/comp-day-expiry`**: same pattern (one insert per expiry posting), same fix.

**Not changed**: `/api/cron/document-expiry`. Its writes are heterogeneous per document (a status
update, a conditional reminder-log insert, a conditional notification insert per HR Admin) rather
than one uniform row per employee, so batching it safely would need a larger restructure than this
pass's risk budget allows — flagging it here as the next candidate rather than rewriting it under
time pressure. Its volume is also naturally bounded by "documents expiring soon," typically much
smaller than total headcount.

`generate_payroll_export_lines()` (Phase 6) was already a single set-based SQL function with no
per-row round trips from the application — no change needed there.

**Deferred (operational)**: actually running these jobs against a staging project seeded with a
few hundred synthetic employees, and measuring real wall-clock time against Vercel's function
timeout for the plan in use. Recommended before go-live, not before this report.

## 3. Secrets audit — done in code, now automated

`lib/supabase/admin.ts` already had `import "server-only"` (a build-time error if a Client
Component imports it), but that only guards the import path, not the actual shipped output. Added
an automated check that closes that gap:

- `scripts/check-no-secrets-in-client-bundle.mjs` builds with a known value for
  `SUPABASE_SERVICE_ROLE_KEY` and greps every file under `apps/web/.next/static` (everything
  Next.js ships to the browser) for that exact string, failing if found.
- Verified it actually catches a real leak (planted a file containing the secret in
  `.next/static`, confirmed the script exits non-zero and names the file, then removed it).
- Wired up as `npm run check:secrets` and as its own CI step in `.github/workflows/ci.yml`,
  running right after the production build with the same placeholder secret value.

## 4. Backup/restore drill — deferred (operational)

Cannot be performed against this sandbox — there is no provisioned Supabase project here, only a
local scratch Postgres used for migration/RLS testing. Runbook for whoever provisions the real
project:

1. Confirm Supabase's automated daily backups are enabled on the project (Pro plan or above).
2. Quarterly: restore the latest backup into a throwaway project, run
   `npm run test:rls` against it with `RLS_TEST_ADMIN_URL` pointed at the restored database, and
   spot-check row counts on `employees`, `leave_ledger`, `payroll_export_runs` against the source.
3. Document actual restore time observed — this becomes the RTO figure in an incident runbook.
4. Storage buckets (`employee-documents`, `identity-documents`, `receipts`, `letters`) are not
   covered by Postgres backups — confirm Supabase Storage's own backup/versioning story separately.

## 5. Accessibility pass — lightweight review done in code, full audit deferred

What a running browser + assistive tech session would catch cannot be fully substituted by static
review, so this is a heuristic pass, not a completed audit:

- No `<img>` tags anywhere in `apps/web/src` — nothing to add `alt` text to yet; the moment an
  image is added (a company logo, an avatar), it needs one.
- Every interactive control uses the shared `Button`/`Input`/`Select`/`Textarea`/`Label`
  components rather than raw unstyled elements — form fields are consistently paired with a
  `<Label htmlFor>` (70 `Label` usages against 67 `Input`/`Select`/`Textarea` usages across
  `app/(app)`), and there are no icon-only buttons lacking visible text.
- Root layout sets `<html lang="en">`.
- Native `<select>`/`<input>`/`<button>` elements are used throughout (see
  `components/ui/select.tsx`), which get keyboard operability and screen-reader semantics for free
  from the browser rather than needing custom ARIA wiring.

**Deferred (operational)**: an actual keyboard-only pass through each core journey (login → submit
leave → approve → view payslip-equivalent) and a screen reader pass (VoiceOver/NVDA) on the same
set, plus a real mobile-viewport pass on a device — none of which a static code review can stand
in for.

## 6. Staged rollout — deployment decision, not a code change

Per the phase's own guidance: UAE headquarters first (fullest role coverage, most employees — the
strongest validation of the whole system), then KSA and Poland once the policy engine has proven
itself against a second and third country's real rules. This is already reflected in
`supabase/seed.sql`'s draft policy content (all three countries seeded, none activated) — activating
UAE's policies first when a real HR Admin reviews them is the natural rollout gate, with KSA/Poland
following once UAE is live and stable. Nothing in the schema or approval engine is UAE-specific, so
there is no code dependency forcing this order — it is purely a risk-management sequencing choice
for whoever runs the actual rollout.

## Summary

| Item | Status |
|---|---|
| RLS coverage audit | Done — 1 real gap found (`project_allocations`) and fixed; 135/135 passing |
| Load/perf review | Done for 2 of 3 cron jobs (batched); real load test against staging deferred |
| Secrets audit | Done — automated CI check added and verified against a planted leak |
| Backup/restore drill | Deferred — needs a real Supabase project; runbook written |
| Accessibility pass | Lightweight code review done; full keyboard/screen-reader/mobile pass deferred |
| Staged rollout | Deployment decision documented; no code dependency |
