-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the hosted account-control test and after you deleted every test account
-- (the test accounts in the app first, the test System Administrator last, in the dashboard). It changes nothing.
-- Send me the full result.
--
--   B  test accounts still present (must be none)
--   C  System Administrators today, not counting test accounts (must be the same list and count as before)
--   D  the same fingerprint as hosted_account_test_00_before_readonly.sql: the hash must be IDENTICAL to the one you kept

select section, item, detail from (
  select 'B test accounts still present' as section, 99 as ord, 'count (must be 0)' as item,
         (select count(*) from auth.users where lower(email) like '%e2e-test-%')::text as detail
  union all
  select 'B test accounts still present', 100 + row_number() over (order by u.email), u.email, 'STILL THERE - delete it in the dashboard'
  from auth.users u where lower(u.email) like '%e2e-test-%'
  union all
  select 'B test role grants still present (must be 0)', 150, 'count',
         (select count(*) from user_roles r join auth.users u on u.id = r.user_id where lower(coalesce(u.email, '')) like '%e2e-test-%')::text

  union all
  select 'C system administrators', 200 + row_number() over (order by u.email), coalesce(u.email, r.user_id::text), 'granted ' || to_char(r.granted_at, 'YYYY-MM-DD')
  from user_roles r join auth.users u on u.id = r.user_id
  where r.role = 'sys_admin' and r.revoked_at is null and lower(coalesce(u.email, '')) not like '%e2e-test-%'
  union all
  select 'C system administrators', 199, 'count (not counting test accounts)',
         (select count(*) from user_roles r join auth.users u on u.id = r.user_id where r.role = 'sys_admin' and r.revoked_at is null and lower(coalesce(u.email, '')) not like '%e2e-test-%')::text

  union all
  select 'D real accounts', 300 + row_number() over (order by p.account_status), 'status ' || p.account_status::text, count(*)::text
  from profiles p where lower(coalesce(p.email, '')) not like '%e2e-test-%' group by p.account_status
  union all
  select 'D real accounts', 399, 'hash over (id, status)  <- must equal the value you kept',
         coalesce(md5(string_agg(p.id::text || ':' || p.account_status::text, ',' order by p.id)), 'no accounts')
  from profiles p where lower(coalesce(p.email, '')) not like '%e2e-test-%'

) t order by section, ord;
