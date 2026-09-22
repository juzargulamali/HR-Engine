-- =============================================================================
-- Local-Postgres stand-in for the `storage` schema Supabase Storage provides
-- automatically on every real project — just enough of `storage.buckets`,
-- `storage.objects`, and `storage.foldername()` for our path-based RLS
-- policies to be exercised. See stub-auth-schema.sql for the same idea
-- applied to `auth` — never applied to a real Supabase project, which
-- already has the real thing.
-- =============================================================================

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata   jsonb not null default '{}'::jsonb
);

alter table storage.objects enable row level security;

-- Matches the real implementation: every path segment before the filename.
-- `{company_id}/{employee_id}/{doc_type}/{filename}` -> {company_id, employee_id, doc_type}.
create or replace function storage.foldername(name text)
returns text[]
language sql immutable
as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1];
$$;
