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
  'leave_rules', 'public_holidays', 'overtime_rules', 'notice_period',
  'probation_rules', 'working_week', 'end_of_service_benefit'
);

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
  -- Only one *active* row may cover a given date for a given (country, policy_type).
  exclude using gist (
    country_code with =,
    policy_type with =,
    daterange(effective_from, effective_to, '[]') with &&
  ) where (status = 'active')
);

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
  unique (policy_version_id, leave_type_code)
);

create table public_holidays (
  id            uuid primary key default gen_random_uuid(),
  country_code  text not null references countries(code),
  holiday_date  date not null,
  name          text not null,
  is_paid       boolean not null default true,
  unique (country_code, holiday_date)
);

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
  status            request_status not null default 'draft',
  submitted_at      timestamptz,
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
  source_ledger   text not null,      -- 'comp_day' | 'leave_ledger'
  priority_order  int not null,       -- lower = drawn first
  effective_from  date not null default current_date,
  unique (coalesce(company_id::text, country_code), leave_type_code, source_ledger, effective_from)
);

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
  amount         numeric(12,2) not null,
  description    text,
  project_id     uuid references projects(id),
  cost_center    text,
  receipt_file_path text,     -- storage path in `receipts`
  unique (claim_id, line_no)
);

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
  unique (employee_id, period_start, period_end)
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

-- -----------------------------------------------------------------------------
-- 7. Performance
-- -----------------------------------------------------------------------------

create table performance_cycles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  name          text not null,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'open'  -- 'open'|'closed'
);

create table goals (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  cycle_id      uuid not null references performance_cycles(id),
  title         text not null,
  description   text,
  weight_percent numeric(5,2),
  target_date   date,
  status        text not null default 'in_progress', -- 'in_progress'|'achieved'|'missed'
  self_rating   int,
  manager_rating int,
  created_at    timestamptz not null default now()
);

-- Sensitive tier 3: appraisal content — separate RLS from base employee record.
create table appraisals (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id),
  cycle_id       uuid not null references performance_cycles(id),
  appraiser_id   uuid not null references auth.users(id),
  overall_rating int,
  strengths      text,
  areas_for_improvement text,
  status         text not null default 'draft', -- 'draft'|'submitted'|'acknowledged'
  submitted_at   timestamptz,
  acknowledged_at timestamptz,
  created_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 8. Onboarding / offboarding
-- -----------------------------------------------------------------------------

create table checklist_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id),
  country_code  text references countries(code),
  kind          text not null,   -- 'onboarding' | 'offboarding'
  name          text not null,
  is_active     boolean not null default true
);

create table checklist_template_items (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references checklist_templates(id),
  step_order    int not null,
  task_name     text not null,
  assignee_role app_role not null,
  due_offset_days int not null default 0    -- days from hire_date / termination_date
);

create table employee_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id),
  template_item_id uuid not null references checklist_template_items(id),
  kind            text not null,  -- 'onboarding' | 'offboarding'
  due_date        date,
  status          text not null default 'pending', -- 'pending'|'in_progress'|'done'|'skipped'
  completed_by    uuid,
  completed_at    timestamptz
);

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

create table document_expiry_reminder_rules (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id),
  country_code  text references countries(code),
  document_type text not null,
  lead_days     int not null   -- e.g. 90, 60, 30
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
  status        text not null default 'generated', -- 'generated'|'authorized'|'sent'
  generated_by  uuid not null,
  generated_at  timestamptz not null default now(),
  authorized_by uuid,
  authorized_at timestamptz,
  file_path     text,
  unique (company_id, period_month, period_year)
);

create table payroll_export_lines (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references payroll_export_runs(id) on delete cascade,
  employee_id    uuid not null references employees(id),
  component_code text not null,  -- 'basic'|'allowance'|'overtime'|'deduction'|'reimbursement'|'leave_encashment'
  amount         numeric(14,2) not null,
  currency       text not null,
  source_reference_type text,    -- traces back to the ledger/claim/timesheet row that produced it
  source_reference_id   uuid
);

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
  before_data   jsonb,
  after_data    jsonb,
  is_ai_generated boolean not null default false,
  ai_context    jsonb,
  occurred_at   timestamptz not null default now()
);

create index idx_audit_log_record on audit_log(table_name, record_id);

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
alter table leave_requests enable row level security;
alter table leave_ledger enable row level security;
alter table comp_day_ledger enable row level security;
alter table approvals enable row level security;
alter table reimbursement_claims enable row level security;
alter table reimbursement_claim_lines enable row level security;
alter table timesheets enable row level security;
alter table timesheet_entries enable row level security;
alter table attendance_records enable row level security;
alter table goals enable row level security;
alter table appraisals enable row level security;
alter table employee_checklist_items enable row level security;
alter table employee_documents enable row level security;
alter table asset_assignments enable row level security;
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
create policy employees_select on employees for select
  using (
    deleted_at is null and (
      id = current_employee_id()
      or is_manager_of(id)
      or has_role('hr_admin', company_id)
      or has_role('finance', company_id)
      or has_role('ceo', company_id)
      or has_role('sys_admin')
    )
  );

create policy employees_write_hr on employees for insert with check (has_role('hr_admin', company_id));
create policy employees_update_hr on employees for update
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));

