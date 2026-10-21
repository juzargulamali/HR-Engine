-- Inventory, migration 3 of 6: technology templates, equipment requests, reservations, Sales availability checks, stock counts.
--
-- A technology template is a RECIPE (a checklist of items and quantities), never extra physical stock. Expanding it into a request
-- copies the lines (a snapshot), so later template edits never silently change a project. A physical assembled kit is a different
-- thing (migration 2); an available kit and its components are never counted twice.
-- Reservations are future commitments on dates. They are separate from where equipment physically is, and they are enforced by the
-- database itself: an exclusion constraint for individual units and a per-item lock for quantities (see migration 5).
-- All tables here are READ-ONLY to clients; changes go through the SECURITY DEFINER functions of migrations 4-6.

-- -----------------------------------------------------------------------------
-- Technology templates
-- -----------------------------------------------------------------------------
create table if not exists inv_technologies (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id),
  name         text not null check (length(btrim(name)) between 1 and 160),
  description  text,
  -- draft: still being written. complete: the checklist is trusted for availability checks. retired: kept for history.
  status       text not null default 'draft' check (status in ('draft', 'complete', 'retired')),
  version      integer not null default 1,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_inv_technologies_name on inv_technologies(company_id, lower(btrim(name))) where status <> 'retired';

create table if not exists inv_technology_components (
  id             uuid primary key default gen_random_uuid(),
  technology_id  uuid not null references inv_technologies(id),
  company_id     uuid not null references companies(id),
  item_id        uuid not null references inv_items(id),
  qty            numeric(14, 3) not null check (qty > 0),
  -- Components sharing an alternative group are alternatives to each other (one is needed). The first by sort order is the
  -- standard choice; any other must be chosen on purpose and is marked as a substitute on the request. Technically different
  -- models are never assumed interchangeable: only alternatives written into the template are offered.
  alt_group      text,
  is_optional    boolean not null default false,
  note           text,
  sort_order     integer not null default 0
);
create index if not exists idx_inv_tech_components_tech on inv_technology_components(technology_id);
create unique index if not exists uq_inv_tech_components_item on inv_technology_components(technology_id, item_id);

-- -----------------------------------------------------------------------------
-- Requests to the warehouse: for a project, or for an employee's permanent equipment.
-- -----------------------------------------------------------------------------
create table if not exists inv_requests (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),      -- the company whose warehouse is asked
  code             text not null unique,
  kind             text not null check (kind in ('project', 'employee')),
  project_id       uuid references proj_projects(id),
  employee_id      uuid references employees(id),
  requested_by     uuid not null references auth.users(id),
  status           text not null default 'draft' check (status in ('draft', 'submitted', 'in_progress', 'fulfilled', 'cancelled', 'closed')),
  title            text,
  destination      text,                                          -- where it is needed (site or place), free text
  pickup_location_id uuid references inv_locations(id),           -- preferred source location
  timezone         text not null check (proj_valid_timezone(timezone)),   -- local dates below are in this zone
  -- The named phases, in local time: prep_start, dispatch, install_start, show_start, show_end, dismantle_end, return_due,
  -- inspect_until. Any may be missing. needed_from / needed_until are the UTC window derived from them (what is blocked).
  plan             jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object'),
  needed_from      timestamptz,
  needed_until     timestamptz,
  expected_return_at timestamptz,
  source           text not null default 'manual' check (source in ('manual', 'sales_handover')),
  source_ref       uuid,                                          -- the CRM opportunity a handover import came from
  note             text,
  version          integer not null default 1,
  submitted_at     timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint inv_requests_target check ((kind = 'project') = (project_id is not null) and (kind = 'employee') = (employee_id is not null)),
  constraint inv_requests_window check (needed_until is null or needed_from is null or needed_until > needed_from),
  constraint inv_requests_cancel check ((status = 'cancelled') = (cancelled_at is not null))
);
-- A handover import happens once per project and opportunity, however often it is retried.
create unique index if not exists uq_inv_requests_handover on inv_requests(project_id, source_ref) where source = 'sales_handover';
create index if not exists idx_inv_requests_project on inv_requests(project_id) where project_id is not null;
create index if not exists idx_inv_requests_employee on inv_requests(employee_id) where employee_id is not null;
create index if not exists idx_inv_requests_company_status on inv_requests(company_id, status);

alter table inv_movements drop constraint if exists inv_movements_request_fk;
alter table inv_movements add constraint inv_movements_request_fk foreign key (request_id) references inv_requests(id);

