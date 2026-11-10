-- -----------------------------------------------------------------------------
-- JARVIS: personal memory (structured preferences) and guidance correction suggestions.
--
-- Small and additive: two tables and four functions. Nothing existing is changed; the JARVIS switches, pilot list, ledger, proof key and wrappers are untouched.
--
--   jarvis_preferences             one row per person per preference. ONLY the closed set of key/value pairs below can be stored (a CHECK enforces it), so memory can
--                                  never hold a business record, a credential, a sensitive fact or chat text. Personal: a person reaches only their own rows, and only
--                                  through the functions (which take no user argument: the person is auth.uid()).
--   jarvis_knowledge_suggestions   a person's suggested correction to a guidance topic, stored FOR REVIEW. It changes nothing JARVIS says: guidance changes only when
--                                  the Map file is edited, reviewed and published (docs/enginious-os/staff-guidance/README.md). Reviewed by the owner with
--                                  supabase/manual-sql/jarvis_memory_30_suggestions_review_readonly.sql.
--
-- RLS is on for both tables with NO policy and no table privilege for any API role: the only way in is the functions.
-- Every function requires JARVIS to be available to the caller (jarvis_my_access: main switch on, pilot list, active profile).
-- ROLLBACK: supabase/manual-sql/jarvis_memory_90_rollback.sql (drops the two tables and four functions; export the suggestions first if they matter).
-- -----------------------------------------------------------------------------

create table if not exists jarvis_preferences (
  user_id    uuid not null references auth.users(id) on delete cascade,
  pref_key   text not null,
  pref_value text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, pref_key),
  constraint jarvis_preferences_known check (
       (pref_key = 'email_length'  and pref_value in ('short', 'medium', 'detailed'))
    or (pref_key = 'english'       and pref_value in ('british', 'american'))
    or (pref_key = 'tone'          and pref_value in ('formal', 'friendly', 'neutral'))
    or (pref_key = 'answer_length' and pref_value in ('brief', 'detailed'))
  )
);

create table if not exists jarvis_knowledge_suggestions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  topic_id    text not null check (topic_id ~ '^[a-z][a-z0-9-]{2,60}$'),
  body        text not null check (length(btrim(body)) between 5 and 1000),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text
);
create index if not exists idx_jarvis_suggestions_status on jarvis_knowledge_suggestions(status, created_at);

alter table jarvis_preferences enable row level security;
alter table jarvis_knowledge_suggestions enable row level security;
revoke all on table jarvis_preferences, jarvis_knowledge_suggestions from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table jarvis_preferences, jarvis_knowledge_suggestions from service_role';
  end if;
end $$;

-- The caller's own preferences. Listing and deleting work whenever JARVIS is available to the person, so they can always see and remove what is remembered.
create or replace function jarvis_pref_list()
returns table (pref_key text, pref_value text, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select a.is_available from jarvis_my_access() a), false) then
    raise exception 'JARVIS is not available to you' using errcode = '42501';
  end if;
  return query select p.pref_key, p.pref_value, p.updated_at from jarvis_preferences p where p.user_id = auth.uid() order by p.pref_key;
end;
$$;

create or replace function jarvis_pref_set(p_key text, p_value text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select a.is_available from jarvis_my_access() a), false) then
    raise exception 'JARVIS is not available to you' using errcode = '42501';
  end if;
  -- The table CHECK refuses anything that is not one of the known pairs (23514).
  insert into jarvis_preferences as p (user_id, pref_key, pref_value) values (auth.uid(), p_key, p_value)
  on conflict (user_id, pref_key) do update set pref_value = excluded.pref_value, updated_at = now();
end;
$$;

create or replace function jarvis_pref_delete(p_key text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select a.is_available from jarvis_my_access() a), false) then
    raise exception 'JARVIS is not available to you' using errcode = '42501';
  end if;
  delete from jarvis_preferences where user_id = auth.uid() and pref_key = p_key;
end;
$$;

-- A suggestion for review. At most 20 pending per person, so the table cannot be filled.
create or replace function jarvis_suggest_correction(p_topic text, p_text text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select a.is_available from jarvis_my_access() a), false) then
    raise exception 'JARVIS is not available to you' using errcode = '42501';
  end if;
  if (select count(*) from jarvis_knowledge_suggestions where user_id = auth.uid() and status = 'pending') >= 20 then
    raise exception 'You already have many suggestions waiting for review' using errcode = '54000';
  end if;
  insert into jarvis_knowledge_suggestions (user_id, topic_id, body) values (auth.uid(), p_topic, btrim(p_text)) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function jarvis_pref_list(), jarvis_pref_set(text, text), jarvis_pref_delete(text), jarvis_suggest_correction(text, text) from public, anon;
grant execute on function jarvis_pref_list(), jarvis_pref_set(text, text), jarvis_pref_delete(text), jarvis_suggest_correction(text, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function jarvis_pref_list(), jarvis_pref_set(text, text), jarvis_pref_delete(text), jarvis_suggest_correction(text, text) from service_role';
  end if;
end $$;
