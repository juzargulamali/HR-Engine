-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the migration 20261216000810_approval_routing_country_scope.sql.
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is information only).
-- A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  the functions exist, are SECURITY DEFINER with a fixed search path; the added ones are callable by signed-in users and NOT by anonymous visitors; the internal
--      helpers are callable by nobody signed in
--   2  the new rule is in the function text AND every earlier protection is still there
--   3  the privilege / policy part of the change, where this migration has one
--
-- It checks DEFINITIONS and PRIVILEGES. It cannot call a function without writing or acting as a person, so the behaviour is proved by the repository's database tests
-- (packages/rls-tests/test/approval_routing_scope.rls.test.ts) and, on this project, by the first real use (see the deployment guide).

with
fns(name) as (values ('resolve_approver'), ('resolve_approver_for_company')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from fns)),
needs(fname, kind, label, needle) as (values
  ('resolve_approver', 'N', 'a country-limited grant applies only to the employee''s country', 'ur.country_code is null or ur.country_code = v_country'),
  ('resolve_approver', 'N', 'the employee''s own country is read', 'select company_id, country_code, manager_id, user_id into v_company_id, v_country'),
  ('resolve_approver', 'E', 'company limit still honoured', 'ur.company_id is null or ur.company_id = v_company_id'),
  ('resolve_approver', 'E', 'inactive people still skipped', 'user_is_active(ur.user_id)'),
  ('resolve_approver', 'E', 'role:ceo still means CEO or CTO', 'p_approver_type = ''role:ceo'' then ur.role in (''ceo'', ''cto'')'),
  ('resolve_approver_for_company', 'N', 'a country-limited grant applies only to the company''s country', 'ur.country_code is null or ur.country_code = v_country'),
  ('resolve_approver_for_company', 'N', 'the company''s country is read', 'select country_code into v_country from companies where id = p_company_id'),
  ('resolve_approver_for_company', 'E', 'company limit still honoured', 'ur.company_id is null or ur.company_id = p_company_id'),
  ('resolve_approver_for_company', 'E', 'inactive people still skipped', 'user_is_active(ur.user_id)')
),
checks as (
  select 1 as grp, 'function exists' as chk, e.name as item, case when f.oid is not null then 'OK' else 'FAIL' end as result, '' as detail
  from fns e left join fn f on f.proname = e.name where e.name <> '__none__'
  union all
  select 1, 'security definer with a fixed search path', f.proname,
         case when f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%' then 'OK' else 'FAIL' end, coalesce(f.proconfig::text, 'no search_path set')
  from fn f where f.proname not in ('')
  union all
  select 1, 'signed-in users can call it, anonymous visitors cannot', f.proname,
         case when has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f where f.proname in ('')
  union all
  select 1, 'internal helper: callable by nobody signed in', f.proname,
         case when not has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f where f.proname in ('')
  union all
  select 2, case n.kind when 'N' then 'new rule present' else 'earlier protection still present' end, n.fname || ': ' || n.label,
         case when f.oid is null then 'FAIL' when position(n.needle in f.prosrc) > 0 then 'OK' else 'FAIL' end,
         case when f.oid is null then 'function missing' when position(n.needle in f.prosrc) > 0 then '' else 'text not found: ' || n.needle end
  from needs n left join fn f on f.proname = n.fname where n.fname <> '__none__'
  union all
  select 3, 'no privilege on any table', 'this migration adds no table or policy', 'OK', 'functions only'
)
select chk as "check", item, result, detail from (
  select grp, chk, item, result, detail from checks
  union all select 9, 'SUMMARY', '', case when exists (select 1 from checks where result = 'FAIL')
         then 'FAIL: ' || (select count(*) from checks where result = 'FAIL') || ' check(s) failing, see above'
         else 'OK: ' || (select count(*) from checks) || ' checks, 0 failing' end, ''
) r
order by grp, chk, item;
