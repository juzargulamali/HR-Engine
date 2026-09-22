-- =============================================================================
-- Phase 4 — Reimbursements, projects, attendance/timesheets
--
-- Scope per docs/06-implementation-phases.md. This phase's whole point is to
-- prove the Phase 3 approval engine is genuinely generic: reimbursement
-- claims and timesheets are routed through the SAME approval_workflows /
-- approval_workflow_steps / approvals tables as leave, no schema change.
--
-- decide_leave_approval() from Phase 3 is generalized in place (via
-- `create or replace`, same function name and signature — its own comments
-- already said "reserved for future entity types") to decide approvals for
-- all three entity types, and picks up two real bug fixes surfaced while
-- generalizing it:
--   1. It only ever looked ONE step ahead. A workflow whose step 2 resolved
--      to the requester themselves (self-approval skip) fell straight
--      through to FINALIZING the request, silently skipping step 3+ if any
--      existed. It now walks every remaining step in order until it finds
--      one that both applies (condition-wise) and resolves to someone other
--      than the requester.
--   2. Steps can now be conditional on `condition->>'amount_gt'` (the column
--      already existed in Phase 3, "read by the resolver, not yet used by
--      leave" per that migration's own comment) — this is what makes
--      threshold-based reimbursement routing possible without a new table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reimbursements, projects, attendance/timesheets
-- -----------------------------------------------------------------------------

create table projects (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id),
  code         text not null,
  name         text not null,
  client_name  text,
  is_billable  boolean not null default true,
  is_active    boolean not null default true,
  deleted_at   timestamptz,
  unique (company_id, code)
);

create table project_allocations (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id),
  project_id        uuid not null references projects(id),
  allocation_percent numeric(5,2) not null check (allocation_percent between 0 and 100),
  start_date        date not null,
  end_date          date
);

create index idx_project_allocations_employee on project_allocations(employee_id);

-- Claims start as 'draft' (unlike leave_requests) — an employee builds up
-- several expense lines before submitting, so a genuine in-progress state
-- makes sense here. total_amount is NEVER client-supplied: it's kept in
-- sync with SUM(reimbursement_claim_lines.amount) by a trigger below, so a
-- claim can't under-report its own total to dodge the approval threshold.
create table reimbursement_claims (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id),
  claim_date     date not null default current_date,
  currency       text not null,
  total_amount   numeric(12,2) not null default 0,
  status         request_status not null default 'draft',
  submitted_at   timestamptz,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table reimbursement_claim_lines (
  id             uuid primary key default gen_random_uuid(),
  claim_id       uuid not null references reimbursement_claims(id) on delete cascade,
  line_no        int not null,
  expense_date   date not null,
  category       text not null,
  amount         numeric(12,2) not null check (amount > 0),
  description    text,
  project_id     uuid references projects(id),
  cost_center    text,
  receipt_file_path text,     -- storage path in `receipts`
  unique (claim_id, line_no)
);

create index idx_reimbursement_lines_claim on reimbursement_claim_lines(claim_id);

create or replace function recompute_claim_total()
returns trigger
language plpgsql
as $$
declare
  v_claim_id uuid := coalesce(new.claim_id, old.claim_id);
begin
  update reimbursement_claims
  set total_amount = coalesce((select sum(amount) from reimbursement_claim_lines where claim_id = v_claim_id), 0)
  where id = v_claim_id;
  return null;
end;
$$;

create trigger reimbursement_lines_recompute_total
  after insert or update or delete on reimbursement_claim_lines
  for each row execute function recompute_claim_total();

create table attendance_records (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  work_date     date not null,
  clock_in      timestamptz,
  clock_out     timestamptz,
  hours_worked  numeric(5,2),
  status        text not null default 'present', -- 'present'|'absent'|'leave'|'holiday'|'weekend'
  source        text not null default 'manual',   -- 'manual'|'biometric'|'import'
  unique (employee_id, work_date)
);

