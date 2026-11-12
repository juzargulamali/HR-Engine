-- Projects & Tasks Phase 2, part 1: the Delivery Plan. ADDITIVE ONLY. Applied AFTER 20261230000100.
-- New tables and functions; no existing Projects, Inventory or Chat table, policy or function is changed.
--
-- WHAT IT IS
--   One row (proj_dp_items) is a deliverable in a zone, for example "Entrance" / "Interactive LED welcome wall", with its specifications, ONE accountable owner, a
--   needed-by date and an optional reference image (a project file). Under it are breakdown lines (proj_dp_lines) in the sections that apply: hardware, content,
--   programming, installation, testing. A simple job has a few rows and no lines it does not need.
--   Entered once: releasing a line turns a work line into ONE task (proj_create_task, the existing rules) and a hardware line into ONE line on the project's DRAFT
--   equipment request (inv_add_request_line, the existing rules). The plan stores the link, so saving, importing or releasing again never creates a second one.
--   Submitting the equipment request to the warehouse stays the existing explicit action on the Equipment tab. Progress is read from the linked task and request line.
--
-- WHO
--   Read: everyone who can read the project's details (proj_can_view_details: active members, founders). The plan carries no price, cost or margin.
--   Edit a deliverable row: whoever manages the project (proj_can_manage). Edit lines: the manager, and the person a section was delegated to, for that section only.
--   Release: the manager only. Raise a correction: any reader. Decide it: the lead it was routed to, or the manager.
--   After release nothing changes silently: a change to a released row or line is a PROPOSAL (proj_dp_changes) that a manager approves or rejects. A hardware line whose
--   equipment request has left Draft is not changed from the plan at all (booked equipment is changed on the Equipment tab, the existing workflow).
--
-- STABLE IDENTIFIERS: every deliverable has an item_key (D001, D002, ...) and every line a line_key (L0001, ...), unique per project and never reused. A deliverable is
--   also unique by zone + name, and a line by deliverable + section + description, so a workbook row without a key finds the same record instead of adding a second.
-- CONCURRENCY: proj_dp_state.rev rises on every change to a project's plan. An import carries the rev its preview was made at and is refused if the plan moved on.
-- ROLLBACK: supabase/manual-sql/proj_delivery_plan_90_rollback.sql (export the five tables first: the plan is deleted; tasks and equipment lines it created stay).

create table if not exists proj_dp_state (
  project_id  uuid primary key references proj_projects(id) on delete cascade,
  rev         integer not null default 0,
  next_item   integer not null default 1,
  next_line   integer not null default 1,
  updated_at  timestamptz not null default now()
);

