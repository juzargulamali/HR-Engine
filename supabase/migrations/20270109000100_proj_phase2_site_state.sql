-- Projects Phase 2 follow-up 3: one site activity, told the same way everywhere. ADDITIVE ON TOP OF THE THREE APPLIED PHASE 2 MIGRATIONS (20270106000100, 20270107000100, 20270108000100; none edited).
--
--  1. A suggested project date, a scheduled activity and an ACTUAL START are different facts. proj_plan_items gains an explicit start record (actual_started_at, set by the Project Manager with
--     proj_record_site_start). proj_site_phase_json states the phase from the evidence: started (only with that record), scheduled / due today, date passed (start unconfirmed), no date; and whether
--     the date is the activity's own or borrowed from the project header. A passed date alone NEVER means started.
--  2. Readiness is scoped. The Project Plan's counts are PROJECT-WIDE and say so; a run's own readiness is the Project Manager's assessment, else evidence linked to that run (its equipment
--     requests through shipments, the plan lines sharing its milestone), else Not recorded; Not applicable when the run's scope or the PM says so. A finished task alone proves neither an approved
--     output nor equipment readiness: content and app need an APPROVED output version, hardware needs a reserved or sent Inventory request.
--  3. proj_site_assignment_json is the ONE shape of "what this person sees for this assignment": the technician read and the Project Manager's preview of it both use it (so the preview is exact),
--     and it adds the phase, the named contact (site lead, else Project Manager) and what reporting detail is still missing. A tentative assignment stays visible while it is open.
--  4. proj_site_activities_read: the dated site activities of a company's live projects (or one project), once each, for Operations, Calendar and Work: bounded, under the viewer's own access.
--  5. Crew are told when a CONFIRMED date or venue moves, or a personal call time moves: triggers write a notice (previous and new values) to the affected assignments only.

-- 1. The explicit record of a start.
alter table proj_plan_items add column if not exists actual_started_at timestamptz;
alter table proj_plan_items add column if not exists actual_started_by uuid references auth.users(id);
alter table proj_plan_items add column if not exists actual_start_note text;
alter table proj_plan_items drop constraint if exists proj_plan_items_actual_start;
alter table proj_plan_items add constraint proj_plan_items_actual_start check (actual_start_note is null or length(actual_start_note) <= 300);

