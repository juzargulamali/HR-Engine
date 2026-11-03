# Launch package 3a: dispatch notes and return checklists, database layer: manual database steps

**Nothing here has been run on any hosted project.** This is the database part of the dispatch note / return checklist work (the PDF and the screens come in package 3b and need no SQL). It is applied by you, in the Supabase SQL Editor of **Enginious HR Engine_V2**, when you decide to. Run each file, paste the **whole** result back, and wait for a reply before the next step.

## What it adds, in plain words

When the warehouse records a dispatch to a project (or a return from it), the system can keep a **frozen, numbered copy of exactly what was recorded**: `UAE-D-00017` for a dispatch note, `UAE-RT-00005` for a return checklist (the prefix is the reference code of the **warehouse location's company**; numbers never reset and have no gaps). The project's Project Manager (PM) can **acknowledge** it, or **report a difference** on named lines. The recorded movement stays the only authority for where equipment is.

* **Never changes stock.** A note, an acknowledgement or a dispute never moves stock, never changes availability, custody, reservations or booking conflicts, never rewrites movement history, and never creates a write-off, deduction or penalty. A dispute does not change custody by itself.
* **Frozen and append-only.** Every column of a note is frozen and its history (acknowledged, difference reported, resolved...) is append-only. A guard trigger refuses any update, delete or truncate for every role, the service role and the table owner included. A correction is a **new note that cites the old one**; the old note and its events are never altered.
* **Non-blocking.** Nothing waits for the PM. The pending state lives on the note record itself (the view `inv_project_note_status`: waiting for the PM, acknowledged, difference open, superseded), so Project -> Equipment and the PM's My Day can list it later. No notice or approval is involved.
* **Who may act is decided in the database at the moment of the click:** the current PM, an acting PM whose period has not expired, or a Projects founder of the project's company; the capacity is recorded. A warehouse operator **at the location that recorded the note** (or a founder of its company) answers a difference. A PM needs no Inventory grant to read the notes of their project and still cannot read the ledger.
* **No signature wording.** The acknowledgement is "I acknowledge this recorded list" by an authenticated account (name, capacity, time); no signature image and no legal-signature claim.

## The switch (off by default) and how you turn it on

The two movement functions (`inv_dispatch_to_project`, `inv_return_from_project`) each gain **one guarded call**. It is skipped unless the company's switch `inv_company_settings.project_notes_enabled` is on, and the switch is **off for every company** after the migration. With it off, both functions behave exactly as before: the installed text equals the earlier one apart from that one skipped call (a test proves it) and the existing Inventory test suites pass unchanged.

With it on, the note is made **inside the same transaction as the movement**: there is never a dispatch without its note or a note without its dispatch, and a number is taken only if the movement is recorded. If a note cannot be made the dispatch or return is **refused with a clear message and nothing is recorded**; the answer is to switch it off (below).

There is no settings screen. You turn it on for **one company** with `inv_notes_30_switch_one_company_OPTIONAL_writes.sql` (edit one reference code, run it; it refuses if the code is wrong or Inventory is off). A founder can also call `inv_set_project_notes(company, true / false)` (audited). Recommended rollout: apply, verify, test on the branch preview with one company, then switch on.

## Steps

1. **Preflight (read-only):** `inv_notes_00_preflight_readonly.sql`. Section B must say OK on every row and "not applied yet". Section D has a row that must say `true` three times (the three functions this replaces are exactly the versions it was built on); if any says false, stop and send the result.
2. **Snapshot (read-only):** `inv_notes_05_preservation_check_readonly.sql`, exactly as it is. Keep the whole `paste` column.
3. **Apply:** paste `supabase/migrations/20261217000100_inv_project_notes.sql` into the SQL Editor and run it once (safe to run twice). It adds two tables, one view, seven functions, one column (the switch, false) and replaces three functions (`inv_next_code` gains two counter kinds, plus the two movement functions). It writes no data.
4. **Verify (read-only):** `inv_notes_20_verify_readonly.sql`; the last row must say `OK ... 0 failing`.
5. **Preservation compare (read-only):** paste the step 2 lines where the comment says `>>> PASTE <<<` and run the same file again. The summary must start with **PASS**.
6. **Switch on, later (optional, writes one column):** `inv_notes_30_switch_one_company_OPTIONAL_writes.sql`.

**Safe first response to any problem:** `inv_notes_80_switch_off_writes.sql` (switches it off for every company; every issued note and its history stay and can still be read and answered).
**Full rollback:** `inv_notes_90_rollback.sql` (read its header): restores the earlier function definitions; removes the new objects only while **no** note has been issued, otherwise keeps the notes and their history.

## Tested locally

`packages/rls-tests/test/inventory_project_notes.rls.test.ts` (39 tests): the switch off by default and result unchanged; the installed movement functions equal the earlier text apart from the guarded call; only a founder can switch; one note per movement with exactly the movement's lines (cables merged per item and condition, reserved-but-unsent items absent); replay by key returns the same note; a rolled-back movement leaves no note and consumes no number; a note failure refuses the whole movement; concurrent dispatches get distinct gap-free numbers; later renames, serial, destination and time zone edits do not change a note; update, delete and truncate refused on notes and events even for the table owner; no direct write by any signed-in role; the PM reads without an Inventory grant and cannot read the ledger; outsiders and other companies read nothing; acknowledgement by PM / acting PM / Projects founder only, expired acting PM, reassigned PM, second click returns the original, idempotent key; acknowledging changes no stock, availability, custody or reservation; differences (lines and reason required) are owned by the warehouse, an operator at another location is refused; "record stands" and "corrected" (new note citing the old, the old note and its events byte-for-byte unchanged); return checklists with totals from the ledger (a damaged unit stays held after the PM confirms); numbering by the warehouse company in a cross-company dispatch; switching off again. The whole Inventory suite and the whole RLS suite pass. The five pack files, including the rollback in both cases (note issued: kept; none issued: removed, and the three functions come back identical), were run end to end on a scratch database.

## C0.5. PDF fonts and logo (no SQL)

The plan PDF (and the coming note PDF) read the logo and the Carlito fonts through `process.cwd()`. Checked locally: the plan PDF rendered with the app's own component embeds Carlito Regular and Bold and the logo image (`pdffonts` / `pdfimages`; page checked by eye), and after a production build the build's file trace for `/projects/[id]/documents/plans/[planId]/pdf` lists `public/brand/enginious-logo.png` and both `src/lib/pdf/fonts/Carlito-*.ttf`. Vercel bundles exactly what that trace lists, so no `outputFileTracingIncludes` is needed. `apps/web/src/lib/pdf/pdf-assets.test.tsx` pins the paths and the embedding.

**Preview-deployment check (owner, I cannot run Vercel):** on the branch preview, sign in as a project member, open an issued client timeline PDF (Project -> Documents -> Plans -> PDF). It must show the ENGINIOUS logo top left and text in the same typeface as the screen (Carlito), not a plain default font. If the logo is missing or the PDF fails, tell me before the note PDF is released.
