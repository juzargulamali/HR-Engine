-- Project Budget & Expenses, migration 2 of 5: core tables, immutability guards and row-level security.
--
-- Everything here is READ-ONLY to clients (SELECT policies only, no INSERT/UPDATE/DELETE policies, no DML grants). Changes go through
-- the SECURITY DEFINER functions of migrations 3 and 4, which enforce the role, independence and state rules.
--
-- Who can read (all enforced here, not by hiding buttons):
--   * Finance, 'view' and CEO-CTO approver grantees of the budget's owning company (pbx_can_view_company);
--   * the CURRENT Project Manager or unexpired acting PM of the project (proj_is_pm);
--   * a PRIOR submitter (a former PM) only the versions and submissions they created or submitted.
-- Nobody gains access from project membership, the project directory, a Sales link, an HR role, a founder title or sys_admin.
--
-- Money: numeric(16,3) rounded to the budget currency's own decimals by pbx_round(); one currency per budget; no exchange rates.
-- Names of the project, PM and people are copied (snapshots) so Finance can work without any Projects access.

-- -----------------------------------------------------------------------------
-- One budget record per project
-- -----------------------------------------------------------------------------
create table if not exists pbx_budgets (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references proj_projects(id),
  company_id                uuid not null references companies(id),
  currency                  text not null check (currency ~ '^[A-Z]{3}$'),
  -- Display snapshot, refreshed whenever a budget or the final expenses are submitted.
  project_reference         text not null,
  project_name              text not null,
  pm_user_id                uuid,
  pm_name                   text,
  location                  text,
  site_timezone             text,
  project_start             date,
  project_end               date,
  install_start             date,
  event_start               date,
  event_end                 date,
  -- Receipts and settlement (financial settlement is separate from project completion).
  receipts_status           text not null default 'not_received' check (receipts_status in ('not_received', 'partial', 'received', 'exception')),
  receipts_received_on      date,
  receipts_exception_reason text,
  receipts_recorded_by      uuid references auth.users(id),
  receipts_recorded_at      timestamptz,
  settlement_status         text not null default 'open' check (settlement_status in ('open', 'closed')),
  settlement_closed_at      timestamptz,
  settlement_closed_by      uuid references auth.users(id),
  settlement_note           text,
  row_version               integer not null default 1,
  created_by                uuid not null references auth.users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint pbx_budgets_one_per_project unique (project_id),
  constraint pbx_budgets_exception_reason check (receipts_status <> 'exception' or length(btrim(coalesce(receipts_exception_reason, ''))) > 0),
  constraint pbx_budgets_closed_consistent check ((settlement_status = 'closed') = (settlement_closed_at is not null))
);
create index if not exists idx_pbx_budgets_company on pbx_budgets(company_id, settlement_status);

-- -----------------------------------------------------------------------------
-- Budget versions: the original request and each additional request. A submission is a stable version; changes after a return
-- are a new draft (a revision) that points at the one it revises.
-- -----------------------------------------------------------------------------
create table if not exists pbx_budget_versions (
  id                uuid primary key default gen_random_uuid(),
  budget_id         uuid not null references pbx_budgets(id),
  company_id        uuid not null references companies(id),
  project_id        uuid not null references proj_projects(id),
  kind              text not null check (kind in ('original', 'addition')),
  seq               integer not null check (seq >= 1),
  status            text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'rejected', 'approved', 'discarded')),
  parent_version_id uuid references pbx_budget_versions(id),
  period_start      date,
  period_end        date,
  people            uuid[] not null default '{}'::uuid[],
  note              text,
  total             numeric(16,3) not null default 0 check (total >= 0),
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  submitted_by      uuid references auth.users(id),
  submitted_at      timestamptz,
  submit_request_id uuid,
  approval_route    text not null default 'finance' check (approval_route in ('finance', 'executive')),   -- fixed at submission: who may decide it (see pbx_approval_route)
  decided_by        uuid references auth.users(id),
  decided_at        timestamptz,
  decision_note     text,
  row_version       integer not null default 1,
  updated_at        timestamptz not null default now(),
  constraint pbx_versions_seq unique (budget_id, seq),
  constraint pbx_versions_period check (period_end is null or period_start is null or period_end >= period_start),
  constraint pbx_versions_decision_note check (status not in ('returned', 'rejected') or length(btrim(coalesce(decision_note, ''))) > 0),
  constraint pbx_versions_decided check ((status in ('approved', 'returned', 'rejected')) = (decided_at is not null))
);
-- At most one open (draft or submitted) version per budget, and at most one approved original.
create unique index if not exists uq_pbx_open_version on pbx_budget_versions(budget_id) where status in ('draft', 'submitted');
create unique index if not exists uq_pbx_approved_original on pbx_budget_versions(budget_id) where kind = 'original' and status = 'approved';
create unique index if not exists uq_pbx_submit_request on pbx_budget_versions(budget_id, submit_request_id) where submit_request_id is not null;
create index if not exists idx_pbx_versions_company_status on pbx_budget_versions(company_id, status);

