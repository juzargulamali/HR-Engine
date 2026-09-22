-- =============================================================================
-- Local-Postgres stand-in for what the Supabase platform provides automatically
-- on every real project: the `auth` schema, the `anon`/`authenticated`/
-- `service_role` roles, default table grants, and `auth.uid()`/`auth.role()`.
--
-- This file is used ONLY by the RLS test harness (packages/rls-tests) so our
-- migrations can be exercised against a plain local Postgres without needing
-- the full Supabase stack (GoTrue, Realtime, etc.) or Docker. It is never
-- applied to a real Supabase project — Supabase already provides all of this.
--
-- `auth.uid()` here is written to match Supabase's actual implementation
-- exactly, so a policy that passes against this stub behaves identically
-- against a real Supabase project.
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id                uuid primary key default gen_random_uuid(),
  email             text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

-- `nullif(current_setting(...), '')` guards the ::json cast itself — casting
-- an empty string to json raises an error, and an unset-then-rolled-back
-- custom GUC can come back as '' rather than NULL. Guarding after the cast
-- (as a first draft of this might) is too late; the cast has already failed.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role'
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- Mirrors the Supabase platform default: broad table-level grants, with RLS
-- doing the actual row-level restriction. Applied after each migration runs
-- (see packages/rls-tests) so it always covers the tables that exist.
