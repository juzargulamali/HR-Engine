-- Project Plan usability follow-up: multi-row Quick add and persisted row order. ADDITIVE ONLY. Applied AFTER 20270104000100 (Project Plan Release 1).
-- Two new functions and their grants. No table, column, policy or existing function is changed; everything a row can hold already exists.
--
-- proj_dp_add_lines(item, section, rows, chain)
--   Adds up to 50 requirements to one technology / activation in ONE transaction, by calling proj_dp_save_line for each row: the same permission (the manager, or the
--   person the section is delegated to), the same validation, the same "same name in the same section = the same line" rule. So a retried or double-submitted save adds
--   nothing: rows that already exist are returned as existing and left exactly as they are. A refused row refuses the whole batch and names the row.
--   p_chain = true makes each row wait for the row above (a sequence such as Moodboard -> Storyboard), like proj_dp_add_sequence but with any section's fields.
--
-- proj_dp_reorder_lines(item, line ids)
--   Persists the order of requirements within a technology. The listed lines swap places among the positions they already occupy; every other line keeps its place.
--   Allowed for each line's section editor (manager or delegate). Ordering is not a commitment, so released lines may be reordered (no proposal, no task or equipment
--   change). Does not touch version numbers (an open edit dialog is not invalidated), raises the plan revision only when something moved, and is idempotent: sending the
--   same order again changes nothing.
-- ROLLBACK: supabase/manual-sql/proj_plan_quick_add_reorder_90_rollback.sql (drops the two functions; no data is touched).

create or replace function proj_dp_add_lines(p_item_id uuid, p_section text, p_rows jsonb, p_chain boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; n integer := 0; res jsonb; v_prev uuid; v_ids jsonb := '[]'::jsonb; v_created integer := 0; v_existing integer := 0; v_fields jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Add at least one row' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 50 then raise exception 'Add at most 50 rows at a time' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    if jsonb_typeof(r) <> 'object' then raise exception 'Row %: not a row', n using errcode = '22023'; end if;
    v_fields := jsonb_build_object('section', p_section) || (r - 'section' - 'depends_on' - 'sort_order');
    if p_chain and v_prev is not null then v_fields := v_fields || jsonb_build_object('depends_on', jsonb_build_array(v_prev)); end if;
    begin
      res := proj_dp_save_line(p_item_id, null, v_fields, null, 'screen');
    exception when others then
      raise exception 'Row %: %', n, sqlerrm using errcode = sqlstate;
    end;
    v_prev := (res->>'id')::uuid;
    v_ids := v_ids || to_jsonb(v_prev);
    if res ? 'created' then v_created := v_created + 1; else v_existing := v_existing + 1; end if;
  end loop;
  return jsonb_build_object('lines', v_ids, 'created', v_created, 'existing', v_existing);
end;
$$;

create or replace function proj_dp_reorder_lines(p_item_id uuid, p_line_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it proj_dp_items; v proj_projects; ln proj_dp_lines; v_all uuid[]; v_new uuid[] := '{}'; v_pos integer := 0; i integer; x uuid; v_moved integer := 0; v_rows integer;
begin
  select * into it from proj_dp_items where id = p_item_id and removed_at is null;
  if not found then raise exception 'Deliverable not found' using errcode = 'P0002'; end if;
  v := proj_lock_project(it.project_id);
  perform proj_require_member_or_founder(v);
  perform proj_require_open_project(v);
  if p_line_ids is null or cardinality(p_line_ids) = 0 then raise exception 'Nothing to reorder' using errcode = '22023'; end if;
  if cardinality(p_line_ids) > 200 then raise exception 'Too many rows to reorder' using errcode = '22023'; end if;
  if (select count(distinct u) from unnest(p_line_ids) u) <> cardinality(p_line_ids) then raise exception 'A row is listed twice' using errcode = '22023'; end if;
  foreach x in array p_line_ids loop
    select * into ln from proj_dp_lines where id = x and item_id = it.id and removed_at is null;
    if not found then raise exception 'Line not found' using errcode = 'P0002'; end if;
    if not proj_dp_can_edit_section(v.id, ln.section) then
      raise exception 'Only the Project Manager, or the person this section was delegated to, can change this section' using errcode = '42501';
    end if;
  end loop;
  -- The current order of the whole technology; the listed lines take their new relative order in the places they already hold.
  select array_agg(id order by sort_order, line_key) into v_all from proj_dp_lines where item_id = it.id and removed_at is null;
  for i in 1 .. cardinality(v_all) loop
    if v_all[i] = any (p_line_ids) then v_pos := v_pos + 1; v_new := v_new || p_line_ids[v_pos]; else v_new := v_new || v_all[i]; end if;
  end loop;
  for i in 1 .. cardinality(v_new) loop
    update proj_dp_lines set sort_order = i * 10, updated_at = now() where id = v_new[i] and sort_order is distinct from i * 10;
    get diagnostics v_rows = row_count;
    v_moved := v_moved + v_rows;
  end loop;
  if v_moved > 0 then perform proj_dp_touch(v.id); end if;
  return jsonb_build_object('moved', v_moved);
end;
$$;

revoke all on function proj_dp_add_lines(uuid, text, jsonb, boolean), proj_dp_reorder_lines(uuid, uuid[]) from public, anon, authenticated;
grant execute on function proj_dp_add_lines(uuid, text, jsonb, boolean), proj_dp_reorder_lines(uuid, uuid[]) to authenticated;
