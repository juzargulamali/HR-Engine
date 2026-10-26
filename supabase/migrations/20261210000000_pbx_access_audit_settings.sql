-- Project Budget & Expenses, migration 1 of 5: access, audit, categories and company rates.
--
-- Access is its own company-scoped grant table (pbx_company_grants), deliberately NOT user_roles (the HR Finance role also opens payroll
-- and compensation), NOT proj_/crm_/inv_company_grants: a Finance HR role, a Projects membership or grant, a Sales grant, a founder
-- title, an employee record or an e-mail domain confers NO access to project budgets, and a budget grant confers no HR, Sales,
-- Projects or Inventory access. Capabilities:
--   finance        decide budgets and final expenses submitted by Project Managers WITHOUT Finance access; record funding, returns, reimbursements
--                  and receipt delivery (declarations); close settlement for ordinary Project Managers; reopen settlement; set company rates
--                  and categories; and read everything of that company
--   view           read-only access to the company's budgets (an explicit grant, for example for a founder; a title confers nothing)
--   executive_approver  the company's authorised CEO / CTO approver: decides budgets, additional budget requests and final expenses that were
--                  SUBMITTED BY SOMEONE WHO HOLDS FINANCE ACCESS for that company (nobody approves their own work), and reads the company's
--                  budgets, confirms the receipts of that settlement and authorises its closure. Either a CEO or a CTO is enough. It records no funds,
--                  receipts, returns or reimbursements (that stays with Finance), and it is an explicit grant: a CEO / CTO title, role or account confers nothing
--   manage_access  grant and revoke these capabilities for the company
-- Nothing here reads or writes an HR, Sales, Projects (beyond the project lookups of migration 2+), Inventory or claims table.
-- Additive: no existing object is altered. No grant is created by this migration: access is set up explicitly (see the owner's setup SQL).

-- -----------------------------------------------------------------------------
-- Capability vocabulary and grants
-- -----------------------------------------------------------------------------
create or replace function pbx_capability_list()
returns text[]
language sql immutable
as $$ select array['finance', 'view', 'executive_approver', 'manage_access']::text[]; $$;

create table if not exists pbx_company_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  company_id    uuid not null references companies(id),
  capabilities  text[] not null default '{}'::text[],
  note          text,
  granted_by    uuid references auth.users(id),
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  constraint pbx_company_grants_caps check (capabilities <@ pbx_capability_list())
);
create unique index if not exists uq_pbx_grants_active on pbx_company_grants(user_id, company_id) where revoked_at is null;
create index if not exists idx_pbx_grants_company on pbx_company_grants(company_id) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER + stable so policies can call them without recursion; every one joins to an ACTIVE profile, so a
-- deactivated account loses access at once.
-- -----------------------------------------------------------------------------
create or replace function pbx_require_user()
returns uuid
language plpgsql stable
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return auth.uid();
end;
$$;

create or replace function pbx_has_capability(p_company_id uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from pbx_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.company_id = p_company_id and g.revoked_at is null
      and p_capability = any (g.capabilities));
$$;

