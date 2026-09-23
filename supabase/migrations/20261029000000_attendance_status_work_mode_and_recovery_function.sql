-- Phase 1 hardening (A — Attendance): three problems in one:
--
-- 1. Every employee with no saved attendance_records row for a day
--    defaulted to showing (and, once saved, actually recording) "Present"
--    in the daily register — even the dashboard's own "Missing record"
--    metric disagreed with what the register itself displayed. The real
--    default for an unsaved day is 'not_recorded', enforced here at the
--    column level, not just in the UI.
-- 2. Status (what the employee did) and work mode (where) were conflated
--    into one field, and 'holiday'/'weekend' were themselves status
--    values describing the CALENDAR, not the employee — normalized below
--    to 'not_recorded' (no row previously existed for most of these
--    anyway; this only reclassifies rows an admin explicitly saved as
--    'holiday'/'weekend' under the old dropdown).
-- 3. bulkRecordAttendance() trusted a browser-computed isRecoveryEligible
--    boolean outright, and its attendance-upsert + comp-day-credit was two
--    separate round trips, not atomic. record_attendance_and_recovery()
--    below re-derives weekend/public-holiday status server-side (the same
--    isWeekend() rule packages/domain uses) and does the whole save,
--    including any credit or reversal, as one atomic call per batch.
update attendance_records set status = 'not_recorded' where status in ('holiday', 'weekend');

alter table attendance_records alter column status set default 'not_recorded';
alter table attendance_records add constraint attendance_records_status_check
  check (status in ('not_recorded', 'present', 'absent', 'leave', 'partial_day'));
alter table attendance_records add column work_mode text
  check (work_mode in ('office', 'client_site', 'work_from_home', 'field_work', 'business_travel'));

-- comp_day_ledger_attendance_uniq (added in 20261015000000) forbade a
-- SECOND comp_day_ledger row from ever referencing the same
-- attendance_record — which is exactly what a correction's reversal now
-- legitimately needs to do (reverse, then possibly re-earn later, both
-- referencing the same attendance_record id). Concurrent double-crediting
-- is now prevented instead by an advisory lock inside
-- record_attendance_and_recovery() itself, the same technique
-- decide_leave_approval() already uses for this employee's comp-day
-- balance — see that function below.
drop index if exists comp_day_ledger_attendance_uniq;

-- The output column is attendance_employee_id, not employee_id — every
-- table this function touches (employees, attendance_records,
-- comp_day_ledger) has a real column literally named employee_id, and
-- PL/pgSQL raises "ambiguous column reference" if an OUT parameter shares
-- a name with a column referenced anywhere in the function body (it bit
-- the ON CONFLICT target list here specifically).
create or replace function record_attendance_and_recovery(p_work_date date, p_rows jsonb)
returns table(attendance_employee_id uuid, credited boolean, reversed boolean)
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
  v_week_start_day smallint;
  v_holiday_name text;
  v_is_recovery_day boolean;
  v_record_id uuid;
  v_was_credited comp_day_ledger%rowtype;
  v_credit_days numeric;
  v_expiry_months int;
  v_expiry_date date;
  v_overtime_policy jsonb;
  v_credited boolean;
  v_reversed boolean;
begin
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_employee_id := (v_row ->> 'employee_id')::uuid;
    v_status := v_row ->> 'status';
    v_work_mode := nullif(v_row ->> 'work_mode', '');
    v_hours := nullif(v_row ->> 'hours_worked', '')::numeric;
    v_credited := false;
    v_reversed := false;

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
    -- admins editing the same date) could both read "not yet credited"
    -- before either has committed its insert, and both credit it.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_employee_id::text));

    select week_start_day into v_week_start_day from countries where code = v_country_code;
    select name into v_holiday_name from public_holidays where country_code = v_country_code and holiday_date = p_work_date;
    v_is_recovery_day := v_holiday_name is not null
      or ((extract(dow from p_work_date)::int - coalesce(v_week_start_day, 1) + 7) % 7) >= 5;

    -- One atomic upsert rather than a check-then-branch — the latter has
    -- the same TOCTOU shape as the race bulkRecordAttendance()'s old
    -- "already credited?" check had (two concurrent saves for the same
    -- employee/date, e.g. a double-clicked Save, could otherwise both see
    -- "no existing row" and both attempt an insert).
    insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
    values (v_employee_id, p_work_date, v_status, v_work_mode, v_hours, 'manual')
    on conflict (employee_id, work_date) do update
    set status = excluded.status, work_mode = excluded.work_mode, hours_worked = excluded.hours_worked
    returning id into v_record_id;

    -- The CURRENTLY ACTIVE credit for this record, if any — an 'earned' row
    -- that hasn't itself already been reversed. Without the "not reversed"
    -- exclusion, correcting a day away from present (posting a reversal)
    -- and then correcting it back to present later would see the original
    -- (now-reversed) earned row and wrongly treat it as still active,
    -- permanently blocking that day from ever earning a fresh credit again.
    select cl.* into v_was_credited from comp_day_ledger cl
    where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);

    if v_is_recovery_day and v_status = 'present' then
      if v_was_credited.id is null then
        select resolve_policy(v_country_code, 'overtime_rules', p_work_date) into v_overtime_policy;
        -- recovery_credit_days: 0, 0.5, or 1 — HR-configurable per country
        -- via the overtime_rules policy payload, same field-within-payload
        -- convention comp_day_expiry_months already established. Defaults
        -- to 1 (a full day) when nothing is configured, preserving what
        -- every company got before this was configurable.
        v_credit_days := coalesce((v_overtime_policy ->> 'recovery_credit_days')::numeric, 1);
        if v_credit_days > 0 then
          v_expiry_months := nullif(v_overtime_policy ->> 'comp_day_expiry_months', '')::int;
          v_expiry_date := case when v_expiry_months is not null then (p_work_date + (v_expiry_months || ' months')::interval)::date else null end;
          insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
          values (v_employee_id, p_work_date, 'earned', v_credit_days, 'holiday_worked', v_expiry_date, 'attendance_record', v_record_id, auth.uid());
          v_credited := true;
        end if;
      end if;
    elsif v_was_credited.id is not null then
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
      values (v_was_credited.employee_id, p_work_date, 'reversal', -v_was_credited.days, 'holiday_worked', 'attendance_record', v_record_id, v_was_credited.id, auth.uid());
      v_reversed := true;
    end if;

    attendance_employee_id := v_employee_id;
    credited := v_credited;
    reversed := v_reversed;
    return next;
  end loop;
end;
$$;
