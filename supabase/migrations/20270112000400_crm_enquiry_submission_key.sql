-- =====================================================================================================================================================================
-- New enquiry: a submission identifier, so that a save whose answer was lost cannot create a second enquiry when it is tried again.
--
-- Before this migration crm_create_opportunity had no idempotency key. The form stops a double click in the browser, but when the server saved the enquiry and the
-- answer never reached the browser (a dropped connection, a timeout), pressing Save again created a second enquiry with a second reference.
--
-- What this adds (additive; crm_create_opportunity keeps its signature and its body, and the deployed app and JARVIS keep calling it):
--   1. crm_enquiry_submissions (created_by, submission_key) -> the enquiry that submission created. PRIMARY KEY (created_by, submission_key): one enquiry per
--      identifier per person, whatever happens. No policy and no table privilege: only the function below reads or writes it.
--   2. crm_create_enquiry(fields, submission_key, outreach): the create the new forms call.
--        * The identifier is made by the form when it opens (Quick Add and the full form), and is sent with every attempt to save that form.
--        * A first attempt creates the enquiry through the existing crm_create_opportunity (every rule of it applies, under the caller's own identity) and records
--          the identifier in the same transaction.
--        * A repeat with the same identifier by the same person creates nothing and returns the ORIGINAL enquiry: {"id": ..., "created": false, "existing": "submission"}.
--        * Two attempts with the same identifier at the same moment are serialised by a transaction lock on (person, identifier): exactly one creates.
--        * Two forms opened separately have two identifiers: both enquiries are created, however alike they are.
--        * With an outreach id it hands the creation to crm_create_enquiry_from_outreach (20270112000300), which returns the outreach's existing enquiry instead of
--          creating a second one.
--        * Without an identifier it behaves exactly like crm_create_opportunity.
--   3. crm_create_opportunity_json(fields): the same internal helper 20270112000300 creates (identical text; either file may be applied first).
--
-- JARVIS: its create path (jarvis_create_enquiry, 20261223000100) has its own ledger keyed by the confirmation proof, and "a repeat returns the ORIGINAL result"
-- already. It calls crm_create_opportunity directly, which is not changed, so it neither needs nor uses this identifier.
--
-- Compatibility with the app that is deployed today: it calls crm_create_opportunity(...) with the same 21 arguments; that function is untouched. Apply this BEFORE
-- or AFTER the new app: the new app falls back to crm_create_opportunity when crm_create_enquiry does not exist yet (then without the retry protection).
--
-- Existing enquiries have no identifier and need none. Safe to run twice. Rollback: supabase/manual-sql/crm_enquiry_submission_key_90_rollback.sql.
-- =====================================================================================================================================================================

create table if not exists crm_enquiry_submissions (
  created_by      uuid not null references auth.users(id),
  submission_key  uuid not null,
  opportunity_id  uuid not null references crm_opportunities(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (created_by, submission_key)
);
create index if not exists idx_crm_enquiry_submissions_opportunity on crm_enquiry_submissions(opportunity_id);
alter table crm_enquiry_submissions enable row level security;
revoke all on table crm_enquiry_submissions from anon, authenticated, public;

-- JSON to crm_create_opportunity, argument for argument (also created, identically, by 20270112000300: either file may be applied first).
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

create or replace function crm_create_enquiry(p_fields jsonb, p_submission_key uuid default null, p_outreach_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := crm_require_user(); f jsonb := coalesce(p_fields, '{}'::jsonb); v_id uuid; v_created boolean := true; v_existing text; v_res jsonb;
begin
  if p_submission_key is not null then
    -- One attempt at a time for this person's identifier: a second, simultaneous attempt waits here and then finds the first one's record below.
    perform pg_advisory_xact_lock(hashtextextended('crm_enquiry_submission:' || v_user::text || ':' || p_submission_key::text, 0));
    select s.opportunity_id into v_id from crm_enquiry_submissions s where s.created_by = v_user and s.submission_key = p_submission_key;
    if found then
      return jsonb_build_object('id', v_id, 'created', false, 'existing', 'submission');
    end if;
  end if;
  if p_outreach_id is not null then
    if to_regprocedure('public.crm_create_enquiry_from_outreach(uuid, jsonb)') is null then
      raise exception 'Raising an enquiry from an outreach is not installed in this database yet (20270112000300)' using errcode = '0A000';
    end if;
    execute 'select crm_create_enquiry_from_outreach($1, $2)' into v_res using p_outreach_id, f;
    v_id := (v_res ->> 'id')::uuid;
    v_created := coalesce((v_res ->> 'created')::boolean, false);
    v_existing := v_res ->> 'existing';
  else
    v_id := crm_create_opportunity_json(f);
  end if;
  if p_submission_key is not null and v_created then
    insert into crm_enquiry_submissions (created_by, submission_key, opportunity_id) values (v_user, p_submission_key, v_id);
  end if;
  return jsonb_build_object('id', v_id, 'created', v_created, 'existing', v_existing);
end;
$$;

revoke all on function crm_create_opportunity_json(jsonb), crm_create_enquiry(jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function crm_create_enquiry(jsonb, uuid, uuid) to authenticated;
