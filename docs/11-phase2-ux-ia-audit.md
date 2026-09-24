# Phase 2A — UX & Information-Architecture Audit

Read-only survey of the current app shell, navigation, permission model, and
page-level UI conventions, done before any Phase 2 changes. This is the
working checklist for Phases 2B–2D; it does not itself change behavior.

## 1. Navigation and command search — already role-filtered

`buildNavGroups(session.grants)` (`apps/web/src/components/nav/nav-groups.ts`)
is a pure function that filters every gated link/group *before* handing the
result to both the sidebar (`SidebarNav`) and the command palette
(`CommandPalette`) — both are pure renderers of an already-filtered list,
with no independent link list of their own. The command palette in
particular only ever searches `groups.flatMap(...)`, so it cannot leak a
destination the sidebar itself wouldn't show.

**Conclusion: the "hide nav/command-search entries a role cannot access"
requirement is already satisfied by the existing architecture.** No changes
needed in 2B beyond keeping this single-source-of-truth pattern intact for
any new links.

Minor IA note (cosmetic, not a defect): the "People" nav group mixes
company-wide admin views (Employees, Attendance-as-register) with pure
self-service pages whose own page headers say "My Leave" / "My
Reimbursements" / "My Performance". Left as-is — the short nav label vs.
the "My ..." page header is a normal, common pattern, not a bug.

## 2. Direct-route authorization — one real gap found

Every page is behind the `(app)` layout's signed-in check, and `/admin/*`
is additionally gated at the layout level (`isSysAdmin`). Most pages that
matter also compute their own `can*` gate. Two categories of "no explicit
page-level check" are **fine as designed**: pages under `admin/*` (layout
already gates them) and genuinely open-view pages backed by RLS (`/policies`,
`/holidays`, `/approvals` — view is intentionally open, only mutations are
role-gated, and RLS is the real boundary either way per every `can*`
doc-comment in `packages/domain/src/permissions/*`).

**One real gap:** `apps/web/src/app/(app)/payroll/[id]/page.tsx` renders full
payroll line-item data (salaries) for any signed-in user who reaches the
URL, with no `canViewPayrollExport` check of its own — unlike its own list
page (`/payroll`), which blocks non-viewers outright, and unlike every other
detail page in the app, which computes at least a `canView*`/`isSelf`-style
gate. Currently protected only by RLS (`payroll_runs_select`). **Fix in
2B**: add the same `canViewPayrollExport` gate the list page already uses.

## 3. Role-dependent wording — Employees page scope caption is wrong for 3 roles

`apps/web/src/app/(app)/employees/page.tsx` shows a caption under the page
title based on `canManageAnyCompany = isHrAdmin || isSysAdmin`:

- `true` → "Everyone you administer, plus anyone in your reporting chain."
- `false` → "You and the people who report to you."

The `employees_select` RLS policy actually grants **Finance, CEO, and CTO**
every active employee in every company they hold that role on (no
manager-chain restriction for those three roles at all) — but
`canManageAnyCompany` is `false` for all three, so they see the `false`
branch's caption, which describes a much narrower view ("you and your
reports") than what they're actually looking at. The caption is correct
only for `line_manager` and plain `employee`.

The `true` branch's wording is also slightly imprecise for hr_admin/sys_admin
themselves — "plus anyone in your reporting chain" doesn't apply to them
(the RLS grant for hr_admin/sys_admin has no manager-chain clause; it's
company/global scope, full stop).

**Fix in 2B**: a three-way caption — company-wide admin scope (hr_admin/
sys_admin), company-wide view scope (finance/ceo/cto), and reports-only
scope (line_manager/employee) — using the domain package's existing
`isFinance`/`isCLevel` helpers rather than a new ad-hoc check.

## 4. Empty states — shared component exists but is unused

`components/ui/empty-state.tsx` is a real, already-built `EmptyState`
component (icon + title + optional description + optional action), with a
doc comment mandating "say what's empty, why, and what to do next." Despite
existing, essentially every list page hand-rolls a bare
`No X yet.`/`No X to show.` string in a table cell or card body instead of
using it — Employees, Leave, Reimbursements, Timesheets, Attendance,
Payroll, Letters, Policies, Holidays, Assets, Performance Cycles, Audit Log,
Approvals, AI Suggestions all do this.

**Fix in 2C**: swap these for the existing `EmptyState` component,
consistently, across the list pages above. No new component needed — pure
consistency cleanup using what's already built.

## 5. Feedback pattern — consistent, no gap to fix

No toast/snackbar library exists anywhere in the app; feedback is
exclusively the shared `Alert` component (page-level messages,
`role="alert"`) plus `useActionState` + inline `Alert` inside forms. This is
consistent across the app and adding a toast system would be a new,
unnecessary dependency for a free-tier-conscious app — **not changing this
in 2C**, only continuing to use it consistently.

## 6. Responsive and accessibility — solid baseline, three small gaps

Already consistent: mobile-first Tailwind breakpoints, tables wrapped in
`overflow-x-auto` by the shared `Table` component itself, extensive
`aria-hidden`/`aria-label`/`aria-current`/`aria-expanded` usage, `<nav>`/
`<main>`/`<aside>` landmarks, a single reused focus-ring convention
(`focus-visible:ring-2 focus-visible:ring-ring`), and `Label htmlFor` paired
with every input.

Three gaps for 2D:
- No skip-to-content link.
- No `prefers-reduced-motion` handling despite several `transition-*`/
  `animate-pulse` usages.
- Unverified whether `CardTitle` renders a real heading element (affects
  whether the page's heading hierarchy is real or purely visual).

## Priority list carried into 2B–2D

1. **2B**: `/payroll/[id]` direct-route auth gap → add `canViewPayrollExport` check.
2. **2B**: Employees page scope caption → three-way, role-accurate wording.
3. **2C**: Replace ad-hoc empty-state strings with the shared `EmptyState` component across all list pages that lack it.
4. **2D**: Skip-to-content link, `prefers-reduced-motion` support, verify/fix `CardTitle` heading semantics.

Nothing above requires a new dependency, a new design system, or any change
to Phase 1 business logic, migrations, RLS policies, or authorization
boundaries — RLS remains the actual enforcement layer throughout; every
change here is UI-affordance/wording only, matching the existing
`packages/domain/src/permissions/*` convention of mirroring a named RLS
policy rather than inventing new authorization logic.
