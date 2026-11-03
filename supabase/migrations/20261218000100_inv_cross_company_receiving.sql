-- Cross-company receiving: the receiving company's warehouse operators can see the MINIMUM they need to receive and handle another company's
-- equipment at their warehouse, and both authorised sides can trace the same transfer through dispatch and receipt.
--
-- Owner decision implemented here, and nothing broader: sharing-authorised receiving-company warehouse operators may view the minimum equipment and
-- transfer information needed to receive and handle stock at their assigned warehouses, including incoming transfers. The original owner, barcode and
-- serial are preserved. Costs and unrelated company records stay restricted. Both authorised sides can trace the same transfer.
--
-- How (functions only; no table, column, policy, trigger or privilege on any table is changed, so every existing read keeps working exactly as before):
--   * "Authorised" is the EXISTING sharing arrangement (inv_company_sharing, made by a founder of the OWNING company, revoked_at is null) and "assigned
--     warehouse" is the EXISTING operate right (inv_can_operate: founder of the warehouse's company, or a warehouse operator assigned to it or holding
--     cross_location). An inactive person has neither (the existing helpers join profiles.is_active). Revoke the sharing and access ends at once.
--   * Nothing is read through the base tables: each function is SECURITY DEFINER, picks only the rows described below and returns only the fields
--     named below. No cost, supplier, rental supplier, notes, photos, employee, project or request detail is returned by any of them.
--   * inv_transfer_receive, inv_transfer_dispatch, inv_check_sharing and inv_availability are NOT changed: receipt stays under its existing business
--     checks, and inv_units.company_id (the owner) is never touched by anything here.
--
--   inv_xshare_destinations()              authorised destination warehouses of other companies the caller could send to (id, name, company only)
--   inv_xshare_transfers()                 cross-company transfers the caller is a party to (owner / sender side, or receiving operator)
--   inv_xshare_transfer_trace(transfer)    one such transfer: header, its lines, and the dispatch / receipt events filed under EITHER company
--   inv_xshare_units(location, code)       other companies' units that are in transit to, or on the shelf at, a warehouse the caller operates
--   inv_xshare_availability(item, location) counts of those units for one item at one warehouse the caller operates
--   inv_xshare_active, inv_xshare_may_handle, inv_xshare_sees   internal helpers (callable by nobody signed in)
--
-- Safe to run twice. ROLLBACK: supabase/manual-sql/inv_xshare_90_rollback.sql (drops these functions only; nothing else changed).

