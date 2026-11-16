# People & HR: module reference

**Status, People & HR Phase 1 (employee directory, profile and onboarding).** Written for branch `feat/people-hr-phase1`, started from `main` at the merge of PR #103 (`6526049`). **A draft pull request; not merged; hosted migration `20270115000100` applied by the owner (owner-confirmed, not seen by Claude); Production not deployed from this branch.** Required CI: recorded on the pull request (not part of this file). Owner-confirmed (stated to Claude in the review of PR #105, 2026-11-16; Claude ran and saw none of it): the migration `20270115000100_people_hr_phase1.sql` is applied on the hosted database, the SQL verification passed, and a read-only check of the Preview was done on a phone. The owner did not give Claude the verify rows or say which revision of the migration file was applied: verify rows 5 and 7 fail if a revision without the employee lock is installed, and the migration is re-runnable. Claude ran nothing against a hosted database. The pull request names the exact head SHA and the pinned SQL links.

This file is the reference for the employee directory, the employee profile and the way a person is added, completed and changed. Companion files: [`people-hr-workflows.md`](./people-hr-workflows.md) (each workflow step by step, with what is prefilled and the real-phone checklist), [`people-hr-coverage-index.md`](./people-hr-coverage-index.md) (every screen and part, with its evidence) and [`people-hr-action-catalogue.md`](./people-hr-action-catalogue.md) (every action that changes data). The working scope with the trace of what already existed is `docs/people-hr-phase1-scope.md`. Existing People & HR pages that Phase 1 does **not** change (My Leave, attendance, letters, payroll, assets, alerts, reports) keep the rows they have in [`02-screens-and-navigation.md`](../02-screens-and-navigation.md) and [`03-roles-access-and-approvals.md`](../03-roles-access-and-approvals.md); [`people-access-job-and-department.md`](./people-access-job-and-department.md) and [`people-access-invites-and-password-links.md`](./people-access-invites-and-password-links.md) describe the People & Access screen this module links to.

Paths are relative to the repository root; `web/` means `apps/web/src/`. Migration `P1` means `supabase/migrations/20270115000100_people_hr_phase1.sql`.

## 1. What Phase 1 is

HR adds an employee **once**, sees what setup remains, and finishes each step, on a phone, without typing the employee or company again. Every step reads and writes the records that already existed. What is new is the way those records are reached and the one place where a rule needed a database change:

* **A directory** that finds people by name or employee number and flags what needs attention.
* **A company-first Add employee** form that uses the company's own country and currency.
* **A resumable setup checklist** on the profile, worked out from the saved records (nothing stored for it), where each step opens the right form with the employee and company already chosen.
* **One effective-dated change for job title and pay**, with a "Change salary" shortcut into it and **scheduled** changes that take effect on their date.
* **One Add document flow** for every document type, with renewal.
* **Context carried** into insurance, loans and performance, and a link from the profile to the right People & Access record.

Sources of truth did not move. The employee row (`employees`), the contract versions (`employment_contracts`), the pay versions (`compensation_details`), the career events (`employee_career_events`), the two document tables (`identity_documents`, `employee_documents`) and the leave and comp-day ledgers stay the **only** places the information lives. Everything the screens say about "what remains", "scheduled", "expiring" or "applied" is read from them, for the signed-in viewer, through row level security.

## 2. Roles, in plain words

| Who | What Phase 1 lets them do |
|---|---|
| **HR Admin of a company** (`hr_admin`, always company-scoped) | Everything below, for that company only: Add employee, edit core details, add contract, change job and pay (now or scheduled), add, renew and remove documents (including identity documents), record opening balances, open People & Access for the person |
| **System Administrator** (`sys_admin`) | See and open the directory and profiles as before; the account step sends them to People & Access, where only they invite. They do **not** gain Add employee or the employment forms: those follow the HR Admin role of the company |
| **Finance** of a company | See every employee of the company and their pay; change **pay only**, dated today or earlier (no job title, no scheduling); no identity documents, no Add employee |
| **CEO / CTO** | Read as before (contract and the directory); no HR forms |
| **Line manager** | Their direct reports in the directory and on the profile (overview, leave, attendance, performance); no pay, no identity documents, no setup checklist |
| **The employee** | Their own profile, including their own pay and documents; cannot add a document or change pay |

The checks live in `packages/domain/src/permissions/employees.ts` (the browser-side mirror of the database policies) and are repeated in each server action; the database policy decides last. Phase 1 added **no permission and no policy**: every rule above existed before. See section 6.

## 3. The seven parts: what is reused, what is extended, what is new, and the gap it closes

| Part | Reused as it was | Extended | New, and the gap it closes |
|---|---|---|---|
| Directory | `employees_select` policy, `ListToolbar`, `RememberList`/`BackLink`, `Table stack`, headcount CSV, show or hide deleted, restore or remove | Search also matches the employee number (each typed word may match the first name, last name or number); the number is on the row | **Needs attention** column (`web/lib/hr/directory-data.ts`): setup left, expired or expiring documents, scheduled changes. Gap: HR had to open each profile to find an incomplete one |
| Add employee | The same fields, `canCreateEmployee`, the same tables, the `SearchCombobox` manager picker, `InfoHint` | Company is chosen first; its country and currency are used; contract, pay and opening balances are optional in the same form; the person lands on their own profile | Retry safety (client-made id, section 5.1). Gap: a double click or a retry could not be told apart from a second employee |
| Setup checklist | Counts of existing records only | none | `web/lib/hr/setup.ts`, `web/app/(app)/employees/[id]/setup-checklist.tsx`, `next-actions.tsx`. Gap: nothing told HR what was missing for a person |
| Job and pay | `employee_career_events` and `compensation_details` (payroll still reads the pay version flagged current), `canRecordCareerEvent`, Finance's pay path | One form replaces the two entry points (record career event; add compensation version) | **Scheduled** changes: `applied_at` on the event, `record_employment_change`, `apply_due_employment_changes`, `dismiss_employment_change`, a daily route; the cutoff is the employee's own calendar day, decided in the database. Gap: a later-dated raise either could not be recorded or was applied at once, and a combined title-and-pay edit could half-save |
| Documents | Both tables, both private buckets, the five-minute signed links, the daily expiry job, the access tiers | One list and one form for every type; Renew | Type registry (`web/lib/hr/document-types.ts`). Gap: two near-identical forms with different fields and no renewal path |
| Opening balances | The two ledgers and the `opening_balance` tags the leave-accrual baseline reads | A step on the profile (Leave tab) as well as at creation | Two partial unique indexes (migration). Gap: nothing in the database stopped a second opening-balance row |
| Insurance, loans, performance, People & Access | Their sections and forms; People & Access already names the company and module before a grant changes | The employee and company are named in each form; review sentences; the profile card links to the person | none |

