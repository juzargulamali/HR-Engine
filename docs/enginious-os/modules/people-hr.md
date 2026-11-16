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
3. **Identity and job, once.** First name, last name, employee number, hire date (required); date of birth, job title, department (the company's), manager (searchable) optional.
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
| HR work queue (Alerts, approvals waiting on HR, what needs HR today) | **Phase 2, planned**: not started |
| Letters, Payroll, Assets, Admin (Companies, Audit Log, AI Suggestions) | **Phase 3, planned**: not started |
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
