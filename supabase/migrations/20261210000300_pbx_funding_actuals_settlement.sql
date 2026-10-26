-- Project Budget & Expenses, migration 4 of 5: funding, final (actual) expenses, receipts, returns, reimbursements and settlement.
--
-- Budget approval, final-expense approval and recording money are DISTINCT actions with distinct functions.
--   * Funding is recorded by Finance, one entry per instalment and recipient; a Pluto allocation / card limit is never an advance.
--   * Actual expenses are the PM's own totals (never copied from the estimate): blank (null) is "not entered", zero is a confirmed zero.
--     Each line says how it was paid; an expense already in an employee claim is linked, never counted a second time as an
--     advance spend or a reimbursement.
--   * Settlement reconciles PER SOURCE and PER PERSON (pbx_settlement_figures): it never subtracts all spending from all funding.
--   * Independence: nobody decides, confirms receipts for, closes settlement for, funds or pays out expenses they prepared or submitted.
--   * Corrections are audited: funding and payments are reversed with a reason (never edited or deleted); approved actuals are sent back by
--     Finance with a reason and revised as a new version; closed settlement is reopened by Finance with a reason.
-- No payment is executed and nothing is deducted from payroll: these are records. No e-mail, no scheduled job.

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function pbx_money_text(p_amount numeric, p_currency text)
returns text
language sql immutable
as $$
  select p_currency || ' ' || to_char(p_amount, 'FM999,999,999,990' || case when pbx_currency_decimals(p_currency) = 0 then '' else '.' || repeat('0', pbx_currency_decimals(p_currency)) end);
$$;

-- An amount typed by a person: a plain decimal in the budget currency's own decimals, more than zero when p_positive.
create or replace function pbx_amount(p_amount numeric, p_currency text, p_label text, p_positive boolean default true)
returns numeric
language plpgsql immutable
as $$
begin
  if p_amount is null then raise exception 'Enter %', p_label using errcode = '22023'; end if;
  if p_amount < 0 or (p_positive and p_amount = 0) then raise exception '% must be more than zero', initcap(p_label) using errcode = '22023'; end if;
  if p_amount > 1000000000 then raise exception '% is too large', initcap(p_label) using errcode = '22023'; end if;
  if pbx_round(p_amount, p_currency) <> p_amount then
    raise exception '% has more decimals than % allows (%)', initcap(p_label), p_currency, pbx_currency_decimals(p_currency) using errcode = '22023';
  end if;
  return p_amount;
end;
$$;

-- True when this person submitted or prepared any final-expense submission of the budget (they cannot then also confirm or close it).
create or replace function pbx_is_actuals_author(p_budget_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from pbx_actual_submissions s
                  where s.budget_id = p_budget_id and s.status <> 'draft' and (s.created_by = p_user_id or s.submitted_by = p_user_id));
$$;

