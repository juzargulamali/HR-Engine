-- READ ONLY. Run BEFORE applying 20261231000100_proj_delivery_plan.sql. Changes nothing.
-- Expect: rows 1 to 3 'OK'; row 4 'not installed yet' (or 'already installed' on a second run); row 5 is a number for information.
select n, item, result from (
  select 1 as n, 'the Projects tables and functions it uses exist (proj_projects, proj_project_members, proj_tasks, proj_files, proj_create_task, proj_can_manage, proj_notify)' as item,
         case when to_regclass('public.proj_projects') is not null and to_regclass('public.proj_project_members') is not null and to_regclass('public.proj_tasks') is not null
                   and to_regclass('public.proj_files') is not null and to_regprocedure('public.proj_create_task(uuid, jsonb)') is not null
                   and to_regprocedure('public.proj_can_manage(uuid)') is not null and to_regproc('public.proj_notify') is not null then 'OK' else 'STOP - the Projects migrations are missing' end as result
  union all select 2, 'Project chat groups are installed (migration 27 comes before this one)',
         case when to_regprocedure('public.chat_project_group(uuid)') is not null then 'OK' else 'STOP - apply 20261230000100 first' end
  union all select 3, 'Inventory planning is installed (hardware lines go to the draft equipment request); without it the plan still works and hardware lines wait',
         case when to_regclass('public.inv_requests') is not null and to_regprocedure('public.inv_add_request_line(uuid, uuid, numeric, text, integer)') is not null then 'OK' else 'OK - Inventory is not installed: hardware lines cannot be released here' end
  union all select 4, 'proj_dp_plan', case when to_regprocedure('public.proj_dp_plan(uuid)') is null then 'not installed yet' else 'already installed' end
  union all select 5, 'INFO projects that are open (each can have a delivery plan)', (select count(*) from proj_projects where status not in ('completed', 'archived'))::text
) x order by n;
