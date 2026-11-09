-- -----------------------------------------------------------------------------
-- JARVIS platform, parts 1 and 2 (shared assistant platform; "create an enquiry from a brief"; then the other Sales actions).
-- Part 2 EXTENDS THIS FILE IN PLACE: it was never applied on any hosted database, so no second migration is needed. It adds only new objects (the ledger's
-- result_extra column, internal helper functions and one wrapper per write action); nothing existing is replaced.
--
-- ADDITIVE and IDEMPOTENT. It creates only new objects (tables jarvis_*, functions jarvis_*). It does NOT replace or alter any existing function, table,
-- policy or trigger: the enquiry is created by the EXISTING crm_create_opportunity (20261115000200), called by the new wrapper with the caller's own identity.
-- Default state after applying: JARVIS is OFF for everyone (enabled = false, writes_enabled = false, no pilot users). Nothing changes for anyone until the
-- owner switches the pilot on with the SQL in docs/jarvis-deployment.md.
--
--   1. jarvis_settings        one row: the global switch (enabled) and the write kill switch (writes_enabled). Default false / false.
--   2. jarvis_pilot_users     the allowlist of people who may use JARVIS at all. Empty = nobody.
--   3. jarvis_pilot_companies optional company allowlist. EMPTY = no company restriction (the user allowlist is the gate); rows = only those companies.
--   4. jarvis_action_ledger   one row per confirmed action, keyed by the confirmation id (UNIQUE): who approved, company, action, target, outcome, timestamps.
--                             NO brief, prompt, email text or model output is ever stored here. Written only by the definer functions below.
--   5. jarvis_usage           per person per Dubai day: how many provider requests were used (daily limit survives restarts and several app instances).
--   6. jarvis_my_access(company)   booleans only: may THIS user use JARVIS (and its writes, and for this company).
--   7. jarvis_usage_take(limit)    atomically counts one request and says whether it is within the limit.
--   8. jarvis_create_enquiry(confirmation id, values hash, args)  ONE transaction: ledger row + crm_create_opportunity. A repeat returns the ORIGINAL result.
--   9. (part 2) jarvis_register_organisation, jarvis_update_enquiry, jarvis_change_stage, jarvis_record_meeting: the same pattern for the other write actions, each calling
--      the EXISTING function(s) under the caller's own identity. They share the internal helpers jarvis_ledger_enter / _done / _fail / _json (not callable by users).
--
-- RLS: every table has RLS on. The signed-in user may read only their OWN ledger rows; nobody can write any table directly (there is no write policy);
-- the settings, allowlist and usage tables have no read policy at all (the user learns their own access only through jarvis_my_access()).
-- ROLLBACK: supabase/manual-sql/jarvis_90_rollback.sql (CHANGES the database; export jarvis_action_ledger first: it is the audit record).
-- -----------------------------------------------------------------------------

create table if not exists jarvis_settings (
  id             boolean primary key default true check (id),
  enabled        boolean not null default false,
  writes_enabled boolean not null default false,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id)
);
insert into jarvis_settings (id, enabled, writes_enabled) values (true, false, false) on conflict (id) do nothing;

create table if not exists jarvis_pilot_users (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id),
  note     text
);

create table if not exists jarvis_pilot_companies (
  company_id uuid primary key references companies(id) on delete cascade,
  added_at   timestamptz not null default now(),
  added_by   uuid references auth.users(id)
);

