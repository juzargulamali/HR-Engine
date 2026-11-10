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
--   edit or archive one    the person who added it, or a founder in any company.
--   link an enquiry to an edition      the enquiry owner or a founder of its company (the rule crm_update_opportunity already applies), not on a lost enquiry.
--   archive event / edition ARCHIVE is the only removal: nothing is deleted from the ordinary Sales workflow (no delete grant, no delete function). Archiving always
--                          gives the same result whatever is attached; every edition, observation and enquiry link stays; archived entries stay in history and are
--                          not offered for NEW enquiry links.
--   import events          any Sales grant (the same right as adding an event and an edition): bulk-adds events and editions to the ONE shared calendar; never overwrites
--                          dates, never reopens an archived record, never merges distinct events; rows that need correcting block the whole batch.
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

-- ARCHIVE is the only way an event or an edition leaves the live calendar: nothing is ever deleted from the ordinary Sales workflow (the tables grant select only and
-- there is no delete function). An archived edition keeps every observation and every enquiry link; an archived event keeps ALL its editions (each exactly as it was).
-- The result never depends on what is attached, so a person who cannot see an enquiry linked to an edition gets the same answer as for an empty edition.
-- Archived entries stay readable (history, counts, drill-downs) and are refused as a NEW enquiry link by crm_set_opportunity_edition.
create or replace function crm_archive_edition(p_id uuid)
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
    raise exception 'Only the person who added this edition, or a founder, can archive it' using errcode = '42501';
  end if;
  update crm_event_editions set archived_at = coalesce(archived_at, now()) where id = p_id;
  return 'archived';
end;
$$;

