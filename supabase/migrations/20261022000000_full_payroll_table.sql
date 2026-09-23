-- Turns payroll export from "approved reimbursements + leave encashments
-- only" into a genuine monthly payroll table: for every active employee,
-- Salary + Reimbursements + Bonuses - Deductions = net pay, with full
-- manual override for Finance (a brand-new line, or a direct correction to
-- an auto-generated line's amount).
--
-- Sign convention (net pay = sum(amount), no special-casing downstream):
--   basic_salary / other_allowance / reimbursement / leave_encashment / bonus -> positive
--   deduction                                                                 -> negative
-- Enforced by payroll_export_lines_component_sign_check below.

-- source_reference_type/id are null together for salary lines (nothing to
-- trace back to) and for manual lines (Finance typed it in directly) —
-- only reimbursement and leave-encashment lines still carry a real source
-- row referencing both columns.
alter table payroll_export_lines alter column source_reference_type drop not null;
alter table payroll_export_lines alter column source_reference_id drop not null;

alter table payroll_export_lines drop constraint if exists payroll_export_lines_component_code_check;
alter table payroll_export_lines add constraint payroll_export_lines_component_code_check
  check (component_code in ('basic_salary', 'other_allowance', 'reimbursement', 'leave_encashment', 'deduction', 'bonus'));

alter table payroll_export_lines add constraint payroll_export_lines_component_sign_check
  check ((component_code = 'deduction' and amount < 0) or (component_code <> 'deduction' and amount > 0));

-- Free-text description: required (by the addManualPayrollLine Server
-- Action, not a DB constraint — a NOT NULL here would break every existing
-- auto-generated line, whose component_code is already self-explanatory)
-- for a manual line such as "fine for late badge return" or "Q1 bonus";
-- left null for an auto-generated line.
alter table payroll_export_lines add column label text;

-- true for anything Finance typed in by hand OR directly corrected the
-- amount of (even if the line started out auto-generated). Once true, a
-- line is permanently exempt from generate_payroll_export_lines()'s
-- delete-and-regenerate sweep — see the rewritten function below.
alter table payroll_export_lines add column is_manual boolean not null default false;

-- Who created/last-edited this line. This table's rows have so far only
-- ever come from generate_payroll_export_lines() (which, being a plain
-- caller-context function, records auth.uid()), so there is no real
-- historical data to backfill — a sentinel default is only a backfill
-- safety net for the ALTER itself, not a value any new row should ever
-- carry (every INSERT going forward, whether from the regenerate function
-- or the new manual-line action, sets this explicitly).
alter table payroll_export_lines add column created_by uuid not null default '00000000-0000-0000-0000-000000000000';

-- The dedup index only ever needs to apply to rows that actually reference
-- a source row (reimbursement/leave-encashment lines) — salary and manual
-- lines have no source_reference_id at all, and a plain unique index would
-- otherwise treat every one of their NULLs... actually wouldn't conflict
-- (NULLs are distinct in a unique index), but a partial index says the
-- real intent plainly and keeps the index smaller.
drop index if exists payroll_export_lines_source_uniq;
create unique index payroll_export_lines_source_uniq
  on payroll_export_lines(source_reference_type, source_reference_id)
  where source_reference_id is not null;

-- payroll_lines_insert already existed (from the original payroll-export
-- migration) and is unrelated to any of the column changes above, but its
-- with check only ever verified the run's company via has_role — never that
-- employee_id itself belongs to that company. A Finance user could
-- therefore insert a payroll line (manual or otherwise) targeting an
-- employee_id in a different company than the run. Re-created here with
-- that join added; every other clause is unchanged.
drop policy if exists payroll_lines_insert on payroll_export_lines;
create policy payroll_lines_insert on payroll_export_lines for insert
  with check (exists (
    select 1 from payroll_export_runs r
    join employees e on e.id = employee_id and e.company_id = r.company_id
    where r.id = run_id and has_role('finance', r.company_id) and r.status = 'draft'
  ));

-- ---- payroll_export_lines: update/delete, Finance-only, draft-only ----
-- Same shape as payroll_lines_insert (including the same employee/run-company
-- match in with check — updatePayrollLineAmount never sends employee_id, but
-- RLS must not depend on that). Update backs in-place amount corrections
-- (updatePayrollLineAmount); delete backs removing a bad manual/auto line
-- before submission. Once submitted, a line's fate belongs to the approval
-- workflow, same as the parent run.
create policy payroll_lines_update on payroll_export_lines for update
  using (exists (
    select 1 from payroll_export_runs r where r.id = run_id and has_role('finance', r.company_id) and r.status = 'draft'
  ))
  with check (exists (
    select 1 from payroll_export_runs r
    join employees e on e.id = employee_id and e.company_id = r.company_id
    where r.id = run_id and has_role('finance', r.company_id) and r.status = 'draft'
  ));

create policy payroll_lines_delete on payroll_export_lines for delete
  using (exists (
    select 1 from payroll_export_runs r where r.id = run_id and has_role('finance', r.company_id) and r.status = 'draft'
  ));

-- ---- generate_payroll_export_lines(): now also generates salary lines ----
-- Rewritten to build a real payroll table, not just a reimbursement/
-- encashment aggregator:
--   1. Deletes every previously auto-generated (is_manual = false) line for
--      this run, so re-running ("re-check for new lines") is idempotent and
--      always reflects current data — WITHOUT ever touching a line Finance
--      added or corrected by hand (is_manual = true is never deleted here).
--   2. Re-inserts one basic_salary line (and, when allowances->>'other' is
--      present and > 0, one other_allowance line) per active employee, from
--      their current compensation_details row.
--   3. Re-inserts reimbursement and leave-encashment lines exactly as
--      before — same source query, same not-exists/on-conflict dedup logic
--      (the partial unique index above still backs it), now just also
--      stamping is_manual = false and created_by explicitly.
-- Still no SECURITY DEFINER: runs under the caller's own RLS exactly as
-- before, so auth.uid() reliably names the acting Finance user throughout
-- (unlike decide_leave_approval()'s coalesce(auth.uid(), ...) idiom, which
-- exists only because that function IS SECURITY DEFINER and can run via a
-- system-initiated path with no JWT in scope).
create or replace function generate_payroll_export_lines(p_run_id uuid)
returns setof payroll_export_lines
language plpgsql
as $$
declare
  v_company_id uuid;
  v_period_start date;
  v_period_end date;
begin
  select company_id, make_date(period_year, period_month, 1), (make_date(period_year, period_month, 1) + interval '1 month - 1 day')::date
  into v_company_id, v_period_start, v_period_end
  from payroll_export_runs where id = p_run_id;

  delete from payroll_export_lines where run_id = p_run_id and is_manual = false;

  -- Three sibling data-modifying CTEs (none depends on another's writes),
  -- so the whole regeneration is one statement and the function returns
  -- every freshly generated line, salary lines included.
  return query
  with ins_salary as (
    insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, source_reference_type, source_reference_id, is_manual, created_by)
    select p_run_id, e.id, 'basic_salary', comp.base_salary, comp.currency, null, null, false, auth.uid()
    from employees e
    join compensation_details comp on comp.employee_id = e.id and comp.is_current = true
    where e.company_id = v_company_id
      and e.employment_status = 'active'
      and e.deleted_at is null
    returning *
  ),
  ins_allowance as (
    insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, source_reference_type, source_reference_id, is_manual, created_by)
    select p_run_id, e.id, 'other_allowance', (comp.allowances->>'other')::numeric, comp.currency, null, null, false, auth.uid()
    from employees e
    join compensation_details comp on comp.employee_id = e.id and comp.is_current = true
    where e.company_id = v_company_id
      and e.employment_status = 'active'
      and e.deleted_at is null
      and comp.allowances->>'other' is not null
      and (comp.allowances->>'other')::numeric > 0
    returning *
  ),
  ins_variable as (
    insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, source_reference_type, source_reference_id, is_manual, created_by)
    select p_run_id, c.employee_id, 'reimbursement', c.total_amount, c.currency, 'reimbursement_claim', c.id, false, auth.uid()
    from reimbursement_claims c
    join employees e on e.id = c.employee_id
    where e.company_id = v_company_id
      and c.status = 'approved'
      and not exists (
        select 1 from payroll_export_lines l where l.source_reference_type = 'reimbursement_claim' and l.source_reference_id = c.id
      )
    union all
    select p_run_id, l.employee_id, 'leave_encashment', l.amount_days, comp.currency, 'leave_ledger', l.id, false, auth.uid()
    from leave_ledger l
    join employees e on e.id = l.employee_id
    join compensation_details comp on comp.employee_id = e.id and comp.is_current = true
    where e.company_id = v_company_id
      and l.entry_type = 'encashment'
      and l.txn_date between v_period_start and v_period_end
      and not exists (
        select 1 from payroll_export_lines pl where pl.source_reference_type = 'leave_ledger' and pl.source_reference_id = l.id
      )
    on conflict (source_reference_type, source_reference_id) where source_reference_id is not null do nothing
    returning *
  )
  select * from ins_salary
  union all
  select * from ins_allowance
  union all
  select * from ins_variable;
end;
$$;
