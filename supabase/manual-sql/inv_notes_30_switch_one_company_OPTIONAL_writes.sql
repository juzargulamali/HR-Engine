-- WRITES ONE COLUMN. OWNER-RUN, OPTIONAL. Switches dispatch notes and return checklists ON for ONE company. Run it only after the migration, the verify file and a preview test.
--
-- How the owner turns the feature on (there is no settings screen for it): edit the single reference code in the line marked >>> EDIT <<< (for example 'UAE') and run the
-- whole file. It changes exactly that company, and refuses (changing nothing) if the code names no Inventory company or if Inventory is switched off for it.
-- From the next dispatch to a project or return from a project at that company's warehouses, ONE numbered note is made inside the same transaction. If a note can
-- not be made, that dispatch or return is refused with a clear message and nothing is recorded: switch it off again with inv_notes_80_switch_off_writes.sql.
-- A founder can also switch it through the database function inv_set_project_notes(company, true / false) (audited); this file is the owner's way when no founder is signed in.
--
-- Step 1 (information, changes nothing) is the first result. Step 2 writes and returns the before / after row. Safe to run twice.

-- Step 1: the companies and where the switch stands today.
select reference_code as company, is_enabled as "Inventory on", project_notes_enabled as "notes on" from inv_company_settings order by reference_code;

-- Step 2: switch ON for the company named below.
with target(code) as (
  values ('REPLACE-WITH-THE-COMPANY-REFERENCE-CODE')      -- >>> EDIT <<< e.g. ('UAE')
), pick as (
  select s.company_id, s.reference_code, s.project_notes_enabled as was_on, s.is_enabled
  from inv_company_settings s join target t on s.reference_code = upper(btrim(t.code))
), guard as (
  select case
    when (select count(*) from pick) <> 1 then 'REFUSED: the reference code names no Inventory company. Nothing was changed.'
    when (select not is_enabled from pick) then 'REFUSED: Inventory is switched off for that company. Nothing was changed.'
    else 'OK' end as verdict
), changed as (
  update inv_company_settings s set project_notes_enabled = true
  where s.company_id in (select company_id from pick) and (select verdict from guard) = 'OK'
  returning s.company_id
)
select (select verdict from guard) as verdict,
       (select reference_code from pick) as company, (select was_on from pick) as "was on", (select count(*) from changed) = 1 as "now on (changed by this run)";
