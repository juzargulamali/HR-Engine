# Clients & Agencies (part 1): deployment

One migration, applied by the owner in the SQL Editor of the hosted project. Claude runs no hosted SQL. Additive and idempotent (safe to run twice).

| Order | File | Kind |
|---|---|---|
| 1 | `supabase/manual-sql/crm_accounts_00_preflight_readonly.sql` | read-only: prerequisites; last section B row must say "not applied yet" |
| 2 | `supabase/manual-sql/crm_accounts_05_preservation_check_readonly.sql` | read-only: keep the whole `paste` column |
| 3 | `supabase/migrations/20261219000100_crm_clients_agencies.sql` | the change (writes) |
| 4 | `supabase/manual-sql/crm_accounts_05_preservation_check_readonly.sql` again | compare: only `crm_create_organisation` and the `crm_organisations` columns may differ; `grant:crm_account_profiles` must read `SELECT` only on the hosted project |
| 5 | `supabase/manual-sql/crm_accounts_20_verify_readonly.sql` | read-only: last row must say `OK ... 0 failing` |
| rollback | `supabase/manual-sql/crm_accounts_90_rollback.sql` | writes; deletes account owners, lead sources, roles, countries, websites: export first |

What the migration adds (and why nothing smaller works): `crm_organisations.roles` (one record, several roles; `kind` stays and is derived), `country_code`, `website`, `website_domain`; the per-company table `crm_account_profiles` (account owner, lead source, exhibition); and six functions: `crm_can_edit_organisation`, `crm_create_organisation_profile`, `crm_update_organisation`, `crm_save_account_profile`, `crm_assign_account_owner`, `crm_reassign_follow_up`. It also re-defines `crm_create_organisation` (same signature) so organisations made the old way record their role.

No access is widened. Reads of the new table need a CRM grant for that company. Editing an organisation follows the existing contact rule; assigning an account owner needs the existing `assign_owner` capability (founder implies it) in that company. Being account owner or follow-up assignee confers no extra right. Tests: `packages/rls-tests/test/crm-clients-agencies.rls.test.ts`. Control reference: `docs/enginious-os/modules/sales-clients-and-agencies.md`.
