-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the seven Inventory migrations
-- (20261201000000, 000100, 000200, 000250, 000300, 000400, 000500). Run the WHOLE file; it returns ONE result table
-- (check | result | detail). Every row in the "result" column must read OK (INFO rows are information, the last SUMMARY row
-- counts the failures). It changes nothing. Send me the full result.
--
-- RUN IT TWICE if you like:
--   * right after the install and BEFORE inv_30_bootstrap_founders.sql: leave the setting below as it is (expect_fresh = true).
--     Then the module must be completely EMPTY: no grant, no company setting, no location, no item, no stock, nothing.
--   * any time later (founders exist, people use Inventory): change `true` to `false` in the line marked >>> SETTING <<<.
--     The structure checks stay the same; the "must be empty" checks become information, and the stock books are still
--     reconciled line by line.
--
-- Also compare section 'I HR, Sales and Projects row counts' of inv_00_preflight_readonly.sql with the numbers in the INFO rows
-- below: they must be IDENTICAL. The Inventory migrations never touch HR, Sales or Projects data and never create a company.
-- (The strict proof is inv_05_preservation_check_readonly.sql.)
--
-- One honest note about inv_ledger_problems(): that function only answers for people who may read the Inventory audit log, and
-- it identifies them by their sign-in. In the SQL Editor nobody is signed in, so it ALWAYS returns no rows here. Its row below
-- therefore proves nothing on its own; the rows next to it repeat its two reconciliations directly, without the sign-in filter.

with
cfg as (
  -- >>> SETTING <<< true = run right after the install (nothing may exist yet); false = any later run
  select true as expect_fresh
),
inv_tables as (select c.oid, c.relname, c.relrowsecurity, c.relacl, c.relowner from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'inv\_%'),
inv_seqs as (select c.oid, c.relname, c.relacl, c.relowner from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname like 'inv\_%'),
inv_funcs as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'inv\_%'),
roles as (
  select (select oid from pg_roles where rolname = 'anon') as anon, (select oid from pg_roles where rolname = 'authenticated') as auth, 0::oid as pub
),
-- the 29 tables Inventory creates
expected_tables as (select unnest(array[
  'inv_audit_log', 'inv_availability_checks', 'inv_balances', 'inv_bins', 'inv_categories', 'inv_company_grants', 'inv_company_settings',
  'inv_company_sharing', 'inv_costs', 'inv_count_lines', 'inv_counts', 'inv_idempotency', 'inv_import_log', 'inv_items', 'inv_kit_contents',
  'inv_label_prints', 'inv_locations', 'inv_movement_lines', 'inv_movements', 'inv_operator_locations', 'inv_reference_counters', 'inv_rentals',
  'inv_request_lines', 'inv_requests', 'inv_reservations', 'inv_technologies', 'inv_technology_components', 'inv_transfers', 'inv_units']) as relname),
-- tables that browsers must not read at all (idempotency records and code counters are reached by the functions only)
closed_tables as (select unnest(array['inv_idempotency', 'inv_reference_counters']) as relname),
-- tables that record every change in inv_audit_log (the movement ledger itself is the record for stock)
audited_tables as (select unnest(array[
  'inv_availability_checks', 'inv_balances', 'inv_bins', 'inv_categories', 'inv_company_grants', 'inv_company_settings', 'inv_company_sharing',
  'inv_costs', 'inv_count_lines', 'inv_counts', 'inv_items', 'inv_kit_contents', 'inv_locations', 'inv_operator_locations', 'inv_rentals',
  'inv_request_lines', 'inv_requests', 'inv_reservations', 'inv_technologies', 'inv_technology_components', 'inv_transfers', 'inv_units']) as relname),
