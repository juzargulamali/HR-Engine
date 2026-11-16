-- READ ONLY. Run AFTER 20270117000100_people_hr_employee_number_unique.sql. Every row must say OK. Creates no row and uses no number from the series.
-- A row that says FAIL usually means the migration did not finish: apply the migration file again (it is re-runnable) and run this again.
select item, result from (
  select 1 as ord, 'employee_number_canonical exists, is immutable, and gives E002 for E02, e002, E002, E2 and " e 0002 ", E1234 for E01234, L-001 for L-1 and keeps a number with no trailing digits (CONTRACTOR) as it is, upper-cased' as item,
         case when to_regprocedure('public.employee_number_canonical(text)') is not null
                   and (select provolatile = 'i' from pg_proc where oid = 'public.employee_number_canonical(text)'::regprocedure)
                   and employee_number_canonical('E02') = 'E002' and employee_number_canonical('e002') = 'E002' and employee_number_canonical('E002') = 'E002'
                   and employee_number_canonical('E2') = 'E002' and employee_number_canonical(' e 0002 ') = 'E002' and employee_number_canonical('E01234') = 'E1234'
                   and employee_number_canonical('L-1') = 'L-001' and employee_number_canonical('contractor') = 'CONTRACTOR' and employee_number_canonical('E0') = 'E000'
              then 'OK' else 'FAIL - the function is missing, not immutable, or answers differently' end as result
  union all select 2, 'the reservations table exists with the normalised number as its primary key, row level security is on, and signed-in users and anon have no right to read or write it',
         case when to_regclass('public.employee_number_reservations') is not null
                   and exists (select 1 from pg_index i where i.indrelid = 'public.employee_number_reservations'::regclass and i.indisprimary
                                and (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'number_key')
                   and (select relrowsecurity from pg_class where oid = 'public.employee_number_reservations'::regclass)
                   and not has_table_privilege('authenticated', 'public.employee_number_reservations', 'select')
                   and not has_table_privilege('authenticated', 'public.employee_number_reservations', 'insert')
                   and not has_table_privilege('anon', 'public.employee_number_reservations', 'select')
              then 'OK' else 'FAIL - the table is missing, has no key, is open, or is readable by signed-in users' end
  union all select 3, 'the trigger that numbers a new hire, saves a new or changed number in canonical form and reserves it is on employees (insert, or update of employee_number, deleted_at and employment_status only), and the per-company index is gone',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.employees'::regclass and tgname = 'employees_canonical_number' and not tgisinternal
                             and pg_get_triggerdef(oid) ilike '%before insert or update of employee_number, deleted_at, employment_status on%')
                   and to_regclass('public.employees_company_employee_number_unique') is null
              then 'OK' else 'FAIL - the trigger is missing or fires on more than it should, or the old per-company index is still there' end
  union all select 4, 'the trigger that claims the number when a deactivated login is reactivated is on profiles',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_employee_number_reactivation' and not tgisinternal
                             and pg_get_triggerdef(oid) ilike '%before update of account_status on%')
              then 'OK' else 'FAIL - the profiles trigger is missing' end
  union all select 5, 'every ACTIVE or INVITED employee has their CURRENT number reserved for that same employee (none missing, none reserved for someone else)',
         case when to_regclass('public.employee_number_reservations') is not null
                   and (select count(*) from employees e left join employee_number_reservations r on r.number_key = employee_number_canonical(e.employee_number)
                         where employee_number_canonical(e.employee_number) <> '' and employee_number_in_scope(e.deleted_at, e.employment_status, e.user_id)
                           and (r.employee_id is null or r.employee_id <> e.id)) = 0
              then 'OK' else 'FAIL - an active or invited employee''s number is not reserved for them (apply the migration again; if it persists, run the audit pack)' end
  union all select 6, 'no two active or invited employees have equivalent numbers now',
         case when (select count(*) from (select 1 from employees where employee_number_canonical(employee_number) <> '' and employee_number_in_scope(deleted_at, employment_status, user_id)
                                          group by employee_number_canonical(employee_number) having count(*) > 1) d) = 0
              then 'OK' else 'FAIL - equivalent numbers exist (run the audit pack)' end
  union all select 7, 'the sequence exists and sits at or above the highest E-number any reservation holds (so no reserved number can be given out)',
         case when to_regclass('public.employee_number_seq') is not null and to_regclass('public.employee_number_reservations') is not null
                   and (select case when is_called then last_value else 0 end from employee_number_seq)
                       >= (select coalesce(max(substring(number_key from '^E([0-9]+)$')::bigint), 0) from employee_number_reservations where number_key ~ '^E[0-9]{1,15}$')
              then 'OK' else 'FAIL - the sequence is missing or below a reserved number (apply the migration again)' end
  union all select 8, 'signed-in users can call employee_number_canonical; anon cannot; nobody but the database itself can call next_employee_number(), employee_number_claim() or touch the sequence',
         case when has_function_privilege('authenticated', 'public.employee_number_canonical(text)', 'execute') and not has_function_privilege('anon', 'public.employee_number_canonical(text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.next_employee_number(uuid)', 'execute') and not has_function_privilege('anon', 'public.next_employee_number(uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.employee_number_claim(uuid, text, text)', 'execute')
                   and not has_sequence_privilege('authenticated', 'public.employee_number_seq', 'usage') and not has_sequence_privilege('anon', 'public.employee_number_seq', 'usage')
              then 'OK' else 'FAIL - privileges differ' end
  union all select 9, 'the pool and its build record exist (the pool was built once), row level security is on, and signed-in users and anon have no right to read or write them',
         case when to_regclass('public.employee_number_pool') is not null and to_regclass('public.employee_number_allocation') is not null
                   and (select count(*) from employee_number_allocation) = 1
                   and (select relrowsecurity from pg_class where oid = 'public.employee_number_pool'::regclass)
                   and (select relrowsecurity from pg_class where oid = 'public.employee_number_allocation'::regclass)
                   and not has_table_privilege('authenticated', 'public.employee_number_pool', 'select') and not has_table_privilege('authenticated', 'public.employee_number_pool', 'update')
                   and not has_table_privilege('anon', 'public.employee_number_pool', 'select')
              then 'OK' else 'FAIL - the pool or its build record is missing, built more than once, or open to signed-in users' end
  union all select 10, 'every pool number already claimed is reserved for the employee it was claimed by, and no pool number is a number outside the E series',
         case when to_regclass('public.employee_number_pool') is not null
                   and (select count(*) from employee_number_pool p left join employee_number_reservations r on r.number_key = p.number_key
                         where p.claimed_by is not null and (r.employee_id is null or r.employee_id <> p.claimed_by)) = 0
                   and (select count(*) from employee_number_pool where number_key !~ '^E[0-9]{1,15}$') = 0
              then 'OK' else 'FAIL - a claimed pool number is not reserved for its employee, or the pool holds a number outside the E series' end
) x order by ord;
