-- WRITES / DESTRUCTIVE. ONLY for backing out the Projects & Tasks install on "Enginious HR Engine_V2". Not part of the normal
-- deployment. It removes every Projects table, function and the two Projects bucket records, and nothing else: no HR or Sales table,
-- function, policy, grant or row is touched, and the legacy projects / project_allocations tables stay exactly as they were.
-- (A safe, lossless alternative that only pauses access is proj_80_safe_disable_and_restore.sql: prefer it once real data exists.)
--
-- SAFETY: while any Projects business data exists (projects, handovers, tasks, messages, files, issued plans...) the script
-- REFUSES to run. Export that data first, then change v_allow_data_loss to true to proceed knowingly. Storage objects inside the
-- buckets are not removed by SQL: empty both buckets in the Storage UI first (deleting rows from storage.objects directly would
-- leave the files behind).
--
-- LIMITATION ONCE DATA EXISTS: dropping the Projects tables destroys that history for good (handover snapshots, issued client
-- timelines, completion evidence, discussion). Notifications of type project_* in the shared notifications table are removed.

do $$
declare
  v_allow_data_loss boolean := false;     -- <<< change to true only after exporting, and only if you really mean it
  v_rows bigint := 0;
  n bigint;
  t text;
begin
  -- Counted table by table, only for tables that exist (so running this a second time is harmless).
  foreach t in array array['proj_projects', 'proj_handovers', 'proj_tasks', 'proj_messages', 'proj_files', 'proj_issued_plans', 'proj_milestones', 'proj_completions', 'proj_site_bookings'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from %I', t) into n;
      v_rows := v_rows + n;
    end if;
  end loop;
  if v_rows > 0 and not v_allow_data_loss then
    raise exception 'Projects data exists (% rows across projects, handovers, tasks, messages, files, plans, milestones, completions, bookings). Export it first, then set v_allow_data_loss := true.', v_rows;
  end if;
  if exists (select 1 from storage.objects where bucket_id in ('proj-files', 'proj-quarantine')) then
    raise exception 'The proj-files or proj-quarantine bucket still contains files. Empty both in the Storage UI first.';
  end if;

  drop table if exists proj_scope_change_commercial, proj_scope_changes, proj_feedback, proj_completions, proj_issued_plans, proj_upload_intents, proj_files,
    proj_read_state, proj_message_mentions, proj_message_tombstones, proj_messages, proj_site_bookings, proj_external_dependencies, proj_plan_items,
    proj_change_log, proj_task_comments, proj_task_events, proj_task_dependencies, proj_task_collaborators, proj_tasks, proj_deliverables, proj_milestones,
    proj_handovers, proj_sales_links, proj_project_members, proj_teams, proj_project_details, proj_projects,
    proj_reference_counters, proj_company_settings, proj_audit_log, proj_company_grants cascade;

  -- Every remaining Projects function (their signatures differ, so they are discovered rather than listed).
  declare f record;
  begin
    for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'proj\_%' loop
      execute 'drop function if exists ' || f.sig || ' cascade';
    end loop;
  end;

  delete from notifications where type like 'project\_%';
  delete from storage.buckets where id in ('proj-files', 'proj-quarantine');
  raise notice 'Projects & Tasks objects removed.';
end $$;

-- Afterwards run proj_00_preflight_readonly.sql: section C must show "no Projects tables or functions exist yet".
-- Also deploy the previous version of the app (the Projects module disappears when the tables are absent: the app shows "not installed").
