-- Phase 2b (leave-policy-configuration): schema + RPC additions supporting
-- regional Annual Leave policies and the Recovery Leave benefit. This
-- migration is DRAFT — created on the phase2b/leave-policy-configuration
-- branch, deliberately NOT applied to the shared Supabase database.
--
-- CORRECTION ROUND (independent QA): the first version of this migration
-- let record_attendance_and_recovery()/record_overnight_recovery_credit()
-- post an 'earned' comp_day_ledger row directly, with no approval at all.
-- That violated the required Line-Manager-then-HR-Admin sequence and used a
-- flat, country-configured credit amount instead of the policy brief's
-- hour-threshold rule. This version replaces that: earning a recovery
-- credit is now itself an approvable entity ('recovery_credit', routed
-- through the SAME generic approval engine every other entity type uses),
-- and the ledger is only ever credited at HR Admin's final approval. See
-- the "Recovery Leave: earning is now approval-gated" section below.
--
-- What this migration still deliberately does NOT do, and why:
--   - It does not touch decide_leave_approval()'s LEAVE consumption for
--     other, non-comp-day-exclusive leave types beyond the one safety fix
--     described below (a comp-day-exclusive leave type must never overdraw
--     into an unconfigured leave_ledger fallback) — every other leave
--     type's existing behavior (draw from leave_ledger, no balance check)
--     is left exactly as it was, since no deduction_priority_rules row has
--     ever been configured for them and this migration adds none for them.
--   - It does not create a new, separate approval mechanism for Recovery
--     Leave earning or consumption. Both reuse the existing
--     approval_workflows/approval_workflow_steps/approvals machinery,
--     extended with one new approvable_entity value.
--   - It does not touch or overwrite countries.week_start_day, or set any
--     value into the new working_weekdays column, for AE, SA or PL. See
--     the "UAE/Saudi/Poland workweek" section below.
--   - It does not insert draft policies with an unattributed placeholder
--     actor. See the "Migration safety" section below.

-- -----------------------------------------------------------------------------
-- 0. Ensure AE/SA/PL exist before anything below references them.
-- -----------------------------------------------------------------------------
-- Defensive, idempotent: a fresh migrations-only database (this migration's
-- own local-harness test run, which never runs seed.sql) doesn't have
-- AE/SA/PL yet, but this migration's deduction_priority_rules and
-- public_holidays rows below both have a foreign key to countries(code).
-- seed.sql already inserts these same three rows the same way for a real
-- project bootstrap; repeating it here (same values, same `on conflict do
-- nothing`) makes this migration safe to apply on its own regardless of
-- whether seed.sql has already run.
insert into countries (code, name, default_currency, week_start_day) values
  ('AE', 'United Arab Emirates', 'AED', 0),
  ('SA', 'Saudi Arabia', 'SAR', 0),
  ('PL', 'Poland', 'PLN', 1)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 1. Smallest auditable data-model additions (all nullable / safely defaulted)
-- -----------------------------------------------------------------------------

-- Poland: part-time entitlement must be prorated. No existing field
-- expresses a contract's FTE fraction; every existing row defaults to 1.0
-- (full-time), so nothing existing changes meaning.
alter table employment_contracts
  add column if not exists fte_fraction numeric(4,3) not null default 1.0
    check (fte_fraction > 0 and fte_fraction <= 1);

-- Poland: "recognised prior service/education" toward the 10-year
-- threshold is explicitly an HR-controlled input, not a computed value —
-- this system has no field that models it correctly today. Nullable;
-- null means "no recognised prior service", identical to today's
-- behavior for every existing employee.
alter table employees
  add column if not exists recognised_prior_service_years numeric(4,2)
    check (recognised_prior_service_years is null or recognised_prior_service_years >= 0);

