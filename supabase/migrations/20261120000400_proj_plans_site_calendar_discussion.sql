-- Projects & Tasks (Release 2), migration 5 of 6: timelines, external dependencies, site bookings, calendars and discussion.
--
-- Rules encoded here:
--   * Delivery timeline and site production timeline are ordinary editable rows (templates are applied by a function and
--     can be changed freely), never mandatory.
--   * Deadlines and plan dates are DATES (no time zone, never shifted). Timed events are timestamptz plus the IANA zone of
--     the site; the local wall-clock time is converted by Postgres, so daylight-saving changes and overnight/multi-day
--     events are handled by the database, not by arithmetic in the app.
--   * Several assignments in one day is never a conflict. Only PHYSICAL site bookings are compared, by booking not job title,
--     including preparation / travel allowances, across all projects. Confirming a booking that overlaps a confirmed one
--     needs the override capability and a recorded reason; concurrent confirmations are serialised per person.
--   * Conflict messages never reveal a project the caller cannot see.
--   * The company calendar shows only summary-safe project spans; the project calendar is for members and founders.
--   * Discussion is private to members and authorised founders; its notifications carry no message text.

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists proj_plan_items (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references proj_projects(id) on delete cascade,
  plan           text not null check (plan in ('delivery', 'site')),
  template_key   text,
  title          text not null check (length(btrim(title)) between 1 and 200),
  -- Date-only items use start_date/end_date; timed items use starts_at/ends_at with tz; an item may be undated for now.
  start_date     date,
  end_date       date,
  starts_at      timestamptz,
  ends_at        timestamptz,
  tz             text,
  status         text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'cancelled')),
  -- Only items the PM marks are ever offered to a client timeline.
  client_facing  boolean not null default false,
  milestone_id   uuid references proj_milestones(id),
  notes          text,
  sort_order     integer not null default 0,
  created_by     uuid references auth.users(id),
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint proj_plan_items_shape check (
    (start_date is null and end_date is null and starts_at is null and ends_at is null)
    or (start_date is not null and starts_at is null and ends_at is null and tz is null)
    or (start_date is null and end_date is null and starts_at is not null and ends_at is not null and tz is not null)),
  constraint proj_plan_items_dates check (end_date is null or end_date >= start_date),
  constraint proj_plan_items_times check (ends_at is null or ends_at >= starts_at),
  constraint proj_plan_items_tz check (tz is null or proj_valid_timezone(tz))
);
create index if not exists idx_proj_plan_items_project on proj_plan_items(project_id, plan, sort_order);

create table if not exists proj_external_dependencies (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references proj_projects(id) on delete cascade,
  kind           text not null check (kind in ('structure_ready', 'power_network', 'access_permitted', 'standbuilder_complete', 'other')),
  label          text not null check (length(btrim(label)) between 1 and 200),
  -- Date, optionally with a wall-clock time in the project's site time zone. No accounts, no portal, no messages sent.
  expected_date  date,
  expected_time  time,
  organisation   text,
  contact        text,
  confirmation   text not null default 'pending' check (confirmation in ('pending', 'confirmed', 'not_possible')),
  confirmed_at   timestamptz,
  confirmed_by   uuid references auth.users(id),
  milestone_id   uuid references proj_milestones(id),
  client_facing  boolean not null default false,
  notes          text,
  created_by     uuid references auth.users(id),
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint proj_external_time_needs_date check (expected_time is null or expected_date is not null)
);
create index if not exists idx_proj_external_deps_project on proj_external_dependencies(project_id, expected_date);

create table if not exists proj_site_bookings (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references proj_projects(id) on delete cascade,
  user_id        uuid not null references auth.users(id),
  plan_item_id   uuid references proj_plan_items(id),
  location       text not null check (length(btrim(location)) between 1 and 200),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  tz             text not null,
  -- Preparation / travel allowance before the booking and travel back after it; both count when looking for overlaps.
  lead_minutes   integer not null default 0 check (lead_minutes between 0 and 1440),
  trail_minutes  integer not null default 0 check (trail_minutes between 0 and 1440),
  state          text not null default 'tentative' check (state in ('tentative', 'confirmed', 'cancelled')),
  confirmed_by   uuid references auth.users(id),
  confirmed_at   timestamptz,
  override_reason text,
  override_by    uuid references auth.users(id),
  cancel_reason  text,
  notes          text,
  created_by     uuid references auth.users(id),
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint proj_site_bookings_range check (ends_at > starts_at),
  constraint proj_site_bookings_tz check (proj_valid_timezone(tz)),
  constraint proj_site_bookings_confirmed check ((state = 'confirmed') = (confirmed_at is not null))
);
create index if not exists idx_proj_site_bookings_user on proj_site_bookings(user_id, starts_at) where state <> 'cancelled';
create index if not exists idx_proj_site_bookings_project on proj_site_bookings(project_id, starts_at);

create table if not exists proj_messages (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  project_id   uuid not null references proj_projects(id) on delete cascade,
  author_id    uuid not null references auth.users(id),
  parent_id    uuid references proj_messages(id),
  body         text not null check (length(body) <= 4000),
  -- Client-generated key: a retried send (timeout, double click) returns the same message instead of posting twice.
  client_nonce uuid,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz,
  deleted_by   uuid references auth.users(id),
  changed_at   timestamptz not null default now(),
  constraint proj_messages_body check (deleted_at is not null or length(btrim(body)) > 0)
);
create unique index if not exists uq_proj_messages_seq on proj_messages(seq);
create unique index if not exists uq_proj_messages_nonce on proj_messages(project_id, author_id, client_nonce) where client_nonce is not null;
create index if not exists idx_proj_messages_project on proj_messages(project_id, seq);

-- The original text of a deleted message, readable only by founders (who may read the discussion anyway).
create table if not exists proj_message_tombstones (
  message_id     uuid primary key references proj_messages(id) on delete cascade,
  project_id     uuid not null references proj_projects(id) on delete cascade,
  original_body  text not null,
  deleted_by     uuid references auth.users(id),
  reason         text,
  deleted_at     timestamptz not null default now()
);

