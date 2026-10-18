-- Projects & Tasks (Release 2), migration 4 of 6: milestones, deliverables and tasks.
--
-- Roles (checked in every function, never inferred from HR roles or the reporting line):
--   * PM / acting PM / founder  manage scope: milestones, deliverables, any task, reassignment, acceptance of milestones.
--   * Department (team) head    manages the team's deliverables (status, dates) and the team's tasks, and accepts the
--                               team's deliverables and reviews the team's tasks.
--   * Assignee                  updates their own task (status, blocker, description, dates) and comments.
--   * Any member                creates a task for themselves, in their own team or no team; comments.
-- A reviewer is never the person whose work is being reviewed. Dates are plain dates and are never shifted
-- automatically: changing one records history and reports which dependent work is affected, for a person to decide.

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------
create or replace function proj_require_member_or_founder(p_project proj_projects)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not proj_can_view_details(p_project.id) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function proj_require_open_project(p_project proj_projects)
returns void
language plpgsql
as $$
begin
  if p_project.status in ('completed', 'archived') then
    raise exception 'A completed project is read-only. Reopen it first' using errcode = '23514';
  end if;
end;
$$;

create or replace function proj_task_event(p_task_id uuid, p_project_id uuid, p_kind text, p_from text, p_to text, p_note text default null)
returns void
language sql security definer
set search_path = public
as $$
  insert into proj_task_events (task_id, project_id, actor_id, kind, from_value, to_value, note)
  values (p_task_id, p_project_id, auth.uid(), p_kind, p_from, p_to, nullif(btrim(p_note), ''));
$$;

create or replace function proj_member_in_team(p_project_id uuid, p_user_id uuid, p_team_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from proj_project_members m where m.project_id = p_project_id and m.user_id = p_user_id and m.removed_at is null
                   and (p_team_id is null or m.team_id = p_team_id
                        or exists (select 1 from proj_teams t where t.id = p_team_id and t.head_user_id = p_user_id)));
$$;

