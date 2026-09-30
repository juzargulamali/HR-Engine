-- Recovery Leave / Jibble sync hardening -- Stage 1b of 2, SAFE and ADDITIVE.
--
-- Applied AFTER 20261106000000_recovery_leave_jibble_hr_queue_stage1.sql
-- (that migration must already be applied). Written in response to a
-- second review pass asking for real Jibble-tenant verification before
-- Production use; that live verification could NOT be completed in the
-- environment this was written in -- no JIBBLE_CLIENT_ID/SECRET were
-- configured, and this sandbox's network egress is blocked for every
-- Jibble-related and Jibble-doc-mirroring host tried (docs.api.jibble.io,
-- dlthub.com, jentic.com, docs.nexla.com, apitracker.io all refused the
-- connection at the proxy level). See PR #16's description for the exact
-- steps to complete that verification once both exist, and for what this
-- migration does instead: hardens the ingestion pipeline so that once real
-- data does flow through it, unknown or ambiguous data is VISIBLY flagged
-- rather than silently miscalculated, and a missed or partially-failed
-- sync run recovers on its own rather than quietly losing entries.
--
-- What changes, and why:
--
--   1. Fail-closed parsing (apps/web/src/lib/jibble/client.ts,
--      parseJibbleEntry(), not part of this SQL file but described here for
--      context): the client no longer silently guesses among candidate
--      field names and defaults ambiguous data (e.g. an unrecognized
--      breaks shape) to zero. Any ambiguity is now reported as an explicit
--      needsReview/reviewReason pair, passed through to
--      import_jibble_time_entry() below via two new parameters
--      (p_client_needs_review, p_client_review_reason).
--
--   2. import_jibble_time_entry() gains those two new parameters, a new
--      review_category output column (a machine-readable classification --
--      'unmapped_employee', 'invalid_times', 'missing_start',
--      'ambiguous_parse', 'edited_after_approval',
--      'manual_attendance_conflict', 'already_approved',
--      'ambiguous_entries_excluded' -- so the Attendance page can group
--      review items into distinct, actionable buckets instead of one
--      undifferentiated list), and an explicit guard for a missing start
--      time (previously not checked at all -- a null p_entry_start could
--      reach the work_date computation unguarded).
--
--   3. sync_jibble_attendance_for_day() now EXCLUDES any entry that is
--      already needs_review from its hour totals entirely, rather than
--      folding in whatever numbers happened to be stored for it (e.g. an
--      ambiguous entry's break_minutes, stored as 0 not because there
--      really were no breaks but because the shape couldn't be parsed).
--      When at least one entry for a day was excluded this way, the day's
--      result now comes back flagged_for_review = true even if the
--      CLEAN entries alone still produced a valid credit from real data --
--      "unknown or incomplete data must produce a visible review state,
--      never a silently wrong hours calculation" applies exactly as much
--      to a partial day as to a fully ambiguous one.
--
--   4. jibble_sync_checkpoints (new table) + record_jibble_sync_checkpoint()
--      (new function) replace the sync route's previous fixed "now minus
--      26 hours" lookback with a real per-company checkpoint: a normal run
--      reads how far it last successfully reached, applies a 2-hour
--      overlap (to still catch a Jibble-side correction made just before
--      the previous cutoff), and only advances the checkpoint once every
--      page in the window was fetched successfully. A page-level failure
--      (network error, non-2xx, bad JSON) leaves the checkpoint exactly
--      where it was, so the NEXT run retries the same range instead of
--      silently skipping whatever the failed page held -- this is what
--      "recovers after a missed sync" without depending on any fixed
--      window being wide enough. An explicit ?since=&until= on the sync
--      route (apps/web/src/app/api/cron/jibble-sync/route.ts) is the
--      "controlled backfill/reconciliation" path -- a deliberate, bounded
--      re-fetch of a specific range that never touches the stored
--      checkpoint either way.
--
-- Nothing here changes who can approve a recovery credit request, adds a
-- project selector, or reintroduces any project-manager routing -- the
-- single-HR-decision role-queue design from Stage 1 is unchanged. Nothing
-- here is a live cron: apps/web/src/app/api/cron/jibble-sync is still not
-- in vercel.json, and there is still no JIBBLE_CLIENT_ID/SECRET/COMPANY_ID
-- configured anywhere in this environment.

-- ---------------------------------------------------------------------
-- 1. jibble_time_entries: review_category column + an index for
--    "still clocked in" (entry_end is null) shifts, surfaced separately
--    from needs_review on the Attendance page since an open shift isn't
--    an error, just not finished yet.
-- ---------------------------------------------------------------------

alter table jibble_time_entries add column review_category text
  check (review_category is null or review_category in (
    'unmapped_employee', 'invalid_times', 'missing_start', 'ambiguous_parse',
    'edited_after_approval', 'manual_attendance_conflict', 'already_approved',
    'ambiguous_entries_excluded'
  ));
comment on column jibble_time_entries.review_category is
  'A machine-readable classification of WHY needs_review is set, so the Attendance page can group review items into distinct buckets rather than parsing review_reason''s free text. Null whenever needs_review is false.';

create index idx_jibble_time_entries_incomplete on jibble_time_entries(company_id) where entry_end is null;

-- ---------------------------------------------------------------------
-- 2. New table: per-company Jibble sync checkpoint
-- ---------------------------------------------------------------------

create table jibble_sync_checkpoints (
  company_id         uuid primary key references companies(id),
  last_synced_until  timestamptz not null,
  last_run_at        timestamptz not null default now(),
  last_run_status    text not null default 'ok' check (last_run_status in ('ok', 'partial', 'failed')),
  last_run_note      text,
  updated_at         timestamptz not null default now()
);

alter table jibble_sync_checkpoints enable row level security;

-- ---- jibble_sync_checkpoints: HR Admin only -- an operational "last
--      synced at / run status" indicator, not evidence of any individual
--      employee's attendance. No write policy: only
--      record_jibble_sync_checkpoint() (service_role-only) ever writes it.
create policy jibble_sync_checkpoints_select on jibble_sync_checkpoints for select
  using (has_role('hr_admin', company_id));

-- ---------------------------------------------------------------------
-- 3. sync_jibble_attendance_for_day() -- exclude ambiguous entries from
--    hour totals; add review_category output. The OUT column list is
--    changing, so the old signature's function must be dropped first --
--    CREATE OR REPLACE cannot change a function's return type.
-- ---------------------------------------------------------------------

drop function if exists sync_jibble_attendance_for_day(uuid, text, date);

create or replace function sync_jibble_attendance_for_day(p_employee_id uuid, p_country_code text, p_work_date date)
returns table (attendance_record_id uuid, recovery_credit_request_id uuid, flagged_for_review boolean, review_category text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_next_local_midnight timestamptz;
  v_standard_hours numeric := 0;
  v_after_midnight_hours numeric := 0;
  v_entry record;
  v_full_hours numeric;
  v_break_hours numeric;
  v_record_id uuid;
  v_status text;
  v_is_recovery_day boolean;
  v_holiday_name text;
  v_event_type text;
  v_credit_hours numeric;
  v_credit_days numeric;
  v_existing_request recovery_credit_requests%rowtype;
  v_was_credited comp_day_ledger%rowtype;
  v_approved_request_exists boolean;
  v_request_id uuid;
  v_has_excluded_entry boolean := false;
begin
  v_tz := country_timezone(p_country_code);
  v_next_local_midnight := ((p_work_date + 1)::timestamp) at time zone v_tz;

  for v_entry in
    select entry_start, entry_end, break_minutes, needs_review from jibble_time_entries
    where employee_id = p_employee_id and work_date = p_work_date and entry_end is not null
  loop
    -- An entry the importer already flagged needs_review (ambiguous parse,
    -- missing start, or any other data quality issue — see
    -- import_jibble_time_entry()'s own doc comment) is NEVER folded into an
    -- hours total: "unknown or incomplete data must produce a visible
    -- review state, never a silently wrong hours calculation." Its
    -- contribution is dropped from this day's sum entirely (not defaulted
    -- to zero as if it were a real, confirmed zero) and the day itself
    -- comes back flagged so HR sees there's more evidence to look at
    -- before trusting whatever partial total the CLEAN entries produced.
    if v_entry.needs_review then
      v_has_excluded_entry := true;
      continue;
    end if;

    -- v_standard_hours is the FULL entry duration (minus breaks) — when
    -- p_work_date itself qualifies as a recovery day, the whole shift
    -- counts toward it even if it runs past local midnight (one
    -- continuous overnight shift that STARTED on a qualifying day is that
    -- day's credit in full, never split). v_after_midnight_hours is
    -- tracked separately for the OTHER case — a shift that started on an
    -- ordinary working day and merely extended past midnight, where only
    -- that extension is creditable.
    v_break_hours := coalesce(v_entry.break_minutes, 0) / 60.0;
    v_full_hours := greatest(0, extract(epoch from (v_entry.entry_end - v_entry.entry_start)) / 3600.0 - v_break_hours);
    v_standard_hours := v_standard_hours + v_full_hours;
    v_after_midnight_hours := v_after_midnight_hours + greatest(0, extract(epoch from (v_entry.entry_end - v_next_local_midnight)) / 3600.0);
  end loop;
  v_standard_hours := round(v_standard_hours::numeric, 2);
  v_after_midnight_hours := round(v_after_midnight_hours::numeric, 2);

  perform pg_advisory_xact_lock(hashtext('comp_day_ledger:' || p_employee_id::text));

  select r.is_recovery_day, r.holiday_name into v_is_recovery_day, v_holiday_name from is_recovery_eligible_day(p_country_code, p_work_date) r;
  v_status := case when v_standard_hours > 0 or v_after_midnight_hours > 0 then 'present' else 'not_recorded' end;

  insert into attendance_records (employee_id, work_date, status, hours_worked, active_hours_after_midnight, source)
  values (p_employee_id, p_work_date, v_status, v_standard_hours, nullif(v_after_midnight_hours, 0), 'jibble')
  on conflict (employee_id, work_date) do update
  set status = excluded.status, hours_worked = excluded.hours_worked, active_hours_after_midnight = excluded.active_hours_after_midnight
  where attendance_records.source = 'jibble'
  returning id into v_record_id;

  if v_record_id is null then
    -- A manually recorded row already exists for this date — the safe
    -- manual path always wins; every entry that shares this work_date is
    -- still linked for evidence by the caller, but nothing is derived.
    select id into v_record_id from attendance_records where employee_id = p_employee_id and work_date = p_work_date;
    attendance_record_id := v_record_id;
    recovery_credit_request_id := null;
    flagged_for_review := true;
    review_category := 'manual_attendance_conflict';
    return next;
    return;
  end if;

  select r.* into v_existing_request from recovery_credit_requests r
  where r.attendance_record_id = v_record_id and r.status not in ('cancelled', 'rejected');
  select cl.* into v_was_credited from comp_day_ledger cl
  where cl.reference_type = 'attendance_record' and cl.reference_id = v_record_id and cl.entry_type = 'earned'
    and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = cl.id);

  if v_existing_request.id is not null then
    select exists (select 1 from recovery_credit_requests where id = v_existing_request.id and status = 'approved') into v_approved_request_exists;
    if v_approved_request_exists then
      -- Never silently recompute an already-approved (ledger-posted)
      -- request — the caller flags the triggering entry needs_review.
      attendance_record_id := v_record_id;
      recovery_credit_request_id := v_existing_request.id;
      flagged_for_review := true;
      review_category := 'already_approved';
      return next;
      return;
    end if;
  end if;

  if v_is_recovery_day then
    v_event_type := 'standard';
    v_credit_hours := v_standard_hours;
  elsif v_after_midnight_hours > 0 then
    v_event_type := 'overnight';
    v_credit_hours := v_after_midnight_hours;
  else
    v_event_type := null;
    v_credit_hours := 0;
  end if;

  if v_event_type is not null and v_credit_hours > 0 and v_was_credited.id is null then
    v_credit_days := recovery_credit_days_for_hours(v_credit_hours);
    if v_existing_request.id is not null then
      -- Still pending — refresh it in place with the fuller evidence
      -- rather than creating a second row (the partial unique index on
      -- attendance_record_id would reject that anyway).
      update recovery_credit_requests
      set work_date = p_work_date, event_type = v_event_type, proposed_days = v_credit_days
      where id = v_existing_request.id;
      recovery_credit_request_id := v_existing_request.id;
    else
      insert into recovery_credit_requests (employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by)
      values (p_employee_id, v_record_id, p_work_date, v_event_type, v_credit_days, coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'))
      returning id into v_request_id;
      perform create_initial_approval('recovery_credit', v_request_id);
      recovery_credit_request_id := v_request_id;
    end if;
  else
    recovery_credit_request_id := v_existing_request.id;
  end if;

  attendance_record_id := v_record_id;
  -- v_has_excluded_entry means at least one of this day's raw entries was
  -- dropped from the totals above because it was already needs_review
  -- (ambiguous parse, missing start, etc.) — the credit computed here only
  -- reflects the CLEAN entries, so the day still comes back flagged even
  -- though a request may have just been created/refreshed from real data.
  --
  -- This is deliberately propagated to every OTHER clean entry sharing
  -- this employee/work_date too, not just whichever entry happened to
  -- trigger this particular sync run — import order must never decide
  -- whether HR sees that a day's evidence is incomplete. A row already
  -- needs_review for its own reason keeps whatever category it already
  -- had (coalesce), since that reason is more specific.
  if v_has_excluded_entry then
    -- jibble_time_entries.review_category qualified explicitly: this
    -- function's own OUT parameter is also named review_category, so a
    -- bare reference here would be ambiguous (same class of bug as
    -- import_jibble_time_entry()'s v_sync_review_reason fix below).
    update jibble_time_entries
    set needs_review = true, review_category = coalesce(jibble_time_entries.review_category, 'ambiguous_entries_excluded')
    where employee_id = p_employee_id and work_date = p_work_date and entry_end is not null and not needs_review;
  end if;
  flagged_for_review := v_has_excluded_entry;
  review_category := case when v_has_excluded_entry then 'ambiguous_entries_excluded' else null end;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. import_jibble_time_entry() -- new p_client_needs_review/
--    p_client_review_reason parameters, new review_category output,
--    explicit missing-start guard. Same reasoning as above: the OUT
--    column list changed, so the OLD (8-parameter) signature must be
--    dropped explicitly first, or Postgres would end up with two
--    overloaded versions of this function side by side (the old 8-arg one
--    left orphaned, still reachable by name, still doing the old thing).
-- ---------------------------------------------------------------------

drop function if exists import_jibble_time_entry(uuid, text, text, timestamptz, timestamptz, text, numeric, jsonb);

create or replace function import_jibble_time_entry(
  p_company_id uuid,
  p_jibble_entry_id text,
  p_jibble_person_id text,
  p_entry_start timestamptz,
  p_entry_end timestamptz,
  p_note text,
  p_break_minutes numeric,
  p_raw_payload jsonb,
  p_client_needs_review boolean default false,
  p_client_review_reason text default null
)
returns table (
  jibble_row_id uuid,
  attendance_record_id uuid,
  recovery_credit_request_id uuid,
  needs_review boolean,
  review_reason text,
  review_category text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content_hash text;
  v_existing jibble_time_entries%rowtype;
  v_row_id uuid;
  v_employee_id uuid;
  v_country_code text;
  v_work_date date;
  v_needs_review boolean := false;
  v_review_reason text := null;
  v_review_category text := null;
  v_approved_request_exists boolean;
  v_sync record;
  v_sync_review_reason text;
  v_sync_review_category text;
begin
  if p_jibble_entry_id is null or length(trim(p_jibble_entry_id)) = 0 then
    raise exception 'A Jibble entry id is required.';
  end if;
  v_content_hash := md5(coalesce(p_raw_payload, '{}'::jsonb)::text);

  select * into v_existing from jibble_time_entries
  where company_id = p_company_id and jibble_entry_id = p_jibble_entry_id
  for update;

  select id, country_code into v_employee_id, v_country_code
  from employees where company_id = p_company_id and jibble_person_id = p_jibble_person_id and deleted_at is null;

  if v_employee_id is null then
    v_needs_review := true;
    v_review_category := 'unmapped_employee';
    v_review_reason := 'No employee in this company is mapped to Jibble person ' || p_jibble_person_id || '.';
  end if;

  if v_existing.id is not null and v_existing.content_hash = v_content_hash and v_existing.employee_id is not distinct from v_employee_id then
    -- Byte-identical re-sync of an entry whose employee mapping also
    -- hasn't changed — nothing changed, nothing to redo. Deliberately NOT
    -- keyed on content_hash alone: an entry first synced before HR mapped
    -- its Jibble person to an employee must still be reprocessed once that
    -- mapping is added, even though the Jibble-side payload itself never
    -- changed.
    update jibble_time_entries set synced_at = now() where id = v_existing.id;
    select r.id into recovery_credit_request_id from recovery_credit_requests r where r.attendance_record_id = v_existing.attendance_record_id;
    jibble_row_id := v_existing.id;
    attendance_record_id := v_existing.attendance_record_id;
    needs_review := v_existing.needs_review;
    review_reason := v_existing.review_reason;
    review_category := v_existing.review_category;
    return next;
    return;
  end if;

  if v_existing.id is not null and v_existing.attendance_record_id is not null then
    select exists (
      select 1 from recovery_credit_requests r
      where r.attendance_record_id = v_existing.attendance_record_id and r.status = 'approved'
    ) into v_approved_request_exists;
    if v_approved_request_exists then
      update jibble_time_entries
      set entry_start = p_entry_start, entry_end = p_entry_end, note = p_note, break_minutes = coalesce(p_break_minutes, 0),
          raw_payload = p_raw_payload, content_hash = v_content_hash, needs_review = true,
          review_reason = 'This Jibble entry was edited after its recovery credit was already approved — review before trusting the posted balance.',
          review_category = 'edited_after_approval',
          synced_at = now()
      where id = v_existing.id
      returning id into v_row_id;

      select r.id into recovery_credit_request_id from recovery_credit_requests r where r.attendance_record_id = v_existing.attendance_record_id;
      jibble_row_id := v_row_id;
      attendance_record_id := v_existing.attendance_record_id;
      needs_review := true;
      review_reason := 'This Jibble entry was edited after its recovery credit was already approved — review before trusting the posted balance.';
      review_category := 'edited_after_approval';
      return next;
      return;
    end if;
  end if;

  if p_entry_start is null then
    -- No recognizable start time was parsed from Jibble's response — never
    -- guess an hours calculation from a missing clock-in. Stored for
    -- evidence (the raw payload is preserved regardless) but always
    -- excluded from sync_jibble_attendance_for_day()'s hour totals below,
    -- same as any other needs_review row.
    v_needs_review := true;
    v_review_category := coalesce(v_review_category, 'missing_start');
    v_review_reason := case when v_review_reason is null then 'This entry has no recognizable start time.'
      else v_review_reason || ' Also: no recognizable start time.' end;
  end if;

  if p_entry_end is not null and p_entry_start is not null and p_entry_end <= p_entry_start then
    v_needs_review := true;
    v_review_category := coalesce(v_review_category, 'invalid_times');
    v_review_reason := case when v_review_reason is null then 'This entry''s end time is not after its start time.'
      else v_review_reason || ' Also: this entry''s end time is not after its start time.' end;
  end if;

  if p_client_needs_review then
    -- The importer's own OWN parser (apps/web/src/lib/jibble/client.ts)
    -- already flagged this entry as ambiguous BEFORE it ever reached this
    -- RPC — e.g. a breaks field in a shape it doesn't recognize, or
    -- multiple candidate field names disagreeing on the same value. Fold
    -- that signal in here rather than trusting whatever numbers were
    -- passed, since "unknown or incomplete data must produce a visible
    -- review state, never a silently wrong hours calculation" applies
    -- just as much to a parse-time ambiguity as to a database-level one.
    v_needs_review := true;
    v_review_category := coalesce(v_review_category, 'ambiguous_parse');
    v_review_reason := case
      when v_review_reason is null then coalesce(p_client_review_reason, 'The importer could not confidently parse this entry.')
      when p_client_review_reason is null then v_review_reason
      else v_review_reason || ' Also: ' || p_client_review_reason
    end;
  end if;

  -- Deliberately NOT conditioned on "not v_needs_review" — an entry that's
  -- flagged for some OTHER reason (ambiguous breaks, invalid times) still
  -- has a perfectly good start/end and must still be visible to
  -- sync_jibble_attendance_for_day()'s day-grouping query below, so its
  -- own exclusion from that day's hour totals (and the day-wide
  -- flagged_for_review this produces) actually happens — a flagged entry
  -- with no work_date would be invisible to that query entirely, silently
  -- skipping the very re-derivation that's supposed to notice it. Only a
  -- genuinely missing/unparseable start (nothing to convert) or an
  -- unmapped employee (no country to convert it in) leaves work_date null.
  v_work_date := case when v_employee_id is not null and p_entry_start is not null and p_entry_end is not null
    then (p_entry_start at time zone country_timezone(v_country_code))::date
    else null
  end;

  insert into jibble_time_entries (company_id, jibble_entry_id, jibble_person_id, employee_id, entry_start, entry_end, note, break_minutes, work_date, raw_payload, content_hash, needs_review, review_reason, review_category, synced_at)
  values (p_company_id, p_jibble_entry_id, p_jibble_person_id, v_employee_id, p_entry_start, p_entry_end, p_note, coalesce(p_break_minutes, 0), v_work_date, p_raw_payload, v_content_hash, v_needs_review, v_review_reason, v_review_category, now())
  on conflict (company_id, jibble_entry_id) do update
  set jibble_person_id = excluded.jibble_person_id, employee_id = excluded.employee_id,
      entry_start = excluded.entry_start, entry_end = excluded.entry_end, note = excluded.note,
      break_minutes = excluded.break_minutes, work_date = excluded.work_date,
      raw_payload = excluded.raw_payload, content_hash = excluded.content_hash,
      needs_review = excluded.needs_review, review_reason = excluded.review_reason,
      review_category = excluded.review_category, synced_at = now()
  returning id into v_row_id;

  jibble_row_id := v_row_id;
  needs_review := v_needs_review;
  review_reason := v_review_reason;
  review_category := v_review_category;

  if v_work_date is null then
    -- Unmapped employee, still an open/active clock-in, or flagged
    -- needs_review above (missing start, invalid times, ambiguous parse)
    -- — nothing is derived from any of these until the issue is resolved.
    attendance_record_id := null;
    recovery_credit_request_id := null;
    return next;
    return;
  end if;

  select * into v_sync from sync_jibble_attendance_for_day(v_employee_id, v_country_code, v_work_date);

  update jibble_time_entries set attendance_record_id = v_sync.attendance_record_id where id = v_row_id;
  if v_sync.flagged_for_review then
    needs_review := true;
    -- v_sync_review_reason (a plain local, not the OUT parameter) avoids a
    -- "column reference is ambiguous" error: inside an UPDATE ... SET
    -- review_reason = ..., a bare identifier matching both a plpgsql
    -- variable AND the target table's own column name is ambiguous.
    v_sync_review_reason := coalesce(review_reason, 'A manually recorded attendance row already exists for this date, another entry on this day is itself ambiguous, or this day''s recovery credit was already approved — see the linked attendance record.');
    v_sync_review_category := coalesce(review_category, v_sync.review_category);
    review_reason := v_sync_review_reason;
    review_category := v_sync_review_category;
    update jibble_time_entries set needs_review = true, review_reason = v_sync_review_reason, review_category = v_sync_review_category where id = v_row_id;
  end if;

  attendance_record_id := v_sync.attendance_record_id;
  recovery_credit_request_id := v_sync.recovery_credit_request_id;
  return next;
end;
$$;

revoke all on function import_jibble_time_entry(uuid, text, text, timestamptz, timestamptz, text, numeric, jsonb, boolean, text) from public;
grant execute on function import_jibble_time_entry(uuid, text, text, timestamptz, timestamptz, text, numeric, jsonb, boolean, text) to service_role;


-- ---------------------------------------------------------------------
-- 5. record_jibble_sync_checkpoint() -- new function, service_role-only
--    (same restriction pattern as import_jibble_time_entry() above).
-- ---------------------------------------------------------------------

create or replace function record_jibble_sync_checkpoint(
  p_company_id uuid,
  p_synced_until timestamptz,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('ok', 'partial', 'failed') then
    raise exception 'Invalid sync status % (must be ok, partial, or failed)', p_status;
  end if;

  insert into jibble_sync_checkpoints (company_id, last_synced_until, last_run_status, last_run_note, last_run_at, updated_at)
  values (p_company_id, p_synced_until, p_status, p_note, now(), now())
  on conflict (company_id) do update
  set last_synced_until = excluded.last_synced_until,
      last_run_status = excluded.last_run_status,
      last_run_note = excluded.last_run_note,
      last_run_at = now(),
      updated_at = now();
end;
$$;

revoke all on function record_jibble_sync_checkpoint(uuid, timestamptz, text, text) from public;
grant execute on function record_jibble_sync_checkpoint(uuid, timestamptz, text, text) to service_role;

