-- Projects & Tasks Phase 2B: Operations. ADDITIVE. Applied AFTER 20270101000100.
--
-- WHAT IT ADDS
--   1. OPERATIONS MANAGER: a new Projects capability 'operations', given per company through the existing Projects grant (People & Access, proj_grant_access,
--      proj_revoke_access, the existing audit trigger). It lets its holder: read the Operations reads below for that company, assign or reassign Project Managers
--      through the existing handover functions (it implies 'assign_pm'), read that company's projects in full without joining them (proj_can_view_details), and
--      read and post in that company's project Chat groups. It gives NO Sales, Finance, HR or Warehouse right, and no task or delivery write: those stay with
--      their own grants and with the Project Manager. A founder holds every capability, so a founder
--      also sees Operations; Chat access needs the capability itself (explicit), not the founder shortcut.
--   2. SALES -> OPERATIONS PLANNING: eight planning fields on an enquiry that SALES owns (flag, expected decision date, whether dates are tentative, dismantling date,
--      expected teams, what Sales still has to confirm, a note written for Operations), and one row per flagged enquiry that OPERATIONS owns (provisional Project
--      Manager, risk, capacity conflict, a question for Sales and its answer). A provisional Project Manager is a note: it creates no project, books nobody and
--      reserves nothing.
--   3. ops_upcoming_work: the allowlisted read of flagged enquiries. It selects, by name: reference, title, stage, owner name, the planning fields, location, the three
--      dates, technologies as name and quantity, the linked event edition, the handover state. It NEVER selects value, currency, budget note, payment terms, the
--      brief, scope, exclusions, risks, evidence, estimates, proposals, files or activity notes.
--   4. EVENT EDITION carried through the handover into the project: the edition id and a small snapshot (event name, label, venue, city, published show dates) are
--      taken when the handover is saved or submitted and copied to the project when it is accepted. Later edits to the edition in Sales do not change either copy.
--      Handovers already accepted and existing projects stay unlinked.
--   5. CHAT: an Operations Manager is a member of the project groups of their companies; chat_my_groups says which project is archived and which groups are open
--      through Operations.
--   6. EQUIPMENT: proj_equipment_reviews records that a committed date changed while a request was with the warehouse (the old and the new date, per request). It
--      changes no reservation. proj_equipment_readiness states, per request, what is reserved, partly ready, short (a buy or rent shortage is SHORT, never
--      reserved), dispatched, returned and still out, and whether releasing unused reservations failed when the project finished.
--   7. ops_overview: the Operations Overview read for one company.
--   8. The closeout evidence gains the structured edition (the earlier function is kept as proj_closeout_evidence_base and wrapped).
-- NOTHING HERE reserves, releases, dispatches or receives stock, creates a project, completes one, or changes a task.
-- ROLLBACK: supabase/manual-sql/ops_phase2b_90_rollback.sql.

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 1. The capability. 'operations' implies 'assign_pm' (the handover functions, their visibility and their notices already test assign_pm).
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_capability_list()
returns text[] language sql immutable as $$
  select array['founder', 'assign_pm', 'manage_access', 'approve_scope', 'view_commercial', 'view_audit', 'reopen_project', 'override_site_conflict', 'operations']::text[];
$$;

create or replace function proj_has_capability(p_company_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from proj_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.company_id = p_company_id and g.revoked_at is null
      and ('founder' = any (g.capabilities) or p_capability = any (g.capabilities)
           or (p_capability = 'assign_pm' and 'operations' = any (g.capabilities))));
$$;

-- An Operations Manager READS the projects of their companies in full, as a founder does, without being on each project: the directory row, the plan, tasks,
-- milestones, people, site dates and equipment. Reading only: every write still asks for membership, management or its own capability, restricted files stay with
-- whoever manages the project, and the commercial record of a scope change stays with 'view_commercial'.
create or replace function proj_can_view_details(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from proj_projects pr
    where pr.id = p_project_id and (proj_is_founder(pr.company_id) or proj_is_active_member(pr.id) or proj_has_capability(pr.company_id, 'operations')));
$$;
create or replace function proj_can_view_summary(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from proj_projects pr
    where pr.id = p_project_id
      and (proj_is_founder(pr.company_id)
           or proj_is_active_member(pr.id)
           or proj_has_capability(pr.company_id, 'operations')
           or (proj_has_access(pr.company_id) and pr.status in ('planning', 'in_progress', 'ready_for_installation', 'on_site', 'on_hold'))
           or proj_sales_linked(pr.id)));
$$;

-- The companies the caller is Operations Manager of (founder included).
create or replace function ops_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select g.company_id from proj_company_grants g join profiles p on p.id = g.user_id and p.is_active
  where g.user_id = auth.uid() and g.revoked_at is null and ('founder' = any (g.capabilities) or 'operations' = any (g.capabilities));
$$;

