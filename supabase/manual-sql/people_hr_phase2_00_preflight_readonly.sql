-- READ ONLY. Run BEFORE applying 20270116000100_people_hr_phase2_queue.sql. Changes nothing.
-- Expect: row 1 says 'OK'; row 2 says 'not installed yet' (or 'already installed' on a second run); row 3 says 'OK'; rows 4 and 5 are numbers for information.
-- If row 1 or 3 does not say OK, STOP: the migration would fail or point at something that is not there. Do not apply it.
select item, result from (
  select 1 as ord, 'the tables, columns and helpers this migration builds on exist (employees, current contracts with end and probation dates, employee and identity documents with expiry dates, attendance_records.presence_conflict, recovery_windows verification columns, has_role, write_audit_log)' as item,
         case when to_regclass('public.employees') is not null and to_regclass('public.companies') is not null
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employment_contracts' and column_name in ('is_current', 'end_date', 'probation_end_date', 'employee_id')) = 4
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employee_documents' and column_name in ('expiry_date', 'deleted_at', 'employee_id')) = 3
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'identity_documents' and column_name in ('expiry_date', 'employee_id')) = 2
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'attendance_records' and column_name in ('work_date', 'presence_conflict', 'employee_id')) = 3
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'recovery_windows' and column_name in ('starting_local_date', 'hr_verification_required', 'hr_verified_at', 'employee_id')) = 4
                   and to_regprocedure('public.has_role(app_role, uuid, text)') is not null and to_regprocedure('public.write_audit_log()') is not null
              then 'OK' else 'STOP - a prerequisite table, column or function is missing; do not apply' end as result
  union all select 2, 'this migration is not installed yet (no hr_queue_acknowledgements table, no acknowledge_hr_queue_item function)',
         case when to_regclass('public.hr_queue_acknowledgements') is not null or to_regprocedure('public.acknowledge_hr_queue_item(text, uuid, date, text)') is not null
              then 'already installed (applying the migration file again is safe: it is re-runnable)' else 'not installed yet' end
  union all select 3, 'the Recovery Leave alert acknowledgement the queue keeps using is installed (acknowledge_recovery_alert)',
         case when to_regprocedure('public.acknowledge_recovery_alert(uuid, text)') is not null then 'OK' else 'STOP - Recovery Leave alerts are not installed; do not apply' end
  union all select 4, 'information: current contracts ending or with probation ending within 30 days (what the queue will list for contracts and probation)',
         (select count(*) from employment_contracts where is_current and (end_date <= current_date + 30 or probation_end_date <= current_date + 30))::text
  union all select 5, 'information: attendance days where a manual entry and the clock records differ in the last 60 days (what the queue will list as attendance exceptions)',
         (select count(*) from attendance_records where presence_conflict is not null and work_date >= current_date - 60)::text
) x order by ord;
