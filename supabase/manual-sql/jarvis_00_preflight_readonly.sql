-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261223000100_jarvis_platform.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send the full result.
-- HOW TO READ IT: every section B row must say OK, and row 300 must say the change is NOT yet applied. Section C is information only.
-- The migration is purely additive: it adds jarvis_* tables and three jarvis_* functions and replaces NOTHING that exists. JARVIS stays OFF for everyone after it (see docs/jarvis-deployment.md).
select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text as detail
  union all select 'A session', 2, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 100 + row_number() over (order by t), 'table ' || t,
         case when to_regclass('public.' || t) is not null then 'OK' else 'MISSING - install the earlier Sales migrations first' end
    from unnest(array['companies', 'profiles', 'crm_opportunities', 'crm_company_grants', 'crm_organisations', 'crm_follow_ups', 'crm_opportunity_events', 'crm_reference_counters', 'crm_company_settings']) t
  union all select 'B prerequisites', 200 + row_number() over (order by f), 'function ' || f,
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'OK' else 'MISSING - install the earlier Sales migrations first' end
    from unnest(array['crm_create_opportunity', 'crm_has_access', 'crm_require_user', 'crm_log_event', 'crm_find_duplicate_candidates', 'crm_organisation_roles', 'crm_opportunities_check_party_roles']) f
  union all select 'B prerequisites', 250, 'crm_create_opportunity has the 21-argument signature the wrapper calls by name',
         case when to_regprocedure('public.crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text)') is not null
              then 'OK' else 'UNEXPECTED - the function differs from the one this change expects. Do not continue; send this result.' end
  union all select 'B prerequisites', 260, 'the platform role "authenticated" exists',
         case when exists (select 1 from pg_roles where rolname = 'authenticated') then 'OK' else 'MISSING' end
  union all select 'B prerequisites', 300, 'applied already?',
         case when to_regclass('public.jarvis_settings') is not null or to_regclass('public.jarvis_action_ledger') is not null
                or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('jarvis_my_access', 'jarvis_usage_take', 'jarvis_create_enquiry'))
              then 'ALREADY APPLIED - not a first run; run jarvis_20_verify_readonly.sql instead'
              else 'OK - not applied yet' end
  union all select 'C what exists today', 1000, 'active Sales grants (people who could be pilot users)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_company_grants where revoked_at is null$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1001, 'enquiries (the migration changes none of them)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_opportunities$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1002, 'companies with Sales settings (an enquiry can be created only for these)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_company_settings$q$, false, true, '')))[1]::text
) r
order by section, ord, item;
