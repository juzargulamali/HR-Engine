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
  'employee', 'line_manager', 'hr_admin', 'finance', 'ceo', 'cto', 'sys_admin'
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

-- 'cancelled' is distinct from 'skipped': skipped means a step was never
-- exercised because workflow routing bypassed it (a threshold condition,
-- self-approval); cancelled means the underlying request was withdrawn by
-- its own requester while a real decision was still outstanding.
create type approval_decision as enum ('pending', 'approved', 'rejected', 'skipped', 'cancelled');

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
  -- Poland Annual Leave's 10-year service threshold counts recognised
  -- prior service/education toward tenure, which this system has no way
  -- to compute — it is an explicit, HR-controlled input. Null (the
  -- default for every existing employee) means "no recognised prior
  -- service", identical to today's behavior.
  recognised_prior_service_years numeric(4,2)
    check (recognised_prior_service_years is null or recognised_prior_service_years >= 0)
);

create index idx_employees_manager on employees(manager_id) where deleted_at is null;
create index idx_employees_company on employees(company_id) where deleted_at is null;
-- Partial, not a plain (company_id, employee_number) unique constraint: a
-- soft-deleted employee's number should never permanently block reissuing
-- it to a new hire — only the currently-live employees in a company need
-- to have distinct numbers.
create unique index employees_company_employee_number_unique
  on employees(company_id, employee_number) where deleted_at is null;
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
  created_by           uuid not null,
  -- Poland Annual Leave entitlement must be prorated for part-time
  -- contracts. Every existing row defaults to 1.0 (full-time), so nothing
  -- existing changes meaning.
  fte_fraction         numeric(4,3) not null default 1.0
    check (fte_fraction > 0 and fte_fraction <= 1)
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

-- A permanent, HR-authored history log of promotions, title changes, and
-- salary changes — recordCareerEvent() is the one place that writes here,
-- and it also applies the change itself (updates employees.job_title
-- and/or inserts a new compensation_details version), so this table is
-- purely an audit trail, never the source of truth for the current
-- title/salary. Same visibility tier as compensation_details (self, HR
-- Admin, Finance) since it carries salary figures — a manager gets a
-- separate, amount-redacted view via get_career_summary_for_appraisal()
-- below, for exactly the appraisal-context use case this was built for.
-- Append-only: no update/delete policy, matching leave_ledger's own
-- philosophy for a history log that should never be silently rewritten.
create table employee_career_events (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references employees(id),
  event_type            text not null check (event_type in ('promotion', 'title_change', 'salary_change')),
  effective_date        date not null,
  previous_job_title    text,
  new_job_title         text,
  previous_base_salary  numeric(14,2),
  new_base_salary       numeric(14,2),
  previous_allowances   jsonb,
  new_allowances        jsonb,
  currency              text,
  note                  text,
  created_at            timestamptz not null default now(),
  created_by            uuid not null
);

create index idx_career_events_employee on employee_career_events(employee_id, effective_date desc);

-- Outstanding loans / cash advances an employee has taken from the company —
-- same visibility tier as compensation_details (self, HR Admin, Finance;
-- deliberately no manager/CEO/CTO read access), since it's the kind of
-- financial record an end-of-service settlement needs to net against final
-- pay. Add/delete only (no update, no UI for it, and none requested) — HR
-- or Finance corrects a mistaken entry by deleting and re-adding it, same
-- as identity_documents' own add/delete-only lifecycle in the UI.
create table employee_loans (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  loan_type     text not null check (loan_type in ('loan', 'cash_advance')),
  amount        numeric(12,2) not null check (amount > 0),
  currency      text not null,
  issued_date   date not null,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid not null
);

create index idx_employee_loans_employee on employee_loans(employee_id);

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

-- Health/medical insurance coverage — same visibility tier as
-- identity_documents (self, HR Admin only; never manager/Finance/CEO/CTO),
-- and the same add/delete-only lifecycle (correcting an entry means
-- deleting and re-adding it, not editing in place).
create table employee_insurance_policies (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id),
  insurance_name  text not null,     -- provider/plan name
  policy_number   text not null,
  expiry_date     date,
  file_path       text,              -- storage path in `insurance-documents`
  created_at      timestamptz not null default now(),
  created_by      uuid not null
);

create index idx_insurance_policies_employee on employee_insurance_policies(employee_id);

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
  check (end_date >= start_date),
  -- decide_leave_approval()'s deduction loop starts with
  -- v_remaining := total_days and exits immediately once v_remaining <= 0,
  -- so a zero/negative value (nothing stops one via a raw insert bypassing
  -- the app's own computeLeaveDays() check) approves with no ledger entry
  -- posted at all -- unaccounted, unlimited "free" leave. total_days is
  -- always server-computed at submission (never client-editable after), so
  -- this only rejects the exploit path, not any legitimate value.
  check (total_days > 0),
  -- Same backstop role as the total_days check above, for a different
  -- loophole: submitLeaveRequest() already checks for an overlapping
  -- request before inserting, but that check-then-insert has the same
  -- TOCTOU shape as bulkRecordAttendance()'s comp-day race, and a raw
  -- insert bypassing the app layer entirely skips it altogether. One
  -- employee may not hold two overlapping requests that are still live
  -- (not yet rejected/cancelled) — cancelled/rejected requests are
  -- deliberately excluded so a withdrawn request never blocks a new one
  -- for the same dates.
  exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('submitted', 'pending_approval', 'approved'))
);

create index idx_leave_requests_employee on leave_requests(employee_id);

-- Backstop for the same loophole as leave/new/page.tsx's leave-type
-- allowlist: the app no longer offers a free-text leave type field, but a
-- raw insert bypassing it entirely could still write any string. Requires
-- an active leave_rules policy for the employee's country that actually
-- defines this leave_type_code, resolved as of the request's OWN
-- start_date rather than current_date — same rule submitLeaveRequest() and
-- the leave/new page's leave-type dropdown apply, so a request starting
-- after a newer policy takes effect is checked against that policy here
-- too, not whichever one happens to be active on the day it's submitted.
-- The "no covering policy" case submitLeaveRequest() blocks with a
-- friendly message surfaces here as a generic exception for anything that
-- reaches this trigger without going through the app layer first.
-- SECURITY DEFINER: the app inserts leave_requests for the requester
-- themselves, but this check must resolve the SAME way regardless of who's
-- inserting or which other rows they can see — a plain employee's own
-- employees_select policy doesn't even cover an unrelated peer's row, and
-- this check has nothing to do with row ownership anyway (only whether an
-- active policy defines this leave type for this employee's country), so
-- it must not be gated by the inserting user's own RLS visibility.
create or replace function guard_leave_request_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid boolean;
begin
  select exists (
    select 1
    from policy_leave_types plt
    join policy_versions pv on pv.id = plt.policy_version_id
    join employees e on e.country_code = pv.country_code
    where e.id = new.employee_id
      and pv.policy_type = 'leave_rules'
      and pv.status = 'active'
      and new.start_date between pv.effective_from and coalesce(pv.effective_to, 'infinity'::date)
      and plt.leave_type_code = new.leave_type_code
  ) into v_valid;

  if not v_valid then
    raise exception 'No active leave policy for this employee''s country defines leave type "%" — HR must activate a leave policy with this leave type first', new.leave_type_code;
  end if;

  return new;
end;
$$;

create trigger leave_requests_guard_type before insert on leave_requests
  for each row execute function guard_leave_request_type();

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
  created_at        timestamptz not null default now(),
  -- Set only by the leave-accrual cron ('accrual:{employee}:{leave_type}:{YYYY-MM}')
  -- so a concurrent/retried invocation can't double-post the same
  -- employee/leave-type/month accrual — the app-level "already accrued
  -- this month?" check alone can't prevent two overlapping requests from
  -- both passing it before either has inserted. Null (and therefore
  -- unconstrained) for every other kind of entry.
  idempotency_key   text unique
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
  created_at      timestamptz not null default now(),
  -- Set only by the comp-day-expiry cron ('expiry:{earned_entry_id}') — an
  -- earned entry is fully expired in one shot (computeCompDayExpiry posts
  -- its whole remaining balance at once), so at most one 'expired' row may
  -- ever reference a given earned entry. Without this, two overlapping
  -- runs that both read the ledger before either had posted would both
  -- compute the same "remaining" amount and double-expire it. Null (and
  -- therefore unconstrained) for every other kind of entry.
  idempotency_key text unique
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
  created_at      timestamptz not null default now(),
  -- Each step of an entity's approval chain is only ever meant to exist
  -- once. Without this, reimbursement_claims/timesheets/payroll_export_runs
  -- (which submit against an EXISTING row, unlike leave_requests which
  -- insert a fresh one each time) can get a second step-1 approval from a
  -- double-clicked "Submit for approval" racing create_initial_approval()
  -- twice — and deciding that stale duplicate later can re-walk the whole
  -- workflow and regress an already-finalized entity (e.g. an approved
  -- payroll run) back to pending.
  unique (entity_type, entity_id, step_order)
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

-- The comment above only holds if the client never writes total_amount
-- directly on the claim row itself -- reimbursement_insert/
-- reimbursement_update_draft's WITH CHECK constrains employee_id and
-- status, never this column, so nothing stopped an employee inflating
-- their own claim's total_amount (which flows straight into
-- generate_payroll_export_lines()'s payroll export) or deflating it to
-- dodge an amount-gated approval step. Forcing a recompute on every
-- insert/update of the claim row itself, in addition to the lines
-- trigger, closes that regardless of what the client sends.
create or replace function guard_reimbursement_claim_total()
returns trigger
language plpgsql
as $$
begin
  new.total_amount := coalesce((select sum(amount) from reimbursement_claim_lines where claim_id = new.id), 0);
  return new;
end;
$$;

create trigger reimbursement_claims_guard_total before insert or update on reimbursement_claims
  for each row execute function guard_reimbursement_claim_total();

create table attendance_records (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  work_date     date not null,
  clock_in      timestamptz,
  clock_out     timestamptz,
  hours_worked  numeric(5,2),
  -- Status is what the employee actually did that day; work_mode (below) is
  -- WHERE they did it — two independent facts that used to be conflated
  -- into one field (a "holiday"/"weekend" status described the CALENDAR,
  -- not the employee, and a manager working from a client site on an
  -- ordinary Tuesday had no way to record that at all). Never trust a
  -- browser-supplied default for this: a day with no saved row is
  -- genuinely unknown, not "present" — 'not_recorded' is the real default,
  -- enforced here, not just in the UI.
  status        text not null default 'not_recorded'
                  check (status in ('not_recorded', 'present', 'absent', 'leave', 'partial_day')),
  work_mode     text
                  check (work_mode in ('office', 'client_site', 'work_from_home', 'field_work', 'business_travel')),
  source        text not null default 'manual',   -- 'manual'|'biometric'|'import'
  -- Recovery Leave's exceptional-overnight-extension rule needs verified
  -- working-time facts, never a browser-supplied flag — but clock_in/
  -- clock_out above are never populated or read anywhere in this codebase,
  -- so trusting them would mean trusting invented values. These two
  -- columns are the smallest safe addition: HR/manager-attested facts,
  -- same trust model as status/hours_worked above.
  completed_normal_scheduled_day boolean,
  active_hours_after_midnight    numeric(4,2)
    check (active_hours_after_midnight is null or active_hours_after_midnight >= 0),
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

-- goals_write_self and goals_write_manager (RLS, section 14) both apply to
-- an UPDATE on this table, and Postgres OR-combines every applicable
-- permissive policy's WITH CHECK independently of USING — so a manager
-- targeting a report's goal (passing goals_write_manager's USING against
-- the OLD row) could set employee_id to their OWN employee id in the same
-- UPDATE, and goals_write_self's WITH CHECK (employee_id =
-- current_employee_id()) would then pass trivially against the NEW row,
-- silently hijacking a subordinate's goal. employee_id has no legitimate
-- reason to ever change after creation, so this blocks it outright for
-- every caller, closing that OR-combination gap without having to touch
-- either policy.
create or replace function guard_goal_employee_immutable()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- trusted backend/migration/seed context
  end if;
  if new.employee_id is distinct from old.employee_id then
    raise exception 'A goal cannot be reassigned to a different employee';
  end if;
  return new;
