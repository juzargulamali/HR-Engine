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
--   5. The Excel import relied on a lock inside one server process. Duplicate and overwrite protection now lives in the database
--      (section 5): advisory locks, fill-only writes, a batch key and a preview fingerprint ('preview_stale' applies nothing).
--   6. Inquiry pickers ignored organisation roles. The database now refuses an agency without the agency role and an end client
--      without the end-client or direct-client role when the field is set or changed (section 6).
--   7. A follow-up could only hang off an inquiry. It may now hang off an account instead (section 7).
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
  if f.opportunity_id is null then
    -- A follow-up on an account with no inquiry: the same rule, with "the person who added it" where the inquiry owner would be.
    perform crm_require_account_follow_up_actor(f);
    if f.status <> 'open' then raise exception 'This follow-up is already closed' using errcode = '23514'; end if;
    if p_new_assignee <> auth.uid() and not crm_has_capability(f.company_id, 'assign_owner') then
      raise exception 'Only the owner or a founder can assign follow-ups to others' using errcode = '42501';
    end if;
    if not crm_user_has_company_access(p_new_assignee, f.company_id) then
      raise exception 'The assignee has no Sales access for this company' using errcode = '22023';
    end if;
    if p_new_assignee = f.assigned_to then return; end if;
    update crm_follow_ups set assigned_to = p_new_assignee, updated_at = now() where id = p_follow_up_id;
    return;
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

-- -----------------------------------------------------------------------------
-- 5. Database-enforced import safety (Excel import of organisations)
--    The import used to rely on a lock inside one server process. Overlapping confirms from different people, files or servers
--    must not create duplicates or overwrite anything changed since the preview, so the rules live HERE:
--      * one advisory lock per normalised name / website domain, taken (in a fixed order) for the whole batch;
--      * the match is re-checked inside the lock and only FILL-ONLY writes happen (a column is set only when it is empty,
--        a contact only when no contact has that e-mail / name, an account owner only when none is assigned);
--      * a batch key (unique per company) makes a repeated confirm a no-op that returns the first result;
--      * a fingerprint of what each row was planned against is compared at confirm; any difference applies NOTHING and
--        the answer is 'preview_stale' (all or nothing, one transaction);
--      * ambiguous matches (several candidates, or the same website under another name) are never applied.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from crm_contacts where organisation_id is not null and email_key is not null and archived_at is null
    group by organisation_id, email_key having count(*) > 1
  ) then
    raise exception 'An organisation holds the same contact e-mail twice. Resolve the rows listed by crm_accounts_00_preflight_readonly.sql (section D), then run this again.'
      using errcode = '23505';
  end if;
end $$;
create unique index if not exists uq_crm_contacts_org_email on crm_contacts(organisation_id, email_key)
  where email_key is not null and archived_at is null;

create table if not exists crm_import_batches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  batch_key   text not null check (length(batch_key) between 16 and 200),
  created_by  uuid not null references auth.users(id),
  result      jsonb not null,
  created_at  timestamptz not null default now(),
  constraint crm_import_batches_unique unique (company_id, batch_key)
);
alter table crm_import_batches enable row level security;   -- no policy: only the import function reads or writes it
revoke all on table crm_import_batches from anon, authenticated, public;

create or replace function crm_import_name_key(p_name text) returns text
language sql immutable
as $$ select lower(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]+', '', 'g')); $$;

-- Same reading as the application's websiteDomain(): no scheme, no www., no path/port/query, lower-case, and it must contain a dot.
create or replace function crm_import_domain(p_website text) returns text
language sql immutable
as $$
  select case when d like '%.%' then d end
  from (select nullif(lower(regexp_replace(regexp_replace(regexp_replace(btrim(coalesce(p_website, '')), '^[A-Za-z][A-Za-z0-9+.-]*://', ''), '^www\.', '', 'i'), '[/?#:].*$', '')), '') as d) x;
$$;

