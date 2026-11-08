-- READ-ONLY. Run BEFORE the migration 20261221000100_crm_estimates_only_guards.sql, and again AFTER it. Compare the two results row by row.
-- Every row must be IDENTICAL before and after EXCEPT the one marked "(INTENDED TO CHANGE)": crm_quote_create, which now makes EST- references.
-- The migration only adds a trigger and replaces crm_quote_create: it must not change a function listed here, a proposal's status or
-- version, a quotation reference or snapshot, or a row count. (The "estimate guard trigger" row changes from absent to present: also intended.)
select item, n, fingerprint from (
  select 1 as ord, 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
         || case when p.proname = 'crm_quote_create' then ' (INTENDED TO CHANGE)' else '' end as item,
         '-' as n, md5(pg_get_functiondef(p.oid)) as fingerprint
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('crm_set_proposal_status', 'crm_add_proposal', 'crm_move_stage', 'crm_upsert_zoho_reference', 'crm_quote_create', 'crm_quote_create_revision',
                       'crm_quote_issue', 'crm_quote_content_hash', 'crm_quote_request_approval', 'crm_quote_decide_approval', 'crm_request_approval', 'crm_decide_approval',
                       'crm_quote_save_header', 'crm_quote_save_section', 'crm_quote_save_line')
  union all select 2, 'estimate guard trigger on crm_proposals (INTENDED TO CHANGE: absent before, present after)',
         (select count(*)::text from pg_trigger where tgname = 'crm_proposals_estimate_sent_guard' and not tgisinternal), '-'
  union all select 3, 'proposals (id, status, version, sent_on)', count(*)::text,
         coalesce(md5(string_agg(id::text || status || version::text || coalesce(sent_on::text, ''), ',' order by id)), '-') from crm_proposals
  union all select 4, 'quotation headers (proposal, reference, revision, issued)', count(*)::text,
         coalesce(md5(string_agg(proposal_id::text || reference || revision::text || coalesce(issued_at::text, ''), ',' order by proposal_id)), '-') from crm_quotations
  union all select 5, 'frozen snapshots (content hash)', count(*)::text,
         coalesce(md5(string_agg(proposal_id::text || content_hash, ',' order by proposal_id)), '-') from crm_quotation_snapshots
  union all select 6, 'yearly reference counters', count(*)::text,
         coalesce(md5(string_agg(company_id::text || year::text || last_value::text, ',' order by company_id, year)), '-') from crm_quote_counters
  union all select 7, 'Zoho Books references (quote reference)', count(*)::text,
         coalesce(md5(string_agg(opportunity_id::text || coalesce(quote_ref, ''), ',' order by opportunity_id)), '-') from crm_zoho_references
  union all select 8, 'opportunities (stage, version)', count(*)::text,
         coalesce(md5(string_agg(id::text || stage || version::text, ',' order by id)), '-') from crm_opportunities
) r order by ord, item;
