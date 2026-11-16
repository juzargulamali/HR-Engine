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
2. Under Do now press the button on a job: Prepare equipment, Pick items, Send equipment, Receive return, Check availability or Check it.
3. Read Waiting on someone else for shortages: the line says how many are missing, whether it is to buy or to rent, and who acts.
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
- keywords: receive return; return equipment; partial return; damaged; held for inspection; still out; condition; available again; inspect; clear a damaged unit; check condition
- links: Today -> /inventory; Stock -> /inventory/stock
- screens: /inventory/requests/[id]

Receive starts from what was sent and is still out, so nothing is typed again. You record what came back and its condition; what you leave unticked stays out. Good equipment is available again at once. Damaged equipment, or equipment needing a check, is held and cannot be reserved until warehouse staff at that warehouse inspect it and record the check.

1. Open the job from Today with Receive return, or open the job and choose Receive.
2. Tick each unit that is back and choose its condition; type how many counted items came back.
3. Read the line beside the button, for example 2 returned, 1 available, 1 held for inspection, 1 still out.
4. Press Receive return, check the list and confirm.
5. To clear a held unit, open it from Today under Do now with Check it, and record its condition after inspecting it.
