-- Inventory, migration 1 of 6: access, audit, company settings and reference codes.
--
-- Inventory access is its own company-scoped grant table (inv_company_grants), deliberately NOT user_roles, NOT crm_company_grants and
-- NOT proj_company_grants: an HR role, a Sales grant, a Projects grant, an employee record or an e-mail domain confers no Inventory
-- access, and an Inventory grant confers no HR, Sales or Projects access. A grant with an empty capability list means "Inventory
-- access": the catalogue summary only. Founders are grants (capability 'founder'), never hard-coded people. Purchase-cost visibility
-- is its own capability ('view_costs'), never implied by warehouse, Sales, HR or PM access.
--
-- Prerequisites: the Sales & CRM (20261115*) and Projects & Tasks (20261120*) migrations are applied.
-- Nothing here reads or writes any HR, CRM or Projects table. Additive: no existing object is altered.

-- -----------------------------------------------------------------------------
-- Capability vocabulary
-- -----------------------------------------------------------------------------
--   founder               everything in the company, including costs and access
--   manage_access         grant / revoke Inventory access (founders hold it implicitly)
--   manage_catalogue      categories, items, technology templates, locations, bins
--   warehouse             operate stock (receive, issue, return, transfer, count) at the locations the person is assigned to
--   cross_location        handle transfers and receipts at every location of the company, not only assigned ones
--   view_stock            read unit-level stock and movements (custody included), read only
--   view_costs            read purchase dates, costs and currencies
--   view_audit            read the Inventory audit log
--   confirm_stock         confirm opening stock and counts as verified
--   request_for_employees request equipment for employees (department heads)
--   view_employee_custody see which company equipment each employee holds (HR onboarding and exit)
create or replace function inv_capability_list()
returns text[]
language sql immutable
as $$
  select array['founder', 'manage_access', 'manage_catalogue', 'warehouse', 'cross_location', 'view_stock', 'view_costs',
               'view_audit', 'confirm_stock', 'request_for_employees', 'view_employee_custody']::text[];
$$;

create table if not exists inv_company_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  company_id    uuid not null references companies(id),
  capabilities  text[] not null default '{}'::text[],
  note          text,
  granted_by    uuid references auth.users(id),
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  constraint inv_company_grants_caps check (capabilities <@ inv_capability_list())
);
create unique index if not exists uq_inv_grants_active on inv_company_grants(user_id, company_id) where revoked_at is null;
create index if not exists idx_inv_grants_company on inv_company_grants(company_id) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER + stable so policies can call them without recursion; every one joins to an ACTIVE profile, so a
-- deactivated account loses access at once, and a revoked grant stops working on the very next call (a page that is already open
-- gets "no access" from the database on its next action).
-- -----------------------------------------------------------------------------
create or replace function inv_require_user()
returns uuid
language plpgsql stable
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return auth.uid();
end;
$$;

create or replace function inv_has_access(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from inv_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.company_id = p_company_id and g.revoked_at is null);
$$;

create or replace function inv_has_capability(p_company_id uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from inv_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.company_id = p_company_id and g.revoked_at is null
      and ('founder' = any (g.capabilities) or p_capability = any (g.capabilities)));
$$;

create or replace function inv_is_founder(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from inv_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.company_id = p_company_id and g.revoked_at is null
      and 'founder' = any (g.capabilities));
$$;

create or replace function inv_has_any_access()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from inv_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.revoked_at is null);
$$;

create or replace function inv_is_any_founder()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from inv_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.revoked_at is null and 'founder' = any (g.capabilities));
$$;

create or replace function inv_accessible_company_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select g.company_id
  from inv_company_grants g
  join profiles p on p.id = g.user_id and p.is_active
  where g.user_id = auth.uid() and g.revoked_at is null;
$$;

alter table inv_company_grants enable row level security;
drop policy if exists inv_company_grants_select on inv_company_grants;
create policy inv_company_grants_select on inv_company_grants for select
  using (user_id = auth.uid() or inv_has_capability(company_id, 'manage_access'));

