#!/usr/bin/env bash
# LOCAL throwaway database only. The start of project-ops-tv-flow.mjs (Phase 3: the Operations TV office board). Runs seed/project-plan.sh first (Sales and Projects grants, Inventory with its fictional
# stock, the pending handover "Kids Photobooth", the project "Supply and install" with a DRAFT Inventory request), then, through the REAL functions as the real people, builds a busy board:
#   * "RAF Museum fit-out ..." with a deliberately long name: Setup run 1 (confirmed, timed, crew with ONE call time missing), a Show, a Dismantle, then a REINSTALL (Setup run 2, tentative, no crew);
#     a shipment of LED wall crates that ARRIVES AFTER the first setup begins, carried by a draft Inventory request
#   * "Supply and install": a tentative setup with a shipment tied to its draft request
#   * a project whose only evidence is a PASSED scheduled date (must read "start unconfirmed"), and one whose start the Project Manager RECORDS (must read started)
#   * five more active projects with dated work (so the board has more than one page), Showroom refresh with no site work, and the pending handover (the "awaiting acceptance" group)
# Fictional people and data only. Usage: seed/ops-tv.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/project-plan.sh"
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
CO=00000000-0000-4000-8000-00000000a001; U=00000000-0000-4000-8000
as() { $P <<SQL | tail -1
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a$1","role":"authenticated"}', true);
$2;
commit;
SQL
}
day() { $P -c "select (current_date + $1)::text"; }
$P -c "update profiles set full_name = 'Mona Manager' where id = '$U-0000000000a4'; update profiles set full_name = 'Lena Lead' where id = '$U-0000000000a7'; update profiles set full_name = 'Cara Assignee' where id = '$U-0000000000a2'; update profiles set full_name = 'Tariq Technician' where id = '$U-0000000000a5'" >/dev/null
project() { as 3 "select proj_create_internal_project('$CO', '$1', '$U-0000000000a4', false, 'normal', current_date, current_date + 60, 'Fictional', 'Asia/Dubai')"; }
act() { # act <project> <json>
  as 4 "select proj_save_site_activity('$1', null, '$2'::jsonb)" | sed -E 's/.*"id": ?"([^"]+)".*/\1/'
}
crew() { as 4 "select proj_set_site_crew('$1', '$2'::jsonb, null)" >/dev/null; }

RAF=$(project 'RAF Museum Hendon: Cold War hall interactive floor, projection mapping and the visitor-flow installation, reinstalled for the touring weekend (fictional)')
as 4 "select proj_add_member('$RAF', '$U-0000000000a2', null)" >/dev/null
as 4 "select proj_add_member('$RAF', '$U-0000000000a7', null)" >/dev/null
D1=$(day 1); D2=$(day 3); D4=$(day 4); D6=$(day 6); D11=$(day 11)
SET1=$(act "$RAF" "{\"activity_kind\":\"setup\",\"title\":\"Setup\",\"run_label\":\"Run 1\",\"activity_state\":\"confirmed\",\"location\":\"RAF Museum, Hendon, Hall 2\",\"start_date\":\"$D1\",\"end_date\":\"$D1\",\"starts_local\":\"${D1}T09:00\",\"ends_local\":\"${D1}T18:00\",\"owner_id\":\"$U-0000000000a7\"}")
SHOW=$(act "$RAF" "{\"activity_kind\":\"show\",\"title\":\"Show\",\"activity_state\":\"confirmed\",\"location\":\"RAF Museum, Hendon, Hall 2\",\"start_date\":\"$D4\",\"end_date\":\"$D4\",\"starts_local\":\"${D4}T10:00\",\"ends_local\":\"${D4}T17:00\"}")
DIS=$(act "$RAF" "{\"activity_kind\":\"dismantling\",\"title\":\"Dismantle\",\"run_label\":\"Run 1\",\"activity_state\":\"confirmed\",\"location\":\"RAF Museum, Hendon, Hall 2\",\"start_date\":\"$D6\",\"end_date\":\"$D6\",\"starts_local\":\"${D6}T08:00\",\"ends_local\":\"${D6}T16:00\"}")
SET2=$(act "$RAF" "{\"activity_kind\":\"setup\",\"title\":\"Reinstall\",\"run_label\":\"Run 2\",\"activity_state\":\"tentative\",\"location\":\"RAF Museum, Hendon, Hall 5\",\"start_date\":\"$D11\",\"end_date\":\"$D11\"}")
crew "$SET1" "[{\"user_id\":\"$U-0000000000a7\",\"role\":\"installation\",\"call_local\":\"${D1}T07:30\"},{\"user_id\":\"$U-0000000000a2\",\"role\":\"installation\",\"call_local\":\"${D1}T08:00\"},{\"user_id\":\"$U-0000000000a5\",\"role\":\"installation\"}]"
crew "$SHOW" "[{\"user_id\":\"$U-0000000000a2\",\"role\":\"standby\"}]"
RAFREQ=$(as 4 "select inv_create_request('project', '$RAF', null, 'RAF equipment')")
as 4 "select proj_save_shipment('$RAF', null, '{\"label\":\"LED wall crates\",\"plan_item_id\":\"$SET1\",\"request_id\":\"$RAFREQ\",\"departs_local\":\"${D1}T06:00\",\"arrives_local\":\"${D2}T11:00\",\"carrier\":\"Fictional Freight\"}'::jsonb)" >/dev/null

