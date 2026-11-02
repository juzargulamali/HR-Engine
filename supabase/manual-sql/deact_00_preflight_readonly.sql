-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000300_account_deactivation_inactive_people.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send me the full result.
--
--   A  who is running this, server version
--   B  prerequisites: what this migration builds on exists; the migration is NOT applied yet
--   C  the functions this migration replaces or adds, as they are today (owner, privileges, fingerprint; an added one is absent)
--   D  what exists today (information only; some rows are read-only checks of the live state that decide whether more is needed)
--   E  row counts (information only)
--
-- HOW TO READ IT: section B must be OK on every row and say the change is NOT yet applied.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all select 'A session', 2, 'server_version', version()
  union all select 'A session', 3, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 200, 'function public.resolve_approver', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_approver') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.resolve_approver_for_company', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_approver_for_company') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'function public.resolve_role_holders', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_role_holders') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 203, 'function public.recovery_eligible_approver_exists', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'recovery_eligible_approver_exists') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 204, 'function public.create_initial_approval', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_initial_approval') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 205, 'function public.recovery_route_request', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'recovery_route_request') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 206, 'function public.set_account_status', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_account_status') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 207, 'function public.guard_profiles_self_update', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'guard_profiles_self_update') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 208, 'function public.has_role', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'has_role') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 209, 'function public.user_has_role', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'user_has_role') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'user_is_active')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run deact_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet (the old state is in place)' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(p.proowner) || '; security definer ' || p.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(p.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', p.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', p.oid, 'execute')::text
                   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('resolve_approver'), ('resolve_approver_for_company'), ('resolve_role_holders'), ('recovery_eligible_approver_exists'), ('create_initial_approval'), ('recovery_route_request'), ('set_account_status'), ('guard_profiles_self_update'), ('user_is_active'), ('account_deactivation_blockers'), ('account_holdings')) f(name) where f.name <> '__none__'
  union all select 'D what exists today', 1000, 'READ-ONLY CHECK: accounts shown as deactivated but still flagged active (the optional step in the guide aligns these; the count only)', (select count(*)::text from profiles where account_status = 'deactivated' and is_active)
  union all select 'D what exists today', 1001, 'READ-ONLY CHECK: those accounts (e-mail addresses, so you can decide whether to run the optional step)', (select coalesce(string_agg(email, '; ' order by email), 'none') from profiles where account_status = 'deactivated' and is_active)
  union all select 'D what exists today', 1002, 'approvals still pending on a deactivated account (they would stay with that person; nothing is moved)', (select count(*)::text from approvals a join profiles p on p.id = a.approver_id where a.decision = 'pending' and p.account_status = 'deactivated')
  union all select 'D what exists today', 1003, 'READ-ONLY CHECK: companies where the CEO / CTO role is held by exactly ONE active person (that person cannot be deactivated until another holds it)', (select coalesce(string_agg(c.legal_name || ' (' || n || ')', '; ' order by c.legal_name), 'none') from (select co.legal_name, (select count(distinct ur.user_id) from user_roles ur join profiles p on p.id = ur.user_id and p.is_active where ur.role in ('ceo', 'cto') and ur.revoked_at is null and (ur.company_id is null or ur.company_id = co.id)) as n from companies co where co.is_active and co.deleted_at is null) c where n = 1)
  union all select 'D what exists today', 1004, 'READ-ONLY CHECK: companies with NO active CEO / CTO holder today (information)', (select coalesce(string_agg(c.legal_name, '; ' order by c.legal_name), 'none') from (select co.legal_name, (select count(distinct ur.user_id) from user_roles ur join profiles p on p.id = ur.user_id and p.is_active where ur.role in ('ceo', 'cto') and ur.revoked_at is null and (ur.company_id is null or ur.company_id = co.id)) as n from companies co where co.is_active and co.deleted_at is null) c where n = 0)
  union all select 'D what exists today', 1005, 'active System Administrators', (select count(*)::text from user_roles ur join profiles p on p.id = ur.user_id where ur.role = 'sys_admin' and ur.revoked_at is null and p.account_status = 'active')
  union all select 'E row counts', 900, 'profiles', (select count(*)::text from profiles)
  union all select 'E row counts', 901, 'user_roles', (select count(*)::text from user_roles)
  union all select 'E row counts', 902, 'approvals', (select count(*)::text from approvals)
  union all select 'E row counts', 903, 'pbx_company_grants', (select count(*)::text from pbx_company_grants)
) r
order by section, ord, item;
