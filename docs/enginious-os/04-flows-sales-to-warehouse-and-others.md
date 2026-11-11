# 04. End-to-end flows: Sales to warehouse, Inventory, HR, approvals, scheduled work

Verified at `551f615` (main). Conventions as in `README.md`: every claim cites a source; `Unverified` = not confirmed in code or a run; **Stale** = an older doc says something the code no longer does. Nothing here was run: no app, database or hosted project was touched. Hosted state is owner-reported: launch migrations 1 to 15 applied on V2; the dispatch/return notes switch is OFF (`docs/launch-refinement-install-order.md` section 5).

Roles used: **Sales** (Sales grant; the enquiry owner or a Sales founder does the closing steps), **Projects founder / assign_pm holder**, **PM** (project manager, current or acting), **Warehouse** (Inventory operator at a location), **Finance / executive approver** (Budget grants), **Employee**, **Line manager**, **HR Admin**. Who holds what is in `03-roles-access-and-approvals.md`.

---

## 1. MAIN FLOW: Sales to Projects to Inventory to Budget

### 1.0 The whole path in one diagram

```
 Enquiry (new) -> qualified -> proposal_prep -> proposal_sent | estimate_sent -> quote_sent -> negotiation
   |  (proposal_sent and estimate_sent are alternative milestones at the same step; an enquiry can reach either or both)
   |  follow-ups, availability check, proposals (files), commercial approval (if policy on)
   v
 "Confirm as won" (PO or authorised e-mail + date + value)  --crm_mark_won-->  stage 'won'
   v
 "Prepare the handover now" -> handover draft -> submit            (proj_submit_handover)
   v
 submitted --(founder / assign_pm assigns PM)--> pm_assigned --PM accepts--> accepted = PROJECT EXISTS (planning)
                                    ^                |
                                    +-- answer <-----+-- PM "asks a question" (clarification_requested)
   v
 Project work: tasks, blockers, scope changes ---------------+--> Budget (PM drafts -> submit -> Finance/executive decides)
   v                                                         |      funding -> actuals -> settlement -> close
 Equipment request (draft from handover) -> submit -> warehouse Reserve
   v
 Send out (inv_dispatch_to_project) --[switch ON]--> dispatch note <ref>-D-nnnnn --> PM acknowledges / reports difference
   v                                                                                      (non-blocking; warehouse answers)
 use on site
   v
 Receive back (inv_return_from_project) --[switch ON]--> return note <ref>-RT-nnnnn --> PM confirms / difference
   v
 Project completion (equipment is NOT auto-returned) ; settlement closes the money side
```

### 1.1 Enquiry to quote (Sales)

Per-control detail for every step of 1.1 and 1.2, with who may do it and what each action writes, is in [`modules/sales-coverage-index.md`](./modules/sales-coverage-index.md) and [`modules/sales-action-catalogue.md`](./modules/sales-action-catalogue.md); rows 1 to 11 of this section were re-checked against `main` `d4a9dc3` in the Sales & CRM app-map pass (code read only, nothing run) and the corrections are marked below.

| # | Screen -> action | Function / table | Result and notices | Source |
|---|---|---|---|---|
| 1 | `/sales/new` (or quick add): create enquiry with organisation, contact, technologies, dates, next action | `crm_create_opportunity`, `crm_create_organisation`, `crm_create_contact`, `crm_find_duplicate_candidates` (similar-enquiry warning) | `crm_opportunities` row, stage `new`, creator becomes owner; open follow-up created. Appears under Sales and, when untouched, as "Enquiry awaiting a first response" on My Day | `20261115000200_crm_workflow_functions.sql`; `lib/my-day/attention.ts` `salesCandidates` |
| 2 | Opportunity page: move stage | `crm_move_stage` (stages: `new, qualified, proposal_prep, proposal_sent, estimate_sent, quote_sent, negotiation`; **Estimate sent added 2026-11-11 by `20261228000100_crm_estimate_sent_stage.sql` (not applied by Claude): same step as Proposal sent, gated on an estimate explicitly recorded as sent, `crm_record_estimate_sent`; see `modules/sales-pipeline-and-stages.md` section 3.2**; side states `on_hold`, `won`, `lost`) | `crm_log_event` timeline row. Hold needs reason and review date; resume needs a next action. **Two gates (added in the app-map pass):** moving to `proposal_sent` needs a proposal recorded `sent` or `accepted`; moving to `quote_sent` needs a non-blank Zoho Books quote reference (`crm_move_stage`); only the owner or a Sales founder may move; one step back or any step forward. Detail: [`modules/sales-pipeline-and-stages.md`](./modules/sales-pipeline-and-stages.md) | `20261115000100_crm_core_tables.sql` (stage check) |
| 3 | Enquiry page, side panel and `/sales/follow-ups`: **log activity** (enquiry page or panel "Add update"), create follow-up (enquiry page, panel, account page), **complete, reschedule, cancel** (Follow-ups page, enquiry page, panel). The Follow-ups page itself has no log-activity or add-follow-up control (corrected in the app-map pass) | `crm_add_activity`, `crm_create_follow_up`, `crm_complete_follow_up`, `crm_reschedule_follow_up`, `crm_cancel_follow_up` | Overdue follow-up = My Day tier 0 ("overdue"), due today = tier 1 | `attention.ts` `salesCandidates` |
| 4 | Optional: "Ask the warehouse to check" availability | `crm_request_availability`, warehouse answers `crm_confirm_availability` / `inv_record_opportunity_check` | A dated check, never a reservation; shows "out of date" if dates change. Warehouse sees it in Inventory -> Requests -> "Sales checks waiting" and as a "Sales checks" row in Inventory Today (section 2) | `docs/inventory-warehouse-guide.md` section 7 |
| 5 | Proposals: add file/note, set status | `crm_add_proposal`, `crm_set_proposal_status` (`draft, sent, superseded, accepted`; sent/accepted need a sent date), `crm_upsert_zoho_reference` | Files go through quarantine bucket and validation. **Quote and invoice live in Zoho Books, outside the app**; the app stores only a reference typed by hand (no Zoho API host or `ZOHO_` setting exists anywhere in `apps`, `packages` or `supabase`; the Zoho side itself is `Unverified`). **Estimate rows built in the app are labelled "Estimate", have no Record as sent, and the database refuses `sent` for them** (`crm_proposals_estimate_sent_guard`, `20261221000100`), so an estimate cannot unlock Proposal sent: [`modules/sales-proposals-and-zoho.md`](./modules/sales-proposals-and-zoho.md) | `20261115000300_crm_proposals_files_reminders.sql` |
| 6 | Commercial approval (only if the company policy is `required`) | `crm_request_approval` (owner or founder), `crm_decide_approval` (founder only) | Default policy `not_configured`: both refuse ("Nothing can be approved yet"); `not_required` also refuses a request. A pending request shows to Sales founders on My Day ("Commercial approval waiting for your decision") | same file; `attention.ts` `commercialApprovalCandidates` |

