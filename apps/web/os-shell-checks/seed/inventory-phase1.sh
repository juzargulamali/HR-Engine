#!/usr/bin/env bash
# LOCAL throwaway database only. The Inventory seed (seed/inventory.sh) plus what the Inventory Phase 1 walkthrough starts from, all fictional and built through the
# REAL functions as the real roles:
#   lead@ becomes an Operations Manager of the AE company (she keeps "may request equipment for employees");
#   a complete technology template "Fictional roadshow laptop kit" = 4 x Laptop 14 inch (the seed holds 3: one short) + 6 x HDMI cable;
#   an open enquiry owned by emp@ (Sales) that asks for one such kit, with an installation date and event dates.
# People: emp@ Sales, mgr@ Project Manager, hr1@ warehouse technician at Dubai, lead@ Operations, ceo@ founder, admin@ no access.
# Usage: seed/inventory-phase1.sh   (runs seed/inventory.sh, which runs seed/base.sh, first)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/inventory.sh" >/dev/null
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
AE=00000000-0000-4000-8000-00000000a001; U=00000000-0000-4000-8000
as() { # as <user-suffix> <sql>  (one statement per call; prints its result)
  $P <<SQL | tail -1
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a$1","role":"authenticated"}', true);
$2;
commit;
SQL
}
$P -c "update proj_company_grants set capabilities = '{operations}' where user_id = '$U-0000000000a7' and company_id = '$AE'"
LAP=$($P -c "select id from inv_items where name = 'Laptop 14 inch'"); HDMI=$($P -c "select id from inv_items where name = 'HDMI cable'")
TECH=$(as 3 "select inv_save_technology('$AE', null, 'Fictional roadshow laptop kit', 'Fictional: four laptops and their cables')")
as 3 "select inv_save_technology_components('$TECH', '[{\"item_id\":\"$LAP\",\"qty\":4,\"sort_order\":10},{\"item_id\":\"$HDMI\",\"qty\":6,\"sort_order\":20}]'::jsonb)" >/dev/null
as 3 "select inv_set_technology_status('$TECH', 'complete')" >/dev/null
ORG=$($P -c "select id from crm_organisations where name = 'Orbit Motors'")
OPP=$(as 5 "select crm_create_opportunity(p_company_id => '$AE', p_title => 'Fictional Phase 1 roadshow', p_source => 'direct_client', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '$ORG', p_currency => 'AED', p_value => 90000)")
$P -c "update crm_opportunities set technologies = '[{\"name\":\"Fictional roadshow laptop kit\",\"qty\":1}]'::jsonb, install_start = current_date + 10, event_start = current_date + 11, event_end = current_date + 18, location = 'Fictional Expo Hall 3', scope = 'Fictional: laptop stations for a two-stop roadshow' where id = '$OPP'"
echo "OPP=$OPP TECH=$TECH"
echo "inventory phase 1 seeded"
