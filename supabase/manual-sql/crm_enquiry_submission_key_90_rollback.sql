-- ROLLBACK for 20270112000400_crm_enquiry_submission_key.sql. Either app version works afterwards: the new app falls back to the existing create function when this one is
-- missing (a save whose answer was lost can then create a second enquiry again when it is retried, as before this change).
-- It drops the function and the table of identifiers (which enquiry each form submission created). It deletes no enquiry. Safe to run twice.
drop function if exists crm_create_enquiry(jsonb, uuid, uuid);
drop table if exists crm_enquiry_submissions;
-- The JSON helper is shared with 20270112000300 (outreach conversion): it goes only when that migration is not installed.
do $$
begin
  if to_regprocedure('public.crm_create_enquiry_from_outreach(uuid, jsonb)') is null then
    drop function if exists crm_create_opportunity_json(jsonb);
  end if;
end $$;