end;
$$;

create trigger goals_guard_employee_immutable
  before update on goals
  for each row execute function guard_goal_employee_immutable();

-- Sensitive tier 3: appraisal content — separate RLS from base employee
-- record and from goals; Finance never gets a select policy on this table
-- at all (docs/03-permission-matrix.md §3.7).
create table appraisals (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id),
  cycle_id       uuid not null references performance_cycles(id),
  appraiser_id   uuid not null references auth.users(id),
  -- overall_rating is fully derived (see compute_appraisal_overall_rating()
  -- below) — the rounded average of whichever of the five competency
  -- ratings are filled in. It stays a real, readable column (existing
  -- pages select it directly) but is never independently settable: the
  -- before-insert-or-update trigger recomputes and overwrites it on every
  -- write, even one that also tries to set it explicitly in the same
  -- statement.
  overall_rating int check (overall_rating between 1 and 5),
  quality_of_work_rating int check (quality_of_work_rating between 1 and 5),
  productivity_rating     int check (productivity_rating between 1 and 5),
  initiative_rating       int check (initiative_rating between 1 and 5),
  teamwork_rating         int check (teamwork_rating between 1 and 5),
  punctuality_rating      int check (punctuality_rating between 1 and 5),
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
    -- Checked directly rather than relying on overall_rating alone: since
    -- overall_rating is now a rounded average (compute_appraisal_overall_rating,
    -- which fires first), two different sets of competency scores can round
    -- to the same overall_rating — comparing only the derived value would
    -- let an employee tamper with an individual competency score as long as
    -- the rounded average happened to land unchanged.
    if new.overall_rating is distinct from old.overall_rating
      or new.quality_of_work_rating is distinct from old.quality_of_work_rating
      or new.productivity_rating is distinct from old.productivity_rating
      or new.initiative_rating is distinct from old.initiative_rating
      or new.teamwork_rating is distinct from old.teamwork_rating
      or new.punctuality_rating is distinct from old.punctuality_rating
      or new.strengths is distinct from old.strengths
      or new.areas_for_improvement is distinct from old.areas_for_improvement
      or new.cycle_id is distinct from old.cycle_id
      or new.appraiser_id is distinct from old.appraiser_id
      or new.submitted_at is distinct from old.submitted_at
    then
      raise exception 'An employee may only acknowledge their appraisal, not edit its content';
    end if;
  end if;

  -- appraisals_update_appraiser (RLS) lets the appraiser edit their own
  -- draft freely but places no constraint on employee_id at all — without
  -- this, any manager who has ever legitimately created one appraisal for
  -- a real report could retarget that draft onto an arbitrary employee
  -- (even in a different company) by changing employee_id in the same
  -- UPDATE, since neither appraisals_insert's is_manager_of() check nor
  -- any other policy re-runs on UPDATE.
  if auth.uid() = old.appraiser_id and new.employee_id is distinct from old.employee_id then
    raise exception 'An appraisal cannot be reassigned to a different employee';
  end if;

  return new;
end;
$$;

create trigger appraisals_guard_self_update
  before update on appraisals
  for each row execute function guard_appraisal_acknowledge();

-- overall_rating is derived, never independently settable: recompute it as
-- the rounded average of whichever of the five competency ratings are
-- non-null (all-null -> null), overwriting whatever the statement itself
-- tried to put in overall_rating. Runs before guard_appraisal_acknowledge's
-- comparison of new.overall_rating to old.overall_rating on insert since
-- insert has no "old" row to guard; on update both triggers fire in name
-- order ("appraisals_compute_overall" before "appraisals_guard_self_update"),
-- so the acknowledge-guard still correctly sees the freshly-recomputed value.
create or replace function compute_appraisal_overall_rating()
returns trigger
language plpgsql
as $$
begin
  new.overall_rating := round((
    select avg(v) from (values
      (new.quality_of_work_rating),
      (new.productivity_rating),
      (new.initiative_rating),
      (new.teamwork_rating),
      (new.punctuality_rating)
    ) as t(v)
    where v is not null
  ));
  return new;
end;
$$;

create trigger appraisals_compute_overall
  before insert or update on appraisals
  for each row execute function compute_appraisal_overall_rating();

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

