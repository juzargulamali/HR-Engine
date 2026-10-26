-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the Project Budget & Expenses migrations
-- (20261210000000, 000100, 000200, 000300, 000400). Run the WHOLE file; it returns ONE result table (section | item | detail).
-- It creates, changes and deletes nothing. Send me the full result (screenshot or Export -> CSV).
--
--   A  who is running this, server version
--   B  prerequisites the migrations rely on (tables, columns, functions, roles, the Projects & Tasks install) - every row must say OK
--   C  existing Project Budget & Expenses objects (there must be none: this is a first install)
--   D  your companies and how many projects, reimbursement claims and project members they have (information only)
--   E  people who could be named Finance people or CEO / CTO approvers: holders of the HR "finance", "ceo" and "cto" roles and of Projects founder access.
--      INFORMATION ONLY.
--      Nobody is ever chosen for you: budget access is a separate grant that you name in pbx_30_bootstrap_access.sql
--   F  default privileges on public tables
--   G  public tables WITHOUT row-level security (information only)
--   H  row counts of the tables this install must NOT change (information only; the real proof is pbx_05_preservation_check_readonly.sql,
--      which separates legitimate concurrent activity from changes - run it BEFORE too)
--
-- HOW TO READ IT: section B must be OK on every row, section C must say "OK - no Project Budget & Expenses objects exist yet".

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
  from (values ('companies'), ('profiles'), ('user_roles'), ('employees'), ('notifications'), ('reimbursement_claims'),
               ('proj_company_grants'), ('proj_projects'), ('proj_project_details'), ('proj_project_members')) as t(name)
  union all
  select 'B prerequisites', 200 + row_number() over (order by f.name), 'function public.' || f.name,
         case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name) then 'OK' else 'MISSING - stop and compare with the repository' end
  from (values ('proj_is_pm'), ('proj_display_name'), ('set_updated_at')) as f(name)
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
               ('employees', 'user_id'), ('reimbursement_claims', 'employee_id'), ('reimbursement_claims', 'status'),
               ('notifications', 'user_id'), ('notifications', 'type'), ('notifications', 'payload'),
               ('proj_projects', 'company_id'), ('proj_projects', 'pm_user_id'), ('proj_projects', 'reference'), ('proj_projects', 'name'),
               ('proj_projects', 'status'), ('proj_projects', 'start_date'), ('proj_projects', 'end_date'),
               ('proj_project_details', 'location'), ('proj_project_details', 'site_timezone'), ('proj_project_details', 'install_start'),
               ('proj_project_details', 'event_start'), ('proj_project_details', 'event_end'),
               ('proj_project_members', 'project_id'), ('proj_project_members', 'user_id')) as c(tbl, col)
  union all
  select 'B prerequisites', 501, 'Projects & Tasks installed (migrations 20261120000000-600)',
         case when to_regclass('public.proj_company_grants') is not null and to_regclass('public.proj_projects') is not null then 'OK' else 'MISSING - install Projects & Tasks first' end
  union all
  select 'B prerequisites', 502, 'public privilege hardening (20261114000000) effect',
         case when (select count(*) from pg_default_acl d where d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace) > 0 then 'OK (default privileges set)' else 'NOT SEEN - apply public privilege hardening first, or tell me why not' end

  -- C existing Project Budget & Expenses objects -------------------------------------------------------------------
  union all
  select 'C existing objects', 600 + row_number() over (order by c.relname), 'table ' || c.relname, 'ALREADY EXISTS - stop; this is meant to be a first install'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S') and c.relname like 'pbx\_%'
  union all
  select 'C existing objects', 700 + row_number() over (order by p.proname), 'function ' || p.proname, 'ALREADY EXISTS - stop; this is meant to be a first install'
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'pbx\_%'
  union all
  select 'C existing objects', 899, '(summary)',
         case when not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'pbx\_%')
               and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'pbx\_%')
              then 'OK - no Project Budget & Expenses objects exist yet' else 'objects exist - see rows above' end

  -- D companies and what they hold ---------------------------------------------------------------------------------
  union all
  select 'D companies', 900 + row_number() over (order by c.legal_name),
         c.legal_name,
         'id ' || c.id || '; active=' || c.is_active::text || '; projects=' || (select count(*) from proj_projects p where p.company_id = c.id)::text
         || '; projects with a PM=' || (select count(*) from proj_projects p where p.company_id = c.id and p.pm_user_id is not null)::text
  from companies c where c.deleted_at is null
  union all
  select 'D claims', 1000, 'reimbursement claims by status (information; this install only reads them to validate a link, never changes them)',
         coalesce((select string_agg(x.status || '=' || x.n, ', ' order by x.status) from (select status::text as status, count(*)::text as n from reimbursement_claims group by status) x), '(none)')

  -- E who could be the first Finance approvers (information only) --------------------------------------------------
  union all
  select 'E HR finance role holders today', 1100 + row_number() over (order by p.email),
         coalesce(p.full_name, '(no name)') || ' <' || p.email || '>',
         'HR role finance in ' || string_agg(distinct c.legal_name, ', ') || '; active=' || p.is_active::text
  from user_roles ur join profiles p on p.id = ur.user_id left join companies c on c.id = ur.company_id
  where ur.revoked_at is null and ur.role::text = 'finance'
  group by p.id, p.full_name, p.email, p.is_active
  union all
  select 'E CEO / CTO by HR role today', 1150 + row_number() over (order by p.email),
         coalesce(p.full_name, '(no name)') || ' <' || p.email || '>',
         'HR role ' || string_agg(distinct ur.role::text, ', ') || '; active=' || p.is_active::text || ' (a title is NOT used for budget approval: an explicit executive_approver grant is)'
  from user_roles ur join profiles p on p.id = ur.user_id
  where ur.revoked_at is null and ur.role::text in ('ceo', 'cto')
  group by p.id, p.full_name, p.email, p.is_active
  union all
  select 'E Projects founders today', 1200 + row_number() over (order by p.email),
         coalesce(p.full_name, '(no name)') || ' <' || p.email || '>',
         'Projects founder for ' || string_agg(distinct c.legal_name, ', ') || '; active=' || p.is_active::text
  from proj_company_grants g join profiles p on p.id = g.user_id join companies c on c.id = g.company_id
  where g.revoked_at is null and 'founder' = any (g.capabilities)
  group by p.id, p.full_name, p.email, p.is_active
  union all
  select 'E candidates', 1399, '(note)',
         'INFORMATION ONLY. Budget access is separate from HR roles, Projects access, Sales and Inventory, and nobody receives it automatically (no CEO, CTO, HR Admin, System Admin, HR finance role or test account). You name the people yourself in pbx_30_bootstrap_access.sql: Finance people (one is enough for budgets submitted by ordinary Project Managers) and, per company, the authorised CEO / CTO approver(s) who decide what Finance people submit.'

  -- F default privileges -------------------------------------------------------------------------------------------
  union all
  select 'F default privileges', 1800 + row_number() over (order by d.defaclrole::regrole::text, d.defaclobjtype::text),
         d.defaclrole::regrole::text || ' / ' || coalesce(d.defaclnamespace::regnamespace::text, '(all schemas)') || ' / ' || d.defaclobjtype::text,
         regexp_replace(d.defaclacl::text, '\s+', ' ', 'g')
  from pg_default_acl d

  -- G public tables without RLS ------------------------------------------------------------------------------------
  union all
  select 'G tables without RLS', 1900 + row_number() over (order by c.relname), c.relname, 'row-level security is OFF (information only; not changed)'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
  union all
  select 'G tables without RLS', 1999, '(end of list)', 'if there is no row above, every public table has RLS'

  -- H row counts that must not change ------------------------------------------------------------------------------
  union all select 'H row counts', 2000, 'companies', (select count(*)::text from companies)
  union all select 'H row counts', 2001, 'profiles', (select count(*)::text from profiles)
  union all select 'H row counts', 2002, 'user_roles', (select count(*)::text from user_roles)
  union all select 'H row counts', 2003, 'employees', (select count(*)::text from employees)
  union all select 'H row counts', 2004, 'reimbursement_claims', (select count(*)::text from reimbursement_claims)
  union all select 'H row counts', 2005, 'notifications', (select count(*)::text from notifications)
  union all select 'H row counts', 2006, 'proj_projects', (select count(*)::text from proj_projects)
  union all select 'H row counts', 2007, 'proj_project_members', (select count(*)::text from proj_project_members)
  union all select 'H row counts', 2008, 'proj_company_grants (active)', (select count(*)::text from proj_company_grants where revoked_at is null)
) q
order by ord;