-- Existing, non-archived organisations an incoming name / website could be: the same normalised name or the same website domain.
create or replace function crm_import_candidates(p_name text, p_website text)
returns table (org_id uuid, by_name boolean, by_website boolean)
language sql stable security definer
set search_path = public
as $$
  with k as (select crm_import_name_key(p_name) as nk, crm_import_domain(p_website) as dm)
  select o.id, (k.nk <> '' and o.name_key = k.nk), (k.dm is not null and o.website_domain = k.dm)
  from crm_organisations o, k
  where o.archived_at is null and ((k.nk <> '' and o.name_key = k.nk) or (k.dm is not null and o.website_domain = k.dm))
  order by o.id;
$$;

-- What a row was planned against: the candidate set and, for each candidate, every value an import may fill (and the contact keys,
-- this company's lead source / exhibition / account owner). 'none' = no candidate. The preview and the confirm compute it the same way.
create or replace function crm_import_fingerprint(p_company uuid, p_name text, p_website text) returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(md5(jsonb_agg(x.j order by x.id)::text), 'none')
  from (
    select c.org_id as id, jsonb_build_object(
      'id', o.id, 'by_name', c.by_name, 'by_website', c.by_website, 'name', o.name, 'roles', o.roles, 'country', o.country_code,
      'website', o.website, 'note', o.note, 'owner', p.owner_id, 'lead', p.lead_source, 'exhibition', p.exhibition,
      'contacts', (select coalesce(jsonb_agg(s.ck order by s.ck), '[]'::jsonb)
                   from (select coalesce(ct.email_key, 'n:' || crm_import_name_key(ct.name)) as ck
                         from crm_contacts ct where ct.organisation_id = o.id and ct.archived_at is null) s)
    ) as j
    from crm_import_candidates(p_name, p_website) c
    join crm_organisations o on o.id = c.org_id
    left join crm_account_profiles p on p.organisation_id = o.id and p.company_id = p_company
  ) x;
$$;

-- Preview: the fingerprint of every row, keyed by the row's key. Reads only; needs Sales access for the company.
create or replace function crm_import_fingerprints(p_company uuid, p_items jsonb) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare r jsonb := '{}'::jsonb; i jsonb;
begin
  perform crm_require_user();
  if not crm_has_access(p_company) then
    raise exception 'You do not have Sales access for this company' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then
    raise exception 'Items must be a list of at most 2000 organisations' using errcode = '22023';
  end if;
  for i in select * from jsonb_array_elements(p_items) loop
    r := r || jsonb_build_object(i->>'key', crm_import_fingerprint(p_company, i->>'name', i->>'website'));
  end loop;
  return r;
end;
$$;

-- Contacts of one incoming row, without nameless ones and without repeats (same e-mail, or no e-mail and the same name).
create or replace function crm_import_clean_contacts(p jsonb) returns jsonb
language sql immutable
as $$
  select coalesce(jsonb_agg(d.c order by d.ord), '[]'::jsonb)
  from (
    select distinct on (q.ck) q.c, q.ord
    from (
      select t.c, t.ord,
             case when nullif(btrim(t.c->>'email'), '') is not null then 'e:' || lower(btrim(t.c->>'email'))
                  else 'n:' || crm_import_name_key(t.c->>'name') end as ck
      from jsonb_array_elements(coalesce(p, '[]'::jsonb)) with ordinality as t(c, ord)
      where crm_import_name_key(t.c->>'name') <> ''
    ) q
    order by q.ck, q.ord
  ) d;
$$;

-- One row, inside the batch's locks. Create when nothing matches; fill-only when exactly one organisation matches by name;
-- nothing when the match is ambiguous. Raises on a refusal (the caller reports it against the row and carries on).
create or replace function crm_import_apply_item(p_company uuid, it jsonb) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_n integer; v_org_id uuid; v_all_name boolean;
  v_org crm_organisations; v_profile crm_account_profiles;
  v_owner uuid := nullif(it->>'owner_id', '')::uuid;
  v_roles text[] := coalesce(array(select jsonb_array_elements_text(coalesce(it->'roles', '[]'::jsonb))), '{}'::text[]);
  v_country text := nullif(upper(btrim(it->>'country_code')), '');
  v_website text := nullif(btrim(it->>'website'), '');
  v_note text := nullif(btrim(it->>'note'), '');
  v_lead text := nullif(btrim(it->>'lead_source'), '');
  v_exh text := nullif(btrim(it->>'exhibition'), '');
  v_contacts jsonb := crm_import_clean_contacts(it->'contacts');
  c jsonb; v_email text; v_ckey text; v_added integer := 0; v_rows integer;
  v_org_changes boolean; v_prof_changes boolean; v_owner_set boolean := false;
begin
  select count(*), (array_agg(x.org_id))[1], bool_and(x.by_name) into v_n, v_org_id, v_all_name
    from crm_import_candidates(it->>'name', it->>'website') x;

  if v_n = 0 then
    perform crm_create_organisation_profile(btrim(it->>'name'), v_roles, v_country, v_website, null, v_note, p_company, v_lead, v_exh, v_owner, v_contacts);
    return jsonb_build_object('outcome', 'created', 'contacts_added', jsonb_array_length(v_contacts), 'owner_assigned', v_owner is not null);
  end if;
  if v_n > 1 or not v_all_name then
    return jsonb_build_object('outcome', 'ambiguous');
  end if;

  select * into v_org from crm_organisations where id = v_org_id for update;
  select * into v_profile from crm_account_profiles where organisation_id = v_org_id and company_id = p_company for update;
  v_org_changes :=
       (cardinality(v_org.roles) = 0 and cardinality(v_roles) > 0)
    or (nullif(btrim(coalesce(v_org.country_code, '')), '') is null and v_country is not null)
    or (nullif(btrim(coalesce(v_org.website, '')), '') is null and v_website is not null)
    or (nullif(btrim(coalesce(v_org.note, '')), '') is null and v_note is not null);
  v_prof_changes :=
       (v_profile.lead_source is null and v_lead is not null)
    or (nullif(btrim(coalesce(v_profile.exhibition, '')), '') is null and v_exh is not null);
  if v_org_changes and not crm_can_edit_organisation(v_org_id) then
    raise exception 'Only the person who added this organisation, a founder, or the owner of an opportunity it is on can change it' using errcode = '42501';
  end if;
  if v_prof_changes and not crm_can_edit_organisation(v_org_id, p_company) then
    raise exception 'Only the person who added this organisation, a founder of this company, or the owner of an opportunity it is on can change it' using errcode = '42501';
  end if;

  if v_org_changes then
    update crm_organisations set
      roles = case when cardinality(roles) = 0 and cardinality(v_roles) > 0 then v_roles else roles end,
      country_code = case when nullif(btrim(coalesce(country_code, '')), '') is null then coalesce(v_country, country_code) else country_code end,
      website = case when nullif(btrim(coalesce(website, '')), '') is null then coalesce(v_website, website) else website end,
      note = case when nullif(btrim(coalesce(note, '')), '') is null then coalesce(v_note, note) else note end
     where id = v_org_id;
  end if;
  if v_prof_changes then
    insert into crm_account_profiles (organisation_id, company_id, lead_source, exhibition) values (v_org_id, p_company, v_lead, v_exh)
    on conflict (organisation_id, company_id) do update set
      lead_source = coalesce(crm_account_profiles.lead_source, excluded.lead_source),
      exhibition = coalesce(nullif(btrim(crm_account_profiles.exhibition), ''), excluded.exhibition);
  end if;
  if v_owner is not null then
    insert into crm_account_profiles (organisation_id, company_id, owner_id, owner_assigned_by, owner_assigned_at)
    values (v_org_id, p_company, v_owner, auth.uid(), now())
    on conflict (organisation_id, company_id) do update
      set owner_id = excluded.owner_id, owner_assigned_by = excluded.owner_assigned_by, owner_assigned_at = excluded.owner_assigned_at
      where crm_account_profiles.owner_id is null;
    get diagnostics v_rows = row_count;
    v_owner_set := v_rows > 0;
  end if;
  for c in select * from jsonb_array_elements(v_contacts) loop
    v_email := nullif(lower(btrim(c->>'email')), '');
    v_ckey := crm_import_name_key(c->>'name');
    if exists (
      select 1 from crm_contacts ct where ct.organisation_id = v_org_id and ct.archived_at is null
        and (case when v_email is not null then ct.email_key = v_email or (ct.email_key is null and crm_import_name_key(ct.name) = v_ckey)
                  else crm_import_name_key(ct.name) = v_ckey end)
    ) then continue; end if;
    begin
      insert into crm_contacts (organisation_id, name, role_title, email, phone, created_by)
      values (v_org_id, btrim(c->>'name'), nullif(btrim(c->>'role_title'), ''), v_email, nullif(btrim(c->>'phone'), ''), auth.uid());
      v_added := v_added + 1;
    exception when unique_violation then null;   -- someone added the same e-mail a moment ago: it is there, nothing to add
    end;
  end loop;
  return jsonb_build_object('outcome', case when v_org_changes or v_prof_changes or v_owner_set or v_added > 0 then 'updated' else 'unchanged' end,
                            'contacts_added', v_added, 'owner_assigned', v_owner_set);
end;
$$;

-- Confirm. p_items: [{key, name, website, roles, country_code, note, lead_source, exhibition, owner_id, contacts, fingerprint}].
-- Returns {status: 'applied', created, updated, contacts_added, owners_assigned, untouched, failed: [{key, message}]} (and
-- repeated: true when the same batch key was applied before: nothing is done again), or {status: 'preview_stale', stale: [keys]}
-- with nothing written.
create or replace function crm_import_apply(p_company uuid, p_batch_key text, p_items jsonb) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := crm_require_user();
  it jsonb; v_key text; v_out jsonb; v_res jsonb; v_lock_keys text[];
  v_stale text[] := '{}'::text[];
  v_can_assign boolean;
  v_created integer := 0; v_updated integer := 0; v_contacts integer := 0; v_owners integer := 0; v_untouched integer := 0;
  v_failed jsonb := '[]'::jsonb;
begin
  if not crm_has_access(p_company) then
    raise exception 'You do not have Sales access for this company' using errcode = '42501';
  end if;
  if p_batch_key is null or length(p_batch_key) not between 16 and 200 then
    raise exception 'A batch key is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then
    raise exception 'Items must be a list of at most 2000 organisations' using errcode = '22023';
  end if;
  v_can_assign := crm_has_capability(p_company, 'assign_owner');

  -- The same batch twice (double click, retry, two servers): the second waits, then returns the first result.
  perform pg_advisory_xact_lock(hashtextextended('crm_import:batch:' || p_company::text || ':' || p_batch_key, 0));
  select b.result into v_res from crm_import_batches b where b.company_id = p_company and b.batch_key = p_batch_key;
  if found then return v_res || jsonb_build_object('repeated', true); end if;

  -- One lock per normalised name and per website domain (organisations are shared by companies, so the lock is too), always in
  -- the same order, so overlapping batches queue instead of racing or deadlocking.
  select array_agg(distinct s.k order by s.k) into v_lock_keys from (
    select 'n:' || crm_import_name_key(e->>'name') as k from jsonb_array_elements(p_items) e where crm_import_name_key(e->>'name') <> ''
    union all
    select 'd:' || crm_import_domain(e->>'website') from jsonb_array_elements(p_items) e where crm_import_domain(e->>'website') is not null
  ) s;
  foreach v_key in array coalesce(v_lock_keys, '{}'::text[]) loop
    perform pg_advisory_xact_lock(hashtextextended('crm_import:org:' || v_key, 0));
  end loop;

  -- Staleness: nothing is written unless EVERY row is still what the preview saw.
  for it in select * from jsonb_array_elements(p_items) loop
    if crm_import_fingerprint(p_company, it->>'name', it->>'website') is distinct from (it->>'fingerprint') then
      v_stale := v_stale || coalesce(it->>'key', '?');
      continue;
    end if;
    if nullif(it->>'owner_id', '') is not null then
      if not v_can_assign then
        raise exception 'Only a founder (or someone they delegated) can assign or reassign owners' using errcode = '42501';
      end if;
      if not crm_user_has_company_access((it->>'owner_id')::uuid, p_company) then
        v_stale := v_stale || coalesce(it->>'key', '?');
      end if;
    end if;
  end loop;
  if cardinality(v_stale) > 0 then
    return jsonb_build_object('status', 'preview_stale', 'stale_count', cardinality(v_stale), 'stale', to_jsonb(v_stale[1:20]));
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    begin
      v_out := crm_import_apply_item(p_company, it);
    exception when others then
      v_out := jsonb_build_object('outcome', 'failed', 'message', sqlerrm);
    end;
    case v_out->>'outcome'
      when 'created' then v_created := v_created + 1;
      when 'updated' then v_updated := v_updated + 1;
      when 'failed' then v_failed := v_failed || jsonb_build_object('key', it->>'key', 'message', v_out->>'message');
      else v_untouched := v_untouched + 1;
    end case;
    v_contacts := v_contacts + coalesce((v_out->>'contacts_added')::integer, 0);
    if coalesce((v_out->>'owner_assigned')::boolean, false) then v_owners := v_owners + 1; end if;
  end loop;

  v_res := jsonb_build_object('status', 'applied', 'created', v_created, 'updated', v_updated, 'contacts_added', v_contacts,
                              'owners_assigned', v_owners, 'untouched', v_untouched, 'failed', v_failed);
  insert into crm_import_batches (company_id, batch_key, created_by, result) values (p_company, p_batch_key, v_user, v_res);
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Organisation roles decide who can be on an inquiry
--    The pickers offer an organisation for a field only when it has that role (agency; end client or direct client); an organisation
--    with roles agency + client is offered in BOTH. Enforced here as well, so a forged request is refused: checked when an inquiry
--    is created and whenever one of the two fields CHANGES (an older inquiry keeps whatever it has until someone changes that field).
--    A record with no roles recorded reads as its legacy kind, so everything made before roles existed keeps working.
-- -----------------------------------------------------------------------------
create or replace function crm_organisation_roles(p_org uuid) returns text[]
language sql stable security definer
set search_path = public
as $$
  select case when cardinality(o.roles) > 0 then o.roles else array[o.kind] end from crm_organisations o where o.id = p_org;
$$;

create or replace function crm_opportunities_check_party_roles() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.agency_org_id is not null and (tg_op = 'INSERT' or new.agency_org_id is distinct from old.agency_org_id)
     and not coalesce('agency' = any (crm_organisation_roles(new.agency_org_id)), true) then
    raise exception 'That organisation is not recorded as an agency. Choose an agency, or add the Agency role to it first.' using errcode = '22023';
  end if;
  if new.client_org_id is not null and (tg_op = 'INSERT' or new.client_org_id is distinct from old.client_org_id)
     and not coalesce(crm_organisation_roles(new.client_org_id) && array['client', 'direct']::text[], true) then
    raise exception 'That organisation is not recorded as an end client or direct client. Choose another, or add the End client or Direct client role to it first.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists crm_opportunities_party_roles on crm_opportunities;
create trigger crm_opportunities_party_roles before insert or update of agency_org_id, client_org_id on crm_opportunities
  for each row execute function crm_opportunities_check_party_roles();

-- -----------------------------------------------------------------------------
-- 7. A dated follow-up on an ACCOUNT that has no inquiry
--    The same follow-up row, now allowed to hang off the organisation instead of an inquiry (opportunity_id null, organisation_id set, one of the two
--    required). It appears wherever follow-ups appear (Follow-ups, My Day, the account page) and completes like any other. It has no inquiry, so
--    there is no inquiry stage to protect and no inquiry owner: the rules that name the inquiry owner use "the person who created it" instead.
--    Account owner and follow-up assignee remain independent: nothing here reads or writes crm_account_profiles.
-- -----------------------------------------------------------------------------
alter table crm_follow_ups alter column opportunity_id drop not null;
alter table crm_follow_ups add column if not exists organisation_id uuid references crm_organisations(id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_follow_ups_target') then
    alter table crm_follow_ups add constraint crm_follow_ups_target check (opportunity_id is not null or organisation_id is not null);
  end if;
end $$;
create index if not exists idx_crm_follow_ups_org on crm_follow_ups(organisation_id) where organisation_id is not null;

-- Who may act on an account follow-up: the assignee, the person who created it, or a founder of the company.
create or replace function crm_require_account_follow_up_actor(f crm_follow_ups)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if f.assigned_to <> auth.uid() and f.created_by <> auth.uid() and not crm_is_founder(f.company_id) then
    raise exception 'Only the assignee, the person who added it or a founder can change this follow-up' using errcode = '42501';
  end if;
end;
$$;

-- Add a dated follow-up to an account. Same rule as an inquiry follow-up: anyone with Sales access for the company may put one on their own list;
-- putting it on someone else's list is an assignment decision (assign_owner, founders hold it). The assignee must hold Sales access for the company.
create or replace function crm_create_account_follow_up(
  p_org uuid, p_company uuid, p_title text, p_due_at timestamptz, p_kind text default 'other', p_assigned_to uuid default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_assignee uuid; v_new uuid;
begin
  perform crm_require_user();
  if not crm_has_access(p_company) then
    raise exception 'You do not have Sales access for this company' using errcode = '42501';
  end if;
  if not exists (select 1 from crm_organisations o where o.id = p_org and o.archived_at is null) then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  if length(btrim(coalesce(p_title, ''))) = 0 or p_due_at is null then
    raise exception 'A follow-up needs a title and a due date' using errcode = '22023';
  end if;
  v_assignee := coalesce(p_assigned_to, auth.uid());
  if v_assignee <> auth.uid() and not crm_has_capability(p_company, 'assign_owner') then
    raise exception 'Only the owner or a founder can assign follow-ups to others' using errcode = '42501';
  end if;
  if not crm_user_has_company_access(v_assignee, p_company) then
    raise exception 'The assignee has no Sales access for this company' using errcode = '22023';
  end if;
  insert into crm_follow_ups (opportunity_id, organisation_id, company_id, assigned_to, title, kind, due_at, created_by)
  values (null, p_org, p_company, v_assignee, btrim(p_title), coalesce(p_kind, 'other'), p_due_at, auth.uid())
  returning id into v_new;
  return v_new;
end;
$$;

-- The three existing follow-up functions, each with one added branch for a follow-up that has no inquiry. The inquiry branch is the original text.
create or replace function crm_complete_follow_up(
  p_follow_up_id uuid,
  p_outcome text,
  p_next_title text default null,
  p_next_due timestamptz default null,
  p_next_kind text default 'other',
  p_hold_reason text default null,
  p_hold_review_date date default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  f crm_follow_ups;
  o crm_opportunities;
  v_has_next boolean := length(btrim(coalesce(p_next_title, ''))) > 0 and p_next_due is not null;
  v_has_hold boolean := length(btrim(coalesce(p_hold_reason, ''))) > 0 and p_hold_review_date is not null;
  v_remaining integer;
begin
  perform crm_require_user();
  select * into f from crm_follow_ups where id = p_follow_up_id;
  if not found or not crm_has_access(f.company_id) then
    raise exception 'Follow-up not found' using errcode = 'P0002';
  end if;
  if f.opportunity_id is null then
    -- Account follow-up: no inquiry stage to protect. An optional next follow-up stays with the same assignee.
    select * into f from crm_follow_ups where id = p_follow_up_id for update;
    perform crm_require_account_follow_up_actor(f);
    if f.status <> 'open' then
      raise exception 'This follow-up is already closed' using errcode = '23514';
    end if;
    if length(btrim(coalesce(p_outcome, ''))) = 0 then
      raise exception 'Record the outcome of this follow-up' using errcode = '22023';
    end if;
    update crm_follow_ups set status = 'done', completed_at = now(), completed_by = auth.uid(), outcome = btrim(p_outcome), updated_at = now()
     where id = p_follow_up_id;
    if v_has_next then
      insert into crm_follow_ups (opportunity_id, organisation_id, company_id, assigned_to, title, kind, due_at, created_by)
      values (null, f.organisation_id, f.company_id, f.assigned_to, btrim(p_next_title), coalesce(p_next_kind, 'other'), p_next_due, auth.uid());
    end if;
    return;
  end if;
  o := crm_lock_opportunity(f.opportunity_id);
  select * into f from crm_follow_ups where id = p_follow_up_id for update;
  perform crm_require_follow_up_actor(f, o);
  if f.status <> 'open' then
    raise exception 'This follow-up is already closed' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_outcome, ''))) = 0 then
    raise exception 'Record the outcome of this follow-up' using errcode = '22023';
  end if;

  update crm_follow_ups set status = 'done', completed_at = now(), completed_by = auth.uid(), outcome = btrim(p_outcome),
         updated_at = now()
   where id = p_follow_up_id;

  if crm_stage_index(o.stage) is not null then      -- active (open, not on hold, not closed)
    select count(*) into v_remaining from crm_follow_ups where opportunity_id = o.id and status = 'open';
    if v_remaining = 0 then
      if v_has_next then
        insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, kind, due_at, created_by)
        values (o.id, o.company_id, o.owner_id, btrim(p_next_title), coalesce(p_next_kind, 'other'), p_next_due, auth.uid());
      elsif v_has_hold then
        if p_hold_review_date < crm_today_dubai() then
          raise exception 'Choose a review date that is today or later' using errcode = '22023';
        end if;
        update crm_opportunities set stage = 'on_hold', stage_before_hold = o.stage, hold_reason = btrim(p_hold_reason),
               hold_review_date = p_hold_review_date, stage_changed_at = now(), version = version + 1
         where id = o.id;
        perform crm_log_event(o.id, o.company_id, 'held', o.stage, 'on_hold', btrim(p_hold_reason));
      else
        raise exception 'Add a next action or put the opportunity on hold before completing the last follow-up'
          using errcode = '23514';
      end if;
    elsif v_has_next then
      insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, kind, due_at, created_by)
      values (o.id, o.company_id, o.owner_id, btrim(p_next_title), coalesce(p_next_kind, 'other'), p_next_due, auth.uid());
    end if;
  end if;
  insert into crm_activities (opportunity_id, company_id, kind, body, is_internal, occurred_at, created_by)
  values (o.id, o.company_id, 'note', 'Follow-up done: ' || f.title || '. ' || btrim(p_outcome), true, now(), auth.uid());
