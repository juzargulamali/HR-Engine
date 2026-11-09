-- Sales & CRM: three write rules enforced in the database (staff-readiness fixes). Additive and idempotent (create or replace). Changes NO stored row.
-- Does NOT edit any applied migration. Rollback and owner pack: supabase/manual-sql/crm_salesfix_*.sql (guide: docs/sales-crm-write-rules-deployment.md).
--
-- WHAT THIS CHANGES
--   1. Zoho Books references. crm_upsert_zoho_reference overwrote EVERY field with what the form sent (a stale form, or two people editing different
--      fields at once, lost data; a blank field could not be told apart from "not sent"). New function crm_save_zoho_reference(opportunity, fields, expected)
--      follows the proj_save_handover merge pattern: a key that is PRESENT in p_fields is set (JSON null or '' = an intentional clear), a key that is ABSENT
--      keeps the stored value. The opportunity row is locked first (so two saves are applied one after the other, each merging into the other's result) and
--      p_expected (optional) carries the values the person SAW for the fields they changed: if any of those fields changed meanwhile the save is refused
--      (SQLSTATE 23514, answered at once; not 40001, which PostgREST retries until the call times out) instead of silently overwriting. A Lost enquiry's references are read-only (the screen already
--      hides the form on Lost; every sibling function refuses a closed enquiry; Won stays editable because invoice and payment references follow a win).
--      The OLD signature crm_upsert_zoho_reference(uuid, text, date, text, date, date, numeric) is KEPT (same grants) and now delegates to the new function with
--      NULL meaning "leave as it is", so an old caller can no longer wipe a field it did not mean to touch (it cannot clear one either: clearing needs the new function).
--      OWNER DECISION B: once the enquiry has reached Quote sent (stage quote_sent, negotiation or won; and on_hold when it was put on hold from one of them,
--      crm_opportunities.stage_before_hold) an existing non-blank quote reference cannot be CLEARED (set to null or blank): it is the evidence that unlocked
--      the stage (crm_move_stage). Correcting it to ANOTHER non-blank reference is allowed there; clearing at earlier stages is allowed as before; a save that
--      omits the quote reference, or sets a first value on a record that has none, is never refused by this rule (existing advanced-stage records with a
--      missing reference are NOT backfilled and do not block unrelated edits); the invoice and payment fields stay editable on Won. Refused with SQLSTATE 23514.
--      Enforced twice: in crm_save_zoho_reference (clear message, before anything is written) and in a BEFORE UPDATE trigger on crm_zoho_references, so no other
--      path (the old signature, which delegates; a future function; an owner/admin UPDATE) can clear it. Authenticated users have SELECT only on the table.
--   2. crm_set_proposal_status: marking a proposal SUPERSEDED is only allowed from draft or sent (the same starting statuses crm_quote_issue supersedes and the only
--      ones the proposals panel offers). accepted and already-superseded proposals are refused (SQLSTATE 23514). The proposal is re-read AFTER the opportunity lock,
--      so a concurrent "accepted" cannot be overwritten by a stale read. Everything else in the function is byte-for-byte the applied body; the estimate guard
--      trigger crm_proposals_estimate_sent_guard (EST01) is untouched and still fires.
--   3. crm_mark_won: the date on the purchase order or authorised email cannot be in the future. Boundary = the Dubai calendar day (crm_today_dubai()), exactly the
--      `max` the Close form and the Close dialog use (todayInDubai(): the day in Asia/Dubai); today is accepted. Refused with SQLSTATE 22023 before any write, so the
--      enquiry, crm_closures, follow-ups and the handover row stay as they were.

-- -----------------------------------------------------------------------------
-- 1. Zoho Books references: field-level merge
-- -----------------------------------------------------------------------------
-- Stages at which an existing quote reference is protected from being cleared (decision B): Quote sent, Negotiation, Won, and On hold put there from one of them.
create or replace function crm_zoho_quote_ref_protected(p_stage text, p_stage_before_hold text)
returns boolean
language sql immutable
set search_path = public
as $$
  select p_stage in ('quote_sent', 'negotiation', 'won')
      or (p_stage = 'on_hold' and p_stage_before_hold in ('quote_sent', 'negotiation'));
$$;

