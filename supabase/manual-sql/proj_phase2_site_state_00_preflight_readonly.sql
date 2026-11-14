-- READ ONLY. Run BEFORE applying 20270109000100_proj_phase2_site_state.sql. Changes nothing.
-- Expect: rows 1 to 3 'OK'; row 4 'not installed yet' (or 'already installed' on a second run). Rows 5 and 6 are numbers for information.
select item, result from (
  select 1 as ord, 'the three earlier Phase 2 migrations are installed (outputs, crew, review route, the briefing functions)' as item,
         case when to_regprocedure('public.proj_site_briefing(uuid)') is not null and to_regprocedure('public.proj_activity_effective(uuid)') is not null and to_regprocedure('public.proj_my_site_assignments()') is not null
                   and exists (select 1 from information_schema.columns where table_name = 'proj_task_output_versions' and column_name = 'review_route') then 'OK'
              else 'STOP - apply 20270106000100, 20270107000100 and 20270108000100 first' end as result
  union all select 2, 'the functions and tables this migration reads exist',
         case when to_regprocedure('public.inv_request_state(uuid)') is not null and to_regprocedure('public.proj_notify(uuid, uuid, text, jsonb, text, boolean)') is not null
                   and to_regprocedure('public.proj_display_name(uuid)') is not null and to_regprocedure('public.proj_dp_active_member(uuid, uuid)') is not null
                   and to_regclass('public.proj_dp_lines') is not null and to_regclass('public.proj_site_shipments') is not null and to_regclass('public.inv_request_lines') is not null then 'OK' else 'STOP - something it uses is missing' end
  union all select 3, 'the notifications table accepts a new type (no type check blocks project_site_change)',
         case when not exists (select 1 from pg_constraint where conrelid = 'public.notifications'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%type%in%(%') then 'OK' else 'STOP - notification types are restricted by a check: add project_site_change first' end
  union all select 4, 'this migration is not installed yet',
         case when to_regprocedure('public.proj_preview_site_assignment(uuid, uuid)') is not null then 'already installed' else 'not installed yet' end
  union all select 5, 'information: open site activities / of which have a date passed and no explicit start record',
         (select count(*) from proj_plan_items where plan = 'site' and status not in ('done', 'cancelled'))::text || ' / '
         || (select count(*) from proj_plan_items i where i.plan = 'site' and i.status not in ('done', 'cancelled') and coalesce(i.start_date, (i.starts_at at time zone coalesce(i.tz, 'UTC'))::date) < current_date)::text
  union all select 6, 'information: confirmed activities with crew (their later moves will notify the crew) / crew places with a call time',
         (select count(distinct i.id) from proj_plan_items i join proj_site_crew c on c.plan_item_id = i.id where i.plan = 'site' and i.activity_state = 'confirmed')::text || ' / '
         || (select count(*) from proj_site_crew where call_at is not null)::text
) x order by ord;