create table timesheets (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  period_start  date not null,
  period_end    date not null,
  status        request_status not null default 'draft',
  submitted_at  timestamptz,
  decided_at    timestamptz,
  unique (employee_id, period_start, period_end),
  check (period_end >= period_start)
);

create table timesheet_entries (
  id            uuid primary key default gen_random_uuid(),
  timesheet_id  uuid not null references timesheets(id) on delete cascade,
  work_date     date not null,
  project_id    uuid references projects(id),
  task_description text,
  hours         numeric(4,2) not null check (hours >= 0 and hours <= 24),
  is_billable   boolean not null default true
);

create index idx_timesheet_entries_timesheet on timesheet_entries(timesheet_id);

-- -----------------------------------------------------------------------------
-- Generic ownership check for the approvals table — replaces Phase 3's
-- approvals_insert_initial/approvals_select, which hardcoded 'leave_request'.
-- Adding a 4th approvable entity type (Phase 5+) means one more `when`
-- branch here, not a new RLS policy (docs/09-extending-the-system.md).
-- -----------------------------------------------------------------------------

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
    else
      return false;
  end case;
end;
$$;

drop policy approvals_select on approvals;

create policy approvals_select on approvals for select
  using (
    approver_id = auth.uid()
    or has_role('hr_admin')
    or is_entity_owner(entity_type, entity_id)
  );

drop policy approvals_insert_initial on approvals;

create policy approvals_insert_initial on approvals for insert
  with check (step_order = 1 and decision = 'pending' and is_entity_owner(entity_type, entity_id));

-- -----------------------------------------------------------------------------
-- Auto-provisioning: every company now gets a default one-step (direct
-- manager) workflow for all three entity types, not just leave. Replaces
-- Phase 3's seed_default_leave_workflow() (same trigger event, broader
-- effect) and backfills any company created before this migration.
-- -----------------------------------------------------------------------------

drop trigger companies_seed_default_leave_workflow on companies;
drop function seed_default_leave_workflow();

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
  foreach v_entity in array array['leave_request', 'reimbursement_claim', 'timesheet']::approvable_entity[]
  loop
    insert into approval_workflows (company_id, entity_type, name)
    values (new.id, v_entity, 'Default ' || replace(v_entity::text, '_', ' ') || ' approval')
    returning id into v_workflow_id;

    insert into approval_workflow_steps (workflow_id, step_order, approver_type)
    values (v_workflow_id, 1, 'direct_manager');
  end loop;

  return new;
end;
$$;

create trigger companies_seed_default_approval_workflows
  after insert on companies
  for each row execute function seed_default_approval_workflows();

do $$
declare
  v_company record;
  v_entity approvable_entity;
  v_workflow_id uuid;
begin
  for v_company in select id from companies loop
    foreach v_entity in array array['reimbursement_claim', 'timesheet']::approvable_entity[]
    loop
      if not exists (
        select 1 from approval_workflows where company_id = v_company.id and entity_type = v_entity
      ) then
        insert into approval_workflows (company_id, entity_type, name)
        values (v_company.id, v_entity, 'Default ' || replace(v_entity::text, '_', ' ') || ' approval')
        returning id into v_workflow_id;

        insert into approval_workflow_steps (workflow_id, step_order, approver_type)
        values (v_workflow_id, 1, 'direct_manager');
      end if;
    end loop;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- decide_approval() — generalizes Phase 3's decide_leave_approval() to
