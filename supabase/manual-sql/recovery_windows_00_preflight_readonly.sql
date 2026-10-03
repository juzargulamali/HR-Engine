-- Recovery Leave windows — STEP 0: READ-ONLY PRODUCTION PREFLIGHT.
--
-- Paste into the Supabase SQL Editor and run BEFORE applying anything. Every statement is a
-- plain SELECT: it changes nothing, needs no special privilege beyond the SQL Editor's own, and
-- exposes no credential or secret. Read each result and compare with the "Expect" note.
-- (The query results contain employee numbers and counts, never passwords/tokens/keys.)

-- 0.1  Which database am I on? (Confirm this is the project you mean to change.)
select current_database() as database, current_user as run_as, version() as postgres_version;

-- 0.2  Prerequisites already deployed?  Expect every column below = true.
select
  to_regclass('public.attendance_sessions') is not null                              as has_attendance_sessions,
  to_regclass('public.attendance_segments') is not null                              as has_attendance_segments,
  to_regclass('public.recovery_credit_requests') is not null                         as has_recovery_credit_requests,
  to_regprocedure('public.sync_attendance_presence_for_day(uuid,date)') is not null  as has_presence_sync,
  to_regprocedure('public.hr_close_attendance_session(uuid,timestamptz,text)') is not null as has_hr_close,
  exists (select 1 from information_schema.columns where table_name = 'attendance_records' and column_name = 'presence_conflict') as has_presence_conflict_column;

-- 0.3  The new feature must NOT be installed yet.  Expect every column = false.
select
  to_regclass('public.recovery_periods') is not null                                 as periods_exist,
  to_regclass('public.recovery_windows') is not null                                 as windows_exist,
  exists (select 1 from information_schema.columns where table_name = 'attendance_sessions' and column_name = 'recovery_model') as sessions_have_recovery_model,
  to_regprocedure('public.recovery_recalculate_employee(uuid,timestamptz,text,text,uuid)') is not null as engine_exists;

-- 0.4  Recovery Leave (overtime_rules) policy versions today.  Expect: no row with model = recovery_windows.
select country_code, version_no, status, effective_from, effective_to,
       payload ->> 'model' as model, payload ->> 'policy_name' as policy_name
from policy_versions
where policy_type = 'overtime_rules'
order by country_code, version_no;

-- 0.5  Sessions open RIGHT NOW (these finish under the existing same-day rule; the migration does not touch them).
select count(*) as open_sessions, min(clock_in_at) as oldest_open_since from attendance_sessions where status = 'open';

-- 0.6  Recovery requests still in flight under the existing rules (they keep their own approval chain).
select event_type, applicant_route, status, count(*) as requests
from recovery_credit_requests
group by event_type, applicant_route, status
order by event_type, applicant_route, status;

-- 0.7  Starting Recovery Leave balances (so you can confirm they are unchanged afterwards).
select count(*) as employees_with_a_balance, coalesce(sum(balance_days), 0) as total_days from comp_day_balances where balance_days <> 0;

-- 0.8  Employees per country — every country other than AE / SA / PL silently falls back to the Dubai time zone.
select country_code, count(*) as employees,
       case when country_code in ('AE', 'SA', 'PL') then 'ok' else 'NO TIME ZONE MAPPING — falls back to Asia/Dubai' end as timezone_mapping
from employees where deleted_at is null
group by country_code order by country_code;

-- 0.9  Working week and public holidays the classification will use.  Expect AE/PL {1,2,3,4,5}, SA {0,1,2,3,4}
--      and holidays present for the coming year.
select c.code, c.working_weekdays,
       (select count(*) from public_holidays h where h.country_code = c.code and h.holiday_date >= current_date and h.holiday_date < current_date + 365) as holidays_next_12_months
from countries c where c.code in ('AE', 'SA', 'PL') order by c.code;

-- 0.10 Scheduling capability. pg_cron is the primary 5-minute scheduler; Vercel Hobby cannot run a cron more often than daily.
select name, default_version, installed_version from pg_available_extensions where name = 'pg_cron';
select extname, extversion from pg_extension where extname in ('pg_cron');

-- 0.11 Volume (a sanity check that the migration will be quick).
select (select count(*) from attendance_sessions) as sessions, (select count(*) from attendance_segments) as segments,
       (select count(*) from recovery_credit_requests) as recovery_requests, (select count(*) from comp_day_ledger) as comp_day_ledger_rows;
