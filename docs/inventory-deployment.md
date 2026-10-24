# Inventory — deployment guide

This is the owner's runbook for **Inventory**, the third module of ENGINIOUS OS (after Sales & CRM and Projects & Tasks). It is written so you can run it
step by step in the Supabase SQL Editor of **Enginious HR Engine_V2** (the only project to use) and then decide when to merge.

**Nothing in this change runs Production SQL, creates Production data, grants anyone real access, merges, deploys, enables a scheduled
job, sends e-mail, or creates a single item, location or category.** The pull request is a draft. Every step below is yours to run, in this
order, and each step has a check before the next one. Design and decisions: [inventory-design.md](./inventory-design.md).

> **Honest status.** Verified locally: real-PostgreSQL/RLS tests of every migration, and every owner script of this guide rehearsed
> against a **throwaway local database** built from all migrations (see §12 for exactly what). **Not verified live:** nothing has run
> against your hosted Supabase project, Vercel, label printers, phone cameras for QR scanning, or real warehouse staff. §12 lists what to
> try yourself and what still needs a real working week.

---

## 1. What this adds (and what it leaves alone)

| | |
|---|---|
| **Added** | An **Inventory** area in the existing app (`/inventory`): the catalogue (categories, items, technology templates), locations and bins, individually tracked units with permanent codes and QR labels, quantity and consumable stock, kits, counts, issue / return / dispatch / transfer / repair movements, an immutable stock ledger, equipment requests and date reservations for projects, availability (also shown to Sales as a summary), each person's own equipment, HR's view of what an employee still holds, and a one-off reconciliation of the earlier HR asset register. Twenty-nine new `inv_*` tables, 150 database functions (84 that the app calls, 66 internal), one sequence, no storage bucket. |
| **Not touched** | Every HR table, column, policy, function, calculation, approval route and page; every Sales and Projects table, column, policy and function. Attendance, Recovery Leave, leave, expenses, payroll and appraisals behave exactly as before. **The only additions to existing tables are four triggers (§6).** |
| **Separate access** | Inventory access is its own table (`inv_company_grants`), **per company**, independent of HR roles, Sales grants and Projects grants. **Nobody receives any automatically.** People without it do not see the module. The first founders are named by you in `inv_30_bootstrap_founders.sql`; after that founders grant access inside the app (Inventory → Access). |
| **Costs** | Purchase date, cost and currency live in their own table and are read only with the separate `view_costs` right, which only a founder can grant and which nothing implies (§9). |
| **Shell change** | The "Inventory — Coming soon" menu entry becomes a real module shown only to people with Inventory access, to Project Managers of a running project, and (for "my equipment") to employees. One light query in the app layout reads the person's own grants; it degrades to the "Coming soon" row if the tables do not exist yet. |

## 2. Decisions built in (see `inventory-design.md`)

Separate `inv_` tables; own capability grants with no automatic grant to anyone; four tracking methods (individual, quantity, kit, consumable) that
are fixed once stock exists; lifecycle, condition, custody, ownership and reservation kept as **separate** facts (never one overloaded status);
the stock ledger is immutable and a mistake is fixed by a correction that names the original and says why; every movement carries an idempotency
key so a retried click changes nothing; per-item locks and an exclusion constraint so two people can never reserve or issue the same thing twice;
overdue equipment is flagged and never counted as available; the owning company and the physical location are different columns; **an existing HR
asset becomes an Inventory unit only when a founder imports it** (nothing is converted or guessed); **nothing is ever created for you** (no stock,
location, category, item, reference code or access grant); pausing is a database switch that loses nothing.

## 3. Files

Apply **in exactly this order** (the file names sort in this order too):

