-- WRITES. OWNER-RUN ROLLBACK of 20270104000100_proj_project_plan_r1.sql (Project Plan, Release 1). Safe to run twice. Leaves the Delivery Plan of 20261231000100 working as it was.
-- BEFORE running it:
--   1. Deploy the app version from before Release 1 FIRST (or accept that the new controls fail while this runs). The previous app only knows the old five sections.
--   2. The script STOPS if the plan already holds anything only Release 1 can hold: lines or delegations in the sections Apps / Engineering & integration / Site work, a
--      supply route, planned start dates, details, milestones, dependencies or quantities on lines or deliverables. EXPORT them, decide what to keep, then either
--      delete those lines and delegations in the plan screen / with the CLEANUP statements below, or accept losing the Release 1 columns (the tasks and equipment lines that
--      Release created are ordinary tasks and request lines and are NEVER touched).
--        select * from proj_dp_items; select * from proj_dp_lines; select * from proj_dp_delegations;
-- WHAT IT DOES: restores the previous bodies of the seven functions it replaced, drops the four new ones and the helpers, drops the added columns and index, and puts the
--   two section lists back to the original five. No table is dropped, no task, equipment line, milestone or dependency is touched.
do $$
declare n_lines integer := 0; n_deleg integer := 0; n_data integer := 0;
begin
  if to_regclass('public.proj_dp_lines') is null then return; end if;
  select count(*) into n_lines from proj_dp_lines where section in ('apps', 'engineering', 'site');
  select count(*) into n_deleg from proj_dp_delegations where section in ('apps', 'engineering', 'site');
  begin
    execute $q$select (select count(*) from proj_dp_lines where supply_route is not null or start_date is not null or milestone_id is not null or cardinality(depends_on) > 0 or detail <> '{}'::jsonb or task_pending is not null)
                    + (select count(*) from proj_dp_items where qty is not null or source_key is not null)$q$ into n_data;
  exception when undefined_column then n_data := 0;
  end;
  if n_lines + n_deleg + n_data > 0 then
    raise exception 'STOP: the plan holds Release 1 data (% lines in new sections, % delegations, % rows with new fields). Export it and clean it up first (see the notes at the top of this file).', n_lines, n_deleg, n_data;
  end if;
end $$;
-- CLEANUP (run by hand ONLY after exporting; removes plan lines that are not released and every delegation in the new sections):
--   delete from proj_dp_changes where line_id in (select id from proj_dp_lines where section in ('apps','engineering','site'));
--   delete from proj_dp_lines where section in ('apps','engineering','site') and released_at is null;
--   delete from proj_dp_delegations where section in ('apps','engineering','site');
begin;
-- Previous function bodies (copied from 20261231000100_proj_delivery_plan.sql).
create or replace function proj_dp_can_edit_section(p_project_id uuid, p_section text)
returns boolean language sql stable security definer set search_path = public as $$
  select proj_can_manage(p_project_id)
      or (proj_is_active_member(p_project_id)
          and exists (select 1 from proj_dp_delegations d where d.project_id = p_project_id and d.section = p_section and d.user_id = auth.uid()));
$$;

