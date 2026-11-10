-- READ-ONLY. Run AFTER 20261225000100_chat_sales_groups.sql. One result table; every row must say OK (rows marked INFO only report a number). Creates no row and changes nothing.
select item, result from (
  select 1 as ord, 'the four chat tables exist with row-level security enabled' as item,
         case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('chat_groups', 'chat_messages', 'chat_message_mentions', 'chat_read_state') and c.relrowsecurity) = 4
              then 'OK' else 'MISSING or RLS off' end as result
  union all select 2, 'signed-in users, anon and public have NO privilege on the chat tables (everything goes through the functions)',
         case when exists (select 1 from unnest(array['chat_groups', 'chat_messages', 'chat_message_mentions', 'chat_read_state']) t,
                                  unnest(array['authenticated', 'anon']) r, unnest(array['select', 'insert', 'update', 'delete']) p
                           where has_table_privilege(r, 'public.' || t, p)) then 'FAIL - a privilege is granted' else 'OK' end
  union all select 3, 'the three Sales groups exist and no other kind of group does',
         case when (select count(*) from chat_groups where kind = 'sales' and key in ('sales_uae', 'sales_ksa', 'sales_europe')) = 3 and (select count(*) from chat_groups) = 3 then 'OK' else 'MISSING or extra' end
  union all select 4, 'each group is bound to exactly ONE company, a different one each (UAE = country AE, KSA = SA, Europe = PL)',
         case when (select count(*) from chat_groups where company_id is not null) = 3 and (select count(distinct company_id) from chat_groups where company_id is not null) = 3
                   and not exists (select 1 from chat_groups g join companies c on c.id = g.company_id where c.country_code <> g.country_code)
              then 'OK' else 'UNBOUND - a group has no company yet: its country must have exactly one active company (listed by the next rows); until then it has no members' end
  union all select 5 + g.sort_order, 'INFO group ' || g.key || ' -> ' || coalesce(c.legal_name, 'NOT BOUND') || ' (current members: ' ||
         (select count(*) from crm_company_grants cg join profiles p on p.id = cg.user_id and p.is_active where cg.company_id = g.company_id and cg.revoked_at is null)::text || ')', 'INFO'
         from chat_groups g left join companies c on c.id = g.company_id
  union all select 9, 'the five chat functions exist and signed-in users can call them; anon and public cannot',
         case when (select count(*) from (values
              ('public.chat_my_groups()'), ('public.chat_group_members(uuid)'), ('public.chat_messages(uuid, bigint, bigint, integer)'),
              ('public.chat_post(uuid, text, uuid[], text, uuid, text)'), ('public.chat_mark_read(uuid, bigint)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure(f.sig) and a.grantee = 0)) = 5 then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 10, 'the internal helpers are NOT callable by signed-in users, anon or public',
         case when exists (select 1 from (values
              ('public.chat_has_company_grant(uuid, uuid)'), ('public.chat_has_any_grant(uuid)'), ('public.chat_is_member(uuid, uuid)'), ('public.chat_name(uuid)'),
              ('public.chat_sync_sales_groups()'), ('public.chat_resolve_item(uuid, text, uuid)')) f(sig)
              where to_regprocedure(f.sig) is null or has_function_privilege('authenticated', f.sig, 'execute') or has_function_privilege('anon', f.sig, 'execute')) then 'FAIL - callable or missing' else 'OK' end
  union all select 11, 'membership reads the existing Sales grants only (crm_company_grants, not revoked, active profile): the member check is defined in terms of that table',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_has_company_grant(uuid, uuid)')) like '%crm_company_grants%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_has_company_grant(uuid, uuid)')) like '%revoked_at is null%'
                   and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_has_company_grant(uuid, uuid)')) like '%is_active%' then 'OK' else 'CHANGED' end
  union all select 12, 'INFO messages stored so far: ' || (select count(*) from chat_messages)::text, 'INFO'
) x order by ord;
