-- WRITES. OWNER-RUN ROLLBACK of 20270105000100_proj_plan_quick_add_reorder.sql. Safe to run twice. Deploy the app from before this follow-up FIRST (it calls these functions).
-- Drops the two functions. No requirement, order or any other data is touched: lines added with Quick add stay, and the order they were put in stays (sort_order is an existing column).
begin;
drop function if exists proj_dp_reorder_lines(uuid, uuid[]);
drop function if exists proj_dp_add_lines(uuid, text, jsonb, boolean);
commit;
