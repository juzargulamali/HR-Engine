-- WRITES. OWNER-RUN ROLLBACK of 20261221000100_crm_estimates_only_guards.sql. Safe to run twice.
-- It removes the "an estimate cannot be marked as sent" database guard (the app still refuses it) and restores the EXACT previous crm_quote_create
-- (new estimates get QUO- references again). It does NOT touch the applied migration 20261220000100, any proposal, estimate, snapshot or counter.
-- Estimates that were already created with an EST- reference KEEP that reference, and their revisions keep it too; they are not renamed.
-- A notice reports how many EST- estimates exist so you know what stays.
do $$ declare n integer;
begin
  if to_regclass('public.crm_quotations') is not null then
    select count(*) into n from crm_quotations where reference like 'EST-%';
    raise notice 'EST- estimates that keep their reference after this rollback: %', n;
  end if;
end $$;
begin;
drop trigger if exists crm_proposals_estimate_sent_guard on crm_proposals;
drop function if exists crm_estimate_sent_guard();

-- Previous crm_quote_create, exactly as in 20261220000100_crm_estimates_quotations.sql (QUO- prefix). Privileges are kept by create or replace.
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
  values (v_id, v.id, v.company_id, format('QUO-%s-%s-%s', v_code, v_year, lpad(v_seq::text, 4, '0')), 1,
          coalesce(v_tpl.label, 'Standard terms (working draft, pending legal review)'), coalesce(v_tpl.clauses, crm_quote_default_terms()));
  perform crm_log_event(v.id, v.company_id, 'proposal', null, 'v' || v_next || ' estimate draft');
  return v_id;
end;
$$;

commit;
