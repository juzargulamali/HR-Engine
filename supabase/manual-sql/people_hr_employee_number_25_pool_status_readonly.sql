-- READ ONLY. Run AFTER 20270117000100_people_hr_employee_number_unique.sql, any time. Changes nothing and takes no number. It shows, from the tables the migration built, how automatic numbering stands NOW:
--   SUMMARY  when the pool was built and its size, how many numbers have been claimed and how many remain, the next number a new hire will be given, and the sequence fallback (where it stands and the first number it
--            would give out once the pool is empty).
--   POOL     the numbers still free in the pool, in the order they will be handed out (a number somebody has since reserved by hand, or an active or invited employee shows, is skipped and not listed).
--   CLAIMED  the pool numbers already given to an employee (the employee id, and when). A claimed number is reserved for that employee permanently.
-- The pool was built once, at the migration, from the records that were deleted, terminated or deactivated then. It is never rebuilt: people who leave later keep their numbers and add nothing to it.
with st as (select * from employee_number_allocation limit 1),
seq as (select case when is_called then last_value else 0 end as last_given from employee_number_seq),
free as (
  select p.number_key, p.number_value, row_number() over (order by p.number_value) as pos
  from employee_number_pool p
  where p.claimed_by is null
    and not exists (select 1 from employee_number_reservations r where r.number_key = p.number_key)
    and not exists (select 1 from employees e where employee_number_canonical(e.employee_number) = p.number_key and employee_number_in_scope(e.deleted_at, e.employment_status, e.user_id))
),
fallback as (
  -- the first number the sequence would give out: above the last value it has given and above every reserved number it would skip
  select 'E' || case when length(x::text) >= 3 then x::text else lpad(x::text, 3, '0') end as number_text, x
  from (select (select last_given from seq) + 1 as x) s
)
select kind, item, value from (
  select 0 as ord, 'SUMMARY' as kind, 'pool built at' as item, (select pool_built_at::text from st) as value
  union all select 0, 'SUMMARY', 'pool size when built', (select pool_size::text from st)
  union all select 0, 'SUMMARY', 'claimed so far (given to an employee)', (select count(*) from employee_number_pool where claimed_by is not null)::text
  union all select 0, 'SUMMARY', 'free now (handed out first, lowest first)', (select count(*) from free)::text
  union all select 0, 'SUMMARY', 'the NEXT number a new hire will be given', coalesce((select number_key from free where pos = 1), (select number_text from fallback) || ' (sequence fallback; skips any reserved number)')
  union all select 0, 'SUMMARY', 'sequence fallback: the highest reserved E-number at rollout', (select 'E' || case when length(sequence_start::text) >= 3 then sequence_start::text else lpad(sequence_start::text, 3, '0') end from st)
  union all select 0, 'SUMMARY', 'sequence fallback: last value it has given out (0 = none yet)', (select last_given::text from seq)
  union all select 0, 'SUMMARY', 'sequence fallback: first number it would give out next (before skipping reserved numbers)', (select number_text from fallback)
  union all select 1, 'POOL', 'position ' || pos || ' of ' || (select count(*) from free), number_key from free
  union all select 2, 'CLAIMED', number_key, 'employee ' || claimed_by::text || ' on ' || claimed_at::text from employee_number_pool where claimed_by is not null
) x order by ord, item, value;
