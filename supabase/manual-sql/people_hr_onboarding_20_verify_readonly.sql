-- READ ONLY. Run AFTER 20270118000300_people_hr_onboarding.sql. Every row must say OK. Creates no row.
select item, result from (
  select 1 as ord, 'the onboarding plan table exists with row level security on, and anon has no right to it' as item,
         case when to_regclass('public.employee_onboarding_plans') is not null
                   and (select relrowsecurity from pg_class where oid = 'public.employee_onboarding_plans'::regclass)
                   and not has_table_privilege('anon', 'public.employee_onboarding_plans', 'select')
              then 'OK' else 'FAIL - the table is missing, open, or readable by anon' end as result
  union all select 2, 'three policies (select, insert, update) exist on it and none lets a signed-in user delete',
         case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'employee_onboarding_plans' and policyname in ('onboarding_plans_select', 'onboarding_plans_insert', 'onboarding_plans_update')) = 3
                   and not has_table_privilege('authenticated', 'public.employee_onboarding_plans', 'delete')
              then 'OK' else 'FAIL - a policy is missing or delete is allowed' end
  union all select 3, 'the audit trigger is on the plan table',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.employee_onboarding_plans'::regclass and tgname = 'audit_employee_onboarding_plans' and not tgisinternal)
              then 'OK' else 'FAIL - the audit trigger is missing' end
  union all select 4, 'onboarding_access_snapshot exists, signed-in users can call it and anon cannot',
         case when to_regprocedure('public.onboarding_access_snapshot(uuid)') is not null
                   and has_function_privilege('authenticated', 'public.onboarding_access_snapshot(uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.onboarding_access_snapshot(uuid)', 'execute')
              then 'OK' else 'FAIL - the function is missing or its privileges differ' end
  union all select 5, 'the HR Admin role policy exists on user_roles, allows only the employee and line_manager roles for a company, and the System Administrator policy is still there',
         case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_roles' and policyname = 'user_roles_insert_hr_admin_employee' and cmd = 'INSERT'
                              and with_check like '%''employee''%' and with_check like '%''line_manager''%' and with_check not like '%''sys_admin''%' and with_check not like '%''finance''%' and with_check not like '%''ceo''%' and with_check not like '%''cto''%')
                   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_roles' and policyname = 'user_roles_insert_sysadmin')
              then 'OK' else 'FAIL - the HR Admin role policy is missing or wider than expected, or the System Administrator policy is gone' end
) x order by ord;
