-- WRITES. OWNER-RUN ROLLBACK of 20261223000100_jarvis_platform.sql. Safe to run twice (the second run finds nothing to drop and says so).
-- It drops every jarvis_* function (the access check, the usage counter, the wrappers, their helpers and the proof check) and the six jarvis_* tables, THE CONFIRMATION PROOF KEY INCLUDED: JARVIS then shows as unavailable for everyone and every other part of the app is unaffected.
-- It touches NO enquiry, follow-up, timeline event, organisation or grant. Enquiries already created through JARVIS stay exactly as they are (their timeline line
-- "Created through JARVIS ..." is an ordinary event row and stays).
-- WHAT IS LOST: the action ledger (who approved which action, when, and the enquiry reference it created), the pilot allowlist, the switches, the daily usage counters and the proof key stored in the database
-- (the secret itself is not lost: it still lives in the app's JARVIS_CONFIRMATION_SECRET; after a re-apply the owner sets it again with jarvis_set_proof_key, see docs/jarvis-deployment.md).
-- THEREFORE: if jarvis_action_ledger has any row, this script REFUSES to run until you have exported it. Export it (SQL Editor: select * from jarvis_action_ledger, download as CSV), then add this line ABOVE "begin;" and run the file again:
--     select set_config('jarvis.confirm_ledger_exported', 'yes', false);
begin;

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.jarvis_action_ledger') is not null then
    execute 'select count(*) from public.jarvis_action_ledger' into v_rows;
  end if;
  if v_rows > 0 and coalesce(current_setting('jarvis.confirm_ledger_exported', true), '') <> 'yes' then
    raise exception 'jarvis_action_ledger has rows. Export it first, then run: select set_config(''jarvis.confirm_ledger_exported'', ''yes'', false); above "begin;" and run this file again.';
  end if;
end $$;

-- Current signatures first (and the earlier, eight-argument register-organisation signature that carried the unsigned acknowledgement), then the signatures of the earlier draft of this migration (never applied hosted; dropped here only so a database that ever had them is left clean).
drop function if exists jarvis_record_meeting(uuid, uuid, text, integer, bigint, text, text);
drop function if exists jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text);
drop function if exists jarvis_update_enquiry(uuid, uuid, text, integer, bigint, text, text);
drop function if exists jarvis_register_organisation(uuid, uuid, text, integer, bigint, text, text);
drop function if exists jarvis_register_organisation(uuid, uuid, text, integer, bigint, text, text, jsonb);
drop function if exists jarvis_create_enquiry(uuid, uuid, text, integer, bigint, text, text);
drop function if exists jarvis_verify_proof(text, uuid, uuid, text, integer, bigint, text, text);
drop function if exists jarvis_set_proof_key(text);
drop function if exists jarvis_hmac_sha256(bytea, bytea);
drop function if exists jarvis_record_meeting(uuid, text, uuid, jsonb, jsonb);
drop function if exists jarvis_change_stage(uuid, text, uuid, text, integer);
drop function if exists jarvis_update_enquiry(uuid, text, uuid, integer, jsonb);
drop function if exists jarvis_register_organisation(uuid, text, jsonb);
drop function if exists jarvis_create_enquiry(uuid, text, jsonb);
drop function if exists jarvis_ledger_fail(uuid, text, text);
drop function if exists jarvis_ledger_done(uuid, uuid, text, jsonb);
drop function if exists jarvis_ledger_enter(uuid, text, text, uuid, text);
drop function if exists jarvis_ledger_json(jarvis_action_ledger, boolean);
drop function if exists jarvis_usage_take(integer);
drop function if exists jarvis_my_access(uuid);
drop table if exists jarvis_proof_key;
drop table if exists jarvis_usage;
drop table if exists jarvis_action_ledger;
drop table if exists jarvis_pilot_companies;
drop table if exists jarvis_pilot_users;
drop table if exists jarvis_settings;

commit;
select 'jarvis_* functions and tables dropped (or were already absent)' as result;
