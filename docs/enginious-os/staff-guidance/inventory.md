# Staff guidance: Inventory

Approved, staff-facing guidance. JARVIS answers "how do I" questions from the topics below that are marked `published` (see [README](./README.md)).

## Warehouse and equipment
- id: inventory-where
- area: inventory
- status: published
- keywords: inventory; warehouse; equipment; stock; request equipment; equipment request; scan; qr; transfer; my equipment; book equipment; return equipment; book inventory; find equipment requests; equipment requests; stock levels
- links: Inventory -> /inventory; Equipment requests -> /inventory/requests; My equipment -> /inventory/mine
- screens: /inventory; /inventory/requests; /inventory/mine; /inventory/stock

Inventory is where equipment is requested, sent out and received back. On Today a request reads ready to send in part while any line is still to reserve, buy or rent; those lines are counted apart and never as reserved. The equipment assigned to you is under My equipment. JARVIS cannot read or change inventory: use the screens.

1. Open Today in Inventory for the warehouse's jobs.
2. Open Requests to prepare, send out and receive back equipment.
3. Open My equipment to see what is assigned to you.

## Today in the warehouse: Do now, Coming up, Waiting on someone else
- id: inventory-today-jobs
- area: inventory
- status: published
- keywords: warehouse today; do now; coming up; waiting on someone else; what do I do next; shortage; how many are missing; who acts; choose company; choose warehouse; all companies; held for checking; sales check
- links: Today -> /inventory
- screens: /inventory

Today shows the company and the warehouse you are working in, then three lists. Do now is work this warehouse can act on today. Coming up is the same work with a date that has not come. Waiting on someone else is work the warehouse cannot move on by itself: each row says how many are missing and who has to act. Each row is one job, and its button opens the next step.

1. Check the company and the warehouse at the top. With more than one company, choose the company first, then its warehouse. All companies only changes what you see.
2. Under Do now press the button on a job: Prepare equipment, Pick items, Send equipment, Receive return, Receive transfer, Check availability or Inspect.
3. Read Waiting on someone else: a shortage says how many are missing and who acts; a transfer you sent says which warehouse has to receive it.
4. Use Scan a label to look a unit up. Scanning never changes stock.

## Prepare, pick and send a job
- id: inventory-job-pick-send
- area: inventory
- status: published
- keywords: pick items; picking; send equipment; dispatch; reserve; short; partly reserved; bin; scan a code; wrong item; already scanned; requested reserved picked sent; partial dispatch; check whether it went through
- links: Today -> /inventory
- screens: /inventory/requests/[id]

The same job is open at every step: Prepare, Pick, Send, Receive. Each item shows Requested, Reserved, Picked and Sent. Reserving holds equipment for the dates; picking records that it was taken off the shelf and moves no stock; sending is what makes it leave. A line that is not fully reserved stays short and is never counted as done.

1. Prepare: press Reserve on each line. If not everything is free, choose Need to buy or Need to rent for the rest.
2. Pick: scan or type each code, or tick the units, using the bin shown; count the picked quantity of counted items. Press Pick items.
3. A wrong or repeated code is said beside the scan box and is not added. Take a wrong code off the list to continue.
4. Send: what was picked is already ticked. Correct it if needed, press Send equipment, check the list and confirm.
5. If a save does not finish in time, press Check whether it went through before trying again. Your list is kept.

## Receive a return and inspect it
- id: inventory-job-receive
- area: inventory
- status: published
- keywords: receive return; return equipment; partial return; damaged; held for inspection; still out; condition; available again; inspect; clear a damaged unit; check condition; inspection
- links: Today -> /inventory; Stock -> /inventory/stock
- screens: /inventory/requests/[id]

Receive starts from what was sent and is still out, so nothing is typed again. You record what came back and its condition; what you leave unticked stays out. Good equipment is available again at once. Damaged equipment, or equipment needing a check, is held and cannot be reserved until warehouse staff at that warehouse inspect it and record the check.

