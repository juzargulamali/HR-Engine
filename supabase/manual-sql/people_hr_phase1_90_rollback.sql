-- ROLLBACK for 20270115000100_people_hr_phase1.sql. Deploy the app from before this change FIRST (the Employment tab and the daily employment-changes job call these functions).
-- It STOPS while any change is still SCHEDULED (applied_at is null): a scheduled change exists only in that column, so dropping it would lose the change. Let each come due and apply, or ask HR to
-- record it again after the rollback, then run this again. It deletes no employee, contract, pay version, career event, ledger row or document. It drops the eight functions, the three indexes
-- and the six columns this migration added (applied_at, base_compensation_id, conflict_reason, conflict_at, dismissed_at, dismissed_by). Safe to run twice.
-- It also STOPS while a CANCELLED scheduled change exists (dismissed_at set, never applied): the previous build has no idea what "cancelled" means and would list it as a change that happened. Those rows
-- never took effect; decide with HR whether to keep them (then do not roll back) or to remove them yourself, then run this again. This file never deletes them.
do $$
declare v_scheduled integer := 0; v_cancelled integer := 0;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employee_career_events' and column_name = 'applied_at') then
    execute 'select count(*) from employee_career_events where applied_at is null and dismissed_at is null' into v_scheduled;
    execute 'select count(*) from employee_career_events where applied_at is null and dismissed_at is not null' into v_cancelled;
  end if;
  if v_scheduled > 0 then
    raise exception 'STOP: % scheduled employment change(s) have not come due yet. Let them apply (or record them again afterwards), then run this again', v_scheduled;
  end if;
  if v_cancelled > 0 then
    raise exception 'STOP: % cancelled employment change(s) exist. The previous build would list them as changes that happened. Decide with HR whether to remove them, then run this again', v_cancelled;
  end if;
  drop function if exists record_employment_change(uuid, date, text, numeric, numeric, text);
  drop function if exists record_employment_change(uuid, date, text, numeric, numeric, text, date);   -- the older draft, if it was ever installed
  drop function if exists dismiss_employment_change(uuid);
  drop function if exists apply_due_employment_changes(timestamptz);
  drop function if exists apply_due_employment_changes(text, date);
  drop function if exists _hr_apply_career_event(uuid);
  drop function if exists _hr_set_current_pay(uuid, date, numeric, jsonb, text, uuid);
  drop function if exists _hr_set_current_pay(uuid, date, numeric, numeric, text, uuid);
  drop function if exists hr_business_today(text);
  drop function if exists hr_business_date(text, timestamptz);
  drop function if exists hr_business_time_zone(text);
  drop index if exists leave_ledger_opening_balance_unique;
  drop index if exists comp_day_ledger_opening_balance_unique;
  drop index if exists idx_career_events_scheduled;
  alter table employee_career_events drop column if exists applied_at, drop column if exists base_compensation_id, drop column if exists conflict_reason, drop column if exists conflict_at, drop column if exists dismissed_at, drop column if exists dismissed_by;
end $$;
