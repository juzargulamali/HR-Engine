-- READ-ONLY. Proves the Project Budget & Expenses install changed nothing that belongs to HR, Sales & CRM, Projects & Tasks, Inventory,
-- reimbursement claims or the legacy tables. It changes nothing itself. One script, used twice:
--
--   1. BEFORE the Project Budget & Expenses migrations ("snapshot" mode): run it exactly as it is. Keep the whole result
--      (Export -> CSV), and copy the whole "paste" column. The first row, `cutoff`, is the moment the snapshot was taken.
--   2. AFTER the migrations ("compare" mode): paste the lines you copied where the comment marked >>> PASTE <<< says (above the
--      ('__none__', '') line, which stays), then run it again. Every row now says SAME, DIFFERENT, INFO or NEW.
--
-- HOW TO READ THE RESULT. The other modules keep being used between the two runs (people clock in, claims are drafted, tasks move), so row
-- counts alone prove nothing. This check separates two things:
--   * STRUCTURE (struct:...): every table, column, constraint, index, policy, function, trigger, view, enum, relation, extension,
--     privilege and storage rule that is NOT named pbx_*, as a fingerprint. This install adds only pbx_* objects and touches nothing else:
--     NOT ONE trigger, policy, grant, column or function of an existing table or module changes (unlike Inventory, it adds no trigger to an
--     existing table at all). Any DIFFERENT here is a real finding: STOP.
--   * HISTORY (data:...): for every table that records when a row was created, the SET of rows that existed at the `cutoff` instant (count and a
--     fingerprint of their ids). Rows created after the cutoff are legitimate new activity and are listed as INFO. A row that existed at the
--     cutoff and is gone (or an old row that appeared late) makes it DIFFERENT. For the append-only ledgers and audit logs the full CONTENT of every
--     row up to the cutoff is fingerprinted as well. Claims, approvals and requests are checked by membership only (an edit is legitimate use).
-- A DIFFERENT row does not by itself prove the migration is to blame (someone could have deleted an old row by hand): it tells you exactly
-- which table to look at. SUMMARY at the bottom counts them.

