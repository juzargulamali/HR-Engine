-- resolve_role_holders(): lists every active user_id holding a given role
-- for a company, for the new leave-notification email feature (notify all
-- HR Admins + the CEO when a leave request is submitted). user_roles' own
-- RLS (user_roles_select_own: user_id = auth.uid() or has_role('sys_admin'))
-- blocks an ordinary employee's session from seeing anyone else's role
-- grants, so — same as resolve_approver()/resolve_approver_for_company()
-- before it — this needs its own SECURITY DEFINER function rather than a
-- plain client-side select. Unlike resolve_approver() (single approver,
-- `limit 1`), notifying "all HR Admins" needs every match, so this returns
-- a set instead of one row.
create or replace function resolve_role_holders(p_role app_role, p_company_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id
  from user_roles
  where role = p_role
    and revoked_at is null
    and (company_id is null or company_id = p_company_id)
  order by granted_at asc;
$$;
