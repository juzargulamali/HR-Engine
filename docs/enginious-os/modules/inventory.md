# Inventory: module reference

**Status (2026-11-16), Inventory Phase 2.** The whole module is now documented: this file (the module's shared facts and the project equipment job), [`inventory-workflows.md`](./inventory-workflows.md) (every other workflow), [`inventory-coverage-index.md`](./inventory-coverage-index.md) (67 screens and parts, each with its evidence) and [`inventory-action-catalogue.md`](./inventory-action-catalogue.md) (54 actions). Phase 2 is on branch `claude/inventory-phase-2` (from `main` `2059b4b`, with `main` `d5754d1` merged in): **merged as PR #103, merge `6526049`, pinned to head `1026308`; required CI (`lint-typecheck-test`, `rls-policies`) green on that head; no SQL in this phase (nothing to apply to the hosted database); real-phone Preview checks passed (owner-confirmed 2026-11-16, not run by Claude); Production `Unverified` (not confirmed by the owner or by Claude for `6526049`).** Code read and run locally at the branch head; nothing hosted was touched by Claude. What Phase 2 changed is in section 9 and, row by row, in `inventory-workflows.md` section 16.

**Status of Phase 1 (history, as reconciled by PR #102).** Written for **Inventory Phase 1** on branch `claude/inventory-phase-1` (from `main` `fd36b84`): **merged as PR #101, merge `2059b4b`, pinned to head `7338a88`; required CI (`lint-typecheck-test`, `rls-policies`) green on that head; hosted migration `20270114000100` applied with verify rows 1 to 7 `OK`, preflight passed and the real-phone walkthrough passed (all owner-reported 2026-11-16, not run by Claude); Production: Ready and Current on `2059b4b` in Vercel (owner-confirmed 2026-11-16; not verified by Claude)**. Code read and run locally at the branch head; nothing hosted was touched by Claude. Sections 1 and 3 to 6 below document, against the implementation, the paths Phase 1 touched; they are current, with the label changes of Phase 2 noted where they apply.

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
* **Which hosted company carries which legal name is not known to Claude** (Claude cannot read the hosted database); the owner reported on 2026-11-16 that the preflight passed, including the three Inventory company labels. The owner pack's preflight prints every active company with its legal name, country and the short name it will get (`supabase/manual-sql/inv_phase1_job_flow_00_preflight_readonly.sql`, row 8).
* The legal name stays in **Inventory setup, Administration, Company record** (since Phase 2 shown as "Legal name" beside "Shown in Inventory as", `web/app/(app)/inventory/manage/page.tsx`) and on documents (dispatch and return notes are frozen payloads made in SQL and are untouched).
* **No reset is needed and none is prepared.** A display fix was enough: no Inventory table, setting or record was changed or deleted.
* Sales (`web/lib/crm/active-company.ts`), Projects and Operations (`web/lib/operations/company.ts`) still show legal names. Only the Inventory selectors and screens use the short names (see section 10, open decisions).
* **Phase 2:** the short name is also used for a company the person holds no grant for (the owner of received equipment, the other side of a transfer), so a transfer never shows a legal name on one side and a short name on the other (`web/lib/inventory/context.ts:99-103`, `xshare-data.ts:21`). A warehouse is named with its company ("Dubai · Enginious UAE") whenever the person works with more than one company, and always on a transfer (`ctx.placeName`, `context.ts:112`): the same city can be a warehouse of two companies, and they stay separate records.

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
| Row button **Inspect** (held unit; "Check it" before Phase 2) | Opens the unit on Stock, where **Inspect** is the first button and records the inspection (`inv_check_condition`) | warehouse operators | `heldRows` |

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

## 7. Coverage index

Moved to [`inventory-coverage-index.md`](./inventory-coverage-index.md): the whole module, 67 entries. The Phase 1 rows keep their numbers (`INV-01` to `INV-17`).

## 8. Action catalogue

Moved to [`inventory-action-catalogue.md`](./inventory-action-catalogue.md): the whole module, 54 actions. The nine Phase 1 actions keep their ids. A documented function is not an approved tool: JARVIS cannot read or change Inventory (section 12).

## 9. The whole module: where each area is documented

| Area | Where it lives | Reference | Changed in Phase 2 |
|---|---|---|---|
| Today | `/inventory` | section 4.1; transfers on Today: `inventory-workflows.md` 4.4 | Transfers from another company appear for the receiving warehouse; transfers sent from here wait under Waiting on someone else; the held row's button reads Inspect |
| Stock, the item, the unit | `/inventory/stock`, `?open=`, `?unit=` | `inventory-workflows.md` 2 | Transfer stock above the list; held or damaged badge; where, who, available, next on the unit; Inspect first; actions carry the item and the warehouse |
| History | `/inventory/history` | `inventory-workflows.md` 13 | The real source and destination of a transfer; warehouses named with their company; the transfer linked from the entry |
| Setup | `/inventory/manage` | `inventory-workflows.md` 12 | Four groups; company and working warehouse carried; effects said before confirming |
| Catalogue and tracking | Setup, Catalogue and tracking; the item panel | `inventory-workflows.md` 2.1, 12 | Add item from Setup with the company carried |
| Warehouses and bins | Setup, Warehouses and bins | `inventory-workflows.md` 12 | Add bins on the warehouse's row; the working warehouse first |
| Ownership and sharing | People & Access, Company settings; pointer in Setup, Administration | `inventory-workflows.md` 4.5 | Short company names for other companies; the pointer; the effect line on the form |
| Standalone owned and rented intake | `?action=receive` | `inventory-workflows.md` 3 | The item and the warehouse carried; the link to Add item when the item is missing |
| Transfers and receiving | `?action=transfer`, `/inventory/transfers/[id]` | `inventory-workflows.md` 4 | The transfer record for every transfer; receiving against it with sent, received and still in transit; nothing assumed to have arrived |
| Employee requests and custody | `/inventory/requests`, `?action=issue|return`, With people, My equipment | `inventory-workflows.md` 5 | Reserved units, the holder and the remainder carried; result lines |
| Project requests and site runs | the job workspace, the project's Equipment tab | sections 3, 4.2, 4.3, 5 | none |
| Sales availability | the enquiry's Warehouse stock check card; Today | sections 3, 4.4 | none |
| Reserve, pick, dispatch, return | the job workspace | sections 3, 4.2, 6 | Labels only (Receive return, Inspect) |
| Damage and inspections | Today, Stock, the unit | `inventory-workflows.md` 7 | Visibly unavailable on Stock and the unit; Inspect has its own address |
| Repairs, adjustments, corrections | More actions; History | `inventory-workflows.md` 8 | Setup, Administration says where each correction is made |
| Counts and opening stock | Setup, Administration | `inventory-workflows.md` 11 | The working warehouse preselected; the effect said before starting and before confirming equipment already out |
| Kits | the kit unit's More actions | `inventory-workflows.md` 9 | none |
| Labels and QR | `/inventory/labels`, `/inventory/scan` | `inventory-workflows.md` 10 | none |
| Dispatch and return notes | the project's Equipment tab, Today, History | `inventory-workflows.md` 14 | none (documented as they behave; the switch has no screen) |
| Legacy import | Setup, Administration (founders) | `inventory-workflows.md` 15 | none (documented as it behaves) |

What users enter fewer times, and what changed in Setup, are listed in `06-change-log.md` (entry of 2026-11-16, Inventory Phase 2).

## 10. Open decisions for the owner

Kept from Phase 1 (the existing rule is still in place for each):

1. **Who may clear a damaged unit.** Any warehouse operator at that warehouse, or a founder (`inv_check_condition`). Option: only people who hold "confirm stock", or founders.
2. **Does a short reservation need approval.** No approval; the warehouse marks the rest to buy or to rent and the row waits on the buyer or the person arranging the rental.
3. **Is a pick required before sending.** Not required by the database. The screens lead Pick, then Send. Option: refuse a dispatch of unpicked equipment.
4. **Short names outside Inventory.** Sales, Projects and Operations still show legal names. Option: use the same display names there.
5. **Sales naming a warehouse.** Sales sees the names of its own company's warehouses when asking, no stock level, and no warehouse of another company.
6. **Cross-company sourcing on a project request.** A request is raised in the project's company and reserves that company's warehouses; equipment owned by another company can serve it only after it has been **transferred** to one of those warehouses under the existing sharing switch. A request line that names another company's warehouse directly is **not built**. This is a separate workflow from a warehouse transfer and was left as it is in Phase 2. Options: (a) keep it (transfer first, then reserve); (b) let the request form offer authorised warehouses of other companies, which needs a decision on who approves the use, whose stock count it reduces and which company the dispatch is filed under.

New in Phase 2:

7. **The two warehouses called Dubai and the two called Riyadh (hosted, owner-reported).** They are separate records under different companies and Phase 2 keeps them so: nothing was moved, merged or renamed, and every transfer screen now names the company beside the city. **Proposal, not done:** if the Dubai and Riyadh records under Enginious Europe are not real places that company runs (for example, they were made to hold another company's stock before cross-company receiving existed), the owner can either rename them to say what they are (for example "Dubai: Europe cage") in Setup, or empty them by transferring their stock to the right company's warehouse and then switch them off. A location cannot be moved to another company, and stock ownership is never changed by a transfer. Which it is cannot be read from the code: the hosted records are the owner's to inspect (the Phase 1 preflight lists them).
8. **Receiving everything at once.** Phase 2 stopped preselecting "everything arrived". Receiving everything is still one choice and keeps each line's recorded condition. Option: require a condition per line on every receipt (slower, never assumes the condition sent).
9. **Who may see a transfer between companies on Today.** The receiving warehouse's operators now see an incoming transfer from another company on Today (they could already receive it from Stock). No right was added: it comes from the function that already listed it for them.
10. **The dispatch and return notes switch.** Off by default and there is no screen for it. Option: add a founder switch to Setup, Administration.
11. **Remembering a warehouse chosen inside a form.** The remembered warehouse changes only when the person uses the bar at the top of Today or Stock. Option: remember the last warehouse chosen in a form too.

## 11. Verification (local; nothing hosted)

Phase 2, at the branch head:

* Browser: `apps/web/os-shell-checks/inventory-phase2-flow.mjs` (seed `seed/inventory-phase2.sh`), **29 of 29**: (i) at 390 px a transfer between two companies whose warehouses are both called Dubai, a partial receipt with one unit damaged, a retried receipt posting once, the remainder on reopening, custody, owner and History checked against the database, both sides reading the same record; (ii) Give equipment, a partial return with one item damaged, the holder, returned and available quantities compared across With people, Stock, the unit, My equipment, History and the database, then Inspect; (iii) Setup at 390 px and 1366 px. Separate sessions for the sending technician, the receiving founder, a person with two companies, an employee.
* Re-run on this build because Phase 2 touches the same screens: `inventory-phase1-flow.mjs` **21 of 21**; `inventory-transfer-location-flow.mjs` **21 of 21** (its strings were updated to the new labels and the new transfer record).
* Web: typecheck, lint and the full unit suite (see `05-data-tests-and-release-ledger.md` section B for the counts at this head). New or extended: `transfer-view.test.ts`, `movement-form.test.tsx`, `transfers/[id]/page.test.tsx`, `manage/page.test.tsx`, `stock-movements.test.ts`.
* Database: no migration and no function changed, so no RLS file was added or re-run. The stock rules of section 6 are those proved in Phase 1; the retry and the two refusals above were driven through the real functions.
* Deployed-app compatibility: there is no schema change, so the deployed build and this build run on the same database in either order.
* Not verified: anything hosted; a real phone; a real camera scan; the paths named in `inventory-coverage-index.md` section 8; the browser checks listed there as not re-run.

Phase 1 (history):

* `packages/rls-tests/test/inventory_phase1_job_flow.rls.test.ts`: 17 tests on a database built from every migration, with real parallel connections.
* Web unit and component tests: `company-display.test.ts`, `today.test.ts`, `workspace-phase1.test.ts`, `runs.test.ts`, `pick-step.test.tsx`, `steps.test.tsx`, `request-view.test.tsx`, `sales-card.test.tsx`, `delivery-plan-view.test.tsx`, the Today page test.
* Browser: `apps/web/os-shell-checks/inventory-phase1-flow.mjs` (seed `seed/inventory-phase1.sh`), 21 steps.
* Deployed-app compatibility: the `fd36b84` build on the new schema ran its own `inventory-workspace-flow.mjs` 23 of 23; the Phase 1 build on a database without the migration loaded Today, the job, the project Equipment tab, Requests, Stock and Operations and sent equipment (4 of 4).

## 12. JARVIS and Inventory

JARVIS has **no live access** to Inventory: it cannot read stock, a request, a transfer, a movement or who holds what, and it cannot change anything (`web/lib/jarvis/assistant.ts:67`: "I cannot read or change Inventory…", with links to Inventory and My equipment; `web/lib/jarvis/runtime.ts:24`: no Inventory action is registered and no grant passes for one). What it can do is **explain**: it answers "how do I" questions from the published staff guidance (`docs/enginious-os/staff-guidance/inventory.md`, 12 topics since Phase 2) and says which screen to open. Phase 2 granted nothing new. The full statement, with the list of future capability proposals, is in [`jarvis.md`](./jarvis.md) section 17 and [`jarvis-rulebook.md`](./jarvis-rulebook.md) section 9.
