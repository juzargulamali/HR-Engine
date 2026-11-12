-- WRITES. OWNER-RUN ROLLBACK of 20270102000100_ops_phase2b.sql. Safe to run twice.
-- BEFORE running it:
--   1. Deploy (or keep) an app version without Operations, or accept that Operations, the Sales "Operations planning" panel, the edition on projects, the equipment
--      review and the Archived section of Chat stop working or say "not installed".
--   2. EXPORT what will be deleted:
--        select id, reference, ops_flagged_at, ops_flagged_by, ops_decision_date, ops_dates_tentative, ops_dismantle_date, ops_teams, ops_to_confirm, ops_note from crm_opportunities where ops_flagged_at is not null;
--        select * from ops_enquiry_planning; select * from proj_equipment_reviews;
--        select project_id, event_edition_id, edition_snapshot from proj_project_details where event_edition_id is not null;
--        select id, event_edition_id, edition_snapshot from proj_handovers where event_edition_id is not null;
--        select user_id, company_id, capabilities from proj_company_grants where revoked_at is null and 'operations' = any (capabilities);
-- WHAT IT DOES: removes the Operations capability from every Projects grant that has it (the grant itself and its other capabilities stay; a grant that held ONLY
--   Operations stays as plain Projects access: revoke it in People & Access if that is not wanted), removes the planning fields, the edition copies, the equipment
--   reviews and the Operations functions, and restores the Chat, capability and closeout evidence functions as they were before.
-- WHAT STAYS: every enquiry, handover, project, task, request, reservation and chat message. Nothing in Inventory is touched.
do $$ declare n integer;
begin
  select count(*) into n from proj_company_grants where revoked_at is null and 'operations' = any (capabilities);
  raise notice 'Projects grants that lose the Operations capability: %', n;
end $$;
begin;
update proj_company_grants set capabilities = array_remove(capabilities, 'operations') where 'operations' = any (capabilities);

create or replace function proj_capability_list()
returns text[] language sql immutable as $fn$
  select array['founder', 'assign_pm', 'manage_access', 'approve_scope', 'view_commercial', 'view_audit', 'reopen_project', 'override_site_conflict']::text[];
$fn$;
create or replace function proj_has_capability(p_company_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from proj_company_grants g
    join profiles p on p.id = g.user_id and p.is_active
    where g.user_id = auth.uid() and g.company_id = p_company_id and g.revoked_at is null
      and ('founder' = any (g.capabilities) or p_capability = any (g.capabilities)));
$fn$;

create or replace function proj_can_view_details(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from proj_projects pr
    where pr.id = p_project_id and (proj_is_founder(pr.company_id) or proj_is_active_member(pr.id)));
$fn$;
create or replace function proj_can_view_summary(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from proj_projects pr
    where pr.id = p_project_id
      and (proj_is_founder(pr.company_id)
           or proj_is_active_member(pr.id)
           or (proj_has_access(pr.company_id) and pr.status in ('planning', 'in_progress', 'ready_for_installation', 'on_site', 'on_hold'))
           or proj_sales_linked(pr.id)));
$fn$;

-- Chat, as installed by 20261230000100.
create or replace function chat_is_member(p_user uuid, p_group uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from chat_groups g where g.id = p_group and (
      (g.kind = 'sales' and g.company_id is not null and chat_has_company_grant(p_user, g.company_id))
      or (g.kind = 'project' and g.project_id is not null and chat_is_project_member(p_user, g.project_id))));
$fn$;
create or replace function chat_project_group(p_project uuid)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not chat_is_project_member(v_user, p_project) then raise exception 'You are not a member of this group' using errcode = '42501'; end if;
  return chat_ensure_project_group(p_project);
end;
$fn$;
drop function if exists chat_my_groups();
create function chat_my_groups()
returns table (gid uuid, gkey text, gname text, unread bigint, mentions bigint, last_at timestamptz, last_sender text, last_preview text, gkind text, project_id uuid, read_only boolean)
language plpgsql security definer set search_path = public as $fn$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform chat_sync_sales_groups();
  perform chat_ensure_project_group(m.project_id) from proj_project_members m
    where m.user_id = v_user and m.removed_at is null and not exists (select 1 from chat_groups g where g.project_id = m.project_id);
  insert into chat_read_state (user_id, group_id, last_read_seq)
    select v_user, g.id, coalesce((select max(m.seq) from chat_messages m where m.group_id = g.id), 0)
    from chat_groups g where chat_is_member(v_user, g.id)
  on conflict do nothing;
  return query
    select g.id, g.key, case when pr.id is null then g.name else pr.reference || ' · ' || pr.name end,
           (select count(*) from chat_messages m where m.group_id = g.id and m.seq > rs.last_read_seq and m.sender_id <> v_user),
           (select count(*) from chat_message_mentions mm join chat_messages m on m.id = mm.message_id
              where m.group_id = g.id and mm.user_id = v_user and m.seq > rs.last_read_seq and m.sender_id <> v_user),
           lm.created_at, case when lm.id is null then null else chat_name(lm.sender_id) end,
           case when lm.id is null then null when length(btrim(lm.body)) = 0 then 'Shared an item' else left(lm.body, 80) end,
           g.kind, g.project_id, coalesce(pr.status in ('completed', 'archived'), false)
    from chat_groups g
    join chat_read_state rs on rs.user_id = v_user and rs.group_id = g.id
    left join proj_projects pr on pr.id = g.project_id
    left join lateral (select m2.id, m2.created_at, m2.sender_id, m2.body from chat_messages m2 where m2.group_id = g.id order by m2.seq desc limit 1) lm on true
    where chat_is_member(v_user, g.id)
      and (g.kind <> 'project' or pr.status not in ('completed', 'archived') or lm.id is not null)
    order by case when g.kind = 'sales' then 0 else 1 end, g.sort_order, lm.created_at desc nulls last, 3;
