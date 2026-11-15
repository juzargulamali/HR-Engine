-- READ ONLY. Run BEFORE applying 20270112000500_crm_follow_up_time_zone.sql. Changes nothing.
-- Expect: rows 1 and 2 'OK'; row 3 'not installed yet' (or 'already installed' on a second run). Rows 4 to 6 are for information.
--   Row 2: follow-up due times are stored as moments (timestamp with time zone). The migration does not read or write them, so every existing due moment is
--          preserved exactly. Row 5 is the fingerprint to compare before and after: it must be IDENTICAL in the verify file.
--   Row 4: the Sales companies with their country, and the zone each will have after the migration: Asia/Dubai for every one (today's behaviour, nothing shifts).
--          SUGGESTION ONLY, not applied: a company whose country is PL would normally use Europe/Warsaw, and SA Asia/Riyadh. The owner sets it afterwards in
--          Sales settings (per company) if and when wanted. Setting it changes how that company's existing deadlines are DISPLAYED (the same moment, on the new
--          clock) and which calendar day counts as "today"; it does not move any deadline.
--   Row 6: open follow-ups per company that fall due between 20:00 and 04:00 Dubai time: the ones whose "today" would change if that company's zone were changed.
select item, result from (
  select 1 as ord, 'the Sales settings table and the capability check exist' as item,
         case when to_regclass('public.crm_company_settings') is not null and to_regprocedure('public.crm_has_capability(uuid, text)') is not null
                   and to_regclass('public.crm_follow_ups') is not null then 'OK' else 'STOP - Sales & CRM is not installed; do not apply' end as result
  union all select 2, 'follow-up due times are stored as moments (timestamp with time zone)',
         case when (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'crm_follow_ups' and column_name = 'due_at') = 'timestamp with time zone'
              then 'OK' else 'STOP - crm_follow_ups.due_at is not a timestamp with time zone; do not apply' end
  union all select 3, 'this migration is not installed yet',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_company_settings' and column_name = 'follow_up_time_zone')
              then 'already installed' else 'not installed yet' end
  union all select 4, 'information: Sales companies (country): zone after the migration, and the usual zone of that country as a suggestion',
         coalesce((select string_agg(c.legal_name || ' (' || c.country_code || '): Asia/Dubai' ||
                     case c.country_code when 'PL' then '; suggestion Europe/Warsaw' when 'SA' then '; suggestion Asia/Riyadh' else '' end, ' | ' order by c.legal_name)
                   from crm_company_settings s join companies c on c.id = s.company_id), 'no company has Sales settings')
  union all select 5, 'information: fingerprint of every follow-up due moment (count / earliest / latest / checksum): must be identical after the migration',
         (select count(*)::text || ' / ' || coalesce(min(due_at at time zone 'UTC')::text, '-') || ' / ' || coalesce(max(due_at at time zone 'UTC')::text, '-') || ' / '
                 || coalesce(md5(string_agg(id::text || ':' || extract(epoch from due_at)::text, ',' order by id)), '-') from crm_follow_ups)
  union all select 6, 'information: open follow-ups due between 20:00 and 04:00 Dubai time, per company',
         coalesce((select string_agg(legal_name || ' ' || n::text, ', ' order by legal_name) from (
            select c.legal_name, count(*) n from crm_follow_ups f join companies c on c.id = f.company_id
             where f.status = 'open' and (extract(hour from f.due_at at time zone 'Asia/Dubai') >= 20 or extract(hour from f.due_at at time zone 'Asia/Dubai') < 4)
             group by c.legal_name) t), 'none')
) x order by ord;
