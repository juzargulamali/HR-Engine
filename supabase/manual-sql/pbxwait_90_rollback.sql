-- WRITES (one function definition is dropped; no table, row, policy or other privilege is touched). OWNER-RUN ROLLBACK of 20261216000830_pbx_decisions_waiting_count.sql.
--
-- WHEN TO USE IT: only if the new function causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back means the Finance menu entry shows no "waiting for your decision" number (the application treats a missing function as "no number" and says
-- nothing); the Finance inbox and My Day are unaffected.
--
-- It is safe to run twice. Afterwards pbxwait_20_verify_readonly.sql reports the function as missing (that is how it tells you the old state is back).

begin;

drop function if exists pbx_decisions_waiting_count();

commit;
