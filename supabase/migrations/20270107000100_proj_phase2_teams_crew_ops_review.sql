-- Projects & Tasks Phase 2, follow-up: project team setup, site-only technicians, Operations review of PM-submitted outputs. ADDITIVE ONLY.
-- Applied AFTER 20270106000100 (which is applied and is NOT edited). Nothing here moves or rewrites an existing row.
--
--   1. Teams. proj_teams.head_user_id becomes OPTIONAL so a team can be saved before its lead is known ("Lead needed"). proj_setup_teams creates only the teams named, never
--      duplicates one (same name, case and spacing ignored), fills a MISSING lead and never overwrites an existing one, and refuses to add a lead to the project unless the caller
--      confirmed that access. proj_save_team (Edit team) is unchanged.
--   2. Site-only technicians. A crew row may now name a company employee who is NOT a member of the project. That person reads ONLY their own assignment, through
--      proj_my_site_assignments (activity, role, venue, call time, instructions, brief readiness). No table policy is widened: they still cannot read tasks, files, chat,
--      reviews or the commercial record. Removing the crew row (or the activity ending) ends the access. Crew assignments are checked against the existing booking overlap rule.
--   3. Operations review. A version submitted by the Project Manager (on anyone's task) is routed to an Operations Manager of the company. Neither the submitter nor the task's
--      assignee can decide it, even holding the Operations role. A new version has its own review; a decision is bound to the exact current version (unchanged).
-- Rollback: supabase/manual-sql/proj_phase2_teams_crew_ops_review_90_rollback.sql

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 0. Change log: team entries
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table proj_change_log drop constraint if exists proj_change_log_entity_type_check;
alter table proj_change_log add constraint proj_change_log_entity_type_check check (entity_type in
  ('project', 'milestone', 'deliverable', 'plan_item', 'booking', 'member', 'message', 'external_dependency', 'task_output', 'site_activity', 'shipment', 'team'));

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 1. Teams: lead optional, presets recorded, one idempotent setup call
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table proj_teams alter column head_user_id drop not null;
alter table proj_teams add column if not exists preset_key text;
alter table proj_teams drop constraint if exists proj_teams_preset_key;
alter table proj_teams add constraint proj_teams_preset_key check (preset_key is null or preset_key in ('content', 'programming', 'engineering', 'site_installation'));

create or replace function proj_setup_teams(p_project_id uuid, p_teams jsonb, p_confirm_access boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; r jsonb; t proj_teams; v_name text; v_key text; v_lead uuid; v_id uuid; v_seen text[] := '{}'; v_new_members uuid[] := '{}';
  v_created integer := 0; v_existing integer := 0; v_filled integer := 0; v_added integer := 0; v_need text[] := '{}'; v_names text;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if v.status in ('completed', 'archived') then raise exception 'A completed project is read-only' using errcode = '23514'; end if;
  if p_teams is null or jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) = 0 then raise exception 'Choose at least one team' using errcode = '22023'; end if;
  if jsonb_array_length(p_teams) > 12 then raise exception 'At most 12 teams in one save' using errcode = '22023'; end if;
  -- Pass 1: validate everything and find who would be added to the project, before anything is written.
  for r in select * from jsonb_array_elements(p_teams) loop
    v_name := btrim(coalesce(r->>'name', ''));
    if length(v_name) = 0 or length(v_name) > 80 then raise exception 'Name each team (up to 80 characters)' using errcode = '22023'; end if;
    v_key := nullif(r->>'preset', '');
    if v_key is not null and v_key not in ('content', 'programming', 'engineering', 'site_installation') then raise exception 'Unknown team preset' using errcode = '22023'; end if;
    v_lead := nullif(r->>'lead_user_id', '')::uuid;
    if v_lead is not null then
      if not proj_user_eligible(v.company_id, v_lead, v.id) then raise exception 'A team lead needs Projects access in this company first' using errcode = '22023'; end if;
      if not proj_dp_active_member(v.id, v_lead) and not (v_lead = any (v_new_members)) then v_new_members := v_new_members || v_lead; end if;
    end if;
  end loop;
  if cardinality(v_new_members) > 0 and not coalesce(p_confirm_access, false) then
    select string_agg(proj_display_name(u), ', ') into v_names from unnest(v_new_members) u;
    raise exception 'Confirm access first: % will be added to this project and can then read its workspace, tasks, files and Project Chat', v_names using errcode = '23514';
  end if;
  -- Pass 2: apply. An existing team (same name) is left as it is: only a MISSING lead is filled, an existing lead is never replaced.
  for r in select * from jsonb_array_elements(p_teams) loop
    v_name := btrim(r->>'name');
    if lower(v_name) = any (v_seen) then continue; end if;
    v_seen := v_seen || lower(v_name);
    v_key := nullif(r->>'preset', '');
    v_lead := nullif(r->>'lead_user_id', '')::uuid;
    select * into t from proj_teams where project_id = v.id and removed_at is null and lower(btrim(name)) = lower(v_name);
    if found then
      v_existing := v_existing + 1;
      if t.head_user_id is null and v_lead is not null then
        if not proj_dp_active_member(v.id, v_lead) then v_added := v_added + 1; end if;
        perform proj_add_member_row(v.id, v_lead, 'member');
        update proj_teams set head_user_id = v_lead where id = t.id;
        update proj_project_members set team_id = t.id where project_id = v.id and user_id = v_lead and removed_at is null and team_id is null;
        perform proj_log_change(v.id, 'team', t.id, 'lead', null, proj_display_name(v_lead), t.name);
        perform proj_notify(v.id, v_lead, 'project_assigned', jsonb_build_object('name', v.name, 'reference', v.reference, 'team', t.name), 'project:' || v.id || ':head:' || t.id);
        v_filled := v_filled + 1;
      elsif t.head_user_id is null then v_need := v_need || t.name;
      end if;
    else
      if v_lead is not null then
        if not proj_dp_active_member(v.id, v_lead) then v_added := v_added + 1; end if;
        perform proj_add_member_row(v.id, v_lead, 'member');
      end if;
      insert into proj_teams (project_id, name, preset_key, head_user_id, created_by) values (v.id, v_name, v_key, v_lead, auth.uid()) returning id into v_id;
      if v_lead is not null then
        update proj_project_members set team_id = v_id where project_id = v.id and user_id = v_lead and removed_at is null and team_id is null;
        perform proj_notify(v.id, v_lead, 'project_assigned', jsonb_build_object('name', v.name, 'reference', v.reference, 'team', v_name), 'project:' || v.id || ':head:' || v_id);
      else v_need := v_need || v_name;
      end if;
      perform proj_log_change(v.id, 'team', v_id, 'added', null, v_name, case when v_lead is null then 'Lead needed' else 'Lead ' || proj_display_name(v_lead) end);
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'existing', v_existing, 'leads_set', v_filled, 'members_added', v_added, 'lead_needed', to_jsonb(v_need));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 2. Site-only technicians
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table proj_site_crew add column if not exists call_at timestamptz;
alter table proj_site_crew add column if not exists call_tz text;
alter table proj_site_crew add column if not exists instructions text;
alter table proj_site_crew drop constraint if exists proj_site_crew_call_tz;
alter table proj_site_crew add constraint proj_site_crew_call_tz check (call_tz is null or proj_valid_timezone(call_tz));
alter table proj_site_crew drop constraint if exists proj_site_crew_instructions;
alter table proj_site_crew add constraint proj_site_crew_instructions check (instructions is null or length(instructions) <= 1000);

