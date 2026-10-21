-- Inventory, migration 4 of 6: the stock core. Every function that creates or changes stock, units, kits, counts or custody.
--
-- Stock changes ONLY through these functions, which write the ledger (inv_movements + inv_movement_lines, immutable) and change the stock
-- rows in the same transaction. Nothing edits a total directly; a mistake is fixed by a correction that names the original and says why.
-- All functions are SECURITY DEFINER with search_path = public. Errors: 42501 permission, 23514 state, 22023 input, 23505 duplicate;
-- the wording is for a warehouse operator. Movement functions take p_key (8-120 chars, idempotency key): same key + same caller + same
-- content = the original result comes back (replayed = true) and nothing changes; same key from someone else or with other content is refused.
-- Quantities are validated per item scale (metres 3 decimals, individual units whole) and stock can never go below zero.
--
-- SIGNATURES (client-facing). Every function returns jsonb unless shown.
--  configuration
--   inv_save_location(p_company_id, p_location_id, p_code, p_name, p_timezone, p_kind='warehouse', p_address=null, p_is_active=true) -> uuid   [founder only]
--   inv_save_bin(p_location_id, p_bin_id, p_code, p_label=null, p_is_active=true) -> uuid                                  [manage_catalogue]
--   inv_set_operator_locations(p_company_id, p_user_id, p_location_ids uuid[]) -> integer                                  [manage_access]
--   inv_save_category(p_company_id, p_category_id, p_name, p_parent_id=null, p_sort_order=0, p_is_active=true) -> uuid     [manage_catalogue]
--   inv_save_item(p_company_id, p_item_id, p_fields jsonb) -> uuid                                                         [manage_catalogue]
--   inv_replace_item(p_item_id, p_fields jsonb, p_reason) -> uuid                                                          [manage_catalogue]
--   inv_set_company_sharing(p_owner_company_id, p_use_company_id, p_enabled, p_note=null) -> uuid                          [founder of the owning company]
--  units and labels
--   inv_register_unit(p_company_id, p_item_id, p_serial_number=null, p_location_id=null, p_bin_id=null, p_condition='good', p_holder jsonb=null,
--                     p_cost jsonb=null, p_notes=null, p_key=null)                                          [operate(location) or manage_catalogue; cost needs view_costs]
--   inv_ensure_bin_label(p_company_id, p_item_id, p_location_id, p_bin_id=null)
--   inv_record_label_print(p_company_id, p_unit_id=null, p_balance_id=null) -> uuid
--  opening and counts
--   inv_start_count(p_company_id, p_location_id, p_kind 'opening'|'cycle', p_note=null)                                    [operate(location)]
--   inv_save_count_line(p_count_id, p_counted_qty, p_unit_id=null, p_item_id=null, p_bin_id=null, p_condition=null, p_reason=null, p_note=null,
--                       p_balance_id=null) -> uuid
--   inv_confirm_count(p_company_id, p_count_id, p_key, p_note=null)                                                        [confirm_stock]
--   inv_cancel_count(p_company_id, p_count_id, p_reason) -> void
--   inv_confirm_opening_custody(p_company_id, p_key, p_lines jsonb, p_note=null)                                           [confirm_stock]
--  movements (all need operate(location) as described in the design; p_key is the idempotency key)
--   inv_receive_stock(p_company_id, p_location_id, p_key, p_lines, p_rental jsonb=null, p_note=null)
--   inv_issue_to_employee(p_company_id, p_location_id, p_employee_id, p_key, p_lines, p_expected_return_at=null, p_note=null, p_request_id=null)
--   inv_return_from_employee(p_company_id, p_location_id, p_employee_id, p_key, p_lines, p_note=null)
--   inv_dispatch_to_project(p_company_id, p_location_id, p_project_id, p_key, p_lines, p_request_id=null, p_expected_return_at=null, p_note=null)
--   inv_return_from_project(p_company_id, p_location_id, p_project_id, p_key, p_lines, p_note=null)
--   inv_transfer_between_projects(p_company_id, p_from_project_id, p_to_project_id, p_key, p_lines, p_request_id, p_expected_return_at=null, p_note=null)
--   inv_transfer_dispatch(p_company_id, p_from_location_id, p_to_location_id, p_key, p_lines, p_expected_at=null, p_carrier=null, p_reference=null, p_note=null)
--   inv_transfer_receive(p_company_id, p_transfer_id, p_key, p_lines=null, p_note=null)                         [operate(destination)]
--   inv_consume(p_company_id, p_location_id, p_key, p_lines, p_employee_id=null, p_project_id=null, p_request_id=null, p_note=null)
--   inv_return_unused(p_company_id, p_location_id, p_key, p_lines, p_employee_id=null, p_project_id=null, p_note=null)
--   inv_repair_out(p_company_id, p_location_id, p_key, p_lines, p_repair_reference, p_expected_return_at=null, p_note=null)
--   inv_repair_in(p_company_id, p_location_id, p_key, p_lines, p_note=null)
--   inv_pack_kit(p_company_id, p_location_id, p_key, p_kit_unit_id, p_lines, p_note=null)
--   inv_unpack_kit(p_company_id, p_location_id, p_key, p_kit_unit_id, p_lines=null, p_note=null)
--   inv_set_kit_line(p_company_id, p_kit_unit_id, p_item_id, p_expected_qty=null, p_is_required=null, p_note=null, p_remove=false) -> uuid
--   inv_check_condition(p_company_id, p_location_id, p_key, p_lines, p_note=null)
--   inv_adjust_stock(p_company_id, p_location_id, p_key, p_action 'missing'|'found'|'retire', p_lines, p_reason)
--   inv_correct_movement(p_company_id, p_movement_id, p_key, p_reason, p_lines)                                            [confirm_stock]
--   inv_return_rental(p_company_id, p_location_id, p_key, p_rental_id, p_lines=null, p_note=null)
--   inv_transaction_status(p_company_id, p_key) -> jsonb
--   inv_ledger_problems() -> table (problem, company_id, subject_id, detail)                                              [read-only; view_audit]
-- Internal (not client-callable): inv_refresh_request_status(request_id) -> text keeps a request's status true (fulfilled / closed); the
-- planning functions call it after cancelling a request line.
-- Additions: table inv_company_sharing (owner company -> using company), table inv_idempotency (internal), column
-- inv_movement_lines.corrects_line_id, movement kind 'rental_return'.
-- Prerequisites: migrations 1-3 and 3b (20261201000000 .. 20261201000250) and the Projects migrations (proj_projects, proj_can_manage).
-- At run time (not at install) the dispatch functions call inv_effective_item(), defined by the planning migration 20261201000400, which
-- therefore has to be applied before any stock is moved against a request.
-- Does not write HR, CRM or Projects tables (inv_mirror_legacy, replaced in migration 6, keeps the HR asset register in step).

-- =============================================================================
-- Additions to the ledger tables (additive; nothing is dropped)
-- =============================================================================
-- A rental going back to its supplier is a movement too.
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'inv_movements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%rental_receipt%';
  if v_name is not null then execute format('alter table inv_movements drop constraint %I', v_name); end if;
end $$;
alter table inv_movements add constraint inv_movements_kind_check check (kind in (
  'opening', 'receipt', 'rental_receipt', 'rental_return', 'issue_employee', 'return_employee', 'reassign_employee',
  'dispatch_project', 'return_project', 'transfer_project', 'transfer_dispatch', 'transfer_receive',
  'consume', 'return_unused', 'repair_out', 'repair_in', 'pack_kit', 'unpack_kit', 'pool_change',
  'condition_check', 'adjust_missing', 'adjust_found', 'adjust_retire', 'count_adjust', 'correction'));

-- A correction line names the original line it corrects, so the original is preserved and the effect can be followed.
alter table inv_movement_lines add column if not exists corrects_line_id uuid references inv_movement_lines(id);
create index if not exists idx_inv_movement_lines_corrects on inv_movement_lines(corrects_line_id) where corrects_line_id is not null;

-- -----------------------------------------------------------------------------
-- Cross-company use. Equipment belongs to the company of its catalogue item. Using it at another company's location, on another
-- company's project or with another company's employee needs a row here, made by a founder of the OWNING company.
-- -----------------------------------------------------------------------------
create table if not exists inv_company_sharing (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),          -- the OWNING company (also what the audit log files it under)
  use_company_id  uuid not null references companies(id),          -- the company allowed to use the owner's equipment
  note            text,
  authorised_by   uuid not null references auth.users(id),
  authorised_at   timestamptz not null default now(),
  revoked_by      uuid references auth.users(id),
  revoked_at      timestamptz,
  constraint inv_company_sharing_different check (company_id <> use_company_id),
  constraint inv_company_sharing_revoked check ((revoked_by is null) = (revoked_at is null))
);
create unique index if not exists uq_inv_company_sharing_active on inv_company_sharing(company_id, use_company_id) where revoked_at is null;

alter table inv_company_sharing enable row level security;
drop policy if exists inv_company_sharing_select on inv_company_sharing;
create policy inv_company_sharing_select on inv_company_sharing for select
  using (inv_has_capability(company_id, 'manage_access') or inv_has_capability(use_company_id, 'manage_access'));
drop trigger if exists inv_company_sharing_audit on inv_company_sharing;
create trigger inv_company_sharing_audit after insert or update or delete on inv_company_sharing
  for each row execute function inv_audit_trigger();

-- -----------------------------------------------------------------------------
-- Idempotency keys. One row per (company, key): who used it, a fingerprint of what was asked, and the result that was returned.
-- Nobody reads this table directly; inv_transaction_status() is the lookup.
-- -----------------------------------------------------------------------------
create table if not exists inv_idempotency (
  company_id   uuid not null references companies(id),
  idem_key     text not null check (length(idem_key) between 8 and 120),
  kind         text not null,
  fingerprint  text not null,
  performed_by uuid not null references auth.users(id),
  movement_id  uuid references inv_movements(id),
  result       jsonb,
  created_at   timestamptz not null default now(),
  primary key (company_id, idem_key)
);
alter table inv_idempotency enable row level security;   -- no policy: only the SECURITY DEFINER code reads it

-- =============================================================================
-- Internal helpers (never executable by clients)
-- =============================================================================

