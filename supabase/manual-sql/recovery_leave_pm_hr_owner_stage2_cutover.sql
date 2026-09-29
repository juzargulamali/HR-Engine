-- Recovery Leave routing change, Stage 2 of 2 — THE CUTOVER.
--
-- DELIBERATELY NOT in supabase/migrations/ and NOT run by the local
-- Postgres test bootstrap or CI. This file only changes live routing
-- behavior once YOU run it manually in the Supabase SQL Editor, after
-- Stage 1 (supabase/migrations/20261106000000_recovery_leave_pm_hr_owner_stage1.sql)
-- has been applied and deployed, and after you have confirmed readiness —
-- see "Before you run this" below. Running it before that check will
-- immediately hard-stop new Recovery Leave requests for anyone whose
-- selected project/employee has no manager_id/hr_owner_id assigned yet
-- (create_initial_approval() already raises a clear
-- "No approver could be resolved" error rather than silently creating an
-- unroutable approval — this is intentional, not a bug, but it will block
-- real attendance saves until fixed).
--
-- What this does: activates a NEW recovery_credit workflow (project_manager
-- -> hr_owner) per company and retires the OLD one (direct_manager ->
-- role:hr_admin), by INSERTING a new approval_workflows row and flipping
-- is_active, rather than UPDATING the existing approval_workflow_steps rows
-- in place. This matters for one specific case: a request already pending
-- at step 1 the moment this runs. Its approvals row already carries the
-- OLD workflow_id (captured at creation, per decide_leave_approval()'s own
-- "approver_id/workflow_id are never recomputed" design) — when that step 1
-- is later decided, the function looks up the NEXT step by THAT workflow_id,
-- so it keeps resolving through the ORIGINAL direct_manager/role:hr_admin
-- rule, never the new one, with no special-case code needed. An in-place
-- UPDATE of approval_workflow_steps would have silently rewritten that
-- request's own step 2 rule out from under it. Ordinary leave,
-- reimbursements, timesheets, letters, and payroll export are all
-- UNCHANGED — this only ever touches entity_type = 'recovery_credit'.
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
-- fixed; it will never silently misroute them. Also worth checking before
-- you run this — any request currently pending at step 1:
--
--   select id, entity_id, step_order, workflow_id from approvals
--   where entity_type = 'recovery_credit' and decision = 'pending' and step_order = 1;
--
-- These are the requests this cutover is specifically designed not to
-- disturb — see the Verification section below for confirming that held.
--
-- ======================================================================
-- The cutover
-- ======================================================================

-- 1. Capture exactly which workflows are being retired, BEFORE creating
--    anything — used below both to seed the new versions (one per company
--    that has an active recovery_credit workflow today) and to retire
--    precisely those rows afterward, never anything freshly inserted by
--    this same script.
create temporary table _old_recovery_workflows as
select id, company_id from approval_workflows
where entity_type = 'recovery_credit' and is_active = true;

-- 2. Existing companies: activate a NEW workflow version (project_manager,
--    then hr_owner) for each one that had an active recovery_credit
--    workflow. The OLD workflow row, and its own approval_workflow_steps
--    rows, are left completely untouched — any approval still referencing
--    the old workflow_id keeps advancing through direct_manager/
--    role:hr_admin exactly as it always would have.
with new_workflows as (
  insert into approval_workflows (company_id, entity_type, name, is_active)
  select company_id, 'recovery_credit', 'Recovery Leave earning approval (Project Manager, then HR Owner)', true
  from _old_recovery_workflows
  returning id, company_id
)
insert into approval_workflow_steps (workflow_id, step_order, approver_type)
select id, 1, 'project_manager' from new_workflows
union all
select id, 2, 'hr_owner' from new_workflows;

-- 3. Retire exactly the captured OLD workflows (never the new ones this
--    script just created) — create_initial_approval()'s own
--    "where is_active = true order by created_at asc limit 1" lookup then
--    only ever finds the new version for any FUTURE request.
update approval_workflows set is_active = false where id in (select id from _old_recovery_workflows);

drop table _old_recovery_workflows;

-- 4. Future companies: seed_default_approval_workflows() should seed the
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
--   select aw.company_id, aws.step_order, aws.approver_type, aw.is_active
--   from approval_workflow_steps aws
--   join approval_workflows aw on aw.id = aws.workflow_id
--   where aw.entity_type = 'recovery_credit' and aw.is_active = true
--   order by aw.company_id, aws.step_order;
--
-- Expect step_order=1 -> 'project_manager', step_order=2 -> 'hr_owner' for
-- every ACTIVE row, and exactly one active recovery_credit workflow per
-- company. Existing pending recovery_credit approvals (check with:
--   select id, entity_id, step_order, approver_id, workflow_id, decision from approvals
--   where entity_type = 'recovery_credit' and decision = 'pending';
-- ) must show the SAME approver_id, and the SAME (now-inactive) workflow_id,
-- as before this script ran — this script never writes to the approvals
-- table, only to approval_workflows/approval_workflow_steps and the seed
-- function, so that should already be guaranteed, but re-check once, live,
-- as this session's own working practice. If you captured the
-- "pending at step 1" list from the readiness check above, confirm each of
-- those rows' workflow_id still points at an is_active = false workflow
-- whose own steps are still direct_manager (step 1) / role:hr_admin
-- (step 2) — proving this cutover left their routing untouched.
