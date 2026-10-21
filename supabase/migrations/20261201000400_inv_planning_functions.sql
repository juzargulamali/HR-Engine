-- Inventory, migration 5 of 6: technology templates, equipment requests, reservations, availability, Sales checks, Projects hooks.
--
-- Prerequisites: migrations 1-3 and the shared helpers (20261201000250). This file reads the tables of those migrations and the shared
-- helpers inv_lock_item, inv_check_qty, inv_local_to_utc, inv_unit_free, inv_qty_free ONLY. It does not call any stock-movement function
-- (migration 4), so it applies and works on its own. Dispatch (migration 4) updates inv_reservations.dispatched_qty / returned_qty;
-- this migration only creates and releases reservations and never touches those two columns.
--
-- CLIENT-FACING FUNCTIONS (all SECURITY DEFINER, search_path = public; 42501 permission, 23514 state, 22023 input, 40001 stale version)
--   templates
--     inv_save_technology(p_company_id uuid, p_technology_id uuid, p_name text, p_description text default null,
--                         p_expected_version integer default null) returns uuid
--     inv_save_technology_components(p_technology_id uuid, p_components jsonb, p_expected_version integer default null) returns integer
--     inv_set_technology_status(p_technology_id uuid, p_status text, p_expected_version integer default null) returns void
--   requests
--     inv_create_request(p_kind text, p_project_id uuid default null, p_employee_id uuid default null, p_title text default null,
--                        p_plan jsonb default null, p_timezone text default null, p_destination text default null,
--                        p_pickup_location_id uuid default null, p_note text default null) returns uuid
--     inv_save_request_plan(p_request_id uuid, p_plan jsonb, p_timezone text default null, p_expected_version integer default null) returns jsonb
--     inv_add_request_line(p_request_id uuid, p_item_id uuid, p_qty numeric, p_note text default null,
--                          p_expected_version integer default null) returns uuid
--     inv_expand_technology(p_request_id uuid, p_technology_id uuid, p_multiplier numeric default 1, p_choices jsonb default '{}') returns jsonb
--     inv_update_request_line(p_line_id uuid, p_qty numeric default null, p_note text default null, p_expected_version integer default null) returns void
--     inv_cancel_request_line(p_line_id uuid, p_reason text default null) returns jsonb
--     inv_submit_request(p_request_id uuid, p_expected_version integer default null) returns void
--     inv_cancel_request(p_request_id uuid, p_reason text default null) returns jsonb
--     inv_propose_substitution(p_line_id uuid, p_item_id uuid, p_note text default null, p_expected_version integer default null) returns void
--     inv_decide_substitution(p_line_id uuid, p_accept boolean, p_note text default null) returns jsonb
--     inv_set_shortage_action(p_line_id uuid, p_action text, p_note text default null, p_rental_reference text default null) returns void
--   reservations
--     inv_reserve(p_line_id uuid, p_location_id uuid, p_unit_ids uuid[] default null, p_qty numeric default null,
--                 p_shortage_action text default null, p_rental_reference text default null) returns jsonb
--     inv_release_reservation(p_reservation_id uuid, p_reason text default null) returns jsonb
--     inv_change_request_window(p_request_id uuid, p_plan jsonb, p_timezone text default null, p_expected_version integer default null) returns jsonb
--   availability
--     inv_availability(p_item_id uuid, p_location_id uuid, p_from timestamptz, p_until timestamptz) returns jsonb
--     inv_technology_availability(p_technology_id uuid, p_qty numeric, p_location_id uuid, p_from timestamptz, p_until timestamptz) returns jsonb
--   Sales
--     inv_request_opportunity_check(p_opportunity_id uuid, p_location_id uuid default null) returns uuid
--     inv_record_opportunity_check(p_opportunity_id uuid, p_location_id uuid default null, p_note text default null) returns uuid
--     inv_opportunity_availability(p_opportunity_id uuid) returns jsonb
--   Projects
--     inv_project_equipment(p_project_id uuid) returns jsonb
--     inv_import_handover_requirements(p_project_id uuid) returns uuid
--   triggers on proj_projects (internal): inv_proj_projects_import (AFTER INSERT, client projects), inv_proj_projects_release (AFTER UPDATE OF status)
--
-- Nothing in this file writes a CRM, Projects or HR table. Winning an opportunity or moving any CRM stage never reserves anything: a
-- reservation exists only because a person called inv_reserve on a request line.

-- =============================================================================
-- Internal helpers
-- =============================================================================
create or replace function inv_user_name(p_user_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) from profiles p where p.id = p_user_id;
$$;

create or replace function inv_check_version(p_current integer, p_expected integer)
returns void
language plpgsql immutable
as $$
begin
  if p_expected is not null and p_expected <> p_current then
    raise exception 'This was changed by someone else. Reload and try again' using errcode = '40001';
  end if;
end;
$$;

-- Locks and returns a request the caller can at least see. Not-visible and not-existing read the same.
create or replace function inv_lock_request(p_request_id uuid)
returns inv_requests
language plpgsql security definer
set search_path = public
as $$
declare r inv_requests;
begin
  perform inv_require_user();
  select * into r from inv_requests where id = p_request_id for update;
  if not found or not inv_can_see_request(r.id) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  return r;
end;
$$;

-- Who may change a request: warehouse staff and founders of the company; for a project request the Project Manager (or acting PM, or
-- project founder) through proj_can_manage; for an employee request the person who made it while they still may.
create or replace function inv_can_edit_request(r inv_requests)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select inv_has_capability(r.company_id, 'warehouse')
      or (r.kind = 'project' and proj_can_manage(r.project_id))
      or (r.kind = 'employee' and r.requested_by = auth.uid()
          and (inv_has_capability(r.company_id, 'request_for_employees') or is_manager_of(r.employee_id)));
$$;

create or replace function inv_require_edit(r inv_requests)
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not inv_can_edit_request(r) then
    raise exception 'You cannot change this request. Only the project manager, the person who made it, or warehouse staff can' using errcode = '42501';
  end if;
end;
$$;

-- Plan dates are LOCAL wall-clock times of the request's IANA zone ("2030-03-30 12:00"), never carrying an offset. Each is converted to a
-- UTC instant with inv_local_to_utc (daylight saving handled in one place). The window is [earliest given, latest given]. A single
-- date gives an incomplete window (from only). expected_return_at is return_due, or dismantle_end when no return date is given.
create or replace function inv_plan_window(p_plan jsonb, p_tz text, out o_plan jsonb, out o_from timestamptz, out o_until timestamptz, out o_return timestamptz)
language plpgsql stable
as $$
declare
  v_keys constant text[] := array['prep_start', 'dispatch', 'install_start', 'show_start', 'show_end', 'dismantle_end', 'return_due', 'inspect_until'];
  k text;
  v text;
  v_local timestamp;
  v_t timestamptz;
  v_dismantle timestamptz;
begin
  if p_plan is null then p_plan := '{}'::jsonb; end if;
  if jsonb_typeof(p_plan) <> 'object' then
    raise exception 'The plan must be a set of named dates' using errcode = '22023';
  end if;
  if not proj_valid_timezone(p_tz) then
    raise exception 'Unknown time zone %', coalesce(p_tz, '(none)') using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_plan) loop
    if not (k = any (v_keys)) then
      raise exception 'Unknown plan date "%". Use: %', k, array_to_string(v_keys, ', ') using errcode = '22023';
    end if;
  end loop;
  o_plan := '{}'::jsonb;
  foreach k in array v_keys loop
    if not (p_plan ? k) or jsonb_typeof(p_plan->k) = 'null' or btrim(coalesce(p_plan->>k, '')) = '' then continue; end if;
    if jsonb_typeof(p_plan->k) <> 'string' then
      raise exception 'The date "%" must be written as YYYY-MM-DD HH:MM', k using errcode = '22023';
    end if;
    v := btrim(p_plan->>k);
    if v !~ '^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$' then
      raise exception 'The date "%" must be local time written as YYYY-MM-DD HH:MM, without a time zone offset', k using errcode = '22023';
    end if;
    begin
      v_local := v::timestamp;
    exception when others then
      raise exception 'The date "%" is not a real date or time', k using errcode = '22023';
    end;
    v_t := inv_local_to_utc(v_local, p_tz);
    o_plan := o_plan || jsonb_build_object(k, to_char(v_local, 'YYYY-MM-DD"T"HH24:MI'));
    if o_from is null or v_t < o_from then o_from := v_t; end if;
    if o_until is null or v_t > o_until then o_until := v_t; end if;
    if k = 'return_due' then o_return := v_t; end if;
    if k = 'dismantle_end' then v_dismantle := v_t; end if;
  end loop;
  if o_return is null then o_return := v_dismantle; end if;
  if o_from is not null and o_from = o_until then o_until := null; o_return := null; end if;
end;
$$;

-- The item the warehouse treats as the requirement: while a substitute is only proposed, the original; afterwards the line's item.
create or replace function inv_effective_item(l inv_request_lines)
returns uuid
language sql immutable
as $$
  select case when l.substitution_status = 'proposed' and l.original_item_id is not null then l.original_item_id else l.item_id end;
$$;

-- Why a unit cannot be reserved for [p_from, p_until) at a location, in plain words; null when it is free. Another project's name is
-- only mentioned to a caller who can see that project.
create or replace function inv_reserve_block_reason(p_unit_id uuid, p_from timestamptz, p_until timestamptz, p_location_id uuid, p_exclude_line uuid default null)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  u inv_units;
  k inv_units;
  t inv_transfers;
  res inv_reservations;
  rq inv_requests;
  v_tz text;
  v_who text := '';
begin
  select * into u from inv_units where id = p_unit_id;
  if not found then return 'Unknown unit'; end if;
  if inv_unit_free(u.id, p_from, p_until, p_location_id, p_exclude_line) then return null; end if;
  select timezone into v_tz from inv_locations where id = p_location_id;
  v_tz := coalesce(v_tz, 'UTC');
  if u.lifecycle = 'draft' then return u.code || ' is still a draft record: it has not been counted and verified, so it cannot be reserved'; end if;
  if u.lifecycle = 'retired' then return u.code || ' is retired'; end if;
  if u.lifecycle = 'missing' then return u.code || ' is recorded as missing'; end if;
  if u.condition = 'needs_inspection' then return u.code || ' is waiting for inspection'; end if;
  if u.condition in ('damaged', 'unserviceable') then return u.code || ' is ' || u.condition || ' and is not available'; end if;
  if u.in_kit_id is not null then
    select * into k from inv_units where id = u.in_kit_id;
    return u.code || ' is packed in kit ' || coalesce(k.code, '?') || '. Reserve the kit, not the part';
  end if;
  if u.custody_kind = 'employee' then return u.code || ' is assigned to an employee and is not available'; end if;
  if u.custody_kind = 'repair' then return u.code || ' is out for repair'; end if;
  if u.custody_kind = 'warehouse' and u.location_id is distinct from p_location_id then return u.code || ' is at a different location'; end if;
  if u.custody_kind = 'project' then
    if u.expected_return_at is null then return u.code || ' is out on a project with no return date'; end if;
    if u.expected_return_at < now() then return u.code || ' is overdue back from a project and is not counted as ready'; end if;
    if u.expected_return_at > p_from then return u.code || ' is out on a project and not expected back before the start of this window'; end if;
    if u.location_id is distinct from p_location_id then return u.code || ' will return to a different location'; end if;
  end if;
  if u.custody_kind = 'transit' then
    select * into t from inv_transfers where id = u.transfer_id;
    if t.expected_at is null then return u.code || ' is in transit with no expected arrival'; end if;
    if t.expected_at < now() then return u.code || ' is overdue in transit and is not counted as ready'; end if;
    if t.expected_at > p_from or t.to_location_id is distinct from p_location_id then return u.code || ' is in transit and will not be here before the start of this window'; end if;
  end if;
  select r.* into res from inv_reservations r
   where r.unit_id = u.id and r.status = 'active' and r.reserved_during && tstzrange(p_from, p_until)
     and (p_exclude_line is null or r.request_line_id <> p_exclude_line)
   order by lower(r.reserved_during) limit 1;
  if found then
    select q.* into rq from inv_request_lines l join inv_requests q on q.id = l.request_id where l.id = res.request_line_id;
    if rq.project_id is not null and proj_can_view_summary(rq.project_id) then
      v_who := ' for ' || (select name from proj_projects where id = rq.project_id);
    end if;
    return format('%s is already reserved from %s to %s (%s)%s', u.code,
                  to_char(lower(res.reserved_during) at time zone v_tz, 'DD Mon YYYY HH24:MI'),
                  to_char(upper(res.reserved_during) at time zone v_tz, 'DD Mon YYYY HH24:MI'), v_tz, v_who);
  end if;
  return u.code || ' is not available for these dates';
end;
$$;

-- How many of an item can be promised for the range at a location: owned units counted one by one (a kit counts once; parts packed in a
-- kit never count by themselves), quantity stock through inv_qty_free.
create or replace function inv_free_count(p_item_id uuid, p_location_id uuid, p_from timestamptz, p_until timestamptz, p_exclude_line uuid default null)
returns numeric
language plpgsql stable security definer
set search_path = public
as $$
declare v_tracking text;
begin
  select tracking into v_tracking from inv_items where id = p_item_id;
  if v_tracking in ('individual', 'kit') then
    return (select count(*) from inv_units u
             where u.item_id = p_item_id and u.ownership = 'owned' and inv_unit_free(u.id, p_from, p_until, p_location_id, p_exclude_line));
  end if;
  return inv_qty_free(p_item_id, p_location_id, p_from, p_until, p_exclude_line, false);
