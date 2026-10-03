-- LOCAL-ONLY seed for the full-stack browser verification (throwaway database built by build-db.sh). Never run against a
-- hosted project. Every account below exists only in this local database and signs in with the local-stack password.
\set ON_ERROR_STOP on

update countries set working_weekdays = array[1,2,3,4,5] where code in ('AE', 'PL');
update countries set working_weekdays = array[0,1,2,3,4] where code = 'SA';

insert into companies (id, legal_name, country_code, default_currency) values
  ('00000000-0000-4000-8000-00000000a001', 'Enginious Local AE', 'AE', 'AED'),
  ('00000000-0000-4000-8000-00000000a002', 'Enginious Local PL', 'PL', 'PLN');

-- people: id suffix = user id, employee id has the same suffix with prefix e
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'hr1@e2e.local'),      -- unscoped HR Admin (drafts policies)
  ('00000000-0000-4000-8000-0000000000a2', 'hr@e2e.local'),       -- unscoped HR Admin (operates attendance/approvals, second person to activate)
  ('00000000-0000-4000-8000-0000000000a3', 'ceo@e2e.local'),      -- CEO of the UAE company
  ('00000000-0000-4000-8000-0000000000a4', 'mgr@e2e.local'),      -- Line Manager
  ('00000000-0000-4000-8000-0000000000a5', 'emp@e2e.local'),      -- Employee (managed by Max)
  ('00000000-0000-4000-8000-0000000000a6', 'admin@e2e.local'),    -- Sys Admin
  ('00000000-0000-4000-8000-0000000000a7', 'lead@e2e.local'),     -- ordinary colleague who can be a project lead
  ('00000000-0000-4000-8000-0000000000a8', 'pol.exec@e2e.local'),    -- CEO grant for Poland (not limited to one company)
  ('00000000-0000-4000-8000-0000000000a9', 'pol.worker@e2e.local');

insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'L-1', '00000000-0000-4000-8000-00000000a001', 'AE', 'Hugo',  'Drafter',  '2024-01-01', null),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a2', 'L-2', '00000000-0000-4000-8000-00000000a001', 'AE', 'Hana',  'Resources','2024-01-01', null),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a3', 'L-3', '00000000-0000-4000-8000-00000000a001', 'AE', 'Cleo',  'Chief',    '2024-01-01', null),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000a4', 'L-4', '00000000-0000-4000-8000-00000000a001', 'AE', 'Max',   'Manager',  '2024-01-01', '00000000-0000-4000-8000-0000000000e3'),
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000a5', 'L-5', '00000000-0000-4000-8000-00000000a001', 'AE', 'Eve',   'Employee', '2024-01-01', '00000000-0000-4000-8000-0000000000e4'),
  ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000a6', 'L-6', '00000000-0000-4000-8000-00000000a001', 'AE', 'Sam',   'Sysadmin', '2024-01-01', null),
  ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000a7', 'L-7', '00000000-0000-4000-8000-00000000a001', 'AE', 'Leo',   'Lead',     '2024-01-01', '00000000-0000-4000-8000-0000000000e4'),
  ('00000000-0000-4000-8000-0000000000e8', '00000000-0000-4000-8000-0000000000a8', 'L-8', '00000000-0000-4000-8000-00000000a002', 'PL', 'Piotr', 'Prezes',   '2024-01-01', null),
  ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000a9', 'L-9', '00000000-0000-4000-8000-00000000a002', 'PL', 'Pola',  'Pracownik','2024-01-01', '00000000-0000-4000-8000-0000000000e8');

insert into user_roles (user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'hr_admin'),
  ('00000000-0000-4000-8000-0000000000a2', 'hr_admin'),
  ('00000000-0000-4000-8000-0000000000a6', 'sys_admin');
insert into user_roles (user_id, role, company_id) values
  ('00000000-0000-4000-8000-0000000000a3', 'ceo', '00000000-0000-4000-8000-00000000a001'),
  ('00000000-0000-4000-8000-0000000000a4', 'line_manager', '00000000-0000-4000-8000-00000000a001');
insert into user_roles (user_id, role, country_code) values ('00000000-0000-4000-8000-0000000000a8', 'ceo', 'PL');

-- The Production situation before activation: the same-day/4-hour V2 is active in every country.
insert into policy_versions (country_code, policy_type, version_no, effective_from, status, created_by, payload)
select c, 'overtime_rules', 2, '2025-01-01', 'active', '00000000-0000-4000-8000-000000000000',
  jsonb_build_object('phase2b_seed_marker', 'leave_policy_configuration', 'policy_name', 'Enginious Recovery Leave',
    'wording', 'Recovery Leave is a time-off benefit.', 'standard_threshold_hours', 4, 'expiry_days', 180)
from unnest(array['AE', 'SA', 'PL']) c;

-- The owner's step, done through the real function as the unscoped HR Admin who drafts: next-version DRAFTS for AE/SA/PL.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select * from seed_recovery_windows_policy_drafts();
commit;

-- For the end-to-end CREDIT flows only: make the UAE windows version (v3) active from the past, so past evidence is judged
-- by it. (The real activation function — controlled date, scheduler gate, governance — is exercised separately through the
-- browser on the POLAND draft, which stays a draft.) Done as the database owner with the activation flag, like the test fixtures.
begin;
select set_config('app.recovery_policy_activation', 'on', true);
update policy_versions set effective_to = '2025-12-31' where country_code = 'AE' and policy_type = 'overtime_rules' and version_no = 2;
update policy_versions set status = 'active', effective_from = '2026-01-01' where country_code = 'AE' and policy_type = 'overtime_rules' and version_no = 3;
commit;
