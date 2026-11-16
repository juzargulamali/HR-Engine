-- READ ONLY. Run BEFORE applying 20270111000100_people_hr_phase1.sql. Changes nothing.
-- Expect: rows 1, 3 and 4 say 'OK'; row 2 says 'not installed yet' (or 'already installed' on a second run). Rows 5 and 6 are numbers for information.
-- If row 3 or 4 does not say OK, STOP: the migration would fail on the one-opening-balance index. Do not delete anything: decide with HR which row is the true opening balance.
select item, result from (
  select 1 as ord, 'the tables and helpers this migration builds on exist (career events, pay versions, both ledgers, employees, has_role)' as item,
         case when to_regclass('public.employee_career_events') is not null and to_regclass('public.compensation_details') is not null and to_regclass('public.leave_ledger') is not null
                   and to_regclass('public.comp_day_ledger') is not null and to_regclass('public.employees') is not null and to_regprocedure('public.has_role(app_role, uuid, text)') is not null
              then 'OK' else 'STOP - a prerequisite table or function is missing; do not apply' end as result
  union all select 2, 'this migration is not installed yet (no applied_at column, no record_employment_change function)',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employee_career_events' and column_name = 'applied_at')
                   or to_regprocedure('public.record_employment_change(uuid, date, text, numeric, numeric, text, date)') is not null then 'already installed' else 'not installed yet' end
  union all select 3, 'no employee has two opening-balance rows for the same leave type in leave_ledger (the new unique index would refuse them)',
         case when (select count(*) from (select employee_id, leave_type_code from leave_ledger where reference_type = 'opening_balance' group by 1, 2 having count(*) > 1) d) = 0
              then 'OK' else 'STOP - ' || (select count(*) from (select employee_id, leave_type_code from leave_ledger where reference_type = 'opening_balance' group by 1, 2 having count(*) > 1) d) || ' employee / leave type pair(s) have duplicates' end
  union all select 4, 'no employee has two opening comp-day rows in comp_day_ledger (the new unique index would refuse them)',
         case when (select count(*) from (select employee_id from comp_day_ledger where source = 'opening_balance' group by 1 having count(*) > 1) d) = 0
              then 'OK' else 'STOP - ' || (select count(*) from (select employee_id from comp_day_ledger where source = 'opening_balance' group by 1 having count(*) > 1) d) || ' employee(s) have duplicates' end
  union all select 5, 'information: career events on record (each will be marked applied at the time it was written)', (select count(*) from employee_career_events)::text
  union all select 6, 'information: employees with MORE than one current pay version (the new process keeps exactly one; existing rows are not changed)',
         (select count(*) from (select employee_id from compensation_details where is_current group by 1 having count(*) > 1) d)::text
) x order by ord;
