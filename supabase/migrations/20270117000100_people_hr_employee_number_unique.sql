-- Employee numbers: ONE shared series across every Enginious company (UAE, Saudi Arabia, Europe). Equivalent numbers (E02, e002, E002) are one number, unique across ALL companies, saved in
-- canonical form, and a NEW hire's number is assigned by the database from one sequence (E001, E002, ...).
-- ADDITIVE except for ONE swap: the per-company exact-match unique index on (company_id, employee_number) is replaced by one on the NORMALISED number across all companies. Nothing is rewritten: every
-- existing number stays exactly as it is recorded, and no existing employee row is touched by this file.
-- Install order: audit (supabase/manual-sql/people_hr_employee_number_00_audit_readonly.sql: read it, decide, correct), preflight (..._05_preflight_readonly.sql), this migration, verify (..._20_verify_readonly.sql),
-- then deploy the app. Rollback: ..._90_rollback.sql.
--
-- THIS MIGRATION REFUSES TO RUN (and changes nothing: the guard comes first and the file is one transaction) WHILE TWO LIVE EMPLOYEES, IN ANY COMPANIES, HAVE EQUIVALENT NUMBERS. Before this change each
-- company had its own series, so the same number can legitimately exist in two companies today; the audit pack lists every such group for review. Nothing here decides which employee owns a number: that
-- is a correction the owner approves one employee at a time, then the migration is applied.
--
-- WHAT COUNTS. "Live" is the scope of the old index: not soft-deleted (a terminated employee is still live and still holds the number). A removed employee's number stays reusable BY HAND, exactly as migration
-- 20261023000000 decided, so a removed row never blocks the index and is never audited as a blocker (the audit still lists it). It is never re-issued AUTOMATICALLY: the sequence only moves forward and also
-- skips any number any row, removed or not, holds. Restoring a removed employee whose number is now held by a live one is refused by this index.
--
-- THE RULE (one function, shared with the app and tested against the same vectors: supabase/tests/employee-number-vectors.json): trim, remove every space, upper-case; if the number ends in digits drop
-- their leading zeros and pad back to at least three digits. E2, E02, e002 and " E 0002 " are all E002; E1234 stays E1234; a number with no trailing digits is only trimmed and upper-cased.
--
-- THE SERIES. employee_number_seq. The next number is E + the next value, with at least three digits and NO truncation after E999 (E1000, E1001, ...). The sequence is started ABOVE the highest existing
-- E-number held by ANY employee (live, terminated or removed), and later hires continue from there. A number taken from the sequence is never given out again, even if the hire fails or is later removed
-- (the sequence is not rolled back). Two hires saved at the same moment, in any companies, take different values: nextval is atomic. A number typed by hand that the sequence later reaches is skipped.
--
-- WRITES. A trigger gives a NEW employee with no number the next number from the series, and saves a number that is supplied (a script, an import, SQL typed in an editor) or CHANGED in canonical form,
-- whatever path wrote it. An UPDATE that does not change the number never touches it, so existing numbers stay as recorded until someone deliberately changes one. A number cannot be blanked. A duplicate (or
-- the restore of a removed employee onto a number now held) is refused with a plain sentence that names no one; the unique index remains the guarantee and decides a race.
--
-- THE NUMBER BELONGS TO THE EMPLOYEE RECORD. Nothing in this file looks at roles, grants or companies of access: giving a person access to several companies never creates an employee row or takes a number.
--
-- RE-RUNNABLE: create or replace / if not exists / drop if exists; the sequence is only ever moved forward.

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

-- The guard: refuse, changing nothing, while live equivalent numbers exist ANYWHERE (all companies).
do $$
declare
  v_groups integer;
  v_people integer;
begin
  select count(*), coalesce(sum(n), 0) into v_groups, v_people
  from (select count(*) as n from employees where deleted_at is null group by employee_number_canonical(employee_number) having count(*) > 1) g;
  if v_groups > 0 then
    raise exception 'STOP: % group(s) of equivalent employee numbers (% live employees) exist across the companies. Run supabase/manual-sql/people_hr_employee_number_00_audit_readonly.sql, resolve each one with the owner''s approval, then apply this migration again. Nothing was changed.', v_groups, v_people;
  end if;
