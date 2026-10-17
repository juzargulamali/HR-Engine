-- Sales & CRM (Stage B), migration 4 of 4: files, proposals, Zoho references, equipment availability, commercial
-- approval (unconfigured by default), handover, in-app reminders and the private storage bucket.
--
-- Hard rules encoded here:
--   * Files: two private buckets and no client policies on either. Vercel functions accept at most 4.5 MB of request
--     body, so a browser cannot post a large file through the app. Instead: crm_create_upload_intent() records what
--     the person says they will upload (name, type, size) after the same checks as the table; the browser sends the
--     bytes straight to the QUARANTINE bucket with a one-time signed URL; the server then reads the object back,
--     checks its real size and leading bytes (executables and macro-enabled Office files are refused), and only a file
--     that passes is moved into 'crm-files' and registered by crm_register_uploaded_file() from the intent's own
--     stored values (the client never supplies a path). Nobody can read a file that has not been validated. The table
--     CHECKs and both buckets reject executables and macro-enabled formats again.
--   * Commercial approval: while a company's policy is 'not_configured' nothing can be requested or decided, and the
--     UI shows "not configured", never "approved". Policy changes need 'manage_approval_rules'.
--   * Equipment availability is a dated check by a person with 'confirm_availability'. It is not a stock reservation
--     and not a commercial confirmation, and it needs repeating when dates, technologies or quantities change.
--   * Reminders are in-app first. Email is queued only when the company setting owner_email_enabled is on, with retries
--     and a unique dedupe key. Nothing here sends anything to a client.

