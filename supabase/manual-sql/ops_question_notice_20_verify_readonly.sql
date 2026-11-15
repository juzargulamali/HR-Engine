-- READ ONLY. Run AFTER 20270113000200_ops_question_notice.sql. Rows 1 to 4 must say OK; row 5 is a count for information. Creates no row.
select item, result from (
  select 1 as ord, 'the trigger is on the Operations planning table, for inserts and updates' as item,
         case when exists (select 1 from pg_trigger where tgname = 'trg_ops_question_notify' and tgrelid = 'public.ops_enquiry_planning'::regclass and not tgisinternal and tgenabled <> 'D') then 'OK'
              else 'FAIL - trigger missing or disabled' end as result
  union all select 2, 'the two functions exist, run as their owner with a pinned search path, and cannot be called by anon or signed-in users',
         case when (select count(*) from pg_proc where proname in ('ops_question_notify', 'ops_question_recipients') and pronamespace = 'public'::regnamespace
                     and prosecdef and proconfig is not null and 'search_path=public' = any (proconfig)) = 2
                   and not has_function_privilege('authenticated', 'public.ops_question_recipients(uuid)', 'execute') and not has_function_privilege('anon', 'public.ops_question_recipients(uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.ops_question_notify()', 'execute') then 'OK' else 'FAIL - missing or callable' end
  union all select 3, 'no notice carries the question''s text (the payload holds the enquiry id, its reference and the de-duplication key only)',
         case when not exists (select 1 from notifications n where n.type = 'project_ops_question'
                                and exists (select 1 from jsonb_object_keys(n.payload) k where k not in ('opportunity_id', 'reference', 'dedupe_key', 'project_id'))) then 'OK'
              else 'FAIL - a notice carries an unexpected field' end
  union all select 4, 'no enquiry has more than one unread notice for the same person',
         case when not exists (select 1 from notifications n where n.type = 'project_ops_question' and n.read_at is null
                                group by n.user_id, n.payload ->> 'opportunity_id' having count(*) > 1) then 'OK' else 'FAIL - a duplicate unread notice exists' end
  union all select 5, 'information: question notices sent so far (unread / read)',
         (select count(*) filter (where read_at is null) from notifications where type = 'project_ops_question')::text || ' / '
           || (select count(*) filter (where read_at is not null) from notifications where type = 'project_ops_question')::text
) x order by ord;