create table if not exists pbx_budget_rows (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references pbx_budget_versions(id) on delete cascade,
  budget_id       uuid not null references pbx_budgets(id),
  company_id      uuid not null references companies(id),
  sort_no         integer not null default 0,
  category_id     uuid not null references pbx_categories(id),
  category_key    text not null,
  category_label  text not null,
  date_from       date,
  date_to         date,
  activity        text not null default 'other' check (activity in ('setup', 'show', 'dismantling', 'other')),
  description     text not null check (length(btrim(description)) between 1 and 300),
  basis           text not null check (basis in ('fixed', 'per_person', 'per_person_day', 'per_trip', 'per_km', 'qty_rate')),
  people          numeric(12,3) check (people is null or people >= 0),
  days            numeric(12,3) check (days is null or days >= 0),
  qty             numeric(12,3) check (qty is null or qty >= 0),
  rate            numeric(14,4) check (rate is null or rate >= 0),
  fixed           numeric(16,3) check (fixed is null or fixed >= 0),
  -- A company rate this row was based on (petrol per km, meal per person), and what Finance had configured when it was saved.
  rate_key        text check (rate_key is null or rate_key in ('petrol_per_km', 'meal_per_person')),
  configured_rate numeric(14,4),
  -- Calculated by the trigger below, never taken from the client.
  total           numeric(16,3) not null default 0 check (total >= 0),
  constraint pbx_rows_dates check (date_to is null or date_from is null or date_to >= date_from),
  constraint pbx_rows_rate_key_basis check (rate_key is null
    or (rate_key = 'petrol_per_km' and basis = 'per_km')
    or (rate_key = 'meal_per_person' and basis in ('per_person', 'per_person_day')))
);
create index if not exists idx_pbx_rows_version on pbx_budget_rows(version_id, sort_no);

-- -----------------------------------------------------------------------------
-- Funding: instalments Finance provides (separate entries, several recipients). Reversals are audited, never deletes.
-- -----------------------------------------------------------------------------
create table if not exists pbx_funding (
  id                uuid primary key default gen_random_uuid(),
  budget_id         uuid not null references pbx_budgets(id),
  company_id        uuid not null references companies(id),
  project_id        uuid not null references proj_projects(id),
  recipient_user_id uuid not null references auth.users(id),
  recipient_name    text not null,
  funded_on         date not null,
  amount            numeric(16,3) not null check (amount > 0),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  method            text not null check (method in ('cash', 'bank_transfer', 'pluto', 'other')),
  -- Cash and bank advances are held by a person and owed back if unspent; a Pluto allocation or card limit never is.
  is_advance        boolean not null,
  reference         text,
  note              text,
  status            text not null default 'recorded' check (status in ('recorded', 'reversed')),
  reversed_by       uuid references auth.users(id),
  reversed_at       timestamptz,
  reversal_reason   text,
  recorded_by       uuid not null references auth.users(id),
  recorded_at       timestamptz not null default now(),
  request_id        uuid not null,
  constraint pbx_funding_request unique (budget_id, request_id),
  constraint pbx_funding_advance_rule check (
    (method in ('cash', 'bank_transfer') and is_advance) or (method = 'pluto' and not is_advance) or method = 'other'),
  constraint pbx_funding_reversal check ((status = 'reversed') = (reversed_at is not null)
    and (status <> 'reversed' or length(btrim(coalesce(reversal_reason, ''))) > 0))
);
create index if not exists idx_pbx_funding_budget on pbx_funding(budget_id);

