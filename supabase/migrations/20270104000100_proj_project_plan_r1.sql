-- Projects & Tasks Release 1: the Project Plan. ADDITIVE ONLY. Applied AFTER 20270103000100 (and after 20261231000100, the Delivery Plan it extends).
-- No table is dropped or rewritten, no column removed, no existing row changed. Two CHECK lists are widened, nullable columns are added, and the Delivery Plan functions
-- are replaced by versions that keep every existing behaviour and add what Release 1 needs. Every existing plan record, permission and Excel import keeps working.
--
-- WHAT IT ADDS
--   Sections      apps, engineering, site (alongside hardware, content and the legacy programming, installation, testing). A legacy section keeps working and is treated as
--                 part of the same "family" for delegation: programming -> apps, installation and testing -> site.
--   Activation    proj_dp_items.qty (how many of this technology) and source_key (marks a row brought in from the accepted Sales handover, so that it is brought in ONCE).
--   Requirements  proj_dp_lines: start_date, supply_route (inventory | buy | rent | client, hardware only), detail (a small validated object: content type/count/format,
--                 app count/platform/device count, engineering kind, site kind, expected date and supplier for outside supply), milestone_id (an existing project
--                 milestone), depends_on (other lines of the same project), task_pending (an approved change the linked task could not take yet).
--   Release       as before (one task per work line, one DRAFT equipment line per stock-matched hardware line, both stored so repeating is safe) plus: the task gets the planned
--                 start date and the milestone, dependencies between released lines become existing task dependencies (every release reconciles EVERY released line of the project, so a
--                 prerequisite released later in another activation is connected; dependencies added directly to a task are never removed), and hardware without a stock match or supplied from
--                 outside stays in the plan, visible, without blocking the rest.
--   After release An approved owner, date or milestone change (a CLEARED start date, due date or milestone included, as the effective value) is applied to the linked task through the existing task functions (proj_reassign_task / proj_update_task, so the
--                 existing roles and rules decide). If the task cannot take it (finished, cancelled, the actor lacks the task role) the line carries task_pending until a manager
--                 retries it or keeps the task as it is (proj_dp_reconcile_task). The linked task is the source after release: nothing here overwrites an assignee's own edits.
--   Scope         proj_dp_seed_scope brings the accepted handover's structured technologies into the plan once; a row removed later is not brought back.
--   Sequences     proj_dp_add_sequence adds a chain of lines (each depending on the one before) such as Moodboard -> Storyboard -> First draft, with their own owners and dates.
--   Read          proj_dp_plan returns the new fields, the tasks' dates / blockers / dependencies, the project's milestones with their required tasks, and the accepted scope.
-- WHO: unchanged. Read = proj_can_view_details. Edit a deliverable and release = proj_can_manage. Edit a section's lines = the manager or that section's delegate (family-aware).
-- ROLLBACK: supabase/manual-sql/proj_project_plan_r1_90_rollback.sql removes what this adds and restores the previous function bodies (see docs/project-plan-r1-deployment.md).

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table proj_dp_lines drop constraint if exists proj_dp_lines_section_check;
alter table proj_dp_lines add constraint proj_dp_lines_section_check
  check (section in ('hardware', 'content', 'apps', 'engineering', 'site', 'programming', 'installation', 'testing'));
alter table proj_dp_delegations drop constraint if exists proj_dp_delegations_section_check;
alter table proj_dp_delegations add constraint proj_dp_delegations_section_check
  check (section in ('hardware', 'content', 'apps', 'engineering', 'site', 'programming', 'installation', 'testing'));

alter table proj_dp_items add column if not exists qty numeric(14, 3);
alter table proj_dp_items add column if not exists source_key text;
alter table proj_dp_items drop constraint if exists proj_dp_items_qty_check;
alter table proj_dp_items add constraint proj_dp_items_qty_check check (qty is null or (qty > 0 and qty < 1000000000));
create unique index if not exists uq_proj_dp_items_source on proj_dp_items(project_id, source_key) where source_key is not null;

alter table proj_dp_lines add column if not exists start_date date;
alter table proj_dp_lines add column if not exists supply_route text;
alter table proj_dp_lines add column if not exists detail jsonb not null default '{}'::jsonb;
alter table proj_dp_lines add column if not exists milestone_id uuid references proj_milestones(id);
alter table proj_dp_lines add column if not exists depends_on uuid[] not null default '{}'::uuid[];
alter table proj_dp_lines add column if not exists task_pending jsonb;
alter table proj_dp_lines drop constraint if exists proj_dp_lines_route_check;
alter table proj_dp_lines add constraint proj_dp_lines_route_check
  check (supply_route is null or (section = 'hardware' and supply_route in ('inventory', 'buy', 'rent', 'client')));
alter table proj_dp_lines drop constraint if exists proj_dp_lines_detail_check;
alter table proj_dp_lines add constraint proj_dp_lines_detail_check check (jsonb_typeof(detail) = 'object');
alter table proj_dp_lines drop constraint if exists proj_dp_lines_dates_check;
alter table proj_dp_lines add constraint proj_dp_lines_dates_check check (start_date is null or needed_by is null or needed_by >= start_date);
create index if not exists idx_proj_dp_lines_milestone on proj_dp_lines(milestone_id) where milestone_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Internal helpers (not granted)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Delegation works per family so that a person delegated the old "Programming" section can still edit "Apps" lines, and Installation / Testing delegates the "Site work" lines.
create or replace function proj_dp_section_family(p_section text)
returns text language sql immutable set search_path = public as $$
  select case p_section when 'programming' then 'apps' when 'installation' then 'site' when 'testing' then 'site' else p_section end;
$$;

