-- READ ONLY. Run AFTER 20270110000100_ops_tv_display.sql. Every row must say OK except rows 6 and 7, which are counts for information. Creates no row.
select item, result from (
  select 1 as ord, 'the display table exists, row level security is on, it has NO policy, and neither anon nor signed-in users hold any privilege on it' as item,
         case when to_regclass('public.ops_tv_displays') is not null
                   and (select relrowsecurity from pg_class where oid = 'public.ops_tv_displays'::regclass)
                   and not exists (select 1 from pg_policy where polrelid = 'public.ops_tv_displays'::regclass)
                   and not has_table_privilege('authenticated', 'public.ops_tv_displays', 'select') and not has_table_privilege('authenticated', 'public.ops_tv_displays', 'insert')
                   and not has_table_privilege('authenticated', 'public.ops_tv_displays', 'update') and not has_table_privilege('authenticated', 'public.ops_tv_displays', 'delete')
                   and not has_table_privilege('anon', 'public.ops_tv_displays', 'select') then 'OK' else 'FAIL - table, row level security or privileges differ' end as result
  union all select 2, 'the five public functions exist, signed-in users can call them, anon cannot',
         case when (select count(*) from (values ('public.ops_tv_board(uuid)'), ('public.ops_tv_my_display()'), ('public.ops_tv_register_display(uuid, uuid, text, text)'),
              ('public.ops_tv_revoke_display(uuid)'), ('public.ops_tv_list_displays(uuid)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')) = 5
              then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 3, 'the internal name helper exists and is not callable by anon or signed-in users',
         case when to_regprocedure('public.ops_tv_person_name(uuid)') is not null and not has_function_privilege('authenticated', 'public.ops_tv_person_name(uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.ops_tv_person_name(uuid)', 'execute') then 'OK' else 'FAIL - helper missing or callable' end
  union all select 4, 'every function runs as its owner with a pinned search path',
         case when (select count(*) from pg_proc where proname like 'ops\_tv\_%' and pronamespace = 'public'::regnamespace and prosecdef and proconfig is not null and 'search_path=public' = any (proconfig)) = 6
              then 'OK' else 'FAIL - a function is not security definer with search_path = public' end
  union all select 5, 'the board returns the allowlist and nothing that was never meant to be shown: the function text names no comment, message, task, file, budget, price, phone or e-mail column',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.ops_tv_board(uuid)')) !~* '(proj_comments|proj_messages|proj_tasks|proj_files|proj_budget|\mprice\M|\mvalue\M|\mphone\M|\memail\M|\mmobile\M|salary|crew_instructions|ready_note|\.notes\M|\.client_name|\.scope\M)'
              then 'OK' else 'FAIL - the board reads a field outside the allowlist' end
  union all select 6, 'information: registered displays (active / revoked)',
         (select count(*) filter (where revoked_at is null) from ops_tv_displays)::text || ' / ' || (select count(*) filter (where revoked_at is not null) from ops_tv_displays)::text
  union all select 7, 'information: display accounts that also hold a grant, an HR role or an employee record (must be 0: a display carries no other permission)',
         (select count(*) from ops_tv_displays d where exists (select 1 from employees e where e.user_id = d.user_id and e.deleted_at is null)
            or exists (select 1 from user_roles r where r.user_id = d.user_id and r.revoked_at is null)
            or exists (select 1 from proj_company_grants g where g.user_id = d.user_id and g.revoked_at is null)
            or exists (select 1 from crm_company_grants g where g.user_id = d.user_id and g.revoked_at is null)
            or exists (select 1 from inv_company_grants g where g.user_id = d.user_id and g.revoked_at is null)
            or exists (select 1 from pbx_company_grants g where g.user_id = d.user_id and g.revoked_at is null))::text
) x order by ord;
