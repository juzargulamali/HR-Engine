-- WRITES DATA. PRE-LAUNCH CLEANUP, STEP 3 OF 4: THE CLEANUP. Run by hand, once, in the Supabase SQL editor of PRODUCTION, ONLY after you have read steps 1 and 2
-- (prelaunch_cleanup_00_audit_readonly.sql and prelaunch_cleanup_05_impact_readonly.sql) and are happy with what they list. It is NOT a migration and nothing ever runs it automatically.
--
-- WHAT IT DOES. It clears the OUTSTANDING items that were submitted (or triggered) BEFORE the cutoff out of the live queues, through the same statuses the app itself uses, in ONE transaction:
--   * leave applications submitted / pending_approval      -> status 'cancelled' (what the app's cancel_leave_request() does), and their still-pending approval steps -> decision 'cancelled'
--   * Recovery Leave / comp-off requests submitted / pending -> the database's own recovery_cancel_request() (status 'cancelled', pending steps 'cancelled', reason stored)
--   * pending approval steps of an already cancelled / rejected / removed leave or Recovery Leave request (orphans) -> decision 'cancelled'
--   * open Recovery Leave alerts                            -> status 'acknowledged' (what acknowledge_recovery_alert() does), note = the marker below
--   * attendance exceptions still visible in the 60-day look-back (a day where a manual entry and the clock differ; a closed Recovery Leave window waiting for HR verification)
--                                                           -> an acknowledgement row in hr_queue_acknowledgements (what acknowledge_hr_queue_item() does), note = the marker below
-- Why not call cancel_leave_request() / acknowledge_*() themselves: they check that the signed-in user is the employee or an HR Admin, and the SQL editor has no signed-in user. The statements below
-- apply the same status changes, under the database owner, and every change still fires the same audit trigger (see AUDIT). recovery_cancel_request() has no such check and is called as it is.
-- WHY 'acknowledged' and not 'obsolete' for alerts: it is the HR dismissal the app already has. An acknowledged item no longer counts as needing action on My Day or the Alerts page; it stays listed
-- under "Acknowledged" with the note "Pre-launch cleanup (go-live)", so what was cleared stays visible. (An attendance exception cannot be hidden entirely: it is worked out from the source record, which
-- this file must not change.)
--
-- WHAT IT NEVER DOES. No hard delete of a request, approval, alert, ledger, attendance or payroll row. No attendance record, clock session or segment is changed. No payroll row is changed. No
-- approval of another type (expense, timesheet, letter, payroll run, ...) is touched. Nothing submitted or triggered AT OR AFTER the cutoff is touched. An APPROVED request is LEFT IN PLACE and reported,
-- even if it moved a balance, UNLESS you list its id under "approved reversals" (below).
-- APPROVED REVERSALS (default: EMPTY, so no ledger row is written). For each id you list, deliberately, from step 2's section 3: the request is cancelled and every ledger row it posted that is not yet
-- reversed gets a NEW reversing row (same employee, opposite amount, reversal_of_id pointing at the original, dated today, created_by = the actor below). The original rows are never edited or deleted.
-- The file REFUSES a listed id that is not found, was submitted at or after the cutoff, is not approved (a pending one is cancelled anyway), is a leave that has already started (the app refuses that too),
-- has a payroll export line pointing at its ledger row, is a window reduction, belongs to a Recovery Leave window that still has another live request not in your list, or would take a comp-off balance below zero.
--
-- BEFORE YOU RUN IT, edit the three marked lines (EDIT 1, 2, 3) in the block right after BEGIN. The file stops with an error, changing nothing, while the cutoff is still the placeholder, in the future, or the
-- actor is not a real sign-in account. It prints the cutoff it used as the first result row.
--   EDIT 1  the cutoff: the go-live moment, with a time zone (the SAME value as in the other three files).
--   EDIT 2  approved reversals: leave as it is for none, or  array['<request id>'::uuid, '<request id>'::uuid].
--   EDIT 3  actor_user_id: YOUR OWN sign-in account id (Supabase: Authentication > Users > your row > User UID). It is recorded as the person who acknowledged / created the reversal rows. Never guessed.
--
-- AUDIT. The file sets the audit origin to 'prelaunch_cleanup' for its own transaction, so every audit_log row it causes (leave_requests, approvals, recovery_credit_requests, recovery_alerts,
-- hr_queue_acknowledgements, leave_ledger, comp_day_ledger) says so, with the before and after of the row. It refuses to start if any of those audit triggers is missing or disabled.
-- NO REAPPEARANCE. A cleared Recovery Leave alert keeps its row, and its unique key still blocks a new one for the same period. A cancelled window request is a final answer for that evidence (the engine does not
-- ask again unless the evidence changes). An acknowledged attendance exception stays acknowledged for the same record and date. The one path that can still recreate an old DAILY (non-window) comp-off request is
-- an explicit new action on that same day (a new clock-out, or HR saving that day's manual attendance again): see the runbook note. A NEW request or alert created after the cutoff appears normally.
--
-- WHAT IT PROVES BEFORE IT COMMITS (any failure raises and rolls EVERYTHING back): no in-scope outstanding item remains; the attendance, clock, payroll and window tables are byte-for-byte as they were; every
-- existing ledger row is unchanged and the only new ledger rows are the approved reversals; the only changed requests / alerts / approvals are in-scope outstanding ones (or listed approvals); nothing at or
-- after the cutoff changed; no approval of another type changed.
--
-- HOW TO READ THE RESULT (a table, printed after the commit):  0 the cutoff used;  1 every change made this run, by company, type and result, with a TOTAL (a second run says NOTHING TO CHANGE);
-- 2 what was left in place (approved items, reported, not changed);  3 the ledger reversal rows written (empty unless you listed ids).
-- If the run stopped with an error nothing was changed: read the message, fix the cause (or the list), and run the whole file again.
-- RE-RUNNABLE: a second run finds nothing outstanding and changes nothing. Then run step 4 (prelaunch_cleanup_20_verify_readonly.sql).

begin;

drop table if exists pg_temp.prelaunch_params;
create temp table prelaunch_params as
select
  timestamptz '2000-01-01 00:00:00+00' as cutoff,                                   -- <<< EDIT 1 of 3: the go-live moment with a time zone, e.g. timestamptz '2027-01-18 06:00:00+00'
  array[]::uuid[] as approved_reversals,                                            -- <<< EDIT 2 of 3: approved request ids to reverse, e.g. array['11111111-2222-3333-4444-555555555555'::uuid]; leave empty for none
  uuid '00000000-0000-0000-0000-000000000000' as actor_user_id;                     -- <<< EDIT 3 of 3: your own Supabase sign-in user id (Authentication > Users)

drop table if exists pg_temp.prelaunch_touched;
create temp table prelaunch_touched (action text not null, company text, item_type text, result text, n int not null default 1, item_id uuid);
drop table if exists pg_temp.prelaunch_rev_delta;
create temp table prelaunch_rev_delta (employee_id uuid not null, ledger text not null, bucket text not null, delta numeric not null);

do $cleanup$
declare
  v_cutoff timestamptz;
  v_rev uuid[];
  v_actor uuid;
  v_marker constant text := 'Pre-launch cleanup (go-live)';
  v_tag constant text := 'prelaunch_cleanup';
  r record;
  l record;
  v_id uuid;
  v_n bigint;
  v_n2 bigint;
  v_bal numeric;
  v_t text;
  v_new_leave int := 0;
  v_new_comp int := 0;
  v_hash_a text;
  v_hash_b text;
begin
  select p.cutoff, p.approved_reversals, p.actor_user_id into v_cutoff, v_rev, v_actor from prelaunch_params p;
  select coalesce(array_agg(distinct x), '{}') into v_rev from unnest(coalesce(v_rev, '{}')) x;

  -- ---------------------------------------------------------------- PRECONDITIONS (stop, never guess)
  if v_cutoff is null or v_cutoff < timestamptz '2020-01-01 00:00:00+00' then
    raise exception 'REFUSING TO RUN: the cutoff is still the placeholder (or not a real go-live time). Edit EDIT 1 at the top of this file, then run it again. Nothing was changed.';
  end if;
  if v_cutoff > now() then
    raise exception 'REFUSING TO RUN: the cutoff % is in the future. Items submitted between now and then would be swept in. Use the go-live moment once it has passed. Nothing was changed.', v_cutoff;
  end if;
  if v_actor is null or not exists (select 1 from auth.users u where u.id = v_actor) then
    raise exception 'REFUSING TO RUN: EDIT 3 (actor_user_id) is not the id of a real sign-in account. Use your own User UID from Authentication > Users. Nothing was changed.';
  end if;
  if current_setting('session_replication_role') <> 'origin' then
    raise exception 'REFUSING TO RUN: triggers are switched off in this session (session_replication_role = %), so the audit trail would not be written.', current_setting('session_replication_role');
  end if;
  if to_regprocedure('public.recovery_cancel_request(uuid, text)') is null or to_regclass('public.hr_queue_acknowledgements') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_log' and column_name = 'origin') then
    raise exception 'REFUSING TO RUN: the Recovery Leave windows migration (20261108000000) and the People & HR queue migration (20270116000100) must both be applied first.';
  end if;
  select count(*) into v_n from pg_trigger t
  where not t.tgisinternal and t.tgenabled in ('O', 'A')
    and t.tgname in ('audit_leave_requests', 'audit_leave_ledger', 'audit_comp_ledger', 'audit_approvals', 'audit_recovery_credit_requests', 'audit_recovery_alerts', 'audit_hr_queue_acknowledgements');
  if v_n < 7 then
    raise exception 'REFUSING TO RUN: % of the 7 audit triggers this file relies on are missing or disabled. Fix that first.', 7 - v_n;
  end if;

  perform set_config('app.audit_origin', v_tag, true);
  raise notice 'Pre-launch cleanup: cutoff used = %; actor = %; approved reversals listed = %', v_cutoff, v_actor, coalesce(array_length(v_rev, 1), 0);

  -- ---------------------------------------------------------------- SNAPSHOTS (to prove below that nothing else moved)
  create temp table prelaunch_snap_attendance_records on commit drop as select * from attendance_records;
  create temp table prelaunch_snap_attendance_sessions on commit drop as select * from attendance_sessions;
  create temp table prelaunch_snap_attendance_segments on commit drop as select * from attendance_segments;
  create temp table prelaunch_snap_recovery_windows on commit drop as select * from recovery_windows;
  create temp table prelaunch_snap_payroll_export_runs on commit drop as select * from payroll_export_runs;
  create temp table prelaunch_snap_payroll_export_lines on commit drop as select * from payroll_export_lines;
  create temp table prelaunch_snap_leave_ledger on commit drop as select * from leave_ledger;
  create temp table prelaunch_snap_comp_day_ledger on commit drop as select * from comp_day_ledger;
  create temp table prelaunch_snap_leave_requests on commit drop as select * from leave_requests;
  create temp table prelaunch_snap_recovery_credit_requests on commit drop as select * from recovery_credit_requests;
  create temp table prelaunch_snap_recovery_alerts on commit drop as select * from recovery_alerts;
  create temp table prelaunch_snap_approvals on commit drop as select * from approvals;

  -- ---------------------------------------------------------------- 1. LEAVE APPLICATIONS: submitted / pending_approval -> cancelled (mirrors cancel_leave_request(); no ledger row exists for a pending request)
  for r in
    select lr.id, lr.status::text as st, c.legal_name as company
    from leave_requests lr join employees e on e.id = lr.employee_id join companies c on c.id = e.company_id
    where lr.deleted_at is null and lr.status in ('submitted', 'pending_approval') and lr.submitted_at < v_cutoff
    order by lr.id
    for update of lr
  loop
    update leave_requests set status = 'cancelled', decided_at = now() where id = r.id;
    update approvals
    set decision = 'cancelled', decided_at = now(), comments = case when comments is null or comments = '' then v_marker else comments || ' | ' || v_marker end
    where entity_type = 'leave_request' and entity_id = r.id and decision = 'pending';
    insert into prelaunch_touched (action, company, item_type, result, item_id) values ('cancelled', r.company, 'leave_request', 'cancelled (was ' || r.st || ')', r.id);
  end loop;

  -- ---------------------------------------------------------------- 2. RECOVERY LEAVE / COMP-OFF REQUESTS: the database's own recovery_cancel_request()
  for r in
    select rq.id, rq.event_type, rq.status::text as st, c.legal_name as company, rq.recovery_window_id as wid, rq.window_revision_no as rno, w.revision_no as wrev, rq.correction_reason as cr
    from recovery_credit_requests rq join employees e on e.id = rq.employee_id join companies c on c.id = e.company_id
    left join recovery_windows w on w.id = rq.recovery_window_id
    where rq.status in ('submitted', 'pending_approval') and rq.submitted_at < v_cutoff
    order by rq.id
    for update of rq
  loop
    perform recovery_cancel_request(r.id, v_marker);
    -- A reason that was already there is kept by the function: append the marker so the cleanup is always recognisable. And a cancelled window request must count as the
    -- final answer for the window's CURRENT revision (the engine only asks again when the window's revision is newer than the answered one).
    if r.cr is not null or (r.wid is not null and coalesce(r.rno, 0) < coalesce(r.wrev, 0)) then
      update recovery_credit_requests q
      set correction_reason = case when q.correction_reason is null then v_marker when position(v_marker in q.correction_reason) > 0 then q.correction_reason else q.correction_reason || ' | ' || v_marker end,
          window_revision_no = case when q.recovery_window_id is not null then greatest(coalesce(q.window_revision_no, 0), coalesce(r.wrev, 0)) else q.window_revision_no end
      where q.id = r.id;
    end if;
    insert into prelaunch_touched (action, company, item_type, result, item_id)
    values ('cancelled', r.company, case when r.event_type in ('window', 'window_top_up', 'window_reduction') then 'recovery_leave_request:' else 'comp_off_request:' end || r.event_type, 'cancelled (was ' || r.st || ')', r.id);
  end loop;

  -- ---------------------------------------------------------------- 3. ORPHAN APPROVAL STEPS: still pending although the request is already cancelled / rejected / removed
  with upd as (
    update approvals a
    set decision = 'cancelled', decided_at = now(), comments = case when a.comments is null or a.comments = '' then v_marker else a.comments || ' | ' || v_marker end
    from leave_requests lr, employees e, companies c
    where a.entity_type = 'leave_request' and a.entity_id = lr.id and a.decision = 'pending'
      and (lr.status in ('cancelled', 'rejected') or lr.deleted_at is not null) and lr.submitted_at < v_cutoff
      and e.id = lr.employee_id and c.id = e.company_id
    returning a.id, c.legal_name
  )
  insert into prelaunch_touched (action, company, item_type, result, item_id) select 'cancelled', u.legal_name, 'approval_step:leave_request (orphan)', 'cancelled', u.id from upd u;
  with upd as (
    update approvals a
    set decision = 'cancelled', decided_at = now(), comments = case when a.comments is null or a.comments = '' then v_marker else a.comments || ' | ' || v_marker end
    from recovery_credit_requests rq, employees e, companies c
    where a.entity_type = 'recovery_credit' and a.entity_id = rq.id and a.decision = 'pending'
      and rq.status in ('cancelled', 'rejected') and rq.submitted_at < v_cutoff
      and e.id = rq.employee_id and c.id = e.company_id
    returning a.id, c.legal_name
  )
  insert into prelaunch_touched (action, company, item_type, result, item_id) select 'cancelled', u.legal_name, 'approval_step:recovery_credit (orphan)', 'cancelled', u.id from upd u;

  -- ---------------------------------------------------------------- 4. APPROVED REVERSALS (only the ids you listed)
  if coalesce(array_length(v_rev, 1), 0) > 0 then
    -- 4a. validate every listed id first; nothing is written until all pass
    foreach v_id in array v_rev loop
      select * into r from (
        select 'leave'::text as kind, lr.id, lr.status::text as st, lr.submitted_at as stamp, lr.start_date as sd, lr.employee_id, null::text as event_type, null::uuid as wid
        from leave_requests lr where lr.id = v_id
        union all
        select 'recovery', rq.id, rq.status::text, rq.submitted_at, rq.work_date, rq.employee_id, rq.event_type, rq.recovery_window_id
        from recovery_credit_requests rq where rq.id = v_id
      ) x;
      if r.id is null then raise exception 'Listed id % is not a leave request or a Recovery Leave / comp-off request. Remove it from EDIT 2.', v_id; end if;
      if r.stamp >= v_cutoff then raise exception 'Listed id % was submitted at or after the cutoff: it is not in scope. Remove it from EDIT 2.', v_id; end if;
      if r.st = 'cancelled' then continue; end if;
      if r.st <> 'approved' then raise exception 'Listed id % is %, not approved: only an approved request is listed (outstanding ones are cancelled automatically). Remove it from EDIT 2.', v_id, r.st; end if;
      if r.kind = 'leave' then
        if r.sd <= current_date then raise exception 'Listed leave request % has already started (it starts %). The app refuses to cancel a started leave too: use a manual adjustment.', v_id, r.sd; end if;
        if exists (select 1 from leave_ledger ll join payroll_export_lines pl on pl.source_reference_type = 'leave_ledger' and pl.source_reference_id = ll.id
                   where ll.reference_type = 'leave_request' and ll.reference_id = v_id) then
          raise exception 'Listed leave request % has a ledger row that a payroll export line already references. It cannot be reversed here.', v_id;
        end if;
      else
        if r.event_type = 'window_reduction' then raise exception 'Listed request % is a window reduction, which cannot be reversed here. List the request it adjusts, or handle it by hand.', v_id; end if;
        if r.wid is not null and exists (
          select 1 from recovery_credit_requests o
          where o.recovery_window_id = r.wid and o.id <> v_id and o.status not in ('cancelled', 'rejected') and o.id <> all (v_rev)
        ) then
          raise exception 'Listed request % belongs to a Recovery Leave window that still has another live request (a top-up, a reduction or a pending one). List every approved request of that window, or none.', v_id;
        end if;
      end if;
    end loop;

    -- 4b. do it: cancel the request, close any pending step, and append a reversing row for every ledger row it posted that is not yet reversed
    foreach v_id in array v_rev loop
      select * into r from (
        select 'leave'::text as kind, lr.id, lr.status::text as st, lr.employee_id, c.legal_name as company, null::text as event_type
        from leave_requests lr join employees e on e.id = lr.employee_id join companies c on c.id = e.company_id where lr.id = v_id
        union all
        select 'recovery', rq.id, rq.status::text, rq.employee_id, c.legal_name, rq.event_type
        from recovery_credit_requests rq join employees e on e.id = rq.employee_id join companies c on c.id = e.company_id where rq.id = v_id
      ) x;
      if r.st = 'cancelled' then
        insert into prelaunch_touched (action, company, item_type, result, n, item_id) values ('left in place', r.company, case r.kind when 'leave' then 'leave_request' else 'recovery_credit_request:' || r.event_type end, 'listed id already cancelled: nothing to do', 0, v_id);
        continue;
      end if;
      perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || r.employee_id::text));
      if r.kind = 'leave' then
        perform 1 from leave_requests where id = v_id for update;
        update leave_requests set status = 'cancelled', decided_at = now() where id = v_id;
        update approvals
        set decision = 'cancelled', decided_at = now(), comments = case when comments is null or comments = '' then v_marker else comments || ' | ' || v_marker end
        where entity_type = 'leave_request' and entity_id = v_id and decision = 'pending';
        for l in select x.* from leave_ledger x
                 where x.reference_type = 'leave_request' and x.reference_id = v_id and x.entry_type <> 'reversal' and not exists (select 1 from leave_ledger y where y.reversal_of_id = x.id)
                 order by x.created_at, x.id
        loop
          insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, reversal_of_id, note, created_by)
          values (l.employee_id, l.leave_type_code, current_date, 'reversal', -l.amount_days, 'leave_request', v_id, l.id, v_marker || ': approved request cancelled, its ledger row reversed', v_actor);
          v_new_leave := v_new_leave + 1;
          insert into prelaunch_rev_delta values (l.employee_id, 'leave_ledger', l.leave_type_code, -l.amount_days);
          insert into prelaunch_touched (action, company, item_type, result, item_id) values ('ledger reversal written', r.company, 'leave_ledger', 'reversal of ' || l.entry_type || ' ' || l.amount_days || ' day(s)', l.id);
        end loop;
        for l in select x.* from comp_day_ledger x
                 where x.reference_type = 'leave_request' and x.reference_id = v_id and x.entry_type <> 'reversal' and not exists (select 1 from comp_day_ledger y where y.reversal_of_id = x.id)
                 order by x.created_at, x.id
        loop
          insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
          values (l.employee_id, current_date, 'reversal', -l.days, l.source, 'leave_request', v_id, l.id, v_actor);
          v_new_comp := v_new_comp + 1;
          insert into prelaunch_rev_delta values (l.employee_id, 'comp_day_ledger', 'comp_off', -l.days);
          insert into prelaunch_touched (action, company, item_type, result, item_id) values ('ledger reversal written', r.company, 'comp_day_ledger', 'reversal of ' || l.entry_type || ' ' || l.days || ' day(s)', l.id);
        end loop;
        insert into prelaunch_touched (action, company, item_type, result, item_id) values ('cancelled', r.company, 'leave_request', 'cancelled (was approved; ledger rows reversed)', v_id);
      else
        perform 1 from recovery_credit_requests where id = v_id for update;
        update approvals
        set decision = 'cancelled', decided_at = now(), comments = case when comments is null or comments = '' then v_marker else comments || ' | ' || v_marker end
        where entity_type = 'recovery_credit' and entity_id = v_id and decision = 'pending';
        update recovery_credit_requests q
        set status = 'cancelled', decided_at = now(),
            correction_reason = case when q.correction_reason is null then v_marker when position(v_marker in q.correction_reason) > 0 then q.correction_reason else q.correction_reason || ' | ' || v_marker end,
            window_revision_no = case when q.recovery_window_id is not null then greatest(coalesce(q.window_revision_no, 0), coalesce((select w.revision_no from recovery_windows w where w.id = q.recovery_window_id), 0)) else q.window_revision_no end
        where q.id = v_id;
        for l in select x.* from comp_day_ledger x join recovery_credit_requests q on q.id = v_id
                 where ((x.reference_type = 'recovery_credit_request' and x.reference_id = q.id)
                        or (q.attendance_record_id is not null and x.reference_type = 'attendance_record' and x.reference_id = q.attendance_record_id)
                        or x.id = q.comp_day_ledger_id)
                   and x.entry_type <> 'reversal' and not exists (select 1 from comp_day_ledger y where y.reversal_of_id = x.id)
                 order by x.created_at, x.id
        loop
          insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, reversal_of_id, created_by)
          values (l.employee_id, current_date, 'reversal', -l.days, l.source, l.reference_type, l.reference_id, l.id, v_actor);
          v_new_comp := v_new_comp + 1;
          insert into prelaunch_rev_delta values (l.employee_id, 'comp_day_ledger', 'comp_off', -l.days);
          insert into prelaunch_touched (action, company, item_type, result, item_id) values ('ledger reversal written', r.company, 'comp_day_ledger', 'reversal of ' || l.entry_type || ' ' || l.days || ' day(s)', l.id);
        end loop;
        insert into prelaunch_touched (action, company, item_type, result, item_id)
        values ('cancelled', r.company, case when r.event_type in ('window', 'window_top_up') then 'recovery_leave_request:' else 'comp_off_request:' end || r.event_type, 'cancelled (was approved; ledger rows reversed)', v_id);
      end if;
    end loop;

    -- a reversal must never take someone's comp-off balance below zero (days already used): stop and let the owner decide
    for r in select d.employee_id, sum(d.delta) as delta from prelaunch_rev_delta d where d.ledger = 'comp_day_ledger' group by d.employee_id loop
      select coalesce(sum(c.days), 0) into v_bal from comp_day_ledger c where c.employee_id = r.employee_id;
      if v_bal < 0 and r.delta < 0 then
        raise exception 'Reversing the listed requests would take the comp-off balance of employee % to % days (days already used). Resolve that by hand first, or remove the request from EDIT 2.', r.employee_id, v_bal;
      end if;
    end loop;
  end if;

  -- ---------------------------------------------------------------- 5. RECOVERY LEAVE ALERTS: open -> acknowledged (the HR dismissal; the row and its unique key stay)
  with upd as (
    update recovery_alerts a
    set status = 'acknowledged', acknowledged_by = v_actor, acknowledged_at = now(), acknowledgement_note = v_marker
    where a.status = 'open' and a.triggered_at < v_cutoff
    returning a.id, a.company_id, a.alert_type
  )
  insert into prelaunch_touched (action, company, item_type, result, item_id)
  select 'acknowledged', c.legal_name, 'recovery_alert:' || u.alert_type, 'acknowledged', u.id from upd u join companies c on c.id = u.company_id;

  -- ---------------------------------------------------------------- 6. ATTENDANCE EXCEPTIONS still visible in the 60-day look-back: an acknowledgement row (the source record is NOT changed)
  with ins as (
    insert into hr_queue_acknowledgements (company_id, employee_id, kind, source_id, source_date, note, acknowledged_by)
    select e.company_id, ar.employee_id, 'attendance', ar.id, ar.work_date, v_marker, v_actor
    from attendance_records ar join employees e on e.id = ar.employee_id
    where ar.presence_conflict is not null and e.deleted_at is null
      and ((ar.work_date + 1)::timestamp at time zone country_timezone(e.country_code)) - interval '1 microsecond' < v_cutoff
      and ar.work_date >= (now() at time zone country_timezone(e.country_code))::date - 60
      and not exists (select 1 from hr_queue_acknowledgements k where k.kind = 'attendance' and k.source_id = ar.id and k.source_date = ar.work_date)
    on conflict (kind, source_id, source_date) do nothing
    returning source_id, company_id
  )
  insert into prelaunch_touched (action, company, item_type, result, item_id)
  select 'acknowledged', c.legal_name, 'attendance_alert:presence_conflict', 'acknowledged', i.source_id from ins i join companies c on c.id = i.company_id;
  with ins as (
    insert into hr_queue_acknowledgements (company_id, employee_id, kind, source_id, source_date, note, acknowledged_by)
    select w.company_id, w.employee_id, 'attendance', w.id, w.starting_local_date, v_marker, v_actor
    from recovery_windows w join employees e on e.id = w.employee_id
    where w.hr_verification_required and w.hr_verified_at is null and e.deleted_at is null
      and coalesce(w.closed_at, w.created_at) < v_cutoff
      and w.starting_local_date >= (now() at time zone country_timezone(e.country_code))::date - 60
      and not exists (select 1 from hr_queue_acknowledgements k where k.kind = 'attendance' and k.source_id = w.id and k.source_date = w.starting_local_date)
    on conflict (kind, source_id, source_date) do nothing
    returning source_id, company_id
  )
  insert into prelaunch_touched (action, company, item_type, result, item_id)
  select 'acknowledged', c.legal_name, 'attendance_alert:window_needs_hr_verification', 'acknowledged', i.source_id from ins i join companies c on c.id = i.company_id;

  -- ---------------------------------------------------------------- 7. REPORT what was left in place (approved in-scope requests: reported, never changed unless listed above)
  insert into prelaunch_touched (action, company, item_type, result, n)
  select 'left in place', c.legal_name, x.item_type,
         case when x.has_ledger then 'approved, moved a ledger: reported and left in place (list its id under EDIT 2 to reverse)' else 'approved, moved no ledger: reported and left in place' end, count(*)::int
  from (
    select 'leave_request'::text as item_type, e.company_id,
           (exists (select 1 from leave_ledger ll where ll.reference_type = 'leave_request' and ll.reference_id = lr.id)
            or exists (select 1 from comp_day_ledger cc where cc.reference_type = 'leave_request' and cc.reference_id = lr.id)) as has_ledger
    from leave_requests lr join employees e on e.id = lr.employee_id
    where lr.deleted_at is null and lr.status = 'approved' and lr.submitted_at < v_cutoff
    union all
    select (case when rq.event_type in ('window', 'window_top_up', 'window_reduction') then 'recovery_leave_request:' else 'comp_off_request:' end) || rq.event_type, e.company_id,
           (exists (select 1 from comp_day_ledger cc where (cc.reference_type = 'recovery_credit_request' and cc.reference_id = rq.id)
                      or (rq.attendance_record_id is not null and cc.reference_type = 'attendance_record' and cc.reference_id = rq.attendance_record_id) or cc.id = rq.comp_day_ledger_id))
    from recovery_credit_requests rq join employees e on e.id = rq.employee_id
    where rq.status = 'approved' and rq.submitted_at < v_cutoff
  ) x join companies c on c.id = x.company_id
  group by c.legal_name, x.item_type, x.has_ledger;

  -- ---------------------------------------------------------------- 8. PROVE IT before committing (raise = roll everything back)
  -- 8a. nothing in scope is still outstanding
  select (select count(*) from leave_requests lr where lr.deleted_at is null and lr.status in ('submitted', 'pending_approval') and lr.submitted_at < v_cutoff)
       + (select count(*) from recovery_credit_requests rq where rq.status in ('submitted', 'pending_approval') and rq.submitted_at < v_cutoff)
       + (select count(*) from recovery_alerts a where a.status = 'open' and a.triggered_at < v_cutoff)
       + (select count(*) from approvals a join leave_requests lr on a.entity_type = 'leave_request' and a.entity_id = lr.id
            where a.decision = 'pending' and lr.submitted_at < v_cutoff and lr.status <> 'approved')
       + (select count(*) from approvals a join recovery_credit_requests rq on a.entity_type = 'recovery_credit' and a.entity_id = rq.id
            where a.decision = 'pending' and rq.submitted_at < v_cutoff and rq.status <> 'approved')
  into v_n;
  if v_n > 0 then raise exception 'SAFETY STOP: % in-scope outstanding item(s) are still open after the cleanup. Everything is rolled back.', v_n; end if;

  -- 8b. tables that must be exactly as they were
  foreach v_t in array array['attendance_records', 'attendance_sessions', 'attendance_segments', 'recovery_windows', 'payroll_export_runs', 'payroll_export_lines'] loop
    execute format('select count(*) from %I', v_t) into v_n;
    execute format('select count(*) from %I', 'prelaunch_snap_' || v_t) into v_n2;
    execute format('select coalesce(md5(string_agg(to_jsonb(x)::text, ''|'' order by x.id)), '''') from %I x', v_t) into v_hash_a;
    execute format('select coalesce(md5(string_agg(to_jsonb(x)::text, ''|'' order by x.id)), '''') from %I x', 'prelaunch_snap_' || v_t) into v_hash_b;
    if v_n <> v_n2 or v_hash_a <> v_hash_b then raise exception 'SAFETY STOP: % changed during the cleanup, which must never happen. Everything is rolled back.', v_t; end if;
  end loop;

  -- 8c. ledgers: every existing row unchanged, new rows only the approved reversals
  foreach v_t in array array['leave_ledger', 'comp_day_ledger'] loop
    execute format('select coalesce(md5(string_agg(to_jsonb(x)::text, ''|'' order by x.id)), '''') from %I x where x.id in (select id from %I)', v_t, 'prelaunch_snap_' || v_t) into v_hash_a;
    execute format('select coalesce(md5(string_agg(to_jsonb(x)::text, ''|'' order by x.id)), '''') from %I x', 'prelaunch_snap_' || v_t) into v_hash_b;
    if v_hash_a <> v_hash_b then raise exception 'SAFETY STOP: an existing % row was changed or removed. Everything is rolled back.', v_t; end if;
  end loop;
  select count(*) - (select count(*) from prelaunch_snap_leave_ledger) into v_n from leave_ledger;
  select count(*) - (select count(*) from prelaunch_snap_comp_day_ledger) into v_n2 from comp_day_ledger;
  if v_n <> v_new_leave or v_n2 <> v_new_comp then raise exception 'SAFETY STOP: unexpected number of new ledger rows (leave %, comp %). Everything is rolled back.', v_n, v_n2; end if;
  if exists (select 1 from leave_ledger x where x.id not in (select id from prelaunch_snap_leave_ledger) and (x.entry_type <> 'reversal' or x.reversal_of_id is null))
     or exists (select 1 from comp_day_ledger x where x.id not in (select id from prelaunch_snap_comp_day_ledger) and (x.entry_type <> 'reversal' or x.reversal_of_id is null)) then
    raise exception 'SAFETY STOP: a new ledger row is not a reversal. Everything is rolled back.';
  end if;

  -- 8d. requests, alerts, approvals: only in-scope outstanding rows (or listed approved ones) changed; nothing removed or added; nothing at or after the cutoff touched
  if (select count(*) from leave_requests) <> (select count(*) from prelaunch_snap_leave_requests)
     or (select count(*) from recovery_credit_requests) <> (select count(*) from prelaunch_snap_recovery_credit_requests)
     or (select count(*) from recovery_alerts) <> (select count(*) from prelaunch_snap_recovery_alerts)
     or (select count(*) from approvals) <> (select count(*) from prelaunch_snap_approvals) then
    raise exception 'SAFETY STOP: a request, alert or approval row was added or removed. Everything is rolled back.';
  end if;
  select count(*) into v_n from leave_requests t join prelaunch_snap_leave_requests s on s.id = t.id
  where to_jsonb(t) <> to_jsonb(s) and (t.submitted_at >= v_cutoff or (s.status::text not in ('submitted', 'pending_approval') and s.id <> all (v_rev)) or t.status::text <> 'cancelled');
  if v_n > 0 then raise exception 'SAFETY STOP: % leave request(s) outside the cleanup scope changed. Everything is rolled back.', v_n; end if;
  select count(*) into v_n from recovery_credit_requests t join prelaunch_snap_recovery_credit_requests s on s.id = t.id
  where to_jsonb(t) <> to_jsonb(s) and (t.submitted_at >= v_cutoff or (s.status::text not in ('submitted', 'pending_approval') and s.id <> all (v_rev)) or t.status::text <> 'cancelled');
  if v_n > 0 then raise exception 'SAFETY STOP: % Recovery Leave request(s) outside the cleanup scope changed. Everything is rolled back.', v_n; end if;
  select count(*) into v_n from recovery_alerts t join prelaunch_snap_recovery_alerts s on s.id = t.id
  where to_jsonb(t) <> to_jsonb(s) and (t.triggered_at >= v_cutoff or s.status <> 'open' or t.status <> 'acknowledged');
  if v_n > 0 then raise exception 'SAFETY STOP: % alert(s) outside the cleanup scope changed. Everything is rolled back.', v_n; end if;
  select count(*) into v_n from approvals t join prelaunch_snap_approvals s on s.id = t.id
  where to_jsonb(t) <> to_jsonb(s) and (t.entity_type::text not in ('leave_request', 'recovery_credit') or s.decision::text <> 'pending' or t.decision::text <> 'cancelled');
  if v_n > 0 then raise exception 'SAFETY STOP: % approval step(s) outside the cleanup scope changed (another type, or a step that was not pending). Everything is rolled back.', v_n; end if;
