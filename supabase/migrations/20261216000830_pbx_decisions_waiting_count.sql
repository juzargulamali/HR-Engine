-- A cheap "waiting for your decision" count for the Finance menu entry (completion pass, A8 leftover). ADDITIVE: adds one read-only function; no table, column, policy, trigger
-- or privilege on anything existing changes, and no data changes.
--
-- WHY. The Finance menu entry should show how many project budgets and final-expense sets wait for the person to decide, without making every page load run pbx_inbox(): that
-- function also computes settlement figures and blockers for every open budget of every company the person can read, which is far too much work for a menu badge.
--
-- WHAT. pbx_decisions_waiting_count() returns ONE number: the submitted budget versions plus the submitted final-expense sets that the caller may decide NOW. It uses exactly the
-- predicates pbx_inbox() uses for its two approval lists (company accessible to the caller, pbx_can_decide = the route's capability and not the person who prepared or submitted it,
-- and not on hold because nobody else could decide it), so the number equals the count of rows that pbx_inbox() marks i_can_decide and not on_hold. Not counted: settlement follow-ups
-- (receipts to confirm, ready to close); they stay in the inbox and on My Day. A person who cannot decide anything gets 0, a signed-out caller is refused.
-- The function returns a number only: no project, amount, name or company. Who may decide, every approval function and every other read are unchanged.
-- Rollback: supabase/manual-sql/pbxwait_90_rollback.sql drops the function.

create or replace function pbx_decisions_waiting_count()
returns integer
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform pbx_require_user();
  select
    (select count(*) from pbx_budget_versions v
      where v.status = 'submitted' and v.company_id in (select pbx_accessible_company_ids())
        and pbx_can_decide(v.company_id, v.approval_route, v.created_by, v.submitted_by)
        and not pbx_approval_on_hold(v.company_id, v.approval_route, v.created_by, v.submitted_by))
    +
    (select count(*) from pbx_actual_submissions s
      where s.status = 'submitted' and s.company_id in (select pbx_accessible_company_ids())
        and pbx_can_decide(s.company_id, s.approval_route, s.created_by, s.submitted_by)
        and not pbx_approval_on_hold(s.company_id, s.approval_route, s.created_by, s.submitted_by))
    into v_n;
  return v_n;
end;
$$;

revoke all on function pbx_decisions_waiting_count() from public, anon;
grant execute on function pbx_decisions_waiting_count() to authenticated;
