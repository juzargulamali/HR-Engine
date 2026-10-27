-- Access grant rules R1, R2 and R3 (People & Access security review). ADDITIVE: replaces six functions in place (create or replace), adds no table, no column,
-- no trigger, no policy and no privilege, and changes no data. Existing grants are untouched; nobody loses access by this migration.
--
-- WHY (see docs/people-access-security-proposal.md; every finding is reproduced in packages/rls-tests/test/people_access_findings.rls.test.ts):
--   F1  a Budget submitter who holds Finance and access management could give executive_approver to a colleague, who then approved the submission
--       (access administration, not transaction self-approval: the guard that stops a submitter deciding their own submission is unchanged);
--   F2  a Budget access manager could give themselves any budget right;
--   F3  a Sales access manager (not a founder) could give themselves the commercial-approval-rules right and use it;
--   F4  a non-founder access manager could withdraw another access manager although the grant functions (and the screens) say only a founder may.
--
-- RULES
--   R1  Budget: in a company, only a holder of executive_approver may add or remove the executive_approver right, by pbx_grant_access or pbx_revoke_access.
--       The last ELIGIBLE approver (an active person holding the right) can never be removed. The first approver of a company is still named by the owner-run
--       supabase/manual-sql/pbx_30_bootstrap_access.sql, which writes the table as the database owner and needs no in-app permission. Budget grant and revoke
--       are also serialised per company, so two approvers cannot remove each other's right at the same moment and leave none.
--   R2  Budget and Sales: a caller may not ADD a right to their own grant. Removing one's own right stays allowed (subject to the existing last-manager and
--       last-founder rules). A Sales founder already holds every Sales right, so nothing they could type is an addition in effect.
--   R3  Sales, Projects, Inventory: a caller who is not a founder cannot withdraw (revoke) a person who holds access management (Inventory: or cost visibility),
--       the same rule the grant functions already apply; withdrawing oneself stays allowed. Sales also stops a non-founder replacing another access manager's
--       rights through crm_grant_access (Projects and Inventory already did), so the rule cannot be sidestepped through the other function.
--
-- WHAT DOES NOT CHANGE: who may grant what otherwise; company scope; the founder-only rights; every existing refusal and its wording (new refusals are added,
-- none removed); presets (the screen applies them through these same functions, so the rules apply to them automatically); privileges (create or replace keeps
-- the existing execute grants; the grant tables stay read-only for the signed-in role); the owner-run scripts.

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Budget
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function pbx_grant_access(
  p_user_id uuid,
  p_company_id uuid,
  p_capabilities text[] default '{}'::text[],
  p_note text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_caps text[] := coalesce(p_capabilities, '{}'::text[]);
  v_existing text[];
begin
  perform pbx_require_user();
  if not pbx_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only someone with budget access management for this company can grant access to project budgets' using errcode = '42501';
  end if;
  if not (v_caps <@ pbx_capability_list()) then
    raise exception 'Unknown capability in %', v_caps using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_user_id and is_active) then
    raise exception 'That user does not exist or is not active' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  -- One change at a time per company: the "last approver" and "last access manager" checks below count rows.
  perform pg_advisory_xact_lock(hashtext('pbx_company_grants'), hashtext(p_company_id::text));
  select capabilities into v_existing from pbx_company_grants
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  -- R2: nobody adds a right to their own grant.
  if p_user_id = auth.uid() and exists (select 1 from unnest(v_caps) c where not (c = any (coalesce(v_existing, '{}'::text[])))) then
    raise exception 'You cannot add rights to your own access. Another access manager can do that' using errcode = '42501';
  end if;
  -- R1: only a CEO / CTO approver of this company adds or removes the approver right.
  if ('executive_approver' = any (v_caps)) is distinct from ('executive_approver' = any (coalesce(v_existing, '{}'::text[]))) then
    if not pbx_has_capability(p_company_id, 'executive_approver') then
      raise exception 'Only a CEO / CTO approver of this company can give or remove the approver right' using errcode = '42501';
    end if;
  end if;
  -- R1: the last eligible approver (an active person holding the right) is never removed.
  if v_existing is not null and 'executive_approver' = any (v_existing) and not ('executive_approver' = any (v_caps))
     and not exists (
       select 1 from pbx_company_grants g join profiles p on p.id = g.user_id and p.is_active
        where g.company_id = p_company_id and g.revoked_at is null and g.user_id <> p_user_id and 'executive_approver' = any (g.capabilities)) then
    raise exception 'Cannot remove the approver right from the last eligible CEO / CTO approver of this company' using errcode = '23514';
  end if;
  -- the last access manager cannot remove their own capability by replacing it
  if exists (select 1 from pbx_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities))
     and not ('manage_access' = any (v_caps))
     and (select count(*) from pbx_company_grants where company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities)) <= 1 then
    raise exception 'Cannot remove access management from the last person who holds it for this company' using errcode = '23514';
  end if;
  update pbx_company_grants set capabilities = v_caps, note = coalesce(p_note, note)
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null
  returning id into v_id;
  if v_id is null then
    insert into pbx_company_grants (user_id, company_id, capabilities, granted_by, note)
    values (p_user_id, p_company_id, v_caps, auth.uid(), p_note)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function pbx_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_existing text[];