-- -----------------------------------------------------------------------------
-- Private buckets (no client policies: the service role is the only reader, mover and signer)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-files', 'crm-files', false, 20971520, crm_allowed_mime_types())
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Quarantine: where an upload lands BEFORE it has been validated. Private, same size and type lock, no policies,
-- never readable by users; the server deletes the object after validating (or rejecting) it, and anything left over
-- is purged when its intent expires.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-quarantine', 'crm-quarantine', false, 20971520, crm_allowed_mime_types())
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Files and links
-- -----------------------------------------------------------------------------
-- Links only. (Files go through crm_create_upload_intent / crm_register_uploaded_file below.)
create or replace function crm_register_file(
  p_opportunity_id uuid,
  p_kind text,
  p_purpose text default 'other',
  p_label text default null,
  p_storage_path text default null,
  p_original_name text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_url text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_id uuid;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  if v.stage = 'lost' then
    raise exception 'A lost opportunity can no longer be updated' using errcode = '23514';
  end if;
  if p_kind <> 'link' then
    raise exception 'Files are added through the upload flow, not here; this records links only' using errcode = '22023';
  end if;
  insert into crm_files (opportunity_id, company_id, kind, label, original_name, storage_path, mime_type, size_bytes,
                         url, purpose, uploaded_by)
  values (v.id, v.company_id, p_kind, nullif(btrim(p_label), ''), p_original_name, p_storage_path, p_mime_type,
          p_size_bytes, p_url, coalesce(p_purpose, 'other'), auth.uid())
  returning id into v_id;
  perform crm_log_event(v.id, v.company_id, 'file', null, p_kind || ': ' || coalesce(nullif(btrim(p_label), ''), p_original_name, p_url));
  return v_id;
end;
$$;

create or replace function crm_create_upload_intent(
  p_opportunity_id uuid,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_safe_name text,
  p_purpose text default 'other',
  p_label text default null
) returns table (intent_id uuid, quarantine_path text)
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_id uuid := gen_random_uuid(); v_final uuid := gen_random_uuid(); v_open integer; v_qpath text;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  if v.stage = 'lost' then
    raise exception 'A lost opportunity can no longer be updated' using errcode = '23514';
  end if;
  if length(coalesce(p_original_name, '')) not between 1 and 200 or crm_file_name_blocked(p_original_name) then
    raise exception 'Executable, script and macro-enabled files cannot be uploaded' using errcode = '22023';
  end if;
  if p_mime_type is null or not (p_mime_type = any (crm_allowed_mime_types())) then
    raise exception 'That file type is not allowed' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 20971520 then
    raise exception 'Files must be between 1 byte and 20 MB' using errcode = '22023';
  end if;
  if p_safe_name is null or p_safe_name !~ '^[A-Za-z0-9._-]{1,150}$' then
    raise exception 'Invalid file name' using errcode = '22023';
  end if;
  if p_purpose not in ('proposal', 'purchase_order', 'authorised_email', 'brief', 'other') then
    raise exception 'Unknown file purpose' using errcode = '22023';
  end if;
  -- A person cannot park an unlimited amount of unvalidated data in quarantine.
  select count(*) into v_open from crm_upload_intents i
   where i.user_id = auth.uid() and i.status in ('pending', 'validated') and i.expires_at > now();
  if v_open >= 20 then
    raise exception 'Too many uploads are waiting. Finish or wait for them to expire, then try again' using errcode = '53400';
  end if;
  v_qpath := v.company_id::text || '/' || v.id::text || '/' || v_id::text || '-' || p_safe_name;
  insert into crm_upload_intents (id, opportunity_id, company_id, user_id, original_name, mime_type, size_bytes, purpose,
                                  label, quarantine_path, final_path)
  values (v_id, v.id, v.company_id, auth.uid(), p_original_name, p_mime_type, p_size_bytes, p_purpose,
          nullif(btrim(p_label), ''), v_qpath,
          v.company_id::text || '/' || v.id::text || '/' || v_final::text || '-' || p_safe_name);
  return query select v_id, v_qpath;
end;
$$;

-- The caller's own intent (used by the server to finish the upload).
create or replace function crm_get_upload_intent(p_intent_id uuid)
returns table (id uuid, opportunity_id uuid, company_id uuid, original_name text, mime_type text, size_bytes bigint,
               purpose text, label text, quarantine_path text, final_path text, status text, expires_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform crm_require_user();
  return query
    select i.id, i.opportunity_id, i.company_id, i.original_name, i.mime_type, i.size_bytes, i.purpose, i.label,
           i.quarantine_path, i.final_path, i.status, i.expires_at
    from crm_upload_intents i
    where i.id = p_intent_id and i.user_id = auth.uid() and crm_has_access(i.company_id);
end;
$$;

-- Service role only: the server records the outcome of validation. Only a pending, unexpired intent can be decided.
create or replace function crm_mark_upload_intent(p_intent_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_status not in ('validated', 'rejected') then raise exception 'Unknown status' using errcode = '22023'; end if;
  update crm_upload_intents i
     set status = p_status, reject_reason = left(p_reason, 300),
         finished_at = case when p_status = 'rejected' then now() else i.finished_at end
   where i.id = p_intent_id and i.status = 'pending' and i.expires_at > now();
  if not found then raise exception 'Upload not found, already decided, or expired' using errcode = 'P0002'; end if;
end;
$$;

-- The caller registers THEIR validated upload. Everything (path, name, type, size, purpose) comes from the intent the
-- server validated, never from the browser; the validated object must exist in the real bucket.
create or replace function crm_register_uploaded_file(p_intent_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare i crm_upload_intents; v crm_opportunities; v_id uuid;
begin
  perform crm_require_user();
  select * into i from crm_upload_intents where id = p_intent_id and user_id = auth.uid() for update;
  if not found then raise exception 'Upload not found' using errcode = 'P0002'; end if;
  if i.status = 'registered' then raise exception 'This upload was already added' using errcode = '23514'; end if;
  if i.status <> 'validated' then
    raise exception 'This upload has not passed the file checks' using errcode = '23514';
  end if;
  v := crm_lock_opportunity(i.opportunity_id);
  if v.stage = 'lost' then
    raise exception 'A lost opportunity can no longer be updated' using errcode = '23514';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'crm-files' and name = i.final_path) then
    raise exception 'The validated file was not found' using errcode = 'P0002';
  end if;
  insert into crm_files (opportunity_id, company_id, kind, label, original_name, storage_path, mime_type, size_bytes,
                         purpose, uploaded_by)
  values (i.opportunity_id, i.company_id, 'file', i.label, i.original_name, i.final_path, i.mime_type, i.size_bytes,
          i.purpose, auth.uid())
  returning id into v_id;
  update crm_upload_intents set status = 'registered', finished_at = now() where id = i.id;
  perform crm_log_event(i.opportunity_id, i.company_id, 'file', null, 'file: ' || coalesce(i.label, i.original_name));
  return v_id;
end;
$$;

-- Service role only (scheduled clean-up). Once an intent is past its expiry (which is also when its one-time upload URL
-- stops working) it is swept exactly once: unfinished intents become 'expired', and the paths it may have left behind
-- are returned for the server to delete: always the quarantine object (a replayed upload URL could have put something
-- there even after the intent finished), and, for a validated-but-never-registered intent, the file in the real bucket.
create or replace function crm_expire_upload_intents()
returns table (quarantine_path text, final_path text, orphaned_validated boolean)
language plpgsql security definer
set search_path = public
as $$
begin
  return query
    with due as (select u.id, u.status from crm_upload_intents u where u.swept_at is null and u.expires_at < now() for update),
         upd as (update crm_upload_intents i
                    set swept_at = now(),
                        status = case when i.status in ('pending', 'validated') then 'expired' else i.status end,
                        finished_at = coalesce(i.finished_at, now())
                   from due where i.id = due.id
                 returning i.id, i.quarantine_path as qp, i.final_path as fp)
    select upd.qp, upd.fp, (due.status = 'validated') from upd join due on due.id = upd.id;
end;
$$;

-- Soft-removes the record. The server deletes the stored object with the service role afterwards.
create or replace function crm_remove_file(p_file_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare f crm_files; v crm_opportunities;
begin
  perform crm_require_user();
  select * into f from crm_files where id = p_file_id and deleted_at is null;
  if not found or not crm_has_access(f.company_id) then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  v := crm_lock_opportunity(f.opportunity_id);
  if f.uploaded_by <> auth.uid() and v.owner_id <> auth.uid() and not crm_is_founder(v.company_id) then
    raise exception 'Only the uploader, the owner or a founder can remove this' using errcode = '42501';
  end if;
  update crm_files set deleted_at = now() where id = p_file_id;
  update crm_proposals set file_id = null where file_id = p_file_id;
  return f.storage_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Proposals ("sent" is a recorded fact and is never the same as "approved" or "accepted")
-- -----------------------------------------------------------------------------
create or replace function crm_add_proposal(p_opportunity_id uuid, p_note text default null, p_file_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_id uuid; v_next integer;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  perform crm_require_owner_or_founder(v);
  if v.stage in ('won', 'lost') then
    raise exception 'A closed opportunity cannot get new proposals' using errcode = '23514';
  end if;
  if p_file_id is not null and not exists (
       select 1 from crm_files where id = p_file_id and opportunity_id = v.id and deleted_at is null) then
    raise exception 'That file does not belong to this opportunity' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from crm_proposals where opportunity_id = v.id;
  insert into crm_proposals (opportunity_id, company_id, version, note, file_id, created_by)
  values (v.id, v.company_id, v_next, nullif(btrim(p_note), ''), p_file_id, auth.uid())
  returning id into v_id;
  perform crm_log_event(v.id, v.company_id, 'proposal', null, 'v' || v_next || ' draft');
  return v_id;
end;
$$;

create or replace function crm_set_proposal_status(p_proposal_id uuid, p_status text, p_sent_on date default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare p crm_proposals; v crm_opportunities;
begin
  perform crm_require_user();
  select * into p from crm_proposals where id = p_proposal_id;
  if not found or not crm_has_access(p.company_id) then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  v := crm_lock_opportunity(p.opportunity_id);
  perform crm_require_owner_or_founder(v);
  if v.stage in ('won', 'lost') and p_status <> 'accepted' then
    raise exception 'A closed opportunity cannot change proposals' using errcode = '23514';
  end if;
  if p_status = 'sent' then
    if p.status not in ('draft', 'sent') then
      raise exception 'Only a draft proposal can be recorded as sent' using errcode = '23514';
    end if;
    if p_sent_on is null or p_sent_on > crm_today_dubai() then
      raise exception 'Give the date it was actually sent (not in the future)' using errcode = '22023';
    end if;
    update crm_proposals set status = 'superseded' where opportunity_id = p.opportunity_id and status = 'sent' and id <> p.id;
    update crm_proposals set status = 'sent', sent_on = p_sent_on where id = p.id;
  elsif p_status = 'accepted' then
    if p.status <> 'sent' then
      raise exception 'Only a sent proposal can be recorded as accepted' using errcode = '23514';
    end if;
    update crm_proposals set status = 'accepted' where id = p.id;
  elsif p_status = 'superseded' then
    update crm_proposals set status = 'superseded' where id = p.id;
  else
    raise exception 'Unknown proposal status' using errcode = '22023';
  end if;
  perform crm_log_event(v.id, v.company_id, 'proposal', p.status, 'v' || p.version || ' ' || p_status);
end;
$$;

create or replace function crm_upsert_zoho_reference(
  p_opportunity_id uuid,
  p_quote_ref text default null, p_quote_sent_on date default null,
  p_invoice_ref text default null, p_invoice_issued_on date default null,
  p_payment_received_on date default null, p_paid_amount numeric default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  perform crm_require_owner_or_founder(v);
  insert into crm_zoho_references (opportunity_id, company_id, quote_ref, quote_sent_on, invoice_ref, invoice_issued_on,
                                   payment_received_on, paid_amount, updated_by)
  values (v.id, v.company_id, nullif(btrim(p_quote_ref), ''), p_quote_sent_on, nullif(btrim(p_invoice_ref), ''),
          p_invoice_issued_on, p_payment_received_on, p_paid_amount, auth.uid())
  on conflict (opportunity_id) do update set
    quote_ref = excluded.quote_ref, quote_sent_on = excluded.quote_sent_on, invoice_ref = excluded.invoice_ref,
    invoice_issued_on = excluded.invoice_issued_on, payment_received_on = excluded.payment_received_on,
    paid_amount = excluded.paid_amount, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- Equipment availability
-- -----------------------------------------------------------------------------
create or replace function crm_request_availability(p_opportunity_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  perform crm_require_owner_or_founder(v);
  if v.stage in ('won', 'lost') then
    raise exception 'A closed opportunity needs no availability check' using errcode = '23514';
  end if;
  update crm_opportunities set availability_state = 'awaiting', availability_requested_by = auth.uid(),
         availability_requested_at = now(), version = version + 1
   where id = v.id;
  perform crm_log_event(v.id, v.company_id, 'availability', v.availability_state, 'awaiting');
end;
$$;

create or replace function crm_confirm_availability(p_opportunity_id uuid, p_state text, p_notes text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  if not crm_has_capability(v.company_id, 'confirm_availability') then
    raise exception 'Only a founder (or someone they delegated) can record equipment availability' using errcode = '42501';
  end if;
  if p_state not in ('confirmed', 'unavailable') then
    raise exception 'State must be confirmed or unavailable' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_notes, ''))) = 0 then
    raise exception 'Add a note: what was checked, or the alternative if unavailable' using errcode = '22023';
  end if;
  if v.stage in ('won', 'lost') then
    raise exception 'A closed opportunity needs no availability check' using errcode = '23514';
  end if;
  update crm_opportunities set availability_state = p_state, availability_by = auth.uid(), availability_at = now(),
         availability_notes = btrim(p_notes),
         availability_covers = jsonb_build_object('install_start', install_start, 'event_start', event_start,
                                                  'event_end', event_end, 'technologies', technologies),
         version = version + 1
   where id = v.id;
  perform crm_log_event(v.id, v.company_id, 'availability', v.availability_state, p_state, btrim(p_notes));
end;
$$;

-- -----------------------------------------------------------------------------
-- Commercial approval. Default policy is 'not_configured': nothing may be requested or decided.
-- -----------------------------------------------------------------------------
create or replace function crm_request_approval(p_opportunity_id uuid, p_proposal_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities; v_policy text; v_id uuid;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  perform crm_require_owner_or_founder(v);
  select approval_policy into v_policy from crm_company_settings where company_id = v.company_id;
  if coalesce(v_policy, 'not_configured') = 'not_configured' then
    raise exception 'Commercial approval rules are not configured for this company. Nothing can be approved yet.'
      using errcode = '23514';
  elsif v_policy = 'not_required' then
    raise exception 'The founders decided commercial approval is not required for this company' using errcode = '23514';
  end if;
  if exists (select 1 from crm_approvals where opportunity_id = v.id and state = 'pending') then
    raise exception 'An approval request is already waiting for a decision' using errcode = '23514';
  end if;
  if p_proposal_id is not null and not exists (select 1 from crm_proposals where id = p_proposal_id and opportunity_id = v.id) then
    raise exception 'That proposal does not belong to this opportunity' using errcode = '22023';
  end if;
  insert into crm_approvals (opportunity_id, company_id, proposal_id, requested_by)
  values (v.id, v.company_id, p_proposal_id, auth.uid()) returning id into v_id;
  perform crm_log_event(v.id, v.company_id, 'approval', null, 'requested');
  return v_id;
end;
$$;

create or replace function crm_decide_approval(p_approval_id uuid, p_state text, p_instruction text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare a crm_approvals; v_policy text;
begin
  perform crm_require_user();
  select * into a from crm_approvals where id = p_approval_id;
  if not found or not crm_has_access(a.company_id) then
    raise exception 'Approval request not found' using errcode = 'P0002';
  end if;
  if not crm_is_founder(a.company_id) then
    raise exception 'Only a founder can decide a commercial approval' using errcode = '42501';
  end if;
  select approval_policy into v_policy from crm_company_settings where company_id = a.company_id;
  if coalesce(v_policy, 'not_configured') <> 'required' then
    raise exception 'Commercial approval rules are not configured for this company. Nothing can be approved yet.'
      using errcode = '23514';
  end if;
  if a.state <> 'pending' then raise exception 'This request has already been decided' using errcode = '23514'; end if;
  if p_state not in ('approved', 'changes_requested') then
    raise exception 'Decision must be approved or changes_requested' using errcode = '22023';
  end if;
  if p_state = 'changes_requested' and length(btrim(coalesce(p_instruction, ''))) = 0 then
    raise exception 'Say what needs to change' using errcode = '22023';
  end if;
  update crm_approvals set state = p_state, decided_by = auth.uid(), decided_at = now(),
         instruction = nullif(btrim(p_instruction), '')
   where id = a.id;
  perform crm_log_event(a.opportunity_id, a.company_id, 'approval', 'pending', p_state, nullif(btrim(p_instruction), ''));
end;
$$;

-- -----------------------------------------------------------------------------
-- Handover to the Project Manager (record of readiness; the Projects module will consume it later)
-- -----------------------------------------------------------------------------
create or replace function crm_update_handover(
  p_opportunity_id uuid, p_status text, p_pm_user_id uuid default null, p_notes text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare v crm_opportunities;
begin
  v := crm_lock_opportunity(p_opportunity_id);
  perform crm_require_owner_or_founder(v);
  if v.stage <> 'won' then
    raise exception 'Handover is only available once the opportunity is Won' using errcode = '23514';
  end if;
  if p_status not in ('draft', 'ready', 'handed_over') then
    raise exception 'Unknown handover status' using errcode = '22023';
  end if;
  if p_status = 'handed_over' and p_pm_user_id is null then
    raise exception 'Choose the Project Manager before handing over' using errcode = '22023';
  end if;
  if p_pm_user_id is not null and not exists (select 1 from profiles where id = p_pm_user_id and is_active) then
    raise exception 'That Project Manager is not an active user' using errcode = '22023';
  end if;
  insert into crm_handovers (opportunity_id, company_id) values (v.id, v.company_id) on conflict do nothing;
  update crm_handovers set
    status = p_status,
    pm_user_id = p_pm_user_id,
    notes = nullif(btrim(p_notes), ''),
    prepared_by = case when p_status in ('ready', 'handed_over') then auth.uid() else prepared_by end,
    prepared_at = case when p_status in ('ready', 'handed_over') then coalesce(prepared_at, now()) else prepared_at end,
    handed_over_at = case when p_status = 'handed_over' then coalesce(handed_over_at, now()) else null end
  where opportunity_id = v.id;
  perform crm_log_event(v.id, v.company_id, 'handover', null, p_status);
end;
$$;

-- -----------------------------------------------------------------------------
-- Reminders
-- -----------------------------------------------------------------------------
create or replace function crm_mark_reminder_read(p_reminder_id uuid default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  perform crm_require_user();
  update crm_reminders set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_reminder_id is null or id = p_reminder_id);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Scheduled job (service role only). Idempotent: dedupe_key is unique, so running twice, or overlapping runs,
-- create nothing new. Recipients must still hold CRM access to the company. Email is only queued when the company
-- setting is on; sending, retries and backoff happen in crm_claim_reminder_emails / crm_finish_reminder_email.
create or replace function crm_generate_reminders(p_now timestamptz default now())
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  n integer := 0;
  c integer;
  v_today date := (p_now at time zone 'Asia/Dubai')::date;
begin
  -- 1. Follow-ups that have fallen due.
  insert into crm_reminders (user_id, company_id, opportunity_id, follow_up_id, kind, title, due_at, dedupe_key,
                             email_status, email_next_attempt_at)
  select f.assigned_to, f.company_id, f.opportunity_id, f.id, 'follow_up_due', f.title, f.due_at,
         'fu:' || f.id || ':due:' || to_char(f.due_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI'),
         case when coalesce(s.owner_email_enabled, false) then 'pending' else 'not_requested' end,
         case when coalesce(s.owner_email_enabled, false) then p_now end
  from crm_follow_ups f
  join crm_opportunities o on o.id = f.opportunity_id and o.stage not in ('won', 'lost')
  left join crm_company_settings s on s.company_id = f.company_id
  where f.status = 'open' and f.due_at <= p_now and crm_user_has_company_access(f.assigned_to, f.company_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 2. Follow-ups more than a day overdue: a second, louder reminder to the opportunity owner.
  insert into crm_reminders (user_id, company_id, opportunity_id, follow_up_id, kind, title, due_at, dedupe_key,
                             email_status, email_next_attempt_at)
  select o.owner_id, f.company_id, f.opportunity_id, f.id, 'follow_up_overdue', f.title, f.due_at,
         'fu:' || f.id || ':overdue:' || to_char(f.due_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI'),
         case when coalesce(s.owner_email_enabled, false) then 'pending' else 'not_requested' end,
         case when coalesce(s.owner_email_enabled, false) then p_now end
  from crm_follow_ups f
  join crm_opportunities o on o.id = f.opportunity_id and o.stage not in ('won', 'lost')
  left join crm_company_settings s on s.company_id = f.company_id
  where f.status = 'open' and f.due_at <= p_now - interval '24 hours' and crm_user_has_company_access(o.owner_id, f.company_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 3. Holds whose review date has arrived.
  insert into crm_reminders (user_id, company_id, opportunity_id, kind, title, due_at, dedupe_key,
                             email_status, email_next_attempt_at)
  select o.owner_id, o.company_id, o.id, 'hold_review_due', 'Review the hold on ' || o.reference, o.hold_review_date::timestamptz,
         'hold:' || o.id || ':' || o.hold_review_date,
         case when coalesce(s.owner_email_enabled, false) then 'pending' else 'not_requested' end,
         case when coalesce(s.owner_email_enabled, false) then p_now end
  from crm_opportunities o
  left join crm_company_settings s on s.company_id = o.company_id
  where o.stage = 'on_hold' and o.hold_review_date <= v_today and crm_user_has_company_access(o.owner_id, o.company_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 4. Active opportunities with no open follow-up (should not happen; this makes it visible once per day).
  insert into crm_reminders (user_id, company_id, opportunity_id, kind, title, dedupe_key,
                             email_status, email_next_attempt_at)
  select o.owner_id, o.company_id, o.id, 'no_next_action', o.reference || ' has no next action',
         'noaction:' || o.id || ':' || v_today,
         case when coalesce(s.owner_email_enabled, false) then 'pending' else 'not_requested' end,
         case when coalesce(s.owner_email_enabled, false) then p_now end
  from crm_opportunities o
  left join crm_company_settings s on s.company_id = o.company_id
  where o.stage in ('new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation')
    and not exists (select 1 from crm_follow_ups f where f.opportunity_id = o.id and f.status = 'open')
    and crm_user_has_company_access(o.owner_id, o.company_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Reminders that no longer apply (follow-up done, cancelled or rescheduled) stop being emailed.
  update crm_reminders r set email_status = 'skipped', email_next_attempt_at = null
   where r.email_status in ('pending', 'failed') and r.kind in ('follow_up_due', 'follow_up_overdue')
     and not exists (select 1 from crm_follow_ups f where f.id = r.follow_up_id and f.status = 'open');
  return n;
end;
$$;

-- Claim a batch of reminder emails to send. Pushes next_attempt_at forward at claim time so an overlapping run
-- cannot claim (and so cannot double-send) the same row. Rows are only ever sent to the opportunity's own staff.
create or replace function crm_claim_reminder_emails(p_limit integer default 25, p_now timestamptz default now())
returns table (reminder_id uuid, recipient_email text, recipient_name text, title text, kind text,
               opportunity_reference text, opportunity_title text, due_at timestamptz, attempt integer)
language plpgsql security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select r.id from crm_reminders r
    where r.email_status in ('pending', 'failed') and r.email_attempts < 5
      and r.email_next_attempt_at is not null and r.email_next_attempt_at <= p_now
    order by r.email_next_attempt_at
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  ), bumped as (
    update crm_reminders r
       set email_attempts = r.email_attempts + 1,
           email_next_attempt_at = p_now + interval '15 minutes'
      from claimed where r.id = claimed.id
    returning r.id, r.user_id, r.title, r.kind, r.opportunity_id, r.due_at, r.email_attempts
  )
  select b.id, p.email, p.full_name, b.title, b.kind, o.reference, o.title, b.due_at, b.email_attempts
  from bumped b
  join profiles p on p.id = b.user_id
  join crm_opportunities o on o.id = b.opportunity_id;
end;
$$;

create or replace function crm_finish_reminder_email(p_reminder_id uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare r crm_reminders;
begin
  select * into r from crm_reminders where id = p_reminder_id for update;
  if not found or r.email_status = 'sent' then return; end if;     -- never overwrite a sent row
  if p_ok then
    update crm_reminders set email_status = 'sent', email_sent_at = now(), email_next_attempt_at = null,
           email_last_error = null where id = r.id;
  else
    update crm_reminders set email_status = 'failed', email_last_error = left(coalesce(p_error, 'unknown error'), 500),
           -- 15 min, 1 h, 4 h, 12 h, then stop (attempts is already incremented at claim time).
           email_next_attempt_at = case when r.email_attempts >= 5 then null
             else now() + (array[interval '15 minutes', interval '1 hour', interval '4 hours', interval '12 hours', interval '12 hours'])[least(r.email_attempts, 5)] end
     where id = r.id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- People pickers. Sales needs names (owner, assignee, Project Manager) without being given read access to the HR
-- tables. crm_people lists holders of an active CRM grant in companies the caller can access; crm_staff_directory
-- lists active staff (names only) for the Project Manager and access pickers. Email addresses are returned only to a
-- founder, who needs them to tell two people apart when granting access.
-- -----------------------------------------------------------------------------
create or replace function crm_people()
returns table (user_id uuid, full_name text, email text, company_ids uuid[])
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform crm_require_user();
  if not crm_has_any_access() then return; end if;
  return query
    select g.user_id, p.full_name, case when crm_is_any_founder() then p.email end, array_agg(distinct g.company_id)
    from crm_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.revoked_at is null and crm_has_access(g.company_id)
    group by g.user_id, p.full_name, p.email
    order by p.full_name nulls last;
end;
$$;

create or replace function crm_staff_directory()
returns table (user_id uuid, full_name text, email text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform crm_require_user();
  if not crm_has_any_access() then return; end if;
  return query
    select p.id, p.full_name, case when crm_is_any_founder() then p.email end
    from profiles p where p.is_active
    order by p.full_name nulls last, p.email;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  crm_register_file(uuid, text, text, text, text, text, text, bigint, text), crm_remove_file(uuid),
  crm_create_upload_intent(uuid, text, text, bigint, text, text, text), crm_get_upload_intent(uuid),
  crm_mark_upload_intent(uuid, text, text), crm_register_uploaded_file(uuid), crm_expire_upload_intents(),
  crm_add_proposal(uuid, text, uuid), crm_set_proposal_status(uuid, text, date),
  crm_upsert_zoho_reference(uuid, text, date, text, date, date, numeric),
  crm_request_availability(uuid), crm_confirm_availability(uuid, text, text),
  crm_request_approval(uuid, uuid), crm_decide_approval(uuid, text, text),
  crm_update_handover(uuid, text, uuid, text), crm_mark_reminder_read(uuid), crm_people(), crm_staff_directory(),
  crm_generate_reminders(timestamptz), crm_claim_reminder_emails(integer, timestamptz),
  crm_finish_reminder_email(uuid, boolean, text)
  from public, anon, authenticated;

grant execute on function
  crm_register_file(uuid, text, text, text, text, text, text, bigint, text), crm_remove_file(uuid),
  crm_create_upload_intent(uuid, text, text, bigint, text, text, text), crm_get_upload_intent(uuid),
  crm_register_uploaded_file(uuid),
  crm_add_proposal(uuid, text, uuid), crm_set_proposal_status(uuid, text, date),
  crm_upsert_zoho_reference(uuid, text, date, text, date, date, numeric),
  crm_request_availability(uuid), crm_confirm_availability(uuid, text, text),
  crm_request_approval(uuid, uuid), crm_decide_approval(uuid, text, text),
  crm_update_handover(uuid, text, uuid, text), crm_mark_reminder_read(uuid), crm_people(), crm_staff_directory()
  to authenticated;

-- Scheduled-job functions: the service role only (never reachable from a browser session).
grant execute on function
  crm_generate_reminders(timestamptz), crm_claim_reminder_emails(integer, timestamptz),
  crm_finish_reminder_email(uuid, boolean, text), crm_mark_upload_intent(uuid, text, text), crm_expire_upload_intents()
  to service_role;

-- ROLLBACK (before any CRM data exists): drop the functions above with `drop function if exists`, then
--   delete from storage.buckets where id in ('crm-files', 'crm-quarantine');   -- only if both buckets are empty
