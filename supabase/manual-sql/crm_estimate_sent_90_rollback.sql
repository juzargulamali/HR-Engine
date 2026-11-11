-- WRITES. OWNER-RUN ROLLBACK of 20261228000100_crm_estimate_sent_stage.sql. Safe to run twice.
-- It STOPS, changing nothing, while any enquiry is at Estimate sent (or was put on hold or closed from it): move those enquiries to another stage in the app first
-- (the older stage rules cannot hold that value). EXPORT crm_estimate_sends FIRST: the table (every "estimate recorded as sent" record) is deleted.
-- It restores the EXACT previous crm_stage_index, crm_move_stage, crm_generate_reminders and jarvis_change_stage (privileges are kept by create or replace) and the
-- three stage checks without estimate_sent. It does not touch any enquiry, estimate, proposal, follow-up or timeline row; the timeline lines that say an estimate
-- was recorded as sent stay as history. The previous app does not use the new table or function.
do $$ declare n integer;
begin
  select count(*) into n from crm_opportunities where 'estimate_sent' in (stage, stage_before_hold, stage_before_close);
  if n > 0 then raise exception 'ROLLBACK STOPPED: % enquiry(ies) are at Estimate sent (or were held or closed from it). Move them to another stage first. Nothing was changed.', n; end if;
  if to_regclass('public.crm_estimate_sends') is not null then
    execute 'select count(*) from crm_estimate_sends' into n;
    raise notice 'estimate-sent records deleted by this rollback: %', n;
  end if;
end $$;
begin;
drop function if exists crm_record_estimate_sent(uuid, date, boolean, integer);

-- Previous definitions, exactly as in 20261115000200, 20261115000300 and 20261223000100.
create or replace function crm_stage_index(p_stage text)
returns integer
language sql immutable
as $$
  select array_position(array['new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation'], p_stage);
$$;

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
  elsif v_to_i = v_from_i or v_to_i < v_from_i - 1 then
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
  where o.stage in ('new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation')
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

drop table if exists crm_estimate_sends;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.crm_opportunities'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%proposal_prep%' loop
    execute format('alter table crm_opportunities drop constraint %I', c.conname);
  end loop;
  alter table crm_opportunities
    add constraint crm_opportunities_stage_check check (stage in (
      'new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation', 'on_hold', 'won', 'lost')),
    add constraint crm_opportunities_stage_before_hold_check check (stage_before_hold is null or stage_before_hold in (
      'new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation')),
    add constraint crm_opportunities_stage_before_close_check check (stage_before_close is null or stage_before_close in (
      'new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation'));
end $$;
commit;
