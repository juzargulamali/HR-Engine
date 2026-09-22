-- =============================================================================
-- Enginious HR — PostgreSQL / Supabase schema (REVIEW DRAFT — not yet applied)
--
-- Companion to docs/02-database-schema.md. Read that document first; this file
-- is the DDL it describes. Organized as:
--   0. Extensions & enums
--   1. Org & identity
--   2. Employee master data & sensitive-data tiers
--   3. Country policy versioning
--   4. Leave, comp-off, deduction priority
--   5. Generic approval workflow engine
--   6. Reimbursements, projects, timesheets/attendance
--   7. Performance
--   8. Onboarding / offboarding
--   9. Documents, assets
--  10. Letters, payroll export
--  11. Audit log & AI drafts
--  12. Notifications
--  13. Helper functions (used by RLS policies)
--  14. Row-Level Security policies
--  15. Audit trigger wiring
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist; -- for date-range exclusion constraints

-- -----------------------------------------------------------------------------
-- 0. Enums
-- -----------------------------------------------------------------------------

create type app_role as enum (
  'employee', 'line_manager', 'hr_admin', 'finance', 'ceo', 'sys_admin'
);

create type employment_status as enum (
  'active', 'on_leave', 'suspended', 'terminated'
);

create type employment_type as enum (
  'full_time', 'part_time', 'contractor', 'intern'
);

create type contract_type as enum (
  'permanent', 'fixed_term', 'probation', 'contractor'
);

create type policy_type as enum (
  'leave_rules', 'overtime_rules', 'notice_period',
  'probation_rules', 'working_week', 'end_of_service_benefit'
);
-- Deliberately no 'public_holidays' member: holiday calendars are plain
-- dated facts (see the public_holidays table), not versioned JSON rules
-- with an effective-date range and a draft/activate workflow.

create type policy_status as enum ('draft', 'active', 'superseded');

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

create type document_status as enum ('valid', 'expiring_soon', 'expired');

create type asset_status as enum ('in_stock', 'issued', 'under_repair', 'retired');

create type letter_status as enum ('draft', 'pending_approval', 'issued', 'void');

create type ai_draft_status as enum ('draft', 'authorized', 'rejected', 'discarded');

-- Shared trigger utility — every table with an updated_at column reuses this
-- rather than each migration redefining its own copy.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Org & identity
-- -----------------------------------------------------------------------------

create table countries (
  code            text primary key,             -- ISO 3166-1 alpha-2: 'AE', 'SA', 'PL'
  name            text not null,
  default_currency text not null,                -- ISO 4217: 'AED', 'SAR', 'PLN'
  week_start_day  smallint not null default 1,    -- 0=Sunday .. 6=Saturday
  created_at      timestamptz not null default now()
);

create table companies (
  id              uuid primary key default gen_random_uuid(),
  legal_name      text not null,
  country_code    text not null references countries(code),
  registration_no text,
  default_currency text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid
);

create trigger companies_set_updated_at before update on companies
  for each row execute function set_updated_at();

create table departments (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  name                  text not null,
  parent_department_id  uuid references departments(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create trigger departments_set_updated_at before update on departments
  for each row execute function set_updated_at();

-- 1:1 with auth.users; no sensitive HR data here.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  locale      text not null default 'en',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Auto-provision a profile the moment a login is created (invite or
-- self-signup) — no manual follow-up step for a new user to end up without one.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

create table user_roles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          app_role not null,
  company_id    uuid references companies(id),   -- null = applies across all companies
  country_code  text references countries(code),  -- null = applies across all countries
  granted_by    uuid references auth.users(id),
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (user_id, role, company_id, country_code)
);

create index idx_user_roles_user on user_roles(user_id) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- 2. Employee master data & sensitive-data tiers
-- -----------------------------------------------------------------------------

create table employees (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id),   -- null until login provisioned
  employee_number     text not null,
  company_id          uuid not null references companies(id),
  country_code        text not null references countries(code),
  department_id       uuid references departments(id),
  manager_id          uuid references employees(id),
  first_name          text not null,
  last_name           text not null,
  personal_email      text,
  phone               text,
  date_of_birth       date,
  nationality          text,
  gender              text,
  hire_date           date not null,
  termination_date    date,
  employment_status   employment_status not null default 'active',
  employment_type     employment_type not null default 'full_time',
  job_title           text,
  cost_center         text,
  work_location       text,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  deleted_by          uuid,
  unique (company_id, employee_number)
);

create index idx_employees_manager on employees(manager_id) where deleted_at is null;
create index idx_employees_company on employees(company_id) where deleted_at is null;
-- Partial (non-null values only) so any number of not-yet-linked employees
-- can coexist, but a login can never be attached to two employee rows —
-- current_employee_id()'s `limit 1` would otherwise pick an arbitrary one.
create unique index employees_user_id_unique on employees(user_id) where user_id is not null;

-- Append-only contract history. Never UPDATE a row's terms; insert a new
-- version and flip the old one's is_current.
create table employment_contracts (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references employees(id),
  contract_type        contract_type not null,
  start_date           date not null,
  end_date             date,
  notice_period_days   int not null default 30,
  probation_end_date   date,
  document_file_path   text,                       -- storage path in `employee-documents`
  is_current           boolean not null default true,
  superseded_by        uuid references employment_contracts(id),
  version_no           int not null,
  created_at           timestamptz not null default now(),
  created_by           uuid not null
);

create index idx_contracts_employee_current
  on employment_contracts(employee_id) where is_current;

-- One function every reader goes through — never re-derive "the contract in
-- effect on date X" ad hoc in application code (same principle as
-- resolve_policy() for country rules, §2.4).
create or replace function get_contract_as_of(p_employee_id uuid, p_as_of date)
returns setof employment_contracts
language sql stable
as $$
  select * from employment_contracts
  where employee_id = p_employee_id
    and start_date <= p_as_of
    and (end_date is null or end_date >= p_as_of)
  order by version_no desc
  limit 1;
$$;

