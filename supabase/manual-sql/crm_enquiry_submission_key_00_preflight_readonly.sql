-- READ ONLY. Run BEFORE applying 20270113000400_crm_enquiry_submission_key.sql. Changes nothing.
-- Expect: row 1 'OK'; row 2 'not installed yet' (or 'already installed' on a second run). Rows 3 and 4 are for information.
--   Row 3: enquiries today. None of them is changed and none gets an identifier (only enquiries saved from the new forms record one).
--   Row 4: enquiries that LOOK like an earlier double save: the same person, company, title and account, created within two minutes of each other. They are listed by
--          the second statement below, for the owner to review. The migration does not touch, merge or mark them: whether two alike enquiries are a mistake or two
--          real jobs is a decision for a person.
select item, result from (
  select 1 as ord, 'the enquiry create function this migration wraps exists, with the signature the deployed app calls' as item,
         case when to_regprocedure('public.crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text)') is not null
                   and to_regprocedure('public.crm_require_user()') is not null then 'OK'
              else 'STOP - crm_create_opportunity is missing or has another signature; do not apply' end as result
  union all select 2, 'this migration is not installed yet',
         case when to_regclass('public.crm_enquiry_submissions') is not null or to_regprocedure('public.crm_create_enquiry(jsonb, uuid, uuid)') is not null then 'already installed' else 'not installed yet' end
  union all select 3, 'information: enquiries today (none is changed)', (select count(*) from crm_opportunities)::text
  union all select 4, 'information: pairs that look like an earlier double save (same person, company, title and account within two minutes)',
         (select count(*) from crm_opportunities a join crm_opportunities b
            on b.created_by = a.created_by and b.company_id = a.company_id and lower(btrim(b.title)) = lower(btrim(a.title))
           and b.agency_org_id is not distinct from a.agency_org_id and b.client_org_id is not distinct from a.client_org_id
           and b.created_at > a.created_at and b.created_at <= a.created_at + interval '2 minutes')::text
) x order by ord;

-- The pairs behind row 4, for review (run on its own when row 4 is not 0). References and times only.
-- select a.reference as first_reference, b.reference as second_reference, a.created_at as first_created, b.created_at as second_created, a.stage as first_stage, b.stage as second_stage
--   from crm_opportunities a join crm_opportunities b
--     on b.created_by = a.created_by and b.company_id = a.company_id and lower(btrim(b.title)) = lower(btrim(a.title))
--    and b.agency_org_id is not distinct from a.agency_org_id and b.client_org_id is not distinct from a.client_org_id
--    and b.created_at > a.created_at and b.created_at <= a.created_at + interval '2 minutes'
--  order by a.created_at;
