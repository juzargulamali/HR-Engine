# People & Access: security-rule changes proposed for approval

**Status: R1, R2 and R3 are APPROVED and implemented as a separate migration (`supabase/migrations/20261215000000_access_grant_rules.sql`), with an owner-run deployment pack: see [people-access-grant-rules-deployment.md](./people-access-grant-rules-deployment.md). Nothing has been applied to any hosted project.** The People & Access screen (see [people-access-design.md](./people-access-design.md)) changes where access is managed, not who may grant what.
Each change below alters a security rule in the database, so each was approved on its own (R1, R2 and R3, subject to preserving existing grants, company boundaries and owner-SQL recovery, and with the last eligible Budget approver protected). Until the migration is applied on a project, every rule there is exactly as it was.

## Two different things

| | Access administration | Transaction self-approval |
|---|---|---|
| Question | Who may create or change the person who later decides something? | May the person who prepared or submitted a thing also decide it? |
| Where enforced | the four `*_grant_access` / `*_revoke_access` functions | guard triggers on budget versions and actual-expense submissions (`cannot be decided by the person who prepared or submitted it`) |
| Status | **gaps found (below)** | **holds**: proven again in the findings test; a submitter who gave themselves the approver right still could not decide their own budget |

The gaps are therefore not "someone approves their own request". They are "someone chooses who will approve it", and "someone gives themselves a right nobody delegated".

All findings were reproduced against a real Postgres built from every migration (the file `packages/rls-tests/test/people_access_findings.rls.test.ts` recorded the behaviour before the fix). That file became `packages/rls-tests/test/access_grant_rules.rls.test.ts`: each "FINDING" assertion now proves the fix (the same scenario is refused), and the unchanged rules are still asserted.

## Findings

### F1. Budget: the submitter can appoint their own approver (approval bypass), **confirmed**

*Setup.* A company has a Finance person who is also its Budget access manager (`finance`, `manage_access`) and no CEO / CTO approver. That person is also the Project Manager of a project.
1. Because they hold Finance, their budget is routed to the CEO / CTO approver (by design). The company has none, so it is **held**: nobody can decide it.
2. They call `pbx_grant_access` and give `executive_approver` to a colleague who has no other budget access.
3. The colleague approves the budget. It is **approved**, although no CEO or CTO ever authorised anyone.

Why it matters: the independence rule exists so that the person asking for money is not the person who decides. Here the submitter picked the decider. The same applies to the final expenses and to confirming receipts and closing the settlement.

### F2. Budget: an access manager can give themselves any budget right, **confirmed**

`pbx_grant_access` lets a holder of `manage_access` replace their own capability set with `{finance, manage_access, executive_approver}`. The transaction rule still stops them deciding their own submissions (shown in the test), but they now decide other Finance people's submissions and confirm other people's receipts, and they have given themselves Finance without anyone delegating it.

### F3. Sales: an access manager can give themselves the commercial-approval-rules right, **confirmed**

`crm_grant_access` only protects an existing *founder's* rights from a non-founder. A Sales access manager (not a founder) can replace their own set with `{manage_settings, manage_approval_rules}` and then change the company's commercial approval policy (`crm_upsert_settings` is documented as "reserved to a founder or a delegated rules manager"; the person delegated it to themselves).

### F4. Revoking: the database is looser than the screens, **confirmed, minor**

The screens say only a founder can change a person who holds a founder or access-management right. `proj_grant_access` and `inv_grant_access` enforce that for granting, but `crm_revoke_access`, `proj_revoke_access` and `inv_revoke_access` only protect a *founder* target, so a non-founder access manager can withdraw another access manager (reproduced for Projects; Sales and Inventory contain the same check by reading). This can remove someone's ability to administer; it cannot create a right. (`pbx_revoke_access` protects only the last manager.)

### Checked and **not** a gap

* **System Administrator** cannot grant any module access (it holds no module right by title). Unchanged.
* **Projects and Inventory self-grant is already blocked**: an access manager cannot change their own row ("changing an access manager's rights is a founder's decision"). Giving *another* person those rights is delegation by design.
* Founder and access-management rights (and Inventory cost rights) can only be handed out by a founder. Unchanged.
* **Last access administrator** is protected everywhere (last founder; Budget: last access manager). If the only holder's login is deactivated nobody eligible remains inside the app, and recovery is the owner-run script (tested; see the design document). No change proposed.

## Proposed changes (narrow, one migration)

An additive migration replaces only the grant and revoke functions it names (`create or replace`), adds no table, no column, no trigger on an existing table, and no new role or delegation tier. It would be applied by you in the SQL Editor with the usual verify and preservation checks.

| # | Rule | Fixes | Who is affected |
|---|---|---|---|
| **R1** | In a company, only a holder of `executive_approver` may add or remove `executive_approver` (by grant or by revoke). The first approver is still named by the owner-run `pbx_30_bootstrap_access.sql`. | F1 | Budget access managers who are not themselves approvers can no longer appoint approvers |
| **R2** | A caller may not **add** a right to their **own** grant (Budget: any right; Sales: any right). Removing their own right stays allowed, subject to the last-manager rule. | F2, F3 | Access managers can no longer grant themselves anything; they can still grant others, as today |
| **R3** | A non-founder cannot withdraw a person who holds a founder-only right (Sales, Projects, Inventory) or `manage_access` — the same rule granting already applies. | F4 | Non-founder access managers can no longer withdraw other access managers |

**Preset-based grants.** The screen applies a preset as a normal call to the same function, so R1 to R3 apply to presets automatically. The screen would also disable what the database would refuse and say why ("Only a CEO / CTO approver of this company can give this right"; "You cannot add rights to your own access"), so a refusal is explained before the click. No preset needs to change.

**What is deliberately not in this proposal** (per your instructions): no automatic System Administrator bootstrap, no new delegation hierarchy, no two-person approval of grants, no widening of the System Administrator.

**What R1 means for you today.** `juzar@enginious.ae` holds `finance`, `executive_approver` and `manage_access` for Enginious LLC FZ, so under R1 you can still give and remove the approver right there. Any other Budget access manager (for example one named later) could not, until they are themselves an approver.

### Tests that would accompany it

* For each of R1 to R3: refused for the caller in the finding's scenario (F1: the colleague is never appointed; F2/F3: the self-grant is refused and the existing set is unchanged), allowed for the people the rule still allows (an approver appointing a second approver; a founder; granting *another* person; removing one's own right when another manager exists).
* The transaction rule is re-proved unchanged (submitter cannot decide their own submission).
* Idempotent re-application of the migration; no change to any non-`pbx_`/`crm_`/`proj_`/`inv_` structure (the preservation check).
* The screen: disabled options and explanations for each refusal.

## Decisions

R1, R2 and R3: **approved**, with the conditions above. Implementation notes that go beyond the proposal's text:

* R1 protects the last **eligible** approver (an active person holding the right) and serialises Budget grant and revoke changes per company, so a race cannot remove the last two.
* R2: stepping down (removing one's own right) stays allowed; a Sales founder is exempt because nothing is an addition in effect.
* R3 also closes the matching hole in Sales' **grant** function (a non-founder replacing another access manager's rights), so the rule cannot be sidestepped through the other function. Projects and Inventory grant functions already had it.
* Stepping down oneself by revoke stays allowed in Sales, Projects and Inventory (it only removes power).
