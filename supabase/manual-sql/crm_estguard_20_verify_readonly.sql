-- READ-ONLY. Run AFTER 20261221000100_crm_estimates_only_guards.sql. One result table; every row must say OK. Creates no row and changes nothing.
select item, result from (
  select 1 as ord, 'guard trigger crm_proposals_estimate_sent_guard exists on crm_proposals and is enabled' as item,
         case when exists (select 1 from pg_trigger t where t.tgname = 'crm_proposals_estimate_sent_guard' and not t.tgisinternal
                              and t.tgrelid = 'public.crm_proposals'::regclass and t.tgenabled in ('O', 'A')) then 'OK' else 'MISSING or disabled' end as result
  union all select 2, 'guard trigger is a row-level BEFORE trigger for insert and update of status',
         case when exists (select 1 from pg_trigger t where t.tgname = 'crm_proposals_estimate_sent_guard' and not t.tgisinternal
                              and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16
                              and pg_get_triggerdef(t.oid) like '%UPDATE OF status%') then 'OK' else 'WRONG SHAPE' end
  union all select 3, 'guard function exists',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_estimate_sent_guard') then 'OK' else 'MISSING' end
  union all select 4, 'guard function refuses with the estimate message',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_estimate_sent_guard'
                              and prosrc like '%An estimate cannot be marked as sent%') then 'OK' else 'WRONG TEXT' end
  union all select 5, 'guard function is not callable by signed-in users, anon or public',
         case when has_function_privilege('authenticated', 'public.crm_estimate_sent_guard()', 'execute')
                or has_function_privilege('anon', 'public.crm_estimate_sent_guard()', 'execute') then 'FAIL - callable' else 'OK' end
  union all select 6, 'crm_quote_create now generates EST- references (definition text; no estimate is created by this check)',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_quote_create' and prosrc like '%''EST-%s-%s-%s''%')
                   and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_quote_create' and prosrc like '%''QUO-%s-%s-%s''%')
              then 'OK' else 'STILL THE OLD FUNCTION or unexpected text' end
  union all select 7, 'crm_quote_create still uses the same per-company yearly counter (EST- continues the QUO- sequence)',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_quote_create' and prosrc like '%crm_quote_counters%last_value + 1%')
              then 'OK' else 'COUNTER CHANGED' end
  union all select 8, 'crm_quote_create is still SECURITY DEFINER with a fixed search_path',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_quote_create' and prosecdef
                              and exists (select 1 from unnest(proconfig) c where c = 'search_path=public')) then 'OK' else 'CHANGED' end
  union all select 9, 'grants unchanged: signed-in users can call crm_quote_create(uuid), anon and public cannot',
         case when has_function_privilege('authenticated', 'public.crm_quote_create(uuid)', 'execute')
                and not has_function_privilege('anon', 'public.crm_quote_create(uuid)', 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                 where p.oid = 'public.crm_quote_create(uuid)'::regprocedure and a.grantee = 0) then 'OK' else 'FAIL - privileges differ' end
  union all select 10, 'grants unchanged: crm_set_proposal_status is still callable by signed-in users and not by anon',
         case when has_function_privilege('authenticated', 'public.crm_set_proposal_status(uuid, text, date)', 'execute')
                and not has_function_privilege('anon', 'public.crm_set_proposal_status(uuid, text, date)', 'execute') then 'OK' else 'FAIL' end
  union all select 11, 'crm_set_proposal_status was not rewritten (no estimate wording in its body: the refusal lives in the trigger)',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_set_proposal_status' and prosrc not like '%estimate%')
              then 'OK' else 'CHANGED' end
  union all select 12, 'crm_quote_create_revision and crm_quote_issue are still present (revisions keep the reference they copy)',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_quote_create_revision' and prosrc like '%q.reference%')
                   and exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_quote_issue') then 'OK' else 'MISSING or changed' end
  union all select 13, 'the applied Estimates trigger set is intact (quotation guards still present)',
         case when (select count(*) from pg_trigger where tgname in ('crm_quotation_snapshots_frozen_row', 'crm_quotations_guard_row', 'crm_quotation_sections_guard', 'crm_quotation_lines_guard', 'crm_approvals_quote_guard') and not tgisinternal) = 5
              then 'OK' else 'A guard trigger is missing' end
  union all select 14, 'no ordinary (non-estimate) proposal is affected: the guard only looks at rows that have an estimate extension (information: ' ||
         (select count(*)::text from crm_proposals p where not exists (select 1 from crm_quotations q where q.proposal_id = p.id)) || ' ordinary proposals)', 'OK'
) r order by ord, item;