create table if not exists inv_request_lines (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null references inv_requests(id),
  company_id          uuid not null references companies(id),
  item_id             uuid not null references inv_items(id),
  qty                 numeric(14, 3) not null check (qty > 0),
  -- Where the line came from: a template expansion keeps a snapshot of what the template said at that moment.
  technology_id       uuid references inv_technologies(id),
  technology_snapshot jsonb,
  alt_group           text,
  is_optional         boolean not null default false,
  -- Substitution: the template's standard item is original_item_id; choosing another is a substitute that the project's PM (or
  -- an authorised project person) accepts on the record before the warehouse treats it as the requirement.
  original_item_id    uuid references inv_items(id),
  substitution_status text not null default 'none' check (substitution_status in ('none', 'proposed', 'accepted', 'declined')),
  substitution_by     uuid references auth.users(id),
  substitution_at     timestamptz,
  substitution_note   text,
  -- A shortage can become a purchase or rental need; the external reference is recorded, there is no purchasing system here.
  shortage_action     text not null default 'none' check (shortage_action in ('none', 'need_to_buy', 'need_to_rent')),
  shortage_note       text,
  rental_reference    text,
  status              text not null default 'open' check (status in ('open', 'cancelled', 'closed')),
  note                text,
  sort_order          integer not null default 0,
  version             integer not null default 1,
  created_at          timestamptz not null default now()
);
create index if not exists idx_inv_request_lines_request on inv_request_lines(request_id);
create index if not exists idx_inv_request_lines_item on inv_request_lines(item_id);

-- -----------------------------------------------------------------------------
-- Reservations. unit_id for an individually tracked unit or kit (qty is then 1); location_id + qty for quantity stock.
-- Stays 'active' while the equipment is out on the project (dispatched) and becomes 'completed' when it is back, so a dispatched
-- unit keeps blocking overlapping bookings.
-- -----------------------------------------------------------------------------
create table if not exists inv_reservations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  request_line_id  uuid not null references inv_request_lines(id),
  item_id          uuid not null references inv_items(id),
  unit_id          uuid references inv_units(id),
  location_id      uuid references inv_locations(id),
  qty              numeric(14, 3) not null check (qty > 0),
  dispatched_qty   numeric(14, 3) not null default 0 check (dispatched_qty >= 0),
  returned_qty     numeric(14, 3) not null default 0 check (returned_qty >= 0),
  reserved_during  tstzrange not null check (not isempty(reserved_during) and lower_inf(reserved_during) = false and upper_inf(reserved_during) = false),
  status           text not null default 'active' check (status in ('active', 'released', 'completed')),
  released_reason  text,
  made_by          uuid not null references auth.users(id),
  made_at          timestamptz not null default now(),
  released_at      timestamptz,
  constraint inv_reservations_target check ((unit_id is not null and qty = 1) or (unit_id is null and location_id is not null)),
  constraint inv_reservations_progress check (dispatched_qty <= qty and returned_qty <= dispatched_qty),
  constraint inv_reservations_release check ((status = 'released') = (released_at is not null)),
  -- THE guarantee for individual equipment: two active reservations of the same unit can never overlap in time, even when two
  -- people press the button at the same instant.
  constraint inv_reservations_no_overlap exclude using gist (unit_id with =, reserved_during with &&) where (unit_id is not null and status = 'active')
);
create index if not exists idx_inv_reservations_line on inv_reservations(request_line_id);
create index if not exists idx_inv_reservations_item_active on inv_reservations(item_id) where status = 'active';

-- -----------------------------------------------------------------------------
-- Sales availability checks. A check is a dated record, never a reservation, and never overwritten: a new check supersedes the old one
-- and the old one stays in history. It is out of date as soon as the opportunity's dates, location, technologies or quantities
-- move away from what it covered (compared in migration 5, never stored as a state).
-- -----------------------------------------------------------------------------
create table if not exists inv_availability_checks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  opportunity_id   uuid not null references crm_opportunities(id),
  location_id      uuid references inv_locations(id),
  requested_by     uuid not null references auth.users(id),
  requested_at     timestamptz not null default now(),
  checked_by       uuid references auth.users(id),
  checked_at       timestamptz,
  -- pending: asked for, not yet done. available: everything needed is free. partial / short: something is missing.
  -- check_required: a technology has no complete template, so no result was invented.
  result           text not null default 'pending' check (result in ('pending', 'available', 'partial', 'short', 'check_required')),
  summary          jsonb not null default '[]'::jsonb check (jsonb_typeof(summary) = 'array'),
  covers           jsonb,
  note             text,
  superseded_by    uuid references inv_availability_checks(id),
  constraint inv_availability_checked check ((result = 'pending') = (checked_at is null))
);
create index if not exists idx_inv_availability_checks_opp on inv_availability_checks(opportunity_id, requested_at desc);

-- -----------------------------------------------------------------------------
-- Stock counts: opening stock and cycle counts share one flow. Counted quantities are written first and only become stock
-- changes (adjustments with a reason) when an authorised person confirms; nothing is verified until then.
-- -----------------------------------------------------------------------------
create table if not exists inv_counts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  code          text not null unique,
  kind          text not null check (kind in ('opening', 'cycle')),
  location_id   uuid not null references inv_locations(id),
  status        text not null default 'open' check (status in ('open', 'confirmed', 'cancelled')),
  note          text,
  started_by    uuid not null references auth.users(id),
  started_at    timestamptz not null default now(),
  confirmed_by  uuid references auth.users(id),
  confirmed_at  timestamptz,
  constraint inv_counts_confirmed check ((status = 'confirmed') = (confirmed_at is not null))
);
create table if not exists inv_count_lines (
  id            uuid primary key default gen_random_uuid(),
  count_id      uuid not null references inv_counts(id),
  company_id    uuid not null references companies(id),
  item_id       uuid not null references inv_items(id),
  unit_id       uuid references inv_units(id),
  balance_id    uuid references inv_balances(id),
  bin_id        uuid references inv_bins(id),
  condition     text,
  expected_qty  numeric(14, 3),
  counted_qty   numeric(14, 3) not null check (counted_qty >= 0),
  reason        text,
  note          text
);
create index if not exists idx_inv_count_lines_count on inv_count_lines(count_id);

