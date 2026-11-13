-- READ ONLY. Run AFTER 20270108000100_proj_phase2_crew_briefing.sql. Every row must say OK except row 6, which is a count for information. Creates no row.
select item, result from (
  select 1 as ord, 'the new functions exist; signed-in users can call the two public ones and the two replaced ones; anon cannot; the internal helpers are not callable' as item,
         case when (select count(*) from (values ('public.proj_site_briefing(uuid)'), ('public.proj_apply_project_dates(uuid)'), ('public.proj_my_site_assignments()'), ('public.proj_set_activity_readiness(uuid, jsonb)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')) = 4
              and not has_function_privilege('authenticated', 'public.proj_activity_effective(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.proj_activity_readiness_effective(uuid)', 'execute')
              and not has_function_privilege('authenticated', 'public.proj_readiness_area(uuid, text)', 'execute')
              then 'OK' else 'FAIL - missing or privileges differ' end as result
  union all select 2, 'readiness may be marked Not applicable (the check accepts it) and still refuses anything else',
         case when exists (select 1 from pg_constraint where conname = 'proj_plan_items_readiness' and pg_get_constraintdef(oid) like '%not_applicable%') then 'OK' else 'FAIL - the old check' end
  union all select 3, 'the technician read carries the effective venue, date and readiness, and still reads no task, file or chat table itself',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_my_site_assignments()')) like '%proj_activity_effective%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_my_site_assignments()')) like '%proj_activity_readiness_effective%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_my_site_assignments()')) not like '%proj_files%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_my_site_assignments()')) not like '%proj_tasks%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_my_site_assignments()')) not like '%proj_task_output_versions%' then 'OK' else 'FAIL - old function body' end
  union all select 4, 'the project dates are borrowed only for an unambiguous link: the rule counts the activities of the kind and the Project Manager copies a date with proj_apply_project_dates',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_activity_effective(uuid)')) like '%v_n = 1%'
                   and to_regprocedure('public.proj_apply_project_dates(uuid)') is not null then 'OK' else 'FAIL' end
  union all select 5, 'the readiness helpers return counts and states only (no line text, task title or file name is in their result)',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_readiness_area(uuid, text)')) not like '%description%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_readiness_area(uuid, text)')) not like '%title%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_readiness_area(uuid, text)')) not like '%label%' then 'OK' else 'FAIL' end
  union all select 6, 'information: activities that borrow the project venue / the project date / still need the Project Manager to choose a run / hand-set readiness values marked Not applicable',
         (select count(*) from proj_plan_items i where i.plan = 'site' and i.status not in ('done', 'cancelled') and proj_activity_effective(i.id) ->> 'venue_source' = 'project')::text || ' / '
         || (select count(*) from proj_plan_items i where i.plan = 'site' and i.status not in ('done', 'cancelled') and proj_activity_effective(i.id) ->> 'date_source' = 'project')::text || ' / '
         || (select count(*) from proj_plan_items i where i.plan = 'site' and i.status not in ('done', 'cancelled') and (proj_activity_effective(i.id) ->> 'choice_pending')::boolean)::text || ' / '
         || (select count(*) from proj_plan_items where plan = 'site' and (ready_hardware = 'not_applicable' or ready_content = 'not_applicable' or ready_app = 'not_applicable'))::text
) x order by ord;
