# Phase 2 remaining-scope audit (Step 1)

Read-only comparison of the current `phase2/ux-hardening` branch against the
full original Phase 2 brief (2E–2K), done before any further code changes.
Covers: what already exists and is reusable, proposed files/migrations,
changes that could touch existing employee data, decisions that need an
owner call, and a realistic time estimate per subphase.

## What's already done (do not repeat)

Payroll detail-page auth gap, HR Admin company-scope bug, Employees-page
wording, CEO/CTO terminology, shared `EmptyState` usage, skip-to-content
link, Drawer/CommandPalette focus trapping + native `inert`, focus-boundary
unit tests. Confirmed present on this branch; none of the work below repeats
it.

## 2E — Employee profile information architecture

**Exists/reusable:**
- `SegmentedControl` (`components/ui/segmented-control.tsx`) — built, `role="tablist"`/`role="tab"`, `aria-selected`, but **completely unused** anywhere in the app today. It's the natural base for the new tab UI; needs a thin URL-syncing wrapper (it has no built-in URL sync).
- The `searchParams: Promise<{...}>` typed-prop pattern (already used in `attendance/page.tsx`, `audit-log/page.tsx`) is the house style to extend to `?tab=` on `employees/[id]/page.tsx`.
- 8 of the 10 target sections already have a working `can*` permission helper wired to a `{isSelf, isManager}`-aware check: Employment (`canViewContracts`/`canViewCareerEvents`), Compensation (`canViewCompensation`), Documents (`canViewEmployeeDocuments`/`canViewIdentityDocuments`), Insurance & Loans (`canViewInsurance`/`canViewLoans`), Assets (`canViewAssetAssignments`), Performance (`canViewGoals`). All existing section components are separate async Server Components — the plumbing for "fetch per-section" already exists structurally, it's just not deferred to actual tab selection today.
- **Confirmed real problem to fix, not a nice-to-have**: today's page has no `<Suspense>` boundaries, so even though each section is its own component, Next.js must await all ~11 of them before sending any response — every permitted section's queries fire on first load regardless of which tab a user would pick. This is exactly the "avoid loading every subsection on the initial request" anti-pattern named in the brief, and it's already live in production behavior on this branch.

**Net new (no existing helper):**
- **Leave** section: `packages/domain/src/permissions/leave.ts` only has HR-management checks (`canManageAnyLeaveRequest` etc) — no self/manager view helper for "can I see this employee's leave summary." Needs a new `canViewEmployeeLeave(grants, companyId, {isSelf, isManager})` helper, modeled directly on `canViewAttendance`'s shape.
- **Activity** section: no permission helper, no UI, and — more importantly — **no RLS policy lets anyone read their own `audit_log` rows today**. `audit_log_select_hr`/`audit_log_select_sysadmin` are the only two SELECT policies; both require `hr_admin`/`sys_admin`. An employee viewing their own profile currently cannot see even one audit row about themselves.

