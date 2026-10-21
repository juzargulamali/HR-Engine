# Inventory: design and contract

Status: implementation contract for the Inventory module of ENGINIOUS OS. Migrations `20261201*`. Read together with
`docs/projects-design.md` and `docs/crm-deployment.md` (same conventions: company-scoped grants, SECURITY DEFINER functions, read-only
tables for clients, own audit log).

## 1. Compatibility findings (what already exists)

* **An HR asset register exists**: `assets` (company, tag, category, description, purchase date, value, status in_stock/issued/under_repair/retired)
  and `asset_assignments` (asset, employee, issued/returned dates, conditions), managed from the HR **Assets** page and an employee's page by
  HR Admin / Finance (`canManageAssets`). Inventory must not become a second competing register. Decision: Inventory units can be
  **reconciled from** legacy assets (`inv_units.legacy_asset_id`, unique). A founder previews and imports selected assets (idempotent,
  draft until counted). From then on the unit is the master: Inventory issue/return/reassign keeps `asset_assignments` and `assets.status`
  in step (migration 6, `inv_mirror_legacy`), and direct HR edits of a linked asset are refused with a plain message ("managed in
  Inventory"). Unlinked legacy assets keep working exactly as today. Nothing is deleted or rewritten.
* **CRM** already stores `crm_opportunities.technologies` (`[{name, qty}]`), install/event dates and location text, and records a *manual*
  availability confirmation (`availability_state`, `crm_request_availability`, `crm_confirm_availability`, capability
  `confirm_availability`). Inventory adds a computed, dated, never-overwritten check (`inv_availability_checks`) beside it. The CRM columns
  and functions are untouched; Sales sees the Inventory summary through Inventory functions only.
* **Projects** has `proj_projects` (+ `proj_project_details.site_timezone`), members/teams, a frozen handover snapshot
  (`proj_handovers.technologies`), `proj_can_view_details / proj_can_manage / proj_is_pm`. Project completion rules are not changed.
* Employees: `employees` (company, user_id link, department, employment_status, termination_date), `current_employee_id()`,
  `is_manager_of()`. Inventory reads only what it needs and never writes HR tables except the legacy mirror above.
* Open PRs #35, #31, #15 do not touch these areas.

Intended changes to existing objects (listed so preservation checks stay strict and are only extended for these):
1. migration 6: triggers on `assets` / `asset_assignments` that refuse direct edits of a legacy asset linked to an Inventory unit, and the
   mirror writes made by Inventory functions (only for linked assets, only after a founder imported them);
2. migration 5: an AFTER INSERT trigger on `proj_projects` (client projects) that imports the handover requirement snapshot, never blocking
   the insert; an AFTER UPDATE OF status trigger that releases **unused** reservations when a project becomes completed or archived.
No other existing function, policy or table definition changes.

## 2. Tracking methods

| Method | Identity | Held in | Notes |
|---|---|---|---|
| individual | permanent code `UAE-E-00042`, QR, optional serial | `inv_units` | custody, condition, lifecycle |
| quantity | exact item (name + model + specification) | `inv_balances` | whole units or up to 3 decimals; per holder/condition/bin; bin label `label_code` |
| kit | a unit of an item with tracking = kit | `inv_units` + `inv_kit_contents` | contents are units (custody `kit`) or quantity balances held by the kit; no kit inside a kit |
| consumable | exact item | `inv_balances` | issue consumes; unused quantity can be returned explicitly |

Tracking method, unit and decimals are fixed once any unit, balance or movement line exists (trigger). `inv_replace_item` retires and replaces.

## 3. Dimensions (never one status)

* lifecycle: draft (catalogued, not yet verified), active, retired, missing
* condition: good, fair, needs_inspection, damaged, unserviceable (balances: good, needs_inspection, damaged)
* custody: warehouse (location + bin), employee, project, transit, repair, kit
* ownership: owned or rental (rental stock never adds to owned quantities; separate `inv_rentals` row with external reference and deadline)
* reservation: future dates only, in `inv_reservations` (a reservation is not a location)
* owning company vs physical location: separate columns; moving never changes the owner; cross-company use needs an explicit
  authorisation (`inv_company_sharing`, migration 4)

## 4. Availability definition (single source: `inv_unit_free`, `inv_qty_free`)

Usable now = lifecycle active, condition good/fair, custody warehouse at the location, not in a kit. Free for a range additionally
excludes overlapping active reservations. A unit out on a project or in transit counts for a *future* range only when its recorded return
or arrival is on time (not already overdue) and ends before the range starts; **overdue equipment is flagged and never counted as ready**.
Employee-assigned units never count. A unit inside a kit never counts independently; the kit counts as one thing. Quantities: good shelf
stock + on-time returns + on-time arrivals − overlapping reservations not yet dispatched. Reported dimensions: physical at location,
usable now, reserved in range, dispatched to projects, assigned to employees, in transit, awaiting inspection, damaged/repair/missing,
future available, overdue.

Planning dates (local time of the request's zone): prep_start, dispatch, install_start, show_start, show_end, dismantle_end, return_due,
inspect_until. The reserved window is [earliest given, latest given] converted with `inv_local_to_utc` (DST-safe).

## 5. Permission matrix

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

## 6. Function contract (all `security definer`, `search_path = public`, errcode 42501 for permission, 23514 for state, 22023 for input)

Every write function: `inv_require_user()`, resolves the company, `inv_require_enabled(company)`, checks the capability (and
`inv_can_operate(location)` for stock), and uses `inv_lock_item(item)` before reading or changing the stock or reservations of an item.
Every movement function takes `p_key text` (8-120 chars, idempotency key): the same key by the same caller returns the original result and
changes nothing; the same key by another caller, or with different content, is refused. Inputs are validated with `inv_check_qty`.

Migration 4 (stock core, `20261201000300_inv_stock_functions.sql`)
* configuration: `inv_save_location`, `inv_save_bin`, `inv_set_operator_locations`, `inv_save_category`, `inv_save_item`, `inv_replace_item`,
  `inv_set_company_sharing`
* units and labels: `inv_register_unit` (draft by default, optional initial custody for existing employee/project holdings, cost only with
  `view_costs`), `inv_ensure_bin_label`, `inv_record_label_print`
* opening and counts: `inv_start_count`, `inv_save_count_line`, `inv_confirm_count` (opening: creates stock through `opening` movements,
  verified who/when; cycle: differences become `count_adjust` movements with a mandatory reason), `inv_cancel_count`;
  `inv_confirm_opening_custody` for units and quantities already with employees or on projects (no double counting with the warehouse)
* movements: `inv_receive_stock`, `inv_issue_to_employee`, `inv_return_from_employee`, `inv_dispatch_to_project`,
  `inv_return_from_project`, `inv_transfer_between_projects`, `inv_transfer_dispatch`, `inv_transfer_receive`, `inv_consume`,
  `inv_return_unused`, `inv_repair_out`, `inv_repair_in`, `inv_pack_kit`, `inv_unpack_kit`, `inv_set_kit_line`, `inv_check_condition`,
  `inv_adjust_stock` (missing / found / retire), `inv_correct_movement` (reverses nothing silently: a new `correction` movement naming the
  original and a reason), `inv_transaction_status(company, key)`
* returns: lines with condition good complete the check in the same call and become available; anything else is held (needs_inspection /
  damaged) and is never released automatically; partial returns leave the rest outstanding.

Migration 5 (planning, `20261201000400_inv_planning_functions.sql`)
* templates: `inv_save_technology`, `inv_save_technology_components`, `inv_set_technology_status`
* requests: `inv_create_request`, `inv_save_request_plan`, `inv_add_request_line`, `inv_expand_technology` (snapshot), `inv_update_request_line`,
  `inv_cancel_request_line`, `inv_submit_request`, `inv_cancel_request`, `inv_propose_substitution`, `inv_decide_substitution`,
  `inv_set_shortage_action`
* reservations: `inv_reserve` (atomic; units through the exclusion constraint, quantities through `inv_lock_item` + `inv_qty_free`),
  `inv_release_reservation`, `inv_change_request_window` (rechecks; never displaces another reservation; returns conflicts)
* availability: `inv_availability(item, location, from, until)`, `inv_technology_availability(technology, qty, location, from, until)`
* Sales: `inv_request_opportunity_check`, `inv_record_opportunity_check`, `inv_opportunity_availability` (latest check, whether it is out of
  date, live per-technology summary or "Warehouse check required")
* Projects: `inv_project_equipment(project)`, `inv_import_handover_requirements(project)` (idempotent), the two project triggers of section 1

Migration 6 (employees and legacy, `20261201000500_inv_employee_legacy.sql`)
* `inv_employee_lookup` (id, display name, employee number, department name, active only: nothing else), `inv_my_equipment`,
  `inv_employee_outstanding` (including inactive employees), `inv_reassign_unit` (employee <-> project pool, with history),
  `inv_preview_legacy_assets`, `inv_import_legacy_assets`, `inv_mirror_legacy` (replaces the no-op), the legacy guard triggers

## 7. Invariants the tests must prove

1. A balance's quantity equals the sum of the ledger lines that point at it; `inv_ledger_problems()` returns no rows.
2. No negative stock, ever (check constraint + functions); precision per item scale.
3. No two active reservations of one unit overlap (exclusion constraint) and quantity reservations never exceed free stock, under
   simultaneous callers.
4. Movements are immutable; corrections preserve the original.
5. A retried call with the same key changes nothing.
6. Employee-assigned, in-kit, draft, damaged, missing and overdue equipment is never counted as available.
7. Cost rows, employee custody and other projects' data are invisible to callers who lack the capability, by table and by function.
8. No HR table (other than the legacy mirror for linked assets), CRM or Projects row changes as a side effect of any Inventory call.

## 8. Owner scripts (supabase/manual-sql, `inv_` prefix, written last)

`inv_00_preflight_readonly.sql`, `inv_05_preservation_check_readonly.sql` (snapshot before, compare after; extended only for the intended
changes of section 1), `inv_20_verify_readonly.sql`, `inv_30_bootstrap_founders.sql` (explicit real emails typed by the owner, no
defaults), `inv_80_safe_disable_and_restore.sql`, `inv_90_rollback.sql` (restrictions once real data exists).
