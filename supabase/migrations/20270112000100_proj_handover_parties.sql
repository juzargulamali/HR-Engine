-- =====================================================================================================================================================================
-- Sales to Projects handover: the agency, a designated site contact and the notes for the Project Manager reach the project.
--
-- Before this migration the accepted project received the client name, the location, the dates, the scope, the technologies, the risks and the event edition. It did
-- NOT receive the agency (a direct job and an agency-led job looked the same), any contact (they stayed in Sales, behind a link that needs Sales access), or a place
-- on the project itself for the notes Sales wrote for the Project Manager.
--
-- What this adds (additive; no existing function body is replaced, no existing column is changed, nothing is backfilled):
--   1. proj_handovers.job_type / agency_org_id / agency_name / parties_recorded_at: whether the job is direct or led by an agency, and the agency's name, copied from
--      the enquiry by a trigger while Sales is still preparing the brief and again when it is submitted or resubmitted. Exactly the moments the event edition is copied
--      (20270102000100_ops_phase2b.sql, section 4), so the two copies describe the same instant. parties_recorded_at IS NULL means "this handover was accepted or last
--      submitted before this migration": the project then says "Not recorded at handover" instead of pretending the job was direct.
--   2. proj_handover_site_contacts: ONE optional contact per handover, chosen by Sales from the contacts already linked to the enquiry (crm_opportunity_contacts).
--      It holds a COPY of the contact's name, role, phone and e-mail, so that the accepted brief stays the historical record: a contact edited, unlinked or archived
--      in Sales afterwards does not change what the project shows. The copy is refreshed with the same rule as the agency. No policy and no table privilege: it is
--      read only through the two functions below.
--   3. proj_set_handover_site_contact(handover, contact | null): Sales chooses or clears the contact while the brief can still be edited.
--   4. proj_handover_parties(handover): the agency and the contact for the people who work the handover (Sales preparer and owner, the assigned Project Manager,
--      founders and whoever assigns Project Managers, which includes Operations Managers).
--   5. proj_project_handover(project): what the PROJECT shows. Always the accepted brief (frozen by trigger proj_handovers_frozen), never the live Sales record.
--        * someone who cannot open the project's details (summary only, another company, a Sales person without a place on the project) gets "Project not found";
--        * a member, a founder or an Operations Manager gets the job type, the agency and the notes for the Project Manager (the notes were already readable to
--          them on the project's History page through the handover row);
--        * the contact's name, role, phone and e-mail are returned only to whoever manages the project (the Project Manager, an acting Project Manager, a founder:
--          proj_can_manage) and to the company's Operations Managers. Everyone else gets contact_restricted = true and no contact field at all.
--
-- Compatibility with the app that is deployed today: it calls proj_save_handover / proj_submit_handover / proj_accept_handover with the same arguments, and none of
-- those functions is replaced here. The two new triggers only fill the new columns. Apply this BEFORE or AFTER the new app: the new app reads the two functions and,
-- when they are missing, shows the handover exactly as it did before (no contact picker, the old wording).
--
-- Safe to run twice. Rollback: supabase/manual-sql/proj_handover_parties_90_rollback.sql.
-- =====================================================================================================================================================================

alter table proj_handovers add column if not exists job_type text;
alter table proj_handovers add column if not exists agency_org_id uuid references crm_organisations(id);
alter table proj_handovers add column if not exists agency_name text;
alter table proj_handovers add column if not exists parties_recorded_at timestamptz;
alter table proj_handovers drop constraint if exists proj_handovers_job_type;
alter table proj_handovers add constraint proj_handovers_job_type check (
  job_type is null or (job_type = 'direct' and agency_org_id is null and agency_name is null) or (job_type = 'agency' and agency_org_id is not null));

-- The agency is the enquiry's own (crm_opportunities.agency_org_id). Sales corrects it on the enquiry, never by typing a second name here.
create or replace function proj_handover_parties_copy()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_agency uuid;
begin
  if new.status in ('accepted', 'withdrawn') then return new; end if;
  if tg_op = 'INSERT' or new.status = 'draft' or old.status in ('draft', 'clarification_requested') or (old.status is distinct from new.status and new.status = 'submitted') then
    select o.agency_org_id into v_agency from crm_opportunities o where o.id = new.crm_opportunity_id;
    new.agency_org_id := v_agency;
    new.agency_name := case when v_agency is null then null else (select g.name from crm_organisations g where g.id = v_agency) end;
    new.job_type := case when v_agency is null then 'direct' else 'agency' end;
    new.parties_recorded_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proj_handover_parties_copy on proj_handovers;
