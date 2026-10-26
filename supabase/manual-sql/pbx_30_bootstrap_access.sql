-- WRITES (pbx_company_grants only). Run in the SQL Editor of "Enginious HR Engine_V2" AFTER the Project Budget & Expenses migrations and after
-- pbx_20_verify_readonly.sql shows every row as OK.
--
-- WHY: budget access is granted from the database by name; nobody receives it automatically (not a CEO, CTO, HR Admin, System Admin, the HR "finance" role,
-- a Projects founder or a test account). THIS CHANGES REAL PEOPLE'S ACCESS TO FINANCIAL RECORDS: run it only when you intend to, and only after
-- Finance has told you who they are. Project Managers need no grant: a Project Manager reaches the budget of their own project.
--
-- BEFORE RUNNING: in v_grants below, replace the placeholder with one line per grant, written as
--       'real login email  =>  company legal name (exactly as in the preflight list, section D) or the company id  =>  capabilities'
-- capabilities is a comma separated list of:
--       finance        approve / return / reject budgets and final expenses, record funding, receipts, returns and reimbursements, close settlement,
--                      set petrol and meal rates, add categories, and read everything of that company
--       view           read only (for example a founder you have decided should see budgets); a founder title alone confers nothing
--       manage_access  grant and revoke these rights later from the database function pbx_grant_access (give it to at least one person per company)
-- Example (do not copy; type your own):
--       'jane.doe@yourcompany.com => Enginious FZ-LLC => finance, manage_access',
--       'omar.ali@yourcompany.com => Enginious FZ-LLC => finance',
-- IMPORTANT: nobody may approve their own submission, and a Project Manager who also holds Finance cannot approve a budget they prepared. Give each
-- company that approves budgets AT LEAST TWO Finance people; with only one, a budget the single Finance person prepared (or a project they manage) is
-- held with a clear message until a second Finance person exists. The script warns you at the end when a company has fewer than two.
-- There is no "all companies" and no "everybody" shortcut. While a placeholder (REPLACE-WITH-...) or an address ending in .example is still there, the
-- script STOPS with a clear message and changes nothing. It also stops, changing nothing, if an email is not an active user, a company is unknown,
-- inactive or ambiguous (use the company id then), or a capability is not one of the three above.
--
-- WHAT IT DOES NOT DO: no HR role is created or changed, no Projects, Sales or Inventory grant is touched, no petrol or meal rate is set (Finance enters
-- them in the app), no budget is created. Running it twice is harmless (an existing active grant gets the listed capabilities added; nothing is removed).
-- ROLLBACK is at the bottom.

do $$
declare
  -- one line per grant:  'email => company legal name or company id => capability, capability'
  v_grants constant text[] := array[
    'REPLACE-WITH-FINANCE-EMAIL@yourcompany.example => REPLACE-WITH-COMPANY-LEGAL-NAME-OR-ID => finance, manage_access'
  ];

  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_line text;
  v_parts text[];
  v_email text;
  v_company_ref text;
  v_caps text[];
  v_user uuid;
  v_company uuid;
  v_company_name text;
  v_matches int;
  v_before text[];
  v_created int := 0;
  v_extended int := 0;
  r record;
