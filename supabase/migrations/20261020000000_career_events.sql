-- A permanent, HR-authored history log of promotions, title changes, and
-- salary changes — recordCareerEvent() is the one place that writes here,
-- and it also applies the change itself (updates employees.job_title
-- and/or inserts a new compensation_details version), so this table is
-- purely an audit trail, never the source of truth for the current
-- title/salary. Same visibility tier as compensation_details (self, HR
-- Admin, Finance) since it carries salary figures — a manager gets a
-- separate, amount-redacted view via get_career_summary_for_appraisal()
-- below, for exactly the appraisal-context use case this was built for.
-- Append-only: no update/delete policy, matching leave_ledger's own
-- philosophy for a history log that should never be silently rewritten.
create table employee_career_events (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references employees(id),
  event_type            text not null check (event_type in ('promotion', 'title_change', 'salary_change')),
  effective_date        date not null,
  previous_job_title    text,
  new_job_title         text,
  previous_base_salary  numeric(14,2),
  new_base_salary       numeric(14,2),
  previous_allowances   jsonb,
  new_allowances        jsonb,
  currency              text,
  note                  text,
  created_at            timestamptz not null default now(),
  created_by            uuid not null
);

create index idx_career_events_employee on employee_career_events(employee_id, effective_date desc);

alter table employee_career_events enable row level security;

-- ---- employee_career_events: same visibility tier as compensation_details
--      (self, HR Admin, Finance). Insert is HR Admin only — this is the
--      "HR records a promotion/title/salary change" flow specifically,
--      distinct from Finance's own plain compensation-version tool for
--      routine adjustments (bank details, currency corrections) that
--      aren't career events. No update/delete — permanent history.
create policy career_events_select on employee_career_events for select
  using (
    employee_id = current_employee_id()
    or has_role('hr_admin', (select company_id from employees where id = employee_id))
    or has_role('finance', (select company_id from employees where id = employee_id))
  );

create policy career_events_insert on employee_career_events for insert
  with check (has_role('hr_admin', (select company_id from employees where id = employee_id)));

-- Manager-safe summary for the appraisal page's "context" panel — dates
-- only, never amounts. career_events_select above deliberately does NOT
-- grant a manager access to employee_career_events (RLS is row-level, not
-- column-level, so any row access would also expose the salary columns) —
-- this SECURITY DEFINER function is the narrow, redacted view that lets an
-- appraiser see *when* a report was last promoted/given a raise without
-- ever seeing *how much*, mirroring the same "team profile access does not
-- extend to pay" boundary compensation_details already enforces.
create or replace function get_career_summary_for_appraisal(p_employee_id uuid)
returns table(last_promotion_date date, last_title_change_date date, last_salary_change_date date)
language sql
stable
security definer
set search_path = public
as $$
  select
    max(effective_date) filter (where event_type = 'promotion'),
    max(effective_date) filter (where event_type = 'title_change'),
    max(effective_date) filter (where event_type in ('promotion', 'salary_change'))
  from employee_career_events
  where employee_id = p_employee_id
    and (
      current_employee_id() = p_employee_id
      or has_role('hr_admin', (select company_id from employees where id = p_employee_id))
      or has_role('finance', (select company_id from employees where id = p_employee_id))
      or (has_role('ceo', (select company_id from employees where id = p_employee_id)) or has_role('cto', (select company_id from employees where id = p_employee_id)))
      or is_manager_of(p_employee_id)
    );
$$;

create trigger audit_career_events after insert on employee_career_events
  for each row execute function write_audit_log();