-- the 84 functions the app calls (signed-in users may execute; each checks its own permission inside)
client_fns as (select unnest(array[
  'inv_accessible_company_ids', 'inv_add_request_line', 'inv_adjust_stock', 'inv_asset_is_linked', 'inv_availability', 'inv_can_browse',
  'inv_can_operate', 'inv_can_see_request', 'inv_can_view_stock', 'inv_cancel_count', 'inv_cancel_request', 'inv_cancel_request_line',
  'inv_capability_list', 'inv_change_request_window', 'inv_check_condition', 'inv_confirm_count', 'inv_confirm_opening_custody',
  'inv_consume', 'inv_correct_movement', 'inv_create_request', 'inv_decide_substitution', 'inv_dispatch_to_project', 'inv_employee_lookup',
  'inv_employee_outstanding', 'inv_ensure_bin_label', 'inv_expand_technology', 'inv_grant_access', 'inv_has_access', 'inv_has_any_access',
  'inv_has_capability', 'inv_import_handover_requirements', 'inv_import_legacy_assets', 'inv_is_any_founder', 'inv_is_founder',
  'inv_issue_to_employee', 'inv_ledger_problems', 'inv_my_equipment', 'inv_opportunity_availability', 'inv_pack_kit',
  'inv_preview_legacy_assets', 'inv_project_equipment', 'inv_propose_substitution', 'inv_reassign_unit', 'inv_receive_stock',
  'inv_record_label_print', 'inv_record_opportunity_check', 'inv_register_unit', 'inv_release_reservation', 'inv_remove_count_line', 'inv_repair_in',
  'inv_repair_out', 'inv_replace_item', 'inv_request_opportunity_check', 'inv_reserve', 'inv_return_from_employee',
  'inv_return_from_project', 'inv_return_rental', 'inv_return_unused', 'inv_revoke_access', 'inv_save_bin', 'inv_save_category',
  'inv_save_count_line', 'inv_save_item', 'inv_save_location', 'inv_save_request_plan', 'inv_save_technology',
  'inv_save_technology_components', 'inv_set_company_code', 'inv_set_company_sharing', 'inv_set_enabled', 'inv_set_kit_line',
  'inv_set_operator_locations', 'inv_set_shortage_action', 'inv_set_technology_status', 'inv_staff_directory', 'inv_start_count',
  'inv_submit_request', 'inv_technology_availability', 'inv_transaction_status', 'inv_transfer_between_projects', 'inv_transfer_dispatch',
  'inv_transfer_receive', 'inv_unpack_kit', 'inv_update_request_line']) as proname),
-- internal helpers that run with the rights of the function owner (35): closed to signed-in users
internal_definer_fns as (select unnest(array[
  'inv_audit_trigger', 'inv_begin_movement', 'inv_can_edit_request', 'inv_cancel_request_internal', 'inv_check_bin', 'inv_check_sharing',
  'inv_ctx', 'inv_demand_check', 'inv_employee_active', 'inv_expand_into_request', 'inv_finish_movement', 'inv_free_count',
  'inv_get_employee', 'inv_get_item', 'inv_get_project', 'inv_idem_begin', 'inv_import_handover_internal', 'inv_is_warehouse_operator',
  'inv_line_progress', 'inv_loc', 'inv_lock_request', 'inv_mirror_legacy', 'inv_next_code', 'inv_opportunity_compute',
  'inv_proj_after_insert', 'inv_proj_after_status', 'inv_refresh_project_requests', 'inv_refresh_request_status', 'inv_release_row',
  'inv_release_unused', 'inv_replaying', 'inv_require_cap', 'inv_require_edit', 'inv_require_enabled', 'inv_reserve_block_reason', 'inv_user_name']) as proname),
-- internal plain helpers and trigger functions (30): they run as the calling function, are never reachable by a browser, and are closed too
internal_invoker_fns as (select unnest(array[
  'inv_bal_change', 'inv_bal_ensure', 'inv_check_qty', 'inv_check_version', 'inv_cost_fields_present', 'inv_custody_words',
  'inv_effective_item', 'inv_items_guard', 'inv_ledger_immutable', 'inv_legacy_guard', 'inv_lines_array', 'inv_local_to_utc',
  'inv_lock_item', 'inv_lock_lines', 'inv_ml', 'inv_nonblank', 'inv_plan_window', 'inv_qty_free', 'inv_require_user',
  'inv_reservation_return', 'inv_reservation_take', 'inv_take_qty', 'inv_unit_block_reason', 'inv_unit_free', 'inv_unit_lock',
  'inv_unit_move', 'inv_unit_reserved_by', 'inv_unit_usable', 'inv_units_guard', 'inv_valid_condition']) as proname),
-- the four intended triggers on existing tables
intended_triggers as (select * from (values
  ('assets', 'inv_legacy_guard_assets', 'inv_legacy_guard'),
  ('asset_assignments', 'inv_legacy_guard_assignments', 'inv_legacy_guard'),
  ('proj_projects', 'inv_proj_projects_import', 'inv_proj_after_insert'),
  ('proj_projects', 'inv_proj_projects_release', 'inv_proj_after_status')) as v(tbl, trg, fn)),
