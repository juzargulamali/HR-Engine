-- Phase 2b correction round: Poland's flat 26-day/year Annual Leave company
-- benefit (see packages/domain/src/annualLeaveEntitlement.ts) was correctly
-- connected to the monthly accrual cron, but NOT to termination — the
-- monthly cron may already have posted a full calendar year's 26 days
-- before a Poland employee actually leaves mid-year, and Final Settlement
-- (final-settlement-section.tsx) reads the raw leave_ledger balance
-- directly, with nothing ever re-deriving it against the employee's actual,
-- prorated exit-year entitlement.
--
-- Records the outcome of exactly one termination true-up per employee —
-- including a ZERO-delta outcome (the cron had already granted the exact
-- right amount) — so "no marker exists" unambiguously means "the true-up
-- has never run for this employee," never conflated with "it ran and found
-- nothing to adjust." Final Settlement (final-settlement-section.tsx) reads
-- this table, not a recomputed entitlement, to decide whether it's safe to
-- render a settlement figure — recomputing the entitlement successfully
-- proves the CALCULATION is possible, not that the RPC below actually ran
-- and posted/reconciled it.
--
-- excess_reviewed_at/excess_reviewed_by are set only by
-- acknowledge_poland_termination_leave_excess() below — an explicit,
-- audited HR action — never automatically. While a positive
-- excess_requiring_review_days sits unacknowledged, Final Settlement stays
-- blocked: the employee already took more Annual Leave than their
-- corrected entitlement allows, and that's a human decision (write off?
-- recover the overpayment?), not something this system resolves on its own.
create table poland_termination_leave_reconciliations (
  employee_id                    uuid primary key references employees(id),
  termination_date               date not null,
  raw_delta_days                 numeric not null,
  applied_days                   numeric not null,
  excess_requiring_review_days   numeric not null default 0,
  excess_reviewed_at             timestamptz,
  excess_reviewed_by             uuid,
  note                            text,
  created_by                     uuid not null,
  created_at                     timestamptz not null default now()
);

alter table poland_termination_leave_reconciliations enable row level security;

