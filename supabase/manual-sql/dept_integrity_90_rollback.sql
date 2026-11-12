-- CHANGES THE DATABASE. Rollback of 20270103000100_departments_company_integrity.sql.
-- Removes the composite foreign key and the key it references, the two triggers, their functions, the unique index and the blank-name rule. It deletes no employee and no department and changes no permission.
-- After it, only the app checks that a department belongs to the employee's company and that a name is not used twice.
alter table employees drop constraint if exists employees_department_company_fkey;
alter table departments drop constraint if exists departments_id_company_key;
drop trigger if exists trg_employees_department_company on employees;
drop trigger if exists trg_departments_company_move on departments;
drop function if exists employees_department_company_check();
drop function if exists departments_company_move_check();
alter table departments drop constraint if exists departments_name_not_blank;
drop index if exists uq_departments_company_name_active;
drop function if exists department_name_key(text);
