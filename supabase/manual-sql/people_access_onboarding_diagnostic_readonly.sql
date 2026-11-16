-- READ ONLY. Changes nothing. Run in the Supabase SQL editor to see exactly why a person can add employees and edit
-- profiles but still hands invitations, HR role assignment and module access back to the owner.
-- Before running: replace the one address below (the only edit you make). Leave the quotes.
-- Reads: user_roles, the four module grant tables, profiles, employees, companies. Writes nothing.
--
-- How to read it: section A lists the person's live roles with their company scope. Section B lists their module
-- rights. Section C gives one verdict per action, using the same checks the app and the database use:
--   * Invite / link a login ......... app: an unrestricted System Administrator (a System Administrator grant with NO
--                                     company). A grant limited to one company is not enough.
--   * Assign an HR role ............. database: has_role('sys_admin') is true only for an unrestricted grant, and the
--                                     user_roles insert policy requires it.
--   * Give module access ............ database: crm/proj/inv/pbx grant functions need a founder or an access manager
--                                     of that module for that company.
--   * Add an employee / edit a profile  an HR Admin of the employee's company (a company-limited HR Admin is enough).

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
  union all select 'Phone / PBX', g.company_id, g.capabilities from pbx_company_grants g join target t on t.user_id = g.user_id where g.revoked_at is null
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
  select 11, 'C2 Invite / link a login (app check)',
         case when exists (select 1 from roles where role = 'sys_admin' and company_id is null)
              then 'ALLOWED - holds an unrestricted System Administrator grant'
              when exists (select 1 from roles where role = 'sys_admin')
              then 'BLOCKED - the System Administrator grant is limited to: ' || (select string_agg(company_name, ', ') from roles where role = 'sys_admin')
                   || '. The app needs a grant with no company, so the invitation falls back to the owner.'
              else 'BLOCKED - no System Administrator grant' end
  where exists (select 1 from target)
  union all
  select 12, 'C3 Assign an HR role (database check: user_roles insert policy / has_role)',
         case when exists (select 1 from roles where role = 'sys_admin' and company_id is null)
              then 'ALLOWED - unrestricted System Administrator'
              else 'BLOCKED - the insert policy accepts only an unrestricted System Administrator; HR Admin and a company-limited System Administrator are refused'
         end
  where exists (select 1 from target)
  union all
  select 13, 'C4 Give module access: ' || m.module,
         case when exists (select 1 from grants g where g.module = m.module and (g.capabilities @> array['manage_access'] or g.capabilities @> array['founder']))
              then 'ALLOWED for: ' || (select string_agg(coalesce((select legal_name from companies c where c.id = g.company_id), '?'), ', ') from grants g where g.module = m.module and (g.capabilities @> array['manage_access'] or g.capabilities @> array['founder']))
              else 'BLOCKED - no founder or access-management right in this module (System Administrator and HR Admin do not carry it)' end
  from (values ('Sales & CRM'), ('Projects'), ('Inventory'), ('Phone / PBX')) as m(module)
  where exists (select 1 from target)
) x order by ord, section, detail;
