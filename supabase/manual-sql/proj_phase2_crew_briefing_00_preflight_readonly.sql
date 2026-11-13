-- READ ONLY. Run BEFORE applying 20270108000100_proj_phase2_crew_briefing.sql. Changes nothing.
-- Expect: rows 1 to 3 'OK'; row 4 'not installed yet' (or 'already installed' on a second run). Rows 5 and 6 are numbers for information.
select item, result from (
  select 1 as ord, 'both Phase 2 migrations are installed (task output versions, crew, the technician read, the review route)' as item,
         case when to_regclass('public.proj_task_output_versions') is not null and to_regclass('public.proj_site_crew') is not null and to_regprocedure('public.proj_my_site_assignments()') is not null
                   and exists (select 1 from information_schema.columns where table_name = 'proj_task_output_versions' and column_name = 'review_route') then 'OK'
              else 'STOP - apply 20270106000100 and 20270107000100 first' end as result
  union all select 2, 'the functions this migration reads exist',
         case when to_regprocedure('public.inv_request_state(uuid)') is not null and to_regprocedure('public.proj_dp_active_member(uuid, uuid)') is not null and to_regprocedure('public.proj_lock_project(uuid)') is not null
                   and to_regprocedure('public.proj_require_manager(proj_projects)') is not null and to_regprocedure('public.proj_site_technician_eligible(uuid, uuid)') is not null then 'OK' else 'STOP - a function it uses is missing' end
  union all select 3, 'the Project Plan tables it reads exist',
         case when to_regclass('public.proj_dp_lines') is not null and to_regclass('public.inv_request_lines') is not null and to_regclass('public.proj_project_details') is not null then 'OK' else 'STOP' end
  union all select 4, 'this migration is not installed yet',
         case when to_regprocedure('public.proj_site_briefing(uuid)') is not null then 'already installed' else 'not installed yet' end
  union all select 5, 'information: open site activities / of which have no venue of their own / have no date or time of their own',
         (select count(*) from proj_plan_items where plan = 'site' and status not in ('done', 'cancelled'))::text || ' / '
         || (select count(*) from proj_plan_items where plan = 'site' and status not in ('done', 'cancelled') and nullif(btrim(coalesce(location, '')), '') is null)::text || ' / '
         || (select count(*) from proj_plan_items where plan = 'site' and status not in ('done', 'cancelled') and start_date is null and starts_at is null)::text
  union all select 6, 'information: crew places without a personal call time / activities with a readiness value set by hand',
         (select count(*) from proj_site_crew where call_at is null)::text || ' / '
         || (select count(*) from proj_plan_items where plan = 'site' and (ready_hardware <> 'unknown' or ready_content <> 'unknown' or ready_app <> 'unknown'))::text
) x order by ord;
