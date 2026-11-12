-- Projects & Tasks Phase 2, part 2: the Project Closeout Report. ADDITIVE ONLY. Applied AFTER 20261231000100 (it reads the Delivery Plan).
-- Three new tables (the reports, a daily usage counter and the record of provider calls per reviewed content) and ten functions; no existing table, policy or
-- function is changed.
--
-- WHAT IT IS
--   An INTERNAL report the Project Manager drafts from the project's own records, edits, and approves as a version. Generating or approving a report never completes a
--   project, approves work, sends a message or changes stock: these functions write to proj_closeout_reports only.
--
-- THE EVIDENCE SNAPSHOT (proj_closeout_evidence) is built here, in the database, from an explicit allowlist: every value below is selected by name. It contains
--   the project and its dates, the handover as accepted (the original agreement), the agreed scope now, the team by display name and role with what each person owned,
--   milestones, the delivery plan with the state of its linked tasks and equipment lines, task counts and the open, deferred and cancelled ones, decisions (scope changes,
--   plan changes, corrections) with who decided, when and the recorded reason, client feedback with our recorded response, the completion record and its sign-off evidence
--   type, and equipment sent, returned and still out.
--   It NEVER selects: an enquiry's or project's value, budget, costs, margins or payment terms; estimates, proposals or quotations; the project budget and expenses; payroll
--   or any employee record; chat messages; task comments; files, attachments or their links; emails, phone numbers or other contact details (a client contact's name on the
--   completion record is not selected either); credentials.
--   Display names come from proj_display_name. A source that cannot be read (Inventory not installed, for example) is listed under "missing", so the report says so instead
--   of reading as "nothing".
--
-- WHO: only whoever manages the project (proj_can_manage: Project Manager, temporary leader, founder) can read the evidence, or read, draft, edit or approve a report.
-- ONE DRAFT per project at a time (unique index), so a retried generation updates the same draft and never makes a second. An approved version is frozen: it keeps its own
--   snapshot, the time the snapshot was taken and its source references, so a later project edit cannot rewrite it. A new draft after an approval gets the next version number.
-- ROLLBACK: supabase/manual-sql/proj_closeout_reports_90_rollback.sql (export proj_closeout_reports first: approved reports are deleted).

create table if not exists proj_closeout_reports (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references proj_projects(id) on delete cascade,
  version_no       integer not null,
  status           text not null default 'draft' check (status in ('draft', 'approved')),
  -- The evidence the report rests on, frozen with the report, and when it was taken.
  snapshot         jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_at      timestamptz not null,
  -- What the Project Manager chose to include from the optional content, and the fingerprint of exactly what was sent (or would be sent) to the AI provider.
  selection        jsonb not null default '{}'::jsonb,
  payload_hash     text not null check (length(payload_hash) between 16 and 128),
  -- 'none' = written without the AI provider (facts only); 'generated' = the provider's draft is stored. A failed attempt stores nothing.
  generation       text not null default 'none' check (generation in ('none', 'generated')),
  provider_kind    text check (provider_kind is null or provider_kind in ('anthropic', 'simulated')),
  -- The sections as the PM last saved them: [{ "id": text, "title": text, "paragraphs": [{ "text": text, "refs": [text], "flags": [text] }] }]
  sections         jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  -- The source references the report cites: [{ "ref": "S1", "category": text, "label": text, "source_type": text, "source_id": uuid|null }]
  source_refs      jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  version          integer not null default 1,
  constraint proj_closeout_reports_approved check ((status = 'approved') = (approved_at is not null))
);
create unique index if not exists uq_proj_closeout_reports_version on proj_closeout_reports(project_id, version_no);
create unique index if not exists uq_proj_closeout_reports_draft on proj_closeout_reports(project_id) where status = 'draft';

