-- CEO/CTO requests need no approver (docs/08-decisions-log.md, decision 19).
--
--   * Leave submitted by a CEO or CTO is approved immediately (through the normal
--     decide_leave_approval() finalisation, so balances/ledgers behave exactly as
--     for any approved leave).
--   * Reimbursement claims submitted by a CEO or CTO go straight to Finance.
--   * A CEO/CTO's Recovery Leave credit is approved automatically when nothing
--     blocks it; anything needing a human (HR verification, a post-approval
--     correction) goes to the HR queue.
--
-- Additive: one new helper, one app-facing helper, and `create or replace` of the
-- three functions below. No table, column or data changes; nothing existing is
-- rewritten or recalculated. To undo, re-apply the previous definitions of
-- create_initial_approval(), recovery_route_for_employee() and
-- recovery_route_request() (from migration 20261106 / 20261108).

create or replace function is_c_level(p_user_id uuid, p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select user_has_role(p_user_id, 'ceo', p_company_id) or user_has_role(p_user_id, 'cto', p_company_id);
$$;

revoke all on function is_c_level(uuid, uuid) from public, anon, authenticated;

-- App-facing: "am I a CEO/CTO of this company?" — about the CALLER only, so it
-- discloses nothing about anyone else.
create or replace function i_am_c_level(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select is_c_level(auth.uid(), p_company_id);
$$;

revoke all on function i_am_c_level(uuid) from public, anon;
grant execute on function i_am_c_level(uuid) to authenticated;

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

create or replace function recovery_route_for_employee(p_employee_id uuid, p_project_lead_employee_id uuid)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_company uuid;
begin
  select user_id, company_id into v_user, v_company from employees where id = p_employee_id;
  -- A CEO/CTO has nobody above them (even when they also hold hr_admin): a
  -- credit nothing blocks is approved automatically by recovery_route_request();
  -- anything that does need a human (HR verification, a correction after use)
  -- goes to the HR queue, never to a project lead.
  if is_c_level(v_user, v_company) then
    return 'self_led_hr_direct';
  end if;
  if user_has_role(v_user, 'hr_admin', v_company) then
    return 'hr_admin_ceo_cto_queue';
  elsif user_has_role(v_user, 'line_manager', v_company) then
    return 'manager_hr_direct';
  elsif p_project_lead_employee_id is null then
    return null;
  elsif p_project_lead_employee_id = p_employee_id then
    return 'self_led_hr_direct';
  end if;
  return 'employee_lead_then_hr';
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
