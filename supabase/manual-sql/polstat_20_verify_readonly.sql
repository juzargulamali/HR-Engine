-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the migration 20261216000700_policy_status_role_check.sql.
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is information only).
-- A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  the functions exist, are SECURITY DEFINER with a fixed search path; the added ones are callable by signed-in users and NOT by anonymous visitors; the internal
--      helpers are callable by nobody signed in
--   2  the new rule is in the function text AND every earlier protection is still there
--   3  the privilege / policy part of the change, where this migration has one
--
-- It checks DEFINITIONS and PRIVILEGES. It cannot call a function without writing or acting as a person, so the behaviour is proved by the repository's database tests
-- (packages/rls-tests/test/policy_status_role_check.rls.test.ts) and, on this project, by the first real use (see the deployment guide).

with
fns(name) as (values ('preflight_phase2b_v2_policy_status')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from fns)),
needs(fname, kind, label, needle) as (values
  ('preflight_phase2b_v2_policy_status', 'N', 'HR Admin sees it (country-wide grant)', 'has_role(''hr_admin'', null, cc.code)'),
  ('preflight_phase2b_v2_policy_status', 'N', 'CEO sees it (country-wide grant)', 'has_role(''ceo'', null, cc.code)'),
  ('preflight_phase2b_v2_policy_status', 'N', 'CTO sees it (country-wide grant)', 'has_role(''cto'', null, cc.code)'),
  ('preflight_phase2b_v2_policy_status', 'E', 'still reports the 12 slots of the seeded drafts', 'phase2b_seed_marker'),
  ('preflight_phase2b_v2_policy_status', 'E', 'still says whether activating a draft would overlap an active version', 'other.status = ''active''')
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
  from fn f where f.proname in ('', 'preflight_phase2b_v2_policy_status')
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
  select 3, 'execute privilege', 'anonymous visitors can no longer execute it; signed-in users still can (the function itself answers only those who may read the drafts)', (case when has_function_privilege('authenticated', 'public.preflight_phase2b_v2_policy_status()', 'execute') and not has_function_privilege('anon', 'public.preflight_phase2b_v2_policy_status()', 'execute') then 'OK' else 'FAIL' end), ('authenticated ' || has_function_privilege('authenticated', 'public.preflight_phase2b_v2_policy_status()', 'execute')::text || ', anon ' || has_function_privilege('anon', 'public.preflight_phase2b_v2_policy_status()', 'execute')::text)
)
select chk as "check", item, result, detail from (
  select grp, chk, item, result, detail from checks
  union all select 9, 'SUMMARY', '', case when exists (select 1 from checks where result = 'FAIL')
         then 'FAIL: ' || (select count(*) from checks where result = 'FAIL') || ' check(s) failing, see above'
         else 'OK: ' || (select count(*) from checks) || ' checks, 0 failing' end, ''
) r
order by grp, chk, item;
