-- ROLLBACK for 20270111000200_ops_crew_overlaps.sql. Either order with the app: without the function the Operations Overview says the per-person overlaps could not be loaded
-- and keeps its activity-level warning. It drops the two functions and nothing else: no table, no record. Safe to run twice.
drop function if exists ops_crew_overlaps(uuid);
drop function if exists ops_commitment_side(text, uuid, uuid, text, text, text, text, tstzrange, text, boolean, boolean);
