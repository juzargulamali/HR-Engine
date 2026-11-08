-- READ-ONLY. Run BEFORE the migration, and again AFTER it. The two results must be identical: the migration only adds columns, tables and functions.
-- It must not change a proposal, an approval, a file, an organisation's existing values or a company's existing values.
select 'proposals' as item, count(*)::text as n, coalesce(md5(string_agg(id::text || status || version::text, ',' order by id)), '-') as fingerprint from crm_proposals
union all select 'approvals', count(*)::text, coalesce(md5(string_agg(id::text || state, ',' order by id)), '-') from crm_approvals
union all select 'files', count(*)::text, coalesce(md5(string_agg(id::text || coalesce(deleted_at::text, ''), ',' order by id)), '-') from crm_files
union all select 'organisations (name, roles, country, website)', count(*)::text, coalesce(md5(string_agg(id::text || name || coalesce(roles::text, '') || coalesce(country_code, '') || coalesce(website, ''), ',' order by id)), '-') from crm_organisations
union all select 'companies (legal name, country, currency)', count(*)::text, coalesce(md5(string_agg(id::text || legal_name || country_code || default_currency, ',' order by id)), '-') from companies;
