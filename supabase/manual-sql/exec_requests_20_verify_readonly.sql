-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER applying
-- supabase/migrations/20261109000000_executive_requests_no_approver.sql.
-- Changes nothing. Each block says what to expect.

-- 1. The two helpers exist. Expect 2 rows: i_am_c_level, is_c_level.
select proname from pg_proc
where pronamespace = 'public'::regnamespace and proname in ('is_c_level', 'i_am_c_level')
order by proname;

-- 2. The three routing functions now carry the CEO/CTO rule. Expect 3 rows, every one true.
select proname, prosrc like '%is_c_level%' as has_ceo_cto_rule
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('create_initial_approval', 'recovery_route_for_employee', 'recovery_route_request')
order by proname;

-- 3. Who may call them. Expect: i_am_c_level = true (signed-in users), is_c_level = false (nobody but the system).
select has_function_privilege('authenticated', 'public.i_am_c_level(uuid)', 'execute') as signed_in_may_call_i_am_c_level,
       has_function_privilege('authenticated', 'public.is_c_level(uuid, uuid)', 'execute') as signed_in_may_call_is_c_level;

-- 4. Who counts as an executive in your company right now (nothing changes; this is who the rule applies to).
select u.email, r.role
from user_roles r join auth.users u on u.id = r.user_id
where r.revoked_at is null and r.role in ('ceo', 'cto')
order by u.email;
