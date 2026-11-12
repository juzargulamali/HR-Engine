-- Departments: two rules the app already applied are now enforced by the database (install-order row 31).
--
--   1. An employee's department must be a department of the employee's own company. Until now only the app checked this (People & Access, Job & department);
--      employees.department_id is a plain reference to departments(id), so a direct update could point an employee at another company's department.
--      The rule is a composite foreign key, employees(department_id, company_id) -> departments(id, company_id). A foreign key is checked with row locks, so it
--      holds when two changes happen at the same moment (an employee is given a department while that department is moved to another company: one of the two
--      is refused, whichever commits second). A trigger alone cannot promise that, because each transaction only sees the other's work once it has committed.
--      An employee with no department is not checked, so clearing the department always works.
--   2. Within one company, two ACTIVE departments cannot have the same name once the name is trimmed, its inner spaces are collapsed and its capitals are ignored.
--      Until now only the app checked this before inserting, so two people adding the same name at the same moment could both succeed.
--
-- NOTHING IS CHANGED OR DELETED. No employee, no department and no permission is touched: the same people may add departments and edit employees as before
-- (departments_write, employees_update_hr). If the existing data already breaks either rule, this migration STOPS before creating anything and says how many
-- rows are affected; run supabase/manual-sql/dept_integrity_00_preflight_readonly.sql to list them, decide what to do with each, then apply again.
-- Additive and idempotent: it can be run twice.

-- The name as it is compared: every run of white space (spaces, tabs, line breaks) becomes one space FIRST, then the ends are trimmed, then lower case.
-- Collapsing before trimming matters: trimming removes spaces only, so a name made of tabs, or with a tab at either end, would otherwise not be reduced.
create or replace function department_name_key(p_name text)
returns text language sql immutable set search_path = public as $$
  select lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
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
-- 1a. The rule itself: a composite foreign key. departments(id, company_id) is made a key so it can be referenced; id alone is already unique, so this adds no
--     new restriction on departments. The existing reference employees.department_id -> departments(id) stays. With the default MATCH SIMPLE an employee whose
--     department_id is null is not checked. The default ON UPDATE NO ACTION refuses moving a department to another company while employees are in it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'departments_id_company_key' and conrelid = 'public.departments'::regclass) then
    alter table departments add constraint departments_id_company_key unique (id, company_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_department_company_fkey' and conrelid = 'public.employees'::regclass) then
    alter table employees add constraint employees_department_company_fkey foreign key (department_id, company_id) references departments (id, company_id);
  end if;
end $$;

-- 1b. Two things the foreign key does not say, and plain words for the common case. The trigger runs first, so a person normally sees its sentence; the foreign
--     key above is what holds when two changes race. Checked when an employee is created and whenever the department or the company of an employee changes.
--     A new assignment must be to a department that has not been removed. A row whose department and company are both unchanged is not re-checked, so an
--     unrelated edit of an employee is never refused, and someone whose department is removed later keeps it.
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

-- A department cannot be moved to another company while employees of its present company are in it. The foreign key enforces this (also under concurrent
-- writes); this trigger only gives the common case a plain sentence.
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
