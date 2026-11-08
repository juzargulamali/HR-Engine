-- Sales & CRM: Estimates & Quotations (part 1: builder, issuing, frozen snapshot). Additive and idempotent.
--
-- WHAT THIS ADDS
--   A. Client identifiers on the organisation record: vat_trn and trade_licence_no (text, trimmed, leading zeros kept). Editable under the existing
--      organisation edit rule (crm_can_edit_organisation). The Clients & Agencies functions are replaced (create, update, import fingerprint,
--      import apply item) with the same behaviour plus these two columns; the import stays fill-only for them.
--   B. Issuer details on the Enginious company's OWN record (companies): trn, address, phone, email, website, logo_path (legal_name already
--      exists). Edited on the admin Companies screen under the existing companies_write policy (System Administrator). A private bucket holds logos.
--   C-E. The quotation is NOT a second record: every quotation IS a crm_proposals row (its version, status, approval and "sent" fact are the
--      existing ones). crm_quotations is a 1:1 extension of that row (header: reference, revision, currency, VAT, bill-to, terms, milestones),
--      because a proposal row can only hold a note and a file and cannot hold a priced bill of quantities. crm_quotation_sections and
--      crm_quotation_lines hold the body; crm_quotation_snapshots holds the frozen client-facing copy made at issue.
--   Internal notes: crm_quotations.internal_notes is the ONLY internal field. It is never copied into the snapshot and exports never read it.
--   There is no costing, supplier price or margin anywhere in this model.
--
-- RULES ENCODED HERE
--   * Every write is a function (SELECT-only RLS, no DML grants). Edit/create/issue = the existing proposal rule: the opportunity owner or a founder
--     (crm_require_owner_or_founder), company scoped (crm_has_access).
--   * Issue goes through the existing commercial approval: when the company policy is 'required' an approval for THIS proposal, decided
--     'approved' after the last edit, must exist. 'not_configured' and 'not_required' do not gate issuing (they never gated proposals).
--   * Issuing freezes a jsonb snapshot built INSIDE the database from the tables (the client never supplies it). Snapshot rows, and the
--     header/sections/lines of an issued quotation, can never be changed or deleted (guard triggers, same pattern as inv_project_notes).
--   * Arithmetic is exact (numeric). Line amount = round(quantity x unit price, 2) half up; VAT = round(line amount x rate / 100, 2) per line;
--     subtotals and totals are sums of the rounded line figures. packages/domain/src/quotations.ts does the same sum in TS (tested for parity).

-- -----------------------------------------------------------------------------
-- A. Client identifiers
-- -----------------------------------------------------------------------------
alter table crm_organisations add column if not exists vat_trn text;
alter table crm_organisations add column if not exists trade_licence_no text;
alter table crm_organisations drop constraint if exists crm_organisations_identifiers_shape;
alter table crm_organisations add constraint crm_organisations_identifiers_shape check (
  (vat_trn is null or (vat_trn = btrim(vat_trn) and length(vat_trn) between 1 and 40))
  and (trade_licence_no is null or (trade_licence_no = btrim(trade_licence_no) and length(trade_licence_no) between 1 and 40)));

-- Create: same as before plus the two identifiers as trailing arguments (old signature dropped so there is no ambiguous overload).
drop function if exists crm_create_organisation_profile(text, text[], text, text, text, text, uuid, text, text, uuid, jsonb);
create or replace function crm_create_organisation_profile(
  p_name text,
  p_roles text[] default '{}',
  p_country_code text default null,
  p_website text default null,
  p_place text default null,
  p_note text default null,
  p_company_id uuid default null,
  p_lead_source text default null,
  p_exhibition text default null,
  p_owner_id uuid default null,
  p_contacts jsonb default '[]'::jsonb,
  p_vat_trn text default null,
  p_trade_licence_no text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid; v_country text := nullif(upper(btrim(p_country_code)), ''); c jsonb;
begin
  perform crm_require_user();
  if not crm_has_any_access() then raise exception 'No CRM access' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Enter the name' using errcode = '22023'; end if;
  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' then raise exception 'Contacts must be a list' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_vat_trn, ''))) > 40 or length(btrim(coalesce(p_trade_licence_no, ''))) > 40 then
    raise exception 'Identifiers can be at most 40 characters' using errcode = '22023';
  end if;
  if p_company_id is null and (p_lead_source is not null or p_exhibition is not null or p_owner_id is not null) then
    raise exception 'Choose the company these details are for' using errcode = '22023';
  end if;
  if p_company_id is not null and not crm_has_access(p_company_id) then
    raise exception 'You do not have Sales access for this company' using errcode = '42501';
  end if;
  if p_owner_id is not null then
    if not crm_has_capability(p_company_id, 'assign_owner') then
      raise exception 'Only a founder (or someone they delegated) can assign or reassign owners' using errcode = '42501';
    end if;
    if not crm_user_has_company_access(p_owner_id, p_company_id) then
      raise exception 'The chosen owner has no Sales access for this company' using errcode = '22023';
    end if;
  end if;
  insert into crm_organisations (name, kind, roles, country_code, website, place, note, vat_trn, trade_licence_no, created_by)
  values (btrim(p_name), 'client', coalesce(p_roles, '{}'), v_country, nullif(btrim(p_website), ''),
          nullif(btrim(p_place), ''), nullif(btrim(p_note), ''), nullif(btrim(p_vat_trn), ''), nullif(btrim(p_trade_licence_no), ''), auth.uid())
  returning id into v_id;
  if p_company_id is not null then
    insert into crm_account_profiles (organisation_id, company_id, owner_id, owner_assigned_by, owner_assigned_at, lead_source, exhibition)
    values (v_id, p_company_id, p_owner_id, case when p_owner_id is not null then auth.uid() end,
            case when p_owner_id is not null then now() end, nullif(btrim(p_lead_source), ''), nullif(btrim(p_exhibition), ''));
  end if;
  for c in select * from jsonb_array_elements(p_contacts) loop
    if length(btrim(coalesce(c->>'name', ''))) = 0 then raise exception 'Every contact needs a name' using errcode = '22023'; end if;
    insert into crm_contacts (organisation_id, name, role_title, email, phone, created_by)
    values (v_id, btrim(c->>'name'), nullif(btrim(c->>'role_title'), ''), nullif(btrim(c->>'email'), ''),
            nullif(btrim(c->>'phone'), ''), auth.uid());
  end loop;
  return v_id;
end;
$$;

create or replace function crm_update_organisation(p_org uuid, p_patch jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  k text;
  v_allowed text[] := array['name', 'roles', 'country_code', 'website', 'place', 'note', 'vat_trn', 'trade_licence_no'];
begin
  perform crm_require_user();
  if not crm_can_edit_organisation(p_org) then
    raise exception 'Only the person who added this organisation, a founder, or the owner of an opportunity it is on can change it'
      using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_allowed)) then raise exception 'Field % cannot be changed here', k using errcode = '22023'; end if;
  end loop;
  if p_patch ? 'name' and length(btrim(coalesce(p_patch->>'name', ''))) = 0 then
    raise exception 'Enter the name' using errcode = '22023';
  end if;
  if p_patch ? 'roles' and jsonb_typeof(p_patch->'roles') <> 'array' then
    raise exception 'Roles must be a list' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_patch->>'vat_trn', ''))) > 40 or length(btrim(coalesce(p_patch->>'trade_licence_no', ''))) > 40 then
    raise exception 'Identifiers can be at most 40 characters' using errcode = '22023';
  end if;
  update crm_organisations set
    name = case when p_patch ? 'name' then btrim(p_patch->>'name') else name end,
    roles = case when p_patch ? 'roles' then array(select jsonb_array_elements_text(p_patch->'roles')) else roles end,
    country_code = case when p_patch ? 'country_code' then nullif(upper(btrim(p_patch->>'country_code')), '') else country_code end,
    website = case when p_patch ? 'website' then nullif(btrim(p_patch->>'website'), '') else website end,
    place = case when p_patch ? 'place' then nullif(btrim(p_patch->>'place'), '') else place end,
    note = case when p_patch ? 'note' then nullif(btrim(p_patch->>'note'), '') else note end,
    vat_trn = case when p_patch ? 'vat_trn' then nullif(btrim(p_patch->>'vat_trn'), '') else vat_trn end,
    trade_licence_no = case when p_patch ? 'trade_licence_no' then nullif(btrim(p_patch->>'trade_licence_no'), '') else trade_licence_no end
   where id = p_org;
