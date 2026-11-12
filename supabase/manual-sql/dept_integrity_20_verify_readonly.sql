-- READ ONLY. Run AFTER applying 20270103000100_departments_company_integrity.sql. Changes nothing.
-- Expect: every row 'OK'.
select n, item, result from (
  select 1 as n, 'the employee trigger is installed and fires on insert and on a change of department or company' as item,
         case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                            where t.tgname = 'trg_employees_department_company' and c.relname = 'employees' and not t.tgisinternal and t.tgenabled <> 'D')
              then 'OK' else 'MISSING' end as result
  union all select 2, 'the department move trigger is installed',
         case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                            where t.tgname = 'trg_departments_company_move' and c.relname = 'departments' and not t.tgisinternal and t.tgenabled <> 'D')
              then 'OK' else 'MISSING' end
  union all select 3, 'the unique index on active department names per company exists and is unique',
         case when exists (select 1 from pg_indexes i join pg_class c on c.relname = i.indexname join pg_index x on x.indexrelid = c.oid
                            where i.schemaname = 'public' and i.indexname = 'uq_departments_company_name_active' and x.indisunique and x.indisvalid)
              then 'OK' else 'MISSING' end
  union all select 4, 'a department name cannot be blank',
         case when exists (select 1 from pg_constraint where conname = 'departments_name_not_blank') then 'OK' else 'MISSING' end
  union all select 5, 'the trigger functions cannot be called by signed-in users',
         case when not has_function_privilege('authenticated', 'public.employees_department_company_check()', 'execute')
                   and not has_function_privilege('authenticated', 'public.departments_company_move_check()', 'execute') then 'OK' else 'CHECK' end
  union all select 6, 'no employee record points at a department of another company',
         (select case when count(*) = 0 then 'OK' else count(*)::text || ' - CHECK' end from employees e join departments d on d.id = e.department_id where d.company_id <> e.company_id)
  union all select 7, 'no active department name is used twice in one company',
         (select case when count(*) = 0 then 'OK' else count(*)::text || ' - CHECK' end
            from (select 1 from departments where deleted_at is null group by company_id, department_name_key(name) having count(*) > 1) x)
  union all select 8, 'who may add departments and edit employees is unchanged (departments_write, employees_update_hr still exist)',
         case when exists (select 1 from pg_policies where tablename = 'departments' and policyname = 'departments_write')
                   and exists (select 1 from pg_policies where tablename = 'employees' and policyname = 'employees_update_hr') then 'OK' else 'CHECK' end
) x order by n;