create or replace function proj_record_site_start(p_item_id uuid, p_started_at timestamptz default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i proj_plan_items; v proj_projects; t timestamptz;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then raise exception 'Site activity not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(i.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  select * into i from proj_plan_items where id = p_item_id for update;
  t := coalesce(p_started_at, now());
  if t > now() + interval '10 minutes' then raise exception 'A start cannot be recorded in the future' using errcode = '22023'; end if;
  if i.actual_started_at is not null and i.actual_started_at = t then return jsonb_build_object('id', i.id, 'unchanged', true); end if;
  update proj_plan_items set actual_started_at = t, actual_started_by = auth.uid(), actual_start_note = nullif(btrim(coalesce(p_note, '')), ''), version = version + 1 where id = i.id;
  perform proj_log_change(v.id, 'site_activity', i.id, 'started', case when i.actual_started_at is null then null else i.actual_started_at::text end, t::text, coalesce(nullif(btrim(coalesce(p_note, '')), ''), i.title));
  return jsonb_build_object('id', i.id, 'recorded', true);
end;
$$;

create or replace function proj_clear_site_start(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i proj_plan_items; v proj_projects;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then raise exception 'Site activity not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(i.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  select * into i from proj_plan_items where id = p_item_id for update;
  if i.actual_started_at is null then return jsonb_build_object('id', i.id, 'unchanged', true); end if;
  update proj_plan_items set actual_started_at = null, actual_started_by = null, actual_start_note = null, version = version + 1 where id = i.id;
  perform proj_log_change(v.id, 'site_activity', i.id, 'started', i.actual_started_at::text, null, 'Start record removed');
  return jsonb_build_object('id', i.id, 'cleared', true);
end;
$$;

-- 2. The phase of an activity, from evidence. started only with the explicit record.
create or replace function proj_site_phase_json(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i proj_plan_items; d proj_project_details; e jsonb; tz text; today date; first_day date; last_day date; basis text; phase text;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then return null; end if;
  select * into d from proj_project_details where project_id = i.project_id;
  tz := coalesce(i.tz, d.site_timezone, 'UTC');
  today := (now() at time zone tz)::date;
  e := proj_activity_effective(i.id);
  if i.start_date is not null then first_day := i.start_date; last_day := coalesce(i.end_date, i.start_date); basis := 'activity';
  elsif i.starts_at is not null then first_day := (i.starts_at at time zone tz)::date; last_day := (coalesce(i.ends_at, i.starts_at) at time zone tz)::date; basis := 'activity';
  elsif (e ->> 'start_date') is not null then first_day := (e ->> 'start_date')::date; last_day := coalesce((e ->> 'end_date')::date, first_day); basis := 'project_header';
  end if;
  phase := case when i.actual_started_at is not null then 'started'
                when first_day is null then 'no_date'
                when first_day < today then 'date_passed'
                when first_day = today then 'due_today'
                else 'scheduled' end;
  return jsonb_build_object('phase', phase, 'basis', coalesce(basis, 'none'), 'first_day', first_day, 'last_day', last_day, 'started_at', i.actual_started_at,
                            'started_by', case when i.actual_started_by is null then null else proj_display_name(i.actual_started_by) end,
                            'kind', i.activity_kind, 'state', i.activity_state, 'today', today, 'choice_pending', (e ->> 'choice_pending')::boolean);
end;
$$;

-- 3. Readiness, scoped. Counts of the plan lines of one section in a scope (the whole project, or the lines sharing one milestone). Evidence only: a finished task is NOT evidence of an
-- approved output; content and app need an approved output version, hardware needs a reserved or sent Inventory request.
create or replace function proj_readiness_eval(p_project_id uuid, p_section text, p_milestone uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('n', count(*) filter (where x.section = p_section), 'ok', count(*) filter (where x.section = p_section and x.ok), 'any', count(*))
  from (select l.section,
               case when l.section = 'hardware'
                    then coalesce(l.request_line_id is not null and (select (inv_request_state(rl.request_id) ->> 'state') in ('reserved', 'dispatched', 'still_out', 'returned') from inv_request_lines rl where rl.id = l.request_line_id), false)
                    else coalesce(l.task_id is not null and exists (select 1 from proj_task_output_versions v where v.task_id = l.task_id and v.status = 'approved'), false) end as ok
          from proj_dp_lines l where l.project_id = p_project_id and l.removed_at is null and (p_milestone is null or l.milestone_id = p_milestone)) x;
$$;

create or replace function proj_readiness_words(p_section text, p_ok integer, p_n integer)
returns text language sql immutable as $$
  select p_ok || ' of ' || p_n || case when p_section = 'hardware' then ' equipment lines reserved or sent' else ' outputs approved' end;
$$;

-- Project-wide readiness of one area (what the Project Plan says for the whole project). Labelled project-wide wherever it is shown.
create or replace function proj_readiness_project_area(p_project_id uuid, p_section text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; n integer; k integer; a integer;
begin
  r := proj_readiness_eval(p_project_id, p_section, null);
  n := (r ->> 'n')::integer; k := (r ->> 'ok')::integer; a := (r ->> 'any')::integer;
  if n > 0 then return jsonb_build_object('state', case when k = n then 'ready' else 'not_ready' end, 'detail', proj_readiness_words(p_section, k, n), 'level', 'project'); end if;
  if a > 0 then return jsonb_build_object('state', 'not_applicable', 'detail', 'Nothing of this kind in the Project Plan', 'level', 'project'); end if;
  return jsonb_build_object('state', 'not_recorded', 'detail', null, 'level', 'project');
end;
$$;

-- One run's own readiness of one area: the lines that share the run's milestone, and (hardware) the equipment requests carried by the run's shipments. No evidence: Not recorded.
create or replace function proj_readiness_run_area(p_item_id uuid, p_section text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i proj_plan_items; r jsonb; n integer := 0; k integer := 0; a integer := 0; sn integer := 0; sk integer := 0;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then return null; end if;
  if i.milestone_id is not null then
    r := proj_readiness_eval(i.project_id, p_section, i.milestone_id);
    n := (r ->> 'n')::integer; k := (r ->> 'ok')::integer; a := (r ->> 'any')::integer;
  end if;
  if p_section = 'hardware' then
    select count(*), count(*) filter (where (inv_request_state(s.request_id) ->> 'state') in ('reserved', 'dispatched', 'still_out', 'returned'))
      into sn, sk from proj_site_shipments s where s.plan_item_id = i.id and s.request_id is not null;
  end if;
  if n + sn > 0 then
    return jsonb_build_object('state', case when k + sk = n + sn then 'ready' else 'not_ready' end, 'detail', proj_readiness_words(p_section, k + sk, n + sn), 'level', 'run');
  end if;
  if a > 0 then return jsonb_build_object('state', 'not_applicable', 'detail', 'Nothing of this kind is planned for this run', 'level', 'run'); end if;
  return jsonb_build_object('state', 'not_recorded', 'detail', null, 'level', 'run');
end;
$$;

-- What a reader sees: the Project Manager's own assessment when set, else the run's own evidence, else Not recorded; plus the project-wide counts, kept apart and labelled.
create or replace function proj_activity_readiness_effective(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i proj_plan_items; hw jsonb; ct jsonb; ap jsonb;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then return null; end if;
  hw := proj_readiness_run_area(i.id, 'hardware'); ct := proj_readiness_run_area(i.id, 'content'); ap := proj_readiness_run_area(i.id, 'apps');
  return jsonb_build_object(
    'hardware', case when i.ready_hardware <> 'unknown' then jsonb_build_object('state', i.ready_hardware, 'source', 'pm') else jsonb_build_object('state', hw ->> 'state', 'source', case when hw ->> 'state' = 'not_recorded' then null else 'run' end, 'detail', hw -> 'detail') end,
    'content',  case when i.ready_content  <> 'unknown' then jsonb_build_object('state', i.ready_content,  'source', 'pm') else jsonb_build_object('state', ct ->> 'state', 'source', case when ct ->> 'state' = 'not_recorded' then null else 'run' end, 'detail', ct -> 'detail') end,
    'app',      case when i.ready_app      <> 'unknown' then jsonb_build_object('state', i.ready_app,      'source', 'pm') else jsonb_build_object('state', ap ->> 'state', 'source', case when ap ->> 'state' = 'not_recorded' then null else 'run' end, 'detail', ap -> 'detail') end,
    'note', i.ready_note,
    'project', jsonb_build_object('hardware', proj_readiness_project_area(i.project_id, 'hardware'), 'content', proj_readiness_project_area(i.project_id, 'content'), 'app', proj_readiness_project_area(i.project_id, 'apps')));
end;
$$;

-- 4. ONE shape for "what this person sees for this assignment". The technician's own read and the Project Manager's preview both come from here.
create or replace function proj_site_assignment_json(p_crew_id uuid, p_viewer uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c proj_site_crew; i proj_plan_items; p proj_projects; d proj_project_details; eff jsonb; ph jsonb; contact jsonb; miss jsonb;
begin
  select * into c from proj_site_crew where id = p_crew_id;
  if not found then return null; end if;
  select * into i from proj_plan_items where id = c.plan_item_id;
  select * into p from proj_projects where id = c.project_id;
  select * into d from proj_project_details where project_id = c.project_id;
  eff := proj_activity_effective(i.id); ph := proj_site_phase_json(i.id);
  contact := case when i.owner_id is not null then jsonb_build_object('name', proj_display_name(i.owner_id), 'role', 'Site lead')
                  else jsonb_build_object('name', proj_display_name(p.pm_user_id), 'role', 'Project Manager') end;
  miss := (select coalesce(jsonb_agg(m), '[]'::jsonb) from (
            select 'date' as m where ph ->> 'phase' = 'no_date'
            union all select 'venue' where eff ->> 'venue' is null
            union all select 'call_time' where c.call_at is null) q);
  return jsonb_build_object(
    'assignment_id', c.id, 'activity_id', i.id, 'project_name', p.name, 'title', i.title, 'run_label', i.run_label, 'kind', i.activity_kind, 'state', i.activity_state, 'role', c.crew_role,
    'location', i.location, 'start_date', i.start_date, 'end_date', i.end_date, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'tz', coalesce(i.tz, d.site_timezone),
    'call_at', c.call_at, 'call_tz', coalesce(c.call_tz, i.tz, d.site_timezone), 'instructions', c.instructions, 'crew_instructions', i.crew_instructions,
    'ready', jsonb_build_object('hardware', i.ready_hardware, 'content', i.ready_content, 'app', i.ready_app, 'note', i.ready_note),
    'hardware_state', (select inv_request_state(s.request_id) ->> 'state' from proj_site_shipments s where s.plan_item_id = i.id and s.request_id is not null order by s.created_at limit 1),
    'site_only', not proj_dp_active_member(c.project_id, p_viewer),
    'effective', eff, 'ready_effective', proj_activity_readiness_effective(i.id),
    'phase', ph, 'contact', contact, 'reporting', jsonb_build_object('complete', jsonb_array_length(miss) = 0, 'missing', miss));
end;
$$;

create or replace function proj_my_site_assignments()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(proj_site_assignment_json(c.id, v_uid)
      order by coalesce(i.starts_at, (i.start_date::timestamp at time zone coalesce(i.tz, d.site_timezone, 'UTC'))) nulls last, i.title)
    from proj_site_crew c
    join proj_plan_items i on i.id = c.plan_item_id and i.plan = 'site'
    join proj_projects p on p.id = c.project_id
    left join proj_project_details d on d.project_id = c.project_id
    where c.user_id = v_uid and i.status not in ('done', 'cancelled') and p.status not in ('completed', 'archived')
      -- A confirmed activity drops off a day after it ends. A TENTATIVE one stays while it is open, so staffing that never got its date is not silently lost.
      and (i.activity_state = 'tentative' or proj_activity_range(i.id) is null or upper(proj_activity_range(i.id)) > now() - interval '1 day')
      and exists (select 1 from profiles pr where pr.id = v_uid and pr.is_active)
      and (proj_dp_active_member(c.project_id, v_uid) or proj_site_technician_eligible(p.company_id, v_uid))), '[]'::jsonb);
end;
$$;

-- The Project Manager's preview: exactly what the chosen person will see for this activity (the same function), plus who and whether they are site-only.
create or replace function proj_preview_site_assignment(p_item_id uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i proj_plan_items; c proj_site_crew;
begin
  perform proj_require_user();
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then raise exception 'Site activity not found' using errcode = 'P0002'; end if;
  if not proj_can_manage(i.project_id) then raise exception 'Only the Project Manager can preview a crew briefing' using errcode = '42501'; end if;
  select * into c from proj_site_crew where plan_item_id = i.id and user_id = p_user_id order by crew_role limit 1;
  if not found then return null; end if;
  return proj_site_assignment_json(c.id, p_user_id) || jsonb_build_object('preview', true, 'person', proj_display_name(p_user_id));
end;
$$;

-- 5. The Project Manager's checklist, replaced (same signature): adds the phase, the contact, each person's call time, and the scoped readiness.
create or replace function proj_site_briefing(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform proj_require_user();
  if not proj_can_view_details(p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', i.id, 'effective', e.eff, 'ready', r.rd, 'phase', ph.j,
        'crew_total', c.total, 'call_missing', c.no_call,
        'calls', (select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'name', proj_display_name(s.user_id), 'role', s.crew_role, 'call_at', s.call_at, 'site_only', not proj_dp_active_member(i.project_id, s.user_id)) order by s.crew_role, proj_display_name(s.user_id)), '[]'::jsonb) from proj_site_crew s where s.plan_item_id = i.id),
        'candidates', case when (e.eff ->> 'choice_pending')::boolean then
            (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'title', y.title, 'run_label', y.run_label) order by y.sort_order, y.title), '[]'::jsonb)
               from proj_plan_items y where y.project_id = i.project_id and y.plan = 'site' and y.activity_kind = i.activity_kind and y.status <> 'cancelled' and y.start_date is null and y.starts_at is null)
          else '[]'::jsonb end,
        'gaps', (select coalesce(jsonb_agg(g), '[]'::jsonb) from (
            select 'venue' as g where e.eff ->> 'venue' is null
            union all select 'date' where e.eff ->> 'date_source' is null and not (e.eff ->> 'choice_pending')::boolean
            union all select 'choose_run' where (e.eff ->> 'choice_pending')::boolean
            union all select 'call_time' where c.total > 0 and c.no_call > 0
            union all select 'readiness' where exists (select 1 from jsonb_each(r.rd - 'note' - 'project') k where k.value ->> 'state' = 'not_recorded')) q))
        order by coalesce(i.starts_at, (i.start_date::timestamp at time zone 'UTC')) nulls last, i.sort_order, i.title)
    from proj_plan_items i
    cross join lateral (select proj_activity_effective(i.id) as eff) e
    cross join lateral (select proj_activity_readiness_effective(i.id) as rd) r
    cross join lateral (select proj_site_phase_json(i.id) as j) ph
    cross join lateral (select count(*) as total, count(*) filter (where s.call_at is null) as no_call from proj_site_crew s where s.plan_item_id = i.id) c
    where i.project_id = p_project_id and i.plan = 'site' and i.status not in ('done', 'cancelled')), '[]'::jsonb);
