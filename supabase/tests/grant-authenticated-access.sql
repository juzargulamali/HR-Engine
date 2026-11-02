-- Run AFTER every migration in the RLS test harness (see packages/rls-tests).
-- On the real Supabase platform this happens automatically for every table
-- created in `public` — RLS, not table-level grants, is meant to be the
-- actual gate. Our stub has to do it explicitly since it's plain Postgres.

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- profiles: migration 20261216000400 limits SELECT on profiles to the directory columns (status_reason, status_changed_by and status_changed_at are readable only
-- through account_status_details()). The blanket grant above would silently undo that in the test database, which production does not do, so re-apply it here
-- once the migration exists. (Tests that build the database before that migration, with setupBefore, never run this file.)
do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'account_status_details') then
    revoke select on table profiles from anon, authenticated;
    grant select (id, email, full_name, locale, is_active, account_status, created_at, updated_at) on table profiles to authenticated;
  end if;
end $$;

-- Keep future tables covered automatically without editing this file again.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;

-- Same idea for the storage stub (stub-storage-schema.sql) — Supabase grants
-- this automatically on a real project too.
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated;