-- Finance: may decide and record. Nothing else implies it (not 'view', not 'manage_access', not a title).
create or replace function pbx_is_finance(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$ select pbx_has_capability(p_company_id, 'finance'); $$;

-- May read the company's budgets: Finance, or an explicit read-only grant.
create or replace function pbx_can_view_company(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$ select pbx_has_capability(p_company_id, 'finance') or pbx_has_capability(p_company_id, 'view') or pbx_has_capability(p_company_id, 'executive_approver'); $$;

-- The company's authorised CEO / CTO approver (explicit grant only).
create or replace function pbx_is_executive(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$ select pbx_has_capability(p_company_id, 'executive_approver'); $$;

create or replace function pbx_has_any_access()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from pbx_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.revoked_at is null and (g.capabilities && array['finance', 'view', 'executive_approver']::text[]));
$$;

create or replace function pbx_accessible_company_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select g.company_id
  from pbx_company_grants g
  join profiles p on p.id = g.user_id and p.is_active
  where g.user_id = auth.uid() and g.revoked_at is null and (g.capabilities && array['finance', 'view', 'executive_approver']::text[]);
$$;

create or replace function pbx_finance_company_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select g.company_id
  from pbx_company_grants g
  join profiles p on p.id = g.user_id and p.is_active
  where g.user_id = auth.uid() and g.revoked_at is null and 'finance' = any (g.capabilities);
$$;

alter table pbx_company_grants enable row level security;
drop policy if exists pbx_company_grants_select on pbx_company_grants;
create policy pbx_company_grants_select on pbx_company_grants for select
  using (user_id = auth.uid() or pbx_has_capability(company_id, 'manage_access'));

-- -----------------------------------------------------------------------------
-- Audit log. Own table, readable only by Finance / view grantees of the company. Rows store the old and new row images.
-- Every audited table carries company_id.
-- -----------------------------------------------------------------------------
create table if not exists pbx_audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text,
  company_id  uuid,
  action      text not null check (action in ('insert', 'update', 'delete')),
  actor_id    uuid,
  old_row     jsonb,
  new_row     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_pbx_audit_company_time on pbx_audit_log(company_id, created_at desc);
create index if not exists idx_pbx_audit_row on pbx_audit_log(table_name, row_id);

alter table pbx_audit_log enable row level security;
drop policy if exists pbx_audit_log_select on pbx_audit_log;
create policy pbx_audit_log_select on pbx_audit_log for select
  using (company_id is not null and pbx_can_view_company(company_id));

create or replace function pbx_audit_trigger()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into pbx_audit_log (table_name, row_id, company_id, action, actor_id, old_row, new_row)
  values (tg_table_name, v_row->>'id', nullif(v_row->>'company_id', '')::uuid, lower(tg_op), auth.uid(), v_old, v_new);
  return coalesce(new, old);
end;
$$;

drop trigger if exists pbx_company_grants_audit on pbx_company_grants;
create trigger pbx_company_grants_audit after insert or update or delete on pbx_company_grants
  for each row execute function pbx_audit_trigger();

-- -----------------------------------------------------------------------------
-- Currency helpers (one expense currency per budget; amounts are never added across currencies)
-- -----------------------------------------------------------------------------
create or replace function pbx_currency_decimals(p_currency text)
returns integer
language sql immutable
as $$
  select case
    when upper(p_currency) in ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') then 0
    when upper(p_currency) in ('BHD','IQD','JOD','KWD','LYD','OMR','TND') then 3
    else 2
  end;
$$;

-- Half away from zero to the currency's own decimals (numeric round() does exactly that).
create or replace function pbx_round(p_amount numeric, p_currency text)
returns numeric
language sql immutable
as $$ select round(p_amount, pbx_currency_decimals(p_currency)); $$;

-- -----------------------------------------------------------------------------
-- Categories: the six defaults (company_id null) and company categories added by Finance (a simple controlled list).
-- -----------------------------------------------------------------------------
create table if not exists pbx_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id),
  key         text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  label       text not null check (length(btrim(label)) between 1 and 60),
  sort_no     integer not null default 100,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  constraint pbx_categories_default_global check (not is_default or company_id is null)
);
create unique index if not exists uq_pbx_categories_key on pbx_categories(coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

insert into pbx_categories (company_id, key, label, sort_no, is_default) values
  (null, 'food', 'Food', 10, true),
  (null, 'transport', 'Transport', 20, true),
  (null, 'badges', 'Contractor badges / access', 30, true),
  (null, 'accommodation', 'Accommodation', 40, true),
  (null, 'logistics', 'Truck / logistics', 50, true),
  (null, 'other', 'Other expenses', 90, true)
on conflict do nothing;

alter table pbx_categories enable row level security;
drop policy if exists pbx_categories_select on pbx_categories;
create policy pbx_categories_select on pbx_categories for select
  using (company_id is null or pbx_can_view_company(company_id));

drop trigger if exists pbx_categories_audit on pbx_categories;
create trigger pbx_categories_audit after insert or update on pbx_categories
  for each row execute function pbx_audit_trigger();

-- -----------------------------------------------------------------------------
-- Company rates per currency: petrol per kilometre and meal per person. Entered by Finance; a number is never applied silently to
-- another currency (the application only SUGGESTS AED 0.50 / AED 30 until Finance confirms them here).
-- -----------------------------------------------------------------------------
create table if not exists pbx_rates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  rate_key    text not null check (rate_key in ('petrol_per_km', 'meal_per_person')),
  amount      numeric(14,4) not null check (amount >= 0),
  note        text,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  constraint pbx_rates_unique unique (company_id, currency, rate_key)
);
alter table pbx_rates enable row level security;
drop policy if exists pbx_rates_select on pbx_rates;
create policy pbx_rates_select on pbx_rates for select using (pbx_can_view_company(company_id));