create or replace function ops_require(p_company_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_company_id is null or not proj_has_capability(p_company_id, 'operations') then
    raise exception 'Operations is open to the Operations Managers of this company' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 2. Planning fields. Sales owns the columns on the enquiry; Operations owns ops_enquiry_planning.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table crm_opportunities add column if not exists ops_flagged_at timestamptz;
alter table crm_opportunities add column if not exists ops_flagged_by uuid references auth.users(id);
alter table crm_opportunities add column if not exists ops_decision_date date;
alter table crm_opportunities add column if not exists ops_dates_tentative boolean not null default true;
alter table crm_opportunities add column if not exists ops_dismantle_date date;
alter table crm_opportunities add column if not exists ops_teams text[] not null default '{}';
alter table crm_opportunities add column if not exists ops_to_confirm text;
alter table crm_opportunities add column if not exists ops_note text;
alter table crm_opportunities drop constraint if exists crm_opportunities_ops_shape;
alter table crm_opportunities add constraint crm_opportunities_ops_shape check (
  ops_teams <@ array['engineering', 'content', 'programming', 'installation', 'warehouse']::text[]
  and length(coalesce(ops_to_confirm, '')) <= 1000 and length(coalesce(ops_note, '')) <= 1000
  and ((ops_flagged_at is null) = (ops_flagged_by is null)));
create index if not exists idx_crm_opp_ops_flagged on crm_opportunities(company_id) where ops_flagged_at is not null;

create table if not exists ops_enquiry_planning (
  opportunity_id     uuid primary key references crm_opportunities(id) on delete cascade,
  company_id         uuid not null references companies(id),
  provisional_pm_id  uuid references auth.users(id),
  risk               text not null default 'unknown' check (risk in ('unknown', 'low', 'medium', 'high')),
  risk_note          text check (length(coalesce(risk_note, '')) <= 500),
  capacity_conflict  boolean not null default false,
  capacity_note      text check (length(coalesce(capacity_note, '')) <= 500),
  question           text check (length(coalesce(question, '')) <= 1000),
  question_by        uuid references auth.users(id),
  question_at        timestamptz,
  answer             text check (length(coalesce(answer, '')) <= 1000),
  answered_by        uuid references auth.users(id),
  answered_at        timestamptz,
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now()
);
alter table ops_enquiry_planning enable row level security;
drop policy if exists ops_enquiry_planning_select on ops_enquiry_planning;
create policy ops_enquiry_planning_select on ops_enquiry_planning for select
  using (proj_has_capability(company_id, 'operations') or crm_has_access(company_id));
revoke all on table ops_enquiry_planning from anon, authenticated, public;
grant select on table ops_enquiry_planning to authenticated;

-- People told about an Operations event of one company: its Operations Managers (the capability itself), never the caller. The types start with "project_" so
-- that they appear in the existing Project notices list (proj_my_notifications), which every Operations Manager has.
create or replace function ops_notify_managers(p_company_id uuid, p_type text, p_payload jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, type, payload)
    select g.user_id, p_type, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('dedupe_key', p_dedupe)
    from proj_company_grants g join profiles p on p.id = g.user_id and p.is_active
    where g.company_id = p_company_id and g.revoked_at is null and 'operations' = any (g.capabilities) and g.user_id <> auth.uid()
      and not exists (select 1 from notifications n where n.user_id = g.user_id and n.type = p_type and n.read_at is null and n.payload ->> 'dedupe_key' = p_dedupe);
end;
$$;

-- SALES: flag or unflag an enquiry for Operations planning and set the planning fields. The enquiry's owner or a Sales founder, as for any other edit.
-- p_fields keys (each optional; a key that is absent is left alone, null clears): decision_date, dates_tentative, dismantle_date, teams, to_confirm, note, answer.
create or replace function crm_set_ops_planning(p_id uuid, p_flag boolean, p_fields jsonb default '{}'::jsonb, p_expected_version integer default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v crm_opportunities; v_new integer; f jsonb := coalesce(p_fields, '{}'::jsonb); v_was boolean; v_bad text;
begin
  v := crm_lock_opportunity(p_id);
  perform crm_check_version(v, p_expected_version);
  perform crm_require_owner_or_founder(v);
  select k into v_bad from jsonb_object_keys(f) k where k not in ('decision_date', 'dates_tentative', 'dismantle_date', 'teams', 'to_confirm', 'note', 'answer') limit 1;
  if v_bad is not null then raise exception 'Unknown planning field' using errcode = '22023'; end if;
  if coalesce(p_flag, false) and v.stage = 'lost' then raise exception 'A lost enquiry cannot be flagged for Operations planning' using errcode = '23514'; end if;
  v_was := v.ops_flagged_at is not null;
  update crm_opportunities set
      ops_flagged_at = case when coalesce(p_flag, false) then coalesce(ops_flagged_at, now()) else null end,
      ops_flagged_by = case when coalesce(p_flag, false) then coalesce(ops_flagged_by, auth.uid()) else null end,
      ops_decision_date = case when f ? 'decision_date' then nullif(f ->> 'decision_date', '')::date else ops_decision_date end,
      ops_dates_tentative = case when f ? 'dates_tentative' then coalesce((f ->> 'dates_tentative')::boolean, true) else ops_dates_tentative end,
      ops_dismantle_date = case when f ? 'dismantle_date' then nullif(f ->> 'dismantle_date', '')::date else ops_dismantle_date end,
      ops_teams = case when f ? 'teams' then coalesce((select array_agg(distinct t order by t) from jsonb_array_elements_text(case when jsonb_typeof(f -> 'teams') = 'array' then f -> 'teams' else '[]'::jsonb end) t), '{}') else ops_teams end,
      ops_to_confirm = case when f ? 'to_confirm' then nullif(btrim(f ->> 'to_confirm'), '') else ops_to_confirm end,
      ops_note = case when f ? 'note' then nullif(btrim(f ->> 'note'), '') else ops_note end,
      version = version + 1, updated_at = now()
    where id = v.id returning version into v_new;
  if f ? 'answer' and nullif(btrim(f ->> 'answer'), '') is not null then
    update ops_enquiry_planning set answer = left(btrim(f ->> 'answer'), 1000), answered_by = auth.uid(), answered_at = now()
      where opportunity_id = v.id and question is not null;
    perform ops_notify_managers(v.company_id, 'project_ops_sales_answered', jsonb_build_object('opportunity_id', v.id, 'reference', v.reference), 'ops_answer:' || v.id::text);
  end if;
  if coalesce(p_flag, false) and not v_was then
    perform crm_log_event(v.id, v.company_id, 'details_changed', null, null, 'Flagged for Operations planning');
    perform ops_notify_managers(v.company_id, 'project_ops_enquiry_flagged', jsonb_build_object('opportunity_id', v.id, 'reference', v.reference), 'ops_flag:' || v.id::text);
  elsif not coalesce(p_flag, false) and v_was then
    perform crm_log_event(v.id, v.company_id, 'details_changed', null, null, 'Removed from Operations planning');
  end if;
  return v_new;
end;
$$;

-- OPERATIONS: the planning row of a flagged enquiry. p_patch keys (each optional): provisional_pm_id, risk, risk_note, capacity_conflict, capacity_note, question.
-- A provisional Project Manager must be someone who could be assigned (proj_user_eligible), and is only a note: nothing else is written anywhere.
create or replace function ops_set_enquiry_planning(p_opportunity_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare o crm_opportunities; f jsonb := coalesce(p_patch, '{}'::jsonb); v_pm uuid; v_bad text; v_what text[] := '{}';
begin
  select * into o from crm_opportunities where id = p_opportunity_id;
  if not found or not proj_has_capability(o.company_id, 'operations') then raise exception 'Enquiry not found' using errcode = 'P0002'; end if;
  if o.ops_flagged_at is null then raise exception 'Sales has not flagged this enquiry for Operations planning' using errcode = '23514'; end if;
  if o.stage = 'lost' then raise exception 'This enquiry was lost' using errcode = '23514'; end if;
  select k into v_bad from jsonb_object_keys(f) k where k not in ('provisional_pm_id', 'risk', 'risk_note', 'capacity_conflict', 'capacity_note', 'question') limit 1;
  if v_bad is not null then raise exception 'Unknown planning field' using errcode = '22023'; end if;
  if f ? 'provisional_pm_id' then
    v_pm := nullif(f ->> 'provisional_pm_id', '')::uuid;
    if v_pm is not null and not proj_user_eligible(o.company_id, v_pm) then
      raise exception 'Choose someone who has Projects access for this company' using errcode = '23514';
    end if;
  end if;
  insert into ops_enquiry_planning (opportunity_id, company_id, updated_by) values (o.id, o.company_id, auth.uid()) on conflict (opportunity_id) do nothing;
  update ops_enquiry_planning set
      provisional_pm_id = case when f ? 'provisional_pm_id' then v_pm else provisional_pm_id end,
      risk = case when f ? 'risk' then coalesce(nullif(f ->> 'risk', ''), 'unknown') else risk end,
      risk_note = case when f ? 'risk_note' then nullif(btrim(f ->> 'risk_note'), '') else risk_note end,
      capacity_conflict = case when f ? 'capacity_conflict' then coalesce((f ->> 'capacity_conflict')::boolean, false) else capacity_conflict end,
      capacity_note = case when f ? 'capacity_note' then nullif(btrim(f ->> 'capacity_note'), '') else capacity_note end,
      question = case when f ? 'question' then nullif(btrim(f ->> 'question'), '') else question end,
      question_by = case when f ? 'question' then case when nullif(btrim(f ->> 'question'), '') is null then null else auth.uid() end else question_by end,
      question_at = case when f ? 'question' then case when nullif(btrim(f ->> 'question'), '') is null then null else now() end else question_at end,
      answer = case when f ? 'question' then null else answer end,
      answered_by = case when f ? 'question' then null else answered_by end,
      answered_at = case when f ? 'question' then null else answered_at end,
      updated_by = auth.uid(), updated_at = now()
    where opportunity_id = o.id;
  if f ? 'provisional_pm_id' then v_what := v_what || case when v_pm is null then 'provisional Project Manager removed' else 'provisional Project Manager named: ' || proj_display_name(v_pm) end; end if;
  if f ? 'capacity_conflict' and coalesce((f ->> 'capacity_conflict')::boolean, false) then v_what := v_what || 'capacity conflict flagged'::text; end if;
  if f ? 'question' and nullif(btrim(f ->> 'question'), '') is not null then v_what := v_what || 'asked Sales to confirm details'::text; end if;
  if cardinality(v_what) > 0 then
    perform crm_log_event(o.id, o.company_id, 'details_changed', null, null, 'Operations: ' || array_to_string(v_what, '; '));
    -- Sales reads this on the enquiry (the "From Operations" block and the history line above). No notice is sent: Sales has no notice list of its own.
  end if;
end;
$$;

create or replace function ops_edition_snapshot(p_edition_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('edition_id', ed.id, 'event_id', ev.id, 'event_name', ev.name,
           'label', concat_ws(' · ', ev.name, extract(year from ed.start_date)::int::text, nullif(btrim(coalesce(ed.city, '')), '')),
           'venue', ed.venue, 'city', ed.city, 'country_code', ed.country_code, 'start_date', ed.start_date, 'end_date', ed.end_date)
  from crm_event_editions ed join crm_events ev on ev.id = ed.event_id where ed.id = p_edition_id;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 3. Upcoming Work: flagged enquiries of the caller's Operations companies (or of one of them). Allowlist only; see the header for what is never selected.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function ops_upcoming_work(p_company_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_company_id is not null then perform ops_require(p_company_id); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', o.id, 'company_id', o.company_id, 'reference', o.reference, 'title', o.title, 'stage', o.stage, 'owner_id', o.owner_id, 'owner', proj_display_name(o.owner_id),
        'flagged_at', o.ops_flagged_at, 'decision_date', o.ops_decision_date,
        -- Dates stop being tentative when Sales wins the enquiry, whatever the tick says.
        'dates_tentative', (o.stage <> 'won' and o.ops_dates_tentative), 'won', o.stage = 'won',
        'location', o.location, 'install_start', o.install_start, 'event_start', o.event_start, 'event_end', o.event_end, 'dismantle_date', o.ops_dismantle_date,
        'edition', case when o.event_edition_id is null then null else ops_edition_snapshot(o.event_edition_id) end,
        'teams', to_jsonb(o.ops_teams),
        'equipment', (select coalesce(jsonb_agg(jsonb_build_object('name', t ->> 'name', 'qty', t -> 'qty') order by n), '[]'::jsonb)
                      from jsonb_array_elements(case when jsonb_typeof(o.technologies) = 'array' then o.technologies else '[]'::jsonb end) with ordinality as t(t, n)),
        'to_confirm', o.ops_to_confirm, 'note', o.ops_note,
        'planning', (select jsonb_build_object('provisional_pm_id', pl.provisional_pm_id, 'provisional_pm', case when pl.provisional_pm_id is null then null else proj_display_name(pl.provisional_pm_id) end,
                        'risk', pl.risk, 'risk_note', pl.risk_note, 'capacity_conflict', pl.capacity_conflict, 'capacity_note', pl.capacity_note,
                        'question', pl.question, 'question_at', pl.question_at, 'question_by', case when pl.question_by is null then null else proj_display_name(pl.question_by) end,
                        'answer', pl.answer, 'answered_at', pl.answered_at)
                     from ops_enquiry_planning pl where pl.opportunity_id = o.id),
        'handover', (select jsonb_build_object('id', h.id, 'status', h.status, 'submitted_at', h.submitted_at, 'pm', case when h.pm_user_id is null then null else proj_display_name(h.pm_user_id) end, 'project_id', h.project_id)
                     from proj_handovers h where h.crm_opportunity_id = o.id and h.status <> 'withdrawn' order by h.created_at desc limit 1))
      order by o.ops_decision_date nulls last, coalesce(o.install_start, o.event_start) nulls last, o.reference)
    from crm_opportunities o
    where o.ops_flagged_at is not null and o.stage <> 'lost'
      and o.company_id in (select ops_company_ids()) and (p_company_id is null or o.company_id = p_company_id)
      -- once the project exists the work is in Projects, not in Upcoming Work
      and not exists (select 1 from proj_handovers h where h.crm_opportunity_id = o.id and h.status = 'accepted')
  ), '[]'::jsonb);
