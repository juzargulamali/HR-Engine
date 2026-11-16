-- READ ONLY. Run BEFORE applying 20270117000100_people_hr_employee_number_unique.sql. Changes nothing.
-- Expect: row 1 'OK'; row 2 'not installed yet' (or 'already installed' on a second run); row 3 'OK' (0 groups). Rows 4 to 6 are numbers for information.
-- If row 3 says STOP, do not apply the migration (it would refuse anyway and change nothing): run people_hr_employee_number_00_audit_readonly.sql, resolve each group with the owner's approval, then run this again.
with allrows as (
  select upper(regexp_replace(coalesce(employee_number, ''), '\s+', '', 'g')) as s, deleted_at from employees
),
keyed_all as (
  select deleted_at, case when s !~ '[0-9]$' then s
              else regexp_replace(s, '[0-9]+$', '')
                   || case when length(ltrim(substring(s from '[0-9]+$'), '0')) >= 3 then ltrim(substring(s from '[0-9]+$'), '0')
                           else lpad(ltrim(substring(s from '[0-9]+$'), '0'), 3, '0') end end as k
  from allrows
),
dup as (select count(*) as groups from (select 1 from keyed_all where deleted_at is null group by k having count(*) > 1) d),
top as (select coalesce(max(substring(k from '^E([0-9]+)$')::bigint), 0) as t from keyed_all where k ~ '^E[0-9]{1,15}$')
select item, result from (
  select 1 as ord, 'the tables and columns this migration builds on exist (employees with company_id, employee_number and deleted_at; the per-company unique index from migration 20261023000000)' as item,
         case when to_regclass('public.employees') is not null
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name in ('company_id', 'employee_number', 'deleted_at')) = 3
                   and (to_regclass('public.employees_company_employee_number_unique') is not null or to_regclass('public.employees_employee_number_canonical_unique') is not null)
              then 'OK' else 'STOP - a prerequisite is missing; do not apply' end as result
  union all select 2, 'this migration is not installed yet (no employee_number_canonical function, no sequence, no global normalised unique index)',
         case when to_regprocedure('public.employee_number_canonical(text)') is not null or to_regclass('public.employee_number_seq') is not null or to_regclass('public.employees_employee_number_canonical_unique') is not null
              then 'already installed (applying the file again is safe: it is re-runnable)' else 'not installed yet' end
  union all select 3, 'no two LIVE employees, in any companies, have equivalent numbers (E02, e002 and E002 are one number); removed employees are not counted',
         case when (select groups from dup) = 0 then 'OK'
              else 'STOP - ' || (select groups from dup)::text || ' group(s) of equivalent numbers: run the audit pack, resolve them, run this again' end
  union all select 4, 'information: employees in all companies, including terminated and removed', (select count(*) from employees)::text
  union all select 5, 'information: removed employees (their numbers may be reused by hand, are never given out again by the sequence, and never block)', (select count(*) from employees where deleted_at is not null)::text
  union all select 6, 'information: the first number the new series would give out (one above the highest E-number held by ANY employee, removed included)',
         (select 'E' || case when length((t + 1)::text) >= 3 then (t + 1)::text else lpad((t + 1)::text, 3, '0') end from top)
) x order by ord;
