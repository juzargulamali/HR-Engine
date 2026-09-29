-- Recovery Leave redesign, Stage 2 of 2 — THE CUTOVER.
--
-- DELIBERATELY NOT in supabase/migrations/ and NOT run by the local
-- Postgres test bootstrap or CI. Run this by hand in the Supabase SQL
-- Editor, after Stage 1
-- (supabase/migrations/20261106000000_recovery_leave_jibble_hr_queue_stage1.sql)
-- has been applied AND deployed together with its app code — the Jibble
-- import and the HR correction/decision UI must both be live before you
-- cut over, since the OLD 2-step routing (direct_manager -> role:hr_admin)
-- has no such UI at all.
--
-- What this does: activates a NEW recovery_credit workflow (a single
-- 'role_queue:hr_admin' step — any current HR Admin in the company may
-- decide it) per company, and retires the OLD one (whatever your
-- production database's recovery_credit workflow currently is — most
-- likely still the very original direct_manager -> role:hr_admin, since
-- neither the Project-Manager/HR-owner design PR #16 first proposed nor
-- this one has been applied here before), by INSERTING a new
-- approval_workflows row and flipping is_active, rather than UPDATING the
-- existing approval_workflow_steps rows in place.
--
-- This matters for one specific case: a request already pending at step 1
-- the moment this runs. Its approvals row already carries the OLD
-- workflow_id (captured at creation, never recomputed) — when that step 1
-- is later decided, decide_leave_approval() looks up the NEXT step by THAT
-- workflow_id, so it keeps resolving through the ORIGINAL workflow's own
-- step 2 rule, never the new one, with no special-case code needed. An
-- in-place UPDATE of approval_workflow_steps would have silently rewritten
-- that request's own next-step rule out from under it. Ordinary leave,
-- reimbursements, timesheets, letters, and payroll export are all
-- UNCHANGED — this only ever touches entity_type = 'recovery_credit'.
--
-- ======================================================================
-- Before you run this — readiness check (read-only, safe to run any time)
-- ======================================================================
--
-- 1. Every employee who might earn a Recovery Leave credit via Jibble
--    should have a jibble_person_id mapped (Employee -> edit profile) —
--    otherwise their imported entries land in jibble_time_entries flagged
--    needs_review instead of producing a request. Not required before
--    cutover (mapping can continue afterward), but worth doing first:
--
--   select id, employee_number, first_name, last_name, company_id
--   from employees
--   where deleted_at is null and employment_status <> 'terminated'
--     and jibble_person_id is null;
--
-- 2. Every company you're cutting over should currently have at least one
--    active hr_admin — role_queue:hr_admin hard-stops NEW requests
--    (create_initial_approval() raises "No approver could be resolved")
--    for any company with zero:
--
--   select c.id, c.name
--   from companies c
--   where not exists (
--     select 1 from user_roles ur
--     where ur.role = 'hr_admin' and ur.revoked_at is null
--       and (ur.company_id is null or ur.company_id = c.id)
--   );
--
-- 3. Capture every request currently pending at step 1 — these are the
--    ones this cutover is specifically designed not to disturb (see the
--    Verification section below for confirming that held):
--
--   select id, entity_id, step_order, workflow_id from approvals
--   where entity_type = 'recovery_credit' and decision = 'pending' and step_order = 1;
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

-- 2. Existing companies: activate a NEW workflow version (a single
--    role_queue:hr_admin step) for each one that had an active
--    recovery_credit workflow. The OLD workflow row, and its own
--    approval_workflow_steps rows, are left completely untouched — any
--    approval still referencing the old workflow_id keeps advancing
--    through its ORIGINAL rule exactly as it always would have.
with new_workflows as (
  insert into approval_workflows (company_id, entity_type, name, is_active)
  select company_id, 'recovery_credit', 'Recovery Leave earning approval (HR)', true
  from _old_recovery_workflows
  returning id, company_id
)
insert into approval_workflow_steps (workflow_id, step_order, approver_type)
select id, 1, 'role_queue:hr_admin' from new_workflows;

-- 3. Retire exactly the captured OLD workflows (never the new ones this
--    script just created) — create_initial_approval()'s own
--    "where is_active = true order by created_at asc limit 1" lookup then
--    only ever finds the new version for any FUTURE request.
update approval_workflows set is_active = false where id in (select id from _old_recovery_workflows);

drop table _old_recovery_workflows;

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
-- Expect exactly one active recovery_credit workflow per company, with a
-- single step_order = 1, approver_type = 'role_queue:hr_admin'.
--
--   select id, entity_id, step_order, approver_id, workflow_id, decision from approvals
--   where entity_type = 'recovery_credit' and decision = 'pending';
--
-- Every existing pending row's approver_id AND workflow_id must be
-- UNCHANGED from before this script ran — this script never writes to the
-- approvals table, only to approval_workflows/approval_workflow_steps, so
-- that should already be guaranteed, but re-check once, live, as this
-- session's own working practice. If you captured the "pending at step 1"
-- list from the readiness check above, confirm each of those rows'
-- workflow_id still points at an is_active = false workflow whose own
-- steps are still exactly what they were before this cutover ran.
--
-- ======================================================================
-- Stop conditions — do NOT run this cutover if:
-- ======================================================================
--
--   - Stage 1's migration has not been applied to this database yet
--     (role_queue:hr_admin/import_jibble_time_entry/decide_recovery_credit_request
--     etc. won't exist — every new-workflow lookup above and every future
--     recovery_credit approval would fail outright).
--   - The app-code deploy that ships the HR queue/correction UI has not
--     gone out yet — HR would have no way to decide a role_queue approval
--     at all (the /approvals page's own "Approve"/"Reject" buttons for
--     Recovery Leave must be calling decide_recovery_credit_request(),
--     not the old bare decide_leave_approval()).
--   - Readiness check 2 above shows any company with zero active
--     hr_admin — fix that first, or accept Recovery Leave will hard-stop
--     for that company's new requests until it's fixed (it will never
--     silently misroute them either way).
--
-- Rollback: this script only ever INSERTS new approval_workflows/
-- approval_workflow_steps rows and flips is_active on the OLD ones — it
-- never deletes or edits an existing row's own columns. To roll back,
-- re-activate the old workflow and retire the new one:
--
--   update approval_workflows set is_active = true
--   where entity_type = 'recovery_credit' and is_active = false
--     and created_at < (select min(created_at) from approval_workflows where entity_type = 'recovery_credit' and is_active = true and company_id = approval_workflows.company_id);
--
--   update approval_workflows set is_active = false
--   where entity_type = 'recovery_credit'
--     and id not in (select id from approval_workflows aw2 where aw2.entity_type = 'recovery_credit' and aw2.is_active = false);
--
-- (Simplest and safest in practice: identify the two workflow_ids per
-- company from the verification query above BEFORE rolling back, and flip
-- is_active by id explicitly rather than relying on a derived query against
-- data that has already changed.) Any recovery_credit_requests row created
-- under the new role_queue step while it was active keeps its own history
-- either way — rolling back never deletes a request or an approval, only
-- changes which workflow template NEW requests resolve against.