-- Sensitive tier 1: compensation & bank data. Same versioning pattern.
create table compensation_details (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id),
  effective_from      date not null,
  effective_to        date,
  base_salary         numeric(14,2) not null,
  currency            text not null,
  allowances          jsonb not null default '{}'::jsonb,
  payment_method      text,
  bank_name           text,
  bank_iban           text,
  bank_swift          text,
  is_current          boolean not null default true,
  superseded_by       uuid references compensation_details(id),
  created_at          timestamptz not null default now(),
  created_by          uuid not null
);

create index idx_comp_employee_current
  on compensation_details(employee_id) where is_current;

-- Sensitive tier 2: government identity documents.
create table identity_documents (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id),
  document_type     text not null,        -- 'passport' | 'emirates_id' | 'iqama' | 'pesel' | ...
  document_number   text not null,
  issuing_country    text,
  issue_date        date,
  expiry_date       date,
  file_path         text,                 -- storage path in `identity-documents`
  is_current        boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid not null
);

-- -----------------------------------------------------------------------------
-- 3. Country policy versioning (no hard-coded labor law)
-- -----------------------------------------------------------------------------

create table policy_versions (
  id              uuid primary key default gen_random_uuid(),
  country_code    text not null references countries(code),
  policy_type     policy_type not null,
  version_no      int not null,
  effective_from  date not null,
  effective_to    date,                  -- null = open-ended
  status          policy_status not null default 'draft',
  payload         jsonb not null,        -- shape validated in app layer (zod) per policy_type
  created_by      uuid not null,
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Only one *active* row may cover a given date for a given (country, policy_type).
  exclude using gist (
    country_code with =,
    policy_type with =,
    daterange(effective_from, effective_to, '[]') with &&
  ) where (status = 'active')
);

create trigger policy_versions_set_updated_at before update on policy_versions
  for each row execute function set_updated_at();

create table policy_leave_types (
  id                          uuid primary key default gen_random_uuid(),
  policy_version_id           uuid not null references policy_versions(id),
  leave_type_code             text not null,     -- 'annual', 'sick', 'maternity', 'hajj', ...
  name                        text not null,
  accrual_method              text not null,     -- 'monthly_accrual' | 'annual_grant' | 'per_service_year'
  accrual_rate_per_period     numeric(6,3),
  max_balance_days            numeric(6,2),
  carryover_max_days          numeric(6,2) default 0,
  carryover_expiry_months     int,
  min_service_days_to_accrue int default 0,
  requires_medical_cert_after_days int,
  approval_levels_required   int not null default 1,
  gender_restricted          text,               -- null | 'male' | 'female'
  updated_at                 timestamptz not null default now(),
  unique (policy_version_id, leave_type_code)
);

create trigger policy_leave_types_set_updated_at before update on policy_leave_types
  for each row execute function set_updated_at();

create table public_holidays (
  id            uuid primary key default gen_random_uuid(),
  country_code  text not null references countries(code),
  holiday_date  date not null,
  name          text not null,
  is_paid       boolean not null default true,
  updated_at    timestamptz not null default now(),
  unique (country_code, holiday_date)
);

create trigger public_holidays_set_updated_at before update on public_holidays
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Leave, comp-off, deduction priority
-- -----------------------------------------------------------------------------

create table leave_requests (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id),
  leave_type_code   text not null,
  start_date        date not null,
  end_date          date not null,
  half_day_start    boolean not null default false,
  half_day_end      boolean not null default false,
  total_days        numeric(5,2) not null,   -- computed by domain layer at submission time
  reason            text,
  status            request_status not null default 'submitted',
  submitted_at      timestamptz not null default now(),
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (end_date >= start_date)
);

create index idx_leave_requests_employee on leave_requests(employee_id);

-- Append-only, immutable. Balance = SUM(amount_days), never a stored mutable field.
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

create index idx_leave_ledger_employee_type
  on leave_ledger(employee_id, leave_type_code, txn_date);

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
  expiry_date     date,                       -- set on 'earned' entries; consumed FIFO
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

-- A plain table UNIQUE constraint can't take an expression like coalesce(...)
-- — a unique index can, so the "company override or country default" scope
-- de-duplication has to live here instead.
create unique index idx_deduction_priority_scope
  on deduction_priority_rules (coalesce(company_id::text, country_code), leave_type_code, source_ledger, effective_from);

-- -----------------------------------------------------------------------------
-- 5. Generic approval workflow engine (reused by leave, reimbursement, timesheets,
--    letters, onboarding/offboarding sign-off, payroll export authorization)
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
  condition         jsonb,           -- e.g. {"amount_gt": 5000} to make a step conditional
  unique (workflow_id, step_order)
);

-- Append-only decision log. A resubmission after rejection creates a NEW set
-- of rows; existing decisions are never edited.
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

-- -----------------------------------------------------------------------------
-- 6. Reimbursements, projects, attendance/timesheets
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

-- total_amount is NEVER client-supplied: kept in sync with
-- SUM(reimbursement_claim_lines.amount) here, so a claim can't under-report
-- its own total to dodge the approval threshold in decide_leave_approval().
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
-- 7. Performance
-- -----------------------------------------------------------------------------

create table performance_cycles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  name          text not null,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'open' check (status in ('open', 'closed')),
  check (period_end >= period_start)
);

create table goals (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  cycle_id      uuid not null references performance_cycles(id),
  title         text not null,
  description   text,
  weight_percent numeric(5,2) check (weight_percent between 0 and 100),
  target_date   date,
  status        text not null default 'in_progress' check (status in ('in_progress', 'achieved', 'missed')),
  self_rating   int check (self_rating between 1 and 5),
  manager_rating int check (manager_rating between 1 and 5),
  created_at    timestamptz not null default now()
);

create index idx_goals_employee on goals(employee_id);

-- Sensitive tier 3: appraisal content — separate RLS from base employee
-- record and from goals; Finance never gets a select policy on this table
-- at all (docs/03-permission-matrix.md §3.7).
create table appraisals (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id),
  cycle_id       uuid not null references performance_cycles(id),
  appraiser_id   uuid not null references auth.users(id),
  overall_rating int check (overall_rating between 1 and 5),
  strengths      text,
  areas_for_improvement text,
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'acknowledged')),
  submitted_at   timestamptz,
  acknowledged_at timestamptz,
  created_at     timestamptz not null default now()
);

