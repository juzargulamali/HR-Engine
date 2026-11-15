-- ROLLBACK for 20270113000100_proj_client_timeline_tasks.sql. Deploy the app from before this change FIRST (the Files & client plan page calls proj_plan_preview,
-- proj_issue_plan_checked and proj_set_client_timeline_tasks; without them it says the task chooser and the preview could not be loaded).
-- It STOPS while any task is still chosen for a client timeline: clear the choice in the app first (Files & client plan, untick the tasks, Save), then run this again.
-- It deletes no project, task, milestone or issued timeline. Issued versions are never changed: a version that was issued WITH tasks keeps its payload, but the app from before
-- this change does not draw the task rows of such a version (page and PDF). The first statement LISTS those versions; if it returns rows, keep the new app or accept that.
-- It restores the bodies of proj_build_plan_payload and proj_issue_plan exactly as installed by 20261120000500, then drops the new functions and the table. Safe to run twice.
select p.id as issued_plan_with_tasks, p.project_id, p.version, p.issued_at from proj_issued_plans p where p.payload ? 'tasks' order by p.issued_at;

do $$
declare v_chosen integer := 0;
begin
  if to_regclass('public.proj_client_timeline_tasks') is not null then
    execute 'select count(*) from proj_client_timeline_tasks' into v_chosen;
  end if;
  if v_chosen > 0 then
    raise exception 'STOP: % task(s) are still chosen for a client timeline. Clear the choice in the app first, then run this again', v_chosen;
  end if;
end $$;

create or replace function proj_build_plan_payload(p_project_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'project', (select jsonb_build_object('reference', pr.reference, 'name', pr.name, 'client_name', d.client_name, 'location', d.location, 'site_timezone', d.site_timezone)
                  from proj_projects pr join proj_project_details d on d.project_id = pr.id where pr.id = p_project_id),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('title', m.title, 'due_date', m.due_date) order by m.due_date nulls last, m.sort_order, m.title)
                              from proj_milestones m where m.project_id = p_project_id and m.client_facing and m.status <> 'cancelled'), '[]'::jsonb),
    'delivery', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'start_date', i.start_date, 'end_date', i.end_date) order by i.start_date nulls last, i.sort_order, i.title)
                            from proj_plan_items i where i.project_id = p_project_id and i.plan = 'delivery' and i.client_facing and i.status <> 'cancelled'), '[]'::jsonb),
    'site', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'start_date', i.start_date, 'end_date', i.end_date,
                                                           'starts_local', case when i.starts_at is not null then to_char(i.starts_at at time zone i.tz, 'YYYY-MM-DD"T"HH24:MI') end,
                                                           'ends_local', case when i.ends_at is not null then to_char(i.ends_at at time zone i.tz, 'YYYY-MM-DD"T"HH24:MI') end,
                                                           'tz', i.tz)
                                         order by coalesce(i.start_date::timestamp, i.starts_at at time zone i.tz) nulls last, i.sort_order, i.title)
                        from proj_plan_items i where i.project_id = p_project_id and i.plan = 'site' and i.client_facing and i.status <> 'cancelled'), '[]'::jsonb),
    'dependencies', coalesce((select jsonb_agg(jsonb_build_object('label', e.label, 'kind', e.kind, 'expected_date', e.expected_date, 'expected_time', e.expected_time,
                                                                   'organisation', e.organisation, 'confirmation', e.confirmation)
                                                order by e.expected_date nulls last, e.label)
                                from proj_external_dependencies e where e.project_id = p_project_id and e.client_facing), '[]'::jsonb));
$$;

create or replace function proj_issue_plan(p_project_id uuid, p_client_reference text default null, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  d proj_project_details;
  v_payload jsonb;
  v_version integer;
  v_id uuid;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if v.kind <> 'client' then raise exception 'Client timelines are for client projects' using errcode = '23514'; end if;
  if v.status = 'archived' then raise exception 'An archived project cannot issue a new timeline' using errcode = '23514'; end if;
  select * into d from proj_project_details where project_id = v.id;
  v_payload := proj_build_plan_payload(v.id);
  if jsonb_array_length(v_payload->'milestones') + jsonb_array_length(v_payload->'delivery') + jsonb_array_length(v_payload->'site') = 0 then
    raise exception 'Mark at least one milestone or timeline activity as client-facing before issuing' using errcode = '22023';
  end if;
  -- Issuing the same content twice in a row (double click) returns the version already issued.
  select id into v_id from proj_issued_plans where project_id = v.id and superseded_at is null and payload_hash = md5(v_payload::text);
  if v_id is not null then return v_id; end if;
  select coalesce(max(version), 0) + 1 into v_version from proj_issued_plans where project_id = v.id;
  update proj_issued_plans set superseded_at = now() where project_id = v.id and superseded_at is null;
  insert into proj_issued_plans (project_id, version, client_reference, title, tz, payload, payload_hash, note, issued_by)
  values (v.id, v_version, coalesce(proj_text_or_null(jsonb_build_object('r', p_client_reference), 'r'), v.reference), v.name, d.site_timezone, v_payload, md5(v_payload::text), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;


drop function if exists proj_issue_plan_checked(uuid, text, text, text);
drop function if exists proj_plan_preview(uuid);
drop function if exists proj_set_client_timeline_tasks(uuid, jsonb);
drop function if exists proj_client_timeline_tasks_json(uuid);
drop function if exists proj_client_task_status(text);
drop table if exists proj_client_timeline_tasks;

revoke all on function proj_build_plan_payload(uuid), proj_issue_plan(uuid, text, text) from public, anon, authenticated;
grant execute on function proj_issue_plan(uuid, text, text) to authenticated;
