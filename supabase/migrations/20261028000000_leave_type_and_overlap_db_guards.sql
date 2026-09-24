-- Phase 1 hardening (C — Policies and leave): closes two loopholes at the
-- database layer, as a backstop behind the app-layer checks added to
-- submitLeaveRequest() in the same change:
--
-- 1. Leave type allowlist. The leave request form used to fall back to a
--    free-text leave type field whenever no policy was configured, and
--    nothing stopped an arbitrary string even when one was. The app layer
--    now validates against policy_leave_types before inserting, but a raw
--    insert bypassing it entirely (the same class of attack the total_days
--    check constraint further up already guards against) could still write
--    anything. guard_leave_request_type() requires an active leave_rules
--    policy for the employee's country, in effect today, that actually
--    defines the leave_type_code being inserted.
--
-- 2. Overlapping requests. submitLeaveRequest() now checks for an
--    overlapping live request before inserting, but that check-then-insert
--    has the same race shape as bulkRecordAttendance()'s comp-day credit
--    check — two concurrent submissions for the same employee could both
--    pass the check before either commits. A GiST exclusion constraint
--    (same technique policy_versions already uses to prevent overlapping
--    active versions) makes this a database-enforced invariant instead of
--    an advisory one: one employee may not hold two overlapping requests
--    that are both still live (submitted/pending_approval/approved).
--
-- CAUTION — this exclusion constraint validates every existing row against
-- it when added. If any employee currently has two live leave requests
-- with overlapping date ranges, this migration will FAIL to apply until
-- that's resolved (cancel/reject one of them) — it will not silently drop
-- or alter any existing data. Check for this before applying to a database
-- with real historical data:
--   select employee_id, count(*) from leave_requests
--   where status in ('submitted', 'pending_approval', 'approved')
--   group by employee_id having count(*) > 1;
-- (a count > 1 doesn't by itself mean an overlap, but is worth checking by hand).
alter table leave_requests add constraint leave_requests_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('submitted', 'pending_approval', 'approved'));

-- SECURITY DEFINER: the app inserts leave_requests for the requester
-- themselves, but this check must resolve the SAME way regardless of who's
-- inserting or which other rows they can see — a plain employee's own
-- employees_select policy doesn't even cover an unrelated peer's row, and
-- this check has nothing to do with row ownership anyway (only whether an
-- active policy defines this leave type for this employee's country), so
-- it must not be gated by the inserting user's own RLS visibility.
create or replace function guard_leave_request_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid boolean;
begin
  select exists (
    select 1
    from policy_leave_types plt
    join policy_versions pv on pv.id = plt.policy_version_id
    join employees e on e.country_code = pv.country_code
    where e.id = new.employee_id
      and pv.policy_type = 'leave_rules'
      and pv.status = 'active'
      and current_date between pv.effective_from and coalesce(pv.effective_to, 'infinity'::date)
      and plt.leave_type_code = new.leave_type_code
  ) into v_valid;

  if not v_valid then
    raise exception 'No active leave policy for this employee''s country defines leave type "%" — HR must activate a leave policy with this leave type first', new.leave_type_code;
  end if;

  return new;
end;
$$;

create trigger leave_requests_guard_type before insert on leave_requests
  for each row execute function guard_leave_request_type();

-- Phase 1 correction (2): submitLeaveRequest() used to INSERT into
-- leave_requests and then, as a separate RPC round trip, call
-- create_initial_approval() — two independent transactions. If the second
-- call never reached the database at all (a network drop, the server
-- process dying between the two calls), the leave request was left
-- permanently "submitted" with no approvals row and no one able to act on
-- it; the app's own best-effort "cancel it if routing fails" only covers
-- the case where the SECOND call itself returns an error, not the case
-- where it never runs. This function makes both writes one statement, and
-- therefore one transaction: create_initial_approval() raising for any
-- reason (no workflow configured, no approver resolvable, self-approval)
-- rolls back the leave_requests insert along with it, so a caller only
-- ever observes "fully submitted" or "not submitted at all" — never an
-- orphan request or an orphan approval.
create or replace function submit_leave_request(
  p_leave_type_code text,
  p_start_date date,
  p_end_date date,
  p_half_day_start boolean,
  p_half_day_end boolean,
  p_total_days numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_request_id uuid;
begin
  select id into v_employee_id from employees where user_id = auth.uid() and deleted_at is null;
  if v_employee_id is null then
    raise exception 'No employee record is linked to your account.';
  end if;

  insert into leave_requests (employee_id, leave_type_code, start_date, end_date, half_day_start, half_day_end, total_days, reason)
  values (v_employee_id, p_leave_type_code, p_start_date, p_end_date, coalesce(p_half_day_start, false), coalesce(p_half_day_end, false), p_total_days, p_reason)
  returning id into v_request_id;

  -- Same function the old two-call path used for its second call — reused
  -- here rather than duplicated, so routing stays the single implementation
  -- every other entity type (reimbursement_claim, timesheet, ...) shares.
  -- Calling it from inside this function, rather than as a separate RPC,
  -- is what makes the two writes atomic: a plpgsql function body runs
  -- inside the same transaction as its own invoking statement, so an
  -- exception raised here unwinds the insert above too.
  perform create_initial_approval('leave_request', v_request_id);

  return v_request_id;
end;
$$;
