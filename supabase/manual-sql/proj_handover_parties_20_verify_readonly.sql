-- READ ONLY. Run AFTER 20270112000100_proj_handover_parties.sql. Rows 1 to 6 must say OK; rows 7 and 8 are counts for information. Creates no row.
select item, result from (
  select 1 as ord, 'the four new columns exist on proj_handovers, with the job-type rule' as item,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proj_handovers'
                     and column_name in ('job_type', 'agency_org_id', 'agency_name', 'parties_recorded_at')) = 4
                   and exists (select 1 from pg_constraint where conname = 'proj_handovers_job_type' and conrelid = 'public.proj_handovers'::regclass) then 'OK'
              else 'FAIL - a column or the constraint is missing' end as result
  union all select 2, 'the site contact table exists, row level security is on and it has NO policy (it is read only through the functions)',
         case when to_regclass('public.proj_handover_site_contacts') is not null
                   and (select relrowsecurity from pg_class where oid = 'public.proj_handover_site_contacts'::regclass)
                   and not exists (select 1 from pg_policy where polrelid = 'public.proj_handover_site_contacts'::regclass) then 'OK'
              else 'FAIL - table, row level security or policies differ' end
  union all select 3, 'the three public functions exist, signed-in users can call them, anon cannot',
         case when (select count(*) from (values ('public.proj_set_handover_site_contact(uuid, uuid)'), ('public.proj_handover_parties(uuid)'), ('public.proj_project_handover(uuid)')) f(sig)
              where to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')) = 3
              then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 4, 'the internal helpers exist and are not callable by anon or signed-in users',
         case when (select count(*) from (values ('public.proj_handover_parties_copy()'), ('public.proj_handover_site_contact_frozen()'), ('public.proj_handover_site_contact_take(uuid, uuid, uuid)'),
              ('public.proj_handover_site_contact_refresh()'), ('public.proj_handover_site_contact_json(uuid)')) f(sig)
              where to_regprocedure(f.sig) is not null and not has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute')) = 5
              then 'OK' else 'FAIL - a helper is missing or callable' end
  union all select 5, 'the three triggers are in place, and the trigger that freezes an accepted handover is still there',
         case when (select count(*) from pg_trigger where not tgisinternal and ((tgname in ('trg_proj_handover_parties_copy', 'trg_proj_handover_site_contact_refresh', 'proj_handovers_frozen') and tgrelid = 'public.proj_handovers'::regclass)
                     or (tgname = 'trg_proj_handover_site_contact_frozen' and tgrelid = 'public.proj_handover_site_contacts'::regclass))) = 4 then 'OK' else 'FAIL - a trigger is missing' end
  union all select 6, 'no accepted handover was given an agency or a job type after it was accepted (nothing is guessed about history)',
         case when not exists (select 1 from proj_handovers h where h.status = 'accepted' and h.parties_recorded_at is not null and h.parties_recorded_at > h.accepted_at) then 'OK'
              else 'FAIL - an accepted handover was changed after acceptance' end
  union all select 7, 'information: handovers with the agency recorded (direct / agency-led) and not recorded',
         (select count(*) filter (where job_type = 'direct') from proj_handovers)::text || ' / ' || (select count(*) filter (where job_type = 'agency') from proj_handovers)::text
           || ' and ' || (select count(*) filter (where parties_recorded_at is null) from proj_handovers)::text
  union all select 8, 'information: handovers with a site contact chosen',
         (select count(*) from proj_handover_site_contacts)::text
) x order by ord;
