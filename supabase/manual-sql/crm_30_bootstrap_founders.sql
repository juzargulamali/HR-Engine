-- WRITES (only crm_company_grants). Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the four Sales & CRM
-- migrations and after crm_20_verify_readonly.sql shows every row as PASS.
--
-- WHY: Sales access is granted from inside the app by a founder (Sales > Access). The very first founders cannot be
-- created from the app, because nobody holds the founder right yet. This script creates them, for Juzar and Rafi only.
--
-- BEFORE RUNNING: replace the two placeholder emails below with the real login emails of Juzar and Rafi (the "E
-- candidate founders" section of the preflight shows them). The script refuses to run while a placeholder remains,
-- and refuses an email that is not an active user. By default the founders are granted every company that already has
-- a Sales settings row; to restrict it, list company legal names in v_company_names.
--
-- WHAT IT DOES NOT DO: no HR role is created or changed, no real client data is imported, no company is created.
-- Running it twice is harmless (an existing active grant gets the founder capability added, nothing else changes).
-- ROLLBACK is at the bottom.

do $$
declare
  v_emails        text[] := array['REPLACE-WITH-JUZAR-EMAIL', 'REPLACE-WITH-RAFI-EMAIL'];
  v_company_names text[] := null;    -- null = every company that has a Sales settings row; or e.g. array['Enginious FZ-LLC']
  v_email text;
  v_user  uuid;
  v_company record;
  v_granted int := 0;
begin
  foreach v_email in array v_emails loop
    if v_email like 'REPLACE-WITH-%' or position('@' in v_email) = 0 then
      raise exception 'Edit the founder emails at the top of this file first (found: %).', v_email;
    end if;
    select p.id into v_user from profiles p where lower(p.email) = lower(btrim(v_email)) and p.is_active;
    if v_user is null then
      raise exception 'No active user has the email %. Check the spelling against the preflight list.', v_email;
    end if;
    for v_company in
      select c.id, c.legal_name
      from companies c
      join crm_company_settings s on s.company_id = c.id
      where c.is_active and c.deleted_at is null
        and (v_company_names is null or c.legal_name = any (v_company_names))
    loop
      insert into crm_company_grants (user_id, company_id, capabilities, note)
      values (v_user, v_company.id, array['founder'], 'Bootstrap by owner (manual SQL)')
      on conflict (user_id, company_id) where revoked_at is null
      do update set capabilities = (select array_agg(distinct x) from unnest(crm_company_grants.capabilities || array['founder']) x);
      v_granted := v_granted + 1;
      raise notice 'founder: % -> %', v_email, v_company.legal_name;
    end loop;
  end loop;
  if v_granted = 0 then
    raise exception 'Nothing was granted: no company has a Sales settings row yet (see preflight section D), or v_company_names matched nothing.';
  end if;
  raise notice 'founder grants written or confirmed: %', v_granted;
end $$;

-- Result: who now holds Sales access, per company.
select c.legal_name, p.email, g.capabilities, g.granted_at
from crm_company_grants g
join companies c on c.id = g.company_id
join profiles p on p.id = g.user_id
where g.revoked_at is null
order by c.legal_name, p.email;

-- ROLLBACK (removes the founder grants this script created; do not run once real Sales work depends on them):
--   update crm_company_grants set revoked_at = now() where note = 'Bootstrap by owner (manual SQL)' and revoked_at is null;