create or replace function proj_dp_save_item(p_project_id uuid, p_item_id uuid, p_fields jsonb, p_expected_version integer default null, p_source text default 'screen')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; it proj_dp_items; v_id uuid; v_diff jsonb := '{}'::jsonb; v_change uuid; f text;
  v_zone text; v_title text; v_owner uuid; v_file uuid;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_member_or_founder(v);
  perform proj_require_open_project(v);
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager, a temporary project leader or a founder can change a deliverable' using errcode = '42501'; end if;
  if p_fields ? 'owner_id' and nullif(p_fields->>'owner_id', '') is not null then
    v_owner := (p_fields->>'owner_id')::uuid;
    if not proj_dp_active_member(v.id, v_owner) then raise exception 'The accountable owner must be an active member of the project' using errcode = '22023'; end if;
  end if;
  if p_fields ? 'image_file_id' and nullif(p_fields->>'image_file_id', '') is not null then
    v_file := (p_fields->>'image_file_id')::uuid;
    if not exists (select 1 from proj_files pf where pf.id = v_file and pf.project_id = v.id and pf.deleted_at is null) then
      raise exception 'The reference image must be a file of this project' using errcode = '22023';
    end if;
  end if;

  if p_item_id is null then
    v_title := btrim(coalesce(p_fields->>'title', ''));
    v_zone := btrim(coalesce(p_fields->>'zone', ''));
    if length(v_title) = 0 then raise exception 'Give the deliverable a name' using errcode = '22023'; end if;
    -- The same zone and name is the same deliverable: return it instead of adding a second (a repeated save or import).
    select id into v_id from proj_dp_items where project_id = v.id and removed_at is null and lower(btrim(zone)) = lower(v_zone) and lower(btrim(title)) = lower(v_title);
    if v_id is not null then return jsonb_build_object('id', v_id, 'existing', true); end if;
    insert into proj_dp_items (project_id, item_key, zone, title, specs, owner_id, needed_by, image_file_id, sort_order, created_by)
    values (v.id, proj_dp_next_key(v.id, 'item'), v_zone, v_title, nullif(btrim(coalesce(p_fields->>'specs', '')), ''), v_owner, nullif(p_fields->>'needed_by', '')::date, v_file,
            coalesce((p_fields->>'sort_order')::integer, (select coalesce(max(sort_order), 0) + 10 from proj_dp_items where project_id = v.id)), auth.uid())
    returning id into v_id;
    perform proj_dp_touch(v.id);
    return jsonb_build_object('id', v_id, 'created', true);
  end if;

  select * into it from proj_dp_items where id = p_item_id and project_id = v.id and removed_at is null for update;
  if not found then raise exception 'Deliverable not found' using errcode = 'P0002'; end if;
  if p_expected_version is not null and it.version <> p_expected_version then
    raise exception 'This deliverable was changed by someone else. Reload and try again' using errcode = '40001';
  end if;
  if p_fields ? 'title' and length(btrim(coalesce(p_fields->>'title', ''))) = 0 then raise exception 'Give the deliverable a name' using errcode = '22023'; end if;

  if it.released_at is not null then
    foreach f in array array['zone', 'title', 'specs', 'owner_id', 'needed_by'] loop
      if p_fields ? f and (to_jsonb(it)->>f) is distinct from nullif(btrim(coalesce(p_fields->>f, '')), '') and not (f = 'zone' and coalesce(to_jsonb(it)->>f, '') = btrim(coalesce(p_fields->>f, ''))) then
        v_diff := v_diff || jsonb_build_object(f, jsonb_build_object('from', to_jsonb(it)->f, 'to', case when nullif(btrim(coalesce(p_fields->>f, '')), '') is null then 'null'::jsonb else to_jsonb(btrim(p_fields->>f)) end));
      end if;
    end loop;
    -- The picture and the order are not commitments: they change directly.
    update proj_dp_items set image_file_id = case when p_fields ? 'image_file_id' then v_file else image_file_id end,
                             sort_order = coalesce((p_fields->>'sort_order')::integer, sort_order), updated_at = now()
      where id = it.id;
    if v_diff = '{}'::jsonb then return jsonb_build_object('id', it.id, 'unchanged', true); end if;
    update proj_dp_changes set status = 'withdrawn' where item_id = it.id and status = 'proposed';
    insert into proj_dp_changes (project_id, item_id, changes, reason, source, proposed_by)
      values (v.id, it.id, v_diff, nullif(btrim(coalesce(p_fields->>'reason', '')), ''), case when p_source = 'excel' then 'excel' else 'screen' end, auth.uid()) returning id into v_change;
    perform proj_dp_touch(v.id);
    return jsonb_build_object('id', it.id, 'proposed', v_change);
  end if;

  update proj_dp_items set
    zone = case when p_fields ? 'zone' then btrim(coalesce(p_fields->>'zone', '')) else zone end,
    title = case when p_fields ? 'title' then btrim(p_fields->>'title') else title end,
    specs = case when p_fields ? 'specs' then nullif(btrim(coalesce(p_fields->>'specs', '')), '') else specs end,
    owner_id = case when p_fields ? 'owner_id' then v_owner else owner_id end,
    needed_by = case when p_fields ? 'needed_by' then nullif(p_fields->>'needed_by', '')::date else needed_by end,
    image_file_id = case when p_fields ? 'image_file_id' then v_file else image_file_id end,
    sort_order = coalesce((p_fields->>'sort_order')::integer, sort_order),
    version = version + 1, updated_at = now()
  where id = it.id;
  perform proj_dp_touch(v.id);
  return jsonb_build_object('id', it.id, 'updated', true);
