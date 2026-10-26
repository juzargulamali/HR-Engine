-- Project Budget & Expenses, migration 5 of 5: what the pages read.
--
-- One read function per screen, each SECURITY DEFINER with its own access check, so the screens never join tables the caller could not
-- read and Finance (who needs no Projects access, and gains none) sees names from the budget's own snapshot:
--   pbx_project_access(project)  does the caller have a Budget & Expenses entry on this project?  (drives the project tab)
--   pbx_budget_view(project)     everything one budget shows: project header, versions and rows, funding, actuals, payments,
--                                settlement figures and blockers, categories and rates, project people
--   pbx_inbox()                  the Finance inbox across every company the caller can read
-- Access is the same in every one: Finance / view grantees of the company, the CURRENT PM, and (read-only, own versions only) a prior submitter.
-- Nothing is returned that the tables' own RLS would hide from that caller.

create or replace function pbx_project_access(p_project_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  pr proj_projects;
  b pbx_budgets;
  v_pm boolean;
begin
  perform pbx_require_user();
  select * into pr from proj_projects where id = p_project_id;
  if not found then return jsonb_build_object('can_open', false); end if;
  v_pm := proj_is_pm(p_project_id);
  select * into b from pbx_budgets where project_id = p_project_id;
  return jsonb_build_object(
    'can_open', v_pm or (b.id is not null and pbx_can_read_budget_header(b.id)),
    'is_pm', v_pm,
    'has_budget', b.id is not null,
    'budget_id', b.id);
end;
$$;

create or replace function pbx_budget_view(p_project_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  pr proj_projects;
  d proj_project_details;
  b pbx_budgets;
  v_pm boolean;
  v_full boolean;
  v_fin boolean;
  v_view boolean;
  v_company_name text;
  v_default_currency text;
  v_project jsonb;
  v_versions jsonb := '[]'::jsonb;
  v_actuals jsonb := '[]'::jsonb;
  v_funding jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_settlement jsonb := null;
  v_people jsonb;
  v_cats jsonb;
  v_rates jsonb := '[]'::jsonb;
  v_me uuid := auth.uid();
begin
  perform pbx_require_user();
  select * into pr from proj_projects where id = p_project_id;
  if not found then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  select * into d from proj_project_details where project_id = p_project_id;
  v_pm := proj_is_pm(p_project_id);
  select * into b from pbx_budgets where project_id = p_project_id;
  if b.id is null and not v_pm then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  if b.id is not null and not pbx_can_read_budget_header(b.id) then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  v_full := b.id is null or pbx_can_read_budget(b.id);          -- PM, Finance or view grantee: everything; a prior submitter: own versions only
  v_fin := pbx_is_finance(pr.company_id);
  v_view := not v_fin and pbx_has_capability(pr.company_id, 'view');
  select legal_name, default_currency into v_company_name, v_default_currency from companies where id = pr.company_id;

  if b.id is null then
    v_project := jsonb_build_object('id', pr.id, 'reference', pr.reference, 'name', pr.name, 'company_id', pr.company_id, 'company_name', v_company_name,
      'pm_user_id', pr.pm_user_id, 'pm_name', proj_display_name(pr.pm_user_id), 'location', d.location, 'site_timezone', d.site_timezone,
      'start', pr.start_date, 'end', pr.end_date, 'install_start', d.install_start, 'event_start', d.event_start, 'event_end', d.event_end, 'status', pr.status);
  else
    v_project := jsonb_build_object('id', b.project_id, 'reference', b.project_reference, 'name', b.project_name, 'company_id', b.company_id, 'company_name', v_company_name,
      'pm_user_id', b.pm_user_id, 'pm_name', b.pm_name, 'location', b.location, 'site_timezone', b.site_timezone,
      'start', b.project_start, 'end', b.project_end, 'install_start', b.install_start, 'event_start', b.event_start, 'event_end', b.event_end, 'status', pr.status);
    -- the live project fields win while the PM or a Finance reader looks, so a changed date shows without waiting for the next submission
    if v_pm then
      v_project := v_project || jsonb_build_object('pm_user_id', pr.pm_user_id, 'pm_name', proj_display_name(pr.pm_user_id), 'location', d.location, 'site_timezone', d.site_timezone,
        'start', pr.start_date, 'end', pr.end_date, 'install_start', d.install_start, 'event_start', d.event_start, 'event_end', d.event_end);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'key', c.key, 'label', c.label, 'is_default', c.is_default) order by c.sort_no, c.label), '[]'::jsonb)
    into v_cats from pbx_categories c where c.is_active and (c.company_id is null or c.company_id = pr.company_id);

  select coalesce(jsonb_agg(jsonb_build_object('id', x.user_id, 'name', proj_display_name(x.user_id), 'role', x.role) order by proj_display_name(x.user_id)), '[]'::jsonb)
    into v_people
    from (select pr.pm_user_id as user_id, 'pm' as role
          union
          select m.user_id, m.role from proj_project_members m
           join profiles p on p.id = m.user_id and p.is_active
           where m.project_id = pr.id and m.removed_at is null and m.user_id <> pr.pm_user_id) x;

  if b.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('rate_key', r.rate_key, 'amount', r.amount, 'currency', r.currency)), '[]'::jsonb)
      into v_rates from pbx_rates r where r.company_id = b.company_id and r.currency = b.currency;

    select coalesce(jsonb_agg(vj order by (vj->>'seq')::int), '[]'::jsonb) into v_versions from (
      select jsonb_build_object(
        'id', v.id, 'kind', v.kind, 'seq', v.seq, 'status', v.status, 'parent_version_id', v.parent_version_id,
        'period_start', v.period_start, 'period_end', v.period_end, 'note', v.note, 'total', v.total, 'row_version', v.row_version,
        'created_by', v.created_by, 'created_by_name', pbx_name(v.created_by), 'created_at', v.created_at,
        'submitted_by', v.submitted_by, 'submitted_by_name', pbx_name(v.submitted_by), 'submitted_at', v.submitted_at,
        'decided_by_name', pbx_name(v.decided_by), 'decided_at', v.decided_at, 'decision_note', v.decision_note,
        'on_hold', v.status = 'submitted' and pbx_approval_on_hold(v.company_id, v.created_by, v.submitted_by),
        'i_can_decide', v.status = 'submitted' and v_fin and v_me <> v.created_by and v_me <> coalesce(v.submitted_by, v_me),
        'people', coalesce((select jsonb_agg(jsonb_build_object('id', u, 'name', pbx_name(u))) from unnest(v.people) u), '[]'::jsonb),
        'rows', coalesce((select jsonb_agg(jsonb_build_object(
            'id', r.id, 'sort_no', r.sort_no, 'category_id', r.category_id, 'category_key', r.category_key, 'category_label', r.category_label,
            'date_from', r.date_from, 'date_to', r.date_to, 'activity', r.activity, 'description', r.description, 'basis', r.basis,
            'people', r.people, 'days', r.days, 'qty', r.qty, 'rate', r.rate, 'fixed', r.fixed, 'rate_key', r.rate_key,
            'configured_rate', r.configured_rate, 'total', r.total) order by r.sort_no)
          from pbx_budget_rows r where r.version_id = v.id), '[]'::jsonb)
      ) as vj
      from pbx_budget_versions v
      where v.budget_id = b.id and v.status <> 'discarded'
        and (v_full or v.created_by = v_me or v.submitted_by = v_me)
    ) q;

    select coalesce(jsonb_agg(aj order by (aj->>'seq')::int), '[]'::jsonb) into v_actuals from (
      select jsonb_build_object(
        'id', s.id, 'seq', s.seq, 'status', s.status, 'parent_submission_id', s.parent_submission_id, 'complete_confirmed', s.complete_confirmed,
        'variance_note', s.variance_note, 'total_actual', s.total_actual, 'total_approved_budget', s.total_approved_budget,
        'reopened_after_approval', s.reopened_after_approval, 'row_version', s.row_version,
        'created_by', s.created_by, 'created_by_name', pbx_name(s.created_by), 'submitted_by', s.submitted_by, 'submitted_by_name', pbx_name(s.submitted_by),
        'submitted_at', s.submitted_at, 'decided_by_name', pbx_name(s.decided_by), 'decided_at', s.decided_at, 'decision_note', s.decision_note,
        'on_hold', s.status = 'submitted' and pbx_approval_on_hold(s.company_id, s.created_by, s.submitted_by),
        'i_can_decide', s.status = 'submitted' and v_fin and v_me <> s.created_by and v_me <> coalesce(s.submitted_by, v_me),
        'rows', coalesce((select jsonb_agg(jsonb_build_object(
            'id', r.id, 'sort_no', r.sort_no, 'budget_row_id', r.budget_row_id, 'line_no', r.line_no, 'category_key', r.category_key,
            'category_label', r.category_label, 'description', r.description, 'approved_amount', r.approved_amount, 'actual_amount', r.actual_amount,
            'paid_via', r.paid_via, 'paid_by_user_id', r.paid_by_user_id, 'paid_by_name', r.paid_by_name, 'claim_id', r.claim_id,
            'foreign_currency', r.foreign_currency, 'foreign_note', r.foreign_note, 'note', r.note, 'unplanned', r.unplanned) order by r.sort_no)
          from pbx_actual_rows r where r.submission_id = s.id), '[]'::jsonb)
      ) as aj
      from pbx_actual_submissions s
      where s.budget_id = b.id and (v_full or s.created_by = v_me or s.submitted_by = v_me)
    ) q;

    if v_full then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'recipient_user_id', f.recipient_user_id, 'recipient_name', f.recipient_name, 'funded_on', f.funded_on, 'amount', f.amount,
        'method', f.method, 'is_advance', f.is_advance, 'reference', f.reference, 'note', f.note, 'status', f.status, 'reversal_reason', f.reversal_reason,
        'recorded_by_name', pbx_name(f.recorded_by), 'recorded_at', f.recorded_at, 'reversed_by_name', pbx_name(f.reversed_by), 'reversed_at', f.reversed_at)
        order by f.funded_on, f.recorded_at), '[]'::jsonb) into v_funding from pbx_funding f where f.budget_id = b.id;
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'person_user_id', p.person_user_id, 'person_name', p.person_name, 'amount', p.amount, 'paid_on', p.paid_on,
        'method', p.method, 'reference', p.reference, 'note', p.note, 'status', p.status, 'reversal_reason', p.reversal_reason,
        'recorded_by_name', pbx_name(p.recorded_by), 'recorded_at', p.recorded_at, 'reversed_by_name', pbx_name(p.reversed_by), 'reversed_at', p.reversed_at)
        order by p.paid_on, p.recorded_at), '[]'::jsonb) into v_payments from pbx_payments p where p.budget_id = b.id;
      v_settlement := pbx_settlement_figures(b.id) || jsonb_build_object('blockers', to_jsonb(pbx_settlement_blockers(b.id)));
    end if;
  end if;

  return jsonb_build_object(
    'viewer', jsonb_build_object('user_id', v_me, 'is_pm', v_pm, 'is_finance', v_fin, 'is_view_only', v_view, 'is_full_reader', v_full),
    'project', v_project,
    'default_currency', v_default_currency,
    'budget', case when b.id is null then null else jsonb_build_object(
      'id', b.id, 'currency', b.currency, 'receipts_status', b.receipts_status, 'receipts_received_on', b.receipts_received_on,
      'receipts_exception_reason', b.receipts_exception_reason, 'receipts_recorded_by_name', pbx_name(b.receipts_recorded_by), 'receipts_recorded_at', b.receipts_recorded_at,
      'settlement_status', b.settlement_status, 'settlement_closed_at', b.settlement_closed_at, 'settlement_closed_by_name', pbx_name(b.settlement_closed_by),
      'settlement_note', b.settlement_note, 'row_version', b.row_version) end,
    'baseline', case when b.id is null then 0 else pbx_baseline_total(b.id) end,
    'versions', v_versions,
    'actuals', v_actuals,
    'funding', v_funding,
    'payments', v_payments,
    'settlement', v_settlement,
    'categories', v_cats,
    'rates', v_rates,
    'people', v_people);
