#!/usr/bin/env bash
# LOCAL throwaway database only. The sample for the My Day (Stage 3) checks: the shared sample scenario (Projects + Sales), the Inventory sample on
# top of it, then, relative to TODAY (Dubai), this week's delivery plan and milestone, a blocked task, an equipment request with a shortage,
# today's recorded attendance and a few open clock sessions. Everything goes through the real functions as the real people, except the attendance
# and clock rows, which are inserted directly (there is no function that backdates a recorded day) with fictional values.
# Usage: seed/my-day.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/scenario.sh" >/dev/null
INV_BODY="$(mktemp)"; sed '/\/base.sh"/d' "$HERE/inventory.sh" > "$INV_BODY"; bash "$INV_BODY" >/dev/null; rm -f "$INV_BODY"
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"; U=00000000-0000-4000-8000
as() { $P <<SQL | tail -1
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a$1","role":"authenticated"}', true);
$2;
commit;
SQL
}
TODAY=$($P -c "select (now() at time zone 'Asia/Dubai')::date")
WK=$($P -c "select ('$TODAY'::date - (extract(isodow from '$TODAY'::date)::int - 1))")
d() { $P -c "select '$WK'::date + $1"; }
CLIENT=$($P -c "select id from proj_projects where kind='client' limit 1")
SHOW=$($P -c "select id from proj_projects where name='Showroom refresh'")

# this week's delivery plan and a milestone (as the Project Manager, mgr@)
item() { as 4 "select proj_save_plan_item('$1', null, jsonb_build_object('plan','delivery','title','$2','start_date','$(d "$3")','end_date','$(d "$4")'))"; }
S1=$(item "$CLIENT" "Storyboard" 0 1); S2=$(item "$CLIENT" "Interaction build" 1 3); S3=$(item "$CLIENT" "Hardware test" 2 4); item "$CLIENT" "Installation" 5 6 >/dev/null
as 4 "select proj_save_plan_item('$CLIENT', '$S1', '{\"status\":\"done\"}'::jsonb)" >/dev/null
as 4 "select proj_save_plan_item('$CLIENT', '$S2', '{\"status\":\"in_progress\"}'::jsonb)" >/dev/null
item "$SHOW" "Rack install" 2 4 >/dev/null
as 4 "select proj_save_milestone('$CLIENT'::uuid, null, jsonb_build_object('title','Application demo','due_date','$(d 3)','is_required',true))" >/dev/null
as 4 "select proj_save_milestone('$SHOW'::uuid, null, jsonb_build_object('title','Racks accepted','due_date','$(d 4)','is_required',true))" >/dev/null

# a blocked task on the showroom project
T=$(as 4 "select proj_create_task('$SHOW'::uuid, jsonb_build_object('title','Confirm rental controllers','assignee_id','$U-0000000000a4','due_date','$(d 3)'))")
as 4 "select proj_block_task('$T'::uuid, 'Rental company has not confirmed', '$U-0000000000a4'::uuid, 'Call the supplier')" >/dev/null

# an equipment request with one line that stock cannot cover
item_id() { $P -c "select id from inv_items where name='$1'"; }
REQ=$(as 4 "select inv_create_request('project', '$CLIENT', null, 'Floor projection kit', jsonb_build_object('dispatch', '$(d 3) 08:00', 'return_due', '$(d 9) 17:00'), 'Asia/Dubai', null, null, null)")
as 4 "select inv_add_request_line('$REQ', '$(item_id 'Motor controller')', 2, null, null)" >/dev/null
as 4 "select inv_add_request_line('$REQ', '$(item_id 'Holofan 75 cm')', 3, null, null)" >/dev/null
as 4 "select inv_add_request_line('$REQ', '$(item_id 'HDMI cable')', 4, null, null)" >/dev/null
as 4 "select inv_submit_request('$REQ', null)" >/dev/null

# today's recorded attendance (fictional) and open clock sessions
E() { echo "$U-0000000000e$1"; }
for n in 1 2 4 7; do $P -c "insert into attendance_records (employee_id, work_date, status, work_mode, source) values ('$(E $n)', '$TODAY', 'present', 'office', 'manual')"; done
$P -c "insert into attendance_records (employee_id, work_date, status, source) values ('$(E 5)', '$TODAY', 'leave', 'manual')"
for spec in "2 office" "4 wfh" "7 office"; do set -- $spec
  SID=$($P -c "insert into attendance_sessions (employee_id) values ('$(E $1)') returning id" | head -1)
  $P -c "insert into attendance_segments (session_id, employee_id, work_mode, segment_start) values ('$SID', '$(E $1)', '$2', now() - interval '2 hours')"
done
echo "my day seeded: today=$TODAY week starts $WK"
