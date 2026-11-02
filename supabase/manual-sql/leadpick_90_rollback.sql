-- WRITES (one function dropped; no row is touched). OWNER-RUN ROLLBACK of 20261216000500_attendance_lead_candidates.sql.
--
-- WHEN TO USE IT: only if the change causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back means the attendance clock's Project lead picker lists only the person themself for an ordinary employee again (the application change in the same release then shows an empty picker and
-- says it could not load: deploy the application version from before it, or keep the function).
--
-- It is safe to run twice. Afterwards the matching *_20_verify_readonly.sql reports the new rules as missing (that is how it tells you the old state is back), or run the
-- *_05_preservation_check_readonly.sql against your BEFORE snapshot (the changed items then say UNCHANGED / MISSING).


begin;

drop function if exists attendance_lead_candidates();

commit;
