-- App-wide Chat, release 1: the three Sales groups (Sales — UAE, Sales — KSA, Sales — Europe). ADDITIVE ONLY. Applied AFTER 20261224000100.
-- Nothing existing is altered: new tables and functions only. Projects discussions, JARVIS and every CRM table, policy and grant are untouched.
--
-- WHO IS IN A GROUP (no member list exists; membership is computed from existing access on every call)
--   A person is a member of "Sales — <region>" exactly when they hold an ACTIVE Sales & CRM grant for THAT company (crm_company_grants, not revoked, profile active). In this
--   system a Sales grant is per person per company and is what People & Access -> Module access edits, so "Sales & CRM access AND access to that company" is that one grant;
--   there is no separate company-access table that Sales does not already use. Company access alone (an HR role, an employee record, another module's grant) grants nothing here.
--   Someone with a Sales grant in all three companies is a member of all three groups. There is no all-company Sales group.
--   The group -> company binding is by the company's country (AE = UAE, SA = KSA, PL = Europe, the only European company). It binds only when exactly ONE active company has that
--   country; otherwise the group stays unbound and has no members (fails closed, never broader).
--
-- WHAT IS ENFORCED WHERE
--   The tables grant NOTHING to signed-in users (RLS on, no policy). Every read and write goes through the functions below, which check membership with auth.uid() on every call:
--   listing groups, history, posting, marking read, unread counts, the member list and @mentions. When access is removed the group vanishes from the list, its history can no longer be
--   read, it stops counting toward unread and posting is refused. A mention must name a CURRENT member of that group.
--   A shared item is stored as a reference (type + id). The SENDER must be able to see it when sharing; each READER's own current access is checked when the message is returned: with
--   access they get its title and link, without it only {"restricted": true}. No title, type or other detail of an item is stored in or returned to someone who may not see it, and
--   no notification or preview carries one. Opening a shared item still uses its existing page permissions.
--
-- ROLLBACK: supabase/manual-sql/chat_90_rollback.sql (export chat_messages first: it is deleted).

create table if not exists chat_groups (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  kind         text not null check (kind in ('sales')),       -- 'project' is planned: a later migration widens this check; no project group exists in this release
  name         text not null,
  country_code text not null,
  company_id   uuid references companies(id),
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now()
);
create unique index if not exists uq_chat_groups_company on chat_groups(company_id) where company_id is not null;

insert into chat_groups (key, kind, name, country_code, sort_order) values
  ('sales_uae', 'sales', 'Sales — UAE', 'AE', 1),
  ('sales_ksa', 'sales', 'Sales — KSA', 'SA', 2),
  ('sales_europe', 'sales', 'Sales — Europe', 'PL', 3)
on conflict (key) do nothing;

create table if not exists chat_messages (
  id         uuid primary key default gen_random_uuid(),
  seq        bigint generated always as identity,
  group_id   uuid not null references chat_groups(id),
  sender_id  uuid not null references auth.users(id),
  body       text not null default '' check (length(body) <= 4000),
  ref_type   text check (ref_type in ('enquiry', 'estimate', 'account', 'event', 'edition')),
  ref_id     uuid,
  client_key text check (client_key is null or length(client_key) <= 64),
  created_at timestamptz not null default now(),
  constraint chat_messages_content check (length(btrim(body)) > 0 or ref_id is not null),
  constraint chat_messages_ref check ((ref_type is null) = (ref_id is null))
);
create unique index if not exists uq_chat_messages_seq on chat_messages(seq);
create index if not exists idx_chat_messages_group_seq on chat_messages(group_id, seq desc);
create unique index if not exists uq_chat_messages_client_key on chat_messages(group_id, sender_id, client_key) where client_key is not null;

create table if not exists chat_message_mentions (
  message_id uuid not null references chat_messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id),
  primary key (message_id, user_id)
);
create index if not exists idx_chat_mentions_user on chat_message_mentions(user_id);

