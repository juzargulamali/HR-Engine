-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the hosted account-control test
-- (docs/people-access-hosted-test-runbook.md). Run the WHOLE file; it returns ONE table (section | item | detail). It changes nothing.
-- Send me the full result (screenshot or Export -> CSV).
--
--   A  who is running this
--   B  test accounts that already exist (address contains "e2e-test-"): before you create anything there should be none
--   C  everyone who holds the System Administrator role today (information only: these are real people and are never touched)
--   D  a fingerprint of every account that is NOT a test account: how many in each status, and one hash over (id, status).
--      The after-check (hosted_account_test_95_after_readonly.sql) recomputes the same hash: identical = no real account changed status.
--   E  the people the test would be able to see: the test System Administrator can LIST every account (it sees names and addresses, as any
--      System Administrator does). Nothing in the runbook opens any of them.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text as detail
  union all select 'A session', 2, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')

  union all
  select 'B test accounts', 100 + row_number() over (order by u.created_at), u.email,
         'created ' || to_char(u.created_at, 'YYYY-MM-DD HH24:MI') || '; status=' || coalesce(p.account_status::text, 'no profile') || '; roles=' ||
         coalesce((select string_agg(r.role::text, ',') from user_roles r where r.user_id = u.id and r.revoked_at is null), 'none')
  from auth.users u left join profiles p on p.id = u.id
  where lower(u.email) like '%e2e-test-%'
  union all
  select 'B test accounts', 99, 'count', (select count(*) from auth.users where lower(email) like '%e2e-test-%')::text

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
  select 'D real accounts', 399, 'hash over (id, status)  <- keep this value',
         coalesce(md5(string_agg(p.id::text || ':' || p.account_status::text, ',' order by p.id)), 'no accounts')
  from profiles p where lower(coalesce(p.email, '')) not like '%e2e-test-%'

  union all
  select 'E visible to the test administrator', 400, 'accounts it could list', (select count(*) from profiles)::text
) t order by section, ord;
