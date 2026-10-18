-- Projects & Tasks (Release 2), migration 2 of 7: core tables, visibility helpers and row-level security.
--
-- Everything here is READ-ONLY to clients (SELECT policies only, no INSERT/UPDATE/DELETE policies, no DML grants).
-- Changes go through the SECURITY DEFINER functions in migrations 3-5, which enforce role rules.
--
-- Three data tiers are kept in DIFFERENT tables because row-level security cannot hide columns:
--   summary-safe        proj_projects                 (any Projects-access holder sees ongoing projects in their company)
--   member-only         proj_project_details and every other table about a project (members, founders)
--   commercially restricted  proj_scope_change_commercial (migration 5)
-- No Sales value, budget, PO or evidence reference is ever copied into any of them.

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists proj_projects (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  reference           text not null,
  name                text not null check (length(btrim(name)) between 1 and 200),
  kind                text not null check (kind in ('client', 'internal')),
  status              text not null default 'planning' check (status in (
                        'planning', 'in_progress', 'ready_for_installation', 'on_site', 'on_hold', 'completed', 'archived')),
  priority            text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  pm_user_id          uuid not null references auth.users(id),
  -- Internal projects only: continuing work that is never forced through installation / show states.
  is_ongoing          boolean not null default false,
  start_date          date,
  end_date            date,
  crm_opportunity_id  uuid references crm_opportunities(id),
  handover_id         uuid,
  created_by          uuid not null references auth.users(id),
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,
  archived_at         timestamptz,
  constraint proj_projects_ref_unique unique (company_id, reference),
  constraint proj_projects_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint proj_projects_kind_link check ((kind = 'client') = (crm_opportunity_id is not null)),
  constraint proj_projects_ongoing_internal check (not is_ongoing or kind = 'internal'),
  constraint proj_projects_internal_states check (kind = 'client' or status not in ('ready_for_installation', 'on_site'))
);
create unique index if not exists uq_proj_projects_opportunity on proj_projects(crm_opportunity_id) where crm_opportunity_id is not null;
create unique index if not exists uq_proj_projects_handover on proj_projects(handover_id) where handover_id is not null;
create index if not exists idx_proj_projects_company_status on proj_projects(company_id, status);
create index if not exists idx_proj_projects_pm on proj_projects(pm_user_id);

create table if not exists proj_project_details (
  project_id        uuid primary key references proj_projects(id) on delete cascade,
  client_name       text,
  location          text,
  -- IANA zone of the event / site: installation and show bookings are expressed in it.
  site_timezone     text not null default 'Asia/Dubai',
  install_start     date,
  event_start       date,
  event_end         date,
  scope             text,
  exclusions        text,
  technologies      jsonb not null default '[]'::jsonb check (jsonb_typeof(technologies) = 'array'),
  risks             jsonb not null default '[]'::jsonb check (jsonb_typeof(risks) = 'array'),
  hold_reason       text,
  hold_review_date  date,
  status_before_hold text,
  updated_at        timestamptz not null default now(),
  constraint proj_details_event_dates check (event_end is null or event_start is null or event_end >= event_start)
);

create table if not exists proj_teams (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references proj_projects(id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 80),
  -- Optional pointer to an HR department for display only; never used to authorise anything.
  department_id  uuid references departments(id),
  head_user_id   uuid not null references auth.users(id),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz
);
create unique index if not exists uq_proj_teams_name on proj_teams(project_id, lower(btrim(name))) where removed_at is null;

create table if not exists proj_project_members (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references proj_projects(id) on delete cascade,
  user_id         uuid not null references auth.users(id),
  -- pm / acting_pm are project-level leadership; a department head is a plain member who heads a proj_teams row.
  role            text not null default 'member' check (role in ('pm', 'acting_pm', 'member')),
  team_id         uuid references proj_teams(id),
  acting_until    date,
  added_by        uuid references auth.users(id),
  added_at        timestamptz not null default now(),
  removed_at      timestamptz,
  removed_by      uuid references auth.users(id),
  removal_reason  text,
  constraint proj_members_acting check ((role = 'acting_pm') = (acting_until is not null))
);
create unique index if not exists uq_proj_members_active on proj_project_members(project_id, user_id) where removed_at is null;
create index if not exists idx_proj_members_user on proj_project_members(user_id) where removed_at is null;

