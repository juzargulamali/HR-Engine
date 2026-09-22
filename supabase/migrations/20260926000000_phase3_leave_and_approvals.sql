-- =============================================================================
-- Phase 3 — Leave requests, comp-day ledger, deduction priority, approvals
--
-- Scope per docs/06-implementation-phases.md. This is the first phase where
-- a balance actually moves, so it gets the strictest transactional
-- treatment in the codebase so far: the whole "approve -> maybe route to
-- the next step -> or finalize and post the ledger" state machine runs as
-- ONE Postgres function (decide_leave_approval), not a sequence of
-- separate Server Action calls, specifically to make double-deduction and
-- lost-update races structurally impossible (`for update` row locks) — see
-- docs/07-risk-register.md risk 3.
--
-- The day-count and deduction-priority ALGORITHMS still live in
-- packages/domain (computeLeaveDays, resolveDeductionSources) as pure,
-- unit-tested TypeScript, used for the submission-time calculation and the
-- UI preview. decide_leave_approval() implements the same deduction-order
-- logic again in SQL because it must run inside one atomic transaction;
-- the two are kept deliberately simple and are cross-referenced in comments
-- so they can't quietly drift apart unnoticed — the RLS test suite
-- exercises the real (SQL) path.
-- =============================================================================

create type leave_ledger_entry_type as enum (
  'accrual', 'deduction', 'adjustment', 'carryover', 'encashment', 'reversal'
);

create type comp_day_entry_type as enum (
  'earned', 'redeemed', 'expired', 'adjustment', 'reversal'
);

create type request_status as enum (
  'draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'cancelled'
);

create type approval_decision as enum ('pending', 'approved', 'rejected', 'skipped');

create type approvable_entity as enum (
  'leave_request', 'reimbursement_claim', 'timesheet', 'generated_letter',
  'onboarding_task', 'offboarding_task', 'payroll_export_run'
);

-- -----------------------------------------------------------------------------
-- Leave requests
-- -----------------------------------------------------------------------------

create table leave_requests (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id),
  leave_type_code   text not null,
  start_date        date not null,
  end_date          date not null,
  half_day_start    boolean not null default false,
  half_day_end      boolean not null default false,
  total_days        numeric(5,2) not null,   -- computed by computeLeaveDays() at submission time
  reason            text,
  status            request_status not null default 'submitted',
  submitted_at      timestamptz not null default now(),
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (end_date >= start_date)
);

create index idx_leave_requests_employee on leave_requests(employee_id);

-- -----------------------------------------------------------------------------
-- Ledgers — append-only, immutable. Balance is always SUM(amount), never a
-- stored mutable column (docs/02-database-schema.md §2.5).
-- -----------------------------------------------------------------------------

create table leave_ledger (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id),
  leave_type_code   text not null,
  txn_date          date not null,
  entry_type        leave_ledger_entry_type not null,
  amount_days       numeric(6,2) not null,   -- signed: accrual/carryover positive, deduction negative
  reference_type    text,                     -- 'leave_request' | 'policy_run' | 'manual_adjustment'
  reference_id      uuid,
  reversal_of_id    uuid references leave_ledger(id),
  note              text,
  created_by        uuid not null,
  created_at        timestamptz not null default now()
);

create index idx_leave_ledger_employee_type on leave_ledger(employee_id, leave_type_code, txn_date);

create view leave_balances as
  select employee_id, leave_type_code, sum(amount_days) as balance_days
  from leave_ledger
  group by employee_id, leave_type_code;

create table comp_day_ledger (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id),
  txn_date        date not null,
  entry_type      comp_day_entry_type not null,
  days            numeric(5,2) not null,     -- signed, same convention as leave_ledger
  source          text,                       -- 'holiday_worked' | 'overtime' | 'manager_grant'
  expiry_date     date,                       -- set on 'earned' entries; consumed FIFO by the expiry sweep
  reference_type  text,
  reference_id    uuid,
  reversal_of_id  uuid references comp_day_ledger(id),
  created_by      uuid not null,
  created_at      timestamptz not null default now()
);

create index idx_comp_ledger_employee on comp_day_ledger(employee_id, txn_date);

create view comp_day_balances as
  select employee_id, sum(days) as balance_days
  from comp_day_ledger
  group by employee_id;

