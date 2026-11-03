-- WRITES (one function definition only; no table, row or privilege is touched). OWNER-RUN ROLLBACK of the scope proposal notification change
-- (20261216000200_proj_scope_proposal_notifies_deciders.sql): restores proj_propose_scope_change to exactly the definition that was live before it
-- (the one in 20261120000500_proj_feedback_plans_files_completion.sql).
--
-- WHEN TO USE IT: only if the notices cause a problem and you have decided to go back while it is fixed.
-- READ THIS FIRST: going back means a scope proposal tells nobody again (the decider finds it by opening the project's Feedback & changes page). Notices already
-- written stay as ordinary rows, nothing is deleted; who may propose and who decides do not change either way.
--
-- It is safe to run twice. Afterwards proj_scope_notify_20_verify_readonly.sql reports the new rules as missing (that is how it tells you the old definition is
-- back), or run proj_scope_notify_05_preservation_check_readonly.sql against your BEFORE snapshot (the fn: row then says UNCHANGED).
-- Execute privileges are kept by create or replace; nothing here grants or revokes anything.

begin;

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
  return v_id;
end;
$$;

commit;
