#!/usr/bin/env bash
# LOCAL throwaway database only. Start of people-hr-phase1-flow.mjs (People & HR Phase 1: directory, onboarding, resumable setup, job and pay change, documents, People & Access).
# Runs seed/project-plan.sh first (Sales, Projects and Inventory grants and fixtures, so the cross-module grant check has real grants to protect), then adds, with fictional people only:
#   * Enginious Local SA (Saudi Arabia, SAR) next to the existing Enginious Local AE (AED) and Enginious Local PL (PLN): the three default-country fixtures
#   * Enginious Local NC (AED company whose default currency is MISSING): the "ask for it in place" fixture
#   * hr.ae@  an HR Admin of the UAE company ONLY (the unauthorised role for a Saudi or Polish record)
#   * fin@    a Finance user of the UAE company (can change pay, cannot see identity documents)
#   * one existing employee in each of the other companies, so a restricted HR Admin has something it must NOT see
# The unscoped HR Admins (hr1@, hr@) and the Sys Admin (admin@) already exist in the base seed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/project-plan.sh"
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
AE=00000000-0000-4000-8000-00000000a001; PL=00000000-0000-4000-8000-00000000a002; SA=00000000-0000-4000-8000-00000000a003; NC=00000000-0000-4000-8000-00000000a004; U=00000000-0000-4000-8000
$P <<SQL
insert into companies (id, legal_name, country_code, default_currency) values
  ('$SA', 'Enginious Local SA', 'SA', 'SAR'),
  ('$NC', 'Enginious Local NC', 'AE', '');
insert into auth.users (id, email) values ('$U-0000000000b1', 'hr.ae@e2e.local'), ('$U-0000000000b2', 'fin@e2e.local');
insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
  ('$U-0000000000f1', '$U-0000000000b1', 'L-11', '$AE', 'AE', 'Hala',  'Uaehr',   '2024-01-01'),
  ('$U-0000000000f2', '$U-0000000000b2', 'L-12', '$AE', 'AE', 'Fadi',  'Finance', '2024-01-01'),
  ('$U-0000000000f3', null,              'S-1',  '$SA', 'SA', 'Salma', 'Saudi',   '2025-02-01'),
  ('$U-0000000000f4', null,              'N-1',  '$NC', 'AE', 'Noor',  'Nocurrency', '2025-03-01');
insert into user_roles (user_id, role, company_id) values
  ('$U-0000000000b1', 'hr_admin', '$AE'),
  ('$U-0000000000b2', 'finance', '$AE');
-- a pay record for the Saudi employee, so a restricted HR Admin has a salary it must not read
insert into compensation_details (employee_id, effective_from, base_salary, allowances, currency, created_by) values
  ('$U-0000000000f3', '2025-02-01', 9000, '{"other": 1000}', 'SAR', '$U-0000000000a1');
SQL
echo "people-hr seeded"
