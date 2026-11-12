# People & Access: the Job & department tab

**Scope.** This reference covers one tab of People & Access, written when it was changed on 2026-11-12 (Add department). The rest of People & Access (the people list, Account, HR roles, Module access, company settings, invitations) has no per-control reference yet; see `docs/people-access-design.md` (an older design input, not authority) and 02 and 03 of the Map.

**Status (2026-11-12).** Branch `claude/admiring-cray-uky379`, built from `main` at `402f39a`, draft PR #88, not merged. Two parts. (1) Add department: app only. (2) Database enforcement: **one additive migration, `supabase/migrations/20270103000100_departments_company_integrity.sql` (install-order row 31), not applied anywhere by Claude; hosted not applied at the time of writing.** No change to who may add departments or edit employees. Nothing was seen signed in by Claude.

Sources, read at the branch head:

* JP `apps/web/src/components/people-access/job-panel.tsx`
* PD `apps/web/src/components/people-access/person-detail.tsx`
* D `apps/web/src/lib/people-access/data.ts`
* A `apps/web/src/lib/actions/peopleAccess.ts` (`updateJobDetails`, `addDepartment`)
* P `packages/domain/src/permissions` (`canEditJobDetails`)
* M `supabase/migrations/20260922000000_phase0_foundations.sql` (`departments`, `departments_select`, `departments_write`, `employees_update_hr`)

## 1. Where it is and who sees it

People & Access (`/people-access`), choose a person, tab **Job & department**. The tab exists only when the person has an employee record (D: `if (employee) tabs.push("job")`). Panel title "Job & department", description "From the employee record. There is no second copy of it here." (PD).

| Viewer | What they get |
|---|---|
| HR Admin of the employee's company (`canEditJobDetails`, P) | The facts, the edit form and **Add department** |
| Anyone else who can open the tab (a System Administrator, an HR Admin of another company) | The facts and "Only an HR Admin of <Company> can change these details." No form, no Add department |

## 2. What it shows

Facts (JP): **Company**, **Job title**, **Department**, **Reporting manager**; "—" where nothing is recorded. If the person has a department but the departments could not be read, Department says "Could not be loaded" (never "—").

## 3. Controls

