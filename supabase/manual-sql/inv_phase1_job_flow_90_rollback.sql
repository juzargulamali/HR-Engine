-- ROLLBACK of 20270114000100_inv_phase1_job_flow.sql. CHANGES THE DATABASE. Run only when the Phase 1 build is no longer deployed (its screens call these functions;
-- the build that was serving before Phase 1 does not, and keeps working after this rollback).
-- It removes: the six callable functions and the two helpers, the run links table WITH its rows (which site runs each request serves) and the three picked columns
-- WITH what was recorded as picked. It removes no request, reservation, movement, stock, check or site run. Export first if you want to keep them:
--   select * from inv_request_runs;
--   select id, picked_qty, picked_at, picked_by from inv_reservations where picked_qty > 0;
-- Safe to run twice.
begin;
drop function if exists inv_pick_for_request(uuid, uuid, uuid, text, jsonb);
drop function if exists inv_set_request_runs(uuid, uuid[]);
drop function if exists inv_project_run_cover(uuid);
drop function if exists inv_company_run_cover(uuid);
drop function if exists inv_run_cover_rows(uuid);
drop function if exists inv_project_sales_check(uuid);
drop function if exists inv_tech_norm(jsonb);
drop function if exists inv_opportunity_check_locations(uuid);
drop table if exists inv_request_runs;
alter table inv_reservations drop constraint if exists inv_reservations_picked;
alter table inv_reservations drop column if exists picked_by;
alter table inv_reservations drop column if exists picked_at;
alter table inv_reservations drop column if exists picked_qty;
-- The idempotency rows of picks (kind 'pick') are left in place: they hold no stock, and a key is never reused.
commit;
