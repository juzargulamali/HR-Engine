-- Phase 3: the Operations TV (the office board).
-- ADDITIVE ONLY: one new table and six new functions (five callable by a signed-in user). No existing table, column, function, policy or grant is changed, and nothing is backfilled.
-- Prerequisites: 20270109000100_proj_phase2_site_state.sql (phase, readiness and effective-date functions) and the Inventory request state function.
-- Install order: preflight (supabase/manual-sql/ops_tv_display_00_preflight_readonly.sql), this migration, verify (..._20_verify_readonly.sql), then deploy the app.
-- Rollback: supabase/manual-sql/ops_tv_display_90_rollback.sql (drops the functions, then the table; it stops while a display is still active).
--
-- WHAT IT DOES
--   * ops_tv_displays: one registered display identity per sign-in account, for one company. A display is an ordinary account with NO employee record and NO Projects / CRM / Inventory /
--     Phone-system grant and no role, so every existing read and write refuses it through its own checks. Row level security is on with no policy (a wall); nothing is granted.
--   * ops_tv_board(company): ONE read that returns an allowlist of display fields (docs/operations-tv-scope.md section 3). It is allowed for an un-revoked display of that company, or for
--     a holder of the Operations capability of that company (a founder counts). It checks on every call, so a revoked display is refused on its very next read.
--   * ops_tv_my_display(): what the caller is, if they are a display (the page uses it to say "revoked" instead of "no access").
--   * ops_tv_register_display / ops_tv_revoke_display / ops_tv_list_displays: for Operations Managers of the company only.
--   * ops_tv_person_name(uuid) (internal, not callable): the name shown for a person. Never the e-mail address.
-- It reuses the Phase 2 rules (proj_site_phase_json, proj_activity_effective, proj_readiness_run_area, proj_readiness_project_area, inv_request_state) so the board cannot disagree with
-- the Project pages: Started only from the explicit start record, a passed date alone is "date_passed", header-date fallbacks carry basis = project_header.

-- 1. The registry of display identities.
create table if not exists ops_tv_displays (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  company_id    uuid not null references companies(id),
  label         text not null check (length(btrim(label)) between 1 and 60),
  office_tz     text not null default 'Asia/Dubai',
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  last_seen_at  timestamptz,
  constraint ops_tv_displays_tz check (proj_valid_timezone(office_tz)),
  constraint ops_tv_displays_user_unique unique (user_id)
);
create index if not exists idx_ops_tv_displays_company on ops_tv_displays(company_id, created_at desc);
alter table ops_tv_displays enable row level security;
revoke all on table ops_tv_displays from anon, authenticated, public;

-- 2. The name shown for a person: the profile's full name, else a neutral word. The e-mail address (or its first part) is never used.
create or replace function ops_tv_person_name(p_user_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(p.full_name), '') from profiles p where p.id = p_user_id), 'Team member');
$$;
revoke all on function ops_tv_person_name(uuid) from public, anon, authenticated;

-- 3. What the caller is: their own display registration, or null when they are not a display identity.
create or replace function ops_tv_my_display()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d ops_tv_displays;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into d from ops_tv_displays where user_id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object('id', d.id, 'company_id', d.company_id, 'company_name', (select c.legal_name from companies c where c.id = d.company_id),
                            'label', d.label, 'office_tz', d.office_tz, 'revoked_at', d.revoked_at, 'revoked', d.revoked_at is not null);
end;
$$;
revoke all on function ops_tv_my_display() from public, anon, authenticated;
grant execute on function ops_tv_my_display() to authenticated;