create table if not exists proj_sales_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references proj_projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  source      text not null check (source in ('handover_owner', 'handover_preparer', 'added')),
  added_by    uuid references auth.users(id),
  added_at    timestamptz not null default now(),
  removed_at  timestamptz
);
create unique index if not exists uq_proj_sales_links_active on proj_sales_links(project_id, user_id) where removed_at is null;
create index if not exists idx_proj_sales_links_user on proj_sales_links(user_id) where removed_at is null;

-- Handover from Sales: the member-safe delivery brief only. No value, budget, payment terms, PO or evidence reference.
create table if not exists proj_handovers (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references companies(id),
  crm_opportunity_id          uuid not null references crm_opportunities(id),
  crm_reference               text not null,
  status                      text not null default 'draft' check (status in (
                                'draft', 'submitted', 'pm_assigned', 'clarification_requested', 'accepted', 'withdrawn')),
  prepared_by                 uuid not null references auth.users(id),
  sales_owner_id              uuid not null references auth.users(id),
  title                       text not null check (length(btrim(title)) between 1 and 200),
  client_name                 text,
  location                    text,
  site_timezone               text not null default 'Asia/Dubai',
  install_start               date,
  event_start                 date,
  event_end                   date,
  technologies                jsonb not null default '[]'::jsonb check (jsonb_typeof(technologies) = 'array'),
  scope                       text,
  exclusions                  text,
  risks                       jsonb not null default '[]'::jsonb check (jsonb_typeof(risks) = 'array'),
  notes                       text,
  pm_user_id                  uuid references auth.users(id),
  pm_assigned_by              uuid references auth.users(id),
  pm_assigned_at              timestamptz,
  clarification_note          text,
  clarification_requested_at  timestamptz,
  clarification_requested_by  uuid references auth.users(id),
  submitted_at                timestamptz,
  accepted_by                 uuid references auth.users(id),
  accepted_at                 timestamptz,
  project_id                  uuid references proj_projects(id),
  revision                    integer not null default 1,
  version                     integer not null default 1,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint proj_handovers_dates check (event_end is null or event_start is null or event_end >= event_start),
  constraint proj_handovers_accepted check ((status = 'accepted') = (project_id is not null and accepted_at is not null))
);
create unique index if not exists uq_proj_handovers_open on proj_handovers(crm_opportunity_id) where status <> 'withdrawn';
create index if not exists idx_proj_handovers_company_status on proj_handovers(company_id, status);

alter table proj_projects drop constraint if exists proj_projects_handover_fk;
alter table proj_projects add constraint proj_projects_handover_fk foreign key (handover_id) references proj_handovers(id);

create table if not exists proj_milestones (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references proj_projects(id) on delete cascade,
  title          text not null check (length(btrim(title)) between 1 and 200),
  description    text,
  due_date       date,
  -- Only required milestones count toward the stated progress.
  is_required    boolean not null default true,
  -- Whether the milestone may appear on a client timeline once the PM selects it (never automatic).
  client_facing  boolean not null default false,
  status         text not null default 'planned' check (status in (
                   'planned', 'in_progress', 'ready_for_acceptance', 'accepted', 'cancelled', 'deferred')),
  sort_order     integer not null default 0,
  accepted_by    uuid references auth.users(id),
  accepted_at    timestamptz,
  created_by     uuid references auth.users(id),
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint proj_milestones_accepted check ((status = 'accepted') = (accepted_at is not null))
);
create index if not exists idx_proj_milestones_project on proj_milestones(project_id, sort_order, due_date);

create table if not exists proj_deliverables (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references proj_projects(id) on delete cascade,
  milestone_id  uuid references proj_milestones(id),
  team_id       uuid references proj_teams(id),
  title         text not null check (length(btrim(title)) between 1 and 200),
  description   text,
  due_date      date,
  status        text not null default 'open' check (status in (
                  'open', 'in_progress', 'ready_for_review', 'accepted', 'cancelled', 'deferred')),
  accepted_by   uuid references auth.users(id),
  accepted_at   timestamptz,
  created_by    uuid references auth.users(id),
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint proj_deliverables_accepted check ((status = 'accepted') = (accepted_at is not null))
);
create index if not exists idx_proj_deliverables_project on proj_deliverables(project_id, due_date);

