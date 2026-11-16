-- READ ONLY. Run BEFORE applying 20270117000100_people_hr_employee_number_unique.sql. Changes nothing.
-- Expect: row 1 'OK'; row 2 'not installed yet' (or 'already installed' on a second run); row 3 'OK' (0 groups). Rows 4 to 6 are numbers for information.
-- Row 3 counts every pair of ACTIVE or INVITED employees (not removed, not terminated, login not deactivated; no login or an invited login counts) in any companies with equivalent numbers. Removed, terminated and
-- deactivated records are ignored. If it says STOP, do not apply the migration (it would refuse anyway and change nothing): run people_hr_employee_number_00_audit_readonly.sql, resolve each group with the owner's
-- approval, then run this again.
with e0 as (
  select upper(regexp_replace(coalesce(em.employee_number, ''), '\s+', '', 'g')) as s,
         (em.deleted_at is null and em.employment_status <> 'terminated'
          and not exists (select 1 from profiles p where p.id = em.user_id and p.account_status = 'deactivated')) as in_scope
  from employees em
),
e as (
  select in_scope, case when s !~ '[0-9]$' then s
              else regexp_replace(s, '[0-9]+$', '')
                   || case when length(ltrim(substring(s from '[0-9]+$'), '0')) >= 3 then ltrim(substring(s from '[0-9]+$'), '0')
                           else lpad(ltrim(substring(s from '[0-9]+$'), '0'), 3, '0') end end as k
  from e0
),
dup as (select count(*) as groups, coalesce(sum(n), 0) as people from (select count(*) as n from e where in_scope and k <> '' group by k having count(*) > 1) d),
top as (select coalesce(max(substring(k from '^E([0-9]+)$')::bigint), 0) as t from e where in_scope and k ~ '^E[0-9]{1,15}$')
select item, result from (
  select 1 as ord, 'the tables and columns this migration builds on exist (employees with company_id, user_id, employee_number, employment_status and deleted_at; profiles with account_status; the per-company unique index from migration 20261023000000)' as item,
         case when to_regclass('public.employees') is not null and to_regclass('public.profiles') is not null
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name in ('company_id', 'user_id', 'employee_number', 'employment_status', 'deleted_at')) = 5
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'account_status') = 1
                   and (to_regclass('public.employees_company_employee_number_unique') is not null or to_regclass('public.employee_number_reservations') is not null)
              then 'OK' else 'STOP - a prerequisite is missing; do not apply' end as result
  union all select 2, 'this migration is not installed yet (no employee_number_canonical function, reservations table or sequence)',
         case when to_regprocedure('public.employee_number_canonical(text)') is not null or to_regclass('public.employee_number_reservations') is not null or to_regclass('public.employee_number_seq') is not null
              then 'already installed (applying the file again is safe: it is re-runnable)' else 'not installed yet' end
  union all select 3, 'no two ACTIVE or INVITED employees, in any companies, have equivalent numbers (E02, e002 and E002 are one number); removed, terminated and deactivated records are ignored',
         case when (select groups from dup) = 0 then 'OK'
              else 'STOP - ' || (select groups from dup)::text || ' group(s) of equivalent numbers (' || (select people from dup)::text || ' employees): run the audit pack, resolve them, run this again' end
  union all select 4, 'information: active or invited employees (their numbers will be reserved for them)', (select count(*) from e where in_scope)::text
  union all select 5, 'information: records ignored (removed, terminated or deactivated login): they get no reservation and cannot block', (select count(*) from e where not in_scope)::text
  union all select 6, 'information: the first number the new series would give out (one above the highest E-number an active or invited employee holds)',
         (select 'E' || case when length((t + 1)::text) >= 3 then (t + 1)::text else lpad((t + 1)::text, 3, '0') end from top)
) x order by ord;
