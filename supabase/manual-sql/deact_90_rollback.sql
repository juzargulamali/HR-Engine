-- WRITES (function definitions only; no row is touched). OWNER-RUN ROLLBACK of 20261216000300_account_deactivation_inactive_people.sql.
--
-- WHEN TO USE IT: only if the change causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back means a deactivated person is again treated as active for routing, picker and access checks that read profiles.is_active only through the application's
-- own deactivation (set_account_status no longer sets it), and the protections against deactivating the last System Administrator / the only CEO or CTO approver
-- return to the earlier single rule (last System Administrator). Accounts deactivated WHILE the change was live keep is_active = false: that is not undone here
-- (they stay blocked from the modules, which is what deactivation means). Approvals are never touched either way.
--
-- It is safe to run twice. Afterwards the matching *_20_verify_readonly.sql reports the new rules as missing (that is how it tells you the old state is back), or run the
-- *_05_preservation_check_readonly.sql against your BEFORE snapshot (the changed items then say UNCHANGED / MISSING).
-- Execute privileges are kept by create or replace; the three added functions are dropped LAST, after nothing depends on them any more.

begin;

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

create or replace function resolve_role_holders(p_role app_role, p_company_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id
  from user_roles
  where role = p_role
    and revoked_at is null
    and (company_id is null or company_id = p_company_id)
  order by granted_at asc;
$$;

create or replace function recovery_eligible_approver_exists(p_company_id uuid, p_roles app_role[], p_exclude_user uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from user_roles ur
    where ur.role = any (p_roles)
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = p_company_id)
      and ur.country_code is null
      and ur.user_id is distinct from p_exclude_user
      and not exists (
        select 1 from employees e2
        where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
      )
  );
$$;

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
  v_self_check_user_id uuid;
  v_applicant_route text;
  v_project_lead_employee_id uuid;
