-- Sales & CRM: one bounded read for the Enquiries list and board.
--
-- Why a function. The list needs things one table request cannot give together: a search across the enquiry and the NAMES of its agency and end client, a sort by the
-- next open follow-up's due time, exact counts for the quick filters (overdue, due today, awaiting first response, no next action) and for every board lane, and
-- only ONE page of rows. Until now the app read every matching enquiry with every column and did this in memory. This function does it in the database and
-- returns one page (or, for the board, the first cards of each lane) with the counts that cover every match.
--
-- ADDITIVE ONLY: one new function. No table, column, policy, grant or existing function is changed. It is SECURITY INVOKER: every row it reads is read as the
-- caller, so the existing row-level security decides what is visible (an enquiry of a company the person has no Sales grant for is neither returned nor counted).
-- It writes nothing. Idempotent: create or replace. The app falls back to its earlier complete read when this function is not installed.
--
-- Definitions (the same the screens already use):
--   open           stage is not won or lost (On hold is open); closed = won or lost; a chosen stage wins over open / closed.
--   overdue        the enquiry is open and its NEXT open follow-up (soonest due) is past its due moment.
--   due today      open, the next open follow-up is still to come and falls on today's Dubai date.
--   no first response   open, and no first response is recorded.
--   no next action      a working stage (not On hold, not closed) with no open follow-up at all.
-- Returns {total, matched, needs{...}, stages[...], rows[...]}: `total` = every enquiry the caller may see; `needs` = counts over the filters WITHOUT the need
-- filter; `matched` and `stages` (count, enquiries with no value, per-currency totals: never added across currencies) = over the filters WITH it; `rows` = one page
-- in the requested order (p_per_stage null), or the first p_per_stage enquiries of each stage by next due time (the board).

