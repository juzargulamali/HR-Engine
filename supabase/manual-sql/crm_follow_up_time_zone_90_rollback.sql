-- ROLLBACK for 20270112000500_crm_follow_up_time_zone.sql. Either app version works afterwards: without the column the new app treats every company as Asia/Dubai.
-- It STOPS while any company uses a zone other than Asia/Dubai: with the column gone that company's deadlines would be shown and entered on the Dubai clock again,
-- which is a change its staff must be told about. Set the company back to Asia/Dubai in Sales settings first (its stored deadlines do not move), then run this again.
-- It deletes no follow-up and changes no due moment. Safe to run twice.
do $$
declare v integer := 0;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_company_settings' and column_name = 'follow_up_time_zone') then
    execute 'select count(*) from crm_company_settings where follow_up_time_zone <> ''Asia/Dubai''' into v;
  end if;
  if v > 0 then
    raise exception 'STOP: % company(ies) use a follow-up time zone other than Asia/Dubai. Set them back in Sales settings first, then run this again', v;
  end if;
end $$;

drop function if exists crm_set_follow_up_time_zone(uuid, text);
alter table crm_company_settings drop constraint if exists crm_company_settings_follow_up_time_zone;
alter table crm_company_settings drop column if exists follow_up_time_zone;
drop function if exists crm_valid_time_zone(text);
