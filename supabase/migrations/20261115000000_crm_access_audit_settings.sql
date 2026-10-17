-- Sales & CRM (Stage B), migration 1 of 4: company-scoped access, CRM audit log, per-company settings.
--
-- DESIGN (docs/14 §11, owner decisions 2026-10-17)
--   * CRM access is its own table, NOT user_roles. HR admin, Finance, CEO and sys_admin roles grant no CRM access
--     whatever; a CRM grant grants no HR access whatever. Neither table is consulted by the other's policies.
--   * A grant is explicit and per company: (user, company, capabilities[]). A user with grants in two companies sees
--     the shared pipeline of both; no grant in a company means no visibility of that company's CRM rows.
--   * 'founder' is a capability on a grant (bootstrapped by the owner's manual SQL for Juzar and Rafi, see
--     supabase/manual-sql/crm_30_bootstrap_founders.sql). A founder may assign/reassign owners, close any
--     opportunity, grant and revoke access, edit settings and read the CRM audit log for that company.
--   * Tables are read-only to clients: SELECT policies only. Every change goes through a SECURITY DEFINER function
--     (migrations 2-4) that checks the capability itself.
--   * CRM keeps its own audit table. The shared audit_log is readable by HR admin by design, which would expose
--     commercial data to HR, so CRM tables never write to it.
--   * Nothing here inserts a company. Settings rows are seeded only for companies that already exist.
--
-- Additive and idempotent where possible; ROLLBACK notes at the bottom.

-- -----------------------------------------------------------------------------
-- Capabilities vocabulary (kept in one place; mirrored in packages/domain/src/permissions/crm.ts)
-- -----------------------------------------------------------------------------
create or replace function crm_capability_list()
returns text[]
language sql immutable
as $$
  select array[
    'founder',                -- implies every other capability for the company
    'assign_owner',           -- assign / reassign opportunity owners
    'confirm_availability',   -- record technology-availability confirmation (delegated by a founder)
    'manage_settings',        -- edit CRM settings for the company
    'manage_approval_rules',  -- configure commercial approval rules (none exist yet)
    'manage_access',          -- grant / revoke CRM access for the company
    'view_audit',             -- read the CRM audit log for the company
    'reopen_closed'           -- reopen a Won or Lost opportunity (with a reason and a new next action)
  ]::text[];
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
create table if not exists crm_company_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  company_id    uuid not null references companies(id),
  capabilities  text[] not null default '{}'::text[],
  granted_by    uuid references auth.users(id),
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  note          text,
  constraint crm_company_grants_caps_valid check (capabilities <@ crm_capability_list())
);

create unique index if not exists uq_crm_company_grants_active
  on crm_company_grants(user_id, company_id) where revoked_at is null;
create index if not exists idx_crm_company_grants_company
  on crm_company_grants(company_id) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so policies on other tables can call them without
-- needing SELECT on crm_company_grants; they only ever answer about auth.uid().
-- -----------------------------------------------------------------------------
create or replace function crm_has_access(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from crm_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid()
      and g.company_id = p_company_id
      and g.revoked_at is null
  );
$$;

create or replace function crm_has_capability(p_company_id uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from crm_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid()
      and g.company_id = p_company_id
      and g.revoked_at is null
      and ('founder' = any (g.capabilities) or p_capability = any (g.capabilities))
  );
$$;

create or replace function crm_is_founder(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select crm_has_capability(p_company_id, 'founder') and exists (
    select 1 from crm_company_grants g
    where g.user_id = auth.uid() and g.company_id = p_company_id
      and g.revoked_at is null and 'founder' = any (g.capabilities)
  );
$$;

-- Does the caller hold any active CRM grant? Used for company-agnostic tables (organisations, contacts).
create or replace function crm_has_any_access()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from crm_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.revoked_at is null
  );
$$;

-- Is the caller a founder of at least one company? Gates audit rows that belong to no single company.
create or replace function crm_is_any_founder()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from crm_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.revoked_at is null and 'founder' = any (g.capabilities)
  );
$$;

-- Companies the caller may see in CRM (for list/pipeline filters and the company switcher).
create or replace function crm_accessible_company_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select g.company_id
  from crm_company_grants g
  join profiles p on p.id = g.user_id and p.is_active
  where g.user_id = auth.uid() and g.revoked_at is null;
$$;

alter table crm_company_grants enable row level security;
drop policy if exists crm_company_grants_select on crm_company_grants;
create policy crm_company_grants_select on crm_company_grants for select
  using (user_id = auth.uid() or crm_has_capability(company_id, 'manage_access'));

-- -----------------------------------------------------------------------------
-- CRM audit log
-- -----------------------------------------------------------------------------
create table if not exists crm_audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text,
  company_id  uuid,
  action      text not null check (action in ('insert', 'update', 'delete')),
  actor_id    uuid,
  old_row     jsonb,
  new_row     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_crm_audit_company_time on crm_audit_log(company_id, created_at desc);
create index if not exists idx_crm_audit_row on crm_audit_log(table_name, row_id);

