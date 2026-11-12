-- WRITES. OWNER-RUN ROLLBACK of 20261231000100_proj_delivery_plan.sql. Safe to run twice.
-- BEFORE running it:
--   1. Deploy (or keep) an app version without the Delivery plan tab, or accept that the tab says "not installed in this environment".
--   2. EXPORT the plan. Every deliverable row, breakdown line, delegation, correction and proposed change is deleted:
--        select * from proj_dp_items; select * from proj_dp_lines; select * from proj_dp_delegations; select * from proj_dp_corrections; select * from proj_dp_changes;
-- WHAT STAYS: the tasks and the equipment request lines that Release created are ordinary tasks and request lines. They are NOT deleted; they simply lose their link to a
-- plan line. No Projects, Inventory or Chat table, function, policy or grant is touched.
do $$ declare n integer;
begin
  if to_regclass('public.proj_dp_lines') is not null then
    select count(*) into n from proj_dp_lines where released_at is not null;
    raise notice 'released plan lines whose tasks / equipment lines will stay without a plan link: %', n;
  end if;
end $$;
begin;
drop function if exists proj_dp_plan(uuid);
drop function if exists proj_dp_apply_import(uuid, integer, jsonb, jsonb);
drop function if exists proj_dp_decide_change(uuid, text, text);
drop function if exists proj_dp_decide_correction(uuid, text, text);
drop function if exists proj_dp_raise_correction(uuid, text, uuid, text);
drop function if exists proj_dp_release(uuid, uuid[]);
drop function if exists proj_dp_delegate(uuid, text, uuid);
drop function if exists proj_dp_remove_line(uuid);
drop function if exists proj_dp_save_line(uuid, uuid, jsonb, integer, text);
drop function if exists proj_dp_remove_item(uuid);
drop function if exists proj_dp_save_item(uuid, uuid, jsonb, integer, text);
drop function if exists proj_dp_line_booked(uuid);
drop function if exists proj_dp_active_member(uuid, uuid);
drop function if exists proj_dp_can_edit_section(uuid, text);
drop function if exists proj_dp_next_key(uuid, text);
drop function if exists proj_dp_touch(uuid);
drop table if exists proj_dp_changes;
drop table if exists proj_dp_corrections;
drop table if exists proj_dp_delegations;
drop table if exists proj_dp_lines;
drop table if exists proj_dp_items;
drop table if exists proj_dp_state;
commit;