create or replace function crm_enquiry_list(
  p_company uuid default null, p_owner uuid default null, p_stage text default null, p_status text default 'open', p_q text default null,
  p_need text default null, p_ids uuid[] default null, p_sort text default 'due', p_dir text default 'asc', p_owner_order uuid[] default null,
  p_limit integer default 100, p_offset integer default 0, p_per_stage integer default null
) returns jsonb
language sql stable security invoker
set search_path = public
as $$
  with base as (
    select o.id, o.reference, o.title, o.company_id, o.owner_id, o.stage, o.stage_before_hold, o.version, o.currency, o.value, o.source, o.created_at,
           o.install_start, o.event_start, o.event_end, o.first_response_at, o.availability_state, o.availability_covers, o.technologies,
           o.agency_org_id, o.client_org_id, ag.name as agency_name, cl.name as client_name,
           nf.id as next_id, nf.title as next_title, nf.due_at as next_due, nf.assigned_to as next_assigned_to, coalesce(fc.n, 0) as open_follow_ups
    from crm_opportunities o
    left join crm_organisations ag on ag.id = o.agency_org_id
    left join crm_organisations cl on cl.id = o.client_org_id
    left join lateral (select f.id, f.title, f.due_at, f.assigned_to from crm_follow_ups f where f.opportunity_id = o.id and f.status = 'open' order by f.due_at, f.id limit 1) nf on true
    left join lateral (select count(*)::integer as n from crm_follow_ups f where f.opportunity_id = o.id and f.status = 'open') fc on true
    where (p_company is null or o.company_id = p_company)
      and (p_owner is null or o.owner_id = p_owner)
      and (p_ids is null or o.id = any(p_ids))
      and case when nullif(p_stage, '') is not null then o.stage = p_stage
               when p_status = 'open' then o.stage not in ('won', 'lost')
               when p_status = 'closed' then o.stage in ('won', 'lost')
               else true end
      -- "contains", any case, as plain text (a % or _ typed by the person is searched for, not treated as a wildcard)
      and (nullif(btrim(coalesce(p_q, '')), '') is null
           or position(lower(btrim(p_q)) in lower(o.reference)) > 0 or position(lower(btrim(p_q)) in lower(o.title)) > 0
           or position(lower(btrim(p_q)) in lower(coalesce(ag.name, ''))) > 0 or position(lower(btrim(p_q)) in lower(coalesce(cl.name, ''))) > 0)
  ), tagged as (
    select b.*,
           (b.stage not in ('won', 'lost') and b.next_due is not null and b.next_due < now()) as is_overdue,
           (b.stage not in ('won', 'lost') and b.next_due is not null and b.next_due >= now()
              and (b.next_due at time zone 'Asia/Dubai')::date = (now() at time zone 'Asia/Dubai')::date) as is_due_today,
           (b.stage not in ('won', 'lost') and b.first_response_at is null) as is_no_first_response,
           (b.stage in ('new', 'qualified', 'proposal_prep', 'proposal_sent', 'estimate_sent', 'quote_sent', 'negotiation') and b.open_follow_ups = 0) as is_no_next_action
    from base b
  ), sel as (
    select t.* from tagged t
    where case p_need when 'overdue' then t.is_overdue when 'due_today' then t.is_due_today when 'no_first_response' then t.is_no_first_response
                      when 'no_next_action' then t.is_no_next_action else true end
  ), keyed as (
    select s.*,
           case p_sort
             when 'enquiry' then lower(s.title)
             when 'party' then lower(case when s.agency_name is not null and s.client_name is not null then s.agency_name || ' for ' || s.client_name else coalesce(s.agency_name, s.client_name) end)
             when 'owner' then lpad(array_position(p_owner_order, s.owner_id)::text, 6, '0')
             when 'stage' then lpad(array_position(array['new', 'qualified', 'proposal_prep', 'proposal_sent', 'estimate_sent', 'quote_sent', 'negotiation', 'on_hold', 'won', 'lost'], s.stage)::text, 2, '0')
             when 'dates' then coalesce(s.install_start, s.event_start)::text
             when 'created' then to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
             else to_char(s.next_due at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
           end as sk
    from sel s
  ), ranked as (
    select k.*,
           row_number() over (order by
             case when p_sort = 'value' then (k.value is null)::integer end,
             case when p_sort = 'value' then k.currency end,
             case when p_sort = 'value' and p_dir = 'asc' then k.value end asc,
             case when p_sort = 'value' and p_dir <> 'asc' then k.value end desc,
             case when p_sort <> 'value' and p_dir = 'asc' then k.sk end asc nulls last,
             case when p_sort <> 'value' and p_dir <> 'asc' then k.sk end desc nulls last,
             k.reference, k.id) as rn,
           row_number() over (partition by k.stage order by k.next_due asc nulls last, k.reference, k.id) as rn_stage
    from keyed k
  ), page as (
    select r.* from ranked r
    where case when p_per_stage is not null then r.rn_stage <= greatest(p_per_stage, 0)
               else r.rn > greatest(coalesce(p_offset, 0), 0) and r.rn <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 100), 1), 500) end
  )
  select jsonb_build_object(
    'total', (select count(*) from crm_opportunities),
    'matched', (select count(*) from sel),
    'needs', (select jsonb_build_object('overdue', count(*) filter (where is_overdue), 'due_today', count(*) filter (where is_due_today),
                                         'no_first_response', count(*) filter (where is_no_first_response), 'no_next_action', count(*) filter (where is_no_next_action)) from tagged),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage', g.stage, 'count', g.n, 'unvalued', g.unvalued, 'totals', g.totals) order by g.stage)
                        from (select s.stage, count(*) as n, count(*) filter (where s.value is null) as unvalued,
                                     coalesce((select jsonb_object_agg(c.currency, c.total) from (select s2.currency, sum(s2.value) as total from sel s2
                                                where s2.stage = s.stage and s2.value is not null group by s2.currency) c), '{}'::jsonb) as totals
                              from sel s group by s.stage) g), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                'id', p.id, 'reference', p.reference, 'title', p.title, 'company_id', p.company_id, 'owner_id', p.owner_id, 'stage', p.stage, 'stage_before_hold', p.stage_before_hold,
                'version', p.version, 'currency', p.currency, 'value', p.value, 'source', p.source, 'created_at', p.created_at, 'install_start', p.install_start,
                'event_start', p.event_start, 'event_end', p.event_end, 'first_response_at', p.first_response_at, 'availability_state', p.availability_state,
                'availability_covers', p.availability_covers, 'technologies', p.technologies, 'agency_org_id', p.agency_org_id, 'client_org_id', p.client_org_id,
                'agency_name', p.agency_name, 'client_name', p.client_name, 'open_follow_ups', p.open_follow_ups,
                'next', case when p.next_id is null then null else jsonb_build_object('id', p.next_id, 'title', p.next_title, 'due_at', p.next_due, 'assigned_to', p.next_assigned_to) end)
              order by case when p_per_stage is not null then p.rn_stage else p.rn end, p.rn) from page p), '[]'::jsonb));
$$;

revoke all on function crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer) from public, anon, authenticated;
grant execute on function crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer) to authenticated;
