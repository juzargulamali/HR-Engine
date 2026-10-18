-- Projects & Tasks (Release 2), migration 3 of 6: handover from Sales, project creation, ownership, status, members and teams.
--
-- Hard rules encoded here:
--   * Sales-to-PM handover is a Projects record (proj_handovers) built from a WON opportunity. It never writes to CRM
--     tables (the existing crm_handovers / crm_update_handover keep working untouched) and it never carries value,
--     budget, payment terms, PO or evidence reference.
--   * Acceptance by the assigned PM creates exactly one project, linked to the opportunity. It is idempotent and safe
--     against concurrent or repeated clicks (row lock + unique indexes). The accepted handover is then frozen.
--   * Membership, department responsibility and temporary project leadership are Projects concepts only: no function
--     here reads or writes an HR table, attendance, Recovery Leave, managers or payroll.
--   * Every write is a SECURITY DEFINER function that checks the specific role it needs.

-- -----------------------------------------------------------------------------
-- Internal helpers (not granted to clients)
-- -----------------------------------------------------------------------------
create or replace function proj_display_name(p_user_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) from profiles p where p.id = p_user_id;
$$;

-- Lock and return a project the caller can at least see in summary. Not-visible and not-existing are indistinguishable.
create or replace function proj_lock_project(p_project_id uuid)
returns proj_projects
language plpgsql security definer
set search_path = public
as $$
declare v proj_projects;
begin
  perform proj_require_user();
  select * into v from proj_projects where id = p_project_id for update;
  if not found or not proj_can_view_summary(v.id) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

create or replace function proj_require_manager(p_project proj_projects)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not proj_can_manage(p_project.id) then
    raise exception 'Only the Project Manager, someone holding temporary project leadership, or a founder can do that' using errcode = '42501';
  end if;
end;
$$;

create or replace function proj_check_version(p_current integer, p_expected integer)
returns void
language plpgsql immutable
as $$
begin
  if p_expected is not null and p_expected <> p_current then
    raise exception 'This was changed by someone else. Reload and try again' using errcode = '40001';
  end if;
end;
$$;

create or replace function proj_log_change(p_project_id uuid, p_entity text, p_entity_id uuid, p_field text, p_from text, p_to text, p_note text default null)
returns void
language sql security definer
set search_path = public
as $$
  insert into proj_change_log (project_id, entity_type, entity_id, field, from_value, to_value, note, actor_id)
  select p_project_id, p_entity, p_entity_id, p_field, p_from, p_to, nullif(btrim(p_note), ''), auth.uid()
  where p_from is distinct from p_to;
$$;

-- In-app notification, reusing the shared notifications table (insert-only, new "project_*" types). The recipient must
-- still be allowed to see the project (active member or founder) unless the notice is a handover one (no project yet).
-- Deduplicated: an unread notice with the same key is not repeated. Never to the actor, never for minor edits.
create or replace function proj_notify(p_project_id uuid, p_user_id uuid, p_type text, p_payload jsonb, p_dedupe text, p_require_member boolean default true)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_company uuid;
begin
  if p_user_id is null or p_user_id = auth.uid() then return; end if;
  if not exists (select 1 from profiles where id = p_user_id and is_active) then return; end if;
  if p_require_member then
    select company_id into v_company from proj_projects where id = p_project_id;
    if not (
      (exists (select 1 from proj_project_members m where m.project_id = p_project_id and m.user_id = p_user_id and m.removed_at is null)
       and proj_user_eligible(v_company, p_user_id, p_project_id))
      or exists (select 1 from proj_company_grants g where g.user_id = p_user_id and g.company_id = v_company
                  and g.revoked_at is null and 'founder' = any (g.capabilities))
    ) then return; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('proj_notify:' || p_user_id::text || ':' || p_dedupe, 0));
  if exists (select 1 from notifications n where n.user_id = p_user_id and n.type = p_type and n.read_at is null
              and n.payload->>'dedupe_key' = p_dedupe) then return; end if;
  insert into notifications (user_id, type, payload)
  values (p_user_id, p_type, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('dedupe_key', p_dedupe, 'project_id', p_project_id));
end;
$$;

