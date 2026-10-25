-- WRITES / DESTRUCTIVE. ONLY for backing out the Inventory install on "Enginious HR Engine_V2". Not part of the normal deployment.
-- Run in the SQL Editor. It is in two clearly separated parts: A (the safe way, which you should prefer) and B (full removal).
--
-- ============================== A. THE SAFE WAY FIRST (prefer this) ==============================
-- To stop people using Inventory, do NOT remove anything: run inv_80_safe_disable_and_restore.sql (section 1). Every Inventory
-- change is then refused, everything stays readable, every label, count and movement stays valid, and you can switch it back on
-- (section 2). Pausing is lossless; removal below is not. Once real Inventory data exists, pause, never drop.
--
-- ============================== B. FULL REMOVAL ==============================
-- It removes every Inventory table, every Inventory function, and the four Inventory triggers on existing tables:
--     assets             inv_legacy_guard_assets
--     asset_assignments  inv_legacy_guard_assignments
--     proj_projects      inv_proj_projects_import
--     proj_projects      inv_proj_projects_release
-- and nothing else: no HR, Sales or Projects table, column, function, policy, grant or row is touched. (Inventory adds no column,
-- policy, bucket, notification or scheduled job to anything outside the inv_ names.) The order is: first the four triggers, then
-- the tables (with their policies, indexes, constraints and sequence), then every remaining function.
--
-- ORDER OF ROLLBACKS: if you also mean to remove Projects or Sales, remove Inventory FIRST. Inventory tables point at proj_projects
-- and crm_opportunities; dropping those first (proj_90 / crm_90 drop with "cascade") silently cuts those links and leaves Inventory
-- half working.
--
-- SAFETY: while any Inventory business data exists (units, stock, movements, counts, requests, reservations, rentals, costs,
-- locations, categories, items, templates, labels, import records, a code counter that already issued a label...) the script
-- REFUSES to run and says what it found. The only rows that do not count are the access grants and the company settings you created
-- with inv_30_bootstrap_founders.sql (and their audit rows): you may remove an install that nobody has used yet.
--
-- RESTRICTIONS ONCE REAL DATA EXISTS (read before you even think of changing the two switches below):
--   * Export first (Table Editor > each inv_ table > Export, or "copy ... to" from a database tool) and keep the files with the
--     audit papers. The stock ledger (inv_movements, inv_movement_lines) is deliberately immutable: it is the only proof of who
--     held which item and when, who counted, who dispatched, and what was written off. Deleting it destroys that evidence for good
--     and cannot be undone; there is no backup inside this script.
--   * Labels already printed and stuck on equipment carry codes (UAE-E-00042). After removal they point at nothing, and a later
--     re-install starts the counters at 1 again, so a NEW item could be given a code that is already on an OLD label.
--   * HR assets that a founder imported keep whatever status and assignment rows Inventory last wrote to them (this script does not
--     reverse them). With the guard triggers gone, HR can edit those assets again.
--   * Two switches stop the refusal: v_allow_data_loss := true AND v_confirm := 'DELETE ALL INVENTORY HISTORY'. Use them only for a
--     trial install filled with test data, or after the export, and only if you really mean to destroy the history.
--
-- Running it a second time is harmless (it says there is nothing left to remove).

do $$
declare
  v_allow_data_loss boolean := false;     -- <<< true only for a trial install or after exporting, and only if you really mean it
  v_confirm text := '';                   -- <<< and then type exactly: DELETE ALL INVENTORY HISTORY
  v_rows bigint := 0;
  v_found text := '';
  n bigint;
  t record;
  f record;
  v_tables text;