end $$;

-- The series. Started above the highest existing E-number of ANY employee (live, terminated or removed); only ever moved forward, so applying this file again never lowers it.
create sequence if not exists employee_number_seq as bigint minvalue 1;
revoke all on sequence employee_number_seq from public, anon, authenticated;
do $$
declare
  v_max bigint;
  v_last bigint;
  v_called boolean;
begin
  select coalesce(max(substring(employee_number_canonical(employee_number) from '^E([0-9]+)$')::bigint), 0) into v_max
  from employees where employee_number_canonical(employee_number) ~ '^E[0-9]{1,15}$';
  select last_value, is_called into v_last, v_called from employee_number_seq;
  v_last := case when v_called then v_last else 0 end;   -- (not inline in the IF: PL/pgSQL would cut a CASE at its own THEN)
  if v_max > v_last then
    perform setval('employee_number_seq', v_max, true);
  end if;
end $$;

-- Uniqueness on the normalised number across ALL companies, among live rows (the old index's scope). The per-company exact-match index it replaces is implied by this one.
create unique index if not exists employees_employee_number_canonical_unique
  on employees (employee_number_canonical(employee_number)) where deleted_at is null;
drop index if exists employees_company_employee_number_unique;

-- The next free number of the series. SECURITY DEFINER because the caller (HR Admin through the app) has no right to the sequence and must see EVERY row, removed ones included, to skip numbers they hold.
create or replace function next_employee_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v bigint;
  n text;
begin
  loop
    v := nextval('employee_number_seq');
    n := 'E' || case when length(v::text) >= 3 then v::text else lpad(v::text, 3, '0') end;
    exit when not exists (select 1 from employees where employee_number_canonical(employee_number) = n);
  end loop;
  return n;
end;
$$;
revoke all on function next_employee_number() from public, anon, authenticated;

create or replace function employees_save_canonical_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if tg_op = 'INSERT' then
    if employee_number_canonical(new.employee_number) = '' then
      new.employee_number := next_employee_number();
    else
      new.employee_number := employee_number_canonical(new.employee_number);
    end if;
  elsif new.employee_number is distinct from old.employee_number then
    new.employee_number := employee_number_canonical(new.employee_number);
    if new.employee_number = '' then raise exception 'Enter the employee number.' using errcode = '23514'; end if;
  end if;

  -- A clear sentence instead of an index name, on every path that writes a number (a new employee, a corrected number) and on RESTORING a removed employee. The unique index remains the guarantee (it also
  -- decides a race between two writes); this only gives the usual refusal its words. It names no one: the other employee may belong to a company the writer cannot see.
  v_key := employee_number_canonical(new.employee_number);
  if new.deleted_at is null
     and (tg_op = 'INSERT' or new.employee_number is distinct from old.employee_number or old.deleted_at is not null)
     and exists (select 1 from employees e where e.id <> new.id and e.deleted_at is null and employee_number_canonical(e.employee_number) = v_key) then
    if tg_op = 'UPDATE' and old.deleted_at is not null then
      raise exception 'This employee cannot be restored: employee number % is now used by another employee, in this or another company. Numbers that differ only in capitals, spaces or leading zeros are the same number.', v_key
        using errcode = '23505', constraint = 'employees_employee_number_canonical_unique';
    end if;
    raise exception 'Employee number % is already used by another employee, in this or another company. Numbers that differ only in capitals, spaces or leading zeros are the same number, and one number belongs to one employee across Enginious. Use a different number.', v_key
      using errcode = '23505', constraint = 'employees_employee_number_canonical_unique';
  end if;
  return new;
end;
$$;
revoke all on function employees_save_canonical_number() from public, anon, authenticated;
drop trigger if exists employees_canonical_number on employees;
create trigger employees_canonical_number before insert or update of employee_number, deleted_at on employees
  for each row execute function employees_save_canonical_number();
