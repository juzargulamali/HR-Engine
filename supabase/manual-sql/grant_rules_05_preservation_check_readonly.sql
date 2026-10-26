-- READ-ONLY. Proves the access grant rules migration (20261215000000_access_grant_rules.sql) changed ONLY the six functions it names, and that every existing
-- grant is exactly as it was (nobody gained or lost access). It changes nothing itself. One script, used twice:
--
--   1. BEFORE the migration ("snapshot" mode): run it exactly as it is. Keep the whole result (Export -> CSV) and copy the whole "paste" column.
--   2. AFTER the migration ("compare" mode): paste the lines you copied where the comment marked >>> PASTE <<< says (above the ('__none__', '') line, which
--      stays), then run it again. Every row now says SAME, DIFFERENT, CHANGED or UNCHANGED.
--
-- HOW TO READ THE RESULT.
--   * rows:...   the four grant tables (Sales, Projects, Inventory, Budget): row count and a fingerprint of every row. SAME = every existing grant is identical.
--                (If someone gave or withdrew access in the minutes between the two runs, DIFFERENT names the module to look at: that is real use, not the migration.)
--   * struct:... every table, column, constraint, index, policy, trigger, view and table privilege of the whole public schema, and every function EXCEPT the six, as a
--                fingerprint. This migration adds and removes none of them. Any DIFFERENT here is a real finding: STOP.
--   * fn:...     the six replaced functions. After the migration each must say CHANGED (the new rules are in). UNCHANGED means the migration did not apply it.
--   * fnacl:...  the six functions' privileges, security-definer flag and search path. Each must say SAME: the new functions are callable by exactly the same people.
-- SUMMARY at the bottom counts them.

with
before(item, value) as (
  values
    -- >>> PASTE the "paste" column of the BEFORE run here, on new lines BELOW these two comment lines and ABOVE the ('__none__', '') line.
    -- >>> Do NOT delete the ('__none__', '') line: it makes the last pasted comma valid. Keep the commas of the pasted lines.
    ('__none__', '')
),
mode as (select exists (select 1 from before where item <> '__none__') as compare),
six(name) as (values ('crm_grant_access'), ('crm_revoke_access'), ('proj_revoke_access'), ('inv_revoke_access'), ('pbx_grant_access'), ('pbx_revoke_access')),
own_tables as (
  select c.oid, c.relname, c.relacl, c.relkind
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
),
other_funcs as (
  select p.oid, p.proname, p.proacl, p.prosecdef, p.proconfig
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.proname not in (select name from six)
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
struct as (
  select 'struct:columns' as item,
         md5(coalesce(string_agg(t.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), E'\n' order by t.relname, a.attnum), '')) as value
  from own_tables t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 'struct:constraints', md5(coalesce(string_agg(t.relname || ':' || c.conname || ':' || pg_get_constraintdef(c.oid), E'\n' order by t.relname, c.conname), ''))
  from own_tables t join pg_constraint c on c.conrelid = t.oid
  union all
  select 'struct:indexes', md5(coalesce(string_agg(i.tablename || ':' || i.indexname || ':' || i.indexdef, E'\n' order by i.tablename, i.indexname), ''))
  from pg_indexes i where i.schemaname = 'public'
  union all
  select 'struct:policies', md5(coalesce(string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd || ':' || p.roles::text || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), E'\n' order by p.tablename, p.policyname), ''))
  from pg_policies p where p.schemaname = 'public'
  union all
  select 'struct:triggers', md5(coalesce(string_agg(c.relname || ':' || t.tgname || ':' || pg_get_triggerdef(t.oid), E'\n' order by c.relname, t.tgname), ''))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
  union all
  select 'struct:views', md5(coalesce(string_agg(t.relname || ':' || pg_get_viewdef(t.oid), E'\n' order by t.relname), ''))
  from own_tables t where t.relkind in ('v', 'm')
  union all
  select 'struct:table-privileges', md5(coalesce(string_agg(t.relname || ':' || coalesce(t.relacl::text, ''), E'\n' order by t.relname), ''))
  from own_tables t
  union all
  select 'struct:other-functions', md5(coalesce(string_agg(f.proname || '(' || pg_get_function_identity_arguments(f.oid) || '):' || md5(pg_get_functiondef(f.oid)), E'\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from other_funcs f
  union all
  select 'struct:other-function-privileges', md5(coalesce(string_agg(f.proname || '(' || pg_get_function_identity_arguments(f.oid) || '):' || coalesce(f.proacl::text, '') || ':' || f.prosecdef::text || ':' || coalesce(f.proconfig::text, ''), E'\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from other_funcs f
),
grant_rows as (
  select 'rows:sales' as item, count(*) || ':' || md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')) as value from crm_company_grants g
  union all select 'rows:projects', count(*) || ':' || md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')) from proj_company_grants g
  union all select 'rows:inventory', count(*) || ':' || md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')) from inv_company_grants g
  union all select 'rows:budget', count(*) || ':' || md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')) from pbx_company_grants g
),
six_fn as (
  select 'fn:' || p.proname as item, md5(pg_get_functiondef(p.oid)) as value
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from six)
  union all
  select 'fnacl:' || p.proname, coalesce(p.proacl::text, '') || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '')
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from six)
),
cur as (
  select item, value from struct union all select item, value from grant_rows union all select item, value from six_fn
),
results as (
  select c.item, b.value as before_value, c.value as now_value,
    case
      when not (select compare from mode) then 'SNAPSHOT'
      when b.item is null then 'NEW'
      when c.item like 'fn:%' then case when b.value = c.value then 'UNCHANGED' else 'CHANGED' end
      when b.value = c.value then 'SAME'
      else 'DIFFERENT'
    end as verdict,
    format('(%L, %L),', c.item, c.value) as paste
  from cur c left join before b on b.item = c.item
)
select item, verdict, before_value, now_value, paste from (
  select 1 as ord, item, verdict, before_value, now_value, paste from results where item like 'struct:%'
  union all select 2, item, verdict, before_value, now_value, paste from results where item like 'rows:%'
  union all select 3, item, verdict, before_value, now_value, paste from results where item like 'fn:%'
  union all select 4, item, verdict, before_value, now_value, paste from results where item like 'fnacl:%'
  union all select 9, 'SUMMARY', case
      when not (select compare from mode) then 'SNAPSHOT TAKEN (now apply the migration, then run this again with the paste lines)'
      when exists (select 1 from results where item not like 'fn:%' and verdict in ('DIFFERENT', 'NEW'))
        then 'STOP: ' || (select count(*) from results where item not like 'fn:%' and verdict in ('DIFFERENT', 'NEW')) || ' item(s) differ, see above'
      when exists (select 1 from results where item like 'fn:%' and verdict <> 'CHANGED')
        then 'NOT APPLIED: ' || (select count(*) from results where item like 'fn:%' and verdict <> 'CHANGED') || ' of the six functions are still the old version'
      else 'PASS: every existing grant is identical (' || (select count(*) from results where item like 'rows:%' and verdict = 'SAME') || ' of 4 tables), nothing else in the schema changed ('
           || (select count(*) from results where item like 'struct:%' and verdict = 'SAME') || ' fingerprints identical), the six functions carry the new rules and keep the same privileges'
    end, null, null, null
) r
order by ord, item;
