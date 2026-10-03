-- Recovery Leave windows — DISABLE / ROLLBACK and RECONCILE. Nothing here deletes sessions, credits or audit rows.
--
-- The migration itself is additive and dormant, so "rollback" never means dropping tables: the app keeps working
-- on the existing rules whether or not the new tables exist. What you may need to do is STOP the window model
-- being used for NEW work, finish what it already started, and then account for it.
--
-- ORDER MATTERS:  A (stop new periods)  ->  keep the 5-minute processor running  ->  B (retire it only when C.0 is all zero).

-- A. Stop new working periods being created.
--    Preferred: in the app, as an HR Admin / CEO / CTO whose grant is not limited to one company, call
--        deactivate_recovery_windows_policy(<policy version id>, <last effective date, tomorrow or later>)
--    It ends the windows version on that date, leaves every record exactly as it is, and re-drafts the earlier
--    version's wording for the normal two-person activation. Clock-ins after that date are stamped 'legacy' again —
--    EXCEPT a restart less than 8 hours after a windowed session: that stays in the SAME working period under the
--    rules it started with (never split, never awarded twice). Periods already running are finished by the
--    5-minute processor, which MUST KEEP RUNNING until C.0 below is all zero.
--
--    Emergency fallback (SQL Editor, runs as the database owner): end the version yourself. Replace the id/date.
--      update policy_versions
--         set effective_to = date '2027-01-01'   -- the LAST day the window model still applies
--       where id = '00000000-0000-0000-0000-000000000000'
--         and policy_type = 'overtime_rules' and payload ->> 'model' = 'recovery_windows' and status = 'active';

-- C.0  WHAT THE PROCESSOR STILL HAS TO FINISH. The scheduler may only be retired when all four numbers are 0.
select recovery_windowed_work_remaining() as work_remaining;

-- B. Retire the 5-minute scheduler. GUARDED: this refuses (and changes nothing) while any windowed period, open
--    windowed session, unresolved failure or unrouted request remains. Run it only after A and after C.0 is zero.
--    (Also remove the "/api/cron/recovery-windows" entry from vercel.json in a normal change if you want it gone.)
do $retire$
declare
  v_left jsonb := recovery_windowed_work_remaining();
begin
  if (select coalesce(sum(value::int), 0) from jsonb_each_text(v_left)) > 0 then
    raise exception 'Not retiring the scheduler: windowed work is still being finished: %', v_left;
  end if;
  if exists (select 1 from policy_versions where policy_type = 'overtime_rules' and status = 'active'
             and payload ->> 'model' = 'recovery_windows' and (effective_to is null or effective_to >= current_date)) then
    raise exception 'Not retiring the scheduler: a Recovery Leave windows policy is still active or still has a future end date.';
  end if;
  perform cron.unschedule('recovery-window-processor');
  raise notice 'recovery-window-processor unscheduled.';
end
$retire$;

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