| # | Migration (`supabase/migrations/`) | What it does |
|---|---|---|
| 1 | `20261201000000_inv_access_audit_settings.sql` | Capability list, grants (`inv_company_grants`), helper checks, the Inventory audit log, per-company settings (reference code and the on/off switch), the code counters, and the access functions (grant, revoke, set code, switch on/off, staff picker). |
| 2 | `20261201000100_inv_catalogue_stock_ledger.sql` | Locations, bins, operator locations, categories, items, units, quantity stock rows, kit contents, transfers, rentals, the **immutable movement ledger**, costs, label history, and the read-only (SELECT-only) row-level security. |
| 3 | `20261201000200_inv_planning_tables.sql` | Technology templates and components, equipment requests and lines, **reservations with the no-overlap exclusion constraint**, Sales availability checks, counts and count lines, the import log. |
| 4 | `20261201000250_inv_shared_helpers.sql` | The single definition of "usable", "free for a date range" and quantity precision, the per-item lock, the time-zone conversion; a no-op placeholder for the legacy mirror. Internal only. |
| 5 | `20261201000300_inv_stock_functions.sql` | The stock core: configuration, units and labels, opening stock and counts, every movement (receive, issue, return, dispatch, transfer, consume, repair, kits, condition checks, adjustments, corrections), idempotency records, company sharing, and the read-only ledger consistency check. |
| 6 | `20261201000400_inv_planning_functions.sql` | Templates, requests, reservations, availability, the Sales check, the Projects functions, and **two triggers on `proj_projects`** (§6). |
| 7 | `20261201000500_inv_employee_legacy.sql` | The restricted employee lookup, "my equipment", HR's outstanding-equipment view, reassignment, the preview and import of the HR asset register, the real legacy mirror, and **two triggers on `assets` / `asset_assignments`** (§6). |
| 8 | `20261201000600_inv_count_line_remove.sql` | One function: take a mistaken line out of an open count (nothing in the stock books changes). |
| 9 | `20261201000700_inv_transfer_destination_check.sql` | One function replaced (`inv_transfer_between_projects`): a project manager moving equipment straight to another project must manage **both** projects (warehouse staff at the unit's location still may move it between any two). Found by the browser access checks. |
| 10 | `20261201000800_inv_project_equipment_unlinked.sql` | One function replaced (`inv_project_equipment`): a project's Equipment page also lists equipment dispatched to it **without naming a request**, with its due date and an overdue flag. Found by the browser transfer checks. |

No other Inventory migration exists; if one appears later it is listed here and `inv_20_verify_readonly.sql` is extended with it.

Owner scripts (`supabase/manual-sql/`):

| Script | Kind | Purpose |
|---|---|---|
| `inv_00_preflight_readonly.sql` | read-only | Prerequisites, no existing Inventory objects, companies and codes, candidate founders (information only), the HR asset register, default privileges, tables without RLS, row counts that must not change. |
| `inv_05_preservation_check_readonly.sql` | read-only | Snapshot before, compare after: proves nothing HR, Sales, Projects or asset-register owns changed, apart from the four triggers. |
| `inv_20_verify_readonly.sql` | read-only | After the install: every row must say OK. |
| `inv_30_bootstrap_founders.sql` | writes grants (and, only if you type a code, the settings row) | Creates the first founders you name. No defaults. |
| `inv_80_safe_disable_and_restore.sql` | writes the on/off switch only | Pause and restore without deleting anything. |
| `inv_90_rollback.sql` | destructive | Full removal, only while no Inventory data exists. |

Application: `apps/web/src/app/(app)/inventory/**`, `apps/web/src/lib/inventory/**`, `apps/web/src/components/inventory/**`, `apps/web/src/lib/actions/inventory*.ts`, domain logic in `packages/domain/src/inv*.ts`, tests.

## 4. Before you start (nothing here changes anything)

1. **Sales & CRM and Projects & Tasks must already be installed** (`20261115000000`–`300` and `20261120000000`–`600`), because Inventory reads Sales
   opportunities and Projects (handover, project manager rights). The public privilege hardening (`20261114000000`) should be applied too.
2. Run `inv_00_preflight_readonly.sql` in the SQL Editor of V2. Every row in section **B** must say OK, section **C** must say "OK - no Inventory
   tables or functions exist yet". Read section **F**: it shows your HR asset register as it is today (counts by company and status, open
   assignments, assets held by people who have left, rows that disagree with each other). Section **E** lists Projects founders, Sales founders and
   CEO / CTO as **information only**: nobody on it receives Inventory access.
3. Run `inv_05_preservation_check_readonly.sql` unchanged ("snapshot" mode). Keep the whole result and the **paste** column; it fingerprints
   everything that is not an `inv_` object (HR, Sales, Projects, the HR asset register, storage rules).
