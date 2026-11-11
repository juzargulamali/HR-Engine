-- READ-ONLY. Run AFTER 20261228000100_crm_estimate_sent_stage.sql. One result table; rows 1 to 10 must say OK. Creates no row and changes nothing.
select n, item, result from (
  select 1 as n, 'the stage check accepts estimate_sent and still accepts every earlier stage' as item,
         case when exists (select 1 from pg_constraint where conrelid = 'public.crm_opportunities'::regclass and conname = 'crm_opportunities_stage_check' and convalidated
                             and pg_get_constraintdef(oid) like '%estimate_sent%' and pg_get_constraintdef(oid) like '%proposal_sent%' and pg_get_constraintdef(oid) like '%on_hold%'
                             and pg_get_constraintdef(oid) like '%won%' and pg_get_constraintdef(oid) like '%lost%') then 'OK' else 'MISSING' end as result
  union all select 2, 'the hold and close "stage before" checks accept estimate_sent',
         case when (select count(*) from pg_constraint where conrelid = 'public.crm_opportunities'::regclass and conname in ('crm_opportunities_stage_before_hold_check', 'crm_opportunities_stage_before_close_check')
                      and convalidated and pg_get_constraintdef(oid) like '%estimate_sent%') = 2 then 'OK' else 'MISSING' end
  union all select 3, 'Estimate sent is at the same position as Proposal sent; the other positions are unchanged',
         case when crm_stage_index('estimate_sent') = 4 and crm_stage_index('proposal_sent') = 4 and crm_stage_index('new') = 1 and crm_stage_index('qualified') = 2 and crm_stage_index('proposal_prep') = 3
                and crm_stage_index('quote_sent') = 5 and crm_stage_index('negotiation') = 6 and crm_stage_index('on_hold') is null and crm_stage_index('won') is null and crm_stage_index('lost') is null
              then 'OK' else 'FAIL' end
  union all select 4, 'table crm_estimate_sends exists with row-level security enabled',
         case when to_regclass('public.crm_estimate_sends') is not null and (select relrowsecurity from pg_class where oid = 'public.crm_estimate_sends'::regclass) then 'OK' else 'MISSING or RLS off' end
  union all select 5, 'crm_estimate_sends is readable by signed-in users and NOT writable by them; closed to anon',
         case when to_regclass('public.crm_estimate_sends') is null then 'MISSING'
              when has_table_privilege('authenticated', 'public.crm_estimate_sends', 'select') and not has_table_privilege('authenticated', 'public.crm_estimate_sends', 'insert,update,delete')
               and not has_table_privilege('anon', 'public.crm_estimate_sends', 'select,insert,update,delete') then 'OK' else 'FAIL - privileges differ' end
  union all select 6, 'crm_record_estimate_sent exists; signed-in users can call it; anon and public cannot',
         case when to_regprocedure('public.crm_record_estimate_sent(uuid, date, boolean, integer)') is null then 'MISSING'
              when has_function_privilege('authenticated', 'public.crm_record_estimate_sent(uuid, date, boolean, integer)', 'execute') and not has_function_privilege('anon', 'public.crm_record_estimate_sent(uuid, date, boolean, integer)', 'execute')
               and not has_function_privilege('public', 'public.crm_record_estimate_sent(uuid, date, boolean, integer)', 'execute') then 'OK' else 'FAIL - privileges differ' end
  union all select 7, 'crm_move_stage gates Estimate sent on a recorded send and keeps the Proposal sent and Quote sent gates',
         case when exists (select 1 from pg_proc where oid = to_regprocedure('public.crm_move_stage(uuid, text, integer)') and prosrc like '%crm_estimate_sends%'
                             and prosrc like '%Record an estimate as sent before moving to Estimate sent%' and prosrc like '%Record a proposal as sent before moving to Proposal sent%'
                             and prosrc like '%Record the Zoho Books quote reference before moving to Quote sent%' and prosrc like '%crm_require_owner_or_founder%') then 'OK' else 'WRONG TEXT' end
  union all select 8, 'the estimate guard is still in place (an estimate row cannot be marked sent)',
         case when exists (select 1 from pg_trigger where tgname = 'crm_proposals_estimate_sent_guard' and tgrelid = 'public.crm_proposals'::regclass and not tgisinternal and tgenabled <> 'D') then 'OK' else 'MISSING' end
  union all select 9, 'JARVIS still moves one step at a time through crm_move_stage and refuses Estimate sent',
         case when exists (select 1 from pg_proc where oid = to_regprocedure('public.jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text)') and prosrc like '%crm_move_stage(%'
                             and prosrc like '%abs(v_to - v_from) <> 1%' and prosrc like '%jarvis_verify_proof(%' and prosrc like '%jarvis_ledger_enter(%' and prosrc like '%to or from Estimate sent%') then 'OK' else 'WRONG TEXT' end
  union all select 10, 'the reminder function is still for the service role only',
         case when has_function_privilege('service_role', 'public.crm_generate_reminders(timestamptz)', 'execute') and not has_function_privilege('authenticated', 'public.crm_generate_reminders(timestamptz)', 'execute')
               and not has_function_privilege('anon', 'public.crm_generate_reminders(timestamptz)', 'execute') then 'OK' else 'FAIL - privileges differ' end
  union all select 11, 'for information: enquiries at Estimate sent / estimates recorded as sent (0 / 0 straight after the migration)',
         (select count(*) from crm_opportunities where stage = 'estimate_sent')::text || ' / ' || (select count(*) from crm_estimate_sends)::text
) t order by n;