drop trigger if exists pbx_rates_audit on pbx_rates;
create trigger pbx_rates_audit after insert or update or delete on pbx_rates
  for each row execute function pbx_audit_trigger();

-- -----------------------------------------------------------------------------
-- Company switch: the safe way to pause the module. No row means ON. With is_enabled = false every function that changes a budget,
-- funding, actual expense, payment or settlement refuses in plain words; reading, access management, rates and categories keep working.
-- The owner flips it in the SQL Editor (supabase/manual-sql/pbx_80_safe_disable_and_restore.sql); nothing is deleted or reversed.
-- -----------------------------------------------------------------------------
create table if not exists pbx_company_settings (
  company_id  uuid primary key references companies(id),
  is_enabled  boolean not null default true,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
alter table pbx_company_settings enable row level security;
drop policy if exists pbx_company_settings_select on pbx_company_settings;
create policy pbx_company_settings_select on pbx_company_settings for select using (pbx_can_view_company(company_id));

drop trigger if exists pbx_company_settings_audit on pbx_company_settings;
create trigger pbx_company_settings_audit after insert or update or delete on pbx_company_settings
  for each row execute function pbx_audit_trigger();

create or replace function pbx_company_enabled(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select is_enabled from pbx_company_settings where company_id = p_company_id), true);
$$;
create or replace function pbx_require_enabled(p_company_id uuid)
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not pbx_company_enabled(p_company_id) then
    raise exception 'Project budgets are switched off for this company. Nothing can be changed until the owner switches them on; everything can still be read.' using errcode = '23514';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Functions: access management, rates, categories
-- -----------------------------------------------------------------------------
create or replace function pbx_grant_access(
  p_user_id uuid,
  p_company_id uuid,
  p_capabilities text[] default '{}'::text[],
  p_note text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_caps text[] := coalesce(p_capabilities, '{}'::text[]);
begin
  perform pbx_require_user();
  if not pbx_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only someone with budget access management for this company can grant access to project budgets' using errcode = '42501';
  end if;
  if not (v_caps <@ pbx_capability_list()) then
    raise exception 'Unknown capability in %', v_caps using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_user_id and is_active) then
    raise exception 'That user does not exist or is not active' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  -- the last access manager cannot remove their own capability by replacing it
  if exists (select 1 from pbx_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities))
     and not ('manage_access' = any (v_caps))
     and (select count(*) from pbx_company_grants where company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities)) <= 1 then
    raise exception 'Cannot remove access management from the last person who holds it for this company' using errcode = '23514';
  end if;
  update pbx_company_grants set capabilities = v_caps, note = coalesce(p_note, note)
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null
  returning id into v_id;
  if v_id is null then
    insert into pbx_company_grants (user_id, company_id, capabilities, granted_by, note)
    values (p_user_id, p_company_id, v_caps, auth.uid(), p_note)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function pbx_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform pbx_require_user();
  if not pbx_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only someone with budget access management for this company can revoke access to project budgets' using errcode = '42501';
  end if;
  if exists (select 1 from pbx_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities))
     and (select count(*) from pbx_company_grants where company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities)) <= 1 then
    raise exception 'Cannot revoke the last person who manages access to project budgets for this company' using errcode = '23514';
  end if;
  update pbx_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
