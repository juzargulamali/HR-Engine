# Inventory: warehouse guide, acceptance checklist and first stock-taking

Plain language for the people who will use Inventory every day. The technical side is in `docs/inventory-design.md` and
`docs/inventory-deployment.md`.

## 1. The words used on the screens

| Word | Meaning |
|---|---|
| **Individual item** | One physical thing with its own ID and QR label (laptop, VR headset, holofan, motor, controller). |
| **Counted stock** | Identical things counted together on a shelf or bin (connectors, sending cards, cables). Metres can have decimals. |
| **Kit** | A box or set with its own ID and a checklist of what should be inside. |
| **Consumable** | Used up when issued (tape, cable ties, screws). It is not expected back. |
| **Not counted yet** | The record exists, but nobody has confirmed the stock yet. It is never counted as available. |
| **Usable now** | On the shelf, in good or fair condition, not inside a kit, not with an employee. |
| **Reserved** | Promised to a request for certain dates. The thing may still be on the shelf. A reservation is not a place. |
| **In transit** | Sent to another location and not yet received there. Not available at either place. |
| **Needs checking / Damaged** | Held back. Never released automatically. |

## 2. Every day

* **Scan** a label (or type the code under the QR) to open the item. Scanning never moves anything by itself.
* **Receive stock**: choose the place, add what arrived, press **Review**, check the summary, **Confirm**. Each individual item gets its own ID. Print the labels afterwards.
* **Issue / Dispatch**: to an employee, or to a project (name the request so it matches what was reserved). Give the expected return for projects.
* **Return**: for every line choose the condition. **Good: available now** finishes the check in one step. Anything else is held for checking. What is not listed stays outstanding.
* **Transfer**: sending to another location only puts the goods **in transit**. The other location presses **Receive** when they arrive (all or part).
* A quantity is **always typed**. Scanning a bin label never means "everything in the bin".
* If the screen says it could not confirm the result (a lost connection), press **Check whether it went through** before doing anything again. The same entry can never be recorded twice.

## 3. First stock-taking (nothing exists yet)

The **Setup** page has a "Getting started" list that shows which of the five steps are done, read from the real records.

1. **Categories, items and specifications.** Add categories (they are only a starting point: rename, add or remove freely). Add items. Keep different specifications apart (a 3 m and a 5 m cable are two items). Draft items are fine: you do not need the whole catalogue to start.
2. **Add the physical things.** For each location: register individual units (serial number if there is one), or count quantities in an **Opening stock** count. Counts are typed, never copied.
3. **Equipment already out.** Record equipment that is already with employees or on projects (**Equipment already out**). A unit can only be in one place: the system refuses to count it at the warehouse and with someone.
4. **Print labels** (section 4).
5. **Review and confirm opening stock.** A person with the confirm right checks the count and confirms it. From then on the stock is "counted", with who and when. Opening stock is never recorded as a purchase and never has a price unless a cost reader enters one.

Later, a **cycle count** (same screen) compares what is on the shelf with the books. Every difference needs a reason and becomes a recorded correction. Nothing is overwritten.

## 4. Printing labels

1. Open **Labels** (from an item, a unit or the Setup checklist) for one unit, several selected units, a whole item or a location.
2. Choose a size (50 × 30, 70 × 40 or 100 × 60 mm). Check the preview: a QR, the readable ID in large letters and a short name.
3. **Print**. The QR holds only a web address ending in the ID. No name, price or person is in it.
4. A damaged or lost label: print it again. It is the same ID, so no second record is created. Changing the item name, its place or its holder never invalidates a label.
5. A person who scans a label must still sign in. Without access they see a neutral message.

## 5. Warehouse acceptance checklist

Run this with the real warehouse operator on a test copy (or with test records that you remove afterwards). Tick every line.

**Setup**
- [ ] A founder can add Dubai, Riyadh and Poznan, each with its time zone and a bin or two.
- [ ] The operator is assigned to the right location only and cannot change another location's stock.
- [ ] Categories can be renamed and added.

