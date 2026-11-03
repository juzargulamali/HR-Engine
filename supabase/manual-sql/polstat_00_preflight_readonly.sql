-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE the migration 20261216000700_policy_status_role_check.sql.
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It creates, changes and deletes nothing. Send me the full result.
--
--   A  who is running this, server version
--   B  prerequisites: what this migration builds on exists; the migration is NOT applied yet
--   C  the functions this migration replaces or adds, as they are today (owner, privileges, fingerprint; an added one is absent)
--   D  what exists today (information only; some rows are read-only checks of the live state that decide whether more is needed)
--   E  row counts (information only)
--
-- HOW TO READ IT: section B must be OK on every row and say the change is NOT yet applied.

select section, item, detail from (
  select 'A session' as section, 1 as ord, 'running as' as item, current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all select 'A session', 2, 'server_version', version()
  union all select 'A session', 3, 'today (Dubai)', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')
  union all select 'B prerequisites', 200, 'function public.preflight_phase2b_v2_policy_status', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'preflight_phase2b_v2_policy_status') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 201, 'function public.seed_phase2b_policy_drafts', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'seed_phase2b_policy_drafts') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all select 'B prerequisites', 202, 'function public.has_role', case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'has_role') then 'OK' else 'MISSING - install that module first (see its deployment guide)' end
  union all
  select 'B prerequisites', 310, 'applied already?',
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'preflight_phase2b_v2_policy_status' and prosrc like '%has_role(''cto'', null, cc.code)%')
              then 'ALREADY APPLIED - this is not a first run; nothing more is needed (run polstat_20_verify_readonly.sql to check it)'
              else 'OK - not applied yet (the old state is in place)' end
  union all
  select 'C functions today', 400 + row_number() over (order by f.name), f.name,
         coalesce((select 'owner ' || pg_get_userbyid(p.proowner) || '; security definer ' || p.prosecdef::text || '; fingerprint ' || md5(pg_get_functiondef(p.oid)) || '; callable by signed-in users ' || has_function_privilege('authenticated', p.oid, 'execute')::text
                          || '; by anonymous ' || has_function_privilege('anon', p.oid, 'execute')::text
                   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name limit 1), 'not present yet (this migration adds it)')
  from (values ('preflight_phase2b_v2_policy_status')) f(name) where f.name <> '__none__'
  union all select 'D what exists today', 1000, 'READ-ONLY CHECK (the hosted answer to D-22): can a signed-in employee / an anonymous visitor execute the function TODAY? (true = exposed, this migration closes it)', (select 'signed-in: ' || has_function_privilege('authenticated', 'public.preflight_phase2b_v2_policy_status()', 'execute')::text || '; anonymous: ' || has_function_privilege('anon', 'public.preflight_phase2b_v2_policy_status()', 'execute')::text)
  union all select 'D what exists today', 1001, 'seeded draft policy versions (the rows the function reports), by type', (select coalesce(string_agg(policy_type::text || ': ' || n, ', ' order by policy_type::text), 'none') from (select policy_type, count(*) n from policy_versions where payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration' and status = 'draft' group by policy_type) t)
  union all select 'D what exists today', 1002, 'READ-ONLY CHECK (decides whether D-22 is more than a low risk): draft policy payloads that mention pay (count; 0 = no compensation terms in the seeded drafts)', (select count(*)::text from policy_versions where payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration' and payload::text ~* '(salary|compensation|bonus|allowance|pay_rate|wage)')
  union all select 'E row counts', 900, 'policy_versions', (select count(*)::text from policy_versions)
) r
order by section, ord, item;
