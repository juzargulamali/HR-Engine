# Inventory: coverage index

**Status (2026-11-16).** Written for **Inventory Phase 2** on branch `claude/inventory-phase-2`: **merged as PR #103, merge `6526049`, pinned to head `1026308`; required CI (`lint-typecheck-test`, `rls-policies`) green on that head; no SQL in this phase (nothing to apply to the hosted database); real-phone Preview checks passed (owner-confirmed 2026-11-16, not run by Claude); Production `Unverified` (not confirmed by the owner or by Claude for `6526049`).** Every reachable Inventory screen, tab, panel, dialog, download, redirect and old route, with who can reach it, its detailed reference, its catalogue entries and its evidence. Rows `INV-01` to `INV-17` are the Phase 1 rows, moved here unchanged in number from `inventory.md` section 7; `INV-18` onwards are new.

**References.** `R` = [`inventory.md`](./inventory.md) (the project equipment job and the module's shared facts). `W` = [`inventory-workflows.md`](./inventory-workflows.md). `C` = [`inventory-action-catalogue.md`](./inventory-action-catalogue.md).

**Evidence.** `Flow P2` = driven signed in on the isolated stack by `apps/web/os-shell-checks/inventory-phase2-flow.mjs` (29 of 29, phone 390 px and desktop 1366 px). `Flow P1` = `inventory-phase1-flow.mjs`, re-run on this build (21 of 21). `Flow TL` = `inventory-transfer-location-flow.mjs`, re-run on this build (21 of 21). `Code` = read in the code, with unit or component tests where the reference names them; not driven in this phase. `Unverified` = not confirmed. A row can carry two labels when part of it was driven and part only read.

## 1. Today

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| INV-01 | Company and warehouse bar | `/inventory` (also Stock) | any Inventory grant | R 2, 4.1; W 1 | none | `Flow P1` (one company, two warehouses); `Flow P2` (two companies: company then warehouse) |
| INV-02 | Do now, Coming up, Waiting on someone else | `/inventory` | any Inventory grant | R 4.1 | none | `Flow P1` |
| INV-03 | Sales check row and its dialog | `/inventory` | warehouse, catalogue managers, founders | R 4.1 | `inventory.check.record` | `Flow P1` |
| INV-04 | Held unit row (**Inspect**) | `/inventory` | warehouse operators | R 4.1; W 7 | `inventory.unit.inspect` | `Flow P1` (row); the inspection itself `Flow P2` |
| INV-18 | Transfer on its way here (own company and from another company) | `/inventory` | people who may view stock; from another company: the receiving warehouse's operators | W 4.4 | `inventory.transfer.receive` | `Flow P2` (from another company); same company `Code` (`today.test.ts`) |
| INV-19 | Transfer sent from here, waiting on the receiving warehouse | `/inventory` | people who may view stock | W 4.4 | none | `Flow P2` |
| INV-20 | Employee return due; project return due | `/inventory` | warehouse operators | R 4.1; W 5.4 | `inventory.employee.receive_return`, `inventory.request.receive` | `Code` (`today.test.ts`) |
| INV-21 | Reported difference on a dispatch or return note | `/inventory` | warehouse operators | W 14 | `inventory.note.resolve_difference` | `Code` (`notes.test.tsx`); not re-run |

## 2. The project equipment job

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| INV-05 | Job workspace header and site runs | `/inventory/requests/[id]` | viewers of the request | R 4.2 | none | `Flow P1` |
| INV-06 | Prepare, Reserve dialog with a shortage | `?step=prepare` | warehouse operator, founder | R 4.2 | `inventory.request.reserve` | `Flow P1` |
| INV-07 | Pick | `?step=pick` | warehouse | R 4.2 | `inventory.request.pick` | `Flow P1` (typed codes); camera `Code` |
| INV-08 | Send | `?step=send` | warehouse | R 4.2 | `inventory.request.send` | `Flow P1` |
| INV-09 | Receive | `?step=back` | warehouse | R 4.2 | `inventory.request.receive` | `Flow P1` |
| INV-10 | Uncertain save: check, then send again | Pick, Send, Receive and every movement form | the person who saved | R 4.2; W 1 | none | `Code` (component tests); a retried receipt posting once `Flow P2` |
| INV-11 | Project Equipment: Availability check from Sales | `/projects/[id]/equipment` | project details readers, Operations, warehouse | R 4.3 | none | `Flow P1` |
| INV-12 | Project Equipment: Equipment by site run | `/projects/[id]/equipment` | same | R 4.3 | none | `Flow P1` |
| INV-13 | Request: Send to Warehouse, dates and site runs | `/projects/[id]/equipment`, `/inventory/requests?open=` | Project Manager, acting PM, Projects founder, warehouse | R 4.3 | `inventory.request.set_runs`, `inventory.request.send_to_warehouse` | `Flow P1` on the project page; the side panel `Code` |
| INV-14 | Sales enquiry: Warehouse stock check card | `/sales/opportunities` panel | enquiry owner, Sales founder | R 4.4 | `inventory.check.ask` | `Flow P1` |
| INV-15 | Project Plan: supply route, Match to stock | `/projects/[id]/delivery` | project managers | R 4.5 | none | `Code` (component tests) |
| INV-16 | Operations Overview: Equipment by site run | `/operations` | Operations Manager, founder | R 4.5 | none | `Flow P1` |
| INV-22 | Requests list, Add, and the request panel | `/inventory/requests`, `?open=<id>` | Inventory grant holders and project managers; a request they may not see is "not found" | W 5.1; R 4.3 | `inventory.request.create`, `inventory.request.lines`, `inventory.request.cancel` | `Code`; driven by `inventory-flow-2-employee.mjs` and `inventory-workspace-flow.mjs`, not re-run |
| INV-23 | Project dispatch and return outside a request; Move between projects | `/inventory/stock?action=dispatch|return&project=`; unit More actions | warehouse operator, founder; move: also the project's manager | W 6 | `inventory.project.dispatch_unplanned`, `inventory.project.return`, `inventory.project.move` | `Code`; not re-run |

## 3. Stock, the item and the unit

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| INV-24 | Stock list, filters, columns, held or damaged badge | `/inventory/stock` | Inventory grant or managing a running project | W 2 | none | `Flow P2` (phone: list, badge, available here); filters `Code` |
| INV-25 | Header actions: Receive stock, Give equipment, Transfer stock | `/inventory/stock` | people who may operate stock | W 2 | see INV-29, 33, 30 | `Flow P2` (shown); the header's Transfer stock link `Code` |
| INV-26 | Add item (Quick Add) | `/inventory/stock?add=1`; Setup, Catalogue and tracking | catalogue rights | W 2, 12 | `inventory.item.save` | `Flow P2` (from Setup) |
| INV-27 | Item panel: at a glance, units or stock by bin, movements, Edit details, More actions | `/inventory/stock?open=<item>` | readers; actions by right | W 2.1 | `inventory.item.save`, `inventory.item.replace`, `inventory.unit.register`, `inventory.label.bin` | `Flow P2` (Receive stock with the item carried); the rest `Code` (`panels.test.tsx`) |
| INV-28 | Unit panel: where, who, available, next; first buttons; More actions; about; history | `/inventory/stock?unit=<id or code>` | people who may view stock | W 2.2 | several | `Flow P2` (available and held units, Inspect, Give equipment, Transfer stock); the rest `Code` |
| INV-29 | Receive stock (owned or rented) | `?action=receive` (`&item=`, `&location=`) | warehouse operator, founder | W 3 | `inventory.stock.receive` | `Flow P2` (owned, item and warehouse carried); rented `Code` |
| INV-30 | Transfer stock (send) | `?action=transfer` (`&codes=`) | operator at the sending warehouse | W 4.1 | `inventory.transfer.send` | `Flow P2` (phone); `Flow TL` |
| INV-31 | Receive transfer | `?action=transfer&mode=receive&transfer=` | operator at the receiving warehouse | W 4.2 | `inventory.transfer.receive` | `Flow P2` (phone, partial, retried, remainder); `Flow TL` |
| INV-32 | Transfer record | `/inventory/transfers/[id]` | both sides of a transfer between companies; stock readers of the company for a transfer inside it | W 4.3 | none | `Flow P2`, `Flow TL` (between companies); the same-company read `Code` |
| INV-33 | Give equipment | `?action=issue` (`&codes=`, `&employee=`, `&request=`) | warehouse operator, founder | W 5.2 | `inventory.employee.give` | `Flow P2` (from a unit); from a request with reserved units carried `Code` only |
| INV-34 | With people | `/inventory/stock?view=people` | custody readers, warehouse operators, founders | W 5.3 | none | `Flow P2` |
| INV-35 | Receive return from an employee | `?action=return&employee=` (`&codes=`) | warehouse operator, founder | W 5.4 | `inventory.employee.receive_return` | `Flow P2` (partial, one damaged, remainder) |
| INV-36 | Inspect | `?action=check&codes=`; More actions | operator at the warehouse, founder | W 7 | `inventory.unit.inspect` | `Flow P2` |
| INV-37 | Send for repair; Back from repair | More actions | operator | W 8 | `inventory.unit.repair_out`, `inventory.unit.repair_in` | `Code` |
| INV-38 | Mark missing; Mark found; Retire | More actions | operator | W 8 | `inventory.stock.adjust` | `Code` |
| INV-39 | Use up; Return unused (consumables) | item More actions | operator | W 2.1 | `inventory.consumable.use`, `inventory.consumable.return_unused` | `Code` |
| INV-40 | Return rental to supplier | unit More actions | operator | W 3 | `inventory.rental.return` | `Code` |
| INV-41 | Change who holds it | unit More actions | warehouse | W 5.4 | `inventory.unit.reassign` | `Code` |
| INV-42 | Kits: checklist, pack, unpack | unit More actions | pack and unpack: operator; checklist: catalogue rights | W 9 | `inventory.kit.checklist`, `inventory.kit.pack`, `inventory.kit.unpack` | `Code` (`kit-forms.test.tsx`) |
| INV-43 | Equipment of other companies at your warehouses; Transfers between companies | `/inventory/stock` (below the list) | people who operate stock | W 2 | none | `Flow P2`, `Flow TL` |
| INV-44 | Another company's unit (minimal record) | `/inventory/stock?unit=<code>` | the receiving warehouse's operators | W 2.2 | none | `Flow TL` |
| INV-45 | My equipment | `/inventory/mine` | every employee | W 5.3 | none | `Flow P2` (phone) |
| INV-46 | Scan in a side panel | `/inventory/stock?action=scan` | everyone here | W 10 | none | `Code` (`scan-panel.test.tsx`) |

## 4. Labels and scanning

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| INV-47 | Scan page, the QR address, the pending list | `/inventory/scan`, `/inventory/scan?c=CODE` | signed-in people; a code they may not see says nothing | W 10 | none | `Code` (`scan/page.test.tsx`, `scan-view.test.tsx`); the QR address `Flow TL`; a real phone camera `Unverified` |
| INV-48 | Label sheet and print | `/inventory/labels?codes=|item=` | people who may view stock | W 10 | `inventory.label.print` | `Code` (`labels/page.test.tsx`) |

## 5. History

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| INV-49 | The list, filters, pages | `/inventory/history` | people who may view stock | W 13 | none | `Flow P2` (phone: transfer, issue, return rows); filters `Code` |
| INV-50 | An entry: lines, source and destination, transfer link, note, corrections | `/inventory/history?open=<id>` | same | W 13 | none | `Flow P2` (a transfer entry); the rest `Code` (`panels.test.tsx`) |
| INV-51 | Correct this entry | an entry | people who may confirm stock | W 8 | `inventory.movement.correct` | `Code` |
| INV-52 | Check a transaction | `/inventory/history` | readers | W 8 | none | `Code` |

## 6. Setup

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| INV-17 | Company record: legal name and the short name | `/inventory/manage?section=admin#settings` | Setup viewers; founders change it | R 2; W 12 | `inventory.company.code`, `inventory.company.enabled` | `Flow P2` (read); the forms `Code` |
| INV-53 | Setup shell: company, working warehouse, four groups | `/inventory/manage` | founders, catalogue managers, confirmers, warehouse operators | W 12 | none | `Flow P2` (phone and desktop; a person without rights) |
| INV-54 | Warehouses and bins | `/inventory/manage` | read: Setup viewers; locations: founder; bins: catalogue rights | W 12 | `inventory.location.save`, `inventory.bin.save` | `Flow P2` (a bin added) |
| INV-55 | Catalogue and tracking: tracking methods, Add item, Categories | `?section=catalogue` | catalogue rights to change | W 12 | `inventory.item.save`, `inventory.category.save` | `Flow P2` (an item added); categories `Code` |
| INV-56 | Technology templates and the editor | `?section=catalogue#technologies`, `?tech=<id>|new` | catalogue rights | W 12 | `inventory.technology.save` | `Code` (`manage/page.test.tsx`); driven by `inventory-flow-3-sales.mjs`, not re-run |
| INV-57 | Getting stock in and the Getting started checklist | `?section=stock` | Setup viewers | W 12 | none | `Flow P2` |
| INV-58 | Sharing equipment between companies (pointer) and the form in People & Access | `?section=admin#sharing`; `/people-access` | founder of the owning company | W 4.5 | `inventory.sharing.set` | `Flow P2` (the pointer); the form `Flow TL` through the function, the People & Access screen not re-run |
| INV-59 | Opening stock and counts; the count sheet | `?section=admin#counts`, `?count=<id>` | start and count: operator; confirm: confirm stock | W 11 | `inventory.count.start`, `inventory.count.line`, `inventory.count.confirm`, `inventory.count.cancel` | `Code` (`count-sheet.test.tsx`); driven by `inventory-flow-1-stock-to-reconcile.mjs`, not re-run |
| INV-60 | Record equipment already with employees or on projects | `?section=admin#custody` | confirm stock | W 11 | `inventory.opening.custody` | `Code` |
| INV-61 | Corrections (where each is made) | `?section=admin#corrections` | Setup viewers | W 8, 12 | none | `Flow P2` (found) |
| INV-62 | Earlier asset register | `?section=admin#legacy` | founders | W 15 | `inventory.legacy.import` | `Code`; not driven |

## 7. Notes, old routes and other modules

| # | Screen or part | Route | Who reaches it | Reference | Catalogue | Evidence |
|---|---|---|---|---|---|---|
| INV-63 | Dispatch and return notes on the project; the PDF | `/projects/[id]/equipment`; `/projects/[id]/equipment/notes/[noteId]/pdf` | project members; the Project Manager answers | W 14 | `inventory.note.answer` | `Code`; driven by `inventory-project-notes-flow.mjs`, not re-run. The company switch has no screen (gap) |
| INV-64 | Employee's Assets tab: Inventory holdings | People, an employee | custody readers | W 5.3 | none | `Code` (`employee-equipment-link.test.tsx`) |
| INV-65 | Old routes | `/inventory/movements` (to History), `/inventory/employees` (to With people), `/inventory?unit=…` and the other stock-list parameters (to Stock), `/inventory/access` (to People & Access) | as the target | W 13; `web/lib/inventory/legacy-redirect.ts` | none | `Code` (`legacy-redirect.test.ts`) |
| INV-66 | Not installed; could not load | every Inventory route | everyone | `web/app/(app)/inventory/layout.tsx` | none | `Code` (`context-failures.test.ts`) |
| INV-67 | Inventory access and operator locations | `/people-access` | Inventory access managers, founders | `03-roles-access-and-approvals.md` | `inventory.access.grant`, `inventory.access.locations` | `Code`; driven by `inventory-flow-5-access.mjs`, not re-run |

Total: 67 entries (`INV-01` to `INV-67`): Today 8, the project equipment job 14, Stock, the item and the unit 23, Labels and scanning 2, History 4, Setup 11, Notes, old routes and other modules 5.

## 8. Named gaps

1. A real phone and a real camera scan: `Unverified` (every phone check here is a 390 px browser).
2. Give equipment from an employee request with the reserved units carried (INV-33): written and typechecked, **not driven**.
3. The same-company read of the transfer record (INV-32): written, **not driven**.
4. The header's Transfer stock link, the per-item Receive return link under With people, the operator's Receive return on My equipment, the preselected count location and the effect lines on counts, opening custody and sharing: **not driven**.
5. Repairs, adjustments, corrections, kits, counts, technology templates, dispatch and return notes, the legacy import, the request list, People & Access: read in code; their own browser checks exist and were **not re-run** in Phase 2.
6. The dispatch and return notes switch has no screen (INV-63).
7. Anything hosted: not touched and not verified by Claude.
