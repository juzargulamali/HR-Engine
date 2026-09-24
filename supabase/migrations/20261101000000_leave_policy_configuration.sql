-- Phase 2b (leave-policy-configuration): schema + RPC additions supporting
-- regional Annual Leave policies and the Recovery Leave benefit. This
-- migration is DRAFT — created on the phase2b/leave-policy-configuration
-- branch, deliberately NOT applied to the shared Supabase database. It is
-- purely additive: new nullable columns (existing rows are valid as-is,
-- with a safe default where a constant default applies), two brand-new
-- RPCs that don't touch or alter any existing function, and draft-only
-- (never active) policy_versions/policy_leave_types rows plus idempotent
-- holiday inserts.
--
-- What this migration deliberately does NOT do, and why:
--   - It does not modify record_attendance_and_recovery() (the existing
--     weekend/holiday comp-day RPC) or decide_leave_approval() (the
--     existing approval/deduction RPC) at all. Both are financial-ledger
--     code that has already needed several corrections historically
--     (see git history); changing either blind, in the same pass as
--     several other changes, is a bigger risk than this phase needs to
--     take. See docs note at the end of this file for the one follow-up
--     this implies before Recovery Leave can safely go live.
--   - It does not create a new approval workflow or a new leave-request
--     submission path. Once a 'recovery' leave_type_code exists under an
--     ACTIVE leave_rules policy (not yet — these are seeded as drafts
--     only), submitting and approving Recovery Leave is already fully
--     supported by the existing leave_requests + approval_workflows
--     machinery, unchanged. "Immediate next-day use" and "must not
--     appear absent while pending" are satisfied by that existing
--     machinery too: decide_leave_approval() already leaves a request in
--     'pending_approval' (not 'approved', and with no deduction posted)
--     between step 1 and step 2, and no cron or page in this codebase
--     auto-marks a day "absent" for a missing attendance_records row —
--     verified by inspection, not new behavior added here.

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
-- 2. Recovery Leave: exceptional-overnight credit (new, additive RPC)
-- -----------------------------------------------------------------------------

-- Mirrors packages/domain/src/recoveryCredit.ts's computeOvernightRecoveryCredit
-- exactly (0.5 day for up to and including 4 active hours after midnight,
-- 1 day beyond that; nothing unless the normal scheduled day was completed
-- AND work genuinely continued past midnight). Reuses
-- comp_day_ledger/reference_type='attendance_record' — the SAME row the
-- existing weekend/holiday credit uses — so the existing
-- guard_comp_day_ledger_single_active_credit trigger already prevents this
-- and the standard credit from ever both being active for the same day
-- (matches "the same working hours cannot generate duplicate credits" and
-- "maximum 1 recovery day per calendar date").
--
-- Authorization: HR Admin, OR the employee's own manager (direct or
-- higher in the chain) — per the policy brief, the Line Manager must be
-- able to attest and act on this without waiting for HR. This is a UI
-- affordance mirrored by is_manager_of()/has_role(), same as everywhere
-- else in this schema; RLS-equivalent authorization is enforced here
-- directly since comp_day_ledger has no INSERT policy for authenticated
-- users at all (SECURITY DEFINER is the only path in, by design).
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
  v_credit_days numeric;
  v_expiry_date date;
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
  -- employee/date could both read "not yet credited" before either commits.
  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  select id into v_record_id from attendance_records where employee_id = p_employee_id and work_date = p_work_date;
  if v_record_id is null then
    raise exception 'Record ordinary attendance for % on % first', p_employee_id, p_work_date;
  end if;

  update attendance_records
  set completed_normal_scheduled_day = p_completed_normal_scheduled_day,
      active_hours_after_midnight = p_active_hours_after_midnight
  where id = v_record_id;

  -- The currently active (unreversed) credit for this record, from either
  -- this RPC or the standard weekend/holiday one — at most one may exist.
  select cl.* into v_was_credited from comp_day_ledger cl
  where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
    and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
  if v_was_credited.id is not null then
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
  -- Fixed 180-day expiry per the Recovery Leave policy brief — unlike the
  -- existing weekend/holiday credit, this is not HR-configurable; every
  -- overnight-extension credit expires exactly 180 calendar days after
  -- it's earned, always.
  v_expiry_date := p_work_date + interval '180 days';

  insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
  values (p_employee_id, p_work_date, 'earned', v_credit_days, 'overnight_extension', v_expiry_date, 'attendance_record', v_record_id, auth.uid());

  credited := true;
  credit_days := v_credit_days;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Recovery Leave: forfeiture on termination (new, additive RPC)
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

