-- public.leave_balances and public.comp_day_balances: stop bypassing row-level security.
--
-- WHY. Both are plain views owned by `postgres`, so by default they run with the
-- OWNER's rights ("SECURITY DEFINER view" in the Supabase advisor). The owner bypasses
-- row-level security on leave_ledger / comp_day_ledger, so any role holding SELECT on
-- the view (anon and authenticated both do, by Supabase's default grants) can read the
-- balances of EVERY employee in EVERY company, whatever the ledger tables' own policies say.
--
-- WHAT. Make the views SECURITY INVOKER: they then run with the CALLER's rights and the
-- ledgers' existing policies decide which rows each caller sees. The view definitions
-- (and therefore every balance and calculation) are untouched.
--
-- COMPATIBILITY. Today three groups read balances ONLY because the views bypass RLS, and
-- the app relies on it (employee profile "Leave" tab and the Approvals page):
--   * CEO / CTO     -> neither ledger's policy lets them read rows (leave_requests does)
--   * Finance       -> comp_day_ledger's policy has no Finance branch (leave_ledger's does)
-- Their access is added below as NEW, additive policies, mirroring who may already read the
-- same employee's leave requests (employee, manager chain, HR Admin, Finance, CEO/CTO of the
-- employee's company). Existing policies are not touched or dropped. The service role (cron
-- routes) bypasses RLS and is unaffected.
--
-- ALSO. Defence in depth: anon never needs balances, and nobody needs to write through an
-- aggregate view, so anon loses all access and signed-in users keep SELECT only.
--
-- Additive and reversible (see the ROLLBACK block at the bottom). No data is read or changed.

do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'security_invoker views need PostgreSQL 15 or newer (this server: %).', current_setting('server_version');
  end if;
  if (select relkind from pg_class where oid = to_regclass('public.leave_balances')) is distinct from 'v'
     or (select relkind from pg_class where oid = to_regclass('public.comp_day_balances')) is distinct from 'v' then
    raise exception 'public.leave_balances and public.comp_day_balances must both exist as views; stop and compare with the repository.';
  end if;
end $$;

-- 1. Additive read access that the views used to grant implicitly ------------------------

drop policy if exists leave_ledger_select_clevel on public.leave_ledger;
create policy leave_ledger_select_clevel on public.leave_ledger for select
  using (
    has_role('ceo', (select e.company_id from public.employees e where e.id = employee_id))
    or has_role('cto', (select e.company_id from public.employees e where e.id = employee_id))
  );

drop policy if exists comp_ledger_select_finance_clevel on public.comp_day_ledger;
create policy comp_ledger_select_finance_clevel on public.comp_day_ledger for select
  using (
    has_role('finance', (select e.company_id from public.employees e where e.id = employee_id))
    or has_role('ceo', (select e.company_id from public.employees e where e.id = employee_id))
    or has_role('cto', (select e.company_id from public.employees e where e.id = employee_id))
  );

-- 2. The views now run with the caller's rights ------------------------------------------

alter view public.leave_balances set (security_invoker = true);
alter view public.comp_day_balances set (security_invoker = true);

-- 3. Least privilege on the views ---------------------------------------------------------

revoke all on public.leave_balances from anon;
revoke all on public.comp_day_balances from anon;
revoke insert, update, delete, truncate, references, trigger on public.leave_balances from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.comp_day_balances from authenticated;
grant select on public.leave_balances to authenticated;
grant select on public.comp_day_balances to authenticated;

comment on view public.leave_balances is 'Net leave balance per employee and leave type (SUM of leave_ledger). security_invoker: callers see only the ledger rows their own access allows.';
comment on view public.comp_day_balances is 'Net Recovery Leave balance per employee (SUM of comp_day_ledger). security_invoker: callers see only the ledger rows their own access allows.';

-- ROLLBACK (only if needed; re-opens the cross-company exposure):
--   alter view public.leave_balances reset (security_invoker);
--   alter view public.comp_day_balances reset (security_invoker);
--   grant select on public.leave_balances, public.comp_day_balances to anon, authenticated;
--   drop policy if exists leave_ledger_select_clevel on public.leave_ledger;
--   drop policy if exists comp_ledger_select_finance_clevel on public.comp_day_ledger;
