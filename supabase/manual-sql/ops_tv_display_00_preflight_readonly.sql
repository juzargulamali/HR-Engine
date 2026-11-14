-- READ ONLY. Run BEFORE applying 20270110000100_ops_tv_display.sql. Changes nothing.
-- Expect: rows 1 and 2 'OK'; row 3 'not installed yet' (or 'already installed' on a second run). Rows 4 to 6 are numbers for information.
select item, result from (
  select 1 as ord, 'the Phase 2 site-state migration (20270109000100) is installed: phase, effective date / venue and scoped readiness functions exist' as item,
         case when to_regprocedure('public.proj_site_phase_json(uuid)') is not null and to_regprocedure('public.proj_activity_effective(uuid)') is not null
                   and to_regprocedure('public.proj_readiness_run_area(uuid, text)') is not null and to_regprocedure('public.proj_readiness_project_area(uuid, text)') is not null
                   and to_regprocedure('public.proj_site_activities_read(uuid, uuid, integer)') is not null then 'OK'
              else 'STOP - apply 20270109000100_proj_phase2_site_state.sql first' end as result
  union all select 2, 'the tables and functions this migration reads exist (Inventory request state, Operations capability checks, plans, shipments, handovers, grants)',
         case when to_regprocedure('public.inv_request_state(uuid)') is not null and to_regprocedure('public.proj_has_capability(uuid, text)') is not null
                   and to_regprocedure('public.ops_require(uuid)') is not null and to_regprocedure('public.proj_valid_timezone(text)') is not null
                   and to_regclass('public.proj_dp_items') is not null and to_regclass('public.proj_site_shipments') is not null and to_regclass('public.proj_handovers') is not null
                   and to_regclass('public.proj_site_crew') is not null and to_regclass('public.proj_company_grants') is not null and to_regclass('public.crm_company_grants') is not null
                   and to_regclass('public.inv_company_grants') is not null and to_regclass('public.pbx_company_grants') is not null and to_regclass('public.user_roles') is not null
                   and to_regclass('public.employees') is not null and to_regclass('public.inv_requests') is not null then 'OK'
              else 'STOP - a prerequisite table or function is missing; do not apply' end
  union all select 3, 'this migration is not installed yet',
         case when to_regclass('public.ops_tv_displays') is not null or to_regprocedure('public.ops_tv_board(uuid)') is not null then 'already installed' else 'not installed yet' end
  union all select 4, 'information: open site activities in live projects (what the board would read)',
         (select count(*) from proj_plan_items i join proj_projects p on p.id = i.project_id where i.plan = 'site' and i.status not in ('done', 'cancelled') and p.status not in ('completed', 'archived'))::text
  union all select 5, 'information: shipments / handovers waiting for acceptance',
         (select count(*) from proj_site_shipments)::text || ' / ' || (select count(*) from proj_handovers where status in ('submitted', 'pm_assigned', 'clarification_requested'))::text
  union all select 6, 'information: people who can open the board once installed (Operations Managers and founders, active grants)',
         (select count(distinct g.user_id) from proj_company_grants g where g.revoked_at is null and ('founder' = any (g.capabilities) or 'operations' = any (g.capabilities)))::text
) x order by ord;
