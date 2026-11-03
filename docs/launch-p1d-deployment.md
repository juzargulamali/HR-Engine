# Launch correctness package 1d: manual database steps (completion pass)

**Nothing here has been run on any hosted project.** Three small database changes, applied by you in the Supabase SQL Editor of **Enginious HR Engine_V2** when you decide to. Each has the same five steps as package 1b and 1c (the file names start with the prefix shown in each heading):

1. **Preflight (read-only):** `<prefix>_00_preflight_readonly.sql`. Section B must say `OK` on every row and *not applied yet*. Section D is information (for the first change it is the **hosted answer** to "does this change anything for anyone today").
2. **Snapshot (read-only):** `<prefix>_05_preservation_check_readonly.sql`, exactly as it is. Keep the whole `paste` column.
3. **Apply:** paste the migration into the SQL Editor and run it once (safe to run twice).
4. **Verify (read-only):** `<prefix>_20_verify_readonly.sql`; the last row must say `OK … 0 failing`.
5. **Preservation compare (read-only):** paste the step 2 lines where the comment says `>>> PASTE <<<` and run the same file again. The summary must start with **PASS**.

Rollback for each: `<prefix>_90_rollback.sql` (read its header first). Each pack was run end to end on a throwaway database built from every migration (preflight, snapshot, apply twice, verify, compare = PASS, rollback twice, verify shows the change as missing, apply again).

## The one installation order for the whole stack

The same list, with the owner pack prefixes and the three optional data-writing files, is `docs/launch-refinement-install-order.md`.

Migration timestamps sort in installation order across packages 1 -> 2 -> 3. Apply **in file-name order**; skip none that a later one needs.

| Order | Migration | Package | Needs |
|---|---|---|---|
| 1 | `20261216000100_inv_issue_to_employee_consumes_reservation.sql` | 1b (A7) | Inventory |
| 2 | `20261216000200_proj_scope_proposal_notifies_deciders.sql` | 1b (A11) | Projects |
| 3 | `20261216000300_account_deactivation_inactive_people.sql` | 1c (A12) | |
| 4 | `20261216000400_profiles_status_columns_restricted.sql` | 1c (A13) | |
| 5 | `20261216000500_attendance_lead_candidates.sql` | 1c (A14) | |
| 6 | `20261216000600_recovery_decider_inbox.sql` | 1c (A15) | |
| 7 | `20261216000700_policy_status_role_check.sql` | 1c (A16) | |
| 8 | `20261216000800_letters_storage_issued_only.sql` | 1c (A17) | |
| 9 | `20261216000810_approval_routing_country_scope.sql` | **1d** | needs 3 (`user_is_active`) |
| 10 | `20261216000820_proj_scope_decision_context.sql` | **1d** | Projects |
| 11 | `20261216000830_pbx_decisions_waiting_count.sql` | **1d** | Project budgets |
| 12+ | `20261216000900` and later | package 2 | |
| last | `20261217000100_inv_project_notes.sql` and later | package 3 | |

Every migration is additive and idempotent. The application degrades safely when one of them is missing: a screen that needs a missing function says it could not load that part (or, for the menu number, shows no number), it never shows an empty list or a zero.

## 1. Approval routing honours the country on a role grant (prefix `apprscope`, `20261216000810_approval_routing_country_scope.sql`)

**The defect (reproduced locally before the fix).** `resolve_approver()` and `resolve_approver_for_company()` honoured the *company* limit on a role grant but ignored its *country* limit, so a CEO (or any role holder) limited to one country was resolved as the approver of every company that had no company-limited holder, in every country.

**The rule (taken from the existing design, not new).** `user_roles` are "optionally scoped to a company/country, e.g. HR Admin for Poland only" (`docs/02-database-schema.md`), and `has_role()` applies a grant when its company is empty or the company asked about **and** its country is empty or the country asked about. Policies, the draft functions and the Recovery Leave checks already work this way. The migration applies the same test when a **new** request is routed: a grant limited to a country applies to the **employee's** country (`resolve_approver`) or the **company's** country (`resolve_approver_for_company`). Grants with no country limit (company-only, global) resolve exactly as before; inactive, terminated and revoked holders are still skipped; the CEO-or-CTO meaning of `role:ceo`, the oldest-grant-first order and the self-approval refusals are unchanged.

**What it deliberately does not do.** Approvals **already pending** are not touched: nothing is re-routed and there is no re-route action (the pending approval keeps its assigned person; this is tested). The shared-queue checks that run when someone decides a Recovery Leave step, and `resolve_role_holders()` (who is emailed), are not changed.

**Hosted check first.** Preflight section D lists every active grant limited to one country. If it says `none`, this migration changes nothing for anyone today.

**Tested locally:** `packages/rls-tests/test/approval_routing_scope.rls.test.ts` (reproduction failing before, passing after: country-only, company-only, global, company-and-country together, inactive and revoked holders, the managerless CEO/CTO fallback, another role, and a pending approval staying on its assigned person) and the existing deactivation routing test.

## 2. A holder of scope approval can open the decision without belonging to the project (prefix `scopectx`, `20261216000820_proj_scope_decision_context.sql`)

**What was checked first.** `proj_decide_scope_change()` already authorises exactly the capability `approve_scope` (a Projects founder holds every capability) and asks for **no** project membership. So the capability already authorises the decision; what was missing was the ability to *see what is being decided*: a holder who is neither a founder nor a member could not read the proposal (row-level security needs founder or membership), was not told, and could not open the page. No new permission decision is needed.

**What the migration does.** Adds two read-only functions that return only what the decision form needs, only to people the decision function already authorises:

