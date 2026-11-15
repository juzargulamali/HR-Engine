-- Operations: WHO is committed twice. ADDITIVE; one new read, nothing existing is changed. Safe to run twice.
--
-- ops_crew_overlaps(company): for an Operations Manager (or founder) of the company, every person who holds two CONFIRMED site commitments whose windows overlap, with BOTH
-- commitments: what it is, its project, its exact window (instants plus the local date and time in the SITE's own time zone) and the ids the screen links with.
--   * A commitment is a crew place on a confirmed site activity that is not finished or cancelled, or a confirmed site booking (with its preparation and travel allowance): the same
--     two kinds, and the same windows, that proj_crew_overlaps already counts for the Site schedule warning. A booking made for an activity the person is also crewed on is the
--     same commitment: the crew place stands for it.
--   * Only live projects, and only overlaps that are not wholly in the past.
--   * COMPANY BOUNDARY. The first commitment is always in the company asked for. The other may be in another company: it is described in full only when the caller holds the
--     Operations right (or is a founder) THERE too. Otherwise that side carries its window and "hidden": true and nothing else: no project name or reference, no title, no venue,
--     no ids. The person is named because they are on a crew or booking of the caller's own company.
--   * The office board (ops_tv_board) is NOT changed and does not call this: a display identity is refused here like anyone who is not an Operations Manager.

create or replace function ops_commitment_side(p_kind text, p_id uuid, p_project_id uuid, p_reference text, p_project_name text, p_title text, p_run text, p_range tstzrange, p_tz text,
                                               p_all_day boolean, p_visible boolean)
returns jsonb language sql stable as $$
  select jsonb_build_object(
      'hidden', not p_visible, 'starts_at', lower(p_range), 'ends_at', upper(p_range), 'tz', p_tz, 'all_day', p_all_day,
      'starts_local', to_char(lower(p_range) at time zone p_tz, 'YYYY-MM-DD"T"HH24:MI'),
      -- an all-day window ends at the following midnight: its last day is the day before
      'ends_local', to_char((upper(p_range) - case when p_all_day then interval '1 minute' else interval '0' end) at time zone p_tz, 'YYYY-MM-DD"T"HH24:MI'))
    || case when p_visible then jsonb_build_object('kind', p_kind, 'id', p_id, 'project_id', p_project_id, 'reference', p_reference, 'project_name', p_project_name, 'title', p_title,
                                                   'run_label', p_run)
            else '{}'::jsonb end;
$$;

create or replace function ops_crew_overlaps(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_total integer;
begin
  perform ops_require(p_company_id);
  with c as (
    -- crew places on confirmed, unfinished site activities of live projects
    -- (a person with two roles on one activity holds one commitment there)
    select distinct s.user_id, 'crew'::text as kind, i.id, i.id as item_id, p.id as project_id, p.company_id, p.reference, p.name as project_name, i.title, i.run_label,
           proj_activity_range(i.id) as rng, coalesce(i.tz, d.site_timezone, 'UTC') as tz, (i.starts_at is null) as all_day
      from proj_site_crew s
      join proj_plan_items i on i.id = s.plan_item_id and i.plan = 'site' and i.activity_state = 'confirmed' and i.status not in ('done', 'cancelled')
      join proj_projects p on p.id = i.project_id and p.status not in ('completed', 'archived')
      left join proj_project_details d on d.project_id = p.id
    union all
    -- confirmed site bookings, with their preparation and travel allowance
    select b.user_id, 'booking', b.id, b.plan_item_id, p.id, p.company_id, p.reference, p.name, 'Site booking: ' || b.location, null,
           tstzrange(b.starts_at - make_interval(mins => b.lead_minutes), b.ends_at + make_interval(mins => b.trail_minutes), '[)'), b.tz, false
      from proj_site_bookings b
      join proj_projects p on p.id = b.project_id and p.status not in ('completed', 'archived')
     where b.state = 'confirmed'
       -- a booking made for an activity the person is also crewed on is that same commitment: the crew place stands for it
       and not exists (select 1 from proj_site_crew s join proj_plan_items i on i.id = s.plan_item_id
                        where s.user_id = b.user_id and s.plan_item_id = b.plan_item_id and i.activity_state = 'confirmed' and i.status not in ('done', 'cancelled'))
  ), mine as (select array(select ops_company_ids()) as ids),
  pairs as (
    select a.user_id, a.rng * b.rng as both,
           ops_commitment_side(a.kind, a.id, a.project_id, a.reference, a.project_name, a.title, a.run_label, a.rng, a.tz, a.all_day, true) as side_a,
           ops_commitment_side(b.kind, b.id, b.project_id, b.reference, b.project_name, b.title, b.run_label, b.rng, b.tz, b.all_day, b.company_id = any (mine.ids)) as side_b
      from c a
      join c b on b.user_id = a.user_id and (b.kind, b.id) <> (a.kind, a.id)
      cross join mine
     where a.company_id = p_company_id
       and a.rng is not null and b.rng is not null and a.rng && b.rng
       and upper(a.rng) > now() and upper(b.rng) > now()
       -- one row per pair when both sides are in this company; a side in another company is always the second
       and (b.company_id <> p_company_id or (a.kind, a.id) < (b.kind, b.id))
  )
  select coalesce(jsonb_agg(row_j order by from_at, person, a_title) filter (where rn <= 100), '[]'::jsonb), count(*)
    into v, v_total
    from (
      select jsonb_build_object('user_id', x.user_id, 'person', proj_display_name(x.user_id), 'overlap_from', lower(x.both), 'overlap_to', upper(x.both), 'a', x.side_a, 'b', x.side_b) as row_j,
             lower(x.both) as from_at, proj_display_name(x.user_id) as person, x.side_a ->> 'title' as a_title,
             row_number() over (order by lower(x.both), proj_display_name(x.user_id), x.side_a ->> 'title', x.side_a ->> 'id', x.side_b ->> 'starts_at') as rn
        from pairs x) q;
  return jsonb_build_object('company_id', p_company_id, 'taken_at', now(), 'overlaps', v, 'total', coalesce(v_total, 0), 'truncated', coalesce(v_total, 0) > 100);
end;
$$;

revoke all on function ops_commitment_side(text, uuid, uuid, text, text, text, text, tstzrange, text, boolean, boolean), ops_crew_overlaps(uuid) from public, anon, authenticated;
grant execute on function ops_crew_overlaps(uuid) to authenticated;
