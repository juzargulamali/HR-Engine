# Inventory: module reference (Phase 1: one project equipment job)

**Status (2026-11-16).** Written for **Inventory Phase 1** on branch `claude/inventory-phase-1` (from `main` `fd36b84`): **draft, not merged, required CI not yet run, hosted SQL not applied, Production not deployed.** Code read and run locally at the branch head; nothing hosted was touched by Claude. This file documents, against the implementation, **only the paths Phase 1 touches**. Everything in section 9 is deliberately **not yet documented in detail** (Phase 2).

Paths are relative to the repository root; `web/` means `apps/web/src/`. Migration `P1` means `supabase/migrations/20270114000100_inv_phase1_job_flow.sql`.

## 1. What Phase 1 is

One project equipment job that is easy to complete from **Sales availability check, Project Plan, Send to Warehouse, reserve, pick, dispatch, return and inspect**, on top of the Inventory module that already existed. The stock ledger (`inv_movements`, `inv_movement_lines`), the stock rows (`inv_units`, `inv_balances`), the requests (`inv_requests`, `inv_request_lines`) and the reservations (`inv_reservations`) stay the **only source of truth**. Every status the screens show ("short", "partly sent", "still out", "held") is **derived** from them (`inv_request_state`, `20270102000100_ops_phase2b.sql:669`; `inv_run_cover_rows`, `P1:189`); none is stored twice.

## 2. Company and warehouse names (what the labels are)

| Label on screen | Where it comes from | Source |
|---|---|---|
| A company name such as "Enginious LLC" or "Enginious Dubai–Europe" | `companies.legal_name`: the **legal name** of a company row. Every module read it directly, so the selector showed legal names | `web/lib/inventory/context.ts` (before this change), `20260922000000_phase0_foundations.sql:60` |
| "Enginious UAE", "Enginious Saudi Arabia", "Enginious Europe" (new) | A **display name worked out from the company's country** (`companies.country_code`): AE, SA, a European country. Nothing is stored and nothing is renamed. Two companies in the same group, or a company in a country outside the list, keep their legal names, so two companies never share a short name | `web/lib/company-display.ts:17,27`; used at `web/lib/inventory/context.ts:80` |
| A warehouse name such as "Dubai" | `inv_locations.name`, a location of ONE company (`inv_locations.company_id`), kind `warehouse`, `office` or `other` | `20261201000100_inv_catalogue_stock_ledger.sql` |
| "All warehouses" / "All companies" | A **viewing filter** only (`location=all` in the address): the Today and Stock loaders then read every location the person may see. No form posts against it: every stock function takes one company and one location | `web/lib/inventory/working-location.ts`; `web/components/inventory/warehouse-bar.tsx:51` |

* The country rule is the one the app already used for the three companies: the Sales chat groups (UAE = AE, KSA = SA, Europe = the one European company, `docs/chat-deployment.md`) and the follow-up time zones (`20270112000500_crm_follow_up_time_zone.sql`).
* **Which hosted company carries which legal name is `Unverified`** (Claude cannot read the hosted database). The owner pack's preflight prints every active company with its legal name, country and the short name it will get (`supabase/manual-sql/inv_phase1_job_flow_00_preflight_readonly.sql`, row 8).
* The legal name stays in **Inventory setup, company settings** ("<legal name> (shown as <short name>)", `web/app/(app)/inventory/manage/page.tsx`) and on documents (dispatch and return notes are frozen payloads made in SQL and are untouched).
* **No reset is needed and none is prepared.** A display fix was enough: no Inventory table, setting or record was changed or deleted.
* Sales (`web/lib/crm/active-company.ts`), Projects and Operations (`web/lib/operations/company.ts`) still show legal names. Only the Inventory selectors and screens use the short names in this phase (see section 10, open decisions).

Selector as built (`web/components/inventory/warehouse-bar.tsx`): with more than one company the person chooses the **company** first, then a **warehouse inside it**; with one company there is the warehouse chooser only, with the company named beside it. The choice is kept in the address (`?location=`) and remembered in a cookie (`inv_warehouse`); the database checks the location on every movement (`inv_loc`). Today shows "<company> · <warehouse>" under its heading (`web/app/(app)/inventory/page.tsx:83`) and the job shows it in its header (`web/components/inventory/workspace/workspace-header.tsx`).