end;
$$;

-- =============================================================================
-- Technology templates: recipes, never stock
-- =============================================================================
create or replace function inv_save_technology(
  p_company_id uuid,
  p_technology_id uuid,
  p_name text,
  p_description text default null,
  p_expected_version integer default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  t inv_technologies;
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  perform inv_require_user();
  if not inv_has_capability(p_company_id, 'manage_catalogue') then
    raise exception 'Only catalogue managers can create or change technology templates' using errcode = '42501';
  end if;
  perform inv_require_enabled(p_company_id);
  if length(v_name) not between 1 and 160 then
    raise exception 'Give the technology a name (up to 160 characters)' using errcode = '22023';
  end if;
  if p_technology_id is null then
    insert into inv_technologies (company_id, name, description, created_by)
    values (p_company_id, v_name, nullif(btrim(p_description), ''), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  select * into t from inv_technologies where id = p_technology_id and company_id = p_company_id for update;
  if not found then raise exception 'Technology not found' using errcode = 'P0002'; end if;
  perform inv_check_version(t.version, p_expected_version);
  if t.status = 'retired' then raise exception 'A retired template cannot be edited' using errcode = '23514'; end if;
  update inv_technologies set name = v_name, description = nullif(btrim(p_description), ''), version = version + 1, updated_at = now()
   where id = t.id;
  return t.id;
exception when unique_violation then
  raise exception 'A technology called "%" already exists', v_name using errcode = '23505';
end;
$$;

-- Replaces the whole component list. Every element: {item_id, qty, alt_group?, is_optional?, note?, sort_order?}. Components with the same
-- alt_group are alternatives to each other (the first by sort order is the standard choice). Never edits request lines: lines hold their
-- own snapshot.
create or replace function inv_save_technology_components(p_technology_id uuid, p_components jsonb, p_expected_version integer default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  t inv_technologies;
  e jsonb;
  n integer := 0;
  v_item inv_items;
  v_qty numeric;
  v_group text;
  v_opt boolean;
  v_seen uuid[] := '{}';
  v_groups jsonb := '{}'::jsonb;
begin
  perform inv_require_user();
  select * into t from inv_technologies where id = p_technology_id for update;
  if not found or not inv_can_browse(t.company_id) then raise exception 'Technology not found' using errcode = 'P0002'; end if;
  if not inv_has_capability(t.company_id, 'manage_catalogue') then
    raise exception 'Only catalogue managers can change technology templates' using errcode = '42501';
  end if;
  perform inv_require_enabled(t.company_id);
  perform inv_check_version(t.version, p_expected_version);
  if t.status = 'retired' then raise exception 'A retired template cannot be edited' using errcode = '23514'; end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' then
    raise exception 'The components must be a list' using errcode = '22023';
  end if;

  delete from inv_technology_components where technology_id = t.id;
  for e in select * from jsonb_array_elements(p_components) loop
    n := n + 1;
    if jsonb_typeof(e) <> 'object' then raise exception 'Each component needs an item and a quantity' using errcode = '22023'; end if;
    select * into v_item from inv_items where id = nullif(e->>'item_id', '')::uuid and company_id = t.company_id;
    if not found then raise exception 'Component % uses an item that does not exist in this company', n using errcode = '22023'; end if;
    if v_item.status = 'retired' then raise exception '% is retired and cannot be part of a template', v_item.name using errcode = '23514'; end if;
    if v_item.id = any (v_seen) then
      raise exception '% appears twice. List an item once, and use an alternative group for look-alikes', v_item.name using errcode = '22023';
    end if;
    v_seen := v_seen || v_item.id;
    v_qty := inv_check_qty(v_item.id, (e->>'qty')::numeric);
    v_group := nullif(btrim(e->>'alt_group'), '');
    if v_group is not null and length(v_group) > 60 then raise exception 'An alternative group name is at most 60 characters' using errcode = '22023'; end if;
    v_opt := coalesce((e->>'is_optional')::boolean, false);
    if v_group is not null then
      if v_groups ? v_group and (v_groups->>v_group)::boolean <> v_opt then
        raise exception 'All alternatives in group "%" must be required, or all optional', v_group using errcode = '22023';
      end if;
      v_groups := v_groups || jsonb_build_object(v_group, v_opt);
    end if;
    insert into inv_technology_components (technology_id, company_id, item_id, qty, alt_group, is_optional, note, sort_order)
    values (t.id, t.company_id, v_item.id, v_qty, v_group, v_opt, nullif(btrim(e->>'note'), ''), coalesce((e->>'sort_order')::integer, n * 10));
  end loop;
  if t.status = 'complete' and not exists (select 1 from inv_technology_components where technology_id = t.id and not is_optional) then
    raise exception 'A complete template needs at least one required component. Set it back to draft first' using errcode = '23514';
  end if;
  update inv_technologies set version = version + 1, updated_at = now() where id = t.id returning version into n;
  return n;
end;
$$;

create or replace function inv_set_technology_status(p_technology_id uuid, p_status text, p_expected_version integer default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare t inv_technologies;
begin
  perform inv_require_user();
  select * into t from inv_technologies where id = p_technology_id for update;
  if not found or not inv_can_browse(t.company_id) then raise exception 'Technology not found' using errcode = 'P0002'; end if;
  if not inv_has_capability(t.company_id, 'manage_catalogue') then
    raise exception 'Only catalogue managers can change technology templates' using errcode = '42501';
  end if;
  perform inv_require_enabled(t.company_id);
  perform inv_check_version(t.version, p_expected_version);
  if p_status not in ('draft', 'complete', 'retired') then
    raise exception 'The status must be draft, complete or retired' using errcode = '22023';
  end if;
  if t.status = p_status then return; end if;
  if p_status = 'complete' then
    if not exists (select 1 from inv_technology_components where technology_id = t.id and not is_optional) then
      raise exception 'A complete template needs at least one required component' using errcode = '23514';
    end if;
    if exists (select 1 from inv_technology_components c join inv_items i on i.id = c.item_id where c.technology_id = t.id and i.status = 'retired') then
      raise exception 'A component of this template is a retired item. Replace it first' using errcode = '23514';
    end if;
  end if;
  update inv_technologies set status = p_status, updated_at = now() where id = t.id;
exception when unique_violation then
  raise exception 'Another active technology already uses the name "%"', t.name using errcode = '23505';
end;
$$;

-- =============================================================================
-- Requests
-- =============================================================================
create or replace function inv_create_request(
  p_kind text,
  p_project_id uuid default null,
  p_employee_id uuid default null,
  p_title text default null,
  p_plan jsonb default null,
  p_timezone text default null,
  p_destination text default null,
  p_pickup_location_id uuid default null,
  p_note text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_tz text;
  pr proj_projects;
  emp employees;
  v_loc_tz text;
  w record;
  v_id uuid;
begin
  perform inv_require_user();
  if p_kind not in ('project', 'employee') then raise exception 'A request is for a project or for an employee' using errcode = '22023'; end if;
  if p_kind = 'project' then
    if p_employee_id is not null then raise exception 'A project request has no employee' using errcode = '22023'; end if;
    select * into pr from proj_projects where id = p_project_id;
    if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
    v_company := pr.company_id;
    if not (proj_can_manage(pr.id) or inv_has_capability(v_company, 'warehouse')) then
      raise exception 'Only the project manager, an acting project manager or warehouse staff can request equipment for this project' using errcode = '42501';
    end if;
    if pr.status in ('completed', 'archived') then
      raise exception 'A completed or archived project cannot get new equipment requests' using errcode = '23514';
    end if;
    select site_timezone into v_tz from proj_project_details where project_id = pr.id;
  else
    if p_project_id is not null then raise exception 'An employee request has no project' using errcode = '22023'; end if;
    select * into emp from employees where id = p_employee_id and deleted_at is null;
    if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
    v_company := emp.company_id;
    if not (inv_has_capability(v_company, 'request_for_employees')
            or (is_manager_of(emp.id) and exists (select 1 from employees me where me.id = current_employee_id() and me.company_id = emp.company_id))) then
      raise exception 'Only department heads with that right, or the employee''s manager, can request equipment for an employee' using errcode = '42501';
    end if;
    if emp.employment_status <> 'active' then
      raise exception 'Equipment can only be requested for an active employee' using errcode = '23514';
    end if;
  end if;
  perform inv_require_enabled(v_company);
  if p_pickup_location_id is not null then
    select timezone into v_loc_tz from inv_locations where id = p_pickup_location_id and company_id = v_company and is_active;
    if not found then raise exception 'Pickup location not found' using errcode = '22023'; end if;
  end if;
  v_tz := coalesce(nullif(btrim(p_timezone), ''), v_tz, v_loc_tz);
  if v_tz is null then raise exception 'Choose the time zone of the dates, or a pickup location' using errcode = '22023'; end if;
  select * into w from inv_plan_window(p_plan, v_tz);
  insert into inv_requests (company_id, code, kind, project_id, employee_id, requested_by, title, destination, pickup_location_id, timezone,
                            plan, needed_from, needed_until, expected_return_at, note)
  values (v_company, inv_next_code(v_company, 'request'), p_kind, p_project_id, p_employee_id, auth.uid(), nullif(btrim(p_title), ''),
          nullif(btrim(p_destination), ''), p_pickup_location_id, v_tz, w.o_plan, w.o_from, w.o_until, w.o_return, nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Planning dates while nothing is reserved. Once reservations exist the dates move through inv_change_request_window.
create or replace function inv_save_request_plan(p_request_id uuid, p_plan jsonb, p_timezone text default null, p_expected_version integer default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  w record;
  v_tz text;
  v_version integer;
begin
  r := inv_lock_request(p_request_id);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  perform inv_check_version(r.version, p_expected_version);
  if r.status not in ('draft', 'submitted', 'in_progress') then
    raise exception 'A % request can no longer be changed', r.status using errcode = '23514';
  end if;
  if exists (select 1 from inv_reservations x join inv_request_lines l on l.id = x.request_line_id where l.request_id = r.id and x.status = 'active') then
    raise exception 'Equipment is already reserved for this request. Change its dates with the date-change action, which rechecks every reservation' using errcode = '23514';
  end if;
  v_tz := coalesce(nullif(btrim(p_timezone), ''), r.timezone);
  select * into w from inv_plan_window(p_plan, v_tz);
  update inv_requests set plan = w.o_plan, needed_from = w.o_from, needed_until = w.o_until, expected_return_at = w.o_return,
         timezone = v_tz, version = version + 1
   where id = r.id returning version into v_version;
  return jsonb_build_object('request_id', r.id, 'version', v_version, 'timezone', v_tz, 'plan', w.o_plan,
                            'needed_from', w.o_from, 'needed_until', w.o_until, 'expected_return_at', w.o_return);
end;
$$;

create or replace function inv_add_request_line(p_request_id uuid, p_item_id uuid, p_qty numeric, p_note text default null, p_expected_version integer default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  v_item inv_items;
  v_id uuid;
begin
  r := inv_lock_request(p_request_id);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  perform inv_check_version(r.version, p_expected_version);
  if r.status not in ('draft', 'submitted', 'in_progress') then
    raise exception 'A % request can no longer be changed', r.status using errcode = '23514';
  end if;
  select * into v_item from inv_items where id = p_item_id and company_id = r.company_id;
  if not found then raise exception 'Unknown item' using errcode = '22023'; end if;
  if v_item.status = 'retired' then raise exception '% is retired and cannot be requested', v_item.name using errcode = '23514'; end if;
  perform inv_check_qty(v_item.id, p_qty);
  insert into inv_request_lines (request_id, company_id, item_id, qty, note, sort_order)
  values (r.id, r.company_id, v_item.id, p_qty, nullif(btrim(p_note), ''),
          (select coalesce(max(sort_order), 0) + 10 from inv_request_lines where request_id = r.id))
  returning id into v_id;
  return v_id;
end;
$$;

-- Copies a technology's components x multiplier into the request as request lines (a SNAPSHOT: later template edits never reach them).
-- Returns the created line ids and, per alternative group, the alternatives that were only offered.
create or replace function inv_expand_into_request(r inv_requests, p_technology_id uuid, p_multiplier numeric, p_choices jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  t inv_technologies;
  g record;
  c inv_technology_components;
  v_std inv_technology_components;
  v_chosen inv_technology_components;
  v_item inv_items;
  v_std_item inv_items;
  v_ids uuid[];
  v_lines uuid[] := '{}';
  v_offered jsonb := '[]'::jsonb;
  v_alts jsonb;
  v_choice text;
  v_line uuid;
  v_sort integer;
begin
  select * into t from inv_technologies where id = p_technology_id and company_id = r.company_id;
  if not found then raise exception 'Technology not found' using errcode = 'P0002'; end if;
  if t.status <> 'complete' then
    raise exception 'Only a complete template can be added to a request. "%" is %', t.name, t.status using errcode = '23514';
  end if;
  if not exists (select 1 from inv_technology_components where technology_id = t.id and not is_optional) then
    raise exception 'The template "%" has no required component', t.name using errcode = '23514';
  end if;
  if p_multiplier is null or p_multiplier <= 0 then raise exception 'The quantity of the technology must be more than zero' using errcode = '22023'; end if;
  if p_choices is null then p_choices := '{}'::jsonb; end if;
  if jsonb_typeof(p_choices) <> 'object' then raise exception 'The alternative choices must be {group: item}' using errcode = '22023'; end if;
  for v_choice in select jsonb_object_keys(p_choices) loop
    if not exists (select 1 from inv_technology_components where technology_id = t.id and alt_group = v_choice) then
      raise exception 'The template "%" has no alternative group "%"', t.name, v_choice using errcode = '22023';
    end if;
  end loop;
  select coalesce(max(sort_order), 0) into v_sort from inv_request_lines where request_id = r.id;

  for g in
    select coalesce(x.alt_group, 'component:' || x.id::text) as slot, min(x.alt_group) as alt_group,
           array_agg(x.id order by x.sort_order, x.id) as ids, min(x.sort_order) as first_sort
      from inv_technology_components x where x.technology_id = t.id
     group by coalesce(x.alt_group, 'component:' || x.id::text)
     order by min(x.sort_order), 1
  loop
    v_ids := g.ids;
    select * into v_std from inv_technology_components where id = v_ids[1];
    v_chosen := v_std;
    if g.alt_group is not null and p_choices ? g.alt_group then
      select * into v_chosen from inv_technology_components
       where technology_id = t.id and alt_group = g.alt_group and item_id = nullif(p_choices->>g.alt_group, '')::uuid;
      if not found then
        raise exception 'The item chosen for group "%" is not one of its alternatives in the template', g.alt_group using errcode = '22023';
      end if;
    end if;
    select * into v_item from inv_items where id = v_chosen.item_id;
    select * into v_std_item from inv_items where id = v_std.item_id;
    if v_item.status = 'retired' then
      raise exception '% is retired. Edit the template "%" first', v_item.name, t.name using errcode = '23514';
    end if;
    perform inv_check_qty(v_item.id, v_chosen.qty * p_multiplier);
    select coalesce(jsonb_agg(jsonb_build_object('item_id', a.item_id, 'item_name', ai.name, 'qty', a.qty) order by a.sort_order, a.id), '[]'::jsonb)
      into v_alts
      from inv_technology_components a join inv_items ai on ai.id = a.item_id
     where a.technology_id = t.id and a.alt_group is not null and a.alt_group = g.alt_group and a.id <> v_chosen.id;
    v_sort := v_sort + 10;
    insert into inv_request_lines (request_id, company_id, item_id, qty, technology_id, technology_snapshot, alt_group, is_optional,
                                   original_item_id, substitution_status, note, sort_order)
    values (r.id, r.company_id, v_item.id, v_chosen.qty * p_multiplier, t.id,
            jsonb_build_object('technology_id', t.id, 'name', t.name, 'version', t.version, 'multiplier', p_multiplier, 'expanded_at', now(),
              'component', jsonb_build_object('item_id', v_item.id, 'item_name', v_item.name, 'qty', v_chosen.qty, 'note', v_chosen.note,
                                              'is_optional', v_chosen.is_optional, 'alt_group', v_chosen.alt_group),
              'standard_item_id', v_std.item_id, 'standard_qty', v_std.qty, 'alternatives', v_alts),
            v_chosen.alt_group, v_chosen.is_optional,
            case when v_chosen.id <> v_std.id then v_std.item_id end,
            case when v_chosen.id <> v_std.id then 'proposed' else 'none' end,
            v_chosen.note, v_sort)
    returning id into v_line;
    v_lines := v_lines || v_line;
    if g.alt_group is not null then
      v_offered := v_offered || jsonb_build_object('alt_group', g.alt_group, 'line_id', v_line, 'chosen_item_id', v_item.id,
                     'standard_item_id', v_std.item_id, 'standard_item_name', v_std_item.name, 'alternatives', v_alts);
    end if;
  end loop;
  return jsonb_build_object('request_id', r.id, 'technology_id', t.id, 'technology_version', t.version, 'line_ids', to_jsonb(v_lines),
                            'offered_alternatives', v_offered);
end;
$$;

create or replace function inv_expand_technology(p_request_id uuid, p_technology_id uuid, p_multiplier numeric default 1, p_choices jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare r inv_requests;
begin
  r := inv_lock_request(p_request_id);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  if r.status not in ('draft', 'submitted', 'in_progress') then
    raise exception 'A % request can no longer be changed', r.status using errcode = '23514';
  end if;
  return inv_expand_into_request(r, p_technology_id, p_multiplier, p_choices);
end;
$$;

create or replace function inv_update_request_line(p_line_id uuid, p_qty numeric default null, p_note text default null, p_expected_version integer default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  l inv_request_lines;
  v_req uuid;
  v_reserved numeric;
begin
  select request_id into v_req from inv_request_lines where id = p_line_id;
  if not found then raise exception 'Request line not found' using errcode = 'P0002'; end if;
  r := inv_lock_request(v_req);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  select * into l from inv_request_lines where id = p_line_id for update;
  perform inv_check_version(l.version, p_expected_version);
  if r.status not in ('draft', 'submitted', 'in_progress') then
    raise exception 'A % request can no longer be changed', r.status using errcode = '23514';
  end if;
  if l.status <> 'open' then raise exception 'This line is %, so it cannot be changed', l.status using errcode = '23514'; end if;
  if p_qty is not null then
    perform inv_check_qty(l.item_id, p_qty);
    select coalesce(sum(qty), 0) into v_reserved from inv_reservations where request_line_id = l.id and status in ('active', 'completed');
    if p_qty < v_reserved then
      raise exception 'This line already has % reserved. Release some of it before asking for less', trim_scale(v_reserved) using errcode = '23514';
    end if;
  end if;
  update inv_request_lines set qty = coalesce(p_qty, qty), note = case when p_note is not null then nullif(btrim(p_note), '') else note end,
         version = version + 1
   where id = l.id;
end;
$$;

-- Releases the UNUSED part of one reservation (nothing dispatched). A reservation with equipment already out keeps exactly the
-- dispatched quantity; the unused rest is kept in history as a released row. Returns the quantity released.
create or replace function inv_release_row(res inv_reservations, p_reason text)
returns numeric
language plpgsql security definer
set search_path = public
as $$
declare v_rest numeric;
begin
  if res.status <> 'active' then return 0; end if;
  if res.dispatched_qty = 0 then
    update inv_reservations set status = 'released', released_at = now(), released_reason = p_reason where id = res.id;
    return res.qty;
  end if;
  if res.dispatched_qty < res.qty then
    v_rest := res.qty - res.dispatched_qty;
    insert into inv_reservations (company_id, request_line_id, item_id, unit_id, location_id, qty, reserved_during, status, released_reason,
                                  made_by, made_at, released_at)
    values (res.company_id, res.request_line_id, res.item_id, res.unit_id, res.location_id, v_rest, res.reserved_during, 'released', p_reason,
            res.made_by, res.made_at, now());
    update inv_reservations set qty = res.dispatched_qty where id = res.id;
    return v_rest;
  end if;
  return 0;
end;
$$;

-- Releases every unused reservation of a line; equipment that is already out stays outstanding (nothing is returned on paper).
create or replace function inv_release_unused(p_line_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  res inv_reservations;
  v_released numeric := 0;
  v_count integer := 0;
  v_q numeric;
begin
  for res in select * from inv_reservations where request_line_id = p_line_id and status = 'active' order by made_at, id for update loop
    v_q := inv_release_row(res, p_reason);
    if v_q > 0 then v_released := v_released + v_q; v_count := v_count + 1; end if;
  end loop;
  return jsonb_build_object('released_qty', v_released, 'released_reservations', v_count,
    'outstanding_qty', (select coalesce(sum(dispatched_qty - returned_qty), 0) from inv_reservations where request_line_id = p_line_id and status = 'active'));
end;
$$;

create or replace function inv_cancel_request_line(p_line_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  l inv_request_lines;
  v_req uuid;
  v_rel jsonb;
begin
  select request_id into v_req from inv_request_lines where id = p_line_id;
  if not found then raise exception 'Request line not found' using errcode = 'P0002'; end if;
  r := inv_lock_request(v_req);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  select * into l from inv_request_lines where id = p_line_id for update;
  if l.status = 'cancelled' then
    return jsonb_build_object('line_id', l.id, 'status', 'cancelled', 'released_qty', 0, 'outstanding_qty',
      (select coalesce(sum(dispatched_qty - returned_qty), 0) from inv_reservations where request_line_id = l.id and status = 'active'));
  end if;
  if r.status in ('cancelled', 'closed') then raise exception 'A % request can no longer be changed', r.status using errcode = '23514'; end if;
  if l.status <> 'open' then raise exception 'This line is %, so it cannot be cancelled', l.status using errcode = '23514'; end if;
  v_rel := inv_release_unused(l.id, coalesce(nullif(btrim(p_reason), ''), 'Line cancelled'));
  update inv_request_lines set status = 'cancelled', version = version + 1 where id = l.id;
  perform inv_refresh_request_status(l.request_id);
  return v_rel || jsonb_build_object('line_id', l.id, 'status', 'cancelled');
end;
$$;

create or replace function inv_submit_request(p_request_id uuid, p_expected_version integer default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare r inv_requests;
begin
  r := inv_lock_request(p_request_id);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  if r.status in ('submitted', 'in_progress', 'fulfilled') then return; end if;     -- repeated click
  if r.status <> 'draft' then raise exception 'A % request cannot be submitted', r.status using errcode = '23514'; end if;
  perform inv_check_version(r.version, p_expected_version);
  if not exists (select 1 from inv_request_lines where request_id = r.id and status = 'open') then
    raise exception 'Add at least one item before submitting' using errcode = '23514';
  end if;
  if r.needed_from is null or r.needed_until is null then
    raise exception 'Set the planning dates (at least a start and an end) before submitting' using errcode = '23514';
  end if;
  if r.needed_until <= now() then raise exception 'The planning dates are already in the past' using errcode = '23514'; end if;
  update inv_requests set status = 'submitted', submitted_at = now(), version = version + 1 where id = r.id;
end;
$$;

-- Cancels a request and every open line: unused reservations are released, equipment already out stays outstanding.
create or replace function inv_cancel_request_internal(p_request_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l record;
  v_rel jsonb;
  v_released numeric := 0;
  v_outstanding numeric := 0;
begin
  for l in select id from inv_request_lines where request_id = p_request_id order by sort_order, id for update loop
    v_rel := inv_release_unused(l.id, p_reason);
    v_released := v_released + (v_rel->>'released_qty')::numeric;
    v_outstanding := v_outstanding + (v_rel->>'outstanding_qty')::numeric;
    update inv_request_lines set status = 'cancelled', version = version + 1 where id = l.id and status = 'open';
  end loop;
  update inv_requests set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, version = version + 1
   where id = p_request_id and status <> 'cancelled';
  return jsonb_build_object('request_id', p_request_id, 'status', 'cancelled', 'released_qty', v_released, 'outstanding_qty', v_outstanding);
end;
$$;

create or replace function inv_cancel_request(p_request_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  v_reason text := nullif(btrim(p_reason), '');
begin
  r := inv_lock_request(p_request_id);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  if r.status = 'cancelled' then
    return jsonb_build_object('request_id', r.id, 'status', 'cancelled', 'released_qty', 0, 'outstanding_qty',
      (select coalesce(sum(x.dispatched_qty - x.returned_qty), 0) from inv_reservations x join inv_request_lines l on l.id = x.request_line_id
        where l.request_id = r.id and x.status = 'active'));
  end if;
  if r.status in ('fulfilled', 'closed') then
    raise exception 'A % request cannot be cancelled', r.status using errcode = '23514';
  end if;
  if r.status in ('submitted', 'in_progress') and v_reason is null then
    raise exception 'Say why the request is cancelled' using errcode = '22023';
  end if;
  return inv_cancel_request_internal(r.id, coalesce(v_reason, 'Request cancelled'));
end;
$$;

-- -----------------------------------------------------------------------------
-- Substitutions: only alternatives written into the template are offered, and the warehouse treats the ORIGINAL as the requirement until
-- an authorised project person accepts. The warehouse operator can propose, never decide.
-- -----------------------------------------------------------------------------
create or replace function inv_propose_substitution(p_line_id uuid, p_item_id uuid, p_note text default null, p_expected_version integer default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  l inv_request_lines;
  v_req uuid;
  v_std uuid;
  v_new inv_items;
  v_mult numeric;
  v_qty numeric;
begin
  select request_id into v_req from inv_request_lines where id = p_line_id;
  if not found then raise exception 'Request line not found' using errcode = 'P0002'; end if;
  r := inv_lock_request(v_req);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  select * into l from inv_request_lines where id = p_line_id for update;
  perform inv_check_version(l.version, p_expected_version);
  if r.status not in ('draft', 'submitted', 'in_progress') then raise exception 'A % request can no longer be changed', r.status using errcode = '23514'; end if;
  if l.status <> 'open' then raise exception 'This line is %, so it cannot be changed', l.status using errcode = '23514'; end if;
  if l.technology_id is null or l.alt_group is null or l.technology_snapshot is null then
    raise exception 'Only alternatives written into the technology template can be offered. This line has none' using errcode = '23514';
  end if;
  v_std := (l.technology_snapshot->>'standard_item_id')::uuid;
  if p_item_id is distinct from v_std and not exists (
       select 1 from jsonb_array_elements(l.technology_snapshot->'alternatives') a where (a->>'item_id')::uuid = p_item_id) then
    raise exception 'That item is not an alternative listed in the template for this line. Technically different models are never assumed interchangeable' using errcode = '23514';
  end if;
  if exists (select 1 from inv_reservations where request_line_id = l.id and status = 'active') then
    raise exception 'Release the reservations of this line before changing its item' using errcode = '23514';
  end if;
  select * into v_new from inv_items where id = p_item_id and company_id = r.company_id;
  if not found then raise exception 'Unknown item' using errcode = '22023'; end if;
  if v_new.status = 'retired' then raise exception '% is retired', v_new.name using errcode = '23514'; end if;
  v_mult := coalesce((l.technology_snapshot->>'multiplier')::numeric, 1);
  if p_item_id = v_std then
    v_qty := coalesce((l.technology_snapshot->>'standard_qty')::numeric * v_mult, l.qty);
    perform inv_check_qty(v_std, v_qty);
    update inv_request_lines set item_id = v_std, original_item_id = null, substitution_status = 'none', substitution_by = null,
           substitution_at = null, substitution_note = nullif(btrim(p_note), ''), qty = v_qty, version = version + 1 where id = l.id;
  else
    select (a->>'qty')::numeric * v_mult into v_qty from jsonb_array_elements(l.technology_snapshot->'alternatives') a where (a->>'item_id')::uuid = p_item_id;
    perform inv_check_qty(p_item_id, v_qty);
    update inv_request_lines set item_id = p_item_id, original_item_id = v_std, substitution_status = 'proposed', substitution_by = null,
           substitution_at = null, substitution_note = nullif(btrim(p_note), ''), qty = v_qty, version = version + 1
     where id = l.id;
  end if;
end;
$$;

create or replace function inv_decide_substitution(p_line_id uuid, p_accept boolean, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  l inv_request_lines;
  v_req uuid;
  v_rel jsonb := jsonb_build_object('released_qty', 0);
  v_qty numeric;
begin
  select request_id into v_req from inv_request_lines where id = p_line_id;
  if not found then raise exception 'Request line not found' using errcode = 'P0002'; end if;
  r := inv_lock_request(v_req);
  if not ((r.kind = 'project' and proj_can_manage(r.project_id))
          or (r.kind = 'employee' and (r.requested_by = auth.uid() or is_manager_of(r.employee_id)))) then
    raise exception 'Only the project manager (or whoever is accountable for the request) can accept or decline a substitute. The warehouse cannot decide it alone' using errcode = '42501';
  end if;
  perform inv_require_enabled(r.company_id);
  select * into l from inv_request_lines where id = p_line_id for update;
  if p_accept is null then raise exception 'Accept or decline' using errcode = '22023'; end if;
  if l.substitution_status <> 'proposed' then
    raise exception 'This line has no substitute waiting for a decision' using errcode = '23514';
  end if;
  if p_accept then
    if exists (select 1 from inv_reservations where request_line_id = l.id and status = 'active' and dispatched_qty > 0) then
      raise exception 'The original item is already out on the project, so the substitute cannot be accepted for this line' using errcode = '23514';
    end if;
    v_rel := inv_release_unused(l.id, 'Substitute accepted: the line now needs a different item');
    update inv_request_lines set substitution_status = 'accepted', substitution_by = auth.uid(), substitution_at = now(),
           substitution_note = coalesce(nullif(btrim(p_note), ''), substitution_note), version = version + 1 where id = l.id;
  else
    v_qty := coalesce((l.technology_snapshot->>'standard_qty')::numeric * coalesce((l.technology_snapshot->>'multiplier')::numeric, 1), l.qty);
    update inv_request_lines set item_id = l.original_item_id, substitution_status = 'declined', substitution_by = auth.uid(), substitution_at = now(),
           substitution_note = coalesce(nullif(btrim(p_note), ''), substitution_note), qty = v_qty, version = version + 1
     where id = l.id;
  end if;
  return jsonb_build_object('line_id', l.id, 'substitution_status', case when p_accept then 'accepted' else 'declined' end) || v_rel;
end;
$$;

create or replace function inv_set_shortage_action(p_line_id uuid, p_action text, p_note text default null, p_rental_reference text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  v_req uuid;
  v_ref text := nullif(btrim(p_rental_reference), '');
begin
  select request_id into v_req from inv_request_lines where id = p_line_id;
  if not found then raise exception 'Request line not found' using errcode = 'P0002'; end if;
  r := inv_lock_request(v_req);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  if p_action not in ('none', 'need_to_buy', 'need_to_rent') then
    raise exception 'The shortage action must be none, need_to_buy or need_to_rent' using errcode = '22023';
  end if;
  if v_ref is not null and p_action <> 'need_to_rent' then
    raise exception 'A rental reference only belongs to a need to rent' using errcode = '22023';
  end if;
  if v_ref is not null and length(v_ref) > 160 then raise exception 'The rental reference is at most 160 characters' using errcode = '22023'; end if;
  update inv_request_lines set shortage_action = p_action, shortage_note = case when p_action = 'none' then null else nullif(btrim(p_note), '') end,
         rental_reference = case when p_action = 'need_to_rent' then v_ref end, version = version + 1
   where id = p_line_id;
end;
$$;

-- =============================================================================
-- Reservations
-- =============================================================================
-- Reserves for a request line from one location, for the request's window. Individual equipment: pass the units you want (all or nothing)
-- or a quantity to let the system pick free units (what is free is reserved, the rest is reported). Quantity stock: pass a quantity.
-- Units go through inv_unit_free + the exclusion constraint; quantities through inv_lock_item + inv_qty_free, so simultaneous callers can
-- never oversell. The caller must be able to operate the location (a warehouse operator assigned to it, or a founder).
create or replace function inv_reserve(
  p_line_id uuid,
  p_location_id uuid,
  p_unit_ids uuid[] default null,
  p_qty numeric default null,
  p_shortage_action text default null,
  p_rental_reference text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  l inv_request_lines;
  loc inv_locations;
  v_item inv_items;
  v_item_id uuid;
  v_req uuid;
  v_unit inv_units;
  v_uid uuid;
  v_ids uuid[];
  v_reason text;
  v_rid uuid;
  v_taken numeric;
  v_remaining numeric;
  v_ask numeric;
  v_free numeric;
  v_now numeric := 0;
  v_short numeric;
  v_still numeric;
  v_made jsonb := '[]'::jsonb;
  v_action text;
  v_ref text;
  v_range tstzrange;
begin
  perform inv_require_user();
  select request_id into v_req from inv_request_lines where id = p_line_id;
  if not found then raise exception 'Request line not found' using errcode = 'P0002'; end if;
  r := inv_lock_request(v_req);
  select * into l from inv_request_lines where id = p_line_id for update;
  select * into loc from inv_locations where id = p_location_id and company_id = r.company_id;
  if not found then raise exception 'Location not found' using errcode = 'P0002'; end if;
  if not inv_can_operate(loc.id) then
    raise exception 'Only warehouse staff who work at this location (or a founder) can reserve from it' using errcode = '42501';
  end if;
  perform inv_require_enabled(r.company_id);
  if r.status not in ('submitted', 'in_progress') then
    raise exception 'Only a submitted request can be reserved. This one is %', r.status using errcode = '23514';
  end if;
  if l.status <> 'open' then raise exception 'This line is %, so nothing can be reserved for it', l.status using errcode = '23514'; end if;
  if r.needed_from is null or r.needed_until is null then
    raise exception 'The request has no planning window. Set its dates first: a reservation covers the whole window' using errcode = '23514';
  end if;
  if r.needed_until <= now() then raise exception 'The request window has already ended' using errcode = '23514'; end if;

  v_item_id := inv_effective_item(l);
  select * into v_item from inv_items where id = v_item_id;
  perform inv_lock_item(v_item_id);                       -- everything below sees and serialises on the stock of this item
  v_range := tstzrange(r.needed_from, r.needed_until);
  select coalesce(sum(qty), 0) into v_taken from inv_reservations where request_line_id = l.id and status in ('active', 'completed');
  v_remaining := l.qty - v_taken;
  if v_remaining <= 0 then raise exception 'This line is already fully reserved' using errcode = '23514'; end if;

  if v_item.tracking in ('individual', 'kit') then
    if p_unit_ids is not null and cardinality(p_unit_ids) > 0 then
      if p_qty is not null then raise exception 'Give either the units or a quantity, not both' using errcode = '22023'; end if;
      select array_agg(distinct u order by u) into v_ids from unnest(p_unit_ids) u;
      if cardinality(v_ids) > v_remaining then
        raise exception 'This line needs only % more', trim_scale(v_remaining) using errcode = '23514';
      end if;
      foreach v_uid in array v_ids loop
        select * into v_unit from inv_units where id = v_uid;
        if not found or v_unit.item_id <> v_item_id or v_unit.company_id <> r.company_id then
          raise exception 'That unit is not a %', v_item.name using errcode = '23514';
        end if;
        v_reason := inv_reserve_block_reason(v_uid, r.needed_from, r.needed_until, loc.id, null);
        if v_reason is not null then raise exception '%', v_reason using errcode = '23514'; end if;
        begin
          insert into inv_reservations (company_id, request_line_id, item_id, unit_id, location_id, qty, reserved_during, made_by)
          values (r.company_id, l.id, v_item_id, v_uid, loc.id, 1, v_range, auth.uid())
          returning id into v_rid;
        exception when exclusion_violation then
          raise exception '% was just reserved for the same dates by someone else', v_unit.code using errcode = '23514';
        end;
        v_made := v_made || jsonb_build_object('reservation_id', v_rid, 'unit_id', v_uid, 'unit_code', v_unit.code, 'qty', 1);
        v_now := v_now + 1;
      end loop;
      v_ask := v_now;
    else
      v_ask := inv_check_qty(v_item_id, coalesce(p_qty, v_remaining));
      if v_ask > v_remaining then raise exception 'This line needs only % more', trim_scale(v_remaining) using errcode = '23514'; end if;
      for v_unit in
        select u.* from inv_units u
         where u.item_id = v_item_id and u.company_id = r.company_id and u.ownership = 'owned'
           and inv_unit_free(u.id, r.needed_from, r.needed_until, loc.id, null)
         order by (u.custody_kind = 'warehouse') desc, u.code
         limit floor(v_ask)::bigint
      loop
        begin
          insert into inv_reservations (company_id, request_line_id, item_id, unit_id, location_id, qty, reserved_during, made_by)
          values (r.company_id, l.id, v_item_id, v_unit.id, loc.id, 1, v_range, auth.uid())
          returning id into v_rid;
        exception when exclusion_violation then
          continue;
        end;
        v_made := v_made || jsonb_build_object('reservation_id', v_rid, 'unit_id', v_unit.id, 'unit_code', v_unit.code, 'qty', 1);
        v_now := v_now + 1;
      end loop;
    end if;
  else
    if p_unit_ids is not null and cardinality(p_unit_ids) > 0 then
      raise exception '% is counted by quantity, so units cannot be chosen', v_item.name using errcode = '22023';
    end if;
    v_ask := inv_check_qty(v_item_id, coalesce(p_qty, v_remaining));
    if v_ask > v_remaining then raise exception 'This line needs only % more', trim_scale(v_remaining) using errcode = '23514'; end if;
    v_free := inv_qty_free(v_item_id, loc.id, r.needed_from, r.needed_until, null, false);
    v_now := trunc(least(v_ask, v_free), v_item.quantity_scale);
    if v_now > 0 then
      insert into inv_reservations (company_id, request_line_id, item_id, location_id, qty, reserved_during, made_by)
      values (r.company_id, l.id, v_item_id, loc.id, v_now, v_range, auth.uid())
      returning id into v_rid;
      v_made := v_made || jsonb_build_object('reservation_id', v_rid, 'qty', v_now);
    end if;
  end if;

  v_short := v_ask - v_now;
  v_still := v_remaining - v_now;
  v_action := l.shortage_action;
  v_ref := l.rental_reference;
  if v_still > 0 and p_shortage_action is not null then
    if p_shortage_action not in ('none', 'need_to_buy', 'need_to_rent') then
      raise exception 'The shortage action must be none, need_to_buy or need_to_rent' using errcode = '22023';
    end if;
    if nullif(btrim(p_rental_reference), '') is not null and p_shortage_action <> 'need_to_rent' then
      raise exception 'A rental reference only belongs to a need to rent' using errcode = '22023';
    end if;
    v_action := p_shortage_action;
    v_ref := case when p_shortage_action = 'need_to_rent' then nullif(btrim(p_rental_reference), '') end;
    update inv_request_lines set shortage_action = v_action, rental_reference = v_ref, version = version + 1 where id = l.id;
  end if;
  if v_now > 0 and r.status = 'submitted' then
    update inv_requests set status = 'in_progress', version = version + 1 where id = r.id;
  end if;
  return jsonb_build_object(
    'line_id', l.id, 'request_id', r.id, 'item_id', v_item_id, 'item_name', v_item.name, 'location_id', loc.id,
    'window', jsonb_build_object('from', r.needed_from, 'until', r.needed_until),
    'line_qty', l.qty, 'requested', v_ask, 'reserved_now', v_now, 'shortage', v_short,
    'reserved_total', v_taken + v_now, 'still_needed', v_still,
    'reservations', v_made,
    'need', case when v_still > 0 and v_action <> 'none'
                 then jsonb_build_object('action', v_action, 'qty', v_still, 'rental_reference', v_ref) end);
end;
$$;

create or replace function inv_release_reservation(p_reservation_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  res inv_reservations;
  l inv_request_lines;
  r inv_requests;
  v_released numeric;
begin
  perform inv_require_user();
  select * into res from inv_reservations where id = p_reservation_id;
  if not found then raise exception 'Reservation not found' using errcode = 'P0002'; end if;
  select * into l from inv_request_lines where id = res.request_line_id;
  r := inv_lock_request(l.request_id);
  select * into res from inv_reservations where id = p_reservation_id for update;
  if not ((r.kind = 'project' and proj_can_manage(r.project_id))
          or (r.kind = 'employee' and r.requested_by = auth.uid())
          or inv_is_founder(r.company_id)
          or (res.location_id is not null and inv_can_operate(res.location_id))) then
    raise exception 'Only the project manager, the person who made the request, or warehouse staff at that location can release a reservation' using errcode = '42501';
  end if;
  perform inv_require_enabled(r.company_id);
  if res.status <> 'active' then raise exception 'This reservation is already %', res.status using errcode = '23514'; end if;
  v_released := inv_release_row(res, coalesce(nullif(btrim(p_reason), ''), 'Released'));
  return jsonb_build_object('reservation_id', res.id, 'released_qty', v_released, 'kept_dispatched_qty', res.dispatched_qty);
end;
$$;

-- Moves the request's dates and rechecks EVERY active reservation. A reservation whose new range is free is moved; a line where another
-- reservation (or the stock) conflicts keeps its old range untouched (all or nothing per line), is reported in "conflicts" and is never
-- taken away from anybody. Equipment already out keeps its start and is only ever extended at the end.
create or replace function inv_change_request_window(p_request_id uuid, p_plan jsonb, p_timezone text default null, p_expected_version integer default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r inv_requests;
  w record;
  v_tz text;
  v_version integer;
  l inv_request_lines;
  res inv_reservations;
  u inv_units;
  q record;
  v_item uuid;
  v_new tstzrange;
  v_lo timestamptz;
  v_hi timestamptz;
  v_reason text;
  v_free numeric;
  v_conflict boolean;
  v_why text;
  v_short numeric;
  v_plan_ids uuid[];
  v_plan_ranges tstzrange[];
  v_extended jsonb := '[]'::jsonb;
  v_unchanged jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_changed integer;
  i integer;
begin
  r := inv_lock_request(p_request_id);
  perform inv_require_edit(r);
  perform inv_require_enabled(r.company_id);
  perform inv_check_version(r.version, p_expected_version);
  if r.status not in ('draft', 'submitted', 'in_progress') then
    raise exception 'A % request can no longer be changed', r.status using errcode = '23514';
  end if;
  v_tz := coalesce(nullif(btrim(p_timezone), ''), r.timezone);
  select * into w from inv_plan_window(p_plan, v_tz);
  if w.o_from is null or w.o_until is null then
    raise exception 'Give at least a start and an end date' using errcode = '22023';
  end if;
  -- Lock every affected item (sorted: two callers can never deadlock) before looking at any stock or reservation.
  for v_item in
    select distinct inv_effective_item(x) from inv_request_lines x
     where x.request_id = r.id and exists (select 1 from inv_reservations y where y.request_line_id = x.id and y.status = 'active')
     order by 1
  loop
    perform inv_lock_item(v_item);
  end loop;

  update inv_requests set plan = w.o_plan, needed_from = w.o_from, needed_until = w.o_until, expected_return_at = w.o_return,
         timezone = v_tz, version = version + 1
   where id = r.id returning version into v_version;

  for l in select * from inv_request_lines x where x.request_id = r.id and x.status = 'open'
            and exists (select 1 from inv_reservations y where y.request_line_id = x.id and y.status = 'active') order by x.sort_order, x.id loop
    v_plan_ids := '{}'; v_plan_ranges := '{}';
    v_conflict := false; v_why := null; v_short := 0;
    -- Pass 1: the range every active reservation of the line would get, and whether it is free.
    for res in select * from inv_reservations where request_line_id = l.id and status = 'active' order by made_at, id loop
      if res.dispatched_qty > 0 then
        v_lo := lower(res.reserved_during);
        v_hi := greatest(upper(res.reserved_during), w.o_until);
      else
        v_lo := w.o_from; v_hi := w.o_until;
      end if;
      v_new := tstzrange(v_lo, v_hi);
      if v_new = res.reserved_during then continue; end if;
      v_plan_ids := v_plan_ids || res.id;
      v_plan_ranges := v_plan_ranges || v_new;
      if res.unit_id is not null then
        if res.dispatched_qty > 0 then
          -- Out on the project: only the extension must be free of other bookings of the same unit.
          if exists (select 1 from inv_reservations o where o.unit_id = res.unit_id and o.status = 'active' and o.id <> res.id
                       and o.reserved_during && v_new) then
            v_conflict := true; v_short := v_short + 1;
            v_why := coalesce(v_why, inv_reserve_block_reason(res.unit_id, v_lo, v_hi, coalesce(res.location_id, (select location_id from inv_units where id = res.unit_id)), l.id));
          end if;
        else
          v_reason := inv_reserve_block_reason(res.unit_id, v_lo, v_hi, coalesce(res.location_id, (select location_id from inv_units where id = res.unit_id)), l.id);
          if v_reason is not null then v_conflict := true; v_short := v_short + 1; v_why := coalesce(v_why, v_reason); end if;
        end if;
      end if;
    end loop;
    -- Quantity reservations: the undispatched part must still be free over the union of the new ranges.
    for q in
      select y.location_id, sum(y.qty - y.dispatched_qty) as need, min(case when y.dispatched_qty > 0 then lower(y.reserved_during) else w.o_from end) as lo,
             max(case when y.dispatched_qty > 0 then greatest(upper(y.reserved_during), w.o_until) else w.o_until end) as hi
        from inv_reservations y
       where y.request_line_id = l.id and y.status = 'active' and y.unit_id is null and y.id = any (v_plan_ids) and y.qty > y.dispatched_qty
       group by y.location_id
    loop
      v_free := inv_qty_free(inv_effective_item(l), q.location_id, q.lo, q.hi, l.id, false);
      if v_free < q.need then
        v_conflict := true; v_short := v_short + (q.need - v_free);
        v_why := coalesce(v_why, format('Only %s of %s are free for the new dates', trim_scale(v_free), trim_scale(q.need)));
      end if;
    end loop;

    if cardinality(v_plan_ids) = 0 then
      v_unchanged := v_unchanged || jsonb_build_object('line_id', l.id);
    elsif v_conflict then
      v_conflicts := v_conflicts || jsonb_build_object(
        'line_id', l.id, 'item_id', inv_effective_item(l), 'item_name', (select name from inv_items where id = inv_effective_item(l)),
        'kept_window', (select jsonb_build_object('from', min(lower(reserved_during)), 'until', max(upper(reserved_during)))
                          from inv_reservations where request_line_id = l.id and status = 'active'),
        'wanted_window', jsonb_build_object('from', w.o_from, 'until', w.o_until),
        'shortage', v_short, 'reason', v_why);
    else
      v_changed := 0;
      for i in 1..cardinality(v_plan_ids) loop
        update inv_reservations set reserved_during = v_plan_ranges[i] where id = v_plan_ids[i];
        v_changed := v_changed + 1;
      end loop;
      v_extended := v_extended || jsonb_build_object('line_id', l.id, 'reservations', v_changed);
    end if;
  end loop;
  return jsonb_build_object('request_id', r.id, 'version', v_version, 'timezone', v_tz,
    'window', jsonb_build_object('from', w.o_from, 'until', w.o_until),
    'extended', v_extended, 'unchanged', v_unchanged, 'conflicts', v_conflicts);
exception when exclusion_violation then
  raise exception 'Another reservation was made for the same equipment at the same moment. Try again' using errcode = '40001';
end;
$$;

-- =============================================================================
-- Availability (counts only; unit-level detail is for callers with stock access)
-- =============================================================================
create or replace function inv_availability(p_item_id uuid, p_location_id uuid, p_from timestamptz, p_until timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_item inv_items;
  loc inv_locations;
  v_basis text;
  v jsonb;
  v_units jsonb;
begin
  perform inv_require_user();
  select * into v_item from inv_items where id = p_item_id;
  if not found or not inv_can_browse(v_item.company_id) then raise exception 'Item not found' using errcode = 'P0002'; end if;
  select * into loc from inv_locations where id = p_location_id and company_id = v_item.company_id;
  if not found then raise exception 'Location not found' using errcode = 'P0002'; end if;
  if p_from is null or p_until is null or p_until <= p_from then
    raise exception 'Give a start and an end, the end after the start' using errcode = '22023';
  end if;
  v_basis := case when p_from <= now() then 'now' else 'future' end;

  if v_item.tracking in ('individual', 'kit') then
    select jsonb_build_object(
      'physical_at_location', count(*) filter (where u.custody_kind = 'warehouse' and u.lifecycle = 'active' and u.location_id = loc.id),
      'usable_now', count(*) filter (where inv_unit_usable(u) and u.location_id = loc.id),
      'dispatched_to_projects', count(*) filter (where u.custody_kind = 'project' and u.lifecycle = 'active' and u.location_id = loc.id),
      'assigned_to_employees', count(*) filter (where u.custody_kind = 'employee' and u.lifecycle = 'active' and u.location_id = loc.id),
      'in_transit', count(*) filter (where u.custody_kind = 'transit' and u.lifecycle = 'active'
                       and (u.location_id = loc.id or exists (select 1 from inv_transfers t where t.id = u.transfer_id and t.to_location_id = loc.id))),
      'awaiting_inspection', count(*) filter (where u.custody_kind = 'warehouse' and u.lifecycle = 'active' and u.condition = 'needs_inspection' and u.location_id = loc.id),
      'damaged_repair_missing', count(*) filter (where u.location_id = loc.id and (
                       (u.lifecycle = 'active' and u.custody_kind = 'warehouse' and u.condition in ('damaged', 'unserviceable'))
                    or (u.lifecycle = 'active' and u.custody_kind = 'repair') or u.lifecycle = 'missing')),
      'draft_unverified', count(*) filter (where u.lifecycle = 'draft' and u.location_id = loc.id),
      'free_for_range', count(*) filter (where u.ownership = 'owned' and inv_unit_free(u.id, p_from, p_until, loc.id, null)),
      'rental_free_for_range', count(*) filter (where u.ownership = 'rental' and inv_unit_free(u.id, p_from, p_until, loc.id, null)),
      'returning_on_time', count(*) filter (where u.ownership = 'owned' and u.custody_kind in ('project', 'transit') and inv_unit_free(u.id, p_from, p_until, loc.id, null)),
      'overdue', count(*) filter (where u.lifecycle = 'active' and (
                       (u.custody_kind in ('project', 'employee') and u.location_id = loc.id and u.expected_return_at is not null and u.expected_return_at < now())
                    or (u.custody_kind = 'transit' and exists (select 1 from inv_transfers t where t.id = u.transfer_id and t.expected_at is not null and t.expected_at < now()
                                                                  and loc.id in (t.from_location_id, t.to_location_id)))))
    ) into v from inv_units u where u.item_id = v_item.id;
    v := v || jsonb_build_object('reserved_in_range', (
      select count(distinct r.unit_id) from inv_reservations r join inv_units u on u.id = r.unit_id
       where r.item_id = v_item.id and r.status = 'active' and r.dispatched_qty = 0 and r.reserved_during && tstzrange(p_from, p_until)
         and coalesce(r.location_id, u.location_id) = loc.id));
    if inv_can_view_stock(v_item.company_id) then
      select coalesce(jsonb_agg(jsonb_build_object('unit_id', u.id, 'code', u.code, 'serial_number', u.serial_number, 'lifecycle', u.lifecycle,
               'condition', u.condition, 'custody', u.custody_kind, 'in_kit', u.in_kit_id is not null,
               'free', inv_unit_free(u.id, p_from, p_until, loc.id, null),
               'reason', inv_reserve_block_reason(u.id, p_from, p_until, loc.id, null)) order by u.code), '[]'::jsonb)
        into v_units from inv_units u where u.item_id = v_item.id and (u.location_id = loc.id or u.location_id is null);
      v := v || jsonb_build_object('units', v_units);
    end if;
  else
    with b as (
      select x.*,
             case x.holder_kind
               when 'warehouse' then x.location_id = loc.id
               when 'transit' then exists (select 1 from inv_transfers t where t.id = x.transfer_id and loc.id in (t.from_location_id, t.to_location_id))
               when 'kit' then false
               else exists (select 1 from inv_movement_lines l where l.to_balance_id = x.id and l.from_location_id = loc.id)
             end as here
        from inv_balances x where x.item_id = v_item.id and x.rental_id is null)
    select jsonb_build_object(
      'physical_at_location', coalesce(sum(qty) filter (where holder_kind = 'warehouse' and here), 0),
      'usable_now', coalesce(sum(qty) filter (where holder_kind = 'warehouse' and here and condition = 'good'), 0),
      'dispatched_to_projects', coalesce(sum(qty) filter (where holder_kind = 'project' and here), 0),
      'assigned_to_employees', coalesce(sum(qty) filter (where holder_kind = 'employee' and here), 0),
      'in_transit', coalesce(sum(qty) filter (where holder_kind = 'transit' and here), 0),
      'awaiting_inspection', coalesce(sum(qty) filter (where holder_kind = 'warehouse' and here and condition = 'needs_inspection'), 0),
      'damaged_repair_missing', coalesce(sum(qty) filter (where here and ((holder_kind = 'warehouse' and condition = 'damaged') or holder_kind = 'repair')), 0),
      'draft_unverified', 0,
      'overdue', coalesce(sum(qty) filter (where here and holder_kind in ('project', 'employee') and expected_return_at is not null and expected_return_at < now()), 0)
                 + coalesce((select sum(b2.qty) from inv_balances b2 join inv_transfers t on t.id = b2.transfer_id
                              where b2.item_id = v_item.id and b2.holder_kind = 'transit' and b2.rental_id is null
                                and t.expected_at is not null and t.expected_at < now() and loc.id in (t.from_location_id, t.to_location_id)), 0)
    ) into v from b;
    v := v || jsonb_build_object(
      'free_for_range', inv_qty_free(v_item.id, loc.id, p_from, p_until, null, false),
      'rental_free_for_range', inv_qty_free(v_item.id, loc.id, p_from, p_until, null, true),
      'returning_on_time', coalesce((select sum(b3.qty) from inv_balances b3
                                      where b3.item_id = v_item.id and b3.holder_kind = 'project' and b3.condition = 'good' and b3.rental_id is null
                                        and b3.expected_return_at is not null and b3.expected_return_at >= now() and b3.expected_return_at <= p_from
                                        and exists (select 1 from inv_movement_lines l where l.to_balance_id = b3.id and l.from_location_id = loc.id)), 0)
                              + coalesce((select sum(b4.qty) from inv_balances b4 join inv_transfers t on t.id = b4.transfer_id
                                           where b4.item_id = v_item.id and b4.holder_kind = 'transit' and b4.condition = 'good' and b4.rental_id is null
                                             and t.to_location_id = loc.id and t.expected_at is not null and t.expected_at >= now() and t.expected_at <= p_from), 0),
      'reserved_in_range', coalesce((select sum(r.qty - r.dispatched_qty) from inv_reservations r
                                      where r.item_id = v_item.id and r.unit_id is null and r.location_id = loc.id and r.status = 'active'
                                        and r.reserved_during && tstzrange(p_from, p_until)), 0));
  end if;
  return jsonb_build_object('item_id', v_item.id, 'item_name', v_item.name, 'tracking', v_item.tracking, 'unit_of_measure', v_item.unit_of_measure,
    'location_id', loc.id, 'location_name', loc.name, 'from', p_from, 'until', p_until,
    'basis', v_basis, 'available_now', v_basis = 'now') || coalesce(v, '{}'::jsonb);
end;
$$;

-- The shared engine behind technology availability and Sales checks. p_pairs = [{technology_id, qty}]. Free stock is a pool shared by
-- every technology in the list, so two technologies that need the same item never both count the same units.
-- Per required slot (a component, or an alternative group): 'available' (the standard item covers it), 'alternative' (the standard item
-- does not, a listed alternative does: a substitute the project must accept), 'partial' or 'short'. Optional components are listed but
-- never change the result.
create or replace function inv_demand_check(p_pairs jsonb, p_location_id uuid, p_from timestamptz, p_until timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_pool jsonb := '{}'::jsonb;
  pr jsonb;
  t inv_technologies;
  g record;
  v_cands jsonb;
  v_qty numeric;
  v_techs jsonb := '[]'::jsonb;
  v_rows jsonb;
  v_row_status text;
  k integer;
  v_item text;
  v_need numeric;
  v_free numeric;
  v_alt integer;
  v_alts jsonb;
  v_short numeric;
  v_consume_item text;
  v_consume numeric;
  v_req integer;
  v_av integer;
  v_sh integer;
  v_any_alt boolean := false;
  v_t_result text;
  v_all_av boolean := true;
  v_all_sh boolean := true;
  v_n integer := 0;
  v_sub boolean;
begin
  for pr in select * from jsonb_array_elements(p_pairs) loop
    select * into t from inv_technologies where id = (pr->>'technology_id')::uuid;
    v_qty := (pr->>'qty')::numeric;
    v_rows := '[]'::jsonb;
    v_req := 0; v_av := 0; v_sh := 0; v_sub := false;
    for g in
      select coalesce(x.alt_group, 'component:' || x.id::text) as slot, min(x.alt_group) as alt_group, bool_and(x.is_optional) as is_optional,
             min(x.sort_order) as first_sort
        from inv_technology_components x where x.technology_id = t.id
       group by coalesce(x.alt_group, 'component:' || x.id::text)
       order by min(x.sort_order), 1
    loop
      select jsonb_agg(jsonb_build_object('item_id', c.item_id, 'item_name', i.name, 'tracking', i.tracking, 'needed', c.qty * v_qty) order by c.sort_order, c.id)
        into v_cands
        from inv_technology_components c join inv_items i on i.id = c.item_id
       where c.technology_id = t.id and coalesce(c.alt_group, 'component:' || c.id::text) = g.slot;
      for k in 0..jsonb_array_length(v_cands) - 1 loop
        v_item := v_cands->k->>'item_id';
        if not (v_pool ? v_item) then
          v_pool := v_pool || jsonb_build_object(v_item, inv_free_count(v_item::uuid, p_location_id, p_from, p_until));
        end if;
      end loop;
      v_need := (v_cands->0->>'needed')::numeric;
      v_free := (v_pool->>(v_cands->0->>'item_id'))::numeric;
      v_alt := null; v_short := 0; v_consume_item := null; v_consume := 0;
      select coalesce(jsonb_agg(jsonb_build_object('item_id', a->>'item_id', 'item_name', a->>'item_name', 'needed', (a->>'needed')::numeric,
               'free', (v_pool->>(a->>'item_id'))::numeric, 'covers', (v_pool->>(a->>'item_id'))::numeric >= (a->>'needed')::numeric)), '[]'::jsonb)
        into v_alts from jsonb_array_elements(v_cands) with ordinality as e(a, n) where n > 1;
      if v_free >= v_need then
        v_row_status := 'available'; v_consume_item := v_cands->0->>'item_id'; v_consume := v_need;
      else
        for k in 1..jsonb_array_length(v_cands) - 1 loop
          if (v_pool->>(v_cands->k->>'item_id'))::numeric >= (v_cands->k->>'needed')::numeric then v_alt := k; exit; end if;
        end loop;
        if v_alt is not null then
          v_row_status := 'alternative'; v_consume_item := v_cands->v_alt->>'item_id'; v_consume := (v_cands->v_alt->>'needed')::numeric;
          v_short := v_need - v_free;
        elsif v_free > 0 then
          v_row_status := 'partial'; v_consume_item := v_cands->0->>'item_id'; v_consume := v_free; v_short := v_need - v_free;
        else
          v_row_status := 'short'; v_short := v_need;
        end if;
      end if;
      v_rows := v_rows || jsonb_build_object('item_id', v_cands->0->>'item_id', 'item_name', v_cands->0->>'item_name', 'tracking', v_cands->0->>'tracking',
                 'alt_group', g.alt_group, 'is_optional', g.is_optional, 'needed', v_need, 'free', v_free, 'short', v_short, 'status', v_row_status,
                 'alternative_item_id', case when v_row_status = 'alternative' then v_cands->v_alt->>'item_id' end, 'alternatives', v_alts);
      if not g.is_optional then
        v_req := v_req + 1;
        if v_row_status = 'available' then v_av := v_av + 1; end if;
        if v_row_status <> 'short' then v_sh := v_sh + 1; end if;
        if v_row_status = 'alternative' then v_sub := true; end if;
        if v_consume_item is not null then
          v_pool := jsonb_set(v_pool, array[v_consume_item], to_jsonb((v_pool->>v_consume_item)::numeric - v_consume));
        end if;
      end if;
    end loop;
    v_t_result := case when v_av = v_req then 'available' when v_sh = 0 then 'short' else 'partial' end;
    v_techs := v_techs || jsonb_build_object('technology_id', t.id, 'name', t.name, 'version', t.version, 'qty', v_qty, 'result', v_t_result,
                                             'needs_substitution', v_sub, 'rows', v_rows);
    v_n := v_n + 1;
    if v_t_result <> 'available' then v_all_av := false; end if;
    if v_t_result <> 'short' then v_all_sh := false; end if;
    if v_sub then v_any_alt := true; end if;
  end loop;
  return jsonb_build_object('result', case when v_n = 0 then 'check_required' when v_all_av then 'available' when v_all_sh then 'short' else 'partial' end,
                            'needs_substitution', v_any_alt, 'technologies', v_techs);
end;
$$;

create or replace function inv_technology_availability(p_technology_id uuid, p_qty numeric, p_location_id uuid, p_from timestamptz, p_until timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  t inv_technologies;
  loc inv_locations;
  v_res jsonb;
  v_basis text;
  v_tech jsonb;
begin
  perform inv_require_user();
  select * into t from inv_technologies where id = p_technology_id;
  if not found or not inv_can_browse(t.company_id) then raise exception 'Technology not found' using errcode = 'P0002'; end if;
  select * into loc from inv_locations where id = p_location_id and company_id = t.company_id;
  if not found then raise exception 'Location not found' using errcode = 'P0002'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'The quantity must be more than zero' using errcode = '22023'; end if;
  if p_from is null or p_until is null or p_until <= p_from then
    raise exception 'Give a start and an end, the end after the start' using errcode = '22023';
  end if;
  v_basis := case when p_from <= now() then 'now' else 'future' end;
  if t.status <> 'complete' or not exists (select 1 from inv_technology_components where technology_id = t.id and not is_optional) then
    return jsonb_build_object('technology_id', t.id, 'name', t.name, 'template_status', t.status, 'qty', p_qty, 'location_id', loc.id,
      'from', p_from, 'until', p_until, 'basis', v_basis, 'result', 'check_required', 'message', 'Warehouse check required',
      'needs_substitution', false, 'rows', '[]'::jsonb, 'shortages', '[]'::jsonb);
  end if;
  v_res := inv_demand_check(jsonb_build_array(jsonb_build_object('technology_id', t.id, 'qty', p_qty)), loc.id, p_from, p_until);
  v_tech := v_res->'technologies'->0;
  return jsonb_build_object('technology_id', t.id, 'name', t.name, 'version', t.version, 'template_status', t.status, 'qty', p_qty,
    'location_id', loc.id, 'from', p_from, 'until', p_until, 'basis', v_basis,
    'result', v_res->>'result', 'needs_substitution', (v_res->>'needs_substitution')::boolean, 'rows', v_tech->'rows',
    'shortages', coalesce((select jsonb_agg(jsonb_build_object('item_id', x->>'item_id', 'item_name', x->>'item_name', 'short', (x->>'short')::numeric,
                                                              'covered_by_alternative', x->>'status' = 'alternative'))
                             from jsonb_array_elements(v_tech->'rows') x where (x->>'short')::numeric > 0 and not (x->>'is_optional')::boolean), '[]'::jsonb));
end;
$$;

-- =============================================================================
-- Sales availability checks (a dated record, never a reservation)
-- =============================================================================
-- Computes the check for an opportunity at a location. A technology without a COMPLETE template is 'check_required' ("Warehouse check
-- required"): nothing is ever invented as available. Dates: install_start (or event_start) to the end of event_end, in the location's zone.
create or replace function inv_opportunity_compute(o crm_opportunities, p_location_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  loc inv_locations;
  d_from date;
  d_until date;
  v_from timestamptz;
  v_until timestamptz;
  e jsonb;
  v_tid uuid;
  v_pairs jsonb := '[]'::jsonb;
  v_slots jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_check jsonb;
  v_tech jsonb;
  v_pi integer := 0;
  s jsonb;
  v_unmatched boolean := false;
  v_result text;
  v_qty numeric;
  v_n integer := 0;
begin
  select * into loc from inv_locations where id = p_location_id;
  d_from := coalesce(o.install_start, o.event_start, o.event_end);
  d_until := coalesce(o.event_end, o.event_start, o.install_start);
  if d_from is not null then
    if d_until < d_from then d_until := d_from; end if;
    v_from := inv_local_to_utc(d_from::timestamp, loc.timezone);
    v_until := inv_local_to_utc((d_until + 1)::timestamp, loc.timezone);
  end if;
  for e in select * from jsonb_array_elements(o.technologies) loop
    v_n := v_n + 1;
    v_qty := coalesce(nullif(e->>'qty', '')::numeric, 1);
    select t.id into v_tid from inv_technologies t
     where t.company_id = o.company_id and t.status = 'complete' and lower(btrim(t.name)) = lower(btrim(e->>'name'))
       and exists (select 1 from inv_technology_components c where c.technology_id = t.id and not c.is_optional)
     limit 1;
    if v_tid is null then
      v_unmatched := true;
      v_slots := v_slots || jsonb_build_object('technology', e->>'name', 'qty', v_qty, 'status', 'check_required', 'message', 'Warehouse check required');
    elsif v_from is null then
      v_unmatched := true;
      v_slots := v_slots || jsonb_build_object('technology', e->>'name', 'qty', v_qty, 'technology_id', v_tid, 'status', 'check_required',
                                               'message', 'Warehouse check required: the opportunity has no dates yet');
    else
      v_pairs := v_pairs || jsonb_build_object('technology_id', v_tid, 'qty', v_qty);
      v_slots := v_slots || jsonb_build_object('technology', e->>'name', 'qty', v_qty, 'technology_id', v_tid, 'pair', jsonb_array_length(v_pairs) - 1);
    end if;
  end loop;
  if jsonb_array_length(v_pairs) > 0 then v_check := inv_demand_check(v_pairs, p_location_id, v_from, v_until); end if;
  for s in select * from jsonb_array_elements(v_slots) loop
    if s ? 'pair' then
      v_tech := v_check->'technologies'->((s->>'pair')::integer);
      v_summary := v_summary || jsonb_build_object('technology', s->>'technology', 'qty', s->'qty', 'technology_id', s->'technology_id',
        'status', v_tech->>'result', 'needs_substitution', v_tech->'needs_substitution',
        'message', case v_tech->>'result' when 'available' then 'Available' when 'partial' then 'Partly available' else 'Not available' end,
        'shortages', coalesce((select jsonb_agg(jsonb_build_object('item_name', x->>'item_name', 'short', (x->>'short')::numeric))
                                 from jsonb_array_elements(v_tech->'rows') x where (x->>'short')::numeric > 0 and not (x->>'is_optional')::boolean), '[]'::jsonb),
        'alternatives', coalesce((select jsonb_agg(jsonb_build_object('instead_of', x->>'item_name', 'use',
                                    (select a->>'item_name' from jsonb_array_elements(x->'alternatives') a where a->>'item_id' = x->>'alternative_item_id' limit 1)))
                                   from jsonb_array_elements(v_tech->'rows') x where x->>'status' = 'alternative'), '[]'::jsonb));
    else
      v_summary := v_summary || (s - 'pair');
    end if;
  end loop;
  if v_n = 0 then
    v_unmatched := true;
    v_summary := jsonb_build_array(jsonb_build_object('technology', null, 'status', 'check_required', 'message', 'Warehouse check required: no technologies are listed'));
  end if;
  v_result := case when v_unmatched then 'check_required' else v_check->>'result' end;
  return jsonb_build_object('result', v_result, 'summary', v_summary, 'location_id', loc.id,
    'window', jsonb_build_object('from', v_from, 'until', v_until, 'timezone', loc.timezone));
end;
$$;

create or replace function inv_request_opportunity_check(p_opportunity_id uuid, p_location_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  o crm_opportunities;
  v_id uuid;
  v_loc uuid;
begin
  perform inv_require_user();
  select * into o from crm_opportunities where id = p_opportunity_id;
  if not found or not crm_has_access(o.company_id) then raise exception 'Opportunity not found' using errcode = 'P0002'; end if;
  if o.owner_id <> auth.uid() and not crm_is_founder(o.company_id) then
    raise exception 'Only the owner of this opportunity or a Sales founder can ask for an availability check' using errcode = '42501';
  end if;
  if o.stage in ('won', 'lost') then raise exception 'A closed opportunity needs no availability check' using errcode = '23514'; end if;
  perform inv_require_enabled(o.company_id);
  if p_location_id is not null then
    select id into v_loc from inv_locations where id = p_location_id and company_id = o.company_id and is_active;
    if not found then raise exception 'Location not found' using errcode = '22023'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('inv_opp_check:' || o.id::text, 0));
  select id into v_id from inv_availability_checks where opportunity_id = o.id and result = 'pending' for update;
  if found then
    if v_loc is not null then update inv_availability_checks set location_id = v_loc where id = v_id and location_id is null; end if;
    return v_id;
  end if;
  insert into inv_availability_checks (company_id, opportunity_id, location_id, requested_by)
  values (o.company_id, o.id, v_loc, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function inv_record_opportunity_check(p_opportunity_id uuid, p_location_id uuid default null, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  o crm_opportunities;
  pend inv_availability_checks;
  v_loc uuid;
  v_calc jsonb;
  v_covers jsonb;
  v_id uuid;
begin
  perform inv_require_user();
  select * into o from crm_opportunities where id = p_opportunity_id;
  if not found then raise exception 'Opportunity not found' using errcode = 'P0002'; end if;
  if not (inv_has_capability(o.company_id, 'warehouse') or inv_has_capability(o.company_id, 'manage_catalogue')) then
    raise exception 'Only warehouse staff, catalogue managers or a founder can record an availability check' using errcode = '42501';
  end if;
  perform inv_require_enabled(o.company_id);
  perform pg_advisory_xact_lock(hashtextextended('inv_opp_check:' || o.id::text, 0));
  select * into pend from inv_availability_checks where opportunity_id = o.id and result = 'pending' for update;
  v_loc := coalesce(p_location_id, pend.location_id);
  if v_loc is null then raise exception 'Choose the location to check against' using errcode = '22023'; end if;
  if not exists (select 1 from inv_locations where id = v_loc and company_id = o.company_id and is_active) then
    raise exception 'Location not found' using errcode = '22023';
  end if;
  select * into o from crm_opportunities where id = p_opportunity_id;
  v_calc := inv_opportunity_compute(o, v_loc);
  v_covers := jsonb_build_object('install_start', o.install_start, 'event_start', o.event_start, 'event_end', o.event_end,
                                 'technologies', o.technologies, 'location', o.location, 'location_id', v_loc);
  if pend.id is not null then
    update inv_availability_checks set location_id = v_loc, checked_by = auth.uid(), checked_at = now(), result = v_calc->>'result',
           summary = v_calc->'summary', covers = v_covers, note = nullif(btrim(p_note), '')
     where id = pend.id returning id into v_id;
  else
    insert into inv_availability_checks (company_id, opportunity_id, location_id, requested_by, checked_by, checked_at, result, summary, covers, note)
    values (o.company_id, o.id, v_loc, auth.uid(), auth.uid(), now(), v_calc->>'result', v_calc->'summary', v_covers, nullif(btrim(p_note), ''))
    returning id into v_id;
  end if;
  update inv_availability_checks set superseded_by = v_id
   where opportunity_id = o.id and id <> v_id and superseded_by is null and result <> 'pending';
  return v_id;
end;
$$;

-- What Sales sees: the latest check, who made it and when, whether it is out of date, and a live per-technology summary. Item names and
-- counts at summary level only: no costs, no custody, no employee or other project information.
create or replace function inv_opportunity_availability(p_opportunity_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  o crm_opportunities;
  latest inv_availability_checks;
  pend inv_availability_checks;
  v_loc uuid;
  v_live jsonb;
  v_recheck boolean := false;
  v_state text;
begin
  perform inv_require_user();
  select * into o from crm_opportunities where id = p_opportunity_id;
  if not found then raise exception 'Opportunity not found' using errcode = 'P0002'; end if;
  if not ((crm_has_access(o.company_id) and (o.owner_id = auth.uid() or crm_is_founder(o.company_id)))
          or inv_has_capability(o.company_id, 'warehouse') or inv_has_capability(o.company_id, 'manage_catalogue')) then
    raise exception 'Opportunity not found' using errcode = 'P0002';
  end if;
  select * into latest from inv_availability_checks where opportunity_id = o.id and result <> 'pending' and superseded_by is null
   order by checked_at desc limit 1;
  select * into pend from inv_availability_checks where opportunity_id = o.id and result = 'pending' limit 1;
  if latest.id is not null then
    v_recheck := (latest.covers - 'location_id') is distinct from jsonb_build_object(
      'install_start', o.install_start, 'event_start', o.event_start, 'event_end', o.event_end, 'technologies', o.technologies, 'location', o.location);
    v_state := 'checked';
  elsif pend.id is not null then v_state := 'pending';
  else v_state := 'none';
  end if;
  v_loc := coalesce(latest.location_id, pend.location_id);
  if v_loc is not null then
    v_live := inv_opportunity_compute(o, v_loc);
  end if;
  return jsonb_build_object(
    'opportunity_id', o.id, 'state', v_state,
    'message', case v_state when 'none' then 'Warehouse check required' when 'pending' then 'Waiting for the warehouse' else null end,
    'needs_recheck', v_recheck,
    'latest', case when latest.id is not null then jsonb_build_object(
        'check_id', latest.id, 'result', latest.result, 'checked_at', latest.checked_at, 'checked_by', inv_user_name(latest.checked_by),
        'requested_at', latest.requested_at, 'location_id', latest.location_id,
        'location_name', (select name from inv_locations where id = latest.location_id), 'note', latest.note,
        'summary', latest.summary, 'covers', latest.covers - 'location_id') end,
    'pending', case when pend.id is not null then jsonb_build_object('check_id', pend.id, 'requested_at', pend.requested_at,
        'requested_by', inv_user_name(pend.requested_by)) end,
    'live', v_live);
end;
$$;

-- =============================================================================
-- Projects: handover import, equipment view, project triggers
-- =============================================================================
-- Imports the FROZEN handover technologies into ONE draft request per project and opportunity. Idempotent. Unmatched technologies (no
-- complete template) are written in the request note and the import log, never invented as lines. No permission check here: the public
-- function and the trigger decide who may call it.
create or replace function inv_import_handover_internal(p_project_id uuid, p_actor uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  pr proj_projects;
  h proj_handovers;
  v_existing uuid;
  v_req inv_requests;
  v_enabled boolean;
  v_plan jsonb := '{}'::jsonb;
  w record;
  e jsonb;
  v_tid uuid;
  v_qty numeric;
  v_unmatched text[] := '{}';
  v_matched integer := 0;
  v_note text;
  v_detail text;
begin
  select * into pr from proj_projects where id = p_project_id;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if pr.kind <> 'client' or pr.crm_opportunity_id is null then
    raise exception 'Only a project that came from a Sales handover has a handover to import' using errcode = '23514';
  end if;
  select id into v_existing from inv_requests where project_id = pr.id and source = 'sales_handover' and source_ref = pr.crm_opportunity_id;
  if found then return v_existing; end if;
  select * into h from proj_handovers where id = pr.handover_id;
  if not found then
    insert into inv_import_log (company_id, project_id, source_ref, outcome, detail)
    values (pr.company_id, pr.id, pr.crm_opportunity_id, 'nothing_to_import', 'The project has no handover record');
    return null;
  end if;
  select is_enabled into v_enabled from inv_company_settings where company_id = pr.company_id;
  if v_enabled is not true then
    insert into inv_import_log (company_id, project_id, source_ref, outcome, detail)
    values (pr.company_id, pr.id, pr.crm_opportunity_id, 'nothing_to_import', 'Inventory is not set up or is switched off for this company. The project manager can import the equipment later');
    return null;
  end if;
  if jsonb_array_length(h.technologies) = 0 then
    insert into inv_import_log (company_id, project_id, source_ref, outcome, detail)
    values (pr.company_id, pr.id, pr.crm_opportunity_id, 'nothing_to_import', 'The handover lists no technologies');
    return null;
  end if;

  if h.install_start is not null then v_plan := v_plan || jsonb_build_object('install_start', h.install_start::text); end if;
  if h.event_start is not null then v_plan := v_plan || jsonb_build_object('show_start', h.event_start::text); end if;
  if h.event_end is not null then v_plan := v_plan || jsonb_build_object('show_end', (h.event_end + 1)::text); end if;
  select * into w from inv_plan_window(v_plan, h.site_timezone);
  insert into inv_requests (company_id, code, kind, project_id, requested_by, status, title, timezone, plan, needed_from, needed_until,
                            expected_return_at, source, source_ref)
  values (pr.company_id, inv_next_code(pr.company_id, 'request'), 'project', pr.id, coalesce(p_actor, auth.uid(), pr.pm_user_id), 'draft',
          'Equipment from the Sales handover', h.site_timezone, w.o_plan, w.o_from, w.o_until, w.o_return, 'sales_handover', pr.crm_opportunity_id)
  on conflict (project_id, source_ref) where source = 'sales_handover' do nothing
  returning * into v_req;
  if v_req.id is null then
    select id into v_existing from inv_requests where project_id = pr.id and source = 'sales_handover' and source_ref = pr.crm_opportunity_id;
    return v_existing;
  end if;

  for e in select * from jsonb_array_elements(h.technologies) loop
    v_qty := coalesce(nullif(e->>'qty', '')::numeric, 1);
    select t.id into v_tid from inv_technologies t
     where t.company_id = pr.company_id and t.status = 'complete' and lower(btrim(t.name)) = lower(btrim(e->>'name'))
       and exists (select 1 from inv_technology_components c where c.technology_id = t.id and not c.is_optional)
     limit 1;
    if v_tid is null then
      v_unmatched := v_unmatched || format('%s x%s', btrim(e->>'name'), v_qty::bigint);
    else
      perform inv_expand_into_request(v_req, v_tid, v_qty, '{}'::jsonb);
      v_matched := v_matched + 1;
    end if;
  end loop;

  v_note := 'Imported from the Sales handover (' || h.crm_reference || '). Dates are whole days taken from the handover: confirm the real dispatch and return times.';
  if cardinality(v_unmatched) > 0 then
    v_note := v_note || ' No complete technology template for: ' || array_to_string(v_unmatched, ', ') || '. Add those items by hand, or ask the warehouse to check them.';
  end if;
  update inv_requests set note = v_note where id = v_req.id;
  v_detail := format('%s technolog%s expanded into request %s', v_matched, case when v_matched = 1 then 'y' else 'ies' end, v_req.code);
  if cardinality(v_unmatched) > 0 then v_detail := v_detail || '. Not matched (no complete template): ' || array_to_string(v_unmatched, ', '); end if;
  insert into inv_import_log (company_id, project_id, source_ref, outcome, detail)
  values (pr.company_id, pr.id, pr.crm_opportunity_id, 'imported', v_detail);
  return v_req.id;
end;
$$;

create or replace function inv_import_handover_requirements(p_project_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare pr proj_projects;
begin
  perform inv_require_user();
  select * into pr from proj_projects where id = p_project_id;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not (proj_can_manage(pr.id) or inv_is_founder(pr.company_id)) then
    raise exception 'Only the project manager, an acting project manager or a founder can import the handover equipment' using errcode = '42501';
  end if;
  perform inv_require_enabled(pr.company_id);
  if pr.status in ('completed', 'archived') then
    raise exception 'A completed or archived project cannot get new equipment requests' using errcode = '23514';
  end if;
  return inv_import_handover_internal(pr.id, auth.uid());
end;
$$;

-- Progress of one request line, from its reservations. reserved_for_window counts what really covers the request's window (a line left
-- with an old range after a refused date change shows a shortage); equipment already out counts as covering.
create or replace function inv_line_progress(l inv_request_lines)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  r inv_requests;
  v_res numeric; v_win numeric; v_disp numeric; v_ret numeric; v_short numeric := 0;
begin
  select * into r from inv_requests where id = l.request_id;
  select coalesce(sum(x.qty), 0),
         coalesce(sum(x.qty) filter (where r.needed_from is not null and r.needed_until is not null and (
             (x.dispatched_qty > 0 and upper(x.reserved_during) >= r.needed_until)
             or (lower(x.reserved_during) <= r.needed_from and upper(x.reserved_during) >= r.needed_until))), 0),
         coalesce(sum(x.dispatched_qty), 0), coalesce(sum(x.returned_qty), 0)
    into v_res, v_win, v_disp, v_ret
    from inv_reservations x where x.request_line_id = l.id and x.status in ('active', 'completed');
  if l.status = 'open' and r.status in ('submitted', 'in_progress') then v_short := greatest(0, l.qty - v_win); end if;
  return jsonb_build_object('reserved', v_res, 'reserved_for_window', v_win, 'dispatched', v_disp, 'returned', v_ret,
                            'outstanding', v_disp - v_ret, 'shortage', v_short);
end;
$$;

create or replace function inv_project_equipment(p_project_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  pr proj_projects;
  v_requests jsonb;
  v_short jsonb;
  v_out jsonb;
begin
  perform inv_require_user();
  select * into pr from proj_projects where id = p_project_id;
  if not found or not (proj_can_view_details(pr.id) or inv_is_founder(pr.company_id) or inv_has_capability(pr.company_id, 'warehouse')) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'code', q.code, 'status', q.status, 'title', q.title, 'destination', q.destination, 'timezone', q.timezone, 'plan', q.plan,
      'needed_from', q.needed_from, 'needed_until', q.needed_until, 'expected_return_at', q.expected_return_at,
      'source', q.source, 'note', q.note, 'version', q.version, 'submitted_at', q.submitted_at, 'cancelled_at', q.cancelled_at, 'cancel_reason', q.cancel_reason,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', l.id, 'item_id', l.item_id, 'item_name', i.name, 'model', i.model, 'qty', l.qty, 'status', l.status, 'is_optional', l.is_optional,
            'technology', l.technology_snapshot->>'name', 'alt_group', l.alt_group,
            'substitution_status', l.substitution_status, 'original_item_id', l.original_item_id, 'original_item_name', oi.name,
            'shortage_action', l.shortage_action, 'shortage_note', l.shortage_note, 'rental_reference', l.rental_reference, 'note', l.note,
            'progress', inv_line_progress(l),
            'reservations', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', x.id, 'unit_id', x.unit_id, 'unit_code', u.code, 'serial_number', u.serial_number, 'item_name', xi.name, 'qty', x.qty,
                  'dispatched_qty', x.dispatched_qty, 'returned_qty', x.returned_qty, 'from', lower(x.reserved_during), 'until', upper(x.reserved_during),
                  'status', x.status, 'released_reason', x.released_reason,
                  'covers_request_window', q.needed_from is not null and lower(x.reserved_during) <= q.needed_from and upper(x.reserved_during) >= q.needed_until)
                  order by x.made_at, x.id)
                from inv_reservations x join inv_items xi on xi.id = x.item_id left join inv_units u on u.id = x.unit_id
               where x.request_line_id = l.id), '[]'::jsonb)) order by l.sort_order, l.id)
          from inv_request_lines l join inv_items i on i.id = l.item_id left join inv_items oi on oi.id = l.original_item_id
         where l.request_id = q.id), '[]'::jsonb)) order by q.created_at, q.id), '[]'::jsonb)
    into v_requests from inv_requests q where q.project_id = pr.id;
  select coalesce(jsonb_agg(jsonb_build_object('request_code', q.code, 'line_id', l.id, 'item_name', i.name, 'short_qty', (inv_line_progress(l)->>'shortage')::numeric,
           'shortage_action', l.shortage_action, 'rental_reference', l.rental_reference) order by q.created_at, l.sort_order), '[]'::jsonb)
    into v_short
    from inv_requests q join inv_request_lines l on l.request_id = q.id join inv_items i on i.id = l.item_id
   where q.project_id = pr.id and (inv_line_progress(l)->>'shortage')::numeric > 0;
  v_out := jsonb_build_object('project_id', pr.id, 'requests', v_requests, 'shortages', v_short,
    'outstanding', coalesce((
      select jsonb_agg(jsonb_build_object('request_code', q.code, 'line_id', l.id, 'item_name', i.name, 'unit_code', u.code, 'serial_number', u.serial_number,
               'qty_outstanding', x.dispatched_qty - x.returned_qty) order by q.created_at, x.made_at)
        from inv_reservations x join inv_request_lines l on l.id = x.request_line_id join inv_requests q on q.id = l.request_id
             join inv_items i on i.id = x.item_id left join inv_units u on u.id = x.unit_id
       where q.project_id = pr.id and x.status = 'active' and x.dispatched_qty > x.returned_qty), '[]'::jsonb));
  return v_out;
end;
$$;

-- Trigger: a client project gets its draft equipment request from the handover. NEVER blocks: any failure is written to the log.
create or replace function inv_proj_after_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  begin
    perform inv_import_handover_internal(new.id, null);
  exception when others then
    begin
      insert into inv_import_log (company_id, project_id, source_ref, outcome, detail)
      values (new.company_id, new.id, new.crm_opportunity_id, 'failed', left(sqlerrm, 500));
    exception when others then
      null;
    end;
  end;
  return null;
end;
$$;

-- Trigger: when a project becomes completed or archived, unused reservations are released and draft / submitted requests are cancelled.
-- Dispatched equipment stays outstanding. Completion itself is never blocked or altered.
create or replace function inv_proj_after_status()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  q record;
  l record;
  v_reason text := 'Project ' || new.status;
begin
  begin
    for q in select id, status from inv_requests where project_id = new.id and status in ('draft', 'submitted', 'in_progress') order by created_at, id loop
      if q.status in ('draft', 'submitted') then
        perform inv_cancel_request_internal(q.id, v_reason);
      else
        for l in select id from inv_request_lines where request_id = q.id and status = 'open' loop
          perform inv_release_unused(l.id, v_reason);
        end loop;
      end if;
    end loop;
  exception when others then
    begin
      insert into inv_import_log (company_id, project_id, source_ref, outcome, detail)
      values (new.company_id, new.id, new.crm_opportunity_id, 'failed', left('Releasing equipment at project ' || new.status || ' failed: ' || sqlerrm, 500));
    exception when others then
      null;
    end;
  end;
  return null;
end;
$$;

drop trigger if exists inv_proj_projects_import on proj_projects;
create trigger inv_proj_projects_import after insert on proj_projects
  for each row when (new.kind = 'client') execute function inv_proj_after_insert();
drop trigger if exists inv_proj_projects_release on proj_projects;
create trigger inv_proj_projects_release after update of status on proj_projects
  for each row when (new.status in ('completed', 'archived') and old.status is distinct from new.status) execute function inv_proj_after_status();

-- =============================================================================
-- Privileges: internal helpers and trigger functions are closed; the client-facing functions are open to signed-in users (each one
-- checks who is calling).
-- =============================================================================
do $$
declare
  f record;
  v_internal text[] := array[
    'inv_user_name', 'inv_check_version', 'inv_lock_request', 'inv_can_edit_request', 'inv_require_edit', 'inv_plan_window', 'inv_effective_item',
    'inv_reserve_block_reason', 'inv_free_count', 'inv_expand_into_request', 'inv_release_row', 'inv_release_unused', 'inv_cancel_request_internal',
    'inv_demand_check', 'inv_opportunity_compute', 'inv_import_handover_internal', 'inv_line_progress', 'inv_proj_after_insert', 'inv_proj_after_status'];
  v_public text[] := array[
    'inv_save_technology', 'inv_save_technology_components', 'inv_set_technology_status', 'inv_create_request', 'inv_save_request_plan',
    'inv_add_request_line', 'inv_expand_technology', 'inv_update_request_line', 'inv_cancel_request_line', 'inv_submit_request',
    'inv_cancel_request', 'inv_propose_substitution', 'inv_decide_substitution', 'inv_set_shortage_action', 'inv_reserve',
    'inv_release_reservation', 'inv_change_request_window', 'inv_availability', 'inv_technology_availability', 'inv_request_opportunity_check',
    'inv_record_opportunity_check', 'inv_opportunity_availability', 'inv_project_equipment', 'inv_import_handover_requirements'];
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname = any (v_internal || v_public) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname = any (v_public) then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;

-- ROLLBACK (only before any Inventory planning data exists):
--   drop trigger if exists inv_proj_projects_release on proj_projects; drop trigger if exists inv_proj_projects_import on proj_projects;
--   drop function if exists inv_proj_after_status(), inv_proj_after_insert(), inv_project_equipment(uuid), inv_line_progress(inv_request_lines),
--     inv_import_handover_requirements(uuid), inv_import_handover_internal(uuid, uuid), inv_opportunity_availability(uuid),
--     inv_record_opportunity_check(uuid, uuid, text), inv_request_opportunity_check(uuid, uuid), inv_opportunity_compute(crm_opportunities, uuid),
--     inv_technology_availability(uuid, numeric, uuid, timestamptz, timestamptz), inv_demand_check(jsonb, uuid, timestamptz, timestamptz),
--     inv_availability(uuid, uuid, timestamptz, timestamptz), inv_change_request_window(uuid, jsonb, text, integer),
--     inv_release_reservation(uuid, text), inv_reserve(uuid, uuid, uuid[], numeric, text, text), inv_set_shortage_action(uuid, text, text, text),
--     inv_decide_substitution(uuid, boolean, text), inv_propose_substitution(uuid, uuid, text, integer), inv_cancel_request(uuid, text),
--     inv_cancel_request_internal(uuid, text), inv_submit_request(uuid, integer), inv_cancel_request_line(uuid, text), inv_release_unused(uuid, text),
--     inv_release_row(inv_reservations, text), inv_update_request_line(uuid, numeric, text, integer), inv_expand_technology(uuid, uuid, numeric, jsonb),
--     inv_expand_into_request(inv_requests, uuid, numeric, jsonb), inv_add_request_line(uuid, uuid, numeric, text, integer),
--     inv_save_request_plan(uuid, jsonb, text, integer), inv_create_request(text, uuid, uuid, text, jsonb, text, text, uuid, text),
--     inv_set_technology_status(uuid, text, integer), inv_save_technology_components(uuid, jsonb, integer),
--     inv_save_technology(uuid, uuid, text, text, integer), inv_free_count(uuid, uuid, timestamptz, timestamptz, uuid),
--     inv_reserve_block_reason(uuid, timestamptz, timestamptz, uuid, uuid), inv_effective_item(inv_request_lines),
--     inv_plan_window(jsonb, text), inv_require_edit(inv_requests), inv_can_edit_request(inv_requests), inv_lock_request(uuid),
--     inv_check_version(integer, integer), inv_user_name(uuid);
