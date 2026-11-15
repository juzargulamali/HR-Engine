# Sales: Pipeline and stage changes (board, Move stage, gates, hold, resume, reopen)

Status: written from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run.** Conventions as in `../README.md`; `Unverified` marks what code reading could not confirm. The database function is the real gate: the screen only offers what the function would allow. Won and Lost forms, evidence and handover are in [`sales-close-and-handover.md`](./sales-close-and-handover.md); the enquiry list and page in [`sales-enquiries.md`](./sales-enquiries.md); catalogue entries in [`sales-action-catalogue.md`](./sales-action-catalogue.md).

**Current rule (2026-11-15, draft branch `claude/pr1-quotation-revisions-estimate-stage` from `main` `0dffeba`: not merged, CI not yet run, hosted SQL not applied, Production not deployed): "Estimate sent" is NOT a pipeline stage any more.** Recording an estimate as sent stays (Estimates tab) and never moves the enquiry. Sections 1, 2.2, 3.1, 3.2 and 3.5 below are rewritten for it and were re-read against the code; **section 8 is the inventory of every use of the stage and what became of it, the mapping of existing enquiries and the rollout order.** Migration `20270111000100_crm_retire_estimate_sent_stage.sql` (owner pack `crm_retire_estimate_sent_*`, install-order row 39). Verified locally only (RLS test and browser flow named in section 8.5).