-- -----------------------------------------------------------------------------
-- Inventory audit log. The HR audit_log is readable by HR roles, so Inventory keeps its own, readable only with 'view_audit'
-- (founders hold it implicitly). Rows store the old and new row images. Stock movements are ALSO kept in their own ledger
-- (migration 2); this log records who changed catalogue, access and settings rows and every state change of a unit or stock row.
-- -----------------------------------------------------------------------------
create table if not exists inv_audit_log (
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
create index if not exists idx_inv_audit_company_time on inv_audit_log(company_id, created_at desc);
create index if not exists idx_inv_audit_row on inv_audit_log(table_name, row_id);

alter table inv_audit_log enable row level security;
drop policy if exists inv_audit_log_select on inv_audit_log;
create policy inv_audit_log_select on inv_audit_log for select
  using (company_id is not null and inv_has_capability(company_id, 'view_audit'));

-- Every audited table has a uuid "id". company_id is read from the row when present; a row without one is logged with a null
-- company and is therefore readable by nobody through RLS.
create or replace function inv_audit_trigger()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into inv_audit_log (table_name, row_id, company_id, action, actor_id, old_row, new_row)
  values (tg_table_name, v_row->>'id', nullif(v_row->>'company_id', '')::uuid, lower(tg_op), auth.uid(), v_old, v_new);
  return coalesce(new, old);
end;
$$;

drop trigger if exists inv_company_grants_audit on inv_company_grants;
create trigger inv_company_grants_audit after insert or update or delete on inv_company_grants
  for each row execute function inv_audit_trigger();

-- -----------------------------------------------------------------------------
-- Per-company settings: the equipment reference code ("UAE" -> UAE-E-00001) and the on/off switch. A blank code means "not
-- configured": nothing can be registered until a founder sets it (never a silent default). Switching off blocks every Inventory
-- WRITE function and keeps every record, so it is a safe pause (see supabase/manual-sql/inv_80_safe_disable_and_restore.sql).
-- -----------------------------------------------------------------------------
create table if not exists inv_company_settings (
  company_id      uuid primary key references companies(id),
  reference_code  text not null,
  is_enabled      boolean not null default true,
  updated_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint inv_company_settings_code check (reference_code ~ '^[A-Z]{2,5}$')
);
create unique index if not exists uq_inv_company_settings_code on inv_company_settings(reference_code);

-- Codes are issued from here only: unit and bin labels, requests, transfers. Never reused, never edited.
create table if not exists inv_reference_counters (
  company_id  uuid not null references companies(id),
  kind        text not null check (kind in ('unit', 'stock', 'request', 'transfer', 'movement', 'count')),
  last_value  bigint not null default 0,
  primary key (company_id, kind)
);

drop trigger if exists inv_company_settings_set_updated_at on inv_company_settings;
create trigger inv_company_settings_set_updated_at before update on inv_company_settings
  for each row execute function set_updated_at();
drop trigger if exists inv_company_settings_audit on inv_company_settings;
create trigger inv_company_settings_audit after insert or update or delete on inv_company_settings
  for each row execute function inv_audit_trigger();

alter table inv_company_settings enable row level security;
drop policy if exists inv_company_settings_select on inv_company_settings;
create policy inv_company_settings_select on inv_company_settings for select using (inv_has_access(company_id));
alter table inv_reference_counters enable row level security;   -- no policy: only the SECURITY DEFINER code reads it

-- The next code of a kind for a company: UAE-E-00001 (units), UAE-S-00001 (bin / stock labels), UAE-R-00001 (requests),
-- UAE-T-00001 (transfers), UAE-M-00001 (movements), UAE-C-00001 (counts). Serialised by the counter row lock.
create or replace function inv_next_code(p_company_id uuid, p_kind text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text;
  v_n bigint;
  v_letter text := case p_kind when 'unit' then 'E' when 'stock' then 'S' when 'request' then 'R' when 'transfer' then 'T'
                              when 'movement' then 'M' when 'count' then 'C' end;
begin
  if v_letter is null then raise exception 'Unknown code kind %', p_kind using errcode = '22023'; end if;
  select reference_code into v_code from inv_company_settings where company_id = p_company_id;
  if v_code is null then
    raise exception 'An Inventory reference code has not been set for this company yet. A founder sets it under Manage.' using errcode = '23514';
  end if;
  insert into inv_reference_counters (company_id, kind, last_value) values (p_company_id, p_kind, 1)
  on conflict (company_id, kind) do update set last_value = inv_reference_counters.last_value + 1
  returning last_value into v_n;
  return v_code || '-' || v_letter || '-' || lpad(v_n::text, 5, '0');
end;
$$;

-- Every Inventory write checks this first: unknown company, not configured, or switched off all say so in words.
create or replace function inv_require_enabled(p_company_id uuid)
returns void
language plpgsql stable security definer
set search_path = public
as $$
declare v_enabled boolean;
begin
  select is_enabled into v_enabled from inv_company_settings where company_id = p_company_id;
  if v_enabled is null then
    raise exception 'Inventory is not set up for this company yet. A founder sets the reference code under Manage.' using errcode = '23514';
  end if;
  if not v_enabled then
    raise exception 'Inventory is switched off for this company. Nothing can be changed until a founder switches it on.' using errcode = '23514';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Access management functions
-- -----------------------------------------------------------------------------
create or replace function inv_grant_access(
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
  perform inv_require_user();
  if not inv_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a founder, or someone a founder gave access management to, can grant Inventory access for this company' using errcode = '42501';
  end if;
  if not (v_caps <@ inv_capability_list()) then
    raise exception 'Unknown Inventory capability in %', v_caps using errcode = '22023';
  end if;
  if ('founder' = any (v_caps) or 'manage_access' = any (v_caps) or 'view_costs' = any (v_caps)) and not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can grant founder, access-management or cost-visibility rights' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_user_id and is_active) then
    raise exception 'That user does not exist or is not active' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  select capabilities into v_existing from inv_company_grants
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_existing is not null and ('founder' = any (v_existing) or 'manage_access' = any (v_existing) or 'view_costs' = any (v_existing)) then
    if not inv_is_founder(p_company_id) then
      raise exception 'Only an Inventory founder can change a founder''s, access manager''s or cost reader''s rights' using errcode = '42501';
    end if;
    if 'founder' = any (v_existing) and not ('founder' = any (v_caps)) and (
         select count(*) from inv_company_grants
          where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities)) <= 1 then
      raise exception 'Cannot remove founder rights from the last founder of this company' using errcode = '23514';
    end if;
  end if;

  update inv_company_grants set capabilities = v_caps, note = coalesce(p_note, note)
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null
  returning id into v_id;
  if v_id is null then
    insert into inv_company_grants (user_id, company_id, capabilities, granted_by, note)
    values (p_user_id, p_company_id, v_caps, auth.uid(), p_note)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Revoking Inventory access removes the person's warehouse locations as well (migration 2 replaces this function once
-- inv_operator_locations exists). Records they created stay: history is never deleted.
create or replace function inv_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target_is_founder boolean;
  v_founders integer;
begin
  perform inv_require_user();
  if not inv_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only an Inventory founder can revoke Inventory access for this company' using errcode = '42501';
  end if;
  select 'founder' = any (capabilities) into v_target_is_founder
    from inv_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_is_founder is null then return; end if;
  if v_target_is_founder and not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can revoke a founder' using errcode = '42501';
  end if;
  if v_target_is_founder then
    select count(*) into v_founders from inv_company_grants
     where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities);
    if v_founders <= 1 then
      raise exception 'Cannot revoke the last founder of this company' using errcode = '23514';
    end if;
  end if;
  update inv_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
