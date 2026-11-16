-- People & HR: "Correct pay record". A pay record entered by mistake (the usual case: the CURRENT salary saved with the JOINING date as its effective date) can be corrected, with the original kept.
-- ADDITIVE: one new table (compensation_corrections), one internal helper and ONE function callable by a signed-in user (correct_pay_record, the only way a pay record is ever corrected).
-- No existing table, column, policy, function or grant is changed, and no existing row is rewritten. Nothing is added to the Update pay flow (record_employment_change is untouched).
-- Install order: preflight (supabase/manual-sql/people_hr_pay_correction_00_preflight_readonly.sql), this migration, verify (..._20_verify_readonly.sql), then deploy the app.
-- Rollback: supabase/manual-sql/people_hr_pay_correction_90_rollback.sql (it stops while any correction exists, because dropping the table would erase the original values).
-- Needs: People & HR Phase 1 (20270115000100: _hr_lock_employee, hr_business_today, employee_career_events.applied_at / dismissed_at / base_compensation_id).
--
-- WHAT IT DOES. correct_pay_record() fixes ONE pay record (one row of compensation_details) IN PLACE: its effective date, its basic salary and/or its allowances. The row keeps its id, so a scheduled
-- change that was worked out from it still points at it, and the audit trigger on compensation_details records the old and the new row as it does for every other change. The values the record had
-- BEFORE the correction are copied into compensation_corrections (append-only: no update, no delete, not even by the owner role through the app) together with the new values, the reason, who and when.
-- The original entry therefore stays recoverable and visible: the first correction of a record holds its original values.
--
-- WHO. The same company permission the existing pay change uses (record_employment_change): HR Admin or Finance of the employee's company. Nobody else, no other company, an unknown record and a
-- record of someone else all get the same refusal. A removed employee (deleted_at) cannot be corrected. A person who has LEFT can be corrected (their final settlement reads their pay, and a mistaken
-- record must still be fixable); the result then says whether the final settlement reads the corrected record, for a person to review.
--
-- LOCKS (the same order as the save, the daily job and the cancellation). The employee's row in `employees` is locked FIRST (_hr_lock_employee), then the pay record's row, and only then is anything
-- decided from what is read. Two sessions touching one employee run one after the other.
--
-- THE RULES (everything is checked under the locks; the first failing rule stops the call and nothing is written)
--   1. Date. A corrected date must not be before the hire date, and not after today in the employee's own calendar (a later date is a scheduled change: use Update pay). A record that is ALREADY dated
--      later (older data) may keep its date while only its amount is corrected.
--   2. No reordering, no overlap, no duplicate. Pay records are a chain ordered by their effective date; each is in force from its date until the next record's date. A corrected date must stay STRICTLY
--      AFTER the effective date of the record before it and STRICTLY BEFORE the effective date of the record after it. A date equal to another record's date would give two records the same start (a
--      duplicate), and a date past a neighbour would reorder history. Both are refused with the neighbour's date in the sentence; the person corrects that record first, or picks a date between them.
--   3. Pending (scheduled or held) pay changes. A PENDING pay change is a scheduled change that is neither applied nor cancelled, with a pay figure in it.
--        a. If it was worked out from THIS record (it points at it) and the correction changes the AMOUNT, the correction is REFUSED: the scheduled change carries amounts copied from the old figures and
--           would put them back on its date. The person cancels the scheduled change, corrects the record, and records the change again.
--        b. If it takes effect on or before the corrected date of this record, a DATE correction is refused (applying it later would put it before this record).
--        c. A change the daily job HELD for review is never applied, so it never blocks a correction. It is listed in the result so a person can see it.
--      A pending change that is only a job title change is not about pay and is ignored. A date-only correction of the record a pending change points at is allowed (the amounts it carries are still right).
--   4. Amounts. Basic salary must be more than zero; allowances must be an object whose values are numbers of zero or more and whose names are ones the record already has, or "other" (the same set the
--      existing flow can edit). Currency and bank details are never changed here. Something must change.
--   5. A reason of at least 5 characters is required.
--
-- IMPACT (recorded, never acted on). The function does NOT touch any payroll export or final settlement. It looks for:
--   * APPROVED payroll runs of the employee's company that carry a salary line (basic salary or other allowance) for this employee and whose month overlaps the record's OLD or NEW effective period.
--     (A record's period runs from its effective date to the day before the next record's date, open-ended for the latest record.) Sent runs are listed with their sent date.
--   * a FINAL SETTLEMENT: the settlement is worked out live for a person who has left, from the pay record marked current, so it is flagged when the employee has left and the corrected record is the
--     current one or its old or new period contains the termination date. (No settlement figure is stored anywhere, so nothing can be stored or altered; the flag says "recalculate and review".)
--   The flags, the held and pending changes and the pay in force today BEFORE and AFTER are stored in compensation_corrections.impact and returned, so the screen can say "This correction affects ...".
--
-- IDEMPOTENT. The caller sends a request key (one per form opened). The same key for the same employee returns the correction already stored (status 'already_applied') and writes nothing; a second
-- correction row cannot exist (unique on employee and key). The same key used for a different pay record is refused.
--
-- RE-RUNNABLE: `if not exists` / `create or replace` / drop policy and trigger if exists.

