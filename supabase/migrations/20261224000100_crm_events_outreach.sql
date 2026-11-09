-- Sales & CRM: Events & Exhibitions, exhibitor / agency observations, an enquiry-to-edition link and one shared Outreach priority per account.
-- ADDITIVE ONLY. Applied AFTER 20261223000200. Nothing existing is altered except two NEW nullable columns (crm_organisations.outreach_priority and its two
-- audit columns; crm_opportunities.event_edition_id). No existing row, link, function, policy or grant is changed or rewritten; no enquiry is relinked and no
-- value is guessed from old free text (crm_account_profiles.exhibition and the enquiry location stay exactly as they are). The functions crm_create_opportunity and
-- crm_update_opportunity are NOT touched (so nothing that calls them, JARVIS included, changes): the link is set by its own function.
--
-- WHAT IS SHARED AND WHAT IS NOT
--   Shared by every person with a Sales grant in any company (like organisations and contacts): events, editions, observations, the outreach priority.
--     Read: crm_has_any_access(). Written ONLY through the functions below (no DML grants).
--   Company-scoped, unchanged: enquiries (crm_opportunities, read with crm_has_access(company_id)), estimates, account profiles (owner, lead source, exhibition).
--     The edition link lives on the enquiry, so edition counts are computed by the app from the enquiries the VIEWER can read: an enquiry of a company the viewer has
--     no grant for is invisible to them and contributes nothing, to a count or to a drill-down.
--
-- WHO MAY DO WHAT (decisions, each is one line to tighten later)
--   outreach priority      any Sales grant may set it (it is the team's rating, not a record edit); who set it and when is stored. The existing organisation edit rule
--                          (creator / founder / owner of an open enquiry) is NOT applied to this one field.
--   add event / edition / observation   any Sales grant (needed at a show, on a phone).
--   edit or remove one     the person who added it, or a founder in any company.
--   link an enquiry to an edition      the enquiry owner or a founder of its company (the rule crm_update_opportunity already applies), not on a lost enquiry.
--   remove event / edition  deleted only when nothing uses it; with linked enquiries or observations it is ARCHIVED and every link and observation stays.
--
-- ROLLBACK: supabase/manual-sql/crm_events_90_rollback.sql (export the four tables first).

-- -----------------------------------------------------------------------------
-- 1. One shared outreach priority per account (1 to 5, 5 = highest; null = Unrated)
-- -----------------------------------------------------------------------------
alter table crm_organisations add column if not exists outreach_priority smallint check (outreach_priority is null or outreach_priority between 1 and 5);
alter table crm_organisations add column if not exists outreach_priority_by uuid references auth.users(id);
alter table crm_organisations add column if not exists outreach_priority_at timestamptz;
create index if not exists idx_crm_organisations_priority on crm_organisations(outreach_priority) where outreach_priority is not null;

create or replace function crm_set_outreach_priority(p_org uuid, p_priority integer)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform crm_require_user();
  if not crm_has_any_access() then raise exception 'You do not have Sales access' using errcode = '42501'; end if;
  if p_priority is not null and p_priority not between 1 and 5 then
    raise exception 'Outreach priority is 1 to 5 (5 is highest), or Unrated' using errcode = '22023';
  end if;
  update crm_organisations set outreach_priority = p_priority, outreach_priority_by = case when p_priority is null then null else auth.uid() end,
         outreach_priority_at = case when p_priority is null then null else now() end
   where id = p_org and archived_at is null;
  if not found then raise exception 'Account not found' using errcode = 'P0002'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Events (the recurring thing) and editions (one occurrence, with its own dates and place)
-- -----------------------------------------------------------------------------
create table if not exists crm_events (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 200),
  name_key     text generated always as (lower(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'))) stored,
  kind         text not null default 'exhibition' check (kind in ('exhibition', 'conference', 'other')),
  website      text check (website is null or length(btrim(website)) between 1 and 300),
  note         text check (note is null or length(note) <= 1000),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create unique index if not exists uq_crm_events_name on crm_events(name_key) where archived_at is null;

create table if not exists crm_event_editions (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references crm_events(id),
  start_date   date not null,
  end_date     date not null,
  city         text check (city is null or length(btrim(city)) between 1 and 100),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  venue        text check (venue is null or length(btrim(venue)) between 1 and 200),
  note         text check (note is null or length(note) <= 1000),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint crm_event_editions_dates check (end_date >= start_date)
);
create unique index if not exists uq_crm_event_editions_start on crm_event_editions(event_id, start_date) where archived_at is null;
create index if not exists idx_crm_event_editions_start on crm_event_editions(start_date);

-- The enquiry's optional link to an edition. Nullable: every existing enquiry keeps working with no link. ON DELETE RESTRICT: an edition with linked enquiries can never be deleted.
alter table crm_opportunities add column if not exists event_edition_id uuid references crm_event_editions(id);
create index if not exists idx_crm_opp_edition on crm_opportunities(event_edition_id) where event_edition_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Observations: what was seen at ONE edition for ONE exhibitor. Several rows per exhibitor and edition are allowed (several stands, several agencies,
--    several roles); nothing is merged or inferred. No row at all means "No observation".
--      kind = 'exhibited'        with a known agency (agency_org_id) OR agency_unknown = true  ("Agency unknown")
--      kind = 'did_not_exhibit'  recorded explicitly; no agency, no stand                      ("Did not exhibit")
--    verification = 'unverified' (heard / seen on a list) or 'confirmed' (seen or told directly); an unverified row is kept and shown as such.
-- -----------------------------------------------------------------------------
create table if not exists crm_event_observations (
  id               uuid primary key default gen_random_uuid(),
  edition_id       uuid not null references crm_event_editions(id),
  exhibitor_org_id uuid not null references crm_organisations(id),
  kind             text not null default 'exhibited' check (kind in ('exhibited', 'did_not_exhibit')),
  agency_org_id    uuid references crm_organisations(id),
  agency_unknown   boolean not null default false,
  stand_no         text check (stand_no is null or length(btrim(stand_no)) between 1 and 40),
  agency_role      text check (agency_role is null or agency_role in ('stand_builder', 'stand_design', 'av_technology', 'fabrication', 'other')),
  note             text check (note is null or length(note) <= 1000),
  verification     text not null default 'unverified' check (verification in ('unverified', 'confirmed')),
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint crm_event_observations_shape check (
    (kind = 'did_not_exhibit' and agency_org_id is null and agency_unknown = false and stand_no is null and agency_role is null)
    or (kind = 'exhibited' and ((agency_org_id is not null) <> agency_unknown))
  )
);
create index if not exists idx_crm_event_obs_edition on crm_event_observations(edition_id);
create index if not exists idx_crm_event_obs_exhibitor on crm_event_observations(exhibitor_org_id);
create index if not exists idx_crm_event_obs_agency on crm_event_observations(agency_org_id) where agency_org_id is not null;

do $$
declare t text;
begin
  foreach t in array array['crm_events', 'crm_event_editions', 'crm_event_observations'] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_set_updated_at', t);
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function crm_audit_trigger()', t || '_audit', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (crm_has_any_access())', t || '_select', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant select on table %I to authenticated', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Functions
-- -----------------------------------------------------------------------------
-- Edit / remove rule for an event, edition or observation: the person who added it, or a founder in any company.
create or replace function crm_can_edit_event_record(p_created_by uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select crm_has_any_access() and (p_created_by = auth.uid() or crm_is_any_founder());
$$;

create or replace function crm_save_event(p_id uuid, p_name text, p_kind text default 'exhibition', p_website text default null, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := crm_require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_key text := lower(regexp_replace(btrim(coalesce(p_name, '')), '[^A-Za-z0-9]+', '', 'g'));
  v crm_events;
  v_id uuid;
begin
  if not crm_has_any_access() then raise exception 'You do not have Sales access' using errcode = '42501'; end if;
  if length(v_name) = 0 or length(v_name) > 200 then raise exception 'Enter the event name (up to 200 characters)' using errcode = '22023'; end if;
  if coalesce(p_kind, '') not in ('exhibition', 'conference', 'other') then raise exception 'Choose exhibition, conference or other' using errcode = '22023'; end if;
  if v_key = '' then raise exception 'The event name needs letters or digits' using errcode = '22023'; end if;
  if p_id is null then
    if exists (select 1 from crm_events where archived_at is null and name_key = v_key) then
      raise exception 'An event with that name already exists. Open it and add the next edition instead.' using errcode = '23505';
    end if;
    insert into crm_events (name, kind, website, note, created_by)
    values (v_name, p_kind, nullif(btrim(p_website), ''), nullif(btrim(p_note), ''), v_user) returning id into v_id;
    return v_id;
  end if;
  select * into v from crm_events where id = p_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not crm_can_edit_event_record(v.created_by) then
    raise exception 'Only the person who added this event, or a founder, can change it' using errcode = '42501';
  end if;
  if exists (select 1 from crm_events where archived_at is null and name_key = v_key and id <> p_id) then
    raise exception 'Another event already has that name' using errcode = '23505';
  end if;
  update crm_events set name = v_name, kind = p_kind, website = nullif(btrim(p_website), ''), note = nullif(btrim(p_note), '') where id = p_id;
  return p_id;
end;
$$;

-- Adds an edition (p_id null) or edits ONE edition's dates and place. An edition never moves to another event and adding the next edition never touches an earlier one.
create or replace function crm_save_edition(
  p_id uuid, p_event uuid, p_start date, p_end date, p_city text default null, p_country text default null, p_venue text default null, p_note text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := crm_require_user();
  v crm_event_editions;
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  v_id uuid;
begin
  if not crm_has_any_access() then raise exception 'You do not have Sales access' using errcode = '42501'; end if;
  if p_start is null or p_end is null then raise exception 'Enter the start and end dates' using errcode = '22023'; end if;
  if p_end < p_start then raise exception 'The end date cannot be before the start date' using errcode = '22023'; end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then raise exception 'Use a two-letter country code' using errcode = '22023'; end if;
  if p_id is null then
    if p_event is null or not exists (select 1 from crm_events where id = p_event and archived_at is null) then
      raise exception 'Choose an event (an archived event takes no new edition)' using errcode = '22023';
    end if;
    if exists (select 1 from crm_event_editions where event_id = p_event and start_date = p_start and archived_at is null) then
      raise exception 'That event already has an edition starting on that date' using errcode = '23505';
    end if;
    insert into crm_event_editions (event_id, start_date, end_date, city, country_code, venue, note, created_by)
    values (p_event, p_start, p_end, nullif(btrim(p_city), ''), v_country, nullif(btrim(p_venue), ''), nullif(btrim(p_note), ''), v_user) returning id into v_id;
    return v_id;
  end if;
  select * into v from crm_event_editions where id = p_id for update;
  if not found then raise exception 'Edition not found' using errcode = 'P0002'; end if;
  if not crm_can_edit_event_record(v.created_by) then
    raise exception 'Only the person who added this edition, or a founder, can change it' using errcode = '42501';
  end if;
  if exists (select 1 from crm_event_editions where event_id = v.event_id and start_date = p_start and archived_at is null and id <> p_id) then
    raise exception 'That event already has an edition starting on that date' using errcode = '23505';
  end if;
  update crm_event_editions set start_date = p_start, end_date = p_end, city = nullif(btrim(p_city), ''), country_code = v_country,
         venue = nullif(btrim(p_venue), ''), note = nullif(btrim(p_note), '') where id = p_id;
  return p_id;
end;
$$;

-- An edition is USED when an enquiry is linked to it or an observation was recorded at it. (Counts here see every company: it decides safety, it returns no figures.)
create or replace function crm_edition_in_use(p_edition uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from crm_opportunities where event_edition_id = p_edition)
      or exists (select 1 from crm_event_observations where edition_id = p_edition);
$$;

-- Removes an unused edition, archives a used one (links and observations stay). Returns 'deleted' or 'archived'.
create or replace function crm_remove_edition(p_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare v crm_event_editions;
begin
  perform crm_require_user();
  select * into v from crm_event_editions where id = p_id for update;
  if not found then raise exception 'Edition not found' using errcode = 'P0002'; end if;
  if not crm_can_edit_event_record(v.created_by) then
    raise exception 'Only the person who added this edition, or a founder, can remove it' using errcode = '42501';
  end if;
  if crm_edition_in_use(p_id) then
    update crm_event_editions set archived_at = coalesce(archived_at, now()) where id = p_id;
    return 'archived';
  end if;
  delete from crm_event_editions where id = p_id;
  return 'deleted';
end;
$$;

-- Removes an unused event with its unused editions; with anything used it is archived together with the used editions (the unused ones are deleted). Returns 'deleted' or 'archived'.
create or replace function crm_remove_event(p_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare v crm_events; e record; v_used boolean := false;
begin
  perform crm_require_user();
  select * into v from crm_events where id = p_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not crm_can_edit_event_record(v.created_by) then
    raise exception 'Only the person who added this event, or a founder, can remove it' using errcode = '42501';
  end if;
  for e in select id from crm_event_editions where event_id = p_id loop
    if crm_edition_in_use(e.id) then
      v_used := true;
      update crm_event_editions set archived_at = coalesce(archived_at, now()) where id = e.id;
    else
      delete from crm_event_editions where id = e.id;
    end if;
  end loop;
  if v_used then
    update crm_events set archived_at = coalesce(archived_at, now()) where id = p_id;
    return 'archived';
  end if;
  delete from crm_events where id = p_id;
  return 'deleted';
end;
$$;

-- The shape rules shared by recording and editing an observation (the table CHECK repeats the shape).
create or replace function crm_observation_check(p_kind text, p_exhibitor uuid, p_agency uuid, p_agency_unknown boolean, p_stand text, p_role text, p_verification text)
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if coalesce(p_kind, '') not in ('exhibited', 'did_not_exhibit') then raise exception 'Choose Exhibited or Did not exhibit' using errcode = '22023'; end if;
  if coalesce(p_verification, '') not in ('unverified', 'confirmed') then raise exception 'Choose Unverified or Confirmed' using errcode = '22023'; end if;
  if p_exhibitor is null or not exists (select 1 from crm_organisations where id = p_exhibitor and archived_at is null) then
    raise exception 'Choose the exhibitor' using errcode = '22023';
  end if;
  if p_kind = 'did_not_exhibit' then
    if p_agency is not null or coalesce(p_agency_unknown, false) or nullif(btrim(coalesce(p_stand, '')), '') is not null or p_role is not null then
      raise exception 'Did not exhibit takes no agency, stand or role' using errcode = '22023';
    end if;
    return;
  end if;
  if (p_agency is not null) = coalesce(p_agency_unknown, false) then
    raise exception 'Choose the agency, or mark the agency as unknown' using errcode = '22023';
  end if;
  if p_agency is not null then
    if not exists (select 1 from crm_organisations where id = p_agency and archived_at is null) then raise exception 'Choose an existing agency' using errcode = '22023'; end if;
    if not coalesce('agency' = any (crm_organisation_roles(p_agency)), true) then
      raise exception 'That organisation is not recorded as an agency. Choose an agency, or add the Agency role to it first.' using errcode = '22023';
    end if;
  end if;
  if p_role is not null and p_role not in ('stand_builder', 'stand_design', 'av_technology', 'fabrication', 'other') then
    raise exception 'Choose a listed agency role' using errcode = '22023';
  end if;
end;
$$;

create or replace function crm_record_observation(
  p_edition uuid, p_exhibitor uuid, p_kind text default 'exhibited', p_agency uuid default null, p_agency_unknown boolean default false,
  p_stand text default null, p_role text default null, p_note text default null, p_verification text default 'unverified'
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_user uuid := crm_require_user(); v_id uuid;
begin
  if not crm_has_any_access() then raise exception 'You do not have Sales access' using errcode = '42501'; end if;
  if p_edition is null or not exists (select 1 from crm_event_editions where id = p_edition and archived_at is null) then
    raise exception 'Choose an edition (an archived edition takes no new observation)' using errcode = '22023';
  end if;
  perform crm_observation_check(p_kind, p_exhibitor, p_agency, p_agency_unknown, p_stand, p_role, p_verification);
  insert into crm_event_observations (edition_id, exhibitor_org_id, kind, agency_org_id, agency_unknown, stand_no, agency_role, note, verification, created_by)
  values (p_edition, p_exhibitor, p_kind, p_agency, coalesce(p_agency_unknown, false), nullif(btrim(coalesce(p_stand, '')), ''), p_role, nullif(btrim(coalesce(p_note, '')), ''), p_verification, v_user)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function crm_update_observation(
  p_id uuid, p_kind text, p_agency uuid default null, p_agency_unknown boolean default false,
  p_stand text default null, p_role text default null, p_note text default null, p_verification text default 'unverified'
) returns void
language plpgsql security definer
set search_path = public
as $$
declare v crm_event_observations;
begin
  perform crm_require_user();
  select * into v from crm_event_observations where id = p_id for update;
  if not found then raise exception 'Observation not found' using errcode = 'P0002'; end if;
  if not crm_can_edit_event_record(v.created_by) then
    raise exception 'Only the person who recorded this observation, or a founder, can change it' using errcode = '42501';
  end if;
  perform crm_observation_check(p_kind, v.exhibitor_org_id, p_agency, p_agency_unknown, p_stand, p_role, p_verification);
  update crm_event_observations set kind = p_kind, agency_org_id = p_agency, agency_unknown = coalesce(p_agency_unknown, false),
         stand_no = nullif(btrim(coalesce(p_stand, '')), ''), agency_role = p_role, note = nullif(btrim(coalesce(p_note, '')), ''), verification = p_verification
   where id = p_id;
end;
$$;

create or replace function crm_remove_observation(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v crm_event_observations;
begin
  perform crm_require_user();
  select * into v from crm_event_observations where id = p_id for update;
  if not found then raise exception 'Observation not found' using errcode = 'P0002'; end if;
  if not crm_can_edit_event_record(v.created_by) then
    raise exception 'Only the person who recorded this observation, or a founder, can remove it' using errcode = '42501';
  end if;
  delete from crm_event_observations where id = p_id;
end;
$$;

-- Sets, changes or clears (null) the edition an enquiry is linked to. Same rule and version check as editing the enquiry's details; a lost enquiry is not edited.
-- A NEW link must point at a live (not archived) edition; keeping an existing link to an archived one is a no-op.
create or replace function crm_set_opportunity_edition(p_id uuid, p_edition uuid, p_expected_version integer default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v crm_opportunities;
  v_version integer;
  v_label text;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  if v.stage = 'lost' then raise exception 'A lost opportunity can no longer be edited' using errcode = '23514'; end if;
  if v.event_edition_id is not distinct from p_edition then return v.version; end if;
  if p_edition is not null then
    select e.name || ' · ' || extract(year from d.start_date)::text || coalesce(' · ' || d.city, '') into v_label
      from crm_event_editions d join crm_events e on e.id = d.event_id where d.id = p_edition and d.archived_at is null and e.archived_at is null;
    if v_label is null then raise exception 'Choose an edition from the list (an archived or unknown edition cannot be linked)' using errcode = '22023'; end if;
  end if;
  update crm_opportunities set event_edition_id = p_edition, version = version + 1 where id = p_id returning version into v_version;
  perform crm_log_event(p_id, v.company_id, 'details_changed', null, case when p_edition is null then 'event link cleared' else 'event: ' || v_label end);
  return v_version;
end;
$$;

revoke all on function
  crm_set_outreach_priority(uuid, integer), crm_can_edit_event_record(uuid), crm_save_event(uuid, text, text, text, text),
  crm_save_edition(uuid, uuid, date, date, text, text, text, text), crm_edition_in_use(uuid), crm_remove_edition(uuid), crm_remove_event(uuid),
  crm_observation_check(text, uuid, uuid, boolean, text, text, text), crm_record_observation(uuid, uuid, text, uuid, boolean, text, text, text, text),
  crm_update_observation(uuid, text, uuid, boolean, text, text, text, text), crm_remove_observation(uuid), crm_set_opportunity_edition(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function
  crm_set_outreach_priority(uuid, integer), crm_save_event(uuid, text, text, text, text), crm_save_edition(uuid, uuid, date, date, text, text, text, text),
  crm_remove_edition(uuid), crm_remove_event(uuid), crm_record_observation(uuid, uuid, text, uuid, boolean, text, text, text, text),
  crm_update_observation(uuid, text, uuid, boolean, text, text, text, text), crm_remove_observation(uuid), crm_set_opportunity_edition(uuid, uuid, integer)
  to authenticated;
