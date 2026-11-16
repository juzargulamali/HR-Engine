#!/usr/bin/env bash
# LOCAL throwaway database only. The Inventory seed (seed/inventory.sh) plus what the Inventory Phase 2 walkthrough starts from, all fictional and built through the
# REAL functions as the real roles:
#   a second warehouse called "Dubai", this one run by the second company (Enginious Local PL, shown as Enginious Europe), so the same city is a warehouse of
#     two companies, as on the hosted database;
#   the owning company (Enginious Local AE, shown as Enginious UAE) allows the second company to hold and use its equipment (the existing sharing switch);
#   ceo@ (founder of the first company) also operates stock in the second, so one person works with two companies.
# People: hr1@ warehouse technician at Dubai (Enginious UAE), pol.exec@ founder of Enginious Europe (receives there), ceo@ founder of Enginious UAE,
#   emp@ an ordinary employee (is given equipment), admin@ no access.
# Usage: seed/inventory-phase2.sh   (runs seed/inventory.sh, which runs seed/base.sh, first)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/inventory.sh" >/dev/null
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
AE=00000000-0000-4000-8000-00000000a001; PL=00000000-0000-4000-8000-00000000a002; U=00000000-0000-4000-8000
as() { # as <user-suffix> <sql>  (one statement per call; prints its result)
  $P <<SQL | tail -1
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a$1","role":"authenticated"}', true);
$2;
commit;
SQL
}
EUDXB=$(as 8 "select inv_save_location('$PL', null, 'DXE', 'Dubai', 'Asia/Dubai')")
as 8 "select inv_save_bin('$EUDXB', null, 'E-01', 'Europe cage 1')" >/dev/null
as 3 "select inv_set_company_sharing('$AE', '$PL', true, 'Fictional: equipment kept at the Europe cage in Dubai')" >/dev/null
$P -c "insert into inv_company_grants (user_id, company_id, capabilities, note) values ('$U-0000000000a3','$PL','{warehouse,cross_location,view_stock}','local seed: works with two companies')"
echo "EUDXB=$EUDXB"
echo "inventory phase 2 seeded"
