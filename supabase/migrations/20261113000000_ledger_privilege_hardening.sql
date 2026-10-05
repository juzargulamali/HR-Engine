-- leave_ledger and comp_day_ledger: remove table privileges nobody needs (defence in depth).
--
-- WHY. Supabase gives `anon` and `authenticated` broad default grants on every new public table.
-- Row-level security governs SELECT / INSERT / UPDATE / DELETE, but NOT these privileges:
--   * TRUNCATE   empties a table and ignores row-level security entirely
--   * TRIGGER    lets the holder attach a trigger to the table
--   * REFERENCES lets the holder create a foreign key pointing at the table
--   * MAINTAIN   (PostgreSQL 17+) VACUUM / ANALYZE / REINDEX / LOCK TABLE ...
-- Confirmed on V2: both ledgers grant all of these to anon and authenticated. The REST API does not
-- expose them, so this is not an open door today; it removes the door so a future mistake cannot open it.
--
-- WHAT. Per ledger table:
--   anon           -> no privilege at all (no flow reads or writes a ledger without signing in)
--   authenticated  -> SELECT and INSERT only (still gated by the existing policies:
--                     reads by leave_ledger_select*/comp_ledger_select*, inserts by *_insert_hr)
-- UPDATE and DELETE were already revoked (migration 20260926000000) and are revoked again here so the
-- end state does not depend on history. Policies, data, views and functions are NOT touched.
-- SECURITY DEFINER functions (decide_leave_approval, accruals posted by the service role, ...) run with
-- the owner's / service role's own privileges and are unaffected.
--
-- Additive and reversible (ROLLBACK block at the bottom). No data is read or changed.

do $$
begin
  if (select relkind from pg_class where oid = to_regclass('public.leave_ledger')) is distinct from 'r'
     or (select relkind from pg_class where oid = to_regclass('public.comp_day_ledger')) is distinct from 'r' then
    raise exception 'public.leave_ledger and public.comp_day_ledger must both exist as tables; stop and compare with the repository.';
  end if;
end $$;

revoke all on public.leave_ledger from anon;
revoke all on public.comp_day_ledger from anon;

revoke all on public.leave_ledger from authenticated;
revoke all on public.comp_day_ledger from authenticated;
grant select, insert on public.leave_ledger to authenticated;
grant select, insert on public.comp_day_ledger to authenticated;

-- ROLLBACK (only if needed; restores Supabase's default grants on the two ledgers, minus update/delete):
--   grant select, insert, references, trigger, truncate on public.leave_ledger to anon, authenticated;
--   grant select, insert, references, trigger, truncate on public.comp_day_ledger to anon, authenticated;
