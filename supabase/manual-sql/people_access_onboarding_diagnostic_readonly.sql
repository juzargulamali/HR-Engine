-- READ ONLY. Changes nothing. Run in the Supabase SQL editor to see exactly why a person can add employees and edit
-- profiles but still hands invitations, HR role assignment and module access back to the owner.
-- Before running: replace the one address below (the only edit you make). Leave the quotes.
-- Reads: user_roles, the four module grant tables, profiles, employees, companies. Writes nothing.
--
-- How to read it: section A lists the person's live roles with their company scope. Section B lists their module rights. Section C gives one verdict per action, using the same checks the app and the database use:
--   * Invite / link a login ......... app: an HR Admin of the employee's company (a company-limited HR Admin is enough), or an unrestricted System Administrator (a System Administrator grant with NO company).
--                                     A System Administrator grant limited to one company does not count on its own.
--   * Give Employee / Reporting Manager  database: user_roles_insert_hr_admin_employee (migration 20270118000300): an HR Admin of the company, for that company, to the login of an active employee of that company.
--   * Give HR Admin, Finance, CEO, CTO or System Administrator  database: only an unrestricted System Administrator (user_roles_insert_sysadmin).
--   * Give module access ............ database: the crm/proj/inv/pbx grant functions need a founder or an access manager of that module for that company.
--   * Add an employee / edit a profile  an HR Admin of the employee's company (a company-limited HR Admin is enough).
-- Row C0 says whether the HR Admin role policy is installed: until the migration is applied, the verdict for the Employee / Reporting Manager roles says so.

with target as (
  select p.id as user_id, p.email, p.full_name, p.is_active
  from profiles p
  where lower(p.email) = lower('PUT-THE-PERSONS-EMAIL-HERE@example.com')   -- <<< the only edit
),
roles as (
  select r.user_id, r.role::text as role, r.company_id, c.legal_name as company_name, r.country_code, r.granted_at
  from user_roles r join target t on t.user_id = r.user_id
  left join companies c on c.id = r.company_id
  where r.revoked_at is null
),
grants as (
  select 'Sales & CRM' as module, g.company_id, g.capabilities from crm_company_grants g join target t on t.user_id = g.user_id where g.revoked_at is null
  union all select 'Projects', g.company_id, g.capabilities from proj_company_grants g join target t on t.user_id = g.user_id where g.revoked_at is null
  union all select 'Inventory', g.company_id, g.capabilities from inv_company_grants g join target t on t.user_id = g.user_id where g.revoked_at is null
  union all select 'Project Budget & Expenses', g.company_id, g.capabilities from pbx_company_grants g join target t on t.user_id = g.user_id where g.revoked_at is null
)
select * from (
  select 0 as ord, 'A0 account' as section,
         coalesce((select email || ' | active=' || is_active::text || ' | name=' || coalesce(full_name, '-') from target), 'NO ACCOUNT FOUND for that address - check the spelling') as detail
  union all
  select 1, 'A1 live role',
         role || ' | ' || coalesce(company_name, 'ALL COMPANIES (unrestricted)') || ' | country=' || coalesce(country_code, 'all')
  from roles
  union all
  select 2, 'A2 no live roles', 'This account holds no live role at all.'
  where exists (select 1 from target) and not exists (select 1 from roles)
  union all
  select 3, 'B module right',
         module || ' | ' || coalesce((select legal_name from companies c where c.id = company_id), '?') || ' | ' || array_to_string(capabilities, ', ')
  from grants
  union all
  select 4, 'B none', 'This account holds no module rights.'
  where exists (select 1 from target) and not exists (select 1 from grants)
  union all
  select 10, 'C1 Add employee / edit profile',
         case when exists (select 1 from roles where role = 'hr_admin')
              then 'ALLOWED - HR Admin of: ' || (select string_agg(coalesce(company_name, 'ALL'), ', ') from roles where role = 'hr_admin')
              else 'BLOCKED - no live HR Admin role' end
  where exists (select 1 from target)
  union all
  select 9, 'C0 HR Admin role policy',
         case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_roles' and policyname = 'user_roles_insert_hr_admin_employee')
              then 'installed (migration 20270118000300 applied)' else 'NOT installed: apply migration 20270118000300 before an HR Admin can give the Employee or Reporting Manager role' end
  where exists (select 1 from target)
  union all
  select 11, 'C2 Invite / link a login (app check)',
         case when exists (select 1 from roles where role = 'sys_admin' and company_id is null)
              then 'ALLOWED - unrestricted System Administrator (any employee)'
              when exists (select 1 from roles where role = 'hr_admin')
              then 'ALLOWED (once the app version with the HR Admin change is deployed) - HR Admin of: ' || (select string_agg(coalesce(company_name, 'ALL COMPANIES'), ', ') from roles where role = 'hr_admin') || ', for employees of those companies only'
              else 'BLOCKED - no HR Admin role and no unrestricted System Administrator grant' end
  where exists (select 1 from target)
  union all
  select 12, 'C3a Give the Employee / Reporting Manager role (database check)',
         case when exists (select 1 from roles where role = 'sys_admin' and company_id is null)
              then 'ALLOWED - unrestricted System Administrator (any company)'
              when exists (select 1 from roles where role = 'hr_admin') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_roles' and policyname = 'user_roles_insert_hr_admin_employee')
              then 'ALLOWED - HR Admin of: ' || (select string_agg(coalesce(company_name, 'ALL COMPANIES'), ', ') from roles where role = 'hr_admin') || ', for the login of an active employee of that company'
              when exists (select 1 from roles where role = 'hr_admin')
              then 'BLOCKED until migration 20270118000300 is applied (then ALLOWED for HR Admin of: ' || (select string_agg(coalesce(company_name, 'ALL COMPANIES'), ', ') from roles where role = 'hr_admin') || ')'
              else 'BLOCKED - no HR Admin role and no unrestricted System Administrator grant' end
  where exists (select 1 from target)
  union all
  select 12, 'C3b Give HR Admin, Finance, CEO, CTO or System Administrator (database check)',
         case when exists (select 1 from roles where role = 'sys_admin' and company_id is null)
              then 'ALLOWED - unrestricted System Administrator'
              else 'BLOCKED - only an unrestricted System Administrator can give these; HR Admin and a company-limited System Administrator are refused' end
  where exists (select 1 from target)
  union all
  select 13, 'C4 Give module access: ' || m.module,
         case when exists (select 1 from grants g where g.module = m.module and (g.capabilities @> array['manage_access'] or g.capabilities @> array['founder']))
              then 'ALLOWED for: ' || (select string_agg(coalesce((select legal_name from companies c where c.id = g.company_id), '?'), ', ') from grants g where g.module = m.module and (g.capabilities @> array['manage_access'] or g.capabilities @> array['founder']))
              else 'BLOCKED - no founder or access-management right in this module (System Administrator and HR Admin do not carry it)' end
  from (values ('Sales & CRM'), ('Projects'), ('Inventory'), ('Project Budget & Expenses')) as m(module)
  where exists (select 1 from target)
) x order by ord, section, detail;
