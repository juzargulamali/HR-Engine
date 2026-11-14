-- Projects & Tasks Phase 2: task deliverables with versioned reviews, the Site schedule (activities, crew, shipments) and the Work overview. ADDITIVE ONLY.
-- Applied AFTER 20270105000100 (Project Plan Quick add and order). Nothing here moves or rewrites an existing row.
--
-- Naming: the existing `proj_deliverables` (a piece of work given to a department team) is NOT changed. In this release a "deliverable" on a task means its EXPECTED OUTPUT
-- (what the task must produce: one moodboard, three videos, an app build) and the versions submitted against it. The register ("Deliverables" in Project Plan) reads those.
--
--   1. proj_tasks gets an optional expected output (label, quantity, required). proj_set_task_output sets it (Project Manager, or the head of the task's team).
--   2. proj_task_output_versions: one row per SUBMITTED VERSION of a task's output: who attached it and when (attached_at), which project file or approved link it is (the project's
--      existing proj_files, so file access rules stay the files' own), its review status, and, separately, when it was approved (approved_at). Older versions and their feedback
--      are kept. proj_submit_task_output adds a version (a retry with the same client key adds none); proj_decide_task_output approves or asks for changes on the EXACT version, and
--      refuses a version that is no longer the current one (a stale screen).
--   3. proj_set_task_status (the existing review / completion path) now enforces a REQUIRED output on the server. Tasks without a required output are unchanged.
--   4. proj_deliverables_register: ONE read for the register, the task panel and the export; it hides any file the reader may not open (restricted files stay the manager's).
--   5. Site schedule: proj_plan_items (plan 'site', the existing Site timeline) gains activity kind, run label, location, owner and a Tentative / Confirmed state; proj_site_crew assigns
--      crew per activity and role; proj_site_shipments records departure, expected arrival and return with explicit time zones, linked to the setup it supports and to an Inventory
--      request (state READ from Inventory); proj_save_site_activity / proj_add_site_activities / proj_set_site_crew / proj_save_shipment write them; proj_site_schedule reads them.
--   6. proj_work_overview: Next on site, Needs attention and Recent changes for the Work page, from the same records.
-- ROLLBACK: supabase/manual-sql/proj_phase2_deliverables_site_90_rollback.sql (stops while Phase 2 data exists; restores the previous task status function).

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 1. Expected output on a task
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table proj_tasks add column if not exists output_label text;
alter table proj_tasks add column if not exists output_qty integer;
alter table proj_tasks add column if not exists output_required boolean not null default false;
alter table proj_tasks drop constraint if exists proj_tasks_output_shape;
alter table proj_tasks add constraint proj_tasks_output_shape check (
  (output_label is null and output_qty is null and not output_required)
  or (length(btrim(output_label)) between 1 and 200 and (output_qty is null or output_qty between 1 and 999)));

-- The member-readable change log may now carry output, site and shipment entries (the Work page's Recent changes reads it).
alter table proj_change_log drop constraint if exists proj_change_log_entity_type_check;
alter table proj_change_log add constraint proj_change_log_entity_type_check check (entity_type in
  ('project', 'milestone', 'deliverable', 'plan_item', 'booking', 'member', 'message', 'external_dependency', 'task_output', 'site_activity', 'shipment'));

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 2. Versions of a task's output
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists proj_task_output_versions (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references proj_projects(id) on delete cascade,
  task_id          uuid not null references proj_tasks(id) on delete cascade,
  version_no       integer not null check (version_no >= 1),
  -- The material: an existing project file, or an approved https link (also a proj_files row, kind 'link'). A reference never grants access to a restricted file: reads re-check the file.
  file_id          uuid not null references proj_files(id),
  -- Optional second reference: a stored snapshot (file) of what a mutable link pointed to when it was submitted.
  snapshot_file_id uuid references proj_files(id),
  mutable_link     boolean not null default false,
  item_count       integer not null default 1 check (item_count between 1 and 999),
  note             text check (note is null or length(note) <= 1000),
  submitted_by     uuid not null references auth.users(id),
  attached_at      timestamptz not null default now(),
  status           text not null default 'awaiting' check (status in ('awaiting', 'changes_requested', 'approved', 'superseded')),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_note    text check (decision_note is null or length(decision_note) <= 2000),
  -- Approval is its own event with its own time: an upload, a replacement and an approval are different things.
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  client_key       text check (client_key is null or length(client_key) between 8 and 80),
  constraint proj_output_versions_approved check ((status = 'approved') = (approved_at is not null)),
  constraint proj_output_versions_decided check (status in ('awaiting', 'superseded') or decided_at is not null),
  constraint uq_proj_output_version_no unique (task_id, version_no)
);
create unique index if not exists uq_proj_output_client_key on proj_task_output_versions(task_id, client_key) where client_key is not null;
create index if not exists idx_proj_output_versions_project on proj_task_output_versions(project_id, task_id);
alter table proj_task_output_versions enable row level security;
drop policy if exists proj_output_versions_select on proj_task_output_versions;
create policy proj_output_versions_select on proj_task_output_versions for select using (proj_can_view_details(project_id));
revoke all on table proj_task_output_versions from anon, authenticated, public;
grant select on table proj_task_output_versions to authenticated;

-- Client feedback can be linked to the version (and activation) it is about. Display and history only: a feedback that changes scope, dates or booked equipment still goes
-- through the existing scope-change / change-request paths.
alter table proj_feedback add column if not exists output_version_id uuid references proj_task_output_versions(id);
-- No foreign key on purpose: proj_link_feedback_output checks the activation belongs to the project, and a key to proj_dp_items would stop the earlier Delivery Plan rollback pack from dropping that table.
alter table proj_feedback add column if not exists activation_id uuid;
create index if not exists idx_proj_feedback_output on proj_feedback(output_version_id) where output_version_id is not null;

-- May this reader use this project file? The same rule as the files' own policy (restricted = manager only), for the project the file belongs to.
create or replace function proj_file_usable(p_file_id uuid, p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from proj_files f where f.id = p_file_id and f.project_id = p_project_id and f.deleted_at is null
                   and ((not f.restricted and proj_can_view_details(f.project_id)) or (f.restricted and proj_can_manage(f.project_id))));
$$;

create or replace function proj_set_task_output(p_task_id uuid, p_label text, p_qty integer default null, p_required boolean default false, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t proj_tasks; v proj_projects; v_role text; v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  v_role := proj_task_actor_role(t);
  if v_role is null or v_role not in ('manager', 'head') then raise exception 'Only the Project Manager or the head of the task''s team can set the expected output' using errcode = '42501'; end if;
  perform proj_check_version(t.version, p_expected_version);
  if t.status in ('cancelled', 'deferred') then raise exception 'This task is % and cannot take an expected output', t.status using errcode = '23514'; end if;
  if v_label is null and (p_required or p_qty is not null) then raise exception 'Name the expected output (for example "Moodboard")' using errcode = '22023'; end if;
  if p_qty is not null and (p_qty < 1 or p_qty > 999) then raise exception 'The quantity must be between 1 and 999' using errcode = '22023'; end if;
  if v_label is null and exists (select 1 from proj_task_output_versions where task_id = t.id) then
    raise exception 'Versions were already submitted, so the expected output cannot be removed' using errcode = '23514';
  end if;
  if t.output_label is not distinct from v_label and t.output_qty is not distinct from p_qty and t.output_required = coalesce(p_required, false) then
    return jsonb_build_object('id', t.id, 'unchanged', true);
  end if;
  update proj_tasks set output_label = v_label, output_qty = case when v_label is null then null else p_qty end, output_required = case when v_label is null then false else coalesce(p_required, false) end,
         version = version + 1 where id = t.id;
  perform proj_task_event(t.id, v.id, 'output_expected', t.output_label, v_label, case when coalesce(p_required, false) then 'required' else 'optional' end);
  perform proj_log_change(v.id, 'task_output', t.id, 'expected output', t.output_label, v_label, case when coalesce(p_required, false) then 'Required' else 'Optional' end);
  return jsonb_build_object('id', t.id, 'updated', true);
end;
$$;

-- Submit a NEW VERSION. A retry with the same client key returns the version already made. Older awaiting versions become superseded (their own decision stays what it was).
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

-- Approve, or ask for changes on, ONE version. It must be the current one; the reviewer is the Project Manager or the head of the team and never the person who did the work.
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

create or replace function proj_link_feedback_output(p_feedback_id uuid, p_version_id uuid default null, p_activation_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare f proj_feedback; v proj_projects;
begin
  perform proj_require_user();
  select * into f from proj_feedback where id = p_feedback_id for update;
  if not found then raise exception 'Feedback not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(f.project_id);
  perform proj_require_open_project(v);
  if not proj_can_manage(v.id) then raise exception 'Only the Project Manager can link feedback to a version or an activation' using errcode = '42501'; end if;
  if p_version_id is not null and not exists (select 1 from proj_task_output_versions where id = p_version_id and project_id = v.id) then raise exception 'Version not found' using errcode = 'P0002'; end if;
  if p_activation_id is not null and not exists (select 1 from proj_dp_items where id = p_activation_id and project_id = v.id and removed_at is null) then raise exception 'Activation not found' using errcode = 'P0002'; end if;
  update proj_feedback set output_version_id = p_version_id, activation_id = p_activation_id where id = f.id;
end;
$$;


-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 3. The existing review / completion path, now enforcing a REQUIRED output (the previous body, plus one block before the status update)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_set_task_status(p_task_id uuid, p_to text, p_note text default null, p_expected_version integer default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t proj_tasks;
  v proj_projects;
  v_role text;
  v_is_reviewer boolean;
  v_reviewer uuid;
  cv proj_task_output_versions;
begin
  perform proj_require_user();
  select * into t from proj_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(t.project_id);
  perform proj_require_open_project(v);
  v_role := proj_task_actor_role(t);
  if v_role is null then raise exception 'Only the assignee, the department head or the Project Manager can change this task' using errcode = '42501'; end if;
  perform proj_check_version(t.version, p_expected_version);
  if t.status = p_to then return; end if;
  if p_to not in ('todo', 'in_progress', 'ready_for_review', 'done', 'cancelled', 'deferred') then
    raise exception 'Unknown task status %', p_to using errcode = '22023';
  end if;
  v_is_reviewer := v_role in ('manager', 'head') and t.assignee_id <> auth.uid();

  if t.status in ('done', 'cancelled', 'deferred') then
    if p_to not in ('in_progress', 'todo') or v_role not in ('manager', 'head') then
      raise exception 'Only the department head or the Project Manager can reopen a % task, back to To do or In progress', t.status using errcode = '42501';
    end if;
    if length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Say why the task is being reopened' using errcode = '22023'; end if;
  elsif p_to = 'done' then
    if t.requires_review then
      if t.status <> 'ready_for_review' then raise exception 'This task needs review: send it for review first' using errcode = '23514'; end if;
      if not v_is_reviewer then
        raise exception 'This task needs review by the department head or the Project Manager, not by the person who did it' using errcode = '42501';
      end if;
    elsif v_role = 'assignee' or v_role in ('manager', 'head') then
      null;
    end if;
    if t.blocked_at is not null then raise exception 'Clear the blocker before completing the task' using errcode = '23514'; end if;
  elsif p_to = 'ready_for_review' then
    if not t.requires_review then raise exception 'This task does not need review: mark it Done' using errcode = '23514'; end if;
  elsif p_to = 'in_progress' and t.status = 'ready_for_review' then
    if not v_is_reviewer and v_role <> 'assignee' then raise exception 'Not allowed' using errcode = '42501'; end if;
    -- Reviewer requesting changes should say what; the assignee withdrawing from review needs no note.
    if v_role <> 'assignee' and length(btrim(coalesce(p_note, ''))) = 0 then
      raise exception 'Say what needs changing' using errcode = '22023';
    end if;
  elsif p_to in ('cancelled', 'deferred') then
    if v_role not in ('manager', 'head') then raise exception 'Only the department head or the Project Manager can cancel or defer a task' using errcode = '42501'; end if;
    if length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Say why the task is %', p_to using errcode = '22023'; end if;
  end if;

  -- Phase 2: a task whose expected output is required needs a current submitted version before it is sent for review or completed, and (for a task that needs review)
  -- an APPROVED current version before it is done. Tasks without a required output are untouched.
  if t.output_required and p_to in ('ready_for_review', 'done') and t.status not in ('done', 'cancelled', 'deferred') then
    select * into cv from proj_task_output_versions where task_id = t.id order by version_no desc limit 1;
    if not found then
      raise exception 'This task needs its expected output (%) before it can be %. Add it under Expected output.', t.output_label, case when p_to = 'done' then 'completed' else 'sent for review' end using errcode = '23514';
    end if;
    if cv.status = 'changes_requested' then
      raise exception 'Changes were requested on version %. Submit a new version of the output first.', cv.version_no using errcode = '23514';
    end if;
    if cv.item_count < coalesce(t.output_qty, 1) then
      raise exception 'The expected output is % x %, but version % has %. Submit the rest first.', coalesce(t.output_qty, 1), t.output_label, cv.version_no, cv.item_count using errcode = '23514';
    end if;
    if p_to = 'done' and t.requires_review and cv.status <> 'approved' then
      raise exception 'Version % of the output has not been approved. Approve it first.', cv.version_no using errcode = '23514';
    end if;
  end if;

  update proj_tasks set status = p_to, version = version + 1,
         completed_at = case when p_to = 'done' then now() else null end,
         completed_by = case when p_to = 'done' then auth.uid() else null end
   where id = t.id;
  perform proj_task_event(t.id, v.id, 'status_changed', t.status, p_to, p_note);

  if p_to = 'ready_for_review' then
    v_reviewer := coalesce((select head_user_id from proj_teams where id = t.team_id and head_user_id <> t.assignee_id), v.pm_user_id);
    perform proj_notify(v.id, v_reviewer, 'project_review_requested',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title), 'task:' || t.id || ':review:' || (t.version + 1));
  elsif t.status = 'ready_for_review' and p_to in ('in_progress', 'done') and v_is_reviewer then
    perform proj_notify(v.id, t.assignee_id, 'project_review_result',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'task_id', t.id, 'task', t.title, 'result', p_to), 'task:' || t.id || ':result:' || (t.version + 1));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 4. The register / task panel read: ONE call, scoped to the reader. A file the reader may not open is reported as "restricted" with no name, link or size.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_output_file_json(p_file_id uuid, p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when f.id is null then null
    when f.deleted_at is not null then jsonb_build_object('id', null, 'accessible', false, 'removed', true)
    when (not f.restricted and proj_can_view_details(f.project_id)) or (f.restricted and proj_can_manage(f.project_id)) then
      jsonb_build_object('id', f.id, 'accessible', true, 'kind', f.kind, 'name', coalesce(f.label, f.original_name, f.url), 'url', f.url, 'mime', f.mime_type, 'size', f.size_bytes, 'restricted', f.restricted)
    else jsonb_build_object('id', null, 'accessible', false, 'restricted', true) end
  from (select 1) s left join proj_files f on f.id = p_file_id and f.project_id = p_project_id;
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

create or replace function proj_deliverables_register(p_project_id uuid, p_task_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_rows jsonb;
begin
  perform proj_require_user();
  if not exists (select 1 from proj_projects where id = p_project_id) or not proj_can_view_details(p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  select site_timezone into v_tz from proj_project_details where project_id = p_project_id;
  select coalesce(jsonb_agg(r.j order by r.act_key nulls last, r.due nulls last, r.title), '[]'::jsonb) into v_rows from (
    select t.title, t.due_date as due, act.item_key as act_key, jsonb_build_object(
      'task_id', t.id, 'task_title', t.title, 'task_status', t.status, 'task_due', t.due_date, 'blocked', t.blocked_at is not null, 'requires_review', t.requires_review, 'team_id', t.team_id,
      'assignee_id', t.assignee_id, 'assignee_name', proj_display_name(t.assignee_id),
      'output_label', t.output_label, 'output_qty', t.output_qty, 'output_required', t.output_required,
      'activation', case when act.id is null then null else jsonb_build_object('id', act.id, 'key', act.item_key, 'title', act.title) end,
      'milestone', case when m.id is null then null else jsonb_build_object('id', m.id, 'title', m.title, 'status', m.status) end,
      'state', case when cur.id is null then 'missing' when cur.status = 'changes_requested' then 'changes_requested'
                    when cur.item_count < coalesce(t.output_qty, 1) then 'partial' when cur.status = 'approved' then 'approved' else 'awaiting_review' end,
      'versions_count', (select count(*) from proj_task_output_versions z where z.task_id = t.id),
      'current', case when cur.id is null then null else proj_output_version_json(cur.id) end,
      'versions', coalesce((select jsonb_agg(proj_output_version_json(z.id) order by z.version_no desc) from proj_task_output_versions z where z.task_id = t.id), '[]'::jsonb)) as j
    from proj_tasks t
    left join lateral (select i.id, i.item_key, i.title from proj_dp_lines l join proj_dp_items i on i.id = l.item_id where l.task_id = t.id and l.removed_at is null limit 1) act on true
    left join proj_milestones m on m.id = t.milestone_id
    left join lateral (select z.id, z.status, z.item_count from proj_task_output_versions z where z.task_id = t.id order by z.version_no desc limit 1) cur on true
    where t.project_id = p_project_id and t.output_label is not null and t.status not in ('cancelled', 'deferred') and (p_task_id is null or t.id = p_task_id)) r;
  return jsonb_build_object('tz', v_tz, 'rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 5. Site schedule: activities (the existing Site timeline items), crew per activity, shipments
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table proj_plan_items add column if not exists activity_kind text check (activity_kind in ('mockup', 'setup', 'show', 'dismantling', 'other'));
alter table proj_plan_items add column if not exists run_label text check (run_label is null or length(btrim(run_label)) between 1 and 60);
alter table proj_plan_items add column if not exists location text check (location is null or length(btrim(location)) between 1 and 200);
alter table proj_plan_items add column if not exists owner_id uuid references auth.users(id);
alter table proj_plan_items add column if not exists activity_state text not null default 'tentative' check (activity_state in ('tentative', 'confirmed'));
alter table proj_plan_items add column if not exists confirmed_at timestamptz;
alter table proj_plan_items add column if not exists confirmed_by uuid references auth.users(id);
alter table proj_plan_items add column if not exists client_key text check (client_key is null or length(client_key) between 8 and 80);
alter table proj_plan_items drop constraint if exists proj_plan_items_confirmed;
alter table proj_plan_items add constraint proj_plan_items_confirmed check ((activity_state = 'confirmed') = (confirmed_at is not null));
create unique index if not exists uq_proj_plan_items_client_key on proj_plan_items(project_id, client_key) where client_key is not null;

create table if not exists proj_site_crew (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references proj_projects(id) on delete cascade,
  plan_item_id  uuid not null references proj_plan_items(id) on delete cascade,
  user_id       uuid not null references auth.users(id),
  crew_role     text not null check (crew_role in ('installation', 'standby', 'backup', 'dismantling')),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  constraint uq_proj_site_crew unique (plan_item_id, user_id, crew_role)
);
create index if not exists idx_proj_site_crew_project on proj_site_crew(project_id);
alter table proj_site_crew enable row level security;
drop policy if exists proj_site_crew_select on proj_site_crew;
create policy proj_site_crew_select on proj_site_crew for select using (proj_can_view_details(project_id));
revoke all on table proj_site_crew from anon, authenticated, public;
grant select on table proj_site_crew to authenticated;

create table if not exists proj_site_shipments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references proj_projects(id) on delete cascade,
  label         text not null check (length(btrim(label)) between 1 and 200),
  plan_item_id  uuid references proj_plan_items(id) on delete set null,      -- the setup this shipment supports
  request_id    uuid references inv_requests(id),                              -- the Inventory request it carries: its reservation / dispatch / return state is READ from Inventory
  carrier       text check (carrier is null or length(carrier) <= 200),
  reference     text check (reference is null or length(reference) <= 200),
  departs_at    timestamptz,
  departs_tz    text,
  arrives_at    timestamptz,
  arrives_tz    text,
  returns_at    timestamptz,
  returns_tz    text,
  state         text not null default 'tentative' check (state in ('tentative', 'confirmed')),
  confirmed_at  timestamptz,
  notes         text check (notes is null or length(notes) <= 1000),
  client_key    text check (client_key is null or length(client_key) between 8 and 80),
  created_by    uuid references auth.users(id),
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint proj_shipments_tz check ((departs_tz is null or proj_valid_timezone(departs_tz)) and (arrives_tz is null or proj_valid_timezone(arrives_tz)) and (returns_tz is null or proj_valid_timezone(returns_tz))),
  constraint proj_shipments_order check (departs_at is null or arrives_at is null or arrives_at >= departs_at),
  constraint proj_shipments_return check (returns_at is null or arrives_at is null or returns_at >= arrives_at),
  constraint proj_shipments_confirmed check ((state = 'confirmed') = (confirmed_at is not null))
);
create unique index if not exists uq_proj_shipments_client_key on proj_site_shipments(project_id, client_key) where client_key is not null;
create index if not exists idx_proj_shipments_project on proj_site_shipments(project_id);
alter table proj_site_shipments enable row level security;
drop policy if exists proj_site_shipments_select on proj_site_shipments;
create policy proj_site_shipments_select on proj_site_shipments for select using (proj_can_view_details(project_id));
revoke all on table proj_site_shipments from anon, authenticated, public;
grant select on table proj_site_shipments to authenticated;

-- Save one Site activity. Builds on proj_save_plan_item (so dates, time zones, versions and its change log are the existing ones) and adds the activity facts. A CONFIRMED activity's
-- date or time cannot change without saying why; confirming needs a date. A retry with the same client key returns the activity already made.
create or replace function proj_save_site_activity(p_project_id uuid, p_item_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; i proj_plan_items; n proj_plan_items; v_id uuid; v_kind text; v_state text; v_owner uuid; v_base jsonb; v_reason text := nullif(btrim(coalesce(p_fields->>'reason', '')), '');
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if p_item_id is null and nullif(p_fields->>'client_key', '') is not null then
    select id into v_id from proj_plan_items where project_id = v.id and client_key = p_fields->>'client_key';
    if found then return jsonb_build_object('id', v_id, 'existing', true); end if;
  end if;
  if p_item_id is not null then
    select * into i from proj_plan_items where id = p_item_id and project_id = v.id and plan = 'site' for update;
    if not found then raise exception 'Site activity not found' using errcode = 'P0002'; end if;
  end if;
  v_kind := coalesce(nullif(p_fields->>'activity_kind', ''), i.activity_kind);
  if v_kind is null or v_kind not in ('mockup', 'setup', 'show', 'dismantling', 'other') then raise exception 'Choose the kind of activity: Mockup, Setup, Show, Dismantling or Other' using errcode = '22023'; end if;
  v_state := coalesce(nullif(p_fields->>'activity_state', ''), i.activity_state, 'tentative');
  if v_state not in ('tentative', 'confirmed') then raise exception 'Choose Tentative or Confirmed' using errcode = '22023'; end if;
  if p_fields ? 'owner_id' then
    v_owner := nullif(p_fields->>'owner_id', '')::uuid;
    if v_owner is not null and not proj_dp_active_member(v.id, v_owner) then raise exception 'The owner must be an active member of the project' using errcode = '22023'; end if;
  else v_owner := i.owner_id; end if;
  v_base := (p_fields - 'activity_kind' - 'run_label' - 'location' - 'owner_id' - 'activity_state' - 'client_key' - 'reason') || jsonb_build_object('plan', 'site');
  if i.id is null and nullif(btrim(coalesce(v_base->>'title', '')), '') is null then
    v_base := v_base || jsonb_build_object('title', initcap(v_kind) || coalesce(' (' || nullif(btrim(coalesce(p_fields->>'run_label', '')), '') || ')', ''));
  end if;
  v_id := proj_save_plan_item(v.id, i.id, v_base);
  select * into n from proj_plan_items where id = v_id for update;
  if i.id is not null and i.activity_state = 'confirmed'
     and (i.start_date, i.end_date, i.starts_at, i.ends_at) is distinct from (n.start_date, n.end_date, n.starts_at, n.ends_at) and v_reason is null then
    raise exception 'This activity is confirmed. Say why its date or time is changing' using errcode = '23514';
  end if;
  if v_state = 'confirmed' and n.start_date is null and n.starts_at is null then raise exception 'Add a date before confirming (the time can follow)' using errcode = '23514'; end if;
  update proj_plan_items set activity_kind = v_kind,
    run_label = case when p_fields ? 'run_label' then nullif(btrim(coalesce(p_fields->>'run_label', '')), '') else run_label end,
    location = case when p_fields ? 'location' then nullif(btrim(coalesce(p_fields->>'location', '')), '') else location end,
    owner_id = v_owner, activity_state = v_state,
    confirmed_at = case when v_state = 'confirmed' then coalesce(confirmed_at, now()) else null end,
    confirmed_by = case when v_state = 'confirmed' then coalesce(confirmed_by, auth.uid()) else null end,
    client_key = coalesce(nullif(p_fields->>'client_key', ''), client_key)
   where id = v_id;
  if i.id is null then
    perform proj_log_change(v.id, 'site_activity', v_id, 'added', null, v_kind || ': ' || n.title, null);
  else
    perform proj_log_change(v.id, 'site_activity', v_id, 'state', i.activity_state, v_state, v_reason);
    if i.activity_state = 'confirmed' and (i.start_date, i.end_date, i.starts_at, i.ends_at) is distinct from (n.start_date, n.end_date, n.starts_at, n.ends_at) then
      perform proj_log_change(v.id, 'site_activity', v_id, 'date',
        coalesce(i.start_date::text, i.starts_at::text, '') || coalesce(' to ' || coalesce(i.end_date::text, i.ends_at::text), ''),
        coalesce(n.start_date::text, n.starts_at::text, '') || coalesce(' to ' || coalesce(n.end_date::text, n.ends_at::text), ''), v_reason);
    end if;
  end if;
  if i.id is null and v_state = 'confirmed' then perform proj_log_change(v.id, 'site_activity', v_id, 'state', 'tentative', 'confirmed', null); end if;
  return jsonb_build_object('id', v_id, case when i.id is null then 'created' else 'updated' end, true);
end;
$$;

-- Quick entry: several activities in one call (up to 25). A row that matches an existing activity (same kind, name and start day) is reported as existing and left alone.
create or replace function proj_add_site_activities(p_project_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v proj_projects; r jsonb; n integer := 0; v_created integer := 0; v_existing integer := 0; v_title text; v_day text; v_ids jsonb := '[]'::jsonb; res jsonb; v_tz text;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Add at least one activity' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 25 then raise exception 'Add at most 25 activities at a time' using errcode = '22023'; end if;
  select coalesce(site_timezone, 'UTC') into v_tz from proj_project_details where project_id = v.id;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    v_title := coalesce(nullif(btrim(coalesce(r->>'title', '')), ''), initcap(coalesce(r->>'activity_kind', 'activity')) || coalesce(' (' || nullif(btrim(coalesce(r->>'run_label', '')), '') || ')', ''));
    v_day := coalesce(nullif(r->>'start_date', ''), left(nullif(r->>'starts_local', ''), 10), '');
    if exists (select 1 from proj_plan_items i where i.project_id = v.id and i.plan = 'site' and i.activity_kind is not distinct from (r->>'activity_kind') and lower(btrim(i.title)) = lower(v_title)
                 and coalesce(i.start_date::text, to_char(i.starts_at at time zone coalesce(i.tz, v_tz), 'YYYY-MM-DD'), '') = v_day) then
      v_existing := v_existing + 1;
      continue;
    end if;
    begin
      res := proj_save_site_activity(v.id, null, r || jsonb_build_object('title', v_title));
    exception when others then
      raise exception 'Row %: %', n, sqlerrm using errcode = sqlstate;
    end;
    v_created := v_created + 1;
    v_ids := v_ids || to_jsonb((res->>'id')::uuid);
  end loop;
  return jsonb_build_object('ids', v_ids, 'created', v_created, 'existing', v_existing);
end;
$$;

-- The crew of ONE activity, set as a whole (idempotent): rows are {user_id, role}; people not listed are removed; the same set again changes nothing.
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

create or replace function proj_save_shipment(p_project_id uuid, p_shipment_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v proj_projects; s proj_site_shipments; d proj_project_details; v_id uuid; v_tz text; v_label text; v_item uuid; v_req uuid; v_state text;
  v_dep timestamptz; v_arr timestamptz; v_ret timestamptz; v_dtz text; v_atz text; v_rtz text; v_reason text := nullif(btrim(coalesce(p_fields->>'reason', '')), '');
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  select * into d from proj_project_details where project_id = v.id;
  v_tz := coalesce(d.site_timezone, 'UTC');
  if p_shipment_id is null and nullif(p_fields->>'client_key', '') is not null then
    select id into v_id from proj_site_shipments where project_id = v.id and client_key = p_fields->>'client_key';
    if found then return jsonb_build_object('id', v_id, 'existing', true); end if;
  end if;
  if p_shipment_id is not null then
    select * into s from proj_site_shipments where id = p_shipment_id and project_id = v.id for update;
    if not found then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
    perform proj_check_version(s.version, nullif(p_fields->>'expected_version', '')::integer);
  end if;
  v_label := coalesce(nullif(btrim(coalesce(p_fields->>'label', '')), ''), s.label);
  if v_label is null then raise exception 'Name the shipment (for example "Equipment from Dubai")' using errcode = '22023'; end if;
  v_item := case when p_fields ? 'plan_item_id' then nullif(p_fields->>'plan_item_id', '')::uuid else s.plan_item_id end;
  if v_item is not null and not exists (select 1 from proj_plan_items where id = v_item and project_id = v.id and plan = 'site') then raise exception 'Choose one of this project''s site activities' using errcode = '22023'; end if;
  v_req := case when p_fields ? 'request_id' then nullif(p_fields->>'request_id', '')::uuid else s.request_id end;
  if v_req is not null and not exists (select 1 from inv_requests where id = v_req and project_id = v.id and status <> 'cancelled') then raise exception 'Choose one of this project''s equipment requests' using errcode = '22023'; end if;
  v_dtz := coalesce(nullif(p_fields->>'departs_tz', ''), s.departs_tz, v_tz);
  v_atz := coalesce(nullif(p_fields->>'arrives_tz', ''), s.arrives_tz, v_tz);
  v_rtz := coalesce(nullif(p_fields->>'returns_tz', ''), s.returns_tz, v_atz);
  if not (proj_valid_timezone(v_dtz) and proj_valid_timezone(v_atz) and proj_valid_timezone(v_rtz)) then raise exception 'Unknown time zone' using errcode = '22023'; end if;
  v_dep := case when p_fields ? 'departs_local' then (nullif(p_fields->>'departs_local', '')::timestamp at time zone v_dtz) else s.departs_at end;
  v_arr := case when p_fields ? 'arrives_local' then (nullif(p_fields->>'arrives_local', '')::timestamp at time zone v_atz) else s.arrives_at end;
  v_ret := case when p_fields ? 'returns_local' then (nullif(p_fields->>'returns_local', '')::timestamp at time zone v_rtz) else s.returns_at end;
  if v_dep is not null and v_arr is not null and v_arr < v_dep then raise exception 'The shipment cannot arrive before it departs' using errcode = '23514'; end if;
  if v_ret is not null and v_arr is not null and v_ret < v_arr then raise exception 'The return cannot be before the arrival' using errcode = '23514'; end if;
  v_state := coalesce(nullif(p_fields->>'state', ''), s.state, 'tentative');
  if v_state not in ('tentative', 'confirmed') then raise exception 'Choose Tentative or Confirmed' using errcode = '22023'; end if;
  if v_state = 'confirmed' and v_arr is null and v_dep is null then raise exception 'Add a departure or an expected arrival before confirming' using errcode = '23514'; end if;
  if s.id is not null and s.state = 'confirmed' and (s.departs_at, s.arrives_at, s.returns_at) is distinct from (v_dep, v_arr, v_ret) and v_reason is null then
    raise exception 'This shipment is confirmed. Say why its time is changing' using errcode = '23514';
  end if;
  if s.id is null then
    insert into proj_site_shipments (project_id, label, plan_item_id, request_id, carrier, reference, departs_at, departs_tz, arrives_at, arrives_tz, returns_at, returns_tz, state, confirmed_at, notes, client_key, created_by)
    values (v.id, v_label, v_item, v_req, nullif(btrim(coalesce(p_fields->>'carrier', '')), ''), nullif(btrim(coalesce(p_fields->>'reference', '')), ''), v_dep, v_dtz, v_arr, v_atz, v_ret, v_rtz,
            v_state, case when v_state = 'confirmed' then now() end, nullif(btrim(coalesce(p_fields->>'notes', '')), ''), nullif(p_fields->>'client_key', ''), auth.uid())
    returning id into v_id;
    perform proj_log_change(v.id, 'shipment', v_id, 'added', null, v_label, null);
    return jsonb_build_object('id', v_id, 'created', true);
  end if;
  update proj_site_shipments set label = v_label, plan_item_id = v_item, request_id = v_req,
    carrier = case when p_fields ? 'carrier' then nullif(btrim(coalesce(p_fields->>'carrier', '')), '') else carrier end,
    reference = case when p_fields ? 'reference' then nullif(btrim(coalesce(p_fields->>'reference', '')), '') else reference end,
    departs_at = v_dep, departs_tz = v_dtz, arrives_at = v_arr, arrives_tz = v_atz, returns_at = v_ret, returns_tz = v_rtz,
    state = v_state, confirmed_at = case when v_state = 'confirmed' then coalesce(confirmed_at, now()) else null end,
    notes = case when p_fields ? 'notes' then nullif(btrim(coalesce(p_fields->>'notes', '')), '') else notes end,
    version = version + 1, updated_at = now()
   where id = s.id;
  perform proj_log_change(v.id, 'shipment', s.id, 'state', s.state, v_state, v_reason);
  if (s.departs_at, s.arrives_at, s.returns_at) is distinct from (v_dep, v_arr, v_ret) then
    perform proj_log_change(v.id, 'shipment', s.id, 'arrival', s.arrives_at::text, v_arr::text, v_reason);
  end if;
  return jsonb_build_object('id', s.id, 'updated', true);
end;
$$;

create or replace function proj_remove_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s proj_site_shipments; v proj_projects;
begin
  select * into s from proj_site_shipments where id = p_shipment_id;
  if not found then return; end if;
  v := proj_lock_project(s.project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  delete from proj_site_shipments where id = s.id;
  perform proj_log_change(v.id, 'shipment', s.id, 'removed', s.label, null, null);
end;
$$;

-- One activity as JSON, with crew and what is missing. Internal: callers have checked access.
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

create or replace function proj_site_schedule(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tz text; d proj_project_details; v_acts jsonb; v_ship jsonb;
begin
  perform proj_require_user();
  if not exists (select 1 from proj_projects where id = p_project_id) or not proj_can_view_details(p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  select * into d from proj_project_details where project_id = p_project_id;
  v_tz := d.site_timezone;
  select coalesce(jsonb_agg(proj_site_activity_json(i.id, v_tz) order by coalesce(i.starts_at, (i.start_date::timestamp at time zone coalesce(v_tz, 'UTC'))) nulls last, i.sort_order, i.title), '[]'::jsonb)
    into v_acts from proj_plan_items i where i.project_id = p_project_id and i.plan = 'site';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'label', s.label, 'plan_item_id', s.plan_item_id, 'activity_title', a.title, 'carrier', s.carrier, 'reference', s.reference, 'notes', s.notes, 'state', s.state, 'version', s.version,
      'departs_at', s.departs_at, 'departs_tz', coalesce(s.departs_tz, v_tz), 'arrives_at', s.arrives_at, 'arrives_tz', coalesce(s.arrives_tz, v_tz), 'returns_at', s.returns_at, 'returns_tz', coalesce(s.returns_tz, s.arrives_tz, v_tz),
      'request', case when s.request_id is null then null else inv_request_state(s.request_id) end,
      'missing', (select coalesce(jsonb_agg(m), '[]'::jsonb) from (select 'arrival' as m where s.arrives_at is null union all select 'departure' where s.departs_at is null) q),
      'conflict', case when s.arrives_at is not null and a.id is not null and (
                      (a.starts_at is not null and s.arrives_at > a.starts_at)
                      or (a.starts_at is null and a.start_date is not null and (s.arrives_at at time zone coalesce(s.arrives_tz, v_tz, 'UTC'))::date > a.start_date))
                    then jsonb_build_object('type', 'late', 'setup_title', a.title, 'setup_start', coalesce(a.starts_at::text, a.start_date::text), 'setup_has_time', a.starts_at is not null) else null end)
      order by coalesce(s.arrives_at, s.departs_at) nulls last, s.label), '[]'::jsonb)
    into v_ship from proj_site_shipments s left join proj_plan_items a on a.id = s.plan_item_id where s.project_id = p_project_id;
  return jsonb_build_object('tz', v_tz, 'committed', jsonb_build_object('install_start', d.install_start, 'event_start', d.event_start, 'event_end', d.event_end), 'activities', v_acts, 'shipments', v_ship);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 6. The Work overview: Next on site, Needs attention, Recent changes. Read-only, from the records above.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
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

revoke all on function
  proj_file_usable(uuid, uuid), proj_set_task_output(uuid, text, integer, boolean, integer), proj_submit_task_output(uuid, uuid, uuid, integer, text, boolean, text, integer),
  proj_decide_task_output(uuid, text, text), proj_link_feedback_output(uuid, uuid, uuid), proj_output_file_json(uuid, uuid), proj_output_version_json(uuid),
  proj_deliverables_register(uuid, uuid), proj_save_site_activity(uuid, uuid, jsonb), proj_add_site_activities(uuid, jsonb), proj_set_site_crew(uuid, jsonb),
  proj_save_shipment(uuid, uuid, jsonb), proj_remove_shipment(uuid), proj_site_activity_json(uuid, text), proj_site_schedule(uuid), proj_work_overview(uuid)
  from public, anon, authenticated;
grant execute on function
  proj_set_task_output(uuid, text, integer, boolean, integer), proj_submit_task_output(uuid, uuid, uuid, integer, text, boolean, text, integer), proj_decide_task_output(uuid, text, text),
  proj_link_feedback_output(uuid, uuid, uuid), proj_deliverables_register(uuid, uuid), proj_save_site_activity(uuid, uuid, jsonb), proj_add_site_activities(uuid, jsonb),
  proj_set_site_crew(uuid, jsonb), proj_save_shipment(uuid, uuid, jsonb), proj_remove_shipment(uuid), proj_site_schedule(uuid), proj_work_overview(uuid) to authenticated;
