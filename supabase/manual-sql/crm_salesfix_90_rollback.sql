-- WRITES. OWNER-RUN ROLLBACK of 20261222000100_crm_sales_write_rules.sql. Safe to run twice.
-- It restores the EXACT previous bodies of crm_upsert_zoho_reference (overwrites every field), crm_set_proposal_status (no starting-status check for superseded)
-- and crm_mark_won (no future-date check), and drops the new crm_save_zoho_reference, the quote-reference trigger crm_zoho_quote_ref_guard and its two helper functions (decision B: after rollback a quote reference can be cleared at any stage again). Grants are unchanged (create or replace keeps them).
-- It changes no stored row: no proposal, Zoho reference, closure, handover or enquiry. Data entered while the migration was in place stays as it is.
-- AFTER rollback the NEW app cannot save Zoho references (by design it has no fallback: it shows "saving is temporarily unavailable" while references stay readable); the OLD app works again, with the old overwrite-all behaviour. See docs/sales-crm-write-rules-deployment.md.
-- The restored bodies are copied unchanged from 20261115000200_crm_workflow_functions.sql (crm_mark_won) and 20261115000300_crm_proposals_files_reminders.sql (the other two).
begin;

-- crm_upsert_zoho_reference: as in 20261115000300 (restored first so that nothing refers to the function dropped below)
create or replace function crm_upsert_zoho_reference(
  p_opportunity_id uuid,
  p_quote_ref text default null, p_quote_sent_on date default null,
  p_invoice_ref text default null, p_invoice_issued_on date default null,
  p_payment_received_on date default null, p_paid_amount numeric default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  perform crm_require_owner_or_founder(v);
  insert into crm_zoho_references (opportunity_id, company_id, quote_ref, quote_sent_on, invoice_ref, invoice_issued_on,
                                   payment_received_on, paid_amount, updated_by)
  values (v.id, v.company_id, nullif(btrim(p_quote_ref), ''), p_quote_sent_on, nullif(btrim(p_invoice_ref), ''),
          p_invoice_issued_on, p_payment_received_on, p_paid_amount, auth.uid())
  on conflict (opportunity_id) do update set
    quote_ref = excluded.quote_ref, quote_sent_on = excluded.quote_sent_on, invoice_ref = excluded.invoice_ref,
    invoice_issued_on = excluded.invoice_issued_on, payment_received_on = excluded.payment_received_on,
    paid_amount = excluded.paid_amount, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- crm_set_proposal_status: as in 20261115000300
create or replace function crm_set_proposal_status(p_proposal_id uuid, p_status text, p_sent_on date default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare p crm_proposals; v crm_opportunities;
begin
  perform crm_require_user();
  select * into p from crm_proposals where id = p_proposal_id;
  if not found or not crm_has_access(p.company_id) then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  v := crm_lock_opportunity(p.opportunity_id);
  perform crm_require_owner_or_founder(v);
  if v.stage in ('won', 'lost') and p_status <> 'accepted' then
    raise exception 'A closed opportunity cannot change proposals' using errcode = '23514';
  end if;
  if p_status = 'sent' then
    if p.status not in ('draft', 'sent') then
      raise exception 'Only a draft proposal can be recorded as sent' using errcode = '23514';
    end if;
    if p_sent_on is null or p_sent_on > crm_today_dubai() then
      raise exception 'Give the date it was actually sent (not in the future)' using errcode = '22023';
    end if;
    update crm_proposals set status = 'superseded' where opportunity_id = p.opportunity_id and status = 'sent' and id <> p.id;
    update crm_proposals set status = 'sent', sent_on = p_sent_on where id = p.id;
  elsif p_status = 'accepted' then
    if p.status <> 'sent' then
      raise exception 'Only a sent proposal can be recorded as accepted' using errcode = '23514';
    end if;
    update crm_proposals set status = 'accepted' where id = p.id;
  elsif p_status = 'superseded' then
    update crm_proposals set status = 'superseded' where id = p.id;
  else
    raise exception 'Unknown proposal status' using errcode = '22023';
  end if;
  perform crm_log_event(v.id, v.company_id, 'proposal', p.status, 'v' || p.version || ' ' || p_status);
end;
$$;

-- crm_mark_won: as in 20261115000200
create or replace function crm_mark_won(
  p_id uuid, p_evidence_type text, p_evidence_reference text, p_evidence_date date, p_note text default null,
  p_expected_version integer default null
) returns integer
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_version integer;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  if crm_stage_index(v.stage) is null then
    raise exception 'Only an open opportunity (not on hold) can be marked Won' using errcode = '23514';
  end if;
  if p_evidence_type not in ('purchase_order', 'authorised_email')
     or length(btrim(coalesce(p_evidence_reference, ''))) = 0 or p_evidence_date is null then
    raise exception 'Won needs evidence: a purchase order or authorised email, its reference and its date' using errcode = '22023';
  end if;
  if v.value is null then
    raise exception 'Set the confirmed value before marking Won' using errcode = '23514';
  end if;
  update crm_opportunities set stage = 'won', stage_changed_at = now(), evidence_type = p_evidence_type,
         evidence_reference = btrim(p_evidence_reference), evidence_date = p_evidence_date,
         stage_before_close = v.stage, closed_at = now(), closed_by = auth.uid(), version = version + 1
   where id = p_id returning version into v_version;
  insert into crm_closures (opportunity_id, company_id, outcome, closed_from_stage, closed_by, value_at_close, currency,
                            evidence_type, evidence_reference, evidence_date)
  values (p_id, v.company_id, 'won', v.stage, auth.uid(), v.value, v.currency, p_evidence_type,
          btrim(p_evidence_reference), p_evidence_date);
  update crm_follow_ups set status = 'cancelled', updated_at = now() where opportunity_id = p_id and status = 'open';
  -- A handover already prepared before an earlier closure (then a reopen) is kept as it is.
  insert into crm_handovers (opportunity_id, company_id) values (p_id, v.company_id) on conflict do nothing;
  perform crm_log_event(p_id, v.company_id, 'won', v.stage, 'won',
    p_evidence_type || ': ' || btrim(p_evidence_reference) || coalesce(' — ' || nullif(btrim(p_note), ''), ''));
  return v_version;
end;
$$;

-- Decision B objects: the trigger first, then the functions that use the helper.
drop trigger if exists crm_zoho_quote_ref_guard on crm_zoho_references;
drop function if exists crm_save_zoho_reference(uuid, jsonb, jsonb);
drop function if exists crm_zoho_quote_ref_guard();
drop function if exists crm_zoho_quote_ref_protected(text, text);

commit;
