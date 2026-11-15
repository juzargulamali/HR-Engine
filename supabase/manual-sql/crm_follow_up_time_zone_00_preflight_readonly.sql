-- READ ONLY. Run BEFORE applying 20270112000500_crm_follow_up_time_zone.sql. Changes nothing. KEEP THE OUTPUT: row 5 is compared with the verify file afterwards.
-- Expect: rows 1 and 2 'OK'; row 3 'not installed yet' (or 'already installed' on a second run). Rows 4 to 7 are for information.
--   Row 2: follow-up due times are stored as moments (timestamp with time zone). The migration does not read or write them.
--   Row 4: EVERY Sales company with its country and the zone it WILL get (owner decision, 2026-11-15): AE -> Asia/Dubai, SA -> Asia/Riyadh, PL -> Europe/Warsaw.
--   Row 5: THE FINGERPRINT of every follow-up due moment (count / earliest / latest / checksum). It must be IDENTICAL to row 5 of the verify file after the migration.
--   Row 6: companies in a country that is NOT one of the three. They stay on Asia/Dubai and nothing is guessed for them. Expected: 'none'. If a company is
--          listed, decide its zone and set it in Sales settings after the new app is deployed.
--   Row 7: per company that leaves the Dubai clock, how many OPEN follow-ups it has and how many of them are due between 20:00 and 04:00 Dubai time: the ones that
--          can change group (Today / Upcoming) because that company's day starts later than Dubai's. Every one keeps its exact moment.
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
  union all select 4, 'information: each Sales company (country) and the zone it will get',
         coalesce((select string_agg(c.legal_name || ' (' || c.country_code || ') -> ' ||
                     case upper(c.country_code) when 'AE' then 'Asia/Dubai' when 'SA' then 'Asia/Riyadh' when 'PL' then 'Europe/Warsaw' else 'Asia/Dubai (country not in the list: review)' end, ' | ' order by c.legal_name)
                   from crm_company_settings s join companies c on c.id = s.company_id), 'no company has Sales settings')
  union all select 5, 'FINGERPRINT of every follow-up due moment (count / earliest / latest / checksum): must be identical after the migration',
         (select count(*)::text || ' / ' || coalesce(min(due_at at time zone 'UTC')::text, '-') || ' / ' || coalesce(max(due_at at time zone 'UTC')::text, '-') || ' / '
                 || coalesce(md5(string_agg(id::text || ':' || extract(epoch from due_at)::text, ',' order by id)), '-') from crm_follow_ups)
  union all select 6, 'information: Sales companies in a country other than AE, SA, PL (they stay on Asia/Dubai; expected: none)',
         coalesce((select string_agg(c.legal_name || ' (' || c.country_code || ')', ', ' order by c.legal_name)
                   from crm_company_settings s join companies c on c.id = s.company_id where upper(c.country_code) not in ('AE', 'SA', 'PL')), 'none')
  union all select 7, 'information: companies leaving the Dubai clock: open follow-ups / of those, due between 20:00 and 04:00 Dubai time',
         coalesce((select string_agg(legal_name || ' ' || n::text || ' / ' || edge::text, ', ' order by legal_name) from (
            select c.legal_name, count(*) n,
                   count(*) filter (where extract(hour from f.due_at at time zone 'Asia/Dubai') >= 20 or extract(hour from f.due_at at time zone 'Asia/Dubai') < 4) edge
              from crm_follow_ups f join companies c on c.id = f.company_id
             where f.status = 'open' and upper(c.country_code) in ('SA', 'PL') group by c.legal_name) t), 'none')
) x order by ord;
