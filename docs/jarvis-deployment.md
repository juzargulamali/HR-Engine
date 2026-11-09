# JARVIS parts 1 and 2 (and the confirmation boundary): deployment guide (owner-run)

Migration `supabase/migrations/20261223000100_jarvis_platform.sql`, owner pack `supabase/manual-sql/jarvis_*`. **Status, dated 2026-11-09: nothing applied to any hosted project, nothing enabled in Production, no live AI provider called.** The pack was rehearsed on a throwaway local database (below). Setup and environment: [`jarvis-setup.md`](./jarvis-setup.md). Reference: [`enginious-os/modules/jarvis.md`](./enginious-os/modules/jarvis.md).

## What the migration does

Additive and idempotent: it **creates** six tables (`jarvis_settings`, `jarvis_pilot_users`, `jarvis_pilot_companies`, `jarvis_action_ledger`, `jarvis_usage` and the empty `jarvis_proof_key`) and fourteen functions: `jarvis_my_access`, `jarvis_usage_take`, `jarvis_create_enquiry` (part 1); and, **added to the same migration file in place by part 2** (the file was never applied on any hosted project, so there is no second migration), four internal helpers (`jarvis_ledger_json`, `jarvis_ledger_enter`, `jarvis_ledger_done`, `jarvis_ledger_fail`: not callable by signed-in users) and one wrapper per further write action (`jarvis_register_organisation`, `jarvis_update_enquiry`, `jarvis_change_stage`, `jarvis_record_meeting`); and, for the **confirmation boundary**, three proof functions (`jarvis_hmac_sha256`, `jarvis_verify_proof`, `jarvis_set_proof_key`). It replaces and alters **nothing that exists**: every write is made by an existing function (`crm_create_opportunity`, `crm_create_organisation_profile`, `crm_update_opportunity`, `crm_move_stage`, `crm_add_activity`, `crm_create_follow_up`), called unchanged under the caller's own identity by the wrapper. The ledger gains one column, `result_extra` (ids only). Draft reply and help have no database part at all. After it is applied **JARVIS is OFF for everyone** (`enabled = false`, `writes_enabled = false`, no pilot users): nothing changes for anyone until the owner switches the pilot on.

**The confirmation boundary (why there is an owner step).** There are **two distinct artefacts**. The browser holds only a **review token** (made at proposal time with a *review key* that the database never has; no wrapper accepts it). The **database proof** is made by the app server alone, inside the explicit confirmation request, after it has re-verified the review token, the person's access and the exact values; it is sent to the wrapper in that same request, lives about two minutes and is never returned to the browser. Every write wrapper verifies that proof inside the database: a keyed MAC (HMAC-SHA256) over the signed-in person, company, action, target, record version, expiry, confirmation id and the SHA-256 of the exact payload text (full description: [`enginious-os/modules/jarvis.md`](./enginious-os/modules/jarvis.md) section 6.1). A confirmation id and hash that someone makes up, or the review token the browser holds, are therefore worth nothing: the call is refused and nothing is written. The register-organisation wrapper reads its duplicate acknowledgement only from the verified payload and checks it against the organisations that exist at execution time. The database holds **only the derived proof key** in `jarvis_proof_key` (`HMAC-SHA256(secret, 'JARVIS-PROOF-KEY-V1')`, 64 hex characters; no policy and no privilege for any API role; read only by the database's own functions; neither the root secret nor the review key is stored). **The migration creates that table EMPTY and every wrapper FAILS CLOSED until the owner sets the key** (step 6 below): after applying, JARVIS is off anyway, and even with the pilot switched on nothing can be saved until the key matches the app. The MAC is built on the built-in `sha256(bytea)` (PostgreSQL 11+): **no `pgcrypto` or other extension is required** (the preflight checks `sha256` exists).

Security of the new tables: row level security on; the only policy is "a person reads their **own** ledger rows"; no write policy exists on any table, so nobody can write directly (writes happen only inside the definer functions); `anon` and `public` have no privilege; signed-in users may only `select` the ledger; `jarvis_proof_key` has no privilege for `public`, `anon`, `authenticated` or `service_role` and no policy at all. The settings, allowlist and usage tables cannot be read by signed-in users at all (a person learns their own access only through `jarvis_my_access()`, which returns booleans).