-- -----------------------------------------------------------------------------
-- Milestones (PM defines and accepts)
-- -----------------------------------------------------------------------------
create or replace function proj_save_milestone(p_project_id uuid, p_milestone_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  m proj_milestones;
  v_id uuid;
  v_due date;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if p_milestone_id is null then
    if length(btrim(coalesce(p_fields->>'title', ''))) = 0 then raise exception 'Give the milestone a title' using errcode = '22023'; end if;
    insert into proj_milestones (project_id, title, description, due_date, is_required, client_facing, sort_order, created_by)
    values (v.id, btrim(p_fields->>'title'), proj_text_or_null(p_fields, 'description'), nullif(p_fields->>'due_date', '')::date,
            coalesce((p_fields->>'is_required')::boolean, true), coalesce((p_fields->>'client_facing')::boolean, false),
            coalesce((p_fields->>'sort_order')::integer, (select coalesce(max(sort_order), 0) + 10 from proj_milestones where project_id = v.id)),
            auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  select * into m from proj_milestones where id = p_milestone_id and project_id = v.id for update;
  if not found then raise exception 'Milestone not found' using errcode = 'P0002'; end if;
  perform proj_check_version(m.version, nullif(p_fields->>'expected_version', '')::integer);
  if m.status in ('accepted', 'cancelled') then raise exception 'An accepted or cancelled milestone can no longer be edited' using errcode = '23514'; end if;
  v_due := case when p_fields ? 'due_date' then nullif(p_fields->>'due_date', '')::date else m.due_date end;
  update proj_milestones set
    title = coalesce(proj_text_or_null(p_fields, 'title'), title),
    description = case when p_fields ? 'description' then proj_text_or_null(p_fields, 'description') else description end,
    due_date = v_due,
    is_required = coalesce((p_fields->>'is_required')::boolean, is_required),
    client_facing = coalesce((p_fields->>'client_facing')::boolean, client_facing),
    sort_order = coalesce((p_fields->>'sort_order')::integer, sort_order),
    version = version + 1
   where id = m.id;
  perform proj_log_change(v.id, 'milestone', m.id, 'due_date', m.due_date::text, v_due::text, p_fields->>'reason');
  if m.due_date is distinct from v_due then
    -- Material date change: tell the people responsible for the work attached to it. Nothing is rescheduled.
    perform proj_notify(v.id, x.user_id, 'project_deadline_changed',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'milestone', m.title, 'to', v_due), 'milestone:' || m.id || ':due:' || coalesce(v_due::text, 'none'))
    from (select distinct t.head_user_id as user_id from proj_deliverables d join proj_teams t on t.id = d.team_id where d.milestone_id = m.id and d.status not in ('accepted', 'cancelled')) x;
  end if;
  return m.id;
end;
$$;

create or replace function proj_set_milestone_status(p_milestone_id uuid, p_to text, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  m proj_milestones;
  v proj_projects;
begin
  perform proj_require_user();
  select * into m from proj_milestones where id = p_milestone_id for update;
  if not found then raise exception 'Milestone not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(m.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if m.status = p_to then return; end if;
  if p_to not in ('planned', 'in_progress', 'ready_for_acceptance', 'accepted', 'cancelled', 'deferred') then
    raise exception 'Unknown milestone status %', p_to using errcode = '22023';
  end if;
  if m.status in ('accepted', 'cancelled') and p_to <> 'in_progress' then
    raise exception 'This milestone is %. Reopen it to in progress first', m.status using errcode = '23514';
  end if;
  if p_to in ('cancelled', 'deferred') and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Say why the milestone is %', p_to using errcode = '22023';
  end if;
  if p_to = 'accepted' then
    if exists (select 1 from proj_deliverables d where d.milestone_id = m.id and d.status in ('open', 'in_progress', 'ready_for_review')) then
      raise exception 'Every deliverable of this milestone must be accepted, cancelled or deferred first' using errcode = '23514';
    end if;
  end if;
  if m.status in ('accepted', 'cancelled') and p_to = 'in_progress' and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Say why the milestone is being reopened' using errcode = '22023';
  end if;
  update proj_milestones set status = p_to, version = version + 1,
         accepted_by = case when p_to = 'accepted' then auth.uid() else null end,
         accepted_at = case when p_to = 'accepted' then now() else null end
   where id = m.id;
  perform proj_log_change(v.id, 'milestone', m.id, 'status', m.status, p_to, p_note);
end;
$$;

-- -----------------------------------------------------------------------------
-- Deliverables (PM assigns to a department team; the head manages and accepts)
-- -----------------------------------------------------------------------------
create or replace function proj_save_deliverable(p_project_id uuid, p_deliverable_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  d proj_deliverables;
  v_id uuid;
  v_team uuid;
  v_ms uuid;
  v_due date;
  v_is_manager boolean;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_open_project(v);
  v_is_manager := proj_can_manage(v.id);
  if p_deliverable_id is null then
    if not v_is_manager then raise exception 'Only the Project Manager can assign a deliverable to a department' using errcode = '42501'; end if;
    if length(btrim(coalesce(p_fields->>'title', ''))) = 0 then raise exception 'Give the deliverable a title' using errcode = '22023'; end if;
    v_team := nullif(p_fields->>'team_id', '')::uuid;
    v_ms := nullif(p_fields->>'milestone_id', '')::uuid;
    if v_team is not null and not exists (select 1 from proj_teams where id = v_team and project_id = v.id and removed_at is null) then
      raise exception 'Unknown department team' using errcode = '22023';
    end if;
    if v_ms is not null and not exists (select 1 from proj_milestones where id = v_ms and project_id = v.id) then
      raise exception 'Unknown milestone' using errcode = '22023';
    end if;
    insert into proj_deliverables (project_id, milestone_id, team_id, title, description, due_date, created_by)
    values (v.id, v_ms, v_team, btrim(p_fields->>'title'), proj_text_or_null(p_fields, 'description'), nullif(p_fields->>'due_date', '')::date, auth.uid())
    returning id into v_id;
    if v_team is not null then
      perform proj_notify(v.id, (select head_user_id from proj_teams where id = v_team), 'project_assignment',
        jsonb_build_object('name', v.name, 'reference', v.reference, 'deliverable', btrim(p_fields->>'title')), 'deliverable:' || v_id || ':assigned');
    end if;
    return v_id;
  end if;

  select * into d from proj_deliverables where id = p_deliverable_id and project_id = v.id for update;
  if not found then raise exception 'Deliverable not found' using errcode = 'P0002'; end if;
  perform proj_check_version(d.version, nullif(p_fields->>'expected_version', '')::integer);
  if d.status in ('accepted', 'cancelled') then raise exception 'An accepted or cancelled deliverable can no longer be edited' using errcode = '23514'; end if;
  if not v_is_manager and not (d.team_id is not null and proj_is_team_head(d.team_id)) then
    raise exception 'Only the Project Manager or the head of the responsible department can change this deliverable' using errcode = '42501';
  end if;
  -- A department head may refine the description and the date; scope-level changes (title, team, milestone) are the PM's.
  if not v_is_manager and (p_fields ? 'title' or p_fields ? 'team_id' or p_fields ? 'milestone_id') then
    raise exception 'Only the Project Manager can change the title, department or milestone of a deliverable' using errcode = '42501';
  end if;
  v_team := case when p_fields ? 'team_id' then nullif(p_fields->>'team_id', '')::uuid else d.team_id end;
  v_ms := case when p_fields ? 'milestone_id' then nullif(p_fields->>'milestone_id', '')::uuid else d.milestone_id end;
  v_due := case when p_fields ? 'due_date' then nullif(p_fields->>'due_date', '')::date else d.due_date end;
  if v_team is not null and not exists (select 1 from proj_teams where id = v_team and project_id = v.id and removed_at is null) then
    raise exception 'Unknown department team' using errcode = '22023';
  end if;
  if v_ms is not null and not exists (select 1 from proj_milestones where id = v_ms and project_id = v.id) then
    raise exception 'Unknown milestone' using errcode = '22023';
  end if;
  update proj_deliverables set
    title = coalesce(proj_text_or_null(p_fields, 'title'), title),
    description = case when p_fields ? 'description' then proj_text_or_null(p_fields, 'description') else description end,
    due_date = v_due, team_id = v_team, milestone_id = v_ms, version = version + 1
   where id = d.id;
  perform proj_log_change(v.id, 'deliverable', d.id, 'due_date', d.due_date::text, v_due::text, p_fields->>'reason');
  perform proj_log_change(v.id, 'deliverable', d.id, 'team', (select name from proj_teams where id = d.team_id), (select name from proj_teams where id = v_team));
  if d.due_date is distinct from v_due then
    perform proj_notify(v.id, x.user_id, 'project_deadline_changed',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'deliverable', d.title, 'to', v_due), 'deliverable:' || d.id || ':due:' || coalesce(v_due::text, 'none'))
    from (select pm_user_id as user_id from proj_projects where id = v.id
          union select head_user_id from proj_teams where id = v_team) x;
  end if;
  return d.id;
end;
$$;

create or replace function proj_set_deliverable_status(p_deliverable_id uuid, p_to text, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  d proj_deliverables;
  v proj_projects;
  v_is_manager boolean;
  v_is_head boolean;
begin
  perform proj_require_user();
  select * into d from proj_deliverables where id = p_deliverable_id for update;
  if not found then raise exception 'Deliverable not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(d.project_id);
  perform proj_require_open_project(v);
  v_is_manager := proj_can_manage(v.id);
  v_is_head := d.team_id is not null and proj_is_team_head(d.team_id);
  if not (v_is_manager or v_is_head) then
    raise exception 'Only the Project Manager or the head of the responsible department can change this deliverable''s status' using errcode = '42501';
  end if;
  if d.status = p_to then return; end if;
  if p_to not in ('open', 'in_progress', 'ready_for_review', 'accepted', 'cancelled', 'deferred') then
    raise exception 'Unknown deliverable status %', p_to using errcode = '22023';
  end if;
  if d.status in ('accepted', 'cancelled') and p_to <> 'in_progress' then
    raise exception 'This deliverable is %. Reopen it to in progress first', d.status using errcode = '23514';
  end if;
  if p_to in ('cancelled', 'deferred') and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Say why the deliverable is %', p_to using errcode = '22023';
  end if;
  if d.status in ('accepted', 'cancelled') and p_to = 'in_progress' and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Say why the deliverable is being reopened' using errcode = '22023';
  end if;
  if p_to = 'accepted' then
    if exists (select 1 from proj_tasks t where t.deliverable_id = d.id and t.status in ('todo', 'in_progress', 'ready_for_review')) then
      raise exception 'Every task of this deliverable must be done, cancelled or deferred first' using errcode = '23514';
    end if;
  end if;
  update proj_deliverables set status = p_to, version = version + 1,
         accepted_by = case when p_to = 'accepted' then auth.uid() else null end,
         accepted_at = case when p_to = 'accepted' then now() else null end
   where id = d.id;
  perform proj_log_change(v.id, 'deliverable', d.id, 'status', d.status, p_to, p_note);
  if p_to = 'ready_for_review' and d.team_id is not null then
    perform proj_notify(v.id, v.pm_user_id, 'project_review_requested',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'deliverable', d.title), 'deliverable:' || d.id || ':review:' || (d.version + 1));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tasks
-- -----------------------------------------------------------------------------
-- Dependencies: same project, no self-reference, no cycles. The cycle check walks the existing graph from each proposed
-- prerequisite and refuses if it can reach the task itself.
create or replace function proj_set_task_dependencies(p_task_id uuid, p_depends_on uuid[])
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  x uuid;
begin
  select * into t from proj_tasks where id = p_task_id;
  p_depends_on := coalesce((select array_agg(distinct u) from unnest(coalesce(p_depends_on, '{}'::uuid[])) u), '{}'::uuid[]);
  foreach x in array p_depends_on loop
    if x = t.id then raise exception 'A task cannot depend on itself' using errcode = '23514'; end if;
    if not exists (select 1 from proj_tasks where id = x and project_id = t.project_id) then
      raise exception 'A dependency must be a task of the same project' using errcode = '22023';
    end if;
    -- would x (transitively) already depend on t?
    if exists (
      with recursive chain(id) as (
        select depends_on_task_id from proj_task_dependencies where task_id = x
        union
        select d.depends_on_task_id from proj_task_dependencies d join chain c on d.task_id = c.id
      ) select 1 from chain where id = t.id
    ) then
      raise exception 'That dependency would create a loop between tasks' using errcode = '23514';
    end if;
  end loop;
  delete from proj_task_dependencies where task_id = t.id and depends_on_task_id <> all (p_depends_on);
  insert into proj_task_dependencies (task_id, depends_on_task_id, project_id)
  select t.id, u, t.project_id from unnest(p_depends_on) u
  on conflict do nothing;
end;
$$;

create or replace function proj_set_task_collaborators(p_task_id uuid, p_user_ids uuid[])
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  x uuid;
begin
  select * into t from proj_tasks where id = p_task_id;
  p_user_ids := coalesce((select array_agg(distinct u) from unnest(coalesce(p_user_ids, '{}'::uuid[])) u where u <> t.assignee_id), '{}'::uuid[]);
  foreach x in array p_user_ids loop
    if not exists (select 1 from proj_project_members where project_id = t.project_id and user_id = x and removed_at is null) then
      raise exception 'Collaborators must be active members of the project' using errcode = '22023';
    end if;
  end loop;
  delete from proj_task_collaborators where task_id = t.id and user_id <> all (p_user_ids);
  insert into proj_task_collaborators (task_id, user_id, project_id) select t.id, u, t.project_id from unnest(p_user_ids) u on conflict do nothing;
end;
$$;

create or replace function proj_create_task(p_project_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  v_assignee uuid;
  v_team uuid;
  v_deliverable uuid;
  v_milestone uuid;
  v_id uuid;
  v_manager boolean;
  v_my_team uuid;
  v_title text := btrim(coalesce(p_fields->>'title', ''));
  dl proj_deliverables;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_member_or_founder(v);
  perform proj_require_open_project(v);
  if length(v_title) = 0 then raise exception 'Give the task a title' using errcode = '22023'; end if;
  v_manager := proj_can_manage(v.id);
  v_assignee := coalesce(nullif(p_fields->>'assignee_id', '')::uuid, auth.uid());
  v_team := nullif(p_fields->>'team_id', '')::uuid;
  v_deliverable := nullif(p_fields->>'deliverable_id', '')::uuid;
  v_milestone := nullif(p_fields->>'milestone_id', '')::uuid;

  if v_deliverable is not null then
    select * into dl from proj_deliverables where id = v_deliverable and project_id = v.id;
    if not found then raise exception 'Unknown deliverable' using errcode = '22023'; end if;
    v_team := coalesce(v_team, dl.team_id);
    v_milestone := coalesce(v_milestone, dl.milestone_id);
  end if;
  if v_team is not null and not exists (select 1 from proj_teams where id = v_team and project_id = v.id and removed_at is null) then
    raise exception 'Unknown department team' using errcode = '22023';
  end if;
  if v_milestone is not null and not exists (select 1 from proj_milestones where id = v_milestone and project_id = v.id) then
    raise exception 'Unknown milestone' using errcode = '22023';
  end if;
  if not exists (select 1 from proj_project_members where project_id = v.id and user_id = v_assignee and removed_at is null) then
    raise exception 'The assignee must be an active member of the project' using errcode = '22023';
  end if;

  if not v_manager then
    if v_team is not null and proj_is_team_head(v_team) then
      -- A department head distributes the team's work to the team (or themself).
      if not proj_member_in_team(v.id, v_assignee, v_team) then
        raise exception 'A department head assigns tasks to people in their own team' using errcode = '42501';
      end if;
    else
      -- Any member: a task for themself, in their own team or no team, never into someone else's deliverable.
      select team_id into v_my_team from proj_project_members where project_id = v.id and user_id = auth.uid() and removed_at is null;
      if v_assignee <> auth.uid() then
        raise exception 'You can create tasks for yourself. Ask your department head or the Project Manager to assign work to others' using errcode = '42501';
      end if;
      if v_team is not null and v_team is distinct from v_my_team then
        raise exception 'You can only add tasks to your own department' using errcode = '42501';
      end if;
    end if;
  end if;

  insert into proj_tasks (project_id, deliverable_id, milestone_id, team_id, title, description, assignee_id, priority, start_date, due_date, requires_review, created_by)
  values (v.id, v_deliverable, v_milestone, v_team, v_title, proj_text_or_null(p_fields, 'description'), v_assignee,
          coalesce(proj_text_or_null(p_fields, 'priority'), 'normal'), nullif(p_fields->>'start_date', '')::date, nullif(p_fields->>'due_date', '')::date,
          case when v_manager or (v_team is not null and proj_is_team_head(v_team)) then coalesce((p_fields->>'requires_review')::boolean, false) else false end,
          auth.uid())
  returning id into v_id;
  perform proj_task_event(v_id, v.id, 'created', null, proj_display_name(v_assignee), null);
  if p_fields ? 'depends_on' then
    perform proj_set_task_dependencies(v_id, array(select jsonb_array_elements_text(p_fields->'depends_on')::uuid));
  end if;
  if p_fields ? 'collaborator_ids' then
    perform proj_set_task_collaborators(v_id, array(select jsonb_array_elements_text(p_fields->'collaborator_ids')::uuid));
  end if;
  if v_assignee <> auth.uid() then
    perform proj_notify(v.id, v_assignee, 'project_task_assigned',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', v_id, 'task', v_title), 'task:' || v_id || ':assigned:' || v_assignee);
  end if;
  return v_id;
end;
$$;

-- Who may change a task's content: PM/founder, the team head, the assignee.
create or replace function proj_task_actor_role(p_task proj_tasks)
returns text
language sql stable security definer
set search_path = public
as $$
  select case
    when proj_can_manage(p_task.project_id) then 'manager'
    when p_task.team_id is not null and proj_is_team_head(p_task.team_id) then 'head'
    when p_task.assignee_id = auth.uid() and proj_is_active_member(p_task.project_id) then 'assignee'
    else null end;
$$;

-- Dependent work touched by a date change: tasks that rely on this one and start (or finish) before it now finishes.
create or replace function proj_task_affected(p_task_id uuid, p_new_due date default null)
returns table (task_id uuid, title text, assignee_name text, start_date date, due_date date)
language plpgsql stable security definer
set search_path = public
as $$
declare t proj_tasks;
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id;
  if not found or not proj_can_view_details(t.project_id) then return; end if;
  return query
    select d.id, d.title, proj_display_name(d.assignee_id), d.start_date, d.due_date
    from proj_task_dependencies dep join proj_tasks d on d.id = dep.task_id
    where dep.depends_on_task_id = t.id and d.status not in ('done', 'cancelled')
      and coalesce(p_new_due, t.due_date) is not null
      and (coalesce(d.start_date, d.due_date) <= coalesce(p_new_due, t.due_date));
end;
$$;

create or replace function proj_update_task(p_task_id uuid, p_fields jsonb, p_expected_version integer default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  v proj_projects;
  v_role text;
  v_start date;
  v_due date;
  v_affected integer := 0;
  k text;
  v_allowed text[] := array['title', 'description', 'priority', 'start_date', 'due_date', 'requires_review', 'milestone_id', 'deliverable_id',
                            'team_id', 'depends_on', 'collaborator_ids', 'reason'];
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  v_role := proj_task_actor_role(t);
  if v_role is null then raise exception 'Only the assignee, the department head or the Project Manager can change this task' using errcode = '42501'; end if;
  perform proj_check_version(t.version, p_expected_version);
  if t.status in ('done', 'cancelled') then raise exception 'A % task can no longer be edited. Reopen it first', t.status using errcode = '23514'; end if;
  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any (v_allowed)) then raise exception 'Field % cannot be changed here', k using errcode = '22023'; end if;
  end loop;
  -- Placement in the plan (and the review rule) is a leadership decision; the assignee refines their own task.
  if v_role = 'assignee' and (p_fields ? 'requires_review' or p_fields ? 'milestone_id' or p_fields ? 'deliverable_id' or p_fields ? 'team_id') then
    raise exception 'Ask your department head or the Project Manager to change where this task sits or whether it needs review' using errcode = '42501';
  end if;
  if p_fields ? 'team_id' and nullif(p_fields->>'team_id', '')::uuid is not null
     and not exists (select 1 from proj_teams where id = nullif(p_fields->>'team_id', '')::uuid and project_id = v.id and removed_at is null) then
    raise exception 'Unknown department team' using errcode = '22023';
  end if;
  if p_fields ? 'deliverable_id' and nullif(p_fields->>'deliverable_id', '')::uuid is not null
     and not exists (select 1 from proj_deliverables where id = nullif(p_fields->>'deliverable_id', '')::uuid and project_id = v.id) then
    raise exception 'Unknown deliverable' using errcode = '22023';
  end if;
  if p_fields ? 'milestone_id' and nullif(p_fields->>'milestone_id', '')::uuid is not null
     and not exists (select 1 from proj_milestones where id = nullif(p_fields->>'milestone_id', '')::uuid and project_id = v.id) then
    raise exception 'Unknown milestone' using errcode = '22023';
  end if;
  v_start := case when p_fields ? 'start_date' then nullif(p_fields->>'start_date', '')::date else t.start_date end;
  v_due := case when p_fields ? 'due_date' then nullif(p_fields->>'due_date', '')::date else t.due_date end;
  if v_due is not null and v_start is not null and v_due < v_start then
    raise exception 'The due date cannot be before the start date' using errcode = '23514';
  end if;

  update proj_tasks set
    title = coalesce(proj_text_or_null(p_fields, 'title'), title),
    description = case when p_fields ? 'description' then proj_text_or_null(p_fields, 'description') else description end,
    priority = coalesce(proj_text_or_null(p_fields, 'priority'), priority),
    start_date = v_start, due_date = v_due,
    requires_review = coalesce((p_fields->>'requires_review')::boolean, requires_review),
    milestone_id = case when p_fields ? 'milestone_id' then nullif(p_fields->>'milestone_id', '')::uuid else milestone_id end,
    deliverable_id = case when p_fields ? 'deliverable_id' then nullif(p_fields->>'deliverable_id', '')::uuid else deliverable_id end,
    team_id = case when p_fields ? 'team_id' then nullif(p_fields->>'team_id', '')::uuid else team_id end,
    version = version + 1
   where id = t.id;
  if p_fields ? 'depends_on' then
    perform proj_set_task_dependencies(t.id, array(select jsonb_array_elements_text(p_fields->'depends_on')::uuid));
  end if;
  if p_fields ? 'collaborator_ids' then
    perform proj_set_task_collaborators(t.id, array(select jsonb_array_elements_text(p_fields->'collaborator_ids')::uuid));
  end if;

  if t.start_date is distinct from v_start then
    perform proj_task_event(t.id, v.id, 'start_date_changed', t.start_date::text, v_start::text, p_fields->>'reason');
  end if;
  if t.due_date is distinct from v_due then
    perform proj_task_event(t.id, v.id, 'due_date_changed', t.due_date::text, v_due::text, p_fields->>'reason');
    select count(*) into v_affected from proj_task_affected(t.id, v_due);
    -- Material deadline change: the assignee (if someone else moved it) or the people who plan the work (if the assignee did).
    if v_role = 'assignee' then
      perform proj_notify(v.id, x.user_id, 'project_deadline_changed',
        jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title, 'to', v_due), 'task:' || t.id || ':due:' || coalesce(v_due::text, 'none'))
      from (select v.pm_user_id as user_id union select head_user_id from proj_teams where id = t.team_id) x;
    else
      perform proj_notify(v.id, t.assignee_id, 'project_deadline_changed',
        jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title, 'to', v_due), 'task:' || t.id || ':due:' || coalesce(v_due::text, 'none'));
    end if;
  end if;
  if p_fields ? 'requires_review' and t.requires_review is distinct from (p_fields->>'requires_review')::boolean then
    perform proj_task_event(t.id, v.id, 'review_rule_changed', t.requires_review::text, p_fields->>'requires_review', null);
  end if;
  return v_affected;
end;
$$;

create or replace function proj_reassign_task(p_task_id uuid, p_assignee_id uuid, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  v proj_projects;
  v_role text;
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  v_role := proj_task_actor_role(t);
  if v_role not in ('manager', 'head') then
    raise exception 'Only the department head or the Project Manager can reassign a task' using errcode = '42501';
  end if;
  if t.status in ('done', 'cancelled') then raise exception 'A % task cannot be reassigned', t.status using errcode = '23514'; end if;
  if t.assignee_id = p_assignee_id then return; end if;
  if not exists (select 1 from proj_project_members where project_id = v.id and user_id = p_assignee_id and removed_at is null) then
    raise exception 'The assignee must be an active member of the project' using errcode = '22023';
  end if;
  if v_role = 'head' and not proj_member_in_team(v.id, p_assignee_id, t.team_id) then
    raise exception 'A department head assigns tasks to people in their own team' using errcode = '42501';
  end if;
  update proj_tasks set assignee_id = p_assignee_id, version = version + 1 where id = t.id;
  delete from proj_task_collaborators where task_id = t.id and user_id = p_assignee_id;
  perform proj_task_event(t.id, v.id, 'reassigned', proj_display_name(t.assignee_id), proj_display_name(p_assignee_id), p_note);
  perform proj_notify(v.id, p_assignee_id, 'project_task_assigned',
    jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title), 'task:' || t.id || ':assigned:' || p_assignee_id);
end;
$$;

-- Status. Owners finish routine tasks themselves. A task that needs review is finished by someone ELSE with authority
-- (department head or PM): never by the person who did the work.
create or replace function proj_set_task_status(p_task_id uuid, p_to text, p_note text default null, p_expected_version integer default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  v proj_projects;
  v_role text;
  v_is_reviewer boolean;
  v_reviewer uuid;
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  v_role := proj_task_actor_role(t);
  if v_role is null then raise exception 'Only the assignee, the department head or the Project Manager can change this task' using errcode = '42501'; end if;
  perform proj_check_version(t.version, p_expected_version);
  if t.status = p_to then return; end if;
  if p_to not in ('todo', 'in_progress', 'ready_for_review', 'done', 'cancelled', 'deferred') then
    raise exception 'Unknown task status %', p_to using errcode = '22023';
  end if;
  v_is_reviewer := v_role in ('manager', 'head') and t.assignee_id <> auth.uid();

  if t.status in ('done', 'cancelled', 'deferred') then
    if p_to not in ('in_progress', 'todo') or v_role not in ('manager', 'head') then
      raise exception 'Only the department head or the Project Manager can reopen a % task, back to To do or In progress', t.status using errcode = '42501';
    end if;
    if length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Say why the task is being reopened' using errcode = '22023'; end if;
  elsif p_to = 'done' then
    if t.requires_review then
      if t.status <> 'ready_for_review' then raise exception 'This task needs review: send it for review first' using errcode = '23514'; end if;
      if not v_is_reviewer then
        raise exception 'This task needs review by the department head or the Project Manager, not by the person who did it' using errcode = '42501';
      end if;
    elsif v_role = 'assignee' or v_role in ('manager', 'head') then
      null;
    end if;
    if t.blocked_at is not null then raise exception 'Clear the blocker before completing the task' using errcode = '23514'; end if;
  elsif p_to = 'ready_for_review' then
    if not t.requires_review then raise exception 'This task does not need review: mark it Done' using errcode = '23514'; end if;
  elsif p_to = 'in_progress' and t.status = 'ready_for_review' then
    if not v_is_reviewer and v_role <> 'assignee' then raise exception 'Not allowed' using errcode = '42501'; end if;
    -- Reviewer requesting changes should say what; the assignee withdrawing from review needs no note.
    if v_role <> 'assignee' and length(btrim(coalesce(p_note, ''))) = 0 then
      raise exception 'Say what needs changing' using errcode = '22023';
    end if;
  elsif p_to in ('cancelled', 'deferred') then
    if v_role not in ('manager', 'head') then raise exception 'Only the department head or the Project Manager can cancel or defer a task' using errcode = '42501'; end if;
    if length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Say why the task is %', p_to using errcode = '22023'; end if;
  end if;

  update proj_tasks set status = p_to, version = version + 1,
         completed_at = case when p_to = 'done' then now() else null end,
         completed_by = case when p_to = 'done' then auth.uid() else null end
   where id = t.id;
  perform proj_task_event(t.id, v.id, 'status_changed', t.status, p_to, p_note);

  if p_to = 'ready_for_review' then
    v_reviewer := coalesce((select head_user_id from proj_teams where id = t.team_id and head_user_id <> t.assignee_id), v.pm_user_id);
    perform proj_notify(v.id, v_reviewer, 'project_review_requested',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title), 'task:' || t.id || ':review:' || (t.version + 1));
  elsif t.status = 'ready_for_review' and p_to in ('in_progress', 'done') and v_is_reviewer then
    perform proj_notify(v.id, t.assignee_id, 'project_review_result',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title, 'result', p_to), 'task:' || t.id || ':result:' || (t.version + 1));
  end if;
end;
$$;

create or replace function proj_block_task(p_task_id uuid, p_reason text, p_unblock_owner uuid default null, p_unblock_action text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  v proj_projects;
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  if proj_task_actor_role(t) is null then raise exception 'Only the assignee, the department head or the Project Manager can block this task' using errcode = '42501'; end if;
  if t.status in ('done', 'cancelled', 'deferred') then raise exception 'A % task cannot be blocked', t.status using errcode = '23514'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Say what is blocking the task' using errcode = '22023'; end if;
  if p_unblock_owner is null and length(btrim(coalesce(p_unblock_action, ''))) = 0 then
    raise exception 'Say who or what action will unblock it' using errcode = '22023';
  end if;
  if p_unblock_owner is not null and not exists (select 1 from proj_project_members where project_id = v.id and user_id = p_unblock_owner and removed_at is null) then
    raise exception 'The person who can unblock it must be a member of the project' using errcode = '22023';
  end if;
  update proj_tasks set blocked_at = now(), blocked_reason = btrim(p_reason), unblock_owner_id = p_unblock_owner,
         unblock_action = nullif(btrim(p_unblock_action), ''), version = version + 1 where id = t.id;
  perform proj_task_event(t.id, v.id, 'blocked', null, btrim(p_reason), p_unblock_action);
  perform proj_notify(v.id, coalesce(p_unblock_owner, v.pm_user_id), 'project_task_blocked',
    jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title, 'reason', btrim(p_reason)), 'task:' || t.id || ':blocked:' || (t.version + 1));
end;
$$;

create or replace function proj_unblock_task(p_task_id uuid, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  v proj_projects;
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  if proj_task_actor_role(t) is null and t.unblock_owner_id is distinct from auth.uid() then
    raise exception 'Only the assignee, the department head, the Project Manager or the named unblocker can clear this blocker' using errcode = '42501';
  end if;
  if t.blocked_at is null then return; end if;
  update proj_tasks set blocked_at = null, blocked_reason = null, unblock_owner_id = null, unblock_action = null, version = version + 1 where id = t.id;
  perform proj_task_event(t.id, v.id, 'unblocked', t.blocked_reason, null, p_note);
end;
$$;

create or replace function proj_comment_task(p_task_id uuid, p_body text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  v_id uuid;
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id;
  if not found or not proj_can_view_details(t.project_id) then raise exception 'Task not found' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Write a comment' using errcode = '22023'; end if;
  insert into proj_task_comments (task_id, project_id, author_id, body) values (t.id, t.project_id, auth.uid(), btrim(p_body)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function proj_edit_task_comment(p_comment_id uuid, p_body text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Write a comment' using errcode = '22023'; end if;
  update proj_task_comments set body = btrim(p_body), edited_at = now()
   where id = p_comment_id and author_id = auth.uid() and proj_can_view_details(project_id);
  if not found then raise exception 'Comment not found' using errcode = 'P0002'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Progress, stated with its basis: accepted required milestones / required milestones (cancelled and deferred excluded
-- from the denominator). Nothing is derived from elapsed time.
-- -----------------------------------------------------------------------------
create or replace function proj_milestone_progress(p_project_id uuid)
returns table (accepted_required integer, total_required integer)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if not proj_can_view_details(p_project_id) then return; end if;
  return query
    select count(*) filter (where m.status = 'accepted')::integer, count(*) filter (where m.status not in ('cancelled', 'deferred'))::integer
    from proj_milestones m where m.project_id = p_project_id and m.is_required;
end;
$$;

-- -----------------------------------------------------------------------------
-- Names for the people on a project (members only; no HR data, no e-mail).
-- -----------------------------------------------------------------------------
create or replace function proj_project_people(p_project_id uuid)
returns table (user_id uuid, full_name text, role text, team_id uuid, is_team_head boolean, acting_until date)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if not proj_can_view_details(p_project_id) then return; end if;
  return query
    select m.user_id, proj_display_name(m.user_id), m.role, m.team_id,
           exists (select 1 from proj_teams t where t.project_id = m.project_id and t.head_user_id = m.user_id and t.removed_at is null),
           m.acting_until
    from proj_project_members m where m.project_id = p_project_id and m.removed_at is null
    order by 2;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  proj_require_member_or_founder(proj_projects), proj_require_open_project(proj_projects),
  proj_task_event(uuid, uuid, text, text, text, text), proj_member_in_team(uuid, uuid, uuid),
  proj_set_task_dependencies(uuid, uuid[]), proj_set_task_collaborators(uuid, uuid[]), proj_task_actor_role(proj_tasks),
  proj_save_milestone(uuid, uuid, jsonb), proj_set_milestone_status(uuid, text, text),
  proj_save_deliverable(uuid, uuid, jsonb), proj_set_deliverable_status(uuid, text, text),
  proj_create_task(uuid, jsonb), proj_task_affected(uuid, date), proj_update_task(uuid, jsonb, integer),
  proj_reassign_task(uuid, uuid, text), proj_set_task_status(uuid, text, text, integer),
  proj_block_task(uuid, text, uuid, text), proj_unblock_task(uuid, text), proj_comment_task(uuid, text),
  proj_edit_task_comment(uuid, text), proj_milestone_progress(uuid), proj_project_people(uuid)
  from public, anon, authenticated;

grant execute on function
  proj_save_milestone(uuid, uuid, jsonb), proj_set_milestone_status(uuid, text, text),
  proj_save_deliverable(uuid, uuid, jsonb), proj_set_deliverable_status(uuid, text, text),
  proj_create_task(uuid, jsonb), proj_task_affected(uuid, date), proj_update_task(uuid, jsonb, integer),
  proj_reassign_task(uuid, uuid, text), proj_set_task_status(uuid, text, text, integer),
  proj_block_task(uuid, text, uuid, text), proj_unblock_task(uuid, text), proj_comment_task(uuid, text),
  proj_edit_task_comment(uuid, text), proj_milestone_progress(uuid), proj_project_people(uuid)
  to authenticated;
