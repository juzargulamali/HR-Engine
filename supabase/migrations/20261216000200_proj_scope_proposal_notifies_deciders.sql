-- Scope change proposals tell the people who decide (A11 / U-01). ADDITIVE: replaces one function in place (create or replace); no table, column, policy or
-- privilege changes, no data changes. Execute privileges are kept by create or replace.
--
-- WHY: proj_propose_scope_change wrote the proposal and told nobody; whoever decides (a Projects founder, or someone holding approve_scope) only found it by
-- opening the project's Feedback & changes page. Reproduced in packages/rls-tests/test/project_scope_decider.rls.test.ts.
--
-- RULE: after a proposal, each active founder and each approve_scope holder of the project's company who can open the project (a founder, or an eligible
-- member: the existing proj_notify rule) gets a 'project_scope_proposed' notice, deduplicated per proposal; the proposer is never told. My Day shows the row
-- from the proposal itself (status 'proposed'), so it disappears when the change is approved, rejected or withdrawn.
--
-- RUNTIME FINDING (not changed here): a holder of approve_scope who is neither a founder nor a member cannot read the proposal (row-level security needs
-- founder or membership) and cannot open the page, though proj_decide_scope_change would accept their decision if they called it. They get no notice, because
-- there is nothing they could open. Making them able to read it would widen who can read scope changes: that is an owner decision, not made here.
--
-- UNCHANGED: who may propose (the Project Manager, an acting PM or a founder), the validation, the commercial effect (still restricted), who decides, and the
-- decision function.

create or replace function proj_propose_scope_change(p_project_id uuid, p_fields jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v proj_projects;
  d proj_project_details;
  v_id uuid;
  v_feedback uuid := nullif(p_fields->>'feedback_id', '')::uuid;
  g record;
begin
  v := proj_lock_project(p_project_id);
  perform proj_require_manager(v);
  perform proj_require_open_project(v);
  select * into d from proj_project_details where project_id = v.id;
  if length(btrim(coalesce(p_fields->>'title', ''))) = 0 then raise exception 'Give the change a title' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_fields->>'proposed_scope', ''))) = 0 then raise exception 'Write the proposed scope' using errcode = '22023'; end if;
  if v_feedback is not null and not exists (select 1 from proj_feedback where id = v_feedback and project_id = v.id) then
    raise exception 'Unknown feedback' using errcode = '22023';
  end if;
  insert into proj_scope_changes (project_id, feedback_id, title, original_scope, base_scope_hash, proposed_scope, effect_on_dates, proposed_by)
  values (v.id, v_feedback, btrim(p_fields->>'title'), d.scope, md5(coalesce(d.scope, '')), btrim(p_fields->>'proposed_scope'),
          proj_text_or_null(p_fields, 'effect_on_dates'), auth.uid())
  returning id into v_id;
  if p_fields ? 'cost_note' or p_fields ? 'amount' then
    insert into proj_scope_change_commercial (scope_change_id, project_id, currency, amount, note, updated_by)
    values (v_id, v.id, nullif(upper(p_fields->>'currency'), ''), nullif(p_fields->>'amount', '')::numeric, proj_text_or_null(p_fields, 'cost_note'), auth.uid());
  end if;
  if v_feedback is not null then update proj_feedback set scope_change_id = v_id, version = version + 1 where id = v_feedback; end if;
  -- Tell the people who decide (a founder, or a holder of approve_scope). proj_notify keeps the usual rule: only those who can open the project (a founder,
  -- or an eligible member) get the notice, never the proposer, and a repeat for the same proposal is dropped by its dedupe key.
  for g in
    select distinct gr.user_id from proj_company_grants gr
     where gr.company_id = v.company_id and gr.revoked_at is null and ('founder' = any (gr.capabilities) or 'approve_scope' = any (gr.capabilities))
  loop
    perform proj_notify(v.id, g.user_id, 'project_scope_proposed',
      jsonb_build_object('name', v.name, 'reference', v.reference, 'scope_change_id', v_id, 'title', btrim(p_fields->>'title')),
      'scopechange:' || v_id || ':proposed');
  end loop;
  return v_id;
end;
$$;

-- ROLLBACK: re-apply the definition of proj_propose_scope_change from supabase/migrations/20261120000500_proj_feedback_plans_files_completion.sql (create or
-- replace). Notices already written stay as ordinary rows.
