-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the hosted account-control test and after you deleted the two disposable
-- invitees in the app (the test administrator hrtest.admin@enginious.ae is NOT deleted and nothing was changed on it). It changes nothing.
-- Send me the full result.
--
--   B  disposable test accounts still present, and role grants held by any of them (both must be 0)
--   C  the test administrator is preserved: still exactly one account, still Active, still holds the System Administrator role, and its role
--      fingerprint is IDENTICAL to the one you kept (no role added, removed or revoked)
--   D  every other System Administrator: same list and count as before
--   E  the same fingerprint of every non-test account (this includes the test administrator): the hash must be IDENTICAL to the one you kept

with params as (select 'hrtest.admin@enginious.ae'::text as admin_email),
adm as (select u.id, u.email from auth.users u, params p where lower(u.email) = lower(p.admin_email))
select section, item, detail from (
  select 'B disposable test accounts' as section, 99 as ord, 'still present (must be 0)' as item,
         (select count(*) from auth.users where lower(email) like '%e2e-test-%')::text as detail
  union all
  select 'B disposable test accounts', 100 + row_number() over (order by u.email), u.email, 'STILL THERE - delete it in the app (People & Access, as the test administrator)'
  from auth.users u where lower(u.email) like '%e2e-test-%'
  union all
  select 'B disposable test accounts', 150, 'role grants still held by them (must be 0)',
         (select count(*) from user_roles r join auth.users u on u.id = r.user_id where lower(coalesce(u.email, '')) like '%e2e-test-%')::text

  union all
  select 'C test administrator', 200, 'account found', case (select count(*) from adm) when 1 then 'OK - still exactly one account' else 'PROBLEM - found ' || (select count(*) from adm) end
  union all
  select 'C test administrator', 201, 'profile status', coalesce((select p.account_status::text from profiles p join adm on adm.id = p.id), 'no profile') ||
         case when (select p.account_status::text from profiles p join adm on adm.id = p.id) = 'active' then '  (OK)' else '  (PROBLEM - it was Active before)' end
  union all
  select 'C test administrator', 290, 'still holds the System Administrator role (all companies)',
         case when exists (select 1 from user_roles r join adm on adm.id = r.user_id where r.role = 'sys_admin' and r.company_id is null and r.revoked_at is null) then 'OK' else 'PROBLEM' end
  union all
  select 'C test administrator', 299, 'role fingerprint  <- must EQUAL the value you kept',
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
  select 'E real accounts', 499, 'hash over (id, status)  <- must EQUAL the value you kept',
         coalesce(md5(string_agg(p.id::text || ':' || p.account_status::text, ',' order by p.id)), 'no accounts')
  from profiles p where lower(coalesce(p.email, '')) not like '%e2e-test-%'
) t order by section, ord;
