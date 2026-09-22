-- =============================================================================
-- Link an employee record to its login — the one gap every prior phase's UI
-- assumed was already handled: `employees.user_id` has been nullable and
-- settable since Phase 0 (an employee can exist before they have a login),
-- but no Server Action anywhere ever set it after the initial seed data.
-- HR Admin invites a person (Admin -> Users, creates the auth.users row) and
-- separately creates their employee record (Employees -> New) — nothing
-- connected the two, so `current_employee_id()` never resolved and every
-- self-service page ("My Profile", leave, reimbursements) told a real,
-- logged-in HR Admin/CEO/Sys Admin that HR hadn't created their record yet,
-- even after it had been.
--
-- `employees.user_id` was never unique — nothing stopped two employee rows
-- from pointing at the same login, which would make current_employee_id()'s
-- `limit 1` pick an arbitrary one of them. A partial unique index (only over
-- non-null values, so any number of not-yet-linked employees can still
-- coexist) closes that gap at the one layer that actually enforces it.
-- =============================================================================

create unique index employees_user_id_unique on employees(user_id) where user_id is not null;