1. Open the job from Today with Receive return, or open the job and choose Receive.
2. Tick each unit that is back and choose its condition; type how many counted items came back.
3. Read the line beside the button, for example 2 returned, 1 available, 1 held for inspection, 1 still out.
4. Press Receive return, check the list and confirm.
5. To clear a held unit, open it from Today under Do now with Inspect, press Inspect on the unit, and record its condition.

## Send a transfer to another place
- id: inventory-transfer-send
- area: inventory
- status: published
- keywords: transfer stock; send to another warehouse; move stock; move equipment between warehouses; transfer to another company; in transit; send to riyadh; send to dubai; which dubai; shipping details; who acts next
- links: Stock -> /inventory/stock; Today -> /inventory
- screens: /inventory/stock

A transfer moves stock from one warehouse to another. It is in transit, and available at neither warehouse, until the other warehouse receives it. Every warehouse is named with its company, for example Dubai · Enginious UAE, because two companies can each have a warehouse in the same city. A transfer never changes who owns the equipment.

1. Open the unit or the item in Stock and press Transfer stock, or press Transfer stock above the list. The warehouse you are working in is already filled in.
2. Choose Send to. Read the company beside the warehouse name before you choose.
3. Add what is going: scan or search for units; type the quantity of counted items.
4. Press Review. Check From, To and Who acts next, then press Confirm and send.
5. On Today the transfer waits under Waiting on someone else until the other warehouse receives it.

## Receive a transfer
- id: inventory-transfer-receive
- area: inventory
- status: published
- keywords: receive transfer; transfer arrived; partial receipt; only some arrived; still in transit; outstanding; damaged in transit; transfer from another company; owned by; receive against transfer; open the transfer
- links: Today -> /inventory; Stock -> /inventory/stock
- screens: /inventory/transfers/[id]

You receive against the transfer that was sent, so nothing is typed again. The form shows where it came from, where it is received, how many lines were sent, how many were already received and what is still in transit. Nothing is assumed to have arrived: you say whether everything came or only some of it. What you do not receive stays in transit and the transfer stays open.

1. On Today press Receive transfer on the row, or open the transfer and press Receive this transfer.
2. Choose Everything still in transit arrived, or Only some of it arrived.
3. For only some, add each line that came, type the quantity of counted items and choose the condition. Damaged is held for inspection.
4. Press Review, then Confirm arrival. Read the result, for example 3 received, 1 held for inspection, 2 lines still in transit.
5. Open the transfer to see what was sent, received and is still in transit, and who acts next.

## Receive a new delivery, owned or rented
- id: inventory-receive-stock
- area: inventory
- status: published
- keywords: receive stock; new stock; delivery arrived; bought equipment; rented equipment; rental; owned or rented; serial numbers; goods in; supplier
- links: Stock -> /inventory/stock
- screens: /inventory/stock

Receive stock records new equipment on the shelf at one warehouse of one company. Items tracked one by one get their own ID and label; counted items get a quantity. You always say whether it is owned or rented: rented stock goes back to its supplier and never adds to what the company owns.

1. Open the item in Stock and press Receive stock: the item and your warehouse are already filled in. Or press Receive stock above the list and search for the item.
2. Choose Owned or Rented. For rented, add the supplier, its reference and the date it has to go back.
3. Type how many arrived. Serial numbers, condition and cost are under More details.
4. Press Review, check the list and confirm. Print the new labels from the item.
5. If the item is not in the list yet, add the item first, then receive it.

## With people: give out and receive back
- id: inventory-give-return
- area: inventory
- status: published
- keywords: give equipment; issue equipment; issue to employee; with people; who has it; receive return from employee; return my equipment; my equipment; equipment assigned to me; employee equipment request; hand back; left the company
- links: Stock -> /inventory/stock; My equipment -> /inventory/mine; Equipment requests -> /inventory/requests
- screens: /inventory/mine

The warehouse gives equipment to an employee and receives it back; the employee sees it under My equipment. Start from what already knows the most: the unit, the employee's request, or the person's row under With people. A return lists what the person still holds; you add what came back and choose its condition. What you do not add stays with them.