-- -----------------------------------------------------------------------------
-- Actual expenses: the PM's own totals (never copied from estimates). A blank amount (null) is "not entered"; zero is a confirmed zero.
-- -----------------------------------------------------------------------------
create table if not exists pbx_actual_submissions (
  id                    uuid primary key default gen_random_uuid(),
  budget_id             uuid not null references pbx_budgets(id),
  company_id            uuid not null references companies(id),
  project_id            uuid not null references proj_projects(id),
  seq                   integer not null check (seq >= 1),
  status                text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'approved')),
  parent_submission_id  uuid references pbx_actual_submissions(id),
  complete_confirmed    boolean not null default false,
  variance_note         text,
  total_actual          numeric(16,3) not null default 0,
  total_approved_budget numeric(16,3) not null default 0,
  reopened_after_approval boolean not null default false,
  created_by            uuid not null references auth.users(id),
  created_at            timestamptz not null default now(),
  submitted_by          uuid references auth.users(id),
  submitted_at          timestamptz,
  submit_request_id     uuid,
  approval_route        text not null default 'finance' check (approval_route in ('finance', 'executive')),
  decided_by            uuid references auth.users(id),
  decided_at            timestamptz,
  decision_note         text,
  row_version           integer not null default 1,
  updated_at            timestamptz not null default now(),
  constraint pbx_actuals_seq unique (budget_id, seq),
  constraint pbx_actuals_decided check ((status in ('approved', 'returned')) = (decided_at is not null)),
  constraint pbx_actuals_return_note check (status <> 'returned' or length(btrim(coalesce(decision_note, ''))) > 0)
);
create unique index if not exists uq_pbx_open_actuals on pbx_actual_submissions(budget_id) where status in ('draft', 'submitted');
create unique index if not exists uq_pbx_approved_actuals on pbx_actual_submissions(budget_id) where status = 'approved';
create unique index if not exists uq_pbx_actuals_submit_request on pbx_actual_submissions(budget_id, submit_request_id) where submit_request_id is not null;
create index if not exists idx_pbx_actuals_company_status on pbx_actual_submissions(company_id, status);

create table if not exists pbx_actual_rows (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null references pbx_actual_submissions(id) on delete cascade,
  budget_id        uuid not null references pbx_budgets(id),
  company_id       uuid not null references companies(id),
  sort_no          integer not null default 0,
  -- The approved budget row this line belongs to (null for an unplanned expense). A budget row may have several lines (split by how it was paid).
  budget_row_id    uuid references pbx_budget_rows(id),
  line_no          integer not null default 1,
  category_key     text not null,
  category_label   text not null,
  description      text not null check (length(btrim(description)) between 1 and 300),
  approved_amount  numeric(16,3) not null default 0 check (approved_amount >= 0),
  actual_amount    numeric(16,3) check (actual_amount is null or actual_amount >= 0),
  paid_via         text check (paid_via is null or paid_via in ('advance', 'company_card', 'direct_company', 'personal', 'existing_claim')),
  paid_by_user_id  uuid references auth.users(id),
  paid_by_name     text,
  -- A cost that is already in an employee claim: linked, never recorded a second time as a reimbursement or advance spend.
  -- Deliberately NOT a foreign key: this module must never block or change anything in the existing claims flow (for example deleting a draft claim).
  claim_id         uuid,
  foreign_currency boolean not null default false,
  foreign_note     text,
  note             text,
  unplanned        boolean not null default false,
  constraint pbx_actual_rows_paid check (actual_amount is null or paid_via is not null or actual_amount = 0),
  constraint pbx_actual_rows_person check (actual_amount is null or actual_amount = 0 or paid_via is null or paid_via not in ('advance', 'personal') or paid_by_user_id is not null),
  constraint pbx_actual_rows_claim check (claim_id is null or paid_via = 'existing_claim'),
  constraint pbx_actual_rows_claim_reference check (paid_via is distinct from 'existing_claim' or claim_id is not null or length(btrim(coalesce(note, ''))) > 0),
  constraint pbx_actual_rows_foreign check (not foreign_currency or length(btrim(coalesce(foreign_note, ''))) > 0),
  constraint pbx_actual_rows_unplanned check (unplanned = (budget_row_id is null))
);
create index if not exists idx_pbx_actual_rows_submission on pbx_actual_rows(submission_id, sort_no);

