-- WRITES / DESTRUCTIVE. ONLY for backing out the Project Budget & Expenses install on "Enginious HR Engine_V2". Not part of the normal deployment.
-- Run in the SQL Editor. Two clearly separated parts: A (the safe way, which you should prefer) and B (full removal).
--
-- ============================== A. THE SAFE WAY FIRST (prefer this) ==============================
-- To stop people using the module, do NOT remove anything: run pbx_80_safe_disable_and_restore.sql (section 1). Every change is then refused, everything stays
-- readable, every budget, funding entry, decision and payment stays on record, and you can switch it back on (section 2). Pausing is lossless; removal
-- below is not. Once real budget data exists, pause, never drop.
--
-- ============================== B. FULL REMOVAL ==============================
-- Removes every pbx_ table (with its triggers, policies, indexes, constraints and sequence) and every pbx_ function, and nothing else: no HR, claims,
-- payroll, Projects, Sales or Inventory table, column, function, trigger, policy, grant or row is touched (the install adds none to them). Existing
-- reimbursement claims keep every value: a claim that an expense line linked to is simply no longer referred to.
--
-- ORDER OF ROLLBACKS: remove Project Budget & Expenses FIRST if you also mean to remove Projects (its tables point at proj_projects).
--
-- SAFETY: while any business data exists (budgets, versions, funding, actual expenses, payments, company categories or rates) the script REFUSES to run and
-- says what it found. Access grants, the company switch and their audit rows do not count: you may remove an install that nobody has used yet.
--
-- RESTRICTIONS ONCE REAL DATA EXISTS:
--   * Export first (Table Editor > each pbx_ table > Export) and keep the files with the audit papers. The approved budgets, Finance decisions, funding entries,
--     payments and settlement closures are the only record of who approved what and what money moved; deleting them cannot be undone.
--   * Two switches stop the refusal: v_allow_data_loss := true AND v_confirm := 'DELETE ALL PROJECT BUDGET HISTORY'. Use them only for a trial install filled with
--     test data, or after the export, and only if you really mean to destroy the history.
--
-- Running it a second time is harmless (it says there is nothing left to remove).

do $$
declare
  v_allow_data_loss boolean := false;     -- <<< true only for a trial install or after exporting, and only if you really mean it
  v_confirm text := '';                   -- <<< and then type exactly: DELETE ALL PROJECT BUDGET HISTORY
  v_found text := '';
  v_rows bigint := 0;
  n bigint;
  t text;
  f record;
begin
  if not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'pbx\_%' and relkind in ('r', 'S'))
     and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'pbx\_%') then
    raise notice 'Nothing to remove: no Project Budget & Expenses table or function exists.';
    return;
  end if;

  -- 1. COUNT BUSINESS DATA, table by table (only tables that exist, so a second run is harmless).
  foreach t in array array['pbx_budgets', 'pbx_budget_versions', 'pbx_budget_rows', 'pbx_funding', 'pbx_actual_submissions', 'pbx_actual_rows', 'pbx_payments', 'pbx_rates'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from %I', t) into n;
      if n > 0 then v_found := v_found || t || ' (' || n || '), '; v_rows := v_rows + n; end if;
    end if;
  end loop;
  if to_regclass('public.pbx_categories') is not null then
    select count(*) into n from pbx_categories where company_id is not null;     -- the six standard categories are seeded by the migration and do not count
    if n > 0 then v_found := v_found || 'company categories (' || n || '), '; v_rows := v_rows + n; end if;
  end if;

  if v_rows > 0 and not (v_allow_data_loss and v_confirm = 'DELETE ALL PROJECT BUDGET HISTORY') then
    raise exception 'REFUSED: business data exists: %. Prefer the safe switch-off (pbx_80_safe_disable_and_restore.sql). To destroy it on purpose, export it first, then set v_allow_data_loss := true and v_confirm := ''DELETE ALL PROJECT BUDGET HISTORY'' at the top of this file.', rtrim(v_found, ', ');
  end if;

  -- 2. TABLES (their triggers, policies, indexes and constraints go with them), then every remaining pbx_ function.
  for f in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'pbx\_%' loop
    execute format('drop table if exists %I cascade', f.relname);
    raise notice 'dropped table %', f.relname;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'pbx\_%' loop
    execute format('drop function if exists %s cascade', f.sig);
    raise notice 'dropped function %', f.sig;
  end loop;
  raise notice 'Project Budget & Expenses removed. Existing HR, claims, Projects, Sales and Inventory objects were not touched; run pbx_05_preservation_check_readonly.sql (compare mode) to prove it.';
end $$;

-- What is left (must be nothing)
select 'table' as kind, c.relname as name from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'pbx\_%'
union all
select 'function', p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'pbx\_%'
order by 1, 2;
