-- READ ONLY. Run BEFORE applying 20270112000100_crm_quote_terms_guard.sql. Changes nothing. One result table.
-- Rows 1 and 2 (prerequisites). Expect: 1 'OK'; 2 'not installed yet' (or 'already installed' on a second run).
-- Rows 10+ (one per company that has any): DRAFT estimates that hold inherited terms today, as "drafts holding inherited terms / of which revisions of an
--   earlier document / of which waiting for approval". These drafts are NOT changed by the migration. After it, each one cannot be finalised or sent for approval
--   until its owner or a founder replaces the terms on the estimate page (the new app shows the step; the app deployed before it converts such a draft itself when
--   it finalises). A number here is information, not a problem. "waiting for approval" above 0: that request stays as it is and can still be decided; finalising
--   afterwards is refused until the terms are replaced, and replacing them needs a fresh approval request.
-- Row 90: issued documents that carry no estimate marker (quotations issued before the estimates-only change). Information only: they are never touched.
-- Rows 100+: each such draft (company, reference, revision, enquiry, label, number of inherited clauses), for the people who own them.
with drafts as (
  select q.proposal_id, q.company_id, q.reference, q.revision, q.previous_proposal_id, q.terms_label, q.opportunity_id,
         (select count(*) from jsonb_array_elements(case when jsonb_typeof(q.terms) = 'array' then q.terms else '[]'::jsonb end) c
           where coalesce(c->>'title', '') not in ('Assumptions', 'Next steps')) as inherited_clauses
    from crm_quotations q
   where q.issued_at is null
     and (not (coalesce(q.terms_label, '') ~ '^estimate-format:[0-9]{1,4}$' and substring(q.terms_label from 17)::integer in (1, 2))
          or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(q.terms) = 'array' then q.terms else '[]'::jsonb end) c
                      where coalesce(c->>'title', '') not in ('Assumptions', 'Next steps')))
)
select n, item, result from (
  select 1 as n, 'the estimate functions this migration replaces exist (crm_quote_issue, crm_quote_request_approval, crm_quote_load_editable)' as item,
         case when to_regprocedure('public.crm_quote_issue(uuid, jsonb)') is not null and to_regprocedure('public.crm_quote_request_approval(uuid)') is not null
                   and to_regprocedure('public.crm_quote_load_editable(uuid)') is not null then 'OK'
              else 'STOP - apply 20261220000100_crm_estimates_quotations.sql first' end as result
  union all select 2, 'this migration is not installed yet',
         case when to_regprocedure('public.crm_quote_terms_need_review(text, jsonb)') is not null then 'already installed' else 'not installed yet' end
  union all
  select 10 + (row_number() over (order by c.legal_name))::int,
         'company ' || c.legal_name || ': drafts holding inherited terms / of which revisions of an earlier document / of which waiting for approval',
         (select count(*) from drafts d where d.company_id = c.id)::text || ' / ' ||
         (select count(*) from drafts d where d.company_id = c.id and d.previous_proposal_id is not null)::text || ' / ' ||
         (select count(*) from drafts d where d.company_id = c.id and exists (select 1 from crm_approvals a where a.proposal_id = d.proposal_id and a.state = 'pending'))::text
    from companies c where exists (select 1 from drafts d where d.company_id = c.id)
  union all select 90, 'information: issued documents without an estimate marker (issued as quotations; never touched by this migration)',
         (select count(*) from crm_quotation_snapshots s where not (coalesce(s.content->'terms'->>'label', '') ~ '^estimate-format:[0-9]{1,4}$'))::text
  union all
  select 100 + (row_number() over (order by c.legal_name, d.reference, d.revision))::int,
         c.legal_name || ' · ' || d.reference || ' revision ' || d.revision || ' · enquiry ' || o.reference || ' (owner: ' || coalesce(p.full_name, 'unknown') || ')',
         'draft holds inherited terms: label ' || coalesce('"' || d.terms_label || '"', 'none') || ', ' || d.inherited_clauses || ' clause(s)'
    from drafts d join companies c on c.id = d.company_id join crm_opportunities o on o.id = d.opportunity_id left join profiles p on p.id = o.owner_id
) x order by n;