### 1.2 Confirm as won and the handover

| # | Screen -> action | Function / table | Result and notices | Source |
|---|---|---|---|---|
| 7 | Opportunity -> **Confirm as won** (`stage-actions.tsx`, or `/sales/opportunities/[id]/close`) | `crm_mark_won(id, evidence_type, reference, date, note, expected_version)` | Needs a **purchase order or authorised e-mail**, its reference and date, **and a confirmed value**; owner or founder only; open stage only (not on hold). Writes stage `won`, `crm_closures`, cancels open follow-ups, inserts an empty `crm_handovers` row | `20261115000200_crm_workflow_functions.sql:493` |
| 8 | Under "Won": prompt **Prepare the handover now** (button text changes to "Answer it", "See the handover package" by state) | Reads `proj_handover_for_opportunity` | Prompt text: "Nobody in delivery is told until you submit it." A failed read says "Could not check the handover." | `components/sales/won-handover-prompt.tsx` |
| 9 | `/sales/opportunities/[id]/handover`: fill scope, location, dates, risks, optional PM; **Save** then **Submit** | `proj_save_handover` (versioned), `proj_submit_handover` (also a combined save-and-submit action) | Needs a scope description. Status `submitted`, or `pm_assigned` if a PM was named. If no PM: notice `project_handover_submitted` to every founder and `assign_pm` holder of the company; if a PM is named: `project_handover_resubmitted`/assigned notice to that PM | `lib/actions/projectsCore.ts:65-103`; `20261120000200_proj_projects_handover_functions.sql:248` |
| 10 | `/projects/handovers`: founder or `assign_pm` holder assigns a PM | `proj_assign_handover_pm` | Needs status `submitted`, `pm_assigned` or `clarification_requested`; the PM must hold Projects access. Notice `project_handover_assigned` to the PM. My Day: "Project handover waiting for a project manager to be assigned" (assigner) / "...waiting for you to accept" (PM) | same; `attention.ts` `projectDecisionCandidates` |
| 11a | PM **Accept** | `proj_accept_handover` | Only the assigned PM; opportunity must still be Won; one project per opportunity. Creates `proj_projects` (status `planning`), `proj_project_details`, PM member row, `proj_sales_links` (sales owner and preparer); notice `project_handover_accepted` to sales owner and preparer | same file |
| 11b | PM **Ask a question** | `proj_request_handover_clarification` | Status `clarification_requested` with the note; notice `project_handover_clarification` to the Sales owner and the preparer. **The owner sees it** on the enquiry ("The Project Manager asked a question about the handover" / "Answer it") and on My Day ("Handover: the PM asked a question", `sales-handover` source). Owner edits and resubmits (revision +1) | same; `lib/crm/handover-attention.ts` `HANDOVER_KIND_LABEL` |
| 11c | Sales or founder **Withdraw** | `proj_withdraw_handover` | Reason required; not allowed once accepted | same |

Handover statuses: `draft, submitted, pm_assigned, clarification_requested, accepted, withdrawn` (`20261120000100_proj_core_tables.sql`). Separate older status on the CRM side: `crm_handovers.status` `draft, ready, handed_over` via `crm_update_handover` (the Projects handover above is the live path. **Answered in the app-map pass:** the CRM-side row drives only the fallback "Project Manager and status" form shown when Projects & Tasks is not installed; otherwise the handover page shows it read-only as "Earlier Sales-side handover record": [`modules/sales-close-and-handover.md`](./modules/sales-close-and-handover.md) section 2.1).

### 1.3 Project delivery

| Step | What happens | Function / table | Notices and My Day | Source |
|---|---|---|---|---|
| Project statuses | `planning, in_progress, ready_for_installation, on_site, on_hold, completed, archived` | `proj_set_status` | | `20261120000100_proj_core_tables.sql` |
| Draft equipment request | A client project gets a draft equipment request from the handover automatically; a failure is logged, never blocks | trigger `inv_proj_after_insert`, `inv_import_handover_requirements` | | `20261201000400_inv_planning_functions.sql:1930` |
| Team, tasks | Add members/teams; create and assign tasks; statuses `todo, in_progress, ready_for_review, done, cancelled, deferred` | `proj_add_member`, `proj_create_task`, `proj_set_task_status` | Overdue and review tasks feed My Day (`project-tasks`) | `projectsDelivery.ts`; `attention.ts` `taskCandidates` |
| **Blocker** | Blocked is a flag beside the status. Needs a reason **and** either a named project member who can unblock or a written action | `proj_block_task` (assignee, department head or PM may block) | The named unblocker is told (`project_task_blocked`); **the PM is also told** (FYI) when the unblocker is not the PM; reporter is never told of own action. Unblock by assignee, dept head, PM or the named person (`proj_unblock_task`) | `20261216000900_proj_block_task_notifies_pm.sql` |
| **Scope change** | Client feedback recorded, then a proposal with proposed scope and effect on dates; status `proposed, approved, rejected, withdrawn` | `proj_record_feedback`, `proj_propose_scope_change`, `proj_decide_scope_change` (needs `approve_scope`, founders hold it), `proj_withdraw_scope_change` | Founders and `approve_scope` holders who can open the project get `project_scope_proposed`; **My Day "Scope change waiting for your decision"** links to the decision page `/projects/scope-decisions/[id]` (works for a decider who is not a project member). Approval replaces the **current** scope; the handover original is kept. A chat message never approves | `20261216000200_...sql`; `20261216000820_proj_scope_decision_context.sql`; `20261120000500_...sql:547` |
| Acting PM | Time-limited stand-in | `proj_set_acting_pm`, `proj_end_acting_pm` | | `20261120000200_...sql` |
| Completion | Completion note; for a client project the client's confirmation (e-mail reference, signed handover or uploaded evidence, date, contact); every unfinished item needs an explicit decision | `proj_completion_review`, `proj_complete_project`, `proj_reopen_project` | **Completing does not return equipment.** The trigger `inv_proj_after_status` releases unused reservations and cancels draft/submitted requests; dispatched equipment stays outstanding | `20261120000500_...sql`; `inv_proj_after_status` |

