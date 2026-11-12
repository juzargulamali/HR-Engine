-- Departments: two rules the app already applied are now enforced by the database (install-order row 31).
--
--   1. An employee's department must be a department of the employee's own company. Until now only the app checked this (People & Access, Job & department);
--      employees.department_id is a plain reference to departments(id), so a direct update could point an employee at another company's department.
--   2. Within one company, two ACTIVE departments cannot have the same name once the name is trimmed, its inner spaces are collapsed and its capitals are ignored.
--      Until now only the app checked this before inserting, so two people adding the same name at the same moment could both succeed.
--
-- NOTHING IS CHANGED OR DELETED. No employee, no department and no permission is touched: the same people may add departments and edit employees as before
-- (departments_write, employees_update_hr). If the existing data already breaks either rule, this migration STOPS before creating anything and says how many
-- rows are affected; run supabase/manual-sql/dept_integrity_00_preflight_readonly.sql to list them, decide what to do with each, then apply again.
-- Additive and idempotent: it can be run twice.

-- The name as it is compared: trimmed, runs of white space as one space, lower case.
create or replace function department_name_key(p_name text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

do $$
declare v_mismatch integer; v_dupes integer; v_blank integer;
begin
  select count(*) into v_mismatch from employees e join departments d on d.id = e.department_id where d.company_id <> e.company_id;
  select count(*) into v_dupes from (
    select 1 from departments where deleted_at is null group by company_id, department_name_key(name) having count(*) > 1) x;
  select count(*) into v_blank from departments where deleted_at is null and department_name_key(name) = '';
  if v_mismatch > 0 or v_dupes > 0 or v_blank > 0 then
    raise exception 'Departments: nothing was installed. % employee record(s) point at a department of another company, % active department name(s) are used more than once in one company, % active department(s) have a blank name. Run dept_integrity_00_preflight_readonly.sql to list them, resolve them, then apply this migration again.',
      v_mismatch, v_dupes, v_blank using errcode = '23514';
  end if;
end $$;

-- 1. The employee's department belongs to the employee's company.
-- Checked when an employee is created and whenever the department or the company of an employee changes. A new assignment must also be to a department that
-- has not been removed. A row whose department and company are both unchanged is not re-checked, so an unrelated edit of an employee is never refused.
create or replace function employees_department_company_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_deleted timestamptz;
begin
  if new.department_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.department_id is not distinct from old.department_id and new.company_id is not distinct from old.company_id then return new; end if;
  select d.company_id, d.deleted_at into v_company, v_deleted from departments d where d.id = new.department_id;
  if not found then raise exception 'The department was not found' using errcode = '23503'; end if;
  if v_company <> new.company_id then
    raise exception 'The department belongs to another company. Choose a department of this employee''s company.' using errcode = '23514';
  end if;
  if v_deleted is not null and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id) then
    raise exception 'The department has been removed. Choose a department of this employee''s company.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function employees_department_company_check() from public, anon, authenticated;

drop trigger if exists trg_employees_department_company on employees;
create trigger trg_employees_department_company before insert or update of department_id, company_id on employees
  for each row execute function employees_department_company_check();

-- A department cannot be moved to another company while employees of its present company are in it.
create or replace function departments_company_move_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is distinct from old.company_id and exists (select 1 from employees e where e.department_id = old.id and e.company_id <> new.company_id) then
    raise exception 'This department has employees of its present company. Move them first.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function departments_company_move_check() from public, anon, authenticated;

drop trigger if exists trg_departments_company_move on departments;
create trigger trg_departments_company_move before update of company_id on departments
  for each row execute function departments_company_move_check();

-- 2. One active department per name per company. A removed department's name can be used again.
create unique index if not exists uq_departments_company_name_active on departments (company_id, department_name_key(name)) where deleted_at is null;
alter table departments drop constraint if exists departments_name_not_blank;
alter table departments add constraint departments_name_not_blank check (department_name_key(name) <> '');
