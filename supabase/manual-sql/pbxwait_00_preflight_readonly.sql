-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000830_pbx_decisions_waiting_count.sql.
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
  union all select 'B prerequisites', 200, 'function public.pbx_accessible_company_ids', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'pbx_accessible_company_ids') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.pbx_can_decide', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'pbx_can_decide') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'function public.pbx_approval_on_hold', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'pbx_approval_on_hold') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 203, 'function public.pbx_require_user', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'pbx_require_user') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 204, 'function public.pbx_inbox', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'pbx_inbox') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'pbx_decisions_waiting_count' and prosrc like '%pbx_can_decide%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run pbxwait_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(pp.proowner) || '; security definer ' || pp.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(pp.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', pp.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', pp.oid, 'execute')::text
                   from pg_proc pp where pp.pronamespace = 'public'::regnamespace and pp.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('pbx_decisions_waiting_count')) f(name)
  union all select 'D what exists today', 1000, 'submitted budget versions and final-expense sets waiting today (the most the number can be for the whole company set)', (select (select count(*) from pbx_budget_versions where status = 'submitted')::text || ' budgets, ' || (select count(*) from pbx_actual_submissions where status = 'submitted')::text || ' final-expense sets')
  union all select 'E row counts', 900, 'pbx_budget_versions', (select count(*)::text from pbx_budget_versions)
  union all select 'E row counts', 901, 'pbx_actual_submissions', (select count(*)::text from pbx_actual_submissions)
  union all select 'E row counts', 902, 'pbx_company_grants', (select count(*)::text from pbx_company_grants)
) r
order by section, ord, item;
