-- READ ONLY. Run AFTER 20270111000100_people_hr_phase1.sql. Every row must say OK except row 8, which is a count for information. Creates no row.
select item, result from (
  select 1 as ord, 'employee_career_events.applied_at exists with default now() and an index for scheduled rows' as item,
         case when exists (select 1 from pg_attribute a where a.attrelid = 'public.employee_career_events'::regclass and a.attname = 'applied_at' and not a.attisdropped)
                   and (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                         where d.adrelid = 'public.employee_career_events'::regclass and a.attname = 'applied_at') ilike 'now()%'
                   and to_regclass('public.idx_career_events_scheduled') is not null
              then 'OK' else 'FAIL - column, default or index differs' end as result
  union all select 2, 'no unapplied (scheduled) career event is dated on or before the day it was recorded: every row written before the migration was marked applied, and a scheduled change is always future-dated when recorded',
         case when not exists (select 1 from employee_career_events where applied_at is null and effective_date <= created_at::date) then 'OK' else 'FAIL - an unapplied event is not a future-dated one' end
  union all select 3, 'record_employment_change exists; signed-in users can call it, anon cannot',
         case when to_regprocedure('public.record_employment_change(uuid, date, text, numeric, numeric, text, date)') is not null
                   and has_function_privilege('authenticated', 'public.record_employment_change(uuid, date, text, numeric, numeric, text, date)', 'execute')
                   and not has_function_privilege('anon', 'public.record_employment_change(uuid, date, text, numeric, numeric, text, date)', 'execute')
              then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 4, 'apply_due_employment_changes exists and is callable by the service role only (not by signed-in users or anon)',
         case when to_regprocedure('public.apply_due_employment_changes(text, date)') is not null
                   and not has_function_privilege('authenticated', 'public.apply_due_employment_changes(text, date)', 'execute')
                   and not has_function_privilege('anon', 'public.apply_due_employment_changes(text, date)', 'execute')
                   and (not exists (select 1 from pg_roles where rolname = 'service_role') or has_function_privilege('service_role', 'public.apply_due_employment_changes(text, date)', 'execute'))
              then 'OK' else 'FAIL - missing or privileges differ' end
  union all select 5, 'the two internal helpers exist and are not callable by signed-in users or anon',
         case when to_regprocedure('public._hr_apply_career_event(uuid)') is not null and to_regprocedure('public._hr_set_current_pay(uuid, date, numeric, numeric, text, uuid)') is not null
                   and not has_function_privilege('authenticated', 'public._hr_apply_career_event(uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public._hr_set_current_pay(uuid, date, numeric, numeric, text, uuid)', 'execute')
                   and not has_function_privilege('anon', 'public._hr_apply_career_event(uuid)', 'execute')
              then 'OK' else 'FAIL - helper missing or callable' end
  union all select 6, 'all four functions run as their owner with a pinned search path',
         case when (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('record_employment_change', 'apply_due_employment_changes', '_hr_apply_career_event', '_hr_set_current_pay')
                      and prosecdef and proconfig is not null and 'search_path=public' = any (proconfig)) = 4
              then 'OK' else 'FAIL - a function is not security definer with search_path = public' end
  union all select 7, 'the two one-opening-balance indexes exist (leave ledger per employee and leave type; comp-day ledger per employee)',
         case when to_regclass('public.leave_ledger_opening_balance_unique') is not null and to_regclass('public.comp_day_ledger_opening_balance_unique') is not null
                   and (select indisunique from pg_index where indexrelid = 'public.leave_ledger_opening_balance_unique'::regclass)
                   and (select indisunique from pg_index where indexrelid = 'public.comp_day_ledger_opening_balance_unique'::regclass)
              then 'OK' else 'FAIL - an index is missing or not unique' end
  union all select 8, 'information: scheduled changes waiting (a fresh install shows 0) / career events applied',
         (select count(*) from employee_career_events where applied_at is null)::text || ' / ' || (select count(*) from employee_career_events where applied_at is not null)::text
) x order by ord;
