-- A12 / D-10. Deactivating an account makes the person INACTIVE for access and routing, not only unable to sign in. ADDITIVE: replaces functions in place
-- (create or replace) and adds three new ones; no table, column, policy or privilege on an existing object changes, and NO DATA CHANGES (nobody's access is
-- altered by running this file; see the optional owner step in docs/launch-p1c-deployment.md for accounts deactivated before today).
--
-- WHY. set_account_status() only updated profiles.account_status. profiles.is_active, which every Sales, Projects, Inventory and Budget access helper joins, was never
-- set to false by any application path, and resolve_approver*() ignored the account altogether, so a leaver stayed selectable and eligible as project manager, team
-- head, member and "last eligible CEO / CTO approver", and stayed the approver of record for every NEW request.
--
-- WHAT.
--   * set_account_status() sets profiles.is_active in the same transaction (false on deactivate, true on reactivate), and refuses to deactivate the last active
--     System Administrator (existing rule, same wording), the only CEO / CTO budget approver of a company, and the only CEO / CTO of a company.
--   * user_is_active(uuid) (internal): the one test "this person's profile is active". resolve_approver, resolve_approver_for_company, resolve_role_holders, the
--     Recovery Leave routing (recovery_eligible_approver_exists, recovery_route_request) and create_initial_approval's role-queue check skip inactive people, so a NEW
--     request goes to the next holder, and a request with nobody left says so in the existing words.
--   * account_deactivation_blockers(uuid) (internal) and account_holdings(uuid) (System Administrator only): what the person still holds, so the screen can show it
--     before the reason is typed. Counts and project REFERENCE CODES only (no project names, amounts or contents).
--   * guard_profiles_self_update() also refuses a person changing their own is_active (the flag now gates access, like account_status).
--
-- WHAT DOES NOT CHANGE. Approvals ALREADY pending on a person stay exactly as they are: nothing is re-routed automatically and there is no re-route action (owner
-- decision). Who may deactivate (System Administrator only), self-deactivation refusal, the reason rules, the audit trail, sign-in blocking (done by the server action
-- through the Admin API), company boundaries, every approval and grant rule. has_role() and the other role checks on the CALLER are unchanged (a banned person cannot
-- sign in; a session already open ends at its token expiry, as before).
--
-- Reactivation restores everything (is_active true again; the person is resolved again from the next request on).
-- ROLLBACK: supabase/manual-sql/deact_90_rollback.sql re-installs the previous definitions of every replaced function (shown by fingerprint).

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Internal helpers (not callable by signed-in users: only by the SECURITY DEFINER functions below)
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function user_is_active(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = p_user_id and is_active);
$$;

revoke all on function user_is_active(uuid) from public, anon, authenticated;

create or replace function account_deactivation_blockers(p_user_id uuid)
returns text[]
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_out text[] := '{}'::text[];
  c record;
begin
  -- the last active System Administrator (same rule and wording as before: checked against active accounts rather than unrevoked grants)
  if exists (select 1 from user_roles where user_id = p_user_id and role = 'sys_admin' and revoked_at is null)
     and not exists (
       select 1 from user_roles ur join profiles p on p.id = ur.user_id
        where ur.role = 'sys_admin' and ur.revoked_at is null and p.account_status = 'active' and p.is_active and ur.user_id <> p_user_id) then
    v_out := v_out || 'Can''t deactivate the last active System Administrator — the system would have nobody left to manage users or roles'::text;
  end if;

  -- the only CEO / CTO approver of project budgets of a company (the "last eligible approver" rule of the access grant rules)
  for c in
    select co.legal_name from pbx_company_grants g join companies co on co.id = g.company_id
     where g.user_id = p_user_id and g.revoked_at is null and 'executive_approver' = any (g.capabilities)
       and not exists (
         select 1 from pbx_company_grants g2 join profiles p2 on p2.id = g2.user_id and p2.is_active
          where g2.company_id = g.company_id and g2.revoked_at is null and g2.user_id <> p_user_id and 'executive_approver' = any (g2.capabilities))
     order by co.legal_name
  loop
    v_out := v_out || format('Can''t deactivate the only CEO / CTO approver of project budgets for %s — give another active person the approver right first', c.legal_name);
  end loop;

  -- the only CEO / CTO of a company (people with nobody above them are routed to "any other CEO / CTO")
  for c in
    select co.legal_name from companies co
     where co.is_active and co.deleted_at is null
       and exists (
         select 1 from user_roles ur
          where ur.user_id = p_user_id and ur.role in ('ceo', 'cto') and ur.revoked_at is null and (ur.company_id is null or ur.company_id = co.id))
       and not exists (
         select 1 from user_roles ur2 join profiles p2 on p2.id = ur2.user_id and p2.is_active
          where ur2.role in ('ceo', 'cto') and ur2.revoked_at is null and (ur2.company_id is null or ur2.company_id = co.id) and ur2.user_id <> p_user_id)
     order by co.legal_name
  loop
    v_out := v_out || format('Can''t deactivate the only CEO or CTO of %s — give another active person that role first', c.legal_name);
  end loop;

  return v_out;
end;
$$;

