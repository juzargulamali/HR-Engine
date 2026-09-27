-- Fix: a plain employee (or anyone else without hr_admin/sys_admin/finance/
-- ceo/cto grants) viewing an employee profile's Overview tab always sees
-- "Manager: —", even when that employee's own `manager_id` column IS set to
-- a real, correctly-resolvable employee — confirmed live on the Employee
-- E2E test account's own profile.
--
-- Root cause: apps/web/src/app/(app)/employees/[id]/overview-section.tsx
-- resolves the displayed manager NAME by fetching the whole company's
-- `employees` rows through the CURRENT VIEWER's own RLS-scoped session,
-- then doing `managers.find(m => m.id === employee.manager_id)` in
-- application code. `employees_select` (this table's only SELECT policy)
-- lets a plain viewer see only: their own row (`id = current_employee_id()`),
-- rows they manage (`is_manager_of(id)` — the report's reverse direction,
-- never their own manager's row), or rows visible via hr_admin/sys_admin/
-- finance/ceo/cto. There is no clause letting a viewer see their OWN
-- manager's row, so for anyone in the "plain" bucket that `.find()` can
-- never match — regardless of whether `manager_id` is set, correct, or
-- pointing at someone real. This affected both a plain employee's self-view
-- and a manager viewing one of their own reports' profile.
--
-- Fix: a narrowly-scoped SECURITY DEFINER function that resolves ONLY the
-- manager's display name for one specific employee, gated by the EXACT
-- same predicate `employees_select` already uses to decide whether the
-- CALLER may view that employee row at all — so this never returns
-- anything the caller couldn't already see via the profile page itself.
-- Same judgment already made for resolve_approver()/is_manager_of(): this
-- is low-sensitivity org-chart information (a name), not a new disclosure,
-- and the RLS policy itself is intentionally left unchanged — broadening
-- who can list the FULL company directory is a separate, larger decision
-- this fix does not make.
create or replace function get_employee_manager_name(p_employee_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(concat(m.first_name, ' ', coalesce(m.last_name, ''))), '')
  from employees e
  join employees m on m.id = e.manager_id
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

grant execute on function get_employee_manager_name(uuid) to authenticated;
