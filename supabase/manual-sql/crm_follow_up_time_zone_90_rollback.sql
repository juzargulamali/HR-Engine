-- ROLLBACK for 20270112000500_crm_follow_up_time_zone.sql. It returns EVERY company to the Dubai clock (the column goes; both app versions then treat every company as
-- Asia/Dubai) and changes no follow-up: every due moment stays exactly as it is.
--
-- WHAT IS UNSAFE, AND WHEN IT STOPS. Returning a company to the Dubai clock is harmless for deadlines typed BEFORE this migration (they were typed on the Dubai clock
-- and read that way again). It is NOT harmless for an OPEN deadline that staff of a non-Dubai company typed or moved AFTER the migration, on their own clock: its
-- moment is right and stays right, but the person who typed "10:00" in Warsaw will read "13:00" (winter: 12:00 in summer) once the place after the time is Dubai
-- again. So this script counts those deadlines (open follow-ups of a company not on Asia/Dubai, created or changed since the migration was installed) and STOPS
-- when there are any, listing how many per company. To go ahead knowingly, tell that company's staff first, then run this line and the script in the SAME session:
--     select set_config('crm.time_zone_rollback_confirmed', 'yes', false);
-- With none, it runs straight through. Deploy either app version before or after: without the column the new app treats every company as Asia/Dubai.
-- It deletes no follow-up and changes no due moment (compare the fingerprint: row 5 of the preflight file before and after). Safe to run twice.
do $$
declare v_installed timestamptz; v_n integer := 0; v_list text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_company_settings' and column_name = 'follow_up_time_zone') then
    begin
      v_installed := substring(col_description('public.crm_company_settings'::regclass,
        (select ordinal_position from information_schema.columns where table_schema = 'public' and table_name = 'crm_company_settings' and column_name = 'follow_up_time_zone')::int)
        from 'installed_at=(.*)$')::timestamptz;
    exception when others then v_installed := null; end;
    -- With no installation time on record every open deadline of a non-Dubai company counts (the careful side).
    execute $q$select coalesce(sum(n), 0), string_agg(legal_name || ' ' || n::text, ', ' order by legal_name) from (
               select c.legal_name, count(*) n from crm_follow_ups f join crm_company_settings s on s.company_id = f.company_id join companies c on c.id = f.company_id
                where f.status = 'open' and s.follow_up_time_zone <> 'Asia/Dubai' and ($1 is null or f.created_at >= $1 or f.updated_at >= $1)
                group by c.legal_name) t$q$ into v_n, v_list using v_installed;
    if v_n > 0 and coalesce(current_setting('crm.time_zone_rollback_confirmed', true), '') <> 'yes' then
      raise exception 'STOP: % open follow-up(s) were typed or moved on a non-Dubai clock since this was installed (%). They keep their moment but will be read on the Dubai clock. Tell those teams, then run: select set_config(''crm.time_zone_rollback_confirmed'', ''yes'', false); and this script again in the same session', v_n, v_list;
    end if;
  end if;
end $$;

drop trigger if exists trg_crm_company_settings_time_zone on crm_company_settings;
drop function if exists crm_company_settings_time_zone();
drop function if exists crm_set_follow_up_time_zone(uuid, text);
alter table crm_company_settings drop constraint if exists crm_company_settings_follow_up_time_zone;
alter table crm_company_settings drop column if exists follow_up_time_zone;
drop function if exists crm_default_time_zone(text);
drop function if exists crm_valid_time_zone(text);
