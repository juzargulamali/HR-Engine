-- Phase 1 hardening (D — Auditability): write_audit_log() resolved a
-- single actor_role via `... order by granted_at desc limit 1`, silently
-- collapsing a multi-role user (e.g. a Line Manager also granted Finance)
-- down to whichever role they were granted most recently. An audit trail
-- that can't show every hat an actor was wearing at the time of an action
-- is misleading by omission for exactly the users worth auditing most
-- closely.
--
-- actor_roles is additive — actor_role stays exactly as it always
-- behaved (same "most recently granted" value), so nothing that already
-- reads it changes behavior. New code (the Audit Log page) should read
-- actor_roles instead.
alter table audit_log add column if not exists actor_roles app_role[];

create or replace function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role app_role;
  v_actor_roles app_role[];
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_employee_id uuid;
  v_company_id uuid;
begin
  -- A multi-role user (e.g. a Line Manager also granted Finance) must never
  -- be recorded as if they only held one role — every currently-held,
  -- unrevoked role is captured. actor_role is kept alongside for backward
  -- compatibility with anything still reading the single-value column;
  -- it's always the same "most recently granted" choice it always was.
  select array_agg(role order by granted_at desc) into v_actor_roles
  from user_roles where user_id = auth.uid() and revoked_at is null;
  v_actor_role := v_actor_roles[1];

  if v_row ? 'company_id' then
    v_company_id := (v_row ->> 'company_id')::uuid;
  elsif TG_TABLE_NAME = 'companies' then
    v_company_id := (v_row ->> 'id')::uuid;
  elsif v_row ? 'employee_id' then
    select company_id into v_company_id from employees where id = (v_row ->> 'employee_id')::uuid;
  elsif TG_TABLE_NAME = 'employees' then
    v_company_id := (v_row ->> 'company_id')::uuid;
  elsif TG_TABLE_NAME = 'approvals' then
    v_employee_id := case v_row ->> 'entity_type'
      when 'leave_request' then (select employee_id from leave_requests where id = (v_row ->> 'entity_id')::uuid)
      when 'reimbursement_claim' then (select employee_id from reimbursement_claims where id = (v_row ->> 'entity_id')::uuid)
      when 'timesheet' then (select employee_id from timesheets where id = (v_row ->> 'entity_id')::uuid)
      when 'generated_letter' then (select employee_id from generated_letters where id = (v_row ->> 'entity_id')::uuid)
      else null
    end;
    if v_employee_id is not null then
      select company_id into v_company_id from employees where id = v_employee_id;
    elsif v_row ->> 'entity_type' = 'payroll_export_run' then
      select company_id into v_company_id from payroll_export_runs where id = (v_row ->> 'entity_id')::uuid;
    end if;
  end if;

  insert into audit_log(table_name, record_id, action, actor_id, actor_role, actor_roles, company_id, before_data, after_data)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    lower(TG_OP),
    auth.uid(),
    v_actor_role,
    v_actor_roles,
    v_company_id,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;