end;
$$;

-- What Sales sees of the Operations side of ONE enquiry (the planning row is also readable through its policy; this adds the names).
create or replace function crm_ops_planning(p_opportunity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o crm_opportunities;
begin
  select * into o from crm_opportunities where id = p_opportunity_id;
  if not found or not crm_has_access(o.company_id) then raise exception 'Opportunity not found' using errcode = 'P0002'; end if;
  return (select jsonb_build_object('provisional_pm', case when pl.provisional_pm_id is null then null else proj_display_name(pl.provisional_pm_id) end,
            'risk', pl.risk, 'risk_note', pl.risk_note, 'capacity_conflict', pl.capacity_conflict, 'capacity_note', pl.capacity_note,
            'question', pl.question, 'question_at', pl.question_at, 'question_by', case when pl.question_by is null then null else proj_display_name(pl.question_by) end,
            'answer', pl.answer, 'answered_at', pl.answered_at)
          from ops_enquiry_planning pl where pl.opportunity_id = o.id);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 4. The event edition, carried through the handover into the project.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table proj_handovers add column if not exists event_edition_id uuid references crm_event_editions(id);
alter table proj_handovers add column if not exists edition_snapshot jsonb;
alter table proj_project_details add column if not exists event_edition_id uuid references crm_event_editions(id);
alter table proj_project_details add column if not exists edition_snapshot jsonb;
create index if not exists idx_proj_details_edition on proj_project_details(event_edition_id) where event_edition_id is not null;

-- The handover takes the enquiry's edition while Sales is still preparing it, and again when it is submitted (or resubmitted after a question). From then on it is a
-- copy: an edit to the edition in Sales does not reach it.
create or replace function proj_handover_edition()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_edition uuid;
begin
  if tg_op = 'INSERT' or new.status = 'draft' or old.status in ('draft', 'clarification_requested') or (old.status is distinct from new.status and new.status = 'submitted') then
    select o.event_edition_id into v_edition from crm_opportunities o where o.id = new.crm_opportunity_id;
    new.event_edition_id := v_edition;
    new.edition_snapshot := case when v_edition is null then null else ops_edition_snapshot(v_edition) || jsonb_build_object('taken_at', now()) end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proj_handover_edition on proj_handovers;
-- It never changes an accepted handover: none of its conditions is true for one, and the existing trigger that freezes an accepted handover still applies.
create trigger trg_proj_handover_edition before insert or update on proj_handovers for each row execute function proj_handover_edition();

-- The project takes the handover's copy when it is created by acceptance.
create or replace function proj_details_edition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select h.event_edition_id, h.edition_snapshot into new.event_edition_id, new.edition_snapshot
    from proj_projects p join proj_handovers h on h.id = p.handover_id where p.id = new.project_id;
  return new;
end;
$$;
drop trigger if exists trg_proj_details_edition on proj_project_details;
create trigger trg_proj_details_edition before insert on proj_project_details for each row execute function proj_details_edition();

-- Handovers that are still open take the edition now. Accepted handovers are a historical record and stay as they are, so their projects stay unlinked.
update proj_handovers h set event_edition_id = o.event_edition_id, edition_snapshot = ops_edition_snapshot(o.event_edition_id) || jsonb_build_object('taken_at', now())
  from crm_opportunities o
  where o.id = h.crm_opportunity_id and o.event_edition_id is not null and h.event_edition_id is null and h.status in ('draft', 'submitted', 'pm_assigned', 'clarification_requested');

-- The edition of each project the caller can see in the directory (for the edition column and filter).
create or replace function proj_project_editions()
returns table (project_id uuid, edition_id uuid, label text, start_date date, end_date date)
language sql stable security definer set search_path = public as $$
  select d.project_id, d.event_edition_id, d.edition_snapshot ->> 'label', (d.edition_snapshot ->> 'start_date')::date, (d.edition_snapshot ->> 'end_date')::date
  from proj_project_details d
  where d.event_edition_id is not null and auth.uid() is not null and proj_can_view_summary(d.project_id);
$$;

-- The delivery projects on one edition that the caller may see (for the link from a Sales event). Someone with no Projects access gets no row.
create or replace function proj_projects_for_edition(p_edition_id uuid)
returns table (project_id uuid, reference text, name text, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.reference, p.name, p.status
  from proj_project_details d join proj_projects p on p.id = d.project_id
  where d.event_edition_id = p_edition_id and auth.uid() is not null and proj_can_view_summary(p.id)
  order by p.reference;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 5. Chat: the explicit Operations path into a company's project groups.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The capability itself, on the project's company, for ANY user. A founder without it is not a member through this path.
create or replace function chat_is_ops(p_user uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from proj_projects pr
    join proj_company_grants g on g.company_id = pr.company_id and g.user_id = p_user and g.revoked_at is null and 'operations' = any (g.capabilities)
    join profiles p on p.id = g.user_id and p.is_active
    where pr.id = p_project);
$$;

create or replace function chat_is_member(p_user uuid, p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chat_groups g where g.id = p_group and (
      (g.kind = 'sales' and g.company_id is not null and chat_has_company_grant(p_user, g.company_id))
      or (g.kind = 'project' and g.project_id is not null and (chat_is_project_member(p_user, g.project_id) or chat_is_ops(p_user, g.project_id)))));
$$;

create or replace function chat_project_group(p_project uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not (chat_is_project_member(v_user, p_project) or chat_is_ops(v_user, p_project)) then raise exception 'You are not a member of this group' using errcode = '42501'; end if;
  return chat_ensure_project_group(p_project);
end;
$$;

-- The caller's groups. Two more columns: the project's real status (the panel puts ARCHIVED projects under a collapsed section) and whether the group is open to the
-- caller through Operations only. The return type changes, so the function is dropped and created again in this transaction.
drop function if exists chat_my_groups();
create function chat_my_groups()
returns table (gid uuid, gkey text, gname text, unread bigint, mentions bigint, last_at timestamptz, last_sender text, last_preview text, gkind text, project_id uuid, read_only boolean,
               project_status text, via_operations boolean)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform chat_sync_sales_groups();
  perform chat_ensure_project_group(m.project_id) from proj_project_members m
    where m.user_id = v_user and m.removed_at is null and not exists (select 1 from chat_groups g where g.project_id = m.project_id);
  -- An Operations Manager's live projects get their group too, so the conversation is there before anyone has posted.
  perform chat_ensure_project_group(pr.id) from proj_projects pr
    where pr.status not in ('completed', 'archived') and chat_is_ops(v_user, pr.id) and not exists (select 1 from chat_groups g where g.project_id = pr.id);
  insert into chat_read_state (user_id, group_id, last_read_seq)
    select v_user, g.id, coalesce((select max(m.seq) from chat_messages m where m.group_id = g.id), 0)
    from chat_groups g where chat_is_member(v_user, g.id)
  on conflict do nothing;
  return query
    select g.id, g.key, case when pr.id is null then g.name else pr.reference || ' · ' || pr.name end,
           (select count(*) from chat_messages m where m.group_id = g.id and m.seq > rs.last_read_seq and m.sender_id <> v_user),
           (select count(*) from chat_message_mentions mm join chat_messages m on m.id = mm.message_id
              where m.group_id = g.id and mm.user_id = v_user and m.seq > rs.last_read_seq and m.sender_id <> v_user),
           lm.created_at, case when lm.id is null then null else chat_name(lm.sender_id) end,
           case when lm.id is null then null when length(btrim(lm.body)) = 0 then 'Shared an item' else left(lm.body, 80) end,
           g.kind, g.project_id, coalesce(pr.status in ('completed', 'archived'), false),
           pr.status, (g.kind = 'project' and not chat_is_project_member(v_user, g.project_id))
    from chat_groups g
    join chat_read_state rs on rs.user_id = v_user and rs.group_id = g.id
    left join proj_projects pr on pr.id = g.project_id
    left join lateral (select m2.id, m2.created_at, m2.sender_id, m2.body from chat_messages m2 where m2.group_id = g.id order by m2.seq desc limit 1) lm on true
    where chat_is_member(v_user, g.id)
      and (g.kind <> 'project' or pr.status not in ('completed', 'archived') or lm.id is not null)
    order by case when g.kind = 'sales' then 0 else 1 end, g.sort_order, lm.created_at desc nulls last, 3;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 6. Equipment: a committed date changed while a request is with the warehouse; and readiness stated from the Inventory records.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists proj_equipment_reviews (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references proj_projects(id) on delete cascade,
  request_id       uuid not null references inv_requests(id) on delete cascade,
  field            text not null check (field in ('install_start', 'event_start', 'event_end')),
  old_date         date,
  new_date         date,
  changed_by       uuid references auth.users(id),
  changed_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id),
  resolution_note  text check (length(coalesce(resolution_note, '')) <= 500)
);
create unique index if not exists uq_proj_equipment_reviews_open on proj_equipment_reviews(request_id, field) where resolved_at is null;
create index if not exists idx_proj_equipment_reviews_project on proj_equipment_reviews(project_id) where resolved_at is null;
alter table proj_equipment_reviews enable row level security;
drop policy if exists proj_equipment_reviews_select on proj_equipment_reviews;
create policy proj_equipment_reviews_select on proj_equipment_reviews for select using (
  proj_can_view_details(project_id) or proj_has_capability(proj_project_company(project_id), 'operations') or inv_has_capability(proj_project_company(project_id), 'warehouse'));
revoke all on table proj_equipment_reviews from anon, authenticated, public;
grant select on table proj_equipment_reviews to authenticated;

-- A request needs a review when it has left draft and is not finished: it is with the warehouse, or stock is reserved or out for it.
create or replace function proj_details_dates_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; c record; v_pm uuid;
begin
  for c in select * from (values ('install_start', old.install_start, new.install_start), ('event_start', old.event_start, new.event_start), ('event_end', old.event_end, new.event_end)) as x(field, old_date, new_date)
           where x.old_date is distinct from x.new_date loop
    for r in select q.id, q.code from inv_requests q where q.project_id = new.project_id and q.status in ('submitted', 'in_progress', 'fulfilled') loop
      -- One open review per request and date: a second change keeps the first "old" date, so the review shows where the booking was made from.
      insert into proj_equipment_reviews (project_id, request_id, field, old_date, new_date, changed_by) values (new.project_id, r.id, c.field, c.old_date, c.new_date, auth.uid())
        on conflict (request_id, field) where resolved_at is null do update set new_date = excluded.new_date, changed_by = excluded.changed_by, changed_at = now();
      select pm_user_id into v_pm from proj_projects where id = new.project_id;
      perform proj_notify(new.project_id, v_pm, 'project_equipment_review', jsonb_build_object('request_id', r.id, 'request_code', r.code), 'equipment_review:' || r.id::text);
    end loop;
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_proj_details_dates_changed on proj_project_details;
create trigger trg_proj_details_dates_changed after update of install_start, event_start, event_end on proj_project_details
  for each row when (old.install_start is distinct from new.install_start or old.event_start is distinct from new.event_start or old.event_end is distinct from new.event_end)
  execute function proj_details_dates_changed();

-- "Reviewed": whoever manages the project, or the warehouse of its company. It records the decision; it changes no reservation and no request date. Changing the
-- booking itself stays the warehouse's "Change dates" on the request, with its own conflict checks.
create or replace function proj_resolve_equipment_review(p_review_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v proj_equipment_reviews;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into v from proj_equipment_reviews where id = p_review_id;
  if not found or not (proj_can_manage(v.project_id) or inv_has_capability(proj_project_company(v.project_id), 'warehouse')) then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;
  if v.resolved_at is not null then return; end if;
  update proj_equipment_reviews set resolved_at = now(), resolved_by = auth.uid(), resolution_note = nullif(left(btrim(coalesce(p_note, '')), 500), '') where id = v.id;
end;
$$;

-- The state of ONE request, from its lines and reservations (inv_line_progress). Internal: callers check access.
--   state: draft | cancelled | reserved | partially_ready | short | partially_dispatched | dispatched | still_out | returned
--   A line whose shortage is to be bought or rented is SHORT (counted in short_buy / short_rent). It is not reserved until stock is reserved for it.
create or replace function inv_request_state(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r inv_requests; v jsonb;
begin
  select * into r from inv_requests where id = p_request_id;
  if not found then return null; end if;
  select jsonb_build_object(
      'lines', count(*),
      'reserved_lines', count(*) filter (where x.short = 0 and x.dispatched = 0),
      'partial_lines', count(*) filter (where x.short > 0 and x.win > 0 and x.dispatched = 0),
      'short_lines', count(*) filter (where x.short > 0),
      'short_buy', count(*) filter (where x.short > 0 and x.shortage_action = 'need_to_buy'),
      'short_rent', count(*) filter (where x.short > 0 and x.shortage_action = 'need_to_rent'),
      'short_no_plan', count(*) filter (where x.short > 0 and x.shortage_action = 'none'),
      'dispatched_lines', count(*) filter (where x.dispatched > 0),
      'returned_lines', count(*) filter (where x.dispatched > 0 and x.returned >= x.dispatched),
      'units_asked', coalesce(sum(x.qty), 0), 'units_short', coalesce(sum(x.short), 0), 'units_dispatched', coalesce(sum(x.dispatched), 0),
      'units_returned', coalesce(sum(x.returned), 0), 'units_out', coalesce(sum(greatest(0, x.dispatched - x.returned)), 0))
    into v
    from (select l.qty, l.shortage_action, (p ->> 'reserved_for_window')::numeric as win, (p ->> 'dispatched')::numeric as dispatched, (p ->> 'returned')::numeric as returned,
                 (p ->> 'shortage')::numeric as short
          from inv_request_lines l cross join lateral inv_line_progress(l) p where l.request_id = r.id and l.status <> 'cancelled') x;
  return v || jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'needed_from', r.needed_from, 'needed_until', r.needed_until, 'expected_return_at', r.expected_return_at,
    'return_overdue', ((v ->> 'units_out')::numeric > 0 and r.expected_return_at is not null and r.expected_return_at < now()),
    'state', case
      when r.status = 'draft' then 'draft' when r.status = 'cancelled' then 'cancelled'
      when (v ->> 'units_dispatched')::numeric > 0 and (v ->> 'units_out')::numeric = 0 and (v ->> 'dispatched_lines')::int >= (v ->> 'lines')::int then 'returned'
      when (v ->> 'units_out')::numeric > 0 and (v ->> 'dispatched_lines')::int < (v ->> 'lines')::int then 'partially_dispatched'
      when (v ->> 'units_out')::numeric > 0 and (v ->> 'units_returned')::numeric > 0 then 'still_out'
      when (v ->> 'units_out')::numeric > 0 then 'dispatched'
      when (v ->> 'units_dispatched')::numeric > 0 then 'returned'
      when (v ->> 'short_lines')::int > 0 and (v ->> 'short_lines')::int < (v ->> 'lines')::int then 'partially_ready'
      when (v ->> 'short_lines')::int > 0 then 'short'
      else 'reserved' end);
end;
$$;

-- Is there still something the completion release should have dealt with: a request left in draft or submitted, or stock reserved and never dispatched?
create or replace function inv_project_release_pending(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from inv_requests q where q.project_id = p_project_id and q.status in ('draft', 'submitted'))
      or exists (select 1 from inv_requests q join inv_request_lines l on l.request_id = q.id join inv_reservations x on x.request_line_id = l.id
                 where q.project_id = p_project_id and q.status <> 'cancelled' and x.status = 'active' and x.qty > x.dispatched_qty);
$$;

-- Readiness of ONE project's equipment for the people who run it, Operations and the warehouse. "release_failed" is the latest failed release of unused
-- reservations at completion (the project still completed); the warehouse releases those lines on the request.
create or replace function proj_equipment_readiness(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr proj_projects;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into pr from proj_projects where id = p_project_id;
  if not found or not (proj_can_view_details(pr.id) or proj_has_capability(pr.company_id, 'operations') or inv_has_capability(pr.company_id, 'warehouse')) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'project_status', pr.status,
    'requests', coalesce((select jsonb_agg(inv_request_state(q.id) order by q.created_at, q.id) from inv_requests q where q.project_id = pr.id and q.status <> 'cancelled'), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'request_id', v.request_id, 'request_code', q.code, 'field', v.field, 'old_date', v.old_date, 'new_date', v.new_date,
                           'changed_at', v.changed_at, 'changed_by', case when v.changed_by is null then null else proj_display_name(v.changed_by) end) order by v.changed_at, v.id)
                         from proj_equipment_reviews v join inv_requests q on q.id = v.request_id where v.project_id = pr.id and v.resolved_at is null), '[]'::jsonb),
    -- Reported only while something is still left to release: once the warehouse has released or cancelled it by hand, the old log line no longer raises it.
    'release_failed', (select jsonb_build_object('at', g.created_at, 'detail', left(g.detail, 300)) from inv_import_log g
                       where g.project_id = pr.id and g.outcome = 'failed' and g.detail like 'Releasing equipment%'
                         and pr.status in ('completed', 'archived') and inv_project_release_pending(pr.id) order by g.created_at desc limit 1));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 7. Operations Overview for ONE company. Recorded facts only: handovers, projects with their dates, people and open issues, equipment state, overlapping
