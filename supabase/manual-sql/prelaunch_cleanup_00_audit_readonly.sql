-- READ ONLY. PRE-LAUNCH CLEANUP, STEP 1 OF 4: THE COUNTS. Run in the Supabase SQL editor of the database you intend to clean (Production). Creates, changes and deletes nothing.
--
-- WHAT THIS IS FOR. Before go-live the owner clears the requests and alerts that were created while the system was being tried out, so the live queues (My Day, Alerts, Approvals, the employee
-- profile) start empty and honest. This is the first of four hand-run files (never a migration, never run by a deployment):
--   prelaunch_cleanup_00_audit_readonly.sql   this file: how many items exist, by company, type and status
--   prelaunch_cleanup_05_impact_readonly.sql  which of them already moved a balance, a comp-off credit, an attendance record or a payroll export, and the PROPOSED reversal entries
--   prelaunch_cleanup_10_cleanup.sql          the write step (one transaction; refuses to run until the cutoff is set; reverses NOTHING unless you list request ids)
--   prelaunch_cleanup_20_verify_readonly.sql  the checks after the write step
-- Read the counts, then the impact file, and only then decide whether to run the write step. If anything surprises you, stop: nothing has been changed.
--
-- STEP 1 FOR THE OWNER: SET THE CUTOFF. Edit the ONE marked line in the `params` block below (it is the only line to edit in this file). The cutoff is the go-live moment, with a time zone,
-- for example  timestamptz '2027-01-18 06:00:00+00'.  Put the SAME value in the other three files. A row is IN SCOPE only if it was ORIGINALLY SUBMITTED (or its alert was TRIGGERED) BEFORE the cutoff:
-- leave applications and Recovery Leave / comp-off requests use submitted_at, Recovery Leave alerts use triggered_at, an attendance exception uses the last instant of the day it is about (a day that
-- is not over at the cutoff stays), a Recovery Leave window waiting for HR verification uses the moment the window closed. The LEAVE DATES are never used: a leave application submitted before the
-- cutoff for a date next month IS in scope, and anything submitted at or after the cutoff stays exactly as it is.
-- While the cutoff is still the placeholder (the year 2000) every row counts as "at or after the cutoff" and the first result row says PLACEHOLDER.
--
-- WHAT IT COVERS (the tables found in this schema):
--   leave_requests                   leave applications (status draft / submitted / pending_approval / approved / rejected / cancelled; rows already removed with deleted_at are ignored)
--   recovery_credit_requests         Recovery Leave and comp-off EARNING requests: comp_off_request:standard and :overnight (the daily rule) and recovery_leave_request:window, :window_top_up, :window_reduction
--   approvals                        the approval steps of the two request types above (every other entity type is counted separately and is never touched)
--   recovery_alerts                  Recovery Leave alerts (long_work, window_rollover; status open / acknowledged / obsolete)
--   attendance exceptions            derived live, never stored: a day with presence_conflict, and a closed Recovery Leave window waiting for HR verification; the only stored part is the
--                                    acknowledgement in hr_queue_acknowledgements
--   NOT PRESENT in this schema: a separate "attendance request" or "regularisation" table or approval (manual attendance entries are attendance_records rows written by HR, which are source
--   records and are never cleared), and any notification written for a leave, attendance or Recovery Leave request (the notifications table only holds project, budget, operations and document-expiry
--   messages). Payroll tables are only READ, in the impact file.
--
-- HOW TO READ THE RESULT. One table. Columns: section, company, item_type, status, scope, live_queue, count.
--   0  the cutoff in use.
--   A  PENDING: requests waiting for a decision (submitted, pending_approval) and alerts that still need action (open, needs_action). THESE are what the write step clears.
--   B  APPROVED and the dates are today or later (leave still to be taken; a credit is never in the future). The write step leaves these alone unless you list the ids as approved reversals.
--   C  COMPLETED OR HISTORICAL: approved and past, rejected, cancelled, acknowledged, obsolete. Never changed.
--   D  DRAFT: never visible in any queue. Never changed.
--   E  WHAT THE WRITE STEP WOULD CHANGE RIGHT NOW (in scope, outstanding, visible in a live queue): cancelled for requests, acknowledged for alerts. A number here that you did not expect is the stop sign.
--   F  APPROVAL STEPS: steps of in-scope leave and Recovery Leave requests, and a count of every other approval type (those are NOT touched). "ORPHAN" means a step still pending although its
--      request is already cancelled, rejected or removed (it shows on the approver's page for nothing; the write step closes it).
--   scope tells the same rows apart: IN SCOPE (before the cutoff) versus untouched (at or after the cutoff, shown for transparency).
--   live_queue: an attendance exception older than 60 days is outside the look-back every screen uses, so it is in no live queue (it is counted, and the write step leaves it).
-- Times: "today" in this file is the database's current date (UTC). A leave application that starts today or later counts as B.
--
-- EXPECTED RESULT. Only counts: nothing here is a pass or a fail. After a successful write step, sections A and E read zero for rows before the cutoff (step 4 checks this properly).
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
           when i.status = 'approved' and coalesce(i.date_to, date '0001-01-01') >= current_date then 'b_approved_future'
           when i.status = 'draft' then 'd_draft'
           else 'c_historical'
         end as category
  from items i join companies c on c.id = i.company_id cross join params p
),
steps as (
  -- approval steps: leave and Recovery Leave steps are attributed to the request's company and scope; the request status tells a live step from an orphan.
  select 'leave_request'::text as entity_type, a.decision::text as decision, c.legal_name as company, (lr.submitted_at < p.cutoff) as in_scope,
         (lr.status::text in ('cancelled', 'rejected') or lr.deleted_at is not null) as orphan
  from approvals a join leave_requests lr on lr.id = a.entity_id and a.entity_type = 'leave_request'
  join employees e on e.id = lr.employee_id join companies c on c.id = e.company_id cross join params p
  union all
  select 'recovery_credit', a.decision::text, c.legal_name, (r.submitted_at < p.cutoff), (r.status::text in ('cancelled', 'rejected'))
  from approvals a join recovery_credit_requests r on r.id = a.entity_id and a.entity_type = 'recovery_credit'
  join employees e on e.id = r.employee_id join companies c on c.id = e.company_id cross join params p
)
select section, company, item_type, status, scope, live_queue, count
from (
  select 0 as ord, '0. CUTOFF IN USE' as section, null::text as company, 'cutoff' as item_type,
         case when p.cutoff < timestamptz '2020-01-01 00:00:00+00' then 'PLACEHOLDER: edit the cutoff line before relying on any count below' else p.cutoff::text end as status,
         null::text as scope, null::text as live_queue, null::int as count
  from params p
  union all
  select case x.category when 'a_pending' then 1 when 'b_approved_future' then 2 when 'c_historical' then 3 else 4 end,
         case x.category when 'a_pending' then 'A. PENDING (requests awaiting a decision, alerts needing action)'
                         when 'b_approved_future' then 'B. APPROVED, dates today or later'
                         when 'c_historical' then 'C. COMPLETED OR HISTORICAL (approved and past, rejected, cancelled, acknowledged, obsolete)'
                         else 'D. DRAFT (in no queue)' end,
         x.company, x.item_type, x.status,
         case when x.in_scope then 'IN SCOPE (before the cutoff)' else 'untouched (at or after the cutoff)' end, x.live_queue, count(*)::int
  from classified x group by x.category, x.company, x.item_type, x.status, x.in_scope, x.live_queue
  union all
  select 5, 'E. THE WRITE STEP WOULD CHANGE (cancel requests, acknowledge alerts) RIGHT NOW', x.company, x.item_type, x.status || ' -> ' || case when x.item_type like '%request%' then 'cancelled' else 'acknowledged' end,
         'IN SCOPE (before the cutoff)', x.live_queue, count(*)::int
  from classified x where x.in_scope and x.category = 'a_pending' and x.live_queue = 'yes'
  group by x.company, x.item_type, x.status, x.live_queue
  union all
  select 6, 'F. APPROVAL STEPS', s.company, 'approval_step:' || s.entity_type,
         s.decision || case when s.orphan and s.decision = 'pending' then ' (ORPHAN: request already cancelled, rejected or removed)' else '' end,
         case when s.in_scope then 'IN SCOPE (before the cutoff)' else 'untouched (at or after the cutoff)' end, null, count(*)::int
  from steps s group by s.company, s.entity_type, s.decision, s.orphan, s.in_scope
  union all
  select 7, 'F. APPROVAL STEPS', null, 'approval_step:' || a.entity_type::text || ' (other type: NEVER touched)', a.decision::text, 'not in scope', null, count(*)::int
  from approvals a where a.entity_type::text not in ('leave_request', 'recovery_credit') group by a.entity_type, a.decision
) q
order by ord, company nulls first, item_type, status, scope;
