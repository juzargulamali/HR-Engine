-- READ-ONLY. Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the migration 20261217000100_inv_project_notes.sql.
-- Run the WHOLE file; it returns ONE table (check | item | result | detail). Every row of the "result" column must say OK (or INFO, which is information only).
-- A row that says FAIL means stop and send me the whole result. It creates, changes and deletes nothing.
--
--   1  the functions exist, are SECURITY DEFINER with a fixed search path; the added ones are callable by signed-in users and NOT by anonymous visitors; the internal
--      helpers are callable by nobody signed in
--   2  the new rule is in the function text AND every earlier protection is still there
--   3  the privilege / policy part of the change, where this migration has one
--
-- It checks DEFINITIONS and PRIVILEGES. It cannot call a function without writing or acting as a person, so the behaviour is proved by the repository's database tests
-- (packages/rls-tests/test/inventory_project_notes.rls.test.ts) and, on this project, by the first real use (see the deployment guide).

with
fns(name) as (values ('inv_next_code'), ('inv_dispatch_to_project'), ('inv_return_from_project'), ('inv_project_notes_frozen'), ('inv_project_notes_enabled'), ('inv_make_project_note'), ('inv_ack_project_note'), ('inv_resolve_note_difference'), ('inv_notes_waiting_for_me'), ('inv_set_project_notes')),
fn as (select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select name from fns)),
needs(fname, kind, label, needle) as (values
  ('inv_next_code', 'N', 'dispatch notes are lettered D', 'when ''dispatch_note'' then ''D'''),
  ('inv_next_code', 'N', 'return checklists are lettered RT', 'when ''return_note'' then ''RT'''),
  ('inv_next_code', 'E', 'the earlier kinds keep their letters', 'when ''movement'' then ''M'' when ''count'' then ''C'''),
  ('inv_next_code', 'E', 'a company with no reference code still gets the same refusal', 'An Inventory reference code has not been set for this company yet'),
  ('inv_next_code', 'E', 'numbers come from the locked counter row', 'on conflict (company_id, kind) do update set last_value = inv_reference_counters.last_value + 1'),
  ('inv_dispatch_to_project', 'N', 'the note is made only when the company switched it on', 'if inv_project_notes_enabled(p_company_id) then v_note := inv_make_project_note(v_mid); end if;'),
  ('inv_dispatch_to_project', 'E', 'an expected return date is still required', 'Say when the equipment is expected back'),
  ('inv_dispatch_to_project', 'E', 'a past return date is still refused', 'The expected return date must be in the future'),
  ('inv_dispatch_to_project', 'E', 'a unit reserved for another request is still refused', 'is reserved for % in that period. Dispatch it against that request, or choose another unit'),
  ('inv_dispatch_to_project', 'E', 'free stock is still checked', 'is free until'),
  ('inv_dispatch_to_project', 'E', 'the cross-company sharing check is still there', 'inv_check_sharing(i.company_id, pr.company_id)'),
  ('inv_dispatch_to_project', 'E', 'the request''s reservation is still consumed', 'inv_reservation_take(q.id, u.item_id, u.id, 1, null)'),
  ('inv_dispatch_to_project', 'E', 'the movement result is still stored against the key', 'return inv_finish_movement(p_company_id, p_key'),
  ('inv_return_from_project', 'N', 'the note is made only when the company switched it on', 'if inv_project_notes_enabled(p_company_id) then v_note := inv_make_project_note(v_mid); end if;'),
  ('inv_return_from_project', 'E', 'equipment never sent to the project is still refused', 'was not dispatched to project'),
  ('inv_return_from_project', 'E', 'a condition is still required for every line', 'inv_valid_condition(e->>''condition'')'),
  ('inv_return_from_project', 'E', 'reservations are still returned', 'inv_reservation_return(pr.id, u.item_id, u.id, 1)'),
  ('inv_return_from_project', 'E', 'the request status is still refreshed', 'inv_refresh_project_requests(pr.id)'),
  ('inv_make_project_note', 'N', 'a failure refuses the whole movement and says so', 'could not be made, so nothing was recorded'),
  ('inv_make_project_note', 'N', 'one note per movement: a second call returns the existing note', 'select * into ex from inv_project_notes where movement_id = m.id'),
  ('inv_make_project_note', 'N', 'the number is taken from the warehouse company''s own counter', 'inv_next_code(m.company_id'),
  ('inv_make_project_note', 'N', 'a return checklist freezes the project totals from the ledger', 'returned_before'),
  ('inv_make_project_note', 'N', 'only a dispatch or a return has a note', 'Only a dispatch to a project or a return from one has a note'),
  ('inv_ack_project_note', 'N', 'who may answer is decided in the database at the moment of the call', 'proj_is_pm(n.project_id)'),
  ('inv_ack_project_note', 'N', 'a Projects founder may answer on behalf, and the capacity is recorded', 'proj_is_founder(pr.company_id)'),
  ('inv_ack_project_note', 'N', 'an acting PM is recorded as such (the period is checked by proj_is_pm)', '''acting_pm'''),
  ('inv_ack_project_note', 'N', 'everyone else is refused', 'Only the project''''s Project Manager, an acting Project Manager or a Projects founder can answer this note'),
  ('inv_ack_project_note', 'N', 'a replaced note cannot be answered', 'has been replaced by a newer note'),
  ('inv_ack_project_note', 'N', 'a second click returns the original acknowledgement', '''replayed'', true'),
  ('inv_ack_project_note', 'N', 'a retried key replays the original answer', 'inv_idem_begin(n.company_id, p_key, ''note_action'''),
  ('inv_resolve_note_difference', 'N', 'only an operator at the location that recorded the note', 'inv_can_operate(n.location_id)'),
  ('inv_resolve_note_difference', 'N', 'only while Inventory is on', 'inv_require_enabled(n.company_id)'),
  ('inv_resolve_note_difference', 'N', 'a correction is a new note citing the old one', 'inv_make_project_note(lm.id, n.id)'),
  ('inv_resolve_note_difference', 'N', 'the resolution is appended as an event, the old note is not touched', '''resolved_corrected'''),
  ('inv_resolve_note_difference', 'N', 'a comment is required', 'Say what the warehouse found, in the comment'),
  ('inv_notes_waiting_for_me', 'N', 'only notes the caller can answer now', 'proj_can_manage(s.project_id)'),
  ('inv_set_project_notes', 'N', 'only an Inventory founder', 'inv_is_founder(p_company_id)'),
  ('inv_project_notes_enabled', 'N', 'reads the per-company switch, off when there is no row', 's.project_notes_enabled'),
  ('inv_project_notes_frozen', 'N', 'nothing about a note or its history is ever edited or deleted', 'never edited or deleted')
),
checks as (
  select 1 as grp, 'function exists' as chk, e.name as item, case when f.oid is not null then 'OK' else 'FAIL' end as result, '' as detail
  from fns e left join fn f on f.proname = e.name where e.name <> '__none__'
  union all
  select 1, 'security definer with a fixed search path', f.proname,
         case when f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public%' then 'OK' else 'FAIL' end, coalesce(f.proconfig::text, 'no search_path set')
  from fn f where f.proname not in ('inv_project_notes_frozen')
  union all
  select 1, 'signed-in users can call it, anonymous visitors cannot', f.proname,
         case when has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f where f.proname in ('inv_ack_project_note', 'inv_resolve_note_difference', 'inv_notes_waiting_for_me', 'inv_set_project_notes')
  union all
  select 1, 'internal helper: callable by nobody signed in', f.proname,
         case when not has_function_privilege('authenticated', f.oid, 'execute') and not has_function_privilege('anon', f.oid, 'execute') then 'OK' else 'FAIL' end,
         'authenticated ' || has_function_privilege('authenticated', f.oid, 'execute')::text || ', anon ' || has_function_privilege('anon', f.oid, 'execute')::text
  from fn f where f.proname in ('inv_project_notes_enabled', 'inv_make_project_note', 'inv_project_notes_frozen')
  union all
  select 2, case n.kind when 'N' then 'new rule present' else 'earlier protection still present' end, n.fname || ': ' || n.label,
         case when f.oid is null then 'FAIL' when position(n.needle in f.prosrc) > 0 then 'OK' else 'FAIL' end,
         case when f.oid is null then 'function missing' when position(n.needle in f.prosrc) > 0 then '' else 'text not found: ' || n.needle end
  from needs n left join fn f on f.proname = n.fname where n.fname <> '__none__'
  union all
  select 1, 'signed-in users can call it, anonymous visitors cannot', 'inv_dispatch_to_project / inv_return_from_project (unchanged)', (case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('inv_dispatch_to_project', 'inv_return_from_project') and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 2 then 'OK' else 'FAIL' end), ('')
  union all
  select 1, 'internal helper: callable by nobody signed in', 'inv_next_code (unchanged)', (case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_next_code' and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 1 then 'OK' else 'FAIL' end), ('')
  union all
  select 3, 'tables', 'inv_project_notes, inv_project_note_events and the status view exist', (case when to_regclass('public.inv_project_notes') is not null and to_regclass('public.inv_project_note_events') is not null and to_regclass('public.inv_project_note_status') is not null then 'OK' else 'FAIL' end), ('')
  union all
  select 3, 'row-level security', 'enabled on both tables', (case when (select count(*) from pg_class where oid in ('public.inv_project_notes'::regclass, 'public.inv_project_note_events'::regclass) and relrowsecurity) = 2 then 'OK' else 'FAIL' end), ('')
  union all
  select 3, 'policies', 'each table has exactly one policy, a SELECT that lets project members and warehouse readers in', (case when (select count(*) from pg_policies where schemaname = 'public' and tablename in ('inv_project_notes', 'inv_project_note_events')) = 2 and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('inv_project_notes', 'inv_project_note_events') and cmd = 'SELECT' and qual like '%proj_can_view_details%' and qual like '%inv_can_view_stock%') = 2 then 'OK' else 'FAIL' end), ('')
  union all
  select 3, 'guard triggers', 'frozen content and append-only history: update / delete and truncate are refused on both tables', (case when (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid in ('public.inv_project_notes'::regclass, 'public.inv_project_note_events'::regclass) and t.tgfoid = 'public.inv_project_notes_frozen()'::regprocedure and t.tgtype & 2 = 2 and ((t.tgtype & 8 = 8 and t.tgtype & 16 = 16 and t.tgtype & 1 = 1) or (t.tgtype & 32 = 32 and t.tgtype & 1 = 0))) = 4 then 'OK' else 'FAIL' end), ((select count(*)::text || ' guard triggers' from pg_trigger t where not t.tgisinternal and t.tgfoid = 'public.inv_project_notes_frozen()'::regprocedure))
  union all
  select 3, 'privileges', 'signed-in users can only SELECT the three objects (no insert, update, delete or truncate); anonymous visitors nothing', (case when coalesce((select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p where has_table_privilege('authenticated', 'public.inv_project_notes', p)), '') = 'SELECT' and (select count(*) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p where has_table_privilege('anon', 'public.inv_project_notes', p)) = 0 and coalesce((select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p where has_table_privilege('authenticated', 'public.inv_project_note_events', p)), '') = 'SELECT' and (select count(*) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p where has_table_privilege('anon', 'public.inv_project_note_events', p)) = 0 and coalesce((select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p where has_table_privilege('authenticated', 'public.inv_project_note_status', p)), '') = 'SELECT' and (select count(*) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p where has_table_privilege('anon', 'public.inv_project_note_status', p)) = 0 then 'OK' else 'FAIL' end), ((select string_agg(r || ': ' || coalesce(case r when 'inv_project_notes' then (select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p where has_table_privilege('authenticated', 'public.inv_project_notes', p)) when 'inv_project_note_events' then (select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p where has_table_privilege('authenticated', 'public.inv_project_note_events', p)) when 'inv_project_note_status' then (select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p where has_table_privilege('authenticated', 'public.inv_project_note_status', p)) end, 'none'), '; ') from unnest(array['inv_project_notes', 'inv_project_note_events', 'inv_project_note_status']) r))
  union all
  select 3, 'status view', 'is read under the caller''s own row-level security (security_invoker)', (case when exists (select 1 from pg_class where oid = 'public.inv_project_note_status'::regclass and coalesce(reloptions::text, '') like '%security_invoker=true%') then 'OK' else 'FAIL' end), ('')
  union all
  select 3, 'switch', 'inv_company_settings.project_notes_enabled exists, is NOT NULL and defaults to false (off)', (case when exists (select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.inv_company_settings'::regclass and a.attname = 'project_notes_enabled' and a.attnotnull and pg_get_expr(d.adbin, d.adrelid) = 'false') then 'OK' else 'FAIL' end), ('')
  union all
  select 3, 'switch', 'companies that have it ON right now (information: the owner turns it on, one company at a time)', ('INFO'), ((select coalesce(string_agg(s.reference_code, ', '), 'none') from inv_company_settings s where s.project_notes_enabled))
  union all
  select 3, 'counters', 'the kind check accepts dispatch_note and return_note and still accepts every earlier kind', (case when (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.inv_reference_counters'::regclass and c.conname = 'inv_reference_counters_kind_check') ~ 'dispatch_note.*return_note|return_note.*dispatch_note' and (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.inv_reference_counters'::regclass and c.conname = 'inv_reference_counters_kind_check') ~ 'unit.*stock.*request.*transfer.*movement.*count' then 'OK' else 'FAIL' end), ('')
  union all
  select 3, 'numbering', 'dispatch notes and return checklists have never been numbered twice (information)', (case when (select count(*) from (select note_no from inv_project_notes group by note_no having count(*) > 1) d) = 0 then 'OK' else 'FAIL' end), ((select count(*)::text || ' notes issued' from inv_project_notes))
)
select chk as "check", item, result, detail from (
  select grp, chk, item, result, detail from checks
  union all select 9, 'SUMMARY', '', case when exists (select 1 from checks where result = 'FAIL')
         then 'FAIL: ' || (select count(*) from checks where result = 'FAIL') || ' check(s) failing, see above'
         else 'OK: ' || (select count(*) from checks) || ' checks, 0 failing' end, ''
) r
order by grp, chk, item;
