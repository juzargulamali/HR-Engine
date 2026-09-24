-- Phase 2 correction: revokeRole() previously did a plain read-then-update
-- from application code, with no protection against two destructive
-- outcomes: a Sys Admin revoking their own role grant (accidental
-- self-lockout), or revoking the last active sys_admin grant system-wide
-- (leaving nobody able to manage users or roles at all, including via this
-- same admin surface). Neither check was atomic, and — because they lived
-- in application code, not the database — a direct authenticated UPDATE via
-- PostgREST could bypass them entirely, the same gap the `user_roles_select_own`
-- comment above already calls out for reads.
--
-- Fixed here at the database layer with a single guarded RPC:
--   - Both rules are enforced inside one SECURITY DEFINER function, so the
--     read and the write are one atomic operation from the caller's view.
--   - A global advisory lock (released automatically at transaction end)
--     serializes every call to this function, so two concurrent revocations
--     of two DIFFERENT sys_admin grants can't each read "2 remaining" before
--     either commits and both proceed — the second call's count check runs
--     only after the first's write has committed and become visible.
--   - The old FOR ALL policy is split into insert/delete-only for
--     `authenticated`; there is deliberately no UPDATE policy left at all,
--     and UPDATE is explicitly revoked from `authenticated`/`anon` too
--     (belt-and-braces, same pattern as audit_log's own revoke below it) —
--     a direct authenticated UPDATE of user_roles.revoked_at is now denied
--     outright, not merely discouraged. revoke_role_grant() itself runs as
--     SECURITY DEFINER and is unaffected by this, same as every other
--     guarded write in this schema (e.g. permanently_delete_employee()).

drop policy if exists user_roles_write_sysadmin on user_roles;

create policy user_roles_insert_sysadmin on user_roles for insert
  with check (has_role('sys_admin'));

create policy user_roles_delete_sysadmin on user_roles for delete
  using (has_role('sys_admin'));

revoke update on user_roles from authenticated, anon;

create or replace function revoke_role_grant(p_role_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role app_role;
  v_active_sysadmins bigint;
begin
  if auth.uid() is null or not has_role('sys_admin') then
    raise exception 'Only a System Administrator may revoke a role grant';
  end if;

  -- Held until this transaction ends (commit or rollback) — a concurrent
  -- call blocks here until the first one is fully done, so its count check
  -- below always sees the first call's committed result, never a stale
  -- pre-commit snapshot.
  perform pg_advisory_xact_lock(hashtext('user_roles:revoke_role_grant'));

  select user_id, role into v_user_id, v_role
  from user_roles
  where id = p_role_grant_id and revoked_at is null;

  if v_user_id is null then
    raise exception 'This role grant no longer exists';
  end if;

  -- Checked before the self-revocation guard below: when there's only one
  -- active sys_admin left, revoking it is necessarily a self-revoke (no
  -- other caller could pass the sys_admin check above), and the more
  -- specific "last admin" reason is the more useful one to surface.
  if v_role = 'sys_admin' then
    select count(*) into v_active_sysadmins from user_roles where role = 'sys_admin' and revoked_at is null;
    if v_active_sysadmins <= 1 then
      raise exception 'Can''t revoke the last System Administrator — the system would have nobody left to manage users or roles';
    end if;
  end if;

  if v_user_id = auth.uid() then
    raise exception 'You can''t revoke your own role — ask another System Administrator to do it';
  end if;

  update user_roles set revoked_at = now() where id = p_role_grant_id;
end;
$$;
