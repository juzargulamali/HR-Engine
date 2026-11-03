-- Launch package 3a: dispatch notes and return checklists (database layer). C1, C2, C7.
--
-- WHAT THIS ADDS. When the warehouse records a dispatch to a project (or a return from it), the system can keep a frozen, numbered copy of exactly what was
-- recorded (UAE-D-00017 for a dispatch note, UAE-RT-00005 for a return checklist), show it to the project's Project Manager (PM), and let the PM acknowledge it or report
-- a difference. The recorded movement stays the ONLY authority for where equipment is. A note, an acknowledgement or a dispute never moves stock, never changes
-- availability, custody, reservations or booking conflicts, never rewrites movement history, and never creates a write-off, deduction or penalty.
--
--   * Counters 'dispatch_note' and 'return_note' (numbers <ref>-D-nnnnn and <ref>-RT-nnnnn, per company of the WAREHOUSE LOCATION, never reset, no gaps: a number is
--     taken inside the movement transaction and rolls back with it). inv_next_code gains the two kinds; every other kind behaves exactly as before.
--   * inv_project_notes: one frozen row per movement (header snapshot + payload + hash). EVERY column is frozen: a guard trigger refuses any UPDATE, DELETE or TRUNCATE for
--     every role (the service role included). A correction is a NEW note that cites the old one; the old note is never altered.
--   * inv_project_note_events: append-only history (acknowledged, difference reported / withdrawn, resolved, correction cited). Same guard.
--   * inv_project_note_status: the current state of each note, derived from its own events (waiting for the PM, acknowledged, difference open, superseded). The pending
--     action therefore lives on the note record and can be listed per project and in "Needs me"; no notice or approval is involved.
--   * inv_make_project_note(movement) (internal), inv_ack_project_note (PM / acting PM / Projects founder, checked at the moment of the click, capacity recorded),
--     inv_resolve_note_difference (warehouse operator at the location only), inv_notes_waiting_for_me, inv_set_project_notes (founder switch).
--   * The per-company switch inv_company_settings.project_notes_enabled is OFF by default. With it off, inv_dispatch_to_project and inv_return_from_project behave
--     exactly as before: they only gain one guarded call that is skipped. With it on, the note is made INSIDE the movement transaction, so there is never a dispatch without
--     its note or a note without its dispatch; if the note cannot be made, the movement is refused and nothing is recorded.
--
-- Prerequisites: Inventory (20261201*) and Projects (20261120*) migrations. Additive and idempotent (safe to run twice). Nothing is read from or written to HR tables.

-- -----------------------------------------------------------------------------
-- The per-company switch (C7). Off by default; changes are audited by the existing inv_company_settings audit trigger.
-- -----------------------------------------------------------------------------
alter table inv_company_settings add column if not exists project_notes_enabled boolean not null default false;

-- -----------------------------------------------------------------------------
-- Counters (C1): the two new kinds
-- -----------------------------------------------------------------------------
alter table inv_reference_counters drop constraint if exists inv_reference_counters_kind_check;
alter table inv_reference_counters add constraint inv_reference_counters_kind_check
  check (kind in ('unit', 'stock', 'request', 'transfer', 'movement', 'count', 'dispatch_note', 'return_note'));

