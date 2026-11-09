-- WRITES. OWNER-RUN ROLLBACK of 20261224000100_crm_events_outreach.sql. Safe to run twice. EXPORT the four things below FIRST (they are deleted):
--   crm_events, crm_event_editions, crm_event_observations, and the columns crm_organisations.outreach_priority / _by / _at and crm_opportunities.event_edition_id.
-- It does NOT touch any enquiry, organisation, contact, follow-up, estimate or outreach row other than clearing the new columns, and it does not touch the earlier
-- migrations or JARVIS. Nothing here is needed to roll the APP back: the previous app simply ignores the new columns and tables.
do $$ declare n integer;
begin
  if to_regclass('public.crm_opportunities') is not null and exists (select 1 from information_schema.columns where table_name = 'crm_opportunities' and column_name = 'event_edition_id') then
    select count(*) into n from crm_opportunities where event_edition_id is not null;
    raise notice 'enquiries whose event link is removed by this rollback: %', n;
  end if;
  if to_regclass('public.crm_event_observations') is not null then
    select count(*) into n from crm_event_observations;
    raise notice 'observations deleted by this rollback: %', n;
  end if;
end $$;
begin;
drop function if exists crm_set_opportunity_edition(uuid, uuid, integer);
drop function if exists crm_remove_observation(uuid);
drop function if exists crm_update_observation(uuid, text, uuid, boolean, text, text, text, text);
drop function if exists crm_record_observation(uuid, uuid, text, uuid, boolean, text, text, text, text);
drop function if exists crm_observation_check(text, uuid, uuid, boolean, text, text, text);
drop function if exists crm_remove_event(uuid);
drop function if exists crm_remove_edition(uuid);
drop function if exists crm_edition_in_use(uuid);
drop function if exists crm_save_edition(uuid, uuid, date, date, text, text, text, text);
drop function if exists crm_save_event(uuid, text, text, text, text);
drop function if exists crm_can_edit_event_record(uuid);
drop function if exists crm_set_outreach_priority(uuid, integer);
drop index if exists idx_crm_opp_edition;
alter table crm_opportunities drop column if exists event_edition_id;
drop table if exists crm_event_observations;
drop table if exists crm_event_editions;
drop table if exists crm_events;
drop index if exists idx_crm_organisations_priority;
alter table crm_organisations drop column if exists outreach_priority_at;
alter table crm_organisations drop column if exists outreach_priority_by;
alter table crm_organisations drop column if exists outreach_priority;
commit;
