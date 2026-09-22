-- =============================================================================
-- Phase 6 — Letters, payroll-variable export, audit log, AI drafts.
--
-- Scope per docs/06-implementation-phases.md. Two things make this phase
-- different from Phase 4/5's "reuse the approval engine" story:
--
-- 1. Payroll export is explicitly the ONE workflow with no conditional
--    steps (docs/05-automation-rules.md §5.3, docs/08-decisions-log.md
--    decision 2): every payroll_export_run goes through role:finance then
--    role:ceo, unconditionally, forever. The generic engine still runs it
--    (a 4th proof of genericity), but HR Admin's normal freedom to edit
--    approval_workflow_steps would let someone quietly remove the CEO step
--    — so this migration adds one guard trigger that makes a
--    payroll_export_run workflow's steps immutable from the app layer,
--    the same "structural business rule enforced by a trigger, not just
--    RLS" pattern as the policy-activation two-person control.
-- 2. This is the first migration to actually wire up `audit_log` (the
--    table and its generic write_audit_log() trigger existed only in
--    schema.sql's forward-looking draft until now) and `ai_drafts`, the
--    one place an AI integration's service credential may ever write —
--    see docs/04-user-journeys.md §4.11 for the full authorize/reject
--    flow this schema exists to support.
-- =============================================================================

create type letter_status as enum ('draft', 'pending_approval', 'issued', 'void');
create type ai_draft_status as enum ('draft', 'authorized', 'rejected', 'discarded');

-- has_role(role, scope) requires an EXACT scope match (a company-scoped
-- grant does not satisfy an unscoped check, matching the SQL null-equality
-- semantics documented on has_role() itself) — right for every
-- company/country-scoped resource so far, but ai_drafts has no natural
-- company to scope by (it can propose a correction against any entity
-- type). The AI Suggestions queue is a role-restricted, not company-
-- scoped, review surface (docs/05-automation-rules.md §5.4: "restricted
-- to HR Admin/Sys Admin", no per-company split) — so this checks "holds
-- the role in ANY scope" instead.
create or replace function has_role_any_scope(p_role app_role)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = p_role and revoked_at is null);
$$;

-- -----------------------------------------------------------------------------
-- Letters
-- -----------------------------------------------------------------------------

create table letter_templates (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  country_code    text references countries(code),
  template_type   text not null,  -- 'salary_certificate'|'experience_letter'|'noc'|'offer_letter'
  name            text not null,
  body_template   text not null,  -- placeholders like {{employee.full_name}}
  requires_approval boolean not null default true,
  deleted_at      timestamptz
);

create table generated_letters (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  template_id   uuid not null references letter_templates(id),
  generated_by  uuid not null,
  generated_at  timestamptz not null default now(),
  file_path     text,          -- storage path in `letters` — the rendered HTML, not a real PDF (no renderer in this stack yet)
  status        letter_status not null default 'draft'
);

create index idx_generated_letters_employee on generated_letters(employee_id);

insert into storage.buckets (id, name, public)
values ('letters', 'letters', false)
on conflict (id) do nothing;

-- Same path convention as every other bucket: {company_id}/{employee_id}/{sub_path}.
create policy letters_select on storage.objects for select
  using (
    bucket_id = 'letters'
    and (
      (storage.foldername(name))[2]::uuid = current_employee_id()
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
    )
  );

create policy letters_write on storage.objects for insert
  with check (bucket_id = 'letters' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

-- -----------------------------------------------------------------------------
-- Payroll-variable export
-- -----------------------------------------------------------------------------

create table payroll_export_runs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  period_month  int not null check (period_month between 1 and 12),
  period_year   int not null,
  status        request_status not null default 'draft', -- draft (lines generated) -> submitted -> pending_approval -> approved/rejected
  generated_by  uuid not null,
  generated_at  timestamptz not null default now(),
  authorized_by uuid,
  authorized_at timestamptz,
  sent_at       timestamptz,  -- Finance marks this once the file has actually gone to the payroll provider
  file_path     text,         -- storage path in `payroll-exports`, a real CSV
  unique (company_id, period_month, period_year)
);

create table payroll_export_lines (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references payroll_export_runs(id) on delete cascade,
  employee_id    uuid not null references employees(id),
  component_code text not null check (component_code in ('reimbursement', 'leave_encashment')),
  amount         numeric(14,2) not null,
  currency       text not null,
  source_reference_type text not null,  -- 'reimbursement_claim' | 'leave_ledger' — traces back to the exact source row
  source_reference_id   uuid not null
);

create index idx_payroll_export_lines_run on payroll_export_lines(run_id);

-- -----------------------------------------------------------------------------
-- Payroll export's approval steps are immutable — the one workflow the
-- generic engine runs that nobody, not even HR Admin, may reconfigure.
-- "Mandatory on every export, regardless of amount" (decisions log #2)
-- would otherwise just be a convention someone could quietly edit away.
-- -----------------------------------------------------------------------------

-- NOTE on the bypass check: this can't use "auth.uid() is null" the way
-- guard_employee_self_update()/guard_appraisal_acknowledge() do, because
-- seed_default_approval_workflows() (SECURITY DEFINER) is what creates the
-- payroll workflow's two steps in the first place, and it fires on every
-- company insert with auth.uid() still populated (the real Sys Admin who
-- created the company) — auth.uid() is unaffected by SECURITY DEFINER.
-- current_user IS affected: a SECURITY DEFINER function executes as its
-- owner (never the 'authenticated' role PostgREST always connects as for
-- an ordinary client request), so checking current_user correctly tells
-- "trusted internal write" apart from "someone's direct client request"
-- even when both have the same auth.uid().
create or replace function guard_payroll_workflow_immutable()
returns trigger
language plpgsql
as $$
declare
  v_workflow_id uuid := coalesce(new.workflow_id, old.workflow_id);
  v_entity_type approvable_entity;
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old); -- trusted context: SECURITY DEFINER provisioning, migrations, admin/service-role
  end if;
  select entity_type into v_entity_type from approval_workflows where id = v_workflow_id;
  if v_entity_type = 'payroll_export_run' then
    raise exception 'The payroll export approval workflow (Finance then CEO, every time) cannot be modified';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger approval_workflow_steps_guard_payroll
  before insert or update or delete on approval_workflow_steps
  for each row execute function guard_payroll_workflow_immutable();

-- Same current_user reasoning: decide_leave_approval() (SECURITY DEFINER)
-- is the only path allowed to set authorized_by/authorized_at or move
-- status to 'approved'/'rejected' — Finance's own broad UPDATE policy on
-- this table (below) would otherwise let them set those columns directly
-- via an ordinary REST call, defeating the mandatory CEO sign-off.
create or replace function guard_payroll_run_client_update()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new; -- trusted context: decide_leave_approval(), migrations, admin/service-role
  end if;
  if new.authorized_by is distinct from old.authorized_by
    or new.authorized_at is distinct from old.authorized_at
    or (new.status is distinct from old.status and new.status not in ('draft', 'submitted', 'cancelled'))
  then
    raise exception 'Payroll export authorization can only happen through the approval workflow';
  end if;
  return new;
end;
$$;

create trigger payroll_runs_guard_client_update
  before update on payroll_export_runs
  for each row execute function guard_payroll_run_client_update();

-- Extend auto-provisioning to seed the mandatory 2-step payroll workflow
-- and a default 1-step (role:ceo) generated_letter workflow — only used
-- when a letter_templates row has requires_approval = true; HR Admin
-- issues everything else directly, no approvals row at all.
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

  return new;
end;
$$;

do $$
declare
  v_company record;
  v_workflow_id uuid;
begin
  for v_company in select id from companies loop
    if not exists (select 1 from approval_workflows where company_id = v_company.id and entity_type = 'generated_letter') then
      insert into approval_workflows (company_id, entity_type, name)
      values (v_company.id, 'generated_letter', 'Default generated letter approval')
      returning id into v_workflow_id;
      insert into approval_workflow_steps (workflow_id, step_order, approver_type) values (v_workflow_id, 1, 'role:ceo');
    end if;

    if not exists (select 1 from approval_workflows where company_id = v_company.id and entity_type = 'payroll_export_run') then
      insert into approval_workflows (company_id, entity_type, name)
      values (v_company.id, 'payroll_export_run', 'Payroll export authorization (Finance, then CEO — mandatory, every time)')
      returning id into v_workflow_id;
      insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
        (v_workflow_id, 1, 'role:finance'),
        (v_workflow_id, 2, 'role:ceo');
    end if;
  end loop;
end;
$$;

-- resolve_approver() is employee-centric (it needs an employee to find
-- their company/manager chain) — payroll_export_run has no single
-- employee, it's company-wide, so role:finance/role:ceo resolution for it
-- goes through this company-scoped variant instead. direct_manager/
-- manager_of_manager make no sense for a company-wide entity, so this
-- only implements the role:% branch.
create or replace function resolve_approver_for_company(p_approver_type text, p_company_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result uuid;
begin
  if p_approver_type like 'role:%' then
    select ur.user_id into v_result
    from user_roles ur
    where ur.role = replace(p_approver_type, 'role:', '')::app_role
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = p_company_id)
    order by ur.granted_at asc
    limit 1;
  end if;
  return v_result;
end;
$$;

-- Aggregates approved-but-not-yet-exported reimbursements and leave
-- encashments into payroll_export_lines, one line per source row so
-- reconciliation is exact ("payroll export line aggregation matches
-- ledger/claim source data exactly" — docs/06's own Phase 6 test
-- requirement). "Not yet exported" means no earlier payroll_export_lines
-- row already references that exact source row — so re-running this for
-- the same run is safe, and a source row can never be paid out twice
-- across different runs either. Runs under the caller's own RLS (Finance
-- already has read access to both source tables and insert access to
-- payroll_export_lines) — no SECURITY DEFINER needed.
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

  return query
  insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, source_reference_type, source_reference_id)
  select p_run_id, c.employee_id, 'reimbursement', c.total_amount, c.currency, 'reimbursement_claim', c.id
  from reimbursement_claims c
  join employees e on e.id = c.employee_id
  where e.company_id = v_company_id
    and c.status = 'approved'
    and not exists (
      select 1 from payroll_export_lines l where l.source_reference_type = 'reimbursement_claim' and l.source_reference_id = c.id
    )
  union all
  select p_run_id, l.employee_id, 'leave_encashment', l.amount_days, comp.currency, 'leave_ledger', l.id
  from leave_ledger l
  join employees e on e.id = l.employee_id
  join compensation_details comp on comp.employee_id = e.id and comp.is_current = true
  where e.company_id = v_company_id
    and l.entry_type = 'encashment'
    and l.txn_date between v_period_start and v_period_end
    and not exists (
      select 1 from payroll_export_lines pl where pl.source_reference_type = 'leave_ledger' and pl.source_reference_id = l.id
    )
  returning *;