-- Identical to the earlier definition except for the two new kinds: UAE-D-00001 (dispatch notes), UAE-RT-00001 (return checklists).
create or replace function inv_next_code(p_company_id uuid, p_kind text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text;
  v_n bigint;
  v_letter text := case p_kind when 'unit' then 'E' when 'stock' then 'S' when 'request' then 'R' when 'transfer' then 'T'
                              when 'movement' then 'M' when 'count' then 'C' when 'dispatch_note' then 'D' when 'return_note' then 'RT' end;
begin
  if v_letter is null then raise exception 'Unknown code kind %', p_kind using errcode = '22023'; end if;
  select reference_code into v_code from inv_company_settings where company_id = p_company_id;
  if v_code is null then
    raise exception 'An Inventory reference code has not been set for this company yet. A founder sets it under Manage.' using errcode = '23514';
  end if;
  insert into inv_reference_counters (company_id, kind, last_value) values (p_company_id, p_kind, 1)
  on conflict (company_id, kind) do update set last_value = inv_reference_counters.last_value + 1
  returning last_value into v_n;
  return v_code || '-' || v_letter || '-' || lpad(v_n::text, 5, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Frozen notes and append-only events (C1)
-- -----------------------------------------------------------------------------
create table if not exists inv_project_notes (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),            -- the company of the WAREHOUSE LOCATION (same as the movement); it numbers the note
  kind               text not null check (kind in ('dispatch', 'return')),
  note_no            text not null unique,                              -- UAE-D-00017 / UAE-RT-00005
  movement_id        uuid not null unique references inv_movements(id), -- one note per movement
  movement_code      text not null,                                     -- the ledger reference (UAE-M-00031)
  project_id         uuid not null references proj_projects(id),
  project_company_id uuid not null references companies(id),            -- printed too when it differs from company_id (cross-company sharing)
  project_ref        text not null,
  project_name       text not null,
  destination        text,                                              -- the project's site text at the moment of recording
  site_timezone      text,
  location_id        uuid not null references inv_locations(id),        -- the warehouse location that recorded it (who may resolve a difference)
  location_name      text not null,
  location_timezone  text not null,                                     -- the ledger stores only UTC; this is the zone the times are shown in
  recorded_by        uuid not null references auth.users(id),
  recorded_by_name   text not null,
  recorded_by_role   text,
  pm_user_id_at_time uuid references auth.users(id),
  pm_name_at_time    text,
  occurred_at        timestamptz not null,
  expected_return_at timestamptz,
  request_id         uuid,
  request_code       text,
  replaces_note_id   uuid references inv_project_notes(id),             -- a correction note cites the note it replaces
  payload            jsonb not null check (jsonb_typeof(payload) = 'object'),   -- the frozen lines (and, for a return, the project totals)
  payload_hash       text not null,
  created_at         timestamptz not null default now(),
  constraint inv_project_notes_no_format check (note_no ~ case kind when 'dispatch' then '^[A-Z]{2,5}-D-[0-9]{5,}$' else '^[A-Z]{2,5}-RT-[0-9]{5,}$' end),
  constraint inv_project_notes_not_self check (replaces_note_id is null or replaces_note_id <> id)
);
create index if not exists idx_inv_project_notes_project on inv_project_notes(project_id, created_at desc);
create index if not exists idx_inv_project_notes_company on inv_project_notes(company_id, created_at desc);
create index if not exists idx_inv_project_notes_replaces on inv_project_notes(replaces_note_id) where replaces_note_id is not null;

create table if not exists inv_project_note_events (
  id                 uuid primary key default gen_random_uuid(),
  seq                bigint generated always as identity,               -- the order of events within a note
  note_id            uuid not null references inv_project_notes(id),
  company_id         uuid not null references companies(id),
  project_id         uuid not null references proj_projects(id),
  event              text not null check (event in ('acknowledged', 'difference_reported', 'difference_withdrawn', 'resolved_record_stands', 'resolved_corrected', 'correction_of')),
  by_user            uuid not null references auth.users(id),
  by_name            text not null,
  capacity           text not null check (capacity in ('pm', 'acting_pm', 'projects_founder', 'warehouse')),
  at                 timestamptz not null default now(),
  reason             text,                                              -- difference_reported only
  lines              jsonb check (lines is null or jsonb_typeof(lines) = 'array'),   -- difference_reported: the line numbers of the note
  comment            text check (comment is null or length(comment) <= 2000),
  linked_note_id     uuid references inv_project_notes(id),
  linked_movement_id uuid references inv_movements(id),
  constraint inv_project_note_events_reason check ((event = 'difference_reported') = (reason is not null))
);
create unique index if not exists uq_inv_project_note_events_seq on inv_project_note_events(seq);
create index if not exists idx_inv_project_note_events_note on inv_project_note_events(note_id, seq);
create index if not exists idx_inv_project_note_events_project on inv_project_note_events(project_id);

-- Nothing about a note or its history is ever edited or deleted, by anyone (a table owner or the service role included): the same guard on both tables.
create or replace function inv_project_notes_frozen()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A dispatch note or return checklist and its history are never edited or deleted. A correction is a new note that cites the old one.' using errcode = '55000';
end;
$$;
drop trigger if exists inv_project_notes_frozen_row on inv_project_notes;
create trigger inv_project_notes_frozen_row before update or delete on inv_project_notes for each row execute function inv_project_notes_frozen();
drop trigger if exists inv_project_notes_frozen_truncate on inv_project_notes;
create trigger inv_project_notes_frozen_truncate before truncate on inv_project_notes for each statement execute function inv_project_notes_frozen();
drop trigger if exists inv_project_note_events_frozen_row on inv_project_note_events;
create trigger inv_project_note_events_frozen_row before update or delete on inv_project_note_events for each row execute function inv_project_notes_frozen();
drop trigger if exists inv_project_note_events_frozen_truncate on inv_project_note_events;
create trigger inv_project_note_events_frozen_truncate before truncate on inv_project_note_events for each statement execute function inv_project_notes_frozen();

-- Who reads what: project members and the Projects founder of the project's company (proj_can_view_details), and Inventory warehouse / view_stock holders of the
-- warehouse company (they read the ledger already). A Project Manager needs NO Inventory grant to read the notes of their project, and still cannot read the ledger.
alter table inv_project_notes enable row level security;
drop policy if exists inv_project_notes_select on inv_project_notes;
create policy inv_project_notes_select on inv_project_notes for select
  using (proj_can_view_details(project_id) or inv_can_view_stock(company_id));
alter table inv_project_note_events enable row level security;
drop policy if exists inv_project_note_events_select on inv_project_note_events;
create policy inv_project_note_events_select on inv_project_note_events for select
  using (proj_can_view_details(project_id) or inv_can_view_stock(company_id));

-- The current state of every note, derived from its own events and read under the CALLER's row-level security.
--   state     waiting_for_pm | acknowledged | difference_open | superseded
--   awaiting  'pm' (the note needs the PM's acknowledgement), 'warehouse' (a difference is open and the warehouse owns the next step), or null
create or replace view inv_project_note_status with (security_invoker = true) as
select n.id as note_id, n.company_id, n.project_id, n.kind, n.note_no, n.created_at,
       coalesce(n.replaces_note_id, co.linked_note_id) as replaces_note_id,
       sup.superseded_by_note_id,
       ak.at as acknowledged_at, ak.by_user as acknowledged_by, ak.by_name as acknowledged_by_name, ak.capacity as acknowledged_capacity,
       case when df.event = 'difference_reported' then 'open'
            when df.event in ('resolved_record_stands', 'resolved_corrected') then 'resolved'
            when df.event = 'difference_withdrawn' then 'withdrawn'
            else 'none' end as difference_state,
       case when df.event = 'difference_reported' then df.at end as difference_reported_at,
       case when df.event = 'difference_reported' then df.reason end as difference_reason,
       case when df.event = 'difference_reported' then df.lines end as difference_lines,
       case when sup.superseded_by_note_id is not null then null
            when df.event = 'difference_reported' then 'warehouse'
            when ak.at is null then 'pm' end as awaiting,
       case when df.event = 'difference_reported' then df.at else n.created_at end as pending_since,
       case when sup.superseded_by_note_id is not null then 'superseded'
            when df.event = 'difference_reported' then 'difference_open'
            when ak.at is not null then 'acknowledged'
            else 'waiting_for_pm' end as state
from inv_project_notes n
left join lateral (select e.* from inv_project_note_events e where e.note_id = n.id and e.event = 'acknowledged' order by e.seq desc limit 1) ak on true
left join lateral (select e.* from inv_project_note_events e where e.note_id = n.id
                    and e.event in ('difference_reported', 'difference_withdrawn', 'resolved_record_stands', 'resolved_corrected') order by e.seq desc limit 1) df on true
left join lateral (select e.linked_note_id from inv_project_note_events e where e.note_id = n.id and e.event = 'correction_of' order by e.seq asc limit 1) co on true
left join lateral (select coalesce(
                      (select e.linked_note_id from inv_project_note_events e where e.note_id = n.id and e.event = 'resolved_corrected' and e.linked_note_id is not null order by e.seq desc limit 1),
                      (select n2.id from inv_project_notes n2 where n2.replaces_note_id = n.id order by n2.created_at limit 1)) as superseded_by_note_id) sup on true;

-- -----------------------------------------------------------------------------
-- The switch (C7): internal reader used by the two movement functions, and the founder's setter.
-- -----------------------------------------------------------------------------
create or replace function inv_project_notes_enabled(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select s.project_notes_enabled from inv_company_settings s where s.company_id = p_company_id), false);
$$;

create or replace function inv_set_project_notes(p_company_id uuid, p_enabled boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform inv_require_user();
  if not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can switch dispatch notes and return checklists on or off' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'Say whether to switch them on or off' using errcode = '22023'; end if;
  update inv_company_settings set project_notes_enabled = p_enabled, updated_by = auth.uid() where company_id = p_company_id;
  if not found then raise exception 'Set the reference code first' using errcode = '23514'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Making a note (C2). INTERNAL: called only by inv_dispatch_to_project and inv_return_from_project (inside their transaction) and by
-- inv_resolve_note_difference; no signed-in user can call it. It reads the movement that was just recorded (its immutable lines) and snapshots every name, serial
-- and date, so later edits of the catalogue, the project or the warehouse never change an issued note. Idempotent: one note per movement, a second call
-- returns the existing note and takes no number. Any failure refuses the whole movement (nothing is recorded) and says why.
-- -----------------------------------------------------------------------------
create or replace function inv_make_project_note(p_movement_id uuid, p_replaces_note_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  m inv_movements; pr proj_projects; l inv_locations; ex inv_project_notes; d proj_project_details; q inv_requests;
  v_kind text; v_loc uuid; v_id uuid := gen_random_uuid(); v_no text; v_lines jsonb; v_totals jsonb; v_payload jsonb;
  v_pm_name text; v_rec_name text; v_rec_role text;
begin
  begin
    select * into m from inv_movements where id = p_movement_id;
    if m.id is null then raise exception 'Unknown movement'; end if;
    if m.kind not in ('dispatch_project', 'return_project') then raise exception 'Only a dispatch to a project or a return from one has a note'; end if;
    select * into ex from inv_project_notes where movement_id = m.id;
    if ex.id is not null then
      return jsonb_build_object('note_id', ex.id, 'note_no', ex.note_no, 'created', false);
    end if;
    v_kind := case m.kind when 'dispatch_project' then 'dispatch' else 'return' end;
    v_loc := case v_kind when 'dispatch' then m.from_location_id else m.to_location_id end;
    select * into pr from proj_projects where id = m.project_id;
    select * into l from inv_locations where id = v_loc;
    select * into d from proj_project_details where project_id = pr.id;
    if m.request_id is not null then select * into q from inv_requests where id = m.request_id; end if;
    select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) into v_pm_name from profiles p where p.id = pr.pm_user_id;
    select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) into v_rec_name from profiles p where p.id = m.performed_by;
    select case when 'founder' = any (g.capabilities) then 'Inventory founder' when 'warehouse' = any (g.capabilities) then 'Warehouse operator' end into v_rec_role
      from inv_company_grants g where g.user_id = m.performed_by and g.company_id = m.company_id and g.revoked_at is null;

    -- The lines: units one by one (equipment ID and serial from now), counted stock merged per item and condition.
    select coalesce(jsonb_agg(x.obj || jsonb_build_object('n', x.rn) order by x.rn), '[]'::jsonb) into v_lines
    from (
      select row_number() over (order by s.grp, s.name, s.ord) as rn, s.obj
      from (
        select 0 as grp, i.name, u.code as ord,
               jsonb_build_object('item_id', i.id, 'item_name', i.name, 'manufacturer', i.manufacturer, 'model', i.model, 'specification', i.specification,
                                  'unit_id', u.id, 'equipment_id', u.code, 'serial', u.serial_number, 'qty', 1, 'uom', i.unit_of_measure,
                                  'condition', coalesce(ml.condition_to, ml.condition_from),
                                  'outcome', case when coalesce(ml.condition_to, ml.condition_from) in ('good', 'fair') then 'available' else 'held' end) as obj
        from inv_movement_lines ml
        join inv_units u on u.id = ml.unit_id
        join inv_items i on i.id = ml.item_id
        where ml.movement_id = m.id and ml.unit_id is not null
        union all
        select 1, i.name, coalesce(coalesce(ml.condition_to, ml.condition_from), ''),
               jsonb_build_object('item_id', i.id, 'item_name', i.name, 'manufacturer', i.manufacturer, 'model', i.model, 'specification', i.specification,
                                  'unit_id', null, 'equipment_id', null, 'serial', null, 'qty', trim_scale(sum(ml.qty)), 'uom', i.unit_of_measure,
                                  'condition', coalesce(ml.condition_to, ml.condition_from),
                                  'outcome', case when coalesce(ml.condition_to, ml.condition_from) in ('good', 'fair') then 'available' else 'held' end)
        from inv_movement_lines ml
        join inv_items i on i.id = ml.item_id
        where ml.movement_id = m.id and ml.unit_id is null
        group by i.id, i.name, i.manufacturer, i.model, i.specification, i.unit_of_measure, coalesce(ml.condition_to, ml.condition_from)
      ) s
    ) x;
    if jsonb_array_length(v_lines) = 0 then raise exception 'The movement has no lines'; end if;
    if v_kind = 'dispatch' then
      -- the condition outcome is a return notion; a dispatch line carries only its condition
      select jsonb_agg(e - 'outcome' order by (e->>'n')::int) into v_lines from jsonb_array_elements(v_lines) e;
    end if;
    v_payload := jsonb_build_object('schema', 1, 'lines', v_lines);

    if v_kind = 'return' then
      -- Project totals after this return, from the ledger: everything that went onto the project, everything that came off it before this movement, what this
      -- movement took off, and what the project holds now (units exactly; counted stock for the project, never per request line).
      select coalesce(jsonb_agg(t.obj order by t.name), '[]'::jsonb) into v_totals
      from (
        select f.name, jsonb_build_object('item_id', f.item_id, 'item_name', f.name, 'uom', f.uom, 'individual', f.individual,
                 'sent', trim_scale(f.sent), 'returned_before', trim_scale(f.returned_before), 'received_now', trim_scale(f.received_now), 'still_out', trim_scale(f.still_out)) as obj
        from (
          select i.id as item_id, i.name, i.unit_of_measure as uom, i.tracking in ('individual', 'kit') as individual,
                 fl.sent, fl.returned_before, fl.received_now,
                 coalesce((select count(*) from inv_units u where u.item_id = i.id and u.custody_kind = 'project' and u.project_id = pr.id), 0)
                 + coalesce((select sum(b.qty) from inv_balances b where b.item_id = i.id and b.holder_kind = 'project' and b.project_id = pr.id), 0) as still_out
          from (
            select ml.item_id,
                   sum(case when ml.to_kind = 'project' and ml.to_project_id = pr.id then ml.qty else 0 end) as sent,
                   sum(case when ml.from_kind = 'project' and ml.from_project_id = pr.id and ml.movement_id <> m.id then ml.qty else 0 end) as returned_before,
                   sum(case when ml.movement_id = m.id then ml.qty else 0 end) as received_now
            from inv_movement_lines ml
            where ml.to_project_id = pr.id or ml.from_project_id = pr.id
            group by ml.item_id
          ) fl
          join inv_items i on i.id = fl.item_id
        ) f
        where f.received_now > 0 or f.still_out > 0
      ) t;
      v_payload := v_payload || jsonb_build_object('totals', v_totals);
    end if;

    v_no := inv_next_code(m.company_id, case v_kind when 'dispatch' then 'dispatch_note' else 'return_note' end);
    insert into inv_project_notes (id, company_id, kind, note_no, movement_id, movement_code, project_id, project_company_id, project_ref, project_name, destination, site_timezone,
        location_id, location_name, location_timezone, recorded_by, recorded_by_name, recorded_by_role, pm_user_id_at_time, pm_name_at_time, occurred_at, expected_return_at,
        request_id, request_code, replaces_note_id, payload, payload_hash)
    values (v_id, m.company_id, v_kind, v_no, m.id, m.code, pr.id, pr.company_id, pr.reference, pr.name, nullif(btrim(d.location), ''), d.site_timezone,
        l.id, l.name, l.timezone, m.performed_by, coalesce(v_rec_name, 'Unknown'), v_rec_role, pr.pm_user_id, v_pm_name, m.occurred_at,
        case when v_kind = 'dispatch' then m.expected_return_at end,
        m.request_id, q.code, p_replaces_note_id, v_payload, md5(v_payload::text));
    return jsonb_build_object('note_id', v_id, 'note_no', v_no, 'created', true);
  exception when others then
    raise exception 'The % note could not be made, so nothing was recorded (%). Try again, or ask an Inventory founder to switch dispatch notes off for this company.',
      case when v_kind = 'return' then 'return checklist' else 'dispatch' end, sqlerrm using errcode = '23514';
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- The Project Manager's answer (C2). Non-blocking: nothing waits for it. Who may act is decided HERE, at the moment of the call: the current PM, an acting PM
-- whose period has not expired, or a Projects founder of the project's company (proj_can_manage), and the capacity is recorded. Actions:
--   acknowledge        "I acknowledge this recorded list". A second call returns the original acknowledgement and records nothing.
--   report_difference  lines (the note's line numbers) + a reason (+ a comment, required for 'other'); the warehouse owns the next step. Custody and availability do not change.
--   withdraw           withdraw the open report.
-- p_key (optional, 8 to 120 characters) makes a retried call return the original answer, the same way the movement functions do.
-- -----------------------------------------------------------------------------
create or replace function inv_ack_project_note(p_note_id uuid, p_action text, p_lines jsonb default null, p_comment text default null,
                                                p_reason text default null, p_key text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  n inv_project_notes; pr proj_projects; s inv_project_note_status; v_cap text; v_name text; v_prev jsonb; v_result jsonb;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), ''); v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_count int; v_ok_reasons text[]; v_lines jsonb := null; v_ln jsonb; v_seen int[] := '{}'; v_num int; v_event inv_project_note_events;
begin
  perform inv_require_user();
  if p_action is null or p_action not in ('acknowledge', 'report_difference', 'withdraw') then
    raise exception 'Choose acknowledge, report a difference or withdraw' using errcode = '22023';
  end if;
  select * into n from inv_project_notes where id = p_note_id for update;
  if n.id is null then raise exception 'Note not found' using errcode = 'P0002'; end if;
  select * into pr from proj_projects where id = n.project_id;
  if proj_is_pm(n.project_id) then
    v_cap := case when pr.pm_user_id = auth.uid() then 'pm' else 'acting_pm' end;
  elsif proj_is_founder(pr.company_id) then
    v_cap := 'projects_founder';
  else
    raise exception 'Only the project''s Project Manager, an acting Project Manager or a Projects founder can answer this note' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) into v_name from profiles p where p.id = auth.uid();
  v_name := coalesce(v_name, 'Unknown');

  if p_key is not null then
    v_prev := inv_idem_begin(n.company_id, p_key, 'note_action', jsonb_build_object('note', p_note_id, 'action', p_action, 'lines', p_lines, 'comment', v_comment, 'reason', v_reason));
    if v_prev is not null then return v_prev; end if;
  end if;

  select * into s from inv_project_note_status where note_id = n.id;
  if s.superseded_by_note_id is not null then
    raise exception '% has been replaced by a newer note. Answer the newer note', n.note_no using errcode = '23514';
  end if;

  if p_action = 'acknowledge' then
    if s.acknowledged_at is not null then
      v_result := jsonb_build_object('note_id', n.id, 'note_no', n.note_no, 'event', 'acknowledged', 'by_name', s.acknowledged_by_name, 'capacity', s.acknowledged_capacity,
                                     'at', s.acknowledged_at, 'replayed', true);
      if p_key is not null then update inv_idempotency set result = v_result where company_id = n.company_id and idem_key = btrim(p_key); end if;
      return v_result;
    end if;
    if s.difference_state = 'open' then
      raise exception 'A difference is open on % and the warehouse is looking at it. Withdraw it first, or wait for the warehouse to answer', n.note_no using errcode = '23514';
    end if;
    insert into inv_project_note_events (note_id, company_id, project_id, event, by_user, by_name, capacity, comment)
    values (n.id, n.company_id, n.project_id, 'acknowledged', auth.uid(), v_name, v_cap, v_comment) returning * into v_event;
  elsif p_action = 'report_difference' then
    if length(coalesce(v_comment, '')) > 2000 then raise exception 'The comment is too long (2000 characters at most)' using errcode = '22023'; end if;
    v_ok_reasons := case n.kind when 'dispatch' then array['not_on_site', 'quantity_differs', 'different_item', 'condition_differs', 'other']
                                else array['not_returned', 'quantity_differs', 'missing_from_list', 'condition_differs', 'other'] end;
    if v_reason is null or not (v_reason = any (v_ok_reasons)) then
      raise exception 'Say what is different' using errcode = '22023';
    end if;
    if v_reason = 'other' and v_comment is null then raise exception 'Describe the difference in the comment' using errcode = '22023'; end if;
    v_count := jsonb_array_length(n.payload->'lines');
    if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then raise exception 'The lines must be a list' using errcode = '22023'; end if;
    if p_lines is not null then
      for v_ln in select x from jsonb_array_elements(p_lines) x loop
        if jsonb_typeof(v_ln) <> 'number' or (v_ln #>> '{}') !~ '^[0-9]+$' then raise exception 'Name the lines by their numbers' using errcode = '22023'; end if;
        v_num := (v_ln #>> '{}')::int;
        if v_num < 1 or v_num > v_count then raise exception 'This note has no line %', v_num using errcode = '22023'; end if;
        if v_num = any (v_seen) then raise exception 'Line % is listed twice', v_num using errcode = '22023'; end if;
        v_seen := v_seen || v_num;
      end loop;
      v_lines := p_lines;
    end if;
    if coalesce(jsonb_array_length(v_lines), 0) = 0 and not (n.kind = 'return' and v_reason = 'missing_from_list') then
      raise exception 'Tick the line or lines that differ' using errcode = '22023';
    end if;
    if s.difference_state = 'open' then
      raise exception 'A difference is already open on % and the warehouse is looking at it', n.note_no using errcode = '23514';
    end if;
    insert into inv_project_note_events (note_id, company_id, project_id, event, by_user, by_name, capacity, reason, lines, comment)
    values (n.id, n.company_id, n.project_id, 'difference_reported', auth.uid(), v_name, v_cap, v_reason, coalesce(v_lines, '[]'::jsonb), v_comment) returning * into v_event;
  else
    if s.difference_state <> 'open' then raise exception 'There is no open difference on % to withdraw', n.note_no using errcode = '23514'; end if;
    insert into inv_project_note_events (note_id, company_id, project_id, event, by_user, by_name, capacity, comment)
    values (n.id, n.company_id, n.project_id, 'difference_withdrawn', auth.uid(), v_name, v_cap, v_comment) returning * into v_event;
  end if;
  v_result := jsonb_build_object('note_id', n.id, 'note_no', n.note_no, 'event', v_event.event, 'by_name', v_event.by_name, 'capacity', v_event.capacity,
                                 'at', v_event.at, 'replayed', false);
  if p_key is not null then update inv_idempotency set result = v_result where company_id = n.company_id and idem_key = btrim(p_key); end if;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- The warehouse's answer to an open difference (C2). Only an operator of the location that recorded the note (a founder of its company, or a warehouse operator
-- assigned to that location or with cross-location rights), and only while Inventory is on. Two outcomes, neither of which touches stock by itself:
--   record_stands   the warehouse confirms the recorded list is right.
--   corrected       the warehouse has corrected the ledger by the EXISTING actions (reverse and record again, mark missing or found, check condition) and names the
--                   movement. When that movement is a dispatch / return of the same kind for the same project, its note is the NEW note that cites this one (made now
--                   if it has none); this note is never altered and shows "Superseded by ...".
-- A comment is required. Nothing here records a movement, deducts, writes off or penalises anyone.
-- -----------------------------------------------------------------------------
create or replace function inv_resolve_note_difference(p_note_id uuid, p_resolution text, p_comment text, p_linked_movement_id uuid default null, p_key text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  n inv_project_notes; s inv_project_note_status; lm inv_movements; n2 inv_project_notes; v_name text; v_prev jsonb; v_result jsonb; v_event inv_project_note_events;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), ''); v_new uuid := null; v_made jsonb; v_same_kind boolean;
begin
  perform inv_require_user();
  if p_resolution is null or p_resolution not in ('record_stands', 'corrected') then
    raise exception 'Choose "the record stands" or "corrected"' using errcode = '22023';
  end if;
  select * into n from inv_project_notes where id = p_note_id for update;
  if n.id is null then raise exception 'Note not found' using errcode = 'P0002'; end if;
  if not inv_can_operate(n.location_id) then
    raise exception 'Only a warehouse operator at % can answer a difference on this note', n.location_name using errcode = '42501';
  end if;
  perform inv_require_enabled(n.company_id);
  if v_comment is null then raise exception 'Say what the warehouse found, in the comment' using errcode = '22023'; end if;
  if length(v_comment) > 2000 then raise exception 'The comment is too long (2000 characters at most)' using errcode = '22023'; end if;
  select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) into v_name from profiles p where p.id = auth.uid();
  v_name := coalesce(v_name, 'Unknown');

  if p_key is not null then
    v_prev := inv_idem_begin(n.company_id, p_key, 'note_resolve', jsonb_build_object('note', p_note_id, 'resolution', p_resolution, 'comment', v_comment, 'movement', p_linked_movement_id));
    if v_prev is not null then return v_prev; end if;
  end if;

  select * into s from inv_project_note_status where note_id = n.id;
  if s.difference_state <> 'open' then raise exception 'There is no open difference on % to answer', n.note_no using errcode = '23514'; end if;

  if p_resolution = 'record_stands' then
    if p_linked_movement_id is not null then raise exception 'Name a movement only when the record was corrected' using errcode = '22023'; end if;
    insert into inv_project_note_events (note_id, company_id, project_id, event, by_user, by_name, capacity, comment)
    values (n.id, n.company_id, n.project_id, 'resolved_record_stands', auth.uid(), v_name, 'warehouse', v_comment) returning * into v_event;
  else
    if p_linked_movement_id is null then raise exception 'Name the movement that corrected the record' using errcode = '22023'; end if;
    select * into lm from inv_movements where id = p_linked_movement_id;
    if lm.id is null or lm.company_id <> n.company_id then raise exception 'Unknown movement' using errcode = '22023'; end if;
    if lm.id = n.movement_id then raise exception 'The correcting movement must be a later movement, not the one this note records' using errcode = '23514'; end if;
    if lm.recorded_at < (select recorded_at from inv_movements where id = n.movement_id) then
      raise exception 'The correcting movement must have been recorded after the one this note records' using errcode = '23514';
    end if;
    v_same_kind := lm.kind = case n.kind when 'dispatch' then 'dispatch_project' else 'return_project' end;
    if v_same_kind and lm.project_id is distinct from n.project_id then raise exception 'That movement is for another project' using errcode = '23514'; end if;
    if v_same_kind then
      select * into n2 from inv_project_notes where movement_id = lm.id;
      if n2.id is null then
        v_made := inv_make_project_note(lm.id, n.id);                -- the new note cites this one
        v_new := (v_made->>'note_id')::uuid;
      else
        v_new := n2.id;
        if n2.replaces_note_id is null and not exists (select 1 from inv_project_note_events where note_id = n2.id and event = 'correction_of') then
          insert into inv_project_note_events (note_id, company_id, project_id, event, by_user, by_name, capacity, comment, linked_note_id, linked_movement_id)
          values (n2.id, n2.company_id, n2.project_id, 'correction_of', auth.uid(), v_name, 'warehouse', v_comment, n.id, n.movement_id);
        end if;
      end if;
    end if;
    insert into inv_project_note_events (note_id, company_id, project_id, event, by_user, by_name, capacity, comment, linked_note_id, linked_movement_id)
    values (n.id, n.company_id, n.project_id, 'resolved_corrected', auth.uid(), v_name, 'warehouse', v_comment, v_new, lm.id) returning * into v_event;
  end if;
  v_result := jsonb_build_object('note_id', n.id, 'note_no', n.note_no, 'event', v_event.event, 'by_name', v_event.by_name, 'capacity', v_event.capacity,
                                 'at', v_event.at, 'linked_note_id', v_new, 'replayed', false);
  if p_key is not null then update inv_idempotency set result = v_result where company_id = n.company_id and idem_key = btrim(p_key); end if;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- "Waiting for me": the notes THE CALLER can answer right now (current PM, unexpired acting PM, Projects founder), oldest first, minimum fields. For the PM's
