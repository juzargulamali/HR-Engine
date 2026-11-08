-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261220000100_crm_estimates_quotations.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send the full result.
-- HOW TO READ IT: every section B row must say OK, and the last one must say the change is NOT yet applied. Section C is information only.
-- Needs the Clients & Agencies migration (20261219000100) first: the replaced import functions belong to it.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text as detail
  union all select 'A session', 2, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 100 + row_number() over (order by t), 'table ' || t,
         case when to_regclass('public.' || t) is not null then 'OK' else 'MISSING - install the earlier Sales migrations first' end
    from unnest(array['companies', 'crm_organisations', 'crm_opportunities', 'crm_proposals', 'crm_approvals', 'crm_files', 'crm_company_settings', 'crm_import_batches']) t
  union all select 'B prerequisites', 200 + row_number() over (order by f), 'function ' || f,
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'OK' else 'MISSING - install the earlier Sales migrations first' end
    from unnest(array['crm_has_access', 'crm_has_capability', 'crm_lock_opportunity', 'crm_require_owner_or_founder', 'crm_log_event', 'crm_request_approval',
                      'crm_decide_approval', 'crm_create_organisation_profile', 'crm_import_apply_item', 'crm_remove_file', 'has_role']) f
  union all select 'B prerequisites', 300, 'applied already?',
         case when to_regclass('public.crm_quotations') is not null
              then 'ALREADY APPLIED - not a first run; run crm_quotes_20_verify_readonly.sql instead'
              else 'OK - not applied yet' end
  union all select 'C what exists today', 1000, 'proposals', (select count(*)::text from crm_proposals)
  union all select 'C what exists today', 1001, 'companies without Sales settings (cannot start an estimate: no reference code)',
         (select count(*)::text from companies c where not exists (select 1 from crm_company_settings s where s.company_id = c.id))
  union all select 'C what exists today', 1002, 'commercial approval policy per company',
         (select coalesce(string_agg(c.legal_name || ': ' || coalesce(s.approval_policy, 'no settings'), '; ' order by c.legal_name), 'none') from companies c left join crm_company_settings s on s.company_id = c.id)
  union all select 'C what exists today', 1003, 'companies with no legal name (issuing needs one)', (select count(*)::text from companies where btrim(coalesce(legal_name, '')) = '')
) r
order by section, ord, item;
