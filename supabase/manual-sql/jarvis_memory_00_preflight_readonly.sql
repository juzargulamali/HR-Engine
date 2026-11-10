-- READ ONLY. Run BEFORE applying 20261226000100_jarvis_memory_suggestions.sql. Changes nothing.
-- Expect: the JARVIS platform is installed (the first two rows 'OK'); the new objects are reported as 'not installed yet' (or 'already installed' on a second run).
select 1 as n, 'JARVIS platform installed (jarvis_settings exists)' as check, case when to_regclass('public.jarvis_settings') is not null then 'OK' else 'STOP - apply 20261223000100 first' end as result
union all select 2, 'jarvis_my_access(uuid) exists', case when to_regprocedure('public.jarvis_my_access(uuid)') is not null then 'OK' else 'STOP - apply 20261223000100 first' end
union all select 3, 'jarvis_preferences', case when to_regclass('public.jarvis_preferences') is null then 'not installed yet' else 'already installed' end
union all select 4, 'jarvis_knowledge_suggestions', case when to_regclass('public.jarvis_knowledge_suggestions') is null then 'not installed yet' else 'already installed' end
order by 1;
