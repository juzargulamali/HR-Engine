-- public schema: remove table privileges that row-level security does not govern, for every table,
-- today and in the future.
--
-- WHY. Supabase gives `anon` and `authenticated` broad default grants on every new public table.
-- Row-level security governs SELECT / INSERT / UPDATE / DELETE, but NOT:
--   * TRUNCATE   empties a table and ignores row-level security entirely
--   * TRIGGER    lets the holder attach a trigger to the table
--   * REFERENCES lets the holder create a foreign key pointing at the table
--   * MAINTAIN   (PostgreSQL 17+) VACUUM / ANALYZE / REINDEX / LOCK TABLE ...
-- Confirmed on V2: about 55 public tables grant these to anon and authenticated. The REST API does not
-- expose them, so this is not an open door today; it removes the door so a future mistake cannot open it.
-- (The two ledger tables were already hardened by migration 20261113000000.)
--
-- WHAT.
--   1. For every ordinary or partitioned table in schema public: revoke TRUNCATE, TRIGGER, REFERENCES
--      (and MAINTAIN on PostgreSQL 17+) from anon, authenticated and PUBLIC.
--   2. Default privileges for FUTURE tables created by postgres (and by the role running this script, and by
--      supabase_admin where permitted) in schema public: do not grant those privileges to anon / authenticated.
-- NOT TOUCHED: SELECT / INSERT / UPDATE / DELETE on any table, policies, data, views, sequences, functions,
-- service_role, postgres and every other role. SECURITY DEFINER functions run with the owner's rights and are
-- unaffected. Nothing here reads or changes data.
--
-- Tables this role does not own cannot be changed by it: they are skipped with a NOTICE (the verify script
-- lists any that remain).
--
-- Additive and idempotent: running it twice is harmless. ROLLBACK block at the bottom.

do $$
declare
  v_pg17 boolean := current_setting('server_version_num')::int >= 170000;
  t record;
  v_done int := 0;
  v_skipped int := 0;
  r text;
  v_roles text[];
begin
  if (select count(*) from pg_roles where rolname in ('anon', 'authenticated')) <> 2 then
    raise exception 'The roles anon and authenticated must both exist; stop and compare with the repository.';
  end if;

  -- 1. Existing tables ------------------------------------------------------------------------
  for t in
    select c.oid::regclass as rel, c.relname, pg_has_role(current_user, c.relowner, 'USAGE') as can_change
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    order by c.relname
  loop
    if not t.can_change then
      raise notice 'skipped % (owned by a role this session cannot act as)', t.relname;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    execute format('revoke truncate, trigger, references on table %s from anon, authenticated, public', t.rel);
    if v_pg17 then
      execute format('revoke maintain on table %s from anon, authenticated, public', t.rel);
    end if;
    v_done := v_done + 1;
  end loop;
  raise notice 'public tables hardened: %, skipped: %', v_done, v_skipped;

  -- 2. Default privileges for tables created in the future ------------------------------------
  select array_agg(distinct x) into v_roles
  from unnest(array['postgres', current_user::text, 'supabase_admin']) x
  where exists (select 1 from pg_roles where rolname = x);

  foreach r in array v_roles loop
    begin
      execute format('alter default privileges for role %I in schema public revoke truncate, trigger, references on tables from anon, authenticated', r);
      if v_pg17 then
        execute format('alter default privileges for role %I in schema public revoke maintain on tables from anon, authenticated', r);
      end if;
    exception when insufficient_privilege then
      raise notice 'default privileges for role % were not changed (this session may not act as that role)', r;
    end;
  end loop;
end $$;

-- ROLLBACK (only if needed; restores Supabase's default grants on every public table and for future tables):
--   do $$ declare t record; begin
--     for t in select c.oid::regclass as rel from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') loop
--       execute format('grant truncate, trigger, references on table %s to anon, authenticated', t.rel);
--       if current_setting('server_version_num')::int >= 170000 then execute format('grant maintain on table %s to anon, authenticated', t.rel); end if;
--     end loop;
--   end $$;
--   alter default privileges for role postgres in schema public grant truncate, trigger, references on tables to anon, authenticated;
--   -- (PostgreSQL 17 also: alter default privileges for role postgres in schema public grant maintain on tables to anon, authenticated;)