create table if not exists proj_dp_items (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references proj_projects(id) on delete cascade,
  item_key       text not null,
  zone           text not null default '' check (length(zone) <= 120),
  title          text not null check (length(btrim(title)) between 1 and 200),
  specs          text check (specs is null or length(specs) <= 4000),
  owner_id       uuid references auth.users(id),
  needed_by      date,
  image_file_id  uuid references proj_files(id),
  sort_order     integer not null default 0,
  released_at    timestamptz,
  released_by    uuid references auth.users(id),
  removed_at     timestamptz,
  created_by     uuid references auth.users(id),
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists uq_proj_dp_items_key on proj_dp_items(project_id, item_key);
create unique index if not exists uq_proj_dp_items_name on proj_dp_items(project_id, lower(btrim(zone)), lower(btrim(title))) where removed_at is null;
create index if not exists idx_proj_dp_items_project on proj_dp_items(project_id, sort_order);

create table if not exists proj_dp_lines (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references proj_projects(id) on delete cascade,
  item_id          uuid not null references proj_dp_items(id) on delete cascade,
  line_key         text not null,
  section          text not null check (section in ('hardware', 'content', 'programming', 'installation', 'testing')),
  description      text not null check (length(btrim(description)) between 1 and 300),
  qty              numeric(14, 3) check (qty is null or qty > 0),
  -- Hardware: the stock item to request. Left empty until someone chooses it; a hardware line without one cannot be released.
  inv_item_id      uuid,
  -- Work sections: who gets the task. Empty = the deliverable's accountable owner.
  assignee_id      uuid references auth.users(id),
  needed_by        date,
  notes            text check (notes is null or length(notes) <= 2000),
  sort_order       integer not null default 0,
  -- Set once, at release. The link is what makes release idempotent.
  task_id          uuid references proj_tasks(id),
  request_line_id  uuid,
  released_at      timestamptz,
  removed_at       timestamptz,
  created_by       uuid references auth.users(id),
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint proj_dp_lines_one_link check (task_id is null or request_line_id is null)
);
create unique index if not exists uq_proj_dp_lines_key on proj_dp_lines(project_id, line_key);
create unique index if not exists uq_proj_dp_lines_name on proj_dp_lines(item_id, section, lower(btrim(description))) where removed_at is null;
create unique index if not exists uq_proj_dp_lines_task on proj_dp_lines(task_id) where task_id is not null;
create unique index if not exists uq_proj_dp_lines_request_line on proj_dp_lines(request_line_id) where request_line_id is not null;
create index if not exists idx_proj_dp_lines_item on proj_dp_lines(item_id, sort_order);

create table if not exists proj_dp_delegations (
  project_id    uuid not null references proj_projects(id) on delete cascade,
  section       text not null check (section in ('hardware', 'content', 'programming', 'installation', 'testing')),
  user_id       uuid not null references auth.users(id),
  delegated_by  uuid references auth.users(id),
  delegated_at  timestamptz not null default now(),
  primary key (project_id, section)
);

-- A correction anyone on the project can raise from a task, a scope line, a deliverable or a breakdown line. It is routed to one lead; the Project Manager is told.
create table if not exists proj_dp_corrections (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references proj_projects(id) on delete cascade,
  target_type    text not null check (target_type in ('deliverable', 'line', 'task', 'scope')),
  target_id      uuid,
  target_label   text not null check (length(target_label) <= 300),
  body           text not null check (length(btrim(body)) between 1 and 2000),
  raised_by      uuid not null references auth.users(id),
  raised_at      timestamptz not null default now(),
  routed_to      uuid references auth.users(id),
  status         text not null default 'open' check (status in ('open', 'accepted', 'declined')),
  decided_by     uuid references auth.users(id),
  decided_at     timestamptz,
  decision_note  text,
  constraint proj_dp_corrections_decided check ((status = 'open') = (decided_at is null))
);
create index if not exists idx_proj_dp_corrections_project on proj_dp_corrections(project_id, status, raised_at desc);

-- A proposed change to a RELEASED deliverable or line. Nothing released changes until a manager approves it.
create table if not exists proj_dp_changes (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references proj_projects(id) on delete cascade,
  item_id        uuid references proj_dp_items(id) on delete cascade,
  line_id        uuid references proj_dp_lines(id) on delete cascade,
  -- Only the fields that would change, as { field: { "from": ..., "to": ... } }.
  changes        jsonb not null check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb),
  reason         text,
  source         text not null default 'screen' check (source in ('screen', 'excel')),
  proposed_by    uuid not null references auth.users(id),
  proposed_at    timestamptz not null default now(),
  status         text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'withdrawn')),
  decided_by     uuid references auth.users(id),
  decided_at     timestamptz,
  decision_note  text,
  constraint proj_dp_changes_target check ((item_id is null) <> (line_id is null)),
  constraint proj_dp_changes_decided check ((status in ('approved', 'rejected')) = (decided_at is not null))
);
create index if not exists idx_proj_dp_changes_project on proj_dp_changes(project_id, status, proposed_at desc);
create unique index if not exists uq_proj_dp_changes_open_item on proj_dp_changes(item_id) where status = 'proposed' and item_id is not null;
create unique index if not exists uq_proj_dp_changes_open_line on proj_dp_changes(line_id) where status = 'proposed' and line_id is not null;

