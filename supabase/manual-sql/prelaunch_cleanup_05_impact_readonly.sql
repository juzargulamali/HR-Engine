-- READ ONLY. PRE-LAUNCH CLEANUP, STEP 2 OF 4: THE IMPACT (INFORMATION ONLY). Run after step 1 (prelaunch_cleanup_00_audit_readonly.sql), in the Supabase SQL editor of the same database. Creates, changes and deletes nothing.
--
-- WHAT THIS IS FOR. A pending request has moved nothing, so cancelling it is harmless. An APPROVED request may already have moved a leave balance (leave_ledger), a comp-off / Recovery Leave credit
-- (comp_day_ledger), be tied to an attendance record, or sit in a payroll period that was already exported. This file lists exactly which in-scope requests did, with the exact ledger rows, so you can see what
-- the cleanup is NOT touching. THE CLEANUP NEVER CHANGES AN APPROVED REQUEST, A LEDGER ROW, AN ATTENDANCE RECORD OR A PAYROLL ROW, whatever their dates. There is nothing to approve or reverse here.
-- It also checks the other direction: an OUTSTANDING request must not have posted a ledger row. If one did, cancelling it without a reversal would leave a balance wrong, so the write step REFUSES to run
-- while any exists (section 3 below, and section G of step 1): you decide what to do with it first, outside this pack, and run this file again.
--
-- SET THE CUTOFF. Edit the ONE marked line in the `params` block below: the SAME go-live moment you used in step 1 (see that file for exactly what "in scope" means: submission / trigger time before
-- the cutoff, never the leave dates). While it is still the placeholder (the year 2000) no row is in scope and this file lists nothing but the snapshot.
--
-- HOW TO READ THE RESULT. One table: section, company, employee, item_type, item_id, status, summary, detail (detail is JSON text).
--   1. REQUEST WITH AN EFFECT        one row per in-scope request that moved something. detail: leave_ledger / comp_day_ledger row counts and net days, attendance links, payroll references.
--                                    Flags in summary:  LEAVE-LEDGER, COMP-LEDGER, ATTENDANCE, PAYROLL-LINE (a payroll export line points at one of its ledger rows),
--                                    PAYROLL-PERIOD (the leave or work dates fall in a payroll period that is approved or already sent, and the employee has lines in it).
--                                    "the write step: ..." says what step 3 does with it: an approved request is LEFT UNTOUCHED, an outstanding one is cancelled.
--   2. LEDGER ROW                    the exact ledger rows of those requests (ledger, id, entry type, amount, date, whether already reversed). Information only: none is ever written, changed or deleted.
--   3. OUTSTANDING REQUEST THAT ALREADY POSTED A LEDGER ROW   EXPECTED: NONE. A row here means the write step will REFUSE until it is resolved by the owner outside this pack.
--   4. SNAPSHOT                      counts and sums of the source records the write step must never change (attendance, ledgers, payroll). Step 4 prints the same numbers.
--
-- WHAT HAPPENS TO WHAT (the write step, for every in-scope request): draft / submitted / pending_approval leave and submitted / pending_approval Recovery Leave or comp-off requests -> cancelled, and their
-- pending approval steps closed; approved -> LEFT UNTOUCHED; rejected, cancelled -> untouched. Attendance records, clock sessions and segments, ledgers and payroll tables are NEVER changed.
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
reqs as (
  select c.*, e.first_name || ' ' || e.last_name as employee
  from classified c join employees e on e.id = c.employee_id
  where c.in_scope and (c.item_type = 'leave_request' or c.item_type like 'comp_off_request:%' or c.item_type like 'recovery_leave_request:%')
),
ledger_rows as (
  select 'leave_ledger'::text as ledger, l.id as ledger_id, rq.item_id, l.employee_id, l.leave_type_code as bucket, l.txn_date, l.entry_type::text as entry_type, l.amount_days as amount,
         l.reference_type, l.reference_id, l.reversal_of_id, exists (select 1 from leave_ledger x where x.reversal_of_id = l.id) as reversed
  from reqs rq join leave_ledger l on rq.item_type = 'leave_request' and l.reference_type = 'leave_request' and l.reference_id = rq.item_id
  union all
  select 'comp_day_ledger', c.id, rq.item_id, c.employee_id, 'comp_off', c.txn_date, c.entry_type::text, c.days, c.reference_type, c.reference_id, c.reversal_of_id,
         exists (select 1 from comp_day_ledger x where x.reversal_of_id = c.id)
  from reqs rq join comp_day_ledger c on rq.item_type = 'leave_request' and c.reference_type = 'leave_request' and c.reference_id = rq.item_id
  union all
  select 'comp_day_ledger', c.id, rq.item_id, c.employee_id, 'comp_off', c.txn_date, c.entry_type::text, c.days, c.reference_type, c.reference_id, c.reversal_of_id,
         exists (select 1 from comp_day_ledger x where x.reversal_of_id = c.id)
  from reqs rq join recovery_credit_requests r on r.id = rq.item_id and rq.item_type <> 'leave_request'
  join comp_day_ledger c on (c.reference_type = 'recovery_credit_request' and c.reference_id = r.id)
                         or (r.attendance_record_id is not null and r.status not in ('cancelled', 'rejected') and c.reference_type = 'attendance_record' and c.reference_id = r.attendance_record_id)
                         or c.id = r.comp_day_ledger_id
),
eff as (
  select rq.item_id,
         (select count(*) from ledger_rows x where x.item_id = rq.item_id and x.ledger = 'leave_ledger') as leave_rows,
         (select coalesce(sum(x.amount), 0) from ledger_rows x where x.item_id = rq.item_id and x.ledger = 'leave_ledger') as leave_net,
         (select count(*) from ledger_rows x where x.item_id = rq.item_id and x.ledger = 'comp_day_ledger') as comp_rows,
         (select coalesce(sum(x.amount), 0) from ledger_rows x where x.item_id = rq.item_id and x.ledger = 'comp_day_ledger') as comp_net,
         -- attendance: a leave request does not write attendance, but HR 'leave' days on its dates would disagree with a cancelled request; a daily comp-off request is BORN from a record or a clock segment
         case when rq.item_type = 'leave_request'
              then (select count(*) from attendance_records ar where ar.employee_id = rq.employee_id and ar.work_date between rq.date_from and rq.date_to and ar.status = 'leave')
              else (select count(*) from recovery_credit_requests r join attendance_records ar on ar.id = r.attendance_record_id where r.id = rq.item_id) end as att_records,
         case when rq.item_type = 'leave_request' then 0
              else (select count(*) from recovery_credit_requests r where r.id = rq.item_id and r.segment_id is not null)
                 + (select count(*) from recovery_window_allocations a join recovery_credit_requests r on r.recovery_window_id = a.window_id where r.id = rq.item_id) end as att_segments,
         (select count(*) from ledger_rows x join payroll_export_lines pl on pl.source_reference_type = 'leave_ledger' and pl.source_reference_id = x.ledger_id
           where x.item_id = rq.item_id and x.ledger = 'leave_ledger') as payroll_refs,
         (select count(*) from payroll_export_runs pr
           where pr.company_id = rq.company_id and (pr.status = 'approved' or pr.sent_at is not null)
             and make_date(pr.period_year, pr.period_month, 1) <= rq.date_to and (make_date(pr.period_year, pr.period_month, 1) + interval '1 month')::date > rq.date_from
             and exists (select 1 from payroll_export_lines pl where pl.run_id = pr.id and pl.employee_id = rq.employee_id)) as payroll_periods
  from reqs rq
)
select section, company, employee, item_type, item_id, status, summary, detail
from (
  select 0 as ord, '0. CUTOFF IN USE' as section, null::text as company, null::text as employee, 'cutoff' as item_type, null::uuid as item_id, null::text as status,
         case when p.cutoff < timestamptz '2020-01-01 00:00:00+00' then 'PLACEHOLDER: edit the cutoff line before relying on this file' else p.cutoff::text end as summary, null::text as detail
  from params p
  union all
  select 1, '1. REQUEST WITH AN EFFECT', rq.company, rq.employee, rq.item_type, rq.item_id, rq.status,
         concat_ws(' ', case when f.leave_rows > 0 then 'LEAVE-LEDGER' end, case when f.comp_rows > 0 then 'COMP-LEDGER' end, case when f.att_records + f.att_segments > 0 then 'ATTENDANCE' end,
                   case when f.payroll_refs > 0 then 'PAYROLL-LINE' end, case when f.payroll_periods > 0 then 'PAYROLL-PERIOD' end)
         || '; the write step: ' || case when exists (select 1 from blocked b where b.item_id = rq.item_id) then 'REFUSES TO RUN: this outstanding request has already posted a ledger row (see section 3)'
                                         when rq.status in ('draft', 'submitted', 'pending_approval') then 'cancels the request (nothing was posted)'
                                         when rq.status = 'approved' then 'LEAVES IT UNTOUCHED (an approved request is never changed by this pack, nor its balance rows)'
                                         else 'does not touch it (already ' || rq.status || ')' end,
         jsonb_build_object('category', rq.category, 'dates', rq.date_from || ' to ' || rq.date_to, 'submitted_or_triggered_at', rq.stamp, 'leave_ledger_rows', f.leave_rows, 'leave_ledger_net_days', f.leave_net,
                            'comp_ledger_rows', f.comp_rows, 'comp_ledger_net_days', f.comp_net, 'attendance_records_linked', f.att_records, 'clock_segments_as_evidence', f.att_segments,
                            'payroll_lines_referencing_its_ledger_rows', f.payroll_refs, 'approved_or_sent_payroll_periods_covering_its_dates', f.payroll_periods)::text
  from reqs rq join eff f on f.item_id = rq.item_id
  where f.leave_rows + f.comp_rows + f.att_records + f.att_segments + f.payroll_refs + f.payroll_periods > 0
  union all
  select 2, '2. LEDGER ROW', rq.company, rq.employee, rq.item_type, rq.item_id, rq.status, x.ledger || ' ' || x.entry_type || ' ' || x.amount || ' on ' || x.txn_date || case when x.reversed then ' (already reversed)' else '' end,
         jsonb_build_object('ledger', x.ledger, 'ledger_row_id', x.ledger_id, 'bucket', x.bucket, 'entry_type', x.entry_type, 'amount', x.amount, 'txn_date', x.txn_date,
                            'reference_type', x.reference_type, 'reference_id', x.reference_id, 'reversal_of_id', x.reversal_of_id, 'already_reversed', x.reversed)::text
  from ledger_rows x join reqs rq on rq.item_id = x.item_id
  union all
  select 3, '3. OUTSTANDING REQUEST THAT ALREADY POSTED A LEDGER ROW: THE WRITE STEP WILL REFUSE (expected: none)', b.company, e.first_name || ' ' || e.last_name, b.item_type, b.item_id, b.status,
         'LOUD: this outstanding request has an unreversed ledger row. Cancelling it without a reversal would leave a balance wrong, and this pack never writes a ledger row. Resolve it first.',
         jsonb_build_object('dates', b.date_from || ' to ' || b.date_to, 'category', b.category)::text
  from blocked b join employees e on e.id = b.employee_id
  union all
  select 6, '4. SNAPSHOT (the write step must leave every one of these exactly as it is)', null, null, 'snapshot', null, null, m.name, m.val
  from (
    select 'attendance_records (rows)' as name, count(*)::text as val from attendance_records
    union all select 'attendance_records with presence_conflict', count(*)::text from attendance_records where presence_conflict is not null
    union all select 'attendance_sessions (rows)', count(*)::text from attendance_sessions
    union all select 'leave_ledger (rows / net days)', count(*) || ' / ' || coalesce(sum(amount_days), 0) from leave_ledger
    union all select 'comp_day_ledger (rows / net days)', count(*) || ' / ' || coalesce(sum(days), 0) from comp_day_ledger
    union all select 'payroll_export_runs (rows / approved or sent)', count(*) || ' / ' || count(*) filter (where status = 'approved' or sent_at is not null) from payroll_export_runs
    union all select 'payroll_export_lines (rows / net amount)', count(*) || ' / ' || coalesce(sum(amount), 0) from payroll_export_lines
    union all select 'approvals of other types, pending', count(*)::text from approvals where decision = 'pending' and entity_type::text not in ('leave_request', 'recovery_credit')
  ) m
) q
order by ord, company collate "C" nulls first, employee collate "C" nulls first, item_type collate "C", item_id nulls first, summary collate "C";
