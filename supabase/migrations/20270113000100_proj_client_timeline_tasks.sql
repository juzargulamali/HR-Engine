-- Projects & Tasks: individual tasks on a client timeline. ADDITIVE; no applied migration is edited. Safe to run twice.
--
--  1. proj_client_timeline_tasks: the tasks the Project Manager EXPLICITLY chose for the next client timeline, each with the title the client will read. Nothing is chosen by default
--     and there is no "all tasks": a task is on the list only because a manager put it there. Read: the people who may manage the project. Written only through
--     proj_set_client_timeline_tasks (the existing rule for issuing: Project Manager, temporary project leadership, founder).
--  2. proj_build_plan_payload gains a "tasks" list, built HERE from an allowlist: the client title, the start and due dates and the status in client words. Nothing else of a task
--     is read into the payload: not its internal title, description, assignee, collaborators, priority, blocked reason, unblock owner, comments, files, outputs or review notes.
--     The "tasks" key is present ONLY when at least one task is chosen, so the payload (and its hash) of every project with no chosen task is byte for byte what it was: an issued
--     version does not turn "outdated" because this migration was applied, and the deployed app keeps working unchanged.
--  3. proj_issue_plan (same signature) also accepts a timeline that holds only tasks. proj_plan_preview returns the payload together with its hash, and proj_issue_plan_checked
--     issues only when the content is still exactly the preview the manager looked at (otherwise it refuses and nothing is issued).
--  4. Issued versions are untouched: proj_issued_plans is not altered and its guard trigger still refuses every change to an issued payload.

create table if not exists proj_client_timeline_tasks (
  task_id       uuid primary key references proj_tasks(id) on delete cascade,
  project_id    uuid not null references proj_projects(id) on delete cascade,
  client_title  text not null check (length(btrim(client_title)) between 1 and 200),
  selected_by   uuid not null references auth.users(id),
  selected_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_proj_client_timeline_tasks_project on proj_client_timeline_tasks(project_id);

alter table proj_client_timeline_tasks enable row level security;
drop policy if exists proj_client_timeline_tasks_select on proj_client_timeline_tasks;
create policy proj_client_timeline_tasks_select on proj_client_timeline_tasks for select using (proj_can_manage(project_id));
revoke all on proj_client_timeline_tasks from public, anon, authenticated;
grant select on proj_client_timeline_tasks to authenticated;

-- The status of a task in the words a client reads. A blocked task is not told apart: being blocked, and why, is internal.
create or replace function proj_client_task_status(p_status text)
returns text language sql immutable as $$
  select case p_status when 'done' then 'Done' when 'in_progress' then 'In progress' when 'ready_for_review' then 'In progress' when 'deferred' then 'Postponed' else 'Planned' end;
$$;

-- The chosen tasks as the client sees them: ALLOWLIST ONLY (title, start_date, due_date, status). A cancelled task is left out.
create or replace function proj_client_timeline_tasks_json(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', btrim(c.client_title), 'start_date', t.start_date, 'due_date', t.due_date, 'status', proj_client_task_status(t.status))
                            order by coalesce(t.start_date, t.due_date) nulls last, t.due_date nulls last, btrim(c.client_title), t.id), '[]'::jsonb)
  from proj_client_timeline_tasks c join proj_tasks t on t.id = c.task_id
  where c.project_id = p_project_id and t.project_id = p_project_id and t.status <> 'cancelled';
$$;

-- Same body as installed by 20261120000500, plus the "tasks" key when (and only when) a task is chosen.
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
                                from proj_external_dependencies e where e.project_id = p_project_id and e.client_facing), '[]'::jsonb))
    || case when jsonb_array_length(proj_client_timeline_tasks_json(p_project_id)) > 0 then jsonb_build_object('tasks', proj_client_timeline_tasks_json(p_project_id)) else '{}'::jsonb end;
$$;

-- Same body as installed by 20261120000500; the only change is that chosen tasks count towards "something to issue".
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
  if jsonb_array_length(v_payload->'milestones') + jsonb_array_length(v_payload->'delivery') + jsonb_array_length(v_payload->'site')
     + jsonb_array_length(coalesce(v_payload->'tasks', '[]'::jsonb)) = 0 then
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

