-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000200_proj_scope_proposal_notifies_deciders.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send me the full result.
--
--   A  who is running this, server version
--   B  prerequisites: the functions this migration replaces exist; the migration is NOT applied yet
--   C  the functions this migration replaces, as they are today (owner, privileges, fingerprint)
--   D  what exists today (information only)
--   E  row counts (information only)
--
-- HOW TO READ IT: section B must be OK on every row and say the change is NOT yet applied.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all select 'A session', 2, 'server_version', version()
  union all select 'A session', 3, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 200, 'function public.proj_propose_scope_change', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_propose_scope_change') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.proj_decide_scope_change', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_decide_scope_change') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'function public.proj_notify', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_notify') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 203, 'function public.proj_my_notifications', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_my_notifications') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 204, 'function public.proj_has_capability', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_has_capability') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'proj_propose_scope_change' and prosrc like '%Tell the people who decide%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run proj_scope_notify_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet (the old definition is in place)' end
  union all
  select 'C functions today', 400 + row_number() over (order by p.proname), p.proname,
         'owner ' || pg_get_userbyid(p.proowner) || '; security definer ' || p.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(p.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', p.oid, 'execute')::text
           || '; by anonymous ' || has_function_privilege('anon', p.oid, 'execute')::text
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('proj_propose_scope_change')
  union all select 'D what exists today', 1000, 'scope changes waiting for a decision today', (select count(*)::text from proj_scope_changes where status = 'proposed')
  union all select 'D what exists today', 1001, 'READ-ONLY CHECK: people who hold approve_scope but are not a founder (they decide only if they can open the project: a member)', (select coalesce(string_agg(p.email || ' (' || c.legal_name || ')' || case when exists (select 1 from proj_project_members m where m.user_id = g.user_id and m.removed_at is null) then ', member of a project' else ', NOT a member of any project: cannot read or open a proposal' end, '; '), 'none') from proj_company_grants g join profiles p on p.id = g.user_id join companies c on c.id = g.company_id where g.revoked_at is null and 'approve_scope' = any (g.capabilities) and not ('founder' = any (g.capabilities)))
  union all select 'E row counts', 900, 'proj_scope_changes', (select count(*)::text from proj_scope_changes)
  union all select 'E row counts', 901, 'proj_scope_change_commercial', (select count(*)::text from proj_scope_change_commercial)
  union all select 'E row counts', 902, 'proj_company_grants', (select count(*)::text from proj_company_grants)
  union all select 'E row counts', 903, 'notifications', (select count(*)::text from notifications)
) r
order by section, ord, item;
