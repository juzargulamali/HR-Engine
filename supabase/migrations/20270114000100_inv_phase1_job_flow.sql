-- Inventory Phase 1: one project equipment job from the Sales check to the return. ADDITIVE; nothing existing is changed or replaced. Safe to run twice.
--
-- What already existed and is REUSED unchanged: requests, lines, reservations (with the exclusion constraint and the per-item lock that stop two reservations of the
-- same stock), the dispatch and return movements with their idempotency keys, the availability check on an enquiry, the Project Plan supply route, held (damaged)
-- stock that only inv_check_condition releases, the site schedule. This migration closes four specific gaps:
--
--   1. PICK. Nothing recorded that reserved equipment had been taken off the shelf for a request. inv_reservations gets picked_qty / picked_at / picked_by and
--      inv_pick_for_request records it (idempotent by key, like a movement). A pick moves NO stock and changes NO availability: the stock is still in the warehouse and
--      still reserved. Dispatch (inv_dispatch_to_project) is unchanged and does not require a pick, so the build that is deployed today keeps working.
--   2. SITE RUNS SERVED. A request could not say which site runs (proj_plan_items, plan 'site') it serves. inv_request_runs links them; inv_set_request_runs is the
--      one write (whoever may edit the request). Equipment that stays out between two runs is ONE dispatch and keeps the same custody: nothing is returned and re-sent.
--   3. RUN-SPECIFIC STATUS. inv_project_run_cover / inv_company_run_cover read, per linked run, the request's state (inv_request_state, unchanged) and what is wrong
--      for THAT run (short, not sent although the run has started, leaves after the run starts, due back before the run ends, return overdue). Derived, never stored.
--   4. THE CHECK FOR THE PROJECT MANAGER. inv_project_sales_check gives whoever runs the project the availability check recorded on the enquiry it came from, and says
--      what changed since (dates, quantities, warehouse). Derived from the check's own "covers" record; nothing is stored and the check itself is never edited.
--
--   5. THE WAREHOUSE SALES ASKS ABOUT. Sales could ask for a check but could not name the warehouse, because Sales cannot read the locations list.
--      inv_opportunity_check_locations gives the person who may ask (the enquiry's owner or a Sales founder) the NAMES of the active warehouses of that company and
--      nothing else: no stock, no bins, no other company.
--
-- DEPLOYED-APP COMPATIBILITY: three nullable / defaulted columns on inv_reservations (the deployed build never names them), one new table, eight new functions. No
-- existing function, policy, constraint or column is changed. Apply BEFORE deploying the Phase 1 build (the new build without this SQL says the pick step is not
-- available yet and everything else works as before).
-- ROLLBACK: supabase/manual-sql/inv_phase1_job_flow_90_rollback.sql.

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 1. Pick
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table inv_reservations add column if not exists picked_qty numeric(14, 3) not null default 0;
alter table inv_reservations add column if not exists picked_at timestamptz;
alter table inv_reservations add column if not exists picked_by uuid references auth.users(id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inv_reservations_picked' and conrelid = 'public.inv_reservations'::regclass) then
    alter table inv_reservations add constraint inv_reservations_picked check (picked_qty >= 0 and picked_qty <= qty);
  end if;
end $$;

-- Records what was taken off the shelf for a request, before it is sent. Warehouse staff at that location (inv_loc), on a request that is with the warehouse.
--   Lines: {"unit_id": uuid, "picked": true|false}   a reserved unit of this request; picked false puts it back (undo)
--          {"item_id": uuid, "qty": n}                counted stock: n is how much is picked and WAITING TO BE SENT now (0 puts it all back). Never more than is
--                                                     reserved and unsent at this location, and never more than is on the shelf here.
-- A unit must be on the shelf at this location and usable (a damaged or missing unit is refused in words: reserve another one). A unit or quantity that is not
-- reserved for this request is refused. Stock, custody and availability are NOT changed. The same key returns the first result (inv_idem_begin).
create or replace function inv_pick_for_request(p_company_id uuid, p_location_id uuid, p_request_id uuid, p_key text, p_lines jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; r inv_requests; e jsonb; u inv_units; i inv_items; res inv_reservations; x record;
  v_prev jsonb; v_seen uuid[] := '{}'; v_why text; v_on boolean; v_qty numeric; v_open numeric; v_shelf numeric; v_left numeric; v_take numeric;
  v_out jsonb := '[]'::jsonb; v_result jsonb; v_waiting numeric; v_unpicked numeric;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  r := inv_lock_request(p_request_id);
  if r.company_id <> p_company_id then raise exception 'Request not found' using errcode = 'P0002'; end if;
  v_prev := inv_idem_begin(p_company_id, p_key, 'pick', jsonb_build_object('location', p_location_id, 'request', p_request_id, 'lines', p_lines));
  if v_prev is not null then return v_prev; end if;
  if r.status not in ('submitted', 'in_progress') then
    raise exception 'Request % is % and nothing can be picked for it', r.code, r.status using errcode = '23514';
  end if;
  perform inv_lock_lines(p_lines);
  for e in select y from jsonb_array_elements(p_lines) y loop
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      v_on := coalesce((e->>'picked')::boolean, true);
      select x2.* into res from inv_reservations x2 join inv_request_lines ln on ln.id = x2.request_line_id
       where ln.request_id = r.id and x2.unit_id = u.id and x2.status = 'active' and x2.dispatched_qty < x2.qty for update of x2;
      if not found then
        if exists (select 1 from inv_reservations x2 join inv_request_lines ln on ln.id = x2.request_line_id where ln.request_id = r.id and x2.unit_id = u.id and x2.dispatched_qty > 0) then
          raise exception '% has already been sent for request %', u.code, r.code using errcode = '23514';
        end if;
        raise exception '% is not reserved for request %. Reserve it for the request first', u.code, r.code using errcode = '23514';
      end if;
      if v_on then
        v_why := inv_unit_block_reason(u, l.id);
        if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
        if res.picked_qty < 1 then
          update inv_reservations set picked_qty = 1, picked_at = now(), picked_by = auth.uid() where id = res.id;
        end if;
      else
        update inv_reservations set picked_qty = 0, picked_at = null, picked_by = null where id = res.id;
      end if;
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code, 'picked', v_on, 'bin_id', u.bin_id);
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      if i.tracking in ('individual', 'kit') then raise exception '% is tracked unit by unit. Name the units that were picked', i.name using errcode = '23514'; end if;
      if i.id = any (v_seen) then raise exception '% is listed twice', i.name using errcode = '22023'; end if;
      v_seen := v_seen || i.id;
      v_qty := (e->>'qty')::numeric;
      if v_qty is null or v_qty < 0 then raise exception 'The picked quantity of % must be zero or more', i.name using errcode = '22023'; end if;
      if v_qty > 0 then v_qty := inv_check_qty(i.id, v_qty); end if;
      select coalesce(sum(x2.qty - x2.dispatched_qty), 0) into v_open from inv_reservations x2 join inv_request_lines ln on ln.id = x2.request_line_id
       where ln.request_id = r.id and x2.item_id = i.id and x2.unit_id is null and x2.location_id = l.id and x2.status = 'active';
      if v_qty > v_open then
        raise exception 'Only % of % is reserved for request % at this location and not yet sent. Reserve the rest first', trim_scale(v_open), i.name, r.code using errcode = '23514';
      end if;
      select coalesce(sum(b.qty), 0) into v_shelf from inv_balances b
       where b.item_id = i.id and b.holder_kind = 'warehouse' and b.location_id = l.id and b.condition = 'good';
      if v_qty > v_shelf then
        raise exception 'Only % of % is on the shelf here in good condition, so % cannot have been picked', trim_scale(v_shelf), i.name, trim_scale(v_qty) using errcode = '23514';
      end if;
      v_left := v_qty;
      for x in select x2.id, x2.qty, x2.dispatched_qty from inv_reservations x2 join inv_request_lines ln on ln.id = x2.request_line_id
                where ln.request_id = r.id and x2.item_id = i.id and x2.unit_id is null and x2.location_id = l.id and x2.status = 'active'
                order by x2.made_at, x2.id for update of x2 loop
        v_take := least(x.qty - x.dispatched_qty, v_left);
        -- picked_qty is cumulative (what was picked, sent or not): the part waiting to be sent is picked_qty - dispatched_qty.
        update inv_reservations set picked_qty = x.dispatched_qty + v_take,
               picked_at = case when v_take > 0 then now() else null end, picked_by = case when v_take > 0 then auth.uid() else null end
         where id = x.id;
        v_left := v_left - v_take;
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty, 'picked', v_qty > 0);
    end if;
  end loop;
  select coalesce(sum(greatest(0, x2.picked_qty - x2.dispatched_qty)), 0), coalesce(sum(greatest(0, x2.qty - greatest(x2.picked_qty, x2.dispatched_qty))), 0)
    into v_waiting, v_unpicked
    from inv_reservations x2 join inv_request_lines ln on ln.id = x2.request_line_id where ln.request_id = r.id and x2.status = 'active';
  v_result := jsonb_build_object('kind', 'pick', 'request_id', r.id, 'request_code', r.code, 'location_id', l.id, 'recorded_at', now(), 'lines', v_out,
                                 'picked_waiting', v_waiting, 'reserved_not_picked', v_unpicked);
  update inv_idempotency set result = v_result where company_id = p_company_id and idem_key = btrim(p_key);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 2. The site runs a request serves
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists inv_request_runs (
  request_id    uuid not null references inv_requests(id) on delete cascade,
  plan_item_id  uuid not null references proj_plan_items(id) on delete cascade,
  project_id    uuid not null references proj_projects(id) on delete cascade,
  added_by      uuid references auth.users(id),
  added_at      timestamptz not null default now(),
  primary key (request_id, plan_item_id)
);
create index if not exists idx_inv_request_runs_run on inv_request_runs(plan_item_id);
create index if not exists idx_inv_request_runs_project on inv_request_runs(project_id);
alter table inv_request_runs enable row level security;
drop policy if exists inv_request_runs_select on inv_request_runs;
create policy inv_request_runs_select on inv_request_runs for select using (inv_can_see_request(request_id));
revoke all on table inv_request_runs from anon, authenticated, public;
grant select on table inv_request_runs to authenticated;

-- Sets the runs a project request serves (the whole list: runs not named are unlinked). Whoever may edit the request (the Project Manager, an acting one, a
-- Projects founder, warehouse staff). Each run must be a site activity of the SAME project that is not cancelled. It changes no reservation, no window and no stock.
create or replace function inv_set_request_runs(p_request_id uuid, p_plan_item_ids uuid[])
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare r inv_requests; v_ids uuid[]; v_bad integer;
begin
  r := inv_lock_request(p_request_id);
  perform inv_require_edit(r);
  if r.kind <> 'project' or r.project_id is null then raise exception 'Only a project request serves site runs' using errcode = '23514'; end if;
  if r.status in ('cancelled', 'closed') then raise exception 'Request % is % and cannot be changed', r.code, r.status using errcode = '23514'; end if;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids from unnest(coalesce(p_plan_item_ids, '{}'::uuid[])) x where x is not null;
  if cardinality(v_ids) > 50 then raise exception 'Too many site runs for one request (50 at most)' using errcode = '22023'; end if;
  select count(*) into v_bad from unnest(v_ids) x
   where not exists (select 1 from proj_plan_items i where i.id = x and i.project_id = r.project_id and i.plan = 'site' and i.status <> 'cancelled');
  if v_bad > 0 then raise exception 'A site run chosen is not on this project''s site schedule (or was cancelled). Reload and choose again' using errcode = '23514'; end if;
  delete from inv_request_runs where request_id = r.id and not (plan_item_id = any (v_ids));
  insert into inv_request_runs (request_id, plan_item_id, project_id, added_by)
    select r.id, x, r.project_id, auth.uid() from unnest(v_ids) x
    on conflict (request_id, plan_item_id) do nothing;
  return jsonb_build_object('request_id', r.id, 'runs', to_jsonb(v_ids));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 3. Run-specific status (read only, derived)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- One row per (request, run it serves) of a project. Internal: the two public reads below check access. "problems" names what is wrong for THAT run:
--   not_submitted            the request is still a draft: the warehouse has not been asked
--   short                    at least one line is not fully reserved (units_short says how many)
--   not_sent                 the run has started and nothing has been sent
--   partly_sent              the run has started and only part has been sent
--   leaves_after_run_starts  the request's "Leaves warehouse" is later than the start of the run
--   due_back_before_run_ends the request's "Due back" is earlier than the end of the run
--   return_overdue           equipment is still out after "Due back"
--   run_not_dated / request_not_dated   one of the two has no date, so cover cannot be said
create or replace function inv_run_cover_rows(p_project_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(z.row order by z.run_start nulls last, z.code, z.run_id), '[]'::jsonb)
  from (
    select q.code, i.id as run_id, s.run_start,
      jsonb_build_object(
        'project_id', q.project_id, 'request_id', q.id, 'request_code', q.code, 'request_status', q.status,
        'run_id', i.id, 'run_title', i.title, 'run_kind', i.activity_kind, 'run_label', i.run_label, 'run_status', i.status, 'run_location', i.location,
        'run_start', s.run_start, 'run_end', s.run_end, 'run_all_day', i.starts_at is null, 'run_first_day', coalesce(i.start_date, (i.starts_at at time zone q.timezone)::date),
        'run_last_day', coalesce(i.end_date, i.start_date, (i.ends_at at time zone q.timezone)::date),
        'leaves_at', w.leaves_at, 'due_back_at', w.due_back_at, 'timezone', q.timezone,
        'state', st.v ->> 'state', 'units_asked', st.v -> 'units_asked', 'units_short', st.v -> 'units_short', 'units_dispatched', st.v -> 'units_dispatched',
        'units_returned', st.v -> 'units_returned', 'units_out', st.v -> 'units_out', 'short_buy', st.v -> 'short_buy', 'short_rent', st.v -> 'short_rent',
        'short_no_plan', st.v -> 'short_no_plan',
        'problems', to_jsonb(array_remove(array[
          case when q.status = 'draft' then 'not_submitted' end,
          case when q.status <> 'draft' and (st.v ->> 'units_short')::numeric > 0 then 'short' end,
          case when s.run_start is not null and s.run_start <= now() and i.status not in ('done', 'cancelled') and q.status in ('submitted', 'in_progress')
                    and (st.v ->> 'units_dispatched')::numeric = 0 then 'not_sent' end,
          case when s.run_start is not null and s.run_start <= now() and i.status not in ('done', 'cancelled') and (st.v ->> 'state') = 'partially_dispatched' then 'partly_sent' end,
          case when s.run_start is not null and w.leaves_at is not null and w.leaves_at > s.run_start then 'leaves_after_run_starts' end,
          case when s.run_end is not null and w.due_back_at is not null and w.due_back_at < s.run_end then 'due_back_before_run_ends' end,
          case when (st.v ->> 'return_overdue')::boolean then 'return_overdue' end,
          case when s.run_start is null then 'run_not_dated' end,
          case when w.leaves_at is null or w.due_back_at is null then 'request_not_dated' end], null))) as row
    from inv_request_runs rr
    join inv_requests q on q.id = rr.request_id and q.status <> 'cancelled'
    join proj_plan_items i on i.id = rr.plan_item_id and i.plan = 'site' and i.status <> 'cancelled'
    cross join lateral (select inv_request_state(q.id) as v) st
    cross join lateral (select coalesce(i.starts_at, inv_local_to_utc(i.start_date::timestamp, q.timezone)) as run_start,
                               coalesce(i.ends_at, inv_local_to_utc((coalesce(i.end_date, i.start_date) + 1)::timestamp, q.timezone)) as run_end) s
    cross join lateral (select coalesce(case when coalesce(q.plan ->> 'dispatch', '') <> '' then inv_local_to_utc((q.plan ->> 'dispatch')::timestamp, q.timezone) end, q.needed_from) as leaves_at,
                               coalesce(q.expected_return_at, q.needed_until) as due_back_at) w
    where rr.project_id = p_project_id) z;
$$;

-- For the people who run the project, Operations and the warehouse (the same readers as proj_equipment_readiness). Anyone else: "Project not found".
create or replace function inv_project_run_cover(p_project_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare pr proj_projects;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into pr from proj_projects where id = p_project_id;
  if not found or not (proj_can_view_details(pr.id) or proj_has_capability(pr.company_id, 'operations') or inv_has_capability(pr.company_id, 'warehouse')) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('project_id', pr.id, 'rows', inv_run_cover_rows(pr.id));
end;
$$;

-- For the Operations Overview of ONE company (ops_require: an Operations Manager or founder of that company): the same rows for every live project, with its name.
create or replace function inv_company_run_cover(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform ops_require(p_company_id);
  return jsonb_build_object('company_id', p_company_id, 'taken_at', now(),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('project_id', p.id, 'reference', p.reference, 'name', p.name, 'rows', c.v) order by p.reference)
        from proj_projects p cross join lateral (select inv_run_cover_rows(p.id) as v) c
       where p.company_id = p_company_id and p.status not in ('completed', 'archived') and jsonb_array_length(c.v) > 0), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 4. The enquiry's availability check, for the people who run the project
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Technologies as a comparable list: lower-case trimmed name and numeric quantity, in name order.
create or replace function inv_tech_norm(p jsonb)
returns jsonb
language sql immutable
as $$
  select coalesce((select jsonb_agg(jsonb_build_object('name', lower(btrim(e ->> 'name')), 'qty', coalesce(nullif(e ->> 'qty', '')::numeric, 1))
                                    order by lower(btrim(e ->> 'name')), coalesce(nullif(e ->> 'qty', '')::numeric, 1))
                     from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e), '[]'::jsonb);
$$;

-- state: no_enquiry (an internal project) | none | pending | checked.  "review" lists what changed since the check was recorded, each with the value then and now:
--   install_start / event_start / event_end   the project's date differs from the date the check covered
--   quantities                                the project's technologies or their quantities differ from what was checked
--   warehouse                                 an equipment request of the project asks a different warehouse than the one that was checked
-- An empty list means the check still describes the project. The check is a dated statement and is never edited: a changed project needs a new look by the warehouse
-- on the request itself, where reserving is the real answer. Summary level only, exactly what Sales sees: no costs, no custody, no other project.
create or replace function inv_project_sales_check(p_project_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  pr proj_projects; d proj_project_details; latest inv_availability_checks; pend inv_availability_checks; v_ref text; v_review jsonb := '[]'::jsonb; v_other record;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into pr from proj_projects where id = p_project_id;
  if not found or not (proj_can_view_details(pr.id) or proj_has_capability(pr.company_id, 'operations') or inv_has_capability(pr.company_id, 'warehouse')) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if pr.crm_opportunity_id is null then return jsonb_build_object('project_id', pr.id, 'state', 'no_enquiry', 'review', '[]'::jsonb); end if;
  select reference into v_ref from crm_opportunities where id = pr.crm_opportunity_id;
  select * into latest from inv_availability_checks where opportunity_id = pr.crm_opportunity_id and result <> 'pending' and superseded_by is null order by checked_at desc limit 1;
  select * into pend from inv_availability_checks where opportunity_id = pr.crm_opportunity_id and result = 'pending' limit 1;
  if latest.id is null then
    return jsonb_build_object('project_id', pr.id, 'enquiry_reference', v_ref, 'state', case when pend.id is not null then 'pending' else 'none' end, 'review', '[]'::jsonb);
  end if;
  select * into d from proj_project_details where project_id = pr.id;
  if d.project_id is not null then
    if (latest.covers ->> 'install_start') is distinct from d.install_start::text then
      v_review := v_review || jsonb_build_object('field', 'install_start', 'checked', latest.covers ->> 'install_start', 'now', d.install_start);
    end if;
    if (latest.covers ->> 'event_start') is distinct from d.event_start::text then
      v_review := v_review || jsonb_build_object('field', 'event_start', 'checked', latest.covers ->> 'event_start', 'now', d.event_start);
    end if;
    if (latest.covers ->> 'event_end') is distinct from d.event_end::text then
      v_review := v_review || jsonb_build_object('field', 'event_end', 'checked', latest.covers ->> 'event_end', 'now', d.event_end);
    end if;
    if inv_tech_norm(latest.covers -> 'technologies') <> inv_tech_norm(d.technologies) then
      v_review := v_review || jsonb_build_object('field', 'quantities', 'checked', latest.covers -> 'technologies', 'now', d.technologies);
    end if;
  end if;
  select q.code, loc.name into v_other from inv_requests q join inv_locations loc on loc.id = q.pickup_location_id
   where q.project_id = pr.id and q.status <> 'cancelled' and q.pickup_location_id is not null and q.pickup_location_id is distinct from latest.location_id
   order by q.created_at limit 1;
  if found then
    v_review := v_review || jsonb_build_object('field', 'warehouse', 'checked', (select name from inv_locations where id = latest.location_id), 'now', v_other.name, 'request_code', v_other.code);
  end if;
  return jsonb_build_object(
    'project_id', pr.id, 'enquiry_reference', v_ref, 'state', 'checked',
    'latest', jsonb_build_object('check_id', latest.id, 'result', latest.result, 'checked_at', latest.checked_at, 'checked_by', inv_user_name(latest.checked_by),
        'location_id', latest.location_id, 'location_name', (select name from inv_locations where id = latest.location_id), 'note', latest.note,
        'summary', latest.summary, 'covers', latest.covers - 'location_id'),
    'review', v_review);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 5. The warehouses Sales can name when asking for a check
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- For exactly the people who may ask for a check on this enquiry (inv_request_opportunity_check: its owner, or a Sales founder of its company): the id and the name
-- of each ACTIVE location of the enquiry's own company, in name order. Anyone else: "Opportunity not found". Names only; nothing about stock.
create or replace function inv_opportunity_check_locations(p_opportunity_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare o crm_opportunities;
begin
  perform inv_require_user();
  select * into o from crm_opportunities where id = p_opportunity_id;
  if not found or not (crm_has_access(o.company_id) and (o.owner_id = auth.uid() or crm_is_founder(o.company_id))) then
    raise exception 'Opportunity not found' using errcode = 'P0002';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.name) from inv_locations l where l.company_id = o.company_id and l.is_active), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Privileges: clients read through row-level security and call only the public functions.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function
  inv_pick_for_request(uuid, uuid, uuid, text, jsonb), inv_set_request_runs(uuid, uuid[]), inv_run_cover_rows(uuid), inv_project_run_cover(uuid),
  inv_company_run_cover(uuid), inv_tech_norm(jsonb), inv_project_sales_check(uuid), inv_opportunity_check_locations(uuid)
  from public, anon, authenticated;
grant execute on function
  inv_pick_for_request(uuid, uuid, uuid, text, jsonb), inv_set_request_runs(uuid, uuid[]), inv_project_run_cover(uuid), inv_company_run_cover(uuid),
  inv_project_sales_check(uuid), inv_opportunity_check_locations(uuid)
  to authenticated;