create table if not exists proj_tasks (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references proj_projects(id) on delete cascade,
  deliverable_id     uuid references proj_deliverables(id),
  milestone_id       uuid references proj_milestones(id),
  team_id            uuid references proj_teams(id),
  title              text not null check (length(btrim(title)) between 1 and 200),
  description        text,
  assignee_id        uuid not null references auth.users(id),
  priority           text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  start_date         date,
  due_date           date,
  status             text not null default 'todo' check (status in (
                       'todo', 'in_progress', 'ready_for_review', 'done', 'cancelled', 'deferred')),
  requires_review    boolean not null default false,
  -- Blocked is a flag beside the status, never a status: it needs a reason and a person or action to unblock.
  blocked_at         timestamptz,
  blocked_reason     text,
  unblock_owner_id   uuid references auth.users(id),
  unblock_action     text,
  completed_at       timestamptz,
  completed_by       uuid references auth.users(id),
  created_by         uuid not null references auth.users(id),
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint proj_tasks_dates check (due_date is null or start_date is null or due_date >= start_date),
  constraint proj_tasks_blocked check (
    blocked_at is null or (length(btrim(coalesce(blocked_reason, ''))) > 0
                           and (unblock_owner_id is not null or length(btrim(coalesce(unblock_action, ''))) > 0))),
  constraint proj_tasks_done check ((status = 'done') = (completed_at is not null))
);
create index if not exists idx_proj_tasks_project on proj_tasks(project_id, status);
create index if not exists idx_proj_tasks_assignee on proj_tasks(assignee_id, due_date) where status in ('todo', 'in_progress', 'ready_for_review');
create index if not exists idx_proj_tasks_deliverable on proj_tasks(deliverable_id);