-- Is there an active sharing authorisation from the owning company to the company that would use / hold the equipment?
create or replace function inv_xshare_active(p_owner uuid, p_use uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_owner is not null and p_use is not null and p_owner <> p_use
     and exists (select 1 from inv_company_sharing s where s.company_id = p_owner and s.use_company_id = p_use and s.revoked_at is null);
$$;

-- May the caller handle equipment owned by p_owner at this location of ANOTHER company? Active sharing from the owner to the location's company
-- AND the caller can operate that location (the same right that lets them receive there).
create or replace function inv_xshare_may_handle(p_owner uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from inv_locations l
                  where l.id = p_location_id and l.company_id <> p_owner
                    and inv_xshare_active(p_owner, l.company_id) and inv_can_operate(l.id));
$$;

-- May the caller see a transfer line of equipment owned by p_owner moving p_from -> p_to? The owner's own stock readers (existing right), or someone who
-- may handle that owner's equipment at the origin or at the destination.
create or replace function inv_xshare_sees(p_owner uuid, p_from uuid, p_to uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select inv_can_view_stock(p_owner) or inv_xshare_may_handle(p_owner, p_from) or inv_xshare_may_handle(p_owner, p_to);
$$;

-- Where could the caller send equipment that belongs to a company whose warehouse they operate? Warehouses of OTHER companies that the owner has
-- authorised, and only those. Returns identifiers and names only.
create or replace function inv_xshare_destinations()
returns table (location_id uuid, location_code text, location_name text, timezone text, company_id uuid, company_name text, owner_company_id uuid, owner_company_name text)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform inv_require_user();
  return query
  select l.id, l.code, l.name, l.timezone, l.company_id, cu.legal_name, s.company_id, co.legal_name
    from inv_company_sharing s
    join inv_locations l on l.company_id = s.use_company_id and l.is_active
    join companies cu on cu.id = l.company_id
    join companies co on co.id = s.company_id
   where s.revoked_at is null
     and exists (select 1 from inv_locations lf where lf.company_id = s.company_id and lf.is_active and inv_can_operate(lf.id))
   order by cu.legal_name, l.name;
end;
$$;

-- Cross-company transfers the caller is a party to. A transfer is listed when at least one of its lines is equipment the caller may see (see
-- inv_xshare_sees). Same-company transfers are not listed here (they are read through the existing policies).
create or replace function inv_xshare_transfers()
returns table (transfer_id uuid, code text, status text, sender_company_id uuid, sender_company_name text,
               from_location_id uuid, from_location_name text, to_location_id uuid, to_location_name text, to_company_id uuid, to_company_name text,
               dispatched_at timestamptz, expected_at timestamptz, received_at timestamptz, carrier text, reference text,
               dispatched_by_name text, received_by_name text, line_count integer, still_on_the_way integer)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform inv_require_user();
  return query
  select t.id, t.code, t.status, t.company_id, cs.legal_name,
         lf.id, lf.name, lt.id, lt.name, lt.company_id, ct.legal_name,
         t.dispatched_at, t.expected_at, t.received_at, t.carrier, t.reference,
         pd.full_name, pr.full_name,
         (select count(*)::integer from inv_movement_lines l join inv_movements m on m.id = l.movement_id join inv_items i on i.id = l.item_id
           where m.transfer_id = t.id and m.kind = 'transfer_dispatch' and inv_xshare_sees(i.company_id, t.from_location_id, t.to_location_id)),
         ((select count(*)::integer from inv_units x join inv_items i on i.id = x.item_id
            where x.transfer_id = t.id and x.custody_kind = 'transit' and inv_xshare_sees(i.company_id, t.from_location_id, t.to_location_id))
        + (select count(*)::integer from inv_balances b join inv_items i on i.id = b.item_id
            where b.transfer_id = t.id and b.holder_kind = 'transit' and b.qty > 0 and inv_xshare_sees(i.company_id, t.from_location_id, t.to_location_id)))
    from inv_transfers t
    join inv_locations lf on lf.id = t.from_location_id
    join inv_locations lt on lt.id = t.to_location_id
    join companies cs on cs.id = t.company_id
    join companies ct on ct.id = lt.company_id
    left join profiles pd on pd.id = t.dispatched_by
    left join profiles pr on pr.id = t.received_by
   where lf.company_id <> lt.company_id
     and exists (select 1 from inv_movement_lines l join inv_movements m on m.id = l.movement_id join inv_items i on i.id = l.item_id
                  where m.transfer_id = t.id and m.kind = 'transfer_dispatch' and inv_xshare_sees(i.company_id, t.from_location_id, t.to_location_id))
   order by t.dispatched_at desc
   limit 300;
end;
$$;

-- One cross-company transfer as the caller may see it: header, lines (units and counted quantities) and the dispatch and receipt events, whichever
-- company they are filed under. Only lines of equipment the caller may see are returned, in the header and in every event. No notes, costs,
-- suppliers, employees or projects. A unit's current state (condition, custody) is returned only while it is still the caller's to handle (on the way
-- here or there, or on the shelf at the origin or destination) or to the owner's own stock readers; its identity (code, serial, item, owner) always is.
create or replace function inv_xshare_transfer_trace(p_transfer_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  t inv_transfers; lf inv_locations; lt inv_locations; v_head jsonb; v_units jsonb; v_qty jsonb; v_events jsonb;
begin
  perform inv_require_user();
  select * into t from inv_transfers where id = p_transfer_id;
  if t.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
  select * into lf from inv_locations where id = t.from_location_id;
  select * into lt from inv_locations where id = t.to_location_id;
  if lf.company_id = lt.company_id
     or not exists (select 1 from inv_movement_lines l join inv_movements m on m.id = l.movement_id join inv_items i on i.id = l.item_id
                     where m.transfer_id = t.id and m.kind = 'transfer_dispatch' and inv_xshare_sees(i.company_id, t.from_location_id, t.to_location_id)) then
    raise exception 'Transfer not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
           'transfer_id', t.id, 'code', t.code, 'status', t.status,
           'sender_company_id', t.company_id, 'sender_company_name', (select legal_name from companies where id = t.company_id),
           'from_location_id', lf.id, 'from_location_name', lf.name, 'to_location_id', lt.id, 'to_location_name', lt.name,
           'to_company_id', lt.company_id, 'to_company_name', (select legal_name from companies where id = lt.company_id),
           'dispatched_at', t.dispatched_at, 'expected_at', t.expected_at, 'received_at', t.received_at, 'carrier', t.carrier, 'reference', t.reference,
           'dispatched_by_name', (select full_name from profiles where id = t.dispatched_by),
           'received_by_name', (select full_name from profiles where id = t.received_by))
    into v_head;

  -- Units: every unit the dispatch listed (the ledger line is immutable, so a received unit stays listed).
  select coalesce(jsonb_agg(jsonb_build_object(
           'unit_id', u.id, 'code', u.code, 'serial_number', u.serial_number, 'item_id', i.id, 'item_name', i.name,
           'category', (select c.name from inv_categories c where c.id = i.category_id),
           'ownership', u.ownership, 'owner_company_id', u.company_id, 'owner_company_name', (select legal_name from companies where id = u.company_id),
           'on_the_way', (u.custody_kind = 'transit' and u.transfer_id = t.id),
           'at_destination', (u.custody_kind = 'warehouse' and u.location_id = t.to_location_id),
           'condition', case when s.state_visible then u.condition end,
           'custody_kind', case when s.state_visible then u.custody_kind end) order by u.code), '[]'::jsonb)
    into v_units
    from (select distinct l.unit_id from inv_movement_lines l join inv_movements m on m.id = l.movement_id
           where m.transfer_id = t.id and m.kind = 'transfer_dispatch' and l.unit_id is not null) d
    join inv_units u on u.id = d.unit_id
    join inv_items i on i.id = u.item_id
    cross join lateral (select inv_xshare_sees(u.company_id, t.from_location_id, t.to_location_id) as seen,
                               (inv_can_view_stock(u.company_id)
                                or (u.custody_kind = 'transit' and u.transfer_id = t.id)
                                or (u.custody_kind = 'warehouse' and u.location_id in (t.from_location_id, t.to_location_id) and inv_xshare_may_handle(u.company_id, u.location_id))) as state_visible) s
   where s.seen;

  -- Counted quantities: what the dispatch sent and what is still on the way.
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.id, 'item_name', i.name, 'category', (select c.name from inv_categories c where c.id = i.category_id), 'unit_of_measure', i.unit_of_measure,
           'owner_company_id', i.company_id, 'owner_company_name', (select legal_name from companies where id = i.company_id),
           'qty_sent', q.sent,
           'qty_on_the_way', coalesce((select sum(b.qty) from inv_balances b where b.transfer_id = t.id and b.holder_kind = 'transit' and b.item_id = i.id), 0),
           'on_the_way', coalesce((select jsonb_agg(jsonb_build_object('condition', b.condition, 'qty', b.qty, 'rented', b.rental_id is not null) order by b.condition, b.rental_id nulls first)
                                     from inv_balances b where b.transfer_id = t.id and b.holder_kind = 'transit' and b.item_id = i.id and b.qty > 0), '[]'::jsonb)
         ) order by i.name), '[]'::jsonb)
    into v_qty
    from (select l.item_id, sum(l.qty) as sent from inv_movement_lines l join inv_movements m on m.id = l.movement_id
           where m.transfer_id = t.id and m.kind = 'transfer_dispatch' and l.unit_id is null group by l.item_id) q
    join inv_items i on i.id = q.item_id
   where inv_xshare_sees(i.company_id, t.from_location_id, t.to_location_id);

  -- Events: the dispatch and each receipt, filed under whichever company made them. Only lines the caller may see; an event with none is left out.
  select coalesce(jsonb_agg(e.j order by e.at, e.rec), '[]'::jsonb)
    into v_events
    from (select m.occurred_at as at, m.recorded_at as rec,
                 jsonb_build_object(
                   'movement_code', m.code, 'kind', m.kind, 'occurred_at', m.occurred_at,
                   'by_name', (select full_name from profiles where id = m.performed_by),
                   'filed_under_company_id', m.company_id, 'filed_under_company_name', (select legal_name from companies where id = m.company_id),
                   'from_location_id', m.from_location_id, 'to_location_id', m.to_location_id,
                   'lines', (select jsonb_agg(jsonb_build_object('unit_id', l.unit_id, 'code', u.code, 'item_id', l.item_id, 'item_name', i.name, 'qty', l.qty,
                                                                  'condition_from', l.condition_from, 'condition_to', l.condition_to) order by u.code, i.name)
                               from inv_movement_lines l join inv_items i on i.id = l.item_id left join inv_units u on u.id = l.unit_id
                              where l.movement_id = m.id and inv_xshare_sees(i.company_id, t.from_location_id, t.to_location_id))) as j
            from inv_movements m
           where m.transfer_id = t.id and m.kind in ('transfer_dispatch', 'transfer_receive')
             and exists (select 1 from inv_movement_lines l join inv_items i on i.id = l.item_id
                          where l.movement_id = m.id and inv_xshare_sees(i.company_id, t.from_location_id, t.to_location_id))) e;

  return jsonb_build_object('transfer', v_head, 'units', v_units, 'quantities', v_qty, 'events', v_events);