begin
  if not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'inv\_%' and relkind in ('r', 'S'))
     and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'inv\_%')
     and not exists (select 1 from pg_trigger where not tgisinternal and tgname like 'inv\_%') then
    raise notice 'Nothing to remove: no Inventory table, function or trigger exists.';
    return;
  end if;

  -- 1. COUNT BUSINESS DATA, table by table (only tables that exist, so a second run is harmless).
  --    Access grants and company settings (what the bootstrap script creates) and their audit rows do not count.
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'inv\_%'
           and c.relname not in ('inv_company_grants', 'inv_company_settings', 'inv_audit_log') order by c.relname loop
    execute format('select count(*) from %I', t.relname) into n;
    if n > 0 then
      v_rows := v_rows + n;
      v_found := v_found || t.relname || '=' || n || ', ';
    end if;
  end loop;
  if to_regclass('public.inv_audit_log') is not null then
    select count(*) into n from inv_audit_log where table_name not in ('inv_company_grants', 'inv_company_settings');
    if n > 0 then
      v_rows := v_rows + n;
      v_found := v_found || 'inv_audit_log (rows about stock, catalogue or plans)=' || n || ', ';
    end if;
  end if;

  if v_rows > 0 and not (v_allow_data_loss and v_confirm = 'DELETE ALL INVENTORY HISTORY') then
    raise exception 'Inventory data exists (% rows: %). Nothing was removed. Prefer inv_80_safe_disable_and_restore.sql. To remove it anyway, export it first, then set v_allow_data_loss := true and v_confirm := ''DELETE ALL INVENTORY HISTORY''.',
      v_rows, rtrim(v_found, ', ');
  end if;
  if v_rows > 0 then
    raise notice 'ALLOWED TO DESTROY % rows of Inventory data (%) as you instructed.', v_rows, rtrim(v_found, ', ');
  end if;

  -- 2. THE FOUR TRIGGERS on existing tables (first, so no existing table depends on an Inventory function any more)
  if to_regclass('public.proj_projects') is not null then
    drop trigger if exists inv_proj_projects_release on proj_projects;
    drop trigger if exists inv_proj_projects_import on proj_projects;
  end if;
  if to_regclass('public.asset_assignments') is not null then
    drop trigger if exists inv_legacy_guard_assignments on asset_assignments;
  end if;
  if to_regclass('public.assets') is not null then
    drop trigger if exists inv_legacy_guard_assets on assets;
  end if;

  -- 3. THE TABLES (all together, so their links to each other do not matter; their policies, indexes, constraints, triggers and
  --    sequence go with them; functions that take a table's row as input go with the table)
  select string_agg(format('%I', c.relname), ', ' order by c.relname) into v_tables
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'inv\_%';
  if v_tables is not null then
    execute 'drop table ' || v_tables || ' cascade';
  end if;
  for f in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname like 'inv\_%' loop
    execute format('drop sequence if exists %I cascade', f.relname);
  end loop;

  -- 4. EVERY REMAINING FUNCTION (their signatures differ, so they are discovered rather than listed)
  for f in select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'inv\_%' order by 1 loop
    execute 'drop function if exists ' || f.sig || ' cascade';
  end loop;

  raise notice 'Inventory objects removed.';
end $$;

-- Result: what is left with an inv_ name (every number must be 0), and the four triggers' tables.
select 'Inventory tables left' as what, count(*)::text as number from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'S', 'v', 'm') and relname like 'inv\_%'
union all
select 'Inventory functions left', count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname like 'inv\_%'
union all
select 'inv_ triggers left on any table', count(*)::text from pg_trigger where not tgisinternal and tgname like 'inv\_%'
union all
select 'inv_ policies left', count(*)::text from pg_policies where schemaname = 'public' and (tablename like 'inv\_%' or policyname like 'inv\_%');

-- Afterwards: run inv_00_preflight_readonly.sql (section C must show "OK - no Inventory tables or functions exist yet") and, if you took
-- a snapshot before the install, inv_05_preservation_check_readonly.sql in compare mode (it must say PASS and show 0 of the 4 intended
-- triggers). Also deploy the previous version of the app (the Inventory module disappears when the tables are absent: the app shows
-- "not installed").