-- Signed in, company named, Inventory switched on for it.
create or replace function inv_ctx(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform inv_require_user();
  if p_company_id is null then raise exception 'Choose a company' using errcode = '22023'; end if;
  perform inv_require_enabled(p_company_id);
end;
$$;

create or replace function inv_require_cap(p_company_id uuid, p_capability text, p_message text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not inv_has_capability(p_company_id, p_capability) then
    raise exception '%', p_message using errcode = '42501';
  end if;
end;
$$;

-- The location, which must belong to the company; the caller must be able to work there (unless p_must_operate is false).
create or replace function inv_loc(p_company_id uuid, p_location_id uuid, p_must_operate boolean default true)
returns inv_locations
language plpgsql security definer
set search_path = public
as $$
declare l inv_locations;
begin
  if p_location_id is null then raise exception 'Choose a location' using errcode = '22023'; end if;
  select * into l from inv_locations where id = p_location_id;
  if l.id is null or l.company_id <> p_company_id then raise exception 'Unknown location' using errcode = '22023'; end if;
  if p_must_operate then
    if not inv_can_operate(l.id) then
      if not l.is_active and (inv_is_founder(l.company_id) or inv_has_capability(l.company_id, 'warehouse')) then
        raise exception 'That location is switched off' using errcode = '23514';
      end if;
      raise exception 'You are not set up to work at this location. Ask a founder to add it to your access.' using errcode = '42501';
    end if;
  end if;
  return l;
end;
$$;

create or replace function inv_check_bin(p_bin_id uuid, p_location_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_bin_id is null then return; end if;
  if not exists (select 1 from inv_bins where id = p_bin_id and location_id = p_location_id and is_active) then
    raise exception 'That bin does not exist at this location' using errcode = '22023';
  end if;
end;
$$;

-- Owner company -> using company. Same company is always fine.
create or replace function inv_check_sharing(p_owner uuid, p_use uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_owner is null or p_use is null or p_owner = p_use then return; end if;
  if exists (select 1 from inv_company_sharing s where s.company_id = p_owner and s.use_company_id = p_use and s.revoked_at is null) then return; end if;
  raise exception 'This equipment belongs to another company. A founder of the owning company has to authorise sharing before it can be used here.'
    using errcode = '42501';
end;
$$;

create or replace function inv_get_item(p_item_id uuid)
returns inv_items
language plpgsql security definer
set search_path = public
as $$
declare i inv_items;
begin
  select * into i from inv_items where id = p_item_id;
  if i.id is null then raise exception 'Unknown item' using errcode = '22023'; end if;
  return i;
end;
$$;

create or replace function inv_get_employee(p_employee_id uuid, p_must_be_active boolean)
returns employees
language plpgsql security definer
set search_path = public
as $$
declare e employees;
begin
  if p_employee_id is null then raise exception 'Choose the employee' using errcode = '22023'; end if;
  select * into e from employees where id = p_employee_id and deleted_at is null;
  if e.id is null then raise exception 'Unknown employee' using errcode = '22023'; end if;
  if p_must_be_active and (e.employment_status = 'terminated' or (e.termination_date is not null and e.termination_date < current_date)) then
    raise exception 'That employee has left the company. Equipment cannot be issued to them' using errcode = '23514';
  end if;
  return e;
end;
$$;

-- Equipment may only leave for, or be handled on, a project that is still running.
create or replace function inv_get_project(p_project_id uuid, p_must_be_ongoing boolean)
returns proj_projects
language plpgsql security definer
set search_path = public
as $$
declare p proj_projects;
begin
  if p_project_id is null then raise exception 'Choose the project' using errcode = '22023'; end if;
  select * into p from proj_projects where id = p_project_id for share;
  if p.id is null then raise exception 'Unknown project' using errcode = '22023'; end if;
  if p_must_be_ongoing and p.status in ('completed', 'archived', 'on_hold') then
    raise exception 'Project % is % and cannot receive equipment', p.reference, replace(p.status, '_', ' ') using errcode = '23514';
  end if;
  return p;
end;
$$;

create or replace function inv_lines_array(p_lines jsonb)
returns void
language plpgsql immutable
as $$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'Too many lines in one request (500 at most)' using errcode = '22023'; end if;
end;
$$;

-- Lock every item named by the lines (directly, or through a unit), in one deterministic order, before anything is read for update.
create or replace function inv_lock_lines(p_lines jsonb, p_extra_items uuid[] default '{}'::uuid[])
returns void
language plpgsql
as $$
declare r record;
begin
  for r in
    select x.item_id from (
      select coalesce(nullif(e->>'item_id', '')::uuid, (select u.item_id from inv_units u where u.id = nullif(e->>'unit_id', '')::uuid)) as item_id
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
      union
      select unnest(p_extra_items)) x
    where x.item_id is not null
    order by x.item_id
  loop
    perform inv_lock_item(r.item_id);
  end loop;
end;
$$;

create or replace function inv_unit_lock(p_unit_id uuid)
returns inv_units
language plpgsql
as $$
declare u inv_units;
begin
  if p_unit_id is null then raise exception 'Name the equipment (unit) for this line' using errcode = '22023'; end if;
  select * into u from inv_units where id = p_unit_id for update;
  if u.id is null then raise exception 'Unknown equipment' using errcode = '22023'; end if;
  return u;
end;
$$;

create or replace function inv_custody_words(p_kind text)
returns text
language sql immutable
as $$
  select case p_kind when 'warehouse' then 'on the shelf' when 'employee' then 'with an employee' when 'project' then 'out on a project'
                     when 'transit' then 'in transit' when 'repair' then 'out for repair' when 'kit' then 'packed in a kit' else p_kind end;
$$;

-- Why can this unit not be handled as a thing on the shelf at the location? NULL when it can.
create or replace function inv_unit_block_reason(u inv_units, p_location_id uuid, p_require_usable boolean default true)
returns text
language plpgsql stable
as $$
begin
  if u.lifecycle = 'draft' then return u.code || ' has not been counted and confirmed yet, so it cannot be used'; end if;
  if u.lifecycle = 'missing' then return u.code || ' is recorded as missing'; end if;
  if u.lifecycle = 'retired' then return u.code || ' is retired'; end if;
  if u.custody_kind = 'kit' then return u.code || ' is packed in a kit and cannot be handled on its own'; end if;
  if u.custody_kind <> 'warehouse' then return u.code || ' is not on the shelf: it is ' || inv_custody_words(u.custody_kind); end if;
  if p_location_id is not null and u.location_id <> p_location_id then return u.code || ' is at a different location'; end if;
  if p_require_usable and u.condition not in ('good', 'fair') then
    return u.code || ' is ' || replace(u.condition, '_', ' ') || ' and is held back until it has been inspected';
  end if;
  return null;
end;
$$;

-- The first active reservation of the unit that overlaps [p_from, p_until) (NULL until = open ended), as text, or NULL.
create or replace function inv_unit_reserved_by(p_unit_id uuid, p_from timestamptz, p_until timestamptz, p_ignore_request uuid default null, p_ignore_project uuid default null)
returns text
language sql stable
as $$
  select q.code || coalesce(' (project ' || pr.reference || ')', '')
    from inv_reservations r
    join inv_request_lines l on l.id = r.request_line_id
    join inv_requests q on q.id = l.request_id
    left join proj_projects pr on pr.id = q.project_id
   where r.unit_id = p_unit_id and r.status = 'active' and r.reserved_during && tstzrange(p_from, p_until)
     and (p_ignore_request is null or q.id <> p_ignore_request)
     and (p_ignore_project is null or q.project_id is distinct from p_ignore_project)
   order by r.made_at limit 1;
$$;

create or replace function inv_valid_condition(p_condition text, p_for_balance boolean default false)
returns text
language plpgsql immutable
as $$
begin
  if p_condition is null then raise exception 'Say the condition (good, needs inspection or damaged)' using errcode = '22023'; end if;
  if p_for_balance then
    if p_condition not in ('good', 'needs_inspection', 'damaged') then
      raise exception 'Quantity stock is either good, needs_inspection or damaged' using errcode = '22023';
    end if;
  elsif p_condition not in ('good', 'fair', 'needs_inspection', 'damaged', 'unserviceable') then
    raise exception 'Unknown condition %', p_condition using errcode = '22023';
  end if;
  return p_condition;
end;
$$;

-- -----------------------------------------------------------------------------
-- Balances. Quantity changes only through inv_bal_change, always paired with an inv_ml() ledger line in the same transaction.
-- -----------------------------------------------------------------------------
create or replace function inv_bal_ensure(
  p_company_id uuid, p_item_id uuid, p_holder text, p_condition text,
  p_location uuid default null, p_bin uuid default null, p_employee uuid default null, p_project uuid default null,
  p_transfer uuid default null, p_kit uuid default null, p_repair text default null, p_rental uuid default null,
  p_expected timestamptz default null)
returns uuid
language plpgsql
as $$
declare
  v_loc uuid := case when p_holder = 'warehouse' then p_location end;
  v_bin uuid := case when p_holder = 'warehouse' then p_bin end;
  v_emp uuid := case when p_holder = 'employee' then p_employee end;
  v_prj uuid := case when p_holder = 'project' then p_project end;
  v_trf uuid := case when p_holder = 'transit' then p_transfer end;
  v_kit uuid := case when p_holder = 'kit' then p_kit end;
  v_rep text := case when p_holder = 'repair' then p_repair end;
  v_id uuid;
begin
  select b.id into v_id from inv_balances b
   where b.company_id = p_company_id and b.item_id = p_item_id and b.holder_kind = p_holder and b.condition = p_condition
     and b.location_id is not distinct from v_loc and b.bin_id is not distinct from v_bin and b.employee_id is not distinct from v_emp
     and b.project_id is not distinct from v_prj and b.transfer_id is not distinct from v_trf and b.kit_unit_id is not distinct from v_kit
     and coalesce(b.repair_reference, '') = coalesce(v_rep, '') and b.rental_id is not distinct from p_rental
   for update;
  if v_id is null then
    begin
      insert into inv_balances (company_id, item_id, holder_kind, location_id, bin_id, employee_id, project_id, transfer_id, kit_unit_id,
                                repair_reference, rental_id, condition, qty, expected_return_at)
      values (p_company_id, p_item_id, p_holder, v_loc, v_bin, v_emp, v_prj, v_trf, v_kit, v_rep, p_rental, p_condition, 0, p_expected)
      returning id into v_id;
    exception when unique_violation then
      select b.id into v_id from inv_balances b
       where b.company_id = p_company_id and b.item_id = p_item_id and b.holder_kind = p_holder and b.condition = p_condition
         and b.location_id is not distinct from v_loc and b.bin_id is not distinct from v_bin and b.employee_id is not distinct from v_emp
         and b.project_id is not distinct from v_prj and b.transfer_id is not distinct from v_trf and b.kit_unit_id is not distinct from v_kit
         and coalesce(b.repair_reference, '') = coalesce(v_rep, '') and b.rental_id is not distinct from p_rental
       for update;
    end;
  end if;
  return v_id;
end;
$$;

-- Add (or take away) quantity on a balance. Never below zero. A first positive change marks the balance verified (who / when).
create or replace function inv_bal_change(p_balance_id uuid, p_delta numeric, p_expected timestamptz default null)
returns numeric
language plpgsql
as $$
declare b inv_balances; v_name text; v_new numeric;
begin
  select * into b from inv_balances where id = p_balance_id for update;
  if b.id is null then raise exception 'Unknown stock row' using errcode = '22023'; end if;
  v_new := b.qty + p_delta;
  if v_new < 0 then
    select name into v_name from inv_items where id = b.item_id;
    raise exception 'Not enough % in stock: % available, % needed', v_name, trim_scale(b.qty), trim_scale(-p_delta) using errcode = '23514';
  end if;
  update inv_balances set qty = v_new, version = version + 1, updated_at = now(),
         verified_at = case when p_delta > 0 and verified_at is null then now() else verified_at end,
         verified_by = case when p_delta > 0 and verified_at is null then auth.uid() else verified_by end,
         expected_return_at = case when p_expected is not null then greatest(coalesce(expected_return_at, p_expected), p_expected) else expected_return_at end
   where id = b.id;
  return v_new;
end;
$$;

-- Take p_qty of an item from balances of one holder, locking them. Rows come back so the caller can write one ledger line per
-- balance. Own stock is used before rental stock unless a rental is named. Raises in plain words when there is not enough.
create or replace function inv_take_qty(
  p_item_id uuid, p_qty numeric, p_holder text,
  p_location uuid default null, p_bin uuid default null, p_employee uuid default null, p_project uuid default null,
  p_transfer uuid default null, p_condition text default null, p_rental uuid default null, p_rentals text default 'owned',
  p_repair text default null, p_kit uuid default null, p_where text default null)
returns table (balance_id uuid, taken numeric, rental_id uuid, bin_id uuid, condition text, expected_return_at timestamptz)
language plpgsql
as $$
declare
  r record;
  v_left numeric := p_qty;
  v_have numeric := 0;
  v_take numeric;
  v_name text;
begin
  for r in
    select b.* from inv_balances b
     where b.item_id = p_item_id and b.holder_kind = p_holder and b.qty > 0
       and (p_holder <> 'warehouse' or b.location_id = p_location)
       and (p_bin is null or b.bin_id = p_bin)
       and (p_holder <> 'employee' or b.employee_id = p_employee)
       and (p_holder <> 'project' or b.project_id = p_project)
       and (p_holder <> 'transit' or b.transfer_id = p_transfer)
       and (p_holder <> 'repair' or b.repair_reference = p_repair)
       and (p_holder <> 'kit' or b.kit_unit_id = p_kit)
       and (p_condition is null or b.condition = p_condition)
       and (case p_rentals when 'owned' then b.rental_id is null when 'only' then b.rental_id is not distinct from p_rental else true end)
     order by (b.rental_id is not null), b.qty desc, b.id
       for update
  loop
    v_have := v_have + r.qty;
    exit when v_left <= 0;
    v_take := least(r.qty, v_left);
    balance_id := r.id; taken := v_take; rental_id := r.rental_id; bin_id := r.bin_id; condition := r.condition; expected_return_at := r.expected_return_at;
    v_left := v_left - v_take;
    return next;
  end loop;
  if v_left > 0 then
    select name into v_name from inv_items where id = p_item_id;
    -- v_have only counts rows visited; recount for an honest message
    select coalesce(sum(b.qty), 0) into v_have from inv_balances b
     where b.item_id = p_item_id and b.holder_kind = p_holder and b.qty > 0
       and (p_holder <> 'warehouse' or b.location_id = p_location) and (p_bin is null or b.bin_id = p_bin)
       and (p_holder <> 'employee' or b.employee_id = p_employee) and (p_holder <> 'project' or b.project_id = p_project)
       and (p_holder <> 'transit' or b.transfer_id = p_transfer) and (p_holder <> 'repair' or b.repair_reference = p_repair)
       and (p_holder <> 'kit' or b.kit_unit_id = p_kit) and (p_condition is null or b.condition = p_condition)
       and (case p_rentals when 'owned' then b.rental_id is null when 'only' then b.rental_id is not distinct from p_rental else true end);
    raise exception 'Not enough % %: % available, % needed', v_name, coalesce(p_where, 'in stock'), trim_scale(v_have), trim_scale(p_qty) using errcode = '23514';
  end if;
  return;
end;
$$;

-- One ledger line.
create or replace function inv_ml(
  p_movement_id uuid, p_company_id uuid, p_item_id uuid, p_unit_id uuid, p_qty numeric, p_from_kind text, p_to_kind text,
  p_from_loc uuid default null, p_to_loc uuid default null, p_from_bin uuid default null, p_to_bin uuid default null,
  p_from_emp uuid default null, p_to_emp uuid default null, p_from_proj uuid default null, p_to_proj uuid default null,
  p_from_bal uuid default null, p_to_bal uuid default null, p_cond_from text default null, p_cond_to text default null,
  p_note text default null, p_corrects uuid default null)
returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  insert into inv_movement_lines (movement_id, company_id, item_id, unit_id, qty, from_kind, to_kind, from_location_id, to_location_id,
      from_bin_id, to_bin_id, from_employee_id, to_employee_id, from_project_id, to_project_id, from_balance_id, to_balance_id,
      condition_from, condition_to, exception_note, corrects_line_id)
  values (p_movement_id, p_company_id, p_item_id, p_unit_id, p_qty, p_from_kind, p_to_kind, p_from_loc, p_to_loc,
      p_from_bin, p_to_bin, p_from_emp, p_to_emp, p_from_proj, p_to_proj, p_from_bal, p_to_bal,
      p_cond_from, p_cond_to, nullif(btrim(p_note), ''), p_corrects)
  returning id into v_id;
  return v_id;
end;
$$;

-- Where a unit is, in one statement (so the custody constraint is checked on the finished row). Out-of-warehouse custodies keep the
-- last storage location; the bin is cleared unless the unit is back on a shelf.
create or replace function inv_unit_move(
  p_unit_id uuid, p_custody text, p_location uuid default null, p_bin uuid default null, p_employee uuid default null,
  p_project uuid default null, p_transfer uuid default null, p_repair text default null, p_kit uuid default null,
  p_expected timestamptz default null, p_condition text default null)
returns void
language plpgsql
as $$
begin
  update inv_units set
    custody_kind = p_custody,
    location_id = coalesce(p_location, location_id),
    bin_id = case when p_custody = 'warehouse' then p_bin else null end,
    employee_id = case when p_custody = 'employee' then p_employee end,
    project_id = case when p_custody = 'project' then p_project end,
    transfer_id = case when p_custody = 'transit' then p_transfer end,
    repair_reference = case when p_custody = 'repair' then p_repair end,
    in_kit_id = case when p_custody = 'kit' then p_kit end,
    expected_return_at = case when p_custody in ('employee', 'project', 'transit', 'repair') then p_expected end,
    condition = coalesce(p_condition, condition),
    version = version + 1
   where id = p_unit_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Idempotency and the movement header. Every movement function does exactly this, so they all behave identically:
--   same key + same caller + same content  -> the original result comes back, nothing changes (replay = true)
--   same key from another caller, or other content -> refused
-- Takes the movement code first (a fixed lock order: code counter, then item locks), writes the header, returns its id.
-- -----------------------------------------------------------------------------
create or replace function inv_idem_begin(p_company_id uuid, p_key text, p_kind text, p_content jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_fp text := md5(p_kind || ':' || coalesce(p_content::text, ''));
  v_row inv_idempotency;
  v_n integer;
begin
  if length(v_key) < 8 or length(v_key) > 120 then
    raise exception 'The transaction key must be 8 to 120 characters' using errcode = '22023';
  end if;
  insert into inv_idempotency (company_id, idem_key, kind, fingerprint, performed_by)
  values (p_company_id, v_key, p_kind, v_fp, auth.uid())
  on conflict (company_id, idem_key) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then return null; end if;
  select * into v_row from inv_idempotency where company_id = p_company_id and idem_key = v_key;
  if v_row.performed_by <> auth.uid() then
    raise exception 'That transaction key was already used by someone else. Start a new request.' using errcode = '23505';
  end if;
  if v_row.fingerprint <> v_fp then
    raise exception 'That transaction key was already used for a different request. Start a new request.' using errcode = '23505';
  end if;
  if v_row.result is null then
    raise exception 'That request is still being recorded. Try again in a moment.' using errcode = '55P03';
  end if;
  return v_row.result || jsonb_build_object('replayed', true);
end;
$$;

-- p_header keys: project_id, to_project_id, employee_id, recipient_employee_id, request_id, transfer_id, from_location_id,
-- to_location_id, expected_return_at, note, reason, corrects_movement_id.
create or replace function inv_begin_movement(p_company_id uuid, p_kind text, p_key text, p_content jsonb, p_header jsonb default '{}'::jsonb, p_skip_idem boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_prev jsonb;
  v_code text;
  v_id uuid;
begin
  if not p_skip_idem then
    v_prev := inv_idem_begin(p_company_id, p_key, p_kind, p_content);
    if v_prev is not null then
      return jsonb_build_object('replay', true, 'result', v_prev);
    end if;
  end if;
  v_code := inv_next_code(p_company_id, 'movement');
  insert into inv_movements (company_id, code, kind, occurred_at, recorded_at, performed_by, recipient_employee_id, project_id, to_project_id,
      employee_id, request_id, transfer_id, from_location_id, to_location_id, expected_return_at, note, reason, corrects_movement_id, idempotency_key)
  values (p_company_id, v_code, p_kind, clock_timestamp(), clock_timestamp(), auth.uid(),
      nullif(p_header->>'recipient_employee_id', '')::uuid, nullif(p_header->>'project_id', '')::uuid, nullif(p_header->>'to_project_id', '')::uuid,
      nullif(p_header->>'employee_id', '')::uuid, nullif(p_header->>'request_id', '')::uuid, nullif(p_header->>'transfer_id', '')::uuid,
      nullif(p_header->>'from_location_id', '')::uuid, nullif(p_header->>'to_location_id', '')::uuid,
      nullif(p_header->>'expected_return_at', '')::timestamptz, nullif(btrim(p_header->>'note'), ''), nullif(btrim(p_header->>'reason'), ''),
      nullif(p_header->>'corrects_movement_id', '')::uuid, btrim(p_key))
  returning id into v_id;
  update inv_idempotency set movement_id = v_id where company_id = p_company_id and idem_key = btrim(p_key);
  return jsonb_build_object('replay', false, 'movement_id', v_id, 'code', v_code);
end;
$$;

-- Stores the result against the key (so a retry gets exactly this back) and returns it.
create or replace function inv_finish_movement(p_company_id uuid, p_key text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_row inv_idempotency;
  v_m inv_movements;
  v_result jsonb;
begin
  select * into v_row from inv_idempotency where company_id = p_company_id and idem_key = btrim(p_key);
  select * into v_m from inv_movements where id = v_row.movement_id;
  v_result := jsonb_build_object('movement_id', v_m.id, 'code', v_m.code, 'kind', v_m.kind, 'recorded_at', v_m.recorded_at) || coalesce(p_extra, '{}'::jsonb);
  update inv_idempotency set result = v_result where company_id = p_company_id and idem_key = btrim(p_key);
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reservation progress (the planning functions of migration 5 create reservations; the stock functions only move their counters).
-- -----------------------------------------------------------------------------
-- Dispatch against a request: the unit (or quantity) must be reserved by that request. Returns the quantity covered.
create or replace function inv_reservation_take(p_request_id uuid, p_item_id uuid, p_unit_id uuid, p_qty numeric, p_location_id uuid, p_also_return boolean default false)
returns numeric
language plpgsql
as $$
declare r record; v_left numeric := p_qty; v_take numeric;
begin
  for r in
    select res.* from inv_reservations res join inv_request_lines l on l.id = res.request_line_id
     where l.request_id = p_request_id and res.item_id = p_item_id and inv_effective_item(l) = p_item_id
       and res.status = 'active' and res.dispatched_qty < res.qty
       and ((p_unit_id is not null and res.unit_id = p_unit_id) or (p_unit_id is null and res.unit_id is null and (p_location_id is null or res.location_id = p_location_id)))
     order by res.made_at, res.id for update of res
  loop
    exit when v_left <= 0;
    v_take := least(r.qty - r.dispatched_qty, v_left);
    update inv_reservations set dispatched_qty = dispatched_qty + v_take,
           returned_qty = returned_qty + case when p_also_return then v_take else 0 end,
           status = case when p_also_return and dispatched_qty + v_take = qty then 'completed' else status end
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
  return p_qty - v_left;
end;
$$;

-- Return progress on the reservations of one project's requests: returned_qty goes up. A reservation is 'completed' only when everything
-- reserved was dispatched AND is back; while some of it was never dispatched it stays active and keeps blocking that rest.
create or replace function inv_reservation_return(p_project_id uuid, p_item_id uuid, p_unit_id uuid, p_qty numeric)
returns numeric
language plpgsql
as $$
declare r record; v_left numeric := p_qty; v_take numeric;
begin
  for r in
    select res.* from inv_reservations res join inv_request_lines l on l.id = res.request_line_id join inv_requests q on q.id = l.request_id
     where q.project_id = p_project_id and res.item_id = p_item_id and res.status = 'active' and res.dispatched_qty > res.returned_qty
       and ((p_unit_id is not null and res.unit_id = p_unit_id) or (p_unit_id is null and res.unit_id is null))
     order by res.made_at, res.id for update of res
  loop
    exit when v_left <= 0;
    v_take := least(r.dispatched_qty - r.returned_qty, v_left);
    update inv_reservations set returned_qty = returned_qty + v_take,
           status = case when returned_qty + v_take = qty then 'completed' else status end
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
  return p_qty - v_left;
end;
$$;

-- Keeps the status of a request true to what has physically happened (never touches a cancelled or closed request):
--   project request  -> 'in_progress' once something went out, 'fulfilled' when every non-cancelled line is fully dispatched,
--                       'closed' when all of that has also come back;
--   employee request -> 'fulfilled' when every non-cancelled line has been issued.
-- Called by the stock functions after every dispatch, return, issue and transfer; the planning functions call it after cancelling a line.
create or replace function inv_refresh_request_status(p_request_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  v_lines integer; v_unfilled integer; v_done numeric; v_back numeric; v_new text;
begin
  select * into r from inv_requests where id = p_request_id for update;
  if r.id is null then return null; end if;
  if r.status not in ('submitted', 'in_progress', 'fulfilled') then return r.status; end if;
  select count(*) into v_lines from inv_request_lines where request_id = r.id and status <> 'cancelled';
  if v_lines = 0 then return r.status; end if;
  if r.kind = 'project' then
    select count(*) filter (where coalesce(x.disp, 0) < l.qty), coalesce(sum(x.disp), 0), coalesce(sum(x.ret), 0)
      into v_unfilled, v_done, v_back
      from inv_request_lines l
      left join lateral (select sum(res.dispatched_qty) disp, sum(res.returned_qty) ret from inv_reservations res
                          where res.request_line_id = l.id and res.status in ('active', 'completed')) x on true
     where l.request_id = r.id and l.status <> 'cancelled';
    v_new := case when v_done > 0 and v_unfilled = 0 and v_back = v_done then 'closed'
                  when v_unfilled = 0 then 'fulfilled'
                  when v_done > 0 then 'in_progress'
                  else r.status end;
  else
    select count(*) filter (where coalesce(x.issued, 0) < l.qty), coalesce(sum(x.issued), 0)
      into v_unfilled, v_done
      from inv_request_lines l
      left join lateral (select sum(ml.qty) issued from inv_movement_lines ml join inv_movements m on m.id = ml.movement_id
                          where m.request_id = r.id and m.kind = 'issue_employee' and ml.item_id = inv_effective_item(l)) x on true
     where l.request_id = r.id and l.status <> 'cancelled';
    v_new := case when v_unfilled = 0 then 'fulfilled' when v_done > 0 then 'in_progress' else r.status end;
  end if;
  if v_new is distinct from r.status then
    update inv_requests set status = v_new, updated_at = now() where id = r.id;
  end if;
  return v_new;
end;
$$;

-- Every open request of a project (after a return or transfer touched its reservations).
create or replace function inv_refresh_project_requests(p_project_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare x uuid;
begin
  for x in select id from inv_requests where project_id = p_project_id and status in ('submitted', 'in_progress', 'fulfilled') order by id loop
    perform inv_refresh_request_status(x);
  end loop;
end;
$$;

create or replace function inv_nonblank(p_text text, p_message text)
returns text
language plpgsql immutable
as $$
begin
  if length(btrim(coalesce(p_text, ''))) = 0 then raise exception '%', p_message using errcode = '22023'; end if;
  return btrim(p_text);
end;
$$;

create or replace function inv_cost_fields_present(p_obj jsonb)
returns boolean
language sql immutable
as $$
  select p_obj is not null and jsonb_typeof(p_obj) = 'object'
     and (nullif(p_obj->>'unit_cost', '') is not null or nullif(p_obj->>'currency', '') is not null or nullif(p_obj->>'purchase_date', '') is not null);
$$;

-- =============================================================================
-- Configuration
-- =============================================================================

-- Locations are configured by a founder only (nothing is seeded: Dubai, Riyadh, Poznan exist only once a founder has saved them).
create or replace function inv_save_location(
  p_company_id uuid, p_location_id uuid, p_code text, p_name text, p_timezone text,
  p_kind text default 'warehouse', p_address text default null, p_is_active boolean default true
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid := p_location_id;
  l inv_locations;
begin
  perform inv_ctx(p_company_id);
  if not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can set up or change locations' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9]{2,8}$' then raise exception 'The location code is 2 to 8 capital letters or digits' using errcode = '22023'; end if;
  if length(v_name) < 1 or length(v_name) > 80 then raise exception 'Give the location a name (up to 80 characters)' using errcode = '22023'; end if;
  if p_timezone is null or not proj_valid_timezone(p_timezone) then
    raise exception '"%" is not a time zone name such as Asia/Dubai, Asia/Riyadh or Europe/Warsaw', coalesce(p_timezone, '') using errcode = '22023';
  end if;
  if coalesce(p_kind, 'warehouse') not in ('warehouse', 'office', 'other') then raise exception 'The location kind is warehouse, office or other' using errcode = '22023'; end if;
  begin
    if v_id is null then
      insert into inv_locations (company_id, code, name, kind, timezone, address, is_active, created_by)
      values (p_company_id, v_code, v_name, coalesce(p_kind, 'warehouse'), p_timezone, nullif(btrim(p_address), ''), coalesce(p_is_active, true), auth.uid())
      returning id into v_id;
    else
      select * into l from inv_locations where id = v_id and company_id = p_company_id for update;
      if l.id is null then raise exception 'Unknown location' using errcode = '22023'; end if;
      if l.is_active and not coalesce(p_is_active, true) then
        if exists (select 1 from inv_units u where u.location_id = l.id and u.custody_kind = 'warehouse' and u.lifecycle in ('draft', 'active', 'missing'))
           or exists (select 1 from inv_balances b where b.location_id = l.id and b.holder_kind = 'warehouse' and b.qty > 0)
           or exists (select 1 from inv_transfers t where t.status = 'in_transit' and l.id in (t.from_location_id, t.to_location_id)) then
          raise exception 'This location still holds stock or has transfers on the way. Move it first, then switch the location off' using errcode = '23514';
        end if;
      end if;
      update inv_locations set code = v_code, name = v_name, kind = coalesce(p_kind, kind), timezone = p_timezone,
             address = nullif(btrim(p_address), ''), is_active = coalesce(p_is_active, true), updated_at = now()
       where id = l.id;
    end if;
  exception when unique_violation then
    raise exception 'A location with that code or name already exists' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create or replace function inv_save_bin(p_location_id uuid, p_bin_id uuid, p_code text, p_label text default null, p_is_active boolean default true)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations;
  v_code text := btrim(coalesce(p_code, ''));
  v_id uuid := p_bin_id;
  b inv_bins;
begin
  perform inv_require_user();
  select * into l from inv_locations where id = p_location_id;
  if l.id is null then raise exception 'Unknown location' using errcode = '22023'; end if;
  perform inv_require_enabled(l.company_id);
  perform inv_require_cap(l.company_id, 'manage_catalogue', 'You need catalogue rights to change bins');
  if length(v_code) < 1 or length(v_code) > 30 then raise exception 'Give the bin a code (up to 30 characters)' using errcode = '22023'; end if;
  begin
    if v_id is null then
      insert into inv_bins (company_id, location_id, code, label, is_active)
      values (l.company_id, l.id, v_code, nullif(btrim(p_label), ''), coalesce(p_is_active, true)) returning id into v_id;
    else
      select * into b from inv_bins where id = v_id and location_id = l.id for update;
      if b.id is null then raise exception 'Unknown bin' using errcode = '22023'; end if;
      if b.is_active and not coalesce(p_is_active, true) then
        if exists (select 1 from inv_units u where u.bin_id = b.id and u.custody_kind = 'warehouse' and u.lifecycle <> 'retired')
           or exists (select 1 from inv_balances x where x.bin_id = b.id and x.holder_kind = 'warehouse' and x.qty > 0) then
          raise exception 'This bin still holds stock. Move it first, then switch the bin off' using errcode = '23514';
        end if;
      end if;
      update inv_bins set code = v_code, label = nullif(btrim(p_label), ''), is_active = coalesce(p_is_active, true) where id = b.id;
    end if;
  exception when unique_violation then
    raise exception 'That location already has a bin with this code' using errcode = '23505';
  end;
  return v_id;
end;
$$;

-- Which locations a warehouse operator works at (replaces the whole list; removed locations keep their history).
create or replace function inv_set_operator_locations(p_company_id uuid, p_user_id uuid, p_location_ids uuid[])
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_location_ids, '{}'::uuid[]);
  v_loc uuid;
begin
  perform inv_ctx(p_company_id);
  perform inv_require_cap(p_company_id, 'manage_access', 'Only a founder, or someone a founder gave access management to, can assign warehouse locations');
  if not exists (select 1 from inv_company_grants g where g.user_id = p_user_id and g.company_id = p_company_id and g.revoked_at is null) then
    raise exception 'That person has no Inventory access yet. Give them access first' using errcode = '22023';
  end if;
  foreach v_loc in array v_ids loop
    if not exists (select 1 from inv_locations where id = v_loc and company_id = p_company_id) then
      raise exception 'Unknown location in the list' using errcode = '22023';
    end if;
  end loop;
  update inv_operator_locations set removed_at = now()
   where user_id = p_user_id and company_id = p_company_id and removed_at is null and not (location_id = any (v_ids));
  insert into inv_operator_locations (company_id, user_id, location_id, assigned_by)
  select p_company_id, p_user_id, x, auth.uid() from (select distinct unnest(v_ids) as x) s
   where not exists (select 1 from inv_operator_locations o where o.user_id = p_user_id and o.location_id = s.x and o.removed_at is null);
  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

create or replace function inv_save_category(p_company_id uuid, p_category_id uuid, p_name text, p_parent_id uuid default null,
                                             p_sort_order integer default 0, p_is_active boolean default true)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid := p_category_id;
  v_walk uuid;
  v_depth integer := 0;
begin
  perform inv_ctx(p_company_id);
  perform inv_require_cap(p_company_id, 'manage_catalogue', 'You need catalogue rights to change categories');
  if length(v_name) < 1 or length(v_name) > 80 then raise exception 'Give the category a name (up to 80 characters)' using errcode = '22023'; end if;
  if p_parent_id is not null then
    if not exists (select 1 from inv_categories where id = p_parent_id and company_id = p_company_id) then raise exception 'Unknown parent category' using errcode = '22023'; end if;
    v_walk := p_parent_id;
    while v_walk is not null and v_depth < 20 loop
      if v_walk = v_id then raise exception 'A category cannot sit under itself' using errcode = '22023'; end if;
      select parent_id into v_walk from inv_categories where id = v_walk;
      v_depth := v_depth + 1;
    end loop;
  end if;
  begin
    if v_id is null then
      insert into inv_categories (company_id, name, parent_id, sort_order, is_active)
      values (p_company_id, v_name, p_parent_id, coalesce(p_sort_order, 0), coalesce(p_is_active, true)) returning id into v_id;
    else
      update inv_categories set name = v_name, parent_id = p_parent_id, sort_order = coalesce(p_sort_order, 0), is_active = coalesce(p_is_active, true)
       where id = v_id and company_id = p_company_id;
      if not found then raise exception 'Unknown category' using errcode = '22023'; end if;
    end if;
  exception when unique_violation then
    raise exception 'A category with that name already exists here' using errcode = '23505';
  end;
  return v_id;
end;
$$;

-- p_fields keys: name, category_id, tracking, unit_of_measure, quantity_scale, manufacturer, model, specification, status
-- (draft / active / retired), notes, expected_version.
create or replace function inv_save_item(p_company_id uuid, p_item_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  i inv_items;
  v_id uuid := p_item_id;
  v_tracking text;
  v_scale smallint;
  v_status text;
  v_cat uuid;
begin
  perform inv_ctx(p_company_id);
  perform inv_require_cap(p_company_id, 'manage_catalogue', 'You need catalogue rights to change catalogue items');
  if jsonb_typeof(f) <> 'object' then raise exception 'The item details must be an object' using errcode = '22023'; end if;
  if f ? 'category_id' and nullif(f->>'category_id', '') is not null then
    v_cat := (f->>'category_id')::uuid;
    if not exists (select 1 from inv_categories where id = v_cat and company_id = p_company_id) then raise exception 'Unknown category' using errcode = '22023'; end if;
  end if;
  begin
    if v_id is null then
      v_tracking := f->>'tracking';
      if v_tracking is null or v_tracking not in ('individual', 'quantity', 'kit', 'consumable') then
        raise exception 'Choose how this item is tracked: individual, quantity, kit or consumable' using errcode = '22023';
      end if;
      perform inv_nonblank(f->>'name', 'Give the item a name');
      v_scale := coalesce(nullif(f->>'quantity_scale', '')::smallint, 0);
      if v_scale < 0 or v_scale > 3 then raise exception 'Decimal places can be 0 to 3' using errcode = '22023'; end if;
      if v_tracking in ('individual', 'kit') and v_scale <> 0 then raise exception 'Individual units and kits are counted in whole numbers' using errcode = '22023'; end if;
      v_status := coalesce(nullif(f->>'status', ''), 'draft');
      if v_status not in ('draft', 'active') then raise exception 'A new item starts as a draft or active' using errcode = '22023'; end if;
      insert into inv_items (company_id, name, category_id, tracking, unit_of_measure, quantity_scale, manufacturer, model, specification, status, notes, created_by)
      values (p_company_id, btrim(f->>'name'), v_cat, v_tracking, coalesce(nullif(btrim(f->>'unit_of_measure'), ''), 'each'), v_scale,
              nullif(btrim(f->>'manufacturer'), ''), nullif(btrim(f->>'model'), ''), nullif(btrim(f->>'specification'), ''), v_status,
              nullif(btrim(f->>'notes'), ''), auth.uid())
      returning id into v_id;
    else
      select * into i from inv_items where id = v_id and company_id = p_company_id for update;
      if i.id is null then raise exception 'Unknown item' using errcode = '22023'; end if;
      if f ? 'expected_version' and nullif(f->>'expected_version', '') is not null and (f->>'expected_version')::integer <> i.version then
        raise exception 'Someone else changed this item. Reload and try again' using errcode = '40001';
      end if;
      if i.status = 'retired' then raise exception 'A retired item cannot be edited' using errcode = '23514'; end if;
      v_status := coalesce(nullif(f->>'status', ''), i.status);
      if v_status not in ('draft', 'active', 'retired') then raise exception 'Unknown item status' using errcode = '22023'; end if;
      if v_status = 'draft' and i.status = 'active' and (exists (select 1 from inv_units where item_id = i.id) or exists (select 1 from inv_balances where item_id = i.id)) then
        raise exception 'An item that already has stock cannot go back to draft' using errcode = '23514';
      end if;
      if v_status = 'retired' and (exists (select 1 from inv_units u where u.item_id = i.id and u.lifecycle in ('draft', 'active', 'missing'))
                                   or exists (select 1 from inv_balances b where b.item_id = i.id and b.qty > 0)) then
        raise exception 'This item still has stock. Move it out or write it off first, or use Replace item' using errcode = '23514';
      end if;
      v_tracking := coalesce(nullif(f->>'tracking', ''), i.tracking);
      if v_tracking not in ('individual', 'quantity', 'kit', 'consumable') then raise exception 'Unknown tracking method' using errcode = '22023'; end if;
      v_scale := coalesce(nullif(f->>'quantity_scale', '')::smallint, i.quantity_scale);
      if v_scale < 0 or v_scale > 3 then raise exception 'Decimal places can be 0 to 3' using errcode = '22023'; end if;
      if v_tracking in ('individual', 'kit') and v_scale <> 0 then raise exception 'Individual units and kits are counted in whole numbers' using errcode = '22023'; end if;
      update inv_items set
        name = coalesce(nullif(btrim(f->>'name'), ''), name),
        category_id = case when f ? 'category_id' then v_cat else category_id end,
        tracking = v_tracking,
        unit_of_measure = coalesce(nullif(btrim(f->>'unit_of_measure'), ''), unit_of_measure),
        quantity_scale = v_scale,
        manufacturer = case when f ? 'manufacturer' then nullif(btrim(f->>'manufacturer'), '') else manufacturer end,
        model = case when f ? 'model' then nullif(btrim(f->>'model'), '') else model end,
        specification = case when f ? 'specification' then nullif(btrim(f->>'specification'), '') else specification end,
        notes = case when f ? 'notes' then nullif(btrim(f->>'notes'), '') else notes end,
        status = v_status, version = version + 1, updated_at = now()
       where id = i.id;
    end if;
  exception when unique_violation then
    raise exception 'An item with the same name, model and specification already exists' using errcode = '23505';
  end;
  return v_id;
end;
$$;

-- The controlled way to change what an item is once it has history: retire it, create the replacement, link them.
create or replace function inv_replace_item(p_item_id uuid, p_fields jsonb, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  i inv_items;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_new uuid;
  v_cat uuid;
begin
  perform inv_require_user();
  select * into i from inv_items where id = p_item_id for update;
  if i.id is null then raise exception 'Unknown item' using errcode = '22023'; end if;
  perform inv_require_enabled(i.company_id);
  perform inv_require_cap(i.company_id, 'manage_catalogue', 'You need catalogue rights to replace a catalogue item');
  perform inv_nonblank(p_reason, 'Say why the item is being replaced');
  if i.status = 'retired' then raise exception 'That item is already retired' using errcode = '23514'; end if;
  v_cat := coalesce(nullif(f->>'category_id', '')::uuid, i.category_id);
  if v_cat is not null and not exists (select 1 from inv_categories where id = v_cat and company_id = i.company_id) then raise exception 'Unknown category' using errcode = '22023'; end if;
  update inv_items set status = 'retired', notes = coalesce(notes || E'\n', '') || 'Replaced: ' || btrim(p_reason), version = version + 1, updated_at = now() where id = i.id;
  begin
    insert into inv_items (company_id, name, category_id, tracking, unit_of_measure, quantity_scale, manufacturer, model, specification, status, notes, created_by)
    values (i.company_id, coalesce(nullif(btrim(f->>'name'), ''), i.name), v_cat, coalesce(nullif(f->>'tracking', ''), i.tracking),
            coalesce(nullif(btrim(f->>'unit_of_measure'), ''), i.unit_of_measure), coalesce(nullif(f->>'quantity_scale', '')::smallint, i.quantity_scale),
            case when f ? 'manufacturer' then nullif(btrim(f->>'manufacturer'), '') else i.manufacturer end,
            case when f ? 'model' then nullif(btrim(f->>'model'), '') else i.model end,
            case when f ? 'specification' then nullif(btrim(f->>'specification'), '') else i.specification end,
            coalesce(nullif(f->>'status', ''), 'draft'), 'Replaces ' || i.name || ': ' || btrim(p_reason), auth.uid())
    returning id into v_new;
  exception when unique_violation then
    raise exception 'An item with the same name, model and specification already exists' using errcode = '23505';
  end;
  update inv_items set replaced_by_item_id = v_new where id = i.id;
  return v_new;
end;
$$;

-- Cross-company use: only a founder of the OWNING company can say that another company may use its equipment.
create or replace function inv_set_company_sharing(p_owner_company_id uuid, p_use_company_id uuid, p_enabled boolean, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform inv_require_user();
  if p_owner_company_id is null or p_use_company_id is null then raise exception 'Choose both companies' using errcode = '22023'; end if;
  if p_owner_company_id = p_use_company_id then raise exception 'A company does not need to authorise itself' using errcode = '22023'; end if;
  if not inv_is_founder(p_owner_company_id) then
    raise exception 'Only a founder of the company that owns the equipment can allow another company to use it' using errcode = '42501';
  end if;
  perform inv_require_enabled(p_owner_company_id);
  if not exists (select 1 from companies where id = p_use_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  if coalesce(p_enabled, true) then
    select id into v_id from inv_company_sharing where company_id = p_owner_company_id and use_company_id = p_use_company_id and revoked_at is null;
    if v_id is null then
      insert into inv_company_sharing (company_id, use_company_id, note, authorised_by) values (p_owner_company_id, p_use_company_id, nullif(btrim(p_note), ''), auth.uid())
      returning id into v_id;
    else
      update inv_company_sharing set note = coalesce(nullif(btrim(p_note), ''), note) where id = v_id;
    end if;
  else
    update inv_company_sharing set revoked_at = now(), revoked_by = auth.uid()
     where company_id = p_owner_company_id and use_company_id = p_use_company_id and revoked_at is null
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- =============================================================================
-- Units, labels
-- =============================================================================

-- Registers a physical unit (or kit) as a DRAFT: it is catalogued but claims no verified stock, is not available, and becomes real
-- only when a count or opening custody is confirmed. p_holder, for equipment that already sits with someone:
--   {"kind":"employee","employee_id":"...","expected_return_at":"..."} or {"kind":"project","project_id":"...","expected_return_at":"..."}
-- p_cost {"unit_cost":..,"currency":"AED","purchase_date":"2026-01-01"} is accepted only from someone allowed to see costs.
create or replace function inv_register_unit(
  p_company_id uuid, p_item_id uuid, p_serial_number text default null, p_location_id uuid default null, p_bin_id uuid default null,
  p_condition text default 'good', p_holder jsonb default null, p_cost jsonb default null, p_notes text default null, p_key text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  i inv_items;
  l inv_locations;
  v_serial text := nullif(btrim(coalesce(p_serial_number, '')), '');
  v_prev jsonb;
  v_unit inv_units;
  v_custody text := 'warehouse';
  v_emp uuid; v_prj uuid; v_exp timestamptz;
  e employees; pr proj_projects;
  v_existing text;
  v_result jsonb;
  v_code text;
begin
  perform inv_ctx(p_company_id);
  select * into i from inv_items where id = p_item_id;
  if i.id is null or i.company_id <> p_company_id then raise exception 'Unknown item' using errcode = '22023'; end if;
  if p_location_id is not null then
    select * into l from inv_locations where id = p_location_id;
    if l.id is null or l.company_id <> p_company_id then raise exception 'Unknown location' using errcode = '22023'; end if;
  end if;
  if not ((p_location_id is not null and inv_can_operate(p_location_id)) or inv_has_capability(p_company_id, 'manage_catalogue')) then
    raise exception 'You are not allowed to register equipment here. You need to work at this location or have catalogue rights' using errcode = '42501';
  end if;
  if i.tracking not in ('individual', 'kit') then
    raise exception '% is tracked by quantity, so it has no individual units. Receive it as stock instead', i.name using errcode = '23514';
  end if;
  if i.status = 'retired' then raise exception '% is retired and cannot get new units', i.name using errcode = '23514'; end if;
  perform inv_valid_condition(coalesce(p_condition, 'good'));
  perform inv_check_bin(p_bin_id, p_location_id);
  if p_bin_id is not null and p_location_id is null then raise exception 'A bin needs a location' using errcode = '22023'; end if;
  if p_holder is not null then
    if jsonb_typeof(p_holder) <> 'object' or coalesce(p_holder->>'kind', '') not in ('employee', 'project') then
      raise exception 'The current holder is an employee or a project' using errcode = '22023';
    end if;
    v_custody := p_holder->>'kind';
    v_exp := nullif(p_holder->>'expected_return_at', '')::timestamptz;
    if v_custody = 'employee' then
      e := inv_get_employee(nullif(p_holder->>'employee_id', '')::uuid, false);
      v_emp := e.id;
      perform inv_check_sharing(i.company_id, e.company_id);
    else
      pr := inv_get_project(nullif(p_holder->>'project_id', '')::uuid, false);
      v_prj := pr.id;
      perform inv_check_sharing(i.company_id, pr.company_id);
    end if;
    p_bin_id := null;
  elsif p_location_id is null then
    raise exception 'Choose where the equipment is kept' using errcode = '22023';
  end if;
  if p_cost is not null and jsonb_typeof(p_cost) = 'object' and p_cost <> '{}'::jsonb then
    perform inv_require_cap(p_company_id, 'view_costs', 'Only people who may see costs can enter them');
    if (nullif(p_cost->>'unit_cost', '') is null) <> (nullif(p_cost->>'currency', '') is null) then
      raise exception 'A cost needs both an amount and a currency' using errcode = '22023';
    end if;
  end if;
  if p_key is not null then
    v_prev := inv_idem_begin(p_company_id, p_key, 'register_unit', jsonb_build_object('item', p_item_id, 'serial', v_serial, 'location', p_location_id,
                'bin', p_bin_id, 'condition', coalesce(p_condition, 'good'), 'holder', p_holder, 'cost', p_cost, 'notes', p_notes));
    if v_prev is not null then return v_prev; end if;
  end if;
  if v_serial is not null then
    select code into v_existing from inv_units where item_id = i.id and lower(btrim(serial_number)) = lower(v_serial);
    if v_existing is not null then raise exception 'Serial number % is already registered as %', v_serial, v_existing using errcode = '23505'; end if;
  end if;
  v_code := inv_next_code(p_company_id, 'unit');
  insert into inv_units (company_id, item_id, code, serial_number, lifecycle, condition, custody_kind, location_id, bin_id, employee_id, project_id,
                         expected_return_at, notes, created_by)
  values (p_company_id, i.id, v_code, v_serial, 'draft', coalesce(p_condition, 'good'), v_custody, p_location_id, p_bin_id, v_emp, v_prj, v_exp,
          nullif(btrim(p_notes), ''), auth.uid())
  returning * into v_unit;
  if p_cost is not null and jsonb_typeof(p_cost) = 'object' and p_cost <> '{}'::jsonb then
    insert into inv_costs (company_id, item_id, unit_id, purchase_date, unit_cost, currency, entered_by)
    values (p_company_id, i.id, v_unit.id, nullif(p_cost->>'purchase_date', '')::date, nullif(p_cost->>'unit_cost', '')::numeric, nullif(p_cost->>'currency', ''), auth.uid());
  end if;
  v_result := jsonb_build_object('unit_id', v_unit.id, 'code', v_unit.code, 'lifecycle', v_unit.lifecycle, 'custody_kind', v_unit.custody_kind);
  if p_key is not null then
    update inv_idempotency set result = v_result where company_id = p_company_id and idem_key = btrim(p_key);
  end if;
  return v_result;
end;
$$;

-- The stable label of "this item in this bin" (quantity stock). Creates the shelf row (with zero) if needed and gives it a
-- permanent code. Asking again returns the same code.
create or replace function inv_ensure_bin_label(p_company_id uuid, p_item_id uuid, p_location_id uuid, p_bin_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  i inv_items;
  l inv_locations;
  v_bal uuid;
  v_label text;
  v_new boolean := false;
begin
  perform inv_ctx(p_company_id);
  select * into i from inv_items where id = p_item_id;
  if i.id is null or i.company_id <> p_company_id then raise exception 'Unknown item' using errcode = '22023'; end if;
  select * into l from inv_locations where id = p_location_id;
  if l.id is null or l.company_id <> p_company_id then raise exception 'Unknown location' using errcode = '22023'; end if;
  if not (inv_can_operate(l.id) or inv_has_capability(p_company_id, 'manage_catalogue')) then
    raise exception 'You are not allowed to create labels here' using errcode = '42501';
  end if;
  if i.tracking not in ('quantity', 'consumable') then raise exception 'Labels for bins are for quantity stock. Individual equipment has its own code' using errcode = '23514'; end if;
  if i.status = 'retired' then raise exception '% is retired', i.name using errcode = '23514'; end if;
  perform inv_check_bin(p_bin_id, l.id);
  perform inv_lock_item(i.id);
  v_bal := inv_bal_ensure(p_company_id, i.id, 'warehouse', 'good', l.id, p_bin_id);
  select label_code into v_label from inv_balances where id = v_bal;
  if v_label is null then
    v_label := inv_next_code(p_company_id, 'stock');
    update inv_balances set label_code = v_label where id = v_bal;
    insert into inv_label_prints (company_id, balance_id, reason, printed_by) values (p_company_id, v_bal, 'first', auth.uid());
    v_new := true;
  end if;
  return jsonb_build_object('balance_id', v_bal, 'label_code', v_label, 'created', v_new);
end;
$$;

-- Printing (or reprinting) a label never creates equipment; it only writes history. The first print of a code is 'first', later ones 'reprint'.
create or replace function inv_record_label_print(p_company_id uuid, p_unit_id uuid default null, p_balance_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  u inv_units; b inv_balances; v_loc uuid; v_id uuid; v_reason text;
begin
  perform inv_ctx(p_company_id);
  if (p_unit_id is null) = (p_balance_id is null) then raise exception 'Name either a unit or a stock label' using errcode = '22023'; end if;
  if p_unit_id is not null then
    select * into u from inv_units where id = p_unit_id;
    if u.id is null or u.company_id <> p_company_id then raise exception 'Unknown equipment' using errcode = '22023'; end if;
    v_loc := u.location_id;
  else
    select * into b from inv_balances where id = p_balance_id;
    if b.id is null or b.company_id <> p_company_id or b.label_code is null then raise exception 'Unknown stock label' using errcode = '22023'; end if;
    v_loc := b.location_id;
  end if;
  if not ((v_loc is not null and inv_can_operate(v_loc)) or inv_has_capability(p_company_id, 'manage_catalogue')) then
    raise exception 'You are not allowed to print labels for this' using errcode = '42501';
  end if;
  v_reason := case when exists (select 1 from inv_label_prints x where (p_unit_id is not null and x.unit_id = p_unit_id) or (p_balance_id is not null and x.balance_id = p_balance_id))
                   then 'reprint' else 'first' end;
  insert into inv_label_prints (company_id, unit_id, balance_id, reason, printed_by) values (p_company_id, p_unit_id, p_balance_id, v_reason, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

-- =============================================================================
-- Counts: opening stock and cycle counts
-- =============================================================================
create or replace function inv_start_count(p_company_id uuid, p_location_id uuid, p_kind text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid; v_code text; l inv_locations;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  if p_kind is null or p_kind not in ('opening', 'cycle') then raise exception 'A count is either an opening count or a cycle count' using errcode = '22023'; end if;
  v_code := inv_next_code(p_company_id, 'count');
  insert into inv_counts (company_id, code, kind, location_id, note, started_by) values (p_company_id, v_code, p_kind, l.id, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('count_id', v_id, 'code', v_code, 'kind', p_kind, 'location_id', l.id);
end;
$$;

-- One counted line. Individual units: p_unit_id and a count of 1 (opening) or 1 / 0 (cycle: present / not found).
-- Quantities: p_item_id, p_bin_id, p_condition and the counted quantity. Saving the same subject again replaces the line.
create or replace function inv_save_count_line(
  p_count_id uuid, p_counted_qty numeric, p_unit_id uuid default null, p_item_id uuid default null, p_bin_id uuid default null,
  p_condition text default null, p_reason text default null, p_note text default null, p_balance_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  c inv_counts;
  u inv_units;
  i inv_items;
  b inv_balances;
  v_item uuid := p_item_id;
  v_cond text;
  v_bin uuid := p_bin_id;
  v_expected numeric;
  v_other text;
  v_line uuid;
begin
  perform inv_require_user();
  select * into c from inv_counts where id = p_count_id;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform inv_ctx(c.company_id);
  perform inv_loc(c.company_id, c.location_id);
  if p_counted_qty is null or p_counted_qty < 0 then raise exception 'The counted quantity cannot be negative' using errcode = '22023'; end if;
  if p_unit_id is not null then
    select u2.item_id into v_item from inv_units u2 where u2.id = p_unit_id;
    if v_item is null then raise exception 'Unknown equipment' using errcode = '22023'; end if;
  end if;
  if v_item is null then raise exception 'Say which item or unit was counted' using errcode = '22023'; end if;
  perform inv_lock_item(v_item);
  select * into c from inv_counts where id = p_count_id for update;
  if c.status <> 'open' then raise exception 'This count is already % and can no longer be changed', c.status using errcode = '23514'; end if;
  select * into i from inv_items where id = v_item;
  if i.company_id <> c.company_id then raise exception 'That item belongs to another company' using errcode = '23514'; end if;
  if i.status = 'draft' and c.kind = 'opening' then raise exception '% is still a draft catalogue item. Activate it before counting stock', i.name using errcode = '23514'; end if;
  if i.status = 'retired' then raise exception '% is retired', i.name using errcode = '23514'; end if;

  if p_unit_id is not null then
    u := inv_unit_lock(p_unit_id);
    if u.company_id <> c.company_id then raise exception 'That equipment belongs to another company' using errcode = '23514'; end if;
    if u.lifecycle = 'retired' then raise exception '% is retired', u.code using errcode = '23514'; end if;
    if c.kind = 'opening' then
      if u.verified_at is not null then
        raise exception '% has already been counted and verified. It cannot be opened again; use a cycle count to re-check it', u.code using errcode = '23514';
      end if;
      if u.lifecycle <> 'draft' then raise exception '% is not waiting for an opening count', u.code using errcode = '23514'; end if;
      if u.custody_kind <> 'warehouse' then
        raise exception '% is recorded as % already. Confirm it as opening custody instead of counting it at the warehouse, so it is never counted twice',
          u.code, inv_custody_words(u.custody_kind) using errcode = '23514';
      end if;
      if p_counted_qty <> 1 then raise exception 'A single unit is counted as 1' using errcode = '22023'; end if;
    else
      if u.lifecycle = 'draft' then raise exception '% has not been opened yet. Count it in an opening count first', u.code using errcode = '23514'; end if;
      if p_counted_qty not in (0, 1) then raise exception 'A single unit is counted as 1 (found) or 0 (not found)' using errcode = '22023'; end if;
      if u.lifecycle = 'active' and (u.custody_kind <> 'warehouse' or u.location_id <> c.location_id) then
        raise exception '% is not on the shelf at this location (it is %), so it cannot be counted here', u.code, inv_custody_words(u.custody_kind) using errcode = '23514';
      end if;
    end if;
    if u.location_id is distinct from c.location_id and u.lifecycle = 'draft' then
      raise exception '% is registered at a different location', u.code using errcode = '23514';
    end if;
    select c2.code into v_other from inv_count_lines cl join inv_counts c2 on c2.id = cl.count_id
     where cl.unit_id = u.id and c2.status = 'open' and c2.id <> c.id limit 1;
    if v_other is not null then raise exception '% is already on the open count % . Finish or cancel that count first', u.code, v_other using errcode = '23514'; end if;
    v_cond := inv_valid_condition(coalesce(p_condition, u.condition));
    v_bin := coalesce(p_bin_id, u.bin_id);
    perform inv_check_bin(v_bin, c.location_id);
    v_expected := case when u.lifecycle = 'active' and u.custody_kind = 'warehouse' then 1 else 0 end;
    select id into v_line from inv_count_lines where count_id = c.id and unit_id = u.id;
    if v_line is null then
      insert into inv_count_lines (count_id, company_id, item_id, unit_id, bin_id, condition, expected_qty, counted_qty, reason, note)
      values (c.id, c.company_id, i.id, u.id, v_bin, v_cond, v_expected, p_counted_qty, nullif(btrim(p_reason), ''), nullif(btrim(p_note), '')) returning id into v_line;
    else
      update inv_count_lines set bin_id = v_bin, condition = v_cond, expected_qty = v_expected, counted_qty = p_counted_qty,
             reason = nullif(btrim(p_reason), ''), note = nullif(btrim(p_note), '') where id = v_line;
    end if;
    return v_line;
  end if;

  -- quantity line
  if i.tracking not in ('quantity', 'consumable') then
    raise exception '% is counted unit by unit. Count each unit instead', i.name using errcode = '23514';
  end if;
  if p_counted_qty <> round(p_counted_qty, i.quantity_scale) then
    raise exception 'The quantity of % can have at most % decimal place(s)', i.name, i.quantity_scale using errcode = '22023';
  end if;
  if c.kind = 'opening' and p_counted_qty = 0 then raise exception 'An opening count needs a quantity above zero' using errcode = '22023'; end if;
  if p_balance_id is not null then
    select * into b from inv_balances where id = p_balance_id for update;
    if b.id is null or b.item_id <> i.id or b.holder_kind <> 'warehouse' or b.location_id <> c.location_id then
      raise exception 'That stock row is not this item on the shelf at this location' using errcode = '22023';
    end if;
    v_bin := b.bin_id; v_cond := b.condition;
  else
    v_cond := inv_valid_condition(coalesce(p_condition, 'good'), true);
    perform inv_check_bin(v_bin, c.location_id);
    select * into b from inv_balances x where x.company_id = c.company_id and x.item_id = i.id and x.holder_kind = 'warehouse' and x.location_id = c.location_id
       and x.bin_id is not distinct from v_bin and x.condition = v_cond and x.rental_id is null;
  end if;
  if c.kind = 'opening' then
    if b.id is not null and b.verified_at is not null then
      raise exception '% already has verified stock in this place. An opening count cannot be repeated; use a cycle count to change it', i.name using errcode = '23514';
    end if;
  end if;
  select c2.code into v_other from inv_count_lines cl join inv_counts c2 on c2.id = cl.count_id
   where cl.unit_id is null and cl.item_id = i.id and c2.location_id = c.location_id and c2.status = 'open' and c2.id <> c.id
     and cl.bin_id is not distinct from v_bin and cl.condition is not distinct from v_cond and cl.balance_id is not distinct from b.id limit 1;
  if v_other is not null then raise exception '% in this place is already on the open count %. Finish or cancel that count first', i.name, v_other using errcode = '23514'; end if;
  v_expected := coalesce(b.qty, 0);
  select id into v_line from inv_count_lines where count_id = c.id and unit_id is null and item_id = i.id
     and bin_id is not distinct from v_bin and condition is not distinct from v_cond and balance_id is not distinct from b.id;
  if v_line is null then
    insert into inv_count_lines (count_id, company_id, item_id, balance_id, bin_id, condition, expected_qty, counted_qty, reason, note)
    values (c.id, c.company_id, i.id, b.id, v_bin, v_cond, v_expected, p_counted_qty, nullif(btrim(p_reason), ''), nullif(btrim(p_note), '')) returning id into v_line;
  else
    update inv_count_lines set expected_qty = v_expected, counted_qty = p_counted_qty, reason = nullif(btrim(p_reason), ''), note = nullif(btrim(p_note), '') where id = v_line;
  end if;
  return v_line;
end;
$$;

-- Confirming turns the count into ledger movements: opening -> 'opening' movements (stock becomes real, verified who/when);
-- cycle -> 'count_adjust' movements for the differences, each needing a reason.
create or replace function inv_confirm_count(p_company_id uuid, p_count_id uuid, p_key text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  c inv_counts;
  h jsonb;
  v_mid uuid;
  r record;
  u inv_units;
  i inv_items;
  v_bal uuid;
  v_have numeric;
  v_diff numeric;
  v_units integer := 0; v_qty integer := 0; v_adj integer := 0;
  v_cond text;
begin
  perform inv_ctx(p_company_id);
  perform inv_require_cap(p_company_id, 'confirm_stock', 'Only a founder, or someone allowed to confirm stock, can confirm a count');
  select * into c from inv_counts where id = p_count_id and company_id = p_company_id;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  h := inv_begin_movement(p_company_id, case c.kind when 'opening' then 'opening' else 'count_adjust' end, p_key,
         jsonb_build_object('count', p_count_id, 'note', p_note), jsonb_build_object('to_location_id', c.location_id, 'note', coalesce(p_note, 'Count ' || c.code)));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  select * into c from inv_counts where id = p_count_id for update;
  if c.status <> 'open' then raise exception 'This count is already %', c.status using errcode = '23514'; end if;
  perform inv_lock_lines(coalesce((select jsonb_agg(jsonb_build_object('item_id', cl.item_id)) from inv_count_lines cl where cl.count_id = c.id), '[]'::jsonb));

  for r in select cl.* from inv_count_lines cl where cl.count_id = c.id order by cl.id loop
    select * into i from inv_items where id = r.item_id;
    if r.unit_id is not null then
      u := inv_unit_lock(r.unit_id);
      if c.kind = 'opening' then
        if u.lifecycle <> 'draft' or u.verified_at is not null or u.custody_kind <> 'warehouse' or u.location_id is distinct from c.location_id then
          raise exception '% changed since it was counted. Remove it from the count and check it again', u.code using errcode = '23514';
        end if;
        if i.status <> 'active' then raise exception '% is still a draft catalogue item. Activate it first', i.name using errcode = '23514'; end if;
        update inv_units set lifecycle = 'active', condition = coalesce(r.condition, condition), bin_id = coalesce(r.bin_id, bin_id), verified_at = now(),
               verified_by = auth.uid(), version = version + 1 where id = u.id;
        perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'external', 'warehouse', null, c.location_id, null, coalesce(r.bin_id, u.bin_id), null, null, null, null,
                       null, null, null, coalesce(r.condition, u.condition), r.note);
        v_units := v_units + 1;
      else
        if r.counted_qty = 1 and u.lifecycle = 'missing' then
          perform inv_nonblank(r.reason, 'Say why ' || u.code || ' is found again (give a reason on that count line)');
          perform inv_unit_move(u.id, 'warehouse', c.location_id, r.bin_id, null, null, null, null, null, null, null);
          update inv_units set lifecycle = 'active' where id = u.id;
          perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'adjustment', 'warehouse', null, c.location_id, null, r.bin_id, null, null, null, null, null, null, null, u.condition, r.reason);
          v_adj := v_adj + 1;
        elsif r.counted_qty = 0 and u.lifecycle = 'active' then
          if u.custody_kind <> 'warehouse' or u.location_id <> c.location_id then
            raise exception '% moved since it was counted. Check it again', u.code using errcode = '23514';
          end if;
          perform inv_nonblank(r.reason, 'Say why ' || u.code || ' was not found (give a reason on that count line)');
          update inv_units set lifecycle = 'missing', version = version + 1 where id = u.id;
          perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'warehouse', 'adjustment', c.location_id, null, u.bin_id, null, null, null, null, null, null, null, u.condition, null, r.reason);
          v_adj := v_adj + 1;
        end if;
        v_units := v_units + 1;
      end if;
    else
      if c.kind = 'opening' then
        if i.status <> 'active' then raise exception '% is still a draft catalogue item. Activate it first', i.name using errcode = '23514'; end if;
        v_bal := inv_bal_ensure(p_company_id, i.id, 'warehouse', coalesce(r.condition, 'good'), c.location_id, r.bin_id);
        if exists (select 1 from inv_balances where id = v_bal and verified_at is not null) then
          raise exception '% already has verified stock in this place. Check the count again', i.name using errcode = '23514';
        end if;
        perform inv_bal_change(v_bal, r.counted_qty);
        perform inv_ml(v_mid, p_company_id, i.id, null, r.counted_qty, 'external', 'warehouse', null, c.location_id, null, r.bin_id, null, null, null, null, null, v_bal, null, coalesce(r.condition, 'good'), r.note);
        v_qty := v_qty + 1;
      else
        v_bal := coalesce(r.balance_id, inv_bal_ensure(p_company_id, i.id, 'warehouse', coalesce(r.condition, 'good'), c.location_id, r.bin_id));
        select qty, condition into v_have, v_cond from inv_balances where id = v_bal for update;
        v_diff := r.counted_qty - v_have;
        update inv_count_lines set expected_qty = v_have where id = r.id;
        if v_diff <> 0 then
          perform inv_nonblank(r.reason, 'Say why the count of ' || i.name || ' differs from the system (give a reason on that count line)');
          if v_diff > 0 then
            perform inv_bal_change(v_bal, v_diff);
            perform inv_ml(v_mid, p_company_id, i.id, null, v_diff, 'adjustment', 'warehouse', null, c.location_id, null, r.bin_id, null, null, null, null, null, v_bal, null, v_cond, r.reason);
          else
            perform inv_bal_change(v_bal, v_diff);
            perform inv_ml(v_mid, p_company_id, i.id, null, -v_diff, 'warehouse', 'adjustment', c.location_id, null, r.bin_id, null, null, null, null, null, v_bal, null, v_cond, null, r.reason);
          end if;
          v_adj := v_adj + 1;
        end if;
        v_qty := v_qty + 1;
      end if;
    end if;
  end loop;
  update inv_counts set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), note = coalesce(nullif(btrim(p_note), ''), note) where id = c.id;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('count_id', c.id, 'count_code', c.code, 'count_kind', c.kind,
           'units', v_units, 'quantity_lines', v_qty, 'adjustments', v_adj));
end;
$$;

create or replace function inv_cancel_count(p_company_id uuid, p_count_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare c inv_counts;
begin
  perform inv_ctx(p_company_id);
  select * into c from inv_counts where id = p_count_id and company_id = p_company_id for update;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  if not (inv_can_operate(c.location_id) or inv_has_capability(p_company_id, 'confirm_stock')) then
    raise exception 'You are not allowed to cancel this count' using errcode = '42501';
  end if;
  perform inv_nonblank(p_reason, 'Say why the count is cancelled');
  if c.status <> 'open' then raise exception 'This count is already %', c.status using errcode = '23514'; end if;
  update inv_counts set status = 'cancelled', note = coalesce(note || E'\n', '') || 'Cancelled: ' || btrim(p_reason) where id = c.id;
end;
$$;

-- Equipment and quantities that are ALREADY with an employee or on a project when Inventory starts. They are confirmed once, as
-- opening custody, and are never part of a warehouse count, so nothing is counted twice.
--   {"unit_id": "..."}                         a unit registered with that holder (draft)
--   {"item_id","qty","employee_id"|"project_id","condition"?,"expected_return_at"?,"location_id"?}   a quantity
create or replace function inv_confirm_opening_custody(p_company_id uuid, p_key text, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; emp employees; pr proj_projects;
  v_bal uuid; v_exp timestamptz; v_qty numeric; v_cond text; v_units integer := 0; v_lines integer := 0;
  v_seen uuid[] := '{}';
  v_unit_id uuid;
begin
  perform inv_ctx(p_company_id);
  perform inv_require_cap(p_company_id, 'confirm_stock', 'Only a founder, or someone allowed to confirm stock, can confirm opening custody');
  perform inv_lines_array(p_lines);
  h := inv_begin_movement(p_company_id, 'opening', p_key, jsonb_build_object('lines', p_lines, 'note', p_note, 'custody', true), jsonb_build_object('note', coalesce(p_note, 'Opening custody')));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    if nullif(e->>'unit_id', '') is not null then
      v_unit_id := (e->>'unit_id')::uuid;
      if v_unit_id = any (v_seen) then raise exception 'The same unit is listed twice' using errcode = '22023'; end if;
      v_seen := v_seen || v_unit_id;
      u := inv_unit_lock(v_unit_id);
      if u.company_id <> p_company_id then raise exception 'That equipment belongs to another company' using errcode = '23514'; end if;
      select * into i from inv_items where id = u.item_id;
      if u.verified_at is not null or u.lifecycle <> 'draft' then
        raise exception '% has already been counted and verified. Opening custody can only be confirmed once', u.code using errcode = '23514';
      end if;
      if u.custody_kind not in ('employee', 'project') then
        raise exception '% is recorded on the shelf, so it is counted in an opening count, not as opening custody', u.code using errcode = '23514';
      end if;
      if i.status <> 'active' then raise exception '% is still a draft catalogue item. Activate it first', i.name using errcode = '23514'; end if;
      if u.custody_kind = 'employee' then
        emp := inv_get_employee(u.employee_id, false);
        perform inv_check_sharing(i.company_id, emp.company_id);
      else
        pr := inv_get_project(u.project_id, true);
        perform inv_check_sharing(i.company_id, pr.company_id);
      end if;
      v_exp := coalesce(nullif(e->>'expected_return_at', '')::timestamptz, u.expected_return_at);
      update inv_units set lifecycle = 'active', verified_at = now(), verified_by = auth.uid(), expected_return_at = v_exp, version = version + 1 where id = u.id;
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'external', u.custody_kind, u.location_id, null, null, null, null, u.employee_id, null, u.project_id,
                     null, null, null, u.condition, e->>'note');
      if u.custody_kind = 'employee' then perform inv_mirror_legacy(u.id); end if;
      v_units := v_units + 1;
    else
      select * into i from inv_items where id = nullif(e->>'item_id', '')::uuid;
      if i.id is null then raise exception 'Unknown item' using errcode = '22023'; end if;
      if i.company_id <> p_company_id then raise exception 'That item belongs to another company' using errcode = '23514'; end if;
      if i.tracking <> 'quantity' then raise exception '% is not held by quantity with people. Register the individual units instead', i.name using errcode = '23514'; end if;
      if i.status <> 'active' then raise exception '% is still a draft catalogue item. Activate it first', i.name using errcode = '23514'; end if;
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_cond := inv_valid_condition(coalesce(e->>'condition', 'good'), true);
      v_exp := nullif(e->>'expected_return_at', '')::timestamptz;
      if (nullif(e->>'employee_id', '') is null) = (nullif(e->>'project_id', '') is null) then
        raise exception 'Name either the employee or the project that holds % ', i.name using errcode = '22023';
      end if;
      if nullif(e->>'employee_id', '') is not null then
        emp := inv_get_employee((e->>'employee_id')::uuid, false);
        perform inv_check_sharing(i.company_id, emp.company_id);
        v_bal := inv_bal_ensure(p_company_id, i.id, 'employee', v_cond, p_employee => emp.id, p_expected => v_exp);
        perform inv_bal_change(v_bal, v_qty, v_exp);
        perform inv_ml(v_mid, p_company_id, i.id, null, v_qty, 'external', 'employee', nullif(e->>'location_id', '')::uuid, null, null, null, null, emp.id, null, null, null, v_bal, null, v_cond, e->>'note');
      else
        pr := inv_get_project((e->>'project_id')::uuid, true);
        perform inv_check_sharing(i.company_id, pr.company_id);
        v_bal := inv_bal_ensure(p_company_id, i.id, 'project', v_cond, p_project => pr.id, p_expected => v_exp);
        perform inv_bal_change(v_bal, v_qty, v_exp);
        perform inv_ml(v_mid, p_company_id, i.id, null, v_qty, 'external', 'project', nullif(e->>'location_id', '')::uuid, null, null, null, null, null, null, pr.id, null, v_bal, null, v_cond, e->>'note');
      end if;
      v_lines := v_lines + 1;
    end if;
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('units', v_units, 'quantity_lines', v_lines));
end;
$$;

-- =============================================================================
-- Movements. Every one: signed in -> company enabled -> may work at the location -> idempotency + header -> item locks (in order) ->
-- lines -> result stored against the key. All in one transaction, so stock and ledger can never disagree.
-- =============================================================================

-- Receipt of purchased stock (kind 'receipt') or of rented stock (kind 'rental_receipt', when p_rental is given).
--   p_lines: [{"item_id","qty","serials":["..."],"bin_id","condition","unit_cost","currency","purchase_date"}]
--   p_rental: {"supplier_name","external_reference","return_deadline","project_id","note"}
-- Rented stock becomes rental-owned units or balances and never adds to owned quantities. Costs only from someone who may see costs.
create or replace function inv_receive_stock(p_company_id uuid, p_location_id uuid, p_key text, p_lines jsonb, p_rental jsonb default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; h jsonb; v_mid uuid; e jsonb; i inv_items; v_rental inv_rentals; v_is_rental boolean := p_rental is not null;
  v_has_cost boolean := false; v_n integer; v_k integer; v_qty numeric; v_cond text; v_bin uuid; v_serials jsonb; v_serial text;
  v_unit inv_units; v_bal uuid; v_after numeric; v_out jsonb := '[]'::jsonb; v_existing text; v_proj uuid; v_deadline timestamptz;
  v_supplier text; v_ref text;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    if inv_cost_fields_present(e) then
      v_has_cost := true;
      if (nullif(e->>'unit_cost', '') is null) <> (nullif(e->>'currency', '') is null) then raise exception 'A cost needs both an amount and a currency' using errcode = '22023'; end if;
    end if;
  end loop;
  if v_has_cost then perform inv_require_cap(p_company_id, 'view_costs', 'Only people who may see costs can enter them'); end if;
  if v_is_rental then
    if jsonb_typeof(p_rental) <> 'object' then raise exception 'The rental details must be an object' using errcode = '22023'; end if;
    v_supplier := inv_nonblank(p_rental->>'supplier_name', 'Name the rental supplier');
    v_ref := inv_nonblank(p_rental->>'external_reference', 'Give the supplier''s reference for this rental');
    v_deadline := nullif(p_rental->>'return_deadline', '')::timestamptz;
    v_proj := nullif(p_rental->>'project_id', '')::uuid;
    if v_proj is not null and not exists (select 1 from proj_projects where id = v_proj) then raise exception 'Unknown project' using errcode = '22023'; end if;
  end if;
  h := inv_begin_movement(p_company_id, case when v_is_rental then 'rental_receipt' else 'receipt' end, p_key,
         jsonb_build_object('location', p_location_id, 'lines', p_lines, 'rental', p_rental, 'note', p_note),
         jsonb_build_object('to_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);

  if v_is_rental then
    select * into v_rental from inv_rentals where company_id = p_company_id and lower(btrim(external_reference)) = lower(v_ref) for update;
    if v_rental.id is not null then
      if v_rental.status <> 'open' or lower(btrim(v_rental.supplier_name)) <> lower(v_supplier) then
        raise exception 'The reference % is already used by another or an already returned rental', v_ref using errcode = '23505';
      end if;
    else
      if v_deadline is null or v_deadline <= now() then raise exception 'Give a return deadline in the future for the rental' using errcode = '22023'; end if;
      insert into inv_rentals (company_id, supplier_name, external_reference, return_deadline, project_id, note, created_by)
      values (p_company_id, v_supplier, v_ref, v_deadline, v_proj, nullif(btrim(p_rental->>'note'), ''), auth.uid()) returning * into v_rental;
    end if;
  end if;

  for e in select x from jsonb_array_elements(p_lines) x loop
    i := inv_get_item(nullif(e->>'item_id', '')::uuid);
    if i.company_id <> p_company_id then raise exception '% belongs to another company and cannot be received here', i.name using errcode = '23514'; end if;
    if i.status = 'draft' then raise exception '% is still a draft catalogue item. Activate it before receiving stock', i.name using errcode = '23514'; end if;
    if i.status = 'retired' then raise exception '% is retired and cannot be received', i.name using errcode = '23514'; end if;
    v_bin := nullif(e->>'bin_id', '')::uuid;
    perform inv_check_bin(v_bin, l.id);
    if i.tracking in ('individual', 'kit') then
      v_serials := e->'serials';
      if v_serials is not null and jsonb_typeof(v_serials) <> 'array' then raise exception 'Serial numbers are a list' using errcode = '22023'; end if;
      v_qty := coalesce(nullif(e->>'qty', '')::numeric, jsonb_array_length(v_serials)::numeric, 1);
      if v_qty < 1 or v_qty <> trunc(v_qty) then raise exception 'Individually tracked equipment is received in whole units' using errcode = '22023'; end if;
      if v_qty > 200 then raise exception 'Receive at most 200 units of one item at a time' using errcode = '22023'; end if;
      v_n := v_qty::integer;
      if v_serials is not null and jsonb_array_length(v_serials) <> v_n then raise exception 'Give a serial number for every unit, or none' using errcode = '22023'; end if;
      v_cond := inv_valid_condition(coalesce(e->>'condition', 'good'));
      for v_k in 1..v_n loop
        v_serial := case when v_serials is null then null else nullif(btrim(v_serials->>(v_k - 1)), '') end;
        if v_serial is not null then
          select code into v_existing from inv_units where item_id = i.id and lower(btrim(serial_number)) = lower(v_serial);
          if v_existing is not null then raise exception 'Serial number % is already registered as %', v_serial, v_existing using errcode = '23505'; end if;
        end if;
        insert into inv_units (company_id, item_id, code, serial_number, ownership, rental_id, lifecycle, condition, custody_kind, location_id, bin_id,
                               verified_at, verified_by, created_by)
        values (p_company_id, i.id, inv_next_code(p_company_id, 'unit'), v_serial, case when v_is_rental then 'rental' else 'owned' end, v_rental.id,
                'active', v_cond, 'warehouse', l.id, v_bin, now(), auth.uid(), auth.uid())
        returning * into v_unit;
        perform inv_ml(v_mid, p_company_id, i.id, v_unit.id, 1, 'external', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_cond_to => v_cond);
        if inv_cost_fields_present(e) then
          insert into inv_costs (company_id, item_id, unit_id, movement_id, purchase_date, unit_cost, currency, entered_by)
          values (p_company_id, i.id, v_unit.id, v_mid, nullif(e->>'purchase_date', '')::date, nullif(e->>'unit_cost', '')::numeric, nullif(e->>'currency', ''), auth.uid());
        end if;
        v_out := v_out || jsonb_build_object('item_id', i.id, 'unit_id', v_unit.id, 'code', v_unit.code, 'condition', v_cond);
      end loop;
    else
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_cond := inv_valid_condition(coalesce(e->>'condition', 'good'), true);
      v_bal := inv_bal_ensure(p_company_id, i.id, 'warehouse', v_cond, l.id, v_bin, p_rental => v_rental.id);
      v_after := inv_bal_change(v_bal, v_qty);
      perform inv_ml(v_mid, p_company_id, i.id, null, v_qty, 'external', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_to_bal => v_bal, p_cond_to => v_cond);
      if inv_cost_fields_present(e) then
        insert into inv_costs (company_id, item_id, movement_id, purchase_date, unit_cost, currency, entered_by)
        values (p_company_id, i.id, v_mid, nullif(e->>'purchase_date', '')::date, nullif(e->>'unit_cost', '')::numeric, nullif(e->>'currency', ''), auth.uid());
      end if;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'balance_id', v_bal, 'qty', v_qty, 'qty_after', v_after, 'condition', v_cond);
    end if;
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('location_id', l.id, 'rental_id', v_rental.id, 'lines', v_out));
end;
$$;

-- Issue equipment or quantities to an employee. Lines: {"unit_id"} or {"item_id","qty","bin_id","rental_id"}.
-- Consumables are not issued: they are consumed (inv_consume).
create or replace function inv_issue_to_employee(p_company_id uuid, p_location_id uuid, p_employee_id uuid, p_key text, p_lines jsonb,
                                                 p_expected_return_at timestamptz default null, p_note text default null, p_request_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; emp employees; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record; q inv_requests;
  v_seen uuid[] := '{}'; v_why text; v_res text; v_qty numeric; v_rental uuid; v_free numeric; v_dest uuid; v_out jsonb := '[]'::jsonb;
  v_asked numeric; v_issued numeric;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  emp := inv_get_employee(p_employee_id, true);
  if p_request_id is not null then
    select * into q from inv_requests where id = p_request_id;
    if q.id is null or q.company_id <> p_company_id then raise exception 'Unknown request' using errcode = '22023'; end if;
    if q.kind <> 'employee' or q.employee_id is distinct from emp.id then raise exception 'That request is not for this employee' using errcode = '23514'; end if;
    if q.status not in ('submitted', 'in_progress') then raise exception 'Request % is % and cannot be issued against', q.code, q.status using errcode = '23514'; end if;
  end if;
  if p_expected_return_at is not null and p_expected_return_at <= now() then raise exception 'The expected return date must be in the future' using errcode = '22023'; end if;
  h := inv_begin_movement(p_company_id, 'issue_employee', p_key,
         jsonb_build_object('location', p_location_id, 'employee', p_employee_id, 'lines', p_lines, 'expected', p_expected_return_at, 'note', p_note, 'request', p_request_id),
         jsonb_build_object('employee_id', emp.id, 'recipient_employee_id', emp.id, 'from_location_id', l.id, 'expected_return_at', p_expected_return_at, 'note', p_note,
                            'request_id', p_request_id));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      i := inv_get_item(u.item_id);
      perform inv_check_sharing(i.company_id, l.company_id);
      perform inv_check_sharing(i.company_id, emp.company_id);
      if q.id is not null then
        select coalesce(sum(rl.qty), 0) into v_asked from inv_request_lines rl where rl.request_id = q.id and rl.status <> 'cancelled' and inv_effective_item(rl) = u.item_id;
        select coalesce(sum(ml.qty), 0) into v_issued from inv_movement_lines ml join inv_movements m on m.id = ml.movement_id
         where m.request_id = q.id and m.kind = 'issue_employee' and ml.item_id = u.item_id;
        if v_asked = 0 then raise exception '% is not on request %', i.name, q.code using errcode = '23514'; end if;
        if v_issued + 1 > v_asked then raise exception 'Request % asks for % of % and they have all been issued', q.code, trim_scale(v_asked), i.name using errcode = '23514'; end if;
      end if;
      v_why := inv_unit_block_reason(u, l.id);
      if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
      v_res := inv_unit_reserved_by(u.id, now(), p_expected_return_at);
      if v_res is not null then raise exception '% is reserved for % and cannot be issued to a person for that period', u.code, v_res using errcode = '23514'; end if;
      perform inv_unit_move(u.id, 'employee', p_employee => emp.id, p_expected => p_expected_return_at);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'warehouse', 'employee', p_from_loc => l.id, p_from_bin => u.bin_id, p_to_emp => emp.id,
                     p_cond_from => u.condition, p_cond_to => u.condition);
      perform inv_mirror_legacy(u.id);
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code);
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      if i.tracking = 'consumable' then raise exception '% is a consumable. Record its use with Consume, not Issue', i.name using errcode = '23514'; end if;
      if i.tracking <> 'quantity' then raise exception '% is tracked unit by unit. Name the unit to issue', i.name using errcode = '23514'; end if;
      perform inv_check_sharing(i.company_id, l.company_id);
      perform inv_check_sharing(i.company_id, emp.company_id);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      if q.id is not null then
        select coalesce(sum(rl.qty), 0) into v_asked from inv_request_lines rl where rl.request_id = q.id and rl.status <> 'cancelled' and inv_effective_item(rl) = i.id;
        select coalesce(sum(ml.qty), 0) into v_issued from inv_movement_lines ml join inv_movements m on m.id = ml.movement_id
         where m.request_id = q.id and m.kind = 'issue_employee' and ml.item_id = i.id;
        if v_asked = 0 then raise exception '% is not on request %', i.name, q.code using errcode = '23514'; end if;
        if v_issued + v_qty > v_asked then raise exception 'Request % asks for % of %; % have already been issued', q.code, trim_scale(v_asked), i.name, trim_scale(v_issued) using errcode = '23514'; end if;
      end if;
      v_free := inv_qty_free(i.id, l.id, now(), p_expected_return_at, null, v_rental is not null);
      if v_qty > v_free then
        raise exception 'Only % of % can be issued now: the rest is not on the shelf or is reserved for upcoming requests', trim_scale(v_free), i.name using errcode = '23514';
      end if;
      for t in select * from inv_take_qty(i.id, v_qty, 'warehouse', l.id, nullif(e->>'bin_id', '')::uuid, p_condition => 'good', p_rental => v_rental,
                                           p_rentals => case when v_rental is null then 'owned' else 'only' end, p_where => 'on the shelf here') loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'employee', 'good', p_employee => emp.id, p_rental => t.rental_id, p_expected => p_expected_return_at);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken, p_expected_return_at);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'warehouse', 'employee', p_from_loc => l.id, p_from_bin => t.bin_id, p_to_emp => emp.id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => 'good', p_cond_to => 'good');
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty);
    end if;
  end loop;
  if q.id is not null then perform inv_refresh_request_status(q.id); end if;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('employee_id', emp.id, 'request_id', p_request_id,
           'request_status', (select status from inv_requests where id = q.id), 'lines', v_out));
end;
$$;

-- Return from an employee. Each line says the condition; good (or fair) completes the check in this call and the item is available at the chosen
-- bin; needs_inspection / damaged / unserviceable are held at the warehouse and never released automatically. Items not listed stay with the employee.
--   Lines: {"unit_id","condition","bin_id","note"} or {"item_id","qty","condition","bin_id","rental_id","note"}
create or replace function inv_return_from_employee(p_company_id uuid, p_location_id uuid, p_employee_id uuid, p_key text, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; emp employees; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record;
  v_seen uuid[] := '{}'; v_cond text; v_bin uuid; v_qty numeric; v_rental uuid; v_dest uuid; v_out jsonb := '[]'::jsonb; v_have numeric;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  emp := inv_get_employee(p_employee_id, false);
  h := inv_begin_movement(p_company_id, 'return_employee', p_key,
         jsonb_build_object('location', p_location_id, 'employee', p_employee_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('employee_id', emp.id, 'recipient_employee_id', emp.id, 'to_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    v_bin := nullif(e->>'bin_id', '')::uuid;
    perform inv_check_bin(v_bin, l.id);
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      i := inv_get_item(u.item_id);
      perform inv_check_sharing(i.company_id, l.company_id);
      if u.custody_kind <> 'employee' or u.employee_id is distinct from emp.id then
        raise exception '% is not recorded with this employee (it is %)', u.code, inv_custody_words(u.custody_kind) using errcode = '23514';
      end if;
      v_cond := inv_valid_condition(e->>'condition');
      perform inv_unit_move(u.id, 'warehouse', l.id, v_bin, p_condition => v_cond);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'employee', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_from_emp => emp.id,
                     p_cond_from => u.condition, p_cond_to => v_cond, p_note => e->>'note');
      perform inv_mirror_legacy(u.id);
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code, 'condition', v_cond, 'available', v_cond in ('good', 'fair'));
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      perform inv_check_sharing(i.company_id, l.company_id);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_cond := inv_valid_condition(e->>'condition', true);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      select coalesce(sum(b.qty), 0) into v_have from inv_balances b where b.item_id = i.id and b.holder_kind = 'employee' and b.employee_id = emp.id;
      if v_have = 0 then raise exception 'This employee does not hold any %', i.name using errcode = '23514'; end if;
      for t in select * from inv_take_qty(i.id, v_qty, 'employee', p_employee => emp.id, p_rental => v_rental,
                                           p_rentals => case when v_rental is null then 'any' else 'only' end, p_where => 'with this employee') loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'warehouse', v_cond, l.id, v_bin, p_rental => t.rental_id);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'employee', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_from_emp => emp.id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => t.condition, p_cond_to => v_cond, p_note => e->>'note');
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty, 'condition', v_cond, 'available', v_cond = 'good');
    end if;
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('employee_id', emp.id, 'lines', v_out));
end;
$$;

-- Dispatch to a project. With a request, each line must match an active reservation of that request (the reservation's dispatched
-- quantity goes up and it stays active). Without one, the unit or quantity must be unreserved and free from now until the expected return,
-- and another reservation in that period stops the dispatch (nothing is ever displaced).
--   Lines: {"unit_id"} or {"item_id","qty","bin_id","rental_id"}
create or replace function inv_dispatch_to_project(p_company_id uuid, p_location_id uuid, p_project_id uuid, p_key text, p_lines jsonb,
                                                   p_request_id uuid default null, p_expected_return_at timestamptz default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; pr proj_projects; q inv_requests; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record;
  v_exp timestamptz; v_seen uuid[] := '{}'; v_why text; v_res text; v_qty numeric; v_rental uuid; v_free numeric; v_dest uuid; v_covered numeric;
  v_out jsonb := '[]'::jsonb;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  if p_request_id is not null then
    select * into q from inv_requests where id = p_request_id;
    if q.id is null or q.company_id <> p_company_id then raise exception 'Unknown request' using errcode = '22023'; end if;
    if q.kind <> 'project' or q.project_id is distinct from p_project_id then raise exception 'That request is not for this project' using errcode = '23514'; end if;
    if q.status not in ('submitted', 'in_progress') then raise exception 'Request % is % and cannot be dispatched against', q.code, q.status using errcode = '23514'; end if;
  end if;
  v_exp := coalesce(p_expected_return_at, q.expected_return_at, q.needed_until);
  if v_exp is null then raise exception 'Say when the equipment is expected back' using errcode = '22023'; end if;
  if v_exp <= now() then raise exception 'The expected return date must be in the future' using errcode = '22023'; end if;
  h := inv_begin_movement(p_company_id, 'dispatch_project', p_key,
         jsonb_build_object('location', p_location_id, 'project', p_project_id, 'lines', p_lines, 'request', p_request_id, 'expected', p_expected_return_at, 'note', p_note),
         jsonb_build_object('project_id', p_project_id, 'request_id', p_request_id, 'from_location_id', l.id, 'expected_return_at', v_exp, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  pr := inv_get_project(p_project_id, true);
  for e in select x from jsonb_array_elements(p_lines) x loop
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      i := inv_get_item(u.item_id);
      perform inv_check_sharing(i.company_id, l.company_id);
      perform inv_check_sharing(i.company_id, pr.company_id);
      v_why := inv_unit_block_reason(u, l.id);
      if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
      if q.id is not null then
        if inv_reservation_take(q.id, u.item_id, u.id, 1, null) < 1 then
          raise exception '% is not reserved for request %. Reserve it for the request first', u.code, q.code using errcode = '23514';
        end if;
      else
        v_res := inv_unit_reserved_by(u.id, now(), v_exp);
        if v_res is not null then
          raise exception '% is reserved for % in that period. Dispatch it against that request, or choose another unit', u.code, v_res using errcode = '23514';
        end if;
      end if;
      perform inv_unit_move(u.id, 'project', p_project => pr.id, p_expected => v_exp);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'warehouse', 'project', p_from_loc => l.id, p_from_bin => u.bin_id, p_to_proj => pr.id,
                     p_cond_from => u.condition, p_cond_to => u.condition);
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code);
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      if i.tracking = 'consumable' then raise exception '% is a consumable. Record its use with Consume, not Dispatch', i.name using errcode = '23514'; end if;
      if i.tracking <> 'quantity' then raise exception '% is tracked unit by unit. Name the units to dispatch', i.name using errcode = '23514'; end if;
      perform inv_check_sharing(i.company_id, l.company_id);
      perform inv_check_sharing(i.company_id, pr.company_id);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      if q.id is not null then
        v_covered := inv_reservation_take(q.id, i.id, null, v_qty, l.id);
        if v_covered < v_qty then
          raise exception 'Only % of % is reserved for request % at this location. Reserve the rest first', trim_scale(v_covered), i.name, q.code using errcode = '23514';
        end if;
      else
        v_free := inv_qty_free(i.id, l.id, now(), v_exp, null, v_rental is not null);
        if v_qty > v_free then
          raise exception 'Only % of % is free until %: the rest is not on the shelf or is reserved by another request', trim_scale(v_free), i.name, to_char(v_exp at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') using errcode = '23514';
        end if;
      end if;
      for t in select * from inv_take_qty(i.id, v_qty, 'warehouse', l.id, nullif(e->>'bin_id', '')::uuid, p_condition => 'good', p_rental => v_rental,
                                           p_rentals => case when v_rental is null then 'owned' else 'only' end, p_where => 'on the shelf here') loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'project', 'good', p_project => pr.id, p_rental => t.rental_id, p_expected => v_exp);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken, v_exp);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'warehouse', 'project', p_from_loc => l.id, p_from_bin => t.bin_id, p_to_proj => pr.id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => 'good', p_cond_to => 'good');
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty);
    end if;
  end loop;
  if q.id is not null then perform inv_refresh_request_status(q.id); end if;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('project_id', pr.id, 'request_id', p_request_id, 'expected_return_at', v_exp,
           'request_status', (select status from inv_requests where id = q.id), 'lines', v_out));
end;
$$;

-- Return from a project; partial returns are normal: whatever is not listed stays on the project. Equipment that was never dispatched to
-- the project is refused. Each line gives a condition (good / fair is available at once; the rest is held).
--   Lines: {"unit_id","condition","bin_id","note"} or {"item_id","qty","condition","bin_id","rental_id","note"}
create or replace function inv_return_from_project(p_company_id uuid, p_location_id uuid, p_project_id uuid, p_key text, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; pr proj_projects; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record;
  v_seen uuid[] := '{}'; v_cond text; v_bin uuid; v_qty numeric; v_rental uuid; v_dest uuid; v_out jsonb := '[]'::jsonb; v_have numeric;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  pr := inv_get_project(p_project_id, false);
  h := inv_begin_movement(p_company_id, 'return_project', p_key,
         jsonb_build_object('location', p_location_id, 'project', p_project_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('project_id', pr.id, 'to_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    v_bin := nullif(e->>'bin_id', '')::uuid;
    perform inv_check_bin(v_bin, l.id);
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      i := inv_get_item(u.item_id);
      perform inv_check_sharing(i.company_id, l.company_id);
      if u.custody_kind <> 'project' or u.project_id is distinct from pr.id then
        raise exception '% was not dispatched to project % (it is %), so it cannot be returned from there', u.code, pr.reference, inv_custody_words(u.custody_kind) using errcode = '23514';
      end if;
      v_cond := inv_valid_condition(e->>'condition');
      perform inv_unit_move(u.id, 'warehouse', l.id, v_bin, p_condition => v_cond);
      perform inv_reservation_return(pr.id, u.item_id, u.id, 1);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'project', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_from_proj => pr.id,
                     p_cond_from => u.condition, p_cond_to => v_cond, p_note => e->>'note');
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code, 'condition', v_cond, 'available', v_cond in ('good', 'fair'));
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      perform inv_check_sharing(i.company_id, l.company_id);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_cond := inv_valid_condition(e->>'condition', true);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      select coalesce(sum(b.qty), 0) into v_have from inv_balances b where b.item_id = i.id and b.holder_kind = 'project' and b.project_id = pr.id;
      if v_have = 0 then raise exception '% was never dispatched to project %, so it cannot be returned from there', i.name, pr.reference using errcode = '23514'; end if;
      for t in select * from inv_take_qty(i.id, v_qty, 'project', p_project => pr.id, p_rental => v_rental,
                                           p_rentals => case when v_rental is null then 'any' else 'only' end, p_where => 'on project ' || pr.reference) loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'warehouse', v_cond, l.id, v_bin, p_rental => t.rental_id);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'project', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_from_proj => pr.id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => t.condition, p_cond_to => v_cond, p_note => e->>'note');
      end loop;
      perform inv_reservation_return(pr.id, i.id, null, v_qty);
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty, 'condition', v_cond, 'available', v_cond = 'good');
    end if;
  end loop;
  perform inv_refresh_project_requests(pr.id);
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('project_id', pr.id, 'lines', v_out));
end;
$$;

-- Direct project-to-project transfer in ONE transaction: the first project's custody is closed and the second opened, after the
-- destination has been checked again under the item locks. Who: the manager of the project the equipment is on, or the warehouse
-- that operates it. The destination project must be ongoing and has a request (p_request_id). The unit / quantity must be reserved for
-- that request, or free for the window and is then reserved for it; a reservation held by a third project is never displaced.
--   Lines: {"unit_id"} or {"item_id","qty","rental_id","location_id"}  (location_id only if the warehouse of the stock cannot be worked out)
create or replace function inv_transfer_between_projects(p_company_id uuid, p_from_project_id uuid, p_to_project_id uuid, p_key text, p_lines jsonb,
                                                         p_request_id uuid, p_expected_return_at timestamptz default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  fp proj_projects; tp proj_projects; q inv_requests; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record;
  v_can_manage boolean; v_exp timestamptz; v_seen uuid[] := '{}'; v_res text; v_line uuid; v_qty numeric; v_rental uuid; v_dest uuid;
  v_taken numeric; v_covered numeric; v_origin uuid; v_r numeric; v_shelf numeric; v_out jsonb := '[]'::jsonb; v_reserved boolean; v_new_res integer := 0;
begin
  perform inv_ctx(p_company_id);
  perform inv_lines_array(p_lines);
  if p_from_project_id is null or p_to_project_id is null or p_from_project_id = p_to_project_id then raise exception 'Choose two different projects' using errcode = '22023'; end if;
  select * into fp from proj_projects where id = p_from_project_id;
  if fp.id is null or fp.company_id <> p_company_id then raise exception 'Unknown project' using errcode = '22023'; end if;
  v_can_manage := proj_can_manage(fp.id);
  if not (v_can_manage or inv_has_capability(p_company_id, 'warehouse')) then
    raise exception 'Only the manager of the project the equipment is on, or the warehouse, can move it to another project' using errcode = '42501';
  end if;
  select * into q from inv_requests where id = p_request_id;
  if q.id is null or q.company_id <> p_company_id then raise exception 'A transfer needs the destination project''s equipment request' using errcode = '22023'; end if;
  if q.kind <> 'project' or q.project_id is distinct from p_to_project_id then raise exception 'That request is not for the destination project' using errcode = '23514'; end if;
  if q.status not in ('submitted', 'in_progress') then raise exception 'Request % is % and cannot receive equipment', q.code, q.status using errcode = '23514'; end if;
  v_exp := coalesce(p_expected_return_at, q.expected_return_at, q.needed_until);
  if v_exp is null then raise exception 'Say when the equipment is expected back' using errcode = '22023'; end if;
  if v_exp <= now() then raise exception 'The expected return date must be in the future' using errcode = '22023'; end if;
  h := inv_begin_movement(p_company_id, 'transfer_project', p_key,
         jsonb_build_object('from', p_from_project_id, 'to', p_to_project_id, 'lines', p_lines, 'request', p_request_id, 'expected', p_expected_return_at, 'note', p_note),
         jsonb_build_object('project_id', p_from_project_id, 'to_project_id', p_to_project_id, 'request_id', p_request_id, 'expected_return_at', v_exp, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  -- The destination is checked AFTER the locks are held, so a project that completed meanwhile is caught.
  tp := inv_get_project(p_to_project_id, true);
  select * into q from inv_requests where id = p_request_id for update;
  if q.status not in ('submitted', 'in_progress') then raise exception 'Request % is % and cannot receive equipment', q.code, q.status using errcode = '23514'; end if;
  for e in select x from jsonb_array_elements(p_lines) x loop
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      i := inv_get_item(u.item_id);
      if u.lifecycle <> 'active' then raise exception '% is not active (it is %)', u.code, u.lifecycle using errcode = '23514'; end if;
      if u.custody_kind <> 'project' or u.project_id is distinct from fp.id then
        raise exception '% is not on project % (it is %)', u.code, fp.reference, inv_custody_words(u.custody_kind) using errcode = '23514';
      end if;
      if not (v_can_manage or (u.location_id is not null and inv_can_operate(u.location_id))) then
        raise exception 'You are not allowed to move % to another project. You need to manage project % or work at the warehouse it came from', u.code, fp.reference using errcode = '42501';
      end if;
      perform inv_check_sharing(i.company_id, tp.company_id);
      -- close the first project's custody and reservation
      perform inv_reservation_return(fp.id, u.item_id, u.id, 1);
      -- the destination: reserved for the request already, or free for the window and reserved now
      select exists (select 1 from inv_reservations r join inv_request_lines rl on rl.id = r.request_line_id
                      where rl.request_id = q.id and r.unit_id = u.id and r.status = 'active' and r.dispatched_qty < r.qty) into v_reserved;
      if v_reserved then
        perform inv_reservation_take(q.id, u.item_id, u.id, 1, null);
      else
        v_res := inv_unit_reserved_by(u.id, now(), v_exp);
        if v_res is not null then
          raise exception '% is reserved for % in that period. A reservation held by another request is never displaced', u.code, v_res using errcode = '23514';
        end if;
        select rl.id into v_line from inv_request_lines rl where rl.request_id = q.id and inv_effective_item(rl) = u.item_id and rl.status = 'open'
           and rl.qty - coalesce((select sum(r.qty) from inv_reservations r where r.request_line_id = rl.id and r.status in ('active', 'completed')), 0) >= 1
         order by rl.sort_order, rl.created_at limit 1;
        if v_line is null then raise exception 'Request % has no open line for % with room for another one', q.code, i.name using errcode = '23514'; end if;
        insert into inv_reservations (company_id, request_line_id, item_id, unit_id, qty, dispatched_qty, reserved_during, made_by)
        values (q.company_id, v_line, u.item_id, u.id, 1, 1, tstzrange(now(), v_exp), auth.uid());
        v_new_res := v_new_res + 1;
      end if;
      perform inv_unit_move(u.id, 'project', p_project => tp.id, p_expected => v_exp);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'project', 'project', p_from_proj => fp.id, p_to_proj => tp.id, p_cond_from => u.condition, p_cond_to => u.condition);
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code);
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      if i.tracking <> 'quantity' then raise exception '% cannot be moved by quantity', i.name using errcode = '23514'; end if;
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      perform inv_check_sharing(i.company_id, tp.company_id);
      v_taken := 0; v_origin := null;
      for t in select * from inv_take_qty(i.id, v_qty, 'project', p_project => fp.id, p_rental => v_rental,
                                           p_rentals => case when v_rental is null then 'any' else 'only' end, p_where => 'on project ' || fp.reference) loop
        if v_origin is null then
          select l2.from_location_id into v_origin from inv_movement_lines l2 where l2.to_balance_id = t.balance_id and l2.from_location_id is not null
           order by l2.id limit 1;
        end if;
        v_dest := inv_bal_ensure(i.company_id, i.id, 'project', t.condition, p_project => tp.id, p_rental => t.rental_id, p_expected => v_exp);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken, v_exp);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'project', 'project', p_from_proj => fp.id, p_to_proj => tp.id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => t.condition, p_cond_to => t.condition);
        v_taken := v_taken + t.taken;
      end loop;
      v_origin := coalesce(v_origin, nullif(e->>'location_id', '')::uuid);
      if not (v_can_manage or (v_origin is not null and inv_can_operate(v_origin))) then
        raise exception 'You are not allowed to move % to another project. You need to manage project % or work at the warehouse it came from', i.name, fp.reference using errcode = '42501';
      end if;
      perform inv_reservation_return(fp.id, i.id, null, v_taken);
      v_covered := inv_reservation_take(q.id, i.id, null, v_taken, null);
      if v_covered < v_taken then
        if v_origin is null then raise exception 'Say which warehouse the % belongs to (location_id on the line)', i.name using errcode = '22023'; end if;
        select coalesce(sum(r.qty - r.dispatched_qty), 0) into v_r
          from inv_reservations r join inv_request_lines rl on rl.id = r.request_line_id join inv_requests rq on rq.id = rl.request_id
         where r.item_id = i.id and r.unit_id is null and r.location_id = v_origin and r.status = 'active'
           and r.reserved_during && tstzrange(now(), v_exp) and rq.project_id is distinct from fp.id and rq.id <> q.id;
        select coalesce(sum(b.qty), 0) into v_shelf from inv_balances b
         where b.item_id = i.id and b.holder_kind = 'warehouse' and b.location_id = v_origin and b.condition = 'good' and (b.rental_id is not null) = (v_rental is not null);
        if v_r > v_shelf then
          raise exception 'Moving % to project % until % would leave a reservation of another project short. Reservations of other projects are never displaced',
            i.name, tp.reference, to_char(v_exp at time zone 'UTC', 'YYYY-MM-DD') using errcode = '23514';
        end if;
        select rl.id into v_line from inv_request_lines rl where rl.request_id = q.id and inv_effective_item(rl) = i.id and rl.status = 'open'
           and rl.qty - coalesce((select sum(r.qty) from inv_reservations r where r.request_line_id = rl.id and r.status in ('active', 'completed')), 0) >= v_taken - v_covered
         order by rl.sort_order, rl.created_at limit 1;
        if v_line is null then raise exception 'Request % has no open line for % with room for % more', q.code, i.name, trim_scale(v_taken - v_covered) using errcode = '23514'; end if;
        insert into inv_reservations (company_id, request_line_id, item_id, location_id, qty, dispatched_qty, reserved_during, made_by)
        values (q.company_id, v_line, i.id, v_origin, v_taken - v_covered, v_taken - v_covered, tstzrange(now(), v_exp), auth.uid());
        v_new_res := v_new_res + 1;
      end if;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty);
    end if;
  end loop;
  perform inv_refresh_request_status(q.id);
  perform inv_refresh_project_requests(fp.id);
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('from_project_id', fp.id, 'to_project_id', tp.id, 'request_id', q.id,
           'expected_return_at', v_exp, 'new_reservations', v_new_res, 'lines', v_out));
end;
$$;

-- Warehouse transfer, part 1: dispatch. Creates the transfer record and puts the stock in transit (not available anywhere until received).
--   Lines: {"unit_id"} or {"item_id","qty","bin_id","condition","rental_id"}
create or replace function inv_transfer_dispatch(p_company_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_key text, p_lines jsonb,
                                                 p_expected_at timestamptz default null, p_carrier text default null, p_reference text default null,
                                                 p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  lf inv_locations; lt inv_locations; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record; tr inv_transfers;
  v_seen uuid[] := '{}'; v_why text; v_res text; v_qty numeric; v_rental uuid; v_cond text; v_free numeric; v_dest uuid; v_out jsonb := '[]'::jsonb; v_prev jsonb;
begin
  perform inv_ctx(p_company_id);
  lf := inv_loc(p_company_id, p_from_location_id);
  select * into lt from inv_locations where id = p_to_location_id and is_active;
  if lt.id is null then raise exception 'Unknown destination location' using errcode = '22023'; end if;
  if lt.id = lf.id then raise exception 'The destination must be a different location' using errcode = '22023'; end if;
  perform inv_lines_array(p_lines);
  if p_expected_at is not null and p_expected_at <= now() then raise exception 'The expected arrival must be in the future' using errcode = '22023'; end if;
  -- The transfer record exists before the movement header that names it (the header is immutable), so the key is checked first.
  v_prev := inv_idem_begin(p_company_id, p_key, 'transfer_dispatch',
         jsonb_build_object('from', p_from_location_id, 'to', p_to_location_id, 'lines', p_lines, 'expected', p_expected_at, 'carrier', p_carrier, 'reference', p_reference, 'note', p_note));
  if v_prev is not null then return v_prev; end if;
  insert into inv_transfers (company_id, code, from_location_id, to_location_id, carrier, reference, dispatched_by, expected_at, note)
  values (p_company_id, inv_next_code(p_company_id, 'transfer'), lf.id, lt.id, nullif(btrim(p_carrier), ''), nullif(btrim(p_reference), ''), auth.uid(), p_expected_at, nullif(btrim(p_note), ''))
  returning * into tr;
  h := inv_begin_movement(p_company_id, 'transfer_dispatch', p_key, '{}'::jsonb,
         jsonb_build_object('from_location_id', lf.id, 'to_location_id', lt.id, 'transfer_id', tr.id, 'expected_return_at', p_expected_at, 'note', p_note), true);
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      i := inv_get_item(u.item_id);
      perform inv_check_sharing(i.company_id, lf.company_id);
      perform inv_check_sharing(i.company_id, lt.company_id);
      v_why := inv_unit_block_reason(u, lf.id, false);
      if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
      v_res := inv_unit_reserved_by(u.id, now(), null);
      if v_res is not null then raise exception '% is reserved for %. Release or change that reservation before moving it to another location', u.code, v_res using errcode = '23514'; end if;
      perform inv_unit_move(u.id, 'transit', p_transfer => tr.id);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'warehouse', 'transit', p_from_loc => lf.id, p_from_bin => u.bin_id, p_to_loc => lt.id,
                     p_cond_from => u.condition, p_cond_to => u.condition);
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code);
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      if i.tracking not in ('quantity', 'consumable') then raise exception '% is tracked unit by unit. Name the units to move', i.name using errcode = '23514'; end if;
      perform inv_check_sharing(i.company_id, lf.company_id);
      perform inv_check_sharing(i.company_id, lt.company_id);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_cond := inv_valid_condition(coalesce(e->>'condition', 'good'), true);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      if v_cond = 'good' then
        v_free := inv_qty_free(i.id, lf.id, now(), null, null, v_rental is not null);
        if v_qty > v_free then
          raise exception 'Only % of % can be moved now: the rest is not on the shelf or is reserved for upcoming requests', trim_scale(v_free), i.name using errcode = '23514';
        end if;
      end if;
      for t in select * from inv_take_qty(i.id, v_qty, 'warehouse', lf.id, nullif(e->>'bin_id', '')::uuid, p_condition => v_cond, p_rental => v_rental,
                                           p_rentals => case when v_rental is null then 'owned' else 'only' end, p_where => 'on the shelf here') loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'transit', v_cond, p_transfer => tr.id, p_rental => t.rental_id);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'warehouse', 'transit', p_from_loc => lf.id, p_from_bin => t.bin_id, p_to_loc => lt.id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => v_cond, p_cond_to => v_cond);
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty);
    end if;
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('transfer_id', tr.id, 'transfer_code', tr.code, 'status', tr.status, 'lines', v_out));
end;
$$;