end;
$$;

-- Other companies' units that are in transit TO, or on the shelf AT, a warehouse the caller operates, under an active sharing authorisation. The
-- minimum needed to receive and handle them: identity (code, serial, item, category, owner), condition and status, the place, and the transfer.
-- Optionally for one warehouse and/or one exact unit code (the scan). Never costs, notes, bins of others, custody details or other stock of the owner.
create or replace function inv_xshare_units(p_location_id uuid default null, p_code text default null)
returns table (unit_id uuid, code text, serial_number text, item_id uuid, item_name text, category_name text, condition text, custody_kind text,
               ownership text, owner_company_id uuid, owner_company_name text, location_id uuid, location_name text, location_company_id uuid,
               bin_id uuid, bin_code text, transfer_id uuid, transfer_code text, usable_here boolean)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform inv_require_user();
  return query
  select u.id, u.code, u.serial_number, i.id, i.name, c.name, u.condition, u.custody_kind,
         u.ownership, u.company_id, co.legal_name, l.id, l.name, l.company_id,
         case when u.custody_kind = 'warehouse' then u.bin_id end, case when u.custody_kind = 'warehouse' then b.code end,
         case when u.custody_kind = 'transit' then t.id end, case when u.custody_kind = 'transit' then t.code end,
         (inv_unit_usable(u) and u.location_id = l.id)
    from inv_units u
    join inv_items i on i.id = u.item_id
    left join inv_categories c on c.id = i.category_id
    join companies co on co.id = u.company_id
    left join inv_transfers t on t.id = u.transfer_id and u.custody_kind = 'transit' and t.status = 'in_transit'
    join inv_locations l on l.id = (case when u.custody_kind = 'transit' then t.to_location_id else u.location_id end)
    left join inv_bins b on b.id = u.bin_id
   where u.lifecycle = 'active' and u.in_kit_id is null
     and u.custody_kind in ('warehouse', 'transit')
     and inv_xshare_may_handle(u.company_id, l.id)
     and (p_location_id is null or l.id = p_location_id)
     and (p_code is null or u.code = p_code)
   order by l.name, u.code
   limit 2000;