-- Overnight recovery eligibility must be derived from verified working-time
-- information, never a browser-supplied flag — but attendance_records'
-- existing clock_in/clock_out (timestamptz) columns are never populated or
-- read anywhere in this codebase today, so trusting them now would mean
-- trusting invented values. These two columns are the smallest safe
-- addition: the same HR/manager-attested trust model attendance_records
-- already uses for `status`/`hours_worked` (RLS already restricts writes
-- to HR Admin; record_overnight_recovery_credit() below additionally
-- allows the employee's own manager, per the policy brief's "Line Manager
-- may immediately release the employee" — attested facts, not raw clock
-- times, and not employee-self-supplied.
alter table attendance_records
  add column if not exists completed_normal_scheduled_day boolean,
  add column if not exists active_hours_after_midnight numeric(4,2)
    check (active_hours_after_midnight is null or active_hours_after_midnight >= 0);

-- -----------------------------------------------------------------------------
-- 1b. UAE/Saudi/Poland workweek — read-only preflight, no data written
-- -----------------------------------------------------------------------------
-- A single week_start_day integer can only ever describe a CONTIGUOUS
-- 5-day work week — it cannot represent an arbitrary set of working
-- weekdays, and (more importantly here) this correction brief's stated
-- convention for the UAE ("Monday-Friday") does not match this system's
-- existing UAE country row (week_start_day = 0, i.e. Sunday-start, which
-- derives a Friday/Saturday weekend — the real-world UAE working week, and
-- the value seed.sql has always used). That is a genuine conflict between
-- this brief and the system's existing, deliberately-chosen configuration,
-- not a bug to silently "fix" in either direction — so this migration adds
-- ONLY the additive representation and a read-only preflight function that
-- reports the conflict; it does not write working_weekdays for AE, SA or
-- PL, and does not touch week_start_day. HR/engineering must decide and
-- apply that change explicitly and separately, after reviewing
-- preflight_country_schedule_config()'s output — see this migration's
-- accompanying report for the exact call to run.
alter table countries
  add column if not exists working_weekdays integer[];

-- Read-only. Compares each of AE/SA/PL's CURRENT derived working week
-- (from week_start_day, the only thing actually in effect today) against
-- this brief's requested convention, and flags any country where the two
-- disagree. Callable by any authenticated user, same openness as
-- resolve_policy() — this is aggregate configuration, not employee data.
create or replace function preflight_country_schedule_config()
returns table(
  country_code text,
  week_start_day smallint,
  working_weekdays integer[],
  derived_working_days_from_week_start_day integer[],
  requested_convention text,
  conflicts_with_requested_convention boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.code,
    c.week_start_day,
    c.working_weekdays,
    derived.days,
    req.convention,
    (req.expected is not null and derived.days is distinct from req.expected)
  from countries c
  cross join lateral (
    select array_agg(d order by d) as days
    from generate_series(0, 6) as d
    where ((d - coalesce(c.week_start_day, 1) + 7) % 7) < 5
  ) as derived
  cross join lateral (
    select
      case c.code
        when 'AE' then 'Monday-Friday (per this correction brief)'
        when 'SA' then 'Sunday-Thursday (per this correction brief)'
        when 'PL' then 'Monday-Friday (per this correction brief)'
        else null
      end as convention,
      case c.code
        when 'AE' then array[1,2,3,4,5]
        when 'SA' then array[0,1,2,3,4]
        when 'PL' then array[1,2,3,4,5]
        else null
      end as expected
  ) as req
  where c.code in ('AE', 'SA', 'PL');
$$;

-- -----------------------------------------------------------------------------
-- 2. Recovery Leave: earning is now approval-gated (new approvable entity)
-- -----------------------------------------------------------------------------
-- 'recovery_credit' is a NEW value on an existing, closed enum — added via
-- ALTER TYPE ... ADD VALUE rather than redeclared, since approvable_entity
-- already exists with a fixed set of values from an earlier migration. The
-- new value cannot be referenced by any statement in the SAME transaction
-- that adds it (a hard Postgres restriction), so this explicit COMMIT
-- closes that transaction before anything below references it.
alter type approvable_entity add value 'recovery_credit';

commit;

-- A recovery credit "earning" request — one per attendance record, ever
-- (the unique constraint below is the natural key: at most one standard OR
-- overnight credit may ever be proposed for a given day, matching "the
-- same working hours cannot generate duplicate credits"). Modeled on the
-- SAME pattern reimbursement_claims/timesheets already use (submit against
-- a real row with its own status, routed through create_initial_approval()),
-- not a new approval mechanism. Manager approval (step 1) is the
-- "provisional release" the policy brief describes — the employee may be
-- released for immediate next-day rest on that basis alone, since nothing
-- in this codebase ever marks a day "absent" for a missing attendance row
-- (verified by inspection: no cron or page does this). The actual earned
-- ledger credit — the only thing that ever creates spendable balance — is
-- posted solely at HR Admin's final approval (step 2), inside
-- decide_leave_approval() below.
create table recovery_credit_requests (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references employees(id),
  attendance_record_id  uuid not null references attendance_records(id),
  work_date             date not null,
  event_type            text not null check (event_type in ('standard', 'overnight')),
  proposed_days         numeric(3,1) not null check (proposed_days in (0.5, 1)),
  status                request_status not null default 'submitted',
  submitted_at          timestamptz not null default now(),
  decided_at            timestamptz,
  created_by            uuid not null,
  comp_day_ledger_id    uuid references comp_day_ledger(id),
  created_at            timestamptz not null default now()
);

create index idx_recovery_credit_requests_employee on recovery_credit_requests(employee_id);

-- Partial, not a flat UNIQUE(attendance_record_id) — mirrors
-- comp_day_ledger's own "active/unreversed" concept (enforced there by
-- guard_comp_day_ledger_single_active_credit rather than a flat unique
-- constraint, for the identical reason): a cancelled or rejected request
-- must not permanently block that day from ever earning a fresh one later
-- (e.g. corrected away from present, then corrected back). Any status
-- OTHER than cancelled/rejected — submitted, pending_approval, or approved
-- — still counts as "active" and blocks a second request for the same day.
create unique index recovery_credit_requests_active_per_record
  on recovery_credit_requests(attendance_record_id)
  where status not in ('cancelled', 'rejected');

alter table recovery_credit_requests enable row level security;

-- Same self/manager/HR-Admin read shape as attendance_records itself (this
-- request is derived directly from one attendance record).
create policy recovery_credit_requests_select on recovery_credit_requests for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

-- No insert/update policy for authenticated at all — record_attendance_and_recovery(),
-- record_overnight_recovery_credit() and decide_leave_approval() (all
-- SECURITY DEFINER) are the only path in or mutation path, the same design
-- already used for the approvals table itself.

create trigger audit_recovery_credit_requests after insert or update on recovery_credit_requests
  for each row execute function write_audit_log();

-- approvals_select's existing is_entity_owner() branch means "the person
-- who submitted this" — for recovery_credit that's the manager/HR who
-- recorded eligibility (created_by), correctly NOT the employee (who never
-- submits this themselves). But the employee is still the intended
-- audience for "Recovery earning approval status" (item 8) — without this,
-- they could see neither their pending request nor its outcome. Widen
-- approvals_select with one extra, entity-specific branch rather than
-- changing is_entity_owner() (which also gates who MAY submit the initial
-- approval — widening that would incorrectly let the employee act as if
-- they initiated their own eligibility attestation).
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
  );

-- Recovery Leave consumption (taking an already-earned day) is an ordinary
-- leave_requests row with leave_type_code = 'recovery', funded entirely
-- from comp_day_ledger — it was always meant to work this way, but this
-- migration never actually configured that funding source. Without a
-- deduction_priority_rules row, decide_leave_approval()'s existing
-- unconditional leave_ledger fallback (see the safety fix below) would
-- otherwise post a 'recovery' deduction into leave_ledger — a ledger
-- Recovery Leave has no real accrual in at all, which is exactly the
-- unsafe fallback item 3 of this correction round exists to close.
-- deduction_priority_rules has no created_by column (pure reference
-- configuration, like public_holidays), so no real-actor requirement
-- applies here.
insert into deduction_priority_rules (country_code, leave_type_code, source_ledger, priority_order, effective_from) values
  ('AE', 'recovery', 'comp_day', 1, '2026-01-01'),
  ('SA', 'recovery', 'comp_day', 1, '2026-01-01'),
  ('PL', 'recovery', 'comp_day', 1, '2026-01-01')
on conflict (coalesce(company_id::text, country_code), leave_type_code, source_ledger, effective_from) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Recovery Leave: exceptional-overnight credit (creates a request, not a credit)
-- -----------------------------------------------------------------------------
-- Mirrors packages/domain/src/recoveryCredit.ts's computeOvernightRecoveryCredit
-- exactly (0.5 day for up to and including 4 active hours after midnight,
-- 1 day beyond that; nothing unless the normal scheduled day was completed
-- AND work genuinely continued past midnight). No longer posts to
-- comp_day_ledger directly — it creates a recovery_credit_requests row and
-- routes it through the SAME Line-Manager-then-HR-Admin chain as the
-- standard path, so a manager and HR admin calling this see identical
-- "submitted for approval" behavior, never an immediate credit.
--
-- Authorization: HR Admin, OR the employee's own manager (direct or
-- higher in the chain) — per the policy brief, the Line Manager must be
-- able to attest and act on this without waiting for HR. RLS-equivalent
-- authorization is enforced here directly since recovery_credit_requests
-- (like approvals) has no INSERT policy for authenticated users at all —
-- SECURITY DEFINER is the only path in, by design.
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

  -- Same per-employee advisory lock record_attendance_and_recovery() takes,
  -- for the same reason: without it, two concurrent calls for this
  -- employee/date could both read "not yet requested" before either
  -- commits.
  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  select id into v_record_id from attendance_records where employee_id = p_employee_id and work_date = p_work_date;
  if v_record_id is null then
    raise exception 'Record ordinary attendance for % on % first', p_employee_id, p_work_date;
  end if;

  update attendance_records
  set completed_normal_scheduled_day = p_completed_normal_scheduled_day,
      active_hours_after_midnight = p_active_hours_after_midnight
  where id = v_record_id;

  -- The currently active (unreversed) ledger credit for this record, if
  -- any (from a prior, already-fully-approved request), and any
  -- already-existing request row at all (standard or overnight, at any
  -- status) — at most one may ever exist per attendance record.
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

  v_credit_days := case when p_active_hours_after_midnight > 4 then 1 else 0.5 end;

  insert into recovery_credit_requests (employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by)
  values (p_employee_id, v_record_id, p_work_date, 'overnight', v_credit_days, auth.uid())
  returning id into v_request_id;

  perform create_initial_approval('recovery_credit', v_request_id);

  credited := true;
  credit_days := v_credit_days;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Recovery Leave forfeiture on termination (unchanged from the original
--    version of this migration — already safe: idempotent, never negative,
--    an auditable 'reversal' row rather than a delete). Now wired into an
--    atomic termination transaction below (terminate_employee()) instead of
--    being an optional call HR could forget.
-- -----------------------------------------------------------------------------
-- "On termination, unused internal Recovery Leave is forfeited... no cash
-- conversion... auditable forfeited_on_termination or equivalent
-- reversal/status record." Reuses the existing 'reversal' entry_type
-- (comp_day_entry_type has no dedicated forfeiture value, and adding one
-- isn't needed — 'reversal' plus source='termination_forfeiture' is
-- exactly "an equivalent reversal/status record", auditable and never a
-- silent delete) rather than adding a new enum value for a single call
-- site. Idempotent: does nothing (0 rows) if there's no positive balance
-- left, so a retried or double-triggered call never double-forfeits.
--
-- comp_day_ledger currently holds ONLY Enginious's own internal Recovery
-- Leave benefit — there is no separate statutory compensatory-rest ledger
-- anywhere in this schema for this function to ever confuse it with (that
-- kind of mandatory statutory entitlement isn't modeled as ledger data
-- anywhere in this codebase; see the statutory_safeguard policy text this
-- migration seeds). So no new classification column is needed to keep the
-- two apart — there is nothing else in this table to keep apart from.
create or replace function forfeit_recovery_leave_on_termination(p_employee_id uuid)
returns table(forfeited_days numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_employment_status employment_status;
  v_balance numeric;
begin
  select company_id, employment_status into v_company_id, v_employment_status
  from employees where id = p_employee_id;
  if v_company_id is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may forfeit recovery leave on termination';
  end if;

  if v_employment_status is distinct from 'terminated' then
    raise exception 'Employee % is not marked terminated', p_employee_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  select coalesce(sum(days), 0) into v_balance from comp_day_ledger where employee_id = p_employee_id;

  if v_balance <= 0 then
    forfeited_days := 0;
    return next;
    return;
  end if;

  insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, created_by)
  values (p_employee_id, current_date, 'reversal', -v_balance, 'termination_forfeiture', 'employee', p_employee_id, auth.uid());

  forfeited_days := v_balance;
  return next;
