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
  union all select 2, 'the unique index is on the NORMALISED number across ALL companies (no company in it), among live (not removed) employees, and the per-company index it replaces is gone',
         case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'employees_employee_number_canonical_unique'
                             and indexdef ilike '%unique%' and indexdef ilike '%employee_number_canonical(employee_number)%' and indexdef not ilike '%company_id%' and indexdef ilike '%deleted_at is null%')
                   and to_regclass('public.employees_company_employee_number_unique') is null
              then 'OK' else 'FAIL - the index is missing, still per company, or the old per-company index is still there' end
  union all select 3, 'the trigger that numbers a new hire, saves a new or changed number in canonical form and words a duplicate or a restore onto a held number is on employees (insert, or update of employee_number and deleted_at only)',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.employees'::regclass and tgname = 'employees_canonical_number' and not tgisinternal
                             and pg_get_triggerdef(oid) ilike '%before insert or update of employee_number, deleted_at%')
              then 'OK' else 'FAIL - the trigger is missing or fires on more than the number' end
  union all select 4, 'no two live employees, in any companies, have equivalent numbers now (the index would not exist otherwise)',
         case when (select count(*) from (select 1 from employees where deleted_at is null group by employee_number_canonical(employee_number) having count(*) > 1) d) = 0
              then 'OK' else 'FAIL - equivalent live numbers exist (run the audit pack)' end
  union all select 5, 'the sequence exists and sits at or above the highest E-number held by ANY employee, removed ones included (so no number already held can be given out)',
         case when to_regclass('public.employee_number_seq') is not null
                   and (select case when is_called then last_value else 0 end from employee_number_seq)
                       >= (select coalesce(max(substring(employee_number_canonical(employee_number) from '^E([0-9]+)$')::bigint), 0) from employees where employee_number_canonical(employee_number) ~ '^E[0-9]{1,15}$')
              then 'OK' else 'FAIL - the sequence is missing or below an existing number (apply the migration again)' end
  union all select 6, 'signed-in users can call employee_number_canonical; anon cannot; nobody but the database itself can call next_employee_number() or touch the sequence directly',
         case when has_function_privilege('authenticated', 'public.employee_number_canonical(text)', 'execute') and not has_function_privilege('anon', 'public.employee_number_canonical(text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.next_employee_number()', 'execute') and not has_function_privilege('anon', 'public.next_employee_number()', 'execute')
                   and not has_sequence_privilege('authenticated', 'public.employee_number_seq', 'usage') and not has_sequence_privilege('anon', 'public.employee_number_seq', 'usage')
              then 'OK' else 'FAIL - privileges differ' end
) x order by ord;
