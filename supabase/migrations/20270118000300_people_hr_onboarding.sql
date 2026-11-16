-- People & HR: guided onboarding (Add employee -> complete profile -> invite -> HR roles -> module access -> review), one resumable flow.
-- ADDITIVE: one new table, one read function, policies on the new table only. No existing table, policy, function or grant is changed, no existing row is rewritten, and NO ACCESS IS GRANTED by this file:
-- roles and module access are still given only through the existing routes (a System Administrator's user_roles insert; each module's own grant function with its founder / access-manager rules).
-- Install order: preflight (supabase/manual-sql/people_hr_onboarding_00_preflight_readonly.sql), this migration, verify (..._20_verify_readonly.sql), then deploy the app.
-- Rollback: ..._90_rollback.sql (it stops while any plan exists, because a plan is somebody's recorded intention).
--
-- WHY. Onboarding crosses four permission models: HR Admin adds the employee and completes the profile; only a System Administrator invites a login and assigns HR roles; module access belongs to each module's
-- founder or access manager. A person who can do the first part could not hand the rest over: they had to remember what to ask for. The PLAN records, against the employee, the invitation address, the HR roles and the
-- module rights the HR Admin intends, so whoever can finish the next step sees the exact companies, roles and rights, and nothing has to be re-typed. A plan GRANTS NOTHING: each item is applied by the person who is
-- allowed to apply it, through the existing route, and the screen derives what is done from the real records, not from the plan.
--
-- WHO CAN READ AND WRITE A PLAN. HR Admin of the employee's company, and an UNSCOPED System Administrator (the same two checks the database already uses for the employee record and for role assignment).
-- WHO CAN SEE WHAT IS DONE. onboarding_access_snapshot(employee) returns the linked account's status and the roles and module rights that employee holds, ONLY for the companies the caller administers (HR Admin of
-- that company) or all of them for an unscoped System Administrator. This is read-only visibility for the onboarding screen (user_roles and the module grant tables are otherwise readable only by a System
-- Administrator or each module's access managers). It is the one new thing an HR Admin can read; the owner approves it by applying this file.
--
-- RE-RUNNABLE: if not exists / create or replace / drop policy if exists.

create table if not exists employee_onboarding_plans (
  employee_id   uuid primary key references employees(id) on delete cascade,
  id            uuid not null unique default gen_random_uuid(),   -- the audit trigger (write_audit_log) records every audited row by an id column
  company_id    uuid not null references companies(id),        -- the employee's company (checked below), kept so the policy needs no join
  invite_email  text,                                           -- where the login is (or will be) invited
  hr_roles      jsonb not null default '[]'::jsonb check (jsonb_typeof(hr_roles) = 'array' and pg_column_size(hr_roles) < 20000),      -- [{ "role": "line_manager", "companyId": "uuid" }]
  module_grants jsonb not null default '[]'::jsonb check (jsonb_typeof(module_grants) = 'array' and pg_column_size(module_grants) < 40000),  -- [{ "module": "sales", "companyId": "uuid", "capabilities": ["..."], "note": null }]
  prepared_by   uuid not null references auth.users(id),
  prepared_at   timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  reviewed_by   uuid references auth.users(id),                 -- who looked at the final review (the exact list) and confirmed it
  reviewed_at   timestamptz
);
alter table employee_onboarding_plans enable row level security;

drop policy if exists onboarding_plans_select on employee_onboarding_plans;
create policy onboarding_plans_select on employee_onboarding_plans for select
  using (has_role('hr_admin', company_id) or has_role('sys_admin'));
drop policy if exists onboarding_plans_insert on employee_onboarding_plans;
create policy onboarding_plans_insert on employee_onboarding_plans for insert
  with check ((has_role('hr_admin', company_id) or has_role('sys_admin'))
              and exists (select 1 from employees e where e.id = employee_id and e.company_id = employee_onboarding_plans.company_id and e.deleted_at is null));
drop policy if exists onboarding_plans_update on employee_onboarding_plans;
create policy onboarding_plans_update on employee_onboarding_plans for update
  using (has_role('hr_admin', company_id) or has_role('sys_admin'))
  with check ((has_role('hr_admin', company_id) or has_role('sys_admin'))
              and exists (select 1 from employees e where e.id = employee_id and e.company_id = employee_onboarding_plans.company_id and e.deleted_at is null));
revoke all on employee_onboarding_plans from anon;
revoke delete, truncate on employee_onboarding_plans from authenticated;

drop trigger if exists audit_employee_onboarding_plans on employee_onboarding_plans;
create trigger audit_employee_onboarding_plans after insert or update on employee_onboarding_plans
  for each row execute function write_audit_log();

-- What the employee's account, HR roles and module rights ARE (not what is planned), for the onboarding screen. Read-only. Rows outside the companies the caller administers are never returned.
create or replace function onboarding_access_snapshot(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e record;
  v_sys boolean := has_role('sys_admin');
begin
  if auth.uid() is null then raise exception 'Sign in to continue.' using errcode = '28000'; end if;
  select id, company_id, user_id into e from employees where id = p_employee_id and deleted_at is null;
  if not found then return null; end if;
  if not (has_role('hr_admin', e.company_id) or v_sys) then
    raise exception 'You cannot see onboarding for this employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'employeeId', e.id,
    'companyId', e.company_id,
    'account', (select jsonb_build_object('status', p.account_status::text, 'active', p.is_active, 'email', p.email) from profiles p where p.id = e.user_id),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('role', r.role::text, 'companyId', r.company_id) order by r.role::text, r.company_id nulls first)
      from user_roles r
      where r.user_id = e.user_id and r.revoked_at is null
        and (v_sys or r.company_id is null or has_role('hr_admin', r.company_id))), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object('module', g.module, 'companyId', g.company_id, 'capabilities', to_jsonb(g.capabilities)) order by g.module, g.company_id)
      from (
        select 'sales' as module, company_id, capabilities from crm_company_grants where user_id = e.user_id and revoked_at is null
        union all select 'projects', company_id, capabilities from proj_company_grants where user_id = e.user_id and revoked_at is null
        union all select 'inventory', company_id, capabilities from inv_company_grants where user_id = e.user_id and revoked_at is null
        union all select 'budget', company_id, capabilities from pbx_company_grants where user_id = e.user_id and revoked_at is null
      ) g
      where v_sys or has_role('hr_admin', g.company_id)), '[]'::jsonb)
  );
end;
$$;
revoke all on function onboarding_access_snapshot(uuid) from public, anon;
grant execute on function onboarding_access_snapshot(uuid) to authenticated;
