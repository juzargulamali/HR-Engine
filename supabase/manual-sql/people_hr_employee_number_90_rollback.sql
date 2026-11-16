-- ROLLBACK for 20270117000100_people_hr_employee_number_unique.sql. Deploy the app from before this change FIRST (the app of this change no longer asks for a number when it hires someone: without the trigger a
-- hire would be refused for having no number). It changes NO employee number and deletes no employee.
-- It puts back the per-company exact-match unique index (creatable when no two live employees of one company share an exact number; the migration's guard kept active and invited employees unique across all companies,
-- but a TERMINATED test account may share a number with a live one: if this statement fails for that reason, correct or remove that record, which is a test account by the owner's decision, and run it again), then
-- drops the triggers, the numbering and claim functions, the sequence and the canonical function.
-- IT DELIBERATELY KEEPS employee_number_reservations: that table is the only record that a number belonged to an employee who was later corrected or deleted for good, and dropping it would let those numbers be
-- reused. While the migration is rolled back nothing writes to it; applying the migration again reserves the number of every active or invited employee that exists then (existing reservations are never changed) and
-- starts the sequence above the highest reserved number. If you really want the table gone as well, that is a separate, deliberate statement, not part of this rollback:
--   drop table employee_number_reservations;   -- NOT run by this file; it frees every reserved number for reuse
-- Safe to run twice.
create unique index if not exists employees_company_employee_number_unique on employees (company_id, employee_number) where deleted_at is null;
drop trigger if exists profiles_employee_number_reactivation on profiles;
drop function if exists profiles_reactivation_number_check();
drop trigger if exists employees_canonical_number on employees;
drop function if exists employees_save_canonical_number();
drop function if exists employee_number_claim(uuid, text, text);
drop function if exists next_employee_number();
drop sequence if exists employee_number_seq;
drop function if exists employee_number_in_scope(timestamptz, employment_status, uuid);
drop function if exists employee_number_canonical(text);
