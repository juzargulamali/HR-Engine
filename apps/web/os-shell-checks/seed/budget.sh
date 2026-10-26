#!/usr/bin/env bash
# LOCAL throwaway database only. The sample Project Budget & Expenses scenario the browser checks start from. Runs seed/scenario.sh first (fresh database,
# Sales and Projects grants, the client project "Floor projection delivery" with mgr@ as Project Manager and hr@ / lead@ as members), then sets up
# budget access (fictional people, through the same table the owner's SQL writes to):
#   hr1@  Finance (and manages access)   - not a member of the project, no Projects access to the Enginious UAE company projects beyond directory
#   pol.exec@  Finance (a second, independent Finance person for the same company)
#   ceo@  view only (an explicit read-only grant; a founder title alone gives nothing)
#   mgr@  Project Manager (needs no grant)    hr@ / lead@  project members (no budget access)    emp@, admin@, none@  no access
# No budget exists yet: the browser check creates it through the screens. Usage: seed/budget.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/scenario.sh"
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
CO=00000000-0000-4000-8000-00000000a001; U=00000000-0000-4000-8000
$P -c "insert into pbx_company_grants (user_id, company_id, capabilities, note) values
  ('$U-0000000000a1','$CO','{finance,manage_access}','local seed: Finance 1'),
  ('$U-0000000000a8','$CO','{finance}','local seed: Finance 2'),
  ('$U-0000000000a3','$CO','{view}','local seed: read-only')"
echo "budget scenario seeded"
