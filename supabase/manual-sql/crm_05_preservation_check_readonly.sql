-- READ-ONLY. Proves the Sales & CRM install changed nothing that belongs to HR. It changes nothing itself.
-- One script, used twice:
--
--   1. BEFORE the CRM migrations ("snapshot" mode): run it exactly as it is. Keep the whole result (Export -> CSV), and
--      copy the whole "paste" column of the result. The first row, `cutoff`, is the moment the snapshot was taken.
--   2. AFTER the migrations ("compare" mode): replace the single line marked >>> PASTE <<< below with the lines you
--      copied, then run it again. Every row now says SAME, DIFFERENT, INFO or NEW.
--
-- HOW TO READ THE RESULT. HR keeps being used between the two runs (people clock in, leave is requested, ledgers grow), so
-- row counts alone cannot prove anything. This check separates the two things:
--   * STRUCTURE (struct:...): every non-CRM table, column, constraint, index, policy, function, trigger, view, enum,
--     privilege and storage rule of the HR application, as a fingerprint. Nothing HR owns may change when CRM is
--     installed, and ordinary HR use never changes any of these. Any DIFFERENT here is a real finding: STOP.
--   * HISTORY (data:...): for every HR table that records when a row was created, the SET of rows that existed at the
--     `cutoff` instant (count and a fingerprint of their ids). Rows created after the cutoff are legitimate new activity
--     and are NOT part of this fingerprint; they are listed as INFO. A row that existed at the cutoff and is gone (or an
--     old row that appeared late) makes it DIFFERENT. For the append-only ledgers and the audit log, the full CONTENT of
--     every row up to the cutoff is fingerprinted as well (those rows are never edited by normal use).
--   * Rows of tables that are edited in normal use (employees, requests, approvals...) are checked by membership only; an
--     edit to an old row is legitimate and is not flagged.
-- A DIFFERENT row does not by itself prove the migration is to blame (someone could have deleted an old row by hand): it
-- tells you exactly which table to look at. SUMMARY at the bottom counts them.

with
before(item, value) as (
  values
    -- >>> PASTE the "paste" column of the BEFORE run here, replacing the next line (keep the commas) <<<
    ('__none__', '')
),
mode as (select exists (select 1 from before where item <> '__none__') as compare),
cutoff as (
  select coalesce((select value::timestamptz from before where item = 'cutoff'), now()) as t
),
-- ---- HR objects only: everything not named crm_*, not owned by an extension -------------------------------------------
hr_tables as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relkind
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and c.relname !~ '^crm_'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
),
hr_funcs as (
  select p.oid, p.proname, p.proacl, p.prosecdef
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname !~ '^crm_' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
struct as (
  select 'struct:columns' as item,
         md5(coalesce(string_agg(t.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), E'\n' order by t.relname, a.attnum), '')) as value
  from hr_tables t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 'struct:constraints', md5(coalesce(string_agg(t.relname || ':' || c.conname || ':' || pg_get_constraintdef(c.oid), E'\n' order by t.relname, c.conname), ''))
  from hr_tables t join pg_constraint c on c.conrelid = t.oid
  union all
  select 'struct:indexes', md5(coalesce(string_agg(i.tablename || ':' || i.indexname || ':' || i.indexdef, E'\n' order by i.tablename, i.indexname), ''))
  from pg_indexes i where i.schemaname = 'public' and i.tablename !~ '^crm_'
  union all
  select 'struct:policies', md5(coalesce(string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd || ':' || p.roles::text || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), E'\n' order by p.tablename, p.policyname), ''))
  from pg_policies p where p.schemaname = 'public' and p.tablename !~ '^crm_'
  union all
  select 'struct:rls_flags', md5(coalesce(string_agg(t.relname || ':' || t.relrowsecurity::text || ':' || t.relforcerowsecurity::text, E'\n' order by t.relname), ''))
  from hr_tables t
  union all
  select 'struct:table_privileges', md5(coalesce(string_agg(t.relname || ':' || coalesce(t.relacl::text, ''), E'\n' order by t.relname), ''))
  from hr_tables t
  union all
  select 'struct:functions', md5(coalesce(string_agg(pg_get_functiondef(f.oid), E'\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from hr_funcs f
  union all
  select 'struct:function_privileges', md5(coalesce(string_agg(f.proname || '(' || pg_get_function_identity_arguments(f.oid) || '):' || coalesce(f.proacl::text, ''), E'\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from hr_funcs f
  union all
  select 'struct:triggers', md5(coalesce(string_agg(t.relname || ':' || pg_get_triggerdef(g.oid), E'\n' order by t.relname, g.tgname), ''))
  from hr_tables t join pg_trigger g on g.tgrelid = t.oid and not g.tgisinternal
  union all
  select 'struct:views', md5(coalesce(string_agg(t.relname || ':' || pg_get_viewdef(t.oid), E'\n' order by t.relname), ''))
  from hr_tables t where t.relkind in ('v', 'm')
  union all
  select 'struct:enums', md5(coalesce(string_agg(t.typname || ':' || e.enumlabel, E'\n' order by t.typname, e.enumsortorder), ''))
  from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'public'::regnamespace
  union all
  select 'struct:default_privileges', md5(coalesce(string_agg(d.defaclrole::regrole::text || ':' || coalesce(d.defaclnamespace::regnamespace::text, '*') || ':' || d.defaclobjtype::text || ':' || d.defaclacl::text, E'\n' order by d.defaclrole::regrole::text, d.defaclobjtype::text), ''))
  from pg_default_acl d
  union all
  select 'struct:other_storage_buckets', md5(coalesce(string_agg(b.id || ':' || b.public::text || ':' || coalesce(b.file_size_limit::text, '') || ':' || coalesce(array_to_string(b.allowed_mime_types, ','), ''), E'\n' order by b.id), ''))
  from storage.buckets b where b.id !~ '^crm-'
  union all
  select 'struct:other_storage_policies', md5(coalesce(string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), E'\n' order by p.policyname), ''))
  from pg_policies p where p.schemaname = 'storage' and coalesce(p.qual, '') !~ 'crm-' and coalesce(p.with_check, '') !~ 'crm-'
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
  where d.relname in ('leave_ledger', 'comp_day_ledger', 'audit_log')
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
    format('(%L, %L),', c.item, c.value) as paste
  from cur c left join before b on b.item = c.item
)
select item, verdict, before_value, now_value, paste from (
  select 1 as ord, item, verdict, before_value, now_value, paste from results where item like 'struct:%'
  union all select 2, item, verdict, before_value, now_value, paste from results where item like 'data:%'
  union all select 3, item, verdict, before_value, now_value, paste from results where item like 'info:%'
  union all select 0, item, verdict, before_value, now_value, paste from results where item = 'cutoff'
  union all select 9, 'SUMMARY', case when not (select compare from mode) then 'SNAPSHOT TAKEN (now run the migrations, then run this again with the paste lines)'
                                       when exists (select 1 from results where verdict in ('DIFFERENT', 'NEW')) then 'STOP: ' || (select count(*) from results where verdict in ('DIFFERENT', 'NEW')) || ' item(s) differ, see above'
                                       else 'PASS: nothing HR owns changed (' || (select count(*) from results where verdict = 'SAME') || ' fingerprints identical)' end,
         null, null, null
) r
order by ord, item;
