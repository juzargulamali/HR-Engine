-- READ ONLY. Run AFTER 20270102000100_ops_phase2b.sql. One result table; every row must say OK (rows marked INFO only report a number). Creates no row.
select item, result from (
  select 1 as ord, 'the capability list has operations, and it implies PM assignment in proj_has_capability' as item,
         case when 'operations' = any (proj_capability_list())
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_has_capability(uuid, text)')) like '%p_capability = ''assign_pm'' and ''operations'' = any%' then 'OK' else 'MISSING' end as result
  union all select 2, 'INFO people who hold Operations now (the migration itself gives it to nobody): ' || (select count(distinct user_id) from proj_company_grants where revoked_at is null and 'operations' = any (capabilities))::text, 'INFO'
  union all select 3, 'the two new tables exist with row-level security enabled',
         case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity and c.relname in ('ops_enquiry_planning', 'proj_equipment_reviews')) = 2 then 'OK' else 'MISSING or RLS off' end
  union all select 4, 'signed-in users can only READ the two tables (no insert, update or delete); anon has nothing',
         case when exists (select 1 from unnest(array['ops_enquiry_planning', 'proj_equipment_reviews']) t, unnest(array['insert', 'update', 'delete']) p where has_table_privilege('authenticated', 'public.' || t, p))
                or exists (select 1 from unnest(array['ops_enquiry_planning', 'proj_equipment_reviews']) t, unnest(array['select', 'insert', 'update', 'delete']) p where has_table_privilege('anon', 'public.' || t, p))
              then 'FAIL - a write privilege is granted' else 'OK' end
  union all select 5, 'the thirteen functions the app calls exist; signed-in users can call them; anon and public cannot',
         case when (select count(*) from (values
              ('public.ops_company_ids()'), ('public.crm_set_ops_planning(uuid, boolean, jsonb, integer)'), ('public.ops_set_enquiry_planning(uuid, jsonb)'), ('public.ops_upcoming_work(uuid)'),
              ('public.crm_ops_planning(uuid)'), ('public.proj_project_editions()'), ('public.proj_projects_for_edition(uuid)'), ('public.chat_project_group(uuid)'), ('public.chat_my_groups()'),
              ('public.proj_resolve_equipment_review(uuid, text)'), ('public.proj_equipment_readiness(uuid)'), ('public.ops_overview(uuid)'), ('public.proj_closeout_evidence(uuid)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure(f.sig) and a.grantee = 0)) = 13 then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 6, 'the internal helpers are NOT callable by signed-in users, anon or public',
         case when exists (select 1 from (values ('public.ops_require(uuid)'), ('public.ops_notify_managers(uuid, text, jsonb, text)'), ('public.ops_edition_snapshot(uuid)'), ('public.chat_is_ops(uuid, uuid)'),
                ('public.chat_is_member(uuid, uuid)'), ('public.inv_request_state(uuid)'), ('public.proj_closeout_evidence_base(uuid)'), ('public.proj_handover_edition()'), ('public.proj_details_edition()'),
                ('public.proj_details_dates_changed()')) f(sig)
              where to_regprocedure(f.sig) is null or has_function_privilege('authenticated', f.sig, 'execute') or has_function_privilege('anon', f.sig, 'execute')) then 'FAIL - callable or missing' else 'OK' end
  union all select 7, 'Upcoming Work names no commercial field (value, currency, budget, payment terms, brief, scope, exclusions, risks, evidence)',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.ops_upcoming_work(uuid)')) !~* '(o\.value|o\.currency|budget_note|payment_terms|o\.brief|o\.scope|o\.exclusions|o\.risks|evidence_|crm_proposals|crm_files|crm_activities)' then 'OK' else 'CHANGED' end
  union all select 8, 'the Operations functions reserve, release, dispatch and receive nothing, and create no project or task',
         case when not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                               and p.proname in ('ops_set_enquiry_planning', 'crm_set_ops_planning', 'ops_upcoming_work', 'ops_overview', 'proj_equipment_readiness', 'proj_resolve_equipment_review', 'proj_details_dates_changed', 'inv_request_state')
                               and p.prosrc ~* '(insert into inv_|update inv_|delete from inv_|inv_reserve|inv_release|inv_dispatch|inv_change_request_window|insert into proj_projects|insert into proj_tasks|insert into proj_project_members|proj_create_task)') then 'OK' else 'CHANGED' end
  union all select 9, 'the three triggers are installed (handover edition, project edition, date change review)',
         case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_proj_handover_edition', 'trg_proj_details_edition', 'trg_proj_details_dates_changed')) = 3 then 'OK' else 'MISSING' end
  union all select 10, 'an accepted handover and its project hold the same edition (the copy made at acceptance)',
         case when not exists (select 1 from proj_handovers h join proj_project_details d on d.project_id = h.project_id
                               where h.status = 'accepted' and h.event_edition_id is distinct from d.event_edition_id and d.event_edition_id is not null) then 'OK' else 'FAIL' end
  union all select 11, 'at most one open equipment review per request and date',
         case when not exists (select 1 from proj_equipment_reviews where resolved_at is null group by request_id, field having count(*) > 1) then 'OK' else 'FAIL' end
  union all select 12, 'the closeout evidence is the wrapped function (the earlier one is kept as proj_closeout_evidence_base)',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_closeout_evidence(uuid)')) like '%proj_closeout_evidence_base(p_project_id)%' then 'OK' else 'CHANGED' end
  union all select 13, 'Chat: the Operations path needs the capability itself on the project''s company',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_is_ops(uuid, uuid)')) like '%''operations'' = any (g.capabilities)%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_is_ops(uuid, uuid)')) not like '%founder%' then 'OK' else 'CHANGED' end
  union all select 14, 'INFO enquiries flagged for Operations: ' || (select count(*) from crm_opportunities where ops_flagged_at is not null)::text
                       || '; projects with an event edition: ' || (select count(*) from proj_project_details where event_edition_id is not null)::text
                       || '; open equipment reviews: ' || (select count(*) from proj_equipment_reviews where resolved_at is null)::text, 'INFO'
) x order by ord;
