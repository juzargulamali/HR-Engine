-- Recovery Leave windows — READ-ONLY PRESERVATION SNAPSHOT.
--
-- Run this TWICE: once BEFORE you apply the migration and once AFTER (and again after activation, and after any
-- test run). Compare the two outputs. It fingerprints the data the redesign must NOT change — it never clears,
-- edits or re-grants anything, and it does not touch real test-account routing or role grants.
--
-- How to read it: for each row, `row_count` and `fingerprint` must be IDENTICAL before and after — EXCEPT that
-- rows the live app itself created in between (new clock sessions, new requests, new ledger rows) legitimately add
-- to the count. To make the comparison exact, set the cut-off below to the moment you took the FIRST snapshot, and
-- keep it the same for every later run: only rows that existed at the cut-off are fingerprinted.
--
-- Edit this one value (UTC) and keep it identical on every run:
with params as (select timestamptz '2026-10-04 00:00:00+00' as cutoff)

-- Employees, their company/country/manager/login link — real routing inputs.
select 'employees (routing inputs)' as what, count(*) as row_count,
       md5(coalesce(string_agg(concat_ws('|', e.id, e.company_id, e.country_code, e.manager_id, e.user_id, e.employment_status), ';' order by e.id), '')) as fingerprint
from employees e, params where e.created_at <= params.cutoff
union all
-- Role grants (who is HR / manager / CEO / CTO). Must be untouched.
select 'user_roles', count(*),
       md5(coalesce(string_agg(concat_ws('|', r.user_id, r.role, r.company_id, r.country_code, r.revoked_at), ';' order by r.user_id, r.role, r.company_id), ''))
from user_roles r, params where r.granted_at <= params.cutoff
union all
-- Raw clock evidence (the legacy columns only — new columns are excluded on purpose).
select 'attendance_sessions', count(*),
       md5(coalesce(string_agg(concat_ws('|', s.id, s.employee_id, s.clock_in_at, s.clock_out_at, s.status, s.hr_closed_at, s.hr_closed_reason), ';' order by s.id), ''))
from attendance_sessions s, params where s.created_at <= params.cutoff
union all
select 'attendance_segments', count(*),
       md5(coalesce(string_agg(concat_ws('|', g.id, g.session_id, g.work_mode, g.project_name, g.project_lead_employee_id, g.segment_start, g.segment_end), ';' order by g.id), ''))
from attendance_segments g, params where g.created_at <= params.cutoff
union all
select 'attendance_records', count(*),
       md5(coalesce(string_agg(concat_ws('|', a.id, a.employee_id, a.work_date, a.status, a.work_mode, a.hours_worked, a.source), ';' order by a.id), ''))
from attendance_records a
union all
-- Recovery requests that existed (legacy columns).
select 'recovery_credit_requests (legacy)', count(*),
       md5(coalesce(string_agg(concat_ws('|', q.id, q.employee_id, q.work_date, q.event_type, q.proposed_days, q.status, q.applicant_route, q.project_lead_employee_id, q.comp_day_ledger_id), ';' order by q.id), ''))
from recovery_credit_requests q, params where q.created_at <= params.cutoff
union all
-- The ledger: balances, expiry dates, reversals.
select 'comp_day_ledger', count(*),
       md5(coalesce(string_agg(concat_ws('|', l.id, l.employee_id, l.txn_date, l.entry_type, l.days, l.expiry_date, l.reference_type, l.reference_id, l.reversal_of_id), ';' order by l.id), ''))
from comp_day_ledger l, params where l.created_at <= params.cutoff
union all
select 'approvals', count(*),
       md5(coalesce(string_agg(concat_ws('|', p.id, p.entity_type, p.entity_id, p.step_order, p.approver_id, p.queue_roles::text, p.decision), ';' order by p.id), ''))
from approvals p, params where p.created_at <= params.cutoff
union all
-- Annual Leave and its ledger are explicitly out of scope: this must never change.
select 'leave_ledger (Annual Leave)', count(*),
       md5(coalesce(string_agg(concat_ws('|', v.id, v.employee_id, v.leave_type_code, v.amount_days, v.txn_date), ';' order by v.id), ''))
from leave_ledger v
union all
select 'leave_requests', count(*),
       md5(coalesce(string_agg(concat_ws('|', r.id, r.employee_id, r.leave_type_code, r.start_date, r.end_date, r.status), ';' order by r.id), ''))
from leave_requests r
union all
-- Existing policy versions: content and dates (the active V2 must be untouched until a controlled activation).
select 'policy_versions (all except new window drafts)', count(*),
       md5(coalesce(string_agg(concat_ws('|', pv.id, pv.country_code, pv.policy_type, pv.version_no, pv.status, pv.effective_from, pv.effective_to, md5(pv.payload::text)), ';' order by pv.id), ''))
from policy_versions pv where coalesce(pv.payload ->> 'model', '') <> 'recovery_windows'
order by 1;