revoke all on function account_deactivation_blockers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- What the person still holds: System Administrator only. Counts and codes, never contents.
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function account_holdings(p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_employee uuid;
begin
  if auth.uid() is null or not has_role('sys_admin') then
    raise exception 'Only a System Administrator can see what an account still holds' using errcode = '42501';
  end if;
  select id into v_employee from employees where user_id = p_user_id and deleted_at is null limit 1;
  return jsonb_build_object(
    'blockers', to_jsonb(account_deactivation_blockers(p_user_id)),
    -- approvals assigned to this person that nobody has decided yet: they stay with the person until HR changes who decides
    'pending_approvals', coalesce((
      select jsonb_agg(jsonb_build_object('entity_type', t.entity_type, 'count', t.n) order by t.entity_type)
        from (select a.entity_type::text as entity_type, count(*)::int as n from approvals a
               where a.approver_id = p_user_id and a.decision = 'pending' group by a.entity_type) t), '[]'::jsonb),
    -- live projects (not completed or archived): reference codes only
    'projects_managed', coalesce((
      select jsonb_agg(jsonb_build_object('reference', p.reference, 'role', 'pm') order by p.reference)
        from proj_projects p where p.pm_user_id = p_user_id and p.status not in ('completed', 'archived')), '[]'::jsonb),
    'projects_acting', coalesce((
      select jsonb_agg(jsonb_build_object('reference', p.reference, 'role', 'acting_pm') order by p.reference)
        from proj_project_members m join proj_projects p on p.id = m.project_id
       where m.user_id = p_user_id and m.role = 'acting_pm' and m.removed_at is null and p.status not in ('completed', 'archived')), '[]'::jsonb),
    'teams_headed', coalesce((
      select jsonb_agg(jsonb_build_object('project', p.reference, 'team', t.name) order by p.reference, t.name)
        from proj_teams t join proj_projects p on p.id = t.project_id
       where t.head_user_id = p_user_id and t.removed_at is null and p.status not in ('completed', 'archived')), '[]'::jsonb),
    -- HR roles and module access: which, for which company, never the detail of what the person did with them
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('role', ur.role::text, 'company', co.legal_name) order by ur.role::text, co.legal_name nulls first)
        from user_roles ur left join companies co on co.id = ur.company_id where ur.user_id = p_user_id and ur.revoked_at is null), '[]'::jsonb),
    'module_access', coalesce((
      select jsonb_agg(jsonb_build_object('module', m.module, 'company', m.company) order by m.module, m.company)
        from (
          select 'Sales' as module, co.legal_name as company from crm_company_grants g join companies co on co.id = g.company_id where g.user_id = p_user_id and g.revoked_at is null
          union all select 'Projects', co.legal_name from proj_company_grants g join companies co on co.id = g.company_id where g.user_id = p_user_id and g.revoked_at is null
          union all select 'Inventory', co.legal_name from inv_company_grants g join companies co on co.id = g.company_id where g.user_id = p_user_id and g.revoked_at is null
          union all select 'Project budgets', co.legal_name from pbx_company_grants g join companies co on co.id = g.company_id where g.user_id = p_user_id and g.revoked_at is null
        ) m), '[]'::jsonb),
    'equipment_held', case when v_employee is null then 0
      else (select count(*)::int from inv_units u where u.employee_id = v_employee and u.custody_kind = 'employee' and u.lifecycle <> 'retired') end
  );
end;
$$;

revoke all on function account_holdings(uuid) from public, anon;
grant execute on function account_holdings(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- set_account_status(): as before, plus is_active in the same step and the new refusals
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function set_account_status(p_user_id uuid, p_new_status account_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status account_status;
  v_blockers text[];
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

  -- Matches the app-layer max (setAccountStatusSchema in lib/actions/account-status.ts).
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

  -- Only ever reachable when the target isn't the caller (guarded above). The last active System Administrator, the only CEO / CTO approver of a company's
  -- project budgets and the only CEO / CTO of a company are never deactivated: the lock above serialises two deactivations, so the second sees the first.
  if p_new_status = 'deactivated' then
    v_blockers := account_deactivation_blockers(p_user_id);
    if coalesce(array_length(v_blockers, 1), 0) > 0 then
      raise exception '%', v_blockers[1];
    end if;
  end if;

  update profiles
  set account_status = p_new_status,
      is_active = (p_new_status = 'active'),
      status_reason = p_reason,
      status_changed_by = auth.uid(),
      status_changed_at = now()
  where id = p_user_id;
end;
$$;

grant execute on function set_account_status(uuid, account_status, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- A person cannot change their own is_active (it now gates access)
-- ---------------------------------------------------------------------------------------------------------------------------------------------
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
    or new.is_active is distinct from old.is_active
    or new.status_reason is distinct from old.status_reason
    or new.status_changed_by is distinct from old.status_changed_by
    or new.status_changed_at is distinct from old.status_changed_at
  then
    raise exception 'Only full_name and locale can be self-updated — ask a System Administrator to change anything else.';
  end if;

  return new;
end;
$$;
-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Routing and role holders skip inactive people (new requests; approvals already pending are not touched)
-- ---------------------------------------------------------------------------------------------------------------------------------------------
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
      and user_is_active(ur.user_id)
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
    and user_is_active(user_id)
  order by granted_at asc;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Recovery Leave routing and the role-queue check of create_initial_approval
-- ---------------------------------------------------------------------------------------------------------------------------------------------
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
      and user_is_active(ur.user_id)
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
        and user_is_active(ur.user_id)
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
    where e.id = r.project_lead_employee_id and e.employment_status <> 'terminated' and e.deleted_at is null and user_is_active(e.user_id);
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
