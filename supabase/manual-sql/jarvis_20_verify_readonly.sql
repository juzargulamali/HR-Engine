-- READ-ONLY. Run AFTER 20261223000100_jarvis_platform.sql. One result table; every row must say OK (rows marked INFORMATION show the current state and are not pass/fail).
-- It creates no row and changes nothing.
select item, result from (
  select 1 as ord, 'table ' || t || ' exists with row level security ON' as item,
         case when to_regclass('public.' || t) is null then 'MISSING'
              when exists (select 1 from pg_class c where c.oid = to_regclass('public.' || t) and c.relrowsecurity) then 'OK' else 'FAIL - row level security is off' end as result
    from unnest(array['jarvis_settings', 'jarvis_pilot_users', 'jarvis_pilot_companies', 'jarvis_action_ledger', 'jarvis_usage']) t
  union all select 2, 'anon and public have NO privilege on table ' || t,
         case when to_regclass('public.' || t) is null then 'MISSING'
              when not has_table_privilege('anon', to_regclass('public.' || t), 'select, insert, update, delete')
               and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = to_regclass('public.' || t) and a.grantee = 0) then 'OK' else 'FAIL - privileges differ' end
    from unnest(array['jarvis_settings', 'jarvis_pilot_users', 'jarvis_pilot_companies', 'jarvis_action_ledger', 'jarvis_usage']) t
  union all select 3, 'signed-in users have NO direct privilege on ' || t,
         case when to_regclass('public.' || t) is null then 'MISSING'
              when not has_table_privilege('authenticated', to_regclass('public.' || t), 'select, insert, update, delete') then 'OK' else 'FAIL - privileges differ' end
    from unnest(array['jarvis_settings', 'jarvis_pilot_users', 'jarvis_pilot_companies', 'jarvis_usage']) t
  union all select 4, 'signed-in users can only READ jarvis_action_ledger (no insert, update or delete)',
         case when to_regclass('public.jarvis_action_ledger') is null then 'MISSING'
              when has_table_privilege('authenticated', 'public.jarvis_action_ledger', 'select')
               and not has_table_privilege('authenticated', 'public.jarvis_action_ledger', 'insert')
               and not has_table_privilege('authenticated', 'public.jarvis_action_ledger', 'update')
               and not has_table_privilege('authenticated', 'public.jarvis_action_ledger', 'delete') then 'OK' else 'FAIL - privileges differ' end
  union all select 5, 'the only policy on any jarvis_* table is "a person reads their own ledger rows" (no write policy exists)',
         case when (select count(*) from pg_policies where schemaname = 'public' and tablename like 'jarvis\_%') = 1
               and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jarvis_action_ledger' and policyname = 'jarvis_ledger_select_own' and cmd = 'SELECT') then 'OK' else 'FAIL - policies differ' end
  union all select 6, 'confirmation id is UNIQUE in the ledger (the idempotency key)',
         case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_jarvis_ledger_confirmation' and indexdef like 'CREATE UNIQUE INDEX%(confirmation_id)%') then 'OK' else 'MISSING' end
  union all select 7, 'function ' || f || ' exists, SECURITY DEFINER with a fixed search_path',
         case when exists (select 1 from pg_proc where oid = to_regprocedure('public.' || f) and prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=public')) then 'OK' else 'MISSING or wrong shape' end
    from unnest(array['jarvis_my_access(uuid)', 'jarvis_usage_take(integer)', 'jarvis_create_enquiry(uuid, text, jsonb)']) f
  union all select 8, 'signed-in users can call ' || f || '; anon and public cannot',
         case when to_regprocedure('public.' || f) is not null
                and has_function_privilege('authenticated', to_regprocedure('public.' || f)::oid, 'execute')
                and not has_function_privilege('anon', to_regprocedure('public.' || f)::oid, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure('public.' || f) and a.grantee = 0) then 'OK' else 'FAIL - privileges differ' end
    from unnest(array['jarvis_my_access(uuid)', 'jarvis_usage_take(integer)', 'jarvis_create_enquiry(uuid, text, jsonb)']) f
  union all select 9, 'jarvis_create_enquiry calls the EXISTING crm_create_opportunity and checks the write switch, the Sales grant and the ledger (definition text)',
         case when exists (select 1 from pg_proc where proname = 'jarvis_create_enquiry' and pronamespace = 'public'::regnamespace
                              and prosrc like '%crm_create_opportunity(%' and prosrc like '%crm_has_access(v_company)%' and prosrc like '%pg_advisory_xact_lock%' and prosrc like '%writes_allowed%') then 'OK' else 'WRONG TEXT' end
  union all select 10, 'the wrapper stores no enquiry text: the ledger has no column for a brief, prompt or model output',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jarvis_action_ledger' and column_name in ('brief', 'prompt', 'args', 'body', 'text', 'content', 'output', 'values'))
              then 'OK' else 'FAIL - an unexpected text column exists' end
  union all select 11, 'the settings row exists (exactly one)',
         case when (select count(*) from jarvis_settings) = 1 then 'OK' else 'FAIL - expected exactly one settings row' end
  union all select 90, 'INFORMATION: global switch (enabled) / write switch (writes_enabled) NOW (right after the first apply both are false)',
         (select enabled::text || ' / ' || writes_enabled::text from jarvis_settings limit 1)
  union all select 91, 'INFORMATION: pilot users / pilot companies (0 = nobody can use JARVIS / no company restriction)',
         (select count(*)::text from jarvis_pilot_users) || ' / ' || (select count(*)::text from jarvis_pilot_companies)
  union all select 92, 'INFORMATION: ledger rows by status (no text is stored in them)',
         (xpath('/row/t/text()', query_to_xml($q$select coalesce(string_agg(status || ': ' || n, ', ' order by status), 'none') as t from (select status, count(*) as n from jarvis_action_ledger group by status) x$q$, false, true, '')))[1]::text
) r order by ord, item;
