-- Sales & CRM, Estimates: a draft that still carries INHERITED terms cannot be finalised or sent for approval, by anyone, through any path.
--
-- WHY (owner decision, 2026-11-15): a revision of a quotation issued before the estimates-only change copies that quotation's standard terms and their label
-- (crm_quote_create_revision, unchanged). The app shows them as inherited and has a person replace them with the current estimate format in a confirmed step
-- before the draft can go out. Until now only the app enforced that: a direct call of crm_quote_issue by the owner or a founder froze a quotation-shaped document
-- with the superseded terms. This puts the same rule in the database.
--
-- THE RULE (ONE definition, in two places that must stay identical: here, crm_quote_terms_need_review, and `termsReview` in packages/domain/src/estimates.ts):
--   a draft's terms NEED REVIEW unless
--     (1) terms_label is an estimate format marker of a known version: 'estimate-format:<n>' with n written in 1 to 4 digits and n in (1, 2)
--         (the versions of ESTIMATE_NOTICES; a new version is added in both places together), and
--     (2) every clause of terms has the title 'Assumptions' or 'Next steps' (the two client notes, NOTE_HEADINGS).
--   "Confirmed" needs no new column: the confirmed step (replaceInheritedTerms) writes exactly that marker and keeps only those two clauses.
--   The same vectors are asserted against both definitions (packages/domain/test/estimates.test.ts and packages/rls-tests/test/crm-quote-terms-guard.rls.test.ts).
--
-- WHAT THIS CHANGES (additive and idempotent; safe to run twice; same function signatures; no table, column, constraint, policy or grant changes)
--   1. crm_quote_terms_need_review(text, jsonb): the rule above. Internal (not callable by signed-in people).
--   2. crm_quote_issue (replaced: the applied body of 20261220000100 plus one refusal right after the draft is loaded).
--   3. crm_quote_request_approval (replaced the same way: an approval is never bound to a version that cannot go out).
--
-- NOT CHANGED, NOT RE-VALIDATED: every document already issued. The guard runs only when a DRAFT is being finalised or sent for approval (both functions
-- load the draft through crm_quote_load_editable, which refuses an issued one first). No crm_quotations row, snapshot, file or approval is read for correction
-- or rewritten: a quotation issued before the estimates-only change keeps its terms, its snapshot and its hash, and opens and exports as issued.
-- Also unchanged: crm_quote_create (it still copies the company template into a new draft; the app clears it at once, and if that failed the draft asks for the
-- same confirmed step), crm_quote_create_revision, crm_quote_save_header, crm_quote_decide_approval, crm_quote_content_hash.
--
-- ORDER RELATIVE TO THE APP: safe before or after either app version.
--   * The app deployed before this change converts a draft to the estimate format itself just before it finalises or requests approval, so its calls pass.
--   * The app of this change refuses first, with its own sentence, and offers the confirmed step.
--
-- ROLLBACK: supabase/manual-sql/crm_quote_terms_guard_90_rollback.sql

create or replace function crm_quote_terms_need_review(p_label text, p_terms jsonb) returns boolean
language sql immutable
set search_path = public
as $$
  select not (coalesce(p_label, '') ~ '^estimate-format:[0-9]{1,4}$' and substring(p_label from 17)::integer in (1, 2))
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_terms) = 'array' then p_terms else '[]'::jsonb end) c
                  where coalesce(c->>'title', '') not in ('Assumptions', 'Next steps'));
$$;
revoke all on function crm_quote_terms_need_review(text, jsonb) from public, anon, authenticated;

create or replace function crm_quote_request_approval(p_proposal uuid) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare q crm_quotations; v_hash text; v_id uuid;
begin
  q := crm_quote_load_editable(p_proposal);
  -- An approval is bound to the exact version: a draft that still carries inherited terms is not a version that can go out (20270112000100).
  if crm_quote_terms_need_review(q.terms_label, q.terms) then
    raise exception 'Replace the terms carried over into this draft with the current estimate format before requesting approval (estimate page, Details step). Nothing was changed' using errcode = '23514';
  end if;
  v_hash := crm_quote_content_hash(p_proposal);
  update crm_approvals set state = 'changes_requested', decided_by = auth.uid(), decided_at = now(),
         instruction = 'Withdrawn automatically: the quotation changed after approval was requested'
   where proposal_id = p_proposal and state = 'pending' and quote_content_hash is distinct from v_hash;
  v_id := crm_request_approval(q.opportunity_id, p_proposal);
  update crm_approvals set quote_content_hash = v_hash where id = v_id;
  return v_id;
end;
$$;

create or replace function crm_quote_issue(p_proposal uuid, p_assets jsonb default null) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  q crm_quotations; co companies; v_policy text; v_today date := crm_today_dubai(); v_content jsonb; v_gross numeric; v_sum numeric; m jsonb;
  v_bad integer; v_hash text; ln record;
