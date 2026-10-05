-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration.
-- Run the WHOLE file as one script; it returns ONE result table (section | item | detail).
-- It changes nothing: the only write is a temporary table (private to this connection, gone when it closes), and the "who can see what" probe switches role inside the script and switches back.
-- Please send me the full result (screenshot or Export -> CSV).
--
-- What it tells us (the repository is NOT assumed to match V2):
--   A  server version                       (security_invoker needs PostgreSQL 15+)
--   B  the 2 views + 2 ledgers: owner, options, row-level security on/off
--   C  the two view definitions as they really are in V2
--   D  who holds which privilege on them
--   E  every row-level-security policy on the two ledger tables
--   F  anything that depends on the views (other views, functions)
--   G  the helper functions the policies call
--   H  the roles involved (service_role must bypass RLS)
--   I  every other view in public and its options
--   J  how many rows each actor can read RIGHT NOW (this shows the exposure)
--   K  a fingerprint of every balance (to prove nothing changes)

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
    insert into _probe values ('ANON (not signed in)', l, c, 'any number above 0 means anyone on the internet could read balances');
  exception when others then
    reset role;
    insert into _probe values ('ANON (not signed in)', null, null, 'denied: ' || sqlerrm);
  end;
end $$;

select section, item, detail from (
  select 'A version' as section, 1 as ord, 'server_version' as item, version() as detail
  union all
  select 'B relation', 10 + row_number() over (order by c.relname), c.relname,
         format('kind=%s owner=%s options=%s rls_enabled=%s rls_forced=%s', c.relkind, pg_get_userbyid(c.relowner), coalesce(c.reloptions::text, '(none)'), c.relrowsecurity, c.relforcerowsecurity)
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('leave_balances', 'comp_day_balances', 'leave_ledger', 'comp_day_ledger')
  union all
  select 'C definition', 20 + row_number() over (order by c.relname), c.relname, regexp_replace(pg_get_viewdef(c.oid, true), '\s+', ' ', 'g')
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('leave_balances', 'comp_day_balances') and c.relkind = 'v'
  union all
  select 'D privileges', 30 + row_number() over (order by c.relname, grantee), c.relname || ' -> ' || grantee,
         string_agg(privilege_type, ', ' order by privilege_type)
  from (
    select c.oid, c.relname, case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee, x.privilege_type
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.relnamespace = 'public'::regnamespace and c.relname in ('leave_balances', 'comp_day_balances', 'leave_ledger', 'comp_day_ledger')
  ) c group by c.relname, grantee
  union all
  select 'E policy', 100 + row_number() over (order by tablename, policyname), tablename || ' / ' || policyname,
         format('cmd=%s roles=%s using=%s', cmd, roles::text, regexp_replace(coalesce(qual, '(none)'), '\s+', ' ', 'g'))
  from pg_policies where schemaname = 'public' and tablename in ('leave_ledger', 'comp_day_ledger')
  union all
  select 'F dependents', 200 + row_number() over (order by dependent), dependent, 'depends on one of the two views'
  from (
    select distinct coalesce(c.relname, p.proname) as dependent
    from pg_depend d
    left join pg_rewrite r on r.oid = d.objid
    left join pg_class c on c.oid = r.ev_class
    left join pg_proc p on p.oid = d.objid
    where d.refobjid in ('public.leave_balances'::regclass, 'public.comp_day_balances'::regclass)
      and d.deptype = 'n' and coalesce(c.relname, p.proname) is not null
      and coalesce(c.relname, '') not in ('leave_balances', 'comp_day_balances')
  ) q
  union all
  select 'F dependents', 250 + row_number() over (order by proname), proname || '()', 'function body mentions a balance view'
  from pg_proc where pronamespace = 'public'::regnamespace and (prosrc ilike '%leave_balances%' or prosrc ilike '%comp_day_balances%')
  union all
  select 'F dependents', 299, '(end of list)', 'if there is no row above this one, nothing else depends on the views'
  union all
  select 'G function', 300 + row_number() over (order by proname), proname || '(' || pg_get_function_identity_arguments(oid) || ')',
         format('security_definer=%s volatility=%s', prosecdef, provolatile)
  from pg_proc where pronamespace = 'public'::regnamespace and proname in ('has_role', 'user_has_role', 'is_manager_of', 'current_employee_id')
  union all
  select 'H role', 400 + row_number() over (order by rolname), rolname, format('bypass_rls=%s superuser=%s', rolbypassrls, rolsuper)
  from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres')
  union all
  select 'I other views', 500 + row_number() over (order by relname), relname, 'options=' || coalesce(reloptions::text, '(none)')
  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'
  union all
  select 'J visible rows', 600 + row_number() over (order by actor), actor,
         format('leave_balances=%s comp_day_balances=%s %s', coalesce(leave_rows::text, '-'), coalesce(comp_rows::text, '-'), coalesce(note, ''))
  from _probe
  union all
  select 'K fingerprint', 700, 'leave_balances', format('rows=%s md5=%s', count(*), md5(coalesce(string_agg(employee_id || '|' || leave_type_code || '|' || balance_days, ';' order by employee_id, leave_type_code), '')))
  from public.leave_balances
  union all
  select 'K fingerprint', 701, 'comp_day_balances', format('rows=%s md5=%s', count(*), md5(coalesce(string_agg(employee_id || '|' || balance_days, ';' order by employee_id), '')))
  from public.comp_day_balances
) s order by ord;