create index idx_appraisals_employee on appraisals(employee_id);

-- Employees may only acknowledge (status -> 'acknowledged', set
-- acknowledged_at) — never edit rating/content, even though RLS lets them
-- update their own submitted appraisal row for that one transition. Same
-- column-guard-trigger pattern as guard_employee_self_update() (Phase 1).
create or replace function guard_appraisal_acknowledge()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- trusted backend/migration/seed context
  end if;
  if auth.uid() = (select user_id from employees where id = old.employee_id) then
    if new.overall_rating is distinct from old.overall_rating
      or new.strengths is distinct from old.strengths
      or new.areas_for_improvement is distinct from old.areas_for_improvement
      or new.cycle_id is distinct from old.cycle_id
      or new.appraiser_id is distinct from old.appraiser_id
      or new.submitted_at is distinct from old.submitted_at
    then
      raise exception 'An employee may only acknowledge their appraisal, not edit its content';
    end if;
  end if;
  return new;
end;
$$;

create trigger appraisals_guard_self_update
  before update on appraisals
  for each row execute function guard_appraisal_acknowledge();

-- -----------------------------------------------------------------------------
-- 8. Onboarding / offboarding
-- -----------------------------------------------------------------------------

create table checklist_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id),
  country_code  text references countries(code),
  kind          text not null check (kind in ('onboarding', 'offboarding')),
  name          text not null,
  is_active     boolean not null default true,
  check (company_id is not null or country_code is not null)
);

create table checklist_template_items (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references checklist_templates(id),
  step_order    int not null,
  task_name     text not null,
  assignee_role app_role not null,
  due_offset_days int not null default 0,    -- days from hire_date / termination_date
  unique (template_id, step_order)
);

create table employee_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id),
  template_item_id uuid not null references checklist_template_items(id),
  kind            text not null check (kind in ('onboarding', 'offboarding')),
  due_date        date,
  status          text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'skipped')),
  completed_by    uuid,
  completed_at    timestamptz
);

create index idx_employee_checklist_items_employee on employee_checklist_items(employee_id);

-- Generates the per-employee checklist from a template in one shot — the
-- "system generates employee_checklist_items rows with due_date = anchor +
-- due_offset_days" step from docs/04-user-journeys.md §4.3/§4.4. Runs under
-- the caller's own RLS (HR Admin's existing full-write grant on this table
-- covers every row it inserts, whatever assignee_role each one carries) —
-- no SECURITY DEFINER needed, unlike the approval engine's auto-provisioning.
create or replace function generate_checklist_items(p_employee_id uuid, p_template_id uuid, p_anchor_date date)
returns setof employee_checklist_items
language sql
as $$
  insert into employee_checklist_items (employee_id, template_item_id, kind, due_date)
  select p_employee_id, cti.id, ct.kind, p_anchor_date + cti.due_offset_days
  from checklist_template_items cti
  join checklist_templates ct on ct.id = cti.template_id
  where cti.template_id = p_template_id
  order by cti.step_order
  returning *;
$$;

-- -----------------------------------------------------------------------------
-- 9. Documents, assets
-- -----------------------------------------------------------------------------

create table employee_documents (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  document_type text not null,   -- 'visa'|'labor_card'|'certificate'|'other'
  file_path     text not null,   -- storage path in `employee-documents`
  expiry_date   date,
  status        document_status not null default 'valid',
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index idx_employee_documents_employee on employee_documents(employee_id);

create table document_expiry_reminder_rules (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id),
  country_code  text references countries(code),
  document_type text not null,
  lead_days     int not null check (lead_days > 0),
  check (company_id is not null or country_code is not null)
);

create table document_expiry_reminders_sent (
  id            uuid primary key default gen_random_uuid(),
  employee_document_id uuid not null references employee_documents(id),
  lead_days     int not null,
  sent_at       timestamptz not null default now(),
  unique (employee_document_id, lead_days)
);

create table assets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  asset_tag     text not null,
  category      text not null,
  description   text,
  purchase_date date,
  value         numeric(12,2),
  status        asset_status not null default 'in_stock',
  deleted_at    timestamptz,
  unique (company_id, asset_tag)
);

create table asset_assignments (
  id                  uuid primary key default gen_random_uuid(),
  asset_id            uuid not null references assets(id),
  employee_id         uuid not null references employees(id),
  issued_date         date not null default current_date,
  returned_date       date,
  condition_on_issue  text,
  condition_on_return text,
  issued_by           uuid not null
);

create index idx_asset_assignments_employee on asset_assignments(employee_id);
create index idx_asset_assignments_asset on asset_assignments(asset_id);

-- -----------------------------------------------------------------------------
-- 10. Letters, payroll export
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
  file_path     text,          -- storage path in `letters`
  status        letter_status not null default 'draft'
);

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
-- 11. Audit log & AI drafts
-- -----------------------------------------------------------------------------

-- Insert-only. No UPDATE/DELETE grants to any role (enforced below via REVOKE).
create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null,
  record_id     uuid,
  action        text not null,   -- 'insert'|'update'|'delete'|'approve'|'reject'|'status_change'
  actor_id      uuid,
  actor_role    app_role,
  company_id    uuid references companies(id), -- resolved by write_audit_log() so HR Admin's view scopes to their own company
  before_data   jsonb,
  after_data    jsonb,
  is_ai_generated boolean not null default false,
  ai_context    jsonb,
  occurred_at   timestamptz not null default now()
);

create index idx_audit_log_record on audit_log(table_name, record_id);
create index idx_audit_log_company on audit_log(company_id);

-- The ONLY table an AI integration's service credential may write to.
-- Turning a draft into reality is a human action performed through the normal
-- Server Action for that entity — never a write from here.
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
  reference_id      uuid,             -- back-link to whatever row the normal Server Action created on authorize
  created_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 12. Notifications
-- -----------------------------------------------------------------------------

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index idx_notifications_user on notifications(user_id, read_at);