-- Warehouse transfer, part 3: receipt at the destination (who works there). Without lines everything still on the way is received. Receipts may
-- be partial: what is not listed stays in transit and the transfer stays open. A received unit or quantity is available only from now on, and
-- only if its condition is good (anything else is held).
--   Lines: {"unit_id","condition","bin_id"} or {"item_id","qty","condition","bin_id","rental_id"}
create or replace function inv_transfer_receive(p_company_id uuid, p_transfer_id uuid, p_key text, p_lines jsonb default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  tr inv_transfers; lt inv_locations; lf inv_locations; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record; r record;
  v_lines jsonb; v_seen uuid[] := '{}'; v_cond text; v_bin uuid; v_qty numeric; v_rental uuid; v_dest uuid; v_out jsonb := '[]'::jsonb; v_left integer;
  v_status text;
begin
  perform inv_ctx(p_company_id);
  select * into tr from inv_transfers where id = p_transfer_id;
  if tr.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
  lt := inv_loc(p_company_id, tr.to_location_id);
  select * into lf from inv_locations where id = tr.from_location_id;
  h := inv_begin_movement(p_company_id, 'transfer_receive', p_key,
         jsonb_build_object('transfer', p_transfer_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('transfer_id', tr.id, 'from_location_id', tr.from_location_id, 'to_location_id', lt.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  select * into tr from inv_transfers where id = p_transfer_id for update;
  if tr.status <> 'in_transit' then raise exception 'Transfer % is already %', tr.code, tr.status using errcode = '23514'; end if;
  if p_lines is null or p_lines = '[]'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object('unit_id', x.id)), '[]'::jsonb) into v_lines from inv_units x
     where x.transfer_id = tr.id and x.custody_kind = 'transit' and x.lifecycle = 'active';
    select v_lines || coalesce(jsonb_agg(jsonb_build_object('item_id', b.item_id, 'qty', b.qty, 'from_condition', b.condition, 'condition', b.condition, 'rental_id', b.rental_id)), '[]'::jsonb) into v_lines
      from inv_balances b where b.transfer_id = tr.id and b.holder_kind = 'transit' and b.qty > 0;
  else
    v_lines := p_lines;
  end if;
  perform inv_lines_array(v_lines);
  perform inv_lock_lines(v_lines);
  for e in select x from jsonb_array_elements(v_lines) x loop
    v_bin := nullif(e->>'bin_id', '')::uuid;
    perform inv_check_bin(v_bin, lt.id);
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      if u.custody_kind <> 'transit' or u.transfer_id is distinct from tr.id then
        raise exception '% is not part of transfer % (it is %)', u.code, tr.code, inv_custody_words(u.custody_kind) using errcode = '23514';
      end if;
      v_cond := inv_valid_condition(coalesce(e->>'condition', u.condition));
      perform inv_unit_move(u.id, 'warehouse', lt.id, v_bin, p_condition => v_cond);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'transit', 'warehouse', p_from_loc => tr.from_location_id, p_to_loc => lt.id, p_to_bin => v_bin,
                     p_cond_from => u.condition, p_cond_to => v_cond, p_note => e->>'note');
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code, 'condition', v_cond, 'available', v_cond in ('good', 'fair'));
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      for t in select * from inv_take_qty(i.id, v_qty, 'transit', p_transfer => tr.id, p_condition => nullif(e->>'from_condition', ''), p_rental => v_rental,
                                           p_rentals => case when v_rental is null then 'any' else 'only' end, p_where => 'in transit on ' || tr.code) loop
        v_cond := inv_valid_condition(coalesce(nullif(e->>'condition', ''), t.condition), true);
        v_dest := inv_bal_ensure(i.company_id, i.id, 'warehouse', v_cond, lt.id, v_bin, p_rental => t.rental_id);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'transit', 'warehouse', p_from_loc => tr.from_location_id, p_to_loc => lt.id, p_to_bin => v_bin,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => t.condition, p_cond_to => v_cond, p_note => e->>'note');
        v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', t.taken, 'condition', v_cond, 'available', v_cond = 'good');
      end loop;
    end if;
  end loop;
  select (select count(*) from inv_units x where x.transfer_id = tr.id and x.custody_kind = 'transit' and x.lifecycle = 'active')
       + (select count(*) from inv_balances b where b.transfer_id = tr.id and b.holder_kind = 'transit' and b.qty > 0) into v_left;
  if v_left = 0 then
    update inv_transfers set status = 'received', received_by = auth.uid(), received_at = now() where id = tr.id;
    v_status := 'received';
  else
    v_status := 'in_transit';
  end if;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('transfer_id', tr.id, 'transfer_code', tr.code, 'status', v_status, 'still_on_the_way', v_left, 'lines', v_out));
