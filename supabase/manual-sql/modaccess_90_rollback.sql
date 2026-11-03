-- WRITES (one function definition is dropped; no table, row, policy or other privilege is touched). OWNER-RUN ROLLBACK of 20261216000910_module_access_managers.sql.
--
-- WHEN TO USE IT: only if the new function causes a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back means a denied person is shown the generic "ask someone who manages access" wording again, or "could not load who can grant access" (the
-- application treats a missing function as a failed read, never as "nobody"); access itself is unaffected.
--
-- It is safe to run twice. Afterwards modaccess_20_verify_readonly.sql reports the function as missing (that is how it tells you the old state is back).

begin;

drop function if exists module_access_managers(text);

commit;
