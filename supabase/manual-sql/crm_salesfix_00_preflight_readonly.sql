-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261222000100_crm_sales_write_rules.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send the full result.
-- HOW TO READ IT: every section B row must say OK, and the last B row must say the change is NOT yet applied. Section C is information only
-- (it shows existing data the migration will NOT change, so nothing in it is a problem to fix first).
-- Needs the Estimates-only guard migration (20261221000100) first. No applied migration is edited by this change.
-- Section C row 1002 lists existing Quote sent / Negotiation / Won enquiries with a MISSING quote reference: information only. The migration does not backfill them and does not block them.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text as detail
  union all select 'A session', 2, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 100 + row_number() over (order by t), 'table ' || t,
         case when to_regclass('public.' || t) is not null then 'OK' else 'MISSING - install the earlier Sales migrations first' end
    from unnest(array['crm_opportunities', 'crm_proposals', 'crm_zoho_references', 'crm_closures', 'crm_handovers', 'crm_follow_ups', 'crm_quotations']) t
  union all select 'B prerequisites', 200 + row_number() over (order by f), 'function ' || f,
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'OK' else 'MISSING - install the earlier Sales migrations first' end
    from unnest(array['crm_set_proposal_status', 'crm_upsert_zoho_reference', 'crm_mark_won', 'crm_lock_opportunity', 'crm_today_dubai', 'crm_move_stage', 'crm_quote_issue', 'crm_estimate_sent_guard']) f
  union all select 'B prerequisites', 250, 'the Estimates-only guard trigger crm_proposals_estimate_sent_guard is in place',
         case when exists (select 1 from pg_trigger where tgname = 'crm_proposals_estimate_sent_guard' and not tgisinternal)
              then 'OK' else 'MISSING - apply 20261221000100_crm_estimates_only_guards.sql first' end
  union all select 'B prerequisites', 260, 'crm_upsert_zoho_reference is still the old function (overwrites every field)',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_upsert_zoho_reference' and prosrc like '%quote_ref = excluded.quote_ref%')
              then 'OK' else 'UNEXPECTED - not the function this change expects (already replaced?). Do not continue; send this result.' end
  union all select 'B prerequisites', 270, 'crm_set_proposal_status is still the old function (no starting-status check for superseded)',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_set_proposal_status' and prosrc not like '%already superseded%')
              then 'OK' else 'UNEXPECTED - not the function this change expects (already replaced?). Do not continue; send this result.' end
  union all select 'B prerequisites', 280, 'crm_mark_won is still the old function (no future-date check)',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_mark_won' and prosrc not like '%cannot be in the future%')
              then 'OK' else 'UNEXPECTED - not the function this change expects (already replaced?). Do not continue; send this result.' end
  union all select 'B prerequisites', 300, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('crm_save_zoho_reference', 'crm_zoho_quote_ref_protected', 'crm_zoho_quote_ref_guard'))
              or exists (select 1 from pg_trigger where tgname = 'crm_zoho_quote_ref_guard' and not tgisinternal)
              then 'ALREADY APPLIED - not a first run; run crm_salesfix_20_verify_readonly.sql instead'
              else 'OK - not applied yet' end
  union all select 'C what exists today', 1000, 'proposals by status',
         (xpath('/row/t/text()', query_to_xml($q$select coalesce(string_agg(status || ': ' || n, ', ' order by status), 'none') as t from (select status, count(*) as n from crm_proposals group by status) x$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1001, 'Zoho Books reference rows (total; with a quote reference; with an invoice reference)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text || '; ' || count(*) filter (where length(btrim(coalesce(quote_ref, ''))) > 0)::text || '; ' || count(*) filter (where length(btrim(coalesce(invoice_ref, ''))) > 0)::text as t from crm_zoho_references$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1002, 'Quote sent / Negotiation / Won enquiries (and On hold from them) WITHOUT a quote reference, by stage (INFORMATION, not a failure: they are NOT backfilled and NOT blocked; an edit that does not touch the quote reference, or that sets a first value, works on them as before)',
         (xpath('/row/t/text()', query_to_xml($q$select coalesce(string_agg(s || ': ' || n, ', ' order by s), 'none') as t from (
             select case when o.stage = 'on_hold' then 'on_hold (from ' || o.stage_before_hold || ')' else o.stage end as s, count(*) as n
               from crm_opportunities o
              where (o.stage in ('quote_sent', 'negotiation', 'won') or (o.stage = 'on_hold' and o.stage_before_hold in ('quote_sent', 'negotiation')))
                and not exists (select 1 from crm_zoho_references z where z.opportunity_id = o.id and length(btrim(coalesce(z.quote_ref, ''))) > 0)
              group by 1) x$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1006, 'the enquiry references of those records (reference codes only; first 50)',
         (xpath('/row/t/text()', query_to_xml($q$select coalesce(string_agg(reference, ', ' order by reference), 'none') as t from (
             select o.reference from crm_opportunities o
              where (o.stage in ('quote_sent', 'negotiation', 'won') or (o.stage = 'on_hold' and o.stage_before_hold in ('quote_sent', 'negotiation')))
                and not exists (select 1 from crm_zoho_references z where z.opportunity_id = o.id and length(btrim(coalesce(z.quote_ref, ''))) > 0)
              order by o.reference limit 50) x$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1007, 'Quote sent / Negotiation / Won enquiries (and On hold from them) WITH a quote reference: after the migration that reference cannot be cleared (it can be corrected to another one)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_opportunities o
              where (o.stage in ('quote_sent', 'negotiation', 'won') or (o.stage = 'on_hold' and o.stage_before_hold in ('quote_sent', 'negotiation')))
                and exists (select 1 from crm_zoho_references z where z.opportunity_id = o.id and length(btrim(coalesce(z.quote_ref, ''))) > 0)$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1003, 'Won enquiries whose evidence date is in the future (information; the migration refuses NEW future dates only and changes no stored row)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_opportunities where stage = 'won' and evidence_date > (now() at time zone 'Asia/Dubai')::date$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1004, 'accepted proposals (cannot be marked superseded after the migration; they stay as they are)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_proposals where status = 'accepted'$q$, false, true, '')))[1]::text
  union all select 'C what exists today', 1005, 'Lost enquiries that have Zoho Books references (they become read-only until reopened; the rows stay as they are)',
         (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_zoho_references z join crm_opportunities o on o.id = z.opportunity_id where o.stage = 'lost'$q$, false, true, '')))[1]::text
) r
order by section, ord, item;
