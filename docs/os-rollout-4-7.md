# ENGINIOUS OS rollout, Stages 4-7 (one integration branch)

Presentation and usability pass only. No database change, no new data, no new business feature. Row-level security, permissions, company
boundaries, URLs, validation, workflows and audit evidence are untouched. Progress is reported with the stage numbers of the rollout
(1 design system, 2 Projects & Tasks, 3 My Day were merged earlier: PRs #45, #46, #47).

## Progress

| Stage | Scope | Status |
| --- | --- | --- |
| 4 | Sales & CRM | In progress |
| 5 | Inventory and My Equipment | Not started |
| 6 | Remaining People & HR, attendance, recovery, approvals, policies, settings, account | Not started |
| 7 | Whole-app consistency, regression checks, final review | Not started |

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
