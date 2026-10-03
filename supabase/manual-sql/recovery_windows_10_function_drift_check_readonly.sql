-- Recovery Leave windows — STEP 0b: READ-ONLY "DRIFT CHECK" (run after the preflight, before the migration).
--
-- The migration REPLACES seven existing function bodies (each patched from the repository's latest version of it). Before it
-- overwrites anything, this proves the copies currently in your database are the ones the repository expects — so nothing that
-- was ever changed by hand in this database is silently lost. Every statement is a SELECT; nothing is changed.

-- 0b.1  Fingerprints of the seven functions' bodies. Compare each md5 with the "expected" column in the instructions you were
--       given. A mismatch means this database holds a different version than the repository: STOP and send me the result.
select proname, md5(prosrc) as body_md5, length(prosrc) as body_length
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('adjust_recovery_credit_request', 'decide_leave_approval', 'guard_policy_version_update', 'is_entity_owner',
                  'record_attendance_and_recovery', 'sync_attendance_recovery_for_day', 'write_audit_log')
order by proname;

-- 0b.2  Enum values the migration relies on.  Expect app_role to include cto, and approvable_entity to include recovery_credit.
select 'app_role' as enum_type, string_agg(enumlabel, ', ' order by enumsortorder) as labels from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'app_role'
union all
select 'approvable_entity', string_agg(enumlabel, ', ' order by enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'approvable_entity';

-- 0b.3  Columns the migration extends or reads.  Expect every row to be present (the second column = true).
select c.col, exists (select 1 from information_schema.columns i where i.table_schema = 'public' and i.table_name = c.tbl and i.column_name = c.col) as present
from (values
  ('audit_log', 'actor_roles'), ('audit_log', 'company_id'), ('policy_versions', 'approved_by'), ('policy_versions', 'created_by'),
  ('attendance_sessions', 'hr_closed_at'), ('attendance_segments', 'project_lead_employee_id'),
  ('recovery_credit_requests', 'applicant_route'), ('recovery_credit_requests', 'segment_id'), ('countries', 'working_weekdays')
) as c(tbl, col);
