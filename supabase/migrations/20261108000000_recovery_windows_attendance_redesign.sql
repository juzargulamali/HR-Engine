-- ---------------------------------------------------------------------
-- Recovery Leave redesign: working periods and 24-elapsed-hour windows, an
-- automatic read-first attendance register, HR alerts and a protected
-- background processor.
--
-- ADDITIVE and DORMANT. Applying this file changes NOTHING about how any
-- existing or new clock-in is calculated: every session is stamped 'legacy'
-- (the original same-day / 4-hour rule) until a Recovery Leave policy with
-- model = 'recovery_windows' is explicitly activated for the employee's
-- country through activate_recovery_windows_policy(). No data is rewritten,
-- no policy is created or activated, no scheduler is enabled.
--
-- What it adds:
--   * tables: recovery_periods, recovery_windows, recovery_window_allocations,
--     recovery_window_revisions, recovery_alerts, attendance_session_corrections,
--     recovery_processor_runs, recovery_processor_failures (all RLS-protected,
--     read-only for people, written only by SECURITY DEFINER functions);
--   * new columns on attendance_sessions, recovery_credit_requests, audit_log,
--     policy_versions (all nullable/defaulted, nothing existing changes meaning);
--   * the calculation engine, request routing under system authority, ledger
--     posting for window credits, HR actions, the processor, read models;
--   * triggers so every evidence-changing path runs the same engine;
--   * replacement bodies for six existing functions (decide_leave_approval,
--     is_entity_owner, adjust_recovery_credit_request,
--     record_attendance_and_recovery, sync_attendance_recovery_for_day,
--     write_audit_log) — each change is additive and inert for legacy rows.
--
-- Run it once, as a single script, in the Supabase SQL Editor (it is written to
-- be re-runnable: tables/columns use IF NOT EXISTS, functions CREATE OR REPLACE).
-- Everything is in one transaction below, so a failure leaves nothing behind.
-- ---------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------
-- 1. Additive schema. Nothing below changes how an existing row behaves:
--    every pre-existing session is stamped 'legacy' and stays on the
--    original same-calendar-day / 4-hour calculation forever. The new
--    window model only ever applies to sessions that START after a
--    'recovery_windows' policy has been explicitly activated for the
--    employee's country (see recovery_session_assign_model()).
-- ---------------------------------------------------------------------

-- Which calculation a session belongs to, fixed at clock-in and never
-- changed afterwards (so activating or deactivating a policy never
-- recalculates history, and a session in flight at activation finishes
-- under the rules it started with).
alter table attendance_sessions add column if not exists recovery_model text not null default 'legacy'
  check (recovery_model in ('legacy', 'windowed'));
-- "Add missing attendance" (HR recording a past shift an employee never
-- clocked): flagged as recorded by HR, never presented as a live clock state.
alter table attendance_sessions add column if not exists recorded_by_hr boolean not null default false;
alter table attendance_sessions add column if not exists recorded_by_hr_by uuid references auth.users(id);
alter table attendance_sessions add column if not exists recorded_by_hr_at timestamptz;
alter table attendance_sessions add column if not exists recorded_by_hr_reason text;

comment on column attendance_sessions.recovery_model is
  'legacy = original same-day/4-hour Recovery Leave calculation (every row that existed before the windows redesign); windowed = working-period/24-elapsed-hour-window calculation, assigned at insert by recovery_session_assign_model() from the active recovery_windows policy and never changed afterwards.';

-- Audit rows written by background work must say so instead of looking like
-- a person acted. write_audit_log() fills this in (see below).
alter table audit_log add column if not exists origin text;
comment on column audit_log.origin is
  'Where the change really came from: user (a signed-in person), system (no signed-in user, e.g. a migration or the SQL editor) or processor (the Recovery Leave background processor). Never impersonates an HR user.';

alter table policy_versions add column if not exists activation_record jsonb;
comment on column policy_versions.activation_record is
  'Set only by activate_recovery_windows_policy(): who activated a recovery_windows policy, when, the controlled effective date, and which earlier version it superseded.';

-- One working period: sessions joined by clocked-out gaps shorter than the
-- rest threshold. The policy version and the full rules are SNAPSHOTTED here
-- when the period is first recognised, so later policy changes never move an
-- in-flight period.
create table if not exists recovery_periods (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id),
  company_id          uuid not null references companies(id),
  country_code        text not null references countries(code),
  timezone            text not null,
  policy_version_id   uuid not null references policy_versions(id),
  rules               jsonb not null,
  started_at          timestamptz not null,
  last_work_end_at    timestamptz not null,
  has_open_session    boolean not null,
  rest_completes_at   timestamptz,
  status              text not null check (status in ('open', 'ended', 'superseded')),
  ended_at            timestamptz,
  recorded_seconds    numeric(16, 6) not null default 0,
  elapsed_seconds     numeric(16, 6) not null default 0,
  superseded_at       timestamptz,
  superseded_reason   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists recovery_periods_one_per_start
  on recovery_periods(employee_id, started_at) where status <> 'superseded';
create index if not exists idx_recovery_periods_company_status on recovery_periods(company_id, status);
create index if not exists idx_recovery_periods_employee on recovery_periods(employee_id, started_at desc);

-- One recovery window: at most 24 REAL elapsed hours from the period's first
-- clock-in (then from each previous boundary). The unit entitlement is
-- decided on, capped at 1 day per window.
create table if not exists recovery_windows (
  id                      uuid primary key default gen_random_uuid(),
  period_id               uuid not null references recovery_periods(id),
  employee_id             uuid not null references employees(id),
  company_id              uuid not null references companies(id),
  window_index            int not null check (window_index >= 1),
  window_start            timestamptz not null,
  window_end              timestamptz not null,
  recorded_seconds        numeric(16, 6) not null default 0 check (recorded_seconds >= 0),
  status                  text not null default 'open' check (status in ('open', 'closed')),
  closed_at               timestamptz,
  closed_reason           text check (closed_reason in ('elapsed_window', 'rest')),
  -- Classified ONCE, by the employee's own local date at the window START.
  starting_local_date     date not null,
  country_code            text not null,
  timezone                text not null,
  classification          text not null check (classification in ('normal_day', 'rest_day', 'public_holiday')),
  holiday_name            text,
  policy_version_id       uuid not null references policy_versions(id),
  entitlement_days        numeric(2, 1) not null default 0 check (entitlement_days in (0, 0.5, 1)),
  band                    text not null default 'none' check (band in ('none', 'half', 'full')),
  review_flags            text[] not null default '{}',
  hr_verification_required boolean not null default false,
  hr_verified_by          uuid references auth.users(id),
  hr_verified_at          timestamptz,
  hr_verification_note    text,
  revision_no             int not null default 0,
  allocation_signature    text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (period_id, window_index),
  check (window_end > window_start),
  check (status = 'open' or closed_at is not null)
);
create index if not exists idx_recovery_windows_employee on recovery_windows(employee_id, window_start desc);
create index if not exists idx_recovery_windows_company_status on recovery_windows(company_id, status);

-- Which raw evidence (segment) contributed which seconds to which window.
-- Derived data: rebuilt by the engine, never edited by hand. The segments and
-- sessions it points at are never altered or deleted by any calculation.
create table if not exists recovery_window_allocations (
  id                        uuid primary key default gen_random_uuid(),
  window_id                 uuid not null references recovery_windows(id) on delete cascade,
  employee_id               uuid not null references employees(id),
  session_id                uuid not null references attendance_sessions(id),
  segment_id                uuid not null references attendance_segments(id),
  work_mode                 text not null,
  project_name              text,
  project_lead_employee_id  uuid references employees(id),
  alloc_start               timestamptz not null,
  alloc_end                 timestamptz not null,
  seconds                   numeric(16, 6) not null check (seconds > 0),
  unique (window_id, segment_id, alloc_start)
);
create index if not exists idx_recovery_window_allocations_window on recovery_window_allocations(window_id);
create index if not exists idx_recovery_window_allocations_segment on recovery_window_allocations(segment_id);

-- A window's CALCULATED facts after it closed, one row per change. A change in
-- recorded hours is a change even when the day amount is identical.
create table if not exists recovery_window_revisions (
  id                  uuid primary key default gen_random_uuid(),
  window_id           uuid not null references recovery_windows(id),
  revision_no         int not null,
  recorded_seconds    numeric(16, 6) not null,
  entitlement_days    numeric(2, 1) not null,
  classification      text not null,
  starting_local_date date not null,
  review_flags        text[] not null default '{}',
  reason              text not null,
  actor_id            uuid,
  origin              text not null,
  previous_facts      jsonb,
  created_at          timestamptz not null default now(),
  unique (window_id, revision_no)
);

-- HR alerts: accumulated recorded work reaching the alert threshold with no
-- completed rest, and the automatic 24-elapsed-hour rollover. Warnings only —
-- they never stop recording and never create a recovery day by themselves.
create table if not exists recovery_alerts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  employee_id      uuid not null references employees(id),
  period_id        uuid not null references recovery_periods(id),
  alert_type       text not null check (alert_type in ('long_work', 'window_rollover')),
  dedup_key        text not null unique,
  triggered_at     timestamptz not null,
  detected_at      timestamptz not null default now(),
  period_started_at timestamptz not null,
  recorded_seconds numeric(16, 6) not null,
  elapsed_seconds  numeric(16, 6) not null,
  details          jsonb not null default '{}'::jsonb,
  status           text not null default 'open' check (status in ('open', 'acknowledged', 'obsolete')),
  acknowledged_by  uuid references auth.users(id),
  acknowledged_at  timestamptz,
  acknowledgement_note text
);
create index if not exists idx_recovery_alerts_company_status on recovery_alerts(company_id, status, triggered_at desc);

-- Every change HR makes to the timing of a recorded session: original and
-- corrected evidence side by side, who, when, why. Rows are append-only.
create table if not exists attendance_session_corrections (
  id                        uuid primary key default gen_random_uuid(),
  session_id                uuid not null references attendance_sessions(id),
  employee_id               uuid not null references employees(id),
  kind                      text not null check (kind in ('correct_times', 'add_missing')),
  original_clock_in_at      timestamptz,
  original_clock_out_at     timestamptz,
  corrected_clock_in_at     timestamptz not null,
  corrected_clock_out_at    timestamptz not null,
  reason                    text not null check (length(trim(reason)) > 0),
  actor_id                  uuid not null references auth.users(id),
  created_at                timestamptz not null default now()
);
create index if not exists idx_attendance_session_corrections_session on attendance_session_corrections(session_id);

-- Background processor bookkeeping (see recovery_process_due()).
create table if not exists recovery_processor_runs (
  id                    uuid primary key default gen_random_uuid(),
  origin                text not null,
  as_of                 timestamptz not null,
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  status                text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  employees_examined    int not null default 0,
  employees_failed      int not null default 0,
  error_summary         text
);
create index if not exists idx_recovery_processor_runs_started on recovery_processor_runs(started_at desc);

