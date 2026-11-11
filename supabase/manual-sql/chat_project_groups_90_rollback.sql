-- WRITES. OWNER-RUN ROLLBACK of 20261230000100_chat_project_groups.sql. Safe to run twice.
-- BEFORE running it:
--   1. Deploy (or keep) an app version that still has the Projects Discussion tab. The Discussion tables were never changed, so that tab shows every message it had.
--   2. EXPORT the project groups' messages. Messages written in Chat after the cutover exist ONLY in chat_messages and are deleted here:
--        select g.project_id, m.* from chat_messages m join chat_groups g on g.id = m.group_id where g.kind = 'project' order by m.seq;
-- AFTER running it: apply supabase/migrations/20261225000100_chat_sales_groups.sql again (it is idempotent). That restores the release-1 functions for the Sales groups
-- (chat_my_groups, chat_is_member, chat_group_members, chat_post). Until then the Chat button is simply absent. Sales messages, mentions and read markers are kept.
do $$ declare n integer;
begin
  if to_regclass('public.chat_groups') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_groups' and column_name = 'project_id') then
    execute 'select count(*) from chat_messages m join chat_groups g on g.id = m.group_id where g.kind = ''project'' and m.source is null' into n;
    raise notice 'messages written in project groups in Chat (NOT in the old Discussion) deleted by this rollback: %', n;
  end if;
end $$;
begin;
drop trigger if exists trg_chat_mirror_project_mention on proj_message_mentions;
drop trigger if exists trg_chat_mirror_project_message on proj_messages;
drop function if exists chat_mirror_project_mention();
drop function if exists chat_mirror_project_message();
drop function if exists chat_project_group(uuid);
drop function if exists chat_import_project_messages(uuid);
drop function if exists chat_my_groups();
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_groups' and column_name = 'project_id') then
    delete from chat_read_state where group_id in (select id from chat_groups where kind = 'project');
    delete from chat_messages where group_id in (select id from chat_groups where kind = 'project');
    drop trigger if exists trg_chat_group_cleanup on chat_groups;
    delete from chat_groups where kind = 'project';
  end if;
end $$;
drop function if exists chat_group_cleanup();
drop function if exists chat_ensure_project_group(uuid);
-- chat_is_member is replaced by the release-1 definition when 20261225000100 is applied again; until then it must not mention the helper dropped below.
create or replace function chat_is_member(p_user uuid, p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_groups g where g.id = p_group and g.kind = 'sales' and g.company_id is not null and chat_has_company_grant(p_user, g.company_id));
$$;
revoke all on function chat_is_member(uuid, uuid) from public, anon, authenticated;
drop function if exists chat_is_project_member(uuid, uuid);
drop index if exists uq_chat_messages_source;
alter table chat_messages drop constraint if exists chat_messages_source;
alter table chat_messages drop column if exists source_id;
alter table chat_messages drop column if exists source;
drop index if exists uq_chat_groups_project;
alter table chat_groups drop constraint if exists chat_groups_project_shape;
alter table chat_groups drop column if exists project_id;
alter table chat_groups drop constraint if exists chat_groups_kind_check;
alter table chat_groups add constraint chat_groups_kind_check check (kind in ('sales'));
alter table chat_groups alter column country_code set not null;
commit;