do $$
declare t text;
begin
  foreach t in array array['proj_dp_state', 'proj_dp_items', 'proj_dp_lines', 'proj_dp_delegations', 'proj_dp_corrections', 'proj_dp_changes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (proj_can_view_details(project_id))', t || '_select', t);
    execute format('revoke all on table %I from anon, public', t);
    execute format('revoke insert, update, delete, truncate on table %I from authenticated', t);
    execute format('grant select on table %I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Internal helpers (not granted)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_dp_touch(p_project_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into proj_dp_state (project_id, rev) values (p_project_id, 1)
    on conflict (project_id) do update set rev = proj_dp_state.rev + 1, updated_at = now()
    returning rev into v;
  return v;
end;
$$;

create or replace function proj_dp_next_key(p_project_id uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into proj_dp_state (project_id) values (p_project_id) on conflict (project_id) do nothing;
  if p_kind = 'item' then
    update proj_dp_state set next_item = next_item + 1 where project_id = p_project_id returning next_item - 1 into n;
    return 'D' || lpad(n::text, 3, '0');
  end if;
  update proj_dp_state set next_line = next_line + 1 where project_id = p_project_id returning next_line - 1 into n;
  return 'L' || lpad(n::text, 4, '0');
end;
$$;

-- May the caller edit lines of this section? The manager always; otherwise the person the section was delegated to, while they are still on the project.
create or replace function proj_dp_can_edit_section(p_project_id uuid, p_section text)
returns boolean language sql stable security definer set search_path = public as $$
  select proj_can_manage(p_project_id)
      or (proj_is_active_member(p_project_id)
          and exists (select 1 from proj_dp_delegations d where d.project_id = p_project_id and d.section = p_section and d.user_id = auth.uid()));
$$;

create or replace function proj_dp_active_member(p_project_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (select 1 from proj_project_members m where m.project_id = p_project_id and m.user_id = p_user and m.removed_at is null);
$$;

-- Is this hardware line's equipment already beyond a draft request (submitted, being prepared, dispatched)? Then the plan may not change it.
create or replace function proj_dp_line_booked(p_request_line_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if p_request_line_id is null or to_regclass('public.inv_request_lines') is null then return false; end if;
  execute 'select exists (select 1 from inv_request_lines l join inv_requests r on r.id = l.request_id where l.id = $1 and r.status <> ''draft'')' into v using p_request_line_id;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Deliverable rows
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Fields: zone, title, specs, owner_id, needed_by, image_file_id, sort_order. A key in p_fields with JSON null clears the value; a key that is absent leaves it alone.
-- A released row is not edited here: the differences become ONE proposal for a manager to decide (returned as {"proposed": <change id>}).
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

-- Removing is for a row that was never released (nothing links to it). A released row stays: its tasks and equipment lines exist.
create or replace function proj_dp_remove_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it proj_dp_items; v proj_projects;
begin
  select * into it from proj_dp_items where id = p_item_id and removed_at is null;
  if not found then raise exception 'Deliverable not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(it.project_id);
  perform proj_require_open_project(v);
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager, a temporary project leader or a founder can remove a deliverable' using errcode = '42501'; end if;
  if it.released_at is not null or exists (select 1 from proj_dp_lines l where l.item_id = it.id and l.released_at is not null) then
    raise exception 'This deliverable has released work. Cancel its tasks or equipment lines where they live; the row stays in the plan' using errcode = '23514';
  end if;
  update proj_dp_lines set removed_at = now() where item_id = it.id and removed_at is null;
  update proj_dp_items set removed_at = now(), updated_at = now() where id = it.id;
  perform proj_dp_touch(v.id);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Breakdown lines
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
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

create or replace function proj_dp_remove_line(p_line_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ln proj_dp_lines; v proj_projects;
begin
  select * into ln from proj_dp_lines where id = p_line_id and removed_at is null;
  if not found then raise exception 'Line not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(ln.project_id);
  perform proj_require_open_project(v);
  if not proj_dp_can_edit_section(v.id, ln.section) then
    raise exception 'Only the Project Manager, or the person this section was delegated to, can change this section' using errcode = '42501';
  end if;
  if ln.released_at is not null then
    raise exception 'This line was released. Cancel its task or equipment line where it lives; the line stays in the plan' using errcode = '23514';
  end if;
  update proj_dp_lines set removed_at = now(), updated_at = now() where id = ln.id;
  perform proj_dp_touch(v.id);
end;
$$;

-- Delegating a section lets one member define its lines. p_user null takes the delegation back.
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

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Release: the manager turns unreleased lines into tasks and draft equipment lines. Safe to repeat.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- p_item_ids null = the whole plan. Returns {"tasks": n, "equipment": n, "already": n, "skipped": [{"line": key, "reason": text}], "request_id": uuid|null}.
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

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Corrections (any reader of the project) and proposals on released rows (decided by a manager)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_dp_raise_correction(p_project_id uuid, p_target_type text, p_target_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; v_label text; v_lead uuid; v_id uuid; v_body text := btrim(coalesce(p_body, '')); it proj_dp_items; ln proj_dp_lines; tk proj_tasks;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_member_or_founder(v);
  perform proj_require_open_project(v);
  if length(v_body) = 0 then raise exception 'Say what needs correcting' using errcode = '22023'; end if;
  if length(v_body) > 2000 then raise exception 'A correction is limited to 2000 characters' using errcode = '22023'; end if;
  if p_target_type = 'deliverable' then
    select * into it from proj_dp_items where id = p_target_id and project_id = v.id;
    if not found then raise exception 'Deliverable not found' using errcode = 'P0002'; end if;
    v_label := it.item_key || ' ' || it.title; v_lead := it.owner_id;
  elsif p_target_type = 'line' then
    select * into ln from proj_dp_lines where id = p_target_id and project_id = v.id;
    if not found then raise exception 'Line not found' using errcode = 'P0002'; end if;
    select * into it from proj_dp_items where id = ln.item_id;
    v_label := ln.line_key || ' ' || it.title || ': ' || ln.description;
    v_lead := coalesce((select d.user_id from proj_dp_delegations d where d.project_id = v.id and d.section = ln.section), it.owner_id);
  elsif p_target_type = 'task' then
    select * into tk from proj_tasks where id = p_target_id and project_id = v.id;
    if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
    v_label := 'Task: ' || tk.title;
    v_lead := (select t.head_user_id from proj_teams t where t.id = tk.team_id and t.removed_at is null);
  elsif p_target_type = 'scope' then
    v_label := 'Agreed scope'; p_target_id := null;
  else
    raise exception 'Unknown kind of correction' using errcode = '22023';
  end if;
  -- No lead recorded, the lead left the project, or the lead is the person raising it: it goes to the Project Manager.
  if v_lead is null or v_lead = auth.uid() or not proj_dp_active_member(v.id, v_lead) then v_lead := v.pm_user_id; end if;
  insert into proj_dp_corrections (project_id, target_type, target_id, target_label, body, raised_by, routed_to)
    values (v.id, p_target_type, p_target_id, left(v_label, 300), v_body, auth.uid(), v_lead) returning id into v_id;
  -- No text of the correction goes into a notice: only what it is about.
  perform proj_notify(v.id, v_lead, 'project_plan_correction', jsonb_build_object('name', v.name, 'reference', v.reference, 'about', left(v_label, 120), 'correction_id', v_id), 'dp-cor:' || v_id || ':' || v_lead);
  if v.pm_user_id is distinct from v_lead then
    perform proj_notify(v.id, v.pm_user_id, 'project_plan_correction', jsonb_build_object('name', v.name, 'reference', v.reference, 'about', left(v_label, 120), 'correction_id', v_id, 'fyi', true), 'dp-cor:' || v_id || ':' || v.pm_user_id);
  end if;
  return v_id;
end;
$$;

create or replace function proj_dp_decide_correction(p_correction_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c proj_dp_corrections; v proj_projects;
begin
  select * into c from proj_dp_corrections where id = p_correction_id for update;
  if not found then raise exception 'Correction not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(c.project_id);
  perform proj_require_member_or_founder(v);
  if not (proj_can_manage(v.id) or c.routed_to = auth.uid()) then
    raise exception 'The lead this correction was sent to, or the Project Manager, decides it' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'declined') then raise exception 'Accept or decline the correction' using errcode = '22023'; end if;
  if c.status <> 'open' then
    if c.status = p_decision then return; end if;   -- a repeated click
    raise exception 'This correction was already %', c.status using errcode = '23514';
  end if;
  if p_decision = 'declined' and length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Say why it is declined' using errcode = '22023'; end if;
  update proj_dp_corrections set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = c.id;
  perform proj_notify(v.id, c.raised_by, 'project_plan_correction_decided', jsonb_build_object('name', v.name, 'reference', v.reference, 'about', left(c.target_label, 120), 'decision', p_decision, 'correction_id', c.id), 'dp-cord:' || c.id);
  if v.pm_user_id is distinct from c.raised_by then
    perform proj_notify(v.id, v.pm_user_id, 'project_plan_correction_decided', jsonb_build_object('name', v.name, 'reference', v.reference, 'about', left(c.target_label, 120), 'decision', p_decision, 'correction_id', c.id, 'fyi', true), 'dp-cord:' || c.id || ':pm');
  end if;
end;
$$;

-- Approving applies the proposed values to the plan record. The linked task or draft equipment line is NOT rewritten here, except the quantity and item of a line that
-- is still on a DRAFT request (inv_update_request_line, the existing rules). A change to booked equipment is refused: it is made on the Equipment tab.
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

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Import: apply a confirmed preview in ONE transaction. Every row goes through the same save functions (so the same permissions and the same "released rows become
-- proposals" rule). Refused as a whole if the plan changed since the preview (p_expected_rev) or if any row is refused.
-- p_items: [{"ref": text, "id": uuid|null, "fields": {...}}]   p_lines: [{"item_ref": text|null, "item_id": uuid|null, "id": uuid|null, "fields": {...}}]
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_dp_apply_import(p_project_id uuid, p_expected_rev integer, p_items jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; v_rev integer; r jsonb; res jsonb; v_refs jsonb := '{}'::jsonb; v_item uuid;
  n_added integer := 0; n_updated integer := 0; n_proposed integer := 0; n_same integer := 0;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_member_or_founder(v);
  perform proj_require_open_project(v);
  select coalesce((select rev from proj_dp_state where project_id = v.id), 0) into v_rev;
  if v_rev <> coalesce(p_expected_rev, 0) then
    raise exception 'The plan changed after this preview was prepared. Upload the workbook again to see a fresh preview' using errcode = '40001';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) + jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 3000 then
    raise exception 'Too many rows in one import' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    res := proj_dp_save_item(v.id, nullif(r->>'id', '')::uuid, coalesce(r->'fields', '{}'::jsonb), null, 'excel');
    if r ? 'ref' then v_refs := v_refs || jsonb_build_object(r->>'ref', res->>'id'); end if;
    if res ? 'created' then n_added := n_added + 1; elsif res ? 'updated' then n_updated := n_updated + 1; elsif res ? 'proposed' then n_proposed := n_proposed + 1; else n_same := n_same + 1; end if;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_item := coalesce(nullif(r->>'item_id', '')::uuid, nullif(v_refs->>(r->>'item_ref'), '')::uuid);
    if v_item is null then raise exception 'A breakdown line refers to a deliverable that is not in the plan or the workbook' using errcode = '22023'; end if;
    res := proj_dp_save_line(v_item, nullif(r->>'id', '')::uuid, coalesce(r->'fields', '{}'::jsonb), null, 'excel');
    if res ? 'created' then n_added := n_added + 1; elsif res ? 'updated' then n_updated := n_updated + 1; elsif res ? 'proposed' then n_proposed := n_proposed + 1; else n_same := n_same + 1; end if;
  end loop;
  return jsonb_build_object('added', n_added, 'updated', n_updated, 'proposed', n_proposed, 'unchanged', n_same,
                            'rev', coalesce((select rev from proj_dp_state where project_id = v.id), 0));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Read: the whole plan for a reader of the project, with progress from the linked task and equipment line (never stored in the plan).
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_dp_plan(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_inv boolean := to_regclass('public.inv_request_lines') is not null; v_equipment jsonb := '{}'::jsonb; v jsonb;
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
  select jsonb_build_object(
    'rev', coalesce((select rev from proj_dp_state where project_id = p_project_id), 0),
    'can_manage', proj_can_manage(p_project_id),
    'my_sections', coalesce((select jsonb_agg(d.section) from proj_dp_delegations d where d.project_id = p_project_id and d.user_id = auth.uid()), '[]'::jsonb),
    'delegations', coalesce((select jsonb_agg(jsonb_build_object('section', d.section, 'user_id', d.user_id, 'name', proj_display_name(d.user_id))) from proj_dp_delegations d where d.project_id = p_project_id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'key', i.item_key, 'zone', i.zone, 'title', i.title, 'specs', i.specs, 'owner_id', i.owner_id, 'owner_name', case when i.owner_id is null then null else proj_display_name(i.owner_id) end,
        'needed_by', i.needed_by, 'image_file_id', i.image_file_id, 'released_at', i.released_at, 'version', i.version, 'sort_order', i.sort_order,
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
            'id', l.id, 'key', l.line_key, 'section', l.section, 'description', l.description, 'qty', l.qty, 'inv_item_id', l.inv_item_id,
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

revoke all on function
  proj_dp_touch(uuid), proj_dp_next_key(uuid, text), proj_dp_can_edit_section(uuid, text), proj_dp_active_member(uuid, uuid), proj_dp_line_booked(uuid),
  proj_dp_save_item(uuid, uuid, jsonb, integer, text), proj_dp_remove_item(uuid), proj_dp_save_line(uuid, uuid, jsonb, integer, text), proj_dp_remove_line(uuid),
  proj_dp_delegate(uuid, text, uuid), proj_dp_release(uuid, uuid[]), proj_dp_raise_correction(uuid, text, uuid, text), proj_dp_decide_correction(uuid, text, text),
  proj_dp_decide_change(uuid, text, text), proj_dp_apply_import(uuid, integer, jsonb, jsonb), proj_dp_plan(uuid)
  from public, anon, authenticated;
grant execute on function
  proj_dp_save_item(uuid, uuid, jsonb, integer, text), proj_dp_remove_item(uuid), proj_dp_save_line(uuid, uuid, jsonb, integer, text), proj_dp_remove_line(uuid),
  proj_dp_delegate(uuid, text, uuid), proj_dp_release(uuid, uuid[]), proj_dp_raise_correction(uuid, text, uuid, text), proj_dp_decide_correction(uuid, text, text),
  proj_dp_decide_change(uuid, text, text), proj_dp_apply_import(uuid, integer, jsonb, jsonb), proj_dp_plan(uuid)
  to authenticated;
