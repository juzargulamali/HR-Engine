-- Recovery Leave redesign, Stage 1 of 2 -- SAFE, ADDITIVE, DORMANT.
--
-- Product decision (superseding the Project-Manager/HR-owner routing this
-- same migration file previously proposed, which PR #16 never applied to
-- Production and has been reverted outright -- see that PR's own updated
-- description for the full "what changed and why"):
--
--   1. Employees clock in/out in Jibble; HR Engine imports COMPLETED Jibble
--      time entries into attendance_records (import_jibble_time_entry(),
--      below) -- never a project dropdown, never a per-job HR Engine
--      project record. The employee's free-text Jibble note is preserved
--      verbatim as evidence (jibble_time_entries.note), never edited here.
--   2. A potential Recovery Leave credit is detected the SAME way for a
--      Jibble import as for the existing manual attendance register:
--      is_recovery_eligible_day() -- a public holiday, or outside the
--      employee's country's normal working weekdays. Ordinary late office
--      work on a normal working day never auto-qualifies, regardless of
--      hours logged.
--   3. A potential credit goes straight to ONE HR decision -- a
--      company-scoped role queue (any current HR Admin may decide it),
--      never project-manager-then-HR routing and never a single specific
--      assigned person (which is what "role:hr_admin" already means
--      elsewhere in this schema, and deterministically picks the same one
--      HR Admin -- earliest granted_at -- a real reliability gap for
--      exactly this flow, which this design avoids by never resolving to
--      a single person at all). HR checks the work with the relevant
--      project lead OUTSIDE the application first; that lead is never an
--      application approver and needs no role or self-approval handling.
--   4. On the approval screen, HR may correct the work date/hours
--      (adjust_recovery_credit_request()), which server-recomputes the
--      proposed credit from the SAME threshold every recording path uses
--      (recovery_credit_days_for_hours()), and requires a reason whenever
--      it actually changes something. The ORIGINAL Jibble/manual values
--      are never overwritten -- they stay on attendance_records/
--      jibble_time_entries forever, so the approval screen can show
--      original-vs-corrected side by side.
--   5. decide_recovery_credit_request() requires HR to record whom they
--      checked with before an APPROVAL, and posts the actual
--      comp_day_ledger credit EXACTLY ONCE, inside the existing
--      decide_leave_approval() (delegated to, not duplicated).
--   6. Multiple Jibble sessions on one day, and any edit to one of them,
--      are resolved by sync_jibble_attendance_for_day() re-deriving the
--      WHOLE day fresh from every jibble_time_entries row on file for it
--      every time -- never incrementing from just the triggering entry --
--      so repeated syncs, several clock sessions per day, and an edit to
--      one of them can never produce a duplicate or stale credit. A day
--      that is itself a recovery day (weekend/holiday) credits its FULL
--      worked hours even if a shift runs past midnight; otherwise only the
--      AFTER-midnight portion of a shift that extends past midnight is
--      creditable (the exceptional overnight-extension rule) -- the two
--      are mutually exclusive per day, so a shift can never be credited
--      under both at once.
--   7. A Jibble entry edited AFTER its credit was already approved is
--      FLAGGED for HR review (jibble_time_entries.needs_review) -- never
--      silently re-derives or re-posts anything against an
--      already-approved balance.
--
-- SCOPE OF THIS MIGRATION -- purely additive, changes ZERO live routing:
--
--   seed_default_approval_workflows() only ever fires on NEW company
--   creation (`after insert on companies`) -- every EXISTING company's
--   recovery_credit workflow (still direct_manager -> role:hr_admin, since
--   this Production has never run any prior version of this migration
--   either) is completely untouched by this file. New
--   recovery_credit_requests rows for an EXISTING company still route
--   through that OLD 2-step workflow until Stage 2 (a separate, later,
--   manually-applied file -- supabase/manual-sql/
--   recovery_leave_hr_queue_stage2_cutover.sql) VERSIONS it over. Every
--   function touched below (create_initial_approval, decide_leave_approval,
--   record_attendance_and_recovery, record_overnight_recovery_credit) is
--   backward compatible with every EXISTING approvals row: those rows all
--   have a non-null approver_id (this migration only ever loosens that
--   column to nullable, never changes an existing value), so they keep
--   going through the exact same "approver_id must equal auth.uid()" check
--   as before -- the new null-approver_id "role queue" branch in
--   decide_leave_approval() is reachable only by a brand-new step this
--   migration's own code creates, and only for entity_type = 'recovery_credit'
--   (every other approvable entity -- leave_request, reimbursement_claim,
--   timesheet, generated_letter, payroll_export_run -- keeps its existing
--   single-assignee resolve_approver()/resolve_approver_for_company() path
--   completely unchanged; nothing in this migration touches those
--   functions or their approver_type conventions at all).
--
-- Existing pending approvals are never touched: approver_id/workflow_id are
-- captured on the `approvals` row at creation/advancement time, never
-- recomputed -- Stage 2's workflow VERSIONING (not an in-place UPDATE of
-- approval_workflow_steps) is what keeps a request already pending at step
-- 1 the moment of cutover advancing through its ORIGINAL workflow's step 2
-- rule, exactly like Stage 2 explains at its own top.
--
-- Jibble API -- confirmed vs. assumed (see the PR description for the full
-- trace; docs.api.jibble.io itself was unreachable from this environment
-- while this was written): CONFIRMED via multiple independent, mutually
-- corroborating secondary sources (Nexla's own connector docs, the
-- published jibble-sdk npm package, a Microsoft Power BI community thread
-- showing a live token exchange, Jibble's own public API-tracker listing)
-- -- OAuth2 client_credentials against
-- https://identity.prod.jibble.io/connect/token (POST, form-encoded
-- grant_type/client_id/client_secret, returns a bearer access token); a
-- REST/OData-style TimeEntries resource (GET, Bearer auth, $filter/$expand/
-- $select/$orderby/paging support) on a workspace/time-tracking subdomain
-- of prod.jibble.io. NOT independently confirmed, and explicitly flagged as
-- unverified in the PR description: the exact property names on a
-- TimeEntries record (note text, break representation, an in-progress
-- entry's end-time field), whether breaks are a sub-array on one entry or
-- separate sibling entries per day, and whether Jibble exposes genuine push
-- webhooks (the only "webhook" behavior found in research was Zapier's/
-- Pipedream's own polling-based trigger apps layered on top of Jibble, not
-- a documented native Jibble webhook API) -- this migration and the sync
-- job it supports assume a scheduled PULL sync, never a push webhook, and
-- store each fetched record verbatim in raw_payload specifically so
-- nothing is lost if the named columns below need renaming once real
-- credentials are available.

-- ---------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------

alter table employees add column jibble_person_id text;
comment on column employees.jibble_person_id is
  'HR''s mapping of this employee to their own Jibble member/person id -- set once via the employee edit form, read by import_jibble_time_entry() to attribute an imported time entry. Deliberately NOT auto-discovered or auto-matched by name/email. Null means "not yet mapped" -- the sync job flags an unmapped entry for review rather than guessing.';

create unique index employees_jibble_person_id_unique
  on employees(company_id, jibble_person_id) where jibble_person_id is not null;

alter table approvals alter column approver_id drop not null;
comment on column approvals.approver_id is
  'Nullable specifically for a ''role_queue:%'' step (see approval_workflow_steps.approver_type) -- every OTHER approver type still always resolves to and stores a specific person, unchanged.';

alter table recovery_credit_requests add column correction_reason text;
alter table recovery_credit_requests add column checked_with text;
alter table recovery_credit_requests add column corrected_by uuid references auth.users(id);
alter table recovery_credit_requests add column corrected_at timestamptz;
comment on column recovery_credit_requests.work_date is
  'The CURRENT/EFFECTIVE work date -- what the ledger actually uses when this is approved. adjust_recovery_credit_request()/sync_jibble_attendance_for_day() are the only ways this ever changes after creation; the original, unedited date stays on attendance_records/jibble_time_entries forever.';
comment on column recovery_credit_requests.proposed_days is
  'The CURRENT/EFFECTIVE proposed credit, recomputed server-side via recovery_credit_days_for_hours() whenever HR corrects the hours or fuller Jibble evidence arrives while still pending -- never trusted from the client directly.';

-- ---------------------------------------------------------------------
-- 2. New table: raw Jibble time entries (the durable evidence trail)
-- ---------------------------------------------------------------------

create table jibble_time_entries (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  jibble_entry_id       text not null,   -- Jibble's own stable id for this entry — the idempotency key
  jibble_person_id      text not null,   -- Jibble's own member/person id — mapped via employees.jibble_person_id
  employee_id           uuid references employees(id),  -- null until jibble_person_id is mapped to an employee
  entry_start           timestamptz,
  entry_end             timestamptz,     -- null while still an open/active clock-in
  note                  text,            -- verbatim from Jibble — this system never edits it
  break_minutes         numeric not null default 0,
  -- The employee's own LOCAL calendar date this entry's work belongs to
  -- (entry_start converted via country_timezone()) — null until the
  -- employee is mapped AND the entry has an end time. Stored (not
  -- recomputed ad hoc) so sync_jibble_attendance_for_day() can cheaply sum
  -- every entry sharing a day, including two separate clock sessions on
  -- the same date (e.g. an unpaid lunch modeled as clock-out/clock-in
  -- rather than a breaks field) and an entry that crosses midnight (whose
  -- work_date is the day it STARTED — same convention
  -- record_overnight_recovery_credit()'s manual form already uses).
  work_date             date,
  raw_payload           jsonb not null,
  content_hash          text not null,   -- md5(raw_payload) — detects a Jibble-side edit on re-sync
  attendance_record_id  uuid references attendance_records(id),
  needs_review          boolean not null default false,
  review_reason         text,
  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (company_id, jibble_entry_id)
);

create index idx_jibble_time_entries_employee on jibble_time_entries(employee_id);
create index idx_jibble_time_entries_needs_review on jibble_time_entries(company_id) where needs_review;
create index idx_jibble_time_entries_employee_workdate on jibble_time_entries(employee_id, work_date);

alter table attendance_records add column jibble_time_entry_id uuid references jibble_time_entries(id);

alter table jibble_time_entries enable row level security;

create policy jibble_time_entries_select on jibble_time_entries for select
  using (
    has_role('hr_admin', company_id)
    or (employee_id is not null and (employee_id = current_employee_id() or is_manager_of(employee_id)))
  );

-- ---------------------------------------------------------------------
-- 3. Shared helpers -- country timezone, the credit threshold, and the
--    "qualifying day" rule, extracted so every recording path (manual
--    register, overnight form, Jibble import, HR's own correction) shares
--    exactly one implementation of each.
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
--    threshold logic (verified byte-for-byte equivalent math), PLUS one
--    real correctness fix: the manual register's own upsert now always
--    reasserts source = 'manual' on conflict, even over a day a prior
--    Jibble import had claimed -- without this, a day Jibble touched first
--    and HR later corrected by hand would keep source = 'jibble' forever,
--    letting a LATER Jibble re-sync silently overwrite HR's manual
--    correction (see sync_jibble_attendance_for_day()'s own "safe manual
--    path" guard, which trusts this column). Full bodies required by
--    CREATE OR REPLACE.
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
    -- the manual register always reasserts manual ownership of this day,
    -- even if a prior Jibble import (or a stale jibble_time_entry_id link)
    -- had claimed it, so a LATER Jibble sync for this same date correctly
    -- sees source <> 'jibble' and refuses to overwrite HR's correction (see
    -- sync_jibble_attendance_for_day()'s own "safe manual path" guard).
    insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source, jibble_time_entry_id)
    values (v_employee_id, p_work_date, v_status, v_work_mode, v_hours, 'manual', null)
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
-- 5. sync_jibble_attendance_for_day() + import_jibble_time_entry(): the
--    Jibble-driven detection path. record_attendance_and_recovery() and
--    record_overnight_recovery_credit() (the pre-existing manual paths)
--    are NOT altered by this migration beyond, in Production's real
--    baseline, already having the threshold/weekend logic these two new
--    helper functions now also share -- see this file's header.
-- ---------------------------------------------------------------------

create or replace function sync_jibble_attendance_for_day(p_employee_id uuid, p_country_code text, p_work_date date)
returns table (attendance_record_id uuid, recovery_credit_request_id uuid, flagged_for_review boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_next_local_midnight timestamptz;
  v_standard_hours numeric := 0;
  v_after_midnight_hours numeric := 0;
  v_entry record;
  v_full_hours numeric;
  v_break_hours numeric;
  v_record_id uuid;
  v_status text;
  v_is_recovery_day boolean;
  v_holiday_name text;
  v_event_type text;
  v_credit_hours numeric;
  v_credit_days numeric;
  v_existing_request recovery_credit_requests%rowtype;
  v_was_credited comp_day_ledger%rowtype;
  v_approved_request_exists boolean;
  v_request_id uuid;
begin
  v_tz := country_timezone(p_country_code);
  v_next_local_midnight := ((p_work_date + 1)::timestamp) at time zone v_tz;

  for v_entry in
    select entry_start, entry_end, break_minutes from jibble_time_entries
    where employee_id = p_employee_id and work_date = p_work_date and entry_end is not null
  loop
    -- v_standard_hours is the FULL entry duration (minus breaks) — when
    -- p_work_date itself qualifies as a recovery day, the whole shift
    -- counts toward it even if it runs past local midnight (one
    -- continuous overnight shift that STARTED on a qualifying day is that
    -- day's credit in full, never split). v_after_midnight_hours is
    -- tracked separately for the OTHER case — a shift that started on an
    -- ordinary working day and merely extended past midnight, where only
    -- that extension is creditable.
    v_break_hours := coalesce(v_entry.break_minutes, 0) / 60.0;
    v_full_hours := greatest(0, extract(epoch from (v_entry.entry_end - v_entry.entry_start)) / 3600.0 - v_break_hours);
    v_standard_hours := v_standard_hours + v_full_hours;
    v_after_midnight_hours := v_after_midnight_hours + greatest(0, extract(epoch from (v_entry.entry_end - v_next_local_midnight)) / 3600.0);
  end loop;
  v_standard_hours := round(v_standard_hours::numeric, 2);
  v_after_midnight_hours := round(v_after_midnight_hours::numeric, 2);

  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  select r.is_recovery_day, r.holiday_name into v_is_recovery_day, v_holiday_name from is_recovery_eligible_day(p_country_code, p_work_date) r;
  v_status := case when v_standard_hours > 0 or v_after_midnight_hours > 0 then 'present' else 'not_recorded' end;

  insert into attendance_records (employee_id, work_date, status, hours_worked, active_hours_after_midnight, source)
  values (p_employee_id, p_work_date, v_status, v_standard_hours, nullif(v_after_midnight_hours, 0), 'jibble')
  on conflict (employee_id, work_date) do update
  set status = excluded.status, hours_worked = excluded.hours_worked, active_hours_after_midnight = excluded.active_hours_after_midnight
  where attendance_records.source = 'jibble'
  returning id into v_record_id;

  if v_record_id is null then
    -- A manually recorded row already exists for this date — the safe
    -- manual path always wins; every entry that shares this work_date is
    -- still linked for evidence by the caller, but nothing is derived.
    select id into v_record_id from attendance_records where employee_id = p_employee_id and work_date = p_work_date;
    attendance_record_id := v_record_id;
    recovery_credit_request_id := null;
    flagged_for_review := true;
    return next;
    return;
  end if;

  select r.* into v_existing_request from recovery_credit_requests r
  where r.attendance_record_id = v_record_id and r.status not in ('cancelled', 'rejected');
  select cl.* into v_was_credited from comp_day_ledger cl
  where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
    and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);

  if v_existing_request.id is not null then
    select exists (select 1 from recovery_credit_requests where id = v_existing_request.id and status = 'approved') into v_approved_request_exists;
    if v_approved_request_exists then
      -- Never silently recompute an already-approved (ledger-posted)
      -- request — the caller flags the triggering entry needs_review.
      attendance_record_id := v_record_id;
      recovery_credit_request_id := v_existing_request.id;
      flagged_for_review := true;
      return next;
      return;
    end if;
  end if;

  if v_is_recovery_day then
    v_event_type := 'standard';
    v_credit_hours := v_standard_hours;
  elsif v_after_midnight_hours > 0 then
    v_event_type := 'overnight';
    v_credit_hours := v_after_midnight_hours;
  else
    v_event_type := null;
    v_credit_hours := 0;
  end if;

  if v_event_type is not null and v_credit_hours > 0 and v_was_credited.id is null then
    v_credit_days := recovery_credit_days_for_hours(v_credit_hours);
    if v_existing_request.id is not null then
      -- Still pending — refresh it in place with the fuller evidence
      -- rather than creating a second row (the partial unique index on
      -- attendance_record_id would reject that anyway).
      update recovery_credit_requests
      set work_date = p_work_date, event_type = v_event_type, proposed_days = v_credit_days
      where id = v_existing_request.id;
      recovery_credit_request_id := v_existing_request.id;
    else
      insert into recovery_credit_requests (employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by)
      values (p_employee_id, v_record_id, p_work_date, v_event_type, v_credit_days, coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'))
      returning id into v_request_id;
      perform create_initial_approval('recovery_credit', v_request_id);
      recovery_credit_request_id := v_request_id;
    end if;
  else
    recovery_credit_request_id := v_existing_request.id;
  end if;

  attendance_record_id := v_record_id;
  flagged_for_review := false;
  return next;
end;
$$;

create or replace function import_jibble_time_entry(
  p_company_id uuid,
  p_jibble_entry_id text,
  p_jibble_person_id text,
  p_entry_start timestamptz,
  p_entry_end timestamptz,
  p_note text,
  p_break_minutes numeric,
  p_raw_payload jsonb
)
returns table (
  jibble_row_id uuid,
  attendance_record_id uuid,
  recovery_credit_request_id uuid,
  needs_review boolean,
  review_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content_hash text;
  v_existing jibble_time_entries%rowtype;
  v_row_id uuid;
  v_employee_id uuid;
  v_country_code text;
  v_work_date date;
  v_needs_review boolean := false;
  v_review_reason text := null;
  v_approved_request_exists boolean;
  v_sync record;
  v_sync_review_reason text;
begin
  if p_jibble_entry_id is null or length(trim(p_jibble_entry_id)) = 0 then
    raise exception 'A Jibble entry id is required.';
  end if;
  v_content_hash := md5(coalesce(p_raw_payload, '{}'::jsonb)::text);

  select * into v_existing from jibble_time_entries
  where company_id = p_company_id and jibble_entry_id = p_jibble_entry_id
  for update;

  select id, country_code into v_employee_id, v_country_code
  from employees where company_id = p_company_id and jibble_person_id = p_jibble_person_id and deleted_at is null;

  if v_employee_id is null then
    v_needs_review := true;
    v_review_reason := 'No employee in this company is mapped to Jibble person ' || p_jibble_person_id || '.';
  end if;

  if v_existing.id is not null and v_existing.content_hash = v_content_hash and v_existing.employee_id is not distinct from v_employee_id then
    -- Byte-identical re-sync of an entry whose employee mapping also
    -- hasn't changed — nothing changed, nothing to redo. Deliberately NOT
    -- keyed on content_hash alone: an entry first synced before HR mapped
    -- its Jibble person to an employee must still be reprocessed once that
    -- mapping is added, even though the Jibble-side payload itself never
    -- changed.
    update jibble_time_entries set synced_at = now() where id = v_existing.id;
    select r.id into recovery_credit_request_id from recovery_credit_requests r where r.attendance_record_id = v_existing.attendance_record_id;
    jibble_row_id := v_existing.id;
    attendance_record_id := v_existing.attendance_record_id;
    needs_review := v_existing.needs_review;
    review_reason := v_existing.review_reason;
    return next;
    return;
  end if;

  if v_existing.id is not null and v_existing.attendance_record_id is not null then
    select exists (
      select 1 from recovery_credit_requests r
      where r.attendance_record_id = v_existing.attendance_record_id and r.status = 'approved'
    ) into v_approved_request_exists;
    if v_approved_request_exists then
      update jibble_time_entries
      set entry_start = p_entry_start, entry_end = p_entry_end, note = p_note, break_minutes = coalesce(p_break_minutes, 0),
          raw_payload = p_raw_payload, content_hash = v_content_hash, needs_review = true,
          review_reason = 'This Jibble entry was edited after its recovery credit was already approved — review before trusting the posted balance.',
          synced_at = now()
      where id = v_existing.id
      returning id into v_row_id;

      select r.id into recovery_credit_request_id from recovery_credit_requests r where r.attendance_record_id = v_existing.attendance_record_id;
      jibble_row_id := v_row_id;
      attendance_record_id := v_existing.attendance_record_id;
      needs_review := true;
      review_reason := 'This Jibble entry was edited after its recovery credit was already approved — review before trusting the posted balance.';
      return next;
      return;
    end if;
  end if;

  if p_entry_end is not null and p_entry_end <= p_entry_start then
    v_needs_review := true;
    v_review_reason := case when v_review_reason is null then 'This entry''s end time is not after its start time.'
      else v_review_reason || ' Also: this entry''s end time is not after its start time.' end;
  end if;

  v_work_date := case when v_employee_id is not null and p_entry_end is not null and not v_needs_review
    then (p_entry_start at time zone country_timezone(v_country_code))::date
    else null
  end;

  insert into jibble_time_entries (company_id, jibble_entry_id, jibble_person_id, employee_id, entry_start, entry_end, note, break_minutes, work_date, raw_payload, content_hash, needs_review, review_reason, synced_at)
  values (p_company_id, p_jibble_entry_id, p_jibble_person_id, v_employee_id, p_entry_start, p_entry_end, p_note, coalesce(p_break_minutes, 0), v_work_date, p_raw_payload, v_content_hash, v_needs_review, v_review_reason, now())
  on conflict (company_id, jibble_entry_id) do update
  set jibble_person_id = excluded.jibble_person_id, employee_id = excluded.employee_id,
      entry_start = excluded.entry_start, entry_end = excluded.entry_end, note = excluded.note,
      break_minutes = excluded.break_minutes, work_date = excluded.work_date,
      raw_payload = excluded.raw_payload, content_hash = excluded.content_hash,
      needs_review = excluded.needs_review, review_reason = excluded.review_reason, synced_at = now()
  returning id into v_row_id;

  jibble_row_id := v_row_id;
  needs_review := v_needs_review;
  review_reason := v_review_reason;

  if v_work_date is null then
    -- Unmapped employee, or still an open/active clock-in — nothing to
    -- derive attendance from yet.
    attendance_record_id := null;
    recovery_credit_request_id := null;
    return next;
    return;
  end if;

  select * into v_sync from sync_jibble_attendance_for_day(v_employee_id, v_country_code, v_work_date);

  update jibble_time_entries set attendance_record_id = v_sync.attendance_record_id where id = v_row_id;
  if v_sync.flagged_for_review then
    needs_review := true;
    -- v_sync_review_reason (a plain local, not the OUT parameter) avoids a
    -- "column reference is ambiguous" error: inside an UPDATE ... SET
    -- review_reason = ..., a bare identifier matching both a plpgsql
    -- variable AND the target table's own column name is ambiguous.
    v_sync_review_reason := coalesce(review_reason, 'A manually recorded attendance row already exists for this date, or its recovery credit was already approved — see the linked attendance record.');
    review_reason := v_sync_review_reason;
    update jibble_time_entries set needs_review = true, review_reason = v_sync_review_reason where id = v_row_id;
  end if;

  attendance_record_id := v_sync.attendance_record_id;
  recovery_credit_request_id := v_sync.recovery_credit_request_id;
  return next;
end;
$$;

revoke all on function import_jibble_time_entry(uuid, text, text, timestamptz, timestamptz, text, numeric, jsonb) from public;
grant execute on function import_jibble_time_entry(uuid, text, text, timestamptz, timestamptz, text, numeric, jsonb) to service_role;

-- HR's correction step, made on the approval screen BEFORE deciding — never
-- combined into the decision itself, so HR can save a correction, come
-- back later, and still decide (or hand it to another HR Admin) without
-- re-entering it. Locks (and requires 'pending') the SAME approval row
-- decide_recovery_credit_request()/decide_leave_approval() lock, so an
-- adjustment can never race a concurrent decision into inconsistent state.
-- Requires a non-empty p_correction_reason whenever work_date or the
-- resulting proposed_days actually changes (re-saving identical values, or
-- only setting checked_with, is not "a correction"); recomputes
-- proposed_days from p_corrected_hours via recovery_credit_days_for_hours()
-- SERVER-SIDE — the client never gets to assert a day count directly.
-- Company isolation and role enforcement both come from has_role() below,
-- not from RLS (this is SECURITY DEFINER, like every other approval-engine
-- mutator) — company_id is resolved from the request's own employee, never
-- trusted from the caller.

-- ---------------------------------------------------------------------
-- 6. HR's correction + decision RPCs.
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
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be ''approved'' or ''rejected''';
  end if;
  if p_decision = 'approved' and (p_checked_with is null or length(trim(p_checked_with)) = 0) then
    raise exception 'Record whom you checked this work with before approving.';
  end if;

  select a.id into v_approval_id
  from approvals a
  where a.entity_type = 'recovery_credit' and a.entity_id = p_request_id and a.decision = 'pending'
  order by a.step_order desc limit 1;
  if v_approval_id is null then
    raise exception 'No pending approval found for this recovery credit request.';
  end if;

  if p_checked_with is not null and length(trim(p_checked_with)) > 0 then
    update recovery_credit_requests set checked_with = p_checked_with where id = p_request_id;
  end if;

  perform decide_leave_approval(v_approval_id, p_decision, p_comments);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. create_initial_approval(): recovery_credit's ownership check now
--    tolerates a null auth.uid() (the Jibble import calls this from a
--    service_role context with no user session) and gains a
--    'role_queue:%' branch that skips resolve_approver() entirely, hard-
--    stopping only if no one currently holds the named role. Full body
--    required by CREATE OR REPLACE.
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
begin
  -- recovery_credit is the one entity type that can be created with NO
  -- calling user session at all — the Jibble import (import_jibble_time_entry(),
  -- a service_role-only SECURITY DEFINER function) attests to it on the
  -- employee's behalf from a scheduled sync job, not a logged-in request.
  -- is_entity_owner()'s created_by = auth.uid() check is meaningless there
  -- (auth.uid() is null under a service-role call) and would otherwise hard-
  -- block every Jibble-sourced request; it still fully applies whenever a
  -- real user session created the row (the manual attendance/overnight
  -- paths, where auth.uid() is the acting HR Admin/manager).
  if p_entity_type = 'recovery_credit' and auth.uid() is null then
    null;
  elsif not is_entity_owner(p_entity_type, p_entity_id) then
    raise exception 'You do not own this % (or it does not exist)', p_entity_type;
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
    select e.company_id, r.employee_id into v_company_id, v_employee_id
    from recovery_credit_requests r join employees e on e.id = r.employee_id where r.id = p_entity_id;
  else
    raise exception 'Unsupported entity type: %', p_entity_type;
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
-- 8. decide_leave_approval(): gains a null-approver_id ("role queue")
--    authorization branch. EVERY EXISTING approvals row (non-null
--    approver_id) goes through the exact same check as before -- this
--    branch is reachable only by a brand-new 'role_queue:%' step, and only
--    for entity_type = 'recovery_credit' (it explicitly raises for any
--    other entity type, which can never reach it in practice since nothing
--    else ever creates a role_queue step). Full body required by CREATE OR
--    REPLACE; the finalization block for recovery_credit is UNCHANGED (it
--    already posts the ledger credit on whichever decision finalizes the
--    chain -- with only one step now, that is simply this one decision).
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
  else
    -- Role-queue step (currently only recovery_credit's single HR step —
    -- see approval_workflow_steps.approver_type's 'role_queue:%' doc
    -- comment): there's no single assigned approver_id to compare against
    -- auth.uid(); instead ANY user currently holding the step's named role
    -- IN THE APPROVAL'S OWN COMPANY may decide it. Resolved here, before
    -- entity dispatch below (which only runs after the decision is already
    -- recorded), since this needs the company + beneficiary user up front.
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
    -- HR Admin's final approval — the ONLY point anywhere in this system
    -- that posts the actual earned comp_day_ledger row for a recovery
    -- credit. Defensively re-checks for an existing active credit first
    -- (decide_leave_approval() already refuses to re-decide a
    -- non-'pending' approval, so this can only run once per approvals row
    -- in practice — this is a second, independent backstop, the same
    -- "already credited?" check record_attendance_and_recovery() uses).
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_recovery_request.employee_id::text));

    if not exists (
      select 1 from comp_day_ledger cl
      where cl.reference_type = 'attendance_record' and cl.reference_id = v_recovery_request.attendance_record_id and cl.entry_type = 'earned'
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
        'attendance_record',
        v_recovery_request.attendance_record_id,
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
-- 9. seed_default_approval_workflows(): recovery_credit's block now seeds
--    ONE 'role_queue:hr_admin' step instead of direct_manager -> role:
--    hr_admin. Only affects NEW companies created after this migration --
--    see this file's own header. Full body required by CREATE OR REPLACE.
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
  -- potential credit (from the Jibble import or the manual attendance
  -- register) goes straight to this queue; HR checks the work with the
  -- relevant project lead outside the application before deciding — its
  -- own insert, outside the loop above, since every other entity type
  -- there has exactly one step too, but resolves it very differently.
  insert into approval_workflows (company_id, entity_type, name)
  values (new.id, 'recovery_credit', 'Recovery Leave earning approval (HR)')
  returning id into v_workflow_id;

  insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
    (v_workflow_id, 1, 'role_queue:hr_admin');

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. approvals_select: a role_queue step's approver_id is null by design
--    -- without this branch, no company-scoped HR Admin could see it
--    (has_role('hr_admin') with no company argument only matches a
--    GLOBAL, unscoped grant).
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
      -- A role_queue:% step's approver_id is null by design (see
      -- approval_workflow_steps.approver_type's doc comment) — none of the
      -- branches above would ever match for a company-scoped HR Admin (the
      -- realistic case; has_role('hr_admin') with no company argument only
      -- matches a GLOBAL, unscoped grant), so without this branch a queued
      -- Recovery Leave approval would be invisible to the very HR Admins
      -- meant to decide it.
      entity_type = 'recovery_credit'
      and approver_id is null
      and exists (
        select 1 from recovery_credit_requests r join employees e on e.id = r.employee_id
        where r.id = entity_id and has_role('hr_admin', e.company_id)
      )
    )
  );
