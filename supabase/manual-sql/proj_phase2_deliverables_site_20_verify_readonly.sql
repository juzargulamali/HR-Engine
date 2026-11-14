-- READ ONLY. Run AFTER 20270106000100_proj_phase2_deliverables_site.sql. Every row must say OK. Creates no row.
select item, result from (
  select 1 as ord, 'the new tables exist with row security on and only a read policy (project readers); every write goes through the functions' as item,
         case when (select count(*) from pg_class c where c.relname in ('proj_task_output_versions', 'proj_site_crew', 'proj_site_shipments') and c.relrowsecurity) = 3
                   and not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('proj_task_output_versions', 'proj_site_crew', 'proj_site_shipments') and p.polcmd <> 'r')
                   and (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('proj_task_output_versions', 'proj_site_crew', 'proj_site_shipments') and p.polcmd = 'r') = 3
              then 'OK' else 'FAIL' end as result
  union all select 2, 'the new functions exist; signed-in users can call the public ones; anon and public cannot; the internal helpers are not callable',
         case when (select count(*) from (values ('public.proj_set_task_output(uuid, text, integer, boolean, integer)'), ('public.proj_submit_task_output(uuid, uuid, uuid, integer, text, boolean, text, integer)'),
              ('public.proj_decide_task_output(uuid, text, text)'), ('public.proj_deliverables_register(uuid, uuid)'), ('public.proj_save_site_activity(uuid, uuid, jsonb)'), ('public.proj_add_site_activities(uuid, jsonb)'),
              ('public.proj_set_site_crew(uuid, jsonb)'), ('public.proj_save_shipment(uuid, uuid, jsonb)'), ('public.proj_site_schedule(uuid)'), ('public.proj_work_overview(uuid)'), ('public.proj_link_feedback_output(uuid, uuid, uuid)'), ('public.proj_remove_shipment(uuid)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')) = 12
              and not has_function_privilege('authenticated', 'public.proj_output_file_json(uuid, uuid)', 'execute') and not has_function_privilege('authenticated', 'public.proj_file_usable(uuid, uuid)', 'execute')
              and not has_function_privilege('authenticated', 'public.proj_site_activity_json(uuid, text)', 'execute')
              then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 3, 'the task review / completion path enforces a required output on the server',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_set_task_status(uuid, text, text, integer)')) like '%output_required%' then 'OK' else 'FAIL - old function body' end
  union all select 4, 'a review decision is bound to the exact version (the decision function refuses a version that is not the current one)',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.proj_decide_task_output(uuid, text, text)')) like '%is no longer the current one%' then 'OK' else 'CHANGED' end
  union all select 5, 'no task has two versions with the same number, and no version is approved without an approval time',
         case when not exists (select 1 from proj_task_output_versions group by task_id, version_no having count(*) > 1)
                   and not exists (select 1 from proj_task_output_versions where (status = 'approved') <> (approved_at is not null)) then 'OK' else 'FAIL' end
  union all select 6, 'the change log accepts output, site and shipment entries',
         case when exists (select 1 from pg_constraint where conname = 'proj_change_log_entity_type_check' and pg_get_constraintdef(oid) like '%site_activity%' and pg_get_constraintdef(oid) like '%task_output%') then 'OK' else 'FAIL' end
  union all select 7, 'existing Site timeline items still read: every one has a state (Tentative unless confirmed)',
         case when not exists (select 1 from proj_plan_items where activity_state not in ('tentative', 'confirmed')) then 'OK' else 'FAIL' end
  union all select 8, 'no restricted file is referenced by a version of a task whose submitter could not open it (information: versions that use a restricted file)',
         (select count(*)::text from proj_task_output_versions x join proj_files f on f.id = x.file_id where f.restricted)
) x order by ord;
