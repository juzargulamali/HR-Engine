-- =============================================================================
-- Third audit pass: authorization fixes.
--
-- 1. create_initial_approval() + dropping approvals_insert_initial —
--    CRITICAL. That policy only checked step_order/decision/is_entity_owner,
--    never workflow_id or approver_id, so any owner of an entity could
--    forge the first approvals row with workflow_id = null (or any other
--    workflow) and approver_id = themselves, then call
--    decide_leave_approval() to self-approve — including
--    payroll_export_run's mandatory Finance-then-CEO sign-off. This
--    function re-resolves the workflow/approver itself and is now the
--    only way an approvals row is ever created.
--
-- 2. guard_policy_version_update() — CRITICAL. Checked
--    has_role('hr_admin', null, new.country_code) instead of
--    old.country_code — the same NEW-vs-OLD mistake already fixed once in
--    guard_employee_self_update() (supabase/migrations/20261009000000_...).
--    A CEO of country A who also holds hr_admin in country B could rewrite
--    a country-A draft policy's content while relocating it to country B
--    in the same UPDATE.
--
-- 3. guard_payroll_workflow_immutable() — checked only the NEW row's
--    workflow_id, so an HR Admin could evade "the payroll workflow's steps
--    are immutable" by re-parenting a payroll step onto a different,
--    ordinary workflow they also manage (new.workflow_id then resolves to
--    a non-payroll entity_type). Now checks both old and new.
--
-- 4. guard_appraisal_acknowledge() — HIGH. Had no constraint on employee_id
--    at all when the caller is the appraiser, so any manager who created
--    one legitimate appraisal could retarget it onto an arbitrary employee
--    (even cross-company) while it's still a draft.
--
-- 5. guard_goal_employee_immutable() (new trigger) — MEDIUM. goals_write_self
--    and goals_write_manager both apply to an UPDATE, and Postgres
--    OR-combines every applicable policy's WITH CHECK independently of
--    USING — so a manager targeting a report's goal could set
--    employee_id to their own id in the same UPDATE and goals_write_self's
--    check would pass against the new row, hijacking the goal.
--
-- 6. resolve_approver()/resolve_approver_for_company() — MEDIUM. Neither
--    excluded a terminated/deleted employee, so a terminated manager or
--    sole role-holder remained a valid, resolvable approver of leave,
--    reimbursements, and payroll indefinitely.
-- =============================================================================

create or replace function create_initial_approval(p_entity_type approvable_entity, p_entity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_employee_id uuid;
  v_workflow_id uuid;
  v_approver_type text;
  v_approver_id uuid;
  v_approval_id uuid;
begin
  if not is_entity_owner(p_entity_type, p_entity_id) then
    raise exception 'You do not own this % (or it does not exist)', p_entity_type;
  end if;

  if p_entity_type = 'leave_request' then
    select e.company_id, r.employee_id into v_company_id, v_employee_id
    from leave_requests r join employees e on e.id = r.employee_id where r.id = p_entity_id;
  elsif p_entity_type = 'reimbursement_claim' then
    select e.company_id, c.employee_id into v_company_id, v_employee_id
    from reimbursement_claims c join employees e on e.id = c.employee_id where c.id = p_entity_id;
  elsif p_entity_type = 'timesheet' then
    select e.company_id, t.employee_id into v_company_id, v_employee_id
    from timesheets t join employees e on e.id = t.employee_id where t.id = p_entity_id;
  elsif p_entity_type = 'generated_letter' then
    select e.company_id, l.employee_id into v_company_id, v_employee_id
    from generated_letters l join employees e on e.id = l.employee_id where l.id = p_entity_id;
  elsif p_entity_type = 'payroll_export_run' then
    select company_id into v_company_id from payroll_export_runs where id = p_entity_id;
  else
    raise exception 'Unsupported entity type: %', p_entity_type;
  end if;

  select id into v_workflow_id from approval_workflows
  where company_id = v_company_id and entity_type = p_entity_type and is_active = true
  order by created_at asc
  limit 1;
  if v_workflow_id is null then
    raise exception 'No approval workflow is configured for your company. Contact HR Admin.';
  end if;

  select approver_type into v_approver_type
  from approval_workflow_steps where workflow_id = v_workflow_id and step_order = 1;
  if v_approver_type is null then
    raise exception 'This workflow has no first step configured. Contact HR Admin.';
  end if;

  if p_entity_type = 'payroll_export_run' then
    v_approver_id := resolve_approver_for_company(v_approver_type, v_company_id);
  else
    v_approver_id := resolve_approver(v_approver_type, v_employee_id);
  end if;
  if v_approver_id is null then
    raise exception 'No approver could be resolved (e.g. no manager assigned, or no one holds the required role). Contact HR Admin.';
  end if;

  if v_approver_id = auth.uid() then
    raise exception 'The resolved approver for this workflow''s first step (%) is you — you can''t approve your own request. Contact HR Admin to assign a different approver.', v_approver_type;
  end if;

  insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision)
  values (p_entity_type, p_entity_id, v_workflow_id, 1, v_approver_id, 'pending')
  returning id into v_approval_id;

  return v_approval_id;
