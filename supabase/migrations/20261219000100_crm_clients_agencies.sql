-- Sales & CRM: Clients & Agencies (part 1). ADDITIVE and idempotent; nothing existing is dropped or loosened.
--
-- The gaps in the existing model that this closes (and nothing else):
--   1. crm_organisations has ONE kind (agency | client | direct): a company cannot be both an agency and a direct client,
--      and there is no Technology company. -> `roles text[]` (same record, several roles); `kind` stays and is derived from
--      roles so every existing screen keeps working.
--   2. No country, no website. -> country_code, website (+ generated website_domain for matching).
--   3. Organisations are shared reference data with no company dimension, so there is nowhere to put an ACCOUNT OWNER
--      or a lead source for one Enginious company. -> crm_account_profiles, one row per (organisation, company),
--      readable only with a CRM grant for that company (crm_has_access). Owner here is independent of any opportunity owner
--      and of any follow-up assignee.
--   4. No function edits an organisation, saves a company's profile of it, assigns an account owner or changes the assignee
--      of a follow-up (crm_assign_owner moves follow-ups only as a side effect of changing an OPPORTUNITY's owner).
--
-- Access is NOT widened: reads stay SELECT policies; every write is a SECURITY DEFINER function that re-checks the caller.
--   * edit an organisation = same rule as crm_can_edit_contact (creator, a founder, or the owner of an open linked opportunity);
--   * assign an account owner = the existing assign_owner capability (founder implies it) in that company, and the new owner
--     must hold an active CRM grant for that company (crm_user_has_company_access);
--   * reassigning a follow-up follows the existing create-follow-up rule (assignee/owner/founder acts; handing to a third
--     person needs the opportunity owner or assign_owner).
-- Being account owner or follow-up assignee grants NO extra read or edit right (the new function tests never look at it).

-- -----------------------------------------------------------------------------
-- 1 + 2. Organisation columns
-- -----------------------------------------------------------------------------
alter table crm_organisations add column if not exists roles text[] not null default '{}';
alter table crm_organisations add column if not exists country_code text;
alter table crm_organisations add column if not exists website text;
alter table crm_organisations add column if not exists website_domain text generated always as (
  nullif(lower(regexp_replace(regexp_replace(regexp_replace(btrim(website), '^[A-Za-z][A-Za-z0-9+.-]*://', ''), '^www\.', '', 'i'), '[/?#:].*$', '')), '')
) stored;
create index if not exists idx_crm_organisations_domain on crm_organisations(website_domain) where website_domain is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_organisations_roles_valid') then
    alter table crm_organisations add constraint crm_organisations_roles_valid
      check (roles <@ array['agency', 'direct', 'client', 'technology']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_organisations_country_format') then
    alter table crm_organisations add constraint crm_organisations_country_format
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

-- `kind` is the legacy single role the enquiry pickers still read. With roles recorded it is derived (agency, then
-- direct, then client; a technology-only company reads as 'client'); with no roles recorded it is left alone.
create or replace function crm_organisations_sync_kind()
returns trigger
language plpgsql
as $$
begin
  if cardinality(new.roles) > 0 then
    new.kind := case when 'agency' = any (new.roles) then 'agency' when 'direct' = any (new.roles) then 'direct' else 'client' end;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_organisations_sync_kind on crm_organisations;
create trigger crm_organisations_sync_kind before insert or update on crm_organisations
  for each row execute function crm_organisations_sync_kind();

-- Existing organisations take their one kind as their one role (only rows not yet converted).
update crm_organisations set roles = array[kind] where cardinality(roles) = 0;

-- The existing creator keeps working and now records the role too.
create or replace function crm_create_organisation(
  p_name text, p_kind text, p_place text default null, p_note text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform crm_require_user();
  if not crm_has_any_access() then raise exception 'No CRM access' using errcode = '42501'; end if;
  insert into crm_organisations (name, kind, roles, place, note, created_by)
  values (btrim(p_name), p_kind, array[p_kind], nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Per-company account profile (owner, lead source, exhibition)
-- -----------------------------------------------------------------------------
create table if not exists crm_account_profiles (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references crm_organisations(id),
  company_id        uuid not null references companies(id),
  owner_id          uuid references auth.users(id),          -- null = Unassigned
  owner_assigned_by uuid references auth.users(id),
  owner_assigned_at timestamptz,
  lead_source       text check (lead_source is null or lead_source in (
                      'agency_call', 'linkedin', 'direct_client', 'whatsapp', 'instagram', 'website', 'referral', 'other', 'exhibition')),
  exhibition        text check (exhibition is null or length(btrim(exhibition)) between 1 and 200),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint crm_account_profiles_unique unique (organisation_id, company_id)
);
create index if not exists idx_crm_account_profiles_company_owner on crm_account_profiles(company_id, owner_id);

drop trigger if exists crm_account_profiles_set_updated_at on crm_account_profiles;
create trigger crm_account_profiles_set_updated_at before update on crm_account_profiles
  for each row execute function set_updated_at();
drop trigger if exists crm_account_profiles_audit on crm_account_profiles;
create trigger crm_account_profiles_audit after insert or update or delete on crm_account_profiles
  for each row execute function crm_audit_trigger();

alter table crm_account_profiles enable row level security;
drop policy if exists crm_account_profiles_select on crm_account_profiles;
create policy crm_account_profiles_select on crm_account_profiles for select using (crm_has_access(company_id));
revoke all on table crm_account_profiles from anon, authenticated, public;
grant select on table crm_account_profiles to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Functions
-- -----------------------------------------------------------------------------

-- Who may edit an organisation record. Same shape as crm_can_edit_contact: the person who added it, a founder, or the
-- owner of an open opportunity it is on. With a company, the company's profile of it (lead source, exhibition) needs a CRM
-- grant for that company and a founder OF that company (or the creator or an owner of an open opportunity in it).
-- Account owner and follow-up assignee are deliberately NOT part of this rule.
create or replace function crm_can_edit_organisation(p_org uuid, p_company uuid default null)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select crm_has_any_access()
    and (p_company is null or crm_has_access(p_company))
    and exists (select 1 from crm_organisations o where o.id = p_org and o.archived_at is null)
    and (
      exists (select 1 from crm_organisations o where o.id = p_org and o.created_by = auth.uid())
      or (case when p_company is null then crm_is_any_founder() else crm_is_founder(p_company) end)
      or exists (
        select 1 from crm_opportunities op
        where (op.agency_org_id = p_org or op.client_org_id = p_org)
          and op.owner_id = auth.uid() and op.stage <> 'lost' and crm_has_access(op.company_id)
          and (p_company is null or op.company_id = p_company))
    );
$$;

-- Create an organisation with only a name required, optionally with this company's profile (lead source, exhibition,
-- owner) and any number of contacts, atomically. Assigning an owner needs assign_owner in that company.
create or replace function crm_create_organisation_profile(
  p_name text,
  p_roles text[] default '{}',
  p_country_code text default null,
  p_website text default null,
  p_place text default null,
  p_note text default null,
  p_company_id uuid default null,
  p_lead_source text default null,
  p_exhibition text default null,
  p_owner_id uuid default null,
  p_contacts jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid; v_country text := nullif(upper(btrim(p_country_code)), ''); c jsonb;
begin
  perform crm_require_user();
  if not crm_has_any_access() then raise exception 'No CRM access' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Enter the name' using errcode = '22023'; end if;
  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' then raise exception 'Contacts must be a list' using errcode = '22023'; end if;
  if p_company_id is null and (p_lead_source is not null or p_exhibition is not null or p_owner_id is not null) then
    raise exception 'Choose the company these details are for' using errcode = '22023';
  end if;
  if p_company_id is not null and not crm_has_access(p_company_id) then
    raise exception 'You do not have Sales access for this company' using errcode = '42501';
  end if;
  if p_owner_id is not null then
    if not crm_has_capability(p_company_id, 'assign_owner') then
      raise exception 'Only a founder (or someone they delegated) can assign or reassign owners' using errcode = '42501';
    end if;
    if not crm_user_has_company_access(p_owner_id, p_company_id) then
      raise exception 'The chosen owner has no Sales access for this company' using errcode = '22023';
    end if;
  end if;
  insert into crm_organisations (name, kind, roles, country_code, website, place, note, created_by)
  values (btrim(p_name), 'client', coalesce(p_roles, '{}'), v_country, nullif(btrim(p_website), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  if p_company_id is not null then
    insert into crm_account_profiles (organisation_id, company_id, owner_id, owner_assigned_by, owner_assigned_at, lead_source, exhibition)
    values (v_id, p_company_id, p_owner_id, case when p_owner_id is not null then auth.uid() end,
            case when p_owner_id is not null then now() end, nullif(btrim(p_lead_source), ''), nullif(btrim(p_exhibition), ''));
  end if;
  for c in select * from jsonb_array_elements(p_contacts) loop
    if length(btrim(coalesce(c->>'name', ''))) = 0 then raise exception 'Every contact needs a name' using errcode = '22023'; end if;
    insert into crm_contacts (organisation_id, name, role_title, email, phone, created_by)
    values (v_id, btrim(c->>'name'), nullif(btrim(c->>'role_title'), ''), nullif(btrim(c->>'email'), ''),
            nullif(btrim(c->>'phone'), ''), auth.uid());
  end loop;
  return v_id;
end;
$$;

-- Edit the shared organisation record (name, roles, country, website, place, relationship notes).
create or replace function crm_update_organisation(p_org uuid, p_patch jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  k text;
  v_allowed text[] := array['name', 'roles', 'country_code', 'website', 'place', 'note'];
begin
  perform crm_require_user();
  if not crm_can_edit_organisation(p_org) then
    raise exception 'Only the person who added this organisation, a founder, or the owner of an opportunity it is on can change it'
      using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_allowed)) then raise exception 'Field % cannot be changed here', k using errcode = '22023'; end if;
  end loop;
  if p_patch ? 'name' and length(btrim(coalesce(p_patch->>'name', ''))) = 0 then
    raise exception 'Enter the name' using errcode = '22023';
  end if;
  if p_patch ? 'roles' and jsonb_typeof(p_patch->'roles') <> 'array' then
    raise exception 'Roles must be a list' using errcode = '22023';
  end if;
  update crm_organisations set
    name = case when p_patch ? 'name' then btrim(p_patch->>'name') else name end,
    roles = case when p_patch ? 'roles' then array(select jsonb_array_elements_text(p_patch->'roles')) else roles end,
    country_code = case when p_patch ? 'country_code' then nullif(upper(btrim(p_patch->>'country_code')), '') else country_code end,
    website = case when p_patch ? 'website' then nullif(btrim(p_patch->>'website'), '') else website end,
    place = case when p_patch ? 'place' then nullif(btrim(p_patch->>'place'), '') else place end,
    note = case when p_patch ? 'note' then nullif(btrim(p_patch->>'note'), '') else note end
   where id = p_org;
end;
$$;

-- This company's profile of an organisation: lead source and exhibition (the owner has its own function).
create or replace function crm_save_account_profile(p_org uuid, p_company uuid, p_patch jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare k text; v_allowed text[] := array['lead_source', 'exhibition'];
begin
  perform crm_require_user();
  if not crm_can_edit_organisation(p_org, p_company) then
    raise exception 'Only the person who added this organisation, a founder of this company, or the owner of an opportunity it is on can change it'
      using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_allowed)) then raise exception 'Field % cannot be changed here', k using errcode = '22023'; end if;
  end loop;
  insert into crm_account_profiles (organisation_id, company_id) values (p_org, p_company)
    on conflict (organisation_id, company_id) do nothing;
  update crm_account_profiles set
    lead_source = case when p_patch ? 'lead_source' then nullif(btrim(p_patch->>'lead_source'), '') else lead_source end,
    exhibition = case when p_patch ? 'exhibition' then nullif(btrim(p_patch->>'exhibition'), '') else exhibition end
   where organisation_id = p_org and company_id = p_company;
end;
$$;

-- Assign, reassign or clear (p_new_owner null = Unassigned) the ACCOUNT owner for one company. assign_owner capability
-- (founder implies it); the owner must hold an active CRM grant for that company. Touches no opportunity and no follow-up.
create or replace function crm_assign_account_owner(p_org uuid, p_company uuid, p_new_owner uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_old uuid;
begin
  perform crm_require_user();
  if not crm_has_capability(p_company, 'assign_owner') then
    raise exception 'Only a founder (or someone they delegated) can assign or reassign owners' using errcode = '42501';
  end if;
  if not exists (select 1 from crm_organisations o where o.id = p_org and o.archived_at is null) then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  if p_new_owner is not null and not crm_user_has_company_access(p_new_owner, p_company) then
    raise exception 'The chosen owner has no Sales access for this company' using errcode = '22023';
  end if;
  select owner_id into v_old from crm_account_profiles where organisation_id = p_org and company_id = p_company;
  if found and v_old is not distinct from p_new_owner then return; end if;
  insert into crm_account_profiles (organisation_id, company_id, owner_id, owner_assigned_by, owner_assigned_at)
  values (p_org, p_company, p_new_owner, auth.uid(), now())
  on conflict (organisation_id, company_id) do update
    set owner_id = excluded.owner_id, owner_assigned_by = auth.uid(), owner_assigned_at = now();
end;
$$;

-- Hand an OPEN follow-up to another person (same company, active CRM grant). Changes the follow-up only: never the
-- opportunity owner and never the account owner. Rule = the existing create-follow-up rule.
create or replace function crm_reassign_follow_up(p_follow_up_id uuid, p_new_assignee uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare f crm_follow_ups; o crm_opportunities;
begin
  perform crm_require_user();
  select * into f from crm_follow_ups where id = p_follow_up_id;
  if not found or not crm_has_access(f.company_id) then
    raise exception 'Follow-up not found' using errcode = 'P0002';
  end if;
  o := crm_lock_opportunity(f.opportunity_id);
  perform crm_require_follow_up_actor(f, o);
  if f.status <> 'open' then raise exception 'This follow-up is already closed' using errcode = '23514'; end if;
  if o.stage in ('won', 'lost') then raise exception 'A closed opportunity has no follow-ups' using errcode = '23514'; end if;
  if p_new_assignee <> auth.uid() and p_new_assignee <> o.owner_id and o.owner_id <> auth.uid()
     and not crm_has_capability(o.company_id, 'assign_owner') then
    raise exception 'Only the owner or a founder can assign follow-ups to others' using errcode = '42501';
  end if;
  if not crm_user_has_company_access(p_new_assignee, o.company_id) then
    raise exception 'The assignee has no Sales access for this company' using errcode = '22023';
  end if;
  if p_new_assignee = f.assigned_to then return; end if;
  update crm_follow_ups set assigned_to = p_new_assignee, updated_at = now() where id = p_follow_up_id;
  -- Reminders were generated for the previous assignee: let the new one get their own.
  delete from crm_reminders where follow_up_id = p_follow_up_id;
end;
$$;

revoke all on function
  crm_organisations_sync_kind(), crm_can_edit_organisation(uuid, uuid),
  crm_create_organisation_profile(text, text[], text, text, text, text, uuid, text, text, uuid, jsonb),
  crm_update_organisation(uuid, jsonb), crm_save_account_profile(uuid, uuid, jsonb),
  crm_assign_account_owner(uuid, uuid, uuid, text), crm_reassign_follow_up(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  crm_can_edit_organisation(uuid, uuid),
  crm_create_organisation_profile(text, text[], text, text, text, text, uuid, text, text, uuid, jsonb),
  crm_update_organisation(uuid, jsonb), crm_save_account_profile(uuid, uuid, jsonb),
  crm_assign_account_owner(uuid, uuid, uuid, text), crm_reassign_follow_up(uuid, uuid)
  to authenticated;

-- ROLLBACK (see supabase/manual-sql/crm_accounts_90_rollback.sql): drop the five functions, the table crm_account_profiles, the trigger,
-- then the three columns; restore crm_create_organisation from 20261115000200 (without roles). Export crm_account_profiles first.