-- The preview a manager looks at before issuing: the payload exactly as it would be issued now, and its hash. Null for anyone who may not manage the project.
create or replace function proj_plan_preview(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_payload jsonb;
begin
  perform proj_require_user();
  if not proj_can_manage(p_project_id) then return null; end if;
  v_payload := proj_build_plan_payload(p_project_id);
  return jsonb_build_object('payload', v_payload, 'hash', md5(v_payload::text));
end;
$$;

-- Issue ONLY what was previewed: refuses (and issues nothing) when the content is no longer the preview the manager saw.
create or replace function proj_issue_plan_checked(p_project_id uuid, p_expected_hash text, p_client_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v proj_projects; v_id uuid; v_hash text;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if p_expected_hash is null or length(btrim(p_expected_hash)) = 0 then raise exception 'Open the preview before issuing' using errcode = '22023'; end if;
  v_id := proj_issue_plan(p_project_id, p_client_reference, p_note);
  select payload_hash into v_hash from proj_issued_plans where id = v_id;
  if v_hash is distinct from btrim(p_expected_hash) then
    raise exception 'The timeline changed after you opened the preview. Nothing was issued. Check the preview again, then issue' using errcode = '40001';
  end if;
  return v_id;
end;
$$;

-- The whole choice of tasks for one project, set at once (idempotent). Rows: [{task_id, client_title}]. An empty list clears the choice. Each task must belong to the project and
-- not be cancelled, and each needs the title the client will read (never filled in silently from the internal title).
create or replace function proj_set_client_timeline_tasks(p_project_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v proj_projects; r jsonb; v_task uuid; v_title text; v_ids uuid[] := '{}'; v_added integer := 0; v_changed integer := 0; v_removed integer := 0; t proj_tasks; c proj_client_timeline_tasks;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if v.kind <> 'client' then raise exception 'Client timelines are for client projects' using errcode = '23514'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Give the chosen tasks as a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 100 then raise exception 'Choose at most 100 tasks for a client timeline' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_task := (r ->> 'task_id')::uuid;
    exception when others then raise exception 'A chosen task is not valid' using errcode = '22023';
    end;
    if v_task is null then raise exception 'A chosen task is not valid' using errcode = '22023'; end if;
    v_title := btrim(coalesce(r ->> 'client_title', ''));
    select * into t from proj_tasks where id = v_task and project_id = v.id;
    if not found then raise exception 'A chosen task is not part of this project' using errcode = 'P0002'; end if;
    if t.status = 'cancelled' then raise exception 'A cancelled task cannot be put on a client timeline' using errcode = '23514'; end if;
    if length(v_title) = 0 then raise exception 'Give every chosen task the title the client will see' using errcode = '22023'; end if;
    if length(v_title) > 200 then raise exception 'A client title can be at most 200 characters' using errcode = '22023'; end if;
    if v_task = any (v_ids) then continue; end if;
    v_ids := v_ids || v_task;
    select * into c from proj_client_timeline_tasks where task_id = v_task;
    if not found then
      insert into proj_client_timeline_tasks (task_id, project_id, client_title, selected_by) values (v_task, v.id, v_title, auth.uid());
      v_added := v_added + 1;
    elsif c.client_title is distinct from v_title then
      update proj_client_timeline_tasks set client_title = v_title, updated_at = now() where task_id = v_task;
      v_changed := v_changed + 1;
    end if;
  end loop;
  with gone as (delete from proj_client_timeline_tasks where project_id = v.id and not (task_id = any (v_ids)) returning 1)
  select count(*) into v_removed from gone;
  return jsonb_build_object('added', v_added, 'changed', v_changed, 'removed', v_removed, 'chosen', coalesce(array_length(v_ids, 1), 0));
end;
$$;

revoke all on function proj_client_task_status(text), proj_client_timeline_tasks_json(uuid), proj_build_plan_payload(uuid), proj_issue_plan(uuid, text, text), proj_plan_preview(uuid),
  proj_issue_plan_checked(uuid, text, text, text), proj_set_client_timeline_tasks(uuid, jsonb) from public, anon, authenticated;
grant execute on function proj_issue_plan(uuid, text, text), proj_plan_preview(uuid), proj_issue_plan_checked(uuid, text, text, text), proj_set_client_timeline_tasks(uuid, jsonb) to authenticated;