end;
$$;

-- The Finance inbox: three lists across every company the caller can read (Finance decides; a view grantee only sees).
create or replace function pbx_inbox()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_budgets jsonb;
  v_actuals jsonb;
  v_settle jsonb;
  v_companies jsonb;
begin
  perform pbx_require_user();
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.legal_name, 'can_decide', pbx_is_finance(c.id)) order by c.legal_name), '[]'::jsonb)
    into v_companies from companies c where c.id in (select pbx_accessible_company_ids());

  select coalesce(jsonb_agg(jsonb_build_object(
      'budget_id', b.id, 'project_id', b.project_id, 'reference', b.project_reference, 'name', b.project_name, 'company_id', b.company_id,
      'company_name', c.legal_name, 'currency', b.currency, 'pm_name', b.pm_name, 'site_timezone', b.site_timezone, 'version_id', v.id, 'kind', v.kind, 'seq', v.seq, 'total', v.total,
      'submitted_at', v.submitted_at, 'submitted_by_name', pbx_name(v.submitted_by),
      'on_hold', pbx_approval_on_hold(v.company_id, v.created_by, v.submitted_by),
      'i_can_decide', pbx_is_finance(v.company_id) and v_me <> v.created_by and v_me <> coalesce(v.submitted_by, v_me)) order by v.submitted_at), '[]'::jsonb)
    into v_budgets
    from pbx_budget_versions v join pbx_budgets b on b.id = v.budget_id join companies c on c.id = b.company_id
   where v.status = 'submitted' and v.company_id in (select pbx_accessible_company_ids());

  select coalesce(jsonb_agg(jsonb_build_object(
      'budget_id', b.id, 'project_id', b.project_id, 'reference', b.project_reference, 'name', b.project_name, 'company_id', b.company_id,
      'company_name', c.legal_name, 'currency', b.currency, 'pm_name', b.pm_name, 'site_timezone', b.site_timezone, 'submission_id', s.id, 'seq', s.seq, 'total_actual', s.total_actual,
      'total_approved_budget', s.total_approved_budget, 'submitted_at', s.submitted_at, 'submitted_by_name', pbx_name(s.submitted_by),
      'on_hold', pbx_approval_on_hold(s.company_id, s.created_by, s.submitted_by),
      'i_can_decide', pbx_is_finance(s.company_id) and v_me <> s.created_by and v_me <> coalesce(s.submitted_by, v_me)) order by s.submitted_at), '[]'::jsonb)
    into v_actuals
    from pbx_actual_submissions s join pbx_budgets b on b.id = s.budget_id join companies c on c.id = b.company_id
   where s.status = 'submitted' and s.company_id in (select pbx_accessible_company_ids());

  select coalesce(jsonb_agg(jsonb_build_object(
      'budget_id', b.id, 'project_id', b.project_id, 'reference', b.project_reference, 'name', b.project_name, 'company_id', b.company_id,
      'company_name', c.legal_name, 'currency', b.currency, 'pm_name', b.pm_name, 'site_timezone', b.site_timezone, 'receipts_status', b.receipts_status,
      'approved_budget', f->>'approved_budget', 'approved_actual_total', f->>'approved_actual_total', 'has_approved_actuals', (f->>'has_approved_actuals')::boolean,
      'advance_to_return', f->>'advance_to_return', 'reimbursement_outstanding', f->>'reimbursement_outstanding',
      'advances_provided', f->>'advances_provided',
      'next', case
        when not (f->>'has_approved_actuals')::boolean then 'Waiting for the final expenses'
        else coalesce((pbx_settlement_blockers(b.id))[1], 'Ready to close') end) order by b.project_reference), '[]'::jsonb)
    into v_settle
    from pbx_budgets b join companies c on c.id = b.company_id
    cross join lateral (select pbx_settlement_figures(b.id) as f) q
   where b.settlement_status = 'open' and b.company_id in (select pbx_accessible_company_ids())
     and (pbx_baseline_total(b.id) > 0 or exists (select 1 from pbx_funding fu where fu.budget_id = b.id and fu.status = 'recorded'));

  return jsonb_build_object(
    'companies', v_companies,
    'budget_approvals', v_budgets,
    'final_expense_approvals', v_actuals,
    'outstanding_settlement', v_settle,
    'is_finance_anywhere', exists (select 1 from pbx_finance_company_ids()));
end;
$$;

revoke all on function pbx_project_access(uuid), pbx_budget_view(uuid), pbx_inbox() from public, anon, authenticated;
grant execute on function pbx_project_access(uuid), pbx_budget_view(uuid), pbx_inbox() to authenticated;

-- ROLLBACK: see supabase/manual-sql/pbx_90_rollback.sql.
