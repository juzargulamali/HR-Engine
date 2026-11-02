-- A15 / D-14. The Approvals page can show a Recovery Leave card to the people who actually decide it. ADDITIVE: one new function; no table, policy or privilege change,
-- no data change, and no change to routing, the decision, or any calculation.
--
-- WHY (reproduced on a local copy before the fix: packages/rls-tests/test/recovery_decider_card.rls.test.ts).
--   (1) A project lead who decides step 1 saw the applicant's name as "—": the page read it from `employees`, which a lead who is not the person's manager cannot read.
--   (2) A CEO / CTO deciding an HR Admin's request on the shared queue got no card at all, for two reasons that stack: the queue approval row itself is invisible to them
--       (approvals_select looks the request up under the caller's own row-level security, and recovery_credit_requests_select has no CEO / CTO branch), and so is the
--       request row the card is built from. The page said "Nothing waiting on you" although the approval exists and the database lets them decide.
--
-- WHAT. recovery_decider_inbox(ids) returns, for each pending approval that the CALLER is authorised to decide RIGHT NOW (a step assigned to them, or a pending queue step
-- whose role (HR Admin, or the CEO / CTO queue roles) they hold in the APPLICANT's company), the approval's own fields (so the page can list it) and the minimum the card shows:
-- the applicant's name, company and country, and the request's own work date, event type, amount, route, work mode, project name, named lead, routing note and window link.
-- With no list it returns all of them. The applicant is never offered their own request, a decision already made is not offered again, and a CEO / CTO / HR Admin of another
-- company gets nothing. Not returned: checked-with notes, correction reasons, segment ids, attendance records, anything outside the card.
--
-- WHAT DOES NOT CHANGE. approvals_select and recovery_credit_requests_select (nobody can read more rows of either table than before), who may decide, routing, approvals,
-- ledgers, the window evidence the page already reads under its own policies. Callable by signed-in users only (a caller who decides nothing gets an empty result).
-- ROLLBACK: supabase/manual-sql/reccard_90_rollback.sql (drops the function: the card goes back to what the page can read itself).

create or replace function recovery_decider_inbox(p_request_ids uuid[] default null)
returns table(
  approval_id uuid,
  step_order int,
  workflow_id uuid,
  approver_id uuid,
  queue_roles app_role[],
  approval_created_at timestamptz,
  id uuid,
  employee_id uuid,
  employee_name text,
  company_id uuid,
  country_code text,
  work_date date,
  event_type text,
  proposed_days numeric,
  attendance_record_id uuid,
  corrected_at timestamptz,
  work_mode text,
  project_name text,
  project_lead_employee_id uuid,
  applicant_route text,
  needs_policy_review boolean,
  routing_issue text,
  recovery_window_id uuid,
  consumption_ack_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.step_order, a.workflow_id, a.approver_id, a.queue_roles, a.created_at,
         r.id, r.employee_id,
         coalesce(nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), 'Unnamed employee'),
         e.company_id, e.country_code,
         r.work_date, r.event_type::text, r.proposed_days, r.attendance_record_id, r.corrected_at, r.work_mode::text, r.project_name,
         r.project_lead_employee_id, r.applicant_route::text, r.needs_policy_review, r.routing_issue, r.recovery_window_id, r.consumption_ack_at
  from approvals a
  join recovery_credit_requests r on r.id = a.entity_id
  join employees e on e.id = r.employee_id
  where auth.uid() is not null
    and a.entity_type = 'recovery_credit' and a.decision = 'pending'
    and (p_request_ids is null or r.id = any (p_request_ids))
    and e.user_id is distinct from auth.uid()
    and (
      a.approver_id = auth.uid()
      or (
        a.approver_id is null
        and (
          (a.queue_roles is null and has_role('hr_admin', e.company_id))   -- the earlier single HR queue step
          or (a.queue_roles is not null and exists (select 1 from unnest(a.queue_roles) qr where has_role(qr, e.company_id)))
        )
      )
    )
  order by a.created_at, a.id;
$$;

revoke all on function recovery_decider_inbox(uuid[]) from public, anon;
grant execute on function recovery_decider_inbox(uuid[]) to authenticated;
