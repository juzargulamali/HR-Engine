-- WRITES (inv_company_grants, and inv_company_settings only if you type a reference code below). Run in the SQL Editor of
-- "Enginious HR Engine_V2" AFTER the seven Inventory migrations and after inv_20_verify_readonly.sql shows every row as OK.
--
-- WHY: Inventory access is granted from inside the app by a founder (Inventory > Access). The very first founders cannot be
-- created from the app, because nobody holds the founder right yet. This script creates them. Nobody receives Inventory access
-- automatically: not a CEO, not an HR Admin, not a System Admin, not a Sales or Projects founder, not any test account. THIS
-- CHANGES REAL PEOPLE'S ACCESS: run it only when you intend to.
--
-- BEFORE RUNNING: in v_grants below, replace the placeholder with one line per grant, written as
--       'real login email  =>  company legal name (exactly as in the preflight list, section D) or the company id'
-- Example (do not copy; type your own):
--       'jane.doe@yourcompany.com => Enginious FZ-LLC',
-- One line gives that ONE person the founder right in that ONE company. For two companies write two lines. There is no "all
-- companies" and no "everybody" shortcut, and no default founder: while a placeholder (REPLACE-WITH-...) or an address ending
-- in .example is still there, the script STOPS with a clear message and changes nothing. It also stops, changing nothing, if an
-- email is not an active user, or a company name is unknown, inactive or ambiguous (use the company id then).
-- (inv_20_verify_readonly.sql and the preflight list the Projects and Sales founders and the CEO / CTO as information only.)
--
-- OPTIONAL: v_codes sets the company's equipment reference code (2 to 5 capital letters, for example UAE gives labels like
-- UAE-E-00042). Leave it empty and a founder types the code in the app under Inventory > Manage instead; nothing can be
-- registered until it is set. It is never copied from Sales or Projects. The code cannot change once labels have been issued.
--
-- WHAT IT DOES NOT DO: no HR role is created or changed, no Sales or Projects grant is created or changed, no company is
-- created, and it never creates stock, locations, categories or items: the founders do that in the app. Running it twice is
-- harmless (an existing active grant keeps its other rights and gets the founder right added).
-- ROLLBACK and an optional hand-written settings row are at the bottom.

do $$
declare
  -- one line per grant:  'email => company legal name or company id'
  v_grants constant text[] := array[
    'REPLACE-WITH-FOUNDER-EMAIL@yourcompany.example => REPLACE-WITH-COMPANY-LEGAL-NAME-OR-ID'
  ];
  -- optional, one line per company:  'company legal name or company id => CODE'  (for example 'Enginious FZ-LLC => UAE'); empty = a founder sets it in the app
  v_codes constant text[] := array[]::text[];

  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_line text;
  v_parts text[];
  v_email text;
  v_company_ref text;
  v_code text;
  v_user uuid;
  v_company uuid;
  v_company_name text;
  v_matches int;
  v_before text[];
  v_granted int := 0;
  v_confirmed int := 0;
  v_codes_set int := 0;