create table if not exists proj_message_mentions (
  message_id  uuid not null references proj_messages(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  project_id  uuid not null references proj_projects(id) on delete cascade,
  primary key (message_id, user_id)
);

create table if not exists proj_read_state (
  project_id    uuid not null references proj_projects(id) on delete cascade,
  user_id       uuid not null references auth.users(id),
  last_read_seq bigint not null default 0,
  last_read_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

do $$
declare t text;
begin
  foreach t in array array['proj_plan_items', 'proj_external_dependencies', 'proj_site_bookings'] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_set_updated_at', t);
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function proj_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row-level security (SELECT only)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['proj_plan_items', 'proj_external_dependencies', 'proj_site_bookings', 'proj_messages', 'proj_message_mentions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (proj_can_view_details(project_id))', t || '_select', t);
  end loop;
end $$;

alter table proj_message_tombstones enable row level security;
drop policy if exists proj_message_tombstones_select on proj_message_tombstones;
create policy proj_message_tombstones_select on proj_message_tombstones for select
  using (proj_is_founder(proj_project_company(project_id)));

alter table proj_read_state enable row level security;
drop policy if exists proj_read_state_select on proj_read_state;
create policy proj_read_state_select on proj_read_state for select using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Member blockers now include upcoming site bookings (replaces the migration-3 version).
-- -----------------------------------------------------------------------------
create or replace function proj_member_blockers(p_project_id uuid, p_user_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'open_tasks', (select count(*) from proj_tasks t where t.project_id = p_project_id and t.assignee_id = p_user_id
                    and t.status in ('todo', 'in_progress', 'ready_for_review')),
    'upcoming_bookings', (select count(*) from proj_site_bookings b where b.project_id = p_project_id and b.user_id = p_user_id
                           and b.state in ('tentative', 'confirmed') and b.ends_at > now()));
$$;

-- -----------------------------------------------------------------------------
-- Plan items (timelines) and templates. PM only.
-- -----------------------------------------------------------------------------
create or replace function proj_save_plan_item(p_project_id uuid, p_item_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  d proj_project_details;
  i proj_plan_items;
  v_id uuid;
  v_plan text;
  v_tz text;
  v_start date;
  v_end date;
  v_sa timestamptz;
  v_ea timestamptz;
  v_timed boolean := (p_fields ? 'starts_local' or p_fields ? 'ends_local');
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  select * into d from proj_project_details where project_id = v.id;
  if p_item_id is null then
    v_plan := p_fields->>'plan';
    if v_plan not in ('delivery', 'site') then raise exception 'Choose the delivery or the site timeline' using errcode = '22023'; end if;
    if length(btrim(coalesce(p_fields->>'title', ''))) = 0 then raise exception 'Give the item a title' using errcode = '22023'; end if;
  else
    select * into i from proj_plan_items where id = p_item_id and project_id = v.id for update;
    if not found then raise exception 'Timeline item not found' using errcode = 'P0002'; end if;
    perform proj_check_version(i.version, nullif(p_fields->>'expected_version', '')::integer);
    v_plan := i.plan;
  end if;
  v_tz := coalesce(proj_text_or_null(p_fields, 'tz'), i.tz, d.site_timezone);
  if v_timed then
    if not proj_valid_timezone(v_tz) then raise exception 'Unknown time zone %', v_tz using errcode = '22023'; end if;
    v_sa := (p_fields->>'starts_local')::timestamp at time zone v_tz;
    v_ea := coalesce((p_fields->>'ends_local')::timestamp at time zone v_tz, v_sa);
    v_start := null; v_end := null;
  elsif p_fields ? 'start_date' or p_fields ? 'end_date' then
    v_start := nullif(p_fields->>'start_date', '')::date;
    v_end := nullif(p_fields->>'end_date', '')::date;
    if v_start is null and v_end is not null then v_start := v_end; end if;
    v_sa := null; v_ea := null; v_tz := null;
  elsif i.id is not null then
    v_start := i.start_date; v_end := i.end_date; v_sa := i.starts_at; v_ea := i.ends_at; v_tz := i.tz;
  end if;
  if p_fields ? 'milestone_id' and nullif(p_fields->>'milestone_id', '')::uuid is not null
     and not exists (select 1 from proj_milestones where id = nullif(p_fields->>'milestone_id', '')::uuid and project_id = v.id) then
    raise exception 'Unknown milestone' using errcode = '22023';
  end if;

  if i.id is null then
    insert into proj_plan_items (project_id, plan, template_key, title, start_date, end_date, starts_at, ends_at, tz, client_facing, milestone_id, notes, sort_order, created_by)
    values (v.id, v_plan, proj_text_or_null(p_fields, 'template_key'), btrim(p_fields->>'title'), v_start, v_end, v_sa, v_ea, v_tz,
            coalesce((p_fields->>'client_facing')::boolean, false), nullif(p_fields->>'milestone_id', '')::uuid, proj_text_or_null(p_fields, 'notes'),
            coalesce((p_fields->>'sort_order')::integer, (select coalesce(max(sort_order), 0) + 10 from proj_plan_items where project_id = v.id and plan = v_plan)),
            auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  update proj_plan_items set
    title = coalesce(proj_text_or_null(p_fields, 'title'), title),
    start_date = v_start, end_date = v_end, starts_at = v_sa, ends_at = v_ea, tz = v_tz,
    status = coalesce(proj_text_or_null(p_fields, 'status'), status),
    client_facing = coalesce((p_fields->>'client_facing')::boolean, client_facing),
    milestone_id = case when p_fields ? 'milestone_id' then nullif(p_fields->>'milestone_id', '')::uuid else milestone_id end,
    notes = case when p_fields ? 'notes' then proj_text_or_null(p_fields, 'notes') else notes end,
    sort_order = coalesce((p_fields->>'sort_order')::integer, sort_order),
    version = version + 1
   where id = i.id;
  perform proj_log_change(v.id, 'plan_item', i.id, 'start', coalesce(i.start_date::text, i.starts_at::text), coalesce(v_start::text, v_sa::text), p_fields->>'reason');
  perform proj_log_change(v.id, 'plan_item', i.id, 'end', coalesce(i.end_date::text, i.ends_at::text), coalesce(v_end::text, v_ea::text), p_fields->>'reason');
  return i.id;
end;
$$;

create or replace function proj_delete_plan_item(p_item_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  i proj_plan_items;
  v proj_projects;
begin
  perform proj_require_user();
  select * into i from proj_plan_items where id = p_item_id for update;
  if not found then raise exception 'Timeline item not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(i.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if exists (select 1 from proj_site_bookings where plan_item_id = i.id and state <> 'cancelled') then
    raise exception 'Bookings still use this activity. Cancel them first' using errcode = '23514';
  end if;
  delete from proj_plan_items where id = i.id;
  perform proj_log_change(v.id, 'plan_item', i.id, 'deleted', i.title, null);
end;
$$;

-- Applies a template once to an empty plan. Each item: {title, template_key?, offset_days?, duration_days?, client_facing?}. With a base
-- date, offsets become dates; without one the items are created undated for the PM to schedule. The templates themselves live in
-- the application (packages/domain) and are suggestions only.
create or replace function proj_apply_plan_template(p_project_id uuid, p_plan text, p_items jsonb, p_base_date date default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  it jsonb;
  n integer := 0;
  v_off integer;
  v_dur integer;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if p_plan not in ('delivery', 'site') then raise exception 'Choose the delivery or the site timeline' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'The template has no items' using errcode = '22023'; end if;
  if exists (select 1 from proj_plan_items where project_id = v.id and plan = p_plan) then
    raise exception 'This timeline already has items. Edit them, or remove them first' using errcode = '23514';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_off := nullif(it->>'offset_days', '')::integer;
    v_dur := coalesce(nullif(it->>'duration_days', '')::integer, 0);
    insert into proj_plan_items (project_id, plan, template_key, title, start_date, end_date, client_facing, sort_order, created_by)
    values (v.id, p_plan, nullif(it->>'template_key', ''), btrim(it->>'title'),
            case when p_base_date is not null and v_off is not null then p_base_date + v_off end,
            case when p_base_date is not null and v_off is not null then p_base_date + v_off + v_dur end,
            coalesce((it->>'client_facing')::boolean, false), (n + 1) * 10, auth.uid());
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- External dependencies (standbuilder, power, network, access). Recorded by the PM; nothing is sent to anyone.
-- -----------------------------------------------------------------------------
create or replace function proj_save_external_dependency(p_project_id uuid, p_dependency_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  e proj_external_dependencies;
  v_id uuid;
  v_conf text;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if p_fields ? 'milestone_id' and nullif(p_fields->>'milestone_id', '')::uuid is not null
     and not exists (select 1 from proj_milestones where id = nullif(p_fields->>'milestone_id', '')::uuid and project_id = v.id) then
    raise exception 'Unknown milestone' using errcode = '22023';
  end if;
  if p_dependency_id is null then
    if length(btrim(coalesce(p_fields->>'label', ''))) = 0 then raise exception 'Describe what you are waiting for' using errcode = '22023'; end if;
    insert into proj_external_dependencies (project_id, kind, label, expected_date, expected_time, organisation, contact, milestone_id, client_facing, notes, created_by)
    values (v.id, coalesce(proj_text_or_null(p_fields, 'kind'), 'other'), btrim(p_fields->>'label'), nullif(p_fields->>'expected_date', '')::date,
            nullif(p_fields->>'expected_time', '')::time, proj_text_or_null(p_fields, 'organisation'), proj_text_or_null(p_fields, 'contact'),
            nullif(p_fields->>'milestone_id', '')::uuid, coalesce((p_fields->>'client_facing')::boolean, false), proj_text_or_null(p_fields, 'notes'), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  select * into e from proj_external_dependencies where id = p_dependency_id and project_id = v.id for update;
  if not found then raise exception 'Dependency not found' using errcode = 'P0002'; end if;
  perform proj_check_version(e.version, nullif(p_fields->>'expected_version', '')::integer);
  v_conf := coalesce(proj_text_or_null(p_fields, 'confirmation'), e.confirmation);
  if v_conf not in ('pending', 'confirmed', 'not_possible') then raise exception 'Unknown confirmation status' using errcode = '22023'; end if;
  update proj_external_dependencies set
    kind = coalesce(proj_text_or_null(p_fields, 'kind'), kind),
    label = coalesce(proj_text_or_null(p_fields, 'label'), label),
    expected_date = case when p_fields ? 'expected_date' then nullif(p_fields->>'expected_date', '')::date else expected_date end,
    expected_time = case when p_fields ? 'expected_time' then nullif(p_fields->>'expected_time', '')::time else expected_time end,
    organisation = case when p_fields ? 'organisation' then proj_text_or_null(p_fields, 'organisation') else organisation end,
    contact = case when p_fields ? 'contact' then proj_text_or_null(p_fields, 'contact') else contact end,
    confirmation = v_conf,
    confirmed_at = case when v_conf = 'confirmed' and confirmation <> 'confirmed' then now() when v_conf <> 'confirmed' then null else confirmed_at end,
    confirmed_by = case when v_conf = 'confirmed' and confirmation <> 'confirmed' then auth.uid() when v_conf <> 'confirmed' then null else confirmed_by end,
    milestone_id = case when p_fields ? 'milestone_id' then nullif(p_fields->>'milestone_id', '')::uuid else milestone_id end,
    client_facing = coalesce((p_fields->>'client_facing')::boolean, client_facing),
    notes = case when p_fields ? 'notes' then proj_text_or_null(p_fields, 'notes') else notes end,
    version = version + 1
   where id = e.id;
  perform proj_log_change(v.id, 'external_dependency', e.id, 'expected', coalesce(e.expected_date::text, '') || coalesce(' ' || e.expected_time::text, ''),
    coalesce(nullif(p_fields->>'expected_date', ''), e.expected_date::text, '') || coalesce(' ' || nullif(p_fields->>'expected_time', ''), ''), p_fields->>'reason');
  perform proj_log_change(v.id, 'external_dependency', e.id, 'confirmation', e.confirmation, v_conf);
  return e.id;
end;
$$;

create or replace function proj_delete_external_dependency(p_dependency_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  e proj_external_dependencies;
  v proj_projects;
begin
  perform proj_require_user();
  select * into e from proj_external_dependencies where id = p_dependency_id for update;
  if not found then raise exception 'Dependency not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(e.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  delete from proj_external_dependencies where id = e.id;
  perform proj_log_change(v.id, 'external_dependency', e.id, 'deleted', e.label, null);
end;
$$;

-- -----------------------------------------------------------------------------
-- Site bookings
-- -----------------------------------------------------------------------------
-- PM / founder, or the head of the team the booked person belongs to, may book that person.
create or replace function proj_can_book(p_project_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select proj_can_manage(p_project_id)
      or exists (select 1 from proj_project_members m join proj_teams t on t.id = m.team_id
                  where m.project_id = p_project_id and m.user_id = p_user_id and m.removed_at is null
                    and t.removed_at is null and proj_is_team_head(t.id));
$$;

create or replace function proj_save_booking(p_project_id uuid, p_booking_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  d proj_project_details;
  b proj_site_bookings;
  v_user uuid;
  v_tz text;
  v_sa timestamptz;
  v_ea timestamptz;
  v_lead integer;
  v_trail integer;
  v_loc text;
  v_id uuid;
  v_changed boolean;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_open_project(v);
  select * into d from proj_project_details where project_id = v.id;
  if p_booking_id is not null then
    select * into b from proj_site_bookings where id = p_booking_id and project_id = v.id for update;
    if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
    perform proj_check_version(b.version, nullif(p_fields->>'expected_version', '')::integer);
    if b.state = 'cancelled' then raise exception 'A cancelled booking cannot be edited. Create a new one' using errcode = '23514'; end if;
  end if;
  v_user := coalesce(nullif(p_fields->>'user_id', '')::uuid, b.user_id);
  if v_user is null then raise exception 'Choose who is booked' using errcode = '22023'; end if;
  if not proj_can_book(v.id, v_user) then
    raise exception 'Only the Project Manager, or the head of that person''s department team, can book them on site' using errcode = '42501';
  end if;
  if not exists (select 1 from proj_project_members where project_id = v.id and user_id = v_user and removed_at is null) then
    raise exception 'The booked person must be a member of the project' using errcode = '22023';
  end if;
  v_tz := coalesce(proj_text_or_null(p_fields, 'tz'), b.tz, d.site_timezone);
  if not proj_valid_timezone(v_tz) then raise exception 'Unknown time zone %', v_tz using errcode = '22023'; end if;
  v_sa := case when p_fields ? 'starts_local' then (p_fields->>'starts_local')::timestamp at time zone v_tz else b.starts_at end;
  v_ea := case when p_fields ? 'ends_local' then (p_fields->>'ends_local')::timestamp at time zone v_tz else b.ends_at end;
  if v_sa is null or v_ea is null then raise exception 'Give the start and end time' using errcode = '22023'; end if;
  if v_ea <= v_sa then raise exception 'The booking must end after it starts' using errcode = '22023'; end if;
  v_lead := coalesce((p_fields->>'lead_minutes')::integer, b.lead_minutes, 0);
  v_trail := coalesce((p_fields->>'trail_minutes')::integer, b.trail_minutes, 0);
  v_loc := coalesce(proj_text_or_null(p_fields, 'location'), b.location);
  if v_loc is null then raise exception 'Give the site location' using errcode = '22023'; end if;
  if p_fields ? 'plan_item_id' and nullif(p_fields->>'plan_item_id', '')::uuid is not null
     and not exists (select 1 from proj_plan_items where id = nullif(p_fields->>'plan_item_id', '')::uuid and project_id = v.id and plan = 'site') then
    raise exception 'Unknown site activity' using errcode = '22023';
  end if;

  if b.id is null then
    insert into proj_site_bookings (project_id, user_id, plan_item_id, location, starts_at, ends_at, tz, lead_minutes, trail_minutes, notes, created_by)
    values (v.id, v_user, nullif(p_fields->>'plan_item_id', '')::uuid, v_loc, v_sa, v_ea, v_tz, v_lead, v_trail, proj_text_or_null(p_fields, 'notes'), auth.uid())
    returning id into v_id;
    perform proj_notify(v.id, v_user, 'project_assignment',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'booking_id', v_id, 'location', v_loc), 'booking:' || v_id || ':created');
    return v_id;
  end if;

  -- Changing who, when, where or the allowances of a confirmed booking withdraws the confirmation: it must be confirmed again
  -- (and re-checked for overlaps).
  v_changed := b.user_id <> v_user or b.starts_at <> v_sa or b.ends_at <> v_ea or b.lead_minutes <> v_lead or b.trail_minutes <> v_trail;
  update proj_site_bookings set
    user_id = v_user, plan_item_id = case when p_fields ? 'plan_item_id' then nullif(p_fields->>'plan_item_id', '')::uuid else plan_item_id end,
    location = v_loc, starts_at = v_sa, ends_at = v_ea, tz = v_tz, lead_minutes = v_lead, trail_minutes = v_trail,
    notes = case when p_fields ? 'notes' then proj_text_or_null(p_fields, 'notes') else notes end,
    state = case when v_changed and state = 'confirmed' then 'tentative' else state end,
    confirmed_by = case when v_changed and state = 'confirmed' then null else confirmed_by end,
    confirmed_at = case when v_changed and state = 'confirmed' then null else confirmed_at end,
    override_reason = case when v_changed and state = 'confirmed' then null else override_reason end,
    override_by = case when v_changed and state = 'confirmed' then null else override_by end,
    version = version + 1
   where id = b.id;
  perform proj_log_change(v.id, 'booking', b.id, 'window', b.starts_at::text || ' - ' || b.ends_at::text, v_sa::text || ' - ' || v_ea::text, p_fields->>'reason');
  if v_changed then
    perform proj_notify(v.id, v_user, 'project_deadline_changed',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'booking_id', b.id, 'location', v_loc), 'booking:' || b.id || ':window:' || (b.version + 1));
  end if;
  return b.id;
end;
$$;

-- Overlaps with this booking's effective window (preparation before, travel after). Visible projects are named; others are
-- reported only as "not visible to you", with no project, no times, nothing else.
create or replace function proj_booking_conflicts(p_booking_id uuid)
returns table (booking_id uuid, is_visible boolean, project_id uuid, project_reference text, project_name text, starts_at timestamptz, ends_at timestamptz, tz text, state text)
language plpgsql stable security definer
set search_path = public
as $$
declare b proj_site_bookings;
begin
  perform proj_require_user();
  select * into b from proj_site_bookings where id = p_booking_id;
  if not found or not proj_can_view_details(b.project_id) then return; end if;
  return query
    select o.id, proj_can_view_details(o.project_id),
           case when proj_can_view_details(o.project_id) then o.project_id end,
           case when proj_can_view_details(o.project_id) then (select pr.reference from proj_projects pr where pr.id = o.project_id) end,
           case when proj_can_view_details(o.project_id) then (select pr.name from proj_projects pr where pr.id = o.project_id) end,
           case when proj_can_view_details(o.project_id) then o.starts_at end,
           case when proj_can_view_details(o.project_id) then o.ends_at end,
           case when proj_can_view_details(o.project_id) then o.tz end,
           case when proj_can_view_details(o.project_id) then o.state end
    from proj_site_bookings o
    where o.user_id = b.user_id and o.id <> b.id and o.state <> 'cancelled'
      and tstzrange(o.starts_at - make_interval(mins => o.lead_minutes), o.ends_at + make_interval(mins => o.trail_minutes))
          && tstzrange(b.starts_at - make_interval(mins => b.lead_minutes), b.ends_at + make_interval(mins => b.trail_minutes))
    order by o.starts_at;
end;
$$;

-- Confirmation: serialised per person, so two bookings confirmed at the same moment cannot both pass the overlap check.
create or replace function proj_confirm_booking(p_booking_id uuid, p_override_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  b proj_site_bookings;
  v proj_projects;
  v_conflicts integer;
  v_visible text;
  v_hidden integer;
  v_overridden boolean := false;
begin
  perform proj_require_user();
  select * into b from proj_site_bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('proj_booking:' || b.user_id::text, 0));
  select * into b from proj_site_bookings where id = p_booking_id for update;       -- re-read after the lock
  v := proj_lock_project(b.project_id);
  perform proj_require_open_project(v);
  if not proj_can_book(v.id, b.user_id) then
    raise exception 'Only the Project Manager, or the head of that person''s department team, can confirm this booking' using errcode = '42501';
  end if;
  if b.state = 'confirmed' then return jsonb_build_object('confirmed', true, 'conflicts', 0, 'overridden', b.override_reason is not null); end if;
  if b.state = 'cancelled' then raise exception 'A cancelled booking cannot be confirmed' using errcode = '23514'; end if;
  if not proj_user_eligible(v.company_id, b.user_id, v.id) then
    raise exception 'The booked person no longer has access to this project' using errcode = '23514';
  end if;

  select count(*), count(*) filter (where not proj_can_view_details(o.project_id)),
         string_agg((select pr.reference from proj_projects pr where pr.id = o.project_id), ', ') filter (where proj_can_view_details(o.project_id))
    into v_conflicts, v_hidden, v_visible
  from proj_site_bookings o
  where o.user_id = b.user_id and o.id <> b.id and o.state = 'confirmed'
    and tstzrange(o.starts_at - make_interval(mins => o.lead_minutes), o.ends_at + make_interval(mins => o.trail_minutes))
        && tstzrange(b.starts_at - make_interval(mins => b.lead_minutes), b.ends_at + make_interval(mins => b.trail_minutes));

  if v_conflicts > 0 then
    if length(btrim(coalesce(p_override_reason, ''))) = 0 then
      raise exception 'This person already has % confirmed site booking(s) that overlap this one, including preparation and travel time%. Change the time or the person; a founder with site-conflict authority can confirm it anyway with a recorded reason.',
        v_conflicts,
        case when v_visible is not null then ' (' || v_visible || case when v_hidden > 0 then ' and ' || v_hidden || ' you cannot see' else '' end || ')'
             when v_hidden > 0 then ' (' || v_hidden || ' on projects you cannot see)' else '' end
        using errcode = '23P01';
    end if;
    if not proj_has_capability(v.company_id, 'override_site_conflict') then
      raise exception 'Only a founder, or someone a founder gave site-conflict authority to, can confirm an overlapping booking' using errcode = '42501';
    end if;
    v_overridden := true;
  end if;

  update proj_site_bookings set state = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
         override_reason = case when v_overridden then btrim(p_override_reason) end,
         override_by = case when v_overridden then auth.uid() end, version = version + 1
   where id = b.id;
  perform proj_log_change(v.id, 'booking', b.id, 'state', b.state, 'confirmed', case when v_overridden then 'Overlap overridden: ' || btrim(p_override_reason) end);
  perform proj_notify(v.id, b.user_id, 'project_assignment',
    jsonb_build_object('name', v.name, 'reference', v.reference, 'booking_id', b.id, 'location', b.location), 'booking:' || b.id || ':confirmed');
  return jsonb_build_object('confirmed', true, 'conflicts', v_conflicts, 'overridden', v_overridden);
end;
$$;

create or replace function proj_cancel_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b proj_site_bookings;
  v proj_projects;
begin
  perform proj_require_user();
  select * into b from proj_site_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(b.project_id);
  if not proj_can_book(v.id, b.user_id) then
    raise exception 'Only the Project Manager, or the head of that person''s department team, can cancel this booking' using errcode = '42501';
  end if;
  if b.state = 'cancelled' then return; end if;
  update proj_site_bookings set state = 'cancelled', cancel_reason = nullif(btrim(p_reason), ''), confirmed_by = null, confirmed_at = null, version = version + 1 where id = b.id;
  perform proj_log_change(v.id, 'booking', b.id, 'state', b.state, 'cancelled', p_reason);
  perform proj_notify(v.id, b.user_id, 'project_deadline_changed',
    jsonb_build_object('name', v.name, 'reference', v.reference, 'booking_id', b.id, 'location', b.location, 'cancelled', true), 'booking:' || b.id || ':cancelled');
end;
$$;

-- -----------------------------------------------------------------------------
-- Calendars. Date-only items come back as dates; timed items as instants plus the source zone (the app shows both).
-- -----------------------------------------------------------------------------
-- My Calendar: my tasks and review requests, milestones and bookings of projects I belong to. Nothing from other projects.
create or replace function proj_my_calendar(p_from date, p_to date, p_view_tz text default 'Asia/Dubai')
returns table (kind text, item_id uuid, project_id uuid, project_reference text, project_name text, title text,
               on_date date, end_date date, starts_at timestamptz, ends_at timestamptz, tz text, status text, detail text)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  perform proj_require_user();
  if p_to < p_from then raise exception 'The end of the range is before its start' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'Choose a range of at most about a year' using errcode = '22023'; end if;
  if not proj_valid_timezone(p_view_tz) then p_view_tz := 'Asia/Dubai'; end if;
  v_from := p_from::timestamp at time zone p_view_tz;
  v_to := (p_to + 1)::timestamp at time zone p_view_tz;
  return query
    select 'task'::text, t.id, pr.id, pr.reference, pr.name, t.title, t.due_date, t.due_date, null::timestamptz, null::timestamptz, null::text, t.status,
           case when t.blocked_at is not null then 'Blocked' end
    from proj_tasks t join proj_projects pr on pr.id = t.project_id
    where (t.assignee_id = auth.uid() or exists (select 1 from proj_task_collaborators c where c.task_id = t.id and c.user_id = auth.uid()))
      and t.status in ('todo', 'in_progress', 'ready_for_review') and t.due_date between p_from and p_to and proj_can_view_details(pr.id)
    union all
    select 'review', t.id, pr.id, pr.reference, pr.name, t.title, coalesce(t.due_date, (t.updated_at at time zone p_view_tz)::date), coalesce(t.due_date, (t.updated_at at time zone p_view_tz)::date),
           null, null, null, t.status, 'Review requested'
    from proj_tasks t join proj_projects pr on pr.id = t.project_id
    where t.status = 'ready_for_review' and t.assignee_id <> auth.uid() and proj_can_view_details(pr.id)
      and (proj_can_manage(pr.id) or (t.team_id is not null and proj_is_team_head(t.team_id)))
      and coalesce(t.due_date, (t.updated_at at time zone p_view_tz)::date) between p_from and p_to
    union all
    select 'milestone', m.id, pr.id, pr.reference, pr.name, m.title, m.due_date, m.due_date, null, null, null, m.status, null
    from proj_milestones m join proj_projects pr on pr.id = m.project_id
    where m.due_date between p_from and p_to and m.status not in ('cancelled') and proj_is_active_member(pr.id)
    union all
    select 'booking', b.id, pr.id, pr.reference, pr.name, 'Site: ' || b.location, null, null, b.starts_at, b.ends_at, b.tz, b.state, null
    from proj_site_bookings b join proj_projects pr on pr.id = b.project_id
    where b.user_id = auth.uid() and b.state <> 'cancelled' and b.starts_at < v_to and b.ends_at > v_from and proj_can_view_details(pr.id)
    order by 7 nulls last, 9 nulls last;
end;
$$;

-- Company Project Calendar: summary-safe project spans only (reference, name, status, dates). No milestones, tasks, bookings.
-- A Sales-only user sees only their linked projects, because visibility is the summary rule.
create or replace function proj_company_calendar(p_company_id uuid, p_from date, p_to date)
returns table (project_id uuid, reference text, name text, kind text, status text, start_date date, end_date date)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if p_to - p_from > 800 then raise exception 'Choose a shorter range' using errcode = '22023'; end if;
  return query
    select pr.id, pr.reference, pr.name, pr.kind, pr.status, pr.start_date, pr.end_date
    from proj_projects pr
    where pr.company_id = p_company_id and proj_can_view_summary(pr.id)
      and pr.start_date is not null and pr.start_date <= p_to and coalesce(pr.end_date, pr.start_date) >= p_from
    order by pr.start_date, pr.reference;
end;
$$;

-- Project Calendar (members and founders): milestones, deliverables, task deadlines, timeline items, bookings, dependencies.
create or replace function proj_project_calendar(p_project_id uuid, p_from date, p_to date, p_view_tz text default 'Asia/Dubai')
returns table (kind text, item_id uuid, title text, on_date date, end_date date, starts_at timestamptz, ends_at timestamptz, tz text, status text, who text, detail text)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  perform proj_require_user();
  if not proj_can_view_details(p_project_id) then return; end if;
  if p_to - p_from > 800 then raise exception 'Choose a shorter range' using errcode = '22023'; end if;
  if not proj_valid_timezone(p_view_tz) then p_view_tz := 'Asia/Dubai'; end if;
  v_from := p_from::timestamp at time zone p_view_tz;
  v_to := (p_to + 1)::timestamp at time zone p_view_tz;
  return query
    select 'milestone'::text, m.id, m.title, m.due_date, m.due_date, null::timestamptz, null::timestamptz, null::text, m.status, null::text, null::text
      from proj_milestones m where m.project_id = p_project_id and m.due_date between p_from and p_to and m.status <> 'cancelled'
    union all
    select 'deliverable', d.id, d.title, d.due_date, d.due_date, null, null, null, d.status, (select t.name from proj_teams t where t.id = d.team_id), null
      from proj_deliverables d where d.project_id = p_project_id and d.due_date between p_from and p_to and d.status <> 'cancelled'
    union all
    select 'task', t.id, t.title, t.due_date, t.due_date, null, null, null, t.status, proj_display_name(t.assignee_id), case when t.blocked_at is not null then 'Blocked' end
      from proj_tasks t where t.project_id = p_project_id and t.due_date between p_from and p_to and t.status not in ('cancelled')
    union all
    select 'plan_' || i.plan, i.id, i.title, i.start_date, coalesce(i.end_date, i.start_date), i.starts_at, i.ends_at, i.tz, i.status, null, null
      from proj_plan_items i where i.project_id = p_project_id and i.status <> 'cancelled'
       and ((i.start_date is not null and i.start_date <= p_to and coalesce(i.end_date, i.start_date) >= p_from)
         or (i.starts_at is not null and i.starts_at < v_to and i.ends_at >= v_from))
    union all
    select 'booking', b.id, 'Site: ' || b.location, null, null, b.starts_at, b.ends_at, b.tz, b.state, proj_display_name(b.user_id), null
      from proj_site_bookings b where b.project_id = p_project_id and b.state <> 'cancelled' and b.starts_at < v_to and b.ends_at > v_from
    union all
    select 'dependency', e.id, e.label, e.expected_date, e.expected_date, null, null, null, e.confirmation, e.organisation, e.expected_time::text
      from proj_external_dependencies e where e.project_id = p_project_id and e.expected_date between p_from and p_to
    order by 4 nulls last, 6 nulls last;
end;
$$;

-- -----------------------------------------------------------------------------
-- Private discussion
-- -----------------------------------------------------------------------------
-- A participant is an active member or a founder of the project's company: the only people a discussion is open to.
create or replace function proj_user_is_participant(p_project_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_projects pr
    where pr.id = p_project_id and exists (select 1 from profiles p where p.id = p_user_id and p.is_active)
      and (
        (exists (select 1 from proj_project_members m where m.project_id = pr.id and m.user_id = p_user_id and m.removed_at is null)
         and proj_user_eligible(pr.company_id, p_user_id, pr.id))
        or exists (select 1 from proj_company_grants g where g.user_id = p_user_id and g.company_id = pr.company_id and g.revoked_at is null and 'founder' = any (g.capabilities))
      ));
$$;

create or replace function proj_post_message(p_project_id uuid, p_body text, p_parent_id uuid default null, p_nonce uuid default null, p_mentions uuid[] default '{}'::uuid[])
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  v_id uuid;
  v_parent proj_messages;
  u uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  v := proj_lock_project(p_project_id);
  if not proj_can_view_details(v.id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  -- A retry of the same send (same nonce) returns the message that was already stored.
  if p_nonce is not null then
    select id into v_id from proj_messages where project_id = v.id and author_id = auth.uid() and client_nonce = p_nonce;
    if v_id is not null then return v_id; end if;
  end if;
  if v.status in ('completed', 'archived') then raise exception 'A completed project''s discussion is read-only' using errcode = '23514'; end if;
  if length(v_body) = 0 then raise exception 'Write a message' using errcode = '22023'; end if;
  if length(v_body) > 4000 then raise exception 'Messages are limited to 4000 characters' using errcode = '22023'; end if;
  if p_parent_id is not null then
    select * into v_parent from proj_messages where id = p_parent_id and project_id = v.id;
    if not found then raise exception 'The message you are replying to was not found' using errcode = '22023'; end if;
  end if;
  p_mentions := coalesce((select array_agg(distinct m) from unnest(coalesce(p_mentions, '{}'::uuid[])) m where m <> auth.uid()), '{}'::uuid[]);
  foreach u in array p_mentions loop
    if not proj_user_is_participant(v.id, u) then
      raise exception 'You can only mention people who are part of this project' using errcode = '22023';
    end if;
  end loop;

  insert into proj_messages (project_id, author_id, parent_id, body, client_nonce) values (v.id, auth.uid(), p_parent_id, v_body, p_nonce) returning id into v_id;
  insert into proj_message_mentions (message_id, user_id, project_id) select v_id, m, v.id from unnest(p_mentions) m;
  foreach u in array p_mentions loop
    perform proj_notify(v.id, u, 'project_mention', jsonb_build_object('name', v.name, 'reference', v.reference, 'message_id', v_id), 'msg:' || v_id || ':' || u);
  end loop;
  if v_parent.id is not null and v_parent.author_id <> auth.uid() and not (v_parent.author_id = any (p_mentions)) and v_parent.deleted_at is null then
    perform proj_notify(v.id, v_parent.author_id, 'project_reply', jsonb_build_object('name', v.name, 'reference', v.reference, 'message_id', v_id), 'msg:' || v_id || ':' || v_parent.author_id);
  end if;
  -- Posting counts as having read everything up to your own message.
  perform proj_mark_read(v.id);
  return v_id;
end;
$$;

create or replace function proj_edit_message(p_message_id uuid, p_body text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  m proj_messages;
  v_body text := btrim(coalesce(p_body, ''));
begin
  perform proj_require_user();
  select * into m from proj_messages where id = p_message_id for update;
  if not found or m.author_id <> auth.uid() or not proj_can_view_details(m.project_id) then raise exception 'Message not found' using errcode = 'P0002'; end if;
  if m.deleted_at is not null then raise exception 'A deleted message cannot be edited' using errcode = '23514'; end if;
  if (select status from proj_projects where id = m.project_id) in ('completed', 'archived') then raise exception 'A completed project''s discussion is read-only' using errcode = '23514'; end if;
  if length(v_body) = 0 or length(v_body) > 4000 then raise exception 'Messages are 1 to 4000 characters' using errcode = '22023'; end if;
  if v_body = m.body then return; end if;
  update proj_messages set body = v_body, edited_at = now(), changed_at = now() where id = m.id;
end;
$$;

-- Deleting leaves a visible tombstone ("Message deleted"). The author, the PM or a founder may delete; the original text
-- is kept in the founders-only tombstone table and the deletion is recorded in the member-visible change log.
create or replace function proj_delete_message(p_message_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare m proj_messages;
begin
  perform proj_require_user();
  select * into m from proj_messages where id = p_message_id for update;
  if not found or not proj_can_view_details(m.project_id) then raise exception 'Message not found' using errcode = 'P0002'; end if;
  if m.author_id <> auth.uid() and not proj_can_manage(m.project_id) then
    raise exception 'Only the author, the Project Manager or a founder can delete a message' using errcode = '42501';
  end if;
  if m.deleted_at is not null then return; end if;
  insert into proj_message_tombstones (message_id, project_id, original_body, deleted_by, reason) values (m.id, m.project_id, m.body, auth.uid(), nullif(btrim(p_reason), ''));
  update proj_messages set body = '', deleted_at = now(), deleted_by = auth.uid(), changed_at = now() where id = m.id;
  delete from proj_message_mentions where message_id = m.id;
  perform proj_log_change(m.project_id, 'message', m.id, 'deleted', proj_display_name(m.author_id), proj_display_name(auth.uid()), p_reason);
end;
$$;

-- Polling endpoint: new messages after a cursor, plus any message edited or deleted since a timestamp. Cheap, bounded.
create or replace function proj_messages_since(p_project_id uuid, p_after_seq bigint default 0, p_changed_since timestamptz default null, p_limit integer default 200)
returns table (id uuid, seq bigint, parent_id uuid, author_id uuid, author_name text, body text, created_at timestamptz, edited_at timestamptz,
               deleted_at timestamptz, changed_at timestamptz, mention_ids uuid[])
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if not proj_can_view_details(p_project_id) then return; end if;
  return query
    select m.id, m.seq, m.parent_id, m.author_id, proj_display_name(m.author_id), m.body, m.created_at, m.edited_at, m.deleted_at, m.changed_at,
           coalesce((select array_agg(x.user_id) from proj_message_mentions x where x.message_id = m.id), '{}'::uuid[])
    from proj_messages m
    where m.project_id = p_project_id
      and (m.seq > coalesce(p_after_seq, 0) or (p_changed_since is not null and m.changed_at > p_changed_since))
    order by m.seq
    limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

create or replace function proj_mark_read(p_project_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_max bigint;
begin
  perform proj_require_user();
  if not proj_can_view_details(p_project_id) then return; end if;
  select coalesce(max(seq), 0) into v_max from proj_messages where project_id = p_project_id;
  insert into proj_read_state (project_id, user_id, last_read_seq, last_read_at) values (p_project_id, auth.uid(), v_max, now())
  on conflict (project_id, user_id) do update set last_read_seq = greatest(proj_read_state.last_read_seq, excluded.last_read_seq), last_read_at = now();
end;
$$;

-- Unread messages per project for the caller: other people's messages after what they last read (or after they joined).
create or replace function proj_unread_counts()
returns table (project_id uuid, unread integer, mentioned boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  return query
    select pr.id,
           (select count(*)::integer from proj_messages m
             where m.project_id = pr.id and m.author_id <> auth.uid() and m.deleted_at is null
               and m.seq > coalesce((select rs.last_read_seq from proj_read_state rs where rs.project_id = pr.id and rs.user_id = auth.uid()), 0)
               and m.created_at > coalesce((select mm.added_at from proj_project_members mm where mm.project_id = pr.id and mm.user_id = auth.uid() and mm.removed_at is null), '-infinity'::timestamptz)),
           exists (select 1 from proj_message_mentions mn join proj_messages m on m.id = mn.message_id
                    where mn.project_id = pr.id and mn.user_id = auth.uid() and m.deleted_at is null
                      and m.seq > coalesce((select rs.last_read_seq from proj_read_state rs where rs.project_id = pr.id and rs.user_id = auth.uid()), 0))
    from proj_projects pr
    where proj_can_view_details(pr.id) and pr.status not in ('archived');
end;
$$;

-- -----------------------------------------------------------------------------
-- My project notifications, limited to what I can still see. Handover notices (no project yet) are always mine.
-- -----------------------------------------------------------------------------
create or replace function proj_my_notifications(p_limit integer default 50, p_only_unread boolean default false)
returns table (id uuid, type text, payload jsonb, read_at timestamptz, created_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  return query
    select n.id, n.type, n.payload, n.read_at, n.created_at
    from notifications n
    where n.user_id = auth.uid() and n.type like 'project\_%'
      and (not p_only_unread or n.read_at is null)
      and (n.payload->>'project_id' is null or proj_user_is_participant((n.payload->>'project_id')::uuid, auth.uid()))
    order by n.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create or replace function proj_mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  perform proj_require_user();
  update notifications set read_at = now()
   where user_id = auth.uid() and type like 'project\_%' and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['proj_plan_items', 'proj_external_dependencies', 'proj_site_bookings', 'proj_messages', 'proj_message_tombstones', 'proj_message_mentions', 'proj_read_state'] loop
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant select on table %I to authenticated', t);
  end loop;
end $$;
revoke all on sequence proj_messages_seq_seq from public, anon, authenticated;

revoke all on function
  proj_member_blockers(uuid, uuid), proj_can_book(uuid, uuid), proj_user_is_participant(uuid, uuid),
  proj_save_plan_item(uuid, uuid, jsonb), proj_delete_plan_item(uuid), proj_apply_plan_template(uuid, text, jsonb, date),
  proj_save_external_dependency(uuid, uuid, jsonb), proj_delete_external_dependency(uuid),
  proj_save_booking(uuid, uuid, jsonb), proj_booking_conflicts(uuid), proj_confirm_booking(uuid, text), proj_cancel_booking(uuid, text),
  proj_my_calendar(date, date, text), proj_company_calendar(uuid, date, date), proj_project_calendar(uuid, date, date, text),
  proj_post_message(uuid, text, uuid, uuid, uuid[]), proj_edit_message(uuid, text), proj_delete_message(uuid, text),
  proj_messages_since(uuid, bigint, timestamptz, integer), proj_mark_read(uuid), proj_unread_counts(),
  proj_my_notifications(integer, boolean), proj_mark_notifications_read(uuid[])
  from public, anon, authenticated;

grant execute on function
  proj_save_plan_item(uuid, uuid, jsonb), proj_delete_plan_item(uuid), proj_apply_plan_template(uuid, text, jsonb, date),
  proj_save_external_dependency(uuid, uuid, jsonb), proj_delete_external_dependency(uuid),
  proj_save_booking(uuid, uuid, jsonb), proj_booking_conflicts(uuid), proj_confirm_booking(uuid, text), proj_cancel_booking(uuid, text),
  proj_my_calendar(date, date, text), proj_company_calendar(uuid, date, date), proj_project_calendar(uuid, date, date, text),
  proj_post_message(uuid, text, uuid, uuid, uuid[]), proj_edit_message(uuid, text), proj_delete_message(uuid, text),
  proj_messages_since(uuid, bigint, timestamptz, integer), proj_mark_read(uuid), proj_unread_counts(),
  proj_my_notifications(integer, boolean), proj_mark_notifications_read(uuid[])
  to authenticated;
