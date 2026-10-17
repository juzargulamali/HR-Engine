-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" (the hosted project the Vercel app is bound to).
-- Run the WHOLE file; it returns ONE result table (section | item | detail). It is a single SELECT: it changes nothing.
-- Send me the full result (screenshot or Export -> CSV).
--
-- Why: vercel.json schedules five routes, but the sign-in proxy (apps/web/src/proxy.ts) appears to answer Vercel Cron's
-- cookie-less requests with 307 -> /login before the routes' own CRON_SECRET check runs. If so, none of them has ever done
-- any work in Production. This file shows, from the DATABASE, whether each route has ever produced its effect and when last,
-- and what the FIRST run after the block is lifted would find waiting. Background: docs/scheduled-routes-diagnosis.md.
--
--   A  session, server time, and whether the objects the routes need exist
--   B  configuration that decides what a first run would do (active employees, active leave policies, reminder rules)
--   C  /api/cron/leave-accrual           (0 0 1 * *)   leave_ledger rows written by the cron, by month; months with none
--   D  /api/cron/comp-day-expiry         (0 1 * * *)   comp_day_ledger 'expired' postings; what a run would post right now
--   E  /api/cron/document-expiry         (0 2 * * *)   reminders sent, notifications, status transitions; what a run would send
--   F  /api/ai/detect-balance-discrepancies (0 3 * * *) ai_drafts from the balance-discrepancy agent; negative balances now
--   G  /api/cron/recovery-windows        (30 0 * * *)  recovery_processor_runs by origin (vercel_cron vs pg_cron); pg_cron job
--   H  checks to make in the Vercel dashboard (not SQL)
--
-- How to read it. Origin of a row is told apart by columns the routes always set:
--   leave accrual   reference_type = 'policy_run',            created_by = 00000000-0000-0000-0000-000000000000, idempotency_key 'accrual:<employee>:<type>:<YYYY-MM>'
--   comp-day expiry reference_type = 'comp_day_expiry_sweep', created_by = 00000000-0000-0000-0000-000000000000, idempotency_key 'expiry:<earned id>'
--   document expiry notifications.type = 'document_expiring' + one document_expiry_reminders_sent row per (document, lead_days)
--   AI drafts       ai_drafts.created_by_agent = 'balance-discrepancy-detector'
--   recovery        recovery_processor_runs.origin = 'vercel_cron' (this route) or 'pg_cron' (the database's own scheduler)
-- "Would post / would send" figures are ESTIMATES computed with the same rules as the route, using the UTC date (the routes use
-- each employee's own country date, which can differ by a day around midnight). They are for sizing a backlog, not a promise.
-- Everything here is in UTC unless a column says otherwise. Dynamic parts (pg_cron, recovery tables) say "not present" instead
-- of failing when the object does not exist in this database.

select section, item, detail from (

  -- ===================================================================================================================
  -- A  session and readiness
  -- ===================================================================================================================
  select 'A session' as section, 1 as ord, 'running as' as item,
         current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')' as detail
  union all select 'A session', 2, 'server_version', version()
  union all select 'A session', 3, 'database time now() (UTC)', to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC'
  union all select 'A session', 4, 'today (UTC date) used by the estimates below', (now() at time zone 'UTC')::date::text
  union all select 'A session', 10 + row_number() over (order by x.item), x.item, x.detail
  from (
    select 'leave_ledger.idempotency_key (migration 20261013000000)' as item,
           case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leave_ledger' and column_name = 'idempotency_key') then 'present' else 'MISSING - the accrual route cannot insert without it' end as detail
    union all select 'comp_day_ledger.idempotency_key (migration 20261013000000)',
           case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comp_day_ledger' and column_name = 'idempotency_key') then 'present' else 'MISSING - the expiry route cannot insert without it' end
    union all select 'document_expiry_reminders_sent', case when to_regclass('public.document_expiry_reminders_sent') is not null then 'present' else 'MISSING' end
    union all select 'ai_drafts', case when to_regclass('public.ai_drafts') is not null then 'present' else 'MISSING' end
    union all select 'recovery_processor_runs / recovery_process_due() (migration 20261108000000)',
           case when to_regclass('public.recovery_processor_runs') is not null and exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'recovery_process_due') then 'present' else 'MISSING - the recovery route would return 500' end
    union all select 'pg_cron extension', case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'installed' else 'not installed' end
  ) x

  -- ===================================================================================================================
  -- B  configuration that decides what a first run would do
  -- ===================================================================================================================
  union all
  select 'B configuration', 100 + row_number() over (order by e.country_code), 'active employees, country ' || e.country_code,
         count(*)::text || ' (employment_status = active, not deleted)'
  from employees e where e.employment_status = 'active' and e.deleted_at is null group by e.country_code
  union all
  select 'B configuration', 199, '(end of active employees)', 'no row above = no active employees'
  union all
  select 'B configuration', 200 + row_number() over (order by pv.country_code, plt.leave_type_code),
         'leave_rules in force today: ' || pv.country_code || ' v' || pv.version_no || ' / ' || plt.leave_type_code,
         format('accrual_method=%s rate_per_period=%s max_balance_days=%s min_service_days=%s; effective %s to %s; active employees in country: %s',
                plt.accrual_method, coalesce(plt.accrual_rate_per_period::text, 'null'), coalesce(plt.max_balance_days::text, 'null'),
                coalesce(plt.min_service_days_to_accrue::text, 'null'), pv.effective_from, coalesce(pv.effective_to::text, 'open'),
                (select count(*) from employees e where e.country_code = pv.country_code and e.employment_status = 'active' and e.deleted_at is null))
  from policy_versions pv join policy_leave_types plt on plt.policy_version_id = pv.id
  where pv.policy_type = 'leave_rules' and pv.status = 'active'
    and pv.effective_from <= (now() at time zone 'UTC')::date + 1
    and (pv.effective_to is null or pv.effective_to >= (now() at time zone 'UTC')::date - 1)
  union all
  select 'B configuration', 299, '(end of leave_rules in force)', 'no row above = NO active leave_rules policy: the accrual route would post nothing at all'
  union all
  select 'B configuration', 300, 'monthly_accrual rows the next accrual run would ATTEMPT (upper bound)',
         coalesce((
           select sum(c.n)::text from (
             select (select count(*) from employees e where e.country_code = pv.country_code and e.employment_status = 'active' and e.deleted_at is null) as n
             from policy_versions pv join policy_leave_types plt on plt.policy_version_id = pv.id
             where pv.policy_type = 'leave_rules' and pv.status = 'active' and plt.accrual_method = 'monthly_accrual' and coalesce(plt.accrual_rate_per_period, 0) > 0
               and pv.effective_from <= (now() at time zone 'UTC')::date + 1 and (pv.effective_to is null or pv.effective_to >= (now() at time zone 'UTC')::date - 1)
           ) c), '0')
         || ' employee x leave-type pairs, one fixed rate each; ignores min-service and max-balance caps. per_service_year / annual_grant pairs cannot be sized in SQL: use the route''s ?mode=preflight (read-only) instead.'
  union all
  select 'B configuration', 310 + row_number() over (order by r.country_code nulls last, r.document_type, r.lead_days),
         'document_expiry_reminder_rules: ' || coalesce(r.country_code, 'company-specific') || ' / ' || r.document_type,
         'lead_days=' || r.lead_days || case when r.company_id is not null then ' (company ' || r.company_id || ')' else '' end
  from document_expiry_reminder_rules r
  union all
  select 'B configuration', 399, '(end of reminder rules)', 'no row above = no rules: document-expiry only moves status (30-day fallback) and sends NO reminders'

  -- ===================================================================================================================
  -- C  /api/cron/leave-accrual
  -- ===================================================================================================================
  union all
  select 'C leave-accrual', 1, 'rows written by the cron, ever (reference_type=policy_run)',
         count(*)::text || ' rows; ' || count(distinct employee_id) || ' employees; first created_at ' || coalesce(to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never')
         || '; LAST created_at ' || coalesce(to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never')
         || '; total ' || coalesce(sum(amount_days)::text, '0') || ' days'
  from leave_ledger where reference_type = 'policy_run'
  union all
  select 'C leave-accrual', 2, 'rows by the cron system actor in any form (created_by = 00000000-...)',
         count(*)::text || ' rows' || coalesce('; last ' || to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), '')
  from leave_ledger where created_by = '00000000-0000-0000-0000-000000000000'
  union all
  select 'C leave-accrual', 3, 'leave_ledger first row of ANY kind / ledger months to date',
         coalesce(to_char(min(txn_date), 'YYYY-MM-DD'), 'ledger is empty') || ' -> ' || to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD')
  from leave_ledger
  union all
  select 'C leave-accrual', 4, 'months with NO cron accrual since the first ledger row (these months were never accrued by the cron)',
         coalesce((
           select count(*) || ' of ' || (select count(*) from generate_series(date_trunc('month', f.first_txn), date_trunc('month', (now() at time zone 'UTC')::date), interval '1 month')) || ' months: '
                  || coalesce(string_agg(to_char(m.month, 'YYYY-MM'), ', ' order by m.month), 'none')
           from (select min(txn_date) as first_txn from leave_ledger) f
           cross join lateral (
             select gs::date as month from generate_series(date_trunc('month', f.first_txn), date_trunc('month', (now() at time zone 'UTC')::date), interval '1 month') gs
             where not exists (select 1 from leave_ledger l where l.reference_type = 'policy_run' and date_trunc('month', l.txn_date) = gs)
           ) m
           where f.first_txn is not null
           group by f.first_txn
         ), 'ledger is empty - nothing to compare')
  union all
  select 'C leave-accrual', 10 + row_number() over (order by m.month desc),
         'cron rows for month ' || to_char(m.month, 'YYYY-MM'),
         sum(m.n)::text || ' rows; ' || max(m.employees) || ' employees (max per leave type); +' || sum(m.days) || ' days; by leave type: '
         || string_agg(m.code || '=' || m.n, ', ' order by m.code)
         || '; last written ' || to_char(max(m.last_created) at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
  from (
    select date_trunc('month', l.txn_date)::date as month, l.leave_type_code as code, count(*) as n, sum(l.amount_days) as days, max(l.created_at) as last_created,
           count(distinct l.employee_id) as employees
    from leave_ledger l where l.reference_type = 'policy_run' group by 1, 2
  ) m group by m.month
  union all
  select 'C leave-accrual', 100 + row_number() over (order by g.entry_type, g.ref),
         'ledger origin: entry_type=' || g.entry_type || ' / reference_type=' || g.ref,
         g.n || ' rows; txn_date ' || g.first_txn || ' .. ' || g.last_txn || '; last created_at ' || to_char(g.last_created at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
  from (
    select entry_type::text as entry_type, coalesce(reference_type, '(null)') as ref, count(*) as n, min(txn_date) as first_txn, max(txn_date) as last_txn, max(created_at) as last_created
    from leave_ledger group by entry_type, reference_type
  ) g
  union all
  select 'C leave-accrual', 199, '(end of ledger origins)', 'compare: every policy_run accrual row above is the cron; anything else posted to the ledger came from people or other functions'

  -- ===================================================================================================================
  -- D  /api/cron/comp-day-expiry
  -- ===================================================================================================================
  union all
  select 'D comp-day-expiry', 1, 'expired postings written by the sweep, ever (reference_type=comp_day_expiry_sweep)',
         count(*)::text || ' rows; ' || count(distinct employee_id) || ' employees; total ' || coalesce(sum(days)::text, '0') || ' days; first created_at '
         || coalesce(to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never') || '; LAST created_at ' || coalesce(to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never')
  from comp_day_ledger where reference_type = 'comp_day_expiry_sweep'
  union all
  select 'D comp-day-expiry', 2, 'entry_type=expired rows NOT written by the sweep',
         count(*)::text || ' rows' from comp_day_ledger where entry_type = 'expired' and reference_type is distinct from 'comp_day_expiry_sweep'
  union all
  select 'D comp-day-expiry', 10 + row_number() over (order by date_trunc('month', created_at) desc),
         'sweep postings created in ' || to_char(date_trunc('month', created_at) at time zone 'UTC', 'YYYY-MM'),
         count(*)::text || ' rows; ' || count(distinct employee_id) || ' employees; ' || sum(days) || ' days'
  from comp_day_ledger where reference_type = 'comp_day_expiry_sweep' group by date_trunc('month', created_at) at time zone 'UTC', date_trunc('month', created_at)
  union all
  select 'D comp-day-expiry', 50, 'earned entries in total / with no expiry date (never expire)',
         count(*)::text || ' / ' || count(*) filter (where expiry_date is null) from comp_day_ledger where entry_type = 'earned'
  union all
  select 'D comp-day-expiry', 51, 'WOULD POST NOW: earned entries past expiry with unconsumed days left (same FIFO rule as the route)',
         coalesce(count(*)::text, '0') || ' postings; ' || count(distinct employee_id) || ' employees; ' || coalesce(sum(remaining)::text, '0') || ' days would be expired in one run'
         || coalesce('; oldest expiry_date ' || min(expiry_date)::text || ' (' || ((now() at time zone 'UTC')::date - min(expiry_date)) || ' days ago)', '')
  from (
    select s.employee_id, s.expiry_date,
           s.days - least(s.days, greatest(0, coalesce(c.pool, 0) - coalesce(sum(s.days) over (partition by s.employee_id order by coalesce(s.expiry_date, date '9999-12-31'), s.txn_date, s.id rows between unbounded preceding and 1 preceding), 0))) as remaining
    from comp_day_ledger s
    left join (select employee_id, sum(greatest(0, -days)) as pool from comp_day_ledger where entry_type <> 'earned' group by employee_id) c on c.employee_id = s.employee_id
    where s.entry_type = 'earned'
  ) q
  where q.remaining > 0 and q.expiry_date is not null and q.expiry_date <= (now() at time zone 'UTC')::date
  union all
  select 'D comp-day-expiry', 52, 'comp-day balance now, all employees', coalesce(sum(days)::text, '0') || ' days across ' || count(distinct employee_id) || ' employees' from comp_day_ledger

  -- ===================================================================================================================
  -- E  /api/cron/document-expiry
  -- ===================================================================================================================
  union all
  select 'E document-expiry', 1, 'document_expiry_reminders_sent rows, ever',
         count(*)::text || ' rows; ' || count(distinct employee_document_id) || ' documents; first sent_at ' || coalesce(to_char(min(sent_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never')
         || '; LAST sent_at ' || coalesce(to_char(max(sent_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never')
  from document_expiry_reminders_sent
  union all
  select 'E document-expiry', 2, 'notifications of type document_expiring, ever',
         count(*)::text || ' rows; ' || count(distinct user_id) || ' recipients; first ' || coalesce(to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never')
         || '; LAST ' || coalesce(to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never') || '; unread ' || count(*) filter (where read_at is null)
  from notifications where type = 'document_expiring'
  union all
  select 'E document-expiry', 3, 'reminders recorded as sent WITHOUT a matching notification (route inserts the reminder first; a failed notification is never retried)',
         count(*)::text || ' reminder rows with no document_expiring notification for that document'
  from document_expiry_reminders_sent r
  where not exists (select 1 from notifications n where n.type = 'document_expiring' and n.payload ->> 'employeeDocumentId' = r.employee_document_id::text and (n.payload ->> 'leadDays')::int = r.lead_days)
  union all
  select 'E document-expiry', 10 + row_number() over (order by d.status), 'live documents with an expiry date, stored status = ' || d.status,
         d.n || ' documents'
  from (select status::text as status, count(*) as n from employee_documents where expiry_date is not null and deleted_at is null group by status) d
  union all
  select 'E document-expiry', 19, '(end of stored statuses)', 'no row above = no documents with an expiry date'
  union all
  select 'E document-expiry', 20 + row_number() over (order by t.stored, t.computed),
         'WOULD CHANGE NOW: status ' || t.stored || ' -> ' || t.computed, t.n || ' documents'
  from (
    select d.status::text as stored, d.computed::text as computed, count(*) as n from (
      select dd.id, dd.status, case when dd.days_remaining < 0 then 'expired'::document_status when dd.days_remaining <= dd.threshold then 'expiring_soon'::document_status else 'valid'::document_status end as computed
      from (
        select ed.id, ed.status, (ed.expiry_date - (now() at time zone case e.country_code when 'AE' then 'Asia/Dubai' when 'SA' then 'Asia/Riyadh' when 'PL' then 'Europe/Warsaw' else 'Asia/Dubai' end)::date) as days_remaining,
               coalesce((select max(r.lead_days) from document_expiry_reminder_rules r where r.document_type = ed.document_type and (r.company_id = e.company_id or (r.company_id is null and r.country_code = e.country_code))), 30) as threshold
        from employee_documents ed join employees e on e.id = ed.employee_id
        where ed.expiry_date is not null and ed.deleted_at is null
      ) dd
    ) d where d.status <> d.computed group by d.status, d.computed
  ) t
  union all
  select 'E document-expiry', 29, '(end of status changes)', 'no row above = every stored status already matches what the route would compute'
  union all
  select 'E document-expiry', 30, 'WOULD SEND NOW: (document, lead_days) reminders not yet recorded and already inside their window',
         coalesce(count(*)::text, '0') || ' reminders on ' || count(distinct p.id) || ' documents; ~' || coalesce(sum(p.recipients), 0) || ' in-app notifications (employee + every HR Admin in scope; NO email is sent by this route)'
         || '; most notifications for one document: ' || coalesce(max(p.notifs_for_doc), 0)
  from (
    select q.id, q.lead_days, q.recipients, sum(q.recipients) over (partition by q.id) as notifs_for_doc
    from (
      select ed.id, r.lead_days,
             (select count(*) from (select e.user_id where e.user_id is not null union select ur.user_id from user_roles ur where ur.role = 'hr_admin' and ur.revoked_at is null and (ur.company_id = e.company_id or ur.company_id is null)) rc) as recipients
      from employee_documents ed
      join employees e on e.id = ed.employee_id
      join document_expiry_reminder_rules r on r.document_type = ed.document_type and (r.company_id = e.company_id or (r.company_id is null and r.country_code = e.country_code))
      where ed.expiry_date is not null and ed.deleted_at is null
        and (ed.expiry_date - (now() at time zone case e.country_code when 'AE' then 'Asia/Dubai' when 'SA' then 'Asia/Riyadh' when 'PL' then 'Europe/Warsaw' else 'Asia/Dubai' end)::date) between 0 and r.lead_days
        and not exists (select 1 from document_expiry_reminders_sent s where s.employee_document_id = ed.id and s.lead_days = r.lead_days)
    ) q
  ) p

  -- ===================================================================================================================
  -- F  /api/ai/detect-balance-discrepancies
  -- ===================================================================================================================
  union all
  select 'F balance-discrepancy', 1, 'ai_drafts created by agent balance-discrepancy-detector, ever',
         count(*)::text || ' drafts; first ' || coalesce(to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never') || '; LAST ' || coalesce(to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never')
  from ai_drafts where created_by_agent = 'balance-discrepancy-detector'
  union all
  select 'F balance-discrepancy', 10 + row_number() over (order by d.status), 'detector drafts with status = ' || d.status, d.n || ' drafts'
  from (select status::text as status, count(*) as n from ai_drafts where created_by_agent = 'balance-discrepancy-detector' group by status) d
  union all
  select 'F balance-discrepancy', 20, 'ai_drafts from any other agent',
         count(*)::text || ' drafts' from ai_drafts where created_by_agent is distinct from 'balance-discrepancy-detector'
  union all
  select 'F balance-discrepancy', 30, 'negative leave balances RIGHT NOW (what the route scans for)',
         count(*)::text || ' employee/leave-type pairs, total ' || coalesce(sum(balance_days)::text, '0') || ' days; ' || count(distinct employee_id) || ' employees'
  from (select employee_id, leave_type_code, sum(amount_days) as balance_days from leave_ledger group by employee_id, leave_type_code having sum(amount_days) < 0) nb
  union all
  select 'F balance-discrepancy', 31, 'WOULD DRAFT NOW: negative pairs with no open (status=draft) adjust_balance draft',
         count(*)::text || ' new drafts (writes ai_drafts only, never the ledger)'
  from (select employee_id, leave_type_code from leave_ledger group by employee_id, leave_type_code having sum(amount_days) < 0) nb
  where not exists (
    select 1 from ai_drafts d where d.entity_type = 'leave_ledger' and d.proposed_action = 'adjust_balance' and d.status = 'draft'
      and d.proposed_payload @> jsonb_build_object('employee_id', nb.employee_id, 'leave_type_code', nb.leave_type_code))
  union all
  select 'F balance-discrepancy', 32, 'pairs where TWO OR MORE open drafts already match (route''s duplicate check cannot see these and would add another each run)',
         count(*)::text || ' pairs'
  from (select employee_id, leave_type_code from leave_ledger group by employee_id, leave_type_code having sum(amount_days) < 0) nb
  where (select count(*) from ai_drafts d where d.entity_type = 'leave_ledger' and d.proposed_action = 'adjust_balance' and d.status = 'draft'
           and d.proposed_payload @> jsonb_build_object('employee_id', nb.employee_id, 'leave_type_code', nb.leave_type_code)) > 1

  -- ===================================================================================================================
  -- G  /api/cron/recovery-windows (tables and pg_cron are looked up dynamically: "not present" instead of an error)
  -- ===================================================================================================================
  union all
  select 'G recovery-windows', 1, 'recovery_processor_runs: all runs, by origin / status',
         case when to_regclass('public.recovery_processor_runs') is null then 'table not present (migration 20261108000000 not applied)' else 'one row per origin/status follows; no such row = the processor has never run' end
  union all
  select 'G recovery-windows', 10 + row_number() over (order by (x.t)::text),
         'runs by origin/status', x.t::text
  from unnest(case when to_regclass('public.recovery_processor_runs') is null then array[]::text[] else
         (select array_agg(v) from (select (xpath('/row/t/text()', xr))[1]::text as v from unnest(xpath('/table/row', query_to_xml(
            $q$select origin || ' / ' || status || ': ' || count(*) || ' runs; first ' || to_char(min(started_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || '; LAST ' || to_char(max(started_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || '; employees_examined total ' || sum(employees_examined) as t from recovery_processor_runs group by origin, status order by origin, status$q$,
            false, false, ''))) xr) s) end) as x(t)
  union all
  select 'G recovery-windows', 40 + row_number() over (order by (x.t)::text), 'most recent runs (up to 5, newest first)', x.t::text
  from unnest(case when to_regclass('public.recovery_processor_runs') is null then array[]::text[] else
         (select array_agg(v) from (select (xpath('/row/t/text()', xr))[1]::text as v from unnest(xpath('/table/row', query_to_xml(
            $q$select to_char(started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC ' || origin || ' ' || status || ' examined=' || employees_examined || ' failed=' || employees_failed || coalesce(' error=' || left(error_summary, 120), '') as t from recovery_processor_runs order by started_at desc limit 5$q$,
            false, false, ''))) xr) s) end) as x(t)
  union all
  select 'G recovery-windows', 60, 'open recovery_processor_failures (unresolved)',
         case when to_regclass('public.recovery_processor_failures') is null then 'table not present'
              else (xpath('/row/t/text()', (xpath('/table/row', query_to_xml('select count(*)::text as t from recovery_processor_failures where resolved_at is null', false, false, '')))[1]))[1]::text end
  union all
  select 'G recovery-windows', 61, 'open recovery_periods (work the processor would catch up)',
         case when to_regclass('public.recovery_periods') is null then 'table not present'
              else (xpath('/row/t/text()', (xpath('/table/row', query_to_xml('select count(*)::text as t from recovery_periods where status = ''open''', false, false, '')))[1]))[1]::text end
  union all
  select 'G recovery-windows', 62, 'recovery_windows policy active (overtime_rules payload model = recovery_windows)',
         (select count(*)::text || ' active version(s)' from policy_versions where policy_type = 'overtime_rules' and status = 'active' and payload ->> 'model' = 'recovery_windows')
         || ' - until one is active the processor has no windowed periods to process and a run does nothing'
  union all
  select 'G recovery-windows', 70, 'pg_cron job recovery-window-processor (primary scheduler)',
         case when to_regclass('cron.job') is null then 'pg_cron not installed in this database (no job)'
              else coalesce((xpath('/row/t/text()', (xpath('/table/row', query_to_xml($q$select coalesce(string_agg('jobid=' || jobid || ' schedule=' || schedule || ' active=' || active, '; '), 'job NOT scheduled') as t from cron.job where jobname = 'recovery-window-processor'$q$, false, false, '')))[1]))[1]::text, 'job NOT scheduled') end
  union all
  select 'G recovery-windows', 80 + row_number() over (order by (x.t)::text), 'pg_cron last runs of that job (up to 5; cron.job_run_details)', x.t::text
  from unnest(case when to_regclass('cron.job_run_details') is null then array[]::text[] else
         (select array_agg(v) from (select (xpath('/row/t/text()', xr))[1]::text as v from unnest(xpath('/table/row', query_to_xml(
            $q$select to_char(d.start_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC ' || d.status || coalesce(' ' || left(d.return_message, 100), '') as t from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'recovery-window-processor' order by d.start_time desc limit 5$q$,
            false, false, ''))) xr) s) end) as x(t)
  union all
  select 'G recovery-windows', 89, 'where to look if pg_cron is missing',
         'Supabase Dashboard -> Database -> Extensions -> pg_cron; and Integrations -> Cron (jobs and run history). Enabling it is a separate owner decision: supabase/manual-sql/recovery_windows_30_enable_scheduler.sql and docs/recovery-windows-deployment.md section 7.'
  union all
  select 'G recovery-windows', 90, 'recovery_scheduler_ready() (pg_cron job active AND a successful pg_cron-origin run in the last 15 minutes)',
         case when to_regproc('public.recovery_scheduler_ready') is null then 'function not present'
              else (xpath('/row/t/text()', (xpath('/table/row', query_to_xml('select recovery_scheduler_ready()::text as t', false, false, '')))[1]))[1]::text end

  -- ===================================================================================================================
  -- H  not SQL: what to check in the Vercel dashboard
  -- ===================================================================================================================
  union all select 'H Vercel dashboard (not SQL)', 1, 'Project -> Settings -> Cron Jobs', 'Are the five jobs listed (they come from vercel.json on the PRODUCTION deployment) and enabled? Crons run only on the Production deployment, never on Previews.'
  union all select 'H Vercel dashboard (not SQL)', 2, 'Project -> Settings -> Cron Jobs -> View Logs (or Logs, filter Source = Cron, path starting /api/cron and /api/ai)', 'For each of the five paths: what HTTP status did the most recent invocations return? 307 (redirect to /login) means the proxy blocked it; 401 means the route itself rejected the call (CRON_SECRET missing or different); 200 means it ran.'
  union all select 'H Vercel dashboard (not SQL)', 3, 'Project -> Settings -> Environment Variables (Production)', 'Is CRON_SECRET set for Production? (Vercel sends it automatically as Authorization: Bearer on cron calls only if it is set.) Also confirm SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are set. Do NOT paste any secret value back to anyone; names and "set / not set" are enough. ALLOW_SCHEDULED_ROUTES_WITHOUT_SESSION should be NOT set until you have read docs/scheduled-routes-diagnosis.md.'
  union all select 'H Vercel dashboard (not SQL)', 4, 'Project -> Settings -> General -> Plan, and Functions', 'Which plan? On Hobby, crons may run at most once per day and fire anywhere within the scheduled hour; a 5-minute schedule is rejected. Note the function timeout: the accrual and document sweeps are loops over every employee/document.'
  union all select 'H Vercel dashboard (not SQL)', 5, 'Deployments -> Production -> Functions / Runtime Logs for the last first-of-month (00:00 UTC on the 1st)', 'The monthly accrual only fires on the 1st. Look at that day''s log entry for /api/cron/leave-accrual and report its status code.'

) result
order by section, ord;