-- -----------------------------------------------------------------------------
-- Payments: money returned to the company and reimbursements paid (per person; partial amounts supported; reversible).
-- -----------------------------------------------------------------------------
create table if not exists pbx_payments (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references pbx_budgets(id),
  company_id       uuid not null references companies(id),
  project_id       uuid not null references proj_projects(id),
  kind             text not null check (kind in ('return', 'reimbursement')),
  person_user_id   uuid not null references auth.users(id),
  person_name      text not null,
  amount           numeric(16,3) not null check (amount > 0),
  paid_on          date not null,
  method           text not null check (method in ('cash', 'bank_transfer', 'pluto', 'other')),
  reference        text,
  note             text,
  status           text not null default 'recorded' check (status in ('recorded', 'reversed')),
  reversed_by      uuid references auth.users(id),
  reversed_at      timestamptz,
  reversal_reason  text,
  recorded_by      uuid not null references auth.users(id),
  recorded_at      timestamptz not null default now(),
  request_id       uuid not null,
  constraint pbx_payments_request unique (budget_id, request_id),
  constraint pbx_payments_reversal check ((status = 'reversed') = (reversed_at is not null)
    and (status <> 'reversed' or length(btrim(coalesce(reversal_reason, ''))) > 0))
);
create index if not exists idx_pbx_payments_budget on pbx_payments(budget_id);