end;
$$;

-- Consumables: used up, no expected return. Recipient (optional): an employee or a project. With a request, the use counts against that
-- request's reservations first. Lines: {"item_id","qty","bin_id"}
create or replace function inv_consume(p_company_id uuid, p_location_id uuid, p_key text, p_lines jsonb, p_employee_id uuid default null,
                                       p_project_id uuid default null, p_request_id uuid default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; emp employees; pr proj_projects; q inv_requests; h jsonb; v_mid uuid; e jsonb; i inv_items; t record;
  v_qty numeric; v_free numeric; v_covered numeric; v_out jsonb := '[]'::jsonb;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  if p_employee_id is not null and p_project_id is not null then raise exception 'Name the employee or the project that used it, not both' using errcode = '22023'; end if;
  if p_employee_id is not null then emp := inv_get_employee(p_employee_id, true); end if;
  if p_request_id is not null then
    select * into q from inv_requests where id = p_request_id;
    if q.id is null or q.company_id <> p_company_id then raise exception 'Unknown request' using errcode = '22023'; end if;
    if q.kind <> 'project' or q.project_id is distinct from p_project_id then raise exception 'That request is not for this project' using errcode = '23514'; end if;
  end if;
  h := inv_begin_movement(p_company_id, 'consume', p_key,
         jsonb_build_object('location', p_location_id, 'employee', p_employee_id, 'project', p_project_id, 'request', p_request_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('employee_id', p_employee_id, 'recipient_employee_id', p_employee_id, 'project_id', p_project_id, 'request_id', p_request_id,
                            'from_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  if p_project_id is not null then pr := inv_get_project(p_project_id, true); end if;
  for e in select x from jsonb_array_elements(p_lines) x loop
    i := inv_get_item(nullif(e->>'item_id', '')::uuid);
    if i.tracking <> 'consumable' then raise exception '% is not a consumable. Issue or dispatch it instead', i.name using errcode = '23514'; end if;
    perform inv_check_sharing(i.company_id, l.company_id);
    if emp.id is not null then perform inv_check_sharing(i.company_id, emp.company_id); end if;
    if pr.id is not null then perform inv_check_sharing(i.company_id, pr.company_id); end if;
    v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
    v_free := inv_qty_free(i.id, l.id, now(), null, null, false);
    v_covered := 0;
    if q.id is not null then v_covered := inv_reservation_take(q.id, i.id, null, v_qty, l.id, true); end if;
    if v_qty - v_covered > v_free then
      raise exception 'Only % of % can be used now: the rest is not on the shelf or is reserved for upcoming requests', trim_scale(v_free + v_covered), i.name using errcode = '23514';
    end if;
    for t in select * from inv_take_qty(i.id, v_qty, 'warehouse', l.id, nullif(e->>'bin_id', '')::uuid, p_condition => 'good', p_rentals => 'owned', p_where => 'on the shelf here') loop
      perform inv_bal_change(t.balance_id, -t.taken);
      perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'warehouse', 'consumed', p_from_loc => l.id, p_from_bin => t.bin_id, p_from_bal => t.balance_id,
                     p_cond_from => 'good', p_note => e->>'note');
    end loop;
    v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty);
  end loop;
  if q.id is not null then perform inv_refresh_request_status(q.id); end if;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('lines', v_out));
end;
$$;

-- Unused consumables go back to the shelf only by an explicit return, and never more than that employee / project consumed.
-- Lines: {"item_id","qty","bin_id","condition"}
create or replace function inv_return_unused(p_company_id uuid, p_location_id uuid, p_key text, p_lines jsonb, p_employee_id uuid default null,
                                             p_project_id uuid default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; h jsonb; v_mid uuid; e jsonb; i inv_items; v_qty numeric; v_net numeric; v_cond text; v_bin uuid; v_dest uuid; v_out jsonb := '[]'::jsonb;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  if (p_employee_id is null) = (p_project_id is null) then raise exception 'Name the employee or the project the unused items come back from' using errcode = '22023'; end if;
  h := inv_begin_movement(p_company_id, 'return_unused', p_key,
         jsonb_build_object('location', p_location_id, 'employee', p_employee_id, 'project', p_project_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('employee_id', p_employee_id, 'recipient_employee_id', p_employee_id, 'project_id', p_project_id, 'to_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    i := inv_get_item(nullif(e->>'item_id', '')::uuid);
    if i.tracking <> 'consumable' then raise exception '% is not a consumable', i.name using errcode = '23514'; end if;
    perform inv_check_sharing(i.company_id, l.company_id);
    v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
    v_cond := inv_valid_condition(coalesce(e->>'condition', 'good'), true);
    v_bin := nullif(e->>'bin_id', '')::uuid;
    perform inv_check_bin(v_bin, l.id);
    select coalesce(sum(case m.kind when 'consume' then ln.qty else -ln.qty end), 0) into v_net
      from inv_movement_lines ln join inv_movements m on m.id = ln.movement_id
     where ln.item_id = i.id and m.kind in ('consume', 'return_unused')
       and ((p_employee_id is not null and m.employee_id = p_employee_id) or (p_project_id is not null and m.project_id = p_project_id));
    if v_qty > v_net then
      raise exception 'Only % of % was consumed by them, so no more than that can be returned as unused', trim_scale(v_net), i.name using errcode = '23514';
    end if;
    v_dest := inv_bal_ensure(i.company_id, i.id, 'warehouse', v_cond, l.id, v_bin);
    perform inv_bal_change(v_dest, v_qty);
    perform inv_ml(v_mid, p_company_id, i.id, null, v_qty, case when p_employee_id is not null then 'employee' else 'project' end, 'warehouse',
                   p_to_loc => l.id, p_to_bin => v_bin, p_from_emp => p_employee_id, p_from_proj => p_project_id, p_to_bal => v_dest, p_cond_to => v_cond, p_note => e->>'note');
    v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty, 'condition', v_cond, 'available', v_cond = 'good');
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('lines', v_out));
end;
$$;

-- Repair out: equipment (or held quantities) leave the shelf for a repairer; they are not available until repair_in.
--   Lines: {"unit_id"} or {"item_id","qty","bin_id","condition"}
create or replace function inv_repair_out(p_company_id uuid, p_location_id uuid, p_key text, p_lines jsonb, p_repair_reference text,
                                          p_expected_return_at timestamptz default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record; v_ref text := btrim(coalesce(p_repair_reference, ''));
  v_seen uuid[] := '{}'; v_why text; v_res text; v_qty numeric; v_cond text; v_free numeric; v_dest uuid; v_out jsonb := '[]'::jsonb;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  if length(v_ref) = 0 then raise exception 'Give the repair reference (repairer or job number)' using errcode = '22023'; end if;
  if p_expected_return_at is not null and p_expected_return_at <= now() then raise exception 'The expected return date must be in the future' using errcode = '22023'; end if;
  h := inv_begin_movement(p_company_id, 'repair_out', p_key,
         jsonb_build_object('location', p_location_id, 'lines', p_lines, 'ref', v_ref, 'expected', p_expected_return_at, 'note', p_note),
         jsonb_build_object('from_location_id', l.id, 'expected_return_at', p_expected_return_at, 'note', coalesce(p_note, v_ref)));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      v_why := inv_unit_block_reason(u, l.id, false);
      if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
      v_res := inv_unit_reserved_by(u.id, now(), p_expected_return_at);
      if v_res is not null then raise exception '% is reserved for % in that period and cannot go for repair now', u.code, v_res using errcode = '23514'; end if;
      perform inv_unit_move(u.id, 'repair', p_repair => v_ref, p_expected => p_expected_return_at);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'warehouse', 'repair', p_from_loc => l.id, p_from_bin => u.bin_id, p_cond_from => u.condition, p_cond_to => u.condition);
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code);
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      if i.tracking not in ('quantity', 'consumable') then raise exception '% is tracked unit by unit. Name the units', i.name using errcode = '23514'; end if;
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_cond := inv_valid_condition(coalesce(e->>'condition', 'good'), true);
      if v_cond = 'good' then
        v_free := inv_qty_free(i.id, l.id, now(), p_expected_return_at, null, false);
        if v_qty > v_free then raise exception 'Only % of % can go for repair now: the rest is reserved for upcoming requests', trim_scale(v_free), i.name using errcode = '23514'; end if;
      end if;
      for t in select * from inv_take_qty(i.id, v_qty, 'warehouse', l.id, nullif(e->>'bin_id', '')::uuid, p_condition => v_cond, p_rentals => 'owned', p_where => 'on the shelf here') loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'repair', v_cond, p_repair => v_ref, p_expected => p_expected_return_at);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken, p_expected_return_at);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'warehouse', 'repair', p_from_loc => l.id, p_from_bin => t.bin_id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => v_cond, p_cond_to => v_cond);
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty);
    end if;
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('repair_reference', v_ref, 'lines', v_out));
end;
$$;

