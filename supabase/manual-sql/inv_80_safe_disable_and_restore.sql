-- WRITES (only the on/off switch inv_company_settings.is_enabled, and only if you remove the dashes of a section below). A SAFE
-- SWITCH-OFF that loses nothing. Run in the SQL Editor of "Enginious HR Engine_V2".
--
-- WHY: if Inventory must be paused (a bug, an audit, a stock-take where nothing may move, a pause for training), the safest way
-- is NOT to drop anything but to switch the company off. With the switch off:
--   * EVERY Inventory function that changes something refuses, in plain words: "Inventory is switched off for this company.
--     Nothing can be changed until a founder switches it on." That covers receiving, issuing, dispatching, returning, transferring,
--     repairs, counts, kits, corrections, locations, categories, items, templates, requests, reservations, availability checks and the
--     import of HR assets. The database enforces it, so a page that is already open cannot change anything either.
--   * READING keeps working: the catalogue, stock, the movement history, requests and reservations, each person's "My equipment",
--     HR's outstanding-equipment view, availability and the Sales availability summary all still open and show the same numbers.
--   * Access settings stay usable on purpose, so a founder is never locked out of switching it back on: granting and revoking
--     access, setting the reference code, and the on/off switch itself (Inventory > Manage).
-- WHAT STAYS VALID: every label and QR code (a code is permanent and is never reissued), every unit, stock row, movement, count,
-- request, reservation, rental, cost and audit row, and every person's recorded custody. Nothing is deleted, reversed or changed.
-- Reservations stay on record; nothing expires because Inventory is off. Counts that were started stay as they were.
-- WHAT DOES NOT CHANGE WHILE IT IS OFF:
--   * HR assets that a founder already imported stay managed by Inventory: the HR Assets page still refuses to edit them (their
--     record still belongs to Inventory, and unlinking would break the history). Assets that were never imported are untouched.
--   * New client projects do not import the equipment list from the Sales handover while the company is off (the project is
--     created normally and the skipped import is logged; the project manager can import it once the company is switched on again).
--     Completing or archiving a project still frees that project's unused reservations, so equipment is not held for finished work.
--   * HR, Sales and Projects are not touched by this script at all.
--
-- HOW TO USE: every section below is switched off with two dashes at the start of each statement line (the lines that begin
-- with "--" followed by four spaces). Remove those two dashes, from the first statement line to the semicolon, of ONE section, and run
-- the whole file: section 3, the status list, always runs and shows the result. Edit nothing else. Put the dashes back afterwards.
--
--   1   SWITCH OFF every company that is on.
--   1b  SWITCH OFF one company (change the company name in the last line first).
--   2   SWITCH BACK ON exactly the companies this script switched off (found in the Inventory audit log: a switch-off made here
--       has no person next to it). A company that a founder switched off in the app stays off.
--   2b  SWITCH BACK ON every company that is off, whoever switched it off.
--   2c  SWITCH BACK ON one company (change the company name in the last line first).
--   3   WHAT IS CURRENTLY ON OR OFF (read-only, always runs).

-- 1. SWITCH OFF every company that is on --------------------------------------------------------------------------------
--    update inv_company_settings
--       set is_enabled = false, updated_by = null
--     where is_enabled;

-- 1b. SWITCH OFF one company --------------------------------------------------------------------------------------------
--    update inv_company_settings
--       set is_enabled = false, updated_by = null
--     where is_enabled and company_id = (select id from companies where legal_name = 'REPLACE-WITH-COMPANY-LEGAL-NAME');

-- 2. SWITCH BACK ON exactly what section 1 / 1b switched off (people who switched a company off in the app are left as they are) -----
--    update inv_company_settings s
--       set is_enabled = true, updated_by = null
--     where not s.is_enabled
--       and (select a.actor_id is null
--              from inv_audit_log a
--             where a.table_name = 'inv_company_settings' and a.company_id = s.company_id and a.action = 'update'
--               and a.old_row->>'is_enabled' = 'true' and a.new_row->>'is_enabled' = 'false'
--             order by a.created_at desc, a.id desc limit 1);

-- 2b. SWITCH BACK ON every company that is off ----------------------------------------------------------------------------
--    update inv_company_settings
--       set is_enabled = true, updated_by = null
--     where not is_enabled;

-- 2c. SWITCH BACK ON one company ------------------------------------------------------------------------------------------
--    update inv_company_settings
--       set is_enabled = true, updated_by = null
--     where not is_enabled and company_id = (select id from companies where legal_name = 'REPLACE-WITH-COMPANY-LEGAL-NAME');

-- 3. WHAT IS CURRENTLY ON OR OFF (read-only) ------------------------------------------------------------------------------
select c.legal_name as company,
       s.reference_code as code,
       case when s.is_enabled then 'ON' else 'OFF (paused: nothing can be changed, everything can be read)' end as state,
       coalesce((select to_char(a.created_at at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI') || ' (Dubai), ' ||
                        case when a.actor_id is null then 'by the owner in the SQL Editor' else 'by ' || coalesce((select p.email from profiles p where p.id = a.actor_id), 'a founder in the app') end
                   from inv_audit_log a
                  where a.table_name = 'inv_company_settings' and a.company_id = s.company_id and a.action = 'update'
                    and a.old_row->>'is_enabled' is distinct from a.new_row->>'is_enabled'
                  order by a.created_at desc, a.id desc limit 1), 'never switched') as last_switch,
       (select count(*) from inv_company_grants g where g.company_id = s.company_id and g.revoked_at is null) as active_grants,
       (select count(*) from inv_units u where u.company_id = s.company_id) as units_on_record
from inv_company_settings s
join companies c on c.id = s.company_id
order by c.legal_name;
