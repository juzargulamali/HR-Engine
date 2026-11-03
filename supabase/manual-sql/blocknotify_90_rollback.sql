-- WRITES (one function definition only; no table, row or privilege is touched). OWNER-RUN ROLLBACK of the blocker notification change
-- (20261216000900_proj_block_task_notifies_pm.sql): restores proj_block_task to exactly the definition that was live before it
-- (the one in 20261120000300_proj_delivery_functions.sql).
--
-- WHEN TO USE IT: only if the extra notice to the Project Manager causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back means a blocker that names someone other than the Project Manager tells only that person again. Notices already written stay as
-- ordinary rows, nothing is deleted; who may block, what must be given and who can clear a blocker do not change either way.
--
-- It is safe to run twice. Afterwards blocknotify_20_verify_readonly.sql reports the new rules as missing (that is how it tells you the old definition is
-- back), or run blocknotify_05_preservation_check_readonly.sql against your BEFORE snapshot (the fn: row then says UNCHANGED).
-- Execute privileges are kept by create or replace; nothing here grants or revokes anything.

begin;

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

commit;
