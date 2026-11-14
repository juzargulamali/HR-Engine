-- ROLLBACK for 20270110000100_ops_tv_display.sql. Deploy the app from before this change FIRST (the /tv page and /api/tv/board call these functions; without them they show "not installed").
-- It STOPS while any display is still active: revoke each one first (Operations, Office board displays, Revoke), then run this again. It deletes no project, activity, crew, shipment, handover
-- or Inventory record. It drops the six functions and the display table (the history of who registered and revoked a display goes with it: export it first if you want it).
-- The display sign-in accounts themselves are NOT deleted here: remove them in the app (People & Access) or the Supabase dashboard (Authentication, Users). Safe to run twice.
do $$
declare v_active integer := 0;
begin
  if to_regclass('public.ops_tv_displays') is not null then
    execute 'select count(*) from ops_tv_displays where revoked_at is null' into v_active;
  end if;
  if v_active > 0 then
    raise exception 'STOP: % office board display(s) are still active. Revoke them first, then run this again', v_active;
  end if;
end $$;

drop function if exists ops_tv_board(uuid);
drop function if exists ops_tv_my_display();
drop function if exists ops_tv_register_display(uuid, uuid, text, text);
drop function if exists ops_tv_revoke_display(uuid);
drop function if exists ops_tv_list_displays(uuid);
drop function if exists ops_tv_person_name(uuid);
drop table if exists ops_tv_displays;
