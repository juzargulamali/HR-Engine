-- READ ONLY. Run BEFORE applying 20270113000200_ops_crew_overlaps.sql. Changes nothing.
-- Expect: row 1 'OK'; row 2 'not installed yet' (or 'already installed' on a second run). Rows 3 to 5 are numbers for information: what the new read would list.
--   Row 5 counts the overlaps that cross a company boundary. For those, an Operations Manager of only one of the two companies sees the other side as a time window with no
--   project name, title or link. Review the list printed by the second statement if the number surprises you (expected: usually 0 or very few).
select item, result from (
  select 1 as ord, 'the functions and tables this migration reads exist (Operations capability checks, activity window, crew, bookings)' as item,
         case when to_regprocedure('public.ops_require(uuid)') is not null and to_regprocedure('public.ops_company_ids()') is not null
                   and to_regprocedure('public.proj_activity_range(uuid)') is not null and to_regprocedure('public.proj_display_name(uuid)') is not null
                   and to_regclass('public.proj_site_crew') is not null and to_regclass('public.proj_site_bookings') is not null then 'OK'
              else 'STOP - apply the Operations and Phase 2 crew migrations first (20270102000100, 20270107000100)' end as result
  union all select 2, 'this migration is not installed yet',
         case when to_regprocedure('public.ops_crew_overlaps(uuid)') is not null then 'already installed' else 'not installed yet' end
  union all select 3, 'information: crew places on confirmed, unfinished site activities of live projects',
         (select count(*) from proj_site_crew s join proj_plan_items i on i.id = s.plan_item_id and i.plan = 'site' and i.activity_state = 'confirmed' and i.status not in ('done', 'cancelled')
            join proj_projects p on p.id = i.project_id and p.status not in ('completed', 'archived'))::text
  union all select 4, 'information: people with two such crew places whose windows overlap and are not wholly in the past (pairs)',
         (select count(distinct (a.user_id, a.plan_item_id, b.plan_item_id)) from proj_site_crew a join proj_plan_items ia on ia.id = a.plan_item_id and ia.plan = 'site' and ia.activity_state = 'confirmed' and ia.status not in ('done', 'cancelled')
            join proj_projects pa on pa.id = ia.project_id and pa.status not in ('completed', 'archived')
            join proj_site_crew b on b.user_id = a.user_id and b.plan_item_id > a.plan_item_id
            join proj_plan_items ib on ib.id = b.plan_item_id and ib.plan = 'site' and ib.activity_state = 'confirmed' and ib.status not in ('done', 'cancelled')
            join proj_projects pb on pb.id = ib.project_id and pb.status not in ('completed', 'archived')
           where proj_activity_range(ia.id) && proj_activity_range(ib.id) and upper(proj_activity_range(ia.id)) > now() and upper(proj_activity_range(ib.id)) > now())::text
  union all select 5, 'information: of those, pairs that cross a company boundary (listed below)',
         (select count(distinct (a.user_id, a.plan_item_id, b.plan_item_id)) from proj_site_crew a join proj_plan_items ia on ia.id = a.plan_item_id and ia.plan = 'site' and ia.activity_state = 'confirmed' and ia.status not in ('done', 'cancelled')
            join proj_projects pa on pa.id = ia.project_id and pa.status not in ('completed', 'archived')
            join proj_site_crew b on b.user_id = a.user_id and b.plan_item_id > a.plan_item_id
            join proj_plan_items ib on ib.id = b.plan_item_id and ib.plan = 'site' and ib.activity_state = 'confirmed' and ib.status not in ('done', 'cancelled')
            join proj_projects pb on pb.id = ib.project_id and pb.status not in ('completed', 'archived')
           where pa.company_id <> pb.company_id and proj_activity_range(ia.id) && proj_activity_range(ib.id) and upper(proj_activity_range(ia.id)) > now() and upper(proj_activity_range(ib.id)) > now())::text
) x order by ord;

-- Cross-company pairs for the owner to review (expected: none or very few). Ids only: no names are printed by this pack.
select distinct a.user_id, ia.project_id as project_a, ia.id as activity_a, ib.project_id as project_b, ib.id as activity_b
  from proj_site_crew a join proj_plan_items ia on ia.id = a.plan_item_id and ia.plan = 'site' and ia.activity_state = 'confirmed' and ia.status not in ('done', 'cancelled')
  join proj_projects pa on pa.id = ia.project_id and pa.status not in ('completed', 'archived')
  join proj_site_crew b on b.user_id = a.user_id and b.plan_item_id > a.plan_item_id
  join proj_plan_items ib on ib.id = b.plan_item_id and ib.plan = 'site' and ib.activity_state = 'confirmed' and ib.status not in ('done', 'cancelled')
  join proj_projects pb on pb.id = ib.project_id and pb.status not in ('completed', 'archived')
 where pa.company_id <> pb.company_id and proj_activity_range(ia.id) && proj_activity_range(ib.id) and upper(proj_activity_range(ia.id)) > now() and upper(proj_activity_range(ib.id)) > now()
 order by 1, 3 limit 50;