-- Sign convention: basic_salary/other_allowance/reimbursement/
-- leave_encashment/bonus lines are positive; deduction lines are stored
-- NEGATIVE (payroll_export_lines_component_sign_check enforces this). Net
-- pay per employee for a run is simply sum(amount) over their lines — no
-- special-casing needed anywhere downstream because of it.
create table payroll_export_lines (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references payroll_export_runs(id) on delete cascade,
  employee_id    uuid not null references employees(id),
  component_code text not null check (component_code in ('basic_salary', 'other_allowance', 'reimbursement', 'leave_encashment', 'deduction', 'bonus')),
  amount         numeric(14,2) not null check ((component_code = 'deduction' and amount < 0) or (component_code <> 'deduction' and amount > 0)),
  currency       text not null,
  -- 'reimbursement_claim' | 'leave_ledger' when this line traces back to a
  -- real source row; null (with source_reference_id also null) for a
  -- generated salary line or a manual line — nothing to trace back to.
  source_reference_type text,
  source_reference_id   uuid,
  -- Free-text description. Required (by the addManualPayrollLine Server
  -- Action, not a DB constraint) for a manual line ("fine for X", "Q1
  -- bonus"); left null for an auto-generated line, whose component_code is
  -- already self-explanatory.
  label          text,
  -- true for anything Finance typed in by hand, OR an auto-generated line
  -- whose amount Finance has directly edited. generate_payroll_export_lines()
  -- never deletes or touches a row with is_manual = true.
  is_manual      boolean not null default false,
  -- Who created/last-edited this line. Sentinel default is only a backfill
  -- safety net for adding this column to a table that may already have
  -- rows in some deployment — every real INSERT (generate_payroll_export_lines()
  -- or the manual-line Server Actions) sets this explicitly.
  created_by     uuid not null default '00000000-0000-0000-0000-000000000000'
);

create index idx_payroll_export_lines_run on payroll_export_lines(run_id);

-- Backs generate_payroll_export_lines()'s own "not exists" check with a real
-- constraint: that check alone only rules out a source row already being
-- exported by the time a query's snapshot was taken, not two overlapping
-- calls (e.g. two draft runs for different periods racing on the same
-- company's approved reimbursement claims, or a double-clicked "re-check
-- for new lines") each seeing "not yet exported" and both inserting a line
-- for it. The unique index plus that function's own on-conflict-do-nothing
-- makes the second racer a no-op instead of a duplicate export line.
-- Partial: only reimbursement/leave-encashment lines carry a real
-- source_reference_id — salary and manual lines have none to dedup on.
create unique index payroll_export_lines_source_uniq on payroll_export_lines(source_reference_type, source_reference_id)
  where source_reference_id is not null;

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
  actor_role    app_role,   -- kept for backward compatibility: the same "most recently granted" role write_audit_log() always resolved here
  actor_roles   app_role[], -- every role the actor held (unrevoked) at the moment of the action — a multi-role user must never be flattened to just one
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

-- Records one day's attendance for a batch of employees and, where earned,
-- credits (or reverses) the recovery/comp-day it produces — all as one
-- atomic transaction per call, so a save can never leave the attendance row
-- written but the ledger untouched (or vice versa). Recovery-day
-- eligibility (weekend/public holiday) is re-derived here from
-- countries.week_start_day and public_holidays, exactly the same
-- isWeekend() rule packages/domain uses — the caller may not assert it,
-- unlike the bulkRecordAttendance() this replaces, which trusted a
-- browser-computed isRecoveryEligible boolean outright.
--
-- p_rows is a jsonb array of {employee_id, status, work_mode, hours_worked}
-- objects — a single round trip for the whole daily register, same shape
-- the app already saves in one page.
--
-- Correcting a day away from 'present' (or a day that's no longer flagged
-- as a recovery day) never deletes an already-earned comp_day_ledger
-- entry — it posts a linked reversal row (reversal_of_id), same
-- append-and-classify approach the leave ledgers use, so both the original
-- credit and who reversed it stay on the record.
--
-- The output column is attendance_employee_id, not employee_id — every
-- table this function touches (employees, attendance_records,
-- comp_day_ledger) has a real column literally named employee_id, and
-- PL/pgSQL raises "ambiguous column reference" if an OUT parameter shares
-- a name with a column referenced anywhere in the function body (it bit
-- the ON CONFLICT target list here specifically).
--
-- needs_policy_review is true whenever a day would otherwise have earned a
-- credit (recovery day + present) but no active overtime_rules policy
-- defines a valid recovery_credit_days for this country, or the value
-- configured isn't exactly 0, 0.5, or 1 — the credit is 0 in that case,
-- never silently 1. This is a real gap in HR configuration, not a
-- non-event, so the caller surfaces it rather than swallowing it.
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
  v_holiday_name text;
  v_is_recovery_day boolean;
  v_record_id uuid;
  v_was_credited comp_day_ledger%rowtype;
  v_credit_days numeric;
  v_expiry_months int;
  v_expiry_date date;
  v_overtime_policy jsonb;
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

    -- Same advisory lock decide_leave_approval() takes before touching an
    -- employee's comp-day balance, for the same reason: without it, two
    -- concurrent saves for this employee (a double-clicked Save, or two
    -- admins editing the same date) could both read "not yet credited"
    -- before either has committed its insert, and both credit it.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_employee_id::text));

    select week_start_day into v_week_start_day from countries where code = v_country_code;
    select name into v_holiday_name from public_holidays where country_code = v_country_code and holiday_date = p_work_date;
    v_is_recovery_day := v_holiday_name is not null
      or ((extract(dow from p_work_date)::int - coalesce(v_week_start_day, 1) + 7) % 7) >= 5;

    -- One atomic upsert rather than a check-then-branch — the latter has
    -- the same TOCTOU shape as the race bulkRecordAttendance()'s old
    -- "already credited?" check had (two concurrent saves for the same
    -- employee/date, e.g. a double-clicked Save, could otherwise both see
    -- "no existing row" and both attempt an insert).
    insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
    values (v_employee_id, p_work_date, v_status, v_work_mode, v_hours, 'manual')
    on conflict (employee_id, work_date) do update
    set status = excluded.status, work_mode = excluded.work_mode, hours_worked = excluded.hours_worked
    returning id into v_record_id;

    -- The CURRENTLY ACTIVE credit for this record, if any — an 'earned' row
    -- that hasn't itself already been reversed. Without the "not reversed"
    -- exclusion, correcting a day away from present (posting a reversal)
    -- and then correcting it back to present later would see the original
    -- (now-reversed) earned row and wrongly treat it as still active,
    -- permanently blocking that day from ever earning a fresh credit again.
    select cl.* into v_was_credited from comp_day_ledger cl
    where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);

    if v_is_recovery_day and v_status = 'present' then
      if v_was_credited.id is null then
        select resolve_policy(v_country_code, 'overtime_rules', p_work_date) into v_overtime_policy;
        -- recovery_credit_days must be exactly 0, 0.5, or 1 — HR-configurable
        -- per country via the overtime_rules policy payload, same
        -- field-within-payload convention comp_day_expiry_months already
        -- established. No active policy, a missing field, or any other
        -- value is treated as unconfigured: 0 days credited, never a
        -- silent default to 1 — this is a gap in HR setup that needs
        -- review, not a free day.
        if v_overtime_policy is null or not (v_overtime_policy ? 'recovery_credit_days') then
          v_credit_days := 0;
          v_needs_review := true;
        else
          v_credit_days := (v_overtime_policy ->> 'recovery_credit_days')::numeric;
          if v_credit_days is distinct from 0 and v_credit_days is distinct from 0.5 and v_credit_days is distinct from 1 then
            v_credit_days := 0;
            v_needs_review := true;
          end if;
        end if;

        if v_credit_days > 0 then
          v_expiry_months := nullif(v_overtime_policy ->> 'comp_day_expiry_months', '')::int;
          v_expiry_date := case when v_expiry_months is not null then (p_work_date + (v_expiry_months || ' months')::interval)::date else null end;
          insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
          values (v_employee_id, p_work_date, 'earned', v_credit_days, 'holiday_worked', v_expiry_date, 'attendance_record', v_record_id, auth.uid());
          v_credited := true;
        end if;
      end if;
    elsif v_was_credited.id is not null then
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
      values (v_was_credited.employee_id, p_work_date, 'reversal', -v_was_credited.days, 'holiday_worked', 'attendance_record', v_record_id, v_was_credited.id, auth.uid());
      v_reversed := true;
    end if;

    attendance_employee_id := v_employee_id;
    credited := v_credited;
    reversed := v_reversed;
    needs_policy_review := v_needs_review;
    return next;
  end loop;
end;
$$;

-- Backstop for the same class of loophole guard_leave_request_type()
-- closes for leave requests: record_attendance_and_recovery()'s own
-- "already credited?" check (backed by the advisory lock above) is the
-- sanctioned path, but a raw insert bypassing it entirely could still post
-- a second active 'earned' credit for the same attendance record. This
-- trigger makes that a real database invariant: after any 'earned' insert,
-- at most one *unreversed* 'earned' row may reference a given
-- attendance_record. A plain partial unique index can't express "not yet
-- reversed" (that depends on whether another row's reversal_of_id points
-- at this one, not on this row's own columns), so this is a trigger
-- rather than an index — and it must allow a later, genuine
-- earn-reverse-earn-again cycle to keep working, which a naive
-- unique-on-reference_id index (the one this replaces) did not.
create or replace function guard_comp_day_ledger_single_active_credit()
returns trigger
language plpgsql
as $$
declare
  v_active_count int;
begin
  if new.reference_type = 'attendance_record' and new.entry_type = 'earned' then
    select count(*) into v_active_count
    from comp_day_ledger cl
    where cl.reference_type = 'attendance_record' and cl.reference_id = new.reference_id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
    if v_active_count > 1 then
      raise exception 'An active (unreversed) earned comp-day credit already exists for attendance record %', new.reference_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger comp_day_ledger_single_active_credit after insert on comp_day_ledger
  for each row execute function guard_comp_day_ledger_single_active_credit();

-- Deletes one attendance record — the correction path for a mistaken
-- manual entry, distinct from record_attendance_and_recovery()'s upsert
-- (which corrects a day by changing its status, not removing the row).
-- A bare `delete from attendance_records` used to leave any active
-- comp_day_ledger 'earned' credit for that record orphaned forever,
-- referencing a row that no longer exists — this reverses it first, in
-- the same transaction, via the same linked-reversal pattern
-- record_attendance_and_recovery() already uses, so deleting a day can
-- never leave an active recovery credit with nothing behind it.
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

  delete from attendance_records where id = p_record_id;
end;
$$;

