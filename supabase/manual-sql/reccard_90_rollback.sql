-- WRITES (one function dropped; no row is touched). OWNER-RUN ROLLBACK of 20261216000600_recovery_decider_inbox.sql.
--
-- WHEN TO USE IT: only if the change causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back means a project lead sees the applicant's name as a dash again and a CEO / CTO deciding an HR Admin's request on the shared queue gets no card (the Approvals page then shows
-- nothing for them, as before; the page treats a missing function as a failed read and says so).
--
-- It is safe to run twice. Afterwards the matching *_20_verify_readonly.sql reports the new rules as missing (that is how it tells you the old state is back), or run the
-- *_05_preservation_check_readonly.sql against your BEFORE snapshot (the changed items then say UNCHANGED / MISSING).


begin;

drop function if exists recovery_decider_inbox(uuid[]);

commit;