end;
$$;

-- -----------------------------------------------------------------------------
-- decide_leave_approval() extended for 'generated_letter' and
-- 'payroll_export_run'. Same function, same reasoning as Phase 4's
-- extension: still one state machine, still walking every remaining step
-- with condition/self-approval awareness, entity-specific only in how it
-- fetches the entity and how it finalizes. payroll_export_run is the one
-- entity type with no single employee_id, so it resolves approvers via
-- resolve_approver_for_company() instead of resolve_approver(), and its
-- "requester" for self-approval purposes is whoever generated the run.
-- -----------------------------------------------------------------------------

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
  v_timesheet timesheets%rowtype;
  v_total_hours numeric(8,2);
  v_overtime_rules jsonb;
  v_threshold_hours numeric;
  v_ratio numeric;
  v_expiry_months int;
  v_overtime_hours numeric;
  v_comp_days numeric(5,2);
  v_country_code text;
  v_payroll_company_id uuid;
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
    end if;
    return; -- rejection stops the chain; earlier decisions in the log are untouched
  end if;

  -- Walk every remaining step in order (not just the next one) — a step
  -- whose condition doesn't apply (amount below its threshold) or whose
  -- resolved approver is the requester themselves is skipped, not treated
  -- as "no more steps".
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

    if v_next_approver is not null and v_next_approver <> v_requester_user_id then
      insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id)
      values (v_approval.entity_type, v_approval.entity_id, v_approval.workflow_id, v_step.step_order, v_next_approver);
      v_found_next := true;
      exit;
    end if;
    -- no eligible approver (role has nobody, or it's the requester) — keep
    -- walking forward rather than getting stuck or finalizing prematurely
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
    end if;
    -- generated_letter has only ever had one step (role:ceo) so it never reaches here
    return;
  end if;

  -- Final approval — entity-specific finalization.
  if v_approval.entity_type = 'leave_request' then
    v_remaining := v_leave_request.total_days;

    for v_rule in
      select dpr.source_ledger
      from deduction_priority_rules dpr
      join employees e on e.id = v_leave_request.employee_id
      where dpr.leave_type_code = v_leave_request.leave_type_code
        and (dpr.company_id = e.company_id or (dpr.company_id is null and dpr.country_code = e.country_code))
        and dpr.effective_from <= v_leave_request.start_date
      order by dpr.priority_order asc
    loop
      exit when v_remaining <= 0;

      if v_rule.source_ledger = 'comp_day' then
        select coalesce(sum(days), 0) into v_available from comp_day_ledger where employee_id = v_leave_request.employee_id;
        if v_available > 0 then
          v_draw := least(v_remaining, v_available);
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
      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
      values (v_leave_request.employee_id, v_leave_request.leave_type_code, v_leave_request.start_date, 'deduction', -v_remaining, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
    end if;

    update leave_requests set status = 'approved', decided_at = now() where id = v_leave_request.id;

  elsif v_approval.entity_type = 'reimbursement_claim' then
    -- No ledger write here — approved claims are picked up by the payroll
    -- export job. Finalizing just unblocks that downstream step.
    update reimbursement_claims set status = 'approved', decided_at = now() where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'timesheet' then
    update timesheets set status = 'approved', decided_at = now() where id = v_timesheet.id;

    -- Overtime -> comp-day conversion (docs/05-automation-rules.md §5.1):
    -- event-triggered on approval, not scheduled. Resolves the employee's
    -- country overtime_rules policy as of the timesheet's period end; if
    -- none is active, or it doesn't define the fields below, nothing is
    -- converted. Documented payload shape (docs/02-database-schema.md
    -- §2.4): {"weekly_threshold_hours": number, "comp_day_conversion_ratio":
    -- number (hours per comp-day), "comp_day_expiry_months": number|null}.
    select country_code into v_country_code from employees where id = v_timesheet.employee_id;
    v_overtime_rules := resolve_policy(v_country_code, 'overtime_rules', v_timesheet.period_end);

    if v_overtime_rules is not null
      and v_overtime_rules ? 'weekly_threshold_hours'
      and v_overtime_rules ? 'comp_day_conversion_ratio' then
      v_threshold_hours := (v_overtime_rules ->> 'weekly_threshold_hours')::numeric;
      v_ratio := (v_overtime_rules ->> 'comp_day_conversion_ratio')::numeric;
      v_expiry_months := nullif(v_overtime_rules ->> 'comp_day_expiry_months', '')::int;

      select coalesce(sum(hours), 0) into v_total_hours from timesheet_entries where timesheet_id = v_timesheet.id;
      v_overtime_hours := greatest(0, v_total_hours - v_threshold_hours);

      if v_overtime_hours > 0 and v_ratio > 0 then
        v_comp_days := round(v_overtime_hours / v_ratio, 2);
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
        values (
          v_timesheet.employee_id,
          v_timesheet.period_end,
          'earned',
          v_comp_days,
          'overtime',
          case when v_expiry_months is not null then (v_timesheet.period_end + (v_expiry_months || ' months')::interval)::date else null end,
          'timesheet',
          v_timesheet.id,
          coalesce(auth.uid(), v_requester_user_id)
        );
      end if;
    end if;

  elsif v_approval.entity_type = 'generated_letter' then
    update generated_letters set status = 'issued' where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'payroll_export_run' then
    -- The CEO's decision (the final, always-present step) stamps
    -- authorized_by/at — the one place this column is ever set, since
    -- there's no direct UPDATE policy on those columns for anyone.
    update payroll_export_runs
    set status = 'approved', authorized_by = coalesce(auth.uid(), v_requester_user_id), authorized_at = now()
    where id = v_approval.entity_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit log — generic before/after capture on the tables listed below.
-- company_id is resolved so HR Admin's view can be scoped to their own
-- company, not every company's history (docs/03-permission-matrix.md
-- §3.6: "View audit log: HR Admin R (HR-scoped entries), Sys Admin R
-- (system-scoped entries)"). Not every audited table carries company_id
-- directly, so it's derived: a direct column if present, else via the
-- row's employee_id, else (approvals, which is entity-type-generic) by
-- resolving the approved entity the same way is_entity_owner() does.
-- -----------------------------------------------------------------------------

-- Insert-only from the caller's point of view — nobody has an
-- INSERT/UPDATE/DELETE policy; every row is written by write_audit_log(),
-- SECURITY DEFINER, which bypasses RLS entirely for its own inserts.
create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null,
  record_id     uuid,
  action        text not null,   -- 'insert'|'update'|'delete'|'approve'|'reject'|'status_change'
  actor_id      uuid,
  actor_role    app_role,
  company_id    uuid references companies(id),
  before_data   jsonb,
  after_data    jsonb,
  is_ai_generated boolean not null default false,
  ai_context    jsonb,
  occurred_at   timestamptz not null default now()
);

create index idx_audit_log_record on audit_log(table_name, record_id);
create index idx_audit_log_company on audit_log(company_id);

create or replace function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role app_role;
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_employee_id uuid;
  v_company_id uuid;
begin
  select role into v_actor_role from user_roles
  where user_id = auth.uid() and revoked_at is null order by granted_at desc limit 1;

  if v_row ? 'company_id' then
    v_company_id := (v_row ->> 'company_id')::uuid;
  elsif TG_TABLE_NAME = 'companies' then
    v_company_id := (v_row ->> 'id')::uuid;
  elsif v_row ? 'employee_id' then
    select company_id into v_company_id from employees where id = (v_row ->> 'employee_id')::uuid;
  elsif TG_TABLE_NAME = 'employees' then
    v_company_id := (v_row ->> 'company_id')::uuid;
  elsif TG_TABLE_NAME = 'approvals' then
    v_employee_id := case v_row ->> 'entity_type'
      when 'leave_request' then (select employee_id from leave_requests where id = (v_row ->> 'entity_id')::uuid)
      when 'reimbursement_claim' then (select employee_id from reimbursement_claims where id = (v_row ->> 'entity_id')::uuid)
      when 'timesheet' then (select employee_id from timesheets where id = (v_row ->> 'entity_id')::uuid)
      when 'generated_letter' then (select employee_id from generated_letters where id = (v_row ->> 'entity_id')::uuid)
      else null
    end;
    if v_employee_id is not null then
      select company_id into v_company_id from employees where id = v_employee_id;
    elsif v_row ->> 'entity_type' = 'payroll_export_run' then
      select company_id into v_company_id from payroll_export_runs where id = (v_row ->> 'entity_id')::uuid;
    end if;
  end if;

  insert into audit_log(table_name, record_id, action, actor_id, actor_role, company_id, before_data, after_data)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    lower(TG_OP),
    auth.uid(),
    v_actor_role,
    v_company_id,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

-- HR-content tables (docs/03-permission-matrix.md's "HR-scoped entries").
create trigger audit_employees after insert or update or delete on employees
  for each row execute function write_audit_log();
create trigger audit_compensation after insert or update or delete on compensation_details
  for each row execute function write_audit_log();
create trigger audit_contracts after insert or update or delete on employment_contracts
  for each row execute function write_audit_log();
create trigger audit_leave_requests after insert or update or delete on leave_requests
  for each row execute function write_audit_log();
create trigger audit_leave_ledger after insert on leave_ledger
  for each row execute function write_audit_log();
create trigger audit_comp_ledger after insert on comp_day_ledger
  for each row execute function write_audit_log();
create trigger audit_approvals after insert or update on approvals
  for each row execute function write_audit_log();
create trigger audit_reimbursements after insert or update or delete on reimbursement_claims
  for each row execute function write_audit_log();
create trigger audit_payroll_runs after insert or update on payroll_export_runs
  for each row execute function write_audit_log();
create trigger audit_generated_letters after insert or update on generated_letters
  for each row execute function write_audit_log();

-- System-scoped tables (docs/03-permission-matrix.md's "system-scoped
-- entries" — role changes and company/tenant structure; NOT general HR
-- content). Login events aren't captured here — those live in Supabase
-- Auth's own logs, outside this application schema's reach.
create trigger audit_user_roles after insert or update on user_roles
  for each row execute function write_audit_log();
create trigger audit_companies after insert or update on companies
  for each row execute function write_audit_log();

-- -----------------------------------------------------------------------------
-- AI drafts — the ONE table an AI integration's service credential may
-- ever write to (docs/04-user-journeys.md §4.11). No RLS policy anywhere
-- in this codebase grants that identity insert/update on leave_ledger,
-- comp_day_ledger, approvals, or payroll_export_lines — turning a draft
-- into reality always goes through the normal human-identity Server
-- Action for that entity, never a write from here.
-- -----------------------------------------------------------------------------

create table ai_drafts (
  id                uuid primary key default gen_random_uuid(),
  entity_type       text not null,
  entity_id         uuid,             -- null if the draft proposes creating a new record
  proposed_action   text not null,    -- 'create'|'update'|'approve'|'reject'|'adjust_balance'|...
  proposed_payload  jsonb not null,
  rationale         text,
  created_by_agent  text not null,
  status            ai_draft_status not null default 'draft',
  authorized_by     uuid,
  authorized_at     timestamptz,
  reference_id      uuid,             -- back-link to whatever row the normal Server Action created on authorize (docs/04-user-journeys.md §4.11)
  created_at        timestamptz not null default now()
);

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table letter_templates enable row level security;
alter table generated_letters enable row level security;
alter table payroll_export_runs enable row level security;
alter table payroll_export_lines enable row level security;
alter table audit_log enable row level security;
alter table ai_drafts enable row level security;

-- ---- letter_templates: readable by anyone signed in (an employee needs
--      to see what they can request), HR Admin manages.
create policy letter_templates_select on letter_templates for select
  using (deleted_at is null and auth.role() = 'authenticated');

create policy letter_templates_write on letter_templates for all
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));

