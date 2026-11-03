-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000910_module_access_managers.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send me the full result.
--
--   A  who is running this, server version
--   B  prerequisites: what this migration builds on exists; the migration is NOT applied yet
--   C  the functions this migration replaces or adds, as they are today (owner, privileges, fingerprint; an added one is absent)
--   D  what exists today (information only; some rows are read-only checks of the live state that decide whether more is needed)
--   E  row counts (information only)
--
-- HOW TO READ IT: section B must be OK on every row and say the change is NOT yet applied.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all select 'A session', 2, 'server_version', version()
  union all select 'A session', 3, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 200, 'function public.current_employee_id (core)', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'current_employee_id') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'table public.crm_company_grants', case when to_regclass('public.crm_company_grants') is not null then 'OK' else 'NOT INSTALLED here - that module is skipped by the function (it asks only the modules that exist); install it first if you use it' end
  union all select 'B prerequisites', 202, 'table public.proj_company_grants', case when to_regclass('public.proj_company_grants') is not null then 'OK' else 'NOT INSTALLED here - that module is skipped by the function (it asks only the modules that exist); install it first if you use it' end
  union all select 'B prerequisites', 203, 'table public.inv_company_grants', case when to_regclass('public.inv_company_grants') is not null then 'OK' else 'NOT INSTALLED here - that module is skipped by the function (it asks only the modules that exist); install it first if you use it' end
  union all select 'B prerequisites', 204, 'table public.pbx_company_grants', case when to_regclass('public.pbx_company_grants') is not null then 'OK' else 'NOT INSTALLED here - that module is skipped by the function (it asks only the modules that exist); install it first if you use it' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'module_access_managers' and prosrc like '%One branch per module%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run modaccess_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(pp.proowner) || '; security definer ' || pp.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(pp.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', pp.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', pp.oid, 'execute')::text
                   from pg_proc pp where pp.pronamespace = 'public'::regnamespace and pp.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('module_access_managers')) f(name)
  union all select 'D what exists today', 1000, 'active holders who manage access, per module (information only: these are the people a denied colleague would be shown, in their own company)', (select 'sales ' || (select count(*) from crm_company_grants where revoked_at is null and ('founder' = any (capabilities) or 'manage_access' = any (capabilities))) || '; projects ' || (select count(*) from proj_company_grants where revoked_at is null and ('founder' = any (capabilities) or 'manage_access' = any (capabilities))) || '; inventory ' || (select count(*) from inv_company_grants where revoked_at is null and ('founder' = any (capabilities) or 'manage_access' = any (capabilities))) || '; budget ' || (select count(*) from pbx_company_grants where revoked_at is null and 'manage_access' = any (capabilities)))
  union all select 'E row counts', 900, 'crm_company_grants (active)', (select count(*)::text from crm_company_grants where revoked_at is null)
  union all select 'E row counts', 901, 'proj_company_grants (active)', (select count(*)::text from proj_company_grants where revoked_at is null)
  union all select 'E row counts', 902, 'pbx_company_grants (active)', (select count(*)::text from pbx_company_grants where revoked_at is null)
) r
order by section, ord, item;