begin
  if coalesce(array_length(v_grants, 1), 0) = 0 then
    raise exception 'Nothing to do: v_grants is empty. Type one line per founder at the top of this file.';
  end if;

  -- 1. CHECK EVERYTHING FIRST. Nothing is written until every line is valid.
  foreach v_line in array v_grants loop
    v_parts := regexp_split_to_array(v_line, '\s*=>\s*');
    if array_length(v_parts, 1) <> 2 then
      raise exception 'Each line of v_grants must look like ''email => company'' (found: %).', v_line;
    end if;
    v_email := btrim(v_parts[1]);
    v_company_ref := btrim(v_parts[2]);
    if upper(v_email) like 'REPLACE-WITH-%' or upper(v_company_ref) like 'REPLACE-WITH-%' then
      raise exception 'Edit v_grants at the top of this file first: a placeholder is still there (found: %).', v_line;
    end if;
    if position('@' in v_email) = 0 or lower(v_email) like '%.example' then
      raise exception 'Not a real login email: % . Type the founder''s real address (see the preflight lists).', v_email;
    end if;
    if not exists (select 1 from profiles p where lower(p.email) = lower(v_email) and p.is_active) then
      raise exception 'No active user has the email %. Check the spelling against the preflight list.', v_email;
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

  foreach v_line in array v_codes loop
    v_parts := regexp_split_to_array(v_line, '\s*=>\s*');
    if array_length(v_parts, 1) <> 2 then
      raise exception 'Each line of v_codes must look like ''company => CODE'' (found: %).', v_line;
    end if;
    v_company_ref := btrim(v_parts[1]);
    v_code := btrim(v_parts[2]);
    if v_code !~ '^[A-Z]{2,5}$' then
      raise exception 'The reference code "%" is not valid: 2 to 5 capital letters.', v_code;
    end if;
    if v_company_ref ~ v_uuid then
      select count(*) into v_matches from companies c where c.id = v_company_ref::uuid and c.is_active and c.deleted_at is null;
    else
      select count(*) into v_matches from companies c where lower(btrim(c.legal_name)) = lower(v_company_ref) and c.is_active and c.deleted_at is null;
    end if;
    if v_matches <> 1 then
      raise exception 'v_codes: "%" does not match exactly one active company.', v_company_ref;
    end if;
  end loop;

  -- 2. FOUNDER GRANTS
  foreach v_line in array v_grants loop
    v_parts := regexp_split_to_array(v_line, '\s*=>\s*');
    v_email := btrim(v_parts[1]);
    v_company_ref := btrim(v_parts[2]);
    select p.id into v_user from profiles p where lower(p.email) = lower(v_email) and p.is_active;
    if v_company_ref ~ v_uuid then
      select c.id, c.legal_name into v_company, v_company_name from companies c where c.id = v_company_ref::uuid;
    else
      select c.id, c.legal_name into v_company, v_company_name from companies c where lower(btrim(c.legal_name)) = lower(v_company_ref) and c.is_active and c.deleted_at is null;
    end if;
    select g.capabilities into v_before from inv_company_grants g where g.user_id = v_user and g.company_id = v_company and g.revoked_at is null;
    insert into inv_company_grants (user_id, company_id, capabilities, note)
    values (v_user, v_company, array['founder'], 'Bootstrap by owner (manual SQL)')
    on conflict (user_id, company_id) where revoked_at is null
    do update set capabilities = (select array_agg(distinct x order by x) from unnest(inv_company_grants.capabilities || array['founder']) x);
    if v_before is null then
      v_granted := v_granted + 1;
      raise notice 'founder GRANTED: % -> %', v_email, v_company_name;
    else
      v_confirmed := v_confirmed + 1;
      raise notice 'founder already had access, founder right ensured: % -> %', v_email, v_company_name;
    end if;
  end loop;

  -- 3. OPTIONAL REFERENCE CODES (only for a company that has a founder, now or from an earlier run)
  foreach v_line in array v_codes loop
    v_parts := regexp_split_to_array(v_line, '\s*=>\s*');
    v_company_ref := btrim(v_parts[1]);
    v_code := btrim(v_parts[2]);
    if v_company_ref ~ v_uuid then
      select c.id, c.legal_name into v_company, v_company_name from companies c where c.id = v_company_ref::uuid;
    else
      select c.id, c.legal_name into v_company, v_company_name from companies c where lower(btrim(c.legal_name)) = lower(v_company_ref) and c.is_active and c.deleted_at is null;
    end if;
    if not exists (select 1 from inv_company_grants g where g.company_id = v_company and g.revoked_at is null and 'founder' = any (g.capabilities)) then
      raise exception 'Refusing to set a code for % : the company has no Inventory founder. Add a founder line for it first.', v_company_name;
    end if;
    if exists (select 1 from inv_company_settings s where s.reference_code = v_code and s.company_id <> v_company) then
      raise exception 'The reference code % is already used by another company.', v_code;
    end if;
    if exists (select 1 from inv_company_settings s where s.company_id = v_company and s.reference_code <> v_code)
       and exists (select 1 from inv_reference_counters r where r.company_id = v_company and r.last_value > 0) then
      raise exception 'The reference code of % cannot change: labels with the old code were already issued.', v_company_name;
    end if;
    if exists (select 1 from inv_company_settings s where s.company_id = v_company and s.reference_code = v_code) then
      raise notice 'reference code already set: % -> %', v_company_name, v_code;
    else
      insert into inv_company_settings (company_id, reference_code) values (v_company, v_code)
      on conflict (company_id) do update set reference_code = excluded.reference_code;
      v_codes_set := v_codes_set + 1;
      raise notice 'reference code SET: % -> %', v_company_name, v_code;
    end if;
  end loop;

  raise notice 'founder grants created: %; already existing (founder right ensured): %; reference codes set: %', v_granted, v_confirmed, v_codes_set;
end $$;

-- Result: who now holds Inventory access, per company, and each company's settings. Check it against what you intended.
select 'access' as what, c.legal_name as company, p.email as person_or_code, array_to_string(g.capabilities, ', ') as capabilities_or_state, g.granted_at::text as since
from inv_company_grants g
join companies c on c.id = g.company_id
join profiles p on p.id = g.user_id
where g.revoked_at is null
union all
select 'settings', c.legal_name, s.reference_code, case when s.is_enabled then 'on' else 'OFF (paused)' end, s.created_at::text
from inv_company_settings s
join companies c on c.id = s.company_id
order by 1, 2, 3;

-- OPTIONAL, BY HAND: the settings row without v_codes (remove the two dashes to use it; one company at a time; same rules as above:
-- 2 to 5 capital letters, unique, never changed once labels exist). A founder can equally type the code in the app.
--   insert into inv_company_settings (company_id, reference_code) values ((select id from companies where legal_name = 'REPLACE-WITH-COMPANY-LEGAL-NAME'), 'REPLACE');

-- ROLLBACK (removes the founder grants this script created; do not run once real Inventory work depends on them. It does not
-- touch grants that already existed before the script ran, because it matches the note this script writes):
--   update inv_company_grants set revoked_at = now() where note = 'Bootstrap by owner (manual SQL)' and revoked_at is null;