### 1.4 Equipment: request, reserve, send out, receive back

Screen: `/inventory/requests/[id]` has three working views: **1 Prepare**, **2 Send out**, **3 Receive back** (same request, reservations and movements, no new status). The PM works from the project's Equipment tab (`/projects/[id]/equipment`); warehouse staff from Inventory Today / Requests.

| # | Step | Function / table | Result and rules | Source |
|---|---|---|---|---|
| 12 | PM (or acting PM, or warehouse staff) creates a request, adds lines, sets planning dates, **submits** | `inv_create_request`, `inv_add_request_line`, `inv_submit_request` | Request `draft -> submitted`; needs at least one line, a start and end, dates not in the past. Not allowed on a completed/archived project | `20261201000400_inv_planning_functions.sql` |
| 13 | Warehouse **Reserve** per line (reserves nothing physically) | `inv_reserve` (warehouse staff at that location or a founder) | Request must be `submitted` or `in_progress`; reservation covers the whole window; `inv_reservations.status` `active, released, completed`. Not enough stock: shortage mark `need_to_buy` / `need_to_rent` (`inv_set_shortage_action`), line shows under Today -> "Waiting / Shortages" | same; `lib/inventory/today.ts` |
| 14 | Warehouse **Send out** | `inv_dispatch_to_project(company, location, project, key, lines, ...)` (idempotent by key) | With a request: each line must match an active reservation of that request, dispatched quantity goes up. Without: unit must be free until expected return; another reservation stops it; consumables are refused (use Consume). Movement is append-only | `20261217000100_inv_project_notes.sql:521` (latest definition); `20261201000300_inv_stock_functions.sql` |
| 15 | **Dispatch note** (only if the company switch is ON) | `inv_make_project_note(movement)` called inside the dispatch transaction | Frozen row in `inv_project_notes`, number `<ref>-D-nnnnn` (company of the **warehouse location**, never reset, no gaps, rolls back with a failed dispatch). If the note cannot be made, the dispatch is refused. **Switch OFF (default, and hosted): nothing is made, dispatch behaves as before** | same file :184, :214; counter `inv_next_code` |
| 16 | PM **acknowledges** or **reports a difference** at the project's Equipment tab | `inv_ack_project_note(note, 'acknowledge' / 'report_difference' / 'withdraw', lines, comment, reason)` | Allowed to the current PM, an acting PM or a Projects founder, checked at the click; capacity (`pm`, `acting_pm`, `projects_founder`) recorded. **Never blocks the dispatch** and never changes stock. Dispatch reasons: not on site, quantity differs, different item, condition differs, other. No notice is sent: the pending state lives on the note and shows on My Day ("Dispatch note waiting for you") through `inv_notes_waiting_for_me` | same :328, :500; `lib/inventory/project-notes.ts`; `attention.ts` `noteCandidates` |
| 17 | Use on site | `inv_transfer_between_projects` (PM of both projects, or warehouse), `inv_consume`, `inv_return_unused` | Movements only | `inventoryStock.ts`; `stock-movements.ts` |
| 18 | Warehouse **Receive back** | `inv_return_from_project`; the screen has the "set the condition for all ticked lines" helper (writes only a chosen condition onto ticked lines; never ticks, never pre-selects) | One condition per line (units: five conditions; counted stock: three). **Good** finishes in one step; anything else becomes a **held** unit. Lines not listed stay outstanding. Returns are matched by project and item, not by the dispatch they reverse. Counted stock is shown at project level | `lib/inventory/return-condition.ts`; `docs/inventory-warehouse-guide.md` section 2 |
| 19 | **Return note** (switch ON) | same mechanism | Number `<ref>-RT-nnnnn`; PM sees "Returned equipment, please confirm"; reasons: not actually returned, quantity differs, something missing from the list, condition differs, other | `project-notes.ts`; `attention.ts` |
| 20 | **Difference and warehouse answer** | `inv_resolve_note_difference(note, 'record_stands' / 'corrected', comment, linked_movement_id)` (warehouse operator at that location only) | Comment required. "Record stands" closes it. "Corrected" must name a **later** movement for the same company (same project when same kind); the system makes a **new note that cites the old one** and the old one shows "superseded". Notes and events are frozen: a guard trigger refuses update, delete and truncate for every role | same :427; `inv_project_notes_frozen` |
| 21 | Read, print | `/projects/[id]/equipment/notes/[noteId]/pdf` | PDF rendered on demand from the frozen payload; readable by project members and Projects founders (`proj_can_view_details`) and warehouse/stock readers of that company (`inv_can_view_stock`) | route file; policy at :112 |

Note states (derived view `inv_project_note_status`): `waiting_for_pm`, `acknowledged`, `difference_open` (awaiting `warehouse`), `superseded`. Turning the switch on: only by the owner's SQL pack `inv_notes_30_switch_one_company_OPTIONAL_writes.sql`; there is **no settings screen** and no app code calls `inv_set_project_notes` (grep of `apps/web/src`; `docs/launch-p3-deployment.md`).

### 1.5 The money side: project budget to settlement

Screen: `/projects/[id]/budget` (PM, Finance, view grantees); Finance inbox `/finance/project-budgets`. Functions in `20261210000200_pbx_budget_functions.sql` and `20261210000300_pbx_funding_actuals_settlement.sql`.

