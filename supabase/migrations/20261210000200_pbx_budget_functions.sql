-- Project Budget & Expenses, migration 3 of 5: the budget workflow.
--
-- Hard rules encoded here (the database, not the page, enforces them):
--   * Only the CURRENT PM (or unexpired acting PM, proj_is_pm) prepares and submits; only Finance of the budget's company decides.
--   * Nobody decides a version they created or submitted, whatever else they hold. When no independent Finance approver exists the
--     submission stays 'submitted' and is reported as on hold; nothing is ever approved automatically.
--   * A decision locks the version row and needs status 'submitted': two approvers can never create two decisions.
--   * A submitted version is frozen (guards in migration 2). Returning or rejecting needs a reason; a revision is a NEW draft.
--   * An approved budget is never overwritten. More money is a separate "addition" version showing only the increment; pending,
--     returned and rejected additions never count towards the approved amount.
--   * Retries are safe: a submission carries a request id, a second click returns the first result.
--   * Stale edits are refused clearly (row_version).
-- Error codes: 42501 not allowed, P0002 not found (also when not visible), 23514 wrong state, 22023 bad input, PB409 changed by someone else.
-- Nothing here touches an HR, Sales, Inventory or existing claim table, and no function sends e-mail.

-- -----------------------------------------------------------------------------
-- Internal helpers (not granted to clients)
-- -----------------------------------------------------------------------------
create or replace function pbx_name(p_user_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$ select proj_display_name(p_user_id); $$;

-- A plain non-negative decimal with at most p_dec decimals (the column's own scale, so nothing is ever rounded silently on the way in).
create or replace function pbx_num(p_text text, p_label text, p_dec integer default 3)
returns numeric
language plpgsql immutable
as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  if btrim(p_text) !~ ('^[0-9]{1,12}(\.[0-9]{1,' || p_dec || '})?$') then
    raise exception 'Enter a valid number for % (at most % decimals)', p_label, p_dec using errcode = '22023';
  end if;
  return btrim(p_text)::numeric;
end;
$$;

create or replace function pbx_date(p_text text, p_label text)
returns date
language plpgsql immutable
as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  if btrim(p_text) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter a valid date for %', p_label using errcode = '22023'; end if;
  return btrim(p_text)::date;
exception when others then
  raise exception 'Enter a valid date for %', p_label using errcode = '22023';
end;
$$;

-- In-app notification (the shared notifications table, new "project_budget_*" types): never to the actor, deduplicated while unread.
create or replace function pbx_notify(p_user_id uuid, p_type text, p_budget pbx_budgets, p_payload jsonb, p_dedupe text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_user_id = auth.uid() then return; end if;
  if not exists (select 1 from profiles where id = p_user_id and is_active) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('pbx_notify:' || p_user_id::text || ':' || p_dedupe, 0));
  if exists (select 1 from notifications n where n.user_id = p_user_id and n.type = p_type and n.read_at is null
              and n.payload->>'dedupe_key' = p_dedupe) then return; end if;
  insert into notifications (user_id, type, payload)
  values (p_user_id, p_type, coalesce(p_payload, '{}'::jsonb)
          || jsonb_build_object('dedupe_key', p_dedupe, 'project_id', p_budget.project_id, 'budget_id', p_budget.id,
                                'reference', p_budget.project_reference, 'name', p_budget.project_name));
end;
$$;

-- Active Finance grantees of a company, except the people named (the people who prepared or submitted the thing to decide).
create or replace function pbx_finance_approvers(p_company_id uuid, p_exclude uuid[] default '{}'::uuid[])
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select g.user_id
  from pbx_company_grants g
  join profiles p on p.id = g.user_id and p.is_active
  where g.company_id = p_company_id and g.revoked_at is null and 'finance' = any (g.capabilities)
    and not (g.user_id = any (coalesce(array_remove(p_exclude, null), '{}'::uuid[])));
$$;

-- True when nobody independent of the people who prepared and submitted can decide.
create or replace function pbx_approval_on_hold(p_company_id uuid, p_created_by uuid, p_submitted_by uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$ select not exists (select 1 from pbx_finance_approvers(p_company_id, array[p_created_by, p_submitted_by])); $$;

-- Lock a budget the caller may read. Not-visible and not-existing are indistinguishable.
create or replace function pbx_lock_budget(p_budget_id uuid)
returns pbx_budgets
language plpgsql security definer
set search_path = public
as $$
declare b pbx_budgets;
begin
  perform pbx_require_user();
  select * into b from pbx_budgets where id = p_budget_id for update;
  if not found or not pbx_can_read_budget_header(b.id) then
    raise exception 'Budget not found' using errcode = 'P0002';
  end if;
  perform pbx_require_enabled(b.company_id);
  return b;
end;
$$;

create or replace function pbx_require_pm(p_budget pbx_budgets)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not proj_is_pm(p_budget.project_id) then
    raise exception 'Only the Project Manager, or someone holding temporary project leadership, can do that' using errcode = '42501';
  end if;
  perform pbx_require_enabled(p_budget.company_id);
end;
$$;

create or replace function pbx_require_finance(p_budget pbx_budgets, p_what text default 'do that')
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not pbx_is_finance(p_budget.company_id) then
    raise exception 'Only Finance of this company can %', p_what using errcode = '42501';
  end if;
  perform pbx_require_enabled(p_budget.company_id);
end;
$$;

create or replace function pbx_require_open(p_budget pbx_budgets)
returns void
language plpgsql immutable
as $$
begin
  if p_budget.settlement_status = 'closed' then
    raise exception 'Settlement is closed. Finance must reopen it, with a reason, before anything changes' using errcode = '23514';
  end if;
end;
$$;

create or replace function pbx_check_version(p_current integer, p_expected integer, p_what text default 'This')
returns void
language plpgsql immutable
as $$
begin
  if p_expected is not null and p_expected <> p_current then
    raise exception '% was changed by someone else. Reload and try again', p_what using errcode = 'PB409';
  end if;
end;
$$;

-- The PM or an active member of the project: the people a budget, an advance or a payment can name.
create or replace function pbx_project_person_ok(p_project_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from profiles p where p.id = p_user_id and p.is_active)
     and (exists (select 1 from proj_projects pr where pr.id = p_project_id and pr.pm_user_id = p_user_id)
          or exists (select 1 from proj_project_members m where m.project_id = p_project_id and m.user_id = p_user_id and m.removed_at is null));
$$;

-- Refresh the display copy of the project (reference, name, PM, location, dates) kept for Finance, who needs no Projects access.
create or replace function pbx_refresh_snapshot(p_budget_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update pbx_budgets b
     set project_reference = pr.reference, project_name = pr.name, pm_user_id = pr.pm_user_id, pm_name = proj_display_name(pr.pm_user_id),
         location = d.location, site_timezone = d.site_timezone, project_start = pr.start_date, project_end = pr.end_date,
         install_start = d.install_start, event_start = d.event_start, event_end = d.event_end
    from proj_projects pr
    left join proj_project_details d on d.project_id = pr.id
   where b.id = p_budget_id and pr.id = b.project_id;
end;
$$;

create or replace function pbx_baseline_total(p_budget_id uuid)
returns numeric
language sql stable security definer
set search_path = public
as $$ select coalesce(sum(total), 0) from pbx_budget_versions where budget_id = p_budget_id and status = 'approved'; $$;

-- -----------------------------------------------------------------------------
-- Create the budget (idempotent: one record per project; the currency is fixed by the first call)
-- -----------------------------------------------------------------------------
create or replace function pbx_create_budget(p_project_id uuid, p_currency text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  pr proj_projects;
  d proj_project_details;
  b pbx_budgets;
  v_cur text := upper(btrim(coalesce(p_currency, '')));
  v_start date;
  v_end date;
  v_seq integer;
begin
  perform pbx_require_user();
  select * into pr from proj_projects where id = p_project_id;
  if not found or not proj_is_pm(p_project_id) then
    raise exception 'Only the Project Manager, or someone holding temporary project leadership, can create the budget' using errcode = '42501';
  end if;
  perform pbx_require_enabled(pr.company_id);
  select * into d from proj_project_details where project_id = p_project_id;
  v_start := coalesce(d.install_start, pr.start_date, d.event_start);
  v_end := coalesce(d.event_end, pr.end_date);
  if v_end is not null and v_start is not null and v_end < v_start then v_end := null; end if;

  select * into b from pbx_budgets where project_id = p_project_id for update;
  if not found then
    if v_cur !~ '^[A-Z]{3}$' then raise exception 'The expense currency is a 3-letter code, for example AED' using errcode = '22023'; end if;
    insert into pbx_budgets (project_id, company_id, currency, project_reference, project_name, pm_user_id, pm_name, location, site_timezone,
                             project_start, project_end, install_start, event_start, event_end, created_by)
    values (pr.id, pr.company_id, v_cur, pr.reference, pr.name, pr.pm_user_id, proj_display_name(pr.pm_user_id), d.location, d.site_timezone,
            pr.start_date, pr.end_date, d.install_start, d.event_start, d.event_end, auth.uid())
    returning * into b;
    insert into pbx_budget_versions (budget_id, company_id, project_id, kind, seq, period_start, period_end, created_by)
    values (b.id, b.company_id, b.project_id, 'original', 1, v_start, v_end, auth.uid());
    return b.id;
  end if;
  -- Already exists: if every original attempt was discarded and nothing is open, start a new draft original.
  if not exists (select 1 from pbx_budget_versions where budget_id = b.id and status in ('draft', 'submitted'))
     and not exists (select 1 from pbx_budget_versions where budget_id = b.id and kind = 'original' and status <> 'discarded') then
    select coalesce(max(seq), 0) + 1 into v_seq from pbx_budget_versions where budget_id = b.id;
    insert into pbx_budget_versions (budget_id, company_id, project_id, kind, seq, period_start, period_end, created_by)
    values (b.id, b.company_id, b.project_id, 'original', v_seq, v_start, v_end, auth.uid());
  end if;
  return b.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Save a draft: header plus the full set of rows, replaced atomically. Totals are calculated by the trigger, never taken from the client.
-- p_header: {"period_start","period_end","people":[uuid],"note"}; p_rows: [{category_id, date_from, date_to, activity, description, basis,
--            people, days, qty, rate, fixed, rate_key}]
-- -----------------------------------------------------------------------------
create or replace function pbx_save_budget_draft(p_version_id uuid, p_expected integer, p_header jsonb, p_rows jsonb)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v pbx_budget_versions;
  b pbx_budgets;
  r jsonb;
  c pbx_categories;
  v_n integer := 0;
  v_people uuid[] := '{}'::uuid[];
  v_person text;
  v_total numeric;
  v_key text;
  v_conf numeric;
  v_start date;
  v_end date;
  v_version integer;
begin
  perform pbx_require_user();
  select * into v from pbx_budget_versions where id = p_version_id for update;
  if not found then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  select * into b from pbx_budgets where id = v.budget_id;
  perform pbx_require_pm(b);
  perform pbx_require_open(b);
  if v.status <> 'draft' then raise exception 'This budget version is no longer a draft, so it cannot be edited' using errcode = '23514'; end if;
  perform pbx_check_version(v.row_version, p_expected, 'This budget');
  if p_rows is not null and jsonb_typeof(p_rows) <> 'array' then raise exception 'The rows are not valid' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 200 then raise exception 'A budget can have up to 200 rows' using errcode = '22023'; end if;

  v_start := pbx_date(p_header->>'period_start', 'the period start');
  v_end := pbx_date(p_header->>'period_end', 'the period end');
  if v_start is not null and v_end is not null and v_end < v_start then raise exception 'The period end is before its start' using errcode = '22023'; end if;
  if jsonb_typeof(p_header->'people') = 'array' then
    for v_person in select jsonb_array_elements_text(p_header->'people') loop
      if v_person !~ '^[0-9a-fA-F-]{36}$' then raise exception 'The people list is not valid' using errcode = '22023'; end if;
      if not pbx_project_person_ok(b.project_id, v_person::uuid) then
        raise exception 'Only the Project Manager or a current member of the project can be listed' using errcode = '22023';
      end if;
      v_people := v_people || v_person::uuid;
    end loop;
  end if;

  delete from pbx_budget_rows where version_id = v.id;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_n := v_n + 1;
    select * into c from pbx_categories
     where id = nullif(r->>'category_id', '')::uuid and is_active and (company_id is null or company_id = b.company_id);
    if not found then raise exception 'Choose a category for row %', v_n using errcode = '22023'; end if;
    v_key := nullif(btrim(coalesce(r->>'rate_key', '')), '');
    v_conf := null;
    if v_key is not null then
      select amount into v_conf from pbx_rates where company_id = b.company_id and currency = b.currency and rate_key = v_key;
    end if;
    insert into pbx_budget_rows (version_id, budget_id, company_id, sort_no, category_id, category_key, category_label, date_from, date_to, activity,
                                 description, basis, people, days, qty, rate, fixed, rate_key, configured_rate)
    values (v.id, b.id, b.company_id, v_n, c.id, c.key, c.label,
            pbx_date(r->>'date_from', 'the row date'), pbx_date(r->>'date_to', 'the row end date'),
            coalesce(nullif(r->>'activity', ''), 'other'), btrim(coalesce(r->>'description', '')), coalesce(r->>'basis', ''),
            pbx_num(r->>'people', 'the number of people'), pbx_num(r->>'days', 'the days'), pbx_num(r->>'qty', 'the quantity'),
            pbx_num(r->>'rate', 'the rate', 4), pbx_num(r->>'fixed', 'the fixed total'), v_key, v_conf);
  end loop;
  select coalesce(sum(total), 0) into v_total from pbx_budget_rows where version_id = v.id;

  update pbx_budget_versions
     set period_start = v_start, period_end = v_end, people = v_people, note = nullif(left(btrim(coalesce(p_header->>'note', '')), 2000), ''),
         total = v_total, row_version = row_version + 1
   where id = v.id
  returning row_version into v_version;
  return v_version;
end;
$$;

-- -----------------------------------------------------------------------------
-- Submit to Finance (idempotent on the request id)
-- -----------------------------------------------------------------------------
create or replace function pbx_submit_budget(p_version_id uuid, p_expected integer, p_request_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v pbx_budget_versions;
  b pbx_budgets;
  a uuid;
  v_rows integer;
begin
  perform pbx_require_user();
  if p_request_id is null then raise exception 'A request id is needed so a retry cannot submit twice' using errcode = '22023'; end if;
  select * into v from pbx_budget_versions where id = p_version_id for update;
  if not found then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  select * into b from pbx_budgets where id = v.budget_id for update;
  perform pbx_require_pm(b);
  if v.status = 'submitted' and v.submit_request_id = p_request_id then return v.id; end if;   -- a retry or double click: same result
  perform pbx_require_open(b);
  if v.status <> 'draft' then raise exception 'This budget version was already submitted' using errcode = '23514'; end if;
  perform pbx_check_version(v.row_version, p_expected, 'This budget');
  select count(*) into v_rows from pbx_budget_rows where version_id = v.id;
  if v_rows = 0 then raise exception 'Add at least one expense row before submitting' using errcode = '22023'; end if;
  if v.total <= 0 then raise exception 'The requested amount must be more than zero' using errcode = '22023'; end if;
  if v.kind = 'addition' and not exists (select 1 from pbx_budget_versions where budget_id = b.id and kind = 'original' and status = 'approved') then
    raise exception 'An additional request needs an approved budget first' using errcode = '23514';
  end if;

  perform pbx_refresh_snapshot(b.id);
  update pbx_budget_versions set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), submit_request_id = p_request_id,
         row_version = row_version + 1 where id = v.id;
  select * into b from pbx_budgets where id = b.id;
  for a in select pbx_finance_approvers(b.company_id, array[v.created_by, auth.uid()]) loop
    perform pbx_notify(a, 'project_budget_submitted', b,
      jsonb_build_object('version_id', v.id, 'kind', v.kind, 'total', v.total, 'currency', b.currency), 'pbx-sub-' || v.id::text);
  end loop;
  return v.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Finance decision: approve, return (for changes) or reject. Independent, reasoned, and exactly once.
-- -----------------------------------------------------------------------------
create or replace function pbx_decide_budget(p_version_id uuid, p_decision text, p_note text default null)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v pbx_budget_versions;
  b pbx_budgets;
  v_new text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform pbx_require_user();
  select * into v from pbx_budget_versions where id = p_version_id for update;     -- the second approver waits here, then finds it decided
  if not found then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  select * into b from pbx_budgets where id = v.budget_id for update;
  perform pbx_require_finance(b, 'decide on a project budget');
  if p_decision not in ('approve', 'return', 'reject') then raise exception 'Choose approve, return or reject' using errcode = '22023'; end if;
  if v.status <> 'submitted' then
    raise exception 'This budget version has already been decided (%, by %)', v.status, coalesce(pbx_name(v.decided_by), 'someone') using errcode = '23514';
  end if;
  if auth.uid() = v.created_by or auth.uid() = v.submitted_by then
    raise exception 'You cannot decide a budget you prepared or submitted. Another Finance approver must decide it' using errcode = '42501';
  end if;
  if p_decision in ('return', 'reject') and (v_note is null or length(v_note) < 3) then
    raise exception 'Give the reason, so the Project Manager knows what to do' using errcode = '22023';
  end if;
  v_new := case p_decision when 'approve' then 'approved' when 'return' then 'returned' else 'rejected' end;
  update pbx_budget_versions set status = v_new, decided_by = auth.uid(), decided_at = now(), decision_note = v_note, row_version = row_version + 1 where id = v.id;
  perform pbx_notify(v.submitted_by, 'project_budget_decided', b, jsonb_build_object('version_id', v.id, 'decision', v_new, 'kind', v.kind, 'note', v_note), 'pbx-dec-' || v.id::text);
  perform pbx_notify(b.pm_user_id, 'project_budget_decided', b, jsonb_build_object('version_id', v.id, 'decision', v_new, 'kind', v.kind, 'note', v_note), 'pbx-dec-' || v.id::text);
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Revisions, additional requests and discarding a draft
-- -----------------------------------------------------------------------------
-- A returned or rejected version is history. The PM continues from a NEW draft that copies it.
create or replace function pbx_revise_budget(p_version_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v pbx_budget_versions;
  b pbx_budgets;
  v_new uuid;
  v_seq integer;
begin
  perform pbx_require_user();
  select * into v from pbx_budget_versions where id = p_version_id;
  if not found then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  b := pbx_lock_budget(v.budget_id);
  perform pbx_require_pm(b);
  perform pbx_require_open(b);
  if v.status not in ('returned', 'rejected') then raise exception 'Only a returned or rejected version can be revised' using errcode = '23514'; end if;
  if exists (select 1 from pbx_budget_versions where budget_id = b.id and status in ('draft', 'submitted')) then
    raise exception 'There is already a version in progress' using errcode = '23514';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from pbx_budget_versions where budget_id = b.id;
  insert into pbx_budget_versions (budget_id, company_id, project_id, kind, seq, parent_version_id, period_start, period_end, people, note, total, created_by)
  values (b.id, b.company_id, b.project_id, v.kind, v_seq, v.id, v.period_start, v.period_end, v.people, v.note, v.total, auth.uid())
  returning id into v_new;
  insert into pbx_budget_rows (version_id, budget_id, company_id, sort_no, category_id, category_key, category_label, date_from, date_to, activity, description,
                               basis, people, days, qty, rate, fixed, rate_key, configured_rate)
  select v_new, budget_id, company_id, sort_no, category_id, category_key, category_label, date_from, date_to, activity, description,
         basis, people, days, qty, rate, fixed, rate_key, configured_rate
    from pbx_budget_rows where version_id = v.id;
  return v_new;
end;
$$;

-- More money after the original was approved: a separate request that shows only the increment.
create or replace function pbx_request_addition(p_budget_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  b pbx_budgets;
  o pbx_budget_versions;
  v_new uuid;
  v_seq integer;
begin
  b := pbx_lock_budget(p_budget_id);
  perform pbx_require_pm(b);
  perform pbx_require_open(b);
  select * into o from pbx_budget_versions where budget_id = b.id and kind = 'original' and status = 'approved';
  if not found then raise exception 'An additional request needs an approved budget first' using errcode = '23514'; end if;
  if exists (select 1 from pbx_budget_versions where budget_id = b.id and status in ('draft', 'submitted')) then
    raise exception 'There is already a version in progress' using errcode = '23514';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from pbx_budget_versions where budget_id = b.id;
  insert into pbx_budget_versions (budget_id, company_id, project_id, kind, seq, period_start, period_end, people, created_by)
  values (b.id, b.company_id, b.project_id, 'addition', v_seq, o.period_start, o.period_end, o.people, auth.uid())
  returning id into v_new;
  return v_new;
end;
$$;

create or replace function pbx_discard_draft(p_version_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v pbx_budget_versions; b pbx_budgets;
begin
  perform pbx_require_user();
  select * into v from pbx_budget_versions where id = p_version_id for update;
  if not found then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  b := pbx_lock_budget(v.budget_id);
  perform pbx_require_pm(b);
  perform pbx_require_open(b);
  if v.status <> 'draft' then raise exception 'Only a draft can be discarded' using errcode = '23514'; end if;
  update pbx_budget_versions set status = 'discarded', row_version = row_version + 1 where id = v.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  pbx_name(uuid), pbx_num(text, text, integer), pbx_date(text, text), pbx_notify(uuid, text, pbx_budgets, jsonb, text), pbx_finance_approvers(uuid, uuid[]),
  pbx_approval_on_hold(uuid, uuid, uuid), pbx_lock_budget(uuid), pbx_require_pm(pbx_budgets), pbx_require_finance(pbx_budgets, text),
  pbx_require_open(pbx_budgets), pbx_check_version(integer, integer, text), pbx_project_person_ok(uuid, uuid), pbx_refresh_snapshot(uuid),
  pbx_baseline_total(uuid),
  pbx_create_budget(uuid, text), pbx_save_budget_draft(uuid, integer, jsonb, jsonb), pbx_submit_budget(uuid, integer, uuid),
  pbx_decide_budget(uuid, text, text), pbx_revise_budget(uuid), pbx_request_addition(uuid), pbx_discard_draft(uuid)
  from public, anon, authenticated;
grant execute on function
  pbx_create_budget(uuid, text), pbx_save_budget_draft(uuid, integer, jsonb, jsonb), pbx_submit_budget(uuid, integer, uuid),
  pbx_decide_budget(uuid, text, text), pbx_revise_budget(uuid), pbx_request_addition(uuid), pbx_discard_draft(uuid)
  to authenticated;

-- ROLLBACK: see supabase/manual-sql/pbx_90_rollback.sql.
