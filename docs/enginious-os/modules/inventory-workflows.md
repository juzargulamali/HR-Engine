# Inventory: workflows outside the project equipment job

**Status (2026-11-16).** Written for **Inventory Phase 2** on branch `claude/inventory-phase-2` (from `main` `2059b4b`, with `main` `d5754d1` merged in): **not merged, no pull request opened by Claude, required CI not yet run on this head, no SQL in this phase (nothing to apply to the hosted database), Production not deployed from this branch.** Code read and run locally at the branch head; nothing hosted was touched by Claude.

This file is the reference for every Inventory workflow **other than** the project equipment job (Sales check, Send to Warehouse, reserve, pick, send, receive), which is in [`inventory.md`](./inventory.md) sections 3 to 6. Start from the [coverage index](./inventory-coverage-index.md) (every screen, with its evidence label) and the [action catalogue](./inventory-action-catalogue.md) (every action that changes data). Paths are relative to the repository root; `web/` means `apps/web/src/`; `S` means `supabase/migrations/20261201000300_inv_stock_functions.sql`; `X` means `supabase/migrations/20261218000100_inv_cross_company_receiving.sql`.

**Evidence labels.** `Flow P2`: driven signed in on the isolated stack by `apps/web/os-shell-checks/inventory-phase2-flow.mjs` (29 of 29). `Flow TL`: driven by `inventory-transfer-location-flow.mjs`, re-run on this build (21 of 21). `Flow P1`: driven by `inventory-phase1-flow.mjs`, re-run on this build (21 of 21). `Code`: read in the code named, with the unit or component test named where one exists; not driven in a browser in this phase. `Unverified`: not confirmed in code or by a run at this head.

## 1. What every workflow shares

