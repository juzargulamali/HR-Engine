-- READ-ONLY. Run BEFORE the migration 20261222000100_crm_sales_write_rules.sql, and again AFTER it. Compare the two results row by row.
-- Every row must be IDENTICAL before and after EXCEPT the rows marked "(INTENDED TO CHANGE)": the three replaced functions (crm_upsert_zoho_reference,
-- crm_set_proposal_status, crm_mark_won) and the new function crm_save_zoho_reference (absent before, present after).
-- The migration changes functions only: it must not change a stored proposal, Zoho reference, closure, handover, follow-up, enquiry or event row, or any other function.
select item, n, fingerprint from (
  select 1 as ord, 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
         || case when p.proname in ('crm_upsert_zoho_reference', 'crm_set_proposal_status', 'crm_mark_won') then ' (INTENDED TO CHANGE)' else '' end as item,
         '-' as n, md5(pg_get_functiondef(p.oid)) as fingerprint
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('crm_upsert_zoho_reference', 'crm_set_proposal_status', 'crm_mark_won', 'crm_add_proposal', 'crm_move_stage', 'crm_mark_lost', 'crm_reopen_opportunity',
                       'crm_lock_opportunity', 'crm_check_version', 'crm_require_owner_or_founder', 'crm_today_dubai', 'crm_quote_issue', 'crm_quote_create', 'crm_quote_create_revision',
                       'crm_estimate_sent_guard', 'crm_update_handover', 'crm_request_approval', 'crm_decide_approval')
  union all select 2, 'new function crm_save_zoho_reference (INTENDED TO CHANGE: absent before, present after)',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_save_zoho_reference'), '-'
  union all select 3, 'estimate guard trigger on crm_proposals', (select count(*)::text from pg_trigger where tgname = 'crm_proposals_estimate_sent_guard' and not tgisinternal), '-'
  union all select 4, 'proposals (id, status, version, sent_on, note)', count(*)::text,
         coalesce(md5(string_agg(id::text || status || version::text || coalesce(sent_on::text, '') || coalesce(note, ''), ',' order by id)), '-') from crm_proposals
  union all select 5, 'Zoho Books references (every column)', count(*)::text,
         coalesce(md5(string_agg(z::text, ',' order by opportunity_id)), '-') from crm_zoho_references z
  union all select 6, 'enquiries (every column)', count(*)::text,
         coalesce(md5(string_agg(o::text, ',' order by id)), '-') from crm_opportunities o
  union all select 7, 'closures (every column)', count(*)::text,
         coalesce(md5(string_agg(c::text, ',' order by id)), '-') from crm_closures c
  union all select 8, 'handovers (opportunity, status, Project Manager)', count(*)::text,
         coalesce(md5(string_agg(opportunity_id::text || status || coalesce(pm_user_id::text, ''), ',' order by opportunity_id)), '-') from crm_handovers
  union all select 9, 'follow-ups (id, status, due)', count(*)::text,
         coalesce(md5(string_agg(id::text || status || due_at::text, ',' order by id)), '-') from crm_follow_ups
  union all select 10, 'timeline events (count)', count(*)::text, '-' from crm_opportunity_events
) r order by ord, item;
