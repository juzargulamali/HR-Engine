-- WRITES. OWNER-RUN ROLLBACK of 20261220000100_crm_estimates_quotations.sql. Safe to run twice.
-- It REFUSES (changes nothing) while any ISSUED quotation exists: an issued quotation and its snapshot are never deleted. If you really need to
-- remove them, export them first (select * from crm_quotation_snapshots) and set the line below to 'yes'.
-- What it removes: the quotation tables, VAT choices, terms templates, counters and the crm_quote_* / crm_save_* functions.
-- What it KEEPS (data you may have typed since): the identifier columns on organisations (vat_trn, trade_licence_no), the issuer columns on companies,
-- the company-logos bucket, and the replaced Clients & Agencies functions (they are a superset of the old ones: old calls keep working and
-- crm_remove_file still removes files; it only refuses a picture used in an issued quotation, which cannot exist after this rollback).
-- The proposals created for estimates stay as ordinary draft proposals (their note says "Estimate (quotation builder)").
do $$
declare v_allow text := 'no';   -- change to 'yes' to delete issued quotations too (EXPORT THEM FIRST)
begin
  if to_regclass('public.crm_quotation_snapshots') is not null and v_allow <> 'yes'
     and exists (select 1 from crm_quotation_snapshots) then
    raise exception 'Issued quotations exist. Export crm_quotation_snapshots, then set v_allow to yes to remove them.';
  end if;
  if v_allow = 'yes' and to_regclass('public.crm_quotation_snapshots') is not null then
    alter table crm_quotation_snapshots disable trigger user;
    alter table crm_quotations disable trigger user;
    alter table crm_quotation_sections disable trigger user;
    alter table crm_quotation_lines disable trigger user;
  end if;
end $$;
begin;
drop function if exists crm_quote_create(uuid);
drop function if exists crm_quote_save_header(uuid, jsonb);
drop function if exists crm_quote_save_section(uuid, uuid, text);
drop function if exists crm_quote_delete_section(uuid);
drop function if exists crm_quote_save_line(uuid, uuid, uuid, jsonb);
drop function if exists crm_quote_delete_line(uuid);
drop function if exists crm_quote_reorder(uuid, text, uuid, uuid[]);
drop function if exists crm_quote_issue(uuid, jsonb);
drop function if exists crm_quote_content_hash(uuid);
drop function if exists crm_quote_request_approval(uuid);
drop function if exists crm_quote_decide_approval(uuid, text, text, text);
drop function if exists crm_quote_check_asset(uuid, jsonb, text, text);
drop trigger if exists crm_approvals_quote_guard on crm_approvals;
drop function if exists crm_approval_quote_guard();
alter table crm_approvals drop column if exists quote_content_hash;
do $$ begin drop trigger if exists crm_quotation_assets_guard_del on storage.objects; drop trigger if exists crm_quotation_assets_guard_upd on storage.objects; exception when others then raise notice 'storage trigger not removed: %', sqlerrm; end $$;
drop function if exists crm_quotation_assets_guard();
drop function if exists crm_quote_create_revision(uuid);
drop function if exists crm_save_vat_choice(uuid, uuid, text, text, numeric, boolean);
drop function if exists crm_save_terms_template(uuid, text, jsonb);
drop function if exists crm_quote_build_content(uuid, date, jsonb);
drop function if exists crm_quote_load_editable(uuid);
drop function if exists crm_quote_touch(uuid);
drop trigger if exists companies_quote_seed on companies;
drop function if exists crm_quote_seed_company();
drop function if exists crm_quote_default_terms();
drop function if exists crm_quote_minor_units(text);
drop table if exists crm_quotation_snapshots;
drop table if exists crm_quotation_lines;
drop table if exists crm_quotation_sections;
drop table if exists crm_quotations;
drop table if exists crm_quote_terms_templates;
drop table if exists crm_quote_vat_choices;
drop table if exists crm_quote_counters;
drop function if exists crm_quotation_frozen();
drop function if exists crm_quotation_guard();
drop function if exists crm_quotation_body_guard();
commit;
