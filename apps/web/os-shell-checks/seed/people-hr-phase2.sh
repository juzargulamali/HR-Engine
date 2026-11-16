#!/usr/bin/env bash
# LOCAL throwaway database only. Start of people-hr-phase2-walkthrough.mjs (People & HR Phase 2: the HR work queue).
# Runs seed/people-hr.sh first (UAE, Saudi, Polish and no-currency companies; hr.ae@ HR Admin of the UAE company only), then adds, with fictional people only:
#   * Dana Docexpiry   (UAE) a passport that expired 5 days ago                      -> document expiry, Needs action
#   * Pavel Probation  (UAE) probation ends in 7 days                                -> probation deadline, Due soon
#   * Adel Attendance  (UAE) yesterday: a manual entry and the clock records differ   -> attendance exception, Needs action
#   * Zofia Polish     (PL)  a passport that expired 3 days ago                      -> in a company hr.ae@ cannot see
# Every one has a current contract, so only the intended issue is in the queue.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/people-hr.sh"
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
AE=00000000-0000-4000-8000-00000000a001; PL=00000000-0000-4000-8000-00000000a002; U=00000000-0000-4000-8000
ADMIN=$U-0000000000a1
$P <<SQL
insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, job_title) values
  ('$U-00000000e201', 'Q-201', '$AE', 'AE', 'Dana',  'Docexpiry',  '2024-03-01', 'Designer'),
  ('$U-00000000e202', 'Q-202', '$AE', 'AE', 'Pavel', 'Probation',  current_date - 60, 'Installer'),
  ('$U-00000000e203', 'Q-203', '$AE', 'AE', 'Adel',  'Attendance', '2024-03-01', 'Technician'),
  ('$U-00000000e204', 'Q-204', '$PL', 'PL', 'Zofia', 'Polish',     '2024-03-01', 'Engineer');
insert into employment_contracts (employee_id, contract_type, start_date, end_date, probation_end_date, is_current, version_no, created_by) values
  ('$U-00000000e201', 'permanent', '2024-03-01', null, null, true, 1, '$ADMIN'),
  ('$U-00000000e202', 'probation', current_date - 60, null, current_date + 7, true, 1, '$ADMIN'),
  ('$U-00000000e203', 'permanent', '2024-03-01', null, null, true, 1, '$ADMIN'),
  ('$U-00000000e204', 'permanent', '2024-03-01', null, null, true, 1, '$ADMIN');
insert into identity_documents (employee_id, document_type, document_number, expiry_date, created_by) values
  ('$U-00000000e201', 'passport', 'FIC-PASS-0001', current_date - 5, '$ADMIN'),
  ('$U-00000000e204', 'passport', 'FIC-PASS-0002', current_date - 3, '$ADMIN');
insert into attendance_records (employee_id, work_date, status, source, presence_conflict) values
  ('$U-00000000e203', current_date - 1, 'present', 'manual', 'Self-clock activity exists for this day, which was recorded manually');
SQL
echo "people-hr phase 2 seeded"
