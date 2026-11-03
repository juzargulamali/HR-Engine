-- READ-ONLY (SELECT only). Run in the SQL Editor of "Enginious HR Engine_V2". Creates, changes and deletes nothing.
-- One row per Inventory location: its company, code, name, status and how much refers to it. Used to decide, location by location,
-- whether two places with the same name (for example "Dubai" under different companies) are separate facilities, duplicates or a
-- workaround for ownership. See docs/inventory-location-review.md. Send back the whole result (CSV).
select
  c.legal_name                                                                       as company,
  l.id                                                                               as location_id,
  l.code, l.name, l.kind, l.timezone,
  case when l.is_active then 'active' else 'switched off' end                        as status,
  l.created_at::date                                                                 as created,
  (select count(*) from inv_units u    where u.location_id = l.id)                   as units_last_or_current_place,
  (select count(*) from inv_units u    where u.location_id = l.id and u.custody_kind = 'warehouse' and u.lifecycle = 'active') as units_on_shelf_now,
  (select count(*) from inv_units u    where u.location_id = l.id and u.company_id <> l.company_id)                              as units_owned_by_another_company,
  (select count(*) from inv_balances b where b.location_id = l.id and b.qty > 0)     as stock_rows_with_quantity,
  (select count(*) from inv_movements m where l.id in (m.from_location_id, m.to_location_id)) as movements,
  (select count(*) from inv_movement_lines ml where l.id in (ml.from_location_id, ml.to_location_id)) as movement_lines,
  (select count(*) from inv_requests r where r.pickup_location_id = l.id and r.status in ('draft', 'submitted', 'in_progress')) as open_requests,
  (select count(*) from inv_transfers t where l.id in (t.from_location_id, t.to_location_id)) as transfers_all,
  (select count(*) from inv_transfers t where l.id in (t.from_location_id, t.to_location_id) and t.status = 'in_transit')       as transfers_in_transit,
  (select count(*) from inv_counts k   where k.location_id = l.id and k.status = 'open') as open_counts,
  (select count(*) from inv_operator_locations o where o.location_id = l.id and o.removed_at is null)                          as assigned_operators,
  (select count(*) from inv_locations d where lower(btrim(d.name)) = lower(btrim(l.name)) and d.id <> l.id)                    as other_locations_with_same_name
from inv_locations l
join companies c on c.id = l.company_id
order by lower(btrim(l.name)), c.legal_name, l.code;
