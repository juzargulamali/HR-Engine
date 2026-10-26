# ENGINIOUS OS rollout, Stages 4-7 (one integration branch)

Presentation and usability pass only. No database change, no new data, no new business feature. Row-level security, permissions, company
boundaries, URLs, validation, workflows and audit evidence are untouched. Progress is reported with the stage numbers of the rollout
(1 design system, 2 Projects & Tasks, 3 My Day were merged earlier: PRs #45, #46, #47).

## Progress

| Stage | Scope | Status |
| --- | --- | --- |
| 4 | Sales & CRM | Verified |
| 5 | Inventory and My Equipment | Verified |
| 6 | Remaining People & HR, attendance, recovery, approvals, policies, settings, account | Verified |
| 7 | Whole-app consistency, regression checks, final review | Verified (final review by the owner pending) |

Statuses: Not started, In progress, Implemented, Verified.

## How the pass works

- **One scope for the whole signed-in app.** `(app)/layout.tsx` wraps every page in `OsScope`, so the approved tokens (layered petrol surfaces, deep
  ink background, readable text, restrained teal/blue/amber, comfortable tinted light mode) apply to every module, form, dialog, panel and state.
  The shell was already dark in both themes. The sign-in pages keep their own branded layout.
- **Shared pieces, used everywhere**: status colour cues (`OsBadge`/`OsPill`, tones for the same meaning in every module), rows and cards that open
  their record from the empty part (`ClickableRow`, `ClickableCard`; the title stays a real link; buttons, menus, checkboxes and fields do only their job),
  filters kept in the address, the less common ones under "More filters" with chips and a count, list memory (`RememberList` / `BackLink`: coming back
  from a record returns to the same filters and the same place in the list), one loading state, one empty state, one "no access" card, a quiet "Saved"
  confirmation next to the existing error text.
- Colours that were chosen by hand (amber/emerald/sky utility classes) now use the shared status tokens, so light and dark are both checked by the contrast tests.

## Page coverage checklist

Every signed-in page of the application, by route. "Scope" = the v2 look (tokens, layered surfaces, status cues, states), which applies to every
page through `(app)/layout.tsx`. The other columns say what else was done on that page. "Phone" = rows become cards (`Table stack` or the page's own card list),
no sideways scroll (`phone-fit.mjs`). All pages were also surveyed in both themes and at 390 px with `page-survey.mjs` and checked by axe and the contrast audit.

| Page | Stage | Opens from rows/cards | Filters / memory | Notes |
| --- | --- | --- | --- | --- |
| `/sales` (redirects to Follow-ups), `/sales/pipeline` (redirects to Enquiries) | 4 | n/a | n/a | redirects unchanged |
| `/sales/follow-ups` | 4 | rows open the enquiry panel; Done/Reschedule buttons act alone | Mine / Everyone, status tabs | reminders and attention cards on the layered surface |
| `/sales/opportunities` (table, board) | 4 | table rows and board cards open the panel; title stays a link; Move to is independent | search, Stage/Owner visible, Show/Company under More filters with chips; address keeps them | stage words use one tone map (`StageBadge`); board lanes have a coloured top edge |
| `/sales/opportunities/[id]` (+ `/handover`, `/close`) | 4 | n/a | Back to Enquiries returns to the same filters and place | header + actions in one card; a sideways overflow at 1440 px fixed |
| `/sales/proposals` | 4 | rows and phone cards open the enquiry | status filter links | status words use tones |
| `/sales/clients` | 4 | n/a (cards) | search form | kind badge tone |
| `/sales/reports`, `/sales/new`, `/sales/settings`, `/sales/access` | 4 | n/a | n/a | forms and report tables on the shared surfaces; tables stack on phones |
| Sales layout without access / load failure | 4 | n/a | n/a | shared no-access card |
| `/inventory` (items) | 5 | rows open the item panel | search, Category/Location/How tracked visible, Status etc. under More filters | draft/retired words use tones |
| `/inventory/requests` | 5 | rows open the request panel | same bar | request status tones (waiting, in progress, done) |
| `/inventory/movements` | 5 | rows open the movement entry | filters | |
| `/inventory/mine` (My equipment) | 5 | n/a (nothing to open) | n/a | three figure cards (assigned, overdue, next due back), overdue words in amber |
| `/inventory/employees`, `/inventory/labels`, `/inventory/manage`, `/inventory/access`, `/inventory/scan` | 5 | n/a | n/a | forms, setup steps and access cards on the shared surfaces |
| `/projects/**` (all 22 pages) | 2 (merged) + 7 | rows/cards (since Stage 2) | back links keep the list and the task list as they were | amber/green/blue hand-picked colours moved to the status tokens |
| `/employees` | 6 | rows open the profile | search and Company/Status apply as chosen; page resets with the filter | status words use tones; phone cards |
| `/employees/[id]` | 6 | n/a | Back to Employees keeps filters and place (not shown on your own profile) | all profile section tables stack on phones |
| `/employees/new` | 6 | n/a | n/a | no-access card |
| `/leave`, `/leave/new` | 6 | n/a | status filter | balances as figure cards |
| `/attendance`, `/attendance-clock` | 6 | n/a | date form | presentation only; calculations untouched |
| `/approvals` | 6 | reimbursement rows open the claim; Approve/Reject act alone | n/a | decision tables stack on phones |
| `/alerts` | 6 | rows open the employee | n/a | no-access card |
| `/timesheets`, `/timesheets/[id]` | 6 | rows open the timesheet | Back keeps place | |
| `/reimbursements`, `/reimbursements/[id]` | 6 | rows open the claim; Delete draft acts alone | Back keeps place | |
| `/payroll`, `/payroll/[id]` | 6 | rows open the export | Back keeps place | no-access card |
| `/performance`, `/performance/cycles`, `/performance/appraisals/[id]` | 6 | appraisal rows open it | Back keeps place | |
| `/policies`, `/policies/new`, `/policies/[id]` | 6 | rows open the policy | Back keeps place | |
| `/holidays`, `/letters`, `/assets`, `/ai-suggestions`, `/audit-log` | 6 | n/a | n/a | tables stack on phones; no-access cards |
| `/admin/users`, `/admin/companies` | 6 | n/a | n/a | admin layout shows the no-access card |
| `/profile`, `/account/security` | 6 | n/a | n/a | forms on the shared surfaces |
| `/login`, `/forgot-password`, `/reset-password`, `/set-password` | 6 | n/a | n/a | same tokens; card on the layered surface |
| Not-found, error, loading (every signed-in page) | 7 | n/a | n/a | new shared not-found card, error card and loading skeleton |
| `/` (My Day) | 3 (merged) | | | unchanged in this round |

Pages that were already redirects or API routes (`/api/**`, `/os-preview/**`, which stays hidden in Production) are not part of the pass.

## Verification (local stack, fictional data, real roles; the hosted preview stays read-only)

One coordinated pass on the finished code, after the targeted checks made while building:

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck` (all workspaces), unit tests (105 files, 1,197 tests, including the new ones for list memory, stacked tables, status tones and the token contrast tests), production build | pass |
| Sales: `sales-actions` (create, stages, hold, availability, proposal, contacts, Won + handover, founder reopen, reports), `sales-workspace` (follow-ups, enquiries table and board, panel, quick add, owner rules, boundaries) | pass |
| Projects: `projects-workspace`, `projects-flow`, `row-click`, `workflow-steps` | pass |
| Inventory: `inventory-smoke`, flows 1-5 (stock to reconcile, employee equipment, Sales connection, transfers and conflicts and time zones, access and database refusals) | pass |
| `my-day-checks`, `nav-smoke`, `shell-checks` | pass |
| `a11y-states`: keyboard and focus, axe (WCAG 2.1 A/AA, serious/critical) on 17 pages x desktop/phone x dark/light | pass |
| `phone-fit` (360 and 390 px, dark and light): no sideways scroll, no clipped bottom bar, nothing under it | pass |
| `contrast-audit`: every text node on 220 page states, dark and light, CEO desktop, CEO phone, employee desktop, manager desktop | 0 failures |
| `rollout-checks` (new): rows and cards open their record from the empty part (enquiries, board, follow-ups, items, requests, movements, employees, policies, phone cards), controls inside a row act alone, Ctrl-click opens a new tab, status tones, back links keep filters and place, stacked-table labels, no-access and not-found cards | pass |
| `page-survey` (new): every page loads (status 200, no console errors, no sideways scroll) as the CEO at 1440 and 390 px, dark and light | pass |
| Database tests | not needed: no database change |

Problems the checks found and this branch fixes: the light-theme teal/green badge words were too pale; a focus ring faded in over 150 ms instead of being visible at once; a dialog opened from the Projects header read dark text on a dark card in light mode; "No job title set" was 4.46:1 (needs 4.5); a sideways overflow on the enquiry page at 1440 px; the list place was not always restored after a back link; the top-bar title ran under the search button on a phone. Two existing check scripts held a stale fixed date or looked for a filter that now sits under "More filters"; both were updated.

## What this round does not do

- **No new data, widgets or features.** Where a screen has nothing to open (My equipment rows, "Equipment held by employees", report tables), rows are not made clickable.
- **Filters that are date or period forms** (Attendance date, Sales reports period, Audit log, Leave status) keep their Apply button: they are forms, not live filters.
- **Dialogs** keep the plain card surface (a layered surface read badly inside the dark header in light mode).
- **Not exercised here:** the outage state (a data service that does not answer; needs a stop/start command), real phone camera scanning for Inventory labels (simulated camera only, as before), hosted Supabase Auth/Storage, Vercel cron and Microsoft 365 delivery. `inventory-a11y.mjs` (which stops PostgREST) was not re-run in this pass.
- **My equipment with items** was proven by the Inventory employee flow (issue, list, return); the screenshot shows the empty state because the screenshot data has nothing assigned.
- **Production deployment of Stage 3 (#47)** could not be confirmed from the development environment (no Vercel access); CI on `main` after the merge was green.
