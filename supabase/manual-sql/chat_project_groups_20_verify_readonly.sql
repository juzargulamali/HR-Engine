-- READ ONLY. Run AFTER 20261230000100_chat_project_groups.sql (and again after any rerun of chat_import_project_messages). One result table; every row must say OK
-- (rows marked INFO only report a number). Creates no row and changes nothing.
-- NOTE: row 3 of the release-1 file chat_20_verify_readonly.sql ("no other kind of group") now reports extra groups. That is expected: the extra groups are the project groups.
select item, result from (
  select 1 as ord, 'every project has exactly one chat group, and every project group points at a project' as item,
         case when not exists (select 1 from proj_projects pr where (select count(*) from chat_groups g where g.project_id = pr.id) <> 1)
                   and not exists (select 1 from chat_groups g where (g.kind = 'project') <> (g.project_id is not null)) then 'OK' else 'FAIL - a project has no group, or two' end as result
  union all select 2, 'every Discussion message that is not deleted has exactly ONE copy in Chat',
         case when not exists (select 1 from proj_messages m where m.deleted_at is null and length(btrim(m.body)) > 0
                                 and (select count(*) from chat_messages c where c.source = 'proj_messages' and c.source_id = m.id) <> 1) then 'OK' else 'FAIL - a message is missing or copied twice' end
  union all select 3, 'every copy is in its own project''s group, with the original author and the original time',
         case when not exists (select 1 from chat_messages c join proj_messages m on m.id = c.source_id join chat_groups g on g.id = c.group_id
                               where c.source = 'proj_messages' and (g.project_id is distinct from m.project_id or c.sender_id <> m.author_id or c.created_at <> m.created_at or c.body <> m.body)) then 'OK' else 'FAIL - a copy differs from its original' end
  union all select 4, 'copies are in the original order inside each group',
         case when not exists (select 1 from chat_messages a join chat_messages b on b.group_id = a.group_id and b.source = 'proj_messages'
                                 join proj_messages ma on ma.id = a.source_id join proj_messages mb on mb.id = b.source_id
                               where a.source = 'proj_messages' and ma.seq < mb.seq and a.seq > b.seq) then 'OK' else 'FAIL - order differs' end
  union all select 5, 'no deleted Discussion message was copied',
         case when not exists (select 1 from chat_messages c join proj_messages m on m.id = c.source_id where c.source = 'proj_messages' and m.deleted_at is not null and c.created_at = m.created_at and c.body = '') then 'OK' else 'FAIL' end
  union all select 6, 'every mention of a copied message was copied',
         case when not exists (select 1 from proj_message_mentions pm join chat_messages c on c.source = 'proj_messages' and c.source_id = pm.message_id
                               where not exists (select 1 from chat_message_mentions cm where cm.message_id = c.id and cm.user_id = pm.user_id)) then 'OK' else 'FAIL - a mention is missing' end
  union all select 7, 'signed-in users can call chat_project_group and the changed functions; anon and public cannot',
         case when (select count(*) from (values ('public.chat_my_groups()'), ('public.chat_group_members(uuid)'), ('public.chat_post(uuid, text, uuid[], text, uuid, text)'), ('public.chat_project_group(uuid)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure(f.sig) and a.grantee = 0)) = 4 then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 8, 'the internal helpers are NOT callable by signed-in users, anon or public',
         case when exists (select 1 from (values ('public.chat_is_project_member(uuid, uuid)'), ('public.chat_is_member(uuid, uuid)'), ('public.chat_ensure_project_group(uuid)'), ('public.chat_import_project_messages(uuid)')) f(sig)
              where to_regprocedure(f.sig) is null or has_function_privilege('authenticated', f.sig, 'execute') or has_function_privilege('anon', f.sig, 'execute')) then 'FAIL - callable or missing' else 'OK' end
  union all select 9, 'signed-in users, anon and public still have NO privilege on the chat tables',
         case when exists (select 1 from unnest(array['chat_groups', 'chat_messages', 'chat_message_mentions', 'chat_read_state']) t, unnest(array['authenticated', 'anon']) r, unnest(array['select', 'insert', 'update', 'delete']) p
                           where has_table_privilege(r, 'public.' || t, p)) then 'FAIL - a privilege is granted' else 'OK' end
  union all select 10, 'project membership reads active enrolment (proj_project_members, not removed, still eligible)',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_is_project_member(uuid, uuid)')) like '%proj_project_members%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_is_project_member(uuid, uuid)')) like '%removed_at is null%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_is_project_member(uuid, uuid)')) like '%proj_user_eligible%' then 'OK' else 'CHANGED' end
  union all select 11, 'the three Sales groups are unchanged (three groups, each bound as before)',
         case when (select count(*) from chat_groups where kind = 'sales' and key in ('sales_uae', 'sales_ksa', 'sales_europe')) = 3 and (select count(*) from chat_groups where kind = 'sales') = 3 then 'OK' else 'CHANGED' end
  union all select 12, 'the mirror triggers are in place (a message posted in the old Discussion is copied at once)',
         case when (select count(*) from pg_trigger where tgname in ('trg_chat_mirror_project_message', 'trg_chat_mirror_project_mention') and not tgisinternal) = 2 then 'OK' else 'MISSING' end
  union all select 13, 'INFO project groups: ' || (select count(*) from chat_groups where kind = 'project')::text, 'INFO'
  union all select 14, 'INFO Discussion messages copied: ' || (select count(*) from chat_messages where source = 'proj_messages')::text || ' (compare with preflight row 6)', 'INFO'
  union all select 15, 'INFO messages written in project groups in Chat itself: ' || (select count(*) from chat_messages c join chat_groups g on g.id = c.group_id where g.kind = 'project' and c.source is null)::text, 'INFO'
) x order by ord;
