-- Sales & CRM: the "Estimate sent" stage, and recording that a finalised estimate was sent.
--
-- WHAT THIS ADDS (additive and idempotent; no row is changed, no enquiry is moved, no estimate is marked)
--   1. A stage id, estimate_sent, at the SAME level as proposal_sent: new, qualified, proposal_prep, [proposal_sent | estimate_sent], quote_sent, negotiation.
--      The three stage checks on crm_opportunities (stage, stage_before_hold, stage_before_close) are widened by that one value. Every stored stage stays valid.
--   2. crm_stage_index gives estimate_sent the same position as proposal_sent (4). Every function that asks "is this a working stage" (hold, resume, reopen, the
--      one-open-follow-up rule) therefore treats it as a working stage without being rewritten.
--   3. Table crm_estimate_sends: the recorded FACT that one finalised estimate revision was sent to the client, on a date, by a person. Readable with a Sales grant
--      for the enquiry's company; written only by crm_record_estimate_sent. Nothing is ever deleted from it by the app.
--   4. crm_record_estimate_sent(estimate, sent date, move?, expected version): the enquiry's owner or a founder records that an estimate of the enquiry, finalised
--      and not replaced by a later revision, was sent. It can move the enquiry to Estimate sent in the same call, but never backwards (from Quote sent or
--      Negotiation it records only). Finalising or downloading an estimate records nothing.
--   5. crm_move_stage (replaced; the applied body plus two things): Proposal sent <-> Estimate sent is allowed as a same-level move, and a move to Estimate sent
--      needs a row in crm_estimate_sends for that enquiry. Unchanged: owner or founder, version check, closed and on-hold refusals, one step back or any step
--      forward, Proposal sent needs a proposal recorded as sent, Quote sent needs the Zoho Books quote reference.
--   6. crm_generate_reminders (replaced; one line): "no next action" reminders cover every working stage through crm_stage_index instead of a written-out list.
--   7. jarvis_change_stage (replaced; one added refusal): JARVIS neither moves an enquiry to Estimate sent nor from it. Its proof, ledger and one-step rule are as applied.
--
-- NOT CHANGED: the estimate guard of 20261221000100 (an estimate row can never get status 'sent', so it can never unlock Proposal sent or supersede a sent
-- proposal); crm_set_proposal_status; crm_quote_issue; the Zoho rules of 20261222000100; Won, Lost, hold, resume and reopen; every policy and grant that exists.
-- A legacy quotation whose proposal row says 'sent' is left exactly as it is and does not count as an estimate recorded as sent.
--
-- ROLLBACK: supabase/manual-sql/crm_estimate_sent_90_rollback.sql

-- -----------------------------------------------------------------------------
-- 1. The stage value
-- -----------------------------------------------------------------------------
do $$
declare c record;
begin
  -- The three checks were written inline, so their names are the generated ones; they are found by what they check, not by name.
  for c in select conname from pg_constraint
            where conrelid = 'public.crm_opportunities'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%proposal_prep%' loop
    execute format('alter table crm_opportunities drop constraint %I', c.conname);
  end loop;
  alter table crm_opportunities
    add constraint crm_opportunities_stage_check check (stage in (
      'new', 'qualified', 'proposal_prep', 'proposal_sent', 'estimate_sent', 'quote_sent', 'negotiation', 'on_hold', 'won', 'lost')),
    add constraint crm_opportunities_stage_before_hold_check check (stage_before_hold is null or stage_before_hold in (
      'new', 'qualified', 'proposal_prep', 'proposal_sent', 'estimate_sent', 'quote_sent', 'negotiation')),
    add constraint crm_opportunities_stage_before_close_check check (stage_before_close is null or stage_before_close in (
      'new', 'qualified', 'proposal_prep', 'proposal_sent', 'estimate_sent', 'quote_sent', 'negotiation'));
end $$;

-- Position of a working stage; null for On hold, Won, Lost and anything unknown. Proposal sent and Estimate sent share position 4.
create or replace function crm_stage_index(p_stage text)
returns integer
language sql immutable
as $$
  select case p_stage when 'new' then 1 when 'qualified' then 2 when 'proposal_prep' then 3 when 'proposal_sent' then 4 when 'estimate_sent' then 4
                      when 'quote_sent' then 5 when 'negotiation' then 6 end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The recorded fact: this estimate revision was sent