-- -----------------------------------------------------------------------------
-- 4. 2026 public holidays — confirmed Gregorian dates only, idempotent
-- -----------------------------------------------------------------------------
-- Defensive, idempotent: public_holidays.country_code has a foreign key
-- to countries(code), and this migration's own local-harness test run
-- caught that a fresh migrations-only database (no seed.sql) doesn't have
-- AE/SA/PL yet. seed.sql already inserts these same three rows the same
-- way for a real project bootstrap; repeating it here (same values, same
-- `on conflict do nothing`) makes this migration safe to apply on its own
-- regardless of whether seed.sql has already run.
insert into countries (code, name, default_currency, week_start_day) values
  ('AE', 'United Arab Emirates', 'AED', 0),
  ('SA', 'Saudi Arabia', 'SAR', 0),
  ('PL', 'Poland', 'PLN', 1)
on conflict (code) do nothing;

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

-- -----------------------------------------------------------------------------
-- 5. Draft-only policy versions — never activated by this or any migration
-- -----------------------------------------------------------------------------
-- status defaults to 'draft' (policy_versions' own column default); every
-- row below relies on that default and never sets status = 'active'.
-- Activation remains an explicit, authorised HR/second-approver action via
-- the existing ActivateButton/canActivatePolicy UI path — never a
-- migration.
--
-- CONFLICT FOUND AND RESOLVED (Step 1 audit, item 6): supabase/seed.sql
-- already creates a 'leave_rules' version_no = 1 DRAFT for AE, SA and PL
-- (ids 00000000-0000-0000-0000-0000000a0001/a0004/a0007) — generic
-- "commonly cited statutory minimum" starter content (e.g. UAE:
-- monthly_accrual at 2.5 days/period; no 'recovery' leave type at all).
-- Per "do not overwrite existing draft or active policies", this migration
-- does NOT touch, replace or delete those version_no = 1 rows. Instead it
-- adds a version_no = 2 DRAFT per country with the specific entitlement
-- rules from this policy brief (and the new 'recovery' leave type) for HR
-- to review side-by-side with version 1 and activate whichever they
-- choose — the exclusion constraint on policy_versions already guarantees
-- only one of any country+policy_type's versions can ever be ACTIVE at a
-- time, so there is no risk of both taking effect together. If a
-- version_no = 2 (or higher) already exists for one of these by the time
-- this is actually applied, HR must renumber before running it — this
-- migration cannot know that without a live read of the target database.
--
-- "A global Enginious Recovery Leave policy" does not fit this schema as a
-- single borderless row: policy_versions.country_code is NOT NULL by
-- design (every other policy_type is genuinely country-specific). The
-- same Recovery Leave payload is therefore seeded once per operating
-- country below, identically — this is the data-model conflict flagged
-- in the Step 1 audit; a true cross-country "global" policy row would be
-- a larger schema change (nullable country_code, or a new
-- company-level/global scope) which is out of scope for this pass. No
-- existing 'overtime_rules' policy exists for any country in seed.sql, so
-- these are version_no = 1 with no conflict.
--
-- created_by uses the same placeholder seed.sql itself uses for a
-- fresh-project draft with no real HR Admin yet
-- (00000000-0000-0000-0000-000000000000) — replace with a real HR
-- Admin's auth.uid() before actually running this against a project that
-- already has one.

insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by) values
  ('AE', 'leave_rules', 2, '2026-01-01',
   jsonb_build_object(
     'summary', 'UAE Annual Leave: 30 calendar days per completed year; 2 calendar days per completed month after 6 months but before 1 year. Calendar-day deduction. Sequential approval: Line Manager then HR Admin. No deduction until the full chain approves.',
     'settlement', 'Enginious settles unused Annual Leave upon resignation, termination or contract expiry using the employee''s basic salary where legally permitted. Where mandatory local law requires another wage basis or statutory calculation, the legally required method applies.',
     'deduction_mode', 'calendarDays',
     'extend_for_holidays', false,
     'supersedes_note', 'Draft v2 — replaces the generic starter content of v1 (seed.sql) with this policy brief''s specific rules. v1 is left untouched; HR chooses which to activate.'
   ),
   '00000000-0000-0000-0000-000000000000'),
  ('SA', 'leave_rules', 2, '2026-01-01',
   jsonb_build_object(
     'summary', 'Saudi Annual Leave: 21 calendar days/year under five consecutive years of service, 30 calendar days/year from the fifth year onward. Calendar-day deduction; an official holiday inside the leave period extends it rather than consuming a leave day. Sequential approval: Line Manager then HR Admin. Unused legally accrued leave is paid on termination using the statutory Saudi wage basis, not forced onto a basic-salary-only calculation.',
     'deduction_mode', 'calendarDays',
     'extend_for_holidays', true,
     'supersedes_note', 'Draft v2 — replaces the generic starter content of v1 (seed.sql) with this policy brief''s specific rules. v1 is left untouched; HR chooses which to activate.'
   ),
   '00000000-0000-0000-0000-000000000000'),
  ('PL', 'leave_rules', 2, '2026-01-01',
   jsonb_build_object(
     'summary', 'Poland Annual Leave: 20 working days/year under 10 years of legally recognised service (actual tenure plus any HR-recognised prior service/education), 26 working days/year at 10+ years; prorated for part-time by contract FTE fraction. Deducted against scheduled working time (1 day = 8 hours). A first-time employee accrues 1/12 of the annual entitlement per completed month. Sequential approval: Line Manager then HR Admin. Unused leave payable on termination uses Poland''s statutory pecuniary-equivalent calculation, not a UAE-style basic-salary rule.',
     'deduction_mode', 'workingDays',
     'first_year_monthly_accrual_fraction', 0.0833,
     'supersedes_note', 'Draft v2 — replaces the generic starter content of v1 (seed.sql) with this policy brief''s specific rules. v1 is left untouched; HR chooses which to activate.'
   ),
   '00000000-0000-0000-0000-000000000000');

