-- READ ONLY. Run AFTER applying 20270114000100_inv_phase1_job_flow.sql. Changes nothing.
-- Expect: rows 1 to 7 'OK'. Row 8 is for information.
select item, result from (
  select 1 as ord, 'the picked quantity exists on reservations, starts at 0 and can never exceed what is reserved' as item,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inv_reservations' and column_name = 'picked_qty' and is_nullable = 'NO')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inv_reservations' and column_name = 'picked_at')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inv_reservations' and column_name = 'picked_by')
                   and exists (select 1 from pg_constraint where conname = 'inv_reservations_picked' and conrelid = 'public.inv_reservations'::regclass)
                   and not exists (select 1 from inv_reservations where picked_qty > qty or picked_qty < 0) then 'OK' else 'PROBLEM' end as result
  union all select 2, 'the five functions a signed-in user may call exist, and none is callable signed out',
         case when (select bool_and(to_regprocedure(f) is not null and has_function_privilege('authenticated', to_regprocedure(f), 'execute') and not has_function_privilege('anon', to_regprocedure(f), 'execute'))
                      from unnest(array['public.inv_pick_for_request(uuid, uuid, uuid, text, jsonb)', 'public.inv_set_request_runs(uuid, uuid[])', 'public.inv_project_run_cover(uuid)',
                                        'public.inv_company_run_cover(uuid)', 'public.inv_project_sales_check(uuid)']) f) then 'OK' else 'PROBLEM' end
  union all select 3, 'the two helpers are not callable from a browser session',
         case when not has_function_privilege('authenticated', 'public.inv_run_cover_rows(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.inv_tech_norm(jsonb)', 'execute')
                   and not has_function_privilege('anon', 'public.inv_run_cover_rows(uuid)', 'execute') then 'OK' else 'PROBLEM' end
  union all select 4, 'the run links table has row level security on, one read policy, and no write privilege for a signed-in user',
         case when (select relrowsecurity from pg_class where oid = 'public.inv_request_runs'::regclass)
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'inv_request_runs') = 1
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'inv_request_runs' and cmd <> 'SELECT') = 0
                   and not has_table_privilege('authenticated', 'public.inv_request_runs', 'insert') and not has_table_privilege('authenticated', 'public.inv_request_runs', 'update')
                   and not has_table_privilege('authenticated', 'public.inv_request_runs', 'delete') and not has_table_privilege('anon', 'public.inv_request_runs', 'select') then 'OK' else 'PROBLEM' end
  union all select 5, 'every new function that checks access runs with a fixed search path; the reads are stable and the two writes are not',
         case when (select bool_and(p.proconfig::text like '%search_path=public%') from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('inv_pick_for_request', 'inv_set_request_runs', 'inv_run_cover_rows', 'inv_project_run_cover', 'inv_company_run_cover', 'inv_project_sales_check'))
                   and (select bool_and(p.provolatile = 's') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('inv_run_cover_rows', 'inv_project_run_cover', 'inv_company_run_cover', 'inv_project_sales_check'))
                   and (select bool_and(p.provolatile = 'v') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('inv_pick_for_request', 'inv_set_request_runs')) then 'OK' else 'PROBLEM' end
  union all select 6, 'reserve, dispatch, return and the request state are unchanged by this migration: none mentions the picked quantity (the deployed build keeps working)',
         case when (select bool_and(position('picked_qty' in p.prosrc) = 0) from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('inv_dispatch_to_project', 'inv_return_from_project', 'inv_reserve', 'inv_reservation_take', 'inv_reservation_return', 'inv_request_state')) then 'OK' else 'PROBLEM' end
  union all select 7, 'the reservation safeguards are still in place: one active reservation per unit and period, and progress within what is reserved',
         case when exists (select 1 from pg_constraint where conname = 'inv_reservations_no_overlap' and conrelid = 'public.inv_reservations'::regclass)
                   and exists (select 1 from pg_constraint where conname = 'inv_reservations_progress' and conrelid = 'public.inv_reservations'::regclass) then 'OK' else 'PROBLEM' end
  union all select 8, 'information: reservations marked picked / requests linked to site runs / run links',
         (select count(*) from inv_reservations where picked_qty > 0)::text || ' / ' || (select count(distinct request_id) from inv_request_runs)::text || ' / ' || (select count(*) from inv_request_runs)::text
) x order by ord;
