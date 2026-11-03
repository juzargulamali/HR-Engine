# Inventory: receiving another company's equipment (migration #15, PR #56)

**Nothing here has been run on any hosted project.** Migrations 1 to 14 of the launch stack are **already installed and verified** on "Enginious HR Engine_V2"; this is the one new database change (#15). It is installed by the owner, in the SQL Editor, with the pack below; the position in the sequence is in `docs/launch-refinement-install-order.md` (that page wins if the two differ). The batch pack (`supabase/manual-sql/launch_batch_*`) covers 3 to 14 and is **not** changed by this work.

## The owner decision this implements, and nothing broader

> Sharing-authorised receiving-company warehouse operators may view the minimum equipment and transfer information needed to receive and handle stock at their assigned warehouses, including incoming transfers. Preserve the original owner, barcode and serial. Keep costs and unrelated company records restricted. Both authorised sides must be able to trace the same transfer through dispatch and receipt.

It uses the existing Send transfer, In transit, Receive transfer workflow. There is no ownership transfer and no second transfer system: `inv_units.company_id` (the owner), the permanent code and the serial number are never touched, and availability still leaves the sender at send and starts at the receiver only at receipt (and only for good or fair condition).

## Who counts as authorised

* **Sharing authorised** is the existing arrangement (`inv_company_sharing`, made by a founder of the **owning** company, `revoked_at is null`). The existing `inv_check_sharing` checks it when equipment is **dispatched** (unchanged), and it decides which warehouses the Send form offers. **Revoking it stops new dispatches and removes the company's warehouses from the Send form; it never strands equipment already sent** (see "When the owner revokes sharing" below).
* **Dispatched under an authorisation** is read from existing records only, no new table: a transfer line to (or from) the person's warehouse, or a unit or counted quantity that another company owns located at (or in transit to) their warehouse. Every such record exists only because the dispatch passed the sharing check.
* **Operator of an assigned warehouse** is the existing operate right (`inv_can_operate`): a founder of the warehouse's company, or a warehouse operator assigned to that warehouse (or holding cross-location). A view-only person, an inactive person, a person of a third company or of a company with no authorisation, and a signed-out visitor get nothing.
* **The owner's side** is the existing stock-read right (`inv_can_view_stock` of the owning company).

## What becomes visible, to whom (exact fields)

Eleven new functions, all SECURITY DEFINER with a fixed search path; the six public ones are callable by signed-in users only, the five helpers by nobody signed in. **No table, column, policy, trigger or table privilege changes.** Base-table reads (`inv_units`, `inv_transfers`, `inv_costs`, `inv_movements`, ...) are exactly as before: a receiving operator still reads **zero rows** of the owner's tables.

| Function | Returns | To whom |
|---|---|---|
| `inv_xshare_destinations()` | location id, code, name, timezone; its company id and name; the authorising owner company id and name | a person who operates a warehouse of an owning company, for warehouses of **other** companies that owner has authorised. Unauthorised companies' warehouses are never listed. |
| `inv_xshare_units(location, code)` | unit id; **code (barcode)**; **serial number**; item id and name; category name; condition; status (`warehouse` or `transit`); rented or owned flag; **owner company id and name**; place (id, name, company); bin id and code (on the shelf only); transfer id and code (in transit only); usable here (yes or no; no while the sharing is revoked); **sharing revoked (yes or no)** | an operator of the warehouse, for **other companies' active units that are in transit to, or on the shelf at, that warehouse**, also after the owner revoked the sharing. Nothing else of the owner's. |
| `inv_xshare_counted_stock(location)` | item id and name; category; unit of measure; condition; **quantity**; rented or owned flag; status (`warehouse` or `transit`); **owner company id and name**; **place** (warehouse id, name, company); bin id and code (on the shelf only); transfer id and code (in transit only); **sharing revoked (yes or no)** | an operator of the warehouse, for **other companies' counted (quantity-tracked) stock that is in transit to, or on the shelf at, that warehouse**. It reads the existing stock rows as they are (owner company, quantity, warehouse); nothing is allocated or re-owned. Never a cost. |
| `inv_xshare_transfers()` | transfer id, code, status; sender company; from and to warehouse (id, name) and the receiving company; dispatched, expected and received times; carrier and reference; the names of the person who dispatched and of the person who received; number of lines and how many are still on the way; **sharing revoked (yes or no; always no for the owner's own people)** | both sides: the owner's stock readers, and an operator of the origin or destination warehouse (under an active authorisation); only transfers **between different companies** |
| `inv_xshare_transfer_trace(transfer)` | the header above; each unit the dispatch listed (id, code, serial, item, category, owner, rented flag, on the way / at destination, and its condition and custody kind **only while it is still on the way here or there, on the shelf at the origin or destination, or to the owner's own stock readers**); each counted line (item, category, unit, owner, quantity sent, quantity still on the way by condition); the **dispatch and receipt events**, whichever company they are filed under (movement code, time, who recorded it, which company filed it, and per line: unit code or item and quantity, condition before and after) | the same two sides; anyone else is told "Transfer not found" (the same answer as for a transfer that does not exist) |
| `inv_xshare_availability(item, warehouse)` | three counts for that item at that warehouse (`physical_at_location`, `usable_now`, `in_transit`) and `sharing_revoked`, counting only other companies' units the operator may handle (a unit is usable only while the sharing is active) | an operator of that warehouse; any other warehouse is "Location not found". `inv_availability` itself is unchanged. |

## When the owner revokes sharing

Revoking is checked **in the database**, and the answer is returned as a flag (`sharing_revoked`) so the screens never work it out. The screens say **"Sharing revoked—contact owner"** on the incoming transfer in the Receive transfer list and on the transfer trace, on counted stock and units at the person's warehouse (Stock page), and on the unit's minimal record and scan result. The owner's own people never see that message.

| | After the owner revokes |
|---|---|
| New dispatch of that owner's equipment to the revoked company's warehouse | **Refused**, as today, by `inv_check_sharing` (unchanged) |
| The Send form (`inv_xshare_destinations`) | No longer offers the revoked company's warehouses |
| A transfer already in transit to the receiving company | **Still visible to its warehouse operators (header and lines, minimum fields) and still receivable**: `inv_transfer_receive` is unchanged and has no sharing check |
| The owner's equipment already received and sitting at their warehouse (units and counted stock) | **Still visible to those operators**, with the flag, so they can track it. It cannot be issued or sent on from there until the owner authorises sharing again (the existing functions refuse it), and `usable_here` / `usable_now` say so. Authorising again clears the flag. |
| The owner's side | Reads exactly the same trace for both sides; no flag |
| Other owner stock, third companies, companies that never had sharing, inactive, view-only and signed-out people | Nothing, as before |

## Counted (quantity-tracked) stock between companies

Valuable equipment is tracked unit by unit; selected connectors, cards and accessories are counted; cable lengths, screws and minor consumables need no detailed tracking and are not touched. For counted stock the existing records already hold the right facts: dispatch takes the quantity off the sender's shelf into an in-transit row (owner unchanged), receipt moves exactly the quantity received to the receiving warehouse's row (owner still the original company, item and quantity exact; a partial receipt leaves the rest on the way and the transfer open). The only gap was that the receiving operator could not read the result. `inv_xshare_counted_stock` closes it, and the Stock page shows each row as "4 × HDMI cable 5 m · Owned by Enginious UAE · at Riyadh warehouse" (or "on the way to"), in the same section as units, with owner and physical place apart and no cost.

## What stays restricted (never returned by any of them)

Purchase cost, rental cost or any price (those live in `inv_costs`, which the functions never read); supplier and rental supplier data (only a rented/owned flag is returned); notes and photos; employees, projects and requests; the person's own custody details beyond the condition and the custody kind of the units they handle; email addresses; every other unit of the owner (units elsewhere, units going to other warehouses, the owner's catalogue and stock counts); any other company's records; the owner's own movement history of a unit. Transfers between warehouses of the **same** company are not part of this (they keep using the existing policies).

## What the screens do

* **Send transfer:** the destination list also offers warehouses of other companies, named with their company and marked "(authorised)", **only** where the owner of the sending warehouse authorised them (the database function decides; the list never contains an unauthorised company's warehouse). The review step names both warehouses with their company and says the equipment stays the sender's.
* **Receive transfer and Stock (receiving company):** a transfer sent to a warehouse the person operates is listed, with each line's owner ("Owned by Enginious UAE"); receiving goes through the existing receive function. The Stock page shows "Equipment of other companies at your warehouses" (code, serial, item, condition, status, owner) and "Transfers between companies"; scanning a label of such a unit opens a minimal record (no cost, no history).
* **Trace (both sides):** `/inventory/transfers/<id>` shows dispatch, in transit and receipt for the same transfer; the owner's unit record gains a "Transfers to other companies" section with the receipt, which its own history lacks (the receipt is filed under the receiving company).

## Limits to know (reported, not widened)

* The Send form offers other companies' warehouses for equipment **the sending company owns**. A unit owned by a third company and kept in the sender's warehouse is still accepted by the database when both authorisations exist, but the form does not offer it.
* A receiving operator sees units and counted stock only while they are in transit to, or on the shelf at, their warehouse. Once their company issues it onward (to a person or a project), it is no longer theirs to see through these functions.
* Receipt keeps its existing business checks, including that sharing is checked at **dispatch**, not again at receipt: revoking sharing while a unit is on the way does **not** block receiving it, and the receiving operator keeps the minimum view needed to receive and track it (flagged "Sharing revoked—contact owner").
* Counted stock the receiving company has issued onward (to a person or a project) is no longer on its shelf and no longer listed.

## Install (owner-run, in this order; each file in the SQL Editor of V2, the whole file, send back the whole result)

Pack in `supabase/manual-sql/` (prefix `inv_xshare`). Read-only files are SELECT only.

**Migration #15 is applied on V2 (owner-reported: verify 69 checks, 0 failing; preservation compare PASS; 9 schema and 8 table fingerprints unchanged; the 6 protected functions unchanged; exactly 11 functions added). These are the owner's hosted results, not run by Claude.** The notes switch is untouched by it. The order below is kept as the record of what the owner ran. The owner runs, in this order: `inv_xshare_00` (read-only) → `inv_xshare_05` snapshot (read-only) → the migration (**changes the database**) → `inv_xshare_20` verify (read-only) → `inv_xshare_05` compare (read-only).

1. `inv_xshare_00_preflight_readonly.sql` (read-only): section B must say OK and "not applied yet".
2. `inv_xshare_05_preservation_check_readonly.sql` (read-only), **snapshot run**: keep the whole `paste` column.
3. Run the migration once: `supabase/migrations/20261218000100_inv_cross_company_receiving.sql` (**changes the database**: adds eleven functions, no table, row or policy; safe to run twice).
4. `inv_xshare_20_verify_readonly.sql` (read-only): last row `OK … 0 failing`.
5. `inv_xshare_05_preservation_check_readonly.sql` again with the pasted lines (read-only), **compare run**: summary starts `PASS`.
6. `inv_xshare_90_rollback.sql` is **not** part of an install. It **changes the database**: it drops the eleven functions (nothing else). Read its header first.

A first real use on V2 needs a second company's warehouse and a real transfer; the repository's database tests and the local browser flow (`apps/web/os-shell-checks/inventory-transfer-location-flow.mjs`) prove the behaviour. Do not create test stock on V2 for it.

## Compatibility with the current Production code

**Production code compatibility:** migration #15 alone changes nothing the current `main` application (and #53 to #55) reads or writes: it adds functions only, so the old code is unaffected. The whole existing Inventory database suites pass on a database built with it (listed in the PR description), the preservation check shows the dispatch, receive, sharing-check and availability functions byte-identical, and the new application treats a missing function as "not installed" (no section, no error), so the application can also be released before the database change.
