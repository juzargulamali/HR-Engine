-- Employee numbers: ONE shared series across every Enginious company (UAE, Saudi Arabia, Europe), PERMANENTLY RESERVED FROM NOW. Equivalent numbers (E02, e002, E002) are one number, saved in canonical form, and a
-- NEW hire's number is assigned by the database from one sequence (E001, E002, ...). A number, once given to an employee record, belongs to that record for good.
-- ADDITIVE except for ONE swap: the per-company exact-match unique index on (company_id, employee_number) is dropped (the reservations below are the rule). Nothing is rewritten: every existing number stays exactly
-- as it is recorded, and no existing employee row is touched by this file.
-- Install order: audit (supabase/manual-sql/people_hr_employee_number_00_audit_readonly.sql: read it, decide, correct), preflight (..._05_preflight_readonly.sql), this migration, verify (..._20_verify_readonly.sql),
-- then deploy the app. Rollback: ..._90_rollback.sql.
--
-- WHO THE RULE COVERS FROM TODAY. Employees who are ACTIVE or INVITED: not removed (deleted_at is null), not terminated, and whose login (if they have one) is not deactivated. A person with no login yet, or whose login
-- is invited, is covered. Records that are deleted, terminated or deactivated TODAY are ignored: they hold no reservation, are not looked at by the audit or the guard, and their numbers are not protected (they were test
-- accounts). The rule is not retroactive: no history is read.
--
-- THE RESERVATION RULE. employee_number_reservations holds one row per normalised number: which employee record it was first given to. It has NO foreign key to employees, so it survives a physical delete.
-- A number can be used only by the record it is reserved for. So, from now on:
--   * a new hire is numbered from the sequence, which never gives out a reserved number;
--   * a number typed by hand, supplied by a script or an import, or entered as a correction is refused when it is reserved for another record, whether that record is live, terminated, removed, deleted for good,
--     or once held the number and was corrected to another;
--   * CORRECTING a number keeps the old one reserved for the same record (it is never freed for anyone else); a record may return to a number that was reserved for it;
--   * removing, restoring, terminating, deactivating, reactivating or rehiring the SAME record never changes its number (rehire = the same record: the original number comes back with it); creating a second record for the
--     same person gives the second record a new number;
--   * physically deleting a record never releases its number;
--   * bringing back an ignored record (restored, rehired, login reactivated) claims its number if nobody holds it, and is refused, with a sentence, if it is reserved for another employee.
-- This supersedes migration 20261023000000, which let a removed employee's number be reused.
--
-- THIS MIGRATION REFUSES TO RUN (and changes nothing: the guard comes first and the file is one transaction) WHILE TWO ACTIVE OR INVITED EMPLOYEES, IN ANY COMPANIES, HAVE EQUIVALENT NUMBERS. Before this change each company
-- had its own series, so such pairs can exist today. The audit pack lists every one for review. Nothing here decides which employee owns a number: that is a correction the owner approves one employee at a time,
-- then the migration is applied.
--
-- THE POOL (what automatic numbering hands out FIRST). The deleted, terminated and deactivated test accounts ignored at this rollout still show numbers. Once, here, the E-series numbers they show are collected into
-- employee_number_pool: normalised (E2, e002 and E002 are one number), deduplicated, and without any number an active or invited employee holds (so a number like E003 held by a live employee can never be in it). A new
-- hire is given the LOWEST pool number that is still free, claimed atomically across all companies (rows another hire has locked are skipped, so two hires at once get different numbers), and it is then reserved for that
-- employee permanently, even if they later leave. When the pool is empty the shared sequence below takes over. The pool is built ONCE and never rebuilt: a person who is deleted, terminated or deactivated AFTER this
-- rollout does not add their number to it (their number stays reserved). Gaps in the numbering outside the pool are left alone. Only E-series numbers (E plus digits) enter the pool; a test account's L-001 does not.
--
-- THE RULE (one function, shared with the app and tested against the same vectors: supabase/tests/employee-number-vectors.json): trim, remove every space, upper-case; if the number ends in digits drop
-- their leading zeros and pad back to at least three digits. E2, E02, e002 and " E 0002 " are all E002; E1234 stays E1234; a number with no trailing digits is only trimmed and upper-cased.
--
-- THE SEQUENCE FALLBACK (when the pool is empty). employee_number_seq. The next number is E + the next value, with at least three digits and NO truncation after E999 (E1000, E1001, ...). The sequence is started ABOVE the highest E-number held by an
-- active or invited employee and only moves forward; a number taken from it is never given out again, even if the hire fails (the sequence is not rolled back). It also skips every reserved number and every number an
-- active or invited employee shows. Every other number is available, including one an ignored (deleted, terminated or deactivated) test record still shows. Two hires saved at the same moment, in any companies,
-- take different values (nextval is atomic).
--
-- WRITES. A trigger gives a NEW employee with no number the next number, saves a supplied or CHANGED number in canonical form, refuses a blank one, and reserves it. An UPDATE that does not change the number never
-- touches it, so existing numbers stay as recorded until someone deliberately changes one. A refusal is a plain sentence that names no one; the reservation table's key decides a race between two writes.
--
-- THE NUMBER BELONGS TO THE EMPLOYEE RECORD. Nothing in this file looks at roles, grants or companies of access: giving a person access to several companies never creates an employee row or takes a number.
--
-- RE-RUNNABLE: create or replace / if not exists / drop if exists; reservations are only ever added and the sequence is only ever moved forward.

