-- Recovery Leave earning: single-step HR queue routing, generalized into a
-- 4-tier self-clock routing matrix, plus the employee self-service
-- attendance-clocking feature that replaces the Jibble integration this
-- schema previously staged (never applied to Production; its migration
-- files were removed outright rather than layered over -- see PR #16's own
-- description for the full "what changed and why").
--
-- This migration brings recovery_credit fully up to date in one step, since
-- nothing in this feature line (the original Project-Manager/HR-owner
-- design, the Jibble-driven single-step-queue redesign that superseded it,
-- or this self-clock redesign that supersedes THAT) has ever been applied
-- to Production:
--
--   1. Recovery Leave earning moves off the original direct_manager ->
--      role:hr_admin two-step chain for every EXISTING company (a single
--      HR Admin, picked once and forever by earliest granted_at -- a real
--      reliability gap) onto a proper decision mechanism: a company-scoped
--      queue any CURRENT holder of the relevant role(s) may decide (see
--      approvals.queue_roles and approval_workflow_steps.approver_type's
--      'role_queue:%' convention). This migration is SAFE, ADDITIVE, and
--      DORMANT for existing companies: seed_default_approval_workflows()
--      only ever fires on NEW company creation, so every EXISTING
--      company's live recovery_credit routing is untouched until the
--      separate, manually-applied cutover
--      (supabase/manual-sql/recovery_leave_hr_queue_stage2_cutover.sql)
--      versions it over -- see that file's own header for exactly why an
--      in-place UPDATE of approval_workflow_steps would be unsafe for a
--      request already mid-chain.
--
--   2. Employees now clock in/out directly in HR Engine (attendance_sessions/
--      attendance_segments/attendance_locations, and the clock_in()/
--      switch_work_segment()/clock_out() RPCs) -- no third-party
--      time-tracking system. A session is one continuous clock-in-to-
--      clock-out period made of one or more segments, each carrying its
--      own work mode/project/lead, so switching context mid-shift never
--      requires an artificial clock-out/clock-in. Every timestamp is
--      server-side; there is deliberately no start/end-break action --
--      elapsed duration is always segment_end - segment_start.
--
--   3. A potential Recovery Leave credit is detected the SAME way for
--      self-clock as for the pre-existing manual attendance register:
--      is_recovery_eligible_day() -- a public holiday, or outside the
--      employee's country's normal working weekdays -- but Office and WFH
--      self-clock work now qualifies exactly like Site work (never
--      restricted to Site work / Installation). sync_attendance_recovery_
--      for_day() re-derives a whole employee/day fresh from every closed
--      segment on file for it, every time, so multiple sessions or a
--      mid-shift mode switch can never produce a duplicate or drifted
--      credit.
--
--   4. Newly earned self-clock credit routes through one of four tiers
--      (recovery_credit_requests.applicant_route -- see that column's own
--      doc comment): the employee's selected project lead then HR; a
--      permanent Manager straight to HR; an HR Admin to a shared CEO/CTO
--      queue (either may decide); or, when the employee themselves was the
--      selected lead, straight to HR for independent verification. The
--      route is snapshotted ONCE at creation so a later role or profile
--      change never silently reroutes an in-flight request. A candidate
--      that legitimately needs a lead but never captured one (Office/WFH
--      work only requires a lead "when relevant") is held with no
--      approvals row at all (awaiting_project_lead) until
--      resolve_recovery_credit_project_lead() supplies one -- never
--      guessed, never discarded.
--
--   5. The LEGACY manual-attendance-register and overnight-recovery paths
--      (record_attendance_and_recovery()/record_overnight_recovery_credit())
--      are UNCHANGED in shape: they still route through the single-step
--      role_queue:hr_admin mechanism from point 1 above, never the 4-tier
--      matrix -- that register has no project-lead capture mechanism at
--      all, and retrofitting it was never part of this feature's scope.
--
-- Every function touched below that ALSO existed before this migration
-- (record_attendance_and_recovery, record_overnight_recovery_credit,
-- create_initial_approval, decide_leave_approval, is_entity_owner,
-- guard_comp_day_ledger_single_active_credit, seed_default_approval_workflows)
-- is backward compatible with every EXISTING approvals row: those rows all
-- have a non-null approver_id (this migration only ever loosens that column
-- to nullable, never changes an existing value), so they keep going through
-- the exact same "approver_id must equal auth.uid()" check as before -- the
-- new queue_roles/role_queue branches are reachable only by a step this
-- migration's own code (or the separate cutover file) creates.

-- ---------------------------------------------------------------------
-- 1. New tables: the employee self-clock path (see attendance_sessions'
--    own doc comment in schema.sql for the full design). Created FIRST,
--    before section 2's new columns, since recovery_credit_requests.
--    segment_id references attendance_segments.
-- ---------------------------------------------------------------------

create table attendance_sessions (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id),
  clock_in_at    timestamptz not null default now(),
  clock_out_at   timestamptz,   -- null = still open
  status         text not null default 'open' check (status in ('open', 'closed')),
  -- Set only by hr_close_attendance_session() — the "missing clock-out"
  -- correction path. The ORIGINAL clock_in_at above is never altered by
  -- it; these columns are purely additive, so a forgotten clock-out is
  -- always visibly distinguishable from a normal employee-initiated one.
  hr_closed_by   uuid references auth.users(id),
  hr_closed_at   timestamptz,
  hr_closed_reason text,
  created_at     timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at > clock_in_at)
);

create unique index attendance_sessions_one_open_per_employee
  on attendance_sessions(employee_id) where status = 'open';
create index idx_attendance_sessions_employee on attendance_sessions(employee_id, clock_in_at desc);

create table attendance_segments (
  id                        uuid primary key default gen_random_uuid(),
  session_id                uuid not null references attendance_sessions(id),
  employee_id               uuid not null references employees(id),  -- denormalized from the session for RLS/query convenience; set once, never updated
  work_mode                 text not null check (work_mode in ('office', 'wfh', 'site_work', 'client_meeting', 'business_travel')),
  -- Typed freely, no pre-created project list required — "no pre-created
  -- project list is required" is a product requirement, not a shortcut:
  -- HR reviews the free text on the approval screen instead.
  project_name              text,
  project_lead_employee_id  uuid references employees(id),
  segment_start             timestamptz not null,
  segment_end               timestamptz,   -- null = the current active segment
  created_at                timestamptz not null default now(),
  check (segment_end is null or segment_end > segment_start),
  -- Site work / Installation always needs a named project AND a lead
  -- selected up front (never guessed later) — every other mode may supply
  -- them when relevant but is never required to.
  check (work_mode <> 'site_work' or (project_name is not null and length(trim(project_name)) > 0 and project_lead_employee_id is not null))
);

create unique index attendance_segments_one_open_per_session
  on attendance_segments(session_id) where segment_end is null;
create index idx_attendance_segments_session on attendance_segments(session_id, segment_start);
create index idx_attendance_segments_employee on attendance_segments(employee_id, segment_start);
create index idx_attendance_segments_lead on attendance_segments(project_lead_employee_id) where project_lead_employee_id is not null;

create table attendance_locations (
  id                 uuid primary key default gen_random_uuid(),
  segment_id         uuid not null references attendance_segments(id),
  event              text not null check (event in ('segment_start', 'segment_end')),
  latitude           numeric(9,6),
  longitude          numeric(9,6),
  accuracy_meters    numeric,
  permission_status  text not null check (permission_status in ('granted', 'denied', 'unavailable', 'timeout')),
  captured_at        timestamptz not null default now(),
  unique (segment_id, event)
);

create index idx_attendance_locations_segment on attendance_locations(segment_id);

alter table attendance_sessions enable row level security;
alter table attendance_segments enable row level security;
alter table attendance_locations enable row level security;

-- ---------------------------------------------------------------------
-- 2. New columns
-- ---------------------------------------------------------------------

alter table approvals alter column approver_id drop not null;
comment on column approvals.approver_id is
  'Nullable specifically for a legacy ''role_queue:%'' step or a self-clock queue_roles step -- every OTHER approver type still always resolves to and stores a specific person, unchanged.';

alter table approvals add column queue_roles app_role[];
comment on column approvals.queue_roles is
  'Self-clock 4-tier routing''s own queue mechanism (see recovery_credit_requests.applicant_route) -- null for a person-specific step and for every legacy role_queue:% step. More than one element only for the shared CEO/CTO queue.';

alter table recovery_credit_requests alter column attendance_record_id drop not null;
alter table recovery_credit_requests add column segment_id uuid references attendance_segments(id);
alter table recovery_credit_requests add column correction_reason text;
alter table recovery_credit_requests add column checked_with text;
alter table recovery_credit_requests add column corrected_by uuid references auth.users(id);
alter table recovery_credit_requests add column corrected_at timestamptz;
alter table recovery_credit_requests add column work_mode text;
alter table recovery_credit_requests add column project_name text;
alter table recovery_credit_requests add column project_lead_employee_id uuid references employees(id);
alter table recovery_credit_requests add column applicant_route text
  check (applicant_route in ('employee_lead_then_hr', 'manager_hr_direct', 'hr_admin_ceo_cto_queue', 'self_led_hr_direct'));
alter table recovery_credit_requests add column awaiting_project_lead boolean not null default false;
alter table recovery_credit_requests add column needs_policy_review boolean not null default false;
alter table recovery_credit_requests add column routing_issue text;
alter table recovery_credit_requests add constraint recovery_credit_requests_source_check
  check ((attendance_record_id is not null) <> (segment_id is not null));

comment on column recovery_credit_requests.work_date is
  'The CURRENT/EFFECTIVE work date -- what the ledger actually uses when this is approved. adjust_recovery_credit_request()/sync_attendance_recovery_for_day() are the only ways this ever changes after creation; the original, unedited date stays on the originating attendance evidence forever.';