-- Phase 2b: Recovery Leave's exceptional-overnight-extension credit. Mirrors
-- packages/domain/src/recoveryCredit.ts's computeOvernightRecoveryCredit
-- exactly (0.5 day up to and including 4 active hours after midnight, 1 day
-- beyond that; nothing unless the normal scheduled day was completed AND
-- work genuinely continued past midnight). Posts into the SAME comp_day_ledger
-- row record_attendance_and_recovery() uses, so
-- guard_comp_day_ledger_single_active_credit already prevents a day from
-- ever earning both a standard and an overnight credit.
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

  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  select id into v_record_id from attendance_records where employee_id = p_employee_id and work_date = p_work_date;
  if v_record_id is null then
    raise exception 'Record ordinary attendance for % on % first', p_employee_id, p_work_date;
  end if;

  update attendance_records
  set completed_normal_scheduled_day = p_completed_normal_scheduled_day,
      active_hours_after_midnight = p_active_hours_after_midnight
  where id = v_record_id;

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
  v_expiry_date := p_work_date + interval '180 days';

  insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
  values (p_employee_id, p_work_date, 'earned', v_credit_days, 'overnight_extension', v_expiry_date, 'attendance_record', v_record_id, auth.uid());

  credited := true;
  credit_days := v_credit_days;
  return next;
end;
$$;

-- Phase 2b: Recovery Leave forfeiture on termination — no cash conversion,
-- an auditable 'reversal' row (source = 'termination_forfeiture') rather
-- than a silent delete. Idempotent: does nothing if there's no positive
-- balance left, so a retried or double-triggered call never double-forfeits
-- or drives the balance negative.
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
  v_requester_user_id uuid;
  v_grandmanager_id uuid;
  v_result uuid;
begin
  select company_id, manager_id, user_id into v_company_id, v_manager_id, v_requester_user_id
  from employees where id = p_employee_id;

  -- employment_status <> 'terminated' (not e.g. 'active' only) — a
  -- terminated employee should never remain resolvable as an approver of
  -- record indefinitely (nothing else in the schema cascades a
  -- termination into reassigning their reports or revoking their roles),
  -- but someone merely on_leave/suspended is still a legitimate approver.
  if p_approver_type = 'direct_manager' then
    if v_manager_id is null then
      -- Top of the org chart — exactly the CEO/CTO's own situation, since
      -- nothing ever assigns them a manager_id. Returning null here used to
      -- mean create_initial_approval()/decide_leave_approval() both treat
      -- this as "no approver could be resolved" and hard-block the
      -- submission outright. There is no manager requirement for a
      -- C-level exec ("there is no need of manager for them, approval
      -- wise, anyone can approve as C-Level executives"), so fall back to
      -- any OTHER active ceo/cto holder in the same company instead of
      -- leaving them permanently unable to submit their own leave/
      -- reimbursement/etc. The self-approval check in
      -- create_initial_approval()/decide_leave_approval() still applies
      -- normally if this ever resolved back to the requester themselves.
      select ur.user_id into v_result
      from user_roles ur
      where ur.role in ('ceo', 'cto')
        and ur.revoked_at is null
        and (ur.company_id is null or ur.company_id = v_company_id)
        and ur.user_id <> v_requester_user_id
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
      order by ur.granted_at asc
      limit 1;
    else
      select user_id into v_result from employees
      where id = v_manager_id and employment_status <> 'terminated' and deleted_at is null;
    end if;
  elsif p_approver_type = 'manager_of_manager' then
    select manager_id into v_grandmanager_id from employees where id = v_manager_id;
    if v_manager_id is null or v_grandmanager_id is null then
      -- Same top-of-org-chart dead end as direct_manager above: either this
      -- employee has no manager at all, or their manager has no manager of
      -- their own (e.g. reports straight to the CEO/CTO) — either way
      -- there's no "manager of manager" to resolve, so fall back to any
      -- other active ceo/cto holder for the same reason given above.
      select ur.user_id into v_result
      from user_roles ur
      where ur.role in ('ceo', 'cto')
        and ur.revoked_at is null
        and (ur.company_id is null or ur.company_id = v_company_id)
        and ur.user_id <> v_requester_user_id
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
      order by ur.granted_at asc
      limit 1;
    else
      select user_id into v_result from employees
      where id = v_grandmanager_id and employment_status <> 'terminated' and deleted_at is null;
    end if;
  elsif p_approver_type like 'role:%' then
    -- 'role:ceo' is treated as "any C-level exec" — ceo and cto are equal
    -- peers for approval-routing purposes (per the CTO rollout: "anyone
    -- can approve as C-Level executives"), so a workflow step configured
    -- as role:ceo is satisfied by whichever of them is available. Every
    -- other role:% value (role:hr_admin, role:finance, ...) keeps its
    -- exact single-role match, unchanged.
    select ur.user_id into v_result
    from user_roles ur
    where (
        case when p_approver_type = 'role:ceo' then ur.role in ('ceo', 'cto')
        else ur.role = replace(p_approver_type, 'role:', '')::app_role end
      )
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = v_company_id)
      and not exists (
        select 1 from employees e2
        where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
      )
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
    -- Same role:ceo -> "any C-level exec" broadening as resolve_approver()
    -- above — see its comment for why. payroll_export_run's mandatory
    -- Finance-then-CEO sign-off is satisfied by ceo OR cto equally.
    select ur.user_id into v_result
    from user_roles ur
    where (
        case when p_approver_type = 'role:ceo' then ur.role in ('ceo', 'cto')
        else ur.role = replace(p_approver_type, 'role:', '')::app_role end
      )
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = p_company_id)
      and not exists (
        select 1 from employees e2
        where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
      )
    order by ur.granted_at asc
    limit 1;
  end if;
  return v_result;
end;
$$;

-- Lists every active user_id holding a given role for a company, for the
-- leave-notification email feature (notify all HR Admins + the CEO when a
-- leave request is submitted). user_roles' own RLS (user_roles_select_own:
-- user_id = auth.uid() or has_role('sys_admin')) blocks an ordinary
-- employee's session from seeing anyone else's role grants, so — same as
-- resolve_approver()/resolve_approver_for_company() above — this needs its
-- own SECURITY DEFINER function rather than a plain client-side select.
-- Unlike resolve_approver() (single approver, `limit 1`), notifying "all HR
-- Admins" needs every match, so this returns a set instead of one row.
create or replace function resolve_role_holders(p_role app_role, p_company_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id
  from user_roles
  where role = p_role
    and revoked_at is null
    and (company_id is null or company_id = p_company_id)
  order by granted_at asc;
$$;

-- Builds the run's full payroll table: a basic_salary line (and, when
-- present and positive, an other_allowance line) for every active
-- employee, plus approved-but-not-yet-exported reimbursements and this
-- period's leave encashments, one line per source row so reconciliation is
-- exact. "Not yet exported" means no earlier payroll_export_lines row
-- already references that exact source row — so re-running this for the
-- same run is safe, and a source row can never be paid out twice across
-- different runs either.
--
-- Idempotent re-runs ("re-check for new lines"): every previously
-- auto-generated (is_manual = false) line for this run is deleted and
-- rebuilt fresh, so the run always reflects current salary/reimbursement/
-- encashment data. A line Finance added by hand, or an auto-generated line
-- Finance has directly corrected (is_manual = true either way), is never
-- touched by this function.
--
-- Runs under the caller's own RLS (Finance already has read access to the
-- source tables and insert access to payroll_export_lines) — no SECURITY
-- DEFINER needed, so auth.uid() reliably names the acting Finance user.
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
  v_old_entity_type approvable_entity;
  v_new_entity_type approvable_entity;
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old); -- trusted context: SECURITY DEFINER provisioning, migrations, admin/service-role
  end if;

  -- Checks BOTH the row's real current workflow (old, present on
  -- update/delete) and its would-be new workflow (new, present on
  -- insert/update) — checking only new.workflow_id (as this used to) let
  -- an HR Admin evade the guard entirely by re-parenting a payroll step
  -- onto a different, ordinary workflow they also manage: that UPDATE's
  -- new.workflow_id resolves to a non-payroll entity_type, so the old
  -- single-sided check passed even though the row being detached WAS a
  -- mandatory payroll step the instant before.
  if tg_op <> 'INSERT' then
    select entity_type into v_old_entity_type from approval_workflows where id = old.workflow_id;
  end if;
  if tg_op <> 'DELETE' then
    select entity_type into v_new_entity_type from approval_workflows where id = new.workflow_id;
  end if;

  if v_old_entity_type = 'payroll_export_run' or v_new_entity_type = 'payroll_export_run' then
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

