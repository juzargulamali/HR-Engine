-- ROLLBACK for 20270118000200_people_hr_pay_correction.sql. Deploy the app from before this change FIRST (the Compensation tab reads compensation_corrections and calls correct_pay_record).
-- It STOPS while any correction exists: a correction holds the pay figures and dates a record had BEFORE it was corrected, and dropping the table would erase them for good. Decide with HR and Finance
-- whether to keep them (then do not roll back) or to export them yourself, then run this again. It does NOT undo a correction (the corrected pay records stay as they are) and changes no pay record,
-- payroll run or settlement. Safe to run twice.
-- Expected result: completes with no output when no correction exists; otherwise it stops with a message that names the count.
do $$
declare v_count integer := 0;
begin
  if to_regclass('public.compensation_corrections') is not null then
    execute 'select count(*) from compensation_corrections' into v_count;
  end if;
  if v_count > 0 then
    raise exception 'STOP: % pay correction(s) exist. Dropping the table would erase the original pay figures and dates. Keep them, or export them first, then run this again', v_count;
  end if;
  drop function if exists correct_pay_record(uuid, date, numeric, jsonb, text, text);
  drop function if exists _hr_pay_in_force(uuid, date);
  drop table if exists compensation_corrections;   -- its policy, triggers and indexes go with it
  drop function if exists compensation_corrections_append_only();
end $$;
