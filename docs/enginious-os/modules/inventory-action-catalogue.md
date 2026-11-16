# Inventory: action catalogue

**Status (2026-11-16).** Written for **Inventory Phase 2** on branch `claude/inventory-phase-2`: **not merged, no pull request opened by Claude, required CI not yet run on this head, no SQL in this phase, Production not deployed from this branch.** Every Inventory action that changes data, moves a workflow or changes custody: the function behind it, who is permitted and where that is enforced, the starting state, what changes, whether a retry is safe, and when to stop and ask.

**A documented function is not an approved tool.** JARVIS cannot read or change Inventory (see [`jarvis.md`](./jarvis.md) section 17 and [`jarvis-rulebook.md`](./jarvis-rulebook.md)); nothing here grants it anything.

Sources: `S` = `supabase/migrations/20261201000300_inv_stock_functions.sql`; `P` = `20261201000400_inv_planning_functions.sql`; `E` = `20261201000500_inv_employee_legacy.sql`; `N` = `20261217000100_inv_project_notes.sql`; `P1` = `20270114000100_inv_phase1_job_flow.sql`; `A` = `20261201000000_inv_access_audit_settings.sql`. Server actions: `web/lib/actions/inventoryStock.ts`, `inventoryPlanning.ts`, `inventorySetup.ts`, `inventoryNotes.ts`. "Operator" means a warehouse operator assigned to that location (or holding all locations) or a founder of its company, checked by `inv_loc` inside the function (`S:156`). The first nine rows are the Phase 1 entries, unchanged in id.

## 1. The project equipment job

| Id | Action (button) | Function | Permitted (enforced in) | Starting state | Changes | Retry | Stop and ask |
|---|---|---|---|---|---|---|---|
| `inventory.check.ask` | Ask the warehouse to check | `inv_request_opportunity_check` (`P:1602`) | enquiry owner, Sales founder | open enquiry | one pending check, optional warehouse | safe: one pending check per enquiry | never reserves; do not present as a booking |
| `inventory.check.record` | Check availability | `inv_record_opportunity_check` (`P:1637`) | warehouse, catalogue manager, founder | an enquiry of the company | a dated check with covers and summary | a second record supersedes the first | none |
| `inventory.request.set_runs` | Save the dates and site runs | `inv_save_request_plan` or `inv_change_request_window`, `inv_set_request_runs` | Project Manager, acting PM, Projects founder, warehouse (`inv_require_edit`) | request not cancelled or closed | plan dates, window; run links | safe: the list is replaced | a date change on a reserved request reports lines that could not move |
| `inventory.request.send_to_warehouse` | Send to Warehouse | `inv_submit_request` (`P:748`) | same | draft with a line and dates | `draft` to `submitted` | refused on a stale version | none |
| `inventory.request.reserve` | Reserve | `inv_reserve` (`P:957`) | operator | submitted or in progress | reservations; shortage mark | not idempotent by key: re-read the line first | a shortage needs a buy or rent decision |
| `inventory.request.pick` | Pick items | `inv_pick_for_request` (`P1:45`) | operator | reserved and unsent | picked quantity only | idempotent by key; check before retry | a damaged or missing unit is refused: reserve another |
| `inventory.request.send` | Send equipment | `inv_dispatch_to_project` (`N:521`) | operator | reserved for the request | one movement, custody to the project | idempotent by key; check before retry | never send unreserved stock against a request |
| `inventory.request.receive` | Receive return | `inv_return_from_project` (`N:617`) | operator | held by the project | one movement; condition per line | idempotent by key; check before retry | a condition is never assumed |
| `inventory.unit.inspect` | Inspect (clear a held unit) | `inv_check_condition` (`S:2749`) | operator | on the shelf at that warehouse | condition; one movement `condition_check` | idempotent by key | who may clear a damaged unit is an open decision (`inventory.md` section 10, 1) |
| `inventory.request.create` | Add (a request for a project or an employee) | `inv_create_request` (`P:398`) | for a project: its Project Manager, an acting one or warehouse staff (`P:428`); for an employee: the rule inside the function was not read line by line (`Unverified`; the screens offer it to people with "request for employees" and to the warehouse) | none | a draft request | creates a second draft if repeated: check the list first | none |
| `inventory.request.lines` | Add line, Add from a template, change or cancel a line, propose or decide a substitution, mark a shortage | `inv_add_request_line`, `inv_expand_technology`, `inv_update_request_line`, `inv_cancel_request_line`, `inv_propose_substitution`, `inv_decide_substitution`, `inv_set_shortage_action` (`P:497` to `P:922`) | editors of the request (`inv_require_edit`); a substitution is proposed by the warehouse and decided by the requester | request not closed | lines, substitutions, shortage marks | each is a single change; re-read first | a substitution changes what the client was promised: the requester decides |
| `inventory.request.cancel` | Cancel request; Release | `inv_cancel_request` (`P:796`), `inv_release_reservation` (`P:1111`) | editors; the warehouse releases | not closed | status; reservations released | safe | equipment already out is not returned by cancelling |
| `inventory.project.dispatch_unplanned` | Send to a project (not from a request) | `inv_dispatch_to_project` without a request | operator | on the shelf, not reserved | one movement, custody to the project | idempotent by key | it fulfils no request: use the job for planned equipment |
| `inventory.project.return` | Receive return (from a project, general form) | `inv_return_from_project` | operator | held by the project | one movement; condition per line | idempotent by key | as `inventory.request.receive` |
| `inventory.project.move` | Move to another project | `inv_transfer_between_projects` (`20261201000700`) | the manager of the project it is on, or the warehouse it came from | held by a project; the destination has an open request | custody moves to the other project | idempotent by key | needs a request on the destination project |

