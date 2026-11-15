-- READ ONLY. Run AFTER applying 20270112000200_crm_retire_estimate_sent_stage.sql. Changes nothing. One result table.
-- Expect: rows 1 to 8 'OK'. Rows 9 to 12 are numbers for information. Rows 100+ list every enquiry that still holds Estimate sent (the ambiguous ones the
-- migration did not move, plus any that a person put on hold from it since): each still opens and can be moved out by its owner or a founder.
with holding as (
  select o.id, o.company_id, o.reference, o.title, 'stage'::text as field from crm_opportunities o where o.stage = 'estimate_sent'
  union all
  select o.id, o.company_id, o.reference, o.title, 'stage_before_hold' from crm_opportunities o where o.stage = 'on_hold' and o.stage_before_hold = 'estimate_sent'
), plan as (
  select h.*,
         case when exists (select 1 from crm_proposals p where p.opportunity_id = h.id and p.status in ('sent', 'accepted')
                             and not exists (select 1 from crm_quotations q where q.proposal_id = p.id)) then 'proposal_sent'
              when (select e.from_value from crm_opportunity_events e where e.opportunity_id = h.id and e.kind = 'stage_changed' and e.to_value = 'estimate_sent'
                     order by e.created_at desc, e.id desc limit 1) in ('new', 'qualified', 'proposal_prep') then 'placeable' end as target
    from holding h
)
select n, item, result from (
  select 1 as n, 'crm_move_stage refuses a move to Estimate sent and no longer has the Estimate sent evidence gate' as item,
         case when (select prosrc from pg_proc where oid = 'public.crm_move_stage(uuid, text, integer)'::regprocedure) like '%Estimate sent is no longer a pipeline stage%'
                   and (select prosrc from pg_proc where oid = 'public.crm_move_stage(uuid, text, integer)'::regprocedure) not like '%crm_estimate_sends%' then 'OK' else 'FAIL' end as result
  union all select 2, 'crm_record_estimate_sent keeps its four-argument signature, still records the send, and never moves a stage',
         case when to_regprocedure('public.crm_record_estimate_sent(uuid, date, boolean, integer)') is not null
                   and (select prosrc from pg_proc where oid = 'public.crm_record_estimate_sent(uuid, date, boolean, integer)'::regprocedure) like '%insert into crm_estimate_sends%'
                   and (select prosrc from pg_proc where oid = 'public.crm_record_estimate_sent(uuid, date, boolean, integer)'::regprocedure) not like '%crm_move_stage%' then 'OK' else 'FAIL' end
  union all select 3, 'crm_reopen_opportunity refuses to reopen into Estimate sent',
         case when (select prosrc from pg_proc where oid = 'public.crm_reopen_opportunity(uuid, text, text, timestamptz, text, text, integer)'::regprocedure) like '%Estimate sent is no longer a pipeline stage%' then 'OK' else 'FAIL' end
  union all select 4, 'privileges: signed-in people can run the three functions; anonymous cannot record an estimate as sent',
         case when has_function_privilege('authenticated', 'public.crm_record_estimate_sent(uuid, date, boolean, integer)', 'execute')
                   and not has_function_privilege('anon', 'public.crm_record_estimate_sent(uuid, date, boolean, integer)', 'execute')
                   and has_function_privilege('authenticated', 'public.crm_move_stage(uuid, text, integer)', 'execute')
                   and has_function_privilege('authenticated', 'public.crm_reopen_opportunity(uuid, text, text, timestamptz, text, text, integer)', 'execute') then 'OK' else 'FAIL' end
  union all select 5, 'crm_stage_retirement_moves exists, has row level security on, and nobody but the database owner can read or write it',
         case when to_regclass('public.crm_stage_retirement_moves') is not null
                   and (select relrowsecurity from pg_class where oid = 'public.crm_stage_retirement_moves'::regclass)
                   and not has_table_privilege('authenticated', 'public.crm_stage_retirement_moves', 'select')
                   and not has_table_privilege('anon', 'public.crm_stage_retirement_moves', 'select')
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'crm_stage_retirement_moves') = 0 then 'OK' else 'FAIL' end
  union all select 6, 'the three stage checks still accept estimate_sent (unmoved enquiries, history and the rollback need it)',
         case when (select count(*) from pg_constraint where conrelid = 'public.crm_opportunities'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%estimate_sent%') = 3 then 'OK' else 'FAIL' end
  union all select 7, 'an enquiry still holding Estimate sent is still a working enquiry (position 4): it can be held, closed, reminded and moved out',
         case when crm_stage_index('estimate_sent') = 4 and crm_stage_index('proposal_sent') = 4 and crm_stage_index('quote_sent') = 5 then 'OK' else 'FAIL' end
  union all select 8, 'no enquiry that the rule can place still holds Estimate sent (everything left is ambiguous)',
         case when (select count(*) from plan where target is not null) = 0 then 'OK' else 'FAIL - run the migration again' end
  union all select 9, 'information: enquiries the migration moved (to Proposal sent / to New enquiry / to Qualified / to Proposal preparation)',
         (select count(*) filter (where to_value = 'proposal_sent')::text || ' / ' || count(*) filter (where to_value = 'new')::text || ' / ' ||
                 count(*) filter (where to_value = 'qualified')::text || ' / ' || count(*) filter (where to_value = 'proposal_prep')::text from crm_stage_retirement_moves)
  union all select 10, 'information: enquiries still holding Estimate sent (as stage / as return-from-hold stage): review each one below',
         (select count(*) from holding where field = 'stage')::text || ' / ' || (select count(*) from holding where field = 'stage_before_hold')::text
  union all select 11, 'information: closed enquiries that were closed from Estimate sent (history, not changed; reopening asks for a current stage)',
         (select count(*) from crm_opportunities where stage in ('won', 'lost') and stage_before_close = 'estimate_sent')::text
  union all select 12, 'information: estimates recorded as sent (every record is kept)',
         (select count(*) from crm_estimate_sends)::text
  union all
  select 100 + (row_number() over (order by c.legal_name, h.reference, h.field))::int,
         'still at Estimate sent: ' || c.legal_name || ' · ' || h.reference || ' · ' || h.title || case when h.field = 'stage_before_hold' then ' (on hold: the stage it returns to)' else '' end,
         'for a person to move (owner: ' || coalesce((select p.full_name from profiles p join crm_opportunities o on o.owner_id = p.id where o.id = h.id), 'unknown') || ')'
    from holding h join companies c on c.id = h.company_id
) x order by n;