-- =============================================================================
-- 13. Helper functions used by RLS policies (SECURITY DEFINER, STABLE, no
--     business logic — keep them trivial and reviewable)
-- =============================================================================

create or replace function current_employee_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from employees where user_id = auth.uid() and deleted_at is null limit 1;
$$;

create or replace function has_role(p_role app_role, p_company_id uuid default null, p_country_code text default null)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from user_roles
    where user_id = auth.uid()
      and role = p_role
      and revoked_at is null
      and (company_id is null or company_id = p_company_id)
      and (country_code is null or country_code = p_country_code)
  );
$$;

-- has_role(role, scope) requires an EXACT scope match (a company-scoped
-- grant does not satisfy an unscoped check, matching the SQL null-equality
-- semantics above) — right for every company/country-scoped resource, but
-- ai_drafts has no natural company to scope by and is a role-restricted,
-- not company-scoped, review surface — so this checks "holds the role in
-- ANY scope" instead.
create or replace function has_role_any_scope(p_role app_role)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = p_role and revoked_at is null);
$$;

create or replace function is_manager_of(target_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  with recursive chain as (
    select id, manager_id from employees where id = target_employee_id
    union all
    select e.id, e.manager_id
    from employees e
    join chain c on e.id = c.manager_id
  )
  select exists (select 1 from chain where manager_id = current_employee_id());
$$;

create or replace function same_company(target_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from employees me, employees target
    where me.id = current_employee_id()
      and target.id = target_employee_id
      and me.company_id = target.company_id
  );
$$;

-- Single resolver every leave/notice/holiday calculation must go through.
-- Country differences live entirely in policy_versions.payload — never in code.
create or replace function resolve_policy(p_country_code text, p_policy_type policy_type, p_as_of date)
returns jsonb
language sql stable
as $$
  select payload from policy_versions
  where country_code = p_country_code
    and policy_type = p_policy_type
    and status = 'active'
    and p_as_of between effective_from and coalesce(effective_to, 'infinity'::date)
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 13b. Leave approval engine — auto-provisioning, approver resolution, and the
--      atomic approve/reject/finalize state machine. See docs/09 for the
--      "default, not hard-coded" extension pattern this establishes.
-- -----------------------------------------------------------------------------

-- SECURITY DEFINER: this fires on every company insert, including by Sys
-- Admin (who provisions companies but never holds hr_admin on one — and
-- nobody could hold hr_admin scoped to a company that doesn't exist yet
-- until this same statement creates it). Auto-provisioning must always
-- succeed regardless of who created the company, so it bypasses RLS
-- deliberately rather than depending on the caller's own grants. Seeds a
-- default one-step (direct manager) workflow for leave/reimbursement/
-- timesheet, a default one-step (role:ceo) workflow for generated_letter
-- (only used when a letter_templates row has requires_approval = true),
-- and an always-present, unconditional 2-step (role:finance then
-- role:ceo) workflow for payroll_export_run — the one workflow nobody,
-- not even HR Admin, may reconfigure (see guard_payroll_workflow_immutable()
-- below).
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

create trigger companies_seed_default_approval_workflows
  after insert on companies
  for each row execute function seed_default_approval_workflows();

-- Generic ownership check for the approvals table — one `when` branch per
-- approvable entity type, added as each one lands (docs/09-extending-the-system.md).
-- generated_letter/payroll_export_run have no owning employee the way a
-- leave request does — both are staff-initiated on someone/something
-- else's behalf — so their rightful initiator is generated_by instead.
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
    else
      return false;
  end case;
end;
$$;

-- SECURITY DEFINER for the same reason as is_manager_of()/has_role(): it
-- needs to read across employees/user_roles rows the caller can't
-- necessarily see directly under RLS (a report submitting a leave request
-- can't otherwise SELECT their manager's employees row at all). Returning
-- "who approves this" is low-sensitivity org-chart information, not a data
-- leak — the same judgment call already made for is_manager_of().
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
-- reconciliation is exact. "Not yet exported" means no earlier
-- payroll_export_lines row already references that exact source row — so
-- re-running this for the same run is safe, and a source row can never be
-- paid out twice across different runs either. Runs under the caller's own
-- RLS (Finance already has read access to both source tables and insert
-- access to payroll_export_lines) — no SECURITY DEFINER needed.
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
-- Payroll export's approval steps are immutable — the one workflow the
-- generic engine runs that nobody, not even HR Admin, may reconfigure.
-- Mandatory on every export, regardless of amount — otherwise this would
-- just be a convention someone could quietly edit away.
-- -----------------------------------------------------------------------------

-- NOTE on the bypass check: this can't use "auth.uid() is null" the way a
-- self-service guard would, because seed_default_approval_workflows()
-- (SECURITY DEFINER) is what creates the payroll workflow's two steps in
-- the first place, and it fires on every company insert with auth.uid()
-- still populated (the real Sys Admin who created the company) —
-- auth.uid() is unaffected by SECURITY DEFINER. current_user IS affected:
-- a SECURITY DEFINER function executes as its owner (never the
-- 'authenticated' role PostgREST always connects as for an ordinary
-- client request), so checking current_user correctly tells "trusted
-- internal write" apart from "someone's direct client request" even when
-- both have the same auth.uid().
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
-- this table would otherwise let them set those columns directly via an
-- ordinary REST call, defeating the mandatory CEO sign-off.
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

-- The approval state machine — SECURITY DEFINER so it can read/write across
-- leave/reimbursement/timesheet/generated_letter/payroll_export_run tables
-- plus the ledgers atomically inside one transaction (with row locks, so
-- two concurrent decisions on the same approval can't both succeed). It
-- re-checks the caller's authorization manually since SECURITY DEFINER
-- bypasses RLS — the checks below are the enforcement here, not a
-- convenience mirror of it. Still one state machine: entity-specific only
-- in how it fetches the entity and how it finalizes. payroll_export_run is
-- the one entity type with no single employee_id, so it resolves approvers
-- via resolve_approver_for_company() instead of resolve_approver(), and
-- its "requester" for self-approval purposes is whoever generated the run.
-- Two real fixes along the way from its original leave-only version: (1) it
-- used to look only ONE step ahead, so a self-resolving step 2 could skip
-- straight to finalizing even if step 3+ existed — it now walks every
-- remaining step; (2) steps can be conditional on `condition->>'amount_gt'`,
-- which is what makes reimbursement threshold routing possible.
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

-- =============================================================================
-- 14. Row-Level Security
-- =============================================================================

alter table countries enable row level security;
alter table companies enable row level security;
alter table departments enable row level security;
alter table profiles enable row level security;
alter table employees enable row level security;
alter table employment_contracts enable row level security;
alter table compensation_details enable row level security;
alter table identity_documents enable row level security;
alter table policy_versions enable row level security;
alter table policy_leave_types enable row level security;
alter table public_holidays enable row level security;
alter table leave_requests enable row level security;
alter table leave_ledger enable row level security;
alter table comp_day_ledger enable row level security;
alter table deduction_priority_rules enable row level security;
alter table approval_workflows enable row level security;
alter table approval_workflow_steps enable row level security;
alter table approvals enable row level security;
alter table projects enable row level security;
alter table project_allocations enable row level security;
alter table reimbursement_claims enable row level security;
alter table reimbursement_claim_lines enable row level security;
alter table timesheets enable row level security;
alter table timesheet_entries enable row level security;
alter table attendance_records enable row level security;
alter table performance_cycles enable row level security;
alter table goals enable row level security;
alter table appraisals enable row level security;
alter table checklist_templates enable row level security;
alter table checklist_template_items enable row level security;
alter table employee_checklist_items enable row level security;
alter table employee_documents enable row level security;
alter table document_expiry_reminder_rules enable row level security;
alter table document_expiry_reminders_sent enable row level security;
alter table notifications enable row level security;
alter table assets enable row level security;
alter table asset_assignments enable row level security;
alter table letter_templates enable row level security;
alter table generated_letters enable row level security;
alter table payroll_export_runs enable row level security;
alter table payroll_export_lines enable row level security;
alter table ai_drafts enable row level security;
alter table audit_log enable row level security;
alter table user_roles enable row level security;

-- ---- countries: reference data, readable by any signed-in user, written only
--      by Sys Admin (structural — see permission matrix §3.6).
create policy countries_select on countries for select
  using (auth.role() = 'authenticated');

create policy countries_write on countries for all
  using (has_role('sys_admin'))
  with check (has_role('sys_admin'));

-- ---- companies: same pattern — visible company-directory data, structural
--      writes reserved for Sys Admin.
create policy companies_select on companies for select
  using (deleted_at is null and auth.role() = 'authenticated');

create policy companies_write on companies for all
  using (has_role('sys_admin'))
  with check (has_role('sys_admin'));

-- ---- departments: visible to any signed-in user (org browsing), managed by
--      HR Admin within their company or Sys Admin structurally.
create policy departments_select on departments for select
  using (deleted_at is null and auth.role() = 'authenticated');

create policy departments_write on departments for all
  using (has_role('hr_admin', company_id) or has_role('sys_admin'))
  with check (has_role('hr_admin', company_id) or has_role('sys_admin'));

-- ---- profiles: low-sensitivity directory data (name/email/locale) — visible
--      to any signed-in user so approver/manager pickers work; a user edits
--      only their own row; Sys Admin manages any (account troubleshooting).
create policy profiles_select on profiles for select
  using (auth.role() = 'authenticated');

create policy profiles_update_own on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_write_sysadmin on profiles for update
  using (has_role('sys_admin'))
  with check (has_role('sys_admin'));

-- ---- employees: self, manager chain (read-only, non-sensitive columns only via a view),
--      HR Admin (full), Finance (read, for cost-center/payroll purposes), CEO (read), Sys Admin (read, no write to content)
--      HR Admin and Sys Admin bypass the deleted_at filter — they're the two
--      roles who can recover a soft-deleted employee (§2.8), which requires
--      being able to see the row exists in the first place.
create policy employees_select on employees for select
  using (
    has_role('hr_admin', company_id)
    or has_role('sys_admin')
    or (
      deleted_at is null and (
        id = current_employee_id()
        or is_manager_of(id)
        or has_role('finance', company_id)
        or has_role('ceo', company_id)
      )
    )
  );

create policy employees_write_hr on employees for insert with check (has_role('hr_admin', company_id));
create policy employees_update_hr on employees for update
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));

