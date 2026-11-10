# Chat (Sales groups): owner deployment pack

Draft PR `feat/app-chat`. **Nothing here has been applied to any hosted project.** One additive migration, no change to any existing table, function, policy or grant.

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

## Rollback
`supabase/manual-sql/chat_90_rollback.sql` (export `chat_messages` first; it reports how many messages it deletes). The previous app version never calls these functions, so the app can be rolled back without the SQL.

## Not in this release (by design)
Direct messages, an all-company Sales group, project groups (planned: the panel is built around a list of groups and a later migration widens `chat_groups.kind`), migrating Projects discussions, external notifications (email or push), message editing or deleting, live push (the panel refreshes every 5 s while a thread is open and every 30 s otherwise).
