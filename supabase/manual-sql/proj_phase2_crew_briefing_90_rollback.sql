-- ROLLBACK for 20270108000100_proj_phase2_crew_briefing.sql. Deploy the app from before this change FIRST (it calls proj_site_briefing and reads the effective fields).
-- It STOPS while any readiness value 'not_applicable' exists (the old check would refuse it): export those rows, set them back to 'unknown', then run it again. It deletes no activity, crew, task,
-- file or Inventory record; dates the Project Manager copied with proj_apply_project_dates stay on their activities (they are ordinary dates now). Safe to run twice.
do $$
begin
  if exists (select 1 from proj_plan_items where ready_hardware = 'not_applicable' or ready_content = 'not_applicable' or ready_app = 'not_applicable') then
    raise exception 'STOP: activities have a readiness marked Not applicable. Export them, set those values back to unknown, then run this again';
  end if;
end $$;

drop function if exists proj_site_briefing(uuid);
drop function if exists proj_apply_project_dates(uuid);

-- the applied bodies of the two replaced functions (from 20270107000100), restored
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
      and exists (select 1 from profiles pr where pr.id = v_uid and pr.is_active)
      -- A project member keeps what membership already gives them. Anyone else reads through the assignment ONLY while the same-company employment check still holds (an active employee of the
      -- project's company): if they leave, transfer out of the company or their employment record is removed, the assignment stops showing even though their sign-in stays active.
      and (proj_dp_active_member(c.project_id, v_uid) or proj_site_technician_eligible(p.company_id, v_uid))), '[]'::jsonb);
end;
$$;

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

drop function if exists proj_activity_readiness_effective(uuid);
drop function if exists proj_activity_effective(uuid);
drop function if exists proj_readiness_area(uuid, text);

alter table proj_plan_items drop constraint if exists proj_plan_items_readiness;
alter table proj_plan_items add constraint proj_plan_items_readiness check (
  ready_hardware in ('unknown', 'not_ready', 'ready') and ready_content in ('unknown', 'not_ready', 'ready') and ready_app in ('unknown', 'not_ready', 'ready')
  and (crew_instructions is null or length(crew_instructions) <= 2000) and (ready_note is null or length(ready_note) <= 500));

revoke all on function proj_my_site_assignments(), proj_set_activity_readiness(uuid, jsonb) from public, anon, authenticated;
grant execute on function proj_my_site_assignments(), proj_set_activity_readiness(uuid, jsonb) to authenticated;
