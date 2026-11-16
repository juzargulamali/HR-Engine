-- WRITES DATA. PRE-LAUNCH CLEANUP, STEP 3 OF 4: THE CLEANUP. Run by hand, once, in the Supabase SQL editor of PRODUCTION, ONLY after you have read steps 1 and 2
-- (prelaunch_cleanup_00_audit_readonly.sql and prelaunch_cleanup_05_impact_readonly.sql) and are happy with what they list. It is NOT a migration and nothing ever runs it automatically.
--
-- WHAT IT DOES. It clears the OUTSTANDING items that were submitted (or triggered) BEFORE the cutoff out of the live queues, through the same statuses the app itself uses, in ONE transaction:
--   * leave applications in draft / submitted / pending_approval -> status 'cancelled' (what the app's cancel_leave_request() does), and their still-pending approval steps -> decision 'cancelled'
--   * Recovery Leave / comp-off requests submitted / pending_approval -> the database's own recovery_cancel_request() (status 'cancelled', pending steps 'cancelled', reason stored)
--   * pending approval steps of an already cancelled / rejected / removed leave or Recovery Leave request (orphans; never a step of an approved request) -> decision 'cancelled'
--   * open Recovery Leave alerts                            -> status 'acknowledged' (what acknowledge_recovery_alert() does), note = the marker below
--   * attendance exceptions still visible in the 60-day look-back (a day where a manual entry and the clock differ; a closed Recovery Leave window waiting for HR verification)
--                                                           -> an acknowledgement row in hr_queue_acknowledgements (what acknowledge_hr_queue_item() does), note = the marker below
-- Why not call cancel_leave_request() / acknowledge_*() themselves: they check that the signed-in user is the employee or an HR Admin, and the SQL editor has no signed-in user. The statements below
-- apply the same status changes, under the database owner, and every change still fires the same audit trigger (see AUDIT). recovery_cancel_request() has no such check and is called as it is.
-- WHY 'acknowledged' and not 'obsolete' for alerts: it is the HR dismissal the app already has. An acknowledged item no longer counts as needing action on My Day or the Alerts page; it stays listed
-- under "Acknowledged" with the note "Pre-launch cleanup (go-live)", so what was cleared stays visible for reference. (An attendance exception cannot be hidden entirely: it is worked out from the
-- source record, which this file must not change.)
--
-- WHAT IT NEVER DOES. APPROVED requests are NEVER touched: no approved leave application and no approved Recovery Leave / comp-off request is changed, whatever its dates, and there is no option to do so.
-- NO LEDGER ROW is ever inserted, changed or deleted (leave_ledger, comp_day_ledger): every credited or deducted balance stays exactly as it is. No hard delete of a request, approval, alert or any other row.
-- No attendance record, clock session, segment or recovery window is changed. No payroll row is changed. No approval of another type (expense, timesheet, letter, payroll run, ...) is touched.
-- Nothing submitted or triggered AT OR AFTER the cutoff is touched.
-- OUTSTANDING REQUEST THAT HAS ALREADY POSTED A LEDGER ROW (it should not exist; steps 1 and 2 list it): cancelling it without a reversal would leave a balance wrong and this pack writes no ledger row,
-- so the file REFUSES TO RUN, changing nothing, while any exists. Resolve it first (outside this pack) and run steps 1 and 2 again.
--
-- BEFORE YOU RUN IT, edit the three marked lines (EDIT 1, 2, 3) in the block right after BEGIN. The file stops with an error, changing nothing, while the cutoff is still the placeholder or in the future,
-- while the EXPECTED TOTAL is still the placeholder or does not match, or while the actor is not a real sign-in account. It prints the cutoff it used as the first result row.
--   EDIT 1  the cutoff: the go-live moment, with a time zone (the SAME value as in the other three files).
--   EDIT 2  EXPECTED TOTAL: the number the read-only audit (step 1) showed you in its row "E. TOTAL THE WRITE STEP WOULD CHANGE". The file counts what it is about to change by the same rules and refuses,
--           changing nothing, if its number is different (something changed since you read the audit: run it again) or if you left the placeholder -1. This is how no Production write happens without the counts.
--   EDIT 3  actor_user_id: YOUR OWN sign-in account id (Supabase: Authentication > Users > your row > User UID). It is recorded as the person who acknowledged the alerts. Never guessed.
--
-- AUDIT. The file sets the audit origin to 'prelaunch_cleanup' for its own transaction, so every audit_log row it causes (leave_requests, approvals, recovery_credit_requests, recovery_alerts,
-- hr_queue_acknowledgements) says so, with the before and after of the row. It refuses to start if any of the audit triggers it relies on is missing or disabled.
-- NO REAPPEARANCE. A cleared Recovery Leave alert keeps its row, and its unique key still blocks a new one for the same period. A cancelled window request is a final answer for that evidence (the engine does not
-- ask again unless the evidence changes). An acknowledged attendance exception stays acknowledged for the same record and date. The one path that can still recreate an old DAILY (non-window) comp-off request is
-- an explicit new action on that same day (a new clock-out, or HR saving that day's manual attendance again): see the runbook note. A NEW request or alert created after the cutoff appears normally.
--
-- WHAT IT PROVES BEFORE IT COMMITS (any failure raises and rolls EVERYTHING back): no in-scope outstanding item remains; the number of changes equals the EXPECTED TOTAL; NO approved leave or Recovery Leave /
-- comp-off request changed; NO ledger row (leave_ledger, comp_day_ledger) was inserted, changed or deleted; the attendance, clock, window and payroll tables are byte-for-byte as they were; the only changed
-- requests / alerts / approval steps are in-scope outstanding ones; nothing at or after the cutoff changed; no approval of another type changed.
--
-- HOW TO READ THE RESULT (a table, printed after the commit):  0 the cutoff used;  1 every change made this run, by company, type and result, with a TOTAL (a second run says NOTHING TO CHANGE; it needs
-- EXPECTED TOTAL 0);  2 what was left in place (approved items, reported, never changed).
-- If the run stopped with an error nothing was changed: read the message, fix the cause, and run the whole file again.
-- RE-RUNNABLE: a second run finds nothing outstanding and changes nothing (set EXPECTED TOTAL to 0 for it). Then run step 4 (prelaunch_cleanup_20_verify_readonly.sql).

begin;

drop table if exists pg_temp.prelaunch_params;
create temp table prelaunch_params as
select
  timestamptz '2000-01-01 00:00:00+00' as cutoff,                                   -- <<< EDIT 1 of 3: the go-live moment with a time zone, e.g. timestamptz '2027-01-18 06:00:00+00'
  -1::int as expected_total,                                                        -- <<< EDIT 2 of 3: the TOTAL from the read-only audit (step 1, row "E. TOTAL THE WRITE STEP WOULD CHANGE"), e.g. 42
  uuid '00000000-0000-0000-0000-000000000000' as actor_user_id;                     -- <<< EDIT 3 of 3: your own Supabase sign-in user id (Authentication > Users)

drop table if exists pg_temp.prelaunch_touched;
create temp table prelaunch_touched (action text not null, company text, item_type text, result text, n int not null default 1, item_id uuid);

do $cleanup$
declare
  v_cutoff timestamptz;
  v_expected int;
  v_actor uuid;
  v_marker constant text := 'Pre-launch cleanup (go-live)';
  v_tag constant text := 'prelaunch_cleanup';
  r record;
  v_n bigint;
  v_n2 bigint;
  v_t text;
  v_total bigint;
  v_hash_a text;
  v_hash_b text;
begin
  select p.cutoff, p.expected_total, p.actor_user_id into v_cutoff, v_expected, v_actor from prelaunch_params p;

  -- ---------------------------------------------------------------- PRECONDITIONS (stop, never guess)
  if v_cutoff is null or v_cutoff < timestamptz '2020-01-01 00:00:00+00' then
    raise exception 'REFUSING TO RUN: the cutoff is still the placeholder (or not a real go-live time). Edit EDIT 1 at the top of this file, then run it again. Nothing was changed.';
  end if;
  if v_cutoff > now() then
    raise exception 'REFUSING TO RUN: the cutoff % is in the future. Items submitted between now and then would be swept in. Use the go-live moment once it has passed. Nothing was changed.', v_cutoff;
  end if;
  if v_expected is null or v_expected < 0 then
    raise exception 'REFUSING TO RUN: EXPECTED TOTAL (EDIT 2) is still the placeholder. Run the read-only audit (prelaunch_cleanup_00_audit_readonly.sql) with the same cutoff and type the number from its row "E. TOTAL THE WRITE STEP WOULD CHANGE". Nothing was changed.';
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
    and t.tgname in ('audit_leave_requests', 'audit_approvals', 'audit_recovery_credit_requests', 'audit_recovery_alerts', 'audit_hr_queue_acknowledgements');
  if v_n < 5 then
    raise exception 'REFUSING TO RUN: % of the 5 audit triggers this file relies on are missing or disabled. Fix that first.', 5 - v_n;
  end if;

  -- An OUTSTANDING request that already posted a ledger row: cancelling it without a reversal would leave a balance wrong, and this pack never writes a ledger row.
  select count(*) into v_n from (
    select lr.id from leave_requests lr
    where lr.deleted_at is null and lr.status in ('draft', 'submitted', 'pending_approval') and lr.submitted_at < v_cutoff
      and (exists (select 1 from leave_ledger l where l.reference_type = 'leave_request' and l.reference_id = lr.id and l.entry_type <> 'reversal'
                     and not exists (select 1 from leave_ledger y where y.reversal_of_id = l.id))
           or exists (select 1 from comp_day_ledger l where l.reference_type = 'leave_request' and l.reference_id = lr.id and l.entry_type <> 'reversal'
                        and not exists (select 1 from comp_day_ledger y where y.reversal_of_id = l.id)))
    union all
    select rq.id from recovery_credit_requests rq
    where rq.status in ('submitted', 'pending_approval') and rq.submitted_at < v_cutoff
      and exists (select 1 from comp_day_ledger l
                  where ((l.reference_type = 'recovery_credit_request' and l.reference_id = rq.id)
                         or (rq.attendance_record_id is not null and l.reference_type = 'attendance_record' and l.reference_id = rq.attendance_record_id)
                         or l.id = rq.comp_day_ledger_id)
                    and l.entry_type <> 'reversal' and not exists (select 1 from comp_day_ledger y where y.reversal_of_id = l.id))
  ) b;
  if v_n > 0 then
    raise exception 'REFUSING TO RUN: % outstanding request(s) have already posted a ledger row (see section G of the audit and section 3 of the impact file). Cancelling them without a reversal would leave a balance wrong, and this pack never writes a ledger row. Resolve them first. Nothing was changed.', v_n;
  end if;

  -- THE EXPECTED TOTAL: what this run is about to change, counted by the same rules as the audit's "E. TOTAL" row (and as the loops below).
  select (select count(*) from leave_requests lr where lr.deleted_at is null and lr.status in ('draft', 'submitted', 'pending_approval') and lr.submitted_at < v_cutoff)
       + (select count(*) from recovery_credit_requests rq where rq.status in ('submitted', 'pending_approval') and rq.submitted_at < v_cutoff)
       + (select count(*) from recovery_alerts a where a.status = 'open' and a.triggered_at < v_cutoff)
       + (select count(*) from approvals a join leave_requests lr on a.entity_type = 'leave_request' and a.entity_id = lr.id
            where a.decision = 'pending' and lr.submitted_at < v_cutoff and (lr.status in ('cancelled', 'rejected') or (lr.deleted_at is not null and lr.status <> 'approved')))
       + (select count(*) from approvals a join recovery_credit_requests rq on a.entity_type = 'recovery_credit' and a.entity_id = rq.id
            where a.decision = 'pending' and rq.submitted_at < v_cutoff and rq.status in ('cancelled', 'rejected'))
       + (select count(*) from attendance_records ar join employees e on e.id = ar.employee_id
            where ar.presence_conflict is not null and e.deleted_at is null
              and ((ar.work_date + 1)::timestamp at time zone country_timezone(e.country_code)) - interval '1 microsecond' < v_cutoff
              and ar.work_date >= (now() at time zone country_timezone(e.country_code))::date - 60
              and not exists (select 1 from hr_queue_acknowledgements k where k.kind = 'attendance' and k.source_id = ar.id and k.source_date = ar.work_date))
       + (select count(*) from recovery_windows w join employees e on e.id = w.employee_id
            where w.hr_verification_required and w.hr_verified_at is null and e.deleted_at is null
              and coalesce(w.closed_at, w.created_at) < v_cutoff
              and w.starting_local_date >= (now() at time zone country_timezone(e.country_code))::date - 60
              and not exists (select 1 from hr_queue_acknowledgements k where k.kind = 'attendance' and k.source_id = w.id and k.source_date = w.starting_local_date))
  into v_total;
  if v_total <> v_expected then
    raise exception 'REFUSING TO RUN: EXPECTED TOTAL (EDIT 2) is %, but the database would change % row(s) right now. Something changed since you read the audit, or the cutoff differs. Run the read-only audit again with this cutoff and use its number. Nothing was changed.', v_expected, v_total;
  end if;

  perform set_config('app.audit_origin', v_tag, true);
  raise notice 'Pre-launch cleanup: cutoff used = %; actor = %; expected total = %', v_cutoff, v_actor, v_total;

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

  -- ---------------------------------------------------------------- 1. LEAVE APPLICATIONS: draft / submitted / pending_approval -> cancelled (mirrors cancel_leave_request(); nothing was posted for them)
  for r in
    select lr.id, lr.status::text as st, c.legal_name as company
    from leave_requests lr join employees e on e.id = lr.employee_id join companies c on c.id = e.company_id
    where lr.deleted_at is null and lr.status in ('draft', 'submitted', 'pending_approval') and lr.submitted_at < v_cutoff
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

  -- ---------------------------------------------------------------- 3. ORPHAN APPROVAL STEPS: still pending although the request is already cancelled / rejected / removed (never a step of an approved request)
  with upd as (
    update approvals a
    set decision = 'cancelled', decided_at = now(), comments = case when a.comments is null or a.comments = '' then v_marker else a.comments || ' | ' || v_marker end
    from leave_requests lr, employees e, companies c
    where a.entity_type = 'leave_request' and a.entity_id = lr.id and a.decision = 'pending'
      and (lr.status in ('cancelled', 'rejected') or (lr.deleted_at is not null and lr.status <> 'approved')) and lr.submitted_at < v_cutoff
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

  -- ---------------------------------------------------------------- 4. RECOVERY LEAVE ALERTS: open -> acknowledged (the HR dismissal; the row and its unique key stay)
  with upd as (
    update recovery_alerts a
    set status = 'acknowledged', acknowledged_by = v_actor, acknowledged_at = now(), acknowledgement_note = v_marker
    where a.status = 'open' and a.triggered_at < v_cutoff
    returning a.id, a.company_id, a.alert_type
  )
  insert into prelaunch_touched (action, company, item_type, result, item_id)
  select 'acknowledged', c.legal_name, 'recovery_alert:' || u.alert_type, 'acknowledged', u.id from upd u join companies c on c.id = u.company_id;

  -- ---------------------------------------------------------------- 5. ATTENDANCE EXCEPTIONS still visible in the 60-day look-back: an acknowledgement row (the source record is NOT changed)
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

  -- ---------------------------------------------------------------- 6. REPORT what was left in place (approved in-scope requests: reported, NEVER changed)
  insert into prelaunch_touched (action, company, item_type, result, n)
  select 'left in place', c.legal_name, x.item_type,
         case when x.has_ledger then 'approved, moved a ledger: left in place, not touched' else 'approved, moved no ledger: left in place, not touched' end, count(*)::int
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

  -- ---------------------------------------------------------------- 7. PROVE IT before committing (raise = roll everything back)
  -- 7a. the number of changes is the number the owner typed, and nothing in scope is still outstanding
  select coalesce(sum(t.n), 0) into v_n from prelaunch_touched t where t.action <> 'left in place';
  if v_n <> v_expected then raise exception 'SAFETY STOP: this run changed % row(s) but EXPECTED TOTAL was %. Everything is rolled back.', v_n, v_expected; end if;
  select (select count(*) from leave_requests lr where lr.deleted_at is null and lr.status in ('draft', 'submitted', 'pending_approval') and lr.submitted_at < v_cutoff)
       + (select count(*) from recovery_credit_requests rq where rq.status in ('submitted', 'pending_approval') and rq.submitted_at < v_cutoff)
       + (select count(*) from recovery_alerts a where a.status = 'open' and a.triggered_at < v_cutoff)
       + (select count(*) from approvals a join leave_requests lr on a.entity_type = 'leave_request' and a.entity_id = lr.id
            where a.decision = 'pending' and lr.submitted_at < v_cutoff and lr.status <> 'approved')
       + (select count(*) from approvals a join recovery_credit_requests rq on a.entity_type = 'recovery_credit' and a.entity_id = rq.id
            where a.decision = 'pending' and rq.submitted_at < v_cutoff and rq.status <> 'approved')
  into v_n;
  if v_n > 0 then raise exception 'SAFETY STOP: % in-scope outstanding item(s) are still open after the cleanup. Everything is rolled back.', v_n; end if;

  -- 7b. tables that must be exactly as they were: attendance, clock, windows, payroll, AND BOTH LEDGERS (no ledger row inserted, changed or deleted)
  foreach v_t in array array['attendance_records', 'attendance_sessions', 'attendance_segments', 'recovery_windows', 'payroll_export_runs', 'payroll_export_lines', 'leave_ledger', 'comp_day_ledger'] loop
    execute format('select count(*) from %I', v_t) into v_n;
    execute format('select count(*) from %I', 'prelaunch_snap_' || v_t) into v_n2;
    execute format('select coalesce(md5(string_agg(to_jsonb(x)::text, ''|'' order by x.id)), '''') from %I x', v_t) into v_hash_a;
    execute format('select coalesce(md5(string_agg(to_jsonb(x)::text, ''|'' order by x.id)), '''') from %I x', 'prelaunch_snap_' || v_t) into v_hash_b;
    if v_n <> v_n2 or v_hash_a <> v_hash_b then raise exception 'SAFETY STOP: % changed during the cleanup, which must never happen. Everything is rolled back.', v_t; end if;
  end loop;

  -- 7c. requests, alerts, approvals: only in-scope outstanding rows changed; nothing removed or added; NO APPROVED request changed; nothing at or after the cutoff touched
  if (select count(*) from leave_requests) <> (select count(*) from prelaunch_snap_leave_requests)
     or (select count(*) from recovery_credit_requests) <> (select count(*) from prelaunch_snap_recovery_credit_requests)
     or (select count(*) from recovery_alerts) <> (select count(*) from prelaunch_snap_recovery_alerts)
     or (select count(*) from approvals) <> (select count(*) from prelaunch_snap_approvals) then
    raise exception 'SAFETY STOP: a request, alert or approval row was added or removed. Everything is rolled back.';
  end if;
  select count(*) into v_n from leave_requests t join prelaunch_snap_leave_requests s on s.id = t.id
  where to_jsonb(t) <> to_jsonb(s) and (t.submitted_at >= v_cutoff or s.status::text not in ('draft', 'submitted', 'pending_approval') or t.status::text <> 'cancelled');
  if v_n > 0 then raise exception 'SAFETY STOP: % leave request(s) outside the cleanup scope changed (an approved one must never). Everything is rolled back.', v_n; end if;
  select count(*) into v_n from recovery_credit_requests t join prelaunch_snap_recovery_credit_requests s on s.id = t.id
  where to_jsonb(t) <> to_jsonb(s) and (t.submitted_at >= v_cutoff or s.status::text not in ('submitted', 'pending_approval') or t.status::text <> 'cancelled');
  if v_n > 0 then raise exception 'SAFETY STOP: % Recovery Leave request(s) outside the cleanup scope changed (an approved one must never). Everything is rolled back.', v_n; end if;
  if exists (select 1 from leave_requests t join prelaunch_snap_leave_requests s on s.id = t.id where s.status = 'approved' and to_jsonb(t) <> to_jsonb(s))
     or exists (select 1 from recovery_credit_requests t join prelaunch_snap_recovery_credit_requests s on s.id = t.id where s.status = 'approved' and to_jsonb(t) <> to_jsonb(s)) then
    raise exception 'SAFETY STOP: an approved request changed. Everything is rolled back.';
  end if;
  select count(*) into v_n from recovery_alerts t join prelaunch_snap_recovery_alerts s on s.id = t.id
  where to_jsonb(t) <> to_jsonb(s) and (t.triggered_at >= v_cutoff or s.status <> 'open' or t.status <> 'acknowledged');
  if v_n > 0 then raise exception 'SAFETY STOP: % alert(s) outside the cleanup scope changed. Everything is rolled back.', v_n; end if;
  select count(*) into v_n from approvals t join prelaunch_snap_approvals s on s.id = t.id
  where to_jsonb(t) <> to_jsonb(s) and (t.entity_type::text not in ('leave_request', 'recovery_credit') or s.decision::text <> 'pending' or t.decision::text <> 'cancelled');
  if v_n > 0 then raise exception 'SAFETY STOP: % approval step(s) outside the cleanup scope changed (another type, or a step that was not pending). Everything is rolled back.', v_n; end if;
  if exists (select 1 from approvals t join prelaunch_snap_approvals s on s.id = t.id
             join leave_requests lr on t.entity_type = 'leave_request' and lr.id = t.entity_id
             where to_jsonb(t) <> to_jsonb(s) and lr.status = 'approved')
     or exists (select 1 from approvals t join prelaunch_snap_approvals s on s.id = t.id
                join recovery_credit_requests q on t.entity_type = 'recovery_credit' and q.id = t.entity_id
                where to_jsonb(t) <> to_jsonb(s) and q.status = 'approved') then
    raise exception 'SAFETY STOP: an approval step of an approved request changed. Everything is rolled back.';
  end if;
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
         case when coalesce(sum(t.n), 0) = 0 then 'NOTHING TO CHANGE: already clean (a re-run is harmless)' else 'rows changed' end, coalesce(sum(t.n), 0)::bigint
  from prelaunch_touched t where t.action <> 'left in place'
  union all
  select 3, '2. LEFT IN PLACE (approved: reported, never changed)', t.company, t.item_type, t.action, t.result, sum(t.n)::bigint
  from prelaunch_touched t where t.action = 'left in place' group by t.company, t.item_type, t.action, t.result
) q
order by ord, company collate "C" nulls first, item_type collate "C", action collate "C", result collate "C";
