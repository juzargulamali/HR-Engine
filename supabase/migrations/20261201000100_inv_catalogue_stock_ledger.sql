-- Inventory, migration 2 of 6: locations, categories, items, physical units, quantity balances, kits, transfers, rentals, the
-- movement ledger, costs, label history and row-level security.
--
-- Everything here is READ-ONLY to clients (SELECT policies only, no INSERT/UPDATE/DELETE policies, no DML grants). Changes go
-- through the SECURITY DEFINER functions in migrations 4-6, which enforce the role rules and keep stock consistent.
--
-- Tiers are kept in DIFFERENT tables because row-level security cannot hide columns:
--   summary-safe     inv_locations, inv_bins, inv_categories, inv_items      (any Inventory access holder in the company)
--   operational      inv_units, inv_balances, inv_kit_contents, inv_transfers, inv_rentals, inv_movements, inv_movement_lines
--                    (founders, warehouse operators, and holders of 'view_stock'): custody, employee and project pointers live here
--   cost             inv_costs                                                 ('view_costs' only; never implied by anything else)
-- Employee custody, project names and purchase costs therefore never reach someone who only holds basic Inventory access.
--
-- Separate dimensions of a physical unit (never one overloaded status):
--   lifecycle    draft (catalogued, stock not yet claimed as verified) / active / retired / missing
--   condition    good / fair / needs_inspection / damaged / unserviceable
--   custody      where it physically is: warehouse (location + bin), employee, project, transit, repair, or packed in a kit
--   reservation  future commitments live in inv_reservations (migration 3) and are NOT a location or a status
-- Quantity stock (identical items, consumables) is held in inv_balances, one row per holder/condition, changed only by the ledger.

-- -----------------------------------------------------------------------------
-- Locations and bins
-- -----------------------------------------------------------------------------
create table if not exists inv_locations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),      -- the company that runs this storage location
  code        text not null check (code ~ '^[A-Z0-9]{2,8}$'),
  name        text not null check (length(btrim(name)) between 1 and 80),
  kind        text not null default 'warehouse' check (kind in ('warehouse', 'office', 'other')),
  -- IANA zone of the place: dates shown and typed at this location are in it; instants are stored in UTC.
  timezone    text not null check (proj_valid_timezone(timezone)),
  address     text,
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint inv_locations_code_unique unique (company_id, code)
);
create unique index if not exists uq_inv_locations_name on inv_locations(company_id, lower(btrim(name)));

create table if not exists inv_bins (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id),
  location_id  uuid not null references inv_locations(id),
  code         text not null check (length(btrim(code)) between 1 and 30),
  label        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists uq_inv_bins_code on inv_bins(location_id, lower(btrim(code)));

-- Which locations a warehouse operator works at. 'cross_location' (a capability) widens this to every location of the company.
create table if not exists inv_operator_locations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id),
  user_id      uuid not null references auth.users(id),
  location_id  uuid not null references inv_locations(id),
  assigned_by  uuid references auth.users(id),
  assigned_at  timestamptz not null default now(),
  removed_at   timestamptz
);
create unique index if not exists uq_inv_operator_locations_active on inv_operator_locations(user_id, location_id) where removed_at is null;