end;
$$;

drop policy if exists approvals_insert_initial on approvals;

create or replace function guard_policy_version_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not has_role('hr_admin', null, old.country_code) then
    if new.policy_type is distinct from old.policy_type
      or new.version_no is distinct from old.version_no
      or new.effective_from is distinct from old.effective_from
      or new.effective_to is distinct from old.effective_to
      or new.payload is distinct from old.payload
      or new.country_code is distinct from old.country_code
      or new.created_by is distinct from old.created_by
    then
      raise exception 'CEO may only activate a drafted policy, not edit its content — ask HR Admin to change it.';
    end if;
  end if;

  if new.status = 'active' and old.status is distinct from 'active' then
    if auth.uid() = old.created_by then
      raise exception 'A policy version must be activated by someone other than who drafted it.';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;

  return new;
end;
$$;

create or replace function guard_payroll_workflow_immutable()
returns trigger
language plpgsql
as $$
declare
  v_old_entity_type approvable_entity;
  v_new_entity_type approvable_entity;
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  if tg_op <> 'INSERT' then
    select entity_type into v_old_entity_type from approval_workflows where id = old.workflow_id;
  end if;
  if tg_op <> 'DELETE' then
    select entity_type into v_new_entity_type from approval_workflows where id = new.workflow_id;
  end if;

  if v_old_entity_type = 'payroll_export_run' or v_new_entity_type = 'payroll_export_run' then
    raise exception 'The payroll export approval workflow (Finance then CEO, every time) cannot be modified';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function guard_appraisal_acknowledge()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if auth.uid() = (select user_id from employees where id = old.employee_id) then
    if new.overall_rating is distinct from old.overall_rating
      or new.strengths is distinct from old.strengths
      or new.areas_for_improvement is distinct from old.areas_for_improvement
      or new.cycle_id is distinct from old.cycle_id
      or new.appraiser_id is distinct from old.appraiser_id
      or new.submitted_at is distinct from old.submitted_at
    then
      raise exception 'An employee may only acknowledge their appraisal, not edit its content';
    end if;
  end if;

  if auth.uid() = old.appraiser_id and new.employee_id is distinct from old.employee_id then
    raise exception 'An appraisal cannot be reassigned to a different employee';
  end if;

  return new;
end;
$$;

create or replace function guard_goal_employee_immutable()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.employee_id is distinct from old.employee_id then
    raise exception 'A goal cannot be reassigned to a different employee';
  end if;
  return new;
end;
$$;

drop trigger if exists goals_guard_employee_immutable on goals;
create trigger goals_guard_employee_immutable
  before update on goals
  for each row execute function guard_goal_employee_immutable();

create or replace function resolve_approver(p_approver_type text, p_employee_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_manager_id uuid;
  v_result uuid;
begin
  select company_id, manager_id into v_company_id, v_manager_id from employees where id = p_employee_id;

  if p_approver_type = 'direct_manager' then
    select user_id into v_result from employees
    where id = v_manager_id and employment_status <> 'terminated' and deleted_at is null;
  elsif p_approver_type = 'manager_of_manager' then
    select user_id into v_result from employees
    where id = (select manager_id from employees where id = v_manager_id)
      and employment_status <> 'terminated' and deleted_at is null;
  elsif p_approver_type like 'role:%' then
    select ur.user_id into v_result
    from user_roles ur
    where ur.role = replace(p_approver_type, 'role:', '')::app_role
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = v_company_id)
      and not exists (
        select 1 from employees e2
        where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
      )
    order by ur.granted_at asc
    limit 1;
  end if;

  return v_result;
end;
$$;

create or replace function resolve_approver_for_company(p_approver_type text, p_company_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result uuid;
begin
  if p_approver_type like 'role:%' then
    select ur.user_id into v_result
    from user_roles ur
    where ur.role = replace(p_approver_type, 'role:', '')::app_role
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = p_company_id)
      and not exists (
        select 1 from employees e2
        where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
      )
    order by ur.granted_at asc
    limit 1;
  end if;
  return v_result;
end;
$$;