begin
  -- Every recovery_credit row is now created under a real logged-in user
  -- session — the employee's own session for a self-clock candidate (see
  -- attendance_segments' doc comment), or the acting HR Admin/manager's
  -- session for the legacy manual/overnight paths — so is_entity_owner()'s
  -- created_by = auth.uid() check applies uniformly, with no service-role,
  -- no-session exception needed. (is_entity_owner()'s own recovery_credit
  -- branch ALSO accepts any HR Admin of the request's company — needed for
  -- resolve_recovery_credit_project_lead() below, which routes a self-clock
  -- request an EMPLOYEE created after HR supplies its missing lead.)
  if not is_entity_owner(p_entity_type, p_entity_id) then
    raise exception 'You do not own this % (or it does not exist)', p_entity_type;
  end if;

  -- Idempotent under concurrent double-submission — moved up front so it
  -- covers the new self-clock route-driven branch below the same way as
  -- the legacy workflow-driven path further down (see that path's own doc
  -- comment on reimbursement claims/timesheets/payroll runs).
  select id into v_approval_id from approvals
  where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
  if v_approval_id is not null then
    return v_approval_id;
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
  elsif p_entity_type = 'recovery_credit' then
    select e.company_id, r.employee_id, r.applicant_route, r.project_lead_employee_id
    into v_company_id, v_employee_id, v_applicant_route, v_project_lead_employee_id
    from recovery_credit_requests r join employees e on e.id = r.employee_id where r.id = p_entity_id;
  else
    raise exception 'Unsupported entity type: %', p_entity_type;
  end if;

  -- NEW self-clock 4-tier routing (recovery_credit_requests.applicant_route
  -- is set — see that column's own doc comment) — bypasses
  -- approval_workflows/approval_workflow_steps entirely: the four routes
  -- have different total step counts and different step_order meanings,
  -- which doesn't fit the single company-wide workflow the generic engine
  -- below otherwise assumes. The LEGACY attendance_record_id-anchored
  -- recovery_credit family (applicant_route null) falls through to that
  -- same generic engine completely unchanged.
  if p_entity_type = 'recovery_credit' and v_applicant_route is not null then
    select user_id into v_self_check_user_id from employees where id = v_employee_id;

    if v_applicant_route = 'employee_lead_then_hr' then
      select user_id into v_approver_id from employees where id = v_project_lead_employee_id;
      if v_approver_id is null then
        raise exception 'The named project lead has no HR Engine account to approve with. Contact HR Admin.';
      end if;
      -- Defense in depth — resolve_recovery_credit_route() only ever
      -- returns this route when the lead is NOT the applicant themselves,
      -- so this should be unreachable in practice.
      if v_approver_id = v_self_check_user_id then
        raise exception 'The resolved project lead is you — this should have routed to self_led_hr_direct instead. Contact HR Admin.';
      end if;
      begin
        insert into approvals (entity_type, entity_id, step_order, approver_id, decision)
        values (p_entity_type, p_entity_id, 1, v_approver_id, 'pending')
        returning id into v_approval_id;
      exception when unique_violation then
        select id into v_approval_id from approvals where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
      end;
    else
      -- Single-step queue routes: manager_hr_direct/self_led_hr_direct go
      -- to any current hr_admin; hr_admin_ceo_cto_queue goes to either a
      -- ceo or a cto (approvals.queue_roles' own doc comment — the
      -- existing row-lock-plus-pending-check every decision already takes
      -- is what makes "whoever decides first wins" hold here too).
      begin
        insert into approvals (entity_type, entity_id, step_order, queue_roles, decision)
        values (
          p_entity_type, p_entity_id, 1,
          case v_applicant_route when 'hr_admin_ceo_cto_queue' then array['ceo', 'cto']::app_role[] else array['hr_admin']::app_role[] end,
          'pending'
        )
        returning id into v_approval_id;
      exception when unique_violation then
        select id into v_approval_id from approvals where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
      end;
    end if;

    return v_approval_id;
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

  -- CEO/CTO applicant (docs/08-decisions-log.md): there is nobody above them,
  -- so their LEAVE needs no approver and is approved on the spot (through the
  -- same decide_leave_approval() finalisation every approval uses, so the
  -- balance/ledger work is identical), and their REIMBURSEMENT CLAIMS go
  -- straight to Finance instead of to a manager. Everything else (timesheets,
  -- letters, payroll runs, every other applicant) is unchanged. Leave and
  -- claims are always submitted by the requester's own session, which is what
  -- lets decide_leave_approval() accept the system's decision below.
  if p_entity_type in ('leave_request', 'reimbursement_claim') and v_employee_id is not null then
    select user_id into v_self_check_user_id from employees where id = v_employee_id;
    if is_c_level(v_self_check_user_id, v_company_id) then
      if p_entity_type = 'leave_request' then
        begin
          insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision)
          values (p_entity_type, p_entity_id, v_workflow_id, 1, v_self_check_user_id, 'pending')
          returning id into v_approval_id;
        exception when unique_violation then
          select id into v_approval_id from approvals
          where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
          return v_approval_id;
        end;
        perform decide_leave_approval(
          v_approval_id, 'approved',
          'Approved automatically: a CEO or CTO''s leave needs no approver.'
        );
        return v_approval_id;
      else
        v_approver_type := 'role:finance';
      end if;
    end if;
  end if;

  if v_approver_type like 'role_queue:%' then
    -- Company-scoped role queue (currently only recovery_credit's single
    -- HR step) — no single resolved approver_id; ANY current holder of
    -- this role in the company may later decide it (see
    -- decide_leave_approval()'s own null-approver_id authorization branch).
    -- Still hard-stops here if literally no one currently holds the role,
    -- for the same "never create an unroutable approval" reason every
    -- other branch below does.
    if not exists (
      select 1 from user_roles ur
      where ur.role = replace(v_approver_type, 'role_queue:', '')::app_role
        and ur.revoked_at is null
        and (ur.company_id is null or ur.company_id = v_company_id)
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
    ) then
      raise exception 'No approver could be resolved (no one currently holds the "%" role in your company). Contact Sys Admin.', replace(v_approver_type, 'role_queue:', '');
    end if;
    v_approver_id := null;
  else
    if p_entity_type = 'payroll_export_run' then
      v_approver_id := resolve_approver_for_company(v_approver_type, v_company_id);
    else
      v_approver_id := resolve_approver(v_approver_type, v_employee_id);
    end if;
    if v_approver_id is null then
      raise exception 'No approver could be resolved (e.g. no manager assigned, or no one holds the required role). Contact HR Admin.';
    end if;

    -- Self-approval prevention for step 1 — decide_leave_approval() already
    -- refuses to route any LATER step back to the requester; this is the
    -- same check for the first step, which that function never sees.
    -- Compares against the ENTITY's own beneficiary, not always the
    -- caller: every other entity type is self-submitted (the caller IS the
    -- requester, so auth.uid() is correct), but recovery_credit is
    -- manager/HR-initiated ON BEHALF OF the employee — the direct manager
    -- routinely is both the one recording eligibility AND the resolved
    -- step-1 approver for their own report, which is never "self-approval"
    -- (they aren't approving their OWN leave). Only block if the resolved
    -- approver equals the beneficiary. A role_queue step has no single
    -- resolved approver to compare here at all — its own self-decision
    -- block instead happens at decision time, in decide_leave_approval().
    if p_entity_type = 'recovery_credit' then
      select user_id into v_self_check_user_id from employees where id = v_employee_id;
    else
      v_self_check_user_id := auth.uid();
    end if;
    if v_approver_id = v_self_check_user_id then
      raise exception 'The resolved approver for this workflow''s first step (%) is you — you can''t approve your own request. Contact HR Admin to assign a different approver.', v_approver_type;
    end if;
  end if;

  -- Idempotent under concurrent double-submission: reimbursement claims,
  -- timesheets, and payroll runs submit against an EXISTING row (an
  -- UPDATE then this call), so two racing calls can both pass every check
  -- above before either has inserted. Returning the existing step-1
  -- approval instead of raising or duplicating means the "loser" of the
  -- race gets back the same approval the "winner" created, rather than
  -- its caller (e.g. submitPayrollRun()) treating this as a routing
  -- failure and reverting the entity's status out from under a real,
  -- already-pending approval. The unique index above is the backstop for
  -- the rare case where both SELECTs below race past each other too.
  select id into v_approval_id from approvals
  where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
  if v_approval_id is not null then
    return v_approval_id;
  end if;

  begin
    insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision)
    values (p_entity_type, p_entity_id, v_workflow_id, 1, v_approver_id, 'pending')
    returning id into v_approval_id;
  exception when unique_violation then
    select id into v_approval_id from approvals
    where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
  end;

  return v_approval_id;
end;
$$;

create or replace function recovery_route_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r recovery_credit_requests%rowtype;
  v_company uuid;
  v_user uuid;
  v_lead_user uuid;
  v_roles app_role[];
  v_approval_id uuid;
begin
  select * into r from recovery_credit_requests where id = p_request_id for update;
  if not found then raise exception 'Recovery credit request not found.'; end if;
  select e.company_id, e.user_id into v_company, v_user from employees e where e.id = r.employee_id;

  select id into v_approval_id from approvals where entity_type = 'recovery_credit' and entity_id = p_request_id and step_order = 1;
  if v_approval_id is not null then return v_approval_id; end if;
  -- A CEO/CTO's credit needs no approver. When nothing blocks it (the window is
  -- closed and verified, the amount is current) it is approved right here, by the
  -- system, through the same decide_leave_approval() finalisation as any approval.
  -- It only runs for the background processor (no signed-in user) or the CEO/CTO's
  -- own session, so a correction an HR Admin makes after approval creates a
  -- request that goes to the HR queue for a human to approve, never auto-approved.
  -- Anything recovery_request_blocker() reports (HR verification pending, a
  -- reduction that needs acknowledging, a stale amount) also falls through to the
  -- normal single-step HR queue below.
  if is_c_level(v_user, v_company)
     and (auth.uid() is null or auth.uid() = v_user)
     and recovery_request_blocker(p_request_id) is null then
    begin
      insert into approvals (entity_type, entity_id, step_order, approver_id, decision)
      values ('recovery_credit', p_request_id, 1, v_user, 'pending')
      returning id into v_approval_id;
    exception when unique_violation then
      select id into v_approval_id from approvals
      where entity_type = 'recovery_credit' and entity_id = p_request_id and step_order = 1;
      return v_approval_id;
    end;
    perform decide_leave_approval(
      v_approval_id, 'approved',
      'Approved automatically: a CEO or CTO''s Recovery Leave needs no approver.'
    );
    update recovery_credit_requests set routing_issue = null where id = p_request_id and routing_issue is not null;
    return v_approval_id;
  end if;

  if r.applicant_route is null then return null; end if;

  if r.applicant_route = 'employee_lead_then_hr' then
    select e.user_id into v_lead_user from employees e
    where e.id = r.project_lead_employee_id and e.employment_status <> 'terminated' and e.deleted_at is null;
    if v_lead_user is null then
      update recovery_credit_requests set routing_issue = 'The named project lead has no active HR Engine account to approve with. HR must assign another lead.' where id = p_request_id;
      return null;
    end if;
    if v_lead_user = v_user then
      update recovery_credit_requests set routing_issue = 'The resolved project lead is the applicant. HR must review this request.' where id = p_request_id;
      return null;
    end if;
    if not recovery_eligible_approver_exists(v_company, array['hr_admin']::app_role[], v_user) then
      update recovery_credit_requests set routing_issue = 'No HR Admin is currently available to take the second approval step.' where id = p_request_id;
      return null;
    end if;
    insert into approvals (entity_type, entity_id, step_order, approver_id, decision)
    values ('recovery_credit', p_request_id, 1, v_lead_user, 'pending')
    on conflict (entity_type, entity_id, step_order) do nothing
    returning id into v_approval_id;
  else
    v_roles := case r.applicant_route when 'hr_admin_ceo_cto_queue' then array['ceo', 'cto']::app_role[] else array['hr_admin']::app_role[] end;
    if not recovery_eligible_approver_exists(v_company, v_roles, v_user) then
      update recovery_credit_requests
      set routing_issue = 'No eligible approver currently holds the ' || array_to_string(v_roles, ' or ') || ' role for this company.'
      where id = p_request_id;
      return null;
    end if;
    insert into approvals (entity_type, entity_id, step_order, queue_roles, decision)
    values ('recovery_credit', p_request_id, 1, v_roles, 'pending')
    on conflict (entity_type, entity_id, step_order) do nothing
    returning id into v_approval_id;
  end if;

  update recovery_credit_requests set routing_issue = null where id = p_request_id and routing_issue is not null;
  if v_approval_id is null then
    select id into v_approval_id from approvals where entity_type = 'recovery_credit' and entity_id = p_request_id and step_order = 1;
  end if;
  return v_approval_id;
