-- READ ONLY. Run AFTER applying 20270113000100_proj_client_timeline_tasks.sql. Changes nothing.
-- Expect: rows 1 to 5 'OK'. Row 6 must equal preflight row 5 (the migration made no issued version outdated). Rows 7 and 8 are for information.
select item, result from (
  select 1 as ord, 'the table exists with row level security on and exactly one SELECT policy (managers of the project)' as item,
         case when (select relrowsecurity from pg_class where oid = to_regclass('public.proj_client_timeline_tasks'))
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'proj_client_timeline_tasks') = 1
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'proj_client_timeline_tasks' and cmd = 'SELECT') = 1 then 'OK' else 'PROBLEM' end as result
  union all select 2, 'a signed-in user can only read the table (no insert, update or delete privilege)',
         case when has_table_privilege('authenticated', 'public.proj_client_timeline_tasks', 'select')
                   and not has_table_privilege('authenticated', 'public.proj_client_timeline_tasks', 'insert')
                   and not has_table_privilege('authenticated', 'public.proj_client_timeline_tasks', 'update')
                   and not has_table_privilege('authenticated', 'public.proj_client_timeline_tasks', 'delete')
                   and not has_table_privilege('anon', 'public.proj_client_timeline_tasks', 'select') then 'OK' else 'PROBLEM' end
  union all select 3, 'the four callable functions exist and are executable by a signed-in user',
         case when has_function_privilege('authenticated', 'public.proj_plan_preview(uuid)', 'execute')
                   and has_function_privilege('authenticated', 'public.proj_issue_plan_checked(uuid, text, text, text)', 'execute')
                   and has_function_privilege('authenticated', 'public.proj_set_client_timeline_tasks(uuid, jsonb)', 'execute')
                   and has_function_privilege('authenticated', 'public.proj_issue_plan(uuid, text, text)', 'execute') then 'OK' else 'PROBLEM' end
  union all select 4, 'the internal builders are not callable from a browser session, and nothing is callable signed out',
         case when not has_function_privilege('authenticated', 'public.proj_build_plan_payload(uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.proj_client_timeline_tasks_json(uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.proj_plan_preview(uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.proj_set_client_timeline_tasks(uuid, jsonb)', 'execute')
                   and not has_function_privilege('anon', 'public.proj_issue_plan_checked(uuid, text, text, text)', 'execute') then 'OK' else 'PROBLEM' end
  union all select 5, 'the guard that keeps an issued version unchanged is still in place',
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.proj_issued_plans') and tgname = 'proj_issued_plans_guard' and not tgisinternal) then 'OK' else 'PROBLEM' end
  union all select 6, 'latest issued versions that are outdated now (must equal preflight row 5 when run straight after the migration)',
         (select count(*) from proj_issued_plans p where p.superseded_at is null and md5(proj_build_plan_payload(p.project_id)::text) <> p.payload_hash)::text
  union all select 7, 'information: tasks chosen for a client timeline / projects with a choice',
         (select count(*) from proj_client_timeline_tasks)::text || ' / ' || (select count(distinct project_id) from proj_client_timeline_tasks)::text
  union all select 8, 'information: issued versions that hold tasks',
         (select count(*) from proj_issued_plans where payload ? 'tasks')::text
) x order by ord;