end;
$$;

-- The fingerprint a preview records now also covers the two identifiers (a change to either after the preview makes the confirm refuse).
create or replace function crm_import_fingerprint(p_company uuid, p_name text, p_website text) returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(md5(jsonb_agg(x.j order by x.id)::text), 'none')
  from (
    select c.org_id as id, jsonb_build_object(
      'id', o.id, 'by_name', c.by_name, 'by_website', c.by_website, 'name', o.name, 'roles', o.roles, 'country', o.country_code,
      'website', o.website, 'note', o.note, 'vat_trn', o.vat_trn, 'trade_licence_no', o.trade_licence_no,
      'owner', p.owner_id, 'lead', p.lead_source, 'exhibition', p.exhibition,
      'contacts', (select coalesce(jsonb_agg(s.ck order by s.ck), '[]'::jsonb)
                   from (select coalesce(ct.email_key, 'n:' || crm_import_name_key(ct.name)) as ck
                         from crm_contacts ct where ct.organisation_id = o.id and ct.archived_at is null) s)
    ) as j
    from crm_import_candidates(p_name, p_website) c
    join crm_organisations o on o.id = c.org_id
    left join crm_account_profiles p on p.organisation_id = o.id and p.company_id = p_company
  ) x;
$$;

-- Apply one import row. Identical to the previous definition except for the two identifiers, which are FILL-ONLY: an existing value is
-- never replaced (a differing value is a conflict shown in the preview and left alone here).
create or replace function crm_import_apply_item(p_company uuid, it jsonb) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_n integer; v_org_id uuid; v_all_name boolean;
  v_org crm_organisations; v_profile crm_account_profiles;
  v_owner uuid := nullif(it->>'owner_id', '')::uuid;
  v_roles text[] := coalesce(array(select jsonb_array_elements_text(coalesce(it->'roles', '[]'::jsonb))), '{}'::text[]);
  v_country text := nullif(upper(btrim(it->>'country_code')), '');
  v_website text := nullif(btrim(it->>'website'), '');
  v_note text := nullif(btrim(it->>'note'), '');
  v_vat text := nullif(btrim(it->>'vat_trn'), '');
  v_lic text := nullif(btrim(it->>'trade_licence_no'), '');
  v_lead text := nullif(btrim(it->>'lead_source'), '');
  v_exh text := nullif(btrim(it->>'exhibition'), '');
  v_contacts jsonb := crm_import_clean_contacts(it->'contacts');
  c jsonb; v_email text; v_ckey text; v_added integer := 0; v_rows integer;
  v_org_changes boolean; v_prof_changes boolean; v_owner_set boolean := false;
begin
  select count(*), (array_agg(x.org_id))[1], bool_and(x.by_name) into v_n, v_org_id, v_all_name
    from crm_import_candidates(it->>'name', it->>'website') x;

  if v_n = 0 then
    perform crm_create_organisation_profile(btrim(it->>'name'), v_roles, v_country, v_website, null, v_note, p_company, v_lead, v_exh, v_owner, v_contacts, v_vat, v_lic);
    return jsonb_build_object('outcome', 'created', 'contacts_added', jsonb_array_length(v_contacts), 'owner_assigned', v_owner is not null);
  end if;
  if v_n > 1 or not v_all_name then
    return jsonb_build_object('outcome', 'ambiguous');
  end if;

  select * into v_org from crm_organisations where id = v_org_id for update;
  select * into v_profile from crm_account_profiles where organisation_id = v_org_id and company_id = p_company for update;
  v_org_changes :=
       (cardinality(v_org.roles) = 0 and cardinality(v_roles) > 0)
    or (nullif(btrim(coalesce(v_org.country_code, '')), '') is null and v_country is not null)
    or (nullif(btrim(coalesce(v_org.website, '')), '') is null and v_website is not null)
    or (nullif(btrim(coalesce(v_org.note, '')), '') is null and v_note is not null)
    or (v_org.vat_trn is null and v_vat is not null)
    or (v_org.trade_licence_no is null and v_lic is not null);
  v_prof_changes :=
       (v_profile.lead_source is null and v_lead is not null)
    or (nullif(btrim(coalesce(v_profile.exhibition, '')), '') is null and v_exh is not null);
  if v_org_changes and not crm_can_edit_organisation(v_org_id) then
    raise exception 'Only the person who added this organisation, a founder, or the owner of an opportunity it is on can change it' using errcode = '42501';
  end if;
  if v_prof_changes and not crm_can_edit_organisation(v_org_id, p_company) then
    raise exception 'Only the person who added this organisation, a founder of this company, or the owner of an opportunity it is on can change it' using errcode = '42501';
  end if;

  if v_org_changes then
    update crm_organisations set
      roles = case when cardinality(roles) = 0 and cardinality(v_roles) > 0 then v_roles else roles end,
      country_code = case when nullif(btrim(coalesce(country_code, '')), '') is null then coalesce(v_country, country_code) else country_code end,
      website = case when nullif(btrim(coalesce(website, '')), '') is null then coalesce(v_website, website) else website end,
      note = case when nullif(btrim(coalesce(note, '')), '') is null then coalesce(v_note, note) else note end,
      vat_trn = coalesce(vat_trn, v_vat),
      trade_licence_no = coalesce(trade_licence_no, v_lic)
     where id = v_org_id;
  end if;
  if v_prof_changes then
    insert into crm_account_profiles (organisation_id, company_id, lead_source, exhibition) values (v_org_id, p_company, v_lead, v_exh)
    on conflict (organisation_id, company_id) do update set
      lead_source = coalesce(crm_account_profiles.lead_source, excluded.lead_source),
      exhibition = coalesce(nullif(btrim(crm_account_profiles.exhibition), ''), excluded.exhibition);
  end if;
  if v_owner is not null then
    insert into crm_account_profiles (organisation_id, company_id, owner_id, owner_assigned_by, owner_assigned_at)
    values (v_org_id, p_company, v_owner, auth.uid(), now())
    on conflict (organisation_id, company_id) do update
      set owner_id = excluded.owner_id, owner_assigned_by = excluded.owner_assigned_by, owner_assigned_at = excluded.owner_assigned_at
      where crm_account_profiles.owner_id is null;
    get diagnostics v_rows = row_count;
    v_owner_set := v_rows > 0;
  end if;
  for c in select * from jsonb_array_elements(v_contacts) loop
    v_email := nullif(lower(btrim(c->>'email')), '');
    v_ckey := crm_import_name_key(c->>'name');
    if exists (
      select 1 from crm_contacts ct where ct.organisation_id = v_org_id and ct.archived_at is null
        and (case when v_email is not null then ct.email_key = v_email or (ct.email_key is null and crm_import_name_key(ct.name) = v_ckey)
                  else crm_import_name_key(ct.name) = v_ckey end)
    ) then continue; end if;
    begin
      insert into crm_contacts (organisation_id, name, role_title, email, phone, created_by)
      values (v_org_id, btrim(c->>'name'), nullif(btrim(c->>'role_title'), ''), v_email, nullif(btrim(c->>'phone'), ''), auth.uid());
      v_added := v_added + 1;
    exception when unique_violation then null;
    end;
  end loop;
  return jsonb_build_object('outcome', case when v_org_changes or v_prof_changes or v_owner_set or v_added > 0 then 'updated' else 'unchanged' end,
                            'contacts_added', v_added, 'owner_assigned', v_owner_set);
