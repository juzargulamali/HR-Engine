# Events & Exhibitions, exhibitor history and shared outreach priority: deployment

**Current status (2026-11-10):** PR #72 is **merged on `main` as PR #72** (merge `0d598a9574ad5464573325f2b8200c151083b7e9`, 2026-11-10; required CI `lint-typecheck-test` and `rls-policies` green on head `9c316bba406d6d135f7e3f83b11bbcd9622f9f87`). Migration `20261224000100_crm_events_outreach.sql` is **applied on hosted V2 by the owner** (owner-reported: the corrected `crm_events_20_verify_readonly.sql` passed **13 of 13 checks**; Claude ran no hosted SQL and did not see the rows). **Vercel Production is not verified by Claude**. Details and dates: "Owner-run result" below; install order: `docs/launch-refinement-install-order.md` row 21.

One additive migration, `supabase/migrations/20261224000100_crm_events_outreach.sql`. **Nothing here was run against a hosted project by Claude** (no hosted SQL, no deployment): the hosted run is the owner's. Claude's own evidence is the RLS test `packages/rls-tests/test/crm-events-outreach.rls.test.ts` (a throwaway Postgres) and the local browser flow `apps/web/os-shell-checks/events-outreach-flow.mjs`.

## What it changes, and what it does not
| Added | Notes |
|---|---|
| `crm_organisations.outreach_priority` (1 to 5, null = Unrated) + `outreach_priority_by`, `outreach_priority_at` | Nullable. Every existing account stays Unrated. One value per account, the same for every company. |
| Tables `crm_events`, `crm_event_editions`, `crm_event_observations` | Shared reference data: readable with any Sales grant (`crm_has_any_access()`), written only through functions (no DML grant), audited by `crm_audit_trigger`. |
| `crm_opportunities.event_edition_id` | Nullable, `references crm_event_editions` with NO cascade: an edition with enquiries can never be deleted. Every existing enquiry has no link; **no enquiry is relinked and nothing is guessed from old free text** (`crm_account_profiles.exhibition`, the enquiry location). |
| Ten functions (priority, event, edition, archive event, archive edition, calendar import, observation, enquiry link) | Granted to `authenticated` only; three helpers are granted to nobody. |

Not touched: `crm_create_opportunity`, `crm_update_opportunity` (so JARVIS and every other caller are unchanged: the link has its own function `crm_set_opportunity_edition`), the enquiry, estimate, follow-up and outreach tables, every existing policy and grant, and the existing account links and duplicate checks.

