# Access grant rules R1 to R3: manual deployment

**Nothing here has been run on any hosted project.** This is the step-by-step guide for you to run in the Supabase SQL Editor of **Enginious HR Engine_V2** when you decide to. The migration is separate from the People & Access screen (that screen needs no SQL), so it can be reviewed, applied, paused or rolled back on its own.

The rules, their reasons and the findings behind them: [people-access-security-proposal.md](./people-access-security-proposal.md) (you approved R1, R2 and R3, subject to preserving existing grants, company boundaries and owner-SQL recovery, and with the last eligible Budget approver protected).

## What it changes, in one paragraph

`supabase/migrations/20261215000000_access_grant_rules.sql` replaces **six functions** in place (`create or replace`): `pbx_grant_access`, `pbx_revoke_access`, `crm_grant_access`, `crm_revoke_access`, `proj_revoke_access`, `inv_revoke_access`. It adds no table, column, trigger, policy or privilege, and it does not touch a single grant row. **Nobody gains or loses any access by applying it.** What changes is who may *change* access afterwards:

| Rule | Effect |
|---|---|
| **R1** (Budget) | Only a CEO / CTO approver of a company can give or remove the approver right in that company. The last **eligible** approver (an active person holding the right) can never be removed. Budget grant and revoke changes are applied one at a time per company, so two approvers cannot remove each other at the same moment. |
| **R2** (Budget, Sales) | Nobody can add a right to their **own** access. Taking one's own right away stays allowed. A Sales founder already holds every Sales right, so nothing they could type is an addition. |
| **R3** (Sales, Projects, Inventory) | A person who is not a founder cannot withdraw another access manager (Inventory: or a cost reader). Stepping down oneself stays allowed. In Sales, a non-founder also cannot replace another access manager's rights through the grant function (Projects and Inventory already refused that). |

Unchanged: who may grant what otherwise, company scope, the founder-only rights, every earlier refusal and its wording (new refusals are added, none removed), the last-founder and last-access-manager protections, the live-Project-Manager guard on withdrawing Projects access, and the transaction guard that stops anyone deciding what they prepared or submitted.

**Presets cannot bypass it.** The screen applies a preset by calling these same functions, so the rules apply to presets automatically. The repository's database test runs **every preset of every module** against the database, for every kind of person and for both another person and oneself, and requires the database to agree with the screen's rule in all cases (over 100 comparisons per module, both for granting and for revoking).

**There is no other way in.** A catalogue test proves that exactly these eight grant/revoke functions (the six above plus `proj_grant_access` and `inv_grant_access`) are the only functions that can write a grant table, that none builds SQL dynamically, that no trigger changes rights, and that the tables have row-level security with a read-only policy. The owner-run scripts write the tables as the database owner and need no in-app permission; that is the recovery route and it is unchanged.

## Before you start: what it means for you today

* In V2, `juzar@enginious.ae` holds Budget `finance`, `executive_approver` and `manage_access` for Enginious LLC FZ. Under R1 you can still give and remove the approver right there. Because you are the **only eligible approver**, the approver right cannot be removed from you (by design) until you have named a second one.
* If you later name another Budget access manager who is not an approver, they keep every right they have but cannot give or remove the approver right, and cannot add rights to their own access.
* If a company ever has **no eligible approver**, the application cannot name one (only an approver can). The owner script `pbx_30_bootstrap_access.sql` does it, as it did for you. Budgets submitted by someone who holds Finance already wait for an approver today; nothing about that changes.
* Sales, Projects, Inventory: people who manage access but are not founders keep all their rights; they can no longer withdraw one another (a founder can).

## Steps

Run each file in the SQL Editor, paste the **whole** result back to me, and wait for my reply before the next step.

1. **Preflight (read-only).** `supabase/manual-sql/grant_rules_00_preflight_readonly.sql`. Every row of section B must say `OK`, and the row *rules applied already?* must say *not applied yet*. Section D lists who is affected (information, not errors). Section C records the six functions as they are today.
2. **Snapshot (read-only).** `supabase/manual-sql/grant_rules_05_preservation_check_readonly.sql`, **exactly as it is**. Export the result and keep the whole `paste` column.
3. **Apply the migration.** Open `supabase/migrations/20261215000000_access_grant_rules.sql`, paste the whole file into the SQL Editor and run it once. It is safe to run twice.
4. **Verify (read-only).** `supabase/manual-sql/grant_rules_20_verify_readonly.sql`. The last row (`SUMMARY`) must say `OK … 0 failing`. It checks that the eight functions are security definer with a fixed search path, callable by signed-in users and not by anonymous visitors; that each of the new rules is in the right function **and** that every earlier protection is still there; that nothing else can write a grant table; and that the four grant tables are read-only for browsers.
5. **Preservation compare (read-only).** Paste the lines from step 2 into `grant_rules_05_preservation_check_readonly.sql` where the comment says `>>> PASTE <<<` (above the `('__none__', '')` line, which stays) and run it again. The summary must start with **PASS**: every existing grant identical (4 of 4 tables), nothing else in the schema changed, the six functions carry the new rules and keep the same privileges.
6. **Look at it in the application (once the People & Access screen is deployed).** Signed in as yourself, open a colleague's *Module access* tab for Project budgets: the *CEO / CTO approver* preset is available to you (you are an approver). Open your own person: presets that would add rights to you are greyed out with the reason. (A Finance-only access manager would see *CEO / CTO approver* greyed out.)

What I tested locally (a throwaway database built from every migration, including this one): the migration, the three scripts above run exactly as you will run them (snapshot before, apply, verify, compare = PASS), the rollback, and the rules themselves (`packages/rls-tests/test/access_grant_rules.rls.test.ts` and `access_grant_rules_preservation.rls.test.ts`). I cannot see your project, so steps 1 to 5 on V2 are the first time they run there.

## If something blocks work it should not

`supabase/manual-sql/grant_rules_90_rollback.sql` restores the six functions to exactly what they were before (verified by fingerprint in the database test). Read its header first: **going back re-opens the gaps** (a Budget submitter appointing their own approver, an access manager granting themselves rights, a non-founder withdrawing another access manager). No grant is ever changed by the migration or the rollback. After a rollback, `grant_rules_20_verify_readonly.sql` reports the new rules as missing (that is how it tells you the old rules are back).

## When nobody eligible remains (recovery)

Unchanged and tested: the owner scripts write the grant tables as the database owner and need no in-app permission.

* No eligible Budget approver (none named, or the only one deactivated): run `pbx_30_bootstrap_access.sql` with the person's e-mail, the company and `executive_approver` (add `manage_access` if they should also manage access).
* No Sales / Projects / Inventory founder: `crm_30_bootstrap_founders.sql`, `proj_30_bootstrap_founders.sql`, `inv_30_bootstrap_founders.sql`.
* No automatic System Administrator route exists and none is added.

## Known limits

* The *last eligible approver* guard counts active people only. If the sole approver is deactivated, a Finance access manager still cannot appoint one (that is the point); use the owner script.
* An approver can appoint another approver (a CEO naming a CTO). That is the intended delegation. Independence is still enforced where it matters: nobody can decide a budget they prepared or submitted.
* The checks in `grant_rules_20_verify_readonly.sql` read definitions and privileges; they cannot call a function without writing. The behaviour of each rule is proved by the repository's database tests, not by the hosted verify script.