-- Creates the FIRST approvals row for a just-submitted entity — the one
-- write every entity type's submit action needs to make, and the one this
-- schema used to leave to a client-side INSERT under approvals_insert_initial
-- (with check (step_order = 1 and decision = 'pending' and
-- is_entity_owner(...))). That policy never validated workflow_id or
-- approver_id at all — neither column is constrained to "the real workflow
-- for this entity_type/company" or "the real resolved step-1 approver" — so
-- any owner of an entity could insert a row with workflow_id = null (or any
-- other workflow's id, e.g. one with a single, self-resolving step) and
-- approver_id = themselves, then call decide_leave_approval() on it: with a
-- null/foreign workflow_id, the "walk every remaining step" loop
-- (`where workflow_id = v_approval.workflow_id ...`) matches nothing, so it
-- falls straight through to final approval — a full self-approval bypass on
-- every entity type, including payroll_export_run's mandatory Finance-then-
-- CEO sign-off. This function is the fix: it re-resolves the workflow and
-- step-1 approver itself (SECURITY DEFINER, the same authority
-- decide_leave_approval() already has to do this), so nothing client-
-- supplied about the approval's routing is ever trusted. The client-facing
-- INSERT policy on approvals is dropped entirely (see section 14) — this
-- function is now the ONLY way an approvals row is ever created.
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

  -- Self-approval prevention for step 1 — decide_leave_approval() already
  -- refuses to route any LATER step back to the requester; this is the same
  -- check for the first step, which that function never sees.
  if v_approver_id = auth.uid() then
    raise exception 'The resolved approver for this workflow''s first step (%) is you — you can''t approve your own request. Contact HR Admin to assign a different approver.', v_approver_type;
  end if;

  -- Idempotent under concurrent double-submission: reimbursement claims,
  -- timesheets, and payroll runs submit against an EXISTING row (an
  -- UPDATE then this call), so two racing calls can both pass every check
  -- above before either has inserted. Returning the existing step-1
  -- approval instead of raising or duplicating means the "loser" of the
  -- race gets back the same approval the "winner" created, rather than
  -- its caller (e.g. submitPayrollRun()) treating this as a routing
  -- failure and reverting the entity's status out from under a real,
  -- already-pending approval. The unique index above is the backstop for
  -- the rare case where both SELECTs below race past each other too.
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

-- Phase 1 correction (2): submitLeaveRequest() used to INSERT into
-- leave_requests and then, as a separate RPC round trip, call
-- create_initial_approval() — two independent transactions. If the second
-- call never reached the database at all (a network drop, the server
-- process dying between the two calls), the leave request was left
-- permanently "submitted" with no approvals row and no one able to act on
-- it; the app's own best-effort "cancel it if routing fails" only covers
-- the case where the SECOND call itself returns an error, not the case
-- where it never runs. This function makes both writes one statement, and
-- therefore one transaction: create_initial_approval() raising for any
-- reason (no workflow configured, no approver resolvable, self-approval)
-- rolls back the leave_requests insert along with it, so a caller only
-- ever observes "fully submitted" or "not submitted at all" — never an
-- orphan request or an orphan approval.
create or replace function submit_leave_request(
  p_leave_type_code text,
  p_start_date date,
  p_end_date date,
  p_half_day_start boolean,
  p_half_day_end boolean,
  p_total_days numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_request_id uuid;
begin
  select id into v_employee_id from employees where user_id = auth.uid() and deleted_at is null;
  if v_employee_id is null then
    raise exception 'No employee record is linked to your account.';
  end if;

  insert into leave_requests (employee_id, leave_type_code, start_date, end_date, half_day_start, half_day_end, total_days, reason)
  values (v_employee_id, p_leave_type_code, p_start_date, p_end_date, coalesce(p_half_day_start, false), coalesce(p_half_day_end, false), p_total_days, p_reason)
  returning id into v_request_id;

  -- Same function the old two-call path used for its second call — reused
  -- here rather than duplicated, so routing stays the single implementation
  -- every other entity type (reimbursement_claim, timesheet, ...) shares.
  -- Calling it from inside this function, rather than as a separate RPC,
  -- is what makes the two writes atomic: a plpgsql function body runs
  -- inside the same transaction as its own invoking statement, so an
  -- exception raised here unwinds the insert above too.
  perform create_initial_approval('leave_request', v_request_id);

  return v_request_id;
end;
$$;

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
      -- Release this run's claim on its source rows (approved reimbursements,
      -- leave-encashment ledger entries) so a rejected run doesn't
      -- permanently block them from ever being paid — otherwise
      -- generate_payroll_export_lines()'s "not exists" check (keyed only on
      -- source_reference_type/id, with no regard for the referencing run's
      -- status) would treat them as already exported, forever.
      delete from payroll_export_lines where run_id = v_approval.entity_id;
    end if;
    return; -- rejection stops the chain; earlier decisions in the log are untouched
  end if;

  -- Walk every remaining step in order (not just the next one) — a step
  -- whose condition doesn't apply (amount below its threshold) is skipped,
  -- and a step that resolves to the requester themselves is skipped too
  -- (self-approval prevention). A step that resolves to NO ONE AT ALL (the
  -- role has zero holders in this company) is different: that's not "skip
  -- and keep going", it's "this cannot legitimately proceed" — abort the
  -- whole decision rather than silently finalizing as if this step had
  -- been satisfied.
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
    end if;
    -- generated_letter has only ever had one step (role:ceo) so it never reaches here
    return;
  end if;

  -- Final approval — entity-specific finalization.
  if v_approval.entity_type = 'leave_request' then
    v_remaining := v_leave_request.total_days;

    -- The row-level "for update" locks above only cover this one
    -- leave_request/approval pair -- they don't stop a SECOND, independent
    -- leave request for the SAME employee from being finalized concurrently
    -- (two approvers, or one approver clicking through two pending items
    -- quickly). Both would otherwise read the same comp_day_ledger SUM
    -- before either commits its deduction, letting both draw from what
    -- looks like an independent full balance and overdraw it. An advisory
    -- lock keyed on the employee serializes comp-day balance reads+writes
    -- across concurrent decisions for that employee; it's released
    -- automatically at transaction end.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_leave_request.employee_id::text));

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
    -- Deliberately no ledger write — timesheets are deprecated. Comp-days
    -- for weekend/holiday work come from Attendance instead (see
    -- bulkRecordAttendance in apps/web/src/lib/actions/attendance.ts).
    update timesheets set status = 'approved', decided_at = now() where id = v_timesheet.id;

  elsif v_approval.entity_type = 'generated_letter' then
    update generated_letters set status = 'issued' where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'payroll_export_run' then
    -- The C-level exec's decision (ceo or cto — the final, always-present
    -- step) stamps authorized_by/at — the one place this column is ever
    -- set, since there's no direct UPDATE policy on those columns for
    -- anyone.
    update payroll_export_runs
    set status = 'approved', authorized_by = coalesce(auth.uid(), v_requester_user_id), authorized_at = now()
    where id = v_approval.entity_id;
  end if;
end;
$$;