**History (kept as written, no longer the current rule): the Estimate sent stage (2026-11-11, branch `claude/events-first-edition-calendar`, PR #79 not merged at the time of writing; migration `20261228000100_crm_estimate_sent_stage.sql`, **not applied by Claude, hosted status `Unverified`**).** Sections 1, 2.2, 3.1 and 3.2 below are rewritten for it and were re-read against the code; the other sections were not. **Hosted (owner-reported 2026-11-11):** the migration is applied and verified by the owner; the stage has not yet been exercised signed-in by anyone. On a database without the migration, the app lists the stage but the database refuses it: a move to Estimate sent answers "One of the values is not allowed", and Record estimate as sent is not offered (the Estimates tab finds no record table) or answers "not available yet".

## 1. The stage model

Stages a person can put an enquiry in (ids stored in the database; labels are display text): `new` New enquiry, `qualified` Qualified, `proposal_prep` Proposal preparation, `proposal_sent` Proposal sent, `quote_sent` Quote sent, `negotiation` Negotiation, `on_hold` On hold, `won` Won, `lost` Lost (`CRM_STAGES`, `packages/domain/src/crmStages.ts`). **`estimate_sent` is a retired stage** (`CRM_RETIRED_STAGES`, label "Estimate sent (stage no longer used)"): the id is still valid in the database (the three checks on `crm_opportunities.stage`, `stage_before_hold` and `stage_before_close` still accept it, `20261228000100`; `crm_stage_index` still gives it 4) because history lines mention it and an enquiry whose earlier stage could not be worked out may still hold it (section 8.3), but nobody can be moved into it (`crm_move_stage`, `crm_reopen_opportunity`, `20270111000100`).

* Working (active) stages: the first six, in that order (`CRM_PIPELINE_STAGES`). `isCrmActive` is also true for an enquiry still holding `estimate_sent`, so it keeps needing a next action; `CRM_WORKING_STAGE_IDS` (the six plus the retired id) is what reads use so such an enquiry is never left out. An active enquiry must always have an open follow-up (section 5).
* Steps (`crmStageStep`, `crm_stage_index`): New 1, Qualified 2, Proposal preparation 3, Proposal sent 4, Quote sent 5, Negotiation 6. The retired Estimate sent keeps step 4, only so that an enquiry still holding it can be moved out by the ordinary rule.
* **Sending an estimate is a recorded fact, not a stage**: `crm_estimate_sends` (the exact revision, the date it was sent, who recorded it and when), written by Record estimate as sent ([`sales-estimates-and-quotations.md`](./sales-estimates-and-quotations.md) section 2.1). It moves nothing and is evidence for neither Proposal sent nor Quote sent (section 3.2).
* On hold is open but not active; Won and Lost are closed.
* Plain move (`crm_move_stage`): one step back or any step forward among the six working stages (`crmAllowedMoves`). From the retired Estimate sent: Proposal preparation, Proposal sent, Quote sent or Negotiation (each with its own gate). **To Estimate sent: refused, "Estimate sent is no longer a pipeline stage. Record the estimate as sent on the Estimates tab; the stage of the enquiry stays as it is".** Same stage, or more than one step back: "That stage move is not allowed (only one step back or any step forward)". A closed enquiry: "A closed opportunity cannot change stage". On hold: "Resume the opportunity before moving it". Moving to On hold, Won or Lost this way: "Use the Hold, Won or Lost action for that change".
* Who may move, hold, resume, close: the enquiry's owner or a Sales founder of that company (`crm_require_owner_or_founder`; UI mirror `canEditOpportunity`). Everyone else with a grant sees "Only the owner (X) or a founder can ... You can add notes, files and follow-ups."
* Every move bumps `version`, sets `stage_changed_at` and logs a `crm_opportunity_events` row (`stage_changed`, `held`, `resumed`, `won`, `lost`, `reopened`).

## 2. Board and list

### 2.1 Where the pipeline lives now

There is no separate pipeline page: `/sales/pipeline` redirects (307) to `/sales/opportunities?view=board` and keeps a `company` id if it is a valid UUID (`apps/web/src/app/(app)/sales/pipeline/page.tsx`). The old Sales overview also went: `/sales` redirects to `/sales/follow-ups` (`sales/page.tsx`). Details: [`sales-coverage-index.md`](./sales-coverage-index.md) section 3.

### 2.2 Board (`/sales/opportunities?view=board`, `enquiry-board.tsx`, `components/workspace/board.tsx`)

| Control | What it does | Who | Success / failure | Behind it | Catalogue |
|---|---|---|---|---|---|
| Lanes | Nine lanes in this order: New enquiry, Qualified, Proposal preparation, Proposal sent, Quote sent, Negotiation, On hold, Won, Lost. **A tenth lane, "Estimate sent (stage no longer used)", appears after Proposal sent only while a matching enquiry still holds the retired stage** (`boardColumns(presentStages)`), so such an enquiry is shown where it is; nothing can be dropped into it. Lane header shows the count and, for open lanes, the per-currency value total ("No value yet" when none; never added across currencies); Won and Lost lanes say "Entered through its form". The board shows the open pipeline totals from the filtered rows (`openPipelineByStage`). An unknown stage is shown in the first lane | Any Sales grant | Filters are the list's (search, owner, show, company); the stage filter is not offered on the board. There is no row cap on the board other than the 2000 loaded | `boardColumns`, `boardColumnFor`, `BoardView` (`opportunities/page.tsx`) | |
| Card | Title (opens the side panel), "Agency for Client", Owner, next action and due text, or "No next action planned" (amber) for an open enquiry without one, or "Closed" | same | | `BoardView` | |
| Drag a card / "Move to..." select on each card | A request, never a direct write. Plain stage change calls `moveStage`; On hold, Resume, Won and Lost open their normal dialogs first (section 3); keyboard and phone use the select | Owner or founder get move targets; others get none and a note ("Only the owner (X) or a founder can move this."); closed cards get "Closed. A founder can reopen it from its details." | A refused move leaves the card in its lane and shows the database's sentence | `boardMoveKind`, `boardMoveTargets` (`lib/crm/enquiry-list.ts`) | `sales.enquiry.move_stage` (and hold / resume / won / lost) |
| Move targets offered | From a working stage: one step back, every step forward, On hold, Won, Lost; never Estimate sent. A card still at the retired stage is offered Proposal preparation, Proposal sent, Quote sent, Negotiation, On hold, Won, Lost. From On hold: the stage it came from (`stage_before_hold`) and Lost; when it came from the retired stage, only Lost is offered on the board (Resume on the enquiry's own page returns it there, and a person then moves it). Won and Lost: none (reopening is a separate action, not a drag) | | | `boardMoveTargets` | `apps/web/src/lib/crm/enquiry-list.test.ts` |
| Check of the two gates before a board move (2026-11-14, PR #96; **two gates since 2026-11-15**: the Estimate sent gate went with the stage) | A drop, or "Move to", into Proposal sent or Quote sent is first checked against the same rule as the Move stage dialog (`stageMoveRequirement`, `opportunities/[id]/helpers.ts`). When the proposal recorded as sent or the Zoho Books quote reference is missing, nothing is sent: the card stays in its lane with the same sentence as the dialog, then "Not moved to <stage>." and a link to the tab where it is recorded (Proposals & files or Commercial). The facts are read only for cards the person may move (`loadStageEvidence`: `crm_proposals` with status sent or accepted, `crm_zoho_references.quote_ref`; `crm_estimate_sends` is no longer read here). If they cannot be read, nothing is assumed: the move is sent and the database answers as before. The check only answers sooner; **it never allows a move the database refuses**. Browser behaviour `Unverified (local browser pass in progress)` | Owner or founder | A refusal by the database still leaves the card where it was with the reason | `boardMoveCheck` (`lib/crm/enquiry-list.ts`), `loadStageEvidence` (`lib/crm/enquiry-list-data.ts`), `EnquiryBoard` -> `moveStage` | `sales/opportunities/enquiry-board.test.tsx`, `lib/crm/enquiry-list.test.ts` |

List and board share the same data; the table's Stage column and Stage filter are in [`sales-enquiries.md`](./sales-enquiries.md) section 2.

## 3. Stage actions

### 3.1 Move stage (dialog, `stage-actions.tsx` `MoveStageDialog`; side panel "Move to another stage")

| Control | What it does | Who | Success / failure | Behind it |
|---|---|---|---|---|
| Move to (select) | Only the moves the database allows from this stage (`crmAllowedMoves`). A move whose gate is not met is listed but marked, and the submit button is disabled | Owner or founder | | `MoveStageButton` |
| Requirement notice | Under the select: "Record a proposal as sent first (Proposals & files tab)." for Proposal sent; "Record the Zoho Books quote reference first (Commercial tab)." for Quote sent. Estimate sent is not in the list. If the proposals or the Zoho references could not be read, no move is offered and the page says why (a failed read of the estimate-sent records no longer withholds the moves: they gate no stage) | | | `stageMoveRequirement` (`opportunities/[id]/helpers.ts`), computed from `crm_proposals.status in (sent, accepted)` and `crm_zoho_references.quote_ref` |
| Move stage (submit) | `moveStage(id, to, version)` -> `crm_move_stage` | | Stale version: reload message; refusals in words | `apps/web/src/lib/actions/crm.ts:moveStage`, `crm_move_stage` |

Catalogue: `sales.enquiry.move_stage`.

### 3.2 The two gates (in `crm_move_stage`)

| Move to | The database requires | Refusal sentence | Unlocked by |
|---|---|---|---|
| Proposal sent (`proposal_sent`) | At least one `crm_proposals` row of this enquiry with status `sent` or `accepted` ("Sent is not approved, and 'sent' must be a recorded fact") | "Record a proposal as sent before moving to Proposal sent" | A note-and-file proposal recorded as sent (`sales.proposal.record_sent`). **An estimate cannot unlock it**: the estimate-only guard (trigger `crm_proposals_estimate_sent_guard`, `20261221000100_crm_estimates_only_guards.sql`) refuses `sent` on an estimate row, and the app refuses first (`setProposalStatus`) |
| ~~Estimate sent (`estimate_sent`)~~ (retired) | Nothing unlocks it: the move is refused for everyone | "Estimate sent is no longer a pipeline stage. Record the estimate as sent on the Estimates tab; the stage of the enquiry stays as it is" | Not a target. **An estimate recorded as sent (`crm_estimate_sends`) unlocks neither Proposal sent nor Quote sent**: it is not a sent proposal and not the Zoho Books quote reference (`crm-retire-estimate-sent.rls.test.ts` "unlocks neither") |
| Quote sent (`quote_sent`) | A `crm_zoho_references` row with a non-blank `quote_ref` | "Record the Zoho Books quote reference before moving to Quote sent" | Saving the Zoho references (`sales.zoho.save_references`); see [`sales-proposals-and-zoho.md`](./sales-proposals-and-zoho.md) |

Observations: the gates are checked only at the moment of the move. Superseding the sent proposal does not move the stage back (no trigger does). **Update 2026-11-08 (migration `20261222000100`, applied on hosted V2 per the owner (owner-run verification, owner-reported 2026-11-09)):** the Zoho references are now saved as a field-level merge (an untouched field is never cleared, a Lost enquiry's references are read-only) and `superseded` is refused for an accepted or already superseded proposal; **decision B (owner): the quote reference can no longer be emptied once the stage is Quote sent, Negotiation or Won (or on hold from the first two); it can be corrected to another value** (`../../sales-crm-write-rules-deployment.md`). The Quote sent gate itself is unchanged; one step back to Proposal sent is still allowed and the reference may then be cleared there (the gate asks for one again before Quote sent). Starting statuses for superseding: see `sales-proposals-and-zoho.md` section 1. Moving back a step is allowed (one step).

### 3.3 Put on hold (`HoldDialog`)

Reason choices (`CRM_HOLD_REASONS`): Client postponed event, Waiting for venue confirmation, Waiting for client budget approval, Internal capacity, Other (note required). A note is optional except for Other. The submitted reason is composed as `Choice` or `Choice: note` (or `Other: note`) (`composeReason`, `helpers.ts`). Review date: required, today or later (Dubai) (`crm_hold_opportunity`: "Choose a review date that is today or later"). Allowed from a working stage only ("Only an open opportunity can be put on hold"). Sets `stage = on_hold`, `stage_before_hold`, `hold_reason`, `hold_review_date`; logs `held`. Catalogue `sales.enquiry.hold`. A hold whose review date has arrived creates a reminder (section 5 of `sales-followups.md`).

### 3.4 Resume (`ResumeDialog`)

Needs a next action (title, date not before today, time Dubai default 10:00, type Call, Email, Meeting, Proposal work or Other). `crm_resume_opportunity`: only from On hold; goes back to `stage_before_hold`; clears the hold fields; inserts the new open follow-up for the owner; logs `resumed`. Owner or founder. Catalogue `sales.enquiry.resume`.

### 3.5 Reopen a Won or Lost enquiry (`reopen-dialog.tsx`)

| Control | What it does | Who | Failure | Behind it |
|---|---|---|---|---|
| Reopen (header button or panel menu) | Dialog: Why is it being reopened (required, kept with the name), Reopen into stage (the six working stages; default is the stage it was closed from, else Negotiation; **an enquiry closed from the retired Estimate sent is offered Proposal preparation, marked "suggested; it was closed from Estimate sent, which is no longer a stage"**, `reopenStageOptions`, `closure-helpers.ts`; the database refuses a reopen into Estimate sent, asked for or by default: "Estimate sent is no longer a pipeline stage. Choose the stage to reopen into"), next action (what, date, time, type: required) | A person holding `reopen_closed` for the company (founder implies it). **The owner as such cannot** | "Only a founder, or someone a founder gave the reopen right to, can reopen a closed opportunity"; "Only a Won or Lost opportunity can be reopened"; reason and next action required; a reopen into anything but a working stage is refused | `reopenOpportunity` (`crm.ts`) -> `crm_reopen_opportunity` |

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

## 7. Sales & CRM upgrade (2026-11-14; draft PR #96, not merged; code read at `d016c28`)

Status, four facts kept apart: merged: no (draft PR #96). Required CI: has not run on a head. Hosted database: no migration and no SQL in this change. Production: not deployed. Unit tests: the full web suite passed locally at `d016c28` (356 files, 4,006 tests; reported by the builders, not re-run by the documentation author). Written from the code; how a screen looks or behaves in a browser is `Unverified (local browser pass in progress)`.

Only these points of this file were re-checked; the rest keeps its stamp.

* **Board** (section 2.2): the row "Check of the three gates before a board move" replaces the old row "No pre-check of the gates on the board". Cards now show the next action and its due time through the same `NextAction` piece as the list (`sales/opportunities/page.tsx`).
* **Move stage from the enquiry page** (section 3.1): the dialog and its rules are unchanged. It is now opened from the summary's **More** menu ("Move to another stage") or from the main button when the record is ahead of the stage ("Move to Proposal sent", "Move to Quote sent"; the dialog then lists that stage first). When the proposals, the Zoho references or the estimates recorded as sent could not be loaded, the menu item is shown switched off with "Not offered: the proposals or Zoho references could not be loaded." (`stageMoves`, `opportunities/[id]/summary-props.ts`; `primaryAction`, `primary-action.ts`). Estimate sent is never proposed by the main button: recording an estimate as sent offers that move in its own form.
* **Hold, Resume, Close, Reopen**: same dialogs, now under **More** ("Put on hold", "Resume", "Close as won", "Close as lost", "Reopen"); Resume is the main button of an enquiry on hold for its owner or a founder (`summary-actions.tsx`).
* **Reviewed, not changed (open owner decision 13 in `../05-data-tests-and-release-ledger.md` section D):** whether Estimate sent stays a lane of its own or is merged with Proposal sent into one "sent" step.

## 8. Estimate sent retired as a stage (2026-11-15; draft branch `claude/pr1-quotation-revisions-estimate-stage` from `main` `0dffeba`: not merged, CI not yet run, hosted SQL not applied, Production not deployed)

Owner instruction (relayed in the task brief of 2026-11-15; it closes open decision 13 of `../05-data-tests-and-release-ledger.md` section D): keep **Record as sent** in Estimates, recording the exact estimate version and when it was sent; remove `estimate_sent` as a stage people can be in or move to.

### 8.1 Inventory: every use of the stage, and what became of it

Found with `grep -rn "estimate_sent\|Estimate sent"` over `apps`, `packages`, `supabase` and `docs` at `0dffeba`, then each place read.

| Where | What it did | Now | Source |
|---|---|---|---|
| `packages/domain/src/crmStages.ts` `CRM_STAGE_IDS`, `CrmStageId` | The id, typed | Kept (rows and history hold it) | same file |
| `CRM_STAGES` (labels, filter lists) | Listed "Estimate sent" | Removed from the list; `CRM_RETIRED_STAGES` holds it with the label "Estimate sent (stage no longer used)"; `crmStageLabel` reads both | same file; `test/crmStages.test.ts` |
| `CRM_PIPELINE_STAGES` (lanes, move targets, reopen choices, report rows, JARVIS lookups) | Seven stages | Six. `CRM_WORKING_STAGE_IDS` (six plus the retired id) is used where rows are READ | same file |
| `STAGE_STEP`, `crmStageStep`, `crmAllowedMoves`, `isCrmActive` | Step 4 beside Proposal sent; a target | Step 4 kept for moving OUT; never a target; an enquiry holding it is still active | same file |
| `canAdvanceToEstimateSent` | Whether the record form offers the move | Deleted | same file |
| `crm_stage_index` (SQL) | 4 | Unchanged (hold, resume, close, reminders and the one-open-follow-up rule keep treating an unmoved enquiry as working) | `20261228000100` |
| The three stage checks on `crm_opportunities` | Accept `estimate_sent` | Unchanged: unmoved rows hold it, `stage_before_close` of closed rows keeps it as history, and the rollback needs it | `20261228000100`; verify row 6 |
| `crm_move_stage` | Allowed the move with an estimate recorded as sent; allowed Proposal sent and Estimate sent across | Refuses a move TO it; the evidence gate is removed; moves FROM it as any step-4 stage | `20270111000100` section 2 |
| `crm_record_estimate_sent` (its optional stage move) | With `p_move = true`, moved the enquiry (refused backwards or on hold) | Same signature; records the send; **`p_move` is accepted and ignored**; returns `moved: false` and the unchanged stage and version | `20270111000100` section 3 |
| `crm_reopen_opportunity` (reopen-into-stage) | Any working stage, Estimate sent included | Refuses Estimate sent, asked for or as the default | `20270111000100` section 4 |
| `crm_resume_opportunity` | Returns to `stage_before_hold` | Unchanged. An on-hold enquiry whose return stage is still Estimate sent (ambiguous, or held from it later) resumes into it and is then moved by a person | `20261115000200` |
| `crm_enquiry_list` (stage sort order; no-next-action list) | Lists `estimate_sent` in both | Unchanged (an unmoved enquiry still sorts and still counts as needing a next action) | `20261229000100` lines 57, 69 |
| `crm_generate_reminders` | Covers every stage with a `crm_stage_index` | Unchanged | `20261228000100` |
| `jarvis_change_stage` | Refuses a move to or from Estimate sent | Unchanged; the words JARVIS shows were updated (`ESTIMATE_SENT_NOT_THROUGH_JARVIS`, `lib/jarvis/sales/stage-transitions.ts`) | `20261228000100`; `jarvis.md` |
| Board: `BOARD_COLUMN_IDS`, `boardColumns`, `boardColumnFor`, `BOARD_TONE`, `boardMoveTargets` | A lane and a target | No lane unless an enquiry holds it (then its own lane, never a target) | `lib/crm/enquiry-list.ts`, `opportunities/page.tsx` |
| Board: `boardMoveCheck`, `loadStageEvidence`, `StageEvidence.hasSentEstimate`, `EVIDENCE_PLACE` | Third gate | Removed (two gates) | `lib/crm/enquiry-list.ts`, `lib/crm/enquiry-list-data.ts` |
| Table Stage filter (`opportunities/page.tsx`) | Listed it | Not listed; `?stage=estimate_sent` still filters (Reports links to it) and the option appears only while chosen | same file |
| Move stage dialog and panel menu (`stageMoves`, `buildEnquiryActions`, `stageMoveRequirement`) | Offered it with its requirement | Not offered | `summary-props.ts`, `_panel/actions-props.ts`, `helpers.ts` |
| Enquiry guide (`lib/crm/enquiry-guide.ts`), `primary-action.ts` | "Estimate sent: awaiting the client" | For an enquiry still holding it: "Move this enquiry to a current stage" with why and how; the main button never proposes it | same files |
| `estimate-sent-form.tsx`, `quotations-panel.tsx`, `recordEstimateSent` (`lib/actions/crm.ts`) | Tick box "Move the enquiry to Estimate sent" | No box; a line says the stage stays; `p_move` is always sent as `false`; the row shows the sent date, when it was recorded and by whom | same files |
| Reopen dialog (`closure-helpers.ts`, `reopenSchema`) | Seven choices | Six; suggestion for an enquiry closed from it | same files |
| Reports (`lib/crm/reports.ts` `openPipelineByStage`) | A row beside Proposal sent | A row only while an open enquiry holds it (so the rows add up) | same file |
| My Day and Operations stage labels (`components/sales/badges.tsx`, `lib/operations/model.ts` `STAGE_WORDS`) | "Estimate sent" | The badge reads the domain label; Operations says "Estimate sent (stage no longer used)" | same files |
| History and timeline labels (`describeEvent`, `describeHistoryEvent`) | "Stage changed from X to Estimate sent." | Old lines stay and read "... to Estimate sent (stage no longer used)."; the system line of the migration carries its reason | `opportunities/[id]/helpers.ts` |
| Accounts "awaiting reply" (`lib/crm/clients-agencies/account.ts` `OPEN_STAGES_FOR_REPLY`), JARVIS lookups (`lib/jarvis/sales/lookup.ts`, `query-parse.ts`) | Included it | Still included for reading (`CRM_WORKING_STAGE_IDS`); "enquiries at Estimate sent" still finds the ones left there | same files |
| Staff guidance, JARVIS knowledge | Described the stage | Rewritten ([`../staff-guidance/sales.md`](../staff-guidance/sales.md), republished) | `guidance.test.ts` |
| Tests and browser flows | `crm-estimate-sent-stage.rls.test.ts` (tests migration `20261228000100` on its own: unchanged, still passes); web and domain unit tests | Updated; new `crm-retire-estimate-sent.rls.test.ts` and `os-shell-checks/estimate-sent-record-flow.mjs` | section 8.5 |

### 8.2 What "Record as sent" does now

Estimates tab, on a finalised revision that was not replaced, owner or founder, open enquiry. The dialog asks for the date it was sent, says "The enquiry stays at <stage>. Recording an estimate as sent does not move the enquiry", and offers no stage move. It writes one `crm_estimate_sends` row (`proposal_id` = the exact revision, `reference`, `revision`, `sent_on`, `recorded_by`, `recorded_at`) and the timeline line "Estimate <ref> revision N recorded as sent to the client on <date>". The row on the tab then shows "Sent to client <date>", "recorded <date and time> by <name>". The enquiry's stage, `stage_changed_at` and `version` are untouched.

### 8.3 Enquiries that hold the stage when the migration runs

Rule (the SAME query in the read-only preflight and in the migration; verified evidence only):

1. An ordinary proposal (a `crm_proposals` row that is not an estimate) is recorded as `sent` or `accepted` -> **Proposal sent** (the gate `crm_move_stage` itself applies).
2. Otherwise, the newest `stage_changed` line into Estimate sent says it came from New enquiry, Qualified or Proposal preparation -> **back to that stage** (none of the three needs evidence).
3. Anything else is **ambiguous and is not moved**: it came from Proposal sent but no ordinary proposal is recorded as sent now; it stepped back from Quote sent; no history line shows how it got there (for example it was reopened straight into it); its only "sent" proposal row is a quotation built in the app.

Never: an estimate recorded as sent treated as a sent proposal or as the Zoho quote reference; a move forward past a gate (nothing goes to Quote sent or Negotiation). The same rule is applied to the stage an on-hold enquiry returns to (`stage_before_hold`). `stage_before_close` of a closed enquiry is not changed (history). Each move bumps `version`, leaves `stage_changed_at`, writes a system timeline line (no actor, with the evidence) and a row in `crm_stage_retirement_moves` (owner-only table; the rollback reads it).

**An ambiguous enquiry after the rollout:** it still opens; its badge says "Estimate sent (stage no longer used)"; the summary says "Move this enquiry to a current stage" and why; it keeps needing a next action and getting reminders; it can be put on hold, closed, and moved out with Move stage or on the board by its owner or a founder (a colleague and another company cannot); it has its own board lane and Reports row while it is there. It is listed by the preflight and by the verify pack (rows 100+).

### 8.4 Rollout order and compatibility with the deployed app (`main` `0dffeba`)

Either order is safe; **recommended: deploy the app, then run the SQL.**

* New app before the SQL: nothing offers the stage or the move, `p_move` is always `false`, and an enquiry at Estimate sent is shown as above. The earlier database functions still accept the old calls, which nothing sends.
* SQL before the new app: the deployed app's Record estimate as sent still works (it calls `crm_record_estimate_sent` with `p_move = true` when its box is ticked: the send is recorded and the stage stays; the ticked box then does nothing). Choosing Estimate sent in Move stage, on the board or when reopening is refused with a sentence the deployed app shows. The deployed app renders every stage value, moved or not.
* Rollback (`crm_retire_estimate_sent_90_rollback.sql`): restores the exact earlier `crm_move_stage`, `crm_record_estimate_sent` and `crm_reopen_opportunity`, puts back only the enquiries nobody touched since the move, drops `crm_stage_retirement_moves`. Roll the app back with it (the new app shows such enquiries as "stage no longer used").

### 8.5 Verification (local only)

* RLS `packages/rls-tests/test/crm-retire-estimate-sent.rls.test.ts` (17 tests, real PostgreSQL 16): eleven enquiries put at the stage with the functions the deployed app uses, across two companies; the preflight's proposal equals what the migration did; ambiguous ones kept; no move past a gate; history hashes unchanged; second run changes nothing; `p_move = true` records and leaves the stage; refusals; owner, founder, colleague and other-company boundaries; rollback exact.
* Browser `apps/web/os-shell-checks/estimate-sent-record-flow.mjs` (isolated local stack, emp@, ceo@, mgr@): see `apps/web/os-shell-checks/README.md`.
* **Not verified:** anything hosted (the preflight was never run against hosted data: the counts and the ambiguous list are unknown until the owner runs it); a signed-in Preview or Production check; a real phone.
