-- A14 / D-13. The "Project lead" picker on the attendance clock lists the people an ordinary employee can choose. ADDITIVE: one new function; no table, policy or
-- privilege change, no data change.
--
-- WHY (reproduced on a local copy before the fix: packages/rls-tests/test/clock_lead_candidates.rls.test.ts). The picker was filled by reading `employees` through the
-- person's own session. employees_select lets an ordinary employee read only their own row (a manager also reads their reports), so the list held only the person
-- themself, while "Site work" cannot be started without naming a lead, and choosing oneself routes the Recovery Leave request to HR direct instead of through the lead.
--
-- WHAT. attendance_lead_candidates() returns ONLY an id and a display name for the active people (employment status active, not deleted) of the CALLER's own company, the
-- same people validate_attendance_segment_inputs() accepts as a lead (same company, currently active). The clock and the form that supplies a missing lead read it.
-- It adds no read of the employees table: the employee still cannot read any other employee row or column.
--
-- WHAT DOES NOT CHANGE. validate_attendance_segment_inputs() still rejects a lead of another company or a person who is not active; attendance rules, Recovery Leave
-- routing and every calculation; employees_select. Callable by signed-in users only.
-- ROLLBACK: supabase/manual-sql/leadpick_90_rollback.sql (drops the function: the picker goes back to the person themself).

create or replace function attendance_lead_candidates()
returns table(employee_id uuid, display_name text)
language sql stable security definer
set search_path = public
as $$
  select e.id,
         coalesce(nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), 'Unnamed colleague')
  from employees me
  join employees e on e.company_id = me.company_id
  where me.id = current_employee_id()
    and e.employment_status = 'active'
    and e.deleted_at is null
  order by e.first_name, e.last_name, e.id;
$$;

revoke all on function attendance_lead_candidates() from public, anon;
grant execute on function attendance_lead_candidates() to authenticated;
