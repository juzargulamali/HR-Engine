-- "Is this employee a CEO/CTO?" for the employee profile page.
--
-- The profile's "No manager assigned" note must not show for a CEO/CTO. The
-- first version looked at user_roles from the browser session, but user_roles is
-- only readable by its owner and by sys_admin, so an HR Admin viewing a CEO's
-- profile could not see the role and still got the note. This answers the one
-- question, gated by exactly the predicate get_employee_manager_name() uses to
-- decide whether the caller may see that employee at all — it reveals nothing
-- the caller could not already read from the profile page.
--
-- Additive: one new function. No table, column or data change.

create or replace function employee_is_c_level(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(bool_or(is_c_level(e.user_id, e.company_id)), false)
  from employees e
  where e.id = p_employee_id
    and (
      has_role('hr_admin', e.company_id)
      or has_role('sys_admin')
      or (
        e.deleted_at is null and (
          e.id = current_employee_id()
          or is_manager_of(e.id)
          or has_role('finance', e.company_id)
          or (has_role('ceo', e.company_id) or has_role('cto', e.company_id))
        )
      )
    );
$$;

revoke all on function employee_is_c_level(uuid) from public, anon;
grant execute on function employee_is_c_level(uuid) to authenticated;
