-- READ ONLY. Run BEFORE applying 20261229000100_crm_enquiry_list.sql. Changes nothing.
-- Expect: rows 1 and 2 'OK'; row 3 'not installed yet' (or 'already installed' on a second run).
select 1 as n, 'the Sales tables it reads exist (crm_opportunities, crm_organisations, crm_follow_ups)' as check,
       case when to_regclass('public.crm_opportunities') is not null and to_regclass('public.crm_organisations') is not null and to_regclass('public.crm_follow_ups') is not null then 'OK' else 'STOP - the Sales migrations are missing' end as result
union all select 2, 'the Estimate sent stage is installed (the function names it as a working stage)', case when crm_stage_index('estimate_sent') = 4 then 'OK' else 'STOP - apply 20261228000100 first' end
union all select 3, 'crm_enquiry_list', case when to_regprocedure('public.crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer)') is null then 'not installed yet' else 'already installed' end
order by 1;
