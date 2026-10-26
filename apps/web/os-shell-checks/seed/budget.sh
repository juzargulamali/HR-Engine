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

# STAGE=draft | submitted | approved (budget approved, funding recorded, actual expenses started) builds the scenario up to that point through the REAL functions as the real people (default: nothing, the browser flow starts from here).
STAGE="${STAGE:-}"
if [ -n "$STAGE" ]; then
  as() { $P <<SQL | tail -1
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a$1","role":"authenticated"}', true);
$2;
commit;
SQL
  }
  PRJ=$($P -c "select id from proj_projects limit 1")
  BUD=$(as 4 "select pbx_create_budget('$PRJ', 'AED')")
  VER=$($P -c "select id from pbx_budget_versions where budget_id='$BUD'")
  CAT() { $P -c "select id from pbx_categories where key='$1' and company_id is null"; }
  ROWS="[{\"category_id\":\"$(CAT food)\",\"description\":\"Lunch for the install team\",\"activity\":\"setup\",\"basis\":\"per_person_day\",\"people\":\"3\",\"days\":\"2\",\"rate\":\"60\"},
        {\"category_id\":\"$(CAT transport)\",\"description\":\"Petrol to the venue\",\"basis\":\"per_km\",\"qty\":\"60\",\"rate\":\"0.5\"},
        {\"category_id\":\"$(CAT transport)\",\"description\":\"Metro cards 20-22 October\",\"basis\":\"fixed\",\"fixed\":\"30\",\"date_from\":\"2026-10-20\",\"date_to\":\"2026-10-22\"},
        {\"category_id\":\"$(CAT logistics)\",\"description\":\"Truck to and from the site\",\"activity\":\"dismantling\",\"basis\":\"per_trip\",\"qty\":\"3\",\"rate\":\"350\"}]"
  RV=$(as 4 "select pbx_save_budget_draft('$VER', $($P -c "select row_version from pbx_budget_versions where id='$VER'"), '{\"people\":[\"$U-0000000000a4\",\"$U-0000000000a2\"],\"note\":\"Expo set-up\"}'::jsonb, '$ROWS'::jsonb)")
  if [ "$STAGE" != "draft" ]; then
    as 4 "select pbx_submit_budget('$VER', $RV, gen_random_uuid())" >/dev/null
    if [ "$STAGE" != "submitted" ]; then
      as 1 "select pbx_decide_budget('$VER', 'approve')" >/dev/null
      as 1 "select pbx_record_funding('$BUD', '$U-0000000000a4', current_date, 500, 'cash', null, 'PV-1', 'advance', gen_random_uuid())" >/dev/null
      as 1 "select pbx_record_funding('$BUD', '$U-0000000000a4', current_date, 2000, 'pluto', null, null, 'card limit', gen_random_uuid())" >/dev/null
      SUB=$(as 4 "select pbx_start_actuals('$BUD')")
      echo "actuals draft $SUB"
    fi
  fi
  echo "stage $STAGE built"
fi
echo "budget scenario seeded"
