-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER applying
-- supabase/migrations/20261112000000_balance_views_security_invoker.sql.
-- Run the WHOLE file as one script; it returns ONE result table (status | check | detail).
-- Every line should say PASS (or INFO, which is only for you to compare with the "before" run).
-- Anything saying FAIL or REVIEW: send me the whole table, do not carry on.
-- It changes nothing: the only write is a temporary table (private to this connection), and the
-- "who can see what" probe switches role inside the script and switches back.
--
-- To compare with the "before" run (balance_views_00_confirm_readonly.sql):
--   * the two "balances unchanged" lines (rows + md5) must be IDENTICAL to section K of that run
--   * "ANON" must now be denied, and the signed-in people must see the same or FEWER rows than before,
--     never more. A normal employee should see only their own balance.

drop table if exists pg_temp._probe;
create temp table _probe (actor text, leave_rows bigint, comp_rows bigint, note text);

do $$
declare
  actors text[] := array[
    'hrtest.employee@enginious.ae', 'hrtest.manager@enginious.ae', 'hrtest.hr@enginious.ae',
    'hrtest.ceo@enginious.ae', 'hrtest.finance@enginious.ae', 'hrtest.admin@enginious.ae'
  ];
  a text; uid uuid; l bigint; c bigint;
begin
  select count(*) into l from public.leave_balances;
  select count(*) into c from public.comp_day_balances;
  insert into _probe values ('(owner: everything that exists)', l, c, 'the totals the others are compared with');

  foreach a in array actors loop
    select id into uid from auth.users where lower(email) = lower(a);
    if uid is null then
      insert into _probe values (a, null, null, 'no such login');
      continue;
    end if;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into l from public.leave_balances;
      select count(*) into c from public.comp_day_balances;
      reset role;
      insert into _probe values (a, l, c, null);
    exception when others then
      reset role;
      insert into _probe values (a, null, null, 'ERROR: ' || sqlerrm);
    end;
  end loop;

  begin
    set local role anon;
    select count(*) into l from public.leave_balances;
    select count(*) into c from public.comp_day_balances;
    reset role;
    insert into _probe values ('ANON (not signed in)', l, c, 'STILL READABLE');
  exception when others then
    reset role;
    insert into _probe values ('ANON (not signed in)', null, null, 'denied: ' || sqlerrm);
  end;
end $$;

select status, check_name, detail from (
  select 1 as ord,
    case when c.reloptions @> array['security_invoker=true'] then 'PASS' else 'FAIL' end as status,
    c.relname || ' runs with the caller''s rights (security_invoker)' as check_name,
    'options=' || coalesce(c.reloptions::text, '(none)') as detail
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('leave_balances', 'comp_day_balances') and c.relkind = 'v'
  union all
  select 2, case when count(*) = 2 then 'PASS' else 'FAIL' end, 'both views exist as views', count(*) || ' of 2 found'
  from pg_class where relnamespace = 'public'::regnamespace and relname in ('leave_balances', 'comp_day_balances') and relkind = 'v'
  union all
  select 3, case when not exists (select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
                                 where c.oid = v.n::regclass and x.grantee = (select oid from pg_roles where rolname = 'anon'))
                 then 'PASS' else 'FAIL' end,
         'anon has no access to ' || v.n, 'not-signed-in visitors hold no privilege at all'
  from (values ('public.leave_balances'), ('public.comp_day_balances')) v(n)
  union all
  select 4, case when exists (select 1 from pg_class c, lateral aclexplode(c.relacl) x
                              where c.oid = v.n::regclass and x.grantee = (select oid from pg_roles where rolname = 'authenticated') and x.privilege_type = 'SELECT')
                      and not exists (select 1 from pg_class c, lateral aclexplode(c.relacl) x
                              where c.oid = v.n::regclass and x.grantee = (select oid from pg_roles where rolname = 'authenticated') and x.privilege_type <> 'SELECT')
                 then 'PASS' else 'FAIL' end,
         'signed-in users can only read ' || v.n, 'SELECT yes; every other privilege no'
  from (values ('public.leave_balances'), ('public.comp_day_balances')) v(n)
  union all
  select 5, case when has_table_privilege('service_role', v.n, 'SELECT') then 'PASS' else 'REVIEW' end,
         'service_role (cron / AI jobs) can read ' || v.n, 'if REVIEW: compare with section D of the "before" run; the migration does not touch service_role'
  from (values ('public.leave_balances'), ('public.comp_day_balances')) v(n)
  union all
  select 6, case when count(*) = 2 then 'PASS' else 'FAIL' end, 'both ledger tables still have row-level security on', count(*) || ' of 2'
  from pg_class where relnamespace = 'public'::regnamespace and relname in ('leave_ledger', 'comp_day_ledger') and relrowsecurity
  union all
  select 7, case when exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = p.t and pp.policyname = p.n) then 'PASS' else 'FAIL' end,
         'policy ' || p.n || ' exists', 'CEO/CTO (and Finance for comp days) keep their view'
  from (values ('leave_ledger', 'leave_ledger_select_clevel'), ('comp_day_ledger', 'comp_ledger_select_finance_clevel')) p(t, n)
  union all
  select 8, case when note like 'denied%' then 'PASS' else 'FAIL' end, 'ANON cannot read balances', coalesce(note, '')
  from _probe where actor like 'ANON%'
  union all
  select 9, case when coalesce(leave_rows, 0) <= (select leave_rows from _probe where actor like '(owner%')
                  and coalesce(comp_rows, 0) <= (select comp_rows from _probe where actor like '(owner%') and note is null
                 then 'PASS' else 'FAIL' end,
         actor || ' sees no more than the total', format('leave_balances=%s comp_day_balances=%s %s', coalesce(leave_rows::text, '-'), coalesce(comp_rows::text, '-'), coalesce(note, ''))
  from _probe where actor not like 'ANON%' and actor not like '(owner%' and coalesce(note, '') <> 'no such login'
  union all
  select 10, 'INFO', 'visible rows: ' || actor, format('leave_balances=%s comp_day_balances=%s %s', coalesce(leave_rows::text, '-'), coalesce(comp_rows::text, '-'), coalesce(note, ''))
  from _probe
  union all
  select 20, 'INFO', 'balances unchanged: leave_balances (compare with section K before)', format('rows=%s md5=%s', count(*), md5(coalesce(string_agg(employee_id || '|' || leave_type_code || '|' || balance_days, ';' order by employee_id, leave_type_code), '')))
  from public.leave_balances
  union all
  select 21, 'INFO', 'balances unchanged: comp_day_balances (compare with section K before)', format('rows=%s md5=%s', count(*), md5(coalesce(string_agg(employee_id || '|' || balance_days, ';' order by employee_id), '')))
  from public.comp_day_balances
) s order by ord, status, check_name;