-- route/finalize leave_request, reimbursement_claim, and timesheet
-- approvals through the same state machine. Same name kept deliberately
-- (Phase 3's own comment: "reserved for future entity types") — this is
-- that extension, not a new function, so `packages/domain` and the UI's
-- one `.rpc('decide_leave_approval', ...)` call site don't need to know
-- which entity type they're deciding.
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
  -- leave_request-only
  v_leave_request leave_requests%rowtype;
  v_remaining numeric(6,2);
  v_rule record;
  v_available numeric(6,2);
  v_draw numeric(6,2);
  -- timesheet-only
  v_timesheet timesheets%rowtype;
  v_total_hours numeric(8,2);
  v_overtime_rules jsonb;
  v_threshold_hours numeric;
  v_ratio numeric;
  v_expiry_months int;
  v_overtime_hours numeric;
  v_comp_days numeric(5,2);
  v_country_code text;
  -- step walk
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
  elsif v_approval.entity_type = 'reimbursement_claim' then
    select employee_id, total_amount into v_employee_id, v_amount
    from reimbursement_claims where id = v_approval.entity_id for update;
  elsif v_approval.entity_type = 'timesheet' then
    select * into v_timesheet from timesheets where id = v_approval.entity_id for update;
    v_employee_id := v_timesheet.employee_id;
  else
    return; -- reserved for future entity types; nothing further to do here
  end if;

  select user_id into v_requester_user_id from employees where id = v_employee_id;

  if p_decision = 'rejected' then
    if v_approval.entity_type = 'leave_request' then
      update leave_requests set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'reimbursement_claim' then
      update reimbursement_claims set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'timesheet' then
      update timesheets set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
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

    v_next_approver := resolve_approver(v_step.approver_type, v_employee_id);
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
    end if;
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
    -- export job (Phase 6). Finalizing just unblocks that downstream step.
    update reimbursement_claims set status = 'approved', decided_at = now() where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'timesheet' then
    update timesheets set status = 'approved', decided_at = now() where id = v_timesheet.id;

    -- Overtime -> comp-day conversion (docs/05-automation-rules.md §5.1):
    -- event-triggered on approval, not scheduled. Resolves the employee's
    -- country overtime_rules policy as of the timesheet's period end; if
    -- none is active, or it doesn't define the fields below, nothing is
    -- converted — a missing/incomplete policy means "not configured yet",
    -- never a guess. Documented payload shape (docs/02-database-schema.md
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
  end if;
end;
$$;

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table projects enable row level security;
alter table project_allocations enable row level security;
alter table reimbursement_claims enable row level security;
alter table reimbursement_claim_lines enable row level security;
alter table attendance_records enable row level security;
alter table timesheets enable row level security;
alter table timesheet_entries enable row level security;

-- ---- projects: broad read (same "transparency" pattern as departments and
--      approval workflows — every employee needs to pick a project for a
--      timesheet/reimbursement line), HR Admin manages.
create policy projects_select on projects for select
  using (deleted_at is null and auth.role() = 'authenticated');

create policy projects_write on projects for all
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));

create policy project_allocations_select on project_allocations for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
    or has_role('ceo', (select company_id from employees where id = employee_id))
  );

create policy project_allocations_write on project_allocations for all
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- reimbursement_claims & lines: employee (own, full lifecycle while
--      draft/pending), manager chain + HR Admin + Finance + CEO (read),
--      Finance (mark paid — a plain status/field update, no ledger write
--      belongs here per docs/05-automation-rules.md; Phase 6's payroll
--      export is what actually pays it).
create policy reimbursement_select on reimbursement_claims for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
    or has_role('ceo', (select company_id from employees where id = employee_id))
  );

create policy reimbursement_insert on reimbursement_claims for insert
  with check (employee_id = current_employee_id() and status = 'draft');

-- Two distinct self-update policies, same split as leave_requests
-- (docs/09-extending-the-system.md): free editing while still a draft
-- (including the draft -> submitted transition), but once submitted the
-- ONLY change a client can make is cancelling — never a quiet edit to
-- claim_date/currency/etc. while an approval is pending.
create policy reimbursement_update_draft on reimbursement_claims for update
  using (employee_id = current_employee_id() and status = 'draft')
  with check (employee_id = current_employee_id() and status in ('draft', 'submitted'));

