-- People & HR Phase 2: acknowledgement for the HR work queue (Alerts).
-- ADDITIVE: one new table, one function callable by a signed-in user, one policy. No existing table, policy, function or grant is changed and no existing row is rewritten.
-- Install order: preflight (supabase/manual-sql/people_hr_phase2_00_preflight_readonly.sql), this migration, verify (..._20_verify_readonly.sql), then deploy the app.
-- Rollback: supabase/manual-sql/people_hr_phase2_90_rollback.sql (it stops while any acknowledgement exists, because dropping the table would erase who saw what).
--
-- WHY THIS EXISTS (the one concrete gap). Recovery Leave alerts already have an acknowledged state (recovery_alerts.status). Nothing else in the HR queue did: a contract end, a probation
-- review, a document expiry or an attendance exception could only be looked at, never marked "seen", so the queue could not tell "new" from "known and being handled". This table records that
-- somebody saw an item. It never records that the item was fixed: whether the issue is still open is always worked out again from the source record (contract, document, attendance record),
-- so the queue and the employee profile cannot disagree.
--
-- AN ACKNOWLEDGEMENT BELONGS TO ONE DATE. It is keyed by the source record AND the date it was about (the contract end date, the expiry date, the work date). When the date changes (a renewal
-- with a new expiry, a probation extension) the old acknowledgement no longer matches and the item is new again; nothing has to be deleted.
--
-- RE-RUNNABLE: `if not exists` / `create or replace` / drop policy if exists. (Revised before it was applied anywhere: the read policy used to depend on the company role alone; running this file over
-- that earlier version replaces the policy, so a project that did apply the first draft converges by applying this file again, then running the verify pack.)

create table if not exists hr_queue_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  employee_id     uuid not null references employees(id),
  kind            text not null check (kind in ('contract_end', 'probation', 'employee_document', 'identity_document', 'attendance')),
  source_id       uuid not null,   -- employment_contracts.id / employee_documents.id / identity_documents.id / attendance_records.id or recovery_windows.id
  source_date     date not null,   -- the contract end date, probation end date, expiry date or work date the acknowledgement is about
  note            text,
  acknowledged_by uuid not null references auth.users(id),
  acknowledged_at timestamptz not null default now(),
  unique (kind, source_id, source_date)
);
create index if not exists idx_hr_queue_ack_company on hr_queue_acknowledgements(company_id, acknowledged_at desc);
create index if not exists idx_hr_queue_ack_employee on hr_queue_acknowledgements(employee_id);

alter table hr_queue_acknowledgements enable row level security;

-- WHO CAN READ AN ACKNOWLEDGEMENT. An acknowledgement carries the source record's id and date (for a document: that an expiry date exists, and which) and HR's note about it, so it is exactly as
-- visible as the record it is about, and no more. Two conditions, both required:
--   1. the reader holds HR Admin, CEO or CTO for the employee's company (the people the alerts page is for: an employee, a manager or Finance who can read the source never read HR's note), and
--   2. the reader can READ THE SOURCE RECORD itself, asked through that record's own row level security (these sub-selects run as the reader, not as the table owner).
-- Today that means: HR Admin reads every kind; a CEO or CTO reads contract and probation acknowledgements and Recovery Leave window ones, but NOT employee-document, identity-document or attendance-day
-- ones, because those source tables are not readable by them (identity-document metadata is HR Admin only). If a source table's policy changes later, this follows it without being edited again.
-- A source that has been removed or no longer exists reads as not visible, so its acknowledgement is not shown to anyone but is kept.
drop policy if exists hr_queue_ack_select on hr_queue_acknowledgements;
create policy hr_queue_ack_select on hr_queue_acknowledgements for select
  using (
    (has_role('hr_admin', company_id) or has_role('ceo', company_id) or has_role('cto', company_id))
    and case kind
      when 'contract_end' then exists (select 1 from employment_contracts c where c.id = source_id)
      when 'probation' then exists (select 1 from employment_contracts c where c.id = source_id)
      when 'employee_document' then exists (select 1 from employee_documents d where d.id = source_id)
      when 'identity_document' then exists (select 1 from identity_documents d where d.id = source_id)
      when 'attendance' then exists (select 1 from attendance_records a where a.id = source_id) or exists (select 1 from recovery_windows w where w.id = source_id)
      else false
    end
  );

