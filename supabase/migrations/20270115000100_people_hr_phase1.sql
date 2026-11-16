-- People & HR Phase 1: ONE effective-dated job-and-pay change process, and an opening balance that can only be recorded once.
-- ADDITIVE: one new column, one index, two partial unique indexes and four functions (one callable by a signed-in user, one by the service role only, two internal). No existing table, policy,
-- function or grant is changed, and no existing row is rewritten except the one-time `applied_at` marker described in 1.
-- Install order: preflight (supabase/manual-sql/people_hr_phase1_00_preflight_readonly.sql), this migration, verify (..._20_verify_readonly.sql), then deploy the app.
-- Rollback: supabase/manual-sql/people_hr_phase1_90_rollback.sql (it stops while any change is still scheduled).
--
-- THIS MIGRATION FAILS (and changes nothing: it runs as one transaction) IF an employee already has two opening-balance rows for the same leave type, or two opening comp-day rows. The preflight
-- counts them; the expected answer is 0. If it is not 0, do not delete anything: decide with HR which row is the true opening balance first.
--
-- WHAT IT DOES
--   1. employee_career_events.applied_at: null = SCHEDULED (a change dated in the future, not yet in force); a time = applied. Every existing row is marked applied at the time it was written.
--      The column default is now(), so a row written by the PREVIOUS app build during the install window (which always applied its change at once) counts as applied. The new app sets it
--      explicitly (null for a scheduled change).
--   2. record_employment_change(): the one entry point for a job title and/or pay change. HR Admin of the employee's company may change either (an audit event is written); Finance may change pay
--      only, dated today or earlier, with no event row (exactly what its existing compensation tool did). A change dated today or earlier is applied in the same transaction as the event: the job
--      title and the pay save together or not at all. A change dated later is saved as a scheduled event and changes nothing yet. A caller with no right, or an employee they cannot manage, gets the
--      same refusal, so the function cannot be used to find out whether an employee exists.
--   3. apply_due_employment_changes(country, today): called once a day by the cron route with the service role only; applies the scheduled events that have come due for that country, in date order,
--      each on its own, and leaves an event unapplied (and says so) when its employee has left or was removed.
--   4. Two partial unique indexes: one opening-balance row per employee and leave type in leave_ledger, and one opening comp-day row per employee in comp_day_ledger. The leave-accrual baseline
--      depends on the 'opening_balance' tag, so a second row would silently change entitlement; the app checks first and these indexes close the race between two clicks.

-- 1. Scheduled / applied marker.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employee_career_events' and column_name = 'applied_at') then
    alter table employee_career_events add column applied_at timestamptz;
    update employee_career_events set applied_at = created_at;   -- every row so far was applied when it was written; the audit trigger on this table is insert-only
  end if;
end $$;
alter table employee_career_events alter column applied_at set default now();
create index if not exists idx_career_events_scheduled on employee_career_events (effective_date) where applied_at is null;

-- 4. One opening balance each (created first so a duplicate stops the migration before anything else is installed).
create unique index if not exists leave_ledger_opening_balance_unique on leave_ledger (employee_id, leave_type_code) where reference_type = 'opening_balance';
create unique index if not exists comp_day_ledger_opening_balance_unique on comp_day_ledger (employee_id) where source = 'opening_balance';

-- Internal: put a pay version in force for an employee. The new version is inserted, then every other current version is superseded. Bank and payment details carry over from the version
-- being replaced, so a raise never drops an IBAN.
create or replace function _hr_set_current_pay(p_employee_id uuid, p_effective date, p_basic numeric, p_other numeric, p_currency text, p_actor uuid)
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
  values (p_employee_id, p_effective, p_basic, case when coalesce(p_other, 0) > 0 then jsonb_build_object('other', p_other) else '{}'::jsonb end, upper(p_currency),
          v_cur.payment_method, v_cur.bank_name, v_cur.bank_iban, v_cur.bank_swift, p_actor)
  returning id into v_new;
  update compensation_details set is_current = false, superseded_by = v_new where employee_id = p_employee_id and is_current and id <> v_new;
  return v_new;
end;
$$;
revoke all on function _hr_set_current_pay(uuid, date, numeric, numeric, text, uuid) from public, anon, authenticated;

-- Internal: apply one scheduled or just-recorded career event (title and/or pay) and mark it applied. Safe to call twice: an applied event is left alone.
create or replace function _hr_apply_career_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e employee_career_events%rowtype;
  v_currency text;
begin
  select * into e from employee_career_events where id = p_event_id for update;
  if not found or e.applied_at is not null then return; end if;
  if e.new_job_title is not null then
    update employees set job_title = e.new_job_title where id = e.employee_id;
  end if;
  if e.new_base_salary is not null then
    v_currency := coalesce(e.currency,
      (select currency from compensation_details where employee_id = e.employee_id and is_current order by effective_from desc, created_at desc limit 1),
      (select c.default_currency from employees em join companies c on c.id = em.company_id where em.id = e.employee_id));
    perform _hr_set_current_pay(e.employee_id, e.effective_date, e.new_base_salary, coalesce((e.new_allowances ->> 'other')::numeric, 0), v_currency, e.created_by);
  end if;
  update employee_career_events set applied_at = now() where id = e.id;
end;
$$;
revoke all on function _hr_apply_career_event(uuid) from public, anon, authenticated;

-- 2. The one job-and-pay change.
create or replace function record_employment_change(
  p_employee_id uuid, p_effective_date date, p_job_title text, p_basic numeric, p_other numeric, p_note text, p_today date)
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
  v_cur_other numeric := 0;
  v_title_changed boolean;
  v_pay_changed boolean;
  v_event_id uuid;
  v_due boolean;
  v_currency text;
  v_new_basic numeric;
  v_new_other numeric;
