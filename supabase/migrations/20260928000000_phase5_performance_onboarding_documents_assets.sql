-- =============================================================================
-- Phase 5 — Performance/appraisals, onboarding/offboarding checklists,
-- employee documents with expiry reminders, assets.
--
-- Scope per docs/06-implementation-phases.md. Two genuinely new pieces of
-- business logic get established here, the same way Phase 2 established
-- leave/notice/probation payload shapes and Phase 4 established
-- overtime_rules: an `end_of_service_benefit` policy payload shape (used by
-- computeFinalSettlement() in packages/domain) and a lead-day-based
-- document expiry reminder sweep.
--
-- This phase is schema + RLS + domain-logic + tests. UI is intentionally
-- deferred beyond a "My Documents" section on the employee page (mirroring
-- Phase 1's identity-documents pattern) — appraisal authoring, checklist
-- management, and asset tracking UI are real, tested, and reachable via
-- direct Supabase access today; a UI pass for them is a fast-follow, not
-- something this phase's own exit criteria (docs/06) calls for.
-- =============================================================================

create type document_status as enum ('valid', 'expiring_soon', 'expired');
create type asset_status as enum ('in_stock', 'issued', 'under_repair', 'retired');

-- -----------------------------------------------------------------------------
-- Performance
-- -----------------------------------------------------------------------------

create table performance_cycles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  name          text not null,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'open' check (status in ('open', 'closed')),
  check (period_end >= period_start)
);

create table goals (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  cycle_id      uuid not null references performance_cycles(id),
  title         text not null,
  description   text,
  weight_percent numeric(5,2) check (weight_percent between 0 and 100),
  target_date   date,
  status        text not null default 'in_progress' check (status in ('in_progress', 'achieved', 'missed')),
  self_rating   int check (self_rating between 1 and 5),
  manager_rating int check (manager_rating between 1 and 5),
  created_at    timestamptz not null default now()
);

create index idx_goals_employee on goals(employee_id);

-- Sensitive tier 3: appraisal content — separate RLS from base employee
-- record and from goals; Finance never gets a select policy on this table
-- at all (docs/03-permission-matrix.md §3.7).
create table appraisals (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id),
  cycle_id       uuid not null references performance_cycles(id),
  appraiser_id   uuid not null references auth.users(id),
  overall_rating int check (overall_rating between 1 and 5),
  strengths      text,
  areas_for_improvement text,
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'acknowledged')),
  submitted_at   timestamptz,
  acknowledged_at timestamptz,
  created_at     timestamptz not null default now()
);

create index idx_appraisals_employee on appraisals(employee_id);

-- Employees may only acknowledge (status -> 'acknowledged', set
-- acknowledged_at) — never edit rating/content, even though RLS lets them
-- update their own submitted appraisal row for that one transition. Same
-- column-guard-trigger pattern as guard_employee_self_update() (Phase 1).
create or replace function guard_appraisal_acknowledge()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- trusted backend/migration/seed context
  end if;
  if auth.uid() = (select user_id from employees where id = old.employee_id) then
    if new.overall_rating is distinct from old.overall_rating
      or new.strengths is distinct from old.strengths
      or new.areas_for_improvement is distinct from old.areas_for_improvement
      or new.cycle_id is distinct from old.cycle_id
      or new.appraiser_id is distinct from old.appraiser_id
      or new.submitted_at is distinct from old.submitted_at
    then
      raise exception 'An employee may only acknowledge their appraisal, not edit its content';
    end if;
  end if;
  return new;
end;
$$;

create trigger appraisals_guard_self_update
  before update on appraisals
  for each row execute function guard_appraisal_acknowledge();

-- -----------------------------------------------------------------------------
-- Onboarding / offboarding
-- -----------------------------------------------------------------------------

create table checklist_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id),
  country_code  text references countries(code),
  kind          text not null check (kind in ('onboarding', 'offboarding')),
  name          text not null,
  is_active     boolean not null default true,
  check (company_id is not null or country_code is not null)
);

create table checklist_template_items (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references checklist_templates(id),
  step_order    int not null,
  task_name     text not null,
  assignee_role app_role not null,
  due_offset_days int not null default 0,    -- days from hire_date / termination_date
  unique (template_id, step_order)
);

create table employee_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id),
  template_item_id uuid not null references checklist_template_items(id),
  kind            text not null check (kind in ('onboarding', 'offboarding')),
  due_date        date,
  status          text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'skipped')),
  completed_by    uuid,
  completed_at    timestamptz
);

create index idx_employee_checklist_items_employee on employee_checklist_items(employee_id);

