-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000810_approval_routing_country_scope.sql.
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
  union all select 'B prerequisites', 202, 'function public.user_is_active', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'user_is_active') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 203, 'function public.has_role', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'has_role') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'resolve_approver' and prosrc like '%ur.country_code is null or ur.country_code = v_country%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run apprscope_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(pp.proowner) || '; security definer ' || pp.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(pp.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', pp.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', pp.oid, 'execute')::text
                   from pg_proc pp where pp.pronamespace = 'public'::regnamespace and pp.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('resolve_approver'), ('resolve_approver_for_company')) f(name)
  union all select 'D what exists today', 1000, 'READ-ONLY CHECK (the hosted answer): active role grants limited to ONE country (company_id empty or not). Only these change which approver a NEW request resolves to; ''none'' means this migration changes nothing for anyone today', (select coalesce(string_agg(ur.role::text || ' for ' || ur.country_code || coalesce(' in company ' || c.legal_name, ' (all companies)') || ' - ' || coalesce(p.email, ur.user_id::text), '; ' order by ur.country_code, ur.role::text), 'none') from user_roles ur left join companies c on c.id = ur.company_id left join profiles p on p.id = ur.user_id where ur.revoked_at is null and ur.country_code is not null)
  union all select 'D what exists today', 1001, 'approvals pending today (never re-routed by this migration)', (select count(*)::text from approvals where decision = 'pending')
  union all select 'D what exists today', 1002, 'companies and their country (what a country-limited grant is matched against)', (select coalesce(string_agg(legal_name || ' ' || country_code, '; ' order by legal_name), 'none') from companies where deleted_at is null)
  union all select 'E row counts', 900, 'user_roles', (select count(*)::text from user_roles)
  union all select 'E row counts', 901, 'approvals', (select count(*)::text from approvals)
  union all select 'E row counts', 902, 'employees', (select count(*)::text from employees)
  union all select 'E row counts', 903, 'companies', (select count(*)::text from companies)
) r
order by section, ord, item;
