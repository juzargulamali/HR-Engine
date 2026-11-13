#!/usr/bin/env bash
# LOCAL throwaway database only. The start of project-plan-flow.mjs (Projects Release 1: the Project Plan). Runs seed/inventory.sh first (Sales and Projects grants, a Won
# enquiry, Inventory with its fictional stock), then, through the REAL functions as the real people:
#   * the Won enquiry becomes "Kids Photobooth": two accepted technologies (Photobooth x2, Cartoon app x1) and a scope brief. Its handover is prepared by emp@, SUBMITTED and
#     ASSIGNED to mgr@ but NOT accepted: the browser check accepts it, so the route into the Project Plan after acceptance is part of what is checked.
#   * a second project, "Supply and install (made before Release 1)": hardware + installation only, built exactly as the previous release stored it (the earlier five
#     sections, none of the new fields, a released task and a stock-matched line on the project's draft equipment request), so opening it checks that nothing changed for it.
# Fictional people and data only. Usage: seed/project-plan.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/inventory.sh"
export PGPASSWORD=postgres; P="psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq"
CO=00000000-0000-4000-8000-00000000a001; U=00000000-0000-4000-8000
as() { $P <<SQL | tail -1
begin; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U-0000000000a$1","role":"authenticated"}', true);
$2;
commit;
SQL
}
WON=$($P -c "select id from crm_opportunities where stage='won'")
$P -c "update crm_opportunities set title='Kids Photobooth for the mall', technologies='[{\"name\":\"Photobooth\",\"qty\":2},{\"name\":\"Cartoon app\",\"qty\":1}]'::jsonb, scope='Two kids photobooths with a cartoon photo app, printed on the spot.' where id='$WON'"
H=$(as 5 "select proj_save_handover('$WON', '{\"scope\":\"Two kids photobooths with a cartoon photo app on six tablets, printed on the spot. Installation the day before the mall event.\"}'::jsonb)")
as 5 "select proj_submit_handover('$H')" >/dev/null
as 3 "select proj_assign_handover_pm('$H', '$U-0000000000a4')" >/dev/null

# ---- the project made before Release 1 -------------------------------------------------------------------------------------------------
SUP=$(as 3 "select proj_create_internal_project('$CO', 'Supply and install (made before Release 1)', '$U-0000000000a4', false, 'normal', current_date, current_date + 40, 'Three wall displays for a fictional reception.', 'Asia/Dubai')")
as 4 "select proj_add_member('$SUP', '$U-0000000000a2', null)" >/dev/null
OWNER=$U-0000000000a4
ITEM=$(as 4 "select gen_random_uuid()")
TASK=$(as 4 "select proj_create_task('$SUP', '{\"title\":\"Wall displays: Mount and test the displays\",\"assignee_id\":\"$U-0000000000a2\",\"due_date\":\"$(date -d '30 days' +%F)\",\"description\":\"Delivery plan D001 / L0002 (Installation)\"}'::jsonb)")
REQ=$(as 4 "select inv_create_request('project', '$SUP', null, 'Delivery plan')")
HOLO=$($P -c "select id from inv_items where name='Holofan 75 cm'")
RLINE=$(as 4 "select inv_add_request_line('$REQ', '$HOLO', 3, 'D001 Wall displays: Display units')")
$P <<SQL
insert into proj_dp_state (project_id, rev, next_item, next_line) values ('$SUP', 5, 2, 3);
insert into proj_dp_items (id, project_id, item_key, zone, title, specs, owner_id, needed_by, sort_order, released_at, released_by, created_by)
  values ('$ITEM', '$SUP', 'D001', 'Reception', 'Wall displays', 'Three displays on the reception wall', '$OWNER', current_date + 32, 10, now(), '$OWNER', '$OWNER');
insert into proj_dp_lines (project_id, item_id, line_key, section, description, qty, inv_item_id, request_line_id, released_at, created_by)
  values ('$SUP', '$ITEM', 'L0001', 'hardware', 'Display units', 3, '$HOLO', '$RLINE', now(), '$OWNER');
insert into proj_dp_lines (project_id, item_id, line_key, section, description, assignee_id, needed_by, task_id, released_at, created_by)
  values ('$SUP', '$ITEM', 'L0002', 'installation', 'Mount and test the displays', '$U-0000000000a2', current_date + 30, '$TASK', now(), '$OWNER');
SQL
echo "SUP=$SUP HANDOVER=$H"
echo "project plan seeded"
