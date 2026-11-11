-- Sales & CRM, Events & Exhibitions: add an event TOGETHER WITH its first edition, in one call and one transaction.
--
-- Why a new function. Until now an event (crm_save_event) and its first edition (crm_save_edition) were two separate calls from the app, each its own
-- transaction: when the edition was refused (bad dates, a bad country code) the event stayed behind with no edition. crm_import_events is transactional but is the
-- bulk import: it requires a country, has no event kind, classifies rows against existing editions and answers with a preview, so it is not this form's rule set.
--
-- What it does. ADDITIVE ONLY: one new function; no table, column, policy, grant or existing function is changed. It validates BOTH parts first, then calls the two
-- existing functions, so every existing rule is the same rule (any Sales grant adds; a live event with the same name is refused; an archived one does not block the
-- name; dates, country code and the duplicate start date are checked as before; the person who adds it is recorded on both rows). Everything runs inside the one
-- function call: when anything is refused, nothing is written, so there is never an event without the edition it was added with.
-- Idempotent: create or replace; safe to run twice.

create or replace function crm_add_event_with_edition(
  p_name text, p_kind text, p_start date, p_end date, p_city text default null, p_country text default null, p_venue text default null,
  p_website text default null, p_event_note text default null, p_edition_note text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_key text := lower(regexp_replace(btrim(coalesce(p_name, '')), '[^A-Za-z0-9]+', '', 'g'));
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  v_event uuid;
  v_edition uuid;
begin
  perform crm_require_user();
  if not crm_has_any_access() then raise exception 'You do not have Sales access' using errcode = '42501'; end if;
  -- Both parts are checked before anything is written (the same sentences the two functions use).
  if length(v_name) = 0 or length(v_name) > 200 then raise exception 'Enter the event name (up to 200 characters)' using errcode = '22023'; end if;
  if coalesce(p_kind, '') not in ('exhibition', 'conference', 'other') then raise exception 'Choose exhibition, conference or other' using errcode = '22023'; end if;
  if v_key = '' then raise exception 'The event name needs letters or digits' using errcode = '22023'; end if;
  if p_start is null or p_end is null then raise exception 'Enter the start and end dates' using errcode = '22023'; end if;
  if p_end < p_start then raise exception 'The end date cannot be before the start date' using errcode = '22023'; end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then raise exception 'Use a two-letter country code' using errcode = '22023'; end if;
  if exists (select 1 from crm_events where archived_at is null and name_key = v_key) then
    raise exception 'An event with that name already exists. Open it and add the next edition instead.' using errcode = '23505';
  end if;
  -- The existing functions do the writing (and repeat every check). An error in either one undoes the whole call.
  v_event := crm_save_event(null, p_name, p_kind, p_website, p_event_note);
  v_edition := crm_save_edition(null, v_event, p_start, p_end, p_city, p_country, p_venue, p_edition_note);
  return jsonb_build_object('event_id', v_event, 'edition_id', v_edition);
end;
$$;

revoke all on function crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text) to authenticated;
