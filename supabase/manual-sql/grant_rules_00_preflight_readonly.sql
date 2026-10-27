-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the access grant rules migration (20261215000000_access_grant_rules.sql).
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send me the full result.
--
--   A  who is running this, server version
--   B  prerequisites: the four modules' grant tables and the eight grant / revoke functions exist; the migration is NOT applied yet
--   C  the six functions this migration replaces, as they are today (owner, privileges, fingerprint)
--   D  who is affected, in plain words (information only): nobody loses access; this shows who can no longer do what
--   E  row counts of the four grant tables (information only)
--
-- HOW TO READ IT: section B must be OK on every row and say the rules are NOT yet applied. Section D lists things to know BEFORE applying, not errors.
-- In particular, a company with Budget access managers but no eligible CEO / CTO approver cannot name one in the app after this change; the owner script
-- pbx_30_bootstrap_access.sql does it (the application never lets a Finance access manager appoint an approver, which is the point of the change).

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all select 'A session', 2, 'server_version', version()
  union all select 'A session', 3, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')

  -- B prerequisites -----------------------------------------------------------------------------------------------------
  union all
  select 'B prerequisites', 100 + row_number() over (order by t.name), 'table public.' || t.name,
         case when to_regclass('public.' || t.name) is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  from (values ('crm_company_grants'), ('proj_company_grants'), ('inv_company_grants'), ('pbx_company_grants'), ('profiles'), ('companies')) as t(name)
  union all
  select 'B prerequisites', 200 + row_number() over (order by f.name), 'function public.' || f.name,
         case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name) then 'OK' else 'MISSING - install that module first' end
  from (values ('crm_grant_access'), ('crm_revoke_access'), ('proj_grant_access'), ('proj_revoke_access'), ('inv_grant_access'), ('inv_revoke_access'),
               ('pbx_grant_access'), ('pbx_revoke_access'), ('crm_has_capability'), ('proj_has_capability'), ('inv_has_capability'), ('pbx_has_capability'),
               ('crm_is_founder'), ('proj_is_founder'), ('inv_is_founder')) as f(name)
  union all
  select 'B prerequisites', 300, 'column profiles.is_active',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_active') then 'OK' else 'MISSING' end
  union all
  select 'B prerequisites', 310, 'rules applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'pbx_grant_access' and prosrc like '%last eligible CEO / CTO approver%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run grant_rules_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet (the old rules are in place)' end

  -- C the six functions today --------------------------------------------------------------------------------------------
  union all
  select 'C functions today', 400 + row_number() over (order by p.proname), p.proname,
         'owner ' || pg_get_userbyid(p.proowner) || '; security definer ' || p.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(p.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', p.oid, 'execute')::text
           || '; by anonymous ' || has_function_privilege('anon', p.oid, 'execute')::text
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('crm_grant_access', 'crm_revoke_access', 'proj_revoke_access', 'inv_revoke_access', 'pbx_grant_access', 'pbx_revoke_access')

  -- D who is affected ----------------------------------------------------------------------------------------------------
  union all
  select 'D who is affected', 500 + row_number() over (order by c.legal_name), 'Budget, ' || c.legal_name,
         'Finance holders ' || count(*) filter (where 'finance' = any (g.capabilities))
         || '; access managers ' || count(*) filter (where 'manage_access' = any (g.capabilities))
         || '; CEO / CTO approvers ' || count(*) filter (where 'executive_approver' = any (g.capabilities))
         || ' (eligible, i.e. active: ' || count(*) filter (where 'executive_approver' = any (g.capabilities) and p.is_active) || ')'
         || case when count(*) filter (where 'executive_approver' = any (g.capabilities) and p.is_active) = 0
                 then ' -> NO eligible approver: after this change an approver can only be named by the owner script pbx_30_bootstrap_access.sql, and budgets submitted by someone who holds Finance wait until then (they already do today)'
                 when count(*) filter (where 'executive_approver' = any (g.capabilities) and p.is_active) = 1
                 then ' -> exactly ONE eligible approver: that person can never be removed (by design); name a second one with pbx_30 if you want a spare'
                 else '' end
  from companies c join pbx_company_grants g on g.company_id = c.id and g.revoked_at is null join profiles p on p.id = g.user_id
  where c.is_active and c.deleted_at is null group by c.id, c.legal_name
  union all
  select 'D who is affected', 600 + row_number() over (order by c.legal_name, p.email), 'Budget access manager who is not an approver: ' || p.email || ' (' || c.legal_name || ')',
         'keeps every right they have; can no longer give or remove the CEO / CTO approver right, and can no longer add rights to their own access'
  from pbx_company_grants g join companies c on c.id = g.company_id join profiles p on p.id = g.user_id
  where g.revoked_at is null and 'manage_access' = any (g.capabilities) and not ('executive_approver' = any (g.capabilities))
  union all
  select 'D who is affected', 700 + row_number() over (order by m.module, c.legal_name, p.email), m.module || ' access manager who is not a founder: ' || p.email || ' (' || c.legal_name || ')',
         'keeps every right they have; can no longer withdraw another access manager' || case when m.module = 'Sales' then ' or replace one''s rights through the grant function, and can no longer add rights to their own access' else '' end
         || case when m.module = 'Inventory' then ' or a cost reader' else '' end
  from (
    select 'Sales' as module, user_id, company_id, capabilities from crm_company_grants where revoked_at is null
    union all select 'Projects', user_id, company_id, capabilities from proj_company_grants where revoked_at is null
    union all select 'Inventory', user_id, company_id, capabilities from inv_company_grants where revoked_at is null
  ) m join companies c on c.id = m.company_id join profiles p on p.id = m.user_id
  where 'manage_access' = any (m.capabilities) and not ('founder' = any (m.capabilities))
  union all
  select 'D who is affected', 800, 'nobody loses access', 'This migration replaces six functions. It does not touch a single grant row, table, policy, trigger or privilege.'

  -- E row counts ----------------------------------------------------------------------------------------------------------
  union all select 'E row counts', 900, 'crm_company_grants (active / revoked)', (select count(*) filter (where revoked_at is null) || ' / ' || count(*) filter (where revoked_at is not null) from crm_company_grants)
  union all select 'E row counts', 901, 'proj_company_grants (active / revoked)', (select count(*) filter (where revoked_at is null) || ' / ' || count(*) filter (where revoked_at is not null) from proj_company_grants)
  union all select 'E row counts', 902, 'inv_company_grants (active / revoked)', (select count(*) filter (where revoked_at is null) || ' / ' || count(*) filter (where revoked_at is not null) from inv_company_grants)
  union all select 'E row counts', 903, 'pbx_company_grants (active / revoked)', (select count(*) filter (where revoked_at is null) || ' / ' || count(*) filter (where revoked_at is not null) from pbx_company_grants)
) r
order by section, ord, item;