create or replace function employee_number_canonical(p_number text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when s !~ '[0-9]$' then s
    else regexp_replace(s, '[0-9]+$', '')
         || case when length(ltrim(substring(s from '[0-9]+$'), '0')) >= 3 then ltrim(substring(s from '[0-9]+$'), '0')
                 else lpad(ltrim(substring(s from '[0-9]+$'), '0'), 3, '0') end
  end
  from (select upper(regexp_replace(coalesce(p_number, ''), '\s+', '', 'g')) as s) n;
$$;
revoke all on function employee_number_canonical(text) from public, anon;
grant execute on function employee_number_canonical(text) to authenticated;

-- Who is covered: an ACTIVE or INVITED employee (not removed, not terminated, login not deactivated). Internal.
create or replace function employee_number_in_scope(p_deleted_at timestamptz, p_status employment_status, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_deleted_at is null
     and p_status <> 'terminated'
     and not exists (select 1 from profiles p where p.id = p_user_id and p.account_status = 'deactivated');
$$;
revoke all on function employee_number_in_scope(timestamptz, employment_status, uuid) from public, anon, authenticated;

-- The guard: refuse, changing nothing, while any two ACTIVE or INVITED employees (any companies) have equivalent numbers. Deleted, terminated and deactivated records are not looked at.
do $$
declare
  v_groups integer;
  v_people integer;
begin
  select count(*), coalesce(sum(n), 0) into v_groups, v_people
  from (
    select count(*) as n from employees
    where employee_number_canonical(employee_number) <> '' and employee_number_in_scope(deleted_at, employment_status, user_id)
    group by employee_number_canonical(employee_number) having count(*) > 1
  ) g;
  if v_groups > 0 then
    raise exception 'STOP: % group(s) of equivalent employee numbers (% active or invited employees) exist across the companies. Run supabase/manual-sql/people_hr_employee_number_00_audit_readonly.sql, resolve each one with the owner''s approval, then apply this migration again. Nothing was changed.', v_groups, v_people;
  end if;
end $$;

-- The permanent reservations. No foreign key: a number stays reserved after its record is deleted for good. Nobody but the database's own functions can read or write it.
create table if not exists employee_number_reservations (
  number_key   text primary key,                      -- employee_number_canonical(...)
  employee_id  uuid not null,                         -- the record the number belongs to (may no longer exist)
  first_number text not null,                         -- the spelling it was first recorded in
  source       text not null check (source in ('existing record', 'assigned', 'entered', 'corrected')),
  reserved_at  timestamptz not null default now()
);
create index if not exists idx_employee_number_reservations_employee on employee_number_reservations(employee_id);
alter table employee_number_reservations enable row level security;
revoke all on table employee_number_reservations from public, anon, authenticated;

-- Reserve the number each ACTIVE or INVITED employee holds today, for that employee. Nothing is rewritten. Ignored records (deleted, terminated, deactivated) get no reservation.
insert into employee_number_reservations (number_key, employee_id, first_number, source)
select employee_number_canonical(employee_number), id, employee_number, 'existing record'
from employees
where employee_number_canonical(employee_number) <> '' and employee_number_in_scope(deleted_at, employment_status, user_id)
on conflict (number_key) do nothing;

-- The pool of numbers automatic numbering hands out first, and the one-row record that it was built. The pool is built ONCE (the record's presence stops any later build), from the records that are ignored NOW.
create table if not exists employee_number_pool (
  number_key   text primary key,                      -- employee_number_canonical(...), E plus digits only
  number_value bigint not null,                       -- the digits, for the allocation order
  claimed_by   uuid,                                  -- the employee it was given to (the reservation is what keeps it theirs for good)
  claimed_at   timestamptz
);
create table if not exists employee_number_allocation (
  id             boolean primary key default true check (id),   -- exactly one row
  pool_built_at  timestamptz not null default now(),
  pool_size      integer not null,                    -- how many numbers the pool held when it was built
  sequence_start bigint not null                      -- the highest reserved E-number at rollout: the sequence fallback starts above it
);
alter table employee_number_pool enable row level security;
alter table employee_number_allocation enable row level security;
revoke all on table employee_number_pool, employee_number_allocation from public, anon, authenticated;
do $$
declare
  v_top bigint;
begin
  if exists (select 1 from employee_number_allocation) then return; end if;   -- built once: never rebuilt
  insert into employee_number_pool (number_key, number_value)
  select s.k, s.v
  from (
    select distinct employee_number_canonical(e.employee_number) as k,
           substring(employee_number_canonical(e.employee_number) from '^E([0-9]+)$')::bigint as v
    from employees e
    where employee_number_canonical(e.employee_number) ~ '^E[0-9]{1,15}$'
      and not employee_number_in_scope(e.deleted_at, e.employment_status, e.user_id)
  ) s
  where not exists (select 1 from employee_number_reservations r where r.number_key = s.k)
    and not exists (select 1 from employees h where employee_number_canonical(h.employee_number) = s.k and employee_number_in_scope(h.deleted_at, h.employment_status, h.user_id))
  on conflict (number_key) do nothing;
  select coalesce(max(substring(number_key from '^E([0-9]+)$')::bigint), 0) into v_top
  from employee_number_reservations where number_key ~ '^E[0-9]{1,15}$';
  insert into employee_number_allocation (pool_size, sequence_start) values ((select count(*) from employee_number_pool), v_top);
end $$;

-- The series. Started above the highest E-number any reservation holds; only ever moved forward, so applying this file again never lowers it.
create sequence if not exists employee_number_seq as bigint minvalue 1;
revoke all on sequence employee_number_seq from public, anon, authenticated;
do $$
declare
  v_max bigint;
  v_last bigint;
  v_called boolean;
begin
  select coalesce(max(substring(number_key from '^E([0-9]+)$')::bigint), 0) into v_max
  from employee_number_reservations where number_key ~ '^E[0-9]{1,15}$';
  select last_value, is_called into v_last, v_called from employee_number_seq;
  v_last := case when v_called then v_last else 0 end;   -- (not inline in the IF: PL/pgSQL would cut a CASE at its own THEN)
  if v_max > v_last then
    perform setval('employee_number_seq', v_max, true);
  end if;
end $$;

-- The per-company exact-match index is replaced by the reservations (global, permanent, and blind to the ignored records, which a unique index on the table could not be).
drop index if exists employees_company_employee_number_unique;

-- The next number for a NEW employee: the lowest still-free number of the pool, claimed atomically across all companies; when the pool is empty, the next free number of the shared sequence. SECURITY DEFINER because the
-- caller (HR Admin through the app) has no right to the pool, the sequence or the reservations. The claim is part of the hiring transaction: if the hire fails, the pool number goes back.
-- "Skip locked": two hires at the same moment each take a different row (the lowest not being claimed by the other); a pool number somebody has since reserved by hand, or an active or invited employee shows, is skipped.
create or replace function next_employee_number(p_employee_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v bigint;
  n text;
begin
  select p.number_key into v_key
  from employee_number_pool p
  where p.claimed_by is null
    and not exists (select 1 from employee_number_reservations r where r.number_key = p.number_key)
    and not exists (select 1 from employees e where employee_number_canonical(e.employee_number) = p.number_key and employee_number_in_scope(e.deleted_at, e.employment_status, e.user_id))
  order by p.number_value
  limit 1
  for update of p skip locked;
  if v_key is not null then
    update employee_number_pool set claimed_by = p_employee_id, claimed_at = now() where number_key = v_key;
    return v_key;
  end if;
  loop
    v := nextval('employee_number_seq');
    n := 'E' || case when length(v::text) >= 3 then v::text else lpad(v::text, 3, '0') end;
    exit when not exists (select 1 from employee_number_reservations where number_key = n)
          and not exists (select 1 from employees where employee_number_canonical(employee_number) = n and employee_number_in_scope(deleted_at, employment_status, user_id));
  end loop;
  return n;
end;
$$;
drop function if exists next_employee_number();
revoke all on function next_employee_number(uuid) from public, anon, authenticated;

-- Reserve a number for a record, or refuse when it is reserved for another one. A refusal names no one: the other employee may belong to a company the writer cannot see. Internal.
create or replace function employee_number_claim(p_employee_id uuid, p_number text, p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := employee_number_canonical(p_number);
  v_owner uuid;
begin
  if v_key = '' then return; end if;
  insert into employee_number_reservations (number_key, employee_id, first_number, source)
  values (v_key, p_employee_id, p_number, p_source)
  on conflict (number_key) do nothing;
  select employee_id into v_owner from employee_number_reservations where number_key = v_key;
  if v_owner is distinct from p_employee_id then
    raise exception 'Employee number % is reserved for another employee (current, removed or former), in this or another company. Numbers that differ only in capitals, spaces or leading zeros are the same number, and a number is never reused. Use a different number.', v_key
      using errcode = '23505', constraint = 'employee_number_reservations_pkey';
  end if;
end;
$$;
revoke all on function employee_number_claim(uuid, text, text) from public, anon, authenticated;

create or replace function employees_save_canonical_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if employee_number_canonical(new.employee_number) = '' then
      new.employee_number := next_employee_number(new.id);
      perform employee_number_claim(new.id, new.employee_number, 'assigned');
    else
      new.employee_number := employee_number_canonical(new.employee_number);
      perform employee_number_claim(new.id, new.employee_number, 'entered');
    end if;
  elsif new.employee_number is distinct from old.employee_number then
    -- a CHANGED number: saved canonically, never blank, reserved for this record; the old number stays reserved for it too (nothing here releases a reservation)
    new.employee_number := employee_number_canonical(new.employee_number);
    if new.employee_number = '' then raise exception 'Enter the employee number.' using errcode = '23514'; end if;
    perform employee_number_claim(new.id, new.employee_number, 'corrected');
  elsif employee_number_in_scope(new.deleted_at, new.employment_status, new.user_id)
        and not employee_number_in_scope(old.deleted_at, old.employment_status, old.user_id) then
    -- an ignored record is BROUGHT BACK (restored, rehired): it keeps its number if nobody else has it, and is refused with a sentence if the number is reserved for another employee
    perform employee_number_claim(new.id, new.employee_number, 'existing record');
  end if;
  return new;
end;
$$;
revoke all on function employees_save_canonical_number() from public, anon, authenticated;
drop trigger if exists employees_canonical_number on employees;
create trigger employees_canonical_number before insert or update of employee_number, deleted_at, employment_status on employees
  for each row execute function employees_save_canonical_number();

-- A deactivated LOGIN is reactivated: the employee records linked to it come back into scope, so their numbers are claimed the same way (refused with a sentence if reserved for another employee).
create or replace function profiles_reactivation_number_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if old.account_status = 'deactivated' and new.account_status <> 'deactivated' then
    for r in select id, employee_number from employees where user_id = new.id and deleted_at is null and employment_status <> 'terminated' loop
      perform employee_number_claim(r.id, r.employee_number, 'existing record');
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function profiles_reactivation_number_check() from public, anon, authenticated;
drop trigger if exists profiles_employee_number_reactivation on profiles;
create trigger profiles_employee_number_reactivation before update of account_status on profiles
  for each row execute function profiles_reactivation_number_check();
