-- Inventory: a project's Equipment page now shows ALL equipment out on the project.
-- Before: "Equipment still out" was built only from reservations of the project's requests. Equipment the warehouse dispatched to the project
-- WITHOUT naming a request (the request is optional on the Dispatch form) was on the project but invisible to its manager ("Nothing is out on this
-- project right now"), and no outstanding line said when it was due back or that it was overdue.
-- Now the function also returns each outstanding line's expected return and whether it is overdue, and an `unlinked` list of units and quantities held by the
-- project that no request accounts for. Same name and signature (jsonb), same privileges (create or replace keeps them); only the jsonb it returns grows.

create or replace function inv_project_equipment(p_project_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  pr proj_projects;
  v_requests jsonb;
  v_short jsonb;
  v_out jsonb;
begin
  perform inv_require_user();
  select * into pr from proj_projects where id = p_project_id;
  if not found or not (proj_can_view_details(pr.id) or inv_is_founder(pr.company_id) or inv_has_capability(pr.company_id, 'warehouse')) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'code', q.code, 'status', q.status, 'title', q.title, 'destination', q.destination, 'timezone', q.timezone, 'plan', q.plan,
      'needed_from', q.needed_from, 'needed_until', q.needed_until, 'expected_return_at', q.expected_return_at,
      'source', q.source, 'note', q.note, 'version', q.version, 'submitted_at', q.submitted_at, 'cancelled_at', q.cancelled_at, 'cancel_reason', q.cancel_reason,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', l.id, 'item_id', l.item_id, 'item_name', i.name, 'model', i.model, 'qty', l.qty, 'status', l.status, 'is_optional', l.is_optional,
            'technology', l.technology_snapshot->>'name', 'alt_group', l.alt_group,
            'substitution_status', l.substitution_status, 'original_item_id', l.original_item_id, 'original_item_name', oi.name,
            'shortage_action', l.shortage_action, 'shortage_note', l.shortage_note, 'rental_reference', l.rental_reference, 'note', l.note,
            'progress', inv_line_progress(l),
            'reservations', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', x.id, 'unit_id', x.unit_id, 'unit_code', u.code, 'serial_number', u.serial_number, 'item_name', xi.name, 'qty', x.qty,
                  'dispatched_qty', x.dispatched_qty, 'returned_qty', x.returned_qty, 'from', lower(x.reserved_during), 'until', upper(x.reserved_during),
                  'status', x.status, 'released_reason', x.released_reason,
                  'covers_request_window', q.needed_from is not null and lower(x.reserved_during) <= q.needed_from and upper(x.reserved_during) >= q.needed_until)
                  order by x.made_at, x.id)
                from inv_reservations x join inv_items xi on xi.id = x.item_id left join inv_units u on u.id = x.unit_id
               where x.request_line_id = l.id), '[]'::jsonb)) order by l.sort_order, l.id)
          from inv_request_lines l join inv_items i on i.id = l.item_id left join inv_items oi on oi.id = l.original_item_id
         where l.request_id = q.id), '[]'::jsonb)) order by q.created_at, q.id), '[]'::jsonb)
    into v_requests from inv_requests q where q.project_id = pr.id;
  select coalesce(jsonb_agg(jsonb_build_object('request_code', q.code, 'line_id', l.id, 'item_name', i.name, 'short_qty', (inv_line_progress(l)->>'shortage')::numeric,
           'shortage_action', l.shortage_action, 'rental_reference', l.rental_reference) order by q.created_at, l.sort_order), '[]'::jsonb)
    into v_short
    from inv_requests q join inv_request_lines l on l.request_id = q.id join inv_items i on i.id = l.item_id
   where q.project_id = pr.id and (inv_line_progress(l)->>'shortage')::numeric > 0;
  v_out := jsonb_build_object('project_id', pr.id, 'requests', v_requests, 'shortages', v_short,
    'outstanding', coalesce((
      select jsonb_agg(jsonb_build_object('request_code', q.code, 'line_id', l.id, 'item_name', i.name, 'unit_code', u.code, 'serial_number', u.serial_number,
               'qty_outstanding', x.dispatched_qty - x.returned_qty, 'unit_lifecycle', u.lifecycle,
               'expected_return_at', coalesce(u.expected_return_at, (select min(b.expected_return_at) from inv_balances b where b.holder_kind = 'project' and b.project_id = pr.id and b.item_id = x.item_id and b.qty > 0)),
               'overdue', coalesce(coalesce(u.expected_return_at, (select min(b.expected_return_at) from inv_balances b where b.holder_kind = 'project' and b.project_id = pr.id and b.item_id = x.item_id and b.qty > 0)) < now(), false)) order by q.created_at, x.made_at)
        from inv_reservations x join inv_request_lines l on l.id = x.request_line_id join inv_requests q on q.id = l.request_id
             join inv_items i on i.id = x.item_id left join inv_units u on u.id = x.unit_id
       where q.project_id = pr.id and x.status = 'active' and x.dispatched_qty > x.returned_qty), '[]'::jsonb),
    -- Equipment the warehouse sent to this project WITHOUT naming a request (the request is optional when dispatching): it is on the project all the
    -- same, so the project sees it, with the date it is due back and whether that has passed.
    'unlinked', (
      coalesce((
        select jsonb_agg(jsonb_build_object('item_name', i.name, 'unit_of_measure', i.unit_of_measure, 'unit_code', u.code, 'serial_number', u.serial_number, 'qty_outstanding', 1, 'unit_lifecycle', u.lifecycle,
                 'expected_return_at', u.expected_return_at, 'overdue', coalesce(u.expected_return_at < now(), false)) order by u.code)
          from inv_units u join inv_items i on i.id = u.item_id
         where u.custody_kind = 'project' and u.project_id = pr.id
           and not exists (select 1 from inv_reservations x where x.unit_id = u.id and x.status = 'active' and x.dispatched_qty > x.returned_qty)), '[]'::jsonb)
      ||
      coalesce((
        select jsonb_agg(jsonb_build_object('item_name', i.name, 'unit_of_measure', i.unit_of_measure, 'unit_code', null, 'serial_number', null, 'qty_outstanding', h.held - h.linked, 'unit_lifecycle', 'active',
                 'expected_return_at', h.due, 'overdue', coalesce(h.due < now(), false)) order by i.name)
          from (select b.item_id, sum(b.qty) as held, min(b.expected_return_at) as due,
                       coalesce((select sum(x.dispatched_qty - x.returned_qty) from inv_reservations x join inv_request_lines l on l.id = x.request_line_id join inv_requests q on q.id = l.request_id
                                  where q.project_id = pr.id and x.item_id = b.item_id and x.unit_id is null and x.status = 'active' and x.dispatched_qty > x.returned_qty), 0) as linked
                  from inv_balances b where b.holder_kind = 'project' and b.project_id = pr.id and b.qty > 0 group by b.item_id) h
          join inv_items i on i.id = h.item_id
         where h.held > h.linked), '[]'::jsonb)));
  return v_out;
end;
$$;