| # | Step | Function | Rules and notices |
|---|---|---|---|
| B1 | PM creates the budget (one per project) and drafts rows | `pbx_create_budget`, `pbx_save_budget_draft` | Totals are computed by the database. One currency per budget |
| B2 | PM **submits** | `pbx_submit_budget(version, expected, request_id)` | Needs a row and a total above zero. Route fixed at submission by `pbx_approval_route`: submitter **without** Budget `finance` -> `finance` route; submitter **with** it -> `executive` route (`executive_approver`, an explicit grant). Every eligible approver except the preparer and submitter gets `project_budget_submitted` |
| B3 | Approver decides | `pbx_decide_budget(version, approve / return / reject, note)` | Decider must hold the route capability and must not be the one who prepared or submitted; return/reject need a reason; second approver gets "already decided". No eligible approver: shows **On hold**, nothing auto-approved. Submitter and PM get `project_budget_decided`. Returned budgets come back to the PM (My Day) |
| B4 | Additions | `pbx_request_addition`, `pbx_revise_budget` | Needs an approved original first |
| B5 | Funding | `pbx_record_funding` (instalments, `is_advance`), `pbx_reverse_funding` | Finance declares; reversible with a reason; card allocations are not advances |
| B6 | Actual expenses | `pbx_start_actuals`, `pbx_save_actuals_draft`, `pbx_submit_actuals`, `pbx_decide_actuals`, `pbx_return_approved_actuals` | Same independence and routing; "paid via" per line (advance, company card, direct, personal, existing claim). An existing-claim line counts as expense but sits outside every balance |
| B7 | Settlement | `pbx_record_receipts`, `pbx_confirm_receipts`, `pbx_record_payment` (money returned or reimbursed), `pbx_close_settlement`, `pbx_reopen_settlement`; figures from `pbx_settlement_summary` | **Advance to return**: advance balance = advances given minus advance-funded actuals minus returned. Close only when actuals are approved, receipts received (or an exception with reason, and independently confirmed on the executive route), every advance balance is zero, no reimbursement outstanding, nothing awaiting a decision |
| B8 | My Day | `pbx_inbox`, `pbx_decisions_waiting_count` | Deciders see budgets/final expenses/settlements waiting (`budgets`); the PM sees returned budgets (`budget-projects`); what a person submitted waits under "Waiting on others". Finance needs no Projects access |

Limits stated in the design: no receipt upload, OCR, bank or Zoho sync, payment execution, e-mail or scheduled job (`docs/project-budget-expenses-design.md` section 5).

### 1.6 Failure and edge behaviour of the main flow

* Won but never handed over: shows on My Day as "Won, handover not submitted" for the owner; nobody in delivery is told.
* Opportunity reopened after Won: an existing handover is kept (`crm_mark_won` comment); acceptance refuses if the opportunity is no longer Won.
* PM loses Projects access or is deactivated before accepting: `proj_accept_handover` refuses; a founder reassigns. Pending approvals on a deactivated approver are **not** re-routed (see 03 section 4.3).
* A note switch turned off later: old notes stay and stay readable (frozen); new movements make none.
* A failed read on any My Day source shows a named error line, never zero (`attention.ts` headline).
* Notes not installed on a database: loaders treat it as "not installed", which shows nothing and is not an error (`lib/inventory/project-notes-data.ts`).

---

## 2. INVENTORY in detail