begin
  if coalesce(array_length(v_grants, 1), 0) = 0 then
    raise exception 'Nothing to do: v_grants is empty. Type one line per grant at the top of this file.';
  end if;

  -- 1. CHECK EVERYTHING FIRST. Nothing is written until every line is valid.
  foreach v_line in array v_grants loop
    v_parts := regexp_split_to_array(v_line, '\s*=>\s*');
    if array_length(v_parts, 1) <> 3 then
      raise exception 'Each line of v_grants must look like ''email => company => capabilities'' (found: %).', v_line;
    end if;
    v_email := btrim(v_parts[1]);
    v_company_ref := btrim(v_parts[2]);
    v_caps := array(select btrim(x) from unnest(string_to_array(v_parts[3], ',')) x where btrim(x) <> '');
    if upper(v_email) like 'REPLACE-WITH-%' or upper(v_company_ref) like 'REPLACE-WITH-%' then
      raise exception 'Edit v_grants at the top of this file first: a placeholder is still there (found: %).', v_line;
    end if;
    if position('@' in v_email) = 0 or lower(v_email) like '%.example' then
      raise exception 'Not a real login email: % . Type the person''s real address (see the preflight lists).', v_email;
    end if;
    if not exists (select 1 from profiles p where lower(p.email) = lower(v_email) and p.is_active) then
      raise exception 'No active user has the email %. Check the spelling against the preflight list.', v_email;
    end if;
    if coalesce(array_length(v_caps, 1), 0) = 0 or not (v_caps <@ pbx_capability_list()) then
      raise exception 'Capabilities must be a list of finance, view, manage_access (found: %).', v_parts[3];
    end if;
    if v_company_ref ~ v_uuid then
      select count(*) into v_matches from companies c where c.id = v_company_ref::uuid and c.is_active and c.deleted_at is null;
    else
      select count(*) into v_matches from companies c where lower(btrim(c.legal_name)) = lower(v_company_ref) and c.is_active and c.deleted_at is null;
    end if;
    if v_matches = 0 then
      raise exception 'No active company matches "%". Use the legal name exactly as in preflight section D, or its id.', v_company_ref;
    elsif v_matches > 1 then
      raise exception 'More than one company is called "%". Use the company id instead.', v_company_ref;
    end if;
  end loop;

  -- 2. GRANTS
  foreach v_line in array v_grants loop
    v_parts := regexp_split_to_array(v_line, '\s*=>\s*');
    v_email := btrim(v_parts[1]);
    v_company_ref := btrim(v_parts[2]);
    v_caps := array(select btrim(x) from unnest(string_to_array(v_parts[3], ',')) x where btrim(x) <> '');
    select p.id into v_user from profiles p where lower(p.email) = lower(v_email) and p.is_active;
    if v_company_ref ~ v_uuid then
      select c.id, c.legal_name into v_company, v_company_name from companies c where c.id = v_company_ref::uuid;
    else
      select c.id, c.legal_name into v_company, v_company_name from companies c where lower(btrim(c.legal_name)) = lower(v_company_ref) and c.is_active and c.deleted_at is null;
    end if;
    select g.capabilities into v_before from pbx_company_grants g where g.user_id = v_user and g.company_id = v_company and g.revoked_at is null;
    insert into pbx_company_grants (user_id, company_id, capabilities, note)
    values (v_user, v_company, (select array_agg(distinct x order by x) from unnest(v_caps) x), 'Bootstrap by owner (manual SQL)')
    on conflict (user_id, company_id) where revoked_at is null
    do update set capabilities = (select array_agg(distinct x order by x) from unnest(pbx_company_grants.capabilities || excluded.capabilities) x);
    if v_before is null then
      v_created := v_created + 1;
      raise notice 'access GRANTED: % -> % (%)', v_email, v_company_name, array_to_string(v_caps, ', ');
    else
      v_extended := v_extended + 1;
      raise notice 'access already existed, capabilities added: % -> % (%)', v_email, v_company_name, array_to_string(v_caps, ', ');
    end if;
  end loop;

  -- 3. WARNINGS (nothing is changed here)
  for r in
    select c.legal_name, count(*) filter (where 'finance' = any (g.capabilities)) as n_fin
    from companies c join pbx_company_grants g on g.company_id = c.id and g.revoked_at is null
    group by c.id, c.legal_name
  loop
    if r.n_fin < 2 then
      raise notice 'WARNING: % has % Finance person(s). With fewer than two, a budget prepared by the only Finance person cannot be approved by anyone else and is held.', r.legal_name, r.n_fin;
    end if;
  end loop;
  raise notice 'grants created: %; already existing (capabilities added): %', v_created, v_extended;
end $$;

-- Result: who now holds budget access, per company. Check it against what you intended.
select c.legal_name as company, p.email as person, array_to_string(g.capabilities, ', ') as capabilities, g.granted_at::text as since
from pbx_company_grants g
join companies c on c.id = g.company_id
join profiles p on p.id = g.user_id
where g.revoked_at is null
order by 1, 2;

-- ROLLBACK (removes the grants this script created; does not touch grants that were made any other way, because it matches the note this script
-- writes). Do not run once real budgets depend on them: nobody could then approve or settle them.
--   update pbx_company_grants set revoked_at = now() where note = 'Bootstrap by owner (manual SQL)' and revoked_at is null;
