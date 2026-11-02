-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000100_inv_issue_to_employee_consumes_reservation.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send me the full result.
--
--   A  who is running this, server version
--   B  prerequisites: the functions this migration replaces exist; the migration is NOT applied yet
--   C  the functions this migration replaces, as they are today (owner, privileges, fingerprint)
--   D  what exists today (information only)
--   E  row counts (information only)
--
-- HOW TO READ IT: section B must be OK on every row and say the change is NOT yet applied.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all select 'A session', 2, 'server_version', version()
  union all select 'A session', 3, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 200, 'function public.inv_issue_to_employee', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_issue_to_employee') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.inv_unit_reserved_by', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_unit_reserved_by') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'function public.inv_reservation_take', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_reservation_take') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 203, 'function public.inv_qty_free', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_qty_free') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 204, 'function public.inv_refresh_request_status', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_refresh_request_status') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'inv_issue_to_employee' and prosrc like '%reserved for THIS request%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run inv_emp_issue_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet (the old definition is in place)' end
  union all
  select 'C functions today', 400 + row_number() over (order by p.proname), p.proname,
         'owner ' || pg_get_userbyid(p.proowner) || '; security definer ' || p.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(p.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', p.oid, 'execute')::text
           || '; by anonymous ' || has_function_privilege('anon', p.oid, 'execute')::text
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('inv_issue_to_employee')
  union all select 'D what exists today', 1000, 'active reservations on employee requests (nothing is changed on them by the migration)', (select count(*)::text from inv_reservations r join inv_request_lines l on l.id = r.request_line_id join inv_requests q on q.id = l.request_id where r.status = 'active' and q.kind = 'employee')
  union all select 'D what exists today', 1001, 'employee requests open (submitted or in progress)', (select count(*)::text from inv_requests where kind = 'employee' and status in ('submitted', 'in_progress'))
  union all select 'E row counts', 900, 'inv_reservations', (select count(*)::text from inv_reservations)
  union all select 'E row counts', 901, 'inv_movements', (select count(*)::text from inv_movements)
  union all select 'E row counts', 902, 'inv_movement_lines', (select count(*)::text from inv_movement_lines)
  union all select 'E row counts', 903, 'inv_requests', (select count(*)::text from inv_requests)
  union all select 'E row counts', 904, 'inv_units', (select count(*)::text from inv_units)
  union all select 'E row counts', 905, 'inv_balances', (select count(*)::text from inv_balances)
) r
order by section, ord, item;