-- -----------------------------------------------------------------------------
-- Settlement figures (the single source of the numbers; the TypeScript mirror is tested against it)
-- -----------------------------------------------------------------------------
create or replace function pbx_settlement_figures(p_budget_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  b pbx_budgets;
  v_per jsonb;
  v_res jsonb;
begin
  select * into b from pbx_budgets where id = p_budget_id;
  if not found then return null; end if;

  with
    a as (select r.paid_via, r.paid_by_user_id, r.actual_amount
            from pbx_actual_rows r join pbx_actual_submissions s on s.id = r.submission_id
           where s.budget_id = b.id and s.status = 'approved' and r.actual_amount is not null),
    f as (select recipient_user_id, amount, is_advance from pbx_funding where budget_id = b.id and status = 'recorded'),
    pay as (select kind, person_user_id, amount from pbx_payments where budget_id = b.id and status = 'recorded'),
    people as (
      select recipient_user_id as u from f where is_advance
      union select paid_by_user_id from a where paid_via in ('advance', 'personal') and paid_by_user_id is not null
      union select person_user_id from pay),
    per as (
      select u,
        coalesce((select sum(amount) from f where is_advance and recipient_user_id = u), 0) as provided,
        coalesce((select sum(actual_amount) from a where paid_via = 'advance' and paid_by_user_id = u), 0) as spent,
        coalesce((select sum(actual_amount) from a where paid_via = 'personal' and paid_by_user_id = u), 0) as personal,
        coalesce((select sum(amount) from pay where kind = 'return' and person_user_id = u), 0) as returned,
        coalesce((select sum(amount) from pay where kind = 'reimbursement' and person_user_id = u), 0) as paid
      from people),
    calc as (
      select u, provided, spent, personal, returned, paid,
             provided - returned - spent as balance,
             greatest(provided - returned - spent, 0) as to_return,
             greatest(-(provided - returned - spent), 0) as overspend,
             personal + greatest(-(provided - returned - spent), 0) as owed
        from per)
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', u, 'name', pbx_name(u), 'advance_provided', provided, 'advance_spent', spent, 'returned', returned,
           'advance_balance', balance, 'advance_to_return', to_return, 'advance_overspend', overspend, 'personal_spent', personal,
           'reimbursement_owed', owed, 'reimbursement_paid', paid, 'reimbursement_outstanding', owed - paid) order by pbx_name(u)), '[]'::jsonb)
    into v_per from calc;

  select jsonb_build_object(
    'currency', b.currency,
    'approved_budget', pbx_baseline_total(b.id),
    'has_approved_actuals', exists (select 1 from pbx_actual_submissions where budget_id = b.id and status = 'approved'),
    'approved_actual_total', coalesce((select sum(r.actual_amount) from pbx_actual_rows r join pbx_actual_submissions s on s.id = r.submission_id
                                        where s.budget_id = b.id and s.status = 'approved'), 0),
    'advances_provided', coalesce((select sum(amount) from pbx_funding where budget_id = b.id and status = 'recorded' and is_advance), 0),
    'card_allocations', coalesce((select sum(amount) from pbx_funding where budget_id = b.id and status = 'recorded' and not is_advance), 0),
    'advance_spent', coalesce((select sum(r.actual_amount) from pbx_actual_rows r join pbx_actual_submissions s on s.id = r.submission_id
                                where s.budget_id = b.id and s.status = 'approved' and r.paid_via = 'advance'), 0),
    'company_card_spent', coalesce((select sum(r.actual_amount) from pbx_actual_rows r join pbx_actual_submissions s on s.id = r.submission_id
                                     where s.budget_id = b.id and s.status = 'approved' and r.paid_via = 'company_card'), 0),
    'direct_paid', coalesce((select sum(r.actual_amount) from pbx_actual_rows r join pbx_actual_submissions s on s.id = r.submission_id
                              where s.budget_id = b.id and s.status = 'approved' and r.paid_via = 'direct_company'), 0),
    'personal_spent', coalesce((select sum(r.actual_amount) from pbx_actual_rows r join pbx_actual_submissions s on s.id = r.submission_id
                                 where s.budget_id = b.id and s.status = 'approved' and r.paid_via = 'personal'), 0),
    'existing_claim_spent', coalesce((select sum(r.actual_amount) from pbx_actual_rows r join pbx_actual_submissions s on s.id = r.submission_id
                                       where s.budget_id = b.id and s.status = 'approved' and r.paid_via = 'existing_claim'), 0),
    'returned', coalesce((select sum((x->>'returned')::numeric) from jsonb_array_elements(v_per) x), 0),
    'reimbursement_owed', coalesce((select sum((x->>'reimbursement_owed')::numeric) from jsonb_array_elements(v_per) x), 0),
    'reimbursement_paid', coalesce((select sum((x->>'reimbursement_paid')::numeric) from jsonb_array_elements(v_per) x), 0),
    'advance_to_return', coalesce((select sum((x->>'advance_to_return')::numeric) from jsonb_array_elements(v_per) x), 0),
    'reimbursement_outstanding', coalesce((select sum(greatest((x->>'reimbursement_outstanding')::numeric, 0)) from jsonb_array_elements(v_per) x), 0),
    'overpaid_reimbursement', coalesce((select bool_or((x->>'reimbursement_outstanding')::numeric < 0) from jsonb_array_elements(v_per) x), false),
    'per_person', v_per
  ) into v_res;
  return v_res;
end;
$$;

-- The reasons settlement cannot be closed yet (empty array when it can). Mirrors settlementBlockers() in the domain package.
create or replace function pbx_settlement_blockers(p_budget_id uuid)
returns text[]
language plpgsql stable security definer
set search_path = public
as $$
declare
  b pbx_budgets;
  f jsonb;
  out text[] := '{}';
begin
  select * into b from pbx_budgets where id = p_budget_id;
  if not found then return array['Budget not found']; end if;
  if b.settlement_status = 'closed' then return array['Settlement is already closed.']; end if;
  f := pbx_settlement_figures(b.id);
  if not (f->>'has_approved_actuals')::boolean then out := array_append(out, 'The final expenses are not approved yet.'::text); end if;
  if exists (select 1 from pbx_actual_submissions where budget_id = b.id and status = 'submitted') then out := array_append(out, 'Final expenses are waiting for a Finance decision.'::text); end if;
  if exists (select 1 from pbx_budget_versions where budget_id = b.id and status = 'submitted') then out := array_append(out, 'A budget request is waiting for a Finance decision.'::text); end if;
  if b.receipts_status in ('not_received', 'partial') then
    out := array_append(out, 'Finance has not confirmed that the physical receipts were received (or recorded an approved exception).'::text);
  end if;
  if b.receipts_status = 'exception' and length(btrim(coalesce(b.receipts_exception_reason, ''))) = 0 then out := array_append(out, 'The receipt exception needs a recorded reason.'::text); end if;
  if (f->>'advance_to_return')::numeric > 0 then out := array_append(out, (pbx_money_text((f->>'advance_to_return')::numeric, b.currency) || ' of advance money has not been returned.')); end if;
  if (f->>'reimbursement_outstanding')::numeric > 0 then out := array_append(out, (pbx_money_text((f->>'reimbursement_outstanding')::numeric, b.currency) || ' of reimbursement is still owed.')); end if;
  if (f->>'overpaid_reimbursement')::boolean then out := array_append(out, 'A reimbursement was paid beyond what is owed: reverse the overpayment.'::text); end if;
  return out;
