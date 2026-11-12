# People & Access: the Job & department tab

**Scope.** This reference covers one tab of People & Access, written when it was changed on 2026-11-12 (Add department). The rest of People & Access (the people list, Account, HR roles, Module access, company settings, invitations) has no per-control reference yet; see `docs/people-access-design.md` (an older design input, not authority) and 02 and 03 of the Map.

**Status (2026-11-12).** Branch `claude/admiring-cray-uky379`, built from `main` at `402f39a`. App only: **no migration, no SQL, no change to permissions**. It uses the `departments` table and its two rules exactly as they are. Not merged at the time of writing. Nothing was seen signed in by Claude.

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
* The duplicate check is made by the app before the insert. The table has no unique rule, so two people adding the same name in the same second could both succeed. `Unverified` whether this has ever happened on hosted.
* The same-company check on assignment is made by `updateJobDetails`. The database rule checks who may edit the employee (HR Admin of the employee's company); it does not itself compare the department's company with the employee's.
* Departments here are HR departments of a company. The "department" teams of a project in Projects & Tasks are a separate record and are not affected.

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
| `packages/rls-tests/test/phase0.rls.test.ts` (2 tests, real PostgreSQL) | An HR Admin adds a department, gives it to an employee of the same company and reads both back in a new session; the same HR Admin cannot add one for another company or change that company's employee; people without the role cannot add one |

**Not verified:** nothing signed in, in Preview or Production. The three states were seen on a temporary page with fictional data (not committed). The local-stack browser flow `apps/web/os-shell-checks/people-access-flow.mjs` was not run and has no step for Add department.
