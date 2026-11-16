-- ROLLBACK for 20270115000100_people_hr_phase1.sql. Deploy the app from before this change FIRST (the Employment tab and the daily employment-changes job call these functions).
-- It STOPS while any change is still SCHEDULED (applied_at is null): a scheduled change exists only in that column, so dropping it would lose the change. Let each come due and apply, or ask HR to
-- record it again after the rollback, then run this again. It deletes no employee, contract, pay version, career event, ledger row or document. It drops the four functions, the three indexes
-- and the applied_at column. Safe to run twice.
do $$
declare v_scheduled integer := 0;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employee_career_events' and column_name = 'applied_at') then
    execute 'select count(*) from employee_career_events where applied_at is null' into v_scheduled;
  end if;
  if v_scheduled > 0 then
    raise exception 'STOP: % scheduled employment change(s) have not come due yet. Let them apply (or record them again afterwards), then run this again', v_scheduled;
  end if;
  drop function if exists record_employment_change(uuid, date, text, numeric, numeric, text, date);
  drop function if exists apply_due_employment_changes(text, date);
  drop function if exists _hr_apply_career_event(uuid);
  drop function if exists _hr_set_current_pay(uuid, date, numeric, numeric, text, uuid);
  drop index if exists leave_ledger_opening_balance_unique;
  drop index if exists comp_day_ledger_opening_balance_unique;
  drop index if exists idx_career_events_scheduled;
  alter table employee_career_events drop column if exists applied_at;
end $$;