-- Generates the per-employee checklist from a template in one shot — the
-- "system generates employee_checklist_items rows with due_date = anchor +
-- due_offset_days" step from docs/04-user-journeys.md §4.3/§4.4. Runs under
-- the caller's own RLS (HR Admin's existing full-write grant on this table
-- covers every row it inserts, whatever assignee_role each one carries) —
-- no SECURITY DEFINER needed, unlike the approval engine's auto-provisioning.
create or replace function generate_checklist_items(p_employee_id uuid, p_template_id uuid, p_anchor_date date)
returns setof employee_checklist_items
language sql
as $$
  insert into employee_checklist_items (employee_id, template_item_id, kind, due_date)
  select p_employee_id, cti.id, ct.kind, p_anchor_date + cti.due_offset_days
  from checklist_template_items cti
  join checklist_templates ct on ct.id = cti.template_id
  where cti.template_id = p_template_id
  order by cti.step_order
  returning *;
$$;

-- -----------------------------------------------------------------------------
-- Employee documents, expiry reminders
-- -----------------------------------------------------------------------------

create table employee_documents (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  document_type text not null,   -- 'visa'|'labor_card'|'certificate'|'other'
  file_path     text not null,   -- storage path in `employee-documents`
  expiry_date   date,
  status        document_status not null default 'valid',
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index idx_employee_documents_employee on employee_documents(employee_id);

create table document_expiry_reminder_rules (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id),
  country_code  text references countries(code),
  document_type text not null,
  lead_days     int not null check (lead_days > 0),
  check (company_id is not null or country_code is not null)
);

create table document_expiry_reminders_sent (
  id            uuid primary key default gen_random_uuid(),
  employee_document_id uuid not null references employee_documents(id),
  lead_days     int not null,
  sent_at       timestamptz not null default now(),
  unique (employee_document_id, lead_days)
);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index idx_notifications_user on notifications(user_id, read_at);

-- -----------------------------------------------------------------------------
-- Assets
-- -----------------------------------------------------------------------------

create table assets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  asset_tag     text not null,
  category      text not null,
  description   text,
  purchase_date date,
  value         numeric(12,2),
  status        asset_status not null default 'in_stock',
  deleted_at    timestamptz,
  unique (company_id, asset_tag)
);

create table asset_assignments (
  id                  uuid primary key default gen_random_uuid(),
  asset_id            uuid not null references assets(id),
  employee_id         uuid not null references employees(id),
  issued_date         date not null default current_date,
  returned_date       date,
  condition_on_issue  text,
  condition_on_return text,
  issued_by           uuid not null
);

create index idx_asset_assignments_employee on asset_assignments(employee_id);
create index idx_asset_assignments_asset on asset_assignments(asset_id);

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table performance_cycles enable row level security;
alter table goals enable row level security;
alter table appraisals enable row level security;
alter table checklist_templates enable row level security;
alter table checklist_template_items enable row level security;
alter table employee_checklist_items enable row level security;
alter table employee_documents enable row level security;
alter table document_expiry_reminder_rules enable row level security;
alter table document_expiry_reminders_sent enable row level security;
alter table notifications enable row level security;
alter table assets enable row level security;
alter table asset_assignments enable row level security;

-- ---- performance_cycles: any signed-in user reads (needed to see which
--      cycle their own goals/appraisal belong to), HR Admin manages.
create policy performance_cycles_select on performance_cycles for select
  using (auth.role() = 'authenticated');

create policy performance_cycles_write on performance_cycles for all
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));

-- ---- goals: employee owns their own (including self_rating), manager
--      chain and HR Admin can read/set manager_rating. Manager/HR Admin
--      writes are full-row for simplicity — goals are low-sensitivity
--      (not one of the four tiers in docs/02-database-schema.md §2.3),
--      unlike appraisals below which get a real column guard.
create policy goals_select on goals for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy goals_write_self on goals for all
  using (employee_id = current_employee_id())
  with check (employee_id = current_employee_id());

create policy goals_write_manager on goals for update
  using (is_manager_of(employee_id) or has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (is_manager_of(employee_id) or has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- appraisals: appraiser (own-written) + HR Admin (any, calibration)
--      write; employee sees/acknowledges only once submitted. Finance and
--      CEO get no policy here at all — absence is the enforcement.
create policy appraisals_select on appraisals for select
  using (
    (employee_id = current_employee_id() and status in ('submitted', 'acknowledged'))
    or appraiser_id = auth.uid()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
  );

create policy appraisals_insert on appraisals for insert
  with check (
    appraiser_id = auth.uid()
    and (is_manager_of(employee_id) or has_role('hr_admin', (select company_id from employees where id = employee_id)))
  );

create policy appraisals_update_appraiser on appraisals for update
  using (appraiser_id = auth.uid() and status = 'draft')
  with check (appraiser_id = auth.uid() and status in ('draft', 'submitted'));

create policy appraisals_update_hr on appraisals for update
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create policy appraisals_update_acknowledge on appraisals for update
  using (employee_id = current_employee_id() and status = 'submitted')
  with check (employee_id = current_employee_id() and status = 'acknowledged');

-- ---- checklist templates: readable by anyone signed in (transparency on
--      what onboarding/offboarding involves), HR Admin manages.
create policy checklist_templates_select on checklist_templates for select
  using (auth.role() = 'authenticated');

create policy checklist_templates_write on checklist_templates for all
  using (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  )
  with check (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  );

create policy checklist_template_items_select on checklist_template_items for select
  using (auth.role() = 'authenticated');

create policy checklist_template_items_write on checklist_template_items for all
  using (exists (
    select 1 from checklist_templates ct where ct.id = template_id and (
      (ct.company_id is not null and has_role('hr_admin', ct.company_id))
      or (ct.country_code is not null and has_role('hr_admin', null, ct.country_code))
    )
  ))
  with check (exists (
    select 1 from checklist_templates ct where ct.id = template_id and (
      (ct.company_id is not null and has_role('hr_admin', ct.company_id))
      or (ct.country_code is not null and has_role('hr_admin', null, ct.country_code))
    )
  ));

-- ---- employee_checklist_items: the employee sees their own progress;
--      whoever holds the item's assignee_role for that employee (their own
--      manager if assignee_role='line_manager', any finance/sys_admin
--      holder in-company otherwise) can see and complete it; HR Admin sees
--      and manages everything.
create policy employee_checklist_items_select on employee_checklist_items for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'line_manager')
      and is_manager_of(employee_id)
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'finance')
      and has_role('finance', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'sys_admin')
      and has_role('sys_admin')
    )
  );