--    commitments of the same person. No score, no capacity figure. What is not recorded is returned as null so the screen can say "not recorded".
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function ops_overview(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform ops_require(p_company_id);
  return jsonb_build_object(
    'company_id', p_company_id, 'taken_at', now(),
    'handovers', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'sales_reference', h.crm_reference, 'title', h.title, 'status', h.status, 'submitted_at', h.submitted_at,
               'pm_id', h.pm_user_id, 'pm', case when h.pm_user_id is null then null else proj_display_name(h.pm_user_id) end, 'pm_assigned_at', h.pm_assigned_at,
               'install_start', h.install_start, 'event_start', h.event_start, 'event_end', h.event_end, 'venue', h.location, 'edition', h.edition_snapshot ->> 'label',
               'clarification_requested_at', h.clarification_requested_at) order by h.submitted_at nulls last, h.created_at)
      from proj_handovers h where h.company_id = p_company_id and h.status in ('submitted', 'pm_assigned', 'clarification_requested')), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'reference', p.reference, 'name', p.name, 'kind', p.kind, 'status', p.status, 'pm_id', p.pm_user_id, 'pm', proj_display_name(p.pm_user_id),
          'chat_group_id', (select g.id from chat_groups g where g.project_id = p.id),
          'venue', d.location, 'install_start', d.install_start, 'event_start', d.event_start, 'event_end', d.event_end, 'edition', d.edition_snapshot ->> 'label',
          'tasks_open', (select count(*) from proj_tasks t where t.project_id = p.id and t.status in ('todo', 'in_progress', 'ready_for_review')),
          'tasks_overdue', (select count(*) from proj_tasks t where t.project_id = p.id and t.status in ('todo', 'in_progress') and t.due_date < current_date),
          'reviews_waiting', (select count(*) from proj_tasks t where t.project_id = p.id and t.status = 'ready_for_review'),
          'reviews_overdue', (select count(*) from proj_tasks t where t.project_id = p.id and t.status = 'ready_for_review' and t.due_date < current_date),
          'blockers', coalesce((select jsonb_agg(jsonb_build_object('task_id', t.id, 'title', t.title, 'since', t.blocked_at, 'reason', left(t.blocked_reason, 200),
                                   'assignee', proj_display_name(t.assignee_id), 'unblock_owner', case when t.unblock_owner_id is null then null else proj_display_name(t.unblock_owner_id) end,
                                   'cross_team', (t.unblock_owner_id is not null and t.unblock_owner_id <> t.assignee_id)) order by t.blocked_at)
                                from (select * from proj_tasks where project_id = p.id and blocked_at is not null and status in ('todo', 'in_progress', 'ready_for_review') order by blocked_at limit 5) t), '[]'::jsonb),
          'next_milestone', (select jsonb_build_object('id', m.id, 'title', m.title, 'due_date', m.due_date, 'status', m.status) from proj_milestones m
                             where m.project_id = p.id and m.status in ('planned', 'in_progress', 'ready_for_acceptance') order by m.due_date nulls last, m.sort_order limit 1),
          'milestones_overdue', (select count(*) from proj_milestones m where m.project_id = p.id and m.status in ('planned', 'in_progress', 'ready_for_acceptance') and m.due_date < current_date),
          'corrections_open', (select count(*) from proj_dp_corrections c where c.project_id = p.id and c.status = 'open'),
          'plan_changes_open', (select count(*) from proj_dp_changes c where c.project_id = p.id and c.status = 'proposed'),
          'plan_unreleased', (select count(*) from proj_dp_lines l join proj_dp_items i on i.id = l.item_id where i.project_id = p.id and l.removed_at is null and i.removed_at is null and l.released_at is null),
          'equipment', coalesce((select jsonb_agg(inv_request_state(q.id) order by q.created_at, q.id) from inv_requests q where q.project_id = p.id and q.status <> 'cancelled'), '[]'::jsonb),
          'equipment_reviews', (select count(*) from proj_equipment_reviews v where v.project_id = p.id and v.resolved_at is null),
          'release_failed', (p.status in ('completed', 'archived') and inv_project_release_pending(p.id)
                             and exists (select 1 from inv_import_log g where g.project_id = p.id and g.outcome = 'failed' and g.detail like 'Releasing equipment%')))
        order by coalesce(d.install_start, d.event_start, p.start_date) nulls last, p.reference)
      from proj_projects p left join proj_project_details d on d.project_id = p.id
      where p.company_id = p_company_id
        and (p.status not in ('completed', 'archived')
             -- a finished project stays while its equipment is out, a review is open, or the release of unused reservations failed
             or exists (select 1 from inv_requests q join inv_request_lines l on l.request_id = q.id join inv_reservations x on x.request_line_id = l.id
                        where q.project_id = p.id and x.dispatched_qty > x.returned_qty)
             or exists (select 1 from proj_equipment_reviews v where v.project_id = p.id and v.resolved_at is null)
             or (inv_project_release_pending(p.id) and exists (select 1 from inv_import_log g where g.project_id = p.id and g.outcome = 'failed' and g.detail like 'Releasing equipment%')))), '[]'::jsonb),
    -- The same person on two live projects whose recorded delivery windows (installation start to event end) overlap. Only where both windows are recorded.
    'overlaps', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'person', proj_display_name(o.user_id), 'a', o.a_ref, 'a_id', o.a_id, 'b', o.b_ref, 'b_id', o.b_id, 'from', o.o_from, 'to', o.o_to)
                       order by o.o_from, o.user_id)
      from (
        select ma.user_id, pa.id as a_id, pa.reference as a_ref, pb.id as b_id, pb.reference as b_ref,
               greatest(coalesce(da.install_start, da.event_start), coalesce(db.install_start, db.event_start)) as o_from, least(da.event_end, db.event_end) as o_to
        from proj_project_members ma
        join proj_projects pa on pa.id = ma.project_id and pa.company_id = p_company_id and pa.status not in ('completed', 'archived')
        join proj_project_details da on da.project_id = pa.id
        join proj_project_members mb on mb.user_id = ma.user_id and mb.removed_at is null and mb.project_id > ma.project_id
        join proj_projects pb on pb.id = mb.project_id and pb.company_id = p_company_id and pb.status not in ('completed', 'archived')
        join proj_project_details db on db.project_id = pb.id
        where ma.removed_at is null
          and coalesce(da.install_start, da.event_start) is not null and da.event_end is not null
          and coalesce(db.install_start, db.event_start) is not null and db.event_end is not null
          and coalesce(da.install_start, da.event_start) <= db.event_end and coalesce(db.install_start, db.event_start) <= da.event_end
          and da.event_end >= current_date and db.event_end >= current_date
        limit 60) o), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- 8. Closeout evidence: the structured edition, when the project has one. The function installed by 20270101000100 is kept under a new name and wrapped, so the
