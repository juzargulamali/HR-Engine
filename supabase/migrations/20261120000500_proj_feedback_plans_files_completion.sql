-- Projects & Tasks (Release 2), migration 6 of 7: client feedback and scope changes, issued client timelines, private files,
-- completion evidence and reopening.
--
-- Rules encoded here:
--   * Scope changes never overwrite the agreed scope: the handover snapshot stays as it was, every change records the scope it
--     replaced, and only a person with the 'approve_scope' capability decides. A chat message or an attachment never approves
--     anything. Cost effects live in a separate, commercially restricted table that PMs and members cannot read.
--   * Issued client timelines are immutable. The payload is built by the database from items the PM marked client-facing
--     (no internal tasks, discussions, notes, people or money). Issued, sent and client-accepted are three recorded facts;
--     recording one never implies another and the app sends nothing.
--   * Files: private buckets with no client policies, upload through a quarantine bucket and a signed URL, server-side
--     validation, then registration from the intent's own stored values. Restricted files are visible to PM/founders only.
--   * A client project cannot be completed without client completion evidence; unfinished work must be explicitly cancelled,
--     deferred or resolved (never silently done). Reopening needs a capability and a reason and keeps the earlier completion.

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create or replace function proj_file_name_blocked(p_name text)
returns boolean
language sql immutable
as $$ select crm_file_name_blocked(p_name); $$;

create table if not exists proj_files (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references proj_projects(id) on delete cascade,
  kind          text not null check (kind in ('file', 'link')),
  purpose       text not null default 'document' check (purpose in ('document', 'completion_evidence', 'feedback_evidence', 'other')),
  label         text,
  original_name text,
  storage_path  text unique,
  mime_type     text,
  size_bytes    bigint,
  url           text,
  -- Restricted files are readable by the PM, temporary leaders and founders only.
  restricted    boolean not null default false,
  uploaded_by   uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint proj_files_file_shape check (
    kind <> 'file' or (
      storage_path is not null and original_name is not null and mime_type is not null and size_bytes is not null and url is null
      and mime_type = any (crm_allowed_mime_types())
      and size_bytes between 1 and 20971520
      and not proj_file_name_blocked(original_name)
      and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,150}$')),
  constraint proj_files_link_shape check (
    kind <> 'link' or (url is not null and url ~* '^https://[^\s]+$' and storage_path is null and mime_type is null and size_bytes is null))
);
create index if not exists idx_proj_files_project on proj_files(project_id) where deleted_at is null;

create table if not exists proj_upload_intents (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references proj_projects(id) on delete cascade,
  company_id       uuid not null references companies(id),
  user_id          uuid not null references auth.users(id),
  original_name    text not null,
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes between 1 and 20971520),
  purpose          text not null check (purpose in ('document', 'completion_evidence', 'feedback_evidence', 'other')),
  label            text,
  restricted       boolean not null default false,
  quarantine_path  text not null unique,
  final_path       text not null unique,
  status           text not null default 'pending' check (status in ('pending', 'validated', 'rejected', 'registered', 'expired')),
  reject_reason    text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '2 hours',
  finished_at      timestamptz,
  swept_at         timestamptz
);
create index if not exists idx_proj_upload_intents_open on proj_upload_intents(expires_at) where swept_at is null;

create table if not exists proj_feedback (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references proj_projects(id) on delete cascade,
  target_type         text not null check (target_type in ('project', 'milestone', 'deliverable', 'task')),
  target_id           uuid,
  source              text not null check (length(btrim(source)) between 1 and 200),
  received_on         date not null,
  request_text        text not null check (length(btrim(request_text)) between 1 and 4000),
  -- A correction to what was agreed is delivered; a proposed change is a scope question and needs a decision.
  kind                text not null check (kind in ('in_scope_correction', 'proposed_change')),
  responsible_user_id uuid references auth.users(id),
  due_date            date,
  status              text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'declined', 'deferred')),
  resolution          text,
  evidence_note       text,
  resolved_at         timestamptz,
  resolved_by         uuid references auth.users(id),
  scope_change_id     uuid,
  created_by          uuid references auth.users(id),
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint proj_feedback_target check ((target_type = 'project') = (target_id is null)),
  constraint proj_feedback_resolved check (
    status in ('open', 'in_progress') or length(btrim(coalesce(resolution, ''))) > 0)
);
create index if not exists idx_proj_feedback_project on proj_feedback(project_id, status);

create table if not exists proj_scope_changes (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references proj_projects(id) on delete cascade,
  feedback_id      uuid references proj_feedback(id),
  title            text not null check (length(btrim(title)) between 1 and 200),
  -- What the scope said when this was proposed (the original is never edited), and what is proposed instead.
  original_scope   text,
  base_scope_hash  text not null,
  proposed_scope   text not null check (length(btrim(proposed_scope)) > 0),
  effect_on_dates  text,
  status           text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'withdrawn')),
  proposed_by      uuid not null references auth.users(id),
  proposed_at      timestamptz not null default now(),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz not null default now(),
  constraint proj_scope_changes_decided check ((status in ('approved', 'rejected')) = (decided_at is not null))
);
create index if not exists idx_proj_scope_changes_project on proj_scope_changes(project_id, proposed_at);
alter table proj_feedback drop constraint if exists proj_feedback_scope_change_fk;
alter table proj_feedback add constraint proj_feedback_scope_change_fk foreign key (scope_change_id) references proj_scope_changes(id);

