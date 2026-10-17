-- Sales & CRM (Stage B), migration 3 of 4: controlled workflow functions.
--
-- Every write to an opportunity goes through one of these SECURITY DEFINER functions. Each one:
--   * requires a signed-in user and a CRM grant for the opportunity's company (crm_has_access); a user without a grant
--     gets "not found", never confirmation that a row exists;
--   * enforces who may act: the owner or a founder for stage, value, hold, won and lost; a founder or a user holding
--     'assign_owner' for ownership; any CRM user of the company for notes, files and their own follow-ups;
--   * locks the row and checks the version the caller last saw (optimistic concurrency, errcode 40001);
--   * writes a timeline event (crm_opportunity_events). Table triggers write the CRM audit log.
-- Errors use: 28000 not signed in, 42501 not allowed, P0002 not found, 22023 invalid input, 23514 rule violated,
-- 40001 changed by someone else.

-- -----------------------------------------------------------------------------
-- Internal helpers (not granted to clients)
-- -----------------------------------------------------------------------------
create or replace function crm_today_dubai()
returns date
language sql stable
as $$ select (now() at time zone 'Asia/Dubai')::date; $$;

create or replace function crm_require_user()
returns uuid
language plpgsql stable
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return auth.uid();
end;
$$;

-- Lock and return an opportunity the caller can see. Not-visible and not-existing are indistinguishable.
create or replace function crm_lock_opportunity(p_id uuid)
returns crm_opportunities
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities;
begin
  perform crm_require_user();
  select * into v from crm_opportunities where id = p_id for update;
  if not found or not crm_has_access(v.company_id) then
    raise exception 'Opportunity not found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

create or replace function crm_check_version(v crm_opportunities, p_expected integer)
returns void
language plpgsql
as $$
begin
  if p_expected is not null and v.version <> p_expected then
    raise exception 'This opportunity was changed by someone else. Reload and try again.' using errcode = '40001';
  end if;
end;
$$;

create or replace function crm_require_owner_or_founder(v crm_opportunities)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if v.owner_id <> auth.uid() and not crm_is_founder(v.company_id) then
    raise exception 'Only the owner of this opportunity or a founder can do this' using errcode = '42501';
  end if;
end;
$$;

create or replace function crm_log_event(
  p_opportunity_id uuid, p_company_id uuid, p_kind text,
  p_from text default null, p_to text default null, p_reason text default null
) returns void
language sql
as $$
  insert into crm_opportunity_events (opportunity_id, company_id, kind, from_value, to_value, reason, actor_id)
  values (p_opportunity_id, p_company_id, p_kind, p_from, p_to, p_reason, auth.uid());
$$;

create or replace function crm_user_has_company_access(p_user_id uuid, p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from crm_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = p_user_id and g.company_id = p_company_id and g.revoked_at is null
  );
$$;

create or replace function crm_validate_technologies(p_tech jsonb)
returns void
language plpgsql immutable
as $$
declare e jsonb;
begin
  if p_tech is null or jsonb_typeof(p_tech) <> 'array' then
    raise exception 'technologies must be a list' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_tech) loop
    if jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e->'name') is distinct from 'string' or length(btrim(e->>'name')) = 0
       or jsonb_typeof(e->'qty') is distinct from 'number' or (e->>'qty')::numeric < 1
       or (e->>'qty')::numeric <> trunc((e->>'qty')::numeric) then
      raise exception 'Each technology needs a name and a whole-number quantity of at least 1' using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Organisations and contacts