create table if not exists chat_read_state (
  user_id       uuid not null references auth.users(id) on delete cascade,
  group_id      uuid not null references chat_groups(id),
  last_read_seq bigint not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (user_id, group_id)
);

do $$
declare t text;
begin
  foreach t in array array['chat_groups', 'chat_messages', 'chat_message_mentions', 'chat_read_state'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);   -- no policy and no grant: only the functions below can touch them
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Internal helpers (not granted to anyone). They mirror crm_has_access / crm_has_any_access for ANY user, because a mention or a shared item concerns someone other than the caller.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function chat_has_company_grant(p_user uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from crm_company_grants g join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = p_user and g.company_id = p_company and g.revoked_at is null);
$$;

create or replace function chat_has_any_grant(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from crm_company_grants g join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = p_user and g.revoked_at is null);
$$;

create or replace function chat_is_member(p_user uuid, p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_groups g where g.id = p_group and g.kind = 'sales' and g.company_id is not null and chat_has_company_grant(p_user, g.company_id));
$$;

create or replace function chat_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.full_name), ''), nullif(split_part(p.email, '@', 1), ''), 'Unknown') from profiles p where p.id = p_user;
$$;

-- Binds each Sales group to the ONE active company of its country (idempotent; ambiguous or missing = stays unbound = no members).
create or replace function chat_sync_sales_groups()
returns void language sql security definer set search_path = public as $$
  update chat_groups g set company_id = c.id
  from (select country_code, (array_agg(id))[1] as id, count(*) as n from companies where is_active and deleted_at is null group by country_code) c
  where g.kind = 'sales' and g.company_id is null and g.country_code = c.country_code and c.n = 1;
$$;
select chat_sync_sales_groups();

