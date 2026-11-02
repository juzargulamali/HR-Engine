-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000500_attendance_lead_candidates.sql.
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
  union all select 'B prerequisites', 200, 'function public.validate_attendance_segment_inputs', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'validate_attendance_segment_inputs') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.current_employee_id', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'current_employee_id') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'function public.clock_in', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'clock_in') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'attendance_lead_candidates')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run leadpick_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet (the old state is in place)' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(p.proowner) || '; security definer ' || p.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(p.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', p.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', p.oid, 'execute')::text
                   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('attendance_lead_candidates')) f(name) where f.name <> '__none__'
  union all select 'D what exists today', 1000, 'people the picker will list, by company (counts only)', (select coalesce(string_agg(c.legal_name || ': ' || n, '; ' order by c.legal_name), 'none') from (select co.legal_name, count(*) n from employees e join companies co on co.id = e.company_id where e.employment_status = 'active' and e.deleted_at is null group by co.legal_name) c)
  union all select 'E row counts', 900, 'employees', (select count(*)::text from employees)
  union all select 'E row counts', 901, 'attendance_segments', (select count(*)::text from attendance_segments)
) r
order by section, ord, item;
