-- READ-ONLY. Proves the Inventory install changed nothing that belongs to HR, to Sales & CRM, to Projects & Tasks or to the
-- existing HR asset register (the "Assets" page), apart from the four documented triggers. It changes nothing itself.
-- One script, used twice:
--
--   1. BEFORE the Inventory migrations ("snapshot" mode): run it exactly as it is. Keep the whole result (Export -> CSV), and
--      copy the whole "paste" column of the result. The first row, `cutoff`, is the moment the snapshot was taken.
--   2. AFTER the migrations ("compare" mode): paste the lines you copied where the comment marked >>> PASTE <<< below says
--      (above the ('__none__', '') line, which stays), then run it again. Every row now says SAME, DIFFERENT, INFO or NEW.
--
-- HOW TO READ THE RESULT. HR, Sales and Projects keep being used between the two runs (people clock in, leave is requested,
-- ledgers grow, project tasks move), so row counts alone cannot prove anything. This check separates the two things:
--   * STRUCTURE (struct:...): every table, column, constraint, index, policy, function, trigger, view, enum, relation, extension,
--     privilege and storage rule that is NOT named inv_* (HR, Sales & CRM, Projects & Tasks, the legacy projects and assets
--     tables), as a fingerprint. Nothing they own may change when Inventory is installed, and ordinary use never changes any of
--     these. Any DIFFERENT here is a real finding: STOP.
--   * THE ONE INTENDED EXCEPTION (intended:...): the Inventory install adds exactly four triggers to existing tables (see
--     docs/inventory-design.md section 1 and docs/inventory-deployment.md):
--         assets             inv_legacy_guard_assets        BEFORE UPDATE OR DELETE
--         asset_assignments  inv_legacy_guard_assignments   BEFORE INSERT OR UPDATE OR DELETE
--         proj_projects      inv_proj_projects_import       AFTER INSERT (client projects)
--         proj_projects      inv_proj_projects_release      AFTER UPDATE OF status (completed / archived)
--     The "struct:triggers" fingerprint leaves out triggers whose name starts with inv_, and the "intended:" rows list those
--     four (table, name, definition) and check that there are exactly four, of exactly this kind, enabled, and that no other
--     inv_ trigger sits on a table Inventory does not own. A fifth trigger, a missing one, or one of a different kind is DIFFERENT.
--     Before the install (and after a rollback) none exist: that is shown as INFO, not as a pass for an installed system
--     (inv_20_verify_readonly.sql checks that all four are present after the install).
--   * HISTORY (data:...): for every table that records when a row was created, the SET of rows that existed at the
--     `cutoff` instant (count and a fingerprint of their ids). Rows created after the cutoff are legitimate new activity
--     and are NOT part of this fingerprint; they are listed as INFO. A row that existed at the cutoff and is gone (or an
--     old row that appeared late) makes it DIFFERENT. For the append-only ledgers and the audit logs, the full CONTENT of
--     every row up to the cutoff is fingerprinted as well (those rows are never edited by normal use).
--   * THE HR ASSET REGISTER (data:assets:... and data:asset_assignments:...): these two tables carry no creation date, so
--     the check cannot separate old rows from new ones. It fingerprints ALL their rows (the ids, and the full content). The
--     Inventory install writes nothing to them (the guard triggers only act when a founder has imported an asset later), so
--     both must be SAME. If HR added or edited an asset between your two runs the row is DIFFERENT for a harmless reason:
--     ask HR, or repeat both runs without HR editing assets in between (a few minutes).
--   * Rows of tables that are edited in normal use (employees, requests, approvals, tasks...) are checked by membership only;
--     an edit to an old row is legitimate and is not flagged.
-- A DIFFERENT row does not by itself prove the migration is to blame (someone could have deleted an old row by hand): it
-- tells you exactly which table to look at. SUMMARY at the bottom counts them.

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
-- ---- everything NOT named inv_* (HR, Sales & CRM, Projects & Tasks, legacy projects and assets), not owned by an extension ------------------
hr_tables as (   -- everything that is NOT inv_*
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relkind
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and c.relname !~ '^inv_'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
),
hr_funcs as (
  select p.oid, p.proname, p.proacl, p.prosecdef
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname !~ '^inv_' and p.prokind in ('f', 'p')
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
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.relname !~ '^inv_'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  union all
  select 'struct:constraints', md5(coalesce(string_agg(t.relname || ':' || c.conname || ':' || pg_get_constraintdef(c.oid), E'\n' order by t.relname, c.conname), ''))
  from hr_tables t join pg_constraint c on c.conrelid = t.oid
  union all
  select 'struct:indexes', md5(coalesce(string_agg(i.tablename || ':' || i.indexname || ':' || i.indexdef, E'\n' order by i.tablename, i.indexname), ''))
  from pg_indexes i where i.schemaname = 'public' and i.tablename !~ '^inv_'
  union all
  select 'struct:policies', md5(coalesce(string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd || ':' || p.roles::text || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), E'\n' order by p.tablename, p.policyname), ''))
  from pg_policies p where p.schemaname = 'public' and p.tablename !~ '^inv_'
  union all
  select 'struct:rls_flags', md5(coalesce(string_agg(t.relname || ':' || t.relrowsecurity::text || ':' || t.relforcerowsecurity::text, E'\n' order by t.relname), ''))
  from hr_tables t
  union all
  select 'struct:table_privileges', md5(coalesce(string_agg(t.relname || ':' || coalesce(t.relacl::text, ''), E'\n' order by t.relname), ''))
  from hr_tables t
  union all
  select 'struct:sequence_privileges', md5(coalesce(string_agg(c.relname || ':' || coalesce(c.relacl::text, ''), E'\n' order by c.relname), ''))
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname !~ '^inv_'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  union all
  select 'struct:functions', md5(coalesce(string_agg(pg_get_functiondef(f.oid), E'\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from hr_funcs f
  union all
  select 'struct:function_privileges', md5(coalesce(string_agg(f.proname || '(' || pg_get_function_identity_arguments(f.oid) || '):' || coalesce(f.proacl::text, ''), E'\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from hr_funcs f
  union all
  -- every trigger on a non-Inventory table EXCEPT the ones named inv_*; those are judged separately by the intended: rows below
  select 'struct:triggers', md5(coalesce(string_agg(t.relname || ':' || pg_get_triggerdef(g.oid), E'\n' order by t.relname, g.tgname), ''))
  from hr_tables t join pg_trigger g on g.tgrelid = t.oid and not g.tgisinternal and g.tgname !~ '^inv_'
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
  -- Inventory creates no storage bucket and no storage policy: every bucket and every storage policy must be unchanged
  select 'struct:storage_buckets', md5(coalesce(string_agg(b.id || ':' || b.public::text || ':' || coalesce(b.file_size_limit::text, '') || ':' || coalesce(array_to_string(b.allowed_mime_types, ','), ''), E'\n' order by b.id), ''))
  from storage.buckets b
  union all
  select 'struct:storage_policies', md5(coalesce(string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), E'\n' order by p.policyname), ''))
  from pg_policies p where p.schemaname = 'storage'
),
-- ---- the intended exception: exactly these four triggers on existing tables --------------------------------------------------
intended_expected(tbl, trg, fn, kind) as (
  values
    ('asset_assignments', 'inv_legacy_guard_assignments', 'inv_legacy_guard',   'BEFORE INSERT OR DELETE OR UPDATE FOR EACH ROW'),
    ('assets',            'inv_legacy_guard_assets',      'inv_legacy_guard',   'BEFORE DELETE OR UPDATE FOR EACH ROW'),
    ('proj_projects',     'inv_proj_projects_import',     'inv_proj_after_insert', 'AFTER INSERT FOR EACH ROW WHEN (condition)'),
    ('proj_projects',     'inv_proj_projects_release',    'inv_proj_after_status', 'AFTER UPDATE OF status FOR EACH ROW WHEN (condition)')
),
intended_live as (   -- every inv_* trigger that sits on a table Inventory does not own (read from the system catalogue)
  select c.relname as tbl, g.tgname as trg, f.proname as fn,
         case when (g.tgtype & 2) <> 0 then 'BEFORE' when (g.tgtype & 64) <> 0 then 'INSTEAD OF' else 'AFTER' end
         || ' ' || array_to_string(array_remove(array[
              case when (g.tgtype & 4) <> 0 then 'INSERT' end, case when (g.tgtype & 8) <> 0 then 'DELETE' end,
              case when (g.tgtype & 16) <> 0 then 'UPDATE' || coalesce(' OF ' || (select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a where a.attrelid = g.tgrelid and a.attnum = any (g.tgattr)), '') end,
              case when (g.tgtype & 32) <> 0 then 'TRUNCATE' end], null), ' OR ')
         || case when (g.tgtype & 1) <> 0 then ' FOR EACH ROW' else ' FOR EACH STATEMENT' end
         || case when g.tgqual is not null then ' WHEN (condition)' else '' end
         || case when g.tgenabled <> 'O' then ' [NOT ENABLED]' else '' end as kind,
         pg_get_triggerdef(g.oid) as def
  from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc f on f.oid = g.tgfoid
  where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname !~ '^inv_' and g.tgname ~ '^inv_'
),
intended as (
  select 'intended:trigger:' || coalesce(l.tbl, e.tbl) || '.' || coalesce(l.trg, e.trg) as item,
         case when not (select compare from mode) then 'INFO'
              when l.trg is null then 'INFO'       -- not present: normal before the install or after a rollback
              when e.trg is null then 'DIFFERENT'  -- an inv_ trigger we do not know about
              when l.fn = e.fn and l.kind = e.kind then 'SAME'
              else 'DIFFERENT' end as verdict,
         case when e.trg is null then '(not one of the four intended triggers)'
              else 'expected: ' || e.fn || '() ' || e.kind end as before_value,
         case when l.trg is null then '(not present)' else l.def end as now_value
  from intended_live l full join intended_expected e on e.tbl = l.tbl and e.trg = l.trg
  union all
  select 'intended:four_triggers',
         case when not (select compare from mode) then 'INFO'
              when (select count(*) from intended_live) = 0 then 'INFO'
              when (select count(*) from intended_live) = 4
                   and (select count(*) from intended_live l join intended_expected e on e.tbl = l.tbl and e.trg = l.trg and e.fn = l.fn and e.kind = l.kind) = 4 then 'SAME'
              else 'DIFFERENT' end,
         'exactly 4 expected once Inventory is installed (0 before the install and after a rollback)',
         (select count(*) from intended_live)::text || ' present' ||
           case when (select count(*) from intended_live) = 0 then ' (Inventory is not installed)' else '' end
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
  where d.relname in ('leave_ledger', 'comp_day_ledger', 'audit_log', 'crm_audit_log', 'proj_audit_log')
),
-- The HR asset register has no creation dates: ALL rows are fingerprinted (the Inventory install writes nothing to them).
data_assets as (
  select 'data:assets:ids' as item, count(*)::text || ':' || md5(coalesce(string_agg(a.id::text, ',' order by a.id::text), '')) as value from assets a
  union all
  select 'data:assets:content', count(*)::text || ':' || md5(coalesce(string_agg(a::text, E'\n' order by a.id::text), '')) from assets a
  union all
  select 'data:asset_assignments:ids', count(*)::text || ':' || md5(coalesce(string_agg(a.id::text, ',' order by a.id::text), '')) from asset_assignments a
  union all
  select 'data:asset_assignments:content', count(*)::text || ':' || md5(coalesce(string_agg(a::text, E'\n' order by a.id::text), '')) from asset_assignments a
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
  union all select item, value from data_assets
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
  union all select 9, 'SUMMARY', case when not (select compare from mode) then 'SNAPSHOT TAKEN (now run the Inventory migrations, then run this again with the paste lines)'
                                       when exists (select 1 from results where verdict in ('DIFFERENT', 'NEW'))
                                         or exists (select 1 from intended where verdict in ('DIFFERENT', 'NEW')) then
                                         'STOP: ' || ((select count(*) from results where verdict in ('DIFFERENT', 'NEW')) + (select count(*) from intended where verdict in ('DIFFERENT', 'NEW'))) || ' item(s) differ, see above'
                                       when (select count(*) from intended_live) = 0 then
                                         'PASS: nothing HR, Sales, Projects or the HR asset register own changed (' || (select count(*) from results where verdict = 'SAME') || ' fingerprints identical); Inventory is not installed (0 of the 4 intended triggers present: right before the install or after a rollback)'
                                       else
                                         'PASS: nothing HR, Sales, Projects or the HR asset register own changed (' || (select count(*) from results where verdict = 'SAME') || ' fingerprints identical); the only additions to existing tables are the 4 intended Inventory triggers'
                                  end,
         null, null, null
) r
order by ord, item;
