-- Run AFTER every migration in the RLS test harness (see packages/rls-tests).
-- On the real Supabase platform this happens automatically for every table
-- created in `public` — RLS, not table-level grants, is meant to be the
-- actual gate. Our stub has to do it explicitly since it's plain Postgres.

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Keep future tables covered automatically without editing this file again.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;

-- Same idea for the storage stub (stub-storage-schema.sql) — Supabase grants
-- this automatically on a real project too.
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated;