end;
$$;

create or replace function crm_reschedule_follow_up(p_follow_up_id uuid, p_due_at timestamptz)
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
  if f.opportunity_id is null then
    perform crm_require_account_follow_up_actor(f);
    if f.status <> 'open' then raise exception 'This follow-up is already closed' using errcode = '23514'; end if;
    update crm_follow_ups set due_at = p_due_at, updated_at = now() where id = p_follow_up_id;
    return;
  end if;
  o := crm_lock_opportunity(f.opportunity_id);
  perform crm_require_follow_up_actor(f, o);
  if f.status <> 'open' then raise exception 'This follow-up is already closed' using errcode = '23514'; end if;
  update crm_follow_ups set due_at = p_due_at, updated_at = now() where id = p_follow_up_id;
  -- A rescheduled follow-up is a new reminder moment.
  delete from crm_reminders where follow_up_id = p_follow_up_id;
end;
$$;

create or replace function crm_cancel_follow_up(p_follow_up_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare f crm_follow_ups; o crm_opportunities; v_others integer;
begin
  perform crm_require_user();
  select * into f from crm_follow_ups where id = p_follow_up_id;
  if not found or not crm_has_access(f.company_id) then
    raise exception 'Follow-up not found' using errcode = 'P0002';
  end if;
  if f.opportunity_id is null then
    perform crm_require_account_follow_up_actor(f);
    if f.status <> 'open' then raise exception 'This follow-up is already closed' using errcode = '23514'; end if;
    if length(btrim(coalesce(p_reason, ''))) = 0 then
      raise exception 'Say why this follow-up is being cancelled' using errcode = '22023';
    end if;
    update crm_follow_ups set status = 'cancelled', outcome = btrim(p_reason), updated_at = now() where id = p_follow_up_id;
    return;
  end if;
  o := crm_lock_opportunity(f.opportunity_id);
  perform crm_require_follow_up_actor(f, o);
  if f.status <> 'open' then raise exception 'This follow-up is already closed' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say why this follow-up is being cancelled' using errcode = '22023';
  end if;
  select count(*) into v_others from crm_follow_ups where opportunity_id = o.id and status = 'open' and id <> f.id;
  if v_others = 0 and crm_stage_index(o.stage) is not null then
    raise exception 'This is the only next action. Complete it with a new next action, or put the opportunity on hold.'
      using errcode = '23514';
  end if;
  update crm_follow_ups set status = 'cancelled', outcome = btrim(p_reason), updated_at = now() where id = p_follow_up_id;
end;
$$;

revoke all on function
  crm_organisations_sync_kind(), crm_can_edit_organisation(uuid, uuid),
  crm_create_organisation_profile(text, text[], text, text, text, text, uuid, text, text, uuid, jsonb),
  crm_update_organisation(uuid, jsonb), crm_save_account_profile(uuid, uuid, jsonb),
  crm_assign_account_owner(uuid, uuid, uuid, text), crm_reassign_follow_up(uuid, uuid),
  crm_import_name_key(text), crm_import_domain(text), crm_import_candidates(text, text), crm_import_fingerprint(uuid, text, text),
  crm_import_fingerprints(uuid, jsonb), crm_import_clean_contacts(jsonb), crm_import_apply_item(uuid, jsonb), crm_import_apply(uuid, text, jsonb),
  crm_organisation_roles(uuid), crm_opportunities_check_party_roles(),
  crm_require_account_follow_up_actor(crm_follow_ups), crm_create_account_follow_up(uuid, uuid, text, timestamptz, text, uuid),
  crm_complete_follow_up(uuid, text, text, timestamptz, text, text, date), crm_reschedule_follow_up(uuid, timestamptz), crm_cancel_follow_up(uuid, text)
  from public, anon, authenticated;
grant execute on function
  crm_can_edit_organisation(uuid, uuid),
  crm_create_organisation_profile(text, text[], text, text, text, text, uuid, text, text, uuid, jsonb),
  crm_update_organisation(uuid, jsonb), crm_save_account_profile(uuid, uuid, jsonb),
  crm_assign_account_owner(uuid, uuid, uuid, text), crm_reassign_follow_up(uuid, uuid),
  crm_import_fingerprints(uuid, jsonb), crm_import_apply(uuid, text, jsonb),
  crm_create_account_follow_up(uuid, uuid, text, timestamptz, text, uuid),
  crm_complete_follow_up(uuid, text, text, timestamptz, text, text, date), crm_reschedule_follow_up(uuid, timestamptz), crm_cancel_follow_up(uuid, text)
  to authenticated;

-- ROLLBACK (see supabase/manual-sql/crm_accounts_90_rollback.sql): drop the import functions, the trigger crm_opportunities_party_roles, the account follow-up
-- function, the table crm_import_batches and the unique index uq_crm_contacts_org_email; delete account follow-ups (organisation_id not null), then drop the
-- column and restore not-null on crm_follow_ups.opportunity_id and the three follow-up functions from 20261115000200; then drop the five functions, the table
-- crm_account_profiles, the trigger, the three columns; restore crm_create_organisation from 20261115000200 (without roles). Export crm_account_profiles first.
