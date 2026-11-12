-- READ ONLY. Run BEFORE applying 20270103000100_departments_company_integrity.sql. Changes nothing.
-- Expect: row 1 'OK'; rows 2, 3 and 4 '0 - OK'; row 5 'not installed yet' (or 'already installed' on a second run); rows 6 and 7 are numbers for information.
-- If row 2, 3 or 4 is not 0 the migration will stop without installing anything. The three queries at the end of this file list the rows concerned.
select n, item, result from (
  select 1 as n, 'departments and employees exist' as item,
         case when to_regclass('public.departments') is not null and to_regclass('public.employees') is not null then 'OK' else 'STOP - the foundation migrations are missing' end as result
  union all select 2, 'employee records whose department belongs to another company (must be 0)',
         (select case when count(*) = 0 then '0 - OK' else count(*)::text || ' - RESOLVE FIRST (list A below)' end
            from employees e join departments d on d.id = e.department_id where d.company_id <> e.company_id)
  union all select 3, 'active department names used more than once in one company, ignoring capitals and all white space at the ends or repeated inside (must be 0)',
         (select case when count(*) = 0 then '0 - OK' else count(*)::text || ' - RESOLVE FIRST (list B below)' end
            from (select 1 from departments where deleted_at is null
                   group by company_id, lower(btrim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g'))) having count(*) > 1) x)
  union all select 4, 'active departments with a blank name, including one made only of spaces or tabs (must be 0)',
         (select case when count(*) = 0 then '0 - OK' else count(*)::text || ' - RESOLVE FIRST (list C below)' end
            from departments where deleted_at is null and btrim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g')) = '')
  union all select 5, 'employees_department_company_fkey (the composite foreign key)',
         case when exists (select 1 from pg_constraint where conname = 'employees_department_company_fkey') then 'already installed' else 'not installed yet' end
  union all select 6, 'INFO active departments', (select count(*)::text from departments where deleted_at is null)
  union all select 7, 'INFO employee records that have a department, and of those how many point at a removed department (allowed: they keep it until changed)',
         (select count(*)::text || ' / ' || count(*) filter (where d.deleted_at is not null)::text from employees e join departments d on d.id = e.department_id)
) x order by n;

-- List A (run only if row 2 is not 0): each employee record and the department it points at.
-- select e.id as employee_id, e.employee_number, ce.legal_name as employee_company, d.id as department_id, d.name as department, cd.legal_name as department_company
--   from employees e join departments d on d.id = e.department_id join companies ce on ce.id = e.company_id join companies cd on cd.id = d.company_id
--  where d.company_id <> e.company_id order by ce.legal_name, e.employee_number;

-- List B (run only if row 3 is not 0): the departments that share a name in one company, with how many employees each has.
-- select c.legal_name as company, d.id, d.name, d.created_at, (select count(*) from employees e where e.department_id = d.id) as employees
--   from departments d join companies c on c.id = d.company_id
--  where d.deleted_at is null and (d.company_id, lower(btrim(regexp_replace(coalesce(d.name, ''), '\s+', ' ', 'g')))) in (
--        select company_id, lower(btrim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g'))) from departments where deleted_at is null group by 1, 2 having count(*) > 1)
--  order by c.legal_name, lower(d.name), d.created_at;

-- List C (run only if row 4 is not 0): active departments with a blank name.
-- select c.legal_name as company, d.id, d.created_at, (select count(*) from employees e where e.department_id = d.id) as employees
--   from departments d join companies c on c.id = d.company_id where d.deleted_at is null and btrim(regexp_replace(coalesce(d.name, ''), '\s+', ' ', 'g')) = '' order by c.legal_name, d.created_at;