## 2. Stock in, transfers and custody

| Id | Action (button) | Function | Permitted (enforced in) | Starting state | Changes | Retry | Stop and ask |
|---|---|---|---|---|---|---|---|
| `inventory.stock.receive` | Receive stock, then Confirm receipt | `inv_receive_stock` (`S:1591`) | operator at the receiving location; a cost needs `view_costs` | an active catalogue item; owned or rented chosen | new units or a higher quantity; a rental record when rented; movement `receipt` or `rental_receipt` | idempotent by key; check before retry | owned or rented is never assumed; a draft item cannot be received |
| `inventory.rental.return` | Return rental to supplier | `inv_return_rental` (`S:2982`) | operator | rented stock on the shelf | leaves stock; the rental closes when nothing is left | idempotent by key | none |
| `inventory.transfer.send` | Transfer stock, then Confirm and send | `inv_transfer_dispatch` (`S:2152`) | operator at the **sending** location; the owner's sharing must cover both ends (`inv_check_sharing`) | on the shelf, not reserved for an upcoming request | a transfer `in_transit`; custody `transit`; movement `transfer_dispatch` under the sending company | idempotent by key; check before retry | read the company beside the warehouse: two companies can have a warehouse of the same name. A transfer never changes the owner |
| `inventory.transfer.receive` | Receive transfer, then Confirm arrival | `inv_transfer_receive` (`S:2230`) | operator at the **receiving** location (no sharing check at receipt) | transfer `in_transit` | listed lines to the destination shelf with their condition; the transfer `received` when nothing is left; movement `transfer_receive` under the receiving company | idempotent by key (driven: three calls, one movement) | never receive what did not arrive; damaged is recorded as damaged and is held |
| `inventory.employee.give` | Give equipment, then Confirm issue | `inv_issue_to_employee` (`20261216000100:16`) | operator | usable on the shelf; an active employee | custody `employee`; movement `issue_employee`; a request's own reservation is consumed | idempotent by key | a damaged or held unit is refused; more than a request asks for is refused |
| `inventory.employee.receive_return` | Receive return, then Confirm return | `inv_return_from_employee` (`S:1796`) | operator | held by the employee | listed lines back to the shelf with their condition; movement `return_employee` | idempotent by key | a condition is chosen for every line; what is not listed stays with the person |
| `inventory.unit.reassign` | Change who holds it | `inv_reassign_unit` (`E:211`) | warehouse staff (the exact check inside the function was not read line by line: `Unverified`) | a unit with an employee | to another employee, or back to the pool, with a reason | idempotent by key | a reason is required |
| `inventory.consumable.use` | Use up | `inv_consume` (`S:2307`) | operator | consumables on the shelf | quantity leaves stock | idempotent by key | none |
| `inventory.consumable.return_unused` | Return unused | `inv_return_unused` (`S:2362`) | operator | used by that person or project | quantity back on the shelf, never more than was used | idempotent by key | none |

