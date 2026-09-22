-- =============================================================================
-- Phase 1 — Employee master data & contracts
--
-- Scope per docs/06-implementation-phases.md: employment_contracts,
-- compensation_details, identity_documents (the sensitive tiers split out
-- from `employees` per docs/02-database-schema.md §2.3), storage buckets for
-- the files they reference, and the soft-delete recovery path for HR/Sys
-- Admin that Phase 0's employees_select policy didn't yet support.
--
-- Never edit 20260922000000_phase0_foundations.sql to make these changes —
-- correcting an already-applied migration is a new migration, exactly like
-- a policy correction is a new policy_versions row (see
-- docs/09-extending-the-system.md). The two fixes below to Phase 0's
-- policies are the worked example of that rule.
-- =============================================================================

create type contract_type as enum (
  'permanent', 'fixed_term', 'probation', 'contractor'
);

-- -----------------------------------------------------------------------------
-- Fix 1: employees_select from Phase 0 required `deleted_at is null` for
-- every role, including HR Admin/Sys Admin — which made a soft-deleted
-- employee unrecoverable, since nobody could even see the row to restore it.
-- HR Admin and Sys Admin now bypass that filter (matching "recoverable by
-- HR Admin/Sys Admin" from docs/02-database-schema.md §2.8); every other
-- role is unaffected.
-- -----------------------------------------------------------------------------

drop policy employees_select on employees;

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

-- -----------------------------------------------------------------------------
-- Fix 2: Phase 0 gave `employees` exactly one UPDATE policy (HR Admin), so
-- self-service contact info edit — required by this phase's exit criteria —
-- had no policy to run under at all. RLS is row-level, not column-level, so
-- "self can change personal_email/phone but nothing else" needs an ordinary
-- self-scoped UPDATE policy PLUS a trigger that rejects any other column
-- changing, unless the actor is HR Admin (who already has the separate
-- employees_update_hr policy and passes straight through here).
-- -----------------------------------------------------------------------------

create policy employees_update_self on employees for update
  using (id = current_employee_id())
  with check (id = current_employee_id());

create or replace function guard_employee_self_update()
returns trigger
language plpgsql
as $$
begin
  -- Triggers fire regardless of role, unlike RLS — so a trusted backend
  -- write (a migration, a seed script, an admin/service-role operation with
  -- no PostgREST JWT session at all) has auth.uid() = null and is never
  -- what this guard is meant to constrain. Only an interactive,
  -- JWT-authenticated update that isn't HR Admin gets restricted.
  if auth.uid() is null or has_role('hr_admin', new.company_id) then
    return new; -- HR Admin's employees_update_hr policy already covers full edit rights
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

-- -----------------------------------------------------------------------------
-- employment_contracts — append-only history (docs/02-database-schema.md §2.3)
-- -----------------------------------------------------------------------------

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
-- resolve_policy() for country rules, docs/02-database-schema.md §2.4).
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

alter table employment_contracts enable row level security;

-- Employee: own, every version. Line Manager: team, current version only —
-- historical contract terms aren't a manager's business, just the standing
-- one. HR Admin: full. Finance/CEO: read. Sys Admin: no access (matches
-- permission matrix §3.1 exactly).
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
-- is_current/superseded_by when a new one is inserted — never editing a
-- version's terms after the fact. Not mechanically restricted to those two
-- columns (Postgres RLS doesn't do column-level restriction), so this
-- remains a process convention enforced by the app layer's
-- superseding call, same trust level the permission matrix already gives
-- HR Admin ("F" — full) for this resource.
create policy employment_contracts_update on employment_contracts for update
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- -----------------------------------------------------------------------------
-- compensation_details — sensitive tier 1 (salary & bank)
-- -----------------------------------------------------------------------------

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

alter table compensation_details enable row level security;

-- HR Admin + Finance: full within their company. Employee: read own only,
-- never write (decisions log #1 — bank details are employee-visible,
-- read-only). Line Manager/CEO/Sys Admin: no access at all.
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

-- -----------------------------------------------------------------------------
-- identity_documents — sensitive tier 2 (government ID)
-- -----------------------------------------------------------------------------

create table identity_documents (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id),
  document_type     text not null,        -- 'passport' | 'emirates_id' | 'iqama' | 'pesel' | ...
  document_number   text not null,
  issuing_country   text,
  issue_date        date,
  expiry_date       date,
  file_path         text,                 -- storage path in `identity-documents`
  is_current        boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid not null
);

alter table identity_documents enable row level security;

-- HR Admin only + employee reads their own — never Finance/line managers
-- (permission matrix §3.1: identity documents are HR Admin's alone).
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

-- =============================================================================
-- Storage: employee-documents (contracts, letters, general HR files) and
-- identity-documents (passports/IDs), private buckets, path convention
-- `{company_id}/{employee_id}/{doc_type}/{filename}` — docs/02-database-schema.md §2.9.
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('employee-documents', 'employee-documents', false),
  ('identity-documents', 'identity-documents', false)
on conflict (id) do nothing;

-- employee-documents: owner reads their own files, HR Admin reads/writes
-- everything in their company. Sys Admin has no content access (matches
-- docs/02-database-schema.md §2.9's bucket table exactly).
create policy employee_documents_select on storage.objects for select
  using (
    bucket_id = 'employee-documents'
    and (
      (storage.foldername(name))[2]::uuid = current_employee_id()
      or has_role('hr_admin', (storage.foldername(name))[1]::uuid)
    )
  );

create policy employee_documents_write on storage.objects for insert
  with check (
    bucket_id = 'employee-documents'
    and has_role('hr_admin', (storage.foldername(name))[1]::uuid)
  );

create policy employee_documents_update on storage.objects for update
  using (
    bucket_id = 'employee-documents'
    and has_role('hr_admin', (storage.foldername(name))[1]::uuid)
  );

create policy employee_documents_delete on storage.objects for delete
  using (
    bucket_id = 'employee-documents'
    and has_role('hr_admin', (storage.foldername(name))[1]::uuid)
  );

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
  with check (
    bucket_id = 'identity-documents'
    and has_role('hr_admin', (storage.foldername(name))[1]::uuid)
  );

create policy identity_documents_update on storage.objects for update
  using (
    bucket_id = 'identity-documents'
    and has_role('hr_admin', (storage.foldername(name))[1]::uuid)
  );

create policy identity_documents_delete on storage.objects for delete
  using (
    bucket_id = 'identity-documents'
    and has_role('hr_admin', (storage.foldername(name))[1]::uuid)
  );