alter table proj_plan_items add column if not exists crew_instructions text;
alter table proj_plan_items add column if not exists ready_hardware text not null default 'unknown';
alter table proj_plan_items add column if not exists ready_content text not null default 'unknown';
alter table proj_plan_items add column if not exists ready_app text not null default 'unknown';
alter table proj_plan_items add column if not exists ready_note text;
alter table proj_plan_items drop constraint if exists proj_plan_items_readiness;
alter table proj_plan_items add constraint proj_plan_items_readiness check (
  ready_hardware in ('unknown', 'not_ready', 'ready') and ready_content in ('unknown', 'not_ready', 'ready') and ready_app in ('unknown', 'not_ready', 'ready')
  and (crew_instructions is null or length(crew_instructions) <= 2000) and (ready_note is null or length(ready_note) <= 500));

-- A person who may be given a site assignment without being on the project: an active employee of the project's company with a working sign-in.
create or replace function proj_site_technician_eligible(p_company_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = p_user_id and p.is_active)
     and exists (select 1 from employees e where e.user_id = p_user_id and e.company_id = p_company_id and e.deleted_at is null and e.employment_status = 'active'
                   and (e.termination_date is null or e.termination_date > current_date));
$$;

-- The window an activity occupies: its timed window, else its whole days in its own zone.
create or replace function proj_activity_range(p_item_id uuid)
returns tstzrange language sql stable security definer set search_path = public as $$
  select case
    when i.starts_at is not null then tstzrange(i.starts_at, greatest(coalesce(i.ends_at, i.starts_at + interval '1 hour'), i.starts_at + interval '1 minute'), '[)')
    when i.start_date is not null then tstzrange(i.start_date::timestamp at time zone coalesce(i.tz, d.site_timezone, 'UTC'), (coalesce(i.end_date, i.start_date) + 1)::timestamp at time zone coalesce(i.tz, d.site_timezone, 'UTC'), '[)')
    else null end
  from proj_plan_items i left join proj_project_details d on d.project_id = i.project_id where i.id = p_item_id;
$$;

-- How many CONFIRMED commitments of this person overlap the activity: confirmed site bookings (with preparation and travel, the existing rule) and crew places on other CONFIRMED activities.
create or replace function proj_crew_overlaps(p_user_id uuid, p_item_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from proj_site_bookings b where b.user_id = p_user_id and b.state = 'confirmed' and proj_activity_range(p_item_id) is not null
        and tstzrange(b.starts_at - make_interval(mins => b.lead_minutes), b.ends_at + make_interval(mins => b.trail_minutes)) && proj_activity_range(p_item_id))
    + (select count(*) from proj_site_crew c join proj_plan_items o on o.id = c.plan_item_id
        where c.user_id = p_user_id and c.plan_item_id <> p_item_id and o.plan = 'site' and o.activity_state = 'confirmed' and o.status not in ('done', 'cancelled')
          and proj_activity_range(p_item_id) is not null and proj_activity_range(o.id) && proj_activity_range(p_item_id)))::integer;
$$;

