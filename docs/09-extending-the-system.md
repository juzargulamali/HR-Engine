# 9. Extending the System

You asked for the platform to stay easy to change — new rules, new modules, new countries —
without turning into a rewrite every time. This document is the concrete "how," written against
the patterns Phase 0 actually established (not aspirational ones). Every later phase follows these
same patterns; nothing here is Phase-0-specific.

## The four kinds of change, and what each one actually costs

| Change | Cost | Why |
|---|---|---|
| A new country (e.g. adding Egypt next year) | Data only: a `countries` row + policy data once the policy engine (Phase 2) exists. Zero code changes. | No business rule is ever written as `if (countryCode === 'AE')`. Every country difference lives in `policy_versions.payload`, resolved by one function (`resolve_policy`). See docs/02-database-schema.md §2.4. |
| A rule changes for an existing country (e.g. UAE annual leave goes from 30 to 25 days) | Data only: insert a new `policy_versions` row with a later `effective_from`. The old version stays exactly as it was — anything calculated under it stays correct historically. | Policy is effective-dated and versioned by design (docs/00-overview.md "non-negotiable constraints"). A rule change is never an `UPDATE`. |
| A new company/branch opens (e.g. a second UAE entity) | Data only: Sys Admin creates a `companies` row through the admin UI (`/admin/companies`, built in Phase 0). | Companies were never hard-coded; `employees.company_id` and every scoped RLS policy already work off whatever rows exist. |
| A new module (e.g. Leave Requests in Phase 3, Reimbursements in Phase 4) | Code, but additive: one migration, one RLS policy set, one domain permissions file, one route group. Nothing already shipped is touched. | Enforced by the checklist below and by how Phase 0 itself was built — it's the worked example. |

The first three are the common case day-to-day and cost nothing but a form submission or a
reviewed data insert. The fourth is what "adding a module" means, and it's the one worth a
checklist.

## Adding a new module: the checklist

Follow this in order. Phase 3 (leave requests) will be the first real test of it after Phase 0.

1. **Migration**: add a new file to `supabase/migrations/`, named
   `YYYYMMDDHHMMSS_<description>.sql`. Never edit a migration that's already been applied anywhere —
   a correction is a new migration, exactly like a policy correction is a new `policy_versions` row.
   Reuse `set_updated_at()` for any table with an `updated_at` column rather than redefining it.
2. **RLS from the first commit**: `alter table ... enable row level security;` in the same
   migration that creates the table, with real policies — never a placeholder "wide open" policy
   with a "tighten later" comment. Base new policies on the existing helper functions
   (`has_role`, `is_manager_of`, `same_company`, `current_employee_id`) rather than writing new
   scoping logic inline — see docs/02-database-schema.md §2.6.
3. **RLS tests**: add a test file to `packages/rls-tests/test/`, following
   `phase0.rls.test.ts` as the template (`RlsTestDatabase.asUser()` for "who can see/do what",
   asserting both the allowed and the denied cases). A module isn't done until its RLS is proven
   against a real Postgres run, not just reviewed by eye.
4. **Domain permissions file**: add `packages/domain/src/permissions/<module>.ts`, export it from
   `permissions/index.ts`. Each function mirrors one RLS policy's condition, for UI affordances only
   — never the enforcement itself (architecture doc §1.5). Add its unit test file alongside the
   existing ones in `packages/domain/test/permissions/`.
5. **Deterministic business logic, if any** (leave-day math, approval routing, currency rounding):
   goes in `packages/domain/src/`, not inside a Server Action and not in a SQL trigger doing
   arithmetic. Server Actions call it; scheduled jobs call it; both get the same answer by
   construction. See docs/05-automation-rules.md §5.2 for why this line is drawn where it is.
6. **UI routes**: add a folder under `apps/web/src/app/(app)/<module>/`, following the existing
   `admin/` folder as the template — a Server Component page for reads, a small client component
   for each form using `useActionState`, a `lib/actions/<module>.ts` for the mutations. Reuse
   `components/ui/*` rather than inventing new primitives.
7. **Regenerate types**: once a real Supabase project exists, `npm run db:types` regenerates
   `apps/web/src/types/database.types.ts` from the live schema. Until then (Phase 0, hand-written),
   extend that file by hand following its existing shape — every table needs `Row`/`Insert`/`Update`/
   `Relationships`, and the `public` schema object needs `Tables`/`Views`/`Functions`/`Enums`/
   `CompositeTypes` present (even empty) or `@supabase/supabase-js`'s generic constraints silently
   collapse every query's return type to `never` — a real bug this codebase hit once already,
   worth not repeating.
8. **Update the design docs**: the permission matrix (`03`), user journeys (`04`), and — if the
   module adds automation — automation rules (`05`) are living documents, not a one-time snapshot.
   A module that changes what a role can do without updating `03-permission-matrix.md` has drifted
   from its own source of truth.

## Adding a new role

Six lines of code, then normal migration/policy work:

1. Add the value to the `app_role` Postgres enum (`ALTER TYPE app_role ADD VALUE '...'` in a new
   migration — Postgres enum additions aren't transactional-safe to combine with using the new
   value in the same transaction, so add the value in one migration and reference it in policies
   from the next).
2. Add it to `ROLES` and `ROLE_LABELS` in `packages/domain/src/roles.ts`.
3. Decide its access per module and add it to `docs/03-permission-matrix.md`.
4. Update the RLS policies it should participate in — usually adding one more `has_role('new_role',
   ...)` clause to an existing `for select`/`for all` policy, not writing a new policy from scratch.

## What "easy" actually means here, concretely

- **No branching on country or company anywhere in application code.** If you ever find yourself
  writing `if (company.id === '...')`, that's a sign the thing that's different should be a
  `policy_versions` row or a `deduction_priority_rules` row instead.
- **No table is ever "add RLS later."** Retrofitting RLS onto a table that's already storing real
  data is how leaks happen — every table gets its policies in the same migration that creates it.
- **Every RLS policy has a test that tries to fail it**, not just one that confirms the happy path
  — `phase0.rls.test.ts` asserts both "HR Admin can insert in their company" and "HR Admin cannot
  insert in a different company" for exactly this reason.
- **The permission-mirroring functions in `packages/domain` are small on purpose.** Each one maps
  to exactly one RLS policy condition. When they drift from the policy (see the `hasRole` scoping
  bug caught during Phase 0 — an unscoped check was initially matching a scoped grant, backwards
  from what the SQL actually does), the fix is always "make the TypeScript match the SQL," never
  the other way around — Postgres is the enforcement, the TypeScript is a convenience mirror.

## What this bought Enginious specifically

- KSA and Poland don't need their own engineering effort when they're ready to onboard past what
  Phase 2 (policy engine) already builds for them — their leave/notice/holiday rules are data, not
  a UAE-specific codebase forked three ways.
- A future fourth country, a future seventh role, or a policy change mid-year are all changes a
  non-engineer (HR Admin, Sys Admin) can make through the product itself once the relevant phase
  ships — not requests that go back into a development queue.
