-- WRITES (two function definitions are dropped; no table, row, policy or other privilege is touched). OWNER-RUN ROLLBACK of 20261216000820_proj_scope_decision_context.sql.
--
-- WHEN TO USE IT: only if the new functions cause a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back means a holder of scope approval who is not a founder or a member of the project can again decide a proposal only by calling the decision
-- function blind, and My Day / the decision page can no longer show them what is waiting (the application then says it could not load that part; it never shows a false zero).
-- Who may decide, the decision function and every table are untouched either way.
--
-- It is safe to run twice. Afterwards scopectx_20_verify_readonly.sql reports the functions as missing (that is how it tells you the old state is back).

begin;

drop function if exists proj_scope_decisions_waiting();
drop function if exists proj_scope_decision_context(uuid);

commit;