-- Withdraws a leave request — the requester's own action, distinct from
-- decide_leave_approval() above (an approver's action). Two cases:
--   - Still awaiting a decision (submitted/pending_approval): just closes
--     out the chain. Without this, cancelling used to be a bare
--     `update leave_requests set status = 'cancelled'` from the app that
--     never touched the approvals table (which has no UPDATE grant for
--     authenticated anyway — see the revoke below) — the approver's now-moot
--     approvals row stayed 'pending' forever, still counting toward their
--     pending-approvals total and still listed on their Approvals page for
--     a decision that no longer mattered.
--   - Already approved, but hasn't started yet: also reverses every ledger
--     entry that approval posted (leave_ledger deduction, and any
--     comp_day_ledger redemption from the deduction-priority routing) —
--     never by deleting them, by the same linked-reversal pattern the
--     ledgers already use elsewhere (reversal_of_id), so the original
--     entries and who reversed them both stay on the record. Once a
--     request's start date has passed, it's cancel-only-going-forward: no
--     way to know from here how much of it was actually taken, so the
--     ledger is left alone and the change has to go through a manual
--     adjustment instead.
create or replace function cancel_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request leave_requests%rowtype;
  v_ledger_row record;
  v_comp_row record;
begin
  select lr.* into v_request
  from leave_requests lr
  join employees e on e.id = lr.employee_id
  where lr.id = p_request_id and e.user_id = auth.uid()
  for update of lr;

  if v_request.id is null then
    raise exception 'Leave request not found, or it is not yours to cancel';
  end if;

  if v_request.status not in ('submitted', 'pending_approval', 'approved') then
    raise exception 'This request can no longer be cancelled (status: %)', v_request.status;
  end if;

  if v_request.status = 'approved' and v_request.start_date <= current_date then
    raise exception 'An approved request can only be cancelled before it starts — once it has started, ask HR for a manual adjustment instead';
  end if;

  update leave_requests set status = 'cancelled', decided_at = now() where id = p_request_id;

  update approvals
  set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, 'Cancelled by requester')
  where entity_type = 'leave_request' and entity_id = p_request_id and decision = 'pending';

  if v_request.status = 'approved' then
    -- Same advisory lock decide_leave_approval() takes before touching this
    -- employee's comp-day balance, for the same reason: serialize concurrent
    -- reads+writes of a SUM-derived balance against this employee.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_request.employee_id::text));

    for v_ledger_row in
      select l.* from leave_ledger l
      where l.reference_type = 'leave_request' and l.reference_id = p_request_id and l.amount_days < 0
        and not exists (select 1 from leave_ledger r where r.reversal_of_id = l.id)
    loop
      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, reversal_of_id, note, created_by)
      values (v_ledger_row.employee_id, v_ledger_row.leave_type_code, current_date, 'reversal', -v_ledger_row.amount_days, 'leave_request', p_request_id, v_ledger_row.id, 'Reversed: leave request cancelled before it started', auth.uid());
    end loop;

    for v_comp_row in
      select c.* from comp_day_ledger c
      where c.reference_type = 'leave_request' and c.reference_id = p_request_id and c.days < 0
        and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = c.id)
    loop
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, reference_id, reversal_of_id, note, created_by)
      values (v_comp_row.employee_id, current_date, 'reversal', -v_comp_row.days, 'leave_request', p_request_id, v_comp_row.id, 'Reversed: leave request cancelled before it started', auth.uid());
    end loop;
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
alter table employee_career_events enable row level security;
alter table employee_loans enable row level security;
alter table identity_documents enable row level security;
alter table employee_insurance_policies enable row level security;
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
        or (has_role('ceo', company_id) or has_role('cto', company_id))
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
  --
  -- Checks old.company_id (the row's CURRENT company), never
  -- new.company_id — the caller controls the new row's contents, so
  -- checking new.company_id would let anyone who is hr_admin of ANY
  -- company escalate by setting company_id to one they administer and
  -- having every other column (employment_status, manager_id, job_title,
  -- deleted_at, ...) pass through unchecked in the same payload.
  if auth.uid() is null or has_role('hr_admin', old.company_id) then
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

-- Permanently destroys an employee record that has NO real history —
-- correcting a mistaken or duplicate "test" entry, never a way to erase
-- genuine activity. Every category below that has at least one row BLOCKS
-- the whole delete (nothing is removed, not even partially) and is named
-- in the error so the caller sees exactly what's in the way instead of a
-- generic refusal.
--
-- employment_contracts/compensation_details are blockers only once there's
-- MORE than the single initial row every employee gets the moment they're
-- created (see createEmployee()) — a lone contract/compensation row is
-- part of the employee's own record, not history, so permanent delete
-- would otherwise be unusable for its actual purpose (a mistaken/draft
-- test employee). A SECOND row of either — a renewed contract, a salary
-- change — is real employment history exactly like the other categories
-- below, and blocks the delete the same way (Phase 1 correction (4)).
-- employee_checklist_items (onboarding/offboarding to-dos) has no such
-- exception — cleaned up silently regardless of count, never treated as
-- history worth blocking on.
--
-- Deliberately does NOT touch:
--   - audit_log: record_id carries no FK to any table on purpose, so this
--     function never has to (or gets to) delete from it — "this employee
--     existed and was permanently deleted by X at time Y" stays visible
--     after the fact, exactly what an audit trail is for.
--   - Storage objects named by a file_path column — same limitation every
--     other soft-delete-only document feature in this app already has;
--     moot in practice here since identity/employee documents are
--     themselves a blocker (see below), so this only ever fires on a
--     record that never had any uploaded either.
--   - auth.users / user_roles for the employee's linked login — a separate
--     concern owned by the Users & Roles admin surface, not this function.
--
-- Irreversible, and only ever valid on an employee already soft-deleted via
-- softDeleteEmployee() ("Remove") — permanent delete is a deliberate SECOND
-- step from that state, never a shortcut around it. HR Admin only
-- (canDeleteOrRestoreEmployee's own scope); SECURITY DEFINER because most
-- of the tables touched below have no DELETE policy for anyone at all
-- (this system is soft-delete-first everywhere else) — the check below is
-- the only gate standing in for all of them at once.
create or replace function permanently_delete_employee(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_deleted_at timestamptz;
  v_blockers text[] := '{}';
  v_count bigint;
begin
  select company_id, deleted_at into v_company_id, v_deleted_at
  from employees where id = p_employee_id;

  if v_company_id is null then
    raise exception 'Employee not found';
  end if;

  if auth.uid() is null or not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may permanently delete an employee';
  end if;

  if v_deleted_at is null then
    raise exception 'Remove the employee first — permanent delete is only available for an already-removed employee';
  end if;

  select count(*) into v_count from attendance_records where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s attendance record(s)', v_count); end if;

  select count(*) into v_count from leave_requests where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s leave request(s)', v_count); end if;

  select count(*) into v_count from leave_ledger where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s leave ledger entr%s', v_count, case when v_count = 1 then 'y' else 'ies' end); end if;

  select count(*) into v_count from comp_day_ledger where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s comp-day ledger entr%s', v_count, case when v_count = 1 then 'y' else 'ies' end); end if;

  select count(*) into v_count from reimbursement_claims where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s reimbursement claim(s)', v_count); end if;

  select count(*) into v_count from project_allocations where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s project allocation(s)', v_count); end if;

  select count(*) into v_count from timesheets where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s timesheet(s)', v_count); end if;

  select count(*) into v_count from goals where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s performance goal(s)', v_count); end if;

  select count(*) into v_count from appraisals where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s appraisal(s)', v_count); end if;

  select count(*) into v_count from payroll_export_lines where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s payroll export line(s)', v_count); end if;

  select count(*) into v_count from generated_letters where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s generated letter(s)', v_count); end if;

  select count(*) into v_count from employee_career_events where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s career event(s) (promotion/salary history)', v_count); end if;

  select count(*) into v_count from asset_assignments where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s asset assignment(s)', v_count); end if;

  select count(*) into v_count from employee_documents where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s document(s)', v_count); end if;

  select count(*) into v_count from identity_documents where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s identity document(s)', v_count); end if;

  select count(*) into v_count from employee_insurance_policies where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s insurance polic%s', v_count, case when v_count = 1 then 'y' else 'ies' end); end if;

  select count(*) into v_count from employee_loans where employee_id = p_employee_id;
  if v_count > 0 then v_blockers := v_blockers || format('%s loan(s)', v_count); end if;

  -- More than the single initial row means real history — a renewed
  -- contract or a salary change — not a mistaken/draft test employee.
  select count(*) into v_count from employment_contracts where employee_id = p_employee_id;
  if v_count > 1 then v_blockers := v_blockers || format('%s employment contract version(s) (renewed/amended)', v_count); end if;

  select count(*) into v_count from compensation_details where employee_id = p_employee_id;
  if v_count > 1 then v_blockers := v_blockers || format('%s compensation version(s) (salary change history)', v_count); end if;

  -- approvals is polymorphic (entity_type/entity_id, no FK) — checked via
  -- the same source tables above, since an approval can only exist for an
  -- entity that still exists.
  select count(*) into v_count
  from approvals a
  where (a.entity_type = 'leave_request' and exists (select 1 from leave_requests r where r.id = a.entity_id and r.employee_id = p_employee_id))
     or (a.entity_type = 'reimbursement_claim' and exists (select 1 from reimbursement_claims c where c.id = a.entity_id and c.employee_id = p_employee_id))
     or (a.entity_type = 'timesheet' and exists (select 1 from timesheets t where t.id = a.entity_id and t.employee_id = p_employee_id))
     or (a.entity_type = 'generated_letter' and exists (select 1 from generated_letters l where l.id = a.entity_id and l.employee_id = p_employee_id));
  if v_count > 0 then v_blockers := v_blockers || format('%s approval record(s)', v_count); end if;

  if array_length(v_blockers, 1) > 0 then
    raise exception 'Cannot permanently delete: this employee has real history — %. Permanent delete is only for a mistaken or duplicate record with no activity; use Remove (soft delete) instead.', array_to_string(v_blockers, ', ');
  end if;

  -- No blocking history — safe to remove. Every table checked above is now
  -- guaranteed empty (or, for contracts/compensation, guaranteed to hold at
  -- most the one initial row) for this employee; only that single row of
  -- each, plus the harmless checklist scaffolding, still need cleaning up.
  update employees set manager_id = null where manager_id = p_employee_id;
  delete from employee_checklist_items where employee_id = p_employee_id;
  delete from compensation_details where employee_id = p_employee_id;
  delete from employment_contracts where employee_id = p_employee_id;
  delete from employees where id = p_employee_id;
end;
$$;

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
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
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

-- ---- employee_career_events: same visibility tier as compensation_details
--      (self, HR Admin, Finance). Insert is HR Admin only — this is the
--      "HR records a promotion/title/salary change" flow specifically,
--      distinct from Finance's own plain compensation-version tool for
--      routine adjustments (bank details, currency corrections) that
--      aren't career events. No update/delete — permanent history.
create policy career_events_select on employee_career_events for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy career_events_insert on employee_career_events for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- Manager-safe summary for the appraisal page's "context" panel — dates
-- only, never amounts. career_events_select above deliberately does NOT
-- grant a manager access to employee_career_events (RLS is row-level, not
-- column-level, so any row access would also expose the salary columns) —
-- this SECURITY DEFINER function is the narrow, redacted view that lets an
-- appraiser see *when* a report was last promoted/given a raise without
-- ever seeing *how much*, mirroring the same "team profile access does not
-- extend to pay" boundary compensation_details already enforces.
create or replace function get_career_summary_for_appraisal(p_employee_id uuid)
returns table(last_promotion_date date, last_title_change_date date, last_salary_change_date date)
language sql
stable
security definer
set search_path = public
as $$
  select
    max(effective_date) filter (where event_type = 'promotion'),
    max(effective_date) filter (where event_type = 'title_change'),
    max(effective_date) filter (where event_type in ('promotion', 'salary_change'))
  from employee_career_events
  where employee_id = p_employee_id
    and (
      current_employee_id() = p_employee_id
      or has_role('hr_admin', (select company_id from employees where id = p_employee_id))
      or has_role('finance', (select company_id from employees where id = p_employee_id))
      or (has_role('ceo', (select company_id from employees where id = p_employee_id)) or has_role('cto', (select company_id from employees where id = p_employee_id)))
      or is_manager_of(p_employee_id)
    );
$$;

-- ---- employee_loans: same visibility tier as compensation_details (HR
--      Admin + Finance full within their company, employee reads own only).
--      Add/delete only, no update policy — see the table's own comment.
create policy employee_loans_select on employee_loans for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy employee_loans_insert on employee_loans for insert
  with check (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy employee_loans_delete on employee_loans for delete
  using (
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

-- employment_contracts_update/compensation_update/identity_docs_update all
-- check has_role(..., company_id) resolved from employee_id -- in USING
-- against the OLD row's employee_id, in WITH CHECK against the NEW row's.
-- Nothing stops employee_id itself changing in the same UPDATE (the same
-- shape already fixed for goals/appraisals, just never patched on these
-- three sensitive-tier tables). An HR Admin/Finance user with write access
-- to both the source and destination employee's company could retarget a
-- row of confidential salary/IBAN or passport/Iqama/PESEL data onto a
-- DIFFERENT employee, corrupting the append-only versioning these tables
-- are documented to rely on, and letting that other (uninvolved) employee
-- read it as "their own" via the plain self-read policy clause.
create or replace function guard_employee_id_immutable()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- trusted backend/migration/seed context
  end if;
  if new.employee_id is distinct from old.employee_id then
    raise exception 'This record cannot be reassigned to a different employee';
  end if;
  return new;
end;
$$;

create trigger employment_contracts_guard_employee_immutable
  before update on employment_contracts
  for each row execute function guard_employee_id_immutable();

create trigger compensation_details_guard_employee_immutable
  before update on compensation_details
  for each row execute function guard_employee_id_immutable();

create trigger identity_documents_guard_employee_immutable
  before update on identity_documents
  for each row execute function guard_employee_id_immutable();

create policy identity_docs_delete on identity_documents for delete
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- employee_insurance_policies: same visibility tier as
--      identity_documents (HR Admin only writes, employee reads own; never
--      Finance/line managers/CEO/CTO). Add/delete only, no update policy.
create policy insurance_policies_select on employee_insurance_policies for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy insurance_policies_insert on employee_insurance_policies for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create policy insurance_policies_delete on employee_insurance_policies for delete
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)));

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
    or (has_role('ceo', null, country_code) or has_role('cto', null, country_code))
  );

-- Every new version must start as a draft — without this, an HR Admin could
-- insert a row already marked 'active' and skip the two-person activation
-- control entirely, since that control only guards the UPDATE path above.
create policy policy_versions_insert on policy_versions for insert
  with check (has_role('hr_admin', null, country_code) and status = 'draft');

create policy policy_versions_update on policy_versions for update
  using (
    status = 'draft'
    and (has_role('hr_admin', null, country_code) or (has_role('ceo', null, country_code) or has_role('cto', null, country_code)))
  )
  with check (has_role('hr_admin', null, country_code) or (has_role('ceo', null, country_code) or has_role('cto', null, country_code)));

-- Same "draft only" restriction the update policy above applies — an
-- active version is real, in-effect policy and stays append-only forever,
-- so this only lets a mis-drafted version that was never activated be
-- removed.
create policy policy_versions_delete on policy_versions for delete
  using (
    status = 'draft'
    and (has_role('hr_admin', null, country_code) or (has_role('ceo', null, country_code) or has_role('cto', null, country_code)))
  );

create or replace function guard_policy_version_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- trusted backend write (migration/seed/service-role) — see the Phase 1 employee self-update guard for why
  end if;

  -- Checks old.country_code (the row's CURRENT country), never
  -- new.country_code — same reasoning as guard_employee_self_update()'s
  -- old.company_id fix: the caller controls the new row's contents, so a
  -- CEO of country A who also happens to hold hr_admin in country B could
  -- otherwise rewrite a country-A draft's content in the same statement
  -- that relocates it to country B (RLS's own WITH CHECK only requires
  -- holding hr_admin-or-ceo in the NEW country, which that dual-role user
  -- satisfies too).
  if not has_role('hr_admin', null, old.country_code) then
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
          or (has_role('ceo', null, pv.country_code) or has_role('cto', null, pv.country_code))
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

-- Scoped to drafts only — same restriction appraisals_update_appraiser
-- already applies to editing — so a submitted/acknowledged appraisal (real
-- history) can never be deleted, only a not-yet-submitted one.
create policy appraisals_delete on appraisals for delete
  using (
    status = 'draft'
    and (appraiser_id = auth.uid() or has_role('hr_admin', (select company_id from employees where id = employee_id)))
  );

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
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'ceo')
      and (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
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
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'ceo')
      and (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'sys_admin')
      and has_role('sys_admin')
    )
  );

