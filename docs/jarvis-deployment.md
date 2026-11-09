# JARVIS parts 1 and 2 (and the confirmation boundary): deployment guide (owner-run)

Migration `supabase/migrations/20261223000100_jarvis_platform.sql`, owner pack `supabase/manual-sql/jarvis_*`. **Status, dated 2026-11-09: nothing applied to any hosted project, nothing enabled in Production, no live AI provider called.** The pack was rehearsed on a throwaway local database (below). Setup and environment: [`jarvis-setup.md`](./jarvis-setup.md). Reference: [`enginious-os/modules/jarvis.md`](./enginious-os/modules/jarvis.md).

## What the migration does

Additive and idempotent: it **creates** six tables (`jarvis_settings`, `jarvis_pilot_users`, `jarvis_pilot_companies`, `jarvis_action_ledger`, `jarvis_usage` and the empty `jarvis_proof_key`) and fourteen functions: `jarvis_my_access`, `jarvis_usage_take`, `jarvis_create_enquiry` (part 1); and, **added to the same migration file in place by part 2** (the file was never applied on any hosted project, so there is no second migration), four internal helpers (`jarvis_ledger_json`, `jarvis_ledger_enter`, `jarvis_ledger_done`, `jarvis_ledger_fail`: not callable by signed-in users) and one wrapper per further write action (`jarvis_register_organisation`, `jarvis_update_enquiry`, `jarvis_change_stage`, `jarvis_record_meeting`); and, for the **confirmation boundary**, three proof functions (`jarvis_hmac_sha256`, `jarvis_verify_proof`, `jarvis_set_proof_key`). It replaces and alters **nothing that exists**: every write is made by an existing function (`crm_create_opportunity`, `crm_create_organisation_profile`, `crm_update_opportunity`, `crm_move_stage`, `crm_add_activity`, `crm_create_follow_up`), called unchanged under the caller's own identity by the wrapper. The ledger gains one column, `result_extra` (ids only). Draft reply and help have no database part at all. After it is applied **JARVIS is OFF for everyone** (`enabled = false`, `writes_enabled = false`, no pilot users): nothing changes for anyone until the owner switches the pilot on.

