-- Projects & Tasks (Release 2), migration 1 of 7: access, audit and company settings.
--
-- Projects access is its own company-scoped grant table (proj_company_grants), deliberately NOT user_roles and NOT
-- crm_company_grants: an HR role, a Sales grant, an employee record or an e-mail domain confers no Projects access,
-- and a Projects grant confers no HR or Sales access. A grant with an empty capability list means "Projects access":
-- the basic directory only. Founders are grants (capability 'founder'), never hard-coded people.
--
-- Prerequisite: the Sales & CRM migrations (20261115*) are applied (Sales-link visibility uses crm_has_access()).
-- Nothing here reads or writes any HR or CRM table. Additive: no existing object is altered.

-- -----------------------------------------------------------------------------
-- Capability vocabulary
-- -----------------------------------------------------------------------------
create or replace function proj_capability_list()
returns text[]
language sql immutable
as $$
  select array['founder', 'assign_pm', 'manage_access', 'approve_scope', 'view_commercial', 'view_audit',
               'reopen_project', 'override_site_conflict']::text[];
$$;

create table if not exists proj_company_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  company_id    uuid not null references companies(id),
  capabilities  text[] not null default '{}'::text[],
  note          text,
  granted_by    uuid references auth.users(id),
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  constraint proj_company_grants_caps check (capabilities <@ proj_capability_list())
);
create unique index if not exists uq_proj_grants_active on proj_company_grants(user_id, company_id) where revoked_at is null;
create index if not exists idx_proj_grants_company on proj_company_grants(company_id) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER + stable so policies can call them without recursion; every one joins to an ACTIVE profile,
-- so a deactivated account loses access at once.
-- -----------------------------------------------------------------------------
create or replace function proj_require_user()
returns uuid
language plpgsql stable
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return auth.uid();
end;
$$;

create or replace function proj_has_access(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.company_id = p_company_id and g.revoked_at is null);
$$;

create or replace function proj_has_capability(p_company_id uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.company_id = p_company_id and g.revoked_at is null
      and ('founder' = any (g.capabilities) or p_capability = any (g.capabilities)));
$$;

create or replace function proj_is_founder(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.company_id = p_company_id and g.revoked_at is null
      and 'founder' = any (g.capabilities));
$$;

create or replace function proj_has_any_access()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.revoked_at is null);
$$;

create or replace function proj_is_any_founder()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.revoked_at is null and 'founder' = any (g.capabilities));
$$;

create or replace function proj_accessible_company_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select g.company_id
  from proj_company_grants g
  join profiles p on p.id = g.user_id and p.is_active
  where g.user_id = auth.uid() and g.revoked_at is null;
$$;

alter table proj_company_grants enable row level security;
drop policy if exists proj_company_grants_select on proj_company_grants;
create policy proj_company_grants_select on proj_company_grants for select
  using (user_id = auth.uid() or proj_has_capability(company_id, 'manage_access'));

