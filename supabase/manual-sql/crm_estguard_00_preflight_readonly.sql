-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261221000100_crm_estimates_only_guards.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send the full result.
-- HOW TO READ IT: every section B row must say OK, and the last B row must say the change is NOT yet applied. Section C is information only.
-- Needs the Estimates & Quotations migration (20261220000100) first. That migration is NOT edited by this change.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text as detail
  union all select 'A session', 2, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 100 + row_number() over (order by t), 'table ' || t,
         case when to_regclass('public.' || t) is not null then 'OK' else 'MISSING - install the Estimates & Quotations migration first' end
    from unnest(array['crm_proposals', 'crm_opportunities', 'crm_quotations', 'crm_quotation_snapshots', 'crm_quote_counters', 'crm_zoho_references']) t
  union all select 'B prerequisites', 200 + row_number() over (order by f), 'function ' || f,
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'OK' else 'MISSING - install the earlier Sales and Estimates migrations first' end
    from unnest(array['crm_set_proposal_status', 'crm_move_stage', 'crm_upsert_zoho_reference', 'crm_quote_create', 'crm_quote_create_revision', 'crm_quote_issue']) f
  union all select 'B prerequisites', 250, 'crm_quote_create currently generates the old QUO- reference (the function this change replaces)',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_quote_create' and prosrc like '%QUO-%s-%s-%s%')
              then 'OK' else 'UNEXPECTED - the function is not the one this change expects (already replaced?). Do not continue; send this result.' end
  union all select 'B prerequisites', 300, 'applied already?',
         case when exists (select 1 from pg_trigger where tgname = 'crm_proposals_estimate_sent_guard' and not tgisinternal)
              then 'ALREADY APPLIED - not a first run; run crm_estguard_20_verify_readonly.sql instead'
              else 'OK - not applied yet' end
  union all select 'C what exists today', 1000, 'estimate rows by status (a proposal row with an estimate / quotation extension)',
         case when to_regclass('public.crm_quotations') is null then 'n/a'
              else (xpath('/row/t/text()', query_to_xml($q$select coalesce(string_agg(status || ': ' || n, ', ' order by status), 'none') as t
                       from (select p.status, count(*) as n from crm_proposals p join crm_quotations q on q.proposal_id = p.id group by p.status) x$q$, false, true, '')))[1]::text end
  union all select 'C what exists today', 1001, 'estimate rows ALREADY sent (legacy: they stay as they are; the guard does not touch them)',
         case when to_regclass('public.crm_quotations') is null then 'n/a'
              else (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_proposals p join crm_quotations q on q.proposal_id = p.id where p.status = 'sent'$q$, false, true, '')))[1]::text end
  union all select 'C what exists today', 1002, 'estimate rows recorded as accepted (information; the guard does not change accepted)',
         case when to_regclass('public.crm_quotations') is null then 'n/a'
              else (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_proposals p join crm_quotations q on q.proposal_id = p.id where p.status = 'accepted'$q$, false, true, '')))[1]::text end
  union all select 'C what exists today', 1003, 'highest existing reference per prefix and company code',
         case when to_regclass('public.crm_quotations') is null then 'n/a'
              else (xpath('/row/t/text()', query_to_xml($q$select coalesce(string_agg(pfx || '-' || code || ': ' || mx, '; ' order by pfx, code), 'none') as t
                       from (select split_part(reference, '-', 1) as pfx, split_part(reference, '-', 2) as code, max(reference) as mx from crm_quotations group by 1, 2) x$q$, false, true, '')))[1]::text end
  union all select 'C what exists today', 1004, 'ordinary proposals (no estimate extension) recorded as sent',
         case when to_regclass('public.crm_quotations') is null then 'n/a'
              else (xpath('/row/t/text()', query_to_xml($q$select count(*)::text as t from crm_proposals p where p.status = 'sent' and not exists (select 1 from crm_quotations q where q.proposal_id = p.id)$q$, false, true, '')))[1]::text end
) r
order by section, ord, item;