-- -----------------------------------------------------------------------------
-- Categories and items (the catalogue). Categories are data, never a fixed list.
-- -----------------------------------------------------------------------------
create table if not exists inv_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null check (length(btrim(name)) between 1 and 80),
  parent_id   uuid references inv_categories(id),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_inv_categories_name
  on inv_categories(company_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

create table if not exists inv_items (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  name                text not null check (length(btrim(name)) between 1 and 160),
  category_id         uuid references inv_categories(id),
  -- individual: each physical unit has its own identity. quantity: identical stock counted per bin. kit: a physical kit with a
  -- contents checklist. consumable: used up on issue. Fixed once movement history exists (see inv_items_guard).
  tracking            text not null check (tracking in ('individual', 'quantity', 'kit', 'consumable')),
  unit_of_measure     text not null default 'each' check (length(btrim(unit_of_measure)) between 1 and 20),
  -- Decimal places allowed for a quantity (0 = whole numbers; up to 3, e.g. metres). Individual units and kits are always whole.
  quantity_scale      smallint not null default 0 check (quantity_scale between 0 and 3),
  manufacturer        text,
  model               text,
  -- The exact specification that keeps look-alikes apart (cable length, connector type, motor rating).
  specification       text,
  status              text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  replaced_by_item_id uuid references inv_items(id),
  notes               text,
  version             integer not null default 1,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint inv_items_whole_units check (tracking in ('quantity', 'consumable') or quantity_scale = 0)
);
-- Distinct specifications stay separate; the same name + model + specification is one item.
create unique index if not exists uq_inv_items_identity
  on inv_items(company_id, lower(btrim(name)), lower(btrim(coalesce(model, ''))), lower(btrim(coalesce(specification, ''))))
  where status <> 'retired';
create index if not exists idx_inv_items_company_category on inv_items(company_id, category_id);

-- -----------------------------------------------------------------------------
-- Rentals: equipment that is NOT ours. Receipts into a rental never increase owned quantities.
-- -----------------------------------------------------------------------------
create table if not exists inv_rentals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  supplier_name       text not null check (length(btrim(supplier_name)) between 1 and 160),
  external_reference  text not null check (length(btrim(external_reference)) between 1 and 160),
  return_deadline     timestamptz not null,
  project_id          uuid references proj_projects(id),
  note                text,
  status              text not null default 'open' check (status in ('open', 'returned')),
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  returned_at         timestamptz
);
create unique index if not exists uq_inv_rentals_reference on inv_rentals(company_id, lower(btrim(external_reference)));

-- -----------------------------------------------------------------------------
-- Transfers between locations: dispatch, transit and destination receipt are three separate records in time.
-- -----------------------------------------------------------------------------
create table if not exists inv_transfers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  code              text not null unique,
  from_location_id  uuid not null references inv_locations(id),
  to_location_id    uuid not null references inv_locations(id),
  status            text not null default 'in_transit' check (status in ('in_transit', 'received', 'cancelled')),
  carrier           text,
  reference         text,
  dispatched_by     uuid not null references auth.users(id),
  dispatched_at     timestamptz not null default now(),
  expected_at       timestamptz,
  received_by       uuid references auth.users(id),
  received_at       timestamptz,
  note              text,
  constraint inv_transfers_different check (from_location_id <> to_location_id),
  constraint inv_transfers_received check ((status = 'received') = (received_at is not null))
);
create index if not exists idx_inv_transfers_open on inv_transfers(company_id, status) where status = 'in_transit';

