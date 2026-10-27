-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the access grant rules migration (20261215000000_access_grant_rules.sql).
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is information only).
-- A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  the eight grant / revoke functions exist, are SECURITY DEFINER with a fixed search path, are callable by signed-in users and NOT by anonymous visitors
--   2  the new rules are in the six replaced functions (R1 approver right, last eligible approver, serialised changes, R2 own access, R3 revoke), AND every
--      earlier protection is still there (last founder, last access manager, live Project Manager, ...)
--   3  nothing else can write a grant table: exactly those eight functions write them, none builds SQL dynamically, no trigger changes rights
--   4  the four grant tables have row-level security ON, only a read policy, and signed-in and anonymous users cannot write them directly
--   5  every company still has the access it had: counts by module (information only; compare with the preflight)
--
-- It checks DEFINITIONS and PRIVILEGES. It cannot call a function without writing, so it does not try a grant; the behaviour of every rule is proved by the
-- repository's database tests (packages/rls-tests/test/access_grant_rules.rls.test.ts) and, on this project, by the first real use (see the deployment guide).

with
eight(name) as (values ('crm_grant_access'), ('crm_revoke_access'), ('proj_grant_access'), ('proj_revoke_access'), ('inv_grant_access'), ('inv_revoke_access'), ('pbx_grant_access'), ('pbx_revoke_access')),
tables(name) as (values ('crm_company_grants'), ('proj_company_grants'), ('inv_company_grants'), ('pbx_company_grants')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from eight)),
-- text that must be present in each function: the new rule (N) or an earlier protection that must survive (E)
needs(fname, kind, label, needle) as (values
  ('pbx_grant_access', 'N', 'R1: only an approver gives or removes the approver right', 'Only a CEO / CTO approver of this company can give or remove the approver right'),
  ('pbx_grant_access', 'N', 'R1: the last eligible approver is protected', 'last eligible CEO / CTO approver of this company'),
  ('pbx_grant_access', 'N', 'R2: nobody adds a right to their own grant', 'You cannot add rights to your own access'),
  ('pbx_grant_access', 'N', 'changes are serialised per company', 'pg_advisory_xact_lock'),
  ('pbx_grant_access', 'E', 'the last access manager is protected', 'last person who holds it for this company'),
  ('pbx_grant_access', 'E', 'only access managers grant', 'budget access management for this company can grant'),
  ('pbx_revoke_access', 'N', 'R1: only an approver withdraws an approver', 'Only a CEO / CTO approver of this company can withdraw an approver'),
  ('pbx_revoke_access', 'N', 'R1: the last eligible approver is protected', 'Cannot remove the last eligible CEO / CTO approver'),
  ('pbx_revoke_access', 'N', 'changes are serialised per company', 'pg_advisory_xact_lock'),
  ('pbx_revoke_access', 'E', 'the last access manager is protected', 'last person who manages access to project budgets'),
  ('crm_grant_access', 'N', 'R2: nobody adds a right to their own grant', 'You cannot add rights to your own access'),
  ('crm_grant_access', 'N', 'R3: a non-founder cannot replace another access manager', 'or access manager'),
  ('crm_grant_access', 'E', 'only a founder hands out founder or access management', 'Only a CRM founder can grant founder or access-management rights'),
  ('crm_grant_access', 'E', 'the last founder is protected', 'last founder'),
  ('crm_revoke_access', 'N', 'R3: a non-founder cannot withdraw another access manager', 'Only a CRM founder can withdraw an access manager'),
  ('crm_revoke_access', 'E', 'the last founder is protected', 'Cannot revoke the last founder'),
  ('proj_revoke_access', 'N', 'R3: a non-founder cannot withdraw another access manager', 'Only a Projects founder can withdraw an access manager'),
  ('proj_revoke_access', 'E', 'the last founder is protected', 'Cannot revoke the last founder'),
  ('proj_revoke_access', 'E', 'a live Project Manager cannot be withdrawn', 'Project Manager of a live project'),
  ('proj_revoke_access', 'E', 'a live department head cannot be withdrawn', 'heads a department team on a live project'),
  ('proj_grant_access', 'E', 'an access manager is changed only by a founder (unchanged)', 'Only a Projects founder can change a founder'),
  ('inv_revoke_access', 'N', 'R3: a non-founder cannot withdraw an access manager or cost reader', 'Only an Inventory founder can withdraw an access manager or a cost reader'),
  ('inv_revoke_access', 'E', 'the last founder is protected', 'Cannot revoke the last founder'),
  ('inv_revoke_access', 'E', 'operator locations are closed with the access', 'inv_operator_locations'),
  ('inv_grant_access', 'E', 'cost visibility needs a founder (unchanged)', 'or cost reader')
),
checks as (
  -- 1 the eight functions ------------------------------------------------------------------------------------------------
  select 1 as grp, 'function exists' as chk, e.name as item, case when f.oid is not null then 'OK' else 'FAIL' end as result, '' as detail
  from eight e left join fn f on f.proname = e.name
  union all
  select 1, 'security definer with a fixed search path', f.proname,
         case when f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%' then 'OK' else 'FAIL' end, coalesce(f.proconfig::text, 'no search_path set')
  from fn f
  union all
  select 1, 'signed-in users can call it, anonymous visitors cannot', f.proname,
         case when has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f
  -- 2 the rules ----------------------------------------------------------------------------------------------------------
  union all
  select 2, case n.kind when 'N' then 'new rule present' else 'earlier protection still present' end, n.fname || ': ' || n.label,
         case when position(n.needle in f.prosrc) > 0 then 'OK' else 'FAIL' end,
         case when position(n.needle in f.prosrc) > 0 then '' else case n.kind when 'N' then 'the new rule is missing: is the migration applied?' else 'an earlier protection is missing' end end
  from needs n left join fn f on f.proname = n.fname
  -- 3 nothing else can write a grant table ----------------------------------------------------------------------------------
  union all
  select 3, 'writes a grant table', p.proname, case when p.proname in (select name from eight) then 'OK' else 'FAIL' end,
         case when p.proname in (select name from eight) then '' else 'a function outside the expected eight can write a grant table' end
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and exists (select 1 from tables t where p.prosrc ~* ('(insert\s+into|update|delete\s+from)\s+(public\.)?' || t.name || '\M'))
  union all
  select 3, 'builds SQL dynamically naming a grant table', p.proname, 'FAIL', 'a function runs dynamic SQL that names a grant table'
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc ~* '\mexecute\M'
    and exists (select 1 from tables t where p.prosrc ilike '%' || t.name || '%')
  union all
  select 3, 'no trigger changes rights', c.relname || ' / ' || t.tgname, case when t.tgname ~* 'audit|updated_at' then 'OK' else 'FAIL' end, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relname in (select name from tables)
  -- 4 the tables -------------------------------------------------------------------------------------------------------------
  union all
  select 4, 'row-level security on', t.name, case when c.relrowsecurity then 'OK' else 'FAIL' end, ''
  from tables t join pg_class c on c.oid = to_regclass('public.' || t.name)
  union all
  select 4, 'only a read policy', t.name || ' / ' || p.policyname, case when p.cmd = 'SELECT' then 'OK' else 'FAIL' end, p.cmd
  from tables t join pg_policies p on p.schemaname = 'public' and p.tablename = t.name
  union all
  select 4, 'signed-in and anonymous users cannot write it directly', t.name,
         case when has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate') or has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate') then 'FAIL' else 'OK' end,
         'authenticated can read: ' || has_table_privilege('authenticated', c.oid, 'select')::text
  from tables t join pg_class c on c.oid = to_regclass('public.' || t.name)
  -- 5 counts -----------------------------------------------------------------------------------------------------------------
  union all select 5, 'active grants (information only)', 'Sales', 'INFO', (select count(*)::text from crm_company_grants where revoked_at is null)
  union all select 5, 'active grants (information only)', 'Projects', 'INFO', (select count(*)::text from proj_company_grants where revoked_at is null)
  union all select 5, 'active grants (information only)', 'Inventory', 'INFO', (select count(*)::text from inv_company_grants where revoked_at is null)
  union all select 5, 'active grants (information only)', 'Budget', 'INFO', (select count(*)::text from pbx_company_grants where revoked_at is null)
  union all select 5, 'Budget approvers per company (eligible = active)', c.legal_name, 'INFO',
         count(*) filter (where 'executive_approver' = any (g.capabilities) and p.is_active)::text || ' eligible of ' || count(*) filter (where 'executive_approver' = any (g.capabilities))::text
  from companies c join pbx_company_grants g on g.company_id = c.id and g.revoked_at is null join profiles p on p.id = g.user_id group by c.id, c.legal_name
)
select grp as "check", chk || ': ' || item as item, result, detail from checks
union all
select 9, 'SUMMARY', case when count(*) filter (where result = 'FAIL') = 0 then 'OK' else 'FAIL' end,
       case when count(*) filter (where result = 'FAIL') = 0 then count(*) filter (where result = 'OK') || ' checks OK, 0 failing'
            else count(*) filter (where result = 'FAIL') || ' failing, ' || count(*) filter (where result = 'OK') || ' OK' end
from checks
order by 1, 2;