-- policy_leave_types for each new v2 draft above: the 'annual' type
-- carrying this brief's specific rules, plus a new 'recovery' type so
-- Recovery Leave requests pass guard_leave_request_type() once this
-- version is activated. accrual_method is set to the closest existing
-- vocabulary value for documentation purposes only — actual entitlement
-- math is computed by packages/domain/src/annualLeaveEntitlement.ts (UAE/
-- Saudi tiered-by-service-year rules aren't a plain per-period rate the
-- existing leave-accrual cron can mechanically apply; wiring that cron to
-- these new rules is flagged as a follow-up, not done in this migration —
-- see the file-end note). 'recovery' carries no accrual_rate_per_period
-- at all: its balance is entirely comp_day_ledger-sourced, credited only
-- by record_attendance_and_recovery() and record_overnight_recovery_credit()
-- above, never by an accrual cron.
insert into policy_leave_types (
  policy_version_id, leave_type_code, name, accrual_method, accrual_rate_per_period,
  max_balance_days, carryover_max_days, carryover_expiry_months, min_service_days_to_accrue
)
select pv.id, lt.leave_type_code, lt.name, lt.accrual_method, lt.accrual_rate_per_period,
       lt.max_balance_days, lt.carryover_max_days, lt.carryover_expiry_months, lt.min_service_days_to_accrue
