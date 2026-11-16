# People & HR: coverage index (employee directory, profile and onboarding)

**Status.** Written for **People & HR Phase 1** on branch `feat/people-hr-phase1`: a draft pull request, **not merged**, hosted migration `20270115000100` **applied by the owner (owner-confirmed, not seen by Claude)**, Production not deployed from this branch. Required CI: first run recorded on the pull request (not part of this file). Every reachable screen and part of the employee directory and profile, with who reaches it, where it is documented and what proves it. Other People & HR pages (My Leave, attendance, letters, payroll, assets, alerts, reports, companies, audit log) are outside Phase 1 and are listed in section 8 so they are not mistaken for covered.

**References.** `R` = [`people-hr.md`](./people-hr.md). `W` = [`people-hr-workflows.md`](./people-hr-workflows.md). `C` = [`people-hr-action-catalogue.md`](./people-hr-action-catalogue.md).

**Evidence.** `Flow` = driven signed in at 390 px on the isolated stack by `apps/web/os-shell-checks/people-hr-phase1-flow.mjs`: 20 of 20 steps passed at the earlier head `e42a067`; it was NOT re-run after the date, allowance, stale-pay and cancel correction (its psql lines were updated to the new function forms and are unrun). `RLS` = `packages/rls-tests/test/people-hr-phase1.rls.test.ts` (19 tests passed after the correction (13 before it); the full RLS suite (95 files, 2198 tests) passed at the earlier head `e42a067` and is left to required CI for the corrected head). `Code` = unit or component tests only (the focused files were re-run after the correction; the full web suite (382 files, 4251 tests) passed at the earlier head `e42a067` and is left to required CI for the corrected head). `Not run` = read from the code, not exercised by any check.