begin
  perform pbx_require_user();
  if not pbx_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only someone with budget access management for this company can revoke access to project budgets' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('pbx_company_grants'), hashtext(p_company_id::text));
  select capabilities into v_existing from pbx_company_grants
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  -- R1: withdrawing a CEO / CTO approver is the approver's decision, and the last eligible approver stays.
  if v_existing is not null and 'executive_approver' = any (v_existing) then
    if not pbx_has_capability(p_company_id, 'executive_approver') then
      raise exception 'Only a CEO / CTO approver of this company can withdraw an approver' using errcode = '42501';
    end if;
    if exists (select 1 from profiles where id = p_user_id and is_active)
       and not exists (
         select 1 from pbx_company_grants g join profiles p on p.id = g.user_id and p.is_active
          where g.company_id = p_company_id and g.revoked_at is null and g.user_id <> p_user_id and 'executive_approver' = any (g.capabilities)) then
      raise exception 'Cannot remove the last eligible CEO / CTO approver of this company' using errcode = '23514';
    end if;
  end if;
  if exists (select 1 from pbx_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities))
     and (select count(*) from pbx_company_grants where company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities)) <= 1 then
    raise exception 'Cannot revoke the last person who manages access to project budgets for this company' using errcode = '23514';
  end if;
  update pbx_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function crm_grant_access(
  p_user_id uuid,
  p_company_id uuid,
  p_capabilities text[] default '{}'::text[],
  p_note text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_caps text[] := coalesce(p_capabilities, '{}'::text[]);
  v_existing text[];
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not crm_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a founder, or someone a founder gave access management to, can grant Sales access for this company' using errcode = '42501';
  end if;
  if not (v_caps <@ crm_capability_list()) then
    raise exception 'Unknown CRM capability in %', v_caps using errcode = '22023';
  end if;
  -- Only a founder may hand out founder or access-management capability.
  if ('founder' = any (v_caps) or 'manage_access' = any (v_caps)) and not crm_is_founder(p_company_id) then
    raise exception 'Only a CRM founder can grant founder or access-management rights' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_user_id and is_active) then
    raise exception 'That user does not exist or is not active' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company_id and is_active and deleted_at is null) then
    raise exception 'Unknown or inactive company' using errcode = '22023';
  end if;
  select capabilities into v_existing from crm_company_grants
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  -- R2: nobody adds a right to their own grant. (A founder already holds every Sales right, so nothing they type is an addition in effect.)
  if p_user_id = auth.uid() and not crm_is_founder(p_company_id)
     and exists (select 1 from unnest(v_caps) c where not (c = any (coalesce(v_existing, '{}'::text[])))) then
    raise exception 'You cannot add rights to your own access. A founder or another access manager can do that' using errcode = '42501';
  end if;
  -- Changing an existing founder's or access manager's rights is a founder's decision (R3: the access-manager half is new here; Projects and Inventory
  -- already had it), and the last founder can never be demoted (the same protection crm_revoke_access gives against revoking them).
  if v_existing is not null and ('founder' = any (v_existing) or ('manage_access' = any (v_existing) and p_user_id <> auth.uid())) then
    if not crm_is_founder(p_company_id) then
      raise exception 'Only a CRM founder can change a founder''s or access manager''s rights' using errcode = '42501';
    end if;
    if 'founder' = any (v_existing) and not ('founder' = any (v_caps)) and (
         select count(*) from crm_company_grants
          where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities)) <= 1 then
      raise exception 'Cannot remove founder rights from the last founder of this company' using errcode = '23514';
    end if;
  end if;

  update crm_company_grants
     set capabilities = v_caps, note = coalesce(p_note, note)
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null
  returning id into v_id;

  if v_id is null then
    insert into crm_company_grants (user_id, company_id, capabilities, granted_by, note)
    values (p_user_id, p_company_id, v_caps, auth.uid(), p_note)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function crm_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target_caps text[];
  v_target_is_founder boolean;
  v_founders integer;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not crm_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a CRM founder can revoke Sales access for this company' using errcode = '42501';
  end if;
  select capabilities into v_target_caps
    from crm_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_caps is null then return; end if;
  v_target_is_founder := 'founder' = any (v_target_caps);
  if v_target_is_founder and not crm_is_founder(p_company_id) then
    raise exception 'Only a CRM founder can revoke a founder' using errcode = '42501';
  end if;
  -- R3: withdrawing another access manager is a founder's decision (stepping down oneself stays allowed).
  if 'manage_access' = any (v_target_caps) and p_user_id <> auth.uid() and not crm_is_founder(p_company_id) then
    raise exception 'Only a CRM founder can withdraw an access manager' using errcode = '42501';
  end if;
  if v_target_is_founder then
    select count(*) into v_founders from crm_company_grants
     where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities);
    if v_founders <= 1 then
      raise exception 'Cannot revoke the last founder of this company' using errcode = '23514';
    end if;
  end if;
  update crm_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Projects (R3: revoke only; its grant function already protects an existing access manager)
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function proj_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target_caps text[];
  v_target_is_founder boolean;
  v_founders integer;
