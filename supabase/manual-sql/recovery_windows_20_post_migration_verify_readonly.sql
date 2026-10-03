-- Recovery Leave windows — STEP 2: READ-ONLY VERIFICATION after applying
-- supabase/migrations/20261108000000_recovery_windows_attendance_redesign.sql.
--
-- Run in the Supabase SQL Editor. Every statement is a SELECT. Expect the notes shown. The
-- migration is DORMANT: it must not change how any clock-in is calculated until a windows
-- policy is deliberately activated (STEP 5).

-- 2.1  New tables exist and ROW LEVEL SECURITY is on for every one.  Expect rls = true on all 8 rows.
select c.relname as table_name, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'recovery_periods', 'recovery_windows', 'recovery_window_allocations', 'recovery_window_revisions',
  'recovery_alerts', 'attendance_session_corrections', 'recovery_processor_runs', 'recovery_processor_failures')
order by 1;

-- 2.2  Nobody can write these tables directly.  Expect ZERO rows (no INSERT/UPDATE/DELETE grant for signed-in users).
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('recovery_periods', 'recovery_windows', 'recovery_window_allocations', 'recovery_window_revisions', 'recovery_alerts', 'attendance_session_corrections')
  and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- 2.3  No write POLICY exists either.  Expect only SELECT policies (cmd = SELECT) on the new tables.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('recovery_periods', 'recovery_windows', 'recovery_window_allocations', 'recovery_window_revisions', 'recovery_alerts', 'attendance_session_corrections')
order by 1, 2;

-- 2.4  The processor and engine are NOT callable by signed-in users.  Expect false / false / false.
select
  has_function_privilege('authenticated', 'public.recovery_process_due(text,timestamptz,integer)', 'execute') as authenticated_can_run_processor,
  has_function_privilege('anon', 'public.recovery_process_due(text,timestamptz,integer)', 'execute') as anon_can_run_processor,
  has_function_privilege('authenticated', 'public.recovery_recalculate_employee(uuid,timestamptz,text,text,uuid)', 'execute') as authenticated_can_run_engine;

-- 2.5  DORMANT: every session is still on the existing calculation, and nothing was derived.
--      Expect windowed_sessions = 0, and 0 in every count below.
select
  (select count(*) from attendance_sessions where recovery_model = 'windowed') as windowed_sessions,
  (select count(*) from attendance_sessions where recovery_model = 'legacy')   as legacy_sessions,
  (select count(*) from recovery_periods)   as periods,
  (select count(*) from recovery_windows)   as windows,
  (select count(*) from recovery_alerts)    as alerts,
  (select count(*) from recovery_credit_requests where recovery_window_id is not null) as window_requests;

-- 2.6  No windows policy is active (activation is a separate, controlled step).  Expect 0.
select count(*) as active_windows_policies
from policy_versions where policy_type = 'overtime_rules' and status = 'active' and payload ->> 'model' = 'recovery_windows';

-- 2.7  Compatibility with the CURRENTLY DEPLOYED app: every new column on an existing table is nullable
--      or has a default, so the old code's inserts/updates still work.  Expect is_nullable = YES or a default.
select table_name, column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (table_name, column_name) in (
    ('attendance_sessions', 'recovery_model'), ('attendance_sessions', 'recorded_by_hr'), ('attendance_sessions', 'recorded_by_hr_by'),
    ('attendance_sessions', 'recorded_by_hr_at'), ('attendance_sessions', 'recorded_by_hr_reason'),
    ('recovery_credit_requests', 'recovery_window_id'), ('recovery_credit_requests', 'window_revision_no'), ('recovery_credit_requests', 'adjusts_request_id'),
    ('audit_log', 'origin'), ('policy_versions', 'activation_record'))
order by 1, 2;

-- 2.8  The triggers that run the engine exist.  Expect 5 rows.
select event_object_table as on_table, trigger_name
from information_schema.triggers
where trigger_schema = 'public' and trigger_name in (
  'attendance_sessions_assign_recovery_model', 'attendance_sessions_guard_timing', 'attendance_segments_guard_overlap',
  'attendance_segments_recovery_engine', 'attendance_sessions_recovery_engine')
group by 1, 2 order by 1, 2;

-- 2.9  Existing behaviour for the replaced functions is intact: they exist with unchanged signatures.  Expect 6 rows.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'decide_leave_approval', 'is_entity_owner', 'adjust_recovery_credit_request',
  'record_attendance_and_recovery', 'sync_attendance_recovery_for_day', 'write_audit_log')
order by 1;
