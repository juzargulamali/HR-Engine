-- Inventory, migration 6 of 6 (file 20261201000500): employees and the earlier HR asset register.
--
-- CLIENT-FACING FUNCTIONS (all security definer, search_path = public, executable by authenticated only)
--   inv_employee_lookup(p_company_id uuid, p_query text)
--       returns table (employee_id uuid, display_name text, employee_number text, department_name text)
--   inv_my_equipment()
--       returns table (kind text, unit_id uuid, balance_id uuid, code text, item_id uuid, item_name text, serial_number text, qty numeric,
--                      unit_of_measure text, issued_at timestamptz, expected_return_at timestamptz, condition text, lifecycle text,
--                      is_overdue boolean, company_id uuid)
--   inv_employee_outstanding(p_company_id uuid, p_employee_id uuid default null, p_include_inactive boolean default true)
--       returns table (employee_id uuid, display_name text, employee_number text, employment_status text, termination_date date,
--                      is_active boolean, is_removed boolean, holding_kind text, unit_id uuid, balance_id uuid, code text, item_id uuid,
--                      item_name text, serial_number text, qty numeric, unit_of_measure text, issued_at timestamptz,
--                      expected_return_at timestamptz, condition text, lifecycle text, is_overdue boolean)
--   inv_reassign_unit(p_unit_id uuid, p_to text, p_employee_id uuid, p_reason text, p_key text) returns jsonb
--       p_to = 'employee' (p_employee_id required) or 'pool' (p_employee_id must be null: the unit goes back to the warehouse pool at
--       its recorded location). Returns {movement_id, movement_code, unit_id, to, employee_id, replayed}.
--   inv_preview_legacy_assets(p_company_id uuid)
--       returns table (asset_id uuid, asset_tag text, category text, description text, status text, purchase_date date, value numeric,
--                      open_assignment_count integer, employee_id uuid, employee_name text, employee_number text, employee_active boolean,
--                      issued_date date, already_linked boolean, unit_id uuid, unit_code text)
--   inv_import_legacy_assets(p_company_id uuid, p_rows jsonb) returns jsonb
--       p_rows = [{asset_id, item_id, location_id}, ...]; returns {created, skipped, results: [{asset_id, outcome, reason, unit_id, unit_code}]}
-- INTERNAL (revoked from clients)
--   inv_mirror_legacy(p_unit_id uuid) returns void      replaces the no-op of migration 3b (identical signature)
--   inv_is_warehouse_operator(uuid), inv_employee_active(uuid), inv_legacy_guard()
-- GRANTED TO authenticated BECAUSE THE GUARD TRIGGER RUNS AS THE EDITING USER: inv_asset_is_linked(uuid) (a yes/no for one asset id).
--
-- INTENDED CHANGE TO EXISTING HR TABLES (design section 1, item 1): two row triggers, nothing else about assets or asset_assignments
-- changes (no column, policy or privilege):
--   inv_legacy_guard_assets        BEFORE UPDATE OR DELETE ON assets
--   inv_legacy_guard_assignments   BEFORE INSERT OR UPDATE OR DELETE ON asset_assignments
-- Both refuse the change with "This item is managed in Inventory. Use Inventory to issue or return it." when the asset is linked to an
-- Inventory unit (inv_units.legacy_asset_id), unless the write comes from inv_mirror_legacy (transaction-local flag inv.mirror = 'on',
-- honoured only when the statement does not run as a browser session role, so a signed-in user cannot switch the guard off by setting
-- the flag themselves). Assets that were never imported are untouched and behave exactly as before.
--
-- Employee data rule: Inventory reads employees only through the functions below, and each returns a fixed, short column list
-- (id, name, employee number, department name, employment status / termination date for HR's exit view). No salary, leave, documents,
-- personal e-mail, phone, birth date, nationality or reporting line is ever selected. Nothing here writes any HR table except the
-- legacy mirror for assets that a founder imported.
--
-- "Active employee" (inv_employee_active): not removed, employment_status active or on_leave, and not past a termination date.

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------
-- Warehouse operator of the company: holds 'warehouse' and either works at least one active location of the company or has
-- 'cross_location'. Founders count (they hold every capability).
create or replace function inv_is_warehouse_operator(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select inv_has_capability(p_company_id, 'warehouse')
     and (inv_has_capability(p_company_id, 'cross_location')
          or exists (select 1 from inv_operator_locations o join inv_locations l on l.id = o.location_id
                      where o.user_id = auth.uid() and o.removed_at is null and l.company_id = p_company_id and l.is_active));
$$;

create or replace function inv_employee_active(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from employees e
                  where e.id = p_employee_id and e.deleted_at is null and e.employment_status in ('active', 'on_leave')
                    and (e.termination_date is null or e.termination_date >= current_date));
$$;

-- Is this HR asset linked to an Inventory unit? Used by the guard triggers; runs with definer rights so the answer does not depend on
-- the editing user's Inventory visibility.
create or replace function inv_asset_is_linked(p_asset_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from inv_units where legacy_asset_id = p_asset_id);
$$;

-- -----------------------------------------------------------------------------
-- 1. Restricted employee lookup (for choosing who equipment is issued or requested for)
-- -----------------------------------------------------------------------------
create or replace function inv_employee_lookup(p_company_id uuid, p_query text)
returns table (employee_id uuid, display_name text, employee_number text, department_name text)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_tokens text[];
begin
  perform inv_require_user();
  if not (inv_is_warehouse_operator(p_company_id) or inv_has_capability(p_company_id, 'request_for_employees')) then
    raise exception 'Only warehouse operators, founders and people who may request equipment for employees can look up employees' using errcode = '42501';
  end if;
  if length(v_q) < 2 then return; end if;
  -- every word must match the name or the employee number; % _ and \ typed by the user are matched literally
  select array_agg(replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_')) into v_tokens
    from unnest(regexp_split_to_array(v_q, '\s+')) t where t <> '';
  return query
    select e.id, btrim(e.first_name || ' ' || e.last_name), e.employee_number, d.name
      from employees e
      left join departments d on d.id = e.department_id and d.deleted_at is null
     where e.company_id = p_company_id
       and e.deleted_at is null and e.employment_status in ('active', 'on_leave')
       and (e.termination_date is null or e.termination_date >= current_date)
       and not exists (select 1 from unnest(v_tokens) t
                        where not ((e.first_name || ' ' || e.last_name) ilike '%' || t || '%' or e.employee_number ilike '%' || t || '%'))
     order by btrim(e.first_name || ' ' || e.last_name), e.employee_number
     limit 20;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. My equipment: what the employee record linked to the signed-in account holds. No capability needed, no costs.
-- -----------------------------------------------------------------------------
create or replace function inv_my_equipment()
returns table (kind text, unit_id uuid, balance_id uuid, code text, item_id uuid, item_name text, serial_number text, qty numeric,
               unit_of_measure text, issued_at timestamptz, expected_return_at timestamptz, condition text, lifecycle text,
               is_overdue boolean, company_id uuid)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform inv_require_user();
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_active) then return; end if;
  return query
    select 'unit'::text, u.id, null::uuid, u.code, u.item_id, i.name, u.serial_number, 1::numeric, i.unit_of_measure,
           coalesce((select m.occurred_at from inv_movement_lines l join inv_movements m on m.id = l.movement_id
                      where l.unit_id = u.id and l.to_kind = 'employee' and l.to_employee_id = u.employee_id
                      order by m.occurred_at desc, m.recorded_at desc limit 1),
                    (select aa.issued_date::timestamptz from asset_assignments aa
                      where aa.asset_id = u.legacy_asset_id and aa.employee_id = u.employee_id and aa.returned_date is null
                      order by aa.issued_date desc, aa.id limit 1)),
           u.expected_return_at, u.condition, u.lifecycle,
           (u.expected_return_at is not null and u.expected_return_at < now()), u.company_id
      from inv_units u join inv_items i on i.id = u.item_id
     where u.custody_kind = 'employee' and u.lifecycle <> 'retired'
       and u.employee_id in (select e.id from employees e where e.user_id = auth.uid() and e.deleted_at is null)
    union all
    select 'quantity'::text, null::uuid, b.id, null::text, b.item_id, i.name, null::text, b.qty, i.unit_of_measure,
           (select m.occurred_at from inv_movement_lines l join inv_movements m on m.id = l.movement_id
             where l.to_balance_id = b.id order by m.occurred_at desc, m.recorded_at desc limit 1),
           b.expected_return_at, b.condition, null::text,
           (b.expected_return_at is not null and b.expected_return_at < now()), b.company_id
      from inv_balances b join inv_items i on i.id = b.item_id
     where b.holder_kind = 'employee' and b.qty > 0
       and b.employee_id in (select e.id from employees e where e.user_id = auth.uid() and e.deleted_at is null)
    order by 6, 4;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. HR / warehouse view: outstanding equipment per employee, including people who have left
-- -----------------------------------------------------------------------------
create or replace function inv_employee_outstanding(p_company_id uuid, p_employee_id uuid default null, p_include_inactive boolean default true)
returns table (employee_id uuid, display_name text, employee_number text, employment_status text, termination_date date,
               is_active boolean, is_removed boolean, holding_kind text, unit_id uuid, balance_id uuid, code text, item_id uuid,
               item_name text, serial_number text, qty numeric, unit_of_measure text, issued_at timestamptz,
               expected_return_at timestamptz, condition text, lifecycle text, is_overdue boolean)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform inv_require_user();
  if not (inv_has_capability(p_company_id, 'view_employee_custody') or inv_is_warehouse_operator(p_company_id)) then
    raise exception 'Only a founder, a warehouse operator or someone given employee-custody access can see what employees hold' using errcode = '42501';
  end if;
  return query
    with held as (
      select u.employee_id as eid, 'unit'::text as hk, u.id as uid, null::uuid as bid, u.code as ucode, u.item_id as iid, u.serial_number as serial,
             1::numeric as q, u.expected_return_at as ret, u.condition as cond, u.lifecycle as life,
             coalesce((select m.occurred_at from inv_movement_lines l join inv_movements m on m.id = l.movement_id
                        where l.unit_id = u.id and l.to_kind = 'employee' and l.to_employee_id = u.employee_id
                        order by m.occurred_at desc, m.recorded_at desc limit 1),
                      (select aa.issued_date::timestamptz from asset_assignments aa
                        where aa.asset_id = u.legacy_asset_id and aa.employee_id = u.employee_id and aa.returned_date is null
                        order by aa.issued_date desc, aa.id limit 1)) as issued
        from inv_units u
       where u.company_id = p_company_id and u.custody_kind = 'employee' and u.lifecycle <> 'retired'
         and (p_employee_id is null or u.employee_id = p_employee_id)
      union all
      select b.employee_id, 'quantity', null::uuid, b.id, null::text, b.item_id, null::text, b.qty, b.expected_return_at, b.condition, null::text,
             (select m.occurred_at from inv_movement_lines l join inv_movements m on m.id = l.movement_id
               where l.to_balance_id = b.id order by m.occurred_at desc, m.recorded_at desc limit 1)
        from inv_balances b
       where b.company_id = p_company_id and b.holder_kind = 'employee' and b.qty > 0
         and (p_employee_id is null or b.employee_id = p_employee_id)
    )
    select e.id, btrim(e.first_name || ' ' || e.last_name), e.employee_number, e.employment_status::text, e.termination_date,
           (e.deleted_at is null and e.employment_status in ('active', 'on_leave') and (e.termination_date is null or e.termination_date >= current_date)),
           (e.deleted_at is not null),
           h.hk, h.uid, h.bid, h.ucode, h.iid, i.name, h.serial, h.q, i.unit_of_measure, h.issued, h.ret, h.cond, h.life,
           (h.ret is not null and h.ret < now())
      from held h
      join employees e on e.id = h.eid
      join inv_items i on i.id = h.iid
     where p_include_inactive
        or (e.deleted_at is null and e.employment_status in ('active', 'on_leave') and (e.termination_date is null or e.termination_date >= current_date))
     order by 6, 2, 3, i.name, h.ucode;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Reassignment: employee <-> project pool (and employee -> employee), always with history
-- -----------------------------------------------------------------------------
create or replace function inv_reassign_unit(p_unit_id uuid, p_to text, p_employee_id uuid, p_reason text, p_key text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_company uuid;
  v_item uuid;
  v_loc uuid;
  v_unit inv_units;
  v_emp employees;
  v_move inv_movements;
  v_kind text;
  v_code text;
  v_move_id uuid;
  v_loc_active boolean;
  v_booking text;
  v_denied constant text := 'Only a founder or a warehouse operator at this location can change who holds equipment';
begin
  perform inv_require_user();
  if p_to is null or p_to not in ('employee', 'pool') then
    raise exception 'Choose where the equipment goes: to an employee or back to the pool' using errcode = '22023';
  end if;
  if p_key is null or length(p_key) not between 8 and 120 then
    raise exception 'The request key must be 8 to 120 characters' using errcode = '22023';
  end if;
  if length(v_reason) = 0 then
    raise exception 'Give a reason for the change' using errcode = '22023';
  end if;
  if p_to = 'employee' and p_employee_id is null then
    raise exception 'Choose the employee' using errcode = '22023';
  end if;
  if p_to = 'pool' and p_employee_id is not null then
    raise exception 'Do not choose an employee when returning equipment to the pool' using errcode = '22023';
  end if;

  select company_id, item_id, location_id into v_company, v_item, v_loc from inv_units where id = p_unit_id;
  -- unknown equipment and equipment you may not touch look the same
  if v_company is null then raise exception '%', v_denied using errcode = '42501'; end if;
  if not (inv_is_founder(v_company)
          or (inv_has_capability(v_company, 'warehouse')
              and (inv_has_capability(v_company, 'cross_location') or (v_loc is not null and inv_can_operate(v_loc))))) then
    raise exception '%', v_denied using errcode = '42501';
  end if;
  perform inv_require_enabled(v_company);

  perform inv_lock_item(v_item);
  perform pg_advisory_xact_lock(hashtextextended('inv_key:' || v_company::text || ':' || p_key, 0));

  -- a retried call with the same key and the same content returns the first result and changes nothing
  select * into v_move from inv_movements where company_id = v_company and idempotency_key = p_key;
  if found then
    if v_move.performed_by = auth.uid() and v_move.kind in ('reassign_employee', 'pool_change')
       and v_move.reason is not distinct from v_reason
       and exists (select 1 from inv_movement_lines l
                    where l.movement_id = v_move.id and l.unit_id = p_unit_id
                      and l.to_employee_id is not distinct from (case when p_to = 'employee' then p_employee_id end)
                      and (l.to_kind = 'employee') = (p_to = 'employee')) then
      return jsonb_build_object('movement_id', v_move.id, 'movement_code', v_move.code, 'unit_id', p_unit_id, 'to', p_to,
                                'employee_id', p_employee_id, 'replayed', true);
    end if;
    raise exception 'That request key was already used for a different request' using errcode = '23505';
  end if;

  select * into v_unit from inv_units where id = p_unit_id for update;
  if v_unit.lifecycle not in ('draft', 'active') then
    raise exception 'Retired or missing equipment cannot be reassigned' using errcode = '23514';
  end if;
  if v_unit.custody_kind not in ('warehouse', 'employee') then
    raise exception 'This unit is not in the warehouse or with an employee (it is out on a project, in transit, in repair or packed in a kit). Bring it back first.' using errcode = '23514';
  end if;

  if p_to = 'employee' then
    select * into v_emp from employees where id = p_employee_id;
    if v_emp.id is null or v_emp.deleted_at is not null then
      raise exception 'Unknown employee' using errcode = '22023';
    end if;
    if v_emp.company_id <> v_company then
      raise exception 'That employee does not belong to the company that owns this equipment' using errcode = '22023';
    end if;
    if not inv_employee_active(p_employee_id) then
      raise exception 'That employee is no longer active, so equipment cannot be assigned to them' using errcode = '23514';
    end if;
    if v_unit.custody_kind = 'employee' and v_unit.employee_id = p_employee_id then
      raise exception 'This unit is already assigned to that employee' using errcode = '23514';
    end if;
    if v_unit.custody_kind = 'warehouse' and v_unit.condition not in ('good', 'fair') then
      raise exception 'Only equipment in good or fair condition can be assigned to an employee. Check and repair it first.' using errcode = '23514';
    end if;
    -- An employee-assigned unit can never be booked for a project, so a live booking would be broken by this change.
    select coalesce(rq.code, 'a request') into v_booking
      from inv_reservations r join inv_request_lines rl on rl.id = r.request_line_id join inv_requests rq on rq.id = rl.request_id
     where r.unit_id = v_unit.id and r.status = 'active' and upper(r.reserved_during) > now()
     order by lower(r.reserved_during) limit 1;
    if found then
      raise exception 'This unit is reserved for % and cannot be assigned to an employee. Release the reservation first.', v_booking using errcode = '23514';
    end if;
    v_kind := 'reassign_employee';
  else
    if v_unit.custody_kind <> 'employee' then
      raise exception 'This unit is already in the warehouse pool' using errcode = '23514';
    end if;
    if v_unit.location_id is null then
      raise exception 'This unit has no recorded storage location. Return it through the warehouse screen instead.' using errcode = '23514';
    end if;
    select is_active into v_loc_active from inv_locations where id = v_unit.location_id;
    if not coalesce(v_loc_active, false) then
      raise exception 'The location this unit belongs to is no longer active' using errcode = '23514';
    end if;
    v_kind := 'pool_change';
  end if;

  v_code := inv_next_code(v_company, 'movement');
  insert into inv_movements (company_id, code, kind, performed_by, recipient_user_id, recipient_employee_id, recipient_name, employee_id,
                             from_location_id, to_location_id, reason, idempotency_key)
  values (v_company, v_code, v_kind, auth.uid(),
          case when p_to = 'employee' then v_emp.user_id end,
          case when p_to = 'employee' then v_emp.id end,
          case when p_to = 'employee' then btrim(v_emp.first_name || ' ' || v_emp.last_name) end,
          case when p_to = 'employee' then v_emp.id else v_unit.employee_id end,
          case when v_unit.custody_kind = 'warehouse' then v_unit.location_id end,
          case when p_to = 'pool' then v_unit.location_id end,
          v_reason, p_key)
  returning id into v_move_id;

  insert into inv_movement_lines (movement_id, company_id, item_id, unit_id, qty, from_kind, to_kind, from_location_id, to_location_id,
                                  from_bin_id, to_bin_id, from_employee_id, to_employee_id, condition_from, condition_to)
  values (v_move_id, v_company, v_unit.item_id, v_unit.id, 1, v_unit.custody_kind, case when p_to = 'employee' then 'employee' else 'warehouse' end,
          case when v_unit.custody_kind = 'warehouse' then v_unit.location_id end,
          case when p_to = 'pool' then v_unit.location_id end,
          case when v_unit.custody_kind = 'warehouse' then v_unit.bin_id end,
          case when p_to = 'pool' then v_unit.bin_id end,
          v_unit.employee_id,
          case when p_to = 'employee' then p_employee_id end,
          v_unit.condition, v_unit.condition);

  -- the location and bin stay as the place the unit left from, so it can come back to the same shelf
  update inv_units
     set custody_kind = case when p_to = 'employee' then 'employee' else 'warehouse' end,
         employee_id = case when p_to = 'employee' then p_employee_id end,
         expected_return_at = null,
         version = version + 1
   where id = v_unit.id;

  perform inv_mirror_legacy(v_unit.id);

  return jsonb_build_object('movement_id', v_move_id, 'movement_code', v_code, 'unit_id', v_unit.id, 'to', p_to,
                            'employee_id', p_employee_id, 'replayed', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Legacy mirror: keep the HR register in step for units that were reconciled from it
-- -----------------------------------------------------------------------------
-- Called by every Inventory function that changes who holds a unit, in the same transaction. For a unit with legacy_asset_id:
--   custody employee            exactly one open asset_assignments row for that employee (inserted when missing; another employee's
--                               open row is closed with the movement's date), assets.status = issued
--   custody warehouse/project/transit/kit   open rows closed, status in_stock
--   custody repair              open rows closed, status under_repair
--   lifecycle retired           open rows closed, status retired
--   lifecycle missing           nothing (the HR register has no "missing"; Inventory keeps the record)
-- The writes run under inv.mirror = 'on' (transaction-local, switched back afterwards) which the guard triggers recognise.
create or replace function inv_mirror_legacy(p_unit_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_unit inv_units;
  v_asset assets;
  v_prev text;
  v_when timestamptz;
  v_by uuid;
  v_tz text;
  v_date date;
  v_status asset_status;
  v_keep uuid;
begin
  select * into v_unit from inv_units where id = p_unit_id;
  if v_unit.id is null or v_unit.legacy_asset_id is null then return; end if;
  if v_unit.lifecycle = 'missing' then return; end if;
  select * into v_asset from assets where id = v_unit.legacy_asset_id for update;
  if v_asset.id is null then return; end if;

  select m.occurred_at, m.performed_by into v_when, v_by
    from inv_movement_lines l join inv_movements m on m.id = l.movement_id
   where l.unit_id = p_unit_id order by m.occurred_at desc, m.recorded_at desc limit 1;
  select timezone into v_tz from inv_locations where id = v_unit.location_id;
  v_date := (coalesce(v_when, now()) at time zone coalesce(v_tz, 'UTC'))::date;

  v_prev := current_setting('inv.mirror', true);
  perform set_config('inv.mirror', 'on', true);

  if v_unit.lifecycle = 'retired' then
    v_status := 'retired';
  elsif v_unit.custody_kind = 'employee' then
    v_status := 'issued';
  elsif v_unit.custody_kind = 'repair' then
    v_status := 'under_repair';
  else
    v_status := 'in_stock';
  end if;

  if v_status = 'issued' then
    update asset_assignments
       set returned_date = greatest(v_date, issued_date), condition_on_return = coalesce(condition_on_return, v_unit.condition)
     where asset_id = v_asset.id and returned_date is null and employee_id <> v_unit.employee_id;
    select id into v_keep from asset_assignments
     where asset_id = v_asset.id and employee_id = v_unit.employee_id and returned_date is null
     order by issued_date, id limit 1;
    if v_keep is null then
      insert into asset_assignments (asset_id, employee_id, issued_date, condition_on_issue, issued_by)
      values (v_asset.id, v_unit.employee_id, v_date, v_unit.condition,
              coalesce(auth.uid(), v_by, v_unit.verified_by, v_unit.created_by, '00000000-0000-0000-0000-000000000000'::uuid));
    else
      update asset_assignments set returned_date = greatest(v_date, issued_date)
       where asset_id = v_asset.id and employee_id = v_unit.employee_id and returned_date is null and id <> v_keep;
    end if;
  else
    update asset_assignments
       set returned_date = greatest(v_date, issued_date), condition_on_return = coalesce(condition_on_return, v_unit.condition)
     where asset_id = v_asset.id and returned_date is null;
  end if;

  if v_asset.status is distinct from v_status then
    update assets set status = v_status where id = v_asset.id;
  end if;

  perform set_config('inv.mirror', coalesce(v_prev, ''), true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Guard triggers on the HR register (the intended change to existing tables)
-- -----------------------------------------------------------------------------
-- Deliberately NOT security definer: current_user must be the editing role, so the flag is honoured only for the Inventory mirror
-- (which runs as the function owner) and never for a browser session (authenticated / anon).
create or replace function inv_legacy_guard()
returns trigger
language plpgsql
as $$
declare
  v_msg constant text := 'This item is managed in Inventory. Use Inventory to issue or return it.';
begin
  if current_setting('inv.mirror', true) = 'on' and current_user not in ('anon', 'authenticated') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'assets' then
    if inv_asset_is_linked(old.id) then raise exception '%', v_msg using errcode = '23514'; end if;
  else
    if tg_op in ('UPDATE', 'DELETE') and inv_asset_is_linked(old.asset_id) then raise exception '%', v_msg using errcode = '23514'; end if;
    if tg_op in ('INSERT', 'UPDATE') and inv_asset_is_linked(new.asset_id) then raise exception '%', v_msg using errcode = '23514'; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists inv_legacy_guard_assets on assets;
create trigger inv_legacy_guard_assets before update or delete on assets
  for each row execute function inv_legacy_guard();
drop trigger if exists inv_legacy_guard_assignments on asset_assignments;
create trigger inv_legacy_guard_assignments before insert or update or delete on asset_assignments
  for each row execute function inv_legacy_guard();

-- -----------------------------------------------------------------------------
-- 7. Legacy reconciliation: preview (read only) and import (founder chooses item and location per asset; nothing is guessed)
-- -----------------------------------------------------------------------------
create or replace function inv_preview_legacy_assets(p_company_id uuid)
returns table (asset_id uuid, asset_tag text, category text, description text, status text, purchase_date date, value numeric,
               open_assignment_count integer, employee_id uuid, employee_name text, employee_number text, employee_active boolean,
               issued_date date, already_linked boolean, unit_id uuid, unit_code text)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_costs boolean;
begin
  perform inv_require_user();
  if not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can review the earlier asset register' using errcode = '42501';
  end if;
  v_costs := inv_has_capability(p_company_id, 'view_costs');
  return query
    select a.id, a.asset_tag, a.category, a.description, a.status::text,
           case when v_costs then a.purchase_date end, case when v_costs then a.value end,
           (select count(*)::integer from asset_assignments x where x.asset_id = a.id and x.returned_date is null),
           oa.employee_id, case when e.id is not null then btrim(e.first_name || ' ' || e.last_name) end, e.employee_number,
           case when e.id is not null then inv_employee_active(e.id) end,
           oa.issued_date, (u.id is not null), u.id, u.code
      from assets a
      left join lateral (select x.employee_id, x.issued_date from asset_assignments x
                          where x.asset_id = a.id and x.returned_date is null order by x.issued_date desc, x.id limit 1) oa on true
      left join employees e on e.id = oa.employee_id
      left join inv_units u on u.legacy_asset_id = a.id
     where a.company_id = p_company_id and a.deleted_at is null
     order by a.asset_tag;
end;
$$;

create or replace function inv_import_legacy_assets(p_company_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_row jsonb;
  v_results jsonb := '[]'::jsonb;
  v_created integer := 0;
  v_skipped integer := 0;
  v_seen uuid[] := '{}';
  v_asset assets;
  v_asset_id uuid;
  v_item inv_items;
  v_loc inv_locations;
  v_unit inv_units;
  v_open asset_assignments;
  v_open_count integer;
  v_costs boolean;
  v_currency text;
  v_reason text;
  v_unit_id uuid;
  v_unit_code text;
  v_notes text;
begin
  perform inv_require_user();
  if not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can import the earlier asset register' using errcode = '42501';
  end if;
  perform inv_require_enabled(p_company_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Choose at least one asset to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Import at most 500 assets at a time' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' or coalesce(v_row->>'asset_id', '') !~ v_uuid or coalesce(v_row->>'item_id', '') !~ v_uuid
       or coalesce(v_row->>'location_id', '') !~ v_uuid then
      raise exception 'Every row needs an asset_id, an item_id and a location_id' using errcode = '22023';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('inv_legacy_import:' || p_company_id::text, 0));
  v_costs := inv_has_capability(p_company_id, 'view_costs');
  select default_currency into v_currency from companies where id = p_company_id;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_asset_id := (v_row->>'asset_id')::uuid;
    v_reason := null; v_unit_id := null; v_unit_code := null;

    if v_asset_id = any (v_seen) then
      v_reason := 'duplicate_in_request';
    else
      v_seen := v_seen || v_asset_id;
      select * into v_asset from assets where id = v_asset_id and company_id = p_company_id and deleted_at is null for update;
      if v_asset.id is null then
        v_reason := 'asset_not_found';
      else
        select * into v_unit from inv_units where legacy_asset_id = v_asset.id;
        if v_unit.id is not null then
          v_reason := 'already_linked'; v_unit_id := v_unit.id; v_unit_code := v_unit.code;
        elsif v_asset.status = 'retired' then
          v_reason := 'retired_asset';
        else
          select * into v_item from inv_items
           where id = (v_row->>'item_id')::uuid and company_id = p_company_id and tracking = 'individual' and status <> 'retired';
          select * into v_loc from inv_locations where id = (v_row->>'location_id')::uuid and company_id = p_company_id and is_active;
          if v_item.id is null then
            v_reason := 'item_not_usable';
          elsif v_loc.id is null then
            v_reason := 'location_not_usable';
          end if;
        end if;
      end if;
    end if;

    if v_reason is null then
      select count(*) into v_open_count from asset_assignments where asset_id = v_asset.id and returned_date is null;
      select * into v_open from asset_assignments where asset_id = v_asset.id and returned_date is null order by issued_date desc, id limit 1;
      v_notes := 'Imported from the HR asset register. Old asset tag: ' || v_asset.asset_tag || ' (' || v_asset.category || ')'
              || case when v_open_count > 1 then '. The HR register showed ' || v_open_count || ' open assignments; the latest was used.' else '' end;
      v_unit_code := inv_next_code(p_company_id, 'unit');
      insert into inv_units (company_id, item_id, code, serial_number, ownership, lifecycle, condition, custody_kind, location_id, employee_id,
                             legacy_asset_id, notes, created_by)
      values (p_company_id, v_item.id, v_unit_code, null, 'owned', 'draft',
              case when v_asset.status = 'under_repair' then 'needs_inspection' else 'good' end,
              case when v_open.id is not null then 'employee' else 'warehouse' end, v_loc.id, v_open.employee_id,
              v_asset.id, v_notes, auth.uid())
      returning id into v_unit_id;
      if v_costs and (v_asset.purchase_date is not null or v_asset.value is not null) then
        insert into inv_costs (company_id, item_id, unit_id, purchase_date, unit_cost, currency, note, entered_by)
        values (p_company_id, v_item.id, v_unit_id, v_asset.purchase_date, v_asset.value,
                case when v_asset.value is not null then v_currency end, 'Copied from the HR asset register', auth.uid());
      end if;
      v_created := v_created + 1;
      v_results := v_results || jsonb_build_object('asset_id', v_asset_id, 'outcome', 'created', 'reason', null, 'unit_id', v_unit_id, 'unit_code', v_unit_code);
    else
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('asset_id', v_asset_id, 'outcome', 'skipped', 'reason', v_reason, 'unit_id', v_unit_id, 'unit_code', v_unit_code);
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'results', v_results);
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  inv_is_warehouse_operator(uuid), inv_employee_active(uuid), inv_asset_is_linked(uuid), inv_legacy_guard(), inv_mirror_legacy(uuid),
  inv_employee_lookup(uuid, text), inv_my_equipment(), inv_employee_outstanding(uuid, uuid, boolean),
  inv_reassign_unit(uuid, text, uuid, text, text), inv_preview_legacy_assets(uuid), inv_import_legacy_assets(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function
  inv_employee_lookup(uuid, text), inv_my_equipment(), inv_employee_outstanding(uuid, uuid, boolean),
  inv_reassign_unit(uuid, text, uuid, text, text), inv_preview_legacy_assets(uuid), inv_import_legacy_assets(uuid, jsonb)
  to authenticated;
-- the guard trigger runs as the editing user and asks this one question
grant execute on function inv_asset_is_linked(uuid) to authenticated;

-- ROLLBACK (only before any asset has been imported; afterwards use the safe-disable script):
--   drop trigger if exists inv_legacy_guard_assignments on asset_assignments;
--   drop trigger if exists inv_legacy_guard_assets on assets;
--   drop function if exists inv_legacy_guard(), inv_import_legacy_assets(uuid, jsonb), inv_preview_legacy_assets(uuid),
--     inv_reassign_unit(uuid, text, uuid, text, text), inv_employee_outstanding(uuid, uuid, boolean), inv_my_equipment(),
--     inv_employee_lookup(uuid, text), inv_asset_is_linked(uuid), inv_employee_active(uuid), inv_is_warehouse_operator(uuid);
--   -- inv_mirror_legacy(uuid) goes back to the no-op body of 20261201000250_inv_shared_helpers.sql (create or replace it again).