-- Repair in: back from the repairer with the condition found. good / fair is available; anything else is held for inspection.
--   Lines: {"unit_id","condition","bin_id","note"} or {"item_id","qty","repair_reference","condition","bin_id"}
create or replace function inv_repair_in(p_company_id uuid, p_location_id uuid, p_key text, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record; v_seen uuid[] := '{}'; v_cond text; v_bin uuid; v_qty numeric;
  v_dest uuid; v_out jsonb := '[]'::jsonb;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  h := inv_begin_movement(p_company_id, 'repair_in', p_key, jsonb_build_object('location', p_location_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('to_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    v_bin := nullif(e->>'bin_id', '')::uuid;
    perform inv_check_bin(v_bin, l.id);
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      i := inv_get_item(u.item_id);
      perform inv_check_sharing(i.company_id, l.company_id);
      if u.custody_kind <> 'repair' then raise exception '% is not out for repair (it is %)', u.code, inv_custody_words(u.custody_kind) using errcode = '23514'; end if;
      v_cond := inv_valid_condition(e->>'condition');
      perform inv_unit_move(u.id, 'warehouse', l.id, v_bin, p_condition => v_cond);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'repair', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_cond_from => u.condition, p_cond_to => v_cond, p_note => e->>'note');
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code, 'condition', v_cond, 'available', v_cond in ('good', 'fair'));
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      perform inv_check_sharing(i.company_id, l.company_id);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_cond := inv_valid_condition(e->>'condition', true);
      perform inv_nonblank(e->>'repair_reference', 'Name the repair reference the quantity came back on');
      for t in select * from inv_take_qty(i.id, v_qty, 'repair', p_repair => btrim(e->>'repair_reference'), p_where => 'out for repair') loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'warehouse', v_cond, l.id, v_bin);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'repair', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_from_bal => t.balance_id,
                       p_to_bal => v_dest, p_cond_from => t.condition, p_cond_to => v_cond, p_note => e->>'note');
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty, 'condition', v_cond, 'available', v_cond = 'good');
    end if;
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('lines', v_out));
end;
$$;

