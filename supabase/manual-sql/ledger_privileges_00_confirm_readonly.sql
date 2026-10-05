-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE migration 20261113000000.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It changes nothing.
-- Send me the full result (screenshot or Export -> CSV).
--
--   A  server version
--   B  the two ledger tables: owner, row-level security on/off
--   C  who holds which privilege on them (this is what the migration changes)
--   D  anything else attached to the tables: triggers, policies (all must stay as they are)
--   E  other tables in "public" where anon/authenticated hold TRUNCATE (information only; NOT changed)
--   F  fingerprint of the ledger contents (proves the migration changes no data)

select section, item, detail from (
  select 'A version' as section, 1 as ord, 'server_version' as item, version() as detail
  union all
  select 'B relation', 10 + row_number() over (order by c.relname), c.relname,
         format('kind=%s owner=%s rls_enabled=%s rls_forced=%s', c.relkind, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity)
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('leave_ledger', 'comp_day_ledger')
  union all
  select 'C privileges', 30 + row_number() over (order by t.relname, t.grantee), t.relname || ' -> ' || t.grantee,
         string_agg(t.privilege_type, ', ' order by t.privilege_type)
  from (
    select c.relname, case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee, x.privilege_type
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.relnamespace = 'public'::regnamespace and c.relname in ('leave_ledger', 'comp_day_ledger')
  ) t group by t.relname, t.grantee
  union all
  select 'D triggers', 100 + row_number() over (order by c.relname, t.tgname), c.relname || ' / ' || t.tgname, 'enabled=' || t.tgenabled::text
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname in ('leave_ledger', 'comp_day_ledger')
  union all
  select 'D triggers', 199, '(end of list)', 'if there is no row above this one, the ledgers have no user triggers'
  union all
  select 'D policies', 200 + row_number() over (order by tablename, policyname), tablename || ' / ' || policyname, 'cmd=' || cmd
  from pg_policies where schemaname = 'public' and tablename in ('leave_ledger', 'comp_day_ledger')
  union all
  select 'E truncate elsewhere', 300 + row_number() over (order by c.relname), c.relname,
         'anon=' || has_table_privilege('anon', c.oid, 'TRUNCATE') || ' authenticated=' || has_table_privilege('authenticated', c.oid, 'TRUNCATE')
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and (has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
  union all
  select 'F fingerprint', 900, 'leave_ledger', format('rows=%s md5=%s', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')))
  from public.leave_ledger
  union all
  select 'F fingerprint', 901, 'comp_day_ledger', format('rows=%s md5=%s', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')))
  from public.comp_day_ledger
) s order by ord;