end;
$$;

-- Availability of ONE item at ONE warehouse the caller operates, counting only other companies' units the caller may handle there. Same keys as
-- inv_availability's counts; nothing about the owner's stock elsewhere. A warehouse the caller cannot operate is "not found".
create or replace function inv_xshare_availability(p_item_id uuid, p_location_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform inv_require_user();
  if p_location_id is null or not inv_can_operate(p_location_id) then raise exception 'Location not found' using errcode = 'P0002'; end if;
  select jsonb_build_object(
           'physical_at_location', count(*) filter (where x.custody_kind = 'warehouse'),
           'usable_now', count(*) filter (where x.usable),
           'in_transit', count(*) filter (where x.custody_kind = 'transit'))
    into v
    from (select u.custody_kind, (inv_unit_usable(u) and u.location_id = p_location_id) as usable
            from inv_units u left join inv_transfers t on t.id = u.transfer_id and u.custody_kind = 'transit' and t.status = 'in_transit'
           where u.item_id = p_item_id and u.lifecycle = 'active' and u.in_kit_id is null
             and ((u.custody_kind = 'warehouse' and u.location_id = p_location_id)
                  or (u.custody_kind = 'transit' and t.to_location_id = p_location_id))
             and inv_xshare_may_handle(u.company_id, p_location_id)) x;
  return v;
end;
$$;

revoke all on function inv_xshare_active(uuid, uuid), inv_xshare_may_handle(uuid, uuid), inv_xshare_sees(uuid, uuid, uuid),
  inv_xshare_destinations(), inv_xshare_transfers(), inv_xshare_transfer_trace(uuid), inv_xshare_units(uuid, text), inv_xshare_availability(uuid, uuid)
  from public, anon, authenticated;
grant execute on function inv_xshare_destinations(), inv_xshare_transfers(), inv_xshare_transfer_trace(uuid), inv_xshare_units(uuid, text),
  inv_xshare_availability(uuid, uuid) to authenticated;
