-- READ ONLY. Run BEFORE applying 20270112000200_crm_retire_estimate_sent_stage.sql. Changes nothing. One result table, read it top to bottom.
--
-- Rows 1 to 3 (prerequisites). Expect: 1 and 2 'OK'; 3 'not installed yet' (or 'already installed' on a second run).
-- Rows 10+ (one per company that has any): how many enquiries hold Estimate sent today, as their stage / as the stage an on-hold enquiry returns to / as the
--   stage a closed enquiry was closed from. The last number is information only: closed enquiries are history and are NOT changed.
-- Rows 100+ (one per enquiry that holds it as its stage or its return-from-hold stage): what the migration will do with it and the recorded evidence used.
--   'MOVE to <stage>'            the migration moves it there and writes a timeline line. Expect only proposal_sent, new, qualified or proposal_prep.
--   'AMBIGUOUS - NOT MOVED'      its records do not say where it belongs. The migration leaves it at Estimate sent. REVIEW THESE: after the rollout each one
--                                still opens, still needs a next action and can be moved out by its owner or a founder (Move stage), but nobody decides for them.
--   The facts column lists what was read: ordinary proposals recorded as sent, estimate sends, the Zoho Books quote reference, the stage it came from.
--   An estimate recorded as sent and a Zoho quote reference are shown for the reviewer only: neither moves an enquiry.
-- If rows 100+ are absent, no enquiry holds the stage and the migration changes no enquiry.
with holding as (
  select o.id, o.company_id, o.reference, o.title, 'stage'::text as field from crm_opportunities o where o.stage = 'estimate_sent'
  union all
  select o.id, o.company_id, o.reference, o.title, 'stage_before_hold' from crm_opportunities o where o.stage = 'on_hold' and o.stage_before_hold = 'estimate_sent'
), facts as (
  select h.*,
         (select count(*) from crm_proposals p where p.opportunity_id = h.id and p.status in ('sent', 'accepted')
             and not exists (select 1 from crm_quotations q where q.proposal_id = p.id)) as sent_proposals,
         (select count(*) from crm_proposals p where p.opportunity_id = h.id and p.status in ('sent', 'accepted')
             and exists (select 1 from crm_quotations q where q.proposal_id = p.id)) as sent_quotation_rows,
         (select count(*) from crm_estimate_sends s where s.opportunity_id = h.id) as estimate_sends,
         exists (select 1 from crm_zoho_references z where z.opportunity_id = h.id and length(btrim(coalesce(z.quote_ref, ''))) > 0) as has_quote_ref,
         (select e.from_value from crm_opportunity_events e
           where e.opportunity_id = h.id and e.kind = 'stage_changed' and e.to_value = 'estimate_sent'
           order by e.created_at desc, e.id desc limit 1) as came_from
    from holding h
), plan as (
  select f.*,
         case when f.sent_proposals > 0 then 'proposal_sent'
              when f.came_from in ('new', 'qualified', 'proposal_prep') then f.came_from end as target
    from facts f
)
select n, item, result, facts from (
  select 1 as n, 'the Estimate sent migration (20261228000100) is installed: crm_estimate_sends and crm_record_estimate_sent exist' as item,
         case when to_regclass('public.crm_estimate_sends') is not null and to_regprocedure('public.crm_record_estimate_sent(uuid, date, boolean, integer)') is not null
              then 'OK' else 'STOP - apply 20261228000100_crm_estimate_sent_stage.sql first' end as result, null::text as facts
  union all select 2, 'the functions this migration replaces exist (crm_move_stage, crm_reopen_opportunity) and the three stage checks accept estimate_sent',
         case when to_regprocedure('public.crm_move_stage(uuid, text, integer)') is not null
                   and to_regprocedure('public.crm_reopen_opportunity(uuid, text, text, timestamptz, text, text, integer)') is not null
                   and (select count(*) from pg_constraint where conrelid = 'public.crm_opportunities'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%estimate_sent%') = 3
              then 'OK' else 'STOP - a prerequisite is missing; do not apply' end, null
  union all select 3, 'this migration is not installed yet',
         case when to_regclass('public.crm_stage_retirement_moves') is not null then 'already installed' else 'not installed yet' end, null
  union all
  select 10 + (row_number() over (order by c.legal_name))::int, 'company ' || c.legal_name || ': enquiries holding Estimate sent as stage / as return-from-hold stage / closed from it (not changed)',
         (select count(*) from crm_opportunities o where o.company_id = c.id and o.stage = 'estimate_sent')::text || ' / ' ||
         (select count(*) from crm_opportunities o where o.company_id = c.id and o.stage = 'on_hold' and o.stage_before_hold = 'estimate_sent')::text || ' / ' ||
         (select count(*) from crm_opportunities o where o.company_id = c.id and o.stage in ('won', 'lost') and o.stage_before_close = 'estimate_sent')::text,
         'will move: ' || (select count(*) from plan p where p.company_id = c.id and p.target is not null)::text ||
         ', ambiguous (not moved): ' || (select count(*) from plan p where p.company_id = c.id and p.target is null)::text
    from companies c
   where exists (select 1 from crm_opportunities o where o.company_id = c.id and 'estimate_sent' in (o.stage, o.stage_before_hold, o.stage_before_close))
  union all
  select 100 + (row_number() over (order by c.legal_name, p.reference, p.field))::int,
         c.legal_name || ' · ' || p.reference || ' · ' || p.title || case when p.field = 'stage_before_hold' then ' (on hold: the stage it returns to)' else '' end,
         case when p.sent_proposals > 0 then 'MOVE to proposal_sent: a proposal (not an estimate) is recorded as sent or accepted'
              when p.target is not null then 'MOVE to ' || p.target || ': the stage history shows it entered Estimate sent from ' || p.came_from
              when p.came_from = 'proposal_sent' then 'AMBIGUOUS - NOT MOVED: it entered from Proposal sent, but no ordinary proposal is recorded as sent now'
              when p.came_from = 'quote_sent' then 'AMBIGUOUS - NOT MOVED: it stepped back from Quote sent; going forward again is a person''s decision'
              when p.came_from is null then 'AMBIGUOUS - NOT MOVED: no stage-history line shows how it reached Estimate sent'
              else 'AMBIGUOUS - NOT MOVED: it entered from ' || p.came_from end,
         'ordinary proposals sent: ' || p.sent_proposals || '; quotation rows marked sent (not counted): ' || p.sent_quotation_rows || '; estimates recorded as sent (not counted): ' || p.estimate_sends ||
         '; Zoho quote reference (not counted): ' || case when p.has_quote_ref then 'yes' else 'no' end || '; came from: ' || coalesce(p.came_from, 'unknown')
    from plan p join companies c on c.id = p.company_id
) x order by n;