-- -----------------------------------------------------------------------------
-- Read helpers (SECURITY DEFINER stable; the policies below never recurse)
-- -----------------------------------------------------------------------------
create or replace function pbx_budget_company(p_budget_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select company_id from pbx_budgets where id = p_budget_id; $$;

create or replace function pbx_budget_project(p_budget_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select project_id from pbx_budgets where id = p_budget_id; $$;

-- The current PM or unexpired acting PM of the project that owns this budget.
create or replace function pbx_is_budget_pm(p_budget_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from pbx_budgets b where b.id = p_budget_id and proj_is_pm(b.project_id)); $$;

-- May read the budget record and its funding, payments and summary: Finance / view grantee of the company, or the current PM.
create or replace function pbx_can_read_budget(p_budget_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from pbx_budgets b
                  where b.id = p_budget_id and (pbx_can_view_company(b.company_id) or proj_is_pm(b.project_id)));
$$;

-- May read this budget's header only (a prior submitter sees the header and their own versions, nothing else).
create or replace function pbx_can_read_budget_header(p_budget_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select pbx_can_read_budget(p_budget_id)
      or exists (select 1 from pbx_budget_versions v where v.budget_id = p_budget_id and (v.created_by = auth.uid() or v.submitted_by = auth.uid()))
      or exists (select 1 from pbx_actual_submissions a where a.budget_id = p_budget_id and (a.created_by = auth.uid() or a.submitted_by = auth.uid()));
$$;

create or replace function pbx_can_read_version(p_version_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from pbx_budget_versions v
                  where v.id = p_version_id and (pbx_can_read_budget(v.budget_id) or v.created_by = auth.uid() or v.submitted_by = auth.uid()));
$$;

create or replace function pbx_can_read_submission(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from pbx_actual_submissions a
                  where a.id = p_submission_id and (pbx_can_read_budget(a.budget_id) or a.created_by = auth.uid() or a.submitted_by = auth.uid()));
$$;

alter table pbx_budgets enable row level security;
alter table pbx_budget_versions enable row level security;
alter table pbx_budget_rows enable row level security;
alter table pbx_funding enable row level security;
alter table pbx_actual_submissions enable row level security;
alter table pbx_actual_rows enable row level security;
alter table pbx_payments enable row level security;

drop policy if exists pbx_budgets_select on pbx_budgets;
create policy pbx_budgets_select on pbx_budgets for select using (pbx_can_read_budget_header(id));
drop policy if exists pbx_versions_select on pbx_budget_versions;
create policy pbx_versions_select on pbx_budget_versions for select using (pbx_can_read_version(id));
drop policy if exists pbx_rows_select on pbx_budget_rows;
create policy pbx_rows_select on pbx_budget_rows for select using (pbx_can_read_version(version_id));
drop policy if exists pbx_funding_select on pbx_funding;
create policy pbx_funding_select on pbx_funding for select using (pbx_can_read_budget(budget_id));
drop policy if exists pbx_actuals_select on pbx_actual_submissions;
create policy pbx_actuals_select on pbx_actual_submissions for select using (pbx_can_read_submission(id));
drop policy if exists pbx_actual_rows_select on pbx_actual_rows;
create policy pbx_actual_rows_select on pbx_actual_rows for select using (pbx_can_read_submission(submission_id));
drop policy if exists pbx_payments_select on pbx_payments;
create policy pbx_payments_select on pbx_payments for select using (pbx_can_read_budget(budget_id));

-- -----------------------------------------------------------------------------
-- Calculation and immutability guards (the database, not the page, keeps history honest)
-- -----------------------------------------------------------------------------
-- A row's total is calculated here from its basis, in decimal arithmetic, rounded once to the budget currency. Fields the basis does not use
-- are cleared, so a "fixed total for the whole period" can never be multiplied by days left over from an earlier choice.
create or replace function pbx_budget_row_calc()
returns trigger
language plpgsql
as $$
declare
  v_currency text;
  v_raw numeric;
begin
  select currency into v_currency from pbx_budgets where id = new.budget_id;
  if v_currency is null then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  if new.basis = 'fixed' then
    if new.fixed is null then raise exception 'Enter the fixed total for "%"', new.description using errcode = '22023'; end if;
    new.people := null; new.days := null; new.qty := null; new.rate := null;
    v_raw := new.fixed;
  elsif new.basis = 'per_person' then
    if new.people is null or new.rate is null then raise exception 'Enter the number of people and the rate for "%"', new.description using errcode = '22023'; end if;
    new.days := null; new.qty := null; new.fixed := null;
    v_raw := new.people * new.rate;
  elsif new.basis = 'per_person_day' then
    if new.people is null or new.days is null or new.rate is null then raise exception 'Enter the number of people, the days and the rate for "%"', new.description using errcode = '22023'; end if;
    new.qty := null; new.fixed := null;
    v_raw := new.people * new.days * new.rate;
  elsif new.basis in ('per_trip', 'per_km', 'qty_rate') then
    if new.qty is null or new.rate is null then raise exception 'Enter the quantity and the rate for "%"', new.description using errcode = '22023'; end if;
    new.people := null; new.days := null; new.fixed := null;
    v_raw := new.qty * new.rate;
  else
    raise exception 'Choose how "%" is calculated', new.description using errcode = '22023';
  end if;
  new.total := pbx_round(v_raw, v_currency);
  return new;
end;
$$;
drop trigger if exists pbx_budget_rows_calc on pbx_budget_rows;
create trigger pbx_budget_rows_calc before insert or update on pbx_budget_rows
  for each row execute function pbx_budget_row_calc();

-- Rows of a version that is no longer a draft can never change.
create or replace function pbx_rows_frozen()
returns trigger
language plpgsql
as $$
declare v_status text; v_id uuid := coalesce(new.version_id, old.version_id);
begin
  select status into v_status from pbx_budget_versions where id = v_id;
  if v_status is distinct from 'draft' then
    raise exception 'A submitted budget version is a historical record and cannot be changed' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists pbx_budget_rows_frozen on pbx_budget_rows;
create trigger pbx_budget_rows_frozen before insert or update or delete on pbx_budget_rows
  for each row execute function pbx_rows_frozen();

-- Version lifecycle: draft -> submitted | discarded; submitted -> approved | returned | rejected; nothing else, ever. Content is frozen once submitted.
create or replace function pbx_version_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Budget versions are never deleted' using errcode = '23514'; end if;
  if new.budget_id is distinct from old.budget_id or new.kind is distinct from old.kind or new.seq is distinct from old.seq
     or new.created_by is distinct from old.created_by or new.company_id is distinct from old.company_id or new.project_id is distinct from old.project_id then
    raise exception 'A budget version''s identity cannot be changed' using errcode = '23514';
  end if;
  if old.status <> 'draft' then
    if new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end or new.people is distinct from old.people
       or new.note is distinct from old.note or new.total is distinct from old.total or new.approval_route is distinct from old.approval_route then
      raise exception 'A submitted budget version is a historical record and cannot be changed' using errcode = '23514';
    end if;
  end if;
  -- Nobody decides their own work, whatever function or tool writes the row.
  if old.status = 'submitted' and new.status is distinct from old.status and new.status in ('approved', 'returned', 'rejected')
     and (new.decided_by is null or new.decided_by = old.created_by or new.decided_by = old.submitted_by) then
    raise exception 'A budget version cannot be decided by the person who prepared or submitted it' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('submitted', 'discarded'))
         or (old.status = 'submitted' and new.status in ('approved', 'returned', 'rejected'))) then
      raise exception 'A budget version cannot move from % to %', old.status, new.status using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists pbx_budget_versions_guard on pbx_budget_versions;
create trigger pbx_budget_versions_guard before update or delete on pbx_budget_versions
  for each row execute function pbx_version_guard();

create or replace function pbx_actual_rows_frozen()
returns trigger
language plpgsql
as $$
declare v_status text; v_id uuid := coalesce(new.submission_id, old.submission_id);
begin
  select status into v_status from pbx_actual_submissions where id = v_id;
  if v_status is distinct from 'draft' then
    raise exception 'Submitted final expenses are a historical record and cannot be changed' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists pbx_actual_rows_frozen on pbx_actual_rows;
create trigger pbx_actual_rows_frozen before insert or update or delete on pbx_actual_rows
  for each row execute function pbx_actual_rows_frozen();

-- Actual submissions: draft -> submitted; submitted -> approved | returned; approved -> returned (Finance sends an approved set back for an audited correction).
create or replace function pbx_actual_submission_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Final expense submissions are never deleted' using errcode = '23514'; end if;
  if new.budget_id is distinct from old.budget_id or new.seq is distinct from old.seq or new.created_by is distinct from old.created_by
     or new.company_id is distinct from old.company_id or new.project_id is distinct from old.project_id then
    raise exception 'A final expense submission''s identity cannot be changed' using errcode = '23514';
  end if;
  if old.status <> 'draft' then
    if new.complete_confirmed is distinct from old.complete_confirmed or new.variance_note is distinct from old.variance_note
       or new.total_actual is distinct from old.total_actual or new.total_approved_budget is distinct from old.total_approved_budget
       or new.approval_route is distinct from old.approval_route then
      raise exception 'Submitted final expenses are a historical record and cannot be changed' using errcode = '23514';
    end if;
  end if;
  if old.status in ('submitted', 'approved') and new.status is distinct from old.status and new.status in ('approved', 'returned')
     and (new.decided_by is null or new.decided_by = old.created_by or new.decided_by = old.submitted_by) then
    raise exception 'Final expenses cannot be decided by the person who prepared or submitted them' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'submitted')
         or (old.status = 'submitted' and new.status in ('approved', 'returned'))
         or (old.status = 'approved' and new.status = 'returned')) then
      raise exception 'Final expenses cannot move from % to %', old.status, new.status using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists pbx_actual_submissions_guard on pbx_actual_submissions;
