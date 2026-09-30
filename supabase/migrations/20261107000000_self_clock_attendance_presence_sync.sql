-- ---------------------------------------------------------------------
-- Bridges employee self-service attendance clocking (attendance_sessions/
-- attendance_segments, added in 20261106000000) into attendance_records --
-- the ONE table the dashboard's per-company headcount
-- (apps/web/src/app/(app)/dashboard-data.ts) and the daily attendance
-- register (apps/web/src/app/(app)/attendance/page.tsx) actually read. Until
-- this migration, clock_in()/switch_work_segment()/clock_out() never wrote
-- attendance_records at all -- sync_attendance_recovery_for_day() (called
-- from clock_out()) only ever creates recovery_credit_requests/
-- comp_day_ledger rows, so a self-clocked employee counted as
-- 'not_recorded' all day on both the dashboard and the register, and never
-- showed a "Clocked in" state or completed hours anywhere.
--
-- This migration is purely additive: one new nullable column, one new
-- function, and small additions to the bodies of five already-deployed
-- functions (clock_in, switch_work_segment, clock_out,
-- hr_close_attendance_session, record_attendance_and_recovery) that call the
-- new function or clear its conflict marker. Nothing here changes
-- attendance_records' shape in a breaking way, and nothing here touches
-- Recovery Leave routing/credit logic at all -- sync_attendance_recovery_for_day()
-- is completely unmodified by this file.
-- ---------------------------------------------------------------------

alter table attendance_records add column if not exists presence_conflict text;

comment on column attendance_records.presence_conflict is
  'Set by sync_attendance_presence_for_day() when a self-clock event would otherwise need to touch a day already recorded by a non-self-clock source (manual/biometric/import) with a real status -- self-clock NEVER overwrites that day, it only flags the conflict here for HR to see and reconcile. Cleared automatically the next time that day is saved through the manual register (record_attendance_and_recovery()), which always reasserts manual ownership.';

