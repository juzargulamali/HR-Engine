-- READ-ONLY. Run AFTER 20261229000100_crm_enquiry_list.sql. One result table; rows 1 to 4 must say OK. Creates no row and changes nothing.
select n, item, result from (
  select 1 as n, 'crm_enquiry_list exists' as item, case when to_regprocedure('public.crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer)') is not null then 'OK' else 'MISSING' end as result
  union all select 2, 'signed-in users can call it; anon and public cannot',
         case when to_regprocedure('public.crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer)') is null then 'MISSING'
              when has_function_privilege('authenticated', 'public.crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer)', 'execute') and not has_function_privilege('anon', 'public.crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer)', 'execute')
               and not has_function_privilege('public', 'public.crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer)', 'execute') then 'OK' else 'FAIL - privileges differ' end
  union all select 3, 'it runs as the caller (security invoker), so row-level security decides what is read',
         case when exists (select 1 from pg_proc where oid = to_regprocedure('public.crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer)') and not prosecdef and provolatile = 's') then 'OK' else 'FAIL' end
  union all select 4, 'row-level security is still enabled on the three tables it reads',
         case when (select bool_and(relrowsecurity) from pg_class where oid in ('public.crm_opportunities'::regclass, 'public.crm_organisations'::regclass, 'public.crm_follow_ups'::regclass)) then 'OK' else 'FAIL' end
) t order by n;