alter table crm_audit_log enable row level security;
drop policy if exists crm_audit_log_select on crm_audit_log;
create policy crm_audit_log_select on crm_audit_log for select
  using (
    (company_id is not null and crm_has_capability(company_id, 'view_audit'))
    or (company_id is null and crm_is_any_founder())
  );

create or replace function crm_audit_trigger()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into crm_audit_log (table_name, row_id, company_id, action, actor_id, old_row, new_row)
  values (
    tg_table_name,
    v_row->>'id',
    nullif(v_row->>'company_id', '')::uuid,
    lower(tg_op),
    auth.uid(),
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists crm_company_grants_audit on crm_company_grants;
create trigger crm_company_grants_audit after insert or update or delete on crm_company_grants
  for each row execute function crm_audit_trigger();

-- -----------------------------------------------------------------------------
-- Per-company CRM settings. Blank means "not configured" (never a silent default).
-- -----------------------------------------------------------------------------
create table if not exists crm_company_settings (
  company_id                 uuid primary key references companies(id),
  reference_code             text not null,
  default_quote_currency     text not null,
  response_target_hours      integer check (response_target_hours is null or response_target_hours > 0),
  working_calendar           jsonb,                      -- null = not configured; response-time KPIs are then not computed
  duplicate_window_days      integer not null default 180 check (duplicate_window_days between 1 and 1095),
  -- Commercial approval policy. 'not_configured' until the founders decide; never read as "approval granted".
  approval_policy            text not null default 'not_configured'
                               check (approval_policy in ('not_configured', 'not_required', 'required')),
  approval_note              text,
  owner_email_enabled        boolean not null default false,
  updated_by                 uuid references auth.users(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint crm_company_settings_code_format check (reference_code ~ '^[A-Z]{2,5}$'),
  constraint crm_company_settings_currency_format check (default_quote_currency ~ '^[A-Z]{3}$')
);
create unique index if not exists uq_crm_company_settings_code on crm_company_settings(reference_code);

drop trigger if exists crm_company_settings_set_updated_at on crm_company_settings;
create trigger crm_company_settings_set_updated_at before update on crm_company_settings
  for each row execute function set_updated_at();
drop trigger if exists crm_company_settings_audit on crm_company_settings;
create trigger crm_company_settings_audit after insert or update or delete on crm_company_settings
  for each row execute function crm_audit_trigger();

alter table crm_company_settings enable row level security;
drop policy if exists crm_company_settings_select on crm_company_settings;
create policy crm_company_settings_select on crm_company_settings for select
  using (crm_has_access(company_id));

-- Seed reference codes and default currencies from EXISTING companies only, and only where exactly one active
-- company exists for the country, so a duplicate-country situation is never guessed at. AE -> UAE/AED,
-- SA -> KSA/SAR, PL -> PL/EUR (owner decision). Anything else is configured by a founder in Settings.
insert into crm_company_settings (company_id, reference_code, default_quote_currency)
select c.id, m.code, m.currency
from companies c
join (values ('AE', 'UAE', 'AED'), ('SA', 'KSA', 'SAR'), ('PL', 'PL', 'EUR')) as m(country, code, currency)
  on m.country = c.country_code
where c.is_active and c.deleted_at is null
  and (select count(*) from companies c2 where c2.country_code = c.country_code and c2.is_active and c2.deleted_at is null) = 1
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Access management functions (founders only)
-- -----------------------------------------------------------------------------
create or replace function crm_grant_access(
  p_user_id uuid,
  p_company_id uuid,
  p_capabilities text[] default '{}'::text[],
  p_note text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_caps text[] := coalesce(p_capabilities, '{}'::text[]);
  v_existing text[];
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not crm_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a founder, or someone a founder gave access management to, can grant Sales access for this company' using errcode = '42501';
  end if;
  if not (v_caps <@ crm_capability_list()) then
    raise exception 'Unknown CRM capability in %', v_caps using errcode = '22023';
  end if;
  -- Only a founder may hand out founder or access-management capability.
  if ('founder' = any (v_caps) or 'manage_access' = any (v_caps)) and not crm_is_founder(p_company_id) then
    raise exception 'Only a CRM founder can grant founder or access-management rights' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_user_id and is_active) then
    raise exception 'That user does not exist or is not active' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  -- Changing an existing founder's rights is a founder's decision, and the last founder can never be demoted
  -- (the same protection crm_revoke_access gives against revoking them).
  select capabilities into v_existing from crm_company_grants
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_existing is not null and 'founder' = any (v_existing) then
    if not crm_is_founder(p_company_id) then
      raise exception 'Only a CRM founder can change a founder''s rights' using errcode = '42501';
    end if;
    if not ('founder' = any (v_caps)) and (
         select count(*) from crm_company_grants
          where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities)) <= 1 then
      raise exception 'Cannot remove founder rights from the last founder of this company' using errcode = '23514';
    end if;
  end if;

  update crm_company_grants
     set capabilities = v_caps, note = coalesce(p_note, note)
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null
  returning id into v_id;

  if v_id is null then
    insert into crm_company_grants (user_id, company_id, capabilities, granted_by, note)
    values (p_user_id, p_company_id, v_caps, auth.uid(), p_note)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function crm_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target_is_founder boolean;
  v_founders integer;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not crm_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a CRM founder can revoke Sales access for this company' using errcode = '42501';
  end if;
  select 'founder' = any (capabilities) into v_target_is_founder
    from crm_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_is_founder is null then return; end if;
  if v_target_is_founder and not crm_is_founder(p_company_id) then
    raise exception 'Only a CRM founder can revoke a founder' using errcode = '42501';
  end if;
  if v_target_is_founder then
    select count(*) into v_founders from crm_company_grants
     where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities);
    if v_founders <= 1 then
      raise exception 'Cannot revoke the last founder of this company' using errcode = '23514';
    end if;
  end if;
  update crm_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