-- -----------------------------------------------------------------------------
create table if not exists crm_estimate_sends (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null unique references crm_proposals(id),     -- the exact estimate revision; one record per revision
  opportunity_id uuid not null references crm_opportunities(id),
  company_id     uuid not null references companies(id),
  reference      text not null,                                          -- as it was when recorded (EST-..., or QUO-... for an older one)
  revision       integer not null,
  sent_on        date not null,
  recorded_by    uuid not null references auth.users(id),
  recorded_at    timestamptz not null default now()
);
create index if not exists idx_crm_estimate_sends_opp on crm_estimate_sends(opportunity_id);

drop trigger if exists crm_estimate_sends_audit on crm_estimate_sends;
create trigger crm_estimate_sends_audit after insert or update or delete on crm_estimate_sends for each row execute function crm_audit_trigger();
alter table crm_estimate_sends enable row level security;
drop policy if exists crm_estimate_sends_select on crm_estimate_sends;
create policy crm_estimate_sends_select on crm_estimate_sends for select using (crm_has_access(company_id));
revoke all on table crm_estimate_sends from anon, authenticated, public;
grant select on table crm_estimate_sends to authenticated;

-- Records that an estimate was sent (something the person already did outside the app) and, when asked and when it is not a step backwards, moves the enquiry to
-- Estimate sent in the same transaction. Returns {send_id, moved, stage, version}.
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