-- 4. The board. One bounded read; the allowlist is the object built here and nothing else.
--    Bounds: 300 activities, 100 shipments, 40 projects, 20 handovers (each fetched with one extra row so "truncated" is exact).
--    Not volatile-free: it records the display's last_seen_at (at most once a minute).
create or replace function ops_tv_board(p_company_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); d ops_tv_displays; v_access text; v_office_tz text := 'Asia/Dubai'; v_company jsonb;
  v_acts jsonb; v_acts_trunc boolean; v_ship jsonb; v_ship_trunc boolean; v_proj jsonb; v_proj_trunc boolean; v_hand jsonb;
  v_order text[] := array['short', 'partially_ready', 'partially_dispatched', 'draft', 'reserved', 'dispatched', 'still_out', 'returned', 'empty'];
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_company_id is null then raise exception 'Choose a company' using errcode = '22023'; end if;
  select * into d from ops_tv_displays where user_id = v_uid and company_id = p_company_id;
  if found then
    -- a display identity is only a display: revoked or deactivated means refused, on this very call
    if d.revoked_at is not null then raise exception 'This office board display has been revoked' using errcode = '42501', hint = 'revoked'; end if;
    if not exists (select 1 from profiles p where p.id = v_uid and p.is_active) then raise exception 'This office board display is switched off' using errcode = '42501', hint = 'revoked'; end if;
    v_access := 'display'; v_office_tz := d.office_tz;
    if d.last_seen_at is null or d.last_seen_at < now() - interval '1 minute' then update ops_tv_displays set last_seen_at = now() where id = d.id; end if;
  elsif proj_has_capability(p_company_id, 'operations') then
    v_access := 'operations';
  else
    raise exception 'The office board is open to this company''s display and its Operations Managers' using errcode = '42501';
  end if;
  select jsonb_build_object('id', c.id, 'name', c.legal_name) into v_company from companies c where c.id = p_company_id;
  if v_company is null then raise exception 'Company not found' using errcode = 'P0002'; end if;

  -- 4a. Site activities (separate runs stay separate rows). Phase and effective venue/date come from the Phase 2 functions.
  with base as (
    select i.id, i.project_id, i.title, i.activity_kind, i.run_label, i.activity_state, i.owner_id, i.start_date, i.end_date, i.starts_at, i.ends_at, i.location,
           i.ready_hardware, i.ready_content, i.ready_app, coalesce(i.tz, d2.site_timezone) as tz, p.reference as p_ref, p.name as p_name,
           proj_activity_effective(i.id) as eff, proj_site_phase_json(i.id) as ph
    from proj_plan_items i
    join proj_projects p on p.id = i.project_id
    left join proj_project_details d2 on d2.project_id = p.id
    where i.plan = 'site' and i.status not in ('done', 'cancelled') and p.company_id = p_company_id and p.status not in ('completed', 'archived')
  ), keyed as (
    select b.*, coalesce(b.starts_at, (coalesce(b.start_date, (b.eff ->> 'start_date')::date)::timestamp at time zone coalesce(b.tz, 'UTC'))) as sort_key,
           (coalesce((b.ph ->> 'last_day')::date, current_date) < current_date - 30 and b.ph ->> 'phase' <> 'started') as long_past
    from base b
  ), lim as (
    select k.*, row_number() over (order by k.long_past, k.sort_key nulls last, k.title, k.id) as rn from keyed k order by k.long_past, k.sort_key nulls last, k.title, k.id limit 301
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'project_id', l.project_id, 'project_ref', l.p_ref, 'project_name', l.p_name, 'title', l.title, 'kind', l.activity_kind, 'run_label', l.run_label, 'state', l.activity_state,
           'phase', jsonb_build_object('phase', l.ph ->> 'phase', 'basis', l.ph ->> 'basis', 'first_day', l.ph -> 'first_day', 'last_day', l.ph -> 'last_day', 'started_at', l.ph -> 'started_at',
                                       'choice_pending', coalesce((l.ph ->> 'choice_pending')::boolean, false)),
           'venue', l.eff ->> 'venue', 'venue_source', l.eff ->> 'venue_source',
           'start_date', l.start_date, 'end_date', l.end_date, 'starts_at', l.starts_at, 'ends_at', l.ends_at, 'tz', l.tz,
           'lead', case when l.owner_id is null then null else jsonb_build_object('name', ops_tv_person_name(l.owner_id)) end,
           'crew', crew.arr, 'crew_total', coalesce(crew.total, 0), 'call_missing', coalesce(crew.no_call, 0),
           'readiness', jsonb_build_object(
              'hardware', case when l.ready_hardware <> 'unknown' then l.ready_hardware else proj_readiness_run_area(l.id, 'hardware') ->> 'state' end,
              'content',  case when l.ready_content  <> 'unknown' then l.ready_content  else proj_readiness_run_area(l.id, 'content')  ->> 'state' end,
              'app',      case when l.ready_app      <> 'unknown' then l.ready_app      else proj_readiness_run_area(l.id, 'apps')     ->> 'state' end))
         order by l.rn) filter (where l.rn <= 300), '[]'::jsonb),
         count(*) > 300
    into v_acts, v_acts_trunc
  from lim l
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('name', c.nm, 'role', c.crew_role) order by c.rn) filter (where c.rn <= 12), '[]'::jsonb) as arr, max(c.total) as total, max(c.no_call) as no_call
    from (select s.crew_role, ops_tv_person_name(s.user_id) as nm,
                 row_number() over (order by array_position(array['installation', 'dismantling', 'standby', 'backup'], s.crew_role), ops_tv_person_name(s.user_id), s.user_id) as rn,
                 count(*) over () as total, count(*) filter (where s.call_at is null) over () as no_call
          from proj_site_crew s where s.plan_item_id = l.id) c) crew;

  -- 4b. Shipments of the live projects: what has not come back yet (or came back within two days), with the Inventory request each carries.
  with sh as (
    select s.id, s.project_id, p.reference as p_ref, p.name as p_name, s.label, s.plan_item_id, s.request_id, s.departs_at, s.arrives_at, s.returns_at, s.state,
           coalesce(s.arrives_tz, s.departs_tz, s.returns_tz, i.tz, d2.site_timezone) as tz, i.title as a_title, i.run_label as a_run
    from proj_site_shipments s
    join proj_projects p on p.id = s.project_id
    left join proj_plan_items i on i.id = s.plan_item_id
    left join proj_project_details d2 on d2.project_id = p.id
    where p.company_id = p_company_id and p.status not in ('completed', 'archived')
      and (greatest(s.departs_at, s.arrives_at, s.returns_at) is null or greatest(s.departs_at, s.arrives_at, s.returns_at) >= now() - interval '2 days')
  ), lim as (
    select x.*, row_number() over (order by coalesce(x.departs_at, x.arrives_at, x.returns_at) nulls last, x.label, x.id) as rn from sh x
    order by coalesce(x.departs_at, x.arrives_at, x.returns_at) nulls last, x.label, x.id limit 101
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'project_id', l.project_id, 'project_ref', l.p_ref, 'project_name', l.p_name, 'label', l.label, 'activity_id', l.plan_item_id, 'activity_title', l.a_title, 'run_label', l.a_run,
           'departs_at', l.departs_at, 'arrives_at', l.arrives_at, 'returns_at', l.returns_at, 'tz', l.tz, 'state', l.state,
           'request', case when l.request_id is null then null else (select jsonb_build_object('code', r ->> 'code', 'state', r ->> 'state', 'units_short', (r ->> 'units_short')::numeric,
                                                                                       'expected_return_at', r -> 'expected_return_at', 'return_overdue', (r ->> 'return_overdue')::boolean)
                                                                    from (select inv_request_state(l.request_id) as r) q) end)
         order by l.rn) filter (where l.rn <= 100), '[]'::jsonb),
         count(*) > 100
    into v_ship, v_ship_trunc
  from lim l;

  -- 4c. Active projects: the next site activity is the first of the activities already read above (started or due today, then scheduled, then date passed, then undated).
  with acts as (
    select a, n, a ->> 'project_id' as pid, a -> 'phase' ->> 'phase' as ph,
           case a -> 'phase' ->> 'phase' when 'started' then 0 when 'due_today' then 0 when 'scheduled' then 1 when 'date_passed' then 2 else 3 end as rk
    from jsonb_array_elements(v_acts) with ordinality t(a, n)
  ), pj as (
    select p.id, p.reference, p.name, p.status, p.kind, p.pm_user_id, nx.aid, nx.rk, nx.n
    from proj_projects p
    left join lateral (select a ->> 'id' as aid, rk, n from acts where pid = p.id::text order by rk, n limit 1) nx on true
    where p.company_id = p_company_id and p.status not in ('completed', 'archived')
  ), lim as (
    select x.*, row_number() over (order by x.rk nulls last, x.n nulls last, x.name, x.id) as rn from pj x order by x.rk nulls last, x.n nulls last, x.name, x.id limit 41
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'ref', l.reference, 'name', l.name, 'status', l.status, 'kind', l.kind, 'pm_name', ops_tv_person_name(l.pm_user_id),
           'activations', (select coalesce(jsonb_agg(jsonb_build_object('title', t.title) order by t.sort_order, t.title), '[]'::jsonb)
                           from (select it.title, it.sort_order from proj_dp_items it where it.project_id = l.id and it.removed_at is null order by it.sort_order, it.title limit 4) t),
           'next_activity_id', l.aid,
           'dated_activities', (select count(*) from acts where pid = l.id::text and (a -> 'phase' ->> 'first_day') is not null),
           'project_readiness', jsonb_build_object('hardware', proj_readiness_project_area(l.id, 'hardware') ->> 'state', 'content', proj_readiness_project_area(l.id, 'content') ->> 'state',
                                                   'app', proj_readiness_project_area(l.id, 'apps') ->> 'state'),
           'equipment', (select jsonb_build_object('requests', count(*), 'worst_state', (array_agg(x.st order by coalesce(array_position(v_order, x.st), 99)))[1])
                         from (select inv_request_state(q.id) ->> 'state' as st from inv_requests q where q.project_id = l.id and q.status <> 'cancelled') x))
         order by l.rn) filter (where l.rn <= 40), '[]'::jsonb),
         count(*) > 40
    into v_proj, v_proj_trunc
  from lim l;

  -- 4d. Handovers waiting for acceptance: titles, reference, place and date only (never the client, scope, risks or notes).
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'reference', h.crm_reference, 'title', h.title, 'status', h.status,
           'pm_name', case when h.pm_user_id is null then null else ops_tv_person_name(h.pm_user_id) end,
           'install_start', h.install_start, 'location', h.location, 'submitted_at', h.submitted_at) order by h.submitted_at nulls last, h.title), '[]'::jsonb)
    into v_hand
  from (select * from proj_handovers where company_id = p_company_id and status in ('submitted', 'pm_assigned', 'clarification_requested')
        order by submitted_at nulls last, title limit 20) h;

  return jsonb_build_object(
    'generated_at', now(), 'access', v_access, 'company', v_company, 'office_tz', v_office_tz,
    'display', case when v_access = 'display' then jsonb_build_object('id', d.id, 'label', d.label) else null end,
    'truncated', jsonb_build_object('activities', coalesce(v_acts_trunc, false), 'projects', coalesce(v_proj_trunc, false), 'shipments', coalesce(v_ship_trunc, false)),
    'activities', v_acts, 'shipments', v_ship, 'projects', v_proj, 'handovers', v_hand, 'notes', '[]'::jsonb);
