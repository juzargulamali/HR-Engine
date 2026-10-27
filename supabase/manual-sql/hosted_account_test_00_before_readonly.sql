-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the hosted account-control test
-- (docs/people-access-hosted-test-runbook.md). Run the WHOLE file; it returns ONE table (section | item | detail). It changes nothing.
-- Send me the full result (screenshot or Export -> CSV).
--
-- The test administrator is your EXISTING account hrtest.admin@enginious.ae. It is never changed by the test: this script only reads it, and
-- fingerprints its account and roles so the after-check can prove they are untouched.
--
--   A  who is running this
--   B  disposable test accounts (address contains "e2e-test-") that already exist: before the test there should be none
--   C  the test administrator: exactly one account, its status, whether it is linked to an employee, EVERY role it holds, whether it holds the
--      System Administrator role (the test cannot work without it: if the row says STOP, nothing is granted for you; tell me), and a fingerprint
--      of its role rows. KEEP the fingerprint.
--   D  every other System Administrator today (information only; real people, never touched)
--   E  a fingerprint of every account that is NOT a disposable test account (this includes the test administrator): accounts in each status and
--      one hash over (id, status). The after-check recomputes it: identical = no real account changed status.
--   F  how many accounts the test administrator can LIST (any System Administrator sees them). Nothing in the runbook opens any of them.

with params as (select 'hrtest.admin@enginious.ae'::text as admin_email),
adm as (select u.id, u.email from auth.users u, params p where lower(u.email) = lower(p.admin_email))
select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text as detail
  union all select 'A session', 2, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')

  union all select 'B disposable test accounts', 99, 'count (must be 0 before the test)', (select count(*) from auth.users where lower(email) like '%e2e-test-%')::text
  union all
  select 'B disposable test accounts', 100 + row_number() over (order by u.created_at), u.email, 'ALREADY EXISTS, created ' || to_char(u.created_at, 'YYYY-MM-DD HH24:MI')
  from auth.users u where lower(u.email) like '%e2e-test-%'

  union all
  select 'C test administrator', 200, 'account found',
         case (select count(*) from adm) when 1 then 'OK - exactly one account' else 'STOP - found ' || (select count(*) from adm) || ' accounts for this address' end
  union all
  select 'C test administrator', 201, 'profile status', coalesce((select p.account_status::text from profiles p join adm on adm.id = p.id), 'no profile') ||
         case when (select p.account_status::text from profiles p join adm on adm.id = p.id) = 'active' then '  (OK)' else '  (STOP - it must be Active to sign in)' end
  union all
  select 'C test administrator', 202, 'linked to an employee record',
         case when exists (select 1 from employees e join adm on adm.id = e.user_id) then 'yes (information only; the test never touches it)' else 'no' end
  union all
  select 'C test administrator', 210 + row_number() over (order by r.role::text, r.granted_at),
         'role ' || r.role::text,
         'company: ' || coalesce((select c.legal_name from companies c where c.id = r.company_id), case when r.company_id is null then 'all' else '?' end)
         || '; country: ' || coalesce(r.country_code, 'all') || case when r.revoked_at is not null then '; REVOKED' else '' end
  from user_roles r join adm on adm.id = r.user_id
  union all
  select 'C test administrator', 290, 'holds the System Administrator role (all companies)',
         case when exists (select 1 from user_roles r join adm on adm.id = r.user_id where r.role = 'sys_admin' and r.company_id is null and r.revoked_at is null)
              then 'OK' else 'STOP - without it the account controls do not appear. Nothing will be granted for you; tell me.' end
  union all
  select 'C test administrator', 299, 'role fingerprint  <- KEEP this value',
         coalesce((select md5(string_agg(r.id::text || ':' || r.role::text || ':' || coalesce(r.company_id::text, '-') || ':' || coalesce(r.country_code, '-') || ':' || coalesce(r.revoked_at::text, '-'), ',' order by r.id))
                   from user_roles r join adm on adm.id = r.user_id), 'no roles')

  union all
  select 'D other system administrators', 300 + row_number() over (order by u.email), coalesce(u.email, r.user_id::text), 'granted ' || to_char(r.granted_at, 'YYYY-MM-DD')
  from user_roles r join auth.users u on u.id = r.user_id
  where r.role = 'sys_admin' and r.revoked_at is null and u.id not in (select id from adm)
  union all
  select 'D other system administrators', 399, 'count', (select count(*) from user_roles r where r.role = 'sys_admin' and r.revoked_at is null and r.user_id not in (select id from adm))::text

  union all
  select 'E real accounts', 400 + row_number() over (order by p.account_status), 'status ' || p.account_status::text, count(*)::text
  from profiles p where lower(coalesce(p.email, '')) not like '%e2e-test-%' group by p.account_status
  union all
  select 'E real accounts', 499, 'hash over (id, status)  <- KEEP this value',
         coalesce(md5(string_agg(p.id::text || ':' || p.account_status::text, ',' order by p.id)), 'no accounts')
  from profiles p where lower(coalesce(p.email, '')) not like '%e2e-test-%'

  union all
  select 'F visible to the test administrator', 500, 'accounts it can list', (select count(*) from profiles)::text
) t order by section, ord;
