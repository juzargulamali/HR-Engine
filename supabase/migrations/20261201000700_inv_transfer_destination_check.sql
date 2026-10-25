-- Inventory: the destination of a direct project-to-project move is checked too.
-- Before: the manager of the project the equipment was on could hand it to ANY ongoing project of the company that had a submitted request,
-- without any standing on the destination project. Now a project manager (the route that does not go through the warehouse) must manage BOTH
-- projects; warehouse staff at the unit's own location keep moving equipment between any two projects. Same function, same signature, same
-- privileges (create or replace keeps them), so the function lists and counts of the verify script do not change. Additive: nothing else is touched.

create or replace function inv_transfer_between_projects(p_company_id uuid, p_from_project_id uuid, p_to_project_id uuid, p_key text, p_lines jsonb,
                                                         p_request_id uuid, p_expected_return_at timestamptz default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  fp proj_projects; tp proj_projects; q inv_requests; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record;
  v_can_manage boolean; v_can_manage_both boolean; v_exp timestamptz; v_seen uuid[] := '{}'; v_res text; v_line uuid; v_qty numeric; v_rental uuid; v_dest uuid;
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
  -- A project manager may only hand equipment to a project he or she also manages; the warehouse (at the unit's own location) may move it between any two projects.
  v_can_manage_both := v_can_manage and proj_can_manage(tp.id);
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
      if not (v_can_manage_both or (u.location_id is not null and inv_can_operate(u.location_id))) then
        raise exception 'You are not allowed to move % to another project. You need to manage both project % and the project it is going to, or work at the warehouse it came from', u.code, fp.reference using errcode = '42501';
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
      if not (v_can_manage_both or (v_origin is not null and inv_can_operate(v_origin))) then
        raise exception 'You are not allowed to move % to another project. You need to manage both project % and the project it is going to, or work at the warehouse it came from', i.name, fp.reference using errcode = '42501';
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
