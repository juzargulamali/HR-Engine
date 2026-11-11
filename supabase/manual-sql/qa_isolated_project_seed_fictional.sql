-- WRITES. FOR A NEW, EMPTY, ISOLATED SUPABASE TEST PROJECT ONLY (Preview QA of PR #79). NEVER run this on the hosted database Production uses.
-- It adds FICTIONAL records only: one company, two people, their Sales access and the company's Sales settings. No real name, address or figure.
--
-- SAFETY: it STOPS, changing nothing, unless the database has NO company at all (a database that already holds a company is not an empty test project),
-- and unless the two fictional sign-ins below already exist (create them first in the test project: Authentication, Users, Add user, with a password, "Auto Confirm User" on).
--   qa.founder@enginious-qa.example   (Sales founder: can do everything in Sales)
--   qa.sales@enginious-qa.example     (ordinary Sales user: owns the enquiries they create)
-- Run it once. A second run stops at the first check (the company now exists) and changes nothing.
do $$
declare
  v_founder uuid; v_sales uuid; v_co uuid := gen_random_uuid(); n integer;
begin
  select count(*) into n from companies;
  if n > 0 then raise exception 'STOPPED: this database already has % company(ies). This seed is only for a new, empty test project. Nothing was changed.', n; end if;
  select id into v_founder from auth.users where lower(email) = 'qa.founder@enginious-qa.example';
  select id into v_sales from auth.users where lower(email) = 'qa.sales@enginious-qa.example';
  if v_founder is null or v_sales is null then
    raise exception 'STOPPED: create the two fictional sign-ins first (qa.founder@enginious-qa.example and qa.sales@enginious-qa.example). Nothing was changed.';
  end if;
  insert into companies (id, legal_name, country_code, default_currency) values (v_co, 'Fictional QA Events LLC', 'AE', 'AED');
  insert into employees (user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
    (v_founder, 'QA-1', v_co, 'AE', 'Fiona', 'Founder (fictional)', '2024-01-01'),
    (v_sales, 'QA-2', v_co, 'AE', 'Sami', 'Sales (fictional)', '2024-01-01');
  insert into crm_company_grants (user_id, company_id, capabilities) values (v_founder, v_co, '{founder}'), (v_sales, v_co, '{}');
  insert into crm_company_settings (company_id, reference_code, default_quote_currency) values (v_co, 'QA', 'AED')
    on conflict (company_id) do update set reference_code = excluded.reference_code, default_quote_currency = excluded.default_quote_currency;
  raise notice 'Seeded the fictional company %, two people and their Sales access.', v_co;
end $$;

-- What was seeded (read-only): expect one company, two employees, two Sales grants (one founder), settings present, and no enquiry, event or estimate yet.
select 'companies' as item, count(*)::text as value from companies
union all select 'employees', count(*)::text from employees
union all select 'Sales grants (founders)', count(*)::text || ' (' || count(*) filter (where 'founder' = any(capabilities))::text || ')' from crm_company_grants
union all select 'Sales settings', count(*)::text from crm_company_settings
union all select 'enquiries / events / estimates', (select count(*) from crm_opportunities)::text || ' / ' || (select count(*) from crm_events)::text || ' / ' || (select count(*) from crm_quotations)::text;
