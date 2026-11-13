-- READ ONLY. Run AFTER 20270104000100_proj_project_plan_r1.sql. One result table; every row must say OK (rows marked INFO only report a number). Creates no row.
select item, result from (
  select 1 as ord, 'the new columns exist on proj_dp_items (qty, source_key) and proj_dp_lines (start_date, supply_route, detail, milestone_id, depends_on, task_pending)' as item,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proj_dp_items' and column_name in ('qty', 'source_key')) = 2
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proj_dp_lines' and column_name in ('start_date', 'supply_route', 'detail', 'milestone_id', 'depends_on', 'task_pending')) = 6 then 'OK' else 'MISSING' end as result
  union all select 2, 'the section lists accept Apps, Engineering and Site work as well as the original five (lines and delegations)',
         case when (select count(*) from pg_constraint where conname in ('proj_dp_lines_section_check', 'proj_dp_delegations_section_check') and pg_get_constraintdef(oid) like '%engineering%' and pg_get_constraintdef(oid) like '%programming%') = 2 then 'OK' else 'CHANGED' end
  union all select 3, 'the new functions the app calls exist; signed-in users can call them; anon and public cannot',
         case when (select count(*) from (values
              ('public.proj_dp_plan(uuid)'), ('public.proj_dp_save_item(uuid, uuid, jsonb, integer, text)'), ('public.proj_dp_save_line(uuid, uuid, jsonb, integer, text)'), ('public.proj_dp_add_sequence(uuid, text, jsonb)'),
              ('public.proj_dp_delegate(uuid, text, uuid)'), ('public.proj_dp_seed_scope(uuid)'), ('public.proj_dp_release(uuid, uuid[])'), ('public.proj_dp_decide_change(uuid, text, text)'), ('public.proj_dp_reconcile_task(uuid, text)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure(f.sig) and a.grantee = 0)) = 9 then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 4, 'the internal helpers are NOT callable by signed-in users, anon or public',
         case when exists (select 1 from (values ('public.proj_dp_sync_task(uuid, text[])'), ('public.proj_dp_clean_detail(text, jsonb)'), ('public.proj_dp_line_loops(uuid, uuid[])'), ('public.proj_dp_can_edit_section(uuid, text)'),
              ('public.proj_dp_touch(uuid)'), ('public.proj_dp_next_key(uuid, text)'), ('public.proj_dp_active_member(uuid, uuid)'), ('public.proj_dp_line_booked(uuid)')) f(sig)
              where to_regprocedure(f.sig) is null or has_function_privilege('authenticated', f.sig, 'execute') or has_function_privilege('anon', f.sig, 'execute')) then 'FAIL - callable or missing' else 'OK' end
  union all select 5, 'release never submits an equipment request (the function names no submit function) and uses the existing task functions',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_dp_release(uuid, uuid[])')) not like '%inv_submit_request%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_dp_release(uuid, uuid[])')) like '%proj_create_task%' then 'OK' else 'CHANGED' end
  union all select 6, 'a task or equipment line change approved in the plan goes through the existing task functions (proj_reassign_task / proj_update_task), never a direct update of proj_tasks',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_dp_sync_task(uuid, text[])')) like '%proj_reassign_task%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_dp_sync_task(uuid, text[])')) like '%proj_update_task%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_dp_sync_task(uuid, text[])')) not like '%update proj_tasks%' then 'OK' else 'CHANGED' end
  union all select 7, 'a linked task or equipment line belongs to at most one plan line, and a handover technology was brought in at most once',
         case when not exists (select 1 from proj_dp_lines where task_id is not null group by task_id having count(*) > 1)
                   and not exists (select 1 from proj_dp_lines where request_line_id is not null group by request_line_id having count(*) > 1)
                   and not exists (select 1 from proj_dp_items where source_key is not null group by project_id, source_key having count(*) > 1) then 'OK' else 'FAIL - a duplicate link' end
  union all select 8, 'every line detail is an object; only Hardware lines have a supply route',
         case when not exists (select 1 from proj_dp_lines where jsonb_typeof(detail) <> 'object' or (supply_route is not null and section <> 'hardware')) then 'OK' else 'FAIL' end
  union all select 9, 'INFO lines by section: ' || coalesce((select string_agg(section || ' ' || n, ', ' order by section) from (select section, count(*)::text n from proj_dp_lines where removed_at is null group by section) s), 'none'), 'INFO'
  union all select 10, 'INFO lines waiting for a task update: ' || (select count(*) from proj_dp_lines where task_pending is not null)::text, 'INFO'
) x order by ord;