-- The comment above claims re-evaluating this same USING clause against the
-- NEW row "blocks reassigning template_item_id/employee_id to something the
-- caller couldn't otherwise see" -- that's not actually true: the FIRST
-- disjunct, `employee_id = current_employee_id()`, doesn't reference
-- template_item_id at all, so an employee who keeps employee_id pointed at
-- themselves can freely retarget template_item_id (and every other column)
-- in the same UPDATE, self-marking someone else's assigned task -- e.g. an
-- HR/Finance/Sys-Admin-verified offboarding step -- as done. Rows are only
-- ever created once by generate_employee_checklist_items() with a fixed
-- employee_id/template_item_id pairing; neither has any legitimate reason
-- to change afterward, so this blocks both outright.
create or replace function guard_checklist_item_identity_immutable()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- trusted backend/migration/seed context
  end if;
  if new.employee_id is distinct from old.employee_id or new.template_item_id is distinct from old.template_item_id then
    raise exception 'A checklist item cannot be reassigned to a different employee or task';
  end if;
  return new;
end;
$$;

create trigger employee_checklist_items_guard_identity_immutable
  before update on employee_checklist_items
  for each row execute function guard_checklist_item_identity_immutable();

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
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
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
--      and HR Admin can see a decision row. No INSERT/UPDATE/DELETE policy
--      exists for ordinary users at all — create_initial_approval() and
--      decide_leave_approval() (both SECURITY DEFINER) are the only ways
--      this table is ever written, so a client can never forge, edit, or
--      redirect an approval by calling .from() directly.
--
-- This used to have an approvals_insert_initial policy
-- (with check (step_order = 1 and decision = 'pending' and
-- is_entity_owner(entity_type, entity_id))) letting the Server Action that
-- submits a request insert the first row directly. That check never
-- validated workflow_id or approver_id at all — so any owner of an entity
-- could insert step 1 with workflow_id = null (or any other workflow's id)
-- and approver_id = themselves, then call decide_leave_approval(): with a
-- null/foreign workflow_id, the "walk every remaining step" loop matches
-- nothing, so it falls straight through to final approval — a full
-- self-approval bypass on every entity type, payroll_export_run's
-- mandatory Finance-then-CEO sign-off included. create_initial_approval()
-- (section 13) closes this by re-resolving the workflow and approver
-- itself rather than trusting anything client-supplied about an
-- approval's routing.
create policy approvals_select on approvals for select
  using (
    approver_id = auth.uid()
    or has_role('hr_admin')
    or is_entity_owner(entity_type, entity_id)
  );

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
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
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
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
  );

create policy reimbursement_insert on reimbursement_claims for insert
  with check (employee_id = current_employee_id() and status = 'draft');

create policy reimbursement_update_draft on reimbursement_claims for update
  using (employee_id = current_employee_id() and status = 'draft')
  with check (employee_id = current_employee_id() and status in ('draft', 'submitted'));

create policy reimbursement_update_cancel on reimbursement_claims for update
  using (employee_id = current_employee_id() and status in ('submitted', 'pending_approval'))
  with check (employee_id = current_employee_id() and status = 'cancelled');

-- Once submitted, "cancel" (above) is the only way out — approved/rejected/
-- cancelled claims are kept for the record, same as leave_requests never
-- getting a delete policy either. A still-draft claim was never submitted
-- anywhere, so there's nothing to preserve.
create policy reimbursement_delete_draft on reimbursement_claims for delete
  using (employee_id = current_employee_id() and status = 'draft');