create table deduction_priority_rules (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references companies(id),     -- null + country_code = country-wide default
  country_code    text references countries(code),
  leave_type_code text not null,
  source_ledger   text not null check (source_ledger in ('comp_day', 'leave_ledger')),
  priority_order  int not null,       -- lower = drawn first
  effective_from  date not null default current_date,
  check (company_id is not null or country_code is not null)
);

create unique index idx_deduction_priority_scope
  on deduction_priority_rules (coalesce(company_id::text, country_code), leave_type_code, source_ledger, effective_from);

-- -----------------------------------------------------------------------------
-- Generic approval workflow engine (docs/02-database-schema.md §2.5) — the
-- first consumer is leave requests; Phase 4 reuses the same three tables
-- for reimbursement claims and timesheets without any schema change.
-- -----------------------------------------------------------------------------

create table approval_workflows (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id),
  country_code  text references countries(code),
  entity_type   approvable_entity not null,
  name          text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table approval_workflow_steps (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references approval_workflows(id),
  step_order        int not null,
  approver_type     text not null,   -- 'direct_manager' | 'manager_of_manager' | 'role:hr_admin' | 'role:finance' | 'role:ceo'
  condition         jsonb,           -- e.g. {"amount_gt": 5000} — read by the resolver, not yet used by leave
  unique (workflow_id, step_order)
);

-- Append-only decision log. A resubmission after rejection creates a NEW
-- set of rows; existing decisions are never edited by anyone but the
-- assigned approver making their one decision.
create table approvals (
  id              uuid primary key default gen_random_uuid(),
  entity_type     approvable_entity not null,
  entity_id       uuid not null,
  workflow_id     uuid references approval_workflows(id),
  step_order      int not null,
  approver_id     uuid not null references auth.users(id),
  decision        approval_decision not null default 'pending',
  decided_at      timestamptz,
  comments        text,
  created_at      timestamptz not null default now()
);

create index idx_approvals_entity on approvals(entity_type, entity_id);

-- Every new company gets a sensible default leave-approval workflow
-- automatically — one step, the requester's direct manager. HR Admin can
-- add more workflows/steps later (e.g. a second step for long requests);
-- this is a default, not a hard-coded rule — see docs/09-extending-the-system.md.
-- SECURITY DEFINER: this fires on every company insert, including by Sys
-- Admin (who provisions companies but never holds hr_admin on one — and
-- nobody could hold hr_admin scoped to a company that doesn't exist yet
-- until this same statement creates it). Auto-provisioning must always
-- succeed regardless of who created the company, so it bypasses RLS
-- deliberately rather than depending on the caller's own grants.
create or replace function seed_default_leave_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow_id uuid;
begin
  insert into approval_workflows (company_id, entity_type, name)
  values (new.id, 'leave_request', 'Default leave approval')
  returning id into v_workflow_id;

  insert into approval_workflow_steps (workflow_id, step_order, approver_type)
  values (v_workflow_id, 1, 'direct_manager');

  return new;
end;
$$;

create trigger companies_seed_default_leave_workflow
  after insert on companies
  for each row execute function seed_default_leave_workflow();

-- -----------------------------------------------------------------------------
-- Approver resolution — one function, used both when a leave request is
-- first submitted and when decide_leave_approval() advances to the next
-- step. Returns null if no eligible approver exists (e.g. a role has no
-- active holder), which callers treat as "skip this step."
-- -----------------------------------------------------------------------------

-- SECURITY DEFINER for the same reason as is_manager_of()/has_role() in
-- Phase 0: it needs to read across employees/user_roles rows the caller
-- can't necessarily see directly under RLS (a report submitting a leave
-- request can't otherwise SELECT their manager's employees row at all).
-- Returning "who approves this" is low-sensitivity org-chart information,
-- not a data leak, the same judgment call already made for is_manager_of().
create or replace function resolve_approver(p_approver_type text, p_employee_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_manager_id uuid;
  v_result uuid;
begin
  select company_id, manager_id into v_company_id, v_manager_id from employees where id = p_employee_id;

  if p_approver_type = 'direct_manager' then
    select user_id into v_result from employees where id = v_manager_id;
  elsif p_approver_type = 'manager_of_manager' then
    select user_id into v_result from employees where id = (select manager_id from employees where id = v_manager_id);
  elsif p_approver_type like 'role:%' then
    select ur.user_id into v_result
    from user_roles ur
    where ur.role = replace(p_approver_type, 'role:', '')::app_role
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = v_company_id)
    order by ur.granted_at asc
    limit 1;
  end if;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- The leave approval state machine — SECURITY DEFINER so it can read/write
