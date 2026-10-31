# Inventory for everyday warehouse use: review, screen map, concept (Stage A) and the live screens (Stage B)

> **STATUS: Stage B is implemented on the existing backend.** The Stage A concept (fictional data, `/os-preview/inventory`, hidden in Production by the existing preview gate) was approved with conditions; Stage B connects the approved interface to the existing actions. **No database migration, no new function, no hosted SQL, no change to any permission, to the stock ledger, to reservation or availability rules, or to recovery scripts.** Section 11 says what was built, what was verified and what the backend cannot do. Sections 1 to 10 are the Stage A review and concept as they were approved; where Stage B differs, section 11 wins.

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

## 9. Questions for the approval (answered by the owner; see section 11)

1. **Employee equipment:** the concept leaves it on its current pages. The proposal is a *Give equipment* action in Stock (person → equipment → review → confirm) and *With people* as a list in Stock. Agree?
2. **Reserve all:** leave it out for now (recommended), or propose the single-transaction function as a separate change?
3. **Stock rows:** one visible *Receive* per row, other actions under *More*. Acceptable, or would you rather have *Send* when nothing is available?

## 10. Stage A progress (as approved)

Steps 1 to 5 were completed and approved. Stage B is section 11.

## 11. Stage B: the live screens

### What changed for the people using it

| Before | Now |
|---|---|
| `/inventory` was the stock list | `/inventory` is **Today** (one row per job). The list is **Stock** at `/inventory/stock`. |
| Requests, Movements, Scan, Equipment held by employees, five movement buttons in the header | **Today / Stock / History** in the menu; **Setup** under Manage. Scanning is the **Scan a label** button in the warehouse bar; who holds what is **With people** inside Stock; sending, returning and transferring happen where they belong (below). |
| No default warehouse, no switcher | The warehouse bar says **You are working in …** on Today and Stock. It starts at the person's own warehouse (or all warehouses for people who cannot operate anywhere), offers a switcher only when there is a choice, and remembers the choice. |
| Dispatch and return were forms on another page that started empty | One **request workspace** (`/inventory/requests/<id>`): **1 Prepare, 2 Send out, 3 Receive back**, with the request, warehouse, booking window, dispatch date and expected return carried through. |
| "Rented, not owned?" was a collapsed checkbox at the bottom of the receive form | **Owned or Rented** is a visible, explicit choice at the top (neither is pre-selected: rented stock never adds to what the company owns, so it is never assumed). |

### The screens

* **Today** (`/inventory`): rows for requests to prepare or send, equipment due back (projects and people), transfers on their way here, and Sales checks, grouped Late / Today / Next 7 days / Later / Waiting, using each record's own date. A request is **one** row whichever step it is at (Send equipment when something reserved is unsent and its dispatch date has come, otherwise Prepare equipment). Each source loads on its own: if one fails, a red banner names it and its filter shows "?", never an empty queue. Sales checks reuse the existing record-the-check dialog (labelled **Check availability**), show only the reference, dates and equipment, and are separate from reservations. Equipment out on a project or with a person is listed only when it has a recorded expected return date; counted stock out has no warehouse, so with one warehouse chosen it is not listed (it appears under All warehouses).
* **Stock** (`/inventory/stock`): **Receive stock** and **Give equipment** above the list; a compact default list (Item, Available, Out, Reserved); a row opens the item's details, where the actions for that item live (Receive stock, Give to a person, Move to another warehouse, **Send to a project (not from a request)** with its explanation, check condition, repair, missing, retire). Counted stock that is out shows **"—"** with its reason, never a guess. **With people** is the existing equipment-held-by-employees list with **Give equipment** and **Receive returns** per person. Old `/inventory/employees` links land there.
* **History** (`/inventory/history`): the same ledger, renamed; `/inventory/movements` redirects with its parameters.
* **Request workspace**:
  * **Prepare**: the existing lines editor (reserve with automatic or named units, partial results accepted, buy or rent, substitutes decided by the Project Manager), without the sent/returned columns. There is **no "Reserve all"** (not built, not shown disabled).
  * **Send out**: reserved equipment is listed and **nothing is ticked**; scan or type a code, tick units, count counted stock, send part. Flags **before** confirmation: a code not reserved for the request, or more than reserved, blocks (the database would refuse it); sending part warns. It uses the existing dispatch function with the request, the existing review and confirm, one key per entry, single flight and "check whether it went through". **Unplanned dispatch** is a separate boxed section that says it does **not** fulfil the request, shows as "not part of a request" and cannot use reserved equipment.
  * **Receive back**: starts from what the **project** is recorded as holding; nothing is ticked; a **condition is required** for everything received; good (or fair, for units) becomes available again, damaged or "needs checking" is held; what is not listed stays out. Uses the existing return function.

### What the backend cannot do, and what the screens therefore say (no workaround)

