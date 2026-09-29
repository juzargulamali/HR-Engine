-- Recovery Leave routing change, Stage 1 of 2.
--
-- Product decision: Recovery Leave requests must route project manager ->
-- the employee's HR owner, instead of direct_manager -> role:hr_admin.
-- Ordinary leave is UNCHANGED (still direct_manager, the employee's line
-- manager) — this only affects entity_type = 'recovery_credit'.
--
-- Why staged: resolve_approver('role:hr_admin', ...) turned out to
-- deterministically pick exactly one hr_admin per company (earliest
-- granted_at), which cannot be scoped to a QA/test fixture without
-- affecting real approvals (see packages/e2e-tests/README.md's "Recovery
-- Leave PM/HR-owner fixture" section for the full trace). Routing through a
-- specific per-employee assignment (hr_owner_id) instead of a company-wide
-- role lookup removes that whole class of problem, AND happens to make
-- E2E testing tractable (a dedicated test account's own employee row can
-- be assigned as another dedicated test account's HR owner, deterministically,
-- with no shared-role race).
--
-- SCOPE OF THIS MIGRATION — two things, deliberately different in how live
-- they are the moment this is applied:
--
--   1. ROUTING stays dormant. This migration does NOT touch
--      approval_workflow_steps or seed_default_approval_workflows() — every
--      company's Recovery Leave workflow keeps routing direct_manager ->
--      role:hr_admin exactly as today until Stage 2 (a separate, later,
--      manually-applied file — see supabase/manual-sql/
--      recovery_leave_pm_hr_owner_stage2_cutover.sql) flips it. Stage 2
--      VERSIONS the workflow (a new approval_workflows row, the old one
--      retired via is_active = false) rather than editing
--      approval_workflow_steps rows in place — so a request already
--      pending at step 1 the moment of cutover keeps advancing through its
--      ORIGINAL workflow_id's steps (captured on its approvals row at
--      creation, never recomputed), never the new ones.
--
--   2. RECORDING a recovery-day request becomes live and REQUIRED the
--      moment this migration (plus its accompanying app-code deploy) is
--      applied: record_attendance_and_recovery() (weekend/holiday) and
--      record_overnight_recovery_credit() (the overnight extension) both
--      now require HR to select the SPECIFIC project that day's work was
--      for, validated server-side (validate_recovery_credit_project()) —
--      company match, an active allocation covering the ACTUAL work date
--      (never current_date), and a currently active Project Manager. This
--      is NOT dormant: it changes what HR must supply to record ANY
--      weekend/holiday/overnight recovery credit from here on, independent
--      of which routing rule (old or new) is currently deciding who
--      approves it. The snapshot this produces (recovery_credit_requests.
--      project_id) is what Stage 2's project_manager routing will read.
--
-- Existing pending approvals are never touched by either stage: approver_id
-- is captured on the `approvals` row at creation/advancement time, never
-- recomputed — changing the workflow template (Stage 2) only affects NEW
-- approvals rows created after that point, and per point 1 above, even
-- THAT only affects rows created after the versioned cutover, never a
-- request already mid-chain.

-- ---------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------

alter table projects add column manager_id uuid references employees(id);
comment on column projects.manager_id is
  'This project''s assigned Project Manager — used by resolve_approver(''project_manager'', ...) for Recovery Leave step 1 once Stage 2 cuts over. NULL means "not yet assigned"; resolve_approver() returns NULL for it, and create_initial_approval()/decide_leave_approval() already hard-stop with a clear error on a NULL approver rather than silently creating an unroutable approval. Validated at write time by validate_project_manager_is_active_and_same_company() (below): must reference a currently active employee in THIS SAME company, or be NULL — no role is required, same precedent as employees.manager_id itself.';

alter table employees add column hr_owner_id uuid references employees(id);
comment on column employees.hr_owner_id is
  'The HR Admin (as an employees row) responsible for this employee''s HR-owned approvals (Recovery Leave step 2, once Stage 2 cuts over). Auto-set to the creating HR Admin on insert (see set_initial_hr_owner()) if they hold an active hr_admin role at that moment; reassignable later by any HR Admin via the normal employee edit form (employees_update_hr RLS already covers this column — no new policy needed), which the existing audit_employees trigger already captures as a before/after audit trail. Validated at write time by employees_validate_hr_owner (below): must reference an employee whose user currently holds an active hr_admin role that applies to THIS SAME company, and whose own employee row is in THIS SAME company, or be NULL. NULL means "not yet assigned".';

alter table recovery_credit_requests add column project_id uuid references projects(id);
comment on column recovery_credit_requests.project_id is
  'The SPECIFIC project this recovery day''s work was actually for, chosen by HR at creation time (validate_recovery_credit_project(), below) — never auto-derived from "whichever allocation has the highest percentage today", since an employee can be allocated to more than one project and the correct one for THIS particular day is whichever they actually worked. Snapshotted here (immutable once set) so resolve_approver(''project_manager'', ...) always resolves against the SAME project this request was created for. Nullable only because rows created before this column existed have no value to backfill — every row created by record_attendance_and_recovery()/record_overnight_recovery_credit() from here on requires one.';

