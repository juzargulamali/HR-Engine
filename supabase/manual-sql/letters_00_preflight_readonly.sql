-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000800_letters_storage_issued_only.sql.
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
  union all select 'B prerequisites', 200, 'function public.current_employee_id', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'current_employee_id') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.has_role', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'has_role') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'letters_select' and qual like '%generated_letters%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run letters_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet (the old state is in place)' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(p.proowner) || '; security definer ' || p.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(p.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', p.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', p.oid, 'execute')::text
                   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('__none__')) f(name) where f.name <> '__none__'
  union all select 'D what exists today', 1000, 'READ-ONLY CHECK (the hosted answer to D-23): storage read policies on the letters bucket today', (select coalesce(string_agg(policyname || ': ' || coalesce(qual, ''), E'\n' order by policyname), 'none') from pg_policies where schemaname = 'storage' and tablename = 'objects' and (policyname like 'letters%'))
  union all select 'D what exists today', 1001, 'letters by status', (select coalesce(string_agg(status::text || ': ' || n, ', ' order by status::text), 'none') from (select status, count(*) n from generated_letters group by status) t)
  union all select 'D what exists today', 1002, 'READ-ONLY CHECK: letters with a stored file that are NOT issued (the files an employee could fetch today)', (select count(*)::text from generated_letters where file_path is not null and status <> 'issued')
  union all select 'D what exists today', 1003, 'READ-ONLY CHECK (decides whether D-23 is a launch blocker): letter templates that mention pay or contain an amount (names only; none = no salary text in any template)', (select coalesce(string_agg(name || ' (' || template_type || ')', '; ' order by name), 'none') from letter_templates where deleted_at is null and body_template ~* '(salary|basic pay|allowance|compensation|remuneration|[0-9]{4,}|AED|SAR|PLN|USD)')
  union all select 'E row counts', 900, 'generated_letters', (select count(*)::text from generated_letters)
  union all select 'E row counts', 901, 'letter_templates', (select count(*)::text from letter_templates)
) r
order by section, ord, item;