create trigger pbx_actual_submissions_guard before update or delete on pbx_actual_submissions
  for each row execute function pbx_actual_submission_guard();

-- Funding and payments are recorded once; the only change ever allowed is an audited reversal.
create or replace function pbx_money_entry_guard()
returns trigger
language plpgsql
as $$
declare v_old jsonb; v_new jsonb;
begin
  if tg_op = 'DELETE' then raise exception 'Recorded funding and payments are never deleted: reverse them with a reason' using errcode = '23514'; end if;
  v_old := to_jsonb(old) - 'status' - 'reversed_by' - 'reversed_at' - 'reversal_reason';
  v_new := to_jsonb(new) - 'status' - 'reversed_by' - 'reversed_at' - 'reversal_reason';
  if v_old is distinct from v_new then
    raise exception 'A recorded entry cannot be edited: reverse it with a reason and record the correct one' using errcode = '23514';
  end if;
  if old.status = 'reversed' and new.status is distinct from old.status then
    raise exception 'A reversed entry cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists pbx_funding_guard on pbx_funding;
create trigger pbx_funding_guard before update or delete on pbx_funding for each row execute function pbx_money_entry_guard();
drop trigger if exists pbx_payments_guard on pbx_payments;
create trigger pbx_payments_guard before update or delete on pbx_payments for each row execute function pbx_money_entry_guard();