create table if not exists recovery_processor_failures (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid references recovery_processor_runs(id),
  employee_id    uuid not null references employees(id),
  error          text not null,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index if not exists idx_recovery_processor_failures_open on recovery_processor_failures(employee_id) where resolved_at is null;

-- The existing approval funnel is reused. A window-based request is just a
-- recovery_credit_requests row of a new event_type tied to its window.
alter table recovery_credit_requests add column if not exists recovery_window_id uuid references recovery_windows(id);
alter table recovery_credit_requests add column if not exists window_revision_no int;
alter table recovery_credit_requests add column if not exists adjusts_request_id uuid references recovery_credit_requests(id);
alter table recovery_credit_requests add column if not exists consumption_ack_by uuid references auth.users(id);
alter table recovery_credit_requests add column if not exists consumption_ack_at timestamptz;
alter table recovery_credit_requests add column if not exists consumption_ack_note text;

alter table recovery_credit_requests drop constraint if exists recovery_credit_requests_event_type_check;
alter table recovery_credit_requests add constraint recovery_credit_requests_event_type_check
  check (event_type in ('standard', 'overnight', 'window', 'window_top_up', 'window_reduction'));
alter table recovery_credit_requests drop constraint if exists recovery_credit_requests_window_columns_check;
alter table recovery_credit_requests add constraint recovery_credit_requests_window_columns_check
  check (
    (event_type in ('window', 'window_top_up', 'window_reduction')) = (recovery_window_id is not null)
    and ((event_type in ('window_top_up', 'window_reduction')) = (adjusts_request_id is not null))
  );

-- The old per-day natural key must only constrain the OLD families: two
-- different windows can legitimately start on the same local date (a short
-- shift, a real rest, another shift), each worth up to a day in its own
-- right. Window requests are keyed by their window instead.
drop index if exists recovery_credit_requests_active_per_day;
create unique index recovery_credit_requests_active_per_day
  on recovery_credit_requests(employee_id, work_date, event_type)
  where status not in ('cancelled', 'rejected') and segment_id is not null and event_type in ('standard', 'overnight');
create unique index if not exists recovery_credit_requests_active_per_window
  on recovery_credit_requests(recovery_window_id)
  where event_type = 'window' and status not in ('cancelled', 'rejected');
create unique index if not exists recovery_credit_requests_active_adjustment_per_window
  on recovery_credit_requests(recovery_window_id, event_type)
  where event_type in ('window_top_up', 'window_reduction') and status not in ('cancelled', 'rejected');
create index if not exists idx_recovery_credit_requests_window on recovery_credit_requests(recovery_window_id) where recovery_window_id is not null;

-- ---------------------------------------------------------------------
-- 2. Row-Level Security: read-only for people, every write goes through
--    SECURITY DEFINER functions. No INSERT/UPDATE/DELETE policy exists on
--    any new table, so none is possible for authenticated users.
-- ---------------------------------------------------------------------

alter table recovery_periods enable row level security;
alter table recovery_windows enable row level security;
alter table recovery_window_allocations enable row level security;
alter table recovery_window_revisions enable row level security;
alter table recovery_alerts enable row level security;
alter table attendance_session_corrections enable row level security;
alter table recovery_processor_runs enable row level security;
alter table recovery_processor_failures enable row level security;

-- Whether the signed-in user may read Recovery Leave evidence for this
-- employee: the employee themselves, their manager chain, HR Admin of the
-- company, and the CEO/CTO of the company (who decide HR's own requests).
create or replace function can_view_recovery_evidence(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id
      and (
        e.id = current_employee_id()
        or is_manager_of(e.id)
        or has_role('hr_admin', e.company_id)
        or has_role('ceo', e.company_id)
        or has_role('cto', e.company_id)
      )
  );
$$;

create policy recovery_periods_select on recovery_periods for select
  using (can_view_recovery_evidence(employee_id));

create policy recovery_windows_select on recovery_windows for select
  using (
    can_view_recovery_evidence(employee_id)
    or exists (
      select 1 from recovery_credit_requests r
      where r.recovery_window_id = recovery_windows.id and r.project_lead_employee_id = current_employee_id()
    )
  );

create policy recovery_window_allocations_select on recovery_window_allocations for select
  using (
    can_view_recovery_evidence(employee_id)
    or exists (
      select 1 from recovery_credit_requests r
      where r.recovery_window_id = recovery_window_allocations.window_id and r.project_lead_employee_id = current_employee_id()
    )
  );

create policy recovery_window_revisions_select on recovery_window_revisions for select
  using (exists (
    select 1 from recovery_windows w
    where w.id = window_id and (
      can_view_recovery_evidence(w.employee_id)
      or exists (select 1 from recovery_credit_requests r where r.recovery_window_id = w.id and r.project_lead_employee_id = current_employee_id())
    )
  ));

-- Alerts are for HR (and the CEO/CTO of the same company) only — never for
-- the employee, their manager or a project lead.
create policy recovery_alerts_select on recovery_alerts for select
  using (has_role('hr_admin', company_id) or has_role('ceo', company_id) or has_role('cto', company_id));

create policy attendance_session_corrections_select on attendance_session_corrections for select
  using (can_view_recovery_evidence(employee_id));

-- Processor tables have no policy at all: deny-all to every signed-in user.
-- recovery_scheduler_status() (below) is the only reader, and it checks roles.

-- Defence in depth on top of "no write policy": remove the write privileges
-- themselves so a mis-added policy later cannot silently open a write path.
revoke all on recovery_periods, recovery_windows, recovery_window_allocations, recovery_window_revisions,
  recovery_alerts, attendance_session_corrections, recovery_processor_runs, recovery_processor_failures from anon;
revoke insert, update, delete, truncate on recovery_periods, recovery_windows, recovery_window_allocations, recovery_window_revisions,
  recovery_alerts, attendance_session_corrections from authenticated;
revoke all on recovery_processor_runs, recovery_processor_failures from authenticated;

-- ---------------------------------------------------------------------
-- 3. Small helpers
-- ---------------------------------------------------------------------

-- The ONE clock every Recovery Leave calculation reads. In Production this is
-- exactly now(). The isolated RLS test database replaces this function with a
-- controllable one so boundary cases (13h 0s vs 13h 1s, a 24-hour rollover in
-- the middle of an open segment, ...) can be tested without waiting in real
-- time; nothing here can be overridden by an application user.
create or replace function recovery_now()
returns timestamptz
language sql stable
as $$
  select now();
$$;

-- Exact integer microseconds since the epoch: all window arithmetic is done
-- on integers so no boundary is ever decided by a floating-point rounding.
create or replace function recovery_us(p_ts timestamptz)
returns bigint
language sql stable
as $$
  select round(extract(epoch from p_ts) * 1000000)::bigint;
$$;

create or replace function recovery_ts(p_us bigint)
returns timestamptz
language sql immutable
as $$
  select timestamptz 'epoch' + p_us * interval '1 microsecond';
$$;

-- has_role() always asks about the CALLER (auth.uid()). The background
-- processor and HR corrections must reason about the APPLICANT's roles, so this
-- is the same predicate for an explicit user id.
create or replace function user_has_role(p_user_id uuid, p_role app_role, p_company_id uuid default null, p_country_code text default null)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1 from user_roles
    where user_id = p_user_id
      and role = p_role
      and revoked_at is null
      and (company_id is null or company_id = p_company_id)
      and (country_code is null or country_code = p_country_code)
  );
$$;

-- ---------------------------------------------------------------------
-- 4. Policy: machine-readable rules, generated wording, validation
-- ---------------------------------------------------------------------

-- Plain-English problems with a recovery_windows `rules` object; empty array
-- when it is coherent. Mirrors parseRecoveryWindowRules() in
-- packages/domain/src/recoveryWindows.ts.
create or replace function recovery_window_rules_issues(p_rules jsonb)
returns text[]
language plpgsql immutable
as $$
declare
  v_issues text[] := '{}';
  v_key text;
  v_window numeric; v_rest numeric; v_alert numeric;
  v_nz numeric; v_nh numeric; v_rz numeric; v_rh numeric;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    return array['rules must be an object.'];
  end if;
  foreach v_key in array array['window_hours', 'rest_gap_hours', 'alert_work_hours', 'normal_day_required_hours', 'expiry_days'] loop
    if jsonb_typeof(p_rules -> v_key) is distinct from 'number' or (p_rules ->> v_key)::numeric <= 0 then
      v_issues := array_append(v_issues, (v_key || ' must be a positive number.'));
    end if;
  end loop;
  foreach v_key in array array['zero_max_hours', 'half_max_hours'] loop
    if jsonb_typeof(p_rules -> 'normal_day' -> v_key) is distinct from 'number' or (p_rules -> 'normal_day' ->> v_key)::numeric <= 0 then
      v_issues := array_append(v_issues, ('normal_day.' || v_key || ' must be a positive number.'));
    end if;
  end loop;
  foreach v_key in array array['zero_below_hours', 'half_max_hours'] loop
    if jsonb_typeof(p_rules -> 'rest_day' -> v_key) is distinct from 'number' or (p_rules -> 'rest_day' ->> v_key)::numeric <= 0 then
      v_issues := array_append(v_issues, ('rest_day.' || v_key || ' must be a positive number.'));
    end if;
  end loop;
  if (p_rules -> 'max_days_per_window') is distinct from '1'::jsonb then
    v_issues := array_append(v_issues, 'max_days_per_window must be exactly 1.');
  end if;
  if array_length(v_issues, 1) is not null then
    return v_issues;
  end if;

  v_window := (p_rules ->> 'window_hours')::numeric;
  v_rest := (p_rules ->> 'rest_gap_hours')::numeric;
  v_alert := (p_rules ->> 'alert_work_hours')::numeric;
  v_nz := (p_rules -> 'normal_day' ->> 'zero_max_hours')::numeric;
  v_nh := (p_rules -> 'normal_day' ->> 'half_max_hours')::numeric;
  v_rz := (p_rules -> 'rest_day' ->> 'zero_below_hours')::numeric;
  v_rh := (p_rules -> 'rest_day' ->> 'half_max_hours')::numeric;
  if v_window > 48 then v_issues := array_append(v_issues, 'window_hours must not exceed 48.'); end if;
  if v_rest >= v_window then v_issues := array_append(v_issues, 'rest_gap_hours must be shorter than window_hours.'); end if;
  if v_alert > v_window then v_issues := array_append(v_issues, 'alert_work_hours must not exceed window_hours.'); end if;
  if v_nz >= v_nh then v_issues := array_append(v_issues, 'normal_day.zero_max_hours must be less than normal_day.half_max_hours.'); end if;
  if v_rz >= v_rh then v_issues := array_append(v_issues, 'rest_day.zero_below_hours must be less than rest_day.half_max_hours.'); end if;
  if v_nh > v_window then v_issues := array_append(v_issues, 'normal_day.half_max_hours must not exceed window_hours.'); end if;
  return v_issues;
end;
$$;

-- Policy wording GENERATED from the machine rules — never typed separately —
-- so the text a person reads can never describe different numbers from the
-- ones the engine calculates with. Must stay byte-identical with
-- renderRecoveryWindowPolicyWording() in packages/domain (the RLS suite
-- asserts equality for the same rules).
create or replace function render_recovery_window_policy_wording(p_rules jsonb)
returns text
language plpgsql immutable
as $$
declare
  v_window text := trim_scale((p_rules ->> 'window_hours')::numeric)::text;
  v_rest text := trim_scale((p_rules ->> 'rest_gap_hours')::numeric)::text;
  v_alert text := trim_scale((p_rules ->> 'alert_work_hours')::numeric)::text;
  v_required text := trim_scale((p_rules ->> 'normal_day_required_hours')::numeric)::text;
  v_expiry text := trim_scale((p_rules ->> 'expiry_days')::numeric)::text;
  v_max text := trim_scale((p_rules ->> 'max_days_per_window')::numeric)::text;
  v_nz text := trim_scale((p_rules -> 'normal_day' ->> 'zero_max_hours')::numeric)::text;
  v_nh text := trim_scale((p_rules -> 'normal_day' ->> 'half_max_hours')::numeric)::text;
  v_rz text := trim_scale((p_rules -> 'rest_day' ->> 'zero_below_hours')::numeric)::text;
  v_rh text := trim_scale((p_rules -> 'rest_day' ->> 'half_max_hours')::numeric)::text;
begin
  return array_to_string(array[
    'Recovery Leave is measured from recorded clocked-in time. Lunch while clocked in counts; clocked-out gaps never count; there is no assumed lunch deduction.',
    'Working period: work separated by clocked-out gaps shorter than ' || v_rest || ' hours is one working period. A gap of ' || v_rest || ' hours or more ends it, and the next clock-in starts a fresh period.',
    'Recovery window: each window is ' || v_window || ' real elapsed hours, starting at the first clock-in of the working period and then at each previous window boundary, and earns at most ' || v_max || ' day. Windows roll over automatically without any rest and without a manual clock-out.',
    'Normal working day (normal requirement ' || v_required || ' recorded hours, with no automatic deduction for a shorter day): up to and including ' || v_nz || ' recorded hours earns nothing; more than ' || v_nz || ' and up to and including ' || v_nh || ' hours earns 0.5 day; more than ' || v_nh || ' hours earns 1 day.',
    'Weekly rest day or applicable public holiday: under ' || v_rz || ' recorded hours earns nothing; from ' || v_rz || ' up to and including ' || v_rh || ' hours earns 0.5 day; more than ' || v_rh || ' hours earns 1 day. A public holiday that falls on a rest day is counted once.',
    'Each window is classified by the local date on which it starts, using the employee''s employment country, its configured working week and its public holidays.',
    'Office, work from home, site work/installation and client meetings all qualify. Business travel is recorded and always reviewed by HR before any credit.',
    'HR is alerted when accumulated recorded work reaches ' || v_alert || ' hours without a ' || v_rest || '-hour rest. This is a review signal only; it does not start a new recovery day.',
    'Credit requires a closed window, the independent approval route for the applicant and HR verification of unusual cases. Unused credit expires ' || v_expiry || ' days after it is earned and is never converted to cash, including on termination. This is an internal benefit and does not replace any mandatory statutory right.'
  ], E'\n');
end;
$$;

-- Active windows policy for a country on a given local date, with the rules
-- object. Null result = the windows model is not in force there (so every
-- clock-in stays on the legacy calculation).
create or replace function recovery_windows_policy_for(p_country_code text, p_as_of date)
returns table (policy_version_id uuid, version_no int, rules jsonb)
language sql stable security definer
set search_path = public
as $$
  select pv.id, pv.version_no, pv.payload -> 'rules'
  from policy_versions pv
  where pv.country_code = p_country_code
    and pv.policy_type = 'overtime_rules'
    and pv.status = 'active'
    and pv.payload ->> 'model' = 'recovery_windows'
    and p_as_of between pv.effective_from and coalesce(pv.effective_to, 'infinity'::date)
  limit 1;
$$;

-- Exact entitlement for one window. Seconds are compared exactly: with the
-- default bands 13h 0m 0s earns nothing and 13h 0m 1s earns 0.5 day; 17h 0m 0s
-- earns 0.5 and 17h 0m 1s earns 1; on a rest day 1h 59m 59s earns nothing, 2h
-- earns 0.5, 6h earns 0.5 and 6h 0m 1s earns 1.
create or replace function recovery_window_entitlement(p_classification text, p_recorded_seconds numeric, p_rules jsonb)
returns table (days numeric, band text)
language plpgsql immutable
as $$
begin
  if p_recorded_seconds is null or p_recorded_seconds <= 0 then
    days := 0; band := 'none'; return next; return;
  end if;
  if p_classification = 'normal_day' then
    if p_recorded_seconds <= (p_rules -> 'normal_day' ->> 'zero_max_hours')::numeric * 3600 then
      days := 0; band := 'none';
    elsif p_recorded_seconds <= (p_rules -> 'normal_day' ->> 'half_max_hours')::numeric * 3600 then
      days := 0.5; band := 'half';
    else
      days := 1; band := 'full';
    end if;
  else
    if p_recorded_seconds < (p_rules -> 'rest_day' ->> 'zero_below_hours')::numeric * 3600 then
      days := 0; band := 'none';
    elsif p_recorded_seconds <= (p_rules -> 'rest_day' ->> 'half_max_hours')::numeric * 3600 then
      days := 0.5; band := 'half';
    else
      days := 1; band := 'full';
    end if;
  end if;
  return next;
end;
$$;

-- Validates every recovery_windows policy on the way in and regenerates its
-- wording from the machine rules, so wording and calculation cannot diverge.
-- Activation is only possible through activate_recovery_windows_policy().
create or replace function guard_recovery_windows_policy()
returns trigger
language plpgsql
as $$
declare
  v_issues text[];
begin
  if new.policy_type <> 'overtime_rules' or new.payload ->> 'model' is distinct from 'recovery_windows' then
    return new;
  end if;

  v_issues := recovery_window_rules_issues(new.payload -> 'rules');
  if array_length(v_issues, 1) is not null then
    raise exception 'Invalid Recovery Leave windows policy: %', array_to_string(v_issues, ' ');
  end if;

  new.payload := jsonb_set(new.payload, '{wording}', to_jsonb(render_recovery_window_policy_wording(new.payload -> 'rules')));

  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and coalesce(current_setting('app.recovery_policy_activation', true), '') <> 'on' then
    raise exception 'A Recovery Leave windows policy is activated only through activate_recovery_windows_policy(), which records a controlled effective date.';
  end if;
  return new;
end;
$$;

drop trigger if exists policy_versions_recovery_windows_rules on policy_versions;
create trigger policy_versions_recovery_windows_rules
  before insert or update on policy_versions
  for each row execute function guard_recovery_windows_policy();

-- Creates the NEXT version of Recovery Leave (overtime_rules) as a DRAFT for
-- UAE, Saudi Arabia and Poland. Same shape as seed_phase2b_policy_drafts():
-- no parameter, the actor is auth.uid(), and the caller must hold a
-- company-unscoped HR Admin grant for each country. Never touches an existing
-- version (the active V2 stays exactly as it is), never activates anything,
-- and is safe to repeat (a marker in the payload makes a second call a no-op).
create or replace function seed_recovery_windows_policy_drafts()
returns table(country_code text, policy_type text, version_no int, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_by uuid := auth.uid();
  v_country text;
  v_version_no int;
  v_rules jsonb;
  v_safeguard text;
  v_payload jsonb;
begin
  if v_created_by is null then
    raise exception 'seed_recovery_windows_policy_drafts must be called by an authenticated HR Admin — auth.uid() is null (it cannot run from the Supabase SQL Editor). Use the button on the Policies page.';
  end if;

  v_rules := jsonb_build_object(
    'window_hours', 24,
    'rest_gap_hours', 8,
    'alert_work_hours', 20,
    'normal_day_required_hours', 9,
    'normal_day', jsonb_build_object('zero_max_hours', 13, 'half_max_hours', 17),
    'rest_day', jsonb_build_object('zero_below_hours', 2, 'half_max_hours', 6),
    'max_days_per_window', 1,
    'expiry_days', 180
  );
  v_safeguard := 'Enginious does not operate a general discretionary overtime-payment scheme. Working beyond normal hours does not automatically create Recovery Leave or an additional contractual payment. Where applicable employment law mandates overtime pay, holiday compensation, substitute rest or another minimum entitlement, Enginious will comply with that statutory requirement.';

  foreach v_country in array array['AE', 'SA', 'PL'] loop
    if not has_role('hr_admin', null, v_country) then
      raise exception 'Only a company-unscoped HR Admin for % may draft Recovery Leave windows policy versions for that country (auth.uid() = %).', v_country, v_created_by;
    end if;

    if exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'overtime_rules'
        and pv.payload ->> 'seed_marker' = 'recovery_windows_v1'
    ) then
      country_code := v_country; policy_type := 'overtime_rules'; version_no := null; action := 'skipped_already_seeded';
      return next;
      continue;
    end if;

    select coalesce(max(pv.version_no), 0) + 1 into v_version_no
    from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'overtime_rules';

    v_payload := jsonb_build_object(
      'seed_marker', 'recovery_windows_v1',
      'model', 'recovery_windows',
      'schema_version', 1,
      'policy_name', 'Enginious Recovery Leave (working-period windows)',
      'statutory_safeguard', v_safeguard,
      'rules', v_rules,
      'eligible_work_modes', jsonb_build_array('office', 'wfh', 'site_work', 'client_meeting'),
      'business_travel', 'recorded_and_hr_reviewed',
      'classification', 'window_starting_local_date',
      'closure_required_before_credit', true,
      'hr_verification_required_for', jsonb_build_array('forgotten_clock_out', 'unusual_long_work', 'business_travel', 'multiple_leads', 'leave_or_manual_conflict'),
      'consumption_order', 'oldest_first',
      'cash_conversion', false,
      'approval_routes', jsonb_build_object(
        'employee_with_lead', 'project_lead_then_hr',
        'self_led', 'hr',
        'permanent_manager', 'hr',
        'hr_applicant', 'ceo_or_cto_queue'
      ),
      'effective_point_note', 'Applies only to clock-ins that start on or after the controlled effective date set when this version is activated. Sessions already in progress at that point finish under the version they started with.'
    );
    -- The draft's own effective_from is a placeholder: the real, controlled
    -- effective date is chosen at activation (activate_recovery_windows_policy).
    insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
    values (v_country, 'overtime_rules', v_version_no, current_date + 1, v_payload, v_created_by);

    country_code := v_country; policy_type := 'overtime_rules'; version_no := v_version_no; action := 'created';
    return next;
  end loop;
end;
$$;

-- Controlled activation of a recovery_windows policy — the ONLY way one can
-- become active, so there is no SQL shortcut around the draft/approve flow:
--   * normal two-person rule (the activator is not the drafter) via the
--     existing guard_policy_version_update trigger,
--   * the activator must be a company-unscoped HR Admin of the country,
--   * the effective date must be tomorrow or later in the country's own time
--     zone (never retroactive, so no history is recalculated),
--   * the version currently in force (V2) is ended the day before — never
--     edited or deleted — so the two never overlap,
--   * who/when/which effective date is recorded on the version.
-- Sessions already open at the effective point keep their legacy calculation;
-- the first clock-in on or after that date starts the first windowed period.
create or replace function activate_recovery_windows_policy(p_policy_version_id uuid, p_effective_from date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pv policy_versions%rowtype;
  v_prev policy_versions%rowtype;
  v_local_today date;
begin
  if auth.uid() is null then
    raise exception 'A signed-in HR Admin is required to activate a Recovery Leave policy.';
  end if;
  select * into v_pv from policy_versions where id = p_policy_version_id for update;
  if not found then raise exception 'Policy version not found.'; end if;
  if v_pv.policy_type <> 'overtime_rules' or v_pv.payload ->> 'model' is distinct from 'recovery_windows' then
    raise exception 'This is not a Recovery Leave windows policy.';
  end if;
  if v_pv.status <> 'draft' then raise exception 'Only a draft version can be activated.'; end if;
  -- Activation sets the controlled effective date, which is policy CONTENT:
  -- the existing guard_policy_version_update trigger lets only HR Admin change
  -- content, so the CEO/CTO-only "activate but never edit" path cannot be used
  -- here (it would have to change effective_from).
  if not has_role('hr_admin', null, v_pv.country_code) then
    raise exception 'Only a company-unscoped HR Admin for % may activate this policy (and not the person who drafted it).', v_pv.country_code;
  end if;
  if auth.uid() = v_pv.created_by then
    raise exception 'A policy version must be activated by someone other than who drafted it.';
  end if;

  v_local_today := (recovery_now() at time zone country_timezone(v_pv.country_code))::date;
  if p_effective_from is null or p_effective_from <= v_local_today then
    raise exception 'The effective date must be after today (%) in this country''s time zone, so no history is recalculated.', v_local_today;
  end if;
  if exists (
    select 1 from policy_versions o
    where o.country_code = v_pv.country_code and o.policy_type = 'overtime_rules' and o.status = 'active'
      and o.id <> v_pv.id and o.effective_from >= p_effective_from
  ) then
    raise exception 'An active version already starts on or after %. Resolve that first.', p_effective_from;
  end if;

  select * into v_prev from policy_versions o
  where o.country_code = v_pv.country_code and o.policy_type = 'overtime_rules' and o.status = 'active'
    and o.id <> v_pv.id and o.effective_from < p_effective_from
    and coalesce(o.effective_to, 'infinity'::date) >= p_effective_from
  order by o.effective_from desc limit 1
  for update;

  perform set_config('app.recovery_policy_activation', 'on', true);
  if v_prev.id is not null then
    update policy_versions set effective_to = p_effective_from - 1 where id = v_prev.id;
  end if;
  update policy_versions
  set effective_from = p_effective_from,
      effective_to = null,
      status = 'active',
      activation_record = jsonb_build_object(
        'activated_by', auth.uid(),
        'activated_at', recovery_now(),
        'effective_from', p_effective_from,
        'supersedes_version_id', v_prev.id,
        'supersedes_version_no', v_prev.version_no,
        'supersedes_ended_on', case when v_prev.id is not null then p_effective_from - 1 else null end
      )
  where id = v_pv.id;
  perform set_config('app.recovery_policy_activation', 'off', true);
end;
$$;

-- The controlled way to STOP using the window model for new work (the "disable"
-- switch), without deleting or rewriting anything:
--   * the windows version gets an end date (never earlier than tomorrow in the
--     country's own time zone, so no history is recalculated);
--   * clock-ins that start after that date are stamped 'legacy' again, so no NEW
--     working period is ever created;
--   * every existing session, period, window, request, credit and audit row is
--     left exactly as it is — periods already running finish under the rules
--     they started with, and the background processor keeps finishing them;
--   * the version that was in force before is re-drafted (a fresh DRAFT copy of
--     its text, next version number) so HR can reactivate the earlier wording
--     through the normal two-person flow if they want it back on screen.
-- Nothing is reactivated automatically.
create or replace function deactivate_recovery_windows_policy(p_policy_version_id uuid, p_last_effective_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pv policy_versions%rowtype;
  v_prev policy_versions%rowtype;
  v_local_today date;
  v_next_no int;
begin
  if auth.uid() is null then
    raise exception 'A signed-in HR Admin is required to deactivate a Recovery Leave policy.';
  end if;
  select * into v_pv from policy_versions where id = p_policy_version_id for update;
  if not found then raise exception 'Policy version not found.'; end if;
  if v_pv.policy_type <> 'overtime_rules' or v_pv.payload ->> 'model' is distinct from 'recovery_windows' or v_pv.status <> 'active' then
    raise exception 'This is not an active Recovery Leave windows policy.';
  end if;
  if not has_role('hr_admin', null, v_pv.country_code) then
    raise exception 'Only a company-unscoped HR Admin for % may deactivate this policy.', v_pv.country_code;
  end if;
  v_local_today := (recovery_now() at time zone country_timezone(v_pv.country_code))::date;
  if p_last_effective_date is null or p_last_effective_date <= v_local_today then
    raise exception 'The last effective date must be after today (%) in this country''s time zone, so no history is recalculated.', v_local_today;
  end if;
  if v_pv.effective_to is not null and v_pv.effective_to <= p_last_effective_date then
    raise exception 'This version already ends on %.', v_pv.effective_to;
  end if;

  update policy_versions
  set effective_to = p_last_effective_date,
      activation_record = coalesce(activation_record, '{}'::jsonb) || jsonb_build_object(
        'deactivated_by', auth.uid(), 'deactivated_at', recovery_now(), 'last_effective_date', p_last_effective_date)
  where id = v_pv.id;

  select * into v_prev from policy_versions where id = (v_pv.activation_record ->> 'supersedes_version_id')::uuid;
  if v_prev.id is not null then
    select coalesce(max(version_no), 0) + 1 into v_next_no
    from policy_versions where country_code = v_pv.country_code and policy_type = 'overtime_rules';
    insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
    values (v_pv.country_code, 'overtime_rules', v_next_no, p_last_effective_date + 1, v_prev.payload, auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. The calculation: working periods and 24-elapsed-hour windows.
--    recovery_derive() is READ-ONLY and mirrors
--    packages/domain/src/recoveryWindows.ts (buildRecoveryPeriods()) rule for
--    rule; recovery_recalculate_employee() persists its result. All lifecycle
--    paths (clock in/out, mode switch, HR closure/correction, the background
--    processor) funnel through these two functions.
-- ---------------------------------------------------------------------

-- Builds ONE working period from its sorted intervals. Every instant is an
-- integer number of microseconds. p_intervals elements:
--   {segment_id, session_id, start_us, end_us, open, work_mode, project_name,
--    project_lead_employee_id, hr_closed, recorded_by_hr}
create or replace function recovery_derive_period(
  p_employee_id uuid,
  p_country_code text,
  p_timezone text,
  p_policy_version_id uuid,
  p_rules jsonb,
  p_intervals jsonb,
  p_as_of_us bigint
)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_rest_us bigint := round((p_rules ->> 'rest_gap_hours')::numeric * 3600 * 1000000)::bigint;
  v_window_us bigint := round((p_rules ->> 'window_hours')::numeric * 3600 * 1000000)::bigint;
  v_alert_us bigint := round((p_rules ->> 'alert_work_hours')::numeric * 3600 * 1000000)::bigint;
  v_start_us bigint := (p_intervals -> 0 ->> 'start_us')::bigint;
  v_last_end_us bigint;
  v_has_open boolean := false;
  v_rest_completes_us bigint;
  v_ended boolean;
  v_iv jsonb;
  v_running_end bigint;
  v_gaps jsonb := '[]'::jsonb;
  v_windows jsonb := '{}'::jsonb;
  v_w jsonb;
  v_cursor bigint;
  v_idx int;
  v_w_start bigint;
  v_w_end bigint;
  v_piece_end bigint;
  v_piece_us bigint;
  v_cumulative bigint := 0;
  v_recorded_total bigint := 0;
  v_long_trigger bigint := null;
  v_key text;
  v_out_windows jsonb := '[]'::jsonb;
  v_rollovers jsonb := '[]'::jsonb;
  v_k int;
  v_boundary bigint;
  v_closed boolean;
  v_closed_at bigint;
  v_closed_reason text;
  v_local_date date;
  v_is_rec boolean;
  v_holiday text;
  v_class text;
  v_ent record;
  v_flags text[];
  v_allocs jsonb;
  v_cum_at_boundary bigint;
  v_win_recorded numeric;
begin
  select max((e ->> 'end_us')::bigint), coalesce(bool_or((e ->> 'open')::boolean), false)
  into v_last_end_us, v_has_open
  from jsonb_array_elements(p_intervals) e;

  v_rest_completes_us := case when v_has_open then null else v_last_end_us + v_rest_us end;
  v_ended := v_rest_completes_us is not null and v_rest_completes_us <= p_as_of_us;

  -- Clocked-out gaps inside the period (each shorter than the rest threshold).
  v_running_end := (p_intervals -> 0 ->> 'end_us')::bigint;
  for v_iv in select e from jsonb_array_elements(p_intervals) with ordinality t(e, n) where n > 1 order by n loop
    if (v_iv ->> 'start_us')::bigint > v_running_end then
      v_gaps := v_gaps || jsonb_build_object('start_us', v_running_end, 'end_us', (v_iv ->> 'start_us')::bigint);
    end if;
    v_running_end := greatest(v_running_end, (v_iv ->> 'end_us')::bigint);
  end loop;

  -- Split every interval at the 24-elapsed-hour boundaries. Each recorded
  -- microsecond lands in exactly one window; the evidence itself is untouched.
  for v_iv in select e from jsonb_array_elements(p_intervals) e loop
    v_cursor := (v_iv ->> 'start_us')::bigint;
    while v_cursor < (v_iv ->> 'end_us')::bigint loop
      v_idx := ((v_cursor - v_start_us) / v_window_us)::int + 1;
      v_w_start := v_start_us + (v_idx - 1)::bigint * v_window_us;
      v_w_end := v_w_start + v_window_us;
      v_piece_end := least((v_iv ->> 'end_us')::bigint, v_w_end);
      v_piece_us := v_piece_end - v_cursor;

      if v_long_trigger is null and v_cumulative + v_piece_us >= v_alert_us then
        v_long_trigger := v_cursor + (v_alert_us - v_cumulative);
      end if;
      v_cumulative := v_cumulative + v_piece_us;
      v_recorded_total := v_recorded_total + v_piece_us;

      v_key := v_idx::text;
      v_w := v_windows -> v_key;
      if v_w is null then
        v_w := jsonb_build_object('index', v_idx, 'start_us', v_w_start, 'end_us', v_w_end, 'recorded_us', 0, 'allocations', '[]'::jsonb);
      end if;
      v_w := jsonb_set(v_w, '{recorded_us}', to_jsonb((v_w ->> 'recorded_us')::bigint + v_piece_us));
      v_w := jsonb_set(v_w, '{allocations}', (v_w -> 'allocations') || jsonb_build_object(
        'segment_id', v_iv -> 'segment_id',
        'session_id', v_iv -> 'session_id',
        'work_mode', v_iv -> 'work_mode',
        'project_name', v_iv -> 'project_name',
        'project_lead_employee_id', v_iv -> 'project_lead_employee_id',
        'hr_closed', v_iv -> 'hr_closed',
        'recorded_by_hr', v_iv -> 'recorded_by_hr',
        'start_us', v_cursor,
        'end_us', v_piece_end,
        'us', v_piece_us
      ));
      v_windows := jsonb_set(v_windows, array[v_key], v_w, true);
      v_cursor := v_piece_end;
    end loop;
  end loop;

  -- Window by window, in order: closure, classification, entitlement, flags.
  v_cum_at_boundary := 0;
  for v_key in select k from jsonb_object_keys(v_windows) k order by k::int loop
    v_w := v_windows -> v_key;
    v_closed := false; v_closed_at := null; v_closed_reason := null;
    -- Closes at whichever comes first: its own 24 elapsed hours running out,
    -- or the period genuinely ending by a completed rest.
    if (v_w ->> 'end_us')::bigint <= p_as_of_us then
      v_closed := true; v_closed_at := (v_w ->> 'end_us')::bigint; v_closed_reason := 'elapsed_window';
    end if;
    if v_ended and (not v_closed or v_rest_completes_us < v_closed_at) then
      v_closed := true; v_closed_at := v_rest_completes_us; v_closed_reason := 'rest';
    end if;

    v_local_date := (recovery_ts((v_w ->> 'start_us')::bigint) at time zone p_timezone)::date;
    select r.is_recovery_day, r.holiday_name into v_is_rec, v_holiday from is_recovery_eligible_day(p_country_code, v_local_date) r;
    v_class := case when v_holiday is not null then 'public_holiday' when v_is_rec then 'rest_day' else 'normal_day' end;
    v_win_recorded := (v_w ->> 'recorded_us')::numeric / 1000000;
    select * into v_ent from recovery_window_entitlement(v_class, v_win_recorded, p_rules);

    v_allocs := v_w -> 'allocations';
    v_flags := '{}';
    if exists (select 1 from jsonb_array_elements(v_allocs) a where a ->> 'work_mode' = 'business_travel') then
      v_flags := array_append(v_flags, 'business_travel');
    end if;
    if (select count(distinct a ->> 'project_lead_employee_id') from jsonb_array_elements(v_allocs) a where a ->> 'project_lead_employee_id' is not null) > 1
       or (select count(distinct lower(trim(a ->> 'project_name'))) from jsonb_array_elements(v_allocs) a where nullif(trim(a ->> 'project_name'), '') is not null) > 1 then
      v_flags := array_append(v_flags, 'multiple_leads');
    end if;
    if exists (select 1 from jsonb_array_elements(v_allocs) a where (a ->> 'hr_closed')::boolean) then
      v_flags := array_append(v_flags, 'forgotten_clock_out');
    end if;
    if exists (select 1 from jsonb_array_elements(v_allocs) a where (a ->> 'recorded_by_hr')::boolean) then
      v_flags := array_append(v_flags, 'hr_recorded');
    end if;
    if (v_w ->> 'recorded_us')::bigint >= v_alert_us then
      v_flags := array_append(v_flags, 'unusual_long_work');
    end if;
    if exists (select 1 from leave_requests lr where lr.employee_id = p_employee_id and lr.status = 'approved' and lr.deleted_at is null and v_local_date between lr.start_date and lr.end_date)
       or exists (select 1 from attendance_records ar where ar.employee_id = p_employee_id and ar.work_date = v_local_date and ar.status = 'leave') then
      v_flags := array_append(v_flags, 'leave_conflict');
    end if;
    if exists (select 1 from attendance_records ar where ar.employee_id = p_employee_id and ar.work_date = v_local_date and ar.source <> 'self_clock' and ar.status not in ('not_recorded', 'leave')) then
      v_flags := array_append(v_flags, 'manual_conflict');
    end if;

    v_out_windows := v_out_windows || (v_w || jsonb_build_object(
      'closed', v_closed,
      'closed_at_us', v_closed_at,
      'closed_reason', v_closed_reason,
      'starting_local_date', v_local_date,
      'classification', v_class,
      'holiday_name', v_holiday,
      'entitlement_days', v_ent.days,
      'band', v_ent.band,
      'review_flags', to_jsonb(v_flags),
      'hr_verification_required', v_flags && array['forgotten_clock_out', 'unusual_long_work', 'business_travel', 'multiple_leads', 'leave_conflict', 'manual_conflict']
    ));
  end loop;

  -- A rollover is a 24-elapsed-hour boundary that arrives while the period has
  -- NOT yet had a completed rest. It never counts as rest itself, and no
  -- window is manufactured after a real rest.
  v_k := 1;
  loop
    v_boundary := v_start_us + v_k::bigint * v_window_us;
    exit when v_boundary > p_as_of_us;
    exit when v_rest_completes_us is not null and v_rest_completes_us <= v_boundary;
    -- Only a boundary the work actually carries across is a rollover: work that
    -- already stopped before the boundary has nothing to roll over.
    exit when not (v_boundary < v_last_end_us or (v_has_open and v_boundary <= v_last_end_us));
    select coalesce(sum((w ->> 'recorded_us')::bigint), 0) into v_cum_at_boundary
    from jsonb_array_elements(v_out_windows) w where (w ->> 'index')::int <= v_k;
    v_rollovers := v_rollovers || jsonb_build_object('window_index', v_k, 'at_us', v_boundary, 'recorded_us', v_cum_at_boundary, 'elapsed_us', v_k::bigint * v_window_us);
    v_k := v_k + 1;
  end loop;

  return jsonb_build_object(
    'start_us', v_start_us,
    'last_work_end_us', v_last_end_us,
    'elapsed_us', v_last_end_us - v_start_us,
    'recorded_us', v_recorded_total,
    'has_open', v_has_open,
    'rest_completes_us', v_rest_completes_us,
    'ended', v_ended,
    'gaps', v_gaps,
    'long_work_trigger_us', v_long_trigger,
    'rollovers', v_rollovers,
    'windows', v_out_windows,
    'country_code', p_country_code,
    'timezone', p_timezone,
    'policy_version_id', p_policy_version_id,
    'rules', p_rules
  );
end;
$$;

create or replace function recovery_derive(p_employee_id uuid, p_as_of timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_country text;
  v_tz text;
  v_as_of_us bigint := recovery_us(p_as_of);
  v_periods jsonb := '[]'::jsonb;
  r record;
  v_start_us bigint;
  v_end_us bigint;
  v_group jsonb := '[]'::jsonb;
  v_group_end bigint := null;
  v_group_rules jsonb;
  v_group_pv uuid;
  v_rest_us bigint;
  v_pol record;
  v_existing record;
begin
  select e.country_code into v_country from employees e where e.id = p_employee_id;
  if v_country is null then
    return jsonb_build_object('periods', '[]'::jsonb);
  end if;
  v_tz := country_timezone(v_country);

  for r in
    select s.id as segment_id, s.session_id, s.work_mode, s.project_name, s.project_lead_employee_id,
           s.segment_start, s.segment_end,
           (ses.hr_closed_at is not null) as hr_closed, ses.recorded_by_hr
    from attendance_segments s
    join attendance_sessions ses on ses.id = s.session_id
    where s.employee_id = p_employee_id and ses.recovery_model = 'windowed'
    order by s.segment_start, s.id
  loop
    v_start_us := recovery_us(r.segment_start);
    v_end_us := case when r.segment_end is null then greatest(v_as_of_us, v_start_us) else recovery_us(r.segment_end) end;
    continue when v_end_us <= v_start_us;

    -- A new working period starts when this interval begins at least the rest
    -- threshold after everything before it ended (a gap of EXACTLY the
    -- threshold ends the period; one microsecond less keeps it going).
    if v_group_end is null or v_start_us - v_group_end >= v_rest_us then
      if v_group_end is not null then
        v_periods := v_periods || recovery_derive_period(p_employee_id, v_country, v_tz, v_group_pv, v_group_rules, v_group, v_as_of_us);
      end if;
      v_group := '[]'::jsonb;
      v_group_end := null;
      -- Rules for a period: the snapshot already stored for this exact start
      -- when it exists (so a later policy change never moves an in-flight
      -- period), otherwise the active windows policy on the start's local date.
      select p.rules, p.policy_version_id into v_existing
      from recovery_periods p
      where p.employee_id = p_employee_id and p.started_at = r.segment_start and p.status <> 'superseded';
      if v_existing.rules is not null then
        v_group_rules := v_existing.rules; v_group_pv := v_existing.policy_version_id;
      else
        select * into v_pol from recovery_windows_policy_for(v_country, (r.segment_start at time zone v_tz)::date);
        if v_pol.rules is null then
          raise exception 'No active Recovery Leave windows policy covers % for country % — cannot derive this working period.', (r.segment_start at time zone v_tz)::date, v_country;
        end if;
        v_group_rules := v_pol.rules; v_group_pv := v_pol.policy_version_id;
      end if;
      v_rest_us := round((v_group_rules ->> 'rest_gap_hours')::numeric * 3600 * 1000000)::bigint;
    end if;

    v_group := v_group || jsonb_build_object(
      'segment_id', r.segment_id, 'session_id', r.session_id, 'start_us', v_start_us, 'end_us', v_end_us,
      'open', r.segment_end is null, 'work_mode', r.work_mode, 'project_name', r.project_name,
      'project_lead_employee_id', r.project_lead_employee_id, 'hr_closed', r.hr_closed, 'recorded_by_hr', r.recorded_by_hr
    );
    v_group_end := greatest(coalesce(v_group_end, v_end_us), v_end_us);
  end loop;

  if v_group_end is not null then
    v_periods := v_periods || recovery_derive_period(p_employee_id, v_country, v_tz, v_group_pv, v_group_rules, v_group, v_as_of_us);
  end if;

  return jsonb_build_object('as_of_us', v_as_of_us, 'country_code', v_country, 'timezone', v_tz, 'periods', v_periods);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Requests, routing and the persisting engine
-- ---------------------------------------------------------------------

-- Is there at least one person who could actually decide with one of these
-- roles in this company, other than the applicant themselves? (Mirrors
-- has_role(): only grants unscoped by country count.) A request with nobody to
-- decide it is shown as UNRESOLVED with a reason — never silently dropped and
-- never guess-routed.
create or replace function recovery_eligible_approver_exists(p_company_id uuid, p_roles app_role[], p_exclude_user uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from user_roles ur
    where ur.role = any (p_roles)
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = p_company_id)
      and ur.country_code is null
      and ur.user_id is distinct from p_exclude_user
      and not exists (
        select 1 from employees e2
        where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
      )
  );
$$;

-- The same four-way route the existing self-clock path uses, resolved from the
-- APPLICANT's own roles (not the caller's): HR applicant (even when also a
-- manager) -> shared CEO/CTO queue; permanent manager -> HR; an ordinary
-- employee naming themselves as lead -> HR; an ordinary employee with another
-- lead -> that lead, then HR. No lead at all -> null ("awaiting project lead").
create or replace function recovery_route_for_employee(p_employee_id uuid, p_project_lead_employee_id uuid)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_company uuid;
begin
  select user_id, company_id into v_user, v_company from employees where id = p_employee_id;
  if user_has_role(v_user, 'hr_admin', v_company) then
    return 'hr_admin_ceo_cto_queue';
  elsif user_has_role(v_user, 'line_manager', v_company) then
    return 'manager_hr_direct';
  elsif p_project_lead_employee_id is null then
    return null;
  elsif p_project_lead_employee_id = p_employee_id then
    return 'self_led_hr_direct';
  end if;
  return 'employee_lead_then_hr';
end;
$$;

-- Creates step 1 of the approval chain for a window request under SYSTEM
-- authority (create_initial_approval() insists the caller owns the request,
-- which the background processor never does). Never impersonates anyone: the
-- approvals row carries no actor of its own, and the request's created_by is
-- the real origin. A missing approver is recorded as routing_issue.
create or replace function recovery_route_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r recovery_credit_requests%rowtype;
  v_company uuid;
  v_user uuid;
  v_lead_user uuid;
  v_roles app_role[];
  v_approval_id uuid;
begin
  select * into r from recovery_credit_requests where id = p_request_id for update;
  if not found then raise exception 'Recovery credit request not found.'; end if;
  select e.company_id, e.user_id into v_company, v_user from employees e where e.id = r.employee_id;

  select id into v_approval_id from approvals where entity_type = 'recovery_credit' and entity_id = p_request_id and step_order = 1;
  if v_approval_id is not null then return v_approval_id; end if;
  if r.applicant_route is null then return null; end if;

  if r.applicant_route = 'employee_lead_then_hr' then
    select e.user_id into v_lead_user from employees e
    where e.id = r.project_lead_employee_id and e.employment_status <> 'terminated' and e.deleted_at is null;
    if v_lead_user is null then
      update recovery_credit_requests set routing_issue = 'The named project lead has no active HR Engine account to approve with. HR must assign another lead.' where id = p_request_id;
      return null;
    end if;
    if v_lead_user = v_user then
      update recovery_credit_requests set routing_issue = 'The resolved project lead is the applicant. HR must review this request.' where id = p_request_id;
      return null;
    end if;
    if not recovery_eligible_approver_exists(v_company, array['hr_admin']::app_role[], v_user) then
      update recovery_credit_requests set routing_issue = 'No HR Admin is currently available to take the second approval step.' where id = p_request_id;
      return null;
    end if;
    insert into approvals (entity_type, entity_id, step_order, approver_id, decision)
    values ('recovery_credit', p_request_id, 1, v_lead_user, 'pending')
    on conflict (entity_type, entity_id, step_order) do nothing
    returning id into v_approval_id;
  else
    v_roles := case r.applicant_route when 'hr_admin_ceo_cto_queue' then array['ceo', 'cto']::app_role[] else array['hr_admin']::app_role[] end;
    if not recovery_eligible_approver_exists(v_company, v_roles, v_user) then
      update recovery_credit_requests
      set routing_issue = 'No eligible approver currently holds the ' || array_to_string(v_roles, ' or ') || ' role for this company.'
      where id = p_request_id;
      return null;
    end if;
    insert into approvals (entity_type, entity_id, step_order, queue_roles, decision)
    values ('recovery_credit', p_request_id, 1, v_roles, 'pending')
    on conflict (entity_type, entity_id, step_order) do nothing
    returning id into v_approval_id;
  end if;

  update recovery_credit_requests set routing_issue = null where id = p_request_id and routing_issue is not null;
  if v_approval_id is null then
    select id into v_approval_id from approvals where entity_type = 'recovery_credit' and entity_id = p_request_id and step_order = 1;
  end if;
  return v_approval_id;
end;
$$;

-- Lock order everywhere in this feature matches decide_leave_approval():
-- approvals rows first, then the request row, then the ledger lock.
create or replace function recovery_cancel_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from approvals where entity_type = 'recovery_credit' and entity_id = p_request_id for update;
  update approvals
  set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, p_reason)
  where entity_type = 'recovery_credit' and entity_id = p_request_id and decision = 'pending';
  update recovery_credit_requests
  set status = 'cancelled', decided_at = now(), correction_reason = coalesce(correction_reason, p_reason)
  where id = p_request_id and status in ('submitted', 'pending_approval');
end;
$$;

-- Days actually credited to the ledger for one window: every earned entry
-- (original, top-ups, re-earned remainders) that has not been reversed.
create or replace function recovery_window_credited_days(p_window_id uuid)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(cl.days), 0)
  from comp_day_ledger cl
  join recovery_credit_requests r on cl.reference_type = 'recovery_credit_request' and cl.reference_id = r.id
  where r.recovery_window_id = p_window_id
    and cl.entry_type = 'earned'
    and not exists (select 1 from comp_day_ledger x where x.reversal_of_id = cl.id);
$$;

-- Brings the approval requests for ONE closed window in line with its current
-- calculated entitlement. Idempotent: running it again with nothing changed
-- creates nothing.
--   * nothing earned yet, entitlement > 0  -> one 'window' request;
--   * request still pending                -> its amount is updated in place
--                                             (or it is cancelled if the
--                                             entitlement fell to 0), and a
--                                             lead who had already approved
--                                             must approve again;
--   * request approved (credit posted)     -> only the DIFFERENCE is requested:
--                                             a top-up (e.g. 0.5 -> 1 asks for
--                                             +0.5) or an explicit reduction.
create or replace function recovery_sync_window_requests(p_window_id uuid, p_actor uuid, p_reason text, p_origin text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  w recovery_windows%rowtype;
  v_emp record;
  v_orig recovery_credit_requests%rowtype;
  v_adj recovery_credit_requests%rowtype;
  v_credited numeric;
  v_target numeric;
  v_delta numeric;
  v_anchor record;
  v_route text;
  v_request_id uuid;
  v_created int := 0;
  v_creator uuid;
  v_material boolean;
  v_kind text;
begin
  select * into w from recovery_windows where id = p_window_id;
  if not found or w.status <> 'closed' then return 0; end if;
  select e.id, e.employment_status into v_emp from employees e where e.id = w.employee_id;
  if v_emp.employment_status = 'terminated' then return 0; end if;

  v_creator := coalesce(p_actor, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  v_target := w.entitlement_days;
  v_credited := recovery_window_credited_days(w.id);

  select * into v_orig from recovery_credit_requests
  where recovery_window_id = w.id and event_type = 'window' and status not in ('cancelled', 'rejected');

  if v_orig.id is null then
    -- A rejected/cancelled request for this exact (or a later) revision is a
    -- final answer: never re-request the same evidence in a loop.
    if v_target > 0 and not exists (
      select 1 from recovery_credit_requests
      where recovery_window_id = w.id and event_type = 'window' and status in ('rejected', 'cancelled') and window_revision_no >= w.revision_no
    ) then
      select a.segment_id, a.work_mode, a.project_name, a.project_lead_employee_id into v_anchor
      from recovery_window_allocations a
      where a.window_id = w.id
      order by (a.work_mode = 'site_work') desc, (a.project_lead_employee_id is not null) desc, a.alloc_start asc, a.segment_id
      limit 1;
      if v_anchor.segment_id is null then return 0; end if;
      v_route := recovery_route_for_employee(w.employee_id, v_anchor.project_lead_employee_id);

      insert into recovery_credit_requests (
        employee_id, segment_id, work_date, event_type, proposed_days, created_by,
        work_mode, project_name, project_lead_employee_id, applicant_route, awaiting_project_lead, needs_policy_review,
        recovery_window_id, window_revision_no
      )
      values (
        w.employee_id, v_anchor.segment_id, w.starting_local_date, 'window', v_target, v_creator,
        v_anchor.work_mode, v_anchor.project_name, v_anchor.project_lead_employee_id, v_route, v_route is null, w.hr_verification_required,
        w.id, w.revision_no
      )
      returning id into v_request_id;
      v_created := v_created + 1;
      if v_route is not null then
        perform recovery_route_request(v_request_id);
      end if;
    end if;
    return v_created;
  end if;

  if v_orig.status in ('submitted', 'pending_approval') then
    if v_target = 0 then
      perform recovery_cancel_request(v_orig.id, 'Cancelled: the corrected evidence no longer earns a Recovery Leave day.');
      return 0;
    end if;
    v_material := v_orig.proposed_days is distinct from v_target or v_orig.window_revision_no is distinct from w.revision_no;
    if v_material then
      perform 1 from approvals where entity_type = 'recovery_credit' and entity_id = v_orig.id for update;
      perform 1 from recovery_credit_requests where id = v_orig.id for update;
      update recovery_credit_requests
      set proposed_days = v_target,
          window_revision_no = w.revision_no,
          needs_policy_review = w.hr_verification_required,
          correction_reason = coalesce(p_reason, 'Evidence recalculated'),
          corrected_by = case when v_creator = '00000000-0000-0000-0000-000000000000'::uuid then corrected_by else v_creator end,
          corrected_at = now()
      where id = v_orig.id;
      -- A MATERIAL change after the project lead already approved needs the
      -- lead's renewed approval before anything can be credited.
      if v_orig.applicant_route = 'employee_lead_then_hr' then
        update approvals
        set decision = 'pending', decided_at = null,
            comments = coalesce(comments || ' — ', '') || 'Reset for renewed approval after the evidence changed.'
        where entity_type = 'recovery_credit' and entity_id = v_orig.id and step_order = 1 and decision = 'approved';
      end if;
    elsif v_orig.needs_policy_review is distinct from w.hr_verification_required then
      update recovery_credit_requests set needs_policy_review = w.hr_verification_required where id = v_orig.id;
    end if;
    return 0;
  end if;

  -- Approved: compare with what the ledger really holds for this window.
  v_delta := v_target - v_credited;
  v_kind := case when v_delta > 0 then 'window_top_up' else 'window_reduction' end;
  select * into v_adj from recovery_credit_requests
  where recovery_window_id = w.id and event_type in ('window_top_up', 'window_reduction') and status not in ('cancelled', 'rejected');

  if v_delta = 0 then
    if v_adj.id is not null and v_adj.status in ('submitted', 'pending_approval') then
      perform recovery_cancel_request(v_adj.id, 'Cancelled: no difference remains between the evidence and the credit already posted.');
    end if;
    return 0;
  end if;

  if v_adj.id is not null and v_adj.status in ('submitted', 'pending_approval') then
    if v_adj.event_type = v_kind and v_adj.proposed_days = abs(v_delta) then
      return 0; -- already requesting exactly this
    end if;
    perform recovery_cancel_request(v_adj.id, 'Superseded by a newer calculation of the difference.');
  elsif v_adj.id is not null then
    return 0; -- an approved adjustment is already reflected in v_credited
  end if;

  if exists (
    select 1 from recovery_credit_requests
    where recovery_window_id = w.id and event_type = v_kind
      and status in ('rejected', 'cancelled') and window_revision_no >= w.revision_no
  ) then
    return 0; -- this exact revision's difference was already answered
  end if;

  insert into recovery_credit_requests (
    employee_id, segment_id, work_date, event_type, proposed_days, created_by,
    work_mode, project_name, project_lead_employee_id, applicant_route, awaiting_project_lead, needs_policy_review,
    recovery_window_id, window_revision_no, adjusts_request_id
  )
  values (
    w.employee_id, v_orig.segment_id, w.starting_local_date,
    v_kind,
    abs(v_delta), v_creator,
    v_orig.work_mode, v_orig.project_name, v_orig.project_lead_employee_id, v_orig.applicant_route, false, true,
    w.id, w.revision_no, v_orig.id
  )
  returning id into v_request_id;
  v_created := v_created + 1;
  perform recovery_route_request(v_request_id);
  return v_created;
end;
$$;

-- The persisting engine. Re-derives the employee's working periods and windows
-- from the raw evidence and brings every derived table, alert and request in
-- line — one transaction, idempotent, safe to run any number of times and from
-- any lifecycle path (clock events, HR corrections, the background processor).
-- p_as_of exists so a delayed processor can catch up on every boundary it
-- missed, and so tests can use a controlled clock; callers normally omit it.
create or replace function recovery_recalculate_employee(
  p_employee_id uuid,
  p_as_of timestamptz default null,
  p_origin text default 'engine',
  p_reason text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, recovery_now());
  v_emp record;
  v_derived jsonb;
  v_period jsonb;
  v_win jsonb;
  v_alert jsonb;
  v_period_id uuid;
  v_old record;
  v_starts bigint[];
  v_indexes int[];
  v_w recovery_windows%rowtype;
  v_found boolean;
  v_new_rec numeric;
  v_new_ent numeric;
  v_new_band text;
  v_new_class text;
  v_new_date date;
  v_new_flags text[];
  v_new_closed boolean;
  v_new_verif boolean;
  v_sig text;
  v_facts_changed boolean;
  v_rev_no int;
  v_make_revision boolean;
  v_reason text;
  v_prev jsonb;
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_alert_keys text[];
  v_req record;
  v_created int := 0;
  v_status text;
  v_alloc jsonb;
  v_window_id uuid;
begin
  select e.id, e.company_id, e.country_code, e.deleted_at into v_emp from employees e where e.id = p_employee_id;
  if v_emp.id is null or v_emp.deleted_at is not null then
    return jsonb_build_object('skipped', 'employee_not_found');
  end if;
  if not exists (select 1 from attendance_sessions where employee_id = p_employee_id and recovery_model = 'windowed') then
    return jsonb_build_object('skipped', 'no_windowed_sessions');
  end if;

  perform pg_advisory_xact_lock(hashtext('recovery_engine:' || p_employee_id::text));
  v_derived := recovery_derive(p_employee_id, v_as_of);

  select coalesce(array_agg((p ->> 'start_us')::bigint), '{}') into v_starts from jsonb_array_elements(v_derived -> 'periods') p;

  -- Periods that no longer exist as such (the evidence was corrected so they
  -- merged, split or moved). One that already has an approved credit cannot be
  -- restructured silently: the correction is refused and rolled back.
  for v_old in
    select * from recovery_periods
    where employee_id = p_employee_id and status <> 'superseded' and not (recovery_us(started_at) = any (v_starts))
  loop
    if exists (
      select 1 from recovery_credit_requests r join recovery_windows w on w.id = r.recovery_window_id
      where w.period_id = v_old.id and r.status = 'approved'
    ) then
      raise exception 'This change would restructure the working period that started at % and already has an approved Recovery Leave credit. Correct the evidence without moving the period, or review the credit separately.', v_old.started_at;
    end if;
    for v_req in
      select r.id from recovery_credit_requests r join recovery_windows w on w.id = r.recovery_window_id
      where w.period_id = v_old.id and r.status in ('submitted', 'pending_approval')
    loop
      perform recovery_cancel_request(v_req.id, 'Cancelled: the working period was re-derived after the evidence changed.');
    end loop;
    update recovery_alerts set status = 'obsolete' where period_id = v_old.id and status = 'open';
    update recovery_periods
    set status = 'superseded', superseded_at = now(), superseded_reason = coalesce(p_reason, 'Evidence changed; working period re-derived'), updated_at = now()
    where id = v_old.id;
  end loop;

  for v_period in select p from jsonb_array_elements(v_derived -> 'periods') p loop
    v_status := case when (v_period ->> 'ended')::boolean then 'ended' else 'open' end;

    select id into v_period_id from recovery_periods
    where employee_id = p_employee_id and started_at = recovery_ts((v_period ->> 'start_us')::bigint) and status <> 'superseded'
    for update;

    if v_period_id is null then
      insert into recovery_periods (
        employee_id, company_id, country_code, timezone, policy_version_id, rules, started_at, last_work_end_at,
        has_open_session, rest_completes_at, status, ended_at, recorded_seconds, elapsed_seconds
      )
      values (
        p_employee_id, v_emp.company_id, v_period ->> 'country_code', v_period ->> 'timezone',
        (v_period ->> 'policy_version_id')::uuid, v_period -> 'rules',
        recovery_ts((v_period ->> 'start_us')::bigint), recovery_ts((v_period ->> 'last_work_end_us')::bigint),
        (v_period ->> 'has_open')::boolean,
        case when v_period -> 'rest_completes_us' = 'null'::jsonb then null else recovery_ts((v_period ->> 'rest_completes_us')::bigint) end,
        v_status,
        case when v_status = 'ended' then recovery_ts((v_period ->> 'rest_completes_us')::bigint) else null end,
        (v_period ->> 'recorded_us')::numeric / 1000000, (v_period ->> 'elapsed_us')::numeric / 1000000
      )
      returning id into v_period_id;
    else
      update recovery_periods
      set last_work_end_at = recovery_ts((v_period ->> 'last_work_end_us')::bigint),
          has_open_session = (v_period ->> 'has_open')::boolean,
          rest_completes_at = case when v_period -> 'rest_completes_us' = 'null'::jsonb then null else recovery_ts((v_period ->> 'rest_completes_us')::bigint) end,
          status = v_status,
          ended_at = case when v_status = 'ended' then recovery_ts((v_period ->> 'rest_completes_us')::bigint) else null end,
          recorded_seconds = (v_period ->> 'recorded_us')::numeric / 1000000,
          elapsed_seconds = (v_period ->> 'elapsed_us')::numeric / 1000000,
          updated_at = now()
      where id = v_period_id
        and (last_work_end_at, has_open_session, rest_completes_at, status, recorded_seconds, elapsed_seconds) is distinct from (
          recovery_ts((v_period ->> 'last_work_end_us')::bigint), (v_period ->> 'has_open')::boolean,
          case when v_period -> 'rest_completes_us' = 'null'::jsonb then null else recovery_ts((v_period ->> 'rest_completes_us')::bigint) end,
          v_status, (v_period ->> 'recorded_us')::numeric / 1000000, (v_period ->> 'elapsed_us')::numeric / 1000000
        );
    end if;

    v_indexes := '{}';
    for v_win in select w from jsonb_array_elements(v_period -> 'windows') w loop
      v_indexes := v_indexes || (v_win ->> 'index')::int;
      v_new_rec := (v_win ->> 'recorded_us')::numeric / 1000000;
      v_new_ent := (v_win ->> 'entitlement_days')::numeric;
      v_new_band := v_win ->> 'band';
      v_new_class := v_win ->> 'classification';
      v_new_date := (v_win ->> 'starting_local_date')::date;
      v_new_closed := (v_win ->> 'closed')::boolean;
      v_new_verif := (v_win ->> 'hr_verification_required')::boolean;
      select coalesce(array_agg(f order by f), '{}') into v_new_flags from jsonb_array_elements_text(v_win -> 'review_flags') f;
      v_sig := md5((v_win -> 'allocations')::text);

      select * into v_w from recovery_windows where period_id = v_period_id and window_index = (v_win ->> 'index')::int for update;
      v_found := found;

      if not v_found then
        v_rev_no := case when v_new_closed then 1 else 0 end;
        insert into recovery_windows (
          period_id, employee_id, company_id, window_index, window_start, window_end, recorded_seconds, status, closed_at, closed_reason,
          starting_local_date, country_code, timezone, classification, holiday_name, policy_version_id, entitlement_days, band,
          review_flags, hr_verification_required, revision_no, allocation_signature
        )
        values (
          v_period_id, p_employee_id, v_emp.company_id, (v_win ->> 'index')::int,
          recovery_ts((v_win ->> 'start_us')::bigint), recovery_ts((v_win ->> 'end_us')::bigint), v_new_rec,
          case when v_new_closed then 'closed' else 'open' end,
          case when v_new_closed then recovery_ts((v_win ->> 'closed_at_us')::bigint) else null end,
          v_win ->> 'closed_reason',
          v_new_date, v_period ->> 'country_code', v_period ->> 'timezone', v_new_class, v_win ->> 'holiday_name',
          (v_period ->> 'policy_version_id')::uuid, v_new_ent, v_new_band, v_new_flags, v_new_verif, v_rev_no, v_sig
        )
        returning id into v_window_id;
        if v_new_closed then
          insert into recovery_window_revisions (window_id, revision_no, recorded_seconds, entitlement_days, classification, starting_local_date, review_flags, reason, actor_id, origin)
          values (v_window_id, 1, v_new_rec, v_new_ent, v_new_class, v_new_date, v_new_flags, coalesce(p_reason, 'Window closed'), v_actor, p_origin);
        end if;
      else
        v_window_id := v_w.id;
        v_facts_changed := v_w.recorded_seconds is distinct from v_new_rec
          or v_w.entitlement_days is distinct from v_new_ent
          or v_w.classification is distinct from v_new_class
          or v_w.starting_local_date is distinct from v_new_date
          or v_w.review_flags is distinct from v_new_flags;
        v_rev_no := v_w.revision_no;
        v_make_revision := false;

        if v_w.status = 'closed' and not v_new_closed then
          -- Re-opened by a correction. Only possible while nothing is credited.
          if exists (select 1 from recovery_credit_requests r where r.recovery_window_id = v_w.id and r.status = 'approved') then
            raise exception 'This change would re-open a recovery window that already has an approved credit. Correct the evidence without moving the window, or review the credit separately.';
          end if;
          for v_req in select r.id from recovery_credit_requests r where r.recovery_window_id = v_w.id and r.status in ('submitted', 'pending_approval') loop
            perform recovery_cancel_request(v_req.id, 'Cancelled: the recovery window was re-opened by a correction.');
          end loop;
        end if;

        if v_w.status = 'closed' and v_new_closed and v_facts_changed then
          v_make_revision := true;
        elsif v_w.status = 'open' and v_new_closed then
          v_make_revision := true;
        end if;
        if v_make_revision then v_rev_no := v_w.revision_no + 1; end if;

        update recovery_windows
        set recorded_seconds = v_new_rec,
            status = case when v_new_closed then 'closed' else 'open' end,
            closed_at = case when v_new_closed then coalesce(case when v_w.status = 'closed' then v_w.closed_at else null end, recovery_ts((v_win ->> 'closed_at_us')::bigint)) else null end,
            closed_reason = case when v_new_closed then coalesce(case when v_w.status = 'closed' then v_w.closed_reason else null end, v_win ->> 'closed_reason') else null end,
            starting_local_date = v_new_date, classification = v_new_class, holiday_name = v_win ->> 'holiday_name',
            entitlement_days = v_new_ent, band = v_new_band,
            review_flags = v_new_flags, hr_verification_required = v_new_verif,
            -- A change to a window HR had already verified needs verifying again.
            hr_verified_by = case when v_make_revision and v_w.status = 'closed' then null else hr_verified_by end,
            hr_verified_at = case when v_make_revision and v_w.status = 'closed' then null else hr_verified_at end,
            hr_verification_note = case when v_make_revision and v_w.status = 'closed' then null else hr_verification_note end,
            revision_no = v_rev_no, allocation_signature = v_sig, updated_at = now()
        where id = v_w.id
          and (recorded_seconds, status, entitlement_days, classification, starting_local_date, review_flags, hr_verification_required, allocation_signature, revision_no, closed_at)
              is distinct from (v_new_rec, case when v_new_closed then 'closed' else 'open' end, v_new_ent, v_new_class, v_new_date, v_new_flags, v_new_verif, v_sig, v_rev_no,
                                case when v_new_closed then coalesce(case when v_w.status = 'closed' then v_w.closed_at else null end, recovery_ts((v_win ->> 'closed_at_us')::bigint)) else null end);

        if v_make_revision then
          v_prev := jsonb_build_object('recorded_seconds', v_w.recorded_seconds, 'entitlement_days', v_w.entitlement_days,
            'classification', v_w.classification, 'starting_local_date', v_w.starting_local_date, 'review_flags', to_jsonb(v_w.review_flags),
            'revision_no', v_w.revision_no);
          v_reason := coalesce(p_reason, case when v_w.status = 'open' then 'Window closed' else 'Recalculated after the evidence changed' end);
          insert into recovery_window_revisions (window_id, revision_no, recorded_seconds, entitlement_days, classification, starting_local_date, review_flags, reason, actor_id, origin, previous_facts)
          values (v_w.id, v_rev_no, v_new_rec, v_new_ent, v_new_class, v_new_date, v_new_flags, v_reason, v_actor, p_origin, v_prev)
          on conflict (window_id, revision_no) do nothing;
        end if;
      end if;

      -- Evidence allocation, rebuilt only when it actually changed.
      if not v_found or v_w.allocation_signature is distinct from v_sig then
        delete from recovery_window_allocations where window_id = v_window_id;
        insert into recovery_window_allocations (window_id, employee_id, session_id, segment_id, work_mode, project_name, project_lead_employee_id, alloc_start, alloc_end, seconds)
        select v_window_id, p_employee_id, (a ->> 'session_id')::uuid, (a ->> 'segment_id')::uuid, a ->> 'work_mode', a ->> 'project_name',
               nullif(a ->> 'project_lead_employee_id', '')::uuid,
               recovery_ts((a ->> 'start_us')::bigint), recovery_ts((a ->> 'end_us')::bigint), (a ->> 'us')::numeric / 1000000
        from jsonb_array_elements(v_win -> 'allocations') a;
      end if;

      if v_new_closed then
        v_created := v_created + recovery_sync_window_requests(v_window_id, v_actor, p_reason, p_origin);
      end if;
    end loop;

    -- Windows that had recorded work before but have none in the corrected
    -- evidence: zero them (keeping the row, its history and any credit trail),
    -- then let the request sync cancel or reduce.
    for v_w in
      select * from recovery_windows
      where period_id = v_period_id and recorded_seconds > 0 and not (window_index = any (v_indexes))
      for update
    loop
      v_rev_no := v_w.revision_no;
      if v_w.status = 'closed' then
        v_rev_no := v_w.revision_no + 1;
        insert into recovery_window_revisions (window_id, revision_no, recorded_seconds, entitlement_days, classification, starting_local_date, review_flags, reason, actor_id, origin, previous_facts)
        values (v_w.id, v_rev_no, 0, 0, v_w.classification, v_w.starting_local_date, '{}', coalesce(p_reason, 'No recorded work remains in this window'), v_actor, p_origin,
                jsonb_build_object('recorded_seconds', v_w.recorded_seconds, 'entitlement_days', v_w.entitlement_days, 'classification', v_w.classification,
                                   'starting_local_date', v_w.starting_local_date, 'review_flags', to_jsonb(v_w.review_flags), 'revision_no', v_w.revision_no))
        on conflict (window_id, revision_no) do nothing;
      end if;
      update recovery_windows
      set recorded_seconds = 0, entitlement_days = 0, band = 'none', review_flags = '{}', hr_verification_required = false,
          hr_verified_by = null, hr_verified_at = null, hr_verification_note = null, revision_no = v_rev_no, allocation_signature = null, updated_at = now()
      where id = v_w.id;
      delete from recovery_window_allocations where window_id = v_w.id;
      if v_w.status = 'closed' then
        v_created := v_created + recovery_sync_window_requests(v_w.id, v_actor, p_reason, p_origin);
      end if;
    end loop;

    -- HR alerts: deduplicated by key, so repeated runs never raise them twice.
    v_alert_keys := '{}';
    if v_period -> 'long_work_trigger_us' <> 'null'::jsonb and (v_period ->> 'long_work_trigger_us')::bigint <= recovery_us(v_as_of) then
      v_alert_keys := v_alert_keys || (v_period_id::text || ':long_work');
      insert into recovery_alerts (company_id, employee_id, period_id, alert_type, dedup_key, triggered_at, period_started_at, recorded_seconds, elapsed_seconds, details)
      values (
        v_emp.company_id, p_employee_id, v_period_id, 'long_work', v_period_id::text || ':long_work',
        recovery_ts((v_period ->> 'long_work_trigger_us')::bigint), recovery_ts((v_period ->> 'start_us')::bigint),
        (v_period ->> 'recorded_us')::numeric / 1000000, (v_period ->> 'elapsed_us')::numeric / 1000000,
        jsonb_build_object(
          'threshold_hours', (v_period -> 'rules' ->> 'alert_work_hours')::numeric,
          'rest_gap_hours', (v_period -> 'rules' ->> 'rest_gap_hours')::numeric,
          'still_open', (v_period ->> 'has_open')::boolean,
          'gaps', v_period -> 'gaps',
          'note', 'Warning only: recording continues and no recovery day is created by this alert.'
        )
      )
      on conflict (dedup_key) do nothing;
    end if;
    for v_alert in select a from jsonb_array_elements(v_period -> 'rollovers') a loop
      v_alert_keys := v_alert_keys || (v_period_id::text || ':rollover:' || (v_alert ->> 'window_index'));
      insert into recovery_alerts (company_id, employee_id, period_id, alert_type, dedup_key, triggered_at, period_started_at, recorded_seconds, elapsed_seconds, details)
      values (
        v_emp.company_id, p_employee_id, v_period_id, 'window_rollover', v_period_id::text || ':rollover:' || (v_alert ->> 'window_index'),
        recovery_ts((v_alert ->> 'at_us')::bigint), recovery_ts((v_period ->> 'start_us')::bigint),
        (v_alert ->> 'recorded_us')::numeric / 1000000, (v_alert ->> 'elapsed_us')::numeric / 1000000,
        jsonb_build_object(
          'window_index', (v_alert ->> 'window_index')::int,
          'window_hours', (v_period -> 'rules' ->> 'window_hours')::numeric,
          'note', 'The 24 elapsed-hour window rolled over automatically with no completed rest. Elapsed hours are not recorded hours; no manual clock-out was made.'
        )
      )
      on conflict (dedup_key) do nothing;
    end loop;
    update recovery_alerts set status = 'obsolete'
    where period_id = v_period_id and status = 'open' and not (dedup_key = any (v_alert_keys));
  end loop;

  -- Routing that failed earlier (no approver yet) is retried on every pass.
  for v_req in
    select r.id from recovery_credit_requests r
    where r.employee_id = p_employee_id and r.recovery_window_id is not null and r.status = 'submitted'
      and r.applicant_route is not null and r.routing_issue is not null
      and not exists (select 1 from approvals a where a.entity_type = 'recovery_credit' and a.entity_id = r.id and a.step_order = 1)
  loop
    perform recovery_route_request(v_req.id);
  end loop;

  update recovery_processor_failures set resolved_at = now() where employee_id = p_employee_id and resolved_at is null;

  return jsonb_build_object('periods', jsonb_array_length(v_derived -> 'periods'), 'requests_created', v_created, 'as_of', v_as_of);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Readiness (enforced HERE, in the database, not just in the UI) and
--    ledger posting for window requests
-- ---------------------------------------------------------------------

-- NULL when a window-based request may be finally approved right now;
-- otherwise the plain-English reason it may not. Legacy requests: always NULL.
create or replace function recovery_request_blocker(p_request_id uuid)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  r recovery_credit_requests%rowtype;
  w recovery_windows%rowtype;
  v_credited numeric;
  v_expected numeric;
  v_balance numeric;
begin
  select * into r from recovery_credit_requests where id = p_request_id;
  if not found then return 'Recovery credit request not found.'; end if;
  if r.event_type not in ('window', 'window_top_up', 'window_reduction') then return null; end if;

  select * into w from recovery_windows where id = r.recovery_window_id;
  if not found then return 'The recovery window for this request no longer exists.'; end if;
  if w.status <> 'closed' then
    return 'This recovery window has not closed yet. A credit can only be approved for a closed window.';
  end if;
  if exists (select 1 from recovery_periods p where p.id = w.period_id and p.status = 'superseded') then
    return 'The working period for this request was re-derived after a correction; this request is stale.';
  end if;

  v_credited := recovery_window_credited_days(w.id);
  if r.event_type = 'window' then
    v_expected := w.entitlement_days;
  elsif r.event_type = 'window_top_up' then
    v_expected := w.entitlement_days - v_credited;
  else
    v_expected := v_credited - w.entitlement_days;
  end if;
  if r.proposed_days is distinct from v_expected or v_expected <= 0 then
    return 'The evidence for this window changed after the request was created, so its amount is out of date. It is being recalculated; try again shortly.';
  end if;
  if r.window_revision_no is distinct from w.revision_no then
    return 'The window was recalculated after this request was created. Wait for the request to be refreshed.';
  end if;

  if w.hr_verification_required and w.hr_verified_at is null then
    return 'HR must verify this window before it can be approved (reason: ' || array_to_string(w.review_flags, ', ') || ').';
  end if;

  if r.event_type = 'window_reduction' then
    select coalesce(sum(days), 0) into v_balance from comp_day_ledger where employee_id = r.employee_id;
    if v_balance - r.proposed_days < 0 and r.consumption_ack_at is null then
      return 'Part of this credit has already been used. HR must explicitly acknowledge the reduction before it is applied (it would otherwise leave a negative balance).';
    end if;
  end if;
  return null;
end;
$$;

-- Posts the ledger effect of a finally-approved window request. Called from
-- decide_leave_approval() inside the same transaction and the same advisory
-- lock; repeat-safe (a second call posts nothing). Expiry always counts from
-- the window's own date: a top-up never extends it, and a reduction keeps the
-- original entry's dates. Nothing here touches Annual Leave or payroll.
create or replace function recovery_post_window_ledger(p_request_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r recovery_credit_requests%rowtype;
  v_period_rules jsonb;
  v_expiry_days int;
  v_ledger_id uuid;
  v_orig_ledger comp_day_ledger%rowtype;
  v_row record;
  v_remaining numeric;
  v_keep numeric;
begin
  select * into r from recovery_credit_requests where id = p_request_id for update;
  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || r.employee_id::text));

  select p.rules into v_period_rules
  from recovery_windows w join recovery_periods p on p.id = w.period_id where w.id = r.recovery_window_id;
  v_expiry_days := coalesce((v_period_rules ->> 'expiry_days')::int, 180);

  if r.event_type = 'window' then
    select cl.id into v_ledger_id from comp_day_ledger cl
    where cl.reference_type = 'recovery_credit_request' and cl.reference_id = r.id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger x where x.reversal_of_id = cl.id);
    if v_ledger_id is null then
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
      values (r.employee_id, r.work_date, 'earned', r.proposed_days, 'recovery_window', r.work_date + v_expiry_days, 'recovery_credit_request', r.id, p_actor)
      returning id into v_ledger_id;
    end if;

  elsif r.event_type = 'window_top_up' then
    select cl.id into v_ledger_id from comp_day_ledger cl
    where cl.reference_type = 'recovery_credit_request' and cl.reference_id = r.id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger x where x.reversal_of_id = cl.id);
    if v_ledger_id is null then
      select cl.* into v_orig_ledger from comp_day_ledger cl
      where cl.reference_type = 'recovery_credit_request' and cl.reference_id = r.adjusts_request_id and cl.entry_type = 'earned'
      order by cl.created_at asc limit 1;
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
      values (
        r.employee_id,
        coalesce(v_orig_ledger.txn_date, r.work_date),
        'earned', r.proposed_days, 'recovery_window_top_up',
        coalesce(v_orig_ledger.expiry_date, r.work_date + v_expiry_days),
        'recovery_credit_request', r.id, p_actor
      )
      returning id into v_ledger_id;
    end if;

  else
    -- Reduction: unwind earned entries for this window newest first, fully
    -- reversing each (never deleting) and re-earning the remainder of the last
    -- one touched, with its original dates, so expiry is preserved.
    v_remaining := r.proposed_days;
    for v_row in
      select cl.*
      from comp_day_ledger cl
      join recovery_credit_requests q on cl.reference_type = 'recovery_credit_request' and cl.reference_id = q.id
      where q.recovery_window_id = r.recovery_window_id and cl.entry_type = 'earned'
        and not exists (select 1 from comp_day_ledger x where x.reversal_of_id = cl.id)
      order by cl.created_at desc, cl.id desc
    loop
      exit when v_remaining <= 0;
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
      values (v_row.employee_id, current_date, 'reversal', -v_row.days, 'recovery_window_reduction', v_row.reference_type, v_row.reference_id, v_row.id, p_actor)
      returning id into v_ledger_id;
      if v_row.days > v_remaining then
        v_keep := v_row.days - v_remaining;
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
        values (v_row.employee_id, v_row.txn_date, 'earned', v_keep, v_row.source, v_row.expiry_date, v_row.reference_type, v_row.reference_id, p_actor);
        v_remaining := 0;
      else
        v_remaining := v_remaining - v_row.days;
      end if;
    end loop;
  end if;

  update recovery_credit_requests
  set status = 'approved', decided_at = now(), comp_day_ledger_id = coalesce(v_ledger_id, comp_day_ledger_id)
  where id = r.id;
  return v_ledger_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Lifecycle wiring: triggers so EVERY path that changes evidence (clock
--    in/out, mode switch, HR closure, HR correction, add-missing) runs the
--    same engine. A failure here is recorded for the processor to retry and
--    never fails the employee's own clock action.
-- ---------------------------------------------------------------------

-- Fixes each session's calculation model at insert. The value is always
-- derived here — an inserted value is ignored, so it cannot be spoofed.
create or replace function recovery_session_assign_model()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
begin
  select country_code into v_country from employees where id = new.employee_id;
  if v_country is not null and exists (
    select 1 from recovery_windows_policy_for(v_country, (new.clock_in_at at time zone country_timezone(v_country))::date)
  ) then
    new.recovery_model := 'windowed';
  else
    new.recovery_model := 'legacy';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_sessions_assign_recovery_model on attendance_sessions;
create trigger attendance_sessions_assign_recovery_model
  before insert on attendance_sessions
  for each row execute function recovery_session_assign_model();

-- A recorded session may never end in the future, and a recording never
-- overlaps another recording of the same employee. Applies to sessions on the
-- window model only: legacy sessions keep exactly the behaviour they had.
create or replace function guard_attendance_session_timing()
returns trigger
language plpgsql
as $$
begin
  if new.recovery_model <> 'windowed' then
    return new;
  end if;
  if new.clock_out_at is not null and new.clock_out_at > recovery_now() + interval '1 minute' then
    raise exception 'A clock-out time cannot be in the future.';
  end if;
  if new.clock_in_at > recovery_now() + interval '1 minute' then
    raise exception 'A clock-in time cannot be in the future.';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_sessions_guard_timing on attendance_sessions;
create trigger attendance_sessions_guard_timing
  before insert or update of clock_in_at, clock_out_at on attendance_sessions
  for each row execute function guard_attendance_session_timing();

create or replace function guard_attendance_segment_overlap()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from attendance_sessions ses where ses.id = new.session_id and ses.recovery_model = 'windowed') then
    return new;
  end if;
  if exists (
    select 1 from attendance_segments s
    where s.employee_id = new.employee_id and s.id <> new.id
      and tstzrange(s.segment_start, coalesce(s.segment_end, 'infinity'::timestamptz), '[)')
          && tstzrange(new.segment_start, coalesce(new.segment_end, 'infinity'::timestamptz), '[)')
  ) then
    raise exception 'This recording overlaps another recorded work segment for the same employee. Overlapping evidence is never merged automatically; review it first.';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_segments_guard_overlap on attendance_segments;
