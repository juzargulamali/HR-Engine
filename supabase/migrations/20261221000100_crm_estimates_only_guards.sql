-- Sales & CRM: Estimates-only database guard (completes PR #64). Additive and idempotent. Does NOT edit 20261220000100 (already applied on hosted V2).
--
-- WHAT THIS ADDS
--   1. A database refusal: an ESTIMATE can never be recorded as "sent". An estimate row is a crm_proposals row that has a crm_quotations extension
--      row (every estimate and every legacy quotation). The app already refuses "Record as sent" for it; this makes the DATABASE refuse it too,
--      including a direct call of crm_set_proposal_status by the enquiry owner or a founder, and a direct table update by anything else.
--      Mechanism: a BEFORE INSERT OR UPDATE OF status trigger on crm_proposals. crm_set_proposal_status is NOT rewritten (no drift from its body).
--      Because the whole call is ONE transaction, the refusal also rolls back its side effect (superseding the proposal really sent to the client),
--      so the enquiry's stage gates (Proposal sent needs a sent proposal; Quote sent needs a Zoho Books quote reference) cannot be unlocked by an estimate.
--      Not blocked: draft -> superseded (finalising a later revision supersedes earlier draft or sent revisions), any update that leaves status
--      'sent' as it is (legacy quotations recorded as sent before this change stay as they are), and every update that does not touch status.
--      Ordinary note + file proposals have no extension row and behave exactly as before. 'accepted' is NOT touched (see the deployment guide).
--   2. New estimates get the reference prefix EST- (crm_quote_create replaced; only the prefix differs from the applied body). The per-company yearly
--      counter is the SAME one, so EST- continues the QUO- sequence and numbers never repeat. Revisions copy the reference of the revised
--      estimate (crm_quote_create_revision is untouched), so a revision of QUO-... stays QUO-... and a revision of EST-... stays EST-....
--      Existing references, snapshots and frozen documents are not touched.
--
-- ROLLBACK: supabase/manual-sql/crm_estguard_90_rollback.sql

create or replace function crm_estimate_sent_guard() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent')
     and exists (select 1 from crm_quotations where proposal_id = new.id) then
    raise exception 'An estimate cannot be marked as sent. Send official quotations from the Zoho Books workflow.' using errcode = 'EST01';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_proposals_estimate_sent_guard on crm_proposals;
create trigger crm_proposals_estimate_sent_guard before insert or update of status on crm_proposals
  for each row execute function crm_estimate_sent_guard();

revoke all on function crm_estimate_sent_guard() from public, anon, authenticated;

-- New draft estimate from an enquiry: identical to the applied definition except the reference prefix (QUO- becomes EST-).
-- New draft estimate from an enquiry. Reference from the per-company counter; terms copied from the company template.
create or replace function crm_quote_create(p_opportunity uuid) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v crm_opportunities; v_id uuid; v_next integer; v_year integer := extract(year from (now() at time zone 'Asia/Dubai'))::integer;
  v_seq integer; v_code text; v_tpl crm_quote_terms_templates;
begin
  v := crm_lock_opportunity(p_opportunity);
  perform crm_require_owner_or_founder(v);
  if v.stage in ('won', 'lost') then raise exception 'A closed opportunity cannot get new proposals' using errcode = '23514'; end if;
  select reference_code into v_code from crm_company_settings where company_id = v.company_id;
  if v_code is null then raise exception 'Sales settings are not set up for this company' using errcode = '23514'; end if;
  select coalesce(max(version), 0) + 1 into v_next from crm_proposals where opportunity_id = v.id;
  insert into crm_proposals (opportunity_id, company_id, version, note, created_by)
  values (v.id, v.company_id, v_next, 'Estimate (quotation builder)', auth.uid()) returning id into v_id;
  insert into crm_quote_counters (company_id, year, last_value) values (v.company_id, v_year, 1)
  on conflict (company_id, year) do update set last_value = crm_quote_counters.last_value + 1 returning last_value into v_seq;
  select * into v_tpl from crm_quote_terms_templates where company_id = v.company_id;
  insert into crm_quotations (proposal_id, opportunity_id, company_id, reference, revision, terms_label, terms)
  values (v_id, v.id, v.company_id, format('EST-%s-%s-%s', v_code, v_year, lpad(v_seq::text, 4, '0')), 1,
          coalesce(v_tpl.label, 'Standard terms (working draft, pending legal review)'), coalesce(v_tpl.clauses, crm_quote_default_terms()));
  perform crm_log_event(v.id, v.company_id, 'proposal', null, 'v' || v_next || ' estimate draft');
  return v_id;
end;
$$;


-- Grants are unchanged: create or replace keeps the existing privileges of crm_quote_create(uuid).
