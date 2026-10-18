-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the six Projects & Tasks migrations
-- (20261120000000 ... 20261120000500). Run the WHOLE file; it returns ONE result table (section | item | detail).
-- It creates, changes and deletes nothing. Send me the full result (screenshot or Export -> CSV).
--
--   A  who is running this, server version
--   B  prerequisites the Projects migrations rely on (tables, functions, roles, the Sales & CRM install) - every row must say OK
--   C  existing Projects objects (there must be none: this is a first install)
--   D  your companies and what the migration would seed (the Projects reference code is copied from Sales settings)
--   E  people who are Sales founders today (the natural first Projects founders) and candidates by HR role - for the bootstrap script
--   F  default privileges on public tables (public privilege hardening should already be applied)
--   G  storage: the two buckets the migration creates must not exist yet; storage.objects must have row-level security on
--   H  public tables WITHOUT row-level security (information only)
--   I  row counts of the HR and Sales tables the Projects migrations must NOT change (information only; the real proof is
--      proj_05_preservation_check_readonly.sql, which separates legitimate concurrent activity from changes - run it BEFORE too)
--   J  the legacy projects / project_allocations tables, which stay exactly as they are (information only)

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
               ('crm_company_grants'), ('crm_company_settings'), ('crm_opportunities'), ('crm_organisations'), ('crm_handovers'),
               ('projects'), ('project_allocations')) as t(name)
  union all
  select 'B prerequisites', 200 + row_number() over (order by f.name), 'function public.' || f.name,
         case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name) then 'OK' else 'MISSING - stop and compare with the repository' end
  from (values ('set_updated_at'), ('crm_has_access'), ('crm_is_founder'), ('crm_file_name_blocked'), ('crm_allowed_mime_types')) as f(name)
  union all
  select 'B prerequisites', 300 + row_number() over (order by r.name), 'role ' || r.name,
         case when exists (select 1 from pg_roles where rolname = r.name) then 'OK' else 'MISSING' end
  from (values ('anon'), ('authenticated'), ('service_role')) as r(name)
  union all
  select 'B prerequisites', 400, 'profiles.is_active column',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_active') then 'OK' else 'MISSING' end
  union all
  select 'B prerequisites', 401, 'crm_opportunities.stage column (a handover needs a Won opportunity)',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_opportunities' and column_name = 'stage') then 'OK' else 'MISSING' end
  union all
  select 'B prerequisites', 402, 'Sales & CRM installed (migrations 20261115000000-300): crm_company_grants has rows or exists',
         case when to_regclass('public.crm_company_grants') is not null then 'OK' else 'MISSING - install Sales & CRM first' end
  union all
  select 'B prerequisites', 403, 'public privilege hardening (20261114000000) effect',
         case when (select count(*) from pg_default_acl d where d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace) > 0 then 'OK (default privileges set)' else 'NOT SEEN - apply public privilege hardening first, or tell me why not' end

  -- C existing Projects objects ------------------------------------------------------------------------------------
  union all
  select 'C existing Projects objects', 500 + row_number() over (order by c.relname), 'table ' || c.relname, 'ALREADY EXISTS - stop; this is meant to be a first install'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v') and c.relname like 'proj\_%'
  union all
  select 'C existing Projects objects', 600 + row_number() over (order by p.proname), 'function ' || p.proname, 'ALREADY EXISTS - stop; this is meant to be a first install'
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'proj\_%'
  union all
  select 'C existing Projects objects', 699, '(summary)',
         case when not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'proj\_%')
               and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'proj\_%')
              then 'OK - no Projects tables or functions exist yet' else 'Projects objects exist - see rows above' end

  -- D companies and the seeding forecast ---------------------------------------------------------------------------
  union all
  select 'D companies', 700 + row_number() over (order by c.country_code, c.legal_name),
         c.legal_name || ' (' || c.country_code || ')',
         'id ' || c.id || '; active=' || c.is_active::text || '; deleted=' || (c.deleted_at is not null)::text
  from companies c
  union all
  select 'D seeding forecast', 800 + row_number() over (order by c.legal_name),
         c.legal_name,
         case when s.reference_code is not null then 'Projects reference code WILL be copied from Sales: ' || s.reference_code || ' (first project: ' || s.reference_code || '-P-' || extract(year from now() at time zone 'Asia/Dubai')::int || '-0001)'
              else 'no Sales settings row: a founder sets the Projects reference code in Projects > Access before any project can be created' end
  from companies c left join crm_company_settings s on s.company_id = c.id
  where c.is_active and c.deleted_at is null

  -- E candidate founders -------------------------------------------------------------------------------------------
  union all
  select 'E Sales founders today', 900 + row_number() over (order by p.email),
         coalesce(p.full_name, '(no name)') || ' <' || p.email || '>',
         'Sales founder for ' || string_agg(distinct c.legal_name, ', ') || '; active=' || p.is_active::text
  from crm_company_grants g join profiles p on p.id = g.user_id join companies c on c.id = g.company_id
  where g.revoked_at is null and 'founder' = any (g.capabilities)
  group by p.id, p.full_name, p.email, p.is_active
  union all
  select 'E candidate founders by HR role', 950 + row_number() over (order by p.email),
         coalesce(p.full_name, '(no name)') || ' <' || p.email || '>',
         'active=' || p.is_active::text || '; roles: ' || string_agg(distinct ur.role::text, ', ')
  from profiles p join user_roles ur on ur.user_id = p.id and ur.revoked_at is null and ur.role in ('ceo', 'cto')
  group by p.id, p.full_name, p.email, p.is_active
  union all
  select 'E candidate founders', 999, '(note)', 'Projects access is separate from HR roles and from Sales access. Edit the emails in proj_30_bootstrap_founders.sql to name the founders.'

  -- F default privileges -------------------------------------------------------------------------------------------
  union all
  select 'F default privileges', 1000 + row_number() over (order by d.defaclrole::regrole::text, d.defaclobjtype::text),
         d.defaclrole::regrole::text || ' / ' || coalesce(d.defaclnamespace::regnamespace::text, '(all schemas)') || ' / ' || d.defaclobjtype::text,
         regexp_replace(d.defaclacl::text, '\s+', ' ', 'g')
  from pg_default_acl d

  -- G storage ------------------------------------------------------------------------------------------------------
  union all
  select 'G storage', 1100, 'buckets proj-files and proj-quarantine',
         case when to_regclass('storage.buckets') is null then 'storage.buckets not found - stop'
              when exists (select 1 from storage.buckets where id in ('proj-files', 'proj-quarantine')) then 'ALREADY EXISTS - stop; this is meant to be a first install'
              else 'OK - neither exists yet' end
  union all
  select 'G storage', 1101, 'row-level security on storage.objects',
         case when to_regclass('storage.objects') is null then 'storage.objects not found - stop'
              when (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then 'OK - on' else 'OFF - tell me before continuing' end

  -- H public tables without RLS ------------------------------------------------------------------------------------
  union all
  select 'H tables without RLS', 1200 + row_number() over (order by c.relname), c.relname, 'row-level security is OFF (information only; not changed)'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
  union all
  select 'H tables without RLS', 1299, '(end of list)', 'if there is no row above, every public table has RLS'

  -- I row counts that must not change -----------------------------------------------------------------------------
  union all select 'I HR and Sales row counts', 1300, 'companies', (select count(*)::text from companies)
  union all select 'I HR and Sales row counts', 1301, 'profiles', (select count(*)::text from profiles)
  union all select 'I HR and Sales row counts', 1302, 'user_roles', (select count(*)::text from user_roles)
  union all select 'I HR and Sales row counts', 1303, 'employees', (select count(*)::text from employees)
  union all select 'I HR and Sales row counts', 1304, 'audit_log', (select count(*)::text from audit_log)
  union all select 'I HR and Sales row counts', 1305, 'notifications', (select count(*)::text from notifications)
  union all select 'I HR and Sales row counts', 1306, 'crm_opportunities', (select count(*)::text from crm_opportunities)
  union all select 'I HR and Sales row counts', 1307, 'crm_handovers', (select count(*)::text from crm_handovers)
  union all select 'I HR and Sales row counts', 1308, 'crm_company_grants (active)', (select count(*)::text from crm_company_grants where revoked_at is null)

  -- J legacy projects ----------------------------------------------------------------------------------------------
  union all select 'J legacy projects (untouched)', 1400, 'projects rows', (select count(*)::text from projects)
  union all select 'J legacy projects (untouched)', 1401, 'project_allocations rows', (select count(*)::text from project_allocations)
  union all
  select 'J legacy projects (untouched)', 1402, 'policies on projects / project_allocations',
         coalesce((select string_agg(tablename || ':' || policyname || ':' || cmd, '; ' order by tablename, policyname) from pg_policies where schemaname = 'public' and tablename in ('projects', 'project_allocations')), 'none')
) q
order by ord;