end;
$$;

-- 6. The dated site activities of the live projects the viewer may read, once each (Operations, Calendar, Work). Bounded; a project the viewer cannot see in detail contributes nothing.
create or replace function proj_site_activities_read(p_company_id uuid, p_project_id uuid default null, p_limit integer default 300)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform proj_require_user();
  return coalesce((
    select jsonb_agg(row_j order by sort_key nulls last, title) from (
      select jsonb_build_object(
          'id', i.id, 'project_id', p.id, 'reference', p.reference, 'project_name', p.name, 'project_status', p.status, 'title', i.title, 'kind', i.activity_kind, 'run_label', i.run_label,
          'state', i.activity_state, 'start_date', i.start_date, 'end_date', i.end_date, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'tz', coalesce(i.tz, d.site_timezone),
          'effective', e.eff, 'phase', ph.j, 'owner_name', case when i.owner_id is null then null else proj_display_name(i.owner_id) end,
          'crew_total', (select count(*) from proj_site_crew s where s.plan_item_id = i.id), 'call_missing', (select count(*) from proj_site_crew s where s.plan_item_id = i.id and s.call_at is null),
          'actual_started_at', i.actual_started_at) as row_j,
        coalesce(i.starts_at, (coalesce(i.start_date, (e.eff ->> 'start_date')::date)::timestamp at time zone 'UTC')) as sort_key, i.title
      from proj_plan_items i
      join proj_projects p on p.id = i.project_id
      left join proj_project_details d on d.project_id = p.id
      cross join lateral (select proj_activity_effective(i.id) as eff) e
      cross join lateral (select proj_site_phase_json(i.id) as j) ph
      where i.plan = 'site' and i.status not in ('done', 'cancelled') and p.company_id = p_company_id and (p_project_id is null or p.id = p_project_id)
        and p.status not in ('completed', 'archived') and proj_can_view_details(p.id)
      order by sort_key nulls last, i.title limit least(greatest(coalesce(p_limit, 300), 1), 500)) q), '[]'::jsonb);
