-- Inventory, migration 3b: shared helpers used by BOTH the stock functions (migration 4) and the planning / availability functions
-- (migration 5). They are the single definition of "usable", "free for a date range" and "precision", so a dispatch and a reservation
-- can never disagree about whether something is available. Internal: no client can execute them directly.

-- All writes that touch the stock or the reservations of one item take this lock first (held until the transaction ends), so two
-- people reserving, issuing or returning the same item at the same instant are serialised and can never oversell it.
create or replace function inv_lock_item(p_item_id uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtextextended('inv_item:' || p_item_id::text, 0));
$$;

-- Validates a quantity for an item: positive, and within the decimals the item allows (whole numbers for individual units and
-- kits; up to 3 decimals for things counted in metres). Returns the quantity unchanged, or raises in plain words.
create or replace function inv_check_qty(p_item_id uuid, p_qty numeric)
returns numeric
language plpgsql stable
as $$
declare v_item inv_items;
begin
  select * into v_item from inv_items where id = p_item_id;
  if v_item.id is null then raise exception 'Unknown item' using errcode = '22023'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'The quantity must be more than zero' using errcode = '22023'; end if;
  if p_qty <> round(p_qty, v_item.quantity_scale) then
    raise exception 'The quantity of % can have at most % decimal place(s)', v_item.name, v_item.quantity_scale using errcode = '22023';
  end if;
  return p_qty;
end;
$$;

-- A local wall-clock time in an IANA zone as a UTC instant. A time that does not exist (the hour skipped when clocks go forward in
-- Poznan) moves forward to the first real instant after the gap; a time that happens twice (clocks go back) is the FIRST occurrence.
create or replace function inv_local_to_utc(p_local timestamp, p_tz text)
returns timestamptz
language sql stable
as $$
  select p_local at time zone p_tz;
$$;

-- Is the unit usable right now, as a thing a person could pick up from a shelf? Reservations do not matter here (separate dimension).
create or replace function inv_unit_usable(p_unit inv_units)
returns boolean
language sql immutable
as $$
  select p_unit.lifecycle = 'active' and p_unit.condition in ('good', 'fair') and p_unit.custody_kind = 'warehouse' and p_unit.in_kit_id is null;
$$;

-- Is the individual unit (or kit) free for [p_from, p_until) at a location? True when ALL hold:
--   * it is active, in good or fair condition, not packed inside a kit, not an employee's equipment, not missing / retired;
--   * it is on the shelf at that location now, OR it is out on a project / in transit and its recorded return (or arrival) is on
--     time, falls before p_from, and is not already overdue: an overdue unit is never presented as physically ready;
--   * no ACTIVE reservation of the unit overlaps the range (ignoring p_exclude_line's own reservations, for re-checks).
create or replace function inv_unit_free(p_unit_id uuid, p_from timestamptz, p_until timestamptz, p_location_id uuid, p_exclude_line uuid default null)
returns boolean
language sql stable
as $$
  select u.lifecycle = 'active' and u.condition in ('good', 'fair') and u.in_kit_id is null
     and (   (u.custody_kind = 'warehouse' and u.location_id = p_location_id)
          or (u.custody_kind = 'project' and u.expected_return_at is not null and u.expected_return_at >= now()
              and u.expected_return_at <= p_from and u.location_id = p_location_id)
          or (u.custody_kind = 'transit' and exists (select 1 from inv_transfers t where t.id = u.transfer_id and t.to_location_id = p_location_id
                                                       and t.expected_at is not null and t.expected_at >= now() and t.expected_at <= p_from)))
     and not exists (select 1 from inv_reservations r
                      where r.unit_id = u.id and r.status = 'active'
                        and r.reserved_during && tstzrange(p_from, p_until)
                        and (p_exclude_line is null or r.request_line_id <> p_exclude_line))
  from inv_units u where u.id = p_unit_id;
$$;

-- How many of an item (owned stock, or rental stock when p_rental is true) can be promised from a location for [p_from, p_until):
--   good stock on the shelf there
--   + good stock out on projects whose recorded return is on time and before p_from (never overdue stock)
--   - reservations that overlap the range and are not yet physically out (dispatched quantities have already left the shelf).
-- Quantity stock in transit counts once its transfer's expected arrival (not overdue) is before p_from. The caller holds inv_lock_item.
create or replace function inv_qty_free(p_item_id uuid, p_location_id uuid, p_from timestamptz, p_until timestamptz, p_exclude_line uuid default null, p_rental boolean default false)
returns numeric
language sql stable
as $$
  select greatest(0,
      coalesce((select sum(b.qty) from inv_balances b
                 where b.item_id = p_item_id and b.holder_kind = 'warehouse' and b.location_id = p_location_id and b.condition = 'good'
                   and (b.rental_id is not null) = p_rental), 0)
    + coalesce((select sum(b.qty) from inv_balances b
                 where b.item_id = p_item_id and b.holder_kind = 'project' and b.condition = 'good' and (b.rental_id is not null) = p_rental
                   and b.expected_return_at is not null and b.expected_return_at >= now() and b.expected_return_at <= p_from
                   and exists (select 1 from inv_movement_lines l where l.to_balance_id = b.id and l.from_location_id = p_location_id)), 0)
    + coalesce((select sum(b.qty) from inv_balances b join inv_transfers t on t.id = b.transfer_id
                 where b.item_id = p_item_id and b.holder_kind = 'transit' and b.condition = 'good' and (b.rental_id is not null) = p_rental
                   and t.to_location_id = p_location_id and t.expected_at is not null and t.expected_at >= now() and t.expected_at <= p_from), 0)
    - coalesce((select sum(r.qty - r.dispatched_qty) from inv_reservations r
                 where r.item_id = p_item_id and r.unit_id is null and r.location_id = p_location_id and r.status = 'active'
                   and r.reserved_during && tstzrange(p_from, p_until)
                   and (p_exclude_line is null or r.request_line_id <> p_exclude_line)), 0));
$$;

-- Called by every function that moves a unit to or from an employee, in the same transaction. Here it does nothing; migration 6
-- replaces it with the version that keeps the earlier HR asset register (assets / asset_assignments) in step for units that were
-- reconciled from it, so HR's employee page never disagrees with Inventory.
create or replace function inv_mirror_legacy(p_unit_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  return;
end;
$$;

revoke all on function inv_lock_item(uuid), inv_check_qty(uuid, numeric), inv_local_to_utc(timestamp, text), inv_unit_usable(inv_units),
  inv_unit_free(uuid, timestamptz, timestamptz, uuid, uuid), inv_qty_free(uuid, uuid, timestamptz, timestamptz, uuid, boolean), inv_mirror_legacy(uuid)
  from public, anon, authenticated;

-- ROLLBACK (only before any Inventory data exists):
--   drop function if exists inv_mirror_legacy(uuid), inv_qty_free(uuid, uuid, timestamptz, timestamptz, uuid, boolean),
--     inv_unit_free(uuid, timestamptz, timestamptz, uuid, uuid), inv_unit_usable(inv_units), inv_local_to_utc(timestamp, text),
--     inv_check_qty(uuid, numeric), inv_lock_item(uuid);