alter table proj_closeout_reports enable row level security;
drop policy if exists proj_closeout_reports_select on proj_closeout_reports;
create policy proj_closeout_reports_select on proj_closeout_reports for select using (proj_can_manage(project_id));
revoke all on table proj_closeout_reports from anon, authenticated, public;
grant select on table proj_closeout_reports to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The evidence snapshot. Every block is its own allowlist; a block that cannot be read is named under "missing".
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_closeout_evidence(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pr proj_projects; d proj_project_details; h proj_handovers; c proj_completions;
  v_missing jsonb := '[]'::jsonb; v_team jsonb; v_milestones jsonb; v_tasks jsonb; v_decisions jsonb := '[]'::jsonb; v_feedback jsonb; v_plan jsonb := '[]'::jsonb;
  v_equipment jsonb := 'null'::jsonb; v_part jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into pr from proj_projects where id = p_project_id;
  if not found or not proj_can_manage(p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  select * into d from proj_project_details where project_id = pr.id;
  select * into h from proj_handovers where project_id = pr.id and status = 'accepted' order by accepted_at desc limit 1;
  select * into c from proj_completions where project_id = pr.id and reopened_at is null order by completed_at desc limit 1;

  -- Team: display name, role, department team, and what each person owned. No contact detail, no employee record.
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', m.user_id, 'name', proj_display_name(m.user_id),
      'role', case when pr.pm_user_id = m.user_id then 'Project Manager' when m.role = 'acting_pm' then 'Temporary project leader' else 'Member' end,
      'team', (select t.name from proj_teams t where t.id = m.team_id and t.removed_at is null),
      'heads', coalesce((select jsonb_agg(t.name order by t.name) from proj_teams t where t.project_id = pr.id and t.head_user_id = m.user_id and t.removed_at is null), '[]'::jsonb),
      'active', m.removed_at is null,
      'tasks_done', (select count(*) from proj_tasks t where t.project_id = pr.id and t.assignee_id = m.user_id and t.status = 'done'),
      'tasks_assigned', (select count(*) from proj_tasks t where t.project_id = pr.id and t.assignee_id = m.user_id and t.status <> 'cancelled'),
      'milestones_accepted', (select count(*) from proj_milestones ms where ms.project_id = pr.id and ms.accepted_by = m.user_id),
      'deliverables_owned', coalesce((select jsonb_agg(i.item_key || ' ' || i.title order by i.item_key) from proj_dp_items i where i.project_id = pr.id and i.owner_id = m.user_id and i.removed_at is null), '[]'::jsonb))
    order by (pr.pm_user_id = m.user_id) desc, proj_display_name(m.user_id), m.user_id), '[]'::jsonb)
  into v_team
  from (select distinct on (user_id) * from proj_project_members where project_id = pr.id order by user_id, (removed_at is null) desc, added_at desc) m;

  select coalesce(jsonb_agg(jsonb_build_object('id', ms.id, 'title', ms.title, 'status', ms.status, 'due_date', ms.due_date, 'required', ms.is_required,
      'accepted_at', ms.accepted_at, 'accepted_by', case when ms.accepted_by is null then null else proj_display_name(ms.accepted_by) end) order by ms.sort_order, ms.due_date nulls last, ms.id), '[]'::jsonb)
  into v_milestones from proj_milestones ms where ms.project_id = pr.id;

  select jsonb_build_object(
      'total', count(*), 'done', count(*) filter (where status = 'done'), 'open', count(*) filter (where status in ('todo', 'in_progress', 'ready_for_review')),
      'cancelled', count(*) filter (where status = 'cancelled'), 'deferred', count(*) filter (where status = 'deferred'),
      'blocked', count(*) filter (where blocked_at is not null and status in ('todo', 'in_progress', 'ready_for_review')),
      'not_finished', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'assignee', proj_display_name(t.assignee_id), 'due_date', t.due_date, 'blocked', t.blocked_at is not null) order by t.due_date nulls last, t.title, t.id)
                                from (select * from proj_tasks where project_id = pr.id and status in ('todo', 'in_progress', 'ready_for_review', 'deferred', 'cancelled') order by due_date nulls last, title, id limit 40) t), '[]'::jsonb))
  into v_tasks from proj_tasks where project_id = pr.id;

  -- Decisions with who decided, when and the recorded reason. A scope change carries its title and its effect on dates; the scope texts themselves are under "scope".
  select coalesce(jsonb_agg(x.j order by x.at, x.j->>'id'), '[]'::jsonb) into v_decisions from (
    select sc.decided_at as at, jsonb_build_object('id', sc.id, 'kind', 'scope_change', 'title', sc.title, 'status', sc.status, 'proposed_by', proj_display_name(sc.proposed_by), 'proposed_at', sc.proposed_at,
             'decided_by', case when sc.decided_by is null then null else proj_display_name(sc.decided_by) end, 'decided_at', sc.decided_at, 'reason', sc.decision_note, 'effect_on_dates', sc.effect_on_dates) as j
      from proj_scope_changes sc where sc.project_id = pr.id and sc.status in ('approved', 'rejected')
    union all
    select ch.decided_at, jsonb_build_object('id', ch.id, 'kind', 'plan_change', 'status', ch.status,
             'title', coalesce((select i.item_key || ' ' || i.title from proj_dp_items i where i.id = ch.item_id), (select l.line_key || ' ' || l.description from proj_dp_lines l where l.id = ch.line_id)),
             'fields', (select jsonb_agg(k order by k) from jsonb_object_keys(ch.changes) k), 'proposed_by', proj_display_name(ch.proposed_by), 'proposed_at', ch.proposed_at,
             'decided_by', case when ch.decided_by is null then null else proj_display_name(ch.decided_by) end, 'decided_at', ch.decided_at, 'reason', ch.decision_note)
      from proj_dp_changes ch where ch.project_id = pr.id and ch.status in ('approved', 'rejected')
    union all
    select co.decided_at, jsonb_build_object('id', co.id, 'kind', 'correction', 'status', co.status, 'title', co.target_label, 'proposed_by', proj_display_name(co.raised_by), 'proposed_at', co.raised_at,
             'decided_by', case when co.decided_by is null then null else proj_display_name(co.decided_by) end, 'decided_at', co.decided_at, 'reason', co.decision_note)
      from proj_dp_corrections co where co.project_id = pr.id and co.status in ('accepted', 'declined')
  ) x;

  -- Client feedback: the facts always; the words of the request and of our response only as optional text the Project Manager selects.
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'received_on', f.received_on, 'kind', f.kind, 'status', f.status, 'resolved_at', f.resolved_at,
      'resolved_by', case when f.resolved_by is null then null else proj_display_name(f.resolved_by) end, 'responsible', case when f.responsible_user_id is null then null else proj_display_name(f.responsible_user_id) end,
      'due_date', f.due_date, 'request_text', f.request_text, 'response_text', f.resolution) order by f.received_on, f.created_at, f.id), '[]'::jsonb)
  into v_feedback from proj_feedback f where f.project_id = pr.id;

  -- Delivery plan with the state of the linked task of each work line. Equipment lines are filled in below.
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'key', i.item_key, 'zone', i.zone, 'title', i.title, 'owner', case when i.owner_id is null then null else proj_display_name(i.owner_id) end,
      'needed_by', i.needed_by, 'released', i.released_at is not null,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'key', l.line_key, 'section', l.section, 'description', l.description, 'qty', l.qty, 'released', l.released_at is not null,
          'request_line_id', l.request_line_id,
          'task', (select jsonb_build_object('status', t.status, 'completed_at', t.completed_at, 'assignee', proj_display_name(t.assignee_id)) from proj_tasks t where t.id = l.task_id))
        order by l.sort_order, l.line_key, l.id) from proj_dp_lines l where l.item_id = i.id and l.removed_at is null), '[]'::jsonb)) order by i.sort_order, i.item_key, i.id), '[]'::jsonb)
  into v_plan from proj_dp_items i where i.project_id = pr.id and i.removed_at is null;

  -- Equipment: per request, what was asked, sent, returned and is still out. Delivered and returned are separate facts.
  if to_regclass('public.inv_requests') is null then
    v_missing := v_missing || to_jsonb('Equipment: Inventory is not installed here, so what was sent and returned is not known'::text);
  else
    begin
      execute $q$
        select jsonb_build_object(
          'requests', coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'expected_return_at', r.expected_return_at,
            'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'item', it.name, 'qty', l.qty, 'status', l.status,
                         'sent', coalesce((select sum(x.dispatched_qty) from inv_reservations x where x.request_line_id = l.id), 0),
                         'returned', coalesce((select sum(x.returned_qty) from inv_reservations x where x.request_line_id = l.id), 0)) order by l.sort_order, l.id), '[]'::jsonb)
                      from inv_request_lines l join inv_items it on it.id = l.item_id where l.request_id = r.id and l.status <> 'cancelled')) order by r.created_at, r.id), '[]'::jsonb))
        from inv_requests r where r.project_id = $1 and r.status <> 'cancelled'
      $q$ into v_equipment using pr.id;
    exception when others then
      v_equipment := 'null'::jsonb;
      v_missing := v_missing || to_jsonb('Equipment: the equipment records could not be read'::text);
    end;
  end if;

  return jsonb_build_object(
    'taken_at', now(),
    'project', jsonb_build_object('id', pr.id, 'reference', pr.reference, 'name', pr.name, 'kind', pr.kind, 'status', pr.status, 'start_date', pr.start_date, 'end_date', pr.end_date,
        'client', d.client_name, 'venue', d.location, 'install_start', d.install_start, 'event_start', d.event_start, 'event_end', d.event_end,
        'project_manager', proj_display_name(pr.pm_user_id)),
    'handover', case when h.id is null then null else jsonb_build_object('id', h.id, 'sales_reference', h.crm_reference, 'title', h.title, 'venue', h.location, 'install_start', h.install_start,
        'event_start', h.event_start, 'event_end', h.event_end, 'accepted_at', h.accepted_at, 'accepted_by', case when h.accepted_by is null then null else proj_display_name(h.accepted_by) end,
        'technologies', (select coalesce(jsonb_agg(jsonb_build_object('name', t->>'name', 'qty', t->'qty') order by n), '[]'::jsonb) from jsonb_array_elements(h.technologies) with ordinality as t(t, n)),
        'notes_text', h.notes) end,
    'scope', jsonb_build_object('original_text', h.scope, 'original_exclusions_text', h.exclusions, 'current_text', d.scope, 'current_exclusions_text', d.exclusions,
        'changed', (h.id is not null and (coalesce(h.scope, '') is distinct from coalesce(d.scope, '') or coalesce(h.exclusions, '') is distinct from coalesce(d.exclusions, ''))),
        'approved_changes', (select count(*) from proj_scope_changes sc where sc.project_id = pr.id and sc.status = 'approved')),
    'team', v_team, 'milestones', v_milestones, 'tasks', v_tasks, 'plan', v_plan, 'decisions', v_decisions, 'feedback', v_feedback,
    'completion', case when c.id is null then null else jsonb_build_object('id', c.id, 'completed_at', c.completed_at, 'completed_by', proj_display_name(c.completed_by), 'evidence_type', c.evidence_type,
        'confirmed_on', c.confirmed_on, 'has_reference', c.evidence_reference is not null, 'has_file', c.file_id is not null,
        'resolutions', (select coalesce(jsonb_agg(jsonb_build_object('kind', r->>'kind', 'action', r->>'action', 'title', r->>'title') order by n), '[]'::jsonb) from jsonb_array_elements(c.resolutions) with ordinality as r(r, n)),
        'note_text', c.completion_note) end,
    'reopened_earlier', exists (select 1 from proj_completions x where x.project_id = pr.id and x.reopened_at is not null),
    'equipment', v_equipment,
    'missing', v_missing);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Report versions. All writes go through these; each checks that the caller manages the project.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_closeout_require_manager(p_project_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from proj_projects where id = p_project_id) or not proj_can_manage(p_project_id) then
    raise exception 'Only the Project Manager, a temporary project leader or a founder can work on the closeout report' using errcode = '42501';
  end if;