end;
$$;

-- 7. Crew are told when a CONFIRMED date or venue moves, or a personal call time moves: the affected assignments only, previous and new values in the notice.
create or replace function proj_site_when_text(p_start date, p_end date, p_starts timestamptz, p_ends timestamptz, p_tz text)
returns text language sql immutable as $$
  select case when p_starts is not null then to_char(p_starts at time zone coalesce(p_tz, 'UTC'), 'DD Mon YYYY HH24:MI') || ' ' || coalesce(p_tz, 'UTC')
              when p_start is not null then to_char(p_start, 'DD Mon YYYY') || case when p_end is not null and p_end <> p_start then ' to ' || to_char(p_end, 'DD Mon YYYY') else '' end
              else 'no date' end;
$$;

-- One unread notice per person per activity: a second move before it is read is merged into it (the earliest "from", the latest "to"), so a save that touches the date and the venue in two
-- statements, or a date moved twice, never becomes a pile of notices.
create or replace function proj_site_notify_change(p_project_id uuid, p_user_id uuid, p_activity_id uuid, p_title text, p_run text, p_project_name text, p_change jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text := 'sitechg:' || p_activity_id || ':' || p_user_id; n record; v_changes jsonb; c jsonb; v_hit boolean;
begin
  if p_user_id is null or p_user_id = auth.uid() then return; end if;
  select id, payload into n from notifications where user_id = p_user_id and type = 'project_site_change' and read_at is null and payload ->> 'dedupe_key' = v_key order by created_at desc limit 1 for update;
  if found then
    v_changes := '[]'::jsonb; v_hit := false;
    for c in select * from jsonb_array_elements(n.payload -> 'changes') loop
      if c ->> 'field' = p_change ->> 'field' then
        v_hit := true;
        if (c ->> 'from') <> (p_change ->> 'to') then v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', c ->> 'field', 'from', c ->> 'from', 'to', p_change ->> 'to')); end if;   -- moved back: nothing to say
      else v_changes := v_changes || jsonb_build_array(c); end if;
    end loop;
    if not v_hit then v_changes := v_changes || jsonb_build_array(p_change); end if;
    update notifications set payload = jsonb_set(n.payload, '{changes}', v_changes) where id = n.id;
  else
    perform proj_notify(p_project_id, p_user_id, 'project_site_change',
      jsonb_build_object('site_change', true, 'activity_id', p_activity_id, 'title', p_title, 'run_label', p_run, 'project_name', p_project_name, 'changes', jsonb_build_array(p_change)), v_key, false);
  end if;
end;
$$;

create or replace function proj_site_activity_moved()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_proj proj_projects; u record; v_old text; v_new text;
begin
  if new.plan <> 'site' or old.activity_state <> 'confirmed' then return new; end if;
  select * into v_proj from proj_projects where id = new.project_id;
  v_old := proj_site_when_text(old.start_date, old.end_date, old.starts_at, old.ends_at, old.tz); v_new := proj_site_when_text(new.start_date, new.end_date, new.starts_at, new.ends_at, new.tz);
  for u in select distinct user_id from proj_site_crew where plan_item_id = new.id loop
    if v_old <> v_new then perform proj_site_notify_change(new.project_id, u.user_id, new.id, new.title, new.run_label, v_proj.name, jsonb_build_object('field', 'date', 'from', v_old, 'to', v_new)); end if;
    if old.location is distinct from new.location then
      perform proj_site_notify_change(new.project_id, u.user_id, new.id, new.title, new.run_label, v_proj.name, jsonb_build_object('field', 'venue', 'from', coalesce(old.location, 'not recorded'), 'to', coalesce(new.location, 'not recorded')));
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_proj_site_activity_moved on proj_plan_items;
create trigger trg_proj_site_activity_moved after update of start_date, end_date, starts_at, ends_at, tz, location on proj_plan_items
  for each row when (new.plan = 'site' and old.activity_state = 'confirmed') execute function proj_site_activity_moved();

create or replace function proj_site_call_moved()
returns trigger language plpgsql security definer set search_path = public as $$
declare i proj_plan_items; v_proj proj_projects; v_old text; v_new text; v_tz text;
begin
  select * into i from proj_plan_items where id = new.plan_item_id;
  -- told when an existing call time moves, or any call time on a confirmed activity changes; a first call time on a tentative activity is not a "move"
  if not (old.call_at is not null or i.activity_state = 'confirmed') then return new; end if;
  select * into v_proj from proj_projects where id = new.project_id;
  v_tz := coalesce(new.call_tz, i.tz, (select site_timezone from proj_project_details where project_id = new.project_id), 'UTC');
  v_old := case when old.call_at is null then 'not set' else to_char(old.call_at at time zone v_tz, 'DD Mon YYYY HH24:MI') || ' ' || v_tz end;
  v_new := case when new.call_at is null then 'not set' else to_char(new.call_at at time zone v_tz, 'DD Mon YYYY HH24:MI') || ' ' || v_tz end;
  if v_old = v_new then return new; end if;
  perform proj_site_notify_change(new.project_id, new.user_id, i.id, i.title, i.run_label, v_proj.name, jsonb_build_object('field', 'call time', 'from', v_old, 'to', v_new));
  return new;
end;
$$;
drop trigger if exists trg_proj_site_call_moved on proj_site_crew;
create trigger trg_proj_site_call_moved after update of call_at, call_tz on proj_site_crew
  for each row when (old.call_at is distinct from new.call_at) execute function proj_site_call_moved();

revoke all on function proj_record_site_start(uuid, timestamptz, text), proj_clear_site_start(uuid), proj_site_phase_json(uuid), proj_readiness_eval(uuid, text, uuid), proj_readiness_words(text, integer, integer),
  proj_readiness_project_area(uuid, text), proj_readiness_run_area(uuid, text), proj_activity_readiness_effective(uuid), proj_site_assignment_json(uuid, uuid), proj_my_site_assignments(),
  proj_preview_site_assignment(uuid, uuid), proj_site_briefing(uuid), proj_site_activities_read(uuid, uuid, integer), proj_site_when_text(date, date, timestamptz, timestamptz, text),
  proj_site_activity_moved(), proj_site_call_moved(), proj_site_notify_change(uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function proj_record_site_start(uuid, timestamptz, text), proj_clear_site_start(uuid), proj_my_site_assignments(), proj_preview_site_assignment(uuid, uuid), proj_site_briefing(uuid),
  proj_site_activities_read(uuid, uuid, integer) to authenticated;
