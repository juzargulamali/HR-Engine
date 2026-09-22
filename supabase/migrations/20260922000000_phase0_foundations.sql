-- =============================================================================
-- Phase 0 — Foundations
--
-- Scope per docs/06-implementation-phases.md: auth/tenancy skeleton only.
-- countries, companies, departments, profiles, user_roles, employees (core
-- columns — no compensation/identity/appraisal data yet, those are separate
-- tables added in later phases per docs/02-database-schema.md §2.3), the RLS
-- helper functions, and RLS on every table created here.
--
-- This is a subset of schema/schema.sql, the full target schema. Each later
-- phase adds its own migration file; nothing here will need to change shape
-- to accommodate them — see docs/09-extending-the-system.md.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
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

-- -----------------------------------------------------------------------------
-- Shared trigger utility (reused by every later migration — see
-- docs/09-extending-the-system.md "adding a table" checklist)
-- -----------------------------------------------------------------------------

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
-- Org & identity
-- -----------------------------------------------------------------------------

create table countries (
  code              text primary key,          -- ISO 3166-1 alpha-2: 'AE', 'SA', 'PL'
  name              text not null,
  default_currency  text not null,               -- ISO 4217: 'AED', 'SAR', 'PLN'
  week_start_day    smallint not null default 1, -- 0=Sunday .. 6=Saturday
  created_at        timestamptz not null default now()
);

create table companies (
  id                uuid primary key default gen_random_uuid(),
  legal_name        text not null,
  country_code      text not null references countries(code),
  registration_no   text,
  default_currency  text not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid
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
-- self-signup) — one less manual step, matches the "smooth and automated"
-- brief instead of leaving every new user without a profile row.
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
  nationality         text,
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

create trigger employees_set_updated_at before update on employees
  for each row execute function set_updated_at();

create index idx_employees_manager on employees(manager_id) where deleted_at is null;
create index idx_employees_company on employees(company_id) where deleted_at is null;
create index idx_employees_user on employees(user_id) where deleted_at is null;

-- =============================================================================
-- RLS helper functions — kept deliberately trivial (no business logic) so
-- every policy that calls them stays reviewable. See
-- docs/02-database-schema.md §2.6.
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

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table countries enable row level security;
alter table companies enable row level security;
alter table departments enable row level security;
alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table employees enable row level security;

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

-- ---- user_roles: everyone can read their own role rows; Sys Admin manages all.
create policy user_roles_select_own on user_roles for select
  using (user_id = auth.uid() or has_role('sys_admin'));

create policy user_roles_write_sysadmin on user_roles for all
  using (has_role('sys_admin'))
  with check (has_role('sys_admin'));

-- ---- employees: self, manager chain, HR Admin (full), Finance/CEO (read),
--      Sys Admin (read). Matches docs/02-database-schema.md §2.3 and the
--      permission matrix §3.1 exactly.
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

create policy employees_insert_hr on employees for insert
  with check (has_role('hr_admin', company_id));

create policy employees_update_hr on employees for update
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));