create table if not exists compensation_corrections (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id),
  employee_id            uuid not null references employees(id),
  compensation_id        uuid not null references compensation_details(id),
  request_key            text not null check (char_length(request_key) between 8 and 100),
  previous_effective_from date not null,
  previous_base_salary   numeric(14,2) not null,
  previous_allowances    jsonb not null,
  new_effective_from     date not null,
  new_base_salary        numeric(14,2) not null,
  new_allowances         jsonb not null,
  currency               text not null,
  reason                 text not null check (char_length(btrim(reason)) between 5 and 500),
  corrected_by           uuid not null references auth.users(id),
  corrected_at           timestamptz not null default now(),
  impact                 jsonb not null default '{}'::jsonb,   -- payroll_runs, final_settlement, pending_changes, in_force_today_before, in_force_today_after
  unique (employee_id, request_key),
  check (previous_effective_from <> new_effective_from or previous_base_salary <> new_base_salary or previous_allowances <> new_allowances)
);
create index if not exists idx_compensation_corrections_employee on compensation_corrections (employee_id, corrected_at desc);
create index if not exists idx_compensation_corrections_record on compensation_corrections (compensation_id, corrected_at);

alter table compensation_corrections enable row level security;

-- WHO CAN READ. A correction holds the old and new pay and the payroll it touches, so it is exactly as visible as the pay history it belongs to for staff: HR Admin or Finance of the employee's company.
-- (The employee reads their own current pay as before; the reasons and payroll flags are staff notes.) There is no insert, update or delete policy, so every direct write by a signed-in user is refused
-- by row level security; the function below is the only way in.
drop policy if exists compensation_corrections_select on compensation_corrections;
create policy compensation_corrections_select on compensation_corrections for select
  using (has_role('hr_admin', company_id) or has_role('finance', company_id));

revoke all on compensation_corrections from anon;
revoke insert, update, delete, truncate on compensation_corrections from authenticated;

-- Append-only, whoever asks (the function only ever inserts): the original values must stay recoverable.
create or replace function compensation_corrections_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A pay correction is a permanent record and cannot be changed or removed.' using errcode = '42501';
end;
$$;
drop trigger if exists compensation_corrections_no_change on compensation_corrections;
create trigger compensation_corrections_no_change before update or delete on compensation_corrections
  for each row execute function compensation_corrections_append_only();

-- Audit: who corrected what, through the same trigger every other HR table uses (company_id is a column here, so the audit row is scoped to the company).
drop trigger if exists audit_compensation_corrections on compensation_corrections;
create trigger audit_compensation_corrections after insert on compensation_corrections
  for each row execute function write_audit_log();