-- Outcome of the automatic requirement import at Sales handover (never blocks the handover; the PM can re-run it).
create table if not exists inv_import_log (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  project_id  uuid references proj_projects(id),
  source_ref  uuid,
  outcome     text not null check (outcome in ('imported', 'nothing_to_import', 'failed')),
  detail      text,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Row-level security: SELECT only. Project requests are visible to the project's members; employee requests to the requester and the
-- employee; everything else to founders, warehouse operators and stock readers.
-- -----------------------------------------------------------------------------
create or replace function inv_can_see_request(p_request_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from inv_requests r
    where r.id = p_request_id
      and (inv_can_view_stock(r.company_id)
           or r.requested_by = auth.uid()
           or (r.project_id is not null and proj_can_view_details(r.project_id))
           or (r.employee_id is not null and exists (select 1 from employees e where e.id = r.employee_id and e.user_id = auth.uid()))
           or (r.employee_id is not null and inv_has_capability(r.company_id, 'view_employee_custody'))));
$$;

alter table inv_technologies enable row level security;
drop policy if exists inv_technologies_select on inv_technologies;
create policy inv_technologies_select on inv_technologies for select using (inv_can_browse(company_id));
alter table inv_technology_components enable row level security;
drop policy if exists inv_technology_components_select on inv_technology_components;
create policy inv_technology_components_select on inv_technology_components for select using (inv_can_browse(company_id));

alter table inv_requests enable row level security;
drop policy if exists inv_requests_select on inv_requests;
create policy inv_requests_select on inv_requests for select using (inv_can_see_request(id));
alter table inv_request_lines enable row level security;
drop policy if exists inv_request_lines_select on inv_request_lines;
create policy inv_request_lines_select on inv_request_lines for select using (inv_can_see_request(request_id));
alter table inv_reservations enable row level security;
drop policy if exists inv_reservations_select on inv_reservations;
create policy inv_reservations_select on inv_reservations for select
  using (inv_can_view_stock(company_id) or exists (select 1 from inv_request_lines l where l.id = request_line_id and inv_can_see_request(l.request_id)));

alter table inv_availability_checks enable row level security;
drop policy if exists inv_availability_checks_select on inv_availability_checks;
create policy inv_availability_checks_select on inv_availability_checks for select
  using (inv_can_view_stock(company_id) or inv_has_capability(company_id, 'founder')
         or exists (select 1 from crm_opportunities o where o.id = opportunity_id and crm_has_access(o.company_id) and (o.owner_id = auth.uid() or crm_is_founder(o.company_id))));

alter table inv_counts enable row level security;
drop policy if exists inv_counts_select on inv_counts;
create policy inv_counts_select on inv_counts for select using (inv_can_view_stock(company_id));
alter table inv_count_lines enable row level security;
drop policy if exists inv_count_lines_select on inv_count_lines;
create policy inv_count_lines_select on inv_count_lines for select using (inv_can_view_stock(company_id));
alter table inv_import_log enable row level security;
drop policy if exists inv_import_log_select on inv_import_log;
create policy inv_import_log_select on inv_import_log for select using (inv_can_view_stock(company_id) or (project_id is not null and proj_can_manage(project_id)));

do $$
declare t text;
begin
  foreach t in array array['inv_technologies', 'inv_technology_components', 'inv_requests', 'inv_request_lines', 'inv_reservations',
                           'inv_availability_checks', 'inv_counts', 'inv_count_lines'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function inv_audit_trigger()', t || '_audit', t);
  end loop;
  foreach t in array array['inv_technologies', 'inv_technology_components', 'inv_requests', 'inv_request_lines', 'inv_reservations',
                           'inv_availability_checks', 'inv_counts', 'inv_count_lines', 'inv_import_log'] loop
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant select on table %I to authenticated', t);
  end loop;
end $$;

revoke all on function inv_can_see_request(uuid) from public, anon, authenticated;
grant execute on function inv_can_see_request(uuid) to authenticated;

-- ROLLBACK (only before any Inventory data exists):
--   drop table if exists inv_import_log, inv_count_lines, inv_counts, inv_availability_checks, inv_reservations, inv_request_lines,
--     inv_requests, inv_technology_components, inv_technologies cascade;
--   alter table inv_movements drop constraint if exists inv_movements_request_fk;
--   drop function if exists inv_can_see_request(uuid);
