-- READ-ONLY. Run AFTER 20261220000100_crm_estimates_quotations.sql. One result table; every row must say OK.
select item, result from (
  select 1 as ord, 'table ' || t as item,
         case when to_regclass('public.' || t) is null then 'MISSING'
              when not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then 'RLS OFF'
              else 'OK (row-level security on)' end as result
    from unnest(array['crm_quotations', 'crm_quotation_sections', 'crm_quotation_lines', 'crm_quotation_snapshots', 'crm_quote_vat_choices', 'crm_quote_terms_templates', 'crm_quote_counters']) t
  union all select 2, 'no write grant for signed-in users on ' || t,
         case when exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = t and grantee in ('authenticated', 'anon', 'public')
                           and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')) then 'FAIL - a write grant exists' else 'OK' end
    from unnest(array['crm_quotations', 'crm_quotation_sections', 'crm_quotation_lines', 'crm_quotation_snapshots', 'crm_quote_vat_choices', 'crm_quote_terms_templates', 'crm_quote_counters']) t
  union all select 3, 'function ' || f,
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'OK' else 'MISSING' end
    from unnest(array['crm_quote_create', 'crm_quote_save_header', 'crm_quote_save_section', 'crm_quote_delete_section', 'crm_quote_save_line', 'crm_quote_delete_line',
                      'crm_quote_reorder', 'crm_quote_issue', 'crm_quote_create_revision', 'crm_quote_build_content', 'crm_quote_content_hash', 'crm_quote_request_approval', 'crm_quote_decide_approval', 'crm_quote_check_asset', 'crm_quote_seed_company', 'crm_save_vat_choice', 'crm_save_terms_template',
                      'crm_set_company_logo']) f
  union all select 4, 'signed-in users can call ' || f,
         case when has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') then 'OK' else 'FAIL - not callable' end
    from unnest(array['crm_quote_create(uuid)', 'crm_quote_issue(uuid, jsonb)', 'crm_quote_create_revision(uuid)', 'crm_quote_request_approval(uuid)', 'crm_quote_decide_approval(uuid, text, text, text)', 'crm_quote_content_hash(uuid)']) f
  union all select 5, 'internal function not callable by signed-in users: crm_quote_build_content',
         case when has_function_privilege('authenticated', 'public.crm_quote_build_content(uuid, date, jsonb)', 'execute') then 'FAIL - callable' else 'OK' end
  union all select 6, 'guard trigger ' || t,
         case when exists (select 1 from pg_trigger where tgname = t and not tgisinternal) then 'OK' else 'MISSING' end
    from unnest(array['crm_quotation_snapshots_frozen_row', 'crm_quotation_snapshots_frozen_truncate', 'crm_quotations_guard_row', 'crm_quotation_sections_guard', 'crm_quotation_lines_guard', 'companies_quote_seed', 'crm_approvals_quote_guard']) t
  union all select 7, 'column ' || c,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name || '.' || column_name = c) then 'OK' else 'MISSING' end
    from unnest(array['crm_organisations.vat_trn', 'crm_organisations.trade_licence_no', 'companies.trn', 'companies.address', 'companies.phone', 'companies.email', 'companies.website', 'companies.logo_path', 'crm_quotations.exclusions', 'crm_approvals.quote_content_hash']) c
  union all select 8, 'private bucket company-logos',
         case when exists (select 1 from storage.buckets where id = 'company-logos' and not public) then 'OK' else 'MISSING or public' end
  union all select 8, 'private bucket quotation-assets (pinned copies)',
         case when exists (select 1 from storage.buckets where id = 'quotation-assets' and not public) then 'OK' else 'MISSING or public' end
  union all select 8, 'pinned-asset delete guard on storage.objects (INFO: if missing, the bucket still has no policy for signed-in roles)',
         case when exists (select 1 from pg_trigger where tgname = 'crm_quotation_assets_guard_del' and not tgisinternal) then 'OK' else 'INFO - not installed' end
  union all select 9, 'every company has standard terms and VAT choices',
         case when exists (select 1 from companies c where not exists (select 1 from crm_quote_terms_templates t where t.company_id = c.id)
                              or not exists (select 1 from crm_quote_vat_choices v where v.company_id = c.id)) then 'FAIL - a company has none' else 'OK' end
  union all select 10, 'issued quotations without a snapshot (must be 0)',
         case when exists (select 1 from crm_quotations q where q.issued_at is not null and not exists (select 1 from crm_quotation_snapshots s where s.proposal_id = q.proposal_id)) then 'FAIL' else 'OK' end
) r order by ord, item;
