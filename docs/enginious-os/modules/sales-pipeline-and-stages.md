# Sales: Pipeline and stage changes (board, Move stage, gates, hold, resume, reopen)

Status: written from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run.** Conventions as in `../README.md`; `Unverified` marks what code reading could not confirm. The database function is the real gate: the screen only offers what the function would allow. Won and Lost forms, evidence and handover are in [`sales-close-and-handover.md`](./sales-close-and-handover.md); the enquiry list and page in [`sales-enquiries.md`](./sales-enquiries.md); catalogue entries in [`sales-action-catalogue.md`](./sales-action-catalogue.md).

## 1. The stage model

Stages (ids stored in the database; labels are display text): `new` New enquiry, `qualified` Qualified, `proposal_prep` Proposal preparation, `proposal_sent` Proposal sent, `quote_sent` Quote sent, `negotiation` Negotiation, `on_hold` On hold, `won` Won, `lost` Lost (`CRM_STAGES`, `packages/domain/src/crmStages.ts`; database check on `crm_opportunities.stage` in `20261115000100_crm_core_tables.sql`; function `crm_stage_index` in `20261115000200_crm_workflow_functions.sql`).

* Working (active) stages: the first six, in that order (`CRM_PIPELINE_STAGES`, `isCrmActive`). An active enquiry must always have an open follow-up (section 5).
* On hold is open but not active; Won and Lost are closed.
* Plain move (`crm_move_stage`): one step back or any step forward among the six working stages (`crmAllowedMoves`). Same stage, or more than one step back: "That stage move is not allowed (only one step back or any step forward)". A closed enquiry: "A closed opportunity cannot change stage". On hold: "Resume the opportunity before moving it". Moving to On hold, Won or Lost this way: "Use the Hold, Won or Lost action for that change".
* Who may move, hold, resume, close: the enquiry's owner or a Sales founder of that company (`crm_require_owner_or_founder`; UI mirror `canEditOpportunity`). Everyone else with a grant sees "Only the owner (X) or a founder can ... You can add notes, files and follow-ups."
* Every move bumps `version`, sets `stage_changed_at` and logs a `crm_opportunity_events` row (`stage_changed`, `held`, `resumed`, `won`, `lost`, `reopened`).

## 2. Board and list

### 2.1 Where the pipeline lives now

There is no separate pipeline page: `/sales/pipeline` redirects (307) to `/sales/opportunities?view=board` and keeps a `company` id if it is a valid UUID (`apps/web/src/app/(app)/sales/pipeline/page.tsx`). The old Sales overview also went: `/sales` redirects to `/sales/follow-ups` (`sales/page.tsx`). Details: [`sales-coverage-index.md`](./sales-coverage-index.md) section 3.

### 2.2 Board (`/sales/opportunities?view=board`, `enquiry-board.tsx`, `components/workspace/board.tsx`)

| Control | What it does | Who | Success / failure | Behind it | Catalogue |
|---|---|---|---|---|---|
| Lanes | Nine lanes in this order: New enquiry, Qualified, Proposal preparation, Proposal sent, Quote sent, Negotiation, On hold, Won, Lost. Lane header shows the count and, for open lanes, the per-currency value total ("No value yet" when none; never added across currencies); Won and Lost lanes say "Entered through its form". The board shows the open pipeline totals from the filtered rows (`openPipelineByStage`). An unknown stage is shown in the first lane | Any Sales grant | Filters are the list's (search, owner, show, company); the stage filter is not offered on the board. There is no row cap on the board other than the 2000 loaded | `boardColumns`, `boardColumnFor`, `BoardView` (`opportunities/page.tsx`) | |
| Card | Title (opens the side panel), "Agency for Client", Owner, next action and due text, or "No next action planned" (amber) for an open enquiry without one, or "Closed" | same | | `BoardView` | |
| Drag a card / "Move to..." select on each card | A request, never a direct write. Plain stage change calls `moveStage`; On hold, Resume, Won and Lost open their normal dialogs first (section 3); keyboard and phone use the select | Owner or founder get move targets; others get none and a note ("Only the owner (X) or a founder can move this."); closed cards get "Closed. A founder can reopen it from its details." | A refused move leaves the card in its lane and shows the database's sentence | `boardMoveKind`, `boardMoveTargets` (`lib/crm/enquiry-list.ts`) | `sales.enquiry.move_stage` (and hold / resume / won / lost) |
| Move targets offered | From a working stage: one step back, every step forward, On hold, Won, Lost. From On hold: the stage it came from (`stage_before_hold`) and Lost. Won and Lost: none (reopening is a separate action, not a drag) | | | `boardMoveTargets` | `apps/web/src/lib/crm/enquiry-list.test.ts` |
| No pre-check of the gates on the board | The full-page Move dialog says up front what a gate needs (section 4); a board drop into Proposal sent or Quote sent without the prerequisite is sent anyway and the database refuses with the same sentence | | | `moveStage` | |

