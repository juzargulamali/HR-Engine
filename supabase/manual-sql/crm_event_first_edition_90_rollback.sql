-- WRITES. OWNER-RUN ROLLBACK of 20261227000100_crm_event_first_edition.sql. Safe to run twice. Deletes NO data: it only drops the one function.
-- Events and editions already added through it stay exactly as they are. After the rollback, "Add event" in the app answers that adding an event with its first
-- edition is not available (nothing is saved); adding an edition to an existing event keeps working.
drop function if exists crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text);
