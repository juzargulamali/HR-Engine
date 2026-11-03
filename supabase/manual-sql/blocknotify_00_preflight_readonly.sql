-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000900_proj_block_task_notifies_pm.sql.
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
  union all select 'B prerequisites', 200, 'function public.proj_block_task', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_block_task') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.proj_notify', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_notify') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'function public.proj_unblock_task', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_unblock_task') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'proj_block_task' and prosrc like '%Also tell the Project Manager when someone else was named%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run blocknotify_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet (the old definition is in place)' end
  union all
  select 'C functions today', 400 + row_number() over (order by p.proname), p.proname,
         'owner ' || pg_get_userbyid(p.proowner) || '; security definer ' || p.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(p.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', p.oid, 'execute')::text
           || '; by anonymous ' || has_function_privilege('anon', p.oid, 'execute')::text
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('proj_block_task')
  union all select 'D what exists today', 1000, 'tasks blocked right now', (select count(*)::text from proj_tasks where blocked_at is not null)
  union all select 'D what exists today', 1001, 'of those, blocked with a named person who is NOT the Project Manager (the Project Manager was not told of these; this change affects only blockers reported AFTER it)', (select count(*)::text from proj_tasks t join proj_projects p on p.id = t.project_id where t.blocked_at is not null and t.unblock_owner_id is not null and t.unblock_owner_id is distinct from p.pm_user_id)
  union all select 'E row counts', 900, 'proj_tasks', (select count(*)::text from proj_tasks)
  union all select 'E row counts', 901, 'proj_task_events', (select count(*)::text from proj_task_events)
  union all select 'E row counts', 902, 'notifications', (select count(*)::text from notifications)
) r
order by section, ord, item;
