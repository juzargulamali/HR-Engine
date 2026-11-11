# Chat (Sales groups): owner deployment pack

**Current status (2026-11-10):** PR #73 is **merged on `main` as PR #73** (merge `296b74814b8851c08b20a73b19e82d5eecea167f`, 2026-11-10; required CI `lint-typecheck-test` and `rls-policies` green on head `ab89a98846747dd0f721f52adfd9d1acbde8aeff`). Migration `20261225000100_chat_sales_groups.sql` is **applied on hosted V2 by the owner** (owner-reported: `chat_20_verify_readonly.sql` passed **7 of 7 checks**; Claude ran no hosted SQL and did not see the rows). **Vercel Production is not verified by Claude**. Details: "Owner-run result" below; install order: `docs/launch-refinement-install-order.md` row 22.

One additive migration, no change to any existing table, function, policy or grant. **Nothing here was run against a hosted project by Claude**: the hosted run is the owner's. *(Corrected 2026-11-10: this paragraph used to say "Draft PR. Nothing here has been applied to any hosted project.")*

## What changes
| Item | Detail |
|---|---|
| Migration | `supabase/migrations/20261225000100_chat_sales_groups.sql` (apply after `20261224000100`). New tables `chat_groups`, `chat_messages`, `chat_message_mentions`, `chat_read_state`; eleven functions (five called by the app, six internal). |
| Seed | Three rows in `chat_groups`: `sales_uae` (country AE), `sales_ksa` (SA), `sales_europe` (PL). Each is bound to the ONE active company of its country when the migration runs and again whenever someone lists their groups (`chat_sync_sales_groups`). |
| Not touched | `crm_*`, `proj_*`, `inv_*`, `pbx_*`, HR tables, JARVIS, Projects Discussion. No existing message, enquiry, grant or link is read, moved or rewritten. |
| Privileges | The four tables grant **nothing** to signed-in users or anon. The five app functions are granted to `authenticated` only; the six helpers to nobody. |

## Who is in a group (decision recorded here)
A person is a member of "Sales — UAE / KSA / Europe" exactly when they hold an **active Sales & CRM grant for that company** (`crm_company_grants`, not revoked, profile active). In this system a Sales grant is per person per company and is what People & Access -> Module access edits, so "Sales access AND access to that company" is that one grant. There is no separate company-access table the Sales module does not already use; an HR role scoped to a company, an employee record or another module's grant gives **no** chat access. Someone with Sales grants in all three companies is in all three groups. There is no all-company group and no member list to maintain.

**Mismatch to confirm: the group names are regions, the access rule is per company.** The companies are UAE, KSA and Poland; there is no company called "Europe". "Sales — Europe" is therefore bound to the **Poland** company (the only European company). The binding is by country and only happens when exactly one active company has that country; if a country has none or several the group stays unbound and has **no members** (it never widens access). If a second European company is added later, it will NOT join Sales — Europe automatically: say so and that group's binding (or a second group) is a one-line change.

## Install
1. Apply the migration in the SQL editor (or the usual migration path). It is idempotent where PostgreSQL allows.
2. Run `supabase/manual-sql/chat_20_verify_readonly.sql`: rows 1-4 and 9-11 must say **OK**; the INFO rows list each group's company and its current member count (check that Europe shows the Poland company and that the counts are the people you expect). Row 4 saying UNBOUND means a country has zero or several active companies: tell me which.
3. Deploy the app. The floating Chat button appears for anyone who is a member of at least one group, and for nobody else. Before the migration is applied the button simply does not appear.