**The confirmation boundary (why there is an owner step).** Every write wrapper first verifies, inside the database, a keyed MAC (HMAC-SHA256) that only the app server can issue, over the signed-in person, company, action, target, record version, expiry, proof id and the SHA-256 of the exact payload text (full description: [`enginious-os/modules/jarvis.md`](./enginious-os/modules/jarvis.md) section 6.1). A confirmation id and hash that someone makes up are therefore worth nothing: the call is refused and nothing is written. The database holds the key in `jarvis_proof_key` (no policy and no privilege for any API role; read only by the database's own functions). **The migration creates that table EMPTY and every wrapper FAILS CLOSED until the owner sets the key** (step 6 below): after applying, JARVIS is off anyway, and even with the pilot switched on nothing can be saved until the key matches the app. The MAC is built on the built-in `sha256(bytea)` (PostgreSQL 11+): **no `pgcrypto` or other extension is required** (the preflight checks `sha256` exists).

Security of the new tables: row level security on; the only policy is "a person reads their **own** ledger rows"; no write policy exists on any table, so nobody can write directly (writes happen only inside the definer functions); `anon` and `public` have no privilege; signed-in users may only `select` the ledger; `jarvis_proof_key` has no privilege for `public`, `anon`, `authenticated` or `service_role` and no policy at all. The settings, allowlist and usage tables cannot be read by signed-in users at all (a person learns their own access only through `jarvis_my_access()`, which returns booleans).

## Order (SQL Editor of the isolated V2 project; only the migration and the rollback change the database)

| Order | File | Kind and what it must say |
|---|---|---|
| 1 | `supabase/manual-sql/jarvis_00_preflight_readonly.sql` | read-only. Every section B row must say OK and "applied already?" must say "OK - not applied yet". Section C is information (active Sales grants, enquiries, companies with Sales settings). |
| 2 | `supabase/manual-sql/jarvis_05_preservation_check_readonly.sql` | read-only. **Run it twice** before the migration; the two results must be identical. Keep the result. |
| 3 | `supabase/migrations/20261223000100_jarvis_platform.sql` | **CHANGES the database** (adds objects only). Safe to run twice. |
| 4 | `supabase/manual-sql/jarvis_05_preservation_check_readonly.sql` again | read-only. Compare with step 2 row by row: identical EXCEPT the twenty rows marked `INTENDED TO CHANGE` (the six new tables and fourteen new functions: absent before, present after). Every existing `crm_*` function listed (including `crm_create_opportunity`, `crm_update_opportunity`, `crm_move_stage`, `crm_add_activity`, `crm_create_follow_up`, `crm_create_organisation_profile`), and the enquiry, follow-up, activity, event, organisation, account-profile, grant, counter and settings fingerprints must be unchanged. |
| 5 | `supabase/manual-sql/jarvis_20_verify_readonly.sql` | read-only. Every row that is not marked INFORMATION must say OK (row level security on all six tables; no privilege for `anon`/`public`; signed-in users only `select` on the ledger; the proof key table has no privilege for anyone and no policy; exactly one policy on the jarvis tables; the unique confirmation id; the wrappers are definer with a fixed search path; **signed-in users can execute exactly the seven expected `jarvis_*` functions and no `jarvis_*` function is callable by `anon` or `public`**; the helpers and the proof functions are NOT executable by them; **every write wrapper calls `jarvis_verify_proof` with its own action id before any lock, ledger row or write**; each wrapper calls its existing function(s) (definition text checked); the ledger has no text column; one settings row). The INFORMATION rows show the switches (both `false` right after the first apply), the pilot counts, the ledger counts and **the proof key: "not set"** until step 6. |
| 6 | **OWNER STEP: set the proof key** (below) | **CHANGES the database** (one row). One line, run once, with the SAME value as `JARVIS_CONFIRMATION_SECRET`. |
| 7 | `supabase/manual-sql/jarvis_20_verify_readonly.sql` again | read-only. Same rows all OK, and the INFORMATION row now says `set (since <date> Dubai)`. The value is never shown. |
| rollback | `supabase/manual-sql/jarvis_90_rollback.sql` | **CHANGES the database.** Drops every `jarvis_*` function and the six tables, **the proof key included** (the secret itself stays in the app's environment; after a re-apply the owner sets the key again). **Refuses to run while `jarvis_action_ledger` has rows** until you export it (it is the audit record) and add the one line it names above `begin;`. Safe to run twice. Enquiries created through JARVIS stay exactly as they are. |

**Send back:** the full results of steps 1, 2 and 4 (together), 5 and 7, and the rollback if you run it. (Never send the secret.)

## OWNER STEP: set (and rotate) the proof key

The proof key in the database must be **the same value** as the app's `JARVIS_CONFIRMATION_SECRET` (at least 32 random characters; `jarvis-setup.md` section 1). Generate it once (`openssl rand -base64 48`), put it in Vercel as a Sensitive variable, and store it in the database with this one line in the SQL Editor (run as the project owner, `postgres`; `anon`, `authenticated` and the service role cannot run it):

```sql
select jarvis_set_proof_key('<PASTE THE SAME VALUE AS JARVIS_CONFIRMATION_SECRET HERE>');
```

* The value **never goes in Git, a log, a screenshot, a chat or an email**. The SQL Editor keeps a query history: delete that history entry afterwards, and do not paste the line anywhere else. Nothing in this repository holds a real value (the line above is a placeholder).
* Check with `jarvis_20_verify_readonly.sql` (INFORMATION row: `set (since ...)`). The key itself can never be read back through any query a signed-in person or the API can run.
* **Rotation:** (1) choose a new value; (2) run the line above with the new value **and** change `JARVIS_CONFIRMATION_SECRET` in Vercel to the same value, then redeploy; do both in one sitting. Proofs signed with the old value stop working at once (a card that was open must be reviewed again; they would expire within 15 minutes anyway). Until the database and the app hold the same value JARVIS **fails closed** with a plain message ("JARVIS cannot save changes right now" or "review again") and nothing is written; ordinary Sales & CRM is not affected. Order does not matter for safety, only for how long people see the message.
* **To switch every JARVIS write off at once** without touching anything else: `delete from jarvis_proof_key;` (fails closed; set the key again to resume), or use the switches below.
* If the key is wrong or missing, the symptoms are: a review that says "This confirmation is not valid. Review the details again." every time (the values differ: the app and the database hold different values) or "JARVIS cannot save changes right now." (no key in the database). Fix by repeating the step with the right value.

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

## Rehearsal on a throwaway local database (what the RLS suite and the local walk-through did)

Run on a throwaway Postgres built from every migration (no hosted project): preflight, preservation (twice), migration applied **twice**, the proof key set, preservation after (only the twenty intended rows differ, the existing `crm_*` functions byte-identical), verify (every row OK), the behaviour tests (`jarvis.rls.test.ts` 30 and `jarvis-actions.rls.test.ts` 39 RLS tests, including 12 parallel calls with one confirmation id doing the work exactly once for each wrapper), rollback **refused** while the ledger had rows, rollback with the confirmation line **twice** (the proof key is gone with the table), and the migration **re-applied** (default OFF again, key not set). Result: see `docs/enginious-os/06-change-log.md` for the run and counts. **Hosted V2: not applied, not verified.**

## Rollback notes

After the rollback the app shows JARVIS as unavailable (same as before the migration). The ledger is lost with the tables: export it first (the script enforces this). Pilot rows and counters are not needed afterwards. **The proof key stored in the database is removed too**; the secret in Vercel is untouched, and after a later re-apply the owner sets the key again (step 6).
