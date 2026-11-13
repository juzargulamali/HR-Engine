-- READ ONLY. Run AFTER 20270105000100_proj_plan_quick_add_reorder.sql. Every row must say OK. Creates no row.
select item, result from (
  select 1 as ord, 'both functions exist; signed-in users can call them; anon and public cannot' as item,
         case when (select count(*) from (values ('public.proj_dp_add_lines(uuid, text, jsonb, boolean)'), ('public.proj_dp_reorder_lines(uuid, uuid[])')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure(f.sig) and a.grantee = 0)) = 2 then 'OK' else 'FAIL - missing or privileges differ' end as result
  union all select 2, 'Quick add goes through proj_dp_save_line (the same permission, validation and same-name rule), never a direct insert',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_dp_add_lines(uuid, text, jsonb, boolean)')) like '%proj_dp_save_line%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_dp_add_lines(uuid, text, jsonb, boolean)')) not like '%insert into proj_dp_lines%' then 'OK' else 'CHANGED' end
  union all select 3, 'reordering changes sort_order only (it names no other column in an update)',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_dp_reorder_lines(uuid, uuid[])')) ~ 'update proj_dp_lines set sort_order = i \* 10, updated_at = now\(\)' then 'OK' else 'CHANGED' end
  union all select 4, 'no two lines of one technology share a name in a section (what makes a retried Quick add safe)',
         case when not exists (select 1 from proj_dp_lines where removed_at is null group by item_id, section, lower(btrim(description)) having count(*) > 1) then 'OK' else 'FAIL - duplicate lines' end
) x order by ord;