-- ---- compensation_details: HR Admin + Finance (full within their company), employee (read own only)
create policy compensation_select on compensation_details for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy compensation_write on compensation_details for insert
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

create policy identity_docs_write on identity_documents for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- appraisals & goals: employee, manager chain, HR Admin — never Finance
create policy appraisals_select on appraisals for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy goals_select on goals for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

-- ---- leave_requests: employee (own, CRUD while draft), manager chain (read + approve),
--      HR Admin (read/write all in company)
create policy leave_requests_select on leave_requests for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy leave_requests_insert on leave_requests for insert
  with check (employee_id = current_employee_id());

create policy leave_requests_update_own_draft on leave_requests for update
  using (employee_id = current_employee_id() and status in ('draft','submitted'))
  with check (employee_id = current_employee_id());

-- ---- leave_ledger / comp_day_ledger: read-only for everyone except server-side domain
--      code (service role, used only inside trusted Server Actions/Edge Functions);
--      no direct client INSERT/UPDATE/DELETE policy exists, so only service_role
--      (bypasses RLS) can write — enforced by omission, not a permissive policy.
create policy leave_ledger_select on leave_ledger for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy comp_ledger_select on comp_day_ledger for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

-- ---- approvals: visible to the requester, the approver themselves, HR Admin;
--      INSERT restricted to the assigned approver_id, decision can only move
--      pending -> approved/rejected (never edited afterwards — see trigger below).
create policy approvals_select on approvals for select
  using (
    approver_id = auth.uid()
    or has_role('hr_admin')
    or exists (
      select 1 from leave_requests lr
      where lr.id = entity_id and entity_type = 'leave_request' and lr.employee_id = current_employee_id()
    )
  );

create policy approvals_decide on approvals for update
  using (approver_id = auth.uid() and decision = 'pending')
  with check (approver_id = auth.uid());

-- ---- reimbursement_claims & lines: employee (own), manager chain (read+approve), Finance (read/write), HR Admin (read)
create policy reimbursement_select on reimbursement_claims for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('finance', (select company_id from employees where id = employee_id))
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy reimbursement_insert on reimbursement_claims for insert
  with check (employee_id = current_employee_id());

create policy reimbursement_lines_select on reimbursement_claim_lines for select
  using (exists (
    select 1 from reimbursement_claims c
    where c.id = claim_id and (
      c.employee_id = current_employee_id()
      or is_manager_of(c.employee_id)
      or has_role('finance', (select company_id from employees where id = c.employee_id))
      or has_role('hr_admin', (select company_id from employees where id = c.employee_id))
    )
  ));

-- ---- timesheets / attendance: employee (own), manager chain (read+approve), HR Admin (read)
create policy timesheets_select on timesheets for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy attendance_select on attendance_records for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

-- ---- employee_documents: employee (own), HR Admin (all in company)
create policy employee_documents_select on employee_documents for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

-- ---- generated_letters: employee (own), HR Admin
create policy generated_letters_select on generated_letters for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

-- ---- payroll_export_runs/lines: Finance (full), HR Admin (read), CEO (read), never line managers/employees
create policy payroll_runs_select on payroll_export_runs for select
  using (
    has_role('finance', company_id) or has_role('hr_admin', company_id) or has_role('ceo', company_id)
  );

create policy payroll_runs_write on payroll_export_runs for insert
  with check (has_role('finance', company_id));

create policy payroll_lines_select on payroll_export_lines for select
  using (exists (
    select 1 from payroll_export_runs r where r.id = run_id and (
      has_role('finance', r.company_id) or has_role('hr_admin', r.company_id) or has_role('ceo', r.company_id)
    )
  ));

-- ---- ai_drafts: readable by whoever is entitled to see the underlying entity type;
--      writable ONLY by the ai_agent role via service key inside a trusted Edge
--      Function (no INSERT policy for regular authenticated users at all — the
--      absence of an insert policy is deliberate: browser sessions cannot create
--      ai_drafts even for themselves).
create policy ai_drafts_select on ai_drafts for select
  using (has_role('hr_admin') or has_role('sys_admin'));

create policy ai_drafts_authorize on ai_drafts for update
  using (status = 'draft' and (has_role('hr_admin') or has_role('sys_admin')))
  with check (authorized_by = auth.uid());

-- ---- audit_log: read-only, HR Admin + Sys Admin (Sys Admin sees actor/action
--      metadata for system operations, not necessarily HR content — enforce
--      redaction of before/after payloads for HR tables at the view layer if
--      Sys Admin should not see field-level content).
create policy audit_log_select on audit_log for select
  using (has_role('hr_admin') or has_role('sys_admin'));

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

create or replace function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role app_role;
begin
  select role into v_actor_role from user_roles
  where user_id = auth.uid() and revoked_at is null order by granted_at desc limit 1;

  insert into audit_log(table_name, record_id, action, actor_id, actor_role, before_data, after_data)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    lower(TG_OP),
    auth.uid(),
    v_actor_role,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('UPDATE','INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

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

-- Ledgers and approvals are append-only at the table-grant level too.
revoke update, delete on leave_ledger from authenticated, anon;
revoke update, delete on comp_day_ledger from authenticated, anon;
revoke delete on approvals from authenticated, anon;