## 3. The seven steps: what is reused, what is extended, what is new and the gap it closes

| Step | Reused unchanged | Extended (app only) | New, and the specific gap |
|---|---|---|---|
| **Sales availability check** | `inv_request_opportunity_check`, `inv_record_opportunity_check`, `inv_opportunity_availability` (`20261201000400_inv_planning_functions.sql:1602,1637,1685`); the check already records the technologies and quantities, the warehouse and the three dates in `inv_availability_checks.covers` and `location_id`, reserves nothing, and reads "out of date" when the enquiry changes | The card shows **"Availability checked · stock not reserved."**, the date and person, the warehouse and the **proposed dates checked** (`web/components/inventory/planning/sales-card-view.tsx:49`; `checkCoversRange`, `web/lib/inventory/planning.ts:501`) | `inv_opportunity_check_locations` (`P1:335`). Gap: Sales cannot read `inv_locations`, so the person asking could not name the warehouse; the function gives the asker the **names** of the active warehouses of the enquiry's company and nothing else |
| **Won-job handover** | The handover and its acceptance; the draft request imported from the handover (`inv_import_handover_internal`); the project keeps `crm_opportunity_id` | A panel **Availability check from Sales** on the project's Equipment tab (`web/components/inventory/job-panels.tsx`) | `inv_project_sales_check` (`P1:280`). Gap: only Sales and the warehouse could read a check; the people who run the project could not. It returns the check as Sales saw it and a derived **review** list (date, quantities, warehouse changed since); the check row is never edited |
| **Project equipment planning** | `proj_dp_lines.supply_route` (`inventory`, `buy`, `rent`, `client`) and `inv_item_id`, the release to the draft request, "Needs stock match" (`20270104000100_proj_project_plan_r1.sql`; `web/lib/projects/delivery-plan/insights.ts`) | The route reads **From stock / Buy / Rent / Client supplied** (`web/lib/projects/delivery-plan/model.ts:24`); an unmatched From stock line has a **Match to stock** button that opens the same line form, where the description and quantity stay as they are (`web/components/projects/delivery/delivery-plan-view.tsx:122`) | Nothing |
| **Send to Warehouse** | `inv_save_request_plan`, `inv_change_request_window`, `inv_submit_request`; the plan's `dispatch` and `return_due` dates; the Site schedule (`proj_plan_items`, plan `site`) | **Leaves warehouse** and **Due back** are the two dates of the main form, the other six are under More dates; the site runs are ticked; dates are **suggested** from the ticked runs and applied only by "Use these dates"; each ticked run reads Covered or why not (`web/components/inventory/planning/plan-form.tsx`; `web/lib/inventory/runs.ts:61,77`). The button reads **Send to Warehouse** | Table `inv_request_runs` and `inv_set_request_runs` (`P1:135,153`). Gap: a request could not say which site runs it serves (a shipment links one request to one run and is a transport leg, not "this equipment serves these runs") |
| **Warehouse Today** | The six sources and their loaders, one row per job (`web/lib/inventory/today-data.ts`) | Three sections **Do now / Coming up / Waiting on someone else** (`sectionOf`, `web/lib/inventory/today.ts:490`); each request row goes to its next action (Prepare, Pick, Send); a shortage says **how many are missing, of how many, and who acts** (`waitingRow`, `:256`); a request without dates waits on the Project Manager; company and warehouse named | Nothing |
| **Reserve, pick and dispatch** | `inv_reserve` (short reservation with a buy or rent mark), `inv_dispatch_to_project` (partial dispatch, idempotent), bins on units and balances | One workspace with four steps **Prepare, Pick, Send, Receive** (`web/app/(app)/inventory/requests/[id]/page.tsx:28`); the four quantities per item (`QtyStrip`, `web/components/inventory/workspace/job-parts.tsx`); Send is prefilled with what was picked | `inv_reservations.picked_qty`, `picked_at`, `picked_by` and `inv_pick_for_request` (`P1:29,45`). Gap: nothing recorded that reserved equipment had been taken off the shelf, so "picked" could not be shown. A pick moves no stock and changes no availability |
| **Receive and inspect** | `inv_return_from_project` (partial, idempotent, a condition per line; good or fair is available, the rest is held), `inv_check_condition` (the inspection that clears a held unit) | Receive lists what went out with the dispatch each unit left on (`loadDispatchesOf`, `web/lib/inventory/job-data.ts:53`), says the result in one line before and after saving (`returnResultLine`, `web/lib/inventory/workspace.ts:138`), and the button reads **Receive return** | Nothing |
| **Project and Operations views** | `inv_request_state`, `proj_equipment_readiness`, the Equipment issues of the Operations Overview | A panel **Equipment by site run** on the project's Equipment tab and on the Operations Overview (`RunEquipmentList`, `web/components/inventory/job-panels.tsx`) | `inv_run_cover_rows`, `inv_project_run_cover`, `inv_company_run_cover` (`P1:189,229,246`). Gap: an exception could not be tied to the run it affects |

