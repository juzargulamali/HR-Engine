-- App-wide Chat, release 2: one chat group per PROJECT, and the transfer of the Projects "Discussion" messages into it. ADDITIVE. Applied AFTER 20261229000100.
-- Nothing is deleted: proj_messages and its functions stay exactly as they are (the old Discussion keeps working until the app that removes its tab is deployed).
--
-- WHO IS IN A PROJECT GROUP (no member list exists; computed on every call, like the Sales groups)
--   A person is a member of a project's group exactly when they are ACTIVELY ENROLLED in that project: a proj_project_members row that is not removed, their profile is
--   active, and they are still eligible for the project (proj_user_eligible: the same test proj_is_active_member uses, so revoking their Projects access ends chat access too).
--   Company access, a Projects grant, a founder grant or Sales access ALONE grants nothing here. Adding someone to the project adds them to the chat on the next call;
--   removing or deactivating them removes the group, its history, its unread count and the right to post or be mentioned on the next call.
--   DIFFERENCE FROM THE OLD DISCUSSION: a company founder who is NOT enrolled in the project could read its Discussion. They are not a member of the project's chat group.
--
-- WHAT MOVES
--   Every proj_messages row that is not deleted is copied into chat_messages of its project's group with the SAME author and the SAME created_at, in the original order
--   (proj_messages.seq). Each copy carries source = 'proj_messages' and source_id = the original id, under a unique index: a rerun (or the mirror trigger below) can never
--   create a second copy. Mentions are copied. Deleted messages are not copied. Replies are copied as ordinary messages in time order (Chat has no threads).
--   A person's read marker for a group starts at the newest message the first time the group is listed for them (chat_my_groups), so migrated history is never "unread".
--   MIRROR: until the new app is live, a message posted in the old Discussion is copied into the group at once by a trigger on proj_messages, so nothing is lost between
--   applying this migration and deploying the app. chat_import_project_messages() can be rerun at any time and is a no-op when nothing is missing.
--
-- WHAT IS ENFORCED WHERE: unchanged. The chat tables grant nothing to signed-in users; every read and write goes through the functions, which check membership per call.
-- ROLLBACK: supabase/manual-sql/chat_project_groups_90_rollback.sql (export the project groups' chat_messages first: messages written in Chat after the cutover are deleted by it).

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Shape: a group may belong to a project; a message may carry the identity of the row it was copied from
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table chat_groups drop constraint if exists chat_groups_kind_check;
alter table chat_groups add constraint chat_groups_kind_check check (kind in ('sales', 'project'));
alter table chat_groups alter column country_code drop not null;
alter table chat_groups add column if not exists project_id uuid references proj_projects(id) on delete cascade;
create unique index if not exists uq_chat_groups_project on chat_groups(project_id) where project_id is not null;
alter table chat_groups drop constraint if exists chat_groups_project_shape;
alter table chat_groups add constraint chat_groups_project_shape check ((kind = 'project') = (project_id is not null));

alter table chat_messages add column if not exists source text;
alter table chat_messages add column if not exists source_id uuid;
alter table chat_messages drop constraint if exists chat_messages_source;
alter table chat_messages add constraint chat_messages_source check ((source is null) = (source_id is null));
create unique index if not exists uq_chat_messages_source on chat_messages(source, source_id) where source_id is not null;

-- A project that is deleted takes its group with it (chat_groups.project_id cascades); the group's messages and read markers go first.
create or replace function chat_group_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from chat_read_state where group_id = old.id;
  delete from chat_messages where group_id = old.id;
  return old;
end;
$$;
drop trigger if exists trg_chat_group_cleanup on chat_groups;
create trigger trg_chat_group_cleanup before delete on chat_groups for each row execute function chat_group_cleanup();

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Internal helpers (not granted to anyone)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Active enrolment in ONE project, for ANY user (a mention concerns someone other than the caller). Mirrors proj_is_active_member.
create or replace function chat_is_project_member(p_user uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from proj_project_members m join proj_projects pr on pr.id = m.project_id
    where m.project_id = p_project and m.user_id = p_user and m.removed_at is null and proj_user_eligible(pr.company_id, m.user_id, pr.id));
$$;

create or replace function chat_is_member(p_user uuid, p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chat_groups g where g.id = p_group and (
      (g.kind = 'sales' and g.company_id is not null and chat_has_company_grant(p_user, g.company_id))
      or (g.kind = 'project' and g.project_id is not null and chat_is_project_member(p_user, g.project_id))));
$$;

-- The group of one project, created if it does not exist yet (idempotent). The stored name is a snapshot; the functions below always show the project's CURRENT name.
create or replace function chat_ensure_project_group(p_project uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from chat_groups where project_id = p_project;
  if v_id is not null then return v_id; end if;
  insert into chat_groups (key, kind, name, project_id, sort_order)
    select 'project:' || pr.id, 'project', pr.reference || ' · ' || pr.name, pr.id, 100 from proj_projects pr where pr.id = p_project
    on conflict do nothing;
  select id into v_id from chat_groups where project_id = p_project;
  return v_id;
end;
$$;

-- Copies Discussion messages that are not in Chat yet (one project, or all). Safe to rerun: the unique (source, source_id) index and "not exists" make it a no-op.
create or replace function chat_import_project_messages(p_project uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform chat_ensure_project_group(x.project_id) from (select distinct project_id from proj_messages where p_project is null or project_id = p_project) x;
  with ins as (
    insert into chat_messages (group_id, sender_id, body, created_at, source, source_id)
      select g.id, m.author_id, m.body, m.created_at, 'proj_messages', m.id
      from proj_messages m join chat_groups g on g.project_id = m.project_id
      where (p_project is null or m.project_id = p_project) and m.deleted_at is null and length(btrim(m.body)) > 0
        and not exists (select 1 from chat_messages c where c.source = 'proj_messages' and c.source_id = m.id)
      order by m.seq
    on conflict do nothing
    returning id, source_id)
  , men as (
    insert into chat_message_mentions (message_id, user_id)
      select ins.id, pm.user_id from ins join proj_message_mentions pm on pm.message_id = ins.source_id
    on conflict do nothing
    returning 1)
  select (select count(*) from ins)::integer into v_n;
  return v_n;
end;
$$;

-- Mirror: a message posted in the old Discussion (by an app version that still has the tab) is copied into the project's group at once.
create or replace function chat_mirror_project_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  if new.deleted_at is not null or length(btrim(new.body)) = 0 then return new; end if;
  v_group := chat_ensure_project_group(new.project_id);
  if v_group is null then return new; end if;
  insert into chat_messages (group_id, sender_id, body, created_at, source, source_id)
    values (v_group, new.author_id, new.body, new.created_at, 'proj_messages', new.id)
    on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists trg_chat_mirror_project_message on proj_messages;
create trigger trg_chat_mirror_project_message after insert on proj_messages for each row execute function chat_mirror_project_message();

-- Mentions of a mirrored message arrive just after it (proj_post_message inserts them in the same transaction).
create or replace function chat_mirror_project_mention()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into chat_message_mentions (message_id, user_id)
    select c.id, new.user_id from chat_messages c where c.source = 'proj_messages' and c.source_id = new.message_id
    on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists trg_chat_mirror_project_mention on proj_message_mentions;
create trigger trg_chat_mirror_project_mention after insert on proj_message_mentions for each row execute function chat_mirror_project_mention();

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Functions the app calls (each one checks membership itself)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The caller's groups: the Sales groups first, then their projects' groups, most recent conversation first. A finished project (completed or archived) is read-only, and is
-- listed only while it has messages. The return type gains three columns, so the function is dropped and created again in this one transaction.
drop function if exists chat_my_groups();
create function chat_my_groups()
returns table (gid uuid, gkey text, gname text, unread bigint, mentions bigint, last_at timestamptz, last_sender text, last_preview text, gkind text, project_id uuid, read_only boolean)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform chat_sync_sales_groups();
  perform chat_ensure_project_group(m.project_id) from proj_project_members m
    where m.user_id = v_user and m.removed_at is null and not exists (select 1 from chat_groups g where g.project_id = m.project_id);
  insert into chat_read_state (user_id, group_id, last_read_seq)
    select v_user, g.id, coalesce((select max(m.seq) from chat_messages m where m.group_id = g.id), 0)
    from chat_groups g where chat_is_member(v_user, g.id)
  on conflict do nothing;
  return query
    select g.id, g.key, case when pr.id is null then g.name else pr.reference || ' · ' || pr.name end,
           (select count(*) from chat_messages m where m.group_id = g.id and m.seq > rs.last_read_seq and m.sender_id <> v_user),
           (select count(*) from chat_message_mentions mm join chat_messages m on m.id = mm.message_id
              where m.group_id = g.id and mm.user_id = v_user and m.seq > rs.last_read_seq and m.sender_id <> v_user),
           lm.created_at, case when lm.id is null then null else chat_name(lm.sender_id) end,
           case when lm.id is null then null when length(btrim(lm.body)) = 0 then 'Shared an item' else left(lm.body, 80) end,
           g.kind, g.project_id, coalesce(pr.status in ('completed', 'archived'), false)
    from chat_groups g
    join chat_read_state rs on rs.user_id = v_user and rs.group_id = g.id
    left join proj_projects pr on pr.id = g.project_id
    left join lateral (select m2.id, m2.created_at, m2.sender_id, m2.body from chat_messages m2 where m2.group_id = g.id order by m2.seq desc limit 1) lm on true
    where chat_is_member(v_user, g.id)
      and (g.kind <> 'project' or pr.status not in ('completed', 'archived') or lm.id is not null)
    order by case when g.kind = 'sales' then 0 else 1 end, g.sort_order, lm.created_at desc nulls last, 3;
end;
$$;

-- The current members of one group (for @mentions). Members only.
create or replace function chat_group_members(p_group uuid)
returns table (user_id uuid, name text)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_company uuid; v_project uuid;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not chat_is_member(v_user, p_group) then raise exception 'You are not a member of this group' using errcode = '42501'; end if;
  select g.company_id, g.project_id into v_company, v_project from chat_groups g where g.id = p_group;
  if v_project is not null then
    return query
      select distinct m.user_id, chat_name(m.user_id) from proj_project_members m
      where m.project_id = v_project and m.removed_at is null and chat_is_project_member(m.user_id, v_project) order by 2;
  else
    return query
      select distinct g.user_id, chat_name(g.user_id) from crm_company_grants g join profiles p on p.id = g.user_id and p.is_active
      where g.company_id = v_company and g.revoked_at is null order by 2;
  end if;
end;
$$;

-- Posting: as before, plus one rule for project groups: a finished project's conversation is read-only (the rule the old Discussion had).
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
  if exists (select 1 from chat_groups g join proj_projects pr on pr.id = g.project_id where g.id = p_group and pr.status in ('completed', 'archived')) then
    raise exception 'This project is finished, so its conversation is read-only' using errcode = '23514';
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

-- The chat group of ONE project, for a member only (old Discussion links and the project's "Open chat" shortcut use it). Anyone else, and an unknown project, get the same refusal.
create or replace function chat_project_group(p_project uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not chat_is_project_member(v_user, p_project) then raise exception 'You are not a member of this group' using errcode = '42501'; end if;
  return chat_ensure_project_group(p_project);
end;
$$;

revoke all on function
  chat_is_project_member(uuid, uuid), chat_is_member(uuid, uuid), chat_ensure_project_group(uuid), chat_import_project_messages(uuid), chat_mirror_project_message(),
  chat_mirror_project_mention(), chat_group_cleanup(), chat_my_groups(), chat_group_members(uuid), chat_post(uuid, text, uuid[], text, uuid, text), chat_project_group(uuid)
  from public, anon, authenticated;
grant execute on function chat_my_groups(), chat_group_members(uuid), chat_post(uuid, text, uuid[], text, uuid, text), chat_project_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- One group per existing project, then the transfer (both idempotent)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
select chat_ensure_project_group(pr.id) from proj_projects pr where not exists (select 1 from chat_groups g where g.project_id = pr.id);
select chat_import_project_messages();