create policy reimbursement_update_cancel on reimbursement_claims for update
  using (employee_id = current_employee_id() and status in ('submitted', 'pending_approval'))
  with check (employee_id = current_employee_id() and status = 'cancelled');

create policy reimbursement_lines_select on reimbursement_claim_lines for select
  using (exists (
    select 1 from reimbursement_claims c
    where c.id = claim_id and (
      c.employee_id = current_employee_id()
      or is_manager_of(c.employee_id)
      or has_role('hr_admin', (select company_id from employees where id = c.employee_id))
      or has_role('finance', (select company_id from employees where id = c.employee_id))
      or has_role('ceo', (select company_id from employees where id = c.employee_id))
    )
  ));

-- Lines can only be added/changed/removed by the claim's own owner, and
-- only while the claim is still a draft — RLS enforces the lifecycle, not
-- just the ownership.
create policy reimbursement_lines_write on reimbursement_claim_lines for all
  using (exists (
    select 1 from reimbursement_claims c where c.id = claim_id and c.employee_id = current_employee_id() and c.status = 'draft'
  ))
  with check (exists (
    select 1 from reimbursement_claims c where c.id = claim_id and c.employee_id = current_employee_id() and c.status = 'draft'
  ));

-- ---- timesheets / entries: same lifecycle shape as reimbursements.
create policy timesheets_select on timesheets for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy timesheets_insert on timesheets for insert
  with check (employee_id = current_employee_id() and status = 'draft');

create policy timesheets_update_draft on timesheets for update
  using (employee_id = current_employee_id() and status = 'draft')
  with check (employee_id = current_employee_id() and status in ('draft', 'submitted'));

create policy timesheets_update_cancel on timesheets for update
  using (employee_id = current_employee_id() and status in ('submitted', 'pending_approval'))
  with check (employee_id = current_employee_id() and status = 'cancelled');

create policy timesheet_entries_select on timesheet_entries for select
  using (exists (
    select 1 from timesheets t
    where t.id = timesheet_id and (
      t.employee_id = current_employee_id()
      or is_manager_of(t.employee_id)
      or has_role('hr_admin', (select company_id from employees where id = t.employee_id))
      or has_role('finance', (select company_id from employees where id = t.employee_id))
    )
  ));

create policy timesheet_entries_write on timesheet_entries for all
  using (exists (
    select 1 from timesheets t where t.id = timesheet_id and t.employee_id = current_employee_id() and t.status = 'draft'
  ))
  with check (exists (
    select 1 from timesheets t where t.id = timesheet_id and t.employee_id = current_employee_id() and t.status = 'draft'
  ));

-- ---- attendance_records: self/manager/HR Admin read; HR Admin writes
--      (manual correction/import) — no dedicated UI this phase, but the
--      access model is real from the start, same as every other table.
create policy attendance_select on attendance_records for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy attendance_write on attendance_records for all
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- -----------------------------------------------------------------------------
-- Storage: receipts bucket — owner (while their claim is a draft) + HR
-- Admin + Finance (per docs/03-permission-matrix.md §3.3, "Upload receipt");
-- manager and CEO deliberately do NOT get file access, same least-privilege
-- pattern as identity-documents. Path convention:
-- `{company_id}/{employee_id}/{sub_path}`, same as every other bucket.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy receipts_select on storage.objects for select
  using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[2]::uuid = current_employee_id()
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
      or has_role('finance', (storage.foldername(name))[1]::uuid)
    )
  );

create policy receipts_write on storage.objects for insert
  with check (bucket_id = 'receipts' and (storage.foldername(name))[2]::uuid = current_employee_id());

create policy receipts_update on storage.objects for update
  using (bucket_id = 'receipts' and (storage.foldername(name))[2]::uuid = current_employee_id());

create policy receipts_delete on storage.objects for delete
  using (bucket_id = 'receipts' and (storage.foldername(name))[2]::uuid = current_employee_id());
