-- Projects Phase 2 follow-up 2: a useful crew card without duplicate entry. ADDITIVE ON TOP OF BOTH APPLIED PHASE 2 MIGRATIONS (20270106000100 and 20270107000100, neither edited).
--
-- Why: a site-only technician (and the Project Manager) saw an assignment with no date, venue, call time or readiness, because those facts lived in different records and nothing joined them:
--   * venue: the activity's own location, else the project's recorded venue (proj_project_details.location);
--   * date: the activity's own date or time window, else the project's committed date (install_start for a setup, event_start to event_end for a show) ONLY when exactly one activity of that
--     kind exists, so the link is unambiguous; with several runs the Project Manager is asked to choose (proj_apply_project_dates), nothing is guessed;
--   * readiness (hardware, content, app): the Project Manager's own value when set, else derived from the Project Plan lines of that kind and the tasks / Inventory requests behind them;
--     "Not applicable" (set by the PM, or the plan has lines but none of that kind) and "Not recorded" (nothing recorded anywhere) are different states and are worded differently;
--   * call time stays personal and explicit (proj_site_crew.call_at); the screen offers "use the activity start" to fill it without retyping.
-- Reads only; the one write (proj_apply_project_dates) copies a recorded project date onto an activity that has none. The technician read stays limited to their own assignment: it adds
-- the effective venue and date and READINESS COUNTS ("2 of 5 ready"), never a task, file, name or commercial figure.

-- 1. Readiness may also be marked Not applicable.
alter table proj_plan_items drop constraint if exists proj_plan_items_readiness;
alter table proj_plan_items add constraint proj_plan_items_readiness check (
  ready_hardware in ('unknown', 'not_ready', 'ready', 'not_applicable') and ready_content in ('unknown', 'not_ready', 'ready', 'not_applicable') and ready_app in ('unknown', 'not_ready', 'ready', 'not_applicable')
  and (crew_instructions is null or length(crew_instructions) <= 2000) and (ready_note is null or length(ready_note) <= 500));

-- 2. Readiness of one area derived from the Project Plan: lines of that kind and whether the task or Inventory request behind each is done / secured. Counts only.
create or replace function proj_readiness_area(p_project_id uuid, p_section text)
returns jsonb language sql stable security definer set search_path = public as $$
  with l as (
    select case
             when x.task_id is not null then coalesce((select t.status = 'done' from proj_tasks t where t.id = x.task_id), false)
             when x.request_line_id is not null then coalesce((select (inv_request_state(rl.request_id) ->> 'state') in ('reserved', 'dispatched', 'still_out', 'returned') from inv_request_lines rl where rl.id = x.request_line_id), false)
             else false end as ok
      from proj_dp_lines x where x.project_id = p_project_id and x.removed_at is null and x.section = p_section)
  select case
           when (select count(*) from l) > 0 then jsonb_build_object('state', case when (select count(*) from l where not ok) = 0 then 'ready' else 'not_ready' end,
                                                                  'detail', (select count(*) from l where ok) || ' of ' || (select count(*) from l) || ' ready', 'source', 'plan')
           when exists (select 1 from proj_dp_lines y where y.project_id = p_project_id and y.removed_at is null) then jsonb_build_object('state', 'not_applicable', 'detail', 'Nothing of this kind in the Project Plan', 'source', 'plan')
           else jsonb_build_object('state', 'not_recorded', 'detail', null, 'source', null) end;
$$;