1. To give: open the unit in Stock and press Give equipment, or open the employee's request and press Give equipment. Choose the person once.
2. To receive: open Stock, With people, and press Receive return on the person's row.
3. Add each item that came back and choose its condition. Damaged is held for inspection.
4. Press Review and confirm. Read the result, for example 2 returned, 1 available, 1 held for inspection, 1 still out.
5. Employees: to return something, hand it to the warehouse. It leaves My equipment when the warehouse records it.

## Where is it, who has it, is it available
- id: inventory-find-equipment
- area: inventory
- status: published
- keywords: where is it; who has it; is it available; find a unit; stock list; available here; not available; held or damaged; in transit; out for repair; missing; mark missing; send for repair; kit; pack a kit; unit history
- links: Stock -> /inventory/stock; Scan -> /inventory/scan
- screens: /inventory/stock

Stock lists every item with how many are available at the warehouse you chose. Open an item for its units, or scan a label. A unit says where it is now, who has it, whether it is available and what to do next. Damaged equipment and equipment held for inspection are not available until a warehouse operator inspects them.

1. Open Stock and check the company and warehouse at the top.
2. Search by name, model, serial number or ID, or press Scan a label.
3. Open the item, then a unit. Read Where is it now, Who has it, Is it available and What to do next.
4. Use the first button for the next step. Repairs, missing or found equipment, kits and write-offs are under More actions.
5. A row that says not available: held or damaged has units waiting for Inspect.

## History: read what happened and when
- id: inventory-history
- area: inventory
- status: published
- keywords: history; movements; what happened; who moved it; when was it sent; correct a mistake; correction; check a transaction; transfer sent; transfer received; reconcile
- links: History -> /inventory/history
- screens: /inventory/history

History lists every movement of stock, newest first: when, what happened, how much, from where to where, who recorded it, and the project, person or request it was for. A transfer shows both warehouses with their companies and links to the transfer. Nothing in History is deleted: a mistake is put right by a new entry that names the one it corrects.

1. Open History. Filter by what happened, location, company or dates.
2. Open a row for its lines, its note and the related request or transfer.
3. On a transfer row press Open the transfer to see what was sent, received and is still in transit.
4. To put right a counted quantity recorded by mistake, open its entry and use Correct this entry. People who may confirm stock can do this.
5. Use Check a transaction when a save may not have gone through.

## Warehouses and bins, tracking and getting stock in
- id: inventory-setup
- area: inventory
- status: published
- keywords: warehouses and bins; bins; bin; locations; how is it tracked; individual; counted; consumable; categories; opening count; cycle count; sharing between companies; reference code; earlier asset register; administration
- links: Setup -> /inventory/manage; Stock -> /inventory/stock; People & Access -> /people-access
- screens: /inventory/manage

This screen has four parts, in the order you need them: Warehouses and bins, Items and tracking, Getting stock in, and Administration for things needed now and then. It opens on the company of the warehouse you last worked in. Founders add warehouses; people who manage items add items, categories and bins.

1. Warehouses and bins: add a warehouse, then press Add bins on its row.
2. Items and tracking: press Add item, name it and choose how it is tracked. Only the fields that way needs are shown.
3. Getting stock in: press Receive stock for new deliveries. It opens with your warehouse filled in.
4. Administration: the company record, sharing between companies, opening stock and counts, corrections and the earlier asset register.
5. Each change says what it does before you confirm it.

## Labels and QR codes
- id: inventory-labels-scan
- area: inventory
- status: published
- keywords: print labels; qr label; qr code; scan a label; scan; camera; type the code; bin label; label not found; wrong label; scan several
- links: Scan -> /inventory/scan; Stock -> /inventory/stock
- screens: /inventory/scan; /inventory/labels

Every unit has a permanent ID and a QR label; counted items can have a label for a bin. Scanning only finds the record: it never changes stock. You can always type the code instead of using the camera. A code that is not an Inventory label, or that is not available to you, is said so and nothing is added.

1. Press Scan a label on Today or Stock, or open Scan.
2. Point the camera at the QR code, or type the code printed on the label.
3. To handle several, add each code to your list on Scan, then continue to one form for all of them.
4. To print, open the item or unit in Stock and choose Print label, or Print labels for all units.
5. Inside a form, scanning adds the item to the list. Counted items still need their quantity typed.

