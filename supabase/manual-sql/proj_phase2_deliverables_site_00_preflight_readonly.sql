-- READ ONLY. Run BEFORE applying 20270106000100_proj_phase2_deliverables_site.sql. Changes nothing.
-- Expect: rows 1 to 5 'OK'; row 6 'not installed yet' (or 'already installed' on a second run). Rows 7 and 8 are numbers for information.
select n, item, result from (
  select 1 as n, 'Project Plan Quick add and order is installed (proj_dp_add_lines)' as item,
         case when to_regprocedure('public.proj_dp_add_lines(uuid, text, jsonb, boolean)') is not null then 'OK' else 'STOP - apply 20270105000100 first' end as result
  union all select 2, 'the existing task review / completion function, proj_set_task_status, exists',
         case when to_regprocedure('public.proj_set_task_status(uuid, text, text, integer)') is not null then 'OK' else 'STOP' end
  union all select 3, 'project files and the site timeline tables exist (proj_files, proj_plan_items, proj_site_bookings)',
         case when to_regclass('public.proj_files') is not null and to_regclass('public.proj_plan_items') is not null and to_regclass('public.proj_site_bookings') is not null then 'OK' else 'STOP' end
  union all select 4, 'the Project Plan activations table exists (proj_dp_items)', case when to_regclass('public.proj_dp_items') is not null then 'OK' else 'STOP - apply 20270104000100 first' end
  union all select 5, 'Inventory requests exist (inv_requests, inv_request_state)',
         case when to_regclass('public.inv_requests') is not null and to_regprocedure('public.inv_request_state(uuid)') is not null then 'OK' else 'STOP - apply 20270102000100 first' end
  union all select 6, 'Phase 2 deliverables and site schedule', case when to_regclass('public.proj_task_output_versions') is null then 'not installed yet' else 'already installed' end
  union all select 7, 'tasks that exist (information)', (select count(*)::text from proj_tasks)
  union all select 8, 'Site timeline items that exist (information; they keep working and gain the Tentative state)', (select count(*)::text from proj_plan_items where plan = 'site')
) x order by n;