begin
  if auth.uid() is null then raise exception 'Sign in to change job or pay.' using errcode = '42501'; end if;
  select * into emp from employees where id = p_employee_id for update;   -- serialises two changes to the same employee
  v_hr := found and has_role('hr_admin', emp.company_id);
  v_finance := found and has_role('finance', emp.company_id);
  if not (v_hr or v_finance) then raise exception 'You are not allowed to change this employee''s job or pay.' using errcode = '42501'; end if;
  if emp.deleted_at is not null or emp.employment_status = 'terminated' then raise exception 'This employee has left or was removed, so their job and pay cannot be changed.' using errcode = '22023'; end if;
  if p_effective_date is null or p_today is null then raise exception 'Enter the date the change takes effect.' using errcode = '22023'; end if;
  if p_effective_date < emp.hire_date then raise exception 'The change cannot take effect before the hire date (%).', emp.hire_date using errcode = '22023'; end if;
  if p_basic is not null and not (p_basic > 0) then raise exception 'Basic salary must be more than zero.' using errcode = '22023'; end if;
  if p_other is not null and p_other < 0 then raise exception 'Others cannot be negative.' using errcode = '22023'; end if;

  select * into cur from compensation_details where employee_id = emp.id and is_current order by effective_from desc, created_at desc limit 1;
  if found and jsonb_typeof(cur.allowances -> 'other') = 'number' then v_cur_other := (cur.allowances ->> 'other')::numeric; end if;

  v_title_changed := v_title is not null and v_title is distinct from btrim(coalesce(emp.job_title, ''));
  v_pay_changed := (p_basic is not null and (cur.id is null or p_basic <> cur.base_salary)) or (p_other is not null and p_other <> v_cur_other);
  if not v_title_changed and not v_pay_changed then raise exception 'Nothing changed. Enter a new job title and/or new pay.' using errcode = '22023'; end if;
  if v_pay_changed and cur.id is null and p_basic is null then raise exception 'Enter the basic salary: there is no salary on record yet.' using errcode = '22023'; end if;
  if v_pay_changed and cur.id is not null and p_effective_date < cur.effective_from then raise exception 'The new pay cannot take effect before the current pay did (%).', cur.effective_from using errcode = '22023'; end if;

  v_due := p_effective_date <= p_today;
  v_new_basic := coalesce(p_basic, cur.base_salary);
  v_new_other := coalesce(p_other, v_cur_other);
  v_currency := coalesce(cur.currency, (select default_currency from companies where id = emp.company_id));

  if not v_hr then
    -- Finance: pay only, in force already, and no career event (the event table is HR Admin's, as before).
    if v_title_changed then raise exception 'Only an HR Admin can change the job title.' using errcode = '42501'; end if;
    if not v_due then raise exception 'Only an HR Admin can schedule a pay change for a later date.' using errcode = '42501'; end if;
    perform _hr_set_current_pay(emp.id, p_effective_date, v_new_basic, v_new_other, v_currency, auth.uid());
    return jsonb_build_object('status', 'applied', 'title_changed', false, 'pay_changed', true, 'event_id', null);
  end if;

  insert into employee_career_events (employee_id, event_type, effective_date, previous_job_title, new_job_title, previous_base_salary, new_base_salary, previous_allowances, new_allowances, currency, note, created_by, applied_at)
  values (emp.id,
          case when v_title_changed and v_pay_changed then 'promotion' when v_title_changed then 'title_change' else 'salary_change' end,
          p_effective_date, emp.job_title, case when v_title_changed then v_title end,
          cur.base_salary, case when v_pay_changed then v_new_basic end,
          cur.allowances, case when v_pay_changed then (case when v_new_other > 0 then jsonb_build_object('other', v_new_other) else '{}'::jsonb end) end,
          v_currency, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), null)
  returning id into v_event_id;
  if v_due then perform _hr_apply_career_event(v_event_id); end if;
  return jsonb_build_object('status', case when v_due then 'applied' else 'scheduled' end, 'title_changed', v_title_changed, 'pay_changed', v_pay_changed, 'event_id', v_event_id);
end;
$$;
revoke all on function record_employment_change(uuid, date, text, numeric, numeric, text, date) from public, anon;
grant execute on function record_employment_change(uuid, date, text, numeric, numeric, text, date) to authenticated;

-- 3. The daily applier (service role only: the cron route).
create or replace function apply_due_employment_changes(p_country text, p_today date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  for r in
    select ev.id, em.employment_status, em.deleted_at
    from employee_career_events ev
    join employees em on em.id = ev.employee_id
    where ev.applied_at is null and ev.effective_date <= p_today and em.country_code = p_country
    order by ev.effective_date, ev.created_at
    for update of ev skip locked
  loop
    if r.deleted_at is not null or r.employment_status = 'terminated' then
      v_skipped := v_skipped + 1;   -- the person has left: the event stays scheduled, visible, and is reported
      continue;
    end if;
    begin
      perform _hr_apply_career_event(r.id);
      v_applied := v_applied + 1;
    exception when others then
      v_failed := v_failed + 1;     -- this event's own writes are rolled back; the next run tries again
    end;
  end loop;
  return jsonb_build_object('country', p_country, 'today', p_today, 'applied', v_applied, 'skipped', v_skipped, 'failed', v_failed);
end;
$$;
revoke all on function apply_due_employment_changes(text, date) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function apply_due_employment_changes(text, date) to service_role;
  end if;
end $$;
