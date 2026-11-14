-- ROLLBACK for 20270109000100_proj_phase2_site_state.sql. Deploy the app from before this change FIRST (it calls proj_preview_site_assignment, proj_site_activities_read and reads phase / contact fields).
-- It STOPS while any activity has an explicit start record (export them, clear them with proj_clear_site_start or by hand, then run it again). It deletes no activity, crew, task, file or Inventory record
-- and keeps the crew notices already sent. It restores the applied bodies of proj_my_site_assignments, proj_site_briefing and proj_activity_readiness_effective (from 20270108000100). Safe to run twice.
do $$
declare v_any boolean := false;
begin
  if exists (select 1 from information_schema.columns where table_name = 'proj_plan_items' and column_name = 'actual_started_at') then
    execute 'select exists (select 1 from proj_plan_items where actual_started_at is not null)' into v_any;
  end if;
  if v_any then
    raise exception 'STOP: activities have an explicit start record. Export them, clear the records, then run this again';
  end if;
end $$;

drop trigger if exists trg_proj_site_activity_moved on proj_plan_items;
drop trigger if exists trg_proj_site_call_moved on proj_site_crew;
drop trigger if exists trg_proj_site_project_details_moved on proj_project_details;
drop function if exists proj_site_project_details_moved();
drop function if exists proj_site_activity_moved();
drop function if exists proj_site_call_moved();
drop function if exists proj_site_notify_change(uuid, uuid, uuid, text, text, text, jsonb);
drop function if exists proj_site_when_text(date, date, timestamptz, timestamptz, text);
drop function if exists proj_site_activities_read(uuid, uuid, integer);
drop function if exists proj_preview_site_assignment(uuid, uuid);
drop function if exists proj_record_site_start(uuid, timestamptz, text);
drop function if exists proj_clear_site_start(uuid);

-- the applied bodies (from 20270108000100), restored
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

drop function if exists proj_site_assignment_json(uuid, uuid);
drop function if exists proj_site_phase_json(uuid);
drop function if exists proj_readiness_run_area(uuid, text);
drop function if exists proj_readiness_project_area(uuid, text);
drop function if exists proj_readiness_eval(uuid, text, uuid);
drop function if exists proj_readiness_words(text, integer, integer);

alter table proj_plan_items drop constraint if exists proj_plan_items_actual_start;
alter table proj_plan_items drop column if exists actual_started_at;
alter table proj_plan_items drop column if exists actual_started_by;
alter table proj_plan_items drop column if exists actual_start_note;

revoke all on function proj_my_site_assignments(), proj_site_briefing(uuid) from public, anon, authenticated;
grant execute on function proj_my_site_assignments(), proj_site_briefing(uuid) to authenticated;