end;
$$;

create or replace function inv_set_company_code(p_company_id uuid, p_reference_code text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_code text := upper(btrim(coalesce(p_reference_code, '')));
begin
  perform inv_require_user();
  if not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can set the equipment reference code' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z]{2,5}$' then
    raise exception 'The reference code is 2 to 5 capital letters' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  if exists (select 1 from inv_company_settings where reference_code = v_code and company_id <> p_company_id) then
    raise exception 'That reference code is used by another company' using errcode = '23505';
  end if;
  if exists (select 1 from inv_company_settings where company_id = p_company_id and reference_code <> v_code)
     and exists (select 1 from inv_reference_counters where company_id = p_company_id and last_value > 0) then
    raise exception 'The reference code cannot change once equipment codes have been issued: labels already carry it' using errcode = '23514';
  end if;
  insert into inv_company_settings (company_id, reference_code, updated_by) values (p_company_id, v_code, auth.uid())
  on conflict (company_id) do update set reference_code = excluded.reference_code, updated_by = excluded.updated_by;
end;
$$;

-- The owner's pause switch, also reachable by a founder. Records are never touched.
create or replace function inv_set_enabled(p_company_id uuid, p_enabled boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform inv_require_user();
  if not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can switch Inventory on or off' using errcode = '42501';
  end if;
  update inv_company_settings set is_enabled = coalesce(p_enabled, true), updated_by = auth.uid() where company_id = p_company_id;
  if not found then raise exception 'Set the reference code first' using errcode = '23514'; end if;
end;
$$;

-- People picker for access managers: all active staff (names; e-mail only for founders, who need it to tell two people apart).
create or replace function inv_staff_directory()
returns table (user_id uuid, full_name text, email text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform inv_require_user();
  if not exists (
    select 1 from inv_company_grants g join profiles p on p.id = g.user_id and p.is_active
     where g.user_id = auth.uid() and g.revoked_at is null
       and ('founder' = any (g.capabilities) or 'manage_access' = any (g.capabilities) or 'warehouse' = any (g.capabilities))
  ) then return; end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)), case when inv_is_any_founder() then p.email end
    from profiles p where p.is_active
    order by 2, p.email;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: clients read through RLS only; everything else is via the functions.
-- -----------------------------------------------------------------------------
revoke all on table inv_company_grants, inv_audit_log, inv_company_settings, inv_reference_counters from anon, authenticated, public;
revoke all on sequence inv_audit_log_id_seq from public, anon, authenticated;
grant select on table inv_company_grants, inv_audit_log, inv_company_settings to authenticated;

revoke all on function
  inv_capability_list(), inv_require_user(), inv_has_access(uuid), inv_has_capability(uuid, text), inv_is_founder(uuid),
  inv_has_any_access(), inv_is_any_founder(), inv_accessible_company_ids(), inv_audit_trigger(), inv_next_code(uuid, text),
  inv_require_enabled(uuid), inv_grant_access(uuid, uuid, text[], text), inv_revoke_access(uuid, uuid),
  inv_set_company_code(uuid, text), inv_set_enabled(uuid, boolean), inv_staff_directory()
  from public, anon, authenticated;
grant execute on function
  inv_capability_list(), inv_has_access(uuid), inv_has_capability(uuid, text), inv_is_founder(uuid),
  inv_has_any_access(), inv_is_any_founder(), inv_accessible_company_ids(),
  inv_grant_access(uuid, uuid, text[], text), inv_revoke_access(uuid, uuid), inv_set_company_code(uuid, text),
  inv_set_enabled(uuid, boolean), inv_staff_directory()
  to authenticated;

-- ROLLBACK (only before any Inventory data exists; afterwards use the safe-disable script, never drop):
--   drop table if exists inv_reference_counters, inv_company_settings, inv_audit_log, inv_company_grants cascade;
--   drop function if exists inv_staff_directory(), inv_set_enabled(uuid, boolean), inv_set_company_code(uuid, text),
--     inv_revoke_access(uuid, uuid), inv_grant_access(uuid, uuid, text[], text), inv_require_enabled(uuid), inv_next_code(uuid, text),
--     inv_audit_trigger(), inv_accessible_company_ids(), inv_is_any_founder(), inv_has_any_access(), inv_is_founder(uuid),
--     inv_has_capability(uuid, text), inv_has_access(uuid), inv_require_user(), inv_capability_list();
