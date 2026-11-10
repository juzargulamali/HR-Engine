-- WRITES. OWNER-RUN ROLLBACK of 20261225000100_chat_sales_groups.sql. Safe to run twice. EXPORT chat_messages FIRST: every chat message, mention and read marker is deleted.
-- It does NOT touch any Sales, Projects, JARVIS, HR or Inventory table, function, policy or grant, and the previous app version simply shows no Chat button (it never calls these functions).
do $$ declare n integer;
begin
  if to_regclass('public.chat_messages') is not null then
    select count(*) into n from chat_messages;
    raise notice 'chat messages deleted by this rollback: %', n;
  end if;
end $$;
begin;
drop function if exists chat_mark_read(uuid, bigint);
drop function if exists chat_post(uuid, text, uuid[], text, uuid, text);
drop function if exists chat_messages(uuid, bigint, bigint, integer);
drop function if exists chat_group_members(uuid);
drop function if exists chat_my_groups();
drop function if exists chat_resolve_item(uuid, text, uuid);
drop function if exists chat_sync_sales_groups();
drop function if exists chat_name(uuid);
drop function if exists chat_is_member(uuid, uuid);
drop function if exists chat_has_any_grant(uuid);
drop function if exists chat_has_company_grant(uuid, uuid);
drop table if exists chat_read_state;
drop table if exists chat_message_mentions;
drop table if exists chat_messages;
drop table if exists chat_groups;
commit;
