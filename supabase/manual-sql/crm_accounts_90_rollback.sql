-- WRITES. OWNER-RUN ROLLBACK of 20261219000100_crm_clients_agencies.sql. Safe to run twice.
-- READ THIS FIRST: this DELETES every account owner, lead source and exhibition recorded in crm_account_profiles, and the roles, countries and websites
-- recorded on organisations. Export them first (select * from crm_account_profiles; select id, name, roles, country_code, website from crm_organisations).
-- Follow-ups that were reassigned stay as they are (they are ordinary rows). Organisations keep their legacy `kind`.
begin;
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
