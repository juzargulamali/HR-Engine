-- A blocker that names someone other than the Project Manager also tells the Project Manager (completion pass, section 2). ADDITIVE: replaces one function in
-- place (create or replace); no table, column, policy or privilege changes, no data changes. Execute privileges are kept by create or replace.
--
-- WHY: proj_block_task told only the named unblocker. When that person was not the PM (a colleague, a team member), the PM, who is accountable for the project,
-- only learned of the blocker by opening the task.
--
-- RULE (unchanged part): the person named as able to unblock the task is told, or the Project Manager when no person is named (only an action is written).
-- NEW: when a person is named and is NOT the Project Manager, the Project Manager is ALSO told ('project_task_blocked' with fyi = true and the unblocker's
-- name, so the notice says who was asked and does not say the PM must act). One notice per person: nothing is sent twice to the same person (the named
-- person is the PM: one notice; proj_notify also deduplicates an unread notice with the same key), and the person who reports the blocker is never told about
-- their own action (proj_notify skips the caller), also when the reporter IS the PM. proj_notify's existing rules still decide who can be reached (an active
-- person who can open the project); nobody gains access to anything.
--
-- UNCHANGED: who may block (assignee, department head, PM), the required reason, the required unblock responsibility (a project member, or a written action), the
-- event record, and proj_unblock_task.

create or replace function proj_block_task(p_task_id uuid, p_reason text, p_unblock_owner uuid default null, p_unblock_action text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  v proj_projects;
  v_unblocker text;
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
  -- Also tell the Project Manager when someone else was named (the PM is accountable for the project). Never twice to the same person, never the reporter.
  if p_unblock_owner is not null and v.pm_user_id is not null and v.pm_user_id is distinct from p_unblock_owner then
    select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_unblocker from profiles where id = p_unblock_owner;
    perform proj_notify(v.id, v.pm_user_id, 'project_task_blocked',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title, 'reason', btrim(p_reason), 'fyi', true, 'unblocker', coalesce(v_unblocker, 'a colleague')),
      'task:' || t.id || ':blocked:' || (t.version + 1));
  end if;
end;
$$;
