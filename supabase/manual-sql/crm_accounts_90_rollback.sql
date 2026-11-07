-- WRITES. OWNER-RUN ROLLBACK of 20261219000100_crm_clients_agencies.sql (the whole migration, including the import safety, role check and account follow-ups). Safe to run twice.
-- READ THIS FIRST: this DELETES every account owner, lead source and exhibition recorded in crm_account_profiles, and the roles, countries and websites
-- recorded on organisations. Export them first (select * from crm_account_profiles; select id, name, roles, country_code, website from crm_organisations).
-- It also DELETES follow-ups that hang off an account with no inquiry (export: select * from crm_follow_ups where opportunity_id is null) and the import batch
-- records (select * from crm_import_batches). Follow-ups that were reassigned stay as they are (they are ordinary rows). Organisations keep their legacy `kind`.
begin;
drop trigger if exists crm_opportunities_party_roles on crm_opportunities;
drop function if exists crm_opportunities_check_party_roles();
drop function if exists crm_organisation_roles(uuid);
drop function if exists crm_import_apply(uuid, text, jsonb);
drop function if exists crm_import_apply_item(uuid, jsonb);
drop function if exists crm_import_fingerprints(uuid, jsonb);
drop function if exists crm_import_fingerprint(uuid, text, text);
drop function if exists crm_import_candidates(text, text);
drop function if exists crm_import_clean_contacts(jsonb);
drop function if exists crm_import_domain(text);
drop function if exists crm_import_name_key(text);
drop table if exists crm_import_batches;
drop index if exists uq_crm_contacts_org_email;
drop function if exists crm_create_account_follow_up(uuid, uuid, text, timestamptz, text, uuid);
delete from crm_reminders where follow_up_id in (select id from crm_follow_ups where opportunity_id is null);
delete from crm_follow_ups where opportunity_id is null;
drop function if exists crm_require_account_follow_up_actor(crm_follow_ups);
alter table crm_follow_ups drop constraint if exists crm_follow_ups_target;
drop index if exists idx_crm_follow_ups_org;
alter table crm_follow_ups drop column if exists organisation_id;
alter table crm_follow_ups alter column opportunity_id set not null;
-- Restore the three follow-up functions exactly as 20261115000200_crm_workflow_functions.sql defined them.
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
drop function if exists crm_reassign_follow_up(uuid, uuid);
drop function if exists crm_assign_account_owner(uuid, uuid, uuid, text);
drop function if exists crm_save_account_profile(uuid, uuid, jsonb);
drop function if exists crm_update_organisation(uuid, jsonb);
drop function if exists crm_create_organisation_profile(text, text[], text, text, text, text, uuid, text, text, uuid, jsonb);
drop function if exists crm_can_edit_organisation(uuid, uuid);
drop table if exists crm_account_profiles;
drop trigger if exists crm_organisations_sync_kind on crm_organisations;
drop function if exists crm_organisations_sync_kind();
alter table crm_organisations drop constraint if exists crm_organisations_roles_valid;
alter table crm_organisations drop constraint if exists crm_organisations_country_format;
alter table crm_organisations drop column if exists website_domain;
alter table crm_organisations drop column if exists website;
alter table crm_organisations drop column if exists country_code;
alter table crm_organisations drop column if exists roles;
-- Restore the creator exactly as 20261115000200_crm_workflow_functions.sql defined it.
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
commit;