end;
$$;

-- -----------------------------------------------------------------------------
-- B. Issuer details on the company's own record
-- -----------------------------------------------------------------------------
alter table companies add column if not exists trn text;
alter table companies add column if not exists address text;
alter table companies add column if not exists phone text;
alter table companies add column if not exists email text;
alter table companies add column if not exists website text;
alter table companies add column if not exists logo_path text;
alter table companies drop constraint if exists companies_issuer_shape;
alter table companies add constraint companies_issuer_shape check (
  (trn is null or length(trn) <= 40) and (address is null or length(address) <= 500) and (phone is null or length(phone) <= 60)
  and (email is null or length(email) <= 200) and (website is null or length(website) <= 300) and (logo_path is null or length(logo_path) <= 300));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Records an already uploaded logo (the server validated the bytes and uploaded with the service role). System Administrator only.
create or replace function crm_set_company_logo(p_company uuid, p_path text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform crm_require_user();
  if not has_role('sys_admin') then raise exception 'Only a System Administrator can change company details' using errcode = '42501'; end if;
  if p_path is not null then
    if p_path !~ ('^' || p_company::text || '/[0-9a-f-]{36}-logo\.(png|jpg|webp)$') then
      raise exception 'Invalid logo path' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'company-logos' and name = p_path) then
      raise exception 'The logo file was not found' using errcode = 'P0002';
    end if;
  end if;
  update companies set logo_path = p_path where id = p_company;
  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- C-E. Quotation tables
-- -----------------------------------------------------------------------------
create table if not exists crm_quote_counters (
  company_id  uuid not null references companies(id),
  year        integer not null,
  last_value  integer not null default 0,
  primary key (company_id, year)
);

-- Company-level VAT choices ("0%" and "Out of scope" are separate explicit choices; nothing is inferred from a country).
create table if not exists crm_quote_vat_choices (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  label       text not null check (length(btrim(label)) between 1 and 60),
  kind        text not null check (kind in ('rate', 'out_of_scope')),
  rate        numeric(5, 2) check (rate is null or rate between 0 and 100),
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint crm_quote_vat_choice_shape check ((kind = 'rate' and rate is not null) or (kind = 'out_of_scope' and rate is null))
);
create unique index if not exists uq_crm_quote_vat_choices_label on crm_quote_vat_choices(company_id, lower(btrim(label)));

