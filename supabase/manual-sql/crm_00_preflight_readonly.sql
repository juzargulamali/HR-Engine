-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the four Sales & CRM migrations
-- (20261115000000 ... 20261115000300). Run the WHOLE file; it returns ONE result table (section | item | detail).
-- It creates, changes and deletes nothing. Send me the full result (screenshot or Export -> CSV).
--
--   A  who is running this, server version
--   B  prerequisites the CRM migrations rely on (tables, functions, roles) - every row must say OK
--   C  existing CRM objects (there must be none: this is a first install)
--   D  your companies and what the migration would seed (reference code + default currency) for each
--   E  people who could be the first founders (active users holding a CEO or CTO role) - for the bootstrap script
--   F  default privileges on public tables (public privilege hardening, PR #30, should already be applied)
--   G  storage: the two buckets the migration creates must not exist yet; storage.objects must have row-level security on
--   H  public tables WITHOUT row-level security (information only)
--   I  row counts of the HR tables the CRM migrations must NOT change (information only; the real proof is crm_05_preservation_check_readonly.sql,
--      which separates legitimate concurrent HR activity from changes - run it BEFORE the migrations too)

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
  from (values ('companies'), ('countries'), ('profiles'), ('user_roles'), ('employees'), ('audit_log'), ('notifications')) as t(name)
  union all
  select 'B prerequisites', 200 + row_number() over (order by f.name), 'function public.' || f.name,
         case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name) then 'OK' else 'MISSING - stop and compare with the repository' end
  from (values ('set_updated_at'), ('has_role'), ('is_manager_of')) as f(name)
  union all
  select 'B prerequisites', 300 + row_number() over (order by r.name), 'role ' || r.name,
         case when exists (select 1 from pg_roles where rolname = r.name) then 'OK' else 'MISSING' end
  from (values ('anon'), ('authenticated'), ('service_role')) as r(name)
  union all
  select 'B prerequisites', 400, 'profiles.is_active column',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_active') then 'OK' else 'MISSING' end
  union all
  select 'B prerequisites', 401, 'companies.deleted_at column',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'deleted_at') then 'OK' else 'MISSING' end
  union all
  select 'B prerequisites', 402, 'previous migration 20261114000000 (public privilege hardening) effect',
         case when (select count(*) from pg_default_acl d where d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace) > 0 then 'OK (default privileges set)' else 'NOT SEEN - apply PR #30 first, or tell me why not' end

  -- C existing CRM objects -----------------------------------------------------------------------------------------
  union all
  select 'C existing CRM objects', 500 + row_number() over (order by c.relname), 'table ' || c.relname, 'ALREADY EXISTS - stop; this is meant to be a first install'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v') and c.relname like 'crm\_%'
  union all
  select 'C existing CRM objects', 600 + row_number() over (order by p.proname), 'function ' || p.proname, 'ALREADY EXISTS - stop; this is meant to be a first install'
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'crm\_%'
  union all
  select 'C existing CRM objects', 699, '(summary)',
         case when not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'crm\_%')
               and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'crm\_%')
              then 'OK - no CRM tables or functions exist yet' else 'CRM objects exist - see rows above' end

  -- D companies and the seeding forecast ---------------------------------------------------------------------------
  union all
  select 'D companies', 700 + row_number() over (order by c.country_code, c.legal_name),
         c.legal_name || ' (' || c.country_code || ')',
         'id ' || c.id || '; default currency ' || c.default_currency || '; active=' || c.is_active::text || '; deleted=' || (c.deleted_at is not null)::text
  from companies c
  union all
  select 'D seeding forecast', 800 + row_number() over (order by m.country),
         m.country || ' -> reference code ' || m.code || ', quote currency ' || m.currency,
         case (select count(*) from companies c where c.country_code = m.country and c.is_active and c.deleted_at is null)
           when 1 then 'WILL be seeded for: ' || (select c.legal_name from companies c where c.country_code = m.country and c.is_active and c.deleted_at is null)
           when 0 then 'No active company for this country: nothing is seeded (add settings later in Sales > Settings)'
           else (select count(*)::text from companies c where c.country_code = m.country and c.is_active and c.deleted_at is null)
                || ' active companies share this country: NOT seeded (never guessed); a founder sets them in Sales > Settings'
         end
  from (values ('AE', 'UAE', 'AED'), ('SA', 'KSA', 'SAR'), ('PL', 'PL', 'EUR')) as m(country, code, currency)
  union all
  select 'D seeding forecast', 899, 'companies that would get NO settings row',
         coalesce((select string_agg(c.legal_name || ' (' || c.country_code || ')', ', ' order by c.legal_name)
                   from companies c
                   where c.is_active and c.deleted_at is null and c.country_code not in ('AE', 'SA', 'PL')), 'none')
         || ' - a founder adds these in Sales > Settings if they should use Sales'

  -- E candidate founders -------------------------------------------------------------------------------------------
  union all
  select 'E candidate founders', 900 + row_number() over (order by p.email),
         coalesce(p.full_name, '(no name)') || ' <' || p.email || '>',
         'active=' || p.is_active::text || '; roles: ' || string_agg(distinct ur.role::text, ', ')
  from profiles p join user_roles ur on ur.user_id = p.id and ur.revoked_at is null and ur.role in ('ceo', 'cto')
  group by p.id, p.full_name, p.email, p.is_active
  union all
  select 'E candidate founders', 999, '(note)', 'CRM access is separate from these roles. Edit the emails in crm_30_bootstrap_founders.sql to name Juzar and Rafi.'

  -- F default privileges -------------------------------------------------------------------------------------------
  union all
  select 'F default privileges', 1000 + row_number() over (order by d.defaclrole::regrole::text, d.defaclobjtype::text),
         d.defaclrole::regrole::text || ' / ' || coalesce(d.defaclnamespace::regnamespace::text, '(all schemas)') || ' / ' || d.defaclobjtype::text,
         regexp_replace(d.defaclacl::text, '\s+', ' ', 'g')
  from pg_default_acl d

  -- G storage ------------------------------------------------------------------------------------------------------
  union all
  select 'G storage', 1100, 'buckets crm-files and crm-quarantine',
         case when to_regclass('storage.buckets') is null then 'storage.buckets not found - stop'
              when exists (select 1 from storage.buckets where id in ('crm-files', 'crm-quarantine')) then 'ALREADY EXISTS - stop; this is meant to be a first install'
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
  union all select 'I HR row counts', 1300, 'companies', (select count(*)::text from companies)
  union all select 'I HR row counts', 1301, 'profiles', (select count(*)::text from profiles)
  union all select 'I HR row counts', 1302, 'user_roles', (select count(*)::text from user_roles)
  union all select 'I HR row counts', 1303, 'employees', (select count(*)::text from employees)
  union all select 'I HR row counts', 1304, 'audit_log', (select count(*)::text from audit_log)
) q
order by ord;