1. **A return carries no request or request line.** `inv_return_from_project` takes a project and lines; `inv_reservation_return` matches by project, item and unit. A **unit** return is exact (the unit is named). A **counted** return is exact only for the project and the item. So Receive back shows **Sent** (exact, the dispatch names the request) and **Still out** (exact, what the project holds), and shows **Returned for this request only when nothing else could have been returned in its place** (one line, no other request sent the item, and the project holds exactly what this request sent minus what it got back). Otherwise the row is marked **Project level**, Returned shows "—", and the screen says why. Nothing is guessed. *Not changed:* the request panel and the project's Equipment page still show their per-line Returned and Outstanding columns for counted stock, as before; they read the same reservation counters. A fix would need a migration (a line reference on movement lines and on the return function); it is not proposed here.
2. **Reserve all** would be a loop over `inv_reserve`, which is not atomic; left out as agreed.
3. **An unplanned dispatch recorded against the request, with a reason** needs a migration; the screen offers only today's exception (no request).
4. **How many are "short" on Today** needs an availability call per line; Today says "still to reserve", not "short" (the Prepare step shows the database's own shortage per line).
5. **Counted stock held by projects or people has no warehouse** (`inv_bal_ensure` sets a location only for warehouse holders), so a per-warehouse Out is unknown for it and says so.

### Permissions and protections (unchanged, re-checked)

The database still checks every movement (`inv_loc` on the location, `inv_can_operate`), RLS decides what each person sees, and the screen only decides what to offer: Project Managers see Prepare but no send or receive controls, plain employees are sent to My equipment and cannot open the workspace, custody readers see With people but no stock-changing button, and people with no Inventory access are told so. Reservations never dispatch anything; availability and the preparation and inspection buffers (the booking window runs from the earliest to the latest planning date) are untouched. Recovery scripts are untouched.

### Where the old addresses go

`/inventory?action|open|unit|codes|bin|…` (printed QR labels, bookmarks, links from requests) → `/inventory/stock?…` with every parameter kept; `/inventory/movements` → `/inventory/history`; `/inventory/employees` → `/inventory/stock?view=people`; `/inventory/scan?c=CODE` is unchanged; `/inventory/requests` stays (Project Managers' list, and the way to browse every request); a request panel offers **Open the workspace**.

### Verification

| Check | Result |
|---|---|
| `tsc --noEmit`, `eslint` (apps/web) | clean |
| Unit and component tests (apps/web, whole suite) | 1,386 passed. New or changed: working-location rules, legacy redirects, Today rules and page, the workspace's send flags / Sent-Returned-Still-out attribution / return outcomes, Send out and Receive back components, the owned-or-rented choice, the Stock page, the item panel, navigation |
| `inventory-workspace-flow.mjs` (real browser, real screens, throwaway PostgREST + Postgres built from the migrations) | 23 of 23: Today, the warehouse named, Prepare, reserving sends nothing, Send out (unreserved code blocks, partial warns, recorded against the request, one dispatch), Receive back (project-level counted totals, condition required, good available again, damaged held), owned and rented receipts, the item panel's actions, redirects, the switcher kept across screens, Project Manager, employee, custody reader and no-access people, and the database refusing an unreserved dispatch |
| Earlier browser flows (`inventory-flow-1…5`), pointed at the new addresses and button names (their steps and assertions are otherwise unchanged) | flow 1 (stock to reconcile) 26 of 26; flow 2 (employee equipment) 13 of 13; flow 3 (Sales checks) 16 of 16; flow 4 (transfers and conflicts) 31 of 31; flow 5 (access) 57 of 57 |
| `inventory-a11y.mjs` (axe, keyboard, outage) with Today and the workspace's three steps added | axe finds no serious or critical issue on 26 Inventory pages in desktop and phone, dark and light; the keyboard dispatch check passes; while the data service is down every Inventory page checked (Stock, With people, Requests, History, Manage, My equipment, Today, the workspace) says it could not load rather than showing an empty list. **One check still fails and is outside Inventory:** `/people-access` has no outage wording (the page was not changed here) |
| Real-screen screenshots | `docs/inventory-simplification-screenshots/live/` (Today, the three workspace steps, Stock, Receive stock with the owned/rented choice, With people; desktop and phone, dark and light) |
| Not run | the hosted (Production) checks: no hosted SQL was run and nothing was deployed from here |

### Progress

| # | Step | State |
|---|---|---|
| 1 | Current-flow review | Verified |
| 2 | Simplified screen map | Verified |
| 3 | Interactive concept | Verified |
| 4 | Visual and usability checks | Verified (concept) |
| 5 | Owner approval | Done: approved with conditions |
| 6 | Live implementation | Implemented |
| 7 | Targeted verification | Verified as in the table above |
| 8 | Draft PR and deployment instructions | See the pull request |
