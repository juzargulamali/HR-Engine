-- READ ONLY. PRE-LAUNCH CLEANUP, STEP 4 OF 4: VERIFY. Run in the Supabase SQL editor right after the write step (prelaunch_cleanup_10_cleanup.sql) and again whenever you want to be sure. Creates, changes and deletes nothing.
--
-- SET THE CUTOFF. Edit the ONE marked line in the `params` block below: the SAME go-live moment you used in the other three files (see step 1 for exactly what "in scope" means).
--
-- HOW TO READ THE RESULT. One table: ord, item, result. Every row must say OK except the rows marked "information", which are numbers to read. A FAIL row says what to look at; it never changes anything.
--   1      the cutoff is a real value.
--   2 - 6  the live queues hold no in-scope outstanding item: no pending (draft, submitted, pending_approval) leave application, no pending Recovery Leave / comp-off request, no open Recovery Leave alert,
--          no attendance exception still needing action inside the 60-day look-back, no pending approval step of an in-scope request that is not approved.
--   7      anything at or after the cutoff was NOT touched by the cleanup (no audit row with origin 'prelaunch_cleanup' for it, no cleanup marker on it).
--   8      audit rows exist for everything the cleanup cleared (every item carrying the marker "Pre-launch cleanup (go-live)" has an audit_log row whose origin is 'prelaunch_cleanup').
--   9      APPROVED requests were not changed: every cleanup audit row on a leave application or Recovery Leave / comp-off request went from an outstanding status to cancelled (none from approved), and no
--          approval step of an approved request carries the marker. NO LEDGER ROW was written, changed or deleted by the cleanup (no cleanup audit row on leave_ledger or comp_day_ledger, no ledger
--          note carries the marker). No outstanding in-scope request has posted a ledger row. Every item the cleanup acknowledged still has its source record. Snapshot numbers (information) are the
--          ones step 2 printed: the cleanup changes none of them.
--   10     approvals of other types were not touched.
--   11     a re-run of the write step would change nothing (the same selectors, counted now).
--   12     information: approved in-scope requests left in place (still approved) and how many of them moved a ledger.
--   13     information: everything the cleanup wrote to the audit log, by table and action.
-- The byte-for-byte checks (attendance, clock, window and payroll tables; both ledgers; every approved request) are made INSIDE the write step before it commits: it raises and rolls back if any of them fails,
-- so a committed run has already passed them. Here they can only be shown through the audit trail and the numbers.
-- WHAT IS AND IS NOT CHANGED. Nothing is changed by this file. RE-RUNNABLE any number of times.