-- Self-service contact info edit (personal_email/phone only). RLS is
-- row-level, not column-level, so the "nothing else" part is enforced by a
-- trigger, not the policy itself — HR Admin passes straight through it via
-- employees_update_hr already covering full edit rights.
create policy employees_update_self on employees for update
  using (id = current_employee_id())
  with check (id = current_employee_id());

create or replace function guard_employee_self_update()
returns trigger
language plpgsql
as $$
begin
  -- Triggers fire regardless of role, unlike RLS — a trusted backend write
  -- (migration, seed, admin/service-role operation with no PostgREST JWT
  -- session) has auth.uid() = null and is never what this guard constrains.
  if auth.uid() is null or has_role('hr_admin', new.company_id) then
    return new;
  end if;

  if new.first_name is distinct from old.first_name
    or new.last_name is distinct from old.last_name
    or new.company_id is distinct from old.company_id
    or new.country_code is distinct from old.country_code
    or new.department_id is distinct from old.department_id
    or new.manager_id is distinct from old.manager_id
    or new.employee_number is distinct from old.employee_number
    or new.job_title is distinct from old.job_title
    or new.employment_status is distinct from old.employment_status
    or new.employment_type is distinct from old.employment_type
    or new.hire_date is distinct from old.hire_date
    or new.termination_date is distinct from old.termination_date
    or new.cost_center is distinct from old.cost_center
    or new.work_location is distinct from old.work_location
    or new.deleted_at is distinct from old.deleted_at
    or new.deleted_by is distinct from old.deleted_by
  then
    raise exception 'Only personal_email and phone can be self-updated — ask HR Admin to change anything else.';
  end if;

  return new;
end;
$$;

create trigger employees_guard_self_update
  before update on employees
  for each row execute function guard_employee_self_update();