-- The crew of ONE activity, set as a whole (idempotent). Rows: {user_id, role, call_local?, call_tz?, instructions?}. A person must be an active member of the project OR an eligible site
-- technician of the company. On a CONFIRMED activity an overlap with a confirmed commitment is refused unless a reason is given by someone with site-conflict authority (the booking rule);
-- on a tentative one the overlap is returned as a warning.
create or replace function proj_set_site_crew(p_item_id uuid, p_rows jsonb, p_override_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i proj_plan_items; v proj_projects; r jsonb; v_added integer := 0; v_removed integer := 0; v_changed integer := 0; v_rows integer; v_uid uuid; v_tz text; v_call timestamptz; v_ins text;
  v_over integer; v_total_over integer := 0; v_names text := ''; v_reason text := nullif(btrim(coalesce(p_override_reason, '')), ''); v_member boolean; v_existed boolean;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then raise exception 'Site activity not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(i.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Crew must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 40 then raise exception 'At most 40 crew rows per activity' using errcode = '22023'; end if;
  select coalesce(i.tz, d.site_timezone, 'UTC') into v_tz from (select 1) s left join proj_project_details d on d.project_id = v.id;
  for r in select * from jsonb_array_elements(p_rows) loop
    if (r->>'role') not in ('installation', 'standby', 'backup', 'dismantling') then raise exception 'Choose the crew role: Installation, Standby, Backup or Dismantling' using errcode = '22023'; end if;
    v_uid := (r->>'user_id')::uuid;
    if not proj_dp_active_member(v.id, v_uid) and not proj_site_technician_eligible(v.company_id, v_uid) then
      raise exception 'Crew must be members of the project or active employees of the company' using errcode = '22023';
    end if;
    if nullif(r->>'call_tz', '') is not null and not proj_valid_timezone(r->>'call_tz') then raise exception 'Unknown time zone %', r->>'call_tz' using errcode = '22023'; end if;
    if length(coalesce(r->>'instructions', '')) > 1000 then raise exception 'Instructions are limited to 1000 characters' using errcode = '22023'; end if;
    v_over := proj_crew_overlaps(v_uid, i.id);
    if v_over > 0 then
      v_total_over := v_total_over + v_over;
      v_names := v_names || case when v_names = '' then '' else ', ' end || proj_display_name(v_uid);
    end if;
  end loop;
  if v_total_over > 0 and i.activity_state = 'confirmed' then
    if v_reason is null then
      raise exception '% already has a confirmed commitment that overlaps this activity. Change the crew or the time; someone with site-conflict authority can assign them anyway with a reason', v_names using errcode = '23P01';
    end if;
    if not proj_has_capability(v.company_id, 'override_site_conflict') then raise exception 'Only a founder, or someone a founder gave site-conflict authority to, can assign overlapping crew' using errcode = '42501'; end if;
  end if;
  delete from proj_site_crew c where c.plan_item_id = i.id and not exists (
    select 1 from jsonb_array_elements(p_rows) x where (x->>'user_id')::uuid = c.user_id and x->>'role' = c.crew_role);
  get diagnostics v_removed = row_count;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_uid := (r->>'user_id')::uuid;
    v_call := case when nullif(r->>'call_local', '') is null then null else (r->>'call_local')::timestamp at time zone coalesce(nullif(r->>'call_tz', ''), v_tz) end;
    v_ins := nullif(btrim(coalesce(r->>'instructions', '')), '');
    v_existed := exists (select 1 from proj_site_crew c where c.plan_item_id = i.id and c.user_id = v_uid and c.crew_role = r->>'role');
    insert into proj_site_crew (project_id, plan_item_id, user_id, crew_role, created_by, call_at, call_tz, instructions)
    values (v.id, i.id, v_uid, r->>'role', auth.uid(), v_call, case when v_call is null then null else coalesce(nullif(r->>'call_tz', ''), v_tz) end, v_ins)
    on conflict (plan_item_id, user_id, crew_role) do update set call_at = excluded.call_at, call_tz = excluded.call_tz, instructions = excluded.instructions
      where (proj_site_crew.call_at, proj_site_crew.call_tz, proj_site_crew.instructions) is distinct from (excluded.call_at, excluded.call_tz, excluded.instructions);
    get diagnostics v_rows = row_count;
    if v_rows > 0 and v_existed then v_changed := v_changed + 1;
    elsif v_rows > 0 then
      v_added := v_added + 1;
      v_member := proj_dp_active_member(v.id, v_uid);
      perform proj_notify(v.id, v_uid, 'project_assignment',
        jsonb_build_object('name', v.name, 'reference', v.reference, 'site_assignment', not v_member, 'activity', i.title, 'role', r->>'role', 'crew_item_id', i.id), 'crew:' || i.id || ':' || v_uid || ':' || (r->>'role'), v_member);
    end if;
  end loop;
  if v_added + v_removed + v_changed > 0 then
    perform proj_log_change(v.id, 'site_activity', i.id, 'crew', null, v_added || ' added, ' || v_removed || ' removed' || case when v_changed > 0 then ', ' || v_changed || ' updated' else '' end,
      case when v_total_over > 0 and i.activity_state = 'confirmed' then 'Overlap overridden: ' || v_reason else i.title end);
  end if;
  return jsonb_build_object('added', v_added, 'removed', v_removed, 'updated', v_changed, 'overlaps', v_total_over, 'overlap_names', nullif(v_names, ''));
end;
$$;

-- The two-argument form stays (the Phase 2 verify script and rollback name it): it is the same call with no override reason.
create or replace function proj_set_site_crew(p_item_id uuid, p_rows jsonb)
returns jsonb language sql security definer set search_path = public as $$
  select proj_set_site_crew(p_item_id, p_rows, null::text);
$$;

-- Brief readiness and instructions for the crew (set by the Project Manager; shown to everyone assigned). Hardware also shows Inventory's own state, read, never stored.
create or replace function proj_set_activity_readiness(p_item_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i proj_plan_items; v proj_projects; h text; c text; a text; n text; ins text;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then raise exception 'Site activity not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(i.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  h := coalesce(nullif(p_fields->>'hardware', ''), i.ready_hardware); c := coalesce(nullif(p_fields->>'content', ''), i.ready_content); a := coalesce(nullif(p_fields->>'app', ''), i.ready_app);
  if h not in ('unknown', 'not_ready', 'ready') or c not in ('unknown', 'not_ready', 'ready') or a not in ('unknown', 'not_ready', 'ready') then raise exception 'Choose Ready, Not ready or Not known' using errcode = '22023'; end if;
  n := case when p_fields ? 'note' then nullif(btrim(coalesce(p_fields->>'note', '')), '') else i.ready_note end;
  ins := case when p_fields ? 'crew_instructions' then nullif(btrim(coalesce(p_fields->>'crew_instructions', '')), '') else i.crew_instructions end;
  if length(coalesce(n, '')) > 500 or length(coalesce(ins, '')) > 2000 then raise exception 'That text is too long' using errcode = '22023'; end if;
  if (h, c, a, n, ins) is not distinct from (i.ready_hardware, i.ready_content, i.ready_app, i.ready_note, i.crew_instructions) then return jsonb_build_object('id', i.id, 'unchanged', true); end if;
  update proj_plan_items set ready_hardware = h, ready_content = c, ready_app = a, ready_note = n, crew_instructions = ins where id = i.id;
  perform proj_log_change(v.id, 'site_activity', i.id, 'readiness', i.ready_hardware || '/' || i.ready_content || '/' || i.ready_app, h || '/' || c || '/' || a, i.title);
  return jsonb_build_object('id', i.id, 'updated', true);
end;
$$;

-- People the Project Manager may assign on site: members of the project and eligible employees of the company who are not on it (they would be SITE-ONLY).
create or replace function proj_site_technician_candidates(p_project_id uuid)
returns table (user_id uuid, name text, is_member boolean) language plpgsql stable security definer set search_path = public as $$
declare v proj_projects;
begin
  perform proj_require_user();
  select * into v from proj_projects where id = p_project_id;
  if not found or not proj_can_manage(p_project_id) then return; end if;
  return query
    select u.id, proj_display_name(u.id), proj_dp_active_member(v.id, u.id)
    from (select m.user_id as id from proj_project_members m where m.project_id = v.id and m.removed_at is null
          union select e.user_id from employees e where e.company_id = v.company_id and e.user_id is not null and e.deleted_at is null and e.employment_status = 'active') u
    where proj_site_technician_eligible(v.company_id, u.id) or proj_dp_active_member(v.id, u.id)
    order by 2 limit 500;
end;
$$;

-- What a person is assigned to on site, for themselves only. This is the ONLY read a site-only technician has: no table is opened to them. It returns the activity, their role, the venue, the
-- call time, the instructions and brief readiness: no task, file, chat, review, budget or client record. The assignment lasts while the crew row exists and the activity has not ended (a day of grace).
create or replace function proj_my_site_assignments()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'assignment_id', c.id, 'activity_id', i.id, 'project_name', p.name, 'title', i.title, 'run_label', i.run_label, 'kind', i.activity_kind, 'state', i.activity_state, 'role', c.crew_role,
        'location', i.location, 'start_date', i.start_date, 'end_date', i.end_date, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'tz', coalesce(i.tz, d.site_timezone),
        'call_at', c.call_at, 'call_tz', coalesce(c.call_tz, i.tz, d.site_timezone), 'instructions', c.instructions, 'crew_instructions', i.crew_instructions,
        'ready', jsonb_build_object('hardware', i.ready_hardware, 'content', i.ready_content, 'app', i.ready_app, 'note', i.ready_note),
        'hardware_state', (select inv_request_state(s.request_id) ->> 'state' from proj_site_shipments s where s.plan_item_id = i.id and s.request_id is not null order by s.created_at limit 1),
        'site_only', not proj_dp_active_member(c.project_id, v_uid))
      order by coalesce(i.starts_at, (i.start_date::timestamp at time zone coalesce(i.tz, d.site_timezone, 'UTC'))) nulls last, i.title)
    from proj_site_crew c
    join proj_plan_items i on i.id = c.plan_item_id and i.plan = 'site'
    join proj_projects p on p.id = c.project_id
    left join proj_project_details d on d.project_id = c.project_id
    where c.user_id = v_uid and i.status not in ('done', 'cancelled') and p.status not in ('completed', 'archived')
      and (proj_activity_range(i.id) is null or upper(proj_activity_range(i.id)) > now() - interval '1 day')
      and exists (select 1 from profiles pr where pr.id = v_uid and pr.is_active)), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 3. Operations review of outputs the Project Manager submitted
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table proj_task_output_versions add column if not exists review_route text not null default 'team';
alter table proj_task_output_versions add column if not exists reviewer_id uuid references auth.users(id);
alter table proj_task_output_versions add column if not exists reviewer_assigned_at timestamptz;
alter table proj_task_output_versions add column if not exists reviewer_assigned_by uuid references auth.users(id);
alter table proj_task_output_versions drop constraint if exists proj_output_review_route;
alter table proj_task_output_versions add constraint proj_output_review_route check (review_route in ('team', 'operations'));
create index if not exists idx_proj_output_ops_waiting on proj_task_output_versions(project_id) where review_route = 'operations' and status = 'awaiting';

