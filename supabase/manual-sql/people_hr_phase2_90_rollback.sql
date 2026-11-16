-- ROLLBACK for 20270116000100_people_hr_phase2_queue.sql. Deploy the app from before this change FIRST (Alerts, the profile and My Day read hr_queue_acknowledgements and call acknowledge_hr_queue_item).
-- It STOPS while any acknowledgement exists: they record who saw which item and when, and dropping the table would erase that. Decide with HR whether to keep them (then do not roll back) or to export
-- them yourself, then run this again. It deletes no employee, contract, document, attendance record or Recovery Leave alert, and does not touch acknowledge_recovery_alert. Safe to run twice.
do $$
declare v_count integer := 0;
begin
  if to_regclass('public.hr_queue_acknowledgements') is not null then
    execute 'select count(*) from hr_queue_acknowledgements' into v_count;
  end if;
  if v_count > 0 then
    raise exception 'STOP: % acknowledgement(s) exist. Dropping the table would erase who saw which item. Keep them, or export them first, then run this again', v_count;
  end if;
  drop function if exists acknowledge_hr_queue_item(text, uuid, date, text);
  drop table if exists hr_queue_acknowledgements;   -- its policy, trigger and indexes go with it
end $$;
