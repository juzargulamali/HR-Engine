-- READ-ONLY. Run BEFORE the migration 20261223000100_jarvis_platform.sql, and again AFTER it. Compare the two results row by row.
-- Every row must be IDENTICAL before and after EXCEPT the rows marked "(INTENDED TO CHANGE)": the new jarvis_* tables and functions (absent before, present after).
-- The migration adds objects only: it must not change any existing function (above all the crm_* functions JARVIS calls unchanged), any enquiry, follow-up, activity,
-- timeline event, organisation, account profile or Sales grant. Run it TWICE before the migration (the two results must match: nothing else is changing the data meanwhile).
select item, n, fingerprint from (
  select 1 as ord, 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
         '-' as n, md5(pg_get_functiondef(p.oid)) as fingerprint
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('crm_create_opportunity', 'crm_has_access', 'crm_has_capability', 'crm_require_user', 'crm_log_event', 'crm_find_duplicate_candidates',
                       'crm_organisation_roles', 'crm_opportunities_check_party_roles', 'crm_user_has_company_access', 'crm_validate_technologies',
                       'crm_create_organisation_profile', 'crm_import_candidates', 'crm_lock_opportunity', 'crm_check_version', 'crm_require_owner_or_founder', 'crm_update_opportunity',
                       'crm_move_stage', 'crm_add_activity', 'crm_create_follow_up')
  union all select 2, 'new table ' || t || ' (INTENDED TO CHANGE: absent before, present after)',
         (case when to_regclass('public.' || t) is not null then '1' else '0' end), '-'
    from unnest(array['jarvis_settings', 'jarvis_pilot_users', 'jarvis_pilot_companies', 'jarvis_action_ledger', 'jarvis_usage']) t
  union all select 2, 'new function ' || f || ' (INTENDED TO CHANGE: absent before, present after)',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = f), '-'
    from unnest(array['jarvis_my_access', 'jarvis_usage_take', 'jarvis_create_enquiry', 'jarvis_ledger_json', 'jarvis_ledger_enter', 'jarvis_ledger_done', 'jarvis_ledger_fail',
                    'jarvis_register_organisation']) f
  union all select 3, 'enquiries (every column)', count(*)::text, coalesce(md5(string_agg(o::text, ',' order by id)), '-') from crm_opportunities o
  union all select 4, 'follow-ups (every column)', count(*)::text, coalesce(md5(string_agg(f::text, ',' order by id)), '-') from crm_follow_ups f
  union all select 5, 'timeline events (every column)', count(*)::text, coalesce(md5(string_agg(e::text, ',' order by id)), '-') from crm_opportunity_events e
  union all select 6, 'organisations (every column)', count(*)::text, coalesce(md5(string_agg(g::text, ',' order by id)), '-') from crm_organisations g
  union all select 7, 'Sales grants (every column)', count(*)::text, coalesce(md5(string_agg(c::text, ',' order by id)), '-') from crm_company_grants c
  union all select 8, 'reference counters (every column)', count(*)::text, coalesce(md5(string_agg(r::text, ',' order by company_id, year)), '-') from crm_reference_counters r
  union all select 10, 'activities (every column)', count(*)::text, coalesce(md5(string_agg(a::text, ',' order by id)), '-') from crm_activities a
  union all select 11, 'account profiles (every column)', count(*)::text, coalesce(md5(string_agg(p::text, ',' order by id)), '-') from crm_account_profiles p
  union all select 9, 'Sales company settings (every column)', count(*)::text, coalesce(md5(string_agg(s::text, ',' order by company_id)), '-') from crm_company_settings s
) r order by ord, item;
