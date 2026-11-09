-- READ-ONLY. Run AFTER 20261223000100_jarvis_platform.sql and 20261223000200_jarvis_helper_privileges.sql. One result table; every row must say OK (rows marked INFORMATION show the current state and are not pass/fail).
-- It creates no row and changes nothing.
select item, result from (
  select 1 as ord, 'table ' || t || ' exists with row level security ON' as item,
         case when to_regclass('public.' || t) is null then 'MISSING'
              when exists (select 1 from pg_class c where c.oid = to_regclass('public.' || t) and c.relrowsecurity) then 'OK' else 'FAIL - row level security is off' end as result
    from unnest(array['jarvis_settings', 'jarvis_pilot_users', 'jarvis_pilot_companies', 'jarvis_action_ledger', 'jarvis_usage', 'jarvis_proof_key']) t
  union all select 2, 'anon and public have NO privilege on table ' || t,
         case when to_regclass('public.' || t) is null then 'MISSING'
              when not has_table_privilege('anon', to_regclass('public.' || t), 'select, insert, update, delete')
               and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = to_regclass('public.' || t) and a.grantee = 0) then 'OK' else 'FAIL - privileges differ' end
    from unnest(array['jarvis_settings', 'jarvis_pilot_users', 'jarvis_pilot_companies', 'jarvis_action_ledger', 'jarvis_usage', 'jarvis_proof_key']) t
  union all select 3, 'signed-in users have NO direct privilege on ' || t,
         case when to_regclass('public.' || t) is null then 'MISSING'
              when not has_table_privilege('authenticated', to_regclass('public.' || t), 'select, insert, update, delete') then 'OK' else 'FAIL - privileges differ' end
    from unnest(array['jarvis_settings', 'jarvis_pilot_users', 'jarvis_pilot_companies', 'jarvis_usage', 'jarvis_proof_key']) t
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
    from unnest(array['jarvis_my_access(uuid)', 'jarvis_usage_take(integer)', 'jarvis_create_enquiry(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_ledger_enter(uuid, text, text, uuid, text)',
                      'jarvis_ledger_done(uuid, uuid, text, jsonb)', 'jarvis_ledger_fail(uuid, text, text)', 'jarvis_register_organisation(uuid, uuid, text, integer, bigint, text, text)',
                      'jarvis_update_enquiry(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_record_meeting(uuid, uuid, text, integer, bigint, text, text)',
                      'jarvis_verify_proof(text, uuid, uuid, text, integer, bigint, text, text)']) f
  union all select 8, 'signed-in users can call ' || f || '; anon and public cannot',
         case when to_regprocedure('public.' || f) is not null
                and has_function_privilege('authenticated', to_regprocedure('public.' || f)::oid, 'execute')
                and not has_function_privilege('anon', to_regprocedure('public.' || f)::oid, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure('public.' || f) and a.grantee = 0) then 'OK' else 'FAIL - privileges differ' end
    from unnest(array['jarvis_my_access(uuid)', 'jarvis_usage_take(integer)', 'jarvis_create_enquiry(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_register_organisation(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_update_enquiry(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_record_meeting(uuid, uuid, text, integer, bigint, text, text)']) f
  union all select 8, 'the internal helper ' || f || ' is NOT callable by signed-in users, anon, public or the platform service role (only the wrappers, which run as their owner, use it; the key setter is for the owner only)',
         case when to_regprocedure('public.' || f) is not null
                and not has_function_privilege('authenticated', to_regprocedure('public.' || f)::oid, 'execute')
                and not has_function_privilege('anon', to_regprocedure('public.' || f)::oid, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure('public.' || f) and a.grantee = 0)
                and (not exists (select 1 from pg_roles where rolname = 'service_role') or not has_function_privilege('service_role', to_regprocedure('public.' || f)::oid, 'execute')) then 'OK' else 'FAIL - callable or missing' end
    from unnest(array['jarvis_ledger_json(jarvis_action_ledger, boolean)', 'jarvis_ledger_enter(uuid, text, text, uuid, text)', 'jarvis_ledger_done(uuid, uuid, text, jsonb)', 'jarvis_ledger_fail(uuid, text, text)',
                      'jarvis_hmac_sha256(bytea, bytea)', 'jarvis_verify_proof(text, uuid, uuid, text, integer, bigint, text, text)', 'jarvis_set_proof_key(text)']) f
  union all select 9, 'jarvis_create_enquiry calls the EXISTING crm_create_opportunity and checks the write switch, the Sales grant and the ledger (definition text)',
         case when exists (select 1 from pg_proc where proname = 'jarvis_create_enquiry' and pronamespace = 'public'::regnamespace
                              and prosrc like '%crm_create_opportunity(%' and prosrc like '%crm_has_access(p_company)%' and prosrc like '%pg_advisory_xact_lock%' and prosrc like '%writes_allowed%') then 'OK' else 'WRONG TEXT' end
  union all select 9, 'jarvis_register_organisation calls the EXISTING crm_create_organisation_profile and the ledger helpers, reads the duplicate acknowledgement ONLY from the verified payload (acknowledged_org_ids; no p_ack) and requires it to equal the same-name or same-website organisations that exist now (definition text)',
         case when exists (select 1 from pg_proc where proname = 'jarvis_register_organisation' and pronamespace = 'public'::regnamespace
                              and prosrc like '%crm_create_organisation_profile(%' and prosrc like '%jarvis_ledger_enter(%' and prosrc like '%crm_import_candidates(%' and prosrc like '%acknowledged_org_ids%' and prosrc like '%JV001%' and prosrc not like '%p_ack%') then 'OK' else 'WRONG TEXT' end
  union all select 9, 'jarvis_update_enquiry calls the EXISTING crm_update_opportunity with the expected version, only for the allowlisted fields (definition text)',
         case when exists (select 1 from pg_proc where proname = 'jarvis_update_enquiry' and pronamespace = 'public'::regnamespace
                              and prosrc like '%crm_update_opportunity(%' and prosrc like '%p_version%' and prosrc like '%v_allowed%' and prosrc like '%jarvis_ledger_enter(%'
                              and prosrc not like '%owner_id%' and prosrc not like '%payment_terms%') then 'OK' else 'WRONG TEXT' end
  union all select 9, 'jarvis_change_stage calls the EXISTING crm_move_stage with the expected version, one step at a time between the working stages (definition text)',
         case when exists (select 1 from pg_proc where proname = 'jarvis_change_stage' and pronamespace = 'public'::regnamespace
                              and prosrc like '%crm_move_stage(%' and prosrc like '%p_version%' and prosrc like '%abs(v_to - v_from) <> 1%' and prosrc like '%jarvis_ledger_enter(%') then 'OK' else 'WRONG TEXT' end
  union all select 9, 'jarvis_record_meeting calls the EXISTING crm_add_activity and crm_create_follow_up in ONE function (so one transaction), with no assignee argument (definition text)',
         case when exists (select 1 from pg_proc where proname = 'jarvis_record_meeting' and pronamespace = 'public'::regnamespace
                              and prosrc like '%crm_add_activity(%' and prosrc like '%crm_create_follow_up(%' and prosrc like '%jarvis_ledger_enter(%' and prosrc like '%, null);%'
                              and prosrc not like '%assigned_to%' and prosrc not like '%assignee%') then 'OK' else 'WRONG TEXT' end
  union all select 9, 'THE CONFIRMATION BOUNDARY: ' || w.fn || ' verifies the server-issued proof with its OWN action id (' || w.act || ') BEFORE any lock, ledger row, insert or call of an existing function (definition text)',
         case when p.oid is null then 'MISSING'
              when strpos(p.prosrc, 'jarvis_verify_proof(''' || w.act || '''') > 0
               and strpos(p.prosrc, 'jarvis_verify_proof(') < coalesce(least(nullif(strpos(p.prosrc, 'jarvis_ledger_enter('), 0), nullif(strpos(p.prosrc, 'pg_advisory_xact_lock'), 0), nullif(strpos(p.prosrc, 'crm_lock_opportunity('), 0),
                                                                           nullif(strpos(p.prosrc, 'insert into'), 0), nullif(strpos(p.prosrc, 'crm_create_'), 0), nullif(strpos(p.prosrc, 'crm_update_'), 0),
                                                                           nullif(strpos(p.prosrc, 'crm_move_'), 0), nullif(strpos(p.prosrc, 'crm_add_'), 0)), 1000000) then 'OK' else 'FAIL - the proof is not verified first, or the action id differs' end
    from (values ('jarvis_create_enquiry', 'jarvis.sales.enquiry.create_from_brief'), ('jarvis_register_organisation', 'jarvis.sales.organisation.register'), ('jarvis_update_enquiry', 'jarvis.sales.enquiry.update'),
                 ('jarvis_change_stage', 'jarvis.sales.enquiry.change_stage'), ('jarvis_record_meeting', 'jarvis.sales.meeting.record')) w(fn, act)
    left join pg_proc p on p.proname = w.fn and p.pronamespace = 'public'::regnamespace
  union all select 9, 'jarvis_verify_proof compares a keyed HMAC-SHA256 over the person (auth.uid()), company, action, target, version, expiry, proof id and payload hash, with the key from jarvis_proof_key, fails closed with no key, and judges expiry by now() (definition text)',
         case when exists (select 1 from pg_proc where proname = 'jarvis_verify_proof' and pronamespace = 'public'::regnamespace and prosecdef
                              and prosrc like '%auth.uid()%' and prosrc like '%jarvis_proof_key%' and prosrc like '%jarvis_hmac_sha256(%' and prosrc like '%JARVIS-PROOF-V1%' and prosrc like '%now()%'
                              and prosrc like '%JV004%' and prosrc like '%JV003%' and prosrc like '%JV002%') then 'OK' else 'WRONG TEXT' end
  union all select 9, 'NO UNSIGNED WRITE PARAMETERS: ' || w.fn || ' takes exactly the seven signed arguments (p_confirmation, p_company, p_target, p_version, p_expires, p_mac, p_payload) and nothing else',
         case when p.oid is null then 'MISSING'
              when p.pronargs = 7 and p.proargnames = array['p_confirmation', 'p_company', 'p_target', 'p_version', 'p_expires', 'p_mac', 'p_payload'] and p.prosrc not like '%p_ack%' then 'OK' else 'FAIL - an extra or renamed parameter exists' end
    from (values ('jarvis_create_enquiry'), ('jarvis_register_organisation'), ('jarvis_update_enquiry'), ('jarvis_change_stage'), ('jarvis_record_meeting')) w(fn)
    left join pg_proc p on p.proname = w.fn and p.pronamespace = 'public'::regnamespace
  union all select 9, 'the database never holds or computes the REVIEW key (the key the browser''s review token is made with): no jarvis_* function mentions it, and the stored key is the derived PROOF key only (definition text)',
         case when not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jarvis\_%' and (p.prosrc like '%JARVIS-REVIEW%'))
               and exists (select 1 from pg_proc where proname = 'jarvis_set_proof_key' and pronamespace = 'public'::regnamespace and prosrc like '%JARVIS-PROOF-KEY-V1%' and prosrc like '%jarvis_hmac_sha256(%')
               and exists (select 1 from pg_proc where proname = 'jarvis_verify_proof' and pronamespace = 'public'::regnamespace and prosrc like '%decode(v_secret, ''hex'')%') then 'OK' else 'WRONG TEXT' end
  union all select 9, 'the proof key table is unchanged in shape: one boolean id, one text key (64 hex characters once set) and its timestamp',
         case when (select string_agg(column_name || ':' || data_type, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'jarvis_proof_key') = 'id:boolean,secret:text,set_at:timestamp with time zone'
               and not exists (select 1 from jarvis_proof_key where secret !~ '^[0-9a-f]{64}$') then 'OK' else 'FAIL - the key table differs, or holds something that is not a derived key' end
  union all select 9, 'signed-in users can execute EXACTLY the seven expected jarvis_* functions (so no old signature that skips the proof is left behind)',
         case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jarvis\_%' and has_function_privilege('authenticated', p.oid, 'execute')) = 7
               and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jarvis\_%' and has_function_privilege('authenticated', p.oid, 'execute')
                                  and not exists (select 1 from unnest(array['jarvis_my_access(uuid)', 'jarvis_usage_take(integer)', 'jarvis_create_enquiry(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_register_organisation(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_update_enquiry(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text)', 'jarvis_record_meeting(uuid, uuid, text, integer, bigint, text, text)']) f where to_regprocedure('public.' || f)::oid = p.oid)) then 'OK' else 'FAIL - a different set of jarvis_* functions is callable' end
  union all select 9, 'no jarvis_* function is callable by anon or public',
         case when not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jarvis\_%'
                                  and (has_function_privilege('anon', p.oid, 'execute') or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))) then 'OK' else 'FAIL - callable' end
  union all select 9, 'the proof key table has NO privilege for public, anon, signed-in users or the platform service role, and NO policy (only the database''s own definer functions can read the key)',
         case when to_regclass('public.jarvis_proof_key') is null then 'MISSING'
              when not has_table_privilege('anon', 'public.jarvis_proof_key', 'select, insert, update, delete, truncate, references, trigger')
               and not has_table_privilege('authenticated', 'public.jarvis_proof_key', 'select, insert, update, delete, truncate, references, trigger')
               and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = 'public.jarvis_proof_key'::regclass and a.grantee = 0)
               and (not exists (select 1 from pg_roles where rolname = 'service_role') or not has_table_privilege('service_role', 'public.jarvis_proof_key', 'select, insert, update, delete, truncate, references, trigger'))
               and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jarvis_proof_key') then 'OK' else 'FAIL - privileges or a policy exist' end
  union all select 9, 'jarvis_my_access (the only thing a signed-in user can ask about JARVIS) never touches the proof key (definition text)',
         case when exists (select 1 from pg_proc where proname = 'jarvis_my_access' and pronamespace = 'public'::regnamespace and prosrc not like '%jarvis_proof_key%') then 'OK' else 'FAIL' end
  union all select 9, 'the proof key table holds at most one row',
         case when (select count(*) from jarvis_proof_key) <= 1 then 'OK' else 'FAIL' end
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
  union all select 93, 'INFORMATION: confirmation proof key (the value is never shown). "not set" = every JARVIS write fails closed; right after the first apply it is NOT SET until the owner runs the one-line step in docs/jarvis-deployment.md',
         (select case when exists (select 1 from jarvis_proof_key) then 'set (since ' || (select to_char(set_at at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI') from jarvis_proof_key limit 1) || ' Dubai)' else 'not set' end)
) r order by ord, item;
