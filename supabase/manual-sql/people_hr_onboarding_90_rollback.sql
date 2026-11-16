-- ROLLBACK for 20270118000300_people_hr_onboarding.sql. Deploy the app from before this change FIRST (the guided onboarding screen reads the plan table and the snapshot function).
-- It STOPS (changes nothing) while any plan exists, because a plan is somebody's recorded intention about roles and module access. It never touches roles or module rights themselves (nothing in the migration granted any).
-- Safe to run twice.
do $$
begin
  if to_regclass('public.employee_onboarding_plans') is not null and exists (select 1 from employee_onboarding_plans) then
    raise exception 'STOP: onboarding plans exist (%). Export or review them first; nothing was changed.', (select count(*) from employee_onboarding_plans);
  end if;
end $$;
drop function if exists onboarding_access_snapshot(uuid);
drop table if exists employee_onboarding_plans;
