-- Sales & CRM: "Estimate sent" stops being a pipeline stage. "Record as sent" stays.
--
-- WHY: sending an estimate is a FACT about one estimate revision (which revision, the date it went out, who recorded it and when: crm_estimate_sends, added by
-- 20261228000100). It is not a place in the pipeline: an estimate is not a proposal and not a Zoho Books quote, so it must neither stand beside Proposal sent as a
-- stage nor carry an enquiry anywhere.
--
-- WHAT THIS CHANGES (additive and idempotent; safe to run twice; no table, column, constraint or grant is removed)
--   1. crm_move_stage (replaced): a move TO estimate_sent is refused in words. A move FROM estimate_sent works exactly as before (it keeps position 4: one step
--      back to Proposal preparation, or forward to Proposal sent / Quote sent / Negotiation, each with its own evidence gate). Nothing else differs.
--   2. crm_record_estimate_sent (replaced, SAME SIGNATURE): it still records the send (exact revision, sent date, who, when) and writes the timeline line. Its
--      p_move parameter is kept and IGNORED: the enquiry's stage and version are never changed by it, whatever p_move says. It does not raise for p_move = true,
--      so the app deployed before this change (which sends p_move = true when its box is ticked) keeps working: the send is recorded, the stage stays.
--   3. crm_reopen_opportunity (replaced): a closed enquiry cannot be reopened INTO estimate_sent (asked for, or as the default of an enquiry that was closed
--      from it): the person chooses a current stage. Nothing else differs.
--   4. Enquiries that hold estimate_sent today (as their stage, or as the stage an on-hold enquiry returns to) are moved ONLY where their own records say where
--      they belong, and every move is written to the timeline and to crm_stage_retirement_moves (so the rollback can put it back):
--        a. a proposal that is NOT an estimate is recorded as sent or accepted          -> Proposal sent (the gate crm_move_stage itself applies);
--        b. otherwise, the stage history shows it entered Estimate sent from New enquiry, Qualified or Proposal preparation -> back to that stage
--           (none of the three needs evidence);
--        c. anything else is AMBIGUOUS and is NOT moved: it entered from Proposal sent with no ordinary proposal recorded as sent now, it stepped back from
--           Quote sent, it has no stage-history line into Estimate sent, or its only "sent" proposal row is a legacy quotation.
--      An estimate recorded as sent is evidence for NOTHING here: it is never treated as a sent proposal and never as the Zoho Books quote reference, and no
--      enquiry is moved forward past a gate (nothing goes to Quote sent or Negotiation).
--      An ambiguous enquiry keeps estimate_sent. It still opens, still needs a next action, still gets reminders, can still be put on hold, closed and moved OUT by
--      its owner or a founder; nobody can be moved IN. The preflight lists every one of them for review.
--
-- NOT CHANGED: the three stage checks on crm_opportunities still accept estimate_sent (rows that were not moved hold it, history mentions it, and the rollback needs
-- it); crm_stage_index (estimate_sent stays position 4 so an unmoved enquiry is a working enquiry for hold, resume, close, reminders and the one-open-follow-up
-- rule); crm_generate_reminders; jarvis_change_stage (it already refuses a move to or from estimate_sent); crm_estimate_sends and every record in it; every
-- timeline line (lines that mention Estimate sent stay exactly as written); stage_before_close of a closed enquiry (a historical fact: where it was closed from);
-- the estimate guard of 20261221000100; the Proposal sent and Quote sent evidence rules; every policy and grant.
--
-- ORDER RELATIVE TO THE APP: either order is safe. Recommended: deploy the app first, then run this.
--   * New app, this not yet applied: the app no longer offers the stage or the move, always sends p_move = false, and shows an enquiry still at Estimate sent
--     with "stage no longer used" and its moves out. The database still accepts the old calls, which nothing sends.
--   * This applied, old app still deployed: recording an estimate as sent works and leaves the stage alone (the old dialog's ticked "Move the enquiry to
--     Estimate sent" box then does nothing); choosing Estimate sent in Move stage, on the board or when reopening is refused with a sentence the old app shows.
--
-- ROLLBACK: supabase/manual-sql/crm_retire_estimate_sent_90_rollback.sql

-- -----------------------------------------------------------------------------
-- 1. What this migration moved (so it can be reviewed, and put back by the rollback). Not readable or writable by anyone but the database owner.
-- -----------------------------------------------------------------------------
create table if not exists crm_stage_retirement_moves (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references crm_opportunities(id) on delete cascade,
  company_id     uuid not null references companies(id),
  field          text not null check (field in ('stage', 'stage_before_hold')),
  from_value     text not null,
  to_value       text not null,
  evidence       text not null,
  moved_at       timestamptz not null default now(),
  unique (opportunity_id, field)
);
alter table crm_stage_retirement_moves enable row level security;
revoke all on table crm_stage_retirement_moves from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- 2. Plain stage moves. The applied body of 20261228000100 with: a move TO estimate_sent refused; its now unreachable evidence gate removed.
-- -----------------------------------------------------------------------------
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
  -- Estimate sent is retired: nobody is moved INTO it. An enquiry still holding it moves OUT by the ordinary rule below (it keeps position 4).
  elsif p_to = 'estimate_sent' then
    raise exception 'Estimate sent is no longer a pipeline stage. Record the estimate as sent on the Estimates tab; the stage of the enquiry stays as it is' using errcode = '23514';
  elsif p_to = v.stage or v_to_i < v_from_i - 1 then
    raise exception 'That stage move is not allowed (only one step back or any step forward)' using errcode = '23514';
  end if;
  -- Sent is not approved, and "sent" must be a recorded fact, not a label.
  if p_to = 'proposal_sent' and not exists (
       select 1 from crm_proposals where opportunity_id = p_id and status in ('sent', 'accepted')) then
    raise exception 'Record a proposal as sent before moving to Proposal sent' using errcode = '23514';
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

-- -----------------------------------------------------------------------------
-- 3. Record an estimate as sent. The applied body of 20261228000100 without the stage move: p_move is accepted and ignored.
--    Returns {send_id, moved: false, stage: <unchanged>, version: <unchanged>}.
-- -----------------------------------------------------------------------------
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
  -- p_move is kept so every existing caller still works, and is ignored: recording a send never moves the enquiry (Estimate sent is not a stage any more).
  return jsonb_build_object('send_id', v_id, 'moved', false, 'stage', v.stage, 'version', v.version);
end;
$$;

revoke all on function crm_record_estimate_sent(uuid, date, boolean, integer) from public, anon, authenticated;
grant execute on function crm_record_estimate_sent(uuid, date, boolean, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Reopen. The applied body of 20261115000200 with one refusal: never INTO estimate_sent.
-- -----------------------------------------------------------------------------
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
  -- Estimate sent is retired: nothing is reopened into it, whether it was asked for or is only where the enquiry was closed from.
  if v_target = 'estimate_sent' then
    raise exception 'Estimate sent is no longer a pipeline stage. Choose the stage to reopen into' using errcode = '22023';
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

-- -----------------------------------------------------------------------------
-- 5. Enquiries that hold the retired stage: moved only on their own recorded evidence (rules a and b in the header). The SAME rule is in the read-only preflight
--    (crm_retire_estimate_sent_00_preflight_readonly.sql), which shows the result before anything is changed. A second run finds nothing left to move.
--    stage_changed_at is left as it is (the enquiry made no progress), version goes up by one (a page opened before the move is refused as stale, as always).
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  n_moved integer := 0;
  n_left integer := 0;
begin
  for r in
    with holding as (
      select o.id, o.company_id, 'stage'::text as field from crm_opportunities o where o.stage = 'estimate_sent'
      union all
      select o.id, o.company_id, 'stage_before_hold' from crm_opportunities o where o.stage = 'on_hold' and o.stage_before_hold = 'estimate_sent'
    ), facts as (
      select h.*,
             exists (select 1 from crm_proposals p where p.opportunity_id = h.id and p.status in ('sent', 'accepted')
                       and not exists (select 1 from crm_quotations q where q.proposal_id = p.id)) as has_sent_proposal,
             (select e.from_value from crm_opportunity_events e
               where e.opportunity_id = h.id and e.kind = 'stage_changed' and e.to_value = 'estimate_sent'
               order by e.created_at desc, e.id desc limit 1) as came_from
        from holding h
    )
    select f.id, f.company_id, f.field,
           case when f.has_sent_proposal then 'proposal_sent'
                when f.came_from in ('new', 'qualified', 'proposal_prep') then f.came_from end as target,
           case when f.has_sent_proposal then 'a proposal (not an estimate) is recorded as sent or accepted'
                when f.came_from in ('new', 'qualified', 'proposal_prep') then 'the stage history shows it entered Estimate sent from ' || f.came_from end as evidence
      from facts f
  loop
    if r.target is null then
      n_left := n_left + 1;
      continue;
    end if;
    if r.field = 'stage' then
      update crm_opportunities set stage = r.target, version = version + 1 where id = r.id and stage = 'estimate_sent';
    else
      update crm_opportunities set stage_before_hold = r.target, version = version + 1 where id = r.id and stage = 'on_hold' and stage_before_hold = 'estimate_sent';
    end if;
    insert into crm_stage_retirement_moves (opportunity_id, company_id, field, from_value, to_value, evidence)
    values (r.id, r.company_id, r.field, 'estimate_sent', r.target, r.evidence)
    on conflict (opportunity_id, field) do update set to_value = excluded.to_value, evidence = excluded.evidence, moved_at = now();
    -- A system line on the enquiry's timeline (no actor). The earlier lines that mention Estimate sent are not touched.
    insert into crm_opportunity_events (opportunity_id, company_id, kind, from_value, to_value, reason, actor_id)
    values (r.id, r.company_id, 'stage_changed', 'estimate_sent', r.target,
            case when r.field = 'stage' then 'Estimate sent is no longer a pipeline stage. Moved by the system update because ' || r.evidence
                 else 'Estimate sent is no longer a pipeline stage. This enquiry is on hold; the stage it returns to was changed by the system update because ' || r.evidence end,
            null);
    n_moved := n_moved + 1;
  end loop;
  raise notice 'Estimate sent retired: % enquiry(ies) moved on recorded evidence, % left for a person to review', n_moved, n_left;
end $$;
