-- READ ONLY. Run AFTER 20261231000100_proj_delivery_plan.sql. One result table; every row must say OK (rows marked INFO only report a number). Creates no row.
select item, result from (
  select 1 as ord, 'the six delivery plan tables exist with row-level security enabled' as item,
         case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
                     and c.relname in ('proj_dp_state', 'proj_dp_items', 'proj_dp_lines', 'proj_dp_delegations', 'proj_dp_corrections', 'proj_dp_changes')) = 6 then 'OK' else 'MISSING or RLS off' end as result
  union all select 2, 'signed-in users can only READ the tables (no insert, update or delete); anon has nothing',
         case when exists (select 1 from unnest(array['proj_dp_state', 'proj_dp_items', 'proj_dp_lines', 'proj_dp_delegations', 'proj_dp_corrections', 'proj_dp_changes']) t, unnest(array['insert', 'update', 'delete']) p
                           where has_table_privilege('authenticated', 'public.' || t, p))
                or exists (select 1 from unnest(array['proj_dp_state', 'proj_dp_items', 'proj_dp_lines', 'proj_dp_delegations', 'proj_dp_corrections', 'proj_dp_changes']) t, unnest(array['select', 'insert', 'update', 'delete']) p
                           where has_table_privilege('anon', 'public.' || t, p)) then 'FAIL - a write privilege is granted' else 'OK' end
  union all select 3, 'each table has exactly one policy: read for people who can read the project''s details',
         case when (select count(*) from pg_policies where schemaname = 'public' and tablename like 'proj\_dp\_%' and cmd = 'SELECT' and qual like '%proj_can_view_details%') = 6
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename like 'proj\_dp\_%') = 6 then 'OK' else 'CHANGED' end
  union all select 4, 'the eleven functions the app calls exist; signed-in users can call them; anon and public cannot',
         case when (select count(*) from (values
              ('public.proj_dp_plan(uuid)'), ('public.proj_dp_save_item(uuid, uuid, jsonb, integer, text)'), ('public.proj_dp_remove_item(uuid)'), ('public.proj_dp_save_line(uuid, uuid, jsonb, integer, text)'),
              ('public.proj_dp_remove_line(uuid)'), ('public.proj_dp_delegate(uuid, text, uuid)'), ('public.proj_dp_release(uuid, uuid[])'), ('public.proj_dp_raise_correction(uuid, text, uuid, text)'),
              ('public.proj_dp_decide_correction(uuid, text, text)'), ('public.proj_dp_decide_change(uuid, text, text)'), ('public.proj_dp_apply_import(uuid, integer, jsonb, jsonb)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure(f.sig) and a.grantee = 0)) = 11 then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 5, 'the internal helpers are NOT callable by signed-in users, anon or public',
         case when exists (select 1 from (values ('public.proj_dp_touch(uuid)'), ('public.proj_dp_next_key(uuid, text)'), ('public.proj_dp_can_edit_section(uuid, text)'), ('public.proj_dp_active_member(uuid, uuid)'), ('public.proj_dp_line_booked(uuid)')) f(sig)
              where to_regprocedure(f.sig) is null or has_function_privilege('authenticated', f.sig, 'execute') or has_function_privilege('anon', f.sig, 'execute')) then 'FAIL - callable or missing' else 'OK' end
  union all select 6, 'release never submits an equipment request (the function names no submit function)',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_dp_release(uuid, uuid[])')) not like '%inv_submit_request%' then 'OK' else 'CHANGED' end
  union all select 7, 'no existing Projects or Inventory function was replaced by this migration (the task and equipment functions it calls are the ones already installed)',
         case when to_regprocedure('public.proj_create_task(uuid, jsonb)') is not null then 'OK' else 'MISSING' end
  union all select 8, 'a linked task or equipment line belongs to at most one plan line',
         case when not exists (select 1 from proj_dp_lines where task_id is not null group by task_id having count(*) > 1)
                   and not exists (select 1 from proj_dp_lines where request_line_id is not null group by request_line_id having count(*) > 1) then 'OK' else 'FAIL - a duplicate link' end
  union all select 9, 'INFO deliverables: ' || (select count(*) from proj_dp_items where removed_at is null)::text || ', lines: ' || (select count(*) from proj_dp_lines where removed_at is null)::text
                      || ', released lines: ' || (select count(*) from proj_dp_lines where released_at is not null)::text, 'INFO'
) x order by ord;