-- ---------------------------------------------------------------------
-- 2. Validation: projects.manager_id must be an active, same-company
--    employee, or NULL
-- ---------------------------------------------------------------------

-- SECURITY DEFINER: must give an accurate answer regardless of whether the
-- writer's own RLS visibility happens to include the referenced employee
-- (e.g. an HR Admin in one company cannot normally SELECT another
-- company's employee row at all) — without it, a cross-company reference
-- would be rejected for the wrong reason ("no such active employee"
-- instead of "different company"), since the underlying SELECT would
-- simply find no visible row.
create or replace function validate_project_manager_is_active_and_same_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager record;
begin
  if NEW.manager_id is null then
    return NEW;
  end if;
  select id, company_id, employment_status, deleted_at into v_manager from employees where id = NEW.manager_id;
  if v_manager.id is null or v_manager.deleted_at is not null or v_manager.employment_status = 'terminated' then
    raise exception 'manager_id (%) must reference a currently active employee.', NEW.manager_id;
  end if;
  if v_manager.company_id is distinct from NEW.company_id then
    raise exception 'manager_id (%) must belong to the same company as the project.', NEW.manager_id;
  end if;
  return NEW;
end;
$$;

create trigger projects_validate_manager
  before insert or update of manager_id on projects
  for each row execute function validate_project_manager_is_active_and_same_company();

-- ---------------------------------------------------------------------
-- 3. Validation: hr_owner_id must be an active, same-company hr_admin,
--    or NULL
-- ---------------------------------------------------------------------

-- SECURITY DEFINER for the same reason as
-- validate_project_manager_is_active_and_same_company() above: must give an
-- accurate answer regardless of whether the writer's own RLS visibility
-- happens to include the referenced employee.
create or replace function validate_hr_owner_is_active_hr_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_owner_company_id uuid;
begin
  if NEW.hr_owner_id is null then
    return NEW;
  end if;
  if NEW.hr_owner_id = NEW.id then
    raise exception 'An employee cannot be their own HR owner.';
  end if;
  select user_id, company_id into v_owner_user_id, v_owner_company_id from employees where id = NEW.hr_owner_id;
  if v_owner_company_id is distinct from NEW.company_id then
    raise exception 'hr_owner_id (%) must belong to the same company as the employee being assigned an HR owner.', NEW.hr_owner_id;
  end if;
  if v_owner_user_id is null or not exists (
    select 1 from user_roles
    where user_id = v_owner_user_id and role = 'hr_admin' and revoked_at is null
      and (company_id is null or company_id = NEW.company_id)
  ) then
    raise exception 'hr_owner_id (%) must reference an employee whose user currently holds an active hr_admin role for this company.', NEW.hr_owner_id;
  end if;
  return NEW;
end;
$$;

create trigger employees_validate_hr_owner
  before insert or update of hr_owner_id on employees
  for each row execute function validate_hr_owner_is_active_hr_admin();

-- ---------------------------------------------------------------------
-- 4. Auto-assignment: creating HR Admin becomes the initial HR owner
-- ---------------------------------------------------------------------

-- Fires before employees_validate_hr_owner on the SAME (INSERT) event —
-- Postgres runs same-timing triggers in name order, and
-- 'employees_set_initial_hr_owner' sorts before 'employees_validate_hr_owner',
-- so whatever this sets is what that then validates. It only ever assigns
-- an already-verified active, same-company hr_admin's own employee id, or
-- leaves the column NULL, so validation always passes for what it sets.
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
-- 5. Server-side gate for recovery-day project selection — shared by
--    record_attendance_and_recovery() and record_overnight_recovery_credit()
-- ---------------------------------------------------------------------

create or replace function validate_recovery_credit_project(p_employee_id uuid, p_project_id uuid, p_work_date date)
returns void
language plpgsql
as $$
declare
  v_employee_company_id uuid;
  v_project record;
  v_manager record;
  v_allocation_exists boolean;
begin
  if p_project_id is null then
    raise exception 'A project must be selected for this recovery-day request.';
  end if;

  select company_id into v_employee_company_id from employees where id = p_employee_id;

  select id, company_id, manager_id, deleted_at into v_project from projects where id = p_project_id;
  if v_project.id is null or v_project.deleted_at is not null then
    raise exception 'Selected project (%) not found.', p_project_id;
  end if;
  if v_project.company_id is distinct from v_employee_company_id then
    raise exception 'Selected project (%) belongs to a different company than this employee.', p_project_id;
  end if;

  select exists (
    select 1 from project_allocations pa
    where pa.employee_id = p_employee_id and pa.project_id = p_project_id
      and pa.start_date <= p_work_date and (pa.end_date is null or pa.end_date >= p_work_date)
  ) into v_allocation_exists;
  if not v_allocation_exists then
    raise exception 'This employee has no active allocation to the selected project covering %.', p_work_date;
  end if;

  if v_project.manager_id is null then
    raise exception 'The selected project has no assigned Project Manager.';
  end if;
  select id, employment_status, deleted_at, company_id into v_manager from employees where id = v_project.manager_id;
  if v_manager.id is null or v_manager.employment_status = 'terminated' or v_manager.deleted_at is not null then
    raise exception 'The selected project''s Project Manager is not currently active.';
  end if;
  if v_manager.company_id is distinct from v_employee_company_id then
    raise exception 'The selected project''s Project Manager belongs to a different company.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. record_attendance_and_recovery(): now requires and stores project_id
--    per row (only enforced at the point a recovery_credit_requests row
--    would actually be inserted — an absent/leave/partial day, or a
--    present day that isn't a recovery day, needs no project). Full body
--    replaced below; every change from the version this migration
--    previously shipped is confined to the v_project_id variable, its
--    extraction from the JSON row, and the validate_recovery_credit_project()
--    call immediately before the insert.
-- ---------------------------------------------------------------------

create or replace function record_attendance_and_recovery(p_work_date date, p_rows jsonb)
returns table(attendance_employee_id uuid, credited boolean, reversed boolean, needs_policy_review boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_employee_id uuid;
  v_status text;
  v_work_mode text;
  v_hours numeric;
  v_project_id uuid;
  v_company_id uuid;
  v_country_code text;
  v_week_start_day smallint;
  v_working_weekdays integer[];
  v_holiday_name text;
  v_is_recovery_day boolean;
  v_record_id uuid;
  v_was_credited comp_day_ledger%rowtype;
  v_existing_request recovery_credit_requests%rowtype;
  v_credit_days numeric;
  v_request_id uuid;
  v_credited boolean;
  v_reversed boolean;
  v_needs_review boolean;
begin
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_employee_id := (v_row ->> 'employee_id')::uuid;
    v_status := v_row ->> 'status';
    v_work_mode := nullif(v_row ->> 'work_mode', '');
    v_hours := nullif(v_row ->> 'hours_worked', '')::numeric;
    v_project_id := nullif(v_row ->> 'project_id', '')::uuid;
    v_credited := false;
    v_reversed := false;
    v_needs_review := false;

    select e.company_id, e.country_code into v_company_id, v_country_code
    from employees e where e.id = v_employee_id;
    if v_company_id is null then
      raise exception 'Employee % not found', v_employee_id;
    end if;
    if not has_role('hr_admin', v_company_id) then
      raise exception 'Only HR Admin may record attendance for this employee';
    end if;

    -- Same advisory lock decide_leave_approval() takes before touching an
    -- employee's comp-day balance, for the same reason: without it, two
    -- concurrent saves for this employee (a double-clicked Save, or two
    -- admins editing the same date) could both read "not yet requested"
    -- before either has committed its insert, and both request it.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_employee_id::text));

    select week_start_day, working_weekdays into v_week_start_day, v_working_weekdays from countries where code = v_country_code;
    select name into v_holiday_name from public_holidays where country_code = v_country_code and holiday_date = p_work_date;
    v_is_recovery_day := v_holiday_name is not null
      or (
        case when v_working_weekdays is not null and array_length(v_working_weekdays, 1) > 0
          then not (extract(dow from p_work_date)::int = any(v_working_weekdays))
          else ((extract(dow from p_work_date)::int - coalesce(v_week_start_day, 1) + 7) % 7) >= 5
        end
      );

    -- One atomic upsert rather than a check-then-branch — the latter has
    -- the same TOCTOU shape as the race bulkRecordAttendance()'s old
    -- "already credited?" check had (two concurrent saves for the same
    -- employee/date, e.g. a double-clicked Save, could otherwise both see
    -- "no existing row" and both attempt an insert).
    insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
    values (v_employee_id, p_work_date, v_status, v_work_mode, v_hours, 'manual')
    on conflict (employee_id, work_date) do update
    set status = excluded.status, work_mode = excluded.work_mode, hours_worked = excluded.hours_worked
    returning id into v_record_id;

    -- The CURRENTLY ACTIVE credit for this record, if any — an 'earned' row
    -- that hasn't itself already been reversed — and any still-active
    -- (non-cancelled/non-rejected) recovery_credit_requests row.
    select cl.* into v_was_credited from comp_day_ledger cl
    where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
    select r.* into v_existing_request from recovery_credit_requests r
    where r.attendance_record_id = v_record_id and r.status not in ('cancelled', 'rejected');

    if v_is_recovery_day and v_status = 'present' then
      if v_was_credited.id is null and v_existing_request.id is null then
        if v_hours is null then
          v_needs_review := true;
        elsif v_hours > 0 then
          -- HR must select the actual project this work was for — never
          -- auto-picked from the employee's allocations, and never
          -- checked against today's date (p_work_date can be in the past,
          -- or, for this suite's own synthetic E2E fixtures, the future).
          -- See validate_recovery_credit_project()'s own doc comment.
          perform validate_recovery_credit_project(v_employee_id, v_project_id, p_work_date);
          v_credit_days := case when v_hours > 4 then 1 else 0.5 end;
          insert into recovery_credit_requests (employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by, project_id)
          values (v_employee_id, v_record_id, p_work_date, 'standard', v_credit_days, auth.uid(), v_project_id)
          returning id into v_request_id;
          perform create_initial_approval('recovery_credit', v_request_id);
          v_credited := true;
        end if;
      end if;
    else
      -- No longer an eligible day (corrected away from present, or no
      -- longer a recovery day). Reverse an already-fully-approved credit
      -- via the same linked-reversal pattern as before; ANY still-active
      -- request (submitted, pending_approval, OR already approved) is
      -- cancelled too — never deleted, same append-only convention
      -- cancel_leave_request() uses for approvals — so a later correction
      -- back to present can earn a genuinely fresh request for this day.
      if v_was_credited.id is not null then
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
        values (v_was_credited.employee_id, current_date, 'reversal', -v_was_credited.days, 'holiday_worked', 'attendance_record', v_record_id, v_was_credited.id, auth.uid());
        v_reversed := true;
      end if;
      if v_existing_request.id is not null then
        update recovery_credit_requests set status = 'cancelled', decided_at = now() where id = v_existing_request.id;
        update approvals
        set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, 'Cancelled: attendance record no longer qualifies')
        where entity_type = 'recovery_credit' and entity_id = v_existing_request.id and decision = 'pending';
      end if;
    end if;

    attendance_employee_id := v_employee_id;
    credited := v_credited;
    reversed := v_reversed;
    needs_policy_review := v_needs_review;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. record_overnight_recovery_credit(): now takes p_project_id and