No dependency was added. Libraries already installed and reused: `jsqr` (camera decoding, `web/components/inventory/scan-engine.ts`), `qrcode` (labels), the label parser `parseInventoryScan` (`packages/domain/src/inventoryCodes.ts:38`), the scanner component `web/components/inventory/qr-scanner.tsx`, the honest-saving hook `web/components/inventory/stock/use-movement-flow.ts`, the ⓘ control `web/components/ui/info-hint.tsx`.

## 4. Screens and controls (Phase 1 paths)

### 4.1 Today (`/inventory`)

`web/app/(app)/inventory/page.tsx`; rules in `web/lib/inventory/today.ts`.

| Control | What it does | Who | Source |
|---|---|---|---|
| Company chooser, warehouse chooser, "All companies" / "All warehouses" | Sets `?location=`; remembers it. Viewing only | Anyone with an Inventory grant | `warehouse-bar.tsx` |
| **Scan a label** | Opens the existing scan panel on Stock. Never changes stock | same | `warehouse-bar.tsx` |
| Filter chips (Everything, Prepare, Pick, Send out, Receive back, Transfers, Sales checks, Waiting / Shortages, Held for checking, PM reported a difference) | `?show=`; a chip whose source failed shows "?" | same | `today.ts:28` |
| Section **Do now** | Jobs to prepare (always: reserving early is the point), jobs to pick whose leave date is tomorrow or earlier, jobs to send and returns and transfers due today or late, Sales checks, held units, reported differences (first) | same | `sectionOf` |
| Section **Coming up** | The same work with a later date | same | `sectionOf` |
| Section **Waiting on someone else** | Shortage rows (lines marked to buy or rent: "<item>: N missing of M · to buy / to rent", **Who acts**, **Next**) and requests without dates (waits on the Project Manager) | same | `waitingRow`, `requestRow` |
| Row button **Prepare equipment** | Opens the job at Prepare | anyone who sees the row | `requestRow` |
| Row button **Pick items** / **Send equipment** / **Receive return** | Opens the job at that step. Offered only to people who may operate stock (`canOperateAnyStock`); the row's title is still a link | warehouse operators, founders | `today-row.tsx` |
| Row button **Check availability** | The existing record-the-check dialog (`inv_record_opportunity_check`) | warehouse, catalogue managers, founders | `record-check-button.tsx` |
| Row button **Check it** (held unit) | Opens the unit on Stock, where the existing Check condition records the inspection | warehouse operators | `heldRows` |

A request row's next action: something reserved is unsent and the leave date has come: **Pick items** while part of it is not picked, then **Send equipment**; else a line still has something to reserve: **Prepare equipment**; else something reserved is unsent: Pick, then Send. On a database without `P1` there is no pick step and a request goes from reserved to Send, as before (`pickInstalled`, `web/lib/inventory/planning-data.ts:183`).

### 4.2 The job workspace (`/inventory/requests/[id]?step=prepare|pick|send|back`)

`web/app/(app)/inventory/requests/[id]/page.tsx`. One request at every step. A person who cannot see the request gets "This request does not exist, or you do not have access to it" (row level security on `inv_requests`, `inv_can_see_request`). A Project Manager sees Prepare and, on the other steps, a sentence that the warehouse does them.