-- My Day / Needs me. A person who cannot answer gets no rows, not an error.
-- -----------------------------------------------------------------------------
create or replace function inv_notes_waiting_for_me()
returns table (note_id uuid, note_no text, kind text, project_id uuid, project_ref text, project_name text, waiting_since timestamptz)
language sql stable security definer
set search_path = public
as $$
  select s.note_id, s.note_no, s.kind, n.project_id, n.project_ref, n.project_name, s.pending_since
  from inv_project_note_status s
  join inv_project_notes n on n.id = s.note_id
  where s.awaiting = 'pm' and auth.uid() is not null and proj_can_manage(s.project_id)
  order by s.pending_since, s.note_no;
$$;

-- -----------------------------------------------------------------------------
-- The two movement functions (C2, Option A). Each is the earlier definition (20261201000300) with ONE addition just before the result is stored: a call that is
-- skipped unless the company switched notes on. With the switch off nothing else differs: the same checks, the same rows, the same result.
-- -----------------------------------------------------------------------------

-- Dispatch to a project. With a request, each line must match an active reservation of that request (the reservation's dispatched
-- quantity goes up and it stays active). Without one, the unit or quantity must be unreserved and free from now until the expected return,
-- and another reservation in that period stops the dispatch (nothing is ever displaced).
--   Lines: {"unit_id"} or {"item_id","qty","bin_id","rental_id"}
create or replace function inv_dispatch_to_project(p_company_id uuid, p_location_id uuid, p_project_id uuid, p_key text, p_lines jsonb,
                                                   p_request_id uuid default null, p_expected_return_at timestamptz default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; pr proj_projects; q inv_requests; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record;
  v_exp timestamptz; v_seen uuid[] := '{}'; v_why text; v_res text; v_qty numeric; v_rental uuid; v_free numeric; v_dest uuid; v_covered numeric;
  v_out jsonb := '[]'::jsonb; v_note jsonb;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  if p_request_id is not null then
    select * into q from inv_requests where id = p_request_id;
    if q.id is null or q.company_id <> p_company_id then raise exception 'Unknown request' using errcode = '22023'; end if;
    if q.kind <> 'project' or q.project_id is distinct from p_project_id then raise exception 'That request is not for this project' using errcode = '23514'; end if;
    if q.status not in ('submitted', 'in_progress') and not inv_replaying(p_company_id, p_key) then raise exception 'Request % is % and cannot be dispatched against', q.code, q.status using errcode = '23514'; end if;
  end if;
  v_exp := coalesce(p_expected_return_at, q.expected_return_at, q.needed_until);
  if v_exp is null then raise exception 'Say when the equipment is expected back' using errcode = '22023'; end if;
  if v_exp <= now() and not inv_replaying(p_company_id, p_key) then raise exception 'The expected return date must be in the future' using errcode = '22023'; end if;
  h := inv_begin_movement(p_company_id, 'dispatch_project', p_key,
         jsonb_build_object('location', p_location_id, 'project', p_project_id, 'lines', p_lines, 'request', p_request_id, 'expected', p_expected_return_at, 'note', p_note),
         jsonb_build_object('project_id', p_project_id, 'request_id', p_request_id, 'from_location_id', l.id, 'expected_return_at', v_exp, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  pr := inv_get_project(p_project_id, true);
  for e in select x from jsonb_array_elements(p_lines) x loop
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      i := inv_get_item(u.item_id);
      perform inv_check_sharing(i.company_id, l.company_id);
      perform inv_check_sharing(i.company_id, pr.company_id);
      v_why := inv_unit_block_reason(u, l.id);
      if v_why is not null then raise exception '%', v_why using errcode = '23514'; end if;
      if q.id is not null then
        if inv_reservation_take(q.id, u.item_id, u.id, 1, null) < 1 then
          raise exception '% is not reserved for request %. Reserve it for the request first', u.code, q.code using errcode = '23514';
        end if;
      else
        v_res := inv_unit_reserved_by(u.id, now(), v_exp);
        if v_res is not null then
          raise exception '% is reserved for % in that period. Dispatch it against that request, or choose another unit', u.code, v_res using errcode = '23514';
        end if;
      end if;
      perform inv_unit_move(u.id, 'project', p_project => pr.id, p_expected => v_exp);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'warehouse', 'project', p_from_loc => l.id, p_from_bin => u.bin_id, p_to_proj => pr.id,
                     p_cond_from => u.condition, p_cond_to => u.condition);
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code);
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      if i.tracking = 'consumable' then raise exception '% is a consumable. Record its use with Consume, not Dispatch', i.name using errcode = '23514'; end if;
      if i.tracking <> 'quantity' then raise exception '% is tracked unit by unit. Name the units to dispatch', i.name using errcode = '23514'; end if;
      perform inv_check_sharing(i.company_id, l.company_id);
      perform inv_check_sharing(i.company_id, pr.company_id);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      if q.id is not null then
        v_covered := inv_reservation_take(q.id, i.id, null, v_qty, l.id);
        if v_covered < v_qty then
          raise exception 'Only % of % is reserved for request % at this location. Reserve the rest first', trim_scale(v_covered), i.name, q.code using errcode = '23514';
        end if;
      else
        v_free := inv_qty_free(i.id, l.id, now(), v_exp, null, v_rental is not null);
        if v_qty > v_free then
          raise exception 'Only % of % is free until %: the rest is not on the shelf or is reserved by another request', trim_scale(v_free), i.name, to_char(v_exp at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') using errcode = '23514';
        end if;
      end if;
      for t in select * from inv_take_qty(i.id, v_qty, 'warehouse', l.id, nullif(e->>'bin_id', '')::uuid, p_condition => 'good', p_rental => v_rental,
                                           p_rentals => case when v_rental is null then 'owned' else 'only' end, p_where => 'on the shelf here') loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'project', 'good', p_project => pr.id, p_rental => t.rental_id, p_expected => v_exp);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken, v_exp);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'warehouse', 'project', p_from_loc => l.id, p_from_bin => t.bin_id, p_to_proj => pr.id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => 'good', p_cond_to => 'good');
      end loop;
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty);
    end if;
  end loop;
  if q.id is not null then perform inv_refresh_request_status(q.id); end if;
  -- Dispatch note (launch package 3): inside this same transaction, only for a company that switched it on. A note failure refuses the whole dispatch.
  if inv_project_notes_enabled(p_company_id) then v_note := inv_make_project_note(v_mid); end if;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('project_id', pr.id, 'request_id', p_request_id, 'expected_return_at', v_exp,
           'request_status', (select status from inv_requests where id = q.id), 'lines', v_out)
           || case when v_note is null then '{}'::jsonb else jsonb_build_object('note_id', v_note->'note_id', 'note_no', v_note->'note_no') end);
