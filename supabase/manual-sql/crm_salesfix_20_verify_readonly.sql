-- READ-ONLY. Run AFTER 20261222000100_crm_sales_write_rules.sql. One result table; every row must say OK. Creates no row and changes nothing.
select item, result from (
  select 1 as ord, 'crm_save_zoho_reference(uuid, jsonb, jsonb) exists, SECURITY DEFINER with a fixed search_path' as item,
         case when exists (select 1 from pg_proc where oid = to_regprocedure('public.crm_save_zoho_reference(uuid, jsonb, jsonb)') and prosecdef
                              and exists (select 1 from unnest(proconfig) c where c = 'search_path=public')) then 'OK' else 'MISSING or wrong shape' end as result
  union all select 2, 'crm_save_zoho_reference merges: a key that is absent keeps the stored value (definition text)',
         case when exists (select 1 from pg_proc where proname = 'crm_save_zoho_reference' and pronamespace = 'public'::regnamespace
                              and prosrc like '%p_fields ? ''quote_ref'' then%else z.quote_ref end%') then 'OK' else 'WRONG TEXT' end
  union all select 3, 'crm_save_zoho_reference refuses a lost enquiry and a stale field (definition text)',
         case when exists (select 1 from pg_proc where proname = 'crm_save_zoho_reference' and pronamespace = 'public'::regnamespace
                              and prosrc like '%v.stage = ''lost''%' and prosrc like '%errcode = ''40001''%') then 'OK' else 'WRONG TEXT' end
  union all select 4, 'grants: signed-in users can call crm_save_zoho_reference, anon and public cannot',
         case when to_regprocedure('public.crm_save_zoho_reference(uuid, jsonb, jsonb)') is not null
                and has_function_privilege('authenticated', to_regprocedure('public.crm_save_zoho_reference(uuid, jsonb, jsonb)')::oid, 'execute')
                and not has_function_privilege('anon', to_regprocedure('public.crm_save_zoho_reference(uuid, jsonb, jsonb)')::oid, 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                 where p.oid = to_regprocedure('public.crm_save_zoho_reference(uuid, jsonb, jsonb)') and a.grantee = 0) then 'OK' else 'FAIL - privileges differ' end
  union all select 5, 'the old signature crm_upsert_zoho_reference(uuid, text, date, text, date, date, numeric) is kept and delegates (a NULL argument leaves a field as it is)',
         case when exists (select 1 from pg_proc where oid = to_regprocedure('public.crm_upsert_zoho_reference(uuid, text, date, text, date, date, numeric)')
                              and prosrc like '%crm_save_zoho_reference%' and prosrc like '%jsonb_strip_nulls%') then 'OK' else 'NOT THE EXPECTED WRAPPER' end
  union all select 6, 'grants unchanged: signed-in users can call the old crm_upsert_zoho_reference, anon and public cannot',
         case when has_function_privilege('authenticated', 'public.crm_upsert_zoho_reference(uuid, text, date, text, date, date, numeric)', 'execute')
                and not has_function_privilege('anon', 'public.crm_upsert_zoho_reference(uuid, text, date, text, date, date, numeric)', 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                 where p.oid = to_regprocedure('public.crm_upsert_zoho_reference(uuid, text, date, text, date, date, numeric)') and a.grantee = 0) then 'OK' else 'FAIL - privileges differ' end
  union all select 7, 'crm_set_proposal_status refuses superseded unless the proposal is draft or sent (definition text)',
         case when exists (select 1 from pg_proc where proname = 'crm_set_proposal_status' and pronamespace = 'public'::regnamespace
                              and prosrc like '%already superseded%' and prosrc like '%p.status not in (''draft'', ''sent'')%') then 'OK' else 'WRONG TEXT' end
  union all select 8, 'crm_set_proposal_status re-reads the proposal under the lock and still has the sent and accepted rules',
         case when exists (select 1 from pg_proc where proname = 'crm_set_proposal_status' and pronamespace = 'public'::regnamespace
                              and prosrc like '%for update%' and prosrc like '%Only a draft proposal can be recorded as sent%' and prosrc like '%Only a sent proposal can be recorded as accepted%') then 'OK' else 'WRONG TEXT' end
  union all select 9, 'grants unchanged: crm_set_proposal_status callable by signed-in users, not by anon',
         case when has_function_privilege('authenticated', 'public.crm_set_proposal_status(uuid, text, date)', 'execute')
                and not has_function_privilege('anon', 'public.crm_set_proposal_status(uuid, text, date)', 'execute') then 'OK' else 'FAIL' end
  union all select 10, 'the estimate guard (EST01) is untouched: trigger present and enabled',
         case when exists (select 1 from pg_trigger t where t.tgname = 'crm_proposals_estimate_sent_guard' and not t.tgisinternal and t.tgrelid = 'public.crm_proposals'::regclass and t.tgenabled in ('O', 'A')) then 'OK' else 'MISSING or disabled' end
  union all select 11, 'crm_mark_won refuses a future evidence date using the Dubai day (definition text)',
         case when exists (select 1 from pg_proc where proname = 'crm_mark_won' and pronamespace = 'public'::regnamespace
                              and prosrc like '%p_evidence_date > crm_today_dubai()%' and prosrc like '%cannot be in the future%') then 'OK' else 'WRONG TEXT' end
  union all select 12, 'crm_mark_won keeps its other rules (open stage, evidence, value, closure and handover rows)',
         case when exists (select 1 from pg_proc where proname = 'crm_mark_won' and pronamespace = 'public'::regnamespace
                              and prosrc like '%insert into crm_closures%' and prosrc like '%insert into crm_handovers%' and prosrc like '%Set the confirmed value before marking Won%') then 'OK' else 'CHANGED' end
  union all select 13, 'grants unchanged: crm_mark_won callable by signed-in users, not by anon or public',
         case when has_function_privilege('authenticated', 'public.crm_mark_won(uuid, text, text, date, text, integer)', 'execute')
                and not has_function_privilege('anon', 'public.crm_mark_won(uuid, text, text, date, text, integer)', 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                 where p.oid = 'public.crm_mark_won(uuid, text, text, date, text, integer)'::regprocedure and a.grantee = 0) then 'OK' else 'FAIL' end
  union all select 14, 'the Quote sent gate (crm_move_stage) was not touched: it still needs a non-blank Zoho quote reference',
         case when exists (select 1 from pg_proc where proname = 'crm_move_stage' and pronamespace = 'public'::regnamespace and prosrc like '%Record the Zoho Books quote reference before moving to Quote sent%') then 'OK' else 'CHANGED' end
) r order by ord, item;