## 1. Directory and Add employee

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| HR-01 | Employees list: search by name or number, Company and Status filters, paging | `/employees` | every signed-in person, scoped by policy (self; reports; company; administered) | R 4.1; W 2 | none | `Flow` (number, name, filters); `Code` (`directory-data.test`) |
| HR-02 | Needs attention flags on a row | `/employees` | HR Admin of the employee's company (others see none) | R 4.1 | none | `Flow` (flag on a partly set-up person); `Code` |
| HR-03 | Search, filters and page restored on return from a profile | `/employees` | as HR-01 | R 4.1; W 2 | none | `Flow` |
| HR-04 | Show deleted, Download CSV | `/employees` | HR Admin, System Administrator | R 4.1 | none | `Not run` (unchanged) |
| HR-05 | Add employee button | `/employees` | HR Admin (somewhere) | R 4.1 | `people.employee.create` | `Flow` (visible at phone width) |
| HR-06 | Add employee: company first, then its country and currency | `/employees/new` | HR Admin of at least one company; only those companies listed | R 4.2; W 3 | `people.employee.create` | `Flow` (UAE, Saudi Arabia, Poland, no default currency, restricted HR Admin's company list); `Code` |
| HR-07 | Identity and job once; contract, pay and opening balances optional | `/employees/new` | as HR-06 | R 4.2; W 3 | `people.employee.create` | `Flow`; `Code` |
| HR-08 | Repeated send resumes the same record; repeated number refused with a link | `/employees/new` | as HR-06 | R 5; W 3 | `people.employee.create` | `Flow` (double click, one record); `Code` |
| HR-09 | Partial failure after create: profile opens on the first remaining step with a notice | `/employees/[id]?created=1&notice=` | as HR-06 | W 3 | `people.employee.create` | `Code` (unit assertions); not forced in a browser |

## 2. The profile: header, Overview, checklist

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| HR-10 | Profile header: name, job title and company, department, status, hire date; Remove or Restore | `/employees/[id]` | the person, their manager, HR Admin, Finance and CEO/CTO of the company, System Administrator | R 4.3 | `people.employee.remove` | `Flow` (names visible on every form) |
| HR-11 | Permission-gated tab list; an unreachable tab falls back to Overview even by direct address | `/employees/[id]?tab=` | each tab by its own rule | R 4.3, 6 | none | `Flow` (HR Admin of another company, Finance, line manager, employee); `Code` |
| HR-12 | "Employee created. Finish setup below." notice | `?created=1` | as HR-10 | R 4.2 | none | `Flow` |
| HR-13 | Next actions | Overview | HR Admin of the company | R 4.3 | none | `Flow`; `Code` (`profile-pieces.test.tsx`) |
| HR-14 | Setup checklist: Contract, Compensation, Documents, Opening balances (optional), Account invitation; Not applicable for a leaver | Overview | HR Admin of the company; a step the viewer cannot read is hidden | R 4.4; W 4 | none | `Flow`; `Code` (`setup.test`) |
| HR-15 | At a glance: company, department, manager, status, hire date | Overview | everyone who can open the profile | R 4.3 | none | `Flow`; `Code` |
| HR-16 | Account, HR roles and module access card; Open People & Access | Overview | System Administrator, HR Admin of the company; never for the person themself | R 4.8; W 9 | none | `Flow` (text, link, grants unchanged) |
| HR-17 | Core details form (edit employee), job details, Link an account | Overview | HR Admin of the company | R 4.3 | `people.employee.update`, `people.employee.job_details`, `people.employee.link_account` | `Flow` (job step); other paths `Not run` (unchanged) |

## 3. Employment and pay

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| HR-18 | Current terms | `?tab=employment` | HR Admin, Finance, the person (pay); contract readers | R 4.5; W 5 | none | `Flow`; `Code` (`employment-timeline.test.tsx`) |
| HR-19 | Scheduled changes | `?tab=employment` | people who see career events: the person, HR Admin, Finance | R 4.5 | `people.employment.apply_due`, `people.employment.cancel` | `Flow` (a later-dated change listed, nothing moved; earlier head); `RLS` (held, cancelled, failed and per-country cases); `Code` (the held and cancelled rows and the flag) |
| HR-20 | Change job or pay (one form; job title and pay together) | `?tab=employment&change=job`, `#change-employment` | HR Admin: both, now or scheduled; Finance: pay only, today or earlier | R 4.5; W 5 | `people.employment.change` | `Flow`; `RLS`; `Code` (`change-employment-form.test.tsx`) |
| HR-21 | Add salary (first pay) in the same form, from the hire date and the company currency | `?tab=employment&step=pay` | as HR-20 | R 4.4; W 4 | `people.employment.change` | `Flow` |
| HR-22 | Contract history and Add contract | `?tab=employment&step=contract` | contract readers; HR Admin adds | R 4.3; W 4 | `people.contract.add` | `Flow` (add contract) |
| HR-23 | History (applied changes) | `?tab=employment` | as HR-19 | R 4.5 | none | `Flow`; `RLS` (rows from the previous build count as applied) |
| HR-24 | Compensation tab: current pay, Change salary or Add salary | `?tab=compensation` | the person, HR Admin, Finance | R 4.3; W 5 | none | `Flow` (shortcut) |
| HR-25 | Final settlement (leaver) | `?tab=compensation` | per existing rule | R 4.3 | `Poland` steps in `C` 2 | `Not run` (unchanged) |
| HR-26 | Daily job applying scheduled changes | `/api/cron/employment-changes` | the cron secret | R 4.5, 5 | `people.employment.apply_due` | `RLS` (the function, including the held, failed and per-country cases); the route `Code` (a failed event answers 500 and keeps the run's other results; a held one answers 200); Vercel scheduling `Not run` (owner decision deferred); the route is listed as public in `proxy.ts` and answers 401 without the cron secret (R 4.5) |

## 4. Documents

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| HR-27 | One Documents list, grouped by type, states in words, View / Download | `?tab=documents` | employee documents: the person and HR Admin; identity documents: the person and HR Admin only | R 4.7; W 6 | none | `Flow`; `Code` |
| HR-28 | Add document (type decides the fields; country's types first) | `?tab=documents&add=<type>` | HR Admin of the company | R 4.7; W 6 | `people.document.add` | `Flow` (Visa needs its file); `Code` (`add-document-form.test.tsx`) |
| HR-29 | Renew (type locked, earlier number copied, earlier document kept) | `?tab=documents&add=<type>&renew=1&docId=` | HR Admin | R 4.7; W 6 | `people.document.add` | `Flow` |
| HR-30 | Remove, Restore a document | Documents list | HR Admin | R 4.7 | `people.document.remove` | `Not run` (unchanged) |

## 5. Leave, insurance, loans, performance

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| HR-31 | Leave tab (read only) and Record opening balances | `?tab=leave&step=opening-balances` | readers: person, manager, HR; form: HR Admin | R 4.6; W 7 | `people.balances.record` | `Flow` (recorded once, second refused); `RLS` |
| HR-32 | Insurance: active policies, review sentence, Add policy (employee and company named) | `?tab=insurance-loans` | the person, HR Admin, Finance; HR Admin adds | R 4.3; W 8 | `people.insurance.add` | `Code` (`policyReview`); not in the browser flow |
| HR-33 | Loans: active loans, Add loan (employee and company named) | `?tab=insurance-loans` | as HR-32 | R 4.3; W 8 | `people.loan.add` | `Code`; not in the browser flow |
| HR-34 | Performance: open goals, who acts next, goal and appraisal forms | `?tab=performance` | the person, manager, HR Admin | R 4.3; W 8 | `people.goal.rate` | `Code` (`performanceNextSteps`); not in the browser flow |

## 6. Cross-module links and where they land

| # | Link | From | To | Evidence |
|---|---|---|---|---|
| HR-35 | People & Access for this person | Overview card, setup step | `/people-access?person=u:<user>|e:<employee>&tab=` | `Flow` |
| HR-36 | Inventory custody (employee equipment) | Assets tab | existing link, unchanged | `Not run` (not touched) |
| HR-37 | My Day, My Leave, Approvals | their own pages | unchanged; Phase 1 edits none of them | `Not run` |

## 7. Counts

37 rows: 9 Directory and Add employee, 8 profile header, Overview and checklist, 9 employment and pay, 4 documents, 4 leave, insurance, loans and performance, 3 cross-module links. Evidence: `Flow` on 27 rows (4 of them also `RLS`: HR-19, HR-20, HR-23, HR-31); the daily job HR-26 by `RLS` and `Code`, its Vercel scheduling `Not run`; `Code` only on 4 (HR-09, HR-32 to HR-34); `Not run` on 5 (HR-04, HR-25, HR-30, HR-36, HR-37).

## 8. Outside Phase 1 (not covered here; do not read these as tested by this phase)

| Destination | Phase |
|---|---|
| Profile tabs Attendance and Assets | exist, unchanged |
| HR work queue (Alerts, what waits on HR) | **Phase 2** (section 7 below) |
| Letters, Payroll, Assets register, Companies, Audit Log, AI Suggestions | Phase 3, planned (Phase 2 adds only Administration, Background processing) |
| My Leave, My Attendance, My Reimbursements, My Performance | exist, unchanged |

## 7. Phase 2: the HR work queue

**Status.** People & HR Phase 2 on branch `feat/people-hr-phase2`: a draft pull request, **not merged**, migration `20270116000100` **not applied anywhere**. `R` = [`people-hr.md`](./people-hr.md) section 14. `Walk` = `apps/web/os-shell-checks/people-hr-phase2-walkthrough.mjs` (seed `seed/people-hr-phase2.sh`), driven signed in at 390 px on the isolated stack with fictional people; `DB` = `packages/rls-tests/test/people-hr-phase2.rls.test.ts`; `Unit` = `lib/hr/queue.test.ts`, `attendance-status.test.ts`, the alerts page test, the register-table test.

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| HR-40 | Alerts: Needs action / Due soon / Acknowledged, Company, Type and name filters, view tabs with counts | `/alerts` | HR Admin, CEO, CTO (rows by RLS) | R 14.1 | none | `Walk`; `Unit` (alerts page) |
| HR-41 | A queue row: employee, company, issue, date, status, who acts next, one action | `/alerts` | as HR-40 | R 14.1 | none | `Walk`; `Unit` |
| HR-42 | Mark as seen (an acknowledgement; the issue stays open) | `/alerts` | HR Admin of the item's company | R 14.2 | `people.queue.acknowledge` | `Walk`; `DB` |
| HR-43 | Document expiry opens the renewal form for that document; contract and probation open the Employment tab | `/employees/[id]` | HR Admin of the company | R 14.1 | none (Phase 1 actions) | `Walk` |
| HR-44 | Attendance register leads with Needs review; day words No record / Rest day / Absent / On leave / Present; a link opens one person's row | `/attendance` | HR Admin of the company | R 14.1, 14.4 | none | `Walk`; `Unit` (register table, day wording) |
| HR-45 | Profile Attendance tab leads with Needs review and the days concerned | `/employees/[id]?tab=attendance` | who may see attendance; exceptions HR Admin only | R 14.1 | none | `Walk` |
| HR-46 | Profile Leave tab: balances, Pending requests with a link to the exact Approvals row | `/employees/[id]?tab=leave` | who may see leave; the link only for HR Admin or the manager | R 14.1 | none | `Unit` (code); not driven in `Walk` |
| HR-47 | Profile Overview: Next actions use the queue's words and links | `/employees/[id]` | HR Admin, CEO, CTO | R 14.1 | none | `Walk` (before and after renewing) |
| HR-48 | My Day HR rows count what Alerts lists as waiting (an acknowledged item is not counted) | `/` | HR Admin, CEO, CTO | R 14.1 | none | `Walk`; `Unit` (attention) |
| HR-49 | A failed read of any part is named with Try again; "Nothing needs attention" only after a successful read | `/alerts` | as HR-40 | R 14.1 | none | `Unit` |
| HR-50 | Background processing and the database fingerprint (moved out of the queue) | `/admin/background-processing` | System Administrator | R 14.7 | none | `Unit` (nav); the page itself is not driven |
| HR-51 | Another company's items and records are not listed or openable; the database refuses the acknowledgement | `/alerts`, `/employees/[id]`, `/attendance` | HR Admin of another company | R 14.3 | none | `Walk`; `DB` |