-- Re-derives ONE calendar day's attendance_records row (status/work_mode/
-- hours_worked) from this employee's own attendance_segments, exactly the
-- same "recompute the whole day fresh from every closed segment on file for
-- it" approach sync_attendance_recovery_for_day() already uses for Recovery
-- Leave -- so multiple sessions the same day, a mid-shift mode switch, or a
-- later HR correction (hr_close_attendance_session()) can never produce a
-- duplicate row or a drifted hours figure. Deliberately entirely separate
-- from sync_attendance_recovery_for_day(): this function is never called
-- with logic that creates a recovery_credit_requests row, and
-- sync_attendance_recovery_for_day() never touches attendance_records --
-- attendance PRESENCE and Recovery Leave APPROVAL stay two independent
-- concerns fed by the same underlying segments.
--
-- Day-boundary handling matches clock_out()'s own loop exactly: callers
-- always invoke this once per DISTINCT LOCAL date a session's segments
-- touch (via segment_start, never segment_end), so an overnight session
-- naturally produces two correct, separate day rows -- one finalized (the
-- start date, once its segments are closed) and one still "Clocked in" (the
-- date the new segment opened on), never one row spanning both.
--
-- Precedence with the manual register (record_attendance_and_recovery()):
-- manual ALWAYS wins, symmetric with that function's own "source = 'manual'
-- is set on BOTH the insert and the conflict branch -- the manual register
-- always reasserts manual ownership" rule. This function only ever writes
-- when there is no existing row for the day, the existing row is already
-- source = 'self_clock' (its own prior write), or the existing row is the
-- genuine not-yet-recorded default -- any other existing row (a real
-- manual/biometric/import entry, including one HR corrected) is left
-- completely untouched and instead gets presence_conflict set, never
-- silently overwritten.
create or replace function sync_attendance_presence_for_day(p_employee_id uuid, p_work_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country_code text;
  v_tz text;
  v_total_hours numeric;
  v_is_open boolean;
  v_latest_work_mode text;
  v_mapped_work_mode text;
  v_existing attendance_records%rowtype;
begin
  select country_code into v_country_code from employees where id = p_employee_id and deleted_at is null;
  if v_country_code is null then
    return;
  end if;
  v_tz := country_timezone(v_country_code);

  -- Hours worked so far today, from CLOSED segments only -- while a segment
  -- is still open, no partial/live figure is shown at all (see v_is_open
  -- below), only "Clocked in", per this feature's own requirement.
  select coalesce(sum(extract(epoch from (segment_end - segment_start))), 0) / 3600.0
  into v_total_hours
  from attendance_segments
  where employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date;

  -- Whether THIS DATE'S OWN segment is still open — segment_end is null is
  -- the authoritative "still open" signal (schema.sql's own check
  -- constraint and its one-open-segment-per-session partial unique index
  -- both key off exactly this), never the overall session's status: a
  -- session stays 'open' as a whole for as long as ANY of its segments is,
  -- which is a different question from whether the specific segment that
  -- started on p_work_date is the one still open (a switch across local
  -- midnight closes the OLD date's own segment while the session as a whole
  -- keeps going into the new date).
  select exists (
    select 1 from attendance_segments s
    where s.employee_id = p_employee_id and s.segment_end is null
      and (s.segment_start at time zone v_tz)::date = p_work_date
  ) into v_is_open;

  -- Representative work mode for this day: the most recently STARTED
  -- segment touching this local date (open or closed) -- "what they're
  -- doing right now", or what they were last doing before clocking out.
  select work_mode into v_latest_work_mode
  from attendance_segments
  where employee_id = p_employee_id and (segment_start at time zone v_tz)::date = p_work_date
  order by segment_start desc limit 1;

  if v_latest_work_mode is null then
    -- Nothing (left) on this local date for this employee -- e.g. a
    -- corrected/removed segment left no trace here. Nothing to sync.
    return;
  end if;

  -- attendance_records.work_mode predates this feature and uses its own
  -- vocabulary (bulk-attendance-form.tsx's manual-entry options) --
  -- attendance_segments.work_mode is never widened or renamed to match it.
  v_mapped_work_mode := case v_latest_work_mode
    when 'office' then 'office'
    when 'wfh' then 'work_from_home'
    when 'site_work' then 'client_site'
    when 'client_meeting' then 'field_work'
    when 'business_travel' then 'business_travel'
    else null
  end;

  select * into v_existing from attendance_records
  where employee_id = p_employee_id and work_date = p_work_date
  for update;

  if v_existing.id is not null and v_existing.source <> 'self_clock' and v_existing.status <> 'not_recorded' then
    if v_existing.presence_conflict is null then
      update attendance_records
      set presence_conflict = 'Self-clock activity exists for this day, which was already recorded as ''' || v_existing.status || ''' (source: ' || v_existing.source || '). Not overwritten -- review and re-save manually if this should change.'
      where id = v_existing.id;
    end if;
    return;
  end if;

  insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
  values (p_employee_id, p_work_date, 'present', v_mapped_work_mode, case when v_is_open then null else nullif(v_total_hours, 0) end, 'self_clock')
  on conflict (employee_id, work_date) do update
  set status = 'present',
      work_mode = excluded.work_mode,
      hours_worked = excluded.hours_worked,
      source = 'self_clock',
      presence_conflict = null
  where attendance_records.source = 'self_clock' or attendance_records.status = 'not_recorded';
end;
$$;

-- clock_in(): now also syncs attendance presence for today (the new
-- segment's own local start date) immediately, so the dashboard headcount
-- and the register both show this employee as present the instant they
-- clock in -- never waiting for clock_out(). Recovery Leave is completely
-- untouched here: no call to sync_attendance_recovery_for_day() was ever
-- here, and none is added.
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
  v_country_code text;
  v_tz text;
  v_work_date date;
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

  select country_code into v_country_code from employees where id = v_employee_id;
  v_tz := country_timezone(v_country_code);
  select (segment_start at time zone v_tz)::date into v_work_date from attendance_segments where id = v_segment_id;
  perform sync_attendance_presence_for_day(v_employee_id, v_work_date);

  return v_session_id;
end;
$$;

-- switch_work_segment(): syncs presence for BOTH the segment just closed and
-- the segment just opened -- almost always the same local date (a plain
-- mid-shift mode change), but kept as two independent syncs so a switch
-- that happens to straddle local midnight still finalizes the old date's
-- hours and opens "Clocked in" on the new date correctly, the same
-- per-local-date handling clock_out()'s own loop already uses.
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
  v_old_segment_start timestamptz;
  v_new_segment_id uuid;
  v_country_code text;
  v_tz text;
  v_old_work_date date;
  v_new_work_date date;
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

  select id, work_mode, segment_start into v_old_segment_id, v_old_work_mode, v_old_segment_start
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

  select country_code into v_country_code from employees where id = v_employee_id;
  v_tz := country_timezone(v_country_code);
  v_old_work_date := (v_old_segment_start at time zone v_tz)::date;
  select (segment_start at time zone v_tz)::date into v_new_work_date from attendance_segments where id = v_new_segment_id;
  perform sync_attendance_presence_for_day(v_employee_id, v_old_work_date);
  if v_new_work_date <> v_old_work_date then
    perform sync_attendance_presence_for_day(v_employee_id, v_new_work_date);
  end if;

  return v_new_segment_id;
end;
$$;

-- clock_out(): now also syncs attendance presence for every LOCAL date this
-- session's segments touch, in the SAME loop (and using the same
-- distinct-local-start-date query) as the existing Recovery Leave sync
-- right below it -- one pass, two independent concerns, neither affecting
-- the other's inputs or outputs.
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
    perform sync_attendance_presence_for_day(v_employee_id, v_work_date);
    perform sync_attendance_recovery_for_day(v_employee_id, v_work_date);
  end loop;

  return v_session_id;
end;
$$;

-- hr_close_attendance_session(): same addition as clock_out() -- presence
-- is re-synced for every local date this (now HR-corrected) session's
-- segments touch, right alongside the existing Recovery Leave re-sync.
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

  v_tz := country_timezone(v_country_code);
  for v_work_date in
    select distinct (segment_start at time zone v_tz)::date from attendance_segments where session_id = p_session_id
  loop
    perform sync_attendance_presence_for_day(v_employee_id, v_work_date);
    perform sync_attendance_recovery_for_day(v_employee_id, v_work_date);
  end loop;
end;
$$;

-- record_attendance_and_recovery(): the manual register's own save now also
-- clears any stale presence_conflict flag on the day it just (re)asserted
-- manual ownership of -- HR explicitly saving this day IS how a self-clock
-- conflict on it gets resolved. Nothing else about this function changes;
-- it already unconditionally overwrites status/work_mode/hours_worked/
-- source on every save, exactly as before.
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

    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_employee_id::text));

    select r.is_recovery_day, r.holiday_name into v_is_recovery_day, v_holiday_name from is_recovery_eligible_day(v_country_code, p_work_date) r;

    insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
    values (v_employee_id, p_work_date, v_status, v_work_mode, v_hours, 'manual')
    on conflict (employee_id, work_date) do update
    set status = excluded.status, work_mode = excluded.work_mode, hours_worked = excluded.hours_worked, source = 'manual', presence_conflict = null
    returning id into v_record_id;

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