* `proj_scope_decisions_waiting()`: the open proposals the caller may decide now: proposal id, project id, project reference and name, the proposal title, when it was proposed. My Day counts and links from it.
* `proj_scope_decision_context(id)`: one proposal: the same plus the **proposed scope text**, the stated **effect on dates**, who proposed it (display name), its status and whether it can still be decided. An unknown proposal, or a caller who may not decide it, gets no row.

**Exactly what becomes visible to a scope approver who is not on the project:** the project's reference and name (already readable to everyone with a Projects grant), the proposal's title, proposed scope text, effect-on-dates note, proposer's name and date. **Not returned, and tested as not returned:** the project's *current* scope or any other project field, members, tasks, budget, handover, files, discussion, the cost effect of the proposal (stays behind commercial access), feedback, decision notes. Nobody becomes a member, and no table policy changes.

**Application change.** My Day's "Scope changes waiting for your decision" row now opens `/projects/scope-decisions/<id>`, a small page that shows the proposal and the existing **Decide** form (approve or reject, reason required, the same function). Founders and members, who can read the proposal, are sent to the project's own *Feedback & changes* page exactly as before. The "notification" for someone who cannot open the project **is** that My Day row: the notice reader (`proj_my_notifications`) shows project participants only and is deliberately unchanged, so writing a notice they could not read would help nobody.

**Decision for you, if you want it stricter or looser.** The page shows the *proposed* scope but not the *current* scope it replaces (the approver would see the "before" text only if they open the project). Showing the current text to a non-member would reveal one more project field; it is not done here.

**Hosted check first.** Preflight section D lists who holds scope approval without being a founder (the people this helps) and how many proposals wait.

**Tested locally:** `packages/rls-tests/test/project_scope_decision_context.rls.test.ts` (reproduction, exact column lists, no commercial data, no table readable, refused when called directly by a plain member, the proposer, a commercial reader, an outsider, another company's founder, an inactive holder and anonymous callers), and the page and My Day tests.

## 3. A cheap "waiting for your decision" number for the Finance menu (prefix `pbxwait`, `20261216000830_pbx_decisions_waiting_count.sql`)

**Why a new function.** The Finance menu entry can show how many budgets and final-expense sets wait for the person. `pbx_inbox()` also computes settlement figures for every open budget, far too heavy to run on every page, and there was no cheaper count.

**What it does.** `pbx_decisions_waiting_count()` returns one number: submitted budget versions plus submitted final-expense sets that the caller may decide **now** (the same tests the inbox uses: a company they can read, the route's capability, never the person who prepared or submitted it, not on hold). Settlement follow-ups are not in this number; they stay in the Finance inbox and on My Day. It returns a number only (no project, amount or company). The menu asks only people who can decide (Finance or CEO/CTO approver); a failed read shows **no number** and the existing "Some menu items could not be loaded" notice, never 0.

**Project Managers.** No new function is needed: the existing row-level security already lets the current PM read the budget, its versions (status, decision note) and the final-expense sets of their own project, and nothing else (tested). My Day uses that for a PM: *returned to you* (needs their changes), *waiting on others*, and a quiet *decisions on your projects in the last 14 days*. Self-prepared items stay under *Waiting on others* and are never counted as a decision for the person.

**Tested locally:** `packages/rls-tests/test/pbx_waiting_and_pm_state.rls.test.ts` (the number equals the inbox's decidable rows for every person, 0 for people who cannot decide, own submissions never counted, other companies excluded, anonymous refused; the PM reads their own project's states and no other project's), and the layout, menu and My Day tests.

## Company-only HR Admin and the Policies page (no database change)

Since A16 (`20261216000700`), `preflight_phase2b_v2_policy_status()` answers only HR Admin, CEO or CTO whose grant is not limited to one company. This section records what a **company-only HR Admin** (an HR Admin grant limited to one company) can and cannot do with policies, so it is a known outcome and not a surprise.

**Intended outcome (already the rule since the policy engine, not changed by A16):**

* They **keep** the Policies list, read-only, showing the **active** versions (what `policy_versions_select` always gave them). They keep Public holidays.
* They do **not** see draft versions, do not get the *Draft a policy* or *Create … drafts* buttons, and cannot draft, edit, activate or delete a policy: the draft functions and the table policies need an HR Admin grant that is **not** limited to one company for that country (`has_role('hr_admin', null, country)`). The reason is in the design: a single-company HR Admin manages that company's employees but should not unilaterally change a policy that can affect every company operating in that country (`docs/02-database-schema.md`, section 2.4).
* CEO and CTO with a country-wide grant read drafts and can activate a draft someone else drafted; they do not draft.

**Why this is not a broken workflow.** Before A16 the page also showed the draft buttons only to people for whom `canDraftPolicy` is true (the same country-wide rule), and the database refused everyone else. A16 only stopped the status function answering people who cannot read drafts. No screen a company-only HR Admin could use before has been removed, and no access was broadened to restore one.

**If you want company-only HR Admins to draft** that is a policy decision (it lets one company's HR change rules for a whole country); it needs a new rule and is not part of this work.

**Tested locally:** `packages/rls-tests/test/policy_company_only_hr.rls.test.ts` (list = active versions only; drafts invisible; the status function returns nothing; both draft functions and a direct insert refused; edit, activate and delete touch no row; the country-wide HR Admin keeps everything) and the Policies page tests.

## Noted, not changed

* The two "Create drafts" buttons need an HR Admin grant for **all three** countries (AE, SA, PL) because the draft functions loop over all three, while the page offers the buttons to an HR Admin limited to one country, who is then refused with a clear message. Pre-existing; outside this work.
* `resolve_role_holders()` (used to choose who is emailed about leave) still ignores the country limit on a grant, so a country-limited holder could be emailed about another country's request. Notification only; no decision is affected.
