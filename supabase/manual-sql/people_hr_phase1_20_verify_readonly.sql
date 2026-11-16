-- READ ONLY. Run AFTER 20270115000100_people_hr_phase1.sql. Every row must say OK except row 9, which is a count for information. Creates no row.
-- A row that says FAIL after the migration ran usually means an OLDER draft of the functions is still installed: apply the migration file again (it is re-runnable) and run this again.
select item, result from (
  select 1 as ord, 'employee_career_events has applied_at (default now()), base_compensation_id, conflict_reason, conflict_at, dismissed_at, dismissed_by, and an index for scheduled rows' as item,
         case when (select count(*) from pg_attribute a where a.attrelid = 'public.employee_career_events'::regclass and not a.attisdropped
                      and a.attname in ('applied_at', 'base_compensation_id', 'conflict_reason', 'conflict_at', 'dismissed_at', 'dismissed_by')) = 6
                   and (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                         where d.adrelid = 'public.employee_career_events'::regclass and a.attname = 'applied_at') ilike 'now()%'
                   and to_regclass('public.idx_career_events_scheduled') is not null
              then 'OK' else 'FAIL - a column, the default or the index differs' end as result
  union all select 2, 'no unapplied (scheduled) career event is dated on or before the employee''s own calendar day when it was recorded: every row written before the migration was marked applied, and a scheduled change is always future-dated for its employee when recorded',
         case when not exists (select 1 from employee_career_events ev join employees em on em.id = ev.employee_id
                                where ev.applied_at is null and ev.dismissed_at is null and ev.conflict_at is null and ev.effective_date <= hr_business_date(em.country_code, ev.created_at))
              then 'OK' else 'FAIL - an unapplied event is not a future-dated one' end
  union all select 3, 'record_employment_change has the six-argument form (no "today" sent by the caller); signed-in users can call it, anon cannot; the older seven-argument form is gone; dismiss_employment_change likewise',
         case when to_regprocedure('public.record_employment_change(uuid, date, text, numeric, numeric, text)') is not null
                   and to_regprocedure('public.record_employment_change(uuid, date, text, numeric, numeric, text, date)') is null
                   and has_function_privilege('authenticated', 'public.record_employment_change(uuid, date, text, numeric, numeric, text)', 'execute')
                   and not has_function_privilege('anon', 'public.record_employment_change(uuid, date, text, numeric, numeric, text)', 'execute')
                   and to_regprocedure('public.dismiss_employment_change(uuid)') is not null
                   and has_function_privilege('authenticated', 'public.dismiss_employment_change(uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.dismiss_employment_change(uuid)', 'execute')
              then 'OK' else 'FAIL - missing, older version, or privileges differ' end
  union all select 4, 'apply_due_employment_changes takes no country or date (it reads each employee''s own calendar), is callable by the service role only, and the older (country, date) form is gone',
         case when to_regprocedure('public.apply_due_employment_changes(timestamptz)') is not null
                   and to_regprocedure('public.apply_due_employment_changes(text, date)') is null
                   and not has_function_privilege('authenticated', 'public.apply_due_employment_changes(timestamptz)', 'execute')
                   and not has_function_privilege('anon', 'public.apply_due_employment_changes(timestamptz)', 'execute')
                   and (not exists (select 1 from pg_roles where rolname = 'service_role') or has_function_privilege('service_role', 'public.apply_due_employment_changes(timestamptz)', 'execute'))
              then 'OK' else 'FAIL - missing, older version, or privileges differ' end
  union all select 5, 'the three internal helpers (employee lock, apply, set pay) exist in their current form and are not callable by signed-in users or anon',
         case when to_regprocedure('public._hr_apply_career_event(uuid)') is not null and to_regprocedure('public._hr_set_current_pay(uuid, date, numeric, jsonb, text, uuid)') is not null
                   and to_regprocedure('public._hr_lock_employee(uuid)') is not null
                   and not has_function_privilege('authenticated', 'public._hr_lock_employee(uuid)', 'execute')
                   and not has_function_privilege('anon', 'public._hr_lock_employee(uuid)', 'execute')
                   and to_regprocedure('public._hr_set_current_pay(uuid, date, numeric, numeric, text, uuid)') is null
                   and (select prorettype::regtype::text from pg_proc where oid = 'public._hr_apply_career_event(uuid)'::regprocedure) = 'text'
                   and not has_function_privilege('authenticated', 'public._hr_apply_career_event(uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public._hr_set_current_pay(uuid, date, numeric, jsonb, text, uuid)', 'execute')
                   and not has_function_privilege('anon', 'public._hr_apply_career_event(uuid)', 'execute')
              then 'OK' else 'FAIL - helper missing, older version, or callable' end
  union all select 6, 'the employee business-date helpers answer correctly: 21:00 UTC is already the next day in Dubai and Riyadh, 22:30 UTC is still the same day in Warsaw and 23:30 UTC (November) is the next day there; anon cannot call them',
         case when to_regprocedure('public.hr_business_date(text, timestamptz)') is not null and to_regprocedure('public.hr_business_today(text)') is not null
                   and hr_business_date('AE', '2026-11-16 21:00:00+00') = date '2026-11-17'
                   and hr_business_date('SA', '2026-11-16 21:00:00+00') = date '2026-11-17'
                   and hr_business_date('PL', '2026-11-16 22:30:00+00') = date '2026-11-16'
                   and hr_business_date('PL', '2026-11-16 23:30:00+00') = date '2026-11-17'
                   and hr_business_date('XX', '2026-11-16 21:00:00+00') = date '2026-11-17'
                   and not has_function_privilege('anon', 'public.hr_business_date(text, timestamptz)', 'execute')
                   and not has_function_privilege('anon', 'public.hr_business_today(text)', 'execute')
              then 'OK' else 'FAIL - a helper is missing or answers differently' end
  union all select 7, 'the six functions that write or lock run as their owner with a pinned search path; the save, the cancellation and the apply helper take the employee lock first, and the daily job does not list its work with a skip-locked cursor',
         case when (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
                      and proname in ('record_employment_change', 'apply_due_employment_changes', 'dismiss_employment_change', '_hr_apply_career_event', '_hr_set_current_pay', '_hr_lock_employee')
                      and prosecdef and proconfig is not null and 'search_path=public' = any (proconfig)) = 6
                   and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
                          and proname in ('record_employment_change', 'dismiss_employment_change', '_hr_apply_career_event') and prosrc like '%_hr_lock_employee(%') = 3
                   and (select prosrc not like '%skip locked%' from pg_proc where oid = to_regprocedure('public.apply_due_employment_changes(timestamptz)'))
              then 'OK' else 'FAIL - a function is not security definer with search_path = public, or an older version without the employee lock is installed (apply the migration file again)' end
  union all select 8, 'the two one-opening-balance indexes exist (leave ledger per employee and leave type; comp-day ledger per employee)',
         case when to_regclass('public.leave_ledger_opening_balance_unique') is not null and to_regclass('public.comp_day_ledger_opening_balance_unique') is not null
                   and (select indisunique from pg_index where indexrelid = 'public.leave_ledger_opening_balance_unique'::regclass)
                   and (select indisunique from pg_index where indexrelid = 'public.comp_day_ledger_opening_balance_unique'::regclass)
              then 'OK' else 'FAIL - an index is missing or not unique' end
  union all select 9, 'information: scheduled changes waiting (a fresh install shows 0) / held for review / career events applied',
         (select count(*) from employee_career_events where applied_at is null and dismissed_at is null)::text || ' / ' ||
         (select count(*) from employee_career_events where applied_at is null and dismissed_at is null and conflict_at is not null)::text || ' / ' ||
         (select count(*) from employee_career_events where applied_at is not null)::text
) x order by ord;
