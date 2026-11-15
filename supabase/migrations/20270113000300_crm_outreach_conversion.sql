-- =====================================================================================================================================================================
-- Outreach to enquiry: a chosen contact, an accurate "Outreach" source, and ONE enquiry per outreach enforced by the database.
--
-- Before this migration an outreach held no contact (the New enquiry form was given one only when the account had exactly one), no enquiry source meant "from
-- outreach", and the rule "one outreach raises one enquiry" was checked only by the app before saving: two tabs, a stale tab or a double submit could each create an
-- enquiry, and crm_outreach_link_inquiry simply moved the link to the last one.
--
-- What this adds (additive; crm_create_opportunity and crm_outreach_link_inquiry are NOT replaced):
--   1. crm_outreach.contact_id: the contact this outreach is with, one of the account's own contacts. crm_outreach_set_contact(outreach, contact | null) sets or clears
--      it: the same people who may change the outreach (its assignee, or someone with the assign owners right), while it is not closed.
--   2. The enquiry source 'outreach'. The check on crm_opportunities.source gains the one value; every existing enquiry keeps the source it has.
--   3. A guard on crm_outreach: once an outreach is linked to an enquiry, the link cannot be moved to a different enquiry (by any function or statement).
--      Linking the same enquiry again is still accepted.
--   4. crm_create_enquiry_from_outreach(outreach, fields): the conversion in ONE transaction. It locks the outreach first. If it already has an enquiry it creates
--      nothing and returns that enquiry ({"id": ..., "created": false, "existing": "outreach"}), so a second tab, a stale tab and a double submit all open the one
--      enquiry. Otherwise it creates the enquiry through the existing crm_create_opportunity (all its rules apply, under the caller's own identity) and links it with
--      the existing crm_outreach_link_inquiry; if the link is refused nothing is created.
--   5. crm_create_opportunity_json(fields): an internal helper that passes a JSON object to crm_create_opportunity, argument for argument. Not callable by clients.
--
-- Compatibility with the app that is deployed today: it calls crm_create_opportunity and then crm_outreach_link_inquiry, both unchanged, and it never writes the new
-- source or the new column. Its own check ("this outreach already has an enquiry") still runs first; if two of its tabs race past that check, the second link is now
-- refused by the guard (the app already handles a refused link: it lands on the account and says the enquiry was not linked) instead of silently replacing the first.
-- Apply this BEFORE the new app: the new app offers the Outreach source, which the old check would refuse.
--
-- Safe to run twice. Rollback: supabase/manual-sql/crm_outreach_conversion_90_rollback.sql (it stops while any enquiry has the source 'outreach').
-- =====================================================================================================================================================================

-- 1. The outreach's contact -------------------------------------------------------------------------------------------------------------------------------------------
alter table crm_outreach add column if not exists contact_id uuid references crm_contacts(id);

create or replace function crm_outreach_set_contact(p_outreach uuid, p_contact uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o crm_outreach;
begin
  o := crm_outreach_acting_on(p_outreach);                       -- signed in, Sales access, assignee or assign owners, not closed; locks the row
  if p_contact is not null and not exists (
      select 1 from crm_contacts c where c.id = p_contact and c.organisation_id = o.organisation_id and c.archived_at is null) then
    raise exception 'Choose one of this account''s own contacts. Add the person to the account first' using errcode = '22023';
  end if;
  if o.contact_id is not distinct from p_contact then return; end if;
  update crm_outreach set contact_id = p_contact where id = o.id;
end;
$$;

-- 2. The source --------------------------------------------------------------------------------------------------------------------------------------------------------
do $$
declare c record;
begin
  -- The check was written inline, so it is found by what it checks, not by name (the same way 20261228000100 replaced the stage checks).
  for c in select conname from pg_constraint
            where conrelid = 'public.crm_opportunities'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%agency_call%' loop
    execute format('alter table crm_opportunities drop constraint %I', c.conname);
  end loop;
  alter table crm_opportunities add constraint crm_opportunities_source_check check (source in (
    'agency_call', 'linkedin', 'direct_client', 'whatsapp', 'instagram', 'website', 'referral', 'other', 'outreach'));
end $$;

-- 3. One enquiry per outreach ------------------------------------------------------------------------------------------------------------------------------------------
create or replace function crm_outreach_one_enquiry()
returns trigger language plpgsql as $$
begin
  if old.opportunity_id is not null and new.opportunity_id is distinct from old.opportunity_id then
    raise exception 'This outreach already has an enquiry, so it cannot be linked to another one. Open the existing enquiry instead' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_crm_outreach_one_enquiry on crm_outreach;
create trigger trg_crm_outreach_one_enquiry before update of opportunity_id on crm_outreach for each row execute function crm_outreach_one_enquiry();

-- 5. JSON to crm_create_opportunity, argument for argument (also created, identically, by 20270113000400: either file may be applied first) ------------------------------
create or replace function crm_create_opportunity_json(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return crm_create_opportunity(
    p_company_id => nullif(p ->> 'company_id', '')::uuid,
    p_title => p ->> 'title',
    p_source => p ->> 'source',
    p_next_title => p ->> 'next_title',
    p_next_due => nullif(p ->> 'next_due', '')::timestamptz,
    p_agency_org_id => nullif(p ->> 'agency_org_id', '')::uuid,
    p_client_org_id => nullif(p ->> 'client_org_id', '')::uuid,
    p_owner_id => nullif(p ->> 'owner_id', '')::uuid,
    p_currency => nullif(p ->> 'currency', ''),
    p_value => nullif(p ->> 'value', '')::numeric,
    p_budget_note => p ->> 'budget_note',
    p_brief => p ->> 'brief',
    p_event_start => nullif(p ->> 'event_start', '')::date,
    p_event_end => nullif(p ->> 'event_end', '')::date,
    p_install_start => nullif(p ->> 'install_start', '')::date,
    p_location => p ->> 'location',
    p_technologies => coalesce(nullif(p -> 'technologies', 'null'::jsonb), '[]'::jsonb),
    p_scope => p ->> 'scope',
    p_waiting_on => nullif(p ->> 'waiting_on', ''),
    p_contacts => coalesce(nullif(p -> 'contacts', 'null'::jsonb), '[]'::jsonb),
    p_next_kind => coalesce(nullif(p ->> 'next_kind', ''), 'other'));
end;
$$;

-- 4. The conversion ----------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function crm_create_enquiry_from_outreach(p_outreach uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o crm_outreach; f jsonb := coalesce(p_fields, '{}'::jsonb); v_id uuid; v_org text;
begin
  perform crm_require_user();
  select * into o from crm_outreach where id = p_outreach for update;                 -- every conversion of this outreach waits here for the one before it
  if not found or not crm_has_access(o.company_id)
     or (o.assigned_to <> auth.uid() and not crm_has_capability(o.company_id, 'assign_owner')) then
    raise exception 'Outreach not found' using errcode = 'P0002';
  end if;
  if o.opportunity_id is not null then
    return jsonb_build_object('id', o.opportunity_id, 'created', false, 'existing', 'outreach');
  end if;
  if o.status = 'closed' then raise exception 'This outreach is closed' using errcode = '23514'; end if;
  v_org := o.organisation_id::text;
  if (f ->> 'company_id') is distinct from o.company_id::text or (v_org is distinct from (f ->> 'agency_org_id') and v_org is distinct from (f ->> 'client_org_id')) then
    raise exception 'The enquiry must be for the account and the company of the outreach it is raised from' using errcode = '22023';
  end if;
  v_id := crm_create_opportunity_json(f);
  perform crm_outreach_link_inquiry(p_outreach, v_id);
  return jsonb_build_object('id', v_id, 'created', true, 'existing', null);
end;
$$;

revoke all on function crm_outreach_set_contact(uuid, uuid), crm_outreach_one_enquiry(), crm_create_opportunity_json(jsonb), crm_create_enquiry_from_outreach(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function crm_outreach_set_contact(uuid, uuid), crm_create_enquiry_from_outreach(uuid, jsonb) to authenticated;
