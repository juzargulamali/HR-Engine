-- READ ONLY. Run BEFORE applying 20270107000100_proj_phase2_teams_crew_ops_review.sql. Changes nothing.
-- Expect: rows 1 to 4 'OK'; row 5 'not installed yet' (or 'already installed' on a second run). Rows 6 to 9 are numbers for information.
select item, result from (
  select 1 as ord, 'Phase 2 (20270106000100) is applied: task output versions, site crew and shipments exist' as item,
         case when to_regclass('public.proj_task_output_versions') is not null and to_regclass('public.proj_site_crew') is not null and to_regclass('public.proj_site_shipments') is not null then 'OK' else 'STOP - apply 20270106000100 first' end as result
  union all select 2, 'the access helpers this migration builds on exist (proj_user_eligible, proj_dp_active_member, proj_add_member_row, proj_notify)',
         case when to_regprocedure('public.proj_user_eligible(uuid, uuid, uuid)') is not null and to_regprocedure('public.proj_dp_active_member(uuid, uuid)') is not null
                and to_regprocedure('public.proj_add_member_row(uuid, uuid, text, uuid, date)') is not null and to_regprocedure('public.proj_notify(uuid, uuid, text, jsonb, text, boolean)') is not null then 'OK' else 'STOP - an earlier Projects migration is missing' end
  union all select 3, 'the Operations overview read exists (Operations Phase 2B is applied)',
         case when to_regprocedure('public.ops_overview(uuid)') is not null or to_regprocedure('public.ops_overview_base(uuid)') is not null then 'OK' else 'STOP - apply 20270102000100 first' end
  union all select 4, 'the people tables this migration reads exist (employees, profiles)',
         case when to_regclass('public.employees') is not null and to_regclass('public.profiles') is not null then 'OK' else 'STOP' end
  union all select 5, 'this migration is not installed yet',
         case when exists (select 1 from information_schema.columns where table_name = 'proj_task_output_versions' and column_name = 'review_route') then 'already installed' else 'not installed yet' end
  union all select 6, 'information: teams on live projects (each keeps its lead; none is changed)', (select count(*)::text from proj_teams where removed_at is null)
  union all select 7, 'information: crew places already assigned (they keep working; none is changed)', (select count(*)::text from proj_site_crew)
  union all select 8, 'information: output versions already submitted (they stay on the team review; none is rerouted)', (select count(*)::text from proj_task_output_versions)
  union all select 9, 'information: people with the Operations capability (who can review versions the Project Manager submits)',
         (select count(distinct user_id)::text from proj_company_grants where revoked_at is null and 'operations' = any (capabilities))
) x order by ord;
