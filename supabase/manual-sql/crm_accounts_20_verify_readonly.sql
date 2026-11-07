-- READ-ONLY. Run AFTER 20261219000100_crm_clients_agencies.sql. One table (check | item | result | detail); every result must say OK (INFO is information only).
-- A FAIL means stop and send the whole result. It checks DEFINITIONS and PRIVILEGES; behaviour is proved by packages/rls-tests/test/crm-clients-agencies.rls.test.ts.

with newfns(name) as (values ('crm_can_edit_organisation'), ('crm_create_organisation_profile'), ('crm_update_organisation'), ('crm_save_account_profile'), ('crm_assign_account_owner'), ('crm_reassign_follow_up'), ('crm_import_fingerprints'), ('crm_import_apply'), ('crm_import_apply_item'), ('crm_create_account_follow_up'), ('crm_complete_follow_up'), ('crm_cancel_follow_up'), ('crm_reschedule_follow_up')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from newfns)),
checks as (
  select 1 as grp, 'function exists' as chk, n.name as item, case when f.oid is not null then 'OK' else 'FAIL' end as result, '' as detail from newfns n left join fn f on f.proname = n.name
  union all select 2, 'security definer, fixed search path', f.proname, case when f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%' then 'OK' else 'FAIL' end, coalesce(f.proconfig::text, 'none') from fn f
  union all select 3, 'signed-in users can call, anonymous cannot', f.proname, case when has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end, '' from fn f where f.proname <> 'crm_import_apply_item'
  union all select 4, 'column exists', c, case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_organisations' and column_name = c) then 'OK' else 'FAIL' end, ''
    from unnest(array['roles', 'country_code', 'website', 'website_domain']) c
  union all select 5, 'constraint exists', c, case when exists (select 1 from pg_constraint where conname = c) then 'OK' else 'FAIL' end, '' from unnest(array['crm_organisations_roles_valid', 'crm_organisations_country_format', 'crm_account_profiles_unique']) c
  union all select 6, 'role trigger exists', 'crm_organisations_sync_kind', case when exists (select 1 from pg_trigger where tgname = 'crm_organisations_sync_kind' and not tgisinternal) then 'OK' else 'FAIL' end, ''
  union all select 7, 'profile table: RLS on, SELECT policy only', 'crm_account_profiles',
         case when (select relrowsecurity from pg_class where oid = 'public.crm_account_profiles'::regclass)
                   and (select count(*) from pg_policies where tablename = 'crm_account_profiles') = 1
                   and (select cmd from pg_policies where tablename = 'crm_account_profiles') = 'SELECT' then 'OK' else 'FAIL' end, ''
  union all select 8, 'profile table: signed-in users can only SELECT, anonymous nothing', 'crm_account_profiles',
         case when has_table_privilege('authenticated', 'public.crm_account_profiles', 'select')
                   and not has_table_privilege('authenticated', 'public.crm_account_profiles', 'insert, update, delete')
                   and not has_table_privilege('anon', 'public.crm_account_profiles', 'select') then 'OK' else 'FAIL' end, ''
  union all select 9, 'assign needs assign_owner and an eligible person', 'crm_assign_account_owner',
         case when (select prosrc from fn where proname = 'crm_assign_account_owner') like '%crm_has_capability(p_company, ''assign_owner'')%' and (select prosrc from fn where proname = 'crm_assign_account_owner') like '%crm_user_has_company_access%' then 'OK' else 'FAIL' end, ''
  union all select 10, 'reassigning a follow-up does not touch an owner', 'crm_reassign_follow_up',
         case when (select prosrc from fn where proname = 'crm_reassign_follow_up') not like '%crm_account_profiles%' and (select prosrc from fn where proname = 'crm_reassign_follow_up') not like '%owner_id =%' then 'OK' else 'FAIL' end, ''
  union all select 11, 'organisations with no role recorded (name-only profiles are allowed to)', 'crm_organisations', 'INFO', (select count(*)::text || ' of ' || (select count(*) from crm_organisations)::text from crm_organisations where cardinality(roles) = 0)
  union all select 12, 'the older creator now records the role', 'crm_create_organisation', case when exists (select 1 from pg_proc where proname = 'crm_create_organisation' and prosrc like '%roles%array[p_kind]%') then 'OK' else 'FAIL' end, ''
  union all select 14, 'internal import helper is not callable by signed-in users', 'crm_import_apply_item', case when exists (select 1 from fn where proname = 'crm_import_apply_item' and not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')) then 'OK' else 'FAIL' end, ''
  union all select 15, 'import apply locks, is fill-only and compares the preview', 'crm_import_apply',
         case when (select prosrc from fn where proname = 'crm_import_apply') like '%pg_advisory_xact_lock%' and (select prosrc from fn where proname = 'crm_import_apply') like '%preview_stale%' and (select prosrc from fn where proname = 'crm_import_apply') like '%crm_import_batches%' then 'OK' else 'FAIL' end, ''
  union all select 16, 'import batches: RLS on, no policy, no direct access', 'crm_import_batches',
         case when (select relrowsecurity from pg_class where oid = 'public.crm_import_batches'::regclass)
                   and (select count(*) from pg_policies where tablename = 'crm_import_batches') = 0
                   and not has_table_privilege('authenticated', 'public.crm_import_batches', 'select, insert, update, delete')
                   and not has_table_privilege('anon', 'public.crm_import_batches', 'select') then 'OK' else 'FAIL' end, ''
  union all select 17, 'unique batch key per company; one contact e-mail per organisation', 'constraints',
         case when exists (select 1 from pg_constraint where conname = 'crm_import_batches_unique') and exists (select 1 from pg_indexes where indexname = 'uq_crm_contacts_org_email') then 'OK' else 'FAIL' end, ''
  union all select 18, 'inquiry parties are checked against organisation roles', 'crm_opportunities_party_roles', case when exists (select 1 from pg_trigger where tgname = 'crm_opportunities_party_roles' and not tgisinternal) then 'OK' else 'FAIL' end, ''
  union all select 19, 'follow-up can hang off an account', 'crm_follow_ups',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_follow_ups' and column_name = 'organisation_id')
                   and (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'crm_follow_ups' and column_name = 'opportunity_id') = 'YES'
                   and exists (select 1 from pg_constraint where conname = 'crm_follow_ups_target') then 'OK' else 'FAIL' end, ''
  union all select 20, 'account follow-up never reads or writes an account owner', 'crm_create_account_follow_up',
         case when (select prosrc from fn where proname = 'crm_create_account_follow_up') not like '%crm_account_profiles%' then 'OK' else 'FAIL' end, ''
  union all select 13, 'row counts', 'crm_account_profiles', 'INFO', (select count(*)::text from crm_account_profiles)
)
select chk as check, item, result, detail from checks
union all select 'SUMMARY', count(*)::text || ' checks', case when count(*) filter (where result = 'FAIL') = 0 then 'OK' else 'FAIL' end, count(*) filter (where result = 'FAIL')::text || ' failing' from checks
order by 1, 2;
