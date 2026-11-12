-- READ ONLY. Run BEFORE applying 20270102000100_ops_phase2b.sql. Changes nothing.
-- Expect: rows 1 to 5 'OK'; row 6 'not installed yet' (or 'already installed' on a second run); rows 7 and 8 are numbers for information.
select n, item, result from (
  select 1 as n, 'Projects, its handovers and its grants are installed (proj_company_grants, proj_handovers, proj_project_details, proj_capability_list, proj_has_capability)' as item,
         case when to_regclass('public.proj_company_grants') is not null and to_regclass('public.proj_handovers') is not null and to_regclass('public.proj_project_details') is not null
                   and to_regprocedure('public.proj_capability_list()') is not null and to_regprocedure('public.proj_has_capability(uuid, text)') is not null
              then 'OK' else 'STOP - the Projects migrations are missing' end as result
  union all select 2, 'Sales enquiries and event editions are installed (crm_opportunities.event_edition_id, crm_event_editions)',
         case when to_regclass('public.crm_event_editions') is not null
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_opportunities' and column_name = 'event_edition_id')
              then 'OK' else 'STOP - apply the Events migrations first' end
  union all select 3, 'Project chat groups are installed (migration 27)',
         case when to_regprocedure('public.chat_project_group(uuid)') is not null and to_regprocedure('public.chat_my_groups()') is not null then 'OK' else 'STOP - apply 20261230000100 first' end
  union all select 4, 'Inventory planning is installed (inv_requests, inv_request_lines, inv_reservations, inv_line_progress, inv_import_log)',
         case when to_regclass('public.inv_requests') is not null and to_regclass('public.inv_reservations') is not null and to_regclass('public.inv_import_log') is not null
                   and to_regproc('public.inv_line_progress') is not null then 'OK' else 'STOP - the Inventory migrations are missing' end
  union all select 5, 'The Delivery Plan and the Closeout Report are installed (migrations 28 and 29 come before this one)',
         case when to_regclass('public.proj_dp_corrections') is not null
                   and (to_regprocedure('public.proj_closeout_evidence(uuid)') is not null or to_regprocedure('public.proj_closeout_evidence_base(uuid)') is not null)
              then 'OK' else 'STOP - apply 20261231000100 and 20270101000100 first' end
  union all select 6, 'ops_overview', case when to_regprocedure('public.ops_overview(uuid)') is null then 'not installed yet' else 'already installed' end
  union all select 7, 'INFO open handovers that will take their enquiry''s event edition now (accepted ones stay as they are)',
         (select count(*) from proj_handovers h join crm_opportunities o on o.id = h.crm_opportunity_id
           where o.event_edition_id is not null and h.status in ('draft', 'submitted', 'pm_assigned', 'clarification_requested'))::text
  union all select 8, 'INFO people who hold assign_pm today (Operations Manager is a separate capability; nobody receives it from this migration)',
         (select count(distinct user_id) from proj_company_grants where revoked_at is null and 'assign_pm' = any (capabilities))::text
) x order by n;
