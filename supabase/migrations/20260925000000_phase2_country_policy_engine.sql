-- =============================================================================
-- Phase 2 — Country policy engine
--
-- Scope per docs/06-implementation-phases.md: policy_versions,
-- policy_leave_types, public_holidays, resolve_policy(). This is the piece
-- that makes "add a 4th country" or "the law changed" a data change, not a
-- code change — see docs/02-database-schema.md §2.4 and
-- docs/09-extending-the-system.md.
--
-- Two-person control: HR Admin drafts a policy version; activating it
-- requires a DIFFERENT HR Admin or a CEO (docs/06 exit criteria). RLS alone
-- is row-level and can't express "not the same person who drafted this," so
-- that rule — plus "CEO may activate but never edit content" — lives in a
-- trigger, the same pattern Phase 1 used for the employee self-update guard.
-- =============================================================================

create extension if not exists btree_gist; -- needed for the exclusion constraint below

create type policy_type as enum (
  'leave_rules', 'overtime_rules', 'notice_period',
  'probation_rules', 'working_week', 'end_of_service_benefit'
);
-- Deliberately no 'public_holidays' member: holiday calendars are plain
-- dated facts (see the public_holidays table below), not versioned JSON
-- rules with an effective-date range and a draft/activate workflow — adding
-- next year's holidays is just inserting rows, never a new policy version.

create type policy_status as enum ('draft', 'active', 'superseded');

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

-- One function every leave/notice/probation calculation goes through — never
-- re-derive "the policy in effect on date X" ad hoc in application code.
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

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table policy_versions enable row level security;
alter table policy_leave_types enable row level security;
alter table public_holidays enable row level security;

-- ---- policy_versions: active versions are visible to any signed-in user
--      (it's company policy, not a secret); drafts are visible only to the
--      HR Admin/CEO who'd act on them. Drafting is HR Admin's alone;
--      updating a draft (content edit or activation) is HR Admin or CEO,
--      country-scoped — the "CEO can only activate, not edit" and "not the
--      same person who drafted it" rules live in the trigger below because
--      RLS can't express either at the row-visibility level.
--
--      has_role(..., null, country_code) intentionally requires an
--      unscoped-by-company grant — a single-company HR Admin shouldn't
--      unilaterally change a policy that can affect every company in that
--      country. Grant hr_admin with company_id = null, country_code = 'AE'
--      (or fully unscoped) for whoever should manage country policy.
create policy policy_versions_select on policy_versions for select
  using (
    status = 'active'
    or has_role('hr_admin', null, country_code)
    or has_role('ceo', null, country_code)
  );

-- Every new version must start as a draft — without this, an HR Admin could
-- insert a row already marked 'active' and skip the two-person activation
-- control entirely, since that control only guards the UPDATE path below.
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
  -- Triggers run regardless of role, unlike RLS (see Phase 1's employee
  -- self-update guard for the same point) — a trusted backend write
  -- (migration, seed, service-role call with no JWT session) has
  -- auth.uid() = null and is never what either rule below constrains.
  if auth.uid() is null then
    return new;
  end if;

  -- CEO (without also holding HR Admin) may only flip draft -> active;
  -- no content edits, per the permission matrix.
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

  -- Two-person control: whoever activates it must not be who drafted it.
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
--      only editable while the parent is still a draft, HR Admin only
--      (CEO's activate-only restriction on the parent implicitly means CEO
--      never touches this child table at all).
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

-- ---- public_holidays: reference data, readable by any signed-in user
--      (same pattern as countries/companies in Phase 0), managed by HR
--      Admin for that country.
create policy public_holidays_select on public_holidays for select
  using (auth.role() = 'authenticated');

create policy public_holidays_write on public_holidays for all
  using (has_role('hr_admin', null, country_code))
  with check (has_role('hr_admin', null, country_code));