end;
$$;

-- The same figures for a caller who may read the budget (Finance, view grantee, current PM).
create or replace function pbx_settlement_summary(p_budget_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform pbx_require_user();
  if not pbx_can_read_budget(p_budget_id) then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  return pbx_settlement_figures(p_budget_id) || jsonb_build_object('blockers', to_jsonb(pbx_settlement_blockers(p_budget_id)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Funding (Finance)
-- -----------------------------------------------------------------------------
create or replace function pbx_record_funding(
  p_budget_id uuid, p_recipient uuid, p_funded_on date, p_amount numeric, p_method text, p_is_advance boolean,
  p_reference text, p_note text, p_request_id uuid
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  b pbx_budgets;
  v_id uuid;
  v_adv boolean;
  v_amount numeric;
begin
  b := pbx_lock_budget(p_budget_id);
  perform pbx_require_finance(b, 'record funds');
  if p_request_id is null then raise exception 'A request id is needed so a retry cannot record twice' using errcode = '22023'; end if;
  select id into v_id from pbx_funding where budget_id = b.id and request_id = p_request_id;
  if v_id is not null then return v_id; end if;                                  -- a retry or double click: same result
  perform pbx_require_open(b);
  if pbx_baseline_total(b.id) <= 0 then raise exception 'Approve the budget before recording funds' using errcode = '23514'; end if;
  if p_recipient is null or not pbx_project_person_ok(b.project_id, p_recipient) then
    raise exception 'The recipient must be the Project Manager or a current member of the project' using errcode = '22023';
  end if;
  if p_recipient = auth.uid() then raise exception 'You cannot record funds for yourself. Another Finance user must' using errcode = '42501'; end if;
  if p_method not in ('cash', 'bank_transfer', 'pluto', 'other') then raise exception 'Choose how the funds were provided' using errcode = '22023'; end if;
  if p_funded_on is null then raise exception 'Enter the date' using errcode = '22023'; end if;
  v_amount := pbx_amount(p_amount, b.currency, 'the amount');
  v_adv := case p_method when 'cash' then true when 'bank_transfer' then true when 'pluto' then false else p_is_advance end;
  if v_adv is null then raise exception 'Say whether this "other" funding is an advance held by the person, or a card allocation' using errcode = '22023'; end if;
  insert into pbx_funding (budget_id, company_id, project_id, recipient_user_id, recipient_name, funded_on, amount, currency, method, is_advance, reference, note, recorded_by, request_id)
  values (b.id, b.company_id, b.project_id, p_recipient, pbx_name(p_recipient), p_funded_on, v_amount, b.currency, p_method, v_adv,
          nullif(left(btrim(coalesce(p_reference, '')), 120), ''), nullif(left(btrim(coalesce(p_note, '')), 500), ''), auth.uid(), p_request_id)
  returning id into v_id;
  perform pbx_notify(p_recipient, 'project_funding_recorded', b, jsonb_build_object('funding_id', v_id, 'amount', v_amount, 'currency', b.currency, 'method', p_method, 'advance', v_adv), 'pbx-fund-' || v_id::text);
  perform pbx_notify(b.pm_user_id, 'project_funding_recorded', b, jsonb_build_object('funding_id', v_id, 'amount', v_amount, 'currency', b.currency, 'method', p_method, 'advance', v_adv), 'pbx-fund-' || v_id::text);
  return v_id;
end;
$$;

create or replace function pbx_reverse_funding(p_funding_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare f pbx_funding; b pbx_budgets; v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform pbx_require_user();
  select * into f from pbx_funding where id = p_funding_id;
  if not found then raise exception 'Funding entry not found' using errcode = 'P0002'; end if;
  b := pbx_lock_budget(f.budget_id);
  perform pbx_require_finance(b, 'reverse a funding entry');
  perform pbx_require_open(b);
  select * into f from pbx_funding where id = p_funding_id for update;
  if f.status = 'reversed' then raise exception 'This entry was already reversed' using errcode = '23514'; end if;
  if length(v_reason) < 3 then raise exception 'Give the reason for reversing this entry' using errcode = '22023'; end if;
  update pbx_funding set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = left(v_reason, 500) where id = f.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Actual expenses (the PM)
-- -----------------------------------------------------------------------------
-- The rows of every approved budget version (the original and each approved addition), in order: what actuals are compared with.
create or replace function pbx_baseline_rows(p_budget_id uuid)
returns setof pbx_budget_rows
language sql stable security definer
set search_path = public
as $$
  select r.* from pbx_budget_rows r join pbx_budget_versions v on v.id = r.version_id
   where v.budget_id = p_budget_id and v.status = 'approved' order by v.seq, r.sort_no;
$$;

create or replace function pbx_start_actuals(p_budget_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  b pbx_budgets;
  s pbx_actual_submissions;
  v_new uuid;
  v_seq integer;
begin
  b := pbx_lock_budget(p_budget_id);
  perform pbx_require_pm(b);
  perform pbx_require_open(b);
  if pbx_baseline_total(b.id) <= 0 then raise exception 'The budget must be approved before the final expenses are entered' using errcode = '23514'; end if;
  select * into s from pbx_actual_submissions where budget_id = b.id and status = 'draft';
  if found then return s.id; end if;
  if exists (select 1 from pbx_actual_submissions where budget_id = b.id and status = 'submitted') then raise exception 'The final expenses were already submitted' using errcode = '23514'; end if;
  if exists (select 1 from pbx_actual_submissions where budget_id = b.id and status = 'approved') then
    raise exception 'The final expenses are approved. Finance must send them back for correction before they can be changed' using errcode = '23514';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from pbx_actual_submissions where budget_id = b.id;
  insert into pbx_actual_submissions (budget_id, company_id, project_id, seq, total_approved_budget, created_by)
  values (b.id, b.company_id, b.project_id, v_seq, pbx_baseline_total(b.id), auth.uid())
  returning id into v_new;
  insert into pbx_actual_rows (submission_id, budget_id, company_id, sort_no, budget_row_id, line_no, category_key, category_label, description, approved_amount, unplanned)
  select v_new, b.id, b.company_id, row_number() over (order by v.seq, r.sort_no), r.id, 1, r.category_key, r.category_label, r.description, r.total, false
    from pbx_budget_rows r join pbx_budget_versions v on v.id = r.version_id
   where v.budget_id = b.id and v.status = 'approved';
  return v_new;
end;
$$;

-- Finance sent the actuals back (or they were returned at review): the PM continues from a new draft that copies the lines.
create or replace function pbx_revise_actuals(p_submission_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  s pbx_actual_submissions;
  b pbx_budgets;
  v_new uuid;
  v_seq integer;
begin
  perform pbx_require_user();
  select * into s from pbx_actual_submissions where id = p_submission_id;
  if not found then raise exception 'Final expenses not found' using errcode = 'P0002'; end if;
  b := pbx_lock_budget(s.budget_id);
  perform pbx_require_pm(b);
  perform pbx_require_open(b);
  if s.status <> 'returned' then raise exception 'Only returned final expenses can be revised' using errcode = '23514'; end if;
  if exists (select 1 from pbx_actual_submissions where budget_id = b.id and status in ('draft', 'submitted', 'approved')) then
    raise exception 'There are already final expenses in progress' using errcode = '23514';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from pbx_actual_submissions where budget_id = b.id;
  insert into pbx_actual_submissions (budget_id, company_id, project_id, seq, parent_submission_id, variance_note, total_approved_budget, reopened_after_approval, created_by)
  values (b.id, b.company_id, b.project_id, v_seq, s.id, s.variance_note, pbx_baseline_total(b.id), s.reopened_after_approval, auth.uid())
  returning id into v_new;
  insert into pbx_actual_rows (submission_id, budget_id, company_id, sort_no, budget_row_id, line_no, category_key, category_label, description, approved_amount,
                               actual_amount, paid_via, paid_by_user_id, paid_by_name, claim_id, foreign_currency, foreign_note, note, unplanned)
  select v_new, budget_id, company_id, sort_no, budget_row_id, line_no, category_key, category_label, description, approved_amount,
         actual_amount, paid_via, paid_by_user_id, paid_by_name, claim_id, foreign_currency, foreign_note, note, unplanned
    from pbx_actual_rows where submission_id = s.id;
  -- anything approved since (an addition) appears as a blank line
  insert into pbx_actual_rows (submission_id, budget_id, company_id, sort_no, budget_row_id, line_no, category_key, category_label, description, approved_amount, unplanned)
  select v_new, b.id, b.company_id, 1000 + r.sort_no, r.id, 1, r.category_key, r.category_label, r.description, r.total, false
    from pbx_baseline_rows(b.id) r
   where not exists (select 1 from pbx_actual_rows x where x.submission_id = v_new and x.budget_row_id = r.id);
  return v_new;
end;
$$;

-- p_header: {"variance_note","complete_confirmed"}; p_rows: [{budget_row_id|null, category_id (unplanned only), description (unplanned only), actual_amount|null,
--            paid_via, paid_by_user_id, claim_id, foreign_currency, foreign_note, note}]
create or replace function pbx_save_actuals_draft(p_submission_id uuid, p_expected integer, p_header jsonb, p_rows jsonb)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  s pbx_actual_submissions;
  b pbx_budgets;
  r jsonb;
  br pbx_budget_rows;
  c pbx_categories;
  v_n integer := 0;
  v_line integer;
  v_amount numeric;
  v_via text;
  v_by uuid;
  v_claim uuid;
  v_cat_key text;
  v_cat_label text;
  v_desc text;
  v_approved numeric;
  v_foreign boolean;
  v_fnote text;
  v_note text;
  v_total numeric;
  v_version integer;
  v_confirmed boolean := coalesce((p_header->>'complete_confirmed')::boolean, false);
begin
  perform pbx_require_user();
  select * into s from pbx_actual_submissions where id = p_submission_id for update;
  if not found then raise exception 'Final expenses not found' using errcode = 'P0002'; end if;
  select * into b from pbx_budgets where id = s.budget_id;
  perform pbx_require_pm(b);
  perform pbx_require_open(b);
  if s.status <> 'draft' then raise exception 'These final expenses are no longer a draft, so they cannot be edited' using errcode = '23514'; end if;
  perform pbx_check_version(s.row_version, p_expected, 'These final expenses');
  if p_rows is not null and jsonb_typeof(p_rows) <> 'array' then raise exception 'The lines are not valid' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 400 then raise exception 'There can be up to 400 lines' using errcode = '22023'; end if;

  delete from pbx_actual_rows where submission_id = s.id;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_amount := pbx_num(r->>'actual_amount', 'the actual amount');
    if v_amount is not null and pbx_round(v_amount, b.currency) <> v_amount then
      raise exception 'The actual amount on line % has more decimals than % allows', v_n, b.currency using errcode = '22023';
    end if;
    v_via := nullif(btrim(coalesce(r->>'paid_via', '')), '');
    if v_via is not null and v_via not in ('advance', 'company_card', 'direct_company', 'personal', 'existing_claim') then
      raise exception 'Choose how line % was paid', v_n using errcode = '22023';
    end if;
    if v_amount is not null and v_amount > 0 and v_via is null then
      raise exception 'Say how line % was paid', v_n using errcode = '22023';
    end if;
    v_by := nullif(r->>'paid_by_user_id', '')::uuid;
    if v_amount is not null and v_amount > 0 and v_via in ('advance', 'personal') then
      if v_by is null or not pbx_project_person_ok(b.project_id, v_by) then
        raise exception 'Say who paid line % (the Project Manager or a project member)', v_n using errcode = '22023';
      end if;
    elsif v_via not in ('advance', 'personal') then
      v_by := null;
    end if;
    v_claim := nullif(r->>'claim_id', '')::uuid;
    v_note := nullif(left(btrim(coalesce(r->>'note', '')), 500), '');
    if v_via = 'existing_claim' then
      if v_claim is not null and not exists (
           select 1 from reimbursement_claims cl join employees e on e.id = cl.employee_id
            where cl.id = v_claim and (e.user_id = auth.uid() or pbx_is_finance(b.company_id))) then
        raise exception 'That claim is not one you can link (it must be your own claim)' using errcode = '22023';
      end if;
      if v_claim is null and v_note is null then
        raise exception 'Give the reference of the employee claim for line %, or write it in the note', v_n using errcode = '22023';
      end if;
    else
      v_claim := null;
    end if;
    v_foreign := coalesce((r->>'foreign_currency')::boolean, false);
    v_fnote := nullif(left(btrim(coalesce(r->>'foreign_note', '')), 500), '');
    if v_foreign and v_fnote is null then
      raise exception 'Line % was paid in another currency: write the original amount, currency and rate in the note', v_n using errcode = '22023';
    end if;

    if nullif(r->>'budget_row_id', '') is not null then
      select * into br from pbx_baseline_rows(b.id) x where x.id = (r->>'budget_row_id')::uuid;
      if br.id is null then raise exception 'Line % refers to a budget row that is not part of the approved budget', v_n using errcode = '22023'; end if;
      select coalesce(max(line_no), 0) + 1 into v_line from pbx_actual_rows where submission_id = s.id and budget_row_id = br.id;
      v_cat_key := br.category_key; v_cat_label := br.category_label; v_desc := br.description;
      v_approved := case when v_line = 1 then br.total else 0 end;
      insert into pbx_actual_rows (submission_id, budget_id, company_id, sort_no, budget_row_id, line_no, category_key, category_label, description, approved_amount,
                                   actual_amount, paid_via, paid_by_user_id, paid_by_name, claim_id, foreign_currency, foreign_note, note, unplanned)
      values (s.id, b.id, b.company_id, v_n, br.id, v_line, v_cat_key, v_cat_label, v_desc, v_approved,
              v_amount, v_via, v_by, case when v_by is not null then pbx_name(v_by) end, v_claim, v_foreign, case when v_foreign then v_fnote end, v_note, false);
    else
      select * into c from pbx_categories where id = nullif(r->>'category_id', '')::uuid and is_active and (company_id is null or company_id = b.company_id);
      if not found then raise exception 'Choose a category for the unplanned expense on line %', v_n using errcode = '22023'; end if;
      v_desc := btrim(coalesce(r->>'description', ''));
      if length(v_desc) = 0 then raise exception 'Describe the unplanned expense on line %', v_n using errcode = '22023'; end if;
      insert into pbx_actual_rows (submission_id, budget_id, company_id, sort_no, budget_row_id, line_no, category_key, category_label, description, approved_amount,
                                   actual_amount, paid_via, paid_by_user_id, paid_by_name, claim_id, foreign_currency, foreign_note, note, unplanned)
      values (s.id, b.id, b.company_id, v_n, null, 1, c.key, c.label, left(v_desc, 300), 0,
              v_amount, v_via, v_by, case when v_by is not null then pbx_name(v_by) end, v_claim, v_foreign, case when v_foreign then v_fnote end, v_note, true);
    end if;
  end loop;

  -- every approved budget row stays on the page: a missing one comes back as a blank line (it cannot be hidden)
  insert into pbx_actual_rows (submission_id, budget_id, company_id, sort_no, budget_row_id, line_no, category_key, category_label, description, approved_amount, unplanned)
  select s.id, b.id, b.company_id, 1000 + r.sort_no, r.id, 1, r.category_key, r.category_label, r.description, r.total, false
    from pbx_baseline_rows(b.id) r
   where not exists (select 1 from pbx_actual_rows x where x.submission_id = s.id and x.budget_row_id = r.id);

  select coalesce(sum(actual_amount), 0) into v_total from pbx_actual_rows where submission_id = s.id;
  update pbx_actual_submissions
     set complete_confirmed = v_confirmed, variance_note = nullif(left(btrim(coalesce(p_header->>'variance_note', '')), 2000), ''),
         total_actual = v_total, total_approved_budget = pbx_baseline_total(b.id), row_version = row_version + 1
   where id = s.id
  returning row_version into v_version;
  return v_version;
end;
$$;

create or replace function pbx_submit_actuals(p_submission_id uuid, p_expected integer, p_request_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  s pbx_actual_submissions;
  b pbx_budgets;
  a uuid;
  v_blank text;
  v_base numeric;
  v_diff numeric;
begin
  perform pbx_require_user();
  if p_request_id is null then raise exception 'A request id is needed so a retry cannot submit twice' using errcode = '22023'; end if;
  select * into s from pbx_actual_submissions where id = p_submission_id for update;
  if not found then raise exception 'Final expenses not found' using errcode = 'P0002'; end if;
  select * into b from pbx_budgets where id = s.budget_id for update;
  perform pbx_require_pm(b);
  if s.status = 'submitted' and s.submit_request_id = p_request_id then return s.id; end if;   -- a retry or double click
  perform pbx_require_open(b);
  if s.status <> 'draft' then raise exception 'These final expenses were already submitted' using errcode = '23514'; end if;
  perform pbx_check_version(s.row_version, p_expected, 'These final expenses');
  if not s.complete_confirmed then raise exception 'Confirm that the actual expenses are complete before submitting' using errcode = '22023'; end if;
  select description into v_blank from pbx_actual_rows where submission_id = s.id and actual_amount is null order by sort_no limit 1;
  if v_blank is not null then
    raise exception 'No actual amount is entered for "%". Enter the amount, or 0 if nothing was spent', v_blank using errcode = '22023';
  end if;
  v_base := pbx_baseline_total(b.id);
  v_diff := abs(s.total_actual - v_base);
  if (v_base = 0 and s.total_actual > 0) or (v_base > 0 and v_diff * 100 > v_base * 10) then
    if length(btrim(coalesce(s.variance_note, ''))) < 3 then
      raise exception 'The total differs from the approved budget by more than 10%%: add a short note explaining why' using errcode = '22023';
    end if;
  end if;
  perform pbx_refresh_snapshot(b.id);
  update pbx_actual_submissions set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), submit_request_id = p_request_id,
         total_approved_budget = v_base, row_version = row_version + 1 where id = s.id;
  select * into b from pbx_budgets where id = b.id;
  for a in select pbx_finance_approvers(b.company_id, array[s.created_by, auth.uid()]) loop
    perform pbx_notify(a, 'project_actuals_submitted', b, jsonb_build_object('submission_id', s.id, 'total', s.total_actual, 'currency', b.currency), 'pbx-act-' || s.id::text);
  end loop;
  return s.id;
end;
$$;

-- Finance: approve or return the final expenses. Independent, reasoned, exactly once.
create or replace function pbx_decide_actuals(p_submission_id uuid, p_decision text, p_note text default null)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  s pbx_actual_submissions;
  b pbx_budgets;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_new text;
begin
  perform pbx_require_user();
  select * into s from pbx_actual_submissions where id = p_submission_id for update;
  if not found then raise exception 'Final expenses not found' using errcode = 'P0002'; end if;
  select * into b from pbx_budgets where id = s.budget_id for update;
  perform pbx_require_finance(b, 'decide on final expenses');
  if p_decision not in ('approve', 'return') then raise exception 'Choose approve or return' using errcode = '22023'; end if;
  perform pbx_require_open(b);
  if s.status <> 'submitted' then
    raise exception 'These final expenses have already been decided (%, by %)', s.status, coalesce(pbx_name(s.decided_by), 'someone') using errcode = '23514';
  end if;
  if auth.uid() = s.created_by or auth.uid() = s.submitted_by then
    raise exception 'You cannot decide final expenses you prepared or submitted. Another Finance approver must decide them' using errcode = '42501';
  end if;
  if p_decision = 'return' and (v_note is null or length(v_note) < 3) then
    raise exception 'Give the reason, so the Project Manager knows what to correct' using errcode = '22023';
  end if;
  v_new := case p_decision when 'approve' then 'approved' else 'returned' end;
  update pbx_actual_submissions set status = v_new, decided_by = auth.uid(), decided_at = now(), decision_note = v_note, row_version = row_version + 1 where id = s.id;
  perform pbx_notify(s.submitted_by, 'project_actuals_decided', b, jsonb_build_object('submission_id', s.id, 'decision', v_new, 'note', v_note), 'pbx-actdec-' || s.id::text);
  perform pbx_notify(b.pm_user_id, 'project_actuals_decided', b, jsonb_build_object('submission_id', s.id, 'decision', v_new, 'note', v_note), 'pbx-actdec-' || s.id::text);
  return v_new;
end;
$$;

-- Finance sends already-approved final expenses back for an audited correction (settlement must be open).
create or replace function pbx_return_approved_actuals(p_submission_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  s pbx_actual_submissions;
  b pbx_budgets;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform pbx_require_user();
  select * into s from pbx_actual_submissions where id = p_submission_id for update;
  if not found then raise exception 'Final expenses not found' using errcode = 'P0002'; end if;
  select * into b from pbx_budgets where id = s.budget_id for update;
  perform pbx_require_finance(b, 'send approved final expenses back');
  perform pbx_require_open(b);
  if s.status <> 'approved' then raise exception 'Only approved final expenses can be sent back for correction' using errcode = '23514'; end if;
  if length(v_reason) < 3 then raise exception 'Give the reason for the correction' using errcode = '22023'; end if;
  update pbx_actual_submissions set status = 'returned', decided_by = auth.uid(), decided_at = now(), decision_note = left(v_reason, 500),
         reopened_after_approval = true, row_version = row_version + 1 where id = s.id;
  perform pbx_notify(s.submitted_by, 'project_actuals_decided', b, jsonb_build_object('submission_id', s.id, 'decision', 'returned', 'note', v_reason), 'pbx-actdec-' || s.id::text);
  perform pbx_notify(b.pm_user_id, 'project_actuals_decided', b, jsonb_build_object('submission_id', s.id, 'decision', 'returned', 'note', v_reason), 'pbx-actdec-' || s.id::text);
end;
$$;

-- -----------------------------------------------------------------------------
-- Receipts, returns, reimbursements, closing (Finance)
-- -----------------------------------------------------------------------------
create or replace function pbx_record_receipts(p_budget_id uuid, p_status text, p_received_on date default null, p_exception_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare b pbx_budgets; v_reason text := nullif(btrim(coalesce(p_exception_reason, '')), '');
begin
  b := pbx_lock_budget(p_budget_id);
  perform pbx_require_finance(b, 'record the receipt status');
  perform pbx_require_open(b);
  if p_status not in ('not_received', 'partial', 'received', 'exception') then raise exception 'Choose a receipt status' using errcode = '22023'; end if;
  if pbx_is_actuals_author(b.id, auth.uid()) then
    raise exception 'You cannot record the receipt status for expenses you prepared or submitted' using errcode = '42501';
  end if;
  if p_status = 'exception' and (v_reason is null or length(v_reason) < 3) then
    raise exception 'A receipt exception needs a recorded reason' using errcode = '22023';
  end if;
  update pbx_budgets
     set receipts_status = p_status, receipts_received_on = case when p_status in ('partial', 'received') then coalesce(p_received_on, current_date) else null end,
         receipts_exception_reason = case when p_status = 'exception' then left(v_reason, 500) else null end,
         receipts_recorded_by = auth.uid(), receipts_recorded_at = now(), row_version = row_version + 1
   where id = b.id;
end;
$$;

create or replace function pbx_record_payment(
  p_budget_id uuid, p_kind text, p_person uuid, p_amount numeric, p_paid_on date, p_method text, p_reference text, p_note text, p_request_id uuid
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  b pbx_budgets;
  v_id uuid;
  v_amount numeric;
  f jsonb;
  pp jsonb;
  v_limit numeric;
begin
  b := pbx_lock_budget(p_budget_id);
  perform pbx_require_finance(b, 'record money returned or a reimbursement');
  if p_request_id is null then raise exception 'A request id is needed so a retry cannot record twice' using errcode = '22023'; end if;
  select id into v_id from pbx_payments where budget_id = b.id and request_id = p_request_id;
  if v_id is not null then return v_id; end if;                                  -- a retry or double click: same result
  perform pbx_require_open(b);
  if p_kind not in ('return', 'reimbursement') then raise exception 'Choose money returned or a reimbursement' using errcode = '22023'; end if;
  if p_method not in ('cash', 'bank_transfer', 'pluto', 'other') then raise exception 'Choose how it was paid' using errcode = '22023'; end if;
  if p_paid_on is null then raise exception 'Enter the date' using errcode = '22023'; end if;
  if p_person = auth.uid() then raise exception 'You cannot record a payment to or from yourself. Another Finance user must' using errcode = '42501'; end if;
  f := pbx_settlement_figures(b.id);
  if not (f->>'has_approved_actuals')::boolean then raise exception 'The final expenses must be approved before returns and reimbursements are recorded' using errcode = '23514'; end if;
  select x into pp from jsonb_array_elements(f->'per_person') x where (x->>'user_id')::uuid = p_person;
  if pp is null then raise exception 'That person has no advance to return and no reimbursement owed on this project' using errcode = '22023'; end if;
  v_amount := pbx_amount(p_amount, b.currency, 'the amount');
  if p_kind = 'return' then
    v_limit := (pp->>'advance_to_return')::numeric;
    if v_amount > v_limit then raise exception 'That is more than the advance still held (%)', pbx_money_text(v_limit, b.currency) using errcode = '22023'; end if;
  else
    v_limit := greatest((pp->>'reimbursement_outstanding')::numeric, 0);
    if v_amount > v_limit then raise exception 'That is more than the reimbursement still owed (%)', pbx_money_text(v_limit, b.currency) using errcode = '22023'; end if;
  end if;
  insert into pbx_payments (budget_id, company_id, project_id, kind, person_user_id, person_name, amount, paid_on, method, reference, note, recorded_by, request_id)
  values (b.id, b.company_id, b.project_id, p_kind, p_person, pbx_name(p_person), v_amount, p_paid_on, p_method,
          nullif(left(btrim(coalesce(p_reference, '')), 120), ''), nullif(left(btrim(coalesce(p_note, '')), 500), ''), auth.uid(), p_request_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function pbx_reverse_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare p pbx_payments; b pbx_budgets; v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform pbx_require_user();
  select * into p from pbx_payments where id = p_payment_id;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  b := pbx_lock_budget(p.budget_id);
  perform pbx_require_finance(b, 'reverse a payment entry');
  perform pbx_require_open(b);
  select * into p from pbx_payments where id = p_payment_id for update;
  if p.status = 'reversed' then raise exception 'This entry was already reversed' using errcode = '23514'; end if;
  if length(v_reason) < 3 then raise exception 'Give the reason for reversing this entry' using errcode = '22023'; end if;
  update pbx_payments set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = left(v_reason, 500) where id = p.id;
end;
$$;

create or replace function pbx_close_settlement(p_budget_id uuid, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b pbx_budgets;
  v_blockers text[];
begin
  b := pbx_lock_budget(p_budget_id);
  perform pbx_require_finance(b, 'close settlement');
  if b.settlement_status = 'closed' then return; end if;                          -- a retry: already closed
  if pbx_is_actuals_author(b.id, auth.uid()) then
    raise exception 'You cannot close settlement for expenses you prepared or submitted' using errcode = '42501';
  end if;
  v_blockers := pbx_settlement_blockers(b.id);
  if array_length(v_blockers, 1) is not null then
    raise exception 'Settlement cannot be closed yet: %', array_to_string(v_blockers, ' ') using errcode = '23514';
  end if;
  update pbx_budgets set settlement_status = 'closed', settlement_closed_at = now(), settlement_closed_by = auth.uid(),
         settlement_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), row_version = row_version + 1 where id = b.id;
  perform pbx_notify(b.pm_user_id, 'project_settlement_closed', b, '{}'::jsonb, 'pbx-closed-' || b.id::text);
end;
$$;

create or replace function pbx_reopen_settlement(p_budget_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare b pbx_budgets; v_reason text := btrim(coalesce(p_reason, ''));
begin
  b := pbx_lock_budget(p_budget_id);
  perform pbx_require_finance(b, 'reopen settlement');
  if b.settlement_status <> 'closed' then raise exception 'Settlement is not closed' using errcode = '23514'; end if;
  if length(v_reason) < 3 then raise exception 'Give the reason for reopening settlement' using errcode = '22023'; end if;
  update pbx_budgets set settlement_status = 'open', settlement_closed_at = null, settlement_closed_by = null,
         settlement_note = 'Reopened: ' || left(v_reason, 480), row_version = row_version + 1 where id = b.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  pbx_money_text(numeric, text), pbx_amount(numeric, text, text, boolean), pbx_is_actuals_author(uuid, uuid), pbx_settlement_figures(uuid),
  pbx_settlement_blockers(uuid), pbx_baseline_rows(uuid),
  pbx_settlement_summary(uuid),
  pbx_record_funding(uuid, uuid, date, numeric, text, boolean, text, text, uuid), pbx_reverse_funding(uuid, text),
  pbx_start_actuals(uuid), pbx_revise_actuals(uuid), pbx_save_actuals_draft(uuid, integer, jsonb, jsonb), pbx_submit_actuals(uuid, integer, uuid),
  pbx_decide_actuals(uuid, text, text), pbx_return_approved_actuals(uuid, text),
  pbx_record_receipts(uuid, text, date, text), pbx_record_payment(uuid, text, uuid, numeric, date, text, text, text, uuid), pbx_reverse_payment(uuid, text),
  pbx_close_settlement(uuid, text), pbx_reopen_settlement(uuid, text)
  from public, anon, authenticated;
grant execute on function
  pbx_settlement_summary(uuid),
  pbx_record_funding(uuid, uuid, date, numeric, text, boolean, text, text, uuid), pbx_reverse_funding(uuid, text),
  pbx_start_actuals(uuid), pbx_revise_actuals(uuid), pbx_save_actuals_draft(uuid, integer, jsonb, jsonb), pbx_submit_actuals(uuid, integer, uuid),
  pbx_decide_actuals(uuid, text, text), pbx_return_approved_actuals(uuid, text),
  pbx_record_receipts(uuid, text, date, text), pbx_record_payment(uuid, text, uuid, numeric, date, text, text, text, uuid), pbx_reverse_payment(uuid, text),
  pbx_close_settlement(uuid, text), pbx_reopen_settlement(uuid, text)
  to authenticated;

-- ROLLBACK: see supabase/manual-sql/pbx_90_rollback.sql.
