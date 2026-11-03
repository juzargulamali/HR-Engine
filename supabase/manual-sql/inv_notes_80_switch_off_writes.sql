-- WRITES ONE COLUMN. OWNER-RUN. Switches dispatch notes and return checklists OFF for EVERY company. This is the safe first response to any problem.
--
-- What it does: sets inv_company_settings.project_notes_enabled to false. From the next dispatch or return on, the two movement functions behave exactly as before this
-- change (no note is made, no number is taken). Nothing else changes: every issued note and its history stay, the Project Manager can still read and answer what was
-- issued, and nothing is lost. To switch it on again for one company use inv_notes_30_switch_one_company_OPTIONAL_writes.sql.
--
-- Safe to run twice. It returns one row per company with the state before and after, so you have the undo information in the result.

with before as (
  select company_id, reference_code, project_notes_enabled as was_on from inv_company_settings
), changed as (
  update inv_company_settings s set project_notes_enabled = false
  where s.project_notes_enabled
  returning s.company_id
)
select b.reference_code as company, b.was_on as "was on", false as "now on", (b.company_id in (select company_id from changed)) as "changed by this run"
from before b order by b.reference_code;
