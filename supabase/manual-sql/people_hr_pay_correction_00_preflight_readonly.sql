-- READ ONLY. Run BEFORE applying 20270118000200_people_hr_pay_correction.sql. Changes nothing.
-- Expect: row 1 says 'OK'; row 2 says 'not installed yet' (or 'already installed' on a second run); rows 3 to 6 are numbers for information.
-- If row 1 does not say OK, STOP: the migration would fail or point at something that is not there (most likely People & HR Phase 1, 20270115000100, is not applied yet). Do not apply it.
select item, result from (
  select 1 as ord, 'the tables, columns and helpers this migration builds on exist (employees, pay records with an effective date, scheduled changes with applied / cancelled / held markers and the pay version they were based on, approved payroll runs and lines, the settlement input table, has_role, write_audit_log, and the Phase 1 employee lock and business-date helper)' as item,
         case when to_regclass('public.employees') is not null and to_regclass('public.companies') is not null and to_regclass('auth.users') is not null
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compensation_details' and column_name in ('id', 'employee_id', 'effective_from', 'effective_to', 'base_salary', 'allowances', 'currency', 'is_current', 'created_at')) = 9
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employee_career_events' and column_name in ('applied_at', 'dismissed_at', 'conflict_at', 'base_compensation_id', 'new_base_salary', 'effective_date')) = 6
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'payroll_export_runs' and column_name in ('company_id', 'period_month', 'period_year', 'status', 'sent_at')) = 5
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'payroll_export_lines' and column_name in ('run_id', 'employee_id', 'component_code')) = 3
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name in ('hire_date', 'termination_date', 'employment_status', 'deleted_at', 'country_code', 'company_id')) = 6
                   and to_regclass('public.termination_settlement_inputs') is not null
                   and to_regprocedure('public.has_role(app_role, uuid, text)') is not null and to_regprocedure('public.write_audit_log()') is not null
                   and to_regprocedure('public._hr_lock_employee(uuid)') is not null and to_regprocedure('public.hr_business_today(text)') is not null
              then 'OK' else 'STOP - a prerequisite table, column or function is missing (People & HR Phase 1 must be applied first); do not apply' end as result
  union all select 2, 'this migration is not installed yet (no compensation_corrections table, no correct_pay_record function)',
         case when to_regclass('public.compensation_corrections') is not null or to_regprocedure('public.correct_pay_record(uuid, date, numeric, jsonb, text, text)') is not null
              then 'already installed (applying the migration file again is safe: it is re-runnable)' else 'not installed yet' end
  union all select 3, 'information: employees whose only pay record is dated exactly their hire date (the usual place a wrongly dated opening pay record sits)',
         (select count(*) from (select c.employee_id from compensation_details c join employees e on e.id = c.employee_id where e.deleted_at is null
                                group by c.employee_id, e.hire_date having count(*) = 1 and min(c.effective_from) = e.hire_date) x)::text
  union all select 4, 'information: employees with two pay records that start on the same day (the correction refuses a date that would match another record, so these are the cases to look at by hand)',
         (select count(*) from (select employee_id from compensation_details group by employee_id, effective_from having count(*) > 1) x)::text
  union all select 5, 'information: scheduled or held pay changes not yet applied or cancelled (a correction that changes the amount of the record such a change was based on is refused until it is cancelled)',
         (select count(*) from employee_career_events where applied_at is null and dismissed_at is null and new_base_salary is not null)::text
  union all select 6, 'information: approved payroll runs on record (a correction lists the ones that carry a salary line for the person and overlap the record''s period; it never changes them)',
         (select count(*) from payroll_export_runs where status = 'approved')::text
) x order by ord;
