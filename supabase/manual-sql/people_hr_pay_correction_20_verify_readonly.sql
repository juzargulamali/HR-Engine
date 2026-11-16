-- READ ONLY. Run AFTER 20270118000200_people_hr_pay_correction.sql. Every row must say OK except row 8, which is a count for information. Creates no row.
-- A row that says FAIL usually means the migration did not finish: apply the migration file again (it is re-runnable) and run this again.
select item, result from (
  select 1 as ord, 'compensation_corrections exists with the original and the new effective date, basic salary and allowances, currency, reason, who and when, the impact, and one correction per employee and request key (a unique constraint on employee_id, request_key)' as item,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compensation_corrections'
                      and column_name in ('id', 'company_id', 'employee_id', 'compensation_id', 'request_key', 'previous_effective_from', 'previous_base_salary', 'previous_allowances',
                                          'new_effective_from', 'new_base_salary', 'new_allowances', 'currency', 'reason', 'corrected_by', 'corrected_at', 'impact')) = 16
                   and exists (select 1 from pg_constraint c where c.conrelid = 'public.compensation_corrections'::regclass and c.contype = 'u'
                                 and (select array_agg(a.attname order by a.attname) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['employee_id', 'request_key']::name[])
              then 'OK' else 'FAIL - a column or the unique constraint is missing' end as result
  union all select 2, 'row level security is on; the only policy is the read policy, for HR Admin or Finance of the company',
         case when (select relrowsecurity from pg_class where oid = 'public.compensation_corrections'::regclass)
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'compensation_corrections') = 1
                   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'compensation_corrections' and policyname = 'compensation_corrections_select' and cmd = 'SELECT'
                                 and qual like '%hr_admin%' and qual like '%finance%')
              then 'OK' else 'FAIL - RLS is off, there is another policy, or the read policy is not HR Admin / Finance of the company' end
  union all select 3, 'no insert, update or delete policy exists and anon has no policy, so every direct write by a signed-in user is refused (the function is the only way in)',
         case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'compensation_corrections' and cmd <> 'SELECT')
                   and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'compensation_corrections' and 'anon' = any (roles))
              then 'OK' else 'FAIL - a write policy or an anon policy exists' end
  union all select 4, 'anon has no table privilege on compensation_corrections and a signed-in user has no insert, update or delete privilege (on the Supabase platform; a plain test database grants them and relies on row level security)',
         case when not has_table_privilege('anon', 'public.compensation_corrections', 'select')
                   and not has_table_privilege('anon', 'public.compensation_corrections', 'insert')
                   and not has_table_privilege('authenticated', 'public.compensation_corrections', 'insert')
                   and not has_table_privilege('authenticated', 'public.compensation_corrections', 'update')
                   and not has_table_privilege('authenticated', 'public.compensation_corrections', 'delete')
              then 'OK' else 'FAIL - a table privilege is still granted: run revoke all on compensation_corrections from anon; revoke insert, update, delete, truncate on compensation_corrections from authenticated' end
  union all select 5, 'the table is append-only (a trigger refuses any update or delete) and the audit trigger records each correction',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.compensation_corrections'::regclass and tgname = 'compensation_corrections_no_change' and not tgisinternal)
                   and exists (select 1 from pg_trigger where tgrelid = 'public.compensation_corrections'::regclass and tgname = 'audit_compensation_corrections' and not tgisinternal)
                   and exists (select 1 from pg_trigger where tgrelid = 'public.compensation_details'::regclass and tgname = 'audit_compensation' and not tgisinternal)
              then 'OK' else 'FAIL - a trigger is missing' end
  union all select 6, 'correct_pay_record runs as its owner with a pinned search path; signed-in users can call it, anon cannot; the internal helper cannot be called by signed-in users',
         case when to_regprocedure('public.correct_pay_record(uuid, date, numeric, jsonb, text, text)') is not null
                   and (select prosecdef and proconfig is not null and 'search_path=public' = any (proconfig) from pg_proc where oid = 'public.correct_pay_record(uuid, date, numeric, jsonb, text, text)'::regprocedure)
                   and has_function_privilege('authenticated', 'public.correct_pay_record(uuid, date, numeric, jsonb, text, text)', 'execute')
                   and not has_function_privilege('anon', 'public.correct_pay_record(uuid, date, numeric, jsonb, text, text)', 'execute')
                   and to_regprocedure('public._hr_pay_in_force(uuid, date)') is not null
                   and not has_function_privilege('authenticated', 'public._hr_pay_in_force(uuid, date)', 'execute')
                   and not has_function_privilege('anon', 'public._hr_pay_in_force(uuid, date)', 'execute')
              then 'OK' else 'FAIL - missing, not security definer with search_path = public, or the privileges differ' end
  union all select 7, 'the function takes the employee lock first, checks HR Admin or Finance of the employee''s company, and never writes to payroll or settlement tables',
         case when (select prosrc like '%_hr_lock_employee%' and prosrc like '%has_role(''hr_admin'', emp.company_id)%' and prosrc like '%has_role(''finance'', emp.company_id)%'
                           and prosrc not like '%update payroll_export%' and prosrc not like '%insert into payroll_export%' and prosrc not like '%delete from payroll_export%'
                           and prosrc not like '%update termination_settlement%' and prosrc not like '%insert into termination_settlement%'
                      from pg_proc where oid = to_regprocedure('public.correct_pay_record(uuid, date, numeric, jsonb, text, text)'))
              then 'OK' else 'FAIL - an older or different version is installed (apply the migration file again)' end
  union all select 8, 'information: corrections recorded so far', (select count(*) from compensation_corrections)::text
) x order by ord;
