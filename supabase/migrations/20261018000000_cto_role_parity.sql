-- Grants CTO full parity with CEO: every read/approval access CEO has,
-- CTO gets identically, and neither is ever blocked from submitting their
-- own leave/reimbursement/etc. for lack of an assigned manager (they're
-- top of the org chart). Must run after 20261017000000_add_cto_role.sql,
-- which adds the 'cto' enum value in its own transaction.

-- resolve_approver(): direct_manager/manager_of_manager now fall back to
-- any OTHER active ceo/cto holder in the same company when the employee
-- has no manager (or no manager-of-manager) to resolve to -- exactly the
-- CEO/CTO's own situation. The role:% branch treats 'role:ceo' as "any
-- C-level exec" (ceo or cto), leaving every other role:% value's exact
-- single-role match unchanged.
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
  v_requester_user_id uuid;
  v_grandmanager_id uuid;
  v_result uuid;
begin
  select company_id, manager_id, user_id into v_company_id, v_manager_id, v_requester_user_id
  from employees where id = p_employee_id;

  -- employment_status <> 'terminated' (not e.g. 'active' only) — a
  -- terminated employee should never remain resolvable as an approver of
  -- record indefinitely (nothing else in the schema cascades a
  -- termination into reassigning their reports or revoking their roles),
  -- but someone merely on_leave/suspended is still a legitimate approver.
  if p_approver_type = 'direct_manager' then
    if v_manager_id is null then
      -- Top of the org chart — exactly the CEO/CTO's own situation, since
      -- nothing ever assigns them a manager_id. Returning null here used to
      -- mean create_initial_approval()/decide_leave_approval() both treat
      -- this as "no approver could be resolved" and hard-block the
      -- submission outright. There is no manager requirement for a
      -- C-level exec ("there is no need of manager for them, approval
      -- wise, anyone can approve as C-Level executives"), so fall back to
      -- any OTHER active ceo/cto holder in the same company instead of
      -- leaving them permanently unable to submit their own leave/
      -- reimbursement/etc. The self-approval check in
      -- create_initial_approval()/decide_leave_approval() still applies
      -- normally if this ever resolved back to the requester themselves.
      select ur.user_id into v_result
      from user_roles ur
      where ur.role in ('ceo', 'cto')
        and ur.revoked_at is null
        and (ur.company_id is null or ur.company_id = v_company_id)
        and ur.user_id <> v_requester_user_id
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
      order by ur.granted_at asc
      limit 1;
    else
      select user_id into v_result from employees
      where id = v_manager_id and employment_status <> 'terminated' and deleted_at is null;
    end if;
  elsif p_approver_type = 'manager_of_manager' then
    select manager_id into v_grandmanager_id from employees where id = v_manager_id;
    if v_manager_id is null or v_grandmanager_id is null then
      -- Same top-of-org-chart dead end as direct_manager above: either this
      -- employee has no manager at all, or their manager has no manager of
      -- their own (e.g. reports straight to the CEO/CTO) — either way
      -- there's no "manager of manager" to resolve, so fall back to any
      -- other active ceo/cto holder for the same reason given above.
      select ur.user_id into v_result
      from user_roles ur
      where ur.role in ('ceo', 'cto')
        and ur.revoked_at is null
        and (ur.company_id is null or ur.company_id = v_company_id)
        and ur.user_id <> v_requester_user_id
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
      order by ur.granted_at asc
      limit 1;
    else
      select user_id into v_result from employees
      where id = v_grandmanager_id and employment_status <> 'terminated' and deleted_at is null;
    end if;
  elsif p_approver_type like 'role:%' then
    -- 'role:ceo' is treated as "any C-level exec" — ceo and cto are equal
    -- peers for approval-routing purposes (per the CTO rollout: "anyone
    -- can approve as C-Level executives"), so a workflow step configured
    -- as role:ceo is satisfied by whichever of them is available. Every
    -- other role:% value (role:hr_admin, role:finance, ...) keeps its
    -- exact single-role match, unchanged.
    select ur.user_id into v_result
    from user_roles ur
    where (
        case when p_approver_type = 'role:ceo' then ur.role in ('ceo', 'cto')
        else ur.role = replace(p_approver_type, 'role:', '')::app_role end
      )
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

-- Same role:ceo -> "any C-level exec" broadening for the company-wide
-- resolver (payroll_export_run's mandatory Finance-then-CEO sign-off).
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
    where (
        case when p_approver_type = 'role:ceo' then ur.role in ('ceo', 'cto')
        else ur.role = replace(p_approver_type, 'role:', '')::app_role end
      )
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

-- Read-access parity: every policy that granted CEO read access grants CTO
-- the exact same access. Purely additive (has_role('ceo', ...) or
-- has_role('cto', ...)) — 'ceo' semantics are unchanged, 'cto' is an equal
-- parallel check.
drop policy employees_select on employees;
create policy employees_select on employees for select
  using (
    has_role('hr_admin', company_id)
    or has_role('sys_admin')
    or (
      deleted_at is null and (
        id = current_employee_id()
        or is_manager_of(id)
        or has_role('finance', company_id)
        or (has_role('ceo', company_id) or has_role('cto', company_id))
      )
    )
  );

drop policy employment_contracts_select on employment_contracts;
create policy employment_contracts_select on employment_contracts for select
  using (
    employee_id = current_employee_id()
    or (is_manager_of(employee_id) and is_current)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
  );

drop policy policy_versions_select on policy_versions;
create policy policy_versions_select on policy_versions for select
  using (
    status = 'active'
    or has_role('hr_admin', null, country_code)
    or (has_role('ceo', null, country_code) or has_role('cto', null, country_code))
  );

drop policy policy_versions_update on policy_versions;
create policy policy_versions_update on policy_versions for update
  using (
    status = 'draft'
    and (has_role('hr_admin', null, country_code) or (has_role('ceo', null, country_code) or has_role('cto', null, country_code)))
  )
  with check (has_role('hr_admin', null, country_code) or (has_role('ceo', null, country_code) or has_role('cto', null, country_code)));

drop policy policy_versions_delete on policy_versions;
create policy policy_versions_delete on policy_versions for delete
  using (
    status = 'draft'
    and (has_role('hr_admin', null, country_code) or (has_role('ceo', null, country_code) or has_role('cto', null, country_code)))
  );

drop policy policy_leave_types_select on policy_leave_types;
create policy policy_leave_types_select on policy_leave_types for select
  using (
    exists (
      select 1 from policy_versions pv
      where pv.id = policy_version_id
        and (
          pv.status = 'active'
          or has_role('hr_admin', null, pv.country_code)
          or (has_role('ceo', null, pv.country_code) or has_role('cto', null, pv.country_code))
        )
    )
  );

drop policy employee_checklist_items_select on employee_checklist_items;
create policy employee_checklist_items_select on employee_checklist_items for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'line_manager')
      and is_manager_of(employee_id)
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'finance')
      and has_role('finance', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'ceo')
      and (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'sys_admin')
      and has_role('sys_admin')
    )
  );