create or replace function crm_save_zoho_reference(p_opportunity_id uuid, p_fields jsonb, p_expected jsonb default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v crm_opportunities;
  z crm_zoho_references;
  k text;
  v_changed text[] := '{}';
  v_quote_ref text; v_quote_sent_on date; v_invoice_ref text; v_invoice_issued_on date; v_payment_received_on date; v_paid_amount numeric;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  perform crm_require_owner_or_founder(v);
  if v.stage = 'lost' then
    raise exception 'A lost opportunity''s Zoho Books references are read-only. Reopen it first' using errcode = '23514';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Zoho Books references must be given as an object of the fields to change' using errcode = '22023';
  end if;
  if p_expected is not null and jsonb_typeof(p_expected) <> 'object' then
    raise exception 'The values you saw must be given as an object' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('quote_ref', 'quote_sent_on', 'invoice_ref', 'invoice_issued_on', 'payment_received_on', 'paid_amount') then
      raise exception 'Unknown Zoho Books field: %', k using errcode = '22023';
    end if;
  end loop;
  -- Nothing to change: no row is created and nothing is touched (the permission and stage checks above still applied).
  if p_fields = '{}'::jsonb then return; end if;

  select * into z from crm_zoho_references where opportunity_id = v.id for update;

  -- Stale-edit check, field by field: only fields being changed AND whose seen value was sent are compared. Others' changes to different fields merge.
  if p_expected is not null then
    if p_fields ? 'quote_ref' and p_expected ? 'quote_ref' and nullif(btrim(p_expected->>'quote_ref'), '') is distinct from z.quote_ref then v_changed := array_append(v_changed, 'the quote reference'::text); end if;
    if p_fields ? 'quote_sent_on' and p_expected ? 'quote_sent_on' and nullif(btrim(p_expected->>'quote_sent_on'), '')::date is distinct from z.quote_sent_on then v_changed := array_append(v_changed, 'the quote sent date'::text); end if;
    if p_fields ? 'invoice_ref' and p_expected ? 'invoice_ref' and nullif(btrim(p_expected->>'invoice_ref'), '') is distinct from z.invoice_ref then v_changed := array_append(v_changed, 'the invoice reference'::text); end if;
    if p_fields ? 'invoice_issued_on' and p_expected ? 'invoice_issued_on' and nullif(btrim(p_expected->>'invoice_issued_on'), '')::date is distinct from z.invoice_issued_on then v_changed := array_append(v_changed, 'the invoice date'::text); end if;
    if p_fields ? 'payment_received_on' and p_expected ? 'payment_received_on' and nullif(btrim(p_expected->>'payment_received_on'), '')::date is distinct from z.payment_received_on then v_changed := array_append(v_changed, 'the payment date'::text); end if;
    if p_fields ? 'paid_amount' and p_expected ? 'paid_amount' and nullif(btrim(p_expected->>'paid_amount'), '')::numeric is distinct from z.paid_amount then v_changed := array_append(v_changed, 'the amount paid'::text); end if;
    if array_length(v_changed, 1) is not null then
      -- Not 40001: PostgREST retries a transaction that fails with 40001 and, when the check fails again every time, never answers (the app bounds that, but the
      -- person would still wait for the timeout). 23514 is refused at once and says what happened.
      raise exception 'Someone else changed % since you opened this form. Reload to see their change, then try again.', array_to_string(v_changed, ', ') using errcode = '23514';
    end if;
  end if;

  -- Decision B: an existing non-blank quote reference cannot be cleared once the enquiry has reached Quote sent. Changing it to another non-blank value is allowed,
  -- and so is leaving it out of the save, or clearing one that is already blank (nothing to clear). The trigger below is the backstop for any other path.
  if p_fields ? 'quote_ref' and nullif(btrim(p_fields->>'quote_ref'), '') is null
     and nullif(btrim(coalesce(z.quote_ref, '')), '') is not null
     and crm_zoho_quote_ref_protected(v.stage, v.stage_before_hold) then
    raise exception 'The Zoho Books quote reference cannot be cleared once the enquiry has reached Quote sent (Quote sent, Negotiation, Won, or on hold from one of them). Replace it with the correct reference instead.' using errcode = '23514';
  end if;

  -- A present key is applied (JSON null or blank = intentional clear); an absent key keeps what is stored.
  v_quote_ref := case when p_fields ? 'quote_ref' then nullif(btrim(p_fields->>'quote_ref'), '') else z.quote_ref end;
  v_quote_sent_on := case when p_fields ? 'quote_sent_on' then nullif(btrim(p_fields->>'quote_sent_on'), '')::date else z.quote_sent_on end;
  v_invoice_ref := case when p_fields ? 'invoice_ref' then nullif(btrim(p_fields->>'invoice_ref'), '') else z.invoice_ref end;
  v_invoice_issued_on := case when p_fields ? 'invoice_issued_on' then nullif(btrim(p_fields->>'invoice_issued_on'), '')::date else z.invoice_issued_on end;
  v_payment_received_on := case when p_fields ? 'payment_received_on' then nullif(btrim(p_fields->>'payment_received_on'), '')::date else z.payment_received_on end;
  v_paid_amount := case when p_fields ? 'paid_amount' then nullif(btrim(p_fields->>'paid_amount'), '')::numeric else z.paid_amount end;
  if v_paid_amount is not null and v_paid_amount < 0 then
    raise exception 'The amount paid cannot be negative' using errcode = '22023';
  end if;

  insert into crm_zoho_references (opportunity_id, company_id, quote_ref, quote_sent_on, invoice_ref, invoice_issued_on,
                                   payment_received_on, paid_amount, updated_by)
  values (v.id, v.company_id, v_quote_ref, v_quote_sent_on, v_invoice_ref, v_invoice_issued_on, v_payment_received_on, v_paid_amount, auth.uid())
  on conflict (opportunity_id) do update set
    quote_ref = excluded.quote_ref, quote_sent_on = excluded.quote_sent_on, invoice_ref = excluded.invoice_ref,
    invoice_issued_on = excluded.invoice_issued_on, payment_received_on = excluded.payment_received_on,
    paid_amount = excluded.paid_amount, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

revoke all on function crm_save_zoho_reference(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function crm_save_zoho_reference(uuid, jsonb, jsonb) to authenticated;

-- Backstop for decision B on the table itself: whatever function or statement updates the row, a non-blank quote reference is not cleared at a protected stage.
create or replace function crm_zoho_quote_ref_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare o crm_opportunities;
begin
  select * into o from crm_opportunities where id = new.opportunity_id;
  if found and crm_zoho_quote_ref_protected(o.stage, o.stage_before_hold) then
    raise exception 'The Zoho Books quote reference cannot be cleared once the enquiry has reached Quote sent (Quote sent, Negotiation, Won, or on hold from one of them). Replace it with the correct reference instead.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_zoho_quote_ref_guard on crm_zoho_references;
create trigger crm_zoho_quote_ref_guard before update of quote_ref on crm_zoho_references
  for each row
  when (nullif(btrim(coalesce(old.quote_ref, '')), '') is not null and nullif(btrim(coalesce(new.quote_ref, '')), '') is null)
  execute function crm_zoho_quote_ref_guard();

-- The two helpers are internal: nobody calls them directly (the trigger and the SECURITY DEFINER function above do).
revoke all on function crm_zoho_quote_ref_protected(text, text) from public, anon, authenticated;
revoke all on function crm_zoho_quote_ref_guard() from public, anon, authenticated;

-- The old signature stays (same grants, kept by create or replace). A NULL argument now means "leave as it is".
create or replace function crm_upsert_zoho_reference(
  p_opportunity_id uuid,
  p_quote_ref text default null, p_quote_sent_on date default null,
  p_invoice_ref text default null, p_invoice_issued_on date default null,
  p_payment_received_on date default null, p_paid_amount numeric default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform crm_save_zoho_reference(p_opportunity_id, jsonb_strip_nulls(jsonb_build_object(
    'quote_ref', p_quote_ref, 'quote_sent_on', p_quote_sent_on, 'invoice_ref', p_invoice_ref,
    'invoice_issued_on', p_invoice_issued_on, 'payment_received_on', p_payment_received_on, 'paid_amount', p_paid_amount)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Proposals: superseded only from draft or sent
-- -----------------------------------------------------------------------------
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
  -- Re-read under the lock: the status checked below is the one that is current now, not the one seen before waiting for the lock.
  select * into p from crm_proposals where id = p_proposal_id for update;
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
    if p.status not in ('draft', 'sent') then
      raise exception 'Only a draft or sent proposal can be marked superseded (an accepted or already superseded one stays as it is)' using errcode = '23514';
    end if;
    update crm_proposals set status = 'superseded' where id = p.id;
  else
    raise exception 'Unknown proposal status' using errcode = '22023';
  end if;
  perform crm_log_event(v.id, v.company_id, 'proposal', p.status, 'v' || p.version || ' ' || p_status);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Won: the evidence date cannot be in the future (Dubai calendar day, as the form)
-- -----------------------------------------------------------------------------
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
  if p_evidence_date > crm_today_dubai() then
    raise exception 'The date on the purchase order or email cannot be in the future' using errcode = '22023';
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

-- Grants of the three replaced functions are unchanged (create or replace keeps them). The two new helper functions are internal (revoked below).
