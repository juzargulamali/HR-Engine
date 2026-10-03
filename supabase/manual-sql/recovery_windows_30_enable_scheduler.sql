-- Recovery Leave windows — STEP 3: ENABLE THE 5-MINUTE BACKGROUND PROCESSOR (owner action, optional but
-- strongly recommended before activating any policy).
--
-- What it is: pg_cron, inside Supabase, calls recovery_process_due() every 5 minutes. That function closes
-- windows whose 24 elapsed hours have passed, creates approval requests, raises HR alerts, retries earlier
-- failures and records every run. It does nothing at all until a windows policy is active (no open windowed
-- periods exist), so it is safe to enable now. If it is never enabled, the daily Vercel route
-- (/api/cron/recovery-windows, vercel.json) still runs it once a day as a safety net — but windows would then
-- close, and alerts appear, only once a day. Vercel's Hobby plan cannot schedule anything more often than daily.
--
-- BEFORE running: in the Supabase Dashboard open Database -> Extensions and enable "pg_cron".
-- Do not claim the 5-minute processing is live until step 3.3 below shows a recent successful run.

-- 3.1  Is pg_cron installed? Expect one row. (If empty: enable it in the Dashboard first.)
select extname, extversion from pg_extension where extname = 'pg_cron';

-- 3.2  Schedule it. Re-running replaces the job of the same name; it never creates a second one.
select cron.schedule('recovery-window-processor', '*/5 * * * *', $$select public.recovery_process_due('pg_cron')$$);

-- 3.3  Verify (wait ~10 minutes, then run). Expect the job active, and the latest runs 'succeeded'.
select jobid, jobname, schedule, active from cron.job where jobname = 'recovery-window-processor';
select status, return_message, start_time, end_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'recovery-window-processor')
order by start_time desc limit 5;
select origin, status, employees_examined, employees_failed, started_at, finished_at
from recovery_processor_runs order by started_at desc limit 5;

-- To STOP it again (does not delete anything):
--   select cron.unschedule('recovery-window-processor');