create table if not exists jarvis_action_ledger (
  id              uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null,
  user_id         uuid not null references auth.users(id),
  company_id      uuid not null references companies(id),
  action_id       text not null check (length(action_id) between 1 and 120),
  target          text not null check (length(target) between 1 and 80),
  values_hash     text not null check (values_hash ~ '^[0-9a-f]{64}$'),
  status          text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  result_id       uuid,
  result_ref      text,
  error_code      text,
  error_message   text check (error_message is null or length(error_message) <= 300),
  -- Ids only (e.g. the company of a created organisation, the follow-up created with an activity). Never text the person typed.
  result_extra    jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
alter table jarvis_action_ledger add column if not exists result_extra jsonb;
create unique index if not exists uq_jarvis_ledger_confirmation on jarvis_action_ledger(confirmation_id);
create index if not exists idx_jarvis_ledger_user on jarvis_action_ledger(user_id, created_at desc);

create table if not exists jarvis_usage (
  user_id   uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  requests  integer not null default 0 check (requests >= 0),
  primary key (user_id, usage_day)
);

alter table jarvis_settings enable row level security;
alter table jarvis_pilot_users enable row level security;
alter table jarvis_pilot_companies enable row level security;
alter table jarvis_action_ledger enable row level security;
alter table jarvis_usage enable row level security;

-- The only read policy: a person reads their own ledger rows (the app's "check the original result" call). No write policy exists on any table.
drop policy if exists jarvis_ledger_select_own on jarvis_action_ledger;
create policy jarvis_ledger_select_own on jarvis_action_ledger for select to authenticated using (user_id = auth.uid());

-- Table privileges: where the platform default grants everything to the API roles, take it back (RLS above is a second wall, not the only one).
revoke all on table jarvis_settings, jarvis_pilot_users, jarvis_pilot_companies, jarvis_action_ledger, jarvis_usage from public, anon, authenticated;
grant select on table jarvis_action_ledger to authenticated;

-- -----------------------------------------------------------------------------
-- Access for the signed-in user: booleans only (never the allowlist, never other people).
--   is_available     = the global switch is on AND the person is on the pilot allowlist AND their profile is active
--   writes_allowed   = is_available AND the write switch is on
--   company_allowed  = no company given, or no company restriction is set, or the company is on the pilot company list
-- -----------------------------------------------------------------------------
create or replace function jarvis_my_access(p_company_id uuid default null)
returns table (is_available boolean, writes_allowed boolean, company_allowed boolean)
language sql stable security definer
set search_path = public
as $$
  select
    coalesce(s.enabled, false) and me.in_pilot,
    coalesce(s.enabled, false) and coalesce(s.writes_enabled, false) and me.in_pilot,
    (p_company_id is null
      or not exists (select 1 from jarvis_pilot_companies)
      or exists (select 1 from jarvis_pilot_companies c where c.company_id = p_company_id))
  from (select exists (
          select 1 from jarvis_pilot_users u join profiles p on p.id = u.user_id and p.is_active
          where u.user_id = auth.uid()) as in_pilot) me
  left join jarvis_settings s on s.id;
$$;

-- -----------------------------------------------------------------------------
-- Daily provider-request counter. Atomic: two requests at once cannot both take the last slot. The limit comes from the server's own configuration; a
-- caller passing a different number can only use up their own counter, never reset or raise anything.
-- -----------------------------------------------------------------------------
create or replace function jarvis_usage_take(p_limit integer)
returns table (allowed boolean, used integer, remaining integer)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Dubai')::date;
  v_used integer;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_limit is null or p_limit < 1 then raise exception 'The daily limit must be at least 1' using errcode = '22023'; end if;
  if not coalesce((select a.is_available from jarvis_my_access() a), false) then
    raise exception 'JARVIS is not available to you' using errcode = '42501';
  end if;
  insert into jarvis_usage as u (user_id, usage_day, requests) values (v_user, v_day, 1)
  on conflict (user_id, usage_day) do update set requests = u.requests + 1 where u.requests < p_limit
  returning u.requests into v_used;
  if v_used is null then
    select requests into v_used from jarvis_usage where user_id = v_user and usage_day = v_day;
    return query select false, coalesce(v_used, p_limit), 0;
  else
    return query select true, v_used, greatest(p_limit - v_used, 0);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Create an enquiry through JARVIS, exactly once per confirmation id.
--
--   * Identity is auth.uid() (the caller's own session): crm_create_opportunity reads the same identity and applies ITS OWN rules (Sales grant for the company,
--     company settings, organisation roles, owner rules...). This wrapper adds no privilege: a person the existing function refuses is refused here.
--   * ONE transaction: the ledger row (UNIQUE confirmation id) and the enquiry commit together or not at all. Concurrent calls with the same confirmation id are
--     serialised by a transaction-scoped advisory lock on it; the second one finds the first one's committed row and returns the ORIGINAL result, creating nothing.
--   * A refusal by the existing rules is recorded as status 'failed' (the enquiry part rolls back in a sub-transaction, the ledger row stays) and a repeat with the
--     same confirmation id returns that same failure: a failed confirmation is final, the person reviews again to get a new one.
--   * A different person, a different company or different reviewed values on a used confirmation id are refused (no second enquiry, nothing revealed).
--   * Nothing but ids, the reference and the outcome is stored. p_args (the enquiry's own fields) goes only to crm_create_opportunity.
-- Returns jsonb: {status: done|failed, confirmation_id, opportunity_id, reference, replayed, error_code, error_message, completed_at}
-- -----------------------------------------------------------------------------
create or replace function jarvis_create_enquiry(p_confirmation_id uuid, p_values_hash text, p_args jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_led jarvis_action_ledger;
  v_id uuid;
  v_ref text;
  v_msg text;
  v_state text;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_confirmation_id is null or p_values_hash is null or p_values_hash !~ '^[0-9a-f]{64}$' or p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'The confirmation is incomplete' using errcode = '22023';
  end if;
  v_company := nullif(p_args->>'company_id', '')::uuid;
  if v_company is null then raise exception 'The confirmation names no company' using errcode = '22023'; end if;

  -- Switches and allowlists: the global switch, the pilot allowlist, the write kill switch, the company list.
  if not coalesce((select a.writes_allowed from jarvis_my_access(v_company) a), false)
     or not coalesce((select a.company_allowed from jarvis_my_access(v_company) a), false) then
    raise exception 'JARVIS writes are not available to you for this company' using errcode = '42501';
  end if;
  -- The existing permission rule, checked up front so a refused person leaves no ledger row (crm_create_opportunity repeats it).
  if not crm_has_access(v_company) then
    raise exception 'You do not have Sales access for this company' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('jarvis:' || p_confirmation_id::text, 0));
  select * into v_led from jarvis_action_ledger where confirmation_id = p_confirmation_id;
  if found then
    if v_led.user_id <> v_user or v_led.company_id <> v_company or v_led.action_id <> 'jarvis.sales.enquiry.create_from_brief' or v_led.values_hash <> p_values_hash then
      raise exception 'This confirmation cannot be used for these details' using errcode = '42501';
    end if;
    return jsonb_build_object('status', v_led.status, 'confirmation_id', v_led.confirmation_id, 'opportunity_id', v_led.result_id, 'reference', v_led.result_ref,
      'replayed', true, 'error_code', v_led.error_code, 'error_message', v_led.error_message, 'completed_at', v_led.completed_at);
  end if;

  insert into jarvis_action_ledger (confirmation_id, user_id, company_id, action_id, target, values_hash, status)
  values (p_confirmation_id, v_user, v_company, 'jarvis.sales.enquiry.create_from_brief', 'new', p_values_hash, 'pending')
  returning * into v_led;

  begin
    v_id := crm_create_opportunity(
      p_company_id => v_company,
      p_title => p_args->>'title',
      p_source => p_args->>'source',
      p_next_title => p_args->>'next_title',
      p_next_due => nullif(p_args->>'next_due', '')::timestamptz,
      p_agency_org_id => nullif(p_args->>'agency_org_id', '')::uuid,
      p_client_org_id => nullif(p_args->>'client_org_id', '')::uuid,
      p_owner_id => null,
      p_currency => nullif(p_args->>'currency', ''),
      p_value => nullif(p_args->>'value', '')::numeric,
      p_budget_note => nullif(p_args->>'budget_note', ''),
      p_brief => nullif(p_args->>'brief', ''),
      p_event_start => nullif(p_args->>'event_start', '')::date,
      p_event_end => nullif(p_args->>'event_end', '')::date,
      p_install_start => nullif(p_args->>'install_start', '')::date,
      p_location => nullif(p_args->>'location', ''),
      p_technologies => coalesce(p_args->'technologies', '[]'::jsonb),
      p_scope => nullif(p_args->>'scope', ''),
      p_waiting_on => nullif(p_args->>'waiting_on', ''),
      p_contacts => '[]'::jsonb,
      p_next_kind => coalesce(nullif(p_args->>'next_kind', ''), 'other'));
    select reference into v_ref from crm_opportunities where id = v_id;
    -- The usual timeline: one more event on the new enquiry saying how it was created. The actor recorded is the approving person (auth.uid()).
    insert into crm_opportunity_events (opportunity_id, company_id, kind, from_value, to_value, reason, actor_id)
    values (v_id, v_company, 'created', 'jarvis', 'new', 'Created through JARVIS after the person reviewed and approved it.', v_user);
    update jarvis_action_ledger set status = 'done', result_id = v_id, result_ref = v_ref, completed_at = now() where id = v_led.id returning * into v_led;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    -- The sub-transaction above is rolled back (no enquiry, no reference number consumed); the ledger row stays and says why.
    update jarvis_action_ledger set status = 'failed', error_code = v_state, error_message = left(v_msg, 300), completed_at = now() where id = v_led.id returning * into v_led;
  end;

  return jsonb_build_object('status', v_led.status, 'confirmation_id', v_led.confirmation_id, 'opportunity_id', v_led.result_id, 'reference', v_led.result_ref,
    'replayed', false, 'error_code', v_led.error_code, 'error_message', v_led.error_message, 'completed_at', v_led.completed_at);
end;
$$;

-- =============================================================================
-- PART 2: shared internal helpers for the other write actions (not callable by users: only by the wrappers below, which run as their owner).
--
--   jarvis_ledger_enter(...)  the checks every wrapper makes FIRST, in one place: signed in; the global switch + pilot allowlist + write kill switch + company list
--                             (jarvis_my_access); the existing Sales access rule for the company (crm_has_access); then an advisory lock on the confirmation id and the
--                             ledger. A repeat of a used confirmation id returns the ORIGINAL result (replayed); another person, company, action, target or different
--                             reviewed values are refused. Otherwise it inserts the ledger row as 'pending' and returns NULL = "go ahead and do the work".
--   jarvis_ledger_done / jarvis_ledger_fail   close that row (done with the real id/reference, or failed with the database's own refusal text).
-- The work itself runs in the wrapper's own sub-block, so a refusal by the existing rules rolls the work back and leaves only the 'failed' ledger row.
-- =============================================================================
create or replace function jarvis_ledger_json(p_led jarvis_action_ledger, p_replayed boolean)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('status', p_led.status, 'confirmation_id', p_led.confirmation_id, 'result_id', p_led.result_id, 'reference', p_led.result_ref,
    'extra', p_led.result_extra, 'replayed', p_replayed, 'error_code', p_led.error_code, 'error_message', p_led.error_message, 'completed_at', p_led.completed_at);
$$;

create or replace function jarvis_ledger_enter(p_confirmation_id uuid, p_values_hash text, p_action text, p_company uuid, p_target text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_led jarvis_action_ledger;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_confirmation_id is null or p_values_hash is null or p_values_hash !~ '^[0-9a-f]{64}$' or p_company is null or p_target is null or length(p_target) not between 1 and 80 then
    raise exception 'The confirmation is incomplete' using errcode = '22023';
  end if;
  if not coalesce((select a.writes_allowed from jarvis_my_access(p_company) a), false)
     or not coalesce((select a.company_allowed from jarvis_my_access(p_company) a), false) then
    raise exception 'JARVIS writes are not available to you for this company' using errcode = '42501';
  end if;
  if not crm_has_access(p_company) then
    raise exception 'You do not have Sales access for this company' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jarvis:' || p_confirmation_id::text, 0));
  select * into v_led from jarvis_action_ledger where confirmation_id = p_confirmation_id;
  if found then
    if v_led.user_id <> v_user or v_led.company_id <> p_company or v_led.action_id <> p_action or v_led.target <> p_target or v_led.values_hash <> p_values_hash then
      raise exception 'This confirmation cannot be used for these details' using errcode = '42501';
    end if;
    return jarvis_ledger_json(v_led, true);
  end if;
  insert into jarvis_action_ledger (confirmation_id, user_id, company_id, action_id, target, values_hash, status)
  values (p_confirmation_id, v_user, p_company, p_action, p_target, p_values_hash, 'pending');
  return null;
end;
$$;

create or replace function jarvis_ledger_done(p_confirmation_id uuid, p_result_id uuid, p_result_ref text, p_extra jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_led jarvis_action_ledger;
begin
  update jarvis_action_ledger set status = 'done', result_id = p_result_id, result_ref = left(p_result_ref, 120), result_extra = p_extra, completed_at = now()
   where confirmation_id = p_confirmation_id and user_id = auth.uid() and status = 'pending' returning * into v_led;
  return jarvis_ledger_json(v_led, false);
end;
$$;

create or replace function jarvis_ledger_fail(p_confirmation_id uuid, p_state text, p_message text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_led jarvis_action_ledger;
begin
  update jarvis_action_ledger set status = 'failed', error_code = left(p_state, 5), error_message = left(p_message, 300), completed_at = now()
   where confirmation_id = p_confirmation_id and user_id = auth.uid() and status = 'pending' returning * into v_led;
  return jarvis_ledger_json(v_led, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Register a client or agency through JARVIS, exactly once per confirmation id (jarvis.sales.organisation.register).
--   * The organisation is created by the EXISTING crm_create_organisation_profile (the Clients & Agencies create path), with this company's account profile and NO owner,
--     lead source or exhibition: JARVIS sets none of them. Its own rule applies (a Sales grant); this wrapper adds no privilege.
--   * At least one role is required here (the existing function allows none; JARVIS asks the person to confirm the exact type).
--   * A same-name or same-website organisation that still exists blocks the save unless the person's review named it (p_args.ack_ids): the same rule as the card.
-- p_args: {company_id, name, roles[], country_code, website, place, note, ack_ids[]}. Returns the ledger result: {status, result_id (the organisation), reference (its name), extra{company_id}, replayed, ...}.
-- -----------------------------------------------------------------------------
create or replace function jarvis_register_organisation(p_confirmation_id uuid, p_values_hash text, p_args jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_replay jsonb;
  v_roles text[];
  v_name text;
  v_id uuid;
  v_msg text;
  v_state text;
  v_ack uuid[];
begin
  if p_args is null or jsonb_typeof(p_args) <> 'object' then raise exception 'The confirmation is incomplete' using errcode = '22023'; end if;
  v_company := nullif(p_args->>'company_id', '')::uuid;
  v_name := btrim(coalesce(p_args->>'name', ''));
  if v_company is null then raise exception 'The confirmation names no company' using errcode = '22023'; end if;
  if length(v_name) = 0 or length(v_name) > 200 then raise exception 'Enter the organisation name' using errcode = '22023'; end if;
  if jsonb_typeof(p_args->'roles') is distinct from 'array' or jsonb_array_length(p_args->'roles') = 0 then
    raise exception 'Choose what kind of organisation it is' using errcode = '22023';
  end if;
  select array_agg(x) into v_roles from jsonb_array_elements_text(p_args->'roles') x;
  if not (v_roles <@ array['agency', 'direct', 'client', 'technology']::text[]) then raise exception 'One of the roles is not allowed' using errcode = '22023'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_ack from jsonb_array_elements_text(coalesce(p_args->'ack_ids', '[]'::jsonb)) x;

  v_replay := jarvis_ledger_enter(p_confirmation_id, p_values_hash, 'jarvis.sales.organisation.register', v_company, 'new');
  if v_replay is not null then return v_replay; end if;

  begin
    if exists (select 1 from crm_import_candidates(v_name, nullif(btrim(p_args->>'website'), '')) c where not (c.org_id = any (v_ack))) then
      raise exception 'A similar organisation (same name or website) already exists. Review the details again.' using errcode = 'JV001';
    end if;
    v_id := crm_create_organisation_profile(
      p_name => v_name,
      p_roles => v_roles,
      p_country_code => nullif(p_args->>'country_code', ''),
      p_website => nullif(btrim(p_args->>'website'), ''),
      p_place => nullif(btrim(p_args->>'place'), ''),
      p_note => nullif(btrim(p_args->>'note'), ''),
      p_company_id => v_company);
    return jarvis_ledger_done(p_confirmation_id, v_id, v_name, jsonb_build_object('company_id', v_company));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    return jarvis_ledger_fail(p_confirmation_id, v_state, v_msg);
  end;
end;
$$;

revoke all on function jarvis_my_access(uuid), jarvis_usage_take(integer), jarvis_create_enquiry(uuid, text, jsonb), jarvis_register_organisation(uuid, text, jsonb) from public, anon;
grant execute on function jarvis_my_access(uuid), jarvis_usage_take(integer), jarvis_create_enquiry(uuid, text, jsonb), jarvis_register_organisation(uuid, text, jsonb) to authenticated;
-- The internal helpers are NOT callable by anyone through the API (the wrappers above run as their owner and may call them).
revoke all on function jarvis_ledger_json(jarvis_action_ledger, boolean), jarvis_ledger_enter(uuid, text, text, uuid, text), jarvis_ledger_done(uuid, uuid, text, jsonb), jarvis_ledger_fail(uuid, text, text) from public, anon, authenticated;

-- ROLLBACK: supabase/manual-sql/jarvis_90_rollback.sql drops the three functions and the five tables (export jarvis_action_ledger first).