-- Pack a kit against its checklist. Present items are moved INTO the kit (custody 'kit': never available on their own); missing and
-- substituted items are recorded, never hidden. A kit cannot go inside a kit, and a unit sits in at most one kit.
--   Lines: {"item_id","unit_id"?,"qty"?,"status":"present|missing|substituted","substitute_item_id"?,"expected_qty"?,"is_required"?,"note"?}
create or replace function inv_pack_kit(p_company_id uuid, p_location_id uuid, p_key text, p_kit_unit_id uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; k inv_units; ki inv_items; h jsonb; v_mid uuid; e jsonb; c inv_units; ex inv_items; sub inv_items; actual inv_items; t record;
  kc inv_kit_contents; v_status text; v_qty numeric; v_exp numeric; v_req boolean; v_why text; v_res text; v_dest uuid; v_present numeric;
  v_extra uuid[]; v_seen uuid[] := '{}'; v_out jsonb := '[]'::jsonb; v_missing jsonb; v_final text;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  select * into k from inv_units where id = p_kit_unit_id;
  if k.id is null then raise exception 'Unknown kit' using errcode = '22023'; end if;
  select * into ki from inv_items where id = k.item_id;
  if ki.tracking <> 'kit' or k.company_id <> p_company_id then raise exception '% is not a kit of this company', k.code using errcode = '23514'; end if;
  h := inv_begin_movement(p_company_id, 'pack_kit', p_key, jsonb_build_object('location', p_location_id, 'kit', p_kit_unit_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('from_location_id', l.id, 'to_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  select array_agg(distinct x) into v_extra from (
    select ki.id as x union select nullif(z->>'substitute_item_id', '')::uuid from jsonb_array_elements(p_lines) z) s where x is not null;
  perform inv_lock_lines(p_lines, v_extra);
  k := inv_unit_lock(p_kit_unit_id);
  v_why := inv_unit_block_reason(k, l.id, false);
  if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
  for e in select x from jsonb_array_elements(p_lines) x loop
    ex := inv_get_item(nullif(e->>'item_id', '')::uuid);
    if ex.company_id <> p_company_id then raise exception '% belongs to another company', ex.name using errcode = '23514'; end if;
    if ex.tracking = 'kit' then raise exception 'A kit cannot be packed inside another kit' using errcode = '23514'; end if;
    v_status := coalesce(nullif(e->>'status', ''), case when nullif(e->>'unit_id', '') is not null or nullif(e->>'qty', '') is not null then 'present' else 'missing' end);
    if v_status not in ('present', 'missing', 'substituted') then raise exception 'A kit line is present, missing or substituted' using errcode = '22023'; end if;
    v_req := coalesce((e->>'is_required')::boolean, true);
    select * into kc from inv_kit_contents where kit_unit_id = k.id and item_id = ex.id order by (status = 'substituted') limit 1 for update;
    v_exp := coalesce(nullif(e->>'expected_qty', '')::numeric, kc.expected_qty, 1);
    if ex.tracking = 'individual' then v_exp := 1; end if;
    if v_exp <= 0 then raise exception 'The expected quantity must be above zero' using errcode = '22023'; end if;

    if v_status = 'missing' then
      if kc.id is not null and (kc.content_unit_id is not null or kc.present_qty > 0) then
        raise exception '% is packed in the kit. Unpack it first, then mark it missing', ex.name using errcode = '23514';
      end if;
      if kc.id is null then
        insert into inv_kit_contents (company_id, kit_unit_id, item_id, expected_qty, is_required, status, note)
        values (p_company_id, k.id, ex.id, v_exp, v_req, 'missing', nullif(btrim(e->>'note'), ''));
      else
        update inv_kit_contents set expected_qty = v_exp, is_required = v_req, status = 'missing', substitute_item_id = null, note = coalesce(nullif(btrim(e->>'note'), ''), note), updated_at = now() where id = kc.id;
      end if;
      v_out := v_out || jsonb_build_object('item_id', ex.id, 'status', 'missing');
      continue;
    end if;

    actual := ex;
    if v_status = 'substituted' then
      sub := inv_get_item(nullif(e->>'substitute_item_id', '')::uuid);
      if sub.id = ex.id then raise exception 'A substitute has to be a different item' using errcode = '22023'; end if;
      if sub.tracking = 'kit' then raise exception 'A kit cannot be packed inside another kit' using errcode = '23514'; end if;
      if sub.company_id <> p_company_id then raise exception '% belongs to another company', sub.name using errcode = '23514'; end if;
      actual := sub;
    end if;
    if actual.tracking = 'individual' then
      c := inv_unit_lock(nullif(e->>'unit_id', '')::uuid);
      if c.item_id <> actual.id then raise exception '% is not a %', c.code, actual.name using errcode = '22023'; end if;
      if c.id = any (v_seen) then raise exception '% is listed twice', c.code using errcode = '22023'; end if;
      v_seen := v_seen || c.id;
      if exists (select 1 from inv_kit_contents x where x.content_unit_id = c.id) then
        raise exception '% is already packed in a kit. A unit can be in one kit only', c.code using errcode = '23514';
      end if;
      v_why := inv_unit_block_reason(c, l.id);
      if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
      v_res := inv_unit_reserved_by(c.id, now(), null);
      if v_res is not null then raise exception '% is reserved for % and cannot be packed into a kit now', c.code, v_res using errcode = '23514'; end if;
      if kc.id is not null and kc.content_unit_id is not null and kc.content_unit_id <> c.id then
        raise exception 'The kit already holds a unit for %. Unpack it first', ex.name using errcode = '23514';
      end if;
      perform inv_unit_move(c.id, 'kit', p_kit => k.id);
      perform inv_ml(v_mid, p_company_id, c.item_id, c.id, 1, 'warehouse', 'kit', p_from_loc => l.id, p_from_bin => c.bin_id, p_cond_from => c.condition, p_cond_to => c.condition, p_note => e->>'note');
      if kc.id is null then
        insert into inv_kit_contents (company_id, kit_unit_id, item_id, expected_qty, is_required, status, content_unit_id, substitute_item_id, note)
        values (p_company_id, k.id, ex.id, v_exp, v_req, v_status, c.id, case when v_status = 'substituted' then sub.id end, nullif(btrim(e->>'note'), ''));
      else
        update inv_kit_contents set expected_qty = v_exp, is_required = v_req, status = v_status, content_unit_id = c.id,
               substitute_item_id = case when v_status = 'substituted' then sub.id end, note = coalesce(nullif(btrim(e->>'note'), ''), note), updated_at = now() where id = kc.id;
      end if;
      v_out := v_out || jsonb_build_object('item_id', ex.id, 'unit_id', c.id, 'code', c.code, 'status', v_status);
    else
      v_qty := inv_check_qty(actual.id, (e->>'qty')::numeric);
      v_present := 0;
      for t in select * from inv_take_qty(actual.id, v_qty, 'warehouse', l.id, nullif(e->>'bin_id', '')::uuid, p_condition => 'good', p_rentals => 'owned', p_where => 'on the shelf here') loop
        v_dest := inv_bal_ensure(actual.company_id, actual.id, 'kit', 'good', p_kit => k.id);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken);
        perform inv_ml(v_mid, p_company_id, actual.id, null, t.taken, 'warehouse', 'kit', p_from_loc => l.id, p_from_bin => t.bin_id, p_from_bal => t.balance_id,
                       p_to_bal => v_dest, p_cond_from => 'good', p_cond_to => 'good', p_note => e->>'note');
      end loop;
      v_present := coalesce(kc.present_qty, 0) + v_qty;
      v_final := case when v_status = 'substituted' then 'substituted' when v_present >= v_exp then 'present' else 'missing' end;
      if kc.id is null then
        insert into inv_kit_contents (company_id, kit_unit_id, item_id, expected_qty, is_required, status, present_qty, substitute_item_id, note)
        values (p_company_id, k.id, ex.id, v_exp, v_req, v_final, v_present, case when v_final = 'substituted' then sub.id end, nullif(btrim(e->>'note'), ''));
      else
        update inv_kit_contents set expected_qty = v_exp, is_required = v_req, status = v_final, present_qty = v_present,
               substitute_item_id = case when v_final = 'substituted' then sub.id end, note = coalesce(nullif(btrim(e->>'note'), ''), note), updated_at = now() where id = kc.id;
      end if;
      v_out := v_out || jsonb_build_object('item_id', ex.id, 'qty', v_qty, 'present_qty', v_present, 'status', v_final);
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', x.item_id, 'name', i2.name, 'expected_qty', x.expected_qty, 'present_qty', x.present_qty)), '[]'::jsonb)
    into v_missing from inv_kit_contents x join inv_items i2 on i2.id = x.item_id where x.kit_unit_id = k.id and x.status = 'missing' and x.is_required;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('kit_unit_id', k.id, 'kit_code', k.code, 'lines', v_out, 'missing_required', v_missing));
end;
$$;

-- Unpack a kit (everything, or the lines given). Contents go back on the shelf at the kit's location and the checklist line becomes
-- 'missing' again (the history stays in the ledger).   Lines: {"unit_id","bin_id"} or {"item_id","qty","bin_id"}
create or replace function inv_unpack_kit(p_company_id uuid, p_location_id uuid, p_key text, p_kit_unit_id uuid, p_lines jsonb default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; k inv_units; h jsonb; v_mid uuid; e jsonb; c inv_units; t record; kc inv_kit_contents; v_lines jsonb; v_why text; v_bin uuid;
  v_qty numeric; v_dest uuid; v_out jsonb := '[]'::jsonb; v_extra uuid[]; v_seen uuid[] := '{}';
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  select * into k from inv_units where id = p_kit_unit_id;
  if k.id is null or k.company_id <> p_company_id then raise exception 'Unknown kit' using errcode = '22023'; end if;
  h := inv_begin_movement(p_company_id, 'unpack_kit', p_key, jsonb_build_object('location', p_location_id, 'kit', p_kit_unit_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('from_location_id', l.id, 'to_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_item(k.item_id);
  if p_lines is null or p_lines = '[]'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object('unit_id', x.id)), '[]'::jsonb) into v_lines from inv_units x where x.in_kit_id = k.id;
    select v_lines || coalesce(jsonb_agg(jsonb_build_object('item_id', b.item_id, 'qty', b.qty)), '[]'::jsonb) into v_lines from inv_balances b where b.kit_unit_id = k.id and b.qty > 0;
  else
    v_lines := p_lines;
  end if;
  if jsonb_array_length(v_lines) = 0 then raise exception 'There is nothing in this kit to unpack' using errcode = '23514'; end if;
  perform inv_lock_lines(v_lines, array[k.item_id]);
  k := inv_unit_lock(p_kit_unit_id);
  v_why := inv_unit_block_reason(k, l.id, false);
  if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
  for e in select x from jsonb_array_elements(v_lines) x loop
    v_bin := nullif(e->>'bin_id', '')::uuid;
    perform inv_check_bin(v_bin, l.id);
    if nullif(e->>'unit_id', '') is not null then
      c := inv_unit_lock((e->>'unit_id')::uuid);
      if c.id = any (v_seen) then raise exception '% is listed twice', c.code using errcode = '22023'; end if;
      v_seen := v_seen || c.id;
      if c.in_kit_id is distinct from k.id then raise exception '% is not packed in kit %', c.code, k.code using errcode = '23514'; end if;
      perform inv_unit_move(c.id, 'warehouse', l.id, v_bin);
      perform inv_ml(v_mid, p_company_id, c.item_id, c.id, 1, 'kit', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_cond_from => c.condition, p_cond_to => c.condition);
      update inv_kit_contents set content_unit_id = null, status = 'missing', substitute_item_id = null, updated_at = now() where content_unit_id = c.id;
      v_out := v_out || jsonb_build_object('item_id', c.item_id, 'unit_id', c.id, 'code', c.code);
    else
      v_qty := (e->>'qty')::numeric;
      for t in select * from inv_take_qty((e->>'item_id')::uuid, v_qty, 'kit', p_kit => k.id, p_where => 'in kit ' || k.code) loop
        v_dest := inv_bal_ensure(k.company_id, (e->>'item_id')::uuid, 'warehouse', t.condition, l.id, v_bin);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken);
        perform inv_ml(v_mid, p_company_id, (e->>'item_id')::uuid, null, t.taken, 'kit', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_from_bal => t.balance_id,
                       p_to_bal => v_dest, p_cond_from => t.condition, p_cond_to => t.condition);
      end loop;
      -- the checklist line for this item (or the item that stood in for it)
      select * into kc from inv_kit_contents where kit_unit_id = k.id and (item_id = (e->>'item_id')::uuid or substitute_item_id = (e->>'item_id')::uuid) order by (status = 'substituted') limit 1 for update;
      if kc.id is not null then
        update inv_kit_contents set present_qty = greatest(0, present_qty - v_qty),
               status = case when present_qty - v_qty <= 0 then 'missing' when status = 'substituted' then 'substituted'
                             when present_qty - v_qty >= expected_qty then 'present' else 'missing' end,
               substitute_item_id = case when present_qty - v_qty <= 0 then null else substitute_item_id end,
               updated_at = now() where id = kc.id;
      end if;
      v_out := v_out || jsonb_build_object('item_id', (e->>'item_id')::uuid, 'qty', v_qty);
    end if;
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('kit_unit_id', k.id, 'kit_code', k.code, 'lines', v_out));
end;
$$;

-- Edit one checklist line of a kit without moving stock: what is expected, whether it is required, a note, or remove an empty line.
create or replace function inv_set_kit_line(p_company_id uuid, p_kit_unit_id uuid, p_item_id uuid, p_expected_qty numeric default null,
                                            p_is_required boolean default null, p_note text default null, p_remove boolean default false)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare k inv_units; ki inv_items; i inv_items; kc inv_kit_contents; v_id uuid;
begin
  perform inv_ctx(p_company_id);
  select * into k from inv_units where id = p_kit_unit_id;
  if k.id is null or k.company_id <> p_company_id then raise exception 'Unknown kit' using errcode = '22023'; end if;
  select * into ki from inv_items where id = k.item_id;
  if ki.tracking <> 'kit' then raise exception '% is not a kit', k.code using errcode = '23514'; end if;
  if not ((k.location_id is not null and inv_can_operate(k.location_id)) or inv_has_capability(p_company_id, 'manage_catalogue')) then
    raise exception 'You are not allowed to change the checklist of this kit' using errcode = '42501';
  end if;
  i := inv_get_item(p_item_id);
  if i.company_id <> p_company_id then raise exception '% belongs to another company', i.name using errcode = '23514'; end if;
  perform inv_lock_item(i.id);
  select * into kc from inv_kit_contents where kit_unit_id = k.id and item_id = i.id order by (status = 'substituted') limit 1 for update;
  if coalesce(p_remove, false) then
    if kc.id is null then return null; end if;
    if kc.content_unit_id is not null or kc.present_qty > 0 then raise exception '% is packed in the kit. Unpack it before removing the line', i.name using errcode = '23514'; end if;
    delete from inv_kit_contents where id = kc.id;
    return kc.id;
  end if;
  if i.tracking = 'kit' then raise exception 'A kit cannot be part of another kit' using errcode = '23514'; end if;
  if p_expected_qty is not null then
    if i.tracking = 'individual' and p_expected_qty <> 1 then raise exception 'Individually tracked equipment is expected once per kit' using errcode = '22023'; end if;
    perform inv_check_qty(i.id, p_expected_qty);
  end if;
  if kc.id is null then
    insert into inv_kit_contents (company_id, kit_unit_id, item_id, expected_qty, is_required, status, note)
    values (p_company_id, k.id, i.id, coalesce(p_expected_qty, 1), coalesce(p_is_required, true), 'missing', nullif(btrim(p_note), '')) returning id into v_id;
  else
    update inv_kit_contents set expected_qty = coalesce(p_expected_qty, expected_qty), is_required = coalesce(p_is_required, is_required),
           note = coalesce(nullif(btrim(p_note), ''), note), updated_at = now(),
           status = case when status = 'present' and coalesce(p_expected_qty, expected_qty) > present_qty then 'missing' else status end
     where id = kc.id returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Condition check of stock on the shelf: releases held items (needs_inspection -> good) or holds them (good -> damaged), with a ledger line.
--   Lines: {"unit_id","condition","note"} or {"item_id","qty","from_condition","condition","bin_id","note"}
create or replace function inv_check_condition(p_company_id uuid, p_location_id uuid, p_key text, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record; v_seen uuid[] := '{}'; v_why text; v_cond text; v_from text; v_qty numeric;
  v_dest uuid; v_out jsonb := '[]'::jsonb;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  h := inv_begin_movement(p_company_id, 'condition_check', p_key, jsonb_build_object('location', p_location_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('from_location_id', l.id, 'to_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      v_why := inv_unit_block_reason(u, l.id, false);
      if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
      v_cond := inv_valid_condition(e->>'condition');
      if v_cond = u.condition then raise exception '% is already %', u.code, replace(v_cond, '_', ' ') using errcode = '23514'; end if;
      update inv_units set condition = v_cond, version = version + 1 where id = u.id;
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'warehouse', 'warehouse', p_from_loc => l.id, p_to_loc => l.id, p_from_bin => u.bin_id, p_to_bin => u.bin_id,
                     p_cond_from => u.condition, p_cond_to => v_cond, p_note => e->>'note');
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code, 'condition', v_cond, 'available', v_cond in ('good', 'fair'));
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      if i.tracking not in ('quantity', 'consumable') then raise exception '% is checked unit by unit', i.name using errcode = '23514'; end if;
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_from := inv_valid_condition(e->>'from_condition', true);
      v_cond := inv_valid_condition(e->>'condition', true);
      if v_from = v_cond then raise exception '% is already %', i.name, replace(v_cond, '_', ' ') using errcode = '23514'; end if;
      for t in select * from inv_take_qty(i.id, v_qty, 'warehouse', l.id, nullif(e->>'bin_id', '')::uuid, p_condition => v_from, p_rentals => 'any', p_where => 'on the shelf here') loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'warehouse', v_cond, l.id, t.bin_id, p_rental => t.rental_id);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'warehouse', 'warehouse', p_from_loc => l.id, p_to_loc => l.id, p_from_bin => t.bin_id, p_to_bin => t.bin_id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => v_from, p_cond_to => v_cond, p_note => e->>'note');
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty, 'condition', v_cond, 'available', v_cond = 'good');
    end if;
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('lines', v_out));
end;
$$;

