-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261218000100_inv_cross_company_receiving.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send me the full result.
--
--   A  who is running this, server version
--   B  prerequisites: what this migration builds on exists; the migration is NOT applied yet
--   C  the functions this migration adds, as they are today (all absent before it)
--   D  what exists today (information only: who has authorised sharing, which cross-company transfers exist)
--   E  row counts (information only)
--
-- HOW TO READ IT: section B must be OK on every row and say the change is NOT yet applied.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all select 'A session', 2, 'server_version', version()
  union all select 'A session', 3, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 200, 'table public.inv_company_sharing', case when to_regclass('public.inv_company_sharing') is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'table public.inv_transfers', case when to_regclass('public.inv_transfers') is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'table public.inv_units', case when to_regclass('public.inv_units') is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 203, 'table public.inv_movements', case when to_regclass('public.inv_movements') is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 214, 'table public.inv_balances', case when to_regclass('public.inv_balances') is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 204, 'table public.inv_movement_lines', case when to_regclass('public.inv_movement_lines') is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 205, 'table public.inv_locations', case when to_regclass('public.inv_locations') is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 206, 'table public.inv_operator_locations', case when to_regclass('public.inv_operator_locations') is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 207, 'table public.profiles', case when to_regclass('public.profiles') is not null then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 208, 'function public.inv_can_operate', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_can_operate') then 'OK' else 'MISSING - install the Inventory migrations first' end
  union all select 'B prerequisites', 209, 'function public.inv_can_view_stock', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_can_view_stock') then 'OK' else 'MISSING - install the Inventory migrations first' end
  union all select 'B prerequisites', 210, 'function public.inv_unit_usable', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_unit_usable') then 'OK' else 'MISSING - install the Inventory migrations first' end
  union all select 'B prerequisites', 211, 'function public.inv_require_user', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_require_user') then 'OK' else 'MISSING - install the Inventory migrations first' end
  union all select 'B prerequisites', 212, 'function public.inv_transfer_receive', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_transfer_receive') then 'OK' else 'MISSING - install the Inventory migrations first' end
  union all select 'B prerequisites', 213, 'function public.inv_transfer_dispatch', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_transfer_dispatch') then 'OK' else 'MISSING - install the Inventory migrations first' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'inv_xshare_transfer_trace')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run inv_xshare_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(pp.proowner) || '; security definer ' || pp.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(pp.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', pp.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', pp.oid, 'execute')::text
                   from pg_proc pp where pp.pronamespace = 'public'::regnamespace and pp.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('inv_xshare_active'), ('inv_xshare_revoked'), ('inv_xshare_may_handle'), ('inv_xshare_sees'), ('inv_xshare_transfer_revoked'), ('inv_xshare_destinations'), ('inv_xshare_transfers'), ('inv_xshare_transfer_trace'), ('inv_xshare_units'), ('inv_xshare_counted_stock'), ('inv_xshare_availability')) f(name)
  union all select 'C functions today', 450 + row_number() over (order by f.name), f.name || ' (unchanged by this migration)',
         coalesce((select 'fingerprint ' || md5(pg_get_functiondef(pp.oid)) from pg_proc pp where pp.pronamespace = 'public'::regnamespace and pp.proname = f.name limit 1), 'MISSING')
  from (values ('inv_transfer_receive'), ('inv_transfer_dispatch'), ('inv_check_sharing'), ('inv_availability')) f(name)
  union all select 'D what exists today', 1000, 'active sharing authorisations (owner -> company that may use / hold the equipment); information only', (select count(*)::text from inv_company_sharing where revoked_at is null)
  union all select 'D what exists today', 1002, 'authorisations already REVOKED (information only: equipment dispatched under one stays visible to the receiving warehouse after this migration, flagged "Sharing revoked—contact owner")', (select count(*)::text from inv_company_sharing where revoked_at is not null)
  union all select 'D what exists today', 1003, 'equipment of ANOTHER company physically at, or on its way to, a warehouse (information only): units / counted stock rows',
         (select count(*)::text from inv_units u join inv_locations l on l.id = u.location_id where u.custody_kind = 'warehouse' and u.lifecycle = 'active' and l.company_id <> u.company_id) || ' / '
         || (select count(*)::text from inv_balances b join inv_locations l on l.id = b.location_id where b.holder_kind = 'warehouse' and b.qty > 0 and l.company_id <> b.company_id)
  union all select 'D what exists today', 1001, 'transfers between warehouses of DIFFERENT companies, by status (information only: these are what the receiving side will be able to read and trace)',
         coalesce((select string_agg(s.status || ' ' || s.n, '; ' order by s.status) from (select t.status, count(*) as n from inv_transfers t join inv_locations a on a.id = t.from_location_id join inv_locations b on b.id = t.to_location_id where a.company_id <> b.company_id group by t.status) s), 'none')
  union all select 'E row counts', 900, 'inv_transfers', (select count(*)::text from inv_transfers)
  union all select 'E row counts', 901, 'inv_units', (select count(*)::text from inv_units)
  union all select 'E row counts', 902, 'inv_company_sharing (all, including revoked)', (select count(*)::text from inv_company_sharing)
) r
order by section, ord, item;