drop policy employee_checklist_items_complete on employee_checklist_items;
create policy employee_checklist_items_complete on employee_checklist_items for update
  using (
    employee_id = current_employee_id()
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'line_manager')
      and is_manager_of(employee_id)
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'finance')
      and has_role('finance', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'ceo')
      and (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'sys_admin')
      and has_role('sys_admin')
    )
  );

drop policy leave_requests_select on leave_requests;
create policy leave_requests_select on leave_requests for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
  );

drop policy project_allocations_select on project_allocations;
create policy project_allocations_select on project_allocations for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
  );

drop policy reimbursement_select on reimbursement_claims;
create policy reimbursement_select on reimbursement_claims for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
  );

drop policy reimbursement_lines_select on reimbursement_claim_lines;
create policy reimbursement_lines_select on reimbursement_claim_lines for select
  using (exists (
    select 1 from reimbursement_claims c
    where c.id = claim_id and (
      c.employee_id = current_employee_id()
      or is_manager_of(c.employee_id)
      or has_role('hr_admin', (select company_id from employees where id = c.employee_id))
      or has_role('finance', (select company_id from employees where id = c.employee_id))
      or (has_role('ceo', (select company_id from employees where id = c.employee_id)) or has_role('cto', (select company_id from employees where id = c.employee_id)))
    )
  ));

drop policy generated_letters_select on generated_letters;
create policy generated_letters_select on generated_letters for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
  );

drop policy payroll_runs_select on payroll_export_runs;
create policy payroll_runs_select on payroll_export_runs for select
  using (
    has_role('hr_admin', company_id)
    or has_role('finance', company_id)
    or (has_role('ceo', company_id) or has_role('cto', company_id))
  );

drop policy payroll_lines_select on payroll_export_lines;
create policy payroll_lines_select on payroll_export_lines for select
  using (exists (
    select 1 from payroll_export_runs r
    where r.id = run_id and (has_role('hr_admin', r.company_id) or has_role('finance', r.company_id) or (has_role('ceo', r.company_id) or has_role('cto', r.company_id)))
  ));

-- CEO/CTO get their own storage policy (mirroring generated_letters_select's
-- read access) rather than folding into letters_select, since a C-level
-- exec deciding a letter's approval needs to read the file itself, not
-- just its row. Policy name kept as letters_select_ceo (an internal
-- identifier, not user-facing) for continuity with the migration that
-- created it.
drop policy letters_select_ceo on storage.objects;
create policy letters_select_ceo on storage.objects for select
  using (bucket_id = 'letters' and (has_role('ceo', (storage.foldername(name))[1]::uuid) or has_role('cto', (storage.foldername(name))[1]::uuid)));
