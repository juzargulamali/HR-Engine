-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the Project Budget & Expenses migrations (20261210000000 .. 000400).
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is
-- information only). A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  every expected table exists, has row-level security ON, and no signed-in or anonymous user can write to it directly (writes are functions)
--   2  every expected function exists; the client-facing ones are executable by signed-in users and not by anonymous visitors; the internal
--      helpers and trigger functions are closed to browsers; every function that is SECURITY DEFINER fixes its search_path
--   3  the guard, calculation and audit triggers are in place; no pbx_ trigger sits on a table this module does not own
--   4  the six standard expense categories exist; every submission records its approval route; nothing was granted automatically (see pbx_30)
--   5  the company switch: which companies are on or off
--   6  who holds budget access today (information only)
--   7  row counts of the module's own tables (information only; all zero right after the install)

with
expected_tables(name) as (select unnest(array['pbx_actual_rows', 'pbx_actual_submissions', 'pbx_audit_log', 'pbx_budget_rows', 'pbx_budget_versions', 'pbx_budgets', 'pbx_categories', 'pbx_company_grants', 'pbx_company_settings', 'pbx_funding', 'pbx_payments', 'pbx_rates']::text[])),
expected_public(name) as (select unnest(array['pbx_accessible_company_ids', 'pbx_add_category', 'pbx_budget_view', 'pbx_can_read_budget', 'pbx_can_read_budget_header', 'pbx_can_read_submission', 'pbx_can_read_version', 'pbx_can_view_company', 'pbx_capability_list', 'pbx_close_settlement', 'pbx_create_budget', 'pbx_currency_decimals', 'pbx_decide_actuals', 'pbx_decide_budget', 'pbx_discard_draft', 'pbx_finance_company_ids', 'pbx_grant_access', 'pbx_has_any_access', 'pbx_has_capability', 'pbx_inbox', 'pbx_is_budget_pm', 'pbx_is_executive', 'pbx_is_finance', 'pbx_project_access', 'pbx_record_funding', 'pbx_record_payment', 'pbx_record_receipts', 'pbx_reopen_settlement', 'pbx_request_addition', 'pbx_return_approved_actuals', 'pbx_reverse_funding', 'pbx_reverse_payment', 'pbx_revise_actuals', 'pbx_revise_budget', 'pbx_revoke_access', 'pbx_round', 'pbx_save_actuals_draft', 'pbx_save_budget_draft', 'pbx_set_rate', 'pbx_settlement_summary', 'pbx_start_actuals', 'pbx_submit_actuals', 'pbx_submit_budget']::text[])),
expected_internal(name) as (select unnest(array['pbx_actual_rows_frozen', 'pbx_actual_submission_guard', 'pbx_amount', 'pbx_approval_on_hold', 'pbx_approval_route', 'pbx_audit_trigger', 'pbx_baseline_rows', 'pbx_baseline_total', 'pbx_budget_company', 'pbx_budget_header_guard', 'pbx_budget_project', 'pbx_budget_row_calc', 'pbx_can_decide', 'pbx_check_version', 'pbx_company_enabled', 'pbx_date', 'pbx_is_actuals_author', 'pbx_lock_budget', 'pbx_money_entry_guard', 'pbx_money_text', 'pbx_name', 'pbx_notify', 'pbx_num', 'pbx_project_person_ok', 'pbx_refresh_snapshot', 'pbx_require_approver', 'pbx_require_enabled', 'pbx_require_finance', 'pbx_require_open', 'pbx_require_pm', 'pbx_require_user', 'pbx_route_approvers', 'pbx_route_capability', 'pbx_rows_frozen', 'pbx_settlement_blockers', 'pbx_settlement_figures', 'pbx_user_is_finance', 'pbx_version_guard']::text[])),
pbx_funcs as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'pbx\_%'
),
checks as (
  -- 1 tables ------------------------------------------------------------------------------------------------------
  select 1 as grp, 'table exists' as chk, e.name as item,
         case when to_regclass('public.' || e.name) is not null then 'OK' else 'FAIL' end as result, '' as detail
  from expected_tables e
  union all
  select 1, 'RLS on', e.name,
         case when c.relrowsecurity then 'OK' else 'FAIL' end, case when c.relrowsecurity then '' else 'row-level security is OFF' end
  from expected_tables e join pg_class c on c.oid = to_regclass('public.' || e.name)
  union all
  select 1, 'no direct write by signed-in or anonymous users', e.name,
         case when has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate') or has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate')
              then 'FAIL' else 'OK' end,
         'authenticated: ' || coalesce((select string_agg(privilege_type, ', ') from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = e.name and g.grantee = 'authenticated'), 'none')
  from expected_tables e join pg_class c on c.oid = to_regclass('public.' || e.name)
  union all
  select 1, 'unexpected pbx_ table', c.relname, 'FAIL', 'a pbx_ table this check does not know about'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'pbx\_%' and c.relname not in (select name from expected_tables)
  -- 2 functions ---------------------------------------------------------------------------------------------------
  union all
  select 2, 'client function exists and is callable by signed-in users only', e.name,
         case when f.proname is null then 'FAIL' when f.auth_exec and not f.anon_exec then 'OK' else 'FAIL' end,
         case when f.proname is null then 'missing' when not f.auth_exec then 'signed-in users cannot run it' when f.anon_exec then 'anonymous visitors can run it' else '' end
  from expected_public e left join pbx_funcs f on f.proname = e.name
  union all
  select 2, 'internal helper exists and is closed to browsers', e.name,
         case when f.proname is null then 'FAIL' when not f.auth_exec and not f.anon_exec then 'OK' else 'FAIL' end,
         case when f.proname is null then 'missing' when f.auth_exec or f.anon_exec then 'a browser session can run it' else '' end
  from expected_internal e left join pbx_funcs f on f.proname = e.name
  union all
  select 2, 'SECURITY DEFINER functions fix search_path', f.proname,
         case when f.prosecdef and not exists (select 1 from unnest(coalesce(f.proconfig, '{}'::text[])) c where c like 'search_path=%') then 'FAIL' else 'OK' end, ''
  from pbx_funcs f where f.prosecdef
  union all
  select 2, 'unexpected pbx_ function', f.proname, 'FAIL', 'a pbx_ function this check does not know about'
  from pbx_funcs f where f.proname not in (select name from expected_public) and f.proname not in (select name from expected_internal)
  -- 3 triggers ----------------------------------------------------------------------------------------------------
  union all
  select 3, 'budget total is calculated by the database', 'pbx_budget_rows_calc',
         case when exists (select 1 from pg_trigger g where g.tgname = 'pbx_budget_rows_calc' and not g.tgisinternal and g.tgenabled = 'O') then 'OK' else 'FAIL' end, ''
  union all
  select 3, 'history cannot be edited (guard trigger)', t.name,
         case when exists (select 1 from pg_trigger g where g.tgname = t.name and not g.tgisinternal and g.tgenabled = 'O') then 'OK' else 'FAIL' end, ''
  from (values ('pbx_budget_rows_frozen'), ('pbx_budget_versions_guard'), ('pbx_budgets_guard'), ('pbx_actual_rows_frozen'), ('pbx_actual_submissions_guard'), ('pbx_funding_guard'), ('pbx_payments_guard')) as t(name)
  union all
  select 3, 'audit trigger on', e.name,
         case when exists (select 1 from pg_trigger g where g.tgrelid = to_regclass('public.' || e.name) and g.tgname like '%\_audit' and not g.tgisinternal and g.tgenabled = 'O') then 'OK' else 'FAIL' end, ''
  from expected_tables e where e.name <> 'pbx_audit_log'
  union all
  select 3, 'no pbx_ trigger on a table this module does not own', coalesce(c.relname || '.' || g.tgname, '(none)'),
         case when c.relname is null then 'OK' else 'FAIL' end, ''
  from (select 1) one left join (pg_trigger g join pg_class c on c.oid = g.tgrelid and c.relnamespace = 'public'::regnamespace and c.relname not like 'pbx\_%')
       on not g.tgisinternal and g.tgname like 'pbx\_%'
  -- 4 seed data, nothing granted automatically -------------------------------------------------------------------------
  union all
  select 4, 'standard categories', 'food, transport, contractor access, accommodation, truck / logistics, other',
         case when (select count(*) from pbx_categories where company_id is null) = 6 then 'OK' else 'FAIL' end,
         (select count(*) from pbx_categories where company_id is null)::text || ' standard categories'
  union all
  select 4, 'approval routing is recorded on every submission', t.name,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.name and column_name = 'approval_route') then 'OK' else 'FAIL' end, ''
  from (values ('pbx_budget_versions'), ('pbx_actual_submissions')) as t(name)
  union all
  select 4, 'access granted so far', 'pbx_company_grants (active)', 'INFO',
         (select count(*) from pbx_company_grants where revoked_at is null)::text || ' active grant(s); none are created by the migrations. Use pbx_30_bootstrap_access.sql to name the first people.'
  union all
  select 4, 'rates entered so far', 'pbx_rates', 'INFO',
         (select count(*) from pbx_rates)::text || ' rate(s); the application only suggests AED 0.50 per km and AED 30 per meal until Finance confirms them'
  -- 5 company switch -----------------------------------------------------------------------------------------------------
  union all
  select 5, 'company switch', c.legal_name, 'INFO',
         case when coalesce(s.is_enabled, true) then 'ON' else 'OFF (paused: nothing can be changed, everything can be read)' end
  from companies c left join pbx_company_settings s on s.company_id = c.id where c.deleted_at is null
  -- 6 access today -------------------------------------------------------------------------------------------------------
  union all
  select 6, 'access', c.legal_name || ': ' || p.email, 'INFO', array_to_string(g.capabilities, ', ')
  from pbx_company_grants g join companies c on c.id = g.company_id join profiles p on p.id = g.user_id where g.revoked_at is null
  -- 7 counts -------------------------------------------------------------------------------------------------------------
  union all select 7, 'rows', 'pbx_budgets', 'INFO', (select count(*)::text from pbx_budgets)
  union all select 7, 'rows', 'pbx_budget_versions', 'INFO', (select count(*)::text from pbx_budget_versions)
  union all select 7, 'rows', 'pbx_funding', 'INFO', (select count(*)::text from pbx_funding)
  union all select 7, 'rows', 'pbx_actual_submissions', 'INFO', (select count(*)::text from pbx_actual_submissions)
  union all select 7, 'rows', 'pbx_payments', 'INFO', (select count(*)::text from pbx_payments)
  union all select 7, 'rows', 'pbx_audit_log', 'INFO', (select count(*)::text from pbx_audit_log)
)
select grp as "#", chk as check, item, result, detail from checks
union all
select 99, 'SUMMARY', '', case when exists (select 1 from checks where result = 'FAIL') then 'FAIL' else 'OK' end,
       (select count(*) from checks where result = 'FAIL')::text || ' failing check(s); ' || (select count(*) from checks where result = 'OK')::text || ' OK'
order by 1, 2, 3;
