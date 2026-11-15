-- READ ONLY. Run BEFORE applying 20270112000300_crm_outreach_conversion.sql. Changes nothing.
-- Expect: rows 1 and 2 'OK'; row 3 'not installed yet' (or 'already installed' on a second run). Rows 4 to 7 are numbers for information.
--   Row 2 must be OK: every enquiry's source is one of the eight existing values, so the widened check accepts every existing row. The migration changes NO enquiry.
--   Row 4: enquiries by source today (they keep their source).
--   Row 5: outreach already linked to an enquiry (they stay linked; from now on that link cannot be moved to another enquiry).
--   Row 6: enquiries linked from MORE THAN ONE outreach, and outreach whose linked enquiry is not on the outreach's account or company. Both should be 0. If not,
--          the second statement below lists them: they are left exactly as they are (nothing is repaired or guessed) and are for the owner to review.
--   Row 7: open outreach on accounts with no contact, exactly one contact, several contacts (with several, staff now choose which one the enquiry is from).
select item, result from (
  select 1 as ord, 'the outreach tables and the functions this migration builds on exist' as item,
         case when to_regclass('public.crm_outreach') is not null and to_regclass('public.crm_contacts') is not null
                   and to_regprocedure('public.crm_outreach_acting_on(uuid, boolean)') is not null and to_regprocedure('public.crm_outreach_link_inquiry(uuid, uuid)') is not null
                   and to_regprocedure('public.crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text)') is not null
              then 'OK' else 'STOP - apply 20261219000100_crm_clients_agencies.sql first' end as result
  union all select 2, 'every enquiry has one of the eight existing sources',
         case when not exists (select 1 from crm_opportunities where source not in ('agency_call', 'linkedin', 'direct_client', 'whatsapp', 'instagram', 'website', 'referral', 'other', 'outreach'))
              then 'OK' else 'STOP - an enquiry has an unexpected source; do not apply' end
  union all select 3, 'this migration is not installed yet',
         case when to_regprocedure('public.crm_create_enquiry_from_outreach(uuid, jsonb)') is not null then 'already installed' else 'not installed yet' end
  union all select 4, 'information: enquiries by source',
         coalesce((select string_agg(source || ' ' || n::text, ', ' order by source) from (select source, count(*) n from crm_opportunities group by source) s), 'none')
  union all select 5, 'information: outreach linked to an enquiry / open outreach not linked',
         (select count(*) from crm_outreach where opportunity_id is not null)::text || ' / ' || (select count(*) from crm_outreach where opportunity_id is null and status <> 'closed')::text
  union all select 6, 'information: enquiries linked from more than one outreach / outreach linked to an enquiry of another account or company (both should be 0)',
         (select count(*) from (select opportunity_id from crm_outreach where opportunity_id is not null group by opportunity_id having count(*) > 1) d)::text || ' / '
           || (select count(*) from crm_outreach o join crm_opportunities x on x.id = o.opportunity_id
                where x.company_id <> o.company_id or (x.agency_org_id is distinct from o.organisation_id and x.client_org_id is distinct from o.organisation_id))::text
  union all select 7, 'information: open outreach on accounts with no contact / one contact / several contacts',
         (select count(*) filter (where n = 0)::text || ' / ' || count(*) filter (where n = 1)::text || ' / ' || count(*) filter (where n > 1)::text
            from (select o.id, (select count(*) from crm_contacts c where c.organisation_id = o.organisation_id and c.archived_at is null) n
                    from crm_outreach o where o.status <> 'closed') t)
) x order by ord;

-- The records behind row 6, for review (run on its own when row 6 is not "0 / 0"). Nothing is changed by the migration for these.
-- select o.id as outreach_id, o.status, o.opportunity_id, x.reference, (x.company_id = o.company_id) as same_company,
--        (x.agency_org_id = o.organisation_id or x.client_org_id = o.organisation_id) as same_account,
--        (select count(*) from crm_outreach o2 where o2.opportunity_id = o.opportunity_id) as outreach_on_this_enquiry
--   from crm_outreach o join crm_opportunities x on x.id = o.opportunity_id
--  where x.company_id <> o.company_id or (x.agency_org_id is distinct from o.organisation_id and x.client_org_id is distinct from o.organisation_id)
--     or (select count(*) from crm_outreach o2 where o2.opportunity_id = o.opportunity_id) > 1
--  order by x.reference;
