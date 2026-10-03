-- Recovery Leave windows — DISABLE / ROLLBACK and RECONCILE. Nothing here deletes sessions, credits or audit rows.
--
-- The migration itself is additive and dormant, so "rollback" never means dropping tables: the app keeps working
-- on the existing rules whether or not the new tables exist. What you may need to do is STOP the window model
-- being used for NEW work, and then account for anything it already created.

-- A. Stop new working periods being created.
--    Preferred: in the app, as a company-unscoped HR Admin, call
--        deactivate_recovery_windows_policy(<policy version id>, <last effective date, tomorrow or later>)
--    It ends the windows version on that date (clock-ins after it are stamped 'legacy' again), leaves every record
--    exactly as it is, lets periods already running finish under their own rules, and re-drafts the earlier
--    version's wording for the normal two-person activation.
--
--    Emergency fallback (SQL Editor, runs as the database owner): end the version yourself. Replace the id/date.
--      update policy_versions
--         set effective_to = date '2027-01-01'   -- the LAST day the window model still applies
--       where id = '00000000-0000-0000-0000-000000000000'
--         and policy_type = 'overtime_rules' and payload ->> 'model' = 'recovery_windows' and status = 'active';

-- B. Stop the background processing (only if you want everything quiet; periods already running will then NOT
--    be closed automatically until you re-enable it):
--      select cron.unschedule('recovery-window-processor');
--    and remove the "/api/cron/recovery-windows" entry from vercel.json in a normal change.

-- C. RECONCILE what the window model created (read-only):
-- C.1  Periods and windows by state.
select p.status as period_status, w.status as window_status, count(*) as windows,
       coalesce(sum(w.entitlement_days), 0) as entitlement_days_if_all_approved
from recovery_windows w join recovery_periods p on p.id = w.period_id
group by 1, 2 order by 1, 2;

-- C.2  Requests it created, by type and status (pending ones still need a decision, or cancelling in the app).
select event_type, status, count(*) as requests, coalesce(sum(proposed_days), 0) as days
from recovery_credit_requests where recovery_window_id is not null
group by 1, 2 order by 1, 2;

-- C.3  Credits already posted to the ledger by the window model (review each; reverse through the app's normal
--      HR process if they should not stand — never delete rows).
select cl.id, cl.employee_id, cl.txn_date, cl.entry_type, cl.days, cl.source, cl.expiry_date, cl.created_at
from comp_day_ledger cl
where cl.source in ('recovery_window', 'recovery_window_top_up', 'recovery_window_reduction')
order by cl.created_at;

-- C.4  Sessions still running under the window model (they keep it until they close).
select s.id, s.employee_id, s.clock_in_at from attendance_sessions s where s.status = 'open' and s.recovery_model = 'windowed';

-- C.5  Open alerts and unresolved processor failures.
select alert_type, status, count(*) from recovery_alerts group by 1, 2 order by 1, 2;
select employee_id, error, created_at from recovery_processor_failures where resolved_at is null order by created_at;
