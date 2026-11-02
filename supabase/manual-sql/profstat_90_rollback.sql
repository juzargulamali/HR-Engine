-- WRITES (one table's SELECT privilege and one function; no row is touched). OWNER-RUN ROLLBACK of 20261216000400_profiles_status_columns_restricted.sql.
--
-- WHEN TO USE IT: only if the change causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back lets EVERY signed-in user read the deactivation reason, who recorded it and when, again (the exposure D-11 describes). Nothing else changes.
--
-- It is safe to run twice. Afterwards the matching *_20_verify_readonly.sql reports the new rules as missing (that is how it tells you the old state is back), or run the
-- *_05_preservation_check_readonly.sql against your BEFORE snapshot (the changed items then say UNCHANGED / MISSING).
-- Supabase's own default for a public table is SELECT, INSERT, UPDATE and DELETE for anon and authenticated; this restores the SELECT part of that default.

begin;

grant select on table profiles to anon, authenticated;
drop function if exists account_status_details(uuid);

commit;