-- across leave_requests/approvals/leave_ledger/comp_day_ledger atomically
-- inside one transaction (with row locks, so two concurrent decisions on
-- the same approval can't both succeed). It re-checks the caller's
-- authorization manually since SECURITY DEFINER bypasses RLS — the checks
-- below are the enforcement here, not a convenience mirror of it.
-- -----------------------------------------------------------------------------

create or replace function decide_leave_approval(p_approval_id uuid, p_decision approval_decision, p_comments text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval approvals%rowtype;
  v_request leave_requests%rowtype;
  v_next_step int;
  v_next_approver_type text;
  v_next_approver uuid;
  v_requester_user_id uuid;
  v_remaining numeric(6,2);
  v_rule record;
  v_available numeric(6,2);
  v_draw numeric(6,2);
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

  if v_approval.entity_type <> 'leave_request' then
    return; -- reserved for future entity types (Phase 4+); nothing further to do here
  end if;

  select * into v_request from leave_requests where id = v_approval.entity_id for update;

  if p_decision = 'rejected' then
    update leave_requests set status = 'rejected', decided_at = now() where id = v_request.id;
    return; -- rejection stops the chain; earlier decisions in the log are untouched
  end if;

  select user_id into v_requester_user_id from employees where id = v_request.employee_id;

  -- Is there a next step in this workflow?
  select step_order, approver_type into v_next_step, v_next_approver_type
  from approval_workflow_steps
  where workflow_id = v_approval.workflow_id and step_order > v_approval.step_order
  order by step_order asc
  limit 1;

  if found then
    v_next_approver := resolve_approver(v_next_approver_type, v_request.employee_id);
    -- Self-approval is structurally prevented: skip a step that would
    -- resolve back to the requester themselves (docs/05-automation-rules.md §5.3).
    if v_next_approver is not null and v_next_approver <> v_requester_user_id then
      insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id)
      values ('leave_request', v_request.id, v_approval.workflow_id, v_next_step, v_next_approver);
      update leave_requests set status = 'pending_approval' where id = v_request.id;
      return;
    end if;
    -- No eligible approver (role has nobody, or it's the requester) — fall
    -- through and finalize instead of leaving the request stuck forever.
  end if;

  -- Final approval: post the ledger deductions per deduction_priority_rules,
  -- comp-day capped at its current balance, remainder from the leave type's
  -- own ledger — mirrors resolveDeductionSources() in packages/domain.
  v_remaining := v_request.total_days;

  for v_rule in
    select dpr.source_ledger
    from deduction_priority_rules dpr
    join employees e on e.id = v_request.employee_id
    where dpr.leave_type_code = v_request.leave_type_code
      and (dpr.company_id = e.company_id or (dpr.company_id is null and dpr.country_code = e.country_code))
      and dpr.effective_from <= v_request.start_date
    order by dpr.priority_order asc
  loop
    exit when v_remaining <= 0;

    if v_rule.source_ledger = 'comp_day' then
      select coalesce(sum(days), 0) into v_available from comp_day_ledger where employee_id = v_request.employee_id;
      if v_available > 0 then
        v_draw := least(v_remaining, v_available);
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, reference_id, created_by)
        values (v_request.employee_id, v_request.start_date, 'redeemed', -v_draw, 'leave_request', v_request.id, coalesce(auth.uid(), v_requester_user_id));
        v_remaining := v_remaining - v_draw;
      end if;
    elsif v_rule.source_ledger = 'leave_ledger' then
      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
      values (v_request.employee_id, v_request.leave_type_code, v_request.start_date, 'deduction', -v_remaining, 'leave_request', v_request.id, coalesce(auth.uid(), v_requester_user_id));
      v_remaining := 0;
    end if;
  end loop;

  if v_remaining > 0 then
    -- No deduction_priority_rules configured for this leave type at all —
    -- default behavior: draw the whole amount from the leave type's own ledger.
    insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
    values (v_request.employee_id, v_request.leave_type_code, v_request.start_date, 'deduction', -v_remaining, 'leave_request', v_request.id, coalesce(auth.uid(), v_requester_user_id));
  end if;

  update leave_requests set status = 'approved', decided_at = now() where id = v_request.id;
end;
$$;

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table leave_requests enable row level security;
alter table leave_ledger enable row level security;
alter table comp_day_ledger enable row level security;
alter table deduction_priority_rules enable row level security;
alter table approval_workflows enable row level security;
alter table approval_workflow_steps enable row level security;
alter table approvals enable row level security;

-- ---- leave_requests: employee (own, full lifecycle while not yet decided),
--      manager chain (read + implicitly approve via the approvals table),
--      HR Admin (full, for corrections/cancellations), Finance/CEO (read).
create policy leave_requests_select on leave_requests for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
    or has_role('ceo', (select company_id from employees where id = employee_id))
  );

