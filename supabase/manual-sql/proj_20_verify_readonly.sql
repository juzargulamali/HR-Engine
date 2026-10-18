-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the seven Projects & Tasks migrations
-- (20261120000000 ... 20261120000600). Run the WHOLE file; it returns ONE result table (check | result | detail).
-- Every row in the "result" column must read PASS (INFO rows are information). It changes nothing. Send me the full result.
--
-- Also compare section 'I HR and Sales row counts' with the same section of proj_00_preflight_readonly.sql: the numbers must be
-- IDENTICAL, apart from `notifications` (which only grows when people use Projects) - the Projects migrations never touch HR or
-- Sales data and never create a company.

with
proj_tables as (select c.oid, c.relname, c.relrowsecurity, c.relacl, c.relowner from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'proj\_%'),
proj_funcs as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'proj\_%'),
internal_fns as (select unnest(array[
  'proj_require_user', 'proj_audit_trigger', 'proj_handover_frozen', 'proj_issued_plan_guard', 'proj_display_name', 'proj_lock_project', 'proj_require_manager',
  'proj_check_version', 'proj_log_change', 'proj_notify', 'proj_next_reference', 'proj_add_member_row', 'proj_text_or_null', 'proj_lock_handover', 'proj_status_rank',
  'proj_member_blockers', 'proj_require_member_or_founder', 'proj_require_open_project', 'proj_task_event', 'proj_member_in_team', 'proj_set_task_dependencies',
  'proj_set_task_collaborators', 'proj_task_actor_role', 'proj_build_plan_payload', 'proj_mark_upload_intent', 'proj_expire_upload_intents', 'proj_abandoned_upload_objects']) as proname)
