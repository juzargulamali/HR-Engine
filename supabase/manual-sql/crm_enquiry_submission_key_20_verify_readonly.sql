-- READ ONLY. Run AFTER 20270112000400_crm_enquiry_submission_key.sql. Rows 1 to 5 must say OK; row 6 is a count for information. Creates no row.
select item, result from (
  select 1 as ord, 'the submissions table exists with its primary key on (person, identifier), row level security is on and it has NO policy' as item,
         case when to_regclass('public.crm_enquiry_submissions') is not null
                   and (select relrowsecurity from pg_class where oid = 'public.crm_enquiry_submissions'::regclass)
                   and not exists (select 1 from pg_policy where polrelid = 'public.crm_enquiry_submissions'::regclass)
                   and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.crm_enquiry_submissions'::regclass and contype = 'p') = 'PRIMARY KEY (created_by, submission_key)'
              then 'OK' else 'FAIL - table, key, row level security or policies differ' end as result
  union all select 2, 'crm_create_enquiry exists, signed-in users can call it, anon cannot',
         case when to_regprocedure('public.crm_create_enquiry(jsonb, uuid, uuid)') is not null and has_function_privilege('authenticated', 'public.crm_create_enquiry(jsonb, uuid, uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.crm_create_enquiry(jsonb, uuid, uuid)', 'execute') then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 3, 'the internal helper exists and is not callable by anon or signed-in users',
         case when to_regprocedure('public.crm_create_opportunity_json(jsonb)') is not null and not has_function_privilege('authenticated', 'public.crm_create_opportunity_json(jsonb)', 'execute')
                   and not has_function_privilege('anon', 'public.crm_create_opportunity_json(jsonb)', 'execute') then 'OK' else 'FAIL - helper missing or callable' end
  union all select 4, 'the existing create function keeps the signature the deployed app and JARVIS call, and signed-in users can still call it',
         case when to_regprocedure('public.crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text)') is not null
                   and has_function_privilege('authenticated', 'public.crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text)', 'execute')
              then 'OK' else 'FAIL - the existing function changed' end
  union all select 5, 'every recorded identifier points to an enquiry created by the same person',
         case when not exists (select 1 from crm_enquiry_submissions s join crm_opportunities o on o.id = s.opportunity_id where o.created_by <> s.created_by) then 'OK'
              else 'FAIL - an identifier points to somebody else''s enquiry' end
  union all select 6, 'information: enquiries saved with an identifier so far', (select count(*) from crm_enquiry_submissions)::text
) x order by ord;