-- -----------------------------------------------------------------------------
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
  insert into crm_organisations (name, kind, place, note, created_by)
  values (btrim(p_name), p_kind, nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function crm_create_contact(
  p_organisation_id uuid, p_name text, p_role_title text default null,
  p_email text default null, p_phone text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform crm_require_user();
  if not crm_has_any_access() then raise exception 'No CRM access' using errcode = '42501'; end if;
  insert into crm_contacts (organisation_id, name, role_title, email, phone, created_by)
  values (p_organisation_id, btrim(p_name), nullif(btrim(p_role_title), ''), nullif(btrim(p_email), ''),
          nullif(btrim(p_phone), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Organisations whose name is the same (ignoring case, spaces and punctuation) or contains / is contained by the
-- new name. A hint shown while typing; never blocks.
create or replace function crm_find_similar_organisations(p_name text)
returns table (id uuid, name text, kind text, place text)
language plpgsql stable security definer
set search_path = public
as $$
declare v_key text := lower(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]+', '', 'g'));
begin
  perform crm_require_user();
  if not crm_has_any_access() or length(v_key) < 3 then return; end if;
  return query
    select o.id, o.name, o.kind, o.place from crm_organisations o
    where o.archived_at is null
      and (o.name_key = v_key
           or (length(v_key) >= 5 and position(v_key in o.name_key) > 0)
           or (length(o.name_key) >= 5 and position(o.name_key in v_key) > 0))
    order by (o.name_key = v_key) desc, o.name
    limit 10;
end;
$$;

-- -----------------------------------------------------------------------------
-- Duplicate candidates. Returns recent opportunities (in companies the caller can see) that MIGHT be the same job:
-- sharing the agency or end client, OR overlapping the same dates at the same location. Sharing an organisation
-- alone is routine (one agency, many briefs), so scoring and the decision whether to warn happen in
-- packages/domain/src/crmDuplicates.ts, which weighs title, dates, location and technologies as well.
-- -----------------------------------------------------------------------------
create or replace function crm_find_duplicate_candidates(
  p_agency_org_id uuid default null,
  p_client_org_id uuid default null,
  p_event_start date default null,
  p_install_start date default null,
  p_location text default null
) returns table (
  opportunity_id uuid, company_id uuid, reference text, title text, stage text, owner_id uuid,
  agency_org_id uuid, client_org_id uuid, event_start date, event_end date, install_start date,
  location text, technologies jsonb, created_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform crm_require_user();
  return query
    select o.id, o.company_id, o.reference, o.title, o.stage, o.owner_id, o.agency_org_id, o.client_org_id,
           o.event_start, o.event_end, o.install_start, o.location, o.technologies, o.created_at
    from crm_opportunities o
    left join crm_company_settings s on s.company_id = o.company_id
    where crm_has_access(o.company_id)
      and o.created_at >= now() - make_interval(days => coalesce(s.duplicate_window_days, 180))
      and (
        (p_agency_org_id is not null and (o.agency_org_id = p_agency_org_id or o.client_org_id = p_agency_org_id))
        or (p_client_org_id is not null and (o.client_org_id = p_client_org_id or o.agency_org_id = p_client_org_id))
        or (
          nullif(btrim(p_location), '') is not null and lower(btrim(o.location)) = lower(btrim(p_location))
          and (
            (p_event_start is not null and o.event_start between p_event_start - 14 and p_event_start + 14)
            or (p_install_start is not null and o.install_start between p_install_start - 14 and p_install_start + 14)
          )
        )
      )
    order by o.created_at desc
    limit 50;
end;
$$;

-- -----------------------------------------------------------------------------
-- Create an opportunity (always with an owner and a first next action)
-- -----------------------------------------------------------------------------
create or replace function crm_create_opportunity(
  p_company_id uuid,
  p_title text,
  p_source text,
  p_next_title text,
  p_next_due timestamptz,
  p_agency_org_id uuid default null,
  p_client_org_id uuid default null,
  p_owner_id uuid default null,
  p_currency text default null,
  p_value numeric default null,
  p_budget_note text default null,
  p_brief text default null,
  p_event_start date default null,
  p_event_end date default null,
  p_install_start date default null,
  p_location text default null,
  p_technologies jsonb default '[]'::jsonb,
  p_scope text default null,
  p_waiting_on text default null,
  p_contacts jsonb default '[]'::jsonb,
  p_next_kind text default 'other'
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := crm_require_user();
  v_settings crm_company_settings;
  v_owner uuid := coalesce(p_owner_id, auth.uid());
  v_year integer := extract(year from (now() at time zone 'Asia/Dubai'))::integer;
  v_seq integer;
  v_id uuid;
  v_ref text;
  c jsonb;
begin
  if not crm_has_access(p_company_id) then
    raise exception 'You do not have Sales access for this company' using errcode = '42501';
  end if;
  select * into v_settings from crm_company_settings where company_id = p_company_id;
  if not found then
    raise exception 'CRM settings (reference code and currency) are not configured for this company yet' using errcode = '23514';
  end if;
  if v_owner <> v_user then
    if not crm_has_capability(p_company_id, 'assign_owner') then
      raise exception 'Only a founder (or someone they delegated) can assign another owner' using errcode = '42501';
    end if;
    if not crm_user_has_company_access(v_owner, p_company_id) then
      raise exception 'The chosen owner has no Sales access for this company' using errcode = '22023';
    end if;
  end if;
  if p_agency_org_id is null and p_client_org_id is null then
    raise exception 'Choose an agency or an end client (or both)' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_next_title, ''))) = 0 or p_next_due is null then
    raise exception 'Every opportunity needs a next action with a due date' using errcode = '22023';
  end if;
  perform crm_validate_technologies(coalesce(p_technologies, '[]'::jsonb));

  insert into crm_reference_counters (company_id, year, last_value) values (p_company_id, v_year, 1)
  on conflict (company_id, year) do update set last_value = crm_reference_counters.last_value + 1
  returning last_value into v_seq;
  v_ref := format('OPP-%s-%s-%s', v_settings.reference_code, v_year, lpad(v_seq::text, 4, '0'));

  insert into crm_opportunities (
    company_id, reference, title, brief, agency_org_id, client_org_id, source, owner_id, created_by,
    currency, value, budget_note, event_start, event_end, install_start, location, technologies, scope, waiting_on)
  values (
    p_company_id, v_ref, btrim(p_title), nullif(btrim(p_brief), ''), p_agency_org_id, p_client_org_id, p_source,
    v_owner, v_user, coalesce(upper(p_currency), v_settings.default_quote_currency), p_value,
    nullif(btrim(p_budget_note), ''), p_event_start, p_event_end, p_install_start, nullif(btrim(p_location), ''),
    coalesce(p_technologies, '[]'::jsonb), nullif(btrim(p_scope), ''), p_waiting_on)
  returning id into v_id;

  for c in select * from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb)) loop
    insert into crm_opportunity_contacts (opportunity_id, contact_id, company_id, role)
    values (v_id, (c->>'contact_id')::uuid, p_company_id, nullif(btrim(c->>'role'), ''))
    on conflict do nothing;
  end loop;

  insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, kind, due_at, created_by)
  values (v_id, p_company_id, v_owner, btrim(p_next_title), coalesce(p_next_kind, 'other'), p_next_due, v_user);

  perform crm_log_event(v_id, p_company_id, 'created', null, 'new', null);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Edit details (owner or founder). p_patch holds only the keys being changed.
