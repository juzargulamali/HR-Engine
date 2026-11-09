-- jarvis_10_execute_privileges_readonly.sql
-- Added with the corrective migration 20261223000200_jarvis_helper_privileges.sql. Run it any time after 20261223000100 (before the correction it shows the failing
-- grant; after the correction no row names service_role, anon, authenticated or PUBLIC on the four jarvis_ledger_* helpers).
-- READ-ONLY. One SELECT, no writes, no temporary objects, no function calls that change anything.
-- Shows, for every public.jarvis_* function (exact signature), who can EXECUTE it and why.
-- Run it in the Supabase SQL editor on hosted V2 and send back ALL rows (it contains no secrets).
--
-- section 1  the ACL entries stored on the function (grantee, grantor, whether it is the built-in default ACL)
-- section 2  every non-superuser role that can EXECUTE it right now (effective, including inheritance), and the grant that gives it that right
-- section 3  the default privileges that stamped those grants on the function when it was created (pg_default_acl)
-- section 4  the verifier's own four checks per function (authenticated, anon, public, service_role), so the FAIL rows can be matched one to one
with fn as (
  select p.oid,
         p.oid::regprocedure::text                         as signature,
         p.proowner,
         pg_get_userbyid(p.proowner)                       as owner,
         p.prosecdef                                       as security_definer,
         p.proacl is null                                  as acl_is_default,
         coalesce(p.proacl, acldefault('f', p.proowner))   as acl
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname like 'jarvis\_%'
),
entries as (
  select f.oid, f.signature, f.owner, f.security_definer, f.acl_is_default,
         a.grantee,
         case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee_name,
         pg_get_userbyid(a.grantor) as grantor_name,
         a.is_grantable
  from fn f
  cross join lateral aclexplode(f.acl) a
  where a.privilege_type = 'EXECUTE'
),
can_run as (
  select f.oid, f.signature, f.owner, r.oid as role_oid, r.rolname
  from fn f
  cross join pg_roles r
  where not r.rolsuper
    and r.rolname !~ '^pg_'
    and has_function_privilege(r.oid, f.oid, 'execute')
)
select 1 as section,
       e.signature                                          as function,
       e.grantee_name                                       as role,
       'ACL entry: EXECUTE granted by ' || e.grantor_name
         || case when e.is_grantable then ' (with grant option)' else '' end
         || case when e.acl_is_default then ' [function has NO explicit ACL: this is the built-in default, PUBLIC may execute]' else '' end as detail
from entries e

union all
select 2,
       c.signature,
       c.rolname,
       'CAN EXECUTE via: '
         || coalesce(
              (select string_agg(distinct
                        case when e.grantee = 0 then 'PUBLIC grant'
                             when e.grantee = c.role_oid then 'explicit grant to ' || e.grantee_name || ' (grantor ' || e.grantor_name || ')'
                             else 'membership of ' || e.grantee_name || ' (grant by ' || e.grantor_name || ')' end,
                      '; ')
                 from entries e
                where e.oid = c.oid
                  and (e.grantee = 0 or pg_has_role(c.role_oid, e.grantee, 'usage'))),
              'ownership / other')
from can_run c

union all
select 3,
       '(default privileges for new functions)',
       pg_get_userbyid(d.defaclrole),
       'schema ' || coalesce(nullif(d.defaclnamespace::regnamespace::text, '-'), '(all schemas)')
         || ' grants EXECUTE to ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
         || ' (grantor ' || pg_get_userbyid(a.grantor) || ')'
from pg_default_acl d
cross join lateral aclexplode(d.defaclacl) a
where d.defaclobjtype = 'f'
  and a.privilege_type = 'EXECUTE'

union all
select 4,
       f.signature,
       'verifier checks',
       'authenticated=' || has_function_privilege('authenticated', f.oid, 'execute')::text
         || ' anon=' || has_function_privilege('anon', f.oid, 'execute')::text
         || ' PUBLIC=' || exists (select 1 from entries e where e.oid = f.oid and e.grantee = 0)::text
         || ' service_role=' || has_function_privilege('service_role', f.oid, 'execute')::text
         || ' | owner=' || f.owner || ' security_definer=' || f.security_definer::text
from fn f

order by 1, 2, 3, 4;