| Step | Control | What it does | Function | Who |
|---|---|---|---|---|
| Header | Company · warehouse, Booking window, **Leaves warehouse**, **Due back**, More dates | Read only | none | viewers of the request |
| Header | **Site runs this request serves** (open on Prepare, one line on the other steps) | Each run with the request's state, quantities and what is wrong for that run | `inv_project_run_cover` | viewers who are project details readers, Operations or warehouse |
| Prepare | **Reserve** per line: location, "Pick free ones for me" or named units, quantity, "If not everything can be reserved, mark the rest as" (Need to buy / Need to rent, rental reference) | Reserves what is free for the request's whole window and reports the shortage; never forces | `inv_reserve` (unchanged) | warehouse operator at that location, founder |
| Pick | Scan box, **Add**, **Use camera** | Ticks a reserved unit. A code not reserved for the request: "Wrong item" and a chip that blocks the save until removed; a repeat: "Already scanned"; one already out: says so | none (`scanForRequest`, `workspace.ts:86`) | warehouse |
| Pick | Unit rows (code, serial, **bin**), "Tick all N", counted quantity with **All N**, the bins that hold it | Builds the pick. What is already picked is ticked; unticking it puts it back | none | warehouse |
| Pick | **Pick items** (the one action; beside it the effect of saving) | Saves only what changed. Result: what is picked and waiting, what is still on the shelf, who acts next, and a **Send equipment** link | `inv_pick_for_request` via `recordPick` (`web/lib/actions/inventoryStock.ts:107`) | warehouse operator at that location, founder |
| Pick, Send, Receive | **Check whether it went through**, then **Send it again** | After a save whose result is unknown the list is kept and locked; the same key is checked (`inv_transaction_status`) before anything is sent again | `checkTransaction` | the person who saved |
| Send | The picked units are ticked and the picked counted quantity is filled in; anything else is not ticked | Confirm or correct in place | none | warehouse |
| Send | **Send equipment (N)**, then **Confirm: send N** | One dispatch against the request; sending part leaves the rest reserved and the short lines open | `inv_dispatch_to_project` (unchanged) | warehouse operator at that location, founder |
| Send | Record an unplanned dispatch | The existing exception, unchanged | `inv_dispatch_to_project` without a request | warehouse |
| Receive | "Sent for <request>: <dispatch code, date (N sent)>"; each unit with "sent on <dispatch>"; nothing ticked; a condition per ticked line; "Set the condition for all ticked lines" | Records what physically came back | none until confirmed | warehouse |
| Receive | **Receive return (N lines)**, then **Confirm: receive return** | One return movement. Beside the button and after saving: "6 returned · 5 available · 1 held for inspection · 3 still out." | `inv_return_from_project` (unchanged) | warehouse operator at that location, founder |

The four quantities are shown per item in Pick and Send: **Requested** (the lines), **Reserved**, **Picked** (picked and waiting plus sent), **Sent**. A short line reads "Short: N of M not reserved" with a link to Prepare and is never counted as done.

### 4.3 The project's Equipment tab (`/projects/[id]/equipment`) and the request panel (`/inventory/requests?open=`)

| Control | What it does | Function | Who |
|---|---|---|---|
| Panel **Availability check from Sales** | The check recorded on the enquiry: the line that nothing is reserved, who and when, the warehouse, the proposed dates checked, each technology with its result. **Review this check** lists what changed since | `inv_project_sales_check` | people who can see the project's details, Operations, the warehouse of that company |
| Panel **Equipment by site run** | Each run with its request, state, quantities and exceptions | `inv_project_run_cover` | same |
| Request, section **Send to Warehouse: dates and site runs** | Site run checkboxes; "Suggested from the Site schedule … **Use these dates**"; **Leaves warehouse**, **Due back**; "Site runs covered by these dates"; More dates; **Save the dates and site runs** (or **Change the dates** once submitted) | `inv_save_request_plan` or `inv_change_request_window`, then `inv_set_request_runs` (`saveRequestPlan`, `web/lib/actions/inventoryPlanning.ts:84`) | Project Manager, acting PM, Projects founder, warehouse |
| **Send to Warehouse** (under the dates) | Submits the draft; reserves nothing | `inv_submit_request` (unchanged) | same |

