-- Phase 1 hardening (E — Deletion and retention): permanently_delete_employee()
-- used to cascade-delete every dependent row (attendance, leave, ledgers,
-- appraisals, documents, etc.) once an employee was already soft-deleted.
-- That silently destroyed real business history with a single HR Admin
-- click. It now BLOCKS the whole delete (nothing removed, not even
-- partially) whenever any real history exists, and names every blocking
-- category in the error so the caller knows exactly what's in the way.
-- Permanent delete is now only usable for a genuinely empty record — a
-- mistaken or duplicate entry — never a way to erase activity. Historical
-- records that need to go away belong to a real archival/retention policy,
-- not this function.
--
-- employment_contracts/compensation_details stay excluded from the blocker
-- list and are still deleted unconditionally: every employee gets exactly
-- one of each at creation (see createEmployee()), so they're part of the
-- employee's own record, not downstream history. employee_checklist_items
-- (onboarding/offboarding to-dos) is the same — harmless scaffolding,
-- cleaned up silently rather than blocked on.
--
-- Function signature is unchanged (permanently_delete_employee(uuid) returns
-- void), so the calling Server Action (permanentlyDeleteEmployee in
-- apps/web/src/lib/actions/employees.ts) needs no changes — it already
-- surfaces error.message to the UI.
create or replace function permanently_delete_employee(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_deleted_at timestamptz;
  v_blockers text[] := '{}';
  v_count bigint;
begin
  select company_id, deleted_at into v_company_id, v_deleted_at
  from employees where id = p_employee_id;

  if v_company_id is null then
    raise exception 'Employee not found';
  end if;

  if auth.uid() is null or not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may permanently delete an employee';
  end if;

  if v_deleted_at is null then
    raise exception 'Remove the employee first — permanent delete is only available for an already-removed employee';
  end if;

  select count(*) into v_count from attendance_records where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s attendance record(s)', v_count); end if;

  select count(*) into v_count from leave_requests where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s leave request(s)', v_count); end if;

  select count(*) into v_count from leave_ledger where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s leave ledger entr%s', v_count, case when v_count = 1 then 'y' else 'ies' end); end if;

  select count(*) into v_count from comp_day_ledger where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s comp-day ledger entr%s', v_count, case when v_count = 1 then 'y' else 'ies' end); end if;

  select count(*) into v_count from reimbursement_claims where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s reimbursement claim(s)', v_count); end if;

  select count(*) into v_count from project_allocations where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s project allocation(s)', v_count); end if;

  select count(*) into v_count from timesheets where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s timesheet(s)', v_count); end if;

  select count(*) into v_count from goals where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s performance goal(s)', v_count); end if;

  select count(*) into v_count from appraisals where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s appraisal(s)', v_count); end if;

  select count(*) into v_count from payroll_export_lines where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s payroll export line(s)', v_count); end if;

  select count(*) into v_count from generated_letters where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s generated letter(s)', v_count); end if;

  select count(*) into v_count from employee_career_events where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s career event(s) (promotion/salary history)', v_count); end if;

  select count(*) into v_count from asset_assignments where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s asset assignment(s)', v_count); end if;

  select count(*) into v_count from employee_documents where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s document(s)', v_count); end if;

  select count(*) into v_count from identity_documents where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s identity document(s)', v_count); end if;

  select count(*) into v_count from employee_insurance_policies where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s insurance polic%s', v_count, case when v_count = 1 then 'y' else 'ies' end); end if;

  select count(*) into v_count from employee_loans where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s loan(s)', v_count); end if;

  -- approvals is polymorphic (entity_type/entity_id, no FK) — checked via
  -- the same source tables above, since an approval can only exist for an
  -- entity that still exists.
  select count(*) into v_count
  from approvals a
  where (a.entity_type = 'leave_request' and exists (select 1 from leave_requests r where r.id = a.entity_id and r.employee_id = p_employee_id))
     or (a.entity_type = 'reimbursement_claim' and exists (select 1 from reimbursement_claims c where c.id = a.entity_id and c.employee_id = p_employee_id))
     or (a.entity_type = 'timesheet' and exists (select 1 from timesheets t where t.id = a.entity_id and t.employee_id = p_employee_id))
     or (a.entity_type = 'generated_letter' and exists (select 1 from generated_letters l where l.id = a.entity_id and l.employee_id = p_employee_id));
  if v_count > 0 then v_blockers := v_blockers || format('%s approval record(s)', v_count); end if;

  if array_length(v_blockers, 1) > 0 then
    raise exception 'Cannot permanently delete: this employee has real history — %. Permanent delete is only for a mistaken or duplicate record with no activity; use Remove (soft delete) instead.', array_to_string(v_blockers, ', ');
  end if;

  -- No blocking history — safe to remove. Every table checked above is
  -- now guaranteed empty for this employee; only the two deliberately
  -- unchecked categories (contracts/compensation, which every employee
  -- has) and the harmless checklist scaffolding still need cleaning up.
  update employees set manager_id = null where manager_id = p_employee_id;
  delete from employee_checklist_items where employee_id = p_employee_id;
  delete from compensation_details where employee_id = p_employee_id;
  delete from employment_contracts where employee_id = p_employee_id;
  delete from employees where id = p_employee_id;
end;
$$;