--    requires/stores it the same way, checked against the ACTUAL
--    p_work_date entered (never current_date — this attests to a day
--    that may already be in the past).
-- ---------------------------------------------------------------------

create or replace function record_overnight_recovery_credit(
  p_employee_id uuid,
  p_work_date date,
  p_completed_normal_scheduled_day boolean,
  p_active_hours_after_midnight numeric,
  p_project_id uuid
)
returns table(credited boolean, credit_days numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_record_id uuid;
  v_was_credited comp_day_ledger%rowtype;
  v_existing_request recovery_credit_requests%rowtype;
  v_credit_days numeric;
  v_request_id uuid;
begin
  select company_id into v_company_id from employees where id = p_employee_id and deleted_at is null;
  if v_company_id is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  if not (has_role('hr_admin', v_company_id) or is_manager_of(p_employee_id)) then
    raise exception 'Only HR Admin or this employee''s manager may record an overnight recovery credit';
  end if;

  if p_active_hours_after_midnight is null or p_active_hours_after_midnight < 0 then
    raise exception 'active_hours_after_midnight must be a non-negative number';
  end if;

  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  select id into v_record_id from attendance_records where employee_id = p_employee_id and work_date = p_work_date;
  if v_record_id is null then
    raise exception 'Record ordinary attendance for % on % first', p_employee_id, p_work_date;
  end if;

  update attendance_records
  set completed_normal_scheduled_day = p_completed_normal_scheduled_day,
      active_hours_after_midnight = p_active_hours_after_midnight
  where id = v_record_id;

  select cl.* into v_was_credited from comp_day_ledger cl
  where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
    and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
  select r.* into v_existing_request from recovery_credit_requests r
  where r.attendance_record_id = v_record_id and r.status not in ('cancelled', 'rejected');

  if v_was_credited.id is not null or v_existing_request.id is not null then
    credited := false;
    credit_days := 0;
    return next;
    return;
  end if;

  if not p_completed_normal_scheduled_day or p_active_hours_after_midnight <= 0 then
    credited := false;
    credit_days := 0;
    return next;
    return;
  end if;

  -- HR must select the actual project this overnight extension was for —
  -- see validate_recovery_credit_project()'s own doc comment. Checked
  -- against p_work_date (never current_date), since this attests to work
  -- already recorded on that specific day, which may be in the past.
  perform validate_recovery_credit_project(p_employee_id, p_project_id, p_work_date);

  v_credit_days := case when p_active_hours_after_midnight > 4 then 1 else 0.5 end;

  insert into recovery_credit_requests (employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by, project_id)
  values (p_employee_id, v_record_id, p_work_date, 'overnight', v_credit_days, auth.uid(), p_project_id)
  returning id into v_request_id;

  perform create_initial_approval('recovery_credit', v_request_id);

  credited := true;
  credit_days := v_credit_days;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. resolve_approver(): new project_manager / hr_owner branches
--    (project_manager dormant until Stage 2 — no approval_workflow_steps
--    row references it yet; hr_owner likewise). Signature gains a third,
--    defaulted p_entity_id parameter — every existing 2-argument call site
--    (direct_manager, manager_of_manager, role:%) is unaffected. The
--    ORIGINAL 2-argument resolve_approver(text, uuid), created by an
--    earlier migration, must be dropped first: CREATE OR REPLACE cannot
--    change a function's parameter list, so leaving it in place would add
--    a second, separate overload rather than replacing it — dropping is
--    safe here because plpgsql callers (create_initial_approval(),
--    decide_leave_approval(), both replaced below) resolve the function by
--    name at each call, not by a hard dependency on this specific
--    signature.
-- ---------------------------------------------------------------------

drop function if exists resolve_approver(text, uuid);

create or replace function resolve_approver(p_approver_type text, p_employee_id uuid, p_entity_id uuid default null)
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
    -- The SPECIFIC project HR selected for THIS Recovery Leave request,
    -- snapshotted on recovery_credit_requests.project_id at creation time
    -- by validate_recovery_credit_project() (called from
    -- record_attendance_and_recovery()/record_overnight_recovery_credit())
    -- — NEVER re-derived from "whichever allocation happens to be active
    -- right now" (current_date): an employee can be allocated to several
    -- projects at once, and the correct one for THIS request is whichever
    -- HR actually attested to, not today's biggest percentage. p_entity_id
    -- is recovery_credit_requests.id — the only entity type that ever uses
    -- this approver_type. Re-checks the project's manager is STILL active
    -- and in the SAME company as the project (projects_validate_manager
    -- already enforces this at write time, so this should always hold —
    -- defense-in-depth, same as hr_owner's own re-check below). No
    -- fallback if unresolvable (deleted project, or its manager has since
    -- been deactivated) — unlike direct_manager/role:%'s ceo/cto fallback,
    -- there is no sensible "anyone can stand in" substitute for a specific
    -- project's PM, so this deliberately returns NULL and lets
    -- create_initial_approval()/decide_leave_approval()'s existing
    -- hard-stop surface a clear, actionable error instead.
    select m.user_id into v_result
    from recovery_credit_requests r
    join projects pr on pr.id = r.project_id and pr.deleted_at is null
    join employees m on m.id = pr.manager_id
      and m.employment_status <> 'terminated' and m.deleted_at is null and m.company_id = pr.company_id
    where r.id = p_entity_id;
  elsif p_approver_type = 'hr_owner' then
    -- Direct, per-employee assignment — no company-wide role race, and no
    -- fallback for the same reason as project_manager above. Re-checks, at
    -- resolution time, that the assigned owner is STILL an active employee
    -- in the SAME COMPANY as this employee (employees_validate_hr_owner
    -- already enforces this at write time) AND still holds an hr_admin
    -- role that applies to that company (a global grant, or one scoped
    -- specifically to it) — an unassigned or since-invalidated HR owner is
    -- a real data-quality gap that should hard-stop the request, not
    -- silently reroute.
    select o.user_id into v_result
    from employees e
    join employees o on o.id = e.hr_owner_id
      and o.deleted_at is null and o.employment_status <> 'terminated' and o.company_id = e.company_id
    where e.id = p_employee_id
      and exists (
        select 1 from user_roles ur
        where ur.user_id = o.user_id and ur.role = 'hr_admin' and ur.revoked_at is null
          and (ur.company_id is null or ur.company_id = e.company_id)
      );
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. create_initial_approval(): passes p_entity_id through to
--    resolve_approver() so its project_manager branch (once live) can read
--    the SNAPSHOTTED project off the entity itself, not re-derive one.
--    Same signature as before — a plain CREATE OR REPLACE. Full body
--    included below (required by CREATE OR REPLACE); the only change from
--    the version this migration previously shipped is that one
--    resolve_approver() call now passes p_entity_id as a third argument.
-- ---------------------------------------------------------------------

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
  elsif p_entity_type = 'recovery_credit' then
    select e.company_id, r.employee_id into v_company_id, v_employee_id
    from recovery_credit_requests r join employees e on e.id = r.employee_id where r.id = p_entity_id;
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
    v_approver_id := resolve_approver(v_approver_type, v_employee_id, p_entity_id);
  end if;
  if v_approver_id is null then
    raise exception 'No approver could be resolved (e.g. no manager assigned, or no one holds the required role). Contact HR Admin.';
  end if;

  -- Self-approval prevention for step 1 — decide_leave_approval() already
  -- refuses to route any LATER step back to the requester; this is the same
  -- check for the first step, which that function never sees. Compares
  -- against the ENTITY's own beneficiary, not always the caller: every
  -- other entity type is self-submitted (the caller IS the requester, so
  -- auth.uid() is correct), but recovery_credit is manager/HR-initiated ON
  -- BEHALF OF the employee — the direct manager routinely is both the one
  -- recording eligibility AND the resolved step-1 approver for their own
  -- report, which is never "self-approval" (they aren't approving their
  -- OWN leave). Only block if the resolved approver equals the beneficiary.
  if p_entity_type = 'recovery_credit' then
    select user_id into v_self_check_user_id from employees where id = v_employee_id;
  else
    v_self_check_user_id := auth.uid();
  end if;
  if v_approver_id = v_self_check_user_id then
    raise exception 'The resolved approver for this workflow''s first step (%) is you — you can''t approve your own request. Contact HR Admin to assign a different approver.', v_approver_type;
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

-- ---------------------------------------------------------------------
-- 10. decide_leave_approval(): same reasoning as create_initial_approval()
--     above — its own resolve_approver() call (used when advancing to the
--     NEXT step) now passes v_approval.entity_id through too. Full body
--     included below (required by CREATE OR REPLACE); the only change is
--     that one call.
-- ---------------------------------------------------------------------

create or replace function decide_leave_approval(p_approval_id uuid, p_decision approval_decision, p_comments text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval approvals%rowtype;
  v_employee_id uuid;
  v_requester_user_id uuid;
  v_amount numeric(12,2);
  v_leave_request leave_requests%rowtype;
  v_remaining numeric(6,2);
  v_rule record;
  v_available numeric(6,2);
  v_draw numeric(6,2);
  v_had_configured_rule boolean;
  v_timesheet timesheets%rowtype;
  v_payroll_company_id uuid;
  v_recovery_request recovery_credit_requests%rowtype;
  v_comp_day_ledger_id uuid;
  v_step record;
  v_next_approver uuid;
  v_found_next boolean := false;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be ''approved'' or ''rejected''';
  end if;

  select * into v_approval from approvals where id = p_approval_id for update;
  if not found then
    raise exception 'Approval not found';
  end if;
  if auth.uid() is not null and v_approval.approver_id <> auth.uid() then
    raise exception 'Only the assigned approver may decide this';
  end if;
  if v_approval.decision <> 'pending' then
    raise exception 'This approval has already been decided';
  end if;

  update approvals set decision = p_decision, decided_at = now(), comments = p_comments where id = p_approval_id;

  if v_approval.entity_type = 'leave_request' then
    select * into v_leave_request from leave_requests where id = v_approval.entity_id for update;
    v_employee_id := v_leave_request.employee_id;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'reimbursement_claim' then
    select employee_id, total_amount into v_employee_id, v_amount
    from reimbursement_claims where id = v_approval.entity_id for update;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'timesheet' then
    select * into v_timesheet from timesheets where id = v_approval.entity_id for update;
    v_employee_id := v_timesheet.employee_id;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'generated_letter' then
    select employee_id into v_employee_id from generated_letters where id = v_approval.entity_id for update;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'payroll_export_run' then
    select company_id, generated_by into v_payroll_company_id, v_requester_user_id
    from payroll_export_runs where id = v_approval.entity_id for update;
  elsif v_approval.entity_type = 'recovery_credit' then
    select * into v_recovery_request from recovery_credit_requests where id = v_approval.entity_id for update;
    v_employee_id := v_recovery_request.employee_id;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  else
    return; -- reserved for future entity types; nothing further to do here
  end if;

  if p_decision = 'rejected' then
    if v_approval.entity_type = 'leave_request' then
      update leave_requests set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'reimbursement_claim' then
      update reimbursement_claims set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'timesheet' then
      update timesheets set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'generated_letter' then
      update generated_letters set status = 'void' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'payroll_export_run' then
      update payroll_export_runs set status = 'rejected' where id = v_approval.entity_id;
      -- Release this run's claim on its source rows (approved reimbursements,
      -- leave-encashment ledger entries) so a rejected run doesn't
      -- permanently block them from ever being paid — otherwise
      -- generate_payroll_export_lines()'s "not exists" check (keyed only on
      -- source_reference_type/id, with no regard for the referencing run's
      -- status) would treat them as already exported, forever.
      delete from payroll_export_lines where run_id = v_approval.entity_id;
    elsif v_approval.entity_type = 'recovery_credit' then
      update recovery_credit_requests set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    end if;
    return; -- rejection stops the chain; earlier decisions in the log are untouched
  end if;

  -- Walk every remaining step in order (not just the next one) — a step
  -- whose condition doesn't apply (amount below its threshold) is skipped,
  -- and a step that resolves to the requester themselves is skipped too
  -- (self-approval prevention). A step that resolves to NO ONE AT ALL (the
  -- role has zero holders in this company) is different: that's not "skip
  -- and keep going", it's "this cannot legitimately proceed" — abort the
  -- whole decision rather than silently finalizing as if this step had
  -- been satisfied.
  for v_step in
    select step_order, approver_type, condition
    from approval_workflow_steps
    where workflow_id = v_approval.workflow_id and step_order > v_approval.step_order
    order by step_order asc
  loop
    if v_step.condition is not null and v_step.condition ? 'amount_gt' then
      if v_amount is null or v_amount <= (v_step.condition ->> 'amount_gt')::numeric then
        continue; -- this step's threshold doesn't apply to this entity
      end if;
    end if;

    if v_approval.entity_type = 'payroll_export_run' then
      v_next_approver := resolve_approver_for_company(v_step.approver_type, v_payroll_company_id);
    else
      v_next_approver := resolve_approver(v_step.approver_type, v_employee_id, v_approval.entity_id);
    end if;

    if v_next_approver is null then
      raise exception 'Cannot advance this approval: no one currently holds the "%" role required for the next step. Ask HR Admin to assign that role, then try again.', v_step.approver_type;
    end if;

    if v_next_approver <> v_requester_user_id then
      insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id)
      values (v_approval.entity_type, v_approval.entity_id, v_approval.workflow_id, v_step.step_order, v_next_approver);
      v_found_next := true;
      exit;
    end if;
    -- self-approval: keep walking forward to find a different eligible approver
  end loop;

  if v_found_next then
    if v_approval.entity_type = 'leave_request' then
      update leave_requests set status = 'pending_approval' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'reimbursement_claim' then
      update reimbursement_claims set status = 'pending_approval' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'timesheet' then
      update timesheets set status = 'pending_approval' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'payroll_export_run' then
      update payroll_export_runs set status = 'pending_approval' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'recovery_credit' then
      -- The manager's "provisional release" — nothing is credited yet.
      update recovery_credit_requests set status = 'pending_approval' where id = v_approval.entity_id;
    end if;
    -- generated_letter has only ever had one step (role:ceo) so it never reaches here
    return;
  end if;

  -- Final approval — entity-specific finalization.
  if v_approval.entity_type = 'leave_request' then
    v_remaining := v_leave_request.total_days;

    -- The row-level "for update" locks above only cover this one
    -- leave_request/approval pair -- they don't stop a SECOND, independent
    -- leave request for the SAME employee from being finalized concurrently
    -- (two approvers, or one approver clicking through two pending items
    -- quickly). Both would otherwise read the same comp_day_ledger SUM
    -- before either commits its deduction, letting both draw from what
    -- looks like an independent full balance and overdraw it. An advisory
    -- lock keyed on the employee serializes comp-day balance reads+writes
    -- across concurrent decisions for that employee; it's released
    -- automatically at transaction end.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_leave_request.employee_id::text));

    v_had_configured_rule := false;
    for v_rule in
      select dpr.source_ledger
      from deduction_priority_rules dpr
      join employees e on e.id = v_leave_request.employee_id
      where dpr.leave_type_code = v_leave_request.leave_type_code
        and (dpr.company_id = e.company_id or (dpr.company_id is null and dpr.country_code = e.country_code))
        and dpr.effective_from <= v_leave_request.start_date
      order by dpr.priority_order asc
    loop
      v_had_configured_rule := true;
      exit when v_remaining <= 0;

      if v_rule.source_ledger = 'comp_day' then
        -- coalesce(sum(days), 0) already nets out every prior redemption,
        -- reversal AND expiry entry for this employee — the comp-day-expiry
        -- cron posts a negative 'expired' row whenever an earned entry's
        -- remaining balance lapses, so this sum is already the correct
        -- CURRENTLY-AVAILABLE (unexpired) balance, not a raw lifetime total.
        select coalesce(sum(days), 0) into v_available from comp_day_ledger where employee_id = v_leave_request.employee_id;
        if v_available > 0 then
          v_draw := least(v_remaining, v_available);
          -- A single aggregate 'redeemed' entry, not linked to one specific
          -- earned row — oldest-expiring-first is a property of how the
          -- expiry cron's pooling algorithm (computeCompDayExpiry) reads
          -- the ledger afterward (it always consumes the earliest-expiring
          -- surviving balance first), not of which earned row a redemption
          -- names, so this draw participates correctly in FIFO consumption
          -- without needing per-request linkage.
          insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, reference_id, created_by)
          values (v_leave_request.employee_id, v_leave_request.start_date, 'redeemed', -v_draw, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
          v_remaining := v_remaining - v_draw;
        end if;
      elsif v_rule.source_ledger = 'leave_ledger' then
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
        values (v_leave_request.employee_id, v_leave_request.leave_type_code, v_leave_request.start_date, 'deduction', -v_remaining, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
        v_remaining := 0;
      end if;
    end loop;

    if v_remaining > 0 then
      if v_had_configured_rule then
        -- At least one deduction_priority_rules row WAS configured for this
        -- leave type (e.g. Recovery Leave's comp_day-only rule) and it
        -- could not cover the full request — refuse outright rather than
        -- falling through to an unconfigured leave_ledger balance that has
        -- no real accrual behind it at all. This whole function call rolls
        -- back on this exception (including the partial comp_day
        -- 'redeemed' entry just above and the approvals row updated
        -- earlier), so nothing is left half-applied.
        raise exception 'Insufficient balance to approve this %: % day(s) requested, only % day(s) available from the configured funding source(s) for this leave type.',
          v_leave_request.leave_type_code, v_leave_request.total_days, (v_leave_request.total_days - v_remaining);
      else
        -- No deduction_priority_rules row has ever been configured for
        -- this leave type at all (true of every leave type this system
        -- shipped with before Recovery Leave, e.g. annual/sick) — same
        -- unconditional leave_ledger fallback as always, unchanged.
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
        values (v_leave_request.employee_id, v_leave_request.leave_type_code, v_leave_request.start_date, 'deduction', -v_remaining, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
      end if;
    end if;

    update leave_requests set status = 'approved', decided_at = now() where id = v_leave_request.id;

  elsif v_approval.entity_type = 'reimbursement_claim' then
    -- No ledger write here — approved claims are picked up by the payroll
    -- export job. Finalizing just unblocks that downstream step.
    update reimbursement_claims set status = 'approved', decided_at = now() where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'timesheet' then
    -- Deliberately no ledger write — timesheets are deprecated. Comp-days
    -- for weekend/holiday work come from Attendance instead (see
    -- bulkRecordAttendance in apps/web/src/lib/actions/attendance.ts).
    update timesheets set status = 'approved', decided_at = now() where id = v_timesheet.id;

  elsif v_approval.entity_type = 'generated_letter' then
    update generated_letters set status = 'issued' where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'payroll_export_run' then
    -- The C-level exec's decision (ceo or cto — the final, always-present
    -- step) stamps authorized_by/at — the one place this column is ever
    -- set, since there's no direct UPDATE policy on those columns for
    -- anyone.
    update payroll_export_runs
    set status = 'approved', authorized_by = coalesce(auth.uid(), v_requester_user_id), authorized_at = now()
    where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'recovery_credit' then
    -- HR Admin's final approval — the ONLY point anywhere in this system
    -- that posts the actual earned comp_day_ledger row for a recovery
    -- credit. Defensively re-checks for an existing active credit first
    -- (decide_leave_approval() already refuses to re-decide a
    -- non-'pending' approval, so this can only run once per approvals row
    -- in practice — this is a second, independent backstop, the same
    -- "already credited?" check record_attendance_and_recovery() uses).
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_recovery_request.employee_id::text));

    if not exists (
      select 1 from comp_day_ledger cl
      where cl.reference_type = 'attendance_record' and cl.reference_id = v_recovery_request.attendance_record_id and cl.entry_type = 'earned'
        and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id)
    ) then
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
      values (
        v_recovery_request.employee_id,
        v_recovery_request.work_date,
        'earned',
        v_recovery_request.proposed_days,
        case v_recovery_request.event_type when 'overnight' then 'overnight_extension' else 'holiday_worked' end,
        v_recovery_request.work_date + interval '180 days',
        'attendance_record',
        v_recovery_request.attendance_record_id,
        coalesce(auth.uid(), v_requester_user_id)
      )
      returning id into v_comp_day_ledger_id;

      update recovery_credit_requests
      set status = 'approved', decided_at = now(), comp_day_ledger_id = v_comp_day_ledger_id
      where id = v_recovery_request.id;
    else
      update recovery_credit_requests set status = 'approved', decided_at = now() where id = v_recovery_request.id;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. RPC for the HR Owner picker UI — user_roles has no SELECT policy for
--     plain hr_admin (user_roles_select_own restricts to auth.uid() or
--     sys_admin), so listing "who currently holds hr_admin in my company"
--     needs a definer function, same pattern as get_employee_manager_name()
--     (see supabase/migrations/20261105000000_fix_employee_manager_name_visibility.sql).
--     Exposes only id/first_name/last_name — never role-grant metadata.
--     Now also requires the candidate's hr_admin GRANT itself to apply to
--     this company (global, or scoped to it) — not just that the
--     candidate's employee row happens to sit in this company.
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
      and (ur.company_id is null or ur.company_id = p_company_id)
    order by e.first_name, e.last_name;
end;
$$;

revoke all on function list_active_hr_admins(uuid) from public;
grant execute on function list_active_hr_admins(uuid) to authenticated;