end;
$$;

-- Creates the project's draft, or replaces the content of the ONE existing draft (a retry never makes a second). The caller cannot supply evidence: the snapshot is taken
-- again here, and p_snapshot (the snapshot the report was written from) must equal it, apart from the time it was taken. If the project's records changed in between, the
-- save is refused and nothing is stored, so a stored report always rests on exactly the snapshot stored with it. Returns {"id", "version_no", "version"}.
create or replace function proj_closeout_save_draft(p_project_id uuid, p_snapshot jsonb, p_selection jsonb, p_payload_hash text, p_generation text, p_provider_kind text, p_sections jsonb, p_source_refs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_no integer; v_ver integer; v_snapshot jsonb;
begin
  perform proj_closeout_require_manager(p_project_id);
  perform 1 from proj_projects where id = p_project_id for update;
  if p_generation not in ('none', 'generated') then raise exception 'Unknown generation state' using errcode = '22023'; end if;
  if (p_generation = 'generated') <> coalesce(p_provider_kind in ('anthropic', 'simulated'), false) then raise exception 'Unknown generation state' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_sections, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_source_refs, '[]'::jsonb)) <> 'array' then raise exception 'Malformed report' using errcode = '22023'; end if;
  if length(coalesce(p_sections, '[]'::jsonb)::text) > 400000 or length(coalesce(p_source_refs, '[]'::jsonb)::text) > 400000 then raise exception 'The report is too long to save' using errcode = '22023'; end if;
  v_snapshot := proj_closeout_evidence(p_project_id);
  if p_snapshot is null or (p_snapshot - 'taken_at') <> (v_snapshot - 'taken_at') then
    raise exception 'The project''s records changed while the report was being written. Review the data again' using errcode = '40001';
  end if;
  select id into v_id from proj_closeout_reports where project_id = p_project_id and status = 'draft' for update;
  if v_id is null then
    select coalesce(max(version_no), 0) + 1 into v_no from proj_closeout_reports where project_id = p_project_id;
    insert into proj_closeout_reports (project_id, version_no, snapshot, snapshot_at, selection, payload_hash, generation, provider_kind, sections, source_refs, created_by, updated_by)
      values (p_project_id, v_no, v_snapshot, now(), coalesce(p_selection, '{}'::jsonb), p_payload_hash, p_generation, p_provider_kind, coalesce(p_sections, '[]'::jsonb), coalesce(p_source_refs, '[]'::jsonb), auth.uid(), auth.uid())
      returning id, version_no, version into v_id, v_no, v_ver;
  else
    update proj_closeout_reports set
        snapshot = v_snapshot, snapshot_at = now(), selection = coalesce(p_selection, '{}'::jsonb), payload_hash = p_payload_hash,
        generation = p_generation, provider_kind = p_provider_kind, sections = coalesce(p_sections, '[]'::jsonb), source_refs = coalesce(p_source_refs, '[]'::jsonb),
        updated_by = auth.uid(), updated_at = now(), version = version + 1
      where id = v_id returning version_no, version into v_no, v_ver;
  end if;
  return jsonb_build_object('id', v_id, 'version_no', v_no, 'version', v_ver);
