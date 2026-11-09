-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261223000100_jarvis_platform.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send the full result.
-- HOW TO READ IT: every section B row must say OK, and row 300 must say the change is NOT yet applied. Section C is information only.
-- The migration is purely additive: it adds jarvis_* tables (including the confirmation proof key table, empty) and jarvis_* functions (the access check, the usage counter, one wrapper per write action, their internal helpers and the proof check) and replaces NOTHING that exists. JARVIS stays OFF for everyone after it (see docs/jarvis-deployment.md).
select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text as detail
  union all select 'A session', 2, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 100 + row_number() over (order by t), 'table ' || t,
         case when to_regclass('public.' || t) is not null then 'OK' else 'MISSING - install the earlier Sales migrations first' end
    from unnest(array['companies', 'profiles', 'crm_opportunities', 'crm_company_grants', 'crm_organisations', 'crm_follow_ups', 'crm_opportunity_events', 'crm_reference_counters', 'crm_company_settings']) t
  union all select 'B prerequisites', 200 + row_number() over (order by f), 'function ' || f,
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'OK' else 'MISSING - install the earlier Sales migrations first' end
    from unnest(array['crm_create_opportunity', 'crm_has_access', 'crm_require_user', 'crm_log_event', 'crm_find_duplicate_candidates', 'crm_organisation_roles', 'crm_opportunities_check_party_roles',
                      'crm_create_organisation_profile', 'crm_import_candidates', 'crm_lock_opportunity', 'crm_check_version', 'crm_require_owner_or_founder', 'crm_update_opportunity', 'crm_move_stage', 'crm_stage_index', 'crm_add_activity', 'crm_create_follow_up', 'crm_user_has_company_access']) f
  union all select 'B prerequisites', 250, 'crm_create_opportunity has the 21-argument signature the wrapper calls by name',
         case when to_regprocedure('public.crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text)') is not null
              then 'OK' else 'UNEXPECTED - the function differs from the one this change expects. Do not continue; send this result.' end
  union all select 'B prerequisites', 260, 'the platform role "authenticated" exists',
         case when exists (select 1 from pg_roles where rolname = 'authenticated') then 'OK' else 'MISSING' end
  union all select 'B prerequisites', 270, 'the built-in sha256(bytea) function exists (PostgreSQL 11 or newer): the confirmation proof is an HMAC-SHA256 built on it, so NO extension (pgcrypto) is needed',
         case when exists (select 1 from pg_proc where pronamespace = 'pg_catalog'::regnamespace and proname = 'sha256' and pg_get_function_identity_arguments(oid) = 'bytea') then 'OK' else 'MISSING - this PostgreSQL is too old. Do not continue; send this result.' end
  union all select 'B prerequisites', 280, 'the proof key table does not exist yet (nothing to carry over; the migration creates it EMPTY and the owner sets the key afterwards)',
         case when to_regclass('public.jarvis_proof_key') is null then 'OK' else 'ALREADY EXISTS - not a first run; run jarvis_20_verify_readonly.sql instead' end
  union all select 'B prerequisites', 300, 'applied already?',
         case when to_regclass('public.jarvis_settings') is not null or to_regclass('public.jarvis_action_ledger') is not null or to_regclass('public.jarvis_proof_key') is not null
                or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'jarvis\_%')
              then 'ALREADY APPLIED - not a first run; run jarvis_20_verify_readonly.sql instead'
              else 'OK - not applied yet' end
  union all select 'C what exists today', 999, 'the platform role "service_role" exists (the migration also takes the proof key away from it; information only)',
         case when exists (select 1 from pg_roles where rolname = 'service_role') then 'yes' else 'no' end
  union all select 'C what exists today', 1000, 'active Sales grants (people who could be pilot users)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_company_grants where revoked_at is null$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1001, 'enquiries (the migration changes none of them)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_opportunities$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1002, 'companies with Sales settings (an enquiry can be created only for these)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_company_settings$q$, false, true, '')))[1]::text
) r
order by section, ord, item;
