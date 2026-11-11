-- READ ONLY. Run BEFORE applying 20261230000100_chat_project_groups.sql. Changes nothing.
-- Expect: rows 1 to 3 'OK'; row 4 'not installed yet' (or 'already installed' on a second run); rows 5 to 8 are numbers to write down and compare with the verify file.
select n, item, result from (
  select 1 as n, 'Chat release 1 is installed (chat_groups, chat_messages, chat_my_groups)' as item,
         case when to_regclass('public.chat_groups') is not null and to_regclass('public.chat_messages') is not null and to_regproc('public.chat_my_groups') is not null then 'OK' else 'STOP - apply 20261225000100 first' end as result
  union all select 2, 'the Projects tables it reads exist (proj_projects, proj_project_members, proj_messages, proj_message_mentions)',
         case when to_regclass('public.proj_projects') is not null and to_regclass('public.proj_project_members') is not null and to_regclass('public.proj_messages') is not null and to_regclass('public.proj_message_mentions') is not null then 'OK' else 'STOP - the Projects migrations are missing' end
  union all select 3, 'the eligibility test it reuses exists (proj_user_eligible)',
         case when to_regprocedure('public.proj_user_eligible(uuid, uuid, uuid)') is not null then 'OK' else 'STOP - proj_user_eligible is missing' end
  union all select 4, 'chat_project_group', case when to_regprocedure('public.chat_project_group(uuid)') is null then 'not installed yet' else 'already installed' end
  union all select 5, 'INFO projects (each gets one group)', (select count(*) from proj_projects)::text
  union all select 6, 'INFO Discussion messages to copy (not deleted)', (select count(*) from proj_messages where deleted_at is null and length(btrim(body)) > 0)::text
  union all select 7, 'INFO Discussion messages that are deleted (not copied)', (select count(*) from proj_messages where deleted_at is not null)::text
  union all select 8, 'INFO projects that have at least one Discussion message', (select count(distinct project_id) from proj_messages where deleted_at is null)::text
) x order by n;
