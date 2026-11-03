-- READ-ONLY. Proves the migration 20261216000820_proj_scope_decision_context.sql changed ONLY what it names and no data. It changes nothing itself. One script, used twice:
--
--   1. BEFORE the migration ("snapshot" mode): run it exactly as it is. Keep the whole result (Export -> CSV) and copy the whole "paste" column.
--   2. AFTER the migration ("compare" mode): paste the lines you copied where the comment marked >>> PASTE <<< says (above the ('__none__', '') line, which
--      stays), then run it again. Every row now says SAME, DIFFERENT, CHANGED, ADDED or UNCHANGED.
--
-- HOW TO READ THE RESULT.
--   * rows:...   row counts and fingerprints of the tables named below. SAME = identical. (If people used the system in the minutes between the two runs, DIFFERENT
--                is real use, not the migration: look at which table.)
--   * struct:... every table, column, constraint, index, policy, trigger, view and table privilege of the whole public schema, and every function EXCEPT the ones this
--                migration replaces or adds, as a fingerprint. Any DIFFERENT here is a real finding: STOP.
--   * fn:...     a replaced function. After the migration each must say CHANGED. UNCHANGED means the migration did not apply it.
--   * fnadd:...  a function this migration adds. After the migration each must say ADDED.
--   * fnacl:...  the replaced functions' privileges, security-definer flag and search path. Each must say SAME: callable by exactly the same people.
--   * chg:...    the one other thing this migration changes (privileges or a policy). Must say CHANGED.
--   * keep:...   related things this migration must NOT change. Must say SAME.
-- SUMMARY at the bottom counts them.

with
before(item, value) as (
  values
    -- >>> PASTE the "paste" column of the BEFORE run here, on new lines BELOW these two comment lines and ABOVE the ('__none__', '') line.
    -- >>> Do NOT delete the ('__none__', '') line: it makes the last pasted comma valid. Keep the commas of the pasted lines.
    ('__none__', '')
),
mode as (select exists (select 1 from before where item <> '__none__') as compare),
touched(name) as (values ('proj_scope_decisions_waiting'), ('proj_scope_decision_context')),
own_tables as (
  select c.oid, c.relname, c.relacl, c.relkind
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
),
other_funcs as (
  select p.oid, p.proname, p.proacl, p.prosecdef, p.proconfig
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.proname not in (select name from touched)
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
  select 'rows:proj_scope_changes' as item, count(*) || ':' || md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')) as value from proj_scope_changes g
  union all select 'rows:proj_scope_change_commercial' as item, count(*) || ':' || md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.scope_change_id), '')) as value from proj_scope_change_commercial g
  union all select 'rows:proj_company_grants' as item, count(*) || ':' || md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')) as value from proj_company_grants g
  union all select 'rows:proj_project_members' as item, count(*) || ':' || md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')) as value from proj_project_members g
),
touched_fn as (
  select 'fn:' || p.proname as item, md5(pg_get_functiondef(p.oid)) as value
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('')
  union all
  select 'fnacl:' || p.proname, coalesce(p.proacl::text, '') || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '')
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('')
  union all
  select 'fnadd:' || a.name, coalesce((select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = a.name limit 1), 'ABSENT')
  from (values ('proj_scope_decisions_waiting'), ('proj_scope_decision_context')) a(name) where a.name <> '__none__'
),
other_items as (
  select 'keep:proj_scope_changes and proj_scope_change_commercial policies (who can read proposals and cost effects)' as item, (select md5(coalesce(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), E'\n' order by tablename, policyname), '')) from pg_policies where schemaname = 'public' and tablename in ('proj_scope_changes', 'proj_scope_change_commercial')) as value
  union all select 'keep:proj_decide_scope_change definition (who decides is unchanged)' as item, (select md5(pg_get_functiondef('public.proj_decide_scope_change(uuid, text, text)'::regprocedure))) as value
),
cur as (
  select item, value from struct union all select item, value from grant_rows union all select item, value from touched_fn union all select item, value from other_items
),
results as (
  select c.item, b.value as before_value, c.value as now_value,
    case
      when not (select compare from mode) then 'SNAPSHOT'
      when b.item is null then 'NEW'
      when c.item like 'fnadd:%' then case when c.value = 'ABSENT' then 'MISSING' when b.value = 'ABSENT' then 'ADDED' else 'UNCHANGED' end
      when c.item like 'fn:%' or c.item like 'chg:%' then case when b.value = c.value then 'UNCHANGED' else 'CHANGED' end
      when b.value = c.value then 'SAME'
      else 'DIFFERENT'
    end as verdict,
    format('(%L, %L),', c.item, c.value) as paste
  from cur c left join before b on b.item = c.item
)
select item, verdict, before_value, now_value, paste from (
  select 1 as ord, item, verdict, before_value, now_value, paste from results where item like 'struct:%'
  union all select 2, item, verdict, before_value, now_value, paste from results where item like 'rows:%'
  union all select 3, item, verdict, before_value, now_value, paste from results where item like 'fn:%' or item like 'fnadd:%'
  union all select 4, item, verdict, before_value, now_value, paste from results where item like 'fnacl:%'
  union all select 5, item, verdict, before_value, now_value, paste from results where item like 'chg:%' or item like 'keep:%'
  union all select 9, 'SUMMARY', case
      when not (select compare from mode) then 'SNAPSHOT TAKEN (now apply the migration, then run this again with the paste lines)'
      when exists (select 1 from results where item not like 'fn:%' and item not like 'fnadd:%' and item not like 'chg:%' and verdict in ('DIFFERENT', 'NEW'))
        then 'STOP: ' || (select count(*) from results where item not like 'fn:%' and item not like 'fnadd:%' and item not like 'chg:%' and verdict in ('DIFFERENT', 'NEW')) || ' item(s) differ, see above'
      when exists (select 1 from results where (item like 'fn:%' or item like 'chg:%') and verdict <> 'CHANGED')
        or exists (select 1 from results where item like 'fnadd:%' and verdict <> 'ADDED')
        then 'NOT APPLIED: ' || (select count(*) from results where ((item like 'fn:%' or item like 'chg:%') and verdict <> 'CHANGED') or (item like 'fnadd:%' and verdict <> 'ADDED')) || ' expected change(s) are not in place'
      else 'PASS: nothing else in the schema changed (' || (select count(*) from results where item like 'struct:%' and verdict = 'SAME') || ' fingerprints identical, '
           || (select count(*) from results where item like 'rows:%' and verdict = 'SAME') || ' table fingerprint(s) identical), the 0 replaced and 2 added function(s) and the other named change are in place, and the replaced functions keep the same privileges'
    end, null, null, null
) r
order by ord, item;
