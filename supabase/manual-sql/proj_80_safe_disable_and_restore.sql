-- WRITES (only proj_company_grants). A SAFE SWITCH-OFF that loses nothing. Run in the SQL Editor of "Enginious HR Engine_V2".
--
-- WHY: if Projects must be paused (a bug, an audit, a pause for training), the safest way is NOT to drop anything but to withdraw
-- every Projects grant. With no active grant: the Projects module disappears from the menu, every Projects page and function refuses,
-- project members lose access at once (membership only counts while the person still holds access), and Sales people linked to a project
-- see nothing of it only if they also lose their Sales access (a Sales link is separate: see the last query). No project, task, message,
-- file, issued plan or audit row is changed or deleted, and the HR and Sales modules are not touched.
--
-- HOW TO USE: run section 1 to switch off, and section 2 later to switch back on exactly as it was. Both mark the rows they touch with
-- the note 'SAFE-DISABLE <timestamp>' so only those rows are restored. Edit nothing else.

-- 1. SWITCH OFF -----------------------------------------------------------------------------------------------------
-- update proj_company_grants
--    set revoked_at = now(), revoked_by = null, note = 'SAFE-DISABLE ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || coalesce(' | ' || note, '')
--  where revoked_at is null;

-- 2. SWITCH BACK ON (restores only the rows section 1 switched off; people who were deliberately revoked before stay revoked) --------------
-- update proj_company_grants
--    set revoked_at = null, revoked_by = null, note = nullif(regexp_replace(note, '^SAFE-DISABLE [^|]*\|? ?', ''), '')
--  where note like 'SAFE-DISABLE %' and revoked_at is not null
--    and not exists (select 1 from proj_company_grants a where a.user_id = proj_company_grants.user_id and a.company_id = proj_company_grants.company_id and a.revoked_at is null);

-- 3. WHAT IS CURRENTLY ON OR OFF (read-only)
select count(*) filter (where revoked_at is null) as active_grants,
       count(*) filter (where note like 'SAFE-DISABLE %' and revoked_at is not null) as switched_off_by_safe_disable,
       count(*) filter (where revoked_at is not null and (note is null or note not like 'SAFE-DISABLE %')) as revoked_for_other_reasons
from proj_company_grants;

-- 4. SALES LINKS are recorded relationships that follow each person's Sales access, not a Projects grant. To also hide linked projects
-- from Sales people while Projects is off, pause their Sales access in Sales > Access (or revoke their CRM grants the usual way); links are never deleted.
select count(*) as active_sales_links from proj_sales_links where removed_at is null;
