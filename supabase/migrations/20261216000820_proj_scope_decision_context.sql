-- Scope-change deciders can open the decision without belonging to the project (completion pass, section 3). ADDITIVE: adds two read-only functions; no table, column, policy, trigger
-- or privilege on anything existing changes, and no data changes.
--
-- WHY. proj_decide_scope_change() authorises exactly one thing: the capability approve_scope (or founder) in the project's company. Nothing there asks for project membership.
-- But a holder of approve_scope who is neither a founder nor a member of the project could not READ the proposal (row-level security needs founder or membership), so they could
-- neither be told about it nor see what they were asked to approve. Reproduced in packages/rls-tests/test/project_scope_decision_context.rls.test.ts.
--
-- WHAT. Two functions that return ONLY what the decision form needs, to the people the decision function already authorises, and nothing else:
--   * proj_scope_decisions_waiting()      the open proposals the caller may decide now: proposal id, project id, project reference and name, the proposal title, when it was proposed.
--   * proj_scope_decision_context(id)     one proposal for the decision page: the same fields, plus the proposed scope text, the stated effect on dates, who proposed it (display name)
--                                         and the proposal's status, and whether it can still be decided. An unknown proposal and a caller who may not decide it get no row.
-- WHAT THEY DO NOT RETURN: the project's current scope or any other project field, members, tasks, budget, handover, files, discussion, the cost effect of the proposal
-- (proj_scope_change_commercial stays behind view_commercial), the feedback that prompted it, or decision notes. They do not make anybody a member and read no project table for the caller.
-- Who may decide, the decision function and its checks are unchanged; so is who can read proj_scope_changes directly.
--
-- Founders and members who hold approve_scope get the same rows as before, plus open proposals on projects of their company they do not belong to (the decision the capability already
-- allows). The My Day row and the decision page use these functions; the notification for people who cannot open the project IS that row (the notice reader shows participants only).
-- Rollback: supabase/manual-sql/scopectx_90_rollback.sql drops both functions.

create or replace function proj_scope_decisions_waiting()
returns table (
  scope_change_id uuid,
  project_id uuid,
  project_reference text,
  project_name text,
  title text,
  proposed_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  return query
    select s.id, p.id, p.reference, p.name, s.title, s.proposed_at
      from proj_scope_changes s
      join proj_projects p on p.id = s.project_id
     where s.status = 'proposed'
       and p.status not in ('completed', 'archived')
       and proj_has_capability(p.company_id, 'approve_scope')
     order by s.proposed_at, s.id
     limit 200;
end;
$$;

create or replace function proj_scope_decision_context(p_scope_change_id uuid)
returns table (
  scope_change_id uuid,
  project_id uuid,
  project_reference text,
  project_name text,
  title text,
  proposed_scope text,
  effect_on_dates text,
  proposed_by_name text,
  proposed_at timestamptz,
  status text,
  can_decide boolean
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform proj_require_user();
  return query
    select s.id, p.id, p.reference, p.name, s.title, s.proposed_scope, s.effect_on_dates,
           coalesce(nullif(btrim(pr.full_name), ''), 'the Project Manager'), s.proposed_at, s.status,
           (s.status = 'proposed' and p.status not in ('completed', 'archived'))
      from proj_scope_changes s
      join proj_projects p on p.id = s.project_id
      left join profiles pr on pr.id = s.proposed_by
     where s.id = p_scope_change_id
       and proj_has_capability(p.company_id, 'approve_scope');
end;
$$;

revoke all on function proj_scope_decisions_waiting() from public, anon;
revoke all on function proj_scope_decision_context(uuid) from public, anon;
grant execute on function proj_scope_decisions_waiting() to authenticated;
grant execute on function proj_scope_decision_context(uuid) to authenticated;
