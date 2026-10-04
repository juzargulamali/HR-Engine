-- READ-ONLY. Run AFTER supabase/migrations/20261110000000_employee_is_c_level.sql.
-- Expect 1 row: employee_is_c_level exists and signed-in users may call it.
select proname,
       has_function_privilege('authenticated', 'public.employee_is_c_level(uuid)', 'execute') as signed_in_may_call
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'employee_is_c_level';