## 4. Screens and controls (Phase 1 paths)

### 4.1 Employees (`/employees`)

`web/app/(app)/employees/page.tsx`. Who is listed is unchanged: the policy-scoped list (HR Admin and System Administrator: everyone they administer; Finance and CEO/CTO: everyone in their company; a manager: self and reports; an employee: self).

* **Search by name or employee number.** One box; each word must match a first name, a last name or a number (so "riya rigger" and "E010" both work). The text is stripped of the characters the filter language treats specially, and personal e-mail is deliberately not searched.
* **Filters** Company (only when more than one) and Status. **Show deleted** and **Download CSV** are for HR Admin and System Administrator as before.
* **Add employee** stays beside the title for HR Admins; the header wraps on a phone.
* **Row.** Name, the employee number beside it, job title, company, status and **Needs attention**. At phone width the table stacks into labelled rows. A flag is a link to the exact tab or form. The flags appear **only** for people the viewer can manage (an HR Admin of that company); a manager or Finance sees the list without them.
* **Back from a profile.** The profile's back link restores the search, filters and page (`RememberList`).
* **Remove** is not on the row. It stays on the profile as an authorised secondary action (HR Admin).

Flags and where each opens (`computeExceptions`, `web/lib/hr/setup.ts`): "N of M setup steps to do" (the first remaining step's form); "No job title" (Overview, job details); "1 document expired" or "N documents expired" (Documents tab); "1 document expiring soon" (Documents tab; 60 days); "N scheduled changes" (Employment tab). "No manager" appears on the profile only (needs one database call per person, which a list should not make).

### 4.2 Add employee (`/employees/new`)

`web/app/(app)/employees/new/page.tsx`, `new-employee-form.tsx`, action `createEmployee` (`web/lib/actions/employeeOnboarding.ts`).

1. **Company first.** Nothing else is asked until a company is chosen. Only companies the viewer can add to are listed (`canCreateEmployee`).
2. **The company's defaults.** Its country is used and shown; its default currency is suggested for pay. A company with **no** country asks for the employee's country in place; a company with **no default currency** says so and asks for one only if pay is entered now.
3. **Identity and job, once.** First name, last name, hire date (required); no employee number is typed (it is assigned on save, section 15); date of birth, job title, department (the company's), manager (searchable) optional.
4. **Contract and pay now (optional).** Contract type ("Add later" is the empty choice), start (the hire date unless changed) and notice; basic salary, others, currency (the company's, editable). **Opening balances (optional):** annual leave days and comp days earned to date.
5. **Save.** The person's **Overview** opens with "Employee created. Finish setup below." and the checklist. If part of the optional data could not be saved, the profile opens on the first step still to do with a sentence naming what was not saved.

### 4.3 The profile (`/employees/[id]`)

`web/app/(app)/employees/[id]/page.tsx`. The header names the person, job title and company (always visible while editing a tab), the department, status and hire date, and carries the Remove or Restore action for HR Admins.

* **Tabs** appear only when the viewer may see them: Overview (always), Employment, Compensation, Leave, Attendance, Documents, Insurance & Loans, Assets, Performance. A tab the viewer cannot reach is never rendered or fetched, **even if the address asks for it**: the page falls back to Overview.
* **Address parameters** the setup, flag and renewal links use (`web/lib/hr/focus.ts`): `tab`, `step` (`contract`, `pay`, `documents`, `opening-balances`, `account`, `job`), `add` (a document type key such as `employee:visa`), `renew=1` with `docId`, `change` (`salary` or `job`), and `created=1&notice=` (set once by the create flow).
* **Overview.** *Next actions* (the flags above, each with Open), *Setup* checklist (HR Admin; section 4.4), *At a glance* (company, department, manager, status, hire date; "Not needed (top of the organisation)" for the people at the top), the **Account, HR roles and module access** card (section 4.8) and the existing core details form.
* **Employment.** *Current terms*, *Scheduled changes*, the **one** *Change job or pay* form (section 4.5), *Contract history* (add a contract version) and *History*.
* **Compensation.** Current pay read only, with **Change salary** (or **Add salary** when none); Final settlement for a leaver.
* **Leave.** Balances and history read only, and the opening-balances form (section 4.6) for HR Admins.
* **Documents.** One list and one **Add document** form (section 4.7).
* **Insurance & Loans.** Active records with their review sentence ("Active", "Expires in 12 days. An HR Admin renews it", "Expired. An HR Admin renews it"); the add forms name the employee and company ("For Name · Company").
* **Performance.** Open goals, appraisals, and a *who acts next* list ("2 open goals. 1 still need the reporting manager's rating.", "1 appraisal is in draft: …", "… waiting for the employee to acknowledge").
* **Attendance, Assets.** Not changed in Phase 1.

### 4.4 The setup checklist (`SetupChecklist`)

Derived by `computeSetup` from counts of existing records, so reopening the profile, on any device, gives the same answer. Steps:

| Step | Done when | Otherwise | Opens |
|---|---|---|---|
| Contract | a contract version exists | "No contract yet. Saving adds contract version 1 for this employee." | Employment, contract form (`step=contract`) |
| Compensation | a pay version exists | "No salary yet. Saving records the first salary, effective from the hire date unless you choose another date." | Employment, the one change form with pay first (`step=pay`) |
| Documents | an identity or employee document exists | "No document on file. Add the identity document first; the form asks for what its type needs." | Documents, Add document open (`step=documents`) |
| Opening balances | an opening-balance row exists in either ledger | **Optional**: "only for someone who already has leave or comp days from elsewhere. A fresh start needs nothing." Never counted as unfinished | Leave, the opening-balances form (`step=opening-balances`) |
| Account invitation | a login is linked (`employees.user_id`) | For a System Administrator: "Invite them in People & Access, then link the account here". For an HR Admin: "A System Administrator invites them in People & Access; once the account exists you link it here" | People & Access, or the link-account control on the Overview |

* **Not applicable.** A removed record or a leaver (`terminated`) shows every step as "Not applicable: …" with no action.
* **Cannot see.** A count the viewer cannot read (policy returned nothing) or a read that failed is `null`: the step is **hidden**, never "to do".
* The summary reads "Setup complete" or "N of M setup steps to do"; optional and not-applicable steps are not counted.

### 4.5 Job and pay: one change (`Employment` tab; `?change=salary|job`)

`change-employment-form.tsx`, `employment-section.tsx`, action `recordEmploymentChange` (`web/lib/actions/employmentChanges.ts`), rules `web/lib/hr/changes.ts` (`planChange`, shared by the form and the action so the sentence is the same).

* The employee, company and **current** job title and pay stay at the top of the form. Leave anything that is not changing blank. The effect of saving is stated beside the button ("Applied now" or "Scheduled: nothing changes until <date>").
* **Effective date.** Today (in the employee's country) or earlier is applied now. Later is **scheduled**. A date before the hire date is refused. **"Today" is decided by the database** from the employee's country (`hr_business_today`: AE Asia/Dubai, SA Asia/Riyadh, PL Europe/Warsaw, any other country Asia/Dubai, the same list as the app): the action sends no date as a cutoff, reads the same helper to word its pre-check, and words its answer from the status the database returns (applied or scheduled). Late in the evening UTC it is already tomorrow in Dubai and Riyadh, and a change dated that day is applied, not scheduled.
* **Allowances you did not edit are kept.** Only **Others** is edited here. Housing, transport and every other allowance on the current pay version are copied exactly into the new version (and into the event's `new_allowances`); a blank Others leaves it alone, `0` removes only Others. Bank and payment details carry over as before.
* **One transaction.** The job title and pay are saved together or not at all (`record_employment_change`), so there is no half-saved state to explain; the answer always says "Saved" or "Nothing was saved".
* **Finance** may change pay only, dated today or earlier; the job title and scheduling are HR Admin's. Both sentences say so.
* **Scheduled changes** are listed with their date and wait unapplied (`applied_at` null). The daily route `/api/cron/employment-changes` (registered in `apps/web/vercel.json`, the Production Root Directory, `45 0 * * *` UTC, secret-protected like the other jobs) applies each on ITS employee's calendar day through `apply_due_employment_changes()` (service role only; no country or date is sent). **A scheduled pay change is applied only while the pay version it was worked out from is still the current one** (`base_compensation_id`): if pay moved on (Finance changed it, or an earlier scheduled change was applied), the change is **held for HR review** with a reason (`conflict_reason`), nothing is written (title included), the Scheduled changes row says *Held for review* and the directory and overview flag it; an HR Admin can **Cancel** it (`dismiss_employment_change`; the row stays, marked *Cancelled, never applied*) and record the change again. **A failed application is a failure of the run:** the route answers 500 with each failed event (id, employee, SQL state, message) while the applications that succeeded in the same run are kept and counted; held changes are reported in the same body but are not failures. `proxy.ts` lists the route as public, as it does `crm-reminders`, so the scheduler's session-less call reaches it; the route itself refuses a call without the cron secret (401). **Known limit:** scheduler activation is an owner decision that is deferred, and the hosted cron history and `CRON_SECRET` are `Unverified`, so until the owner confirms the scheduler is running a scheduled change is **not** applied by itself; see [`../04-flows-sales-to-warehouse-and-others.md`](../04-flows-sales-to-warehouse-and-others.md) section 5. Nothing is paid early in the meantime: payroll and every other reader keep reading the pay version flagged current.
* **History** lists applied changes newest first; rows written by the previous build count as applied.

### 4.6 Opening balances (`Leave` tab, `?step=opening-balances`)

`opening-balances-form.tsx`, action `recordOpeningBalances` (`web/lib/actions/employeeSetup.ts`). HR Admin of the employee's company only. Annual leave days and/or comp days; recorded **once**: the action first checks for an existing opening-balance row, and the partial unique indexes make a repeat or a simultaneous second click impossible. A second attempt answers that balances were already recorded and writes nothing.

### 4.7 Documents (`Documents` tab, `?add=<type>`, `?renew=1&docId=`)

`documents-tab.tsx`, `documents-list.tsx`, `add-document-form.tsx`, action `addDocument` (`web/lib/actions/employeeDocuments.ts`), registry `web/lib/hr/document-types.ts`.

| Type | Stored in | Needs | Expiry |
|---|---|---|---|
| Passport, Emirates ID, Iqama, PESEL, Other identity document | `identity_documents` (HR Admin and the person only) | number; file optional | Passport, Emirates ID, Iqama: required; PESEL: not asked; Other identity: optional |
| Visa, Labor card | `employee_documents` | file | required; the daily job moves valid → expiring soon → expired |
| Certificate, Other document | `employee_documents` | file | optional |

The types usual for the employee's country are offered first (Emirates ID and Labor card for AE; Iqama and Visa for SA; PESEL for PL); the rest stay available. The type decides which fields are asked, and the same rule is checked again by the action. **Renew** (on any document with an expiry date) opens the form with the type chosen and locked, the earlier number copied and the employee and company named; the new document is added and the earlier one **stays in the history**. A one-time `submissionId` builds the stored file path, so a repeated click returns the row already made. The list says each document's state in words (Valid, Expiring soon, Expired) and keeps **View / Download** (a five-minute signed link). Remove stays an HR Admin action per document.

### 4.8 People & Access link (Overview card)

For a System Administrator, or an HR Admin of the company (never for the person themself), the card **Account, HR roles and module access** says "Changing access there affects <Company>: <the modules>", says whether a login is linked, and opens People & Access on this exact person: `/people-access?person=u:<userId>` when a login is linked, `e:<employeeId>` when not (an employee without a login is addressed by the employee). The ⓘ states the rule: saving employment details never changes an invitation or an access grant, and changing access there never edits employment details. People & Access itself names the company and module before any change (module access editor), so no change was needed there.

## 5. Database (migration `20270115000100_people_hr_phase1.sql`)

The only migration. **Additive; no existing policy, function or grant is changed.**

| Object | What it is | Why |
|---|---|---|
| `employee_career_events.applied_at timestamptz` (default `now()`) | Null = scheduled, not yet in force. Existing rows are marked applied by the one-time backfill; rows written by the previous build keep working through the default | A future-dated change needs a state between "recorded" and "in force" |
| `employee_career_events.base_compensation_id`, `conflict_reason`, `conflict_at`, `dismissed_at`, `dismissed_by` | the pay version a pay change was worked out from; why the daily job held a change; when HR cancelled it and who | An older pending change must never overwrite newer pay, and a held change must be visible and clearable |
| index `idx_career_events_scheduled` | on `effective_date` where `applied_at is null and dismissed_at is null` | The daily job finds due changes cheaply |
| unique indexes `leave_ledger_opening_balance_unique`, `comp_day_ledger_opening_balance_unique` | partial: one `opening_balance` row per employee (and leave type) | A repeat or concurrent click cannot repeat an opening balance |
| `hr_business_time_zone(country)`, `hr_business_date(country, instant)`, `hr_business_today(country)` | helpers executable by `authenticated`, read no table | The effective-date cutoff comes from the employee's own calendar day, in the database |
| `record_employment_change(employee, date, title, basic, other, note)` | `SECURITY DEFINER`, executable by `authenticated`; takes no "today"; HR Admin: job and pay with an event; Finance: pay only, today or earlier, no event; everyone else refused identically (existence is not revealed); validates dates, title and amounts; keeps every allowance but Others | One transaction for title and pay; the rules enforced where the data is, not only in the screen |
| `apply_due_employment_changes(p_at default now())` | executable by `service_role` only; `p_at` exists so a test can name the instant, the route never sends it | The daily route applies each due change on its employee's calendar, in date order, each in its own sub-transaction; holds a stale one; reports failures per event |
| `dismiss_employment_change(event)` | `SECURITY DEFINER`, HR Admin of the employee's company; the same refusal for no right and an unknown event; a second call changes nothing | HR cancels a scheduled or held change; nothing is deleted |
| `_hr_lock_employee`, `_hr_set_current_pay`, `_hr_apply_career_event` | internal helpers, all privileges revoked | One place for the employee lock, the pay-version flip and the stale-pay check |

**Lock order (the same on the save, the daily job and the cancellation).** The employee's row is locked first (`_hr_lock_employee`), then the change's row, then the pay rows. Employment status and the current pay version are read only after the lock is held, so two sessions on one employee run one after the other and the second sees what the first committed: a manual pay change that is still being saved cannot be overwritten by the daily job, which waits for that employee (at most 10 seconds, then reports that event as a failure) and then holds its change as stale. The daily job lists what is due without locking anything and locks each employee as it reaches that employee's change.

Packs (owner runs them; Claude ran none on a hosted database): `supabase/manual-sql/people_hr_phase1_00_preflight_readonly.sql` (six rows: 1 `OK`, 2 `not installed yet` before the migration, 3 and 4 `OK`, 5 and 6 information counts such as employees with more than one current pay version), `people_hr_phase1_20_verify_readonly.sql` (nine rows: 1 to 8 `OK`; row 9 is information, `<scheduled waiting> / <held for review> / <applied>`, `0 / 0 / n` on a fresh install; a FAIL on rows 3 to 5 means an older draft of a function is still installed: apply the migration file again, it is re-runnable) and `people_hr_phase1_90_rollback.sql` (stops while any scheduled, held or cancelled change exists, safe to run twice, deletes no business row). The pull request pins each at the head SHA.

**Retry-safe create needs no column.** The form makes one id when it opens and the action uses it as `employees.id`. A repeated send hits the primary key and the action opens the existing profile and writes nothing else; a repeated employee number in the company is refused with a link to the person who has it.

**Compatibility.** The deployed (previous) build keeps working on the migrated schema: the new column defaults to applied, the old functions are untouched. The new build needs the migration for scheduled changes only; without it a change dated today fails honestly with "Job and pay changes are not installed in this environment yet. Nothing was saved."

## 6. Where each rule is enforced

| Rule | Screen | Server action | Database |
|---|---|---|---|
| Add employee: HR Admin of that company | company list filtered; page | `canCreateEmployee` | `employees` insert policy |
| Profile, tab and a direct address | tab list from the permission helpers; an unreachable tab falls back to Overview | row read through the viewer's session | `employees_select` and each table's own policy |
| Pay: see | Compensation tab and Current terms only for the person, HR Admin, Finance | reads through the viewer's session | `compensation_details` policy (person, HR Admin, Finance of the company) |
| Pay: change | form on Employment | `recordEmploymentChange`: HR Admin, or Finance pay-only | `record_employment_change` checks again |
| Identity documents and their files | Documents list | `canManageIdentityDocuments` for add | policy and bucket policy: the person and their HR Admin only; the company segment of the file path is taken from the employee row, never from the form |
| Employee documents | same | `canManageEmployeeDocuments` | policy and bucket policy |
| Opening balances | Leave tab | `canEditEmployeeCore` | ledger policies, unique indexes |
| Setup and flags | HR Admin only; hidden when unreadable | reads through the viewer's session | policies |
| Access changes | link only | none here | People & Access and its own rules |

Opening a profile, a tab, a document link or an action address **directly** reaches the same checks: nothing hides a control and trusts the hiding.

## 7. Cross-module behaviour

* **Grants are untouched.** Creating or changing an employee writes no row to `user_roles`, the Sales, Projects, Inventory, PBX or Finance grant tables. The browser check hashes those tables (Sales, Projects, Operations, Inventory, Finance, HR) before and after an employment save and finds them unchanged.
* **Employee-account association** is `employees.user_id`; the People & Access link and the account step use it.
* **Links kept:** the Assets tab's link to Inventory custody (`EmployeeEquipmentLink`), My Day, My Leave and Approvals. Phase 1 touches none of them.
* **Payroll** reads `compensation_details.is_current` as before; a scheduled raise changes it on its date and not before.
* **Document expiry** keeps its daily job; the directory and profile flag from the date alone, and the stored status is shown beside it.

## 8. Coverage index

[`people-hr-coverage-index.md`](./people-hr-coverage-index.md): every screen and part of the directory and profile, with who reaches it and its evidence.

## 9. Action catalogue

[`people-hr-action-catalogue.md`](./people-hr-action-catalogue.md): every action that changes data, who may do it, where that is enforced, how a retry behaves and when to stop. A documented action is not an approved JARVIS tool.

## 10. Destinations and profile tabs: what exists and what is planned

| Destination or tab | State |
|---|---|
| `/employees`, `/employees/new`, `/employees/[id]` (Overview, Employment, Compensation, Leave, Documents, Insurance & Loans, Performance) | **Phase 1** (this file) |
| Profile tabs Attendance, Assets, and Final settlement | Exist; unchanged |
| HR work queue: Alerts (Needs action, Due soon, Acknowledged), the attendance register's Needs review, the profile's Leave and Attendance tabs, My Day's HR rows | **Phase 2** (section 14) |
| Letters, Payroll, Assets, broader Admin (Companies, Audit Log, AI Suggestions) | **Phase 3, planned**: not started. Phase 2 adds only Administration, Background processing (section 14.7) |
| People & Access | Exists; linked from the profile |
| `/leave`, `/attendance-clock`, `/attendance`, `/reimbursements`, `/performance` (own pages) | Exist; unchanged |

## 11. Open decisions for the owner

1. **Who may add an employee.** Today only an HR Admin of the company (the existing rule). A System Administrator cannot. Option: allow System Administrators too, which needs a policy change and its own tests.
2. **Who schedules pay.** HR Admin only; Finance changes pay dated today or earlier. Option: let Finance schedule a later date.
3. **Where "No manager" is flagged.** On the profile, not in the list (one database call per person). Option: a count function for the directory.
4. **Opening-balance corrections.** Recorded once; a correction is an ordinary ledger adjustment on Leave. Option: a guarded "replace opening balance" action.
5. **Account invitation by HR Admin.** Only a System Administrator invites; an HR Admin links an existing account. Unchanged and stated on screen. Option: delegate invitations.
7. **Activating the daily job for scheduled changes.** The route exists, is listed in the proxy's public list (like `crm-reminders`; it answers 401 without the cron secret) and is tested through its database function. What remains is the owner's scheduler decision (deferred) and a check of the Vercel cron history after deploy.
6. **Editing a scheduled change.** A scheduled or held change can be cancelled (HR Admin) and recorded again; it cannot be edited in place.

## 12. Verification (local; nothing hosted)

* **Database:** `packages/rls-tests/test/people-hr-phase1.rls.test.ts`, 20 tests on a database built from every migration (job and pay now; a scheduled change does not move pay; the applier is service-role only; each event applied on its own employee's calendar (21:00 UTC is already tomorrow in Dubai, still today in Warsaw); the cutoff helper per country and the caller cannot send a date; allowances not edited are kept; a stale scheduled pay change is held, never applied over newer pay, and HR can cancel it; a failed event is reported and the same run's other events are kept; **two sessions** (a manual pay change still open, the daily job started meanwhile: the job waits for the employee's lock, then holds its stale change and leaves one current pay version, the manual one); the migration re-run replaces an older draft; Finance pay-only; other company, manager, CEO, employee and unknown role refused identically; refusal rules; first salary; atomic rollback; previous-build rows count as applied; a leaver's event is left unapplied; one opening balance per employee; the packs behave). 19 tests passed after the correction (13 before it); the full RLS suite (95 files, 2198 tests) passed at the earlier head `e42a067` and is left to required CI for the corrected head.
* **Web:** unit and component tests (`web/lib/hr/*.test.ts`, the add-document, change-employment, profile-pieces, employment-timeline and new-employee tests, the failed-reads test updated for the Documents tab; the action, cron-route, timeline, flag and profile-loader tests for the date, held-change, cancel and failure behaviour). the focused files were re-run after the correction; the full web suite (382 files, 4251 tests) passed at the earlier head `e42a067` and is left to required CI for the corrected head.
* **Browser:** `apps/web/os-shell-checks/people-hr-phase1-flow.mjs` (seed `seed/people-hr.sh`), at 390 px, on the isolated stack with fictional people: 20 of 20 steps passed (run before the migration was renamed and the cron route added to the proxy list; the rename changes no behaviour). It covers the directory and its memory, company-first onboarding for UAE, Saudi Arabia and Poland defaults and a company with no default currency, one create from a double click, leaving midway and resuming the same record, contract, pay, document and opening-balance steps without retyping, a job and pay change applied now and one scheduled, the Change salary shortcut, renewal, People & Access with the grants hash unchanged, and the permission boundaries for an HR Admin of one company only, Finance, a line manager and the employee.
* **Walkthrough (local, isolated stack, 390 px, head `1fcc03d`; `os-shell-checks/people-hr-phase1-cancel-walkthrough.mjs`, 10 of 10 steps):** an employee is created with identity and job only; the directory flags the unfinished setup and the flag opens the same record (one employee, one id) with employee and company already shown in the pay step; a future pay change is scheduled (listed as not in force yet; the current pay version and figures are unchanged); a Finance user sees it but is offered no cancel control and the database refuses their direct cancel; the HR Admin cancels it in two taps; current pay is still unchanged; the cancelled change leaves Scheduled changes and appears in History as *Cancelled, never applied*; the daily job on its date applies and holds nothing for it. **History badges (found by this walkthrough, fixed):** in the stacked History row at 390 px the two type badges were separate non-wrapping items in a flex row, which widened the row past its card; the table's own `os-table-wrap` scrolled sideways by 67 px and the words read *Cancelled, never a…* and *Salary c…* (the page itself did not scroll, so a page-level width check missed it). The badges now sit in one wrapping group in the existing stacked cell (`career-history-section.tsx`, layout only): *Salary change* and *Cancelled, never applied* are fully visible at 390 px, wrapping onto their own line, with no sideways scroll inside any table (the walkthrough now checks each table wrapper and each badge's box, and failed on the old layout first); at 1280 px both badges stay on one line with no overflow.
* **Not verified by Claude:** anything hosted (the migration, the daily route, Preview, Production: the owner reports the migration, its SQL verification and a read-only phone Preview check as done); a real phone; the e-mail or invitation delivery; that Vercel's scheduler calls the daily route with the cron secret (the proxy lets the call through and the route refuses it without the secret; the verify pack's row 8 is how to watch the waiting count); the Attendance and Assets tabs (not changed); the paths named in the coverage index as not re-run.

## 13. JARVIS and People & HR

JARVIS has **no live access** to People & HR: it cannot read an employee, pay, a document or a setup step, and cannot change anything. Five published guidance topics explain the screens (`staff-guidance/people.md`): `people-add-employee`, `people-employee-remaining-steps`, `people-change-job-or-pay`, `people-renew-document`, `people-find-access-record`. The sensitive boundaries stay: salary and identity details are never read into an answer. See [`jarvis.md`](./jarvis.md) section 18 and [`jarvis-rulebook.md`](./jarvis-rulebook.md) section 10.

## 14. Phase 2: the HR work queue (Daily HR work)

Branch `feat/people-hr-phase2`, draft PR, migration `20270116000100_people_hr_phase2_queue.sql` (not applied anywhere). Goal: HR opens one queue, sees what needs attention, goes straight to the right record and sees the outcome in the relevant views. It adds no new kind of record: every item is worked out from an existing record and every fix is an existing action.

### 14.1 Entry points, status, who acts, and where each one opens

Read model: `lib/hr/queue.ts` (pure builders and wording), `lib/hr/queue-data.ts` (the read, through RLS, one source failing alone). The Alerts page, the employee profile and My Day all read it, so one issue has one status, one set of words and one link.

| Item | Source of truth | In the queue when | Acts next | Opens | Resolved when (outcome appears in Alerts, the profile's Next actions and My Day on the next load) |
|---|---|---|---|---|---|
| Contract renewal | `employment_contracts`, the current row | `end_date` within 30 days or past | HR Admin of the company | `/employees/[id]?tab=employment` | A new contract version is recorded (the old one stops being current) or the end date is changed |
| Probation deadline | `employment_contracts`, the current row | `probation_end_date` within 30 days or past | HR Admin of the company | `/employees/[id]?tab=employment` | The contract is changed (a new version without the probation date) |
| Document expiry | `employee_documents` and `identity_documents`, judged from the dates (never the daily job's stored status). **The current version of each type is chosen first, by the profile's own rule (`currentVersions`: the newest row not removed, whatever its expiry date, including none), and only then is its expiry judged** | The current version is expired, or expires within 60 days (the profile's own look-ahead). A newer document with a shorter date is judged on its own date; a newer document with no expiry clears the type; earlier versions are history and never flagged | HR Admin of the company | `/employees/[id]?tab=documents&add=<type>&renew=1&docId=` (the shared renewal form, number prefilled) | A renewal becomes the newest version with a later date or none, or the document is removed |
| Attendance exception | `attendance_records.presence_conflict` (a manual entry and the clock differ) and `recovery_windows` waiting for HR verification, last 60 days | Always, while the record says so | HR Admin of the company | `/attendance?companyId=&date=&filter=needs_review&employee=` (that company and date, the person's row open and marked) | HR corrects the original record in the register (the conflict clears) or verifies the window |
| Recovery Leave alert | `recovery_alerts` (its own existing acknowledgement) | `open` | HR Admin of the company | The same register link, on the alert's local date | The alert is obsolete (the processor retires it) |
| AI suggestion | `ai_drafts` with `status = draft` | HR Admin and System Administrator only | HR Admin or System Administrator | `/ai-suggestions#draft-<id>` (the existing review screen; its content is not copied into the queue) | It is authorised or rejected there |

Other entry points, as traced:

| Entry point | What changed | Where the status comes from |
|---|---|---|
| `/alerts` | Now the work queue: Needs action, Due soon, Acknowledged; filters Company, Type, employee name; the view tabs keep their counts; a failed read says which part failed with Try again, and "Nothing needs attention" only follows a successful read | `lib/hr/queue-data.ts` |
| `/attendance` (register) | Leads with **Needs review** (who, why, "Open this day"); day wording No record / Rest day / Absent / On leave / Present / Partial day, with the live clock status in its own column; a link can open one person's row; the rows stack on a phone | `attendance_register_for_date` (unchanged) and `lib/hr/attendance-status.ts` |
| Profile, Leave tab | Balances first, then **Pending requests**, each linking to its row in `/approvals#request-<id>` for someone who can decide, then the history | `leave_requests`, `recovery_credit_requests` (unchanged) |
| Profile, Attendance tab | Leads with **Needs review** and the days concerned, each linking to the register on that date with the row open; the day words are the register's | `attendance_records`, `recovery_windows` |
| Profile, Overview | Next actions now include the queue's items for this person, in the queue's words and with its links | `lib/hr/queue.ts` narrowed to the employee |
| My Day, HR rows | One row per group (contracts, probation, documents, attendance, recovery, AI), counting what Alerts lists as Needs action or Due soon (an acknowledged item is not counted as waiting) | `hrCandidates` over the same items |
| `/approvals` | Leave and Recovery Leave rows carry an anchor (`#request-<id>`) so a profile can link to the exact row. Nothing else changed: the decision is made on the original request | `approvals` (unchanged) |

### 14.2 Acknowledging is not resolving

* **Mark as seen** (HR Admin of the item's company) records who saw the item and when, with an optional note, in `hr_queue_acknowledgements`. It changes nothing about the contract, document or attendance record.
* The item then moves to **Acknowledged** and stays listed, with the same link, for as long as the source record still says it is open. It says so ("Still open") and, when it is overdue, that it needs action until the record is fixed.
* An acknowledgement belongs to **one date** (the contract end, probation end, expiry or work date). A renewal that moves the date makes the item new again; nothing is deleted.
* Resolution is never stored. It is worked out again from the source record each time, so the queue and the profile cannot disagree.
* Recovery Leave alerts keep their own acknowledgement (`acknowledge_recovery_alert`); AI suggestions are decided on their own screen and have no Mark as seen.

### 14.3 Who sees and who acts

What each viewer sees is what their own database read returns for the SOURCE record (row level security decides; the page adds no company filter). The acknowledgement table follows the same visibility (14.5).

| Role | Alerts: items they can read | Mark as seen | AI suggestions in the queue |
|---|---|---|---|
| HR Admin (of the company) | Every kind for that company: contracts, probation, employee and identity documents, attendance exceptions, Recovery Leave alerts | Yes, for that company | Yes |
| CEO, CTO (of the company) | Contracts, probation, Recovery Leave alerts and recovery windows. **Not** employee documents, identity documents or attendance days: those source tables are HR Admin's (and the person's own), so the items, their dates and any note on them are not theirs | No: the row says "HR Admin of <company>" acts next | No |
| System Administrator | Alerts: no (as before) | No | The AI Suggestions screen only |
| Line manager, employee, Finance | No | No | No |

The profile shows a person's queue items to the same viewers; a line manager or the person themselves see only what their tabs always showed. Identity document **numbers** are never read into the queue, and an AI suggestion's payload is never copied into it.

### 14.4 What the attendance words mean

`lib/hr/attendance-status.ts`: **Absent** only when the day was recorded as absent; **On leave** for approved leave or a leave record; **Present** when recorded present or clock sessions exist; **Partial day**; **Rest day** when nothing is recorded on a weekly rest day or public holiday of the employee's country (the working-week rule leave already uses); **No record** when nothing is recorded on a working day. A missing record is never read as absence. Clock status (Clocked in, Clocked out, Not started) is a different fact and is always shown separately.

### 14.5 Database

One additive migration, because acknowledgement had nowhere to live except for Recovery Leave alerts: table `hr_queue_acknowledgements` (one row per record and date, no direct write policy, audited; **readable only by HR Admin, CEO or CTO of the company who can also read the source record itself**, asked through that record's own row level security, so identity-document metadata and HR's notes on a document or attendance day are HR Admin's alone) and `acknowledge_hr_queue_item(kind, source_id, source_date, note)` (security definer; reads the company and employee from the source record, refuses when the record changed since the screen loaded, requires HR Admin of that company; asking twice is a no-op). No existing table, policy or function changed. Packs: `supabase/manual-sql/people_hr_phase2_00_preflight_readonly.sql`, the migration, `..._20_verify_readonly.sql`, `..._90_rollback.sql` (stops while any acknowledgement exists).

### 14.6 On a phone

Rows are stacked cards (employee and company first, issue, date and status, who acts next, one primary button), not a table, so nothing scrolls sideways. Optional explanation is behind the shared circled help control (the queue's states, Mark as seen, Needs review). Dates, errors, the one-line effect of Mark as seen and who acts next stay on the page.

### 14.7 Diagnostics moved to Administration

The Recovery Leave processor's health, work remaining and the database fingerprint are no longer above the HR queue. They are on `/admin/background-processing` (System Administrator, the existing Administration layout; nav: Organisation, Background processing). The queue keeps one line, only when the processor is late, because that changes what HR can trust ("alerts may appear late").

### 14.8 Not in Phase 2

Letters, Payroll, Assets and a broader Administration redesign stay in Phase 3. The first automatic Production run of the Phase 1 employment scheduler is tracked separately (PR #106). The document-expiry daily job is still not registered (held, see the flows map section 5): the queue judges documents from their dates, so it does not depend on it.

### 14.9 Verification (local; nothing hosted)

* **Database:** `packages/rls-tests/test/people-hr-phase2.rls.test.ts`, 10 tests on a database built from every migration (one added for read visibility: a CEO reads the contract and recovery-window acknowledgements and none of the document, identity-document or attendance-day ones, nor their notes; it fails against the first draft of the policy): acknowledging records the company and employee from the source record and leaves the source unchanged; asking twice leaves one row; every kind (document, identity document, contract end, probation, a day where manual and clock records differ, a recovery window waiting for verification); another company's HR Admin, a CEO, the employee and a manager are refused; a stale screen is refused; an acknowledgement belongs to one date; no direct write; read scope; audit; the three packs.
* **Web:** `lib/hr/queue.test.ts` (states, wording, newest-document rule, acknowledgement by date, who acts next, links), `lib/hr/attendance-status.test.ts`, the Alerts page test (grouping, newer document with a shorter expiry or none, failed reads named, no identity numbers, CEO sees no Mark as seen, company filter, AI suggestion without content, processor line only), the register-table test (Rest day, No record, Absent, focused row), the attention test (My Day counts what Alerts lists as waiting), the failed-reads test. Required CI runs the full suites.
* **Walkthrough (local, isolated stack, 390 px, head `f603937`; `os-shell-checks/people-hr-phase2-walkthrough.mjs`, 11 of 11 steps; first run 7 of 11, three real defects fixed since and one wrong script expectation):** the queue lists a document expiry and an attendance exception under Needs action and a probation deadline under Due soon with employee, company, issue, date and who acts next, no identity number, nothing scrolling sideways; the document opens the renewal form for that passport with the number prefilled and the way back keeps the company filter; the attendance exception opens the register on that company and date with the person's row open and marked; the probation deadline opens that employee's Employment tab; **Mark as seen** moves the attendance exception to Acknowledged, still open, with its link, while the register and the profile still list it and My Day stops counting it as waiting; **renewing the passport** removes it from the queue, the profile and My Day (the Polish passport an unscoped HR Admin also sees stays); an HR Admin of the UAE company sees none of the Polish items, cannot open the Polish record, renewal form or register, and the database refuses the acknowledgement; a CEO sees the items and who acts next with no Mark as seen. Screenshots: `docs/people-hr-phase2-screenshots/`.
* **Defects found by the walkthrough and fixed:** the register's status cell scrolled sideways inside its card at 390 px (the badge and its notes now stack in one column); the Alerts company filter listed every company's name to a viewer with no role there (it now offers only companies the viewer holds an alerts role for).
* **Not verified by Claude:** anything hosted (the migration, the pinned packs against the real project, Preview, Production); a real phone; the Leave tab's Pending requests links and the Administration, Background processing page were not driven in a browser (code and unit tests only); the Recovery Leave processor line is exercised only as "late" on the local stack; the document-expiry daily job is still not registered, so the stored document status is not relied on.

## 15. Employee numbers: one shared series, permanently reserved

**The rule.** One employee number series for every Enginious company (UAE, Saudi Arabia, Europe). A number belongs to the **employee record**, not to a company or to a login, and is unique across all companies. `E02`, `e002`, `E002` and `E2` are the same number; it is saved as `E002`. The rule (one function in the database, `employee_number_canonical`, and one in `web/lib/hr/employee-number.ts`, both tested against `supabase/tests/employee-number-vectors.json`): trim, remove spaces, upper-case; if the number ends in digits drop their leading zeros and pad to at least three digits. A number that is not E plus digits (for example `L-001`) is valid, is kept as recorded, and is never produced by the series.

**Who it covers from now.** **Active or invited** employees: not removed, not terminated, and whose login (if any) is not deactivated. A person with no login yet, or an invited login, is covered. Records that are removed, terminated or deactivated **at rollout** are ignored: no reservation, not audited as collisions, and their numbers are **available** (they were test accounts). The rule is not retroactive and no history is read.

**Permanently reserved.** Every number given to an employee record is recorded in `employee_number_reservations` (no foreign key, so it outlives the record) and belongs to that record for good. From now on a number is refused for anyone else by every path (typed by hand, a script, an import, a correction) whether its employee is active, resigns, is terminated, is removed, is deleted for good, or was corrected to another number. Correcting a number keeps the old one reserved for the same record. Removing, restoring, terminating, deactivating, reactivating or rehiring the **same** record never changes its number; creating a second record for the same person gives it a new number. Bringing back an ignored record (restore, rehire, login reactivated) claims its number if nobody holds it, and is refused with a sentence if it is reserved for another employee. This supersedes migration `20261023000000`, which let a removed employee's number be reused.

**New hires are numbered by the database, from a pool first.** At rollout the migration builds a **pool, once**, from the deleted, terminated and deactivated test accounts it ignores: the E-series numbers they show, normalised (E5 and e05 are one number), deduplicated, and **never a number an active or invited employee holds** (so a number like `E003` held by a live employee cannot be in it). A new hire is given the **lowest free pool number**, claimed atomically across all companies (a row another hire is claiming is skipped, so simultaneous hires get different numbers; a hire that fails gives its number back; a pool number someone has entered by hand is skipped), and it is then **reserved for that employee permanently**, even if they later leave. The pool is **never rebuilt**: people who are deleted, terminated or deactivated after rollout add nothing to it. Gaps in the numbering outside the pool are left alone, and only E-series numbers enter the pool (a test account's `L-001` does not). **When the pool is empty** the shared sequence `employee_number_seq` takes over, starting above the highest E-number reserved at rollout: `E001`-style numbers with at least three digits (`E009`, `E010`, `E099`, `E100`) and no truncation after `E999` (`E1000`, `E1001`); it only moves forward, never re-issues a number that was taken (even by a hire that failed), and skips reserved numbers. The Add employee form has no number field and says so; the action sends none, and a number typed into the request is ignored. The numbering and reservation functions, the pool and the sequence are not callable by signed-in users: only the triggers use them.

**Enforcement is in the database.** A trigger on `employees` saves a supplied or changed number in canonical form, refuses a blank number, reserves it, and refuses a number reserved for another record with a sentence that names no one: "Employee number E002 is reserved for another employee (current, removed or former), in this or another company." A trigger on `profiles` claims the number when a deactivated login is reactivated. An update that does not change the number never rewrites it: **existing numbers stay as recorded** until someone deliberately changes one. There is no unique index on `employees` for this (an index could not be blind to the ignored records); the reservation table's primary key is the rule and decides races.

**Access never changes the number.** Roles and module access (People & Access) are rows in `user_roles` and the module grant tables; none of them touches `employees`. Giving a person access to all three companies creates no second employee record, allocates no number and leaves the employee's id, employing company and number as they were. Proven in `employee-number.rls.test.ts` (roles and Projects access in three companies, then revoked).

**Number-entry paths.** Add employee (no number: assigned); the database triggers for anything else that writes a number (a script, an import, SQL typed in an editor, the owner's approved corrections); restoring or rehiring a record (keeps its number, or is refused if reserved for another). No screen edits an existing number.

**Before it can be installed: the audit.** Each company used to have its own series, so the same number can exist in two companies today. `supabase/manual-sql/people_hr_employee_number_00_audit_readonly.sql` (read only; works before the migration) lists every group of equivalent numbers among active or invited employees across all companies (class A; same company or different companies), checks `E003` globally, counts the ignored records and how many of them share a number with an active one (information: the active employee keeps it), lists numbers that are not canonical or outside the E-series, and shows **the exact pool in allocation order** (with the ignored records each number came from, and the ignored numbers left out and why), **the next number a new hire would be given** and **the sequence fallback**. After the migration, `people_hr_employee_number_25_pool_status_readonly.sql` shows how the pool stands (built at, size, claimed, free now in order, the next number, the fallback). The migration **refuses to run, and changes nothing,** while any class A group exists. A correction is one approved update of one employee's number; nothing is changed without the owner's approval.

**What uses an employee number (checked before proposing any renumbering).** Display only, no foreign keys and no external integration: the Employees directory and its search, the headcount report CSV (`/api/reports/headcount`), the `employee.employee_number` merge field of letters (an **issued letter keeps the number it was written with**, so renumbering an employee would leave old letters showing the old number), Inventory employee pickers and legacy-import display, and manager pickers. **No payroll export, payroll table, attendance or leave table, or integration reads the number**; links between records use the employee's UUID, which this change never alters. Any approved renumbering should therefore be a single-employee update of `employees.employee_number`, followed by reissuing any letter that must show the new number.

**Decisions taken by the owner.** Deleted, terminated and deactivated records at rollout are ignored (test accounts), and every number not held by an active or invited employee is available; from rollout, a number stays with its employee when they resign, are terminated or removed. **Assumptions to confirm.** The three-digit minimum (E002, E010); "deactivated" read as terminated, or a login whose account status is deactivated; the pool takes **E-series numbers only** (E plus digits), so a test account's `L-001` is not in it and is simply available by hand; the pool is **one list for all companies**, built from the ignored records in any company; a claimed pool number is reserved for the employee even if their hire is later removed (a hire that fails inside the same transaction gives its number back).

**Install order.** Audit, resolve any class A group with the owner, preflight, migration `20270117000100_people_hr_employee_number_unique.sql`, verify, then deploy the app (the new app sends no number: it needs the migration first; the previous app keeps working on the migrated schema, it sends a number which is saved canonically). Rollback `people_hr_employee_number_90_rollback.sql`: deploy the previous app first; it keeps the reservation, pool and build-record tables on purpose (so reserved numbers stay reserved and the pool is not rebuilt).