-- ---- generated_letters: employee (own, request/view), HR Admin (full,
--      issues on request), CEO (read — they need the letter itself, not
--      just their own approvals row, to know what they're signing off on).
create policy generated_letters_select on generated_letters for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('ceo', (select company_id from employees where id = employee_id))
  );

create policy generated_letters_insert on generated_letters for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create policy generated_letters_update on generated_letters for update
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- payroll_export_runs & lines: HR Admin (read), Finance (full run,
--      never a CEO's own field since the CEO acts through `approvals`),
--      CEO (read, so they can see what they're signing off on beyond just
--      the approvals row).
create policy payroll_runs_select on payroll_export_runs for select
  using (
    has_role('hr_admin', company_id)
    or has_role('finance', company_id)
    or has_role('ceo', company_id)
  );

create policy payroll_runs_insert on payroll_export_runs for insert
  with check (has_role('finance', company_id) and status = 'draft');

-- Finance can edit while still a draft, submit it (draft -> submitted),
-- and later mark it sent (only once authorized) — never touch
-- authorized_by/authorized_at, which only decide_leave_approval() sets.
create policy payroll_runs_update_finance on payroll_export_runs for update
  using (has_role('finance', company_id))
  with check (has_role('finance', company_id));

create policy payroll_lines_select on payroll_export_lines for select
  using (exists (
    select 1 from payroll_export_runs r
    where r.id = run_id and (has_role('hr_admin', r.company_id) or has_role('finance', r.company_id) or has_role('ceo', r.company_id))
  ));

create policy payroll_lines_insert on payroll_export_lines for insert
  with check (exists (
    select 1 from payroll_export_runs r where r.id = run_id and has_role('finance', r.company_id) and r.status = 'draft'
  ));

-- ---- audit_log: HR Admin sees HR-content rows scoped to their own
--      company; Sys Admin sees system-scoped rows (any company) — the
--      exact split in docs/03-permission-matrix.md §3.6. No one else, and
--      no INSERT/UPDATE/DELETE policy for any client role at all.
create policy audit_log_select_hr on audit_log for select
  using (
    table_name in (
      'employees', 'compensation_details', 'employment_contracts', 'leave_requests', 'leave_ledger',
      'comp_day_ledger', 'approvals', 'reimbursement_claims', 'payroll_export_runs', 'generated_letters'
    )
    and company_id is not null
    and has_role('hr_admin', company_id)
  );

create policy audit_log_select_sysadmin on audit_log for select
  using (table_name in ('companies', 'user_roles') and has_role('sys_admin'));

-- ---- ai_drafts: HR Admin/Sys Admin review queue (docs/05-automation-rules.md
--      §5.4). No INSERT/UPDATE policy for any authenticated role — only the
--      AI service's own credential (a Route Handler using the service-role
--      client, which bypasses RLS entirely) ever writes here, and even
--      that credential still has zero RLS grants on any operational table.
create policy ai_drafts_select on ai_drafts for select
  using (has_role_any_scope('hr_admin') or has_role_any_scope('sys_admin'));

-- HR Admin/Sys Admin authorize or reject by updating status —
-- authorized_by/authorized_at only meaningfully set alongside 'authorized'.
create policy ai_drafts_update on ai_drafts for update
  using (has_role_any_scope('hr_admin') or has_role_any_scope('sys_admin'))
  with check (has_role_any_scope('hr_admin') or has_role_any_scope('sys_admin'));
