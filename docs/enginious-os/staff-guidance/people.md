# Staff guidance: People & HR

Approved, staff-facing guidance. JARVIS answers "how do I" questions from the topics below that are marked `published` (see [README](./README.md)).

## Ask for leave and see your balance
- id: people-leave
- area: people
- status: published
- keywords: leave; request leave; annual leave; holiday request; time off; leave balance; sick leave; new leave request; day off
- links: My Leave -> /leave; New leave request -> /leave/new
- screens: /leave; /leave/new

Your own leave balances and requests are on the My Leave page, and a new request starts from there. JARVIS cannot read or change leave: use the screens.

1. Open My Leave.
2. Press the button for a new request and fill it in.

## Clock in and out
- id: people-clock
- area: people
- status: published
- keywords: clock in; clock out; attendance; check in; check-in; check out; timesheet; working hours
- links: My Attendance Clock -> /attendance-clock; My Attendance -> /attendance
- screens: /attendance-clock; /attendance

Your own clock in and clock out are on My Attendance Clock; your own attendance record is on My Attendance.

1. Open My Attendance Clock to clock in or out.
2. Open My Attendance to see your record.

## Expense claims
- id: people-claims
- area: people
- status: published
- keywords: expense; expenses; reimbursement; reimbursements; claim; claims; receipt; expense claim; refund
- links: My Reimbursements -> /reimbursements
- screens: /reimbursements

Your own expense claims are on the My Reimbursements page, and each claim opens for its details.

1. Open My Reimbursements and choose a claim, or start a new one there.

## Getting access to a module
- id: people-access
- area: people
- status: published
- keywords: access; no access; permission; can't see; cannot see; give me access; who can give access; module access; grant access; why can't i; not allowed
- links: People & Access -> /people-access
- screens: /people-access

Access to a module (Sales, Projects, Inventory and so on) is given by the people who manage People & Access: a System Administrator, an HR Admin, or a module access manager. If a screen says you do not have access, ask one of them. JARVIS cannot change anyone's access.

1. Open People & Access if you manage access, or ask the person who does.

## Add a department and give it to someone
- id: people-add-department
- area: people
- status: published
- keywords: department; add department; create department; new department; department list empty; no departments; assign department; change department; job and department; reporting manager
- links: People & Access -> /people-access
- screens: /people-access

An HR Admin adds departments for their own company in People & Access, on a person's Job & department tab. A new department joins that company's list and is selected for the person on screen; it is given to them only when Save job details is pressed. A name already used in the company is refused. If the screen says departments could not be loaded, reload the page; that is not the same as having none. Departments cannot be renamed or removed here yet.

1. Open People & Access and choose an employee of your company.
2. Open the Job & department tab.
3. Under Add a department, type the name and press Add department.
4. Check the Department list shows it selected, then press Save job details.
5. For the next person, choose the department from the list and press Save job details.

## Make someone an Operations Manager, or stop it
- id: people-operations-manager-access
- area: people
- status: published
- keywords: operations manager access; make someone operations manager; who can open operations; remove operations manager; take away operations access; operations manager profile
- links: People & Access -> /people-access
- screens: /people-access

Operations Manager is given per company, inside a person's Projects access, by a Projects founder or someone who manages Projects access. It opens Operations for that company, lets the person assign Project Managers, read every project of the company and use its project chats. It gives nothing in Sales, Finance, HR or the warehouse, and they cannot manage a project or its tasks.

1. Open People & Access, find the person and open their Projects access; check Access for company.
2. Under Working profile choose Operations Manager.
3. Read Review before saving, then press Save changes. They see Operations on their next page.
4. To stop it, choose another profile such as Project directory viewer, review and press Save changes.
5. It ends on their next page: Operations and the company's project chats close for them.

## Add an employee
- id: people-add-employee
- area: people
- status: published
- keywords: add employee; new employee; create employee; new hire; add a person; onboard employee; onboarding; hire; employee number; add staff
- links: Employees -> /employees; Add employee -> /employees/new
- screens: /employees/new

An HR Admin adds an employee from the Employees list. Choose the company first: its country and currency are used for the new person, so you do not type them. You enter the name and hire date once; the employee number is given automatically when you save (the next one in a single series shared by every company, such as E007, and it stays with the person). You may add the contract, salary and opening leave balances now or later. Pressing the button twice never creates a second person.