-- -----------------------------------------------------------------------------
create or replace function crm_update_opportunity(p_id uuid, p_expected_version integer, p_patch jsonb)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v crm_opportunities;
  k text;
  v_allowed text[] := array['title', 'brief', 'agency_org_id', 'client_org_id', 'source', 'currency', 'value',
    'budget_note', 'payment_terms', 'event_start', 'event_end', 'install_start', 'location', 'technologies',
    'scope', 'exclusions', 'risks', 'waiting_on'];
  v_money boolean;
  v_version integer;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  if v.stage = 'lost' then
    raise exception 'A lost opportunity can no longer be edited' using errcode = '23514';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_allowed)) then
      raise exception 'Field % cannot be changed here', k using errcode = '22023';
    end if;
  end loop;
  v_money := p_patch ? 'value' or p_patch ? 'currency';
  if v_money and v.stage = 'won' and not crm_is_founder(v.company_id) then
    raise exception 'The value of a won opportunity can only be changed by a founder' using errcode = '42501';
  end if;
  if p_patch ? 'technologies' then perform crm_validate_technologies(p_patch->'technologies'); end if;
  if p_patch ? 'risks' and jsonb_typeof(p_patch->'risks') <> 'array' then
    raise exception 'risks must be a list' using errcode = '22023';
  end if;

  update crm_opportunities set
    title = case when p_patch ? 'title' then btrim(p_patch->>'title') else title end,
    brief = case when p_patch ? 'brief' then nullif(btrim(p_patch->>'brief'), '') else brief end,
    agency_org_id = case when p_patch ? 'agency_org_id' then (p_patch->>'agency_org_id')::uuid else agency_org_id end,
    client_org_id = case when p_patch ? 'client_org_id' then (p_patch->>'client_org_id')::uuid else client_org_id end,
    source = case when p_patch ? 'source' then p_patch->>'source' else source end,
    currency = case when p_patch ? 'currency' then upper(p_patch->>'currency') else currency end,
    value = case when p_patch ? 'value' then (p_patch->>'value')::numeric else value end,
    budget_note = case when p_patch ? 'budget_note' then nullif(btrim(p_patch->>'budget_note'), '') else budget_note end,
    payment_terms = case when p_patch ? 'payment_terms' then nullif(btrim(p_patch->>'payment_terms'), '') else payment_terms end,
    event_start = case when p_patch ? 'event_start' then (p_patch->>'event_start')::date else event_start end,
    event_end = case when p_patch ? 'event_end' then (p_patch->>'event_end')::date else event_end end,
    install_start = case when p_patch ? 'install_start' then (p_patch->>'install_start')::date else install_start end,
    location = case when p_patch ? 'location' then nullif(btrim(p_patch->>'location'), '') else location end,
    technologies = case when p_patch ? 'technologies' then p_patch->'technologies' else technologies end,
    scope = case when p_patch ? 'scope' then nullif(btrim(p_patch->>'scope'), '') else scope end,
    exclusions = case when p_patch ? 'exclusions' then nullif(btrim(p_patch->>'exclusions'), '') else exclusions end,
    risks = case when p_patch ? 'risks' then p_patch->'risks' else risks end,
    waiting_on = case when p_patch ? 'waiting_on' then nullif(p_patch->>'waiting_on', '') else waiting_on end,
    version = version + 1
  where id = p_id
  returning version into v_version;

  if v_money then
    perform crm_log_event(p_id, v.company_id, 'value_changed',
      coalesce(v.currency || ' ' || v.value::text, 'not set'),
      (select coalesce(currency || ' ' || value::text, 'not set') from crm_opportunities where id = p_id));
  end if;
  if p_patch - 'value' - 'currency' <> '{}'::jsonb then
    perform crm_log_event(p_id, v.company_id, 'details_changed', null,
      (select string_agg(x, ', ' order by x) from jsonb_object_keys(p_patch - 'value' - 'currency') x));
  end if;
  return v_version;