**Proposed files:**
- `apps/web/src/components/ui/url-tabs.tsx` (or similar) — thin client wrapper: reads `?tab=`, renders `SegmentedControl`, updates the URL via `router.replace` (never `push`, so Back doesn't stack every tab click) on change, defaults to `overview` when absent/invalid.
- Split `employees/[id]/page.tsx`'s per-section `<Card>` blocks into one file per tab under `employees/[id]/sections/` (or keep existing section component files, just change what renders when) — reuses existing section components almost as-is; the main change is which ones get rendered based on `?tab=`, not their internals.
- New `employees/[id]/activity-section.tsx`.
- New `packages/domain/src/permissions/leave.ts` addition: `canViewEmployeeLeave`.
- New `packages/domain/src/permissions/activity.ts` (or append to an existing file): `canViewEmployeeActivity`.

**Proposed migration:**
- One new migration adding a narrowly-scoped `audit_log_select_self` policy: an employee may read a row only where the audited record resolves to their own `employee_id` (via the same table-specific resolution `write_audit_log()` already does), and only for a safe allowlist of table names that map to the "Activity" bullet list in the brief (`employees`, `employment_contracts`, `compensation_details`, `leave_requests`, `leave_ledger`, `comp_day_ledger`, `employee_documents`/`identity_documents` if audited, `asset_assignments`, `appraisals`/`performance_cycles` milestones, `user_roles`) — **never** `employee_loans`/`employee_insurance_policies`/`employee_career_events`, which stay HR-only exactly as today. Since `before_data`/`after_data` are already redacted at write time for banking/identity fields (Phase 1 correction 5) and the self-view UI must not show raw payloads anyway, the app layer will still not `select` those columns for the Activity feed — it renders a human sentence per row (`table_name`/`action`/`occurred_at`) client-side, not the JSON.
- This is an **additive** RLS policy (new read capability for a user's own data), not a change to any existing policy — does not weaken any current boundary. Still requires its own RLS positive/negative tests (self can read own; self cannot read a peer's; sensitive-only tables stay hidden even from self) before I'd consider it done.

**Does this touch existing employee data?** No row data changes. It's a UI restructure plus one additive, narrowly-scoped RLS policy. No migration risk to existing rows.

**Decision needed?** No — this is squarely "proceed": nothing here touches payroll, doesn't weaken any boundary, and the new RLS grant is self-scoped and redacted by an already-shipped mechanism.

**Estimate:** 4–6 hours for a complete, tested implementation (tab shell + 10 sections wired to lazy rendering + new Leave/Activity sections + migration + RLS tests + Overview redesign).

## 2F — Employee onboarding wizard with save-as-draft

**Exists/reusable:**
- `createEmployee()` today is explicitly documented in its own code comment as non-atomic (5 sequential inserts, tolerates partial failure, no idempotency) — this is a known, accepted tradeoff from earlier phases, not a regression I'm introducing, but it's exactly the defect this subphase is meant to fix.
- Strong existing precedent for the **finalize RPC**: `submit_leave_request()` (Phase 1 correction 2, this branch's own recent work) is the exact "insert root entity, then call a shared dependent-creation step, all in one SECURITY DEFINER function" shape — the finalize RPC should be modeled on it directly.
- Strong existing precedent for **idempotency**: the leave-accrual/comp-day-expiry crons already use a nullable `unique idempotency_key` column + `.upsert(..., { onConflict: "idempotency_key", ignoreDuplicates: true })` to make retries silent no-ops. Directly reusable for "retrying finalization must not create duplicates."
- Existing precedent for **draft-via-status-column + RLS filter**: `policy_versions` (`status: draft|active|superseded`, RLS shows drafts only to hr_admin/ceo/cto, everyone else only sees `active`). This proves the pattern works, but it doesn't transfer cleanly to `employees` (see decision below).
- `generate_checklist_items()` already exists for the "documents/checklist" step — reusable as-is at finalize time.
- `ledgerAdjustments.ts`'s `postLeaveLedgerAdjustment()` is the exact existing pattern for "opening balance" — reusable for the wizard's opening-balance step, called from inside the finalize RPC rather than as a separate client call.

**The one real business/data-model decision (flagged per the brief's own instructions):**
Two viable designs for "draft," with different risk profiles:
- **(a) Real `employees` row with a draft flag.** Confirmed unsafe as a bare reuse of `employment_status`/`deleted_at`: the `employees_select` RLS policy's non-privileged branch (self/manager/finance/ceo/cto) has **no status filter at all** — Finance and CEO/CTO of the company would see a half-filled draft immediately. Doing this safely requires editing `employees_select` itself (a currently-approved Phase 1 policy) to add an explicit "and not a draft" clause to that branch — a change to an existing, already-tested authorization boundary.
- **(b) Staging table, no `employees` row until finalize** (modeled on the existing `ai_drafts` table: `entity_type`, `proposed_payload jsonb`, `status`, `created_by`, `reference_id` back-linking to the real row once created). Needs zero changes to `employees` or its RLS at all — a draft simply doesn't exist anywhere a manager/Finance/CEO query could ever see it, because there's no row to see.

**Decision: proceeding with (b)** — it satisfies "a draft must not appear as an active employee anywhere" more strongly (structurally, not by relying on a filter clause staying correct forever) and requires no edit to an already-approved Phase 1 RLS policy, matching "do not change approved Phase 1 business logic unless a genuine defect is discovered." This is the safe, non-destructive default per the task's own instruction for exactly this situation; documented here rather than blocking on it. If the owner prefers (a) for other reasons (e.g. wanting drafts to show up in the same `employees` list UI), that's a straightforward alternative to switch to later — nothing in (b) is a dead end.

Within design (b), one more explicit constraint from the brief: **"avoid storing an uncontrolled JSON document containing sensitive onboarding data... protect compensation and banking information separately."** Plan: the draft staging table stores identity/employment/contract/checklist/access-step fields in one `payload jsonb`, but **compensation figures and any banking fields go in a separate `draft_compensation jsonb` column (or a separate table) with its own, stricter RLS** (HR Admin/Finance of the target company only — never a plain HR Admin-in-training or anyone else who might get generic draft-read access), mirroring the same "compensation is more sensitive than the rest of the employee record" split the schema already makes for the live tables.

**Proposed files (new UI, sizeable):**
- `apps/web/src/app/(app)/employees/new/` restructured into a wizard: `page.tsx` (loads/creates a draft, redirects to step 1), `[draftId]/[step]/page.tsx` or a client-side stepper over one page with `?step=` (same URL-driven pattern as 2E), one form component per step (8 steps → 8 form files, each reusing field patterns from the current `new-employee-form.tsx` split apart).
- `apps/web/src/lib/actions/employeeOnboarding.ts` — `createDraft`, `saveDraftStep`, `finalizeDraft`, `sendInvite` (kept separate from finalize per the brief), `deleteDraft`.
- Keep `employees/new/new-employee-form.tsx` and today's `createEmployee()` server action **untouched** as a fallback path (per "preserve the current creation flow until the new wizard is verified") — the wizard is additive, reachable via a new entry point, not a hard cutover.

**Proposed migrations:**
1. `employee_onboarding_drafts` table: `id`, `company_id`, `status` (`draft`/`finalizing`/`finalized`/`abandoned`), `payload jsonb`, `created_by`, `created_at`, `updated_by`, `updated_at`, `finalized_employee_id uuid references employees(id)` (nullable, set once finalized — doubles as the idempotency anchor), `idempotency_key text unique` (same convention as the ledger crons). RLS: HR Admin of `company_id` only, full CRUD on rows still `status = 'draft'`; no delete once `status != 'draft'`.
2. `employee_onboarding_draft_compensation` table (or a `jsonb` column with its own tighter RLS on the same table — a genuine implementation-detail call, not a business decision): compensation/banking fields, RLS restricted to HR Admin + Finance of `company_id`.
3. `finalize_employee_onboarding(p_draft_id uuid)` SECURITY DEFINER RPC: re-checks `status = 'draft'` and `finalized_employee_id is null` (idempotency guard — a second call with the same draft id returns the already-finalized employee id rather than erroring or duplicating, mirroring the cron upsert pattern), then inside one transaction: inserts `employees`, `employment_contracts`, `compensation_details`, opening `leave_ledger`/`comp_day_ledger` entries, calls `generate_checklist_items()`, sets `draft.status = 'finalized'` and `finalized_employee_id`, writes one `audit_log`-visible action. User invitation is explicitly NOT part of this function (external Auth API call, can't be transactional) — it's a separate, idempotent follow-up action the UI calls only after an explicit "send invite" confirmation, exactly as the brief requires.

**Does this touch existing employee data?** No changes to any existing employee, contract, compensation, or ledger row. Purely additive tables + one new RPC. Zero migration risk to current data — this is the safest-shaped subphase of the whole remaining brief, specifically because design (b) was chosen.

**Estimate:** this is the largest remaining subphase by far — realistically **2–3 full days** for a careful, tested implementation (schema + RLS + RPC + 8-step wizard UI + draft resume + atomic finalize + invite-separation + role-by-role RLS tests + duplicate-finalization test). Given the size, I'm treating this as its own multi-step effort within the work below rather than something to compress.

## 2G — Search, filtering, sorting, pagination

**Exists/reusable:** `audit-log/page.tsx` is a complete, working reference implementation of everything this subphase asks for: typed `searchParams`, safe param clamping (`Math.max(1, parseInt(...) || 1)`), a `pageHref()` query-string-merge helper, `.select(..., {count:"exact"}).range(offset, offset+PAGE_SIZE-1)`, a plain `<form method="get">` filter bar, and a "Clear filters" link. `attendance/page.tsx` has a smaller version of the same idea (validated `date`/`companyId` params with safe fallback to defaults). **Neither of these is factored into a shared component** — every other list page (10 of 11) has zero filter/sort/pagination machinery today.

**Confirmed, already-live scale risk (not introduced by this work, but exactly what it fixes):** `employees/page.tsx` fetches every employee row in every company the viewer can see with no `.range()`/`.limit()` at all, every request. `assets/page.tsx` and `letters/page.tsx`'s manage-all branch have the identical unbounded shape.

**Proposed files:**
- `apps/web/src/components/ui/pagination.tsx` — new, small, no library (Prev/Next + page X of Y, matching audit-log's existing look).
- `apps/web/src/lib/list-params.ts` — shared, framework-free helpers: `parsePage(searchParams.page)`, `parseSort(value, allowedColumns[], default)`, `buildPageHref(...)` (audit-log's merge helper, promoted to shared and unit-testable in plain Node since it's pure string/URL logic — no DOM needed).
- Per-page: add `searchParams` typing + a `<form method="get">` filter bar + `.range()`/`count` to each of the 10 pages, following audit-log's exact idiom. No new components needed beyond the two above; this is a mechanical, well-understood pattern applied 10 times.

**Migrations:** none required to implement pagination/filtering itself. Only index additions if a specific filter/sort combination is actually slow (I'll check `explain analyze`-shaped reasoning per page rather than add indexes speculatively, per "add indexes only when justified" — likely candidates: `attendance_records(work_date, company_id)` composite if not already covered, `leave_requests(status, employee_id)` — will confirm against existing indexes in `schema.sql` before proposing any, and document each one added).

**Sort safety:** every `.order(column)` call must come from a small server-side allowlist per page (e.g. `['name','hire_date','status']` for Employees), never the raw query-string value — this directly satisfies "prevent arbitrary column names... reaching Supabase."

**Does this touch existing employee data?** No. Read-only query changes.

**Decision needed?** No.

**Estimate:** 1–1.5 hours to build the two shared helpers, then ~30–45 minutes per list page × 10 pages ≈ 6–8 hours total.

## 2H — Workflow clarity

**Exists/reusable:** `Badge` component itself is fine (variant-styled primitive); the problem is that status→variant color mapping is **independently duplicated in at least 10 files** with near-identical shapes — a real, confirmed drift risk (not hypothetical: `reimbursements/[id]/page.tsx` and `payroll/[id]/page.tsx` already render an *uncolored* badge on the detail page for the same status their own list page colors, a live inconsistency).

**Confirmed gap:** no approval-chain/timeline UI exists anywhere. `approvals.step_order` is stored and queried but never rendered as step history; a stored rejection comment (`decideApproval`'s `comments` field) is written but never displayed back on any detail page I found. Client-side "can I act" gating is server-computed everywhere checked (a genuine positive finding, not a gap).

**Proposed files:**
- `packages/domain/src/statusLabels.ts` (or under an existing shared location) — one `STATUS_BADGE: Record<EntityType, Record<string, {variant, label}>>` map, or simpler: one function per entity type, replacing the 10 duplicated consts.
- `apps/web/src/components/ui/status-badge.tsx` — thin wrapper consuming the map.
- `apps/web/src/components/ui/workflow-timeline.tsx` — lightweight, Card/Badge-based (no library): renders ordered steps with done/current/pending/rejected states, actor + timestamp only when the viewer is authorized to see it (reuses each page's existing server-computed authorization booleans — never a new client-side check).

**Migrations:** none — this is presentation-only, reading columns that already exist (`step_order`, `decision`, `comments`, `decided_at`, `approver_id`).

**Does this touch existing employee data?** No.

**Estimate:** 4–6 hours (shared components + wiring into Leave/Reimbursements/Approvals/Payroll/Policies-with-approval; onboarding's workflow view depends on 2F existing first, so it's the one surface here that's blocked on that subphase, not on this one).

## 2I — Forms, feedback, accessibility

**Confirmed baseline:** structurally consistent already — every form uses `useActionState` + disabled/pending-label submit + a whole-form `Alert`, and `Label htmlFor`/`Input id` pairing is correct almost everywhere (two exceptions found: `bulk-attendance-form.tsx`'s table controls have no labels at all; a couple of checkboxes rely on implicit wrapping labels, which is valid but inconsistent style). **Zero** forms use `aria-invalid`, `aria-describedby`, autocomplete, or focus-management on error — confirmed by repo-wide grep returning no hits for any of the four. **No shared `FormField` component exists** — every form hand-rolls its own Label+Input block, so there is no single chokepoint to patch.

**Confirmed, systemic issue beyond what was asked:** raw Supabase/Postgres `error.message` is passed straight to the user in dozens of call sites across nearly every action file (`employees.ts` alone has 25+), not an isolated case. This is explicitly named in the brief ("Do not show raw Supabase/Postgres error messages") and is a real, live gap.

**Proposed files:**
- `apps/web/src/components/ui/form-field.tsx` — new shared wrapper (Label + control slot + help text wired via `aria-describedby` + error text wired via `aria-invalid`/`aria-describedby` on the control).
- `apps/web/src/lib/safe-error.ts` — one small helper `toSafeErrorMessage(error, fallback)` that action files call instead of forwarding `error.message` directly; a short allowlist of already-friendly, deliberately-raised messages (e.g. the `raise exception` texts from Phase 1's own RPCs, which are intentionally user-facing) passes through, anything else becomes the generic fallback.
- Retrofit `bulk-attendance-form.tsx` to add real per-control labels (the one place with none at all).

**Does this touch existing employee data?** No.

**Decision needed?** No — but note the sheer surface area: ~15 forms for the `FormField`/aria retrofit, ~15 action files for the error-message fix, each a small independent edit but individually reviewed since there's no single chokepoint. This is real, non-trivial mechanical work, not a quick pass.

**Estimate:** 6–9 hours for the two shared pieces plus a full retrofit pass across every form/action file named in the brief.

## 2J — Destructive and sensitive actions

**Confirmed baseline:** 100% of destructive actions already use `window.confirm()` with reasonably good (not perfect) consequence-explaining copy; **zero** use a custom accessible dialog, and none support anything richer (e.g. a "type DELETE" confirmation for the most severe action, permanent employee delete). **One confirmed gap**: `ActivateButton` (policy activation) has **no confirmation at all** despite having real, hard-to-reverse consequences (an active policy is frozen except via new-version supersession) — this is a real defect to fix, not a style preference.

**Not yet confirmed (needs a direct check before I'd call 2J done):** the brief specifically calls out "protect the last System Administrator" and "protect against accidental self-revocation" — the forms/destructive-actions audit didn't verify whether `revoke-role-button.tsx`'s Server Action (`revokeRole` or similar in `users.ts`) already guards either case. I'll check this directly as the first step of implementing 2J, since if it's missing, that's a genuine authorization gap (not just a UX one) that needs a server-side/RLS-level fix, not merely a confirmation dialog.

**Proposed files:**
- `apps/web/src/components/ui/confirm-dialog.tsx` — new accessible dialog, built on the same `Drawer`/`useFocusTrap`/`inert` infrastructure already shipped this phase (role="dialog", focus trap, Escape, inert-when-closed) rather than a new library.
- Swap into the ~12 existing `window.confirm()` call sites; add a confirmation to `ActivateButton`.
- If the last-sys-admin/self-revocation checks are missing: a small guard added to the relevant Server Action (and, if the gap is real at the RLS level too, a migration + RLS test) — genuinely can't size this precisely until I've looked.

**Does this touch existing employee data?** No, unless the last-sys-admin/self-revocation check turns out to require an RLS change — I'll document that specifically if so, before applying it, per "list any migration before applying it."

**Estimate:** 3–5 hours for the dialog + swap-in; +1–2 hours if the last-admin/self-revocation guards need to be added from scratch.

## 2K — Responsive and keyboard validation

**Available tooling:** this environment has Chromium + Playwright pre-installed, so real browser automation is possible — not limited to code inspection alone. Given the sheer number of workflows named (14 areas × 4 breakpoints), an exhaustive automated pass across everything is not realistic in the time available; I'll run Playwright against the highest-risk surfaces (nav/drawer/command-palette at 375px since that's exactly what this phase's own focus-trap/inert work touched, plus one representative data-table page and one form page) and be explicit that the remainder is verified by code inspection only (Tailwind breakpoint usage, the `Table` component's existing `overflow-x-auto` wrapper, the shared focus-ring convention) — matching the brief's own instruction to clearly separate what was automated from what needs manual QA.

**Estimate:** 2–3 hours for a targeted Playwright pass + documented inspection notes for the rest.

## Summary time estimate

| Subphase | Estimate | Blocking decision? |
|---|---|---|
| 2E | 4–6 hours | No |
| 2F | 2–3 days | Draft-model choice — resolved below (staging table, no `employees`/RLS change), proceeding |
| 2G | 6–8 hours | No |
| 2H | 4–6 hours (partly depends on 2F for onboarding's own workflow view) | No |
| 2I | 6–9 hours | No |
| 2J | 3–5 hours (+1–2h if last-admin/self-revocation guards are missing) | No |
| 2K | 2–3 hours automated + inspection | No |

Total: roughly **4–6 working days** for the full remaining brief at the quality bar this repo has held so far (tested, migrated, RLS-covered). Given that, I'm proceeding sequentially — 2E first, committing and testing each subphase independently — rather than attempting a shallow pass across all seven at once. I'll report honestly at the end on what was completed vs. deferred, per the brief's own instruction not to describe Phase 2 as complete unless it actually is.