| Topic | How it works | Source |
|---|---|---|
| **Units vs counted stock** | Tracking is per item: `unit` (individual, own ID and QR label), `quantity` (counted, in `inv_balances` per holder, condition and bin; metres may be decimal), `consumable` (used up, not expected back), plus kits (box with a checklist; kit-contents checking deferred). Tracking cannot be changed once there is stock or history: use Replace item | `docs/inventory-warehouse-guide.md` sections 1 and 6; `docs/inventory-design.md` |
| **Locations per company** | `inv_locations` kind `warehouse, office, other`, with bins and a time zone; each belongs to one company. Operators are assigned to locations (`inv_set_operator_locations`); founders operate all of their company's locations | `20261201000100_...sql`; `peopleAccess.ts:84` |
| **Availability** | Usable now = on shelf, good or fair, not in a kit, not with an employee. Reserved is a promise for dates, not a place. In transit is available at neither end. Not counted yet is never available | `docs/inventory-warehouse-guide.md` section 1; `inv_availability`, `inv_free_count` |
| **Return condition and availability** | When a **unit** is returned from a project (`inv_return_from_project`), received from a transfer (`inv_transfer_receive`) or returned from an employee (`inv_return_from_employee`), the function reports `available` as true when the stated condition is **good or fair**; `needs_inspection`, `damaged` and `unserviceable` do not become available and become Held (a later `inv_check_condition` releases them). **Counted (quantity) stock** accepts only `good`, `needs_inspection` or `damaged` (`inv_valid_condition(..., true)`), and only `good` is available. There is no "poor" condition in code. Sources: `20261201000300_inv_stock_functions.sql` (`inv_valid_condition` line 342; `available` flags at lines 1832, 1989, 2276), `20261217000100_inv_project_notes.sql:653` (redefined `inv_return_from_project`) | read at `28549dd` |
| **Inventory Today: Sales checks** | The Inventory **Today** queue has a "Sales checks" source (filter `sales`) built from `inv_pending_sales_checks()`: a Sales user's "Ask the warehouse to check" request (`crm_request_availability`, step 4 of section 1.1) shows as a dated row (reference, location, install and event dates, technologies and quantities; never title, client, value or notes). It is a check, never a reservation. A failed read of this source is reported as failed, not as an empty list. Rows originating from handovers and project equipment requests are different: they arrive as Prepare / Send / Receive back rows from `inv_requests`. **Not built or Unverified:** any automatic Sales-side check of equipment at handover; the only Sales-to-Inventory check found is the opportunity availability request above. Sources: `apps/web/src/lib/inventory/today.ts`, `today-data.ts` (`loadSalesRows`), `20261201000900_inv_pending_sales_checks.sql` | read at `28549dd` |
| **Reservations** | `inv_reserve` against a request line; `dispatched_qty` is a derived counter; releasing unused: `inv_release_unused`; a reserved unit cannot be moved to another location (refused) | `20261201000400_...sql`; `inv_transfer_dispatch` check |
| **Movements** | `inv_movements` append-only: nobody (service role included) edits or deletes; corrections are a **new** movement naming the entry with a reason (`inv_correct_movement`); every movement takes an idempotency key so a retry cannot double-record ("Check whether it went through") | `20261201000300_...sql`; guide section 2 and 6 |
| Movement kinds (functions) | `inv_receive_stock`, `inv_issue_to_employee`, `inv_return_from_employee`, `inv_dispatch_to_project`, `inv_return_from_project`, `inv_transfer_dispatch`, `inv_transfer_receive`, `inv_transfer_between_projects`, `inv_repair_out/in`, `inv_check_condition`, `inv_adjust_stock`, `inv_consume`, `inv_return_unused`, `inv_return_rental`, `inv_pack_kit`, `inv_unpack_kit` | `lib/inventory/stock-movements.ts:389-421` |
| **Counts** | Opening stock and cycle counts: `inv_start_count`, `inv_save_count_line`, `inv_confirm_count` (needs the confirm right; opening stock is never a purchase) | `inventory-design.md` |
| **Transfers** | **Send** (`inv_transfer_dispatch`: destination must differ, expected arrival in the future, owner-sharing checked at both ends) puts the goods **In transit** (`inv_transfers.status` `in_transit, received, cancelled`); the destination presses **Receive** (`inv_transfer_receive`, all or part, by an operator of the destination). Availability leaves the sender at send and starts at the receiver only at receipt and only for good or fair | `20261201000300_...sql:2230`; `inventory-cross-company-receiving.md` |
| **Cross-company** | Three different things: **owner** (`inv_units.company_id`, never changes), **operating company** (whose warehouse holds it), **custody** (where it is now). Sharing is a row in `inv_company_sharing` made by a founder of the **owning** company. No ownership transfer, no second transfer system. Six public `inv_xshare_*` functions (`destinations, units, counted_stock, transfers, transfer_trace, availability`) give a receiving operator only minimum fields (code, serial, item, owner, condition, place); costs, suppliers, notes, photos, other records stay hidden; base tables still return zero rows to them | migration `20261218000100`; same doc |
| **Sharing revoked during a transfer** | New dispatches refused (`inv_check_sharing`, unchanged) and the Send form no longer offers that company's warehouses. A transfer already in transit stays visible and **receipt is never blocked** (`inv_transfer_receive` has no sharing check). Screens show **"Sharing revoked—contact owner"**; received units remain visible but cannot be issued or sent on until sharing is authorised again. Owner's side sees no flag | same doc, "When the owner revokes sharing" |
| **Employee equipment requests** | Request `kind = 'employee'` is made **for** an employee by their manager or a department head with that right (not by the employee). Warehouse **Reserve**, then **Issue**: since `20261216000100` `inv_issue_to_employee` **consumes the request's own reservation** (before, it refused "reserved for the very same request"). Fully issued reservation is marked `completed`. Employees see their own kit at `/inventory/mine` (`inv_my_equipment`) | `20261216000100_inv_issue_to_employee_consumes_reservation.sql`; `inv_create_request`; `inventory/mine/page.tsx` |
| **Holds ("Held")** | A unit on the shelf whose condition is not good/fair, or counted stock not good, is held back and never released automatically; only `inv_check_condition` releases it (any operator at that location). Today lists Held rows with the live requests that still reserve them | `inventory-warehouse-guide.md` section 1; `lib/inventory/today.ts` `heldRows` |
| **Shortages group** | Today filter "Waiting / Shortages": open lines with something to reserve whose shortage mark is `need_to_buy` or `need_to_rent` (rental reference optional), named by item | `lib/inventory/today.ts:29,148` |
| **Scanning** | `/inventory/scan?c=CODE` resolves a code and redirects to the record; scanning never moves anything; a quantity is always typed. Phone-camera decoding was tested only with generated QR images (`Unverified` on real phones). The signed-out visitor is sent to login and returns to the scan | `inventory/scan/page.tsx`; `proxy.ts` (`next` parameter); guide section 8 |
| **Old QR / bookmark links** | A label QR holds only a web address ending in the ID. Old `/inventory?unit=...` links (any of 18 stock-list parameters such as `unit`, `open`, `action`, `codes`) redirect to `/inventory/stock?...` with every parameter kept; `/inventory/movements` and `/employees` keep parameters too. `/inventory` itself is Today | `lib/inventory/legacy-redirect.ts` |

**Stale:** `docs/inventory-design.md`/older notes may call `/inventory` the stock list; it is now Today (see `01-overview-and-modules.md` section 8).

---

## 3. HR flows

### 3.1 Leave

| # | Step | Function / table | Result | Source |
|---|---|---|---|---|
| 1 | Employee `/leave/new`: type, dates, half days, reason | `submit_leave_request` (guards: leave type, overlap), inserts `leave_requests`, then `create_initial_approval('leave_request')` in the same transaction | Status `submitted`/`pending_approval`; if no approver can be resolved, or the approver is the requester, the whole submit is refused and nothing is saved. A CEO/CTO's own leave needs no approver | `20261028000000_leave_type_and_overlap_db_guards.sql:100`; `20261109000000_executive_requests_no_approver.sql` |
| 2 | Approver `/approvals` | `decide_leave_approval(approval, approved / rejected, ...)` | Walks workflow steps in order (`direct_manager`, `manager_of_manager`, `role:*`); rejection stops the chain; a next step with nobody holding the role raises "Cannot advance this approval". Final approval sets `approved` and posts to `leave_ledger` (or `comp_day_ledger` for comp-day types) | `20261108000000_recovery_windows_attendance_redesign.sql` (latest definition) |
| 3 | Balances | views `leave_balances`, `comp_day_balances` over the ledgers (security invoker) | `/leave` shows balance, requests; cancelling an approved request reverses the ledger (`cancel_leave_request`) | `20260926...`; `20261027000000_cancel_approved_leave_reverses_ledger.sql` |
| 4 | E-mail | `notifyLeaveSubmitted`, `notifyLeaveDecision` via Microsoft Graph | Best effort; failures are logged, not shown | `lib/email/leave-notifications.ts` |
| My Day | Approver: "Waiting for your decision" (`approvals`); employee: "Waiting on others" for own pending leave | | | `lib/my-day/waiting.ts` |

### 3.2 Attendance clock and Recovery Leave

