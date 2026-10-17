-- Sales & CRM (Stage B), migration 2 of 4: core tables.
--
-- Everything here is READ-ONLY to clients (SELECT policies only, no INSERT/UPDATE/DELETE policies, and no DML
-- grants). Changes go through the SECURITY DEFINER functions in migrations 3 and 4, which enforce ownership,
-- stage rules and capabilities. Company-scoped tables are visible only to users holding an active CRM grant for that
-- company (crm_has_access). Organisations and contacts are shared reference data, visible to any CRM user.
--
-- Stage ids are stable (the labels are display text only): new, qualified, proposal_prep, proposal_sent, quote_sent,
-- negotiation, on_hold, won, lost.
-- Currencies are never summed across companies: every money column carries its own currency code.

-- -----------------------------------------------------------------------------
-- Organisations and contacts (agencies, end clients, direct clients)
-- -----------------------------------------------------------------------------
create table if not exists crm_organisations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 200),
  -- Lower-cased, letters and digits only: "Zeta Media L.L.C." and "ZETA MEDIA LLC" collide here (duplicate warning).
  name_key     text generated always as (lower(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'))) stored,
  kind         text not null check (kind in ('agency', 'client', 'direct')),
  place        text,
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index if not exists idx_crm_organisations_key on crm_organisations(name_key);

create table if not exists crm_contacts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references crm_organisations(id),
  name             text not null check (length(btrim(name)) between 1 and 200),
  role_title       text,
  email            text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_key        text generated always as (lower(email)) stored,
  phone            text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz
);
create index if not exists idx_crm_contacts_org on crm_contacts(organisation_id);
create index if not exists idx_crm_contacts_email on crm_contacts(email_key) where email_key is not null;

-- -----------------------------------------------------------------------------
-- Opportunities
-- -----------------------------------------------------------------------------
create table if not exists crm_reference_counters (
  company_id  uuid not null references companies(id),
  year        integer not null,
  last_value  integer not null default 0,
  primary key (company_id, year)
);

create table if not exists crm_opportunities (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  reference             text not null,
  title                 text not null check (length(btrim(title)) between 1 and 200),
  brief                 text,
  agency_org_id         uuid references crm_organisations(id),
  client_org_id         uuid references crm_organisations(id),
  source                text not null check (source in (
                          'agency_call', 'linkedin', 'direct_client', 'whatsapp', 'instagram', 'website', 'referral', 'other')),
  owner_id              uuid not null references auth.users(id),
  created_by            uuid not null references auth.users(id),
  stage                 text not null default 'new' check (stage in (
                          'new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation',
                          'on_hold', 'won', 'lost')),
  stage_changed_at      timestamptz not null default now(),
  -- Where the opportunity was before it went on hold, so Resume returns to the right place.
  stage_before_hold     text check (stage_before_hold is null or stage_before_hold in (
                          'new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation')),
  -- Where it was when it was closed, so a controlled reopen returns it to the right place.
  stage_before_close    text check (stage_before_close is null or stage_before_close in (
                          'new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation')),
  waiting_on            text check (waiting_on is null or waiting_on in ('client', 'internal')),
  first_response_at     timestamptz,

  -- Money. Quotation currency may differ from the company default. NULL value = "Value not set".
  currency              text not null check (currency ~ '^[A-Z]{3}$'),
  value                 numeric(14, 2) check (value is null or value >= 0),
  budget_note           text,
  payment_terms         text,

  -- Shape of the job
  event_start           date,
  event_end             date,
  install_start         date,
  location              text,
  technologies          jsonb not null default '[]'::jsonb check (jsonb_typeof(technologies) = 'array'),
  scope                 text,
  exclusions            text,
  risks                 jsonb not null default '[]'::jsonb check (jsonb_typeof(risks) = 'array'),

  -- Hold / Lost / Won
  hold_reason           text,
  hold_review_date      date,
  lost_reason           text,
  evidence_type         text check (evidence_type is null or evidence_type in ('purchase_order', 'authorised_email')),
  evidence_reference    text,
  evidence_date         date,
  closed_at             timestamptz,
  closed_by             uuid references auth.users(id),

  -- Equipment availability: a recorded check, NOT a stock reservation and NOT commercial confirmation.
  availability_state    text not null default 'unverified'
                          check (availability_state in ('unverified', 'awaiting', 'confirmed', 'unavailable')),
  availability_by       uuid references auth.users(id),
  availability_at       timestamptz,
  availability_notes    text,
  availability_requested_by uuid references auth.users(id),
  availability_requested_at timestamptz,
  -- What the check covered ({install_start, event_start, event_end, technologies}). If the live values drift away
  -- from this snapshot the check "needs recheck" (derived by crm_availability_needs_recheck()).
  availability_covers   jsonb,

  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint crm_opportunities_ref_unique unique (company_id, reference),
  constraint crm_opportunities_party check (agency_org_id is not null or client_org_id is not null),
  constraint crm_opportunities_dates check (event_end is null or event_start is null or event_end >= event_start),
  constraint crm_opportunities_hold check (
    stage <> 'on_hold' or (length(btrim(coalesce(hold_reason, ''))) > 0 and hold_review_date is not null and stage_before_hold is not null)),
  constraint crm_opportunities_lost check (stage <> 'lost' or length(btrim(coalesce(lost_reason, ''))) > 0),
  constraint crm_opportunities_won check (
    stage <> 'won' or (evidence_type is not null and length(btrim(coalesce(evidence_reference, ''))) > 0 and evidence_date is not null)),
  constraint crm_opportunities_closed check ((stage in ('won', 'lost')) = (closed_at is not null))
);
create index if not exists idx_crm_opp_company_stage on crm_opportunities(company_id, stage);
create index if not exists idx_crm_opp_owner on crm_opportunities(owner_id) where stage not in ('won', 'lost');
create index if not exists idx_crm_opp_agency on crm_opportunities(agency_org_id);
create index if not exists idx_crm_opp_client on crm_opportunities(client_org_id);

create table if not exists crm_opportunity_contacts (
  opportunity_id  uuid not null references crm_opportunities(id) on delete cascade,
  contact_id      uuid not null references crm_contacts(id),
  company_id      uuid not null references companies(id),
  role            text,
  primary key (opportunity_id, contact_id)
);

-- One timeline for everything that changes an opportunity: stage moves, owner changes, holds, close, value changes.
create table if not exists crm_opportunity_events (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references crm_opportunities(id) on delete cascade,
  company_id      uuid not null references companies(id),
  kind            text not null check (kind in (
                    'created', 'stage_changed', 'owner_changed', 'held', 'resumed', 'won', 'lost',
                    'details_changed', 'value_changed', 'availability', 'approval', 'handover', 'proposal', 'file',
                    'contact', 'reopened')),
  from_value      text,
  to_value        text,
  reason          text,
  actor_id        uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_crm_events_opp on crm_opportunity_events(opportunity_id, created_at);

create table if not exists crm_activities (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references crm_opportunities(id) on delete cascade,
  company_id      uuid not null references companies(id),
  kind            text not null check (kind in ('call', 'email', 'meeting', 'note', 'client_response')),
  body            text not null check (length(btrim(body)) > 0),
  -- internal notes are still visible to every CRM user of the company; the flag only labels them in the UI.
  is_internal     boolean not null default false,
  occurred_at     timestamptz not null default now(),
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_crm_activities_opp on crm_activities(opportunity_id, occurred_at desc);

-- A follow-up has a single due moment (stored as timestamptz, interpreted in Dubai time by the application).
-- The earliest OPEN follow-up is the opportunity's "next action".
create table if not exists crm_follow_ups (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references crm_opportunities(id) on delete cascade,
  company_id      uuid not null references companies(id),
  assigned_to     uuid not null references auth.users(id),
  title           text not null check (length(btrim(title)) between 1 and 300),
  kind            text not null default 'other' check (kind in ('call', 'email', 'meeting', 'proposal', 'other')),
  due_at          timestamptz not null,
  status          text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  completed_at    timestamptz,
  completed_by    uuid references auth.users(id),
  outcome         text,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint crm_follow_ups_done check (status <> 'done' or (completed_at is not null and length(btrim(coalesce(outcome, ''))) > 0))
);
create index if not exists idx_crm_follow_ups_open on crm_follow_ups(due_at) where status = 'open';
create index if not exists idx_crm_follow_ups_opp on crm_follow_ups(opportunity_id);
create index if not exists idx_crm_follow_ups_assignee on crm_follow_ups(assigned_to) where status = 'open';

-- -----------------------------------------------------------------------------
-- Files and links (private storage; see migration 4 for the bucket). Rows are registered only by crm_register_file().
-- -----------------------------------------------------------------------------
create or replace function crm_allowed_mime_types()
returns text[]
language sql immutable
as $$
  select array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   -- .docx (no macros)
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         -- .xlsx (no macros)
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', -- .pptx (no macros)
    'text/plain', 'text/csv'
  ]::text[];
$$;

-- No executable, script or macro-capable name in ANY dot-separated segment ("invoice.exe.pdf" is refused too).
-- One definition, used by the table CHECK and by crm_create_upload_intent.
create or replace function crm_file_name_blocked(p_name text)
returns boolean
language sql immutable
as $$
  select p_name ~* '(^|\.)(exe|dll|msi|bat|cmd|com|scr|pif|cpl|msc|lnk|hta|wsf|wsh|vbs|vbe|js|jse|ps1|psm1|sh|bash|jar|apk|app|dmg|iso|reg|docm|dotm|xlsm|xlsb|xltm|xlam|pptm|potm|ppsm|ppam|sldm|html|htm|svg)(\.|$)';
$$;

create table if not exists crm_files (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references crm_opportunities(id) on delete cascade,
  company_id      uuid not null references companies(id),
  kind            text not null check (kind in ('file', 'link')),
  label           text,
  original_name   text,
  storage_path    text unique,
  mime_type       text,
  size_bytes      bigint,
  url             text,
  purpose         text not null default 'other'
                    check (purpose in ('proposal', 'purchase_order', 'authorised_email', 'brief', 'other')),
  uploaded_by     uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint crm_files_file_shape check (
    kind <> 'file' or (
      storage_path is not null and original_name is not null and mime_type is not null and size_bytes is not null
      and url is null
      and mime_type = any (crm_allowed_mime_types())
      and size_bytes between 1 and 20971520
      and not crm_file_name_blocked(original_name)
      and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,150}$'
    )),
  constraint crm_files_link_shape check (
    kind <> 'link' or (url is not null and url ~* '^https://[^\s]+$' and storage_path is null and mime_type is null and size_bytes is null))
);
create index if not exists idx_crm_files_opp on crm_files(opportunity_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Proposals (versions recorded manually; Canva/ChatGPT/Zoho stay outside the app)
-- -----------------------------------------------------------------------------
create table if not exists crm_proposals (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references crm_opportunities(id) on delete cascade,
  company_id      uuid not null references companies(id),
  version         integer not null check (version >= 1),
  status          text not null default 'draft' check (status in ('draft', 'sent', 'superseded', 'accepted')),
  file_id         uuid references crm_files(id),
  note            text,
  sent_on         date,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (opportunity_id, version),
  constraint crm_proposals_sent check (status not in ('sent', 'accepted') or sent_on is not null)
);

-- Zoho Books stays the accounting source: only references and dated manual statuses live here.
create table if not exists crm_zoho_references (
  opportunity_id        uuid primary key references crm_opportunities(id) on delete cascade,
  company_id            uuid not null references companies(id),
  quote_ref             text,
  quote_sent_on         date,
  invoice_ref           text,
  invoice_issued_on     date,
  payment_received_on   date,
  paid_amount           numeric(14, 2) check (paid_amount is null or paid_amount >= 0),
  updated_by            uuid references auth.users(id),
  updated_at            timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Commercial approval: a request/decision log. With the company policy 'not_configured' (the default) no
-- request can be decided; an absent approval is never presented as an approval.
-- -----------------------------------------------------------------------------
create table if not exists crm_approvals (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references crm_opportunities(id) on delete cascade,
  company_id      uuid not null references companies(id),
  proposal_id     uuid references crm_proposals(id),
  state           text not null default 'pending' check (state in ('pending', 'approved', 'changes_requested')),
  requested_by    uuid not null references auth.users(id),
  requested_at    timestamptz not null default now(),
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  instruction     text,
  constraint crm_approvals_decided check (state = 'pending' or (decided_by is not null and decided_at is not null))
);
create index if not exists idx_crm_approvals_opp on crm_approvals(opportunity_id);

-- -----------------------------------------------------------------------------
-- Handover to the Project Manager (the package is built from the opportunity; this records its status)
-- -----------------------------------------------------------------------------
create table if not exists crm_handovers (
  opportunity_id  uuid primary key references crm_opportunities(id) on delete cascade,
  company_id      uuid not null references companies(id),
  pm_user_id      uuid references auth.users(id),
  status          text not null default 'draft' check (status in ('draft', 'ready', 'handed_over')),
  notes           text,
  prepared_by     uuid references auth.users(id),
  prepared_at     timestamptz,
  handed_over_at  timestamptz,
  updated_at      timestamptz not null default now(),
  constraint crm_handovers_done check (status <> 'handed_over' or (pm_user_id is not null and handed_over_at is not null))
);

-- -----------------------------------------------------------------------------
-- In-app reminders (first). Owner emails are queued only when the company setting is on; dedupe_key makes every
-- reminder idempotent so a re-run of the job never creates (or emails) twice.
-- -----------------------------------------------------------------------------
create table if not exists crm_reminders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  company_id            uuid not null references companies(id),
  opportunity_id        uuid not null references crm_opportunities(id) on delete cascade,
  follow_up_id          uuid references crm_follow_ups(id) on delete cascade,
  kind                  text not null check (kind in ('follow_up_due', 'follow_up_overdue', 'hold_review_due', 'no_next_action')),
  title                 text not null,
  due_at                timestamptz,
  dedupe_key            text not null unique,
  created_at            timestamptz not null default now(),
  read_at               timestamptz,
  email_status          text not null default 'not_requested'
                          check (email_status in ('not_requested', 'pending', 'sent', 'failed', 'skipped')),
  email_attempts        integer not null default 0,
  email_next_attempt_at timestamptz,
  email_last_error      text,
  email_sent_at         timestamptz
);
create index if not exists idx_crm_reminders_user on crm_reminders(user_id, read_at);
create index if not exists idx_crm_reminders_email on crm_reminders(email_next_attempt_at) where email_status in ('pending', 'failed');

-- -----------------------------------------------------------------------------
-- Closure history: every Won / Lost is kept even if the opportunity is later reopened. The live columns on
-- crm_opportunities describe only the CURRENT state; reporting on past outcomes and the audit trail read this table.
-- -----------------------------------------------------------------------------
create table if not exists crm_closures (
  id                  uuid primary key default gen_random_uuid(),
  opportunity_id      uuid not null references crm_opportunities(id) on delete cascade,
  company_id          uuid not null references companies(id),
  outcome             text not null check (outcome in ('won', 'lost')),
  closed_from_stage   text,
  closed_at           timestamptz not null default now(),
  closed_by           uuid references auth.users(id),
  value_at_close      numeric(14, 2),
  currency            text,
  evidence_type       text,
  evidence_reference  text,
  evidence_date       date,
  lost_reason         text,
  reopened_at         timestamptz,
  reopened_by         uuid references auth.users(id),
  reopen_reason       text,
  constraint crm_closures_reopen_complete check (
    (reopened_at is null) = (reopened_by is null) and (reopened_at is null or length(btrim(coalesce(reopen_reason, ''))) > 0))
);
-- At most one closure is "current" (not reopened) per opportunity.
create unique index if not exists uq_crm_closures_current on crm_closures(opportunity_id) where reopened_at is null;
create index if not exists idx_crm_closures_company_time on crm_closures(company_id, closed_at);

-- -----------------------------------------------------------------------------
-- Upload intents. A file is uploaded by the browser straight to a private QUARANTINE bucket (Vercel functions accept at
-- most 4.5 MB of request body, so large files cannot pass through the app), then validated by the server, and only a
-- validated file is moved into the real bucket and registered. Clients have no access to this table or to the
-- quarantine bucket; the intent functions in migration 4 are the only way in.
-- -----------------------------------------------------------------------------
create table if not exists crm_upload_intents (
  id               uuid primary key default gen_random_uuid(),
  opportunity_id   uuid not null references crm_opportunities(id) on delete cascade,
  company_id       uuid not null references companies(id),
  user_id          uuid not null references auth.users(id),
  original_name    text not null,
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes between 1 and 20971520),
  purpose          text not null check (purpose in ('proposal', 'purchase_order', 'authorised_email', 'brief', 'other')),
  label            text,
  quarantine_path  text not null unique,
  final_path       text not null unique,
  status           text not null default 'pending' check (status in ('pending', 'validated', 'rejected', 'registered', 'expired')),
  reject_reason    text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '2 hours',
  finished_at      timestamptz,
  swept_at         timestamptz           -- set once the scheduled clean-up has removed whatever it may have left in storage
);
create index if not exists idx_crm_upload_intents_open on crm_upload_intents(expires_at) where swept_at is null;

-- -----------------------------------------------------------------------------
-- updated_at + audit triggers
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'crm_organisations', 'crm_contacts', 'crm_opportunities', 'crm_follow_ups', 'crm_proposals', 'crm_handovers'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
  foreach t in array array[
    'crm_organisations', 'crm_contacts', 'crm_opportunities', 'crm_opportunity_contacts', 'crm_follow_ups',
    'crm_files', 'crm_proposals', 'crm_zoho_references', 'crm_approvals', 'crm_handovers', 'crm_closures'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function crm_audit_trigger()',
                   t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RLS: SELECT only
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'crm_organisations', 'crm_contacts', 'crm_reference_counters', 'crm_opportunities', 'crm_opportunity_contacts',
    'crm_opportunity_events', 'crm_activities', 'crm_follow_ups', 'crm_files', 'crm_proposals',
    'crm_zoho_references', 'crm_approvals', 'crm_handovers', 'crm_reminders', 'crm_closures', 'crm_upload_intents'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

drop policy if exists crm_organisations_select on crm_organisations;
create policy crm_organisations_select on crm_organisations for select using (crm_has_any_access());
drop policy if exists crm_contacts_select on crm_contacts;
create policy crm_contacts_select on crm_contacts for select using (crm_has_any_access());

do $$
declare t text;
begin
  foreach t in array array[
    'crm_opportunities', 'crm_opportunity_contacts', 'crm_opportunity_events', 'crm_activities', 'crm_follow_ups',
    'crm_files', 'crm_proposals', 'crm_zoho_references', 'crm_approvals', 'crm_handovers', 'crm_closures'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (crm_has_access(company_id))', t || '_select', t);
  end loop;
end $$;

-- Reference counters are internal: nobody reads them directly (no policy => no rows for clients).
-- Reminders are strictly the recipient's own, and only while they still hold access to that company.
drop policy if exists crm_reminders_select on crm_reminders;
create policy crm_reminders_select on crm_reminders for select
  using (user_id = auth.uid() and crm_has_access(company_id));

-- -----------------------------------------------------------------------------
-- Privileges: SELECT only for signed-in users; nothing for anon.
-- -----------------------------------------------------------------------------
revoke all on table
  crm_organisations, crm_contacts, crm_reference_counters, crm_opportunities, crm_opportunity_contacts,
  crm_opportunity_events, crm_activities, crm_follow_ups, crm_files, crm_proposals, crm_zoho_references,
  crm_approvals, crm_handovers, crm_reminders, crm_closures, crm_upload_intents
  from anon, authenticated, public;
grant select on table
  crm_organisations, crm_contacts, crm_opportunities, crm_opportunity_contacts, crm_opportunity_events,
  crm_activities, crm_follow_ups, crm_files, crm_proposals, crm_zoho_references, crm_approvals, crm_handovers,
  crm_reminders, crm_closures
  to authenticated;

-- Equipment-availability recheck: true when the check no longer covers what the opportunity now says.
create or replace function crm_availability_needs_recheck(p_opportunity_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select o.availability_state in ('confirmed', 'unavailable')
     and o.availability_covers is distinct from jsonb_build_object(
           'install_start', o.install_start, 'event_start', o.event_start, 'event_end', o.event_end,
           'technologies', o.technologies)
  from crm_opportunities o
  where o.id = p_opportunity_id and crm_has_access(o.company_id);
$$;
revoke all on function crm_availability_needs_recheck(uuid), crm_allowed_mime_types(), crm_file_name_blocked(text) from public, anon;
grant execute on function crm_availability_needs_recheck(uuid), crm_allowed_mime_types(), crm_file_name_blocked(text) to authenticated;

-- ROLLBACK (only before any CRM data exists; afterwards export first):
--   drop function if exists crm_availability_needs_recheck(uuid);
--   drop table if exists crm_upload_intents, crm_closures, crm_reminders, crm_handovers, crm_approvals, crm_zoho_references, crm_proposals, crm_files,
--     crm_follow_ups, crm_activities, crm_opportunity_events, crm_opportunity_contacts, crm_opportunities,
--     crm_reference_counters, crm_contacts, crm_organisations cascade;
--   drop function if exists crm_allowed_mime_types();