create table if not exists proj_task_collaborators (
  task_id     uuid not null references proj_tasks(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  project_id  uuid not null references proj_projects(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table if not exists proj_task_dependencies (
  task_id             uuid not null references proj_tasks(id) on delete cascade,
  depends_on_task_id  uuid not null references proj_tasks(id) on delete cascade,
  project_id          uuid not null references proj_projects(id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  constraint proj_task_deps_not_self check (task_id <> depends_on_task_id)
);

-- Append-only task history: reassignment, date changes, status, blockers, reviews.
create table if not exists proj_task_events (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references proj_tasks(id) on delete cascade,
  project_id  uuid not null references proj_projects(id) on delete cascade,
  actor_id    uuid,
  kind        text not null,
  from_value  text,
  to_value    text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_proj_task_events_task on proj_task_events(task_id, created_at);

create table if not exists proj_task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references proj_tasks(id) on delete cascade,
  project_id  uuid not null references proj_projects(id) on delete cascade,
  author_id   uuid not null references auth.users(id),
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index if not exists idx_proj_task_comments_task on proj_task_comments(task_id, created_at);

-- Member-readable change history for dates, ownership and status of projects, milestones and deliverables
-- (tasks keep theirs in proj_task_events). Complements the restricted audit log; never edited or deleted.
create table if not exists proj_change_log (
  id           bigint generated always as identity primary key,
  project_id   uuid not null references proj_projects(id) on delete cascade,
  entity_type  text not null check (entity_type in ('project', 'milestone', 'deliverable', 'plan_item', 'booking', 'member', 'message', 'external_dependency')),
  entity_id    uuid not null,
  field        text not null,
  from_value   text,
  to_value     text,
  note         text,
  actor_id     uuid,
  created_at   timestamptz not null default now()
);
create index if not exists idx_proj_change_log_entity on proj_change_log(project_id, entity_type, entity_id, created_at);

-- -----------------------------------------------------------------------------
-- Timestamps, a valid IANA zone, optimistic-lock versions
-- -----------------------------------------------------------------------------
create or replace function proj_valid_timezone(p_tz text)
returns boolean
language sql stable
as $$ select p_tz is not null and exists (select 1 from pg_timezone_names where name = p_tz); $$;

alter table proj_project_details drop constraint if exists proj_details_tz;
alter table proj_project_details add constraint proj_details_tz check (proj_valid_timezone(site_timezone));
alter table proj_handovers drop constraint if exists proj_handovers_tz;
alter table proj_handovers add constraint proj_handovers_tz check (proj_valid_timezone(site_timezone));

do $$
declare t text;
begin
  foreach t in array array['proj_projects', 'proj_project_details', 'proj_handovers', 'proj_milestones', 'proj_deliverables', 'proj_tasks'] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;

-- An accepted handover is the historical snapshot of what was agreed: it never changes again.
create or replace function proj_handover_frozen()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'accepted' then
    raise exception 'An accepted handover is a historical record and cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists proj_handovers_frozen on proj_handovers;
create trigger proj_handovers_frozen before update on proj_handovers
  for each row execute function proj_handover_frozen();

-- -----------------------------------------------------------------------------
-- Visibility helpers (SECURITY DEFINER stable; they read the tables as the owner, so the policies below never recurse).
-- Every one evaluates ACTIVE membership at read time: revoking a member removes access immediately and consistently.
-- -----------------------------------------------------------------------------
-- Eligible to hold a role in a project of this company: an active Projects grant, or (for a project's own Sales link)
-- an active Sales grant. Nothing is inferred from HR roles, e-mail domain or employment.
create or replace function proj_user_eligible(p_company_id uuid, p_user_id uuid, p_project_id uuid default null)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from profiles p where p.id = p_user_id and p.is_active)
     and (
       exists (select 1 from proj_company_grants g where g.user_id = p_user_id and g.company_id = p_company_id and g.revoked_at is null)
       or (p_project_id is not null
           and exists (select 1 from proj_sales_links l where l.project_id = p_project_id and l.user_id = p_user_id and l.removed_at is null)
           and exists (select 1 from crm_company_grants c where c.user_id = p_user_id and c.company_id = p_company_id and c.revoked_at is null))
     );
$$;

create or replace function proj_project_company(p_project_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$ select company_id from proj_projects where id = p_project_id; $$;

create or replace function proj_is_active_member(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  -- An active membership counts only while the person is still eligible: revoking their Projects access (or Sales access,
  -- for a Sales participant) ends their project access at once, without having to touch each membership.
  select exists (
    select 1 from proj_project_members m
    join proj_projects pr on pr.id = m.project_id
    where m.project_id = p_project_id and m.user_id = auth.uid() and m.removed_at is null
      and proj_user_eligible(pr.company_id, m.user_id, pr.id));
$$;

-- The accountable PM, or someone holding temporary project leadership that has not expired.
create or replace function proj_is_pm(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_projects pr
    where pr.id = p_project_id and proj_user_eligible(pr.company_id, auth.uid(), pr.id)
      and (pr.pm_user_id = auth.uid()
           or exists (select 1 from proj_project_members m
                       where m.project_id = pr.id and m.user_id = auth.uid() and m.removed_at is null
                         and m.role = 'acting_pm' and m.acting_until >= current_date)));
$$;

create or replace function proj_is_team_head(p_team_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_teams t
    join profiles p on p.id = t.head_user_id and p.is_active
    where t.id = p_team_id and t.head_user_id = auth.uid() and t.removed_at is null
      and proj_is_active_member(t.project_id));
$$;

create or replace function proj_is_any_team_head(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_teams t
    where t.project_id = p_project_id and t.head_user_id = auth.uid() and t.removed_at is null
      and proj_is_active_member(t.project_id));
$$;

create or replace function proj_sales_linked(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_sales_links l
    join proj_projects pr on pr.id = l.project_id
    where l.project_id = p_project_id and l.user_id = auth.uid() and l.removed_at is null
      and crm_has_access(pr.company_id));
$$;

-- Founder of the project's company, or an active member (the PM is always a member).
create or replace function proj_can_view_details(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_projects pr
    where pr.id = p_project_id and (proj_is_founder(pr.company_id) or proj_is_active_member(pr.id)));
$$;

-- PM / acting PM / founder: scope, members, teams, milestones, delivery.
create or replace function proj_can_manage(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_projects pr
    where pr.id = p_project_id and (proj_is_founder(pr.company_id) or proj_is_pm(pr.id)));
$$;

-- Summary row: founders, members, Projects-access holders (ongoing projects only) and linked Sales users.
create or replace function proj_can_view_summary(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from proj_projects pr
    where pr.id = p_project_id
      and (proj_is_founder(pr.company_id)
           or proj_is_active_member(pr.id)
           or (proj_has_access(pr.company_id) and pr.status in ('planning', 'in_progress', 'ready_for_installation', 'on_site', 'on_hold'))
           or proj_sales_linked(pr.id)));
$$;

-- -----------------------------------------------------------------------------
-- Row-level security: SELECT only.
-- -----------------------------------------------------------------------------
alter table proj_projects enable row level security;
drop policy if exists proj_projects_select on proj_projects;
create policy proj_projects_select on proj_projects for select using (proj_can_view_summary(id));

alter table proj_sales_links enable row level security;
drop policy if exists proj_sales_links_select on proj_sales_links;
create policy proj_sales_links_select on proj_sales_links for select
  using (proj_can_view_details(project_id) or (user_id = auth.uid() and removed_at is null));

alter table proj_handovers enable row level security;
drop policy if exists proj_handovers_select on proj_handovers;
create policy proj_handovers_select on proj_handovers for select
  using (
    proj_is_founder(company_id)
    or proj_has_capability(company_id, 'assign_pm')
    or ((prepared_by = auth.uid() or sales_owner_id = auth.uid()) and crm_has_access(company_id))
    or (pm_user_id = auth.uid() and status in ('pm_assigned', 'clarification_requested', 'accepted'))
    or (project_id is not null and proj_can_view_details(project_id))
  );

do $$
declare t text;
begin
  foreach t in array array[
    'proj_project_details', 'proj_teams', 'proj_project_members', 'proj_milestones', 'proj_deliverables', 'proj_tasks',
    'proj_task_collaborators', 'proj_task_dependencies', 'proj_task_events', 'proj_task_comments', 'proj_change_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (proj_can_view_details(project_id))', t || '_select', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Audit triggers on every table whose rows carry decisions (membership, ownership, dates, status, scope, completion).
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'proj_projects', 'proj_project_details', 'proj_teams', 'proj_project_members', 'proj_sales_links', 'proj_handovers',
    'proj_milestones', 'proj_deliverables', 'proj_tasks'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function proj_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Privileges: clients can only SELECT (through RLS); no DML, no TRUNCATE; sequences closed.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'proj_projects', 'proj_project_details', 'proj_teams', 'proj_project_members', 'proj_sales_links', 'proj_handovers',
    'proj_milestones', 'proj_deliverables', 'proj_tasks', 'proj_task_collaborators', 'proj_task_dependencies',
    'proj_task_events', 'proj_task_comments', 'proj_change_log'
  ] loop
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant select on table %I to authenticated', t);
  end loop;
end $$;
revoke all on sequence proj_task_events_id_seq, proj_change_log_id_seq from public, anon, authenticated;

revoke all on function
  proj_valid_timezone(text), proj_handover_frozen(), proj_user_eligible(uuid, uuid, uuid),
  proj_project_company(uuid), proj_is_active_member(uuid), proj_is_pm(uuid), proj_is_team_head(uuid), proj_is_any_team_head(uuid),
  proj_sales_linked(uuid), proj_can_view_details(uuid), proj_can_manage(uuid), proj_can_view_summary(uuid)
  from public, anon, authenticated;
grant execute on function
  proj_valid_timezone(text), proj_user_eligible(uuid, uuid, uuid),
  proj_project_company(uuid), proj_is_active_member(uuid), proj_is_pm(uuid), proj_is_team_head(uuid), proj_is_any_team_head(uuid),
  proj_sales_linked(uuid), proj_can_view_details(uuid), proj_can_manage(uuid), proj_can_view_summary(uuid)
  to authenticated;