create or replace function proj_dp_can_edit_section(p_project_id uuid, p_section text)
returns boolean language sql stable security definer set search_path = public as $$
  select proj_can_manage(p_project_id)
      or (proj_is_active_member(p_project_id)
          and exists (select 1 from proj_dp_delegations d where d.project_id = p_project_id and proj_dp_section_family(d.section) = proj_dp_section_family(p_section) and d.user_id = auth.uid()));
$$;

-- The small structured part of a line (what is being made, how many, on which platform ...). Only the keys of the section are accepted; text is trimmed and limited,
-- counts are whole numbers, an empty value is dropped. Anything else is refused so the record stays small and predictable.
create or replace function proj_dp_clean_detail(p_section text, p_detail jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_text text[]; v_int text[]; v_date text[]; k text; val text; v_out jsonb := '{}'::jsonb;
begin
  if p_detail is null or p_detail = 'null'::jsonb then return '{}'::jsonb; end if;
  if jsonb_typeof(p_detail) <> 'object' then raise exception 'The details of a line must be an object' using errcode = '22023'; end if;
  case proj_dp_section_family(p_section)
    when 'hardware' then v_text := array['source']; v_date := array['expected_date']; v_int := '{}';
    when 'content' then v_text := array['deliverable_type', 'format', 'resolution', 'orientation']; v_int := array['count']; v_date := '{}';
    when 'apps' then v_text := array['purpose', 'platform']; v_int := array['app_count', 'device_count']; v_date := '{}';
    when 'engineering' then v_text := array['kind']; v_int := '{}'; v_date := '{}';
    else v_text := array['kind']; v_int := '{}'; v_date := '{}';
  end case;
  for k in select jsonb_object_keys(p_detail) loop
    val := btrim(coalesce(p_detail->>k, ''));
    if not (k = any (v_text) or k = any (v_int) or k = any (v_date)) then raise exception 'Unknown detail "%" for this section', k using errcode = '22023'; end if;
    if length(val) = 0 then continue; end if;
    if k = any (v_int) then
      if val !~ '^[0-9]{1,4}$' or val::integer < 1 then raise exception 'Enter "%" as a whole number of 1 or more', k using errcode = '22023'; end if;
      v_out := v_out || jsonb_build_object(k, val::integer);
    elsif k = any (v_date) then
      begin perform val::date; exception when others then raise exception 'Enter "%" as a date', k using errcode = '22023'; end;
      v_out := v_out || jsonb_build_object(k, val);
    else
      if length(val) > 200 then raise exception '"%" is limited to 200 characters', k using errcode = '22023'; end if;
      v_out := v_out || jsonb_build_object(k, val);
    end if;
  end loop;
  return v_out;
end;
$$;

-- Would giving this line these predecessors make a loop (a predecessor, directly or further back, already depends on the line)?
create or replace function proj_dp_line_loops(p_line_id uuid, p_deps uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  with recursive chain(id) as (
    select unnest(coalesce(p_deps, '{}'::uuid[]))
    union
    select d from chain c join proj_dp_lines l on l.id = c.id, unnest(l.depends_on) d
  ) select exists (select 1 from chain where id = p_line_id);
$$;

-- Apply an approved owner / date / milestone change of a released work line to its linked task, through the existing task functions: those decide who may and what is
-- allowed. A refusal never fails the approval: the line then carries task_pending (what the task still needs, and why) for a manager to retry or to drop.
-- p_fields: any of 'assignee', 'due', 'start', 'milestone'. Returns 'none' (no task), 'applied', 'unchanged' or 'pending'.
create or replace function proj_dp_sync_task(p_line_id uuid, p_fields text[])
returns text language plpgsql security definer set search_path = public as $$
declare
  ln proj_dp_lines; it proj_dp_items; tk proj_tasks; v_owner uuid; v_due date; v_upd jsonb := '{}'::jsonb; v_failed jsonb := '{}'::jsonb; v_old jsonb; v_msg text;
  v_ok boolean; v_touched boolean := false;
begin
  select * into ln from proj_dp_lines where id = p_line_id;
  if not found or ln.task_id is null then return 'none'; end if;
  select * into it from proj_dp_items where id = ln.item_id;
  select * into tk from proj_tasks where id = ln.task_id;
  if not found then return 'none'; end if;
  v_old := coalesce(ln.task_pending->'fields', '{}'::jsonb);
  v_owner := coalesce(ln.assignee_id, it.owner_id);
  v_due := coalesce(ln.needed_by, it.needed_by);

  if 'assignee' = any (p_fields) and v_owner is not null then
    v_old := v_old - 'assignee_id';
    if v_owner is distinct from tk.assignee_id then
      v_touched := true;
      begin
        perform proj_reassign_task(tk.id, v_owner, 'Approved in the Project Plan');
      exception when others then
        v_failed := v_failed || jsonb_build_object('assignee_id', v_owner); v_msg := sqlerrm;
      end;
    end if;
  end if;
  -- A cleared date or milestone is applied too: what the task takes is the EFFECTIVE plan value, which is empty (or the activation's date, for a due date) once the line's own is
  -- cleared. The task rules still decide: a refusal leaves the line with task_pending, naming the cleared value.
  if 'due' = any (p_fields) then
    v_old := v_old - 'due_date';
    if v_due is distinct from tk.due_date then v_upd := v_upd || jsonb_build_object('due_date', v_due); end if;
  end if;
  if 'start' = any (p_fields) then
    v_old := v_old - 'start_date';
    if ln.start_date is distinct from tk.start_date then v_upd := v_upd || jsonb_build_object('start_date', ln.start_date); end if;
  end if;
  if 'milestone' = any (p_fields) then
    v_old := v_old - 'milestone_id';
    if ln.milestone_id is distinct from tk.milestone_id then v_upd := v_upd || jsonb_build_object('milestone_id', ln.milestone_id); end if;
  end if;
  if v_upd <> '{}'::jsonb then
    v_touched := true;
    begin
      perform proj_update_task(tk.id, v_upd || jsonb_build_object('reason', 'Approved in the Project Plan'));
    exception when others then
      v_failed := v_failed || v_upd; v_msg := sqlerrm;
    end;
  end if;

  v_old := v_old || v_failed;
  if v_old = '{}'::jsonb then
    update proj_dp_lines set task_pending = null, updated_at = now() where id = ln.id and task_pending is not null;
  else
    update proj_dp_lines set task_pending = jsonb_build_object('fields', v_old, 'reason', coalesce(v_msg, task_pending->>'reason'), 'at', now()), updated_at = now() where id = ln.id;
  end if;
  return case when v_failed <> '{}'::jsonb then 'pending' when v_touched then 'applied' else 'unchanged' end;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Deliverable (activation) rows: adds the quantity
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_dp_save_item(p_project_id uuid, p_item_id uuid, p_fields jsonb, p_expected_version integer default null, p_source text default 'screen')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; it proj_dp_items; v_id uuid; v_diff jsonb := '{}'::jsonb; v_change uuid; f text; l proj_dp_lines;
  v_zone text; v_title text; v_owner uuid; v_file uuid; v_qty numeric;
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
  if p_fields ? 'qty' and nullif(btrim(coalesce(p_fields->>'qty', '')), '') is not null then
    v_qty := (p_fields->>'qty')::numeric;
    if v_qty <= 0 or v_qty >= 1000000000 then raise exception 'The quantity must be more than zero' using errcode = '22023'; end if;
  end if;

  if p_item_id is null then
    v_title := btrim(coalesce(p_fields->>'title', ''));
    v_zone := btrim(coalesce(p_fields->>'zone', ''));
    if length(v_title) = 0 then raise exception 'Give the deliverable a name' using errcode = '22023'; end if;
    select id into v_id from proj_dp_items where project_id = v.id and removed_at is null and lower(btrim(zone)) = lower(v_zone) and lower(btrim(title)) = lower(v_title);
    if v_id is not null then return jsonb_build_object('id', v_id, 'existing', true); end if;
    insert into proj_dp_items (project_id, item_key, zone, title, specs, owner_id, needed_by, image_file_id, qty, sort_order, created_by)
    values (v.id, proj_dp_next_key(v.id, 'item'), v_zone, v_title, nullif(btrim(coalesce(p_fields->>'specs', '')), ''), v_owner, nullif(p_fields->>'needed_by', '')::date, v_file, v_qty,
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
    if p_fields ? 'qty' and it.qty is distinct from v_qty then
      v_diff := v_diff || jsonb_build_object('qty', jsonb_build_object('from', to_jsonb(it.qty), 'to', coalesce(to_jsonb(v_qty), 'null'::jsonb)));
    end if;
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
    qty = case when p_fields ? 'qty' then v_qty else qty end,
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

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Breakdown lines: requirements captured once
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_dp_save_line(p_item_id uuid, p_line_id uuid, p_fields jsonb, p_expected_version integer default null, p_source text default 'screen')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; it proj_dp_items; ln proj_dp_lines; v_id uuid; v_section text; v_desc text; v_assignee uuid; v_inv uuid; v_diff jsonb := '{}'::jsonb; v_change uuid; f text; v_qty numeric;
  v_start date; v_due date; v_route text; v_detail jsonb; v_milestone uuid; v_deps uuid[]; v_dep uuid; v_effective_inv uuid;
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
    if v_section is null or v_section not in ('hardware', 'content', 'apps', 'engineering', 'site', 'programming', 'installation', 'testing') then
      raise exception 'Choose the section: Hardware, Content, Apps, Engineering & integration or Site work' using errcode = '22023';
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
  if p_fields ? 'milestone_id' and nullif(p_fields->>'milestone_id', '') is not null then
    v_milestone := (p_fields->>'milestone_id')::uuid;
    if not exists (select 1 from proj_milestones m where m.id = v_milestone and m.project_id = v.id and m.status <> 'cancelled') then
      raise exception 'Unknown milestone' using errcode = '22023';
    end if;
  end if;
  if p_fields ? 'supply_route' and nullif(p_fields->>'supply_route', '') is not null then
    v_route := p_fields->>'supply_route';
    if v_section <> 'hardware' then raise exception 'Only a Hardware line has a supply route' using errcode = '22023'; end if;
    if v_route not in ('inventory', 'buy', 'rent', 'client') then raise exception 'Choose how it is supplied: Inventory, Buy, Rent or Client supplied' using errcode = '22023'; end if;
  end if;
  if p_fields ? 'depends_on' then
    select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_deps from jsonb_array_elements_text(case when jsonb_typeof(p_fields->'depends_on') = 'array' then p_fields->'depends_on' else '[]'::jsonb end) x;
    foreach v_dep in array v_deps loop
      if not exists (select 1 from proj_dp_lines d where d.id = v_dep and d.project_id = v.id and d.removed_at is null) then
        raise exception 'A line can only wait for another line of this project' using errcode = '22023';
      end if;
      if p_line_id is not null and v_dep = p_line_id then raise exception 'A line cannot wait for itself' using errcode = '23514'; end if;
    end loop;
    if p_line_id is not null and proj_dp_line_loops(p_line_id, v_deps) then raise exception 'That would create a loop between lines' using errcode = '23514'; end if;
  end if;
  if p_fields ? 'detail' then v_detail := proj_dp_clean_detail(v_section, p_fields->'detail'); end if;

  if p_line_id is null then
    v_desc := btrim(coalesce(p_fields->>'description', ''));
    if length(v_desc) = 0 then raise exception 'Describe the line' using errcode = '22023'; end if;
    select id into v_id from proj_dp_lines where item_id = it.id and section = v_section and removed_at is null and lower(btrim(description)) = lower(v_desc);
    if v_id is not null then return jsonb_build_object('id', v_id, 'existing', true); end if;
    v_start := nullif(p_fields->>'start_date', '')::date; v_due := nullif(p_fields->>'needed_by', '')::date;
    if v_start is not null and v_due is not null and v_due < v_start then raise exception 'The due date cannot be before the start date' using errcode = '23514'; end if;
    if v_inv is not null and coalesce(v_route, 'inventory') <> 'inventory' then raise exception 'A line matched to a stock item is supplied from Inventory' using errcode = '22023'; end if;
    insert into proj_dp_lines (project_id, item_id, line_key, section, description, qty, inv_item_id, assignee_id, needed_by, start_date, supply_route, detail, milestone_id, depends_on, notes, sort_order, created_by)
    values (v.id, it.id, proj_dp_next_key(v.id, 'line'), v_section, v_desc, v_qty, v_inv, v_assignee, v_due, v_start,
            case when v_section = 'hardware' then coalesce(v_route, 'inventory') end, coalesce(v_detail, '{}'::jsonb), v_milestone, coalesce(v_deps, '{}'::uuid[]),
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
  v_start := case when p_fields ? 'start_date' then nullif(p_fields->>'start_date', '')::date else ln.start_date end;
  v_due := case when p_fields ? 'needed_by' then nullif(p_fields->>'needed_by', '')::date else ln.needed_by end;
  if v_start is not null and v_due is not null and v_due < v_start then raise exception 'The due date cannot be before the start date' using errcode = '23514'; end if;
  v_effective_inv := case when p_fields ? 'inv_item_id' then v_inv else ln.inv_item_id end;
  if v_section = 'hardware' then
    if v_effective_inv is not null and coalesce(v_route, ln.supply_route, 'inventory') <> 'inventory' then
      raise exception 'A line matched to a stock item is supplied from Inventory. Clear the stock item to supply it another way' using errcode = '22023';
    end if;
    if ln.released_at is not null and v_route is not null and v_route is distinct from coalesce(ln.supply_route, 'inventory') then
      raise exception 'This hardware was released to Warehouse. Change how it is supplied on the Equipment tab' using errcode = '23514';
    end if;
  end if;

  if ln.released_at is not null then
    foreach f in array array['description', 'qty', 'inv_item_id', 'assignee_id', 'needed_by', 'start_date', 'milestone_id'] loop
      if p_fields ? f and (case when f = 'qty' then (ln.qty is distinct from v_qty) else (to_jsonb(ln)->>f) is distinct from nullif(btrim(coalesce(p_fields->>f, '')), '') end) then
        v_diff := v_diff || jsonb_build_object(f, jsonb_build_object('from', to_jsonb(ln)->f, 'to', case when nullif(btrim(coalesce(p_fields->>f, '')), '') is null then 'null'::jsonb else to_jsonb(btrim(p_fields->>f)) end));
      end if;
    end loop;
    -- Not commitments: notes and the details change directly. A dependency is applied straight to the linked task through the existing dependency rules.
    if p_fields ? 'notes' then update proj_dp_lines set notes = nullif(btrim(coalesce(p_fields->>'notes', '')), ''), updated_at = now() where id = ln.id; end if;
    if p_fields ? 'detail' then update proj_dp_lines set detail = v_detail, updated_at = now() where id = ln.id; end if;
    if p_fields ? 'depends_on' then
      update proj_dp_lines set depends_on = v_deps, updated_at = now() where id = ln.id;
      if ln.task_id is not null then
        -- Only the prerequisites THIS plan line no longer names are taken off the task; everything else on the task (added directly, or by another line) stays.
        perform proj_set_task_dependencies(ln.task_id,
          coalesce((select array_agg(d.depends_on_task_id) from proj_task_dependencies d
                     where d.task_id = ln.task_id
                       and not exists (select 1 from proj_dp_lines gone where gone.task_id = d.depends_on_task_id and gone.id = any (ln.depends_on) and not (gone.id = any (v_deps)))), '{}'::uuid[])
          || coalesce((select array_agg(dl.task_id) from proj_dp_lines dl where dl.id = any (v_deps) and dl.task_id is not null), '{}'::uuid[]));
      end if;
    end if;
    if v_diff = '{}'::jsonb then
      perform proj_dp_touch(v.id);
      return jsonb_build_object('id', ln.id, 'unchanged', true);
    end if;
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
    needed_by = v_due, start_date = v_start,
    supply_route = case when section = 'hardware' then case when p_fields ? 'supply_route' then coalesce(v_route, 'inventory') else coalesce(supply_route, 'inventory') end end,
    detail = case when p_fields ? 'detail' then v_detail else detail end,
    milestone_id = case when p_fields ? 'milestone_id' then v_milestone else milestone_id end,
    depends_on = case when p_fields ? 'depends_on' then v_deps else depends_on end,
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

-- A chain of lines, each waiting for the one before it (Moodboard -> Storyboard -> First draft -> Client review -> Final export -> On-device test). The steps are whatever the
-- caller sends: names, owners and dates are the person's. Goes through proj_dp_save_line, so the same permission and the same "same name = same line" rule apply, and
-- repeating it adds nothing. p_steps: [{"description", "assignee_id", "start_date", "needed_by", "milestone_id"}], 1 to 12.
create or replace function proj_dp_add_sequence(p_item_id uuid, p_section text, p_steps jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s jsonb; res jsonb; v_prev uuid; v_ids jsonb := '[]'::jsonb; v_created integer := 0; v_fields jsonb;
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then raise exception 'Add at least one step' using errcode = '22023'; end if;
  if jsonb_array_length(p_steps) > 12 then raise exception 'A sequence has at most 12 steps' using errcode = '22023'; end if;
  for s in select * from jsonb_array_elements(p_steps) loop
    v_fields := jsonb_build_object('section', p_section) || (s - 'depends_on' - 'section');
    if v_prev is not null then v_fields := v_fields || jsonb_build_object('depends_on', jsonb_build_array(v_prev)); end if;
    res := proj_dp_save_line(p_item_id, null, v_fields, null, 'screen');
    v_prev := (res->>'id')::uuid;
    v_ids := v_ids || to_jsonb(v_prev);
    if res ? 'created' then v_created := v_created + 1; end if;
  end loop;
  return jsonb_build_object('lines', v_ids, 'created', v_created);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Delegation: any of the sections
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_dp_delegate(p_project_id uuid, p_section text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v proj_projects;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_open_project(v);
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager, a temporary project leader or a founder can delegate a section' using errcode = '42501'; end if;
  if p_section not in ('hardware', 'content', 'apps', 'engineering', 'site', 'programming', 'installation', 'testing') then raise exception 'Unknown section' using errcode = '22023'; end if;
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

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Scope: bring the accepted handover's technologies into the plan ONCE
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Each technology becomes one deliverable (no zone) with its quantity, keyed 'tech:<name>'. A technology already in the plan by name, or already brought in and since removed, is
-- left alone, so opening the plan or retrying the acceptance never duplicates a row or undoes the Project Manager's edits.
create or replace function proj_dp_seed_scope(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; d proj_project_details; t jsonb; v_name text; v_key text; v_qty numeric; v_added integer := 0; v_existing integer := 0;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_member_or_founder(v);
  perform proj_require_open_project(v);
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager, a temporary project leader or a founder can bring the accepted scope into the plan' using errcode = '42501'; end if;
  select * into d from proj_project_details where project_id = v.id;
  if not found or jsonb_typeof(d.technologies) <> 'array' then return jsonb_build_object('added', 0, 'existing', 0); end if;
  for t in select * from jsonb_array_elements(d.technologies) loop
    if jsonb_typeof(t) <> 'object' then continue; end if;
    v_name := left(btrim(coalesce(t->>'name', '')), 200);
    if length(v_name) = 0 then continue; end if;
    v_key := 'tech:' || lower(v_name);
    v_qty := case when (t->>'qty') ~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' and (t->>'qty')::numeric > 0 then (t->>'qty')::numeric end;
    if exists (select 1 from proj_dp_items i where i.project_id = v.id and (i.source_key = v_key or (i.removed_at is null and lower(btrim(i.zone)) = '' and lower(btrim(i.title)) = lower(v_name)))) then
      v_existing := v_existing + 1; continue;
    end if;
    insert into proj_dp_items (project_id, item_key, zone, title, qty, sort_order, source_key, created_by)
    values (v.id, proj_dp_next_key(v.id, 'item'), '', v_name, v_qty, (select coalesce(max(sort_order), 0) + 10 from proj_dp_items where project_id = v.id), v_key, auth.uid());
    v_added := v_added + 1;
  end loop;
  if v_added > 0 then perform proj_dp_touch(v.id); end if;
  return jsonb_build_object('added', v_added, 'existing', v_existing);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Release
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- p_item_ids null = the whole plan. Returns {"tasks", "equipment", "already", "external", "dependencies", "skipped": [{"line", "reason"}], "request_id"}.
create or replace function proj_dp_release(p_project_id uuid, p_item_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; it proj_dp_items; ln proj_dp_lines;
  v_tasks integer := 0; v_equipment integer := 0; v_already integer := 0; v_external integer := 0; v_deps integer := 0; v_skipped jsonb := '[]'::jsonb;
  v_task uuid; v_request uuid; v_req_line uuid; v_assignee uuid; v_due date; v_title text; v_route text; v_want uuid[]; v_have uuid[];
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_open_project(v);
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager, a temporary project leader or a founder can release the plan' using errcode = '42501'; end if;

  for it in select * from proj_dp_items i where i.project_id = v.id and i.removed_at is null and (p_item_ids is null or i.id = any (p_item_ids)) order by i.sort_order, i.item_key loop
    for ln in select * from proj_dp_lines l where l.item_id = it.id and l.removed_at is null order by l.sort_order, l.line_key for update loop
      if ln.released_at is not null then v_already := v_already + 1; continue; end if;
      v_due := coalesce(ln.needed_by, it.needed_by);
      if ln.section = 'hardware' then
        v_route := coalesce(ln.supply_route, 'inventory');
        if v_route <> 'inventory' then
          -- Bought, rented or supplied by the client: followed in the plan, never a Warehouse request.
          v_external := v_external + 1; continue;
        end if;
        if ln.inv_item_id is null then
          v_skipped := v_skipped || jsonb_build_object('line', ln.line_key, 'reason', 'Choose the stock item for this hardware line first'); continue;
        end if;
        if to_regclass('public.inv_requests') is null then
          v_skipped := v_skipped || jsonb_build_object('line', ln.line_key, 'reason', 'Inventory is not installed here'); continue;
        end if;
        if v_request is null then
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
        if ln.start_date is not null and v_due is not null and v_due < ln.start_date then
          v_skipped := v_skipped || jsonb_build_object('line', ln.line_key, 'reason', 'The due date is before the start date'); continue;
        end if;
        if ln.milestone_id is not null and not exists (select 1 from proj_milestones m where m.id = ln.milestone_id and m.project_id = v.id and m.status <> 'cancelled') then
          v_skipped := v_skipped || jsonb_build_object('line', ln.line_key, 'reason', 'The milestone chosen is no longer in use'); continue;
        end if;
        v_title := left(it.title || ': ' || ln.description, 200);
        v_task := proj_create_task(v.id, jsonb_build_object(
          'title', v_title, 'assignee_id', v_assignee, 'due_date', v_due, 'start_date', ln.start_date, 'milestone_id', ln.milestone_id,
          'description', left(concat_ws(E'\n', 'Project Plan ' || it.item_key || ' / ' || ln.line_key || ' (' || proj_dp_section_label(ln.section) || ')',
                                         nullif('Zone: ' || it.zone, 'Zone: '), nullif('Specifications: ' || coalesce(it.specs, ''), 'Specifications: '), ln.notes), 4000)));
        update proj_dp_lines set task_id = v_task, released_at = now(), updated_at = now() where id = ln.id;
        v_tasks := v_tasks + 1;
      end if;
    end loop;
    if it.released_at is null and exists (select 1 from proj_dp_lines l where l.item_id = it.id and l.released_at is not null) then
      update proj_dp_items set released_at = now(), released_by = auth.uid(), updated_at = now() where id = it.id;
    end if;
  end loop;

  -- Dependencies between lines become task dependencies as soon as BOTH tasks exist. This looks at EVERY released line of the project, not only the activations selected for this
  -- release: a prerequisite released after its dependent task (in another activation) is connected by the release that created its task. Dependencies added directly to a task are kept.
  for ln in select l.* from proj_dp_lines l where l.project_id = v.id and l.removed_at is null and l.task_id is not null and cardinality(l.depends_on) > 0
                order by l.sort_order, l.line_key loop
    select coalesce(array_agg(x.task_id), '{}'::uuid[]) into v_want from proj_dp_lines x where x.id = any (ln.depends_on) and x.removed_at is null and x.task_id is not null;
    if cardinality(v_want) = 0 then continue; end if;
    v_have := coalesce((select array_agg(d.depends_on_task_id) from proj_task_dependencies d where d.task_id = ln.task_id), '{}'::uuid[]);
    if v_want <@ v_have then continue; end if;
    begin
      perform proj_set_task_dependencies(ln.task_id, v_want || v_have);
      v_deps := v_deps + 1;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('line', ln.line_key, 'reason', 'Dependency not applied: ' || sqlerrm);
    end;
  end loop;

  if v_tasks + v_equipment + v_deps > 0 then perform proj_dp_touch(v.id); end if;
  return jsonb_build_object('tasks', v_tasks, 'equipment', v_equipment, 'already', v_already, 'external', v_external, 'dependencies', v_deps, 'skipped', v_skipped, 'request_id', v_request);
end;
$$;

create or replace function proj_dp_section_label(p_section text)
returns text language sql immutable set search_path = public as $$
  select case p_section when 'hardware' then 'Hardware' when 'content' then 'Content' when 'apps' then 'Apps' when 'engineering' then 'Engineering & integration'
                        when 'site' then 'Site work' when 'programming' then 'Programming' when 'installation' then 'Installation' when 'testing' then 'Testing' else initcap(p_section) end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Approving a proposed change to released work
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_dp_decide_change(p_change_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare ch proj_dp_changes; v proj_projects; ln proj_dp_lines; l2 proj_dp_lines; f text; v_to jsonb; v_sync text[] := '{}'; v_item_sync text[] := '{}';
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
    if ch.status = p_decision then return; end if;
    raise exception 'This change was already %', ch.status using errcode = '23514';
  end if;
  if p_decision = 'rejected' and length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Say why it is rejected' using errcode = '22023'; end if;

  if p_decision = 'approved' then
    if ch.item_id is not null then
      for f, v_to in select key, value->'to' from jsonb_each(ch.changes) loop
        if f = 'zone' then update proj_dp_items set zone = coalesce(v_to #>> '{}', '') where id = ch.item_id;
        elsif f = 'title' then update proj_dp_items set title = v_to #>> '{}' where id = ch.item_id;
        elsif f = 'specs' then update proj_dp_items set specs = v_to #>> '{}' where id = ch.item_id;
        elsif f = 'owner_id' then update proj_dp_items set owner_id = (v_to #>> '{}')::uuid where id = ch.item_id; v_item_sync := v_item_sync || 'assignee'::text;
        elsif f = 'needed_by' then update proj_dp_items set needed_by = (v_to #>> '{}')::date where id = ch.item_id; v_item_sync := v_item_sync || 'due'::text;
        elsif f = 'qty' then update proj_dp_items set qty = (v_to #>> '{}')::numeric where id = ch.item_id;
        end if;
      end loop;
      update proj_dp_items set version = version + 1, updated_at = now() where id = ch.item_id;
      -- Lines that follow the deliverable's owner or date (they have none of their own) carry the approved change to their tasks.
      if cardinality(v_item_sync) > 0 then
        for l2 in select * from proj_dp_lines x where x.item_id = ch.item_id and x.removed_at is null and x.task_id is not null loop
          perform proj_dp_sync_task(l2.id, array(select s from unnest(v_item_sync) s where (s = 'assignee' and l2.assignee_id is null) or (s = 'due' and l2.needed_by is null)));
        end loop;
      end if;
    else
      select * into ln from proj_dp_lines where id = ch.line_id for update;
      if proj_dp_line_booked(ln.request_line_id) then
        raise exception 'This equipment is already with the warehouse. Change it on the Equipment tab; the plan cannot change a booking' using errcode = '23514';
      end if;
      for f, v_to in select key, value->'to' from jsonb_each(ch.changes) loop
        if f = 'description' then update proj_dp_lines set description = v_to #>> '{}' where id = ln.id;
        elsif f = 'qty' then update proj_dp_lines set qty = (v_to #>> '{}')::numeric where id = ln.id;
        elsif f = 'inv_item_id' then update proj_dp_lines set inv_item_id = (v_to #>> '{}')::uuid where id = ln.id;
        elsif f = 'assignee_id' then update proj_dp_lines set assignee_id = (v_to #>> '{}')::uuid where id = ln.id; v_sync := v_sync || 'assignee'::text;
        elsif f = 'needed_by' then update proj_dp_lines set needed_by = (v_to #>> '{}')::date where id = ln.id; v_sync := v_sync || 'due'::text;
        elsif f = 'start_date' then update proj_dp_lines set start_date = (v_to #>> '{}')::date where id = ln.id; v_sync := v_sync || 'start'::text;
        elsif f = 'milestone_id' then update proj_dp_lines set milestone_id = (v_to #>> '{}')::uuid where id = ln.id; v_sync := v_sync || 'milestone'::text;
        end if;
      end loop;
      update proj_dp_lines set version = version + 1, updated_at = now() where id = ln.id;
      if ln.request_line_id is not null and ch.changes ? 'qty' and (ch.changes->'qty'->>'to') is not null then
        execute 'select inv_update_request_line($1, $2)' using ln.request_line_id, (ch.changes->'qty'->>'to')::numeric;
      end if;
      if ln.task_id is not null then
        -- The existing task functions apply the owner / date / milestone (or refuse, and the line then shows "Task update pending").
        perform proj_dp_sync_task(ln.id, v_sync);
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

-- A change the linked task could not take: retry it, or keep the task as it is (the plan then follows the task).
create or replace function proj_dp_reconcile_task(p_line_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ln proj_dp_lines; v proj_projects; tk proj_tasks; v_fields text[] := '{}'; k text; v_res text;
begin
  select * into ln from proj_dp_lines where id = p_line_id and removed_at is null;
  if not found then raise exception 'Line not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(ln.project_id);
  perform proj_require_open_project(v);
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager, a temporary project leader or a founder can reconcile a task with the plan' using errcode = '42501'; end if;
  if p_action not in ('retry', 'keep_task') then raise exception 'Choose retry or keep the task as it is' using errcode = '22023'; end if;
  select * into ln from proj_dp_lines where id = p_line_id for update;
  if ln.task_id is null or ln.task_pending is null then return jsonb_build_object('status', 'nothing_pending'); end if;
  select * into tk from proj_tasks where id = ln.task_id;
  for k in select jsonb_object_keys(ln.task_pending->'fields') loop
    if k = 'assignee_id' then v_fields := v_fields || 'assignee'::text;
    elsif k = 'due_date' then v_fields := v_fields || 'due'::text;
    elsif k = 'start_date' then v_fields := v_fields || 'start'::text;
    elsif k = 'milestone_id' then v_fields := v_fields || 'milestone'::text;
    end if;
  end loop;
  if p_action = 'retry' then
    v_res := proj_dp_sync_task(ln.id, v_fields);
    perform proj_dp_touch(v.id);
    return jsonb_build_object('status', v_res);
  end if;
  update proj_dp_lines set
    assignee_id = case when 'assignee' = any (v_fields) then tk.assignee_id else assignee_id end,
    needed_by = case when 'due' = any (v_fields) then tk.due_date else needed_by end,
    start_date = case when 'start' = any (v_fields) then tk.start_date else start_date end,
    milestone_id = case when 'milestone' = any (v_fields) then tk.milestone_id else milestone_id end,
    task_pending = null, version = version + 1, updated_at = now()
  where id = ln.id;
  perform proj_dp_touch(v.id);
  return jsonb_build_object('status', 'kept_task');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_dp_plan(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_inv boolean := to_regclass('public.inv_request_lines') is not null; v_equipment jsonb := '{}'::jsonb; v_names jsonb := '{}'::jsonb; v jsonb;
        d proj_project_details; v_scope jsonb := '{}'::jsonb; v_site jsonb := '{}'::jsonb;
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
  if to_regclass('public.inv_items') is not null then
    execute 'select coalesce(jsonb_object_agg(i.id, i.name), ''{}''::jsonb) from inv_items i where i.id in (select inv_item_id from proj_dp_lines where project_id = $1 and inv_item_id is not null)'
      into v_names using p_project_id;
  end if;
  select * into d from proj_project_details where project_id = p_project_id;
  if found then
    v_site := jsonb_build_object('install_start', d.install_start, 'event_start', d.event_start, 'event_end', d.event_end);
    v_scope := jsonb_build_object(
      'brief', d.scope,
      'technologies', d.technologies,
      'pending', coalesce((select jsonb_agg(t) from jsonb_array_elements(case when jsonb_typeof(d.technologies) = 'array' then d.technologies else '[]'::jsonb end) t
                            where jsonb_typeof(t) = 'object' and length(btrim(coalesce(t->>'name', ''))) > 0
                              and not exists (select 1 from proj_dp_items i where i.project_id = p_project_id
                                                and (i.source_key = 'tech:' || lower(left(btrim(t->>'name'), 200))
                                                     or (i.removed_at is null and lower(btrim(i.zone)) = '' and lower(btrim(i.title)) = lower(left(btrim(t->>'name'), 200)))))), '[]'::jsonb));
  end if;
  select jsonb_build_object(
    'rev', coalesce((select rev from proj_dp_state where project_id = p_project_id), 0),
    'can_manage', proj_can_manage(p_project_id),
    'my_sections', coalesce((select jsonb_agg(d2.section) from proj_dp_delegations d2 where d2.project_id = p_project_id and d2.user_id = auth.uid()), '[]'::jsonb),
    'delegations', coalesce((select jsonb_agg(jsonb_build_object('section', d2.section, 'user_id', d2.user_id, 'name', proj_display_name(d2.user_id))) from proj_dp_delegations d2 where d2.project_id = p_project_id), '[]'::jsonb),
    'scope', v_scope,
    'site_dates', v_site,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'key', i.item_key, 'zone', i.zone, 'title', i.title, 'specs', i.specs, 'qty', i.qty, 'owner_id', i.owner_id, 'owner_name', case when i.owner_id is null then null else proj_display_name(i.owner_id) end,
        'needed_by', i.needed_by, 'image_file_id', i.image_file_id, 'released_at', i.released_at, 'version', i.version, 'sort_order', i.sort_order,
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
            'id', l.id, 'key', l.line_key, 'section', l.section, 'description', l.description, 'qty', l.qty, 'inv_item_id', l.inv_item_id, 'inv_item_name', case when l.inv_item_id is null then null else v_names->>(l.inv_item_id::text) end,
            'assignee_id', l.assignee_id, 'assignee_name', case when l.assignee_id is null then null else proj_display_name(l.assignee_id) end,
            'needed_by', l.needed_by, 'start_date', l.start_date, 'notes', l.notes, 'released_at', l.released_at, 'version', l.version,
            'supply_route', case when l.section = 'hardware' then coalesce(l.supply_route, 'inventory') end, 'detail', l.detail, 'milestone_id', l.milestone_id, 'task_pending', l.task_pending,
            'plan_depends_on', coalesce((select jsonb_agg(jsonb_build_object('line_id', dl.id, 'line_key', dl.line_key, 'title', dl.description, 'task_id', dl.task_id, 'status', dt.status,
                                                                             'due_date', coalesce(dt.due_date, dl.needed_by, di.needed_by)) order by dl.sort_order, dl.line_key)
                                          from proj_dp_lines dl join proj_dp_items di on di.id = dl.item_id left join proj_tasks dt on dt.id = dl.task_id
                                         where dl.id = any (l.depends_on) and dl.removed_at is null), '[]'::jsonb),
            'task', (select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'start_date', t.start_date, 'due_date', t.due_date, 'blocked', t.blocked_at is not null,
                       'blocked_reason', t.blocked_reason, 'unblock_action', t.unblock_action, 'milestone_id', t.milestone_id,
                       'assignee_id', t.assignee_id, 'assignee_name', proj_display_name(t.assignee_id),
                       'depends_on', coalesce((select jsonb_agg(jsonb_build_object('task_id', dt.id, 'title', dt.title, 'status', dt.status, 'due_date', dt.due_date, 'line_key', xl.line_key))
                                                 from proj_task_dependencies td join proj_tasks dt on dt.id = td.depends_on_task_id left join proj_dp_lines xl on xl.task_id = dt.id
                                                where td.task_id = t.id), '[]'::jsonb))
                     from proj_tasks t where t.id = l.task_id),
            'equipment', case when l.request_line_id is null then null else coalesce(v_equipment->(l.request_line_id::text), jsonb_build_object('missing', true)) end)
          order by l.sort_order, l.line_key) from proj_dp_lines l where l.item_id = i.id and l.removed_at is null), '[]'::jsonb))
      order by i.sort_order, i.item_key) from proj_dp_items i where i.project_id = p_project_id and i.removed_at is null), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'due_date', m.due_date, 'status', m.status, 'is_required', m.is_required,
        'tasks', coalesce((select jsonb_agg(jsonb_build_object('task_id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date, 'blocked', t.blocked_at is not null,
                                                               'assignee_name', proj_display_name(t.assignee_id), 'line_key', xl.line_key, 'item_key', xi.item_key) order by t.due_date nulls last, t.title)
                             from proj_tasks t left join proj_dp_lines xl on xl.task_id = t.id left join proj_dp_items xi on xi.id = xl.item_id
                            where t.milestone_id = m.id and t.status <> 'cancelled'), '[]'::jsonb),
        'planned', coalesce((select jsonb_agg(jsonb_build_object('line_id', pl.id, 'line_key', pl.line_key, 'title', pi.title || ': ' || pl.description, 'item_key', pi.item_key,
                                                                'needed_by', coalesce(pl.needed_by, pi.needed_by),
                                                                'assignee_name', case when coalesce(pl.assignee_id, pi.owner_id) is null then null else proj_display_name(coalesce(pl.assignee_id, pi.owner_id)) end) order by pl.line_key)
                             from proj_dp_lines pl join proj_dp_items pi on pi.id = pl.item_id
                            where pl.milestone_id = m.id and pl.project_id = p_project_id and pl.removed_at is null and pl.released_at is null and pi.removed_at is null), '[]'::jsonb))
      order by m.sort_order, m.due_date nulls last, m.title) from proj_milestones m where m.project_id = p_project_id and m.status <> 'cancelled'), '[]'::jsonb),
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

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Grants: internal helpers are not callable; the screens' functions are callable by signed-in users and decide for themselves.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function
  proj_dp_section_family(text), proj_dp_section_label(text), proj_dp_can_edit_section(uuid, text), proj_dp_clean_detail(text, jsonb), proj_dp_line_loops(uuid, uuid[]),
  proj_dp_sync_task(uuid, text[]),
  proj_dp_save_item(uuid, uuid, jsonb, integer, text), proj_dp_save_line(uuid, uuid, jsonb, integer, text), proj_dp_add_sequence(uuid, text, jsonb), proj_dp_delegate(uuid, text, uuid),
  proj_dp_seed_scope(uuid), proj_dp_release(uuid, uuid[]), proj_dp_decide_change(uuid, text, text), proj_dp_reconcile_task(uuid, text), proj_dp_plan(uuid)
  from public, anon, authenticated;
grant execute on function
  proj_dp_save_item(uuid, uuid, jsonb, integer, text), proj_dp_save_line(uuid, uuid, jsonb, integer, text), proj_dp_add_sequence(uuid, text, jsonb), proj_dp_delegate(uuid, text, uuid),
  proj_dp_seed_scope(uuid), proj_dp_release(uuid, uuid[]), proj_dp_decide_change(uuid, text, text), proj_dp_reconcile_task(uuid, text), proj_dp_plan(uuid)
  to authenticated;
