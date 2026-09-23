-- Phase 1 hardening (C — Policies and leave): cancel_leave_request() only
-- covered a request still awaiting a decision. There was no way to cancel
-- one that had already been approved — even before it started — without
-- HR hand-editing the ledger, and the UI didn't even offer a Cancel button
-- once a request reached 'approved'.
--
-- Extends it to also cancel an approved request that hasn't started yet,
-- reversing every ledger entry its approval posted (the leave_ledger
-- deduction, and any comp_day_ledger redemption the deduction-priority
-- rules routed through) — via a linked reversal row (reversal_of_id), same
-- pattern the ledgers already use elsewhere, never a delete. Once the
-- request's start date has passed, cancellation is refused: there's no way
-- to know from here how much of it was actually taken, so that case still
-- has to go through a manual adjustment.
create or replace function cancel_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request leave_requests%rowtype;
  v_ledger_row record;
  v_comp_row record;
begin
  select lr.* into v_request
  from leave_requests lr
  join employees e on e.id = lr.employee_id
  where lr.id = p_request_id and e.user_id = auth.uid()
  for update of lr;

  if v_request.id is null then
    raise exception 'Leave request not found, or it is not yours to cancel';
  end if;

  if v_request.status not in ('submitted', 'pending_approval', 'approved') then
    raise exception 'This request can no longer be cancelled (status: %)', v_request.status;
  end if;

  if v_request.status = 'approved' and v_request.start_date <= current_date then
    raise exception 'An approved request can only be cancelled before it starts — once it has started, ask HR for a manual adjustment instead';
  end if;

  update leave_requests set status = 'cancelled', decided_at = now() where id = p_request_id;

  update approvals
  set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, 'Cancelled by requester')
  where entity_type = 'leave_request' and entity_id = p_request_id and decision = 'pending';

  if v_request.status = 'approved' then
    perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || v_request.employee_id::text));

    for v_ledger_row in
      select l.* from leave_ledger l
      where l.reference_type = 'leave_request' and l.reference_id = p_request_id and l.amount_days < 0
        and not exists (select 1 from leave_ledger r where r.reversal_of_id = l.id)
    loop
      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, reversal_of_id, note, created_by)
      values (v_ledger_row.employee_id, v_ledger_row.leave_type_code, current_date, 'reversal', -v_ledger_row.amount_days, 'leave_request', p_request_id, v_ledger_row.id, 'Reversed: leave request cancelled before it started', auth.uid());
    end loop;

    for v_comp_row in
      select c.* from comp_day_ledger c
      where c.reference_type = 'leave_request' and c.reference_id = p_request_id and c.days < 0
        and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = c.id)
    loop
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, reference_id, reversal_of_id, note, created_by)
      values (v_comp_row.employee_id, current_date, 'reversal', -v_comp_row.days, 'leave_request', p_request_id, v_comp_row.id, 'Reversed: leave request cancelled before it started', auth.uid());
    end loop;
  end if;
end;
$$;