4. Decide who the first founders are (the person or people who will set up the warehouse) and which company each belongs to. The company's
   equipment reference code (2 to 5 capital letters, for example `UAE`, which gives labels like `UAE-E-00042`) is typed by a founder later; it is never copied
   from Sales or Projects.

## 5. The exact sequence (database first, then the app)

Run each file in the Supabase SQL Editor of **Enginious HR Engine_V2**, **the whole file, one at a time**, and stop at the first red result.

| Step | What | Check |
|---|---|---|
| 1 | Preflight (§4.2) and snapshot (§4.3) | All OK; paste lines saved |
| 2 | Run, **one at a time and in this order**, the ten migration files in §3 | Each ends without an error |
| 3 | `inv_20_verify_readonly.sql` (leave `expect_fresh = true`) | Every row **OK**; the last row says OK. Run it promptly: it expects an empty module |
| 4 | `inv_05_preservation_check_readonly.sql` in "compare" mode (paste the saved lines where the file says: above the `('__none__', '')` line, which stays) | Summary says **PASS: nothing HR, Sales, Projects or the HR asset register own changed**; the four `intended:trigger:` rows say SAME and `intended:four_triggers` says "4 present" |
| 5 | Merge the pull request when you are ready; Vercel deploys the app | The app opens; **people without Inventory access see no Inventory menu** |
| 6 | Edit `inv_30_bootstrap_founders.sql` (real emails and companies, one line per grant) and run it | It lists the founders it granted. **This is the step that gives real people access** |
| 7 | `inv_20_verify_readonly.sql` again with `expect_fresh = false` | Every row OK |
| 8 | In the app, a founder opens Inventory → Manage: sets the company reference code if the bootstrap did not, creates locations (with their time zone), categories and items, assigns warehouse operators to their locations (Inventory → Access) | See §9 |
| 9 | Opening stock: warehouse staff count what is on the shelves; a person with `confirm_stock` confirms the count. Only then does it become stock | Draft units and unconfirmed counts never count as available |

Why the database goes first: the new tables and functions do nothing until someone has an Inventory grant, and an older version of the app does
not read them. The two project triggers (§6) start working the moment migration 6 is applied: a **client project accepted before the company has
Inventory set up** simply records "nothing to import" in `inv_import_log` and is created normally, so run step 3 promptly (it expects an empty module) or
use `expect_fresh = false`.

## 6. Intended changes to existing objects (exactly four triggers, nothing else)

Everything else Inventory adds has an `inv_` name. The preservation check treats **these four triggers and nothing else** as expected:

| Table | Trigger | Fires | What it does |
|---|---|---|---|
| `assets` | `inv_legacy_guard_assets` | BEFORE UPDATE OR DELETE | Refuses a direct edit or removal of an HR asset that is linked to an Inventory unit. |
| `asset_assignments` | `inv_legacy_guard_assignments` | BEFORE INSERT OR UPDATE OR DELETE | Refuses a direct issue, return, edit or deletion for such an asset. |
| `proj_projects` | `inv_proj_projects_import` | AFTER INSERT, client projects only | Imports the frozen handover's technology list into one **draft** equipment request. Never blocks the project: any failure is caught and written to `inv_import_log`. |
| `proj_projects` | `inv_proj_projects_release` | AFTER UPDATE OF status, only when it becomes completed or archived | Cancels the project's draft and submitted requests, and for requests already in progress releases the **unused** reservations. Never blocks the status change; a failure is logged. |

No column, policy, privilege, view, enum, bucket or other function of any existing table changes. `inv_05_preservation_check_readonly.sql` fingerprints
all of that (every non-`inv_` table, column, constraint, index, policy, function, trigger, view, enum, relation, extension, privilege and storage rule) and checks
the four triggers separately: exactly four, enabled, of exactly this kind, and no other `inv_` trigger on a table Inventory does not own.

**Effect on the HR Assets page, for imported assets only.** Until a founder imports an asset (the preview and the import are founder-only: the founder previews the register, then imports
the assets chosen, one item and one location each), the HR Assets page behaves exactly as it does today, for every asset. An **imported** asset stays
visible on the HR Assets page, but from then on the Inventory unit is the master:

- HR can no longer edit it, remove it, issue it to someone, mark it returned, or change or delete its assignment rows there. The database refuses with
  the message **"This item is managed in Inventory. Use Inventory to issue or return it."**
