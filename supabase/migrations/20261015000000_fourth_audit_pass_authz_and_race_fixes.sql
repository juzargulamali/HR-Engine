-- Fourth audit pass: closes remaining authorization-bypass and concurrency
-- (race-condition) bugs found by a follow-up review. Mirrors the shape of
-- the third pass's migration — each fix is independent and safe to apply
-- as one transaction.

-- 1. reimbursement_claims.total_amount was fully client-writable: the
--    lines-recompute trigger only fires on reimbursement_claim_lines, never
--    on the claim row itself, so nothing stopped an employee setting
--    total_amount directly — a value that flows straight into
--    generate_payroll_export_lines()'s payroll export, or that could be
--    deflated to dodge an amount-gated approval step.
create or replace function guard_reimbursement_claim_total()
returns trigger
language plpgsql
as $$
begin
  new.total_amount := coalesce((select sum(amount) from reimbursement_claim_lines where claim_id = new.id), 0);
  return new;
end;
$$;

create trigger reimbursement_claims_guard_total before insert or update on reimbursement_claims
  for each row execute function guard_reimbursement_claim_total();

-- 2. leave_requests.total_days had no floor: decide_leave_approval()'s
--    deduction loop starts with v_remaining := total_days and exits
--    immediately once v_remaining <= 0, so a zero/negative value (reachable
--    via a raw insert bypassing the app's own computeLeaveDays() check)
--    approved a request with zero ledger entries posted -- unaccounted,
--    unlimited "free" leave.
alter table leave_requests add constraint leave_requests_total_days_check check (total_days > 0);

-- 3. generate_payroll_export_lines()'s only anti-double-claim mechanism was
--    a plain "not exists" check with no backing constraint and no locking,
--    so two overlapping calls (e.g. two different-period draft runs for the
--    same company racing on the same pool of approved reimbursement
--    claims, or a double-clicked "re-check for new lines") could both see
--    a source row as "not yet exported" and both insert an export line for
--    it -- double-paying the employee once both runs were sent.
create unique index payroll_export_lines_source_uniq on payroll_export_lines(source_reference_type, source_reference_id);

create or replace function generate_payroll_export_lines(p_run_id uuid)
returns setof payroll_export_lines
language plpgsql
as $$
declare
  v_company_id uuid;
  v_period_start date;
  v_period_end date;
begin
  select company_id, make_date(period_year, period_month, 1), (make_date(period_year, period_month, 1) + interval '1 month - 1 day')::date
  into v_company_id, v_period_start, v_period_end
  from payroll_export_runs where id = p_run_id;

  return query
  insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, source_reference_type, source_reference_id)
  select p_run_id, c.employee_id, 'reimbursement', c.total_amount, c.currency, 'reimbursement_claim', c.id
  from reimbursement_claims c
  join employees e on e.id = c.employee_id
  where e.company_id = v_company_id
    and c.status = 'approved'
    and not exists (
      select 1 from payroll_export_lines l where l.source_reference_type = 'reimbursement_claim' and l.source_reference_id = c.id
    )
  union all
  select p_run_id, l.employee_id, 'leave_encashment', l.amount_days, comp.currency, 'leave_ledger', l.id
  from leave_ledger l
  join employees e on e.id = l.employee_id
  join compensation_details comp on comp.employee_id = e.id and comp.is_current = true
  where e.company_id = v_company_id
    and l.entry_type = 'encashment'
    and l.txn_date between v_period_start and v_period_end
    and not exists (
      select 1 from payroll_export_lines pl where pl.source_reference_type = 'leave_ledger' and pl.source_reference_id = l.id
    )
  on conflict (source_reference_type, source_reference_id) do nothing
  returning *;
end;
$$;

-- 4. comp_day_ledger's balance read inside decide_leave_approval() had no
--    lock: two different, independent leave requests for the SAME employee
--    finalized concurrently (two approvers, or one approver clicking
--    through two pending items quickly) could both read the same SUM
--    before either committed its deduction, letting both draw from what
--    looked like an independent full balance and overdraw it.
--
-- 5. bulkRecordAttendance()'s "already credited" check was the same
--    shape (a SELECT immediately followed by an INSERT, no lock) -- two
--    concurrent saves for the same attendance record could both pass it
--    and both insert an 'earned' comp-day credit, doubling the day.
create unique index comp_day_ledger_attendance_uniq on comp_day_ledger(reference_id) where reference_type = 'attendance_record';