create policy reimbursement_lines_select on reimbursement_claim_lines for select
  using (exists (
    select 1 from reimbursement_claims c
    where c.id = claim_id and (
      c.employee_id = current_employee_id()
      or is_manager_of(c.employee_id)
      or has_role('hr_admin', (select company_id from employees where id = c.employee_id))
      or has_role('finance', (select company_id from employees where id = c.employee_id))
      or (has_role('ceo', (select company_id from employees where id = c.employee_id)) or has_role('cto', (select company_id from employees where id = c.employee_id)))
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
    or (has_role('ceo', (select company_id from employees where id = employee_id)) or has_role('cto', (select company_id from employees where id = employee_id)))
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
    or (has_role('ceo', company_id) or has_role('cto', company_id))
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

-- Finance can delete a run only while it's still a draft — once submitted,
-- its fate belongs to the approval workflow (decide_leave_approval()
-- above), not a direct delete. Deleting a draft cascades to its lines (FK
-- on delete cascade), releasing any source rows it had claimed back for a
-- future run's generation — the same release a rejection performs.
create policy payroll_runs_delete_finance on payroll_export_runs for delete
  using (has_role('finance', company_id) and status = 'draft');

create policy payroll_lines_select on payroll_export_lines for select
  using (exists (
    select 1 from payroll_export_runs r
    where r.id = run_id and (has_role('hr_admin', r.company_id) or has_role('finance', r.company_id) or (has_role('ceo', r.company_id) or has_role('cto', r.company_id)))
  ));

-- with check also requires employee_id's own company to match the run's
-- company — without it, a Finance user could target payroll_export_lines at
-- an employee_id belonging to a different company than the run (the run's
-- company only decides who is allowed to write here at all, never which
-- employee a line is allowed to be about).
create policy payroll_lines_insert on payroll_export_lines for insert
  with check (exists (
    select 1 from payroll_export_runs r
    join employees e on e.id = employee_id and e.company_id = r.company_id
    where r.id = run_id and has_role('finance', r.company_id) and r.status = 'draft'
  ));

-- Update/delete: same shape as insert — Finance, only while the parent run
-- is still draft. Update backs in-place amount corrections
-- (updatePayrollLineAmount); delete backs removing a bad manual/auto line
-- before submission. Once submitted, a line's fate belongs to the approval
-- workflow, same as the parent run. with check repeats the same
-- employee/run-company match as insert — updatePayrollLineAmount never
-- sends employee_id, but RLS must not depend on that: without it, any
-- direct write could retarget a line onto a different company's employee.
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
      'comp_day_ledger', 'approvals', 'reimbursement_claims', 'timesheets', 'payroll_export_runs', 'generated_letters'
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

create policy user_roles_insert_sysadmin on user_roles for insert
  with check (has_role('sys_admin'));

-- No UPDATE or DELETE policy at all, and both are explicitly revoked below —
-- a grant must be retained and revoked only through revoke_role_grant(),
-- which enforces the self-revocation and last-System-Administrator
-- protections atomically; a direct DELETE would destroy the row (and its
-- revoked_at history) without going through either check. See
-- 20261030000000_guard_role_grant_revocation.sql. deleteUserAccount()'s own
-- user_roles cleanup runs via the service-role client, so it's unaffected.
revoke update, delete on user_roles from authenticated, anon;

create or replace function revoke_role_grant(p_role_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role app_role;
  v_active_sysadmins bigint;
begin
  if auth.uid() is null or not has_role('sys_admin') then
    raise exception 'Only a System Administrator may revoke a role grant';
  end if;

  -- Held until this transaction ends (commit or rollback) — a concurrent
  -- call blocks here until the first one is fully done, so its count check
  -- below always sees the first call's committed result, never a stale
  -- pre-commit snapshot.
  perform pg_advisory_xact_lock(hashtext('user_roles:revoke_role_grant'));

  select user_id, role into v_user_id, v_role
  from user_roles
  where id = p_role_grant_id and revoked_at is null;

  if v_user_id is null then
    raise exception 'This role grant no longer exists';
  end if;

  -- Checked before the self-revocation guard below: when there's only one
  -- active sys_admin left, revoking it is necessarily a self-revoke (no
  -- other caller could pass the sys_admin check above), and the more
  -- specific "last admin" reason is the more useful one to surface.
  if v_role = 'sys_admin' then
    select count(*) into v_active_sysadmins from user_roles where role = 'sys_admin' and revoked_at is null;
    if v_active_sysadmins <= 1 then
      raise exception 'Can''t revoke the last System Administrator — the system would have nobody left to manage users or roles';
    end if;
  end if;

  if v_user_id = auth.uid() then
    raise exception 'You can''t revoke your own role — ask another System Administrator to do it';
  end if;

  update user_roles set revoked_at = now() where id = p_role_grant_id;
end;
$$;

-- =============================================================================
-- 15. Audit trigger wiring (generic before/after capture on guarded tables)
-- =============================================================================

-- company_id is resolved so HR Admin's view can be scoped to their own
-- company, not every company's history. Not every audited table carries
-- company_id directly, so it's derived: a direct column if present, else
-- via the row's employee_id, else (approvals, which is entity-type-generic)
-- by resolving the approved entity the same way is_entity_owner() does.
--
-- Phase 1 correction (5): before_data/after_data used to store the row's
-- COMPLETE column set verbatim, forever — for compensation_details, that
-- means every bank_iban/bank_swift/bank_name value the employee has ever
-- had stays in an append-only audit trail indefinitely, readable by any
-- HR Admin of the company, well beyond what the live table exposes (which
-- only ever shows the CURRENT value). None of that is what an audit trail
-- is actually for — "who changed the banking details, and when" doesn't
-- require replaying the old and new account numbers themselves — so these
-- specific fields are redacted before the snapshot is stored, on whichever
-- audited table they happen to appear on. Everything else (including
-- base_salary/allowances, which HR Admin's own compensation-change review
-- genuinely needs) is left intact.
create or replace function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role app_role;
  v_actor_roles app_role[];
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_employee_id uuid;
  v_company_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_sensitive_keys constant text[] := array['bank_iban', 'bank_swift', 'bank_name', 'document_number', 'policy_number'];
  v_key text;
begin
  -- A multi-role user (e.g. a Line Manager also granted Finance) must never
  -- be recorded as if they only held one role — every currently-held,
  -- unrevoked role is captured. actor_role is kept alongside for backward
  -- compatibility with anything still reading the single-value column;
  -- it's always the same "most recently granted" choice it always was.
  select array_agg(role order by granted_at desc) into v_actor_roles
  from user_roles where user_id = auth.uid() and revoked_at is null;
  v_actor_role := v_actor_roles[1];

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

  v_before := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_after := case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(new) else null end;
  foreach v_key in array v_sensitive_keys loop
    if v_before ? v_key then v_before := jsonb_set(v_before, array[v_key], '"[redacted]"'::jsonb); end if;
    if v_after ? v_key then v_after := jsonb_set(v_after, array[v_key], '"[redacted]"'::jsonb); end if;
  end loop;

  insert into audit_log(table_name, record_id, action, actor_id, actor_role, actor_roles, company_id, before_data, after_data)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    lower(TG_OP),
    auth.uid(),
    v_actor_role,
    v_actor_roles,
    v_company_id,
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;

-- HR-content tables (docs/03-permission-matrix.md's "HR-scoped entries").
create trigger audit_employees after insert or update or delete on employees
  for each row execute function write_audit_log();
create trigger audit_compensation after insert or update or delete on compensation_details
  for each row execute function write_audit_log();
create trigger audit_employee_loans after insert or delete on employee_loans
  for each row execute function write_audit_log();
create trigger audit_career_events after insert on employee_career_events
  for each row execute function write_audit_log();
create trigger audit_contracts after insert or update or delete on employment_contracts
  for each row execute function write_audit_log();
create trigger audit_insurance_policies after insert or delete on employee_insurance_policies
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
create trigger audit_timesheets after insert or update or delete on timesheets
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

-- file_size_limit/allowed_mime_types are Supabase Storage's own guard
-- against an upload nobody validated client-side (a devtools edit, or a
-- direct POST to the server action, bypasses any <input accept="...">) —
-- belt-and-braces alongside the application-level validation in
-- apps/web/src/lib/uploads.ts, which every upload path calls before ever
-- reaching storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('employee-documents', 'employee-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('identity-documents', 'identity-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('insurance-documents', 'insurance-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('receipts', 'receipts', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  -- populated only by issueLetter() itself (react-pdf output), never a
  -- user-supplied file — still worth a matching ceiling and an exact-type
  -- lock as defense in depth.
  ('letters', 'letters', false, 10485760, array['application/pdf'])
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

-- insurance-documents: same shape as identity-documents — HR Admin only for
-- writes, owner + HR Admin for reads.
create policy insurance_documents_select on storage.objects for select
  using (
    bucket_id = 'insurance-documents'
    and (
      (storage.foldername(name))[2]::uuid = current_employee_id()
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
    )
  );

create policy insurance_documents_write on storage.objects for insert
  with check (bucket_id = 'insurance-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy insurance_documents_update on storage.objects for update
  using (bucket_id = 'insurance-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy insurance_documents_delete on storage.objects for delete
  using (bucket_id = 'insurance-documents' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

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

-- CEO/CTO get their own policy (mirroring generated_letters_select's read
-- access, ceo and cto being equal C-level peers throughout this schema)
-- rather than folding into letters_select above, since a C-level exec
-- deciding a letter's approval needs to read the file itself, not just
-- its row. Policy name kept as letters_select_ceo (an internal identifier,
-- not user-facing) for continuity with the migration that created it.
create policy letters_select_ceo on storage.objects for select
  using (bucket_id = 'letters' and (has_role('ceo', (storage.foldername(name))[1]::uuid) or has_role('cto', (storage.foldername(name))[1]::uuid)));

create policy letters_write on storage.objects for insert
  with check (bucket_id = 'letters' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));

create policy letters_delete on storage.objects for delete
  using (bucket_id = 'letters' and has_role('hr_admin', (storage.foldername(name))[1]::uuid));