end;
$$;

-- The Project Manager's edits to a draft. An approved version cannot be edited.
create or replace function proj_closeout_save_edits(p_report_id uuid, p_sections jsonb, p_expected_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare r proj_closeout_reports; v_ver integer;
begin
  -- One answer for "no such report" and "not yours", and no row lock before the caller is known to manage the project.
  select * into r from proj_closeout_reports where id = p_report_id;
  if not found or not proj_can_manage(r.project_id) then raise exception 'Report not found' using errcode = 'P0002'; end if;
  select * into r from proj_closeout_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if p_expected_version is null then raise exception 'Reload the report and try again' using errcode = '22023'; end if;
  if r.status <> 'draft' then raise exception 'An approved report cannot be edited. Start a new draft for a new version' using errcode = '23514'; end if;
  if p_expected_version is not null and r.version <> p_expected_version then raise exception 'This report was changed by someone else. Reload and try again' using errcode = '40001'; end if;
  if jsonb_typeof(p_sections) <> 'array' or length(p_sections::text) > 400000 then raise exception 'Malformed report' using errcode = '22023'; end if;
  update proj_closeout_reports set sections = p_sections, updated_by = auth.uid(), updated_at = now(), version = version + 1 where id = r.id returning version into v_ver;
  return v_ver;
end;
$$;

-- Approval freezes the version. It changes nothing else: not the project, not its completion, not stock; and it sends nothing.
-- It is refused HERE while any paragraph is blocked (proj_closeout_blocks), however the request arrives.
create or replace function proj_closeout_approve(p_report_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare r proj_closeout_reports; v_blocks jsonb;
begin
  select * into r from proj_closeout_reports where id = p_report_id;
  if not found or not proj_can_manage(r.project_id) then raise exception 'Report not found' using errcode = 'P0002'; end if;
  select * into r from proj_closeout_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if r.status = 'approved' then return; end if;   -- a repeated click
  if p_expected_version is null then raise exception 'Reload the report and try again' using errcode = '22023'; end if;
  if p_expected_version is not null and r.version <> p_expected_version then raise exception 'This report was changed by someone else. Reload and try again' using errcode = '40001'; end if;
  if jsonb_array_length(r.sections) = 0 then raise exception 'The report is empty. Write or generate it first' using errcode = '23514'; end if;
  -- The blocks are computed here from the stored text and the stored snapshot. Whatever marks the draft carries are not read.
  v_blocks := proj_closeout_blocks(r.snapshot, r.sections);
  if jsonb_array_length(v_blocks) > 0 then
    raise exception '% statement(s) in this draft contradict the project''s records (a client sign-off, a completion or an equipment return that is not recorded, or a quotation that is not in the records). Change them, save, then approve', jsonb_array_length(v_blocks) using errcode = '23514';
  end if;
  update proj_closeout_reports set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now(), version = version + 1 where id = r.id;
end;
$$;

create or replace function proj_closeout_discard_draft(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r proj_closeout_reports;
begin
  select * into r from proj_closeout_reports where id = p_report_id;
  if not found then return; end if;
  if not proj_can_manage(r.project_id) then raise exception 'Report not found' using errcode = 'P0002'; end if;
  select * into r from proj_closeout_reports where id = p_report_id for update;
  if not found then return; end if;
  if r.status <> 'draft' then raise exception 'An approved report is kept. Only a draft can be discarded' using errcode = '23514'; end if;
  delete from proj_closeout_reports where id = r.id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Blocking statements, enforced HERE. A paragraph is blocked when, by its own words, it says something the snapshot stored with the report does not support:
--   signoff_unrecorded     the client signed off, accepted or approved (directly or by implication), and no client sign-off is recorded
--   completion_unrecorded  the project itself was completed or closed, and no completion record exists
--   equipment_out          the equipment is all back, and some is recorded as still out
--   unverified_quote       quoted words that are nowhere in the snapshot's recorded text
-- Only the paragraph TEXT and the stored SNAPSHOT take part. Marks or source references a caller sends are ignored, so a block cannot be cleared by sending different
-- marks: it clears when the sentence is reworded, or when the record exists and a new draft is taken. The patterns are the ones in
-- apps/web/src/lib/projects/closeout/claims.ts (a test keeps the two identical). They are word patterns, not understanding: see that file for what they cannot catch.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_closeout_text_blocks(p_text text, p_snapshot jsonb)
returns text[] language plpgsql stable set search_path = public as $$
declare
  c_denies constant text := '\y(?:not\s+(?:yet\s+)?(?:been\s+)?(?:recorded|signed|accepted|approved|confirmed|given|received|returned|back|completed|closed)|no\s+(?:client\s+|customer\s+|recorded\s+|record\s+of\s+(?:a\s+|any\s+)?)?(?:sign[\s-]?off|acceptance|approval|confirmation|completion)|(?:is|are|was|were|has|have|had|did|does|do|could|can)(?:\s+not|n[''’]t)\s+(?!only\y)|unrecorded|awaiting|pending|yet\s+to\s+be|still\s+(?:out|outstanding|open|to\s+be))\y';
  c_signoff constant text := '\ysign(?:ed|s|ing)?[\s-]?off\y|\ysigned\s+(?:the\s+|a\s+|an\s+)?(?:\w+\s+)?(?:handover|completion|certificate|acceptance|form)\y|\y(?:handover|hand-over|completion|acceptance|certificate)\s+(?:was|were|has\s+been|is)\s+(?:signed|accepted|given|granted|received)\y|\yfinal\s+(?:approval|acceptance)\y|\yhanded\s+over\s+to\s+the\s+(?:client|customer)\y|\ygreen\s+light\y|\yblessing\y|\y(?:formally|officially)\s+(?:accepted|approved|closed|handed\s+over)\y';
  c_accept constant text := '\y(?:accept(?:ed|s|ance)?|approv(?:ed|es|al)|signed|sign(?:s|ing)?|go-?ahead|closed\s+out)\y|\y(?:satisfied|happy|delighted|pleased|content)\s+with\s+(?:the\s+|our\s+)?(?:final\s+|finished\s+|overall\s+|completed\s+)?(?:result|outcome|installation|stand|project|delivery|work|handover|everything)\y|\yhappy\s+to\s+(?:accept|sign|close|approve)\y|\yagree(?:d|s)?\s+(?:that\s+)?(?:the\s+)?(?:work|project|installation|stand|delivery)\s+(?:is|was|were)\s+(?:complete|completed|done|finished)\y|\yno\s+(?:further\s+)?(?:objections?|snags?|comments?)\y|\yconfirmed\s+(?:that\s+)?(?:the\s+)?(?:work|project|installation|stand|delivery|handover)\y';
  c_client constant text := '\y(?:client|customer|end[\s-]client|agency)(?:[''’]s)?\y';
  c_return_all constant text := '\y(?:all|every(?:thing)?|each|both|fully|completely|complete(?:d)?|entire(?:ly)?|whole|nothing|none|no\s+(?:equipment|hardware|kit|items?|units?|panels?|stock))\y';
  c_return_words constant text := '\y(?:return(?:ed|s)?|back|came\s+back|remain(?:s|ed|ing)?|outstanding|on\s+site|missing|checked\s+in)\y';
  c_return_exempt constant text := '\ystill\s+out\y|\ysome\y|\ypart(?:ly|ial(?:ly)?)\y|\ynot\s+(?:all|yet|been|every)\y|(?:is|are|was|were|has|have|had|does|do|did)n[''’]t\y|(?:is|are|was|were|has|have|had|does|do|did)\s+not\y';
  c_return_complete constant text := '\y(?:equipment|hardware|kit)\s+return\s+(?:is|was)\s+complete\y';
  c_completion constant text := '\y(?:project|job|engagement|contract)\s+(?:was|is|has\s+been|had\s+been|were)\s+(?:successfully\s+|fully\s+|formally\s+|officially\s+|now\s+)?(?:completed?|finished|closed(?:\s+out)?|concluded|wrapped\s+up)\y|\y(?:completed|finished|closed\s+out|concluded|wrapped\s+up)\s+the\s+(?:project|job|engagement|contract)\y|\yproject\s+(?:closed|completed|finished|concluded)\y|\y(?:successful|final)\s+(?:project\s+)?(?:completion|close-?out)\y|\ybrought\s+the\s+project\s+to\s+a\s+close\y';
  c_quote_double constant text := '["“]([^"”]{2,})["”]';
  c_quote_guillemet constant text := '«\s*([^»]{2,}?)\s*»';
  c_quote_single constant text := '(^|[^A-Za-z0-9])[''‘]([^''’]{2,}?)[''’]([^A-Za-z0-9]|$)';
  v_out text[] := '{}'; v_sentence text; v_client text := btrim(coalesce(p_snapshot #>> '{project,client}', ''));
  v_is_client boolean := (p_snapshot #>> '{project,kind}') = 'client';
  v_has_completion boolean := jsonb_typeof(p_snapshot -> 'completion') = 'object';
  v_signoff_recorded boolean; v_still_out numeric; v_words text; v_names_client boolean; v_quote text; m text[];
  v_signoff boolean := false; v_completion boolean := false; v_returned boolean := false;
begin
  if p_text is null or btrim(p_text) = '' then return v_out; end if;
  v_signoff_recorded := v_is_client and v_has_completion and coalesce(p_snapshot #>> '{completion,evidence_type}', '') <> 'internal_note';
  select coalesce(sum(greatest(0, coalesce((l ->> 'sent')::numeric, 0) - coalesce((l ->> 'returned')::numeric, 0))), 0) into v_still_out
    from jsonb_array_elements(case when jsonb_typeof(p_snapshot #> '{equipment,requests}') = 'array' then p_snapshot #> '{equipment,requests}' else '[]'::jsonb end) r,
         jsonb_array_elements(case when jsonb_typeof(r -> 'lines') = 'array' then r -> 'lines' else '[]'::jsonb end) l;
  for v_sentence in select x from regexp_split_to_table(p_text, '[.!?;]\s+|\n') x where btrim(x) <> '' loop
    if v_is_client and not v_signoff_recorded and not v_signoff and v_sentence !~* c_denies then
      v_names_client := v_sentence ~* c_client or (length(v_client) >= 3 and position(lower(v_client) in lower(v_sentence)) > 0);
      if v_sentence ~* c_signoff or (v_names_client and v_sentence ~* c_accept) then v_signoff := true; end if;
    end if;
    if not v_has_completion and not v_completion and v_sentence !~* c_denies and v_sentence ~* c_completion then v_completion := true; end if;
    if v_still_out > 0 and not v_returned and v_sentence !~* c_return_exempt and ((v_sentence ~* c_return_all and v_sentence ~* c_return_words) or v_sentence ~* c_return_complete) then v_returned := true; end if;
  end loop;
  if v_signoff then v_out := v_out || 'signoff_unrecorded'::text; end if;
  if v_completion then v_out := v_out || 'completion_unrecorded'::text; end if;
  if v_returned then v_out := v_out || 'equipment_out'::text; end if;
  -- Quotations: every quoted run must be found in the words the snapshot holds (lower case, quotation marks removed, white space collapsed).
  select btrim(regexp_replace(regexp_replace(lower(coalesce(string_agg(v #>> '{}', E'\n'), '')), '[“”"‘’''«»]', '', 'g'), '\s+', ' ', 'g')) into v_words
    from jsonb_path_query(p_snapshot, 'strict $.**') v where jsonb_typeof(v) = 'string';
  for v_quote in
    select (regexp_matches(p_text, c_quote_double, 'gi'))[1]
    union all select (regexp_matches(p_text, c_quote_guillemet, 'gi'))[1]
    union all select (regexp_matches(p_text, c_quote_single, 'gi'))[2]
  loop
    if position(btrim(regexp_replace(regexp_replace(lower(v_quote), '[“”"‘’''«»]', '', 'g'), '\s+', ' ', 'g')) in v_words) = 0 then
      v_out := v_out || 'unverified_quote'::text; exit;
    end if;
  end loop;
  return v_out;
end;
$$;

-- The blocked paragraphs of a report: [{"section": id, "paragraph": n (from 1), "blocks": [text]}]. Empty array = nothing blocks approval.
create or replace function proj_closeout_blocks(p_snapshot jsonb, p_sections jsonb)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('section', x.section, 'paragraph', x.n, 'blocks', to_jsonb(x.blocks)) order by x.sn, x.n), '[]'::jsonb)
  from (
    select s.value ->> 'id' as section, s.ordinality as sn, p.ordinality as n, proj_closeout_text_blocks(p.value ->> 'text', p_snapshot) as blocks
    from jsonb_array_elements(case when jsonb_typeof(p_sections) = 'array' then p_sections else '[]'::jsonb end) with ordinality s,
         jsonb_array_elements(case when jsonb_typeof(s.value -> 'paragraphs') = 'array' then s.value -> 'paragraphs' else '[]'::jsonb end) with ordinality p
  ) x where cardinality(x.blocks) > 0;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- One provider call per project and per exact reviewed content. proj_closeout_claim is called by the server BEFORE the provider and decides, under a lock on the
-- project row, which of these is true for (project, payload hash):
--   "done"         a result for exactly this content is already stored: it is returned and nothing is sent (also after a facts-only draft replaced the AI draft)
--   "in_progress"  another request claimed it less than three minutes ago and has not finished: nothing is sent
--   "limit"        today's limit for the project is used up: nothing is sent
--   "claimed"      this request may make the ONE call; it then calls proj_closeout_finish with the result or the failure
-- So two requests at the same instant make one call. A failed call is marked failed and can be claimed again. A claim that never finished (the server stopped) can be
-- claimed again after three minutes.
-- THE DAILY LIMIT counts claims that lead to a provider call, per project per day (Dubai), whether the call then succeeds or fails. It does not count: a stored
-- result being reused, a request refused as in progress or over the limit, or a facts-only draft.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists proj_closeout_usage (
  project_id uuid not null references proj_projects(id) on delete cascade,
  usage_day  date not null,
  calls      integer not null default 0,
  primary key (project_id, usage_day)
);
create table if not exists proj_closeout_generations (
  project_id    uuid not null references proj_projects(id) on delete cascade,
  payload_hash  text not null check (length(payload_hash) between 16 and 128),
  status        text not null check (status in ('claimed', 'done', 'failed')),
  provider_kind text check (provider_kind is null or provider_kind in ('anthropic', 'simulated')),
  -- The provider's answer reduced to the report's own fields: {"sections": [{"id", "paragraphs": [{"text", "refs"}]}]}. Kept so identical content is never sent twice.
  answer        jsonb,
  claimed_by    uuid not null references auth.users(id),
  claimed_at    timestamptz not null default now(),
  finished_at   timestamptz,
  primary key (project_id, payload_hash),
  constraint proj_closeout_generations_done check ((status = 'done') = (answer is not null))
);
alter table proj_closeout_usage enable row level security;
alter table proj_closeout_generations enable row level security;
drop policy if exists proj_closeout_usage_select on proj_closeout_usage;
create policy proj_closeout_usage_select on proj_closeout_usage for select using (proj_can_manage(project_id));
drop policy if exists proj_closeout_generations_select on proj_closeout_generations;
create policy proj_closeout_generations_select on proj_closeout_generations for select using (proj_can_manage(project_id));
revoke all on table proj_closeout_usage, proj_closeout_generations from anon, authenticated, public;
grant select on table proj_closeout_usage, proj_closeout_generations to authenticated;

create or replace function proj_closeout_claim(p_project_id uuid, p_payload_hash text, p_limit integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g proj_closeout_generations; v_day date := (now() at time zone 'Asia/Dubai')::date; v_used integer;
begin
  perform proj_closeout_require_manager(p_project_id);
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'The daily limit must be between 1 and 50' using errcode = '22023'; end if;
  if p_payload_hash is null or length(p_payload_hash) not between 16 and 128 then raise exception 'Malformed request' using errcode = '22023'; end if;
  perform 1 from proj_projects where id = p_project_id for update;          -- one claim at a time per project
  delete from proj_closeout_generations where project_id = p_project_id and claimed_at < now() - interval '60 days';
  select * into g from proj_closeout_generations where project_id = p_project_id and payload_hash = p_payload_hash;
  if found and g.status = 'done' then return jsonb_build_object('state', 'done', 'answer', g.answer, 'provider_kind', g.provider_kind); end if;
  if found and g.status = 'claimed' and g.claimed_at > now() - interval '3 minutes' then return jsonb_build_object('state', 'in_progress'); end if;
  insert into proj_closeout_usage as u (project_id, usage_day, calls) values (p_project_id, v_day, 1)
  on conflict (project_id, usage_day) do update set calls = u.calls + 1 where u.calls < p_limit
  returning u.calls into v_used;
  if v_used is null then return jsonb_build_object('state', 'limit'); end if;
  insert into proj_closeout_generations as x (project_id, payload_hash, status, claimed_by) values (p_project_id, p_payload_hash, 'claimed', auth.uid())
  on conflict (project_id, payload_hash) do update set status = 'claimed', provider_kind = null, answer = null, claimed_by = auth.uid(), claimed_at = now(), finished_at = null;
  return jsonb_build_object('state', 'claimed', 'used', v_used);
end;
$$;

-- The result of a claimed call: stored (p_ok) or marked failed so it can be tried again. Only a claim that is still open is finished.
create or replace function proj_closeout_finish(p_project_id uuid, p_payload_hash text, p_ok boolean, p_provider_kind text, p_answer jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform proj_closeout_require_manager(p_project_id);
  if coalesce(p_ok, false) and (p_answer is null or coalesce(jsonb_typeof(p_answer -> 'sections'), '') <> 'array' or length(p_answer::text) > 400000 or coalesce(p_provider_kind, '') not in ('anthropic', 'simulated')) then
    raise exception 'Malformed result' using errcode = '22023';
  end if;
  update proj_closeout_generations set
      status = case when coalesce(p_ok, false) then 'done' else 'failed' end,
      provider_kind = case when coalesce(p_ok, false) then p_provider_kind else null end,
      answer = case when coalesce(p_ok, false) then p_answer else null end, finished_at = now()
    where project_id = p_project_id and payload_hash = p_payload_hash and status = 'claimed';
end;
$$;

revoke all on function
  proj_closeout_text_blocks(text, jsonb), proj_closeout_blocks(jsonb, jsonb), proj_closeout_claim(uuid, text, integer), proj_closeout_finish(uuid, text, boolean, text, jsonb),
  proj_closeout_evidence(uuid), proj_closeout_require_manager(uuid), proj_closeout_save_draft(uuid, jsonb, jsonb, text, text, text, jsonb, jsonb),
  proj_closeout_save_edits(uuid, jsonb, integer), proj_closeout_approve(uuid, integer), proj_closeout_discard_draft(uuid)
  from public, anon, authenticated;
grant execute on function
  proj_closeout_claim(uuid, text, integer), proj_closeout_finish(uuid, text, boolean, text, jsonb),
  proj_closeout_evidence(uuid), proj_closeout_save_draft(uuid, jsonb, jsonb, text, text, text, jsonb, jsonb),
  proj_closeout_save_edits(uuid, jsonb, integer), proj_closeout_approve(uuid, integer), proj_closeout_discard_draft(uuid)
  to authenticated;
