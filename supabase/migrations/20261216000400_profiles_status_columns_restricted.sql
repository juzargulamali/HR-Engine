-- A13 / D-11. The deactivation reason is no longer readable by every signed-in user. ADDITIVE: changes SELECT privileges on one table (profiles) and adds one function;
-- no data changes, no policy change, nothing is lost.
--
-- WHY (reproduced on a local copy before the fix: packages/rls-tests/test/profiles_status_columns.rls.test.ts). profiles_select lets every signed-in user read every
-- profile row, and migration 20261104000000 added status_reason (free text a System Administrator types when deactivating an account: it can describe misconduct),
-- status_changed_by and status_changed_at to the same table without narrowing the read. Any employee could read them through the API.
--
-- WHAT.
--   * SELECT on profiles is limited to the directory columns people pickers and approver / manager names need: id, email, full_name, locale, is_active, account_status,
--     created_at, updated_at. status_reason, status_changed_by and status_changed_at can no longer be read directly by anyone signed in (including a System Administrator:
--     they read them through the function below, which checks the role inside). Anonymous visitors lose the table privilege altogether (row-level security already
--     answered them nothing; nothing in the application reads profiles without signing in).
--   * account_status_details(user_id) returns those three values (and the name of the person who made the change) to a System Administrator only.
--
-- WHAT DOES NOT CHANGE. Row visibility (profiles_select and the update policies), names, e-mails and the status itself stay readable for everyone signed in, a person
-- still updates their own name and locale and still completes the first sign-in activation, set_account_status() still records the reason, and the audit trail is
-- unchanged. INSERT, UPDATE and DELETE privileges are untouched. SECURITY DEFINER functions are unaffected.
--
-- TWO THINGS TO KNOW. (1) `select *` on profiles is now refused for signed-in users (naming the columns works); nothing in the application does that. (2) A column
-- added to profiles later is not readable by signed-in users until it is granted explicitly: that is deliberate (a new column starts private).
-- ROLLBACK: supabase/manual-sql/profstat_90_rollback.sql (grants the whole table to signed-in users again: this re-opens the exposure).

revoke select on table profiles from anon, authenticated;
grant select (id, email, full_name, locale, is_active, account_status, created_at, updated_at) on table profiles to authenticated;

create or replace function account_status_details(p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p profiles%rowtype;
begin
  if auth.uid() is null or not has_role('sys_admin') then
    raise exception 'Only a System Administrator can read the reason an account was deactivated' using errcode = '42501';
  end if;
  select * into p from profiles where id = p_user_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'account_status', p.account_status,
    'status_reason', p.status_reason,
    'status_changed_at', p.status_changed_at,
    'status_changed_by', p.status_changed_by,
    'status_changed_by_name', (select coalesce(nullif(btrim(c.full_name), ''), c.email) from profiles c where c.id = p.status_changed_by)
  );
end;
$$;

revoke all on function account_status_details(uuid) from public, anon;
grant execute on function account_status_details(uuid) to authenticated;
