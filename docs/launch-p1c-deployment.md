# Launch correctness package 1c: manual database steps

**Nothing here has been run on any hosted project.** Each section below is one database change from the launch correctness work (accounts, confidentiality and a few visibility fixes). Each is applied by you, in the Supabase SQL Editor of **Enginious HR Engine_V2**, when you decide to; each can be reviewed, applied, paused or rolled back on its own. The application changes that go with them need no SQL. Run each file, paste the **whole** result back, and wait for a reply before the next step.

**Installation order for the whole stack: `docs/launch-refinement-install-order.md` (one list, 14 migrations, `20261216000100` to `20261217000100`; packages 1 then 2 then 3).** This guide covers #3 to #8 of that list.

Every section has the same five steps (the file names start with the prefix shown in each heading):

1. **Preflight (read-only):** `<prefix>_00_preflight_readonly.sql`. Section B must say `OK` on every row and *not applied yet*. Section D is information, and for some changes it is the **hosted answer** to a question the local copy could not settle (marked *READ-ONLY CHECK*).
2. **Snapshot (read-only):** `<prefix>_05_preservation_check_readonly.sql`, exactly as it is. Keep the whole `paste` column.
3. **Apply:** paste the migration into the SQL Editor and run it once (safe to run twice).
4. **Verify (read-only):** `<prefix>_20_verify_readonly.sql`; the last row must say `OK … 0 failing`.
5. **Preservation compare (read-only):** paste the step 2 lines where the comment says `>>> PASTE <<<` and run the same file again. The summary must start with **PASS**.

