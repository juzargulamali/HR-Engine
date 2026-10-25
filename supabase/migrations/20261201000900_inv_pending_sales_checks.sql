-- Inventory, migration 11: the warehouse's list of Sales availability checks that are waiting to be answered.
--
-- A warehouse operator has no Sales access, so until now a request made from an enquiry reached nobody. This function gives the
-- people who can ANSWER a check (a warehouse operator, a catalogue manager or an Inventory founder) the minimum they need to do it,
-- and nothing else about the enquiry: its reference, the dates, the technologies with quantities, the location asked for, and who
-- asked and when. It never returns the title, the client or agency, the value, the owner, the brief, the notes or the stage.
-- Additive: one new function; no table, policy or trigger changes.

create or replace function inv_pending_sales_checks()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform inv_require_user();
  return coalesce((
    select jsonb_agg(s.x order by s.asked_at, s.reference)
      from (
        select c.requested_at as asked_at, o.reference,
               jsonb_build_object(
                 'check_id', c.id,
                 'opportunity_id', o.id,
                 'company_id', c.company_id,
                 'reference', o.reference,
                 'requested_at', c.requested_at,
                 'requested_by', coalesce(inv_user_name(c.requested_by), 'Sales'),
                 'location_id', c.location_id,
                 'location_name', l.name,
                 'install_start', o.install_start,
                 'event_start', o.event_start,
                 'event_end', o.event_end,
                 'technologies', coalesce((select jsonb_agg(jsonb_build_object('name', e->>'name', 'qty', coalesce(nullif(e->>'qty', '')::numeric, 1)))
                                             from jsonb_array_elements(o.technologies) e), '[]'::jsonb)
               ) as x
          from inv_availability_checks c
          join crm_opportunities o on o.id = c.opportunity_id
          join inv_company_settings st on st.company_id = c.company_id and st.is_enabled
          left join inv_locations l on l.id = c.location_id
         where c.result = 'pending'
           and o.stage not in ('won', 'lost')
           and (inv_has_capability(c.company_id, 'warehouse') or inv_has_capability(c.company_id, 'manage_catalogue'))
           -- an operator sees the checks for the locations they work at (and those that name no location yet); a catalogue manager or founder sees all
           and (c.location_id is null or inv_can_operate(c.location_id) or inv_has_capability(c.company_id, 'manage_catalogue'))
      ) s), '[]'::jsonb);
end;
$$;

revoke all on function inv_pending_sales_checks() from public, anon, authenticated;
grant execute on function inv_pending_sales_checks() to authenticated;

-- ROLLBACK (only before the app depends on it):
--   drop function if exists inv_pending_sales_checks();
