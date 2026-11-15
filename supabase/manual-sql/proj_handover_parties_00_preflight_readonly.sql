-- READ ONLY. Run BEFORE applying 20270113000100_proj_handover_parties.sql. Changes nothing.
-- Expect: rows 1 and 2 'OK'; row 3 'not installed yet' (or 'already installed' on a second run). Rows 4 to 7 are numbers for information: the migration changes NONE of these
-- rows and guesses nothing about them.
--   Row 4: accepted handovers. Their projects will say "Not recorded at handover" for the agency and the site contact, for good (an accepted brief is a frozen record).
--   Row 5: briefs already with the Project Manager or submitted. If they are accepted as they stand they also say "Not recorded at handover". To record the agency and a
--          contact on one of them, Sales saves or resubmits the brief (submitted) or answers a question (clarification) after the new app is deployed.
--   Row 6: drafts and briefs back with Sales. They take the agency the next time Sales saves or submits them.
--   Row 7: of the open briefs in rows 5 and 6, how many belong to an enquiry that HAS an agency (so the agency is what would be missing on the project).
select item, result from (
  select 1 as ord, 'the handover tables and functions this migration builds on exist (Projects handover, Sales contacts, Operations capability)' as item,
         case when to_regclass('public.proj_handovers') is not null and to_regclass('public.crm_contacts') is not null and to_regclass('public.crm_opportunity_contacts') is not null
                   and to_regclass('public.crm_organisations') is not null and to_regprocedure('public.proj_can_manage(uuid)') is not null
                   and to_regprocedure('public.proj_can_view_details(uuid)') is not null and to_regprocedure('public.proj_has_capability(uuid, text)') is not null
                   and to_regprocedure('public.proj_save_handover(uuid, jsonb, integer)') is not null and to_regprocedure('public.proj_accept_handover(uuid)') is not null
              then 'OK' else 'STOP - a prerequisite table or function is missing; do not apply' end as result
  union all select 2, 'the trigger that freezes an accepted handover is in place (the accepted brief is what the project shows)',
         case when exists (select 1 from pg_trigger where tgname = 'proj_handovers_frozen' and tgrelid = 'public.proj_handovers'::regclass and not tgisinternal) then 'OK'
              else 'STOP - proj_handovers_frozen is missing' end
  union all select 3, 'this migration is not installed yet',
         case when to_regclass('public.proj_handover_site_contacts') is not null or to_regprocedure('public.proj_project_handover(uuid)') is not null then 'already installed' else 'not installed yet' end
  union all select 4, 'information: accepted handovers (their projects will read "Not recorded at handover")',
         (select count(*) from proj_handovers where status = 'accepted')::text
  union all select 5, 'information: briefs with the Project Manager / submitted and waiting for one (accepted as they stand = not recorded)',
         (select count(*) from proj_handovers where status = 'pm_assigned')::text || ' / ' || (select count(*) from proj_handovers where status = 'submitted')::text
  union all select 6, 'information: drafts / briefs back with Sales after a question (take the agency at the next save or submission)',
         (select count(*) from proj_handovers where status = 'draft')::text || ' / ' || (select count(*) from proj_handovers where status = 'clarification_requested')::text
  union all select 7, 'information: open briefs (rows 5 and 6) whose enquiry has an agency',
         (select count(*) from proj_handovers h join crm_opportunities o on o.id = h.crm_opportunity_id
           where h.status in ('draft', 'submitted', 'pm_assigned', 'clarification_requested') and o.agency_org_id is not null)::text
) x order by ord;

-- Run this second statement on its own if you want the list behind row 5: the briefs already submitted or with the Project Manager whose enquiry has an agency, for the
-- owner to decide whether Sales should resubmit them before they are accepted (references only, no client data).
-- select h.crm_reference as "Sales reference", h.status as "handover status", h.submitted_at as "submitted"
--   from proj_handovers h join crm_opportunities o on o.id = h.crm_opportunity_id
--  where h.status in ('submitted', 'pm_assigned') and o.agency_org_id is not null
--  order by h.submitted_at nulls last;
