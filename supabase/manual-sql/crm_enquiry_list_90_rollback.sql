-- WRITES. OWNER-RUN ROLLBACK of 20261229000100_crm_enquiry_list.sql. Safe to run twice. Deletes NO data: it only drops the one read-only function.
-- The app then reads the Enquiries list the earlier way (every matching enquiry, counted in the app); nothing else changes.
drop function if exists crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer);