create or replace function proj_is_ops_manager(p_company_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from proj_company_grants g join profiles p on p.id = g.user_id and p.is_active
                  where g.user_id = p_user_id and g.company_id = p_company_id and g.revoked_at is null and 'operations' = any (g.capabilities));
$$;
-- The Operations Managers of the company who may review a version: never the person who submitted it or the person the task is assigned to.
create or replace function proj_output_reviewer_pool(p_company_id uuid, p_submitter uuid, p_assignee uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct g.user_id from proj_company_grants g join profiles p on p.id = g.user_id and p.is_active
   where g.company_id = p_company_id and g.revoked_at is null and 'operations' = any (g.capabilities)
     and g.user_id is distinct from p_submitter and g.user_id is distinct from p_assignee;
$$;

create or replace function proj_submit_task_output(p_task_id uuid, p_file_id uuid, p_snapshot_file_id uuid default null, p_item_count integer default 1, p_note text default null,
                                                   p_mutable_link boolean default false, p_client_key text default null, p_expected_current integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t proj_tasks; v proj_projects; v_role text; v_cur integer; v_no integer; v_id uuid; v_ex proj_task_output_versions; f proj_files; v_route text; v_pool uuid[]; v_u uuid;
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  v_role := proj_task_actor_role(t);
  if v_role is null then raise exception 'Only the assignee, the head of the team or the Project Manager can submit the output' using errcode = '42501'; end if;
  if p_client_key is not null then
    select * into v_ex from proj_task_output_versions where task_id = t.id and client_key = p_client_key;
    if found then return jsonb_build_object('id', v_ex.id, 'version_no', v_ex.version_no, 'existing', true); end if;
  end if;
  if t.output_label is null then raise exception 'This task has no expected output yet. Ask the Project Manager to add one' using errcode = '23514'; end if;
  if t.status in ('done', 'cancelled', 'deferred') then raise exception 'This task is %: reopen it before submitting another version', t.status using errcode = '23514'; end if;
  select coalesce(max(version_no), 0) into v_cur from proj_task_output_versions where task_id = t.id;
  if p_expected_current is not null and p_expected_current <> v_cur then
    raise exception 'A newer version (v%) was submitted since you opened this. Reload to see it', v_cur;
  end if;
  if p_item_count is null or p_item_count < 1 or p_item_count > 999 then raise exception 'How many items does this version hold? (1 to 999)' using errcode = '22023'; end if;
  if not proj_file_usable(p_file_id, v.id) then raise exception 'That file or link is not available to you in this project' using errcode = '42501'; end if;
  if p_snapshot_file_id is not null and not proj_file_usable(p_snapshot_file_id, v.id) then raise exception 'The snapshot file is not available to you in this project' using errcode = '42501'; end if;
  select * into f from proj_files where id = p_file_id;
  -- A version submitted by the Project Manager (on anyone's task) is reviewed by an Operations Manager of the company, never by the PM or the team lead. Operations opens the
  -- evidence under the files' own rules, so a restricted file cannot be the evidence of a version that goes to them.
  v_route := case when proj_is_pm(v.id) then 'operations' else 'team' end;
  if v_route = 'operations' and (f.restricted or (p_snapshot_file_id is not null and exists (select 1 from proj_files s where s.id = p_snapshot_file_id and s.restricted))) then
    raise exception 'This version goes to Operations for review, and Operations cannot open restricted files. Use a file or link that is not restricted' using errcode = '23514';
  end if;
  v_no := v_cur + 1;
  update proj_task_output_versions set status = 'superseded' where task_id = t.id and status = 'awaiting';
  insert into proj_task_output_versions (project_id, task_id, version_no, file_id, snapshot_file_id, mutable_link, item_count, note, submitted_by, client_key, review_route)
  values (v.id, t.id, v_no, p_file_id, p_snapshot_file_id, (f.kind = 'link' and coalesce(p_mutable_link, true)), p_item_count, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_client_key, v_route)
  returning id into v_id;
  perform proj_task_event(t.id, v.id, 'output_submitted', case when v_cur = 0 then null else 'v' || v_cur end, 'v' || v_no, p_note);
  perform proj_log_change(v.id, 'task_output', t.id, 'version', case when v_cur = 0 then null else 'v' || v_cur end, 'v' || v_no, t.output_label);
  if v_route = 'operations' then
    select array_agg(u) into v_pool from proj_output_reviewer_pool(v.company_id, auth.uid(), t.assignee_id) u;
    -- Exactly one eligible Operations Manager: the review is assigned to them. Several: it waits in their queue for one of them to take it. None: it is flagged "Needs an Operations reviewer".
    if coalesce(cardinality(v_pool), 0) = 1 then
      update proj_task_output_versions set reviewer_id = v_pool[1], reviewer_assigned_at = now(), reviewer_assigned_by = auth.uid() where id = v_id;
    end if;
    foreach v_u in array coalesce(v_pool, '{}'::uuid[]) loop
      perform proj_notify(v.id, v_u, 'project_review_requested',
        jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title, 'version_id', v_id, 'version_no', v_no, 'operations', true), 'output:' || v_id || ':ops', false);
    end loop;
    perform proj_log_change(v.id, 'task_output', t.id, 'review route', null, 'Operations', 'Submitted by the Project Manager');
  end if;
  return jsonb_build_object('id', v_id, 'version_no', v_no, 'created', true, 'review_route', v_route);
end;
$$;

create or replace function proj_decide_task_output(p_version_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x proj_task_output_versions; t proj_tasks; v proj_projects; v_role text; v_cur integer; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_to text;
begin
  perform proj_require_user();
  if p_decision not in ('approved', 'changes_requested') then raise exception 'Choose Approve or Request changes' using errcode = '22023'; end if;
  select * into x from proj_task_output_versions where id = p_version_id;
  if not found then raise exception 'Version not found' using errcode = 'P0002'; end if;
  select * into t from proj_tasks where id = x.task_id for update;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  select * into x from proj_task_output_versions where id = p_version_id for update;       -- re-read under the task lock
  -- Neither the person who submitted the version nor the person the task is assigned to may decide it, whatever else they hold (an Operations role included).
  if x.submitted_by = auth.uid() or t.assignee_id = auth.uid() then raise exception 'You cannot review your own work' using errcode = '42501'; end if;
  if x.review_route = 'operations' then
    if not proj_is_ops_manager(v.company_id, auth.uid()) then raise exception 'This version is waiting for an Operations Manager. Only they can review it' using errcode = '42501'; end if;
    if x.reviewer_id is not null and x.reviewer_id <> auth.uid() then raise exception 'This review is assigned to %. Ask them, or have it reassigned', proj_display_name(x.reviewer_id) using errcode = '42501'; end if;
  else
    v_role := proj_task_actor_role(t);
    if v_role is null or v_role not in ('manager', 'head') then raise exception 'Only the department head or the Project Manager can review an output' using errcode = '42501'; end if;
  end if;
  if x.status = p_decision then return jsonb_build_object('id', x.id, 'version_no', x.version_no, 'unchanged', true); end if;
  select max(version_no) into v_cur from proj_task_output_versions where task_id = t.id;
  if x.version_no <> v_cur then
    raise exception 'Version % is no longer the current one: version % was submitted. Review that one', x.version_no, v_cur;
  end if;
  if x.status <> 'awaiting' then raise exception 'Version % was already decided (%)', x.version_no, replace(x.status, '_', ' ') using errcode = '23514'; end if;
  if p_decision = 'changes_requested' and v_note is null then raise exception 'Say what needs changing' using errcode = '22023'; end if;
  if p_decision = 'approved' then
    update proj_task_output_versions set status = 'approved', decided_by = auth.uid(), decided_at = now(), approved_by = auth.uid(), approved_at = now(), decision_note = v_note,
           reviewer_id = case when review_route = 'operations' then coalesce(reviewer_id, auth.uid()) else reviewer_id end where id = x.id;
  else
    update proj_task_output_versions set status = 'changes_requested', decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
           reviewer_id = case when review_route = 'operations' then coalesce(reviewer_id, auth.uid()) else reviewer_id end where id = x.id;
  end if;
  perform proj_task_event(t.id, v.id, 'output_decision', 'v' || x.version_no, p_decision, v_note);
  perform proj_log_change(v.id, 'task_output', t.id, 'review of v' || x.version_no, 'awaiting', p_decision, v_note);
  -- A task waiting for review moves with the decision, through the existing status path (which checks the same rules again).
  if t.status = 'ready_for_review' then
    if x.review_route = 'operations' then
      -- An Operations Manager holds no role on the task, so the task moves with their decision here (the same transition the status function makes for a reviewer).
      v_to := case when p_decision = 'approved' then 'done' else 'in_progress' end;
      if v_to = 'done' and t.blocked_at is not null then raise exception 'Clear the blocker before completing the task' using errcode = '23514'; end if;
      update proj_tasks set status = v_to, version = version + 1, completed_at = case when v_to = 'done' then now() else null end,
             completed_by = case when v_to = 'done' then auth.uid() else null end where id = t.id;
      perform proj_task_event(t.id, v.id, 'status_changed', t.status, v_to, coalesce(v_note, 'Approved'));
      perform proj_notify(v.id, t.assignee_id, 'project_review_result',
        jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title, 'result', v_to), 'task:' || t.id || ':result:' || (t.version + 1));
    else
      perform proj_set_task_status(t.id, case when p_decision = 'approved' then 'done' else 'in_progress' end, coalesce(v_note, 'Approved'), null);
    end if;
  end if;
  return jsonb_build_object('id', x.id, 'version_no', x.version_no, 'decision', p_decision);
end;
$$;

-- Assign (or release) the Operations reviewer of a version that is waiting. The Project Manager or any Operations Manager of the company may; the person must be in the eligible pool.
create or replace function proj_assign_output_reviewer(p_version_id uuid, p_reviewer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x proj_task_output_versions; t proj_tasks; v proj_projects; v_cur integer;
begin
  perform proj_require_user();
  select * into x from proj_task_output_versions where id = p_version_id;
  if not found then raise exception 'Version not found' using errcode = 'P0002'; end if;
  select * into t from proj_tasks where id = x.task_id for update;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  if not (proj_can_manage(v.id) or proj_is_ops_manager(v.company_id, auth.uid())) then raise exception 'Only the Project Manager or an Operations Manager can assign this review' using errcode = '42501'; end if;
  select * into x from proj_task_output_versions where id = p_version_id for update;
  if x.review_route <> 'operations' then raise exception 'This version is reviewed by the team, not by Operations' using errcode = '23514'; end if;
  select max(version_no) into v_cur from proj_task_output_versions where task_id = t.id;
  if x.status <> 'awaiting' or x.version_no <> v_cur then raise exception 'Only the current version that is waiting can be assigned' using errcode = '23514'; end if;
  if p_reviewer is not null and not exists (select 1 from proj_output_reviewer_pool(v.company_id, x.submitted_by, t.assignee_id) u where u = p_reviewer) then
    raise exception 'That person cannot review this version: they must be an Operations Manager and not the person who submitted it or the person it is assigned to' using errcode = '22023';
  end if;
  if x.reviewer_id is not distinct from p_reviewer then return jsonb_build_object('id', x.id, 'unchanged', true); end if;
  update proj_task_output_versions set reviewer_id = p_reviewer, reviewer_assigned_at = case when p_reviewer is null then null else now() end, reviewer_assigned_by = case when p_reviewer is null then null else auth.uid() end where id = x.id;
  perform proj_log_change(v.id, 'task_output', t.id, 'reviewer of v' || x.version_no, case when x.reviewer_id is null then null else proj_display_name(x.reviewer_id) end,
                          case when p_reviewer is null then 'Released to the Operations queue' else proj_display_name(p_reviewer) end, null);
  if p_reviewer is not null then
    perform proj_notify(v.id, p_reviewer, 'project_review_requested',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title, 'version_id', x.id, 'version_no', x.version_no, 'operations', true), 'output:' || x.id || ':ops:' || p_reviewer, false);
  end if;
  return jsonb_build_object('id', x.id, 'reviewer_id', p_reviewer, 'updated', true);
end;
$$;

-- One version as JSON for the reader: adds the review route, the reviewer, whether one is needed, who is eligible, and whether THIS reader may decide it now (the screen mirrors this).
create or replace function proj_output_version_json(p_version_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', x.id, 'version_no', x.version_no, 'status', x.status, 'item_count', x.item_count, 'mutable_link', x.mutable_link, 'note', x.note,
    'submitted_by', x.submitted_by, 'submitted_by_name', proj_display_name(x.submitted_by), 'attached_at', x.attached_at,
    'decided_at', x.decided_at, 'decided_by_name', proj_display_name(x.decided_by), 'decision_note', x.decision_note,
    'approved_at', x.approved_at, 'approved_by_name', proj_display_name(x.approved_by),
    'file', proj_output_file_json(x.file_id, x.project_id),
    'snapshot', case when x.snapshot_file_id is null then null else proj_output_file_json(x.snapshot_file_id, x.project_id) end,
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'status', f.status, 'kind', f.kind, 'source', f.source, 'text', left(f.request_text, 200), 'received_on', f.received_on) order by f.received_on, f.created_at)
                            from proj_feedback f where f.output_version_id = x.id), '[]'::jsonb),
    'route', x.review_route, 'reviewer_id', x.reviewer_id, 'reviewer_name', case when x.reviewer_id is null then null else proj_display_name(x.reviewer_id) end, 'reviewer_assigned_at', x.reviewer_assigned_at,
    'is_current', x.version_no = (select max(z.version_no) from proj_task_output_versions z where z.task_id = x.task_id),
    'needs_reviewer', (x.review_route = 'operations' and x.status = 'awaiting' and not exists (select 1 from proj_output_reviewer_pool(pr.company_id, x.submitted_by, t.assignee_id))),
    'eligible_reviewers', case when x.review_route = 'operations' and x.status = 'awaiting'
                               then coalesce((select jsonb_agg(jsonb_build_object('id', u, 'name', proj_display_name(u)) order by proj_display_name(u)) from proj_output_reviewer_pool(pr.company_id, x.submitted_by, t.assignee_id) u), '[]'::jsonb)
                               else '[]'::jsonb end,
    'can_assign', (x.review_route = 'operations' and x.status = 'awaiting' and (proj_can_manage(x.project_id) or proj_is_ops_manager(pr.company_id, auth.uid()))),
    'can_decide', (x.status = 'awaiting' and x.version_no = (select max(z.version_no) from proj_task_output_versions z where z.task_id = x.task_id)
                   and x.submitted_by is distinct from auth.uid() and t.assignee_id is distinct from auth.uid()
                   and case when x.review_route = 'operations' then proj_is_ops_manager(pr.company_id, auth.uid()) and (x.reviewer_id is null or x.reviewer_id = auth.uid())
                            else coalesce(proj_task_actor_role(t) in ('manager', 'head'), false) end))
  from proj_task_output_versions x join proj_tasks t on t.id = x.task_id join proj_projects pr on pr.id = x.project_id where x.id = p_version_id;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 4. Site activity JSON (adds crew call time, instructions, site-only flag, overlaps and readiness) and the Work overview (adds Operations review and Lead needed)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_site_activity_json(p_item_id uuid, p_tz text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'title', i.title, 'kind', i.activity_kind, 'run_label', i.run_label, 'location', i.location, 'status', i.status,
    'owner_id', i.owner_id, 'owner_name', case when i.owner_id is null then null else proj_display_name(i.owner_id) end, 'state', i.activity_state, 'confirmed_at', i.confirmed_at,
    'start_date', i.start_date, 'end_date', i.end_date, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'tz', coalesce(i.tz, p_tz), 'notes', i.notes, 'version', i.version, 'milestone_id', i.milestone_id,
    'client_facing', i.client_facing, 'crew_instructions', i.crew_instructions,
    'ready', jsonb_build_object('hardware', i.ready_hardware, 'content', i.ready_content, 'app', i.ready_app, 'note', i.ready_note),
    'crew', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', proj_display_name(c.user_id), 'role', c.crew_role, 'call_at', c.call_at, 'call_tz', c.call_tz, 'instructions', c.instructions,
                                                       'site_only', not proj_dp_active_member(i.project_id, c.user_id), 'overlaps', proj_crew_overlaps(c.user_id, i.id)) order by c.crew_role, proj_display_name(c.user_id))
                        from proj_site_crew c where c.plan_item_id = i.id), '[]'::jsonb),
    'missing', (select coalesce(jsonb_agg(m), '[]'::jsonb) from (
        select 'date' as m where i.start_date is null and i.starts_at is null and i.status not in ('done', 'cancelled')
        union all select 'time' where i.start_date is not null and i.starts_at is null and i.activity_kind in ('mockup', 'setup', 'show', 'dismantling') and i.status not in ('done', 'cancelled')
        union all select 'crew' where i.activity_kind in ('setup', 'show', 'dismantling') and i.status not in ('done', 'cancelled') and not exists (select 1 from proj_site_crew c where c.plan_item_id = i.id)) q))
  from proj_plan_items i where i.id = p_item_id;
