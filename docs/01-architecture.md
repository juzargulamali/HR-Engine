# 1. System Architecture

## 1.1 Goals shaping the architecture

- One codebase serving multiple legal entities/countries with different labor law parameters.
- Strict separation between "who can read this data" (RLS) and "what does this number mean"
  (deterministic app-layer calculation).
- Every write that matters (approval, balance change, payroll figure) must be reconstructable from
  an immutable trail.
- Deployable by a small team on Vercel + Supabase without a separate backend fleet.

## 1.2 High-level diagram

```mermaid
flowchart TB
    subgraph Client["Browser (Next.js App Router, React Server + Client Components)"]
        UI[shadcn/ui + Tailwind]
    end

    subgraph Vercel["Vercel"]
        RSC[Next.js Server Components / Route Handlers]
        API[Server Actions & API Routes\n(deterministic business logic)]
        CRON[Vercel Cron\n(scheduled jobs)]
    end

    subgraph Supabase["Supabase Project"]
        AUTH[Supabase Auth\n(email/password + SSO)]
        PG[(PostgreSQL\nRLS-enforced)]
        STORAGE[(Storage buckets\ndocuments, receipts, assets)]
        EDGE[Edge Functions\n(webhooks, heavy batch: payroll export, reminders)]
    end

    subgraph External["External (future)"]
        MAIL[Transactional email]
        SSO[Corporate IdP]
    end

    UI -->|anon/user JWT| RSC
    RSC --> API
    API -->|user-scoped client, RLS applies| PG
    API -->|signed URLs| STORAGE
    CRON --> EDGE
    EDGE -->|service role, server-only| PG
    EDGE --> STORAGE
    AUTH --> UI
    AUTH --> PG
    EDGE --> MAIL
    AUTH --> SSO
```

## 1.3 Technology choices

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | Next.js 14+ (App Router), TypeScript strict mode | Server Components for data-heavy views, Server Actions for mutations |
| UI | Tailwind CSS + shadcn/ui | Accessible primitives (Radix), consistent theming, dark mode optional |
| State/data fetching | Server Components + React Query for client-side interactive tables | Avoid duplicating server logic client-side |
| Auth | Supabase Auth (email/password now, SAML/OIDC-ready for corporate SSO later) | JWT carries `sub` (user id); role/scope resolved from DB, not from JWT claims, so revocation is immediate |
| Database | Supabase PostgreSQL | Single physical database, **row-level multi-tenancy** by `company_id`/`country_code`, not separate schemas per country |
| Authorization | PostgreSQL Row-Level Security + a thin `permissions` service layer in TypeScript that mirrors RLS decisions for UI affordances (never the source of truth) | RLS is the enforcement point; the app layer just avoids showing controls the user can't use |
| File storage | Supabase Storage, private buckets, signed URLs, path convention `company_id/employee_id/...` | Bucket-level policies + path-based RLS-equivalent checks |
| Background/scheduled jobs | Supabase Edge Functions triggered by Vercel Cron (or Supabase `pg_cron` where the job is a pure SQL/ledger sweep) | Leave accrual, comp-day expiry, document-expiry reminders, payroll export generation |
| Deterministic business logic | TypeScript "domain" package (`packages/domain`), unit-tested, imported by both Server Actions and Edge Functions | Single source of truth for leave-day math, currency rounding, approval routing so UI and background jobs never disagree |
| Testing | Vitest/Jest for domain logic, Playwright for critical journeys, pgTAP (or Vitest against a local Supabase) for RLS policy tests | Required per task: balances, overlaps, expiry, approval rules all covered |
| Hosting | Vercel (app), Supabase (DB/Auth/Storage/Edge Functions) | No separate always-on server needed |

## 1.4 Tenancy & country model

- Single Supabase project, single Postgres database.
- `companies` table = legal entities (e.g. "Enginious LLC FZ — UAE", "Enginious Sp. z o.o. — Poland").
  An employee belongs to exactly one company at a time (contract history tracks moves).
- `countries` table = ISO country code + metadata (currency, week start day, statutory week length).
- Every policy-bearing table is keyed by `country_code` (labor law is national) while org-scoped
  tables (approval workflow overrides, cost centers) are keyed by `company_id` — a country can host
  more than one company/branch.
- Adding a fourth country is a data operation (new `countries` row + `policy_versions` rows), never
  a code change. This is enforced by never branching on country code in application code — all
  country-specific behavior is expressed as policy data resolved through one generic resolver
  function (`resolveEffectivePolicy(countryCode, policyType, asOfDate)`).

## 1.5 Application boundaries (where logic lives)

| Concern | Lives in | Why |
|---|---|---|
| "Can user X see row Y" | Postgres RLS policy | Enforced even if a bug in app code forgets to filter |
| "How many leave days does this request consume" | `packages/domain/leave.ts`, called from a Server Action | Needs to be identical whether triggered by UI, API, or a nightly job; must be unit-testable |
| "Which approver is next" | `packages/domain/approvals.ts`, reading `approval_workflows`/`approval_workflow_steps` | Same determinism argument |
| "Is this AI suggestion allowed to go live" | Never — AI writes only to `ai_drafts`; a human user, through the normal Server Action + RLS path, promotes a draft | Enforces the AI constraint at the architecture level, not by convention |
| "What happened and who did it" | `audit_log`, written by a Postgres trigger (`AFTER INSERT/UPDATE` on guarded tables) in addition to explicit domain-level entries for business events (approvals, balance changes) | Trigger-level audit can't be bypassed by a new code path forgetting to log |

## 1.6 Environments & secrets

- **Public/browser**: only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The anon
  key is safe by design because RLS gates everything it can do.
- **Server-only** (Vercel server runtime + Supabase Edge Functions env): `SUPABASE_SERVICE_ROLE_KEY`,
  used exclusively inside Edge Functions / server-only Route Handlers for operations RLS cannot
  express (e.g. cross-tenant payroll export aggregation) — never imported into any file bundled to
  the client, enforced by lint rule (`no-restricted-imports`) plus a CI grep check.
- Row-level security is **on** for every table in the `public` schema; there is no table that relies
  solely on "the app remembers to filter."

## 1.7 Observability

- `audit_log` doubles as a business-event log; a separate lightweight `app_events` table is not
  needed at launch.
- Vercel/Supabase built-in logs + a periodic export of `audit_log` to a reporting view for the
  dashboard (see §6 of the schema doc).

Proceed to [02-database-schema.md](./02-database-schema.md).
