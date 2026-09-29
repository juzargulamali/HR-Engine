-- Recovery Leave routing change, Stage 2 of 2 — THE CUTOVER.
--
-- DELIBERATELY NOT in supabase/migrations/ and NOT run by the local
-- Postgres test bootstrap or CI. This file only changes live routing
-- behavior once YOU run it manually in the Supabase SQL Editor, after
-- Stage 1 (supabase/migrations/20261106000000_recovery_leave_pm_hr_owner_stage1.sql)
-- has been applied and deployed, and after you have confirmed readiness —
-- see "Before you run this" below. Running it before that check will
-- immediately hard-stop new Recovery Leave requests for anyone whose
-- project/employee has no manager_id/hr_owner_id assigned yet
-- (create_initial_approval() already raises a clear
-- "No approver could be resolved" error rather than silently creating an
-- unroutable approval — this is intentional, not a bug, but it will block
-- real attendance saves until fixed).
--
-- What this does: flips the RECOVERY LEAVE workflow template only.
-- Ordinary leave, reimbursements, timesheets, letters, and payroll export
-- are all UNCHANGED. Existing pending approvals are UNCHANGED — approver_id
-- was already captured on those rows at creation time and is never
-- recomputed; this only affects which approver gets assigned to NEW
-- recovery_credit requests created after this runs.
--
-- ======================================================================
-- Before you run this — readiness check (read-only, safe to run any time)
-- ======================================================================
--
-- Every project your active employees could be allocated to should have a
-- manager_id, and every active employee who might earn a Recovery Leave
-- credit should have an hr_owner_id. Neither is enforced retroactively by
-- this script — it only changes routing going forward. Check what's
-- currently unassigned:
--
--   select id, code, name from projects
--   where deleted_at is null and is_active = true and manager_id is null;
--
--   select id, employee_number, first_name, last_name, company_id
--   from employees
--   where deleted_at is null and employment_status <> 'terminated'
--     and hr_owner_id is null;
--
-- Assign the missing ones via the app's own UI (Projects page's manager
-- field; the Employee edit page's HR Owner field) before proceeding — both
-- are already live once Stage 1 is deployed, independent of this cutover.
-- It's fine to run this cutover with some rows still unassigned if you
-- accept that Recovery Leave will hard-stop for exactly those cases until
-- fixed; it will never silently misroute them.
--
-- ======================================================================
-- The cutover
-- ======================================================================

-- 1. Existing companies: flip the recovery_credit workflow's two steps.
--    Scoped strictly to entity_type = 'recovery_credit' — every other
--    workflow (leave_request, reimbursement_claim, timesheet,
--    generated_letter, payroll_export_run) is untouched.
update approval_workflow_steps
set approver_type = 'project_manager'
where step_order = 1
  and workflow_id in (select id from approval_workflows where entity_type = 'recovery_credit');

update approval_workflow_steps
set approver_type = 'hr_owner'
where step_order = 2
  and workflow_id in (select id from approval_workflows where entity_type = 'recovery_credit');

-- 2. Future companies: seed_default_approval_workflows() should seed the
--    NEW routing directly from here on, not the old one only to be
--    immediately out of date. Same function, only the recovery_credit
--    insert block's two values changed (direct_manager -> project_manager,
--    role:hr_admin -> hr_owner) — everything else identical to
--    schema/schema.sql's current definition.
create or replace function seed_default_approval_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity approvable_entity;
  v_workflow_id uuid;
begin
  foreach v_entity in array array['leave_request', 'reimbursement_claim', 'timesheet', 'generated_letter']::approvable_entity[]
  loop
    insert into approval_workflows (company_id, entity_type, name)
    values (new.id, v_entity, 'Default ' || replace(v_entity::text, '_', ' ') || ' approval')
    returning id into v_workflow_id;

    insert into approval_workflow_steps (workflow_id, step_order, approver_type)
    values (v_workflow_id, 1, case when v_entity = 'generated_letter' then 'role:ceo' else 'direct_manager' end);
  end loop;

  insert into approval_workflows (company_id, entity_type, name)
  values (new.id, 'payroll_export_run', 'Payroll export authorization (Finance, then CEO — mandatory, every time)')
  returning id into v_workflow_id;

  insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
    (v_workflow_id, 1, 'role:finance'),
    (v_workflow_id, 2, 'role:ceo');

  -- Recovery Leave earning: Project Manager approval (provisional
  -- release), then the employee's HR Owner's final approval (the only
  -- point that posts a ledger credit) — its own insert, outside the loop
  -- above, because its step count (2) differs from every other entity
  -- type there (1). Cut over from direct_manager/role:hr_admin on
  -- <fill in the date you run this>: see
  -- supabase/manual-sql/recovery_leave_pm_hr_owner_stage2_cutover.sql.
  insert into approval_workflows (company_id, entity_type, name)
  values (new.id, 'recovery_credit', 'Recovery Leave earning approval (Project Manager, then HR Owner)')
  returning id into v_workflow_id;

  insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
    (v_workflow_id, 1, 'project_manager'),
    (v_workflow_id, 2, 'hr_owner');

  return new;
end;
$$;

-- ======================================================================
-- Verification (run after)
-- ======================================================================
--
--   select aw.company_id, aws.step_order, aws.approver_type
--   from approval_workflow_steps aws
--   join approval_workflows aw on aw.id = aws.workflow_id
--   where aw.entity_type = 'recovery_credit'
--   order by aw.company_id, aws.step_order;
--
-- Expect step_order=1 -> 'project_manager', step_order=2 -> 'hr_owner' for
-- every row. Existing pending recovery_credit approvals (check with:
--   select id, entity_id, step_order, approver_id, decision from approvals
--   where entity_type = 'recovery_credit' and decision = 'pending';
-- ) must show the SAME approver_id as before this script ran — this script
-- never writes to the approvals table, only to approval_workflow_steps and
-- the seed function, so that should already be guaranteed, but re-check
-- once, live, as this session's own working practice.