exception when unique_violation then
  raise exception 'Another deliverable in this zone already has that name' using errcode = '23505';
end;
$$;

create or replace function proj_dp_save_line(p_item_id uuid, p_line_id uuid, p_fields jsonb, p_expected_version integer default null, p_source text default 'screen')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; it proj_dp_items; ln proj_dp_lines; v_id uuid; v_section text; v_desc text; v_assignee uuid; v_inv uuid; v_diff jsonb := '{}'::jsonb; v_change uuid; f text; v_qty numeric;
begin
  select * into it from proj_dp_items where id = p_item_id and removed_at is null;
  if not found then raise exception 'Deliverable not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(it.project_id);
  perform proj_require_member_or_founder(v);
  perform proj_require_open_project(v);
  if p_line_id is not null then
    select * into ln from proj_dp_lines where id = p_line_id and item_id = it.id and removed_at is null for update;
    if not found then raise exception 'Line not found' using errcode = 'P0002'; end if;
    v_section := ln.section;
  else
    v_section := p_fields->>'section';
    if v_section is null or v_section not in ('hardware', 'content', 'programming', 'installation', 'testing') then
      raise exception 'Choose the section: Hardware, Content, Programming, Installation or Testing' using errcode = '22023';
    end if;
  end if;
  if not proj_dp_can_edit_section(v.id, v_section) then
    raise exception 'Only the Project Manager, or the person this section was delegated to, can change this section' using errcode = '42501';
  end if;
  if p_fields ? 'assignee_id' and nullif(p_fields->>'assignee_id', '') is not null then
    v_assignee := (p_fields->>'assignee_id')::uuid;
    if not proj_dp_active_member(v.id, v_assignee) then raise exception 'The person assigned must be an active member of the project' using errcode = '22023'; end if;
  end if;
  if p_fields ? 'inv_item_id' and nullif(p_fields->>'inv_item_id', '') is not null then
    v_inv := (p_fields->>'inv_item_id')::uuid;
    if v_section <> 'hardware' then raise exception 'Only a Hardware line names a stock item' using errcode = '22023'; end if;
    if to_regclass('public.inv_items') is null then raise exception 'Inventory is not installed, so a stock item cannot be chosen' using errcode = '22023'; end if;
    perform 1 from inv_items i where i.id = v_inv and i.company_id = v.company_id;
    if not found then raise exception 'Unknown stock item' using errcode = '22023'; end if;
  end if;
  if p_fields ? 'qty' and nullif(p_fields->>'qty', '') is not null then
    v_qty := (p_fields->>'qty')::numeric;
    if v_qty <= 0 then raise exception 'The quantity must be more than zero' using errcode = '22023'; end if;
  end if;

  if p_line_id is null then
    v_desc := btrim(coalesce(p_fields->>'description', ''));
    if length(v_desc) = 0 then raise exception 'Describe the line' using errcode = '22023'; end if;
    select id into v_id from proj_dp_lines where item_id = it.id and section = v_section and removed_at is null and lower(btrim(description)) = lower(v_desc);
    if v_id is not null then return jsonb_build_object('id', v_id, 'existing', true); end if;
    insert into proj_dp_lines (project_id, item_id, line_key, section, description, qty, inv_item_id, assignee_id, needed_by, notes, sort_order, created_by)
    values (v.id, it.id, proj_dp_next_key(v.id, 'line'), v_section, v_desc, v_qty, v_inv, v_assignee, nullif(p_fields->>'needed_by', '')::date,
            nullif(btrim(coalesce(p_fields->>'notes', '')), ''),
            coalesce((p_fields->>'sort_order')::integer, (select coalesce(max(sort_order), 0) + 10 from proj_dp_lines where item_id = it.id)), auth.uid())
    returning id into v_id;
    perform proj_dp_touch(v.id);
    return jsonb_build_object('id', v_id, 'created', true);
  end if;

  if p_expected_version is not null and ln.version <> p_expected_version then
    raise exception 'This line was changed by someone else. Reload and try again' using errcode = '40001';
  end if;
  if p_fields ? 'description' and length(btrim(coalesce(p_fields->>'description', ''))) = 0 then raise exception 'Describe the line' using errcode = '22023'; end if;

  if ln.released_at is not null then
    foreach f in array array['description', 'qty', 'inv_item_id', 'assignee_id', 'needed_by'] loop
      if p_fields ? f and (case when f = 'qty' then (ln.qty is distinct from v_qty) else (to_jsonb(ln)->>f) is distinct from nullif(btrim(coalesce(p_fields->>f, '')), '') end) then
        v_diff := v_diff || jsonb_build_object(f, jsonb_build_object('from', to_jsonb(ln)->f, 'to', case when nullif(btrim(coalesce(p_fields->>f, '')), '') is null then 'null'::jsonb else to_jsonb(btrim(p_fields->>f)) end));
      end if;
    end loop;
    -- Notes are not a commitment: they change directly.
    if p_fields ? 'notes' then update proj_dp_lines set notes = nullif(btrim(coalesce(p_fields->>'notes', '')), ''), updated_at = now() where id = ln.id; end if;
    if v_diff = '{}'::jsonb then return jsonb_build_object('id', ln.id, 'unchanged', true); end if;
    if proj_dp_line_booked(ln.request_line_id) then
      raise exception 'This equipment is already with the warehouse. Change it on the Equipment tab; the plan cannot change a booking' using errcode = '23514';
    end if;
    update proj_dp_changes set status = 'withdrawn' where line_id = ln.id and status = 'proposed';
    insert into proj_dp_changes (project_id, line_id, changes, reason, source, proposed_by)
      values (v.id, ln.id, v_diff, nullif(btrim(coalesce(p_fields->>'reason', '')), ''), case when p_source = 'excel' then 'excel' else 'screen' end, auth.uid()) returning id into v_change;
    perform proj_dp_touch(v.id);
    return jsonb_build_object('id', ln.id, 'proposed', v_change);
  end if;

  update proj_dp_lines set
    description = case when p_fields ? 'description' then btrim(p_fields->>'description') else description end,
    qty = case when p_fields ? 'qty' then v_qty else qty end,
    inv_item_id = case when p_fields ? 'inv_item_id' then v_inv else inv_item_id end,
    assignee_id = case when p_fields ? 'assignee_id' then v_assignee else assignee_id end,
    needed_by = case when p_fields ? 'needed_by' then nullif(p_fields->>'needed_by', '')::date else needed_by end,
    notes = case when p_fields ? 'notes' then nullif(btrim(coalesce(p_fields->>'notes', '')), '') else notes end,
    sort_order = coalesce((p_fields->>'sort_order')::integer, sort_order),
    version = version + 1, updated_at = now()
  where id = ln.id;
  perform proj_dp_touch(v.id);
  return jsonb_build_object('id', ln.id, 'updated', true);