-- Financial effect of a scope change: restricted to 'view_commercial' (founders hold it). Never in a member-readable table.
create table if not exists proj_scope_change_commercial (
  scope_change_id uuid primary key references proj_scope_changes(id) on delete cascade,
  project_id      uuid not null references proj_projects(id) on delete cascade,
  currency        text check (currency is null or currency ~ '^[A-Z]{3}$'),
  amount          numeric(14, 2),
  note            text,
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);

create table if not exists proj_issued_plans (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references proj_projects(id) on delete cascade,
  version           integer not null,
  client_reference  text not null check (length(btrim(client_reference)) between 1 and 100),
  title             text not null,
  tz                text not null,
  payload           jsonb not null,
  payload_hash      text not null,
  note              text,
  issued_by         uuid not null references auth.users(id),
  issued_at         timestamptz not null default now(),
  superseded_at     timestamptz,
  sent_at           timestamptz,
  sent_by           uuid references auth.users(id),
  sent_note         text,
  accepted_on       date,
  accepted_recorded_at timestamptz,
  accepted_recorded_by uuid references auth.users(id),
  accepted_contact  text,
  accepted_note     text,
  constraint proj_issued_plans_version unique (project_id, version)
);

create table if not exists proj_completions (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references proj_projects(id) on delete cascade,
  evidence_type      text not null check (evidence_type in ('email_reference', 'signed_handover', 'uploaded_confirmation', 'internal_note')),
  evidence_reference text,
  file_id            uuid references proj_files(id),
  confirmed_on       date,
  client_contact     text,
  completion_note    text not null check (length(btrim(completion_note)) > 0),
  -- What was cancelled / deferred / resolved to allow completion (a record, not a way to hide anything).
  resolutions        jsonb not null default '[]'::jsonb,
  completed_by       uuid not null references auth.users(id),
  completed_at       timestamptz not null default now(),
  reopened_at        timestamptz,
  reopened_by        uuid references auth.users(id),
  reopen_reason      text
);
create unique index if not exists uq_proj_completions_open on proj_completions(project_id) where reopened_at is null;

