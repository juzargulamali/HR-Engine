-- READ-ONLY. Run AFTER 20261227000100_crm_event_first_edition.sql. One result table; rows 1 to 4 must say OK. Creates no row and changes nothing.
select n, item, result from (
  select 1 as n, 'crm_add_event_with_edition exists' as item,
         case when to_regprocedure('public.crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text)') is not null then 'OK' else 'MISSING' end as result
  union all select 2, 'signed-in users can call it; anon and public cannot',
         case when to_regprocedure('public.crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text)') is null then 'MISSING'
              when has_function_privilege('authenticated', 'public.crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text)', 'execute')
               and not has_function_privilege('anon', 'public.crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text)', 'execute')
               and not has_function_privilege('public', 'public.crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text)', 'execute')
              then 'OK' else 'FAIL - privileges differ' end
  union all select 3, 'it is a security definer function with search_path = public',
         case when exists (select 1 from pg_proc where oid = to_regprocedure('public.crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text)') and prosecdef and 'search_path=public' = any(proconfig))
              then 'OK' else 'FAIL' end
  union all select 4, 'the two existing save functions are still present (not replaced or dropped)',
         case when to_regprocedure('public.crm_save_event(uuid, text, text, text, text)') is not null and to_regprocedure('public.crm_save_edition(uuid, uuid, date, date, text, text, text, text)') is not null then 'OK' else 'MISSING' end
  union all select 5, 'for information: events / editions (unchanged by the migration)',
         (select count(*) from crm_events)::text || ' / ' || (select count(*) from crm_event_editions)::text
) t order by n;
