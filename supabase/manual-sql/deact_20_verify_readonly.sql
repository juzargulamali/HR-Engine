-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the migration 20261216000300_account_deactivation_inactive_people.sql.
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is information only).
-- A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  the functions exist, are SECURITY DEFINER with a fixed search path; the added ones are callable by signed-in users and NOT by anonymous visitors; the internal
--      helpers are callable by nobody signed in
--   2  the new rule is in the function text AND every earlier protection is still there
--   3  the privilege / policy part of the change, where this migration has one
--
-- It checks DEFINITIONS and PRIVILEGES. It cannot call a function without writing or acting as a person, so the behaviour is proved by the repository's database tests
-- (packages/rls-tests/test/account_deactivation.rls.test.ts) and, on this project, by the first real use (see the deployment guide).

with
fns(name) as (values ('resolve_approver'), ('resolve_approver_for_company'), ('resolve_role_holders'), ('recovery_eligible_approver_exists'), ('create_initial_approval'), ('recovery_route_request'), ('set_account_status'), ('guard_profiles_self_update'), ('user_is_active'), ('account_deactivation_blockers'), ('account_holdings')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from fns)),
needs(fname, kind, label, needle) as (values
  ('set_account_status', 'N', 'is_active is set in the same step', 'is_active = (p_new_status = ''active'')'),
  ('set_account_status', 'N', 'the new refusals are applied', 'account_deactivation_blockers(p_user_id)'),
  ('set_account_status', 'E', 'only a System Administrator', 'Only a System Administrator may change an account''''s status'),
  ('set_account_status', 'E', 'a reason is required', 'A reason is required'),
  ('set_account_status', 'E', 'not your own account', 'You can''''t change your own account status'),
  ('set_account_status', 'E', 'changes are serialised', 'pg_advisory_xact_lock(hashtext(''profiles:set_account_status''))'),
  ('account_deactivation_blockers', 'N', 'last active System Administrator (same wording)', 'Can''''t deactivate the last active System Administrator'),
  ('account_deactivation_blockers', 'N', 'only CEO / CTO budget approver', 'executive_approver'),
  ('account_deactivation_blockers', 'N', 'only CEO or CTO of a company', 'Can''''t deactivate the only CEO or CTO of %s'),
  ('account_holdings', 'N', 'System Administrator only', 'Only a System Administrator can see what an account still holds'),
  ('account_holdings', 'N', 'pending approvals are listed, not moved', 'a.approver_id = p_user_id and a.decision = ''pending'''),
  ('resolve_approver', 'N', 'a deactivated role holder is skipped', 'user_is_active(ur.user_id)'),
  ('resolve_approver', 'N', 'a deactivated manager is skipped', 'deleted_at is null and user_is_active(user_id)'),
  ('resolve_approver', 'E', 'a terminated employee is still skipped', 'e2.employment_status = ''terminated'''),
  ('resolve_approver', 'E', 'role:ceo means any CEO or CTO', 'ur.role in (''ceo'', ''cto'')'),
  ('resolve_approver_for_company', 'N', 'a deactivated role holder is skipped', 'user_is_active(ur.user_id)'),
  ('resolve_role_holders', 'N', 'a deactivated holder is not listed', 'user_is_active(user_id)'),
  ('recovery_eligible_approver_exists', 'N', 'a deactivated holder does not count', 'user_is_active(ur.user_id)'),
  ('create_initial_approval', 'N', 'the role-queue check skips deactivated people', 'user_is_active(ur.user_id)'),
  ('create_initial_approval', 'E', 'no approver means no request', 'No approver could be resolved'),
  ('create_initial_approval', 'E', 'no self-approval at step 1', 'you can''''t approve your own request'),
  ('recovery_route_request', 'N', 'a deactivated project lead is reported as having no active account', 'user_is_active(e.user_id)'),
  ('recovery_route_request', 'E', 'no HR Admin means a routing issue is recorded', 'No HR Admin is currently available'),
  ('guard_profiles_self_update', 'N', 'a person cannot change their own is_active', 'new.is_active is distinct from old.is_active'),
  ('guard_profiles_self_update', 'E', 'account_status stays administrator-only', 'account_status can only be changed by a System Administrator')
),
checks as (
  select 1 as grp, 'function exists' as chk, e.name as item, case when f.oid is not null then 'OK' else 'FAIL' end as result, '' as detail
  from fns e left join fn f on f.proname = e.name where e.name <> '__none__'
  union all
  select 1, 'security definer with a fixed search path', f.proname,
         case when f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%' then 'OK' else 'FAIL' end, coalesce(f.proconfig::text, 'no search_path set')
  from fn f where f.proname not in ('guard_profiles_self_update')
  union all
  select 1, 'signed-in users can call it, anonymous visitors cannot', f.proname,
         case when has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f where f.proname in ('account_holdings')
  union all
  select 1, 'internal helper: callable by nobody signed in', f.proname,
         case when not has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f where f.proname in ('account_deactivation_blockers', 'user_is_active')
  union all
  select 2, case n.kind when 'N' then 'new rule present' else 'earlier protection still present' end, n.fname || ': ' || n.label,
         case when f.oid is null then 'FAIL' when position(n.needle in f.prosrc) > 0 then 'OK' else 'FAIL' end,
         case when f.oid is null then 'function missing' when position(n.needle in f.prosrc) > 0 then '' else 'text not found: ' || n.needle end
  from needs n left join fn f on f.proname = n.fname where n.fname <> '__none__'
)
select chk as "check", item, result, detail from (
  select grp, chk, item, result, detail from checks
  union all select 9, 'SUMMARY', '', case when exists (select 1 from checks where result = 'FAIL')
         then 'FAIL: ' || (select count(*) from checks where result = 'FAIL') || ' check(s) failing, see above'
         else 'OK: ' || (select count(*) from checks) || ' checks, 0 failing' end, ''
) r
order by grp, chk, item;