**Stock**
- [ ] Receive 3 laptops with serial numbers: three IDs are created. A repeated serial is refused.
- [ ] Receive 20 sending cards and 150.5 m of cable: the numbers show exactly (no rounding of metres).
- [ ] Try to issue more than is in stock: refused in plain words, nothing changes.
- [ ] Double-click Confirm: only one movement exists.
- [ ] Print one label and a batch. Scan one with a phone camera (see "Not verified yet" below). The right record opens.

**Projects**
- [ ] A Project Manager prepares an equipment list for a project, adds items and a technology template, sets dates and submits.
- [ ] The warehouse reserves it. A shortage is reported clearly, with "need to buy / rent" available.
- [ ] Dispatch part of it, return part with one item **damaged**. The damaged item is not available; the rest shows as outstanding.
- [ ] Move equipment directly from one project to another: it appears with the second project and leaves the first.
- [ ] A project manager can move equipment to another project only if they manage both; the warehouse can move it between any two projects. A unit another project has reserved for later is never taken away: the move is refused and says which request holds it.
- [ ] Dispatch something to a project WITHOUT naming a request: it still shows on that project's Equipment page ("not part of a request"), with its due date, and is flagged **Overdue** once that date has passed.
- [ ] Try to reserve the same unit for overlapping dates: refused, nobody else's booking is displaced.

**Employees**
- [ ] A department head requests a laptop for an employee. The warehouse issues it. The employee sees it under **My equipment**. HR sees it under **Equipment held by employees**.
- [ ] While it is assigned, it cannot be booked for a project. After return (or reassignment to the project pool) it can.
- [ ] The warehouse screens show no salary, leave or personal data.

**Sales**
- [ ] A salesperson asks the warehouse for an availability check. It appears for the warehouse under Inventory, Requests, Sales checks waiting. The answer says who checked and when, never reserves anything, and says **Warehouse check required** when no template exists.
- [ ] Changing the dates in the enquiry makes the check "out of date"; the old check stays in the history.

**Control**
- [ ] A person without access sees no stock. A person from another company sees nothing of this company.
- [ ] Switching Inventory off (Setup) stops all changes and keeps every record. Switching it on restores it.

## 6. Mistakes and recovery

* **Wrong quantity recorded**: a person with the confirm right records a **correction** that names the entry and gives a reason. The original stays.
* **Item counted twice or in the wrong place**: do a **cycle count** with a reason.
* **Wrong tracking method on an item**: it cannot be changed once there is stock or history. Use **Replace item** (reason required); the old item keeps its history.
* **A unit that cannot be found**: mark it **missing** (reason required). It is no longer offered. If it turns up, mark it **found**; it returns "needs checking".
* **Pause everything**: Setup → switch Inventory off, or the owner's `inv_80` script. Nothing is deleted. Labels stay valid.

## 7. Sales availability checks (the warehouse's list)

A salesperson can ask the warehouse whether equipment is free for an enquiry's dates. The warehouse has no access to Sales, so the request reaches it here and nowhere else:

1. **Sales asks.** On the enquiry, **Ask the warehouse to check** (optionally naming the location). The enquiry then says "Waiting for the warehouse".
2. **The warehouse sees it.** Open **Inventory → Requests**. At the top, **Sales checks waiting** lists each request with only what is needed to answer it: the enquiry reference, the technologies with quantities, the dates, the location asked for, and who asked and when. The client, title, value and notes are never shown here.
3. **The warehouse answers.** Press **Record the check**, confirm the location, add a note if useful, and press **Record the check**. The result is worked out from stock for those dates and saved with your name and the time. The request leaves the list and the enquiry shows the result to Sales.
4. **A check never holds equipment.** To hold it, a Project Manager prepares an equipment list and the warehouse reserves it.
5. **If the enquiry's dates, location or quantities change**, the check shows **out of date**: Sales asks again. The old check stays in the history.

Who sees the list: warehouse operators for their own locations (and for requests that name no location yet), catalogue managers and Inventory founders. A founder can also press **Record the check now** on the enquiry itself.

## 8. Not verified yet

* Scanning with a real phone camera (iPhone Safari, Android Chrome) has not been tried: the decoding is tested with generated QR images and a simulated camera only. Please test it on the real phones during acceptance and tell us the result.
* Everything was tried on a local test database, not on the hosted project. Hosted verification is the owner's first step after the SQL is applied.
