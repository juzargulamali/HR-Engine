-- READ ONLY. Run BEFORE applying 20261227000100_crm_event_first_edition.sql. Changes nothing.
-- Expect: rows 1 to 3 'OK' (Events & Exhibitions is installed); row 4 'not installed yet' (or 'already installed' on a second run).
select 1 as n, 'crm_events and crm_event_editions exist' as check, case when to_regclass('public.crm_events') is not null and to_regclass('public.crm_event_editions') is not null then 'OK' else 'STOP - apply 20261224000100 first' end as result
union all select 2, 'crm_save_event(uuid, text, text, text, text) exists', case when to_regprocedure('public.crm_save_event(uuid, text, text, text, text)') is not null then 'OK' else 'STOP - apply 20261224000100 first' end
union all select 3, 'crm_save_edition(uuid, uuid, date, date, text, text, text, text) exists', case when to_regprocedure('public.crm_save_edition(uuid, uuid, date, date, text, text, text, text)') is not null then 'OK' else 'STOP - apply 20261224000100 first' end
union all select 4, 'crm_add_event_with_edition', case when to_regprocedure('public.crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text)') is null then 'not installed yet' else 'already installed' end
union all select 5, 'for information: live events with no live edition (not changed by this migration)',
  (select count(*) from crm_events e where e.archived_at is null and not exists (select 1 from crm_event_editions d where d.event_id = e.id and d.archived_at is null))::text
order by 1;
