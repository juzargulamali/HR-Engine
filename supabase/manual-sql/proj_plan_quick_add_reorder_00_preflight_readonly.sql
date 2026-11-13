-- READ ONLY. Run BEFORE applying 20270105000100_proj_plan_quick_add_reorder.sql. Changes nothing.
-- Expect: rows 1 and 2 'OK'; row 3 'not installed yet' (or 'already installed' on a second run).
select n, item, result from (
  select 1 as n, 'Project Plan Release 1 is installed (proj_dp_save_line with the requirement fields, proj_dp_add_sequence)' as item,
         case when to_regprocedure('public.proj_dp_save_line(uuid, uuid, jsonb, integer, text)') is not null and to_regprocedure('public.proj_dp_add_sequence(uuid, text, jsonb)') is not null then 'OK' else 'STOP - apply 20270104000100 first' end as result
  union all select 2, 'the sort_order column the order is kept in exists on proj_dp_lines',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proj_dp_lines' and column_name = 'sort_order') then 'OK' else 'STOP' end
  union all select 3, 'proj_dp_add_lines / proj_dp_reorder_lines', case when to_regprocedure('public.proj_dp_add_lines(uuid, text, jsonb, boolean)') is null then 'not installed yet' else 'already installed' end
) x order by n;
