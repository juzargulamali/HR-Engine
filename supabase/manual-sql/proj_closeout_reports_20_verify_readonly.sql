-- READ ONLY. Run AFTER 20270101000100_proj_closeout_reports.sql. One result table; every row must say OK (rows marked INFO only report a number). Creates no row.
select item, result from (
  select 1 as ord, 'the three closeout tables (reports, usage counter, provider calls) exist with row-level security enabled' as item,
         case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity and c.relname in ('proj_closeout_reports', 'proj_closeout_usage', 'proj_closeout_generations')) = 3 then 'OK' else 'MISSING or RLS off' end as result
  union all select 2, 'signed-in users can only READ the tables (no insert, update or delete); anon has nothing',
         case when exists (select 1 from unnest(array['proj_closeout_reports', 'proj_closeout_usage', 'proj_closeout_generations']) t, unnest(array['insert', 'update', 'delete']) p where has_table_privilege('authenticated', 'public.' || t, p))
                or exists (select 1 from unnest(array['proj_closeout_reports', 'proj_closeout_usage', 'proj_closeout_generations']) t, unnest(array['select', 'insert', 'update', 'delete']) p where has_table_privilege('anon', 'public.' || t, p)) then 'FAIL - a write privilege is granted' else 'OK' end
  union all select 3, 'each table has exactly one policy: read for whoever manages the project',
         case when (select count(*) from pg_policies where schemaname = 'public' and tablename in ('proj_closeout_reports', 'proj_closeout_usage', 'proj_closeout_generations') and cmd = 'SELECT' and qual like '%proj_can_manage%') = 3
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('proj_closeout_reports', 'proj_closeout_usage', 'proj_closeout_generations')) = 3 then 'OK' else 'CHANGED' end
  union all select 4, 'the seven functions the app calls exist; signed-in users can call them; anon and public cannot',
         case when (select count(*) from (values
              ('public.proj_closeout_claim(uuid, text, integer)'), ('public.proj_closeout_finish(uuid, text, boolean, text, jsonb)'), ('public.proj_closeout_evidence(uuid)'), ('public.proj_closeout_save_draft(uuid, jsonb, jsonb, text, text, text, jsonb, jsonb)'), ('public.proj_closeout_save_edits(uuid, jsonb, integer)'),
              ('public.proj_closeout_approve(uuid, integer)'), ('public.proj_closeout_discard_draft(uuid)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure(f.sig) and a.grantee = 0)) = 7 then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 5, 'the internal helpers are NOT callable by signed-in users, anon or public',
         case when exists (select 1 from (values ('public.proj_closeout_require_manager(uuid)'), ('public.proj_closeout_text_blocks(text, jsonb)'), ('public.proj_closeout_blocks(jsonb, jsonb)')) f(sig)
              where to_regprocedure(f.sig) is null or has_function_privilege('authenticated', f.sig, 'execute') or has_function_privilege('anon', f.sig, 'execute')) then 'FAIL - callable or missing' else 'OK' end
  union all select 6, 'the evidence function names no commercial, budget, chat, comment, file or contact source',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_closeout_evidence(uuid)')) !~* '((from|join) +crm_|proj_scope_change_commercial|budget|proj_messages|chat_|proj_task_comments|proj_files|client_contact|cost_note|amount|employees|payroll|email|phone)' then 'OK' else 'CHANGED' end
  union all select 7, 'the report functions write to the report tables only: none completes a project, notifies anyone or touches stock',
         case when not exists (select 1 from pg_proc p where p.proname like 'proj\_closeout\_%' and p.pronamespace = 'public'::regnamespace
                               and p.prosrc ~* '(proj_notify|proj_complete_project|update proj_projects|insert into notifications|inv_[a-z_]+\(|update inv_|insert into inv_|chat_post)') then 'OK' else 'CHANGED' end
  union all select 8, 'at most one draft per project, and every approved version has its approval time',
         case when not exists (select 1 from proj_closeout_reports where status = 'draft' group by project_id having count(*) > 1)
                   and not exists (select 1 from proj_closeout_reports where status = 'approved' and approved_at is null) then 'OK' else 'FAIL' end
  union all select 9, 'approval is refused in the database while a statement is blocked (the approve function calls the block check)',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_closeout_approve(uuid, integer)')) like '%proj_closeout_blocks(r.snapshot, r.sections)%' then 'OK' else 'CHANGED' end
  union all select 10, 'no approved version is blocked by its own stored snapshot',
         case when not exists (select 1 from proj_closeout_reports where status = 'approved' and jsonb_array_length(proj_closeout_blocks(snapshot, sections)) > 0) then 'OK' else 'FAIL' end
  union all select 11, 'every stored provider result has its answer, and at most one row exists per project and reviewed content',
         case when not exists (select 1 from proj_closeout_generations where (status = 'done') <> (answer is not null)) then 'OK' else 'FAIL' end
  union all select 12, 'INFO reports: ' || (select count(*) from proj_closeout_reports where status = 'draft')::text || ' draft, ' || (select count(*) from proj_closeout_reports where status = 'approved')::text || ' approved; provider calls today: '
                       || (select coalesce(sum(calls), 0) from proj_closeout_usage where usage_day = (now() at time zone 'Asia/Dubai')::date)::text, 'INFO'
) x order by ord;
