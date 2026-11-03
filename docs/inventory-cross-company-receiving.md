# Inventory: receiving another company's equipment (migration #15, PR #56)

**Nothing here has been run on any hosted project.** Migrations 1 to 14 of the launch stack are **already installed and verified** on "Enginious HR Engine_V2"; this is the one new database change (#15). It is installed by the owner, in the SQL Editor, with the pack below; the position in the sequence is in `docs/launch-refinement-install-order.md` (that page wins if the two differ). The batch pack (`supabase/manual-sql/launch_batch_*`) covers 3 to 14 and is **not** changed by this work.

## The owner decision this implements, and nothing broader

> Sharing-authorised receiving-company warehouse operators may view the minimum equipment and transfer information needed to receive and handle stock at their assigned warehouses, including incoming transfers. Preserve the original owner, barcode and serial. Keep costs and unrelated company records restricted. Both authorised sides must be able to trace the same transfer through dispatch and receipt.

It uses the existing Send transfer, In transit, Receive transfer workflow. There is no ownership transfer and no second transfer system: `inv_units.company_id` (the owner), the permanent code and the serial number are never touched, and availability still leaves the sender at send and starts at the receiver only at receipt (and only for good or fair condition).

## Who counts as authorised

* **Sharing authorised** is the existing arrangement (`inv_company_sharing`, made by a founder of the **owning** company, `revoked_at is null`). Revoke it and the access ends at once.
* **Operator of an assigned warehouse** is the existing operate right (`inv_can_operate`): a founder of the warehouse's company, or a warehouse operator assigned to that warehouse (or holding cross-location). A view-only person, an inactive person, a person of a third company or of a company with no authorisation, and a signed-out visitor get nothing.
* **The owner's side** is the existing stock-read right (`inv_can_view_stock` of the owning company).

## What becomes visible, to whom (exact fields)

Eight new functions, all SECURITY DEFINER with a fixed search path; the five public ones are callable by signed-in users only, the three helpers by nobody signed in. **No table, column, policy, trigger or table privilege changes.** Base-table reads (`inv_units`, `inv_transfers`, `inv_costs`, `inv_movements`, ...) are exactly as before: a receiving operator still reads **zero rows** of the owner's tables.

| Function | Returns | To whom |
|---|---|---|
| `inv_xshare_destinations()` | location id, code, name, timezone; its company id and name; the authorising owner company id and name | a person who operates a warehouse of an owning company, for warehouses of **other** companies that owner has authorised. Unauthorised companies' warehouses are never listed. |
| `inv_xshare_units(location, code)` | unit id; **code (barcode)**; **serial number**; item id and name; category name; condition; status (`warehouse` or `transit`); rented or owned flag; **owner company id and name**; place (id, name, company); bin id and code (on the shelf only); transfer id and code (in transit only); usable here (yes or no) | an operator of the warehouse, for **other companies' active units that are in transit to, or on the shelf at, that warehouse** under an active authorisation. Nothing else of the owner's. |
| `inv_xshare_transfers()` | transfer id, code, status; sender company; from and to warehouse (id, name) and the receiving company; dispatched, expected and received times; carrier and reference; the names of the person who dispatched and of the person who received; number of lines and how many are still on the way | both sides: the owner's stock readers, and an operator of the origin or destination warehouse (under an active authorisation); only transfers **between different companies** |
| `inv_xshare_transfer_trace(transfer)` | the header above; each unit the dispatch listed (id, code, serial, item, category, owner, rented flag, on the way / at destination, and its condition and custody kind **only while it is still on the way here or there, on the shelf at the origin or destination, or to the owner's own stock readers**); each counted line (item, category, unit, owner, quantity sent, quantity still on the way by condition); the **dispatch and receipt events**, whichever company they are filed under (movement code, time, who recorded it, which company filed it, and per line: unit code or item and quantity, condition before and after) | the same two sides; anyone else is told "Transfer not found" (the same answer as for a transfer that does not exist) |
| `inv_xshare_availability(item, warehouse)` | three counts for that item at that warehouse (`physical_at_location`, `usable_now`, `in_transit`), counting only other companies' units the operator may handle | an operator of that warehouse; any other warehouse is "Location not found". `inv_availability` itself is unchanged. |

## What stays restricted (never returned by any of them)

Purchase cost, rental cost or any price (those live in `inv_costs`, which the functions never read); supplier and rental supplier data (only a rented/owned flag is returned); notes and photos; employees, projects and requests; the person's own custody details beyond the condition and the custody kind of the units they handle; email addresses; every other unit of the owner (units elsewhere, units going to other warehouses, the owner's catalogue and stock counts); any other company's records; the owner's own movement history of a unit. Transfers between warehouses of the **same** company are not part of this (they keep using the existing policies).

## What the screens do

* **Send transfer:** the destination list also offers warehouses of other companies, named with their company and marked "(authorised)", **only** where the owner of the sending warehouse authorised them (the database function decides; the list never contains an unauthorised company's warehouse). The review step names both warehouses with their company and says the equipment stays the sender's.
* **Receive transfer and Stock (receiving company):** a transfer sent to a warehouse the person operates is listed, with each line's owner ("Owned by Enginious UAE"); receiving goes through the existing receive function. The Stock page shows "Equipment of other companies at your warehouses" (code, serial, item, condition, status, owner) and "Transfers between companies"; scanning a label of such a unit opens a minimal record (no cost, no history).
* **Trace (both sides):** `/inventory/transfers/<id>` shows dispatch, in transit and receipt for the same transfer; the owner's unit record gains a "Transfers to other companies" section with the receipt, which its own history lacks (the receipt is filed under the receiving company).

## Limits to know (reported, not widened)

* The Send form offers other companies' warehouses for equipment **the sending company owns**. A unit owned by a third company and kept in the sender's warehouse is still accepted by the database when both authorisations exist, but the form does not offer it.
* A receiving operator sees a unit only while it is in transit to, or on the shelf at, their warehouse. Once their company issues it onward (to a person or a project), it is no longer theirs to see through these functions.
* Receipt keeps its existing business checks, including that sharing is checked at **dispatch**, not again at receipt: revoking sharing while a unit is on the way hides it from the receiving operator (they can no longer see or find it) but does not change the receive function.

## Install (owner-run, in this order; each file in the SQL Editor of V2, the whole file, send back the whole result)

Pack in `supabase/manual-sql/` (prefix `inv_xshare`). Read-only files are SELECT only.

1. `inv_xshare_00_preflight_readonly.sql` (read-only): section B must say OK and "not applied yet".
2. `inv_xshare_05_preservation_check_readonly.sql` (read-only), **snapshot run**: keep the whole `paste` column.
3. Run the migration once: `supabase/migrations/20261218000100_inv_cross_company_receiving.sql` (**changes the database**: adds eight functions; safe to run twice).
4. `inv_xshare_20_verify_readonly.sql` (read-only): last row `OK … 0 failing`.
5. `inv_xshare_05_preservation_check_readonly.sql` again with the pasted lines (read-only), **compare run**: summary starts `PASS`.
6. `inv_xshare_90_rollback.sql` is **not** part of an install. It **changes the database**: it drops the eight functions (nothing else). Read its header first.

A first real use on V2 needs a second company's warehouse and a real transfer; the repository's database tests and the local browser flow (`apps/web/os-shell-checks/inventory-transfer-location-flow.mjs`) prove the behaviour. Do not create test stock on V2 for it.

## Compatibility with the current Production code

Migration #15 alone changes nothing the current `main` application (and #53 to #55) reads or writes: it adds functions only. The whole existing Inventory database suites pass on a database built with it (listed in the PR description), the preservation check shows the dispatch, receive, sharing-check and availability functions byte-identical, and the new application treats a missing function as "not installed" (no section, no error), so the application can also be released before the database change.
