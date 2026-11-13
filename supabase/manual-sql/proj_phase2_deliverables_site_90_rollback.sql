-- WRITES. OWNER-RUN ROLLBACK of 20270106000100_proj_phase2_deliverables_site.sql. Safe to run twice. Deploy the app from before Phase 2 FIRST (it calls these functions).
-- It STOPS if Phase 2 data exists (submitted versions, expected outputs, site activity details, crew or shipments): export that first and clear it. It then restores the previous
-- body of proj_set_task_status, drops the new functions and tables and columns, and puts the change-log list back. Tasks, files, plan items, requests and bookings are never touched.
begin;
do $$
begin
  if to_regclass('public.proj_task_output_versions') is not null and exists (select 1 from proj_task_output_versions) then raise exception 'STOP: task output versions exist. Export and delete them first.'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'proj_tasks' and column_name = 'output_label') and exists (select 1 from proj_tasks where output_label is not null) then raise exception 'STOP: tasks with an expected output exist. Clear the expected outputs first.'; end if;
  if to_regclass('public.proj_site_crew') is not null and exists (select 1 from proj_site_crew) then raise exception 'STOP: site crew rows exist. Export and delete them first.'; end if;
  if to_regclass('public.proj_site_shipments') is not null and exists (select 1 from proj_site_shipments) then raise exception 'STOP: shipments exist. Export and delete them first.'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'proj_plan_items' and column_name = 'activity_kind') and exists (select 1 from proj_plan_items where activity_kind is not null or run_label is not null or location is not null or owner_id is not null or confirmed_at is not null) then
    raise exception 'STOP: site activities with Phase 2 details exist. Export them and clear the details first.'; end if;
  if exists (select 1 from proj_change_log where entity_type in ('task_output', 'site_activity', 'shipment')) then raise exception 'STOP: change log entries of Phase 2 exist. Export and delete them first.'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'proj_feedback' and column_name = 'output_version_id') and exists (select 1 from proj_feedback where output_version_id is not null or activation_id is not null) then raise exception 'STOP: feedback links exist. Clear them first.'; end if;
end $$;

drop function if exists proj_work_overview(uuid);
drop function if exists proj_site_schedule(uuid);
drop function if exists proj_site_activity_json(uuid, text);
drop function if exists proj_remove_shipment(uuid);
drop function if exists proj_save_shipment(uuid, uuid, jsonb);
drop function if exists proj_set_site_crew(uuid, jsonb);
drop function if exists proj_add_site_activities(uuid, jsonb);
drop function if exists proj_save_site_activity(uuid, uuid, jsonb);
drop function if exists proj_deliverables_register(uuid, uuid);
drop function if exists proj_output_version_json(uuid);
drop function if exists proj_output_file_json(uuid, uuid);
drop function if exists proj_link_feedback_output(uuid, uuid, uuid);
drop function if exists proj_decide_task_output(uuid, text, text);
drop function if exists proj_submit_task_output(uuid, uuid, uuid, integer, text, boolean, text, integer);
drop function if exists proj_set_task_output(uuid, text, integer, boolean, integer);

-- The previous review / completion function (no required-output block).
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

drop function if exists proj_file_usable(uuid, uuid);
alter table proj_feedback drop column if exists output_version_id;
alter table proj_feedback drop column if exists activation_id;
drop table if exists proj_site_shipments;
drop table if exists proj_site_crew;
drop table if exists proj_task_output_versions;
drop index if exists uq_proj_plan_items_client_key;
alter table proj_plan_items drop constraint if exists proj_plan_items_confirmed;
alter table proj_plan_items drop column if exists client_key, drop column if exists confirmed_by, drop column if exists confirmed_at, drop column if exists activity_state, drop column if exists owner_id,
  drop column if exists location, drop column if exists run_label, drop column if exists activity_kind;
alter table proj_tasks drop constraint if exists proj_tasks_output_shape;
alter table proj_tasks drop column if exists output_required, drop column if exists output_qty, drop column if exists output_label;
alter table proj_change_log drop constraint if exists proj_change_log_entity_type_check;
alter table proj_change_log add constraint proj_change_log_entity_type_check check (entity_type in ('project', 'milestone', 'deliverable', 'plan_item', 'booking', 'member', 'message', 'external_dependency'));
commit;