--    evidence is otherwise exactly what it was. Without an edition the evidence is unchanged (no "edition" key).
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.proj_closeout_evidence_base(uuid)') is null then
    alter function proj_closeout_evidence(uuid) rename to proj_closeout_evidence_base;
  end if;
end $$;
create or replace function proj_closeout_evidence(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_ed jsonb;
begin
  v := proj_closeout_evidence_base(p_project_id);        -- checks that the caller manages the project
  select d.edition_snapshot into v_ed from proj_project_details d where d.project_id = p_project_id and d.event_edition_id is not null;
  if v_ed is null then return v; end if;
  return jsonb_set(v, '{project,edition}', jsonb_build_object('label', v_ed ->> 'label', 'event_name', v_ed ->> 'event_name', 'venue', v_ed ->> 'venue', 'city', v_ed ->> 'city',
                                                              'start_date', v_ed ->> 'start_date', 'end_date', v_ed ->> 'end_date'));
end;
$$;

revoke all on function
  ops_company_ids(), ops_require(uuid), ops_notify_managers(uuid, text, jsonb, text), crm_set_ops_planning(uuid, boolean, jsonb, integer), ops_set_enquiry_planning(uuid, jsonb),
  ops_edition_snapshot(uuid), ops_upcoming_work(uuid), crm_ops_planning(uuid), proj_handover_edition(), proj_details_edition(), proj_project_editions(),
  proj_projects_for_edition(uuid), chat_is_ops(uuid, uuid), chat_is_member(uuid, uuid), chat_project_group(uuid), chat_my_groups(), proj_details_dates_changed(),
  proj_resolve_equipment_review(uuid, text), inv_request_state(uuid), inv_project_release_pending(uuid), proj_equipment_readiness(uuid), ops_overview(uuid), proj_closeout_evidence_base(uuid),
  proj_closeout_evidence(uuid)
  from public, anon, authenticated;
grant execute on function
  ops_company_ids(), crm_set_ops_planning(uuid, boolean, jsonb, integer), ops_set_enquiry_planning(uuid, jsonb), ops_upcoming_work(uuid), crm_ops_planning(uuid),
  proj_project_editions(), proj_projects_for_edition(uuid), chat_project_group(uuid), chat_my_groups(), proj_resolve_equipment_review(uuid, text),
  proj_equipment_readiness(uuid), ops_overview(uuid), proj_closeout_evidence(uuid)
  to authenticated;
