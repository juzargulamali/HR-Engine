-- WRITES. OWNER-RUN ROLLBACK of 20261223000100_jarvis_platform.sql. Safe to run twice (the second run finds nothing to drop and says so).
-- It drops every jarvis_* function (the access check, the usage counter, the wrappers and their helpers) and the five jarvis_* tables: JARVIS then shows as unavailable for everyone and every other part of the app is unaffected.
-- It touches NO enquiry, follow-up, timeline event, organisation or grant. Enquiries already created through JARVIS stay exactly as they are (their timeline line
-- "Created through JARVIS ..." is an ordinary event row and stays).
-- WHAT IS LOST: the action ledger (who approved which action, when, and the enquiry reference it created), the pilot allowlist, the switches and the daily usage counters.
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

drop function if exists jarvis_register_organisation(uuid, text, jsonb);
drop function if exists jarvis_ledger_fail(uuid, text, text);
drop function if exists jarvis_ledger_done(uuid, uuid, text, jsonb);
drop function if exists jarvis_ledger_enter(uuid, text, text, uuid, text);
drop function if exists jarvis_ledger_json(jarvis_action_ledger, boolean);
drop function if exists jarvis_create_enquiry(uuid, text, jsonb);
drop function if exists jarvis_usage_take(integer);
drop function if exists jarvis_my_access(uuid);
drop table if exists jarvis_usage;
drop table if exists jarvis_action_ledger;
drop table if exists jarvis_pilot_companies;
drop table if exists jarvis_pilot_users;
drop table if exists jarvis_settings;

commit;
select 'jarvis_* functions and tables dropped (or were already absent)' as result;
