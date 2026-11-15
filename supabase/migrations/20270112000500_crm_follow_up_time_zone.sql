-- =====================================================================================================================================================================
-- Sales follow-ups: a time zone per company.
--
-- Before this migration every follow-up time was typed and shown as Dubai time, for every company: the app converted "20 Oct, 11:00" to the stored moment with
-- Asia/Dubai, and decided "due today" on the Dubai calendar day.
--
-- What this adds (additive; no existing function is replaced; NO follow-up row is read or written):
--   1. crm_company_settings.follow_up_time_zone: an IANA zone name ('Asia/Dubai', 'Europe/Warsaw', ...), NOT NULL. A fixed offset ('+01:00', 'UTC+1') is refused:
--      the name must be one the database's own zone list knows (pg_timezone_names), so daylight-saving changes are followed by the platform's zone database.
--   2. THE DEFAULT OF EACH COMPANY (owner decision, 2026-11-15) comes from one stored fact, the company's country (companies.country_code):
--          AE -> Asia/Dubai        SA -> Asia/Riyadh        PL -> Europe/Warsaw        any other country -> Asia/Dubai (never guessed; the preflight lists it)
--      crm_default_time_zone(country) holds that list. Every company that already has Sales settings gets its zone ONCE, when the column is first added; running
--      this file again changes no company (a zone the owner changed since is kept). A company whose Sales settings are created later gets its zone the same way
--      (trigger trg_crm_company_settings_time_zone on insert).
--   3. crm_set_follow_up_time_zone(company, zone): the people who may change Sales settings (manage_settings) change it. Audited by the table's existing trigger.
--      crm_upsert_settings (the function the deployed app calls to save settings) is not replaced and does not touch the new column.
--
-- WHAT STAFF OF A NON-DUBAI COMPANY SEE AFTER THIS (with the new app). crm_follow_ups.due_at is timestamptz, a moment in time; this migration does not write it.
-- For the Saudi and the Polish company the SAME moments are from now on SHOWN on the Riyadh / Warsaw clock, with the place written after the time, and grouped
-- into Overdue / Today / Upcoming by that company's own calendar day. A deadline typed earlier as 10:00 (Dubai time) reads 09:00 (Riyadh), and 07:00 (Warsaw) in
-- winter or 08:00 (Warsaw) in summer. It is due at exactly the same moment as before. New and edited deadlines are typed on the company's clock.
--
-- STILL ON THE DUBAI CLOCK FOR EVERY COMPANY (owner decision, 2026-11-15, for this release): the two date-based reminders of crm_generate_reminders (a hold's
-- review date, and "no next action" once a day), the period boundaries of the Sales reports, and JARVIS. crm_generate_reminders is NOT replaced here; its
-- follow-up reminders are decided on the stored moment (due_at <= now, and 24 hours later), so they are right in every zone already.
--
-- Compatibility with the app that is deployed today: it never names the column; its reads (select *) return one more field it ignores; crm_upsert_settings keeps
-- the value; it goes on showing and taking every time on the Dubai clock, exactly as now. Apply this BEFORE or AFTER the new app: without the column the new app
-- treats every company as Asia/Dubai (today's behaviour) and its settings screen says the zone cannot be changed yet.
--
-- Safe to run twice. Rollback: supabase/manual-sql/crm_follow_up_time_zone_90_rollback.sql.
-- =====================================================================================================================================================================

create or replace function crm_valid_time_zone(p_tz text)
returns boolean language sql stable set search_path = public as $$
  -- A named zone of the platform's zone database (Area/City), never an abbreviation or a fixed offset: those do not follow daylight-saving changes.
  -- ('Etc/GMT+1' is a fixed offset with a zone-like name, and 'posix/...' and 'right/...' are the database's own variants: none of them is accepted.)
  select p_tz is not null and p_tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$' and p_tz !~ '^(Etc|posix|right)/'
         and exists (select 1 from pg_timezone_names where name = p_tz);
$$;

-- The zone a company starts with, from its country. Anything not listed is Asia/Dubai: no zone is guessed for a country the business has not decided.
create or replace function crm_default_time_zone(p_country_code text)
returns text language sql immutable as $$
  select case upper(coalesce(p_country_code, '')) when 'AE' then 'Asia/Dubai' when 'SA' then 'Asia/Riyadh' when 'PL' then 'Europe/Warsaw' else 'Asia/Dubai' end;
$$;

do $$
begin
  -- Only the FIRST time: the column is added and each existing company takes the zone of its country. A second run finds the column and changes nothing.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_company_settings' and column_name = 'follow_up_time_zone') then
    alter table crm_company_settings add column follow_up_time_zone text not null default 'Asia/Dubai';
    -- updated_at and updated_by are left as they were: this is the installation, not a person's change (the audit trigger still records the new value).
    alter table crm_company_settings disable trigger crm_company_settings_set_updated_at;
    update crm_company_settings s set follow_up_time_zone = crm_default_time_zone(c.country_code)
      from companies c where c.id = s.company_id and crm_default_time_zone(c.country_code) <> 'Asia/Dubai';
    alter table crm_company_settings enable trigger crm_company_settings_set_updated_at;
    -- When this was installed: the rollback uses it to tell which deadlines were typed on a non-Dubai clock since.
    execute format('comment on column crm_company_settings.follow_up_time_zone is %L', 'installed_at=' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end if;
end $$;
alter table crm_company_settings drop constraint if exists crm_company_settings_follow_up_time_zone;
alter table crm_company_settings add constraint crm_company_settings_follow_up_time_zone check (crm_valid_time_zone(follow_up_time_zone));

-- A company whose Sales settings are created later starts on its country's zone too (the functions that create settings do not name the column).
create or replace function crm_company_settings_time_zone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.follow_up_time_zone := crm_default_time_zone((select c.country_code from companies c where c.id = new.company_id));
  return new;
end;
$$;
drop trigger if exists trg_crm_company_settings_time_zone on crm_company_settings;
create trigger trg_crm_company_settings_time_zone before insert on crm_company_settings for each row execute function crm_company_settings_time_zone();

create or replace function crm_set_follow_up_time_zone(p_company_id uuid, p_time_zone text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tz text := btrim(coalesce(p_time_zone, ''));
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not crm_has_capability(p_company_id, 'manage_settings') then
    raise exception 'Not allowed to change CRM settings for this company' using errcode = '42501';
  end if;
  if not crm_valid_time_zone(v_tz) then
    raise exception 'Choose a time zone by its name, for example Asia/Dubai or Europe/Warsaw' using errcode = '22023';
  end if;
  update crm_company_settings set follow_up_time_zone = v_tz, updated_by = auth.uid()
   where company_id = p_company_id and follow_up_time_zone is distinct from v_tz;
  if not found and not exists (select 1 from crm_company_settings where company_id = p_company_id) then
    raise exception 'Save the Sales settings of this company (reference code and currency) first' using errcode = '23514';
  end if;
end;
$$;

revoke all on function crm_set_follow_up_time_zone(uuid, text), crm_company_settings_time_zone() from public, anon, authenticated;
grant execute on function crm_set_follow_up_time_zone(uuid, text) to authenticated;