from policy_versions pv
join (values
  ('AE', 'annual', 'Annual leave', 'per_service_year', null::numeric, 90::numeric, 30::numeric, 12, 0),
  ('AE', 'recovery', 'Recovery Leave', 'annual_grant', null::numeric, null::numeric, 0::numeric, null, 0),
  ('SA', 'annual', 'Annual leave', 'per_service_year', null::numeric, 90::numeric, 30::numeric, 12, 0),
  ('SA', 'recovery', 'Recovery Leave', 'annual_grant', null::numeric, null::numeric, 0::numeric, null, 0),
  ('PL', 'annual', 'Annual leave (urlop wypoczynkowy)', 'annual_grant', null::numeric, 26::numeric, 20::numeric, 9, 0),
  ('PL', 'recovery', 'Recovery Leave', 'annual_grant', null::numeric, null::numeric, 0::numeric, null, 0)
) as lt(country_code, leave_type_code, name, accrual_method, accrual_rate_per_period, max_balance_days, carryover_max_days, carryover_expiry_months, min_service_days_to_accrue)
  on lt.country_code = pv.country_code
where pv.policy_type = 'leave_rules' and pv.version_no = 2 and pv.status = 'draft'
  and pv.country_code in ('AE', 'SA', 'PL');

-- Every leave type above sets approval_levels_required implicitly to its
-- column default of 1 (unspecified in the values list) — this column is
-- documentation only today (create_initial_approval() routes by each
-- company's approval_workflow_steps rows, not by this field, for every
-- leave type uniformly); the actual sequential Line Manager -> HR Admin
-- chain both Annual Leave and Recovery Leave need is already satisfied by
-- reusing the SAME existing per-company leave_request workflow every
-- other leave type already goes through — no new approval code needed.

-- One global-brief, per-country-seeded Recovery Leave policy (overtime_rules
-- policy_type — the same type record_attendance_and_recovery() already
-- resolves for its own recovery_credit_days/comp_day_expiry_months
-- fields). Recovery Leave's own eligibility/threshold/expiry rules
-- (standard 0.5/1-day thresholds, the exceptional-overnight-extension
-- rule, and the fixed 180-day expiry) are enforced in code
-- (recoveryCredit.ts / record_overnight_recovery_credit above), not by
-- this payload — this row exists so HR has one visible, versioned,
-- activatable place recording the policy text and standard thresholds for
-- audit/reference, consistent with how every other rule in this system is
-- versioned.
insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by) values
  ('AE', 'overtime_rules', 1, '2026-01-01',
   jsonb_build_object(
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
   '00000000-0000-0000-0000-000000000000'),
  ('SA', 'overtime_rules', 1, '2026-01-01',
   jsonb_build_object(
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
   '00000000-0000-0000-0000-000000000000'),
  ('PL', 'overtime_rules', 1, '2026-01-01',
   jsonb_build_object(
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
   '00000000-0000-0000-0000-000000000000')
on conflict do nothing;

-- Manual follow-up flagged, not implemented here (see file header): once
-- these policies are reviewed and HR is ready to activate them,
-- decide_leave_approval()'s deduction loop needs one additional guard
-- before Recovery Leave can safely go live — a leave_type_code whose ONLY
-- configured deduction_priority_rules source is 'comp_day' (i.e. it has no
-- real leave_ledger accrual of its own, unlike annual/sick leave) must
-- refuse approval outright if the comp-day balance can't cover the full
-- request, rather than falling back to drawing the remainder from an
-- empty leave_ledger sub-balance and posting it negative. This is a
-- deliberate, separate, carefully-tested change to existing financial
-- ledger code, not bundled into this migration.
