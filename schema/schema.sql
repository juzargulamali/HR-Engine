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

-- 'deactivated' is shown in the UI as "Deactivated — access suspended".
-- The actual login block is auth.users.banned_until (set via the Admin API
-- from lib/actions/account-status.ts), not this column — see §15's
-- set_account_status() for why.
create type account_status as enum ('invited', 'active', 'deactivated');

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
  'onboarding_task', 'offboarding_task', 'payroll_export_run', 'recovery_credit'
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
  -- A single "week starts here" integer can only describe a CONTIGUOUS
  -- 5-day work week — this is the explicit, authoritative override for a
  -- schedule it can't represent (0=Sunday..6=Saturday, the exact days
  -- worked). Resolved (per the final business decision) for AE/SA/PL —
  -- {1,2,3,4,5}/{0,1,2,3,4}/{1,2,3,4,5} respectively — by the leave-policy-
  -- configuration migration; null for every other country, which falls back
  -- to the week_start_day derivation above; see
  -- preflight_country_schedule_config().
  working_weekdays integer[],
  created_at      timestamptz not null default now()
);

-- Read-only audit tool: reports each of AE/SA/PL's ACTUAL EFFECTIVE
-- schedule (working_weekdays when set, else the value derived from
-- week_start_day) against the resolved Monday-Friday(AE/PL)/
-- Sunday-Thursday(SA) convention, flagging any country where the two
-- disagree — expected to always report no conflicts once working_weekdays
-- is set for all three (kept as a live regression check, e.g. if it were
-- ever cleared again, rather than removed now that the conflict is
-- resolved). Callable by any authenticated user, same openness as
-- resolve_policy() — this is aggregate configuration, not employee data.
create or replace function preflight_country_schedule_config()
returns table(
  country_code text,
  week_start_day smallint,
  working_weekdays integer[],
  effective_working_days integer[],
  requested_convention text,
  conflicts_with_requested_convention boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.code,
    c.week_start_day,
    c.working_weekdays,
    coalesce(c.working_weekdays, derived.days),
    req.convention,
    (req.expected is not null and coalesce(c.working_weekdays, derived.days) is distinct from req.expected)
  from countries c
  cross join lateral (
    select array_agg(d order by d) as days
    from generate_series(0, 6) as d
    where ((d - coalesce(c.week_start_day, 1) + 7) % 7) < 5
  ) as derived
  cross join lateral (
    select
      case c.code
        when 'AE' then 'Monday-Friday'
        when 'SA' then 'Sunday-Thursday'
        when 'PL' then 'Monday-Friday'
        else null
      end as convention,
      case c.code
        when 'AE' then array[1,2,3,4,5]
        when 'SA' then array[0,1,2,3,4]
        when 'PL' then array[1,2,3,4,5]
        else null
      end as expected
  ) as req
  where c.code in ('AE', 'SA', 'PL');
$$;

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
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null,
  full_name           text,
  locale              text not null default 'en',
  is_active           boolean not null default true,
  account_status      account_status not null default 'invited',
  -- Admin-entered free text (max 500 chars, enforced in set_account_status()
  -- and its caller) — never render this via dangerouslySetInnerHTML; plain
  -- JSX text interpolation (React's default) escapes it safely. There is no
  -- server-side HTML/script sanitization on this field by design — output
  -- encoding, not input blacklisting, is what actually prevents stored XSS.
  status_reason       text,
  status_changed_by   uuid references auth.users(id),
  status_changed_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
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
    check (recognised_prior_service_years is null or recognised_prior_service_years >= 0),
  -- Whether this is the employee's first-ever job of their working life
  -- (Kodeks pracy Art. 153 §1's progressive first-year proration) versus
  -- someone who has worked before, anywhere, ever (Art. 1551's
  -- calendar-year proportional entitlement instead) — a DIFFERENT fact
  -- from "first year at Enginious", and never inferred from hire_date.
  -- Null (every employee until HR confirms it) blocks automatic Poland
  -- Annual Leave accrual for that employee rather than guessing either
  -- answer — see computeAnnualLeaveEntitlementToDate.
  is_first_ever_employment boolean
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
  -- 'role_queue:hr_admin' is distinct from 'role:hr_admin': the latter
  -- resolves (via resolve_approver()) to ONE specific person (earliest
  -- granted_at) and assigns approvals.approver_id to them; the former
  -- resolves to NO ONE in particular at creation time — approver_id is left
  -- null, and ANY current holder of that role in the approval's own company
  -- may decide it (see decide_leave_approval()'s null-approver_id branch).
  -- Currently used only by recovery_credit's single HR step, specifically
  -- so Recovery Leave decisions go to a reliable company-wide HR queue
  -- rather than always the same one HR Admin (or, worse, a dormant/test
  -- account that happens to have the earliest grant).
  approver_type     text not null,   -- 'direct_manager' | 'manager_of_manager' | 'role:hr_admin' | 'role:finance' | 'role:ceo' | 'role_queue:hr_admin'
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
  -- Nullable specifically for a 'role_queue:%' step (see
  -- approval_workflow_steps.approver_type above) — every OTHER approver
  -- type still always resolves to and stores a specific person, unchanged.
  approver_id     uuid references auth.users(id),
  -- Generalizes the 'role_queue:%' idea onto the approvals row itself,
  -- self-describing rather than requiring a join back to
  -- approval_workflow_steps for its meaning — needed because
  -- recovery_credit's new self-clock routing (see recovery_credit_requests.
  -- applicant_route) computes each request's route from a per-request
  -- snapshot rather than one company-wide workflow, so there is no single
  -- workflow_id/step_order to look the queue's role up from. Null for a
  -- person-specific step (approver_id is set instead) and for every
  -- legacy 'role_queue:%' step driven by approval_workflow_steps (that
  -- mechanism is unchanged — see decide_leave_approval()'s own doc
  -- comment on the three-way approver_id/queue_roles/legacy-role_queue
  -- branch). More than one element ONLY for the shared CEO/CTO queue
  -- (ARRAY['ceo','cto']) — EITHER holder may decide it, and the existing
  -- `select ... for update` row lock plus `decision <> 'pending'` guard
  -- already used by every other approval already makes "whoever decides
  -- first wins, the other's later attempt fails" hold here too, with no
  -- new concurrency mechanism needed.
  queue_roles     app_role[],
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

-- A recovery credit "earning" request — one active row per attendance
-- record (legacy manual/overnight path) or per employee/work_date/event_type
-- (new self-clock path) at a time; the two partial unique indexes below are
-- each family's own natural key — a cancelled/rejected row never
-- permanently blocks a later, genuinely fresh request for the same day.
-- Routed through the SAME generic approval engine above via
-- entity_type = 'recovery_credit', but the TWO families route differently:
--   - LEGACY (attendance_record_id set, applicant_route null): unchanged —
--     ONE HR decision via the company-scoped role_queue:hr_admin step (see
--     approval_workflow_steps.approver_type's own doc comment). HR checks
--     the work with the relevant project lead OUTSIDE the application
--     first; that lead is never an application approver here and needs no
--     role or self-approval handling. Chosen deliberately over retrofitting
--     the legacy manual-attendance-register UI with project-lead capture,
--     which this redesign's scope never asked for.
--   - SELF-CLOCK (segment_id set, applicant_route not null — see
--     attendance_segments/sync_attendance_recovery_for_day()): routed by
--     applicant_route, snapshotted ONCE at creation from the applicant's
--     roles and the segment's own project_lead_employee_id, so a later
--     role or profile change never silently reroutes an in-flight request
--     (see resolve_recovery_credit_route()). The lead genuinely IS an
--     approval-chain step for the 'employee_lead_then_hr' route — never
--     for the other three.
create table recovery_credit_requests (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references employees(id),
  attendance_record_id  uuid references attendance_records(id),
  -- The self-clock evidence anchor — the segment whose work_mode/project/lead
  -- this request's routing was snapshotted from. A recovery day's TOTAL
  -- hours may span more than one segment (sync_attendance_recovery_for_day()
  -- sums every segment for the day, exactly like the legacy path summed one
  -- attendance_records row); this column names only the segment routing was
  -- decided from, never a claim that it is the sole contributor — see that
  -- function's own doc comment for how it picks one when several site_work
  -- segments with DIFFERENT leads exist on the same day.
  segment_id            uuid references attendance_segments(id),
  check ((attendance_record_id is not null) <> (segment_id is not null)),
  -- work_date/proposed_days are the CURRENT/EFFECTIVE values — what the
  -- ledger actually uses when this is approved. They start out equal to
  -- whatever the originating attendance evidence implied, and
  -- adjust_recovery_credit_request() (below) is the ONLY way either ever
  -- changes afterward. The ORIGINAL, unedited values are never lost: they
  -- live forever on the originating attendance evidence (attendance_records
  -- for the legacy path, attendance_segments for the self-clock path) — the
  -- approval screen reads both sides to show "original vs. HR's correction"
  -- side by side, never overwriting the evidence.
  work_date             date not null,
  event_type            text not null check (event_type in ('standard', 'overnight')),
  proposed_days         numeric(3,1) not null check (proposed_days in (0.5, 1)),
  status                request_status not null default 'submitted',
  submitted_at          timestamptz not null default now(),
  decided_at            timestamptz,
  created_by            uuid not null,
  comp_day_ledger_id    uuid references comp_day_ledger(id),
  created_at            timestamptz not null default now(),
  -- HR's own correction trail — see adjust_recovery_credit_request().
  -- correction_reason is required by that function whenever work_date or
  -- proposed_days actually changes; checked_with is required at decision
  -- time for an APPROVAL that HR decides directly (decide_recovery_credit_request())
  -- since the product brief requires HR to have verified the work with the
  -- relevant project lead outside the application before crediting anything
  -- — not required for the 'employee_lead_then_hr' route's OWN lead step,
  -- since the lead there already IS the in-app verification.
  -- corrected_at is the marker the UI uses to know whether to render an
  -- "adjusted by HR" side-by-side comparison at all.
  correction_reason     text,
  checked_with          text,
  corrected_by          uuid references auth.users(id),
  corrected_at          timestamptz,
  -- Self-clock routing — see attendance_segments/sync_attendance_recovery_for_day().
  -- work_mode/project_name/project_lead_employee_id are SNAPSHOTS taken at
  -- creation time from the anchor segment (never re-read from it later),
  -- satisfying "snapshot the selected project lead and workflow on
  -- submission so later profile changes never silently reroute requests."
  -- All four are null for the legacy attendance_record_id-anchored family.
  work_mode                 text,
  project_name              text,
  project_lead_employee_id  uuid references employees(id),
  applicant_route           text check (applicant_route in ('employee_lead_then_hr', 'manager_hr_direct', 'hr_admin_ceo_cto_queue', 'self_led_hr_direct')),
  -- True only for an 'employee_lead_then_hr'-shaped candidate (an ordinary
  -- employee, not self-led) whose contributing segment(s) never captured a
  -- project lead — Office/WFH work only requires one "when relevant", so
  -- this can legitimately happen. No approvals row exists at all while this
  -- is true (see sync_attendance_recovery_for_day()); the candidate is
  -- never discarded and never guess-routed —
  -- resolve_recovery_credit_project_lead() is the only way to supply the
  -- missing lead and complete routing.
  awaiting_project_lead     boolean not null default false,
  -- Business travel's policy is deliberately undefined (see attendance_segments'
  -- own work_mode check) — a candidate touching any business_travel segment
  -- is always flagged here for HR's own judgment, never auto-credited or
  -- auto-blocked. Also set when several same-day site_work segments name
  -- DIFFERENT project leads (see sync_attendance_recovery_for_day()) —
  -- either way this is "look closer", never "something is broken".
  needs_policy_review       boolean not null default false,
  -- Set instead of raising whenever routing genuinely cannot be resolved —
  -- e.g. the named project lead has no HR Engine user account to log in and
  -- decide with, or (shared CEO/CTO queue) neither role currently has an
  -- active holder. An UNRESOLVED request is still fully visible to HR
  -- (recovery_credit_requests_select) with no approvals row at all, per
  -- "show a clear UNRESOLVED review state rather than skipping approval" —
  -- never silently dropped, and never guessed around.
  routing_issue             text
);

create index idx_recovery_credit_requests_employee on recovery_credit_requests(employee_id);

create unique index recovery_credit_requests_active_per_record
  on recovery_credit_requests(attendance_record_id)
  where status not in ('cancelled', 'rejected') and attendance_record_id is not null;

-- The self-clock family's equivalent natural key: attendance_record_id is
-- always null here, so the index above (keyed on that column) can never
-- enforce uniqueness for it — NULL <> NULL under a plain unique index, so
-- without this a duplicate sync could otherwise insert two active requests
-- for the same employee/day/event_type.
create unique index recovery_credit_requests_active_per_day
  on recovery_credit_requests(employee_id, work_date, event_type)
  where status not in ('cancelled', 'rejected') and segment_id is not null;

-- HR/Finance-provided statutory wage basis for non-UAE leave encashment at
-- termination — UAE settles at basic salary (computeFinalSettlement's
-- default), but this system has no way to compute Saudi/Poland's statutory
-- figure automatically; settlement preparation blocks with a clear message
-- until this is present. entered_by/entered_at are stamped server-side by
-- trigger (below), never trusted from the client.
create table termination_settlement_inputs (
  employee_id                  uuid primary key references employees(id),
  leave_encashment_daily_rate  numeric(12,2) not null check (leave_encashment_daily_rate > 0),
  entered_by                   uuid not null,
  entered_at                   timestamptz not null default now()
);

create or replace function stamp_termination_settlement_input()
returns trigger
language plpgsql
as $$
begin
  new.entered_by := auth.uid();
  new.entered_at := now();
  return new;
end;
$$;

create trigger termination_settlement_inputs_stamp
  before insert or update on termination_settlement_inputs
  for each row execute function stamp_termination_settlement_input();

-- Records the outcome of exactly one Poland termination Annual Leave
-- true-up per employee — including a ZERO-delta outcome (the cron had
-- already granted the exact right amount) — so "no marker exists"
-- unambiguously means "the true-up has never run for this employee," never
-- conflated with "it ran and found nothing to adjust." Final Settlement
-- (final-settlement-section.tsx) reads this table, not a recomputed
-- entitlement, to decide whether it's safe to render a settlement figure —
-- recomputing the entitlement successfully proves the CALCULATION is
-- possible, not that post_poland_termination_leave_adjustment() (below)
-- actually ran and posted/reconciled it.
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

-- HR's own bulk/manual daily attendance register — kept exactly as-is,
-- coexisting with the newer employee self-clock path (attendance_sessions/
-- attendance_segments, defined further below, right after this table).
-- Neither replaces the other: this one is HR/manager-attested (a whole
-- day's status/hours entered on someone's behalf, e.g. to backfill a day
-- an employee forgot to clock, or for a company not yet using self-clock
-- at all); the newer one is the employee's own server-timestamped clock
-- events. Both feed the SAME recovery_credit_requests/approvals pipeline
-- independently.
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
  -- Set by sync_attendance_presence_for_day() when a self-clock event would
  -- otherwise need to touch a day already recorded by a non-self-clock
  -- source (manual/biometric/import) with a real status -- self-clock NEVER
  -- overwrites that day, it only flags the conflict here for HR to see and
  -- reconcile. Cleared automatically the next time that day is saved
  -- through the manual register (record_attendance_and_recovery()), which
  -- always reasserts manual ownership.
  presence_conflict text,
  unique (employee_id, work_date)
);

-- ---------------------------------------------------------------------
-- Employee self-service attendance clocking (replaces the Jibble
-- integration this schema previously staged — no third-party time-tracking
-- system is used; clock events are recorded directly in HR Engine).
--
-- One continuous clock-in-to-clock-out SESSION per employee at a time (the
-- partial unique index below enforces this at the database boundary — not
-- just in the app), made up of one or more contiguous SEGMENTS, each
-- carrying its own work mode/project/lead. Switching work mode mid-shift
-- closes the current segment and opens a new one WITHOUT closing the
-- session — this is what lets one overnight or multi-mode shift still be
-- one attendance record with per-segment detail preserved, rather than
-- forcing an artificial clock-out/clock-in just to change context.
--
-- Every timestamp here is a SERVER timestamp (`now()`, inside a
-- SECURITY DEFINER RPC — see clock_in()/switch_work_segment()/clock_out()
-- below) — an employee can never backdate or supply their own clock time.
-- There is deliberately no "start break"/"end break" action: elapsed
-- duration is always segment_end - segment_start, computed from these
-- server timestamps, and nothing here ever silently deducts an assumed
-- break — see sync_attendance_recovery_for_day()'s own comment for how the
-- RECORDED duration (this table) and the QUALIFYING hours HR ultimately
-- approves (recovery_credit_requests.proposed_days) are kept as two
-- separate numbers, never conflated.
create table attendance_sessions (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id),
  clock_in_at    timestamptz not null default now(),
  clock_out_at   timestamptz,   -- null = still open
  status         text not null default 'open' check (status in ('open', 'closed')),
  -- Set only by hr_close_attendance_session() — the "missing clock-out"
  -- correction path. The ORIGINAL clock_in_at above is never altered by
  -- it; these columns are purely additive, so a forgotten clock-out is
  -- always visibly distinguishable from a normal employee-initiated one.
  hr_closed_by   uuid references auth.users(id),
  hr_closed_at   timestamptz,
  hr_closed_reason text,
  created_at     timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at > clock_in_at)
);

create unique index attendance_sessions_one_open_per_employee
  on attendance_sessions(employee_id) where status = 'open';
create index idx_attendance_sessions_employee on attendance_sessions(employee_id, clock_in_at desc);

-- Work modes deliberately distinct from attendance_records.work_mode's
-- legacy HR-bulk-entry values (office/client_site/work_from_home/
-- field_work/business_travel) — that table and this one are independent
-- attendance paths kept side by side (see attendance_records' own doc
-- comment), so no historical row's meaning is reinterpreted by this
-- migration; 'site_work' and 'client_meeting' are new, narrower concepts
-- this self-clock flow needs that the legacy free-form set didn't
-- distinguish.
create table attendance_segments (
  id                        uuid primary key default gen_random_uuid(),
  session_id                uuid not null references attendance_sessions(id),
  employee_id               uuid not null references employees(id),  -- denormalized from the session for RLS/query convenience; set once, never updated
  work_mode                 text not null check (work_mode in ('office', 'wfh', 'site_work', 'client_meeting', 'business_travel')),
  -- Typed freely, no pre-created project list required — "no pre-created
  -- project list is required" is a product requirement, not a shortcut:
  -- HR reviews the free text on the approval screen instead.
  project_name              text,
  project_lead_employee_id  uuid references employees(id),
  segment_start             timestamptz not null,
  segment_end               timestamptz,   -- null = the current active segment
  created_at                timestamptz not null default now(),
  check (segment_end is null or segment_end > segment_start),
  -- Site work / Installation always needs a named project AND a lead
  -- selected up front (never guessed later) — every other mode may supply
  -- them when relevant but is never required to.
  check (work_mode <> 'site_work' or (project_name is not null and length(trim(project_name)) > 0 and project_lead_employee_id is not null))
);

create unique index attendance_segments_one_open_per_session
  on attendance_segments(session_id) where segment_end is null;
create index idx_attendance_segments_session on attendance_segments(session_id, segment_start);
create index idx_attendance_segments_employee on attendance_segments(employee_id, segment_start);
create index idx_attendance_segments_lead on attendance_segments(project_lead_employee_id) where project_lead_employee_id is not null;

-- Fresh browser geolocation, captured ONLY at a Site work / Installation
-- segment's own start and end (never continuous tracking, and never for
-- any other work mode). Denial or unavailability never blocks clocking —
-- permission_status alone (without coordinates) is still stored, which is
-- exactly what makes the event visibly flagged for HR review instead of
-- silently missing evidence. captured_at is this SERVER's receipt time,
-- not a client-reported one, for the same never-trust-the-browser-clock
-- reason every other timestamp in this feature is server-side.
create table attendance_locations (
  id                 uuid primary key default gen_random_uuid(),
  segment_id         uuid not null references attendance_segments(id),
  event              text not null check (event in ('segment_start', 'segment_end')),
  latitude           numeric(9,6),
  longitude          numeric(9,6),
  accuracy_meters    numeric,
  permission_status  text not null check (permission_status in ('granted', 'denied', 'unavailable', 'timeout')),
  captured_at        timestamptz not null default now(),
  unique (segment_id, event)
);

create index idx_attendance_locations_segment on attendance_locations(segment_id);

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

