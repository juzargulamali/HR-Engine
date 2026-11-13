-- WRITES. OWNER-RUN ROLLBACK of 20270107000100_proj_phase2_teams_crew_ops_review.sql. Safe to run twice. Deploy the app from before this follow-up FIRST (it calls these functions).
-- It STOPS if data that only this migration can hold exists: teams without a lead, crew with a call time or instructions or held by people who are not on the project, versions
-- routed to Operations, readiness or crew instructions on an activity, or team entries in the change log. Export that first (the queries are in docs/projects-phase-2-scope.md) and clear it.
-- It then restores the previous body of every function it replaced, unwraps the Operations overview, drops what it added and puts the earlier constraints back.
-- It does NOT touch Phase 2 itself (20270106000100): to undo that as well, run proj_phase2_deliverables_site_90_rollback.sql afterwards. No task, file, plan item, booking,
-- request or member is deleted.
begin;
do $$
declare n bigint;
begin
  select count(*) into n from proj_teams where head_user_id is null;
  if n > 0 then raise exception 'STOP: teams without a lead exist. Give each a lead (Project team > Manage team) or remove the team, then run this again.'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'proj_site_crew' and column_name = 'call_at') then
    execute 'select count(*) from proj_site_crew c where c.call_at is not null or c.instructions is not null or not exists (select 1 from proj_project_members m where m.project_id = c.project_id and m.user_id = c.user_id and m.removed_at is null)' into n;
    if n > 0 then raise exception 'STOP: crew places with a call time or instructions, or held by site-only technicians, exist. Export them and remove them first.'; end if;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'proj_task_output_versions' and column_name = 'review_route') then
    execute 'select count(*) from proj_task_output_versions where review_route = ''operations''' into n;
    if n > 0 then raise exception 'STOP: versions routed to Operations exist. Export them (task, version, reviewer, decision) first; the route is lost on rollback.'; end if;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'proj_plan_items' and column_name = 'ready_hardware') then
    execute 'select count(*) from proj_plan_items where ready_hardware <> ''unknown'' or ready_content <> ''unknown'' or ready_app <> ''unknown'' or ready_note is not null or crew_instructions is not null' into n;
    if n > 0 then raise exception 'STOP: activities with readiness or crew instructions exist. Export them and clear them first.'; end if;
  end if;
  select count(*) into n from proj_change_log where entity_type = 'team';
  if n > 0 then raise exception 'STOP: team entries exist in the change log. Export and delete them first.'; end if;
end $$;


-- Unwrap the Operations overview.
do $$
begin
  if to_regprocedure('public.ops_overview_base(uuid)') is not null then
    drop function if exists ops_overview(uuid);
    alter function ops_overview_base(uuid) rename to ops_overview;
    revoke all on function ops_overview(uuid) from public, anon, authenticated;
    grant execute on function ops_overview(uuid) to authenticated;
  end if;
end $$;