-- Company-level standard terms template (editable). label says it is a working draft until legal review.
create table if not exists crm_quote_terms_templates (
  company_id  uuid primary key references companies(id),
  label       text not null default 'Standard terms (working draft, pending legal review)',
  clauses     jsonb not null check (jsonb_typeof(clauses) = 'array'),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

create or replace function crm_quote_default_terms() returns jsonb
language sql immutable
as $$
  select jsonb_build_array(
    jsonb_build_object('title', 'Site access and readiness', 'body', 'Before mobilisation, the client or nominated main contractor will arrange site access, passes and permits, and provide a clean, dust-free and secure work area ready for installation.'),
    jsonb_build_object('title', 'Site services and other trades', 'body', 'Unless expressly included in the BOQ, civil and MEPFS works, site lighting and temporary power, cable routes and cabling, and third-party inspections and approvals are excluded. The client or nominated contractor will coordinate and provide these items where required.'),
    jsonb_build_object('title', 'Changes', 'body', 'Changes to event dates, scope, quantities or site conditions may affect the price and programme. Enginious will submit any revised price or schedule for written approval before proceeding with the affected work.'),
    jsonb_build_object('title', 'Start of work', 'body', 'Work begins after written acceptance of the quotation and receipt of the initial payment stated in the payment schedule. The quotation will show its validity date, payment milestones, and any delivery or installation assumptions.'),
    jsonb_build_object('title', 'Scope exclusions', 'body', 'Accreditation, third-party certification or compliance services, and intellectual property transfers or licences are included only where expressly stated in the quotation.'),
    jsonb_build_object('title', 'Confidentiality', 'body', 'This quotation and its supporting materials are provided to the named recipient for evaluation of the proposed work.'));
$$;

insert into crm_quote_terms_templates (company_id, clauses)
select c.id, crm_quote_default_terms() from companies c
on conflict (company_id) do nothing;

insert into crm_quote_vat_choices (company_id, label, kind, rate, position)
select c.id, v.label, v.kind, v.rate, v.pos
from companies c
cross join (values ('Out of scope', 'out_of_scope', null::numeric, 0), ('0%', 'rate', 0::numeric, 1), ('5%', 'rate', 5::numeric, 2),
                   ('15%', 'rate', 15::numeric, 3), ('23%', 'rate', 23::numeric, 4)) as v(label, kind, rate, pos)
on conflict do nothing;

create table if not exists crm_quotations (
  proposal_id          uuid primary key references crm_proposals(id),
  opportunity_id       uuid not null references crm_opportunities(id),
  company_id           uuid not null references companies(id),
  reference            text not null,
  revision             integer not null default 1 check (revision >= 1),
  previous_proposal_id uuid references crm_proposals(id),
  currency             text check (currency is null or currency in ('AED', 'SAR', 'PLN', 'EUR', 'USD')),
  vat_choice_id        uuid references crm_quote_vat_choices(id),
  vat_kind             text check (vat_kind is null or vat_kind in ('rate', 'out_of_scope')),
  vat_label            text,
  vat_rate             numeric(5, 2),
  bill_to_org_id       uuid references crm_organisations(id),
  validity_date        date,
  issue_date           date,
  milestones           jsonb not null default '[]'::jsonb check (jsonb_typeof(milestones) = 'array'),
  terms_label          text,
  terms                jsonb not null default '[]'::jsonb check (jsonb_typeof(terms) = 'array'),
  internal_notes       text check (internal_notes is null or length(internal_notes) <= 4000),   -- INTERNAL ONLY: never in the snapshot or any export
  content_changed_at   timestamptz not null default now(),
  issued_at            timestamptz,
  issued_by            uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  unique (company_id, reference, revision)
);
create index if not exists idx_crm_quotations_opp on crm_quotations(opportunity_id);

create table if not exists crm_quotation_sections (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references crm_quotations(proposal_id),
  company_id   uuid not null references companies(id),
  position     integer not null default 0,
  title        text not null check (length(btrim(title)) between 1 and 120)
);
create index if not exists idx_crm_quotation_sections_p on crm_quotation_sections(proposal_id, position);

create table if not exists crm_quotation_lines (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references crm_quotations(proposal_id),
  section_id     uuid not null references crm_quotation_sections(id) on delete cascade,
  company_id     uuid not null references companies(id),
  position       integer not null default 0,
  description    text not null check (length(btrim(description)) between 1 and 4000),
  image_file_id  uuid references crm_files(id),
  unit           text check (unit is null or length(unit) <= 20),
  quantity       numeric(14, 3) not null check (quantity > 0),
  unit_price     numeric(16, 4) not null check (unit_price >= 0),
  vat_choice_id  uuid references crm_quote_vat_choices(id),     -- per-line override; null = the quotation's VAT choice
  vat_kind       text check (vat_kind is null or vat_kind in ('rate', 'out_of_scope')),
  vat_label      text,
  vat_rate       numeric(5, 2)
);
create index if not exists idx_crm_quotation_lines_s on crm_quotation_lines(section_id, position);

create table if not exists crm_quotation_snapshots (
  proposal_id    uuid primary key references crm_proposals(id),
  opportunity_id uuid not null references crm_opportunities(id),
  company_id     uuid not null references companies(id),
  reference      text not null,
  revision       integer not null,
  content        jsonb not null check (jsonb_typeof(content) = 'object'),
  content_hash   text not null,
  issued_by      uuid not null references auth.users(id),
  issued_at      timestamptz not null default now(),
  unique (company_id, reference, revision)
);

-- Guards -----------------------------------------------------------------------
create or replace function crm_quotation_frozen() returns trigger
language plpgsql
as $$
begin
  raise exception 'An issued quotation and its snapshot are never edited or deleted. Create a revision instead.' using errcode = '55000';
end;
$$;

create or replace function crm_quotation_guard() returns trigger
language plpgsql
as $$
begin
  if old.issued_at is not null then
    raise exception 'An issued quotation cannot be edited or deleted. Create a revision instead.' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function crm_quotation_body_guard() returns trigger
language plpgsql
as $$
declare v_p uuid := case when tg_op = 'DELETE' then old.proposal_id else new.proposal_id end;
begin
  if exists (select 1 from crm_quotations where proposal_id = v_p and issued_at is not null) then
    raise exception 'An issued quotation cannot be edited. Create a revision instead.' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists crm_quotation_snapshots_frozen_row on crm_quotation_snapshots;
create trigger crm_quotation_snapshots_frozen_row before update or delete on crm_quotation_snapshots for each row execute function crm_quotation_frozen();
drop trigger if exists crm_quotation_snapshots_frozen_truncate on crm_quotation_snapshots;
create trigger crm_quotation_snapshots_frozen_truncate before truncate on crm_quotation_snapshots for each statement execute function crm_quotation_frozen();
drop trigger if exists crm_quotations_guard_row on crm_quotations;
create trigger crm_quotations_guard_row before update or delete on crm_quotations for each row execute function crm_quotation_guard();
drop trigger if exists crm_quotation_sections_guard on crm_quotation_sections;
create trigger crm_quotation_sections_guard before insert or update or delete on crm_quotation_sections for each row execute function crm_quotation_body_guard();
drop trigger if exists crm_quotation_lines_guard on crm_quotation_lines;
create trigger crm_quotation_lines_guard before insert or update or delete on crm_quotation_lines for each row execute function crm_quotation_body_guard();

-- RLS: SELECT only for people with access to the company ----------------------------------
do $$
declare t text;
begin
  foreach t in array array['crm_quote_counters', 'crm_quote_vat_choices', 'crm_quote_terms_templates', 'crm_quotations',
                           'crm_quotation_sections', 'crm_quotation_lines', 'crm_quotation_snapshots'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
  foreach t in array array['crm_quote_vat_choices', 'crm_quote_terms_templates', 'crm_quotations', 'crm_quotation_sections',
                           'crm_quotation_lines', 'crm_quotation_snapshots'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (crm_has_access(company_id))', t || '_select', t);
  end loop;
end $$;
revoke all on table crm_quote_counters, crm_quote_vat_choices, crm_quote_terms_templates, crm_quotations, crm_quotation_sections,
  crm_quotation_lines, crm_quotation_snapshots from anon, authenticated, public;
grant select on table crm_quote_vat_choices, crm_quote_terms_templates, crm_quotations, crm_quotation_sections, crm_quotation_lines,
  crm_quotation_snapshots to authenticated;

-- -----------------------------------------------------------------------------
-- Functions
-- -----------------------------------------------------------------------------
-- Loads a quotation the caller may EDIT (existing proposal rule: owner or founder), locked, still a draft.
create or replace function crm_quote_load_editable(p_proposal uuid) returns crm_quotations
language plpgsql security definer
set search_path = public
as $$
declare q crm_quotations; v crm_opportunities;
begin
  perform crm_require_user();
  select * into q from crm_quotations where proposal_id = p_proposal;
  if not found or not crm_has_access(q.company_id) then
    raise exception 'Quotation not found' using errcode = 'P0002';
  end if;
  v := crm_lock_opportunity(q.opportunity_id);
  perform crm_require_owner_or_founder(v);
  select * into q from crm_quotations where proposal_id = p_proposal for update;
  if q.issued_at is not null then
    raise exception 'An issued quotation cannot be edited. Create a revision instead.' using errcode = '55000';
  end if;
  if v.stage in ('won', 'lost') then
    raise exception 'A closed opportunity cannot change quotations' using errcode = '23514';
  end if;
  return q;
end;
$$;

create or replace function crm_quote_touch(p_proposal uuid) returns void
language sql security definer set search_path = public
as $$ update crm_quotations set content_changed_at = now() where proposal_id = p_proposal; $$;

-- New draft estimate from an enquiry. Reference from the per-company counter; terms copied from the company template.
create or replace function crm_quote_create(p_opportunity uuid) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v crm_opportunities; v_id uuid; v_next integer; v_year integer := extract(year from (now() at time zone 'Asia/Dubai'))::integer;
  v_seq integer; v_code text; v_tpl crm_quote_terms_templates;
begin
  v := crm_lock_opportunity(p_opportunity);
  perform crm_require_owner_or_founder(v);
  if v.stage in ('won', 'lost') then raise exception 'A closed opportunity cannot get new proposals' using errcode = '23514'; end if;
  select reference_code into v_code from crm_company_settings where company_id = v.company_id;
  if v_code is null then raise exception 'Sales settings are not set up for this company' using errcode = '23514'; end if;
  select coalesce(max(version), 0) + 1 into v_next from crm_proposals where opportunity_id = v.id;
  insert into crm_proposals (opportunity_id, company_id, version, note, created_by)
  values (v.id, v.company_id, v_next, 'Estimate (quotation builder)', auth.uid()) returning id into v_id;
  insert into crm_quote_counters (company_id, year, last_value) values (v.company_id, v_year, 1)
  on conflict (company_id, year) do update set last_value = crm_quote_counters.last_value + 1 returning last_value into v_seq;
  select * into v_tpl from crm_quote_terms_templates where company_id = v.company_id;
  insert into crm_quotations (proposal_id, opportunity_id, company_id, reference, revision, terms_label, terms)
  values (v_id, v.id, v.company_id, format('QUO-%s-%s-%s', v_code, v_year, lpad(v_seq::text, 4, '0')), 1,
          coalesce(v_tpl.label, 'Standard terms (working draft, pending legal review)'), coalesce(v_tpl.clauses, crm_quote_default_terms()));
  perform crm_log_event(v.id, v.company_id, 'proposal', null, 'v' || v_next || ' estimate draft');
  return v_id;
end;
$$;

-- Header fields: currency, vat_choice_id, bill_to_org_id, validity_date, internal_notes, milestones, terms, terms_label.
create or replace function crm_quote_save_header(p_proposal uuid, p_patch jsonb) returns void
language plpgsql security definer
set search_path = public
as $$
declare q crm_quotations; k text; ch crm_quote_vat_choices; v_cur text; m jsonb; v_kind text;
  v_allowed text[] := array['currency', 'vat_choice_id', 'bill_to_org_id', 'validity_date', 'internal_notes', 'milestones', 'terms', 'terms_label'];
begin
  q := crm_quote_load_editable(p_proposal);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Nothing to change' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_allowed)) then raise exception 'Field % cannot be changed here', k using errcode = '22023'; end if;
  end loop;
  if p_patch ? 'currency' then
    v_cur := nullif(upper(btrim(p_patch->>'currency')), '');
    if v_cur is not null and v_cur not in ('AED', 'SAR', 'PLN', 'EUR', 'USD') then raise exception 'Choose one of AED, SAR, PLN, EUR or USD' using errcode = '22023'; end if;
    update crm_quotations set currency = v_cur where proposal_id = p_proposal;
  end if;
  if p_patch ? 'vat_choice_id' then
    if nullif(p_patch->>'vat_choice_id', '') is null then
      update crm_quotations set vat_choice_id = null, vat_kind = null, vat_label = null, vat_rate = null where proposal_id = p_proposal;
    else
      select * into ch from crm_quote_vat_choices where id = (p_patch->>'vat_choice_id')::uuid and company_id = q.company_id and active;
      if not found then raise exception 'That VAT choice is not available for this company' using errcode = '22023'; end if;
      update crm_quotations set vat_choice_id = ch.id, vat_kind = ch.kind, vat_label = ch.label, vat_rate = ch.rate where proposal_id = p_proposal;
    end if;
  end if;
  if p_patch ? 'bill_to_org_id' then
    if nullif(p_patch->>'bill_to_org_id', '') is not null and not exists (
         select 1 from crm_organisations where id = (p_patch->>'bill_to_org_id')::uuid and archived_at is null) then
      raise exception 'That organisation was not found' using errcode = '22023';
    end if;
    update crm_quotations set bill_to_org_id = nullif(p_patch->>'bill_to_org_id', '')::uuid where proposal_id = p_proposal;
  end if;
  if p_patch ? 'validity_date' then
    update crm_quotations set validity_date = nullif(p_patch->>'validity_date', '')::date where proposal_id = p_proposal;
  end if;
  if p_patch ? 'internal_notes' then
    update crm_quotations set internal_notes = nullif(btrim(p_patch->>'internal_notes'), '') where proposal_id = p_proposal;
  end if;
  if p_patch ? 'terms_label' then
    update crm_quotations set terms_label = nullif(btrim(p_patch->>'terms_label'), '') where proposal_id = p_proposal;
  end if;
  if p_patch ? 'terms' then
    if jsonb_typeof(p_patch->'terms') <> 'array' or jsonb_array_length(p_patch->'terms') > 40 then raise exception 'Terms must be a list of at most 40 clauses' using errcode = '22023'; end if;
    for m in select * from jsonb_array_elements(p_patch->'terms') loop
      if jsonb_typeof(m) <> 'object' or length(btrim(coalesce(m->>'title', ''))) = 0 or length(btrim(coalesce(m->>'body', ''))) = 0
         or length(m->>'title') > 120 or length(m->>'body') > 3000 then
        raise exception 'Every clause needs a title and text' using errcode = '22023';
      end if;
    end loop;
    update crm_quotations set terms = (select coalesce(jsonb_agg(jsonb_build_object('title', btrim(e->>'title'), 'body', btrim(e->>'body'))), '[]'::jsonb)
                                         from jsonb_array_elements(p_patch->'terms') e) where proposal_id = p_proposal;
  end if;
  if p_patch ? 'milestones' then
    if jsonb_typeof(p_patch->'milestones') <> 'array' or jsonb_array_length(p_patch->'milestones') > 20 then raise exception 'Payment milestones must be a list of at most 20' using errcode = '22023'; end if;
    for m in select * from jsonb_array_elements(p_patch->'milestones') loop
      v_kind := m->>'kind';
      if jsonb_typeof(m) <> 'object' or length(btrim(coalesce(m->>'label', ''))) = 0 or length(m->>'label') > 120
         or v_kind not in ('percent', 'amount') or coalesce(m->>'value', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' or (m->>'value')::numeric <= 0
         or (v_kind = 'percent' and (m->>'value')::numeric > 100) or length(coalesce(m->>'due', '')) > 200 then
        raise exception 'Every milestone needs a label, and a percentage (up to 100) or an amount above zero' using errcode = '22023';
      end if;
    end loop;
    if (select count(distinct e->>'kind') from jsonb_array_elements(p_patch->'milestones') e) > 1 then
      raise exception 'Use either percentages or amounts for all milestones, not both' using errcode = '22023';
    end if;
    update crm_quotations set milestones = (select coalesce(jsonb_agg(jsonb_build_object('label', btrim(e->>'label'), 'kind', e->>'kind',
                                              'value', trim_scale((e->>'value')::numeric)::text, 'due', nullif(btrim(coalesce(e->>'due', '')), ''))), '[]'::jsonb)
                                              from jsonb_array_elements(p_patch->'milestones') e) where proposal_id = p_proposal;
  end if;
  perform crm_quote_touch(p_proposal);
end;
$$;

create or replace function crm_quote_save_section(p_proposal uuid, p_section uuid, p_title text) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare q crm_quotations; v_id uuid;
begin
  q := crm_quote_load_editable(p_proposal);
  if length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Give the section a name (120 characters at most)' using errcode = '22023'; end if;
  if p_section is null then
    insert into crm_quotation_sections (proposal_id, company_id, position, title)
    values (p_proposal, q.company_id, (select coalesce(max(position), 0) + 1 from crm_quotation_sections where proposal_id = p_proposal), btrim(p_title))
    returning id into v_id;
  else
    update crm_quotation_sections set title = btrim(p_title) where id = p_section and proposal_id = p_proposal returning id into v_id;
    if v_id is null then raise exception 'Section not found' using errcode = 'P0002'; end if;
  end if;
  perform crm_quote_touch(p_proposal);
  return v_id;
end;
$$;

create or replace function crm_quote_delete_section(p_section uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_p uuid;
begin
  select proposal_id into v_p from crm_quotation_sections where id = p_section;
  if v_p is null then raise exception 'Section not found' using errcode = 'P0002'; end if;
  perform crm_quote_load_editable(v_p);
  delete from crm_quotation_lines where section_id = p_section;
  delete from crm_quotation_sections where id = p_section;
  perform crm_quote_touch(v_p);
end;
$$;

-- Line fields: description, unit, quantity, unit_price, vat_choice_id (null = same as the quotation), image_file_id (null = none).
create or replace function crm_quote_save_line(p_proposal uuid, p_line uuid, p_section uuid, p_patch jsonb) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare q crm_quotations; l crm_quotation_lines; k text; ch crm_quote_vat_choices; f crm_files; v_id uuid;
  v_allowed text[] := array['description', 'unit', 'quantity', 'unit_price', 'vat_choice_id', 'image_file_id'];
begin
  q := crm_quote_load_editable(p_proposal);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_allowed)) then raise exception 'Field % cannot be changed here', k using errcode = '22023'; end if;
  end loop;
  if not exists (select 1 from crm_quotation_sections where id = p_section and proposal_id = p_proposal) then
    raise exception 'Section not found' using errcode = 'P0002';
  end if;
  if p_line is null then
    if length(btrim(coalesce(p_patch->>'description', ''))) = 0 then raise exception 'Describe the item' using errcode = '22023'; end if;
    insert into crm_quotation_lines (proposal_id, section_id, company_id, position, description, quantity, unit_price)
    values (p_proposal, p_section, q.company_id, (select coalesce(max(position), 0) + 1 from crm_quotation_lines where section_id = p_section),
            'x', 1, 0) returning id into v_id;
  else
    select * into l from crm_quotation_lines where id = p_line and proposal_id = p_proposal;
    if not found then raise exception 'Line not found' using errcode = 'P0002'; end if;
    v_id := l.id;
    if l.section_id <> p_section then
      update crm_quotation_lines set section_id = p_section,
             position = (select coalesce(max(position), 0) + 1 from crm_quotation_lines where section_id = p_section) where id = v_id;
    end if;
  end if;
  if p_patch ? 'description' then
    if length(btrim(coalesce(p_patch->>'description', ''))) not between 1 and 4000 then raise exception 'Describe the item (4000 characters at most)' using errcode = '22023'; end if;
    update crm_quotation_lines set description = btrim(p_patch->>'description') where id = v_id;
  end if;
  if p_patch ? 'unit' then
    if length(coalesce(p_patch->>'unit', '')) > 20 then raise exception 'The unit is too long (20 characters at most)' using errcode = '22023'; end if;
    update crm_quotation_lines set unit = nullif(btrim(p_patch->>'unit'), '') where id = v_id;
  end if;
  if p_patch ? 'quantity' then
    if coalesce(p_patch->>'quantity', '') !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$' or (p_patch->>'quantity')::numeric <= 0 then
      raise exception 'Quantity must be a number above zero (at most 3 decimals)' using errcode = '22023';
    end if;
    update crm_quotation_lines set quantity = (p_patch->>'quantity')::numeric where id = v_id;
  end if;
  if p_patch ? 'unit_price' then
    if coalesce(p_patch->>'unit_price', '') !~ '^[0-9]{1,12}(\.[0-9]{1,4})?$' then
      raise exception 'The unit price must be zero or more (at most 4 decimals), not negative' using errcode = '22023';
    end if;
    update crm_quotation_lines set unit_price = (p_patch->>'unit_price')::numeric where id = v_id;
  end if;
  if p_patch ? 'vat_choice_id' then
    if nullif(p_patch->>'vat_choice_id', '') is null then
      update crm_quotation_lines set vat_choice_id = null, vat_kind = null, vat_label = null, vat_rate = null where id = v_id;
    else
      select * into ch from crm_quote_vat_choices where id = (p_patch->>'vat_choice_id')::uuid and company_id = q.company_id and active;
      if not found then raise exception 'That VAT choice is not available for this company' using errcode = '22023'; end if;
      update crm_quotation_lines set vat_choice_id = ch.id, vat_kind = ch.kind, vat_label = ch.label, vat_rate = ch.rate where id = v_id;
    end if;
  end if;
  if p_patch ? 'image_file_id' then
    if nullif(p_patch->>'image_file_id', '') is null then
      update crm_quotation_lines set image_file_id = null where id = v_id;
    else
      select * into f from crm_files where id = (p_patch->>'image_file_id')::uuid and deleted_at is null;
      if not found or f.opportunity_id <> q.opportunity_id or f.kind <> 'file' then
        raise exception 'That image does not belong to this enquiry' using errcode = '22023';
      end if;
      if f.mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
        raise exception 'The picture must be a JPEG, PNG or WebP image' using errcode = '22023';
      end if;
      if f.size_bytes > 5242880 then raise exception 'The picture must be 5 MB or smaller' using errcode = '22023'; end if;
      update crm_quotation_lines set image_file_id = f.id where id = v_id;
    end if;
  end if;
  perform crm_quote_touch(p_proposal);
  return v_id;
end;
$$;

create or replace function crm_quote_delete_line(p_line uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_p uuid;
begin
  select proposal_id into v_p from crm_quotation_lines where id = p_line;
  if v_p is null then raise exception 'Line not found' using errcode = 'P0002'; end if;
  perform crm_quote_load_editable(v_p);
  delete from crm_quotation_lines where id = p_line;
  perform crm_quote_touch(v_p);
end;
$$;

-- Reorder: p_kind 'sections' (p_scope ignored) or 'lines' (p_scope = the section). p_ids must be exactly the current ids.
create or replace function crm_quote_reorder(p_proposal uuid, p_kind text, p_scope uuid, p_ids uuid[]) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_have uuid[];
begin
  perform crm_quote_load_editable(p_proposal);
  if p_kind = 'sections' then
    select array_agg(id order by id) into v_have from crm_quotation_sections where proposal_id = p_proposal;
    if coalesce(v_have, '{}') <> coalesce((select array_agg(x order by x) from unnest(p_ids) x), '{}') then raise exception 'The list changed. Reload and try again' using errcode = '40001'; end if;
    update crm_quotation_sections s set position = o.n from unnest(p_ids) with ordinality as o(id, n) where s.id = o.id;
  elsif p_kind = 'lines' then
    select array_agg(id order by id) into v_have from crm_quotation_lines where proposal_id = p_proposal and section_id = p_scope;
    if coalesce(v_have, '{}') <> coalesce((select array_agg(x order by x) from unnest(p_ids) x), '{}') then raise exception 'The list changed. Reload and try again' using errcode = '40001'; end if;
    update crm_quotation_lines s set position = o.n from unnest(p_ids) with ordinality as o(id, n) where s.id = o.id;
  else
    raise exception 'Unknown list' using errcode = '22023';
  end if;
  perform crm_quote_touch(p_proposal);
end;
$$;

create or replace function crm_quote_minor_units(p_currency text) returns integer
language sql immutable as $$ select 2 $$;

-- Builds the client-facing content from the tables (internal_notes is never read). Used by issuing only.
create or replace function crm_quote_build_content(p_proposal uuid, p_issue_date date) returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  q crm_quotations; co companies; org crm_organisations; opp crm_opportunities; s record; l record;
  v_minor integer; v_num integer := 0; v_lines jsonb; v_sections jsonb := '[]'::jsonb;
  v_net numeric; v_vat numeric; v_rate numeric; v_kind text; v_label text;
  s_net numeric; s_vat numeric; t_net numeric := 0; t_vat numeric := 0; v_img jsonb; f crm_files; v_ms jsonb; m jsonb; v_amount numeric;
begin
  select * into q from crm_quotations where proposal_id = p_proposal;
  select * into co from companies where id = q.company_id;
  select * into org from crm_organisations where id = q.bill_to_org_id;
  select * into opp from crm_opportunities where id = q.opportunity_id;
  v_minor := crm_quote_minor_units(q.currency);
  for s in select * from crm_quotation_sections where proposal_id = p_proposal order by position, id loop
    v_lines := '[]'::jsonb; s_net := 0; s_vat := 0;
    for l in select * from crm_quotation_lines where section_id = s.id order by position, id loop
      v_num := v_num + 1;
      v_kind := coalesce(l.vat_kind, q.vat_kind); v_label := coalesce(l.vat_label, q.vat_label);
      v_rate := case when v_kind = 'rate' then coalesce(l.vat_rate, q.vat_rate) else null end;
      v_net := round(l.quantity * l.unit_price, v_minor);
      v_vat := round(v_net * coalesce(v_rate, 0) / 100, v_minor);
      s_net := s_net + v_net; s_vat := s_vat + v_vat;
      v_img := null;
      if l.image_file_id is not null then
        select * into f from crm_files where id = l.image_file_id;
        v_img := jsonb_build_object('file_id', f.id, 'storage_path', f.storage_path, 'mime_type', f.mime_type, 'original_name', f.original_name, 'size_bytes', f.size_bytes);
      end if;
      v_lines := v_lines || jsonb_build_object(
        'number', v_num, 'description', l.description, 'image', v_img, 'unit', l.unit,
        'quantity', trim_scale(l.quantity)::text, 'unit_price', trim_scale(l.unit_price)::text,
        'vat', jsonb_build_object('kind', v_kind, 'label', v_label, 'rate', case when v_rate is null then null else trim_scale(v_rate)::text end),
        'amount_net', to_char(v_net, 'FM999999999999990.00'), 'vat_amount', to_char(v_vat, 'FM999999999999990.00'),
        'amount_gross', to_char(v_net + v_vat, 'FM999999999999990.00'));
    end loop;
    t_net := t_net + s_net; t_vat := t_vat + s_vat;
    v_sections := v_sections || jsonb_build_object('title', s.title, 'lines', v_lines,
      'subtotal_net', to_char(s_net, 'FM999999999999990.00'), 'subtotal_vat', to_char(s_vat, 'FM999999999999990.00'),
      'subtotal_gross', to_char(s_net + s_vat, 'FM999999999999990.00'));
  end loop;
  v_ms := '[]'::jsonb;
  for m in select * from jsonb_array_elements(q.milestones) loop
    v_amount := case when m->>'kind' = 'percent' then round((t_net + t_vat) * (m->>'value')::numeric / 100, v_minor) else (m->>'value')::numeric end;
    v_ms := v_ms || jsonb_build_object('label', m->>'label', 'kind', m->>'kind', 'value', m->>'value', 'due', m->>'due',
                                       'amount', to_char(v_amount, 'FM999999999999990.00'));
  end loop;
  return jsonb_build_object(
    'schema_version', 1,
    'reference', q.reference, 'revision', q.revision, 'issue_date', p_issue_date, 'validity_date', q.validity_date,
    'enquiry', jsonb_build_object('reference', opp.reference, 'title', opp.title),
    'issuer', jsonb_build_object('company_id', co.id, 'legal_name', co.legal_name, 'trn', co.trn, 'address', co.address, 'phone', co.phone,
                                 'email', co.email, 'website', co.website, 'logo_path', co.logo_path, 'country_code', co.country_code),
    'bill_to', jsonb_build_object('organisation_id', org.id, 'name', org.name, 'address', org.place, 'country_code', org.country_code,
                                  'vat_trn', org.vat_trn, 'trade_licence_no', org.trade_licence_no),
    'currency', q.currency, 'minor_units', v_minor,
    'vat', jsonb_build_object('kind', q.vat_kind, 'label', q.vat_label, 'rate', case when q.vat_kind = 'rate' then trim_scale(q.vat_rate)::text end),
    'sections', v_sections,
    'totals', jsonb_build_object('net', to_char(t_net, 'FM999999999999990.00'), 'vat', to_char(t_vat, 'FM999999999999990.00'),
                                 'gross', to_char(t_net + t_vat, 'FM999999999999990.00')),
    'milestones', v_ms,
    'terms', jsonb_build_object('label', q.terms_label, 'clauses', q.terms));
end;
$$;

-- Issue: validates, requires the existing commercial approval when the policy is 'required', freezes the snapshot, supersedes older revisions.
create or replace function crm_quote_issue(p_proposal uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  q crm_quotations; co companies; v_policy text; v_today date := crm_today_dubai(); v_content jsonb; v_gross numeric; v_sum numeric; m jsonb;
  v_bad integer;
begin
  q := crm_quote_load_editable(p_proposal);
  select * into co from companies where id = q.company_id;
  if length(btrim(coalesce(co.legal_name, ''))) = 0 then raise exception 'The issuing company has no legal name. Ask a System Administrator to add it on the Companies screen' using errcode = '23514'; end if;
  if q.currency is null then raise exception 'Choose the currency before issuing' using errcode = '23514'; end if;
  if q.vat_kind is null then raise exception 'Choose the VAT treatment before issuing' using errcode = '23514'; end if;
  if q.bill_to_org_id is null then raise exception 'Choose who the quotation is billed to before issuing' using errcode = '23514'; end if;
  if not exists (select 1 from crm_quotation_lines where proposal_id = p_proposal) then raise exception 'Add at least one item before issuing' using errcode = '23514'; end if;
  if exists (select 1 from crm_quotation_sections s where s.proposal_id = p_proposal and not exists (select 1 from crm_quotation_lines l where l.section_id = s.id)) then
    raise exception 'A section has no items. Add items or delete the section' using errcode = '23514';
  end if;
  if q.validity_date is not null and q.validity_date < v_today then raise exception 'The validity date is in the past' using errcode = '23514'; end if;
  select approval_policy into v_policy from crm_company_settings where company_id = q.company_id;
  if coalesce(v_policy, 'not_configured') = 'required' and not exists (
       select 1 from crm_approvals a where a.proposal_id = p_proposal and a.state = 'approved' and a.decided_at >= q.content_changed_at) then
    raise exception 'This quotation needs a founder''s approval, given after the last change, before it can be issued. Request approval first' using errcode = '23514';
  end if;
  v_content := crm_quote_build_content(p_proposal, v_today);
  v_gross := (v_content->'totals'->>'gross')::numeric;
  if jsonb_array_length(q.milestones) > 0 then
    if (q.milestones->0->>'kind') = 'percent' then
      select coalesce(sum((e->>'value')::numeric), 0) into v_sum from jsonb_array_elements(q.milestones) e;
      if v_sum <> 100 then raise exception 'Payment milestones must add up to 100%% (they add up to %)', v_sum using errcode = '23514'; end if;
    else
      select coalesce(sum((e->>'value')::numeric), 0) into v_sum from jsonb_array_elements(q.milestones) e;
      if v_sum <> v_gross then raise exception 'Payment milestone amounts must add up to the total including VAT (%)', v_gross using errcode = '23514'; end if;
    end if;
  end if;
  update crm_quotations set issued_at = now(), issued_by = auth.uid(), issue_date = v_today where proposal_id = p_proposal;
  insert into crm_quotation_snapshots (proposal_id, opportunity_id, company_id, reference, revision, content, content_hash, issued_by)
  values (p_proposal, q.opportunity_id, q.company_id, q.reference, q.revision, v_content, md5(v_content::text), auth.uid());
  -- A new revision replaces the earlier ones (draft or sent): they stay as they are, only their status becomes superseded.
  update crm_proposals p set status = 'superseded'
   where p.status in ('draft', 'sent') and p.id <> p_proposal
     and p.id in (select proposal_id from crm_quotations where company_id = q.company_id and reference = q.reference and revision < q.revision);
  perform crm_log_event(q.opportunity_id, q.company_id, 'proposal', null, q.reference || ' rev ' || q.revision || ' issued');
end;
$$;

-- A new draft copy of an ISSUED quotation (same reference, revision + 1). The copy needs its own approval and its own issue.
create or replace function crm_quote_create_revision(p_proposal uuid) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  q crm_quotations; v crm_opportunities; v_id uuid; v_next integer; v_rev integer; s record; v_new uuid;
begin
  perform crm_require_user();
  select * into q from crm_quotations where proposal_id = p_proposal;
  if not found or not crm_has_access(q.company_id) then raise exception 'Quotation not found' using errcode = 'P0002'; end if;
  v := crm_lock_opportunity(q.opportunity_id);
  perform crm_require_owner_or_founder(v);
  if v.stage in ('won', 'lost') then raise exception 'A closed opportunity cannot change quotations' using errcode = '23514'; end if;
  if q.issued_at is null then raise exception 'Only an issued quotation needs a revision. Edit the draft instead' using errcode = '23514'; end if;
  if exists (select 1 from crm_quotations where company_id = q.company_id and reference = q.reference and issued_at is null) then
    raise exception 'There is already an unissued revision of this quotation' using errcode = '23514';
  end if;
  select max(revision) + 1 into v_rev from crm_quotations where company_id = q.company_id and reference = q.reference;
  select coalesce(max(version), 0) + 1 into v_next from crm_proposals where opportunity_id = v.id;
  insert into crm_proposals (opportunity_id, company_id, version, note, created_by)
  values (v.id, v.company_id, v_next, 'Revision ' || v_rev || ' of ' || q.reference, auth.uid()) returning id into v_id;
  insert into crm_quotations (proposal_id, opportunity_id, company_id, reference, revision, previous_proposal_id, currency, vat_choice_id, vat_kind,
                              vat_label, vat_rate, bill_to_org_id, validity_date, milestones, terms_label, terms, internal_notes)
  values (v_id, q.opportunity_id, q.company_id, q.reference, v_rev, q.proposal_id, q.currency, q.vat_choice_id, q.vat_kind, q.vat_label, q.vat_rate,
          q.bill_to_org_id, null, q.milestones, q.terms_label, q.terms, q.internal_notes);
  for s in select * from crm_quotation_sections where proposal_id = q.proposal_id order by position, id loop
    insert into crm_quotation_sections (proposal_id, company_id, position, title) values (v_id, s.company_id, s.position, s.title) returning id into v_new;
    insert into crm_quotation_lines (proposal_id, section_id, company_id, position, description, image_file_id, unit, quantity, unit_price, vat_choice_id, vat_kind, vat_label, vat_rate)
    select v_id, v_new, l.company_id, l.position, l.description, l.image_file_id, l.unit, l.quantity, l.unit_price, l.vat_choice_id, l.vat_kind, l.vat_label, l.vat_rate
      from crm_quotation_lines l where l.section_id = s.id;
  end loop;
  perform crm_log_event(v.id, v.company_id, 'proposal', null, q.reference || ' rev ' || v_rev || ' draft');
  return v_id;
end;
$$;

-- Company-level settings (existing 'manage_settings' capability, founders included).
create or replace function crm_save_vat_choice(p_company uuid, p_id uuid, p_label text, p_kind text, p_rate numeric, p_active boolean) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform crm_require_user();
  if not crm_has_capability(p_company, 'manage_settings') then raise exception 'Not allowed to change Sales settings for this company' using errcode = '42501'; end if;
  if p_kind not in ('rate', 'out_of_scope') then raise exception 'Unknown VAT kind' using errcode = '22023'; end if;
  if p_id is null then
    insert into crm_quote_vat_choices (company_id, label, kind, rate, position, active)
    values (p_company, btrim(p_label), p_kind, case when p_kind = 'rate' then p_rate end,
            (select coalesce(max(position), 0) + 1 from crm_quote_vat_choices where company_id = p_company), coalesce(p_active, true)) returning id into v_id;
  else
    -- Choices already used on a quotation keep their copied label and rate there; only the list changes.
    update crm_quote_vat_choices set label = btrim(p_label), kind = p_kind, rate = case when p_kind = 'rate' then p_rate end, active = coalesce(p_active, active)
     where id = p_id and company_id = p_company returning id into v_id;
    if v_id is null then raise exception 'VAT choice not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function crm_save_terms_template(p_company uuid, p_label text, p_clauses jsonb) returns void
language plpgsql security definer
set search_path = public
as $$
declare m jsonb;
begin
  perform crm_require_user();
  if not crm_has_capability(p_company, 'manage_settings') then raise exception 'Not allowed to change Sales settings for this company' using errcode = '42501'; end if;
  if p_clauses is null or jsonb_typeof(p_clauses) <> 'array' or jsonb_array_length(p_clauses) > 40 then raise exception 'Terms must be a list of at most 40 clauses' using errcode = '22023'; end if;
  for m in select * from jsonb_array_elements(p_clauses) loop
    if jsonb_typeof(m) <> 'object' or length(btrim(coalesce(m->>'title', ''))) = 0 or length(btrim(coalesce(m->>'body', ''))) = 0
       or length(m->>'title') > 120 or length(m->>'body') > 3000 then
      raise exception 'Every clause needs a title and text' using errcode = '22023';
    end if;
  end loop;
  insert into crm_quote_terms_templates (company_id, label, clauses, updated_by)
  values (p_company, coalesce(nullif(btrim(p_label), ''), 'Standard terms'), (select jsonb_agg(jsonb_build_object('title', btrim(e->>'title'), 'body', btrim(e->>'body'))) from jsonb_array_elements(p_clauses) e), auth.uid())
  on conflict (company_id) do update set label = excluded.label, clauses = excluded.clauses, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- A picture used on a quotation line cannot be removed once the quotation is issued (its snapshot points at the file); on a draft the
-- line simply loses the picture. Otherwise identical to the previous definition.
create or replace function crm_remove_file(p_file_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare f crm_files; v crm_opportunities;
begin
  perform crm_require_user();
  select * into f from crm_files where id = p_file_id and deleted_at is null;
  if not found or not crm_has_access(f.company_id) then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  v := crm_lock_opportunity(f.opportunity_id);
  if f.uploaded_by <> auth.uid() and v.owner_id <> auth.uid() and not crm_is_founder(v.company_id) then
    raise exception 'Only the uploader, the owner or a founder can remove this' using errcode = '42501';
  end if;
  if exists (select 1 from crm_quotation_lines l join crm_quotations q on q.proposal_id = l.proposal_id
              where l.image_file_id = p_file_id and q.issued_at is not null) then
    raise exception 'This picture is used in an issued quotation and cannot be removed' using errcode = '55000';
  end if;
  update crm_quotation_lines set image_file_id = null where image_file_id = p_file_id;
  update crm_files set deleted_at = now() where id = p_file_id;
  update crm_proposals set file_id = null where file_id = p_file_id;
  return f.storage_path;
end;
$$;

revoke all on function
  crm_create_organisation_profile(text, text[], text, text, text, text, uuid, text, text, uuid, jsonb, text, text),
  crm_quotation_frozen(), crm_quotation_guard(), crm_quotation_body_guard(), crm_quote_load_editable(uuid), crm_quote_touch(uuid),
  crm_quote_default_terms(), crm_quote_minor_units(text), crm_quote_build_content(uuid, date), crm_import_apply_item(uuid, jsonb),
  crm_import_fingerprint(uuid, text, text)
  from public, anon, authenticated;
revoke all on function
  crm_quote_create(uuid), crm_quote_save_header(uuid, jsonb), crm_quote_save_section(uuid, uuid, text), crm_quote_delete_section(uuid),
  crm_quote_save_line(uuid, uuid, uuid, jsonb), crm_quote_delete_line(uuid), crm_quote_reorder(uuid, text, uuid, uuid[]), crm_quote_issue(uuid),
  crm_quote_create_revision(uuid), crm_save_vat_choice(uuid, uuid, text, text, numeric, boolean), crm_save_terms_template(uuid, text, jsonb),
  crm_set_company_logo(uuid, text), crm_remove_file(uuid)
  from public, anon;
grant execute on function
  crm_create_organisation_profile(text, text[], text, text, text, text, uuid, text, text, uuid, jsonb, text, text),
  crm_quote_create(uuid), crm_quote_save_header(uuid, jsonb), crm_quote_save_section(uuid, uuid, text), crm_quote_delete_section(uuid),
  crm_quote_save_line(uuid, uuid, uuid, jsonb), crm_quote_delete_line(uuid), crm_quote_reorder(uuid, text, uuid, uuid[]), crm_quote_issue(uuid),
  crm_quote_create_revision(uuid), crm_save_vat_choice(uuid, uuid, text, text, numeric, boolean), crm_save_terms_template(uuid, text, jsonb),
  crm_set_company_logo(uuid, text), crm_remove_file(uuid)
  to authenticated;

-- ROLLBACK: supabase/manual-sql/crm_quotes_90_rollback.sql