-- ---- employment_contracts: employee (own, every version), Line Manager (team,
--      current version only — historical terms aren't a manager's business),
--      HR Admin (full), Finance/CEO (read), Sys Admin (no access) — matches
--      permission matrix §3.1 exactly.
create policy employment_contracts_select on employment_contracts for select
  using (
    employee_id = current_employee_id()
    or (is_manager_of(employee_id) and is_current)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
    or has_role('ceo', (select company_id from employees where id = employee_id))
  );

create policy employment_contracts_insert on employment_contracts for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- The only legitimate UPDATE is HR Admin flipping an old version's
-- is_current/superseded_by when a new one is inserted, never editing a
-- version's terms after the fact — a process convention (RLS doesn't
-- restrict by column), same trust level the permission matrix already
-- gives HR Admin ("F") for this resource.
create policy employment_contracts_update on employment_contracts for update
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- compensation_details: HR Admin + Finance (full within their company), employee (read own only)
create policy compensation_select on compensation_details for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy compensation_insert on compensation_details for insert
  with check (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy compensation_update on compensation_details for update
  using (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  )
  with check (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

-- ---- identity_documents: HR Admin only + employee reads own; never Finance/line managers
create policy identity_docs_select on identity_documents for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy identity_docs_insert on identity_documents for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create policy identity_docs_update on identity_documents for update
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- policy_versions: active versions are visible to any signed-in user
--      (it's company policy, not a secret); drafts are visible only to the
--      HR Admin/CEO who'd act on them. Drafting is HR Admin's alone;
--      updating a draft (content edit or activation) is HR Admin or CEO,
--      country-scoped — "CEO can only activate, not edit" and "not the
--      same person who drafted it" live in the trigger below, since RLS
--      can't express either at the row-visibility level.
--
--      has_role(..., null, country_code) intentionally requires an
--      unscoped-by-company grant — a single-company HR Admin shouldn't
--      unilaterally change a policy that can affect every company in that
--      country.
create policy policy_versions_select on policy_versions for select
  using (
    status = 'active'
    or has_role('hr_admin', null, country_code)
    or has_role('ceo', null, country_code)
  );

-- Every new version must start as a draft — without this, an HR Admin could
-- insert a row already marked 'active' and skip the two-person activation
-- control entirely, since that control only guards the UPDATE path above.
create policy policy_versions_insert on policy_versions for insert
  with check (has_role('hr_admin', null, country_code) and status = 'draft');

create policy policy_versions_update on policy_versions for update
  using (
    status = 'draft'
    and (has_role('hr_admin', null, country_code) or has_role('ceo', null, country_code))
  )
  with check (has_role('hr_admin', null, country_code) or has_role('ceo', null, country_code));

create or replace function guard_policy_version_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- trusted backend write (migration/seed/service-role) — see the Phase 1 employee self-update guard for why
  end if;

  if not has_role('hr_admin', null, new.country_code) then
    if new.policy_type is distinct from old.policy_type
      or new.version_no is distinct from old.version_no
      or new.effective_from is distinct from old.effective_from
      or new.effective_to is distinct from old.effective_to
      or new.payload is distinct from old.payload
      or new.country_code is distinct from old.country_code
      or new.created_by is distinct from old.created_by
    then
      raise exception 'CEO may only activate a drafted policy, not edit its content — ask HR Admin to change it.';
    end if;
  end if;

  if new.status = 'active' and old.status is distinct from 'active' then
    if auth.uid() = old.created_by then
      raise exception 'A policy version must be activated by someone other than who drafted it.';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;

  return new;
end;
$$;

create trigger policy_versions_guard_update
  before update on policy_versions
  for each row execute function guard_policy_version_update();

-- ---- policy_leave_types: follows its parent policy_version's visibility;
--      only editable while the parent is still a draft, HR Admin only.
create policy policy_leave_types_select on policy_leave_types for select
  using (
    exists (
      select 1 from policy_versions pv
      where pv.id = policy_version_id
        and (
          pv.status = 'active'
          or has_role('hr_admin', null, pv.country_code)
          or has_role('ceo', null, pv.country_code)
        )
    )
  );

create policy policy_leave_types_insert on policy_leave_types for insert
  with check (
    exists (
      select 1 from policy_versions pv
      where pv.id = policy_version_id and pv.status = 'draft' and has_role('hr_admin', null, pv.country_code)
    )
  );

create policy policy_leave_types_update on policy_leave_types for update
  using (
    exists (
      select 1 from policy_versions pv
      where pv.id = policy_version_id and pv.status = 'draft' and has_role('hr_admin', null, pv.country_code)
    )
  )
  with check (
    exists (
      select 1 from policy_versions pv
      where pv.id = policy_version_id and pv.status = 'draft' and has_role('hr_admin', null, pv.country_code)
    )
  );

create policy policy_leave_types_delete on policy_leave_types for delete
  using (
    exists (
      select 1 from policy_versions pv
      where pv.id = policy_version_id and pv.status = 'draft' and has_role('hr_admin', null, pv.country_code)
    )
  );

-- ---- public_holidays: reference data, readable by any signed-in user,
--      managed by HR Admin for that country.
create policy public_holidays_select on public_holidays for select
  using (auth.role() = 'authenticated');

create policy public_holidays_write on public_holidays for all
  using (has_role('hr_admin', null, country_code))
  with check (has_role('hr_admin', null, country_code));

-- ---- performance_cycles: any signed-in user reads (needed to see which
--      cycle their own goals/appraisal belong to), HR Admin manages.
create policy performance_cycles_select on performance_cycles for select
  using (auth.role() = 'authenticated');

create policy performance_cycles_write on performance_cycles for all
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));

-- ---- goals: employee owns their own (including self_rating), manager
--      chain and HR Admin can read/set manager_rating. Manager/HR Admin
--      writes are full-row for simplicity — goals are low-sensitivity
--      (not one of the four tiers in docs/02-database-schema.md §2.3),
--      unlike appraisals below which get a real column guard.
create policy goals_select on goals for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy goals_write_self on goals for all
  using (employee_id = current_employee_id())
  with check (employee_id = current_employee_id());

create policy goals_write_manager on goals for update
  using (is_manager_of(employee_id) or has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (is_manager_of(employee_id) or has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- appraisals: appraiser (own-written) + HR Admin (any, calibration)
--      write; employee sees/acknowledges only once submitted. Finance and
--      CEO get no policy here at all — absence is the enforcement.
create policy appraisals_select on appraisals for select
  using (
    (employee_id = current_employee_id() and status in ('submitted', 'acknowledged'))
    or appraiser_id = auth.uid()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy appraisals_insert on appraisals for insert
  with check (
    appraiser_id = auth.uid()
    and (is_manager_of(employee_id) or has_role('hr_admin', (select company_id from employees where id = employee_id)))
  );

create policy appraisals_update_appraiser on appraisals for update
  using (appraiser_id = auth.uid() and status = 'draft')
  with check (appraiser_id = auth.uid() and status in ('draft', 'submitted'));

create policy appraisals_update_hr on appraisals for update
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create policy appraisals_update_acknowledge on appraisals for update
  using (employee_id = current_employee_id() and status = 'submitted')
  with check (employee_id = current_employee_id() and status = 'acknowledged');

-- ---- checklist templates: readable by anyone signed in (transparency on
--      what onboarding/offboarding involves), HR Admin manages.
create policy checklist_templates_select on checklist_templates for select
  using (auth.role() = 'authenticated');

create policy checklist_templates_write on checklist_templates for all
  using (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  )
  with check (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  );

create policy checklist_template_items_select on checklist_template_items for select
  using (auth.role() = 'authenticated');

create policy checklist_template_items_write on checklist_template_items for all
  using (exists (
    select 1 from checklist_templates ct where ct.id = template_id and (
      (ct.company_id is not null and has_role('hr_admin', ct.company_id))
      or (ct.country_code is not null and has_role('hr_admin', null, ct.country_code))
    )
  ))
  with check (exists (
    select 1 from checklist_templates ct where ct.id = template_id and (
      (ct.company_id is not null and has_role('hr_admin', ct.company_id))
      or (ct.country_code is not null and has_role('hr_admin', null, ct.country_code))
    )
  ));

-- ---- employee_checklist_items: the employee sees their own progress;
--      whoever holds the item's assignee_role for that employee (their own
--      manager if assignee_role='line_manager', any finance/sys_admin
--      holder in-company otherwise) can see and complete it; HR Admin sees
--      and manages everything.
create policy employee_checklist_items_select on employee_checklist_items for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'line_manager')
      and is_manager_of(employee_id)
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'finance')
      and has_role('finance', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'sys_admin')
      and has_role('sys_admin')
    )
  );