end;
$$;

create or replace function set_account_status(p_user_id uuid, p_new_status account_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status account_status;
  v_other_active_sysadmins bigint;
begin
  if auth.uid() is null or not has_role('sys_admin') then
    raise exception 'Only a System Administrator may change an account''s status';
  end if;

  if p_new_status not in ('active', 'deactivated') then
    raise exception 'Status must be set to active or deactivated through this operation';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  -- Matches the app-layer max (setAccountStatusSchema in
  -- lib/actions/account-status.ts) — defense-in-depth against a caller
  -- bypassing that layer, not a UX limit (the form/prompt already stops
  -- someone well before this).
  if length(p_reason) > 500 then
    raise exception 'Reason is too long (500 characters max)';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own account status — ask another System Administrator to do it';
  end if;

  perform pg_advisory_xact_lock(hashtext('profiles:set_account_status'));

  select account_status into v_current_status from profiles where id = p_user_id;
  if v_current_status is null then
    raise exception 'This account no longer exists';
  end if;

  -- Only ever reachable when the target isn't the caller (guarded above),
  -- so this is necessarily a case of one admin locking out another —
  -- checked the same way revoke_role_grant() checks the last sys_admin
  -- role grant, just re-expressed against active accounts instead of
  -- unrevoked grants.
  if p_new_status = 'deactivated' then
    select count(*) into v_other_active_sysadmins
    from user_roles ur
    join profiles p on p.id = ur.user_id
    where ur.role = 'sys_admin'
      and ur.revoked_at is null
      and p.account_status = 'active'
      and ur.user_id <> p_user_id;
    if v_other_active_sysadmins = 0
       and exists (select 1 from user_roles where user_id = p_user_id and role = 'sys_admin' and revoked_at is null) then
      raise exception 'Can''t deactivate the last active System Administrator — the system would have nobody left to manage users or roles';
    end if;
  end if;

  update profiles
  set account_status = p_new_status,
      status_reason = p_reason,
      status_changed_by = auth.uid(),
      status_changed_at = now()
  where id = p_user_id;
end;
$$;

create or replace function guard_profiles_self_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or has_role('sys_admin') then
    return new;
  end if;

  if new.account_status is distinct from old.account_status
     and not (old.account_status = 'invited' and new.account_status = 'active') then
    raise exception 'account_status can only be changed by a System Administrator';
  end if;

  if new.email is distinct from old.email
    or new.status_reason is distinct from old.status_reason
    or new.status_changed_by is distinct from old.status_changed_by
    or new.status_changed_at is distinct from old.status_changed_at
  then
    raise exception 'Only full_name and locale can be self-updated — ask a System Administrator to change anything else.';
  end if;

  return new;
end;
$$;

drop function if exists account_holdings(uuid);
drop function if exists account_deactivation_blockers(uuid);
drop function if exists user_is_active(uuid);

commit;