end;
$fn$;
revoke all on function chat_is_member(uuid, uuid), chat_project_group(uuid), chat_my_groups() from public, anon, authenticated;
grant execute on function chat_project_group(uuid), chat_my_groups() to authenticated;
create or replace function chat_group_members(p_group uuid)
returns table (user_id uuid, name text)
language plpgsql security definer set search_path = public as $fn$
declare v_user uuid := auth.uid(); v_company uuid; v_project uuid;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not chat_is_member(v_user, p_group) then raise exception 'You are not a member of this group' using errcode = '42501'; end if;
  select g.company_id, g.project_id into v_company, v_project from chat_groups g where g.id = p_group;
  if v_project is not null then
    return query
      select distinct m.user_id, chat_name(m.user_id) from proj_project_members m
      where m.project_id = v_project and m.removed_at is null and chat_is_project_member(m.user_id, v_project) order by 2;
  else
    return query
      select distinct g.user_id, chat_name(g.user_id) from crm_company_grants g join profiles p on p.id = g.user_id and p.is_active
      where g.company_id = v_company and g.revoked_at is null order by 2;
  end if;
end;
$fn$;
revoke all on function chat_group_members(uuid) from public, anon, authenticated;
grant execute on function chat_group_members(uuid) to authenticated;
drop function if exists chat_is_ops(uuid, uuid);

-- Sales links: the wrapper goes, the earlier function takes its name back. The internal project guard and the handover notice for Operations go.
do $$
begin
  if to_regprocedure('public.proj_set_sales_link_base(uuid, uuid, boolean)') is not null then
    drop function if exists proj_set_sales_link(uuid, uuid, boolean);
    alter function proj_set_sales_link_base(uuid, uuid, boolean) rename to proj_set_sales_link;
    revoke all on function proj_set_sales_link(uuid, uuid, boolean) from public, anon, authenticated;
    grant execute on function proj_set_sales_link(uuid, uuid, boolean) to authenticated;
  end if;
end $$;
drop trigger if exists trg_proj_internal_project_guard on proj_projects;
drop function if exists proj_internal_project_guard();
drop trigger if exists trg_proj_handover_submitted_ops on proj_handovers;
drop function if exists proj_handover_submitted_ops();
drop function if exists proj_holds_assign_pm(uuid);
create or replace function proj_staff_directory()
returns table (user_id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = public as $fn$
begin
  perform proj_require_user();
  if not exists (
    select 1 from proj_company_grants g join profiles p on p.id = g.user_id and p.is_active
     where g.user_id = auth.uid() and g.revoked_at is null
       and ('founder' = any (g.capabilities) or 'manage_access' = any (g.capabilities) or 'assign_pm' = any (g.capabilities))
  ) then return; end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)), case when proj_is_any_founder() then p.email end
    from profiles p where p.is_active
    order by 2, p.email;
end;
$fn$;


-- Closeout evidence: the wrapped function goes, the earlier one takes its name back.
do $$
begin
  if to_regprocedure('public.proj_closeout_evidence_base(uuid)') is not null then
    drop function if exists proj_closeout_evidence(uuid);
    alter function proj_closeout_evidence_base(uuid) rename to proj_closeout_evidence;
    revoke all on function proj_closeout_evidence(uuid) from public, anon, authenticated;
    grant execute on function proj_closeout_evidence(uuid) to authenticated;
  end if;
end $$;

drop trigger if exists trg_proj_details_dates_changed on proj_project_details;
drop trigger if exists trg_proj_details_edition on proj_project_details;
drop trigger if exists trg_proj_handover_edition on proj_handovers;
drop function if exists ops_overview(uuid);
drop function if exists proj_equipment_readiness(uuid);
drop function if exists inv_project_release_pending(uuid);
drop function if exists inv_request_state(uuid);
drop function if exists proj_resolve_equipment_review(uuid, text);
drop function if exists proj_details_dates_changed();
drop function if exists proj_projects_for_edition(uuid);
drop function if exists proj_project_editions();
drop function if exists proj_details_edition();
drop function if exists proj_handover_edition();
drop function if exists crm_ops_planning(uuid);
drop function if exists ops_upcoming_work(uuid);
drop function if exists ops_set_enquiry_planning(uuid, jsonb);
drop function if exists crm_set_ops_planning(uuid, boolean, jsonb, integer);
drop function if exists ops_edition_snapshot(uuid);
drop function if exists ops_notify_managers(uuid, text, jsonb, text);
drop function if exists ops_require(uuid);
drop function if exists ops_company_ids();
drop table if exists proj_equipment_reviews;
drop table if exists ops_enquiry_planning;
-- An accepted handover is a frozen record: its two columns are dropped by the table change, which no row trigger sees.
drop index if exists idx_proj_details_edition;
alter table proj_project_details drop column if exists event_edition_id, drop column if exists edition_snapshot;
alter table proj_handovers drop column if exists event_edition_id, drop column if exists edition_snapshot;
drop index if exists idx_crm_opp_ops_flagged;
alter table crm_opportunities drop constraint if exists crm_opportunities_ops_shape;
alter table crm_opportunities drop column if exists ops_flagged_at, drop column if exists ops_flagged_by, drop column if exists ops_decision_date, drop column if exists ops_dates_tentative,
  drop column if exists ops_dismantle_date, drop column if exists ops_teams, drop column if exists ops_to_confirm, drop column if exists ops_note;
commit;