create trigger trg_proj_handover_parties_copy before insert or update on proj_handovers for each row execute function proj_handover_parties_copy();

create table if not exists proj_handover_site_contacts (
  handover_id  uuid primary key references proj_handovers(id) on delete cascade,
  -- The Sales contact the copy was taken from. Kept for reference only (no foreign key): the copy below is what the project shows, whatever happens to the contact.
  contact_id   uuid not null,
  name         text not null check (length(btrim(name)) between 1 and 200),
  role_title   text,
  phone        text,
  email        text,
  chosen_by    uuid references auth.users(id),
  taken_at     timestamptz not null default now()
);
alter table proj_handover_site_contacts enable row level security;
revoke all on table proj_handover_site_contacts from anon, authenticated, public;

-- The copy belongs to the brief: once the brief is accepted it never changes again.
create or replace function proj_handover_site_contact_frozen()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select h.status into v_status from proj_handovers h where h.id = coalesce(new.handover_id, old.handover_id);
  if v_status = 'accepted' then
    raise exception 'An accepted handover is a historical record and cannot be changed' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_proj_handover_site_contact_frozen on proj_handover_site_contacts;
create trigger trg_proj_handover_site_contact_frozen before insert or update or delete on proj_handover_site_contacts
  for each row execute function proj_handover_site_contact_frozen();