-- 3. The readiness a reader should see for an activity: the Project Manager's own value when set, otherwise what the Project Plan says.
create or replace function proj_activity_readiness_effective(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i proj_plan_items; r jsonb;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then return null; end if;
  r := jsonb_build_object('hardware', proj_readiness_area(i.project_id, 'hardware'), 'content', proj_readiness_area(i.project_id, 'content'), 'app', proj_readiness_area(i.project_id, 'apps'));
  return jsonb_build_object(
    'hardware', case when i.ready_hardware <> 'unknown' then jsonb_build_object('state', i.ready_hardware, 'source', 'pm') else r -> 'hardware' end,
    'content',  case when i.ready_content  <> 'unknown' then jsonb_build_object('state', i.ready_content,  'source', 'pm') else r -> 'content' end,
    'app',      case when i.ready_app      <> 'unknown' then jsonb_build_object('state', i.ready_app,      'source', 'pm') else r -> 'app' end,
    'note', i.ready_note);
end;
$$;

-- 4. The venue and date an activity effectively has. A project date is borrowed only when the link is unambiguous (exactly one activity of that kind); otherwise choice_pending is true.
create or replace function proj_activity_effective(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i proj_plan_items; d proj_project_details; v_n integer; v_start date; v_end date; v_venue text; v_vsrc text; v_sd date; v_ed date; v_dsrc text; v_choice boolean := false;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then return null; end if;
  select * into d from proj_project_details where project_id = i.project_id;
  v_venue := nullif(btrim(coalesce(i.location, '')), '');
  v_vsrc := case when v_venue is not null then 'activity' end;
  if v_venue is null then
    v_venue := nullif(btrim(coalesce(d.location, '')), '');
    v_vsrc := case when v_venue is not null then 'project' end;
  end if;
  v_sd := i.start_date; v_ed := i.end_date;
  v_dsrc := case when i.start_date is not null or i.starts_at is not null then 'activity' end;
  if v_dsrc is null then
    if i.activity_kind = 'setup' then v_start := d.install_start; v_end := d.install_start;
    elsif i.activity_kind = 'show' then v_start := d.event_start; v_end := coalesce(d.event_end, d.event_start); end if;
    if v_start is not null then
      select count(*) into v_n from proj_plan_items x where x.project_id = i.project_id and x.plan = 'site' and x.activity_kind = i.activity_kind and x.status <> 'cancelled';
      if v_n = 1 then v_sd := v_start; v_ed := v_end; v_dsrc := 'project'; else v_choice := true; end if;
    end if;
  end if;
  return jsonb_build_object('venue', v_venue, 'venue_source', v_vsrc, 'start_date', v_sd, 'end_date', v_ed, 'date_source', v_dsrc,
                            'choice_pending', v_choice, 'project_start', v_start, 'project_end', v_end);
end;
$$;

-- 5. The Project Manager's view: every open site activity with what is missing from its briefing, beside Assign crew. Readers of the project's details only.
create or replace function proj_site_briefing(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform proj_require_user();
  if not proj_can_view_details(p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', i.id, 'effective', e.eff, 'ready', r.rd,
        'crew_total', c.total, 'call_missing', c.no_call,
        'candidates', case when (e.eff ->> 'choice_pending')::boolean then
            (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'title', y.title, 'run_label', y.run_label) order by y.sort_order, y.title), '[]'::jsonb)
               from proj_plan_items y where y.project_id = i.project_id and y.plan = 'site' and y.activity_kind = i.activity_kind and y.status <> 'cancelled' and y.start_date is null and y.starts_at is null)
          else '[]'::jsonb end,
        'gaps', (select coalesce(jsonb_agg(g), '[]'::jsonb) from (
            select 'venue' as g where e.eff ->> 'venue' is null
            union all select 'date' where e.eff ->> 'date_source' is null and not (e.eff ->> 'choice_pending')::boolean
            union all select 'choose_run' where (e.eff ->> 'choice_pending')::boolean
            union all select 'call_time' where c.total > 0 and c.no_call > 0
            union all select 'readiness' where exists (select 1 from jsonb_each(r.rd - 'note') k where k.value ->> 'state' = 'not_recorded')) q))
        order by coalesce(i.starts_at, (i.start_date::timestamp at time zone 'UTC')) nulls last, i.sort_order, i.title)
    from proj_plan_items i
    cross join lateral (select proj_activity_effective(i.id) as eff) e
    cross join lateral (select proj_activity_readiness_effective(i.id) as rd) r
    cross join lateral (select count(*) as total, count(*) filter (where s.call_at is null) as no_call from proj_site_crew s where s.plan_item_id = i.id) c
    where i.project_id = p_project_id and i.plan = 'site' and i.status not in ('done', 'cancelled')), '[]'::jsonb);
end;
$$;

