-- READ ONLY. Run AFTER applying 20270112000100_crm_quote_terms_guard.sql. Changes nothing. One result table.
-- Expect: rows 1 to 6 'OK'. Rows 7 and 8 are numbers for information.
select n, item, result from (
  select 1 as n, 'the rule function exists and signed-in people cannot call it' as item,
         case when to_regprocedure('public.crm_quote_terms_need_review(text, jsonb)') is not null
                   and not has_function_privilege('authenticated', 'public.crm_quote_terms_need_review(text, jsonb)', 'execute')
                   and not has_function_privilege('anon', 'public.crm_quote_terms_need_review(text, jsonb)', 'execute') then 'OK' else 'FAIL' end as result
  union all select 2, 'the rule: an estimate marker with only the two client notes needs no review; anything else does',
         case when not crm_quote_terms_need_review('estimate-format:2', '[]'::jsonb)
                   and not crm_quote_terms_need_review('estimate-format:1', '[{"title":"Assumptions","body":"a"},{"title":"Next steps","body":"b"}]'::jsonb)
                   and crm_quote_terms_need_review('Standard terms (working draft, pending legal review)', '[{"title":"Changes","body":"x"}]'::jsonb)
                   and crm_quote_terms_need_review(null, '[]'::jsonb)
                   and crm_quote_terms_need_review('estimate-format:2', '[{"title":"Confidentiality","body":"x"}]'::jsonb)
                   and crm_quote_terms_need_review('estimate-format:3', '[]'::jsonb) then 'OK' else 'FAIL' end
  union all select 3, 'crm_quote_issue refuses a draft with inherited terms',
         case when (select prosrc from pg_proc where oid = 'public.crm_quote_issue(uuid, jsonb)'::regprocedure) like '%crm_quote_terms_need_review%before finalising it%' then 'OK' else 'FAIL' end
  union all select 4, 'crm_quote_request_approval refuses a draft with inherited terms',
         case when (select prosrc from pg_proc where oid = 'public.crm_quote_request_approval(uuid)'::regprocedure) like '%crm_quote_terms_need_review%before requesting approval%' then 'OK' else 'FAIL' end
  union all select 5, 'privileges of the two functions are as before: signed-in people can run them, anonymous cannot',
         case when has_function_privilege('authenticated', 'public.crm_quote_issue(uuid, jsonb)', 'execute') and has_function_privilege('authenticated', 'public.crm_quote_request_approval(uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.crm_quote_issue(uuid, jsonb)', 'execute') and not has_function_privilege('anon', 'public.crm_quote_request_approval(uuid)', 'execute') then 'OK' else 'FAIL' end
  union all select 6, 'every issued document still has its frozen copy (nothing issued was touched)',
         case when (select count(*) from crm_quotations q where q.issued_at is not null and not exists (select 1 from crm_quotation_snapshots s where s.proposal_id = q.proposal_id)) = 0 then 'OK' else 'FAIL' end
  union all select 7, 'information: drafts that now need their inherited terms replaced before they can be finalised',
         (select count(*) from crm_quotations q where q.issued_at is null and crm_quote_terms_need_review(q.terms_label, q.terms))::text
  union all select 8, 'information: issued documents without an estimate marker (issued as quotations; unchanged)',
         (select count(*) from crm_quotation_snapshots s where not (coalesce(s.content->'terms'->>'label', '') ~ '^estimate-format:[0-9]{1,4}$'))::text
) x order by n;
