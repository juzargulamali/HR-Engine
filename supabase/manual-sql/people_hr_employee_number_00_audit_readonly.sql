-- READ ONLY. Changes nothing. Run in the SQL editor of the project you expect (any time, before or after the migration). It reads employees, profiles and companies only and uses no function from the migration, so it
-- works BEFORE the migration is applied.
-- It audits the employee numbers of every ACTIVE or INVITED employee in EVERY company (UAE, Saudi Arabia, Europe) as ONE shared series. "Active or invited" means: not removed (deleted_at is null), not terminated, and
-- whose login (if they have one) is not deactivated; a person with no login yet, or an invited login, is covered. Records that are removed, terminated or deactivated TODAY are IGNORED (they were test accounts):
-- they are not collisions, are not reserved, and are only counted below so you can see how many were left out. The rule applies from now; no history is read. Numbers are equivalent under the rule "trim, remove
-- spaces, upper-case; drop leading zeros of the trailing digits and pad to at least three" (so E02, e002, E002 and E2 are one number). No number is changed or proposed here.
--
-- WHAT BLOCKS THE MIGRATION (class A): two or more active or invited employees hold equivalent numbers (scope says 'same company' or 'different companies'). Each group needs one decision from the owner: which
-- employee keeps the number. A correction is one approved update of one employee's employee_number (never a delete, never a bulk change); the employee keeps their id, company and access. The migration refuses to
-- run, and changes nothing, until there are none.
--
-- AUTOMATIC NUMBERING (what a new hire will receive). The migration builds a POOL, once, from the ignored records above: the E-series numbers (E plus digits) they show, normalised, deduplicated, and without any number an
-- active or invited employee holds (so a number such as E003 held by a live employee can never be in it). A new hire gets the LOWEST pool number still free, claimed atomically across all companies, then reserved for that
-- employee permanently; when the pool is empty the shared sequence takes over, starting above the highest E-number an active or invited employee holds. Gaps outside the pool are left alone. This audit shows that pool
-- exactly as the migration would build it from today's data, in allocation order. Resolve the blocking groups first: a correction changes who holds a number and so what the pool is.
--
-- One result set, in this order:
--   SUMMARY        counts, how many records were ignored, the highest number in use and where the new series would start. Read these first.
--   COLLISION      one row per active or invited employee in each blocking group.
--   E003           every employee record, in any company and any status, whose number is equivalent to E003: the global check for that one number. Only 'active' and 'invited' rows count; a row marked 'ignored: ...'
--                  is shown so you can see it, and does not collide with anything.
--   POOL           the exact pool, one row per number, in the order automatic numbering will hand it out (scope 'position n of m'; group_key the number; number_as_recorded the spellings the ignored records show;
--                  employee the ignored records it came from).
--   POOL LEFT OUT  ignored records' numbers that do NOT enter the pool, with the reason: 'held by an active or invited employee' (for example E003) or 'not in the E series' (for example L-001).
--   NOT STANDARD   a recorded number of an active or invited employee that is not in the shared series: scope 'not canonical' (E2 would be saved as E002; left as recorded) or 'outside series' (not E plus digits,
--                  for example L-001; valid, left as recorded, never produced by the sequence, and ignored when the series start is worked out).
-- Columns: kind, class, scope, company, group_key (the canonical form all the group's numbers share), number_as_recorded, employee_id, employee (name), employment_status, standing ('active', 'invited',
-- 'ignored: removed', 'ignored: terminated' or 'ignored: deactivated login'), hired, recorded_at (when the employee record was created).
with n as (
  select em.*, upper(regexp_replace(coalesce(em.employee_number, ''), '\s+', '', 'g')) as s from employees em
),
e as (
  select n.id as employee_id, n.company_id, c.legal_name as company, n.employee_number,
         case when n.s !~ '[0-9]$' then n.s
              else regexp_replace(n.s, '[0-9]+$', '')
                   || case when length(ltrim(substring(n.s from '[0-9]+$'), '0')) >= 3 then ltrim(substring(n.s from '[0-9]+$'), '0')
                           else lpad(ltrim(substring(n.s from '[0-9]+$'), '0'), 3, '0') end end as k,
         trim(n.first_name || ' ' || n.last_name) as employee, n.employment_status::text as employment_status, n.hire_date, n.created_at,
         case when n.deleted_at is not null then 'ignored: removed'
              when n.employment_status = 'terminated' then 'ignored: terminated'
              when exists (select 1 from profiles p where p.id = n.user_id and p.account_status = 'deactivated') then 'ignored: deactivated login'
              when exists (select 1 from profiles p where p.id = n.user_id and p.account_status = 'invited') then 'invited'
              else 'active' end as standing
  from n join companies c on c.id = n.company_id
),
live as (select * from e where standing in ('active', 'invited')),
g as (
  select k, count(*) as members, count(distinct company_id) as companies
  from live where k <> '' group by k having count(*) > 1
),
cls as (select k, members, case when companies = 1 then 'same company' else 'different companies' end as scope from g),
series as (select coalesce(max(substring(k from '^E([0-9]+)$')::bigint), 0) as top from live where k ~ '^E[0-9]{1,15}$'),
ign as (select * from e where standing like 'ignored:%' and k <> ''),
pool as (
  select k, substring(k from '^E([0-9]+)$')::bigint as v,
         string_agg(distinct employee_number, ', ' order by employee_number) as recorded,
         string_agg(distinct (employee || ' (' || standing || ')'), '; ' order by (employee || ' (' || standing || ')')) as sources,
         count(*) as records
  from ign
  where k ~ '^E[0-9]{1,15}$' and not exists (select 1 from live l where l.k = ign.k)
  group by k
),
pool_ord as (select pool.*, row_number() over (order by v) as pos, count(*) over () as total from pool),
left_out as (
  select k, case when exists (select 1 from live l where l.k = ign.k) then 'held by an active or invited employee' else 'not in the E series' end as why,
         string_agg(distinct employee_number, ', ' order by employee_number) as recorded,
         string_agg(distinct (employee || ' (' || standing || ')'), '; ' order by (employee || ' (' || standing || ')')) as sources
  from ign
  where exists (select 1 from live l where l.k = ign.k) or k !~ '^E[0-9]{1,15}$'
  group by k, case when exists (select 1 from live l where l.k = ign.k) then 'held by an active or invited employee' else 'not in the E series' end
)
select kind, class, scope, company, group_key, number_as_recorded, employee_id, employee, employment_status, standing, hired, recorded_at from (
  select 0 as ord, 'SUMMARY' as kind, null::text as class, null::text as scope, null::text as company, 'groups that block the migration (active or invited employees, any companies)' as group_key, (select count(*) from cls)::text as number_as_recorded,
         null::uuid as employee_id, null::text as employee, null::text as employment_status, null::text as standing, null::date as hired, null::timestamptz as recorded_at
  union all select 0, 'SUMMARY', null, null, null, '  of which across different companies', (select count(*) from cls where scope = 'different companies')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'active or invited employees audited (all companies)', (select count(*) from live)::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, '  of which invited (login not yet accepted)', (select count(*) from live where standing = 'invited')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'records ignored (removed, terminated or deactivated login): not reserved, not collisions', (select count(*) from e where standing like 'ignored:%')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, '  of which share a number with an active or invited employee (information; the active one keeps it)', (select count(*) from e x where x.standing like 'ignored:%' and x.k <> '' and exists (select 1 from live l where l.k = x.k))::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'active or invited employees holding E003 or an equivalent spelling', (select count(*) from live where k = 'E003')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'recorded numbers not in canonical form (information, left as recorded)', (select count(*) from live where employee_number is distinct from k and k <> '')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'recorded numbers outside the E-series (information, left as recorded)', (select count(*) from live where k <> '' and k !~ '^E[0-9]+$')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'active or invited employees with an empty number', (select count(*) from live where k = '')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'highest E-number an active or invited employee holds', (select case when top = 0 then '(none)' else 'E' || case when length(top::text) >= 3 then top::text else lpad(top::text, 3, '0') end end from series), null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'automatic numbering POOL: numbers handed out first, lowest first (from the ignored records)', (select count(*) from pool)::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, '  ignored records whose numbers went into the pool (spelling variants and duplicates merged)', (select coalesce(sum(records), 0) from pool)::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, '  left out of the pool: numbers held by an active or invited employee', (select count(*) from left_out where why = 'held by an active or invited employee')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, '  left out of the pool: numbers not in the E series', (select count(*) from left_out where why = 'not in the E series')::text, null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'the NEXT number a new hire would be given', (select coalesce((select k from pool_ord where pos = 1), (select 'E' || case when length((top + 1)::text) >= 3 then (top + 1)::text else lpad((top + 1)::text, 3, '0') end from series))), null, null, null, null, null, null
  union all select 0, 'SUMMARY', null, null, null, 'SEQUENCE FALLBACK, used once the pool is empty: the first number it would give out', (select 'E' || case when length((top + 1)::text) >= 3 then (top + 1)::text else lpad((top + 1)::text, 3, '0') end from series), null, null, null, null, null, null
  union all
  select 1, 'COLLISION', 'A', cls.scope, l.company, cls.k, l.employee_number, l.employee_id, l.employee, l.employment_status, l.standing, l.hire_date, l.created_at
  from cls join live l on l.k = cls.k
  union all
  select 2, 'POOL', null, 'position ' || pos || ' of ' || total, null, k, recorded, null::uuid, sources, null, null, null, null
  from pool_ord
  union all
  select 3, 'POOL LEFT OUT', null, why, null, k, recorded, null::uuid, sources, null, null, null, null
  from left_out
  union all
  select 4, 'E003', null, null, e.company, e.k, e.employee_number, e.employee_id, e.employee, e.employment_status, e.standing, e.hire_date, e.created_at
  from e where e.k = 'E003'
  union all
  select 5, 'NOT STANDARD', null, 'not canonical', l.company, l.k, l.employee_number, l.employee_id, l.employee, l.employment_status, l.standing, l.hire_date, l.created_at
  from live l where l.employee_number is distinct from l.k and l.k <> ''
  union all
  select 5, 'NOT STANDARD', null, 'outside series', l.company, l.k, l.employee_number, l.employee_id, l.employee, l.employment_status, l.standing, l.hire_date, l.created_at
  from live l where l.k <> '' and l.k !~ '^E[0-9]+$'
) x
order by ord, class nulls last, scope nulls last, group_key, company nulls last, number_as_recorded, employee_id;