1. Open Employees and press Add employee.
2. Choose the company, then fill in the name and hire date. Do not look for an employee number field: it is assigned when you save.
3. Add the job, department, manager, contract and salary if you have them; leave the rest for later.
4. Press the button at the bottom. The Onboarding page for that person opens (see Finish onboarding a new employee below).

## Finish a new employee's remaining steps
- id: people-employee-remaining-steps
- area: people
- status: published
- keywords: finish onboarding; remaining steps; what is left; incomplete employee; resume onboarding; continue adding employee; contract missing; salary missing; opening balances; needs attention; what is missing for employee
- links: Employees -> /employees
- screens: /employees/[id]

A new employee's profile lists what is still to do: contract, salary, documents, opening leave balances (optional) and the account invitation. The list is worked out from what is already saved, so you can leave at any point and come back, on any device, to the same person. The Employees list flags the same people under Needs attention.

1. Open Employees, find the person by name or employee number, and open them. Rows marked Needs attention are the ones with steps left.
2. On the Overview, press the button beside a step. The form opens with the person and company already filled in.
3. Save it; the step is marked done when you return to the Overview.
4. A step that does not apply to this person says Not applicable.

## Change someone's job title or pay
- id: people-change-job-or-pay
- area: people
- status: published
- keywords: change salary; raise; pay rise; salary increase; promotion; change job title; new job title; schedule a salary change; change pay; effective date; pay history; scheduled change
- links: Employees -> /employees
- screens: /employees/[id]

A job title and pay change is made in one form on the person's Employment tab, and the Compensation tab's Change salary button opens the same form. You choose the date it takes effect. A date of today or earlier, by the employee's own country calendar, applies now; a later date is scheduled and changes nothing until that day. The job title and pay are saved together or not at all, and allowances you do not edit are kept.

1. Open the person and go to the Employment tab, or press Change salary on the Compensation tab.
2. Enter the new job title and/or the new pay, and the date it takes effect.
3. Read the line beside the button, which says what will happen on save, then save.
4. Check the Current terms, Scheduled changes and History lists. After the date, the change should be in Current terms.
5. If the pay you entered was a mistake, do not record a raise: use Correct pay record (see Correct a mistaken pay record below). If a scheduled change says Held for review, pay was changed after it was scheduled and nothing was applied: read the reason, cancel it (HR Admin) and record the change again from the current pay. If it is still under Scheduled changes after its date with no such label, tell your System Administrator.

## Add or renew a document
- id: people-renew-document
- area: people
- status: published
- keywords: add document; renew document; passport expired; visa expiring; document expiry; emirates id; iqama; labor card; upload document; renew passport; expired document; identity document
- links: Employees -> /employees
- screens: /employees/[id]

All documents are added in one form on the person's Documents tab. The type you choose decides what is asked: an identity document needs its number, a visa or labor card needs a file and an expiry date. To renew, press Renew beside the expired or expiring document: the form opens with the person and type filled in and the earlier number copied, and the earlier document stays in the history.

1. Open the person and go to the Documents tab.
2. Press Add document (or Renew beside an existing one) and choose the type.
3. Fill in what the type asks for and attach the file if it is required. A file can be a PDF, JPEG, PNG or WebP of up to 10 MB; the form refuses another type or a bigger file beside the field before anything is sent.
4. Save. Identity documents are visible only to the person and their HR Admin. If saving fails, read the message under the file field and press the button again: it never creates a second document.
5. If an identity document shows No file attached, an HR Admin presses Attach file on that row and chooses the scan. It is added to the same document; the number and dates do not change, and a document that already has a file cannot be replaced this way.

## Find someone's account and module access
- id: people-find-access-record
- area: people
- status: published
- keywords: invite employee; employee login; account invitation; no login; link account; give module access; employee access; where do I give access; people and access from profile
- links: People & Access -> /people-access; Employees -> /employees
- screens: /people-access

Employment details and access are kept apart: saving an employee never changes an invitation or what they can open. From the person's profile, the Account, HR roles and module access card opens People & Access on that person, and says which company and modules a change would affect. Only a System Administrator sends invitations; an HR Admin links an account that already exists.

1. Open the employee's profile and find Account, HR roles and module access on the Overview.
2. Press Open People & Access. The person is already chosen.
3. Read the company and module named on the screen before changing anything, then save there.

