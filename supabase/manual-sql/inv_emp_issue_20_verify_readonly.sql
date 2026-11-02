-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the migration 20261216000100_inv_issue_to_employee_consumes_reservation.sql.
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is information only).
-- A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  the function(s) exist, are SECURITY DEFINER with a fixed search path, are callable by signed-in users and NOT by anonymous visitors
--   2  the new rule is in the function AND every earlier protection is still there
--
-- It checks DEFINITIONS and PRIVILEGES. It cannot call a function without writing, so the behaviour is proved by the repository's database tests
-- (packages/rls-tests/test/inventory_employee_reserve_issue.rls.test.ts) and, on this project, by the first real use (see the deployment guide).

with
fns(name) as (values ('inv_issue_to_employee')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from fns)),
needs(fname, kind, label, needle) as (values
  ('inv_issue_to_employee', 'N', 'a unit reserved for THIS request is not a conflict', 'inv_unit_reserved_by(u.id, now(), p_expected_return_at, q.id)'),
  ('inv_issue_to_employee', 'N', 'a unit''s reservation for this request is consumed', 'inv_reservation_take(q.id, u.item_id, u.id, 1, null)'),
  ('inv_issue_to_employee', 'N', 'counted stock: this request''s reservation is consumed first', 'inv_reservation_take(q.id, i.id, null, v_qty, l.id)'),
  ('inv_issue_to_employee', 'N', 'an issued-in-full reservation is completed', 'set status = ''completed'''),
  ('inv_issue_to_employee', 'E', 'a unit reserved for ANOTHER request still refuses', 'is reserved for % and cannot be issued to a person for that period'),
  ('inv_issue_to_employee', 'E', 'counted stock reserved for others still refuses', 'can be issued now: the rest is not on the shelf or is reserved for upcoming requests'),
  ('inv_issue_to_employee', 'E', 'the request must be for this employee', 'That request is not for this employee'),
  ('inv_issue_to_employee', 'E', 'the expected return must be in the future', 'The expected return date must be in the future'),
  ('inv_issue_to_employee', 'E', 'no more than the request asks for', 'and they have all been issued'),
  ('inv_issue_to_employee', 'E', 'replay returns the original result', '(h->>''replay'')::boolean'),
  ('inv_issue_to_employee', 'E', 'the movement is written through the ledger helpers', 'inv_ml(v_mid')
),
checks as (
  select 1 as grp, 'function exists' as chk, e.name as item, case when f.oid is not null then 'OK' else 'FAIL' end as result, '' as detail
  from fns e left join fn f on f.proname = e.name
  union all
  select 1, 'security definer with a fixed search path', f.proname,
         case when f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%' then 'OK' else 'FAIL' end, coalesce(f.proconfig::text, 'no search_path set')
  from fn f
  union all
  select 1, 'signed-in users can call it, anonymous visitors cannot', f.proname,
         case when has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f
  union all
  select 2, case n.kind when 'N' then 'new rule present' else 'earlier protection still present' end, n.fname || ': ' || n.label,
         case when f.oid is null then 'FAIL' when position(n.needle in f.prosrc) > 0 then 'OK' else 'FAIL' end,
         case when f.oid is null then 'function missing' when position(n.needle in f.prosrc) > 0 then '' else 'text not found: ' || n.needle end
  from needs n left join fn f on f.proname = n.fname
)
select chk as "check", item, result, detail from (
  select grp, chk, item, result, detail from checks
  union all select 9, 'SUMMARY', '', case when exists (select 1 from checks where result = 'FAIL')
         then 'FAIL: ' || (select count(*) from checks where result = 'FAIL') || ' check(s) failing, see above'
         else 'OK: ' || (select count(*) from checks) || ' checks, 0 failing' end, ''
) r
order by grp, chk, item;
