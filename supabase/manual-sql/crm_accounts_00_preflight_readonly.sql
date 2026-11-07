-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261219000100_crm_clients_agencies.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send the full result.
--   A  who is running this     B  prerequisites and "not applied yet"     C  what exists today (information only)     D  contact e-mails held twice (must be none)
-- HOW TO READ IT: every section B row must say OK and the last one must say the change is NOT yet applied. Section D must say OK: the migration adds a rule
-- "one contact e-mail once per organisation" and stops (changing nothing) if an organisation already holds the same e-mail twice; the rows are listed so you can tidy them first.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text as detail
  union all select 'A session', 2, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 100 + row_number() over (order by t), 'table ' || t,
         case when to_regclass('public.' || t) is not null then 'OK' else 'MISSING - install the Sales module first' end
    from unnest(array['crm_organisations', 'crm_contacts', 'crm_opportunities', 'crm_follow_ups', 'crm_company_grants', 'crm_audit_log']) t
  union all select 'B prerequisites', 200 + row_number() over (order by f), 'function ' || f,
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'OK' else 'MISSING - install the Sales module first' end
    from unnest(array['crm_has_access', 'crm_has_capability', 'crm_is_founder', 'crm_is_any_founder', 'crm_user_has_company_access', 'crm_require_follow_up_actor', 'crm_lock_opportunity', 'crm_audit_trigger', 'set_updated_at']) f
  union all select 'B prerequisites', 300, 'applied already?',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_organisations' and column_name = 'roles')
              then 'ALREADY APPLIED - not a first run; run crm_accounts_20_verify_readonly.sql instead'
              else 'OK - not applied yet' end
  union all select 'C what exists today', 1000, 'organisations by kind', (select coalesce(string_agg(kind || ': ' || n, ', ' order by kind), 'none') from (select kind, count(*) n from crm_organisations group by kind) k)
  union all select 'C what exists today', 1001, 'organisations (archived)', (select count(*)::text || ' (' || count(*) filter (where archived_at is not null)::text || ')' from crm_organisations)
  union all select 'C what exists today', 1002, 'contacts', (select count(*)::text from crm_contacts)
  union all select 'C what exists today', 1003, 'open follow-ups', (select count(*)::text from crm_follow_ups where status = 'open')
  union all select 'C what exists today', 1004, 'people holding assign_owner or founder (active grants)', (select count(*)::text from crm_company_grants where revoked_at is null and ('founder' = any (capabilities) or 'assign_owner' = any (capabilities)))
  union all select 'D duplicate contact e-mails', 2000, 'organisations holding one e-mail twice',
         case when n = 0 then 'OK - none' else 'FIX FIRST - ' || n || ' e-mail(s) held twice in one organisation; archive or edit the repeats, then run again' end
    from (select count(*) n from (select 1 from crm_contacts where organisation_id is not null and email_key is not null and archived_at is null group by organisation_id, email_key having count(*) > 1) d) x
  union all select 'D duplicate contact e-mails', 2001 + (row_number() over (order by o.name, d.email_key)), o.name || ' (' || o.id || ')', d.email_key || ' x ' || d.n
    from (select organisation_id, email_key, count(*) n from crm_contacts where organisation_id is not null and email_key is not null and archived_at is null group by organisation_id, email_key having count(*) > 1) d
    join crm_organisations o on o.id = d.organisation_id
) r
order by section, ord, item;
