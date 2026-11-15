-- READ ONLY. Run AFTER 20270113000300_crm_outreach_conversion.sql. Rows 1 to 6 must say OK; row 7 is a count for information. Creates no row.
select item, result from (
  select 1 as ord, 'crm_outreach has the contact column' as item,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_outreach' and column_name = 'contact_id') then 'OK'
              else 'FAIL - column missing' end as result
  union all select 2, 'the enquiry source check accepts the eight existing sources and outreach, and is the only source check',
         case when (select count(*) from pg_constraint where conrelid = 'public.crm_opportunities'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%agency_call%') = 1
                   and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.crm_opportunities'::regclass and conname = 'crm_opportunities_source_check') like '%outreach%'
                   and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.crm_opportunities'::regclass and conname = 'crm_opportunities_source_check') like '%referral%'
              then 'OK' else 'FAIL - the source check differs' end
  union all select 3, 'the guard that keeps one enquiry per outreach is on crm_outreach',
         case when exists (select 1 from pg_trigger where tgname = 'trg_crm_outreach_one_enquiry' and tgrelid = 'public.crm_outreach'::regclass and not tgisinternal and tgenabled <> 'D') then 'OK'
              else 'FAIL - trigger missing or disabled' end
  union all select 4, 'the two public functions exist, signed-in users can call them, anon cannot',
         case when (select count(*) from (values ('public.crm_outreach_set_contact(uuid, uuid)'), ('public.crm_create_enquiry_from_outreach(uuid, jsonb)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')) = 2
              then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 5, 'the internal helper exists and is not callable by anon or signed-in users; the existing create function is unchanged in signature',
         case when to_regprocedure('public.crm_create_opportunity_json(jsonb)') is not null and not has_function_privilege('authenticated', 'public.crm_create_opportunity_json(jsonb)', 'execute')
                   and not has_function_privilege('anon', 'public.crm_create_opportunity_json(jsonb)', 'execute')
                   and to_regprocedure('public.crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text)') is not null
                   and has_function_privilege('authenticated', 'public.crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text)', 'execute')
              then 'OK' else 'FAIL - helper callable, or the existing function is missing' end
  union all select 6, 'every outreach contact belongs to the outreach''s own account',
         case when not exists (select 1 from crm_outreach o join crm_contacts c on c.id = o.contact_id where c.organisation_id is distinct from o.organisation_id) then 'OK'
              else 'FAIL - an outreach names a contact of another account' end
  union all select 7, 'information: enquiries with the source Outreach / outreach with a contact chosen',
         (select count(*) from crm_opportunities where source = 'outreach')::text || ' / ' || (select count(*) from crm_outreach where contact_id is not null)::text
) x order by ord;