comment on column recovery_credit_requests.proposed_days is
  'The CURRENT/EFFECTIVE proposed credit, recomputed server-side via recovery_credit_days_for_hours() whenever HR corrects the hours -- never trusted from the client directly.';

-- Superseded by the two partial indexes below, one per evidence family
-- (attendance_record_id was NOT NULL when this index was first created --
-- see recovery_credit_requests_active_per_record's own doc comment in
-- schema.sql for why a plain unique index on a now-nullable column can't
-- enforce uniqueness for the self-clock family at all).
drop index if exists recovery_credit_requests_active_per_record;

create unique index recovery_credit_requests_active_per_record
  on recovery_credit_requests(attendance_record_id)
  where status not in ('cancelled', 'rejected') and attendance_record_id is not null;

create unique index recovery_credit_requests_active_per_day
  on recovery_credit_requests(employee_id, work_date, event_type)
  where status not in ('cancelled', 'rejected') and segment_id is not null;

-- ---------------------------------------------------------------------
-- 3. Shared helpers -- country timezone, the credit threshold, and the
--    "qualifying day" rule, extracted so every recording path (manual
--    register, overnight form, self-clock sync, HR's own correction)
--    shares exactly one implementation of each.
-- ---------------------------------------------------------------------

create or replace function country_timezone(p_country_code text)
returns text
language sql
immutable
as $$
  select case p_country_code
    when 'AE' then 'Asia/Dubai'
    when 'SA' then 'Asia/Riyadh'
    when 'PL' then 'Europe/Warsaw'
    else 'Asia/Dubai'
  end;
$$;

create or replace function recovery_credit_days_for_hours(p_hours numeric)
returns numeric
language sql
immutable
as $$
  select case when p_hours is null or p_hours <= 0 then 0 when p_hours > 4 then 1 else 0.5 end;
$$;

create or replace function is_recovery_eligible_day(p_country_code text, p_work_date date, out is_recovery_day boolean, out holiday_name text)
language plpgsql
stable
as $$
declare
  v_week_start_day smallint;
  v_working_weekdays integer[];
begin
  select week_start_day, working_weekdays into v_week_start_day, v_working_weekdays from countries where code = p_country_code;
  select name into holiday_name from public_holidays where country_code = p_country_code and holiday_date = p_work_date;
  is_recovery_day := holiday_name is not null
    or (
      case when v_working_weekdays is not null and array_length(v_working_weekdays, 1) > 0
        then not (extract(dow from p_work_date)::int = any(v_working_weekdays))
        else ((extract(dow from p_work_date)::int - coalesce(v_week_start_day, 1) + 7) % 7) >= 5
      end
    );
end;
$$;

-- ---------------------------------------------------------------------
-- 4. record_attendance_and_recovery() / record_overnight_recovery_credit():
--    the pre-existing manual/overnight recording paths, refactored to call
--    the shared helpers above instead of inline weekend/holiday and
--    threshold logic (verified equivalent math), plus one real correctness
--    fix: the manual register's own upsert now always reasserts
--    source = 'manual' on conflict. Full bodies required by CREATE OR
--    REPLACE.
-- ---------------------------------------------------------------------

create or replace function record_attendance_and_recovery(p_work_date date, p_rows jsonb)
returns table(attendance_employee_id uuid, credited boolean, reversed boolean, needs_policy_review boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_employee_id uuid;
  v_status text;
  v_work_mode text;
  v_hours numeric;
  v_company_id uuid;
  v_country_code text;
  v_holiday_name text;
  v_is_recovery_day boolean;
  v_record_id uuid;
  v_was_credited comp_day_ledger%rowtype;
  v_existing_request recovery_credit_requests%rowtype;
  v_credit_days numeric;
  v_request_id uuid;
  v_credited boolean;
  v_reversed boolean;
  v_needs_review boolean;
begin
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_employee_id := (v_row ->> 'employee_id')::uuid;
    v_status := v_row ->> 'status';
    v_work_mode := nullif(v_row ->> 'work_mode', '');
    v_hours := nullif(v_row ->> 'hours_worked', '')::numeric;
    v_credited := false;
    v_reversed := false;
    v_needs_review := false;

    select e.company_id, e.country_code into v_company_id, v_country_code
    from employees e where e.id = v_employee_id;
    if v_company_id is null then
      raise exception 'Employee % not found', v_employee_id;
    end if;
    if not has_role('hr_admin', v_company_id) then
      raise exception 'Only HR Admin may record attendance for this employee';
    end if;

    -- Same advisory lock decide_leave_approval() takes before touching an
    -- employee's comp-day balance, for the same reason: without it, two
    -- concurrent saves for this employee (a double-clicked Save, or two
    -- admins editing the same date) could both read "not yet requested"
    -- before either has committed its insert, and both request it.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_employee_id::text));

    select r.is_recovery_day, r.holiday_name into v_is_recovery_day, v_holiday_name from is_recovery_eligible_day(v_country_code, p_work_date) r;

    -- One atomic upsert rather than a check-then-branch — the latter has
    -- the same TOCTOU shape as the race bulkRecordAttendance()'s old
    -- "already credited?" check had (two concurrent saves for the same
    -- employee/date, e.g. a double-clicked Save, could otherwise both see
    -- "no existing row" and both attempt an insert).
    -- source = 'manual' is set on BOTH the insert and the conflict branch —
    -- the manual register always reasserts manual ownership of this day.
    insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
    values (v_employee_id, p_work_date, v_status, v_work_mode, v_hours, 'manual')
    on conflict (employee_id, work_date) do update
    set status = excluded.status, work_mode = excluded.work_mode, hours_worked = excluded.hours_worked, source = 'manual'
    returning id into v_record_id;

    -- The CURRENTLY ACTIVE credit for this record, if any — an 'earned' row
    -- that hasn't itself already been reversed — and any still-active
    -- (non-cancelled/non-rejected) recovery_credit_requests row.
    select cl.* into v_was_credited from comp_day_ledger cl
    where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
    select r.* into v_existing_request from recovery_credit_requests r
    where r.attendance_record_id = v_record_id and r.status not in ('cancelled', 'rejected');

    if v_is_recovery_day and v_status = 'present' then
      if v_was_credited.id is null and v_existing_request.id is null then
        if v_hours is null then
          v_needs_review := true;
        elsif v_hours > 0 then
          v_credit_days := recovery_credit_days_for_hours(v_hours);
          insert into recovery_credit_requests (employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by)
          values (v_employee_id, v_record_id, p_work_date, 'standard', v_credit_days, auth.uid())
          returning id into v_request_id;
          perform create_initial_approval('recovery_credit', v_request_id);
          v_credited := true;
        end if;
      end if;
    else
      -- No longer an eligible day (corrected away from present, or no
      -- longer a recovery day). Reverse an already-fully-approved credit
      -- via the same linked-reversal pattern as before; ANY still-active
      -- request (submitted, pending_approval, OR already approved) is
      -- cancelled too — never deleted, same append-only convention
      -- cancel_leave_request() uses for approvals — so a later correction
      -- back to present can earn a genuinely fresh request for this day.
      if v_was_credited.id is not null then
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
        values (v_was_credited.employee_id, current_date, 'reversal', -v_was_credited.days, 'holiday_worked', 'attendance_record', v_record_id, v_was_credited.id, auth.uid());
        v_reversed := true;
      end if;
      if v_existing_request.id is not null then
        update recovery_credit_requests set status = 'cancelled', decided_at = now() where id = v_existing_request.id;
        update approvals
        set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, 'Cancelled: attendance record no longer qualifies')
        where entity_type = 'recovery_credit' and entity_id = v_existing_request.id and decision = 'pending';
      end if;
    end if;

    attendance_employee_id := v_employee_id;
    credited := v_credited;
    reversed := v_reversed;
    needs_policy_review := v_needs_review;
    return next;
  end loop;
end;
$$;