-- -----------------------------------------------------------------------------
-- Physical units (individually tracked equipment AND physical kits)
-- -----------------------------------------------------------------------------
create table if not exists inv_units (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),     -- the OWNING company; moving a unit never changes it
  item_id             uuid not null references inv_items(id),
  code                text not null unique,                       -- permanent Enginious equipment ID, e.g. UAE-E-00042 (the QR label identifies it)
  serial_number       text check (serial_number is null or length(btrim(serial_number)) between 1 and 120),
  ownership           text not null default 'owned' check (ownership in ('owned', 'rental')),
  rental_id           uuid references inv_rentals(id),
  lifecycle           text not null default 'draft' check (lifecycle in ('draft', 'active', 'retired', 'missing')),
  condition           text not null default 'good' check (condition in ('good', 'fair', 'needs_inspection', 'damaged', 'unserviceable')),
  custody_kind        text not null default 'warehouse' check (custody_kind in ('warehouse', 'employee', 'project', 'transit', 'repair', 'kit')),
  -- Last known / current storage place. For a unit that is out (employee, project, transit, repair) it remains the place it left from.
  location_id         uuid references inv_locations(id),
  bin_id              uuid references inv_bins(id),
  employee_id         uuid references employees(id),
  project_id          uuid references proj_projects(id),
  transfer_id         uuid references inv_transfers(id),
  repair_reference    text,
  in_kit_id           uuid references inv_units(id),
  -- When a unit that is out is expected back. Overdue units are flagged and never presented as ready.
  expected_return_at  timestamptz,
  verified_at         timestamptz,
  verified_by         uuid references auth.users(id),
  -- A link to the earlier HR asset register row this unit was reconciled from (never two registers for one item).
  legacy_asset_id     uuid unique references assets(id),
  notes               text,
  version             integer not null default 1,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  retired_at          timestamptz,
  constraint inv_units_rental check ((ownership = 'rental') = (rental_id is not null)),
  constraint inv_units_custody check (
    case custody_kind
      when 'warehouse' then location_id is not null and employee_id is null and project_id is null and transfer_id is null and in_kit_id is null
      when 'employee'  then employee_id is not null and project_id is null and transfer_id is null and in_kit_id is null
      when 'project'   then project_id is not null and employee_id is null and transfer_id is null and in_kit_id is null
      when 'transit'   then transfer_id is not null and employee_id is null and project_id is null and in_kit_id is null
      when 'repair'    then repair_reference is not null and employee_id is null and project_id is null and in_kit_id is null
      when 'kit'       then in_kit_id is not null and employee_id is null and project_id is null and transfer_id is null
    end),
  constraint inv_units_not_own_kit check (in_kit_id is null or in_kit_id <> id),
  constraint inv_units_retired check ((lifecycle = 'retired') = (retired_at is not null)),
  constraint inv_units_verified check ((verified_at is null) = (verified_by is null))
);
-- Manufacturer serial numbers identify one unit of a model; two identical units never share one.
create unique index if not exists uq_inv_units_serial on inv_units(item_id, lower(btrim(serial_number))) where serial_number is not null;
create index if not exists idx_inv_units_item on inv_units(item_id);
create index if not exists idx_inv_units_company_location on inv_units(company_id, location_id) where custody_kind = 'warehouse';
create index if not exists idx_inv_units_employee on inv_units(employee_id) where custody_kind = 'employee';
create index if not exists idx_inv_units_project on inv_units(project_id) where custody_kind = 'project';
create index if not exists idx_inv_units_kit on inv_units(in_kit_id) where in_kit_id is not null;