List and board share the same data; the table's Stage column and Stage filter are in [`sales-enquiries.md`](./sales-enquiries.md) section 2.

## 3. Stage actions

### 3.1 Move stage (dialog, `stage-actions.tsx` `MoveStageDialog`; side panel "Move to another stage")

| Control | What it does | Who | Success / failure | Behind it |
|---|---|---|---|---|
| Move to (select) | Only the moves the database allows from this stage (`crmAllowedMoves`). A move whose gate is not met is listed but marked, and the submit button is disabled | Owner or founder | | `MoveStageButton` |
| Requirement notice | Under the select: "Record a proposal as sent first (Proposals & files tab)." for Proposal sent; "Record the Zoho Books quote reference first (Commercial tab)." for Quote sent | | | `stageMoveRequirement` (`opportunities/[id]/helpers.ts`), computed from `crm_proposals.status in (sent, accepted)` and `crm_zoho_references.quote_ref` |
| Move stage (submit) | `moveStage(id, to, version)` -> `crm_move_stage` | | Stale version: reload message; refusals in words | `apps/web/src/lib/actions/crm.ts:moveStage`, `crm_move_stage` |

Catalogue: `sales.enquiry.move_stage`.

### 3.2 The two gates (in `crm_move_stage`)

| Move to | The database requires | Refusal sentence | Unlocked by |
|---|---|---|---|
| Proposal sent (`proposal_sent`) | At least one `crm_proposals` row of this enquiry with status `sent` or `accepted` ("Sent is not approved, and 'sent' must be a recorded fact") | "Record a proposal as sent before moving to Proposal sent" | A note-and-file proposal recorded as sent (`sales.proposal.record_sent`). **An estimate cannot unlock it**: the estimate-only guard (trigger `crm_proposals_estimate_sent_guard`, `20261221000100_crm_estimates_only_guards.sql`) refuses `sent` on an estimate row, and the app refuses first (`setProposalStatus`) |
| Quote sent (`quote_sent`) | A `crm_zoho_references` row with a non-blank `quote_ref` | "Record the Zoho Books quote reference before moving to Quote sent" | Saving the Zoho references (`sales.zoho.save_references`); see [`sales-proposals-and-zoho.md`](./sales-proposals-and-zoho.md) |