exception when unique_violation then
  raise exception 'This deliverable already has that line in this section' using errcode = '23505';
end;
$$;

create or replace function proj_dp_delegate(p_project_id uuid, p_section text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v proj_projects;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_open_project(v);
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager, a temporary project leader or a founder can delegate a section' using errcode = '42501'; end if;
  if p_section not in ('hardware', 'content', 'programming', 'installation', 'testing') then raise exception 'Unknown section' using errcode = '22023'; end if;
  if p_user is null then
    delete from proj_dp_delegations where project_id = v.id and section = p_section;
  else
    if not proj_dp_active_member(v.id, p_user) then raise exception 'A section is delegated to an active member of the project' using errcode = '22023'; end if;
    insert into proj_dp_delegations (project_id, section, user_id, delegated_by) values (v.id, p_section, p_user, auth.uid())
      on conflict (project_id, section) do update set user_id = excluded.user_id, delegated_by = excluded.delegated_by, delegated_at = now();
    perform proj_notify(v.id, p_user, 'project_plan_delegated', jsonb_build_object('name', v.name, 'reference', v.reference, 'section', p_section), 'dp-del:' || v.id || ':' || p_section || ':' || p_user);
  end if;
  perform proj_dp_touch(v.id);
end;
$$;

create or replace function proj_dp_release(p_project_id uuid, p_item_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; it proj_dp_items; ln proj_dp_lines;
  v_tasks integer := 0; v_equipment integer := 0; v_already integer := 0; v_skipped jsonb := '[]'::jsonb;
  v_task uuid; v_request uuid; v_req_line uuid; v_assignee uuid; v_due date; v_title text; v_status text;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_open_project(v);
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager, a temporary project leader or a founder can release the plan' using errcode = '42501'; end if;

  for it in select * from proj_dp_items i where i.project_id = v.id and i.removed_at is null and (p_item_ids is null or i.id = any (p_item_ids)) order by i.sort_order, i.item_key loop
    for ln in select * from proj_dp_lines l where l.item_id = it.id and l.removed_at is null order by l.sort_order, l.line_key for update loop
      if ln.released_at is not null then v_already := v_already + 1; continue; end if;
      v_due := coalesce(ln.needed_by, it.needed_by);
      if ln.section = 'hardware' then
        if ln.inv_item_id is null then
          v_skipped := v_skipped || jsonb_build_object('line', ln.line_key, 'reason', 'Choose the stock item for this hardware line first'); continue;
        end if;
        if to_regclass('public.inv_requests') is null then
          v_skipped := v_skipped || jsonb_build_object('line', ln.line_key, 'reason', 'Inventory is not installed here'); continue;
        end if;
        if v_request is null then
          -- The project's draft request: the one imported from the Sales handover if it is still a draft, else the newest draft, else a new draft.
          execute 'select id from inv_requests where project_id = $1 and status = ''draft'' order by (source = ''sales_handover'') desc, created_at desc limit 1' into v_request using v.id;
          if v_request is null then
            execute 'select inv_create_request(''project'', $1, null, $2)' into v_request using v.id, 'Delivery plan';
          end if;
        end if;
        execute 'select inv_add_request_line($1, $2, $3, $4)' into v_req_line using v_request, ln.inv_item_id, coalesce(ln.qty, 1), left(it.item_key || ' ' || it.title || ': ' || ln.description, 500);
        update proj_dp_lines set request_line_id = v_req_line, released_at = now(), updated_at = now() where id = ln.id;
        v_equipment := v_equipment + 1;
      else
        v_assignee := coalesce(ln.assignee_id, it.owner_id);
        if v_assignee is null then
          v_skipped := v_skipped || jsonb_build_object('line', ln.line_key, 'reason', 'Name who does this line, or give the deliverable an accountable owner'); continue;
        end if;
        if not proj_dp_active_member(v.id, v_assignee) then
          v_skipped := v_skipped || jsonb_build_object('line', ln.line_key, 'reason', 'The person named is no longer on the project'); continue;
        end if;
        v_title := left(it.title || ': ' || ln.description, 200);
        v_task := proj_create_task(v.id, jsonb_build_object(
          'title', v_title, 'assignee_id', v_assignee, 'due_date', v_due,
          'description', left(concat_ws(E'\n', 'Delivery plan ' || it.item_key || ' / ' || ln.line_key || ' (' || initcap(ln.section) || ')',
                                         nullif('Zone: ' || it.zone, 'Zone: '), nullif('Specifications: ' || coalesce(it.specs, ''), 'Specifications: '), ln.notes), 4000)));
        update proj_dp_lines set task_id = v_task, released_at = now(), updated_at = now() where id = ln.id;
        v_tasks := v_tasks + 1;
      end if;
    end loop;
    if it.released_at is null and exists (select 1 from proj_dp_lines l where l.item_id = it.id and l.released_at is not null) then
      update proj_dp_items set released_at = now(), released_by = auth.uid(), updated_at = now() where id = it.id;
    end if;
  end loop;
  if v_tasks + v_equipment > 0 then perform proj_dp_touch(v.id); end if;
  return jsonb_build_object('tasks', v_tasks, 'equipment', v_equipment, 'already', v_already, 'skipped', v_skipped, 'request_id', v_request);
end;
$$;

create or replace function proj_dp_decide_change(p_change_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare ch proj_dp_changes; v proj_projects; ln proj_dp_lines; f text; v_to jsonb;
begin
  select * into ch from proj_dp_changes where id = p_change_id for update;
  if not found then raise exception 'Proposed change not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(ch.project_id);
  perform proj_require_open_project(v);
  if p_decision = 'withdrawn' then
    if ch.proposed_by <> auth.uid() and not proj_can_manage(v.id) then raise exception 'Only the person who proposed it, or the Project Manager, can withdraw it' using errcode = '42501'; end if;
    if ch.status <> 'proposed' then return; end if;
    update proj_dp_changes set status = 'withdrawn' where id = ch.id;
    perform proj_dp_touch(v.id);
    return;
  end if;
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager, a temporary project leader or a founder can decide a change to released work' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Approve or reject the change' using errcode = '22023'; end if;
  if ch.status <> 'proposed' then
    if ch.status = p_decision then return; end if;   -- a repeated click
    raise exception 'This change was already %', ch.status using errcode = '23514';
  end if;
  if p_decision = 'rejected' and length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Say why it is rejected' using errcode = '22023'; end if;

  if p_decision = 'approved' then
    if ch.item_id is not null then
      for f, v_to in select key, value->'to' from jsonb_each(ch.changes) loop
        if f = 'zone' then update proj_dp_items set zone = coalesce(v_to #>> '{}', '') where id = ch.item_id;
        elsif f = 'title' then update proj_dp_items set title = v_to #>> '{}' where id = ch.item_id;
        elsif f = 'specs' then update proj_dp_items set specs = v_to #>> '{}' where id = ch.item_id;
        elsif f = 'owner_id' then update proj_dp_items set owner_id = (v_to #>> '{}')::uuid where id = ch.item_id;
        elsif f = 'needed_by' then update proj_dp_items set needed_by = (v_to #>> '{}')::date where id = ch.item_id;
        end if;
      end loop;
      update proj_dp_items set version = version + 1, updated_at = now() where id = ch.item_id;
    else
      select * into ln from proj_dp_lines where id = ch.line_id for update;
      if proj_dp_line_booked(ln.request_line_id) then
        raise exception 'This equipment is already with the warehouse. Change it on the Equipment tab; the plan cannot change a booking' using errcode = '23514';
      end if;
      for f, v_to in select key, value->'to' from jsonb_each(ch.changes) loop
        if f = 'description' then update proj_dp_lines set description = v_to #>> '{}' where id = ln.id;
        elsif f = 'qty' then update proj_dp_lines set qty = (v_to #>> '{}')::numeric where id = ln.id;
        elsif f = 'inv_item_id' then update proj_dp_lines set inv_item_id = (v_to #>> '{}')::uuid where id = ln.id;
        elsif f = 'assignee_id' then update proj_dp_lines set assignee_id = (v_to #>> '{}')::uuid where id = ln.id;
        elsif f = 'needed_by' then update proj_dp_lines set needed_by = (v_to #>> '{}')::date where id = ln.id;
        end if;
      end loop;
      update proj_dp_lines set version = version + 1, updated_at = now() where id = ln.id;
      -- A draft equipment line follows an approved quantity (the item itself is changed on the Equipment tab).
      if ln.request_line_id is not null and ch.changes ? 'qty' and (ch.changes->'qty'->>'to') is not null then
        execute 'select inv_update_request_line($1, $2)' using ln.request_line_id, (ch.changes->'qty'->>'to')::numeric;
      end if;
      -- The person doing the linked task is told that the plan changed; their task is theirs to adjust.
      if ln.task_id is not null then
        perform proj_notify(v.id, (select assignee_id from proj_tasks where id = ln.task_id), 'project_plan_change',
                            jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', ln.task_id, 'line', ln.line_key), 'dp-chg:' || ch.id);
      end if;
    end if;
  end if;
  update proj_dp_changes set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = ch.id;
  perform proj_notify(v.id, ch.proposed_by, 'project_plan_change_decided', jsonb_build_object('name', v.name, 'reference', v.reference, 'decision', p_decision, 'change_id', ch.id), 'dp-chgd:' || ch.id);
  perform proj_dp_touch(v.id);
end;
$$;

create or replace function proj_dp_plan(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_inv boolean := to_regclass('public.inv_request_lines') is not null; v_equipment jsonb := '{}'::jsonb; v_names jsonb := '{}'::jsonb; v jsonb;
begin
  if not proj_can_view_details(p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if v_inv then
    execute $q$
      select coalesce(jsonb_object_agg(l.id, jsonb_build_object(
        'request_id', r.id, 'request_code', r.code, 'request_status', r.status, 'line_status', l.status, 'qty', l.qty,
        'reserved', coalesce((select sum(x.qty) from inv_reservations x where x.request_line_id = l.id and x.status in ('active', 'completed')), 0),
        'dispatched', coalesce((select sum(x.dispatched_qty) from inv_reservations x where x.request_line_id = l.id), 0),
        'returned', coalesce((select sum(x.returned_qty) from inv_reservations x where x.request_line_id = l.id), 0))), '{}'::jsonb)
      from inv_request_lines l join inv_requests r on r.id = l.request_id
      where l.id in (select request_line_id from proj_dp_lines where project_id = $1 and request_line_id is not null)
    $q$ into v_equipment using p_project_id;
  end if;
  -- The NAME of a chosen stock item, for every reader of the plan (a member sees the same names on the Equipment tab). Nothing else of the catalogue is exposed.
  if to_regclass('public.inv_items') is not null then
    execute 'select coalesce(jsonb_object_agg(i.id, i.name), ''{}''::jsonb) from inv_items i where i.id in (select inv_item_id from proj_dp_lines where project_id = $1 and inv_item_id is not null)'
      into v_names using p_project_id;
  end if;
  select jsonb_build_object(
    'rev', coalesce((select rev from proj_dp_state where project_id = p_project_id), 0),
    'can_manage', proj_can_manage(p_project_id),
    'my_sections', coalesce((select jsonb_agg(d.section) from proj_dp_delegations d where d.project_id = p_project_id and d.user_id = auth.uid()), '[]'::jsonb),
    'delegations', coalesce((select jsonb_agg(jsonb_build_object('section', d.section, 'user_id', d.user_id, 'name', proj_display_name(d.user_id))) from proj_dp_delegations d where d.project_id = p_project_id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'key', i.item_key, 'zone', i.zone, 'title', i.title, 'specs', i.specs, 'owner_id', i.owner_id, 'owner_name', case when i.owner_id is null then null else proj_display_name(i.owner_id) end,
        'needed_by', i.needed_by, 'image_file_id', i.image_file_id, 'released_at', i.released_at, 'version', i.version, 'sort_order', i.sort_order,
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
            'id', l.id, 'key', l.line_key, 'section', l.section, 'description', l.description, 'qty', l.qty, 'inv_item_id', l.inv_item_id, 'inv_item_name', case when l.inv_item_id is null then null else v_names->>(l.inv_item_id::text) end,
            'assignee_id', l.assignee_id, 'assignee_name', case when l.assignee_id is null then null else proj_display_name(l.assignee_id) end,
            'needed_by', l.needed_by, 'notes', l.notes, 'released_at', l.released_at, 'version', l.version,
            'task', (select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date, 'blocked', t.blocked_at is not null, 'assignee_name', proj_display_name(t.assignee_id)) from proj_tasks t where t.id = l.task_id),
            'equipment', case when l.request_line_id is null then null else coalesce(v_equipment->(l.request_line_id::text), jsonb_build_object('missing', true)) end)
          order by l.sort_order, l.line_key) from proj_dp_lines l where l.item_id = i.id and l.removed_at is null), '[]'::jsonb))
      order by i.sort_order, i.item_key) from proj_dp_items i where i.project_id = p_project_id and i.removed_at is null), '[]'::jsonb),
    'corrections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'target_type', c.target_type, 'target_id', c.target_id, 'target_label', c.target_label, 'body', c.body, 'raised_by', c.raised_by, 'raised_by_name', proj_display_name(c.raised_by),
        'raised_at', c.raised_at, 'routed_to', c.routed_to, 'routed_to_name', case when c.routed_to is null then null else proj_display_name(c.routed_to) end, 'status', c.status,
        'decided_by_name', case when c.decided_by is null then null else proj_display_name(c.decided_by) end, 'decided_at', c.decided_at, 'decision_note', c.decision_note)
      order by c.raised_at desc) from (select * from proj_dp_corrections where project_id = p_project_id order by raised_at desc limit 200) c), '[]'::jsonb),
    'changes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ch.id, 'item_id', ch.item_id, 'line_id', ch.line_id, 'changes', ch.changes, 'reason', ch.reason, 'source', ch.source, 'proposed_by', ch.proposed_by, 'proposed_by_name', proj_display_name(ch.proposed_by),
        'proposed_at', ch.proposed_at, 'status', ch.status, 'decided_by_name', case when ch.decided_by is null then null else proj_display_name(ch.decided_by) end, 'decided_at', ch.decided_at, 'decision_note', ch.decision_note)
      order by ch.proposed_at desc) from (select * from proj_dp_changes where project_id = p_project_id order by proposed_at desc limit 200) ch), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