do $$
declare t text;
begin
  foreach t in array array['proj_feedback'] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['proj_feedback', 'proj_scope_changes', 'proj_issued_plans', 'proj_completions', 'proj_files'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function proj_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- An issued plan never changes: only the facts recorded AFTER issuing (sent, accepted, superseded) may be set.
create or replace function proj_issued_plan_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then raise exception 'An issued plan cannot be deleted' using errcode = '23514'; end if;
  if (new.id, new.project_id, new.version, new.client_reference, new.title, new.tz, new.payload, new.payload_hash, new.note, new.issued_by, new.issued_at)
     is distinct from
     (old.id, old.project_id, old.version, old.client_reference, old.title, old.tz, old.payload, old.payload_hash, old.note, old.issued_by, old.issued_at) then
    raise exception 'An issued plan cannot be changed. Issue a new version instead' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists proj_issued_plans_guard on proj_issued_plans;
create trigger proj_issued_plans_guard before update or delete on proj_issued_plans
  for each row execute function proj_issued_plan_guard();

-- -----------------------------------------------------------------------------
-- Row-level security (SELECT only)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['proj_feedback', 'proj_scope_changes', 'proj_issued_plans', 'proj_completions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (proj_can_view_details(project_id))', t || '_select', t);
  end loop;
end $$;

alter table proj_files enable row level security;
drop policy if exists proj_files_select on proj_files;
create policy proj_files_select on proj_files for select
  using (deleted_at is null and ((not restricted and proj_can_view_details(project_id)) or (restricted and proj_can_manage(project_id))));

alter table proj_upload_intents enable row level security;          -- no policy: server functions only

alter table proj_scope_change_commercial enable row level security;
drop policy if exists proj_scope_change_commercial_select on proj_scope_change_commercial;
create policy proj_scope_change_commercial_select on proj_scope_change_commercial for select
  using (proj_has_capability(proj_project_company(project_id), 'view_commercial'));

-- -----------------------------------------------------------------------------
-- Private buckets (no client policies: the service role is the only reader, mover and signer)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proj-files', 'proj-files', false, 20971520, crm_allowed_mime_types())
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proj-quarantine', 'proj-quarantine', false, 20971520, crm_allowed_mime_types())
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Files
-- -----------------------------------------------------------------------------
create or replace function proj_create_upload_intent(
  p_project_id uuid, p_original_name text, p_mime_type text, p_size_bytes bigint, p_safe_name text,
  p_purpose text default 'document', p_label text default null, p_restricted boolean default false
) returns table (intent_id uuid, quarantine_path text)
language plpgsql security definer
set search_path = public
as $$
declare v proj_projects; v_id uuid := gen_random_uuid(); v_final uuid := gen_random_uuid(); v_open integer; v_qpath text;
begin
  v := proj_lock_project(p_project_id);
  if not proj_can_view_details(v.id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  perform proj_require_open_project(v);
  if p_purpose not in ('document', 'completion_evidence', 'feedback_evidence', 'other') then raise exception 'Unknown file purpose' using errcode = '22023'; end if;
  if (coalesce(p_restricted, false) or p_purpose in ('completion_evidence')) and not proj_can_manage(v.id) then
    raise exception 'Only the Project Manager can add a restricted file or completion evidence' using errcode = '42501';
  end if;
  if length(coalesce(p_original_name, '')) not between 1 and 200 or proj_file_name_blocked(p_original_name) then
    raise exception 'Executable, script and macro-enabled files cannot be uploaded' using errcode = '22023';
  end if;
  if p_mime_type is null or not (p_mime_type = any (crm_allowed_mime_types())) then raise exception 'That file type is not allowed' using errcode = '22023'; end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 20971520 then raise exception 'Files must be between 1 byte and 20 MB' using errcode = '22023'; end if;
  if p_safe_name is null or p_safe_name !~ '^[A-Za-z0-9._-]{1,150}$' then raise exception 'Invalid file name' using errcode = '22023'; end if;
  select count(*) into v_open from proj_upload_intents i where i.user_id = auth.uid() and i.status in ('pending', 'validated') and i.expires_at > now();
  if v_open >= 20 then raise exception 'Too many uploads are waiting. Finish or wait for them to expire, then try again' using errcode = '53400'; end if;
  v_qpath := v.company_id::text || '/' || v.id::text || '/' || v_id::text || '-' || p_safe_name;
  insert into proj_upload_intents (id, project_id, company_id, user_id, original_name, mime_type, size_bytes, purpose, label, restricted, quarantine_path, final_path)
  values (v_id, v.id, v.company_id, auth.uid(), p_original_name, p_mime_type, p_size_bytes, p_purpose, nullif(btrim(p_label), ''), coalesce(p_restricted, false),
          v_qpath, v.company_id::text || '/' || v.id::text || '/' || v_final::text || '-' || p_safe_name);
  return query select v_id, v_qpath;
end;
$$;

create or replace function proj_get_upload_intent(p_intent_id uuid)
returns table (id uuid, project_id uuid, company_id uuid, original_name text, mime_type text, size_bytes bigint, purpose text, label text,
               restricted boolean, quarantine_path text, final_path text, status text, expires_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  return query
    select i.id, i.project_id, i.company_id, i.original_name, i.mime_type, i.size_bytes, i.purpose, i.label, i.restricted, i.quarantine_path, i.final_path, i.status, i.expires_at
    from proj_upload_intents i where i.id = p_intent_id and i.user_id = auth.uid() and proj_can_view_details(i.project_id);
end;
$$;

create or replace function proj_mark_upload_intent(p_intent_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_status not in ('validated', 'rejected') then raise exception 'Unknown status' using errcode = '22023'; end if;
  update proj_upload_intents i set status = p_status, reject_reason = left(p_reason, 300),
         finished_at = case when p_status = 'rejected' then now() else i.finished_at end
   where i.id = p_intent_id and i.status = 'pending' and i.expires_at > now();
  if not found then raise exception 'Upload not found, already decided, or expired' using errcode = 'P0002'; end if;
end;
$$;

create or replace function proj_register_uploaded_file(p_intent_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare i proj_upload_intents; v proj_projects; v_id uuid;
begin
  perform proj_require_user();
  select * into i from proj_upload_intents where id = p_intent_id and user_id = auth.uid() for update;
  if not found then raise exception 'Upload not found' using errcode = 'P0002'; end if;
  if i.status = 'registered' then raise exception 'This upload was already added' using errcode = '23514'; end if;
  if i.status <> 'validated' then raise exception 'This upload has not passed the file checks' using errcode = '23514'; end if;
  v := proj_lock_project(i.project_id);
  perform proj_require_open_project(v);
  if not proj_can_view_details(v.id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'proj-files' and name = i.final_path) then
    raise exception 'The validated file was not found' using errcode = 'P0002';
  end if;
  insert into proj_files (project_id, kind, purpose, label, original_name, storage_path, mime_type, size_bytes, restricted, uploaded_by)
  values (i.project_id, 'file', i.purpose, i.label, i.original_name, i.final_path, i.mime_type, i.size_bytes, i.restricted, auth.uid())
  returning id into v_id;
  update proj_upload_intents set status = 'registered', finished_at = now() where id = i.id;
  return v_id;
end;
$$;

create or replace function proj_expire_upload_intents()
returns table (quarantine_path text, final_path text, orphaned_validated boolean)
language plpgsql security definer
set search_path = public
as $$
begin
  return query
    with due as (select u.id, u.status from proj_upload_intents u where u.swept_at is null and u.expires_at < now() for update),
         upd as (update proj_upload_intents i
                    set swept_at = now(), status = case when i.status in ('pending', 'validated') then 'expired' else i.status end,
                        finished_at = coalesce(i.finished_at, now())
                   from due where i.id = due.id returning i.id, i.quarantine_path as qp, i.final_path as fp)
    select upd.qp, upd.fp, (due.status = 'validated') from upd join due on due.id = upd.id;
end;
$$;

create or replace function proj_add_link(p_project_id uuid, p_label text, p_url text, p_purpose text default 'document', p_restricted boolean default false)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v proj_projects; v_id uuid;
begin
  v := proj_lock_project(p_project_id);
  if not proj_can_view_details(v.id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  perform proj_require_open_project(v);
  if (coalesce(p_restricted, false) or p_purpose = 'completion_evidence') and not proj_can_manage(v.id) then
    raise exception 'Only the Project Manager can add a restricted link or completion evidence' using errcode = '42501';
  end if;
  if p_purpose not in ('document', 'completion_evidence', 'feedback_evidence', 'other') then raise exception 'Unknown file purpose' using errcode = '22023'; end if;
  if p_url is null or p_url !~* '^https://[^\s]+$' then raise exception 'Links must start with https://' using errcode = '22023'; end if;
  insert into proj_files (project_id, kind, purpose, label, url, restricted, uploaded_by)
  values (v.id, 'link', p_purpose, nullif(btrim(p_label), ''), btrim(p_url), coalesce(p_restricted, false), auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

-- Soft-removes the record; the server deletes the stored object with the service role afterwards. Uploader or PM.
create or replace function proj_remove_file(p_file_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare f proj_files; v proj_projects;
begin
  perform proj_require_user();
  select * into f from proj_files where id = p_file_id and deleted_at is null for update;
  if not found then raise exception 'File not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(f.project_id);
  if f.uploaded_by <> auth.uid() and not proj_can_manage(v.id) then raise exception 'Only the person who added it or the Project Manager can remove this' using errcode = '42501'; end if;
  if f.restricted and not proj_can_manage(v.id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform proj_require_open_project(v);
  if exists (select 1 from proj_completions c where c.file_id = f.id and c.reopened_at is null) then
    raise exception 'This file is the evidence the project was completed with' using errcode = '23514';
  end if;
  update proj_files set deleted_at = now() where id = f.id;
  return f.storage_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Client feedback and scope changes (PM / founder record and decide; the responsible person resolves)
-- -----------------------------------------------------------------------------
create or replace function proj_record_feedback(p_project_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  v_type text := coalesce(proj_text_or_null(p_fields, 'target_type'), 'project');
  v_target uuid := nullif(p_fields->>'target_id', '')::uuid;
  v_resp uuid := nullif(p_fields->>'responsible_user_id', '')::uuid;
  v_id uuid;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if v_type = 'project' then v_target := null;
  elsif v_target is null
     or not exists (select 1 from (
          select id from proj_milestones where project_id = v.id and v_type = 'milestone'
          union all select id from proj_deliverables where project_id = v.id and v_type = 'deliverable'
          union all select id from proj_tasks where project_id = v.id and v_type = 'task') x where x.id = v_target) then
    raise exception 'Choose the milestone, deliverable or task this feedback is about' using errcode = '22023';
  end if;
  if v_resp is not null and not exists (select 1 from proj_project_members where project_id = v.id and user_id = v_resp and removed_at is null) then
    raise exception 'The responsible person must be a member of the project' using errcode = '22023';
  end if;
  if coalesce(p_fields->>'kind', '') not in ('in_scope_correction', 'proposed_change') then
    raise exception 'Say whether this is a correction to what was agreed or a proposed change' using errcode = '22023';
  end if;
  insert into proj_feedback (project_id, target_type, target_id, source, received_on, request_text, kind, responsible_user_id, due_date, created_by)
  values (v.id, v_type, v_target, btrim(coalesce(p_fields->>'source', '')), (p_fields->>'received_on')::date, btrim(coalesce(p_fields->>'request_text', '')),
          p_fields->>'kind', v_resp, nullif(p_fields->>'due_date', '')::date, auth.uid())
  returning id into v_id;
  perform proj_notify(v.id, v_resp, 'project_assignment',
    jsonb_build_object('name', v.name, 'reference', v.reference, 'feedback_id', v_id), 'feedback:' || v_id || ':assigned');
  return v_id;
end;
$$;

create or replace function proj_update_feedback(p_feedback_id uuid, p_fields jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  f proj_feedback;
  v proj_projects;
  v_status text;
begin
  perform proj_require_user();
  select * into f from proj_feedback where id = p_feedback_id for update;
  if not found then raise exception 'Feedback not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(f.project_id);
  perform proj_require_open_project(v);
  if not (proj_can_manage(v.id) or (f.responsible_user_id = auth.uid() and proj_is_active_member(v.id))) then
    raise exception 'Only the Project Manager or the person responsible can update this feedback' using errcode = '42501';
  end if;
  perform proj_check_version(f.version, nullif(p_fields->>'expected_version', '')::integer);
  v_status := coalesce(proj_text_or_null(p_fields, 'status'), f.status);
  if v_status not in ('open', 'in_progress', 'resolved', 'declined', 'deferred') then raise exception 'Unknown feedback status' using errcode = '22023'; end if;
  if v_status not in ('open', 'in_progress') and length(btrim(coalesce(proj_text_or_null(p_fields, 'resolution'), f.resolution, ''))) = 0 then
    raise exception 'Record how this was resolved, declined or deferred' using errcode = '22023';
  end if;
  if (p_fields ? 'responsible_user_id' or p_fields ? 'due_date') and not proj_can_manage(v.id) then
    raise exception 'Only the Project Manager can reassign feedback or change its deadline' using errcode = '42501';
  end if;
  update proj_feedback set status = v_status,
    resolution = case when p_fields ? 'resolution' then proj_text_or_null(p_fields, 'resolution') else resolution end,
    evidence_note = case when p_fields ? 'evidence_note' then proj_text_or_null(p_fields, 'evidence_note') else evidence_note end,
    responsible_user_id = case when p_fields ? 'responsible_user_id' then nullif(p_fields->>'responsible_user_id', '')::uuid else responsible_user_id end,
    due_date = case when p_fields ? 'due_date' then nullif(p_fields->>'due_date', '')::date else due_date end,
    resolved_at = case when v_status in ('resolved', 'declined', 'deferred') then coalesce(resolved_at, now()) else null end,
    resolved_by = case when v_status in ('resolved', 'declined', 'deferred') then coalesce(resolved_by, auth.uid()) else null end,
    version = version + 1
   where id = f.id;
end;
$$;

create or replace function proj_propose_scope_change(p_project_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  d proj_project_details;
  v_id uuid;
  v_feedback uuid := nullif(p_fields->>'feedback_id', '')::uuid;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  select * into d from proj_project_details where project_id = v.id;
  if length(btrim(coalesce(p_fields->>'title', ''))) = 0 then raise exception 'Give the change a title' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_fields->>'proposed_scope', ''))) = 0 then raise exception 'Write the proposed scope' using errcode = '22023'; end if;
  if v_feedback is not null and not exists (select 1 from proj_feedback where id = v_feedback and project_id = v.id) then
    raise exception 'Unknown feedback' using errcode = '22023';
  end if;
  insert into proj_scope_changes (project_id, feedback_id, title, original_scope, base_scope_hash, proposed_scope, effect_on_dates, proposed_by)
  values (v.id, v_feedback, btrim(p_fields->>'title'), d.scope, md5(coalesce(d.scope, '')), btrim(p_fields->>'proposed_scope'),
          proj_text_or_null(p_fields, 'effect_on_dates'), auth.uid())
  returning id into v_id;
  if p_fields ? 'cost_note' or p_fields ? 'amount' then
    insert into proj_scope_change_commercial (scope_change_id, project_id, currency, amount, note, updated_by)
    values (v_id, v.id, nullif(upper(p_fields->>'currency'), ''), nullif(p_fields->>'amount', '')::numeric, proj_text_or_null(p_fields, 'cost_note'), auth.uid());
  end if;
  if v_feedback is not null then update proj_feedback set scope_change_id = v_id, version = version + 1 where id = v_feedback; end if;
  return v_id;
end;
$$;

create or replace function proj_set_scope_change_commercial(p_scope_change_id uuid, p_currency text, p_amount numeric, p_note text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare s proj_scope_changes; v_company uuid;
begin
  perform proj_require_user();
  select * into s from proj_scope_changes where id = p_scope_change_id;
  if not found then raise exception 'Scope change not found' using errcode = 'P0002'; end if;
  v_company := proj_project_company(s.project_id);
  if not proj_has_capability(v_company, 'view_commercial') then
    raise exception 'Only a founder, or someone a founder gave commercial access to, can record the cost effect' using errcode = '42501';
  end if;
  insert into proj_scope_change_commercial (scope_change_id, project_id, currency, amount, note, updated_by)
  values (s.id, s.project_id, nullif(upper(p_currency), ''), p_amount, nullif(btrim(p_note), ''), auth.uid())
  on conflict (scope_change_id) do update set currency = excluded.currency, amount = excluded.amount, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

create or replace function proj_withdraw_scope_change(p_scope_change_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare s proj_scope_changes; v proj_projects;
begin
  perform proj_require_user();
  select * into s from proj_scope_changes where id = p_scope_change_id for update;
  if not found then raise exception 'Scope change not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(s.project_id);
  perform proj_require_manager(v);
  if s.status = 'withdrawn' then return; end if;
  if s.status <> 'proposed' then raise exception 'A decided scope change cannot be withdrawn' using errcode = '23514'; end if;
  update proj_scope_changes set status = 'withdrawn' where id = s.id;
end;
$$;

-- Only 'approve_scope' (founders hold it) decides. Approval replaces the CURRENT scope; the original stays in the handover
-- snapshot and in every earlier change record. Dates are never moved by an approval: the effect on dates is a note for the PM.
create or replace function proj_decide_scope_change(p_scope_change_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  s proj_scope_changes;
  v proj_projects;
  d proj_project_details;
  v_target text;
begin
  perform proj_require_user();
  select * into s from proj_scope_changes where id = p_scope_change_id for update;
  if not found then raise exception 'Scope change not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(s.project_id);
  if not proj_has_capability(v.company_id, 'approve_scope') then
    raise exception 'Only a founder, or someone a founder gave scope approval to, can decide a scope change' using errcode = '42501';
  end if;
  perform proj_require_open_project(v);
  if p_decision not in ('approve', 'reject') then raise exception 'Choose approve or reject' using errcode = '22023'; end if;
  v_target := case when p_decision = 'approve' then 'approved' else 'rejected' end;
  if s.status = v_target then return; end if;   -- repeated click
  if s.status <> 'proposed' then raise exception 'This scope change is already % ', s.status using errcode = '23514'; end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Record the reason for the decision' using errcode = '22023'; end if;
  if p_decision = 'approve' then
    select * into d from proj_project_details where project_id = v.id for update;
    if md5(coalesce(d.scope, '')) <> s.base_scope_hash then
      raise exception 'The scope has changed since this was proposed. Ask the Project Manager to propose it again' using errcode = '40001';
    end if;
    update proj_project_details set scope = s.proposed_scope where project_id = v.id;
    perform proj_log_change(v.id, 'project', v.id, 'scope', 'previous scope kept in change ' || s.id::text, 'approved change ' || s.id::text, p_note);
  end if;
  update proj_scope_changes set status = v_target,
         decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note) where id = s.id;
  perform proj_notify(v.id, v.pm_user_id, 'project_scope_decision',
    jsonb_build_object('name', v.name, 'reference', v.reference, 'scope_change_id', s.id, 'decision', p_decision), 'scopechange:' || s.id || ':' || p_decision);
end;
$$;

-- -----------------------------------------------------------------------------
-- Client timeline: the database builds the payload from what the PM marked client-facing.
-- -----------------------------------------------------------------------------
create or replace function proj_build_plan_payload(p_project_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'project', (select jsonb_build_object('reference', pr.reference, 'name', pr.name, 'client_name', d.client_name, 'location', d.location, 'site_timezone', d.site_timezone)
                  from proj_projects pr join proj_project_details d on d.project_id = pr.id where pr.id = p_project_id),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('title', m.title, 'due_date', m.due_date) order by m.due_date nulls last, m.sort_order, m.title)
                              from proj_milestones m where m.project_id = p_project_id and m.client_facing and m.status <> 'cancelled'), '[]'::jsonb),
    'delivery', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'start_date', i.start_date, 'end_date', i.end_date) order by i.start_date nulls last, i.sort_order, i.title)
                            from proj_plan_items i where i.project_id = p_project_id and i.plan = 'delivery' and i.client_facing and i.status <> 'cancelled'), '[]'::jsonb),
    'site', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'start_date', i.start_date, 'end_date', i.end_date,
                                                           'starts_local', case when i.starts_at is not null then to_char(i.starts_at at time zone i.tz, 'YYYY-MM-DD"T"HH24:MI') end,
                                                           'ends_local', case when i.ends_at is not null then to_char(i.ends_at at time zone i.tz, 'YYYY-MM-DD"T"HH24:MI') end,
                                                           'tz', i.tz)
                                         order by coalesce(i.start_date::timestamp, i.starts_at at time zone i.tz) nulls last, i.sort_order, i.title)
                        from proj_plan_items i where i.project_id = p_project_id and i.plan = 'site' and i.client_facing and i.status <> 'cancelled'), '[]'::jsonb),
    'dependencies', coalesce((select jsonb_agg(jsonb_build_object('label', e.label, 'kind', e.kind, 'expected_date', e.expected_date, 'expected_time', e.expected_time,
                                                                   'organisation', e.organisation, 'confirmation', e.confirmation)
                                                order by e.expected_date nulls last, e.label)
                                from proj_external_dependencies e where e.project_id = p_project_id and e.client_facing), '[]'::jsonb));