-- What a shared item looks like to ONE viewer: its title and link when the viewer's own current access allows it, otherwise only {"restricted": true}. The access rules are the
-- ones the item's table already uses: enquiries and estimates by company grant; accounts, events and editions by any Sales grant (the shared directory is unchanged).
create or replace function chat_resolve_item(p_viewer uuid, p_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if p_type = 'enquiry' then
    select jsonb_build_object('type', 'enquiry', 'id', o.id, 'title', o.reference || ' · ' || o.title, 'subtitle', 'Enquiry', 'href', '/sales/opportunities/' || o.id)
      into r from crm_opportunities o where o.id = p_id and chat_has_company_grant(p_viewer, o.company_id);
  elsif p_type = 'estimate' then
    select jsonb_build_object('type', 'estimate', 'id', p.id, 'title', 'Estimate v' || p.version || ' · ' || o.reference, 'subtitle', o.title,
                              'href', '/sales/opportunities/' || o.id || '/quotations/' || p.id)
      into r from crm_proposals p join crm_opportunities o on o.id = p.opportunity_id where p.id = p_id and chat_has_company_grant(p_viewer, p.company_id);
  elsif p_type = 'account' then
    select jsonb_build_object('type', 'account', 'id', o.id, 'title', o.name,
             'subtitle', coalesce((select string_agg(case x when 'agency' then 'Agency' when 'direct' then 'Direct client' when 'client' then 'Client' when 'technology' then 'Technology company' else x end, ' · ') from unnest(o.roles) x), 'Account'),
             'href', '/sales/accounts/' || o.id)
      into r from crm_organisations o where o.id = p_id and chat_has_any_grant(p_viewer);
  elsif p_type = 'event' then
    select jsonb_build_object('type', 'event', 'id', e.id, 'title', e.name, 'subtitle', 'Event', 'href', '/sales/events/' || e.id)
      into r from crm_events e where e.id = p_id and chat_has_any_grant(p_viewer);
  elsif p_type = 'edition' then
    select jsonb_build_object('type', 'edition', 'id', d.id, 'title', e.name || ' · ' || extract(year from d.start_date)::int || coalesce(' · ' || d.city, ''), 'subtitle', 'Edition · ' || to_char(d.start_date, 'YYYY-MM-DD'),
                              'href', '/sales/events/' || e.id || '?edition=' || d.id)
      into r from crm_event_editions d join crm_events e on e.id = d.event_id where d.id = p_id and chat_has_any_grant(p_viewer);
  end if;
  return coalesce(r, jsonb_build_object('restricted', true));        -- also for an unknown id: "no such item" and "not yours" look the same
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Functions the app calls (granted to signed-in users; each one checks membership itself)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The caller's groups with unread counts. The first time a group is listed for a person the read marker starts at the newest message (no flood of "unread" for history).
create or replace function chat_my_groups()
returns table (gid uuid, gkey text, gname text, unread bigint, mentions bigint, last_at timestamptz, last_sender text, last_preview text)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform chat_sync_sales_groups();
  insert into chat_read_state (user_id, group_id, last_read_seq)
    select v_user, g.id, coalesce((select max(m.seq) from chat_messages m where m.group_id = g.id), 0)
    from chat_groups g where chat_is_member(v_user, g.id)
  on conflict do nothing;
  return query
    select g.id, g.key, g.name,
           (select count(*) from chat_messages m where m.group_id = g.id and m.seq > rs.last_read_seq and m.sender_id <> v_user),
           (select count(*) from chat_message_mentions mm join chat_messages m on m.id = mm.message_id
              where m.group_id = g.id and mm.user_id = v_user and m.seq > rs.last_read_seq and m.sender_id <> v_user),
           lm.created_at, case when lm.id is null then null else chat_name(lm.sender_id) end,
           case when lm.id is null then null when length(btrim(lm.body)) = 0 then 'Shared an item' else left(lm.body, 80) end
    from chat_groups g
    join chat_read_state rs on rs.user_id = v_user and rs.group_id = g.id
    left join lateral (select m2.id, m2.created_at, m2.sender_id, m2.body from chat_messages m2 where m2.group_id = g.id order by m2.seq desc limit 1) lm on true
    where chat_is_member(v_user, g.id)
    order by g.sort_order;
end;
$$;

-- The current members of one group (for @mentions). Members only.
create or replace function chat_group_members(p_group uuid)
returns table (user_id uuid, name text)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_company uuid;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not chat_is_member(v_user, p_group) then raise exception 'You are not a member of this group' using errcode = '42501'; end if;
  select g.company_id into v_company from chat_groups g where g.id = p_group;
  return query
    select distinct g.user_id, chat_name(g.user_id) from crm_company_grants g join profiles p on p.id = g.user_id and p.is_active
    where g.company_id = v_company and g.revoked_at is null order by 2;
end;
$$;

-- History (newest page, or older than p_before, or newer than p_after). Shared items are resolved for THIS reader.
create or replace function chat_messages(p_group uuid, p_before bigint default null, p_after bigint default null, p_limit integer default 40)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100); v_rows jsonb; v_more boolean := false; v_read bigint;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not chat_is_member(v_user, p_group) then raise exception 'You are not a member of this group' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x.j order by x.seq), '[]'::jsonb) into v_rows from (
    select m.seq, jsonb_build_object(
      'id', m.id, 'seq', m.seq, 'senderId', m.sender_id, 'senderName', chat_name(m.sender_id), 'body', m.body, 'createdAt', m.created_at,
      'mentions', (select coalesce(jsonb_agg(jsonb_build_object('userId', mm.user_id, 'name', chat_name(mm.user_id))), '[]'::jsonb) from chat_message_mentions mm where mm.message_id = m.id),
      'shared', case when m.ref_type is null then null else chat_resolve_item(v_user, m.ref_type, m.ref_id) end) as j
    from chat_messages m
    where m.group_id = p_group and (p_before is null or m.seq < p_before) and (p_after is null or m.seq > p_after)
    order by case when p_after is null then m.seq end desc, case when p_after is not null then m.seq end asc
    limit v_limit) x;
  if p_after is null then
    select exists (select 1 from chat_messages m where m.group_id = p_group and m.seq < coalesce((select min((e ->> 'seq')::bigint) from jsonb_array_elements(v_rows) e), 0)) into v_more;
  end if;
  select rs.last_read_seq into v_read from chat_read_state rs where rs.user_id = v_user and rs.group_id = p_group;
  return jsonb_build_object('messages', v_rows, 'hasMore', v_more, 'lastRead', coalesce(v_read, 0));