create trigger attendance_segments_guard_overlap
  before insert or update of segment_start, segment_end on attendance_segments
  for each row execute function guard_attendance_segment_overlap();

create or replace function recovery_on_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid := new.employee_id;
begin
  -- HR correction functions set this so they can run the engine ONCE, after
  -- all their edits, with the correction reason and actor attached.
  if coalesce(current_setting('recovery.defer', true), '') = 'on' then
    return null;
  end if;
  begin
    perform recovery_recalculate_employee(v_employee_id, null, 'engine');
  exception when others then
    insert into recovery_processor_failures (employee_id, error) values (v_employee_id, sqlerrm);
  end;
  return null;
end;
$$;

drop trigger if exists attendance_segments_recovery_engine on attendance_segments;
create trigger attendance_segments_recovery_engine
  after insert or update on attendance_segments
  for each row execute function recovery_on_attendance_change();

drop trigger if exists attendance_sessions_recovery_engine on attendance_sessions;
create trigger attendance_sessions_recovery_engine
  after update on attendance_sessions
  for each row
  when (old.status is distinct from new.status or old.clock_out_at is distinct from new.clock_out_at or old.hr_closed_at is distinct from new.hr_closed_at)
  execute function recovery_on_attendance_change();

-- ---------------------------------------------------------------------
-- 9. HR actions: verify a window, acknowledge an alert / a reduction,
--    correct or add attendance evidence
-- ---------------------------------------------------------------------