$$;

create or replace function proj_current_plan_payload(p_project_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if not proj_can_manage(p_project_id) then return null; end if;
  return proj_build_plan_payload(p_project_id);
end;
$$;

create or replace function proj_issue_plan(p_project_id uuid, p_client_reference text default null, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  d proj_project_details;
  v_payload jsonb;
  v_version integer;
  v_id uuid;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if v.kind <> 'client' then raise exception 'Client timelines are for client projects' using errcode = '23514'; end if;
  if v.status = 'archived' then raise exception 'An archived project cannot issue a new timeline' using errcode = '23514'; end if;
  select * into d from proj_project_details where project_id = v.id;
  v_payload := proj_build_plan_payload(v.id);
  if jsonb_array_length(v_payload->'milestones') + jsonb_array_length(v_payload->'delivery') + jsonb_array_length(v_payload->'site') = 0 then
    raise exception 'Mark at least one milestone or timeline activity as client-facing before issuing' using errcode = '22023';
  end if;
  -- Issuing the same content twice in a row (double click) returns the version already issued.
  select id into v_id from proj_issued_plans where project_id = v.id and superseded_at is null and payload_hash = md5(v_payload::text);
  if v_id is not null then return v_id; end if;
  select coalesce(max(version), 0) + 1 into v_version from proj_issued_plans where project_id = v.id;
  update proj_issued_plans set superseded_at = now() where project_id = v.id and superseded_at is null;
  insert into proj_issued_plans (project_id, version, client_reference, title, tz, payload, payload_hash, note, issued_by)
  values (v.id, v_version, coalesce(proj_text_or_null(jsonb_build_object('r', p_client_reference), 'r'), v.reference), v.name, d.site_timezone, v_payload, md5(v_payload::text), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- True when the live client-facing plan no longer matches the latest issued version (so the issued one is outdated).
create or replace function proj_plan_outdated(p_project_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare p proj_issued_plans;
begin
  perform proj_require_user();
  if not proj_can_view_details(p_project_id) then return null; end if;
  select * into p from proj_issued_plans where project_id = p_project_id and superseded_at is null;
  if not found then return null; end if;
  return md5(proj_build_plan_payload(p_project_id)::text) <> p.payload_hash;
end;
$$;

create or replace function proj_record_plan_sent(p_plan_id uuid, p_note text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare p proj_issued_plans; v proj_projects;
begin
  perform proj_require_user();
  select * into p from proj_issued_plans where id = p_plan_id for update;
  if not found then raise exception 'Issued plan not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(p.project_id);
  perform proj_require_manager(v);
  if p.sent_at is not null then return; end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Record how and to whom it was sent' using errcode = '22023'; end if;
  update proj_issued_plans set sent_at = now(), sent_by = auth.uid(), sent_note = btrim(p_note) where id = p.id;
end;
$$;

create or replace function proj_record_plan_accepted(p_plan_id uuid, p_accepted_on date, p_contact text, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare p proj_issued_plans; v proj_projects;
begin
  perform proj_require_user();
  select * into p from proj_issued_plans where id = p_plan_id for update;
  if not found then raise exception 'Issued plan not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(p.project_id);
  perform proj_require_manager(v);
  if p.accepted_on is not null then return; end if;
  if p.superseded_at is not null then raise exception 'This version has been replaced by a newer one. Record acceptance against the latest version' using errcode = '23514'; end if;
  if p_accepted_on is null or p_accepted_on > (now() at time zone 'Asia/Dubai')::date then raise exception 'Give the date the client accepted (not in the future)' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_contact, ''))) = 0 then raise exception 'Record who at the client accepted it' using errcode = '22023'; end if;
  update proj_issued_plans set accepted_on = p_accepted_on, accepted_recorded_at = now(), accepted_recorded_by = auth.uid(),
         accepted_contact = btrim(p_contact), accepted_note = nullif(btrim(p_note), '') where id = p.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Completion and reopening
-- -----------------------------------------------------------------------------
create or replace function proj_completion_review(p_project_id uuid)
returns table (kind text, item_id uuid, title text, status text, detail text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  if not proj_can_manage(p_project_id) then return; end if;
  return query
    select 'task'::text, t.id, t.title, t.status, concat_ws(' · ', proj_display_name(t.assignee_id), case when t.blocked_at is not null then 'Blocked: ' || t.blocked_reason end)
      from proj_tasks t where t.project_id = p_project_id and t.status in ('todo', 'in_progress', 'ready_for_review')
    union all
    select 'deliverable', d.id, d.title, d.status, (select tm.name from proj_teams tm where tm.id = d.team_id)
      from proj_deliverables d where d.project_id = p_project_id and d.status in ('open', 'in_progress', 'ready_for_review')
    union all
    select 'milestone', m.id, m.title, m.status, case when m.is_required then 'Required' else 'Optional' end
      from proj_milestones m where m.project_id = p_project_id and m.status in ('planned', 'in_progress', 'ready_for_acceptance')
    union all
    select 'feedback', f.id, left(f.request_text, 120), f.status, f.source
      from proj_feedback f where f.project_id = p_project_id and f.status in ('open', 'in_progress')
    union all
    select 'booking', b.id, 'Site: ' || b.location, b.state, proj_display_name(b.user_id)
      from proj_site_bookings b where b.project_id = p_project_id and b.state in ('tentative', 'confirmed') and b.ends_at > now()
    order by 1, 3;
end;
$$;

create or replace function proj_complete_project(p_project_id uuid, p_fields jsonb, p_resolutions jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  c proj_completions;
  r record;
  e jsonb;
  v_action text;
  v_note text;
  v_type text := coalesce(proj_text_or_null(p_fields, 'evidence_type'), '');
  v_ref text := proj_text_or_null(p_fields, 'evidence_reference');
  v_file uuid := nullif(p_fields->>'file_id', '')::uuid;
  v_on date := nullif(p_fields->>'confirmed_on', '')::date;
  v_contact text := proj_text_or_null(p_fields, 'client_contact');
  v_note_c text := proj_text_or_null(p_fields, 'completion_note');
  v_missing integer;
  v_id uuid;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if v.status in ('completed', 'archived') then
    select * into c from proj_completions where project_id = v.id and reopened_at is null;
    if found then return c.id; end if;                                   -- repeated click: the same completion
    raise exception 'This project is already completed' using errcode = '23514';
  end if;
  if v_note_c is null then raise exception 'Write the completion note' using errcode = '22023'; end if;
  if v.kind = 'client' then
    if v_type not in ('email_reference', 'signed_handover', 'uploaded_confirmation') then
      raise exception 'A client project needs the client''s completion confirmation: an e-mail reference, a signed handover or an uploaded confirmation' using errcode = '22023';
    end if;
    if v_on is null or v_on > (now() at time zone 'Asia/Dubai')::date then raise exception 'Give the date the client confirmed (not in the future)' using errcode = '22023'; end if;
    if v_contact is null then raise exception 'Record who at the client confirmed' using errcode = '22023'; end if;
    if v_type = 'uploaded_confirmation' then
      if v_file is null or not exists (select 1 from proj_files where id = v_file and project_id = v.id and deleted_at is null and purpose = 'completion_evidence') then
        raise exception 'Upload the confirmation as completion evidence first, then select it' using errcode = '22023';
      end if;
    elsif v_ref is null then
      raise exception 'Give the e-mail reference or the signed handover reference' using errcode = '22023';
    end if;
  else
    v_type := 'internal_note'; v_ref := null; v_file := null; v_on := null; v_contact := null;
  end if;

  -- Everything unfinished must be explicitly cancelled, deferred or resolved, with a reason. Nothing becomes Done by completion.
  select count(*) into v_missing from proj_completion_review(v.id) x
   where not exists (select 1 from jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) j
                      where j->>'kind' = x.kind and (j->>'id')::uuid = x.item_id and length(btrim(coalesce(j->>'note', ''))) > 0
                        and j->>'action' = any (case x.kind when 'feedback' then array['resolve', 'decline', 'defer'] when 'booking' then array['cancel'] else array['cancel', 'defer'] end));
  if v_missing > 0 then
    raise exception '% unfinished item(s) still need an explicit decision (cancel, defer or resolve, with a reason) before the project can be completed', v_missing using errcode = '23514';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) loop
    v_action := e->>'action'; v_note := btrim(e->>'note');
    case e->>'kind'
      when 'task' then
        update proj_tasks set status = case v_action when 'cancel' then 'cancelled' else 'deferred' end, blocked_at = null, blocked_reason = null,
               unblock_owner_id = null, unblock_action = null, version = version + 1
         where id = (e->>'id')::uuid and project_id = v.id and status in ('todo', 'in_progress', 'ready_for_review');
        perform proj_task_event((e->>'id')::uuid, v.id, 'status_changed', null, case v_action when 'cancel' then 'cancelled' else 'deferred' end, 'At completion: ' || v_note);
      when 'deliverable' then
        update proj_deliverables set status = case v_action when 'cancel' then 'cancelled' else 'deferred' end, version = version + 1
         where id = (e->>'id')::uuid and project_id = v.id and status in ('open', 'in_progress', 'ready_for_review');
        perform proj_log_change(v.id, 'deliverable', (e->>'id')::uuid, 'status', null, v_action, 'At completion: ' || v_note);
      when 'milestone' then
        update proj_milestones set status = case v_action when 'cancel' then 'cancelled' else 'deferred' end, version = version + 1
         where id = (e->>'id')::uuid and project_id = v.id and status in ('planned', 'in_progress', 'ready_for_acceptance');
        perform proj_log_change(v.id, 'milestone', (e->>'id')::uuid, 'status', null, v_action, 'At completion: ' || v_note);
      when 'feedback' then
        update proj_feedback set status = case v_action when 'resolve' then 'resolved' when 'decline' then 'declined' else 'deferred' end,
               resolution = 'At completion: ' || v_note, resolved_at = now(), resolved_by = auth.uid(), version = version + 1
         where id = (e->>'id')::uuid and project_id = v.id and status in ('open', 'in_progress');
      when 'booking' then
        update proj_site_bookings set state = 'cancelled', cancel_reason = 'At completion: ' || v_note, confirmed_by = null, confirmed_at = null, version = version + 1
         where id = (e->>'id')::uuid and project_id = v.id and state in ('tentative', 'confirmed');
      else null;
    end case;
  end loop;

  insert into proj_completions (project_id, evidence_type, evidence_reference, file_id, confirmed_on, client_contact, completion_note, resolutions, completed_by)
  values (v.id, v_type, v_ref, v_file, v_on, v_contact, v_note_c, coalesce(p_resolutions, '[]'::jsonb), auth.uid())
  returning id into v_id;
  update proj_projects set status = 'completed', completed_at = now(), version = version + 1 where id = v.id;
  perform proj_log_change(v.id, 'project', v.id, 'status', v.status, 'completed', v_note_c);
  for r in select user_id from proj_project_members where project_id = v.id and removed_at is null loop
    perform proj_notify(v.id, r.user_id, 'project_completed', jsonb_build_object('name', v.name, 'reference', v.reference), 'project:' || v.id || ':completed:' || v_id);
  end loop;
  return v_id;
end;
$$;

-- Reopening: needs the capability and a reason. The completion record stays (marked reopened). Items cancelled or deferred at
-- completion stay as they are: the PM reinstates the ones that matter; nothing is deleted or silently revived.
create or replace function proj_reopen_project(p_project_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  r record;
begin
  v := proj_lock_project(p_project_id);
  if not proj_has_capability(v.company_id, 'reopen_project') then
    raise exception 'Only a founder, or someone a founder gave reopening to, can reopen a completed project' using errcode = '42501';
  end if;
  if v.status not in ('completed', 'archived') then
    if v.status = 'in_progress' and exists (select 1 from proj_completions where project_id = v.id and reopened_at is not null) then return; end if;   -- repeated click
    raise exception 'Only a completed project can be reopened' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Give the reason for reopening' using errcode = '22023'; end if;
  update proj_completions set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = btrim(p_reason) where project_id = v.id and reopened_at is null;
  update proj_projects set status = 'in_progress', completed_at = null, archived_at = null, version = version + 1 where id = v.id;
  perform proj_log_change(v.id, 'project', v.id, 'status', v.status, 'in_progress', 'Reopened: ' || btrim(p_reason));
  for r in select user_id from proj_project_members where project_id = v.id and removed_at is null loop
    perform proj_notify(v.id, r.user_id, 'project_reopened', jsonb_build_object('name', v.name, 'reference', v.reference), 'project:' || v.id || ':reopened:' || (v.version + 1));
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['proj_files', 'proj_upload_intents', 'proj_feedback', 'proj_scope_changes', 'proj_scope_change_commercial', 'proj_issued_plans', 'proj_completions'] loop
    execute format('revoke all on table %I from anon, authenticated, public', t);
  end loop;
  foreach t in array array['proj_files', 'proj_feedback', 'proj_scope_changes', 'proj_scope_change_commercial', 'proj_issued_plans', 'proj_completions'] loop
    execute format('grant select on table %I to authenticated', t);
  end loop;
end $$;

revoke all on function
  proj_file_name_blocked(text), proj_issued_plan_guard(), proj_build_plan_payload(uuid),
  proj_create_upload_intent(uuid, text, text, bigint, text, text, text, boolean), proj_get_upload_intent(uuid),
  proj_mark_upload_intent(uuid, text, text), proj_register_uploaded_file(uuid), proj_expire_upload_intents(),
  proj_add_link(uuid, text, text, text, boolean), proj_remove_file(uuid),
  proj_record_feedback(uuid, jsonb), proj_update_feedback(uuid, jsonb),
  proj_propose_scope_change(uuid, jsonb), proj_set_scope_change_commercial(uuid, text, numeric, text),
  proj_withdraw_scope_change(uuid), proj_decide_scope_change(uuid, text, text),
  proj_current_plan_payload(uuid), proj_issue_plan(uuid, text, text), proj_plan_outdated(uuid),
  proj_record_plan_sent(uuid, text), proj_record_plan_accepted(uuid, date, text, text),
  proj_completion_review(uuid), proj_complete_project(uuid, jsonb, jsonb), proj_reopen_project(uuid, text)
  from public, anon, authenticated;

grant execute on function
  proj_create_upload_intent(uuid, text, text, bigint, text, text, text, boolean), proj_get_upload_intent(uuid),
  proj_register_uploaded_file(uuid), proj_add_link(uuid, text, text, text, boolean), proj_remove_file(uuid),
  proj_record_feedback(uuid, jsonb), proj_update_feedback(uuid, jsonb),
  proj_propose_scope_change(uuid, jsonb), proj_set_scope_change_commercial(uuid, text, numeric, text),
  proj_withdraw_scope_change(uuid), proj_decide_scope_change(uuid, text, text),
  proj_current_plan_payload(uuid), proj_issue_plan(uuid, text, text), proj_plan_outdated(uuid),
  proj_record_plan_sent(uuid, text), proj_record_plan_accepted(uuid, date, text, text),
  proj_completion_review(uuid), proj_complete_project(uuid, jsonb, jsonb), proj_reopen_project(uuid, text)
  to authenticated;

-- Scheduled / server-only: the service role (never reachable from a browser session). Nothing here is scheduled by this release.
grant execute on function proj_mark_upload_intent(uuid, text, text), proj_expire_upload_intents() to service_role;
