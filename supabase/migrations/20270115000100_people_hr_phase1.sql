-- People & HR Phase 1: ONE effective-dated job-and-pay change process, and an opening balance that can only be recorded once.
-- ADDITIVE: new columns on employee_career_events, two indexes, two partial unique indexes and eight functions (two business-date helpers and two change functions callable by a signed-in user, one by the service role only,
-- the rest internal). No existing policy, function or grant is changed, and no existing row is rewritten except the one-time `applied_at` marker described in 1.
-- Install order: preflight (supabase/manual-sql/people_hr_phase1_00_preflight_readonly.sql), this migration, verify (..._20_verify_readonly.sql), then deploy the app.
-- Rollback: supabase/manual-sql/people_hr_phase1_90_rollback.sql (it stops while any change is still scheduled).
--
-- THIS MIGRATION FAILS (and changes nothing: it runs as one transaction) IF an employee already has two opening-balance rows for the same leave type, or two opening comp-day rows. The preflight
-- counts them; the expected answer is 0. If it is not 0, do not delete anything: decide with HR which row is the true opening balance first.
--
-- RE-RUNNABLE. Every statement is `if not exists` / `create or replace`, and the earlier signatures of the functions below (a first draft of this file, never merged) are dropped by name and
-- signature first, so running this file over that draft converges instead of leaving two versions of a function side by side. The verify pack's row 7 fails if a function is not this version.
--
-- LOCK ORDER (the same on every path: the save, the daily job and the cancellation). The employee's row in `employees` is locked FIRST (_hr_lock_employee), then the change's row in
-- `employee_career_events`, then the pay rows are read and written. Whatever a path decides about the employee's status or pay, it decides AFTER holding that lock, so two sessions touching
-- the same employee run one after the other and the second sees what the first committed. The daily job takes no lock while it lists what is due; it locks each employee as it reaches that
-- employee's change (and gives up on one employee after 10 seconds, reporting that as a failure, rather than waiting forever behind a stuck session).
--
-- WHAT IT DOES
--   1. employee_career_events: applied_at (null = SCHEDULED, a change dated in the future and not yet in force; a time = applied; every existing row is marked applied at the time it was written;
--      the column default is now(), so a row written by the PREVIOUS app build during the install window counts as applied), base_compensation_id (the pay version that was current when a pay change
--      was recorded), conflict_reason / conflict_at (a scheduled change the daily job held back because pay moved on; null otherwise) and dismissed_at / dismissed_by (a scheduled change HR cancelled).
--   2. hr_business_time_zone / hr_business_date / hr_business_today: the effective-date cutoff is decided HERE, from the employee's country (AE Asia/Dubai, SA Asia/Riyadh, PL Europe/Warsaw, any other
--      country Asia/Dubai, the same list as the app), never from a date the browser or the server sent. "Today" for an employee is that country's calendar day, not UTC.
--   3. record_employment_change(): the one entry point for a job title and/or pay change. HR Admin of the employee's company may change either (an audit event is written); Finance may change pay only,
--      dated today or earlier, with no event row. A change dated today or earlier (by the employee's own calendar) is applied in the same transaction as the event: job title and pay save together or not
--      at all. A change dated later is saved as a scheduled event and changes nothing yet. Allowances the person did not edit are carried over untouched; only "Others" is ever edited here.
--   4. apply_due_employment_changes(): called once a day by the cron route with the service role only. Applies each scheduled event whose date has come in ITS employee's calendar, in date order, each in
--      its own sub-transaction. An event whose pay version is no longer the current one is NOT applied: it is held with a reason for HR to review. A failure is reported per event and never undoes the
--      events that were applied in the same run. An event whose employee has left stays unapplied and is reported.
--   5. dismiss_employment_change(): HR Admin of the employee's company cancels a scheduled change (kept in the history as cancelled, never deleted).
--   6. Two partial unique indexes: one opening-balance row per employee and leave type in leave_ledger, and one opening comp-day row per employee in comp_day_ledger. The leave-accrual baseline
--      depends on the 'opening_balance' tag, so a second row would silently change entitlement; the app checks first and these indexes close the race between two clicks.

-- Earlier signatures (a first draft, never merged): dropped so that only one version of each function exists.
drop function if exists record_employment_change(uuid, date, text, numeric, numeric, text, date);
drop function if exists apply_due_employment_changes(text, date);
drop function if exists _hr_set_current_pay(uuid, date, numeric, numeric, text, uuid);
drop function if exists _hr_apply_career_event(uuid);   -- it used to return nothing; it now says what it did

-- 1. Scheduled / applied marker, the pay version a change was based on, held-for-review and cancelled markers.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employee_career_events' and column_name = 'applied_at') then
    alter table employee_career_events add column applied_at timestamptz;
    update employee_career_events set applied_at = created_at;   -- every row so far was applied when it was written; the audit trigger on this table is insert-only
  end if;
end $$;
alter table employee_career_events alter column applied_at set default now();
alter table employee_career_events
  add column if not exists base_compensation_id uuid references compensation_details(id) on delete set null,
  add column if not exists conflict_reason text,
  add column if not exists conflict_at timestamptz,
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid;
drop index if exists idx_career_events_scheduled;
create index idx_career_events_scheduled on employee_career_events (effective_date) where applied_at is null and dismissed_at is null;

-- 2. The employee's business calendar. One list, the same as packages/domain businessTime.ts: no zone is guessed for a country the business has not decided (it gets Dubai, as everywhere else).
create or replace function hr_business_time_zone(p_country_code text)
returns text language sql immutable as $$
  select case upper(coalesce(p_country_code, '')) when 'AE' then 'Asia/Dubai' when 'SA' then 'Asia/Riyadh' when 'PL' then 'Europe/Warsaw' else 'Asia/Dubai' end;
$$;
-- The calendar date in that country at an instant.
create or replace function hr_business_date(p_country_code text, p_at timestamptz)
returns date language sql immutable as $$
  select (p_at at time zone hr_business_time_zone(p_country_code))::date;
$$;
-- Today in that country, from the database clock. Readable by signed-in users (the form shows the same date the database will use) and the service role; it reads no table.
create or replace function hr_business_today(p_country_code text)
returns date language sql stable as $$
  select hr_business_date(p_country_code, now());
$$;
revoke all on function hr_business_time_zone(text) from public, anon;
revoke all on function hr_business_date(text, timestamptz) from public, anon;
revoke all on function hr_business_today(text) from public, anon;
grant execute on function hr_business_time_zone(text), hr_business_date(text, timestamptz), hr_business_today(text) to authenticated;

-- 6. One opening balance each (created first so a duplicate stops the migration before anything else is installed).
create unique index if not exists leave_ledger_opening_balance_unique on leave_ledger (employee_id, leave_type_code) where reference_type = 'opening_balance';
create unique index if not exists comp_day_ledger_opening_balance_unique on comp_day_ledger (employee_id) where source = 'opening_balance';

-- Internal: take the employee's lock (the FIRST lock on every path) and return the employee as it is now, after any session that held the lock has committed. A lock already held by this
-- transaction is simply kept. Returns a row with a null id when there is no such employee.
create or replace function _hr_lock_employee(p_employee_id uuid)
returns employees
language plpgsql
security definer
set search_path = public
as $$
declare
  emp employees%rowtype;
begin
  select * into emp from employees where id = p_employee_id for update;
  return emp;
end;
$$;
revoke all on function _hr_lock_employee(uuid) from public, anon, authenticated;

-- Internal: put a pay version in force for an employee. The new version is inserted with exactly the allowances it is given, then every other current version is superseded. Bank and payment details
-- carry over from the version being replaced, so a raise never drops an IBAN.
create or replace function _hr_set_current_pay(p_employee_id uuid, p_effective date, p_basic numeric, p_allowances jsonb, p_currency text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur compensation_details%rowtype;
  v_new uuid;
begin
  select * into v_cur from compensation_details where employee_id = p_employee_id and is_current order by effective_from desc, created_at desc limit 1;
  insert into compensation_details (employee_id, effective_from, base_salary, allowances, currency, payment_method, bank_name, bank_iban, bank_swift, created_by)
  values (p_employee_id, p_effective, p_basic, coalesce(p_allowances, '{}'::jsonb), upper(p_currency), v_cur.payment_method, v_cur.bank_name, v_cur.bank_iban, v_cur.bank_swift, p_actor)
  returning id into v_new;
  update compensation_details set is_current = false, superseded_by = v_new where employee_id = p_employee_id and is_current and id <> v_new;
  return v_new;
end;
$$;
revoke all on function _hr_set_current_pay(uuid, date, numeric, jsonb, text, uuid) from public, anon, authenticated;

-- Internal: apply one scheduled or just-recorded career event (title and/or pay). Returns 'applied', 'already' (it was applied or cancelled before; nothing is done), 'left' (the employee has
-- left or was removed; nothing is done) or 'conflict'.
-- Locks the employee FIRST and the event second, then decides everything from what it reads while holding both: the event's state, the employee's status and the current pay version.
-- A PAY change was worked out from one pay version (base_compensation_id). If that version is no longer the current one, someone changed pay since: applying now would overwrite the newer pay
-- (or put back a figure that was not edited, such as the basic salary of an "others only" change). Nothing is written then, title included, and the event is held with a reason for HR to review.
create or replace function _hr_apply_career_event(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e employee_career_events%rowtype;
  emp employees%rowtype;
  v_cur compensation_details%rowtype;
  v_employee uuid;
  v_currency text;
begin
  select employee_id into v_employee from employee_career_events where id = p_event_id;   -- an unlocked read, only to know whose lock to take first
  if v_employee is null then return 'already'; end if;
  emp := _hr_lock_employee(v_employee);                                                    -- lock 1: the employee
  select * into e from employee_career_events where id = p_event_id for update;            -- lock 2: the change
  if not found or e.applied_at is not null or e.dismissed_at is not null then return 'already'; end if;
  if emp.id is null or emp.deleted_at is not null or emp.employment_status = 'terminated' then return 'left'; end if;
  if e.new_base_salary is not null then
    select * into v_cur from compensation_details where employee_id = e.employee_id and is_current order by effective_from desc, created_at desc limit 1;
    if v_cur.id is distinct from e.base_compensation_id then
      update employee_career_events
         set conflict_at = now(),
             conflict_reason = case when v_cur.id is null then 'The pay this change was based on is no longer on record.'
                                    else format('Pay changed after this change was scheduled (the current pay has been in force since %s). It was not applied.', v_cur.effective_from) end
       where id = e.id;
      return 'conflict';
    end if;
  end if;
  if e.new_job_title is not null then
    update employees set job_title = e.new_job_title where id = e.employee_id;
  end if;
  if e.new_base_salary is not null then
    v_currency := coalesce(e.currency, v_cur.currency, (select c.default_currency from companies c where c.id = emp.company_id));
    perform _hr_set_current_pay(e.employee_id, e.effective_date, e.new_base_salary, coalesce(e.new_allowances, '{}'::jsonb), v_currency, e.created_by);
  end if;
  update employee_career_events set applied_at = now(), conflict_reason = null, conflict_at = null where id = e.id;
  return 'applied';
end;
$$;
revoke all on function _hr_apply_career_event(uuid) from public, anon, authenticated;

-- 3. (continued) The one job-and-pay change. Takes no "today" from the caller: the cutoff is the employee's own calendar day, read here.
create or replace function record_employment_change(
  p_employee_id uuid, p_effective_date date, p_job_title text, p_basic numeric, p_other numeric, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  emp employees%rowtype;
  cur compensation_details%rowtype;
  v_hr boolean;
  v_finance boolean;
  v_title text := nullif(btrim(coalesce(p_job_title, '')), '');
  v_today date;
  v_cur_other numeric := 0;
  v_base_allow jsonb;
  v_new_allow jsonb;
  v_title_changed boolean;
  v_pay_changed boolean;
  v_event_id uuid;
  v_due boolean;
  v_currency text;
  v_new_basic numeric;
  v_new_other numeric;
begin
  if auth.uid() is null then raise exception 'Sign in to change job or pay.' using errcode = '42501'; end if;
  emp := _hr_lock_employee(p_employee_id);   -- lock 1 (the same first lock as the daily job and the cancellation): serialises every change to this employee
  v_hr := emp.id is not null and has_role('hr_admin', emp.company_id);
  v_finance := emp.id is not null and has_role('finance', emp.company_id);
  if not (v_hr or v_finance) then raise exception 'You are not allowed to change this employee''s job or pay.' using errcode = '42501'; end if;
  if emp.deleted_at is not null or emp.employment_status = 'terminated' then raise exception 'This employee has left or was removed, so their job and pay cannot be changed.' using errcode = '22023'; end if;
  if p_effective_date is null then raise exception 'Enter the date the change takes effect.' using errcode = '22023'; end if;
  if p_effective_date < emp.hire_date then raise exception 'The change cannot take effect before the hire date (%).', emp.hire_date using errcode = '22023'; end if;
  if p_basic is not null and not (p_basic > 0) then raise exception 'Basic salary must be more than zero.' using errcode = '22023'; end if;
  if p_other is not null and p_other < 0 then raise exception 'Others cannot be negative.' using errcode = '22023'; end if;

  v_today := hr_business_today(emp.country_code);
  select * into cur from compensation_details where employee_id = emp.id and is_current order by effective_from desc, created_at desc limit 1;
  if found and jsonb_typeof(cur.allowances -> 'other') = 'number' then v_cur_other := (cur.allowances ->> 'other')::numeric; end if;
  v_base_allow := coalesce(cur.allowances, '{}'::jsonb);

  v_title_changed := v_title is not null and v_title is distinct from btrim(coalesce(emp.job_title, ''));
  v_pay_changed := (p_basic is not null and (cur.id is null or p_basic <> cur.base_salary)) or (p_other is not null and p_other <> v_cur_other);
  if not v_title_changed and not v_pay_changed then raise exception 'Nothing changed. Enter a new job title and/or new pay.' using errcode = '22023'; end if;
  if v_pay_changed and cur.id is null and p_basic is null then raise exception 'Enter the basic salary: there is no salary on record yet.' using errcode = '22023'; end if;
  if v_pay_changed and cur.id is not null and p_effective_date < cur.effective_from then raise exception 'The new pay cannot take effect before the current pay did (%).', cur.effective_from using errcode = '22023'; end if;

  v_due := p_effective_date <= v_today;
  v_new_basic := coalesce(p_basic, cur.base_salary);
  v_new_other := coalesce(p_other, v_cur_other);
  -- Only "Others" is edited here. Every other allowance on the current pay version (housing, transport, whatever HR or Finance recorded) is carried over exactly; a blank "Others" leaves it alone.
  v_new_allow := case when p_other is null then v_base_allow
                      when p_other > 0 then v_base_allow || jsonb_build_object('other', p_other)
                      else v_base_allow - 'other' end;
  v_currency := coalesce(cur.currency, (select default_currency from companies where id = emp.company_id));

  if not v_hr then
    -- Finance: pay only, in force already, and no career event (the event table is HR Admin's, as before).
    if v_title_changed then raise exception 'Only an HR Admin can change the job title.' using errcode = '42501'; end if;
    if not v_due then raise exception 'Only an HR Admin can schedule a pay change for a later date.' using errcode = '42501'; end if;
    perform _hr_set_current_pay(emp.id, p_effective_date, v_new_basic, v_new_allow, v_currency, auth.uid());
    return jsonb_build_object('status', 'applied', 'title_changed', false, 'pay_changed', true, 'event_id', null, 'business_date', v_today);
  end if;

  insert into employee_career_events (employee_id, event_type, effective_date, previous_job_title, new_job_title, previous_base_salary, new_base_salary, previous_allowances, new_allowances, currency, note, created_by, applied_at, base_compensation_id)
  values (emp.id,
          case when v_title_changed and v_pay_changed then 'promotion' when v_title_changed then 'title_change' else 'salary_change' end,
          p_effective_date, emp.job_title, case when v_title_changed then v_title end,
          cur.base_salary, case when v_pay_changed then v_new_basic end,
          cur.allowances, case when v_pay_changed then v_new_allow end,
          v_currency, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), null, case when v_pay_changed then cur.id end)
  returning id into v_event_id;
  if v_due and _hr_apply_career_event(v_event_id) <> 'applied' then
    raise exception 'The change could not be put in force because pay changed while it was being saved. Nothing was saved; try again.' using errcode = '40001';
  end if;
  return jsonb_build_object('status', case when v_due then 'applied' else 'scheduled' end, 'title_changed', v_title_changed, 'pay_changed', v_pay_changed, 'event_id', v_event_id, 'business_date', v_today);
end;
$$;
revoke all on function record_employment_change(uuid, date, text, numeric, numeric, text) from public, anon;
grant execute on function record_employment_change(uuid, date, text, numeric, numeric, text) to authenticated;

-- 4. The daily applier (service role only: the cron route). `p_at` exists so a test can name the instant; the route never passes it.
create or replace function apply_due_employment_changes(p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_outcome text;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_conflicts integer := 0;
  v_failed integer := 0;
  v_held jsonb := '[]'::jsonb;
  v_failures jsonb := '[]'::jsonb;
begin
  -- Wait at most 10 seconds for any one employee's lock: a session stuck on one employee is then reported as that event's failure instead of freezing the whole run.
  perform set_config('lock_timeout', '10s', true);
  -- Listing what is due takes NO lock. Each change is then handled by _hr_apply_career_event, which locks its employee first and rechecks everything (the change's state, the employee's
  -- status, the pay version) while holding the lock, so a list that went stale while an earlier change was being applied, or while a person was saving, does no harm.
  for r in
    select ev.id, ev.employee_id
    from employee_career_events ev
    join employees em on em.id = ev.employee_id
    where ev.applied_at is null and ev.dismissed_at is null and ev.effective_date <= hr_business_date(em.country_code, p_at)
    order by ev.effective_date, ev.created_at
  loop
    begin
      v_outcome := _hr_apply_career_event(r.id);
      if v_outcome = 'left' then
        v_skipped := v_skipped + 1;   -- the person has left: the event stays scheduled, visible, and is reported
      elsif v_outcome = 'applied' then
        v_applied := v_applied + 1;
      elsif v_outcome = 'conflict' then
        v_conflicts := v_conflicts + 1;   -- held for HR review; the reason is written on the event
        v_held := v_held || jsonb_build_object('event_id', r.id, 'employee_id', r.employee_id);
      end if;
    exception when others then
      -- This event's own writes are rolled back; the events applied earlier in this run are kept, and the next run tries this one again.
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object('event_id', r.id, 'employee_id', r.employee_id, 'sqlstate', sqlstate, 'message', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ran_at', p_at, 'applied', v_applied, 'skipped', v_skipped, 'conflicts', v_conflicts, 'failed', v_failed, 'held', v_held, 'failures', v_failures);
end;
$$;
revoke all on function apply_due_employment_changes(timestamptz) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function apply_due_employment_changes(timestamptz) to service_role;
  end if;
end $$;

-- 5. HR Admin cancels a scheduled change (including one held for review). The row stays, marked cancelled; nothing is deleted. The refusal is the same for no right and for an unknown event.
create or replace function dismiss_employment_change(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e employee_career_events%rowtype;
  emp employees%rowtype;
  v_employee uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to cancel a scheduled change.' using errcode = '42501'; end if;
  select employee_id into v_employee from employee_career_events where id = p_event_id;   -- an unlocked read, only to know whose lock to take first
  if v_employee is null then raise exception 'You are not allowed to cancel this change.' using errcode = '42501'; end if;
  emp := _hr_lock_employee(v_employee);                                                    -- lock 1: the employee (the same first lock as the save and the daily job)
  if emp.id is null or not has_role('hr_admin', emp.company_id) then raise exception 'You are not allowed to cancel this change.' using errcode = '42501'; end if;
  select * into e from employee_career_events where id = p_event_id for update;            -- lock 2: the change; its state is read only now, under both locks
  if not found then raise exception 'You are not allowed to cancel this change.' using errcode = '42501'; end if;
  if e.applied_at is not null then raise exception 'This change is already in force, so it cannot be cancelled. Record a new change instead.' using errcode = '22023'; end if;
  if e.dismissed_at is not null then return jsonb_build_object('status', 'cancelled', 'event_id', e.id); end if;   -- a second tap changes nothing
  update employee_career_events set dismissed_at = now(), dismissed_by = auth.uid() where id = e.id;
  return jsonb_build_object('status', 'cancelled', 'event_id', e.id);
end;
$$;
revoke all on function dismiss_employment_change(uuid) from public, anon;
grant execute on function dismiss_employment_change(uuid) to authenticated;