revoke all on hr_queue_acknowledgements from anon;
revoke insert, update, delete, truncate on hr_queue_acknowledgements from authenticated;

-- Audit: who acknowledged what, through the same trigger every other HR table uses.
drop trigger if exists audit_hr_queue_acknowledgements on hr_queue_acknowledgements;
create trigger audit_hr_queue_acknowledgements after insert on hr_queue_acknowledgements
  for each row execute function write_audit_log();

-- Acknowledge one item. HR Admin of the employee's company only (the same rule as acknowledging a Recovery Leave alert). The company and the employee are READ FROM THE SOURCE RECORD,
-- never taken from the caller, and the source must still exist and still carry the date the caller was looking at: if the record changed in the meantime (renewed, corrected, removed) the call
-- refuses and says so instead of acknowledging something that is no longer what the screen showed. Acknowledging twice is not an error (the first acknowledgement stands).
create or replace function acknowledge_hr_queue_item(p_kind text, p_source_id uuid, p_source_date date, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_employee uuid;
  v_found boolean := false;
begin
  if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
  if p_kind not in ('contract_end', 'probation', 'employee_document', 'identity_document', 'attendance') then raise exception 'Unknown item type.'; end if;

  if p_kind = 'contract_end' then
    select e.company_id, c.employee_id into v_company, v_employee
    from employment_contracts c join employees e on e.id = c.employee_id
    where c.id = p_source_id and c.is_current and c.end_date = p_source_date and e.deleted_at is null;
  elsif p_kind = 'probation' then
    select e.company_id, c.employee_id into v_company, v_employee
    from employment_contracts c join employees e on e.id = c.employee_id
    where c.id = p_source_id and c.is_current and c.probation_end_date = p_source_date and e.deleted_at is null;
  elsif p_kind = 'employee_document' then
    select e.company_id, d.employee_id into v_company, v_employee
    from employee_documents d join employees e on e.id = d.employee_id
    where d.id = p_source_id and d.deleted_at is null and d.expiry_date = p_source_date and e.deleted_at is null;
  elsif p_kind = 'identity_document' then
    select e.company_id, d.employee_id into v_company, v_employee
    from identity_documents d join employees e on e.id = d.employee_id
    where d.id = p_source_id and d.expiry_date = p_source_date and e.deleted_at is null;
  else
    -- An attendance exception is either a day where a manual entry and the clock disagree, or a recovery window waiting for HR to verify it.
    select e.company_id, r.employee_id into v_company, v_employee
    from attendance_records r join employees e on e.id = r.employee_id
    where r.id = p_source_id and r.work_date = p_source_date and r.presence_conflict is not null and e.deleted_at is null;
    if v_company is null then
      select e.company_id, w.employee_id into v_company, v_employee
      from recovery_windows w join employees e on e.id = w.employee_id
      where w.id = p_source_id and w.starting_local_date = p_source_date and w.hr_verification_required and w.hr_verified_at is null and e.deleted_at is null;
    end if;
  end if;
  v_found := v_company is not null;

  if not v_found then raise exception 'This item has changed or is already resolved. Reload the page.'; end if;
  if not has_role('hr_admin', v_company) then raise exception 'Only HR Admin may acknowledge this item.'; end if;

  insert into hr_queue_acknowledgements (company_id, employee_id, kind, source_id, source_date, note, acknowledged_by)
  values (v_company, v_employee, p_kind, p_source_id, p_source_date, nullif(trim(p_note), ''), auth.uid())
  on conflict (kind, source_id, source_date) do nothing;
end;
$$;
revoke all on function acknowledge_hr_queue_item(text, uuid, date, text) from public, anon;
grant execute on function acknowledge_hr_queue_item(text, uuid, date, text) to authenticated;
