# Inventory for everyday warehouse use: review, screen map and concept (Stage A)

> **STATUS: Stage A, an interactive concept with fictional data. Nothing here is connected to real records.** No database change, no migration, no hosted SQL, no change to any existing Inventory page. The concept lives in the design preview (`/os-preview/inventory`), which is hidden in Production by the existing preview gate. **Stage B (connecting the approved interface to the existing actions) starts only after the owner approves this.**

The aim: a warehouse manager can receive stock, prepare a project, dispatch equipment and record a partial return without understanding the database or searching through several unrelated screens. Nothing is rebuilt: the redesign calls the same server actions and database functions that already work.

## 1. What the current system does (traced from the code on `main`)

| Flow | How it works today | What makes it hard |
|---|---|---|
| **Sales availability check → warehouse response** | Sales asks from the enquiry (`inv_request_opportunity_check`). The warehouse sees pending checks in *Sales checks waiting* on `/inventory/requests` (`inv_pending_sales_checks`: reference, dates, equipment name and quantity only; no client, value or notes). *Record the check* (`inv_record_opportunity_check`) asks for a location and an optional note; the database computes available / partial / short / check required from live stock. A check never touches a reservation. | It sits under Requests, not where the warehouse starts. The button says "Record the check", which is not plain. A missing location has to be chosen again. |
| **Project equipment: request → reserve → dispatch → return** | Prepare and reserve are in the request editor (`/projects/[id]/equipment` or `/inventory/requests?open=`), one *Reserve* dialog per line (`inv_reserve`: automatic free units, or specific units; partial results accepted; shortage action buy/rent; substitutions decided by the Project Manager). *Dispatch* and *Record a return* are separate side panels on a different page (`/inventory?action=dispatch|return&request=…&project=…`, `inv_dispatch_to_project`, `inv_return_from_project`). | Three different screens for one job. The dispatch form opens **empty** (the operator searches or scans everything again). Return defaults every line to "good". A discrepancy is only a server error. |
| **Receiving new stock** | `/inventory?action=receive` → one 16-kind movement form → Review → Confirm (`inv_receive_stock`, idempotency key, form kept on error). | The generic form shows bin, condition, cost, currency and a "Rented, not owned?" panel for every receipt. A new item type needs a separate Quick Add trip. Jargon ("individually tracked", "counted stock"). |
| **Employee equipment** | Issue starts from a location and a catalogue search (`inv_issue_to_employee`), return from the Employees page (`inv_return_from_employee`). | There is no *Give equipment* button where the person is listed; "Issue / Dispatch" share one menu. |
| **Transfers** | Send (`inv_transfer_dispatch`), then the destination confirms (`inv_transfer_receive`, partial arrival supported: the rest stays on its way). | Receiving is one of five toggles inside the Transfer panel; the warehouse cannot see what is on its way without opening it. |

Navigation today: **Inventory** (stock list with side panels), **Requests**, **Movements**, then My equipment, Scan a label and Equipment held by employees, and **Setup** under Manage. Scan exists twice (a side panel and a page with different resolvers). There is no default location and no switcher: the location is a per-page `?location=` filter.

## 2. The simplified screen map

Operators get three sections. Everything else is under **Manage**, and access stays in **People & Access**.

| Section | What belongs here | Built from (existing) |
|---|---|---|
| **Today** | Work waiting for *this* warehouse, one row per job: requests to prepare, dispatches due, returns due or late, incoming transfers, Sales checks. | `inv_requests` + `inv_request_lines` + `inv_reservations`; `inv_units` / `inv_balances` `expected_return_at`; `inv_transfers`; `inv_pending_sales_checks` |
| **Stock** | Search, scan, view equipment, **receive new stock**; compact list *Equipment / Available here / Out / Reserved / Action*. | `loadStockList`, `recordMovement(receive)`, `searchStock`, `resolveScan` |
| **History** | Recorded movements and their details; corrections stay where they are. | `movements` page, `loadMovementDetail`, `inv_correct_movement` |
| **Manage** | Catalogue, technology templates, opening stock, stock counts, repairs, corrections, earlier asset register. Shown only to people who hold the existing permission for each. | `/inventory/manage` and the existing panels |
| *(People & Access)* | Who may do what in Inventory. Unchanged. | `/people-access` |

