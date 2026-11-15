-- READ ONLY. Run BEFORE applying 20270113000100_proj_client_timeline_tasks.sql. Changes nothing.
-- Expect: rows 1 and 2 'OK'; row 3 'not installed yet' (or 'already installed' on a second run). Rows 4 to 7 are for information.
--   Row 4: issued client timelines (all versions / latest versions). None of them is rewritten by the migration: the table is not altered.
--   Row 5: latest versions that are ALREADY outdated today. After the migration this number must be the same (verify row 6 repeats it): the migration adds a "tasks" key only when a
--          task is chosen, and no task can be chosen before it is applied.
--   Row 6: must be 0. An issued payload that already has a "tasks" key would be ambiguous (it was not made by this feature). If it is not 0, the rows are LISTED by the second
--          statement below: do not apply, and report them.
--   Row 7: tasks that could be chosen once installed (client projects that are not finished, tasks not cancelled). Nothing is chosen by the migration.
select item, result from (
  select 1 as ord, 'the client timeline functions and table this migration replaces or reads exist' as item,
         case when to_regprocedure('public.proj_build_plan_payload(uuid)') is not null and to_regprocedure('public.proj_issue_plan(uuid, text, text)') is not null
                   and to_regprocedure('public.proj_current_plan_payload(uuid)') is not null and to_regprocedure('public.proj_plan_outdated(uuid)') is not null
                   and to_regclass('public.proj_issued_plans') is not null and to_regclass('public.proj_tasks') is not null then 'OK'
              else 'STOP - the Projects client timeline is not installed; do not apply' end as result
  union all select 2, 'the helpers it calls exist (project lock, manager and open-project checks)',
         case when to_regprocedure('public.proj_lock_project(uuid)') is not null and to_regprocedure('public.proj_can_manage(uuid)') is not null
                   and to_regprocedure('public.proj_require_user()') is not null and to_regprocedure('public.proj_text_or_null(jsonb, text)') is not null then 'OK'
              else 'STOP - a prerequisite function is missing; do not apply' end
  union all select 3, 'this migration is not installed yet',
         case when to_regclass('public.proj_client_timeline_tasks') is not null or to_regprocedure('public.proj_set_client_timeline_tasks(uuid, jsonb)') is not null then 'already installed' else 'not installed yet' end
  union all select 4, 'information: issued client timelines (all versions / latest versions)',
         (select count(*) from proj_issued_plans)::text || ' / ' || (select count(*) from proj_issued_plans where superseded_at is null)::text
  union all select 5, 'information: latest issued versions that are outdated today (write this number down; verify row 6 must show the same)',
         (select count(*) from proj_issued_plans p where p.superseded_at is null and md5(proj_build_plan_payload(p.project_id)::text) <> p.payload_hash)::text
  union all select 6, 'issued payloads that already carry a "tasks" key (must be 0; listed below when not)',
         (select count(*) from proj_issued_plans where payload ? 'tasks')::text
  union all select 7, 'information: tasks that could be chosen once installed (live client projects, not cancelled)',
         (select count(*) from proj_tasks t join proj_projects p on p.id = t.project_id where p.kind = 'client' and p.status not in ('completed', 'archived') and t.status <> 'cancelled')::text
) x order by ord;

-- Ambiguous records for the owner to review (expected: no rows).
select p.id as issued_plan_id, p.project_id, p.version, p.issued_at from proj_issued_plans p where p.payload ? 'tasks' order by p.issued_at;