end;
$$;

-- -----------------------------------------------------------------------------
-- Stage moves. Won, Lost and On hold are never plain moves.
-- -----------------------------------------------------------------------------
create or replace function crm_stage_index(p_stage text)
returns integer
language sql immutable
as $$
  select array_position(array['new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation'], p_stage);
$$;

create or replace function crm_move_stage(p_id uuid, p_to text, p_expected_version integer default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v crm_opportunities;
  v_from_i integer;
  v_to_i integer;
  v_version integer;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  v_from_i := crm_stage_index(v.stage);
  v_to_i := crm_stage_index(p_to);
  if v.stage in ('won', 'lost') then
    raise exception 'A closed opportunity cannot change stage' using errcode = '23514';
  elsif v.stage = 'on_hold' then
    raise exception 'Resume the opportunity before moving it' using errcode = '23514';
  elsif v_to_i is null then
    raise exception 'Use the Hold, Won or Lost action for that change' using errcode = '23514';
  elsif v_to_i = v_from_i or v_to_i < v_from_i - 1 then
    raise exception 'That stage move is not allowed (only one step back or any step forward)' using errcode = '23514';
  end if;
  -- Sent is not approved, and "sent" must be a recorded fact, not a label.
  if p_to = 'proposal_sent' and not exists (
       select 1 from crm_proposals where opportunity_id = p_id and status in ('sent', 'accepted')) then
    raise exception 'Record a proposal as sent before moving to Proposal sent' using errcode = '23514';
  end if;
  if p_to = 'quote_sent' and not exists (
       select 1 from crm_zoho_references where opportunity_id = p_id and length(btrim(coalesce(quote_ref, ''))) > 0) then
    raise exception 'Record the Zoho Books quote reference before moving to Quote sent' using errcode = '23514';
  end if;
  update crm_opportunities set stage = p_to, stage_changed_at = now(), version = version + 1
   where id = p_id returning version into v_version;
  perform crm_log_event(p_id, v.company_id, 'stage_changed', v.stage, p_to);
  return v_version;
end;
$$;

create or replace function crm_hold_opportunity(
  p_id uuid, p_reason text, p_review_date date, p_expected_version integer default null
) returns integer
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_version integer;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  if crm_stage_index(v.stage) is null then
    raise exception 'Only an open opportunity can be put on hold' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to put an opportunity on hold' using errcode = '22023';
  end if;
  if p_review_date is null or p_review_date < crm_today_dubai() then
    raise exception 'Choose a review date that is today or later' using errcode = '22023';
  end if;
  update crm_opportunities set stage = 'on_hold', stage_before_hold = v.stage, hold_reason = btrim(p_reason),
         hold_review_date = p_review_date, stage_changed_at = now(), version = version + 1
   where id = p_id returning version into v_version;
  perform crm_log_event(p_id, v.company_id, 'held', v.stage, 'on_hold', btrim(p_reason));
  return v_version;
end;
$$;

create or replace function crm_resume_opportunity(
  p_id uuid, p_next_title text, p_next_due timestamptz, p_next_kind text default 'other',
  p_expected_version integer default null
) returns integer
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_version integer;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  if v.stage <> 'on_hold' then
    raise exception 'This opportunity is not on hold' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_next_title, ''))) = 0 or p_next_due is null then
    raise exception 'Resuming needs a next action with a due date' using errcode = '22023';
  end if;
  update crm_opportunities set stage = v.stage_before_hold, stage_before_hold = null, hold_reason = null,
         hold_review_date = null, stage_changed_at = now(), version = version + 1
   where id = p_id returning version into v_version;
  insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, kind, due_at, created_by)
  values (p_id, v.company_id, v.owner_id, btrim(p_next_title), coalesce(p_next_kind, 'other'), p_next_due, auth.uid());
  perform crm_log_event(p_id, v.company_id, 'resumed', 'on_hold', v.stage_before_hold);
  return v_version;