select check_name, result, detail from (
  select 1 as ord, 'Projects tables exist (32 expected)' as check_name,
         case when (select count(*) from proj_tables) = 32 then 'PASS' else 'FAIL' end as result,
         (select count(*)::text || ' found' from proj_tables) as detail
  union all
  select 2, 'row-level security on every Projects table', case when not exists (select 1 from proj_tables where not relrowsecurity) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(relname, ', ') from proj_tables where not relrowsecurity), 'all on')
  union all
  select 3, 'no INSERT / UPDATE / DELETE policy on any Projects table (clients write only through functions)',
         case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'proj\_%' and cmd <> 'SELECT') then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(tablename || ':' || cmd, ', ') from pg_policies where schemaname = 'public' and tablename like 'proj\_%' and cmd <> 'SELECT'), 'only SELECT policies')
  union all
  select 4, 'anon holds no privilege on any Projects table',
         case when not exists (select 1 from proj_tables t, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x where x.grantee = (select oid from pg_roles where rolname = 'anon')) then 'PASS' else 'FAIL' end,
         'checked through the access-control lists'
  union all
  select 5, 'authenticated holds only SELECT on Projects tables (no INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN)',
         case when not exists (select 1 from proj_tables t, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x
                              where x.grantee = (select oid from pg_roles where rolname = 'authenticated') and x.privilege_type <> 'SELECT') then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(distinct t.relname || ':' || x.privilege_type, ', ') from proj_tables t, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x
                   where x.grantee = (select oid from pg_roles where rolname = 'authenticated') and x.privilege_type <> 'SELECT'), 'SELECT only')
  union all
  select 6, 'upload intents and the reference counters are invisible to browsers (no privilege for signed-in users or anon)',
         case when not exists (select 1 from proj_tables t, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) x
                              where t.relname in ('proj_upload_intents', 'proj_reference_counters') and x.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))) then 'PASS' else 'FAIL' end,
         'only the SECURITY DEFINER functions and the service role reach them'
  union all
  select 7, 'every SECURITY DEFINER Projects function pins search_path to public',
         case when not exists (select 1 from proj_funcs where prosecdef and not coalesce(proconfig::text, '') like '%search_path=public%') then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(proname, ', ') from proj_funcs where prosecdef and not coalesce(proconfig::text, '') like '%search_path=public%'), (select count(*)::text from proj_funcs where prosecdef) || ' security definer functions, all pinned')
  union all
  select 8, 'anon cannot execute any Projects function',
         case when not exists (select 1 from proj_funcs where has_function_privilege('anon', oid, 'execute')) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(proname, ', ') from proj_funcs where has_function_privilege('anon', oid, 'execute')), 'none')
  union all
  select 9, 'signed-in users cannot execute internal helpers, trigger functions or the service-role functions',
         case when not exists (select 1 from proj_funcs f join internal_fns i on i.proname = f.proname where has_function_privilege('authenticated', f.oid, 'execute')) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(f.proname, ', ') from proj_funcs f join internal_fns i on i.proname = f.proname where has_function_privilege('authenticated', f.oid, 'execute')), 'none reachable')
  union all
  select 10, 'the service role can execute the three upload functions it needs (validate, expire, and the read-only clean-up report)',
         case when (select count(*) from proj_funcs where proname in ('proj_mark_upload_intent', 'proj_expire_upload_intents', 'proj_abandoned_upload_objects') and has_function_privilege('service_role', oid, 'execute')) = 3 then 'PASS' else 'FAIL' end,
         'needed to validate uploads and to list abandoned ones; nothing here is scheduled'
  union all
  select 11, 'neither anon nor signed-in users hold any privilege on a Projects sequence',
         case when not exists (select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) x
                              where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname like 'proj\_%'
                                and x.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' Projects sequences' from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S' and relname like 'proj\_%')
  union all
  select 12, 'storage buckets proj-files and proj-quarantine are private, size-limited and type-locked',
         case when (select count(*) from storage.buckets where id in ('proj-files', 'proj-quarantine') and not public and file_size_limit = 20971520
                           and allowed_mime_types is not null
                           and not exists (select 1 from unnest(allowed_mime_types) m where m ~* 'macro|msdownload|octet-stream|javascript|html|x-sh')) = 2 then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(id || ': public=' || public::text || ', limit=' || file_size_limit::text, '; ') from storage.buckets where id in ('proj-files', 'proj-quarantine')), 'buckets missing')
  union all
  select 13, 'no storage policy lets a signed-in user touch proj-files or proj-quarantine directly',
         case when not exists (select 1 from pg_policies where schemaname = 'storage' and (coalesce(qual, '') ~* 'proj-(files|quarantine)' or coalesce(with_check, '') ~* 'proj-(files|quarantine)')) then 'PASS' else 'FAIL' end,
         'files are moved, read and signed only by the server with the service role, after the database has checked access'
  union all
  select 14, 'no Projects function reads or writes an HR table, attendance, Recovery Leave, leave, payroll, reimbursements, timesheets or the legacy projects tables',
         case when not exists (select 1 from proj_funcs where prosrc ~* '(from|into|update|join)\s+(employees|attendance[a-z_]*|recovery[a-z_]*|leave[a-z_]*|payroll[a-z_]*|user_roles|salary[a-z_]*|reimbursement[a-z_]*|timesheet[a-z_]*|project_allocations|projects)\y') then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(proname, ', ') from proj_funcs where prosecdef and prosrc ~* '(from|into|update|join)\s+(employees|attendance[a-z_]*|recovery[a-z_]*|leave[a-z_]*|payroll[a-z_]*|user_roles|salary[a-z_]*|reimbursement[a-z_]*|timesheet[a-z_]*|project_allocations|projects)\y'), 'none do')
  union all
  select 15, 'no Projects function uses the reporting line (manager_id)',
         case when not exists (select 1 from proj_funcs where prosrc ~* 'manager_id') then 'PASS' else 'FAIL' end, 'project roles are independent of managers'
  union all
  select 16, 'Projects tables point only at companies, departments, auth.users, crm_opportunities and each other',
         case when not exists (select 1 from pg_constraint con join pg_class src on src.oid = con.conrelid join pg_class dst on dst.oid = con.confrelid
                               where con.contype = 'f' and src.relname like 'proj\_%' and dst.relnamespace = 'public'::regnamespace and dst.relname not like 'proj\_%'
                                 and dst.relname not in ('companies', 'departments', 'crm_opportunities')) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(distinct dst.relname, ', ') from pg_constraint con join pg_class src on src.oid = con.conrelid join pg_class dst on dst.oid = con.confrelid
                   where con.contype = 'f' and src.relname like 'proj\_%' and dst.relnamespace = 'public'::regnamespace and dst.relname not like 'proj\_%'), 'none')
  union all
  select 17, 'the legacy projects and project_allocations tables carry no Projects column, trigger or policy',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('projects', 'project_allocations') and column_name like 'proj\_%')
               and not exists (select 1 from pg_policies where tablename in ('projects', 'project_allocations') and policyname like 'proj\_%')
               and not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname in ('projects', 'project_allocations') and not g.tgisinternal and g.tgname like 'proj\_%') then 'PASS' else 'FAIL' end,
         'unchanged'
  union all
  select 18, 'no Projects row is written to the shared HR audit log',
         case when not exists (select 1 from audit_log where table_name like 'proj\_%') then 'PASS' else 'FAIL' end,
         'Projects has its own audit table proj_audit_log (visible only to founders and people given view_audit)'
  union all
  select 19, 'reference codes were copied from Sales settings of existing companies only (no company was created)',
         case when not exists (select 1 from proj_company_settings s where not exists (select 1 from companies c where c.id = s.company_id)) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' settings rows: ' || coalesce(string_agg(c.legal_name || ' -> ' || s.reference_code, '; ' order by c.legal_name), '') from proj_company_settings s join companies c on c.id = s.company_id)
  union all
  select 20, 'Projects reference codes are unique',
         case when (select count(distinct reference_code) from proj_company_settings) = (select count(*) from proj_company_settings) then 'PASS' else 'FAIL' end, ''
  union all
  select 21, 'every active Projects grant belongs to an active person and an existing company',
         case when not exists (select 1 from proj_company_grants g where g.revoked_at is null and (not exists (select 1 from profiles p where p.id = g.user_id and p.is_active) or not exists (select 1 from companies c where c.id = g.company_id))) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' active grants (' || count(*) filter (where 'founder' = any (capabilities)) || ' founder grants)' from proj_company_grants where revoked_at is null)
  union all
  select 22, 'every company with Projects grants has at least one founder',
         case when not exists (select 1 from proj_company_grants g where g.revoked_at is null
                               and not exists (select 1 from proj_company_grants f where f.company_id = g.company_id and f.revoked_at is null and 'founder' = any (f.capabilities))) then 'PASS' else 'FAIL' end,
         'run proj_30_bootstrap_founders.sql if this fails right after install (with no grants yet this is PASS)'
  union all
  select 23, 'integrity: every project has exactly one active Project Manager member, and a client project has exactly one opportunity',
         case when not exists (select 1 from proj_projects p where not exists (select 1 from proj_project_members m where m.project_id = p.id and m.user_id = p.pm_user_id and m.removed_at is null and m.role = 'pm'))
               and not exists (select 1 from proj_projects p where p.kind = 'client' and p.crm_opportunity_id is null) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' projects (' || count(*) filter (where kind = 'client') || ' client, ' || count(*) filter (where kind = 'internal') || ' internal)' from proj_projects)
  union all
  select 24, 'integrity: at most one project per Sales opportunity, and at most one project per accepted handover',
         case when not exists (select 1 from proj_projects where crm_opportunity_id is not null group by crm_opportunity_id having count(*) > 1)
               and not exists (select 1 from proj_projects where handover_id is not null group by handover_id having count(*) > 1) then 'PASS' else 'FAIL' end, ''
  union all
  select 25, 'integrity: every accepted handover has its project, and no accepted handover differs from what the project was created with',
         case when not exists (select 1 from proj_handovers h where (h.status = 'accepted') <> (h.project_id is not null))
               and not exists (select 1 from proj_handovers h join proj_projects p on p.id = h.project_id where p.handover_id is distinct from h.id) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' handovers (' || count(*) filter (where status = 'accepted') || ' accepted)' from proj_handovers)
  union all
  select 26, 'integrity: no commercial column exists in any Projects table except the restricted scope-change table',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name like 'proj\_%' and table_name <> 'proj_scope_change_commercial'
                               and column_name ~* '(^|_)(budget|price|cost|amount|margin|currency|payment|po_number|sales_value)($|_)') then 'PASS' else 'FAIL' end,
         'budgets, prices, costs, margins, payment terms, currencies and PO numbers stay in Sales & CRM (or in the restricted scope-change table); the only evidence_reference is the client''s completion confirmation'
  union all
  select 27, 'integrity: no confirmed site bookings of one person overlap (including preparation and travel allowances), unless an override reason is recorded',
         case when not exists (select 1 from proj_site_bookings a join proj_site_bookings b on a.user_id = b.user_id and a.id < b.id and a.state = 'confirmed' and b.state = 'confirmed'
                               where tstzrange(a.starts_at - make_interval(mins => a.lead_minutes), a.ends_at + make_interval(mins => a.trail_minutes))
                                     && tstzrange(b.starts_at - make_interval(mins => b.lead_minutes), b.ends_at + make_interval(mins => b.trail_minutes))
                                 and a.override_reason is null and b.override_reason is null) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' bookings, ' || count(*) filter (where override_reason is not null) || ' confirmed with an override' from proj_site_bookings)
  union all
  select 28, 'integrity: no task depends on itself, on another project''s task, or on a task that depends back on it',
         case when not exists (select 1 from proj_task_dependencies d where d.task_id = d.depends_on_task_id)
               and not exists (select 1 from proj_task_dependencies d join proj_tasks a on a.id = d.task_id join proj_tasks b on b.id = d.depends_on_task_id where a.project_id <> b.project_id)
               and not exists (select 1 from proj_task_dependencies d join proj_task_dependencies r on r.task_id = d.depends_on_task_id and r.depends_on_task_id = d.task_id) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' dependencies' from proj_task_dependencies)
  union all
  select 29, 'integrity: every blocked task has a reason and a person or action to unblock it; every done task has who and when',
         case when not exists (select 1 from proj_tasks where blocked_at is not null and (blocked_reason is null or (unblock_owner_id is null and unblock_action is null)))
               and not exists (select 1 from proj_tasks where status = 'done' and (completed_at is null or completed_by is null)) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' tasks' from proj_tasks)
  union all
  select 30, 'integrity: every issued client timeline is intact (its stored hash still matches its payload) and versions are consecutive',
         case when not exists (select 1 from proj_issued_plans where md5(payload::text) <> payload_hash)
               and not exists (select 1 from (select project_id, count(*) n, max(version) mx from proj_issued_plans group by project_id) x where x.n <> x.mx) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' issued versions' from proj_issued_plans)
  union all
  select 31, 'integrity: every issued plan "accepted" has a date, a contact and who recorded it; "sent" has a note',
         case when not exists (select 1 from proj_issued_plans where (accepted_on is not null and (accepted_contact is null or accepted_recorded_by is null)) or (sent_at is not null and sent_note is null)) then 'PASS' else 'FAIL' end, ''
  union all
  select 32, 'integrity: every completed project has exactly one current completion; every open project has none; reopened completions say who and why',
         case when not exists (select 1 from proj_projects p where p.status in ('completed', 'archived') and (select count(*) from proj_completions c where c.project_id = p.id and c.reopened_at is null) <> 1)
               and not exists (select 1 from proj_projects p where p.status not in ('completed', 'archived') and exists (select 1 from proj_completions c where c.project_id = p.id and c.reopened_at is null))
               and not exists (select 1 from proj_completions where reopened_at is not null and (reopened_by is null or length(btrim(coalesce(reopen_reason, ''))) = 0)) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' completions, ' || count(*) filter (where reopened_at is not null) || ' reopened' from proj_completions)
  union all
  select 33, 'integrity: every completed client project has the client''s completion evidence',
         case when not exists (select 1 from proj_completions c join proj_projects p on p.id = c.project_id
                               where p.kind = 'client' and (c.evidence_type = 'internal_note' or c.confirmed_on is null or c.client_contact is null or (c.evidence_reference is null and c.file_id is null))) then 'PASS' else 'FAIL' end, ''
  union all
  select 34, 'integrity: scope changes keep the original; approved ones record who decided and why',
         case when not exists (select 1 from proj_scope_changes where status in ('approved', 'rejected') and (decided_by is null or decision_note is null or length(btrim(decision_note)) = 0)) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' scope changes' from proj_scope_changes)
  union all
  select 35, 'integrity: no stored file has an executable or macro-enabled name or type, and every stored path stays inside its own project folder',
         case when not exists (select 1 from proj_files where kind = 'file' and (original_name ~* '\.(exe|dll|msi|bat|cmd|com|scr|js|vbs|ps1|sh|jar|docm|xlsm|pptm|dotm|xlsb)(\.|$)' or mime_type ~* 'macro'))
               and not exists (select 1 from proj_files f join proj_projects p on p.id = f.project_id where f.kind = 'file' and f.storage_path not like p.company_id::text || '/' || f.project_id::text || '/%') then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' files and links' from proj_files)
  union all
  select 36, 'discussion: deleted messages keep no text in the discussion table, and mentions never exceed the project''s participants',
         case when not exists (select 1 from proj_messages where deleted_at is not null and body <> '')
               and not exists (select 1 from proj_message_mentions m join proj_projects p on p.id = m.project_id where not exists (select 1 from proj_project_members pm where pm.project_id = m.project_id and pm.user_id = m.user_id) and not exists (select 1 from proj_company_grants g where g.user_id = m.user_id and g.company_id = p.company_id and 'founder' = any (g.capabilities))) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' messages' from proj_messages)
  union all
  select 37, 'no scheduled job, e-mail setting or cron route was added by Projects (nothing in this release sends anything)',
         case when not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'proj\_%' and p.prosrc ~* '(cron|net\.http|pg_net|send_mail|smtp)') then 'PASS' else 'FAIL' end, 'in-app notifications only'
  union all
  select 38, 'earlier discussion messages and company labels: callable by signed-in users, never by anon, and checked inside the function',
         case when (select count(*) from proj_funcs where proname in ('proj_messages_before', 'proj_company_labels') and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')) = 2
               and (select count(*) from proj_funcs where proname = 'proj_messages_before' and prosrc like '%proj_can_view_details%') = 1
               and (select count(*) from proj_funcs where proname = 'proj_company_labels' and prosrc like '%proj_has_access%' and prosrc like '%proj_can_view_summary%') = 1 then 'PASS' else 'FAIL' end,
         'the page loads the latest messages and pages backwards through the rest; a company name is shown only where you hold a Projects grant or can open one of its projects'
  union all
  select 39, 'INFO: project notifications are ordinary rows in the shared notifications table, type project_*',
         'INFO', (select count(*)::text || ' project notifications' from notifications where type like 'project\_%')
  union all
  select 40, 'INFO: abandoned temporary uploads waiting to be cleaned up (run proj_85_abandoned_uploads_readonly.sql for the list)',
         'INFO', (select count(*) filter (where safe_to_delete)::text || ' removable, ' || count(*) filter (where not safe_to_delete)::text || ' to look at by hand' from proj_abandoned_upload_objects())
) q
order by ord;