revoke all on function crm_record_estimate_sent(uuid, date, boolean, integer) from public, anon, authenticated;
grant execute on function crm_record_estimate_sent(uuid, date, boolean, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Plain stage moves. The applied body of 20261115000200 with the same-level move and the Estimate sent gate.
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

-- -----------------------------------------------------------------------------
-- 4. Reminders. The applied body of 20261115000300; only the list of working stages differs (it now comes from crm_stage_index).
-- -----------------------------------------------------------------------------
create or replace function crm_generate_reminders(p_now timestamptz default now())
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  n integer := 0;
  c integer;
  v_today date := (p_now at time zone 'Asia/Dubai')::date;
begin
  -- 1. Follow-ups that have fallen due.
  insert into crm_reminders (user_id, company_id, opportunity_id, follow_up_id, kind, title, due_at, dedupe_key,
                             email_status, email_next_attempt_at)
  select f.assigned_to, f.company_id, f.opportunity_id, f.id, 'follow_up_due', f.title, f.due_at,
         'fu:' || f.id || ':due:' || to_char(f.due_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI'),
         case when coalesce(s.owner_email_enabled, false) then 'pending' else 'not_requested' end,
         case when coalesce(s.owner_email_enabled, false) then p_now end
  from crm_follow_ups f
  join crm_opportunities o on o.id = f.opportunity_id and o.stage not in ('won', 'lost')
  left join crm_company_settings s on s.company_id = f.company_id
  where f.status = 'open' and f.due_at <= p_now and crm_user_has_company_access(f.assigned_to, f.company_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 2. Follow-ups more than a day overdue: a second, louder reminder to the opportunity owner.
  insert into crm_reminders (user_id, company_id, opportunity_id, follow_up_id, kind, title, due_at, dedupe_key,
                             email_status, email_next_attempt_at)
  select o.owner_id, f.company_id, f.opportunity_id, f.id, 'follow_up_overdue', f.title, f.due_at,
         'fu:' || f.id || ':overdue:' || to_char(f.due_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI'),
         case when coalesce(s.owner_email_enabled, false) then 'pending' else 'not_requested' end,
         case when coalesce(s.owner_email_enabled, false) then p_now end
  from crm_follow_ups f
  join crm_opportunities o on o.id = f.opportunity_id and o.stage not in ('won', 'lost')
  left join crm_company_settings s on s.company_id = f.company_id
  where f.status = 'open' and f.due_at <= p_now - interval '24 hours' and crm_user_has_company_access(o.owner_id, f.company_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 3. Holds whose review date has arrived.
  insert into crm_reminders (user_id, company_id, opportunity_id, kind, title, due_at, dedupe_key,
                             email_status, email_next_attempt_at)
  select o.owner_id, o.company_id, o.id, 'hold_review_due', 'Review the hold on ' || o.reference, o.hold_review_date::timestamptz,
         'hold:' || o.id || ':' || o.hold_review_date,
         case when coalesce(s.owner_email_enabled, false) then 'pending' else 'not_requested' end,
         case when coalesce(s.owner_email_enabled, false) then p_now end
  from crm_opportunities o
  left join crm_company_settings s on s.company_id = o.company_id
  where o.stage = 'on_hold' and o.hold_review_date <= v_today and crm_user_has_company_access(o.owner_id, o.company_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 4. Active opportunities with no open follow-up (should not happen; this makes it visible once per day).
  insert into crm_reminders (user_id, company_id, opportunity_id, kind, title, dedupe_key,
                             email_status, email_next_attempt_at)
  select o.owner_id, o.company_id, o.id, 'no_next_action', o.reference || ' has no next action',
         'noaction:' || o.id || ':' || v_today,
         case when coalesce(s.owner_email_enabled, false) then 'pending' else 'not_requested' end,
         case when coalesce(s.owner_email_enabled, false) then p_now end
  from crm_opportunities o
  left join crm_company_settings s on s.company_id = o.company_id
  where crm_stage_index(o.stage) is not null      -- every working stage, Estimate sent included (was a written-out list of the six earlier stages)
    and not exists (select 1 from crm_follow_ups f where f.opportunity_id = o.id and f.status = 'open')
    and crm_user_has_company_access(o.owner_id, o.company_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Reminders that no longer apply (follow-up done, cancelled or rescheduled) stop being emailed.
  update crm_reminders r set email_status = 'skipped', email_next_attempt_at = null
   where r.email_status in ('pending', 'failed') and r.kind in ('follow_up_due', 'follow_up_overdue')
     and not exists (select 1 from crm_follow_ups f where f.id = r.follow_up_id and f.status = 'open');
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. JARVIS. The applied body of 20261223000100 with one added refusal; its write scope does not grow with the new stage.
-- -----------------------------------------------------------------------------
create or replace function jarvis_change_stage(p_confirmation uuid, p_company uuid, p_target text, p_version integer, p_expires bigint, p_mac text, p_payload text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v crm_opportunities;
  v_hash text;
  v_in jsonb;
  v_to_stage text;
  v_from integer;
  v_to integer;
  v_replay jsonb;
  v_version integer;
  v_msg text;
  v_state text;
begin
  v_hash := jarvis_verify_proof('jarvis.sales.enquiry.change_stage', p_confirmation, p_company, p_target, p_version, p_expires, p_mac, p_payload);
  if p_target = 'new' or p_version is null then raise exception 'This confirmation is not valid. Review the details again.' using errcode = 'JV002'; end if;
  v_in := p_payload::jsonb;
  if jsonb_typeof(v_in) <> 'object' or jsonb_typeof(v_in->'to') is distinct from 'string' then raise exception 'The confirmation is incomplete' using errcode = '22023'; end if;
  v_to_stage := v_in->>'to';
  v := crm_lock_opportunity(p_target::uuid);
  if v.company_id <> p_company then raise exception 'This confirmation is not valid. Review the details again.' using errcode = 'JV002'; end if;

  v_replay := jarvis_ledger_enter(p_confirmation, v_hash, 'jarvis.sales.enquiry.change_stage', p_company, p_target);
  if v_replay is not null then return v_replay; end if;

  -- Checked AFTER the repeat test on purpose (a repeat of a saved move must return the original result, although the enquiry is now at the new stage). A refusal here rolls
  -- the whole call back, ledger row included: JARVIS never offers these moves, so nothing is recorded for them.
  if v.version is distinct from p_version then raise exception 'This enquiry was changed by someone else after you reviewed it. Review the details again.' using errcode = '40001'; end if;
  -- JARVIS's write scope is unchanged by the Estimate sent stage: it neither moves an enquiry to it nor from it (that stage is recorded from the Estimates tab).
  if v_to_stage = 'estimate_sent' or v.stage = 'estimate_sent' then raise exception 'JARVIS cannot move an enquiry to or from Estimate sent. Use the enquiry page.' using errcode = '22023'; end if;
  v_from := crm_stage_index(v.stage);
  v_to := crm_stage_index(v_to_stage);
  if v_to is null then raise exception 'JARVIS cannot move an enquiry to that stage' using errcode = '22023'; end if;
  if v_from is not null and abs(v_to - v_from) <> 1 then raise exception 'JARVIS moves an enquiry one step at a time' using errcode = '22023'; end if;

  begin
    -- A closed or on-hold enquiry has no working stage: the existing function says so in its own words.
    v_version := crm_move_stage(p_target::uuid, v_to_stage, p_version);
    insert into crm_opportunity_events (opportunity_id, company_id, kind, from_value, to_value, reason, actor_id)
    values (p_target::uuid, p_company, 'details_changed', 'jarvis', 'stage', v.stage || '>' || v_to_stage, auth.uid());
    return jarvis_ledger_done(p_confirmation, p_target::uuid, v.reference, jsonb_build_object('company_id', p_company, 'version', v_version, 'from', v.stage, 'to', v_to_stage));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    return jarvis_ledger_fail(p_confirmation, v_state, v_msg);
  end;
end;
$$;