* **Clock** (`/attendance-clock`): `clock_in(work_mode, project_name, project_lead_employee_id, location)` with modes `office, wfh, site_work, client_meeting, business_travel`; `switch_work_segment`; `clock_out`; HR can close a stuck session (`hr_close_attendance_session`). Always for the caller's own employee row. **Site work asks for the project and the project lead** (the lead decides Recovery Leave); location is optional and a denied or unavailable GPS never blocks clocking. Lead choices come from a candidates function added in `20261216000500_attendance_lead_candidates.sql`. Source: `lib/actions/attendanceClocking.ts`.
* **Recovery Leave credit** (as built, two engines): (a) **older rules** in `record_attendance_and_recovery` / `recovery_credit_days_for_hours` (same-day segments, 4-hour rule, weekends and holidays); (b) the **windows redesign** (`20261108000000`): working periods, 24-elapsed-hour windows, thresholds in `docs/recovery-windows-deployment.md` section 1. The windows engine is **dormant**: it applies only after HR activates a "Recovery Leave windows" policy for a country, and **activation is refused unless `recovery_scheduler_ready()` is true** (pg_cron job `recovery-window-processor` active and a successful run by that job in the last 15 minutes). Whether any country's windows policy is active on hosted is `Unverified`; the scheduler is not enabled (section 5).
* **Request and decision**: credit becomes a `recovery_credit_requests` row routed by `recovery_route_request` (route table in `03...` section 4.4: lead then HR Admin, HR direct, shared CEO/CTO queue); the lead decides at `/approvals` (`decide_recovery_credit_request`, `resolve_recovery_credit_project_lead`), a deciding person sees only the card minimum through `recovery_decider_inbox()`. Approved credit posts to `comp_day_ledger`; unused credit expires through `comp-day-expiry` (daily, section 5). Sources: `lib/actions/recoveryCredit.ts`; migrations `20261106000000`, `20261108000000`, `20261216000300`, `20261216000600`.

### 3.3 Employee claims (reimbursements)

**Write path note.** Claims are written by direct table operations from the app (insert, update while draft, delete while draft), limited by RLS policies, the `recompute_claim_total` trigger and status rules, not by a SECURITY DEFINER function. Sales, Projects, Inventory and Budget flows (sections 1 and 2) are the opposite: functions only. Policy activation (3.4) is likewise a direct update held by trigger `guard_policy_version_update()`. Sources: `20260927000000_phase4_reimbursements_projects_timesheets.sql` (policies `reimbursement_*`), `20260925000000_phase2_country_policy_engine.sql`.

1. `/reimbursements` -> new claim: `createDraftClaim` inserts `reimbursement_claims` (status `draft`, currency, claim date). `total_amount` is **never client-supplied**: a trigger `recompute_claim_total` sums the lines.
2. Add lines (`addClaimLine`): date, category, amount above zero, description, optional project, cost centre, receipt file (stored first in bucket `receipts`, removed again if the line insert fails). **Line numbering**: next `line_no` = highest existing + 1, retried when a simultaneous add takes the number (`unique (claim_id, line_no)`). Lines can be deleted while draft.
3. `submitClaim`: status `submitted`, then `create_initial_approval('reimbursement_claim')`; if routing fails the claim is set back to `cancelled` and the error shown. A CEO/CTO's own claim goes to `role:finance` (see 03 section 4.1). Decision through `decide_leave_approval` (rejected -> claim `rejected`).
4. **Advance and settlement are not part of employee claims**; they belong to the Budget module (B5 to B7 in section 1.5). A budget actual can link to an existing claim as a **link only**: the claim is never changed and nothing is paid twice (`lib/budget/claims.ts`). Tagging claim lines to a project is `lines.project_id`; the spec's "U-34" improvement is `Unverified` as built.
5. Statuses are the shared enum `request_status`: `draft, submitted, pending_approval, approved, rejected, cancelled` (`20260926000000_phase3_leave_and_approvals.sql:31`). **Stale:** `docs/04-user-journeys.md` 4.5 describes amount-threshold routing, a Finance "Payables" queue and a `paid` status; the enum has no `paid`, the code seeds a single manager step, and no "Payables" string exists in `apps/web/src`.

### 3.4 Payroll, letters, policies, performance, timesheets

| Area | Flow as built | Source |
|---|---|---|
| Payroll | `/payroll`: create run, `generate_payroll_export_lines`, **submit** (status `submitted`, then `create_initial_approval('payroll_export_run')`; approval failure puts the run back to `draft`). Step 1 `role:finance`, step 2 `role:ceo` (CEO or CTO), resolved per company. Rejecting releases the lines | `lib/actions/payroll.ts`; `20261012000000_payroll_export_release_on_reject_or_delete.sql` |
| Letters | HR generates a letter from a template: the PDF is rendered and stored, then the row is `issued` (template needs no approval) or `pending_approval` (approval routed to CEO/CTO). **Issue/download rule**: the employee can download only an **issued** letter (storage policy requires `generated_letters.status = 'issued'`); HR reads drafts; the approver reads the file to decide; a rejected letter becomes `void`. If routing fails the letter is not issued | `lib/actions/letters.ts:108-131`; `20261216000800_letters_storage_issued_only.sql` |
| Policies | HR drafts a `policy_versions` row (`draft`); activation is a plain update to `active`; two-person control, CEO content-edit block and the date-exclusion constraint are enforced by `guard_policy_version_update` in the database. Draft slots are visible only to people who may read them (`20261216000700`). Windows-policy activation has the extra scheduler gate (3.2) | `lib/actions/policies.ts:70-80` |
| Performance | HR opens/closes cycles (`performance_cycles.status` -> `closed`); goals and appraisals per person; an appraisal is `submitted` then `acknowledged` by the employee | `lib/actions/performance.ts` |
| Timesheets | Submit sets `submitted` then `create_initial_approval('timesheet')` (failure: `cancelled`); approver `direct_manager`. No menu entry (route only) | `lib/actions/timesheets.ts`; `01...` module table |

### 3.5 Account lifecycle (People & Access -> Account)