create policy leave_requests_insert on leave_requests for insert
  with check (employee_id = current_employee_id());

create policy leave_requests_update_self on leave_requests for update
  using (employee_id = current_employee_id() and status in ('submitted', 'pending_approval'))
  with check (employee_id = current_employee_id() and status = 'cancelled');

create policy leave_requests_update_hr on leave_requests for update
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- ledgers: read-only for everyone except decide_leave_approval() (which
--      is SECURITY DEFINER and so bypasses RLS entirely) and HR Admin manual
--      adjustments. No INSERT/UPDATE policy exists for ordinary users —
--      absence of a policy is the enforcement, same pattern as Phase 0.
create policy leave_ledger_select on leave_ledger for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy leave_ledger_insert_hr on leave_ledger for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create policy comp_ledger_select on comp_day_ledger for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy comp_ledger_insert_hr on comp_day_ledger for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- Ledgers are append-only at the table-grant level too — even HR Admin's
-- manual-adjustment policy above only ever INSERTs an offsetting entry.
revoke update, delete on leave_ledger from authenticated, anon;
revoke update, delete on comp_day_ledger from authenticated, anon;

-- Decisions are immutable once made and never removed — decide_leave_approval()
-- is SECURITY DEFINER and so bypasses this, the only writer that updates a row.
revoke update, delete on approvals from authenticated, anon;

-- ---- deduction_priority_rules: readable by anyone signed in (it explains
--      how their own balance will be drawn down), writable by HR Admin
--      scoped to the company, or a country-wide default by a country-scoped
--      HR Admin (same "unscoped-by-company" pattern as policy_versions).
create policy deduction_priority_select on deduction_priority_rules for select
  using (auth.role() = 'authenticated');

create policy deduction_priority_write on deduction_priority_rules for all
  using (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  )
  with check (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  );

-- ---- approval_workflows / steps: visible to anyone signed in (transparency
--      on how their request gets routed); managed by HR Admin.
create policy approval_workflows_select on approval_workflows for select
  using (auth.role() = 'authenticated');

create policy approval_workflows_write on approval_workflows for all
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));

create policy approval_workflow_steps_select on approval_workflow_steps for select
  using (auth.role() = 'authenticated');

create policy approval_workflow_steps_write on approval_workflow_steps for all
  using (exists (select 1 from approval_workflows w where w.id = workflow_id and has_role('hr_admin', w.company_id)))
  with check (exists (select 1 from approval_workflows w where w.id = workflow_id and has_role('hr_admin', w.company_id)));

-- ---- approvals: the assigned approver, the requester (for leave_request),
--      and HR Admin can see a decision row. Only decide_leave_approval()
--      (SECURITY DEFINER) writes to this table for the leave_request flow —
--      no direct INSERT/UPDATE policy exists for ordinary users, so a
--      client can never forge or edit a decision by calling .from() directly.
create policy approvals_select on approvals for select
  using (
    approver_id = auth.uid()
    or has_role('hr_admin')
    or (
      entity_type = 'leave_request'
      and exists (select 1 from leave_requests lr where lr.id = entity_id and lr.employee_id = current_employee_id())
    )
  );

-- The Server Action that submits a leave request inserts the FIRST approvals
-- row under the requester's own identity — allowed only when they're
-- inserting a pending step-1 row for their own just-created request.
create policy approvals_insert_initial on approvals for insert
  with check (
    step_order = 1
    and decision = 'pending'
    and entity_type = 'leave_request'
    and exists (select 1 from leave_requests lr where lr.id = entity_id and lr.employee_id = current_employee_id())
  );