**Where the old addresses go (Stage B, redirects kept):** `/inventory` becomes Today; the old stock list moves to `/inventory/stock` and keeps every `?action=`, `?open=`, `?unit=`, `?codes=` deep link working; `/inventory/requests` → Today (and a request opens its project workspace); `/inventory/movements` → History; `/inventory/scan` and `?c=CODE` keep working (the QR address is unchanged); `/inventory/employees` and `/inventory/mine` stay reachable.

**Default location and switcher.** The operator opens in their authorised warehouse (`inv_operator_locations`; founders and cross-location operators have all). With several, a switcher is always visible; with one, a plain label. The page always says **You are working in …**. The choice is remembered per person in the app layer (no database change).

## 3. Today: every row answers four questions

*What needs doing? For which project or person? When? What is the next action?*

| Row | Real source | Date shown | Button |
|---|---|---|---|
| Equipment overdue from a project | project custody: `expected_return_at` in the past | the recorded return date and days late | **Receive returns** |
| Equipment still to send | request with reservations where dispatched < reserved | the request's dispatch date | **Send equipment** |
| Reservations to make | request with a shortage (qty − reserved for the window) | the request's dispatch date | **Prepare equipment** |
| Person's items due back | `inv_employee_outstanding` | the recorded return date | **Receive returns** |
| Transfer on its way | `inv_transfers.status = 'in_transit'` to this warehouse | `expected_at` | **Receive transfer** |
| Sales check | `inv_pending_sales_checks` | none (a check has no deadline); asked date and event dates are shown | **Check availability** |

Rules the concept follows: groups are **Late / Today / Next 7 days / Later / Waiting, no date set**, derived only from a record's own date. No readiness state, deadline or figure is invented. A row opens its workspace from the empty part; the button inside works on its own. If one source fails to load, a red banner says so and that filter shows `?`, never an empty queue. A job appears once.

## 4. One project equipment workspace: Prepare → Send out → Receive back

Working views of the **same** request and reservations (no new workflow, status or approval). The request, warehouse, booking window, dispatch date and expected return stay visible; the eight planning dates are under **More dates**; the booking window is earliest-to-latest, so preparation and inspection time stay in the availability calculation.

* **Prepare**: needed / reserved / short per line, a **Reserve** dialog (automatic free-unit selection, or choose specific units; partial result accepted, as `inv_reserve` does), a shortage note (buy / rent), and a *Suggest substitute* only on short lines that have a template alternative (the Project Manager decides).
* **Send out**: project, warehouse and expected return carried forward; the **reserved** units are listed, **nothing is ticked for you** (reserved is not sent); scan or type a code to tick a unit; counted lines take a counted quantity; partial dispatch is normal. **Flags before confirmation**: a code not reserved for the request or more than reserved **blocks** (the existing function would refuse it); sending fewer than reserved **warns**. *Send something that is not on this request* is a clearly labelled exception.
* **Receive back**: starts from what is outstanding, shows **Sent / Returned / Still out**, nothing ticked, a **condition is required** for everything received, and each line says whether it becomes **Available again** (good, or fair for units) or **Held** (needs checking, damaged, cannot be used). Items not in the entry stay out and are said to.

## 5. What the existing backend cannot do yet

The concept marks these with **Needs a backend change**. Everything else uses what exists. **No migration is proposed or needed for Stage B unless you choose one of these.**

