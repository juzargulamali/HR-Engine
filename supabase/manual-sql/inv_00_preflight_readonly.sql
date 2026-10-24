-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the ten Inventory migrations
-- (20261201000000, 000100, 000200, 000250, 000300, 000400, 000500). Run the WHOLE file; it returns ONE result table
-- (section | item | detail). It creates, changes and deletes nothing. Send me the full result (screenshot or Export -> CSV).
--
--   A  who is running this, server version
--   B  prerequisites the Inventory migrations rely on (tables, columns, functions, roles, the Sales & CRM and Projects installs,
--      the btree_gist extension) - every row must say OK
--   C  existing Inventory objects (there must be none: this is a first install)
--   D  your companies, their Sales and Projects reference codes (Inventory codes are NOT copied from anywhere: a founder types
--      one per company in the app, 2 to 5 capital letters)
--   E  people who could be the first Inventory founders: Projects founders, Sales founders and CEO / CTO roles. INFORMATION ONLY.
--      Nobody is ever chosen for you: Inventory access is a separate grant that you name in inv_30_bootstrap_founders.sql
--   F  the existing HR asset register (the HR "Assets" page): counts by company and status, open assignments, assets held by
--      people who are no longer active, rows that disagree with each other. Inventory never changes any of it until a founder
--      imports selected assets later (see docs/inventory-deployment.md)
--   G  default privileges on public tables (public privilege hardening should already be applied)
--   H  public tables WITHOUT row-level security (information only)
--   I  row counts of the HR, Sales and Projects tables the Inventory migrations must NOT change (information only; the real proof
--      is inv_05_preservation_check_readonly.sql, which separates legitimate concurrent activity from changes - run it BEFORE too)
--
-- HOW TO READ IT: section B must be OK on every row, section C must say "OK - no Inventory tables or functions exist yet".
-- Everything else is information that you keep for comparison.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all
  select 'A session', 2, 'server_version', version()
  union all
  select 'A session', 3, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')

  -- B prerequisites ------------------------------------------------------------------------------------------------
  union all
  select 'B prerequisites', 100 + row_number() over (order by t.name), 'table public.' || t.name,
         case when to_regclass('public.' || t.name) is not null then 'OK' else 'MISSING - stop and compare with the repository' end
  from (values ('companies'), ('countries'), ('profiles'), ('user_roles'), ('employees'), ('departments'), ('audit_log'), ('notifications'),
               ('assets'), ('asset_assignments'),
               ('crm_company_grants'), ('crm_company_settings'), ('crm_opportunities'),
               ('proj_company_grants'), ('proj_company_settings'), ('proj_projects'), ('proj_project_details'), ('proj_handovers'),
               ('proj_project_members'), ('proj_teams')) as t(name)
  union all
  select 'B prerequisites', 200 + row_number() over (order by f.name), 'function public.' || f.name,
         case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name) then 'OK' else 'MISSING - stop and compare with the repository' end
  from (values ('set_updated_at'), ('current_employee_id'), ('is_manager_of'), ('crm_has_access'), ('crm_is_founder'),
               ('proj_can_manage'), ('proj_can_view_details'), ('proj_can_view_summary'), ('proj_valid_timezone')) as f(name)
  union all
  select 'B prerequisites', 250, 'function auth.uid()',
         case when exists (select 1 from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname = 'uid') then 'OK' else 'MISSING - this is not a Supabase database' end
  union all
  select 'B prerequisites', 300 + row_number() over (order by r.name), 'role ' || r.name,
         case when exists (select 1 from pg_roles where rolname = r.name) then 'OK' else 'MISSING' end
  from (values ('anon'), ('authenticated'), ('service_role')) as r(name)
  union all
  select 'B prerequisites', 400 + row_number() over (order by c.tbl, c.col), 'column ' || c.tbl || '.' || c.col,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = c.tbl and column_name = c.col) then 'OK' else 'MISSING' end
  from (values ('profiles', 'is_active'), ('profiles', 'email'), ('profiles', 'full_name'),
               ('companies', 'legal_name'), ('companies', 'is_active'), ('companies', 'deleted_at'),
               ('employees', 'first_name'), ('employees', 'last_name'), ('employees', 'employee_number'), ('employees', 'department_id'),
               ('employees', 'employment_status'), ('employees', 'termination_date'), ('employees', 'deleted_at'),
               ('assets', 'asset_tag'), ('assets', 'status'), ('assets', 'deleted_at'),
               ('asset_assignments', 'asset_id'), ('asset_assignments', 'employee_id'), ('asset_assignments', 'returned_date'),
               ('proj_projects', 'kind'), ('proj_projects', 'status'),
               ('crm_opportunities', 'technologies')) as c(tbl, col)
  union all
  select 'B prerequisites', 500, 'enum asset_status has in_stock, issued, under_repair, retired',
         case when (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'asset_status' and e.enumlabel in ('in_stock', 'issued', 'under_repair', 'retired')) = 4 then 'OK' else 'DIFFERENT - stop and compare with the repository' end
  union all
  select 'B prerequisites', 501, 'Sales & CRM installed (migrations 20261115000000-300)',
         case when to_regclass('public.crm_company_grants') is not null and to_regclass('public.crm_opportunities') is not null then 'OK' else 'MISSING - install Sales & CRM first' end
  union all
  select 'B prerequisites', 502, 'Projects & Tasks installed (migrations 20261120000000-600)',
         case when to_regclass('public.proj_company_grants') is not null and to_regclass('public.proj_projects') is not null and to_regclass('public.proj_handovers') is not null then 'OK' else 'MISSING - install Projects & Tasks first' end
  union all
  select 'B prerequisites', 503, 'public privilege hardening (20261114000000) effect',
         case when (select count(*) from pg_default_acl d where d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace) > 0 then 'OK (default privileges set)' else 'NOT SEEN - apply public privilege hardening first, or tell me why not' end
  union all
  select 'B prerequisites', 504, 'extension btree_gist (the exclusion constraint that stops two reservations of one item overlapping)',
         case when exists (select 1 from pg_extension where extname = 'btree_gist') then 'OK - installed'
              when exists (select 1 from pg_available_extensions where name = 'btree_gist') then 'AVAILABLE but not installed - tell me before continuing'
              else 'NOT AVAILABLE - stop' end

  -- C existing Inventory objects -----------------------------------------------------------------------------------
  union all
  select 'C existing Inventory objects', 600 + row_number() over (order by c.relname), 'table ' || c.relname, 'ALREADY EXISTS - stop; this is meant to be a first install'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S') and c.relname like 'inv\_%'
  union all
  select 'C existing Inventory objects', 700 + row_number() over (order by p.proname), 'function ' || p.proname, 'ALREADY EXISTS - stop; this is meant to be a first install'
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'inv\_%'
  union all
  select 'C existing Inventory objects', 800 + row_number() over (order by c.relname, g.tgname), 'trigger ' || g.tgname || ' on ' || c.relname, 'ALREADY EXISTS - stop; this is meant to be a first install'
  from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and g.tgname like 'inv\_%'
  union all
  select 'C existing Inventory objects', 899, '(summary)',
         case when not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'inv\_%')
               and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'inv\_%')
               and not exists (select 1 from pg_trigger where not tgisinternal and tgname like 'inv\_%')
              then 'OK - no Inventory tables or functions exist yet' else 'Inventory objects exist - see rows above' end

  -- D companies and their codes ------------------------------------------------------------------------------------
  union all
  select 'D companies', 900 + row_number() over (order by c.country_code, c.legal_name),
         c.legal_name || ' (' || c.country_code || ')',
         'id ' || c.id || '; active=' || c.is_active::text || '; deleted=' || (c.deleted_at is not null)::text
  from companies c
  union all
  select 'D reference codes', 1000 + row_number() over (order by c.legal_name),
         c.legal_name,
         'Sales code: ' || coalesce(s.reference_code, '(none)') || '; Projects code: ' || coalesce(p.reference_code, '(none)')
         || '; Inventory code: a founder types one in the app (2 to 5 capital letters, unique, cannot change once labels exist), or set it in inv_30_bootstrap_founders.sql; nothing is copied'
  from companies c
  left join crm_company_settings s on s.company_id = c.id
  left join proj_company_settings p on p.company_id = c.id
  where c.is_active and c.deleted_at is null

  -- E who could be the first founders (information only) -----------------------------------------------------------
  union all
  select 'E Projects founders today', 1100 + row_number() over (order by p.email),
         coalesce(p.full_name, '(no name)') || ' <' || p.email || '>',
         'Projects founder for ' || string_agg(distinct c.legal_name, ', ') || '; active=' || p.is_active::text
  from proj_company_grants g join profiles p on p.id = g.user_id join companies c on c.id = g.company_id
  where g.revoked_at is null and 'founder' = any (g.capabilities)
  group by p.id, p.full_name, p.email, p.is_active
  union all
  select 'E Sales founders today', 1200 + row_number() over (order by p.email),
         coalesce(p.full_name, '(no name)') || ' <' || p.email || '>',
         'Sales founder for ' || string_agg(distinct c.legal_name, ', ') || '; active=' || p.is_active::text
  from crm_company_grants g join profiles p on p.id = g.user_id join companies c on c.id = g.company_id
  where g.revoked_at is null and 'founder' = any (g.capabilities)
  group by p.id, p.full_name, p.email, p.is_active
  union all
  select 'E CEO / CTO by HR role', 1300 + row_number() over (order by p.email),
         coalesce(p.full_name, '(no name)') || ' <' || p.email || '>',
         'active=' || p.is_active::text || '; roles: ' || string_agg(distinct ur.role::text, ', ')
  from profiles p join user_roles ur on ur.user_id = p.id and ur.revoked_at is null and ur.role in ('ceo', 'cto')
  group by p.id, p.full_name, p.email, p.is_active
  union all
  select 'E candidate founders', 1399, '(note)',
         'INFORMATION ONLY. Inventory access is separate from HR roles, Sales access and Projects access, and nobody receives it automatically (no CEO, HR Admin, System Admin or test account). You name the founders yourself in inv_30_bootstrap_founders.sql.'

  -- F the existing HR asset register -------------------------------------------------------------------------------
  union all
  select 'F HR assets by company and status', 1400 + row_number() over (order by c.legal_name, a.status::text),
         c.legal_name || ' / ' || a.status::text,
         count(*)::text || ' asset(s)' || coalesce('; total recorded value ' || sum(a.value)::text, '')
  from assets a join companies c on c.id = a.company_id
  where a.deleted_at is null
  group by c.legal_name, a.status
  union all
  select 'F HR assets by company and status', 1499, '(removed assets, kept out of the counts above)',
         (select count(*)::text from assets where deleted_at is not null)
  union all
  select 'F HR assets: open assignments', 1500, 'assets with an open assignment (returned_date empty)',
         (select count(distinct a.asset_id)::text from asset_assignments a where a.returned_date is null)
  union all
  select 'F HR assets: open assignments', 1501, 'open assignment rows',
         (select count(*)::text from asset_assignments where returned_date is null)
  union all
  select 'F HR assets: open assignments', 1502, 'assets with MORE THAN ONE open assignment (a later import keeps the latest one and writes a note; HR may prefer to tidy these first)',
         (select count(*)::text from (select asset_id from asset_assignments where returned_date is null group by asset_id having count(*) > 1) x)
  union all
  select 'F HR assets: held by people no longer active', 1600 + row_number() over (order by c.legal_name, a.asset_tag),
         c.legal_name || ' / ' || a.asset_tag || ' (' || a.category || ')',
         'open assignment to ' || btrim(e.first_name || ' ' || e.last_name) || ' (' || e.employee_number || '): status ' || e.employment_status::text
         || coalesce(', terminated ' || e.termination_date::text, '') || case when e.deleted_at is not null then ', removed from HR' else '' end
  from asset_assignments aa
  join assets a on a.id = aa.asset_id
  join companies c on c.id = a.company_id
  join employees e on e.id = aa.employee_id
  where aa.returned_date is null and a.deleted_at is null
    and not (e.deleted_at is null and e.employment_status in ('active', 'on_leave') and (e.termination_date is null or e.termination_date >= current_date))
  union all
  select 'F HR assets: held by people no longer active', 1699, '(end of list)', 'if there is no row above, no asset is held by an inactive employee'
  union all
  select 'F HR assets: rows that disagree', 1700, 'assets marked "issued" with no open assignment',
         (select count(*)::text from assets a where a.deleted_at is null and a.status = 'issued' and not exists (select 1 from asset_assignments x where x.asset_id = a.id and x.returned_date is null))
  union all
  select 'F HR assets: rows that disagree', 1701, 'assets with an open assignment that are NOT marked "issued"',
         (select count(*)::text from assets a where a.deleted_at is null and a.status <> 'issued' and exists (select 1 from asset_assignments x where x.asset_id = a.id and x.returned_date is null))
  union all
  select 'F HR assets: rows that disagree', 1702, '(note)', 'information only: Inventory does not correct these; HR does, before or after an import'

  -- G default privileges -------------------------------------------------------------------------------------------
  union all
  select 'G default privileges', 1800 + row_number() over (order by d.defaclrole::regrole::text, d.defaclobjtype::text),
         d.defaclrole::regrole::text || ' / ' || coalesce(d.defaclnamespace::regnamespace::text, '(all schemas)') || ' / ' || d.defaclobjtype::text,
         regexp_replace(d.defaclacl::text, '\s+', ' ', 'g')
  from pg_default_acl d

  -- H public tables without RLS ------------------------------------------------------------------------------------
  union all
  select 'H tables without RLS', 1900 + row_number() over (order by c.relname), c.relname, 'row-level security is OFF (information only; not changed)'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
  union all
  select 'H tables without RLS', 1999, '(end of list)', 'if there is no row above, every public table has RLS'

  -- I row counts that must not change ------------------------------------------------------------------------------
  union all select 'I HR, Sales and Projects row counts', 2000, 'companies', (select count(*)::text from companies)
  union all select 'I HR, Sales and Projects row counts', 2001, 'profiles', (select count(*)::text from profiles)
  union all select 'I HR, Sales and Projects row counts', 2002, 'user_roles', (select count(*)::text from user_roles)
  union all select 'I HR, Sales and Projects row counts', 2003, 'employees', (select count(*)::text from employees)
  union all select 'I HR, Sales and Projects row counts', 2004, 'assets', (select count(*)::text from assets)
  union all select 'I HR, Sales and Projects row counts', 2005, 'asset_assignments', (select count(*)::text from asset_assignments)
  union all select 'I HR, Sales and Projects row counts', 2006, 'audit_log', (select count(*)::text from audit_log)
  union all select 'I HR, Sales and Projects row counts', 2007, 'notifications', (select count(*)::text from notifications)
  union all select 'I HR, Sales and Projects row counts', 2008, 'crm_opportunities', (select count(*)::text from crm_opportunities)
  union all select 'I HR, Sales and Projects row counts', 2009, 'crm_company_grants (active)', (select count(*)::text from crm_company_grants where revoked_at is null)
  union all select 'I HR, Sales and Projects row counts', 2010, 'proj_projects', (select count(*)::text from proj_projects)
  union all select 'I HR, Sales and Projects row counts', 2011, 'proj_handovers', (select count(*)::text from proj_handovers)
  union all select 'I HR, Sales and Projects row counts', 2012, 'proj_project_members', (select count(*)::text from proj_project_members)
  union all select 'I HR, Sales and Projects row counts', 2013, 'proj_company_grants (active)', (select count(*)::text from proj_company_grants where revoked_at is null)
) q
order by ord;
