#!/usr/bin/env bash
# LOCAL throwaway database only. The sample Inventory scenario the browser checks start from, built through the REAL functions as the
# real roles (nothing inserted into stock tables by hand):
#   Enginious Local AE: Dubai and Riyadh warehouses; Enginious Local PL: Poznan warehouse
#   ceo@ founder (AE), pol.exec@ founder (PL), hr1@ warehouse operator at Dubai, lead@ may request equipment for employees,
#   hr@ may see equipment held by employees, mgr@ is the Project Manager, emp@ an ordinary employee, admin@ no access.
# Usage: seed/inventory.sh   (runs seed/base.sh first)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/base.sh"
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
$P -c "insert into inv_company_settings (company_id, reference_code) values ('$AE','ENG'),('$PL','ENP')"
$P -c "insert into inv_company_grants (user_id, company_id, capabilities, note) values
  ('$U-0000000000a3','$AE','{founder}','local seed'), ('$U-0000000000a8','$PL','{founder}','local seed'),
  ('$U-0000000000a1','$AE','{warehouse}','local seed: Dubai operator'), ('$U-0000000000a7','$AE','{request_for_employees}','local seed'),
  ('$U-0000000000a2','$AE','{view_employee_custody}','local seed')"
DXB=$(as 3 "select inv_save_location('$AE', null, 'DXB', 'Dubai', 'Asia/Dubai')")
RUH=$(as 3 "select inv_save_location('$AE', null, 'RUH', 'Riyadh', 'Asia/Riyadh')")
POZ=$(as 8 "select inv_save_location('$PL', null, 'POZ', 'Poznan', 'Europe/Warsaw')")
as 3 "select inv_set_operator_locations('$AE', '$U-0000000000a1', array['$DXB']::uuid[])" >/dev/null
BIN_A=$(as 3 "select inv_save_bin('$DXB', null, 'A-01', 'Shelf A1')")
BIN_B=$(as 3 "select inv_save_bin('$DXB', null, 'B-02', 'Shelf B2')")
cat() { as 3 "select inv_save_category('$AE', null, '$1')"; }
C_IT=$(cat 'Laptops and tablets'); C_DISP=$(cat 'Display technology'); C_MOT=$(cat 'Motors and controllers'); C_CARD=$(cat 'Sending and receiving cards'); C_CAB=$(cat 'Cables and connectors'); C_CONS=$(cat 'Consumables'); C_KIT=$(cat 'Kits')
item() { as 3 "select inv_save_item('$AE', null, '$1'::jsonb)"; }
I_LAP=$(item "{\"name\":\"Laptop 14 inch\",\"category_id\":\"$C_IT\",\"tracking\":\"individual\",\"manufacturer\":\"Acme\",\"model\":\"L14\",\"status\":\"active\"}")
I_VR=$(item "{\"name\":\"VR headset\",\"category_id\":\"$C_IT\",\"tracking\":\"individual\",\"model\":\"Quest-like\",\"status\":\"active\"}")
I_HOLO=$(item "{\"name\":\"Holofan 75 cm\",\"category_id\":\"$C_DISP\",\"tracking\":\"individual\",\"status\":\"active\"}")
I_MOT=$(item "{\"name\":\"Motor 2.2 kW\",\"category_id\":\"$C_MOT\",\"tracking\":\"individual\",\"specification\":\"2.2 kW, 1400 rpm\",\"status\":\"active\"}")
I_CTRL=$(item "{\"name\":\"Motor controller\",\"category_id\":\"$C_MOT\",\"tracking\":\"individual\",\"status\":\"active\"}")
I_SEND=$(item "{\"name\":\"Sending card\",\"category_id\":\"$C_CARD\",\"tracking\":\"quantity\",\"model\":\"SC-1\",\"status\":\"active\"}")
I_RECV=$(item "{\"name\":\"Receiving card\",\"category_id\":\"$C_CARD\",\"tracking\":\"quantity\",\"model\":\"RC-1\",\"status\":\"active\"}")
I_HDMI=$(item "{\"name\":\"HDMI cable\",\"category_id\":\"$C_CAB\",\"tracking\":\"quantity\",\"specification\":\"5 m, type A\",\"status\":\"active\"}")
I_CABM=$(item "{\"name\":\"Power cable\",\"category_id\":\"$C_CAB\",\"tracking\":\"quantity\",\"unit_of_measure\":\"m\",\"quantity_scale\":3,\"specification\":\"3x1.5 mm\",\"status\":\"active\"}")
I_TIES=$(item "{\"name\":\"Cable ties\",\"category_id\":\"$C_CONS\",\"tracking\":\"consumable\",\"unit_of_measure\":\"pack\",\"status\":\"active\"}")
I_VRKIT=$(item "{\"name\":\"VR kit\",\"category_id\":\"$C_KIT\",\"tracking\":\"kit\",\"status\":\"active\"}")
I_DRAFT=$(item "{\"name\":\"Sensor array (to be counted)\",\"category_id\":\"$C_MOT\",\"tracking\":\"individual\",\"status\":\"draft\"}")
# stock received at Dubai by the warehouse operator (a receipt is recorded as verified by whoever receives it)
as 1 "select inv_receive_stock('$AE', '$DXB', 'seed-receipt-individual-1', '[
  {\"item_id\":\"$I_LAP\",\"serials\":[\"LAP-SN-001\",\"LAP-SN-002\",\"LAP-SN-003\"],\"bin_id\":\"$BIN_A\"},
  {\"item_id\":\"$I_VR\",\"serials\":[\"VR-SN-001\",\"VR-SN-002\"],\"bin_id\":\"$BIN_A\"},
  {\"item_id\":\"$I_HOLO\",\"serials\":[\"HF-SN-001\"],\"bin_id\":\"$BIN_B\"},
  {\"item_id\":\"$I_MOT\",\"serials\":[\"MOT-SN-001\",\"MOT-SN-002\"],\"bin_id\":\"$BIN_B\"},
  {\"item_id\":\"$I_CTRL\",\"serials\":[\"CTL-SN-001\",\"CTL-SN-002\"],\"bin_id\":\"$BIN_B\"}]'::jsonb)" >/dev/null
as 1 "select inv_receive_stock('$AE', '$DXB', 'seed-receipt-counted-1', '[
  {\"item_id\":\"$I_SEND\",\"qty\":20,\"bin_id\":\"$BIN_A\"}, {\"item_id\":\"$I_RECV\",\"qty\":30,\"bin_id\":\"$BIN_A\"},
  {\"item_id\":\"$I_HDMI\",\"qty\":12,\"bin_id\":\"$BIN_B\"}, {\"item_id\":\"$I_CABM\",\"qty\":150.5,\"bin_id\":\"$BIN_B\"},
  {\"item_id\":\"$I_TIES\",\"qty\":40,\"bin_id\":\"$BIN_A\"}]'::jsonb)" >/dev/null
# an internal project run by mgr@ (the Project Manager) to request equipment for
PRJ=$(as 3 "select proj_create_internal_project('$AE', 'Showroom refresh', '$U-0000000000a4', false, 'normal', current_date + 10, current_date + 20)")
echo "DXB=$DXB RUH=$RUH POZ=$POZ PRJ=$PRJ"
echo "inventory seeded"