| Fact | How it works | Source | Evidence |
|---|---|---|---|
| Who may change stock | Every movement function calls `inv_loc(company, location)`: the caller must be a founder of that company, or a warehouse operator assigned to that location (or holding "all locations"), the company must be switched on, and the location active. The screens only decide what to offer | `S:156` (`inv_loc`), `inv_can_operate` (`20261201000100_inv_catalogue_stock_ledger.sql:456`); `canOperateLocation` (`packages/domain/src/permissions/inv.ts:76`) | Code; refusals driven in `Flow P2` (sender receiving at another company's warehouse; an employee saving a bin) |
| Who may read stock | Units, balances, transfers, movements: `inv_can_view_stock` (warehouse or view stock). Items, locations, bins: `inv_can_browse` (any Inventory grant, or the manager of a running project). Costs: `view_costs` only | `20261201000100:498-519` | Code |
| One form, three steps | Every movement uses one form: fill in, **Review** ("Check before you confirm"), **Confirm**. One key is made when the form opens and sent with every attempt | `web/components/inventory/stock/movement-form.tsx`, `use-movement-flow.ts`, `movement-review.tsx` | `Flow P2`; `movement-form.test.tsx` (29 tests) |
| Retried save | Same key, same person, same content returns the first result (`inv_begin_movement`, `inv_idem_begin`). After an uncertain failure the form is locked as it is and offers **Check whether it went through** (`inv_transaction_status`) | `S:538,573,3047`; `web/lib/actions/inventoryStock.ts:75` | `Flow P2` (a receipt sent three times with one key: one movement, the quantity moved once); `movement-form.test.tsx` |
| Company and warehouse on the form | With one warehouse the person may operate, it is shown as "Dubai · Enginious UAE" and not asked for (`movement-form.tsx:347`). With several, the select names each with its company and starts on the working warehouse (`action-panel.tsx:49`, from the address, then the `inv_warehouse` cookie, then the assigned location: `working-location.ts`). The review and the result always say the warehouse with its company (`placeText`, `movement-form.tsx:236`) | as cited | `Flow P2` (one warehouse; a person with two companies) |
| Remembered choice | The warehouse bar writes the cookie `inv_warehouse` when the person changes company or warehouse (`warehouse-bar.tsx`). Today, Stock, the forms and Setup read it. A value the person may not use is ignored. Choosing a warehouse inside a form does not change the remembered one | `working-location.ts:43`; `manage/page.tsx:54-62` | `Flow P2` (Setup); the bar itself `Flow P1` |
| Company names | Selectors and screens say the short name worked out from the company's country (Enginious UAE, Enginious Saudi Arabia, Enginious Europe). Since Phase 2 the same short name is used for a company the person holds no grant for (the owner of received equipment, the other side of a transfer): the company directory is readable by every signed-in person (`companies_select`, `20260922000000_phase0_foundations.sql:255`), and the database functions' legal names are replaced on the way to the screen (`shortNames`, `web/lib/inventory/xshare-data.ts:21`; `context.ts:99-103`). Legal names stay on the company record and on documents | as cited | `Flow P2`, `Flow TL` |
| A warehouse named with its company | `ctx.placeName` gives "Dubai · Enginious UAE" whenever the person works with more than one company (`context.ts:112`); every transfer screen and form names the company always. A warehouse of another company that the person cannot read is named from the narrow functions (`loadForeignPlaceNames`, `xshare-data.ts:84`) or, failing that, "A warehouse of another company" | as cited | `Flow P2` (two warehouses called Dubai) |
| Failed read | A loader that fails throws; the page says "Could not load …" (`LoadError`), never an empty list | each page's `try`/`catch` | Code; page tests (`history/page.test.tsx`, `manage/page.test.tsx`, `transfers/[id]/page.test.tsx`) |

## 2. Stock (`/inventory/stock`)

`web/app/(app)/inventory/stock/page.tsx`. Reached by anyone with an Inventory grant or managing a running project; the list is the catalogue with counts for the chosen warehouse.

| Part | What it does | Who | Source | Evidence |
|---|---|---|---|---|
| Warehouse bar | Company, warehouse, "All warehouses", **Scan a label** | everyone here | `warehouse-bar.tsx` | `Flow P1`, `Flow P2` |
| Header actions | **Receive stock**, **Give equipment**, **Transfer stock** (added in Phase 2: a transfer can start from the warehouse context). Each opens a side panel through the address (`?action=receive|issue|transfer`) | people who may operate stock somewhere (`canOperateAnyStock`); the database checks the location | `stock/header-actions.tsx`; `_panel/action-panel.tsx` | `Flow P2` (the buttons, and Transfer stock from a unit); the header's own Transfer stock link is `Code` |
| **Add item** | Quick Add: name, category, how it is tracked; unit and decimals only for counted stock; the rest under More details. The company is the working warehouse's company when the person may add there | `manage_catalogue` (`inv_save_item`, `S:919`) | `stock/quick-add-item.tsx`, `item-forms.tsx` | `Flow P2` (from Setup); `item-forms.test.tsx` |
| Views | **Equipment** (the list) and **With people** | With people: employee-custody readers, warehouse operators, founders | `stock/page.tsx:100-117`; `with-people.tsx` | `Flow P2` |
| The list | One row per item: Available (here), Out, Reserved, and optional columns. A row with damaged, inspection-held, repair or missing stock shows **"N not available: held or damaged"** (Phase 2). On a phone each row is a card (`listTable`) | detail columns only for people who may view stock; others see "usable now" from `inv_availability` | `stock/page.tsx:258`; `lib/inventory/stock-list.ts` | `Flow P2` (phone) |
| Filters | Search, category, how tracked, condition, company, status; Columns menu | as the list | `stock-list.ts` | `Code` (`stock-list.test.ts`) |
| Other companies' equipment | Below the list: units and counted stock owned by another company that are at, or in transit to, a warehouse the person operates, with the owner and "Sharing revoked—contact owner" where it applies; and the transfers between companies the person is a party to | people who operate stock | `components/inventory/cross-company-section.tsx`; `inv_xshare_units`, `inv_xshare_counted_stock`, `inv_xshare_transfers` (`X:259,298,124`) | `Flow P2`, `Flow TL` |

### 2.1 Item panel (`?open=<item>`)

`web/app/(app)/inventory/_panel/item-panel.tsx`. What the item is, At a glance (usable now, in the warehouse, with employees, on projects, in transit, reserved, needs attention, not counted yet), its units or its stock by location and bin, recent movements, Edit details.

| Control | What it does | Function | Who | Evidence |
|---|---|---|---|---|
| **Receive stock** | Opens Receive stock with **this item already on the list** and the working warehouse chosen (Phase 2: `?action=receive&item=`) | `inv_receive_stock` | operator at a location of the item's company | `Flow P2` |
| More actions: Add unit; Create a bin label | Registers one unit (starts "Not counted yet"); makes a label for the item in one bin | `inv_register_unit` (`S:1080`), `inv_ensure_bin_label` (`S:1171`) | operator there or catalogue rights | `Code` |
| More actions: **Give equipment**, **Transfer stock**, Send to a project (not from a request) | The movement form in a dialog, starting from the item (its name in the search box) and the working warehouse (Phase 2) | `inv_issue_to_employee`, `inv_transfer_dispatch`, `inv_dispatch_to_project` | operator | `Code` (labels asserted in `inventory-workspace-flow.mjs`, not re-run) |
| More actions: Use up, Return unused (consumables) | Consumables used, or unused ones back on the shelf | `inv_consume` (`S:2307`), `inv_return_unused` (`S:2362`) | operator | `Code` |
| More actions: **Inspect**, Send for repair, Back from repair, Mark missing, Mark found, Retire | See sections 7 and 8 | as there | operator | `Code` |
| More actions: Replace item | Retires the item and makes a new one in its place, with a reason | `inv_replace_item` (`S:999`) | catalogue rights | `Code` |
| Print labels for all units | Opens the label sheet for up to 100 units | none (prints are recorded on print) | readers | `Code` |
| Edit details | Name, category, model, specification, notes, status; tracking is locked once there is stock or history | `inv_save_item` | catalogue rights | `Code` |

### 2.2 Unit panel (`?unit=<id or code>`)

`web/app/(app)/inventory/_panel/unit-panel.tsx`; only people who may view stock can read a unit.

| Part | What it shows or does | Source | Evidence |
|---|---|---|---|
| **Where is it now, Who has it, Is it available, What to do next** (Phase 2) | Four answers from the unit's own record. Available only when it is active, on the shelf, good or fair and not in a kit; a damaged, inspection-held or unserviceable unit reads "Not available: damaged, held for inspection" | `web/lib/inventory/unit-answers.ts:36` (mirrors `inv_unit_usable`, `20261201000250_inv_shared_helpers.sql:50`) | `Flow P2`; `transfer-view.test.ts` (unit answers) |
| First buttons | The next action first: **Inspect** for a held unit (Phase 2: it was under More actions), **Give equipment**, Dispatch to a project, **Transfer stock** for an available one, **Receive return** for one that is out (with the holder filled in), **Receive transfer** for one in transit | `unit-panel.tsx:86-99`; addresses `?action=check|issue|dispatch|transfer|return&codes=` | `Flow P2` (Inspect, Give equipment, Transfer stock); the rest `Code` (`panels.test.tsx`) |
| More actions | Inspect, Send for repair, Back from repair, Return rental to supplier, Mark missing, Mark found, Retire, Change who holds it, Move to another project, Pack the kit, Unpack the kit, Edit the checklist, Print label | as section 7 to 9 | `Code` |
| About this unit | Item, serial, where it is, owned by (when the owner is not the company that runs the place), expected back, kit, ownership (owned or rented, with the rental), verified, registered, cost (only with `view_costs`), notes, earlier asset register link | `unit-panel.tsx:155` | `Flow TL` (owner apart from place); `Code` |
| Transfers to other companies; History | The unit's cross-company transfers with their steps; every movement of the unit | `loadXTransfersOfUnit`; `_panel/history.tsx` | `Flow TL`; `Code` |
| Another company's unit | A unit of another company that the person may handle opens a minimal record (code, serial, item, owner, condition, place) with Receive transfer or Give equipment | `_panel/foreign-unit.tsx`; `inv_xshare_units` | `Flow TL` |

## 3. Standalone receipts: Receive stock (owned or rented)

| | |
|---|---|
| Route | `/inventory/stock?action=receive` (side panel); `&item=<id>` carries a catalogue item; `&location=` the warehouse |
| Users | Warehouse operator at the receiving location, or a founder. Enforced by `inv_receive_stock` through `inv_loc` (`S:1591`). Entering a cost needs `view_costs` (`S`, same function) |
| Entry points | **Receive stock** above the Stock list; **Receive stock** on an item (item carried); Setup, Getting stock in (**Receive stock at <warehouse>**) |
| Inputs and defaults | **Receive into**: the working warehouse (shown, not asked, when it is the only one). **Owned or rented**: chosen every time, never assumed. Rented only: supplier, supplier's reference, has to go back by, optional project. Lines: for an individual item or a kit, how many arrived (each gets an ID) and, under More details, condition, serial numbers and cost; for counted stock, quantity, bin and, under More details, condition and cost. Cost and currency only for people who may see costs |
| Next action | Review, then **Confirm receipt**. The result names the new IDs; print their labels from the item |
| Status changes | New `inv_units` (verified by the receiver) or a higher `inv_balances` quantity at that location; a rented receipt opens an `inv_rentals` row. Movement kind `receipt` or `rental_receipt` |
| Stock effect | On the shelf at that location; available when good (units: good or fair). Rented stock never adds to what the company owns |
| Exceptions | A draft item cannot be received (put it in use first). An item not in the catalogue: the search says so and links Add item (Phase 2; only people with catalogue rights get the form). Not set up to work anywhere: the panel says who can add a location |
| Screens, action, function | `movement-form.tsx` (kind `receive`), `lines-editor.tsx`; `recordMovement`; `inv_receive_stock` |
| Evidence | `Flow P2` (item and warehouse carried; a counted item asks for no serial numbers). Rented receipt and return to supplier (`inv_return_rental`, `S:2982`): `Code` (`receive-ownership.test.tsx`), not driven in Phase 2 |

## 4. Transfers between warehouses, including between companies

One transfer system for both cases; a transfer between companies is the same record with the existing sharing rule on top. Direct cross-company sourcing **on a project request** is a different workflow and is not built (see `inventory.md` section 10, decision 6).

### 4.1 Send (Transfer stock)

| | |
|---|---|
| Route | `/inventory/stock?action=transfer` (side panel, tab **Transfer stock**); `&codes=` carries units or bin labels; `&location=` the sending warehouse |
| Users | Operator at the **sending** location, or a founder of its company (`inv_transfer_dispatch` through `inv_loc`, `S:2152`) |
| Entry points | **Transfer stock** on a unit (the unit and its warehouse carried); **Transfer stock** in an item's More actions (item and working warehouse carried); **Transfer stock** above the Stock list |
| Inputs and defaults | **Send from**: the working warehouse (shown, not asked, when it is the only one), always with its company. **Send to**: every active location of the same company, and the warehouses of other companies that the **owning** company has authorised (`inv_xshare_destinations`, `X:102`), each named with its company, the others marked "(another company, authorised)". Lines: units by scan or search; counted stock with a typed quantity and its bin. Under **Shipping details (optional)**: expected arrival, carrier, reference |
| Next action | Review shows From and To with company and warehouse, and **Who acts next** (the receiving warehouse). **Confirm and send** |
| Status changes | A new `inv_transfers` row `in_transit`; units get custody `transit`; counted stock moves to a transit balance. Movement kind `transfer_dispatch`, filed under the **sending** company |
| Stock effect | Available at **neither** warehouse until received. The owner (`inv_units.company_id`) never changes |
| Exceptions | Destination equal to the source; an expected arrival in the past; a unit reserved for an upcoming request ("Release or change that reservation"); a unit not usable from the shelf; more than is free; sharing not authorised for the owner at either end (`inv_check_sharing`) |
| Result | "6 sent from Dubai · Enginious UAE to Dubai · Enginious Europe. In transit: Dubai · Enginious Europe acts next and records what arrives." and **Open the transfer** |
| Screens, action, function | `movement-form.tsx` (kind `transfer`), `movement-panel.tsx` (`TransferPanelBody`); `recordMovement`; `inv_transfer_dispatch` |
| Evidence | `Flow P2` (phone, between companies, two warehouses called Dubai); `Flow TL` (same company and between companies, desktop) |

### 4.2 Receive against the original transfer

| | |
|---|---|
| Route | `/inventory/stock?action=transfer&mode=receive&transfer=<id>` (tab **Receive transfer**) |
| Users | Operator at the **receiving** location, or a founder of its company (`inv_transfer_receive` through `inv_loc` on the destination, `S:2230`). No sharing check at receipt: a revoked authorisation never strands equipment |
| Entry points | **Receive transfer** on the Today row; **Receive this transfer** on the transfer page; **Receive transfer** on a unit in transit |
| What it shows | Sent from and Receiving at (company and warehouse), when it was sent, and **"N lines sent · M already received · K still in transit"** (a unit is one line, a counted item is one line). Each line names its owner when the owner is not the receiving company |
| Inputs and defaults | **What arrived** is a choice with nothing preselected (Phase 2): *Everything still in transit arrived* (each line is received in the condition recorded when it was sent) or *Only some of it arrived* (add lines from the list of what is still in transit; type the quantity of counted stock; choose the condition and, optionally, a bin and a note). Review is refused until one is chosen |
| Next action | Review names every line (never just "everything") with where it came from; **Confirm arrival** |
| Status changes | Listed units go to custody `warehouse` at the destination with the stated condition; listed quantities move from the transit balance to the destination. When nothing is left in transit the transfer becomes `received` (`received_by`, `received_at`). Movement kind `transfer_receive`, filed under the **receiving** company |
| Stock effect | Available at the destination from then on, only if good (units: good or fair); anything else is held for inspection. What is not listed stays in transit and the transfer stays open |
| Reopening | The form lists only what is still in transit; the remainder is carried, never retyped |
| Result | From what the database returned: "3 received · 1 held for inspection · 2 lines still in transit." (`receiptResultWords`, `web/lib/inventory/transfer-view.ts:106`) |
| Exceptions | A transfer already received or cancelled; a unit that is not part of the transfer; more than is in transit; a bin of another location |
| Screens, action, function | `movement-form.tsx` (kind `receive_transfer`); `loadFormContext` (`web/lib/inventory/stock.ts:757`) and `loadXIncoming` (`xshare-data.ts`); `recordMovement`; `inv_transfer_receive` |
| Evidence | `Flow P2` (phone: a partial receipt with one unit damaged, a retried receipt posting once, the remainder on reopening, completion); `Flow TL`; `movement-form.test.tsx` |

### 4.3 The transfer record (`/inventory/transfers/[id]`)

`web/app/(app)/inventory/transfers/[id]/page.tsx`. One page for **every** transfer since Phase 2 (it used to exist only for transfers between companies).

| Part | What it shows | Source |
|---|---|---|
| Header | "Dubai · Enginious UAE to Dubai · Enginious Europe"; In transit, Partly received, Received or Cancelled; Between companies | `viewFromTrace` (`transfer-view.ts:47`) |
| Where it stands | "6 sent · 3 received · 3 still in transit" (units count one each, counted stock by quantity; received is sent minus what is still in transit, so nothing is assumed to have arrived); **Who acts next** | `transferProgress`, `nextAction` (`transfer-view.ts:71,85`) |
| **Receive this transfer** | Offered only to someone who may operate the receiving warehouse while anything is in transit; everyone else is told who receives | `page.tsx` (`canOperateLocation`) |
| The transfer | Sent from and Going to (warehouse, company), sent, expected, carrier and reference, completed | same |
| Equipment; Counted stock | Each unit with serial, owner ("Owned by …" when the owner is not the receiving company) and state (in transit, received, since moved on); each counted item with sent, received, still in transit | same |
| What was recorded | The dispatch and every receipt, each with its movement code, who recorded it and the company it is filed under | same |

Who may read it: a transfer between companies comes from `inv_xshare_transfer_trace` (`X:166`), which answers the owner or sender side and the receiving warehouse's operators and nobody else; a transfer inside one company comes from the person's own rows (`inv_transfers`, its movements and lines), which row level security gives to people who may view that company's stock (`ownTrace`, `web/lib/inventory/transfer-data.ts:21`). Anyone else gets "No transfer with that address was found, or you do not have access to it". Evidence: `Flow P2` (both sides, phone; a person without access refused by the function), `Flow TL`; `transfers/[id]/page.test.tsx`. The **same-company** read path (`ownTrace`) is `Code` only: `Flow TL` opens the page for the cross-company transfer.

### 4.4 Where a transfer appears

| Place | What it says | Source | Evidence |
|---|---|---|---|
| Today, receiving warehouse | "Transfer X is on its way here", from which company and warehouse, how many items, "M of N already received" after a partial receipt, **Receive transfer**. Since Phase 2 this includes a transfer **from another company** (Today used to read only the person's own company's rows, which never hold it) | `loadTransferRows` (`web/lib/inventory/today-data.ts:190`), `loadOpenTransfers` (`transfer-data.ts:112`), `transferRows` (`today.ts`) | `Flow P2` |
| Today, sending warehouse | Under **Waiting on someone else**: "Transfer X to <warehouse · company>: in transit", how many items are still in transit, **Who acts** (the receiving warehouse), **Open transfer** | `today.ts:415` | `Flow P2` |
| History | The dispatch row reads "Dubai → In transit to Dubai · Enginious Europe"; the receipt row "In transit from … → …". The entry shows Sent from, Going to and **Open the transfer** | `web/lib/inventory/movement-view.ts:51`; `history/_panel/movement-panel.tsx` | `Flow P2` |
| Stock | "Transfers between companies" and "Equipment of other companies at your warehouses" | `cross-company-section.tsx` | `Flow P2`, `Flow TL` |

The sender's History holds the dispatch only: the receipt is filed under the receiving company, whose stock the sender may not read. The transfer record shows both.

### 4.5 Sharing between companies (ownership and authorisation)

| | |
|---|---|
| Rule | Equipment belongs to the company that owns it wherever it is kept. Using it at another company's location, on its project or with its employee needs a founder of the **owning** company to allow that company (`inv_company_sharing`); it is checked when equipment is dispatched (`inv_check_sharing`, `S:192`) |
| Where it is set | **People & Access, Company settings** (`web/components/people-access/company-settings.tsx`, `components/inventory/setup/sharing-section.tsx`), by `inv_set_company_sharing` (`S:1038`). Inventory Setup, Administration points there (Phase 2) and the form says what allowing does before it is confirmed |
| Who | A founder of the owning company changes it; Inventory access managers read it |
| Revoking | Blocks new dispatches and removes the warehouses from Send to. Equipment already sent can still be received and tracked; the screens say "Sharing revoked—contact owner" |
| Evidence | `Flow TL` (authorise, send, revoke during transit, receive, authorise again); the People & Access form itself is driven by `inventory-flow-5-access.mjs`, **not re-run** in Phase 2 |

## 5. Employee equipment: requests, Give equipment, With people, My equipment, returns

### 5.1 Employee request

| | |
|---|---|
| Route | `/inventory/requests` (list, Add), `/inventory/requests?open=<id>` (panel), `/inventory/requests/[id]` (workspace) |
| Users | Made **for** an employee, not by them (the screens offer it to people with "request for employees" and to the warehouse; the exact rule inside `inv_create_request`, `20261201000400_inv_planning_functions.sql:398`, was not read line by line for employee requests: `Unverified`). The warehouse reserves and gives. Editing by `inv_require_edit` (`:101`); reading by `inv_can_see_request` |
| Flow | Draft, lines, submit; the warehouse reserves (`inv_reserve`), then **Give equipment** from the request. Since `20261216000100` giving against the request consumes its own reservation |
| Phase 2 | **Give equipment** opened from the request (`?action=issue&request=&employee=`) carries the employee **and the units reserved for the request** onto the list; a note says which were carried and that counted quantities are still typed (`requestUnitCandidates`, `web/lib/inventory/stock.ts:734`; `action-panel.tsx:86`) |
| Evidence | The request screens and the issue against a request are driven by `inventory-flow-2-employee.mjs`, **not re-run** in Phase 2. The Phase 2 carry-over of reserved units is `Code` only: **not driven** |

### 5.2 Give equipment

| | |
|---|---|
| Route | `/inventory/stock?action=issue` (`&codes=`, `&employee=`, `&request=`) |
| Users | Operator at the location, or a founder (`inv_issue_to_employee`, `20261216000100_inv_issue_to_employee_consumes_reservation.sql:16`) |
| Entry points | **Give equipment** above the Stock list; on a unit (unit and warehouse carried); in an item's More actions; on a person's row under With people (person carried); on an employee request (person, request and reserved units carried) |
| Inputs and defaults | **Take from** (the working warehouse); **Who receives it** (an active employee, searched by name or number, chosen once); the request, when the person has an open one; lines; expected back (optional) |
| Status changes | Units get custody `employee`; counted stock moves to the employee's balance. Movement kind `issue_employee`. A linked HR asset record is kept in step (`inv_mirror_legacy`) |
| Stock effect | Not available; shown under With people and on the employee's My equipment |
| Exceptions | An inactive employee; a unit that is damaged or held ("held back until it has been checked"); a unit reserved for another request; more than the request asks for |
| Result | "3 given to Eve Employee from Dubai · Enginious UAE. It shows under With people until it is returned." |
| Evidence | `Flow P2` (phone, from the unit; the database refusing a damaged unit) |

### 5.3 With people and My equipment

| Screen | What it shows | Who | Source | Evidence |
|---|---|---|---|---|
| With people (`/inventory/stock?view=people`) | One row per person holding equipment: items (each with ID, serial, condition, since, back by, overdue), since, expected back, overdue. People who have left stay listed. **Give equipment** and **Receive return** per person; **Receive return of <ID>** per item (Phase 2) | employee-custody readers, warehouse operators, founders (`inv_employee_outstanding`, `20261201000500_inv_employee_legacy.sql:159`); the buttons only for warehouse operators | `web/components/inventory/with-people.tsx` | `Flow P2` (phone); the per-item link is `Code` |
| My equipment (`/inventory/mine`) | What is assigned to the signed-in employee: item, ID, serial, since, expected back, condition, overdue. It says to hand a return to the warehouse; a warehouse operator also gets **Receive return** with themselves filled in (Phase 2) | every employee (`inv_my_equipment`, `:119`) | `web/app/(app)/inventory/mine/page.tsx` | `Flow P2` (an ordinary employee; no button for them). The operator's own button is `Code` |
| Employee's Assets tab in People | The same holdings, read only, under the earlier asset register | custody readers | `components/inventory/planning/employee-equipment-link.tsx` | `Code` |

An employee cannot record their own return: a return changes stock, so it is the warehouse's (`inv_return_from_employee` through `inv_loc`).

### 5.4 Receive return from an employee

| | |
|---|---|
| Route | `/inventory/stock?action=return&employee=<id>` (`&codes=` carries units) |
| Users | Operator at the location, or a founder (`inv_return_from_employee`, `S:1796`) |
| Entry points | **Receive return** on the person's row or on one item under With people; on a unit that is with an employee; on Today (an employee return that is due); My equipment for an operator |
| Inputs and defaults | **Back into** (the working warehouse); the employee, already chosen; **What they are holding**, listed from the record, nothing on the list to begin with. Each line added needs a **condition**, never assumed; counted stock needs a typed quantity |
| Phase 2 | Units carried in the address are kept only if the named person still holds them; anything else is left off and said so ("… is no longer recorded with …, so it was left off the list", `action-panel.tsx:74`) |
| Status changes | Listed units go to custody `warehouse` with the stated condition. Movement kind `return_employee` |
| Stock effect | Good or fair: available. Damaged, needing inspection or unserviceable: held, not available, until inspected (section 7). What is not listed stays with the person |
| Result | "2 returned · 1 available · 1 held for inspection · 1 still out." (`returnResultLine`, `web/lib/inventory/workspace.ts`), from what the database returned |
| Reopening | The list shows only what the person still holds |
| Evidence | `Flow P2` (phone: partial return, one damaged; the holder, returned and available quantities compared across With people, Stock, the unit, My equipment, History and the database) |

Change who holds it (a unit with an employee, to another employee or back to the pool, with a reason): `inv_reassign_unit` (`20261201000500:211`), `components/inventory/stock/reassign-form.tsx`. `Code`.

## 6. Project custody outside a request

Dispatch to a project without a request ("Send to a project (not from a request)"), Return from a project through the general form, and Move between projects (`inv_transfer_between_projects`, `20261201000700_inv_transfer_destination_check.sql`) are the labelled exceptions to the request workflow; they use the same form. A project's planned equipment is on its request (`inventory.md` section 4.2). Phase 2 changed nothing here except the button label **Receive return**. Evidence: `Code`; driven by `inventory-returns-and-links-flow.mjs` and `inventory-flow-4-transfer-and-conflicts.mjs`, **not re-run**.

## 7. Damage and inspection

| | |
|---|---|
| Rule | A unit that is damaged, needs inspection or is unserviceable, and counted stock that is not good, is **held**: never counted as available, never reservable, never given out, and never released automatically |
| How it gets held | A condition recorded on a return, a transfer receipt or a repair return; Mark found (a found unit is held for checking) |
| Where it shows | Today, Do now: "held for checking" row with **Inspect**; Stock: "N not available: held or damaged" on the item; the unit: "Not available: …, held for inspection" and **Inspect** as the first button; the cross-company section: "held back (damaged)" |
| Inspect | `/inventory/stock?action=check&codes=<ID>` (Phase 2 address; also More actions on the item or unit). The form asks the **condition after the check**; good or fair releases it. Movement kind `condition_check` ("Inspected" in History) |
| Who may clear it | A warehouse operator at that location, or a founder: `inv_check_condition` through `inv_loc` (`S:2749`). **Unchanged in Phase 2** (open decision 1 in `inventory.md` section 10) |
| Evidence | `Flow P2` (held after a return, visibly unavailable on Stock and on the unit, refused by the database when given out, cleared by Inspect); `Flow P1`; `packages/rls-tests/test/inventory_phase1_job_flow.rls.test.ts` (who may clear it) |

## 8. Repairs, adjustments and corrections

| Action | What it does | Function | Who | Evidence |
|---|---|---|---|---|
| Send for repair | The unit leaves the shelf for a repairer (reference required); not available | `inv_repair_out` (`S:2408`) | operator | `Code` |
| Back from repair | Records the condition it came back in; good is available, anything else is held | `inv_repair_in` (`S:2466`) | operator | `Code` |
| Mark missing | A unit on the shelf, or one that went out and never came back; a reason is required | `inv_adjust_stock` (`S:2804`) | operator | `Code` |
| Mark found | A missing unit turns up; it is held for checking | `inv_adjust_stock` | operator | `Code` |
| Retire (write off) | The unit or quantity leaves stock for good; the history is kept | `inv_adjust_stock` | operator | `Code` |
| Correct this entry | From a History entry: a **new** entry that names the original and gives the right total for counted lines that were received, opened, found, counted or used up. The original is never changed | `inv_correct_movement` (`S:2907`); `components/inventory/stock/movement-correct.tsx` | people who may confirm stock | `Code` (`panels.test.tsx`) |
| Check a transaction | Asks whether an entry with a given key was recorded; changes nothing | `inv_transaction_status` | readers of History | `Code` |

Each uses the same form and review step, so the effect ("From", "To", the reason) is shown before Confirm. None was driven in a browser in Phase 2; `inventory-flow-1-stock-to-reconcile.mjs` drives corrections and was **not re-run**.

## 9. Kits

A kit is an item tracked as a box with its own ID and a checklist of what belongs in it. **Edit the checklist** (`inv_set_kit_line`, `S:2703`; catalogue rights) says what belongs; **Pack the kit** (`inv_pack_kit`, `S:2520`) records, line by line, what is in the box now, missing or substituted; **Unpack the kit** (`inv_unpack_kit`, `S:2636`) puts the contents back on the shelf. A unit packed in a kit is not available on its own. `web/components/inventory/stock/kit-forms.tsx`. Evidence: `Code` (`kit-forms.test.tsx`); not driven in Phase 2.

## 10. Labels, QR and scanning

| Part | How it works | Source | Evidence |
|---|---|---|---|
| Label | A unit's permanent ID (`<company code>-E-nnnnn`) and a QR that holds only a web address ending in the ID; a bin label (`-S-`) for counted stock in one bin | `packages/domain/src/inventoryCodes.ts`; `web/components/inventory/label-sheet.tsx` | `Code` (`label-sheet.test.tsx`) |
| Print | `/inventory/labels?codes=` or `?item=`: a sheet of labels; printing is recorded (`inv_record_label_print`, `S:1208`) | `web/app/(app)/inventory/labels/page.tsx` | `Code` (`labels/page.test.tsx`) |
| Scan page | `/inventory/scan` (camera or typed code), `/inventory/scan?c=CODE` (the address in the QR; a signed-out visitor signs in and comes back). A code the person may see opens its record; anything else gets one message that does not say whether the code exists. A pending list lets several codes continue to one form | `web/app/(app)/inventory/scan/page.tsx`; `components/inventory/setup/scan-view.tsx` | `Code` (`scan/page.test.tsx`, `scan-view.test.tsx`); `Flow TL` (scan address) |
| Scan inside a form | Adds the item to the list; a repeat says "already on the list"; a code that is not an Inventory label, or not available, is said and nothing is added; the entered work is kept. Counted stock always needs its quantity typed | `lines-editor.tsx`; `scan-engine.ts`, `qr-scanner.tsx` | `Code` (`movement-form.test.tsx`: scanning) |
| Camera | Decoding with `jsqr` | `components/inventory/scan-engine.ts` | `Unverified` on a real phone camera (tested with generated images only) |

## 11. Counts and opening stock

| | |
|---|---|
| Route | `/inventory/manage?section=admin#counts`; a count opens in a side panel (`?count=<id>`) |
| Kinds | **Opening count**: brings units and quantities in for the first time. **Cycle count**: re-checks a place and records each difference as a correction with a reason |
| Users | Start and enter lines: operator at that location, or a founder (`inv_start_count`, `inv_save_count_line`, `S:1240,1259`). Confirm: people who may confirm stock (`inv_confirm_count`, `S:1383`). Cancel: an operator at the location or a confirmer, with a reason (`inv_cancel_count`, `S:1481`) |
| Inputs and defaults | Start a count: the location (the working warehouse preselected when the person may count there, Phase 2), the kind, a note. The dialog says what starting and confirming will do before it is started (Phase 2) |
| Effect | Starting changes no stock. Confirming an opening count turns the counted units and quantities into verified stock; confirming a cycle count records each difference as a correction. The confirm panel says so before the button, and is refused until every difference has a reason |
| Equipment already out | "Record equipment already with employees or on projects" (`inv_confirm_opening_custody`, `S:1504`; confirm stock): units and quantities that are already out when Inventory starts are confirmed where they are, never counted on a shelf. The form says how many lines become stock and where they will show before Confirm (Phase 2) |
| Screens | `web/components/inventory/setup/counts-section.tsx`, `count-sheet.tsx`, `opening-custody.tsx` |
| Evidence | `Code` (`count-sheet.test.tsx`, `manage/page.test.tsx`). The count workflow is driven by `inventory-flow-1-stock-to-reconcile.mjs`, **not re-run**; the Phase 2 effect lines and the preselected location are `Code` only |

## 12. Setup (`/inventory/manage`)

`web/app/(app)/inventory/manage/page.tsx`. Reached by founders, catalogue managers, people who may confirm stock and warehouse operators (the last three for counts and bins); everyone else is told who it is for. Every change is made by a database function that checks the right again.

Since Phase 2 the page has **four groups**, chosen by `?section=` and shown as tabs (a two by two grid on a phone). It opens on the first.

| Group | What is in it | Function and who | Evidence |
|---|---|---|---|
| **Warehouses and bins** (default) | The company's locations (name, code, kind, time zone, status), the working warehouse first and marked **Working here**; **Add a location**, Edit; **Add bins** or **Bins (N)** on each row opens that warehouse's bins | `inv_save_location` (founder, `S:760`); `inv_save_bin` (catalogue rights, `S:809`) | `Flow P2` (phone and desktop: found, a bin added, another company's own Dubai shown as a separate record) |
| **Catalogue and tracking** | The four tracking methods with what each means and how many items use it (linked to Stock); **Add item** with the company carried (no company field); Categories; Technology templates | `inv_save_item`, `inv_save_category` (`S:877`), `inv_save_technology` and its components and status (`20261201000400:257,301,362`); catalogue rights | `Flow P2` (phone and desktop: an item added, counted-stock fields shown only after that method is chosen, then Receive stock with the item and the warehouse already there) |
| **Getting stock in** | The three ways stock enters: Receive stock (**Receive stock at <warehouse>**, the working warehouse carried), the opening stock count, equipment already out; then the Getting started checklist, read from the records | links; `computeChecklist` (`web/lib/inventory/setup.ts`) | `Flow P2` |
| **Administration** | Company record (legal name, the short name it is shown as, reference code, on/off); Sharing equipment between companies (points to People & Access); Opening stock and counts; Equipment already out; Corrections (where each kind of correction is made); Earlier asset register (founders) | `inv_set_company_code` and `inv_set_enabled` (founder, `20261201000000_inv_access_audit_settings.sql:353,383`); others as their sections | `Flow P2` (found; legal name apart from the short name). The forms inside are `Code` |

Carried forward: the **company** is the one in the address, else the company of the remembered working warehouse, else the first the person may set up; the **working warehouse** is the remembered one when it belongs to that company (`manage/page.tsx:54-62`). Old addresses keep working: `?count=` opens Administration and `?tech=` opens Catalogue and tracking (`:64`); the checklist's steps link to the group that holds them. The legal record of the company is under Administration and is said to be separate from warehouse and bin setup; the short name is display only.

Not in Setup: who may use Inventory and which locations an operator works at are in **People & Access** (`inv_grant_access`, `inv_revoke_access`, `inv_set_operator_locations`).

## 13. History (`/inventory/history`)

`web/app/(app)/inventory/history/page.tsx`; only for people who may view stock of a company (others are told so).

| Part | What it shows | Source | Evidence |
|---|---|---|---|
| The list | Newest first: when (in the time zone of the place) and the movement code, what happened and which items, quantity, **From → To**, who recorded it, the project, employee or request, the note or reason. On a phone each row is a card | `page.tsx`; `web/lib/inventory/movement-view.ts` | `Flow P2` (phone: an issue, a partial return, a transfer) |
| From → To | A warehouse (with its company when the person works with several), an employee, a project, and since Phase 2 "In transit to <warehouse>" and "In transit from <warehouse>" on a transfer, naming another company's warehouse through the narrow functions | `movement-view.ts:51`; `loadForeignPlaceNames` | `Flow P2`; `transfer-view.test.ts` |
| Filters | What happened, location (named with its company), company, dates, one item | `page.tsx` | `Code` (`history/page.test.tsx`) |
| An entry (`?open=`) | When, who, Sent from and Going to or the warehouse, **Open the transfer** (Phase 2), employee, project, request, expected back, note, reason, what it corrects and what corrected it, the dispatch or return note, the lines (what, quantity, from, to, condition), and under Transaction details the entry ID and the transaction key | `history/_panel/movement-panel.tsx` | `Flow P2` (the transfer entry); `panels.test.tsx` |
| Correct this entry; Check a transaction | Section 8 | as there | `Code` |
| Old address | `/inventory/movements` redirects here with its parameters | `movements/page.tsx` | `Code` |

Movement words changed in Phase 2: "Transfer sent", "Transfer received", "Inspected" (`web/lib/inventory/words.ts`).

## 14. Dispatch notes and return checklists (as they behave)

| | |
|---|---|
| What they are | A frozen, numbered copy of what a dispatch to a project (`<code>-D-nnnnn`) or a return from one (`<code>-RT-nnnnn`) recorded, shown to the project's Project Manager to acknowledge or to report a difference. The movement stays the only authority: a note, an acknowledgement or a difference never moves stock |
| Switch | Per company, `inv_company_settings.project_notes_enabled`, **off by default**. With it off, dispatches and returns behave exactly as before and no note is made. Turning it on is `inv_set_project_notes` (founder), `20261217000100_inv_project_notes.sql:192` |
| Gap | **There is no screen for the switch**: no code in `apps/web/src` calls `inv_set_project_notes`, so a company's notes can only be switched on by SQL, which is the owner's decision. Its hosted state is `Unverified` |
| When on | The note is made inside the movement transaction (`inv_make_project_note`, `:214`). The result of the dispatch or return shows the note number and its PDF (`movement-review.tsx`); the project's Equipment tab lists notes with **Acknowledge** or **Report a difference** for the Project Manager, an acting one or a Projects founder (`inv_ack_project_note`, `:328`; `components/inventory/notes/`); a reported difference is a row on Today that a warehouse operator at the location answers (`inv_resolve_note_difference`, `:427`); History shows the note on the entry |
| PDF | `/projects/[id]/equipment/notes/[noteId]/pdf` (`web/app/(app)/projects/[id]/equipment/notes/[noteId]/pdf/route.tsx`) |
| Scope | Project dispatches and returns only. **A warehouse transfer, an employee issue or return and a receipt make no note** |
| Evidence | `Code` (`components/inventory/notes/notes.test.tsx`, `lib/inventory/project-notes*.test.ts`, `lib/actions/inventoryNotes.test.ts`); driven by `inventory-project-notes-flow.mjs`, **not re-run**. Unchanged in Phase 2 |

## 15. Earlier asset register (legacy import), as it behaves

| | |
|---|---|
| What it is | The HR Assets register that existed before Inventory. A founder can bring an asset into Inventory as a unit, choosing the catalogue item and the location **for every row**; nothing is guessed |
| Route | `/inventory/manage?section=admin#legacy` (founders only) |
| Preview | `inv_preview_legacy_assets` (`20261201000500_inv_employee_legacy.sql:479`): every asset of the company with its tag, category, status, who holds it and whether it is already linked. Purchase date and value only with `view_costs` |
| Import | `inv_import_legacy_assets` (`:511`): for each chosen row, creates a unit linked to the asset (`inv_units.legacy_asset_id`); returns created and skipped rows with the reason. Retired or already linked assets are not importable |
| After import | The asset is managed in Inventory: the HR asset and its assignments refuse direct edits ("This item is managed in Inventory. Use Inventory to issue or return it.", triggers `inv_legacy_guard_assets`, `inv_legacy_guard_assignments`), and giving or returning the unit in Inventory keeps the HR record in step (`inv_mirror_legacy`) |
| Gaps | No undo of an import. Assets never imported stay in the HR register and behave as before. Only individual items can be chosen (the register has no quantities). Whether any hosted asset has been imported is `Unverified` |
| Evidence | `Code` (`components/inventory/setup/legacy-import.tsx`, the functions' own comments, `lib/inventory/setup.test.ts`). Not driven in a browser in Phase 2 |

## 16. What Phase 2 changed, in one place

| Area | Before | Now | Where |
|---|---|---|---|
| Transfer record | A page only for transfers between companies | One page for every transfer: both companies and warehouses, sent, received, still in transit, who acts next, Receive this transfer | `transfers/[id]/page.tsx`, `lib/inventory/transfer-view.ts`, `transfer-data.ts` |
| Receiving | "Everything on the way" preselected; "On the way (CODE)" | Nothing preselected; the form shows sent, already received, still in transit; the review names each line and where it came from; the result says received, held, still in transit | `movement-form.tsx`, `stock-movements.ts` |
| Today | Incoming transfers of the person's own company only | Incoming transfers from other companies too; transfers sent from here under Waiting on someone else | `today-data.ts`, `today.ts`, `transfer-data.ts` |
| History | "Dubai → On the way"; bare warehouse names | "Dubai → In transit to Dubai · Enginious Europe"; warehouses named with their company; the transfer linked from the entry | `movement-view.ts`, `history/page.tsx`, `movement-panel.tsx` |
| Names across companies | Legal names from the database functions | The short Inventory names everywhere | `context.ts`, `xshare-data.ts`, `stock.ts` |
| Forms | A location select even with one choice; the company not always named | One valid choice is shown, not asked; the company is always beside the warehouse; optional shipping fields folded away | `movement-form.tsx` |
| Carry-over | Receive stock from an item started empty; dialogs from an item asked for the warehouse; a request's reserved units were looked up again | The item, the working warehouse, the request's reserved units and the holder's remaining items are carried | `action-panel.tsx`, `item-panel.tsx`, `stock.ts` |
| Unit | Facts in a list, Inspect under More actions | Where, who, available, next; Inspect first for a held unit | `unit-panel.tsx`, `lib/inventory/unit-answers.ts` |
| Stock list | Held stock only lowered the count | "N not available: held or damaged" on the item | `stock/page.tsx` |
| Setup | One long page of eight panels | Four groups; company and working warehouse carried; effects said before confirming | `manage/page.tsx`, `setup/*.tsx` |
| Labels | Issue to a person, Send to another location, Return, Check condition, Check it | Give equipment, Transfer stock, Receive return, Inspect | `stock-movements.ts`, panels, `today.ts`, `words.ts` |

No migration, no new function, no new table or policy, no new dependency.
