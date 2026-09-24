-- Phase 1 hardening (B — Approvals): cancelLeaveRequest() used to be a bare
-- `update leave_requests set status = 'cancelled'` from the app, which
-- never touched the approvals table (it has no UPDATE grant for
-- authenticated at all — see the revoke further down in schema.sql). The
-- now-moot approvals row for that request stayed 'pending' forever: still
-- counted in the assigned approver's pending-approvals total, and still
-- listed on their Approvals page, for a request the employee had already
-- withdrawn.
--
-- Withdraws a leave request that's still awaiting a decision — the
-- requester's own action, distinct from decide_leave_approval() (an
-- approver's action). Closes out any still-pending approval step for it
-- atomically with the status change.
create or replace function cancel_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status request_status;
  v_employee_id uuid;
begin
  select lr.status, lr.employee_id into v_status, v_employee_id
  from leave_requests lr
  join employees e on e.id = lr.employee_id
  where lr.id = p_request_id and e.user_id = auth.uid()
  for update of lr;

  if v_employee_id is null then
    raise exception 'Leave request not found, or it is not yours to cancel';
  end if;

  if v_status not in ('submitted', 'pending_approval') then
    raise exception 'This request can no longer be cancelled (status: %)', v_status;
  end if;

  update leave_requests set status = 'cancelled', decided_at = now() where id = p_request_id;

  update approvals
  set decision = 'cancelled', decided_at = now(), comments = coalesce(comments, 'Cancelled by requester before a decision was made')
  where entity_type = 'leave_request' and entity_id = p_request_id and decision = 'pending';
end;
$$;
