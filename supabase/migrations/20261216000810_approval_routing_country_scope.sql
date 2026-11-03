-- Approval routing honours the COUNTRY limit on a role grant. ADDITIVE: replaces two functions in place (create or replace); no table, column, policy, privilege or data change.
--
-- WHY (reproduced locally before the fix: packages/rls-tests/test/approval_routing_scope.rls.test.ts). resolve_approver() and resolve_approver_for_company() honoured the company
-- limit on a role grant but ignored its country limit, so a CEO (or any role holder) limited to ONE country was resolved as approver for every company that has no company-limited
-- holder, in every country.
--
-- THE RULE (existing, not new): user_roles are "optionally scoped to a company/country, e.g. HR Admin for Poland only" (docs/02-database-schema.md) and has_role() applies a grant
-- when its company is null or the company asked about AND its country is null or the country asked about. A grant with no country limit is unaffected.
--   * resolve_approver(type, employee): a grant limited to a country applies when it is the EMPLOYEE's country (employees.country_code). This covers 'role:*' and the managerless
--     CEO / CTO fallback of direct_manager / manager_of_manager.
--   * resolve_approver_for_company(type, company): a grant limited to a country applies when it is the COMPANY's country (companies.country_code).
--
-- WHAT DOES NOT CHANGE: grants with no country limit (company-only and global) resolve exactly as before; inactive, terminated and revoked holders are still skipped; the
-- 'role:ceo' = CEO or CTO rule, the ordering (oldest grant first) and the self-approval refusals; APPROVALS ALREADY PENDING keep their approver (nothing re-routes them: only
-- new requests use the corrected lookup); the shared-queue checks (has_role on the caller), resolve_role_holders (notification recipients) and every other function.
-- Rollback: supabase/manual-sql/apprscope_90_rollback.sql restores the previous bodies.

create or replace function resolve_approver(p_approver_type text, p_employee_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_country text;
  v_manager_id uuid;
  v_requester_user_id uuid;
  v_grandmanager_id uuid;
  v_result uuid;
begin
  select company_id, country_code, manager_id, user_id into v_company_id, v_country, v_manager_id, v_requester_user_id
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
        and (ur.country_code is null or ur.country_code = v_country)
        and ur.user_id <> v_requester_user_id
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
        and user_is_active(ur.user_id)
      order by ur.granted_at asc
      limit 1;
    else
      select user_id into v_result from employees
      where id = v_manager_id and employment_status <> 'terminated' and deleted_at is null and user_is_active(user_id);
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
        and (ur.country_code is null or ur.country_code = v_country)
        and ur.user_id <> v_requester_user_id
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
        and user_is_active(ur.user_id)
      order by ur.granted_at asc
      limit 1;
    else
      select user_id into v_result from employees
      where id = v_grandmanager_id and employment_status <> 'terminated' and deleted_at is null and user_is_active(user_id);
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
        and (ur.country_code is null or ur.country_code = v_country)
      and not exists (
        select 1 from employees e2
        where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
      )
      and user_is_active(ur.user_id)
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
  v_country text;
begin
  if p_approver_type like 'role:%' then
    select country_code into v_country from companies where id = p_company_id;
    select ur.user_id into v_result
    from user_roles ur
    where (
        case when p_approver_type = 'role:ceo' then ur.role in ('ceo', 'cto')
        else ur.role = replace(p_approver_type, 'role:', '')::app_role end
      )
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = p_company_id)
      and (ur.country_code is null or ur.country_code = v_country)
      and not exists (
        select 1 from employees e2
        where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
      )
      and user_is_active(ur.user_id)
    order by ur.granted_at asc
    limit 1;
  end if;
  return v_result;
end;
$$;

