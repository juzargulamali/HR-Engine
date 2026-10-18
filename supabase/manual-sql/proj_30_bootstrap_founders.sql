-- WRITES (only proj_company_grants). Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the seven Projects & Tasks
-- migrations and after proj_20_verify_readonly.sql shows every row as PASS.
--
-- WHY: Projects access is granted from inside the app by a founder (Projects > Access). The very first founders cannot be
-- created from the app, because nobody holds the founder right yet. This script creates them.
--
-- BEFORE RUNNING: replace the placeholder emails below with the real login emails of the founders (the "E" sections of the
-- preflight list the current Sales founders). The script refuses to run while a placeholder remains, and refuses an email that
-- is not an active user. By default the founders are granted every company that has a Projects reference code; to restrict it,
-- list company legal names in v_company_names. THIS CHANGES REAL PEOPLE'S ACCESS: run it only when you intend to.
--
-- WHAT IT DOES NOT DO: no HR role is created or changed, no Sales grant is created or changed, no project or data is created,
-- no company is created. Running it twice is harmless (an existing active grant gets the founder capability added).
-- ROLLBACK is at the bottom.

do $$
declare
  v_emails        text[] := array['REPLACE-WITH-FIRST-FOUNDER-EMAIL', 'REPLACE-WITH-SECOND-FOUNDER-EMAIL'];
  v_company_names text[] := null;    -- null = every company that has a Projects reference code; or e.g. array['Enginious FZ-LLC']
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
      join proj_company_settings s on s.company_id = c.id
      where c.is_active and c.deleted_at is null
        and (v_company_names is null or c.legal_name = any (v_company_names))
    loop
      insert into proj_company_grants (user_id, company_id, capabilities, note)
      values (v_user, v_company.id, array['founder'], 'Bootstrap by owner (manual SQL)')
      on conflict (user_id, company_id) where revoked_at is null
      do update set capabilities = (select array_agg(distinct x) from unnest(proj_company_grants.capabilities || array['founder']) x);
      v_granted := v_granted + 1;
      raise notice 'founder: % -> %', v_email, v_company.legal_name;
    end loop;
  end loop;
  if v_granted = 0 then
    raise exception 'Nothing was granted: no company has a Projects reference code yet (see preflight section D), or v_company_names matched nothing.';
  end if;
  raise notice 'founder grants written or confirmed: %', v_granted;
end $$;

-- Result: who now holds Projects access, per company.
select c.legal_name, p.email, g.capabilities, g.granted_at
from proj_company_grants g
join companies c on c.id = g.company_id
join profiles p on p.id = g.user_id
where g.revoked_at is null
order by c.legal_name, p.email;

-- ROLLBACK (removes the founder grants this script created; do not run once real project work depends on them):
--   update proj_company_grants set revoked_at = now() where note = 'Bootstrap by owner (manual SQL)' and revoked_at is null;