-- -----------------------------------------------------------------------------
-- Projects audit log. The HR audit_log is readable by HR roles, so Projects keeps its own, readable only with
-- 'view_audit' (founders hold it implicitly). Rows store the old and new row images.
-- -----------------------------------------------------------------------------
create table if not exists proj_audit_log (
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
create index if not exists idx_proj_audit_company_time on proj_audit_log(company_id, created_at desc);
create index if not exists idx_proj_audit_row on proj_audit_log(table_name, row_id);

alter table proj_audit_log enable row level security;
drop policy if exists proj_audit_log_select on proj_audit_log;
create policy proj_audit_log_select on proj_audit_log for select
  using (company_id is not null and proj_has_capability(company_id, 'view_audit'));

-- Every audited table has a uuid "id". company_id is read from the row when present; tables that only carry a
-- project_id resolve the company from proj_projects (a row without either is logged with a null company and is
-- therefore readable by nobody through RLS).
create or replace function proj_audit_trigger()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_company uuid := nullif(v_row->>'company_id', '')::uuid;
begin
  if v_company is null and nullif(v_row->>'project_id', '') is not null then
    select company_id into v_company from proj_projects where id = (v_row->>'project_id')::uuid;
  end if;
  insert into proj_audit_log (table_name, row_id, company_id, action, actor_id, old_row, new_row)
  values (tg_table_name, v_row->>'id', v_company, lower(tg_op), auth.uid(), v_old, v_new);
  return coalesce(new, old);
end;
$$;

drop trigger if exists proj_company_grants_audit on proj_company_grants;
create trigger proj_company_grants_audit after insert or update or delete on proj_company_grants
  for each row execute function proj_audit_trigger();

-- -----------------------------------------------------------------------------
-- Per-company settings: the project reference code ("UAE" -> UAE-P-2026-0001). Blank means "not configured": a
-- project cannot be created until a founder sets it (never a silent default).
-- -----------------------------------------------------------------------------
create table if not exists proj_company_settings (
  company_id      uuid primary key references companies(id),
  reference_code  text not null,
  updated_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint proj_company_settings_code check (reference_code ~ '^[A-Z]{2,5}$')
);
create unique index if not exists uq_proj_company_settings_code on proj_company_settings(reference_code);

create table if not exists proj_reference_counters (
  company_id  uuid not null references companies(id),
  year        integer not null,
  last_value  integer not null default 0,
  primary key (company_id, year)
);

drop trigger if exists proj_company_settings_set_updated_at on proj_company_settings;
create trigger proj_company_settings_set_updated_at before update on proj_company_settings
  for each row execute function set_updated_at();

alter table proj_company_settings enable row level security;
drop policy if exists proj_company_settings_select on proj_company_settings;
create policy proj_company_settings_select on proj_company_settings for select
  using (proj_has_access(company_id));
alter table proj_reference_counters enable row level security;   -- no policy: only the SECURITY DEFINER code reads it

-- Seed from the Sales reference codes of EXISTING companies only (same codes, so UAE-... stays UAE-P-...), never creating a company.
insert into proj_company_settings (company_id, reference_code)
select s.company_id, s.reference_code from crm_company_settings s
where exists (select 1 from companies c where c.id = s.company_id and c.is_active and c.deleted_at is null)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Access management functions
-- -----------------------------------------------------------------------------
create or replace function proj_grant_access(
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
  perform proj_require_user();
  if not proj_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a founder, or someone a founder gave access management to, can grant Projects access for this company' using errcode = '42501';
  end if;
  if not (v_caps <@ proj_capability_list()) then
    raise exception 'Unknown Projects capability in %', v_caps using errcode = '22023';
  end if;
  if ('founder' = any (v_caps) or 'manage_access' = any (v_caps)) and not proj_is_founder(p_company_id) then
    raise exception 'Only a Projects founder can grant founder or access-management rights' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_user_id and is_active) then
    raise exception 'That user does not exist or is not active' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  select capabilities into v_existing from proj_company_grants
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_existing is not null and ('founder' = any (v_existing) or 'manage_access' = any (v_existing)) then
    if not proj_is_founder(p_company_id) then
      raise exception 'Only a Projects founder can change a founder''s or access manager''s rights' using errcode = '42501';
    end if;
    if 'founder' = any (v_existing) and not ('founder' = any (v_caps)) and (
         select count(*) from proj_company_grants
          where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities)) <= 1 then
      raise exception 'Cannot remove founder rights from the last founder of this company' using errcode = '23514';
    end if;
  end if;

  update proj_company_grants set capabilities = v_caps, note = coalesce(p_note, note)
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null
  returning id into v_id;
  if v_id is null then
    insert into proj_company_grants (user_id, company_id, capabilities, granted_by, note)
    values (p_user_id, p_company_id, v_caps, auth.uid(), p_note)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Revoking Projects access also ends the person's active memberships in that company's projects and any open site
-- bookings handled by them are left in place (history), but they can no longer read anything. The membership clean-up is
-- done in migration 2 (proj_revoke_access is replaced there once proj_project_members exists).
create or replace function proj_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target_is_founder boolean;
  v_founders integer;
