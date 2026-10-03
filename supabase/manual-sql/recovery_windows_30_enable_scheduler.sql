-- Recovery Leave windows — STEP 4: ENABLE THE 5-MINUTE BACKGROUND PROCESSOR (owner action).
-- *** REQUIRED before any windows policy can be activated. *** activate_recovery_windows_policy() checks it and refuses
-- until the check at 4.4 below says ready = true.
--
-- What it is: pg_cron, inside Supabase, calls recovery_process_due() every 5 minutes. That function closes
-- windows whose 24 elapsed hours have passed, creates approval requests, raises HR alerts, retries earlier
-- failures and records every run. It does nothing at all until a windows policy is active (no open windowed
-- periods exist), so it is safe to enable now. The daily Vercel route (/api/cron/recovery-windows, vercel.json)
-- is only a once-a-day safety net (Vercel's Hobby plan cannot schedule anything more often than daily); it does
-- NOT count as verification.
--
-- BEFORE running: in the Supabase Dashboard (project "Enginious HR Engine_V2") open Database -> Extensions and
-- enable "pg_cron". The job runs INSIDE the database, so it can only ever act on the database it is created in.

-- 4.1  Is pg_cron installed? Expect one row. (If empty: enable it in the Dashboard first.)
select extname, extversion from pg_extension where extname = 'pg_cron';

-- 4.2  Schedule it. Re-running replaces the job of the same name; it never creates a second one.
select cron.schedule('recovery-window-processor', '*/5 * * * *', $$select public.recovery_process_due('pg_cron')$$);

-- 4.3  Evidence (wait ~10 minutes, then run). Expect the job active, and the latest runs 'succeeded' with origin 'pg_cron'.
select jobid, jobname, schedule, active from cron.job where jobname = 'recovery-window-processor';
select status, return_message, start_time, end_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'recovery-window-processor')
order by start_time desc limit 5;
select origin, status, employees_examined, employees_failed, started_at, finished_at
from recovery_processor_runs order by started_at desc limit 5;

-- 4.4  THE GATE. Expect ready = true and an empty reasons list. If false, the reasons say exactly what is missing.
--      Do not activate any policy until this is true (activation re-checks it and will refuse anyway).
select recovery_scheduler_ready() as scheduler_ready;

-- To retire the scheduler later, DO NOT run cron.unschedule directly: use recovery_windows_40_disable_and_reconcile.sql
-- (it refuses while any windowed period is still being finished).