-- Missing / found / retire. A reason is mandatory. Nothing is deleted: the unit stays with its history, lifecycle changes.
--   p_action: 'missing' | 'found' | 'retire'
--   Lines: {"unit_id","bin_id","condition"} or {"item_id","qty","bin_id","condition","rental_id"}
-- Found equipment is held for inspection unless a condition is given. Found quantity cannot exceed what was recorded missing.
create or replace function inv_adjust_stock(p_company_id uuid, p_location_id uuid, p_key text, p_action text, p_lines jsonb, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record; v_seen uuid[] := '{}'; v_reason text; v_kind text;
  v_qty numeric; v_cond text; v_bin uuid; v_dest uuid; v_net numeric; v_free numeric; v_out jsonb := '[]'::jsonb; v_rental uuid; v_res text; v_was text;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  if p_action is null or p_action not in ('missing', 'found', 'retire') then raise exception 'The action is missing, found or retire' using errcode = '22023'; end if;
  v_reason := inv_nonblank(p_reason, 'Say why (a reason is needed for every adjustment)');
  v_kind := 'adjust_' || case p_action when 'retire' then 'retire' else p_action end;
  h := inv_begin_movement(p_company_id, v_kind, p_key, jsonb_build_object('location', p_location_id, 'action', p_action, 'lines', p_lines, 'reason', v_reason),
         jsonb_build_object('from_location_id', l.id, 'reason', v_reason, 'note', v_reason));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    v_bin := nullif(e->>'bin_id', '')::uuid;
    perform inv_check_bin(v_bin, l.id);
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      if u.company_id <> p_company_id then raise exception '% belongs to another company', u.code using errcode = '23514'; end if;
      if u.lifecycle = 'draft' then raise exception '% has not been confirmed yet. Count it first', u.code using errcode = '23514'; end if;
      if u.custody_kind = 'kit' then raise exception '% is packed in a kit. Unpack it first', u.code using errcode = '23514'; end if;
      v_was := u.custody_kind;
      if p_action = 'missing' then
        if u.lifecycle <> 'active' then raise exception '% is already %', u.code, u.lifecycle using errcode = '23514'; end if;
        update inv_units set lifecycle = 'missing', version = version + 1 where id = u.id;
        perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, v_was, 'adjustment', p_from_loc => case when v_was = 'warehouse' then u.location_id end,
                       p_from_bin => u.bin_id, p_from_emp => u.employee_id, p_from_proj => u.project_id, p_cond_from => u.condition, p_note => v_reason);
        if v_was = 'employee' then perform inv_mirror_legacy(u.id); end if;
      elsif p_action = 'found' then
        if u.lifecycle <> 'missing' then raise exception '% is not recorded as missing', u.code using errcode = '23514'; end if;
        v_cond := inv_valid_condition(coalesce(nullif(e->>'condition', ''), 'needs_inspection'));
        perform inv_unit_move(u.id, 'warehouse', l.id, v_bin, p_condition => v_cond);
        update inv_units set lifecycle = 'active' where id = u.id;
        perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'adjustment', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_cond_from => u.condition, p_cond_to => v_cond, p_note => v_reason);
        if v_was = 'employee' then perform inv_mirror_legacy(u.id); end if;
        v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code, 'condition', v_cond, 'available', v_cond in ('good', 'fair'));
        continue;
      else
        if u.lifecycle = 'retired' then raise exception '% is already retired', u.code using errcode = '23514'; end if;
        if u.lifecycle = 'active' and v_was not in ('warehouse', 'repair') then
          raise exception '% is % . Bring it back before retiring it', u.code, inv_custody_words(v_was) using errcode = '23514';
        end if;
        if exists (select 1 from inv_units k where k.in_kit_id = u.id) or exists (select 1 from inv_balances b where b.kit_unit_id = u.id and b.qty > 0) then
          raise exception '% still has items packed in it. Unpack the kit first', u.code using errcode = '23514';
        end if;
        v_res := inv_unit_reserved_by(u.id, now(), null);
        if v_res is not null then raise exception '% is reserved for %. Release that reservation first', u.code, v_res using errcode = '23514'; end if;
        update inv_units set lifecycle = 'retired', retired_at = now(), version = version + 1 where id = u.id;
        perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, case when u.lifecycle = 'missing' then 'adjustment' else v_was end, 'adjustment',
                       p_from_loc => case when v_was = 'warehouse' then u.location_id end, p_from_bin => u.bin_id, p_cond_from => u.condition, p_note => v_reason);
      end if;
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code, 'lifecycle', case p_action when 'missing' then 'missing' else 'retired' end);
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      if i.company_id <> p_company_id then raise exception '% belongs to another company', i.name using errcode = '23514'; end if;
      if i.tracking not in ('quantity', 'consumable') then raise exception '% is adjusted unit by unit', i.name using errcode = '23514'; end if;
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      if p_action = 'found' then
        select coalesce(sum(case m.kind when 'adjust_missing' then ln.qty when 'adjust_found' then -ln.qty else 0 end), 0) into v_net
          from inv_movement_lines ln join inv_movements m on m.id = ln.movement_id
         where ln.item_id = i.id and m.company_id = p_company_id and m.kind in ('adjust_missing', 'adjust_found');
        if v_qty > v_net then raise exception 'Only % of % has been recorded as missing, so no more than that can be found', trim_scale(v_net), i.name using errcode = '23514'; end if;
        v_cond := inv_valid_condition(coalesce(nullif(e->>'condition', ''), 'needs_inspection'), true);
        v_dest := inv_bal_ensure(i.company_id, i.id, 'warehouse', v_cond, l.id, v_bin);
        perform inv_bal_change(v_dest, v_qty);
        perform inv_ml(v_mid, p_company_id, i.id, null, v_qty, 'adjustment', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_to_bal => v_dest, p_cond_to => v_cond, p_note => v_reason);
        v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty, 'condition', v_cond, 'available', v_cond = 'good');
      else
        v_cond := nullif(e->>'condition', '');
        if v_cond is not null then perform inv_valid_condition(v_cond, true); end if;
        if p_action = 'retire' and coalesce(v_cond, 'good') = 'good' then
          v_free := inv_qty_free(i.id, l.id, now(), null, null, v_rental is not null);
          if v_qty > v_free and v_cond = 'good' then
            raise exception 'Only % of % is not promised to upcoming requests, so no more than that can be written off', trim_scale(v_free), i.name using errcode = '23514';
          end if;
        end if;
        for t in select * from inv_take_qty(i.id, v_qty, 'warehouse', l.id, v_bin, p_condition => v_cond, p_rental => v_rental,
                                             p_rentals => case when v_rental is null then 'owned' else 'only' end, p_where => 'on the shelf here') loop
          perform inv_bal_change(t.balance_id, -t.taken);
          perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'warehouse', 'adjustment', p_from_loc => l.id, p_from_bin => t.bin_id, p_from_bal => t.balance_id,
                         p_cond_from => t.condition, p_note => v_reason);
        end loop;
        v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty);
      end if;
    end if;
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('action', p_action, 'lines', v_out));
end;
$$;