create or replace function hr_verify_recovery_window(p_window_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w recovery_windows%rowtype;
begin
  select * into w from recovery_windows where id = p_window_id for update;
  if not found then raise exception 'Recovery window not found.'; end if;
  if not has_role('hr_admin', w.company_id) then
    raise exception 'Only HR Admin may verify a recovery window.';
  end if;
  if w.status <> 'closed' then
    raise exception 'Only a closed recovery window can be verified.';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'Describe what you checked (for example the person you confirmed the work with) when verifying a window.';
  end if;
  update recovery_windows
  set hr_verified_by = auth.uid(), hr_verified_at = now(), hr_verification_note = p_note, updated_at = now()
  where id = p_window_id;
end;
$$;

create or replace function hr_acknowledge_recovery_reduction(p_request_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r recovery_credit_requests%rowtype;
  v_company uuid;
begin
  select * into r from recovery_credit_requests where id = p_request_id for update;
  if not found or r.event_type <> 'window_reduction' then raise exception 'Reduction request not found.'; end if;
  select company_id into v_company from employees where id = r.employee_id;
  if not has_role('hr_admin', v_company) then raise exception 'Only HR Admin may acknowledge a reduction.'; end if;
  if r.status not in ('submitted', 'pending_approval') then raise exception 'This reduction has already been decided.'; end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'A note is required: explain how the already-used balance will be handled.';
  end if;
  update recovery_credit_requests
  set consumption_ack_by = auth.uid(), consumption_ack_at = now(), consumption_ack_note = p_note
  where id = p_request_id;
end;
$$;

create or replace function acknowledge_recovery_alert(p_alert_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a recovery_alerts%rowtype;
begin
  select * into a from recovery_alerts where id = p_alert_id for update;
  if not found then raise exception 'Alert not found.'; end if;
  if not has_role('hr_admin', a.company_id) then raise exception 'Only HR Admin may acknowledge this alert.'; end if;
  if a.status <> 'open' then raise exception 'This alert is no longer open.'; end if;
  update recovery_alerts
  set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now(), acknowledgement_note = nullif(trim(p_note), '')
  where id = p_alert_id;
end;
$$;

create or replace function get_recovery_request_blocker(p_request_id uuid)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_lead uuid;
begin
  select employee_id, project_lead_employee_id into v_employee, v_lead from recovery_credit_requests where id = p_request_id;
  if v_employee is null then return null; end if;
  if not (can_view_recovery_evidence(v_employee) or v_lead = current_employee_id()
          or exists (select 1 from approvals a where a.entity_type = 'recovery_credit' and a.entity_id = p_request_id and a.approver_id = auth.uid())) then
    return null;
  end if;
  return recovery_request_blocker(p_request_id);
end;
$$;

-- HR corrects the recorded start/end of a CLOSED session. The original and the
-- corrected values are both kept (attendance_session_corrections), the reason
-- is mandatory, a future clock-out and overlapping recordings are refused, and
-- the engine then recomputes periods, windows, alerts, classification and any
-- affected requests in the same transaction. A correction that would move a
-- working period that already has an approved credit is refused.
create or replace function hr_correct_attendance_session(
  p_session_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s attendance_sessions%rowtype;
  v_company uuid;
  v_country text;
  v_tz text;
  v_first attendance_segments%rowtype;
  v_last attendance_segments%rowtype;
  v_date date;
  v_dates date[] := '{}';
begin
  select * into s from attendance_sessions where id = p_session_id for update;
  if not found then raise exception 'Attendance session not found.'; end if;
  select company_id, country_code into v_company, v_country from employees where id = s.employee_id;
  if not has_role('hr_admin', v_company) then raise exception 'Only HR Admin may correct attendance.'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'A reason is required to correct attendance.'; end if;
  if s.status <> 'closed' then
    raise exception 'Only a closed session can be corrected here. Use "close missing clock-out" for a session that is still open.';
  end if;
  if s.recovery_model <> 'windowed' then
    raise exception 'This session was recorded under the previous Recovery Leave calculation and keeps it. It cannot be edited with the window-based tools.';
  end if;
  if p_clock_in_at is null or p_clock_out_at is null or p_clock_out_at <= p_clock_in_at then
    raise exception 'The corrected clock-out must be after the corrected clock-in.';
  end if;
  if p_clock_out_at > recovery_now() then raise exception 'A clock-out time cannot be in the future.'; end if;

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || s.employee_id::text));
  v_tz := country_timezone(v_country);

  select * into v_first from attendance_segments where session_id = s.id order by segment_start asc, id asc limit 1 for update;
  select * into v_last from attendance_segments where session_id = s.id order by segment_start desc, id desc limit 1 for update;
  if v_first.id is null then raise exception 'This session has no recorded work segment.'; end if;
  if v_first.id = v_last.id then
    if p_clock_in_at >= p_clock_out_at then raise exception 'The corrected clock-out must be after the corrected clock-in.'; end if;
  else
    if p_clock_in_at >= v_first.segment_end then raise exception 'The corrected clock-in must be before the first mode segment ends (%).', v_first.segment_end; end if;
    if p_clock_out_at <= v_last.segment_start then raise exception 'The corrected clock-out must be after the last mode segment starts (%).', v_last.segment_start; end if;
  end if;

  select coalesce(array_agg(distinct (t at time zone v_tz)::date), '{}') into v_dates
  from (select segment_start t from attendance_segments where session_id = s.id) x;

  perform set_config('recovery.defer', 'on', true);
  insert into attendance_session_corrections (session_id, employee_id, kind, original_clock_in_at, original_clock_out_at, corrected_clock_in_at, corrected_clock_out_at, reason, actor_id)
  values (s.id, s.employee_id, 'correct_times', s.clock_in_at, s.clock_out_at, p_clock_in_at, p_clock_out_at, p_reason, auth.uid());

  if v_first.id = v_last.id then
    update attendance_segments set segment_start = p_clock_in_at, segment_end = p_clock_out_at where id = v_first.id;
  else
    update attendance_segments set segment_start = p_clock_in_at where id = v_first.id;
    update attendance_segments set segment_end = p_clock_out_at where id = v_last.id;
  end if;
  update attendance_sessions set clock_in_at = p_clock_in_at, clock_out_at = p_clock_out_at where id = s.id;
  perform set_config('recovery.defer', 'off', true);

  select coalesce(array_agg(distinct d), '{}') into v_dates
  from (
    select unnest(v_dates) d
    union
    select (segment_start at time zone v_tz)::date from attendance_segments where session_id = s.id
  ) y;
  foreach v_date in array v_dates loop
    perform sync_attendance_presence_for_day(s.employee_id, v_date);
  end loop;

  perform recovery_recalculate_employee(s.employee_id, null, 'hr_correction', p_reason, auth.uid());
end;
$$;

-- "Add missing attendance": HR records a past shift the employee never
-- clocked. It is stored as a normal closed session flagged recorded_by_hr (so
-- it can never look like a live Clocked-in state), with an explicit reason, and
-- goes through exactly the same calculation as any other evidence.
create or replace function hr_add_missing_attendance(
  p_employee_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
  p_work_mode text,
  p_project_name text,
  p_project_lead_employee_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_country text;
  v_tz text;
  v_session_id uuid;
  v_segment_id uuid;
  v_date date;
  v_model text;
begin
  select company_id, country_code into v_company, v_country from employees where id = p_employee_id and deleted_at is null;
  if v_company is null then raise exception 'Employee not found.'; end if;
  if not has_role('hr_admin', v_company) then raise exception 'Only HR Admin may add missing attendance.'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'A reason is required to add missing attendance.'; end if;
  if p_work_mode not in ('office', 'wfh', 'site_work', 'client_meeting', 'business_travel') then
    raise exception 'Invalid work mode: %', p_work_mode;
  end if;
  if p_work_mode = 'site_work' and (p_project_name is null or length(trim(p_project_name)) = 0 or p_project_lead_employee_id is null) then
    raise exception 'Site work / Installation requires a project name and a project lead.';
  end if;
  if p_project_lead_employee_id is not null and not exists (
    select 1 from employees e where e.id = p_project_lead_employee_id and e.company_id = v_company and e.employment_status = 'active' and e.deleted_at is null
  ) then
    raise exception 'The project lead must be a currently active employee of the same company.';
  end if;
  if p_clock_in_at is null or p_clock_out_at is null or p_clock_out_at <= p_clock_in_at then
    raise exception 'The clock-out must be after the clock-in.';
  end if;
  if p_clock_out_at > recovery_now() then raise exception 'A clock-out time cannot be in the future.'; end if;

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || p_employee_id::text));
  v_tz := country_timezone(v_country);

  perform set_config('recovery.defer', 'on', true);
  insert into attendance_sessions (employee_id, clock_in_at, clock_out_at, status, recorded_by_hr, recorded_by_hr_by, recorded_by_hr_at, recorded_by_hr_reason)
  values (p_employee_id, p_clock_in_at, p_clock_out_at, 'closed', true, auth.uid(), now(), p_reason)
  returning id, recovery_model into v_session_id, v_model;
  insert into attendance_segments (session_id, employee_id, work_mode, project_name, project_lead_employee_id, segment_start, segment_end)
  values (v_session_id, p_employee_id, p_work_mode, nullif(trim(p_project_name), ''), p_project_lead_employee_id, p_clock_in_at, p_clock_out_at)
  returning id into v_segment_id;
  insert into attendance_session_corrections (session_id, employee_id, kind, original_clock_in_at, original_clock_out_at, corrected_clock_in_at, corrected_clock_out_at, reason, actor_id)
  values (v_session_id, p_employee_id, 'add_missing', null, null, p_clock_in_at, p_clock_out_at, p_reason, auth.uid());
  perform set_config('recovery.defer', 'off', true);

  v_date := (p_clock_in_at at time zone v_tz)::date;
  perform sync_attendance_presence_for_day(p_employee_id, v_date);
  if v_model = 'windowed' then
    perform recovery_recalculate_employee(p_employee_id, null, 'hr_correction', p_reason, auth.uid());
  else
    perform sync_attendance_recovery_for_day(p_employee_id, v_date);
  end if;
  return v_session_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Background processor and its status
-- ---------------------------------------------------------------------

-- Catches up every employee with an open working period (or a recorded
-- failure, or routing waiting for an approver): closes windows whose 24 elapsed
-- hours have passed, creates requests, raises HR alerts, and retries earlier
-- failures. Each employee runs in its own sub-transaction so one failure never
-- blocks the rest; failures are recorded and visible. Idempotent — a delayed or
-- repeated run only ever finishes unfinished work, deriving every boundary
-- passed since the last run from the evidence itself.
--
-- Not callable by signed-in users (see grants below): pg_cron (owner-enabled)
-- and the protected Vercel route (service role) are the only callers. It acts
-- under no HR identity — audit rows it causes carry origin = 'processor'.
create or replace function recovery_process_due(p_origin text default 'manual', p_as_of timestamptz default null, p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, recovery_now());
  v_run uuid;
  v_emp uuid;
  v_examined int := 0;
  v_failed int := 0;
  v_first_error text;
  v_status text;
begin
  if not pg_try_advisory_xact_lock(hashtext('recovery_processor')) then
    return jsonb_build_object('status', 'skipped_already_running');
  end if;
  perform set_config('app.audit_origin', 'processor', true);

  insert into recovery_processor_runs (origin, as_of, started_at) values (p_origin, v_as_of, recovery_now()) returning id into v_run;

  for v_emp in
    select distinct c.employee_id from (
      select employee_id from recovery_periods where status = 'open'
      union
      select employee_id from attendance_sessions where status = 'open' and recovery_model = 'windowed'
      union
      select employee_id from recovery_processor_failures where resolved_at is null
      union
      select employee_id from recovery_credit_requests
      where recovery_window_id is not null and status = 'submitted' and routing_issue is not null
    ) c
    limit p_limit
  loop
    v_examined := v_examined + 1;
    begin
      perform recovery_recalculate_employee(v_emp, v_as_of, 'processor');
    exception when others then
      v_failed := v_failed + 1;
      v_first_error := coalesce(v_first_error, sqlerrm);
      insert into recovery_processor_failures (run_id, employee_id, error) values (v_run, v_emp, sqlerrm);
    end;
  end loop;

  v_status := case when v_failed = 0 then 'succeeded' when v_failed < v_examined then 'partial' else 'failed' end;
  update recovery_processor_runs
  set finished_at = recovery_now(), status = v_status, employees_examined = v_examined, employees_failed = v_failed, error_summary = v_first_error
  where id = v_run;

  return jsonb_build_object('status', v_status, 'run_id', v_run, 'examined', v_examined, 'failed', v_failed, 'as_of', v_as_of);
end;
$$;

-- Read-only health of the background processing, for the HR alerts page and
-- the owner's deployment checks. Reports what is actually true: when it last
-- succeeded, whether anything is waiting, and whether pg_cron has a job.
create or replace function recovery_scheduler_status()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_last record;
  v_last_ok timestamptz;
  v_waiting int;
  v_failures int;
  v_cron_installed boolean := to_regclass('cron.job') is not null;
  v_job jsonb := null;
  v_windowed_active boolean;
begin
  if not (has_role_any_scope('hr_admin') or has_role_any_scope('sys_admin')) then
    raise exception 'Only HR Admin or Sys Admin may read the Recovery Leave processor status.';
  end if;
  select * into v_last from recovery_processor_runs order by started_at desc limit 1;
  select max(finished_at) into v_last_ok from recovery_processor_runs where status in ('succeeded', 'partial');
  select count(*) into v_waiting from recovery_periods where status = 'open';
  select count(*) into v_failures from recovery_processor_failures where resolved_at is null;
  select exists (select 1 from policy_versions where policy_type = 'overtime_rules' and status = 'active' and payload ->> 'model' = 'recovery_windows') into v_windowed_active;
  if v_cron_installed then
    execute $q$select to_jsonb(j) from (select jobid, jobname, schedule, active from cron.job where jobname = 'recovery-window-processor') j$q$ into v_job;
  end if;
  return jsonb_build_object(
    'windows_policy_active', v_windowed_active,
    'open_periods', v_waiting,
    'open_failures', v_failures,
    'last_run', case when v_last.id is null then null else jsonb_build_object('started_at', v_last.started_at, 'finished_at', v_last.finished_at, 'status', v_last.status, 'origin', v_last.origin, 'employees_examined', v_last.employees_examined, 'employees_failed', v_last.employees_failed) end,
    'last_success_at', v_last_ok,
    'seconds_since_last_success', case when v_last_ok is null then null else extract(epoch from (recovery_now() - v_last_ok)) end,
    'stale', v_windowed_active and v_waiting > 0 and (v_last_ok is null or recovery_now() - v_last_ok > interval '20 minutes'),
    'pg_cron_installed', v_cron_installed,
    'pg_cron_job', v_job,
    'expected_interval_minutes', 5
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Read models used by the HR register and the dashboard
-- ---------------------------------------------------------------------

-- The automatic, read-first daily register. SECURITY INVOKER on purpose: the
-- caller's own row-level security decides which employees and sessions they
-- see. Clock state comes from actual sessions; attendance presence stays
-- separate (a person stays Present after clocking out); nothing infers an
-- absence — an employee with no evidence is "not started / not recorded".
create or replace function attendance_register_for_date(p_company_id uuid, p_date date)
returns table (
  employee_id uuid,
  employee_name text,
  country_code text,
  timezone text,
  clock_status text,
  attendance_status text,
  attendance_source text,
  work_modes text[],
  first_clock_in timestamptz,
  last_clock_out timestamptz,
  recorded_seconds numeric,
  is_provisional boolean,
  open_since timestamptz,
  session_count int,
  recovery_summary text,
  review_flags text[],
  open_alert_count int,
  presence_conflict text,
  on_leave boolean,
  hr_recorded boolean,
  manual_hours numeric
)
language sql stable
set search_path = public
as $$
  with emps as (
    select e.id, trim(e.first_name || ' ' || e.last_name) as name, e.country_code as cc, country_timezone(e.country_code) as tz
    from employees e
    where e.company_id = p_company_id and e.deleted_at is null and e.employment_status <> 'terminated'
  ),
  seg as (
    select e.id as emp, s.work_mode, s.segment_start, s.segment_end, ses.id as session_id, ses.clock_in_at, ses.clock_out_at, ses.status as session_status, ses.recorded_by_hr
    from emps e
    join attendance_segments s on s.employee_id = e.id
    join attendance_sessions ses on ses.id = s.session_id
    where (s.segment_start at time zone e.tz)::date = p_date
  ),
  agg as (
    select emp,
      array_agg(distinct work_mode) as modes,
      min(segment_start) as first_in,
      case when bool_or(segment_end is null) then null else max(segment_end) end as last_out,
      sum(extract(epoch from (coalesce(segment_end, recovery_now()) - segment_start))) as secs,
      bool_or(segment_end is null) as provisional,
      count(distinct session_id)::int as sessions,
      bool_or(recorded_by_hr) as hr_rec
    from seg group by emp
  ),
  opn as (
    select ses.employee_id as emp, min(ses.clock_in_at) as since
    from attendance_sessions ses
    join emps e on e.id = ses.employee_id
    where ses.status = 'open' and (ses.clock_in_at at time zone e.tz)::date <= p_date
      and p_date <= (recovery_now() at time zone e.tz)::date
    group by ses.employee_id
  ),
  win as (
    select w.employee_id as emp,
      array_agg(distinct f) filter (where f is not null) as flags,
      bool_or(w.hr_verification_required and w.hr_verified_at is null) as needs_verification,
      bool_or(w.status = 'open' and w.recorded_seconds > 0) as has_open,
      bool_or(r.status = 'approved') as has_approved,
      bool_or(r.status in ('submitted', 'pending_approval')) as has_pending,
      bool_or(r.routing_issue is not null and r.status = 'submitted') as has_routing_issue,
      bool_or(w.status = 'closed' and w.entitlement_days > 0) as has_earning
    from recovery_windows w
    join emps e on e.id = w.employee_id
    left join lateral unnest(w.review_flags) f on true
    left join recovery_credit_requests r on r.recovery_window_id = w.id and r.event_type = 'window' and r.status not in ('cancelled', 'rejected')
    where w.starting_local_date = p_date
    group by w.employee_id
  ),
  alr as (
    select a.employee_id as emp, count(*)::int as n
    from recovery_alerts a join emps e on e.id = a.employee_id
    where a.status = 'open' and (a.triggered_at at time zone e.tz)::date = p_date
    group by a.employee_id
  ),
  lv as (
    select distinct lr.employee_id as emp
    from leave_requests lr
    where lr.status = 'approved' and lr.deleted_at is null and p_date between lr.start_date and lr.end_date
  )
  select
    e.id,
    e.name,
    e.cc,
    e.tz,
    case when opn.emp is not null then 'clocked_in' when agg.emp is not null then 'clocked_out' else 'not_started' end,
    coalesce(ar.status, case when agg.emp is not null then 'present' else 'not_recorded' end),
    ar.source,
    coalesce(agg.modes, '{}'::text[]),
    agg.first_in,
    agg.last_out,
    coalesce(agg.secs, 0)::numeric,
    coalesce(agg.provisional, false) or opn.emp is not null,
    opn.since,
    coalesce(agg.sessions, 0),
    case
      when win.emp is null then 'none'
      when win.needs_verification or win.has_routing_issue then 'needs_review'
      when win.has_approved then 'approved'
      when win.has_pending then 'awaiting_approval'
      when win.has_open then 'awaiting_closure'
      when win.has_earning then 'awaiting_approval'
      else 'none'
    end,
    coalesce(win.flags, '{}'::text[]),
    coalesce(alr.n, 0),
    ar.presence_conflict,
    (lv.emp is not null),
    coalesce(agg.hr_rec, false),
    ar.hours_worked
  from emps e
  left join agg on agg.emp = e.id
  left join opn on opn.emp = e.id
  left join win on win.emp = e.id
  left join alr on alr.emp = e.id
  left join lv on lv.emp = e.id
  left join attendance_records ar on ar.employee_id = e.id and ar.work_date = p_date
  order by e.name;
$$;

-- The dashboard clock card's data. Read-only; computed live from the evidence
-- (so the hours are right to the second between background runs). Provisional
-- recovery is only ever a STATUS — never an available balance.
create or replace function recovery_live_summary(p_employee_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_now timestamptz := recovery_now();
  v_country text;
  v_tz text;
  v_open attendance_sessions%rowtype;
  v_seg attendance_segments%rowtype;
  v_derived jsonb;
  v_period jsonb;
  v_win jsonb;
  v_status text;
  v_today date;
  v_any_today boolean;
  v_request_status text;
  v_request_id uuid;
begin
  if not can_view_recovery_evidence(p_employee_id) then
    raise exception 'You may not view this employee''s attendance status.';
  end if;
  select country_code into v_country from employees where id = p_employee_id;
  if v_country is null then return jsonb_build_object('linked', false); end if;
  v_tz := country_timezone(v_country);
  v_today := (v_now at time zone v_tz)::date;

  select * into v_open from attendance_sessions where employee_id = p_employee_id and status = 'open' limit 1;
  if v_open.id is not null then
    select * into v_seg from attendance_segments where session_id = v_open.id and segment_end is null limit 1;
    v_status := 'clocked_in';
  else
    select exists (select 1 from attendance_segments s where s.employee_id = p_employee_id and (s.segment_start at time zone v_tz)::date = v_today) into v_any_today;
    v_status := case when v_any_today then 'clocked_out' else 'not_started' end;
  end if;

  v_derived := recovery_derive(p_employee_id, v_now);
  -- The CURRENT period is the latest one that has not completed its rest.
  select p into v_period from jsonb_array_elements(v_derived -> 'periods') p
  where not (p ->> 'ended')::boolean
  order by (p ->> 'start_us')::bigint desc limit 1;

  if v_period is not null then
    select w into v_win from jsonb_array_elements(v_period -> 'windows') w
    order by (w ->> 'index')::int desc limit 1;
    if v_win is not null then
      select r.id, r.status::text into v_request_id, v_request_status
      from recovery_credit_requests r
      join recovery_windows rw on rw.id = r.recovery_window_id
      join recovery_periods rp on rp.id = rw.period_id
      where rp.employee_id = p_employee_id and rp.started_at = recovery_ts((v_period ->> 'start_us')::bigint) and rp.status <> 'superseded'
        and rw.window_index = (v_win ->> 'index')::int and r.event_type = 'window' and r.status not in ('cancelled', 'rejected')
      limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'linked', true,
    'as_of', v_now,
    'timezone', v_tz,
    'country_code', v_country,
    'clock_status', v_status,
    'open_since', v_open.clock_in_at,
    'work_mode', v_seg.work_mode,
    'project_name', v_seg.project_name,
    'windowed', (v_period is not null) or exists (select 1 from attendance_sessions where employee_id = p_employee_id and recovery_model = 'windowed' limit 1),
    'period', case when v_period is null then null else jsonb_build_object(
      'started_at', recovery_ts((v_period ->> 'start_us')::bigint),
      'elapsed_seconds', ((v_period ->> 'last_work_end_us')::bigint - (v_period ->> 'start_us')::bigint) / 1000000.0,
      'recorded_seconds', (v_period ->> 'recorded_us')::numeric / 1000000,
      'rest_completes_at', case when v_period -> 'rest_completes_us' = 'null'::jsonb then null else recovery_ts((v_period ->> 'rest_completes_us')::bigint) end,
      'rollover_count', jsonb_array_length(v_period -> 'rollovers'),
      'long_work_warning', (v_period -> 'long_work_trigger_us' <> 'null'::jsonb) and ((v_period ->> 'long_work_trigger_us')::bigint <= recovery_us(v_now)),
      'alert_work_hours', (v_period -> 'rules' ->> 'alert_work_hours')::numeric,
      'rest_gap_hours', (v_period -> 'rules' ->> 'rest_gap_hours')::numeric
    ) end,
    'window', case when v_win is null then null else jsonb_build_object(
      'index', (v_win ->> 'index')::int,
      'started_at', recovery_ts((v_win ->> 'start_us')::bigint),
      'ends_at', recovery_ts((v_win ->> 'end_us')::bigint),
      'recorded_seconds', (v_win ->> 'recorded_us')::numeric / 1000000,
      'closed', (v_win ->> 'closed')::boolean,
      'classification', v_win ->> 'classification',
      'entitlement_days', (v_win ->> 'entitlement_days')::numeric,
      'review_flags', v_win -> 'review_flags',
      'request_status', v_request_status
    ) end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Audit and privileges
-- ---------------------------------------------------------------------

create trigger audit_recovery_periods_insert after insert on recovery_periods
  for each row execute function write_audit_log();
create trigger audit_recovery_periods_update after update on recovery_periods
  for each row when (old.status is distinct from new.status)
  execute function write_audit_log();
create trigger audit_recovery_windows_insert after insert on recovery_windows
  for each row execute function write_audit_log();
create trigger audit_recovery_windows_update after update on recovery_windows
  for each row when (
    old.status is distinct from new.status or old.entitlement_days is distinct from new.entitlement_days
    or old.revision_no is distinct from new.revision_no or old.hr_verified_at is distinct from new.hr_verified_at
  )
  execute function write_audit_log();
create trigger audit_recovery_alerts after insert or update on recovery_alerts
  for each row execute function write_audit_log();
create trigger audit_attendance_session_corrections after insert on attendance_session_corrections
  for each row execute function write_audit_log();

-- New functions are executable by PUBLIC by default. Internal engine pieces and
-- anything that reasons about OTHER people's roles are for the database itself
-- (and the owner) only.
revoke execute on function
  recovery_derive(uuid, timestamptz),
  recovery_derive_period(uuid, text, text, uuid, jsonb, jsonb, bigint),
  recovery_recalculate_employee(uuid, timestamptz, text, text, uuid),
  recovery_sync_window_requests(uuid, uuid, text, text),
  recovery_route_request(uuid),
  recovery_route_for_employee(uuid, uuid),
  recovery_eligible_approver_exists(uuid, app_role[], uuid),
  recovery_cancel_request(uuid, text),
  recovery_window_credited_days(uuid),
  recovery_request_blocker(uuid),
  recovery_post_window_ledger(uuid, uuid),
  recovery_process_due(text, timestamptz, int),
  user_has_role(uuid, app_role, uuid, text),
  recovery_windows_policy_for(text, date)
from public, anon, authenticated;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function recovery_process_due(text, timestamptz, int) to service_role;
  end if;
end
$grants$;

-- ---------------------------------------------------------------------
-- 13. Replacement bodies for existing functions. Each differs from the
--     deployed version only where marked; behaviour for legacy rows is
--     unchanged.
-- ---------------------------------------------------------------------

create or replace function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role app_role;
  v_actor_roles app_role[];
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_employee_id uuid;
  v_company_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_sensitive_keys constant text[] := array['bank_iban', 'bank_swift', 'bank_name', 'document_number', 'policy_number'];
  v_key text;
begin
  -- A multi-role user (e.g. a Line Manager also granted Finance) must never
  -- be recorded as if they only held one role — every currently-held,
  -- unrevoked role is captured. actor_role is kept alongside for backward
  -- compatibility with anything still reading the single-value column;
  -- it's always the same "most recently granted" choice it always was.
  select array_agg(role order by granted_at desc) into v_actor_roles
  from user_roles where user_id = auth.uid() and revoked_at is null;
  v_actor_role := v_actor_roles[1];

  if v_row ? 'company_id' then
    v_company_id := (v_row ->> 'company_id')::uuid;
  elsif TG_TABLE_NAME = 'companies' then
    v_company_id := (v_row ->> 'id')::uuid;
  elsif v_row ? 'employee_id' then
    select company_id into v_company_id from employees where id = (v_row ->> 'employee_id')::uuid;
  elsif TG_TABLE_NAME = 'employees' then
    v_company_id := (v_row ->> 'company_id')::uuid;
  elsif TG_TABLE_NAME = 'approvals' then
    v_employee_id := case v_row ->> 'entity_type'
      when 'leave_request' then (select employee_id from leave_requests where id = (v_row ->> 'entity_id')::uuid)
      when 'reimbursement_claim' then (select employee_id from reimbursement_claims where id = (v_row ->> 'entity_id')::uuid)
      when 'timesheet' then (select employee_id from timesheets where id = (v_row ->> 'entity_id')::uuid)
      when 'generated_letter' then (select employee_id from generated_letters where id = (v_row ->> 'entity_id')::uuid)
      else null
    end;
    if v_employee_id is not null then
      select company_id into v_company_id from employees where id = v_employee_id;
    elsif v_row ->> 'entity_type' = 'payroll_export_run' then
      select company_id into v_company_id from payroll_export_runs where id = (v_row ->> 'entity_id')::uuid;
    end if;
  end if;

  v_before := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_after := case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(new) else null end;
  foreach v_key in array v_sensitive_keys loop
    if v_before ? v_key then v_before := jsonb_set(v_before, array[v_key], '"[redacted]"'::jsonb); end if;
    if v_after ? v_key then v_after := jsonb_set(v_after, array[v_key], '"[redacted]"'::jsonb); end if;
  end loop;

  insert into audit_log(table_name, record_id, action, actor_id, actor_role, actor_roles, company_id, before_data, after_data, origin)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    lower(TG_OP),
    auth.uid(),
    v_actor_role,
    v_actor_roles,
    v_company_id,
    v_before,
    v_after,
    -- Where the change really came from. Background work and the SQL editor
    -- have no signed-in user (actor_id stays null) and are never attributed to
    -- an HR person.
    coalesce(nullif(current_setting('app.audit_origin', true), ''), case when auth.uid() is null then 'system' else 'user' end)
  );
  return coalesce(new, old);
end;
$$;


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
        where r.id = p_entity_id and (
          r.created_by = auth.uid()
          or has_role('hr_admin', e.company_id)
          -- Window requests are created by the engine (system authority), so the
          -- employee they benefit is also their rightful owner — needed for the
          -- employee to supply a missing project lead.
          or (r.event_type in ('window', 'window_top_up', 'window_reduction') and r.employee_id = current_employee_id())
        )
      );
    else
      return false;
  end case;
end;
$$;


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
  if v_request.event_type in ('window', 'window_top_up', 'window_reduction') then
    raise exception 'A window-based Recovery Leave request is calculated from the attendance evidence and cannot be overridden by typing hours. Correct the attendance evidence (HR attendance edit); the request is recalculated and the change is recorded with the original and corrected values.';
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
  v_windowed boolean;
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
    v_windowed := exists (select 1 from recovery_windows_policy_for(v_country_code, p_work_date));

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
    set status = excluded.status, work_mode = excluded.work_mode, hours_worked = excluded.hours_worked, source = 'manual', presence_conflict = null
    returning id into v_record_id;

    -- The CURRENTLY ACTIVE credit for this record, if any — an 'earned' row
    -- that hasn't itself already been reversed — and any still-active
    -- (non-cancelled/non-rejected) recovery_credit_requests row.
    select cl.* into v_was_credited from comp_day_ledger cl
    where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
    select r.* into v_existing_request from recovery_credit_requests r
    where r.attendance_record_id = v_record_id and r.status not in ('cancelled', 'rejected');

    if v_windowed and v_status = 'present' then
      -- Under the working-period/24-hour-window policy a manual DAILY total can
      -- never prove gaps, rest or window boundaries, so it never creates a
      -- credit by itself. It is flagged for review instead; Recovery Leave
      -- comes from recorded clock evidence (self-clock, or HR "add missing
      -- attendance" with exact times).
      v_needs_review := coalesce(v_hours, 0) > 0;
    elsif v_is_recovery_day and v_status = 'present' then
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
  where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
    and employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date;

  select count(distinct project_lead_employee_id) into v_distinct_site_leads
  from attendance_segments
  where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
    and employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date
    and work_mode = 'site_work';

  v_event_type := case when v_is_recovery_day then 'standard' else 'overnight' end;
  v_hours := case when v_is_recovery_day then v_total_hours else v_overnight_hours end;

  select * into v_existing from recovery_credit_requests
  where employee_id = p_employee_id and work_date = p_work_date and segment_id is not null
    and event_type in ('standard', 'overnight')
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
  where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
    and employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date
    and work_mode = 'site_work'
  order by segment_start asc limit 1;

  if v_anchor_segment_id is null then
    select id, work_mode, project_name, project_lead_employee_id
    into v_anchor_segment_id, v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id
    from attendance_segments
    where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
      and employee_id = p_employee_id and segment_end is not null
      and (segment_start at time zone v_tz)::date = p_work_date
      and project_lead_employee_id is not null
    order by segment_start asc limit 1;
  end if;

  if v_anchor_segment_id is null then
    select id, work_mode, project_name, project_lead_employee_id
    into v_anchor_segment_id, v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id
    from attendance_segments
    where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
      and employee_id = p_employee_id and segment_end is not null
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
  v_blocker text;
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

    -- Window-based requests (working period / 24-elapsed-hour windows): final
    -- approval is refused HERE, in the database, unless the window is closed,
    -- the amount still matches the evidence, and any required HR verification
    -- has happened — a direct call can never skip what the UI shows. Legacy
    -- request types return NULL from the blocker and behave exactly as before.
    v_blocker := recovery_request_blocker(v_recovery_request.id);
    if v_blocker is not null then
      raise exception '%', v_blocker;
    end if;
    if v_recovery_request.event_type in ('window', 'window_top_up', 'window_reduction') then
      perform recovery_post_window_ledger(v_recovery_request.id, coalesce(auth.uid(), v_requester_user_id));
      return;
    end if;

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

commit;