-- -----------------------------------------------------------------------------
-- Quantity balances (identical items and consumables). One row per item + holder + condition (+ bin, rental). Never edited by hand:
-- the ledger functions change qty and write the matching movement line in one transaction. qty can never go below zero.
-- -----------------------------------------------------------------------------
create table if not exists inv_balances (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),     -- owning company
  item_id             uuid not null references inv_items(id),
  holder_kind         text not null check (holder_kind in ('warehouse', 'employee', 'project', 'transit', 'repair', 'kit')),
  location_id         uuid references inv_locations(id),
  bin_id              uuid references inv_bins(id),
  employee_id         uuid references employees(id),
  project_id          uuid references proj_projects(id),
  transfer_id         uuid references inv_transfers(id),
  kit_unit_id         uuid references inv_units(id),
  repair_reference    text,
  rental_id           uuid references inv_rentals(id),
  condition           text not null default 'good' check (condition in ('good', 'needs_inspection', 'damaged')),
  qty                 numeric(14, 3) not null default 0 check (qty >= 0),
  -- Stable label code for a warehouse bin of this item ("the item in this bin"): the QR identifies the combination, never a quantity.
  label_code          text unique,
  expected_return_at  timestamptz,
  verified_at         timestamptz,
  verified_by         uuid references auth.users(id),
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint inv_balances_holder check (
    case holder_kind
      when 'warehouse' then location_id is not null and employee_id is null and project_id is null and transfer_id is null and kit_unit_id is null
      when 'employee'  then employee_id is not null and project_id is null and transfer_id is null and kit_unit_id is null
      when 'project'   then project_id is not null and employee_id is null and transfer_id is null and kit_unit_id is null
      when 'transit'   then transfer_id is not null and employee_id is null and project_id is null and kit_unit_id is null
      when 'repair'    then repair_reference is not null and employee_id is null and project_id is null and kit_unit_id is null
      when 'kit'       then kit_unit_id is not null and employee_id is null and project_id is null and transfer_id is null
    end),
  constraint inv_balances_verified check ((verified_at is null) = (verified_by is null))
);
create unique index if not exists uq_inv_balances_key on inv_balances(
  company_id, item_id, holder_kind, condition,
  coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(bin_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(transfer_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(kit_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(repair_reference, ''), coalesce(rental_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_inv_balances_item_location on inv_balances(item_id, location_id) where holder_kind = 'warehouse';
create index if not exists idx_inv_balances_employee on inv_balances(employee_id) where holder_kind = 'employee';
create index if not exists idx_inv_balances_project on inv_balances(project_id) where holder_kind = 'project';

-- -----------------------------------------------------------------------------
-- Kits: a physical kit is an individually tracked unit of an item with tracking = 'kit'. Its contents checklist lives here.
-- A content unit packed into a kit is custody 'kit' (never independently available); a quantity content is a balance held by the kit.
-- A kit cannot contain a kit (no nesting, so no cycles) and a unit is packed in at most one kit.
-- -----------------------------------------------------------------------------
create table if not exists inv_kit_contents (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  kit_unit_id        uuid not null references inv_units(id),
  item_id            uuid not null references inv_items(id),     -- what the checklist expects
  expected_qty       numeric(14, 3) not null default 1 check (expected_qty > 0),
  is_required        boolean not null default true,
  -- present: the expected item is in the kit; missing: it is not (recorded, never hidden); substituted: another item stands in.
  status             text not null default 'missing' check (status in ('present', 'missing', 'substituted')),
  content_unit_id    uuid references inv_units(id),              -- the physical unit packed against this line (individual contents)
  present_qty        numeric(14, 3) not null default 0 check (present_qty >= 0),   -- quantity contents currently in the kit
  substitute_item_id uuid references inv_items(id),
  note               text,
  updated_at         timestamptz not null default now(),
  constraint inv_kit_contents_substitute check ((status = 'substituted') = (substitute_item_id is not null)),
  constraint inv_kit_contents_not_self check (content_unit_id is null or content_unit_id <> kit_unit_id)
);
create unique index if not exists uq_inv_kit_contents_unit on inv_kit_contents(content_unit_id) where content_unit_id is not null;
create unique index if not exists uq_inv_kit_contents_line on inv_kit_contents(kit_unit_id, item_id) where status <> 'substituted';
create index if not exists idx_inv_kit_contents_kit on inv_kit_contents(kit_unit_id);

-- -----------------------------------------------------------------------------
-- The movement ledger. Immutable: a mistake is fixed by a correction that names the movement it corrects and says why, never by
-- editing or deleting. Retried requests carry an idempotency key, so a repeated click cannot record a second receipt or movement.
-- -----------------------------------------------------------------------------
create table if not exists inv_movements (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  code                  text not null unique,
  kind                  text not null check (kind in (
                          'opening', 'receipt', 'rental_receipt', 'issue_employee', 'return_employee', 'reassign_employee',
                          'dispatch_project', 'return_project', 'transfer_project', 'transfer_dispatch', 'transfer_receive',
                          'consume', 'return_unused', 'repair_out', 'repair_in', 'pack_kit', 'unpack_kit', 'pool_change',
                          'condition_check', 'adjust_missing', 'adjust_found', 'adjust_retire', 'count_adjust', 'correction')),
  occurred_at           timestamptz not null default now(),
  recorded_at           timestamptz not null default now(),
  performed_by          uuid not null references auth.users(id),
  recipient_user_id     uuid references auth.users(id),
  recipient_employee_id uuid references employees(id),
  recipient_name        text,
  project_id            uuid references proj_projects(id),
  to_project_id         uuid references proj_projects(id),         -- direct project-to-project transfer: the destination
  employee_id           uuid references employees(id),
  request_id            uuid,                                      -- inv_requests(id), added with that table (migration 3)
  transfer_id           uuid references inv_transfers(id),
  from_location_id      uuid references inv_locations(id),
  to_location_id        uuid references inv_locations(id),
  expected_return_at    timestamptz,
  note                  text,
  reason                text,
  corrects_movement_id  uuid references inv_movements(id),
  idempotency_key       text check (idempotency_key is null or length(idempotency_key) between 8 and 120),
  constraint inv_movements_correction check (kind <> 'correction' or (corrects_movement_id is not null and length(btrim(coalesce(reason, ''))) > 0))
);
create unique index if not exists uq_inv_movements_idem on inv_movements(company_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_inv_movements_company_time on inv_movements(company_id, occurred_at desc);
create index if not exists idx_inv_movements_project on inv_movements(project_id) where project_id is not null;
create index if not exists idx_inv_movements_employee on inv_movements(employee_id) where employee_id is not null;

create table if not exists inv_movement_lines (
  id                 uuid primary key default gen_random_uuid(),
  movement_id        uuid not null references inv_movements(id),
  company_id         uuid not null references companies(id),
  item_id            uuid not null references inv_items(id),
  unit_id            uuid references inv_units(id),             -- individually tracked unit, when the line is about one
  qty                numeric(14, 3) not null check (qty > 0),
  -- Where it came from / went to. 'external' = outside the books (receipt, opening stock), 'consumed' = used up, 'adjustment' =
  -- a recorded correction of the count. Balance ids tie a quantity line to the exact rows it changed.
  from_kind          text not null check (from_kind in ('external', 'warehouse', 'employee', 'project', 'transit', 'repair', 'kit', 'adjustment')),
  to_kind            text not null check (to_kind in ('consumed', 'warehouse', 'employee', 'project', 'transit', 'repair', 'kit', 'adjustment')),
  from_location_id   uuid references inv_locations(id),
  to_location_id     uuid references inv_locations(id),
  from_bin_id        uuid references inv_bins(id),
  to_bin_id          uuid references inv_bins(id),
  from_employee_id   uuid references employees(id),
  to_employee_id     uuid references employees(id),
  from_project_id    uuid references proj_projects(id),
  to_project_id      uuid references proj_projects(id),
  from_balance_id    uuid references inv_balances(id),
  to_balance_id      uuid references inv_balances(id),
  condition_from     text,
  condition_to       text,
  exception_note     text
);
create index if not exists idx_inv_movement_lines_movement on inv_movement_lines(movement_id);
create index if not exists idx_inv_movement_lines_unit on inv_movement_lines(unit_id) where unit_id is not null;
create index if not exists idx_inv_movement_lines_item on inv_movement_lines(item_id);
create index if not exists idx_inv_movement_lines_from_balance on inv_movement_lines(from_balance_id) where from_balance_id is not null;
create index if not exists idx_inv_movement_lines_to_balance on inv_movement_lines(to_balance_id) where to_balance_id is not null;

create or replace function inv_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Stock movements are never edited or deleted. Record a correction that names this movement and says why.' using errcode = '55000';
end;
$$;
drop trigger if exists inv_movements_immutable on inv_movements;
create trigger inv_movements_immutable before update or delete on inv_movements for each row execute function inv_ledger_immutable();
drop trigger if exists inv_movement_lines_immutable on inv_movement_lines;
create trigger inv_movement_lines_immutable before update or delete on inv_movement_lines for each row execute function inv_ledger_immutable();

-- -----------------------------------------------------------------------------
-- Costs (own table so row-level security can hide them from everyone without 'view_costs'), and label history.
-- -----------------------------------------------------------------------------
create table if not exists inv_costs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id),
  item_id        uuid not null references inv_items(id),
  unit_id        uuid references inv_units(id),
  movement_id    uuid references inv_movements(id),
  purchase_date  date,
  unit_cost      numeric(14, 2) check (unit_cost is null or unit_cost >= 0),
  currency       text check (currency is null or currency ~ '^[A-Z]{3}$'),
  note           text,
  entered_by     uuid references auth.users(id),
  entered_at     timestamptz not null default now(),
  constraint inv_costs_subject check (unit_id is not null or movement_id is not null),
  constraint inv_costs_money check ((unit_cost is null) = (currency is null))
);
create index if not exists idx_inv_costs_unit on inv_costs(unit_id) where unit_id is not null;

-- Printing a label never creates equipment: a reprint of a damaged label is a row here and the same code.
create table if not exists inv_label_prints (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  unit_id     uuid references inv_units(id),
  balance_id  uuid references inv_balances(id),
  reason      text not null default 'first' check (reason in ('first', 'reprint')),
  printed_by  uuid references auth.users(id),
  printed_at  timestamptz not null default now(),
  constraint inv_label_prints_subject check ((unit_id is not null) <> (balance_id is not null))
);

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
-- The tracking method (and the unit of measure and decimals) cannot change once any unit, balance or movement exists for the item:
-- history must never be reinterpreted. inv_replace_item (migration 4) is the controlled way: retire and replace.
create or replace function inv_items_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.tracking, new.unit_of_measure, new.quantity_scale) is distinct from (old.tracking, old.unit_of_measure, old.quantity_scale) then
    if exists (select 1 from inv_units where item_id = old.id) or exists (select 1 from inv_balances where item_id = old.id)
       or exists (select 1 from inv_movement_lines where item_id = old.id) then
      raise exception 'The tracking method, unit and decimals of an item cannot change once it has stock or history. Replace the item instead.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists inv_items_guard_trg on inv_items;
create trigger inv_items_guard_trg before update on inv_items for each row execute function inv_items_guard();

-- Unit rows: the item must be an individual or kit item of the same company, and a kit-content unit may not be a kit itself.
create or replace function inv_units_guard()
returns trigger
language plpgsql
as $$
declare v_item inv_items; v_kit_item inv_items;
begin
  select * into v_item from inv_items where id = new.item_id;
  if v_item.id is null then raise exception 'Unknown item' using errcode = '22023'; end if;
  if v_item.tracking not in ('individual', 'kit') then
    raise exception 'Only individually tracked equipment and kits have unit records; % is tracked by quantity', v_item.name using errcode = '23514';
  end if;
  if v_item.company_id <> new.company_id then
    raise exception 'A unit belongs to the same company as its catalogue item' using errcode = '23514';
  end if;
  if new.in_kit_id is not null then
    if v_item.tracking = 'kit' then raise exception 'A kit cannot be packed inside another kit' using errcode = '23514'; end if;
    select i.* into v_kit_item from inv_units k join inv_items i on i.id = k.item_id where k.id = new.in_kit_id;
    if v_kit_item.id is null or v_kit_item.tracking <> 'kit' then raise exception 'That is not a kit' using errcode = '23514'; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists inv_units_guard_trg on inv_units;
create trigger inv_units_guard_trg before insert or update on inv_units for each row execute function inv_units_guard();

-- -----------------------------------------------------------------------------
-- Visibility helpers
-- -----------------------------------------------------------------------------
create or replace function inv_can_view_stock(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select inv_has_capability(p_company_id, 'warehouse') or inv_has_capability(p_company_id, 'view_stock');
$$;

-- May the caller operate stock at this location? Founders: every location of their company. A warehouse operator: the locations
-- they are assigned to, or every location when they hold 'cross_location'.
create or replace function inv_can_operate(p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from inv_locations l
    where l.id = p_location_id and l.is_active
      and (inv_is_founder(l.company_id)
           or (inv_has_capability(l.company_id, 'warehouse')
               and (inv_has_capability(l.company_id, 'cross_location')
                    or exists (select 1 from inv_operator_locations o
                                where o.user_id = auth.uid() and o.location_id = l.id and o.removed_at is null)))));
$$;

-- Catalogue summary (names, categories, counts of what is usable) is for Inventory grant holders and for Project Managers and
-- department heads of ongoing projects in the company, who prepare equipment requirements without needing a stock grant.
create or replace function inv_can_browse(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select inv_has_access(p_company_id)
      or exists (
        select 1 from proj_projects p
        where p.company_id = p_company_id and p.status not in ('completed', 'archived')
          and (p.pm_user_id = auth.uid()
               or exists (select 1 from proj_project_members m
                           where m.project_id = p.id and m.user_id = auth.uid() and m.removed_at is null and m.role in ('pm', 'acting_pm'))
               or exists (select 1 from proj_teams t where t.project_id = p.id and t.head_user_id = auth.uid() and t.removed_at is null)))
         and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.is_active);
$$;

-- -----------------------------------------------------------------------------
-- Row-level security: SELECT only.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['inv_locations', 'inv_categories', 'inv_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (inv_can_browse(company_id))', t || '_select', t);
  end loop;
  foreach t in array array['inv_bins'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (inv_can_browse(company_id))', t || '_select', t);
  end loop;
  foreach t in array array['inv_units', 'inv_balances', 'inv_kit_contents', 'inv_transfers', 'inv_rentals', 'inv_movements', 'inv_movement_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (inv_can_view_stock(company_id))', t || '_select', t);
  end loop;
end $$;

alter table inv_operator_locations enable row level security;
drop policy if exists inv_operator_locations_select on inv_operator_locations;
create policy inv_operator_locations_select on inv_operator_locations for select
  using (user_id = auth.uid() or inv_has_capability(company_id, 'manage_access'));

alter table inv_costs enable row level security;
drop policy if exists inv_costs_select on inv_costs;
create policy inv_costs_select on inv_costs for select using (inv_has_capability(company_id, 'view_costs'));

alter table inv_label_prints enable row level security;
drop policy if exists inv_label_prints_select on inv_label_prints;
create policy inv_label_prints_select on inv_label_prints for select using (inv_can_view_stock(company_id));

-- -----------------------------------------------------------------------------
-- Audit triggers on every table whose rows carry decisions (the ledger is its own immutable record).
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'inv_locations', 'inv_bins', 'inv_operator_locations', 'inv_categories', 'inv_items', 'inv_rentals', 'inv_transfers',
    'inv_units', 'inv_balances', 'inv_kit_contents', 'inv_costs'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function inv_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- Revoking Inventory access also ends the person's warehouse locations (history stays).
create or replace function inv_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target_is_founder boolean;
  v_founders integer;
begin
  perform inv_require_user();
  if not inv_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only an Inventory founder can revoke Inventory access for this company' using errcode = '42501';
  end if;
  select 'founder' = any (capabilities) into v_target_is_founder
    from inv_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_is_founder is null then return; end if;
  if v_target_is_founder and not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can revoke a founder' using errcode = '42501';
  end if;
  if v_target_is_founder then
    select count(*) into v_founders from inv_company_grants
     where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities);
    if v_founders <= 1 then
      raise exception 'Cannot revoke the last founder of this company' using errcode = '23514';
    end if;
  end if;
  update inv_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  update inv_operator_locations set removed_at = now() where user_id = p_user_id and company_id = p_company_id and removed_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: clients can only SELECT (through RLS); no DML, no TRUNCATE; sequences closed.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'inv_locations', 'inv_bins', 'inv_operator_locations', 'inv_categories', 'inv_items', 'inv_rentals', 'inv_transfers',
    'inv_units', 'inv_balances', 'inv_kit_contents', 'inv_movements', 'inv_movement_lines', 'inv_costs', 'inv_label_prints'
  ] loop
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant select on table %I to authenticated', t);
  end loop;
end $$;

revoke all on function inv_ledger_immutable(), inv_items_guard(), inv_units_guard(), inv_can_view_stock(uuid), inv_can_operate(uuid),
  inv_can_browse(uuid), inv_revoke_access(uuid, uuid) from public, anon, authenticated;
grant execute on function inv_can_view_stock(uuid), inv_can_operate(uuid), inv_can_browse(uuid), inv_revoke_access(uuid, uuid) to authenticated;

-- ROLLBACK (only before any Inventory data exists; afterwards use the safe-disable script, never drop):
--   drop table if exists inv_label_prints, inv_costs, inv_movement_lines, inv_movements, inv_kit_contents, inv_balances, inv_units,
--     inv_transfers, inv_rentals, inv_items, inv_categories, inv_operator_locations, inv_bins, inv_locations cascade;
--   drop function if exists inv_can_browse(uuid), inv_can_operate(uuid), inv_can_view_stock(uuid), inv_units_guard(), inv_items_guard(),
--     inv_ledger_immutable();
