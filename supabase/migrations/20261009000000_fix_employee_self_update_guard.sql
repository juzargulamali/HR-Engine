-- CRITICAL: guard_employee_self_update() checked has_role('hr_admin',
-- new.company_id) — the ATTACKER-SUPPLIED new value — instead of
-- old.company_id (the row's real, current company). employees_update_self
-- RLS only constrains by row id, not by column, so this trigger is the
-- only thing stopping a self-service update from touching anything beyond
-- personal_email/phone.
--
-- Exploit: any authenticated user who is hr_admin for ANY company B (a
-- legitimate grant) and who also has their own employees row under a
-- different company A could PATCH their own row directly (via
-- supabase-js/PostgREST, bypassing the Next.js server action entirely)
-- with company_id=B plus arbitrary changes to employment_status,
-- manager_id, job_title, deleted_at, termination_date, etc. RLS passes
-- (same row); the trigger saw new.company_id=B, found them hr_admin
-- there, and returned NEW unchecked — every column in the payload
-- committed, not just company_id. Net effect: self-reassignment into a
-- company they administer, with full control over their own HR record.
--
-- Fix: check old.company_id — whether they're HR Admin of the row's
-- CURRENT company — so the bypass can never be reached by supplying a
-- company_id you happen to administer.
create or replace function guard_employee_self_update()
returns trigger
language plpgsql
as $$
begin
  -- Triggers fire regardless of role, unlike RLS — a trusted backend write
  -- (migration, seed, admin/service-role operation with no PostgREST JWT
  -- session) has auth.uid() = null and is never what this guard constrains.
  if auth.uid() is null or has_role('hr_admin', old.company_id) then
    return new;
  end if;

  if new.first_name is distinct from old.first_name
    or new.last_name is distinct from old.last_name
    or new.company_id is distinct from old.company_id
    or new.country_code is distinct from old.country_code
    or new.department_id is distinct from old.department_id
    or new.manager_id is distinct from old.manager_id
    or new.employee_number is distinct from old.employee_number
    or new.job_title is distinct from old.job_title
    or new.employment_status is distinct from old.employment_status
    or new.employment_type is distinct from old.employment_type
    or new.hire_date is distinct from old.hire_date
    or new.termination_date is distinct from old.termination_date
    or new.cost_center is distinct from old.cost_center
    or new.work_location is distinct from old.work_location
    or new.deleted_at is distinct from old.deleted_at
    or new.deleted_by is distinct from old.deleted_by
  then
    raise exception 'Only personal_email and phone can be self-updated — ask HR Admin to change anything else.';
  end if;

  return new;
end;
$$;