## Work through the HR Alerts queue
- id: people-hr-alerts-queue
- area: people
- status: published
- keywords: alerts; hr alerts; hr queue; needs action; due soon; acknowledged; mark as seen; probation due; contract ending; document expiring; document expired; expiry; renew passport; attendance exception
- links: Alerts -> /alerts
- screens: /alerts

Alerts is the HR work queue: contracts ending, probation reviews, document expiries, attendance exceptions, Recovery Leave alerts and AI suggestions waiting for a decision, in three groups: Needs action, Due soon and Acknowledged. Each row names the employee and company, what is wrong, its date and who acts next, with one button that opens the exact record. Mark as seen only records that you looked; the item stays until the record itself is fixed.

1. Open Alerts and narrow it by company or type if you need to.
2. Press the button on a row. It opens the exact record: the renewal form, the Employment tab, or the register on that day.
3. Fix the record there (renew the document, record the contract change, correct the attendance day), then use the link at the top of the page to return to the same company and filters.
4. If it cannot be fixed yet, an HR Admin presses Mark as seen. The item moves to Acknowledged and stays listed, with its link, until the record is fixed.

## Review an attendance day that needs review
- id: people-attendance-review
- area: people
- status: published
- keywords: attendance register; needs review; no record; rest day; absent; attendance exception; recovery window; verify recovery window; clock records differ; manual entry differs
- links: Attendance register -> /attendance
- screens: /attendance; /employees/[id]

The attendance register leads with Needs review: days where a manual entry and the clock records differ, a recovery window waits for HR to verify it, or an HR alert is open. A day with nothing recorded says No record on a working day and Rest day on a weekly rest day or public holiday. It says Absent only when the day was recorded as absent. Clock status (Clocked in, Clocked out, Not started) is a separate fact.

1. Open the Attendance register, or the Attendance tab on the person's profile.
2. Choose Open this day on a Needs review row. The register opens on that company and date with the person's row open.
3. Read the sessions behind the day and use Edit to correct the original record.
4. Reload the page. A corrected day leaves Needs review, and leaves Alerts too.

## Finish onboarding a new employee
- id: people-onboarding
- area: people
- status: published
- keywords: onboarding; invite employee; send invitation; give access; hr role; assign role; employee role; reporting manager role; module access; review access; resume onboarding; new hire access; who can finish; employee login
- links: Employees -> /employees
- screens: /employees/[id]/onboarding; /employees/[id]

Onboarding is one page for one person, opened when you add an employee. It lists six steps: Add employee, Complete profile, Invite, HR roles, Module access and Review. Each says if it is done, blocked or waiting, who can finish it and what to do next. An HR Admin of the employee's company can invite the login and give the Employee and Reporting Manager roles. You can leave and come back: nothing is repeated.

1. Open the employee's Onboarding page and read the next action at the top.
2. Enter the work email in the plan and press Invite and link. An existing account is linked; no second invitation is sent.
3. Choose the roles (Employee, Reporting Manager, or both) and the module access, and save the plan. Saving gives no access by itself.
4. Open Review, tick the confirmation and apply what you are allowed to apply. HR Admin, Finance, CEO, CTO and System Administrator roles, and module access, are shown with who can apply them.
5. Come back any time: the employee, invitation, roles and access already given are reused.

## Correct a mistaken pay record
- id: people-correct-pay
- area: people
- status: published
- keywords: correct pay record; wrong salary; salary entered by mistake; joining date salary; fix opening salary; correct effective date; pay history correction; mistaken pay
- links: Employees -> /employees
- screens: /employees/[id]

Use Correct pay record on the Compensation tab's history when an entry was wrong, for example the current salary entered with the joining date. Use Update pay for real raises, promotions and scheduled changes. The correction changes that entry in place; the original values stay in the audit trail with your reason and the date. HR Admin or Finance of the employee's company can correct a record.

1. Open the person's Compensation tab and find the entry in the history.
2. Press Correct pay record on that entry and change the amount, the allowances or the effective date.
3. Read the old and new values, the pay in force today before and after, and any warnings, then enter the reason (5 to 500 characters).
4. Save. If a scheduled pay change is based on the entry, cancel it first; the page says so.
5. If the page says an approved payroll run or a final settlement is affected, tell Finance: nothing in payroll was changed and it needs a review.