| Action | Hosted (Supabase Auth) | Local stand-in |
|---|---|---|
| **Invite** | `inviteUser`: `admin.auth.admin.inviteUserByEmail` with redirect to `/set-password`; account shows Invited until the person sets a password. **Resend** uses a workaround because Supabase has no resend call | Link recorded in `local_auth.outbox`, no e-mail |
| **Reset** | Admin "Send password reset" (audited via `log_security_event`); change password signs out other sessions | same, via the stand-in |
| **Deactivate** | Bans first (`ban_duration` 876600h), then records via `set_account_status`; refuses the last active CEO/CTO or executive approver; `account_holdings` shows what the account still holds; an already signed-in session is denied on its next request. Pending approvals are not re-routed | stand-in implements bans so the app logic is tested |
| **Reactivate** | Lifts the ban, then sets status; on failure it stays banned though shown Active (never more accessible than intended) | same |
| **Delete** | Sys Admin only, not self: unlinks the employee row, revokes role grants, `admin.auth.admin.deleteUser`; refused by a foreign-key error if history exists (permanent delete rules `20261024000000`) | same |

Sources: `lib/actions/users.ts`, `lib/actions/account-status.ts`, `docs/people-access-account-controls-verification.md`. The local stack's auth is an in-repo stand-in (`packages/e2e-tests/local-stack/local-auth.mjs`), **not Supabase Auth**: it proves the application's behaviour, not e-mail delivery, link expiry or real session revocation. That doc records a partial hosted check on 2026-10-27 (a disposable invitee on V2); anything beyond it is `Unverified`.

---

## 4. Approvals and notifications

**How steps are created and routed.** An approval flow starts with `create_initial_approval(entity_type, entity_id)`: picks the company workflow (`approval_workflows`, seeded per entity type), resolves the approver with `resolve_approver` (or `resolve_approver_for_company` for payroll), refuses when none exists or the approver is the requester, and inserts an `approvals` row. `decide_leave_approval` (used for every entity type, despite the name) records the decision and creates the next step or applies the final effect. Recovery credit uses queue rows (`approver_id` null, `queue_roles` set). Budget and scope decisions are **not** `approvals` rows: they are decided by `pbx_decide_*` and `proj_decide_scope_change`; dispatch/return notes are not approvals either. Full routing tables, independence and inactive-approver rules: `03-roles-access-and-approvals.md` section 4. Sources: `20260926000000_phase3_leave_and_approvals.sql`; `20261216000300_account_deactivation_inactive_people.sql`.

**Budget decisions are a separate path (not the Approvals page).** The `approvals` table and `/approvals` page cover leave, claims, timesheets, letters, payroll runs and Recovery Leave. Project budgets, additional requests, final expenses and settlement run through the `pbx_*` functions (`pbx_submit_*`, `pbx_decide_budget`, `pbx_decide_actuals`, see section 1.5) and are read from `pbx_inbox()`, shown in the Finance inbox `/finance/project-budgets`. On My Day they appear only through the `budgets` and `budget-projects` sources (`budgetCandidates`, below), never through `approvalCandidates`. Routing rules: `03-roles-access-and-approvals.md` section 4.5. Sources: `20261210000200_pbx_budget_functions.sql`, `20261210000400_pbx_views.sql:190`.

**My Day "attention" headline = the list.** `buildAttention` merges candidates from ten sources into one ordered list; the headline number is that list's length and the page shows the same list, so they cannot disagree; a record reached by two sources has one key and appears once. Tiers: 0 overdue, 1 due today, 2 everything else (oldest waiting first). Wording: "Your updates for today: N items need your attention."; if a source failed: "Some items may need your attention: ... could not be loaded"; never "nothing" on a failed read (`lib/my-day/attention.ts`, `attentionHeadline`).

| "Needs me" source | What it lists | Read by |
|---|---|---|
| `approvals` | leave, claims, timesheets, letters, payroll runs, Recovery Leave waiting on the person | `approvalCandidates` |
| `project-tasks` | overdue/open tasks and tasks to review | `taskCandidates` |
| `project-decisions` | handovers to assign or accept, scope changes to decide | `projectDecisionCandidates` |
| `sales` | overdue / due-today follow-ups, enquiries awaiting first response | `salesCandidates` |
| `sales-handover` | Won with no handover submitted; PM asked a question (accepted ones are excluded) | `handoverCandidates` |
| `sales-approvals` | commercial approvals for Sales founders | `commercialApprovalCandidates` |
| `budgets`, `budget-projects` | budgets/expenses/settlements to decide; budgets returned to the PM | `budgetCandidates` (`pbx_inbox`) |
| `notes` | dispatch/return notes waiting for the PM | `noteCandidates` (`inv_notes_waiting_for_me`) |
| `hr` | HR alert kinds (contracts, probation, documents, identity) | `hrCandidates` |

**Waiting on others** (a different list, never counted in the headline): the person's own pending leave, claims and Recovery Leave (`lib/my-day/waiting.ts`: leave, claims, recovery), their budgets submitted, and tasks sent for review (`app/(app)/page.tsx`). Also open-but-not-actions (unread discussion, recent budget decisions, accepted handover) sit in "also open".

**Notices.** `proj_notify(project, user, type, payload, dedupe, require_member)` and `pbx_notify(user, type, budget, payload, dedupe)` insert into `notifications`. Rules: nothing for a null user, the actor, or an inactive person; an unread notice with the same type and dedupe key is not repeated; `proj_notify` with `require_member` reaches only eligible project members or Projects founders. **Reader limits**: the only screen that reads notices is **Projects -> My Work**, through `proj_my_notifications` (40 newest, only types starting `project_`, and only for a project the reader participates in, or with no project) (`app/(app)/projects/work/page.tsx:88`; `20261120000400_...sql:902`). There is no global bell and no screen for the `notifications` table (`01...` section 8). Consequence (inferred, `Unverified` at runtime): budget notices to a Finance approver who is not on the project are written but not readable on any screen; the Finance inbox and My Day are their reading path. Also, the dispatch/return notes use **no notice at all**, and Sales uses its own `crm_reminders` (read in Sales, `crm_mark_reminder_read`). `document-expiry` also inserts into `notifications` (`app/api/cron/document-expiry/route.ts:114`).

---

## 5. Scheduled work (facts only; activation is deferred)

Status line: **scheduler activation is deferred by owner decision** (not enabled and not changed by this documentation; it is a decision, not a verified hosted state). **Hosted scheduler status is `Unverified`: the owner is to check the Vercel cron history and the `pg_cron` job histories** and nothing below may be read as confirmed running or confirmed off. The owner decision is that **scheduled-job activation is not part of the launch stack** (`docs/launch-refinement-install-order.md` lines 16 and 75). `Unverified` whether the Vercel crons below actually fire on the hosted project; the owner's baseline records are the evidence (`docs/launch-refinement-hosted-checklist.md` lines 41 and 42).

