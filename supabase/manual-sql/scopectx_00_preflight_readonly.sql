-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000820_proj_scope_decision_context.sql.
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
  union all select 'B prerequisites', 200, 'function public.proj_has_capability', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_has_capability') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.proj_require_user', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_require_user') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'function public.proj_decide_scope_change', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_decide_scope_change') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 203, 'function public.proj_propose_scope_change', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_propose_scope_change') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'proj_scope_decision_context' and prosrc like '%proj_has_capability%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run scopectx_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(pp.proowner) || '; security definer ' || pp.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(pp.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', pp.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', pp.oid, 'execute')::text
                   from pg_proc pp where pp.pronamespace = 'public'::regnamespace and pp.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('proj_scope_decisions_waiting'), ('proj_scope_decision_context')) f(name)
  union all select 'D what exists today', 1000, 'scope changes waiting for a decision today', (select count(*)::text from proj_scope_changes where status = 'proposed')
  union all select 'D what exists today', 1001, 'READ-ONLY CHECK: people who hold scope approval but are not a founder (they could decide today but, unless they are members of the project, could not read the proposal); after this change they open it through the narrow decision page', (select coalesce(string_agg(coalesce(p.email, g.user_id::text) || ' (' || c.legal_name || ')', '; ' order by c.legal_name, p.email), 'none') from proj_company_grants g join companies c on c.id = g.company_id left join profiles p on p.id = g.user_id where g.revoked_at is null and 'approve_scope' = any (g.capabilities) and not ('founder' = any (g.capabilities)))
  union all select 'E row counts', 900, 'proj_scope_changes', (select count(*)::text from proj_scope_changes)
  union all select 'E row counts', 901, 'proj_scope_change_commercial', (select count(*)::text from proj_scope_change_commercial)
  union all select 'E row counts', 902, 'proj_company_grants', (select count(*)::text from proj_company_grants)
  union all select 'E row counts', 903, 'proj_project_members', (select count(*)::text from proj_project_members)
) r
order by section, ord, item;
