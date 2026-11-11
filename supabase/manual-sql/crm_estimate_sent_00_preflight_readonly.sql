-- READ ONLY. Run BEFORE applying 20261228000100_crm_estimate_sent_stage.sql. Changes nothing.
-- Expect: rows 1 to 5 'OK'; row 6 'not installed yet' (or 'already installed' on a second run). Rows 7 to 9 are for information: nothing in them is changed.
select 1 as n, 'Sales stage functions exist (crm_move_stage, crm_stage_index, crm_generate_reminders)' as check,
       case when to_regprocedure('public.crm_move_stage(uuid, text, integer)') is not null and to_regprocedure('public.crm_stage_index(text)') is not null
             and to_regprocedure('public.crm_generate_reminders(timestamptz)') is not null then 'OK' else 'STOP - the Sales migrations are missing' end as result
union all select 2, 'estimates are installed (crm_quotations)', case when to_regclass('public.crm_quotations') is not null then 'OK' else 'STOP - apply 20261220000100 first' end
union all select 3, 'the estimate guard is installed (an estimate row cannot be marked sent)',
       case when exists (select 1 from pg_trigger where tgname = 'crm_proposals_estimate_sent_guard' and not tgisinternal) then 'OK' else 'STOP - apply 20261221000100 first' end
union all select 4, 'the JARVIS stage wrapper is installed (jarvis_change_stage)',
       case when to_regprocedure('public.jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text)') is not null then 'OK' else 'STOP - apply 20261223000100 first' end
union all select 5, 'the three stage checks on crm_opportunities are found (they are widened by one value)',
       case when (select count(*) from pg_constraint where conrelid = 'public.crm_opportunities'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%proposal_prep%') = 3 then 'OK' else 'STOP - unexpected stage checks: ask before applying' end
union all select 6, 'crm_estimate_sends', case when to_regclass('public.crm_estimate_sends') is null then 'not installed yet' else 'already installed' end
union all select 7, 'for information: enquiries per stage (none is moved by the migration)', coalesce((select string_agg(stage || '=' || c, ', ' order by stage) from (select stage, count(*)::text c from crm_opportunities group by stage) s), 'none')
union all select 8, 'for information: finalised estimates (none is marked by the migration)', (select count(*)::text from crm_quotations where issued_at is not null)
union all select 9, 'for information: legacy estimate rows whose proposal says sent (left as they are; they do not count as recorded as sent)',
       (select count(*)::text from crm_proposals p where p.status = 'sent' and exists (select 1 from crm_quotations q where q.proposal_id = p.id))
order by 1;
