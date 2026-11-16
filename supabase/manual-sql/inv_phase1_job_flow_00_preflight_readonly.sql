-- READ ONLY. Run BEFORE applying 20270114000100_inv_phase1_job_flow.sql. Changes nothing.
-- Expect: row 1 'OK'; row 2 'not installed yet' (or 'already installed' on a second run). Rows 3 to 7 are numbers for information.
--   Row 8 lists EVERY active company with its legal name, its country and the short name the Phase 1 screens will show for it in Inventory (a display name only: the
--   legal name stays on documents and in company settings, and nothing in the database is renamed). Expected: one company per short name, "Enginious UAE" (AE),
--   "Enginious Saudi Arabia" (SA), "Enginious Europe" (a European country). A company marked "(legal name kept: ...)" shares its country group with another company, or
--   is in a country outside the list: the screens show its legal name so that two companies are never given the same short name. Say so if a name on this row is not
--   what you expect before the Phase 1 build is deployed.
-- The second statement lists the warehouses and other locations of each company, as the selector will offer them under that company.
select item, result from (
  select 1 as ord, 'the tables and functions this migration builds on exist (requests, reservations, site schedule, request state, Operations check)' as item,
         case when to_regclass('public.inv_reservations') is not null and to_regclass('public.inv_requests') is not null and to_regclass('public.proj_plan_items') is not null
                   and to_regclass('public.inv_availability_checks') is not null and to_regclass('public.inv_idempotency') is not null
                   and to_regprocedure('public.inv_request_state(uuid)') is not null and to_regprocedure('public.ops_require(uuid)') is not null
                   and to_regprocedure('public.inv_idem_begin(uuid, text, text, jsonb)') is not null and to_regprocedure('public.inv_lock_request(uuid)') is not null
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proj_plan_items' and column_name = 'activity_kind')
              then 'OK' else 'STOP - apply the Inventory, Operations (20270102000100) and Phase 2 site schedule (20270106000100) migrations first' end as result
  union all select 2, 'this migration is not installed yet',
         case when to_regprocedure('public.inv_pick_for_request(uuid, uuid, uuid, text, jsonb)') is not null then 'already installed' else 'not installed yet' end
  union all select 3, 'information: reservation rows that get the new picked quantity (all start at 0: nothing is marked picked by the migration)', (select count(*) from inv_reservations)::text
  union all select 4, 'information: project equipment requests that are live (submitted or in progress) / draft',
         (select count(*) filter (where status in ('submitted', 'in_progress'))::text || ' / ' || count(*) filter (where status = 'draft')::text from inv_requests where kind = 'project')
  union all select 5, 'information: site runs on the site schedules of live projects (what a request can be linked to)',
         (select count(*) from proj_plan_items i join proj_projects p on p.id = i.project_id where i.plan = 'site' and i.status <> 'cancelled' and p.status not in ('completed', 'archived'))::text
  union all select 6, 'information: recorded availability checks on enquiries / of which the enquiry became a project (what the Project Manager will now see)',
         (select count(*)::text || ' / ' || count(*) filter (where exists (select 1 from proj_projects p where p.crm_opportunity_id = c.opportunity_id))::text
            from inv_availability_checks c where c.result <> 'pending' and c.superseded_by is null)
  union all select 7, 'information: held for inspection now (damaged or needs checking, in a warehouse): units / counted rows - unchanged by this migration',
         (select count(*) from inv_units where custody_kind = 'warehouse' and lifecycle = 'active' and condition not in ('good', 'fair'))::text || ' / '
         || (select count(*) from inv_balances where holder_kind = 'warehouse' and condition <> 'good' and qty > 0)::text
  union all select 8, 'REVIEW: each active company -> the short name Inventory will show (legal name | country -> short name)',
         coalesce((select string_agg(n.legal_name || ' | ' || n.country_code || ' -> ' ||
                     case when n.short is null then '(legal name kept: country not in the list)'
                          when n.same > 1 then '(legal name kept: another company shares ' || n.short || ')'
                          else n.short end, '  ||  ' order by n.legal_name)
                   from (select c.legal_name, c.country_code, g.short, count(*) over (partition by g.short) as same
                           from companies c
                           cross join lateral (select case when upper(c.country_code) = 'AE' then 'Enginious UAE' when upper(c.country_code) = 'SA' then 'Enginious Saudi Arabia'
                                                           when upper(c.country_code) in ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','GB','CH','NO','IS')
                                                             then 'Enginious Europe' end as short) g
                          where c.deleted_at is null and c.is_active) n), 'no active company')
) x order by ord;

-- Warehouses and other locations per company, as the selector will list them under each company (names only; nothing is changed).
select c.legal_name as company, c.country_code as country, l.name as warehouse_or_location, l.kind, l.is_active
  from inv_locations l join companies c on c.id = l.company_id
 order by c.legal_name, l.name;
