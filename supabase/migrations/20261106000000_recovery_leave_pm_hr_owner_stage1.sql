-- Recovery Leave routing change, Stage 1 of 2 — SAFE, ADDITIVE, DORMANT.
--
-- Product decision: Recovery Leave requests must route project manager ->
-- the employee's HR owner, instead of direct_manager -> role:hr_admin.
-- Ordinary leave is UNCHANGED (still direct_manager, the employee's line
-- manager) — this only affects entity_type = 'recovery_credit'.
--
-- Why staged: resolve_approver('role:hr_admin', ...) turned out to
-- deterministically pick exactly one hr_admin per company (earliest
-- granted_at), which cannot be scoped to a QA/test fixture without
-- affecting real approvals (see packages/e2e-tests/README.md's "HR Admin
-- approver fixture" section for the full trace). Routing through a
-- specific per-employee assignment (hr_owner_id) instead of a company-wide
-- role lookup removes that whole class of problem, AND happens to make
-- E2E testing tractable (a dedicated test account's own employee row can
-- be assigned as another dedicated test account's HR owner, deterministically,
-- with no shared-role race).
--
-- This migration ONLY adds new, nullable, currently-unused columns and
-- functions. It does NOT touch approval_workflow_steps or
-- seed_default_approval_workflows() — every company's Recovery Leave
-- workflow keeps routing direct_manager -> role:hr_admin exactly as today
-- until Stage 2 (a separate, later, manually-applied migration) flips it.
-- Apply this one any time; it changes no live behavior.
--
-- Existing pending approvals are never touched by either stage: approver_id
-- is captured on the `approvals` row at creation/advancement time, never
-- recomputed — changing the workflow template (Stage 2) only affects NEW
-- approvals rows created after that point.

-- ---------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------

alter table projects add column manager_id uuid references employees(id);
comment on column projects.manager_id is
  'This project''s assigned Project Manager — used by resolve_approver(''project_manager'', ...) for Recovery Leave step 1 once Stage 2 cuts over. NULL means "not yet assigned"; resolve_approver() returns NULL for it, and create_initial_approval()/decide_leave_approval() already hard-stop with a clear error on a NULL approver rather than silently creating an unroutable approval.';

alter table employees add column hr_owner_id uuid references employees(id);
comment on column employees.hr_owner_id is
  'The HR Admin (as an employees row) responsible for this employee''s HR-owned approvals (Recovery Leave step 2, once Stage 2 cuts over). Auto-set to the creating HR Admin on insert (see set_initial_hr_owner()) if they hold an active hr_admin role at that moment; reassignable later by any HR Admin via the normal employee edit form (employees_update_hr RLS already covers this column — no new policy needed), which the existing audit_employees trigger already captures as a before/after audit trail. Validated at write time by employees_validate_hr_owner (below): must reference an employee whose user currently holds an active hr_admin role, or be NULL. NULL means "not yet assigned".';

-- ---------------------------------------------------------------------
-- 2. Validation: hr_owner_id must be an active hr_admin, or NULL
-- ---------------------------------------------------------------------

create or replace function validate_hr_owner_is_active_hr_admin()
returns trigger
language plpgsql
as $$
declare
  v_owner_user_id uuid;
begin
  if NEW.hr_owner_id is null then
    return NEW;
  end if;
  if NEW.hr_owner_id = NEW.id then
    raise exception 'An employee cannot be their own HR owner.';
  end if;
  select user_id into v_owner_user_id from employees where id = NEW.hr_owner_id;
  if v_owner_user_id is null or not exists (
    select 1 from user_roles
    where user_id = v_owner_user_id and role = 'hr_admin' and revoked_at is null
  ) then
    raise exception 'hr_owner_id (%) must reference an employee whose user currently holds an active hr_admin role.', NEW.hr_owner_id;
  end if;
  return NEW;
end;
$$;

create trigger employees_validate_hr_owner
  before insert or update of hr_owner_id on employees
  for each row execute function validate_hr_owner_is_active_hr_admin();

-- ---------------------------------------------------------------------
-- 3. Auto-assignment: creating HR Admin becomes the initial HR owner
-- ---------------------------------------------------------------------

-- Fires before employees_validate_hr_owner on the SAME (INSERT) event —
-- Postgres runs same-timing triggers in name order, and
-- 'employees_set_initial_hr_owner' sorts before 'employees_validate_hr_owner',
-- so whatever this sets is what that then validates. It only ever assigns
-- an already-verified active hr_admin's own employee id, or leaves the
-- column NULL, so validation always passes for what it sets.
create or replace function set_initial_hr_owner()
returns trigger
language plpgsql
as $$
declare
  v_creator_employee_id uuid;
begin
  if NEW.hr_owner_id is not null or NEW.created_by is null then
    return NEW;
  end if;
  select e.id into v_creator_employee_id
  from employees e
  where e.user_id = NEW.created_by
    and e.company_id = NEW.company_id
    and e.deleted_at is null
    and exists (
      select 1 from user_roles ur
      where ur.user_id = e.user_id and ur.role = 'hr_admin' and ur.revoked_at is null
    )
  limit 1;
  NEW.hr_owner_id := v_creator_employee_id; -- stays NULL if the creator isn't a current, active hr_admin in this company
  return NEW;
end;
$$;

create trigger employees_set_initial_hr_owner
  before insert on employees
  for each row execute function set_initial_hr_owner();

-- ---------------------------------------------------------------------
-- 4. resolve_approver(): new project_manager / hr_owner branches
--    (dormant until Stage 2 — no approval_workflow_steps row references
--    either value yet)
-- ---------------------------------------------------------------------

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
  elsif p_approver_type = 'project_manager' then
    -- The employee's currently-active project allocation (start_date <=
    -- today <= end_date, or end_date null) determines "the" project for
    -- routing purposes. An employee can have several simultaneous
    -- allocations (project_allocations has no uniqueness constraint on
    -- employee_id) — deliberately NOT an error case: pick the allocation
    -- with the highest percentage (their primary project), breaking ties
    -- by the most recently started, then by id for full determinism. No
    -- fallback if unresolvable (no active allocation, or the project has
    -- no manager_id, or that manager is terminated/deleted) — unlike
    -- direct_manager/role:%'s ceo/cto fallback, there is no sensible
    -- "anyone can stand in" substitute for a specific project's PM, so
    -- this deliberately returns NULL and lets create_initial_approval()/
    -- decide_leave_approval()'s existing hard-stop surface a clear,
    -- actionable error instead.
    select m.user_id into v_result
    from project_allocations pa
    join projects pr on pr.id = pa.project_id and pr.deleted_at is null
    join employees m on m.id = pr.manager_id and m.employment_status <> 'terminated' and m.deleted_at is null
    where pa.employee_id = p_employee_id
      and pa.start_date <= current_date
      and (pa.end_date is null or pa.end_date >= current_date)
    order by pa.allocation_percent desc, pa.start_date desc, pa.id
    limit 1;
  elsif p_approver_type = 'hr_owner' then
    -- Direct, per-employee assignment — no company-wide role race, and no
    -- fallback for the same reason as project_manager above: an
    -- unassigned or since-deactivated HR owner is a real data-quality gap
    -- that should hard-stop the request, not silently reroute.
    select o.user_id into v_result
    from employees e
    join employees o on o.id = e.hr_owner_id and o.deleted_at is null and o.employment_status <> 'terminated'
    where e.id = p_employee_id
      and exists (
        select 1 from user_roles ur where ur.user_id = o.user_id and ur.role = 'hr_admin' and ur.revoked_at is null
      );
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. RPC for the HR Owner picker UI — user_roles has no SELECT policy for
--    plain hr_admin (user_roles_select_own restricts to auth.uid() or
--    sys_admin), so listing "who currently holds hr_admin in my company"
--    needs a definer function, same pattern as get_employee_manager_name()
--    (see supabase/migrations/20261105000000_fix_employee_manager_name_visibility.sql).
--    Exposes only id/first_name/last_name — never role-grant metadata.
-- ---------------------------------------------------------------------

create or replace function list_active_hr_admins(p_company_id uuid)
returns table(employee_id uuid, first_name text, last_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_role('hr_admin', p_company_id) then
    raise exception 'Only HR Admin can list HR owner candidates.';
  end if;
  return query
    select e.id, e.first_name, e.last_name
    from employees e
    join user_roles ur on ur.user_id = e.user_id
    where e.company_id = p_company_id
      and e.deleted_at is null
      and e.employment_status <> 'terminated'
      and ur.role = 'hr_admin'
      and ur.revoked_at is null
    order by e.first_name, e.last_name;
end;
$$;

revoke all on function list_active_hr_admins(uuid) from public;
grant execute on function list_active_hr_admins(uuid) to authenticated;
