-- ROLLBACK for 20270117000100_people_hr_employee_number_unique.sql. Deploy the app from before this change FIRST (the app of this change no longer asks for a number when it hires someone: without the trigger a
-- hire would be refused for having no number). It changes NO employee number and deletes no employee: numbers that were assigned or saved in canonical form stay as saved.
-- It puts back the per-company exact-match unique index (always creatable: live employees with unique numbers across all companies are unique within each), then drops the trigger, the global index, the
-- numbering function, the sequence and the canonical function. Dropping the sequence forgets how far the series got: re-applying the migration restarts it above the highest number any remaining employee row holds,
-- which is the same point except for an employee that was PERMANENTLY deleted meanwhile (their number could then be given out again). Safe to run twice.
create unique index if not exists employees_company_employee_number_unique on employees (company_id, employee_number) where deleted_at is null;
drop trigger if exists employees_canonical_number on employees;
drop function if exists employees_save_canonical_number();
drop index if exists employees_employee_number_canonical_unique;
drop function if exists next_employee_number();
drop sequence if exists employee_number_seq;
drop function if exists employee_number_canonical(text);