-- how many rows each Inventory table holds
inv_counts as (
  select t.relname, ((xpath('/row/n/text()', x))[1])::text::bigint as n
  from inv_tables t,
       lateral query_to_xml(format('select count(*) as n from %I', t.relname), false, true, '') x
),
checks as (
select ord, check_name, result, detail from (

  -- 1-4 the tables ----------------------------------------------------------------------------------------------------------
  select 1 as ord, 'Inventory tables exist: exactly the 29 expected' as check_name,
         case when not exists (select 1 from expected_tables e where not exists (select 1 from inv_tables t where t.relname = e.relname))
               and not exists (select 1 from inv_tables t where not exists (select 1 from expected_tables e where e.relname = t.relname)) then 'OK' else 'FAIL' end as result,
         (select count(*)::text from inv_tables) || ' found'
         || coalesce('; MISSING: ' || (select string_agg(e.relname, ', ') from expected_tables e where not exists (select 1 from inv_tables t where t.relname = e.relname)), '')
         || coalesce('; UNKNOWN: ' || (select string_agg(t.relname, ', ') from inv_tables t where not exists (select 1 from expected_tables e where e.relname = t.relname)), '') as detail
  union all
  select 2, 'row-level security is ON for every Inventory table', case when not exists (select 1 from inv_tables where not relrowsecurity) then 'OK' else 'FAIL' end,
         coalesce((select string_agg(relname, ', ') from inv_tables where not relrowsecurity), 'all on')
  union all
  select 3, 'no INSERT / UPDATE / DELETE policy on any Inventory table (browsers read only; every change goes through a function)',
         case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'inv\_%' and cmd <> 'SELECT') then 'OK' else 'FAIL' end,
         coalesce((select string_agg(tablename || ':' || cmd, ', ') from pg_policies where schemaname = 'public' and tablename like 'inv\_%' and cmd <> 'SELECT'), (select count(*)::text from pg_policies where schemaname = 'public' and tablename like 'inv\_%') || ' policies, all SELECT')
  union all
  select 4, 'anon holds NO privilege at all on any Inventory table',
         case when not exists (select 1 from inv_tables t, roles r, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x where x.grantee = r.anon) then 'OK' else 'FAIL' end,
         coalesce((select string_agg(distinct t.relname, ', ') from inv_tables t, roles r, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x where x.grantee = r.anon), 'checked through the access-control lists')
  union all
  select 5, 'signed-in users and PUBLIC hold no INSERT / UPDATE / DELETE / TRUNCATE (or REFERENCES / TRIGGER / MAINTAIN) on any Inventory table; signed-in users hold SELECT only',
         case when not exists (select 1 from inv_tables t, roles r, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x where x.grantee in (r.auth, r.pub) and x.privilege_type <> 'SELECT')
               and not exists (select 1 from inv_tables t, roles r, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x where x.grantee = r.pub) then 'OK' else 'FAIL' end,
         coalesce((select string_agg(distinct t.relname || ':' || x.privilege_type, ', ') from inv_tables t, roles r, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x where x.grantee in (r.auth, r.pub) and x.privilege_type <> 'SELECT'), 'SELECT only')
  union all
  select 6, 'idempotency records and reference-code counters are invisible to browsers (no privilege for signed-in users, anon or PUBLIC)',
         case when (select count(*) from inv_tables t join closed_tables c on c.relname = t.relname) = 2
               and not exists (select 1 from inv_tables t join closed_tables c on c.relname = t.relname, roles r, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x where x.grantee in (r.anon, r.auth, r.pub)) then 'OK' else 'FAIL' end,
         'only the SECURITY DEFINER functions reach them'
  union all
  select 7, 'neither anon, PUBLIC nor signed-in users hold any privilege on an Inventory sequence',
         case when not exists (select 1 from inv_seqs s, roles r, lateral aclexplode(coalesce(s.relacl, acldefault('S', s.relowner))) x where x.grantee in (r.anon, r.auth, r.pub)) then 'OK' else 'FAIL' end,
         (select count(*)::text || ' Inventory sequence(s)' from inv_seqs)

  -- 8-13 the functions -------------------------------------------------------------------------------------------------------
  union all
  select 8, 'every Inventory function is one of the 150 expected (84 for the app, 36 internal, 30 plain internal helpers)',
         case when not exists (select 1 from inv_funcs f where f.proname not in (select proname from client_fns union all select proname from internal_definer_fns union all select proname from internal_invoker_fns))
               and (select count(*) from inv_funcs) = 150
               and not exists (select 1 from (select proname from client_fns union all select proname from internal_definer_fns union all select proname from internal_invoker_fns) e where not exists (select 1 from inv_funcs f where f.proname = e.proname)) then 'OK' else 'FAIL' end,
         (select count(*)::text from inv_funcs) || ' found'
         || coalesce('; UNKNOWN: ' || (select string_agg(f.proname, ', ') from inv_funcs f where f.proname not in (select proname from client_fns union all select proname from internal_definer_fns union all select proname from internal_invoker_fns)), '')
         || coalesce('; MISSING: ' || (select string_agg(e.proname, ', ') from (select proname from client_fns union all select proname from internal_definer_fns union all select proname from internal_invoker_fns) e where not exists (select 1 from inv_funcs f where f.proname = e.proname)), '')
  union all
  select 9, 'every function the app calls (and every internal definer helper) is SECURITY DEFINER with search_path pinned to public (the one exception, inv_capability_list, only returns a constant list)',
         case when not exists (select 1 from inv_funcs f where f.proname in (select proname from client_fns union all select proname from internal_definer_fns) and f.proname <> 'inv_capability_list'
                                and not (f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%')) then 'OK' else 'FAIL' end,
         coalesce((select string_agg(f.proname, ', ') from inv_funcs f where f.proname in (select proname from client_fns union all select proname from internal_definer_fns) and f.proname <> 'inv_capability_list' and not (f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%')),
                  (select count(*)::text from inv_funcs f where f.prosecdef) || ' security definer functions, all pinned')
  union all
  select 10, 'anon and PUBLIC cannot execute any Inventory function',
         case when not exists (select 1 from inv_funcs where has_function_privilege('anon', oid, 'execute') or has_function_privilege('public', oid, 'execute')) then 'OK' else 'FAIL' end,
         coalesce((select string_agg(proname, ', ') from inv_funcs where has_function_privilege('anon', oid, 'execute') or has_function_privilege('public', oid, 'execute')), 'none')
  union all
  select 11, 'signed-in users cannot execute any of the 65 internal helpers, trigger functions or housekeeping functions',
         case when not exists (select 1 from inv_funcs f where f.proname in (select proname from internal_definer_fns union all select proname from internal_invoker_fns) and has_function_privilege('authenticated', f.oid, 'execute')) then 'OK' else 'FAIL' end,
         coalesce((select string_agg(f.proname, ', ') from inv_funcs f where f.proname in (select proname from internal_definer_fns union all select proname from internal_invoker_fns) and has_function_privilege('authenticated', f.oid, 'execute')), 'none reachable')
  union all
  select 12, 'signed-in users can execute all 84 functions the app calls (each one checks the caller''s permission inside)',
         case when not exists (select 1 from inv_funcs f where f.proname in (select proname from client_fns) and not has_function_privilege('authenticated', f.oid, 'execute')) then 'OK' else 'FAIL' end,
         coalesce((select string_agg(f.proname, ', ') from inv_funcs f where f.proname in (select proname from client_fns) and not has_function_privilege('authenticated', f.oid, 'execute')), 'all callable')
  union all
  select 13, 'the plain internal helpers cannot be reached from a browser either (not executable by signed-in users, anon or PUBLIC, and none is SECURITY DEFINER)',
         case when not exists (select 1 from inv_funcs f where f.proname in (select proname from internal_invoker_fns) and (f.prosecdef or has_function_privilege('authenticated', f.oid, 'execute') or has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('public', f.oid, 'execute'))) then 'OK' else 'FAIL' end,
         (select count(*)::text || ' plain helpers' from inv_funcs f where f.proname in (select proname from internal_invoker_fns))

  -- 15-20 triggers and constraints --------------------------------------------------------------------------------------------
  union all
  select 15, 'the stock ledger is immutable: a BEFORE UPDATE OR DELETE row trigger that refuses, enabled, on inv_movements and on inv_movement_lines',
         case when (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc p on p.oid = g.tgfoid
                    where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and g.tgenabled = 'O'
                      and ((c.relname = 'inv_movements' and g.tgname = 'inv_movements_immutable') or (c.relname = 'inv_movement_lines' and g.tgname = 'inv_movement_lines_immutable'))
                      and p.proname = 'inv_ledger_immutable' and (g.tgtype & 1) <> 0 and (g.tgtype & 2) <> 0 and (g.tgtype & 8) <> 0 and (g.tgtype & 16) <> 0 and (g.tgtype & 4) = 0) = 2
               and (select count(*) from inv_funcs where proname = 'inv_ledger_immutable' and prosrc ~* 'raise exception') = 1 then 'OK' else 'FAIL' end,
         'inv_movements_immutable and inv_movement_lines_immutable'
  union all
  select 16, 'the rule triggers on units and items (tracking method fixed once stock exists, unit state rules) exist and are enabled',
         case when (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
                    where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and g.tgenabled = 'O'
                      and ((c.relname = 'inv_units' and g.tgname = 'inv_units_guard_trg') or (c.relname = 'inv_items' and g.tgname = 'inv_items_guard_trg'))) = 2 then 'OK' else 'FAIL' end,
         'inv_units_guard_trg, inv_items_guard_trg'
  union all
  select 17, 'the audit trigger exists and is enabled on every audited Inventory table (22 expected)',
         case when not exists (select 1 from audited_tables a where not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                                where not g.tgisinternal and c.relname = a.relname and g.tgname = a.relname || '_audit' and g.tgenabled = 'O')) then 'OK' else 'FAIL' end,
         coalesce('MISSING on: ' || (select string_agg(a.relname, ', ') from audited_tables a where not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                                where not g.tgisinternal and c.relname = a.relname and g.tgname = a.relname || '_audit' and g.tgenabled = 'O')),
                  (select count(*)::text from audited_tables) || ' tables audited')
  union all
  select 18, 'extension btree_gist is installed, and the exclusion constraint inv_reservations_no_overlap on inv_reservations exists (two active reservations of one item can never overlap)',
         case when exists (select 1 from pg_extension where extname = 'btree_gist')
               and exists (select 1 from pg_constraint c where c.conrelid = 'public.inv_reservations'::regclass and c.conname = 'inv_reservations_no_overlap' and c.contype = 'x'
                           and pg_get_constraintdef(c.oid) like '%USING gist%' and pg_get_constraintdef(c.oid) like '%unit_id WITH =%' and pg_get_constraintdef(c.oid) like '%&&%') then 'OK' else 'FAIL' end,
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.inv_reservations'::regclass and c.conname = 'inv_reservations_no_overlap'), 'constraint missing')
  union all
  select 19, 'the four intended triggers on existing tables exist, are enabled and run the right function: inv_legacy_guard_assets, inv_legacy_guard_assignments, inv_proj_projects_import, inv_proj_projects_release',
         case when not exists (select 1 from intended_triggers i where not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc p on p.oid = g.tgfoid
                                where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname = i.tbl and g.tgname = i.trg and p.proname = i.fn and g.tgenabled = 'O')) then 'OK' else 'FAIL' end,
         coalesce('MISSING: ' || (select string_agg(i.tbl || '.' || i.trg, ', ') from intended_triggers i where not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc p on p.oid = g.tgfoid
                                where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname = i.tbl and g.tgname = i.trg and p.proname = i.fn and g.tgenabled = 'O')), '4 of 4 present')
  union all
  select 20, 'no other inv_ trigger sits on a table that Inventory does not own (exactly those four, nothing else)',
         case when (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname !~ '^inv_' and g.tgname ~ '^inv_') = 4 then 'OK' else 'FAIL' end,
         (select count(*)::text || ' inv_ trigger(s) on other tables: ' || coalesce(string_agg(c.relname || '.' || g.tgname, ', ' order by c.relname, g.tgname), 'none') from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname !~ '^inv_' and g.tgname ~ '^inv_')

  -- 21-26 no automatic access, nothing created for you ----------------------------------------------------------------------
  union all
  select 21, 'NO automatic grants: inv_company_grants is empty before you run the bootstrap script (expect_fresh = true); later: every active grant belongs to an active person and an existing company',
         case when (select expect_fresh from cfg) then case when (select count(*) from inv_company_grants) = 0 then 'OK' else 'FAIL' end
              else case when not exists (select 1 from inv_company_grants g where g.revoked_at is null and (not exists (select 1 from profiles p where p.id = g.user_id and p.is_active) or not exists (select 1 from companies c where c.id = g.company_id))) then 'OK' else 'FAIL' end end,
         (select count(*)::text || ' grant rows (' || count(*) filter (where revoked_at is null) || ' active, ' || count(*) filter (where revoked_at is null and 'founder' = any (capabilities)) || ' founder)' from inv_company_grants)
  union all
  select 22, 'NO data created for you: every Inventory table is empty before the owner creates data (expect_fresh = true); later this is information',
         case when (select expect_fresh from cfg) then case when not exists (select 1 from inv_counts where n > 0) then 'OK' else 'FAIL' end else 'INFO' end,
         coalesce((select 'rows in: ' || string_agg(relname || '=' || n, ', ' order by relname) from inv_counts where n > 0), 'all 29 tables are empty')
  union all
  select 23, 'every company with active Inventory grants has at least one founder (with no grants yet this is OK)',
         case when not exists (select 1 from inv_company_grants g where g.revoked_at is null
                               and not exists (select 1 from inv_company_grants f where f.company_id = g.company_id and f.revoked_at is null and 'founder' = any (f.capabilities))) then 'OK' else 'FAIL' end,
         'run inv_30_bootstrap_founders.sql if this fails after people were given access'
  union all
  select 24, 'Inventory settings: reference codes are unique and well formed, and every one belongs to an existing company',
         case when (select count(distinct reference_code) from inv_company_settings) = (select count(*) from inv_company_settings)
               and not exists (select 1 from inv_company_settings s where s.reference_code !~ '^[A-Z]{2,5}$' or not exists (select 1 from companies c where c.id = s.company_id)) then 'OK' else 'FAIL' end,
         (select count(*)::text || ' settings rows: ' || coalesce(string_agg(c.legal_name || ' -> ' || s.reference_code || case when s.is_enabled then ' (on)' else ' (OFF)' end, '; ' order by c.legal_name), '') from inv_company_settings s join companies c on c.id = s.company_id)
  union all
  select 25, 'no Inventory row is written to the shared HR audit log and no Inventory notification exists',
         case when not exists (select 1 from audit_log where table_name like 'inv\_%') and not exists (select 1 from notifications where type like 'inv%') then 'OK' else 'FAIL' end,
         'Inventory keeps its own audit table inv_audit_log (readable only by founders and people given view_audit)'
  union all
  select 26, 'no scheduled job, e-mail setting or cron route was added by Inventory (nothing in this release sends anything)',
         case when not exists (select 1 from inv_funcs where prosrc ~* '(cron|net\.http|pg_net|send_mail|smtp)') then 'OK' else 'FAIL' end, 'no notifications, no e-mail, no scheduled jobs'

  -- 27-31 Inventory leaves HR, Sales and Projects alone ------------------------------------------------------------------------
  union all
  select 27, 'the only Inventory function that writes an HR, Sales or Projects table is inv_mirror_legacy (it keeps the HR asset register in step, and only for assets a founder imported)',
         case when not exists (select 1 from inv_funcs where prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(employees|departments|companies|profiles|user_roles|assets|asset_assignments|audit_log|notifications|attendance[a-z_]*|leave[a-z_]*|payroll[a-z_]*|crm_[a-z_]+|proj_[a-z_]+)\y' and proname <> 'inv_mirror_legacy') then 'OK' else 'FAIL' end,
         coalesce((select string_agg(proname, ', ') from inv_funcs where prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(employees|departments|companies|profiles|user_roles|assets|asset_assignments|audit_log|notifications|attendance[a-z_]*|leave[a-z_]*|payroll[a-z_]*|crm_[a-z_]+|proj_[a-z_]+)\y' and proname <> 'inv_mirror_legacy'), 'writers of those tables: inv_mirror_legacy only')
  union all
  select 28, 'no Inventory function reads salary, compensation, personal e-mail, phone, birth date, passport, nationality or bank details',
         case when not exists (select 1 from inv_funcs where prosrc ~* '(salary|compensation|personal_email|phone|date_of_birth|iban|passport|nationality|base_pay)') then 'OK' else 'FAIL' end,
         coalesce((select string_agg(proname, ', ') from inv_funcs where prosrc ~* '(salary|compensation|personal_email|phone|date_of_birth|iban|passport|nationality|base_pay)'), 'none do')
  union all
  select 29, 'Inventory tables point only at companies, employees, auth users, assets, crm_opportunities, proj_projects and each other',
         case when not exists (select 1 from pg_constraint con join pg_class src on src.oid = con.conrelid join pg_class dst on dst.oid = con.confrelid
                               where con.contype = 'f' and src.relname like 'inv\_%' and dst.relname not like 'inv\_%'
                                 and not (dst.relnamespace = 'auth'::regnamespace and dst.relname = 'users')
                                 and not (dst.relnamespace = 'public'::regnamespace and dst.relname in ('companies', 'employees', 'assets', 'crm_opportunities', 'proj_projects'))) then 'OK' else 'FAIL' end,
         coalesce((select string_agg(distinct dst.relname, ', ') from pg_constraint con join pg_class src on src.oid = con.conrelid join pg_class dst on dst.oid = con.confrelid
                   where con.contype = 'f' and src.relname like 'inv\_%' and dst.relname not like 'inv\_%'), 'none')
  union all
  select 30, 'the HR asset tables carry no Inventory column and no Inventory policy; the only additions are the two guard triggers',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('assets', 'asset_assignments') and column_name like 'inv\_%')
               and not exists (select 1 from pg_policies where tablename in ('assets', 'asset_assignments') and policyname like 'inv\_%')
               and (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname in ('assets', 'asset_assignments') and g.tgname like 'inv\_%') = 2 then 'OK' else 'FAIL' end,
         'unchanged'
  union all
  select 31, 'Projects and Sales tables carry no Inventory column and no Inventory policy; the only additions are the two project triggers',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and (table_name like 'proj\_%' or table_name like 'crm\_%') and column_name like 'inv\_%')
               and not exists (select 1 from pg_policies where (tablename like 'proj\_%' or tablename like 'crm\_%') and policyname like 'inv\_%')
               and (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and (c.relname like 'proj\_%' or c.relname like 'crm\_%') and g.tgname like 'inv\_%') = 2 then 'OK' else 'FAIL' end,
         'unchanged'

  -- 32-38 the stock books agree (works with or without data) ---------------------------------------------------------------------
  union all
  select 32, 'inv_ledger_problems() returns no rows (as the owner it sees nothing: see the note at the top, this row alone proves nothing)',
         case when not exists (select 1 from inv_ledger_problems()) then 'OK' else 'FAIL' end,
         'the two direct reconciliations below are the real check'
  union all
  select 33, 'every stock row (balance) equals the sum of the ledger lines that point at it',
         case when not exists (
           select 1 from inv_balances b
             left join lateral (select sum(case when l.to_balance_id = b.id then l.qty else 0 end) - sum(case when l.from_balance_id = b.id then l.qty else 0 end) as net
                                  from inv_movement_lines l where l.to_balance_id = b.id or l.from_balance_id = b.id) s on true
            where b.qty <> coalesce(s.net, 0)) then 'OK' else 'FAIL' end,
         coalesce((select count(*)::text || ' stock row(s) differ from the ledger: ' || string_agg(b.id::text, ', ') from inv_balances b
             left join lateral (select sum(case when l.to_balance_id = b.id then l.qty else 0 end) - sum(case when l.from_balance_id = b.id then l.qty else 0 end) as net
                                  from inv_movement_lines l where l.to_balance_id = b.id or l.from_balance_id = b.id) s on true
            where b.qty <> coalesce(s.net, 0)), (select count(*)::text || ' stock rows reconciled' from inv_balances))
  union all
  select 34, 'every unit that has moved is where its last movement says it is',
         case when not exists (
           select 1 from inv_units u
             join (select distinct on (l.unit_id) l.unit_id, l.to_kind, l.to_location_id, l.to_employee_id, l.to_project_id
                     from inv_movement_lines l join inv_movements m on m.id = l.movement_id
                    where l.unit_id is not null
                    order by l.unit_id, m.recorded_at desc, m.code desc, l.id desc) x on x.unit_id = u.id
            where not (case x.to_kind
                         when 'warehouse' then u.custody_kind = 'warehouse' and u.location_id is not distinct from x.to_location_id and u.lifecycle in ('active', 'draft')
                         when 'employee' then u.custody_kind = 'employee' and u.employee_id is not distinct from x.to_employee_id
                         when 'project' then u.custody_kind = 'project' and u.project_id is not distinct from x.to_project_id
                         when 'transit' then u.custody_kind = 'transit'
                         when 'repair' then u.custody_kind = 'repair'
                         when 'kit' then u.custody_kind = 'kit'
                         when 'adjustment' then u.lifecycle in ('missing', 'retired')
                         else false end)) then 'OK' else 'FAIL' end,
         (select count(*)::text || ' units' from inv_units)
  union all
  select 35, 'no stock row holds a negative quantity',
         case when not exists (select 1 from inv_balances where qty < 0) then 'OK' else 'FAIL' end,
         (select count(*)::text || ' stock rows' from inv_balances)
  union all
  select 36, 'no two active reservations of one unit overlap',
         case when not exists (select 1 from inv_reservations a join inv_reservations b on a.unit_id = b.unit_id and a.id < b.id and a.status = 'active' and b.status = 'active' and a.reserved_during && b.reserved_during) then 'OK' else 'FAIL' end,
         (select count(*)::text || ' reservations (' || count(*) filter (where status = 'active') || ' active)' from inv_reservations)
  union all
  select 37, 'every movement line belongs to a movement of the same company',
         case when not exists (select 1 from inv_movement_lines l join inv_movements m on m.id = l.movement_id where m.company_id <> l.company_id) then 'OK' else 'FAIL' end,
         (select count(*)::text || ' movements, ' || (select count(*) from inv_movement_lines)::text || ' lines' from inv_movements)
  union all
  select 38, 'every HR asset that is linked to an Inventory unit exists and belongs to the same company (none can exist before a founder imports assets)',
         case when not exists (select 1 from inv_units u join assets a on a.id = u.legacy_asset_id where a.company_id <> u.company_id) then 'OK' else 'FAIL' end,
         (select count(*)::text || ' linked assets' from inv_units where legacy_asset_id is not null)

  -- 39-52 information: counts to compare with the preflight, and what to do next -------------------------------------------------
  union all select 39, 'INFO: row count companies (compare with preflight section I)', 'INFO', (select count(*)::text from companies)
  union all select 40, 'INFO: row count profiles', 'INFO', (select count(*)::text from profiles)
  union all select 41, 'INFO: row count user_roles', 'INFO', (select count(*)::text from user_roles)
  union all select 42, 'INFO: row count employees', 'INFO', (select count(*)::text from employees)
  union all select 43, 'INFO: row count assets', 'INFO', (select count(*)::text from assets)
  union all select 44, 'INFO: row count asset_assignments', 'INFO', (select count(*)::text from asset_assignments)
  union all select 45, 'INFO: row count audit_log', 'INFO', (select count(*)::text from audit_log)
  union all select 46, 'INFO: row count notifications', 'INFO', (select count(*)::text from notifications)
  union all select 47, 'INFO: row count crm_opportunities', 'INFO', (select count(*)::text from crm_opportunities)
  union all select 48, 'INFO: row count crm_company_grants (active)', 'INFO', (select count(*)::text from crm_company_grants where revoked_at is null)
  union all select 49, 'INFO: row count proj_projects', 'INFO', (select count(*)::text from proj_projects)
  union all select 50, 'INFO: row count proj_handovers', 'INFO', (select count(*)::text from proj_handovers)
  union all select 51, 'INFO: row count proj_project_members', 'INFO', (select count(*)::text from proj_project_members)
  union all select 52, 'INFO: row count proj_company_grants (active)', 'INFO', (select count(*)::text from proj_company_grants where revoked_at is null)
  union all
  select 60, 'WHAT YOU SHOULD SEE NEXT (1): now', 'INFO', 'every check above says OK and the SUMMARY row says so. If any row says FAIL, stop and send me the whole result.'
  union all
  select 61, 'WHAT YOU SHOULD SEE NEXT (2): preservation', 'INFO', 'run inv_05_preservation_check_readonly.sql in compare mode (paste the lines saved before the install): the summary must say PASS, and the four intended triggers must show SAME.'
  union all
  select 62, 'WHAT YOU SHOULD SEE NEXT (3): the app', 'INFO', 'after the app is deployed, people WITHOUT Inventory access see no Inventory menu at all (nobody has any access yet: this check proves there is no automatic grant).'
  union all
  select 63, 'WHAT YOU SHOULD SEE NEXT (4): founders', 'INFO', 'edit and run inv_30_bootstrap_founders.sql. It names the founders and the companies you type and nothing else. Run this file again afterwards with expect_fresh = false.'
  union all
  select 64, 'WHAT YOU SHOULD SEE NEXT (5): configuration', 'INFO', 'a founder opens Inventory > Manage, sets the company reference code (if the bootstrap did not), then creates locations, categories and items. Nothing is created for you: no stock, no location, no category.'
  union all
  select 65, 'WHAT YOU SHOULD SEE NEXT (6): HR Assets page', 'INFO', 'HR assets keep working exactly as before. Only an asset a founder IMPORTS into Inventory becomes read-only on the HR Assets page (message: "This item is managed in Inventory").'
) q
)
select check_name, result, detail from (
  select ord, check_name, result, detail from checks
  union all
  select 99, 'SUMMARY',
         case when exists (select 1 from checks where result not in ('OK', 'INFO')) then 'STOP' else 'OK' end,
         case when exists (select 1 from checks where result not in ('OK', 'INFO'))
              then (select count(*)::text from checks where result not in ('OK', 'INFO')) || ' check(s) FAILED, see the rows above and send me the whole result'
              else (select count(*)::text from checks where result = 'OK') || ' checks OK, ' || (select count(*)::text from checks where result = 'INFO') || ' information rows' end
) r
order by ord;
