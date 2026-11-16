-- READ ONLY. Run AFTER 20270116000100_people_hr_phase2_queue.sql. Every row must say OK except row 7, which is a count for information. Creates no row.
-- A row that says FAIL usually means the migration did not finish: apply the migration file again (it is re-runnable) and run this again.
select item, result from (
  select 1 as ord, 'hr_queue_acknowledgements exists with company, employee, kind, source, date, note and who/when, and one acknowledgement per record and date (a unique constraint on kind, source_id, source_date)' as item,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hr_queue_acknowledgements'
                      and column_name in ('id', 'company_id', 'employee_id', 'kind', 'source_id', 'source_date', 'note', 'acknowledged_by', 'acknowledged_at')) = 9
                   and exists (select 1 from pg_constraint c where c.conrelid = 'public.hr_queue_acknowledgements'::regclass and c.contype = 'u'
                                 and (select array_agg(a.attname order by a.attname) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['kind', 'source_date', 'source_id']::name[])
              then 'OK' else 'FAIL - a column or the unique constraint is missing' end as result
  union all select 2, 'row level security is on; the only policy is the read policy; it needs HR Admin, CEO or CTO of the company AND that the reader can read the source record itself (contract, employee document, identity document, attendance day or recovery window)',
         case when (select relrowsecurity from pg_class where oid = 'public.hr_queue_acknowledgements'::regclass)
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hr_queue_acknowledgements') = 1
                   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_queue_acknowledgements' and policyname = 'hr_queue_ack_select' and cmd = 'SELECT')
                   and (select bool_and(pg_get_expr(p.polqual, p.polrelid) like '%' || t || '%')
                          from pg_policy p, unnest(array['employment_contracts', 'employee_documents', 'identity_documents', 'attendance_records', 'recovery_windows']) as t
                         where p.polrelid = 'public.hr_queue_acknowledgements'::regclass and p.polname = 'hr_queue_ack_select')
              then 'OK' else 'FAIL - RLS is off, there is another policy, or the read policy does not follow each source record (an earlier draft: apply the migration file again)' end
  union all select 3, 'no insert, update or delete policy exists, so every direct write by a signed-in user is refused by row level security (the function is the only way in), and anon has no policy to read through',
         case when (select relrowsecurity from pg_class where oid = 'public.hr_queue_acknowledgements'::regclass)
                   and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_queue_acknowledgements' and cmd <> 'SELECT')
                   and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_queue_acknowledgements' and 'anon' = any (roles))
              then 'OK' else 'FAIL - a write policy or an anon policy exists' end
  union all select 4, 'acknowledge_hr_queue_item runs as its owner with a pinned search path; signed-in users can call it, anon cannot',
         case when to_regprocedure('public.acknowledge_hr_queue_item(text, uuid, date, text)') is not null
                   and (select prosecdef and proconfig is not null and 'search_path=public' = any (proconfig) from pg_proc where oid = 'public.acknowledge_hr_queue_item(text, uuid, date, text)'::regprocedure)
                   and has_function_privilege('authenticated', 'public.acknowledge_hr_queue_item(text, uuid, date, text)', 'execute')
                   and not has_function_privilege('anon', 'public.acknowledge_hr_queue_item(text, uuid, date, text)', 'execute')
              then 'OK' else 'FAIL - missing, not security definer with search_path = public, or the privileges differ' end
  union all select 5, 'the function reads the company and employee from the source record and checks HR Admin of that company (it does not take them from the caller)',
         case when (select prosrc like '%has_role(''hr_admin'', v_company)%' and prosrc not like '%p_company%' and prosrc not like '%p_employee%' from pg_proc where oid = to_regprocedure('public.acknowledge_hr_queue_item(text, uuid, date, text)'))
              then 'OK' else 'FAIL - an older or different version is installed (apply the migration file again)' end
  union all select 6, 'the audit trigger is on the table (who acknowledged what is recorded)',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.hr_queue_acknowledgements'::regclass and tgname = 'audit_hr_queue_acknowledgements' and not tgisinternal)
              then 'OK' else 'FAIL - the audit trigger is missing' end
  union all select 7, 'information: acknowledgements recorded so far', (select count(*) from hr_queue_acknowledgements)::text
) x order by ord;