$$;

create or replace function proj_work_overview(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v proj_projects; v_tz text; d proj_project_details; v_today date; v_next jsonb; v_attn jsonb := '[]'::jsonb; v_recent jsonb; v_pm text;
begin
  perform proj_require_user();
  select * into v from proj_projects where id = p_project_id;
  if not found or not proj_can_view_details(p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  select * into d from proj_project_details where project_id = p_project_id;
  v_tz := coalesce(d.site_timezone, 'UTC');
  v_today := (now() at time zone v_tz)::date;
  v_pm := proj_display_name(v.pm_user_id);
  select proj_site_activity_json(i.id, d.site_timezone) into v_next from proj_plan_items i
   where i.project_id = p_project_id and i.plan = 'site' and i.status not in ('done', 'cancelled') and (i.start_date is not null or i.starts_at is not null)
     and coalesce(i.end_date, i.start_date, (i.ends_at at time zone coalesce(i.tz, v_tz))::date, (i.starts_at at time zone coalesce(i.tz, v_tz))::date) >= v_today
   order by coalesce(i.starts_at, (i.start_date::timestamp at time zone v_tz)), i.sort_order limit 1;
  -- Needs attention: each line says what, who can act (when known) and where to fix it.
  select coalesce(jsonb_agg(a.j order by a.ord), '[]'::jsonb) into v_attn from (
    select 1 as ord, jsonb_build_object('kind', 'output_missing', 'task_id', t.id, 'title', t.title, 'detail', 'Required output "' || t.output_label || '" is missing' || case when cur.id is not null then ' (' || cur.item_count || ' of ' || coalesce(t.output_qty, 1) || ' provided)' else '' end,
           'who', jsonb_build_array(proj_display_name(t.assignee_id))) as j
      from proj_tasks t left join lateral (select z.id, z.item_count, z.status from proj_task_output_versions z where z.task_id = t.id order by z.version_no desc limit 1) cur on true
     where t.project_id = p_project_id and t.output_required and t.status in ('todo', 'in_progress', 'ready_for_review') and (cur.id is null or cur.item_count < coalesce(t.output_qty, 1)) and coalesce(cur.status, '') <> 'changes_requested'
    union all
    select 2, jsonb_build_object('kind', 'changes_requested', 'task_id', t.id, 'title', t.title, 'detail', 'Changes requested on version ' || cur.version_no || ': ' || coalesce(cur.decision_note, ''), 'who', jsonb_build_array(proj_display_name(t.assignee_id)))
      from proj_tasks t join lateral (select z.* from proj_task_output_versions z where z.task_id = t.id order by z.version_no desc limit 1) cur on true
     where t.project_id = p_project_id and cur.status = 'changes_requested' and t.status in ('todo', 'in_progress', 'ready_for_review')
    union all
    select 3, jsonb_build_object('kind', 'review_waiting', 'task_id', t.id, 'title', t.title, 'detail', 'Version ' || cur.version_no || ' of "' || t.output_label || '" is waiting for review',
           'who', jsonb_build_array(coalesce((select proj_display_name(tm.head_user_id) from proj_teams tm where tm.id = t.team_id and tm.head_user_id <> t.assignee_id), v_pm)))
      from proj_tasks t join lateral (select z.* from proj_task_output_versions z where z.task_id = t.id order by z.version_no desc limit 1) cur on true
     where t.project_id = p_project_id and cur.status = 'awaiting' and cur.review_route = 'team' and t.status in ('todo', 'in_progress', 'ready_for_review')
    union all
    select 4, jsonb_build_object('kind', 'site_missing', 'activity_id', i.id, 'title', i.title || coalesce(' (' || i.run_label || ')', ''), 'detail',
           'Missing: ' || (select string_agg(case m when 'date' then 'date' when 'time' then 'time' else 'crew' end, ', ') from jsonb_array_elements_text(proj_site_activity_json(i.id, d.site_timezone) -> 'missing') m), 'who', jsonb_build_array(v_pm))
      from proj_plan_items i
     where i.project_id = p_project_id and i.plan = 'site' and i.status not in ('done', 'cancelled') and jsonb_array_length(proj_site_activity_json(i.id, d.site_timezone) -> 'missing') > 0
    union all
    select 5, jsonb_build_object('kind', 'shipment_conflict', 'shipment_id', s.id, 'title', s.label, 'detail', 'Arrives after "' || a.title || '" starts', 'who', jsonb_build_array(v_pm))
      from proj_site_shipments s join proj_plan_items a on a.id = s.plan_item_id
     where s.project_id = p_project_id and s.arrives_at is not null and (
           (a.starts_at is not null and s.arrives_at > a.starts_at)
        or (a.starts_at is null and a.start_date is not null and (s.arrives_at at time zone coalesce(s.arrives_tz, v_tz))::date > a.start_date))
    union all
    select 6, jsonb_build_object('kind', 'ops_review_waiting', 'task_id', t.id, 'title', t.title,
           'detail', 'Version ' || cur.version_no || ' of "' || t.output_label || '" is waiting for Operations review' || case when cur.reviewer_id is null then '' else ' (' || proj_display_name(cur.reviewer_id) || ')' end,
           'who', case when cur.reviewer_id is not null then jsonb_build_array(proj_display_name(cur.reviewer_id))
                       else coalesce((select jsonb_agg(proj_display_name(u)) from proj_output_reviewer_pool(v.company_id, cur.submitted_by, t.assignee_id) u), '[]'::jsonb) end)
      from proj_tasks t join lateral (select z.* from proj_task_output_versions z where z.task_id = t.id order by z.version_no desc limit 1) cur on true
     where t.project_id = p_project_id and cur.status = 'awaiting' and cur.review_route = 'operations' and t.status in ('todo', 'in_progress', 'ready_for_review')
       and exists (select 1 from proj_output_reviewer_pool(v.company_id, cur.submitted_by, t.assignee_id))
    union all
    select 7, jsonb_build_object('kind', 'ops_reviewer_needed', 'task_id', t.id, 'title', t.title,
           'detail', 'Version ' || cur.version_no || ' of "' || t.output_label || '" needs an Operations reviewer: nobody holds the Operations role apart from the person who submitted it and the person it is assigned to',
           'who', jsonb_build_array(v_pm))
      from proj_tasks t join lateral (select z.* from proj_task_output_versions z where z.task_id = t.id order by z.version_no desc limit 1) cur on true
     where t.project_id = p_project_id and cur.status = 'awaiting' and cur.review_route = 'operations' and t.status in ('todo', 'in_progress', 'ready_for_review')
       and not exists (select 1 from proj_output_reviewer_pool(v.company_id, cur.submitted_by, t.assignee_id))
    union all
    select 8, jsonb_build_object('kind', 'team_lead_needed', 'title', tm.name, 'detail', tm.name || ' Lead needed', 'who', jsonb_build_array(v_pm))
      from proj_teams tm where tm.project_id = p_project_id and tm.removed_at is null and tm.head_user_id is null
  ) a;
  select coalesce(jsonb_agg(jsonb_build_object('at', c.created_at, 'actor', proj_display_name(c.actor_id), 'entity', c.entity_type, 'entity_id', c.entity_id, 'field', c.field, 'from', c.from_value, 'to', c.to_value, 'note', c.note,
           'title', coalesce((select t.title from proj_tasks t where c.entity_type = 'task_output' and t.id = c.entity_id), (select i.title from proj_plan_items i where c.entity_type = 'site_activity' and i.id = c.entity_id),
                             (select s.label from proj_site_shipments s where c.entity_type = 'shipment' and s.id = c.entity_id)))
           order by c.created_at desc, c.id desc), '[]'::jsonb) into v_recent
    from (select * from proj_change_log where project_id = p_project_id and entity_type in ('task_output', 'site_activity', 'shipment') order by created_at desc, id desc limit 8) c;
  return jsonb_build_object('tz', v_tz, 'today', v_today, 'next_on_site', v_next, 'attention', v_attn, 'recent', v_recent);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 5. The Operations decision queue: the existing overview read gains the versions waiting for Operations review. The existing function is kept under a new name and wrapped.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.ops_overview_base(uuid)') is null then
    alter function ops_overview(uuid) rename to ops_overview_base;
  end if;
end $$;
create or replace function ops_overview(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  v := ops_overview_base(p_company_id);                 -- checks that the caller is an Operations Manager of the company
  return v || jsonb_build_object('output_reviews', coalesce((
    select jsonb_agg(jsonb_build_object(
        'version_id', x.id, 'task_id', t.id, 'project_id', p.id, 'reference', p.reference, 'project', p.name, 'task', t.title, 'label', t.output_label, 'version_no', x.version_no,
        'attached_at', x.attached_at, 'submitted_by_id', x.submitted_by, 'submitted_by', proj_display_name(x.submitted_by), 'assignee_id', t.assignee_id, 'assignee', proj_display_name(t.assignee_id),
        'reviewer_id', x.reviewer_id, 'reviewer', case when x.reviewer_id is null then null else proj_display_name(x.reviewer_id) end,
        'needs_reviewer', not exists (select 1 from proj_output_reviewer_pool(p.company_id, x.submitted_by, t.assignee_id)),
        'pm', proj_display_name(p.pm_user_id)) order by x.attached_at, x.id)
      from proj_task_output_versions x join proj_tasks t on t.id = x.task_id join proj_projects p on p.id = x.project_id
     where p.company_id = p_company_id and x.review_route = 'operations' and x.status = 'awaiting'
       and x.version_no = (select max(z.version_no) from proj_task_output_versions z where z.task_id = x.task_id)
       and t.status not in ('done', 'cancelled', 'deferred') and p.status not in ('completed', 'archived')), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function
  proj_setup_teams(uuid, jsonb, boolean), proj_site_technician_eligible(uuid, uuid), proj_activity_range(uuid), proj_crew_overlaps(uuid, uuid), proj_set_site_crew(uuid, jsonb, text), proj_set_site_crew(uuid, jsonb),
  proj_set_activity_readiness(uuid, jsonb), proj_site_technician_candidates(uuid), proj_my_site_assignments(), proj_is_ops_manager(uuid, uuid), proj_output_reviewer_pool(uuid, uuid, uuid),
  proj_assign_output_reviewer(uuid, uuid), ops_overview(uuid), ops_overview_base(uuid)
  from public, anon, authenticated;
grant execute on function
  proj_setup_teams(uuid, jsonb, boolean), proj_set_site_crew(uuid, jsonb, text), proj_set_site_crew(uuid, jsonb), proj_set_activity_readiness(uuid, jsonb), proj_site_technician_candidates(uuid), proj_my_site_assignments(),
  proj_assign_output_reviewer(uuid, uuid), ops_overview(uuid)
  to authenticated;
-- Re-assert the grants of the functions replaced above (create or replace keeps them, this makes the intent explicit and survives a re-run).
revoke all on function proj_submit_task_output(uuid, uuid, uuid, integer, text, boolean, text, integer), proj_decide_task_output(uuid, text, text), proj_output_version_json(uuid),
  proj_site_activity_json(uuid, text), proj_work_overview(uuid) from public, anon, authenticated;
grant execute on function proj_submit_task_output(uuid, uuid, uuid, integer, text, boolean, text, integer), proj_decide_task_output(uuid, text, text), proj_work_overview(uuid) to authenticated;
