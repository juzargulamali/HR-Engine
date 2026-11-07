-- READ-ONLY. Run BEFORE and again AFTER 20261219000100_crm_clients_agencies.sql, keep both results, and compare the two `paste` columns.
-- Everything that existed before must be UNCHANGED, except: crm_create_organisation (it now also records the role), crm_complete_follow_up, crm_reschedule_follow_up
-- and crm_cancel_follow_up (each gained one branch for a follow-up on an account with no inquiry), the organisations table (new columns), crm_follow_ups
-- (opportunity_id may be empty, organisation_id added)
-- Pre-inquiry outreach (section 8) adds only NEW tables and functions and changes nothing that exists: no further difference is expected for it. and crm_opportunities (one new trigger that checks organisation roles).
-- It creates, changes and deletes nothing. One table: item | paste.

with fns as (
  select p.proname, md5(pg_get_functiondef(p.oid)) fp,
         has_function_privilege('authenticated', p.oid, 'execute') auth_exec, has_function_privilege('anon', p.oid, 'execute') anon_exec
  from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('crm_assign_owner', 'crm_create_follow_up', 'crm_update_contact', 'crm_can_edit_contact', 'crm_create_contact', 'crm_create_opportunity',
                      'crm_reschedule_follow_up', 'crm_cancel_follow_up', 'crm_complete_follow_up', 'crm_people', 'crm_has_access', 'crm_has_capability', 'crm_create_organisation')
), pol as (
  select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename like 'crm\_%' escape '\'
), grants as (
  select table_name, string_agg(privilege_type, ',' order by privilege_type) privs from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated' and table_name like 'crm\_%' escape '\' group by table_name
)
select 'fn:' || proname as item, fp || ' auth=' || auth_exec || ' anon=' || anon_exec as paste from fns
union all select 'policy:' || tablename || '.' || policyname, cmd from pol
union all select 'grant:' || table_name, privs from grants
union all select 'rows:' || t, (xpath('/row/c/text()', query_to_xml('select count(*) c from ' || t, false, true, '')))[1]::text
  from unnest(array['crm_organisations', 'crm_contacts', 'crm_opportunities', 'crm_follow_ups', 'crm_company_grants']) t
order by 1;
