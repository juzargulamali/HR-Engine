-- ONE CHANGE, to ONE test account. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER you created the test System Administrator in the
-- dashboard (Authentication -> Users -> Add user -> Create new user, "Auto Confirm User" ticked). Do not run it for anyone else.
--
-- It gives that one account the System Administrator role (so the test can use the account controls) and marks its profile Active (a dashboard-
-- created user starts as Invited). Edit the ONE address below, then run the whole file. It refuses, changing nothing, unless:
--   * the address contains "e2e-test-" and matches exactly one account,
--   * that account is not linked to an employee record (a test account is never a person on the payroll),
--   * it does not already hold any other role.
-- Undo: delete the account in the dashboard (Authentication -> Users); its role goes with it (the grant cascades). Then run
-- hosted_account_test_95_after_readonly.sql.

do $$
declare
  v_email text := 'EDIT-ME@example.invalid';   -- <<< the test System Administrator's address, e.g. you+e2e-test-admin@yourdomain
  v_id uuid;
  v_count int;
begin
  if v_email = 'EDIT-ME@example.invalid' then
    raise exception 'Edit the address on the line marked <<< first. Nothing was changed.';
  end if;
  if position('e2e-test-' in lower(v_email)) = 0 then
    raise exception '% does not contain "e2e-test-": this script only ever touches disposable test accounts. Nothing was changed.', v_email;
  end if;

  select count(*), (array_agg(id))[1] into v_count, v_id from auth.users where lower(email) = lower(v_email);
  if v_count <> 1 then
    raise exception 'Expected exactly one account for %, found %. Create it in the dashboard first (or fix the spelling). Nothing was changed.', v_email, v_count;
  end if;
  if exists (select 1 from employees where user_id = v_id) then
    raise exception '% is linked to an employee record, so it is not a disposable test account. Nothing was changed.', v_email;
  end if;
  if exists (select 1 from user_roles where user_id = v_id and revoked_at is null) then
    raise exception '% already holds a role. Nothing was changed.', v_email;
  end if;

  insert into user_roles (user_id, role, company_id, country_code) values (v_id, 'sys_admin', null, null);
  update profiles set account_status = 'active' where id = v_id;
  raise notice 'Done: % (%) is now a System Administrator and Active. Delete it in the dashboard when the test is over.', v_email, v_id;
end $$;

select u.email, p.account_status::text as status,
       (select string_agg(r.role::text, ',') from user_roles r where r.user_id = u.id and r.revoked_at is null) as roles
from auth.users u join profiles p on p.id = u.id
where lower(u.email) like '%e2e-test-%' order by u.email;