- When people issue, return or reassign the unit in Inventory, Inventory keeps the HR record in step in the same transaction: the open
  `asset_assignments` row for that employee (inserted if missing, another person's open row closed), and `assets.status`: issued to an employee = `issued`;
  in the warehouse, on a project, in transit or in a kit = `in_stock`; in repair = `under_repair`; retired = `retired` (a unit marked missing leaves the HR
  record as it was).
- The import itself writes only Inventory rows. It skips retired assets, assets that are already imported and duplicates; an asset with more than one open
  assignment is imported with a note and the latest assignment. Imported units start as **draft** until counted; purchase date and value are copied only if
  the founder also holds `view_costs`.
- Assets that were never imported are untouched and behave exactly as before. Nothing in `assets` or `asset_assignments` is deleted or rewritten by the
  install, and the preservation check fingerprints **all** their rows to prove it.
- The guard is one indexed look-up per changed row (`inv_units.legacy_asset_id` is unique), so it adds no noticeable load to HR.

## 7. Permission matrix (from `inventory-design.md` §5)

| Who | Sees | Does |
|---|---|---|
| Inventory founder (grant `founder`) | everything in authorised companies incl. costs | everything, access, enable/disable, settings |
| warehouse operator (`warehouse`) | units, stock, movements, requests for the company | receive, issue, dispatch, return, transfer, count at **assigned locations**; `cross_location` extends to all locations |
| `view_stock` | unit-level stock and movements (read only) | nothing |
| `view_costs` | purchase date, cost, currency (own table) | granted only by founders; never implied |
| `manage_catalogue` | catalogue | categories, items, templates, locations, bins |
| `confirm_stock` | counts | confirm opening stock and counts as verified |
| `request_for_employees` (department heads) | own requests | create employee equipment requests |
| `view_employee_custody` (HR) | outstanding equipment per employee | read only (including inactive employees) |
| Project Manager / department head of an ongoing project | catalogue summary, their project's requests, reservations, dispatches, returns | prepare/submit requests, expand templates, accept substitutions, cancel unused lines (via `proj_can_manage`) |
| Sales (existing Sales scope) | per-opportunity technology availability summary, who checked and when | request a warehouse check; no costs, no custody, no unrelated projects |
| any signed-in employee | their own assigned equipment (`inv_my_equipment`) | nothing else |

No automatic grant to CEO, HR Admin, System Admin or any test account. Every check is in the database; hidden buttons are cosmetic.

## 8. What the app shows if the migrations are not installed

Until the Inventory migrations have been applied to the database the app is pointed at, the Inventory area says, in place of its pages: **"Inventory is not
installed in this environment yet. The database changes it needs have not been applied here, so nothing is shown."** Nothing fails and no other module is
affected. The menu entry stays on its "Coming soon" row. If the database does not answer, the Inventory area says it could not load instead of showing
empty stock. After the migrations are applied, people who hold no Inventory grant still see no Inventory menu (Project Managers of a running project and
employees reach only their own requests and their own equipment, because the database itself decides what they may read).

## 9. Restrictions to know

- **Cost visibility.** Purchase date, cost and currency are only readable with `view_costs`, only a founder can grant it, and no other right, role or the
  warehouse, Sales, HR or PM position implies it. The legacy import copies a cost only if the importing founder holds `view_costs`.
- **No automatic grants.** No HR role, Sales or Projects grant, employee record or e-mail domain gives Inventory access; `inv_30_bootstrap_founders.sql` refuses placeholders,
  example addresses, unknown people and ambiguous companies, grants only what you type (one line = one person in one company), and has no "all companies" shortcut. The last
  founder of a company cannot be removed.
- **No stock creation.** The install and the bootstrap create no location, category, item, unit, count or movement. Opening stock exists only after a count is confirmed
  by a person who may confirm it. Stock can never go below zero. A mistake is fixed by a correction, never by editing a total.
- **Reference code.** A company cannot register anything until its code is set, and the code cannot change once labels exist (printed labels carry it).
- **Tracking method, unit of measure and decimals** are fixed once any unit, stock row or movement exists; "replace item" retires and replaces.
- **Employees.** Inventory reads an employee's name, employee number and department only; never salary, leave, documents, contact details or the reporting line.
- **Pausing.** A switched-off company refuses every change and shows everything (§10); access management stays available to founders.

## 10. Safe disable and recovery

- **Pause without losing anything (preferred):** `inv_80_safe_disable_and_restore.sql`. Section 1 sets `inv_company_settings.is_enabled` to false for every company (section 1b:
  one company). From then on every Inventory function that changes something refuses with "Inventory is switched off for this company. Nothing can be changed until a founder
  switches it on." (stock, catalogue, counts, requests, reservations, the HR import), the database enforces it, and **reading keeps working** (catalogue, stock, history, "my
  equipment", HR's outstanding view, availability, the Sales summary). Access management and the on/off switch stay usable so a founder can always switch it back on.
- **What stays valid:** every label and QR code, unit, stock row, movement, count, request, reservation, rental, cost and audit row, and every recorded custody. Nothing is deleted
  or reversed; reservations stay on record. An imported HR asset stays managed by Inventory (the HR Assets page still refuses to edit it). New client projects skip the
  equipment import while off (logged; the project manager imports it once the company is on again). Completing a project still frees its unused reservations.
- **Restore:** section 2 switches back on exactly the companies the script switched off (found in the Inventory audit log, where a switch made in the SQL Editor has no person
  next to it; a company a founder switched off in the app stays off); 2b switches back on every company that is off; 2c one company. Section 3 (always runs, read-only) lists
  which companies are on or off, when it last changed and who changed it.
- **Recovery from a mistake in the stock books:** never delete. Use the app's correction (a new `correction` movement that names the original and gives a reason), a cycle
  count (differences become `count_adjust` movements with a reason), or an adjustment (missing / found / retire).
- **Checking the books:** `inv_20_verify_readonly.sql` reconciles every stock row against the ledger and every unit against its last movement, directly. (The database function
  `inv_ledger_problems()` does the same but only answers people allowed to read the audit log, so in the SQL Editor it always returns nothing: do not rely on it there.)
- **App side:** deploying the previous app version hides the module (absent tables also produce the plain "not installed" notice).

## 11. Rollback and its restrictions

`inv_90_rollback.sql` has two clearly separated parts. **A (the safe way first)** is the pause above. **B (full removal)** drops the four triggers, then every `inv_` table (with its
policies, indexes, constraints and sequence), then every remaining `inv_` function, and nothing else.

- **While no Inventory data exists** (only the founder grants and company settings you created with the bootstrap script, and their audit rows) it runs, leaves nothing behind
  with an `inv_` name, and a preservation snapshot taken before the install **matches again** (shown by the script's own result and by `inv_05` in compare mode: PASS, 0 of 4 triggers).
  A second run says there is nothing to remove, and the migrations install cleanly again afterwards.
- **Once any Inventory data exists** (units, stock, movements, counts, requests, reservations, rentals, costs, locations, categories, items, templates, import records, a code counter
  that already issued a label, or audit rows about any of those) the script **refuses** and says what it found. **Pause instead, never drop.** The stock ledger is immutable on purpose:
  it is the only proof of who held what, who counted, who dispatched and what was written off. Printed labels carry permanent codes; after a removal they point at nothing and a
  re-install would reissue the same codes to new items.
- To remove a **trial** install full of test data (or after you have exported everything), you must change **two** switches at the top of the file: `v_allow_data_loss := true` **and**
  `v_confirm := 'DELETE ALL INVENTORY HISTORY'`. Either alone still refuses. The destruction is permanent.
- HR assets that had been imported keep the status and assignment rows Inventory last wrote (the script does not reverse them); with the guard triggers gone HR can edit them again.
- **Order matters if you also remove other modules:** remove Inventory first. Inventory tables point at `proj_projects` and `crm_opportunities`; the Projects and Sales rollbacks drop
  those with "cascade", which would silently cut the links and leave Inventory half working.

## 12. What was tested, and what was not

| Layer | Tested locally | Not tested |
|---|---|---|
| Database (real PostgreSQL 16, every migration applied in order, Supabase-style default grants) | The Inventory test suites (access, stock, planning, employees and legacy) plus the owner-script suites below | PostgreSQL 17 (run it if you want); behaviour under real production data volume |
| Owner SQL | Preflight (read-only inside a read-only transaction, no row count changes; reports prerequisites, candidate founders as information only, the HR asset register). Preservation check: snapshot, real migrations applied, compare: every fingerprint SAME and the four intended triggers SAME; legitimate HR and Projects activity between the runs not flagged; **16 kinds of real change caught** (policy, column on HR / Projects / assets, function, privilege, RLS off, edited asset, deleted assignment, extra trigger, fifth `inv_` trigger, dropped or altered intended trigger, new bucket, deleted old Projects row). Verify: every row OK on a fresh install and **28 kinds of drift each turn a row to FAIL** (extra grants, RLS off, write policy, open helper, unpinned function, missing ledger trigger, missing exclusion constraint, missing intended trigger, automatic grant, data present, books that disagree, Inventory writing HR...). Bootstrap: refuses the placeholder and every bad input and writes nothing; grants exactly what is typed; idempotent; creates no stock, location, category or item; touches no other grant. Safe disable and restore: 30 write functions refuse while off with the plain message, no Inventory row changes, reading works, access functions still work, restore re-enables, per-company switching, restore of only the owner's own pause, imported HR assets stay guarded, project completion still frees reservations. Rollback: fresh install fully removed and the pre-install snapshot matches again; refuses with every kind of data, needs both switches; re-install works | Running any of them on V2 (yours to do) |
| Application | See the pull request for the typecheck, lint, unit test and build results of the final commit | Hosted Supabase, the Vercel preview, label printers, camera QR scanning on real phones, real users |

## 13. What is NOT included

- **Procurement and purchasing:** no purchase orders, quotations, goods-received matching or approvals (the future Vendors & Purchasing module). Stock is received against a count or a receipt entry, not a purchase order.
- **Vendors and suppliers:** no vendor records, supplier prices or contacts. A rental carries only an external reference and a return deadline.
- **Photos and file attachments:** no storage bucket, no uploads, no images of equipment or damage.
- **Scheduled jobs:** none. Nothing runs by itself; overdue items are computed when a page is opened.
- **E-mail and notifications:** none, not even in-app. No message is ever sent.
- **Automatic reservations:** winning a Sales opportunity or moving any CRM stage never reserves anything; a reservation exists only because a person made it on a request line.
- **Valuation:** no depreciation, accounting values, insurance or maintenance schedules.
- **Cross-company use** needs an explicit authorisation by the owning company's founder; it is never implied.

## 14. Known limitations

- **Permanent deletion of an employee in HR is not aware of Inventory.** HR's function `permanently_delete_employee` checks its own list of history (attendance, leave, payroll,
  assets assignments, documents and so on) and does not know about Inventory records. For an employee who only has Inventory records (equipment issued through Inventory, movements, requests),
  it does **not** give HR's plain "Cannot permanently delete: this employee has real history" message: it runs on until the database stops it with a **raw foreign-key error** naming an `inv_`
  table. **Nothing is deleted** (the whole call is undone). Use Remove (the soft delete) for such an employee; Inventory deliberately keeps equipment history for people who have left. (Shown by a test in
  `packages/rls-tests/test/inventory_disable.rls.test.ts`.)
- Inventory's own consistency check `inv_ledger_problems()` is empty when run as the owner (see §10); use the direct reconciliation rows of `inv_20_verify_readonly.sql`.
- The owner scripts read the lists of expected tables (29) and functions (150) from this release; a later Inventory migration needs the matching update of `inv_20_verify_readonly.sql` or it will (correctly) report an unknown object.
- `inv_05_preservation_check_readonly.sql` fingerprints the HR asset register in full (it has no creation dates). If HR edits an asset between your snapshot and your compare, the row is DIFFERENT for a harmless
  reason: ask HR or repeat both runs quickly. Tables without creation dates other than the two asset tables are covered by structure only, as in the other modules' checks.
- The service key (used by the server, as everywhere in the system) is not limited by Inventory's row-level security or function grants; the checks above describe signed-in users, anon and PUBLIC.
- A unit imported from the HR register is a draft until a count confirms it; until then it cannot be issued, dispatched or counted as available through Inventory, although HR's record of who holds it is unchanged.
- Counts, reservations and movements are per company; a project's equipment comes from the project's company warehouse unless a founder authorised sharing.
- Cancelling a project releases only **unused** reservations; equipment already dispatched stays on the project until it is returned.