create or replace function pbx_budget_header_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then raise exception 'A project budget record is never deleted' using errcode = '23514'; end if;
  if new.project_id is distinct from old.project_id or new.company_id is distinct from old.company_id or new.currency is distinct from old.currency
     or new.created_by is distinct from old.created_by then
    raise exception 'The project, company and currency of a budget cannot be changed' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists pbx_budgets_guard on pbx_budgets;
create trigger pbx_budgets_guard before update or delete on pbx_budgets for each row execute function pbx_budget_header_guard();

-- Audit trail on every table.
do $$
declare t text;
begin
  foreach t in array array['pbx_budgets', 'pbx_budget_versions', 'pbx_budget_rows', 'pbx_funding', 'pbx_actual_submissions', 'pbx_actual_rows', 'pbx_payments'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function pbx_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on table pbx_budgets, pbx_budget_versions, pbx_budget_rows, pbx_funding, pbx_actual_submissions, pbx_actual_rows, pbx_payments
  from anon, authenticated, public;
grant select on table pbx_budgets, pbx_budget_versions, pbx_budget_rows, pbx_funding, pbx_actual_submissions, pbx_actual_rows, pbx_payments to authenticated;

revoke all on function
  pbx_budget_company(uuid), pbx_budget_project(uuid), pbx_is_budget_pm(uuid), pbx_can_read_budget(uuid), pbx_can_read_budget_header(uuid),
  pbx_can_read_version(uuid), pbx_can_read_submission(uuid),
  pbx_budget_row_calc(), pbx_rows_frozen(), pbx_version_guard(), pbx_actual_rows_frozen(), pbx_actual_submission_guard(), pbx_money_entry_guard(),
  pbx_budget_header_guard()
  from public, anon, authenticated;
grant execute on function
  pbx_is_budget_pm(uuid), pbx_can_read_budget(uuid), pbx_can_read_budget_header(uuid), pbx_can_read_version(uuid), pbx_can_read_submission(uuid)
  to authenticated;

-- ROLLBACK (only before the app depends on it; full ordered version in supabase/manual-sql/pbx_90_rollback.sql).
