-- ROLLBACK for 20270118000300_people_hr_onboarding.sql. Deploy the app from before this change FIRST (the guided onboarding screen reads the plan table and the snapshot function).
-- It also drops the user_roles policy that let an HR Admin give the Employee and Reporting Manager roles (roles already given stay in place; nothing is revoked).
-- It STOPS (changes nothing) while any plan exists, because a plan is somebody's recorded intention about roles and module access. It never touches roles or module rights themselves (nothing in the migration granted any).
-- Safe to run twice.
do $$
declare n bigint;
begin
  -- dynamic SQL: on a second run the table is already gone, and a plain reference would fail while the statement is planned
  if to_regclass('public.employee_onboarding_plans') is not null then
    execute 'select count(*) from employee_onboarding_plans' into n;
    if n > 0 then
      raise exception 'STOP: onboarding plans exist (%). Export or review them first; nothing was changed.', n;
    end if;
  end if;
end $$;
drop policy if exists user_roles_insert_hr_admin_employee on user_roles;   -- removes only the HR Admin's new right; roles already given stay (nothing is revoked)
drop function if exists onboarding_access_snapshot(uuid);
drop table if exists employee_onboarding_plans;