begin
  q := crm_quote_load_editable(p_proposal);
  -- Terms inherited from an earlier quotation are replaced by a person first (20270112000100): nothing inherited is frozen into a document a client receives.
  if crm_quote_terms_need_review(q.terms_label, q.terms) then
    raise exception 'Replace the terms carried over into this draft with the current estimate format before finalising it (estimate page, Details step). Nothing was changed' using errcode = '23514';
  end if;
  select * into co from companies where id = q.company_id;
  if length(btrim(coalesce(co.legal_name, ''))) = 0 then raise exception 'The issuing company has no legal name. Ask a System Administrator to add it on the Companies screen' using errcode = '23514'; end if;
  if q.currency is null then raise exception 'Choose the currency before issuing' using errcode = '23514'; end if;
  if q.vat_kind is null then raise exception 'Choose the VAT treatment before issuing' using errcode = '23514'; end if;
  if q.bill_to_org_id is null then raise exception 'Choose who the quotation is billed to before issuing' using errcode = '23514'; end if;
  if not exists (select 1 from crm_quotation_lines where proposal_id = p_proposal) then raise exception 'Add at least one item before issuing' using errcode = '23514'; end if;
  if exists (select 1 from crm_quotation_sections s where s.proposal_id = p_proposal and not exists (select 1 from crm_quotation_lines l where l.section_id = s.id)) then
    raise exception 'A section has no items. Add items or delete the section' using errcode = '23514';
  end if;
  if q.validity_date is not null and q.validity_date < v_today then raise exception 'The validity date is in the past' using errcode = '23514'; end if;
  select approval_policy into v_policy from crm_company_settings where company_id = q.company_id;
  -- The approval must be bound to the EXACT content as it is now (an edit after the request or after the decision changes the hash and voids it).
  v_hash := crm_quote_content_hash(p_proposal);
  if coalesce(v_policy, 'not_configured') = 'required' and not exists (
       select 1 from crm_approvals a where a.proposal_id = p_proposal and a.state = 'approved' and a.quote_content_hash = v_hash) then
    raise exception 'This quotation needs a founder''s approval of this exact version (it changed since the last approval, or none was requested from this page). Request approval first' using errcode = '23514';
  end if;
  -- Pictures are PINNED: the company logo and every line picture must have an immutable copy owned by this revision (made by the server before this call).
  if p_assets is not null and jsonb_typeof(p_assets) <> 'object' then raise exception 'Invalid pinned assets' using errcode = '22023'; end if;
  if co.logo_path is not null then perform crm_quote_check_asset(p_proposal, p_assets->'logo', 'logo', 'The company logo'); end if;
  for ln in select id from crm_quotation_lines where proposal_id = p_proposal and image_file_id is not null loop
    perform crm_quote_check_asset(p_proposal, p_assets->'lines'->(ln.id::text), 'line-' || ln.id::text, 'An item picture');
  end loop;
  v_content := crm_quote_build_content(p_proposal, v_today, coalesce(p_assets, '{}'::jsonb));
  v_gross := (v_content->'totals'->>'gross')::numeric;
  if jsonb_array_length(q.milestones) > 0 then
    if (q.milestones->0->>'kind') = 'percent' then
      select coalesce(sum((e->>'value')::numeric), 0) into v_sum from jsonb_array_elements(q.milestones) e;
      if v_sum <> 100 then raise exception 'Payment milestones must add up to 100%% (they add up to %)', v_sum using errcode = '23514'; end if;
    else
      select coalesce(sum((e->>'value')::numeric), 0) into v_sum from jsonb_array_elements(q.milestones) e;
      if v_sum <> v_gross then raise exception 'Payment milestone amounts must add up to the total including VAT (%)', v_gross using errcode = '23514'; end if;
    end if;
  end if;
  update crm_quotations set issued_at = now(), issued_by = auth.uid(), issue_date = v_today where proposal_id = p_proposal;
  insert into crm_quotation_snapshots (proposal_id, opportunity_id, company_id, reference, revision, content, content_hash, issued_by)
  values (p_proposal, q.opportunity_id, q.company_id, q.reference, q.revision, v_content, md5(v_content::text), auth.uid());
  -- A new revision replaces the earlier ones (draft or sent): they stay as they are, only their status becomes superseded.
  update crm_proposals p set status = 'superseded'
   where p.status in ('draft', 'sent') and p.id <> p_proposal
     and p.id in (select proposal_id from crm_quotations where company_id = q.company_id and reference = q.reference and revision < q.revision);
  perform crm_log_event(q.opportunity_id, q.company_id, 'proposal', null, q.reference || ' rev ' || q.revision || ' issued');
end;
$$;