## Who may do what (decisions to confirm)
- **Outreach priority**: any Sales grant (it is the team's rating). This is wider than the existing "edit a shared organisation" rule (creator / founder / owner of an open enquiry), which is deliberately not applied to this one field. To tighten it, replace the `crm_has_any_access()` check in `crm_set_outreach_priority` with `crm_can_edit_organisation(p_org)`.
- **Add** an event, edition or observation: any Sales grant (needed at a show). **Edit or archive**: the person who added it, or a founder in any company. **Import events** (bulk-add events and editions): any Sales grant.
- **Link an enquiry to an edition**: the enquiry owner or a founder of its company (the rule editing the enquiry already uses), not on a lost enquiry.
- **Archive is the only removal**: nothing is deleted from Sales (no delete grant, no delete function). Archiving always gives the same result whatever is attached, keeps every edition, observation and enquiry link, and an archived entry is not offered for new enquiry links. There is no un-archive yet (decision below).
- **Import**: one function (`crm_import_events`) classifies and, only when no row needs correcting, writes the whole file in one transaction. It never overwrites dates, never reopens an archived record and never merges distinct events; a row is "already present" only when its dates AND country, city and venue match (otherwise it is flagged for review and blocks the file); re-importing a file adds nothing. It is part of this same migration (still not applied anywhere), so the install and the check below are unchanged: no extra owner step.

## Install
1. Apply the migration in the SQL editor (or the usual migration path). It is idempotent where PostgreSQL allows (`if not exists`, `create or replace`).
2. Run `supabase/manual-sql/crm_events_20_verify_readonly.sql`: every row must say OK.
3. Deploy the app. The new tab "Events & Exhibitions" appears for anyone with a Sales grant.

## Rollback
`supabase/manual-sql/crm_events_90_rollback.sql` (export the three tables and the new columns first; it reports how many links and observations it removes). The previous app version ignores the new columns and tables, so the app can be rolled back without the SQL.

## Event with its first edition (later migration `20261227000100_crm_event_first_edition.sql`; install-order row 24)
**Status: applied on the hosted Supabase project (shared by Preview and Production) by the owner, 2026-11-11 (owner-run, owner-reported: preflight, migration and verifier passed as expected; Claude ran no hosted SQL and did not see the rows).** Details: `docs/pr79-owner-rollout.md` section 5. (Until then this line read "not applied anywhere by Claude; hosted status `Unverified`".) Written 2026-11-11 with the change on branch `claude/events-first-edition-calendar`.

What it is: one new function, `crm_add_event_with_edition(name, kind, start, end, city, country, venue, website, event note, edition note)`, returning the two new ids. It checks both parts, then calls the existing `crm_save_event` and `crm_save_edition` inside the one call, so a refused edition leaves no event behind. It changes no table, column, policy, grant or existing function. Why a new function was needed: the two existing saves are separate calls from the app, each its own transaction, and the transactional `crm_import_events` has different rules (a country is required, there is no event type, rows are classified against existing editions and answered with a preview).

1. Run `supabase/manual-sql/crm_event_first_edition_00_preflight_readonly.sql` (read-only): rows 1 to 3 must say OK.
2. Apply `supabase/migrations/20261227000100_crm_event_first_edition.sql` (idempotent: `create or replace`).
3. Run `supabase/manual-sql/crm_event_first_edition_20_verify_readonly.sql` (read-only): rows 1 to 4 must say OK.
4. Deploy the app (either order is safe; before the migration, Add event answers "not available yet ... Nothing was saved").

Rollback: `supabase/manual-sql/crm_event_first_edition_90_rollback.sql` drops the function and deletes no data. The previous app does not call it.

## Owner-run result (Enginious HR Engine V2)
- **Applied:** `20261224000100_crm_events_outreach.sql` as it stands at commit `fd1e00d`, applied by the owner to Enginious HR Engine V2 (2026-11-10). It is not edited or re-run by this note, and no further migration was added.
- **First verifier run** (`crm_events_20_verify_readonly.sql` from `fd1e00d`): every row passed except row 5, the outreach priority check.
- **Row 5 was a false failure of the verifier, not of the database.** A separate read-only query on V2 confirmed that `crm_organisations.outreach_priority` is `smallint` and that its constraint is validated:
  `CHECK (((outreach_priority IS NULL) OR ((outreach_priority >= 1) AND (outreach_priority <= 5))))`.
  The old row looked for the literal text `BETWEEN 1 AND 5`, but PostgreSQL never prints BETWEEN: it shows the equivalent comparisons.
- **Fix (verifier only):** row 5 now requires the constraint to be **validated** and compares its whole definition (case, spaces and brackets ignored) with the form PostgreSQL prints, or the BETWEEN form. A different range, a missing NULL case or an unvalidated constraint still fails. Checked against the exact definition above on a local database built from the same migration: row 5 says OK.
- **Corrected verifier, second run (owner-reported):** the owner ran the corrected `crm_events_20_verify_readonly.sql` on V2: **all 13 checks passed**, including the outreach priority constraint and the permission checks (select-only tables, nothing deletable, helpers not callable), and none of the existing enquiries was relinked. Claude did not run it and did not see the rows.
- **Merge:** PR #72 merged on 2026-11-10 as `0d598a9574ad5464573325f2b8200c151083b7e9`; required CI (`lint-typecheck-test`, `rls-policies`) was green on its head `9c316bba406d6d135f7e3f83b11bbcd9622f9f87` (checked on GitHub).
- **Production:** whether the Vercel Production domain serves this merge is **not verified by Claude**.
- *Historical note (before the second run, kept for the record):* this line used to read "To do (owner): run the corrected verifier on V2 once more ... This PR stays unmerged until that is confirmed". That is done.