## 3. Condition, repair, adjustment and correction

| Id | Action (button) | Function | Permitted (enforced in) | Starting state | Changes | Retry | Stop and ask |
|---|---|---|---|---|---|---|---|
| `inventory.unit.repair_out` | Send for repair | `inv_repair_out` (`S:2408`) | operator | on the shelf | custody `repair`, reference kept | idempotent by key | none |
| `inventory.unit.repair_in` | Back from repair | `inv_repair_in` (`S:2466`) | operator | out for repair | back on the shelf with a condition; good is available | idempotent by key | none |
| `inventory.stock.adjust` | Mark missing, Mark found, Retire | `inv_adjust_stock` (`S:2804`) | operator | missing: on the shelf or out; found: missing; retire: on the shelf | lifecycle or quantity; a reason is recorded | idempotent by key | a write-off is permanent in practice: nothing is deleted, but it leaves stock |
| `inventory.movement.correct` | Correct this entry | `inv_correct_movement` (`S:2907`) | people who may confirm stock | a counted line that was received, opened, found, counted or used up | a new entry naming the original; the balance is put right | idempotent by key | the original is never edited; units are not corrected this way |

## 4. Catalogue, labels and kits

| Id | Action (button) | Function | Permitted (enforced in) | Starting state | Changes | Retry | Stop and ask |
|---|---|---|---|---|---|---|---|
| `inventory.item.save` | Add item; Save changes | `inv_save_item` (`S:919`) | catalogue rights | none, or an existing item (version checked) | the item; tracking is locked once there is stock or history | a repeated Add makes a duplicate unless name, model and specification match: check first | changing how an item is tracked needs Replace item |
| `inventory.item.replace` | Replace item | `inv_replace_item` (`S:999`) | catalogue rights | an item | retires it and makes a new one, with a reason | not idempotent: check first | nothing is deleted |
| `inventory.category.save` | Add a category; Save | `inv_save_category` (`S:877`) | catalogue rights | none | the category tree | safe to repeat an edit | none |
| `inventory.technology.save` | Save template; set status | `inv_save_technology`, `inv_save_technology_components`, `inv_set_technology_status` (`P:257,301,362`) | catalogue rights | none | a template and its components | version checked | a template is a checklist, not stock |
| `inventory.unit.register` | Add unit | `inv_register_unit` (`S:1080`) | operator there, or catalogue rights | an individual item | a unit, "Not counted yet" until an opening count confirms it | not idempotent: check the item first | it is not stock until confirmed |
| `inventory.label.bin` | Create a bin label | `inv_ensure_bin_label` (`S:1171`) | operator there, or catalogue rights | a counted item in a bin | a label code for that item and bin | safe: returns the existing label | none |
| `inventory.label.print` | Print label(s) | `inv_record_label_print` (`S:1208`) | checked in the function ("You are not allowed to print labels for this"); the exact rule was not read line by line | a unit or bin label | a print record only | safe | none |
| `inventory.kit.checklist` | Edit the checklist | `inv_set_kit_line` (`S:2703`) | catalogue rights | a kit unit | what belongs in the kit; moves no stock | safe | none |
| `inventory.kit.pack` | Pack the kit | `inv_pack_kit` (`S:2520`) | operator | a kit on the shelf | contents go into the kit; missing and substituted lines recorded | idempotent by key | none |
| `inventory.kit.unpack` | Unpack the kit | `inv_unpack_kit` (`S:2636`) | operator | a packed kit | contents back on the shelf | idempotent by key | none |

## 5. Setup and administration

