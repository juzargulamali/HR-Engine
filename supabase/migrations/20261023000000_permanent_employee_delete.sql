-- 1. Employee numbers become reusable once an employee is soft-deleted.
-- The plain (company_id, employee_number) unique constraint blocked
-- reissuing a departed employee's number to a new hire forever, even
-- though the old row was already hidden from every active list — replaced
-- with a partial index that only enforces uniqueness among live rows.
alter table employees drop constraint if exists employees_company_id_employee_number_key;

create unique index employees_company_employee_number_unique
  on employees(company_id, employee_number) where deleted_at is null;

-- 2. permanently_delete_employee(): a genuine hard delete for an employee
-- already soft-deleted, cascading through every table that references
-- employees(id) (see the function body — schema.sql carries the full
-- rationale). Deliberately leaves audit_log, Storage objects, and
-- auth.users/user_roles untouched (see comments above the function in
-- schema.sql). HR Admin only; SECURITY DEFINER since most tables touched
-- have no DELETE policy for anyone — this function's own has_role() check
-- is the only gate.
create or replace function permanently_delete_employee(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_deleted_at timestamptz;
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

  update employees set manager_id = null where manager_id = p_employee_id;

  delete from approvals a using leave_requests r
    where a.entity_type = 'leave_request' and a.entity_id = r.id and r.employee_id = p_employee_id;
  delete from approvals a using reimbursement_claims c
    where a.entity_type = 'reimbursement_claim' and a.entity_id = c.id and c.employee_id = p_employee_id;
  delete from approvals a using timesheets t
    where a.entity_type = 'timesheet' and a.entity_id = t.id and t.employee_id = p_employee_id;
  delete from approvals a using generated_letters l
    where a.entity_type = 'generated_letter' and a.entity_id = l.id and l.employee_id = p_employee_id;

  delete from document_expiry_reminders_sent d using employee_documents ed
    where d.employee_document_id = ed.id and ed.employee_id = p_employee_id;

  delete from employee_documents where employee_id = p_employee_id;
  delete from asset_assignments where employee_id = p_employee_id;
  delete from employee_checklist_items where employee_id = p_employee_id;
  delete from generated_letters where employee_id = p_employee_id;
  delete from appraisals where employee_id = p_employee_id;
  delete from goals where employee_id = p_employee_id;
  delete from timesheets where employee_id = p_employee_id;
  delete from attendance_records where employee_id = p_employee_id;
  delete from reimbursement_claims where employee_id = p_employee_id;
  delete from project_allocations where employee_id = p_employee_id;
  delete from comp_day_ledger where employee_id = p_employee_id;
  delete from leave_ledger where employee_id = p_employee_id;
  delete from leave_requests where employee_id = p_employee_id;
  delete from employee_insurance_policies where employee_id = p_employee_id;
  delete from identity_documents where employee_id = p_employee_id;
  delete from employee_loans where employee_id = p_employee_id;
  delete from employee_career_events where employee_id = p_employee_id;
  delete from compensation_details where employee_id = p_employee_id;
  delete from employment_contracts where employee_id = p_employee_id;
  delete from payroll_export_lines where employee_id = p_employee_id;

  delete from employees where id = p_employee_id;
end;
$$;
