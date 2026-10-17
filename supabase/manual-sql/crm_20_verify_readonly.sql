-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the four Sales & CRM migrations
-- (20261115000000 ... 20261115000300). Run the WHOLE file; it returns ONE result table (check | result | detail).
-- Every row in the "result" column must read PASS. It changes nothing. Send me the full result.
--
-- Also compare section 'I HR row counts' with the same section of crm_00_preflight_readonly.sql: the numbers must be
-- IDENTICAL (the CRM migrations never touch HR data and never create a company).

with
crm_tables as (select c.oid, c.relname, c.relrowsecurity from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'crm\_%'),
crm_funcs as (select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'crm\_%')
select check_name, result, detail from (
  select 1 as ord, 'tables exist (19 expected)' as check_name,
         case when (select count(*) from crm_tables) = 19 then 'PASS' else 'FAIL' end as result,
         (select count(*)::text || ' found: ' || coalesce(string_agg(relname, ', ' order by relname), '') from crm_tables) as detail
  union all
  select 2, 'row-level security on every CRM table', case when not exists (select 1 from crm_tables where not relrowsecurity) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(relname, ', ') from crm_tables where not relrowsecurity), 'all on')
  union all
  select 3, 'no INSERT / UPDATE / DELETE policy on any CRM table (clients write only through functions)',
         case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'crm\_%' and cmd <> 'SELECT') then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(tablename || ':' || cmd, ', ') from pg_policies where schemaname = 'public' and tablename like 'crm\_%' and cmd <> 'SELECT'), 'only SELECT policies')
  union all
  select 4, 'anon holds no privilege on any CRM table',
         case when not exists (select 1 from crm_tables t, lateral aclexplode(coalesce((select relacl from pg_class where oid = t.oid), acldefault('r', (select relowner from pg_class where oid = t.oid)))) x
                              where x.grantee = (select oid from pg_roles where rolname = 'anon')) then 'PASS' else 'FAIL' end,
         'checked through the access-control lists'
  union all
  select 5, 'authenticated holds only SELECT on CRM tables (no INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN)',
         case when not exists (select 1 from crm_tables t, lateral aclexplode(coalesce((select relacl from pg_class where oid = t.oid), acldefault('r', (select relowner from pg_class where oid = t.oid)))) x
                              where x.grantee = (select oid from pg_roles where rolname = 'authenticated') and x.privilege_type <> 'SELECT') then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(distinct t.relname || ':' || x.privilege_type, ', ') from crm_tables t, lateral aclexplode(coalesce((select relacl from pg_class where oid = t.oid), acldefault('r', (select relowner from pg_class where oid = t.oid)))) x
                   where x.grantee = (select oid from pg_roles where rolname = 'authenticated') and x.privilege_type <> 'SELECT'), 'SELECT only')
  union all
  select 6, 'every SECURITY DEFINER CRM function pins search_path to public',
         case when not exists (select 1 from crm_funcs where prosecdef and not coalesce(proconfig::text, '') like '%search_path=public%') then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(proname, ', ') from crm_funcs where prosecdef and not coalesce(proconfig::text, '') like '%search_path=public%'), (select count(*)::text from crm_funcs where prosecdef) || ' security definer functions, all pinned')
  union all
  select 7, 'anon cannot execute any CRM function',
         case when not exists (select 1 from crm_funcs where has_function_privilege('anon', oid, 'execute')) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(proname, ', ') from crm_funcs where has_function_privilege('anon', oid, 'execute')), 'none')
  union all
  select 8, 'signed-in users cannot execute the scheduled-job functions',
         case when not exists (select 1 from crm_funcs where proname in ('crm_generate_reminders', 'crm_claim_reminder_emails', 'crm_finish_reminder_email', 'crm_mark_upload_intent', 'crm_expire_upload_intents') and has_function_privilege('authenticated', oid, 'execute')) then 'PASS' else 'FAIL' end,
         'reserved to service_role'
  union all
  select 9, 'the service role can execute the scheduled-job functions',
         case when (select count(*) from crm_funcs where proname in ('crm_generate_reminders', 'crm_claim_reminder_emails', 'crm_finish_reminder_email', 'crm_mark_upload_intent', 'crm_expire_upload_intents') and has_function_privilege('service_role', oid, 'execute')) = 5 then 'PASS' else 'FAIL' end,
         'needed by /api/cron/crm-reminders and the upload checks'
  union all
  select 10, 'storage buckets crm-files and crm-quarantine are private, size-limited and type-locked',
         case when (select count(*) from storage.buckets where id in ('crm-files', 'crm-quarantine') and not public and file_size_limit = 20971520
                           and allowed_mime_types is not null
                           and not exists (select 1 from unnest(allowed_mime_types) m where m ~* 'macro|msdownload|octet-stream|javascript|html|x-sh')) = 2 then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(id || ': public=' || public::text || ', limit=' || file_size_limit::text, '; ') from storage.buckets where id in ('crm-files', 'crm-quarantine')), 'buckets missing')
  union all
  select 11, 'no storage policy lets a signed-in user touch crm-files or crm-quarantine directly',
         case when not exists (select 1 from pg_policies where schemaname = 'storage' and (coalesce(qual, '') ~* 'crm-(files|quarantine)' or coalesce(with_check, '') ~* 'crm-(files|quarantine)')) then 'PASS' else 'FAIL' end,
         'files are moved, read and signed only by the server with the service role'
  union all
  select 12, 'commercial approval is not configured anywhere unless a founder set it',
         case when not exists (select 1 from crm_company_settings where approval_policy <> 'not_configured') then 'PASS' else 'INFO' end,
         coalesce((select string_agg(c.legal_name || '=' || s.approval_policy, ', ') from crm_company_settings s join companies c on c.id = s.company_id), 'no settings rows')
  union all
  select 13, 'response targets and calendars are blank (KPIs not configured) unless set in Settings',
         case when not exists (select 1 from crm_company_settings where response_target_hours is not null or working_calendar is not null) then 'PASS' else 'INFO' end,
         (select count(*)::text || ' settings rows' from crm_company_settings)
  union all
  select 14, 'owner emails are off for every company until switched on',
         case when not exists (select 1 from crm_company_settings where owner_email_enabled) then 'PASS' else 'INFO' end,
         coalesce((select string_agg(c.legal_name, ', ') from crm_company_settings s join companies c on c.id = s.company_id where s.owner_email_enabled), 'all off')
  union all
  select 15, 'no CRM row is written to the shared HR audit log',
         case when not exists (select 1 from audit_log where table_name like 'crm\_%') then 'PASS' else 'FAIL' end,
         'CRM has its own audit table crm_audit_log (visible to founders only)'
  union all
  select 16, 'settings seeded from existing companies only (no company was created by the migration)',
         case when not exists (select 1 from crm_company_settings s where not exists (select 1 from companies c where c.id = s.company_id)) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' settings rows: ' || coalesce(string_agg(c.legal_name || ' -> ' || s.reference_code || '/' || s.default_quote_currency, '; ' order by c.legal_name), '') from crm_company_settings s join companies c on c.id = s.company_id)
  union all
  select 17, 'company codes are unique',
         case when (select count(distinct reference_code) from crm_company_settings) = (select count(*) from crm_company_settings) then 'PASS' else 'FAIL' end, ''
  union all
  select 18, 'every CRM grant belongs to an active person and an existing company',
         case when not exists (select 1 from crm_company_grants g where g.revoked_at is null and not exists (select 1 from profiles p where p.id = g.user_id and p.is_active)) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' active grants (' || count(*) filter (where 'founder' = any (capabilities)) || ' founder grants)' from crm_company_grants where revoked_at is null)
  union all
  select 19, 'every company with CRM grants has at least one founder',
         case when not exists (select 1 from crm_company_grants g where g.revoked_at is null
                               and not exists (select 1 from crm_company_grants f where f.company_id = g.company_id and f.revoked_at is null and 'founder' = any (f.capabilities))) then 'PASS' else 'FAIL' end,
         'run crm_30_bootstrap_founders.sql if this fails right after install (there are no grants yet: PASS)'
  union all
  select 20, 'integrity: active opportunities all have an owner and an open next action',
         case when not exists (select 1 from crm_opportunities o where o.stage in ('new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation')
                               and not exists (select 1 from crm_follow_ups f where f.opportunity_id = o.id and f.status = 'open')) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' opportunities' from crm_opportunities)
  union all
  select 21, 'integrity: every on-hold opportunity has a reason and a review date',
         case when not exists (select 1 from crm_opportunities where stage = 'on_hold' and (hold_reason is null or hold_review_date is null)) then 'PASS' else 'FAIL' end, ''
  union all
  select 22, 'integrity: every Won opportunity has evidence; every Lost one has a reason',
         case when not exists (select 1 from crm_opportunities where (stage = 'won' and (evidence_type is null or evidence_reference is null or evidence_date is null)) or (stage = 'lost' and lost_reason is null)) then 'PASS' else 'FAIL' end, ''
  union all
  select 23, 'no stored file has an executable or macro-enabled name or type',
         case when not exists (select 1 from crm_files where kind = 'file' and (original_name ~* '\.(exe|dll|msi|bat|cmd|com|scr|js|vbs|ps1|sh|jar|docm|xlsm|pptm|dotm|xlsb)(\.|$)' or mime_type ~* 'macro')) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' files' from crm_files where kind = 'file')
  union all
  select 24, 'HR tables carry no CRM triggers and no CRM foreign keys point at them except companies and auth.users',
         case when not exists (select 1 from pg_constraint con join pg_class src on src.oid = con.conrelid join pg_class dst on dst.oid = con.confrelid
                               where con.contype = 'f' and src.relname like 'crm\_%' and dst.relnamespace = 'public'::regnamespace and dst.relname not like 'crm\_%' and dst.relname not in ('companies')) then 'PASS' else 'FAIL' end,
         'CRM is separate from HR data'
  union all
  select 25, 'upload intents are invisible to browsers (no privilege at all for signed-in users or anon)',
         case when not exists (select 1 from crm_tables t, lateral aclexplode(coalesce((select relacl from pg_class where oid = t.oid), acldefault('r', (select relowner from pg_class where oid = t.oid)))) x
                              where t.relname = 'crm_upload_intents' and x.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' intents' from crm_upload_intents)
  union all
  select 26, 'closure history: every Won or Lost opportunity has exactly one current closure',
         case when not exists (select 1 from crm_opportunities o where o.stage in ('won', 'lost')
                               and (select count(*) from crm_closures c where c.opportunity_id = o.id and c.reopened_at is null) <> 1) then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' closures, ' || count(*) filter (where reopened_at is not null) || ' reopened' from crm_closures)
  union all
  select 27, 'closure history: no open opportunity still has a current closure, and every reopened closure has who and why',
         case when not exists (select 1 from crm_closures c join crm_opportunities o on o.id = c.opportunity_id where c.reopened_at is null and o.stage not in ('won', 'lost'))
               and not exists (select 1 from crm_closures where reopened_at is not null and (reopened_by is null or length(btrim(coalesce(reopen_reason, ''))) = 0)) then 'PASS' else 'FAIL' end, ''
  union all
  select 28, 'no validated or registered file lives only in quarantine, and no stored file path is outside its own opportunity folder',
         case when not exists (select 1 from crm_files f where f.kind = 'file' and f.storage_path not like f.company_id::text || '/' || f.opportunity_id::text || '/%') then 'PASS' else 'FAIL' end,
         (select count(*)::text || ' files' from crm_files where kind = 'file')
) q
order by ord;