| Id | Action (button) | Function | Permitted (enforced in) | Starting state | Changes | Retry | Stop and ask |
|---|---|---|---|---|---|---|---|
| `inventory.location.save` | Add a location; Save location | `inv_save_location` (`S:760`) | founder | none | a location of **that company**, with its time zone | a repeated Add is refused on the same code | a location belongs to one company for good: never use one to stand in for another company's. Switching one off needs it empty |
| `inventory.bin.save` | Add bin; Save bin | `inv_save_bin` (`S:809`) | catalogue rights | a location | a bin | refused on the same code | a bin is switched off only when empty |
| `inventory.count.start` | Start a count | `inv_start_count` (`S:1240`) | operator at the location | none | an open count; no stock changes | a second start makes a second count: check first | none |
| `inventory.count.line` | Add or change a counted line; remove a line | `inv_save_count_line` (`S:1259`), `inv_remove_count_line` | operator at the location | an open count | count lines only | safe | none |
| `inventory.count.confirm` | Confirm this count | `inv_confirm_count` (`S:1383`) | people who may confirm stock | an open count; every difference has a reason | opening: units and quantities become verified stock; cycle: differences become corrections | idempotent by key | this is what makes stock real: read the review first |
| `inventory.count.cancel` | Cancel count | `inv_cancel_count` (`S:1481`) | an operator at the count's location, or someone who may confirm stock | an open count | cancelled with a reason; no stock changes | safe | none |
| `inventory.opening.custody` | Confirm (equipment already out) | `inv_confirm_opening_custody` (`S:1504`) | people who may confirm stock | units or quantities already with people or on projects | they become stock recorded as out | idempotent by key | a unit is confirmed in one place only |
| `inventory.sharing.set` | Allow this company; Stop allowing | `inv_set_company_sharing` (`S:1038`) | a founder of the **owning** company | none | the sharing row; revoking blocks new dispatches only | safe | this is the authorisation for another company to hold and use the equipment: the owner decides |
| `inventory.company.code` | Set code; Change code | `inv_set_company_code` (`A:353`) | founder | none | the reference code used in every ID | refused once a code has been issued | labels already carry it |
| `inventory.company.enabled` | Switch Inventory on or off | `inv_set_enabled` (`A:383`) | founder | a reference code | every change is paused; nothing is deleted | safe | pauses the whole company's Inventory |
| `inventory.legacy.import` | Import (earlier asset register) | `inv_import_legacy_assets` (`E:511`) | founder | assets not yet linked and not retired | units linked to their HR asset; the asset is then managed in Inventory | rows already linked are skipped | there is no undo: check the item and location of every row |
| `inventory.access.grant` | Inventory access in People & Access | `inv_grant_access`, `inv_revoke_access` (`A:265,322`) | access managers; founder rights only by a founder | none | a person's Inventory rights in one company | safe | access is never changed without the owner |
| `inventory.access.locations` | Operator's warehouse locations | `inv_set_operator_locations` (`S:849`) | access managers | a warehouse operator | which locations they may operate | safe | same |

## 6. Dispatch and return notes

| Id | Action (button) | Function | Permitted (enforced in) | Starting state | Changes | Retry | Stop and ask |
|---|---|---|---|---|---|---|---|
| `inventory.note.answer` | Acknowledge; Report a difference; withdraw a difference | `inv_ack_project_note` (`N:328`) | the project's Project Manager, an acting one, a Projects founder | a note waiting for the Project Manager | an event on the note; no stock changes | what a repeated answer does is `Unverified` (not read line by line) | none |
| `inventory.note.resolve_difference` | Answer a difference | `inv_resolve_note_difference` (`N:427`) | an operator at the note's location | a difference open | an event; a correction is a new note | what a repeated answer does is `Unverified` | a difference never moves stock: correct the movement separately if it was wrong |
| `inventory.note.switch` | none: no screen | `inv_set_project_notes` (`N:192`) | founder | off | notes are made for that company's project dispatches and returns | safe | **owner decision**; never enabled by Claude |

Total: 54 actions (15 + 9 + 4 + 10 + 13 + 3; one of them, `inventory.note.switch`, has no screen).

## 7. Rules that hold for every action

1. The database decides. A button that is offered and a function that agrees are two checks; only the second counts.
2. A movement is recorded once. Movements carry a key; an uncertain save is checked (`inv_transaction_status`) before anything is sent again.
3. Nothing is deleted. A correction, a replacement, a write-off and a cancellation are new records that name the old one.
4. Custody, owner and place are three facts. A transfer changes the place, a dispatch or an issue changes custody, and nothing in Inventory changes the owner.
5. A condition is never assumed, and a quantity of counted stock is always typed.
