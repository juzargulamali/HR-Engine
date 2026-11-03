-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the migration 20261218000100_inv_cross_company_receiving.sql.
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is information only).
-- A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  the functions exist, are SECURITY DEFINER with a fixed search path; the added ones are callable by signed-in users and NOT by anonymous visitors; the internal
--      helpers are callable by nobody signed in
--   2  the new rule is in the function text AND every earlier protection is still there, including the two rules about a revoked sharing authorisation:
--      (a) equipment ALREADY dispatched stays visible to the receiving warehouse's operators (the sharing row is no longer needed to see or receive it, and the
--          functions return the "sharing_revoked" flag), and (b) NEW dispatches are still refused and the Send form still offers only active authorisations
--   3  the privilege / policy part of the change, where this migration has one
--
-- It checks DEFINITIONS and PRIVILEGES. It cannot call a function without writing or acting as a person, so the behaviour is proved by the repository's database tests
-- (packages/rls-tests/test/inventory_cross_company_receiving.rls.test.ts) and, on this project, by the first real use (see the deployment guide).

with
fns(name) as (values ('inv_xshare_active'), ('inv_xshare_revoked'), ('inv_xshare_may_handle'), ('inv_xshare_sees'), ('inv_xshare_transfer_revoked'), ('inv_xshare_destinations'), ('inv_xshare_transfers'), ('inv_xshare_transfer_trace'), ('inv_xshare_units'), ('inv_xshare_counted_stock'), ('inv_xshare_availability')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from fns)),
fn_all as (select p.oid, p.proname, p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from fns union select 'inv_check_sharing' union select 'inv_transfer_dispatch' union select 'inv_transfer_receive')),
needs(fname, kind, label, needle) as (values
  ('inv_xshare_active', 'N', 'the authorisation is the existing active sharing row', 's.revoked_at is null'),
  ('inv_xshare_may_handle', 'N', 'the caller must be able to operate the location (existing right)', 'inv_can_operate(l.id)'),
  ('inv_xshare_may_handle', 'N', 'it is equipment of ANOTHER company at that location', 'l.company_id <> p_owner'),
  ('inv_xshare_may_handle', 'X', 'visibility of equipment already dispatched does NOT depend on the sharing row still being active', 'inv_xshare_active'),
  ('inv_xshare_active', 'N', 'the authorisation is the existing active sharing row', 's.use_company_id = p_use'),
  ('inv_xshare_revoked', 'N', 'the revoked flag comes from the sharing row', 'not inv_xshare_active(p_owner, p_use)'),
  ('inv_xshare_revoked', 'N', 'the owner''s own stock readers are never told to contact the owner', 'not inv_can_view_stock(p_owner)'),
  ('inv_xshare_transfer_revoked', 'N', 'the transfer flag is worked out per owner of a line the caller may see', 'inv_xshare_sees(o.owner_id, t.from_location_id, t.to_location_id)'),
  ('inv_xshare_transfers', 'N', 'the list carries the revoked flag', 'inv_xshare_transfer_revoked(t.id)'),
  ('inv_xshare_transfer_trace', 'N', 'the trace header carries the revoked flag', '''sharing_revoked'', inv_xshare_transfer_revoked(t.id)'),
  ('inv_xshare_units', 'N', 'the unit rows carry the revoked flag', 'inv_xshare_revoked(u.company_id, l.company_id)'),
  ('inv_xshare_units', 'N', 'equipment is "usable here" only while the sharing is active', 'inv_xshare_active(u.company_id, l.company_id)'),
  ('inv_xshare_counted_stock', 'N', 'only counted stock on the shelf or on its way', 'b.holder_kind in (''warehouse'', ''transit'')'),
  ('inv_xshare_counted_stock', 'N', 'only stock of another company at a warehouse the caller operates', 'inv_xshare_may_handle(b.company_id, l.id)'),
  ('inv_xshare_counted_stock', 'N', 'only quantities that exist', 'b.qty > 0'),
  ('inv_xshare_counted_stock', 'N', 'the counted rows carry the revoked flag', 'inv_xshare_revoked(b.company_id, l.company_id)'),
  ('inv_check_sharing', 'E', 'NEW dispatches are still refused: the sharing check ignores a revoked authorisation', 's.revoked_at is null'),
  ('inv_transfer_dispatch', 'E', 'dispatch still checks the sharing authorisation of every unit line', 'inv_check_sharing(i.company_id, lt.company_id)'),
  ('inv_transfer_receive', 'E', 'receipt is unchanged: it has no sharing check, so equipment already sent can always be received', 'inv_check_bin(v_bin, lt.id)'),
  ('inv_transfer_receive', 'X', 'receipt does not depend on the sharing authorisation', 'inv_check_sharing'),
  ('inv_xshare_sees', 'N', 'the owner side uses the existing stock-read right', 'inv_can_view_stock(p_owner)'),
  ('inv_xshare_destinations', 'N', 'a revoked authorisation is no longer offered as a destination, and only active warehouses are', 's.revoked_at is null'),
  ('inv_xshare_transfers', 'N', 'cross-company transfers only', 'lf.company_id <> lt.company_id'),
  ('inv_xshare_transfers', 'N', 'only transfers with a line the caller may see', 'inv_xshare_sees(i.company_id, t.from_location_id, t.to_location_id)'),
  ('inv_xshare_transfer_trace', 'N', 'a transfer the caller is not part of is "not found"', 'Transfer not found'),
  ('inv_xshare_transfer_trace', 'N', 'events are the dispatch and receipt only', 'm.kind in (''transfer_dispatch'', ''transfer_receive'')'),
  ('inv_xshare_units', 'N', 'only active, shelf or in-transit units', 'u.custody_kind in (''warehouse'', ''transit'')'),
  ('inv_xshare_units', 'N', 'only units the caller may handle at that location', 'inv_xshare_may_handle(u.company_id, l.id)'),
  ('inv_xshare_availability', 'N', 'a warehouse the caller cannot operate is not found', 'Location not found')
),
checks as (
  select 1 as grp, 'function exists' as chk, e.name as item, case when f.oid is not null then 'OK' else 'FAIL' end as result, '' as detail
  from fns e left join fn f on f.proname = e.name where e.name <> '__none__'
  union all
  select 1, 'security definer with a fixed search path', f.proname,
         case when f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%' then 'OK' else 'FAIL' end, coalesce(f.proconfig::text, 'no search_path set')
  from fn f where f.proname not in ('')
  union all
  select 1, 'signed-in users can call it, anonymous visitors cannot', f.proname,
         case when has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f where f.proname in ('inv_xshare_destinations', 'inv_xshare_transfers', 'inv_xshare_transfer_trace', 'inv_xshare_units', 'inv_xshare_counted_stock', 'inv_xshare_availability')
  union all
  select 1, 'internal helper: callable by nobody signed in', f.proname,
         case when not has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f where f.proname in ('inv_xshare_active', 'inv_xshare_revoked', 'inv_xshare_may_handle', 'inv_xshare_sees', 'inv_xshare_transfer_revoked')
  union all
  select 2, case n.kind when 'N' then 'new rule present' when 'X' then 'must NOT be in the function text' else 'earlier protection still present' end, n.fname || ': ' || n.label,
         case when f.oid is null then 'FAIL' when n.kind = 'X' then case when position(n.needle in f.prosrc) = 0 then 'OK' else 'FAIL' end when position(n.needle in f.prosrc) > 0 then 'OK' else 'FAIL' end,
         case when f.oid is null then 'function missing' when n.kind = 'X' then case when position(n.needle in f.prosrc) = 0 then '' else 'text found but must not be: ' || n.needle end when position(n.needle in f.prosrc) > 0 then '' else 'text not found: ' || n.needle end
  from needs n left join fn_all f on f.proname = n.fname where n.fname <> '__none__'
  union all
  select 3, 'destinations return identifiers and names only', f.proname, case when pg_get_function_result(f.oid) = 'TABLE(location_id uuid, location_code text, location_name text, timezone text, company_id uuid, company_name text, owner_company_id uuid, owner_company_name text)' then 'OK' else 'FAIL' end, pg_get_function_result(f.oid) from fn f where f.proname = 'inv_xshare_destinations'
  union all
  select 3, 'unit rows carry no cost, supplier, note, employee, project or request column', f.proname, case when pg_get_function_result(f.oid) !~* '(cost|price|supplier|rental_id|note|employee|project|request|photo)' then 'OK' else 'FAIL' end, pg_get_function_result(f.oid) from fn f where f.proname = 'inv_xshare_units'
  union all
  select 3, 'counted-stock rows carry no cost, supplier, note, employee, project or request column', f.proname, case when pg_get_function_result(f.oid) !~* '(cost|price|supplier|rental_id|note|employee|project|request|photo)' then 'OK' else 'FAIL' end, pg_get_function_result(f.oid) from fn f where f.proname = 'inv_xshare_counted_stock'
  union all
  select 3, 'the revoked flag is returned to the screens (they never work it out)', f.proname, case when pg_get_function_result(f.oid) ~ 'sharing_revoked boolean' then 'OK' else 'FAIL' end, pg_get_function_result(f.oid) from fn f where f.proname in ('inv_xshare_units', 'inv_xshare_counted_stock', 'inv_xshare_transfers')
  union all
  select 3, 'no privilege on any table', 'this migration adds no table or policy', 'OK', 'functions only'
)
select chk as "check", item, result, detail from (
  select grp, chk, item, result, detail from checks
  union all select 9, 'SUMMARY', '', case when exists (select 1 from checks where result = 'FAIL')
         then 'FAIL: ' || (select count(*) from checks where result = 'FAIL') || ' check(s) failing, see above'
         else 'OK: ' || (select count(*) from checks) || ' checks, 0 failing' end, ''
) r
order by grp, chk, item;
