-- READ ONLY. Changes nothing. Run in the SQL editor of the project you expect (any time, before or after the migration). It reads employees and companies only and uses no function from the migration, so it
-- works BEFORE the migration is applied.
-- It audits EVERY employee number in EVERY company (UAE, Saudi Arabia, Europe), including terminated (inactive) and removed (soft-deleted) employees, as ONE shared series. Numbers are equivalent under the rule
-- "trim, remove spaces, upper-case; drop leading zeros of the trailing digits and pad to at least three" (so E02, e002, E002 and E2 are one number). No number is changed or proposed here.
--
-- One result set, five kinds of rows, in this order:
--   SUMMARY        counts and the start of the new series. Read these first.
--   COLLISION      one row per employee in a group of equivalent numbers, ACROSS ALL COMPANIES, with the group's class:
--       A  BLOCKS the migration: two or more LIVE (not removed) employees hold equivalent numbers. `scope` says whether they are in the same company or in different companies.
--          Each A group needs one decision from the owner: which employee keeps the number. The migration refuses to run until there are none.
--       B  not a blocker: one live employee and one or more REMOVED employees hold equivalent numbers (a removed employee's number may be reused by hand; migration 20261023000000). Listed so you can decide
--          whether that is acceptable. The new sequence never re-issues it.
--       C  information only: two or more REMOVED employees hold equivalent numbers and nobody live does.
--   E003           every employee (all companies, live, terminated and removed) whose number is equivalent to E003, wherever it is held. The one number the owner asked to check globally; empty means nobody holds it.
--   NOT STANDARD   a recorded number that is not in the shared series, for review:
--       'not canonical'  would be saved differently today (E2 would be E002, e002 would be E002). Left exactly as recorded; nothing needs doing.
--       'outside series' not E + digits at all (for example L-001 or DI-9): valid, left as recorded, never produced by the sequence, and ignored when the series start is worked out.
--
-- Columns: kind, class, scope, company, group_key (the canonical form all the group's numbers share), number_as_recorded, employee_id, employee (name), employment_status, removed (yes/no), hired, created.
-- 'who to ask': for an A group, whoever knows which employee really holds the number. A correction is a single approved UPDATE of one employee's employee_number (never a delete, never a bulk change); the
-- employee keeps their id, company and access. Then run this audit again: when the SUMMARY says 0 A groups the migration can be applied.
with n as (
  select em.*, upper(regexp_replace(coalesce(em.employee_number, ''), '\s+', '', 'g')) as s from employees em
),
e as (
  select n.id, n.company_id, c.legal_name as company, n.employee_number,
         case when n.s !~ '[0-9]$' then n.s
              else regexp_replace(n.s, '[0-9]+$', '')
                   || case when length(ltrim(substring(n.s from '[0-9]+$'), '0')) >= 3 then ltrim(substring(n.s from '[0-9]+$'), '0')
                           else lpad(ltrim(substring(n.s from '[0-9]+$'), '0'), 3, '0') end end as k,
         trim(n.first_name || ' ' || n.last_name) as employee, n.employment_status::text as employment_status, n.deleted_at, n.hire_date, n.created_at
  from n join companies c on c.id = n.company_id
),
g as (
  select k, count(*) as members, count(*) filter (where deleted_at is null) as live, count(*) filter (where deleted_at is not null) as removed,
         count(distinct company_id) filter (where deleted_at is null) as live_companies
  from e group by k having count(*) > 1
),
cls as (
  select k, members, live, removed,
         case when live >= 2 then 'A' when live = 1 then 'B' else 'C' end as class,
         case when live >= 2 and live_companies = 1 then 'same company' when live >= 2 then 'different companies' else null end as scope
  from g
  where live >= 2 or (live = 1 and removed >= 1) or (live = 0 and removed >= 2)
),
series as (select coalesce(max(substring(k from '^E([0-9]+)$')::bigint), 0) as top from e where k ~ '^E[0-9]{1,15}$')
select kind, class, scope, company, group_key, number_as_recorded, employee_id, employee, employment_status, removed, hired, created from (
  select 0 as ord, 'SUMMARY' as kind, 'A' as class, null::text as scope, null::text as company, 'groups that block the migration (live employees, any companies)' as group_key, (select count(*) from cls where class = 'A')::text as number_as_recorded,
         null::uuid as employee_id, null::text as employee, null::text as employment_status, null::text as removed, null::date as hired, null::timestamptz as created
  union all select 0, 'SUMMARY', 'A', null, null, '  of which across different companies', (select count(*) from cls where class = 'A' and scope = 'different companies')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', 'B', null, null, 'groups that reuse a removed employee''s number (not a blocker)', (select count(*) from cls where class = 'B')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', 'C', null, null, 'groups among removed employees only (information)', (select count(*) from cls where class = 'C')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'employees audited (all companies, including terminated and removed)', (select count(*) from e)::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'employees holding E003 or an equivalent spelling (any company, any status)', (select count(*) from e where k = 'E003')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'recorded numbers not in canonical form (information, left as recorded)', (select count(*) from e where employee_number is distinct from k and k <> '')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'recorded numbers outside the E-series (information, left as recorded)', (select count(*) from e where k <> '' and k !~ '^E[0-9]+$')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'employees with an empty number', (select count(*) from e where k = '')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'highest E-number held by ANY employee (live, terminated or removed)', (select case when top = 0 then '(none)' else 'E' || case when length(top::text) >= 3 then top::text else lpad(top::text, 3, '0') end end from series), null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'the first number the new series would give out', (select 'E' || case when length((top + 1)::text) >= 3 then (top + 1)::text else lpad((top + 1)::text, 3, '0') end from series), null, null, null, null, null, null
  union all
  select 1, 'COLLISION', cls.class, cls.scope, e.company, cls.k, e.employee_number, e.id, e.employee, e.employment_status, case when e.deleted_at is null then 'no' else 'yes' end, e.hire_date, e.created_at
  from cls join e on e.k = cls.k
  union all
  select 2, 'E003', null, null, e.company, e.k, e.employee_number, e.id, e.employee, e.employment_status, case when e.deleted_at is null then 'no' else 'yes' end, e.hire_date, e.created_at
  from e where e.k = 'E003'
  union all
  select 3, 'NOT STANDARD', null, 'not canonical', e.company, e.k, e.employee_number, e.id, e.employee, e.employment_status, case when e.deleted_at is null then 'no' else 'yes' end, e.hire_date, e.created_at
  from e where e.employee_number is distinct from e.k and e.k <> ''
  union all
  select 3, 'NOT STANDARD', null, 'outside series', e.company, e.k, e.employee_number, e.id, e.employee, e.employment_status, case when e.deleted_at is null then 'no' else 'yes' end, e.hire_date, e.created_at
  from e where e.k <> '' and e.k !~ '^E[0-9]+$'
) x
order by ord, class nulls last, scope nulls last, group_key, company, number_as_recorded, employee_id;
