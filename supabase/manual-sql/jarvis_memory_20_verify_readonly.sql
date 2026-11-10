-- READ ONLY. Run AFTER applying 20261226000100_jarvis_memory_suggestions.sql. Changes nothing. Every row must say OK.
select 1 as n, 'both tables exist with row level security on' as check,
       case when (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('jarvis_preferences', 'jarvis_knowledge_suggestions') and c.relrowsecurity) = 2 then 'OK' else 'FAIL' end as result
union all select 2, 'no policy on either table (the functions are the only way in)',
       case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('jarvis_preferences', 'jarvis_knowledge_suggestions')) then 'OK' else 'FAIL' end
union all select 3, 'no table privilege for anon or authenticated',
       case when not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('jarvis_preferences', 'jarvis_knowledge_suggestions') and grantee in ('anon', 'authenticated', 'PUBLIC')) then 'OK' else 'FAIL' end
union all select 4, 'signed-in users can execute exactly the four functions; anon cannot',
       case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('jarvis_pref_list', 'jarvis_pref_set', 'jarvis_pref_delete', 'jarvis_suggest_correction')
                    and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 4 then 'OK' else 'FAIL' end
union all select 5, 'only the closed set of preferences can be stored (the CHECK exists)',
       case when exists (select 1 from pg_constraint where conname = 'jarvis_preferences_known') then 'OK' else 'FAIL' end
union all select 6, 'every stored preference is one of the known pairs',
       case when not exists (select 1 from jarvis_preferences where pref_key not in ('email_length', 'english', 'tone', 'answer_length')) then 'OK' else 'FAIL' end
union all select 7, 'counts (information): preferences / pending suggestions',
       (select count(*)::text from jarvis_preferences) || ' / ' || (select count(*)::text from jarvis_knowledge_suggestions where status = 'pending')
order by 1;
