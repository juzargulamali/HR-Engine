-- WRITES. OWNER-RUN ROLLBACK of 20270111000100_crm_retire_estimate_sent_stage.sql. Safe to run twice.
-- It restores the EXACT previous crm_move_stage and crm_record_estimate_sent (as in 20261228000100) and crm_reopen_opportunity (as in 20261115000200); privileges
-- are kept by create or replace. Estimate sent is then a stage people can be moved into again, and "record as sent" can move the enquiry again.
-- It puts back the enquiries the migration moved, but ONLY those nobody has touched since: still at the stage the migration chose, with no later stage, hold,
-- resume, close or reopen line on their timeline. Each one put back gets a timeline line. Enquiries a person moved since are left where they are and counted in
-- the notice. Then it drops crm_stage_retirement_moves (the record of what was moved). It deletes no enquiry, estimate, send record or timeline line.
-- Deploy the previous app (the one that offers the stage) together with this rollback: the current app shows such enquiries as "stage no longer used".
begin;

create or replace function crm_move_stage(p_id uuid, p_to text, p_expected_version integer default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v crm_opportunities;
  v_from_i integer;
  v_to_i integer;
  v_version integer;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  v_from_i := crm_stage_index(v.stage);
  v_to_i := crm_stage_index(p_to);
  if v.stage in ('won', 'lost') then
    raise exception 'A closed opportunity cannot change stage' using errcode = '23514';
  elsif v.stage = 'on_hold' then
    raise exception 'Resume the opportunity before moving it' using errcode = '23514';
  elsif v_to_i is null then
    raise exception 'Use the Hold, Won or Lost action for that change' using errcode = '23514';
  -- Proposal sent and Estimate sent are the SAME step (alternative milestones): a move between the two is neither forward nor back and is allowed (each keeps its own
  -- evidence gate below). Everything else is unchanged: one step back or any step forward.
  elsif p_to = v.stage or v_to_i < v_from_i - 1 then
    raise exception 'That stage move is not allowed (only one step back or any step forward)' using errcode = '23514';
  end if;
  -- Sent is not approved, and "sent" must be a recorded fact, not a label.
  if p_to = 'proposal_sent' and not exists (
       select 1 from crm_proposals where opportunity_id = p_id and status in ('sent', 'accepted')) then
    raise exception 'Record a proposal as sent before moving to Proposal sent' using errcode = '23514';
  end if;
  -- Estimate sent is its own fact: an estimate of THIS enquiry explicitly recorded as sent (crm_record_estimate_sent). A finalised or downloaded estimate, or a proposal
  -- recorded as sent, does not unlock it; and an estimate still cannot unlock Proposal sent (the guard of 20261221000100 is untouched).
  if p_to = 'estimate_sent' and not exists (select 1 from crm_estimate_sends where opportunity_id = p_id) then
    raise exception 'Record an estimate as sent before moving to Estimate sent' using errcode = '23514';
  end if;
  if p_to = 'quote_sent' and not exists (
       select 1 from crm_zoho_references where opportunity_id = p_id and length(btrim(coalesce(quote_ref, ''))) > 0) then
    raise exception 'Record the Zoho Books quote reference before moving to Quote sent' using errcode = '23514';
  end if;
  update crm_opportunities set stage = p_to, stage_changed_at = now(), version = version + 1
   where id = p_id returning version into v_version;
  perform crm_log_event(p_id, v.company_id, 'stage_changed', v.stage, p_to);
  return v_version;
end;
$$;

create or replace function crm_record_estimate_sent(p_proposal uuid, p_sent_on date, p_move boolean default false, p_expected_version integer default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  q crm_quotations;
  p crm_proposals;
  v crm_opportunities;
  v_id uuid;
  v_version integer;
  v_moved boolean := false;
begin
  perform crm_require_user();
  select * into q from crm_quotations where proposal_id = p_proposal;
  -- Not an estimate, no such row, or an enquiry of a company the caller has no Sales grant for: one answer for all three.
  if not found or not crm_has_access(q.company_id) then raise exception 'Estimate not found' using errcode = 'P0002'; end if;
  v := crm_lock_opportunity(q.opportunity_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  select * into p from crm_proposals where id = p_proposal;
  if p.opportunity_id <> v.id then raise exception 'Estimate not found' using errcode = 'P0002'; end if;
  if v.stage in ('won', 'lost') then raise exception 'A closed opportunity cannot have an estimate recorded as sent' using errcode = '23514'; end if;
  if q.issued_at is null then raise exception 'Finalise the estimate before recording it as sent' using errcode = '23514'; end if;
  if p.status = 'superseded' then raise exception 'This revision was replaced by a later one. Record the current revision as sent' using errcode = '23514'; end if;
  if p_sent_on is null then raise exception 'Enter the date the estimate was sent' using errcode = '22023'; end if;
  if p_sent_on > crm_today_dubai() then raise exception 'The sent date cannot be in the future' using errcode = '22023'; end if;
  if q.issue_date is not null and p_sent_on < q.issue_date then
    raise exception 'The sent date cannot be before the estimate was finalised (%)', to_char(q.issue_date, 'YYYY-MM-DD') using errcode = '22023';
  end if;
  if exists (select 1 from crm_estimate_sends where proposal_id = p_proposal) then
    raise exception 'This estimate revision is already recorded as sent' using errcode = '23505';
  end if;
  insert into crm_estimate_sends (proposal_id, opportunity_id, company_id, reference, revision, sent_on, recorded_by)
  values (p_proposal, v.id, v.company_id, q.reference, q.revision, p_sent_on, auth.uid()) returning id into v_id;
  perform crm_log_event(v.id, v.company_id, 'proposal', null,
    'Estimate ' || q.reference || ' rev ' || q.revision || ' recorded as sent on ' || to_char(p_sent_on, 'YYYY-MM-DD'), p_proposal::text);
  v_version := v.version;
  if coalesce(p_move, false) and v.stage <> 'estimate_sent' then
    if v.stage = 'on_hold' then raise exception 'Resume the opportunity before moving it' using errcode = '23514'; end if;
    -- Never backwards: an enquiry already at Quote sent or Negotiation keeps its stage; the estimate is recorded and that is all.
    if crm_stage_index(v.stage) > crm_stage_index('estimate_sent') then
      raise exception 'The enquiry is already past Estimate sent. Record the estimate without moving the stage' using errcode = '23514';
    end if;
    v_version := crm_move_stage(v.id, 'estimate_sent', null);
    v_moved := true;
  end if;
  return jsonb_build_object('send_id', v_id, 'moved', v_moved, 'stage', case when v_moved then 'estimate_sent' else v.stage end, 'version', v_version);
end;
$$;

create or replace function crm_reopen_opportunity(
  p_id uuid,
  p_reason text,
  p_next_title text,
  p_next_due timestamptz,
  p_next_kind text default 'other',
  p_to_stage text default null,
  p_expected_version integer default null
) returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v crm_opportunities;
  v_target text;
  v_owner uuid;
  v_version integer;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  if not crm_has_capability(v.company_id, 'reopen_closed') then
    raise exception 'Only a founder, or someone a founder gave the reopen right to, can reopen a closed opportunity'
      using errcode = '42501';
  end if;
  if v.stage not in ('won', 'lost') then
    raise exception 'Only a Won or Lost opportunity can be reopened' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to reopen an opportunity' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_next_title, ''))) = 0 or p_next_due is null then
    raise exception 'Reopening needs a new next action with a due date' using errcode = '22023';
  end if;
  v_target := coalesce(p_to_stage, v.stage_before_close, 'negotiation');
  if crm_stage_index(v_target) is null then
    raise exception 'Choose one of the working stages to reopen into' using errcode = '22023';
  end if;
  -- The follow-up must have an owner who can still work it: if the owner has lost Sales access, the person
  -- reopening takes it over (recorded on the timeline) rather than leaving a task nobody can see.
  v_owner := v.owner_id;
  if not crm_user_has_company_access(v_owner, v.company_id) then v_owner := auth.uid(); end if;

  update crm_closures set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = btrim(p_reason)
   where opportunity_id = p_id and reopened_at is null;

  update crm_opportunities set
    stage = v_target, stage_changed_at = now(), stage_before_close = null, owner_id = v_owner,
    evidence_type = null, evidence_reference = null, evidence_date = null, lost_reason = null,
    closed_at = null, closed_by = null, version = version + 1
   where id = p_id returning version into v_version;

  insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, kind, due_at, created_by)
  values (p_id, v.company_id, v_owner, btrim(p_next_title), coalesce(p_next_kind, 'other'), p_next_due, auth.uid());

  perform crm_log_event(p_id, v.company_id, 'reopened', v.stage, v_target, btrim(p_reason));
  if v_owner <> v.owner_id then
    perform crm_log_event(p_id, v.company_id, 'owner_changed', v.owner_id::text, v_owner::text,
                          'Previous owner no longer has Sales access; taken over when reopening');
  end if;
  return v_version;
end;
$$;

do $$
declare
  m record;
  n_back integer := 0;
  n_left integer := 0;
begin
  if to_regclass('public.crm_stage_retirement_moves') is null then
    raise notice 'nothing to put back: the record of moved enquiries is not there (already rolled back, or never applied)';
    return;
  end if;
  for m in execute 'select * from crm_stage_retirement_moves order by moved_at' loop
    if exists (select 1 from crm_opportunity_events e where e.opportunity_id = m.opportunity_id and e.created_at > m.moved_at
                and e.kind in ('stage_changed', 'held', 'resumed', 'won', 'lost', 'reopened')) then
      n_left := n_left + 1;
      continue;
    end if;
    if m.field = 'stage' then
      update crm_opportunities set stage = 'estimate_sent', version = version + 1 where id = m.opportunity_id and stage = m.to_value;
    else
      update crm_opportunities set stage_before_hold = 'estimate_sent', version = version + 1 where id = m.opportunity_id and stage = 'on_hold' and stage_before_hold = m.to_value;
    end if;
    if not found then
      n_left := n_left + 1;
      continue;
    end if;
    insert into crm_opportunity_events (opportunity_id, company_id, kind, from_value, to_value, reason, actor_id)
    values (m.opportunity_id, m.company_id, 'stage_changed', m.to_value, 'estimate_sent', 'The removal of the Estimate sent stage was rolled back by a system update; this enquiry was put back', null);
    n_back := n_back + 1;
  end loop;
  raise notice 'rollback: % enquiry(ies) put back at Estimate sent, % left where they are (changed by a person since)', n_back, n_left;
end $$;

drop table if exists crm_stage_retirement_moves;
commit;
