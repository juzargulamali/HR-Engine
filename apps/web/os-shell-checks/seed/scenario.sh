#!/usr/bin/env bash
# LOCAL throwaway database only. The shared SAMPLE SCENARIO of the Sales and Projects browser checks (see ../README.md, "Sample scenario"),
# built through the REAL functions as the real people. Usage: seed/scenario.sh   (runs seed/base.sh first: fresh database, Sales and Projects
# grants, Orbit Motors, and one Won enquiry owned by emp@)
#   Sales   emp@ owns five enquiries: the Won one, plus four open ones: "Hotel lobby mirror" (follow-up overdue), "Museum interactive table"
#           (follow-up due today), "Atrium LED wall for the mall launch" (qualified, follow-up upcoming), "Roadshow immersive room"
#           (proposal preparation, follow-up upcoming)
#   Projects  the Won enquiry's handover is prepared by emp@, assigned to mgr@ by ceo@ and accepted by mgr@: that makes the client project
#             (renamed "Floor projection delivery") with a Programming team led by lead@ and hr@ in it, two milestones, one deliverable and four tasks:
#             hr@ has Shader prototype (waiting for review), Sensor calibration and Write the operator guide (overdue); mgr@ has the unlinked
#             "Confirm power and network with the venue"; and a short discussion
# Dates are relative to today so the groups (overdue / today / upcoming) are the same on any day.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/base.sh"
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
CO=00000000-0000-4000-8000-00000000a001; U=00000000-0000-4000-8000
as() { # as <user-suffix> <sql>  (one statement per call; prints its last line)
  $P <<SQL | tail -1
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a$1","role":"authenticated"}', true);
$2;
commit;
SQL
}
ORG=$($P -c "select id from crm_organisations where name='Orbit Motors'")
AGENCY=$(as 5 "select crm_create_organisation('Zeta Media LLC', 'agency', 'Dubai')")
opp() { # opp <title> <next action> <due offset sql>
  as 5 "select crm_create_opportunity(p_company_id => '$CO', p_title => '$1', p_source => 'agency_call', p_next_title => '$2', p_next_due => $3, p_agency_org_id => '$AGENCY', p_client_org_id => '$ORG', p_location => 'Dubai', p_scope => 'Sample scope')"
}
HOTEL=$(opp 'Hotel lobby mirror' 'Call the hotel manager' "now() - interval '2 days'")
MUSEUM=$(opp 'Museum interactive table' 'Confirm the table dimensions' "now() + interval '6 hours'")
ATRIUM=$(opp 'Atrium LED wall for the mall launch' 'Send the atrium layout' "now() + interval '4 days'")
ROADSHOW=$(opp 'Roadshow immersive room' 'Prepare the roadshow proposal' "now() + interval '6 days'")
as 5 "select crm_move_stage('$ATRIUM', 'qualified')" >/dev/null
as 5 "select crm_move_stage('$ROADSHOW', 'qualified')" >/dev/null
as 5 "select crm_move_stage('$ROADSHOW', 'proposal_prep')" >/dev/null

# ---- Projects: the handover of the Won enquiry -> the client project ------------------------------------------------------------------
WON=$($P -c "select id from crm_opportunities where stage='won'")
H=$(as 5 "select proj_save_handover('$WON', '{\"scope\":\"LED floor and sensors, 6x4 m, with interactive shader content.\"}'::jsonb)")
as 5 "select proj_submit_handover('$H')" >/dev/null
as 3 "select proj_assign_handover_pm('$H', '$U-0000000000a4')" >/dev/null
PRJ=$(as 4 "select proj_accept_handover('$H')")
as 4 "select proj_update_project('$PRJ', '{\"name\":\"Floor projection delivery\"}'::jsonb)" >/dev/null
TEAM=$(as 4 "select proj_save_team('$PRJ', null, 'Programming', '$U-0000000000a7')")
as 4 "select proj_add_member('$PRJ', '$U-0000000000a2', '$TEAM')" >/dev/null
as 4 "select proj_add_member('$PRJ', '$U-0000000000a7', '$TEAM')" >/dev/null 2>&1 || true
day() { date -d "$1 days" +%F; }
M1=$(as 4 "select proj_save_milestone('$PRJ', null, '{\"title\":\"Content approved by the client\",\"due_date\":\"$(day 12)\",\"is_required\":true}'::jsonb)")
as 4 "select proj_save_milestone('$PRJ', null, '{\"title\":\"Installation complete\",\"due_date\":\"$(day 28)\",\"is_required\":true}'::jsonb)" >/dev/null
DEL=$(as 4 "select proj_save_deliverable('$PRJ', null, '{\"title\":\"Interactive floor content\",\"milestone_id\":\"$M1\",\"team_id\":\"$TEAM\"}'::jsonb)")
task() { as 4 "select proj_create_task('$PRJ', '$1'::jsonb)"; }
T_SHADER=$(task "{\"title\":\"Shader prototype\",\"assignee_id\":\"$U-0000000000a2\",\"deliverable_id\":\"$DEL\",\"due_date\":\"$(day 7)\",\"requires_review\":true}")
T_SENSOR=$(task "{\"title\":\"Sensor calibration\",\"assignee_id\":\"$U-0000000000a2\",\"deliverable_id\":\"$DEL\",\"due_date\":\"$(day 5)\"}")
T_GUIDE=$(task "{\"title\":\"Write the operator guide\",\"assignee_id\":\"$U-0000000000a2\",\"deliverable_id\":\"$DEL\",\"due_date\":\"$(day -3)\"}")
T_POWER=$(task "{\"title\":\"Confirm power and network with the venue\",\"assignee_id\":\"$U-0000000000a4\",\"due_date\":\"2026-11-02\"}")
as 2 "select proj_set_task_status('$T_SHADER', 'in_progress')" >/dev/null
as 2 "select proj_set_task_status('$T_SHADER', 'ready_for_review')" >/dev/null
as 4 "select proj_post_message('$PRJ', 'Kick-off done. Truss arrives on Thursday at the venue.')" >/dev/null
as 7 "select proj_post_message('$PRJ', 'Shader prototype is running on the test rig.')" >/dev/null
echo "PRJ=$PRJ OPPS: hotel=$HOTEL museum=$MUSEUM atrium=$ATRIUM roadshow=$ROADSHOW"
echo "scenario seeded"