create or replace function record_overnight_recovery_credit(
  p_employee_id uuid,
  p_work_date date,
  p_completed_normal_scheduled_day boolean,
  p_active_hours_after_midnight numeric
)
returns table(credited boolean, credit_days numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_record_id uuid;
  v_was_credited comp_day_ledger%rowtype;
  v_existing_request recovery_credit_requests%rowtype;
  v_credit_days numeric;
  v_request_id uuid;
begin
  select company_id into v_company_id from employees where id = p_employee_id and deleted_at is null;
  if v_company_id is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  if not (has_role('hr_admin', v_company_id) or is_manager_of(p_employee_id)) then
    raise exception 'Only HR Admin or this employee''s manager may record an overnight recovery credit';
  end if;

  if p_active_hours_after_midnight is null or p_active_hours_after_midnight < 0 then
    raise exception 'active_hours_after_midnight must be a non-negative number';
  end if;

  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  select id into v_record_id from attendance_records where employee_id = p_employee_id and work_date = p_work_date;
  if v_record_id is null then
    raise exception 'Record ordinary attendance for % on % first', p_employee_id, p_work_date;
  end if;

  update attendance_records
  set completed_normal_scheduled_day = p_completed_normal_scheduled_day,
      active_hours_after_midnight = p_active_hours_after_midnight
  where id = v_record_id;

  select cl.* into v_was_credited from comp_day_ledger cl
  where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
    and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
  select r.* into v_existing_request from recovery_credit_requests r
  where r.attendance_record_id = v_record_id and r.status not in ('cancelled', 'rejected');

  if v_was_credited.id is not null or v_existing_request.id is not null then
    credited := false;
    credit_days := 0;
    return next;
    return;
  end if;

  if not p_completed_normal_scheduled_day or p_active_hours_after_midnight <= 0 then
    credited := false;
    credit_days := 0;
    return next;
    return;
  end if;

  v_credit_days := recovery_credit_days_for_hours(p_active_hours_after_midnight);

  insert into recovery_credit_requests (employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by)
  values (p_employee_id, v_record_id, p_work_date, 'overnight', v_credit_days, auth.uid())
  returning id into v_request_id;

  perform create_initial_approval('recovery_credit', v_request_id);

  credited := true;
  credit_days := v_credit_days;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Employee self-service attendance clocking RPCs.
-- ---------------------------------------------------------------------

create or replace function record_attendance_location(p_segment_id uuid, p_event text, p_location jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_permission_status text;
begin
  if p_location is null then
    raise exception 'Location status is required for a Site work / Installation clock event, even when permission was denied or unavailable.';
  end if;
  v_permission_status := p_location ->> 'permission_status';
  if v_permission_status not in ('granted', 'denied', 'unavailable', 'timeout') then
    raise exception 'Invalid location permission_status: %', v_permission_status;
  end if;

  insert into attendance_locations (segment_id, event, latitude, longitude, accuracy_meters, permission_status)
  values (
    p_segment_id,
    p_event,
    case when v_permission_status = 'granted' then (p_location ->> 'latitude')::numeric else null end,
    case when v_permission_status = 'granted' then (p_location ->> 'longitude')::numeric else null end,
    case when v_permission_status = 'granted' then (p_location ->> 'accuracy_meters')::numeric else null end,
    v_permission_status
  );
end;
$$;

create or replace function validate_attendance_segment_inputs(p_work_mode text, p_project_name text, p_project_lead_employee_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_work_mode not in ('office', 'wfh', 'site_work', 'client_meeting', 'business_travel') then
    raise exception 'Invalid work mode: %', p_work_mode;
  end if;
  if p_work_mode = 'site_work' and (p_project_name is null or length(trim(p_project_name)) = 0 or p_project_lead_employee_id is null) then
    raise exception 'Site work / Installation requires a project name and a project lead.';
  end if;
  if p_project_lead_employee_id is not null then
    if not same_company(p_project_lead_employee_id) then
      raise exception 'The project lead must be an employee of your own company.';
    end if;
    if not exists (select 1 from employees where id = p_project_lead_employee_id and employment_status = 'active' and deleted_at is null) then
      raise exception 'The project lead must be a currently active employee.';
    end if;
  end if;
end;
$$;

create or replace function clock_in(
  p_work_mode text,
  p_project_name text default null,
  p_project_lead_employee_id uuid default null,
  p_location jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_session_id uuid;
  v_segment_id uuid;
begin
  v_employee_id := current_employee_id();
  if v_employee_id is null then
    raise exception 'No employee record is linked to your account.';
  end if;
  if not exists (select 1 from employees where id = v_employee_id and employment_status = 'active' and deleted_at is null) then
    raise exception 'Only an active employee may clock in.';
  end if;

  perform validate_attendance_segment_inputs(p_work_mode, p_project_name, p_project_lead_employee_id);

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || v_employee_id::text));

  if exists (select 1 from attendance_sessions where employee_id = v_employee_id and status = 'open') then
    raise exception 'You are already clocked in. Clock out first.';
  end if;

  insert into attendance_sessions (employee_id) values (v_employee_id) returning id into v_session_id;
  insert into attendance_segments (session_id, employee_id, work_mode, project_name, project_lead_employee_id, segment_start)
  values (v_session_id, v_employee_id, p_work_mode, nullif(trim(p_project_name), ''), p_project_lead_employee_id, now())
  returning id into v_segment_id;

  if p_work_mode = 'site_work' then
    perform record_attendance_location(v_segment_id, 'segment_start', p_location);
  end if;

  return v_session_id;
end;
$$;

create or replace function switch_work_segment(
  p_work_mode text,
  p_project_name text default null,
  p_project_lead_employee_id uuid default null,
  p_closing_location jsonb default null,
  p_opening_location jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_session_id uuid;
  v_old_segment_id uuid;
  v_old_work_mode text;
  v_new_segment_id uuid;
begin
  v_employee_id := current_employee_id();
  if v_employee_id is null then
    raise exception 'No employee record is linked to your account.';
  end if;

  perform validate_attendance_segment_inputs(p_work_mode, p_project_name, p_project_lead_employee_id);

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || v_employee_id::text));

  select id into v_session_id from attendance_sessions where employee_id = v_employee_id and status = 'open';
  if v_session_id is null then
    raise exception 'You are not currently clocked in.';
  end if;

  select id, work_mode into v_old_segment_id, v_old_work_mode
  from attendance_segments where session_id = v_session_id and segment_end is null
  for update;
  if v_old_segment_id is null then
    raise exception 'No open work segment found for your current session.';
  end if;

  update attendance_segments set segment_end = now() where id = v_old_segment_id;
  if v_old_work_mode = 'site_work' then
    perform record_attendance_location(v_old_segment_id, 'segment_end', p_closing_location);
  end if;

  insert into attendance_segments (session_id, employee_id, work_mode, project_name, project_lead_employee_id, segment_start)
  values (v_session_id, v_employee_id, p_work_mode, nullif(trim(p_project_name), ''), p_project_lead_employee_id, now())
  returning id into v_new_segment_id;

  if p_work_mode = 'site_work' then
    perform record_attendance_location(v_new_segment_id, 'segment_start', p_opening_location);
  end if;

  return v_new_segment_id;
end;
$$;

create or replace function clock_out(p_location jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_country_code text;
  v_session_id uuid;
  v_segment_id uuid;
  v_work_mode text;
  v_tz text;
  v_work_date date;
begin
  v_employee_id := current_employee_id();
  if v_employee_id is null then
    raise exception 'No employee record is linked to your account.';
  end if;
  select country_code into v_country_code from employees where id = v_employee_id;

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || v_employee_id::text));

  select id into v_session_id from attendance_sessions where employee_id = v_employee_id and status = 'open' for update;
  if v_session_id is null then
    raise exception 'You are not currently clocked in.';
  end if;

  select id, work_mode into v_segment_id, v_work_mode
  from attendance_segments where session_id = v_session_id and segment_end is null
  for update;
  if v_segment_id is null then
    raise exception 'No open work segment found for your current session.';
  end if;

  update attendance_segments set segment_end = now() where id = v_segment_id;
  if v_work_mode = 'site_work' then
    perform record_attendance_location(v_segment_id, 'segment_end', p_location);
  end if;

  update attendance_sessions set status = 'closed', clock_out_at = now() where id = v_session_id;

  v_tz := country_timezone(v_country_code);
  for v_work_date in
    select distinct (segment_start at time zone v_tz)::date from attendance_segments where session_id = v_session_id
  loop
    perform sync_attendance_recovery_for_day(v_employee_id, v_work_date);
  end loop;

  return v_session_id;
end;
$$;