## Order (SQL Editor of the isolated V2 project; only the migration and the rollback change the database)

| Order | File | Kind and what it must say |
|---|---|---|
| 1 | `supabase/manual-sql/jarvis_00_preflight_readonly.sql` | read-only. Every section B row must say OK and "applied already?" must say "OK - not applied yet". Section C is information (active Sales grants, enquiries, companies with Sales settings). |
| 2 | `supabase/manual-sql/jarvis_05_preservation_check_readonly.sql` | read-only. **Run it twice** before the migration; the two results must be identical. Keep the result. |
| 3 | `supabase/migrations/20261223000100_jarvis_platform.sql` | **CHANGES the database** (adds objects only). Safe to run twice. |
| 4 | `supabase/manual-sql/jarvis_05_preservation_check_readonly.sql` again | read-only. Compare with step 2 row by row: identical EXCEPT the twenty-eight rows marked `INTENDED TO CHANGE` (the six new tables and fourteen new functions: absent before, present after; and the eight "definition of ..." rows for the five wrappers and the three proof/derivation helpers, which show a fingerprint only after). Every existing `crm_*` function listed (including `crm_create_opportunity`, `crm_update_opportunity`, `crm_move_stage`, `crm_add_activity`, `crm_create_follow_up`, `crm_create_organisation_profile`), and the enquiry, follow-up, activity, event, organisation, account-profile, grant, counter and settings fingerprints must be unchanged. |
| 5 | `supabase/manual-sql/jarvis_20_verify_readonly.sql` | read-only. Every row that is not marked INFORMATION must say OK (row level security on all six tables; no privilege for `anon`/`public`; signed-in users only `select` on the ledger; the proof key table has no privilege for anyone and no policy; exactly one policy on the jarvis tables; the unique confirmation id; the wrappers are definer with a fixed search path; **signed-in users can execute exactly the seven expected `jarvis_*` functions and no `jarvis_*` function is callable by `anon` or `public`**; the helpers and the proof functions are NOT executable by them; **every write wrapper calls `jarvis_verify_proof` with its own action id before any lock, ledger row or write**; **every wrapper takes exactly the seven signed arguments (no unsigned write parameter; the old `p_ack` is gone) and the register wrapper reads its acknowledgement from the verified payload only**; **no `jarvis_*` function mentions the review key, and the stored key is a 64-hex derived proof key**; each wrapper calls its existing function(s) (definition text checked); the ledger has no text column; one settings row). The INFORMATION rows show the switches (both `false` right after the first apply), the pilot counts, the ledger counts and **the proof key: "not set"** until step 6. |
| 6 | **OWNER STEP: set the proof key** (below) | **CHANGES the database** (one row). One line, run once, with the SAME value as `JARVIS_CONFIRMATION_SECRET`. |
| 7 | `supabase/manual-sql/jarvis_20_verify_readonly.sql` again | read-only. Same rows all OK, and the INFORMATION row now says `set (since <date> Dubai)`. The value is never shown. |
| rollback | `supabase/manual-sql/jarvis_90_rollback.sql` | **CHANGES the database.** Drops every `jarvis_*` function and the six tables, **the proof key included** (the secret itself stays in the app's environment; after a re-apply the owner sets the key again). **Refuses to run while `jarvis_action_ledger` has rows** until you export it (it is the audit record) and add the one line it names above `begin;`. Safe to run twice. Enquiries created through JARVIS stay exactly as they are. |

**Send back:** the full results of steps 1, 2 and 4 (together), 5 and 7, and the rollback if you run it. (Never send the secret.)

## Follow-up for a project where `20261223000100` is ALREADY applied: the four ledger helpers (corrective migration `20261223000200`)

**What the first hosted run found.** The read-only verifier (`jarvis_20_verify_readonly.sql`) said `FAIL - callable or missing` for `jarvis_ledger_json`, `jarvis_ledger_enter`, `jarvis_ledger_done` and `jarvis_ledger_fail`, although all four exist. The diagnostic `jarvis_10_execute_privileges_readonly.sql` showed why: on a Supabase project every new function in `public` is granted `EXECUTE` to `anon`, `authenticated` and `service_role` automatically (default privileges of `postgres` and `supabase_admin`). `20261223000100` took that back from `public`, `anon` and `authenticated` for the four helpers, and from `service_role` for the three proof functions, but **not from `service_role` for the four helpers**: one explicit ACL entry each, granted by `postgres`. Nothing else was wrong (the seven wrappers, `jarvis_my_access` and `jarvis_usage_take` are executable by `authenticated` only on purpose; the proof functions are closed to everyone). A plain test database has no such default privileges, so the earlier local rehearsal could not show it. Impact before the fix: the helpers read `auth.uid()`, which is null for a service-role call, so `jarvis_ledger_enter` refuses and `_done`/`_fail` only update rows owned by `auth.uid()`; it was a verifier failure against the rule "internal helpers are not callable by the platform service role", not a data exposure.

**What `20261223000200_jarvis_helper_privileges.sql` does.** Privileges only (no table, function body or data; **the applied migration is not edited**). For each of the four helpers it revokes `EXECUTE` from `PUBLIC`, `anon`, `authenticated`, `service_role` and any other non-owner role in the ACL, then checks the result and **aborts the whole migration** if any role other than the owner can still execute it (for example a grant made by a different grantor, which it names). It does not touch the seven wrappers, `jarvis_my_access`, `jarvis_usage_take`, the proof functions, the tables or the platform's global default privileges. Safe to run twice. It never sets the proof key and never enables JARVIS.

| Order | File | Kind and what it must say |
|---|---|---|
| a | `supabase/manual-sql/jarvis_10_execute_privileges_readonly.sql` | read-only (optional, before): section 2 lists `service_role` on the four helpers. |
| b | `supabase/manual-sql/jarvis_05_preservation_check_readonly.sql` | read-only. Run before and after: identical (this migration changes ACLs only). |
| c | `supabase/migrations/20261223000200_jarvis_helper_privileges.sql` | **CHANGES the database** (privileges only). Safe to run twice. |
| d | `supabase/manual-sql/jarvis_20_verify_readonly.sql` | read-only. Every row that is not INFORMATION must now say OK (the four helper rows included). |
| e | `supabase/manual-sql/jarvis_10_execute_privileges_readonly.sql` again | read-only. Every row for the four helpers names only `postgres`; the seven wrappers, `jarvis_my_access` and `jarvis_usage_take` still name `authenticated` (and the same other roles as before). |

If your project does **not** have `20261223000100` applied yet, apply both migrations in order (the second is then a no-op safety net). The proof key and JARVIS switches are separate owner steps and stay as they were.

**Tested** (`packages/rls-tests/test/jarvis-helper-privileges.rls.test.ts`, 12 tests, real Postgres with the platform's default function privileges recreated): the defect is reproduced with `20261223000100` alone (service role can run exactly the four helpers; the verifier fails on exactly those four; a service-role call reaches the helper and is refused only for "Not signed in"); after the fix nobody but the owner can run them and direct calls by `service_role`, `anon` and `authenticated` are refused by privilege (`42501`); the verifier has no FAIL; the ACLs of the authorised functions and the proof functions are byte-identical; it is idempotent; the diagnostic is clean; and an eligible pilot person still creates an enquiry through the authorised wrapper with a valid proof (confirmed ledger row; the same proof replays the original result). The tests fail against a no-op version of the migration.

## OWNER STEP: set (and rotate) the proof key

The database must hold the key derived from **the same value** as the app's `JARVIS_CONFIRMATION_SECRET` (at least 32 random characters; `jarvis-setup.md` section 1). There is **one secret and nothing new to keep**: the app derives two keys from it (a review key it keeps to itself and the proof key), and the line below derives the same proof key inside the database and stores **only that derived key**, never the secret itself. Generate the secret once (`openssl rand -base64 48`), put it in Vercel as a Sensitive variable, and give it to the database with this one line in the SQL Editor (run as the project owner, `postgres`; `anon`, `authenticated` and the service role cannot run it):

```sql
select jarvis_set_proof_key('<PASTE THE SAME VALUE AS JARVIS_CONFIRMATION_SECRET HERE>');
```

* The value **never goes in Git, a log, a screenshot, a chat or an email**. The SQL Editor keeps a query history: delete that history entry afterwards, and do not paste the line anywhere else. Nothing in this repository holds a real value (the line above is a placeholder).
* Check with `jarvis_20_verify_readonly.sql` (INFORMATION row: `set (since ...)`). The key itself can never be read back through any query a signed-in person or the API can run.
* **Rotation** is unchanged: (1) choose a new value; (2) run the line above with the new value **and** change `JARVIS_CONFIRMATION_SECRET` in Vercel to the same value, then redeploy; do both in one sitting. A review token issued under the old value no longer verifies (a card that was open must be reviewed again; it would expire within 15 minutes anyway); a database proof lives only about two minutes (`JARVIS_PROOF_TTL_SECONDS`, default 120). Until the database and the app hold the same value JARVIS **fails closed** with a plain message ("JARVIS cannot save changes right now" or "review again") and nothing is written; ordinary Sales & CRM is not affected. Order does not matter for safety, only for how long people see the message.
* **To switch every JARVIS write off at once** without touching anything else: `delete from jarvis_proof_key;` (fails closed; set the key again to resume), or use the switches below.
* If the key is wrong or missing, the symptoms are: a review that says "This confirmation is not valid. Review the details again." every time (the app and the database hold different values) or "JARVIS cannot save changes right now." (no key in the database). Fix by repeating the step with the right value.

## Release order with the app: database first, app second, pilot last

1. Apply and verify the migration (steps 1 to 5), then set the proof key (step 6) and verify again (step 7). JARVIS is still off.
2. Deploy the app. **The app must show JARVIS as unavailable and everything else normal when the migration is not applied**: with the tables missing, `jarvis_my_access` does not exist (PostgREST `PGRST202`), the layout draws no launcher, every JARVIS call is refused as unavailable, and nothing else is affected (tested: `create-from-brief.test.ts`, "when the migration is not applied"). So deploying the app first is also safe; JARVIS simply stays invisible until the database step is done. After the migration is applied the function may need a few seconds to appear in the API cache.
3. Set the environment variables for the environment you are piloting in (`jarvis-setup.md`, Preview first); `JARVIS_CONFIRMATION_SECRET` must be the value stored in the database in step 6.
4. Switch the pilot on (below). Production stays off until the owner decides.

## Pilot controls (the exact toggles; run as the owner in the SQL Editor)

```sql
-- See the current state
select * from jarvis_settings;
select u.user_id, p.email, u.note from jarvis_pilot_users u join profiles p on p.id = u.user_id order by p.email;
select company_id from jarvis_pilot_companies;

-- Switch ON (global switch + writes) and add named people. The person ALSO needs an active Sales grant for a company.
update jarvis_settings set enabled = true, writes_enabled = true, updated_at = now();
insert into jarvis_pilot_users (user_id, note) select id, 'pilot' from profiles where email = 'someone@example.com' on conflict (user_id) do nothing;

-- Optional: only these companies (while this list is empty there is NO company restriction)
insert into jarvis_pilot_companies (company_id) values ('<company id>') on conflict do nothing;

-- Writes off, read-only help stays (creating is refused with a clear message)
update jarvis_settings set writes_enabled = false, updated_at = now();

-- Remove one person / everything off at once
delete from jarvis_pilot_users where user_id = '<user id>';
update jarvis_settings set enabled = false, writes_enabled = false, updated_at = now();
```

A person sees the launcher only with **all** of: `enabled = true`, a `jarvis_pilot_users` row, an active profile, an active Sales grant for a company the pilot covers, and the environment ready (key, confirmation secret, not `JARVIS_DISABLED`); saving also needs the database proof key (step 6). The server re-checks all of it on every request.

## Hosted V2 result (owner-reported, reviewed by QA from the exported SQL results)

The owner applied `20261223000200_jarvis_helper_privileges.sql` on hosted Enginious HR Engine V2 (after `20261223000100`). QA reviewed the exported results:

* The read-only verifier (`jarvis_20_verify_readonly.sql`) returned **70 OK, 0 failures and 4 informational rows**.
* `jarvis_ledger_json`, `jarvis_ledger_enter`, `jarvis_ledger_done` and `jarvis_ledger_fail` **deny EXECUTE to `service_role`, `authenticated`, `anon` and `PUBLIC`**.
* At verification time both switches (`enabled`, `writes_enabled`) were off, there were zero pilot users, the proof key was unset and the ledger was empty.

**This closes the hosted ledger-helper privilege issue.** It does **not** verify the hosted JARVIS workflow: nothing has been enabled, no proof key has been set, no live provider call has been made from hosted V2, and no pilot has run. Those remain **unverified**. The Production project is untouched.

## Review of the remaining service_role grants (read-only review; nothing changed)

After the fix, `service_role` still holds the platform-default `EXECUTE` (granted by `postgres` through the default function privileges) on nine functions, because `20261223000100` granted them to `authenticated` only and did not revoke the default for the service role. The question is whether anything needs it. Evidence, from the code at head `e8dfcf5`:

* **The only service-role client in the application** is `createAdminClient()` (`apps/web/src/lib/supabase/admin.ts:14-18`, `SUPABASE_SERVICE_ROLE_KEY`). Its callers (`app/api/cron/leave-accrual/route.ts:83`, `comp-day-expiry/route.ts:29`, `document-expiry/route.ts:29`, `recovery-windows/route.ts:31`, `app/api/ai/detect-balance-discrepancies/route.ts:36`, `lib/crm/upload-cleanup.ts:18`, `lib/crm/quotations/pin-assets.ts:28,32`) call none of the JARVIS functions: no file under `app/api`, `lib/crm` or `lib/actions` other than `lib/actions/jarvis.ts` mentions JARVIS at all, and `vercel.json:2-8` lists no JARVIS job.
* **Every JARVIS database call uses the signed-in person's own session client.** `lib/jarvis/runtime.ts:19,23` builds it with `createClient()` from `lib/supabase/server.ts:30-32` (anon key plus the person's cookie session, so the database role is `authenticated`). The dispatcher states there is no service-role client in JARVIS (`lib/jarvis/dispatcher.ts:21`), and `lib/jarvis/create-from-brief.test.ts:554-556` fails the build if any JARVIS source file (including `components/jarvis` and `lib/actions/jarvis.ts`) mentions `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `supabase/admin` or `createAdminClient`.
* **Scripts and tests** call the functions as the owner or as `authenticated`: `apps/web/os-shell-checks/seed/jarvis.sh:16,23` (`jarvis_set_proof_key` as the database owner, reads as `set local role authenticated`), `jarvis-flow.mjs:256,259-262,287-291,331-335` and `jarvis-sales-flow.mjs:259,306-313` (the person's API token or `authenticated`). No CI workflow or job in the repository calls them.
* **Other SQL**: no other migration or function calls a `jarvis_*` entry point; the wrappers call the helpers as their owner.

| Function (exact signature) | Called from (file:line) | Client and database role | Service-role grant |
|---|---|---|---|
| `jarvis_my_access(uuid)` | `lib/jarvis/dispatcher.ts:62` (every request), `:215`, `:224` (launcher state; called from `app/(app)/layout.tsx:103` via `getLauncherState`) | person's session, `authenticated` | **unnecessary** |
| `jarvis_usage_take(integer)` | `lib/jarvis/dispatcher.ts:76` | person's session, `authenticated` | **unnecessary** |
| `jarvis_create_enquiry(uuid, uuid, text, integer, bigint, text, text)` | `lib/jarvis/sales/enquiry-create-from-brief.ts:181` | person's session, `authenticated` (server actions `lib/actions/jarvis.ts:37,55`) | **unnecessary** |
| `jarvis_register_organisation(uuid, uuid, text, integer, bigint, text, text)` | `lib/jarvis/sales/organisation-register.ts:150` | same | **unnecessary** |
| `jarvis_update_enquiry(uuid, uuid, text, integer, bigint, text, text)` | `lib/jarvis/sales/enquiry-update.ts:123` | same | **unnecessary** |
| `jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text)` | `lib/jarvis/sales/enquiry-stage.ts:111` | same | **unnecessary** |
| `jarvis_record_meeting(uuid, uuid, text, integer, bigint, text, text)` | `lib/jarvis/sales/meeting-record.ts:116` | same | **unnecessary** |
| `jarvis_ledger_json`, `_enter`, `_done`, `_fail` | only inside the wrappers (SQL, run as the owner) | n/a | already revoked (verified on hosted V2) |
| `jarvis_hmac_sha256`, `jarvis_verify_proof`, `jarvis_set_proof_key` | only inside the wrappers; the setter is run by the owner | n/a | already revoked |

**Classification and its limit.** In the repository, all nine remaining grants are **unnecessary**: no code path, route, job or script invokes them with the service-role credential, the design forbids a service-role client for JARVIS, and the entry-point server actions authenticate the person first (`lib/jarvis/dispatcher.ts:58-62`). That a function refuses a service-role call because `auth.uid()` is null is **not** the reason; the reason is that nothing calls them. What the repository cannot show is a caller that lives only on the hosted project (a Supabase Edge Function, a `pg_cron` job, an external integration holding the service key). Treat that as **unverified until the owner runs the read-only check below**; if it returns nothing, the grants are unnecessary on hosted too.

```sql
-- READ-ONLY. Anything outside the repository that could call JARVIS with the service role.
select jobid, jobname, left(command, 120) as command_start from cron.job where command ilike '%jarvis%';   -- scheduled jobs (skip if the cron schema is absent)
select count(*) as functions_other_than_jarvis_calling_jarvis from pg_proc p where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace) and p.proname not like 'jarvis\_%' and p.prosrc ilike '%jarvis\_%';
```
(Edge Functions are listed in the Supabase dashboard under Edge Functions; the repository has none.)

**Recommendation.** Revoke `EXECUTE` from `service_role` on the seven wrappers, `jarvis_my_access` and `jarvis_usage_take`, as a **separate, targeted migration** (not part of this documentation pass; nothing was changed): `authenticated` stays, `anon` and `PUBLIC` stay closed. It is low risk, tightens the boundary to "signed-in people only" and removes a latent path that depends on `auth.uid()` being null as the only wall. Outline: `20261223000300_jarvis_entry_point_privileges.sql`, privileges only, idempotent, aborting if `service_role` (or any role other than the owner and `authenticated`) can still execute them; tests in the same style as `jarvis-helper-privileges.rls.test.ts` (default function privileges recreated: before = service role can execute the nine; after = only the owner and `authenticated` can, ACLs of the helpers and proof functions byte-identical, the verifier all OK, a valid proof still creates an enquiry through the wrapper, direct service-role calls refused with `42501`, idempotent, preservation check identical); plus two verifier rows (`service_role` cannot execute any `jarvis_*` function; `authenticated` executes exactly the seven wrappers' set) so a future `jarvis_*` function that inherits the platform default is caught. Apply only after the owner's read-only check above is clean.

## One-user Sales & CRM pilot: checklist for review (fictional data; writes OFF for the first access check)

This is a proposal for the owner to review; none of it has been run on hosted. Never put a secret value in a ticket, chat or screenshot.

**A. Prerequisites for the access check (writes off)**
1. Both migrations applied and the verifier clean on V2 (done, section "Hosted V2 result").
2. A Preview deployment of the `feat/jarvis` head pointing at **V2** (never Production data), with `ANTHROPIC_API_KEY` (a separate low-spend key) and `JARVIS_CONFIRMATION_SECRET` (32+ random characters) set for Preview only and marked Sensitive; `JARVIS_DAILY_LIMIT_PER_USER` small (for example 10); `JARVIS_PROVIDER` unset; `JARVIS_DISABLED` unset. The launcher needs the provider key and the secret in the app environment; the database proof key may stay unset for this check (saving is not tested here).
3. Three accounts (people with test purposes, no real client data used): **Pilot A** (active Sales grant for one company), **Non-pilot B** (also an active Sales grant, to show the allowlist, not the grant, is the gate), optionally **C** (on the allowlist but no Sales grant).

**B. Steps (owner runs the SQL in the V2 SQL Editor)**
1. Baseline, switches off: `select * from jarvis_settings;` shows `enabled = false, writes_enabled = false`; `select count(*) from jarvis_pilot_users;` is 0; `select count(*) from jarvis_action_ledger;` is 0. Sign in as A and as B: **no** "Open JARVIS" launcher for either.
2. Switch on for one person, writes off, one company only: `update jarvis_settings set enabled = true, writes_enabled = false, updated_at = now();` then add A to `jarvis_pilot_users` and the one company to `jarvis_pilot_companies` (statements in "Pilot controls" above).
3. Reload as **A**: the "Open JARVIS" launcher is visible; the company picker offers only the pilot company. Open the panel: with writes off, asking it to create an enquiry from a fictional brief is **refused with the "cannot create or change records right now" message** (no review card). Check afterwards: ledger count still 0, enquiry count unchanged. (Optional read-only question to the help action uses one provider call.)
4. Reload as **B** (and C if used): **no launcher**. Optional read-only proof as the owner: in a transaction, `set local role authenticated;` with B's claims, `select * from jarvis_my_access();` returns `is_available = false`, then `rollback`.
5. Switch it off: `update jarvis_settings set enabled = false, writes_enabled = false, updated_at = now();` reload as A: the launcher is gone. (Also available: remove A with `delete from jarvis_pilot_users where user_id = '<id>';`, or set `JARVIS_DISABLED=1` in Vercel; both are enforced on the server for every request.)
6. Confirm nothing was written: ledger count 0, no new enquiries, `jarvis_usage` shows at most A's own counter row.

**C. Remaining prerequisites for a separate confirmed-write test (not part of the access check)**
1. The owner step: set the database proof key with the same value as `JARVIS_CONFIRMATION_SECRET` (`jarvis-deployment.md`, "OWNER STEP"); the verifier's informational row must say `set`; until then every write fails closed.
2. `writes_enabled = true` for the one pilot user and the one pilot company only; the daily limit and the Anthropic spend cap in place.
3. Fictional organisations (a client and an agency) and, if needed, one fictional enquiry created beforehand in a test company or clearly labelled as test, so no real record can be touched; the test brief is the fictional one used locally.
4. Start with **one** action (create an enquiry from a brief): expected 0 enquiries before pressing Create and exactly 1 plus one `done` ledger row after, with the same checks as the local run. The other actions stay out of the first write test.
5. A cleanup plan: JARVIS cannot delete, so the test enquiry is closed or marked as test through the normal Sales screens, and the ledger is exported (it is the audit record) before any rollback.
6. A decision on Anthropic's retention and training terms (unverified) and a separate owner approval before any real client brief.
7. The app and the database must be at matching heads: the Preview built from the verified `feat/jarvis` head. The recommended revoke migration above is independent and can be applied before or after, but not during the test.

## Rehearsal on a throwaway local database (what the RLS suite and the local walk-through did)

Run on a throwaway Postgres built from every migration (no hosted project): preflight, preservation (twice), migration applied **twice**, the proof key set, preservation after (only the twenty-eight intended rows differ, the existing `crm_*` functions byte-identical), verify (every row OK), the behaviour tests (`jarvis.rls.test.ts` 30, `jarvis-actions.rls.test.ts` 39 and `jarvis-proof.rls.test.ts` 105 RLS tests, including 12 parallel calls with one confirmation id doing the work exactly once for each wrapper, the review token refused as a proof by every wrapper, and the register-organisation acknowledgement checked in SQL), rollback **refused** while the ledger had rows, rollback with the confirmation line **twice** (the proof key is gone with the table), and the migration **re-applied** (default OFF again, key not set). Result: see `docs/enginious-os/06-change-log.md` for the run and counts. **Hosted V2: not applied, not verified.**

## Rollback notes

After the rollback the app shows JARVIS as unavailable (same as before the migration). The ledger is lost with the tables: export it first (the script enforces this). Pilot rows and counters are not needed afterwards. **The proof key stored in the database is removed too**; the secret in Vercel is untouched, and after a later re-apply the owner sets the key again (step 6).