end;
$$;
revoke all on function ops_tv_board(uuid) from public, anon, authenticated;
grant execute on function ops_tv_board(uuid) to authenticated;

-- 5. Register a display identity (Operations Managers and founders of the company). The sign-in account is created by the app with the service role; this records it and refuses any
--    account that could already reach anything: an employee record, a Projects / CRM / Inventory / Phone-system grant, or an HR role. One registration per account.
create or replace function ops_tv_register_display(p_user_id uuid, p_company_id uuid, p_label text, p_office_tz text default 'Asia/Dubai')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_label text := btrim(coalesce(p_label, '')); v_tz text := coalesce(nullif(btrim(coalesce(p_office_tz, '')), ''), 'Asia/Dubai'); v_id uuid;
begin
  perform ops_require(p_company_id);
  if length(v_label) < 1 or length(v_label) > 60 then raise exception 'Give the display a name of up to 60 characters' using errcode = '22023'; end if;
  if not proj_valid_timezone(v_tz) then raise exception 'That time zone is not recognised' using errcode = '22023'; end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then raise exception 'That sign-in account does not exist' using errcode = '22023'; end if;
  if p_user_id = auth.uid() then raise exception 'Use a separate account for the display, not your own' using errcode = '22023'; end if;
  if exists (select 1 from employees e where e.user_id = p_user_id and e.deleted_at is null)
     or exists (select 1 from user_roles r where r.user_id = p_user_id and r.revoked_at is null)
     or exists (select 1 from proj_company_grants g where g.user_id = p_user_id and g.revoked_at is null)
     or exists (select 1 from crm_company_grants g where g.user_id = p_user_id and g.revoked_at is null)
     or exists (select 1 from inv_company_grants g where g.user_id = p_user_id and g.revoked_at is null)
     or exists (select 1 from pbx_company_grants g where g.user_id = p_user_id and g.revoked_at is null) then
    raise exception 'That account belongs to a person or already has access to something. A display needs its own account with no other permission' using errcode = '23514';
  end if;
  if exists (select 1 from ops_tv_displays x where x.user_id = p_user_id) then raise exception 'That account is already registered as a display' using errcode = '23505'; end if;
  insert into ops_tv_displays (user_id, company_id, label, office_tz, created_by) values (p_user_id, p_company_id, v_label, v_tz, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function ops_tv_register_display(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function ops_tv_register_display(uuid, uuid, text, text) to authenticated;

-- 6. Revoke a display. Idempotent. The very next ops_tv_board call of that account fails (42501); the app also bans the sign-in and ends its sessions.
--    Returns the display's user id so the app knows which sign-in to switch off.
create or replace function ops_tv_revoke_display(p_display_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d ops_tv_displays;
begin
  select * into d from ops_tv_displays where id = p_display_id;
  if not found then raise exception 'Display not found' using errcode = 'P0002'; end if;
  perform ops_require(d.company_id);
  if d.revoked_at is null then update ops_tv_displays set revoked_at = now(), revoked_by = auth.uid() where id = d.id; end if;
  return d.user_id;
end;
$$;
revoke all on function ops_tv_revoke_display(uuid) from public, anon, authenticated;
grant execute on function ops_tv_revoke_display(uuid) to authenticated;

-- 7. The list of a company's displays (active first). Includes the sign-in e-mail, so it is for Operations Managers only.
create or replace function ops_tv_list_displays(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform ops_require(p_company_id);
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'user_id', d.user_id, 'label', d.label, 'office_tz', d.office_tz, 'created_at', d.created_at, 'last_seen_at', d.last_seen_at,
                                                       'revoked_at', d.revoked_at, 'email', (select u.email from auth.users u where u.id = d.user_id))
                          order by (d.revoked_at is not null), d.created_at desc)
                   from ops_tv_displays d where d.company_id = p_company_id), '[]'::jsonb);
end;
$$;
revoke all on function ops_tv_list_displays(uuid) from public, anon, authenticated;
grant execute on function ops_tv_list_displays(uuid) to authenticated;