create or replace function proj_next_reference(p_company_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text;
  v_year integer := extract(year from (now() at time zone 'Asia/Dubai'))::integer;
  v_n integer;
begin
  select reference_code into v_code from proj_company_settings where company_id = p_company_id;
  if v_code is null then
    raise exception 'Project reference code is not configured for this company. A founder sets it first' using errcode = '22023';
  end if;
  insert into proj_reference_counters (company_id, year, last_value) values (p_company_id, v_year, 1)
  on conflict (company_id, year) do update set last_value = proj_reference_counters.last_value + 1
  returning last_value into v_n;
  return v_code || '-P-' || v_year || '-' || lpad(v_n::text, 4, '0');
end;
$$;

create or replace function proj_add_member_row(p_project_id uuid, p_user_id uuid, p_role text, p_team_id uuid default null, p_acting_until date default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from proj_project_members where project_id = p_project_id and user_id = p_user_id and removed_at is null;
  if v_id is not null then
    update proj_project_members set role = case when p_role = 'member' and role in ('pm', 'acting_pm') then role else p_role end,
           acting_until = case when p_role = 'acting_pm' then p_acting_until when p_role in ('pm', 'member') and role = 'acting_pm' then null else acting_until end,
           team_id = coalesce(p_team_id, team_id)
     where id = v_id;
    return v_id;
  end if;
  insert into proj_project_members (project_id, user_id, role, team_id, acting_until, added_by)
  values (p_project_id, p_user_id, p_role, p_team_id, p_acting_until, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Handover: Sales prepares, a founder (or assign_pm) names the PM, the PM accepts or asks for clarification.
-- -----------------------------------------------------------------------------
create or replace function proj_text_or_null(p_fields jsonb, p_key text)
returns text
language sql immutable
as $$ select nullif(btrim(p_fields->>p_key), ''); $$;

-- Create or update the draft handover for a WON opportunity. The caller must be the opportunity's owner or a CRM
-- founder for its company (the same people who may hand over in Sales). Brief fields are what Sales chooses to share
-- with delivery; nothing is read from the commercial columns.
create or replace function proj_save_handover(p_opportunity_id uuid, p_fields jsonb default '{}'::jsonb, p_expected_version integer default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  o crm_opportunities;
  h proj_handovers;
  v_client text;
  v_title text;
  v_tz text;
  v_id uuid;
begin
  perform proj_require_user();
  select * into o from crm_opportunities where id = p_opportunity_id;
  if not found or not crm_has_access(o.company_id) then
    raise exception 'Opportunity not found' using errcode = 'P0002';
  end if;
  if o.owner_id <> auth.uid() and not crm_is_founder(o.company_id) then
    raise exception 'Only the opportunity owner or a Sales founder can prepare its project handover' using errcode = '42501';
  end if;
  if o.stage <> 'won' then
    raise exception 'A handover can only be prepared for a Won opportunity' using errcode = '23514';
  end if;
  select * into h from proj_handovers where crm_opportunity_id = p_opportunity_id and status <> 'withdrawn' for update;

  v_tz := coalesce(proj_text_or_null(p_fields, 'site_timezone'), case when found then h.site_timezone else 'Asia/Dubai' end);
  if not proj_valid_timezone(v_tz) then raise exception 'Unknown time zone %', v_tz using errcode = '22023'; end if;

  if h.id is null then
    select coalesce((select name from crm_organisations where id = o.client_org_id), (select name from crm_organisations where id = o.agency_org_id)) into v_client;
    v_title := coalesce(proj_text_or_null(p_fields, 'title'), o.title);
    insert into proj_handovers (company_id, crm_opportunity_id, crm_reference, prepared_by, sales_owner_id, title, client_name, location,
                                site_timezone, install_start, event_start, event_end, technologies, scope, exclusions, risks, notes)
    values (o.company_id, o.id, o.reference, auth.uid(), o.owner_id, v_title,
            coalesce(proj_text_or_null(p_fields, 'client_name'), v_client),
            coalesce(proj_text_or_null(p_fields, 'location'), o.location), v_tz,
            coalesce((p_fields->>'install_start')::date, o.install_start),
            coalesce((p_fields->>'event_start')::date, o.event_start),
            coalesce((p_fields->>'event_end')::date, o.event_end),
            coalesce(p_fields->'technologies', o.technologies),
            coalesce(proj_text_or_null(p_fields, 'scope'), o.scope),
            coalesce(proj_text_or_null(p_fields, 'exclusions'), o.exclusions),
            coalesce(p_fields->'risks', o.risks),
            proj_text_or_null(p_fields, 'notes'))
    returning id into v_id;
    return v_id;
  end if;

  perform proj_check_version(h.version, p_expected_version);
  if h.status not in ('draft', 'submitted', 'clarification_requested') then
    raise exception 'This handover can no longer be edited (status: %)', h.status using errcode = '23514';
  end if;
  update proj_handovers set
    title = coalesce(proj_text_or_null(p_fields, 'title'), title),
    client_name = case when p_fields ? 'client_name' then proj_text_or_null(p_fields, 'client_name') else client_name end,
    location = case when p_fields ? 'location' then proj_text_or_null(p_fields, 'location') else location end,
    site_timezone = v_tz,
    install_start = case when p_fields ? 'install_start' then nullif(p_fields->>'install_start', '')::date else install_start end,
    event_start = case when p_fields ? 'event_start' then nullif(p_fields->>'event_start', '')::date else event_start end,
    event_end = case when p_fields ? 'event_end' then nullif(p_fields->>'event_end', '')::date else event_end end,
    technologies = coalesce(p_fields->'technologies', technologies),
    scope = case when p_fields ? 'scope' then proj_text_or_null(p_fields, 'scope') else scope end,
    exclusions = case when p_fields ? 'exclusions' then proj_text_or_null(p_fields, 'exclusions') else exclusions end,
    risks = coalesce(p_fields->'risks', risks),
    notes = case when p_fields ? 'notes' then proj_text_or_null(p_fields, 'notes') else notes end,
    version = version + 1
   where id = h.id;
  return h.id;
end;
$$;

create or replace function proj_lock_handover(p_handover_id uuid)
returns proj_handovers
language plpgsql security definer
set search_path = public
as $$
declare h proj_handovers;
begin
  perform proj_require_user();
  select * into h from proj_handovers where id = p_handover_id for update;
  if not found or not (
    proj_is_founder(h.company_id) or proj_has_capability(h.company_id, 'assign_pm')
    or ((h.prepared_by = auth.uid() or h.sales_owner_id = auth.uid()) and crm_has_access(h.company_id))
    or h.pm_user_id = auth.uid()
  ) then
    raise exception 'Handover not found' using errcode = 'P0002';
  end if;
  return h;
end;
$$;

create or replace function proj_submit_handover(p_handover_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  h proj_handovers;
  r record;
begin
  h := proj_lock_handover(p_handover_id);
  if not ((h.prepared_by = auth.uid() or h.sales_owner_id = auth.uid()) and crm_has_access(h.company_id)) and not crm_is_founder(h.company_id) then
    raise exception 'Only Sales can submit the handover' using errcode = '42501';
  end if;
  if h.status not in ('draft', 'clarification_requested') then
    if h.status in ('submitted', 'pm_assigned', 'accepted') then return; end if;   -- repeated click: nothing more to do
    raise exception 'This handover cannot be submitted (status: %)', h.status using errcode = '23514';
  end if;
  if length(btrim(coalesce(h.scope, ''))) = 0 then
    raise exception 'Describe the scope of work before submitting the handover' using errcode = '22023';
  end if;
  update proj_handovers set
    status = case when pm_user_id is not null then 'pm_assigned' else 'submitted' end,
    submitted_at = now(), revision = revision + 1, version = version + 1,
    clarification_note = case when status = 'clarification_requested' then clarification_note else null end
   where id = h.id;
  if h.pm_user_id is not null then
    perform proj_notify(null, h.pm_user_id, 'project_handover_resubmitted',
      jsonb_build_object('handover_id', h.id, 'title', h.title, 'reference', h.crm_reference), 'handover:' || h.id || ':rev:' || (h.revision + 1), false);
  else
    for r in select g.user_id from proj_company_grants g join profiles p on p.id = g.user_id and p.is_active
              where g.company_id = h.company_id and g.revoked_at is null and ('founder' = any (g.capabilities) or 'assign_pm' = any (g.capabilities)) loop
      perform proj_notify(null, r.user_id, 'project_handover_submitted',
        jsonb_build_object('handover_id', h.id, 'title', h.title, 'reference', h.crm_reference), 'handover:' || h.id || ':rev:' || (h.revision + 1), false);
    end loop;
  end if;
end;
$$;

create or replace function proj_assign_handover_pm(p_handover_id uuid, p_pm_user_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare h proj_handovers;
begin
  h := proj_lock_handover(p_handover_id);
  if not proj_has_capability(h.company_id, 'assign_pm') then
    raise exception 'Only a founder, or someone a founder gave PM assignment to, can assign the Project Manager' using errcode = '42501';
  end if;
  if h.status not in ('submitted', 'pm_assigned', 'clarification_requested') then
    raise exception 'A Project Manager can only be assigned to a submitted handover (status: %)', h.status using errcode = '23514';
  end if;
  if not proj_user_eligible(h.company_id, p_pm_user_id) then
    raise exception 'That person does not have Projects access in this company. Give them access first' using errcode = '22023';
  end if;
  update proj_handovers set pm_user_id = p_pm_user_id, pm_assigned_by = auth.uid(), pm_assigned_at = now(),
         status = 'pm_assigned', version = version + 1 where id = h.id;
  perform proj_notify(null, p_pm_user_id, 'project_handover_assigned',
    jsonb_build_object('handover_id', h.id, 'title', h.title, 'reference', h.crm_reference), 'handover:' || h.id || ':pm:' || p_pm_user_id, false);
end;
$$;

create or replace function proj_request_handover_clarification(p_handover_id uuid, p_note text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare h proj_handovers;
begin
  h := proj_lock_handover(p_handover_id);
  if h.pm_user_id is distinct from auth.uid() then
    raise exception 'Only the assigned Project Manager can ask for clarification' using errcode = '42501';
  end if;
  if h.status = 'clarification_requested' then return; end if;
  if h.status <> 'pm_assigned' then
    raise exception 'Clarification can only be requested on a handover waiting for acceptance (status: %)', h.status using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Say what needs clarifying' using errcode = '22023';
  end if;
  update proj_handovers set status = 'clarification_requested', clarification_note = btrim(p_note),
         clarification_requested_at = now(), clarification_requested_by = auth.uid(), version = version + 1 where id = h.id;
  perform proj_notify(null, h.sales_owner_id, 'project_handover_clarification',
    jsonb_build_object('handover_id', h.id, 'title', h.title, 'reference', h.crm_reference), 'handover:' || h.id || ':clar:' || (h.version + 1), false);
  if h.prepared_by <> h.sales_owner_id then
    perform proj_notify(null, h.prepared_by, 'project_handover_clarification',
      jsonb_build_object('handover_id', h.id, 'title', h.title, 'reference', h.crm_reference), 'handover:' || h.id || ':clar:' || (h.version + 1), false);
  end if;
end;
$$;

create or replace function proj_withdraw_handover(p_handover_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare h proj_handovers;
begin
  h := proj_lock_handover(p_handover_id);
  if not ((h.prepared_by = auth.uid() or h.sales_owner_id = auth.uid()) and crm_has_access(h.company_id)) and not proj_is_founder(h.company_id) then
    raise exception 'Only Sales or a founder can withdraw a handover' using errcode = '42501';
  end if;
  if h.status = 'withdrawn' then return; end if;
  if h.status = 'accepted' then
    raise exception 'An accepted handover cannot be withdrawn' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Give a reason for withdrawing' using errcode = '22023'; end if;
  update proj_handovers set status = 'withdrawn', notes = btrim(concat_ws(E'\n', notes, 'Withdrawn: ' || btrim(p_reason))), version = version + 1 where id = h.id;
end;
$$;

-- PM acceptance: exactly one project per opportunity, whatever the number of clicks or concurrent callers.
create or replace function proj_accept_handover(p_handover_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  h proj_handovers;
  o crm_opportunities;
  v_project uuid;
  v_ref text;
  r record;
begin
  perform proj_require_user();
  select * into h from proj_handovers where id = p_handover_id for update;      -- serialises concurrent acceptances
  if not found or (h.pm_user_id is distinct from auth.uid() and not proj_is_founder(h.company_id)) then
    raise exception 'Handover not found' using errcode = 'P0002';
  end if;
  if h.status = 'accepted' then
    if h.pm_user_id is distinct from auth.uid() then
      raise exception 'Only the assigned Project Manager can accept the handover' using errcode = '42501';
    end if;
    return h.project_id;                                                         -- repeated click: same project
  end if;
  if h.pm_user_id is distinct from auth.uid() then
    raise exception 'Only the assigned Project Manager can accept the handover' using errcode = '42501';
  end if;
  if h.status <> 'pm_assigned' then
    raise exception 'This handover is not waiting for acceptance (status: %)', h.status using errcode = '23514';
  end if;
  if not proj_user_eligible(h.company_id, auth.uid()) then
    raise exception 'You no longer have Projects access in this company' using errcode = '42501';
  end if;
  -- The opportunity must still be Won (a reopened opportunity is not delivered). Nothing else is read from it.
  select * into o from crm_opportunities where id = h.crm_opportunity_id;
  if not found or o.stage <> 'won' then
    raise exception 'The Sales opportunity is no longer Won, so the handover cannot be accepted. Ask Sales' using errcode = '23514';
  end if;
  if exists (select 1 from proj_projects where crm_opportunity_id = h.crm_opportunity_id) then
    raise exception 'A project already exists for this opportunity' using errcode = '23505';
  end if;

  v_ref := proj_next_reference(h.company_id);
  insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, start_date, end_date, crm_opportunity_id, handover_id, created_by)
  values (h.company_id, v_ref, h.title, 'client', 'planning', h.pm_user_id,
          coalesce(h.install_start, h.event_start), h.event_end, h.crm_opportunity_id, h.id, auth.uid())
  returning id into v_project;
  insert into proj_project_details (project_id, client_name, location, site_timezone, install_start, event_start, event_end, scope, exclusions, technologies, risks)
  values (v_project, h.client_name, h.location, h.site_timezone, h.install_start, h.event_start, h.event_end, h.scope, h.exclusions, h.technologies, h.risks);
  insert into proj_project_members (project_id, user_id, role, added_by) values (v_project, h.pm_user_id, 'pm', auth.uid());
  -- Sales relationship, recorded once: the opportunity owner at handover and whoever prepared it.
  insert into proj_sales_links (project_id, user_id, source, added_by) values (v_project, h.sales_owner_id, 'handover_owner', auth.uid());
  if h.prepared_by <> h.sales_owner_id then
    insert into proj_sales_links (project_id, user_id, source, added_by) values (v_project, h.prepared_by, 'handover_preparer', auth.uid());
  end if;
  update proj_handovers set status = 'accepted', accepted_by = auth.uid(), accepted_at = now(), project_id = v_project, version = version + 1 where id = h.id;

  for r in select distinct u from unnest(array[h.sales_owner_id, h.prepared_by]) as u loop
    perform proj_notify(v_project, r.u, 'project_handover_accepted',
      jsonb_build_object('handover_id', h.id, 'title', h.title, 'reference', v_ref), 'handover:' || h.id || ':accepted', false);
  end loop;
  return v_project;
end;
$$;

-- -----------------------------------------------------------------------------
-- Internal projects: no opportunity, no PO, no Sales value. A founder (or assign_pm) names the accountable owner.
-- -----------------------------------------------------------------------------
create or replace function proj_create_internal_project(
  p_company_id uuid,
  p_name text,
  p_owner_user_id uuid,
  p_is_ongoing boolean default false,
  p_priority text default 'normal',
  p_start_date date default null,
  p_end_date date default null,
  p_summary text default null,
  p_site_timezone text default 'Asia/Dubai'
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_ref text;
begin
  perform proj_require_user();
  if not proj_has_capability(p_company_id, 'assign_pm') then
    raise exception 'Only a founder, or someone a founder gave PM assignment to, can create an internal project' using errcode = '42501';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  if not proj_user_eligible(p_company_id, p_owner_user_id) then
    raise exception 'The owner needs Projects access in this company first' using errcode = '22023';
  end if;
  if not proj_valid_timezone(p_site_timezone) then raise exception 'Unknown time zone %', p_site_timezone using errcode = '22023'; end if;
  v_ref := proj_next_reference(p_company_id);
  insert into proj_projects (company_id, reference, name, kind, pm_user_id, priority, is_ongoing, start_date, end_date, created_by)
  values (p_company_id, v_ref, btrim(p_name), 'internal', p_owner_user_id, coalesce(p_priority, 'normal'), coalesce(p_is_ongoing, false),
          p_start_date, p_end_date, auth.uid())
  returning id into v_project;
  insert into proj_project_details (project_id, scope, site_timezone) values (v_project, nullif(btrim(p_summary), ''), p_site_timezone);
  insert into proj_project_members (project_id, user_id, role, added_by) values (v_project, p_owner_user_id, 'pm', auth.uid());
  perform proj_notify(v_project, p_owner_user_id, 'project_assigned',
    jsonb_build_object('name', btrim(p_name), 'reference', v_ref), 'project:' || v_project || ':pm:' || p_owner_user_id);
  return v_project;
end;
$$;

-- -----------------------------------------------------------------------------
-- PM / owner reassignment (founder or assign_pm only)
-- -----------------------------------------------------------------------------
create or replace function proj_assign_pm(p_project_id uuid, p_pm_user_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v proj_projects;
begin
  v := proj_lock_project(p_project_id);
  if not proj_has_capability(v.company_id, 'assign_pm') then
    raise exception 'Only a founder, or someone a founder gave PM assignment to, can change the Project Manager' using errcode = '42501';
  end if;
  if v.status in ('completed', 'archived') then
    raise exception 'A completed project has no active Project Manager to change. Reopen it first' using errcode = '23514';
  end if;
  if v.pm_user_id = p_pm_user_id then return; end if;
  if not proj_user_eligible(v.company_id, p_pm_user_id, v.id) then
    raise exception 'That person does not have Projects access in this company. Give them access first' using errcode = '22023';
  end if;
  update proj_project_members set role = 'member' where project_id = v.id and user_id = v.pm_user_id and removed_at is null and role = 'pm';
  perform proj_add_member_row(v.id, p_pm_user_id, 'pm');
  update proj_project_members set role = 'pm', acting_until = null where project_id = v.id and user_id = p_pm_user_id and removed_at is null;
  update proj_projects set pm_user_id = p_pm_user_id, version = version + 1 where id = v.id;
  perform proj_log_change(v.id, 'project', v.id, 'pm', proj_display_name(v.pm_user_id), proj_display_name(p_pm_user_id));
  perform proj_notify(v.id, p_pm_user_id, 'project_assigned',
    jsonb_build_object('name', v.name, 'reference', v.reference), 'project:' || v.id || ':pm:' || p_pm_user_id);
end;
$$;

-- Temporary project leadership: the PM's project powers (not PM or acting-PM assignment, not HR anything) until a date.
create or replace function proj_set_acting_pm(p_project_id uuid, p_user_id uuid, p_until date)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v proj_projects;
begin
  v := proj_lock_project(p_project_id);
  if v.pm_user_id <> auth.uid() and not proj_is_founder(v.company_id) then
    raise exception 'Only the Project Manager or a founder can appoint temporary project leadership' using errcode = '42501';
  end if;
  if p_until is null or p_until < current_date then
    raise exception 'Give an end date that is today or later' using errcode = '22023';
  end if;
  if p_user_id = v.pm_user_id then raise exception 'The Project Manager already leads this project' using errcode = '22023'; end if;
  if not proj_user_eligible(v.company_id, p_user_id, v.id) then
    raise exception 'That person does not have Projects access in this company' using errcode = '22023';
  end if;
  perform proj_add_member_row(v.id, p_user_id, 'acting_pm', null, p_until);
  perform proj_log_change(v.id, 'member', p_user_id, 'acting_pm_until', null, p_until::text);
  perform proj_notify(v.id, p_user_id, 'project_assigned',
    jsonb_build_object('name', v.name, 'reference', v.reference, 'acting_until', p_until), 'project:' || v.id || ':acting:' || p_user_id || ':' || p_until);
end;
$$;

create or replace function proj_end_acting_pm(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v proj_projects;
begin
  v := proj_lock_project(p_project_id);
  if v.pm_user_id <> auth.uid() and not proj_is_founder(v.company_id) then
    raise exception 'Only the Project Manager or a founder can end temporary project leadership' using errcode = '42501';
  end if;
  update proj_project_members set role = 'member', acting_until = null
   where project_id = v.id and user_id = p_user_id and removed_at is null and role = 'acting_pm';
  perform proj_log_change(v.id, 'member', p_user_id, 'acting_pm_until', 'set', null);
end;
$$;

-- -----------------------------------------------------------------------------
-- Project edits and lifecycle
-- -----------------------------------------------------------------------------
create or replace function proj_update_project(p_project_id uuid, p_patch jsonb, p_expected_version integer default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  d proj_project_details;
  k text;
  v_proj_keys text[] := array['name', 'priority', 'start_date', 'end_date', 'is_ongoing'];
  v_detail_keys text[] := array['client_name', 'location', 'site_timezone', 'install_start', 'event_start', 'event_end', 'scope', 'exclusions', 'technologies', 'risks'];
  v_dates_changed boolean := false;
  v_new proj_projects;
  r record;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_check_version(v.version, p_expected_version);
  if v.status in ('completed', 'archived') then
    raise exception 'A completed project is read-only. Reopen it first' using errcode = '23514';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Nothing to change' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_proj_keys) or k = any (v_detail_keys)) then
      raise exception 'Field % cannot be changed here', k using errcode = '22023';
    end if;
  end loop;
  if v.kind = 'client' and p_patch ? 'scope' then
    raise exception 'The agreed scope of a client project changes only through a recorded scope change' using errcode = '23514';
  end if;
  if v.kind = 'client' and p_patch ? 'is_ongoing' then
    raise exception 'Only internal projects can be marked ongoing' using errcode = '23514';
  end if;
  if p_patch ? 'site_timezone' and not proj_valid_timezone(p_patch->>'site_timezone') then
    raise exception 'Unknown time zone %', p_patch->>'site_timezone' using errcode = '22023';
  end if;
  select * into d from proj_project_details where project_id = v.id;

  update proj_projects set
    name = coalesce(proj_text_or_null(p_patch, 'name'), name),
    priority = coalesce(proj_text_or_null(p_patch, 'priority'), priority),
    start_date = case when p_patch ? 'start_date' then nullif(p_patch->>'start_date', '')::date else start_date end,
    end_date = case when p_patch ? 'end_date' then nullif(p_patch->>'end_date', '')::date else end_date end,
    is_ongoing = case when p_patch ? 'is_ongoing' then (p_patch->>'is_ongoing')::boolean else is_ongoing end,
    version = version + 1
   where id = v.id returning * into v_new;
  update proj_project_details set
    client_name = case when p_patch ? 'client_name' then proj_text_or_null(p_patch, 'client_name') else client_name end,
    location = case when p_patch ? 'location' then proj_text_or_null(p_patch, 'location') else location end,
    site_timezone = coalesce(proj_text_or_null(p_patch, 'site_timezone'), site_timezone),
    install_start = case when p_patch ? 'install_start' then nullif(p_patch->>'install_start', '')::date else install_start end,
    event_start = case when p_patch ? 'event_start' then nullif(p_patch->>'event_start', '')::date else event_start end,
    event_end = case when p_patch ? 'event_end' then nullif(p_patch->>'event_end', '')::date else event_end end,
    scope = case when p_patch ? 'scope' then proj_text_or_null(p_patch, 'scope') else scope end,
    exclusions = case when p_patch ? 'exclusions' then proj_text_or_null(p_patch, 'exclusions') else exclusions end,
    technologies = coalesce(p_patch->'technologies', technologies),
    risks = coalesce(p_patch->'risks', risks)
   where project_id = v.id;

  perform proj_log_change(v.id, 'project', v.id, 'start_date', v.start_date::text, v_new.start_date::text);
  perform proj_log_change(v.id, 'project', v.id, 'end_date', v.end_date::text, v_new.end_date::text);
  perform proj_log_change(v.id, 'project', v.id, 'priority', v.priority, v_new.priority);
  perform proj_log_change(v.id, 'project', v.id, 'install_start', d.install_start::text, (select install_start::text from proj_project_details where project_id = v.id));
  perform proj_log_change(v.id, 'project', v.id, 'event_start', d.event_start::text, (select event_start::text from proj_project_details where project_id = v.id));
  perform proj_log_change(v.id, 'project', v.id, 'event_end', d.event_end::text, (select event_end::text from proj_project_details where project_id = v.id));
  v_dates_changed := v.start_date is distinct from v_new.start_date or v.end_date is distinct from v_new.end_date
    or d.install_start is distinct from (select install_start from proj_project_details where project_id = v.id)
    or d.event_start is distinct from (select event_start from proj_project_details where project_id = v.id)
    or d.event_end is distinct from (select event_end from proj_project_details where project_id = v.id);
  if v_dates_changed then
    for r in select user_id from proj_project_members where project_id = v.id and removed_at is null loop
      perform proj_notify(v.id, r.user_id, 'project_dates_changed',
        jsonb_build_object('name', v.name, 'reference', v.reference), 'project:' || v.id || ':dates:' || v_new.version);
    end loop;
  end if;
end;
$$;

-- Lifecycle. Completion and reopening have their own functions (they need evidence and a reason). Forward steps are free;
-- going back, or skipping, needs a reason that is kept in the change log.
create or replace function proj_status_rank(p_status text)
returns integer
language sql immutable
as $$ select case p_status when 'planning' then 1 when 'in_progress' then 2 when 'ready_for_installation' then 3 when 'on_site' then 4 end; $$;

create or replace function proj_set_status(p_project_id uuid, p_to text, p_reason text default null, p_review_date date default null, p_expected_version integer default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  d proj_project_details;
  v_from_rank integer;
  v_to_rank integer;
  v_target text := p_to;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_check_version(v.version, p_expected_version);
  select * into d from proj_project_details where project_id = v.id;
  if v.status = p_to then return; end if;
  if p_to in ('completed') then
    raise exception 'Use Complete project: it records the completion evidence' using errcode = '23514';
  end if;
  if v.status = 'completed' and p_to = 'archived' then
    update proj_projects set status = 'archived', archived_at = now(), version = version + 1 where id = v.id;
    perform proj_log_change(v.id, 'project', v.id, 'status', v.status, 'archived');
    return;
  end if;
  if v.status in ('completed', 'archived') then
    raise exception 'A completed project can only be archived or reopened' using errcode = '23514';
  end if;
  if p_to = 'archived' then
    raise exception 'Only a completed project can be archived' using errcode = '23514';
  end if;
  if p_to = 'on_hold' then
    if length(btrim(coalesce(p_reason, ''))) = 0 or p_review_date is null then
      raise exception 'Putting a project on hold needs a reason and a review date' using errcode = '22023';
    end if;
    update proj_project_details set hold_reason = btrim(p_reason), hold_review_date = p_review_date, status_before_hold = v.status where project_id = v.id;
    update proj_projects set status = 'on_hold', version = version + 1 where id = v.id;
    perform proj_log_change(v.id, 'project', v.id, 'status', v.status, 'on_hold', p_reason);
    return;
  end if;
  if v.status = 'on_hold' then
    -- Resume returns to where it was (or to an explicit earlier/later live state with a reason).
    if p_to = 'resume' or p_to = d.status_before_hold then
      v_target := d.status_before_hold;
      update proj_project_details set hold_reason = null, hold_review_date = null, status_before_hold = null where project_id = v.id;
      update proj_projects set status = v_target, version = version + 1 where id = v.id;
      perform proj_log_change(v.id, 'project', v.id, 'status', 'on_hold', v_target, p_reason);
      return;
    end if;
    raise exception 'Resume the project before moving it to another state' using errcode = '23514';
  end if;
  v_from_rank := proj_status_rank(v.status);
  v_to_rank := proj_status_rank(p_to);
  if v_to_rank is null then raise exception 'Unknown status %', p_to using errcode = '22023'; end if;
  if v.kind = 'internal' and p_to in ('ready_for_installation', 'on_site') then
    raise exception 'Internal projects do not use installation and show states' using errcode = '23514';
  end if;
  if v_to_rank <> v_from_rank + 1 and length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Moving a project backwards or skipping a state needs a reason' using errcode = '22023';
  end if;
  update proj_projects set status = p_to, version = version + 1 where id = v.id;
  perform proj_log_change(v.id, 'project', v.id, 'status', v.status, p_to, p_reason);
end;
$$;

-- -----------------------------------------------------------------------------
-- Members and teams
-- -----------------------------------------------------------------------------
create or replace function proj_add_member(p_project_id uuid, p_user_id uuid, p_team_id uuid default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  v_existed boolean;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if v.status in ('completed', 'archived') then raise exception 'A completed project is read-only' using errcode = '23514'; end if;
  if not proj_user_eligible(v.company_id, p_user_id, v.id) then
    raise exception 'That person does not have Projects access in this company. A founder gives them access first' using errcode = '22023';
  end if;
  if p_team_id is not null and not exists (select 1 from proj_teams where id = p_team_id and project_id = v.id and removed_at is null) then
    raise exception 'Unknown department team' using errcode = '22023';
  end if;
  select exists (select 1 from proj_project_members where project_id = v.id and user_id = p_user_id and removed_at is null) into v_existed;
  perform proj_add_member_row(v.id, p_user_id, 'member', p_team_id);
  if not v_existed then
    perform proj_log_change(v.id, 'member', p_user_id, 'added', null, proj_display_name(p_user_id));
    perform proj_notify(v.id, p_user_id, 'project_invitation',
      jsonb_build_object('name', v.name, 'reference', v.reference), 'project:' || v.id || ':invite:' || p_user_id);
  end if;
end;
$$;

create or replace function proj_set_member_team(p_project_id uuid, p_user_id uuid, p_team_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v proj_projects;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if p_team_id is not null and not exists (select 1 from proj_teams where id = p_team_id and project_id = v.id and removed_at is null) then
    raise exception 'Unknown department team' using errcode = '22023';
  end if;
  update proj_project_members set team_id = p_team_id where project_id = v.id and user_id = p_user_id and removed_at is null;
  if not found then raise exception 'That person is not a member of this project' using errcode = 'P0002'; end if;
end;
$$;

-- What would be left behind if this person lost access. Replaced in migration 4 to add site bookings.
create or replace function proj_member_blockers(p_project_id uuid, p_user_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'open_tasks', (select count(*) from proj_tasks t where t.project_id = p_project_id and t.assignee_id = p_user_id
                    and t.status in ('todo', 'in_progress', 'ready_for_review')));
$$;

create or replace function proj_remove_member(p_project_id uuid, p_user_id uuid, p_reason text default null, p_reassign_to uuid default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  v_open integer;
  v_blockers jsonb;
  t record;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if v.pm_user_id = p_user_id then
    raise exception 'The Project Manager cannot be removed. Assign another Project Manager first' using errcode = '23514';
  end if;
  if exists (select 1 from proj_teams where project_id = v.id and head_user_id = p_user_id and removed_at is null) then
    raise exception 'This person heads a department team. Choose another head first' using errcode = '23514';
  end if;
  if not exists (select 1 from proj_project_members where project_id = v.id and user_id = p_user_id and removed_at is null) then return; end if;

  v_blockers := proj_member_blockers(v.id, p_user_id);
  v_open := (v_blockers->>'open_tasks')::integer;
  if v_open > 0 then
    if p_reassign_to is null then
      raise exception 'This person still has % open task(s). Reassign them (choose who takes over) before removing access', v_open using errcode = '23514';
    end if;
    if p_reassign_to = p_user_id or not exists (select 1 from proj_project_members where project_id = v.id and user_id = p_reassign_to and removed_at is null) then
      raise exception 'Choose another active member to take over the open tasks' using errcode = '22023';
    end if;
    for t in select id from proj_tasks where project_id = v.id and assignee_id = p_user_id and status in ('todo', 'in_progress', 'ready_for_review') loop
      update proj_tasks set assignee_id = p_reassign_to, version = version + 1 where id = t.id;
      insert into proj_task_events (task_id, project_id, actor_id, kind, from_value, to_value, note)
      values (t.id, v.id, auth.uid(), 'reassigned', proj_display_name(p_user_id), proj_display_name(p_reassign_to), 'Member removed from the project');
    end loop;
  end if;
  if coalesce((v_blockers->>'upcoming_bookings')::integer, 0) > 0 then
    raise exception 'This person has % upcoming site booking(s). Cancel or reassign them first', v_blockers->>'upcoming_bookings' using errcode = '23514';
  end if;
  delete from proj_task_collaborators where project_id = v.id and user_id = p_user_id;
  update proj_project_members set removed_at = now(), removed_by = auth.uid(), removal_reason = nullif(btrim(p_reason), '') where project_id = v.id and user_id = p_user_id and removed_at is null;
  perform proj_log_change(v.id, 'member', p_user_id, 'removed', proj_display_name(p_user_id), null, p_reason);
  -- Their unread and read project notices for this project go too, so nothing about it remains readable to them.
  delete from notifications where user_id = p_user_id and type like 'project\_%' and payload->>'project_id' = v.id::text;
end;
$$;

create or replace function proj_save_team(p_project_id uuid, p_team_id uuid, p_name text, p_head_user_id uuid, p_department_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  v_id uuid;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if v.status in ('completed', 'archived') then raise exception 'A completed project is read-only' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Name the department team' using errcode = '22023'; end if;
  if not proj_user_eligible(v.company_id, p_head_user_id, v.id) then
    raise exception 'The department head needs Projects access in this company first' using errcode = '22023';
  end if;
  if p_department_id is not null and not exists (select 1 from departments where id = p_department_id and company_id = v.company_id and deleted_at is null) then
    raise exception 'Unknown department' using errcode = '22023';
  end if;
  perform proj_add_member_row(v.id, p_head_user_id, 'member');
  if p_team_id is null then
    insert into proj_teams (project_id, name, department_id, head_user_id, created_by)
    values (v.id, btrim(p_name), p_department_id, p_head_user_id, auth.uid()) returning id into v_id;
    perform proj_notify(v.id, p_head_user_id, 'project_assigned',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'team', btrim(p_name)), 'project:' || v.id || ':head:' || v_id);
  else
    update proj_teams set name = btrim(p_name), department_id = p_department_id, head_user_id = p_head_user_id
     where id = p_team_id and project_id = v.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Unknown department team' using errcode = 'P0002'; end if;
  end if;
  update proj_project_members set team_id = v_id where project_id = v.id and user_id = p_head_user_id and removed_at is null and team_id is null;
  return v_id;
end;
$$;

create or replace function proj_remove_team(p_project_id uuid, p_team_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v proj_projects;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  if exists (select 1 from proj_deliverables where team_id = p_team_id and status in ('open', 'in_progress', 'ready_for_review'))
     or exists (select 1 from proj_tasks where team_id = p_team_id and status in ('todo', 'in_progress', 'ready_for_review')) then
    raise exception 'This team still has open deliverables or tasks. Move or close them first' using errcode = '23514';
  end if;
  update proj_teams set removed_at = now() where id = p_team_id and project_id = v.id and removed_at is null;
  update proj_project_members set team_id = null where project_id = v.id and team_id = p_team_id;
end;
$$;

-- Sales relationship maintenance: explicit only (a CRM owner reassignment changes nothing here).
create or replace function proj_set_sales_link(p_project_id uuid, p_user_id uuid, p_linked boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v proj_projects;
begin
  v := proj_lock_project(p_project_id);
  if not (proj_is_founder(v.company_id) or proj_has_capability(v.company_id, 'assign_pm')) then
    raise exception 'Only a founder, or someone a founder gave PM assignment to, can change which Sales people are linked to a project' using errcode = '42501';
  end if;
  if v.kind <> 'client' then raise exception 'Only client projects have Sales links' using errcode = '23514'; end if;
  if p_linked then
    if not exists (select 1 from crm_company_grants c where c.user_id = p_user_id and c.company_id = v.company_id and c.revoked_at is null) then
      raise exception 'That person does not have Sales access in this company' using errcode = '22023';
    end if;
    insert into proj_sales_links (project_id, user_id, source, added_by) values (v.id, p_user_id, 'added', auth.uid())
    on conflict (project_id, user_id) where removed_at is null do nothing;
  else
    update proj_sales_links set removed_at = now() where project_id = v.id and user_id = p_user_id and removed_at is null;
    -- If they were also added as a member to take part, that membership is a separate PM decision and is left alone.
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Directory (summary only) with the PM's name. Obeys the same visibility as the table; returns nothing else.
-- -----------------------------------------------------------------------------
create or replace function proj_directory()
returns table (id uuid, company_id uuid, reference text, name text, kind text, status text, priority text, is_ongoing boolean,
               pm_user_id uuid, pm_name text, start_date date, end_date date, is_member boolean, is_sales_linked boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  return query
    select pr.id, pr.company_id, pr.reference, pr.name, pr.kind, pr.status, pr.priority, pr.is_ongoing,
           pr.pm_user_id, proj_display_name(pr.pm_user_id), pr.start_date, pr.end_date,
           proj_is_active_member(pr.id), proj_sales_linked(pr.id)
    from proj_projects pr
    where proj_can_view_summary(pr.id)
    order by (pr.status in ('completed', 'archived')), pr.end_date nulls last, pr.reference;
end;
$$;

-- The handover status of a Won opportunity, for the Sales handover page. Read-only; exposes status and PM name only.
create or replace function proj_handover_for_opportunity(p_opportunity_id uuid)
returns table (handover_id uuid, status text, pm_name text, project_id uuid, project_reference text, clarification_note text)
language plpgsql stable security definer
set search_path = public
as $$
declare o_company uuid;
begin
  perform proj_require_user();
  select company_id into o_company from crm_opportunities where crm_opportunities.id = p_opportunity_id;
  if o_company is null or not crm_has_access(o_company) then return; end if;
  return query
    select h.id, h.status, proj_display_name(h.pm_user_id), h.project_id,
           (select pr.reference from proj_projects pr where pr.id = h.project_id and proj_can_view_summary(pr.id)),
           h.clarification_note
    from proj_handovers h where h.crm_opportunity_id = p_opportunity_id and h.status <> 'withdrawn';
end;
$$;

-- -----------------------------------------------------------------------------
-- Revoking Projects access (replaces the migration-1 version, now that memberships exist). Access ends at once because
-- membership only counts while the person is eligible; here the revoked person's project notices are removed as well, so no
-- project name, task or reference stays readable to them, and every membership of theirs in this company is closed.
-- A Project Manager or department head cannot silently lose access: reassign those roles first.
-- -----------------------------------------------------------------------------
create or replace function proj_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target_is_founder boolean;
  v_founders integer;
begin
  perform proj_require_user();
  if not proj_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a Projects founder can revoke Projects access for this company' using errcode = '42501';
  end if;
  select 'founder' = any (capabilities) into v_target_is_founder
    from proj_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_is_founder is null then return; end if;
  if v_target_is_founder and not proj_is_founder(p_company_id) then
    raise exception 'Only a Projects founder can revoke a founder' using errcode = '42501';
  end if;
  if v_target_is_founder then
    select count(*) into v_founders from proj_company_grants
     where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities);
    if v_founders <= 1 then
      raise exception 'Cannot revoke the last founder of this company' using errcode = '23514';
    end if;
  end if;
  if exists (select 1 from proj_projects pr where pr.company_id = p_company_id and pr.pm_user_id = p_user_id and pr.status not in ('completed', 'archived')) then
    raise exception 'This person is the Project Manager of a live project. Assign another Project Manager first' using errcode = '23514';
  end if;
  if exists (select 1 from proj_teams t join proj_projects pr on pr.id = t.project_id
              where pr.company_id = p_company_id and t.head_user_id = p_user_id and t.removed_at is null and pr.status not in ('completed', 'archived')) then
    raise exception 'This person heads a department team on a live project. Choose another head first' using errcode = '23514';
  end if;
  update proj_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  update proj_project_members m set removed_at = now(), removed_by = auth.uid(), removal_reason = 'Projects access revoked'
   from proj_projects pr
   where m.project_id = pr.id and pr.company_id = p_company_id and m.user_id = p_user_id and m.removed_at is null;
  delete from notifications n using proj_projects pr
   where n.user_id = p_user_id and n.type like 'project\_%' and n.payload->>'project_id' = pr.id::text and pr.company_id = p_company_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  proj_display_name(uuid), proj_lock_project(uuid), proj_require_manager(proj_projects),
  proj_check_version(integer, integer), proj_log_change(uuid, text, uuid, text, text, text, text),
  proj_notify(uuid, uuid, text, jsonb, text, boolean), proj_next_reference(uuid),
  proj_add_member_row(uuid, uuid, text, uuid, date), proj_text_or_null(jsonb, text), proj_lock_handover(uuid),
  proj_status_rank(text), proj_member_blockers(uuid, uuid),
  proj_save_handover(uuid, jsonb, integer), proj_submit_handover(uuid), proj_assign_handover_pm(uuid, uuid),
  proj_request_handover_clarification(uuid, text), proj_withdraw_handover(uuid, text), proj_accept_handover(uuid),
  proj_create_internal_project(uuid, text, uuid, boolean, text, date, date, text, text),
  proj_assign_pm(uuid, uuid), proj_set_acting_pm(uuid, uuid, date), proj_end_acting_pm(uuid, uuid),
  proj_update_project(uuid, jsonb, integer), proj_set_status(uuid, text, text, date, integer),
  proj_add_member(uuid, uuid, uuid), proj_set_member_team(uuid, uuid, uuid), proj_remove_member(uuid, uuid, text, uuid),
  proj_save_team(uuid, uuid, text, uuid, uuid), proj_remove_team(uuid, uuid), proj_set_sales_link(uuid, uuid, boolean),
  proj_directory(), proj_handover_for_opportunity(uuid)
  from public, anon, authenticated;

grant execute on function
  proj_save_handover(uuid, jsonb, integer), proj_submit_handover(uuid), proj_assign_handover_pm(uuid, uuid),
  proj_request_handover_clarification(uuid, text), proj_withdraw_handover(uuid, text), proj_accept_handover(uuid),
  proj_create_internal_project(uuid, text, uuid, boolean, text, date, date, text, text),
  proj_assign_pm(uuid, uuid), proj_set_acting_pm(uuid, uuid, date), proj_end_acting_pm(uuid, uuid),
  proj_update_project(uuid, jsonb, integer), proj_set_status(uuid, text, text, date, integer),
  proj_add_member(uuid, uuid, uuid), proj_set_member_team(uuid, uuid, uuid), proj_remove_member(uuid, uuid, text, uuid),
  proj_save_team(uuid, uuid, text, uuid, uuid), proj_remove_team(uuid, uuid), proj_set_sales_link(uuid, uuid, boolean),
  proj_directory(), proj_handover_for_opportunity(uuid)
  to authenticated;
