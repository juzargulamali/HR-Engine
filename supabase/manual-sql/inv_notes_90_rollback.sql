-- WRITES (functions are restored; with NO note issued yet the new objects are also removed). OWNER-RUN ROLLBACK of 20261217000100_inv_project_notes.sql.
--
-- WHEN TO USE IT: only if the change causes a problem and you have decided to go back while it is fixed. The FIRST thing to do in a problem is much smaller and needs no rollback:
-- run inv_notes_80_switch_off_writes.sql (dispatch and return then behave exactly as before; every issued note and its history stay readable).
--
-- WHAT THIS DOES.
--   1. Always: puts back the exact earlier definitions of inv_dispatch_to_project, inv_return_from_project and inv_next_code (the ones in 20261201000300 and 20261201000000).
--      Their privileges are kept by create or replace. From this moment no note is made, whatever the switch says.
--   2. Only while NO note exists yet: drops the two tables, the status view, the new functions, the switch column and puts the counter check back as it was.
--      If notes exist they are KEPT, with their history, and so are the tables and functions that read and answer them: an issued dispatch note is a record people have
--      acknowledged or may print, and it is never dropped. The script says which case it found.
--
-- It is safe to run twice. Afterwards run inv_notes_20_verify_readonly.sql (it reports the new rules as missing when the old state is back) or compare with your BEFORE
-- snapshot using inv_notes_05_preservation_check_readonly.sql (the changed items say UNCHANGED / MISSING).

begin;

-- Step 1: the earlier definitions.
create or replace function inv_next_code(p_company_id uuid, p_kind text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text;
  v_n bigint;
  v_letter text := case p_kind when 'unit' then 'E' when 'stock' then 'S' when 'request' then 'R' when 'transfer' then 'T'
                              when 'movement' then 'M' when 'count' then 'C' end;
begin
  if v_letter is null then raise exception 'Unknown code kind %', p_kind using errcode = '22023'; end if;
  select reference_code into v_code from inv_company_settings where company_id = p_company_id;
  if v_code is null then
    raise exception 'An Inventory reference code has not been set for this company yet. A founder sets it under Manage.' using errcode = '23514';
  end if;
  insert into inv_reference_counters (company_id, kind, last_value) values (p_company_id, p_kind, 1)
  on conflict (company_id, kind) do update set last_value = inv_reference_counters.last_value + 1
  returning last_value into v_n;
  return v_code || '-' || v_letter || '-' || lpad(v_n::text, 5, '0');
end;
$$;

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
    if q.status not in ('submitted', 'in_progress') and not inv_replaying(p_company_id, p_key) then raise exception 'Request % is % and cannot be dispatched against', q.code, q.status using errcode = '23514'; end if;
  end if;
  v_exp := coalesce(p_expected_return_at, q.expected_return_at, q.needed_until);
  if v_exp is null then raise exception 'Say when the equipment is expected back' using errcode = '22023'; end if;
  if v_exp <= now() and not inv_replaying(p_company_id, p_key) then raise exception 'The expected return date must be in the future' using errcode = '22023'; end if;
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

-- Step 2: only when nothing was ever issued.
do $$
begin
  if to_regclass('public.inv_project_notes') is null then
    raise notice 'Nothing to remove: the notes tables do not exist (already rolled back).';
  elsif exists (select 1 from inv_project_notes) then
    raise notice 'KEPT: % issued note(s) exist, so the tables, their history and the functions that read and answer them stay. Creation is already off (step 1).', (select count(*) from inv_project_notes);
  else
    drop view if exists inv_project_note_status;
    drop table if exists inv_project_note_events;
    drop table if exists inv_project_notes;
    drop function if exists inv_notes_waiting_for_me();
    drop function if exists inv_resolve_note_difference(uuid, text, text, uuid, text);
    drop function if exists inv_ack_project_note(uuid, text, jsonb, text, text, text);
    drop function if exists inv_make_project_note(uuid, uuid);
    drop function if exists inv_set_project_notes(uuid, boolean);
    drop function if exists inv_project_notes_enabled(uuid);
    drop function if exists inv_project_notes_frozen();
    delete from inv_reference_counters where kind in ('dispatch_note', 'return_note');
    alter table inv_reference_counters drop constraint if exists inv_reference_counters_kind_check;
    alter table inv_reference_counters add constraint inv_reference_counters_kind_check check (kind in ('unit', 'stock', 'request', 'transfer', 'movement', 'count'));
    alter table inv_company_settings drop column if exists project_notes_enabled;
    raise notice 'No note had been issued: the notes tables, functions, the switch column and the two counter kinds were removed.';
  end if;
end $$;

commit;
