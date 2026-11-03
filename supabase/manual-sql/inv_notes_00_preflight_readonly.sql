-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261217000100_inv_project_notes.sql.
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
  union all select 'B prerequisites', 200, 'function public.inv_next_code', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_next_code') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.inv_dispatch_to_project', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_dispatch_to_project') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'function public.inv_return_from_project', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_return_from_project') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 203, 'function public.inv_idem_begin', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_idem_begin') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 204, 'function public.inv_can_operate', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_can_operate') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 205, 'function public.inv_can_view_stock', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_can_view_stock') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 206, 'function public.inv_is_founder', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_is_founder') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 207, 'function public.inv_require_enabled', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_require_enabled') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 208, 'function public.inv_require_user', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_require_user') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 209, 'function public.proj_can_manage', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_can_manage') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 210, 'function public.proj_can_view_details', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_can_view_details') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 211, 'function public.proj_is_pm', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_is_pm') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 212, 'function public.proj_is_founder', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'proj_is_founder') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'inv_make_project_note')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run inv_notes_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet (the old state is in place)' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(p.proowner) || '; security definer ' || p.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(p.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', p.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', p.oid, 'execute')::text
                   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('inv_next_code'), ('inv_dispatch_to_project'), ('inv_return_from_project'), ('inv_project_notes_frozen'), ('inv_project_notes_enabled'), ('inv_make_project_note'), ('inv_ack_project_note'), ('inv_resolve_note_difference'), ('inv_notes_waiting_for_me'), ('inv_set_project_notes')) f(name) where f.name <> '__none__'
  union all select 'D what exists today', 1000, 'READ-ONLY CHECK: the three functions this change replaces are exactly the versions it was built and tested on (each must say yes; no = the hosted copy has drifted, STOP and send this)', (select 'inv_next_code ' || coalesce((select (md5(prosrc) = '0c94696c92d5fff27d568989f6916696')::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'inv_next_code'), 'missing') || '; inv_dispatch_to_project ' || coalesce((select (md5(prosrc) = 'bbbc0f2e46cdc9f92ff1f9f05fc18073')::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'inv_dispatch_to_project'), 'missing') || '; inv_return_from_project ' || coalesce((select (md5(prosrc) = '0109593b7e5df40fd90b6c37e84d7d69')::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'inv_return_from_project'), 'missing'))
  union all select 'D what exists today', 1001, 'Inventory companies (reference code, switched on)', (select coalesce(string_agg(s.reference_code || ' (Inventory ' || case when s.is_enabled then 'on' else 'OFF' end || ')', '; ' order by s.reference_code), 'none') from inv_company_settings s)
  union all select 'D what exists today', 1002, 'recorded dispatches to projects and returns from projects so far (the notes are only ever made for NEW ones)', (select coalesce(string_agg(kind || ': ' || n, '; ' order by kind), 'none') from (select kind, count(*) n from inv_movements where kind in ('dispatch_project', 'return_project') group by kind) t)
  union all select 'D what exists today', 1003, 'tables this change adds already exist? (must be none on a first run)', (select coalesce(string_agg(relname, ', '), 'none') from pg_class where relnamespace = 'public'::regnamespace and relname in ('inv_project_notes', 'inv_project_note_events', 'inv_project_note_status'))
  union all select 'D what exists today', 1004, 'projects that could receive a note (client and internal, any state; count only)', (select count(*)::text from proj_projects)
  union all select 'E row counts', 900, 'inv_company_settings', (select count(*)::text from inv_company_settings)
  union all select 'E row counts', 901, 'inv_movements', (select count(*)::text from inv_movements)
  union all select 'E row counts', 902, 'inv_movement_lines', (select count(*)::text from inv_movement_lines)
  union all select 'E row counts', 903, 'inv_units', (select count(*)::text from inv_units)
  union all select 'E row counts', 904, 'inv_balances', (select count(*)::text from inv_balances)
  union all select 'E row counts', 905, 'inv_reservations', (select count(*)::text from inv_reservations)
  union all select 'E row counts', 906, 'inv_idempotency', (select count(*)::text from inv_idempotency)
) r
order by section, ord, item;
