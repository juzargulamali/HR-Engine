# People & Access: exact deployment order

Two stacked pull requests and one security migration. **Status (2026-10-27):** #50 is merged; the migration has been applied on V2 by the owner and verified (steps 2 to 6 below, results in "Deployment record"); **#51 is not merged yet** (step 7). Merging a pull request never touches the database: no workflow in this repository applies a migration, so every SQL step is yours, one at a time, in the SQL Editor of **Enginious HR Engine_V2**.

| | What | SQL? | Changes who may grant what? |
|---|---|---|---|
| **PR #50** `feat/people-access` → `main` | The People & Access screen, account controls moved, old addresses redirect, "Reporting manager" wording, policy-test correction, account-control tests | none | no |
| **PR #51** `feat/people-access-grant-rules` (stacked on #50) | The R1 to R3 migration file, its owner-run scripts, the screen's explanations of the new refusals | the migration is **not** applied by merging | only once you run step 4 |

**Why this order.** The screen (#50) needs no SQL and changes no rule, so it goes first. The migration is applied (step 4) **before** #51 is merged (step 7), so the screen never explains a refusal that the database does not yet make. If you apply the migration while only #50 is live, nothing breaks: a refused change shows the database's own message in words.

## Gates before step 1

1. CI is green on #50 (`lint-typecheck-test`, `rls-policies`, `e2e-read-only`) and on #51 (`lint-typecheck-test`, `rls-policies`).
2. **Done 2026-10-27:** #50 was merged first (merge commit `217e566`) and the focused hosted account checks were run immediately afterwards on Production. Their results are recorded in [people-access-account-controls-verification.md](./people-access-account-controls-verification.md) as **partially verified**: the token window, resend invitation, the plain-account unauthorised view and a reset ending another session are **not verified**. The owner decided to proceed to the migration preparation with those items open. **Step 1 below is therefore done; steps 2 to 7 (the security migration and #51) proceed one SQL step at a time.**

## The order

**1. Merge #50** (no SQL). Use *Create a merge commit* and delete the branch afterwards, so #51 retargets to `main` by itself; if it does not, change #51's base to `main` by hand. Wait for the production deployment of `main`.
   *Look at it:* open `/people-access` as yourself; open `/admin/users` and `/sales/access` and confirm each lands on People & Access. *If wrong:* revert the merge commit; no data was touched.

**2. SQL step 1: preflight (read-only).** Run `supabase/manual-sql/grant_rules_00_preflight_readonly.sql`. Paste me the whole result.
   *Continue only if:* every row of section B says `OK`, and *rules applied already?* says *not applied yet*. Section D lists who is affected; it is information, not an error.

**3. SQL step 2: snapshot (read-only).** Run `supabase/manual-sql/grant_rules_05_preservation_check_readonly.sql` exactly as it is. Export the result and keep the whole `paste` column: it is the only record of the "before", and step 6 needs it.
   *Continue only if:* it ran without error, you have saved the export, and you have read section D of step 2 (who is affected). If it names someone who would lose a way of working you rely on, stop and tell me.

**4. SQL step 3: apply the migration.** Paste the whole of `supabase/migrations/20261215000000_access_grant_rules.sql` into the SQL Editor and run it once. It replaces six functions in place and changes no grant row. It is safe to run twice.
   *Continue only if:* it finishes without error.
   *If wrong:* run `supabase/manual-sql/grant_rules_90_rollback.sql` (read its header first: going back re-opens the three gaps; it changes no grant).

**5. SQL step 4: verify (read-only).** Run `supabase/manual-sql/grant_rules_20_verify_readonly.sql`.
   *Continue only if:* the last row (`SUMMARY`) says `OK … 0 failing`.

**6. SQL step 5: preservation compare (read-only).** Paste step 3's lines into `grant_rules_05_preservation_check_readonly.sql` where it says `>>> PASTE <<<` (above the `('__none__', '')` line, which stays) and run it.
   *Continue only if:* the summary starts with **PASS** (every existing grant identical, nothing else changed).

**7. Merge #51** (no SQL), after #50 is on `main` and #51 shows only its own changes. Wait for the production deployment.
   *Look at it:* open a colleague's *Module access* tab for Project budgets: *CEO / CTO approver* is available to you; on your own person, presets that would add rights to you are greyed out with the reason. *If wrong:* revert the merge commit; the database rules stay as applied.

**8. Record it.** Tell me the results; I will mark both pull requests done and note the dates in the deployment document.

## Deployment record (V2, 2026-10-27, run by the owner)

Every step was run by the owner in the V2 SQL Editor, one at a time; no SQL was applied from this session. Values are as reported.

| Step | Result |
|---|---|
| 2 Preflight (read-only) | passed: section B all `OK`, rules "not applied yet" |
| 3 Snapshot (read-only) | taken: 9 structure fingerprints, 4 grant-row fingerprints, 6 function fingerprints, 6 function privilege sets |
| 4 Apply migration | applied without error (the owner first suspected a partial run; step 5 shows the whole file ran) |
| 5 Verify (read-only) | **73 checks OK, 0 failing**; Budget approvers: Enginious LLC FZ, 1 eligible of 1; active grants Sales 3, Projects 3, Inventory 3, Budget 1 |
| 6 Preservation compare (read-only) | **PASS**: every existing grant identical (4 of 4 tables), nothing else in the schema changed (9 fingerprints identical), the six functions carry the new rules and keep the same privileges |

Function fingerprints (md5 of the definition), before and after:

| Function | Before | After |
|---|---|---|
| `crm_grant_access` | `115d73c225a464709e7b3ef3a3873680` | `141f4c2536da75d68df1fd9edf1de939` |
| `crm_revoke_access` | `d39669a14c1e108abb823621b5b777b4` | `1764a71a45e2d7af7a7dad755d811640` |
| `inv_revoke_access` | `361d66b1308d151ecb4522e39fb27ef1` | `5cc5180e16f21cbc8b94e6b36a6ca86e` |
| `pbx_grant_access` | `05bc5b6368d8e202e3748618f5c3762e` | `1fa02eca42478bc1be0aa2ca1c70e31e` |
| `pbx_revoke_access` | `c771e7efe73a89065c2c83a4b321d80b` | `ff44ae79f5911a91b95aa9c880488f82` |
| `proj_revoke_access` | `ff44752d1e0eb7acde49eaf4ad3aeac9` | `09f1ce11e4bc6336fe807e53e06d0761` |

Unchanged by the migration (same before and after): the six function privilege sets, the grant rows (`rows:budget` `1:7415b8f0…`, `rows:inventory` `3:81d1ab3d…`, `rows:projects` `3:43f4b86b…`, `rows:sales` `3:69acb3a8…`), and the nine structure fingerprints (columns `09a01efe…`, constraints `5f74bb54…`, indexes `345c1ecf…`, other-function privileges `6f73ab50…`, other functions `020a0951…`, policies `16fd38fa…`, table privileges `fe897630…`, triggers `7ad79d39…`, views `eefb27f0…`).

**Not done:** step 7 (merge #51) and the post-merge look at the screen. **Not verified:** the hosted items listed in [people-access-account-controls-verification.md](./people-access-account-controls-verification.md) ("Still not verified") are unchanged by this deployment. The rollback script was not used.

## Things that are never part of this

No Vendors & Purchasing work, no automatic System Administrator bootstrap, no new delegation hierarchy, no real access granted, no real staff account touched. The recovery route when nobody eligible remains is unchanged: the module's owner script (`pbx_30_bootstrap_access.sql`, `crm_30_`, `proj_30_`, `inv_30_bootstrap_founders.sql`).

## Where each file is

The scripts and the migration are on branch `feat/people-access-grant-rules` (PR #51) and reach `main` at step 7. For steps 2 to 6 open them from that branch on GitHub (*Files changed* on #51, then *View file* and *Raw*), or ask me to paste any of them here.