| # | Control | What it does | Enforced where |
|---|---|---|---|
| 1 | **Job title** (text, up to 120) | Part of Save job details | A `jobSchema` |
| 2 | **Department** (list: "None", then the active departments of the employee's company by name) | Part of Save job details. A department of another company is refused: "Choose a department of this employee's company." | A `updateJobDetails`; the list itself is read for the employee's company only (D) |
| 3 | **Reporting manager** (list: "No one", then the other employees of the same company) | Part of Save job details; refuses the person themselves, another company and a reporting circle | A `updateJobDetails` |
| 4 | **Save job details** | Writes `job_title`, `department_id` and `manager_id` of the existing employee row; recorded by the employee table's audit trigger. "The change was not saved: you are not allowed to edit this employee record." when the database changes no row | A; M `employees_update_hr` (HR Admin of the company) |
| 5 | **Add a department for <Company>** (text, up to 80) with **Add department** (added 2026-11-12) | Adds one department to the employee's company. The new department appears in the Department list and is selected at once; it is given to the person only when **Save job details** is pressed | A `addDepartment`; M `departments_write` (HR Admin of that company, or a System Administrator) |
| 6 | **Open <name>'s full employee record** | Link to `/employees/<id>` | The employee page's own rules |

## 4. Add department, in detail (A `addDepartment`)

1. The name is trimmed and runs of spaces become one space. Blank: "Enter the department's name." Over 80 characters: "Keep the department's name under 80 characters."
2. The company is read from the employee record on the server. Nothing in the form names a company, so the action cannot add to a company other than that of an employee the caller may edit.
3. The caller must be HR Admin of that company (`canEditJobDetails`): "Only an HR Admin of this employee's company can add a department." An employee the caller cannot read: "You cannot see this employee record."
4. The company's active departments are read. If that read fails nothing is added: "The company's departments could not be checked, so nothing was added. Try again in a moment."
5. A name already used in that company, compared without regard to capitals or surrounding spaces, is refused: "This company already has a department called "<name>". Choose it in the list." The same name in another company, or the name of a removed department, is not a duplicate.
6. The row is inserted with the company and the name only. The database rule decides again; a refusal reads "The department was not added: you are not allowed to add departments for this company."
7. The page is refreshed and the action returns the new department, which the form adds to the list and selects before the refresh arrives.

**Limits, stated plainly.**

* There is no rename, no remove and no parent department on this screen. A misspelt department stays until one of those is built.
* Until migration `20270103000100` is applied to a database, only the app makes the duplicate-name check and the same-company check (the two bullets that stood here before said so). Section 4a describes the database rules once it is applied.
* Departments here are HR departments of a company. The "department" teams of a project in Projects & Tasks are a separate record and are not affected.

## 4a. Database enforcement (migration `20270103000100_departments_company_integrity.sql`, install-order row 31)

The migration changes and deletes no data and no permission. If existing data already breaks a rule it **stops before installing anything** and says how many rows are concerned (employee records pointing at another company's department; active names used twice in a company; blank active names). The preflight pack lists them so a person decides what to do with each.

| Rule | How | What a refusal says |
|---|---|---|
| An employee's department belongs to the employee's company | Trigger `trg_employees_department_company` on `employees` (insert, or a change of `department_id` or `company_id`); function `employees_department_company_check` | "The department belongs to another company. Choose a department of this employee's company." The app shows "Choose a department of this employee's company." |
| A new assignment cannot be to a removed department | Same trigger. A person already in a department that is removed later keeps it, and their other details can still be edited | "The department has been removed. Choose a department of this employee's company." |
| A department with employees cannot be moved to another company | Trigger `trg_departments_company_move` on `departments` | "This department has employees of its present company. Move them first." |
| One active department per name per company | Unique index `uq_departments_company_name_active` on `(company_id, department_name_key(name))` where not removed. `department_name_key` trims, collapses runs of spaces and lower-cases. A removed department's name is free again; another company may use the same name | Database: duplicate key. The app (`addDepartment`) shows: "This company already has a department called "<name>". Someone added it a moment ago. Reload the page and choose it in the list." |
| A department name is not blank | Check constraint `departments_name_not_blank` | The app refuses a blank name first |

Clearing the department (setting none) and moving a person between departments of their own company are unaffected. An edit that changes neither the department nor the company is never checked.

**Owner packs** (`supabase/manual-sql`): `dept_integrity_00_preflight_readonly.sql` (read-only; rows 2 to 4 must be `0 - OK`; three commented list queries show any conflicts), `dept_integrity_20_verify_readonly.sql` (read-only; 8 rows, all `OK`), `dept_integrity_90_rollback.sql` (changes the database: removes the two triggers, their functions, the index and the blank-name rule; deletes no data).

**Order.** Apply after row 30. It depends only on the foundation tables, but timestamp order is install order. The app in this PR works before and after the migration: before, only the app's checks apply.

**Hosted, as far as is known.** The owner's read-only query of 2026-11-12 returned zero active departments for every company, so there can be no duplicate active name and no blank active name there. Whether any employee record points at a removed department of another company was not reported: preflight row 2 answers it. `Unverified` by Claude.

## 5. Empty and failed states

| Situation | What the screen says | Source |
|---|---|---|
| The company has no departments (the read succeeded) | Under the Department list: "No departments have been created for <Company> yet. Add the first one below." Add department is offered | JP; D `departmentsLoaded: true` |
| The departments could not be read | "Departments could not be loaded. Reload the page to try again. Saving now leaves the department as it is." The list and Add department are not shown; the form posts the person's current department back unchanged, so saving the job title or manager cannot clear it | JP; D `departmentsLoaded: false` |

Before 2026-11-12 a failed read was indistinguishable from an empty company (the error was dropped in D).

## 6. Hosted facts

* Owner-reported (2026-11-12): a read-only query on the hosted database returned **zero active departments for every company**. That, with the absence of any screen to add one, is why the list was empty. Claude ran no hosted SQL.
* No hosted data change is part of this work. Departments are created by HR in the app after it is deployed.

## 7. Tests

| File | What it shows |
|---|---|
| `apps/web/src/lib/actions/peopleAccess.test.ts` ("addDepartment", 5 tests) | Trimmed name into the employee's own company; the company never comes from the form; blank and duplicate names refused, other companies and removed departments not duplicates; another company's HR Admin, a person without the role and an unreadable employee refused; nothing added when the check read fails; a database refusal reported |
| `apps/web/src/components/people-access/job-panel.test.tsx` (5 tests) | Empty company message; failed load message with no list and the department posted back unchanged; a new department offered and selected at once; a refusal shown; no controls for someone who cannot edit |
| `apps/web/src/lib/people-access/data.test.ts` ("tells a company with no departments apart...") | The two states come from the read, not from the list being empty |
| `packages/rls-tests/test/departments-integrity.rls.test.ts` (8 tests, real PostgreSQL) | Before the migration the database accepts a cross-company department and a duplicate name; the preflight counts them and the migration stops, installing nothing and changing no data; on clean data it installs (twice) and the verify pack is all `OK`; **a direct update as HR Admin is refused for another company's department, while the same company, a move within the company and clearing all work**; a new employee, a removed department and moving an employee or a department between companies are covered; names are unique whatever the capitals and spaces; three creates of the same name at once keep exactly one; who may add departments is unchanged; rollback deletes nothing and re-applying restores the rules |
| `packages/rls-tests/test/phase0.rls.test.ts` (2 tests, real PostgreSQL) | An HR Admin adds a department, gives it to an employee of the same company and reads both back in a new session; the same HR Admin cannot add one for another company or change that company's employee; people without the role cannot add one |

**Not verified:** nothing signed in, in Preview or Production. The three states were seen on a temporary page with fictional data (not committed). The local-stack browser flow `apps/web/os-shell-checks/people-access-flow.mjs` was not run and has no step for Add department.
