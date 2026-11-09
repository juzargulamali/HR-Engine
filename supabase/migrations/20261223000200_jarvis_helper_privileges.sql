-- JARVIS corrective migration: the four internal ledger helpers must not be callable by the platform's service role.
-- Run AFTER 20261223000100_jarvis_platform.sql (which is already applied on hosted V2 and is NOT edited). Changes privileges only: no table, no function body, no data.
--
-- WHAT WENT WRONG. Supabase stamps EXECUTE for anon, authenticated and service_role onto every function created in `public` (default privileges of the roles
-- postgres and supabase_admin). Migration 20261223000100 took that back from public, anon and authenticated for the four internal helpers, and from service_role for the
-- three proof functions, but NOT from service_role for jarvis_ledger_json / _enter / _done / _fail. The read-only verifier found exactly these four ("FAIL - callable or
-- missing"); the hosted diagnostic (jarvis_10_execute_privileges_readonly.sql) showed one explicit ACL entry: service_role, granted by postgres. A plain Postgres test
-- database has no such default privileges, so the earlier local rehearsal could not see it.
--
-- IMPACT BEFORE THIS FIX (why it was a verifier failure and not a data-exposure incident): the helpers read auth.uid(), which is null for a service-role call, so
-- jarvis_ledger_enter refuses ("Not signed in") and _done/_fail only update ledger rows owned by auth.uid(). Still, a helper must only be reachable from the wrappers
-- (which run as their owner), so the grant is removed.
--
-- WHAT THIS DOES. For each of the four helpers: revoke EXECUTE from PUBLIC, anon, authenticated, service_role and from any other non-owner role found in its ACL; then
-- check the result and ABORT the whole migration (nothing is kept) if any role other than the owner can still execute it.
-- WHAT IT DOES NOT TOUCH: the seven wrappers, jarvis_my_access and jarvis_usage_take (still executable by authenticated only, as before; their ACLs are left exactly
-- as they are), the proof machinery, the tables, the global default privileges of the platform (not ours to change), and every non-JARVIS object.
-- Safe to run twice. Never sets the proof key and never enables JARVIS.
--
-- ROLLBACK: nothing to roll back in the schema. To undo only this migration (not recommended: it re-opens the helpers to the service role) run, as the owner:
--   grant execute on function jarvis_ledger_json(jarvis_action_ledger, boolean), jarvis_ledger_enter(uuid, text, text, uuid, text),
--     jarvis_ledger_done(uuid, uuid, text, jsonb), jarvis_ledger_fail(uuid, text, text) to service_role;
-- (supabase/manual-sql/jarvis_90_rollback.sql drops the helpers together with everything else JARVIS.)

do $$
declare
  v_helpers constant text[] := array[
    'public.jarvis_ledger_json(public.jarvis_action_ledger, boolean)',
    'public.jarvis_ledger_enter(uuid, text, text, uuid, text)',
    'public.jarvis_ledger_done(uuid, uuid, text, jsonb)',
    'public.jarvis_ledger_fail(uuid, text, text)'
  ];
  v_sig text;
  v_oid oid;
  v_role record;
  v_left text;
begin
  foreach v_sig in array v_helpers loop
    v_oid := to_regprocedure(v_sig)::oid;
    if v_oid is null then
      raise exception 'JARVIS helper % does not exist: apply 20261223000100_jarvis_platform.sql first', v_sig using errcode = '42883';
    end if;

    execute format('revoke all on function %s from public', v_oid::regprocedure);
    -- every other grantee in the ACL (anon, authenticated, service_role, and anything the platform or an earlier step added), except the owner itself
    for v_role in
      select distinct a.grantee
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_oid and a.grantee <> 0 and a.grantee <> p.proowner
    loop
      execute format('revoke all on function %s from %I', v_oid::regprocedure, pg_get_userbyid(v_role.grantee));
    end loop;

    -- fail closed: nobody but the owner may be left with EXECUTE (a grant made by another grantor cannot be removed from here: abort and say so)
    select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ', ') into v_left
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_oid and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
    if v_left is not null then
      raise exception 'JARVIS helper % can still be executed by: % (a grant by another grantor? revoke it as that grantor, then run this migration again)', v_sig, v_left using errcode = '42501';
    end if;
  end loop;
end $$;
