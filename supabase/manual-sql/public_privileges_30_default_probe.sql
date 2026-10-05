-- LEAVES NO TRACE. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER migration 20261114000000.
-- It creates a throw-away table, reads the privileges it received, and then deliberately raises an error so the
-- whole transaction is rolled back: nothing is created or kept. The RED ERROR TEXT IS THE ANSWER — copy it to me.
-- Expected: "PROBE RESULT: PASS ..." (anon / authenticated hold only DELETE, INSERT, SELECT, UPDATE).

do $$
declare
  v_anon text;
  v_auth text;
  v_svc text;
begin
  create table public._privilege_probe (id int);
  select string_agg(x.privilege_type, ',' order by x.privilege_type) into v_anon
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.oid = 'public._privilege_probe'::regclass and pg_get_userbyid(x.grantee) = 'anon';
  select string_agg(x.privilege_type, ',' order by x.privilege_type) into v_auth
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.oid = 'public._privilege_probe'::regclass and pg_get_userbyid(x.grantee) = 'authenticated';
  select string_agg(x.privilege_type, ',' order by x.privilege_type) into v_svc
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.oid = 'public._privilege_probe'::regclass and pg_get_userbyid(x.grantee) = 'service_role';
  raise exception 'PROBE RESULT: % | anon=% | authenticated=% | service_role=% | (nothing was kept)',
    case when coalesce(v_anon, '') !~ 'TRUNCATE|TRIGGER|REFERENCES|MAINTAIN' and coalesce(v_auth, '') !~ 'TRUNCATE|TRIGGER|REFERENCES|MAINTAIN'
              and coalesce(v_svc, '') ~ 'SELECT' then 'PASS' else 'FAIL' end,
    coalesce(v_anon, '(none)'), coalesce(v_auth, '(none)'), coalesce(v_svc, '(none)');
end $$;