end;
$$;

create or replace function crm_mark_won(
  p_id uuid, p_evidence_type text, p_evidence_reference text, p_evidence_date date, p_note text default null,
  p_expected_version integer default null
) returns integer
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_version integer;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  if crm_stage_index(v.stage) is null then
    raise exception 'Only an open opportunity (not on hold) can be marked Won' using errcode = '23514';
  end if;
  if p_evidence_type not in ('purchase_order', 'authorised_email')
     or length(btrim(coalesce(p_evidence_reference, ''))) = 0 or p_evidence_date is null then
    raise exception 'Won needs evidence: a purchase order or authorised email, its reference and its date' using errcode = '22023';
  end if;
  if v.value is null then
    raise exception 'Set the confirmed value before marking Won' using errcode = '23514';
  end if;
  update crm_opportunities set stage = 'won', stage_changed_at = now(), evidence_type = p_evidence_type,
         evidence_reference = btrim(p_evidence_reference), evidence_date = p_evidence_date,
         closed_at = now(), closed_by = auth.uid(), version = version + 1
   where id = p_id returning version into v_version;
  update crm_follow_ups set status = 'cancelled', updated_at = now() where opportunity_id = p_id and status = 'open';
  insert into crm_handovers (opportunity_id, company_id) values (p_id, v.company_id) on conflict do nothing;
  perform crm_log_event(p_id, v.company_id, 'won', v.stage, 'won',
    p_evidence_type || ': ' || btrim(p_evidence_reference) || coalesce(' — ' || nullif(btrim(p_note), ''), ''));
  return v_version;