with params as (
  select timestamptz '2000-01-01 00:00:00+00' as cutoff   -- <<< EDIT THIS ONE VALUE: the go-live moment, with a time zone (step 1 above). It is the only line to edit in this file.
),
items as (
  -- LEAVE APPLICATIONS (a separate request type). Stamp = the ORIGINAL SUBMISSION time, never the leave dates.
  select 'leave_request'::text as item_type, lr.id as item_id, lr.employee_id, e.company_id, lr.status::text as status,
         lr.submitted_at as stamp, lr.start_date as date_from, lr.end_date as date_to, 'yes'::text as live_queue
  from leave_requests lr join employees e on e.id = lr.employee_id
  where lr.deleted_at is null
  union all
  -- COMP-OFF and RECOVERY LEAVE earning requests (one table, recovery_credit_requests): the daily comp-off kind (standard / overnight) and the
  -- working-period window kind (window / top-up / reduction). Stamp = when the request was submitted (the engine's own insert time for window requests).
  select (case when r.event_type in ('window', 'window_top_up', 'window_reduction') then 'recovery_leave_request:' else 'comp_off_request:' end) || r.event_type,
         r.id, r.employee_id, e.company_id, r.status::text, r.submitted_at, r.work_date, r.work_date, 'yes'
  from recovery_credit_requests r join employees e on e.id = r.employee_id
  union all
  -- RECOVERY LEAVE ALERTS (recovery_alerts). Stamp = triggered_at. The Alerts page lists 'open' and 'acknowledged'; 'obsolete' is hidden.
  select 'recovery_alert:' || a.alert_type, a.id, a.employee_id, a.company_id, a.status, a.triggered_at,
         (a.triggered_at at time zone country_timezone(e.country_code))::date, null::date, case when a.status in ('open', 'acknowledged') then 'yes' else 'no (hidden)' end
  from recovery_alerts a join employees e on e.id = a.employee_id
  union all
  -- ATTENDANCE EXCEPTION ALERTS, derived live from the source record (nothing is stored but an acknowledgement):
  --   a day where a manual entry and the clock disagree (attendance_records.presence_conflict). Stamp = the last instant of that work day, in the employee's own time zone.
  select 'attendance_alert:presence_conflict', ar.id, ar.employee_id, e.company_id,
         case when exists (select 1 from hr_queue_acknowledgements k where k.kind = 'attendance' and k.source_id = ar.id and k.source_date = ar.work_date) then 'acknowledged' else 'needs_action' end,
         ((ar.work_date + 1)::timestamp at time zone country_timezone(e.country_code)) - interval '1 microsecond',
         ar.work_date, ar.work_date,
         case when ar.work_date >= (now() at time zone country_timezone(e.country_code))::date - 60 then 'yes' else 'no (older than the 60-day look-back)' end
  from attendance_records ar join employees e on e.id = ar.employee_id
  where ar.presence_conflict is not null and e.deleted_at is null
  union all
  --   a Recovery Leave window waiting for HR verification. Stamp = when the window closed.
  select 'attendance_alert:window_needs_hr_verification', w.id, w.employee_id, w.company_id,
         case when exists (select 1 from hr_queue_acknowledgements k where k.kind = 'attendance' and k.source_id = w.id and k.source_date = w.starting_local_date) then 'acknowledged' else 'needs_action' end,
         coalesce(w.closed_at, w.created_at), w.starting_local_date, w.starting_local_date,
         case when w.starting_local_date >= (now() at time zone country_timezone(e.country_code))::date - 60 then 'yes' else 'no (older than the 60-day look-back)' end
  from recovery_windows w join employees e on e.id = w.employee_id
  where w.hr_verification_required and w.hr_verified_at is null and e.deleted_at is null
),
classified as (
  select i.*, c.legal_name as company, (i.stamp < p.cutoff) as in_scope,
         case
           when i.status in ('submitted', 'pending_approval', 'open', 'needs_action') then 'a_pending'
           when i.status = 'draft' and i.item_type = 'leave_request' then 'a_pending'   -- an unsubmitted leave draft is outstanding too (it is cancelled)
           when i.status = 'approved' and coalesce(i.date_to, date '0001-01-01') >= current_date then 'b_approved_future'
           when i.status = 'draft' then 'd_draft'
           else 'c_historical'
         end as category
  from items i join companies c on c.id = i.company_id cross join params p
),
-- OUTSTANDING requests that have ALREADY posted a ledger row (an unreversed row in leave_ledger or comp_day_ledger). A pending request should never have posted anything; cancelling one WITHOUT a
-- reversal would leave a balance wrong, and this pack never writes a ledger row, so the write step REFUSES to run while any exists (the owner decides first, outside this pack).
blocked as (
  select c.*
  from classified c
  where c.in_scope
    and ((c.item_type = 'leave_request' and c.status in ('draft', 'submitted', 'pending_approval'))
         or ((c.item_type like 'comp_off_request:%' or c.item_type like 'recovery_leave_request:%') and c.status in ('submitted', 'pending_approval')))
    and (
      exists (select 1 from leave_ledger l where c.item_type = 'leave_request' and l.reference_type = 'leave_request' and l.reference_id = c.item_id
                and l.entry_type <> 'reversal' and not exists (select 1 from leave_ledger y where y.reversal_of_id = l.id))
      or exists (select 1 from comp_day_ledger l where c.item_type = 'leave_request' and l.reference_type = 'leave_request' and l.reference_id = c.item_id
                and l.entry_type <> 'reversal' and not exists (select 1 from comp_day_ledger y where y.reversal_of_id = l.id))
      or exists (select 1 from recovery_credit_requests r join comp_day_ledger l
                   on (l.reference_type = 'recovery_credit_request' and l.reference_id = r.id)
                   or (r.attendance_record_id is not null and l.reference_type = 'attendance_record' and l.reference_id = r.attendance_record_id)
                   or l.id = r.comp_day_ledger_id
                 where c.item_type <> 'leave_request' and r.id = c.item_id
                   and l.entry_type <> 'reversal' and not exists (select 1 from comp_day_ledger y where y.reversal_of_id = l.id))
    )
),
-- ORPHAN approval steps: still pending although the in-scope request is already cancelled, rejected or removed (never a step of an approved request).
orphans as (
  select 'leave_request'::text as entity_type, a.id as step_id, co.legal_name as company
  from approvals a join leave_requests lr on a.entity_type = 'leave_request' and a.entity_id = lr.id
  join employees e on e.id = lr.employee_id join companies co on co.id = e.company_id cross join params p
  where a.decision = 'pending' and lr.submitted_at < p.cutoff and (lr.status in ('cancelled', 'rejected') or (lr.deleted_at is not null and lr.status <> 'approved'))
  union all
  select 'recovery_credit', a.id, co.legal_name
  from approvals a join recovery_credit_requests rq on a.entity_type = 'recovery_credit' and a.entity_id = rq.id
  join employees e on e.id = rq.employee_id join companies co on co.id = e.company_id cross join params p
  where a.decision = 'pending' and rq.submitted_at < p.cutoff and rq.status in ('cancelled', 'rejected')
),
marker as (select 'Pre-launch cleanup (go-live)'::text as m)
select ord, item, result
from (
  select 1 as ord, 'the cutoff is a real value (not the placeholder)' as item,
         case when p.cutoff < timestamptz '2020-01-01 00:00:00+00' then 'FAIL - edit the cutoff line to the go-live moment, then run this again' else 'OK - ' || p.cutoff::text end as result
  from params p
  union all select 2, 'no outstanding (draft, submitted, pending_approval) leave application submitted before the cutoff remains',
         case when (select count(*) from classified c where c.in_scope and c.item_type = 'leave_request' and c.status in ('draft', 'submitted', 'pending_approval')) = 0 then 'OK'
              else 'FAIL - ' || (select count(*) from classified c where c.in_scope and c.item_type = 'leave_request' and c.status in ('draft', 'submitted', 'pending_approval')) || ' remain: run the write step' end
  union all select 3, 'no pending Recovery Leave / comp-off request submitted before the cutoff remains',
         case when (select count(*) from classified c where c.in_scope and (c.item_type like 'comp_off_request:%' or c.item_type like 'recovery_leave_request:%') and c.status in ('submitted', 'pending_approval')) = 0 then 'OK'
              else 'FAIL - ' || (select count(*) from classified c where c.in_scope and (c.item_type like 'comp_off_request:%' or c.item_type like 'recovery_leave_request:%') and c.status in ('submitted', 'pending_approval')) || ' remain: run the write step' end
  union all select 4, 'no open Recovery Leave alert triggered before the cutoff remains',
         case when (select count(*) from classified c where c.in_scope and c.item_type like 'recovery_alert:%' and c.status = 'open') = 0 then 'OK'
              else 'FAIL - ' || (select count(*) from classified c where c.in_scope and c.item_type like 'recovery_alert:%' and c.status = 'open') || ' remain: run the write step' end
  union all select 5, 'no attendance exception from before the cutoff still needs action inside the 60-day look-back',
         case when (select count(*) from classified c where c.in_scope and c.item_type like 'attendance_alert:%' and c.status = 'needs_action' and c.live_queue = 'yes') = 0 then 'OK'
              else 'FAIL - ' || (select count(*) from classified c where c.in_scope and c.item_type like 'attendance_alert:%' and c.status = 'needs_action' and c.live_queue = 'yes') || ' remain: run the write step' end
  union all select 6, 'no pending approval step of an in-scope leave / Recovery Leave request remains unless that request is approved',
         case when (select count(*) from approvals a join leave_requests lr on a.entity_type = 'leave_request' and a.entity_id = lr.id cross join params p
                     where a.decision = 'pending' and lr.submitted_at < p.cutoff and lr.status <> 'approved')
                 + (select count(*) from approvals a join recovery_credit_requests rq on a.entity_type = 'recovery_credit' and a.entity_id = rq.id cross join params p
                     where a.decision = 'pending' and rq.submitted_at < p.cutoff and rq.status <> 'approved') = 0 then 'OK' else 'FAIL - a pending step is still waiting on a request that is not approved' end
  union all select 7, 'nothing at or after the cutoff was touched by the cleanup (no cleanup audit row, no cleanup marker)',
         case when not exists (select 1 from audit_log a join classified c on c.item_id = a.record_id and not c.in_scope where a.origin = 'prelaunch_cleanup' and a.table_name in ('leave_requests', 'recovery_credit_requests', 'recovery_alerts'))
               and not exists (select 1 from audit_log a join leave_requests lr on a.table_name = 'approvals' and a.after_data ->> 'entity_type' = 'leave_request' and (a.after_data ->> 'entity_id')::uuid = lr.id cross join params p
                               where a.origin = 'prelaunch_cleanup' and lr.submitted_at >= p.cutoff)
               and not exists (select 1 from audit_log a join recovery_credit_requests rq on a.table_name = 'approvals' and a.after_data ->> 'entity_type' = 'recovery_credit' and (a.after_data ->> 'entity_id')::uuid = rq.id cross join params p
                               where a.origin = 'prelaunch_cleanup' and rq.submitted_at >= p.cutoff)
               and not exists (select 1 from hr_queue_acknowledgements k join classified c on c.item_id = k.source_id and c.item_type like 'attendance_alert:%' and not c.in_scope cross join marker m where k.note = m.m)
               and not exists (select 1 from classified c cross join marker m where not c.in_scope and c.item_type like 'recovery_alert:%'
                               and exists (select 1 from recovery_alerts a where a.id = c.item_id and a.acknowledgement_note = m.m))
              then 'OK' else 'FAIL - an item at or after the cutoff carries the cleanup marker or has a cleanup audit row' end
  union all select 8, 'audit rows exist for everything the cleanup cleared (each marked item has an audit_log row with origin prelaunch_cleanup)',
         case when not exists (select 1 from recovery_credit_requests r cross join marker m where position(m.m in coalesce(r.correction_reason, '')) > 0
                                and not exists (select 1 from audit_log a where a.table_name = 'recovery_credit_requests' and a.record_id = r.id and a.origin = 'prelaunch_cleanup'))
               and not exists (select 1 from recovery_alerts r cross join marker m where r.acknowledgement_note = m.m
                                and not exists (select 1 from audit_log a where a.table_name = 'recovery_alerts' and a.record_id = r.id and a.origin = 'prelaunch_cleanup'))
               and not exists (select 1 from hr_queue_acknowledgements r cross join marker m where r.note = m.m
                                and not exists (select 1 from audit_log a where a.table_name = 'hr_queue_acknowledgements' and a.record_id = r.id and a.origin = 'prelaunch_cleanup'))
               and not exists (select 1 from approvals r cross join marker m where position(m.m in coalesce(r.comments, '')) > 0
                                and not exists (select 1 from audit_log a where a.table_name = 'approvals' and a.record_id = r.id and a.origin = 'prelaunch_cleanup'))
               -- a leave request the cleanup cancelled (its decided_at is the cleanup transaction's own time) has its own audit row; one that was already cancelled before (an orphan step) is not expected to
               and not exists (select 1 from leave_requests lr join audit_log s on s.table_name = 'approvals' and s.origin = 'prelaunch_cleanup' and s.after_data ->> 'entity_type' = 'leave_request'
                                 and (s.after_data ->> 'entity_id')::uuid = lr.id and lr.decided_at = s.occurred_at
                                where not exists (select 1 from audit_log a where a.table_name = 'leave_requests' and a.record_id = lr.id and a.origin = 'prelaunch_cleanup'))
              then 'OK' else 'FAIL - an item carrying the marker has no cleanup audit row (was the audit trigger disabled?)' end
  union all select 9, 'no APPROVED leave application or Recovery Leave / comp-off request was changed by the cleanup (every cleanup audit row on a request goes from outstanding to cancelled)',
         case when not exists (select 1 from audit_log a where a.origin = 'prelaunch_cleanup' and a.table_name in ('leave_requests', 'recovery_credit_requests')
                                and not (a.action = 'update' and a.before_data ->> 'status' in ('draft', 'submitted', 'pending_approval') and a.after_data ->> 'status' = 'cancelled'))
               and not exists (select 1 from approvals r cross join marker m join leave_requests lr on r.entity_type = 'leave_request' and lr.id = r.entity_id
                                where lr.status = 'approved' and position(m.m in coalesce(r.comments, '')) > 0)
               and not exists (select 1 from approvals r cross join marker m join recovery_credit_requests q on r.entity_type = 'recovery_credit' and q.id = r.entity_id
                                where q.status = 'approved' and position(m.m in coalesce(r.comments, '')) > 0)
               and not exists (select 1 from recovery_credit_requests q cross join marker m where q.status = 'approved' and position(m.m in coalesce(q.correction_reason, '')) > 0)
              then 'OK' else 'FAIL - an approved request carries the cleanup marker or was changed by the cleanup' end
  union all select 9, 'NO LEDGER ROW carries the cleanup: no cleanup audit row on leave_ledger or comp_day_ledger (nothing inserted, changed or deleted), no ledger note with the marker',
         case when not exists (select 1 from audit_log a where a.origin = 'prelaunch_cleanup' and a.table_name in ('leave_ledger', 'comp_day_ledger'))
               and not exists (select 1 from leave_ledger l cross join marker m where position(m.m in coalesce(l.note, '')) > 0)
              then 'OK' else 'FAIL - a ledger row was written or changed under the cleanup' end
  union all select 9, 'no outstanding in-scope request has posted a ledger row',
         case when not exists (select 1 from blocked) then 'OK' else 'FAIL - ' || (select count(*) from blocked) || ' outstanding request(s) have an unreversed ledger row: the write step refuses until the owner resolves them' end
  union all select 9, 'every item the cleanup acknowledged still has its source record (attendance day or recovery window), and every cleared request still exists',
         case when not exists (select 1 from hr_queue_acknowledgements k cross join marker m where k.note = m.m and k.kind = 'attendance'
                                and not exists (select 1 from attendance_records ar where ar.id = k.source_id) and not exists (select 1 from recovery_windows w where w.id = k.source_id))
               and not exists (select 1 from audit_log a where a.origin = 'prelaunch_cleanup' and a.table_name = 'leave_requests' and not exists (select 1 from leave_requests lr where lr.id = a.record_id))
               and not exists (select 1 from audit_log a where a.origin = 'prelaunch_cleanup' and a.table_name = 'recovery_credit_requests' and not exists (select 1 from recovery_credit_requests q where q.id = a.record_id))
              then 'OK' else 'FAIL - a source record or a cleared request is missing' end
  union all select 9, 'information: attendance_records (rows / with presence_conflict / sessions) - the same numbers step 2 printed (the cleanup never changes them)',
         (select count(*) from attendance_records) || ' / ' || (select count(*) from attendance_records where presence_conflict is not null) || ' / ' || (select count(*) from attendance_sessions)
  union all select 9, 'information: leave_ledger (rows / net days) - the step 2 numbers (the cleanup never changes a ledger)',
         (select count(*) from leave_ledger) || ' / ' || (select coalesce(sum(amount_days), 0) from leave_ledger)
  union all select 9, 'information: comp_day_ledger (rows / net days) - the step 2 numbers (the cleanup never changes a ledger)',
         (select count(*) from comp_day_ledger) || ' / ' || (select coalesce(sum(days), 0) from comp_day_ledger)
  union all select 9, 'information: payroll_export_runs (rows) / payroll_export_lines (rows / net amount) - never changed by the cleanup',
         (select count(*) from payroll_export_runs) || ' / ' || (select count(*) from payroll_export_lines) || ' / ' || (select coalesce(sum(amount), 0) from payroll_export_lines)
  union all select 10, 'approvals of other types were not touched (no cleanup audit row, no marker)',
         case when not exists (select 1 from audit_log a where a.origin = 'prelaunch_cleanup' and a.table_name = 'approvals' and a.after_data ->> 'entity_type' not in ('leave_request', 'recovery_credit'))
               and not exists (select 1 from approvals r cross join marker m where r.entity_type::text not in ('leave_request', 'recovery_credit') and position(m.m in coalesce(r.comments, '')) > 0)
              then 'OK' else 'FAIL - an approval of another type carries the marker or a cleanup audit row' end
  union all select 11, 'a re-run of the write step would change nothing (outstanding in-scope items counted again: requests, alerts, exceptions in the look-back, orphan steps)',
         case when (select count(*) from classified c where c.in_scope and c.category = 'a_pending' and c.live_queue = 'yes') + (select count(*) from orphans) = 0
              then 'OK' else 'FAIL - the write step would still change ' || ((select count(*) from classified c where c.in_scope and c.category = 'a_pending' and c.live_queue = 'yes') + (select count(*) from orphans)) || ' row(s)' end
  union all select 12, 'information: in-scope APPROVED requests (left in place, never changed by this pack) / of those, how many moved a ledger',
         (select count(*) from classified c where c.in_scope and c.status = 'approved' and (c.item_type = 'leave_request' or c.item_type like 'comp_off_request:%' or c.item_type like 'recovery_leave_request:%'))
         || ' / ' || (select count(*) from classified c where c.in_scope and c.status = 'approved'
                        and ((c.item_type = 'leave_request' and (exists (select 1 from leave_ledger l where l.reference_type = 'leave_request' and l.reference_id = c.item_id) or exists (select 1 from comp_day_ledger l where l.reference_type = 'leave_request' and l.reference_id = c.item_id)))
                          or (c.item_type <> 'leave_request' and exists (select 1 from recovery_credit_requests r join comp_day_ledger l
                                on (l.reference_type = 'recovery_credit_request' and l.reference_id = r.id) or (r.attendance_record_id is not null and l.reference_type = 'attendance_record' and l.reference_id = r.attendance_record_id) or l.id = r.comp_day_ledger_id
                                where r.id = c.item_id))))
  union all select 13, 'information: cleanup audit rows by table / action: ' || coalesce(a.table_name, '-') || ' / ' || coalesce(a.action, '-'), count(*)::text
  from audit_log a where a.origin = 'prelaunch_cleanup' group by a.table_name, a.action
) x
order by ord, item collate "C";