end;
$$;

-- Finance sets (or changes) a company rate for one currency.
create or replace function pbx_set_rate(p_company_id uuid, p_currency text, p_rate_key text, p_amount numeric, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid; v_cur text := upper(btrim(coalesce(p_currency, '')));
begin
  perform pbx_require_user();
  if not pbx_is_finance(p_company_id) then
    raise exception 'Only Finance can set the company rates' using errcode = '42501';
  end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'The currency is a 3-letter code' using errcode = '22023'; end if;
  if p_rate_key not in ('petrol_per_km', 'meal_per_person') then raise exception 'Unknown rate' using errcode = '22023'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000 then raise exception 'The rate must be zero or more' using errcode = '22023'; end if;
  insert into pbx_rates (company_id, currency, rate_key, amount, note, updated_by)
  values (p_company_id, v_cur, p_rate_key, p_amount, nullif(btrim(p_note), ''), auth.uid())
  on conflict (company_id, currency, rate_key) do update
    set amount = excluded.amount, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Finance adds a company category (a simple controlled list; the six defaults cannot be removed).
create or replace function pbx_add_category(p_company_id uuid, p_label text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_key text;
  v_id uuid;
begin
  perform pbx_require_user();
  if not pbx_is_finance(p_company_id) then
    raise exception 'Only Finance can add an expense category' using errcode = '42501';
  end if;
  if length(v_label) not between 1 and 60 then raise exception 'Give the category a name of up to 60 characters' using errcode = '22023'; end if;
  v_key := regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g');
  v_key := btrim(v_key, '_');
  if v_key = '' then raise exception 'Give the category a name with letters or numbers' using errcode = '22023'; end if;
  v_key := left(v_key, 40);
  if exists (select 1 from pbx_categories where (company_id is null or company_id = p_company_id) and (key = v_key or lower(label) = lower(v_label))) then
    raise exception 'That category already exists' using errcode = '23505';
  end if;
  insert into pbx_categories (company_id, key, label, sort_no, created_by) values (p_company_id, v_key, v_label, 70, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: clients read through RLS only; every write is a function.
-- -----------------------------------------------------------------------------
revoke all on table pbx_company_grants, pbx_audit_log, pbx_categories, pbx_rates, pbx_company_settings from anon, authenticated, public;
revoke all on sequence pbx_audit_log_id_seq from public, anon, authenticated;
grant select on table pbx_company_grants, pbx_audit_log, pbx_categories, pbx_rates, pbx_company_settings to authenticated;

revoke all on function
  pbx_capability_list(), pbx_require_user(), pbx_has_capability(uuid, text), pbx_is_finance(uuid), pbx_is_executive(uuid), pbx_can_view_company(uuid),
  pbx_has_any_access(), pbx_accessible_company_ids(), pbx_finance_company_ids(), pbx_audit_trigger(), pbx_company_enabled(uuid), pbx_require_enabled(uuid),
  pbx_currency_decimals(text), pbx_round(numeric, text),
  pbx_grant_access(uuid, uuid, text[], text), pbx_revoke_access(uuid, uuid),
  pbx_set_rate(uuid, text, text, numeric, text), pbx_add_category(uuid, text)
  from public, anon, authenticated;
grant execute on function
  pbx_capability_list(), pbx_has_capability(uuid, text), pbx_is_finance(uuid), pbx_is_executive(uuid), pbx_can_view_company(uuid),
  pbx_has_any_access(), pbx_accessible_company_ids(), pbx_finance_company_ids(), pbx_currency_decimals(text), pbx_round(numeric, text),
  pbx_grant_access(uuid, uuid, text[], text), pbx_revoke_access(uuid, uuid),
  pbx_set_rate(uuid, text, text, numeric, text), pbx_add_category(uuid, text)
  to authenticated;

-- ROLLBACK (only before the app depends on it; see supabase/manual-sql/pbx_90_rollback.sql for the full ordered version):
--   drop table if exists pbx_company_settings, pbx_rates, pbx_categories, pbx_audit_log, pbx_company_grants cascade;