begin
  perform proj_require_user();
  if not proj_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a Projects founder can revoke Projects access for this company' using errcode = '42501';
  end if;
  select 'founder' = any (capabilities) into v_target_is_founder
    from proj_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_is_founder is null then return; end if;
  if v_target_is_founder and not proj_is_founder(p_company_id) then
    raise exception 'Only a Projects founder can revoke a founder' using errcode = '42501';
  end if;
  if v_target_is_founder then
    select count(*) into v_founders from proj_company_grants
     where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities);
    if v_founders <= 1 then
      raise exception 'Cannot revoke the last founder of this company' using errcode = '23514';
    end if;
  end if;
  update proj_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
end;
$$;

create or replace function proj_set_company_code(p_company_id uuid, p_reference_code text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_code text := upper(btrim(coalesce(p_reference_code, '')));
begin
  perform proj_require_user();
  if not proj_is_founder(p_company_id) then
    raise exception 'Only a Projects founder can set the project reference code' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z]{2,5}$' then
    raise exception 'The reference code is 2 to 5 capital letters' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  if exists (select 1 from proj_company_settings where reference_code = v_code and company_id <> p_company_id) then
    raise exception 'That reference code is used by another company' using errcode = '23505';
  end if;
  insert into proj_company_settings (company_id, reference_code, updated_by) values (p_company_id, v_code, auth.uid())
  on conflict (company_id) do update set reference_code = excluded.reference_code, updated_by = excluded.updated_by;
end;
$$;

-- -----------------------------------------------------------------------------
-- People pickers. Names only (never HR data): holders of an active Projects grant in companies the caller can
-- access, so a PM can name members without reading HR tables. E-mail only to a founder, who needs it to tell two
-- people apart. crm-style staff directory for granting access: all active staff, to access managers only.
-- -----------------------------------------------------------------------------
create or replace function proj_people()
returns table (user_id uuid, full_name text, email text, company_ids uuid[])
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if not proj_has_any_access() then return; end if;
  return query
    select g.user_id, coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)),
           case when proj_is_any_founder() then p.email end, array_agg(distinct g.company_id)
    from proj_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.revoked_at is null and proj_has_access(g.company_id)
    group by g.user_id, p.full_name, p.email
    order by 2;
end;
$$;

create or replace function proj_staff_directory()
returns table (user_id uuid, full_name text, email text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if not exists (
    select 1 from proj_company_grants g join profiles p on p.id = g.user_id and p.is_active
     where g.user_id = auth.uid() and g.revoked_at is null
       and ('founder' = any (g.capabilities) or 'manage_access' = any (g.capabilities) or 'assign_pm' = any (g.capabilities))
  ) then return; end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)), case when proj_is_any_founder() then p.email end
    from profiles p where p.is_active
    order by 2, p.email;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: clients read through RLS only; everything else is via the functions above.
-- -----------------------------------------------------------------------------
revoke all on table proj_company_grants, proj_audit_log, proj_company_settings, proj_reference_counters from anon, authenticated, public;
revoke all on sequence proj_audit_log_id_seq from public, anon, authenticated;
grant select on table proj_company_grants, proj_audit_log, proj_company_settings to authenticated;

revoke all on function
  proj_capability_list(), proj_require_user(), proj_has_access(uuid), proj_has_capability(uuid, text), proj_is_founder(uuid),
  proj_has_any_access(), proj_is_any_founder(), proj_accessible_company_ids(), proj_audit_trigger(),
  proj_grant_access(uuid, uuid, text[], text), proj_revoke_access(uuid, uuid), proj_set_company_code(uuid, text),
  proj_people(), proj_staff_directory()
  from public, anon, authenticated;
grant execute on function
  proj_capability_list(), proj_has_access(uuid), proj_has_capability(uuid, text), proj_is_founder(uuid),
  proj_has_any_access(), proj_is_any_founder(), proj_accessible_company_ids(),
  proj_grant_access(uuid, uuid, text[], text), proj_revoke_access(uuid, uuid), proj_set_company_code(uuid, text),
  proj_people(), proj_staff_directory()
  to authenticated;