-- A correction is a NEW movement that names the original and says why; the original is never touched. Only stock that appeared
-- through a receipt, opening, found stock, count or return, and consumption, can be corrected this way (give the right total for the line).
-- For anything else, move the stock back with the proper movement.   Lines: {"line_id":"<original movement line>","qty":<the right quantity>}
create or replace function inv_correct_movement(p_company_id uuid, p_movement_id uuid, p_key text, p_reason text, p_lines jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  m inv_movements; h jsonb; v_mid uuid; e jsonb; ol inv_movement_lines; v_reason text; v_new numeric; v_eff numeric; v_delta numeric; i inv_items; v_out jsonb := '[]'::jsonb;
  v_consume boolean;
begin
  perform inv_ctx(p_company_id);
  perform inv_require_cap(p_company_id, 'confirm_stock', 'Only a founder, or someone allowed to confirm stock, can correct a movement');
  perform inv_lines_array(p_lines);
  v_reason := inv_nonblank(p_reason, 'Say why the movement is being corrected');
  select * into m from inv_movements where id = p_movement_id and company_id = p_company_id;
  if m.id is null then raise exception 'Movement not found' using errcode = 'P0002'; end if;
  if m.kind = 'correction' then raise exception 'A correction cannot itself be corrected. Correct the original movement again' using errcode = '23514'; end if;
  h := inv_begin_movement(p_company_id, 'correction', p_key, jsonb_build_object('movement', p_movement_id, 'lines', p_lines, 'reason', v_reason),
         jsonb_build_object('corrects_movement_id', m.id, 'reason', v_reason, 'note', 'Correction of ' || m.code));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines((select jsonb_agg(jsonb_build_object('item_id', l.item_id)) from inv_movement_lines l
                           where l.movement_id = m.id and l.id in (select (x->>'line_id')::uuid from jsonb_array_elements(p_lines) x)));
  for e in select x from jsonb_array_elements(p_lines) x loop
    select * into ol from inv_movement_lines where id = nullif(e->>'line_id', '')::uuid and movement_id = m.id;
    if ol.id is null then raise exception 'That line is not part of movement %', m.code using errcode = '22023'; end if;
    if ol.unit_id is not null then
      raise exception 'Equipment units are corrected with an adjustment (missing, found, retire) or a condition check, not by quantity' using errcode = '23514';
    end if;
    v_consume := ol.from_balance_id is not null and ol.to_balance_id is null and ol.to_kind = 'consumed';
    if not (v_consume or (ol.from_balance_id is null and ol.to_balance_id is not null)) then
      raise exception 'Only received, opening, found, counted or consumed quantities can be corrected this way. Move the stock back with the proper movement instead' using errcode = '23514';
    end if;
    i := inv_get_item(ol.item_id);
    v_new := (e->>'qty')::numeric;
    if v_new is null or v_new < 0 then raise exception 'Give the right quantity (zero or more)' using errcode = '22023'; end if;
    if v_new <> round(v_new, i.quantity_scale) then raise exception 'The quantity of % can have at most % decimal place(s)', i.name, i.quantity_scale using errcode = '22023'; end if;
    select ol.qty + coalesce(sum(case when v_consume then (case when cl.to_kind = 'consumed' then cl.qty else -cl.qty end)
                                      else (case when cl.from_kind = 'adjustment' then cl.qty else -cl.qty end) end), 0) into v_eff
      from inv_movement_lines cl where cl.corrects_line_id = ol.id;
    v_delta := v_new - v_eff;
    if v_delta = 0 then raise exception 'The quantity on that line is already %', v_eff using errcode = '23514'; end if;
    if not v_consume then
      if v_delta > 0 then
        perform inv_bal_change(ol.to_balance_id, v_delta);
        perform inv_ml(v_mid, p_company_id, ol.item_id, null, v_delta, 'adjustment', ol.to_kind, p_to_loc => ol.to_location_id, p_to_bin => ol.to_bin_id, p_to_emp => ol.to_employee_id,
                       p_to_proj => ol.to_project_id, p_to_bal => ol.to_balance_id, p_cond_to => ol.condition_to, p_note => v_reason, p_corrects => ol.id);
      else
        begin
          perform inv_bal_change(ol.to_balance_id, v_delta);
        exception when check_violation or sqlstate '23514' then
          raise exception 'Part of that stock has already been used or moved, so it cannot be taken away again. Record the movement that used it, or an adjustment' using errcode = '23514';
        end;
        perform inv_ml(v_mid, p_company_id, ol.item_id, null, -v_delta, ol.to_kind, 'adjustment', p_from_loc => ol.to_location_id, p_from_bin => ol.to_bin_id, p_from_emp => ol.to_employee_id,
                       p_from_proj => ol.to_project_id, p_from_bal => ol.to_balance_id, p_cond_from => ol.condition_to, p_note => v_reason, p_corrects => ol.id);
      end if;
    else
      if v_delta > 0 then
        perform inv_bal_change(ol.from_balance_id, -v_delta);
        perform inv_ml(v_mid, p_company_id, ol.item_id, null, v_delta, ol.from_kind, 'consumed', p_from_loc => ol.from_location_id, p_from_bin => ol.from_bin_id,
                       p_from_emp => ol.from_employee_id, p_from_proj => ol.from_project_id, p_from_bal => ol.from_balance_id, p_cond_from => ol.condition_from, p_note => v_reason, p_corrects => ol.id);
      else
        perform inv_bal_change(ol.from_balance_id, -v_delta);
        perform inv_ml(v_mid, p_company_id, ol.item_id, null, -v_delta, 'adjustment', ol.from_kind, p_to_loc => ol.from_location_id, p_to_bin => ol.from_bin_id,
                       p_to_emp => ol.from_employee_id, p_to_proj => ol.from_project_id, p_to_bal => ol.from_balance_id, p_cond_to => ol.condition_from, p_note => v_reason, p_corrects => ol.id);
      end if;
    end if;
    v_out := v_out || jsonb_build_object('line_id', ol.id, 'item_id', ol.item_id, 'was', v_eff, 'now', v_new);
  end loop;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('corrects_movement', m.code, 'reason', v_reason, 'lines', v_out));
end;
$$;

-- Rented stock going back to the supplier is a movement too (kind 'rental_return'). Without lines, everything of the rental that is on
-- the shelf at this location goes back. The rental closes when nothing of it is left.
--   Lines: {"unit_id"} or {"item_id","qty","bin_id","condition"}
create or replace function inv_return_rental(p_company_id uuid, p_location_id uuid, p_key text, p_rental_id uuid, p_lines jsonb default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; r inv_rentals; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record; v_lines jsonb; v_seen uuid[] := '{}'; v_why text;
  v_qty numeric; v_out jsonb := '[]'::jsonb; v_left integer; v_status text;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  select * into r from inv_rentals where id = p_rental_id and company_id = p_company_id;
  if r.id is null then raise exception 'Unknown rental' using errcode = '22023'; end if;
  h := inv_begin_movement(p_company_id, 'rental_return', p_key, jsonb_build_object('location', p_location_id, 'rental', p_rental_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('from_location_id', l.id, 'note', coalesce(p_note, 'Returned to ' || r.supplier_name)));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  select * into r from inv_rentals where id = p_rental_id for update;
  if r.status <> 'open' then raise exception 'That rental has already been returned' using errcode = '23514'; end if;
  if p_lines is null or p_lines = '[]'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object('unit_id', x.id)), '[]'::jsonb) into v_lines from inv_units x
     where x.rental_id = r.id and x.custody_kind = 'warehouse' and x.location_id = l.id and x.lifecycle = 'active';
    select v_lines || coalesce(jsonb_agg(jsonb_build_object('item_id', b.item_id, 'qty', b.qty, 'condition', b.condition, 'bin_id', b.bin_id)), '[]'::jsonb) into v_lines
      from inv_balances b where b.rental_id = r.id and b.holder_kind = 'warehouse' and b.location_id = l.id and b.qty > 0;
  else
    v_lines := p_lines;
  end if;
  perform inv_lines_array(v_lines);
  perform inv_lock_lines(v_lines);
  for e in select x from jsonb_array_elements(v_lines) x loop
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      if u.rental_id is distinct from r.id then raise exception '% is not part of this rental', u.code using errcode = '23514'; end if;
      v_why := inv_unit_block_reason(u, l.id, false);
      if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
      update inv_units set lifecycle = 'retired', retired_at = now(), version = version + 1, notes = coalesce(notes || E'\n', '') || 'Returned to ' || r.supplier_name where id = u.id;
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'warehouse', 'adjustment', p_from_loc => l.id, p_from_bin => u.bin_id, p_cond_from => u.condition, p_note => 'Returned to ' || r.supplier_name);
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code);
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      for t in select * from inv_take_qty(i.id, v_qty, 'warehouse', l.id, nullif(e->>'bin_id', '')::uuid, p_condition => nullif(e->>'condition', ''), p_rental => r.id, p_rentals => 'only',
                                           p_where => 'of this rental on the shelf here') loop
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'warehouse', 'adjustment', p_from_loc => l.id, p_from_bin => t.bin_id, p_from_bal => t.balance_id,
                       p_cond_from => t.condition, p_note => 'Returned to ' || r.supplier_name);
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty);
    end if;
  end loop;
  select (select count(*) from inv_units x where x.rental_id = r.id and x.lifecycle in ('draft', 'active', 'missing'))
       + (select count(*) from inv_balances b where b.rental_id = r.id and b.qty > 0) into v_left;
  if v_left = 0 then
    update inv_rentals set status = 'returned', returned_at = now() where id = r.id;
    v_status := 'returned';
  else
    v_status := 'open';
  end if;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('rental_id', r.id, 'rental_status', v_status, 'still_out', v_left, 'lines', v_out));
end;
$$;

-- "Did my request go through?" for a retried or timed-out call. Only the person who used the key (or someone who may read stock) can see it.
create or replace function inv_transaction_status(p_company_id uuid, p_key text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare r inv_idempotency; m inv_movements;
begin
  perform inv_require_user();
  select * into r from inv_idempotency where company_id = p_company_id and idem_key = btrim(coalesce(p_key, ''));
  if r.company_id is null or not (r.performed_by = auth.uid() or inv_can_view_stock(p_company_id)) then
    return jsonb_build_object('found', false, 'status', 'not_recorded');
  end if;
  select * into m from inv_movements where id = r.movement_id;
  return jsonb_build_object('found', true, 'status', case when r.result is null then 'in_progress' else 'recorded' end, 'kind', r.kind,
           'movement_id', m.id, 'movement_code', m.code, 'recorded_at', coalesce(m.recorded_at, r.created_at), 'mine', r.performed_by = auth.uid(), 'result', r.result);
end;
$$;

-- Read-only consistency check. Returns a row for every stock row whose quantity differs from the sum of the ledger lines that point at it,
-- and for every unit whose custody disagrees with its last movement line. Empty means the books agree. Only for companies where the
-- caller may read the audit log.
create or replace function inv_ledger_problems()
returns table (problem text, company_id uuid, subject_id uuid, detail text)
language sql stable security definer
set search_path = public
as $$
  select 'balance_differs_from_ledger'::text, b.company_id, b.id,
         format('Stock row holds %s but the ledger lines add up to %s', b.qty, coalesce(s.net, 0))
    from inv_balances b
    left join lateral (select sum(case when l.to_balance_id = b.id then l.qty else 0 end) - sum(case when l.from_balance_id = b.id then l.qty else 0 end) as net
                         from inv_movement_lines l where l.to_balance_id = b.id or l.from_balance_id = b.id) s on true
   where b.qty <> coalesce(s.net, 0) and inv_has_capability(b.company_id, 'view_audit')
  union all
  select 'unit_custody_differs_from_last_movement'::text, u.company_id, u.id,
         format('%s is recorded as %s but its last movement says %s', u.code, u.custody_kind || '/' || u.lifecycle, x.to_kind)
    from inv_units u
    join (select distinct on (l.unit_id) l.unit_id, l.to_kind, l.to_location_id, l.to_employee_id, l.to_project_id
            from inv_movement_lines l join inv_movements m on m.id = l.movement_id
           where l.unit_id is not null
           order by l.unit_id, m.recorded_at desc, m.code desc, l.id desc) x on x.unit_id = u.id
   where inv_has_capability(u.company_id, 'view_audit')
     and not (case x.to_kind
                when 'warehouse' then u.custody_kind = 'warehouse' and u.location_id is not distinct from x.to_location_id and u.lifecycle in ('active', 'draft')
                when 'employee' then u.custody_kind = 'employee' and u.employee_id is not distinct from x.to_employee_id
                when 'project' then u.custody_kind = 'project' and u.project_id is not distinct from x.to_project_id
                when 'transit' then u.custody_kind = 'transit'
                when 'repair' then u.custody_kind = 'repair'
                when 'kit' then u.custody_kind = 'kit'
                when 'adjustment' then u.lifecycle in ('missing', 'retired')
                else false end);
$$;

-- =============================================================================
-- Privileges: every client-facing function is executable by signed-in users only (each checks its own permissions inside);
-- internal helpers stay closed.
-- =============================================================================
revoke all on function
  inv_ctx(uuid), inv_require_cap(uuid, text, text), inv_loc(uuid, uuid, boolean), inv_check_bin(uuid, uuid), inv_check_sharing(uuid, uuid),
  inv_get_item(uuid), inv_get_employee(uuid, boolean), inv_get_project(uuid, boolean), inv_lines_array(jsonb), inv_lock_lines(jsonb, uuid[]),
  inv_unit_lock(uuid), inv_custody_words(text), inv_unit_block_reason(inv_units, uuid, boolean),
  inv_unit_reserved_by(uuid, timestamptz, timestamptz, uuid, uuid), inv_valid_condition(text, boolean),
  inv_bal_ensure(uuid, uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, timestamptz), inv_bal_change(uuid, numeric, timestamptz),
  inv_take_qty(uuid, numeric, text, uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, text),
  inv_ml(uuid, uuid, uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid),
  inv_unit_move(uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, timestamptz, text),
  inv_idem_begin(uuid, text, text, jsonb), inv_begin_movement(uuid, text, text, jsonb, jsonb, boolean), inv_finish_movement(uuid, text, jsonb),
  inv_reservation_take(uuid, uuid, uuid, numeric, uuid, boolean), inv_reservation_return(uuid, uuid, uuid, numeric),
  inv_nonblank(text, text), inv_cost_fields_present(jsonb), inv_refresh_request_status(uuid), inv_refresh_project_requests(uuid)
  from public, anon, authenticated;

revoke all on function
  inv_save_location(uuid, uuid, text, text, text, text, text, boolean), inv_save_bin(uuid, uuid, text, text, boolean),
  inv_set_operator_locations(uuid, uuid, uuid[]), inv_save_category(uuid, uuid, text, uuid, integer, boolean), inv_save_item(uuid, uuid, jsonb),
  inv_replace_item(uuid, jsonb, text), inv_set_company_sharing(uuid, uuid, boolean, text),
  inv_register_unit(uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, text, text), inv_ensure_bin_label(uuid, uuid, uuid, uuid),
  inv_record_label_print(uuid, uuid, uuid),
  inv_start_count(uuid, uuid, text, text), inv_save_count_line(uuid, numeric, uuid, uuid, uuid, text, text, text, uuid),
  inv_confirm_count(uuid, uuid, text, text), inv_cancel_count(uuid, uuid, text), inv_confirm_opening_custody(uuid, text, jsonb, text),
  inv_receive_stock(uuid, uuid, text, jsonb, jsonb, text), inv_issue_to_employee(uuid, uuid, uuid, text, jsonb, timestamptz, text, uuid),
  inv_return_from_employee(uuid, uuid, uuid, text, jsonb, text), inv_dispatch_to_project(uuid, uuid, uuid, text, jsonb, uuid, timestamptz, text),
  inv_return_from_project(uuid, uuid, uuid, text, jsonb, text), inv_transfer_between_projects(uuid, uuid, uuid, text, jsonb, uuid, timestamptz, text),
  inv_transfer_dispatch(uuid, uuid, uuid, text, jsonb, timestamptz, text, text, text), inv_transfer_receive(uuid, uuid, text, jsonb, text),
  inv_consume(uuid, uuid, text, jsonb, uuid, uuid, uuid, text), inv_return_unused(uuid, uuid, text, jsonb, uuid, uuid, text),
  inv_repair_out(uuid, uuid, text, jsonb, text, timestamptz, text), inv_repair_in(uuid, uuid, text, jsonb, text),
  inv_pack_kit(uuid, uuid, text, uuid, jsonb, text), inv_unpack_kit(uuid, uuid, text, uuid, jsonb, text),
  inv_set_kit_line(uuid, uuid, uuid, numeric, boolean, text, boolean), inv_check_condition(uuid, uuid, text, jsonb, text),
  inv_adjust_stock(uuid, uuid, text, text, jsonb, text), inv_correct_movement(uuid, uuid, text, text, jsonb),
  inv_return_rental(uuid, uuid, text, uuid, jsonb, text), inv_transaction_status(uuid, text), inv_ledger_problems()
  from public, anon, authenticated;

grant execute on function
  inv_save_location(uuid, uuid, text, text, text, text, text, boolean), inv_save_bin(uuid, uuid, text, text, boolean),
  inv_set_operator_locations(uuid, uuid, uuid[]), inv_save_category(uuid, uuid, text, uuid, integer, boolean), inv_save_item(uuid, uuid, jsonb),
  inv_replace_item(uuid, jsonb, text), inv_set_company_sharing(uuid, uuid, boolean, text),
  inv_register_unit(uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, text, text), inv_ensure_bin_label(uuid, uuid, uuid, uuid),
  inv_record_label_print(uuid, uuid, uuid),
  inv_start_count(uuid, uuid, text, text), inv_save_count_line(uuid, numeric, uuid, uuid, uuid, text, text, text, uuid),
  inv_confirm_count(uuid, uuid, text, text), inv_cancel_count(uuid, uuid, text), inv_confirm_opening_custody(uuid, text, jsonb, text),
  inv_receive_stock(uuid, uuid, text, jsonb, jsonb, text), inv_issue_to_employee(uuid, uuid, uuid, text, jsonb, timestamptz, text, uuid),
  inv_return_from_employee(uuid, uuid, uuid, text, jsonb, text), inv_dispatch_to_project(uuid, uuid, uuid, text, jsonb, uuid, timestamptz, text),
  inv_return_from_project(uuid, uuid, uuid, text, jsonb, text), inv_transfer_between_projects(uuid, uuid, uuid, text, jsonb, uuid, timestamptz, text),
  inv_transfer_dispatch(uuid, uuid, uuid, text, jsonb, timestamptz, text, text, text), inv_transfer_receive(uuid, uuid, text, jsonb, text),
  inv_consume(uuid, uuid, text, jsonb, uuid, uuid, uuid, text), inv_return_unused(uuid, uuid, text, jsonb, uuid, uuid, text),
  inv_repair_out(uuid, uuid, text, jsonb, text, timestamptz, text), inv_repair_in(uuid, uuid, text, jsonb, text),
  inv_pack_kit(uuid, uuid, text, uuid, jsonb, text), inv_unpack_kit(uuid, uuid, text, uuid, jsonb, text),
  inv_set_kit_line(uuid, uuid, uuid, numeric, boolean, text, boolean), inv_check_condition(uuid, uuid, text, jsonb, text),
  inv_adjust_stock(uuid, uuid, text, text, jsonb, text), inv_correct_movement(uuid, uuid, text, text, jsonb),
  inv_return_rental(uuid, uuid, text, uuid, jsonb, text), inv_transaction_status(uuid, text), inv_ledger_problems()
  to authenticated;

revoke all on table inv_company_sharing, inv_idempotency from anon, authenticated, public;
grant select on table inv_company_sharing to authenticated;

-- ROLLBACK (only before any Inventory stock exists; afterwards use the safe-disable script, never drop):
--   drop function if exists <every function named in this file>;
--   drop table if exists inv_idempotency, inv_company_sharing cascade;
--   alter table inv_movement_lines drop column if exists corrects_line_id;
--   (the widened inv_movements kind check only adds 'rental_return'; it can stay)
