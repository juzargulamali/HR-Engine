-- ROLLBACK for 20270113000300_crm_outreach_conversion.sql. Deploy the app from before this change FIRST: the new app offers the Outreach source and the contact choice.
-- It STOPS while any enquiry has the source 'outreach': the old check does not accept that value and this script will not guess a different source for a real enquiry.
-- Decide with the owner what each one should read (for example Agency call or Other), change it in the app (Edit details), then run this again. To list them:
--   select reference, title from crm_opportunities where source = 'outreach' order by reference;
-- It deletes the contact chosen on each outreach (export first: select id, contact_id from crm_outreach where contact_id is not null). It deletes no enquiry and no
-- outreach, and leaves every link between them. Safe to run twice.
do $$
declare v integer;
begin
  select count(*) into v from crm_opportunities where source = 'outreach';
  if v > 0 then
    raise exception 'STOP: % enquiry(ies) have the source Outreach. Give each a source the earlier version accepts, then run this again', v;
  end if;
end $$;

drop trigger if exists trg_crm_outreach_one_enquiry on crm_outreach;
drop function if exists crm_outreach_one_enquiry();
drop function if exists crm_create_enquiry_from_outreach(uuid, jsonb);
drop function if exists crm_outreach_set_contact(uuid, uuid);
-- The JSON helper is shared with 20270113000400 (the submission identifier): it goes only when that migration is not installed.
do $$
begin
  if to_regprocedure('public.crm_create_enquiry(jsonb, uuid, uuid)') is null then
    drop function if exists crm_create_opportunity_json(jsonb);
  end if;
end $$;
alter table crm_outreach drop column if exists contact_id;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.crm_opportunities'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%agency_call%' loop
    execute format('alter table crm_opportunities drop constraint %I', c.conname);
  end loop;
  alter table crm_opportunities add constraint crm_opportunities_source_check check (source in (
    'agency_call', 'linkedin', 'direct_client', 'whatsapp', 'instagram', 'website', 'referral', 'other'));
end $$;
