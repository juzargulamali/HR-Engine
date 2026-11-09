-- READ-ONLY. Run AFTER 20261224000100_crm_events_outreach.sql. One result table; every row must say OK. Creates no row and changes nothing.
select item, result from (
  select 1 as ord, 'table crm_events exists with row-level security enabled' as item,
         case when to_regclass('public.crm_events') is not null and (select relrowsecurity from pg_class where oid = 'public.crm_events'::regclass) then 'OK' else 'MISSING or RLS off' end as result
  union all select 2, 'table crm_event_editions exists with row-level security enabled',
         case when to_regclass('public.crm_event_editions') is not null and (select relrowsecurity from pg_class where oid = 'public.crm_event_editions'::regclass) then 'OK' else 'MISSING or RLS off' end
  union all select 3, 'table crm_event_observations exists with row-level security enabled',
         case when to_regclass('public.crm_event_observations') is not null and (select relrowsecurity from pg_class where oid = 'public.crm_event_observations'::regclass) then 'OK' else 'MISSING or RLS off' end
  union all select 4, 'the three tables are readable by signed-in users and NOT writable (no insert, update or delete grant for authenticated, anon or public)',
         case when has_table_privilege('authenticated', 'public.crm_events', 'select') and has_table_privilege('authenticated', 'public.crm_event_editions', 'select') and has_table_privilege('authenticated', 'public.crm_event_observations', 'select')
                and not (has_table_privilege('authenticated', 'public.crm_events', 'insert,update,delete') or has_table_privilege('authenticated', 'public.crm_event_editions', 'insert,update,delete')
                         or has_table_privilege('authenticated', 'public.crm_event_observations', 'insert,update,delete')
                         or has_table_privilege('anon', 'public.crm_events', 'select,insert,update,delete') or has_table_privilege('anon', 'public.crm_event_editions', 'select,insert,update,delete')
                         or has_table_privilege('anon', 'public.crm_event_observations', 'select,insert,update,delete')) then 'OK' else 'FAIL - privileges differ' end
  union all select 5, 'crm_organisations.outreach_priority exists, smallint, with the 1 to 5 check',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_organisations' and column_name = 'outreach_priority' and data_type = 'smallint')
                and exists (select 1 from pg_constraint where conrelid = 'public.crm_organisations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%outreach_priority%BETWEEN 1 AND 5%')
              then 'OK' else 'MISSING or no check' end
  union all select 6, 'crm_opportunities.event_edition_id exists, nullable, and references crm_event_editions with no cascade (an edition with enquiries cannot be deleted)',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_opportunities' and column_name = 'event_edition_id' and is_nullable = 'YES')
                and exists (select 1 from pg_constraint where conrelid = 'public.crm_opportunities'::regclass and contype = 'f' and confrelid = 'public.crm_event_editions'::regclass and confdeltype = 'a')
              then 'OK' else 'MISSING or wrong action' end
  union all select 7, 'no existing enquiry was relinked: every enquiry has no edition unless someone linked one through the app (count shown)',
         'OK (' || (select count(*) from crm_opportunities where event_edition_id is not null)::text || ' linked of ' || (select count(*) from crm_opportunities)::text || ')'
  union all select 8, 'the nine functions exist and signed-in users can call them; anon and public cannot',
         case when (select count(*) from (values
              ('public.crm_set_outreach_priority(uuid, integer)'), ('public.crm_save_event(uuid, text, text, text, text)'), ('public.crm_save_edition(uuid, uuid, date, date, text, text, text, text)'),
              ('public.crm_remove_edition(uuid)'), ('public.crm_remove_event(uuid)'), ('public.crm_record_observation(uuid, uuid, text, uuid, boolean, text, text, text, text)'),
              ('public.crm_update_observation(uuid, text, uuid, boolean, text, text, text, text)'), ('public.crm_remove_observation(uuid)'), ('public.crm_set_opportunity_edition(uuid, uuid, integer)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure(f.sig) and a.grantee = 0)) = 9 then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 9, 'the helper functions are NOT callable by signed-in users, anon or public (crm_can_edit_event_record, crm_edition_in_use, crm_observation_check)',
         case when has_function_privilege('authenticated', 'public.crm_can_edit_event_record(uuid)', 'execute') or has_function_privilege('authenticated', 'public.crm_edition_in_use(uuid)', 'execute')
                or has_function_privilege('authenticated', 'public.crm_observation_check(text, uuid, uuid, boolean, text, text, text)', 'execute') then 'FAIL - callable' else 'OK' end
  union all select 10, 'crm_create_opportunity and crm_update_opportunity were NOT replaced (no event text in their bodies)',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_create_opportunity' and prosrc not like '%event_edition%')
                and exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_update_opportunity' and prosrc not like '%event_edition%') then 'OK' else 'CHANGED' end
  union all select 11, 'crm_create_opportunity still has one signature (no ambiguous overload)',
         case when (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_create_opportunity') = 1 then 'OK' else 'MORE THAN ONE' end
  union all select 12, 'the audit trigger is on each new table',
         case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('crm_events_audit', 'crm_event_editions_audit', 'crm_event_observations_audit')) = 3 then 'OK' else 'MISSING' end
) x order by ord;
