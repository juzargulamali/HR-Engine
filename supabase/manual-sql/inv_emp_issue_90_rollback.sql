-- WRITES (one function definition only; no table, row or privilege is touched). OWNER-RUN ROLLBACK of the employee equipment issue change
-- (20261216000100_inv_issue_to_employee_consumes_reservation.sql): restores inv_issue_to_employee to exactly the definition that was live before it
-- (the one in 20261201000300_inv_stock_functions.sql).
--
-- WHEN TO USE IT: only if the new behaviour causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back RE-OPENS the defect (a unit or quantity reserved for an employee request cannot be issued against that same request, and the
-- reservation is never consumed). Reservations already consumed or completed by the new version stay as they are: they are ordinary rows, nothing is deleted
-- or reset, no stock moves, and the movement history is untouched. The interim way to work with the old version is to give the equipment without
-- reserving it first (or to release the request's own reservation, then issue).
--
-- It is safe to run twice. Afterwards inv_emp_issue_20_verify_readonly.sql reports the new rules as missing (that is how it tells you the old definition is
-- back), or run inv_emp_issue_05_preservation_check_readonly.sql against your BEFORE snapshot (the fn: row then says UNCHANGED).
-- Execute privileges are kept by create or replace; nothing here grants or revokes anything.

begin;

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
  emp := inv_get_employee(p_employee_id, not inv_replaying(p_company_id, p_key));
  if p_request_id is not null then
    select * into q from inv_requests where id = p_request_id;
    if q.id is null or q.company_id <> p_company_id then raise exception 'Unknown request' using errcode = '22023'; end if;
    if q.kind <> 'employee' or q.employee_id is distinct from emp.id then raise exception 'That request is not for this employee' using errcode = '23514'; end if;
    if q.status not in ('submitted', 'in_progress') and not inv_replaying(p_company_id, p_key) then raise exception 'Request % is % and cannot be issued against', q.code, q.status using errcode = '23514'; end if;
  end if;
  if p_expected_return_at is not null and p_expected_return_at <= now() and not inv_replaying(p_company_id, p_key) then raise exception 'The expected return date must be in the future' using errcode = '22023'; end if;
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

commit;