| Job | Where defined | Schedule | What it does | Auth and reachability | Status |
|---|---|---|---|---|---|
| `/api/cron/leave-accrual` | `vercel.json` | `0 0 1 * *` (monthly, 00:00 UTC, day 1) | Posts leave accruals to `leave_ledger` per policy rules (monthly, per service year, annual grant) | Bearer `CRON_SECRET` (`lib/cron/auth.ts`); `proxy.ts` does not list it as public | Listed; `Unverified` running |
| `/api/cron/comp-day-expiry` | `vercel.json` | `0 1 * * *` | Re-derives expiry of comp-day credits from the full ledger and posts `expired` rows; idempotent | same | Listed; `Unverified` |
| `/api/cron/document-expiry` | `vercel.json` | `0 2 * * *` | Moves `employee_documents` valid -> expiring_soon -> expired; one `notifications` row per document and lead-day (unique table prevents repeats) | same | Listed; `Unverified` |
| `/api/ai/detect-balance-discrepancies` | `vercel.json` | `0 3 * * *` | Inserts `ai_drafts` for negative balances (no language model; reviewed drafts) | same secret check | Listed; `Unverified` |
| `/api/cron/recovery-windows` | `vercel.json` | `30 0 * * *` | Safety-net daily call of `recovery_process_due()`; the real trigger is the 5-minute pg_cron job below | same | Listed; `Unverified` |
| `/api/cron/crm-reminders` | `vercel.json` | `0 4 * * *` (08:00 Dubai) | `crm_generate_reminders` (due and 24h-overdue follow-ups, hold reviews, no-next-action), owner e-mails only if `CRM_REMINDER_EMAILS=on` and the company enabled it, sweeps expired upload intents | Bearer secret; **the only path `proxy.ts` lets past the sign-in redirect** (`PUBLIC_PATHS`) | Listed; `Unverified` |
| In-app reminder refresh | `lib/crm/reminders.ts:81` | on opening Sales -> Overview, best effort | Same `crm_generate_reminders` through the admin client | a signed-in page load | Built; not a schedule |
| pg_cron `recovery-window-processor` | `supabase/manual-sql/recovery_windows_30_enable_scheduler.sql` (not a migration) | `*/5 * * * *` calling `recovery_process_due('pg_cron')` | Closes 24-hour windows, creates requests and HR alerts, retries failures; gate for policy activation | Runs inside the database | **Not enabled** (owner: no scheduled job activated; nothing in the repo proves otherwise) |

Findings recorded in the repo, not changed here: every `/api/cron/*` route except `crm-reminders` (and the AI route) sits behind the sign-in redirect, and Vercel's cron request carries no session, so those calls would be redirected to `/login` rather than reach the route (`proxy.ts:16,60`; `docs/crm-deployment.md` line 99). Vercel Hobby cron is daily at most (`docs/recovery-windows-deployment.md` line 235). No Edge Functions or other `pg_cron.schedule` calls exist in `supabase/migrations`; `docs/05-automation-rules.md` still says jobs deploy as Edge Functions or pg_cron (**Stale**: the built jobs are Vercel crons plus one manual pg_cron SQL).

---

## 6. Stale statements found while writing this file

| Where | Says | Code at `551f615` |
|---|---|---|
| Spec Section 6.2 (pre-release) | Notice plus waiting state for PM acknowledgement; creation Option A or B | Option A built; **no notice**: pending state lives on `inv_project_note_status`, shown through My Day `notes` (`20261217000100...sql` header) |
| Spec Section 5 (pre-release) | "Needs me" as a proposal; blocker flow as before-and-after targets | Built: one merged list from ten sources; blocker needs a reason and unblock person, PM also told (`attention.ts`, `20261216000900`) |
| Spec 6.1 fact 7 | No Inventory code writes notices | Still true for notes; `proj_notify`/`pbx_notify` cover Projects and Budget only |
| `docs/04-user-journeys.md` 4.5 | Claim thresholds, Payables queue, `paid` status | Not in code (section 3.3) |
| `docs/05-automation-rules.md` | Edge Functions or pg_cron | Vercel crons plus one manual pg_cron script (section 5) |
| Spec 6.1 fact 3 (pre-release) | A PM cannot read any movement row | Still true; PM-facing notes use their own readable table `inv_project_notes` (policy `proj_can_view_details`) |

---

## 7. Status vocabulary at a glance

| Record | Statuses | Source |
|---|---|---|
| Opportunity | `new, qualified, proposal_prep, proposal_sent, estimate_sent, quote_sent, negotiation, on_hold, won, lost` | `20261115000100_crm_core_tables.sql`; `estimate_sent` added by `20261228000100_crm_estimate_sent_stage.sql` |
| Proposal | `draft, sent, superseded, accepted` | same |
| Commercial approval policy | `not_configured` (default), `not_required`, `required` | `20261115000000_crm_access_audit_settings.sql` |
| Handover | `draft, submitted, pm_assigned, clarification_requested, accepted, withdrawn` | `20261120000100_proj_core_tables.sql` |
| Project | `planning, in_progress, ready_for_installation, on_site, on_hold, completed, archived` | same |
| Task | `todo, in_progress, ready_for_review, done, cancelled, deferred` (+ blocked flag) | same |
| Scope change | `proposed, approved, rejected, withdrawn` | `20261120000500_...sql` |
| Equipment request | `draft, submitted, in_progress, fulfilled, cancelled, closed` | `20261201000200_inv_planning_tables.sql` |
| Reservation | `active, released, completed` | same |
| Transfer | `in_transit, received, cancelled` | `20261201000100_...sql` |
| Dispatch / return note | derived: `waiting_for_pm, acknowledged, difference_open, superseded` | `inv_project_note_status` |
| Budget version | `draft, submitted, returned, rejected, approved, discarded` | `docs/project-budget-expenses-design.md` section 3 |
| Leave, claim, timesheet (shared enum) | `draft, submitted, pending_approval, approved, rejected, cancelled` | `20260926000000_phase3_leave_and_approvals.sql:31` |
