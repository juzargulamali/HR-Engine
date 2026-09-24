-- Phase 2b correction round: Poland's flat 26-day/year Annual Leave company
-- benefit (see packages/domain/src/annualLeaveEntitlement.ts) was correctly
-- connected to the monthly accrual cron, but NOT to termination — the
-- monthly cron may already have posted a full calendar year's 26 days
-- before a Poland employee actually leaves mid-year, and Final Settlement
-- (final-settlement-section.tsx) reads the raw leave_ledger balance
-- directly, with nothing ever re-deriving it against the employee's actual,
-- prorated exit-year entitlement.
--
-- This function is the missing true-up: apps/web/src/lib/actions/
-- polandTermination.ts computes, in TypeScript (reusing the same
-- FTE-interval resolution and calendar-month rounding already implemented
-- and tested in packages/domain, and the same ledger-grant classification
-- the accrual cron uses — see lib/leaveLedger/classifyLedgerRows.ts), the
-- RAW difference between the employee's entitlement through their actual
-- termination date and what has already been unambiguously granted for
-- 'annual' leave this employee's whole tenure. That raw figure is passed
-- here as p_amount_days; this function's own job is deliberately narrow and
-- purely mechanical — post it as an auditable, idempotent, non-destructive
-- leave_ledger row (never rewriting or deleting existing history), and
-- enforce, as a HARD DATABASE-LEVEL INVARIANT independent of whatever the
-- caller computed, that a negative true-up (an over-grant being clawed
-- back) never drives the balance below where it already stood at or below
-- zero. Days an employee has already taken can't be un-taken — any excess
-- is reported back (excess_requiring_review) for HR to reconcile manually
-- (e.g. a possible overpayment), never silently written off ledger-side.
--
-- Deliberately NOT folded into terminate_employee()'s own transaction: the
-- calculation behind p_amount_days is complex, already independently
-- tested TypeScript this system deliberately does not re-derive in
-- PL/pgSQL (see this file's own header above and the domain package's
-- header comment). "Atomic where feasible" is satisfied by each half being
-- independently atomic, idempotent, and advisory-lock-protected —
-- terminate_employee()'s existing status-change-plus-forfeiture transaction
-- is untouched by this migration — invoked back-to-back within one Server
-- Action call, rather than forcing a single cross-language transaction.
create or replace function post_poland_termination_leave_adjustment(
  p_employee_id uuid,
  p_amount_days numeric,
  p_note text default null
)
returns table(applied_days numeric, excess_requiring_review numeric, already_posted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_country_code text;
  v_employment_status employment_status;
  v_termination_date date;
  v_current_balance numeric;
  v_floor numeric;
  v_applied numeric;
  v_excess numeric := 0;
  v_key text;
begin
  select company_id, country_code, employment_status, termination_date
    into v_company_id, v_country_code, v_employment_status, v_termination_date
    from employees where id = p_employee_id;
  if v_company_id is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may post a termination Annual Leave adjustment';
  end if;

  if v_country_code is distinct from 'PL' then
    raise exception 'post_poland_termination_leave_adjustment only applies to Poland employees';
  end if;

  if v_employment_status is distinct from 'terminated' then
    raise exception 'Employee % is not marked terminated', p_employee_id;
  end if;

  v_key := 'termination_settlement:' || p_employee_id::text;

  -- Locked before the idempotency check AND the balance read below, so a
  -- concurrent/retried call can't race between "not yet posted" and the
  -- insert, nor read a stale balance while another call is mid-write.
  perform pg_advisory_xact_lock(hashtext('leave_ledger_annual:' || p_employee_id::text));

  if exists (select 1 from leave_ledger where idempotency_key = v_key) then
    applied_days := 0;
    excess_requiring_review := 0;
    already_posted := true;
    return next;
    return;
  end if;

  if p_amount_days = 0 then
    applied_days := 0;
    excess_requiring_review := 0;
    already_posted := false;
    return next;
    return;
  end if;

  select coalesce(sum(amount_days), 0) into v_current_balance
    from leave_ledger where employee_id = p_employee_id and leave_type_code = 'annual';

  -- Never let this adjustment push the balance any lower than it already
  -- stood at or below zero: the floor is the LESSER of the current balance
  -- and zero — an already-non-negative balance floors at 0 (a clawback may
  -- only remove what's genuinely unused), and an already-negative balance
  -- (a prior advance-leave situation) floors at exactly where it already
  -- was, so this adjustment never compounds a pre-existing over-draw.
  v_floor := least(v_current_balance, 0);
  v_applied := p_amount_days;
  if p_amount_days < 0 then
    v_applied := greatest(p_amount_days, v_floor - v_current_balance);
    v_excess := p_amount_days - v_applied;
  end if;

  if v_applied <> 0 then
    insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, note, created_by, idempotency_key)
    values (p_employee_id, 'annual', coalesce(v_termination_date, current_date), 'adjustment', v_applied, 'termination_settlement', p_employee_id, p_note, auth.uid(), v_key);
  end if;

  applied_days := v_applied;
  excess_requiring_review := abs(v_excess);
  already_posted := false;
  return next;
end;
$$;
