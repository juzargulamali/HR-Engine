# People & Access: exact deployment order

Two stacked pull requests and one security migration. **Nothing below has been run or merged.** Merging a pull request never touches the database: no workflow in this repository applies a migration, so every SQL step is yours, one at a time, in the SQL Editor of **Enginious HR Engine_V2**.

| | What | SQL? | Changes who may grant what? |
|---|---|---|---|
| **PR #50** `feat/people-access` → `main` | The People & Access screen, account controls moved, old addresses redirect, "Reporting manager" wording, policy-test correction, account-control tests | none | no |
| **PR #51** `feat/people-access-grant-rules` (stacked on #50) | The R1 to R3 migration file, its owner-run scripts, the screen's explanations of the new refusals | the migration is **not** applied by merging | only once you run step 4 |

**Why this order.** The screen (#50) needs no SQL and changes no rule, so it goes first. The migration is applied (step 4) **before** #51 is merged (step 7), so the screen never explains a refusal that the database does not yet make. If you apply the migration while only #50 is live, nothing breaks: a refused change shows the database's own message in words.

## Gates before step 1

1. CI is green on #50 (`lint-typecheck-test`, `rls-policies`, `e2e-read-only`) and on #51 (`lint-typecheck-test`, `rls-policies`).
2. You have decided about the hosted account-control test (steps H1 to H8 in [people-access-account-controls-verification.md](./people-access-account-controls-verification.md)). #50 is the change that moved the account controls, so run it against the #50 preview first, or accept in writing that invitations and the real ban were verified only against the local stand-in.

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

## Things that are never part of this

No Vendors & Purchasing work, no automatic System Administrator bootstrap, no new delegation hierarchy, no real access granted, no real staff account touched. The recovery route when nobody eligible remains is unchanged: the module's owner script (`pbx_30_bootstrap_access.sql`, `crm_30_`, `proj_30_`, `inv_30_bootstrap_founders.sql`).

## Where each file is

The scripts and the migration are on branch `feat/people-access-grant-rules` (PR #51) and reach `main` at step 7. For steps 2 to 6 open them from that branch on GitHub (*Files changed* on #51, then *View file* and *Raw*), or ask me to paste any of them here.