-- Resolves ONLY the manager's display name for one specific employee,
-- gated by the exact same predicate employees_select uses to decide
-- whether the caller may view that employee row at all — so this never
-- returns anything the caller couldn't already see via the profile page
-- itself. Fixes a real gap in employees_select: it lets a viewer see rows
-- they manage (is_manager_of) but never their OWN manager's row, so a
-- plain employee's profile always showed "Manager: —" even when
-- manager_id was set and correct.
create or replace function get_employee_manager_name(p_employee_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select nullif(trim(concat(m.first_name, ' ', coalesce(m.last_name, ''))), '')
  from employees e
  join employees m on m.id = e.manager_id
  where e.id = p_employee_id
    and (
      has_role('hr_admin', e.company_id)
      or has_role('sys_admin')
      or (
        e.deleted_at is null and (
          e.id = current_employee_id()
          or is_manager_of(e.id)
          or has_role('finance', e.company_id)
          or (has_role('ceo', e.company_id) or has_role('cto', e.company_id))
        )
      )
    );
$$;

grant execute on function get_employee_manager_name(uuid) to authenticated;

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

-- Country -> IANA timezone, so a server-timestamped attendance instant
-- (an attendance_segments row, or a legacy attendance_records entry)
-- converts to the EMPLOYEE'S OWN local calendar date, never UTC's date
-- (which can be the wrong day entirely for a shift near midnight in
-- AE/SA). Mirrors packages/domain/src/businessTime.ts's COUNTRY_TIMEZONES +
-- DASHBOARD_TIMEZONE fallback exactly — keep both in sync if a new country
-- is added; this one exists because sync_attendance_recovery_for_day()
-- (below) needs it inside a single atomic SQL transaction, where the
-- TS-side helper isn't reachable.
create or replace function country_timezone(p_country_code text)
returns text
language sql
immutable
as $$
  select case p_country_code
    when 'AE' then 'Asia/Dubai'
    when 'SA' then 'Asia/Riyadh'
    when 'PL' then 'Europe/Warsaw'
    else 'Asia/Dubai'
  end;
$$;

-- Recovery Leave's ≤4h/>4h credit threshold — the ONE place this rule is
-- expressed, so record_attendance_and_recovery(), record_overnight_recovery_credit(),
-- sync_attendance_recovery_for_day(), and adjust_recovery_credit_request()
-- (all below) can never drift apart on it. 0 for null/non-positive hours,
-- never a negative or nonsensical credit.
create or replace function recovery_credit_days_for_hours(p_hours numeric)
returns numeric
language sql
immutable
as $$
  select case when p_hours is null or p_hours <= 0 then 0 when p_hours > 4 then 1 else 0.5 end;
$$;

-- Whether p_work_date is a qualifying Recovery-Leave day for p_country_code
-- — a public holiday, OR outside that country's normal working weekdays.
-- This is the ONE definition of "qualifying" every path that can produce a
-- recovery_credit_requests row shares (the manual attendance register
-- below, and sync_attendance_recovery_for_day()'s self-clock-driven
-- detection) — deliberately excludes "ordinary late office work on a normal working
-- day", which must never auto-qualify regardless of how many hours were
-- logged. Prefers countries.working_weekdays when a country has one
-- configured, falling back to the week_start_day-derived formula otherwise
-- (see preflight_country_schedule_config()) — unchanged from the inline
-- version this replaces.
create or replace function is_recovery_eligible_day(p_country_code text, p_work_date date, out is_recovery_day boolean, out holiday_name text)
language plpgsql
stable
as $$
declare
  v_week_start_day smallint;
  v_working_weekdays integer[];
begin
  select week_start_day, working_weekdays into v_week_start_day, v_working_weekdays from countries where code = p_country_code;
  select name into holiday_name from public_holidays where country_code = p_country_code and holiday_date = p_work_date;
  is_recovery_day := holiday_name is not null
    or (
      case when v_working_weekdays is not null and array_length(v_working_weekdays, 1) > 0
        then not (extract(dow from p_work_date)::int = any(v_working_weekdays))
        else ((extract(dow from p_work_date)::int - coalesce(v_week_start_day, 1) + 7) % 7) >= 5
      end
    );
end;
$$;

-- ---------------------------------------------------------------------
-- Employee self-service attendance clocking RPCs (clock_in/switch_work_segment/
-- clock_out) — the write side of attendance_sessions/attendance_segments/
-- attendance_locations (see those tables' own header comment). Every
-- timestamp is server-side (now()); the employee never supplies one. Each
-- writes its whole transaction (session/segment open or close, plus any
-- location capture) atomically, so a partial write — a segment with no
-- session, or a location row orphaned from a failed segment insert — can
-- never happen.
-- ---------------------------------------------------------------------

-- Validates and inserts one attendance_locations row for a segment boundary
-- event, shared by clock_in()/switch_work_segment()/clock_out() — the ONLY
-- call sites, and only ever for a site_work segment's own start/end (see
-- attendance_locations' own doc comment: never continuous tracking, never
-- any other work mode). p_location is the browser geolocation result as
-- jsonb: {latitude, longitude, accuracy_meters, permission_status} — with
-- latitude/longitude/accuracy_meters ignored (stored null) whenever
-- permission_status isn't 'granted'. Permission denial or unavailability
-- never blocks clocking, it just means less evidence, visibly flagged by
-- the absence of a 'granted' row rather than a separate boolean anywhere.
create or replace function record_attendance_location(p_segment_id uuid, p_event text, p_location jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_permission_status text;
begin
  if p_location is null then
    raise exception 'Location status is required for a Site work / Installation clock event, even when permission was denied or unavailable.';
  end if;
  v_permission_status := p_location ->> 'permission_status';
  if v_permission_status not in ('granted', 'denied', 'unavailable', 'timeout') then
    raise exception 'Invalid location permission_status: %', v_permission_status;
  end if;

  insert into attendance_locations (segment_id, event, latitude, longitude, accuracy_meters, permission_status)
  values (
    p_segment_id,
    p_event,
    case when v_permission_status = 'granted' then (p_location ->> 'latitude')::numeric else null end,
    case when v_permission_status = 'granted' then (p_location ->> 'longitude')::numeric else null end,
    case when v_permission_status = 'granted' then (p_location ->> 'accuracy_meters')::numeric else null end,
    v_permission_status
  );
end;
$$;

-- Shared validation for both clock_in()'s and switch_work_segment()'s new
-- segment — kept as one function so the two can never drift apart on what
-- "a valid work mode/project/lead" means.
create or replace function validate_attendance_segment_inputs(p_work_mode text, p_project_name text, p_project_lead_employee_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_work_mode not in ('office', 'wfh', 'site_work', 'client_meeting', 'business_travel') then
    raise exception 'Invalid work mode: %', p_work_mode;
  end if;
  if p_work_mode = 'site_work' and (p_project_name is null or length(trim(p_project_name)) = 0 or p_project_lead_employee_id is null) then
    raise exception 'Site work / Installation requires a project name and a project lead.';
  end if;
  if p_project_lead_employee_id is not null then
    if not same_company(p_project_lead_employee_id) then
      raise exception 'The project lead must be an employee of your own company.';
    end if;
    if not exists (select 1 from employees where id = p_project_lead_employee_id and employment_status = 'active' and deleted_at is null) then
      raise exception 'The project lead must be a currently active employee.';
    end if;
  end if;
end;
$$;

-- Re-derives ONE calendar day's attendance_records row (status/work_mode/
-- hours_worked) from this employee's own attendance_segments, exactly the
-- same "recompute the whole day fresh from every closed segment on file for
-- it" approach sync_attendance_recovery_for_day() already uses for Recovery
-- Leave — so multiple sessions the same day, a mid-shift mode switch, or a
-- later HR correction (hr_close_attendance_session()) can never produce a
-- duplicate row or a drifted hours figure. Deliberately entirely separate
-- from sync_attendance_recovery_for_day(): this function is never called
-- with logic that creates a recovery_credit_requests row, and
-- sync_attendance_recovery_for_day() never touches attendance_records —
-- attendance PRESENCE and Recovery Leave APPROVAL stay two independent
-- concerns fed by the same underlying segments.
--
-- Day-boundary handling matches clock_out()'s own loop exactly: callers
-- always invoke this once per DISTINCT LOCAL date a session's segments
-- touch (via segment_start, never segment_end), so an overnight session
-- naturally produces two correct, separate day rows — one finalized (the
-- start date, once its segments are closed) and one still "Clocked in" (the
-- date the new segment opened on), never one row spanning both.
--
-- Precedence with the manual register (record_attendance_and_recovery()):
-- manual ALWAYS wins, symmetric with that function's own "source = 'manual'
-- is set on BOTH the insert and the conflict branch — the manual register
-- always reasserts manual ownership" rule. This function only ever writes
-- when there is no existing row for the day, the existing row is already
-- source = 'self_clock' (its own prior write), or the existing row is the
-- genuine not-yet-recorded default — any other existing row (a real
-- manual/biometric/import entry, including one HR corrected) is left
-- completely untouched and instead gets presence_conflict set, never
-- silently overwritten.
create or replace function sync_attendance_presence_for_day(p_employee_id uuid, p_work_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country_code text;
  v_tz text;
  v_total_hours numeric;
  v_is_open boolean;
  v_latest_work_mode text;
  v_mapped_work_mode text;
  v_existing attendance_records%rowtype;
begin
  select country_code into v_country_code from employees where id = p_employee_id and deleted_at is null;
  if v_country_code is null then
    return;
  end if;
  v_tz := country_timezone(v_country_code);

  select coalesce(sum(extract(epoch from (segment_end - segment_start))), 0) / 3600.0
  into v_total_hours
  from attendance_segments
  where employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date;

  -- Whether THIS DATE'S OWN segment is still open — segment_end is null is
  -- the authoritative "still open" signal (schema.sql's own check
  -- constraint and its one-open-segment-per-session partial unique index
  -- both key off exactly this), never the overall session's status: a
  -- session stays 'open' as a whole for as long as ANY of its segments is,
  -- which is a different question from whether the specific segment that
  -- started on p_work_date is the one still open (a switch across local
  -- midnight closes the OLD date's own segment while the session as a whole
  -- keeps going into the new date).
  select exists (
    select 1 from attendance_segments s
    where s.employee_id = p_employee_id and s.segment_end is null
      and (s.segment_start at time zone v_tz)::date = p_work_date
  ) into v_is_open;

  select work_mode into v_latest_work_mode
  from attendance_segments
  where employee_id = p_employee_id and (segment_start at time zone v_tz)::date = p_work_date
  order by segment_start desc limit 1;

  if v_latest_work_mode is null then
    return;
  end if;

  v_mapped_work_mode := case v_latest_work_mode
    when 'office' then 'office'
    when 'wfh' then 'work_from_home'
    when 'site_work' then 'client_site'
    when 'client_meeting' then 'field_work'
    when 'business_travel' then 'business_travel'
    else null
  end;

  select * into v_existing from attendance_records
  where employee_id = p_employee_id and work_date = p_work_date
  for update;

  if v_existing.id is not null and v_existing.source <> 'self_clock' and v_existing.status <> 'not_recorded' then
    if v_existing.presence_conflict is null then
      update attendance_records
      set presence_conflict = 'Self-clock activity exists for this day, which was already recorded as ''' || v_existing.status || ''' (source: ' || v_existing.source || '). Not overwritten — review and re-save manually if this should change.'
      where id = v_existing.id;
    end if;
    return;
  end if;

  insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
  values (p_employee_id, p_work_date, 'present', v_mapped_work_mode, case when v_is_open then null else nullif(v_total_hours, 0) end, 'self_clock')
  on conflict (employee_id, work_date) do update
  set status = 'present',
      work_mode = excluded.work_mode,
      hours_worked = excluded.hours_worked,
      source = 'self_clock',
      presence_conflict = null
  where attendance_records.source = 'self_clock' or attendance_records.status = 'not_recorded';
end;
$$;

-- Starts a brand-new attendance session (clock in) for the caller's OWN
-- employee row — current_employee_id(), never a parameter, so an employee
-- can only ever clock themselves in. The partial unique index
-- attendance_sessions_one_open_per_employee is the true, database-level
-- enforcement of "one open session per employee at a time"; the advisory
-- lock below only makes the friendly pre-check race-free, so a
-- double-clicked Clock In (or two open tabs) gets a clear error instead of
-- occasionally racing past the pre-check and hitting a raw unique-violation.
create or replace function clock_in(
  p_work_mode text,
  p_project_name text default null,
  p_project_lead_employee_id uuid default null,
  p_location jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_session_id uuid;
  v_segment_id uuid;
  v_country_code text;
  v_tz text;
  v_work_date date;
begin
  v_employee_id := current_employee_id();
  if v_employee_id is null then
    raise exception 'No employee record is linked to your account.';
  end if;
  if not exists (select 1 from employees where id = v_employee_id and employment_status = 'active' and deleted_at is null) then
    raise exception 'Only an active employee may clock in.';
  end if;

  perform validate_attendance_segment_inputs(p_work_mode, p_project_name, p_project_lead_employee_id);

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || v_employee_id::text));

  if exists (select 1 from attendance_sessions where employee_id = v_employee_id and status = 'open') then
    raise exception 'You are already clocked in. Clock out first.';
  end if;

  insert into attendance_sessions (employee_id) values (v_employee_id) returning id into v_session_id;
  insert into attendance_segments (session_id, employee_id, work_mode, project_name, project_lead_employee_id, segment_start)
  values (v_session_id, v_employee_id, p_work_mode, nullif(trim(p_project_name), ''), p_project_lead_employee_id, now())
  returning id into v_segment_id;

  if p_work_mode = 'site_work' then
    perform record_attendance_location(v_segment_id, 'segment_start', p_location);
  end if;

  select country_code into v_country_code from employees where id = v_employee_id;
  v_tz := country_timezone(v_country_code);
  select (segment_start at time zone v_tz)::date into v_work_date from attendance_segments where id = v_segment_id;
  perform sync_attendance_presence_for_day(v_employee_id, v_work_date);

  return v_session_id;
end;
$$;

-- Changes work mode/project mid-shift WITHOUT ending the overall attendance
-- session — closes the currently open segment and opens a new one in the
-- same session, each preserving its own hours and context (see
-- attendance_sessions' own doc comment). p_closing_location/p_opening_location
-- are independent: either, both, or neither may be required depending on
-- whether the segment being CLOSED and/or the segment being OPENED is
-- site_work (see record_attendance_location()'s own doc comment) — a
-- Site-work-to-Office switch needs only p_closing_location, an
-- Office-to-Site-work switch needs only p_opening_location, and a
-- Site-work-to-Site-work switch (a new project/lead mid-shift) needs both.
create or replace function switch_work_segment(
  p_work_mode text,
  p_project_name text default null,
  p_project_lead_employee_id uuid default null,
  p_closing_location jsonb default null,
  p_opening_location jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_session_id uuid;
  v_old_segment_id uuid;
  v_old_work_mode text;
  v_old_segment_start timestamptz;
  v_new_segment_id uuid;
  v_country_code text;
  v_tz text;
  v_old_work_date date;
  v_new_work_date date;
begin
  v_employee_id := current_employee_id();
  if v_employee_id is null then
    raise exception 'No employee record is linked to your account.';
  end if;

  perform validate_attendance_segment_inputs(p_work_mode, p_project_name, p_project_lead_employee_id);

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || v_employee_id::text));

  select id into v_session_id from attendance_sessions where employee_id = v_employee_id and status = 'open';
  if v_session_id is null then
    raise exception 'You are not currently clocked in.';
  end if;

  select id, work_mode, segment_start into v_old_segment_id, v_old_work_mode, v_old_segment_start
  from attendance_segments where session_id = v_session_id and segment_end is null
  for update;
  if v_old_segment_id is null then
    raise exception 'No open work segment found for your current session.';
  end if;

  update attendance_segments set segment_end = now() where id = v_old_segment_id;
  if v_old_work_mode = 'site_work' then
    perform record_attendance_location(v_old_segment_id, 'segment_end', p_closing_location);
  end if;

  insert into attendance_segments (session_id, employee_id, work_mode, project_name, project_lead_employee_id, segment_start)
  values (v_session_id, v_employee_id, p_work_mode, nullif(trim(p_project_name), ''), p_project_lead_employee_id, now())
  returning id into v_new_segment_id;

  if p_work_mode = 'site_work' then
    perform record_attendance_location(v_new_segment_id, 'segment_start', p_opening_location);
  end if;

  select country_code into v_country_code from employees where id = v_employee_id;
  v_tz := country_timezone(v_country_code);
  v_old_work_date := (v_old_segment_start at time zone v_tz)::date;
  select (segment_start at time zone v_tz)::date into v_new_work_date from attendance_segments where id = v_new_segment_id;
  perform sync_attendance_presence_for_day(v_employee_id, v_old_work_date);
  if v_new_work_date <> v_old_work_date then
    perform sync_attendance_presence_for_day(v_employee_id, v_new_work_date);
  end if;

  return v_new_segment_id;
end;
$$;

-- Ends the whole attendance session (clock out) — closes the currently open
-- segment and the session itself, then re-derives Recovery Leave
-- eligibility (sync_attendance_recovery_for_day(), below) for every LOCAL
-- calendar date this session's segments touch — never just "today", since a
-- segment crossing midnight has a start and end on different local dates,
-- and the mutual-exclusivity overnight rule needs each segment's own local
-- START date to decide which one credits (see that function's own doc
-- comment).
create or replace function clock_out(p_location jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_country_code text;
  v_session_id uuid;
  v_segment_id uuid;
  v_work_mode text;
  v_tz text;
  v_work_date date;
begin
  v_employee_id := current_employee_id();
  if v_employee_id is null then
    raise exception 'No employee record is linked to your account.';
  end if;
  select country_code into v_country_code from employees where id = v_employee_id;

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || v_employee_id::text));

  select id into v_session_id from attendance_sessions where employee_id = v_employee_id and status = 'open' for update;
  if v_session_id is null then
    raise exception 'You are not currently clocked in.';
  end if;

  select id, work_mode into v_segment_id, v_work_mode
  from attendance_segments where session_id = v_session_id and segment_end is null
  for update;
  if v_segment_id is null then
    raise exception 'No open work segment found for your current session.';
  end if;

  update attendance_segments set segment_end = now() where id = v_segment_id;
  if v_work_mode = 'site_work' then
    perform record_attendance_location(v_segment_id, 'segment_end', p_location);
  end if;

  update attendance_sessions set status = 'closed', clock_out_at = now() where id = v_session_id;

  v_tz := country_timezone(v_country_code);
  for v_work_date in
    select distinct (segment_start at time zone v_tz)::date from attendance_segments where session_id = v_session_id
  loop
    perform sync_attendance_presence_for_day(v_employee_id, v_work_date);
    perform sync_attendance_recovery_for_day(v_employee_id, v_work_date);
  end loop;

  return v_session_id;
end;
$$;

-- HR's correction for a forgotten clock-out — the ONLY way an
-- attendance_sessions row is ever closed by anyone other than the employee
-- themselves. p_corrected_clock_out_at is HR's own attested value (there is
-- no server-observed instant for it, unlike every other timestamp in this
-- feature) and is required to be later than both the session's original
-- clock_in_at and the open segment's own segment_start — HR can correct a
-- forgotten clock-out, never rewrite when the shift actually began. The
-- ORIGINAL clock_in_at is never touched; hr_closed_by/hr_closed_at/
-- hr_closed_reason (see attendance_sessions' own doc comment) are purely
-- additive, so an HR-closed session is always visibly distinguishable from
-- one the employee closed themselves, and p_reason is mandatory precisely
-- because this is the one place a clock event's timing is asserted rather
-- than observed.
create or replace function hr_close_attendance_session(
  p_session_id uuid,
  p_corrected_clock_out_at timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_company_id uuid;
  v_country_code text;
  v_clock_in_at timestamptz;
  v_segment_id uuid;
  v_segment_start timestamptz;
  v_tz text;
  v_work_date date;
begin
  select employee_id, clock_in_at into v_employee_id, v_clock_in_at
  from attendance_sessions where id = p_session_id and status = 'open'
  for update;
  if v_employee_id is null then
    raise exception 'Open attendance session not found.';
  end if;

  select company_id, country_code into v_company_id, v_country_code from employees where id = v_employee_id;
  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may close a missing clock-out.';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to close a missing clock-out.';
  end if;
  if p_corrected_clock_out_at is null or p_corrected_clock_out_at <= v_clock_in_at then
    raise exception 'The corrected clock-out time must be after the original clock-in time.';
  end if;

  select id, segment_start into v_segment_id, v_segment_start
  from attendance_segments where session_id = p_session_id and segment_end is null
  for update;
  if v_segment_id is null then
    raise exception 'No open work segment found for this session.';
  end if;
  if p_corrected_clock_out_at <= v_segment_start then
    raise exception 'The corrected clock-out time must be after the current work segment''s own start time.';
  end if;

  update attendance_segments set segment_end = p_corrected_clock_out_at where id = v_segment_id;
  update attendance_sessions
  set status = 'closed', clock_out_at = p_corrected_clock_out_at,
      hr_closed_by = auth.uid(), hr_closed_at = now(), hr_closed_reason = p_reason
  where id = p_session_id;

  -- Re-derive Recovery Leave eligibility for every LOCAL date this session's
  -- segments touch, exactly like clock_out()'s own equivalent step — an
  -- HR-closed session is otherwise indistinguishable from a normal one to
  -- sync_attendance_recovery_for_day().
  v_tz := country_timezone(v_country_code);
  for v_work_date in
    select distinct (segment_start at time zone v_tz)::date from attendance_segments where session_id = p_session_id
  loop
    perform sync_attendance_presence_for_day(v_employee_id, v_work_date);
    perform sync_attendance_recovery_for_day(v_employee_id, v_work_date);
  end loop;
end;
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
-- Standard weekend/public-holiday Recovery Leave credit: a deterministic
-- hour-threshold rule (up to and including 4 active hours worked -> 0.5
-- day, more than 4 -> 1 day, from attendance_records.hours_worked, an
-- existing HR/manager-attested field), needing no country policy
-- configuration at all. Only ever CREATES a recovery_credit_requests row
-- and routes it through create_initial_approval() — the actual earned
-- comp_day_ledger row is posted solely at HR Admin's final approval, inside
-- decide_leave_approval(). needs_policy_review now flags a recovery-eligible
-- day with no hours_worked recorded yet (nothing to derive an amount from,
-- so it's flagged rather than guessed) instead of a missing/misconfigured
-- country policy, which no longer applies to this decision. Working-day/
-- weekend derivation prefers countries.working_weekdays when a country has
-- one configured, falling back to the week_start_day-derived formula
-- otherwise (see preflight_country_schedule_config()).
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
  v_holiday_name text;
  v_is_recovery_day boolean;
  v_record_id uuid;
  v_was_credited comp_day_ledger%rowtype;
  v_existing_request recovery_credit_requests%rowtype;
  v_credit_days numeric;
  v_request_id uuid;
  v_credited boolean;
  v_reversed boolean;
  v_needs_review boolean;
  v_windowed boolean;
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
    -- admins editing the same date) could both read "not yet requested"
    -- before either has committed its insert, and both request it.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_employee_id::text));

    select r.is_recovery_day, r.holiday_name into v_is_recovery_day, v_holiday_name from is_recovery_eligible_day(v_country_code, p_work_date) r;
    v_windowed := exists (select 1 from recovery_windows_policy_for(v_country_code, p_work_date));

    -- One atomic upsert rather than a check-then-branch — the latter has
    -- the same TOCTOU shape as the race bulkRecordAttendance()'s old
    -- "already credited?" check had (two concurrent saves for the same
    -- employee/date, e.g. a double-clicked Save, could otherwise both see
    -- "no existing row" and both attempt an insert).
    -- source = 'manual' is set on BOTH the insert and the conflict branch —
    -- the manual register always reasserts manual ownership of this day.
    insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
    values (v_employee_id, p_work_date, v_status, v_work_mode, v_hours, 'manual')
    on conflict (employee_id, work_date) do update
    set status = excluded.status, work_mode = excluded.work_mode, hours_worked = excluded.hours_worked, source = 'manual', presence_conflict = null
    returning id into v_record_id;

    -- The CURRENTLY ACTIVE credit for this record, if any — an 'earned' row
    -- that hasn't itself already been reversed — and any still-active
    -- (non-cancelled/non-rejected) recovery_credit_requests row.
    select cl.* into v_was_credited from comp_day_ledger cl
    where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
    select r.* into v_existing_request from recovery_credit_requests r
    where r.attendance_record_id = v_record_id and r.status not in ('cancelled', 'rejected');

    if v_windowed and v_status = 'present' then
      -- Under the working-period/24-hour-window policy a manual DAILY total can
      -- never prove gaps, rest or window boundaries, so it never creates a
      -- credit by itself. It is flagged for review instead; Recovery Leave
      -- comes from recorded clock evidence (self-clock, or HR "add missing
      -- attendance" with exact times).
      v_needs_review := coalesce(v_hours, 0) > 0;
    elsif v_is_recovery_day and v_status = 'present' then
      if v_was_credited.id is null and v_existing_request.id is null then
        if v_hours is null then
          v_needs_review := true;
        elsif v_hours > 0 then
          v_credit_days := recovery_credit_days_for_hours(v_hours);
          insert into recovery_credit_requests (employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by)
          values (v_employee_id, v_record_id, p_work_date, 'standard', v_credit_days, auth.uid())
          returning id into v_request_id;
          perform create_initial_approval('recovery_credit', v_request_id);
          v_credited := true;
        end if;
      end if;
    else
      -- No longer an eligible day (corrected away from present, or no
      -- longer a recovery day). Reverse an already-fully-approved credit
      -- via the same linked-reversal pattern as before; ANY still-active
      -- request (submitted, pending_approval, OR already approved) is
      -- cancelled too — never deleted, same append-only convention
      -- cancel_leave_request() uses for approvals — so a later correction
      -- back to present can earn a genuinely fresh request for this day.
      if v_was_credited.id is not null then
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
        values (v_was_credited.employee_id, current_date, 'reversal', -v_was_credited.days, 'holiday_worked', 'attendance_record', v_record_id, v_was_credited.id, auth.uid());
        v_reversed := true;
      end if;
      if v_existing_request.id is not null then
        update recovery_credit_requests set status = 'cancelled', decided_at = now() where id = v_existing_request.id;
        update approvals
        set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, 'Cancelled: attendance record no longer qualifies')
        where entity_type = 'recovery_credit' and entity_id = v_existing_request.id and decision = 'pending';
      end if;
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
-- a second active 'earned' credit for the same attendance record — or, for
-- the newer self-clock path, the same recovery_credit_requests row (see
-- sync_attendance_recovery_for_day()'s own 'recovery_credit_request'
-- reference_type). This trigger makes that a real database invariant:
-- after any 'earned' insert, at most one *unreversed* 'earned' row may
-- reference a given attendance_record OR recovery_credit_request. A plain
-- partial unique index can't express "not yet reversed" (that depends on
-- whether another row's reversal_of_id points at this one, not on this
-- row's own columns), so this is a trigger rather than an index — and it
-- must allow a later, genuine earn-reverse-earn-again cycle to keep
-- working, which a naive unique-on-reference_id index (the one this
-- replaces) did not.
create or replace function guard_comp_day_ledger_single_active_credit()
returns trigger
language plpgsql
as $$
declare
  v_active_count int;
begin
  if new.reference_type in ('attendance_record', 'recovery_credit_request') and new.entry_type = 'earned' then
    select count(*) into v_active_count
    from comp_day_ledger cl
    where cl.reference_type = new.reference_type and cl.reference_id = new.reference_id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
    if v_active_count > 1 then
      raise exception 'An active (unreversed) earned comp-day credit already exists for %', new.reference_id;
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
--
-- recovery_credit_requests.attendance_record_id has no ON DELETE action, so
-- a request referencing this record (at ANY status, including a terminal
-- cancelled/rejected one — it is still workflow history) blocks a physical
-- delete of the parent attendance_records row at the database level. This
-- function REFUSES the physical delete outright whenever any
-- recovery_credit_requests row exists for it, rather than deleting or
-- cascading approvals/recovery_credit_requests to work
-- around the constraint — that would destroy Recovery Leave earning's
-- audit trail. record_attendance_and_recovery() is the correct path for a
-- mistaken/no-longer-eligible day instead: correcting that day's status
-- there already cancels a pending request and reverses an approved credit
-- in place, preserving every row, without ever touching this primary key.
--
-- A comp_day_ledger 'earned' credit with NO recovery_credit_requests row at
-- all can still exist — from the pre-Phase-2b immediate-credit mechanism
-- this migration retires, predating recovery_credit_requests entirely —
-- and is still reversed-then-deleted exactly as before.
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
  v_has_recovery_request boolean;
begin
  select employee_id into v_employee_id from attendance_records where id = p_record_id;
  if v_employee_id is null then
    raise exception 'Attendance record not found';
  end if;

  select company_id into v_company_id from employees where id = v_employee_id;
  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may delete an attendance record';
  end if;

  select exists(select 1 from recovery_credit_requests where attendance_record_id = p_record_id) into v_has_recovery_request;
  if v_has_recovery_request then
    raise exception 'This attendance record has a recovery credit request on file (submitted, approved, or otherwise) and cannot be deleted, to preserve that workflow''s history. Correct the day''s status instead (e.g. mark it absent) via the attendance register — that cancels a pending request or reverses an approved credit in place, without deleting anything.';
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
-- work genuinely continued past midnight). Only ever CREATES a
-- recovery_credit_requests row and routes it through
-- create_initial_approval() — never posts to comp_day_ledger directly; the
-- actual earned row is posted solely at HR Admin's final approval, inside
-- decide_leave_approval().
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
  v_existing_request recovery_credit_requests%rowtype;
  v_credit_days numeric;
  v_request_id uuid;
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
  select r.* into v_existing_request from recovery_credit_requests r
  where r.attendance_record_id = v_record_id and r.status not in ('cancelled', 'rejected');

  if v_was_credited.id is not null or v_existing_request.id is not null then
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

  v_credit_days := recovery_credit_days_for_hours(p_active_hours_after_midnight);

  insert into recovery_credit_requests (employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by)
  values (p_employee_id, v_record_id, p_work_date, 'overnight', v_credit_days, auth.uid())
  returning id into v_request_id;

  perform create_initial_approval('recovery_credit', v_request_id);

  credited := true;
  credit_days := v_credit_days;
  return next;
end;
$$;

-- Computes the 4-tier route a NEW self-clock recovery-credit candidate
-- takes (see recovery_credit_requests.applicant_route's own doc comment for
-- the full table) — hr_admin takes precedence over line_manager when an
-- applicant somehow holds both. Returns null when none of the two
-- role-based routes applies AND no project lead was captured at all — the
-- caller (sync_attendance_recovery_for_day()) treats null as
-- "awaiting_project_lead", never as a route to guess.
create or replace function resolve_recovery_credit_route(p_employee_id uuid, p_project_lead_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id from employees where id = p_employee_id;
  if has_role('hr_admin', v_company_id) then
    return 'hr_admin_ceo_cto_queue';
  elsif has_role('line_manager', v_company_id) then
    return 'manager_hr_direct';
  elsif p_project_lead_employee_id is null then
    return null;
  elsif p_project_lead_employee_id = p_employee_id then
    return 'self_led_hr_direct';
  else
    return 'employee_lead_then_hr';
  end if;
end;
$$;

-- Re-derives Recovery Leave eligibility for one employee/local-calendar-date
-- from ALL attendance_segments whose LOCAL START date is p_work_date — the
-- self-clock counterpart to record_attendance_and_recovery(), following the
-- exact same idempotent-by-full-recompute approach the retired Jibble sync
-- used: never incrementally, always re-derive the WHOLE day fresh from
-- every closed segment on file for it, so calling this twice (or once per
-- segment switch on a multi-segment day) can never produce a duplicate or
-- drifted credit — the unique index recovery_credit_requests_active_per_day
-- is the database-level backstop.
--
-- Mutual exclusivity (never both at once for the same date): if p_work_date
-- ITSELF is a recovery day (weekend/public holiday, is_recovery_eligible_day()),
-- the FULL duration of every segment starting that date counts once, as
-- 'standard' — Office and WFH now qualify exactly like Site work, per this
-- redesign (never restricted to Site work / Installation). Otherwise
-- (p_work_date is an ordinary working day) only the portion of a segment
-- that falls AFTER local midnight — a shift that genuinely continues into
-- the next calendar day — counts, as 'overnight'. Which branch applies is a
-- pure function of is_recovery_eligible_day(p_work_date), decided once per
-- call, so a day can never credit under both.
--
-- Business travel is never auto-credited (its policy is deliberately
-- undefined — see attendance_segments.work_mode's own check) but is never
-- excluded from the hour total either, since there is no principled way to
-- separate transit time from working time after the fact; a day touching
-- any business_travel segment is instead always flagged (needs_policy_review)
-- for HR's own judgment call, whichever way the credit otherwise falls out.
--
-- Only ever CREATES a request (idempotent no-op if one is already active
-- for this employee/date — adjust_recovery_credit_request() is HR's tool
-- for changing it afterward, never this function) or REVERSES one whose day
-- no longer qualifies (segments changed since a prior sync) — exactly
-- record_attendance_and_recovery()'s own two-sided shape. Never itself
-- posts the comp_day_ledger credit; that stays solely decide_leave_approval()'s
-- job, at final approval. Routing failures (e.g. a named project lead with
-- no HR Engine account) are caught and recorded as routing_issue rather
-- than raised — this function runs INSIDE clock_out()'s own transaction,
-- and a routing problem must never fail the employee's clock-out itself.
create or replace function sync_attendance_recovery_for_day(p_employee_id uuid, p_work_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country_code text;
  v_tz text;
  v_is_recovery_day boolean;
  v_holiday_name text;
  v_total_hours numeric;
  v_overnight_hours numeric;
  v_has_business_travel boolean;
  v_local_next_midnight timestamptz;
  v_distinct_site_leads int;
  v_anchor_segment_id uuid;
  v_anchor_work_mode text;
  v_anchor_project_name text;
  v_anchor_project_lead_employee_id uuid;
  v_event_type text;
  v_hours numeric;
  v_existing recovery_credit_requests%rowtype;
  v_was_credited comp_day_ledger%rowtype;
  v_credit_days numeric;
  v_request_id uuid;
  v_applicant_route text;
  v_needs_policy_review boolean;
begin
  select country_code into v_country_code from employees where id = p_employee_id and deleted_at is null;
  if v_country_code is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  -- Same advisory lock record_attendance_and_recovery() takes before
  -- touching an employee's comp-day balance, for the same reason: without
  -- it, two concurrent syncs for this employee/day (e.g. two clock-outs
  -- racing, or a clock-out racing a later HR correction) could both read
  -- "not yet requested" before either has committed its insert.
  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  v_tz := country_timezone(v_country_code);
  select r.is_recovery_day, r.holiday_name into v_is_recovery_day, v_holiday_name from is_recovery_eligible_day(v_country_code, p_work_date) r;
  v_local_next_midnight := ((p_work_date + 1)::timestamp) at time zone v_tz;

  select
    coalesce(sum(extract(epoch from (segment_end - segment_start))), 0) / 3600.0,
    coalesce(sum(greatest(extract(epoch from (segment_end - v_local_next_midnight)), 0)), 0) / 3600.0,
    coalesce(bool_or(work_mode = 'business_travel'), false)
  into v_total_hours, v_overnight_hours, v_has_business_travel
  from attendance_segments
  where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
    and employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date;

  select count(distinct project_lead_employee_id) into v_distinct_site_leads
  from attendance_segments
  where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
    and employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date
    and work_mode = 'site_work';

  v_event_type := case when v_is_recovery_day then 'standard' else 'overnight' end;
  v_hours := case when v_is_recovery_day then v_total_hours else v_overnight_hours end;

  select * into v_existing from recovery_credit_requests
  where employee_id = p_employee_id and work_date = p_work_date and segment_id is not null
    and event_type in ('standard', 'overnight')
    and status not in ('cancelled', 'rejected')
  for update;

  if v_hours is null or v_hours <= 0 then
    -- No longer a qualifying day (segments changed since a prior sync, or
    -- there was never anything here) — reverse an already-approved credit
    -- and cancel any still-active request, exactly the same
    -- never-delete-only-reverse shape record_attendance_and_recovery() uses
    -- for its own "no longer eligible" branch.
    if v_existing.id is not null then
      select cl.* into v_was_credited from comp_day_ledger cl
      where cl.reference_type = 'recovery_credit_request' and cl.reference_id = v_existing.id and cl.entry_type = 'earned'
        and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);
      if v_was_credited.id is not null then
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
        values (v_was_credited.employee_id, current_date, 'reversal', -v_was_credited.days, 'holiday_worked', 'recovery_credit_request', v_existing.id, v_was_credited.id, auth.uid());
      end if;
      update recovery_credit_requests set status = 'cancelled', decided_at = now() where id = v_existing.id;
      update approvals
      set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, 'Cancelled: attendance no longer qualifies')
      where entity_type = 'recovery_credit' and entity_id = v_existing.id and decision = 'pending';
    end if;
    return;
  end if;

  if v_existing.id is not null then
    return;
  end if;

  -- Anchor segment for the routing/evidence snapshot: prefer the earliest
  -- site_work segment (its project/lead are always populated, by that
  -- table's own check constraint); otherwise the earliest segment that
  -- captured ANY lead (an Office/WFH segment where one was supplied though
  -- not required); otherwise just the earliest segment of the day.
  -- v_distinct_site_leads > 1 (checked below) flags, never guesses, the
  -- case where today's site_work segments name more than one DISTINCT
  -- lead.
  select id, work_mode, project_name, project_lead_employee_id
  into v_anchor_segment_id, v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id
  from attendance_segments
  where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
    and employee_id = p_employee_id and segment_end is not null
    and (segment_start at time zone v_tz)::date = p_work_date
    and work_mode = 'site_work'
  order by segment_start asc limit 1;

  if v_anchor_segment_id is null then
    select id, work_mode, project_name, project_lead_employee_id
    into v_anchor_segment_id, v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id
    from attendance_segments
    where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
      and employee_id = p_employee_id and segment_end is not null
      and (segment_start at time zone v_tz)::date = p_work_date
      and project_lead_employee_id is not null
    order by segment_start asc limit 1;
  end if;

  if v_anchor_segment_id is null then
    select id, work_mode, project_name, project_lead_employee_id
    into v_anchor_segment_id, v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id
    from attendance_segments
    where session_id in (select id from attendance_sessions where employee_id = p_employee_id and recovery_model = 'legacy')
      and employee_id = p_employee_id and segment_end is not null
      and (segment_start at time zone v_tz)::date = p_work_date
    order by segment_start asc limit 1;
  end if;

  v_needs_policy_review := v_has_business_travel or v_distinct_site_leads > 1;
  v_credit_days := recovery_credit_days_for_hours(v_hours);
  v_applicant_route := resolve_recovery_credit_route(p_employee_id, v_anchor_project_lead_employee_id);

  insert into recovery_credit_requests (
    employee_id, segment_id, work_date, event_type, proposed_days, created_by,
    work_mode, project_name, project_lead_employee_id, applicant_route, awaiting_project_lead, needs_policy_review
  )
  values (
    p_employee_id, v_anchor_segment_id, p_work_date, v_event_type, v_credit_days, auth.uid(),
    v_anchor_work_mode, v_anchor_project_name, v_anchor_project_lead_employee_id, v_applicant_route,
    v_applicant_route is null, v_needs_policy_review
  )
  returning id into v_request_id;

  if v_applicant_route is not null then
    begin
      perform create_initial_approval('recovery_credit', v_request_id);
    exception when others then
      update recovery_credit_requests set routing_issue = sqlerrm where id = v_request_id;
    end;
  end if;
end;
$$;

-- HR's correction step, made on the approval screen BEFORE deciding — never
-- combined into the decision itself, so HR can save a correction, come
-- back later, and still decide (or hand it to another HR Admin) without
-- re-entering it. Locks (and requires 'pending') the SAME approval row
-- decide_recovery_credit_request()/decide_leave_approval() lock, so an
-- adjustment can never race a concurrent decision into inconsistent state.
-- Requires a non-empty p_correction_reason whenever work_date or the
-- resulting proposed_days actually changes (re-saving identical values, or
-- only setting checked_with, is not "a correction"); recomputes
-- proposed_days from p_corrected_hours via recovery_credit_days_for_hours()
-- SERVER-SIDE — the client never gets to assert a day count directly.
-- Company isolation and role enforcement both come from has_role() below,
-- not from RLS (this is SECURITY DEFINER, like every other approval-engine
-- mutator) — company_id is resolved from the request's own employee, never
-- trusted from the caller.
create or replace function adjust_recovery_credit_request(
  p_request_id uuid,
  p_corrected_work_date date,
  p_corrected_hours numeric,
  p_correction_reason text,
  p_checked_with text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request recovery_credit_requests%rowtype;
  v_company_id uuid;
  v_approval_id uuid;
  v_approval_decision approval_decision;
  v_new_days numeric;
  v_changed boolean;
begin
  -- Locks approvals BEFORE recovery_credit_requests, in that order — the
  -- same order decide_leave_approval() locks them in (its own entity-table
  -- "for update" happens after it has already locked approvals). Taking
  -- them in a consistent order everywhere is what makes a concurrent
  -- adjust-vs-decide race on the same request block and serialize cleanly
  -- instead of ever deadlocking each other.
  select a.id, a.decision into v_approval_id, v_approval_decision
  from approvals a where a.entity_type = 'recovery_credit' and a.entity_id = p_request_id
  order by a.step_order desc limit 1
  for update;
  if v_approval_id is null then
    raise exception 'No approval found for this recovery credit request.';
  end if;
  if v_approval_decision is distinct from 'pending' then
    raise exception 'This request has already been decided and can no longer be adjusted.';
  end if;

  select * into v_request from recovery_credit_requests where id = p_request_id for update;
  if not found then
    raise exception 'Recovery credit request not found.';
  end if;
  if v_request.event_type in ('window', 'window_top_up', 'window_reduction') then
    raise exception 'A window-based Recovery Leave request is calculated from the attendance evidence and cannot be overridden by typing hours. Correct the attendance evidence (HR attendance edit); the request is recalculated and the change is recorded with the original and corrected values.';
  end if;

  select company_id into v_company_id from employees where id = v_request.employee_id;
  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may adjust a recovery credit request.';
  end if;

  if p_corrected_work_date is null or p_corrected_hours is null then
    raise exception 'A work date and hours are both required.';
  end if;
  if p_corrected_hours <= 0 then
    raise exception 'Hours must be greater than zero.';
  end if;

  v_new_days := recovery_credit_days_for_hours(p_corrected_hours);
  v_changed := p_corrected_work_date is distinct from v_request.work_date or v_new_days is distinct from v_request.proposed_days;

  if v_changed and (p_correction_reason is null or length(trim(p_correction_reason)) = 0) then
    raise exception 'A reason is required when correcting the work date or hours.';
  end if;

  update recovery_credit_requests
  set work_date = p_corrected_work_date,
      proposed_days = v_new_days,
      correction_reason = case when v_changed then p_correction_reason else correction_reason end,
      checked_with = coalesce(p_checked_with, checked_with),
      corrected_by = case when v_changed then auth.uid() else corrected_by end,
      corrected_at = case when v_changed then now() else corrected_at end
  where id = p_request_id;

  -- A MATERIAL correction to an 'employee_lead_then_hr' request whose lead
  -- has ALREADY approved (i.e. it has advanced to step 2, HR) requires a
  -- RENEWED lead approval before final credit — resetting step 1 back to
  -- pending is what does that. decide_leave_approval()'s own step-2
  -- authorization check (approvals.queue_roles' own doc comment) already
  -- refuses to let HR decide step 2 again until step 1 is re-approved, so
  -- no separate lock on step 2 is needed here.
  if v_changed and v_request.applicant_route = 'employee_lead_then_hr' then
    update approvals
    set decision = 'pending', decided_at = null,
        comments = coalesce(comments || ' — ', '') || 'Reset for renewed approval after an HR correction: ' || p_correction_reason
    where entity_type = 'recovery_credit' and entity_id = p_request_id and step_order = 1 and decision = 'approved';
  end if;
end;
$$;

-- HR's decision on a Recovery Leave credit — a dedicated entry point (never
-- a bare decide_leave_approval() call from the client) specifically so
-- "record whom they checked with" is enforced for an APPROVAL (the product
-- brief: HR must have verified the work with the relevant project lead
-- outside the application before crediting anything) without adding
-- recovery_credit-only parameters to the shared decide_leave_approval()
-- used by five other entity types. Delegates the actual state transition —
-- authorization, the row lock, ledger posting exactly once — to
-- decide_leave_approval() itself, inside the SAME transaction, so there is
-- exactly one implementation of "how a recovery credit gets approved."
--
-- Only for the step where HR is deciding — the 'employee_lead_then_hr'
-- route's OWN step 1 (the lead's decision) goes through plain
-- decide_leave_approval() directly instead (see approvals_select's own doc
-- comment on how a person-specific approver_id step is surfaced to them),
-- never through this function.
create or replace function decide_recovery_credit_request(
  p_request_id uuid,
  p_decision approval_decision,
  p_checked_with text,
  p_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval_id uuid;
  v_applicant_route text;
  v_checked_with_required boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be ''approved'' or ''rejected''';
  end if;

  -- Ordinarily at most one step is ever 'pending' at a time, so asc vs desc
  -- makes no difference. The one exception is exactly the case
  -- adjust_recovery_credit_request()'s "renewed lead approval" comment
  -- describes: a material correction on an already-lead-approved
  -- 'employee_lead_then_hr' request resets step 1 back to 'pending' WITHOUT
  -- touching step 2 (already created, still 'pending' from the earlier
  -- advance) -- both steps are pending at once. asc picks the EARLIEST
  -- pending step, i.e. the one actually blocking progress (the lead's own
  -- renewed decision) -- desc would instead resolve to step 2 every time,
  -- permanently misrouting the lead's own decide_recovery_credit_request()
  -- call into HR's step (which their role can never satisfy) and making
  -- the renewed-approval path unreachable through the real UI, which never
  -- calls this by anything but p_request_id.
  select a.id into v_approval_id
  from approvals a
  where a.entity_type = 'recovery_credit' and a.entity_id = p_request_id and a.decision = 'pending'
  order by a.step_order asc limit 1;
  if v_approval_id is null then
    raise exception 'No pending approval found for this recovery credit request.';
  end if;

  select applicant_route into v_applicant_route from recovery_credit_requests where id = p_request_id;

  -- "Checked with" is mandatory only where HR is the SOLE/DIRECT decision
  -- maker (the legacy queue [applicant_route null], and the self-clock
  -- manager_hr_direct/self_led_hr_direct/hr_admin_ceo_cto_queue routes,
  -- which none of have a lead step at all) — 'employee_lead_then_hr' is
  -- the one exception: its own step 2 (this HR decision) already has the
  -- product brief's underlying concern ("HR must have verified the work
  -- with the relevant project lead outside the application first")
  -- satisfied IN-APP, as a real approval-chain step, so re-asking HR to
  -- also record who they checked with here would just be redundant
  -- box-ticking.
  v_checked_with_required := v_applicant_route is distinct from 'employee_lead_then_hr';
  if p_decision = 'approved' and v_checked_with_required and (p_checked_with is null or length(trim(p_checked_with)) = 0) then
    raise exception 'Record whom you checked this work with before approving.';
  end if;

  if p_checked_with is not null and length(trim(p_checked_with)) > 0 then
    update recovery_credit_requests set checked_with = p_checked_with where id = p_request_id;
  end if;

  perform decide_leave_approval(v_approval_id, p_decision, p_comments);
end;
$$;

-- Supplies the missing project lead for a self-clock candidate that
-- synced as 'employee_lead_then_hr'-shaped (ordinary employee, not
-- self-led) but never captured one — Office/WFH work only requires a lead
-- "when relevant" (see attendance_segments' own check), so this is a real,
-- expected gap, never an error. Completes routing in the SAME transaction
-- as setting the lead: recovery_credit_requests.applicant_route is null and
-- awaiting_project_lead is true until this runs, and no approvals row
-- exists at all until it does (see sync_attendance_recovery_for_day()'s own
-- doc comment) — "collect them before routing, never guess the approver or
-- discard the candidate." Callable by the employee themselves (supplying
-- their own missing lead) or by HR Admin acting on their behalf — either
-- way is_entity_owner()'s recovery_credit branch already covers who may
-- act on this request.
create or replace function resolve_recovery_credit_project_lead(p_request_id uuid, p_project_lead_employee_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request recovery_credit_requests%rowtype;
  v_applicant_route text;
begin
  select * into v_request from recovery_credit_requests where id = p_request_id for update;
  if not found then
    raise exception 'Recovery credit request not found.';
  end if;
  if not v_request.awaiting_project_lead then
    raise exception 'This request is not awaiting a project lead.';
  end if;
  if not is_entity_owner('recovery_credit', p_request_id) then
    raise exception 'You do not own this recovery_credit (or it does not exist)';
  end if;

  if p_project_lead_employee_id is null then
    raise exception 'A project lead is required.';
  end if;
  if not same_company(p_project_lead_employee_id) then
    raise exception 'The project lead must be an employee of your own company.';
  end if;
  if not exists (select 1 from employees where id = p_project_lead_employee_id and employment_status = 'active' and deleted_at is null) then
    raise exception 'The project lead must be a currently active employee.';
  end if;

  v_applicant_route := resolve_recovery_credit_route(v_request.employee_id, p_project_lead_employee_id);
  if v_applicant_route is null then
    -- resolve_recovery_credit_route() only ever returns null when NO lead
    -- was given at all — unreachable here since p_project_lead_employee_id
    -- was just required above, kept as a hard stop rather than silently
    -- routing nowhere.
    raise exception 'Could not resolve a routing decision for this project lead.';
  end if;

  update recovery_credit_requests
  set project_lead_employee_id = p_project_lead_employee_id, applicant_route = v_applicant_route, awaiting_project_lead = false
  where id = p_request_id;

  begin
    perform create_initial_approval('recovery_credit', p_request_id);
  exception when others then
    update recovery_credit_requests set routing_issue = sqlerrm where id = p_request_id;
  end;

  return p_request_id;
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
-- terminate_employee()'s own status-change-plus-forfeiture transaction is
-- untouched — invoked back-to-back within one Server Action call, rather
-- than forcing a single cross-language transaction.
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

-- Wraps the termination status transition AND the forfeiture into one
-- transaction, so forfeiture can never be skipped by mistake — it must be
-- part of the authorised termination transaction, not an optional separate
-- call HR can forget. Only ever touches employees.employment_status/
-- termination_date and comp_day_ledger; never leave_ledger, so payable
-- Annual Leave is unaffected and still settled separately (see
-- post_poland_termination_leave_adjustment above for Poland's own,
-- deliberately separate leave_ledger true-up).
create or replace function terminate_employee(p_employee_id uuid, p_termination_date date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id from employees where id = p_employee_id and deleted_at is null;
  if v_company_id is null then
    raise exception 'Employee % not found', p_employee_id;
  end if;

  if not has_role('hr_admin', v_company_id) then
    raise exception 'Only HR Admin may terminate an employee';
  end if;

  update employees
  set employment_status = 'terminated', termination_date = p_termination_date, updated_at = now(), updated_by = auth.uid()
  where id = p_employee_id;

  perform forfeit_recovery_leave_on_termination(p_employee_id);
end;
$$;

-- Read-only. For each of AE/SA/PL and each of leave_rules/overtime_rules,
-- reports every existing policy_versions row's version numbers/statuses,
-- the next free version_no, whether a Phase 2b draft (tagged via the
-- 'phase2b_seed_marker' payload key) has already been seeded, and how many
-- 2026 public holidays already exist — everything an operator needs to
-- review before calling seed_phase2b_policy_drafts() below.
create or replace function preflight_policy_and_holiday_conflicts()
returns table(
  country_code text,
  policy_type text,
  existing_version_numbers int[],
  existing_statuses text[],
  next_free_version_no int,
  already_seeded_by_this_migration boolean,
  holiday_count_2026 bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cc.code,
    pt.policy_type,
    coalesce((select array_agg(pv.version_no order by pv.version_no) from policy_versions pv where pv.country_code = cc.code and pv.policy_type::text = pt.policy_type), array[]::int[]),
    coalesce((select array_agg(distinct pv.status::text) from policy_versions pv where pv.country_code = cc.code and pv.policy_type::text = pt.policy_type), array[]::text[]),
    coalesce((select max(pv.version_no) from policy_versions pv where pv.country_code = cc.code and pv.policy_type::text = pt.policy_type), 0) + 1,
    exists (
      select 1 from policy_versions pv
      where pv.country_code = cc.code and pv.policy_type::text = pt.policy_type
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ),
    (select count(*) from public_holidays ph where ph.country_code = cc.code and ph.holiday_date between '2026-01-01' and '2026-12-31')
  from (values ('AE'), ('SA'), ('PL')) as cc(code)
  cross join (values ('leave_rules'), ('overtime_rules')) as pt(policy_type)
  order by cc.code, pt.policy_type;
$$;

-- Creates the Phase 2b Annual Leave (leave_rules v-next) and Recovery Leave
-- (overtime_rules v-next) draft policies for AE/SA/PL. Requires a REAL,
-- verified actor — never an unattributed placeholder — and never overwrites
-- an existing draft or active policy: it always computes the next free
-- version_no from what is actually in the database at call time, and it is
-- safely repeatable (a second call detects its own prior run per country/
-- policy_type via the 'phase2b_seed_marker' payload tag and skips rather
-- than creating a duplicate version). Not applied automatically by any
-- migration; an authenticated HR Admin (or whoever is setting up the
-- project) calls `select * from seed_phase2b_policy_drafts(auth.uid());`
-- explicitly, after reviewing preflight_policy_and_holiday_conflicts().
create or replace function seed_phase2b_policy_drafts(p_created_by uuid)
returns table(country_code text, policy_type text, version_no int, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
  v_leave_version_no int;
  v_overtime_version_no int;
  v_leave_version_id uuid;
  v_already_seeded boolean;
  v_deduction_mode text;
  v_extend_for_holidays boolean;
  v_annual_name text;
  v_annual_accrual_method text;
  v_annual_max_balance numeric;
  v_annual_carryover_max numeric;
  v_annual_carryover_expiry_months int;
begin
  if p_created_by is null then
    raise exception 'seed_phase2b_policy_drafts requires a real authenticated actor id (p_created_by) — refusing to create policy drafts with no attributable owner.';
  end if;
  if not exists (select 1 from auth.users where id = p_created_by) then
    raise exception 'p_created_by (%) does not correspond to a real auth.users row.', p_created_by;
  end if;

  foreach v_country in array array['AE', 'SA', 'PL']
  loop
    select exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'leave_rules'
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ) into v_already_seeded;

    if v_already_seeded then
      country_code := v_country; policy_type := 'leave_rules'; version_no := null; action := 'skipped_already_seeded';
      return next;
    else
      select coalesce(max(pv.version_no), 0) + 1 into v_leave_version_no
      from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'leave_rules';

      v_deduction_mode := case v_country when 'PL' then 'workingDays' else 'calendarDays' end;
      v_extend_for_holidays := (v_country = 'SA');
      v_annual_name := case v_country when 'PL' then 'Annual leave (urlop wypoczynkowy)' else 'Annual leave' end;
      v_annual_accrual_method := case v_country when 'PL' then 'annual_grant' else 'per_service_year' end;
      v_annual_max_balance := case v_country when 'PL' then 26 else 90 end;
      v_annual_carryover_max := case v_country when 'PL' then 20 else 30 end;
      v_annual_carryover_expiry_months := case v_country when 'PL' then 9 else 12 end;

      insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
      values (
        v_country, 'leave_rules', v_leave_version_no, '2026-01-01',
        jsonb_build_object(
          'phase2b_seed_marker', 'leave_policy_configuration',
          'summary', case v_country
            when 'AE' then 'UAE Annual Leave: 30 calendar days per completed year; 2 calendar days per completed month after 6 months but before 1 year. Calendar-day deduction. Sequential approval: Line Manager then HR Admin. No deduction until the full chain approves.'
            when 'SA' then 'Saudi Annual Leave: 21 calendar days/year under five consecutive years of service, 30 calendar days/year from the fifth year onward. Calendar-day deduction; an official holiday inside the leave period extends it rather than consuming a leave day. Sequential approval: Line Manager then HR Admin. Unused legally accrued leave is paid on termination using the statutory Saudi wage basis, not forced onto a basic-salary-only calculation.'
            when 'PL' then 'Poland Annual Leave: 20 working days/year under 10 years of legally recognised service (actual tenure plus any HR-recognised prior service/education), 26 working days/year at 10+ years; prorated for part-time by contract FTE fraction. Deducted against scheduled working time (1 day = 8 hours). A first-time employee accrues 1/12 of the annual entitlement per completed month. Sequential approval: Line Manager then HR Admin. Unused leave payable on termination uses Poland''s statutory pecuniary-equivalent calculation, not a UAE-style basic-salary rule.'
          end,
          'settlement', 'Enginious settles unused Annual Leave upon resignation, termination or contract expiry using the employee''s basic salary where legally permitted. Where mandatory local law requires another wage basis or statutory calculation, the legally required method applies.',
          'deduction_mode', v_deduction_mode,
          'extend_for_holidays', v_extend_for_holidays,
          'first_year_monthly_accrual_fraction', case when v_country = 'PL' then 0.0833 else null end
        ),
        p_created_by
      )
      returning id into v_leave_version_id;

      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method, max_balance_days, carryover_max_days, carryover_expiry_months, min_service_days_to_accrue)
      values
        (v_leave_version_id, 'annual', v_annual_name, v_annual_accrual_method, v_annual_max_balance, v_annual_carryover_max, v_annual_carryover_expiry_months, 0),
        (v_leave_version_id, 'recovery', 'Recovery Leave', 'annual_grant', null, 0, null, 0);

      country_code := v_country; policy_type := 'leave_rules'; version_no := v_leave_version_no; action := 'created';
      return next;
    end if;

    select exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'overtime_rules'
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ) into v_already_seeded;

    if v_already_seeded then
      country_code := v_country; policy_type := 'overtime_rules'; version_no := null; action := 'skipped_already_seeded';
      return next;
    else
      select coalesce(max(pv.version_no), 0) + 1 into v_overtime_version_no
      from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'overtime_rules';

      insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
      values (
        v_country, 'overtime_rules', v_overtime_version_no, '2026-01-01',
        jsonb_build_object(
          'phase2b_seed_marker', 'leave_policy_configuration',
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
        p_created_by
      );

      country_code := v_country; policy_type := 'overtime_rules'; version_no := v_overtime_version_no; action := 'created';
      return next;
    end if;
  end loop;
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

  -- Recovery Leave earning: ONE HR decision — a company-scoped role queue
  -- (any current HR Admin in the company may decide it; see
  -- approval_workflow_steps.approver_type's 'role_queue:hr_admin' doc
  -- comment and decide_leave_approval()'s null-approver_id branch), not a
  -- manager-then-HR chain and not a single specific assigned person. A
  -- potential credit (from the manual attendance register or, for the
  -- employee self-clock path, the applicant's own routed approval chain —
  -- see recovery_credit_requests.applicant_route) goes to this queue for
  -- the routes that terminate at HR; HR checks the work with the relevant
  -- project lead outside the application before deciding — its own insert,
  -- outside the loop above, since every other entity type there has
  -- exactly one step too, but resolves it very differently.
  insert into approval_workflows (company_id, entity_type, name)
  values (new.id, 'recovery_credit', 'Recovery Leave earning approval (HR)')
  returning id into v_workflow_id;

  insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
    (v_workflow_id, 1, 'role_queue:hr_admin');

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
    when 'recovery_credit' then
      -- Manager/HR-initiated on the employee's behalf, or the employee's
      -- OWN self-clock session (see attendance_segments' doc comment) —
      -- either way "owner" means created_by = auth.uid(), same
      -- "owner = initiator" pattern generated_letter/payroll_export_run use
      -- via generated_by. HR Admin is ALSO always a legitimate owner for
      -- their own company's requests: HR may need to route a request an
      -- EMPLOYEE self-clocked and created (e.g. resolve_recovery_credit_
      -- project_lead(), when a candidate was missing a project lead at
      -- clock-in time) — HR already has full visibility and authority over
      -- every recovery_credit_requests row in their company via that
      -- table's own RLS select policy, so this never grants anything HR
      -- couldn't already see or ultimately decide.
      return exists (
        select 1 from recovery_credit_requests r join employees e on e.id = r.employee_id
        where r.id = p_entity_id and (
          r.created_by = auth.uid()
          or has_role('hr_admin', e.company_id)
          -- Window requests are created by the engine (system authority), so the
          -- employee they benefit is also their rightful owner — needed for the
          -- employee to supply a missing project lead.
          or (r.event_type in ('window', 'window_top_up', 'window_reduction') and r.employee_id = current_employee_id())
        )
      );
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
  v_self_check_user_id uuid;
  v_applicant_route text;
  v_project_lead_employee_id uuid;
begin
  -- Every recovery_credit row is now created under a real logged-in user
  -- session — the employee's own session for a self-clock candidate (see
  -- attendance_segments' doc comment), or the acting HR Admin/manager's
  -- session for the legacy manual/overnight paths — so is_entity_owner()'s
  -- created_by = auth.uid() check applies uniformly, with no service-role,
  -- no-session exception needed. (is_entity_owner()'s own recovery_credit
  -- branch ALSO accepts any HR Admin of the request's company — needed for
  -- resolve_recovery_credit_project_lead() below, which routes a self-clock
  -- request an EMPLOYEE created after HR supplies its missing lead.)
  if not is_entity_owner(p_entity_type, p_entity_id) then
    raise exception 'You do not own this % (or it does not exist)', p_entity_type;
  end if;

  -- Idempotent under concurrent double-submission — moved up front so it
  -- covers the new self-clock route-driven branch below the same way as
  -- the legacy workflow-driven path further down (see that path's own doc
  -- comment on reimbursement claims/timesheets/payroll runs).
  select id into v_approval_id from approvals
  where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
  if v_approval_id is not null then
    return v_approval_id;
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
  elsif p_entity_type = 'recovery_credit' then
    select e.company_id, r.employee_id, r.applicant_route, r.project_lead_employee_id
    into v_company_id, v_employee_id, v_applicant_route, v_project_lead_employee_id
    from recovery_credit_requests r join employees e on e.id = r.employee_id where r.id = p_entity_id;
  else
    raise exception 'Unsupported entity type: %', p_entity_type;
  end if;

  -- NEW self-clock 4-tier routing (recovery_credit_requests.applicant_route
  -- is set — see that column's own doc comment) — bypasses
  -- approval_workflows/approval_workflow_steps entirely: the four routes
  -- have different total step counts and different step_order meanings,
  -- which doesn't fit the single company-wide workflow the generic engine
  -- below otherwise assumes. The LEGACY attendance_record_id-anchored
  -- recovery_credit family (applicant_route null) falls through to that
  -- same generic engine completely unchanged.
  if p_entity_type = 'recovery_credit' and v_applicant_route is not null then
    select user_id into v_self_check_user_id from employees where id = v_employee_id;

    if v_applicant_route = 'employee_lead_then_hr' then
      select user_id into v_approver_id from employees where id = v_project_lead_employee_id;
      if v_approver_id is null then
        raise exception 'The named project lead has no HR Engine account to approve with. Contact HR Admin.';
      end if;
      -- Defense in depth — resolve_recovery_credit_route() only ever
      -- returns this route when the lead is NOT the applicant themselves,
      -- so this should be unreachable in practice.
      if v_approver_id = v_self_check_user_id then
        raise exception 'The resolved project lead is you — this should have routed to self_led_hr_direct instead. Contact HR Admin.';
      end if;
      begin
        insert into approvals (entity_type, entity_id, step_order, approver_id, decision)
        values (p_entity_type, p_entity_id, 1, v_approver_id, 'pending')
        returning id into v_approval_id;
      exception when unique_violation then
        select id into v_approval_id from approvals where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
      end;
    else
      -- Single-step queue routes: manager_hr_direct/self_led_hr_direct go
      -- to any current hr_admin; hr_admin_ceo_cto_queue goes to either a
      -- ceo or a cto (approvals.queue_roles' own doc comment — the
      -- existing row-lock-plus-pending-check every decision already takes
      -- is what makes "whoever decides first wins" hold here too).
      begin
        insert into approvals (entity_type, entity_id, step_order, queue_roles, decision)
        values (
          p_entity_type, p_entity_id, 1,
          case v_applicant_route when 'hr_admin_ceo_cto_queue' then array['ceo', 'cto']::app_role[] else array['hr_admin']::app_role[] end,
          'pending'
        )
        returning id into v_approval_id;
      exception when unique_violation then
        select id into v_approval_id from approvals where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
      end;
    end if;

    return v_approval_id;
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

  if v_approver_type like 'role_queue:%' then
    -- Company-scoped role queue (currently only recovery_credit's single
    -- HR step) — no single resolved approver_id; ANY current holder of
    -- this role in the company may later decide it (see
    -- decide_leave_approval()'s own null-approver_id authorization branch).
    -- Still hard-stops here if literally no one currently holds the role,
    -- for the same "never create an unroutable approval" reason every
    -- other branch below does.
    if not exists (
      select 1 from user_roles ur
      where ur.role = replace(v_approver_type, 'role_queue:', '')::app_role
        and ur.revoked_at is null
        and (ur.company_id is null or ur.company_id = v_company_id)
        and not exists (
          select 1 from employees e2
          where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
        )
    ) then
      raise exception 'No approver could be resolved (no one currently holds the "%" role in your company). Contact Sys Admin.', replace(v_approver_type, 'role_queue:', '');
    end if;
    v_approver_id := null;
  else
    if p_entity_type = 'payroll_export_run' then
      v_approver_id := resolve_approver_for_company(v_approver_type, v_company_id);
    else
      v_approver_id := resolve_approver(v_approver_type, v_employee_id);
    end if;
    if v_approver_id is null then
      raise exception 'No approver could be resolved (e.g. no manager assigned, or no one holds the required role). Contact HR Admin.';
    end if;

    -- Self-approval prevention for step 1 — decide_leave_approval() already
    -- refuses to route any LATER step back to the requester; this is the
    -- same check for the first step, which that function never sees.
    -- Compares against the ENTITY's own beneficiary, not always the
    -- caller: every other entity type is self-submitted (the caller IS the
    -- requester, so auth.uid() is correct), but recovery_credit is
    -- manager/HR-initiated ON BEHALF OF the employee — the direct manager
    -- routinely is both the one recording eligibility AND the resolved
    -- step-1 approver for their own report, which is never "self-approval"
    -- (they aren't approving their OWN leave). Only block if the resolved
    -- approver equals the beneficiary. A role_queue step has no single
    -- resolved approver to compare here at all — its own self-decision
    -- block instead happens at decision time, in decide_leave_approval().
    if p_entity_type = 'recovery_credit' then
      select user_id into v_self_check_user_id from employees where id = v_employee_id;
    else
      v_self_check_user_id := auth.uid();
    end if;
    if v_approver_id = v_self_check_user_id then
      raise exception 'The resolved approver for this workflow''s first step (%) is you — you can''t approve your own request. Contact HR Admin to assign a different approver.', v_approver_type;
    end if;
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
  v_had_configured_rule boolean;
  v_timesheet timesheets%rowtype;
  v_payroll_company_id uuid;
  v_recovery_request recovery_credit_requests%rowtype;
  v_comp_day_ledger_id uuid;
  v_step record;
  v_next_approver uuid;
  v_found_next boolean := false;
  v_queue_role text;
  v_queue_company_id uuid;
  v_queue_beneficiary_user_id uuid;
  v_dup_ref_type text;
  v_dup_ref_id uuid;
  v_blocker text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be ''approved'' or ''rejected''';
  end if;

  select * into v_approval from approvals where id = p_approval_id for update;
  if not found then
    raise exception 'Approval not found';
  end if;

  if v_approval.approver_id is not null then
    if auth.uid() is not null and v_approval.approver_id <> auth.uid() then
      raise exception 'Only the assigned approver may decide this';
    end if;
  elsif v_approval.queue_roles is not null then
    -- NEW self-clock queue step (approvals.queue_roles' own doc comment) —
    -- ANY user currently holding ONE of these role(s) IN THE APPROVAL'S OWN
    -- COMPANY may decide it (more than one role only for the shared
    -- CEO/CTO queue). Company/beneficiary resolved the same way the LEGACY
    -- role_queue branch below does.
    if v_approval.entity_type = 'recovery_credit' then
      select e.company_id, e.user_id into v_queue_company_id, v_queue_beneficiary_user_id
      from recovery_credit_requests r join employees e on e.id = r.employee_id
      where r.id = v_approval.entity_id;
    else
      raise exception 'queue_roles approval steps are only supported for recovery_credit.';
    end if;

    if auth.uid() is null or not exists (select 1 from unnest(v_approval.queue_roles) qr where has_role(qr, v_queue_company_id)) then
      raise exception 'Only an active % may decide this.', array_to_string(v_approval.queue_roles, ' or ');
    end if;
    if auth.uid() = v_queue_beneficiary_user_id then
      raise exception 'You cannot decide a recovery credit request for your own attendance. Ask another eligible approver to decide it.';
    end if;

    -- The 'employee_lead_then_hr' route's step 2 (this HR queue step) may
    -- only be decided once step 1 (the project lead's own decision) is
    -- ITSELF 'approved' — required so a MATERIAL correction that resets
    -- step 1 back to pending (see adjust_recovery_credit_request()'s own
    -- "renewed lead approval" doc comment) can never be bypassed by HR
    -- deciding step 2 while step 1 sits un-re-approved. A no-op for every
    -- single-step route (step_order is always 1 there).
    if v_approval.step_order > 1 and not exists (
      select 1 from approvals a2
      where a2.entity_type = v_approval.entity_type and a2.entity_id = v_approval.entity_id
        and a2.step_order = v_approval.step_order - 1 and a2.decision = 'approved'
    ) then
      raise exception 'Awaiting a renewed project lead approval after a correction before this may be decided.';
    end if;
  else
    -- LEGACY role_queue:% mechanism via approval_workflow_steps (currently
    -- only the manual/overnight recovery_credit family's single HR step —
    -- see that column's own doc comment): there's no single assigned
    -- approver_id to compare against auth.uid(); instead ANY user currently
    -- holding the step's named role IN THE APPROVAL'S OWN COMPANY may
    -- decide it. Resolved here, before entity dispatch below (which only
    -- runs after the decision is already recorded), since this needs the
    -- company + beneficiary user up front. Unchanged by the new
    -- queue_roles mechanism above — never reached for a self-clock-routed
    -- recovery_credit row, since those always carry queue_roles instead.
    select approver_type into v_queue_role
    from approval_workflow_steps where workflow_id = v_approval.workflow_id and step_order = v_approval.step_order;
    if v_queue_role is null or v_queue_role not like 'role_queue:%' then
      raise exception 'This approval has no assigned approver and is not a recognized role-queue step.';
    end if;

    if v_approval.entity_type = 'recovery_credit' then
      select e.company_id, e.user_id into v_queue_company_id, v_queue_beneficiary_user_id
      from recovery_credit_requests r join employees e on e.id = r.employee_id
      where r.id = v_approval.entity_id;
    else
      raise exception 'Role-queue approval steps are only supported for recovery_credit.';
    end if;

    if auth.uid() is null or not has_role(replace(v_queue_role, 'role_queue:', '')::app_role, v_queue_company_id) then
      raise exception 'Only an active % may decide this.', replace(v_queue_role, 'role_queue:', '');
    end if;
    -- The project lead HR checked the work with is never an application
    -- approver (no role, no seat in this table) — the only self-decision
    -- risk here is the BENEFICIARY employee themselves also happening to
    -- hold hr_admin and trying to decide their own request.
    if auth.uid() = v_queue_beneficiary_user_id then
      raise exception 'You cannot decide a recovery credit request for your own attendance. Ask another HR Admin to decide it.';
    end if;
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
  elsif v_approval.entity_type = 'recovery_credit' then
    select * into v_recovery_request from recovery_credit_requests where id = v_approval.entity_id for update;
    v_employee_id := v_recovery_request.employee_id;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
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
    elsif v_approval.entity_type = 'recovery_credit' then
      update recovery_credit_requests set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    end if;
    return; -- rejection stops the chain; earlier decisions in the log are untouched
  end if;

  if v_approval.entity_type = 'recovery_credit' and v_recovery_request.applicant_route is not null then
    -- NEW self-clock 4-tier routing — bypasses the generic
    -- approval_workflow_steps walk below entirely (see
    -- recovery_credit_requests.applicant_route's own doc comment: the four
    -- routes have different total step counts, which that generic walk
    -- doesn't fit). Only the 'employee_lead_then_hr' route ever advances
    -- (its own step 1, the lead's decision, to step 2, the HR queue); every
    -- other route — and this route's own step 2 — IS the final step, so it
    -- falls straight through to the shared finalize block below exactly
    -- like v_found_next = false does for every other entity type.
    if v_recovery_request.applicant_route = 'employee_lead_then_hr' and v_approval.step_order = 1 then
      if not exists (select 1 from approvals where entity_type = 'recovery_credit' and entity_id = v_approval.entity_id and step_order = 2) then
        insert into approvals (entity_type, entity_id, step_order, queue_roles, decision)
        values ('recovery_credit', v_approval.entity_id, 2, array['hr_admin']::app_role[], 'pending');
      end if;
      -- The lead's "provisional release" — nothing is credited yet.
      update recovery_credit_requests set status = 'pending_approval' where id = v_approval.entity_id;
      return;
    end if;
  else
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
      elsif v_approval.entity_type = 'recovery_credit' then
        -- The manager's "provisional release" — nothing is credited yet.
        update recovery_credit_requests set status = 'pending_approval' where id = v_approval.entity_id;
      end if;
      -- generated_letter has only ever had one step (role:ceo) so it never reaches here
      return;
    end if;
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

    v_had_configured_rule := false;
    for v_rule in
      select dpr.source_ledger
      from deduction_priority_rules dpr
      join employees e on e.id = v_leave_request.employee_id
      where dpr.leave_type_code = v_leave_request.leave_type_code
        and (dpr.company_id = e.company_id or (dpr.company_id is null and dpr.country_code = e.country_code))
        and dpr.effective_from <= v_leave_request.start_date
      order by dpr.priority_order asc
    loop
      v_had_configured_rule := true;
      exit when v_remaining <= 0;

      if v_rule.source_ledger = 'comp_day' then
        -- coalesce(sum(days), 0) already nets out every prior redemption,
        -- reversal AND expiry entry for this employee — the comp-day-expiry
        -- cron posts a negative 'expired' row whenever an earned entry's
        -- remaining balance lapses, so this sum is already the correct
        -- CURRENTLY-AVAILABLE (unexpired) balance, not a raw lifetime total.
        select coalesce(sum(days), 0) into v_available from comp_day_ledger where employee_id = v_leave_request.employee_id;
        if v_available > 0 then
          v_draw := least(v_remaining, v_available);
          -- A single aggregate 'redeemed' entry, not linked to one specific
          -- earned row — oldest-expiring-first is a property of how the
          -- expiry cron's pooling algorithm (computeCompDayExpiry) reads
          -- the ledger afterward (it always consumes the earliest-expiring
          -- surviving balance first), not of which earned row a redemption
          -- names, so this draw participates correctly in FIFO consumption
          -- without needing per-request linkage.
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
      if v_had_configured_rule then
        -- At least one deduction_priority_rules row WAS configured for this
        -- leave type (e.g. Recovery Leave's comp_day-only rule) and it
        -- could not cover the full request — refuse outright rather than
        -- falling through to an unconfigured leave_ledger balance that has
        -- no real accrual behind it at all. This whole function call rolls
        -- back on this exception (including the partial comp_day
        -- 'redeemed' entry just above and the approvals row updated
        -- earlier), so nothing is left half-applied.
        raise exception 'Insufficient balance to approve this %: % day(s) requested, only % day(s) available from the configured funding source(s) for this leave type.',
          v_leave_request.leave_type_code, v_leave_request.total_days, (v_leave_request.total_days - v_remaining);
      else
        -- No deduction_priority_rules row has ever been configured for
        -- this leave type at all (true of every leave type this system
        -- shipped with before Recovery Leave, e.g. annual/sick) — same
        -- unconditional leave_ledger fallback as always, unchanged.
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
        values (v_leave_request.employee_id, v_leave_request.leave_type_code, v_leave_request.start_date, 'deduction', -v_remaining, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
      end if;
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

  elsif v_approval.entity_type = 'recovery_credit' then
    -- HR Admin's (or, for the self-clock 4-tier routes, whichever queue/
    -- lead step is actually final for this request's applicant_route —
    -- see the step-advancement block above) final approval — the ONLY
    -- point anywhere in this system that posts the actual earned
    -- comp_day_ledger row for a recovery credit. Defensively re-checks for
    -- an existing active credit first (decide_leave_approval() already
    -- refuses to re-decide a non-'pending' approval, so this can only run
    -- once per approvals row in practice — this is a second, independent
    -- backstop, the same "already credited?" check
    -- record_attendance_and_recovery()/sync_attendance_recovery_for_day()
    -- use). The reference is the LEGACY attendance_record for that family,
    -- or the request itself for the self-clock family (segment_id set,
    -- attendance_record_id null) — see recovery_credit_requests' own doc
    -- comment for why there's no single evidence row to point at there (a
    -- day's total can span more than one segment).
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_recovery_request.employee_id::text));

    -- Window-based requests (working period / 24-elapsed-hour windows): final
    -- approval is refused HERE, in the database, unless the window is closed,
    -- the amount still matches the evidence, and any required HR verification
    -- has happened — a direct call can never skip what the UI shows. Legacy
    -- request types return NULL from the blocker and behave exactly as before.
    v_blocker := recovery_request_blocker(v_recovery_request.id);
    if v_blocker is not null then
      raise exception '%', v_blocker;
    end if;
    if v_recovery_request.event_type in ('window', 'window_top_up', 'window_reduction') then
      perform recovery_post_window_ledger(v_recovery_request.id, coalesce(auth.uid(), v_requester_user_id));
      return;
    end if;

    if v_recovery_request.attendance_record_id is not null then
      v_dup_ref_type := 'attendance_record';
      v_dup_ref_id := v_recovery_request.attendance_record_id;
    else
      v_dup_ref_type := 'recovery_credit_request';
      v_dup_ref_id := v_recovery_request.id;
    end if;

    if not exists (
      select 1 from comp_day_ledger cl
      where cl.reference_type = v_dup_ref_type and cl.reference_id = v_dup_ref_id and cl.entry_type = 'earned'
        and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id)
    ) then
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
      values (
        v_recovery_request.employee_id,
        v_recovery_request.work_date,
        'earned',
        v_recovery_request.proposed_days,
        case v_recovery_request.event_type when 'overnight' then 'overnight_extension' else 'holiday_worked' end,
        v_recovery_request.work_date + interval '180 days',
        v_dup_ref_type,
        v_dup_ref_id,
        coalesce(auth.uid(), v_requester_user_id)
      )
      returning id into v_comp_day_ledger_id;

      update recovery_credit_requests
      set status = 'approved', decided_at = now(), comp_day_ledger_id = v_comp_day_ledger_id
      where id = v_recovery_request.id;
    else
      update recovery_credit_requests set status = 'approved', decided_at = now() where id = v_recovery_request.id;
    end if;
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
alter table recovery_credit_requests enable row level security;
alter table attendance_sessions enable row level security;
alter table attendance_segments enable row level security;
alter table attendance_locations enable row level security;
alter table termination_settlement_inputs enable row level security;

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

-- ---- Self-activation: the ONLY update a plain authenticated user may make
-- to their own profiles row, and only this one transition. Every other field
-- is untouched by this policy; a WITH CHECK failure just makes the whole
-- UPDATE fail, it can't be used to partially apply an update the USING
-- clause didn't already allow.
create policy profiles_self_activate on profiles for update
  using (id = auth.uid() and account_status = 'invited')
  with check (id = auth.uid() and account_status = 'active');

-- ---- profiles_update_own has no column restriction at all — fine when the
-- only self-editable data was name/locale, but the account-status/audit
-- columns below raise the stakes: without this guard, any signed-in user
-- could rewrite their OWN status_reason/status_changed_by to forge the audit
-- trail, or flip account_status back to 'active' during the brief window
-- between an admin's ban call and their next getUser() revalidation (see
-- account_status's comment in §0). Same column-guard-trigger pattern as
-- guard_employee_self_update() (Phase 1) — Sys Admin (profiles_write_sysadmin)
-- and trusted backend writes (auth.uid() is null) are unaffected; the one
-- self-service exception is the exact invited->active transition
-- profiles_self_activate exists for.
create or replace function guard_profiles_self_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or has_role('sys_admin') then
    return new;
  end if;

  if new.account_status is distinct from old.account_status
     and not (old.account_status = 'invited' and new.account_status = 'active') then
    raise exception 'account_status can only be changed by a System Administrator';
  end if;

  if new.email is distinct from old.email
    or new.status_reason is distinct from old.status_reason
    or new.status_changed_by is distinct from old.status_changed_by
    or new.status_changed_at is distinct from old.status_changed_at
  then
    raise exception 'Only full_name and locale can be self-updated — ask a System Administrator to change anything else.';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on profiles
  for each row execute function guard_profiles_self_update();

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
-- The extra recovery_credit branch widens visibility to the employee who
-- BENEFITS from the request — is_entity_owner() for recovery_credit means
-- "who initiated it" (the manager/HR who recorded eligibility, via
-- created_by), correctly NOT the employee themselves; without this branch
-- the employee could see neither their pending request nor its outcome.
create policy approvals_select on approvals for select
  using (
    approver_id = auth.uid()
    or has_role('hr_admin')
    or is_entity_owner(entity_type, entity_id)
    or (
      entity_type = 'recovery_credit'
      and exists (select 1 from recovery_credit_requests r where r.id = entity_id and r.employee_id = current_employee_id())
    )
    or (
      -- A queue step's approver_id is null by design — either the LEGACY
      -- role_queue:% mechanism (approval_workflow_steps.approver_type's own
      -- doc comment) or the NEW self-clock queue_roles column on this same
      -- row (approvals.queue_roles' own doc comment: hr_admin for the
      -- manager/self-led routes and this route's own final HR step, ceo+cto
      -- for the shared executive queue). None of the branches above would
      -- ever match for a company-scoped HR Admin/CEO/CTO (the realistic
      -- case; has_role('hr_admin') with no company argument only matches a
      -- GLOBAL, unscoped grant), so without this branch a queued Recovery
      -- Leave approval would be invisible to whoever is actually meant to
      -- decide it.
      entity_type = 'recovery_credit'
      and approver_id is null
      and exists (
        select 1 from recovery_credit_requests r join employees e on e.id = r.employee_id
        where r.id = entity_id
          and (
            has_role('hr_admin', e.company_id)
            or (queue_roles is not null and exists (select 1 from unnest(queue_roles) qr where has_role(qr, e.company_id)))
          )
      )
    )
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

-- ---- attendance_sessions/segments/locations: the employee self-clock path
--      (see attendance_sessions' own doc comment) — self/manager/HR Admin
--      read, same visibility tier as attendance_records since these are the
--      newer evidence source feeding the same recovery_credit_requests
--      pipeline. A segment's own project_lead_employee_id ALSO grants read
--      access to exactly that segment (and its locations) to whoever is
--      named there — this is the ONLY access a temporary project lead ever
--      gets: the specific segment(s) they are asked to verify, never a
--      broader Manager-style grant over the employee's other attendance or
--      any other company data. No write policy on any of the three: every
--      write goes through clock_in()/switch_work_segment()/clock_out()
--      (employee-initiated) or hr_close_attendance_session() (HR
--      correction), all SECURITY DEFINER — the same RPC-only-write pattern
--      already used for recovery_credit_requests/approvals below.
create policy attendance_sessions_select on attendance_sessions for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy attendance_segments_select on attendance_segments for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or project_lead_employee_id = current_employee_id()
  );

create policy attendance_locations_select on attendance_locations for select
  using (exists (
    select 1 from attendance_segments s
    where s.id = segment_id
      and (
        s.employee_id = current_employee_id()
        or is_manager_of(s.employee_id)
        or has_role('hr_admin', (select company_id from employees where id = s.employee_id))
        or s.project_lead_employee_id = current_employee_id()
      )
  ));

-- ---- recovery_credit_requests: self/manager/HR Admin read (same shape as
--      attendance_records, since each request is derived from one
--      attendance record or segment); the snapshotted project_lead_employee_id
--      ALSO grants read access, for the same "only their assigned
--      request's own evidence, never a broader grant" reason
--      attendance_segments_select does. No write policy at all —
--      record_attendance_and_recovery(), record_overnight_recovery_credit(),
--      sync_attendance_recovery_for_day(), and decide_leave_approval() (all
--      SECURITY DEFINER) are the only mutation path, same design already
--      used for the approvals table itself.
create policy recovery_credit_requests_select on recovery_credit_requests for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or project_lead_employee_id = current_employee_id()
  );

create trigger audit_recovery_credit_requests after insert or update on recovery_credit_requests
  for each row execute function write_audit_log();

-- ---- termination_settlement_inputs: HR Admin/Finance read+write only —
--      the HR/Finance-provided statutory wage basis final settlement
--      preparation needs for Saudi/Poland leave encashment.
create policy termination_settlement_inputs_select on termination_settlement_inputs for select
  using (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy termination_settlement_inputs_write on termination_settlement_inputs for all
  using (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  )
  with check (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create trigger audit_termination_settlement_inputs after insert or update on termination_settlement_inputs
  for each row execute function write_audit_log();

alter table poland_termination_leave_reconciliations enable row level security;

-- Read-only from the ordinary authenticated role's perspective — every
-- write happens inside post_poland_termination_leave_adjustment()/
-- acknowledge_poland_termination_leave_excess() (both SECURITY DEFINER,
-- like every other SECURITY DEFINER function in this schema, and therefore
-- unaffected by RLS); there is deliberately no direct insert/update/delete
-- policy for `authenticated` here.
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
  using (table_name in ('companies', 'user_roles', 'profiles') and has_role('sys_admin'));

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
-- set_account_status(): guarded activate/deactivate, same shape as
-- revoke_role_grant() above — advisory-locked, self-action guard,
-- last-System-Administrator guard.
--
-- This function ONLY updates `profiles`. It deliberately does not touch
-- auth.users/banned_until — the calling Server Action
-- (lib/actions/account-status.ts) bans via the Admin API first and only
-- calls this RPC once that succeeds on deactivate; on reactivate it calls
-- this RPC first and only unbans afterward — in both cases so a partial
-- failure always leans toward less access, never more.
--
-- has_role('sys_admin') below is called with no company argument, which
-- (per has_role's null-semantics, §13) requires an UNSCOPED grant — this is
-- deliberately global, not per-company: a System Administrator may act on
-- an account in any company. Approved explicitly as decision 7 in
-- docs/08-decisions-log.md; revisit before HR Engine becomes a true
-- multi-company/SaaS product, at which point a single global Sys Admin able
-- to deactivate any tenant's users is very likely the wrong model.
-- =============================================================================

create or replace function set_account_status(p_user_id uuid, p_new_status account_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status account_status;
  v_other_active_sysadmins bigint;
begin
  if auth.uid() is null or not has_role('sys_admin') then
    raise exception 'Only a System Administrator may change an account''s status';
  end if;

  if p_new_status not in ('active', 'deactivated') then
    raise exception 'Status must be set to active or deactivated through this operation';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  -- Matches the app-layer max (setAccountStatusSchema in
  -- lib/actions/account-status.ts) — defense-in-depth against a caller
  -- bypassing that layer, not a UX limit (the form/prompt already stops
  -- someone well before this).
  if length(p_reason) > 500 then
    raise exception 'Reason is too long (500 characters max)';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own account status — ask another System Administrator to do it';
  end if;

  perform pg_advisory_xact_lock(hashtext('profiles:set_account_status'));

  select account_status into v_current_status from profiles where id = p_user_id;
  if v_current_status is null then
    raise exception 'This account no longer exists';
  end if;

  -- Only ever reachable when the target isn't the caller (guarded above),
  -- so this is necessarily a case of one admin locking out another —
  -- checked the same way revoke_role_grant() checks the last sys_admin
  -- role grant, just re-expressed against active accounts instead of
  -- unrevoked grants.
  if p_new_status = 'deactivated' then
    select count(*) into v_other_active_sysadmins
    from user_roles ur
    join profiles p on p.id = ur.user_id
    where ur.role = 'sys_admin'
      and ur.revoked_at is null
      and p.account_status = 'active'
      and ur.user_id <> p_user_id;
    if v_other_active_sysadmins = 0
       and exists (select 1 from user_roles where user_id = p_user_id and role = 'sys_admin' and revoked_at is null) then
      raise exception 'Can''t deactivate the last active System Administrator — the system would have nobody left to manage users or roles';
    end if;
  end if;

  update profiles
  set account_status = p_new_status,
      status_reason = p_reason,
      status_changed_by = auth.uid(),
      status_changed_at = now()
  where id = p_user_id;
end;
$$;

grant execute on function set_account_status(uuid, account_status, text) to authenticated;

-- =============================================================================
-- log_security_event(): the one allowlisted, non-forgeable way to record a
-- security event that doesn't correspond to an actual row mutation on an
-- already-audited table (a forgot-password request from a signed-out
-- visitor, a self-service password change, a self-service sign-out-
-- everywhere, an admin sending a reset/invite email, or a reactivation that
-- couldn't restore a consistent state — see set_account_status() above).
-- Not a general-purpose "write anything to audit_log" helper: the action
-- vocabulary is fixed, and who may log which action (and for whom) is
-- checked here, not trusted from the caller.
--
-- Metadata is allowlisted PER ACTION (v_allowed_keys below), not
-- denylisted — every current action's allowlist is empty, since none of
-- them need any custom metadata today, so p_metadata collapses to '{}' for
-- every real call site regardless of what a caller passes. This is
-- deliberately stricter than "strip a few known-bad key names": a caller
-- cannot get ANY key into after_data unless it's explicitly added to that
-- action's allowlist here, reviewed alongside the action itself.
--
-- Never reveals whether an account exists: it has no meaningful return value
-- (void) and every branch succeeds silently whether or not a target was
-- found, so it cannot be used as an existence oracle even by an
-- authenticated caller probing p_email.
-- =============================================================================

create or replace function log_security_event(
  p_action text,
  p_target_user_id uuid default null,
  p_email text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_actor_role app_role;
  v_actor_roles app_role[];
  v_company_id uuid;
  v_allowed_keys text[];
  v_metadata jsonb;
begin
  select array_agg(role order by granted_at desc) into v_actor_roles
  from user_roles where user_id = auth.uid() and revoked_at is null;
  v_actor_role := v_actor_roles[1];

  if p_action = 'password_reset_requested' then
    -- Unauthenticated by definition (anon has no auth.uid()); resolves the
    -- target from the submitted email purely for the internal audit trail
    -- (visible to Sys Admin only) — this never reaches the caller, so it
    -- doesn't compromise the neutral, existence-blind response the Server
    -- Action itself returns.
    v_target := coalesce(p_target_user_id, (select id from profiles where lower(email) = lower(p_email) limit 1));

  elsif p_action in ('password_changed', 'all_device_signout_requested') then
    if auth.uid() is null then
      raise exception 'Not signed in';
    end if;
    v_target := auth.uid();

  elsif p_action in ('password_reset_sent_by_admin', 'invitation_resent') then
    if auth.uid() is null or not has_role('sys_admin') then
      raise exception 'Only a System Administrator may log this action';
    end if;
    if p_target_user_id is null or not exists (select 1 from profiles where id = p_target_user_id) then
      raise exception 'Unknown target account';
    end if;
    v_target := p_target_user_id;

  elsif p_action = 'account_reconciliation_required' then
    -- Logged by the Server Action itself (lib/actions/account-status.ts)
    -- when a reactivation's compensating deactivation ALSO fails, leaving
    -- profiles/auth genuinely inconsistent — exists purely to flag that
    -- state for a human System Administrator to resolve by hand.
    if auth.uid() is null or not has_role('sys_admin') then
      raise exception 'Only a System Administrator may log this action';
    end if;
    if p_target_user_id is null or not exists (select 1 from profiles where id = p_target_user_id) then
      raise exception 'Unknown target account';
    end if;
    v_target := p_target_user_id;

  else
    raise exception 'Unknown security event action';
  end if;

  -- Every action's allowlist is empty today — add a
  -- `when '<action>' then array['key1', ...]` branch only alongside a
  -- reviewed reason a specific action needs specific metadata.
  v_allowed_keys := case p_action
    when 'password_reset_requested' then array[]::text[]
    when 'password_changed' then array[]::text[]
    when 'all_device_signout_requested' then array[]::text[]
    when 'password_reset_sent_by_admin' then array[]::text[]
    when 'invitation_resent' then array[]::text[]
    when 'account_reconciliation_required' then array[]::text[]
    else array[]::text[]
  end;

  select coalesce(jsonb_object_agg(kv.key, kv.value), '{}'::jsonb)
  into v_metadata
  from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as kv(key, value)
  where kv.key = any(v_allowed_keys);

  if v_target is not null then
    select company_id into v_company_id from employees where user_id = v_target and deleted_at is null limit 1;
  end if;

  insert into audit_log(table_name, record_id, action, actor_id, actor_role, actor_roles, company_id, after_data)
  values ('profiles', v_target, p_action, auth.uid(), v_actor_role, v_actor_roles, v_company_id, v_metadata);
end;
$$;

grant execute on function log_security_event(text, uuid, text, jsonb) to anon, authenticated;

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

  insert into audit_log(table_name, record_id, action, actor_id, actor_role, actor_roles, company_id, before_data, after_data, origin)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    lower(TG_OP),
    auth.uid(),
    v_actor_role,
    v_actor_roles,
    v_company_id,
    v_before,
    v_after,
    -- Where the change really came from. Background work and the SQL editor
    -- have no signed-in user (actor_id stays null) and are never attributed to
    -- an HR person.
    coalesce(nullif(current_setting('app.audit_origin', true), ''), case when auth.uid() is null then 'system' else 'user' end)
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
-- Captures hr_close_attendance_session()'s own correction (hr_closed_by/at/
-- reason) — the one write path here that asserts rather than observes a
-- timestamp, so it is the one attendance-clocking table audited this way;
-- attendance_segments/attendance_locations are pure employee-self-service
-- evidence, same bucket as attendance_records (which itself predates this
-- feature and has never had a trigger here either).
create trigger audit_attendance_sessions after insert or update on attendance_sessions
  for each row execute function write_audit_log();

-- System-scoped tables (docs/03-permission-matrix.md's "system-scoped
-- entries" — role changes and company/tenant structure; NOT general HR
-- content). Login events aren't captured here — those live in Supabase
-- Auth's own logs, outside this application schema's reach.
create trigger audit_user_roles after insert or update on user_roles
  for each row execute function write_audit_log();
create trigger audit_companies after insert or update on companies
  for each row execute function write_audit_log();
-- profiles has no company_id/employee_id column, so write_audit_log()
-- naturally resolves company_id to null here and every row is
-- Sys-Admin-only (audit_log_select_sysadmin above) — account/access
-- administration, not HR content, matching the bucket this table is in.
create trigger audit_profiles after update on profiles
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

-- -----------------------------------------------------------------------------
-- 17. Recovery Leave windows redesign (migration 20261108000000_recovery_windows_attendance_redesign.sql)
--     Tables, functions and triggers; the six replaced function bodies above
--     (decide_leave_approval, is_entity_owner, adjust_recovery_credit_request,
--     record_attendance_and_recovery, sync_attendance_recovery_for_day,
--     write_audit_log) are patched in place.
-- -----------------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. Additive schema. Nothing below changes how an existing row behaves:
--    every pre-existing session is stamped 'legacy' and stays on the
--    original same-calendar-day / 4-hour calculation forever. The new
--    window model only ever applies to sessions that START after a
--    'recovery_windows' policy has been explicitly activated for the
--    employee's country (see recovery_session_assign_model()).
-- ---------------------------------------------------------------------

-- Which calculation a session belongs to, fixed at clock-in and never
-- changed afterwards (so activating or deactivating a policy never
-- recalculates history, and a session in flight at activation finishes
-- under the rules it started with).
alter table attendance_sessions add column if not exists recovery_model text not null default 'legacy'
  check (recovery_model in ('legacy', 'windowed'));
-- "Add missing attendance" (HR recording a past shift an employee never
-- clocked): flagged as recorded by HR, never presented as a live clock state.
alter table attendance_sessions add column if not exists recorded_by_hr boolean not null default false;
alter table attendance_sessions add column if not exists recorded_by_hr_by uuid references auth.users(id);
alter table attendance_sessions add column if not exists recorded_by_hr_at timestamptz;
alter table attendance_sessions add column if not exists recorded_by_hr_reason text;

comment on column attendance_sessions.recovery_model is
  'legacy = original same-day/4-hour Recovery Leave calculation (every row that existed before the windows redesign); windowed = working-period/24-elapsed-hour-window calculation, assigned at insert by recovery_session_assign_model() from the active recovery_windows policy and never changed afterwards.';

-- Audit rows written by background work must say so instead of looking like
-- a person acted. write_audit_log() fills this in (see below).
alter table audit_log add column if not exists origin text;
comment on column audit_log.origin is
  'Where the change really came from: user (a signed-in person), system (no signed-in user, e.g. a migration or the SQL editor) or processor (the Recovery Leave background processor). Never impersonates an HR user.';

alter table policy_versions add column if not exists activation_record jsonb;
comment on column policy_versions.activation_record is
  'Set only by activate_recovery_windows_policy(): who activated a recovery_windows policy, when, the controlled effective date, and which earlier version it superseded.';

-- One working period: sessions joined by clocked-out gaps shorter than the
-- rest threshold. The policy version and the full rules are SNAPSHOTTED here
-- when the period is first recognised, so later policy changes never move an
-- in-flight period.
create table if not exists recovery_periods (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id),
  company_id          uuid not null references companies(id),
  country_code        text not null references countries(code),
  timezone            text not null,
  policy_version_id   uuid not null references policy_versions(id),
  rules               jsonb not null,
  started_at          timestamptz not null,
  last_work_end_at    timestamptz not null,
  has_open_session    boolean not null,
  rest_completes_at   timestamptz,
  status              text not null check (status in ('open', 'ended', 'superseded')),
  ended_at            timestamptz,
  recorded_seconds    numeric(16, 6) not null default 0,
  elapsed_seconds     numeric(16, 6) not null default 0,
  superseded_at       timestamptz,
  superseded_reason   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists recovery_periods_one_per_start
  on recovery_periods(employee_id, started_at) where status <> 'superseded';
create index if not exists idx_recovery_periods_company_status on recovery_periods(company_id, status);
create index if not exists idx_recovery_periods_employee on recovery_periods(employee_id, started_at desc);

-- One recovery window: at most 24 REAL elapsed hours from the period's first
-- clock-in (then from each previous boundary). The unit entitlement is
-- decided on, capped at 1 day per window.
create table if not exists recovery_windows (
  id                      uuid primary key default gen_random_uuid(),
  period_id               uuid not null references recovery_periods(id),
  employee_id             uuid not null references employees(id),
  company_id              uuid not null references companies(id),
  window_index            int not null check (window_index >= 1),
  window_start            timestamptz not null,
  window_end              timestamptz not null,
  recorded_seconds        numeric(16, 6) not null default 0 check (recorded_seconds >= 0),
  status                  text not null default 'open' check (status in ('open', 'closed')),
  closed_at               timestamptz,
  closed_reason           text check (closed_reason in ('elapsed_window', 'rest')),
  -- Classified ONCE, by the employee's own local date at the window START.
  starting_local_date     date not null,
  country_code            text not null,
  timezone                text not null,
  classification          text not null check (classification in ('normal_day', 'rest_day', 'public_holiday')),
  holiday_name            text,
  policy_version_id       uuid not null references policy_versions(id),
  entitlement_days        numeric(2, 1) not null default 0 check (entitlement_days in (0, 0.5, 1)),
  band                    text not null default 'none' check (band in ('none', 'half', 'full')),
  review_flags            text[] not null default '{}',
  hr_verification_required boolean not null default false,
  hr_verified_by          uuid references auth.users(id),
  hr_verified_at          timestamptz,
  hr_verification_note    text,
  revision_no             int not null default 0,
  allocation_signature    text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (period_id, window_index),
  check (window_end > window_start),
  check (status = 'open' or closed_at is not null)
);
create index if not exists idx_recovery_windows_employee on recovery_windows(employee_id, window_start desc);
create index if not exists idx_recovery_windows_company_status on recovery_windows(company_id, status);

-- Which raw evidence (segment) contributed which seconds to which window.
-- Derived data: rebuilt by the engine, never edited by hand. The segments and
-- sessions it points at are never altered or deleted by any calculation.
create table if not exists recovery_window_allocations (
  id                        uuid primary key default gen_random_uuid(),
  window_id                 uuid not null references recovery_windows(id) on delete cascade,
  employee_id               uuid not null references employees(id),
  session_id                uuid not null references attendance_sessions(id),
  segment_id                uuid not null references attendance_segments(id),
  work_mode                 text not null,
  project_name              text,
  project_lead_employee_id  uuid references employees(id),
  alloc_start               timestamptz not null,
  alloc_end                 timestamptz not null,
  seconds                   numeric(16, 6) not null check (seconds > 0),
  unique (window_id, segment_id, alloc_start)
);
create index if not exists idx_recovery_window_allocations_window on recovery_window_allocations(window_id);
create index if not exists idx_recovery_window_allocations_segment on recovery_window_allocations(segment_id);

-- A window's CALCULATED facts after it closed, one row per change. A change in
-- recorded hours is a change even when the day amount is identical.
create table if not exists recovery_window_revisions (
  id                  uuid primary key default gen_random_uuid(),
  window_id           uuid not null references recovery_windows(id),
  revision_no         int not null,
  recorded_seconds    numeric(16, 6) not null,
  entitlement_days    numeric(2, 1) not null,
  classification      text not null,
  starting_local_date date not null,
  review_flags        text[] not null default '{}',
  reason              text not null,
  actor_id            uuid,
  origin              text not null,
  previous_facts      jsonb,
  created_at          timestamptz not null default now(),
  unique (window_id, revision_no)
);

-- HR alerts: accumulated recorded work reaching the alert threshold with no
-- completed rest, and the automatic 24-elapsed-hour rollover. Warnings only —
-- they never stop recording and never create a recovery day by themselves.
create table if not exists recovery_alerts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  employee_id      uuid not null references employees(id),
  period_id        uuid not null references recovery_periods(id),
  alert_type       text not null check (alert_type in ('long_work', 'window_rollover')),
  dedup_key        text not null unique,
  triggered_at     timestamptz not null,
  detected_at      timestamptz not null default now(),
  period_started_at timestamptz not null,
  recorded_seconds numeric(16, 6) not null,
  elapsed_seconds  numeric(16, 6) not null,
  details          jsonb not null default '{}'::jsonb,
  status           text not null default 'open' check (status in ('open', 'acknowledged', 'obsolete')),
  acknowledged_by  uuid references auth.users(id),
  acknowledged_at  timestamptz,
  acknowledgement_note text
);
create index if not exists idx_recovery_alerts_company_status on recovery_alerts(company_id, status, triggered_at desc);

-- Every change HR makes to the timing of a recorded session: original and
-- corrected evidence side by side, who, when, why. Rows are append-only.
create table if not exists attendance_session_corrections (
  id                        uuid primary key default gen_random_uuid(),
  session_id                uuid not null references attendance_sessions(id),
  employee_id               uuid not null references employees(id),
  kind                      text not null check (kind in ('correct_times', 'add_missing')),
  original_clock_in_at      timestamptz,
  original_clock_out_at     timestamptz,
  corrected_clock_in_at     timestamptz not null,
  corrected_clock_out_at    timestamptz not null,
  reason                    text not null check (length(trim(reason)) > 0),
  actor_id                  uuid not null references auth.users(id),
  created_at                timestamptz not null default now()
);
create index if not exists idx_attendance_session_corrections_session on attendance_session_corrections(session_id);

-- Background processor bookkeeping (see recovery_process_due()).
create table if not exists recovery_processor_runs (
  id                    uuid primary key default gen_random_uuid(),
  origin                text not null,
  as_of                 timestamptz not null,
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  status                text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  employees_examined    int not null default 0,
  employees_failed      int not null default 0,
  error_summary         text
);
create index if not exists idx_recovery_processor_runs_started on recovery_processor_runs(started_at desc);

create table if not exists recovery_processor_failures (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid references recovery_processor_runs(id),
  employee_id    uuid not null references employees(id),
  error          text not null,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index if not exists idx_recovery_processor_failures_open on recovery_processor_failures(employee_id) where resolved_at is null;

-- The existing approval funnel is reused. A window-based request is just a
-- recovery_credit_requests row of a new event_type tied to its window.
alter table recovery_credit_requests add column if not exists recovery_window_id uuid references recovery_windows(id);
alter table recovery_credit_requests add column if not exists window_revision_no int;
alter table recovery_credit_requests add column if not exists adjusts_request_id uuid references recovery_credit_requests(id);
alter table recovery_credit_requests add column if not exists consumption_ack_by uuid references auth.users(id);
alter table recovery_credit_requests add column if not exists consumption_ack_at timestamptz;
alter table recovery_credit_requests add column if not exists consumption_ack_note text;

alter table recovery_credit_requests drop constraint if exists recovery_credit_requests_event_type_check;
alter table recovery_credit_requests add constraint recovery_credit_requests_event_type_check
  check (event_type in ('standard', 'overnight', 'window', 'window_top_up', 'window_reduction'));
alter table recovery_credit_requests drop constraint if exists recovery_credit_requests_window_columns_check;
alter table recovery_credit_requests add constraint recovery_credit_requests_window_columns_check
  check (
    (event_type in ('window', 'window_top_up', 'window_reduction')) = (recovery_window_id is not null)
    and ((event_type in ('window_top_up', 'window_reduction')) = (adjusts_request_id is not null))
  );

-- The old per-day natural key must only constrain the OLD families: two
-- different windows can legitimately start on the same local date (a short
-- shift, a real rest, another shift), each worth up to a day in its own
-- right. Window requests are keyed by their window instead.
drop index if exists recovery_credit_requests_active_per_day;
create unique index recovery_credit_requests_active_per_day
  on recovery_credit_requests(employee_id, work_date, event_type)
  where status not in ('cancelled', 'rejected') and segment_id is not null and event_type in ('standard', 'overnight');
create unique index if not exists recovery_credit_requests_active_per_window
  on recovery_credit_requests(recovery_window_id)
  where event_type = 'window' and status not in ('cancelled', 'rejected');
create unique index if not exists recovery_credit_requests_active_adjustment_per_window
  on recovery_credit_requests(recovery_window_id, event_type)
  where event_type in ('window_top_up', 'window_reduction') and status not in ('cancelled', 'rejected');
create index if not exists idx_recovery_credit_requests_window on recovery_credit_requests(recovery_window_id) where recovery_window_id is not null;

-- ---------------------------------------------------------------------
-- 2. Row-Level Security: read-only for people, every write goes through
--    SECURITY DEFINER functions. No INSERT/UPDATE/DELETE policy exists on
--    any new table, so none is possible for authenticated users.
-- ---------------------------------------------------------------------

alter table recovery_periods enable row level security;
alter table recovery_windows enable row level security;
alter table recovery_window_allocations enable row level security;
alter table recovery_window_revisions enable row level security;
alter table recovery_alerts enable row level security;
alter table attendance_session_corrections enable row level security;
alter table recovery_processor_runs enable row level security;
alter table recovery_processor_failures enable row level security;

-- Whether the signed-in user may read Recovery Leave evidence for this
-- employee: the employee themselves, their manager chain, HR Admin of the
-- company, and the CEO/CTO of the company (who decide HR's own requests).
create or replace function can_view_recovery_evidence(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id
      and (
        e.id = current_employee_id()
        or is_manager_of(e.id)
        or has_role('hr_admin', e.company_id)
        or has_role('ceo', e.company_id)
        or has_role('cto', e.company_id)
      )
  );
$$;

create policy recovery_periods_select on recovery_periods for select
  using (can_view_recovery_evidence(employee_id));

create policy recovery_windows_select on recovery_windows for select
  using (
    can_view_recovery_evidence(employee_id)
    or exists (
      select 1 from recovery_credit_requests r
      where r.recovery_window_id = recovery_windows.id and r.project_lead_employee_id = current_employee_id()
    )
  );

create policy recovery_window_allocations_select on recovery_window_allocations for select
  using (
    can_view_recovery_evidence(employee_id)
    or exists (
      select 1 from recovery_credit_requests r
      where r.recovery_window_id = recovery_window_allocations.window_id and r.project_lead_employee_id = current_employee_id()
    )
  );

create policy recovery_window_revisions_select on recovery_window_revisions for select
  using (exists (
    select 1 from recovery_windows w
    where w.id = window_id and (
      can_view_recovery_evidence(w.employee_id)
      or exists (select 1 from recovery_credit_requests r where r.recovery_window_id = w.id and r.project_lead_employee_id = current_employee_id())
    )
  ));

-- Alerts are for HR (and the CEO/CTO of the same company) only — never for
-- the employee, their manager or a project lead.
create policy recovery_alerts_select on recovery_alerts for select
  using (has_role('hr_admin', company_id) or has_role('ceo', company_id) or has_role('cto', company_id));

create policy attendance_session_corrections_select on attendance_session_corrections for select
  using (can_view_recovery_evidence(employee_id));

-- Processor tables have no policy at all: deny-all to every signed-in user.
-- recovery_scheduler_status() (below) is the only reader, and it checks roles.

-- Defence in depth on top of "no write policy": remove the write privileges
-- themselves so a mis-added policy later cannot silently open a write path.
revoke all on recovery_periods, recovery_windows, recovery_window_allocations, recovery_window_revisions,
  recovery_alerts, attendance_session_corrections, recovery_processor_runs, recovery_processor_failures from anon;
revoke insert, update, delete, truncate on recovery_periods, recovery_windows, recovery_window_allocations, recovery_window_revisions,
  recovery_alerts, attendance_session_corrections from authenticated;
revoke all on recovery_processor_runs, recovery_processor_failures from authenticated;

-- ---------------------------------------------------------------------
-- 3. Small helpers
-- ---------------------------------------------------------------------

-- The ONE clock every Recovery Leave calculation reads. In Production this is
-- exactly now(). The isolated RLS test database replaces this function with a
-- controllable one so boundary cases (13h 0s vs 13h 1s, a 24-hour rollover in
-- the middle of an open segment, ...) can be tested without waiting in real
-- time; nothing here can be overridden by an application user.
create or replace function recovery_now()
returns timestamptz
language sql stable
as $$
  select now();
$$;

-- Exact integer microseconds since the epoch: all window arithmetic is done
-- on integers so no boundary is ever decided by a floating-point rounding.
create or replace function recovery_us(p_ts timestamptz)
returns bigint
language sql stable
as $$
  select round(extract(epoch from p_ts) * 1000000)::bigint;
$$;

create or replace function recovery_ts(p_us bigint)
returns timestamptz
language sql immutable
as $$
  select timestamptz 'epoch' + p_us * interval '1 microsecond';
$$;

-- has_role() always asks about the CALLER (auth.uid()). The background
-- processor and HR corrections must reason about the APPLICANT's roles, so this
-- is the same predicate for an explicit user id.
create or replace function user_has_role(p_user_id uuid, p_role app_role, p_company_id uuid default null, p_country_code text default null)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1 from user_roles
    where user_id = p_user_id
      and role = p_role
      and revoked_at is null
      and (company_id is null or company_id = p_company_id)
      and (country_code is null or country_code = p_country_code)
  );
$$;

-- ---------------------------------------------------------------------
-- 4. Policy: machine-readable rules, generated wording, validation
-- ---------------------------------------------------------------------

-- Plain-English problems with a recovery_windows `rules` object; empty array
-- when it is coherent. Mirrors parseRecoveryWindowRules() in
-- packages/domain/src/recoveryWindows.ts.
create or replace function recovery_window_rules_issues(p_rules jsonb)
returns text[]
language plpgsql immutable
as $$
declare
  v_issues text[] := '{}';
  v_key text;
  v_window numeric; v_rest numeric; v_alert numeric;
  v_nz numeric; v_nh numeric; v_rz numeric; v_rh numeric;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    return array['rules must be an object.'];
  end if;
  foreach v_key in array array['window_hours', 'rest_gap_hours', 'alert_work_hours', 'normal_day_required_hours', 'expiry_days'] loop
    if jsonb_typeof(p_rules -> v_key) is distinct from 'number' or (p_rules ->> v_key)::numeric <= 0 then
      v_issues := array_append(v_issues, (v_key || ' must be a positive number.'));
    end if;
  end loop;
  foreach v_key in array array['zero_max_hours', 'half_max_hours'] loop
    if jsonb_typeof(p_rules -> 'normal_day' -> v_key) is distinct from 'number' or (p_rules -> 'normal_day' ->> v_key)::numeric <= 0 then
      v_issues := array_append(v_issues, ('normal_day.' || v_key || ' must be a positive number.'));
    end if;
  end loop;
  foreach v_key in array array['zero_below_hours', 'half_max_hours'] loop
    if jsonb_typeof(p_rules -> 'rest_day' -> v_key) is distinct from 'number' or (p_rules -> 'rest_day' ->> v_key)::numeric <= 0 then
      v_issues := array_append(v_issues, ('rest_day.' || v_key || ' must be a positive number.'));
    end if;
  end loop;
  if (p_rules -> 'max_days_per_window') is distinct from '1'::jsonb then
    v_issues := array_append(v_issues, 'max_days_per_window must be exactly 1.');
  end if;
  if array_length(v_issues, 1) is not null then
    return v_issues;
  end if;

  v_window := (p_rules ->> 'window_hours')::numeric;
  v_rest := (p_rules ->> 'rest_gap_hours')::numeric;
  v_alert := (p_rules ->> 'alert_work_hours')::numeric;
  v_nz := (p_rules -> 'normal_day' ->> 'zero_max_hours')::numeric;
  v_nh := (p_rules -> 'normal_day' ->> 'half_max_hours')::numeric;
  v_rz := (p_rules -> 'rest_day' ->> 'zero_below_hours')::numeric;
  v_rh := (p_rules -> 'rest_day' ->> 'half_max_hours')::numeric;
  if v_window > 48 then v_issues := array_append(v_issues, 'window_hours must not exceed 48.'); end if;
  if v_rest >= v_window then v_issues := array_append(v_issues, 'rest_gap_hours must be shorter than window_hours.'); end if;
  if v_alert > v_window then v_issues := array_append(v_issues, 'alert_work_hours must not exceed window_hours.'); end if;
  if v_nz >= v_nh then v_issues := array_append(v_issues, 'normal_day.zero_max_hours must be less than normal_day.half_max_hours.'); end if;
  if v_rz >= v_rh then v_issues := array_append(v_issues, 'rest_day.zero_below_hours must be less than rest_day.half_max_hours.'); end if;
  if v_nh > v_window then v_issues := array_append(v_issues, 'normal_day.half_max_hours must not exceed window_hours.'); end if;
  return v_issues;
end;
$$;

-- Policy wording GENERATED from the machine rules — never typed separately —
-- so the text a person reads can never describe different numbers from the
-- ones the engine calculates with. Must stay byte-identical with
-- renderRecoveryWindowPolicyWording() in packages/domain (the RLS suite
-- asserts equality for the same rules).
create or replace function render_recovery_window_policy_wording(p_rules jsonb)
returns text
language plpgsql immutable
as $$
declare
  v_window text := trim_scale((p_rules ->> 'window_hours')::numeric)::text;
  v_rest text := trim_scale((p_rules ->> 'rest_gap_hours')::numeric)::text;
  v_alert text := trim_scale((p_rules ->> 'alert_work_hours')::numeric)::text;
  v_required text := trim_scale((p_rules ->> 'normal_day_required_hours')::numeric)::text;
  v_expiry text := trim_scale((p_rules ->> 'expiry_days')::numeric)::text;
  v_max text := trim_scale((p_rules ->> 'max_days_per_window')::numeric)::text;
  v_nz text := trim_scale((p_rules -> 'normal_day' ->> 'zero_max_hours')::numeric)::text;
  v_nh text := trim_scale((p_rules -> 'normal_day' ->> 'half_max_hours')::numeric)::text;
  v_rz text := trim_scale((p_rules -> 'rest_day' ->> 'zero_below_hours')::numeric)::text;
  v_rh text := trim_scale((p_rules -> 'rest_day' ->> 'half_max_hours')::numeric)::text;
begin
  return array_to_string(array[
    'Recovery Leave is measured from recorded clocked-in time. Lunch while clocked in counts; clocked-out gaps never count; there is no assumed lunch deduction.',
    'Working period: work separated by clocked-out gaps shorter than ' || v_rest || ' hours is one working period. A gap of ' || v_rest || ' hours or more ends it, and the next clock-in starts a fresh period.',
    'Recovery window: each window is ' || v_window || ' real elapsed hours, starting at the first clock-in of the working period and then at each previous window boundary, and earns at most ' || v_max || ' day. Windows roll over automatically without any rest and without a manual clock-out.',
    'Normal working day (normal requirement ' || v_required || ' recorded hours, with no automatic deduction for a shorter day): up to and including ' || v_nz || ' recorded hours earns nothing; more than ' || v_nz || ' and up to and including ' || v_nh || ' hours earns 0.5 day; more than ' || v_nh || ' hours earns 1 day.',
    'Weekly rest day or applicable public holiday: under ' || v_rz || ' recorded hours earns nothing; from ' || v_rz || ' up to and including ' || v_rh || ' hours earns 0.5 day; more than ' || v_rh || ' hours earns 1 day. A public holiday that falls on a rest day is counted once.',
    'Each window is classified by the local date on which it starts, using the employee''s employment country, its configured working week and its public holidays.',
    'Office, work from home, site work/installation and client meetings all qualify. Business travel is recorded and always reviewed by HR before any credit.',
    'HR is alerted when accumulated recorded work reaches ' || v_alert || ' hours without a ' || v_rest || '-hour rest. This is a review signal only; it does not start a new recovery day.',
    'Credit requires a closed window, the independent approval route for the applicant and HR verification of unusual cases. Unused credit expires ' || v_expiry || ' days after it is earned and is never converted to cash, including on termination. This is an internal benefit and does not replace any mandatory statutory right.'
  ], E'\n');
end;
$$;

-- Active windows policy for a country on a given local date, with the rules
-- object. Null result = the windows model is not in force there (so every
-- clock-in stays on the legacy calculation).
create or replace function recovery_windows_policy_for(p_country_code text, p_as_of date)
returns table (policy_version_id uuid, version_no int, rules jsonb)
language sql stable security definer
set search_path = public
as $$
  select pv.id, pv.version_no, pv.payload -> 'rules'
  from policy_versions pv
  where pv.country_code = p_country_code
    and pv.policy_type = 'overtime_rules'
    and pv.status = 'active'
    and pv.payload ->> 'model' = 'recovery_windows'
    and p_as_of between pv.effective_from and coalesce(pv.effective_to, 'infinity'::date)
  limit 1;
$$;

-- Exact entitlement for one window. Seconds are compared exactly: with the
-- default bands 13h 0m 0s earns nothing and 13h 0m 1s earns 0.5 day; 17h 0m 0s
-- earns 0.5 and 17h 0m 1s earns 1; on a rest day 1h 59m 59s earns nothing, 2h
-- earns 0.5, 6h earns 0.5 and 6h 0m 1s earns 1.
create or replace function recovery_window_entitlement(p_classification text, p_recorded_seconds numeric, p_rules jsonb)
returns table (days numeric, band text)
language plpgsql immutable
as $$
begin
  if p_recorded_seconds is null or p_recorded_seconds <= 0 then
    days := 0; band := 'none'; return next; return;
  end if;
  if p_classification = 'normal_day' then
    if p_recorded_seconds <= (p_rules -> 'normal_day' ->> 'zero_max_hours')::numeric * 3600 then
      days := 0; band := 'none';
    elsif p_recorded_seconds <= (p_rules -> 'normal_day' ->> 'half_max_hours')::numeric * 3600 then
      days := 0.5; band := 'half';
    else
      days := 1; band := 'full';
    end if;
  else
    if p_recorded_seconds < (p_rules -> 'rest_day' ->> 'zero_below_hours')::numeric * 3600 then
      days := 0; band := 'none';
    elsif p_recorded_seconds <= (p_rules -> 'rest_day' ->> 'half_max_hours')::numeric * 3600 then
      days := 0.5; band := 'half';
    else
      days := 1; band := 'full';
    end if;
  end if;
  return next;
end;
$$;

-- Validates every recovery_windows policy on the way in and regenerates its
-- wording from the machine rules, so wording and calculation cannot diverge.
-- Activation is only possible through activate_recovery_windows_policy().
create or replace function guard_recovery_windows_policy()
returns trigger
language plpgsql
as $$
declare
  v_issues text[];
begin
  if new.policy_type <> 'overtime_rules' or new.payload ->> 'model' is distinct from 'recovery_windows' then
    return new;
  end if;

  v_issues := recovery_window_rules_issues(new.payload -> 'rules');
  if array_length(v_issues, 1) is not null then
    raise exception 'Invalid Recovery Leave windows policy: %', array_to_string(v_issues, ' ');
  end if;

  new.payload := jsonb_set(new.payload, '{wording}', to_jsonb(render_recovery_window_policy_wording(new.payload -> 'rules')));

  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and coalesce(current_setting('app.recovery_policy_activation', true), '') <> 'on' then
    raise exception 'A Recovery Leave windows policy is activated only through activate_recovery_windows_policy(), which records a controlled effective date.';
  end if;
  return new;
end;
$$;

drop trigger if exists policy_versions_recovery_windows_rules on policy_versions;
create trigger policy_versions_recovery_windows_rules
  before insert or update on policy_versions
  for each row execute function guard_recovery_windows_policy();

-- Creates the NEXT version of Recovery Leave (overtime_rules) as a DRAFT for
-- UAE, Saudi Arabia and Poland. Same shape as seed_phase2b_policy_drafts():
-- no parameter, the actor is auth.uid(), and the caller must hold a
-- company-unscoped HR Admin grant for each country. Never touches an existing
-- version (the active V2 stays exactly as it is), never activates anything,
-- and is safe to repeat (a marker in the payload makes a second call a no-op).
create or replace function seed_recovery_windows_policy_drafts()
returns table(country_code text, policy_type text, version_no int, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_by uuid := auth.uid();
  v_country text;
  v_version_no int;
  v_rules jsonb;
  v_safeguard text;
  v_payload jsonb;
begin
  if v_created_by is null then
    raise exception 'seed_recovery_windows_policy_drafts must be called by an authenticated HR Admin — auth.uid() is null (it cannot run from the Supabase SQL Editor). Use the button on the Policies page.';
  end if;

  v_rules := jsonb_build_object(
    'window_hours', 24,
    'rest_gap_hours', 8,
    'alert_work_hours', 20,
    'normal_day_required_hours', 9,
    'normal_day', jsonb_build_object('zero_max_hours', 13, 'half_max_hours', 17),
    'rest_day', jsonb_build_object('zero_below_hours', 2, 'half_max_hours', 6),
    'max_days_per_window', 1,
    'expiry_days', 180
  );
  v_safeguard := 'Enginious does not operate a general discretionary overtime-payment scheme. Working beyond normal hours does not automatically create Recovery Leave or an additional contractual payment. Where applicable employment law mandates overtime pay, holiday compensation, substitute rest or another minimum entitlement, Enginious will comply with that statutory requirement.';

  foreach v_country in array array['AE', 'SA', 'PL'] loop
    if not has_role('hr_admin', null, v_country) then
      raise exception 'Only a company-unscoped HR Admin for % may draft Recovery Leave windows policy versions for that country (auth.uid() = %).', v_country, v_created_by;
    end if;

    if exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'overtime_rules'
        and pv.payload ->> 'seed_marker' = 'recovery_windows_v1'
    ) then
      country_code := v_country; policy_type := 'overtime_rules'; version_no := null; action := 'skipped_already_seeded';
      return next;
      continue;
    end if;

    select coalesce(max(pv.version_no), 0) + 1 into v_version_no
    from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'overtime_rules';

    v_payload := jsonb_build_object(
      'seed_marker', 'recovery_windows_v1',
      'model', 'recovery_windows',
      'schema_version', 1,
      'policy_name', 'Enginious Recovery Leave (working-period windows)',
      'statutory_safeguard', v_safeguard,
      'rules', v_rules,
      'eligible_work_modes', jsonb_build_array('office', 'wfh', 'site_work', 'client_meeting'),
      'business_travel', 'recorded_and_hr_reviewed',
      'classification', 'window_starting_local_date',
      'closure_required_before_credit', true,
      'hr_verification_required_for', jsonb_build_array('forgotten_clock_out', 'unusual_long_work', 'business_travel', 'multiple_leads', 'leave_or_manual_conflict'),
      'consumption_order', 'oldest_first',
      'cash_conversion', false,
      'approval_routes', jsonb_build_object(
        'employee_with_lead', 'project_lead_then_hr',
        'self_led', 'hr',
        'permanent_manager', 'hr',
        'hr_applicant', 'ceo_or_cto_queue'
      ),
      'effective_point_note', 'Applies only to clock-ins that start on or after the controlled effective date set when this version is activated. Sessions already in progress at that point finish under the version they started with.'
    );
    -- The draft's own effective_from is a placeholder: the real, controlled
    -- effective date is chosen at activation (activate_recovery_windows_policy).
    insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
    values (v_country, 'overtime_rules', v_version_no, current_date + 1, v_payload, v_created_by);

    country_code := v_country; policy_type := 'overtime_rules'; version_no := v_version_no; action := 'created';
    return next;
  end loop;
end;
$$;

-- Controlled activation of a recovery_windows policy — the ONLY way one can
-- become active, so there is no SQL shortcut around the draft/approve flow:
--   * normal two-person rule (the activator is not the drafter) via the
--     existing guard_policy_version_update trigger,
--   * the activator must be a company-unscoped HR Admin of the country,
--   * the effective date must be tomorrow or later in the country's own time
--     zone (never retroactive, so no history is recalculated),
--   * the version currently in force (V2) is ended the day before — never
--     edited or deleted — so the two never overlap,
--   * who/when/which effective date is recorded on the version.
-- Sessions already open at the effective point keep their legacy calculation;
-- the first clock-in on or after that date starts the first windowed period.
create or replace function activate_recovery_windows_policy(p_policy_version_id uuid, p_effective_from date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pv policy_versions%rowtype;
  v_prev policy_versions%rowtype;
  v_local_today date;
begin
  if auth.uid() is null then
    raise exception 'A signed-in HR Admin is required to activate a Recovery Leave policy.';
  end if;
  select * into v_pv from policy_versions where id = p_policy_version_id for update;
  if not found then raise exception 'Policy version not found.'; end if;
  if v_pv.policy_type <> 'overtime_rules' or v_pv.payload ->> 'model' is distinct from 'recovery_windows' then
    raise exception 'This is not a Recovery Leave windows policy.';
  end if;
  if v_pv.status <> 'draft' then raise exception 'Only a draft version can be activated.'; end if;
  -- Activation sets the controlled effective date, which is policy CONTENT:
  -- the existing guard_policy_version_update trigger lets only HR Admin change
  -- content, so the CEO/CTO-only "activate but never edit" path cannot be used
  -- here (it would have to change effective_from).
  if not has_role('hr_admin', null, v_pv.country_code) then
    raise exception 'Only a company-unscoped HR Admin for % may activate this policy (and not the person who drafted it).', v_pv.country_code;
  end if;
  if auth.uid() = v_pv.created_by then
    raise exception 'A policy version must be activated by someone other than who drafted it.';
  end if;

  v_local_today := (recovery_now() at time zone country_timezone(v_pv.country_code))::date;
  if p_effective_from is null or p_effective_from <= v_local_today then
    raise exception 'The effective date must be after today (%) in this country''s time zone, so no history is recalculated.', v_local_today;
  end if;
  if exists (
    select 1 from policy_versions o
    where o.country_code = v_pv.country_code and o.policy_type = 'overtime_rules' and o.status = 'active'
      and o.id <> v_pv.id and o.effective_from >= p_effective_from
  ) then
    raise exception 'An active version already starts on or after %. Resolve that first.', p_effective_from;
  end if;

  select * into v_prev from policy_versions o
  where o.country_code = v_pv.country_code and o.policy_type = 'overtime_rules' and o.status = 'active'
    and o.id <> v_pv.id and o.effective_from < p_effective_from
    and coalesce(o.effective_to, 'infinity'::date) >= p_effective_from
  order by o.effective_from desc limit 1
  for update;

  perform set_config('app.recovery_policy_activation', 'on', true);
  if v_prev.id is not null then
    update policy_versions set effective_to = p_effective_from - 1 where id = v_prev.id;
  end if;
  update policy_versions
  set effective_from = p_effective_from,
      effective_to = null,
      status = 'active',
      activation_record = jsonb_build_object(
        'activated_by', auth.uid(),
        'activated_at', recovery_now(),
        'effective_from', p_effective_from,
        'supersedes_version_id', v_prev.id,
        'supersedes_version_no', v_prev.version_no,
        'supersedes_ended_on', case when v_prev.id is not null then p_effective_from - 1 else null end
      )
  where id = v_pv.id;
  perform set_config('app.recovery_policy_activation', 'off', true);
end;
$$;

-- The controlled way to STOP using the window model for new work (the "disable"
-- switch), without deleting or rewriting anything:
--   * the windows version gets an end date (never earlier than tomorrow in the
--     country's own time zone, so no history is recalculated);
--   * clock-ins that start after that date are stamped 'legacy' again, so no NEW
--     working period is ever created;
--   * every existing session, period, window, request, credit and audit row is
--     left exactly as it is — periods already running finish under the rules
--     they started with, and the background processor keeps finishing them;
--   * the version that was in force before is re-drafted (a fresh DRAFT copy of
--     its text, next version number) so HR can reactivate the earlier wording
--     through the normal two-person flow if they want it back on screen.
-- Nothing is reactivated automatically.
create or replace function deactivate_recovery_windows_policy(p_policy_version_id uuid, p_last_effective_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pv policy_versions%rowtype;
  v_prev policy_versions%rowtype;
  v_local_today date;
  v_next_no int;
begin
  if auth.uid() is null then
    raise exception 'A signed-in HR Admin is required to deactivate a Recovery Leave policy.';
  end if;
  select * into v_pv from policy_versions where id = p_policy_version_id for update;
  if not found then raise exception 'Policy version not found.'; end if;
  if v_pv.policy_type <> 'overtime_rules' or v_pv.payload ->> 'model' is distinct from 'recovery_windows' or v_pv.status <> 'active' then
    raise exception 'This is not an active Recovery Leave windows policy.';
  end if;
  if not has_role('hr_admin', null, v_pv.country_code) then
    raise exception 'Only a company-unscoped HR Admin for % may deactivate this policy.', v_pv.country_code;
  end if;
  v_local_today := (recovery_now() at time zone country_timezone(v_pv.country_code))::date;
  if p_last_effective_date is null or p_last_effective_date <= v_local_today then
    raise exception 'The last effective date must be after today (%) in this country''s time zone, so no history is recalculated.', v_local_today;
  end if;
  if v_pv.effective_to is not null and v_pv.effective_to <= p_last_effective_date then
    raise exception 'This version already ends on %.', v_pv.effective_to;
  end if;

  update policy_versions
  set effective_to = p_last_effective_date,
      activation_record = coalesce(activation_record, '{}'::jsonb) || jsonb_build_object(
        'deactivated_by', auth.uid(), 'deactivated_at', recovery_now(), 'last_effective_date', p_last_effective_date)
  where id = v_pv.id;

  select * into v_prev from policy_versions where id = (v_pv.activation_record ->> 'supersedes_version_id')::uuid;
  if v_prev.id is not null then
    select coalesce(max(version_no), 0) + 1 into v_next_no
    from policy_versions where country_code = v_pv.country_code and policy_type = 'overtime_rules';
    insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
    values (v_pv.country_code, 'overtime_rules', v_next_no, p_last_effective_date + 1, v_prev.payload, auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. The calculation: working periods and 24-elapsed-hour windows.
--    recovery_derive() is READ-ONLY and mirrors
--    packages/domain/src/recoveryWindows.ts (buildRecoveryPeriods()) rule for
--    rule; recovery_recalculate_employee() persists its result. All lifecycle
--    paths (clock in/out, mode switch, HR closure/correction, the background
--    processor) funnel through these two functions.
-- ---------------------------------------------------------------------

-- Builds ONE working period from its sorted intervals. Every instant is an
-- integer number of microseconds. p_intervals elements:
--   {segment_id, session_id, start_us, end_us, open, work_mode, project_name,
--    project_lead_employee_id, hr_closed, recorded_by_hr}
create or replace function recovery_derive_period(
  p_employee_id uuid,
  p_country_code text,
  p_timezone text,
  p_policy_version_id uuid,
  p_rules jsonb,
  p_intervals jsonb,
  p_as_of_us bigint
)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_rest_us bigint := round((p_rules ->> 'rest_gap_hours')::numeric * 3600 * 1000000)::bigint;
  v_window_us bigint := round((p_rules ->> 'window_hours')::numeric * 3600 * 1000000)::bigint;
  v_alert_us bigint := round((p_rules ->> 'alert_work_hours')::numeric * 3600 * 1000000)::bigint;
  v_start_us bigint := (p_intervals -> 0 ->> 'start_us')::bigint;
  v_last_end_us bigint;
  v_has_open boolean := false;
  v_rest_completes_us bigint;
  v_ended boolean;
  v_iv jsonb;
  v_running_end bigint;
  v_gaps jsonb := '[]'::jsonb;
  v_windows jsonb := '{}'::jsonb;
  v_w jsonb;
  v_cursor bigint;
  v_idx int;
  v_w_start bigint;
  v_w_end bigint;
  v_piece_end bigint;
  v_piece_us bigint;
  v_cumulative bigint := 0;
  v_recorded_total bigint := 0;
  v_long_trigger bigint := null;
  v_key text;
  v_out_windows jsonb := '[]'::jsonb;
  v_rollovers jsonb := '[]'::jsonb;
  v_k int;
  v_boundary bigint;
  v_closed boolean;
  v_closed_at bigint;
  v_closed_reason text;
  v_local_date date;
  v_is_rec boolean;
  v_holiday text;
  v_class text;
  v_ent record;
  v_flags text[];
  v_allocs jsonb;
  v_cum_at_boundary bigint;
  v_win_recorded numeric;
begin
  select max((e ->> 'end_us')::bigint), coalesce(bool_or((e ->> 'open')::boolean), false)
  into v_last_end_us, v_has_open
  from jsonb_array_elements(p_intervals) e;

  v_rest_completes_us := case when v_has_open then null else v_last_end_us + v_rest_us end;
  v_ended := v_rest_completes_us is not null and v_rest_completes_us <= p_as_of_us;

  -- Clocked-out gaps inside the period (each shorter than the rest threshold).
  v_running_end := (p_intervals -> 0 ->> 'end_us')::bigint;
  for v_iv in select e from jsonb_array_elements(p_intervals) with ordinality t(e, n) where n > 1 order by n loop
    if (v_iv ->> 'start_us')::bigint > v_running_end then
      v_gaps := v_gaps || jsonb_build_object('start_us', v_running_end, 'end_us', (v_iv ->> 'start_us')::bigint);
    end if;
    v_running_end := greatest(v_running_end, (v_iv ->> 'end_us')::bigint);
  end loop;

  -- Split every interval at the 24-elapsed-hour boundaries. Each recorded
  -- microsecond lands in exactly one window; the evidence itself is untouched.
  for v_iv in select e from jsonb_array_elements(p_intervals) e loop
    v_cursor := (v_iv ->> 'start_us')::bigint;
    while v_cursor < (v_iv ->> 'end_us')::bigint loop
      v_idx := ((v_cursor - v_start_us) / v_window_us)::int + 1;
      v_w_start := v_start_us + (v_idx - 1)::bigint * v_window_us;
      v_w_end := v_w_start + v_window_us;
      v_piece_end := least((v_iv ->> 'end_us')::bigint, v_w_end);
      v_piece_us := v_piece_end - v_cursor;

      if v_long_trigger is null and v_cumulative + v_piece_us >= v_alert_us then
        v_long_trigger := v_cursor + (v_alert_us - v_cumulative);
      end if;
      v_cumulative := v_cumulative + v_piece_us;
      v_recorded_total := v_recorded_total + v_piece_us;

      v_key := v_idx::text;
      v_w := v_windows -> v_key;
      if v_w is null then
        v_w := jsonb_build_object('index', v_idx, 'start_us', v_w_start, 'end_us', v_w_end, 'recorded_us', 0, 'allocations', '[]'::jsonb);
      end if;
      v_w := jsonb_set(v_w, '{recorded_us}', to_jsonb((v_w ->> 'recorded_us')::bigint + v_piece_us));
      v_w := jsonb_set(v_w, '{allocations}', (v_w -> 'allocations') || jsonb_build_object(
        'segment_id', v_iv -> 'segment_id',
        'session_id', v_iv -> 'session_id',
        'work_mode', v_iv -> 'work_mode',
        'project_name', v_iv -> 'project_name',
        'project_lead_employee_id', v_iv -> 'project_lead_employee_id',
        'hr_closed', v_iv -> 'hr_closed',
        'recorded_by_hr', v_iv -> 'recorded_by_hr',
        'start_us', v_cursor,
        'end_us', v_piece_end,
        'us', v_piece_us
      ));
      v_windows := jsonb_set(v_windows, array[v_key], v_w, true);
      v_cursor := v_piece_end;
    end loop;
  end loop;

  -- Window by window, in order: closure, classification, entitlement, flags.
  v_cum_at_boundary := 0;
  for v_key in select k from jsonb_object_keys(v_windows) k order by k::int loop
    v_w := v_windows -> v_key;
    v_closed := false; v_closed_at := null; v_closed_reason := null;
    -- Closes at whichever comes first: its own 24 elapsed hours running out,
    -- or the period genuinely ending by a completed rest.
    if (v_w ->> 'end_us')::bigint <= p_as_of_us then
      v_closed := true; v_closed_at := (v_w ->> 'end_us')::bigint; v_closed_reason := 'elapsed_window';
    end if;
    if v_ended and (not v_closed or v_rest_completes_us < v_closed_at) then
      v_closed := true; v_closed_at := v_rest_completes_us; v_closed_reason := 'rest';
    end if;

    v_local_date := (recovery_ts((v_w ->> 'start_us')::bigint) at time zone p_timezone)::date;
    select r.is_recovery_day, r.holiday_name into v_is_rec, v_holiday from is_recovery_eligible_day(p_country_code, v_local_date) r;
    v_class := case when v_holiday is not null then 'public_holiday' when v_is_rec then 'rest_day' else 'normal_day' end;
    v_win_recorded := (v_w ->> 'recorded_us')::numeric / 1000000;
    select * into v_ent from recovery_window_entitlement(v_class, v_win_recorded, p_rules);

    v_allocs := v_w -> 'allocations';
    v_flags := '{}';
    if exists (select 1 from jsonb_array_elements(v_allocs) a where a ->> 'work_mode' = 'business_travel') then
      v_flags := array_append(v_flags, 'business_travel');
    end if;
    if (select count(distinct a ->> 'project_lead_employee_id') from jsonb_array_elements(v_allocs) a where a ->> 'project_lead_employee_id' is not null) > 1
       or (select count(distinct lower(trim(a ->> 'project_name'))) from jsonb_array_elements(v_allocs) a where nullif(trim(a ->> 'project_name'), '') is not null) > 1 then
      v_flags := array_append(v_flags, 'multiple_leads');
    end if;
    if exists (select 1 from jsonb_array_elements(v_allocs) a where (a ->> 'hr_closed')::boolean) then
      v_flags := array_append(v_flags, 'forgotten_clock_out');
    end if;
    if exists (select 1 from jsonb_array_elements(v_allocs) a where (a ->> 'recorded_by_hr')::boolean) then
      v_flags := array_append(v_flags, 'hr_recorded');
    end if;
    if (v_w ->> 'recorded_us')::bigint >= v_alert_us then
      v_flags := array_append(v_flags, 'unusual_long_work');
    end if;
    if exists (select 1 from leave_requests lr where lr.employee_id = p_employee_id and lr.status = 'approved' and lr.deleted_at is null and v_local_date between lr.start_date and lr.end_date)
       or exists (select 1 from attendance_records ar where ar.employee_id = p_employee_id and ar.work_date = v_local_date and ar.status = 'leave') then
      v_flags := array_append(v_flags, 'leave_conflict');
    end if;
    if exists (select 1 from attendance_records ar where ar.employee_id = p_employee_id and ar.work_date = v_local_date and ar.source <> 'self_clock' and ar.status not in ('not_recorded', 'leave')) then
      v_flags := array_append(v_flags, 'manual_conflict');
    end if;

    v_out_windows := v_out_windows || (v_w || jsonb_build_object(
      'closed', v_closed,
      'closed_at_us', v_closed_at,
      'closed_reason', v_closed_reason,
      'starting_local_date', v_local_date,
      'classification', v_class,
      'holiday_name', v_holiday,
      'entitlement_days', v_ent.days,
      'band', v_ent.band,
      'review_flags', to_jsonb(v_flags),
      'hr_verification_required', v_flags && array['forgotten_clock_out', 'unusual_long_work', 'business_travel', 'multiple_leads', 'leave_conflict', 'manual_conflict']
    ));
  end loop;

  -- A rollover is a 24-elapsed-hour boundary that arrives while the period has
  -- NOT yet had a completed rest. It never counts as rest itself, and no
  -- window is manufactured after a real rest.
  v_k := 1;
  loop
    v_boundary := v_start_us + v_k::bigint * v_window_us;
    exit when v_boundary > p_as_of_us;
    exit when v_rest_completes_us is not null and v_rest_completes_us <= v_boundary;
    -- Only a boundary the work actually carries across is a rollover: work that
    -- already stopped before the boundary has nothing to roll over.
    exit when not (v_boundary < v_last_end_us or (v_has_open and v_boundary <= v_last_end_us));
    select coalesce(sum((w ->> 'recorded_us')::bigint), 0) into v_cum_at_boundary
    from jsonb_array_elements(v_out_windows) w where (w ->> 'index')::int <= v_k;
    v_rollovers := v_rollovers || jsonb_build_object('window_index', v_k, 'at_us', v_boundary, 'recorded_us', v_cum_at_boundary, 'elapsed_us', v_k::bigint * v_window_us);
    v_k := v_k + 1;
  end loop;

  return jsonb_build_object(
    'start_us', v_start_us,
    'last_work_end_us', v_last_end_us,
    'elapsed_us', v_last_end_us - v_start_us,
    'recorded_us', v_recorded_total,
    'has_open', v_has_open,
    'rest_completes_us', v_rest_completes_us,
    'ended', v_ended,
    'gaps', v_gaps,
    'long_work_trigger_us', v_long_trigger,
    'rollovers', v_rollovers,
    'windows', v_out_windows,
    'country_code', p_country_code,
    'timezone', p_timezone,
    'policy_version_id', p_policy_version_id,
    'rules', p_rules
  );
end;
$$;

create or replace function recovery_derive(p_employee_id uuid, p_as_of timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_country text;
  v_tz text;
  v_as_of_us bigint := recovery_us(p_as_of);
  v_periods jsonb := '[]'::jsonb;
  r record;
  v_start_us bigint;
  v_end_us bigint;
  v_group jsonb := '[]'::jsonb;
  v_group_end bigint := null;
  v_group_rules jsonb;
  v_group_pv uuid;
  v_rest_us bigint;
  v_pol record;
  v_existing record;
begin
  select e.country_code into v_country from employees e where e.id = p_employee_id;
  if v_country is null then
    return jsonb_build_object('periods', '[]'::jsonb);
  end if;
  v_tz := country_timezone(v_country);

  for r in
    select s.id as segment_id, s.session_id, s.work_mode, s.project_name, s.project_lead_employee_id,
           s.segment_start, s.segment_end,
           (ses.hr_closed_at is not null) as hr_closed, ses.recorded_by_hr
    from attendance_segments s
    join attendance_sessions ses on ses.id = s.session_id
    where s.employee_id = p_employee_id and ses.recovery_model = 'windowed'
    order by s.segment_start, s.id
  loop
    v_start_us := recovery_us(r.segment_start);
    v_end_us := case when r.segment_end is null then greatest(v_as_of_us, v_start_us) else recovery_us(r.segment_end) end;
    continue when v_end_us <= v_start_us;

    -- A new working period starts when this interval begins at least the rest
    -- threshold after everything before it ended (a gap of EXACTLY the
    -- threshold ends the period; one microsecond less keeps it going).
    if v_group_end is null or v_start_us - v_group_end >= v_rest_us then
      if v_group_end is not null then
        v_periods := v_periods || recovery_derive_period(p_employee_id, v_country, v_tz, v_group_pv, v_group_rules, v_group, v_as_of_us);
      end if;
      v_group := '[]'::jsonb;
      v_group_end := null;
      -- Rules for a period: the snapshot already stored for this exact start
      -- when it exists (so a later policy change never moves an in-flight
      -- period), otherwise the active windows policy on the start's local date.
      select p.rules, p.policy_version_id into v_existing
      from recovery_periods p
      where p.employee_id = p_employee_id and p.started_at = r.segment_start and p.status <> 'superseded';
      if v_existing.rules is not null then
        v_group_rules := v_existing.rules; v_group_pv := v_existing.policy_version_id;
      else
        select * into v_pol from recovery_windows_policy_for(v_country, (r.segment_start at time zone v_tz)::date);
        if v_pol.rules is null then
          raise exception 'No active Recovery Leave windows policy covers % for country % — cannot derive this working period.', (r.segment_start at time zone v_tz)::date, v_country;
        end if;
        v_group_rules := v_pol.rules; v_group_pv := v_pol.policy_version_id;
      end if;
      v_rest_us := round((v_group_rules ->> 'rest_gap_hours')::numeric * 3600 * 1000000)::bigint;
    end if;

    v_group := v_group || jsonb_build_object(
      'segment_id', r.segment_id, 'session_id', r.session_id, 'start_us', v_start_us, 'end_us', v_end_us,
      'open', r.segment_end is null, 'work_mode', r.work_mode, 'project_name', r.project_name,
      'project_lead_employee_id', r.project_lead_employee_id, 'hr_closed', r.hr_closed, 'recorded_by_hr', r.recorded_by_hr
    );
    v_group_end := greatest(coalesce(v_group_end, v_end_us), v_end_us);
  end loop;

  if v_group_end is not null then
    v_periods := v_periods || recovery_derive_period(p_employee_id, v_country, v_tz, v_group_pv, v_group_rules, v_group, v_as_of_us);
  end if;

  return jsonb_build_object('as_of_us', v_as_of_us, 'country_code', v_country, 'timezone', v_tz, 'periods', v_periods);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Requests, routing and the persisting engine
-- ---------------------------------------------------------------------

-- Is there at least one person who could actually decide with one of these
-- roles in this company, other than the applicant themselves? (Mirrors
-- has_role(): only grants unscoped by country count.) A request with nobody to
-- decide it is shown as UNRESOLVED with a reason — never silently dropped and
-- never guess-routed.
create or replace function recovery_eligible_approver_exists(p_company_id uuid, p_roles app_role[], p_exclude_user uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from user_roles ur
    where ur.role = any (p_roles)
      and ur.revoked_at is null
      and (ur.company_id is null or ur.company_id = p_company_id)
      and ur.country_code is null
      and ur.user_id is distinct from p_exclude_user
      and not exists (
        select 1 from employees e2
        where e2.user_id = ur.user_id and (e2.employment_status = 'terminated' or e2.deleted_at is not null)
      )
  );
$$;

-- The same four-way route the existing self-clock path uses, resolved from the
-- APPLICANT's own roles (not the caller's): HR applicant (even when also a
-- manager) -> shared CEO/CTO queue; permanent manager -> HR; an ordinary
-- employee naming themselves as lead -> HR; an ordinary employee with another
-- lead -> that lead, then HR. No lead at all -> null ("awaiting project lead").
create or replace function recovery_route_for_employee(p_employee_id uuid, p_project_lead_employee_id uuid)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_company uuid;
begin
  select user_id, company_id into v_user, v_company from employees where id = p_employee_id;
  if user_has_role(v_user, 'hr_admin', v_company) then
    return 'hr_admin_ceo_cto_queue';
  elsif user_has_role(v_user, 'line_manager', v_company) then
    return 'manager_hr_direct';
  elsif p_project_lead_employee_id is null then
    return null;
  elsif p_project_lead_employee_id = p_employee_id then
    return 'self_led_hr_direct';
  end if;
  return 'employee_lead_then_hr';
end;
$$;

-- Creates step 1 of the approval chain for a window request under SYSTEM
-- authority (create_initial_approval() insists the caller owns the request,
-- which the background processor never does). Never impersonates anyone: the
-- approvals row carries no actor of its own, and the request's created_by is
-- the real origin. A missing approver is recorded as routing_issue.
create or replace function recovery_route_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r recovery_credit_requests%rowtype;
  v_company uuid;
  v_user uuid;
  v_lead_user uuid;
  v_roles app_role[];
  v_approval_id uuid;
begin
  select * into r from recovery_credit_requests where id = p_request_id for update;
  if not found then raise exception 'Recovery credit request not found.'; end if;
  select e.company_id, e.user_id into v_company, v_user from employees e where e.id = r.employee_id;

  select id into v_approval_id from approvals where entity_type = 'recovery_credit' and entity_id = p_request_id and step_order = 1;
  if v_approval_id is not null then return v_approval_id; end if;
  if r.applicant_route is null then return null; end if;

  if r.applicant_route = 'employee_lead_then_hr' then
    select e.user_id into v_lead_user from employees e
    where e.id = r.project_lead_employee_id and e.employment_status <> 'terminated' and e.deleted_at is null;
    if v_lead_user is null then
      update recovery_credit_requests set routing_issue = 'The named project lead has no active HR Engine account to approve with. HR must assign another lead.' where id = p_request_id;
      return null;
    end if;
    if v_lead_user = v_user then
      update recovery_credit_requests set routing_issue = 'The resolved project lead is the applicant. HR must review this request.' where id = p_request_id;
      return null;
    end if;
    if not recovery_eligible_approver_exists(v_company, array['hr_admin']::app_role[], v_user) then
      update recovery_credit_requests set routing_issue = 'No HR Admin is currently available to take the second approval step.' where id = p_request_id;
      return null;
    end if;
    insert into approvals (entity_type, entity_id, step_order, approver_id, decision)
    values ('recovery_credit', p_request_id, 1, v_lead_user, 'pending')
    on conflict (entity_type, entity_id, step_order) do nothing
    returning id into v_approval_id;
  else
    v_roles := case r.applicant_route when 'hr_admin_ceo_cto_queue' then array['ceo', 'cto']::app_role[] else array['hr_admin']::app_role[] end;
    if not recovery_eligible_approver_exists(v_company, v_roles, v_user) then
      update recovery_credit_requests
      set routing_issue = 'No eligible approver currently holds the ' || array_to_string(v_roles, ' or ') || ' role for this company.'
      where id = p_request_id;
      return null;
    end if;
    insert into approvals (entity_type, entity_id, step_order, queue_roles, decision)
    values ('recovery_credit', p_request_id, 1, v_roles, 'pending')
    on conflict (entity_type, entity_id, step_order) do nothing
    returning id into v_approval_id;
  end if;

  update recovery_credit_requests set routing_issue = null where id = p_request_id and routing_issue is not null;
  if v_approval_id is null then
    select id into v_approval_id from approvals where entity_type = 'recovery_credit' and entity_id = p_request_id and step_order = 1;
  end if;
  return v_approval_id;
end;
$$;

-- Lock order everywhere in this feature matches decide_leave_approval():
-- approvals rows first, then the request row, then the ledger lock.
create or replace function recovery_cancel_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from approvals where entity_type = 'recovery_credit' and entity_id = p_request_id for update;
  update approvals
  set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, p_reason)
  where entity_type = 'recovery_credit' and entity_id = p_request_id and decision = 'pending';
  update recovery_credit_requests
  set status = 'cancelled', decided_at = now(), correction_reason = coalesce(correction_reason, p_reason)
  where id = p_request_id and status in ('submitted', 'pending_approval');
end;
$$;

-- Days actually credited to the ledger for one window: every earned entry
-- (original, top-ups, re-earned remainders) that has not been reversed.
create or replace function recovery_window_credited_days(p_window_id uuid)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(cl.days), 0)
  from comp_day_ledger cl
  join recovery_credit_requests r on cl.reference_type = 'recovery_credit_request' and cl.reference_id = r.id
  where r.recovery_window_id = p_window_id
    and cl.entry_type = 'earned'
    and not exists (select 1 from comp_day_ledger x where x.reversal_of_id = cl.id);
$$;

-- Brings the approval requests for ONE closed window in line with its current
-- calculated entitlement. Idempotent: running it again with nothing changed
-- creates nothing.
--   * nothing earned yet, entitlement > 0  -> one 'window' request;
--   * request still pending                -> its amount is updated in place
--                                             (or it is cancelled if the
--                                             entitlement fell to 0), and a
--                                             lead who had already approved
--                                             must approve again;
--   * request approved (credit posted)     -> only the DIFFERENCE is requested:
--                                             a top-up (e.g. 0.5 -> 1 asks for
--                                             +0.5) or an explicit reduction.
create or replace function recovery_sync_window_requests(p_window_id uuid, p_actor uuid, p_reason text, p_origin text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  w recovery_windows%rowtype;
  v_emp record;
  v_orig recovery_credit_requests%rowtype;
  v_adj recovery_credit_requests%rowtype;
  v_credited numeric;
  v_target numeric;
  v_delta numeric;
  v_anchor record;
  v_route text;
  v_request_id uuid;
  v_created int := 0;
  v_creator uuid;
  v_material boolean;
  v_kind text;
begin
  select * into w from recovery_windows where id = p_window_id;
  if not found or w.status <> 'closed' then return 0; end if;
  select e.id, e.employment_status into v_emp from employees e where e.id = w.employee_id;
  if v_emp.employment_status = 'terminated' then return 0; end if;

  v_creator := coalesce(p_actor, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  v_target := w.entitlement_days;
  v_credited := recovery_window_credited_days(w.id);

  select * into v_orig from recovery_credit_requests
  where recovery_window_id = w.id and event_type = 'window' and status not in ('cancelled', 'rejected');

  if v_orig.id is null then
    -- A rejected/cancelled request for this exact (or a later) revision is a
    -- final answer: never re-request the same evidence in a loop.
    if v_target > 0 and not exists (
      select 1 from recovery_credit_requests
      where recovery_window_id = w.id and event_type = 'window' and status in ('rejected', 'cancelled') and window_revision_no >= w.revision_no
    ) then
      select a.segment_id, a.work_mode, a.project_name, a.project_lead_employee_id into v_anchor
      from recovery_window_allocations a
      where a.window_id = w.id
      order by (a.work_mode = 'site_work') desc, (a.project_lead_employee_id is not null) desc, a.alloc_start asc, a.segment_id
      limit 1;
      if v_anchor.segment_id is null then return 0; end if;
      v_route := recovery_route_for_employee(w.employee_id, v_anchor.project_lead_employee_id);

      insert into recovery_credit_requests (
        employee_id, segment_id, work_date, event_type, proposed_days, created_by,
        work_mode, project_name, project_lead_employee_id, applicant_route, awaiting_project_lead, needs_policy_review,
        recovery_window_id, window_revision_no
      )
      values (
        w.employee_id, v_anchor.segment_id, w.starting_local_date, 'window', v_target, v_creator,
        v_anchor.work_mode, v_anchor.project_name, v_anchor.project_lead_employee_id, v_route, v_route is null, w.hr_verification_required,
        w.id, w.revision_no
      )
      returning id into v_request_id;
      v_created := v_created + 1;
      if v_route is not null then
        perform recovery_route_request(v_request_id);
      end if;
    end if;
    return v_created;
  end if;

  if v_orig.status in ('submitted', 'pending_approval') then
    if v_target = 0 then
      perform recovery_cancel_request(v_orig.id, 'Cancelled: the corrected evidence no longer earns a Recovery Leave day.');
      return 0;
    end if;
    v_material := v_orig.proposed_days is distinct from v_target or v_orig.window_revision_no is distinct from w.revision_no;
    if v_material then
      perform 1 from approvals where entity_type = 'recovery_credit' and entity_id = v_orig.id for update;
      perform 1 from recovery_credit_requests where id = v_orig.id for update;
      update recovery_credit_requests
      set proposed_days = v_target,
          window_revision_no = w.revision_no,
          needs_policy_review = w.hr_verification_required,
          correction_reason = coalesce(p_reason, 'Evidence recalculated'),
          corrected_by = case when v_creator = '00000000-0000-0000-0000-000000000000'::uuid then corrected_by else v_creator end,
          corrected_at = now()
      where id = v_orig.id;
      -- A MATERIAL change after the project lead already approved needs the
      -- lead's renewed approval before anything can be credited.
      if v_orig.applicant_route = 'employee_lead_then_hr' then
        update approvals
        set decision = 'pending', decided_at = null,
            comments = coalesce(comments || ' — ', '') || 'Reset for renewed approval after the evidence changed.'
        where entity_type = 'recovery_credit' and entity_id = v_orig.id and step_order = 1 and decision = 'approved';
      end if;
    elsif v_orig.needs_policy_review is distinct from w.hr_verification_required then
      update recovery_credit_requests set needs_policy_review = w.hr_verification_required where id = v_orig.id;
    end if;
    return 0;
  end if;

  -- Approved: compare with what the ledger really holds for this window.
  v_delta := v_target - v_credited;
  v_kind := case when v_delta > 0 then 'window_top_up' else 'window_reduction' end;
  select * into v_adj from recovery_credit_requests
  where recovery_window_id = w.id and event_type in ('window_top_up', 'window_reduction') and status not in ('cancelled', 'rejected');

  if v_delta = 0 then
    if v_adj.id is not null and v_adj.status in ('submitted', 'pending_approval') then
      perform recovery_cancel_request(v_adj.id, 'Cancelled: no difference remains between the evidence and the credit already posted.');
    end if;
    return 0;
  end if;

  if v_adj.id is not null and v_adj.status in ('submitted', 'pending_approval') then
    if v_adj.event_type = v_kind and v_adj.proposed_days = abs(v_delta) then
      return 0; -- already requesting exactly this
    end if;
    perform recovery_cancel_request(v_adj.id, 'Superseded by a newer calculation of the difference.');
  elsif v_adj.id is not null then
    return 0; -- an approved adjustment is already reflected in v_credited
  end if;

  if exists (
    select 1 from recovery_credit_requests
    where recovery_window_id = w.id and event_type = v_kind
      and status in ('rejected', 'cancelled') and window_revision_no >= w.revision_no
  ) then
    return 0; -- this exact revision's difference was already answered
  end if;

  insert into recovery_credit_requests (
    employee_id, segment_id, work_date, event_type, proposed_days, created_by,
    work_mode, project_name, project_lead_employee_id, applicant_route, awaiting_project_lead, needs_policy_review,
    recovery_window_id, window_revision_no, adjusts_request_id
  )
  values (
    w.employee_id, v_orig.segment_id, w.starting_local_date,
    v_kind,
    abs(v_delta), v_creator,
    v_orig.work_mode, v_orig.project_name, v_orig.project_lead_employee_id, v_orig.applicant_route, false, true,
    w.id, w.revision_no, v_orig.id
  )
  returning id into v_request_id;
  v_created := v_created + 1;
  perform recovery_route_request(v_request_id);
  return v_created;
end;
$$;

-- The persisting engine. Re-derives the employee's working periods and windows
-- from the raw evidence and brings every derived table, alert and request in
-- line — one transaction, idempotent, safe to run any number of times and from
-- any lifecycle path (clock events, HR corrections, the background processor).
-- p_as_of exists so a delayed processor can catch up on every boundary it
-- missed, and so tests can use a controlled clock; callers normally omit it.
create or replace function recovery_recalculate_employee(
  p_employee_id uuid,
  p_as_of timestamptz default null,
  p_origin text default 'engine',
  p_reason text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, recovery_now());
  v_emp record;
  v_derived jsonb;
  v_period jsonb;
  v_win jsonb;
  v_alert jsonb;
  v_period_id uuid;
  v_old record;
  v_starts bigint[];
  v_indexes int[];
  v_w recovery_windows%rowtype;
  v_found boolean;
  v_new_rec numeric;
  v_new_ent numeric;
  v_new_band text;
  v_new_class text;
  v_new_date date;
  v_new_flags text[];
  v_new_closed boolean;
  v_new_verif boolean;
  v_sig text;
  v_facts_changed boolean;
  v_rev_no int;
  v_make_revision boolean;
  v_reason text;
  v_prev jsonb;
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_alert_keys text[];
  v_req record;
  v_created int := 0;
  v_status text;
  v_alloc jsonb;
  v_window_id uuid;
begin
  select e.id, e.company_id, e.country_code, e.deleted_at into v_emp from employees e where e.id = p_employee_id;
  if v_emp.id is null or v_emp.deleted_at is not null then
    return jsonb_build_object('skipped', 'employee_not_found');
  end if;
  if not exists (select 1 from attendance_sessions where employee_id = p_employee_id and recovery_model = 'windowed') then
    return jsonb_build_object('skipped', 'no_windowed_sessions');
  end if;

  perform pg_advisory_xact_lock(hashtext('recovery_engine:' || p_employee_id::text));
  v_derived := recovery_derive(p_employee_id, v_as_of);

  select coalesce(array_agg((p ->> 'start_us')::bigint), '{}') into v_starts from jsonb_array_elements(v_derived -> 'periods') p;

  -- Periods that no longer exist as such (the evidence was corrected so they
  -- merged, split or moved). One that already has an approved credit cannot be
  -- restructured silently: the correction is refused and rolled back.
  for v_old in
    select * from recovery_periods
    where employee_id = p_employee_id and status <> 'superseded' and not (recovery_us(started_at) = any (v_starts))
  loop
    if exists (
      select 1 from recovery_credit_requests r join recovery_windows w on w.id = r.recovery_window_id
      where w.period_id = v_old.id and r.status = 'approved'
    ) then
      raise exception 'This change would restructure the working period that started at % and already has an approved Recovery Leave credit. Correct the evidence without moving the period, or review the credit separately.', v_old.started_at;
    end if;
    for v_req in
      select r.id from recovery_credit_requests r join recovery_windows w on w.id = r.recovery_window_id
      where w.period_id = v_old.id and r.status in ('submitted', 'pending_approval')
    loop
      perform recovery_cancel_request(v_req.id, 'Cancelled: the working period was re-derived after the evidence changed.');
    end loop;
    update recovery_alerts set status = 'obsolete' where period_id = v_old.id and status = 'open';
    update recovery_periods
    set status = 'superseded', superseded_at = now(), superseded_reason = coalesce(p_reason, 'Evidence changed; working period re-derived'), updated_at = now()
    where id = v_old.id;
  end loop;

  for v_period in select p from jsonb_array_elements(v_derived -> 'periods') p loop
    v_status := case when (v_period ->> 'ended')::boolean then 'ended' else 'open' end;

    select id into v_period_id from recovery_periods
    where employee_id = p_employee_id and started_at = recovery_ts((v_period ->> 'start_us')::bigint) and status <> 'superseded'
    for update;

    if v_period_id is null then
      insert into recovery_periods (
        employee_id, company_id, country_code, timezone, policy_version_id, rules, started_at, last_work_end_at,
        has_open_session, rest_completes_at, status, ended_at, recorded_seconds, elapsed_seconds
      )
      values (
        p_employee_id, v_emp.company_id, v_period ->> 'country_code', v_period ->> 'timezone',
        (v_period ->> 'policy_version_id')::uuid, v_period -> 'rules',
        recovery_ts((v_period ->> 'start_us')::bigint), recovery_ts((v_period ->> 'last_work_end_us')::bigint),
        (v_period ->> 'has_open')::boolean,
        case when v_period -> 'rest_completes_us' = 'null'::jsonb then null else recovery_ts((v_period ->> 'rest_completes_us')::bigint) end,
        v_status,
        case when v_status = 'ended' then recovery_ts((v_period ->> 'rest_completes_us')::bigint) else null end,
        (v_period ->> 'recorded_us')::numeric / 1000000, (v_period ->> 'elapsed_us')::numeric / 1000000
      )
      returning id into v_period_id;
    else
      update recovery_periods
      set last_work_end_at = recovery_ts((v_period ->> 'last_work_end_us')::bigint),
          has_open_session = (v_period ->> 'has_open')::boolean,
          rest_completes_at = case when v_period -> 'rest_completes_us' = 'null'::jsonb then null else recovery_ts((v_period ->> 'rest_completes_us')::bigint) end,
          status = v_status,
          ended_at = case when v_status = 'ended' then recovery_ts((v_period ->> 'rest_completes_us')::bigint) else null end,
          recorded_seconds = (v_period ->> 'recorded_us')::numeric / 1000000,
          elapsed_seconds = (v_period ->> 'elapsed_us')::numeric / 1000000,
          updated_at = now()
      where id = v_period_id
        and (last_work_end_at, has_open_session, rest_completes_at, status, recorded_seconds, elapsed_seconds) is distinct from (
          recovery_ts((v_period ->> 'last_work_end_us')::bigint), (v_period ->> 'has_open')::boolean,
          case when v_period -> 'rest_completes_us' = 'null'::jsonb then null else recovery_ts((v_period ->> 'rest_completes_us')::bigint) end,
          v_status, (v_period ->> 'recorded_us')::numeric / 1000000, (v_period ->> 'elapsed_us')::numeric / 1000000
        );
    end if;

    v_indexes := '{}';
    for v_win in select w from jsonb_array_elements(v_period -> 'windows') w loop
      v_indexes := v_indexes || (v_win ->> 'index')::int;
      v_new_rec := (v_win ->> 'recorded_us')::numeric / 1000000;
      v_new_ent := (v_win ->> 'entitlement_days')::numeric;
      v_new_band := v_win ->> 'band';
      v_new_class := v_win ->> 'classification';
      v_new_date := (v_win ->> 'starting_local_date')::date;
      v_new_closed := (v_win ->> 'closed')::boolean;
      v_new_verif := (v_win ->> 'hr_verification_required')::boolean;
      select coalesce(array_agg(f order by f), '{}') into v_new_flags from jsonb_array_elements_text(v_win -> 'review_flags') f;
      v_sig := md5((v_win -> 'allocations')::text);

      select * into v_w from recovery_windows where period_id = v_period_id and window_index = (v_win ->> 'index')::int for update;
      v_found := found;

      if not v_found then
        v_rev_no := case when v_new_closed then 1 else 0 end;
        insert into recovery_windows (
          period_id, employee_id, company_id, window_index, window_start, window_end, recorded_seconds, status, closed_at, closed_reason,
          starting_local_date, country_code, timezone, classification, holiday_name, policy_version_id, entitlement_days, band,
          review_flags, hr_verification_required, revision_no, allocation_signature
        )
        values (
          v_period_id, p_employee_id, v_emp.company_id, (v_win ->> 'index')::int,
          recovery_ts((v_win ->> 'start_us')::bigint), recovery_ts((v_win ->> 'end_us')::bigint), v_new_rec,
          case when v_new_closed then 'closed' else 'open' end,
          case when v_new_closed then recovery_ts((v_win ->> 'closed_at_us')::bigint) else null end,
          v_win ->> 'closed_reason',
          v_new_date, v_period ->> 'country_code', v_period ->> 'timezone', v_new_class, v_win ->> 'holiday_name',
          (v_period ->> 'policy_version_id')::uuid, v_new_ent, v_new_band, v_new_flags, v_new_verif, v_rev_no, v_sig
        )
        returning id into v_window_id;
        if v_new_closed then
          insert into recovery_window_revisions (window_id, revision_no, recorded_seconds, entitlement_days, classification, starting_local_date, review_flags, reason, actor_id, origin)
          values (v_window_id, 1, v_new_rec, v_new_ent, v_new_class, v_new_date, v_new_flags, coalesce(p_reason, 'Window closed'), v_actor, p_origin);
        end if;
      else
        v_window_id := v_w.id;
        v_facts_changed := v_w.recorded_seconds is distinct from v_new_rec
          or v_w.entitlement_days is distinct from v_new_ent
          or v_w.classification is distinct from v_new_class
          or v_w.starting_local_date is distinct from v_new_date
          or v_w.review_flags is distinct from v_new_flags;
        v_rev_no := v_w.revision_no;
        v_make_revision := false;

        if v_w.status = 'closed' and not v_new_closed then
          -- Re-opened by a correction. Only possible while nothing is credited.
          if exists (select 1 from recovery_credit_requests r where r.recovery_window_id = v_w.id and r.status = 'approved') then
            raise exception 'This change would re-open a recovery window that already has an approved credit. Correct the evidence without moving the window, or review the credit separately.';
          end if;
          for v_req in select r.id from recovery_credit_requests r where r.recovery_window_id = v_w.id and r.status in ('submitted', 'pending_approval') loop
            perform recovery_cancel_request(v_req.id, 'Cancelled: the recovery window was re-opened by a correction.');
          end loop;
        end if;

        if v_w.status = 'closed' and v_new_closed and v_facts_changed then
          v_make_revision := true;
        elsif v_w.status = 'open' and v_new_closed then
          v_make_revision := true;
        end if;
        if v_make_revision then v_rev_no := v_w.revision_no + 1; end if;

        update recovery_windows
        set recorded_seconds = v_new_rec,
            status = case when v_new_closed then 'closed' else 'open' end,
            closed_at = case when v_new_closed then coalesce(case when v_w.status = 'closed' then v_w.closed_at else null end, recovery_ts((v_win ->> 'closed_at_us')::bigint)) else null end,
            closed_reason = case when v_new_closed then coalesce(case when v_w.status = 'closed' then v_w.closed_reason else null end, v_win ->> 'closed_reason') else null end,
            starting_local_date = v_new_date, classification = v_new_class, holiday_name = v_win ->> 'holiday_name',
            entitlement_days = v_new_ent, band = v_new_band,
            review_flags = v_new_flags, hr_verification_required = v_new_verif,
            -- A change to a window HR had already verified needs verifying again.
            hr_verified_by = case when v_make_revision and v_w.status = 'closed' then null else hr_verified_by end,
            hr_verified_at = case when v_make_revision and v_w.status = 'closed' then null else hr_verified_at end,
            hr_verification_note = case when v_make_revision and v_w.status = 'closed' then null else hr_verification_note end,
            revision_no = v_rev_no, allocation_signature = v_sig, updated_at = now()
        where id = v_w.id
          and (recorded_seconds, status, entitlement_days, classification, starting_local_date, review_flags, hr_verification_required, allocation_signature, revision_no, closed_at)
              is distinct from (v_new_rec, case when v_new_closed then 'closed' else 'open' end, v_new_ent, v_new_class, v_new_date, v_new_flags, v_new_verif, v_sig, v_rev_no,
                                case when v_new_closed then coalesce(case when v_w.status = 'closed' then v_w.closed_at else null end, recovery_ts((v_win ->> 'closed_at_us')::bigint)) else null end);

        if v_make_revision then
          v_prev := jsonb_build_object('recorded_seconds', v_w.recorded_seconds, 'entitlement_days', v_w.entitlement_days,
            'classification', v_w.classification, 'starting_local_date', v_w.starting_local_date, 'review_flags', to_jsonb(v_w.review_flags),
            'revision_no', v_w.revision_no);
          v_reason := coalesce(p_reason, case when v_w.status = 'open' then 'Window closed' else 'Recalculated after the evidence changed' end);
          insert into recovery_window_revisions (window_id, revision_no, recorded_seconds, entitlement_days, classification, starting_local_date, review_flags, reason, actor_id, origin, previous_facts)
          values (v_w.id, v_rev_no, v_new_rec, v_new_ent, v_new_class, v_new_date, v_new_flags, v_reason, v_actor, p_origin, v_prev)
          on conflict (window_id, revision_no) do nothing;
        end if;
      end if;

      -- Evidence allocation, rebuilt only when it actually changed.
      if not v_found or v_w.allocation_signature is distinct from v_sig then
        delete from recovery_window_allocations where window_id = v_window_id;
        insert into recovery_window_allocations (window_id, employee_id, session_id, segment_id, work_mode, project_name, project_lead_employee_id, alloc_start, alloc_end, seconds)
        select v_window_id, p_employee_id, (a ->> 'session_id')::uuid, (a ->> 'segment_id')::uuid, a ->> 'work_mode', a ->> 'project_name',
               nullif(a ->> 'project_lead_employee_id', '')::uuid,
               recovery_ts((a ->> 'start_us')::bigint), recovery_ts((a ->> 'end_us')::bigint), (a ->> 'us')::numeric / 1000000
        from jsonb_array_elements(v_win -> 'allocations') a;
      end if;

      if v_new_closed then
        v_created := v_created + recovery_sync_window_requests(v_window_id, v_actor, p_reason, p_origin);
      end if;
    end loop;

    -- Windows that had recorded work before but have none in the corrected
    -- evidence: zero them (keeping the row, its history and any credit trail),
    -- then let the request sync cancel or reduce.
    for v_w in
      select * from recovery_windows
      where period_id = v_period_id and recorded_seconds > 0 and not (window_index = any (v_indexes))
      for update
    loop
      v_rev_no := v_w.revision_no;
      if v_w.status = 'closed' then
        v_rev_no := v_w.revision_no + 1;
        insert into recovery_window_revisions (window_id, revision_no, recorded_seconds, entitlement_days, classification, starting_local_date, review_flags, reason, actor_id, origin, previous_facts)
        values (v_w.id, v_rev_no, 0, 0, v_w.classification, v_w.starting_local_date, '{}', coalesce(p_reason, 'No recorded work remains in this window'), v_actor, p_origin,
                jsonb_build_object('recorded_seconds', v_w.recorded_seconds, 'entitlement_days', v_w.entitlement_days, 'classification', v_w.classification,
                                   'starting_local_date', v_w.starting_local_date, 'review_flags', to_jsonb(v_w.review_flags), 'revision_no', v_w.revision_no))
        on conflict (window_id, revision_no) do nothing;
      end if;
      update recovery_windows
      set recorded_seconds = 0, entitlement_days = 0, band = 'none', review_flags = '{}', hr_verification_required = false,
          hr_verified_by = null, hr_verified_at = null, hr_verification_note = null, revision_no = v_rev_no, allocation_signature = null, updated_at = now()
      where id = v_w.id;
      delete from recovery_window_allocations where window_id = v_w.id;
      if v_w.status = 'closed' then
        v_created := v_created + recovery_sync_window_requests(v_w.id, v_actor, p_reason, p_origin);
      end if;
    end loop;

    -- HR alerts: deduplicated by key, so repeated runs never raise them twice.
    v_alert_keys := '{}';
    if v_period -> 'long_work_trigger_us' <> 'null'::jsonb and (v_period ->> 'long_work_trigger_us')::bigint <= recovery_us(v_as_of) then
      v_alert_keys := v_alert_keys || (v_period_id::text || ':long_work');
      insert into recovery_alerts (company_id, employee_id, period_id, alert_type, dedup_key, triggered_at, period_started_at, recorded_seconds, elapsed_seconds, details)
      values (
        v_emp.company_id, p_employee_id, v_period_id, 'long_work', v_period_id::text || ':long_work',
        recovery_ts((v_period ->> 'long_work_trigger_us')::bigint), recovery_ts((v_period ->> 'start_us')::bigint),
        (v_period ->> 'recorded_us')::numeric / 1000000, (v_period ->> 'elapsed_us')::numeric / 1000000,
        jsonb_build_object(
          'threshold_hours', (v_period -> 'rules' ->> 'alert_work_hours')::numeric,
          'rest_gap_hours', (v_period -> 'rules' ->> 'rest_gap_hours')::numeric,
          'still_open', (v_period ->> 'has_open')::boolean,
          'gaps', v_period -> 'gaps',
          'note', 'Warning only: recording continues and no recovery day is created by this alert.'
        )
      )
      on conflict (dedup_key) do nothing;
    end if;
    for v_alert in select a from jsonb_array_elements(v_period -> 'rollovers') a loop
      v_alert_keys := v_alert_keys || (v_period_id::text || ':rollover:' || (v_alert ->> 'window_index'));
      insert into recovery_alerts (company_id, employee_id, period_id, alert_type, dedup_key, triggered_at, period_started_at, recorded_seconds, elapsed_seconds, details)
      values (
        v_emp.company_id, p_employee_id, v_period_id, 'window_rollover', v_period_id::text || ':rollover:' || (v_alert ->> 'window_index'),
        recovery_ts((v_alert ->> 'at_us')::bigint), recovery_ts((v_period ->> 'start_us')::bigint),
        (v_alert ->> 'recorded_us')::numeric / 1000000, (v_alert ->> 'elapsed_us')::numeric / 1000000,
        jsonb_build_object(
          'window_index', (v_alert ->> 'window_index')::int,
          'window_hours', (v_period -> 'rules' ->> 'window_hours')::numeric,
          'note', 'The 24 elapsed-hour window rolled over automatically with no completed rest. Elapsed hours are not recorded hours; no manual clock-out was made.'
        )
      )
      on conflict (dedup_key) do nothing;
    end loop;
    update recovery_alerts set status = 'obsolete'
    where period_id = v_period_id and status = 'open' and not (dedup_key = any (v_alert_keys));
  end loop;

  -- Routing that failed earlier (no approver yet) is retried on every pass.
  for v_req in
    select r.id from recovery_credit_requests r
    where r.employee_id = p_employee_id and r.recovery_window_id is not null and r.status = 'submitted'
      and r.applicant_route is not null and r.routing_issue is not null
      and not exists (select 1 from approvals a where a.entity_type = 'recovery_credit' and a.entity_id = r.id and a.step_order = 1)
  loop
    perform recovery_route_request(v_req.id);
  end loop;

  update recovery_processor_failures set resolved_at = now() where employee_id = p_employee_id and resolved_at is null;

  return jsonb_build_object('periods', jsonb_array_length(v_derived -> 'periods'), 'requests_created', v_created, 'as_of', v_as_of);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Readiness (enforced HERE, in the database, not just in the UI) and
--    ledger posting for window requests
-- ---------------------------------------------------------------------

-- NULL when a window-based request may be finally approved right now;
-- otherwise the plain-English reason it may not. Legacy requests: always NULL.
create or replace function recovery_request_blocker(p_request_id uuid)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  r recovery_credit_requests%rowtype;
  w recovery_windows%rowtype;
  v_credited numeric;
  v_expected numeric;
  v_balance numeric;
begin
  select * into r from recovery_credit_requests where id = p_request_id;
  if not found then return 'Recovery credit request not found.'; end if;
  if r.event_type not in ('window', 'window_top_up', 'window_reduction') then return null; end if;

  select * into w from recovery_windows where id = r.recovery_window_id;
  if not found then return 'The recovery window for this request no longer exists.'; end if;
  if w.status <> 'closed' then
    return 'This recovery window has not closed yet. A credit can only be approved for a closed window.';
  end if;
  if exists (select 1 from recovery_periods p where p.id = w.period_id and p.status = 'superseded') then
    return 'The working period for this request was re-derived after a correction; this request is stale.';
  end if;

  v_credited := recovery_window_credited_days(w.id);
  if r.event_type = 'window' then
    v_expected := w.entitlement_days;
  elsif r.event_type = 'window_top_up' then
    v_expected := w.entitlement_days - v_credited;
  else
    v_expected := v_credited - w.entitlement_days;
  end if;
  if r.proposed_days is distinct from v_expected or v_expected <= 0 then
    return 'The evidence for this window changed after the request was created, so its amount is out of date. It is being recalculated; try again shortly.';
  end if;
  if r.window_revision_no is distinct from w.revision_no then
    return 'The window was recalculated after this request was created. Wait for the request to be refreshed.';
  end if;

  if w.hr_verification_required and w.hr_verified_at is null then
    return 'HR must verify this window before it can be approved (reason: ' || array_to_string(w.review_flags, ', ') || ').';
  end if;

  if r.event_type = 'window_reduction' then
    select coalesce(sum(days), 0) into v_balance from comp_day_ledger where employee_id = r.employee_id;
    if v_balance - r.proposed_days < 0 and r.consumption_ack_at is null then
      return 'Part of this credit has already been used. HR must explicitly acknowledge the reduction before it is applied (it would otherwise leave a negative balance).';
    end if;
  end if;
  return null;
end;
$$;

-- Posts the ledger effect of a finally-approved window request. Called from
-- decide_leave_approval() inside the same transaction and the same advisory
-- lock; repeat-safe (a second call posts nothing). Expiry always counts from
-- the window's own date: a top-up never extends it, and a reduction keeps the
-- original entry's dates. Nothing here touches Annual Leave or payroll.
create or replace function recovery_post_window_ledger(p_request_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r recovery_credit_requests%rowtype;
  v_period_rules jsonb;
  v_expiry_days int;
  v_ledger_id uuid;
  v_orig_ledger comp_day_ledger%rowtype;
  v_row record;
  v_remaining numeric;
  v_keep numeric;
begin
  select * into r from recovery_credit_requests where id = p_request_id for update;
  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || r.employee_id::text));

  select p.rules into v_period_rules
  from recovery_windows w join recovery_periods p on p.id = w.period_id where w.id = r.recovery_window_id;
  v_expiry_days := coalesce((v_period_rules ->> 'expiry_days')::int, 180);

  if r.event_type = 'window' then
    select cl.id into v_ledger_id from comp_day_ledger cl
    where cl.reference_type = 'recovery_credit_request' and cl.reference_id = r.id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger x where x.reversal_of_id = cl.id);
    if v_ledger_id is null then
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
      values (r.employee_id, r.work_date, 'earned', r.proposed_days, 'recovery_window', r.work_date + v_expiry_days, 'recovery_credit_request', r.id, p_actor)
      returning id into v_ledger_id;
    end if;

  elsif r.event_type = 'window_top_up' then
    select cl.id into v_ledger_id from comp_day_ledger cl
    where cl.reference_type = 'recovery_credit_request' and cl.reference_id = r.id and cl.entry_type = 'earned'
      and not exists (select 1 from comp_day_ledger x where x.reversal_of_id = cl.id);
    if v_ledger_id is null then
      select cl.* into v_orig_ledger from comp_day_ledger cl
      where cl.reference_type = 'recovery_credit_request' and cl.reference_id = r.adjusts_request_id and cl.entry_type = 'earned'
      order by cl.created_at asc limit 1;
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
      values (
        r.employee_id,
        coalesce(v_orig_ledger.txn_date, r.work_date),
        'earned', r.proposed_days, 'recovery_window_top_up',
        coalesce(v_orig_ledger.expiry_date, r.work_date + v_expiry_days),
        'recovery_credit_request', r.id, p_actor
      )
      returning id into v_ledger_id;
    end if;

  else
    -- Reduction: unwind earned entries for this window newest first, fully
    -- reversing each (never deleting) and re-earning the remainder of the last
    -- one touched, with its original dates, so expiry is preserved.
    v_remaining := r.proposed_days;
    for v_row in
      select cl.*
      from comp_day_ledger cl
      join recovery_credit_requests q on cl.reference_type = 'recovery_credit_request' and cl.reference_id = q.id
      where q.recovery_window_id = r.recovery_window_id and cl.entry_type = 'earned'
        and not exists (select 1 from comp_day_ledger x where x.reversal_of_id = cl.id)
      order by cl.created_at desc, cl.id desc
    loop
      exit when v_remaining <= 0;
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
      values (v_row.employee_id, current_date, 'reversal', -v_row.days, 'recovery_window_reduction', v_row.reference_type, v_row.reference_id, v_row.id, p_actor)
      returning id into v_ledger_id;
      if v_row.days > v_remaining then
        v_keep := v_row.days - v_remaining;
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
        values (v_row.employee_id, v_row.txn_date, 'earned', v_keep, v_row.source, v_row.expiry_date, v_row.reference_type, v_row.reference_id, p_actor);
        v_remaining := 0;
      else
        v_remaining := v_remaining - v_row.days;
      end if;
    end loop;
  end if;

  update recovery_credit_requests
  set status = 'approved', decided_at = now(), comp_day_ledger_id = coalesce(v_ledger_id, comp_day_ledger_id)
  where id = r.id;
  return v_ledger_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Lifecycle wiring: triggers so EVERY path that changes evidence (clock
--    in/out, mode switch, HR closure, HR correction, add-missing) runs the
--    same engine. A failure here is recorded for the processor to retry and
--    never fails the employee's own clock action.
-- ---------------------------------------------------------------------

-- Fixes each session's calculation model at insert. The value is always
-- derived here — an inserted value is ignored, so it cannot be spoofed.
create or replace function recovery_session_assign_model()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
begin
  select country_code into v_country from employees where id = new.employee_id;
  if v_country is not null and exists (
    select 1 from recovery_windows_policy_for(v_country, (new.clock_in_at at time zone country_timezone(v_country))::date)
  ) then
    new.recovery_model := 'windowed';
  else
    new.recovery_model := 'legacy';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_sessions_assign_recovery_model on attendance_sessions;
create trigger attendance_sessions_assign_recovery_model
  before insert on attendance_sessions
  for each row execute function recovery_session_assign_model();

-- A recorded session may never end in the future, and a recording never
-- overlaps another recording of the same employee. Applies to sessions on the
-- window model only: legacy sessions keep exactly the behaviour they had.
create or replace function guard_attendance_session_timing()
returns trigger
language plpgsql
as $$
begin
  if new.recovery_model <> 'windowed' then
    return new;
  end if;
  if new.clock_out_at is not null and new.clock_out_at > recovery_now() + interval '1 minute' then
    raise exception 'A clock-out time cannot be in the future.';
  end if;
  if new.clock_in_at > recovery_now() + interval '1 minute' then
    raise exception 'A clock-in time cannot be in the future.';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_sessions_guard_timing on attendance_sessions;
create trigger attendance_sessions_guard_timing
  before insert or update of clock_in_at, clock_out_at on attendance_sessions
  for each row execute function guard_attendance_session_timing();

create or replace function guard_attendance_segment_overlap()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from attendance_sessions ses where ses.id = new.session_id and ses.recovery_model = 'windowed') then
    return new;
  end if;
  if exists (
    select 1 from attendance_segments s
    where s.employee_id = new.employee_id and s.id <> new.id
      and tstzrange(s.segment_start, coalesce(s.segment_end, 'infinity'::timestamptz), '[)')
          && tstzrange(new.segment_start, coalesce(new.segment_end, 'infinity'::timestamptz), '[)')
  ) then
    raise exception 'This recording overlaps another recorded work segment for the same employee. Overlapping evidence is never merged automatically; review it first.';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_segments_guard_overlap on attendance_segments;
create trigger attendance_segments_guard_overlap
  before insert or update of segment_start, segment_end on attendance_segments
  for each row execute function guard_attendance_segment_overlap();

create or replace function recovery_on_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid := new.employee_id;
begin
  -- HR correction functions set this so they can run the engine ONCE, after
  -- all their edits, with the correction reason and actor attached.
  if coalesce(current_setting('recovery.defer', true), '') = 'on' then
    return null;
  end if;
  begin
    perform recovery_recalculate_employee(v_employee_id, null, 'engine');
  exception when others then
    insert into recovery_processor_failures (employee_id, error) values (v_employee_id, sqlerrm);
  end;
  return null;
end;
$$;

drop trigger if exists attendance_segments_recovery_engine on attendance_segments;
create trigger attendance_segments_recovery_engine
  after insert or update on attendance_segments
  for each row execute function recovery_on_attendance_change();

drop trigger if exists attendance_sessions_recovery_engine on attendance_sessions;
create trigger attendance_sessions_recovery_engine
  after update on attendance_sessions
  for each row
  when (old.status is distinct from new.status or old.clock_out_at is distinct from new.clock_out_at or old.hr_closed_at is distinct from new.hr_closed_at)
  execute function recovery_on_attendance_change();

-- ---------------------------------------------------------------------
-- 9. HR actions: verify a window, acknowledge an alert / a reduction,
--    correct or add attendance evidence
-- ---------------------------------------------------------------------

create or replace function hr_verify_recovery_window(p_window_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w recovery_windows%rowtype;
begin
  select * into w from recovery_windows where id = p_window_id for update;
  if not found then raise exception 'Recovery window not found.'; end if;
  if not has_role('hr_admin', w.company_id) then
    raise exception 'Only HR Admin may verify a recovery window.';
  end if;
  if w.status <> 'closed' then
    raise exception 'Only a closed recovery window can be verified.';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'Describe what you checked (for example the person you confirmed the work with) when verifying a window.';
  end if;
  update recovery_windows
  set hr_verified_by = auth.uid(), hr_verified_at = now(), hr_verification_note = p_note, updated_at = now()
  where id = p_window_id;
end;
$$;

create or replace function hr_acknowledge_recovery_reduction(p_request_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r recovery_credit_requests%rowtype;
  v_company uuid;
begin
  select * into r from recovery_credit_requests where id = p_request_id for update;
  if not found or r.event_type <> 'window_reduction' then raise exception 'Reduction request not found.'; end if;
  select company_id into v_company from employees where id = r.employee_id;
  if not has_role('hr_admin', v_company) then raise exception 'Only HR Admin may acknowledge a reduction.'; end if;
  if r.status not in ('submitted', 'pending_approval') then raise exception 'This reduction has already been decided.'; end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'A note is required: explain how the already-used balance will be handled.';
  end if;
  update recovery_credit_requests
  set consumption_ack_by = auth.uid(), consumption_ack_at = now(), consumption_ack_note = p_note
  where id = p_request_id;
end;
$$;

create or replace function acknowledge_recovery_alert(p_alert_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a recovery_alerts%rowtype;
begin
  select * into a from recovery_alerts where id = p_alert_id for update;
  if not found then raise exception 'Alert not found.'; end if;
  if not has_role('hr_admin', a.company_id) then raise exception 'Only HR Admin may acknowledge this alert.'; end if;
  if a.status <> 'open' then raise exception 'This alert is no longer open.'; end if;
  update recovery_alerts
  set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now(), acknowledgement_note = nullif(trim(p_note), '')
  where id = p_alert_id;
end;
$$;

create or replace function get_recovery_request_blocker(p_request_id uuid)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_lead uuid;
begin
  select employee_id, project_lead_employee_id into v_employee, v_lead from recovery_credit_requests where id = p_request_id;
  if v_employee is null then return null; end if;
  if not (can_view_recovery_evidence(v_employee) or v_lead = current_employee_id()
          or exists (select 1 from approvals a where a.entity_type = 'recovery_credit' and a.entity_id = p_request_id and a.approver_id = auth.uid())) then
    return null;
  end if;
  return recovery_request_blocker(p_request_id);
end;
$$;

-- HR corrects the recorded start/end of a CLOSED session. The original and the
-- corrected values are both kept (attendance_session_corrections), the reason
-- is mandatory, a future clock-out and overlapping recordings are refused, and
-- the engine then recomputes periods, windows, alerts, classification and any
-- affected requests in the same transaction. A correction that would move a
-- working period that already has an approved credit is refused.
create or replace function hr_correct_attendance_session(
  p_session_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s attendance_sessions%rowtype;
  v_company uuid;
  v_country text;
  v_tz text;
  v_first attendance_segments%rowtype;
  v_last attendance_segments%rowtype;
  v_date date;
  v_dates date[] := '{}';
begin
  select * into s from attendance_sessions where id = p_session_id for update;
  if not found then raise exception 'Attendance session not found.'; end if;
  select company_id, country_code into v_company, v_country from employees where id = s.employee_id;
  if not has_role('hr_admin', v_company) then raise exception 'Only HR Admin may correct attendance.'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'A reason is required to correct attendance.'; end if;
  if s.status <> 'closed' then
    raise exception 'Only a closed session can be corrected here. Use "close missing clock-out" for a session that is still open.';
  end if;
  if s.recovery_model <> 'windowed' then
    raise exception 'This session was recorded under the previous Recovery Leave calculation and keeps it. It cannot be edited with the window-based tools.';
  end if;
  if p_clock_in_at is null or p_clock_out_at is null or p_clock_out_at <= p_clock_in_at then
    raise exception 'The corrected clock-out must be after the corrected clock-in.';
  end if;
  if p_clock_out_at > recovery_now() then raise exception 'A clock-out time cannot be in the future.'; end if;

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || s.employee_id::text));
  v_tz := country_timezone(v_country);

  select * into v_first from attendance_segments where session_id = s.id order by segment_start asc, id asc limit 1 for update;
  select * into v_last from attendance_segments where session_id = s.id order by segment_start desc, id desc limit 1 for update;
  if v_first.id is null then raise exception 'This session has no recorded work segment.'; end if;
  if v_first.id = v_last.id then
    if p_clock_in_at >= p_clock_out_at then raise exception 'The corrected clock-out must be after the corrected clock-in.'; end if;
  else
    if p_clock_in_at >= v_first.segment_end then raise exception 'The corrected clock-in must be before the first mode segment ends (%).', v_first.segment_end; end if;
    if p_clock_out_at <= v_last.segment_start then raise exception 'The corrected clock-out must be after the last mode segment starts (%).', v_last.segment_start; end if;
  end if;

  select coalesce(array_agg(distinct (t at time zone v_tz)::date), '{}') into v_dates
  from (select segment_start t from attendance_segments where session_id = s.id) x;

  perform set_config('recovery.defer', 'on', true);
  insert into attendance_session_corrections (session_id, employee_id, kind, original_clock_in_at, original_clock_out_at, corrected_clock_in_at, corrected_clock_out_at, reason, actor_id)
  values (s.id, s.employee_id, 'correct_times', s.clock_in_at, s.clock_out_at, p_clock_in_at, p_clock_out_at, p_reason, auth.uid());

  if v_first.id = v_last.id then
    update attendance_segments set segment_start = p_clock_in_at, segment_end = p_clock_out_at where id = v_first.id;
  else
    update attendance_segments set segment_start = p_clock_in_at where id = v_first.id;
    update attendance_segments set segment_end = p_clock_out_at where id = v_last.id;
  end if;
  update attendance_sessions set clock_in_at = p_clock_in_at, clock_out_at = p_clock_out_at where id = s.id;
  perform set_config('recovery.defer', 'off', true);

  select coalesce(array_agg(distinct d), '{}') into v_dates
  from (
    select unnest(v_dates) d
    union
    select (segment_start at time zone v_tz)::date from attendance_segments where session_id = s.id
  ) y;
  foreach v_date in array v_dates loop
    perform sync_attendance_presence_for_day(s.employee_id, v_date);
  end loop;

  perform recovery_recalculate_employee(s.employee_id, null, 'hr_correction', p_reason, auth.uid());
end;
$$;

-- "Add missing attendance": HR records a past shift the employee never
-- clocked. It is stored as a normal closed session flagged recorded_by_hr (so
-- it can never look like a live Clocked-in state), with an explicit reason, and
-- goes through exactly the same calculation as any other evidence.
create or replace function hr_add_missing_attendance(
  p_employee_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
  p_work_mode text,
  p_project_name text,
  p_project_lead_employee_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_country text;
  v_tz text;
  v_session_id uuid;
  v_segment_id uuid;
  v_date date;
  v_model text;
begin
  select company_id, country_code into v_company, v_country from employees where id = p_employee_id and deleted_at is null;
  if v_company is null then raise exception 'Employee not found.'; end if;
  if not has_role('hr_admin', v_company) then raise exception 'Only HR Admin may add missing attendance.'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'A reason is required to add missing attendance.'; end if;
  if p_work_mode not in ('office', 'wfh', 'site_work', 'client_meeting', 'business_travel') then
    raise exception 'Invalid work mode: %', p_work_mode;
  end if;
  if p_work_mode = 'site_work' and (p_project_name is null or length(trim(p_project_name)) = 0 or p_project_lead_employee_id is null) then
    raise exception 'Site work / Installation requires a project name and a project lead.';
  end if;
  if p_project_lead_employee_id is not null and not exists (
    select 1 from employees e where e.id = p_project_lead_employee_id and e.company_id = v_company and e.employment_status = 'active' and e.deleted_at is null
  ) then
    raise exception 'The project lead must be a currently active employee of the same company.';
  end if;
  if p_clock_in_at is null or p_clock_out_at is null or p_clock_out_at <= p_clock_in_at then
    raise exception 'The clock-out must be after the clock-in.';
  end if;
  if p_clock_out_at > recovery_now() then raise exception 'A clock-out time cannot be in the future.'; end if;

  perform pg_advisory_xact_lock(hashtext('attendance_session:' || p_employee_id::text));
  v_tz := country_timezone(v_country);

  perform set_config('recovery.defer', 'on', true);
  insert into attendance_sessions (employee_id, clock_in_at, clock_out_at, status, recorded_by_hr, recorded_by_hr_by, recorded_by_hr_at, recorded_by_hr_reason)
  values (p_employee_id, p_clock_in_at, p_clock_out_at, 'closed', true, auth.uid(), now(), p_reason)
  returning id, recovery_model into v_session_id, v_model;
  insert into attendance_segments (session_id, employee_id, work_mode, project_name, project_lead_employee_id, segment_start, segment_end)
  values (v_session_id, p_employee_id, p_work_mode, nullif(trim(p_project_name), ''), p_project_lead_employee_id, p_clock_in_at, p_clock_out_at)
  returning id into v_segment_id;
  insert into attendance_session_corrections (session_id, employee_id, kind, original_clock_in_at, original_clock_out_at, corrected_clock_in_at, corrected_clock_out_at, reason, actor_id)
  values (v_session_id, p_employee_id, 'add_missing', null, null, p_clock_in_at, p_clock_out_at, p_reason, auth.uid());
  perform set_config('recovery.defer', 'off', true);

  v_date := (p_clock_in_at at time zone v_tz)::date;
  perform sync_attendance_presence_for_day(p_employee_id, v_date);
  if v_model = 'windowed' then
    perform recovery_recalculate_employee(p_employee_id, null, 'hr_correction', p_reason, auth.uid());
  else
    perform sync_attendance_recovery_for_day(p_employee_id, v_date);
  end if;
  return v_session_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Background processor and its status
-- ---------------------------------------------------------------------

-- Catches up every employee with an open working period (or a recorded
-- failure, or routing waiting for an approver): closes windows whose 24 elapsed
-- hours have passed, creates requests, raises HR alerts, and retries earlier
-- failures. Each employee runs in its own sub-transaction so one failure never
-- blocks the rest; failures are recorded and visible. Idempotent — a delayed or
-- repeated run only ever finishes unfinished work, deriving every boundary
-- passed since the last run from the evidence itself.
--
-- Not callable by signed-in users (see grants below): pg_cron (owner-enabled)
-- and the protected Vercel route (service role) are the only callers. It acts
-- under no HR identity — audit rows it causes carry origin = 'processor'.
create or replace function recovery_process_due(p_origin text default 'manual', p_as_of timestamptz default null, p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, recovery_now());
  v_run uuid;
  v_emp uuid;
  v_examined int := 0;
  v_failed int := 0;
  v_first_error text;
  v_status text;
begin
  if not pg_try_advisory_xact_lock(hashtext('recovery_processor')) then
    return jsonb_build_object('status', 'skipped_already_running');
  end if;
  perform set_config('app.audit_origin', 'processor', true);

  insert into recovery_processor_runs (origin, as_of, started_at) values (p_origin, v_as_of, recovery_now()) returning id into v_run;

  for v_emp in
    select distinct c.employee_id from (
      select employee_id from recovery_periods where status = 'open'
      union
      select employee_id from attendance_sessions where status = 'open' and recovery_model = 'windowed'
      union
      select employee_id from recovery_processor_failures where resolved_at is null
      union
      select employee_id from recovery_credit_requests
      where recovery_window_id is not null and status = 'submitted' and routing_issue is not null
    ) c
    limit p_limit
  loop
    v_examined := v_examined + 1;
    begin
      perform recovery_recalculate_employee(v_emp, v_as_of, 'processor');
    exception when others then
      v_failed := v_failed + 1;
      v_first_error := coalesce(v_first_error, sqlerrm);
      insert into recovery_processor_failures (run_id, employee_id, error) values (v_run, v_emp, sqlerrm);
    end;
  end loop;

  v_status := case when v_failed = 0 then 'succeeded' when v_failed < v_examined then 'partial' else 'failed' end;
  update recovery_processor_runs
  set finished_at = recovery_now(), status = v_status, employees_examined = v_examined, employees_failed = v_failed, error_summary = v_first_error
  where id = v_run;

  return jsonb_build_object('status', v_status, 'run_id', v_run, 'examined', v_examined, 'failed', v_failed, 'as_of', v_as_of);
end;
$$;

-- Read-only health of the background processing, for the HR alerts page and
-- the owner's deployment checks. Reports what is actually true: when it last
-- succeeded, whether anything is waiting, and whether pg_cron has a job.
create or replace function recovery_scheduler_status()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_last record;
  v_last_ok timestamptz;
  v_waiting int;
  v_failures int;
  v_cron_installed boolean := to_regclass('cron.job') is not null;
  v_job jsonb := null;
  v_windowed_active boolean;
begin
  if not (has_role_any_scope('hr_admin') or has_role_any_scope('sys_admin')) then
    raise exception 'Only HR Admin or Sys Admin may read the Recovery Leave processor status.';
  end if;
  select * into v_last from recovery_processor_runs order by started_at desc limit 1;
  select max(finished_at) into v_last_ok from recovery_processor_runs where status in ('succeeded', 'partial');
  select count(*) into v_waiting from recovery_periods where status = 'open';
  select count(*) into v_failures from recovery_processor_failures where resolved_at is null;
  select exists (select 1 from policy_versions where policy_type = 'overtime_rules' and status = 'active' and payload ->> 'model' = 'recovery_windows') into v_windowed_active;
  if v_cron_installed then
    execute $q$select to_jsonb(j) from (select jobid, jobname, schedule, active from cron.job where jobname = 'recovery-window-processor') j$q$ into v_job;
  end if;
  return jsonb_build_object(
    'windows_policy_active', v_windowed_active,
    'open_periods', v_waiting,
    'open_failures', v_failures,
    'last_run', case when v_last.id is null then null else jsonb_build_object('started_at', v_last.started_at, 'finished_at', v_last.finished_at, 'status', v_last.status, 'origin', v_last.origin, 'employees_examined', v_last.employees_examined, 'employees_failed', v_last.employees_failed) end,
    'last_success_at', v_last_ok,
    'seconds_since_last_success', case when v_last_ok is null then null else extract(epoch from (recovery_now() - v_last_ok)) end,
    'stale', v_windowed_active and v_waiting > 0 and (v_last_ok is null or recovery_now() - v_last_ok > interval '20 minutes'),
    'pg_cron_installed', v_cron_installed,
    'pg_cron_job', v_job,
    'expected_interval_minutes', 5
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Read models used by the HR register and the dashboard
-- ---------------------------------------------------------------------

-- The automatic, read-first daily register. SECURITY INVOKER on purpose: the
-- caller's own row-level security decides which employees and sessions they
-- see. Clock state comes from actual sessions; attendance presence stays
-- separate (a person stays Present after clocking out); nothing infers an
-- absence — an employee with no evidence is "not started / not recorded".
create or replace function attendance_register_for_date(p_company_id uuid, p_date date)
returns table (
  employee_id uuid,
  employee_name text,
  country_code text,
  timezone text,
  clock_status text,
  attendance_status text,
  attendance_source text,
  work_modes text[],
  first_clock_in timestamptz,
  last_clock_out timestamptz,
  recorded_seconds numeric,
  is_provisional boolean,
  open_since timestamptz,
  session_count int,
  recovery_summary text,
  review_flags text[],
  open_alert_count int,
  presence_conflict text,
  on_leave boolean,
  hr_recorded boolean,
  manual_hours numeric
)
language sql stable
set search_path = public
as $$
  with emps as (
    select e.id, trim(e.first_name || ' ' || e.last_name) as name, e.country_code as cc, country_timezone(e.country_code) as tz
    from employees e
    where e.company_id = p_company_id and e.deleted_at is null and e.employment_status <> 'terminated'
  ),
  seg as (
    select e.id as emp, s.work_mode, s.segment_start, s.segment_end, ses.id as session_id, ses.clock_in_at, ses.clock_out_at, ses.status as session_status, ses.recorded_by_hr
    from emps e
    join attendance_segments s on s.employee_id = e.id
    join attendance_sessions ses on ses.id = s.session_id
    where (s.segment_start at time zone e.tz)::date = p_date
  ),
  agg as (
    select emp,
      array_agg(distinct work_mode) as modes,
      min(segment_start) as first_in,
      case when bool_or(segment_end is null) then null else max(segment_end) end as last_out,
      sum(extract(epoch from (coalesce(segment_end, recovery_now()) - segment_start))) as secs,
      bool_or(segment_end is null) as provisional,
      count(distinct session_id)::int as sessions,
      bool_or(recorded_by_hr) as hr_rec
    from seg group by emp
  ),
  opn as (
    select ses.employee_id as emp, min(ses.clock_in_at) as since
    from attendance_sessions ses
    join emps e on e.id = ses.employee_id
    where ses.status = 'open' and (ses.clock_in_at at time zone e.tz)::date <= p_date
      and p_date <= (recovery_now() at time zone e.tz)::date
    group by ses.employee_id
  ),
  win as (
    select w.employee_id as emp,
      array_agg(distinct f) filter (where f is not null) as flags,
      bool_or(w.hr_verification_required and w.hr_verified_at is null) as needs_verification,
      bool_or(w.status = 'open' and w.recorded_seconds > 0) as has_open,
      bool_or(r.status = 'approved') as has_approved,
      bool_or(r.status in ('submitted', 'pending_approval')) as has_pending,
      bool_or(r.routing_issue is not null and r.status = 'submitted') as has_routing_issue,
      bool_or(w.status = 'closed' and w.entitlement_days > 0) as has_earning
    from recovery_windows w
    join emps e on e.id = w.employee_id
    left join lateral unnest(w.review_flags) f on true
    left join recovery_credit_requests r on r.recovery_window_id = w.id and r.event_type = 'window' and r.status not in ('cancelled', 'rejected')
    where w.starting_local_date = p_date
    group by w.employee_id
  ),
  alr as (
    select a.employee_id as emp, count(*)::int as n
    from recovery_alerts a join emps e on e.id = a.employee_id
    where a.status = 'open' and (a.triggered_at at time zone e.tz)::date = p_date
    group by a.employee_id
  ),
  lv as (
    select distinct lr.employee_id as emp
    from leave_requests lr
    where lr.status = 'approved' and lr.deleted_at is null and p_date between lr.start_date and lr.end_date
  )
  select
    e.id,
    e.name,
    e.cc,
    e.tz,
    case when opn.emp is not null then 'clocked_in' when agg.emp is not null then 'clocked_out' else 'not_started' end,
    coalesce(ar.status, case when agg.emp is not null then 'present' else 'not_recorded' end),
    ar.source,
    coalesce(agg.modes, '{}'::text[]),
    agg.first_in,
    agg.last_out,
    coalesce(agg.secs, 0)::numeric,
    coalesce(agg.provisional, false) or opn.emp is not null,
    opn.since,
    coalesce(agg.sessions, 0),
    case
      when win.emp is null then 'none'
      when win.needs_verification or win.has_routing_issue then 'needs_review'
      when win.has_approved then 'approved'
      when win.has_pending then 'awaiting_approval'
      when win.has_open then 'awaiting_closure'
      when win.has_earning then 'awaiting_approval'
      else 'none'
    end,
    coalesce(win.flags, '{}'::text[]),
    coalesce(alr.n, 0),
    ar.presence_conflict,
    (lv.emp is not null),
    coalesce(agg.hr_rec, false),
    ar.hours_worked
  from emps e
  left join agg on agg.emp = e.id
  left join opn on opn.emp = e.id
  left join win on win.emp = e.id
  left join alr on alr.emp = e.id
  left join lv on lv.emp = e.id
  left join attendance_records ar on ar.employee_id = e.id and ar.work_date = p_date
  order by e.name;
$$;

-- The dashboard clock card's data. Read-only; computed live from the evidence
-- (so the hours are right to the second between background runs). Provisional
-- recovery is only ever a STATUS — never an available balance.
create or replace function recovery_live_summary(p_employee_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_now timestamptz := recovery_now();
  v_country text;
  v_tz text;
  v_open attendance_sessions%rowtype;
  v_seg attendance_segments%rowtype;
  v_derived jsonb;
  v_period jsonb;
  v_win jsonb;
  v_status text;
  v_today date;
  v_any_today boolean;
  v_request_status text;
  v_request_id uuid;
begin
  if not can_view_recovery_evidence(p_employee_id) then
    raise exception 'You may not view this employee''s attendance status.';
  end if;
  select country_code into v_country from employees where id = p_employee_id;
  if v_country is null then return jsonb_build_object('linked', false); end if;
  v_tz := country_timezone(v_country);
  v_today := (v_now at time zone v_tz)::date;

  select * into v_open from attendance_sessions where employee_id = p_employee_id and status = 'open' limit 1;
  if v_open.id is not null then
    select * into v_seg from attendance_segments where session_id = v_open.id and segment_end is null limit 1;
    v_status := 'clocked_in';
  else
    select exists (select 1 from attendance_segments s where s.employee_id = p_employee_id and (s.segment_start at time zone v_tz)::date = v_today) into v_any_today;
    v_status := case when v_any_today then 'clocked_out' else 'not_started' end;
  end if;

  v_derived := recovery_derive(p_employee_id, v_now);
  -- The CURRENT period is the latest one that has not completed its rest.
  select p into v_period from jsonb_array_elements(v_derived -> 'periods') p
  where not (p ->> 'ended')::boolean
  order by (p ->> 'start_us')::bigint desc limit 1;

  if v_period is not null then
    select w into v_win from jsonb_array_elements(v_period -> 'windows') w
    order by (w ->> 'index')::int desc limit 1;
    if v_win is not null then
      select r.id, r.status::text into v_request_id, v_request_status
      from recovery_credit_requests r
      join recovery_windows rw on rw.id = r.recovery_window_id
      join recovery_periods rp on rp.id = rw.period_id
      where rp.employee_id = p_employee_id and rp.started_at = recovery_ts((v_period ->> 'start_us')::bigint) and rp.status <> 'superseded'
        and rw.window_index = (v_win ->> 'index')::int and r.event_type = 'window' and r.status not in ('cancelled', 'rejected')
      limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'linked', true,
    'as_of', v_now,
    'timezone', v_tz,
    'country_code', v_country,
    'clock_status', v_status,
    'open_since', v_open.clock_in_at,
    'work_mode', v_seg.work_mode,
    'project_name', v_seg.project_name,
    'windowed', (v_period is not null) or exists (select 1 from attendance_sessions where employee_id = p_employee_id and recovery_model = 'windowed' limit 1),
    'period', case when v_period is null then null else jsonb_build_object(
      'started_at', recovery_ts((v_period ->> 'start_us')::bigint),
      'elapsed_seconds', ((v_period ->> 'last_work_end_us')::bigint - (v_period ->> 'start_us')::bigint) / 1000000.0,
      'recorded_seconds', (v_period ->> 'recorded_us')::numeric / 1000000,
      'rest_completes_at', case when v_period -> 'rest_completes_us' = 'null'::jsonb then null else recovery_ts((v_period ->> 'rest_completes_us')::bigint) end,
      'rollover_count', jsonb_array_length(v_period -> 'rollovers'),
      'long_work_warning', (v_period -> 'long_work_trigger_us' <> 'null'::jsonb) and ((v_period ->> 'long_work_trigger_us')::bigint <= recovery_us(v_now)),
      'alert_work_hours', (v_period -> 'rules' ->> 'alert_work_hours')::numeric,
      'rest_gap_hours', (v_period -> 'rules' ->> 'rest_gap_hours')::numeric
    ) end,
    'window', case when v_win is null then null else jsonb_build_object(
      'index', (v_win ->> 'index')::int,
      'started_at', recovery_ts((v_win ->> 'start_us')::bigint),
      'ends_at', recovery_ts((v_win ->> 'end_us')::bigint),
      'recorded_seconds', (v_win ->> 'recorded_us')::numeric / 1000000,
      'closed', (v_win ->> 'closed')::boolean,
      'classification', v_win ->> 'classification',
      'entitlement_days', (v_win ->> 'entitlement_days')::numeric,
      'review_flags', v_win -> 'review_flags',
      'request_status', v_request_status
    ) end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Audit and privileges
-- ---------------------------------------------------------------------

create trigger audit_recovery_periods_insert after insert on recovery_periods
  for each row execute function write_audit_log();
create trigger audit_recovery_periods_update after update on recovery_periods
  for each row when (old.status is distinct from new.status)
  execute function write_audit_log();
create trigger audit_recovery_windows_insert after insert on recovery_windows
  for each row execute function write_audit_log();
create trigger audit_recovery_windows_update after update on recovery_windows
  for each row when (
    old.status is distinct from new.status or old.entitlement_days is distinct from new.entitlement_days
    or old.revision_no is distinct from new.revision_no or old.hr_verified_at is distinct from new.hr_verified_at
  )
  execute function write_audit_log();
create trigger audit_recovery_alerts after insert or update on recovery_alerts
  for each row execute function write_audit_log();
create trigger audit_attendance_session_corrections after insert on attendance_session_corrections
  for each row execute function write_audit_log();

-- New functions are executable by PUBLIC by default. Internal engine pieces and
-- anything that reasons about OTHER people's roles are for the database itself
-- (and the owner) only.
revoke execute on function
  recovery_derive(uuid, timestamptz),
  recovery_derive_period(uuid, text, text, uuid, jsonb, jsonb, bigint),
  recovery_recalculate_employee(uuid, timestamptz, text, text, uuid),
  recovery_sync_window_requests(uuid, uuid, text, text),
  recovery_route_request(uuid),
  recovery_route_for_employee(uuid, uuid),
  recovery_eligible_approver_exists(uuid, app_role[], uuid),
  recovery_cancel_request(uuid, text),
  recovery_window_credited_days(uuid),
  recovery_request_blocker(uuid),
  recovery_post_window_ledger(uuid, uuid),
  recovery_process_due(text, timestamptz, int),
  user_has_role(uuid, app_role, uuid, text),
  recovery_windows_policy_for(text, date)
from public, anon, authenticated;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function recovery_process_due(text, timestamptz, int) to service_role;
  end if;
end
$grants$;
