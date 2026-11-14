-- READ ONLY. Run AFTER 20270107000100_proj_phase2_teams_crew_ops_review.sql. Every row must say OK except row 11, which is a count for information. Creates no row.
select item, result from (
  select 1 as ord, 'a team may be saved without a lead, and the preset column exists' as item,
         case when (select is_nullable from information_schema.columns where table_name = 'proj_teams' and column_name = 'head_user_id') = 'YES'
                   and exists (select 1 from information_schema.columns where table_name = 'proj_teams' and column_name = 'preset_key') then 'OK' else 'FAIL' end as result
  union all select 2, 'the new functions exist; signed-in users can call the public ones; anon cannot; the internal helpers are not callable',
         case when (select count(*) from (values ('public.proj_setup_teams(uuid, jsonb, boolean)'), ('public.proj_set_site_crew(uuid, jsonb, text)'), ('public.proj_set_site_crew(uuid, jsonb)'),
              ('public.proj_set_activity_readiness(uuid, jsonb)'), ('public.proj_site_technician_candidates(uuid)'), ('public.proj_my_site_assignments()'), ('public.proj_assign_output_reviewer(uuid, uuid)'), ('public.proj_reroute_output_review(uuid)'), ('public.ops_overview(uuid)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')) = 9
              and not has_function_privilege('authenticated', 'public.proj_is_ops_manager(uuid, uuid)', 'execute') and not has_function_privilege('authenticated', 'public.proj_output_reviewer_pool(uuid, uuid, uuid)', 'execute')
              and not has_function_privilege('authenticated', 'public.proj_crew_overlaps(uuid, uuid)', 'execute') and not has_function_privilege('authenticated', 'public.proj_site_technician_eligible(uuid, uuid)', 'execute')
              and not has_function_privilege('authenticated', 'public.ops_overview_base(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.proj_route_output_to_operations(uuid, text)', 'execute')
              and not has_function_privilege('authenticated', 'public.proj_is_pm_user(uuid, uuid)', 'execute') and not has_function_privilege('authenticated', 'public.proj_output_evidence_restricted(uuid)', 'execute')
              then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 3, 'no table policy was widened: the Phase 2 tables still have only a read policy for project readers, so a site-only technician reads nothing but their own assignment',
         case when (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('proj_site_crew', 'proj_task_output_versions', 'proj_site_shipments') and p.polcmd = 'r') = 3
                   and not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('proj_site_crew', 'proj_task_output_versions', 'proj_site_shipments') and p.polcmd <> 'r')
                   and not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('proj_site_crew', 'proj_task_output_versions', 'proj_site_shipments') and pg_get_expr(p.polqual, p.polrelid) not like '%proj_can_view_details%')
              then 'OK' else 'FAIL' end
  union all select 4, 'a version the Project Manager submits is routed to Operations, and the decision refuses the submitter and the assignee',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_submit_task_output(uuid, uuid, uuid, integer, text, boolean, text, integer)')) like '%review_route%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_decide_task_output(uuid, text, text)')) like '%You cannot review your own work%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_decide_task_output(uuid, text, text)')) like '%is no longer the current one%' then 'OK' else 'FAIL - old function body' end
  union all select 5, 'the Operations decision queue read carries the versions waiting for Operations review',
         case when to_regprocedure('public.ops_overview_base(uuid)') is not null and (select prosrc from pg_proc where oid = to_regprocedure('public.ops_overview(uuid)')) like '%output_reviews%' then 'OK' else 'FAIL' end
  union all select 6, 'no version routed to Operations was decided by the person who submitted it or by the person the task is assigned to',
         case when not exists (select 1 from proj_task_output_versions x join proj_tasks t on t.id = x.task_id
                                where x.review_route = 'operations' and x.decided_by is not null and (x.decided_by = x.submitted_by or x.decided_by = t.assignee_id)) then 'OK' else 'FAIL' end
  union all select 7, 'the change log accepts team entries, and the earlier entry kinds still work',
         case when exists (select 1 from pg_constraint where conname = 'proj_change_log_entity_type_check' and pg_get_constraintdef(oid) like '%team%' and pg_get_constraintdef(oid) like '%task_output%' and pg_get_constraintdef(oid) like '%site_activity%') then 'OK' else 'FAIL' end
  union all select 8, 'no team name is used twice on a project, and no crew place repeats',
         case when not exists (select 1 from proj_teams where removed_at is null group by project_id, lower(btrim(name)) having count(*) > 1)
                   and not exists (select 1 from proj_site_crew group by plan_item_id, user_id, crew_role having count(*) > 1) then 'OK' else 'FAIL' end
  union all select 9, 'a site-only person reads their assignment only while they are still an eligible employee of the project''s company (the same check used when they are assigned)',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_my_site_assignments()')) like '%proj_site_technician_eligible(p.company_id%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.proj_my_site_assignments()')) like '%proj_dp_active_member(c.project_id%' then 'OK' else 'FAIL - old function body' end
  union all select 10, 'no pending version the Project Manager submitted is still waiting on the team route unless its evidence is a restricted file (those can be sent to Operations once the file is unrestricted)',
         case when not exists (select 1 from proj_task_output_versions x where x.status = 'awaiting' and x.review_route = 'team'
                                 and x.version_no = (select max(z.version_no) from proj_task_output_versions z where z.task_id = x.task_id)
                                 and proj_is_pm_user(x.project_id, x.submitted_by) and not proj_output_evidence_restricted(x.id)
                                 and exists (select 1 from proj_projects p where p.id = x.project_id and p.status not in ('completed', 'archived'))) then 'OK' else 'FAIL - run: select proj_route_output_to_operations(id, null) for these versions, or use Send to Operations' end
  union all select 11, 'information: crew places held by people who are not on the project (site-only) / versions waiting for Operations / teams still needing a lead',
         (select count(*) from proj_site_crew c where not exists (select 1 from proj_project_members m where m.project_id = c.project_id and m.user_id = c.user_id and m.removed_at is null))::text || ' / '
         || (select count(*) from proj_task_output_versions where review_route = 'operations' and status = 'awaiting')::text || ' / '
         || (select count(*) from proj_teams where removed_at is null and head_user_id is null)::text
) x order by ord;
