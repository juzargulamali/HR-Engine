-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER applying migration 20261113000000.
-- Run the WHOLE file; it returns ONE result table (status | check | detail). It changes nothing.
-- Every line should say PASS (INFO lines are for comparing with the "before" run).
-- Anything saying FAIL: send me the whole table and do not carry on.

select status, check_name, detail from (
  select 1 as ord, case when count(*) = 2 then 'PASS' else 'FAIL' end as status,
         'both ledgers are still tables' as check_name, count(*) || ' of 2' as detail
  from pg_class where relnamespace = 'public'::regnamespace and relname in ('leave_ledger', 'comp_day_ledger') and relkind = 'r'
  union all
  select 2, case when count(*) = 2 then 'PASS' else 'FAIL' end, 'both ledgers still have row-level security on', count(*) || ' of 2'
  from pg_class where relnamespace = 'public'::regnamespace and relname in ('leave_ledger', 'comp_day_ledger') and relrowsecurity
  union all
  select 3, case when not exists (select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
                                  where c.oid = v.n::regclass and x.grantee = (select oid from pg_roles where rolname = 'anon'))
                 then 'PASS' else 'FAIL' end,
         'anon holds no privilege on ' || v.n, 'not-signed-in visitors have no access at all'
  from (values ('public.leave_ledger'), ('public.comp_day_ledger')) v(n)
  union all
  select 4, case when (select string_agg(x.privilege_type, ', ' order by x.privilege_type)
                       from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
                       where c.oid = v.n::regclass and x.grantee = (select oid from pg_roles where rolname = 'authenticated')) = 'INSERT, SELECT'
                 then 'PASS' else 'FAIL' end,
         'signed-in users hold only SELECT and INSERT on ' || v.n,
         coalesce((select string_agg(x.privilege_type, ', ' order by x.privilege_type)
                   from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
                   where c.oid = v.n::regclass and x.grantee = (select oid from pg_roles where rolname = 'authenticated')), '(none)')
  from (values ('public.leave_ledger'), ('public.comp_day_ledger')) v(n)
  union all
  select 5, case when has_table_privilege('service_role', v.n, 'SELECT') and has_table_privilege('service_role', v.n, 'INSERT') then 'PASS' else 'REVIEW' end,
         'service_role (cron / AI jobs) can still read and write ' || v.n, 'the migration does not touch service_role; if REVIEW, compare with section C of the "before" run'
  from (values ('public.leave_ledger'), ('public.comp_day_ledger')) v(n)
  union all
  select 6, case when count(*) >= 4 then 'PASS' else 'FAIL' end, 'the ledgers'' row-level policies are still in place', count(*) || ' policies on the two ledgers (expect at least 4)'
  from pg_policies where schemaname = 'public' and tablename in ('leave_ledger', 'comp_day_ledger')
  union all
  select 20, 'INFO', 'ledger fingerprint: leave_ledger (compare with section F before)', format('rows=%s md5=%s', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')))
  from public.leave_ledger
  union all
  select 21, 'INFO', 'ledger fingerprint: comp_day_ledger (compare with section F before)', format('rows=%s md5=%s', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')))
  from public.comp_day_ledger
) s order by ord, status, check_name;