-- Internal: the pay record in force for an employee on a date (the latest effective date on or before it), as a small json object; null when none is.
create or replace function _hr_pay_in_force(p_employee_id uuid, p_on date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', c.id, 'effective_from', c.effective_from, 'base_salary', c.base_salary, 'allowances', c.allowances, 'currency', c.currency)
  from compensation_details c
  where c.employee_id = p_employee_id and c.effective_from <= p_on
  order by c.effective_from desc, c.created_at desc
  limit 1;
$$;
revoke all on function _hr_pay_in_force(uuid, date) from public, anon, authenticated;

-- The one correction. See the header for every rule.
create or replace function correct_pay_record(
  p_compensation_id uuid,
  p_effective_from date,      -- the corrected date; null = leave the date as it is
  p_basic numeric,            -- the corrected basic salary; null = leave it
  p_allowances jsonb,         -- the corrected allowances as a whole object; null = leave them
  p_reason text,
  p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
  emp employees%rowtype;
  rec compensation_details%rowtype;
  prev compensation_details%rowtype;
  nxt compensation_details%rowtype;
  v_existing compensation_corrections%rowtype;
  v_today date;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_date date;
  v_basic numeric;
  v_allow jsonb;
  v_amount_changed boolean;
  v_date_changed boolean;
  v_key text;
  v_val jsonb;
  v_from date;
  v_to date;
  v_runs jsonb;
  v_settlement jsonb := null;
  v_pending jsonb;
  v_before jsonb;
  v_after jsonb;
  v_impact jsonb;
  v_pending_event employee_career_events%rowtype;
  v_correction uuid;
  v_denied constant text := 'You are not allowed to correct this pay record.';
begin
  if auth.uid() is null then raise exception 'Sign in to correct a pay record.' using errcode = '42501'; end if;

  select employee_id into v_employee from compensation_details where id = p_compensation_id;   -- an unlocked read, only to know whose lock to take first
  if v_employee is null then raise exception '%', v_denied using errcode = '42501'; end if;
  emp := _hr_lock_employee(v_employee);                                                          -- lock 1: the employee (the same first lock as the save, the daily job and the cancellation)
  if emp.id is null or not (has_role('hr_admin', emp.company_id) or has_role('finance', emp.company_id)) then raise exception '%', v_denied using errcode = '42501'; end if;
  select * into rec from compensation_details where id = p_compensation_id and employee_id = emp.id for update;   -- lock 2: the pay record; read only now, under both locks
  if not found then raise exception '%', v_denied using errcode = '42501'; end if;

  -- A retry (the same request key) returns what was stored the first time and writes nothing. Decided before any rule below, because those rules look at the data AFTER the first save.
  if p_request_key is null or char_length(p_request_key) not between 8 and 100 then raise exception 'Reload the page and try again.' using errcode = '22023'; end if;
  select * into v_existing from compensation_corrections where employee_id = emp.id and request_key = p_request_key;
  if found then
    if v_existing.compensation_id <> rec.id then raise exception 'This request was already used for a different pay record. Reload the page and try again.' using errcode = '22023'; end if;
    return jsonb_build_object('status', 'already_applied', 'correction_id', v_existing.id, 'compensation_id', rec.id, 'employee_id', emp.id,
                              'previous', jsonb_build_object('effective_from', v_existing.previous_effective_from, 'base_salary', v_existing.previous_base_salary, 'allowances', v_existing.previous_allowances),
                              'new', jsonb_build_object('effective_from', v_existing.new_effective_from, 'base_salary', v_existing.new_base_salary, 'allowances', v_existing.new_allowances),
                              'impact', v_existing.impact);
  end if;

  if emp.deleted_at is not null then raise exception 'This employee was removed, so their pay records cannot be corrected.' using errcode = '22023'; end if;
  if char_length(v_reason) < 5 then raise exception 'Enter the reason for the correction (at least 5 characters).' using errcode = '22023'; end if;
  if char_length(v_reason) > 500 then raise exception 'Keep the reason under 500 characters.' using errcode = '22023'; end if;

  -- Rule 4: the new figures.
  v_date := coalesce(p_effective_from, rec.effective_from);
  v_basic := round(coalesce(p_basic, rec.base_salary), 2);
  v_allow := coalesce(p_allowances, rec.allowances);
  if not (v_basic > 0) then raise exception 'Basic salary must be more than zero.' using errcode = '22023'; end if;
  if v_basic >= 1000000000000 then raise exception 'That basic salary is too large.' using errcode = '22023'; end if;
  if jsonb_typeof(v_allow) <> 'object' then raise exception 'The allowances are not valid. Reload the page and try again.' using errcode = '22023'; end if;
  for v_key, v_val in select * from jsonb_each(v_allow) loop
    if v_key <> 'other' and not (rec.allowances ? v_key) then raise exception 'This pay record has no allowance called "%".', left(v_key, 40) using errcode = '22023'; end if;
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric < 0 then raise exception 'Allowances must be numbers of zero or more.' using errcode = '22023'; end if;
    if (v_val #>> '{}')::numeric >= 1000000000000 then raise exception 'That allowance is too large.' using errcode = '22023'; end if;
  end loop;
  v_date_changed := v_date is distinct from rec.effective_from;
  v_amount_changed := v_basic is distinct from rec.base_salary or v_allow is distinct from rec.allowances;
  if not v_date_changed and not v_amount_changed then raise exception 'Nothing changed. Enter a new effective date and/or new pay.' using errcode = '22023'; end if;

  v_today := hr_business_today(emp.country_code);

  -- Rules 1 and 2: the date.
  select * into prev from compensation_details
    where employee_id = emp.id and id <> rec.id and (effective_from, created_at) < (rec.effective_from, rec.created_at)
    order by effective_from desc, created_at desc limit 1;
  select * into nxt from compensation_details
    where employee_id = emp.id and id <> rec.id and (effective_from, created_at) > (rec.effective_from, rec.created_at)
    order by effective_from asc, created_at asc limit 1;
  if v_date_changed then
    if v_date < emp.hire_date then raise exception 'The pay record cannot start before the hire date (%).', emp.hire_date using errcode = '22023'; end if;
    if v_date > v_today then raise exception 'The effective date cannot be later than today (%). To schedule a future pay change, use Update pay.', v_today using errcode = '22023'; end if;
    if prev.id is not null and v_date = prev.effective_from then raise exception 'Another pay record already starts on %. Two pay records cannot start on the same day.', prev.effective_from using errcode = '22023'; end if;
    if nxt.id is not null and v_date = nxt.effective_from then raise exception 'Another pay record already starts on %. Two pay records cannot start on the same day.', nxt.effective_from using errcode = '22023'; end if;
    if prev.id is not null and v_date < prev.effective_from then raise exception 'That date is before the pay record that starts on %, which would put the records out of order. Pick a date after %, or correct that record first.', prev.effective_from, prev.effective_from using errcode = '22023'; end if;
    if nxt.id is not null and v_date > nxt.effective_from then raise exception 'That date is after the next pay record, which starts on %, and would put the records out of order. Pick a date before %, or correct that record first.', nxt.effective_from, nxt.effective_from using errcode = '22023'; end if;
    if rec.effective_to is not null and v_date > rec.effective_to then raise exception 'That date is after the end date of this pay record (%).', rec.effective_to using errcode = '22023'; end if;
  end if;

  -- Rule 3: pending pay changes.
  for v_pending_event in
    select * from employee_career_events
    where employee_id = emp.id and applied_at is null and dismissed_at is null and new_base_salary is not null and conflict_at is null
    order by effective_date
  loop
    if v_amount_changed and v_pending_event.base_compensation_id = rec.id then
      raise exception 'A pay change for % is already scheduled from this pay record''s current figures. Cancel that scheduled change first, correct this record, then record the change again.', v_pending_event.effective_date using errcode = '22023';
    end if;
    if v_date_changed and v_pending_event.effective_date <= v_date then
      raise exception 'A pay change is scheduled for %. The corrected date must be before it. Cancel that scheduled change first, or pick an earlier date.', v_pending_event.effective_date using errcode = '22023';
    end if;
  end loop;

  -- Impact: this record's period before and after (from its own date to the day before the next record's date; open-ended for the latest record).
  v_from := least(rec.effective_from, v_date);
  v_to := case when nxt.id is null then null else nxt.effective_from - 1 end;
  select coalesce(jsonb_agg(jsonb_build_object('run_id', r.id, 'period_month', r.period_month, 'period_year', r.period_year, 'status', r.status, 'sent_at', r.sent_at) order by r.period_year, r.period_month), '[]'::jsonb)
    into v_runs
    from payroll_export_runs r
    where r.company_id = emp.company_id and r.status = 'approved'
      and (make_date(r.period_year, r.period_month, 1) + interval '1 month' - interval '1 day')::date >= v_from
      and make_date(r.period_year, r.period_month, 1) <= coalesce(v_to, 'infinity'::date)
      and exists (select 1 from payroll_export_lines l where l.run_id = r.id and l.employee_id = emp.id and l.component_code in ('basic_salary', 'other_allowance'));
  if emp.employment_status = 'terminated' and emp.termination_date is not null
     and (rec.is_current or (emp.termination_date >= v_from and emp.termination_date <= coalesce(v_to, 'infinity'::date))) then
    v_settlement := jsonb_build_object('termination_date', emp.termination_date, 'reads_current_pay', rec.is_current,
                                       'statutory_rate_recorded', exists (select 1 from termination_settlement_inputs t where t.employee_id = emp.id));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('event_id', e.id, 'effective_date', e.effective_date, 'held', e.conflict_at is not null) order by e.effective_date), '[]'::jsonb)
    into v_pending
    from employee_career_events e
    where e.employee_id = emp.id and e.applied_at is null and e.dismissed_at is null and e.new_base_salary is not null;

  v_before := _hr_pay_in_force(emp.id, v_today);
  update compensation_details set effective_from = v_date, base_salary = v_basic, allowances = v_allow where id = rec.id;   -- the only row changed; the audit trigger records old and new
  v_after := _hr_pay_in_force(emp.id, v_today);

  v_impact := jsonb_build_object('payroll_runs', v_runs, 'final_settlement', v_settlement, 'pending_changes', v_pending, 'in_force_today_before', v_before, 'in_force_today_after', v_after);
  insert into compensation_corrections (company_id, employee_id, compensation_id, request_key, previous_effective_from, previous_base_salary, previous_allowances,
                                        new_effective_from, new_base_salary, new_allowances, currency, reason, corrected_by, impact)
  values (emp.company_id, emp.id, rec.id, p_request_key, rec.effective_from, rec.base_salary, rec.allowances, v_date, v_basic, v_allow, rec.currency, v_reason, auth.uid(), v_impact)
  returning id into v_correction;

  return jsonb_build_object('status', 'applied', 'correction_id', v_correction, 'compensation_id', rec.id, 'employee_id', emp.id,
                            'previous', jsonb_build_object('effective_from', rec.effective_from, 'base_salary', rec.base_salary, 'allowances', rec.allowances),
                            'new', jsonb_build_object('effective_from', v_date, 'base_salary', v_basic, 'allowances', v_allow),
                            'impact', v_impact);
end;
$$;
revoke all on function correct_pay_record(uuid, date, numeric, jsonb, text, text) from public, anon;
grant execute on function correct_pay_record(uuid, date, numeric, jsonb, text, text) to authenticated;
