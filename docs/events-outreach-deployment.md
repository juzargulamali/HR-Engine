# Events & Exhibitions, exhibitor history and shared outreach priority: deployment

One additive migration, `supabase/migrations/20261224000100_crm_events_outreach.sql`. **Nothing here was run against a hosted project by Claude** (no hosted SQL, no deployment). The migration is exercised only by the RLS test `packages/rls-tests/test/crm-events-outreach.rls.test.ts` (a throwaway Postgres) and by the local browser flow `apps/web/os-shell-checks/events-outreach-flow.mjs`.

## What it changes, and what it does not
| Added | Notes |
|---|---|
| `crm_organisations.outreach_priority` (1 to 5, null = Unrated) + `outreach_priority_by`, `outreach_priority_at` | Nullable. Every existing account stays Unrated. One value per account, the same for every company. |
| Tables `crm_events`, `crm_event_editions`, `crm_event_observations` | Shared reference data: readable with any Sales grant (`crm_has_any_access()`), written only through functions (no DML grant), audited by `crm_audit_trigger`. |
| `crm_opportunities.event_edition_id` | Nullable, `references crm_event_editions` with NO cascade: an edition with enquiries can never be deleted. Every existing enquiry has no link; **no enquiry is relinked and nothing is guessed from old free text** (`crm_account_profiles.exhibition`, the enquiry location). |
| Nine functions (priority, event, edition, observation, removal, enquiry link) | Granted to `authenticated` only; three helpers are granted to nobody. |

Not touched: `crm_create_opportunity`, `crm_update_opportunity` (so JARVIS and every other caller are unchanged: the link has its own function `crm_set_opportunity_edition`), the enquiry, estimate, follow-up and outreach tables, every existing policy and grant, and the existing account links and duplicate checks.

## Who may do what (decisions to confirm)
- **Outreach priority**: any Sales grant (it is the team's rating). This is wider than the existing "edit a shared organisation" rule (creator / founder / owner of an open enquiry), which is deliberately not applied to this one field. To tighten it, replace the `crm_has_any_access()` check in `crm_set_outreach_priority` with `crm_can_edit_organisation(p_org)`.
- **Add** an event, edition or observation: any Sales grant (needed at a show). **Edit or remove**: the person who added it, or a founder in any company.
- **Link an enquiry to an edition**: the enquiry owner or a founder of its company (the rule editing the enquiry already uses), not on a lost enquiry.
- **Removal**: deleted only when nothing uses it; with linked enquiries or observations it is archived and every link and observation stays.

## Install
1. Apply the migration in the SQL editor (or the usual migration path). It is idempotent where PostgreSQL allows (`if not exists`, `create or replace`).
2. Run `supabase/manual-sql/crm_events_20_verify_readonly.sql`: every row must say OK.
3. Deploy the app. The new tab "Events & Exhibitions" appears for anyone with a Sales grant.

## Rollback
`supabase/manual-sql/crm_events_90_rollback.sql` (export the three tables and the new columns first; it reports how many links and observations it removes). The previous app version ignores the new columns and tables, so the app can be rolled back without the SQL.
