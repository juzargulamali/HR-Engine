-- Fixes a gap that has blocked every real attempt to issue a letter or
-- submit a payroll export requiring approval since Phase 6:
-- is_entity_owner()'s case statement only ever handled
-- leave_request/reimbursement_claim/timesheet, so approvals_insert_initial's
-- with-check silently rejected every generated_letter/payroll_export_run
-- row with "new row violates row-level security policy for table
-- 'approvals'". The RLS test suite never caught it because every fixture
-- for those two entity types inserted straight via the trusted test
-- connection, never through the real user-scoped RLS path the app
-- actually uses.
--
-- Neither entity has an "owner" employee the way a leave request does —
-- both are staff-initiated on someone/something else's behalf (an HR Admin
-- issuing someone else's letter, Finance generating a payroll run) — so
-- the rightful initiator is generated_by instead.
create or replace function is_entity_owner(p_entity_type approvable_entity, p_entity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  case p_entity_type
    when 'leave_request' then
      return exists (select 1 from leave_requests where id = p_entity_id and employee_id = current_employee_id());
    when 'reimbursement_claim' then
      return exists (select 1 from reimbursement_claims where id = p_entity_id and employee_id = current_employee_id());
    when 'timesheet' then
      return exists (select 1 from timesheets where id = p_entity_id and employee_id = current_employee_id());
    when 'generated_letter' then
      return exists (select 1 from generated_letters where id = p_entity_id and generated_by = auth.uid());
    when 'payroll_export_run' then
      return exists (select 1 from payroll_export_runs where id = p_entity_id and generated_by = auth.uid());
    else
      return false;
  end case;
end;
$$;