Rollback for each: `<prefix>_90_rollback.sql` (read its header first). Apply them in file-name order (the one installation order above; #9 needs #3). Each one is independent of the others' data, and the application's Approvals, Attendance clock, Policies, Letters and People & Access screens use the new functions: apply the migration for a screen before (or together with) releasing that screen, or the screen says it could not load the new part (it never shows an empty list instead).

**What the local checks showed (each reproduced on a throwaway copy before it was fixed):**

| Item | Reproduced locally? | Hosted confirmation still needed |
|---|---|---|
| A12 Deactivation | Yes: `set_account_status` left `is_active` true; the leaver was still resolved as approver | Preflight section D lists accounts deactivated earlier |
| A13 Deactivation reason readable | Yes, on a copy with Supabase's default table grants | Preflight section D says what signed-in users can read **today** |
| A14 Project-lead picker | Yes: a plain employee's list held only themself | None |
| A15 Recovery Leave cards | Yes: the lead could not read the applicant's name; a CEO could not read an HR Admin's request | None |
| A16 Policy status function | Yes: a plain employee received all 12 slots with the draft values | Preflight section D says who can execute it **today** |
| A17 Letters pending | Yes: the employee could read the stored file of a pending letter | Preflight section D lists the storage policy and any template that mentions pay |

## A12. Deactivation makes a person inactive (prefix `deact`, `20261216000300_account_deactivation_inactive_people.sql`)

**The defect.** Deactivating an account stopped sign-in but left the person "active" for access checks, pickers and approval routing. A leaver stayed selectable as project manager, team head or approver and stayed the approver of record for new requests.

**What the migration does.** Replaces eight functions in place and adds three: deactivating now sets `profiles.is_active` in the same step (reactivating restores it); the approver lookups, the role-holder list, the Recovery Leave routing and the role-queue check skip inactive people, so a **new** request goes to the next holder (and says so, in the existing words, when nobody is left); the last active System Administrator (existing rule, same wording), the **only CEO / CTO budget approver** of a company and the **only CEO or CTO** of a company cannot be deactivated (the message names the company); a System Administrator can read what the person still holds (counts and project **reference codes** only, no names or amounts) before deactivating; and a person can no longer change their own `is_active`.

**What it deliberately does not do.** Approvals **already pending** on the person are left exactly as they are: nothing is re-routed and there is no re-route action (your decision). A session already open ends at its token expiry as before (sign-in itself is blocked through the Admin API, unchanged). `has_role()` and the other checks on the caller are unchanged.

**Application change.** People & Access, Account tab: **Deactivate** now opens an in-page panel that first shows what the person still holds (pending approvals, projects, teams, HR roles, module access, equipment) and anything that stops it, then asks for the reason in a labelled field (no browser dialog). The check runs **before** sign-in is blocked, so an account the database will refuse is never locked out first. A deactivated account shows its reason, date and who did it to the System Administrator.

**Optional one-off step.** Accounts deactivated **before** this change are shown as Deactivated but are still flagged active. Preflight section D lists them. `deact_30_align_deactivated_accounts_OPTIONAL_writes.sql` sets the flag for exactly those accounts (step 1 lists them read-only, step 2 writes and returns an undo list; it skips anyone who is the only CEO / CTO or budget approver of a company and tells you). **It is the only file in this package that writes data; run it only if you decide to.**

**Tested locally:** `packages/rls-tests/test/account_deactivation.rls.test.ts` (flag, reactivation, next-holder routing for manager / Finance / CEO / the managerless fallback, a pending approval staying put, the three protected people, only a System Administrator, nobody can flip their own flag, the internal helpers not callable by signed-in users), the whole RLS suite, and the five scripts above including the rollback (fingerprints restored).

## A13. The deactivation reason is no longer readable by everyone (prefix `profstat`, `20261216000400_profiles_status_columns_restricted.sql`)

**The defect.** Every signed-in user could read every profile column, including the free-text reason a System Administrator types when deactivating someone (it can describe misconduct), who recorded it and when.

**What the migration does.** Limits `SELECT` on `profiles` to the directory columns (`id, email, full_name, locale, is_active, account_status, created_at, updated_at`), so `status_reason`, `status_changed_by` and `status_changed_at` can no longer be read directly by anyone signed in; a System Administrator reads them through a new function that checks the role inside. Names, e-mails and the status stay readable for the pickers; row visibility, update rights, first-sign-in activation and the audit trail are unchanged. **Two things to know:** `select *` on `profiles` is now refused to signed-in users (nothing in the application does it), and a column added to `profiles` later starts private until granted.

**Hosted check first.** Preflight section D shows what signed-in users can read **today** (`status_reason: true` means exposed). Nothing needs doing if it already says `false`; the migration is then a no-op for that part.

**Tested locally:** `profiles_status_columns.rls.test.ts` (reproduction on a copy built with Supabase's default grants, then the fixed database: each column refused to an employee, an HR Admin and even a System Administrator reading the table; `select *` refused; names still readable; the function answers a System Administrator only; deactivate / reactivate, self-update of name and locale, first-sign-in activation and the audit row all still work).

## A14. The attendance clock's project-lead picker (prefix `leadpick`, `20261216000500_attendance_lead_candidates.sql`)

**The defect.** "Site work" needs a project lead, but an ordinary employee's picker held only themself (the page read `employees` through their own session, which shows only their own row), and choosing themself sends the Recovery Leave request to HR direct.

**What the migration does.** Adds `attendance_lead_candidates()`: an id and a display name for the active people of the **caller's own company**, nothing else. The clock and the form that supplies a missing lead read it. The employee still cannot read any other employee row or column; the database still rejects a lead of another company or one who is not active; attendance rules, routing and calculations are untouched. If the list cannot be loaded the clock says so (Office and WFH still work).

**Tested locally:** `clock_lead_candidates.rls.test.ts` (reproduction, same-company active people only, id and name only, another company, a person with no employee record, anonymous refused, no other employee row readable, the database still rejecting an ineligible lead on clock-in).

## A15. Recovery Leave approval cards for the people who decide (prefix `reccard`, `20261216000600_recovery_decider_inbox.sql`)

**The defect.** A project lead deciding step 1 saw the applicant's name as a dash, and a CEO / CTO deciding an HR Admin's request on the shared queue got **no card at all** (the page said "Nothing waiting on you" although the approval exists). Two things stack for the CEO / CTO: the queue approval row is invisible to them (the approvals read rule looks the request up under the caller's own row-level security, and the request table has no CEO / CTO branch), and so is the request the card is built from.

**What the migration does.** Adds `recovery_decider_inbox(ids)`, which returns every pending approval the caller is authorised to decide **right now** (a step assigned to them, or a pending queue step whose role they hold in the applicant's own company; never the applicant; never a decision already made), with the approval's own fields and the minimum the card shows: applicant name, company, country, work date, event type, amount, route, work mode, project name, named lead, routing note and window link. Not returned: checked-with notes, correction reasons, segment ids. **No policy changes**: nobody can read more rows of `approvals` or `recovery_credit_requests` than before. Routing, who decides and every calculation are unchanged. The Approvals page lists these steps and the "waiting on you" count (the badge) uses the same function, so the two agree.

**Tested locally:** `recovery_decider_card.rls.test.ts` (reproduction: the CEO reads neither the request nor the queue approval; the lead gets name and dates; the CEO and the CTO get an HR Admin's card; another HR Admin, the applicant, an ordinary employee and the CEO / HR Admin of another company get nothing when calling the function directly; both tables are still unreadable to the CEO; routing and the decision unchanged), and the Approvals page and count tests.

**Not changed (reported):** the evidence timeline of the card ("steps" list) still reads `approvals` under the caller's own rules, so a CEO sees the card and can decide but not the step history of a window request.

## A16. Policy status function checks the role (prefix `polstat`, `20261216000700_policy_status_role_check.sql`)

**The defect.** `preflight_phase2b_v2_policy_status()` is `SECURITY DEFINER` with no role check and the Policies page called it for every viewer, so any signed-in employee could read the status and key values of the seeded **draft** policy versions that the policy table hides from them.

**What the migration does.** Replaces the function so that a slot is returned only to someone who may read that country's drafts (the same test as the policy table's own read rule and the draft-creation function: HR Admin, CEO or CTO with a grant not limited to one company) and takes `execute` away from anonymous callers. HR Admin sees the same rows. The Policies page now asks only people who may draft. Leave rules and calculations are untouched.

**Hosted check first.** Preflight section D shows who can execute it today, how many seeded drafts exist, and whether any draft payload mentions pay (the answer that decides whether this is more than a low risk).

**Company-only HR Admin (intended, tested).** An HR Admin whose grant is limited to one company keeps the read-only Policies list (active versions) and Public holidays, and does not see drafts or the draft / activate / delete controls. That is the rule the policy engine has always had (a policy can affect every company in a country, so drafting needs an HR Admin grant not limited to one company, `docs/02-database-schema.md` section 2.4) and the same one the status function now applies; the page already hid the draft buttons from them before A16. Nothing was broadened to restore a screen. Details and the tests are in `docs/launch-p1d-deployment.md`.

**Tested locally:** `policy_status_role_check.rls.test.ts`, `policy_company_only_hr.rls.test.ts`.

## A17. A letter still pending approval cannot be downloaded by the employee (prefix `letters`, `20261216000800_letters_storage_issued_only.sql`)

**The defect.** The app stores the letter PDF **before** the approval is routed, and the storage read policy let the owning employee fetch any file under their own folder in any status, so a letter that still needed sign-off (or was rejected or voided) was in their hands.

**What the migration does.** The employee branch of the `letters_select` storage policy now also needs a letter row for that exact file with status `issued`; HR Admin (review before sign-off), the CEO / CTO read policy, uploads and deletes are unchanged. The Letters page offers **Download** to an employee only for issued letters (a pending one shows its status and "Available once it is approved"); HR keeps Download in every status.

**About salary.** The letter renderer only fills eight fields (name, first name, last name, job title, hire date, employee number, company, today's date): **no template can pull salary from the database**. A template's own text could still contain typed amounts; preflight section D lists, by name only, any template that mentions pay or contains a number of four digits or more. If it says `none`, there is no salary text in any template.

**Tested locally:** `letters_pending_storage.rls.test.ts` (draft, pending and void refused to the owner; issued readable; an orphan file refused; HR, CEO and CTO unchanged; a peer and another company's HR refused; the employee still reads the letter row so the page can say "pending approval") and the existing phase 6 storage test, updated to an issued letter.
