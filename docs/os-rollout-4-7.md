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
(filled in as each stage is implemented; see the bottom of this file)