end;
$$;

create or replace function crm_upsert_settings(
  p_company_id uuid,
  p_reference_code text,
  p_default_quote_currency text,
  p_response_target_hours integer default null,
  p_working_calendar jsonb default null,
  p_duplicate_window_days integer default 180,
  p_owner_email_enabled boolean default false,
  p_approval_policy text default null,
  p_approval_note text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not crm_has_capability(p_company_id, 'manage_settings') then
    raise exception 'Not allowed to change CRM settings for this company' using errcode = '42501';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  -- Changing the approval policy is a rules decision, reserved to a founder or a delegated rules manager.
  if p_approval_policy is not null then
    if p_approval_policy not in ('not_configured', 'not_required', 'required') then
      raise exception 'Unknown approval policy %', p_approval_policy using errcode = '22023';
    end if;
    if not crm_has_capability(p_company_id, 'manage_approval_rules') then
      raise exception 'Not allowed to change the commercial approval policy' using errcode = '42501';
    end if;
  end if;
  insert into crm_company_settings (company_id, reference_code, default_quote_currency, response_target_hours,
                                    working_calendar, duplicate_window_days, owner_email_enabled, approval_policy,
                                    approval_note, updated_by)
  values (p_company_id, upper(p_reference_code), upper(p_default_quote_currency), p_response_target_hours,
          p_working_calendar, coalesce(p_duplicate_window_days, 180), coalesce(p_owner_email_enabled, false),
          coalesce(p_approval_policy, 'not_configured'), p_approval_note, auth.uid())
  on conflict (company_id) do update set
    reference_code = excluded.reference_code,
    default_quote_currency = excluded.default_quote_currency,
    response_target_hours = excluded.response_target_hours,
    working_calendar = excluded.working_calendar,
    duplicate_window_days = excluded.duplicate_window_days,
    owner_email_enabled = excluded.owner_email_enabled,
    approval_policy = case when p_approval_policy is null then crm_company_settings.approval_policy
                           else excluded.approval_policy end,
    approval_note = case when p_approval_policy is null then crm_company_settings.approval_note
                         else excluded.approval_note end,
    updated_by = excluded.updated_by;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: clients read through RLS only; everything else is via the functions above.
-- -----------------------------------------------------------------------------
revoke all on table crm_company_grants, crm_audit_log, crm_company_settings from anon, authenticated, public;
grant select on table crm_company_grants, crm_audit_log, crm_company_settings to authenticated;

revoke all on function
  crm_capability_list(), crm_is_any_founder(),
  crm_has_access(uuid), crm_has_capability(uuid, text), crm_is_founder(uuid), crm_has_any_access(),
  crm_accessible_company_ids(), crm_audit_trigger(),
  crm_grant_access(uuid, uuid, text[], text), crm_revoke_access(uuid, uuid),
  crm_upsert_settings(uuid, text, text, integer, jsonb, integer, boolean, text, text)
  from public, anon;
grant execute on function
  crm_capability_list(),
  crm_has_access(uuid), crm_has_capability(uuid, text), crm_is_founder(uuid), crm_has_any_access(), crm_is_any_founder(),
  crm_accessible_company_ids(),
  crm_grant_access(uuid, uuid, text[], text), crm_revoke_access(uuid, uuid),
  crm_upsert_settings(uuid, text, text, integer, jsonb, integer, boolean, text, text)
  to authenticated;

-- ROLLBACK (no CRM data exists yet at this point of the deployment sequence):
--   drop function if exists crm_upsert_settings(uuid, text, text, integer, jsonb, integer, boolean, text, text);
--   drop function if exists crm_revoke_access(uuid, uuid);
--   drop function if exists crm_grant_access(uuid, uuid, text[], text);
--   drop table if exists crm_company_settings, crm_audit_log, crm_company_grants cascade;
--   drop function if exists crm_accessible_company_ids(), crm_is_any_founder(), crm_has_any_access(), crm_is_founder(uuid),
--     crm_has_capability(uuid, text), crm_has_access(uuid), crm_audit_trigger(), crm_capability_list();