end;
$$;

-- Return from a project; partial returns are normal: whatever is not listed stays on the project. Equipment that was never dispatched to
-- the project is refused. Each line gives a condition (good / fair is available at once; the rest is held).
--   Lines: {"unit_id","condition","bin_id","note"} or {"item_id","qty","condition","bin_id","rental_id","note"}
create or replace function inv_return_from_project(p_company_id uuid, p_location_id uuid, p_project_id uuid, p_key text, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l inv_locations; pr proj_projects; h jsonb; v_mid uuid; e jsonb; u inv_units; i inv_items; t record;
  v_seen uuid[] := '{}'; v_cond text; v_bin uuid; v_qty numeric; v_rental uuid; v_dest uuid; v_out jsonb := '[]'::jsonb; v_have numeric; v_note jsonb;
begin
  perform inv_ctx(p_company_id);
  l := inv_loc(p_company_id, p_location_id);
  perform inv_lines_array(p_lines);
  pr := inv_get_project(p_project_id, false);
  h := inv_begin_movement(p_company_id, 'return_project', p_key,
         jsonb_build_object('location', p_location_id, 'project', p_project_id, 'lines', p_lines, 'note', p_note),
         jsonb_build_object('project_id', pr.id, 'to_location_id', l.id, 'note', p_note));
  if (h->>'replay')::boolean then return h->'result'; end if;
  v_mid := (h->>'movement_id')::uuid;
  perform inv_lock_lines(p_lines);
  for e in select x from jsonb_array_elements(p_lines) x loop
    v_bin := nullif(e->>'bin_id', '')::uuid;
    perform inv_check_bin(v_bin, l.id);
    if nullif(e->>'unit_id', '') is not null then
      u := inv_unit_lock((e->>'unit_id')::uuid);
      if u.id = any (v_seen) then raise exception '% is listed twice', u.code using errcode = '22023'; end if;
      v_seen := v_seen || u.id;
      i := inv_get_item(u.item_id);
      perform inv_check_sharing(i.company_id, l.company_id);
      if u.custody_kind <> 'project' or u.project_id is distinct from pr.id then
        raise exception '% was not dispatched to project % (it is %), so it cannot be returned from there', u.code, pr.reference, inv_custody_words(u.custody_kind) using errcode = '23514';
      end if;
      v_cond := inv_valid_condition(e->>'condition');
      perform inv_unit_move(u.id, 'warehouse', l.id, v_bin, p_condition => v_cond);
      perform inv_reservation_return(pr.id, u.item_id, u.id, 1);
      perform inv_ml(v_mid, p_company_id, u.item_id, u.id, 1, 'project', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_from_proj => pr.id,
                     p_cond_from => u.condition, p_cond_to => v_cond, p_note => e->>'note');
      v_out := v_out || jsonb_build_object('item_id', u.item_id, 'unit_id', u.id, 'code', u.code, 'condition', v_cond, 'available', v_cond in ('good', 'fair'));
    else
      i := inv_get_item(nullif(e->>'item_id', '')::uuid);
      perform inv_check_sharing(i.company_id, l.company_id);
      v_qty := inv_check_qty(i.id, (e->>'qty')::numeric);
      v_cond := inv_valid_condition(e->>'condition', true);
      v_rental := nullif(e->>'rental_id', '')::uuid;
      select coalesce(sum(b.qty), 0) into v_have from inv_balances b where b.item_id = i.id and b.holder_kind = 'project' and b.project_id = pr.id;
      if v_have = 0 then raise exception '% was never dispatched to project %, so it cannot be returned from there', i.name, pr.reference using errcode = '23514'; end if;
      for t in select * from inv_take_qty(i.id, v_qty, 'project', p_project => pr.id, p_rental => v_rental,
                                           p_rentals => case when v_rental is null then 'any' else 'only' end, p_where => 'on project ' || pr.reference) loop
        v_dest := inv_bal_ensure(i.company_id, i.id, 'warehouse', v_cond, l.id, v_bin, p_rental => t.rental_id);
        perform inv_bal_change(t.balance_id, -t.taken);
        perform inv_bal_change(v_dest, t.taken);
        perform inv_ml(v_mid, p_company_id, i.id, null, t.taken, 'project', 'warehouse', p_to_loc => l.id, p_to_bin => v_bin, p_from_proj => pr.id,
                       p_from_bal => t.balance_id, p_to_bal => v_dest, p_cond_from => t.condition, p_cond_to => v_cond, p_note => e->>'note');
      end loop;
      perform inv_reservation_return(pr.id, i.id, null, v_qty);
      v_out := v_out || jsonb_build_object('item_id', i.id, 'qty', v_qty, 'condition', v_cond, 'available', v_cond = 'good');
    end if;
  end loop;
  perform inv_refresh_project_requests(pr.id);
  -- Return checklist (launch package 3): inside this same transaction, only for a company that switched it on. A note failure refuses the whole return.
  if inv_project_notes_enabled(p_company_id) then v_note := inv_make_project_note(v_mid); end if;
  return inv_finish_movement(p_company_id, p_key, jsonb_build_object('project_id', pr.id, 'lines', v_out)
           || case when v_note is null then '{}'::jsonb else jsonb_build_object('note_id', v_note->'note_id', 'note_no', v_note->'note_no') end);
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: clients read through row-level security only; everything else goes through the functions above.
-- -----------------------------------------------------------------------------
revoke all on table inv_project_notes, inv_project_note_events, inv_project_note_status from anon, authenticated, public;
grant select on table inv_project_notes, inv_project_note_events, inv_project_note_status to authenticated;
revoke all on sequence inv_project_note_events_seq_seq from public, anon, authenticated;

revoke all on function
  inv_project_notes_frozen(), inv_project_notes_enabled(uuid), inv_make_project_note(uuid, uuid), inv_set_project_notes(uuid, boolean),
  inv_ack_project_note(uuid, text, jsonb, text, text, text), inv_resolve_note_difference(uuid, text, text, uuid, text), inv_notes_waiting_for_me()
  from public, anon, authenticated;
grant execute on function
  inv_set_project_notes(uuid, boolean), inv_ack_project_note(uuid, text, jsonb, text, text, text),
  inv_resolve_note_difference(uuid, text, text, uuid, text), inv_notes_waiting_for_me()
  to authenticated;

-- ROLLBACK: supabase/manual-sql/inv_notes_90_rollback.sql (restores the two movement functions and inv_next_code; with notes already issued it keeps the notes and
-- their history and only switches creation off).
