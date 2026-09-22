-- timesheets was the only approvable entity type never wired into the
-- audit log: every status transition (submit, approve, reject) went
-- completely uncaptured, both because no trigger existed on the table and
-- because 'timesheets' was missing from audit_log_select_hr's own
-- allowlist (so even a trigger alone wouldn't have made it visible to HR
-- Admin). write_audit_log()'s existing company_id resolution already
-- handles this table correctly via its generic `v_row ? 'employee_id'`
-- branch — timesheets carries employee_id, same as leave_requests — so no
-- change to that function is needed, only the trigger and the policy.
create trigger audit_timesheets after insert or update or delete on timesheets
  for each row execute function write_audit_log();

drop policy audit_log_select_hr on audit_log;

create policy audit_log_select_hr on audit_log for select
  using (
    table_name in (
      'employees', 'compensation_details', 'employment_contracts', 'leave_requests', 'leave_ledger',
      'comp_day_ledger', 'approvals', 'reimbursement_claims', 'timesheets', 'payroll_export_runs', 'generated_letters'
    )
    and company_id is not null
    and has_role('hr_admin', company_id)
  );
