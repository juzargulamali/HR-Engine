-- A CEO/CTO's reimbursement claim goes to a Finance holder other than themselves.
--
-- Follow-up to 20261109000000_executive_requests_no_approver.sql: that routed a
-- CEO/CTO's claim to 'role:finance', which resolves to the EARLIEST Finance grant.
-- When the executive is themselves a Finance holder (or the earliest one), the claim
-- resolved back to the requester and was refused as self-approval. Now the earliest
-- OTHER active Finance holder is chosen; if there is none, the existing
-- "No approver could be resolved" error still stops it.
--
-- Additive: `create or replace` of create_initial_approval() only. No table or data
-- change. To undo, re-apply the 20261109 definition.

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
  v_exec_claim boolean := false;
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
        v_exec_claim := true;
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
    -- A CEO/CTO's claim goes to a Finance holder OTHER than themselves: when the
    -- executive also holds the Finance role (or is the earliest Finance grant),
    -- the generic resolver would hand the claim back to them and refuse it as
    -- self-approval. Pick the earliest other active Finance holder instead.
    if v_exec_claim then
      select ur.user_id into v_approver_id
      from user_roles ur
      where ur.role = 'finance'
        and ur.revoked_at is null
        and (ur.company_id is null or ur.company_id = v_company_id)
        and ur.user_id <> v_self_check_user_id
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
      order by ur.granted_at asc
      limit 1;
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