create policy employee_checklist_items_write_hr on employee_checklist_items for all
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- Everyone else who can SEE an assigned item (per the select policy above)
-- may update its status/completion — WITH CHECK intentionally omitted so it
-- defaults to re-evaluating this same USING expression against the new
-- row, which blocks reassigning template_item_id/employee_id to something
-- the caller couldn't otherwise see.
create policy employee_checklist_items_complete on employee_checklist_items for update
  using (
    employee_id = current_employee_id()
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'line_manager')
      and is_manager_of(employee_id)
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'finance')
      and has_role('finance', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'sys_admin')
      and has_role('sys_admin')
    )
  );

-- ---- employee_documents: employee (own, upload/view), HR Admin (all in
--      company, including soft-deleted for recovery — same pattern as
--      employees_select in Phase 1). Policy names are suffixed "_table_"
--      to avoid colliding with the Phase 1 storage.objects policies of the
--      almost-identical name "employee_documents_select" etc. below.
create policy employee_documents_table_select on employee_documents for select
  using (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or (deleted_at is null and employee_id = current_employee_id())
  );

create policy employee_documents_table_insert on employee_documents for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create policy employee_documents_table_update on employee_documents for update
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- document_expiry_reminder_rules: HR Admin configures; Sys Admin
--      read-only; nobody else (docs/03-permission-matrix.md §3.5 — this
--      row is explicitly HR Admin F / Sys Admin R / everyone else "–").
create policy document_expiry_rules_select on document_expiry_reminder_rules for select
  using (
    has_role('sys_admin')
    or (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  );

create policy document_expiry_rules_write on document_expiry_reminder_rules for all
  using (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  )
  with check (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  );

-- ---- document_expiry_reminders_sent: HR Admin reads (audit trail of what
--      fired); only the scheduled job (service-role, bypasses RLS) writes.
create policy document_expiry_reminders_sent_select on document_expiry_reminders_sent for select
  using (exists (
    select 1 from employee_documents ed
    join employees e on e.id = ed.employee_id
    where ed.id = employee_document_id and has_role('hr_admin', e.company_id)
  ));

-- ---- notifications: strictly own — nobody else, not even HR Admin, reads
--      another person's notification feed. Only the recipient can mark
--      their own read; only trusted backend jobs (service-role) insert.
create policy notifications_select on notifications for select
  using (user_id = auth.uid());

create policy notifications_update_own on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- assets: the general inventory/register is HR Admin (full) + Finance
--      (read) only — an employee or manager doesn't browse the whole
--      company's unassigned stock. An employee/manager can still see the
--      specific asset row(s) actually issued to them/their team, via
--      asset_assignments, so "what is this asset issued to me" resolves.
create policy assets_select on assets for select
  using (
    deleted_at is null
    and (
      has_role('hr_admin', company_id)
      or has_role('finance', company_id)
      or exists (
        select 1 from asset_assignments aa
        where aa.asset_id = assets.id
          and (aa.employee_id = current_employee_id() or is_manager_of(aa.employee_id))
      )
    )
  );

create policy assets_write on assets for all
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));

create policy asset_assignments_select on asset_assignments for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy asset_assignments_write on asset_assignments for all
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

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
    or is_entity_owner(entity_type, entity_id)
  );