begin
  perform proj_require_user();
  if not proj_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a Projects founder can revoke Projects access for this company' using errcode = '42501';
  end if;
  select capabilities into v_target_caps
    from proj_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_caps is null then return; end if;
  v_target_is_founder := 'founder' = any (v_target_caps);
  if v_target_is_founder and not proj_is_founder(p_company_id) then
    raise exception 'Only a Projects founder can revoke a founder' using errcode = '42501';
  end if;
  -- R3: withdrawing another access manager is a founder's decision (stepping down oneself stays allowed).
  if 'manage_access' = any (v_target_caps) and p_user_id <> auth.uid() and not proj_is_founder(p_company_id) then
    raise exception 'Only a Projects founder can withdraw an access manager' using errcode = '42501';
  end if;
  if v_target_is_founder then
    select count(*) into v_founders from proj_company_grants
     where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities);
    if v_founders <= 1 then
      raise exception 'Cannot revoke the last founder of this company' using errcode = '23514';
    end if;
  end if;
  if exists (select 1 from proj_projects pr where pr.company_id = p_company_id and pr.pm_user_id = p_user_id and pr.status not in ('completed', 'archived')) then
    raise exception 'This person is the Project Manager of a live project. Assign another Project Manager first' using errcode = '23514';
  end if;
  if exists (select 1 from proj_teams t join proj_projects pr on pr.id = t.project_id
              where pr.company_id = p_company_id and t.head_user_id = p_user_id and t.removed_at is null and pr.status not in ('completed', 'archived')) then
    raise exception 'This person heads a department team on a live project. Choose another head first' using errcode = '23514';
  end if;
  update proj_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  update proj_project_members m set removed_at = now(), removed_by = auth.uid(), removal_reason = 'Projects access revoked'
   from proj_projects pr
   where m.project_id = pr.id and pr.company_id = p_company_id and m.user_id = p_user_id and m.removed_at is null;
  delete from notifications n using proj_projects pr
   where n.user_id = p_user_id and n.type like 'project\_%' and n.payload->>'project_id' = pr.id::text and pr.company_id = p_company_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Inventory (R3: revoke only; its grant function already protects an existing access manager and cost reader)
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function inv_revoke_access(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target_caps text[];
  v_target_is_founder boolean;
  v_founders integer;
begin
  perform inv_require_user();
  if not inv_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only an Inventory founder can revoke Inventory access for this company' using errcode = '42501';
  end if;
  select capabilities into v_target_caps
    from inv_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_caps is null then return; end if;
  v_target_is_founder := 'founder' = any (v_target_caps);
  if v_target_is_founder and not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can revoke a founder' using errcode = '42501';
  end if;
  -- R3: withdrawing another access manager or cost reader is a founder's decision (stepping down oneself stays allowed).
  if (v_target_caps && array['manage_access', 'view_costs']::text[]) and p_user_id <> auth.uid() and not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can withdraw an access manager or a cost reader' using errcode = '42501';
  end if;
  if v_target_is_founder then
    select count(*) into v_founders from inv_company_grants
     where company_id = p_company_id and revoked_at is null and 'founder' = any (capabilities);
    if v_founders <= 1 then
      raise exception 'Cannot revoke the last founder of this company' using errcode = '23514';
    end if;
  end if;
  update inv_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  update inv_operator_locations set removed_at = now() where user_id = p_user_id and company_id = p_company_id and removed_at is null;
end;
$$;
