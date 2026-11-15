-- READ ONLY. Run AFTER applying 20270113000200_ops_crew_overlaps.sql. Changes nothing.
-- Expect: rows 1 to 4 'OK'.
select item, result from (
  select 1 as ord, 'ops_crew_overlaps exists and a signed-in user may call it (it checks the Operations right for the company itself)' as item,
         case when to_regprocedure('public.ops_crew_overlaps(uuid)') is not null and has_function_privilege('authenticated', 'public.ops_crew_overlaps(uuid)', 'execute') then 'OK' else 'PROBLEM' end as result
  union all select 2, 'it is not callable signed out, and the helper that shapes one side is not callable from a browser session',
         case when not has_function_privilege('anon', 'public.ops_crew_overlaps(uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.ops_commitment_side(text, uuid, uuid, text, text, text, text, tstzrange, text, boolean, boolean)', 'execute') then 'OK' else 'PROBLEM' end
  union all select 3, 'it runs with the definer''s rights and a fixed search path, and only reads (stable)',
         case when (select prosecdef and provolatile = 's' and proconfig::text like '%search_path=public%' from pg_proc where oid = to_regprocedure('public.ops_crew_overlaps(uuid)')) then 'OK' else 'PROBLEM' end
  union all select 4, 'the office board read is unchanged by this migration: it does not mention the new read',
         case when to_regprocedure('public.ops_tv_board(uuid)') is null then 'OK'
              when (select position('ops_crew_overlaps' in prosrc) = 0 from pg_proc where oid = to_regprocedure('public.ops_tv_board(uuid)')) then 'OK' else 'PROBLEM' end
) x order by ord;