create policy employee_checklist_items_write_hr on employee_checklist_items for all
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- Everyone else who can SEE an assigned item (per the select policy above)
-- may update its status/completion — WITH CHECK intentionally omitted so it
-- defaults to re-evaluating this same USING expression against the new
-- row, which blocks reassigning template_item_id/employee_id to something
-- the caller couldn't otherwise see.
create policy employee_checklist_items_complete on employee_checklist_items for update
  using (
    employee_id = current_employee_id()
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'line_manager')
      and is_manager_of(employee_id)
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'finance')
      and has_role('finance', (select company_id from employees where id = employee_id))
    )
    or (
      exists (select 1 from checklist_template_items cti where cti.id = template_item_id and cti.assignee_role = 'sys_admin')
      and has_role('sys_admin')
    )
  );

-- ---- employee_documents: employee (own, upload/view), HR Admin (all in
--      company, including soft-deleted for recovery — same pattern as
--      employees_select in Phase 1).
create policy employee_documents_table_select on employee_documents for select
  using (
    has_role('hr_admin', (select company_id from employees where id = employee_id))
    or (deleted_at is null and employee_id = current_employee_id())
  );

create policy employee_documents_table_insert on employee_documents for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

create policy employee_documents_table_update on employee_documents for update
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- ---- document_expiry_reminder_rules: HR Admin configures; Sys Admin
--      read-only; nobody else (docs/03-permission-matrix.md §3.5 — this
--      row is explicitly HR Admin F / Sys Admin R / everyone else "–").
create policy document_expiry_rules_select on document_expiry_reminder_rules for select
  using (
    has_role('sys_admin')
    or (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  );

create policy document_expiry_rules_write on document_expiry_reminder_rules for all
  using (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  )
  with check (
    (company_id is not null and has_role('hr_admin', company_id))
    or (country_code is not null and has_role('hr_admin', null, country_code))
  );

-- ---- document_expiry_reminders_sent: HR Admin reads (audit trail of what
--      fired); only the scheduled job (service-role, bypasses RLS) writes.
create policy document_expiry_reminders_sent_select on document_expiry_reminders_sent for select
  using (exists (
    select 1 from employee_documents ed
    join employees e on e.id = ed.employee_id
    where ed.id = employee_document_id and has_role('hr_admin', e.company_id)
  ));

-- ---- notifications: strictly own — nobody else, not even HR Admin, reads
--      another person's notification feed. Only the recipient can mark
--      their own read; only trusted backend jobs (service-role) insert.
create policy notifications_select on notifications for select
  using (user_id = auth.uid());

create policy notifications_update_own on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- assets: the general inventory/register is HR Admin (full) + Finance
--      (read) only — an employee or manager doesn't browse the whole
--      company's unassigned stock. An employee/manager can still see the
--      specific asset row(s) actually issued to them/their team, via
--      asset_assignments, so "what is this asset issued to me" resolves.
create policy assets_select on assets for select
  using (
    deleted_at is null
    and (
      has_role('hr_admin', company_id)
      or has_role('finance', company_id)
      or exists (
        select 1 from asset_assignments aa
        where aa.asset_id = assets.id
          and (aa.employee_id = current_employee_id() or is_manager_of(aa.employee_id))
      )
    )
  );

create policy assets_write on assets for all
  using (has_role('hr_admin', company_id))
  with check (has_role('hr_admin', company_id));

create policy asset_assignments_select on asset_assignments for select
  using (
    employee_id = current_employee_id()
    or is_manager_of(employee_id)
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy asset_assignments_write on asset_assignments for all
  using (has_role('hr_admin', (select company_id from employees where id = employee_id)))
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));