with
before(item, value) as (
  values
    -- >>> PASTE the "paste" column of the BEFORE run here, on new lines BELOW these two comment lines and ABOVE the ('__none__', '') line.
    -- >>> Do NOT delete the ('__none__', '') line: it makes the last pasted comma valid. Keep the commas of the pasted lines.
    ('__none__', '')
),
mode as (select exists (select 1 from before where item <> '__none__') as compare),
cutoff as (
  select coalesce((select value::timestamptz from before where item = 'cutoff'), now()) as t
),
-- ---- everything NOT named pbx_* (HR, Sales & CRM, Projects & Tasks, Inventory, claims, legacy tables), not owned by an extension -------------
hr_tables as (   -- everything that is NOT pbx_*
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relkind
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and c.relname !~ '^pbx_'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
),
hr_funcs as (
  select p.oid, p.proname, p.proacl, p.prosecdef
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname !~ '^pbx_' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
struct as (
  select 'struct:columns' as item,
         md5(coalesce(string_agg(t.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), E'\n' order by t.relname, a.attnum), '')) as value
  from hr_tables t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 'struct:relations', md5(coalesce(string_agg(c.relname || ':' || c.relkind::text, E'\n' order by c.relname), ''))
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.relname !~ '^pbx_'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  union all
  select 'struct:constraints', md5(coalesce(string_agg(t.relname || ':' || c.conname || ':' || pg_get_constraintdef(c.oid), E'\n' order by t.relname, c.conname), ''))
  from hr_tables t join pg_constraint c on c.conrelid = t.oid
  union all
  select 'struct:indexes', md5(coalesce(string_agg(i.tablename || ':' || i.indexname || ':' || i.indexdef, E'\n' order by i.tablename, i.indexname), ''))
  from pg_indexes i where i.schemaname = 'public' and i.tablename !~ '^pbx_'
  union all
  select 'struct:policies', md5(coalesce(string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd || ':' || p.roles::text || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), E'\n' order by p.tablename, p.policyname), ''))
  from pg_policies p where p.schemaname = 'public' and p.tablename !~ '^pbx_'
  union all
  select 'struct:rls_flags', md5(coalesce(string_agg(t.relname || ':' || t.relrowsecurity::text || ':' || t.relforcerowsecurity::text, E'\n' order by t.relname), ''))
  from hr_tables t
  union all
  select 'struct:table_privileges', md5(coalesce(string_agg(t.relname || ':' || coalesce(t.relacl::text, ''), E'\n' order by t.relname), ''))
  from hr_tables t
  union all
  select 'struct:sequence_privileges', md5(coalesce(string_agg(c.relname || ':' || coalesce(c.relacl::text, ''), E'\n' order by c.relname), ''))
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname !~ '^pbx_'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  union all
  select 'struct:functions', md5(coalesce(string_agg(pg_get_functiondef(f.oid), E'\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from hr_funcs f
  union all
  select 'struct:function_privileges', md5(coalesce(string_agg(f.proname || '(' || pg_get_function_identity_arguments(f.oid) || '):' || coalesce(f.proacl::text, ''), E'\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from hr_funcs f
  union all
  -- every trigger on a non-pbx table (this install adds none; a pbx_ trigger on an existing table is reported by the intended: rows below)
  select 'struct:triggers', md5(coalesce(string_agg(t.relname || ':' || pg_get_triggerdef(g.oid), E'\n' order by t.relname, g.tgname), ''))
  from hr_tables t join pg_trigger g on g.tgrelid = t.oid and not g.tgisinternal and g.tgname !~ '^pbx_'
  union all
  select 'struct:views', md5(coalesce(string_agg(t.relname || ':' || pg_get_viewdef(t.oid), E'\n' order by t.relname), ''))
  from hr_tables t where t.relkind in ('v', 'm')
  union all
  select 'struct:enums', md5(coalesce(string_agg(t.typname || ':' || e.enumlabel, E'\n' order by t.typname, e.enumsortorder), ''))
  from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'public'::regnamespace
  union all
  select 'struct:extensions', md5(coalesce(string_agg(x.extname || ':' || x.extversion, E'\n' order by x.extname), ''))
  from pg_extension x
  union all
  select 'struct:default_privileges', md5(coalesce(string_agg(d.defaclrole::regrole::text || ':' || coalesce(d.defaclnamespace::regnamespace::text, '*') || ':' || d.defaclobjtype::text || ':' || d.defaclacl::text, E'\n' order by d.defaclrole::regrole::text, d.defaclobjtype::text), ''))
  from pg_default_acl d
  union all
  -- this install creates no storage bucket and no storage policy: every bucket and every storage policy must be unchanged
  select 'struct:storage_buckets', md5(coalesce(string_agg(b.id || ':' || b.public::text || ':' || coalesce(b.file_size_limit::text, '') || ':' || coalesce(array_to_string(b.allowed_mime_types, ','), ''), E'\n' order by b.id), ''))
  from storage.buckets b
  union all
  select 'struct:storage_policies', md5(coalesce(string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), E'\n' order by p.policyname), ''))
  from pg_policies p where p.schemaname = 'storage'
),
-- ---- there is NO intended exception: no pbx_ trigger may sit on a table that Project Budget & Expenses does not own ------------------
intended_live as (
  select c.relname as tbl, g.tgname as trg, pg_get_triggerdef(g.oid) as def
  from pg_trigger g join pg_class c on c.oid = g.tgrelid
  where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname !~ '^pbx_' and g.tgname ~ '^pbx_'
),
intended as (
  select 'intended:no_trigger_on_existing_tables' as item,
         case when not (select compare from mode) then 'INFO'
              when (select count(*) from intended_live) = 0 then 'SAME'
              else 'DIFFERENT' end as verdict,
         'expected: 0 triggers named pbx_ on tables that are not pbx_ tables' as before_value,
         (select count(*) from intended_live)::text || ' found' || coalesce(': ' || (select string_agg(tbl || '.' || trg, ', ') from intended_live), '') as now_value
),
-- ---- data history: tables with an id and a created_at column -------------------------------------------------------------
dated as (
  select t.relname
  from hr_tables t
  where t.relkind = 'r'
    and exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'id' and not a.attisdropped)
    and exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'created_at' and not a.attisdropped)
),
data_members as (
  select 'data:' || d.relname || ':members_at_cutoff' as item,
         ((xpath('/row/n/text()', x))[1])::text || ':' || ((xpath('/row/h/text()', x))[1])::text as value
  from dated d, cutoff c,
       lateral query_to_xml(format('select count(*) as n, md5(coalesce(string_agg(t.id::text, '','' order by t.id::text), '''')) as h from %I t where t.created_at <= %L', d.relname, c.t), false, true, '') x
),
-- Append-only: normal use never edits these rows, so the full content up to the cutoff must be identical.
data_content as (
  select 'data:' || d.relname || ':content_at_cutoff' as item,
         ((xpath('/row/h/text()', x))[1])::text as value
  from dated d, cutoff c,
       lateral query_to_xml(format('select md5(coalesce(string_agg(t::text, E''\n'' order by t.id::text), '''')) as h from %I t where t.created_at <= %L', d.relname, c.t), false, true, '') x
  where d.relname in ('leave_ledger', 'comp_day_ledger', 'audit_log', 'crm_audit_log', 'proj_audit_log', 'inv_audit_log')
),
info_after as (
  select 'info:' || d.relname || ':rows_created_after_cutoff' as item,
         ((xpath('/row/n/text()', x))[1])::text as value
  from dated d, cutoff c,
       lateral query_to_xml(format('select count(*) as n from %I t where t.created_at > %L', d.relname, c.t), false, true, '') x
),
cur as (
  select 'cutoff' as item, (select t::text from cutoff) as value
  union all select item, value from struct
  union all select item, value from data_members
  union all select item, value from data_content
  union all select item, value from info_after
),
results as (
  select c.item, b.value as before_value, c.value as now_value,
    case
      when not (select compare from mode) then 'SNAPSHOT'
      when c.item = 'cutoff' then 'INFO'
      when c.item like 'info:%' then 'INFO'
      when b.item is null then 'NEW'
      when b.value = c.value then 'SAME'
      else 'DIFFERENT'
    end as verdict,
    case when c.item like 'info:%' then null else format('(%L, %L),', c.item, c.value) end as paste
  from cur c left join before b on b.item = c.item
)
select item, verdict, before_value, now_value, paste from (
  select 1 as ord, item, verdict, before_value, now_value, paste from results where item like 'struct:%'
  union all select 2, item, verdict, before_value, now_value, null::text from intended
  union all select 3, item, verdict, before_value, now_value, paste from results where item like 'data:%'
  union all select 4, item, verdict, before_value, now_value, paste from results where item like 'info:%'
  union all select 0, item, verdict, before_value, now_value, paste from results where item = 'cutoff'
  union all select 9, 'SUMMARY', case when not (select compare from mode) then 'SNAPSHOT TAKEN (now run the Project Budget & Expenses migrations, then run this again with the paste lines)'
                                       when exists (select 1 from results where verdict in ('DIFFERENT', 'NEW'))
                                         or exists (select 1 from intended where verdict in ('DIFFERENT', 'NEW')) then
                                         'STOP: ' || ((select count(*) from results where verdict in ('DIFFERENT', 'NEW')) + (select count(*) from intended where verdict in ('DIFFERENT', 'NEW'))) || ' item(s) differ, see above'
                                       else
                                         'PASS: nothing HR, Sales, Projects, Inventory or claims own changed (' || (select count(*) from results where verdict = 'SAME') || ' fingerprints identical); no trigger was added to an existing table'
                                  end,
         null, null, null
) r
order by ord, item;
