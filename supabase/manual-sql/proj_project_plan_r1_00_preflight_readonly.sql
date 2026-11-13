-- READ ONLY. Run BEFORE applying 20270104000100_proj_project_plan_r1.sql. Changes nothing.
-- Expect: rows 1 to 4 'OK'; row 5 'not installed yet' (or 'already installed' on a second run); rows 6 and 7 are numbers for information.
select n, item, result from (
  select 1 as n, 'the Delivery Plan it extends is installed (migration 20261231000100: proj_dp_items, proj_dp_lines, proj_dp_plan)' as item,
         case when to_regclass('public.proj_dp_items') is not null and to_regclass('public.proj_dp_lines') is not null and to_regprocedure('public.proj_dp_plan(uuid)') is not null then 'OK' else 'STOP - apply 20261231000100 first' end as result
  union all select 2, 'the task functions it calls exist (proj_create_task, proj_update_task, proj_reassign_task, proj_set_task_dependencies)',
         case when to_regprocedure('public.proj_create_task(uuid, jsonb)') is not null and to_regprocedure('public.proj_update_task(uuid, jsonb, integer)') is not null
                   and to_regprocedure('public.proj_reassign_task(uuid, uuid, text)') is not null and to_regprocedure('public.proj_set_task_dependencies(uuid, uuid[])') is not null then 'OK' else 'STOP - the Projects migrations are missing' end
  union all select 3, 'milestones and task dependencies exist (proj_milestones, proj_task_dependencies)',
         case when to_regclass('public.proj_milestones') is not null and to_regclass('public.proj_task_dependencies') is not null then 'OK' else 'STOP - the Projects migrations are missing' end
  union all select 4, 'the migration after this one in the list (20270103000100 departments) is installed',
         case when to_regclass('public.departments') is not null then 'OK' else 'OK - departments are not installed here; Release 1 does not use them' end
  union all select 5, 'Release 1 (proj_dp_seed_scope)', case when to_regprocedure('public.proj_dp_seed_scope(uuid)') is null then 'not installed yet' else 'already installed' end
  union all select 6, 'INFO plan lines today (all in the original five sections; they keep working unchanged)', (select count(*) from proj_dp_lines where removed_at is null)::text
  union all select 7, 'INFO released plan lines (their tasks and equipment lines are never rewritten by this migration)', (select count(*) from proj_dp_lines where released_at is not null)::text
) x order by n;
