-- READ ONLY. Run BEFORE applying 20270118000300_people_hr_onboarding.sql. Changes nothing.
-- Expect: row 1 'OK'; row 2 'not installed yet' (or 'already installed' on a second run); row 3 'OK'. Rows 4 and 5 are counts for information.
select item, result from (
  select 1 as ord, 'the tables this migration builds on exist (employees, profiles, user_roles, the four module grant tables, audit_log) and the audit trigger function write_audit_log exists' as item,
         case when to_regclass('public.employees') is not null and to_regclass('public.profiles') is not null and to_regclass('public.user_roles') is not null
                   and to_regclass('public.crm_company_grants') is not null and to_regclass('public.proj_company_grants') is not null
                   and to_regclass('public.inv_company_grants') is not null and to_regclass('public.pbx_company_grants') is not null
                   and to_regclass('public.audit_log') is not null and to_regprocedure('public.write_audit_log()') is not null
              then 'OK' else 'STOP - a prerequisite is missing; do not apply' end as result
  union all select 2, 'this migration is not installed yet (no employee_onboarding_plans table, no onboarding_access_snapshot function)',
         case when to_regclass('public.employee_onboarding_plans') is not null or to_regprocedure('public.onboarding_access_snapshot(uuid)') is not null
              then 'already installed (applying the file again is safe: it is re-runnable)' else 'not installed yet' end
  union all select 3, 'no existing policy, grant or row is changed by this migration (it only adds a table, three policies on that table and one read function): nothing to check',
         'OK'
  union all select 4, 'information: employees who have no login linked yet (the people onboarding would invite)', (select count(*) from employees where user_id is null and deleted_at is null)::text
  union all select 5, 'information: active accounts that hold no role at all (accounts onboarding would finish)', (select count(*) from profiles p where p.is_active and not exists (select 1 from user_roles r where r.user_id = p.id and r.revoked_at is null))::text
) x order by ord;
