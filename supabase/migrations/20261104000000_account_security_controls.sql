-- =============================================================================
-- Account Control & Security Settings
--
-- Adds an account-status lifecycle to `profiles` (Invited/Active/Deactivated,
-- shown in the UI as "Deactivated — access suspended"), a guarded RPC for a
-- System Administrator to flip it, and one narrow, allowlisted RPC for the
-- handful of security/audit events that have no natural row mutation to hang
-- a trigger off (a password reset request from an unauthenticated visitor,
-- for instance, never touches any of our tables).
--
-- Design notes (see also docs/03-permission-matrix.md §3.6/§3.7):
--   - Account status/activation/password-reset-administration is treated as
--     the same class of action as "manage roles/user access" — Sys Admin
--     only, matching the existing gate on inviteUser/resendInvite/
--     deleteUserAccount and the /admin/* layout check. HR Admin is unchanged.
--   - The actual login-block is NOT this column — it's
--     auth.admin.updateUserById(userId, { ban_duration }) from the
--     application layer (lib/actions/account-status.ts), using Supabase's
--     supported Admin API rather than writing to the `auth` schema directly.
--     `account_status` here is the fast, RLS-visible mirror used for display,
--     filtering, and the audit trail. The two calls are ordered so a partial
--     failure always leans toward *less* access, never more: deactivate bans
--     first and only then marks this column 'deactivated' (worst case: still
--     shows Active, but the ban already blocks sign-in); reactivate marks
--     this column 'active' first and only then unbans (worst case: shows
--     Active but the ban hasn't lifted yet, so they still can't sign in).
--     Either way, a failed second step needs a retry, and neither retry is
--     destructive to repeat.
--   - invited -> active happens once, self-service, the moment someone
--     finishes /set-password or /reset-password — see profiles_self_activate
--     below. Nothing else can move a row into 'active' from 'invited'.
-- =============================================================================

create type account_status as enum ('invited', 'active', 'deactivated');

alter table profiles
  add column account_status account_status not null default 'invited',
  add column status_reason text,
  add column status_changed_by uuid references auth.users(id),
  add column status_changed_at timestamptz;

-- Existing rows predate this column and have already completed setup
-- (they're signing in today) — back-fill them to 'active' so the migration
-- doesn't retroactively brand every current user as "Invited".
update profiles set account_status = 'active';

-- ---- Self-activation: the ONLY update a plain authenticated user may make
-- to their own profiles row, and only this one transition. Every other field
-- (email, full_name, account_status to anything else) is untouched by this
-- policy; a WITH CHECK failure just makes the whole UPDATE fail, it can't be
-- used to partially apply an update the USING clause didn't already allow.
create policy profiles_self_activate on profiles for update
  using (id = auth.uid() and account_status = 'invited')
  with check (id = auth.uid() and account_status = 'active');

-- ---- profiles_update_own (pre-existing) has no column restriction at all —
-- fine when the only self-editable data was name/locale, but these new
-- columns raise the stakes: without this guard, any signed-in user could
-- rewrite their OWN status_reason/status_changed_by to forge the audit
-- trail, or flip account_status back to 'active' during the brief window
-- between an admin's ban call and their next getUser() revalidation (see
-- design note above). Same column-guard-trigger pattern as
-- guard_employee_self_update() (Phase 1) — Sys Admin (profiles_write_sysadmin)
-- and trusted backend writes (auth.uid() is null) are unaffected; the one
-- self-service exception is the exact invited->active transition
-- profiles_self_activate exists for.
create or replace function guard_profiles_self_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or has_role('sys_admin') then
    return new;
  end if;

  if new.account_status is distinct from old.account_status
     and not (old.account_status = 'invited' and new.account_status = 'active') then
    raise exception 'account_status can only be changed by a System Administrator';
  end if;

  if new.email is distinct from old.email
    or new.status_reason is distinct from old.status_reason
    or new.status_changed_by is distinct from old.status_changed_by
    or new.status_changed_at is distinct from old.status_changed_at
  then
    raise exception 'Only full_name and locale can be self-updated — ask a System Administrator to change anything else.';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on profiles
  for each row execute function guard_profiles_self_update();

-- ---- System-scoped audit trail for profiles (docs/03-permission-matrix.md's
-- "system-scoped entries", same bucket as user_roles/companies — this is
-- account/access administration, not HR content). profiles has no
-- company_id/employee_id column, so write_audit_log() naturally resolves
-- company_id to null here and every row is Sys-Admin-only, which matches
-- decision 1 above.
create trigger audit_profiles after update on profiles
  for each row execute function write_audit_log();

alter policy audit_log_select_sysadmin on audit_log
  using (table_name in ('companies', 'user_roles', 'profiles') and has_role('sys_admin'));

-- =============================================================================
-- set_account_status(): guarded activate/deactivate, same shape as
-- revoke_role_grant() (20261030000000_guard_role_grant_revocation.sql) —
-- advisory-locked, self-action guard, last-System-Administrator guard.
--
-- This function ONLY updates `profiles`. It deliberately does not touch
-- auth.users/banned_until (see design note above) — on deactivate, the
-- calling Server Action bans via the Admin API first and only calls this
-- RPC once that succeeds; on reactivate, it calls this RPC first and only
-- unbans afterward — in both cases so a partial failure always leans
-- toward less access, never more (see design note above).
-- =============================================================================

create or replace function set_account_status(p_user_id uuid, p_new_status account_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status account_status;
  v_other_active_sysadmins bigint;
begin
  if auth.uid() is null or not has_role('sys_admin') then
    raise exception 'Only a System Administrator may change an account''s status';
  end if;

  if p_new_status not in ('active', 'deactivated') then
    raise exception 'Status must be set to active or deactivated through this operation';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own account status — ask another System Administrator to do it';
  end if;

  perform pg_advisory_xact_lock(hashtext('profiles:set_account_status'));

  select account_status into v_current_status from profiles where id = p_user_id;
  if v_current_status is null then
    raise exception 'This account no longer exists';
  end if;

  -- Only ever reachable when the target isn't the caller (guarded above),
  -- so this is necessarily a case of one admin locking out another —
  -- checked the same way revoke_role_grant() checks the last sys_admin
  -- role grant, just re-expressed against active accounts instead of
  -- unrevoked grants.
  if p_new_status = 'deactivated' then
    select count(*) into v_other_active_sysadmins
    from user_roles ur
    join profiles p on p.id = ur.user_id
    where ur.role = 'sys_admin'
      and ur.revoked_at is null
      and p.account_status = 'active'
      and ur.user_id <> p_user_id;
    if v_other_active_sysadmins = 0
       and exists (select 1 from user_roles where user_id = p_user_id and role = 'sys_admin' and revoked_at is null) then
      raise exception 'Can''t deactivate the last active System Administrator — the system would have nobody left to manage users or roles';
    end if;
  end if;

  update profiles
  set account_status = p_new_status,
      status_reason = p_reason,
      status_changed_by = auth.uid(),
      status_changed_at = now()
  where id = p_user_id;
end;
$$;

grant execute on function set_account_status(uuid, account_status, text) to authenticated;

-- =============================================================================
-- log_security_event(): the one allowlisted, non-forgeable way to record a
-- security event that doesn't correspond to an actual row mutation on an
-- already-audited table (a forgot-password request from a signed-out
-- visitor, a self-service password change, a self-service sign-out-
-- everywhere, or an admin sending a reset/invite email). This is not a
-- general-purpose "write anything to audit_log" helper: the action vocabulary
-- is fixed, and who may log which action (and for whom) is checked here, not
-- trusted from the caller — the same non-forgeability write_audit_log()'s
-- trigger-only design already guarantees for every other table.
--
-- Never reveals whether an account exists: it has no meaningful return value
-- (void) and every branch succeeds silently whether or not a target was
-- found, so it cannot be used as an existence oracle even by an
-- authenticated caller probing p_email.
-- =============================================================================

create or replace function log_security_event(
  p_action text,
  p_target_user_id uuid default null,
  p_email text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_actor_role app_role;
  v_actor_roles app_role[];
  v_company_id uuid;
  v_metadata jsonb;
begin
  select array_agg(role order by granted_at desc) into v_actor_roles
  from user_roles where user_id = auth.uid() and revoked_at is null;
  v_actor_role := v_actor_roles[1];

  -- Defensive redaction, on top of "callers must never pass this in the
  -- first place" — the same never-log-a-secret rule as everywhere else.
  v_metadata := coalesce(p_metadata, '{}'::jsonb) - 'password' - 'token' - 'access_token' - 'refresh_token';

  if p_action = 'password_reset_requested' then
    -- Unauthenticated by definition (anon has no auth.uid()); resolves the
    -- target from the submitted email purely for the internal audit trail
    -- (visible to Sys Admin only) — this never reaches the caller, so it
    -- doesn't compromise the neutral, existence-blind response the Server
    -- Action itself returns.
    v_target := coalesce(p_target_user_id, (select id from profiles where lower(email) = lower(p_email) limit 1));

  elsif p_action in ('password_changed', 'all_device_signout_requested') then
    if auth.uid() is null then
      raise exception 'Not signed in';
    end if;
    v_target := auth.uid();

  elsif p_action in ('password_reset_sent_by_admin', 'invitation_resent') then
    if auth.uid() is null or not has_role('sys_admin') then
      raise exception 'Only a System Administrator may log this action';
    end if;
    if p_target_user_id is null or not exists (select 1 from profiles where id = p_target_user_id) then
      raise exception 'Unknown target account';
    end if;
    v_target := p_target_user_id;

  else
    raise exception 'Unknown security event action';
  end if;

  if v_target is not null then
    select company_id into v_company_id from employees where user_id = v_target and deleted_at is null limit 1;
  end if;

  insert into audit_log(table_name, record_id, action, actor_id, actor_role, actor_roles, company_id, after_data)
  values ('profiles', v_target, p_action, auth.uid(), v_actor_role, v_actor_roles, v_company_id, v_metadata);
end;
$$;

grant execute on function log_security_event(text, uuid, text, jsonb) to anon, authenticated;
