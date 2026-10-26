#!/usr/bin/env bash
# LOCAL throwaway database only. The sample Project Budget & Expenses scenario the browser checks start from. Runs seed/scenario.sh first (fresh database,
# Sales and Projects grants, the client project "Floor projection delivery" with mgr@ as Project Manager and hr@ / lead@ as members), then sets up
# budget access (fictional people, through the same table the owner's SQL writes to):
#   hr1@  Finance (and manages access)   - not a member of the project, no Projects access to the Enginious UAE company projects beyond directory
#   pol.exec@  Finance (a second Finance person; one is enough for budgets submitted by ordinary Project Managers)
#   ceo@  view only (an explicit read-only grant; a founder title alone gives nothing)
#   admin@  the company's authorised CEO / CTO approver (explicit; decides what Finance people submit)
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
  ('$U-0000000000a3','$CO','{view}','local seed: read-only'),
  ('$U-0000000000a6','$CO','{executive_approver}','local seed: CEO/CTO approver')"

# STAGE=draft | submitted | approved (budget approved, funding recorded, actual expenses started) | executive (hr1@, a Finance person, is the Project Manager;
# admin@ approves as CEO/CTO approver; final expenses approved; receipts declared by Finance, waiting for the approver's confirmation) builds the scenario up to that point through the REAL functions as the real people (default: nothing, the browser flow starts from here).
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
  PMU=4; APPROVER=1
  if [ "$STAGE" = "executive" ]; then
    PMU=1; APPROVER=6
    $P -c "update proj_projects set pm_user_id='$U-0000000000a1' where id='$PRJ'" -c "insert into proj_project_members (project_id, user_id, role) values ('$PRJ','$U-0000000000a1','pm') on conflict do nothing"
  fi
  BUD=$(as $PMU "select pbx_create_budget('$PRJ', 'AED')")
  VER=$($P -c "select id from pbx_budget_versions where budget_id='$BUD'")
  CAT() { $P -c "select id from pbx_categories where key='$1' and company_id is null"; }
  ROWS="[{\"category_id\":\"$(CAT food)\",\"description\":\"Lunch for the install team\",\"activity\":\"setup\",\"basis\":\"per_person_day\",\"people\":\"3\",\"days\":\"2\",\"rate\":\"60\"},
        {\"category_id\":\"$(CAT transport)\",\"description\":\"Petrol to the venue\",\"basis\":\"per_km\",\"qty\":\"60\",\"rate\":\"0.5\"},
        {\"category_id\":\"$(CAT transport)\",\"description\":\"Metro cards 20-22 October\",\"basis\":\"fixed\",\"fixed\":\"30\",\"date_from\":\"2026-10-20\",\"date_to\":\"2026-10-22\"},
        {\"category_id\":\"$(CAT logistics)\",\"description\":\"Truck to and from the site\",\"activity\":\"dismantling\",\"basis\":\"per_trip\",\"qty\":\"3\",\"rate\":\"350\"}]"
  RV=$(as $PMU "select pbx_save_budget_draft('$VER', $($P -c "select row_version from pbx_budget_versions where id='$VER'"), '{\"people\":[\"$U-0000000000a4\",\"$U-0000000000a2\"],\"note\":\"Expo set-up\"}'::jsonb, '$ROWS'::jsonb)")
  if [ "$STAGE" != "draft" ]; then
    as $PMU "select pbx_submit_budget('$VER', $RV, gen_random_uuid())" >/dev/null
    if [ "$STAGE" != "submitted" ]; then
      as $APPROVER "select pbx_decide_budget('$VER', 'approve')" >/dev/null
      as 1 "select pbx_record_funding('$BUD', '$U-0000000000a4', current_date, 500, 'cash', null, 'PV-1', 'advance', gen_random_uuid())" >/dev/null
      as 1 "select pbx_record_funding('$BUD', '$U-0000000000a4', current_date, 2000, 'pluto', null, null, 'card limit', gen_random_uuid())" >/dev/null
      SUB=$(as $PMU "select pbx_start_actuals('$BUD')")
      echo "actuals draft $SUB"
      if [ "$STAGE" = "executive" ]; then
        ARV=$($P -c "select row_version from pbx_actual_submissions where id='$SUB'")
        LINES=$($P -c "select json_agg(json_build_object('budget_row_id', id, 'actual_amount', (case when sort_no=1 then '360' when sort_no=2 then '30' when sort_no=3 then '30' else '1050' end), 'paid_via', (case when sort_no=1 then 'personal' else 'company_card' end), 'paid_by_user_id', (case when sort_no=1 then '$U-0000000000a1' else null end)) order by sort_no) from pbx_budget_rows where version_id='$VER'")
        ARV=$(as $PMU "select pbx_save_actuals_draft('$SUB', $ARV, '{\"complete_confirmed\": true}'::jsonb, '$LINES'::jsonb)")
        as $PMU "select pbx_submit_actuals('$SUB', $ARV, gen_random_uuid())" >/dev/null
        as $APPROVER "select pbx_decide_actuals('$SUB', 'approve')" >/dev/null
        as 1 "select pbx_record_receipts('$BUD', 'received')" >/dev/null
      fi
    fi
  fi
  echo "stage $STAGE built"
fi
echo "budget scenario seeded"
