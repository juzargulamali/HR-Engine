-- WRITES. OWNER-RUN ROLLBACK of 20270101000100_proj_closeout_reports.sql. Safe to run twice.
-- BEFORE running it:
--   1. Deploy (or keep) an app version without the Closeout report screen, or accept that the screen says "not installed in this environment".
--   2. EXPORT the reports. Every draft AND every approved report version is deleted:
--        select * from proj_closeout_reports;
-- WHAT STAYS: everything else. The report only read the project's records; no Projects, Delivery Plan, Inventory or Chat table, function, policy or grant is touched.
do $$ declare n integer;
begin
  if to_regclass('public.proj_closeout_reports') is not null then
    select count(*) into n from proj_closeout_reports where status = 'approved';
    raise notice 'approved closeout report versions that will be deleted: %', n;
  end if;
end $$;
begin;
drop function if exists proj_closeout_finish(uuid, text, boolean, text, jsonb);
drop function if exists proj_closeout_claim(uuid, text, integer);
drop function if exists proj_closeout_take_call(uuid, integer);
drop function if exists proj_closeout_discard_draft(uuid);
drop function if exists proj_closeout_approve(uuid, integer);
drop function if exists proj_closeout_save_edits(uuid, jsonb, integer);
drop function if exists proj_closeout_save_draft(uuid, jsonb, jsonb, text, text, text, jsonb, jsonb);
drop function if exists proj_closeout_require_manager(uuid);
drop function if exists proj_closeout_evidence(uuid);
drop function if exists proj_closeout_blocks(jsonb, jsonb);
drop function if exists proj_closeout_text_blocks(text, jsonb);
drop table if exists proj_closeout_generations;
drop table if exists proj_closeout_usage;
drop table if exists proj_closeout_reports;
commit;