-- Restore the previous bodies (as 20270106000100 defines them).
create or replace function proj_set_site_crew(p_item_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i proj_plan_items; v proj_projects; r jsonb; v_added integer := 0; v_removed integer := 0; v_rows integer; v_want jsonb := '[]'::jsonb;
begin
  select * into i from proj_plan_items where id = p_item_id and plan = 'site';
  if not found then raise exception 'Site activity not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(i.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Crew must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 40 then raise exception 'At most 40 crew rows per activity' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if (r->>'role') not in ('installation', 'standby', 'backup', 'dismantling') then raise exception 'Choose the crew role: Installation, Standby, Backup or Dismantling' using errcode = '22023'; end if;
    if not proj_dp_active_member(v.id, (r->>'user_id')::uuid) then raise exception 'Crew must be active members of the project' using errcode = '22023'; end if;
  end loop;
  delete from proj_site_crew c where c.plan_item_id = i.id and not exists (
    select 1 from jsonb_array_elements(p_rows) x where (x->>'user_id')::uuid = c.user_id and x->>'role' = c.crew_role);
  get diagnostics v_removed = row_count;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into proj_site_crew (project_id, plan_item_id, user_id, crew_role, created_by) values (v.id, i.id, (r->>'user_id')::uuid, r->>'role', auth.uid()) on conflict (plan_item_id, user_id, crew_role) do nothing;
    get diagnostics v_rows = row_count;
    v_added := v_added + v_rows;
  end loop;
  if v_added + v_removed > 0 then perform proj_log_change(v.id, 'site_activity', i.id, 'crew', null, v_added || ' added, ' || v_removed || ' removed', i.title); end if;
  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$$;

drop function if exists proj_set_site_crew(uuid, jsonb, text);
create or replace function proj_submit_task_output(p_task_id uuid, p_file_id uuid, p_snapshot_file_id uuid default null, p_item_count integer default 1, p_note text default null,
                                                   p_mutable_link boolean default false, p_client_key text default null, p_expected_current integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t proj_tasks; v proj_projects; v_role text; v_cur integer; v_no integer; v_id uuid; v_ex proj_task_output_versions; f proj_files;
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  v_role := proj_task_actor_role(t);
  if v_role is null then raise exception 'Only the assignee, the head of the team or the Project Manager can submit the output' using errcode = '42501'; end if;
  if p_client_key is not null then
    select * into v_ex from proj_task_output_versions where task_id = t.id and client_key = p_client_key;
    if found then return jsonb_build_object('id', v_ex.id, 'version_no', v_ex.version_no, 'existing', true); end if;
  end if;
  if t.output_label is null then raise exception 'This task has no expected output yet. Ask the Project Manager to add one' using errcode = '23514'; end if;
  if t.status in ('done', 'cancelled', 'deferred') then raise exception 'This task is %: reopen it before submitting another version', t.status using errcode = '23514'; end if;
  select coalesce(max(version_no), 0) into v_cur from proj_task_output_versions where task_id = t.id;
  if p_expected_current is not null and p_expected_current <> v_cur then
    raise exception 'A newer version (v%) was submitted since you opened this. Reload to see it', v_cur;
  end if;
  if p_item_count is null or p_item_count < 1 or p_item_count > 999 then raise exception 'How many items does this version hold? (1 to 999)' using errcode = '22023'; end if;
  if not proj_file_usable(p_file_id, v.id) then raise exception 'That file or link is not available to you in this project' using errcode = '42501'; end if;
  if p_snapshot_file_id is not null and not proj_file_usable(p_snapshot_file_id, v.id) then raise exception 'The snapshot file is not available to you in this project' using errcode = '42501'; end if;
  select * into f from proj_files where id = p_file_id;
  v_no := v_cur + 1;
  update proj_task_output_versions set status = 'superseded' where task_id = t.id and status = 'awaiting';
  insert into proj_task_output_versions (project_id, task_id, version_no, file_id, snapshot_file_id, mutable_link, item_count, note, submitted_by, client_key)
  values (v.id, t.id, v_no, p_file_id, p_snapshot_file_id, (f.kind = 'link' and coalesce(p_mutable_link, true)), p_item_count, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_client_key)
  returning id into v_id;
  perform proj_task_event(t.id, v.id, 'output_submitted', case when v_cur = 0 then null else 'v' || v_cur end, 'v' || v_no, p_note);
  perform proj_log_change(v.id, 'task_output', t.id, 'version', case when v_cur = 0 then null else 'v' || v_cur end, 'v' || v_no, t.output_label);
  return jsonb_build_object('id', v_id, 'version_no', v_no, 'created', true);
end;
$$;
create or replace function proj_decide_task_output(p_version_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x proj_task_output_versions; t proj_tasks; v proj_projects; v_role text; v_cur integer; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform proj_require_user();
  if p_decision not in ('approved', 'changes_requested') then raise exception 'Choose Approve or Request changes' using errcode = '22023'; end if;
  select * into x from proj_task_output_versions where id = p_version_id;
  if not found then raise exception 'Version not found' using errcode = 'P0002'; end if;
  select * into t from proj_tasks where id = x.task_id for update;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  v_role := proj_task_actor_role(t);
  if v_role is null or v_role not in ('manager', 'head') then raise exception 'Only the department head or the Project Manager can review an output' using errcode = '42501'; end if;
  if x.submitted_by = auth.uid() or t.assignee_id = auth.uid() then raise exception 'You cannot review your own work' using errcode = '42501'; end if;
  select * into x from proj_task_output_versions where id = p_version_id for update;       -- re-read under the task lock
  if x.status = p_decision then return jsonb_build_object('id', x.id, 'version_no', x.version_no, 'unchanged', true); end if;
  select max(version_no) into v_cur from proj_task_output_versions where task_id = t.id;
  if x.version_no <> v_cur then
    raise exception 'Version % is no longer the current one: version % was submitted. Review that one', x.version_no, v_cur;
  end if;
  if x.status <> 'awaiting' then raise exception 'Version % was already decided (%)', x.version_no, replace(x.status, '_', ' ') using errcode = '23514'; end if;
  if p_decision = 'changes_requested' and v_note is null then raise exception 'Say what needs changing' using errcode = '22023'; end if;
  if p_decision = 'approved' then
    update proj_task_output_versions set status = 'approved', decided_by = auth.uid(), decided_at = now(), approved_by = auth.uid(), approved_at = now(), decision_note = v_note where id = x.id;
  else
    update proj_task_output_versions set status = 'changes_requested', decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = x.id;
  end if;
  perform proj_task_event(t.id, v.id, 'output_decision', 'v' || x.version_no, p_decision, v_note);
  perform proj_log_change(v.id, 'task_output', t.id, 'review of v' || x.version_no, 'awaiting', p_decision, v_note);
  -- A task waiting for review moves with the decision, through the existing status path (which checks the same rules again).
  if t.status = 'ready_for_review' then
    perform proj_set_task_status(t.id, case when p_decision = 'approved' then 'done' else 'in_progress' end, coalesce(v_note, 'Approved'), null);
  end if;
  return jsonb_build_object('id', x.id, 'version_no', x.version_no, 'decision', p_decision);
end;
$$;
create or replace function proj_output_version_json(p_version_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', x.id, 'version_no', x.version_no, 'status', x.status, 'item_count', x.item_count, 'mutable_link', x.mutable_link, 'note', x.note,
    'submitted_by', x.submitted_by, 'submitted_by_name', proj_display_name(x.submitted_by), 'attached_at', x.attached_at,
    'decided_at', x.decided_at, 'decided_by_name', proj_display_name(x.decided_by), 'decision_note', x.decision_note,
    'approved_at', x.approved_at, 'approved_by_name', proj_display_name(x.approved_by),
    'file', proj_output_file_json(x.file_id, x.project_id),
    'snapshot', case when x.snapshot_file_id is null then null else proj_output_file_json(x.snapshot_file_id, x.project_id) end,
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'status', f.status, 'kind', f.kind, 'source', f.source, 'text', left(f.request_text, 200), 'received_on', f.received_on) order by f.received_on, f.created_at)
                            from proj_feedback f where f.output_version_id = x.id), '[]'::jsonb))
  from proj_task_output_versions x where x.id = p_version_id;
