-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE migration 20261114000000.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It changes nothing.
-- Send me the full result (screenshot or Export -> CSV).
--
--   A  who is running this, server version
--   B  default privileges (what NEW tables receive automatically)
--   C  who owns the public tables (the migration can only change tables the running role may act as)
--   D  how many public tables grant each risky privilege (TRUNCATE / TRIGGER / REFERENCES / MAINTAIN), to whom, granted by whom
--   E  the tables concerned, per risky privilege and role
--   F  other (non-public) schemas where anon / authenticated hold TRUNCATE (information only; NOT changed)
--   G  functions callable by anon / authenticated that could expose or bypass these privileges
--   H  public tables WITHOUT row-level security (information only)
--   I  fingerprint of the ordinary privileges (SELECT / INSERT / UPDATE / DELETE) of anon, authenticated, service_role
--      on every public table: the migration must leave it IDENTICAL (compare with the "after" run)

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all
  select 'A session', 2, 'server_version', version()
  union all
  select 'B default privileges', 10 + row_number() over (order by d.defaclrole::regrole::text, d.defaclobjtype::text), d.defaclrole::regrole::text || ' / ' || coalesce(d.defaclnamespace::regnamespace::text, '(all schemas)') || ' / ' || d.defaclobjtype::text,
         regexp_replace(d.defaclacl::text, '\s+', ' ', 'g')
  from pg_default_acl d
  union all
  select 'B default privileges', 99, '(end of list)', 'new tables created by a role with no row above get only the built-in default'
  union all
  select 'C table owners', 100 + row_number() over (order by pg_get_userbyid(c.relowner)), pg_get_userbyid(c.relowner),
         count(*) || ' public tables; this session can change them: ' || bool_and(pg_has_role(current_user, c.relowner, 'USAGE'))::text
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') group by c.relowner
  union all
  select 'D risky privileges', 200 + row_number() over (order by s.priv, s.grantee, s.grantor),
         s.priv || ' -> ' || s.grantee || ' (granted by ' || s.grantor || ')', count(distinct s.relname) || ' public tables'
  from (
    select c.relname, x.privilege_type as priv, case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee, pg_get_userbyid(x.grantor) as grantor
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and x.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
      and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated'))
  ) s group by s.priv, s.grantee, s.grantor
  union all
  select 'D risky privileges', 299, '(end of list)', 'if there is no row above, nothing to change'
  union all
  select 'E tables', 300 + row_number() over (order by s.priv, s.grantee), s.priv || ' -> ' || s.grantee, string_agg(s.relname, ', ' order by s.relname)
  from (
    select c.relname, x.privilege_type as priv, case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and x.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
      and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated'))
  ) s group by s.priv, s.grantee
  union all
  select 'F other schemas', 400 + row_number() over (order by n.nspname), n.nspname, count(*) || ' tables where anon or authenticated can TRUNCATE (not changed by this migration)'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname not in ('public', 'pg_catalog', 'information_schema')
    and (has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
  group by n.nspname
  union all
  select 'F other schemas', 449, '(end of list)', 'if there is no row above, no other schema is affected'
  union all
  select 'G functions', 500 + row_number() over (order by p.proname), p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         format('A_mentions TRUNCATE or table DDL; security_definer=%s owner=%s search_path=%s anon_can_run=%s authenticated_can_run=%s',
                p.prosecdef, pg_get_userbyid(p.proowner), coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '(not set)'),
                has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    and (p.prosrc ~* '\mtruncate\M' or p.prosrc ~* '\m(create|alter|drop)\s+(table|trigger)\M' or p.prosrc ~* '\m(create|alter|drop)\s+policy\s+\S+\s+on\M' or p.prosrc ~* '\m(grant|revoke)\s+[a-z, ]+\s+on\s+')
  union all
  select 'G functions', 600 + row_number() over (order by p.proname), p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         format('B_uses dynamic SQL (EXECUTE); security_definer=%s owner=%s search_path=%s anon_can_run=%s authenticated_can_run=%s',
                p.prosecdef, pg_get_userbyid(p.proowner), coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '(not set)'),
                has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    and p.prosrc ~* '\mexecute\s'
  union all
  select 'G functions', 700 + row_number() over (order by p.proname), p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'C_security definer WITHOUT a fixed search_path; owner=' || pg_get_userbyid(p.proowner)
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  union all
  select 'G functions', 799, '(end of list)', 'A = mentions TRUNCATE/DDL, B = dynamic SQL, C = no fixed search_path; no row of a letter above = none of that kind'
  union all
  select 'H no row-level security', 800 + row_number() over (order by c.relname), c.relname, 'row-level security is OFF'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
  union all
  select 'H no row-level security', 899, '(end of list)', 'if there is no row above, every public table has row-level security on'
  union all
  select 'I fingerprint', 900, 'ordinary privileges (anon / authenticated / service_role)',
         format('tables=%s grants=%s md5=%s', count(distinct s.relname), count(*), md5(coalesce(string_agg(s.relname || '|' || s.grantee || '|' || s.priv, ';' order by s.relname, s.grantee, s.priv), '')))
  from (
    select c.relname, pg_get_userbyid(x.grantee) as grantee, x.privilege_type as priv
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and x.grantee <> 0 and pg_get_userbyid(x.grantee) in ('anon', 'authenticated', 'service_role')
      and x.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) s
  union all
  select 'I fingerprint', 901, 'service_role: every privilege it holds (must be identical after)',
         format('grants=%s md5=%s', count(*), md5(coalesce(string_agg(s.relname || '|' || s.priv, ';' order by s.relname, s.priv), '')))
  from (
    select c.relname, x.privilege_type as priv
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_get_userbyid(x.grantee) = 'service_role'
  ) s
) q order by ord;