create or replace function decide_leave_approval(p_approval_id uuid, p_decision approval_decision, p_comments text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval approvals%rowtype;
  v_employee_id uuid;
  v_requester_user_id uuid;
  v_amount numeric(12,2);
  v_leave_request leave_requests%rowtype;
  v_remaining numeric(6,2);
  v_rule record;
  v_available numeric(6,2);
  v_draw numeric(6,2);
  v_timesheet timesheets%rowtype;
  v_payroll_company_id uuid;
  v_step record;
  v_next_approver uuid;
  v_found_next boolean := false;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be ''approved'' or ''rejected''';
  end if;

  select * into v_approval from approvals where id = p_approval_id for update;
  if not found then
    raise exception 'Approval not found';
  end if;
  if auth.uid() is not null and v_approval.approver_id <> auth.uid() then
    raise exception 'Only the assigned approver may decide this';
  end if;
  if v_approval.decision <> 'pending' then
    raise exception 'This approval has already been decided';
  end if;

  update approvals set decision = p_decision, decided_at = now(), comments = p_comments where id = p_approval_id;

  if v_approval.entity_type = 'leave_request' then
    select * into v_leave_request from leave_requests where id = v_approval.entity_id for update;
    v_employee_id := v_leave_request.employee_id;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'reimbursement_claim' then
    select employee_id, total_amount into v_employee_id, v_amount
    from reimbursement_claims where id = v_approval.entity_id for update;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'timesheet' then
    select * into v_timesheet from timesheets where id = v_approval.entity_id for update;
    v_employee_id := v_timesheet.employee_id;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'generated_letter' then
    select employee_id into v_employee_id from generated_letters where id = v_approval.entity_id for update;
    select user_id into v_requester_user_id from employees where id = v_employee_id;
  elsif v_approval.entity_type = 'payroll_export_run' then
    select company_id, generated_by into v_payroll_company_id, v_requester_user_id
    from payroll_export_runs where id = v_approval.entity_id for update;
  else
    return; -- reserved for future entity types; nothing further to do here
  end if;

  if p_decision = 'rejected' then
    if v_approval.entity_type = 'leave_request' then
      update leave_requests set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'reimbursement_claim' then
      update reimbursement_claims set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'timesheet' then
      update timesheets set status = 'rejected', decided_at = now() where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'generated_letter' then
      update generated_letters set status = 'void' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'payroll_export_run' then
      update payroll_export_runs set status = 'rejected' where id = v_approval.entity_id;
      delete from payroll_export_lines where run_id = v_approval.entity_id;
    end if;
    return; -- rejection stops the chain; earlier decisions in the log are untouched
  end if;

  for v_step in
    select step_order, approver_type, condition
    from approval_workflow_steps
    where workflow_id = v_approval.workflow_id and step_order > v_approval.step_order
    order by step_order asc
  loop
    if v_step.condition is not null and v_step.condition ? 'amount_gt' then
      if v_amount is null or v_amount <= (v_step.condition ->> 'amount_gt')::numeric then
        continue; -- this step's threshold doesn't apply to this entity
      end if;
    end if;

    if v_approval.entity_type = 'payroll_export_run' then
      v_next_approver := resolve_approver_for_company(v_step.approver_type, v_payroll_company_id);
    else
      v_next_approver := resolve_approver(v_step.approver_type, v_employee_id);
    end if;

    if v_next_approver is null then
      raise exception 'Cannot advance this approval: no one currently holds the "%" role required for the next step. Ask HR Admin to assign that role, then try again.', v_step.approver_type;
    end if;

    if v_next_approver <> v_requester_user_id then
      insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id)
      values (v_approval.entity_type, v_approval.entity_id, v_approval.workflow_id, v_step.step_order, v_next_approver);
      v_found_next := true;
      exit;
    end if;
    -- self-approval: keep walking forward to find a different eligible approver
  end loop;

  if v_found_next then
    if v_approval.entity_type = 'leave_request' then
      update leave_requests set status = 'pending_approval' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'reimbursement_claim' then
      update reimbursement_claims set status = 'pending_approval' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'timesheet' then
      update timesheets set status = 'pending_approval' where id = v_approval.entity_id;
    elsif v_approval.entity_type = 'payroll_export_run' then
      update payroll_export_runs set status = 'pending_approval' where id = v_approval.entity_id;
    end if;
    return;
  end if;

  -- Final approval — entity-specific finalization.
  if v_approval.entity_type = 'leave_request' then
    v_remaining := v_leave_request.total_days;

    -- Advisory lock keyed on the employee serializes comp-day balance
    -- reads+writes across concurrent decisions for that employee (see
    -- migration comment above); released automatically at transaction end.
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_leave_request.employee_id::text));

    for v_rule in
      select dpr.source_ledger
      from deduction_priority_rules dpr
      join employees e on e.id = v_leave_request.employee_id
      where dpr.leave_type_code = v_leave_request.leave_type_code
        and (dpr.company_id = e.company_id or (dpr.company_id is null and dpr.country_code = e.country_code))
        and dpr.effective_from <= v_leave_request.start_date
      order by dpr.priority_order asc
    loop
      exit when v_remaining <= 0;

      if v_rule.source_ledger = 'comp_day' then
        select coalesce(sum(days), 0) into v_available from comp_day_ledger where employee_id = v_leave_request.employee_id;
        if v_available > 0 then
          v_draw := least(v_remaining, v_available);
          insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, reference_id, created_by)
          values (v_leave_request.employee_id, v_leave_request.start_date, 'redeemed', -v_draw, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
          v_remaining := v_remaining - v_draw;
        end if;
      elsif v_rule.source_ledger = 'leave_ledger' then
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
        values (v_leave_request.employee_id, v_leave_request.leave_type_code, v_leave_request.start_date, 'deduction', -v_remaining, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
        v_remaining := 0;
      end if;
    end loop;

    if v_remaining > 0 then
      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
      values (v_leave_request.employee_id, v_leave_request.leave_type_code, v_leave_request.start_date, 'deduction', -v_remaining, 'leave_request', v_leave_request.id, coalesce(auth.uid(), v_requester_user_id));
    end if;

    update leave_requests set status = 'approved', decided_at = now() where id = v_leave_request.id;

  elsif v_approval.entity_type = 'reimbursement_claim' then
    update reimbursement_claims set status = 'approved', decided_at = now() where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'timesheet' then
    update timesheets set status = 'approved', decided_at = now() where id = v_timesheet.id;

  elsif v_approval.entity_type = 'generated_letter' then
    update generated_letters set status = 'issued' where id = v_approval.entity_id;

  elsif v_approval.entity_type = 'payroll_export_run' then
    update payroll_export_runs
    set status = 'approved', authorized_by = coalesce(auth.uid(), v_requester_user_id), authorized_at = now()
    where id = v_approval.entity_id;
  end if;
end;
$$;

-- 6. approvals had no constraint stopping a second step-1 row from being
--    created for the same entity: reimbursement_claims/timesheets/
--    payroll_export_runs submit against an EXISTING row (an UPDATE then
--    create_initial_approval()), so a double-clicked "Submit for approval"
--    could race past every check in that function and insert twice.
--    Deciding the stale duplicate later could re-walk the whole workflow
--    and regress an already-finalized entity (e.g. an approved payroll
--    run) back to pending.
alter table approvals add constraint approvals_entity_type_entity_id_step_order_key unique (entity_type, entity_id, step_order);

create or replace function create_initial_approval(p_entity_type approvable_entity, p_entity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_employee_id uuid;
  v_workflow_id uuid;
  v_approver_type text;
  v_approver_id uuid;
  v_approval_id uuid;
begin
  if not is_entity_owner(p_entity_type, p_entity_id) then
    raise exception 'You do not own this % (or it does not exist)', p_entity_type;
  end if;

  if p_entity_type = 'leave_request' then
    select e.company_id, r.employee_id into v_company_id, v_employee_id
    from leave_requests r join employees e on e.id = r.employee_id where r.id = p_entity_id;
  elsif p_entity_type = 'reimbursement_claim' then
    select e.company_id, c.employee_id into v_company_id, v_employee_id
    from reimbursement_claims c join employees e on e.id = c.employee_id where c.id = p_entity_id;
  elsif p_entity_type = 'timesheet' then
    select e.company_id, t.employee_id into v_company_id, v_employee_id
    from timesheets t join employees e on e.id = t.employee_id where t.id = p_entity_id;
  elsif p_entity_type = 'generated_letter' then
    select e.company_id, l.employee_id into v_company_id, v_employee_id
    from generated_letters l join employees e on e.id = l.employee_id where l.id = p_entity_id;
  elsif p_entity_type = 'payroll_export_run' then
    select company_id into v_company_id from payroll_export_runs where id = p_entity_id;
  else
    raise exception 'Unsupported entity type: %', p_entity_type;
  end if;

  select id into v_workflow_id from approval_workflows
  where company_id = v_company_id and entity_type = p_entity_type and is_active = true
  order by created_at asc
  limit 1;
  if v_workflow_id is null then
    raise exception 'No approval workflow is configured for your company. Contact HR Admin.';
  end if;

  select approver_type into v_approver_type
  from approval_workflow_steps where workflow_id = v_workflow_id and step_order = 1;
  if v_approver_type is null then
    raise exception 'This workflow has no first step configured. Contact HR Admin.';
  end if;

  if p_entity_type = 'payroll_export_run' then
    v_approver_id := resolve_approver_for_company(v_approver_type, v_company_id);
  else
    v_approver_id := resolve_approver(v_approver_type, v_employee_id);
  end if;
  if v_approver_id is null then
    raise exception 'No approver could be resolved (e.g. no manager assigned, or no one holds the required role). Contact HR Admin.';
  end if;

  if v_approver_id = auth.uid() then
    raise exception 'The resolved approver for this workflow''s first step (%) is you — you can''t approve your own request. Contact HR Admin to assign a different approver.', v_approver_type;
  end if;

  -- Idempotent under concurrent double-submission: return the existing
  -- step-1 approval instead of raising or duplicating (see migration
  -- comment above). The unique constraint above is the backstop for the
  -- rare case where both SELECTs below race past each other too.
  select id into v_approval_id from approvals
  where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
  if v_approval_id is not null then
    return v_approval_id;
  end if;

  begin
    insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision)
    values (p_entity_type, p_entity_id, v_workflow_id, 1, v_approver_id, 'pending')
    returning id into v_approval_id;
  exception when unique_violation then
    select id into v_approval_id from approvals
    where entity_type = p_entity_type and entity_id = p_entity_id and step_order = 1;
  end;

  return v_approval_id;
end;
$$;

-- 7. employment_contracts_update/compensation_update/identity_docs_update
--    all check has_role(..., company_id) resolved from employee_id -- in
--    USING against the OLD row's employee_id, in WITH CHECK against the
--    NEW row's -- so nothing stopped employee_id itself changing in the
--    same UPDATE (the same shape already fixed for goals/appraisals, just
--    never patched on these three sensitive-tier tables). An HR
--    Admin/Finance user with write access to both the source and
--    destination employee's company could retarget a row of confidential
--    salary/IBAN or passport/Iqama/PESEL data onto a DIFFERENT employee.
create or replace function guard_employee_id_immutable()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- trusted backend/migration/seed context
  end if;
  if new.employee_id is distinct from old.employee_id then
    raise exception 'This record cannot be reassigned to a different employee';
  end if;
  return new;
end;
$$;

create trigger employment_contracts_guard_employee_immutable
  before update on employment_contracts
  for each row execute function guard_employee_id_immutable();

create trigger compensation_details_guard_employee_immutable
  before update on compensation_details
  for each row execute function guard_employee_id_immutable();

create trigger identity_documents_guard_employee_immutable
  before update on identity_documents
  for each row execute function guard_employee_id_immutable();

-- 8. employee_checklist_items_complete's first disjunct (employee_id =
--    current_employee_id()) doesn't reference template_item_id at all, so
--    an employee could retarget template_item_id in the same UPDATE and
--    self-mark someone else's assigned task (e.g. an HR/Finance/Sys-Admin
--    -verified offboarding step) as done.
create or replace function guard_checklist_item_identity_immutable()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- trusted backend/migration/seed context
  end if;
  if new.employee_id is distinct from old.employee_id or new.template_item_id is distinct from old.template_item_id then
    raise exception 'A checklist item cannot be reassigned to a different employee or task';
  end if;
  return new;
end;
$$;

create trigger employee_checklist_items_guard_identity_immutable
  before update on employee_checklist_items
  for each row execute function guard_checklist_item_identity_immutable();
