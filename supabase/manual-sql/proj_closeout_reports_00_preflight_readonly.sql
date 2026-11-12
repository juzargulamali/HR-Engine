-- READ ONLY. Run BEFORE applying 20270101000100_proj_closeout_reports.sql. Changes nothing.
-- Expect: rows 1 and 2 'OK'; row 3 'OK' (either wording); row 4 'not installed yet' (or 'already installed' on a second run); row 5 is a number for information.
select n, item, result from (
  select 1 as n, 'the Projects tables and functions it reads exist (projects, details, members, teams, tasks, milestones, handovers, feedback, scope changes, completions, proj_can_manage, proj_display_name)' as item,
         case when to_regclass('public.proj_projects') is not null and to_regclass('public.proj_project_details') is not null and to_regclass('public.proj_project_members') is not null
                   and to_regclass('public.proj_teams') is not null and to_regclass('public.proj_tasks') is not null and to_regclass('public.proj_milestones') is not null
                   and to_regclass('public.proj_handovers') is not null and to_regclass('public.proj_feedback') is not null and to_regclass('public.proj_scope_changes') is not null
                   and to_regclass('public.proj_completions') is not null and to_regprocedure('public.proj_can_manage(uuid)') is not null and to_regprocedure('public.proj_display_name(uuid)') is not null
              then 'OK' else 'STOP - the Projects migrations are missing' end as result
  union all select 2, 'the Delivery Plan is installed (migration 28 comes before this one)',
         case when to_regclass('public.proj_dp_items') is not null and to_regclass('public.proj_dp_lines') is not null and to_regclass('public.proj_dp_changes') is not null
                   and to_regclass('public.proj_dp_corrections') is not null then 'OK' else 'STOP - apply 20261231000100 first' end
  union all select 3, 'Inventory planning is installed (equipment sent and returned is read from it); without it the report says equipment is not known',
         case when to_regclass('public.inv_requests') is not null and to_regclass('public.inv_reservations') is not null then 'OK' else 'OK - Inventory is not installed: the report will say equipment is not known' end
  union all select 4, 'proj_closeout_evidence', case when to_regprocedure('public.proj_closeout_evidence(uuid)') is null then 'not installed yet' else 'already installed' end
  union all select 5, 'INFO projects (each can have a closeout report)', (select count(*) from proj_projects)::text
) x order by n;
