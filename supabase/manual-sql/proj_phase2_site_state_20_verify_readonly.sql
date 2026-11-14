-- READ ONLY. Run AFTER 20270109000100_proj_phase2_site_state.sql. Every row must say OK except row 7, which is a count for information. Creates no row.
select item, result from (
  select 1 as ord, 'the public functions exist, signed-in users can call them, anon cannot; the internal helpers are not callable' as item,
         case when (select count(*) from (values ('public.proj_record_site_start(uuid, timestamptz, text)'), ('public.proj_clear_site_start(uuid)'), ('public.proj_my_site_assignments()'), ('public.proj_preview_site_assignment(uuid, uuid)'),
              ('public.proj_site_briefing(uuid)'), ('public.proj_site_activities_read(uuid, uuid, integer)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')) = 6
              and not has_function_privilege('authenticated', 'public.proj_site_phase_json(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.proj_site_assignment_json(uuid, uuid)', 'execute')
              and not has_function_privilege('authenticated', 'public.proj_readiness_run_area(uuid, text)', 'execute') and not has_function_privilege('authenticated', 'public.proj_readiness_project_area(uuid, text)', 'execute')
              and not has_function_privilege('authenticated', 'public.proj_site_activity_moved()', 'execute') then 'OK' else 'FAIL - missing or privileges differ' end as result
  union all select 2, 'the explicit start record exists and is the ONLY way an activity counts as started (the phase function reads actual_started_at, never a date)',
         case when exists (select 1 from information_schema.columns where table_name = 'proj_plan_items' and column_name = 'actual_started_at')
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_site_phase_json(uuid)')) like '%i.actual_started_at is not null then ''started''%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_site_phase_json(uuid)')) like '%date_passed%' then 'OK' else 'FAIL' end
  union all select 3, 'the technician read and the Project Manager preview use the same function, and the technician read still reads no task, file or chat table itself',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_my_site_assignments()')) like '%proj_site_assignment_json%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_preview_site_assignment(uuid, uuid)')) like '%proj_site_assignment_json%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_site_assignment_json(uuid, uuid)')) not like '%proj_files%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_site_assignment_json(uuid, uuid)')) not like '%proj_tasks%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_site_assignment_json(uuid, uuid)')) not like '%proj_task_output_versions%' then 'OK' else 'FAIL - old function body' end
  union all select 4, 'readiness is scoped: content and app need an APPROVED output version, hardware needs an Inventory request state, never a finished task alone; project-wide and run-specific are separate',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_readiness_eval(uuid, text, uuid)')) like '%v.status = ''approved''%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_readiness_eval(uuid, text, uuid)')) not like '%status = ''done''%'
                   and to_regprocedure('public.proj_readiness_run_area(uuid, text)') is not null and to_regprocedure('public.proj_readiness_project_area(uuid, text)') is not null then 'OK' else 'FAIL' end
  union all select 5, 'the crew notice triggers exist (a confirmed date or venue moving, and a personal call time moving)',
         case when exists (select 1 from pg_trigger where tgname = 'trg_proj_site_activity_moved' and not tgisinternal) and exists (select 1 from pg_trigger where tgname = 'trg_proj_site_call_moved' and not tgisinternal) then 'OK' else 'FAIL' end
  union all select 6, 'no activity is recorded as started in the future',
         case when not exists (select 1 from proj_plan_items where actual_started_at > now() + interval '1 hour') then 'OK' else 'FAIL' end
  union all select 7, 'information: activities with an explicit start record / assignments that would read project-header dates only (no own date)',
         (select count(*) from proj_plan_items where actual_started_at is not null)::text || ' / '
         || (select count(*) from proj_plan_items i where i.plan = 'site' and i.status not in ('done', 'cancelled') and proj_site_phase_json(i.id) ->> 'basis' = 'project_header')::text
) x order by ord;