end;
$$;

create or replace function crm_mark_lost(p_id uuid, p_reason text, p_expected_version integer default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_version integer;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  if v.stage in ('won', 'lost') then
    raise exception 'This opportunity is already closed' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to mark an opportunity Lost' using errcode = '22023';
  end if;
  update crm_opportunities set stage = 'lost', stage_changed_at = now(), lost_reason = btrim(p_reason),
         stage_before_hold = null, hold_reason = null, hold_review_date = null,
         closed_at = now(), closed_by = auth.uid(), version = version + 1
   where id = p_id returning version into v_version;
  update crm_follow_ups set status = 'cancelled', updated_at = now() where opportunity_id = p_id and status = 'open';
  perform crm_log_event(p_id, v.company_id, 'lost', v.stage, 'lost', btrim(p_reason));
  return v_version;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ownership: Juzar / Rafi (founders) and anyone they delegate 'assign_owner' to
-- -----------------------------------------------------------------------------
create or replace function crm_assign_owner(p_id uuid, p_new_owner uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities;
begin
  v := crm_lock_opportunity(p_id);
  if not crm_has_capability(v.company_id, 'assign_owner') then
    raise exception 'Only a founder (or someone they delegated) can assign or reassign owners' using errcode = '42501';
  end if;
  if v.stage in ('won', 'lost') then
    raise exception 'A closed opportunity cannot be reassigned' using errcode = '23514';
  end if;
  if not crm_user_has_company_access(p_new_owner, v.company_id) then
    raise exception 'The chosen owner has no Sales access for this company' using errcode = '22023';
  end if;
  if p_new_owner = v.owner_id then return; end if;
  update crm_opportunities set owner_id = p_new_owner, version = version + 1 where id = p_id;
  -- Open follow-ups that belonged to the previous owner move with the opportunity, so reminders reach the new owner.
  update crm_follow_ups set assigned_to = p_new_owner, updated_at = now()
   where opportunity_id = p_id and status = 'open' and assigned_to = v.owner_id;
  perform crm_log_event(p_id, v.company_id, 'owner_changed', v.owner_id::text, p_new_owner::text, nullif(btrim(p_reason), ''));
end;
$$;

-- -----------------------------------------------------------------------------
-- Activities
-- -----------------------------------------------------------------------------
create or replace function crm_add_activity(
  p_id uuid, p_kind text, p_body text, p_occurred_at timestamptz default now(), p_internal boolean default false
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_id uuid;
begin
  v := crm_lock_opportunity(p_id);
  if v.stage = 'lost' then
    raise exception 'A lost opportunity can no longer be updated' using errcode = '23514';
  end if;
  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'An activity cannot be dated in the future' using errcode = '22023';
  end if;
  insert into crm_activities (opportunity_id, company_id, kind, body, is_internal, occurred_at, created_by)
  values (p_id, v.company_id, p_kind, btrim(p_body), coalesce(p_internal, false), coalesce(p_occurred_at, now()), auth.uid())
  returning id into v_id;
  -- First outbound contact (call, email or meeting) sets the first-response time used by response KPIs.
  if v.first_response_at is null and p_kind in ('call', 'email', 'meeting') then
    update crm_opportunities set first_response_at = coalesce(p_occurred_at, now()) where id = p_id;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Follow-ups
-- -----------------------------------------------------------------------------
create or replace function crm_create_follow_up(
  p_id uuid, p_title text, p_due_at timestamptz, p_kind text default 'other', p_assigned_to uuid default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_assignee uuid; v_new uuid;
begin
  v := crm_lock_opportunity(p_id);
  if v.stage in ('won', 'lost') then
    raise exception 'A closed opportunity has no follow-ups' using errcode = '23514';
  end if;
  v_assignee := coalesce(p_assigned_to, auth.uid());
  if v_assignee <> auth.uid() and v_assignee <> v.owner_id then
    -- Putting a task on another person's list (other than the owner's) is an assignment decision.
    if not crm_has_capability(v.company_id, 'assign_owner') and v.owner_id <> auth.uid() then
      raise exception 'Only the owner or a founder can assign follow-ups to others' using errcode = '42501';
    end if;
  end if;
  if not crm_user_has_company_access(v_assignee, v.company_id) then
    raise exception 'The assignee has no Sales access for this company' using errcode = '22023';
  end if;
  insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, kind, due_at, created_by)
  values (p_id, v.company_id, v_assignee, btrim(p_title), coalesce(p_kind, 'other'), p_due_at, auth.uid())
  returning id into v_new;
  return v_new;
end;
$$;

create or replace function crm_require_follow_up_actor(f crm_follow_ups, o crm_opportunities)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if f.assigned_to <> auth.uid() and o.owner_id <> auth.uid() and not crm_is_founder(o.company_id) then
    raise exception 'Only the assignee, the opportunity owner or a founder can change this follow-up' using errcode = '42501';
  end if;
end;
$$;

-- Complete with an outcome. If that leaves an active opportunity with no open follow-up, the caller must say what
-- happens next: a new follow-up, or putting the opportunity on hold (with reason and review date).
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

-- -----------------------------------------------------------------------------
-- Privileges: internal helpers are not callable by clients; workflow functions are, for signed-in users only.
-- -----------------------------------------------------------------------------
revoke all on function
  crm_today_dubai(), crm_require_user(), crm_lock_opportunity(uuid), crm_check_version(crm_opportunities, integer),
  crm_require_owner_or_founder(crm_opportunities), crm_log_event(uuid, uuid, text, text, text, text),
  crm_user_has_company_access(uuid, uuid), crm_validate_technologies(jsonb), crm_stage_index(text),
  crm_require_follow_up_actor(crm_follow_ups, crm_opportunities)
  from public, anon, authenticated;

revoke all on function
  crm_create_organisation(text, text, text, text), crm_create_contact(uuid, text, text, text, text),
  crm_find_similar_organisations(text), crm_find_duplicate_candidates(uuid, uuid, date, date, text),
  crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text),
  crm_update_opportunity(uuid, integer, jsonb), crm_move_stage(uuid, text, integer),
  crm_hold_opportunity(uuid, text, date, integer), crm_resume_opportunity(uuid, text, timestamptz, text, integer),
  crm_mark_won(uuid, text, text, date, text, integer), crm_mark_lost(uuid, text, integer),
  crm_assign_owner(uuid, uuid, text), crm_add_activity(uuid, text, text, timestamptz, boolean),
  crm_create_follow_up(uuid, text, timestamptz, text, uuid),
  crm_complete_follow_up(uuid, text, text, timestamptz, text, text, date),
  crm_reschedule_follow_up(uuid, timestamptz), crm_cancel_follow_up(uuid, text)
  from public, anon;
grant execute on function
  crm_create_organisation(text, text, text, text), crm_create_contact(uuid, text, text, text, text),
  crm_find_similar_organisations(text), crm_find_duplicate_candidates(uuid, uuid, date, date, text),
  crm_create_opportunity(uuid, text, text, text, timestamptz, uuid, uuid, uuid, text, numeric, text, text, date, date, date, text, jsonb, text, text, jsonb, text),
  crm_update_opportunity(uuid, integer, jsonb), crm_move_stage(uuid, text, integer),
  crm_hold_opportunity(uuid, text, date, integer), crm_resume_opportunity(uuid, text, timestamptz, text, integer),
  crm_mark_won(uuid, text, text, date, text, integer), crm_mark_lost(uuid, text, integer),
  crm_assign_owner(uuid, uuid, text), crm_add_activity(uuid, text, text, timestamptz, boolean),
  crm_create_follow_up(uuid, text, timestamptz, text, uuid),
  crm_complete_follow_up(uuid, text, text, timestamptz, text, text, date),
  crm_reschedule_follow_up(uuid, timestamptz), crm_cancel_follow_up(uuid, text)
  to authenticated;

-- ROLLBACK (before any CRM data exists): drop every function created in this file with `drop function if exists`,
-- using the signatures in the revoke list above.