-- Takes the copy again from the Sales contact. Returns false when the contact can no longer be used (archived, deleted, or no longer linked to the enquiry).
create or replace function proj_handover_site_contact_take(p_handover_id uuid, p_opportunity_id uuid, p_contact_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare c crm_contacts;
begin
  select * into c from crm_contacts where id = p_contact_id and archived_at is null;
  if not found or not exists (select 1 from crm_opportunity_contacts oc where oc.opportunity_id = p_opportunity_id and oc.contact_id = p_contact_id) then
    return false;
  end if;
  insert into proj_handover_site_contacts (handover_id, contact_id, name, role_title, phone, email, chosen_by, taken_at)
  values (p_handover_id, c.id, c.name, nullif(btrim(c.role_title), ''), nullif(btrim(c.phone), ''), nullif(btrim(c.email), ''), auth.uid(), now())
  on conflict (handover_id) do update set contact_id = excluded.contact_id, name = excluded.name, role_title = excluded.role_title, phone = excluded.phone,
    email = excluded.email, taken_at = excluded.taken_at,
    chosen_by = case when proj_handover_site_contacts.contact_id = excluded.contact_id then proj_handover_site_contacts.chosen_by else excluded.chosen_by end;
  return true;
end;
$$;

-- The contact is copied again at the same moments as the agency. A submission is refused, in words, when the chosen contact is no longer on the enquiry: the Project
-- Manager is never handed a contact Sales has since removed. Other saves of a draft leave the copy alone (the next submission decides).
create or replace function proj_handover_site_contact_refresh()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_contact uuid; v_submitting boolean;
begin
  if new.status in ('accepted', 'withdrawn') then return new; end if;
  v_submitting := old.status is distinct from new.status and new.status in ('submitted', 'pm_assigned') and old.status in ('draft', 'clarification_requested');
  if not (new.status = 'draft' or old.status in ('draft', 'clarification_requested') or v_submitting) then return new; end if;
  select s.contact_id into v_contact from proj_handover_site_contacts s where s.handover_id = new.id;
  if v_contact is null then return new; end if;
  if not proj_handover_site_contact_take(new.id, new.crm_opportunity_id, v_contact) and v_submitting then
    raise exception 'The site contact chosen for this handover is no longer on the enquiry. Choose another contact, or none, then submit again' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proj_handover_site_contact_refresh on proj_handovers;
create trigger trg_proj_handover_site_contact_refresh after update on proj_handovers for each row execute function proj_handover_site_contact_refresh();

-- SALES: choose the site contact of a brief, or clear it (p_contact_id null). The same people who may save the brief (proj_save_handover): the enquiry's owner or a
-- Sales founder, while the brief is a draft, submitted and not yet with a Project Manager, or back with Sales after a question.
create or replace function proj_set_handover_site_contact(p_handover_id uuid, p_contact_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare h proj_handovers; o crm_opportunities; v_current uuid;
begin
  perform proj_require_user();
  select * into h from proj_handovers where id = p_handover_id for update;
  if found then select * into o from crm_opportunities where id = h.crm_opportunity_id; end if;
  if h.id is null or o.id is null or not crm_has_access(o.company_id) then
    raise exception 'Handover not found' using errcode = 'P0002';
  end if;
  if o.owner_id <> auth.uid() and not crm_is_founder(o.company_id) then
    raise exception 'Only the opportunity owner or a Sales founder can prepare its project handover' using errcode = '42501';
  end if;
  if h.status not in ('draft', 'submitted', 'clarification_requested') then
    raise exception 'This handover can no longer be edited (status: %)', h.status using errcode = '23514';
  end if;
  select s.contact_id into v_current from proj_handover_site_contacts s where s.handover_id = h.id;
  if p_contact_id is null then
    if v_current is null then return; end if;                                   -- already none: a repeated click changes nothing
    delete from proj_handover_site_contacts where handover_id = h.id;
  else
    if not proj_handover_site_contact_take(h.id, h.crm_opportunity_id, p_contact_id) then
      raise exception 'Choose one of the contacts linked to this enquiry. Add the person under Contacts on the enquiry first' using errcode = '22023';
    end if;
    if v_current = p_contact_id then return; end if;                            -- the same contact again: the copy is fresh, nothing else to record
  end if;
  update proj_handovers set version = version + 1 where id = h.id;
end;
$$;

create or replace function proj_handover_site_contact_json(p_handover_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('contact_id', s.contact_id, 'name', s.name, 'role_title', s.role_title, 'phone', s.phone, 'email', s.email, 'taken_at', s.taken_at)
  from proj_handover_site_contacts s where s.handover_id = p_handover_id;
$$;

-- The people who work a handover read its agency and site contact here: Sales (preparer or enquiry owner, with Sales access), the assigned Project Manager, founders
-- and whoever assigns Project Managers (Operations Managers included), and, once the project exists, whoever manages it. Anyone else: "Handover not found".
create or replace function proj_handover_parties(p_handover_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h proj_handovers;
begin
  perform proj_require_user();
  select * into h from proj_handovers where id = p_handover_id;
  if not found or not (
    proj_is_founder(h.company_id) or proj_has_capability(h.company_id, 'assign_pm')
    or ((h.prepared_by = auth.uid() or h.sales_owner_id = auth.uid()) and crm_has_access(h.company_id))
    or (h.pm_user_id = auth.uid() and h.status in ('pm_assigned', 'clarification_requested', 'accepted') and proj_user_eligible(h.company_id, auth.uid()))
    or (h.project_id is not null and proj_can_manage(h.project_id))
  ) then
    raise exception 'Handover not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('handover_id', h.id, 'recorded', h.parties_recorded_at is not null, 'job_type', h.job_type, 'agency_name', h.agency_name,
                            'site_contact', proj_handover_site_contact_json(h.id));
end;
$$;

-- What the project shows of its handover. See the header for who gets what.
create or replace function proj_project_handover(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr proj_projects; h proj_handovers; v_people boolean;
begin
  perform proj_require_user();
  select * into pr from proj_projects where id = p_project_id;
  if not found or not proj_can_view_details(pr.id) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if pr.handover_id is null then return jsonb_build_object('has_handover', false); end if;
  select * into h from proj_handovers where id = pr.handover_id;
  v_people := proj_can_manage(pr.id) or proj_has_capability(pr.company_id, 'operations');
  return jsonb_build_object(
    'has_handover', true, 'handover_id', h.id, 'accepted_at', h.accepted_at, 'recorded', h.parties_recorded_at is not null,
    'job_type', h.job_type, 'agency_name', h.agency_name, 'notes', h.notes,
    'contact_restricted', not v_people,
    'site_contact', case when v_people then proj_handover_site_contact_json(h.id) else null end);
end;
$$;

revoke all on function
  proj_handover_parties_copy(), proj_handover_site_contact_frozen(), proj_handover_site_contact_take(uuid, uuid, uuid), proj_handover_site_contact_refresh(),
  proj_set_handover_site_contact(uuid, uuid), proj_handover_site_contact_json(uuid), proj_handover_parties(uuid), proj_project_handover(uuid)
  from public, anon, authenticated;
grant execute on function proj_set_handover_site_contact(uuid, uuid), proj_handover_parties(uuid), proj_project_handover(uuid) to authenticated;
