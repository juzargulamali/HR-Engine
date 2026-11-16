# People & HR: workflows

**Status.** Written for **People & HR Phase 1** on branch `feat/people-hr-phase1`: a draft pull request, **not merged**, hosted migration `20270115000100` **not applied**, Production not deployed from this branch. Required CI: first run recorded on the pull request (not part of this file). Verified locally on the isolated stack only (20 of 20 steps passed (run before the migration was renamed and the cron route added to the proxy list; the rename changes no behaviour)); nothing hosted, no real phone.

The module's shared facts, roles, database and enforcement are in [`people-hr.md`](./people-hr.md). Every screen and part is in [`people-hr-coverage-index.md`](./people-hr-coverage-index.md), every data-changing action in [`people-hr-action-catalogue.md`](./people-hr-action-catalogue.md). This file is each workflow, step by step, with what the screen fills in so nothing is typed twice.

Evidence labels: `Flow` = `apps/web/os-shell-checks/people-hr-phase1-flow.mjs` (seed `seed/people-hr.sh`), driven signed in at 390 px; `RLS` = `packages/rls-tests/test/people-hr-phase1.rls.test.ts`; `Code` = unit or component tests only.

## 1. What every workflow shares

| Fact | How it works | Evidence |
|---|---|---|
| The employee and company are never retyped | Every setup step, flag and renewal link carries the employee in the address (`/employees/<id>?tab=…`) and the form names them at the top ("For Name · Company"). The company comes from the employee record on the server, never from the form | `Flow` |
| Where a link lands | `tab` picks the tab; `step` the setup step (`contract`, `pay`, `documents`, `opening-balances`, `account`, `job`); `add` a document type; `renew=1&docId=` a renewal; `change=salary` or `job` the lead of the change form | `Flow`; `Code` (`focus.test`) |
| Leave and resume | Nothing is held in the browser. What remains is worked out from the saved records each time the profile opens, on any device | `Flow` (leave midway, resume the same record) |
| A repeated click or a retry | Create: the same form id reaches the same employee. Documents: the one-time submission id returns the row already made. Opening balances: a second post is refused. Job and pay: one transaction, so a retry after "Nothing was saved" is safe and after "Saved" is a visible duplicate the person can see in History | `Flow`; `RLS` |
| What a person who cannot see a part is told | The part is not drawn. A step or flag whose records the viewer cannot read is hidden, never "to do" | `Flow` (line manager, employee) |
| A failed read | The page says "Could not load …" with a retry link; it never draws an empty list | `Code` (`failed-reads-hr-lists.test.tsx`) |
| Optional help | Explanations sit under the existing circled **i** (`InfoHint`): Needs attention, Date of birth, Opening balances, Account and access. They are optional; the effect of saving is also written beside each action | `Code` |
| Phone layout | Stacked rows (the list's `Table stack`), inputs 44 px high, one primary action per step, header that wraps, no horizontal scroll at 390 px | `Flow` (checked on the directory, where a 5 px overflow was found and fixed; the forms were read at 390 px in the screenshots, not measured) |

## 2. Find a person (directory)

1. Open **Employees** (`/employees`). HR Admins see everyone they administer.
2. Type a name or an employee number. Several words narrow it (each word may match the first name, last name or number).
3. Use **Company** (when you administer more than one) and **Status**.
4. Press a flag under **Needs attention** to land on the exact tab or form, or press the name to open the profile.
5. The profile's back link returns to the same search, filters and page.

Evidence: `Flow` (number search, name search, filters survive a trip to a profile and back; Add employee visible at phone width).

## 3. Add an employee

Route `/employees/new`, action `createEmployee`. HR Admin of the company only; the company list is filtered the same way.

| Step | What the screen does | What is not retyped |
|---|---|---|
| 1. Choose the company | Nothing else is asked yet ("Choose the company first. Its country and currency are used for this employee.") | Country, currency |
| 2. Defaults appear | The company's country and currency are shown. A company with no country asks for the employee's country in place; a company with no default currency says so and asks for one only if pay is entered | Country, currency |
| 3. Identity and job | First and last name, employee number, hire date (required); date of birth, job title, department (the company's list), manager (search by name or number) | Company, country |
| 4. Contract and pay (optional) | Contract type ("Add later" is the empty choice); the start is the hire date unless changed; basic salary, others, currency (the company's) | Hire date, currency |
| 5. Opening balances (optional) | Annual leave days, comp days earned to date; a note under the circled i says they are for a mid-year hire or a transfer and are recorded once | Hire date |
| 6. Save | The profile **Overview** opens ("Employee created. Finish setup below.") with the checklist | |

**Prefilled by company (fixtures; fictional data):**

| Company | Country used | Currency suggested | Document types offered first |
|---|---|---|---|
| Enginious Local AE | United Arab Emirates (AE) | AED | Emirates ID, Visa, Labor card |
| Enginious Local SA | Saudi Arabia (SA) | SAR | Iqama, Visa |
| Enginious Local PL | Poland (PL) | PLN | PESEL (no expiry date asked) |
| Enginious Local NC | AE | none on record: asked in place | as AE |

**When something goes wrong:**

* *The same employee number is already used in this company* — the message links to that person; nothing was created.
* *Sent twice, or retried after a lost answer* — the same record opens; nothing else is written.
* *Contract, pay or balances could not be saved after the person was created* — the profile opens on the first step still to do with a sentence naming what was not saved ("contract", "pay", "balances"); the person exists once.
* *No access* — "You cannot add employees to this company."

Evidence: `Flow` (company first, three countries, a missing currency, a double click creates one record, Saudi and Polish records saved with their company's country and currency); `Code` (`new-employee-form.test.tsx`, `employeeOnboarding` tests).

## 4. Resume setup on the profile

Open the person (from the directory flag, the link in an earlier message, or search). The **Setup** card on the Overview lists the steps; each has one button. The step is Done when its record exists; Optional never counts as unfinished; a leaver or removed record says Not applicable.

| Step | Button | The form opens with | Saving |
|---|---|---|---|
| Contract | Add contract | Employment tab, employee and company named, start date = hire date | Adds contract version 1 |
| Compensation | Add salary | the one change form with pay first, effective date = hire date, currency = the company's | Records the first salary; no job title needed |
| Documents | Add document | Documents tab, Add document open, type list led by the employee's country | See section 6 |
| Opening balances (optional) | Record opening balances | Leave tab, form with the person named | Section 7 |
| Account invitation | Open People & Access or Link an account | the person already chosen | Section 9 |

Evidence: `Flow` (each step opened and completed in turn; the checklist after them shows only the account step to do); `Code` (`setup.test`, `profile-pieces.test.tsx`).

## 5. Change a job title or pay

Employment tab → **Change job or pay**, or Compensation → **Change salary** (the same form, pay first).

1. The top of the form names the person and company and shows the **current** job title and pay.
2. Enter the new title and/or pay. Leave blank what is not changing. Enter the **date it takes effect**.
3. Read the sentence beside the button: "Applied now" (today or earlier) or "Scheduled: nothing changes until <date>".
4. Save. Title and pay are saved together or not at all. The answer says "Saved" with the effect, or "Nothing was saved" with the reason.
5. Check **Current terms**, **Scheduled changes** and **History**.

Rules: a date before the hire date is refused; "Nothing changed" is refused; Finance can change pay only, dated today or earlier; scheduling and the job title are HR Admin's. The date that counts as "today" is the employee's own country's calendar day, decided by the database. Allowances you did not edit (housing, transport and the rest) are kept; only Others is edited. A scheduled change is put in force by the daily job on its date; until then payroll and every reader keep the current pay. If pay changed after the change was scheduled, the job does **not** apply it: the row is marked **Held for review** with the reason, and an HR Admin cancels it and records the change again from the current pay. The job is listed in `vercel.json` and its route is public-with-secret; whether the hosted scheduler runs it is the owner's decision (see `people-hr.md` 4.5): after the date has passed, check **Current terms** and tell the database owner if the change is still under Scheduled changes without a *Held* label (the staff guidance says: tell your System Administrator).

Evidence: `Flow` (a change dated today applied, one dated later scheduled and nothing moved, before the hire date refused; Change salary shortcut; Finance pay-only); `RLS` (the transaction, the refusals, the daily applier); `Code` (`changes.test`, `change-employment-form.test.tsx`).

## 6. Add or renew a document

Documents tab → **Add document**, or **Renew** beside a document that has an expiry date, or a setup step or a flag.

1. Choose the type (the employee's country's usual ones first). The fields change with the type: an identity document asks for its number (file optional); a Visa or Labor card requires a file and an expiry date; a Certificate or Other document requires a file; PESEL asks for no expiry date.
2. For a **renewal** the type is chosen and locked, the earlier number is copied, and the form says so. The earlier document stays in the history.
3. Save. Identity documents are visible only to the person and their HR Admin; View / Download opens a five-minute link.

Errors are written beside the field ("Attach the Visa file.", "Enter the Passport expiry date."). The daily job still moves an employee document valid → expiring soon → expired; the list says each state in words.

Evidence: `Flow` (documents step, type decides fields, a Visa needs its file, renewal keeps the earlier document); `Code` (`document-types.test`, `add-document-form.test.tsx`, `documents-list`).

## 7. Record opening balances

Leave tab → **Record opening balances** (optional step). Annual leave days and/or comp days earned to date. Recorded **once**: a second attempt says they were already recorded and writes nothing; the database refuses a second row even for two simultaneous clicks. A later correction is an ordinary ledger adjustment.

Evidence: `Flow` (a second submit refused, one row exists); `RLS` (one opening balance per employee).

## 8. Insurance, loans and performance

* **Insurance & Loans.** Active records with a review sentence (Active / expires in N days / expired, and who renews: an HR Admin). The add forms are the existing ones, now headed "For <employee> · <company>".
* **Performance.** Open goals, appraisal states and a **who acts next** list: ratings the reporting manager still owes, drafts the manager or an HR Admin submits, appraisals waiting for the employee to acknowledge. The existing goal and appraisal forms are unchanged.

Evidence: `Code` (`performanceNextSteps`, `policyReview`, form context tests). Not re-run in the browser flow.

## 9. Account invitation and access (People & Access)

1. On the Overview, the card **Account, HR roles and module access** says which company and modules a change there affects and whether a login is linked.
2. **Open People & Access** lands on this person (`?person=u:<userId>` with a login, `e:<employeeId>` without).
3. A System Administrator invites; an HR Admin links an account that exists (the Link an account control on the Overview). Changes to access are made, confirmed and named (company and module) in People & Access.
4. Saving employment details never changes an invitation or a grant, and the reverse.

Evidence: `Flow` (card text, link target, the Sales, Projects, Operations, Inventory, Finance and HR grants unchanged after employment saves).

## 10. Remove or restore a person

On the profile, **Remove** or **Restore** (HR Admin of the company). Removed records appear in the directory only under **Show deleted** and every setup step reads Not applicable. Removal is made on the profile, not from a row of the list.

## 11. Staff guidance written for these workflows

Five published topics in [`../staff-guidance/people.md`](../staff-guidance/people.md): add an employee; finish a new employee's remaining steps; change someone's job title or pay; add or renew a document; find someone's account and module access. They use the screens' own words and carry no record data.

## 12. Real-phone checklist for HR (for the owner's own phone; not run by Claude)

On a phone, signed in as an HR Admin of one company, with **fictional** people only. **Preview shares Production data**: the steps marked WRITES create real rows. Do them with a clearly fictional name and remove the person afterwards (Remove on the profile).

1. Open **Employees**. Search by an employee number, then by a name. *Add employee* is visible without scrolling sideways.
2. Open a person, then press back: the search and filters are as you left them.
3. **WRITES** Press *Add employee*. Nothing but the company is asked. Choose a company: its country and currency appear. Fill name, number, hire date only. Press save **twice quickly**: one person, and their profile opens with the list of what is left.
4. Leave the page (open Employees, then come back through the *Needs attention* flag on the new person). The same person, the same list.
5. **WRITES** Press *Add contract*: the person and company are named, the start is the hire date. Save: the step is Done.
6. **WRITES** Press *Add salary*: date is the hire date, currency the company's. Save: Done.
7. **WRITES** Press *Add document*: the type list leads with your country's. Pick Visa: it asks for a file and an expiry date beside the fields. Add a photo as the file. Then *Renew* it: the type is locked and the earlier one stays listed.
8. **WRITES** Change job or pay: enter a new pay with a date next month: it says *Scheduled* and the current pay does not change.
9. Open the person as yourself on a second device: the same list. Open *People & Access* from the card: the person is chosen and the company and module are named.
10. Check nothing needs sideways scrolling, every button can be pressed with a thumb, and the circled **i** opens its text on touch and with the keyboard.
11. Remove the fictional person.

## 13. Stop and ask

* A person who cannot see Compensation or Documents is **not** shown a "to do" for them; ask an HR Admin.
* There is no screen to cancel or edit a scheduled change in Phase 1 (an open decision in `people-hr.md` section 11). Ask the database owner before removing one by hand.
* Anything about invitations, resets or module access: People & Access, by a System Administrator or the people who manage it.
