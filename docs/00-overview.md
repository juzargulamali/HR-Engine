# Enginious HR — Design Package

Multi-country HR management application for **Enginious LLC FZ**, covering UAE, Saudi Arabia and
Poland at launch, built for future countries without code changes to core logic.

This package is the **pre-implementation review artifact** requested before any application code is
written. Nothing here is executable; `schema/schema.sql` is DDL meant for review, not yet applied to
a live database.

## Contents

| # | Document | Purpose |
|---|----------|---------|
| 1 | [01-architecture.md](./01-architecture.md) | System architecture, stack, tenancy model, integration boundaries |
| 2 | [02-database-schema.md](./02-database-schema.md) | Narrative schema design, entity relationships, RLS strategy |
| — | [../schema/schema.sql](../schema/schema.sql) | Full PostgreSQL DDL (tables, enums, constraints, RLS policies, triggers) |
| 3 | [03-permission-matrix.md](./03-permission-matrix.md) | Role × resource × action permission matrix |
| 4 | [04-user-journeys.md](./04-user-journeys.md) | End-to-end journeys per role |
| 5 | [05-automation-rules.md](./05-automation-rules.md) | Deterministic jobs, calculation rules, AI-draft boundary |
| 6 | [06-implementation-phases.md](./06-implementation-phases.md) | Phased delivery plan |
| 7 | [07-risk-register.md](./07-risk-register.md) | Risks and mitigations |

## Non-negotiable constraints carried through every document

- **Determinism**: all monetary and leave-balance math lives in application code (TypeScript service
  layer), never in ad-hoc SQL triggers doing business math and never delegated to an LLM.
- **AI is draft-only**: any AI-generated suggestion (leave correction, appraisal text, policy
  interpretation) is written to `ai_drafts` and requires a human, acting under their own role and
  RLS identity, to authorize it through the normal workflow. AI credentials never have direct
  write access to balances, payroll, approvals, or deletions.
- **Effective-dated policy, not hard-coded law**: every country rule (leave entitlement, notice
  period, overtime, public holidays) is a versioned row in `policy_versions`, valid over a date
  range. Application code resolves "the policy in effect on date X" at read time.
- **Immutability where it matters**: `leave_ledger`, `comp_day_ledger`, `approvals`, and `audit_log`
  are insert-only. Corrections are new offsetting entries, never updates or deletes.
- **Soft delete for business records**: employees, contracts, claims, documents, assets carry
  `deleted_at`/`deleted_by`; hard deletes are reserved for GDPR erasure requests handled by a
  dedicated, audited procedure (see risk register).
- **Least privilege**: salary/bank data, government ID data, and appraisal content each have their
  own RLS-guarded tables, separate from the general employee profile.

Proceed to [01-architecture.md](./01-architecture.md).