$$;
create or replace function proj_site_activity_json(p_item_id uuid, p_tz text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'title', i.title, 'kind', i.activity_kind, 'run_label', i.run_label, 'location', i.location, 'status', i.status,
    'owner_id', i.owner_id, 'owner_name', case when i.owner_id is null then null else proj_display_name(i.owner_id) end, 'state', i.activity_state, 'confirmed_at', i.confirmed_at,
    'start_date', i.start_date, 'end_date', i.end_date, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'tz', coalesce(i.tz, p_tz), 'notes', i.notes, 'version', i.version, 'milestone_id', i.milestone_id,
    'client_facing', i.client_facing,
    'crew', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', proj_display_name(c.user_id), 'role', c.crew_role) order by c.crew_role, proj_display_name(c.user_id))
                        from proj_site_crew c where c.plan_item_id = i.id), '[]'::jsonb),
    'missing', (select coalesce(jsonb_agg(m), '[]'::jsonb) from (
        select 'date' as m where i.start_date is null and i.starts_at is null and i.status not in ('done', 'cancelled')
        union all select 'time' where i.start_date is not null and i.starts_at is null and i.activity_kind in ('mockup', 'setup', 'show', 'dismantling') and i.status not in ('done', 'cancelled')
        union all select 'crew' where i.activity_kind in ('setup', 'show', 'dismantling') and i.status not in ('done', 'cancelled') and not exists (select 1 from proj_site_crew c where c.plan_item_id = i.id)) q))
  from proj_plan_items i where i.id = p_item_id;