| Wish | Today | What it would take | Recommendation |
|---|---|---|---|
| **Reserve all open lines** in one step | Only `inv_reserve` per line. | An app-layer loop is possible but **not atomic** (each line commits on its own, a failure half-way leaves some lines reserved). A safe bulk reserve would be one new database function that reserves all lines in one transaction. | Not built. Propose separately if wanted. |
| **Record an unplanned dispatch against the request, with a reason** | The only exception path is dispatching **without** the request (it then shows as "not part of a request", and equipment reserved by any request cannot be sent this way). | A migration: let `inv_dispatch_to_project` accept unreserved items for a request, write `exception_note`, and say what happens to reservation counters. | The concept offers today's path only and labels it. |
| **Dispatch note per line** | `inv_movement_lines.exception_note` exists but dispatch never writes it. | A small change to the dispatch function. | Not needed for Stage B. |
| **Returns attributed to a request line** | A return carries no request; `inv_reservation_return` matches by project and item. Two lines of one request with the same item are ambiguous. | A migration adding a line reference to movement lines and `inv_return_from_project`. | Rare in practice; accept the limit for now. |
| *Not a backend change:* the flags before confirmation, carrying the request into Send out, Sent / Returned / Still out (`inv_project_equipment` already returns it), default location and switcher, the Today queue, Sales check wording | These are app-layer reads and comparisons over existing records. | none | Built in Stage B. |

## 6. Forms and stock information

Only the fields for the current action show; known values are prefilled and the context stays visible. **Receive new stock** is *What arrived → How many → Where it goes → Check and confirm*: serial numbers, condition, note and "rented, not owned" are under **More details**; how an item is tracked is decided once in the catalogue, so the operator is never asked about it. The existing idempotency key, single-flight confirm, "check whether it went through" and kept-form-on-error behaviour (`useMovementFlow`) are reused unchanged.

**Stock** uses the compact list; **counted stock that is out with people or on projects is not split by warehouse, so Out shows `—` with a reason, never a guess** (the existing rule, now with a clearer explanation than "Not shown to you"). Scanning only finds the record and offers what its state allows (a unit in repair offers no send); it never changes stock. No item photos are required.

## 7. What is preserved

Stock ledger and movement history; reservation conflicts and the availability calculation (including preparation and inspection time); company and location permissions (the database still checks `inv_loc` on every movement); individual-unit versus counted-stock rules; employee custody, kits, consumables and rentals; idempotency, audit and the correction rules; the Sales checks inbox and its restrictions (no client, value or notes); Sales, Projects and HR boundaries. Reservation never dispatches anything.

## 8. How to view the concept

Run the app with the preview enabled (`OS_PREVIEW_ENABLED=1`, or any Vercel **preview** deployment) and open `/os-preview/inventory`. Useful switches: `?loc=auh` (Abu Dhabi, almost empty), `?single=1` (one warehouse, no switcher), `?fail=transfers` (one source failed), `?state=loading|empty|error|denied` (the shared states). Try: Today → *Prepare equipment* (Gulf Bank Summit), *Send equipment* (Al Khail Roadshow: scan `WM-0099`, then tick `PJ-0403`), *Receive returns* (Dubai Expo Pavilion), Stock → *Receive stock*, *Scan a label* with `WM-0016`.

Checks: `apps/web/os-shell-checks/inventory-concept-checks.mjs` (browser: 128 checks across desktop and phone in dark and light, including axe, no sideways scroll and console errors) and `os-preview/_lib/inventory-concept.test.ts` (20 unit tests for the concept's rules and for the sample data matching the Today rows). Screenshots: `docs/inventory-simplification-screenshots/` (desktop and phone, dark and light).

## 9. Questions for the approval

1. **Employee equipment:** the concept leaves it on its current pages. The proposal is a *Give equipment* action in Stock (person → equipment → review → confirm) and *With people* as a list in Stock. Agree?
2. **Reserve all:** leave it out for now (recommended), or propose the single-transaction function as a separate change?
3. **Stock rows:** one visible *Receive* per row, other actions under *More*. Acceptable, or would you rather have *Send* when nothing is available?

## 10. Progress

| # | Step | State |
|---|---|---|
| 1 | Current-flow review | **Verified** (traced from the code; section 1) |
| 2 | Simplified screen map | **Verified** (section 2; reviewed against the current navigation and permissions) |
| 3 | Interactive concept | **Verified** (built; 20 unit tests and 128 browser checks pass) |
| 4 | Visual and usability checks | **Verified** (desktop and phone, dark and light, screenshots inspected; axe clean) |
| 5 | Owner approval | **Waiting for you** |
| 6 | Live implementation | Not started (after approval) |
| 7 | Targeted verification | Not started |
| 8 | Draft PR and deployment instructions | Not started |

**4 of 8 verified. Current task: step 5, waiting for your approval. No blocker.**