create or replace function crm_archive_event(p_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare v crm_events;
begin
  perform crm_require_user();
  select * into v from crm_events where id = p_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not crm_can_edit_event_record(v.created_by) then
    raise exception 'Only the person who added this event, or a founder, can archive it' using errcode = '42501';
  end if;
  -- Only the event is marked. Its editions, observations and enquiry links are not touched; they are no longer offered because their event is archived.
  update crm_events set archived_at = coalesce(archived_at, now()) where id = p_id;
  return 'archived';
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

-- -----------------------------------------------------------------------------
-- 5. Bulk import of the shared event calendar (events and editions only). ONE function classifies every row and, only when p_apply is true AND nothing needs correcting,
--    writes them all in one transaction. The preview calls it with p_apply = false (writes nothing), so what the person sees is what the rules decide.
--    Rules (the same as adding by hand, plus the review flags):
--      event name  = same name_key as a LIVE event -> that event. Never merged otherwise. A name that only matches an ARCHIVED event is flagged (archived is never reopened).
--                    A short name contained in the names of two or more live events is ambiguous. Exactly one near match is noted, not blocked.
--      edition     = (event, start date). Same start and end = already present (skipped). Same start, different end, or overlapping dates = conflict (never overwritten).
--                    An archived edition with that start date is flagged, never reopened. Repeated rows in the file collapse the same way.
--    Re-running the same file finds everything present and adds nothing. Any Sales grant may import (the same right as adding an event and an edition).
-- -----------------------------------------------------------------------------
create or replace function crm_event_import_date(p text)
returns date
language plpgsql immutable
set search_path = public
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then
  return null;
end;
$$;

create or replace function crm_import_events(p_rows jsonb, p_apply boolean default false, p_expect integer default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := crm_require_user();
  v_n integer;
  i integer;
  j jsonb;
  v_row integer; v_name text; v_key text; v_country text; v_city text; v_venue text;
  v_start date; v_end date; v_reason text; v_note text; v_status text;
  v_event_id uuid; v_event_name text; v_event_new boolean;
  ex record; cand record;
  v_near_count integer; v_near_names text;
  v_created jsonb := '{}'::jsonb;
  v_new_events integer; v_new_editions integer; v_blocking integer;
  v_made_events integer := 0; v_made_editions integer := 0;
  v_summary jsonb; v_rows jsonb;
begin
  if not crm_has_any_access() then raise exception 'You do not have Sales access' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Send the rows as a list' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then raise exception 'The file has no rows to import' using errcode = '22023'; end if;
  if v_n > 2000 then raise exception 'An import can have at most 2000 rows' using errcode = '22023'; end if;
  -- One import at a time: two people importing the same calendar cannot both add the same edition.
  perform pg_advisory_xact_lock(hashtext('crm_import_events'));

  create temporary table if not exists crm_imp_rows (
    idx integer, row_no integer, name text, key text, country text, city text, venue text, s date, e date,
    status text, reason text, note text, event_id uuid, event_name text, event_new boolean
  ) on commit drop;
  truncate crm_imp_rows;

  for i in 0 .. v_n - 1 loop
    j := p_rows -> i;
    v_row := coalesce(nullif(j ->> 'row', '')::integer, i + 1);
    v_name := btrim(coalesce(j ->> 'name', ''));
    v_key := lower(regexp_replace(v_name, '[^A-Za-z0-9]+', '', 'g'));
    v_country := nullif(upper(btrim(coalesce(j ->> 'country', ''))), '');
    v_city := nullif(btrim(coalesce(j ->> 'city', '')), '');
    v_venue := nullif(btrim(coalesce(j ->> 'venue', '')), '');
    v_start := crm_event_import_date(btrim(coalesce(j ->> 'start', '')));
    v_end := crm_event_import_date(btrim(coalesce(j ->> 'end', '')));
    v_reason := null; v_note := null; v_status := null; v_event_id := null; v_event_name := v_name; v_event_new := false;

    -- 1. shape
    if v_name = '' then v_reason := 'Event name is required';
    elsif length(v_name) > 200 then v_reason := 'Event name is longer than 200 characters';
    elsif v_key = '' then v_reason := 'Event name needs letters or digits';
    elsif v_country is null then v_reason := 'Country is required';
    elsif v_country !~ '^[A-Z]{2}$' then v_reason := 'Country is not a valid two-letter code';
    elsif v_start is null then v_reason := 'Start date is required as a real date (YYYY-MM-DD)';
    elsif v_end is null then v_reason := 'End date is required as a real date (YYYY-MM-DD)';
    elsif extract(year from v_start) not between 2000 and 2100 or extract(year from v_end) not between 2000 and 2100 then v_reason := 'Dates must be between the years 2000 and 2100';
    elsif v_end < v_start then v_reason := 'End date is before the start date';
    elsif v_city is not null and length(v_city) > 100 then v_reason := 'City is longer than 100 characters';
    elsif v_venue is not null and length(v_venue) > 200 then v_reason := 'Venue is longer than 200 characters';
    end if;
    if v_reason is not null then
      insert into crm_imp_rows values (i, v_row, v_name, v_key, v_country, v_city, v_venue, v_start, v_end, 'invalid', v_reason, null, null, v_name, false);
      continue;
    end if;

    -- 2. which event
    select e.id, e.name into v_event_id, v_event_name from crm_events e where e.archived_at is null and e.name_key = v_key;
    if v_event_id is null then
      select r.event_name into v_event_name from crm_imp_rows r where r.key = v_key and r.status in ('new_event', 'new_edition', 'present') and r.event_id is null order by r.idx limit 1;
      if found then
        v_event_new := true;                       -- the event is created by an earlier row of this same file
      else
        v_event_name := v_name;
        if exists (select 1 from crm_events e where e.archived_at is not null and e.name_key = v_key) then
          insert into crm_imp_rows values (i, v_row, v_name, v_key, v_country, v_city, v_venue, v_start, v_end, 'review',
            'An archived event with this name exists. Import never reopens an archived event: add the event by hand, or correct the name.', null, null, v_name, false);
          continue;
        end if;
        select count(*), string_agg(e.name, '; ' order by e.name) into v_near_count, v_near_names
          from crm_events e where e.archived_at is null and length(v_key) >= 4 and e.name_key like '%' || v_key || '%' and e.name_key <> v_key;
        if v_near_count >= 2 then
          insert into crm_imp_rows values (i, v_row, v_name, v_key, v_country, v_city, v_venue, v_start, v_end, 'ambiguous',
            'This name could be any of: ' || v_near_names || '. Use the full event name so it is not matched to the wrong event.', null, null, v_name, false);
          continue;
        end if;
        select count(*), string_agg(e.name, '; ' order by e.name) into v_near_count, v_near_names
          from crm_events e where e.archived_at is null and e.name_key <> v_key
           and ((length(v_key) >= 4 and e.name_key like '%' || v_key || '%') or (length(e.name_key) >= 4 and v_key like '%' || e.name_key || '%'));
        if v_near_count = 1 then v_note := 'Kept as a separate new event. Similar existing event: ' || v_near_names; end if;
      end if;
    end if;

    -- 3. which edition (same event: recorded editions first, then earlier rows of this file)
    if v_event_id is not null then
      for cand in select d.start_date, d.end_date, d.city, d.venue from crm_event_editions d
                   where d.event_id = v_event_id and d.archived_at is null order by d.start_date loop
        if cand.start_date = v_start and cand.end_date = v_end then
          v_status := 'present';
          v_reason := 'Already recorded: ' || to_char(v_start, 'YYYY-MM-DD') || ' to ' || to_char(v_end, 'YYYY-MM-DD');
          if (v_city is not null and cand.city is not null and lower(v_city) <> lower(cand.city))
             or (v_venue is not null and cand.venue is not null and lower(v_venue) <> lower(cand.venue)) then
            v_note := 'The city or venue in the file differs from the recorded edition; the recorded details are kept.';
          end if;
          exit;
        elsif cand.start_date = v_start then
          v_status := 'conflict';
          v_reason := 'This event already has an edition starting ' || to_char(v_start, 'YYYY-MM-DD') || ' that ends ' || to_char(cand.end_date, 'YYYY-MM-DD')
                      || ', the file says ' || to_char(v_end, 'YYYY-MM-DD') || '. Dates are never overwritten: correct the edition by hand if the file is right.';
          exit;
        elsif cand.start_date <= v_end and v_start <= cand.end_date then
          v_status := 'conflict';
          v_reason := 'Overlaps the recorded edition ' || to_char(cand.start_date, 'YYYY-MM-DD') || ' to ' || to_char(cand.end_date, 'YYYY-MM-DD') || '. Nothing was changed.';
          exit;
        end if;
      end loop;
      if v_status is null and exists (select 1 from crm_event_editions d where d.event_id = v_event_id and d.archived_at is not null and d.start_date = v_start) then
        v_status := 'review';
        v_reason := 'An archived edition of this event starts on this date. Import never reopens an archived edition: add it by hand, or correct the date.';
      end if;
    end if;
    if v_status is null then
      for cand in select r.row_no, r.s as start_date, r.e as end_date from crm_imp_rows r
                   where r.key = v_key and r.status in ('new_event', 'new_edition') order by r.idx loop
        if cand.start_date = v_start and cand.end_date = v_end then
          v_status := 'present'; v_reason := 'Repeated: the same edition is on row ' || cand.row_no || ' of this file'; exit;
        elsif cand.start_date = v_start or (cand.start_date <= v_end and v_start <= cand.end_date) then
          v_status := 'conflict';
          v_reason := 'Conflicts with row ' || cand.row_no || ' of this file (' || to_char(cand.start_date, 'YYYY-MM-DD') || ' to ' || to_char(cand.end_date, 'YYYY-MM-DD') || ') for the same event';
          exit;
        end if;
      end loop;
    end if;
    if v_status is null then
      v_status := case when v_event_id is null and not v_event_new then 'new_event' else 'new_edition' end;
    end if;
    insert into crm_imp_rows values (i, v_row, v_name, v_key, v_country, v_city, v_venue, v_start, v_end, v_status, v_reason, v_note, v_event_id, v_event_name, v_event_new);
  end loop;

  select count(*) filter (where status = 'new_event'), count(*) filter (where status in ('new_event', 'new_edition')),
         count(*) filter (where status in ('invalid', 'conflict', 'ambiguous', 'review'))
    into v_new_events, v_new_editions, v_blocking from crm_imp_rows;

  if p_apply and v_blocking = 0 and (p_expect is null or p_expect = v_new_editions) then
    for ex in select * from crm_imp_rows where status in ('new_event', 'new_edition') order by idx loop
      v_event_id := ex.event_id;
      if v_event_id is null then
        v_event_id := nullif(v_created ->> ex.key, '')::uuid;
        if v_event_id is null then
          insert into crm_events (name, kind, created_by) values (ex.name, 'exhibition', v_user) returning id into v_event_id;
          v_created := v_created || jsonb_build_object(ex.key, v_event_id);
          v_made_events := v_made_events + 1;
        end if;
      end if;
      insert into crm_event_editions (event_id, start_date, end_date, city, country_code, venue, created_by)
      values (v_event_id, ex.s, ex.e, ex.city, ex.country, ex.venue, v_user);
      v_made_editions := v_made_editions + 1;
    end loop;
  end if;

  select jsonb_agg(jsonb_build_object('row', row_no, 'status', status, 'reason', reason, 'note', note, 'event', event_name, 'eventId', event_id, 'eventIsNew', event_new,
           'start', s, 'end', e, 'country', country, 'city', city, 'venue', venue) order by idx) into v_rows from crm_imp_rows;
  v_summary := jsonb_build_object(
    'rows', v_n, 'newEvents', v_new_events, 'newEditions', v_new_editions, 'blocking', v_blocking,
    'present', (select count(*) from crm_imp_rows where status = 'present'), 'conflict', (select count(*) from crm_imp_rows where status = 'conflict'),
    'ambiguous', (select count(*) from crm_imp_rows where status = 'ambiguous'), 'review', (select count(*) from crm_imp_rows where status = 'review'),
    'invalid', (select count(*) from crm_imp_rows where status = 'invalid'));
  return jsonb_build_object(
    'applied', p_apply and v_blocking = 0 and (p_expect is null or p_expect = v_new_editions),
    'blocked', v_blocking > 0,
    'stale', p_apply and v_blocking = 0 and p_expect is not null and p_expect <> v_new_editions,
    'createdEvents', v_made_events, 'createdEditions', v_made_editions, 'summary', v_summary, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;


revoke all on function
  crm_set_outreach_priority(uuid, integer), crm_can_edit_event_record(uuid), crm_save_event(uuid, text, text, text, text),
  crm_save_edition(uuid, uuid, date, date, text, text, text, text), crm_archive_edition(uuid), crm_archive_event(uuid),
  crm_event_import_date(text), crm_import_events(jsonb, boolean, integer),
  crm_observation_check(text, uuid, uuid, boolean, text, text, text), crm_record_observation(uuid, uuid, text, uuid, boolean, text, text, text, text),
  crm_update_observation(uuid, text, uuid, boolean, text, text, text, text), crm_remove_observation(uuid), crm_set_opportunity_edition(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function
  crm_set_outreach_priority(uuid, integer), crm_save_event(uuid, text, text, text, text), crm_save_edition(uuid, uuid, date, date, text, text, text, text),
  crm_archive_edition(uuid), crm_archive_event(uuid), crm_import_events(jsonb, boolean, integer), crm_record_observation(uuid, uuid, text, uuid, boolean, text, text, text, text),
  crm_update_observation(uuid, text, uuid, boolean, text, text, text, text), crm_remove_observation(uuid), crm_set_opportunity_edition(uuid, uuid, integer)
  to authenticated;