## Owner-run result (Enginious HR Engine V2; owner-reported, not seen by Claude)
- **Applied:** `20261225000100_chat_sales_groups.sql`, by the owner, on Enginious HR Engine V2. It was not edited or re-run by the merge, and no further migration was added.
- **Verifier:** `supabase/manual-sql/chat_20_verify_readonly.sql`: **all 7 checks passed** (rows 1 to 4 and 9 to 11), including that signed-in users have no direct access to the chat tables.
- **Groups at verification time (informational rows):** Sales — UAE bound to the UAE company (4 members), Sales — KSA to the KSA company (1), Sales — Europe to the Poland company (1); zero messages.
- **Merge:** PR #73 merged on 2026-11-10 as `296b74814b8851c08b20a73b19e82d5eecea167f`; required CI (`lint-typecheck-test`, `rls-policies`) was green on its head `ab89a98846747dd0f721f52adfd9d1acbde8aeff` (checked on GitHub).
- **Production:** whether the Vercel Production domain serves this merge, and the Chat button and group list as a signed-in person there, are **not verified by Claude** (the owner's check after deployment).

## Rollback
`supabase/manual-sql/chat_90_rollback.sql` (export `chat_messages` first; it reports how many messages it deletes). The previous app version never calls these functions, so the app can be rolled back without the SQL.

## Not in this release (by design)
Direct messages, an all-company Sales group, project groups (planned: the panel is built around a list of groups and a later migration widens `chat_groups.kind`), migrating Projects discussions, external notifications (email or push), message editing or deleting, live push (the panel refreshes every 5 s while a thread is open and every 30 s otherwise).


## Release 2: project groups and the Discussion transfer (migration `20261230000100_chat_project_groups.sql`; install-order row 27)
**Status: not applied anywhere by Claude; hosted status `Unverified`.** Written with the Projects & Tasks Phase 1 draft PR. Rehearsed locally on a real PostgreSQL, including a rerun, a second apply, the rollback and applying it again (`packages/rls-tests/test/chat-project-groups.rls.test.ts`).

### Rollout order (migration first, then the app)
Preview and Production share one database, so the order matters:

1. Run `supabase/manual-sql/chat_project_groups_00_preflight_readonly.sql` (read-only). Rows 1 to 3 must say `OK`; row 4 `not installed yet`. Write down row 6 (messages to copy).
2. Apply `supabase/migrations/20261230000100_chat_project_groups.sql` (changes the database: adds columns, functions and two triggers, creates one group per project and copies the Discussion messages). It is idempotent.
3. Run `supabase/manual-sql/chat_project_groups_20_verify_readonly.sql` (read-only). Every row must say `OK` (rows marked `INFO` report numbers; row 14 should equal preflight row 6 plus anything posted since).
4. **Production keeps working unchanged in between:** the app version without this PR still shows the Discussion tab, and every message posted there is mirrored into the project's group at once. It also starts listing project groups in the Chat panel for members, which is harmless.
5. Check the Preview of the PR signed in (read-only checks first; see the PR's QA list), then merge. From then on the Discussion tab is gone and old Discussion links open the group.
6. Optional, any time after the merge: `select chat_import_project_messages();` as the owner. It returns 0 when nothing is missing. Run the verify file again.

Note: row 3 of the release-1 file `chat_20_verify_readonly.sql` ("no other kind of group") reports extra groups after this migration. That is expected.

### If the app is deployed before the migration
Nothing breaks: the project layout sees that project groups do not exist and keeps the Discussion tab and its page. Project chat appears when the migration is applied.

### How to verify the transfer by hand (read-only)
```sql
-- per project: messages in the old Discussion (not deleted) against copies in Chat; the two numbers must match on every row
select pr.reference, (select count(*) from proj_messages m where m.project_id = pr.id and m.deleted_at is null) as discussion,
       (select count(*) from chat_messages c join chat_groups g on g.id = c.group_id where g.project_id = pr.id and c.source = 'proj_messages') as copied
from proj_projects pr order by 1;
```

### Recovery
* **The migration fails part-way:** it runs in one transaction, so nothing is left behind. Fix the cause and apply again.
* **The verify file reports a missing copy:** run `select chat_import_project_messages();` and verify again. It never duplicates.
* **Project chat must be withdrawn after the cutover:** (1) export the project groups' messages (the query is at the top of the rollback file): messages written in Chat after the cutover exist only there; (2) redeploy the app version before this PR, or leave the new app in place (it shows the Discussion tab again by itself once the functions are gone); (3) run `supabase/manual-sql/chat_project_groups_90_rollback.sql`; (4) apply `20261225000100_chat_sales_groups.sql` again to restore the release-1 functions for the Sales groups. The Discussion tables were never changed, so the old tab shows every message it had. Messages written only in Chat are not put back into the Discussion.
* **Founders who relied on reading a project's Discussion without being on its team** no longer see its conversation. The fix is to add them to the project (Manage project, People & access), not to widen the rule.