-- 6. Copy a recorded project date onto an activity that has none (the Project Manager's choice when several runs make the link ambiguous). Nothing else is changed.
create or replace function proj_apply_project_dates(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i proj_plan_items; v proj_projects; e jsonb;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then raise exception 'Site activity not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(i.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  select * into i from proj_plan_items where id = p_item_id for update;
  if i.start_date is not null or i.starts_at is not null then return jsonb_build_object('id', i.id, 'unchanged', true); end if;
  e := proj_activity_effective(i.id);
  if e ->> 'project_start' is null then raise exception 'The project has no recorded date for this kind of activity. Set the date on the activity' using errcode = '23514'; end if;
  update proj_plan_items set start_date = (e ->> 'project_start')::date, end_date = coalesce((e ->> 'project_end')::date, (e ->> 'project_start')::date), tz = null, version = version + 1 where id = i.id;
  perform proj_log_change(v.id, 'site_activity', i.id, 'date', null, (e ->> 'project_start') || coalesce(' to ' || nullif(e ->> 'project_end', e ->> 'project_start'), ''), 'Taken from the project dates');
  return jsonb_build_object('id', i.id, 'applied', true);
end;
$$;

-- 7. The technician read, replaced (same signature, the applied body plus the effective venue / date and readiness). Still only their own assignment; counts, not records.
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
        'site_only', not proj_dp_active_member(c.project_id, v_uid),
        'effective', proj_activity_effective(i.id), 'ready_effective', proj_activity_readiness_effective(i.id))
      order by coalesce(i.starts_at, (i.start_date::timestamp at time zone coalesce(i.tz, d.site_timezone, 'UTC'))) nulls last, i.title)
    from proj_site_crew c
    join proj_plan_items i on i.id = c.plan_item_id and i.plan = 'site'
    join proj_projects p on p.id = c.project_id
    left join proj_project_details d on d.project_id = c.project_id
    where c.user_id = v_uid and i.status not in ('done', 'cancelled') and p.status not in ('completed', 'archived')
      and (proj_activity_range(i.id) is null or upper(proj_activity_range(i.id)) > now() - interval '1 day')
      and exists (select 1 from profiles pr where pr.id = v_uid and pr.is_active)
      -- A project member keeps what membership already gives them. Anyone else reads through the assignment ONLY while the same-company employment check still holds (an active employee of the
      -- project's company): if they leave, transfer out of the company or their employment record is removed, the assignment stops showing even though their sign-in stays active.
      and (proj_dp_active_member(c.project_id, v_uid) or proj_site_technician_eligible(p.company_id, v_uid))), '[]'::jsonb);
end;
$$;

-- 8. Readiness set by the Project Manager may now be Not applicable (same function, wider check).
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
  if h not in ('unknown', 'not_ready', 'ready', 'not_applicable') or c not in ('unknown', 'not_ready', 'ready', 'not_applicable') or a not in ('unknown', 'not_ready', 'ready', 'not_applicable') then raise exception 'Choose Ready, Not ready, Not applicable or Not recorded' using errcode = '22023'; end if;
  n := case when p_fields ? 'note' then nullif(btrim(coalesce(p_fields->>'note', '')), '') else i.ready_note end;
  ins := case when p_fields ? 'crew_instructions' then nullif(btrim(coalesce(p_fields->>'crew_instructions', '')), '') else i.crew_instructions end;
  if length(coalesce(n, '')) > 500 or length(coalesce(ins, '')) > 2000 then raise exception 'That text is too long' using errcode = '22023'; end if;
  if (h, c, a, n, ins) is not distinct from (i.ready_hardware, i.ready_content, i.ready_app, i.ready_note, i.crew_instructions) then return jsonb_build_object('id', i.id, 'unchanged', true); end if;
  update proj_plan_items set ready_hardware = h, ready_content = c, ready_app = a, ready_note = n, crew_instructions = ins where id = i.id;
  perform proj_log_change(v.id, 'site_activity', i.id, 'readiness', i.ready_hardware || '/' || i.ready_content || '/' || i.ready_app, h || '/' || c || '/' || a, i.title);
  return jsonb_build_object('id', i.id, 'updated', true);
end;
$$;

revoke all on function proj_readiness_area(uuid, text), proj_activity_readiness_effective(uuid), proj_activity_effective(uuid), proj_site_briefing(uuid), proj_apply_project_dates(uuid),
  proj_my_site_assignments(), proj_set_activity_readiness(uuid, jsonb) from public, anon, authenticated;
grant execute on function proj_site_briefing(uuid), proj_apply_project_dates(uuid), proj_my_site_assignments(), proj_set_activity_readiness(uuid, jsonb) to authenticated;