-- The Server Action that submits a request inserts the FIRST approvals row
-- under the requester's own identity — allowed only when they're inserting
-- a pending step-1 row for their own just-created leave/claim/timesheet.
-- is_entity_owner() is the one place a 4th approvable entity type needs
-- touching (docs/09-extending-the-system.md) — this policy never changes.
create policy approvals_insert_initial on approvals for insert
  with check (step_order = 1 and decision = 'pending' and is_entity_owner(entity_type, entity_id));

-- ---- projects: broad read (same "transparency" pattern as departments —
--      every employee needs to pick a project for a timesheet/claim line),
--      HR Admin manages.
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
--      draft/pending), manager chain + HR Admin + Finance + CEO (read).
--      Two self-update policies (same split as leave_requests): free
--      editing while still a draft (including draft -> submitted), but once
--      submitted the ONLY change a client can make is cancelling.
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
--      (manual correction/import).
create policy attendance_select on attendance_records for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy attendance_write on attendance_records for all
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

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

create policy generated_letters_delete on generated_letters for delete
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)));

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
-- authorized_by/authorized_at, which only decide_leave_approval() sets
-- (guard_payroll_run_client_update() above enforces that, not this policy).
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

-- ---- ai_drafts: HR Admin/Sys Admin review queue, in ANY scope they hold
--      it (has_role_any_scope — ai_drafts has no natural company to scope
--      by, and this is a role-restricted, not company-scoped, review
--      surface). No INSERT policy for any authenticated role at all — only
--      the AI service's own credential (a Route Handler using the
--      service-role client, which bypasses RLS entirely) ever writes here,
--      and even that credential still has zero RLS grants on any
--      operational table.
create policy ai_drafts_select on ai_drafts for select
  using (has_role_any_scope('hr_admin') or has_role_any_scope('sys_admin'));

-- HR Admin/Sys Admin authorize or reject by updating status —
-- authorized_by/authorized_at only meaningfully set alongside 'authorized'.
create policy ai_drafts_update on ai_drafts for update
  using (has_role_any_scope('hr_admin') or has_role_any_scope('sys_admin'))
  with check (has_role_any_scope('hr_admin') or has_role_any_scope('sys_admin'));

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

-- No insert/update/delete policies for audit_log for `authenticated` at all —
-- only the trigger function (running as definer, table owner) and service_role
-- write to it. Belt-and-braces: explicitly revoke direct table privileges.
revoke insert, update, delete on audit_log from authenticated, anon;

-- ---- user_roles: Sys Admin manages; everyone can read their own role rows.
create policy user_roles_select_own on user_roles for select
  using (user_id = auth.uid() or has_role('sys_admin'));

create policy user_roles_write_sysadmin on user_roles for all
  using (has_role('sys_admin'))
  with check (has_role('sys_admin'));

-- =============================================================================
-- 15. Audit trigger wiring (generic before/after capture on guarded tables)
-- =============================================================================

-- company_id is resolved so HR Admin's view can be scoped to their own
-- company, not every company's history. Not every audited table carries
-- company_id directly, so it's derived: a direct column if present, else
-- via the row's employee_id, else (approvals, which is entity-type-generic)
-- by resolving the approved entity the same way is_entity_owner() does.
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

-- Ledgers and approvals are append-only at the table-grant level too.
revoke update, delete on leave_ledger from authenticated, anon;
revoke update, delete on comp_day_ledger from authenticated, anon;
revoke update, delete on approvals from authenticated, anon;

-- =============================================================================
-- 16. Storage buckets — private, path-based RLS via storage.objects policies
--     using the same helper functions as every table policy above. Path
--     convention throughout: `{company_id}/{employee_id}/{sub_path}`. See
--     §2.9 for the full bucket table (receipts, letters, assets — added by
--     their own phases, following this exact pattern).
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('employee-documents', 'employee-documents', false),
  ('identity-documents', 'identity-documents', false),
  ('receipts', 'receipts', false),
  ('letters', 'letters', false)
on conflict (id) do nothing;

-- employee-documents: owner reads their own files, HR Admin reads/writes
-- everything in their company. Sys Admin has no content access.
create policy employee_documents_select on storage.objects for select
  using (
    bucket_id = 'employee-documents'
    and (
      (storage.foldername(name))[2]::uuid = current_employee_id()
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
    )
  );

create policy employee_documents_write on storage.objects for insert
  with check (bucket_id = 'employee-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy employee_documents_update on storage.objects for update
  using (bucket_id = 'employee-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy employee_documents_delete on storage.objects for delete
  using (bucket_id = 'employee-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

-- identity-documents: same shape, HR Admin only for writes, owner + HR Admin
-- for reads — never a manager, Finance, or Sys Admin.
create policy identity_documents_select on storage.objects for select
  using (
    bucket_id = 'identity-documents'
    and (
      (storage.foldername(name))[2]::uuid = current_employee_id()
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
    )
  );

create policy identity_documents_write on storage.objects for insert
  with check (bucket_id = 'identity-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy identity_documents_update on storage.objects for update
  using (bucket_id = 'identity-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy identity_documents_delete on storage.objects for delete
  using (bucket_id = 'identity-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

-- receipts: owner (while their claim is a draft) + HR Admin + Finance read;
-- manager and CEO deliberately do NOT get file access, same least-privilege
-- pattern as identity-documents (docs/03-permission-matrix.md §3.3).
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

-- letters: same path convention as every other bucket, stored as a real
-- PDF (see lib/pdf/letter-document.tsx) in the same
-- {company_id}/{employee_id}/{sub_path} shape.
create policy letters_select on storage.objects for select
  using (
    bucket_id = 'letters'
    and (
      (storage.foldername(name))[2]::uuid = current_employee_id()
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
    )
  );

-- CEO gets its own policy (mirroring generated_letters_select's read
-- access) rather than folding into letters_select above, since a CEO
-- deciding a letter's approval needs to read the file itself, not just
-- its row.
create policy letters_select_ceo on storage.objects for select
  using (bucket_id = 'letters' and has_role('ceo', (storage.foldername(name))[1]::uuid));

create policy letters_write on storage.objects for insert
  with check (bucket_id = 'letters' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy letters_delete on storage.objects for delete
  using (bucket_id = 'letters' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));
