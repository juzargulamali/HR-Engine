-- READ ONLY. Run AFTER 20270112000500_crm_follow_up_time_zone.sql. Rows 1 to 5 must say OK. ROW 6 MUST BE IDENTICAL to row 5 of the preflight output you kept
-- (count / earliest / latest / checksum): that is the proof that no follow-up due moment was changed. If it differs, STOP: do not deploy the new app; compare the
-- count first (a follow-up added or removed by someone working between the two runs changes it legitimately: rerun both files in a quiet minute); if it still
-- differs, run the rollback and report it. Row 7 is for information. Creates no row.
select item, result from (
  select 1 as ord, 'the zone column exists, is required and is checked against the database''s zone list' as item,
         case when (select is_nullable = 'NO' from information_schema.columns
                     where table_schema = 'public' and table_name = 'crm_company_settings' and column_name = 'follow_up_time_zone')
                   and exists (select 1 from pg_constraint where conname = 'crm_company_settings_follow_up_time_zone' and conrelid = 'public.crm_company_settings'::regclass)
              then 'OK' else 'FAIL - column or check differ' end as result
  union all select 2, 'every company''s zone is a named zone the database knows',
         case when not exists (select 1 from crm_company_settings where not crm_valid_time_zone(follow_up_time_zone)) then 'OK' else 'FAIL - a company has an unknown zone' end
  union all select 3, 'the zone check refuses a fixed offset and accepts a named zone; the country list is AE Dubai, SA Riyadh, PL Warsaw, anything else Dubai',
         case when crm_valid_time_zone('Europe/Warsaw') and crm_valid_time_zone('Asia/Dubai') and not crm_valid_time_zone('+01:00') and not crm_valid_time_zone('UTC+1')
                   and not crm_valid_time_zone('Etc/GMT+1') and not crm_valid_time_zone('CET') and not crm_valid_time_zone('')
                   and crm_default_time_zone('AE') = 'Asia/Dubai' and crm_default_time_zone('SA') = 'Asia/Riyadh' and crm_default_time_zone('PL') = 'Europe/Warsaw'
                   and crm_default_time_zone('DE') = 'Asia/Dubai' and crm_default_time_zone(null) = 'Asia/Dubai' then 'OK' else 'FAIL - the zone check or the country list differs' end
  union all select 4, 'crm_set_follow_up_time_zone exists, signed-in users can call it, anon cannot; the settings function the deployed app calls is unchanged in signature; new settings take the country''s zone',
         case when to_regprocedure('public.crm_set_follow_up_time_zone(uuid, text)') is not null and has_function_privilege('authenticated', 'public.crm_set_follow_up_time_zone(uuid, text)', 'execute')
                   and not has_function_privilege('anon', 'public.crm_set_follow_up_time_zone(uuid, text)', 'execute')
                   and to_regprocedure('public.crm_upsert_settings(uuid, text, text, integer, jsonb, integer, boolean, text, text)') is not null
                   and exists (select 1 from pg_trigger where tgname = 'trg_crm_company_settings_time_zone' and tgrelid = 'public.crm_company_settings'::regclass and not tgisinternal)
              then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 5, 'right after the migration: every company is on the zone of its country (a zone changed in Sales settings since then shows here as a difference, which is fine later on)',
         case when not exists (select 1 from crm_company_settings s join companies c on c.id = s.company_id where s.follow_up_time_zone <> crm_default_time_zone(c.country_code)) then 'OK'
              else 'DIFFERS - ' || (select string_agg(c.legal_name || ': ' || s.follow_up_time_zone, ', ' order by c.legal_name)
                                      from crm_company_settings s join companies c on c.id = s.company_id where s.follow_up_time_zone <> crm_default_time_zone(c.country_code)) end
  union all select 6, 'FINGERPRINT of every follow-up due moment (count / earliest / latest / checksum): must equal the preflight''s row 5',
         (select count(*)::text || ' / ' || coalesce(min(due_at at time zone 'UTC')::text, '-') || ' / ' || coalesce(max(due_at at time zone 'UTC')::text, '-') || ' / '
                 || coalesce(md5(string_agg(id::text || ':' || extract(epoch from due_at)::text, ',' order by id)), '-') from crm_follow_ups)
  union all select 7, 'information: the zone each Sales company HAS (country)',
         coalesce((select string_agg(c.legal_name || ' (' || c.country_code || '): ' || s.follow_up_time_zone, ' | ' order by c.legal_name) from crm_company_settings s join companies c on c.id = s.company_id), 'no company has Sales settings')
) x order by ord;
