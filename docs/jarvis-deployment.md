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
| 6 | **OWNER STEP: set the proof key** (below) | **CHANGES the database** (one row). One line, run once, with the **root** value of `JARVIS_CONFIRMATION_SECRET` (the database stores only the derived proof key). **Not needed for the first access-only test; do it only before a confirmed-write test.** |
| 7 | `supabase/manual-sql/jarvis_20_verify_readonly.sql` again | read-only. Same rows all OK, and the INFORMATION row now says `set (since <date> Dubai)`. The value is never shown. |
| rollback | `supabase/manual-sql/jarvis_90_rollback.sql` | **CHANGES the database.** Drops every `jarvis_*` function and the six tables, **the proof key included** (the secret itself stays in the app's environment; after a re-apply the owner sets the key again). **Refuses to run while `jarvis_action_ledger` has rows** until you export it (it is the audit record) and add the one line it names above `begin;`. Safe to run twice. Enquiries created through JARVIS stay exactly as they are. |

**Send back:** the full results of steps 1, 2 and 4 (together), 5 and 7, and the rollback if you run it. (Never send the secret.)

## Follow-up for a project where `20261223000100` is ALREADY applied: the four ledger helpers (corrective migration `20261223000200`)

**What the first hosted run found.** The read-only verifier (`jarvis_20_verify_readonly.sql`) said `FAIL - callable or missing` for `jarvis_ledger_json`, `jarvis_ledger_enter`, `jarvis_ledger_done` and `jarvis_ledger_fail`, although all four exist. The diagnostic `jarvis_10_execute_privileges_readonly.sql` showed why: on a Supabase project every new function in `public` is granted `EXECUTE` to `anon`, `authenticated` and `service_role` automatically (default privileges of `postgres` and `supabase_admin`). `20261223000100` took that back from `public`, `anon` and `authenticated` for the four helpers, and from `service_role` for the three proof functions, but **not from `service_role` for the four helpers**: one explicit ACL entry each, granted by `postgres`. Nothing else was wrong (the five write wrappers, `jarvis_my_access` and `jarvis_usage_take` (seven functions) are meant to be executable by `authenticated`; the proof functions are closed to everyone). A plain test database has no such default privileges, so the earlier local rehearsal could not show it. Impact before the fix: the helpers read `auth.uid()`, which is null for a service-role call, so `jarvis_ledger_enter` refuses and `_done`/`_fail` only update rows owned by `auth.uid()`; it was a verifier failure against the rule "internal helpers are not callable by the platform service role", not a data exposure.

**What `20261223000200_jarvis_helper_privileges.sql` does.** Privileges only (no table, function body or data; **the applied migration is not edited**). For each of the four helpers it revokes `EXECUTE` from `PUBLIC`, `anon`, `authenticated`, `service_role` and any other non-owner role in the ACL, then checks the result and **aborts the whole migration** if any role other than the owner can still execute it (for example a grant made by a different grantor, which it names). It does not touch the five write wrappers, `jarvis_my_access`, `jarvis_usage_take` (the seven functions the signed-in app calls), the proof functions, the tables or the platform's global default privileges. Safe to run twice. It never sets the proof key and never enables JARVIS.

| Order | File | Kind and what it must say |
|---|---|---|
| a | `supabase/manual-sql/jarvis_10_execute_privileges_readonly.sql` | read-only (optional, before): section 2 lists `service_role` on the four helpers. |
| b | `supabase/manual-sql/jarvis_05_preservation_check_readonly.sql` | read-only. Run before and after: identical (this migration changes ACLs only). |
| c | `supabase/migrations/20261223000200_jarvis_helper_privileges.sql` | **CHANGES the database** (privileges only). Safe to run twice. |
| d | `supabase/manual-sql/jarvis_20_verify_readonly.sql` | read-only. Every row that is not INFORMATION must now say OK (the four helper rows included). |
| e | `supabase/manual-sql/jarvis_10_execute_privileges_readonly.sql` again | read-only. Every row for the four helpers names only `postgres`; the five write wrappers, `jarvis_my_access` and `jarvis_usage_take` still name `authenticated` (and the same other roles as before). |

If your project does **not** have `20261223000100` applied yet, apply both migrations in order (the second is then a no-op safety net). The proof key and JARVIS switches are separate owner steps and stay as they were.

**Tested** (`packages/rls-tests/test/jarvis-helper-privileges.rls.test.ts`, 12 tests, real Postgres with the platform's default function privileges recreated): the defect is reproduced with `20261223000100` alone (service role can run exactly the four helpers; the verifier fails on exactly those four; a service-role call reaches the helper and is refused only for "Not signed in"); after the fix nobody but the owner can run them and direct calls by `service_role`, `anon` and `authenticated` are refused by privilege (`42501`); the verifier has no FAIL; the ACLs of the authorised functions and the proof functions are byte-identical; it is idempotent; the diagnostic is clean; and an eligible pilot person still creates an enquiry through the authorised wrapper with a valid proof (confirmed ledger row; the same proof replays the original result). The tests fail against a no-op version of the migration.

## OWNER STEP: set (and rotate) the proof key (NOT needed for the first access-only test)

**Where each value lives.**

| Where | What it holds | Notes |
|---|---|---|
| Vercel (Preview first; Production only when the owner decides), environment variable `JARVIS_CONFIRMATION_SECRET` | the **root** secret: at least 32 random characters, marked Sensitive, server-only | the app derives **both** keys from it: the review key (kept by the app only) and the proof key |
| Supabase (`jarvis_proof_key`, one row) | **only the derived database proof key**, hex of `HMAC-SHA256(root, "JARVIS-PROOF-KEY-V1")` | never the root secret and never the review key; no API role can read it; the verify pack shows only "set / not set" |

**The derivation already exists and is unchanged; nothing new is invented here.** It is written in three places that agree, and the shared test vectors prove they agree: the SQL function `jarvis_set_proof_key` (`supabase/migrations/20261223000100_jarvis_platform.sql:162`), the app's `deriveProofKey` (`apps/web/src/lib/jarvis/token.ts:28`) and the `derivation` entries of `supabase/tests/jarvis-proof-vectors.json` (described in `docs/enginious-os/modules/jarvis.md` section 6.1).

**When.** The database proof key is needed only for **confirmed writes**. The **first access-only test leaves it unset and keeps `writes_enabled = false`**: the launcher and the refusals do not need it (every write fails closed while it is unset). Do this step only before the separate confirmed-write test.

**How.** Generate the root secret once (`openssl rand -base64 48`), put it in Vercel as a Sensitive variable, then run this one line in the Supabase SQL Editor as the project owner (`postgres`; `anon`, `authenticated` and the service role cannot run it):

```sql
select jarvis_set_proof_key('<PASTE THE ROOT VALUE OF JARVIS_CONFIRMATION_SECRET HERE>');
```

* **Pass the ROOT value, not a key you derived yourself.** `jarvis_set_proof_key` derives the proof key inside the database and stores only that. A pre-derived value would be derived a second time and would never match the app (every confirmation would say "This confirmation is not valid. Review the details again."). No function accepts a pre-derived key; if the owner does not want the root value to reach the SQL Editor at all, that needs a separate change (not made here).
* **What this means for the root value.** The statement text contains the root value, so it is sent to Supabase once and the SQL Editor may keep it in its query history. Delete that history entry afterwards, do not paste the line anywhere else, and never put the value in Git, a log, a screenshot, a chat or an email. Nothing in this repository holds a real value (the line above is a placeholder). Whether the SQL Editor or Supabase's own logs retain the statement text is not something this repository can verify.
* Check with `jarvis_20_verify_readonly.sql` (INFORMATION row: `set (since ...)`). The key itself can never be read back through any query a signed-in person or the API can run.
* **Rotation:** (1) choose a new root value; (2) run the line above with the new value **and** change `JARVIS_CONFIRMATION_SECRET` in Vercel to the same value, then redeploy; do both in one sitting. A review token issued under the old value no longer verifies (a card that was open must be reviewed again; it would expire within 15 minutes anyway); a database proof lives only about two minutes (`JARVIS_PROOF_TTL_SECONDS`, default 120). Until the app's root value and the database's derived key correspond, JARVIS **fails closed** with a plain message and nothing is written; ordinary Sales & CRM is not affected.
* **To switch every JARVIS write off at once** without touching anything else: `delete from jarvis_proof_key;` (fails closed; set the key again to resume), or use the switches below.
* If the key is wrong or missing, the symptoms are: a review that says "This confirmation is not valid. Review the details again." every time (the app and the database do not correspond) or "JARVIS cannot save changes right now." (no key in the database). Fix by repeating the step with the right root value.

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

## Later hosted V2 pilot (owner-reported; recorded 2026-11-10)

The section above is the **original migration verification** and is historical: at that time both switches were off, there were no pilot users and the proof key was unset.

**Later, the owner reported a one-user pilot on hosted V2:** JARVIS and JARVIS writes were enabled for **one pilot user and one company**, the **database proof key was set**, and that pilot created an enquiry after review and confirmation. This is the owner's report. Claude did not run any hosted SQL, did not see the rows, and did not verify it independently. It says nothing about the state of the switches at any later time, and nothing about Vercel Production. No secret value is recorded in this repository.

## Review of the remaining service_role grants (read-only review; nothing changed)

**Correction.** The earlier version of this section said "nine functions". That was a counting error: the signed-in app calls **seven** JARVIS functions (five write wrappers, `jarvis_my_access` and `jarvis_usage_take`), and those seven are what still carry the platform-default `service_role` grant. The four ledger helpers were closed by `20261223000200` (verified on hosted V2) and the three proof functions were never open to it. All 14 `jarvis_*` functions, by exact SQL signature:

| # | Exact signature | Class | `service_role` EXECUTE: owner's hosted ACL export (taken before `20261223000200`) | After `20261223000200` | Repository call sites prove |
|---|---|---|---|---|---|
| 1 | `jarvis_my_access(uuid)` | signed-in entry point | **yes** (granted by `postgres`) | not changed by the migration; **post-fix export not available** | called only by the signed-in person's own client (`lib/jarvis/dispatcher.ts:62`, `:215`, `:224`) |
| 2 | `jarvis_usage_take(integer)` | signed-in entry point | **yes** | same | `dispatcher.ts:76`, signed-in client |
| 3 | `jarvis_create_enquiry(uuid,uuid,text,integer,bigint,text,text)` | write wrapper | **yes** | same | `lib/jarvis/sales/enquiry-create-from-brief.ts:181`, signed-in client |
| 4 | `jarvis_register_organisation(uuid,uuid,text,integer,bigint,text,text)` | write wrapper | **yes** | same | `organisation-register.ts:150`, signed-in client |
| 5 | `jarvis_update_enquiry(uuid,uuid,text,integer,bigint,text,text)` | write wrapper | **yes** | same | `enquiry-update.ts:123`, signed-in client |
| 6 | `jarvis_change_stage(uuid,uuid,text,integer,bigint,text,text)` | write wrapper | **yes** | same | `enquiry-stage.ts:111`, signed-in client |
| 7 | `jarvis_record_meeting(uuid,uuid,text,integer,bigint,text,text)` | write wrapper | **yes** | same | `meeting-record.ts:116`, signed-in client |
| 8 | `jarvis_ledger_json(jarvis_action_ledger,boolean)` | internal helper | yes (before the fix) | **no: QA-reviewed hosted result** (denied to `service_role`, `authenticated`, `anon`, `PUBLIC`) | only inside the wrappers |
| 9 | `jarvis_ledger_enter(uuid,text,text,uuid,text)` | internal helper | yes (before the fix) | **no** (same) | only inside the wrappers |
| 10 | `jarvis_ledger_done(uuid,uuid,text,jsonb)` | internal helper | yes (before the fix) | **no** (same) | only inside the wrappers |
| 11 | `jarvis_ledger_fail(uuid,text,text)` | internal helper | yes (before the fix) | **no** (same) | only inside the wrappers |
| 12 | `jarvis_hmac_sha256(bytea,bytea)` | proof machinery | no (owner only) | no | only inside the proof functions |
| 13 | `jarvis_verify_proof(text,uuid,uuid,text,integer,bigint,text,text)` | proof machinery | no (owner only) | no | only inside the wrappers |
| 14 | `jarvis_set_proof_key(text)` | owner setter | no (owner only) | no | run by the owner only (`seed/jarvis.sh:23` locally) |

**What the hosted ACL export confirms, and what it does not.** The export in hand is the owner's `jarvis_10_execute_privileges_readonly.sql` result from **before** `20261223000200`: it shows `service_role` with an explicit `EXECUTE` (grantor `postgres`) on exactly rows 1 to 11 and on none of rows 12 to 14. For rows 1 to 7 that is the only hosted evidence. Since then the owner applied the corrective migration and QA reviewed the new exports: the verifier returned 70 OK, 0 failures, 4 informational, and rows 8 to 11 are denied to all four roles. **A post-fix ACL export for rows 1 to 7 is not available to this review**, so their hosted state after the fix is **expected unchanged but not confirmed** (the migration does not touch them, and the local test shows their ACLs byte-identical before and after). To confirm it, the owner runs this **read-only** query and sends all 14 rows (no secret in it):

```sql
-- READ-ONLY. Effective EXECUTE per exact signature, and the raw ACL entries.
select p.oid::regprocedure::text as signature,
       has_function_privilege('service_role',  p.oid, 'execute') as service_role,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('anon',          p.oid, 'execute') as anon,
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_pseudo_role,
       coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                                   || ' (by ' || pg_get_userbyid(a.grantor) || ')', ', ')
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.privilege_type = 'EXECUTE'), '') as acl_entries
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname like 'jarvis\_%'
order by 1;
```

Expected on hosted if nothing else changed: 14 rows; rows 8 to 14 all `false`; rows 1 to 7 `service_role = true`, `authenticated = true`, `anon = false`, `public_pseudo_role = false`. (`jarvis_10_execute_privileges_readonly.sql` shows the same facts with the reasons.) The query was run against a local database with the platform's default function privileges recreated and returned exactly that.

**What the repository call sites prove (separately from the export).** Evidence from the code at head `00c5757`:

* **The only service-role client in the application** is `createAdminClient()` (`apps/web/src/lib/supabase/admin.ts:14-18`, `SUPABASE_SERVICE_ROLE_KEY`). Its callers (`app/api/cron/leave-accrual/route.ts:83`, `comp-day-expiry/route.ts:29`, `document-expiry/route.ts:29`, `recovery-windows/route.ts:31`, `app/api/ai/detect-balance-discrepancies/route.ts:36`, `lib/crm/upload-cleanup.ts:18`, `lib/crm/quotations/pin-assets.ts:28,32`) call none of the JARVIS functions: no file under `app/api`, `lib/crm` or `lib/actions` other than `lib/actions/jarvis.ts` mentions JARVIS, and `vercel.json:2-8` lists no JARVIS job.
* **Every JARVIS database call uses the signed-in person's own session client.** `lib/jarvis/runtime.ts:19,23` builds it with `createClient()` from `lib/supabase/server.ts:30-32` (anon key plus the person's cookie session, so the database role is `authenticated`), reached from the server actions `lib/actions/jarvis.ts:15-55`. The dispatcher states there is no service-role client in JARVIS (`dispatcher.ts:21`), and `lib/jarvis/create-from-brief.test.ts:554-556` fails the build if any JARVIS source file mentions `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `supabase/admin` or `createAdminClient`.
* **Scripts and tests** call the functions as the owner or as `authenticated`: `apps/web/os-shell-checks/seed/jarvis.sh:16,23`, `jarvis-flow.mjs:256,259-262,287-291,331-335`, `jarvis-sales-flow.mjs:259,306-313`. No CI workflow calls them. No other migration or function calls a `jarvis_*` entry point.

**Classification.** Rows 1 to 7: **unnecessary in the repository** (nothing in the code, routes, jobs or scripts invokes them with the service-role credential, and the design forbids a service-role client for JARVIS). **Hosted-only callers: unverified** (next section). A function refusing a service-role call because `auth.uid()` is null does not make the grant needed, and it is not why the grants are classed unnecessary: nothing calls them. Rows 8 to 14: no grant to review.

**Recommendation.** Revoke `EXECUTE` from `service_role` on rows 1 to 7 only, as a **separate, targeted migration** (not part of this documentation pass; nothing is changed): `authenticated` stays, `anon` and `PUBLIC` stay closed. It is low risk, tightens the boundary to "signed-in people only" and removes a latent path whose only wall is `auth.uid()` being null. Outline: `20261223000300_jarvis_entry_point_privileges.sql`, privileges only, idempotent, aborting if `service_role` (or any role other than the owner and `authenticated`) can still execute rows 1 to 7; tests in the style of `jarvis-helper-privileges.rls.test.ts` (default function privileges recreated: before = the service role can execute rows 1 to 7; after = only the owner and `authenticated` can, ACLs of rows 8 to 14 byte-identical, the verifier all OK, a valid proof still creates an enquiry through the wrapper, direct service-role calls refused with `42501`, idempotent, preservation check identical); plus two verifier rows (`service_role` cannot execute any `jarvis_*` function; `authenticated` executes exactly rows 1 to 7) so a future `jarvis_*` function that inherits the platform default is caught. Apply it only after the post-fix export above and the caller check below are clean. (The comment in `20261223000200` says "the seven wrappers, `jarvis_my_access` and `jarvis_usage_take`": that wording is loose, it means these seven functions; the applied migration files are not edited.)

## What the hosted caller check can and cannot prove

The question is whether anything outside the repository calls rows 1 to 7 with the service-role credential.

**Checked so far (no hosted result has been reported for any of it):** the repository, as listed above (application code, routes, crons, scripts, tests, CI). That is all this review could check.

**What a database inspection covers, and the read-only queries (owner, SQL Editor):**

```sql
-- READ-ONLY. Database objects other than the JARVIS functions that mention a jarvis_ function.
select 'function body' as kind, p.oid::regprocedure::text as object
  from pg_proc p
 where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
   and p.proname not like 'jarvis\_%' and p.prosrc ilike '%jarvis\_%'
union all
select 'trigger', t.tgrelid::regclass::text || ' / ' || t.tgname
  from pg_trigger t where not t.tgisinternal and pg_get_triggerdef(t.oid) ilike '%jarvis\_%'
union all
select 'policy', schemaname || '.' || tablename || ' / ' || policyname
  from pg_policies
 where tablename not like 'jarvis\_%' and (coalesce(qual, '') ilike '%jarvis\_%' or coalesce(with_check, '') ilike '%jarvis\_%')
union all
select 'view', schemaname || '.' || viewname
  from pg_views where schemaname not in ('pg_catalog', 'information_schema') and definition ilike '%jarvis\_%'
order by 1, 2;
-- Expected: no rows.

-- READ-ONLY, only if the pg_cron extension is installed (otherwise this statement errors because the cron schema does not exist):
select jobid, jobname, schedule, left(command, 160) as command_start from cron.job where command ilike '%jarvis%';
-- Expected: no rows.
```

An empty result proves only that **no database function, trigger, policy, view or scheduled `pg_cron` job in that database** refers to a `jarvis_` function. (The trigger query also catches Database Webhooks, which are triggers.) Dynamic SQL that assembles a function name from pieces would not be found by a text search.

**What it cannot cover:** (1) **Supabase Edge Functions**: their code lives on the Supabase platform, not in the database, and the repository has none. (2) **External automations or other deployments** that hold the service-role key and call the REST API (a no-code automation, a script on someone's machine, another deployment of this app or a different app using the same project). (3) Anything that called the functions in the past, before the logs' retention window. **These remain unverified.**

**What the owner can check without making any change:** (a) Supabase Dashboard, **Edge Functions**: the list should be empty (or contain nothing that calls the database with the service key); (b) Dashboard, **Logs** (API Gateway logs): filter on request paths containing `/rest/v1/rpc/jarvis_`; JARVIS has never been enabled on V2, so every hit is unexpected, and an empty result covers only the plan's retention window; (c) an inventory of where the service-role key is stored (the Vercel environment variables, any automation tool, any developer machine) and who can use it; (d) optionally `select funcname, calls from pg_stat_user_functions where funcname like 'jarvis\_%';`, which only counts calls if function tracking (`track_functions`) is enabled and returns no rows otherwise, so an empty answer is not proof.

## One-user Sales & CRM pilot on a Preview: the exact access-only checklist (for review; NOT executed)

Fictional data only; no real client data is entered or needed. **Writes stay off. The database proof key stays unset.** Do not put a secret value in a ticket, chat or screenshot. The owner runs the SQL in the V2 SQL Editor.

**A. Confirm the target before anything is switched on**
1. **Preview commit.** In Vercel, open the Preview deployment of PR #70 and note its commit SHA; it must equal the head SHA of `feat/jarvis` reported for the PR (write both down). The URL must be the Preview URL, not the Production domain.
2. **Supabase target.** In Vercel (Preview environment) the `NEXT_PUBLIC_SUPABASE_URL` project reference must be the Enginious HR Engine **V2** project's reference and not Production's. In the V2 SQL Editor run `select * from jarvis_settings;`: `enabled = false`, `writes_enabled = false`; `select count(*) from jarvis_pilot_users;` is 0; `select count(*) from jarvis_pilot_companies;` is 0; `select count(*) from jarvis_action_ledger;` is 0. The verifier (`jarvis_20_verify_readonly.sql`) is still all OK, and its proof-key row says **not set**.
3. **Preview server environment needed just to show the launcher.** From the code (`lib/jarvis/config.ts:65-107`, `lib/jarvis/dispatcher.ts:210`): the launcher is drawn only if the provider is usable **and** the confirmation secret is present, so the Preview needs exactly two JARVIS variables, both server-only and Sensitive, set for **Preview only**: `ANTHROPIC_API_KEY` (a separate low-spend key; it is not used for any call in this checklist, but without it the launcher is never shown) and `JARVIS_CONFIRMATION_SECRET` (the root secret, 32+ random characters; Vercel builds run with `NODE_ENV=production`, so there is no development fallback). Optional: `JARVIS_DAILY_LIMIT_PER_USER` (for example 10). Leave `JARVIS_PROVIDER` and `JARVIS_DISABLED` unset. Nothing is needed in Supabase for this (no proof key), and JARVIS does not use `SUPABASE_SERVICE_ROLE_KEY`. Redeploy after setting them and re-check the commit SHA. Production gets none of these variables.
4. **Accounts.** User **A**: one eligible Sales user (active profile, active Sales grant for company **X**). User **B**: a comparable non-pilot user (active profile, an active Sales grant for the same company X with the same capabilities, **no** `jarvis_pilot_users` row). Find their ids with `select id, email from profiles where email in ('<A>', '<B>');`.
5. **Baseline counts** (so "creates nothing" can be proved): `select (select count(*) from crm_opportunities) opps, (select count(*) from crm_organisations) orgs, (select count(*) from crm_activities) activities, (select count(*) from crm_follow_ups) follow_ups, (select count(*) from jarvis_action_ledger) ledger;` Write the five numbers down.
6. With the switches still off, sign in as A and as B on the Preview: **no "Open JARVIS" launcher for either.**

**B. Limit access to one user and one company, writes off** (owner SQL, as in "Pilot controls" above)
7. `update jarvis_settings set enabled = true, writes_enabled = false, updated_at = now();`
8. `insert into jarvis_pilot_users (user_id, note) values ('<A id>', 'access check') on conflict (user_id) do nothing;` (A only.)
9. `insert into jarvis_pilot_companies (company_id) values ('<X id>') on conflict do nothing;` (one company only.)

**C. Verify**
10. **A sees it.** Reload the Preview as A: the "Open JARVIS" launcher is visible and the company picker offers **only X**.
11. **B is denied by the server, not only hidden.** (a) Reload as B: no launcher. (b) Ask the database the question the server asks first (`dispatcher.ts:62-65` refuses with "not available" when `is_available` is false); read-only, rolled back:
    ```sql
    begin read only;
    set local role authenticated;
    select set_config('request.jwt.claims', json_build_object('sub', '<B id>', 'role', 'authenticated')::text, true);
    select * from jarvis_my_access('<X id>');
    rollback;
    ```
    Expected for B: `is_available = false`. Repeat with A's id: `is_available = true`, `writes_allowed = false`, `company_allowed = true`; and with A's id and any company other than X: `company_allowed = false`. (If the SQL Editor refuses `set local role`, skip (b) and note it; this hosted behaviour was tested only on a local database. The server-side refusal itself, `not_available`, is covered by the automated tests `lib/jarvis/create-from-brief.test.ts:505-507` and the isolated walk-through, not by this hosted check.)
12. **A write request is refused and creates nothing.** As A, in the panel with company X, paste this fictional brief and ask for an enquiry: "Hi team, Sara from Fictional Wave Agency here. Our client Fictional Harbour Brands wants to launch a product at Harbour Hall from 5 to 7 December 2026. One LED tunnel, budget around AED 45,000." Expected: a refusal saying JARVIS cannot create or change records right now (`dispatcher.ts:67`), **no review card**, and no provider call (the refusal comes before the provider is used). Re-run the baseline query from step 5: the five numbers are **identical**, in particular `ledger = 0` (no CRM row, no ledger row).
13. **Switch it off.** `update jarvis_settings set enabled = false, writes_enabled = false, updated_at = now();` then `delete from jarvis_pilot_users where user_id = '<A id>';` and `delete from jarvis_pilot_companies where company_id = '<X id>';`. Reload as A: **the launcher is gone**. Re-run step 11(b) for A: `is_available = false`. (Equivalent hard-off without touching the database: set `JARVIS_DISABLED=1` in the Preview environment and redeploy.)
14. **Record** (no secrets): the PR head SHA, the Preview commit SHA and URL, the V2 project reference, the date and time, the baseline and final counts, and what each step showed. If any step differs from the expectation, do step 13 first and report the difference.

**Not part of this checklist** (separate, later, each needing the owner's go-ahead): setting the database proof key, `writes_enabled = true`, any confirmed write, any real client brief.

**Prerequisites for the separate confirmed-write test**
1. The owner step above: set the database proof key (root value in Vercel, derived key only in Supabase); the verifier's INFORMATION row then says `set`.
2. `writes_enabled = true` for the one pilot user and one pilot company only; the daily limit and the Anthropic spend cap in place.
3. Fictional client and agency organisations (and, if needed, one fictional enquiry) created beforehand in a test company or clearly labelled as test, so no real record can be touched.
4. Start with **one** action (create an enquiry from a brief): 0 enquiries before pressing Create and exactly 1 plus one `done` ledger row after, as in the local run. The other actions stay out of the first write test.
5. A cleanup plan: JARVIS cannot delete, so the test enquiry is closed or marked as test through the normal Sales screens, and the ledger is exported (it is the audit record) before any rollback.
6. A decision on Anthropic's retention and training terms (unverified) and a separate owner approval before any real client brief.
7. The Preview built from the verified `feat/jarvis` head, pointing at V2.
8. Optionally, the targeted `service_role` revoke migration outlined above, applied before the test (independent of it, not during it).

## Stages 2 to 4 (Sales lookups, summaries, scope wording): what a Preview or Production needs

**Status: draft PR, not merged, not deployed. Nothing was applied, enabled or changed on hosted by Claude.**

| Part | Needs | Notes |
|---|---|---|
| Lookups, summaries, scope draft, the provenance rule | **Only the app deployment.** No migration, no new environment variable, no new switch | They read existing tables through the person's own session under the existing policies |
| Pausing | The existing `JARVIS_PAUSE` values: `lookups` pauses lookups and summaries; `chat` pauses the scope draft and the AI wording of a summary (its figures still show) | A redeploy applies a change, as before |
| Daily limit | Unchanged. AI wording of a summary and a scope draft count one request each; lookups and figures count nothing | `JARVIS_DAILY_LIMIT` |
| Pilot | Unchanged. Do not add users or companies for this | |

**Rollback of the app behaviour:** set `JARVIS_PAUSE=lookups,chat` to stop the new capabilities at once (the Sales actions keep working), or revert the merge commit. There is no database object to remove.

**Preview QA checklist for this work (signed-in pilot user, fictional or existing data; none of these steps creates a record):** (1) "What needs my attention today?": sections with reasons, the company, "as of ... (Dubai)", links that open the records; (2) "Show my follow-ups due today" and "the next 14 days": the dates in the filter line are right for today in Dubai; (3) "Show my open enquiries", then "the whole company instead", then "only Negotiation": the total and "Showing N of M" agree with the Enquiries screen for the same filter; (4) "Open enquiries for" and a client's name: that client's enquiries, or one question when several match; (5) "Which of my enquiries have had no activity for 14 days?": check two against their timelines; (6) "What is the status of" and a reference: no value or budget on the card; a reference from a company you have not selected says it cannot be found; (7) "How many enquiries did we win or lose last month?": the numbers match Sales reports for the same dates; no AI wording; (8) "Summarise this month's enquiries": the same numbers, then "In words (written by Enginious OS from the figures above)" whose sentences repeat those numbers exactly, and a separate block of AI suggestions with no numbers; press "Compare periods", then type "show last month instead": the comparison is still on; the card opens with the result ("N won · N lost · N% won") and "How this is counted" holds the definitions; (9) on an enquiry that has a value and a budget note, "Summarise this enquiry and its next steps": the AI summary may mention a figure someone wrote in the brief or a note, but not the enquiry's value or budget-note fields; it is headed as an AI summary to check; (9a) "Open enquiries for" and a name that matches several clients: choose one, then type "the whole company instead": still that client only; (10) "Draft the estimate scope for" and a reference: lines and questions, no amounts, a Copy button, no estimate created (check Proposals & quotes); (11) "Draft a reply to the client offering 85 per item, our cost is 60" in general chat: a draft that uses your figures; (12) select another company and repeat (3): only that company's records; (12a) the panel: the message box starts at two lines and grows to about six when a long brief is pasted, with Send still visible; "What gets shared" under it opens with the keyboard; on a phone-width window both summary buttons ("Compare periods", "Explain & suggest") fit; (13) the earlier milestone 3 checks that touch routing: "How are you today?", a brief pasted in normal chat opens the review card, "confirmed" saves nothing.

## Release of PR #74 (2026-11-10): status and evidence

Four facts, kept apart. "Owner-reported" means the owner ran the check and gave Claude the result on the date shown; Claude did not see the hosted system.

| Fact | Status | Evidence |
|---|---|---|
| Merged | PR #74 merged as `b7fc31e079cac0a7d53180b52d80d01e1feb1692` (head `6302a6727d7167072d9bb975a0843ff5f70764b7`) | GitHub, read by Claude |
| Required CI on the exact head | `lint-typecheck-test` success, `rls-policies` success | GitHub, read by Claude before merging |
| Production deployment | **Owner-confirmed (2026-11-10): Vercel Production is serving the PR #74 release.** Not independently verified: Claude has no Vercel access and did not open Production | Owner-reported |
| Hosted database: memory migration `20261226000100_jarvis_memory_suggestions.sql` (install-order row 23) | **Applied and verified by the owner (2026-11-10).** Not independently verified: Claude ran no hosted SQL | Owner-run, owner-reported (results below) |
| Pilot controls | **Counts owner-reported (2026-11-10): one pilot user, one pilot company, JARVIS and writes on, proof key set.** The identities of that user and company were NOT re-checked by this output | Owner-run, owner-reported |

**Owner-run results, supplied 2026-11-10 (hosted database the Production pilot uses, as described by the owner; recorded as reported):**

1. `jarvis_memory_00_preflight_readonly.sql` before applying: platform installed `OK`; `jarvis_my_access(uuid)` `OK`; `jarvis_preferences` and `jarvis_knowledge_suggestions` both absent ("not installed yet").
2. `supabase/migrations/20261226000100_jarvis_memory_suggestions.sql` applied successfully by the owner. It must not be re-run for this release (it is idempotent, but there is no reason to).
3. `jarvis_memory_20_verify_readonly.sql`: rows 1 to 6 `OK`; row 7 (preferences / pending suggestions) `0 / 0`.
4. `jarvis_20_verify_readonly.sql` afterwards: every check `OK`. Informational rows: `enabled=true`, `writes_enabled=true`; one pilot user and one pilot company; one completed ledger action; proof key set.

**What this does and does not establish.**
* "What JARVIS remembers" and "Suggest a correction" now have their database objects (owner-reported). Whether they work on Production signed-in was not tested by anyone for this record.
* The pilot is limited to one user and one company by count. **Who** they are is not shown by the verifier and was not reverified; the expected scope (the owner's own sign-in, Enginious LLC FZ) is the owner's earlier statement. A read-only way to see the identities, should the owner want it (written for this release; never run by Claude):

```sql
select u.email from jarvis_pilot_users p join auth.users u on u.id = p.user_id;
select c.legal_name from jarvis_pilot_companies p join companies c on c.id = p.company_id;
```

* Nothing was applied, enabled, added, rotated or reprovisioned by Claude. No earlier platform migration or secret step was repeated.

**Live QA gaps accepted for this release (not passed, not failed: not retested).** After their final changes, these were not manually retested signed-in with the live model: the Brief summary, Scope lines and Technologies rows it writes (checklist step 25 below), and the "here" follow-up keeping the current screen's guide (step 24). Both have automated coverage with simulated model answers only. Earlier signed-in Preview results were owner-reported. The browser walk-throughs were not re-run and Claude made no real Anthropic call.

**Not part of this release.** A possible future policy letting selected operational records or aggregates reach Anthropic is not implemented: the rulebook still attaches nothing Enginious OS holds to any provider request (`docs/enginious-os/modules/jarvis-rulebook.md`).

## Milestone 3 (general assistant, rulebook, memory, lookup): what a Preview or Production needs, exactly

**Nothing here was applied, enabled or changed on hosted by Claude.** (Written before the release; for what happened at the release, including the owner applying the migration, see "Release of PR #74" above.)

| Part | Needs | Without it |
|---|---|---|
| Local routing, general chat, guidance from the Map, the protected guide, the overdue follow-ups lookup, the outbound gate, the enquiry-brief separation | **Only the app deployment.** No migration, no new variable. The lookup reads `crm_follow_ups`, `crm_opportunities` and `companies` through the person's own session (existing policies) | n/a |
| "What JARVIS remembers" and "Suggest a correction" | Migration `20261226000100_jarvis_memory_suggestions.sql` (two tables, four functions; additive; needs `20261223000100`) | JARVIS works; saving a preference or a suggestion answers "not set up in this environment yet"; no preference is applied to chat |
| Independent pauses | Optional `JARVIS_PAUSE` in the Vercel environment (`docs/jarvis-setup.md`). Not set = nothing paused | n/a |

**Owner steps for the migration (SQL Editor of the isolated V2 project that the Preview uses; only step 2 and the rollback change the database):**

1. `supabase/manual-sql/jarvis_memory_00_preflight_readonly.sql`: rows 1 and 2 must say `OK`; rows 3 and 4 `not installed yet`.
2. Apply `supabase/migrations/20261226000100_jarvis_memory_suggestions.sql` (idempotent: safe to run twice).
3. `supabase/manual-sql/jarvis_memory_20_verify_readonly.sql`: rows 1 to 6 must say `OK` (row 7 is a count).
4. `supabase/manual-sql/jarvis_20_verify_readonly.sql` (the earlier verifier, updated in this change so the four new functions are not counted among "exactly seven"): still all `OK`.
5. To review suggestions later: `jarvis_memory_30_suggestions_review_readonly.sql`. To remove only this migration: `jarvis_memory_90_rollback.sql` (deletes the saved preferences and suggestions; JARVIS stays). The full `jarvis_90_rollback.sql` now also removes these objects.

**What was verified locally (PostgreSQL 16 on the build machine, fictional data; `packages/rls-tests/test/jarvis-memory.rls.test.ts`, 13 tests):** a preference is listed for its owner on a new connection and for nobody else; only the closed set can be stored (free text, unknown keys and values refused by the CHECK); delete removes only the caller's row; no direct table access; people outside the pilot, anonymous callers and "main switch off" are refused; suggestions are stored as pending, bounded at 20, unreadable by others; the lookup's exact query as two people with different company access (a company the requester cannot see returns nothing; a revoked grant stops the next lookup); preflight, verify, rollback twice and re-apply twice; the earlier verifier all `OK` with and without the migration. `jarvis.rls.test.ts` and `jarvis-helper-privileges.rls.test.ts` were re-run because the full rollback and the verifier changed (42 tests, green).

**Not verified by Claude at the time this section was written, before the release (blocked without hosted access or a live key; the owner later applied and verified the migration, see "Release of PR #74" above):** the migration on hosted V2; the Vercel Preview itself (whether it deployed, and JARVIS on it); any call to the real Anthropic API (general chat and the new extraction request shape were exercised only with the simulated provider and with an intercepted HTTP request); the browser walk-throughs `jarvis-flow.mjs` and `jarvis-sales-flow.mjs` (not re-run; one welcome-text assertion in `jarvis-flow.mjs` was updated to the new text).

**Preview QA checklist (owner or QA, on the Preview, with the one pilot user and fictional text):** (1) "How are you today?" answers in words, no card; (2) "Draft an email to a supplier asking for a delivery date", then "make it shorter": a draft with Copy, then a shorter one; (3) "How does Sales & CRM work?" shows steps and links; (4) "Show me the inventory stock levels" explains the limit; (5) "Show my overdue Sales follow-ups", then "show last month instead"; (6) "What is Sara's salary?" answers without a figure; (7) after the migration: "Remember that I prefer short emails in British English", reload the page, ask for a draft (the card says which preferences were applied), delete the preference in "What JARVIS remembers", ask again; (8) the notice under the input reads "The text you submit for this task is sent to Anthropic to prepare a draft."; (9) paste a fictional priced brief with a client and an end client, "85 per item" and "Client budget: AED 50,000–65,000": it is **not rejected**, the card shows the two parties in their own fields, the value blank with the budget wording in the budget note, the original brief, and Create saves one enquiry (pressing Create again does not make a second); (10) the same with "Client budget: AED 85,000": the value is 85,000; (11) a brief headed "External sharing prohibited" (or "Internal use only", "NDA — internal use only"): no card, a pointer to the new-enquiry form; (12) a brief containing a salary or an IBAN: a clean excerpt is offered for sending, nothing goes automatically; (13) on an enquiry page, "Draft a reply" with a pasted client message that includes a price: a draft appears (prices are allowed; nothing from the enquiry record is sent); (14) "Show my overdue Sales follow-ups", then ask for a general draft: the draft does not know the follow-ups; (15) on an enquiry page choose "Draft a reply" and paste a message that starts "External sharing prohibited.": no draft, a message that nothing was sent; (16) "Draft a reply" with "Our cost is 85 per item.": refused; with "Offer the client 85 per item.": a draft; (17) a brief with "Client budget: AED 50000-65000": the card's budget note shows the range and the value is blank; (18) open Events & Exhibitions and ask "What can I do here?", then "What is this page for?": the Events & Exhibitions guide, headed "For the screen you are on"; repeat on Follow-ups, Outreach and My Leave; (19) from any screen ask "Where can I see upcoming trade shows?" and "How do I upload a list of events?": the Events guides; (20) ask "How do I register a new customer?": one short question with two or three choices, and choosing one answers it; (21) on a screen with no guide (for example Audit Log) "What can I do here?" says there is no approved guidance for it yet; (22) **in normal chat, with no shortcut chosen**, paste a fictional structured brief that begins "Prepare a Sales enquiry for review" (project, client, event, venue, dates, scope, pricing with a budget range): the **editable enquiry review card** opens, not a text draft with Copy; the budget value is blank with the range in the budget note; stop before Create and check that no enquiry exists; then the same details under "Write an email to the client about this enquiry" give a draft with Copy; (23) on Events & Exhibitions ask "What can I do on this page?" and then "what is benifit here?": the second answer is the Events & Exhibitions guide under "What Events & Exhibitions helps you do", never "no approved guidance"; (24) still on Events & Exhibitions ask "what is benifit here? How does it help us get work next year?": the Events & Exhibitions guide again, not "See and plan follow-ups"; then "how do follow-ups help here?" gives the follow-ups guide; (25) paste each of the two fictional paragraph briefs (the messy email, and the client conversation that starts with an instruction to JARVIS; their exact text is `QA_EMAIL` and `QA_CALL` in `apps/web/src/lib/jarvis/create-from-brief.test.ts`, where the model answers are simulated, so this step is the only check of what the live model writes): the Brief field is a short factual summary with no instruction to JARVIS, greeting, signature, unrelated lead or obsolete detail; requirements, corrections, exclusions, dependencies and open points are in Scope; Technologies requested lists what Enginious is asked to provide (the requested experience), not equipment the agency supplies; for the brief that says an agency called, Source is empty and the card asks (not "Agency call (outbound)"); stop before Create.

## Rehearsal on a throwaway local database (what the RLS suite and the local walk-through did)

Run on a throwaway Postgres built from every migration (no hosted project): preflight, preservation (twice), migration applied **twice**, the proof key set, preservation after (only the twenty-eight intended rows differ, the existing `crm_*` functions byte-identical), verify (every row OK), the behaviour tests (`jarvis.rls.test.ts` 30, `jarvis-actions.rls.test.ts` 39 and `jarvis-proof.rls.test.ts` 105 RLS tests, including 12 parallel calls with one confirmation id doing the work exactly once for each wrapper, the review token refused as a proof by every wrapper, and the register-organisation acknowledgement checked in SQL), rollback **refused** while the ledger had rows, rollback with the confirmation line **twice** (the proof key is gone with the table), and the migration **re-applied** (default OFF again, key not set). Result: see `docs/enginious-os/06-change-log.md` for the run and counts. **Hosted V2: not applied, not verified.**

## Rollback notes

After the rollback the app shows JARVIS as unavailable (same as before the migration). The ledger is lost with the tables: export it first (the script enforces this). Pilot rows and counters are not needed afterwards. **The proof key stored in the database is removed too**; the secret in Vercel is untouched, and after a later re-apply the owner sets the key again (step 6).