SUP=$($P -c "select id from proj_projects where name like 'Supply and install%'")
SUPSET=$(act "$SUP" "{\"activity_kind\":\"setup\",\"title\":\"Setup\",\"activity_state\":\"tentative\",\"location\":\"Fictional reception, Dubai\",\"start_date\":\"$(day 3)\",\"end_date\":\"$(day 3)\"}")
SUPREQ=$($P -c "select id from inv_requests where project_id = '$SUP' limit 1")
as 4 "select proj_save_shipment('$SUP', null, '{\"label\":\"Wall displays\",\"plan_item_id\":\"$SUPSET\",\"request_id\":\"$SUPREQ\",\"departs_local\":\"$(day 2)T08:00\",\"arrives_local\":\"$(day 4)T10:00\"}'::jsonb)" >/dev/null

PASSED=$(project 'Passed date job (fictional)')
PSET=$(act "$PASSED" "{\"activity_kind\":\"setup\",\"title\":\"Setup\",\"activity_state\":\"tentative\",\"location\":\"Fictional Marina office\",\"start_date\":\"$(day -2)\",\"end_date\":\"$(day -2)\"}")
crew "$PSET" "[{\"user_id\":\"$U-0000000000a5\",\"role\":\"installation\"}]"
STARTED=$(project 'Started job (fictional)')
SSET=$(act "$STARTED" "{\"activity_kind\":\"setup\",\"title\":\"Setup\",\"activity_state\":\"confirmed\",\"location\":\"Fictional Hall 1\",\"start_date\":\"$(day -1)\",\"end_date\":\"$(day 1)\",\"starts_local\":\"$(day -1)T08:00\",\"ends_local\":\"$(day 1)T18:00\"}")
crew "$SSET" "[{\"user_id\":\"$U-0000000000a6\",\"role\":\"installation\",\"call_local\":\"$(day -1)T08:00\"}]"
as 4 "select proj_record_site_start('$SSET', null, 'Crew arrived at 08:00')" >/dev/null

n=0
for NAME in 'Atrium launch wall (fictional)' 'Mall roadshow room (fictional)' 'Museum interactive table (fictional)' 'Brand pop-up (fictional)' 'Showroom lobby mirror (fictional)'; do
  n=$((n+1)); PX=$(project "$NAME")
  AX=$(act "$PX" "{\"activity_kind\":\"setup\",\"title\":\"Setup\",\"activity_state\":\"confirmed\",\"location\":\"Fictional venue $n\",\"start_date\":\"$(day $((n+4)))\",\"end_date\":\"$(day $((n+4)))\",\"starts_local\":\"$(day $((n+4)))T09:00\",\"ends_local\":\"$(day $((n+4)))T17:00\"}")
  crew "$AX" "[{\"user_id\":\"$U-0000000000a1\",\"role\":\"installation\",\"call_local\":\"$(day $((n+4)))T08:00\"}]"
done
echo "RAF=$RAF SET1=$SET1 SHOW=$SHOW DIS=$DIS SET2=$SET2 RAFREQ=$RAFREQ PASSED=$PASSED PSET=$PSET STARTED=$STARTED SSET=$SSET"
echo "ops-tv seeded"
