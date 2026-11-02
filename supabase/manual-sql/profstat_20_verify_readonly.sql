-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the migration 20261216000400_profiles_status_columns_restricted.sql.
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is information only).
-- A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  the functions exist, are SECURITY DEFINER with a fixed search path; the added ones are callable by signed-in users and NOT by anonymous visitors; the internal
--      helpers are callable by nobody signed in
--   2  the new rule is in the function text AND every earlier protection is still there
--   3  the privilege / policy part of the change, where this migration has one
--
-- It checks DEFINITIONS and PRIVILEGES. It cannot call a function without writing or acting as a person, so the behaviour is proved by the repository's database tests
-- (packages/rls-tests/test/profiles_status_columns.rls.test.ts) and, on this project, by the first real use (see the deployment guide).

with
fns(name) as (values ('account_status_details')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from fns)),
needs(fname, kind, label, needle) as (values
  ('account_status_details', 'N', 'System Administrator only', 'Only a System Administrator can read the reason an account was deactivated'),
  ('account_status_details', 'N', 'returns the reason', '''status_reason'', p.status_reason')
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
  from fn f where f.proname in ('account_status_details')
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
  select 3, 'profiles columns', 'status_reason, status_changed_by and status_changed_at are NOT readable by signed-in users or anonymous visitors', (case when not has_column_privilege('authenticated', 'public.profiles', 'status_reason', 'select') and not has_column_privilege('authenticated', 'public.profiles', 'status_changed_by', 'select') and not has_column_privilege('authenticated', 'public.profiles', 'status_changed_at', 'select') and not has_column_privilege('anon', 'public.profiles', 'status_reason', 'select') then 'OK' else 'FAIL' end), ('authenticated status_reason ' || has_column_privilege('authenticated', 'public.profiles', 'status_reason', 'select')::text)
  union all
  select 3, 'profiles columns', 'the directory columns stay readable by signed-in users (names and e-mails for the pickers)', (case when (select count(*) from unnest(array['id', 'email', 'full_name', 'locale', 'is_active', 'account_status', 'created_at', 'updated_at']) c where has_column_privilege('authenticated', 'public.profiles', c, 'select')) = 8 then 'OK' else 'FAIL' end), ((select string_agg(c, ',') from unnest(array['id', 'email', 'full_name', 'locale', 'is_active', 'account_status', 'created_at', 'updated_at']) c where not has_column_privilege('authenticated', 'public.profiles', c, 'select')))
  union all
  select 3, 'profiles columns', 'signed-in users can still update their own profile (INSERT/UPDATE/DELETE untouched; row-level security and the self-update guard decide the rest)', (case when has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then 'OK' else 'FAIL' end), ('')
  union all
  select 3, 'profiles policies', 'the select policy for signed-in users is still there', (case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select') then 'OK' else 'FAIL' end), ('')
)
select chk as "check", item, result, detail from (
  select grp, chk, item, result, detail from checks
  union all select 9, 'SUMMARY', '', case when exists (select 1 from checks where result = 'FAIL')
         then 'FAIL: ' || (select count(*) from checks where result = 'FAIL') || ' check(s) failing, see above'
         else 'OK: ' || (select count(*) from checks) || ' checks, 0 failing' end, ''
) r
order by grp, chk, item;