drop function if exists proj_dp_reconcile_task(uuid, text);
drop function if exists proj_dp_seed_scope(uuid);
drop function if exists proj_dp_add_sequence(uuid, text, jsonb);
drop function if exists proj_dp_sync_task(uuid, text[]);
drop function if exists proj_dp_line_loops(uuid, uuid[]);
drop function if exists proj_dp_clean_detail(text, jsonb);
drop function if exists proj_dp_section_label(text);
drop function if exists proj_dp_section_family(text);

drop index if exists idx_proj_dp_lines_milestone;
alter table proj_dp_lines drop constraint if exists proj_dp_lines_dates_check;
alter table proj_dp_lines drop constraint if exists proj_dp_lines_detail_check;
alter table proj_dp_lines drop constraint if exists proj_dp_lines_route_check;
alter table proj_dp_lines drop column if exists task_pending;
alter table proj_dp_lines drop column if exists depends_on;
alter table proj_dp_lines drop column if exists milestone_id;
alter table proj_dp_lines drop column if exists detail;
alter table proj_dp_lines drop column if exists supply_route;
alter table proj_dp_lines drop column if exists start_date;
drop index if exists uq_proj_dp_items_source;
alter table proj_dp_items drop constraint if exists proj_dp_items_qty_check;
alter table proj_dp_items drop column if exists source_key;
alter table proj_dp_items drop column if exists qty;
alter table proj_dp_lines drop constraint if exists proj_dp_lines_section_check;
alter table proj_dp_lines add constraint proj_dp_lines_section_check check (section in ('hardware', 'content', 'programming', 'installation', 'testing'));
alter table proj_dp_delegations drop constraint if exists proj_dp_delegations_section_check;
alter table proj_dp_delegations add constraint proj_dp_delegations_section_check check (section in ('hardware', 'content', 'programming', 'installation', 'testing'));
commit;