### 4.4 Sales enquiry (`/sales/opportunities/[id]`, panel `?open=`): Warehouse stock check card

**Ask the warehouse to check** now offers the warehouses by name (`inv_opportunity_check_locations`); a recorded check shows "Availability checked · stock not reserved.", Checked (date, person), Warehouse and Proposed dates checked. The rest of the card (out of date, current availability, Record the check now) is unchanged. `web/components/inventory/planning/sales-availability-card.tsx`, `sales-card-view.tsx`.

### 4.5 Project Plan (`/projects/[id]/delivery`) and Operations Overview (`/operations`)

Project Plan: "How is it supplied?" offers **From stock, Buy, Rent, Client supplied**; a From stock line without a stock item shows "Needs stock match" and a **Match to stock** button. Operations Overview: panel **Equipment by site run**, every live project of the company with a linked run (`web/components/operations/overview-view.tsx`, `inv_company_run_cover`).

## 5. Database (migration `20270114000100_inv_phase1_job_flow.sql`)

Additive and safe to run twice. Nothing existing is replaced.

| Object | Kind | Who may call or read | What it does |
|---|---|---|---|
| `inv_reservations.picked_qty`, `picked_at`, `picked_by` | columns, check `picked_qty` between 0 and `qty` | read through the existing policy | Cumulative quantity picked for the reservation, sent or not; the part waiting to be sent is `picked_qty - dispatched_qty` |
| `inv_pick_for_request(company, location, request, key, lines)` | function | a signed-in user; refused unless they may operate that location (`inv_loc`) and can see the request | Marks reserved units picked (or back), sets the picked quantity of counted stock. Refuses a unit or quantity not reserved for the request, a unit not on the shelf here or not usable (damaged, missing), more than is reserved and unsent, more than is on the shelf. Idempotent by key (`inv_idem_begin`). Moves no stock |
| `inv_request_runs` | table, row level security, read `inv_can_see_request` | no direct write | Which site runs a request serves |
| `inv_set_request_runs(request, plan_item_ids)` | function | whoever may edit the request (`inv_require_edit`) | Replaces the list; each run must be a site activity of the same project and not cancelled |
| `inv_run_cover_rows(project)` | internal | none | One row per request and run: the request's state and quantities and the problems for that run |
| `inv_project_run_cover(project)` | function | project details readers, Operations, warehouse of the company; anyone else "Project not found" | The rows of one project |
| `inv_company_run_cover(company)` | function | Operations Manager or founder of that company (`ops_require`) | The rows of every live project |
| `inv_project_sales_check(project)` | function | as `inv_project_run_cover` | The enquiry's latest check and what changed since |
| `inv_tech_norm(jsonb)` | internal | none | Technologies as a comparable list |
| `inv_opportunity_check_locations(opportunity)` | function | the enquiry's owner or a Sales founder; anyone else "Opportunity not found" | Names of the active locations of the enquiry's company |

Run problems (derived): `not_submitted`, `short`, `not_sent`, `partly_sent`, `leaves_after_run_starts`, `due_back_before_run_ends`, `return_overdue`; `run_not_dated` and `request_not_dated` are notes. In words, with how many and who acts: `runProblemWords` (`web/lib/inventory/runs.ts:139`).

## 6. Stock safety: the rule and where it is enforced

