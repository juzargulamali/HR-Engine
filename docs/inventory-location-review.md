# Inventory locations: review of "Dubai under different companies"

## What the code says (no hosted data was read)
* A location belongs to exactly one company (`inv_locations.company_id`); code and name are unique only **within** a company
  (`20261201000100_inv_catalogue_stock_ledger.sql`). Two companies can therefore each have a "Dubai". Nothing shares a location
  across companies.
* Nothing creates locations for you: no default "Dubai" on company set-up, no seed or import. Only a company's Inventory founder
  creates one (`inv_save_location`). The local test seed creates Dubai and Riyadh under one company, Poznan under another.
* So several "Dubai" rows mean that founders created them, one per company: **separate facilities, duplicates or an ownership
  workaround cannot be told apart from code. It is a data question for the owner.** Whose equipment sits there is a different fact:
  a unit keeps its owning company wherever it is, and "Owned by ..." is now shown where the place is run by another company.

## Read-only query
`supabase/manual-sql/inv_locations_review_readonly.sql` (SELECT only): every location with company, code, name, status and how many
units, stock rows, movements, open requests, transfers (all and in transit), open counts and operators refer to it, plus how many
equally named locations exist.

## Proposed mapping (owner fills in; nothing is changed by this document)
| location id | company | current name | proposed role: keep / rename / merge candidate / archive | reason | impact |
|---|---|---|---|---|---|
| | | | | | |

## Decision rules
1. **Keep** a location that is a real, separate place where stock physically is (units or stock rows, or movements in the last year).
   If its name repeats under another company, **rename** it "Dubai — <Company>" so people can tell them apart (the app already shows
   the company next to the name when someone works with several).
2. **Merge candidate** when two same-named rows are the same shelves: one holds the stock, the other was created to record ownership.
   Merging is NOT available as a function: it needs a written plan (move stock by real transfers, keep movement history), so do not
   edit rows. Only after that plan, switch the emptied one off.
3. **Archive** (switch off) only a location with 0 units, 0 stock rows, 0 open requests, 0 transfers in transit and 0 open counts
   (the app already refuses to switch off a place that still holds stock or has transfers on the way). History is never deleted.
4. If units show "owned by another company" at a location, that equipment was moved there under an owner's sharing authorisation: it is
   not a duplicate, and the owner should be recorded as the owner, not by creating a second location.
5. If unsure, keep and rename; renaming changes no stock, owner or history.
