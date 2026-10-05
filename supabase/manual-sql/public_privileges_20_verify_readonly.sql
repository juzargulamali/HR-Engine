-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER applying migration 20261114000000.
-- Run the WHOLE file; it returns ONE result table (status | check | detail). It changes nothing.
-- Every line should say PASS (INFO lines are for comparing with the preflight run, section I).
-- Anything saying FAIL or REVIEW: send me the whole table and do not carry on.

select status, check_name, detail from (
  select 1 as ord,
         case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
         'no public table grants TRUNCATE / TRIGGER / REFERENCES / MAINTAIN to anon, authenticated or PUBLIC' as check_name,
         case when count(*) = 0 then 'none left' else count(*) || ' grants left, e.g. ' || min(s.relname) || ' -> ' || min(s.grantee) || ' ' || min(s.priv) end as detail
  from (
    select c.relname, x.privilege_type as priv, case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and x.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
      and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated'))
  ) s
  union all
  select 2, case when count(*) = 0 then 'PASS' else 'REVIEW' end, 'every public table was changeable by the role that ran the migration',
         case when count(*) = 0 then 'none skipped' else count(*) || ' tables owned by another role, e.g. ' || min(c.relname) || ' (owner ' || min(pg_get_userbyid(c.relowner)) || ')' end
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_get_userbyid(c.relowner) not in ('postgres')
  union all
  select 3, case when not exists (
                  select 1 from pg_default_acl d, lateral aclexplode(d.defaclacl) x
                  where d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace and pg_get_userbyid(d.defaclrole) = 'postgres'
                    and pg_get_userbyid(x.grantee) in ('anon', 'authenticated') and x.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'))
                then 'PASS' else 'FAIL' end,
         'tables created in future by postgres will NOT grant those privileges to anon / authenticated', 'default privileges of role postgres in schema public'
  union all
  select 3.5, case when not exists (
                  select 1 from pg_default_acl d, lateral aclexplode(d.defaclacl) x
                  where d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace and pg_get_userbyid(d.defaclrole) <> 'postgres'
                    and pg_get_userbyid(x.grantee) in ('anon', 'authenticated') and x.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'))
                then 'PASS' else 'REVIEW' end,
         'no OTHER role (for example supabase_admin) hands those privileges to new tables in schema public',
         coalesce((select string_agg(distinct pg_get_userbyid(d.defaclrole), ', ') from pg_default_acl d, lateral aclexplode(d.defaclacl) x
                   where d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace and pg_get_userbyid(d.defaclrole) <> 'postgres'
                     and pg_get_userbyid(x.grantee) in ('anon', 'authenticated') and x.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')),
                  'none; if REVIEW, send me the row: those defaults belong to another role and only matter if that role creates your tables')
  union all
  select 4, case when exists (
                  select 1 from pg_default_acl d, lateral aclexplode(d.defaclacl) x
                  where d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace and pg_get_userbyid(d.defaclrole) = 'postgres'
                    and pg_get_userbyid(x.grantee) = 'authenticated' and x.privilege_type = 'SELECT')
                then 'PASS' else 'REVIEW' end,
         'future tables still get the normal SELECT / INSERT / UPDATE / DELETE defaults', 'otherwise new tables would need explicit grants'
  union all
  select 5, case when count(*) = 0 then 'PASS' else 'FAIL' end, 'service_role still holds ALL ordinary privileges on every public table',
         case when count(*) = 0 then 'yes' else count(*) || ' tables missing a privilege, e.g. ' || min(c.relname) end
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and not (has_table_privilege('service_role', c.oid, 'SELECT') and has_table_privilege('service_role', c.oid, 'INSERT')
             and has_table_privilege('service_role', c.oid, 'UPDATE') and has_table_privilege('service_role', c.oid, 'DELETE'))
  union all
  select 6, case when count(*) = 0 then 'PASS' else 'REVIEW' end, 'every public table has row-level security on',
         'tables with it OFF: ' || count(*) || ' (REVIEW only if this is MORE than the list in preflight section H; the migration does not touch row-level security)'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
  union all
  select 7, case when count(*) = 0 then 'PASS' else 'FAIL' end, 'no function callable by anon / authenticated mentions TRUNCATE or table DDL',
         case when count(*) = 0 then 'none' else string_agg(p.proname, ', ') end
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    and (p.prosrc ~* '\mtruncate\M' or p.prosrc ~* '\m(create|alter|drop)\s+(table|trigger)\M' or p.prosrc ~* '\m(create|alter|drop)\s+policy\s+\S+\s+on\M' or p.prosrc ~* '\m(grant|revoke)\s+[a-z, ]+\s+on\s+')
  union all
  select 20, 'INFO', 'ordinary privileges fingerprint (compare with preflight section I, first line)',
         format('tables=%s grants=%s md5=%s', count(distinct s.relname), count(*), md5(coalesce(string_agg(s.relname || '|' || s.grantee || '|' || s.priv, ';' order by s.relname, s.grantee, s.priv), '')))
  from (
    select c.relname, pg_get_userbyid(x.grantee) as grantee, x.privilege_type as priv
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and x.grantee <> 0 and pg_get_userbyid(x.grantee) in ('anon', 'authenticated', 'service_role')
      and x.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) s
  union all
  select 21, 'INFO', 'service_role privileges fingerprint (compare with preflight section I, second line)',
         format('grants=%s md5=%s', count(*), md5(coalesce(string_agg(s.relname || '|' || s.priv, ';' order by s.relname, s.priv), '')))
  from (
    select c.relname, x.privilege_type as priv
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and pg_get_userbyid(x.grantee) = 'service_role'
  ) s
) q order by ord, status, check_name;