end;
$$;

-- Wraps the termination status transition AND the forfeiture into one
-- transaction, so forfeiture can never be skipped by mistake (item 7:
-- "must be part of the authorised termination/deactivation transaction,
-- not an optional separate call HR can forget"). Only ever touches
-- employees.employment_status/termination_date and comp_day_ledger — it
-- never writes to leave_ledger, so payable Annual Leave is completely
-- unaffected and is still settled separately (see final-settlement-section.tsx).
create or replace function terminate_employee(p_employee_id uuid, p_termination_date date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id from employees where id = p_employee_id and deleted_at is null;
  if v_company_id is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may terminate an employee';
  end if;

  update employees
  set employment_status = 'terminated', termination_date = p_termination_date, updated_at = now(), updated_by = auth.uid()
  where id = p_employee_id;

  perform forfeit_recovery_leave_on_termination(p_employee_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Final settlement: HR/Finance-provided statutory wage basis for
--    non-UAE leave encashment — never guessed.
-- -----------------------------------------------------------------------------
-- UAE settles unused Annual Leave at basic salary (already the default
-- dailyRate in computeFinalSettlement — no override needed). Saudi and
-- Poland require a different, statutory wage-basis figure that this system
-- has no way to compute automatically; it must come from HR/Finance,
-- per-employee, at the time settlement is prepared. This table exists
-- purely to hold that one number, auditably and non-guessably — settlement
-- preparation blocks with a clear message until it's present (see
-- final-settlement-section.tsx). entered_by/entered_at are stamped
-- server-side by trigger, never trusted from the client, so an HR Admin
-- can't backdate or misattribute whose figure this was.
create table termination_settlement_inputs (
  employee_id                  uuid primary key references employees(id),
  leave_encashment_daily_rate  numeric(12,2) not null check (leave_encashment_daily_rate > 0),
  entered_by                   uuid not null,
  entered_at                   timestamptz not null default now()
);

create or replace function stamp_termination_settlement_input()
returns trigger
language plpgsql
as $$
begin
  new.entered_by := auth.uid();
  new.entered_at := now();
  return new;
end;
$$;

create trigger termination_settlement_inputs_stamp
  before insert or update on termination_settlement_inputs
  for each row execute function stamp_termination_settlement_input();

alter table termination_settlement_inputs enable row level security;

create policy termination_settlement_inputs_select on termination_settlement_inputs for select
  using (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy termination_settlement_inputs_write on termination_settlement_inputs for all
  using (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  )
  with check (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create trigger audit_termination_settlement_inputs after insert or update on termination_settlement_inputs
  for each row execute function write_audit_log();

-- -----------------------------------------------------------------------------
-- 6. Approval engine wiring for 'recovery_credit'
-- -----------------------------------------------------------------------------

-- Auto-provisioning: every company now also gets a default 2-step
-- (direct_manager, then role:hr_admin) workflow for recovery_credit, on top
-- of the existing entity types — the exact "Line Manager approval -> HR
-- Admin final approval -> ledger credit" sequence item 1 requires. The main
-- loop above stays untouched (every OTHER entity type is still a single
-- step); recovery_credit is handled the same way payroll_export_run
-- already is: its own insert, outside the loop, because its step count
-- differs from the rest.
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

  insert into approval_workflows (company_id, entity_type, name)
  values (new.id, 'recovery_credit', 'Recovery Leave earning approval (Line Manager, then HR Admin)')
  returning id into v_workflow_id;

  insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
    (v_workflow_id, 1, 'direct_manager'),
    (v_workflow_id, 2, 'role:hr_admin');

  return new;
end;
$$;

-- Backfills any company created before this migration — same pattern
-- Phase 4's own backfill (for reimbursement_claim/timesheet) used.
do $$
declare
  v_company record;
  v_workflow_id uuid;
begin
  for v_company in select id from companies loop
    if not exists (
      select 1 from approval_workflows where company_id = v_company.id and entity_type = 'recovery_credit'
    ) then
      insert into approval_workflows (company_id, entity_type, name)
      values (v_company.id, 'recovery_credit', 'Recovery Leave earning approval (Line Manager, then HR Admin)')
      returning id into v_workflow_id;

      insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
        (v_workflow_id, 1, 'direct_manager'),
        (v_workflow_id, 2, 'role:hr_admin');
    end if;
  end loop;
end;
$$;

-- Ownership: recovery_credit is manager/HR-initiated on the employee's
-- behalf (they attest to a fact, not submit their own request) — same
-- "owner = initiator" pattern generated_letter/payroll_export_run already
-- use via generated_by, here via created_by.
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
      return exists (select 1 from recovery_credit_requests where id = p_entity_id and created_by = auth.uid());
    else
      return false;
  end case;
end;
$$;

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
  if not is_entity_owner(p_entity_type, p_entity_id) then
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

  if p_entity_type = 'payroll_export_run' then
    v_approver_id := resolve_approver_for_company(v_approver_type, v_company_id);
  else
    v_approver_id := resolve_approver(v_approver_type, v_employee_id);
  end if;
  if v_approver_id is null then
    raise exception 'No approver could be resolved (e.g. no manager assigned, or no one holds the required role). Contact HR Admin.';
  end if;

  -- Self-approval prevention compares against the ENTITY's own beneficiary,
  -- not always the caller: every other entity type is self-submitted (the
  -- caller IS the requester, so auth.uid() is correct), but recovery_credit
  -- is manager/HR-initiated ON BEHALF OF the employee — the policy brief
  -- expects the direct manager to routinely be both the one recording
  -- eligibility AND the resolved step-1 approver for their own report, and
  -- that is never "self-approval" (the manager isn't approving their OWN
  -- leave). Only block if the resolved approver equals the BENEFICIARY.
  if p_entity_type = 'recovery_credit' then
    select user_id into v_self_check_user_id from employees where id = v_employee_id;
  else
    v_self_check_user_id := auth.uid();
  end if;
  if v_approver_id = v_self_check_user_id then
    raise exception 'The resolved approver for this workflow''s first step (%) is you — you can''t approve your own request. Contact HR Admin to assign a different approver.', v_approver_type;
  end if;

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

-- The approval state machine — extended with 'recovery_credit' handling at
-- every stage (load, reject, advance-to-next-step, finalize), plus one
-- safety fix to leave_request finalization's comp-day/leave-ledger
-- deduction (item 3 of this correction round).
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
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be ''approved'' or ''rejected''';
  end if;

  select * into v_approval from approvals where id = p_approval_id for update;
  if not found then
    raise exception 'Approval not found';
  end if;
  if auth.uid() is not null and v_approval.approver_id <> auth.uid() then
    raise exception 'Only the assigned approver may decide this';
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
      delete from payroll_export_lines where run_id = v_approval.entity_id;
    elsif v_approval.entity_type = 'recovery_credit' then
      update recovery_credit_requests set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    end if;
    return; -- rejection stops the chain; earlier decisions in the log are untouched
  end if;

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
        -- leave type (e.g. Recovery Leave's comp_day-only rule above) and
        -- it could not cover the full request — refuse outright rather
        -- than falling through to an unconfigured leave_ledger balance
        -- that has no real accrual behind it at all. This whole function
        -- call rolls back on this exception (including the partial
        -- comp_day 'redeemed' entry just above and the approvals row
        -- updated earlier), so nothing is left half-applied.
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
    update reimbursement_claims set status = 'approved', decided_at = now() where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'timesheet' then
    update timesheets set status = 'approved', decided_at = now() where id = v_timesheet.id;

  elsif v_approval.entity_type = 'generated_letter' then
    update generated_letters set status = 'issued' where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'payroll_export_run' then
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

-- -----------------------------------------------------------------------------
-- 7. Recovery Leave: standard weekend/public-holiday credit now uses the
--    hour-threshold rule and creates a request, not an immediate credit.
-- -----------------------------------------------------------------------------
-- Replaces the old country-configured flat recovery_credit_days amount
-- entirely (that rule is retired by this correction, not just superseded —
-- it no longer applies at all, for any country) with the SAME
-- deterministic 0.5/1-day threshold packages/domain/src/recoveryCredit.ts's
-- computeStandardRecoveryCredit implements: up to and including 4 active
-- hours worked (attendance_records.hours_worked, already an HR/manager-
-- attested field, never trusted from the browser) -> 0.5 day; more than 4
-- -> 1 day. Needs no country policy configuration at all, so
-- needs_policy_review is repurposed: it now flags a recovery-eligible day
-- that has no hours_worked recorded yet (can't derive an amount without
-- guessing), rather than a missing/misconfigured country policy (which no
-- longer applies to this decision).
--
-- Working-day/weekend derivation now prefers the new working_weekdays
-- column when a country has one configured (none do yet — see section 1b
-- above), falling back to the existing week_start_day-derived formula
-- otherwise; this is a no-op behavior change today and becomes live only
-- once HR explicitly configures a country's working_weekdays.
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
  v_week_start_day smallint;
  v_working_weekdays integer[];
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

    select week_start_day, working_weekdays into v_week_start_day, v_working_weekdays from countries where code = v_country_code;
    select name into v_holiday_name from public_holidays where country_code = v_country_code and holiday_date = p_work_date;
    v_is_recovery_day := v_holiday_name is not null
      or (
        case when v_working_weekdays is not null and array_length(v_working_weekdays, 1) > 0
          then not (extract(dow from p_work_date)::int = any(v_working_weekdays))
          else ((extract(dow from p_work_date)::int - coalesce(v_week_start_day, 1) + 7) % 7) >= 5
        end
      );

    insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
    values (v_employee_id, p_work_date, v_status, v_work_mode, v_hours, 'manual')
    on conflict (employee_id, work_date) do update
    set status = excluded.status, work_mode = excluded.work_mode, hours_worked = excluded.hours_worked
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
          v_credit_days := case when v_hours > 4 then 1 else 0.5 end;
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
      -- exactly as before, via the same linked-reversal pattern; ANY
      -- still-active request (submitted, pending_approval, OR already
      -- approved) is cancelled too — never deleted, same append-only
      -- convention cancel_leave_request() already uses for approvals — so
      -- the partial unique index above frees up and a later correction
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

-- recovery_credit_requests.attendance_record_id has no ON DELETE action, so
-- a request referencing this record (at any status) would otherwise block
-- delete_attendance_record()'s delete with a foreign key violation. This
-- undoes both, the same way it already undoes an active ledger credit —
-- the attendance record is being fully removed as a mistaken entry, so
-- whatever request it generated was equally mistaken. approvals has no
-- foreign key of its own (it's generic across every approvable entity
-- type), so it needs the same explicit cleanup.
create or replace function delete_attendance_record(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_company_id uuid;
  v_was_credited comp_day_ledger%rowtype;
  v_request_id uuid;
begin
  select employee_id into v_employee_id from attendance_records where id = p_record_id;
  if v_employee_id is null then
    raise exception 'Attendance record not found';
  end if;

  select company_id into v_company_id from employees where id = v_employee_id;
  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may delete an attendance record';
  end if;

  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_employee_id::text));

  select cl.* into v_was_credited from comp_day_ledger cl
  where cl.reference_type = 'attendance_record' and cl.reference_id = p_record_id and cl.entry_type = 'earned'
    and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);

  if v_was_credited.id is not null then
    insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
    values (v_was_credited.employee_id, current_date, 'reversal', -v_was_credited.days, 'holiday_worked', 'attendance_record', p_record_id, v_was_credited.id, auth.uid());
  end if;

  select id into v_request_id from recovery_credit_requests where attendance_record_id = p_record_id;
  if v_request_id is not null then
    delete from approvals where entity_type = 'recovery_credit' and entity_id = v_request_id;
    delete from recovery_credit_requests where id = v_request_id;
  end if;

  delete from attendance_records where id = p_record_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Migration safety: draft policies now require a real, verified actor
-- -----------------------------------------------------------------------------
-- The original version of this migration inserted policy_versions rows
-- with created_by = the all-zero placeholder UUID. That is not an
-- authenticated/auditable configuration action — it's unowned data baked
-- into a migration. This function replaces that: it must be called
-- EXPLICITLY, by an authenticated actor passing their own auth.uid() (or
-- any other real, existing auth.users id), and refuses to run with a null
-- or non-existent one. It never overwrites an existing draft or active
-- policy: it always computes the next free version_no from what's actually
-- in the target database at call time (never assumes version_no = 2 or any
-- other fixed number is free), and it is safely repeatable — a second call
-- detects its own prior run (via a payload marker) per country/policy_type
-- and skips rather than creating a duplicate version.
--
-- Not applied by this migration itself. To run it against a real database,
-- an authenticated HR Admin (or whoever is applying this migration, using
-- their own real user id) calls:
--   select * from seed_phase2b_policy_drafts(auth.uid());
-- after first reviewing preflight_policy_and_holiday_conflicts()'s output.
create or replace function preflight_policy_and_holiday_conflicts()
returns table(
  country_code text,
  policy_type text,
  existing_version_numbers int[],
  existing_statuses text[],
  next_free_version_no int,
  already_seeded_by_this_migration boolean,
  holiday_count_2026 bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cc.code,
    pt.policy_type,
    coalesce((select array_agg(pv.version_no order by pv.version_no) from policy_versions pv where pv.country_code = cc.code and pv.policy_type::text = pt.policy_type), array[]::int[]),
    coalesce((select array_agg(distinct pv.status::text) from policy_versions pv where pv.country_code = cc.code and pv.policy_type::text = pt.policy_type), array[]::text[]),
    coalesce((select max(pv.version_no) from policy_versions pv where pv.country_code = cc.code and pv.policy_type::text = pt.policy_type), 0) + 1,
    exists (
      select 1 from policy_versions pv
      where pv.country_code = cc.code and pv.policy_type::text = pt.policy_type
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ),
    (select count(*) from public_holidays ph where ph.country_code = cc.code and ph.holiday_date between '2026-01-01' and '2026-12-31')
  from (values ('AE'), ('SA'), ('PL')) as cc(code)
  cross join (values ('leave_rules'), ('overtime_rules')) as pt(policy_type)
  order by cc.code, pt.policy_type;
$$;

create or replace function seed_phase2b_policy_drafts(p_created_by uuid)
returns table(country_code text, policy_type text, version_no int, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
  v_leave_version_no int;
  v_overtime_version_no int;
  v_leave_version_id uuid;
  v_already_seeded boolean;
  v_deduction_mode text;
  v_extend_for_holidays boolean;
  v_annual_name text;
  v_annual_accrual_method text;
  v_annual_max_balance numeric;
  v_annual_carryover_max numeric;
  v_annual_carryover_expiry_months int;
begin
  if p_created_by is null then
    raise exception 'seed_phase2b_policy_drafts requires a real authenticated actor id (p_created_by) — refusing to create policy drafts with no attributable owner.';
  end if;
  if not exists (select 1 from auth.users where id = p_created_by) then
    raise exception 'p_created_by (%) does not correspond to a real auth.users row.', p_created_by;
  end if;

  foreach v_country in array array['AE', 'SA', 'PL']
  loop
    -- ---- leave_rules: this brief's specific Annual Leave rules ----
    select exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'leave_rules'
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ) into v_already_seeded;

    if v_already_seeded then
      country_code := v_country; policy_type := 'leave_rules'; version_no := null; action := 'skipped_already_seeded';
      return next;
    else
      select coalesce(max(pv.version_no), 0) + 1 into v_leave_version_no
      from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'leave_rules';

      v_deduction_mode := case v_country when 'PL' then 'workingDays' else 'calendarDays' end;
      v_extend_for_holidays := (v_country = 'SA');
      v_annual_name := case v_country when 'PL' then 'Annual leave (urlop wypoczynkowy)' else 'Annual leave' end;
      v_annual_accrual_method := case v_country when 'PL' then 'annual_grant' else 'per_service_year' end;
      v_annual_max_balance := case v_country when 'PL' then 26 else 90 end;
      v_annual_carryover_max := case v_country when 'PL' then 20 else 30 end;
      v_annual_carryover_expiry_months := case v_country when 'PL' then 9 else 12 end;

      insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
      values (
        v_country, 'leave_rules', v_leave_version_no, '2026-01-01',
        jsonb_build_object(
          'phase2b_seed_marker', 'leave_policy_configuration',
          'summary', case v_country
            when 'AE' then 'UAE Annual Leave: 30 calendar days per completed year; 2 calendar days per completed month after 6 months but before 1 year. Calendar-day deduction. Sequential approval: Line Manager then HR Admin. No deduction until the full chain approves.'
            when 'SA' then 'Saudi Annual Leave: 21 calendar days/year under five consecutive years of service, 30 calendar days/year from the fifth year onward. Calendar-day deduction; an official holiday inside the leave period extends it rather than consuming a leave day. Sequential approval: Line Manager then HR Admin. Unused legally accrued leave is paid on termination using the statutory Saudi wage basis, not forced onto a basic-salary-only calculation.'
            when 'PL' then 'Poland Annual Leave: 20 working days/year under 10 years of legally recognised service (actual tenure plus any HR-recognised prior service/education), 26 working days/year at 10+ years; prorated for part-time by contract FTE fraction. Deducted against scheduled working time (1 day = 8 hours). A first-time employee accrues 1/12 of the annual entitlement per completed month. Sequential approval: Line Manager then HR Admin. Unused leave payable on termination uses Poland''s statutory pecuniary-equivalent calculation, not a UAE-style basic-salary rule.'
          end,
          'settlement', 'Enginious settles unused Annual Leave upon resignation, termination or contract expiry using the employee''s basic salary where legally permitted. Where mandatory local law requires another wage basis or statutory calculation, the legally required method applies.',
          'deduction_mode', v_deduction_mode,
          'extend_for_holidays', v_extend_for_holidays,
          'first_year_monthly_accrual_fraction', case when v_country = 'PL' then 0.0833 else null end
        ),
        p_created_by
      )
      returning id into v_leave_version_id;

      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method, max_balance_days, carryover_max_days, carryover_expiry_months, min_service_days_to_accrue)
      values
        (v_leave_version_id, 'annual', v_annual_name, v_annual_accrual_method, v_annual_max_balance, v_annual_carryover_max, v_annual_carryover_expiry_months, 0),
        (v_leave_version_id, 'recovery', 'Recovery Leave', 'annual_grant', null, 0, null, 0);

      country_code := v_country; policy_type := 'leave_rules'; version_no := v_leave_version_no; action := 'created';
      return next;
    end if;

    -- ---- overtime_rules: Recovery Leave policy text/thresholds ----
    select exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'overtime_rules'
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ) into v_already_seeded;

    if v_already_seeded then
      country_code := v_country; policy_type := 'overtime_rules'; version_no := null; action := 'skipped_already_seeded';
      return next;
    else
      select coalesce(max(pv.version_no), 0) + 1 into v_overtime_version_no
      from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'overtime_rules';

      insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
      values (
        v_country, 'overtime_rules', v_overtime_version_no, '2026-01-01',
        jsonb_build_object(
          'phase2b_seed_marker', 'leave_policy_configuration',
          'policy_name', 'Enginious Recovery Leave',
          'wording', 'Recovery Leave is a time-off benefit intended to provide rest during active employment. It is not salary, Annual Leave or a cash entitlement. Unused internal Recovery Leave expires 180 days after earning and is forfeited without cash conversion when employment ends, subject to mandatory local employment law.',
          'statutory_safeguard', 'Enginious does not operate a general discretionary overtime-payment scheme. Working beyond normal hours does not automatically create Recovery Leave or an additional contractual payment. Where applicable employment law mandates overtime pay, holiday compensation, substitute rest or another minimum entitlement, Enginious will comply with that statutory requirement.',
          'standard_threshold_hours', 4,
          'standard_credit_below_threshold_days', 0.5,
          'standard_credit_above_threshold_days', 1,
          'overnight_threshold_hours', 4,
          'expiry_days', 180,
          'consumption_order', 'oldest_first',
          'approval_chain', jsonb_build_array('direct_manager', 'role:hr_admin')
        ),
        p_created_by
      );

      country_code := v_country; policy_type := 'overtime_rules'; version_no := v_overtime_version_no; action := 'created';
      return next;
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. 2026 public holidays — confirmed Gregorian dates only, idempotent.
--    Pure reference data (no created_by column on this table, same as
--    seed.sql's own bootstrap of it), so no real-actor requirement applies
--    here the way it does to policy drafts above.
-- -----------------------------------------------------------------------------
-- AE/SA/PL are guaranteed to already exist by this point (section 0 above).
--
-- Natural key already enforced by public_holidays' own
-- unique(country_code, holiday_date) — `on conflict do nothing` makes this
-- safe to run against a database that may already have some or all of
-- these rows, without duplicating or overwriting anything. This migration
-- was never run against the shared database, so live duplicates could not
-- be inspected directly; the idempotent key makes that safe regardless of
-- what's already there.
--
-- Deliberately NOT included (do not guess a lunar/Hijri date): UAE's
-- Islamic New Year, Prophet Muhammad's Birthday, and Eid Al Etihad/
-- National Day period; Saudi's Eid Al Fitr and Eid Al Adha exact 2026
-- Gregorian dates (pending an official HRSD/Umm Al-Qura announcement);
-- Poland's replacement days off for 15 Aug and 26 Dec (both fall on a
-- Saturday in 2026 — the company must decide and HR must enter the
-- replacement dates; not invented here).

insert into public_holidays (country_code, holiday_date, name, is_paid) values
  ('AE', '2026-01-01', 'New Year''s Day', true),
  ('AE', '2026-03-19', 'Eid Al Fitr', true),
  ('AE', '2026-03-20', 'Eid Al Fitr', true),
  ('AE', '2026-03-21', 'Eid Al Fitr', true),
  ('AE', '2026-05-26', 'Arafah Day', true),
  ('AE', '2026-05-27', 'Eid Al Adha', true),
  ('AE', '2026-05-28', 'Eid Al Adha', true),
  ('AE', '2026-05-29', 'Eid Al Adha', true),
  ('SA', '2026-02-22', 'Founding Day', true),
  ('SA', '2026-09-23', 'Saudi National Day', true),
  ('PL', '2026-01-01', 'New Year''s Day', true),
  ('PL', '2026-01-06', 'Epiphany', true),
  ('PL', '2026-04-05', 'Easter Sunday', true),
  ('PL', '2026-04-06', 'Easter Monday', true),
  ('PL', '2026-05-01', 'Labour Day', true),
  ('PL', '2026-05-03', 'Constitution Day', true),
  ('PL', '2026-05-24', 'Pentecost', true),
  ('PL', '2026-06-04', 'Corpus Christi', true),
  ('PL', '2026-08-15', 'Assumption of the Blessed Virgin Mary', true),
  ('PL', '2026-11-01', 'All Saints'' Day', true),
  ('PL', '2026-11-11', 'Independence Day', true),
  ('PL', '2026-12-24', 'Christmas Eve', true),
  ('PL', '2026-12-25', 'Christmas Day', true),
  ('PL', '2026-12-26', 'Second Day of Christmas', true)
on conflict (country_code, holiday_date) do nothing;

-- Manual follow-up flagged, not implemented here: once Annual Leave
-- policies above are reviewed and activated, the leave-accrual cron
-- (apps/web/src/app/api/cron/leave-accrual/route.ts) needs to know how to
-- accrue 'per_service_year' (AE/SA) and 'annual_grant' (PL) — this is
-- implemented in this branch's application-layer changes (see the
-- accompanying report), not in this migration, since it's pure TypeScript
-- with no schema dependency.