$$;
create or replace function proj_work_overview(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v proj_projects; v_tz text; d proj_project_details; v_today date; v_next jsonb; v_attn jsonb := '[]'::jsonb; v_recent jsonb; v_pm text;
begin
  perform proj_require_user();
  select * into v from proj_projects where id = p_project_id;
  if not found or not proj_can_view_details(p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  select * into d from proj_project_details where project_id = p_project_id;
  v_tz := coalesce(d.site_timezone, 'UTC');
  v_today := (now() at time zone v_tz)::date;
  v_pm := proj_display_name(v.pm_user_id);
  select proj_site_activity_json(i.id, d.site_timezone) into v_next from proj_plan_items i
   where i.project_id = p_project_id and i.plan = 'site' and i.status not in ('done', 'cancelled') and (i.start_date is not null or i.starts_at is not null)
     and coalesce(i.end_date, i.start_date, (i.ends_at at time zone coalesce(i.tz, v_tz))::date, (i.starts_at at time zone coalesce(i.tz, v_tz))::date) >= v_today
   order by coalesce(i.starts_at, (i.start_date::timestamp at time zone v_tz)), i.sort_order limit 1;
  -- Needs attention: each line says what, who can act (when known) and where to fix it.
  select coalesce(jsonb_agg(a.j order by a.ord), '[]'::jsonb) into v_attn from (
    select 1 as ord, jsonb_build_object('kind', 'output_missing', 'task_id', t.id, 'title', t.title, 'detail', 'Required output "' || t.output_label || '" is missing' || case when cur.id is not null then ' (' || cur.item_count || ' of ' || coalesce(t.output_qty, 1) || ' provided)' else '' end,
           'who', jsonb_build_array(proj_display_name(t.assignee_id))) as j
      from proj_tasks t left join lateral (select z.id, z.item_count, z.status from proj_task_output_versions z where z.task_id = t.id order by z.version_no desc limit 1) cur on true
     where t.project_id = p_project_id and t.output_required and t.status in ('todo', 'in_progress', 'ready_for_review') and (cur.id is null or cur.item_count < coalesce(t.output_qty, 1)) and coalesce(cur.status, '') <> 'changes_requested'
    union all
    select 2, jsonb_build_object('kind', 'changes_requested', 'task_id', t.id, 'title', t.title, 'detail', 'Changes requested on version ' || cur.version_no || ': ' || coalesce(cur.decision_note, ''), 'who', jsonb_build_array(proj_display_name(t.assignee_id)))
      from proj_tasks t join lateral (select z.* from proj_task_output_versions z where z.task_id = t.id order by z.version_no desc limit 1) cur on true
     where t.project_id = p_project_id and cur.status = 'changes_requested' and t.status in ('todo', 'in_progress', 'ready_for_review')
    union all
    select 3, jsonb_build_object('kind', 'review_waiting', 'task_id', t.id, 'title', t.title, 'detail', 'Version ' || cur.version_no || ' of "' || t.output_label || '" is waiting for review',
           'who', jsonb_build_array(coalesce((select proj_display_name(tm.head_user_id) from proj_teams tm where tm.id = t.team_id and tm.head_user_id <> t.assignee_id), v_pm)))
      from proj_tasks t join lateral (select z.* from proj_task_output_versions z where z.task_id = t.id order by z.version_no desc limit 1) cur on true
     where t.project_id = p_project_id and cur.status = 'awaiting' and t.status in ('todo', 'in_progress', 'ready_for_review')
    union all
    select 4, jsonb_build_object('kind', 'site_missing', 'activity_id', i.id, 'title', i.title || coalesce(' (' || i.run_label || ')', ''), 'detail',
           'Missing: ' || (select string_agg(case m when 'date' then 'date' when 'time' then 'time' else 'crew' end, ', ') from jsonb_array_elements_text(proj_site_activity_json(i.id, d.site_timezone) -> 'missing') m), 'who', jsonb_build_array(v_pm))
      from proj_plan_items i
     where i.project_id = p_project_id and i.plan = 'site' and i.status not in ('done', 'cancelled') and jsonb_array_length(proj_site_activity_json(i.id, d.site_timezone) -> 'missing') > 0
    union all
    select 5, jsonb_build_object('kind', 'shipment_conflict', 'shipment_id', s.id, 'title', s.label, 'detail', 'Arrives after "' || a.title || '" starts', 'who', jsonb_build_array(v_pm))
      from proj_site_shipments s join proj_plan_items a on a.id = s.plan_item_id
     where s.project_id = p_project_id and s.arrives_at is not null and (
           (a.starts_at is not null and s.arrives_at > a.starts_at)
        or (a.starts_at is null and a.start_date is not null and (s.arrives_at at time zone coalesce(s.arrives_tz, v_tz))::date > a.start_date))
  ) a;
  select coalesce(jsonb_agg(jsonb_build_object('at', c.created_at, 'actor', proj_display_name(c.actor_id), 'entity', c.entity_type, 'entity_id', c.entity_id, 'field', c.field, 'from', c.from_value, 'to', c.to_value, 'note', c.note,
           'title', coalesce((select t.title from proj_tasks t where c.entity_type = 'task_output' and t.id = c.entity_id), (select i.title from proj_plan_items i where c.entity_type = 'site_activity' and i.id = c.entity_id),
                             (select s.label from proj_site_shipments s where c.entity_type = 'shipment' and s.id = c.entity_id)))
           order by c.created_at desc, c.id desc), '[]'::jsonb) into v_recent
    from (select * from proj_change_log where project_id = p_project_id and entity_type in ('task_output', 'site_activity', 'shipment') order by created_at desc, id desc limit 8) c;
  return jsonb_build_object('tz', v_tz, 'today', v_today, 'next_on_site', v_next, 'attention', v_attn, 'recent', v_recent);
end;
$$;

drop function if exists proj_reroute_output_review(uuid);
drop function if exists proj_route_output_to_operations(uuid, text);
drop function if exists proj_output_evidence_restricted(uuid);
drop function if exists proj_is_pm_user(uuid, uuid);
drop function if exists proj_assign_output_reviewer(uuid, uuid);
drop function if exists proj_my_site_assignments();
drop function if exists proj_site_technician_candidates(uuid);
drop function if exists proj_set_activity_readiness(uuid, jsonb);
drop function if exists proj_setup_teams(uuid, jsonb, boolean);
drop function if exists proj_crew_overlaps(uuid, uuid);
drop function if exists proj_activity_range(uuid);
drop function if exists proj_site_technician_eligible(uuid, uuid);
drop function if exists proj_output_reviewer_pool(uuid, uuid, uuid);
drop function if exists proj_is_ops_manager(uuid, uuid);

drop index if exists idx_proj_output_ops_waiting;
alter table proj_task_output_versions drop constraint if exists proj_output_review_route;
alter table proj_task_output_versions drop column if exists reviewer_assigned_by;
alter table proj_task_output_versions drop column if exists reviewer_assigned_at;
alter table proj_task_output_versions drop column if exists reviewer_id;
alter table proj_task_output_versions drop column if exists review_route;

alter table proj_plan_items drop constraint if exists proj_plan_items_readiness;
alter table proj_plan_items drop column if exists ready_note;
alter table proj_plan_items drop column if exists ready_app;
alter table proj_plan_items drop column if exists ready_content;
alter table proj_plan_items drop column if exists ready_hardware;
alter table proj_plan_items drop column if exists crew_instructions;

alter table proj_site_crew drop constraint if exists proj_site_crew_instructions;
alter table proj_site_crew drop constraint if exists proj_site_crew_call_tz;
alter table proj_site_crew drop column if exists instructions;
alter table proj_site_crew drop column if exists call_tz;
alter table proj_site_crew drop column if exists call_at;

alter table proj_teams drop constraint if exists proj_teams_preset_key;
alter table proj_teams drop column if exists preset_key;
alter table proj_teams alter column head_user_id set not null;

alter table proj_change_log drop constraint if exists proj_change_log_entity_type_check;
alter table proj_change_log add constraint proj_change_log_entity_type_check check (entity_type in
  ('project', 'milestone', 'deliverable', 'plan_item', 'booking', 'member', 'message', 'external_dependency', 'task_output', 'site_activity', 'shipment'));

revoke all on function proj_set_site_crew(uuid, jsonb), proj_submit_task_output(uuid, uuid, uuid, integer, text, boolean, text, integer), proj_decide_task_output(uuid, text, text),
  proj_output_version_json(uuid), proj_site_activity_json(uuid, text), proj_work_overview(uuid) from public, anon, authenticated;
grant execute on function proj_set_site_crew(uuid, jsonb), proj_submit_task_output(uuid, uuid, uuid, integer, text, boolean, text, integer), proj_decide_task_output(uuid, text, text), proj_work_overview(uuid) to authenticated;
commit;
