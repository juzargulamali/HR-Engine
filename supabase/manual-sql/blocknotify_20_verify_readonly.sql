-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the migration 20261216000900_proj_block_task_notifies_pm.sql.
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is information only).
-- A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  the function(s) exist, are SECURITY DEFINER with a fixed search path, are callable by signed-in users and NOT by anonymous visitors
--   2  the new rule is in the function AND every earlier protection is still there
--
-- It checks DEFINITIONS and PRIVILEGES. It cannot call a function without writing, so the behaviour is proved by the repository's database tests
-- (packages/rls-tests/test/project_block_notifies_pm.rls.test.ts) and, on this project, by the first real use (see the deployment guide).

with
fns(name) as (values ('proj_block_task')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from fns)),
needs(fname, kind, label, needle) as (values
  ('proj_block_task', 'N', 'the Project Manager is also told when someone else is named', '''fyi'', true'),
  ('proj_block_task', 'N', 'never twice to the same person (named person is the PM)', 'v.pm_user_id is distinct from p_unblock_owner'),
  ('proj_block_task', 'N', 'the PM notice goes through proj_notify (only people who can act, never the reporter)', 'proj_notify(v.id, v.pm_user_id'),
  ('proj_block_task', 'E', 'the named unblocker (or the PM) is still told', 'coalesce(p_unblock_owner, v.pm_user_id)'),
  ('proj_block_task', 'E', 'only the assignee, department head or PM may block', 'proj_task_actor_role(t) is null'),
  ('proj_block_task', 'E', 'a reason is required', 'Say what is blocking the task'),
  ('proj_block_task', 'E', 'a person or an action to unblock is required', 'Say who or what action will unblock it'),
  ('proj_block_task', 'E', 'the named person must be a member', 'must be a member of the project'),
  ('proj_block_task', 'E', 'the event is recorded', 'proj_task_event(t.id, v.id, ''blocked''')
),
checks as (
  select 1 as grp, 'function exists' as chk, e.name as item, case when f.oid is not null then 'OK' else 'FAIL' end as result, '' as detail
  from fns e left join fn f on f.proname = e.name
  union all
  select 1, 'security definer with a fixed search path', f.proname,
         case when f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%' then 'OK' else 'FAIL' end, coalesce(f.proconfig::text, 'no search_path set')
  from fn f
  union all
  select 1, 'signed-in users can call it, anonymous visitors cannot', f.proname,
         case when has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f
  union all
  select 2, case n.kind when 'N' then 'new rule present' else 'earlier protection still present' end, n.fname || ': ' || n.label,
         case when f.oid is null then 'FAIL' when position(n.needle in f.prosrc) > 0 then 'OK' else 'FAIL' end,
         case when f.oid is null then 'function missing' when position(n.needle in f.prosrc) > 0 then '' else 'text not found: ' || n.needle end
  from needs n left join fn f on f.proname = n.fname
)
select chk as "check", item, result, detail from (
  select grp, chk, item, result, detail from checks
  union all select 9, 'SUMMARY', '', case when exists (select 1 from checks where result = 'FAIL')
         then 'FAIL: ' || (select count(*) from checks where result = 'FAIL') || ' check(s) failing, see above'
         else 'OK: ' || (select count(*) from checks) || ' checks, 0 failing' end, ''
) r
order by grp, chk, item;