Observations: the gates are checked only at the moment of the move. Clearing the Zoho quote reference later, or superseding the sent proposal, does not move the stage back (no trigger does). **Update 2026-11-08 (migration `20261222000100`, not applied on hosted):** the Zoho references are now saved as a field-level merge (an untouched field is never cleared, a Lost enquiry's references are read-only) and `superseded` is refused for an accepted or already superseded proposal; **whether the quote reference may be emptied once the stage is Quote sent or later is still undefined and not enforced** (decision needed: `../../sales-crm-write-rules-deployment.md`). Starting statuses for superseding: see `sales-proposals-and-zoho.md` section 1. Moving back a step is allowed (one step).

### 3.3 Put on hold (`HoldDialog`)

Reason choices (`CRM_HOLD_REASONS`): Client postponed event, Waiting for venue confirmation, Waiting for client budget approval, Internal capacity, Other (note required). A note is optional except for Other. The submitted reason is composed as `Choice` or `Choice: note` (or `Other: note`) (`composeReason`, `helpers.ts`). Review date: required, today or later (Dubai) (`crm_hold_opportunity`: "Choose a review date that is today or later"). Allowed from a working stage only ("Only an open opportunity can be put on hold"). Sets `stage = on_hold`, `stage_before_hold`, `hold_reason`, `hold_review_date`; logs `held`. Catalogue `sales.enquiry.hold`. A hold whose review date has arrived creates a reminder (section 5 of `sales-followups.md`).

### 3.4 Resume (`ResumeDialog`)

Needs a next action (title, date not before today, time Dubai default 10:00, type Call, Email, Meeting, Proposal work or Other). `crm_resume_opportunity`: only from On hold; goes back to `stage_before_hold`; clears the hold fields; inserts the new open follow-up for the owner; logs `resumed`. Owner or founder. Catalogue `sales.enquiry.resume`.

### 3.5 Reopen a Won or Lost enquiry (`reopen-dialog.tsx`)

| Control | What it does | Who | Failure | Behind it |
|---|---|---|---|---|
| Reopen (header button or panel menu) | Dialog: Why is it being reopened (required, kept with the name), Reopen into stage (the six working stages; default is the stage it was closed from, else Negotiation), next action (what, date, time, type: required) | A person holding `reopen_closed` for the company (founder implies it). **The owner as such cannot** | "Only a founder, or someone a founder gave the reopen right to, can reopen a closed opportunity"; "Only a Won or Lost opportunity can be reopened"; reason and next action required; a reopen into anything but a working stage is refused | `reopenOpportunity` (`crm.ts`) -> `crm_reopen_opportunity` |

What it changes: the open `crm_closures` row gets `reopened_at`, `reopened_by`, `reopen_reason`; the enquiry returns to the chosen stage with the evidence and lost reason cleared from the live row (they stay in `crm_closures`); a new open follow-up is created; event `reopened`. If the previous owner has lost Sales access the reopening person becomes the owner (event `owner_changed`). A handover already prepared is left exactly as it was and the page says so (`HANDOVER_REOPENED_NOTICE`, `closure-helpers.ts`). Catalogue `sales.enquiry.reopen`.

## 4. Won and Lost

Entered only through their forms (never a drag, never `crm_move_stage`): [`sales-close-and-handover.md`](./sales-close-and-handover.md). Won needs evidence and a confirmed value and is allowed only from a working stage; Lost needs a reason and is allowed from any open stage including On hold.

## 5. What blocks a move (all refusals in one place)

| Situation | Refused by | Message (from the function) |
|---|---|---|
| Not owner or founder | `crm_require_owner_or_founder` | "Only the owner of this opportunity or a founder can do this" |
| Someone else changed it first | `crm_check_version` / `staleMessage` | "This opportunity was changed by someone else. Reload and try again." |
| Closed, held, or illegal step | `crm_move_stage` | see section 1 |
| Proposal sent or Quote sent gate not met | `crm_move_stage` | section 3.2 |
| Hold without reason or with a past review date | `crm_hold_opportunity` | "A reason is required..." / "Choose a review date that is today or later" |
| Resume without a next action | `crm_resume_opportunity` | "Resuming needs a next action with a due date" |
| Completing or cancelling the only open follow-up of an active enquiry | `crm_complete_follow_up`, `crm_cancel_follow_up` | "Add a next action or put the opportunity on hold before completing the last follow-up" / "This is the only next action..." (see `sales-followups.md`) |
| Won without evidence or value, or from On hold | `crm_mark_won` | `sales-close-and-handover.md` |

Error text for the user passes through `friendlyCrmError` (`apps/web/src/lib/crm/errors.ts`). Calls to the database have a timeout (`RPC_TIMEOUT_MS`, referenced in `crm.ts`; the exact value was not read: `Unverified`).

## 6. Tests

`apps/web/src/lib/crm/enquiry-list.test.ts` (board move targets and kinds), `apps/web/src/lib/actions/crm.test.ts`, `packages/domain` stage helpers, RLS contract `packages/rls-tests/test/crm.rls.test.ts`, `crm-estimates-only-guards.rls.test.ts` (the estimate cannot be recorded as sent). Not run in this pass; the exact assertions were not re-read (`Unverified`).