| Rule | Enforced by | Proved by |
|---|---|---|
| Two concurrent reservations never take the same unit for overlapping periods | Exclusion constraint `inv_reservations_no_overlap` plus the per-item advisory lock `inv_lock_item` in `inv_reserve` | `packages/rls-tests/test/inventory_phase1_job_flow.rls.test.ts` (two connections), and the earlier `inventory_planning.rls.test.ts` |
| Concurrent reservations never exceed the free quantity for the same period; another period is unaffected | `inv_lock_item` then `inv_qty_free` inside `inv_reserve` | same file (three connections ask for 6 of 10: exactly 10 reserved) |
| A retried dispatch or return posts one movement | `inv_idempotency` (`inv_idem_begin`, `inv_begin_movement`): same key, same person, same content returns the first result | same file (parallel and repeated calls; one movement) |
| A retried pick records once | `inv_idem_begin` in `inv_pick_for_request` | same file |
| A partial return updates only what was received | `inv_return_from_project` moves only the listed lines | same file |
| A damaged unit is unavailable until cleared | `inv_unit_free` and `inv_qty_free` count only good (or fair) stock; only `inv_check_condition` changes a condition | same file (not free, cannot be reserved by name; free after the check) |
| Who may clear it | `inv_check_condition` requires `inv_loc`: a warehouse operator at that location, or a founder | same file (Project Manager, Sales, Operations, an outsider, an operator of another location, a stock reader: refused) |
| Equipment that stays out across runs stays on the same custody record | Linking runs changes no stock; there is one dispatch line per unit and one project balance | same file, and the browser walkthrough |
| Permissions on every write and direct read | Each function checks inside the database; tables have read policies only | same file (Sales, Project Manager, member, Warehouse, another location's operator, Operations, another company, an outsider) |

## 7. Coverage index (Phase 1 paths)

Numbering is local to this file (`INV-nn`). Status `Driven` = driven signed in on the isolated stack by `apps/web/os-shell-checks/inventory-phase1-flow.mjs`; `Read` = code read and unit tested, not driven.

| # | Screen or part | Route | Reference | Status |
|---|---|---|---|---|
| INV-01 | Today: company and warehouse bar | `/inventory` | 2, 4.1 | Driven (one company, two warehouses); the two-select form for several companies is `Read` |
| INV-02 | Today: Do now / Coming up / Waiting on someone else | `/inventory` | 4.1 | Driven |
| INV-03 | Today: Sales check row and its dialog | `/inventory` | 4.1 | Driven |
| INV-04 | Today: held unit row | `/inventory` | 4.1 | Driven (row); the Check it panel on Stock is Phase 2, not driven |
| INV-05 | Job workspace header and site runs | `/inventory/requests/[id]` | 4.2 | Driven |
| INV-06 | Job: Prepare, Reserve dialog with a shortage | `?step=prepare` | 4.2 | Driven |
| INV-07 | Job: Pick | `?step=pick` | 4.2 | Driven (typed codes); the camera is `Read` |
| INV-08 | Job: Send | `?step=send` | 4.2 | Driven |
| INV-09 | Job: Receive | `?step=back` | 4.2 | Driven |
| INV-10 | Uncertain save: check, then send again | Pick, Send, Receive | 4.2 | `Read` (component tests) |
| INV-11 | Project Equipment: Availability check from Sales | `/projects/[id]/equipment` | 4.3 | Driven |
| INV-12 | Project Equipment: Equipment by site run | `/projects/[id]/equipment` | 4.3 | Driven |
| INV-13 | Request: Send to Warehouse, dates and site runs | `/projects/[id]/equipment`, `/inventory/requests?open=` | 4.3 | Driven on the project page; the side panel is `Read` |
| INV-14 | Sales enquiry: Warehouse stock check card | `/sales/opportunities` panel | 4.4 | Driven |
| INV-15 | Project Plan: supply route, Match to stock | `/projects/[id]/delivery` | 4.5 | `Read` (component tests); not driven in this pass |
| INV-16 | Operations Overview: Equipment by site run | `/operations` | 4.5 | Driven |
| INV-17 | Inventory setup: company settings name | `/inventory/manage` | 2 | `Read` |

Total: 17 entries.

## 8. Action catalogue (Phase 1 actions that change data)

A documented function is not an approved tool. JARVIS does not read or change Inventory.

| Id | Action | Function | Permitted | Starting state | Changes | Retry | Stop and ask |
|---|---|---|---|---|---|---|---|
| `inventory.check.ask` | Ask the warehouse to check | `inv_request_opportunity_check` | enquiry owner, Sales founder | open enquiry | one pending check, optional warehouse | safe: one pending check per enquiry | never reserves; do not present as a booking |
| `inventory.check.record` | Check availability | `inv_record_opportunity_check` | warehouse, catalogue manager, founder | an enquiry of the company | a dated check with covers and summary | a second record supersedes the first | none |
| `inventory.request.set_runs` | Save the dates and site runs | `inv_save_request_plan` or `inv_change_request_window`, `inv_set_request_runs` | Project Manager, acting PM, Projects founder, warehouse | request not cancelled or closed | plan dates, window; run links | safe: the list is replaced | a date change on a reserved request reports lines that could not move |
| `inventory.request.send_to_warehouse` | Send to Warehouse | `inv_submit_request` | same | draft with a line and dates | `draft` to `submitted` | refused on a stale version | none |
| `inventory.request.reserve` | Reserve | `inv_reserve` | warehouse operator at the location, founder | submitted or in progress | reservations; shortage mark | not idempotent by key: re-read the line first | a shortage needs a buy or rent decision |
| `inventory.request.pick` | Pick items | `inv_pick_for_request` | warehouse operator at the location, founder | submitted or in progress, reserved and unsent | picked quantity only | idempotent by key; check before retry | a damaged or missing unit is refused: reserve another |
| `inventory.request.send` | Send equipment | `inv_dispatch_to_project` | same | reserved for the request | one movement, custody to the project | idempotent by key; check before retry | never send unreserved stock against a request |
| `inventory.request.receive` | Receive return | `inv_return_from_project` | same | held by the project | one movement; condition per line | idempotent by key; check before retry | a condition is never assumed |
| `inventory.unit.inspect` | Check it (clear a held unit) | `inv_check_condition` | warehouse operator at the location, founder | held in a warehouse | condition; one movement | idempotent by key | see section 10, decision 1 |

Total: 9 actions.

## 9. Deliberately not documented in detail yet (Phase 2)

Standalone receipts (Receive stock, owned or rented); employee issue and return (Give equipment, With people, My equipment, employee requests); warehouse transfers and cross-company receiving; Stock (list, item and unit panels, labels, kits, repairs, adjustments, corrections); History; Setup (catalogue, technologies, locations and bins, sharing, opening stock, counts); dispatch and return notes; the legacy asset import. Their existing behaviour is summarised in `04-flows-sales-to-warehouse-and-others.md` section 2 and in `docs/inventory-simplification.md`; they are unchanged by Phase 1 except for the labels named in section 4.

## 10. Open decisions for the owner

1. **Who may clear a damaged unit.** Kept as it was: any warehouse operator at that warehouse, or a founder (`inv_check_condition`). Option: only people who hold "confirm stock", or founders.
2. **Does a short reservation need approval.** Kept as it was: no approval; the warehouse marks the rest to buy or to rent and the row waits on the buyer or the person arranging the rental.
3. **Is a pick required before sending.** Not required by the database (the build deployed today sends without one, and must keep working). The screens lead Pick, then Send. Option: refuse a dispatch of unpicked equipment once every user is on the Phase 1 build.
4. **Short names outside Inventory.** Sales, Projects and Operations still show legal names. Option: use the same display names there.
5. **Sales naming a warehouse.** Sales now sees the names of its own company's warehouses when asking. Sales sees no stock level and no warehouse of another company; a cross-border check is not offered.
6. **Cross-border jobs.** A request is raised in the project's company; equipment owned by another company is used only through the existing sharing switch. No cross-border company and warehouse pair was added to the request form in this phase.

## 11. Verification (local; nothing hosted)

* `packages/rls-tests/test/inventory_phase1_job_flow.rls.test.ts`: 17 tests on a database built from every migration, with real parallel connections.
* Web unit and component tests: `company-display.test.ts`, `today.test.ts`, `workspace-phase1.test.ts`, `runs.test.ts`, `pick-step.test.tsx`, `steps.test.tsx`, `request-view.test.tsx`, `sales-card.test.tsx`, `delivery-plan-view.test.tsx`, the Today page test.
* Browser: `apps/web/os-shell-checks/inventory-phase1-flow.mjs` (seed `seed/inventory-phase1.sh`), 21 steps, separate sessions for Sales, the Project Manager, a technician at 390 px and Operations.
* Deployed-app compatibility: the `fd36b84` build on the new schema ran its own `inventory-workspace-flow.mjs` 23 of 23; the Phase 1 build on a database without the migration loaded Today, the job, the project Equipment tab, Requests, Stock and Operations and sent equipment (4 of 4).
* Not verified: anything hosted; a real phone; a real camera scan; a person with grants in several companies in a browser; the Project Plan screens in a browser in this pass.
