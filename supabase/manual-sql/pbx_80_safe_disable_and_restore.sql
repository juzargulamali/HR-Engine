-- WRITES (only the on/off switch pbx_company_settings.is_enabled, and only if you remove the dashes of a section below). A SAFE SWITCH-OFF that
-- loses nothing. Run in the SQL Editor of "Enginious HR Engine_V2".
--
-- WHY: if Project Budget & Expenses must be paused (a bug, an audit, a month-end freeze, a pause for training) the safest way is NOT to drop anything but
-- to switch the company off. With the switch off:
--   * EVERY function that changes something refuses, in plain words: "Project budgets are switched off for this company. Nothing can be changed until the
--     owner switches them on; everything can still be read." That covers creating, editing, submitting and deciding budgets, additions, funding,
--     actual expenses, receipts, returns, reimbursements, reversals and closing or reopening a settlement. The database enforces it, so a page that is
--     already open cannot change anything either.
--   * READING keeps working: the budget, funds, actual expenses and settlement of every project, the Finance inbox and the audit trail.
--   * Access management, petrol and meal rates and categories stay usable on purpose.
-- WHAT STAYS VALID: every budget version, row, funding entry, actual expense, payment, receipt status, decision and audit row. Nothing is deleted, reversed
-- or changed, and nothing expires because the module is off.
-- WHAT IT DOES NOT TOUCH: HR, claims, payroll, leave, attendance, Sales, Projects (including project status) and Inventory are not touched at all.
--
-- HOW TO USE: every section below is switched off with two dashes at the start of each statement line (the lines that begin with "--" followed by four
-- spaces). Remove those two dashes, from the first statement line to the semicolon, of ONE section, and run the whole file: section 3, the status list,
-- always runs and shows the result. Edit nothing else. Put the dashes back afterwards.
--
--   1   SWITCH OFF every company.
--   1b  SWITCH OFF one company (change the company name in the last line first).
--   2   SWITCH BACK ON exactly the companies that section 1 / 1b switched off (the audit log shows no person next to them).
--   2b  SWITCH BACK ON every company that is off.
--   2c  SWITCH BACK ON one company (change the company name in the last line first).
--   3   WHAT IS CURRENTLY ON OR OFF (read-only, always runs).

-- 1. SWITCH OFF every active company ---------------------------------------------------------------------------------------
--    insert into pbx_company_settings (company_id, is_enabled)
--    select c.id, false from companies c where c.is_active and c.deleted_at is null
--    on conflict (company_id) do update set is_enabled = false, updated_at = now(), updated_by = null;

-- 1b. SWITCH OFF one company ------------------------------------------------------------------------------------------------
--    insert into pbx_company_settings (company_id, is_enabled)
--    select c.id, false from companies c where c.legal_name = 'REPLACE-WITH-COMPANY-LEGAL-NAME'
--    on conflict (company_id) do update set is_enabled = false, updated_at = now(), updated_by = null;

-- 2. SWITCH BACK ON exactly what section 1 / 1b switched off (a switch-off recorded with a person next to it is left as it is) -----
--    update pbx_company_settings s
--       set is_enabled = true, updated_at = now(), updated_by = null
--     where not s.is_enabled
--       and coalesce((select a.actor_id is null
--                       from pbx_audit_log a
--                      where a.table_name = 'pbx_company_settings' and a.company_id = s.company_id
--                        and a.new_row->>'is_enabled' = 'false'
--                      order by a.created_at desc, a.id desc limit 1), true);

-- 2b. SWITCH BACK ON every company that is off -----------------------------------------------------------------------------
--    update pbx_company_settings set is_enabled = true, updated_at = now(), updated_by = null where not is_enabled;

-- 2c. SWITCH BACK ON one company ---------------------------------------------------------------------------------------------
--    update pbx_company_settings set is_enabled = true, updated_at = now(), updated_by = null
--     where not is_enabled and company_id = (select id from companies where legal_name = 'REPLACE-WITH-COMPANY-LEGAL-NAME');

-- 3. WHAT IS CURRENTLY ON OR OFF (read-only) ---------------------------------------------------------------------------------
select c.legal_name as company,
       case when coalesce(s.is_enabled, true) then 'ON' else 'OFF (paused: nothing can be changed, everything can be read)' end as state,
       (select count(*) from pbx_company_grants g where g.company_id = c.id and g.revoked_at is null) as active_grants,
       (select count(*) from pbx_budgets b where b.company_id = c.id) as budgets_on_record,
       (select count(*) from pbx_budgets b where b.company_id = c.id and b.settlement_status <> 'closed') as settlements_not_closed
from companies c
left join pbx_company_settings s on s.company_id = c.id
where c.deleted_at is null
order by c.legal_name;