create or replace function hr_close_attendance_session(
  p_session_id uuid,
  p_corrected_clock_out_at timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_company_id uuid;
  v_country_code text;
  v_clock_in_at timestamptz;
  v_segment_id uuid;
  v_segment_start timestamptz;
  v_tz text;
  v_work_date date;
begin
  select employee_id, clock_in_at into v_employee_id, v_clock_in_at
  from attendance_sessions where id = p_session_id and status = 'open'
  for update;
  if v_employee_id is null then
    raise exception 'Open attendance session not found.';
  end if;

  select company_id, country_code into v_company_id, v_country_code from employees where id = v_employee_id;
  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may close a missing clock-out.';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to close a missing clock-out.';
  end if;
  if p_corrected_clock_out_at is null or p_corrected_clock_out_at <= v_clock_in_at then
    raise exception 'The corrected clock-out time must be after the original clock-in time.';
  end if;

  select id, segment_start into v_segment_id, v_segment_start
  from attendance_segments where session_id = p_session_id and segment_end is null
  for update;
  if v_segment_id is null then
    raise exception 'No open work segment found for this session.';
  end if;
  if p_corrected_clock_out_at <= v_segment_start then
    raise exception 'The corrected clock-out time must be after the current work segment''s own start time.';
  end if;

  update attendance_segments set segment_end = p_corrected_clock_out_at where id = v_segment_id;
  update attendance_sessions
  set status = 'closed', clock_out_at = p_corrected_clock_out_at,
      hr_closed_by = auth.uid(), hr_closed_at = now(), hr_closed_reason = p_reason
  where id = p_session_id;

  -- Re-derive Recovery Leave eligibility for every LOCAL date this session's
  -- segments touch, exactly like clock_out()'s own equivalent step — an
  -- HR-closed session is otherwise indistinguishable from a normal one to
  -- sync_attendance_recovery_for_day().
  v_tz := country_timezone(v_country_code);
  for v_work_date in
    select distinct (segment_start at time zone v_tz)::date from attendance_segments where session_id = p_session_id
  loop
    perform sync_attendance_recovery_for_day(v_employee_id, v_work_date);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. guard_comp_day_ledger_single_active_credit(): now also guards the
--    self-clock family's own 'recovery_credit_request' reference_type.
--    Full body required by CREATE OR REPLACE.
-- ---------------------------------------------------------------------

create or replace function guard_comp_day_ledger_single_active_credit()
returns trigger
language plpgsql
as $$
declare
  v_active_count int;
begin
  if new.reference_type in ('attendance_record', 'recovery_credit_request') and new.entry_type = 'earned' then
    select count(*) into v_active_count
    from comp_day_ledger cl
    where cl.reference_type = new.reference_type and cl.reference_id = new.reference_id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
    if v_active_count > 1 then
      raise exception 'An active (unreversed) earned comp-day credit already exists for %', new.reference_id;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. sync_attendance_recovery_for_day() + its routing helper -- the
--    self-clock detection path.
-- ---------------------------------------------------------------------

create or replace function resolve_recovery_credit_route(p_employee_id uuid, p_project_lead_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id from employees where id = p_employee_id;
  if has_role('hr_admin', v_company_id) then
    return 'hr_admin_ceo_cto_queue';
  elsif has_role('line_manager', v_company_id) then
    return 'manager_hr_direct';
  elsif p_project_lead_employee_id is null then
    return null;
  elsif p_project_lead_employee_id = p_employee_id then
    return 'self_led_hr_direct';
  else
    return 'employee_lead_then_hr';
  end if;
end;
$$;

create or replace function sync_attendance_recovery_for_day(p_employee_id uuid, p_work_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country_code text;
  v_tz text;
  v_is_recovery_day boolean;
  v_holiday_name text;
  v_total_hours numeric;
  v_overnight_hours numeric;
  v_has_business_travel boolean;
  v_local_next_midnight timestamptz;
  v_distinct_site_leads int;
  v_anchor_segment_id uuid;
  v_anchor_work_mode text;
  v_anchor_project_name text;
  v_anchor_project_lead_employee_id uuid;
  v_event_type text;
  v_hours numeric;
  v_existing recovery_credit_requests%rowtype;
  v_was_credited comp_day_ledger%rowtype;
  v_credit_days numeric;
  v_request_id uuid;
  v_applicant_route text;
  v_needs_policy_review boolean;
begin
  select country_code into v_country_code from employees where id = p_employee_id and deleted_at is null;
  if v_country_code is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  -- Same advisory lock record_attendance_and_recovery() takes before
  -- touching an employee's comp-day balance, for the same reason: without
  -- it, two concurrent syncs for this employee/day (e.g. two clock-outs
  -- racing, or a clock-out racing a later HR correction) could both read
  -- "not yet requested" before either has committed its insert.
  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  v_tz := country_timezone(v_country_code);
  select r.is_recovery_day, r.holiday_name into v_is_recovery_day, v_holiday_name from is_recovery_eligible_day(v_country_code, p_work_date) r;
  v_local_next_midnight := ((p_work_date + 1)::timestamp) at time zone v_tz;

  select
    coalesce(sum(extract(epoch from (segment_end - segment_start))), 0) / 3600.0,
    coalesce(sum(greatest(extract(epoch from (segment_end - v_local_next_midnight)), 0)), 0) / 3600.0,
    coalesce(bool_or(work_mode = 'business_travel'), false)
  into v_total_hours, v_overnight_hours, v_has_business_travel
  from attendance_segments
  where employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date;

  select count(distinct project_lead_employee_id) into v_distinct_site_leads
  from attendance_segments
  where employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date
    and work_mode = 'site_work';

  v_event_type := case when v_is_recovery_day then 'standard' else 'overnight' end;
  v_hours := case when v_is_recovery_day then v_total_hours else v_overnight_hours end;

  select * into v_existing from recovery_credit_requests
  where employee_id = p_employee_id and work_date = p_work_date and segment_id is not null
    and status not in ('cancelled', 'rejected')
  for update;

  if v_hours is null or v_hours <= 0 then
    -- No longer a qualifying day (segments changed since a prior sync, or
    -- there was never anything here) — reverse an already-approved credit
    -- and cancel any still-active request, exactly the same
    -- never-delete-only-reverse shape record_attendance_and_recovery() uses
    -- for its own "no longer eligible" branch.
    if v_existing.id is not null then
      select cl.* into v_was_credited from comp_day_ledger cl
      where cl.reference_type = 'recovery_credit_request' and cl.reference_id = v_existing.id and cl.entry_type = 'earned'
        and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
      if v_was_credited.id is not null then
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
        values (v_was_credited.employee_id, current_date, 'reversal', -v_was_credited.days, 'holiday_worked', 'recovery_credit_request', v_existing.id, v_was_credited.id, auth.uid());
      end if;
      update recovery_credit_requests set status = 'cancelled', decided_at = now() where id = v_existing.id;
      update approvals
      set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, 'Cancelled: attendance no longer qualifies')
      where entity_type = 'recovery_credit' and entity_id = v_existing.id and decision = 'pending';
    end if;
    return;
  end if;

  if v_existing.id is not null then
    return;
  end if;

  -- Anchor segment for the routing/evidence snapshot: prefer the earliest
  -- site_work segment (its project/lead are always populated, by that
  -- table's own check constraint); otherwise the earliest segment that
  -- captured ANY lead (an Office/WFH segment where one was supplied though
  -- not required); otherwise just the earliest segment of the day.
  -- v_distinct_site_leads > 1 (checked below) flags, never guesses, the
  -- case where today's site_work segments name more than one DISTINCT
  -- lead.
  select id, work_mode, project_name, project_lead_employee_id
  into v_anchor_segment_id, v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id
  from attendance_segments
  where employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date
    and work_mode = 'site_work'
  order by segment_start asc limit 1;

  if v_anchor_segment_id is null then
    select id, work_mode, project_name, project_lead_employee_id
    into v_anchor_segment_id, v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id
    from attendance_segments
    where employee_id = p_employee_id and segment_end is not null
      and (segment_start at time zone v_tz)::date = p_work_date
      and project_lead_employee_id is not null
    order by segment_start asc limit 1;
  end if;

  if v_anchor_segment_id is null then
    select id, work_mode, project_name, project_lead_employee_id
    into v_anchor_segment_id, v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id
    from attendance_segments
    where employee_id = p_employee_id and segment_end is not null
      and (segment_start at time zone v_tz)::date = p_work_date
    order by segment_start asc limit 1;
  end if;

  v_needs_policy_review := v_has_business_travel or v_distinct_site_leads > 1;
  v_credit_days := recovery_credit_days_for_hours(v_hours);
  v_applicant_route := resolve_recovery_credit_route(p_employee_id, v_anchor_project_lead_employee_id);

  insert into recovery_credit_requests (
    employee_id, segment_id, work_date, event_type, proposed_days, created_by,
    work_mode, project_name, project_lead_employee_id, applicant_route, awaiting_project_lead, needs_policy_review
  )
  values (
    p_employee_id, v_anchor_segment_id, p_work_date, v_event_type, v_credit_days, auth.uid(),
    v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id, v_applicant_route,
    v_applicant_route is null, v_needs_policy_review
  )
  returning id into v_request_id;

  if v_applicant_route is not null then
    begin
      perform create_initial_approval('recovery_credit', v_request_id);
    exception when others then
      update recovery_credit_requests set routing_issue = sqlerrm where id = v_request_id;
    end;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. HR's correction + decision RPCs, and the missing-project-lead
--    resolver.
-- ---------------------------------------------------------------------

create or replace function adjust_recovery_credit_request(
  p_request_id uuid,
  p_corrected_work_date date,
  p_corrected_hours numeric,
  p_correction_reason text,
  p_checked_with text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request recovery_credit_requests%rowtype;
  v_company_id uuid;
  v_approval_id uuid;
  v_approval_decision approval_decision;
  v_new_days numeric;
  v_changed boolean;
begin
  -- Locks approvals BEFORE recovery_credit_requests, in that order — the
  -- same order decide_leave_approval() locks them in (its own entity-table
  -- "for update" happens after it has already locked approvals). Taking
  -- them in a consistent order everywhere is what makes a concurrent
  -- adjust-vs-decide race on the same request block and serialize cleanly
  -- instead of ever deadlocking each other.
  select a.id, a.decision into v_approval_id, v_approval_decision
  from approvals a where a.entity_type = 'recovery_credit' and a.entity_id = p_request_id
  order by a.step_order desc limit 1
  for update;
  if v_approval_id is null then
    raise exception 'No approval found for this recovery credit request.';
  end if;
  if v_approval_decision is distinct from 'pending' then
    raise exception 'This request has already been decided and can no longer be adjusted.';
  end if;

  select * into v_request from recovery_credit_requests where id = p_request_id for update;
  if not found then
    raise exception 'Recovery credit request not found.';
  end if;

  select company_id into v_company_id from employees where id = v_request.employee_id;
  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may adjust a recovery credit request.';
  end if;

  if p_corrected_work_date is null or p_corrected_hours is null then
    raise exception 'A work date and hours are both required.';
  end if;
  if p_corrected_hours <= 0 then
    raise exception 'Hours must be greater than zero.';
  end if;

  v_new_days := recovery_credit_days_for_hours(p_corrected_hours);
  v_changed := p_corrected_work_date is distinct from v_request.work_date or v_new_days is distinct from v_request.proposed_days;

  if v_changed and (p_correction_reason is null or length(trim(p_correction_reason)) = 0) then
    raise exception 'A reason is required when correcting the work date or hours.';
  end if;

  update recovery_credit_requests
  set work_date = p_corrected_work_date,
      proposed_days = v_new_days,
      correction_reason = case when v_changed then p_correction_reason else correction_reason end,
      checked_with = coalesce(p_checked_with, checked_with),
      corrected_by = case when v_changed then auth.uid() else corrected_by end,
      corrected_at = case when v_changed then now() else corrected_at end
  where id = p_request_id;

  -- A MATERIAL correction to an 'employee_lead_then_hr' request whose lead
  -- has ALREADY approved (i.e. it has advanced to step 2, HR) requires a
  -- RENEWED lead approval before final credit — resetting step 1 back to
  -- pending is what does that. decide_leave_approval()'s own step-2
  -- authorization check (approvals.queue_roles' own doc comment) already
  -- refuses to let HR decide step 2 again until step 1 is re-approved, so
  -- no separate lock on step 2 is needed here.
  if v_changed and v_request.applicant_route = 'employee_lead_then_hr' then
    update approvals
    set decision = 'pending', decided_at = null,
        comments = coalesce(comments || ' — ', '') || 'Reset for renewed approval after an HR correction: ' || p_correction_reason
    where entity_type = 'recovery_credit' and entity_id = p_request_id and step_order = 1 and decision = 'approved';
  end if;
end;
$$;

create or replace function decide_recovery_credit_request(
  p_request_id uuid,
  p_decision approval_decision,
  p_checked_with text,
  p_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval_id uuid;
  v_applicant_route text;
  v_checked_with_required boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be ''approved'' or ''rejected''';
  end if;

  -- Ordinarily at most one step is ever 'pending' at a time, so asc vs desc
  -- makes no difference. The one exception is exactly the case
  -- adjust_recovery_credit_request()'s "renewed lead approval" comment
  -- describes: a material correction on an already-lead-approved
  -- 'employee_lead_then_hr' request resets step 1 back to 'pending' WITHOUT
  -- touching step 2 (already created, still 'pending' from the earlier
  -- advance) -- both steps are pending at once. asc picks the EARLIEST
  -- pending step, i.e. the one actually blocking progress (the lead's own
  -- renewed decision) -- desc would instead resolve to step 2 every time,
  -- permanently misrouting the lead's own decide_recovery_credit_request()
  -- call into HR's step (which their role can never satisfy) and making
  -- the renewed-approval path unreachable through the real UI, which never
  -- calls this by anything but p_request_id.
  select a.id into v_approval_id
  from approvals a
  where a.entity_type = 'recovery_credit' and a.entity_id = p_request_id and a.decision = 'pending'
  order by a.step_order asc limit 1;
  if v_approval_id is null then
    raise exception 'No pending approval found for this recovery credit request.';
  end if;

  select applicant_route into v_applicant_route from recovery_credit_requests where id = p_request_id;

  -- "Checked with" is mandatory only where HR is the SOLE/DIRECT decision
  -- maker (the legacy queue [applicant_route null], and the self-clock
  -- manager_hr_direct/self_led_hr_direct/hr_admin_ceo_cto_queue routes,
  -- which none of have a lead step at all) — 'employee_lead_then_hr' is
  -- the one exception: its own step 2 (this HR decision) already has the
  -- product brief's underlying concern ("HR must have verified the work
  -- with the relevant project lead outside the application first")
  -- satisfied IN-APP, as a real approval-chain step, so re-asking HR to
  -- also record who they checked with here would just be redundant
  -- box-ticking.
  v_checked_with_required := v_applicant_route is distinct from 'employee_lead_then_hr';
  if p_decision = 'approved' and v_checked_with_required and (p_checked_with is null or length(trim(p_checked_with)) = 0) then
    raise exception 'Record whom you checked this work with before approving.';
  end if;

  if p_checked_with is not null and length(trim(p_checked_with)) > 0 then
    update recovery_credit_requests set checked_with = p_checked_with where id = p_request_id;
  end if;

  perform decide_leave_approval(v_approval_id, p_decision, p_comments);
end;
$$;

create or replace function resolve_recovery_credit_project_lead(p_request_id uuid, p_project_lead_employee_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request recovery_credit_requests%rowtype;
  v_applicant_route text;
begin
  select * into v_request from recovery_credit_requests where id = p_request_id for update;
  if not found then
    raise exception 'Recovery credit request not found.';
  end if;
  if not v_request.awaiting_project_lead then
    raise exception 'This request is not awaiting a project lead.';
  end if;
  if not is_entity_owner('recovery_credit', p_request_id) then
    raise exception 'You do not own this recovery_credit (or it does not exist)';
  end if;

  if p_project_lead_employee_id is null then
    raise exception 'A project lead is required.';
  end if;
  if not same_company(p_project_lead_employee_id) then
    raise exception 'The project lead must be an employee of your own company.';
  end if;
  if not exists (select 1 from employees where id = p_project_lead_employee_id and employment_status = 'active' and deleted_at is null) then
    raise exception 'The project lead must be a currently active employee.';
  end if;

  v_applicant_route := resolve_recovery_credit_route(v_request.employee_id, p_project_lead_employee_id);
  if v_applicant_route is null then
    -- resolve_recovery_credit_route() only ever returns null when NO lead
    -- was given at all — unreachable here since p_project_lead_employee_id
    -- was just required above, kept as a hard stop rather than silently
    -- routing nowhere.
    raise exception 'Could not resolve a routing decision for this project lead.';
  end if;

  update recovery_credit_requests
  set project_lead_employee_id = p_project_lead_employee_id, applicant_route = v_applicant_route, awaiting_project_lead = false
  where id = p_request_id;

  begin
    perform create_initial_approval('recovery_credit', p_request_id);
  exception when others then
    update recovery_credit_requests set routing_issue = sqlerrm where id = p_request_id;
  end;

  return p_request_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. is_entity_owner(): recovery_credit's ownership check now also accepts
--    any HR Admin of the request's own company (needed for
--    resolve_recovery_credit_project_lead() above, which routes a request
--    an EMPLOYEE self-clocked and created). Full body required by CREATE
--    OR REPLACE.
-- ---------------------------------------------------------------------

create or replace function is_entity_owner(p_entity_type approvable_entity, p_entity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  case p_entity_type
    when 'leave_request' then
      return exists (select 1 from leave_requests where id = p_entity_id and employee_id = current_employee_id());
    when 'reimbursement_claim' then
      return exists (select 1 from reimbursement_claims where id = p_entity_id and employee_id = current_employee_id());
    when 'timesheet' then
      return exists (select 1 from timesheets where id = p_entity_id and employee_id = current_employee_id());
    when 'generated_letter' then
      return exists (select 1 from generated_letters where id = p_entity_id and generated_by = auth.uid());
    when 'payroll_export_run' then
      return exists (select 1 from payroll_export_runs where id = p_entity_id and generated_by = auth.uid());
    when 'recovery_credit' then
      -- Manager/HR-initiated on the employee's behalf, or the employee's
      -- OWN self-clock session (see attendance_segments' doc comment) —
      -- either way "owner" means created_by = auth.uid(), same
      -- "owner = initiator" pattern generated_letter/payroll_export_run use
      -- via generated_by. HR Admin is ALSO always a legitimate owner for
      -- their own company's requests: HR may need to route a request an
      -- EMPLOYEE self-clocked and created (e.g. resolve_recovery_credit_
      -- project_lead(), when a candidate was missing a project lead at
      -- clock-in time) — HR already has full visibility and authority over
      -- every recovery_credit_requests row in their company via that
      -- table's own RLS select policy, so this never grants anything HR
      -- couldn't already see or ultimately decide.
      return exists (
        select 1 from recovery_credit_requests r join employees e on e.id = r.employee_id
        where r.id = p_entity_id and (r.created_by = auth.uid() or has_role('hr_admin', e.company_id))
      );
    else
      return false;
  end case;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. create_initial_approval(): gains the new self-clock 4-tier routing
--     branch (bypasses approval_workflows/approval_workflow_steps
--     entirely for a request whose applicant_route is set) alongside the
--     existing 'role_queue:%' branch for every other case, including the
--     legacy recovery_credit family. Full body required by CREATE OR
--     REPLACE.
-- ---------------------------------------------------------------------

create or replace function create_initial_approval(p_entity_type approvable_entity, p_entity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_employee_id uuid;
  v_workflow_id uuid;
  v_approver_type text;
  v_approver_id uuid;
  v_approval_id uuid;
  v_self_check_user_id uuid;
  v_applicant_route text;
  v_project_lead_employee_id uuid;
begin
  -- Every recovery_credit row is now created under a real logged-in user
  -- session — the employee's own session for a self-clock candidate (see
  -- attendance_segments' doc comment), or the acting HR Admin/manager's
  -- session for the legacy manual/overnight paths — so is_entity_owner()'s
  -- created_by = auth.uid() check applies uniformly, with no service-role,
  -- no-session exception needed. (is_entity_owner()'s own recovery_credit
  -- branch ALSO accepts any HR Admin of the request's company — needed for
  -- resolve_recovery_credit_project_lead() below, which routes a self-clock
  -- request an EMPLOYEE created after HR supplies its missing lead.)
  if not is_entity_owner(p_entity_type, p_entity_id) then
    raise exception 'You do not own this % (or it does not exist)', p_entity_type;
  end if;

  -- Idempotent under concurrent double-submission — moved up front so it
  -- covers the new self-clock route-driven branch below the same way as
  -- the legacy workflow-driven path further down (see that path's own doc
  -- comment on reimbursement claims/timesheets/payroll runs).
  select id into v_approval_id from approvals
  where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
  if v_approval_id is not null then
    return v_approval_id;
  end if;

  if p_entity_type = 'leave_request' then
    select e.company_id, r.employee_id into v_company_id, v_employee_id
    from leave_requests r join employees e on e.id = r.employee_id where r.id = p_entity_id;
  elsif p_entity_type = 'reimbursement_claim' then
    select e.company_id, c.employee_id into v_company_id, v_employee_id
    from reimbursement_claims c join employees e on e.id = c.employee_id where c.id = p_entity_id;
  elsif p_entity_type = 'timesheet' then
    select e.company_id, t.employee_id into v_company_id, v_employee_id
    from timesheets t join employees e on e.id = t.employee_id where t.id = p_entity_id;
  elsif p_entity_type = 'generated_letter' then
    select e.company_id, l.employee_id into v_company_id, v_employee_id
    from generated_letters l join employees e on e.id = l.employee_id where l.id = p_entity_id;
  elsif p_entity_type = 'payroll_export_run' then
    select company_id into v_company_id from payroll_export_runs where id = p_entity_id;
  elsif p_entity_type = 'recovery_credit' then
    select e.company_id, r.employee_id, r.applicant_route, r.project_lead_employee_id
    into v_company_id, v_employee_id, v_applicant_route, v_project_lead_employee_id
    from recovery_credit_requests r join employees e on e.id = r.employee_id where r.id = p_entity_id;
  else
    raise exception 'Unsupported entity type: %', p_entity_type;
  end if;

  -- NEW self-clock 4-tier routing (recovery_credit_requests.applicant_route
  -- is set — see that column's own doc comment) — bypasses
  -- approval_workflows/approval_workflow_steps entirely: the four routes
  -- have different total step counts and different step_order meanings,
  -- which doesn't fit the single company-wide workflow the generic engine
  -- below otherwise assumes. The LEGACY attendance_record_id-anchored
  -- recovery_credit family (applicant_route null) falls through to that
  -- same generic engine completely unchanged.
  if p_entity_type = 'recovery_credit' and v_applicant_route is not null then
    select user_id into v_self_check_user_id from employees where id = v_employee_id;

    if v_applicant_route = 'employee_lead_then_hr' then
      select user_id into v_approver_id from employees where id = v_project_lead_employee_id;
      if v_approver_id is null then
        raise exception 'The named project lead has no HR Engine account to approve with. Contact HR Admin.';
      end if;
      -- Defense in depth — resolve_recovery_credit_route() only ever
      -- returns this route when the lead is NOT the applicant themselves,
      -- so this should be unreachable in practice.
      if v_approver_id = v_self_check_user_id then
        raise exception 'The resolved project lead is you — this should have routed to self_led_hr_direct instead. Contact HR Admin.';
      end if;
      begin
        insert into approvals (entity_type, entity_id, step_order, approver_id, decision)
        values (p_entity_type, p_entity_id, 1, v_approver_id, 'pending')
        returning id into v_approval_id;
      exception when unique_violation then
        select id into v_approval_id from approvals where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
      end;
    else
      -- Single-step queue routes: manager_hr_direct/self_led_hr_direct go
      -- to any current hr_admin; hr_admin_ceo_cto_queue goes to either a
      -- ceo or a cto (approvals.queue_roles' own doc comment — the
      -- existing row-lock-plus-pending-check every decision already takes
      -- is what makes "whoever decides first wins" hold here too).
      begin
        insert into approvals (entity_type, entity_id, step_order, queue_roles, decision)
        values (
          p_entity_type, p_entity_id, 1,
          case v_applicant_route when 'hr_admin_ceo_cto_queue' then array['ceo', 'cto']::app_role[] else array['hr_admin']::app_role[] end,
          'pending'
        )
        returning id into v_approval_id;
      exception when unique_violation then
        select id into v_approval_id from approvals where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
      end;
    end if;

    return v_approval_id;
  end if;

  select id into v_workflow_id from approval_workflows
  where company_id = v_company_id and entity_type = p_entity_type and is_active = true
  order by created_at asc
  limit 1;
  if v_workflow_id is null then
    raise exception 'No approval workflow is configured for your company. Contact HR Admin.';
  end if;

  select approver_type into v_approver_type
  from approval_workflow_steps where workflow_id = v_workflow_id and step_order = 1;
  if v_approver_type is null then
    raise exception 'This workflow has no first step configured. Contact HR Admin.';
  end if;

  if v_approver_type like 'role_queue:%' then
    -- Company-scoped role queue (currently only recovery_credit's single
    -- HR step) — no single resolved approver_id; ANY current holder of
    -- this role in the company may later decide it (see
    -- decide_leave_approval()'s own null-approver_id authorization branch).
    -- Still hard-stops here if literally no one currently holds the role,
    -- for the same "never create an unroutable approval" reason every
    -- other branch below does.
    if not exists (
      select 1 from user_roles ur
      where ur.role = replace(v_approver_type, 'role_queue:', '')::app_role
        and ur.revoked_at is null
        and (ur.company_id is null or ur.company_id = v_company_id)
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
    ) then
      raise exception 'No approver could be resolved (no one currently holds the "%" role in your company). Contact Sys Admin.', replace(v_approver_type, 'role_queue:', '');
    end if;
    v_approver_id := null;
  else
    if p_entity_type = 'payroll_export_run' then
      v_approver_id := resolve_approver_for_company(v_approver_type, v_company_id);
    else
      v_approver_id := resolve_approver(v_approver_type, v_employee_id);
    end if;
    if v_approver_id is null then
      raise exception 'No approver could be resolved (e.g. no manager assigned, or no one holds the required role). Contact HR Admin.';
    end if;

    -- Self-approval prevention for step 1 — decide_leave_approval() already
    -- refuses to route any LATER step back to the requester; this is the
    -- same check for the first step, which that function never sees.
    -- Compares against the ENTITY's own beneficiary, not always the
    -- caller: every other entity type is self-submitted (the caller IS the
    -- requester, so auth.uid() is correct), but recovery_credit is
    -- manager/HR-initiated ON BEHALF OF the employee — the direct manager
    -- routinely is both the one recording eligibility AND the resolved
    -- step-1 approver for their own report, which is never "self-approval"
    -- (they aren't approving their OWN leave). Only block if the resolved
    -- approver equals the beneficiary. A role_queue step has no single
    -- resolved approver to compare here at all — its own self-decision
    -- block instead happens at decision time, in decide_leave_approval().
    if p_entity_type = 'recovery_credit' then
      select user_id into v_self_check_user_id from employees where id = v_employee_id;
    else
      v_self_check_user_id := auth.uid();
    end if;
    if v_approver_id = v_self_check_user_id then
      raise exception 'The resolved approver for this workflow''s first step (%) is you — you can''t approve your own request. Contact HR Admin to assign a different approver.', v_approver_type;
    end if;
  end if;

  -- Idempotent under concurrent double-submission: reimbursement claims,
  -- timesheets, and payroll runs submit against an EXISTING row (an
  -- UPDATE then this call), so two racing calls can both pass every check
  -- above before either has inserted. Returning the existing step-1
  -- approval instead of raising or duplicating means the "loser" of the
  -- race gets back the same approval the "winner" created, rather than
  -- its caller (e.g. submitPayrollRun()) treating this as a routing
  -- failure and reverting the entity's status out from under a real,
  -- already-pending approval. The unique index above is the backstop for
  -- the rare case where both SELECTs below race past each other too.
  select id into v_approval_id from approvals
  where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
  if v_approval_id is not null then
    return v_approval_id;
  end if;

  begin
    insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision)
    values (p_entity_type, p_entity_id, v_workflow_id, 1, v_approver_id, 'pending')
    returning id into v_approval_id;
  exception when unique_violation then
    select id into v_approval_id from approvals
    where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
  end;

  return v_approval_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. decide_leave_approval(): gains a queue_roles authorization branch
--     and the self-clock step-advancement logic (the 'employee_lead_then_hr'
--     route's own step 1 -> step 2 advance), alongside the existing
--     null-approver_id "role queue" branch and generic workflow walk for
--     every other case. Full body required by CREATE OR REPLACE.
-- ---------------------------------------------------------------------

create or replace function decide_leave_approval(p_approval_id uuid, p_decision approval_decision, p_comments text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval approvals%rowtype;
  v_employee_id uuid;
  v_requester_user_id uuid;
  v_amount numeric(12,2);
  v_leave_request leave_requests%rowtype;
  v_remaining numeric(6,2);
  v_rule record;
  v_available numeric(6,2);
  v_draw numeric(6,2);
  v_had_configured_rule boolean;
  v_timesheet timesheets%rowtype;
  v_payroll_company_id uuid;
  v_recovery_request recovery_credit_requests%rowtype;
  v_comp_day_ledger_id uuid;
  v_step record;
  v_next_approver uuid;
  v_found_next boolean := false;
  v_queue_role text;
  v_queue_company_id uuid;
  v_queue_beneficiary_user_id uuid;
  v_dup_ref_type text;
  v_dup_ref_id uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be ''approved'' or ''rejected''';
  end if;

  select * into v_approval from approvals where id = p_approval_id for update;
  if not found then
    raise exception 'Approval not found';
  end if;

  if v_approval.approver_id is not null then
    if auth.uid() is not null and v_approval.approver_id <> auth.uid() then
      raise exception 'Only the assigned approver may decide this';
    end if;
  elsif v_approval.queue_roles is not null then
    -- NEW self-clock queue step (approvals.queue_roles' own doc comment) —
    -- ANY user currently holding ONE of these role(s) IN THE APPROVAL'S OWN
    -- COMPANY may decide it (more than one role only for the shared
    -- CEO/CTO queue). Company/beneficiary resolved the same way the LEGACY
    -- role_queue branch below does.
    if v_approval.entity_type = 'recovery_credit' then
      select e.company_id, e.user_id into v_queue_company_id, v_queue_beneficiary_user_id
      from recovery_credit_requests r join employees e on e.id = r.employee_id
      where r.id = v_approval.entity_id;
    else
      raise exception 'queue_roles approval steps are only supported for recovery_credit.';
    end if;

    if auth.uid() is null or not exists (select 1 from unnest(v_approval.queue_roles) qr where has_role(qr, v_queue_company_id)) then
      raise exception 'Only an active % may decide this.', array_to_string(v_approval.queue_roles, ' or ');
    end if;
    if auth.uid() = v_queue_beneficiary_user_id then
      raise exception 'You cannot decide a recovery credit request for your own attendance. Ask another eligible approver to decide it.';
    end if;

    -- The 'employee_lead_then_hr' route's step 2 (this HR queue step) may
    -- only be decided once step 1 (the project lead's own decision) is
    -- ITSELF 'approved' — required so a MATERIAL correction that resets
    -- step 1 back to pending (see adjust_recovery_credit_request()'s own
    -- "renewed lead approval" doc comment) can never be bypassed by HR
    -- deciding step 2 while step 1 sits un-re-approved. A no-op for every
    -- single-step route (step_order is always 1 there).
    if v_approval.step_order > 1 and not exists (
      select 1 from approvals a2
      where a2.entity_type = v_approval.entity_type and a2.entity_id = v_approval.entity_id
        and a2.step_order = v_approval.step_order - 1 and a2.decision = 'approved'
    ) then
      raise exception 'Awaiting a renewed project lead approval after a correction before this may be decided.';
    end if;
  else
    -- LEGACY role_queue:% mechanism via approval_workflow_steps (currently
    -- only the manual/overnight recovery_credit family's single HR step —
    -- see that column's own doc comment): there's no single assigned
    -- approver_id to compare against auth.uid(); instead ANY user currently
    -- holding the step's named role IN THE APPROVAL'S OWN COMPANY may
    -- decide it. Resolved here, before entity dispatch below (which only
    -- runs after the decision is already recorded), since this needs the
    -- company + beneficiary user up front. Unchanged by the new
    -- queue_roles mechanism above — never reached for a self-clock-routed
    -- recovery_credit row, since those always carry queue_roles instead.
    select approver_type into v_queue_role
    from approval_workflow_steps where workflow_id = v_approval.workflow_id and step_order = v_approval.step_order;
    if v_queue_role is null or v_queue_role not like 'role_queue:%' then
      raise exception 'This approval has no assigned approver and is not a recognized role-queue step.';
    end if;

    if v_approval.entity_type = 'recovery_credit' then
      select e.company_id, e.user_id into v_queue_company_id, v_queue_beneficiary_user_id
      from recovery_credit_requests r join employees e on e.id = r.employee_id
      where r.id = v_approval.entity_id;
    else
      raise exception 'Role-queue approval steps are only supported for recovery_credit.';
    end if;

    if auth.uid() is null or not has_role(replace(v_queue_role, 'role_queue:', '')::app_role, v_queue_company_id) then
      raise exception 'Only an active % may decide this.', replace(v_queue_role, 'role_queue:', '');
    end if;
    -- The project lead HR checked the work with is never an application
    -- approver (no role, no seat in this table) — the only self-decision
    -- risk here is the BENEFICIARY employee themselves also happening to
    -- hold hr_admin and trying to decide their own request.
    if auth.uid() = v_queue_beneficiary_user_id then
      raise exception 'You cannot decide a recovery credit request for your own attendance. Ask another HR Admin to decide it.';
    end if;
  end if;

  if v_approval.decision <> 'pending' then
    raise exception 'This approval has already been decided';
  end if;

  update approvals set decision = p_decision, decided_at = now(), comments = p_comments where id = p_approval_id;

  if v_approval.entity_type = 'leave_request' then
    select * into v_leave_request from leave_requests where id = v_approval.entity_id for update;
    v_employee_id := v_leave_request.employee_id;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'reimbursement_claim' then
    select employee_id, total_amount into v_employee_id, v_amount
    from reimbursement_claims where id = v_approval.entity_id for update;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'timesheet' then
    select * into v_timesheet from timesheets where id = v_approval.entity_id for update;
    v_employee_id := v_timesheet.employee_id;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'generated_letter' then
    select employee_id into v_employee_id from generated_letters where id = v_approval.entity_id for update;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'payroll_export_run' then
    select company_id, generated_by into v_payroll_company_id, v_requester_user_id
    from payroll_export_runs where id = v_approval.entity_id for update;
  elsif v_approval.entity_type = 'recovery_credit' then
    select * into v_recovery_request from recovery_credit_requests where id = v_approval.entity_id for update;
    v_employee_id := v_recovery_request.employee_id;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  else
    return; -- reserved for future entity types; nothing further to do here
  end if;

  if p_decision = 'rejected' then
    if v_approval.entity_type = 'leave_request' then
      update leave_requests set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'reimbursement_claim' then
      update reimbursement_claims set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'timesheet' then
      update timesheets set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'generated_letter' then
      update generated_letters set status = 'void' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'payroll_export_run' then
      update payroll_export_runs set status = 'rejected' where id = v_approval.entity_id;
      -- Release this run's claim on its source rows (approved reimbursements,
      -- leave-encashment ledger entries) so a rejected run doesn't
      -- permanently block them from ever being paid — otherwise
      -- generate_payroll_export_lines()'s "not exists" check (keyed only on
      -- source_reference_type/id, with no regard for the referencing run's
      -- status) would treat them as already exported, forever.
      delete from payroll_export_lines where run_id = v_approval.entity_id;
    elsif v_approval.entity_type = 'recovery_credit' then
      update recovery_credit_requests set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    end if;
    return; -- rejection stops the chain; earlier decisions in the log are untouched
  end if;

  if v_approval.entity_type = 'recovery_credit' and v_recovery_request.applicant_route is not null then
    -- NEW self-clock 4-tier routing — bypasses the generic
    -- approval_workflow_steps walk below entirely (see
    -- recovery_credit_requests.applicant_route's own doc comment: the four
    -- routes have different total step counts, which that generic walk
    -- doesn't fit). Only the 'employee_lead_then_hr' route ever advances
    -- (its own step 1, the lead's decision, to step 2, the HR queue); every
    -- other route — and this route's own step 2 — IS the final step, so it
    -- falls straight through to the shared finalize block below exactly
    -- like v_found_next = false does for every other entity type.
    if v_recovery_request.applicant_route = 'employee_lead_then_hr' and v_approval.step_order = 1 then
      if not exists (select 1 from approvals where entity_type = 'recovery_credit' and entity_id = v_approval.entity_id and step_order = 2) then
        insert into approvals (entity_type, entity_id, step_order, queue_roles, decision)
        values ('recovery_credit', v_approval.entity_id, 2, array['hr_admin']::app_role[], 'pending');
      end if;
      -- The lead's "provisional release" — nothing is credited yet.
      update recovery_credit_requests set status = 'pending_approval' where id = v_approval.entity_id;
      return;
    end if;
  else
    -- Walk every remaining step in order (not just the next one) — a step
    -- whose condition doesn't apply (amount below its threshold) is skipped,
    -- and a step that resolves to the requester themselves is skipped too
    -- (self-approval prevention). A step that resolves to NO ONE AT ALL (the
    -- role has zero holders in this company) is different: that's not "skip
    -- and keep going", it's "this cannot legitimately proceed" — abort the
    -- whole decision rather than silently finalizing as if this step had
    -- been satisfied.
    for v_step in
      select step_order, approver_type, condition
      from approval_workflow_steps
      where workflow_id = v_approval.workflow_id and step_order > v_approval.step_order
      order by step_order asc
    loop
      if v_step.condition is not null and v_step.condition ? 'amount_gt' then
        if v_amount is null or v_amount <= (v_step.condition ->> 'amount_gt')::numeric then
          continue; -- this step's threshold doesn't apply to this entity
        end if;
      end if;

      if v_approval.entity_type = 'payroll_export_run' then
        v_next_approver := resolve_approver_for_company(v_step.approver_type, v_payroll_company_id);
      else
        v_next_approver := resolve_approver(v_step.approver_type, v_employee_id);
      end if;

      if v_next_approver is null then
        raise exception 'Cannot advance this approval: no one currently holds the "%" role required for the next step. Ask HR Admin to assign that role, then try again.', v_step.approver_type;
      end if;

      if v_next_approver <> v_requester_user_id then
        insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id)
        values (v_approval.entity_type, v_approval.entity_id, v_approval.workflow_id, v_step.step_order, v_next_approver);
        v_found_next := true;
        exit;
      end if;
      -- self-approval: keep walking forward to find a different eligible approver
    end loop;

    if v_found_next then
      if v_approval.entity_type = 'leave_request' then
        update leave_requests set status = 'pending_approval' where id = v_approval.entity_id;
      elsif v_approval.entity_type = 'reimbursement_claim' then
        update reimbursement_claims set status = 'pending_approval' where id = v_approval.entity_id;
      elsif v_approval.entity_type = 'timesheet' then
        update timesheets set status = 'pending_approval' where id = v_approval.entity_id;
      elsif v_approval.entity_type = 'payroll_export_run' then
        update payroll_export_runs set status = 'pending_approval' where id = v_approval.entity_id;
      elsif v_approval.entity_type = 'recovery_credit' then
        -- The manager's "provisional release" — nothing is credited yet.
        update recovery_credit_requests set status = 'pending_approval' where id = v_approval.entity_id;
      end if;
      -- generated_letter has only ever had one step (role:ceo) so it never reaches here
      return;
    end if;
  end if;

  -- Final approval — entity-specific finalization.
  if v_approval.entity_type = 'leave_request' then
    v_remaining := v_leave_request.total_days;

    -- The row-level "for update" locks above only cover this one
    -- leave_request/approval pair -- they don't stop a SECOND, independent
    -- leave request for the SAME employee from being finalized concurrently
    -- (two approvers, or one approver clicking through two pending items
    -- quickly). Both would otherwise read the same comp_day_ledger SUM
    -- before either commits its deduction, letting both draw from what
    -- looks like an independent full balance and overdraw it. An advisory
    -- lock keyed on the employee serializes comp-day balance reads+writes
    -- across concurrent decisions for that employee; it's released
    -- automatically at transaction end.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_leave_request.employee_id::text));

    v_had_configured_rule := false;
    for v_rule in
      select dpr.source_ledger
      from deduction_priority_rules dpr
      join employees e on e.id = v_leave_request.employee_id
      where dpr.leave_type_code = v_leave_request.leave_type_code
        and (dpr.company_id = e.company_id or (dpr.company_id is null and dpr.country_code = e.country_code))
        and dpr.effective_from <= v_leave_request.start_date
      order by dpr.priority_order asc
    loop
      v_had_configured_rule := true;
      exit when v_remaining <= 0;

      if v_rule.source_ledger = 'comp_day' then
        -- coalesce(sum(days), 0) already nets out every prior redemption,
        -- reversal AND expiry entry for this employee — the comp-day-expiry
        -- cron posts a negative 'expired' row whenever an earned entry's
        -- remaining balance lapses, so this sum is already the correct
        -- CURRENTLY-AVAILABLE (unexpired) balance, not a raw lifetime total.
        select coalesce(sum(days), 0) into v_available from comp_day_ledger where employee_id = v_leave_request.employee_id;
        if v_available > 0 then
          v_draw := least(v_remaining, v_available);
          -- A single aggregate 'redeemed' entry, not linked to one specific
          -- earned row — oldest-expiring-first is a property of how the
          -- expiry cron's pooling algorithm (computeCompDayExpiry) reads
          -- the ledger afterward (it always consumes the earliest-expiring
          -- surviving balance first), not of which earned row a redemption
          -- names, so this draw participates correctly in FIFO consumption
          -- without needing per-request linkage.
          insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, reference_id, created_by)
          values (v_leave_request.employee_id, v_leave_request.start_date, 'redeemed', -v_draw, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
          v_remaining := v_remaining - v_draw;
        end if;
      elsif v_rule.source_ledger = 'leave_ledger' then
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
        values (v_leave_request.employee_id, v_leave_request.leave_type_code, v_leave_request.start_date, 'deduction', -v_remaining, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
        v_remaining := 0;
      end if;
    end loop;

    if v_remaining > 0 then
      if v_had_configured_rule then
        -- At least one deduction_priority_rules row WAS configured for this
        -- leave type (e.g. Recovery Leave's comp_day-only rule) and it
        -- could not cover the full request — refuse outright rather than
        -- falling through to an unconfigured leave_ledger balance that has
        -- no real accrual behind it at all. This whole function call rolls
        -- back on this exception (including the partial comp_day
        -- 'redeemed' entry just above and the approvals row updated
        -- earlier), so nothing is left half-applied.
        raise exception 'Insufficient balance to approve this %: % day(s) requested, only % day(s) available from the configured funding source(s) for this leave type.',
          v_leave_request.leave_type_code, v_leave_request.total_days, (v_leave_request.total_days - v_remaining);
      else
        -- No deduction_priority_rules row has ever been configured for
        -- this leave type at all (true of every leave type this system
        -- shipped with before Recovery Leave, e.g. annual/sick) — same
        -- unconditional leave_ledger fallback as always, unchanged.
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
        values (v_leave_request.employee_id, v_leave_request.leave_type_code, v_leave_request.start_date, 'deduction', -v_remaining, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
      end if;
    end if;

    update leave_requests set status = 'approved', decided_at = now() where id = v_leave_request.id;

  elsif v_approval.entity_type = 'reimbursement_claim' then
    -- No ledger write here — approved claims are picked up by the payroll
    -- export job. Finalizing just unblocks that downstream step.
    update reimbursement_claims set status = 'approved', decided_at = now() where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'timesheet' then
    -- Deliberately no ledger write — timesheets are deprecated. Comp-days
    -- for weekend/holiday work come from Attendance instead (see
    -- bulkRecordAttendance in apps/web/src/lib/actions/attendance.ts).
    update timesheets set status = 'approved', decided_at = now() where id = v_timesheet.id;

  elsif v_approval.entity_type = 'generated_letter' then
    update generated_letters set status = 'issued' where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'payroll_export_run' then
    -- The C-level exec's decision (ceo or cto — the final, always-present
    -- step) stamps authorized_by/at — the one place this column is ever
    -- set, since there's no direct UPDATE policy on those columns for
    -- anyone.
    update payroll_export_runs
    set status = 'approved', authorized_by = coalesce(auth.uid(), v_requester_user_id), authorized_at = now()
    where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'recovery_credit' then
    -- HR Admin's (or, for the self-clock 4-tier routes, whichever queue/
    -- lead step is actually final for this request's applicant_route —
    -- see the step-advancement block above) final approval — the ONLY
    -- point anywhere in this system that posts the actual earned
    -- comp_day_ledger row for a recovery credit. Defensively re-checks for
    -- an existing active credit first (decide_leave_approval() already
    -- refuses to re-decide a non-'pending' approval, so this can only run
    -- once per approvals row in practice — this is a second, independent
    -- backstop, the same "already credited?" check
    -- record_attendance_and_recovery()/sync_attendance_recovery_for_day()
    -- use). The reference is the LEGACY attendance_record for that family,
    -- or the request itself for the self-clock family (segment_id set,
    -- attendance_record_id null) — see recovery_credit_requests' own doc
    -- comment for why there's no single evidence row to point at there (a
    -- day's total can span more than one segment).
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_recovery_request.employee_id::text));

    if v_recovery_request.attendance_record_id is not null then
      v_dup_ref_type := 'attendance_record';
      v_dup_ref_id := v_recovery_request.attendance_record_id;
    else
      v_dup_ref_type := 'recovery_credit_request';
      v_dup_ref_id := v_recovery_request.id;
    end if;

    if not exists (
      select 1 from comp_day_ledger cl
      where cl.reference_type = v_dup_ref_type and cl.reference_id = v_dup_ref_id and cl.entry_type = 'earned'
        and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id)
    ) then
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
      values (
        v_recovery_request.employee_id,
        v_recovery_request.work_date,
        'earned',
        v_recovery_request.proposed_days,
        case v_recovery_request.event_type when 'overnight' then 'overnight_extension' else 'holiday_worked' end,
        v_recovery_request.work_date + interval '180 days',
        v_dup_ref_type,
        v_dup_ref_id,
        coalesce(auth.uid(), v_requester_user_id)
      )
      returning id into v_comp_day_ledger_id;

      update recovery_credit_requests
      set status = 'approved', decided_at = now(), comp_day_ledger_id = v_comp_day_ledger_id
      where id = v_recovery_request.id;
    else
      update recovery_credit_requests set status = 'approved', decided_at = now() where id = v_recovery_request.id;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 12. seed_default_approval_workflows(): recovery_credit's block now seeds
--     ONE 'role_queue:hr_admin' step instead of direct_manager ->
--     role:hr_admin. Only affects NEW companies created after this
--     migration -- see this file's own header. Full body required by
--     CREATE OR REPLACE.
-- ---------------------------------------------------------------------

create or replace function seed_default_approval_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity approvable_entity;
  v_workflow_id uuid;
begin
  foreach v_entity in array array['leave_request', 'reimbursement_claim', 'timesheet', 'generated_letter']::approvable_entity[]
  loop
    insert into approval_workflows (company_id, entity_type, name)
    values (new.id, v_entity, 'Default ' || replace(v_entity::text, '_', ' ') || ' approval')
    returning id into v_workflow_id;

    insert into approval_workflow_steps (workflow_id, step_order, approver_type)
    values (v_workflow_id, 1, case when v_entity = 'generated_letter' then 'role:ceo' else 'direct_manager' end);
  end loop;

  insert into approval_workflows (company_id, entity_type, name)
  values (new.id, 'payroll_export_run', 'Payroll export authorization (Finance, then CEO — mandatory, every time)')
  returning id into v_workflow_id;

  insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
    (v_workflow_id, 1, 'role:finance'),
    (v_workflow_id, 2, 'role:ceo');

  -- Recovery Leave earning: ONE HR decision — a company-scoped role queue
  -- (any current HR Admin in the company may decide it; see
  -- approval_workflow_steps.approver_type's 'role_queue:hr_admin' doc
  -- comment and decide_leave_approval()'s null-approver_id branch), not a
  -- manager-then-HR chain and not a single specific assigned person. A
  -- potential credit (from the manual attendance register or, for the
  -- employee self-clock path, the applicant's own routed approval chain —
  -- see recovery_credit_requests.applicant_route) goes to this queue for
  -- the routes that terminate at HR; HR checks the work with the relevant
  -- project lead outside the application before deciding — its own insert,
  -- outside the loop above, since every other entity type there has
  -- exactly one step too, but resolves it very differently.
  insert into approval_workflows (company_id, entity_type, name)
  values (new.id, 'recovery_credit', 'Recovery Leave earning approval (HR)')
  returning id into v_workflow_id;

  insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
    (v_workflow_id, 1, 'role_queue:hr_admin');

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. RLS: approvals_select gains the queue_roles branch;
--     recovery_credit_requests_select gains the project-lead-evidence
--     branch; the three new tables get their own select policies (see
--     each policy's own doc comment in schema.sql).
-- ---------------------------------------------------------------------

drop policy if exists approvals_select on approvals;
create policy approvals_select on approvals for select
  using (
    approver_id = auth.uid()
    or has_role('hr_admin')
    or is_entity_owner(entity_type, entity_id)
    or (
      entity_type = 'recovery_credit'
      and exists (select 1 from recovery_credit_requests r where r.id = entity_id and r.employee_id = current_employee_id())
    )
    or (
      -- A queue step's approver_id is null by design — either the LEGACY
      -- role_queue:% mechanism (approval_workflow_steps.approver_type's own
      -- doc comment) or the NEW self-clock queue_roles column on this same
      -- row (approvals.queue_roles' own doc comment: hr_admin for the
      -- manager/self-led routes and this route's own final HR step, ceo+cto
      -- for the shared executive queue). None of the branches above would
      -- ever match for a company-scoped HR Admin/CEO/CTO (the realistic
      -- case; has_role('hr_admin') with no company argument only matches a
      -- GLOBAL, unscoped grant), so without this branch a queued Recovery
      -- Leave approval would be invisible to whoever is actually meant to
      -- decide it.
      entity_type = 'recovery_credit'
      and approver_id is null
      and exists (
        select 1 from recovery_credit_requests r join employees e on e.id = r.employee_id
        where r.id = entity_id
          and (
            has_role('hr_admin', e.company_id)
            or (queue_roles is not null and exists (select 1 from unnest(queue_roles) qr where has_role(qr, e.company_id)))
          )
      )
    )
  );

drop policy if exists recovery_credit_requests_select on recovery_credit_requests;
create policy recovery_credit_requests_select on recovery_credit_requests for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or project_lead_employee_id = current_employee_id()
  );

create policy attendance_sessions_select on attendance_sessions for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy attendance_segments_select on attendance_segments for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or project_lead_employee_id = current_employee_id()
  );

create policy attendance_locations_select on attendance_locations for select
  using (exists (
    select 1 from attendance_segments s
    where s.id = segment_id
      and (
        s.employee_id = current_employee_id()
        or is_manager_of(s.employee_id)
        or has_role('hr_admin', (select company_id from employees where id = s.employee_id))
        or s.project_lead_employee_id = current_employee_id()
      )
  ));

-- ---------------------------------------------------------------------
-- 14. Audit trigger for the one attendance-clocking write path that
--     asserts rather than observes a timestamp (hr_close_attendance_session()).
-- ---------------------------------------------------------------------

create trigger audit_attendance_sessions after insert or update on attendance_sessions
  for each row execute function write_audit_log();