end
$cleanup$;

commit;

-- WHAT THIS RUN DID (printed after the commit). Section 1 is empty of changes and says NOTHING TO CHANGE on a second run.
select section, company, item_type, action, result, count
from (
  select 0 as ord, '0. CUTOFF USED' as section, null::text as company, null::text as item_type, 'cutoff' as action, p.cutoff::text as result, null::bigint as count from prelaunch_params p
  union all
  select 1, '1. CHANGES MADE BY THIS RUN', t.company, t.item_type, t.action, t.result, sum(t.n)::bigint
  from prelaunch_touched t where t.action <> 'left in place' group by t.company, t.item_type, t.action, t.result
  union all
  select 2, '1. CHANGES MADE BY THIS RUN', null, null, 'TOTAL',
         case when coalesce(sum(t.n), 0) = 0 then 'NOTHING TO CHANGE: already clean (a re-run is harmless)' else 'rows changed or written' end, coalesce(sum(t.n), 0)::bigint
  from prelaunch_touched t where t.action <> 'left in place'
  union all
  select 3, '2. LEFT IN PLACE (reported, not changed)', t.company, t.item_type, t.action, t.result, sum(t.n)::bigint
  from prelaunch_touched t where t.action = 'left in place' group by t.company, t.item_type, t.action, t.result
) q
order by ord, company nulls first, item_type, action, result;
