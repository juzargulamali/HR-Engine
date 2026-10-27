-- WRITES (function definitions only; no table, row or privilege is touched). OWNER-RUN ROLLBACK of the access grant rules migration
-- (20261215000000_access_grant_rules.sql): restores the six functions it replaced to exactly the definitions that were live before it.
--
-- WHEN TO USE IT: only if the new rules turn out to block something they should not, and you have decided to go back to the old behaviour while that is fixed.
-- READ THIS FIRST: going back RE-OPENS the gaps the migration closed (a Budget submitter appointing their own approver, an access manager granting themselves
-- rights, a non-founder withdrawing another access manager). See docs/people-access-security-proposal.md. Existing grants are never changed by the migration
-- or by this rollback, so nobody loses or gains access either way.
--
-- It is safe to run twice. Run it in the SQL Editor of the project, then run grant_rules_20_verify_readonly.sql (its first rows then say the OLD rules are in
-- place) or grant_rules_05_preservation_check_readonly.sql against your BEFORE snapshot (the six fn: rows then say UNCHANGED). The proj_grant_access and
-- inv_grant_access functions were never replaced and are not part of this script.

begin;

-- Sales: crm_grant_access
CREATE OR REPLACE FUNCTION public.crm_grant_access(p_user_id uuid, p_company_id uuid, p_capabilities text[] DEFAULT '{}'::text[], p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Changing an existing founder's rights is a founder's decision, and the last founder can never be demoted
  -- (the same protection crm_revoke_access gives against revoking them).
  select capabilities into v_existing from crm_company_grants
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_existing is not null and 'founder' = any (v_existing) then
    if not crm_is_founder(p_company_id) then
      raise exception 'Only a CRM founder can change a founder''s rights' using errcode = '42501';
    end if;
    if not ('founder' = any (v_caps)) and (
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
$function$;

-- Sales: crm_revoke_access
CREATE OR REPLACE FUNCTION public.crm_revoke_access(p_user_id uuid, p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target_is_founder boolean;
  v_founders integer;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not crm_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a CRM founder can revoke Sales access for this company' using errcode = '42501';
  end if;
  select 'founder' = any (capabilities) into v_target_is_founder
    from crm_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_is_founder is null then return; end if;
  if v_target_is_founder and not crm_is_founder(p_company_id) then
    raise exception 'Only a CRM founder can revoke a founder' using errcode = '42501';
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
$function$;

-- Projects: proj_revoke_access
CREATE OR REPLACE FUNCTION public.proj_revoke_access(p_user_id uuid, p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target_is_founder boolean;
  v_founders integer;
begin
  perform proj_require_user();
  if not proj_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only a Projects founder can revoke Projects access for this company' using errcode = '42501';
  end if;
  select 'founder' = any (capabilities) into v_target_is_founder
    from proj_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_is_founder is null then return; end if;
  if v_target_is_founder and not proj_is_founder(p_company_id) then
    raise exception 'Only a Projects founder can revoke a founder' using errcode = '42501';
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
$function$;

-- Inventory: inv_revoke_access
CREATE OR REPLACE FUNCTION public.inv_revoke_access(p_user_id uuid, p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target_is_founder boolean;
  v_founders integer;
begin
  perform inv_require_user();
  if not inv_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only an Inventory founder can revoke Inventory access for this company' using errcode = '42501';
  end if;
  select 'founder' = any (capabilities) into v_target_is_founder
    from inv_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
  if v_target_is_founder is null then return; end if;
  if v_target_is_founder and not inv_is_founder(p_company_id) then
    raise exception 'Only an Inventory founder can revoke a founder' using errcode = '42501';
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
$function$;

-- Budget: pbx_grant_access
CREATE OR REPLACE FUNCTION public.pbx_grant_access(p_user_id uuid, p_company_id uuid, p_capabilities text[] DEFAULT '{}'::text[], p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_caps text[] := coalesce(p_capabilities, '{}'::text[]);
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
$function$;

-- Budget: pbx_revoke_access
CREATE OR REPLACE FUNCTION public.pbx_revoke_access(p_user_id uuid, p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform pbx_require_user();
  if not pbx_has_capability(p_company_id, 'manage_access') then
    raise exception 'Only someone with budget access management for this company can revoke access to project budgets' using errcode = '42501';
  end if;
  if exists (select 1 from pbx_company_grants where user_id = p_user_id and company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities))
     and (select count(*) from pbx_company_grants where company_id = p_company_id and revoked_at is null and 'manage_access' = any (capabilities)) <= 1 then
    raise exception 'Cannot revoke the last person who manages access to project budgets for this company' using errcode = '23514';
  end if;
  update pbx_company_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and company_id = p_company_id and revoked_at is null;
end;
$function$;

commit;
