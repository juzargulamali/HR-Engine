-- ROLLBACK for 20270113000100_proj_handover_parties.sql. Deploy the app from before this change FIRST (the new app reads these functions; without them it shows the handover
-- as it did before, so the order is a preference, not a requirement).
-- It DELETES what Sales recorded with the new fields: the agency / direct-job record on every handover and every chosen site contact copy. Export them first if you want them:
--   select id, crm_reference, job_type, agency_name, parties_recorded_at from proj_handovers where parties_recorded_at is not null;
--   select * from proj_handover_site_contacts;
-- It deletes no handover, project, enquiry or Sales contact, and replaces no existing function. Safe to run twice.
drop trigger if exists trg_proj_handover_site_contact_refresh on proj_handovers;
drop trigger if exists trg_proj_handover_parties_copy on proj_handovers;
drop function if exists proj_project_handover(uuid);
drop function if exists proj_handover_parties(uuid);
drop function if exists proj_set_handover_site_contact(uuid, uuid);
drop function if exists proj_handover_site_contact_refresh();
drop function if exists proj_handover_site_contact_take(uuid, uuid, uuid);
drop function if exists proj_handover_site_contact_json(uuid);
drop table if exists proj_handover_site_contacts;
drop function if exists proj_handover_site_contact_frozen();
drop function if exists proj_handover_parties_copy();
-- Dropping a column is not an UPDATE, so the trigger that freezes accepted handovers does not object and their other fields are untouched.
alter table proj_handovers drop constraint if exists proj_handovers_job_type;
alter table proj_handovers drop column if exists job_type;
alter table proj_handovers drop column if exists agency_org_id;
alter table proj_handovers drop column if exists agency_name;
alter table proj_handovers drop column if exists parties_recorded_at;
