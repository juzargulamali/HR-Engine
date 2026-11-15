-- =====================================================================================================================================================================
-- Sales follow-ups: a time zone per company.
--
-- Before this migration every follow-up time was typed and shown as Dubai time, for every company: the app converted "20 Oct, 11:00" to the stored moment with
-- Asia/Dubai, and decided "due today" on the Dubai calendar day.
--
-- What this adds (additive; no existing function is replaced and NO existing row is changed):
--   1. crm_company_settings.follow_up_time_zone: an IANA zone name ('Asia/Dubai', 'Europe/Warsaw', ...), NOT NULL, default 'Asia/Dubai'. Every existing company
--      therefore gets Asia/Dubai, which is exactly the behaviour it has today: nothing shifts on rollout. A fixed offset ('+01:00', 'UTC+1') is refused: the name
--      must be one the database's own zone list knows (pg_timezone_names), so daylight-saving changes are followed by the platform's zone database.
--   2. crm_set_follow_up_time_zone(company, zone): the people who may change Sales settings (manage_settings) change it. Audited by the table's existing trigger.
--      crm_upsert_settings (the function the deployed app calls to save settings) is not replaced and does not touch the new column.
--
-- Existing follow-ups: crm_follow_ups.due_at is timestamptz, a moment in time. This migration does not read or write crm_follow_ups, and changing a company's zone
-- later does not either: the same moment is then SHOWN on that company's clock, and "due today" is decided on that company's calendar day. New and edited deadlines
-- are typed on the company's clock.
--
-- Reminders: crm_generate_reminders is NOT replaced. Its follow-up reminders are decided on the stored moment (due_at <= now, and 24 hours later), so they are right in
-- every zone already. Its two date-based reminders (a hold's review date, and "no next action" once a day) still use the Dubai calendar day for every company: see
-- the open decision recorded with this change.
--
-- Compatibility with the app that is deployed today: it never names the column; its reads (select *) return one more field it ignores; crm_upsert_settings keeps the
-- value. Apply this BEFORE or AFTER the new app: without the column the new app treats every company as Asia/Dubai (today's behaviour) and its settings screen says
-- the zone cannot be changed yet.
--
-- Safe to run twice. Rollback: supabase/manual-sql/crm_follow_up_time_zone_90_rollback.sql (it stops while any company uses a zone other than Asia/Dubai).
-- =====================================================================================================================================================================

create or replace function crm_valid_time_zone(p_tz text)
returns boolean language sql stable set search_path = public as $$
  -- A named zone of the platform's zone database (Area/City), never an abbreviation or a fixed offset: those do not follow daylight-saving changes.
  -- ('Etc/GMT+1' is a fixed offset with a zone-like name, and 'posix/...' and 'right/...' are the database's own variants: none of them is accepted.)
  select p_tz is not null and p_tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$' and p_tz !~ '^(Etc|posix|right)/'
         and exists (select 1 from pg_timezone_names where name = p_tz);
$$;

alter table crm_company_settings add column if not exists follow_up_time_zone text not null default 'Asia/Dubai';
alter table crm_company_settings drop constraint if exists crm_company_settings_follow_up_time_zone;
alter table crm_company_settings add constraint crm_company_settings_follow_up_time_zone check (crm_valid_time_zone(follow_up_time_zone));

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

revoke all on function crm_set_follow_up_time_zone(uuid, text) from public, anon, authenticated;
grant execute on function crm_set_follow_up_time_zone(uuid, text) to authenticated;