-- Read-only from the ordinary authenticated role's perspective — every
-- write happens inside the two SECURITY DEFINER functions below, which
-- (like every other SECURITY DEFINER function in this schema) run as the
-- table owner and are therefore unaffected by RLS; there is deliberately no
-- direct insert/update/delete policy for `authenticated` here.
create policy poland_termination_leave_reconciliations_select on poland_termination_leave_reconciliations for select
  using (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

-- No separate audit_log trigger: unlike most audited tables this one has no
-- surrogate `id` column (write_audit_log()'s record_id lookup — `coalesce(new.id,
-- old.id)` — requires one), and the row is already fully self-documenting
-- (created_by/created_at for the true-up itself, excess_reviewed_by/
-- excess_reviewed_at for the one explicit HR action that ever updates it).

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
-- leave_ledger row (never rewriting or deleting existing history), record a
-- poland_termination_leave_reconciliations completion marker (created
-- UNCONDITIONALLY, even when there's nothing to post — see that table's own
-- header comment), and enforce, as a HARD DATABASE-LEVEL INVARIANT
-- independent of whatever the caller computed, that a negative true-up (an
-- over-grant being clawed back) never drives the balance below where it
-- already stood at or below zero. Days an employee has already taken can't
-- be un-taken — any excess is reported back (excess_requiring_review) and
-- recorded on the reconciliation row for HR to review and explicitly
-- acknowledge (acknowledge_poland_termination_leave_excess below), never
-- silently written off ledger-side.
--
-- Idempotent PER EMPLOYEE, permanently: once a reconciliation row exists,
-- every subsequent call is a no-op (already_posted = true) regardless of
-- what p_amount_days it's given — this true-up runs exactly once per
-- employee's termination, the same way forfeit_recovery_leave_on_termination
-- treats "already forfeited" as terminal, never something to redo.
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

  -- Locked before the idempotency check AND the balance read below, so a
  -- concurrent/retried call can't race between "not yet posted" and the
  -- insert, nor read a stale balance while another call is mid-write.
  perform pg_advisory_xact_lock(hashtext('leave_ledger_annual:' || p_employee_id::text));

  -- The completion marker — not the leave_ledger row, which a zero-delta
  -- outcome never creates — is the single source of truth for "has this
  -- already run for this employee."
  if exists (select 1 from poland_termination_leave_reconciliations where employee_id = p_employee_id) then
    applied_days := 0;
    excess_requiring_review := 0;
    already_posted := true;
    return next;
    return;
  end if;

  v_key := 'termination_settlement:' || p_employee_id::text;
  v_applied := 0;

  if p_amount_days <> 0 then
    select coalesce(sum(amount_days), 0) into v_current_balance
      from leave_ledger where employee_id = p_employee_id and leave_type_code = 'annual';

    -- Never let this adjustment push the balance any lower than it already
    -- stood at or below zero: the floor is the LESSER of the current
    -- balance and zero — an already-non-negative balance floors at 0 (a
    -- clawback may only remove what's genuinely unused), and an
    -- already-negative balance (a prior advance-leave situation) floors at
    -- exactly where it already was, so this adjustment never compounds a
    -- pre-existing over-draw.
    v_floor := least(v_current_balance, 0);
    v_applied := p_amount_days;
    if p_amount_days < 0 then
      v_applied := greatest(p_amount_days, v_floor - v_current_balance);
      v_excess := p_amount_days - v_applied;
    end if;

    if v_applied <> 0 then
      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, note, created_by, idempotency_key)
      values (p_employee_id, 'annual', coalesce(v_termination_date, current_date), 'adjustment', v_applied, 'termination_settlement', p_employee_id, p_note, auth.uid(), v_key)
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  insert into poland_termination_leave_reconciliations (employee_id, termination_date, raw_delta_days, applied_days, excess_requiring_review_days, note, created_by)
  values (p_employee_id, coalesce(v_termination_date, current_date), p_amount_days, v_applied, abs(v_excess), p_note, auth.uid())
  on conflict (employee_id) do nothing;

  applied_days := v_applied;
  excess_requiring_review := abs(v_excess);
  already_posted := false;
  return next;
end;
$$;

-- The one, explicit, audited HR action that clears a pending
-- excess_requiring_review_days flag — see the table's own header comment
-- for why this can never happen automatically. Idempotent: acknowledging an
-- already-acknowledged (or never-flagged) reconciliation is a silent no-op,
-- not an error, so a retried click can't fail or double-stamp the record.
create or replace function acknowledge_poland_termination_leave_excess(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id from employees where id = p_employee_id;
  if v_company_id is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may acknowledge a termination Annual Leave excess';
  end if;

  if not exists (select 1 from poland_termination_leave_reconciliations where employee_id = p_employee_id) then
    raise exception 'No termination Annual Leave reconciliation exists for employee %', p_employee_id;
  end if;

  update poland_termination_leave_reconciliations
  set excess_reviewed_at = now(), excess_reviewed_by = auth.uid()
  where employee_id = p_employee_id and excess_reviewed_at is null;
end;
$$;

-- The escape hatch for when applyPolandTerminationLeaveTrueUp() (lib/actions/
-- polandTermination.ts) could NOT automatically determine/post the true-up
-- (no/gappy/ambiguous FTE history, an unclassifiable historical ledger row,
-- a query failure, or the RPC call itself failing) — every one of those
-- cases already tells HR, in the warning it returns, to post the correct
-- amount manually via a leave-ledger adjustment instead. Until now nothing
-- ever created the poland_termination_leave_reconciliations marker for that
-- path, so Final Settlement stayed blocked forever even after HR did
-- exactly what it was told to do — this function is HR's explicit,
-- audited confirmation that they've done so, closing that gap.
--
-- Deliberately posts NOTHING to leave_ledger itself (that's what the manual
-- adjustment HR already posted was for) — it only writes the completion
-- marker, with raw_delta_days/applied_days recorded as 0 so the row reads
-- unambiguously as "resolved manually, not by the automatic true-up," never
-- confused with a genuine zero-delta automatic outcome (which carries its
-- own note text). Same idempotent, advisory-lock-protected,
-- "the marker's existence is terminal" pattern as
-- post_poland_termination_leave_adjustment above — a second confirmation
-- call is a silent no-op, never an error.
create or replace function confirm_poland_termination_leave_manually_reconciled(
  p_employee_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_country_code text;
  v_employment_status employment_status;
  v_termination_date date;
begin
  select company_id, country_code, employment_status, termination_date
    into v_company_id, v_country_code, v_employment_status, v_termination_date
    from employees where id = p_employee_id;
  if v_company_id is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may confirm a manual termination Annual Leave reconciliation';
  end if;

  if v_country_code is distinct from 'PL' then
    raise exception 'confirm_poland_termination_leave_manually_reconciled only applies to Poland employees';
  end if;

  if v_employment_status is distinct from 'terminated' then
    raise exception 'Employee % is not marked terminated', p_employee_id;
  end if;

  if v_termination_date is null then
    raise exception 'Employee % has no termination_date recorded', p_employee_id;
  end if;

  -- Same lock key as post_poland_termination_leave_adjustment — the two
  -- functions are mutually exclusive ways of reaching the same one-time
  -- completion marker for this employee, so they must not be allowed to
  -- race each other either.
  perform pg_advisory_xact_lock(hashtext('leave_ledger_annual:' || p_employee_id::text));

  insert into poland_termination_leave_reconciliations (employee_id, termination_date, raw_delta_days, applied_days, excess_requiring_review_days, note, created_by)
  values (p_employee_id, v_termination_date, 0, 0, 0, coalesce(p_note, 'Confirmed by HR Admin: Annual Leave ledger manually reconciled for this termination.'), auth.uid())
  on conflict (employee_id) do nothing;
end;
$$;