end;
$$;

create or replace function chat_post(p_group uuid, p_body text, p_mentions uuid[] default '{}', p_ref_type text default null, p_ref_id uuid default null, p_client_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_body text := btrim(coalesce(p_body, '')); v_id uuid; v_seq bigint; m uuid; v_existing chat_messages;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not chat_is_member(v_user, p_group) then raise exception 'You are not a member of this group' using errcode = '42501'; end if;
  if length(v_body) > 4000 then raise exception 'A message can be at most 4000 characters' using errcode = '22023'; end if;
  if v_body = '' and p_ref_id is null then raise exception 'Write a message or share an item' using errcode = '22023'; end if;
  if (p_ref_type is null) <> (p_ref_id is null) then raise exception 'Choose the item to share' using errcode = '22023'; end if;
  if coalesce(array_length(p_mentions, 1), 0) > 20 then raise exception 'Too many mentions' using errcode = '22023'; end if;
  if p_client_key is not null then
    select * into v_existing from chat_messages where group_id = p_group and sender_id = v_user and client_key = p_client_key;
    if found then return jsonb_build_object('id', v_existing.id, 'seq', v_existing.seq, 'duplicate', true); end if;
  end if;
  foreach m in array coalesce(p_mentions, '{}') loop
    if not chat_is_member(m, p_group) then raise exception 'You can only mention current members of this group' using errcode = '22023'; end if;
  end loop;
  if p_ref_id is not null then
    if p_ref_type not in ('enquiry', 'estimate', 'account', 'event', 'edition') then raise exception 'That kind of item cannot be shared' using errcode = '22023'; end if;
    if (chat_resolve_item(v_user, p_ref_type, p_ref_id) ->> 'restricted') is not null then raise exception 'You do not have access to that item, so you cannot share it' using errcode = '42501'; end if;
  end if;
  insert into chat_messages (group_id, sender_id, body, ref_type, ref_id, client_key) values (p_group, v_user, v_body, p_ref_type, p_ref_id, p_client_key) returning id, seq into v_id, v_seq;
  insert into chat_message_mentions (message_id, user_id) select v_id, x from (select distinct unnest(coalesce(p_mentions, '{}')) x) s where x <> v_user;
  insert into chat_read_state (user_id, group_id, last_read_seq) values (v_user, p_group, v_seq)
    on conflict (user_id, group_id) do update set last_read_seq = greatest(chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now();
  return jsonb_build_object('id', v_id, 'seq', v_seq, 'duplicate', false);
end;
$$;

create or replace function chat_mark_read(p_group uuid, p_seq bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_max bigint;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not chat_is_member(v_user, p_group) then raise exception 'You are not a member of this group' using errcode = '42501'; end if;
  select coalesce(max(seq), 0) into v_max from chat_messages where group_id = p_group;
  insert into chat_read_state (user_id, group_id, last_read_seq) values (v_user, p_group, least(coalesce(p_seq, 0), v_max))
    on conflict (user_id, group_id) do update set last_read_seq = greatest(chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now();
end;
$$;

revoke all on function
  chat_has_company_grant(uuid, uuid), chat_has_any_grant(uuid), chat_is_member(uuid, uuid), chat_name(uuid), chat_sync_sales_groups(), chat_resolve_item(uuid, text, uuid),
  chat_my_groups(), chat_group_members(uuid), chat_messages(uuid, bigint, bigint, integer), chat_post(uuid, text, uuid[], text, uuid, text), chat_mark_read(uuid, bigint)
  from public, anon, authenticated;
grant execute on function
  chat_my_groups(), chat_group_members(uuid), chat_messages(uuid, bigint, bigint, integer), chat_post(uuid, text, uuid[], text, uuid, text), chat_mark_read(uuid, bigint)
  to authenticated;
