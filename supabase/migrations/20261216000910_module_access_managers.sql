-- Who can grant access to a module, for the people who do not have it (completion pass, B12 / U-13). ADDITIVE: adds one read-only function; no table, column,
-- policy, trigger or privilege on anything existing changes, and no data changes.
--
-- WHY. A person who is denied a module (Sales, Projects, Inventory, Project Budget & Expenses) was told "Ask a founder" with no name. The grant tables are readable
-- only by the people who hold access, so a person without it could not look the names up.
--
-- WHAT. module_access_managers(p_module) returns ONE row per person who can manage that module's access in the CALLER'S OWN COMPANY, and nothing else:
--     user_id (the person's identifier) and display_name.
--   * The company is derived from the caller (their employee record). There is no company argument, so nobody can ask about another company; a caller with no employee
--     record gets no rows.
--   * "Can manage access" is exactly what the module's own grant functions check: Sales, Projects and Inventory: a founder, or a holder of manage_access
--     (the *_has_capability helpers); Project Budget & Expenses: a holder of manage_access (a budget grant has no founder right). Only active, un-revoked grants of that
--     company count, held by an ACTIVE person (an inactive account is never listed, the same join the helpers use).
--   * Module grants are always for one company (company_id is required; they have no country or global form), so unlike role grants there are no country-limited or
--     company-less holders to consider here: a holder of ANOTHER company is never returned.
--   * Not returned: emails, the grant row, capabilities, who granted it, any other company's holders, or any other personnel data.
--   * Callable by any signed-in person, with or without a grant; a signed-out caller is refused; an unknown module is refused.
-- Who may grant, revoke or see grants, and every other function, are unchanged.
-- Rollback: supabase/manual-sql/modaccess_90_rollback.sql drops the function.

create or replace function module_access_managers(p_module text)
returns table (user_id uuid, display_name text)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_ids uuid[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_module is null or p_module not in ('sales', 'projects', 'inventory', 'budget') then
    raise exception 'Unknown module' using errcode = '22023';
  end if;
  -- Only the caller's own company, and only for an active caller.
  select e.company_id into v_company
    from employees e join profiles me on me.id = auth.uid() and me.is_active
   where e.user_id = auth.uid() and e.deleted_at is null
   limit 1;
  if v_company is null then return; end if;

  -- One branch per module, so a module that is not installed here cannot break the others.
  if p_module = 'sales' then
    select coalesce(array_agg(distinct g.user_id), '{}') into v_ids from crm_company_grants g
     where g.company_id = v_company and g.revoked_at is null and ('founder' = any (g.capabilities) or 'manage_access' = any (g.capabilities));
  elsif p_module = 'projects' then
    select coalesce(array_agg(distinct g.user_id), '{}') into v_ids from proj_company_grants g
     where g.company_id = v_company and g.revoked_at is null and ('founder' = any (g.capabilities) or 'manage_access' = any (g.capabilities));
  elsif p_module = 'inventory' then
    select coalesce(array_agg(distinct g.user_id), '{}') into v_ids from inv_company_grants g
     where g.company_id = v_company and g.revoked_at is null and ('founder' = any (g.capabilities) or 'manage_access' = any (g.capabilities));
  else
    select coalesce(array_agg(distinct g.user_id), '{}') into v_ids from pbx_company_grants g
     where g.company_id = v_company and g.revoked_at is null and 'manage_access' = any (g.capabilities);
  end if;

  return query
    select h.uid,
           coalesce(nullif(btrim(p.full_name), ''), (select nullif(btrim(e.first_name || ' ' || e.last_name), '') from employees e where e.user_id = h.uid and e.deleted_at is null limit 1), 'A colleague')
      from unnest(v_ids) as h(uid)
      join profiles p on p.id = h.uid and p.is_active
     order by 2, 1;
end;
$$;

revoke all on function module_access_managers(text) from public, anon;
grant execute on function module_access_managers(text) to authenticated;
