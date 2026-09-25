-- Phase 2B final policy-data synchronisation. Creates NEXT-VERSION (v2)
-- DRAFT policy_versions rows for UAE/Saudi/Poland's leave_rules,
-- overtime_rules (Recovery Leave), notice_period and probation_rules,
-- reflecting the ALREADY-IMPLEMENTED, ALREADY-TESTED Phase 2B domain rules
-- (packages/domain/src/annualLeaveEntitlement.ts and this repo's own
-- 20261101000000_leave_policy_configuration.sql / 20261102000000_poland_
-- termination_leave_true_up.sql) — this is data synchronisation, not a new
-- business decision. The nine existing v1 draft records (supabase/seed.sql,
-- created_by = the all-zero placeholder actor) are historical bootstrap
-- data: untouched, unedited, unactivated by anything in this migration.
-- Every new row here is inserted as 'draft' only — nothing here activates
-- anything; a human (HR Admin, then someone other than the drafter) must
-- explicitly review and activate through the existing Policy Authoring
-- UI/activatePolicy() RPC, unchanged.
--
-- seed_phase2b_policy_drafts(p_created_by uuid) already existed (added in
-- 20261101000000_leave_policy_configuration.sql) for leave_rules and
-- overtime_rules, already safely repeatable via a payload marker per
-- (country, policy_type) — that pattern is preserved exactly. This
-- migration replaces that function to:
--   1. Correct a stale wording bug in Poland's leave_rules summary text: it
--      still described the SUPERSEDED statutory 10-year/20-or-26-day
--      threshold and Kodeks pracy Art. 153 first-ever-employment
--      progressive-monthly-accrual mechanism — both retired by Round F
--      (see annualLeaveEntitlement.ts's own header comment). Poland's
--      Annual Leave is a flat 26-working-day/year Enginious company
--      benefit for every employee, regardless of tenure or first-ever-
--      employment status, full stop; the leave_type row itself was already
--      correct (accrual_method = 'annual_grant', no fixed monthly rate) —
--      only the human-readable summary text was stale.
--   2. Extends it to also draft notice_period and probation_rules v2
--      versions for AE/SA/PL. No new legal decision was given for these in
--      this round (the brief's "Final approved rules" section is silent on
--      notice/probation), and no runtime code reads/enforces
--      policy_versions.payload for either policy_type at all (grep-
--      confirmed: notice_period_days lives on employment_contracts, set
--      per-contract by HR, entirely independent of this reference-only
--      policy record) — so this migration carries the EXISTING v1 seed
--      figures (supabase/seed.sql) forward UNCHANGED, verbatim, rather than
--      guessing a correction nothing asked for. See this migration's own
--      accompanying report for the specific unresolved-legal-decision note
--      this implies.
--   3. Adds an explicit conflict guard: if a version already occupies the
--      exact slot (country, policy_type, version_no) this function is
--      about to claim, and it does NOT carry this function's own marker,
--      the whole call fails loudly instead of silently stacking a v3 (or
--      any other version) on top of an unrelated pre-existing draft.
--   4. SECURITY CORRECTION (this round): the original signature took
--      p_created_by as a caller-supplied uuid, checked only that it was
--      non-null and existed in auth.users — nothing stopped an authenticated
--      caller from attributing every draft to a DIFFERENT real user, and
--      nothing checked the caller held any role at all. This version takes
--      NO parameter: the actor is auth.uid() alone, and the caller must
--      independently hold hr_admin (company-unscoped) for the specific
--      country being drafted — the same authorization
--      policy_versions_insert's RLS would require, restated explicitly here
--      because this function is SECURITY DEFINER and therefore bypasses
--      that RLS policy entirely; only this function's own check protects it.
--
-- Not applied by this migration itself, and NOT callable from the Supabase
-- SQL Editor: that editor runs queries with no JWT/session context, so
-- auth.uid() is null there and this function will correctly refuse to run.
-- Call it as an authenticated HR Admin from inside the app instead — e.g.
-- from the browser console while signed in, or from a small Server Action
-- (both use the same signed-in Supabase client, so auth.uid() resolves to
-- the real logged-in user):
--   await supabase.rpc('seed_phase2b_policy_drafts');
-- after first reviewing preflight_phase2b_v2_policy_status()'s output
-- (callable the same way, or from SQL Editor — it's read-only and takes no
-- actor).
create or replace function seed_phase2b_policy_drafts()
returns table(country_code text, policy_type text, version_no int, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_by uuid;
  v_country text;
  v_leave_version_no int;
  v_overtime_version_no int;
  v_notice_version_no int;
  v_probation_version_no int;
  v_leave_version_id uuid;
  v_already_seeded boolean;
  v_conflict_version_no int;
  v_deduction_mode text;
  v_extend_for_holidays boolean;
  v_annual_name text;
  v_annual_accrual_method text;
  v_annual_max_balance numeric;
  v_annual_carryover_max numeric;
  v_annual_carryover_expiry_months int;
  v_notice_payload jsonb;
  v_probation_payload jsonb;
begin
  v_created_by := auth.uid();
  if v_created_by is null then
    raise exception 'seed_phase2b_policy_drafts must be called by an authenticated user — auth.uid() is null. This cannot be run from the Supabase SQL Editor (no JWT context there); call it from the app as a signed-in HR Admin instead (e.g. supabase.rpc(''seed_phase2b_policy_drafts'')).';
  end if;

  foreach v_country in array array['AE', 'SA', 'PL']
  loop
    -- Re-derives (does not merely trust RLS) the exact authorization
    -- policy_versions_insert requires: company-UNSCOPED hr_admin for this
    -- specific country. A single-company HR Admin, or an HR Admin scoped
    -- to a different country, cannot draft policy for a country they don't
    -- hold this unscoped grant for — checked once per country, before any
    -- insert for it, so a caller authorized for only some of AE/SA/PL fails
    -- loudly on the first one they aren't, rather than partially drafting.
    if not has_role('hr_admin', null, v_country) then
      raise exception 'Only a company-unscoped HR Admin for % may draft Phase 2B v2 policy versions for that country (auth.uid() = %).', v_country, v_created_by;
    end if;

    -- ---- leave_rules: this brief's specific Annual Leave rules ----
    select exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'leave_rules'
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ) into v_already_seeded;

    if v_already_seeded then
      country_code := v_country; policy_type := 'leave_rules'; version_no := null; action := 'skipped_already_seeded';
      return next;
    else
      -- Conflict guard: v1 (the real, existing seed) is expected and fine —
      -- but ANY version beyond v1 that does not carry this function's own
      -- marker means someone already advanced this policy type by hand.
      -- Checked BEFORE computing next_free_version_no, which is itself
      -- always past-the-end by construction (coalesce(max,0)+1) and so
      -- could never otherwise detect an already-occupied slot.
      if exists (
        select 1 from policy_versions pv
        where pv.country_code = v_country and pv.policy_type = 'leave_rules' and pv.version_no > 1
          and coalesce(pv.payload ->> 'phase2b_seed_marker', '') <> 'leave_policy_configuration'
      ) then
        raise exception 'Conflict: a leave_rules version beyond v1 already exists for % that was not created by this function — refusing to stack another draft on top of it. Resolve manually.', v_country;
      end if;

      select coalesce(max(pv.version_no), 0) + 1 into v_leave_version_no
      from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'leave_rules';

      v_deduction_mode := case v_country when 'PL' then 'workingDays' else 'calendarDays' end;
      v_extend_for_holidays := (v_country = 'SA');
      v_annual_name := case v_country when 'PL' then 'Annual leave (urlop wypoczynkowy)' else 'Annual leave' end;
      v_annual_accrual_method := case v_country when 'PL' then 'annual_grant' else 'per_service_year' end;
      v_annual_max_balance := case v_country when 'PL' then 26 else 90 end;
      v_annual_carryover_max := case v_country when 'PL' then 20 else 30 end;
      v_annual_carryover_expiry_months := case v_country when 'PL' then 9 else 12 end;

      insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
      values (
        v_country, 'leave_rules', v_leave_version_no, '2026-01-01',
        jsonb_build_object(
          'phase2b_seed_marker', 'leave_policy_configuration',
          'summary', case v_country
            when 'AE' then 'UAE Annual Leave: 30 calendar days per completed year; 2 calendar days per completed month after 6 months but before 1 year. Calendar-day deduction; public holidays falling inside an approved leave period remain part of it (consumed, not extended). Standard working week: Monday-Friday. Sequential approval: Line Manager then HR Admin. No deduction until the full chain approves.'
            when 'SA' then 'Saudi Annual Leave: 21 calendar days/year under five years of service, 30 calendar days/year once five years is completed. Calendar-day deduction; an official public holiday inside the leave period extends it rather than consuming a leave day. Standard working week: Sunday-Thursday. Sequential approval: Line Manager then HR Admin. Unused legally accrued leave is paid on termination using the statutory Saudi wage basis, not forced onto a basic-salary-only calculation.'
            when 'PL' then 'Poland Annual Leave: a flat Enginious company benefit of 26 working days per complete calendar year for EVERY employee, regardless of tenure, recognised prior service, or first-ever-employment status — this is a company benefit decision, not a computation of the statutory 10-year/20-or-26-day threshold or the Art. 153 first-ever-employment progressive-monthly-accrual mechanism, neither of which is implemented or relied upon. A new starter or leaver''s partial year is prorated by whole calendar months (a partial month counts in full), rounded up; part-time entitlement is prorated by contract FTE fraction, also rounded up. Deducted against scheduled working time (1 day = 8 hours); public holidays and weekends do not consume Annual Leave. Standard working week: Monday-Friday. Sequential approval: Line Manager then HR Admin. Unused leave payable on termination uses Poland''s statutory pecuniary-equivalent calculation, true-up performed at termination (see the termination true-up / manual-reconciliation workflow), not a UAE-style basic-salary rule.'
          end,
          'settlement', 'Enginious settles unused Annual Leave upon resignation, termination or contract expiry using the employee''s basic salary where legally permitted. Where mandatory local law requires another wage basis or statutory calculation, the legally required method applies.',
          'deduction_mode', v_deduction_mode,
          'extend_for_holidays', v_extend_for_holidays
        ),
        v_created_by
      )
      returning id into v_leave_version_id;

      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method, max_balance_days, carryover_max_days, carryover_expiry_months, min_service_days_to_accrue)
      values
        (v_leave_version_id, 'annual', v_annual_name, v_annual_accrual_method, v_annual_max_balance, v_annual_carryover_max, v_annual_carryover_expiry_months, 0),
        (v_leave_version_id, 'recovery', 'Recovery Leave', 'annual_grant', null, 0, null, 0);

      country_code := v_country; policy_type := 'leave_rules'; version_no := v_leave_version_no; action := 'created';
      return next;
    end if;

    -- ---- overtime_rules: Recovery Leave policy text/thresholds (unchanged
    -- from the original 20261101 version — already correct: separate,
    -- non-cash, 180-day expiry, forfeited on termination, never statutory
    -- Annual Leave, never paid automatically in final settlement) ----
    select exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'overtime_rules'
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ) into v_already_seeded;

    if v_already_seeded then
      country_code := v_country; policy_type := 'overtime_rules'; version_no := null; action := 'skipped_already_seeded';
      return next;
    else
      -- No v1 baseline exists for overtime_rules at all — so ANY
      -- pre-existing row without our marker is unexpected.
      if exists (
        select 1 from policy_versions pv
        where pv.country_code = v_country and pv.policy_type = 'overtime_rules'
          and coalesce(pv.payload ->> 'phase2b_seed_marker', '') <> 'leave_policy_configuration'
      ) then
        raise exception 'Conflict: an overtime_rules version already exists for % that was not created by this function — refusing to stack another draft on top of it. Resolve manually.', v_country;
      end if;

      select coalesce(max(pv.version_no), 0) + 1 into v_overtime_version_no
      from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'overtime_rules';

      insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
      values (
        v_country, 'overtime_rules', v_overtime_version_no, '2026-01-01',
        jsonb_build_object(
          'phase2b_seed_marker', 'leave_policy_configuration',
          'policy_name', 'Enginious Recovery Leave',
          'wording', 'Recovery Leave is a time-off benefit intended to provide rest during active employment. It is not salary, Annual Leave or a cash entitlement. Unused internal Recovery Leave expires 180 days after earning and is forfeited without cash conversion when employment ends, subject to mandatory local employment law.',
          'statutory_safeguard', 'Enginious does not operate a general discretionary overtime-payment scheme. Working beyond normal hours does not automatically create Recovery Leave or an additional contractual payment. Where applicable employment law mandates overtime pay, holiday compensation, substitute rest or another minimum entitlement, Enginious will comply with that statutory requirement.',
          'standard_threshold_hours', 4,
          'standard_credit_below_threshold_days', 0.5,
          'standard_credit_above_threshold_days', 1,
          'overnight_threshold_hours', 4,
          'expiry_days', 180,
          'consumption_order', 'oldest_first',
          'approval_chain', jsonb_build_array('direct_manager', 'role:hr_admin')
        ),
        v_created_by
      );

      country_code := v_country; policy_type := 'overtime_rules'; version_no := v_overtime_version_no; action := 'created';
      return next;
    end if;

    -- ---- notice_period: carried forward from v1 UNCHANGED — no new
    -- decision was given in this round; these already correctly encode
    -- contract-type/tenure dependency as descriptive text rather than a
    -- single guessed number, and no runtime code reads this record at all
    -- (employment_contracts.notice_period_days is the real, per-contract,
    -- HR-entered figure this system actually uses). See this migration's
    -- own report for the explicit "unresolved decision" flag this implies. ----
    select exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'notice_period'
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ) into v_already_seeded;

    if v_already_seeded then
      country_code := v_country; policy_type := 'notice_period'; version_no := null; action := 'skipped_already_seeded';
      return next;
    else
      if exists (
        select 1 from policy_versions pv
        where pv.country_code = v_country and pv.policy_type = 'notice_period' and pv.version_no > 1
          and coalesce(pv.payload ->> 'phase2b_seed_marker', '') <> 'leave_policy_configuration'
      ) then
        raise exception 'Conflict: a notice_period version beyond v1 already exists for % that was not created by this function — refusing to stack another draft on top of it. Resolve manually.', v_country;
      end if;

      select coalesce(max(pv.version_no), 0) + 1 into v_notice_version_no
      from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'notice_period';

      v_notice_payload := case v_country
        when 'AE' then jsonb_build_object('default_days', 30, 'note', 'actual notice period is set by the employment contract, 30-90 days is typical — this is a fallback default only. Carried forward from v1 unchanged; not independently re-verified against a current official source in this round.')
        when 'SA' then jsonb_build_object('default_days', 60, 'note', '60 days is typical for unlimited contracts, 30 for limited-term — this is a fallback default only. Carried forward from v1 unchanged; not independently re-verified against a current official source in this round.')
        else jsonb_build_object(
          'tiers', jsonb_build_array(
            jsonb_build_object('min_service_months', 0, 'notice', '2 weeks'),
            jsonb_build_object('min_service_months', 6, 'notice', '1 month'),
            jsonb_build_object('min_service_months', 36, 'notice', '3 months')
          ),
          'note', 'tiered by length of service under the Polish Labour Code. Carried forward from v1 unchanged; not independently re-verified against a current official source in this round.'
        )
      end;

      insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
      values (v_country, 'notice_period', v_notice_version_no, '2026-01-01', v_notice_payload || jsonb_build_object('phase2b_seed_marker', 'leave_policy_configuration'), v_created_by);

      country_code := v_country; policy_type := 'notice_period'; version_no := v_notice_version_no; action := 'created';
      return next;
    end if;

    -- ---- probation_rules: carried forward from v1 UNCHANGED — same
    -- rationale as notice_period above. ----
    select exists (
      select 1 from policy_versions pv
      where pv.country_code = v_country and pv.policy_type = 'probation_rules'
        and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
    ) into v_already_seeded;

    if v_already_seeded then
      country_code := v_country; policy_type := 'probation_rules'; version_no := null; action := 'skipped_already_seeded';
      return next;
    else
      if exists (
        select 1 from policy_versions pv
        where pv.country_code = v_country and pv.policy_type = 'probation_rules' and pv.version_no > 1
          and coalesce(pv.payload ->> 'phase2b_seed_marker', '') <> 'leave_policy_configuration'
      ) then
        raise exception 'Conflict: a probation_rules version beyond v1 already exists for % that was not created by this function — refusing to stack another draft on top of it. Resolve manually.', v_country;
      end if;

      select coalesce(max(pv.version_no), 0) + 1 into v_probation_version_no
      from policy_versions pv where pv.country_code = v_country and pv.policy_type = 'probation_rules';

      v_probation_payload := case v_country
        when 'AE' then jsonb_build_object('max_probation_days', 180, 'note', 'Carried forward from v1 unchanged; not independently re-verified against a current official source in this round.')
        when 'SA' then jsonb_build_object('max_probation_days', 90, 'note', 'extendable to 180 days by written agreement. Carried forward from v1 unchanged; not independently re-verified against a current official source in this round.')
        else jsonb_build_object('max_probation_days', 90, 'note', 'Carried forward from v1 unchanged; not independently re-verified against a current official source in this round.')
      end;

      insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
      values (v_country, 'probation_rules', v_probation_version_no, '2026-01-01', v_probation_payload || jsonb_build_object('phase2b_seed_marker', 'leave_policy_configuration'), v_created_by);

      country_code := v_country; policy_type := 'probation_rules'; version_no := v_probation_version_no; action := 'created';
      return next;
    end if;
  end loop;
end;
$$;

-- Read-only preflight/check: ALWAYS one row per intended (country,
-- policy_type) combination — 3 countries x 4 policy types = 12 rows, every
-- time, whether or not seed_phase2b_policy_drafts() has run yet. Before
-- seeding, every row reads status = 'not_created' with a null version_no —
-- an explicit, visible "this is missing" rather than an empty result set
-- that could be mistaken for a broken query. After a successful seed, all
-- 12 rows show their real (draft) version/critical_values. This is a LEFT
-- JOIN against the marker-tagged rows specifically, so it never shows the
-- unrelated v1 seed rows (which carry no marker) as if they were this
-- function's own output.
--
-- "runtime_can_resolve_unambiguously" checks whether activating THIS draft
-- (at its own effective_from, open-ended) would collide with any
-- currently-'active' version's date range for the same (country_code,
-- policy_type) — the same overlap the database's own exclusion constraint
-- on policy_versions enforces at activation time; this just lets HR see
-- the answer beforehand rather than discovering it as a failed activation.
-- Always false (not yet meaningful) for a not-yet-created row.
create or replace function preflight_phase2b_v2_policy_status()
returns table(
  country_code text,
  policy_type text,
  version_no int,
  status text,
  effective_from date,
  critical_values jsonb,
  runtime_can_resolve_unambiguously boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cc.code,
    pt.policy_type,
    pv.version_no,
    coalesce(pv.status::text, 'not_created'),
    pv.effective_from,
    case
      when pv.id is null then null
      when pt.policy_type = 'leave_rules' then (
        select jsonb_object_agg(plt.leave_type_code, jsonb_build_object(
          'accrual_method', plt.accrual_method,
          'accrual_rate_per_period', plt.accrual_rate_per_period,
          'max_balance_days', plt.max_balance_days,
          'carryover_max_days', plt.carryover_max_days,
          'min_service_days_to_accrue', plt.min_service_days_to_accrue
        ))
        from policy_leave_types plt where plt.policy_version_id = pv.id
      )
      else pv.payload - 'phase2b_seed_marker'
    end,
    pv.id is not null and not exists (
      select 1 from policy_versions other
      where other.country_code = pv.country_code
        and other.policy_type = pv.policy_type
        and other.status = 'active'
        and other.id <> pv.id
        and other.effective_from <= coalesce(pv.effective_to, 'infinity'::date)
        and coalesce(other.effective_to, 'infinity'::date) >= pv.effective_from
    )
  from (values ('AE'), ('SA'), ('PL')) as cc(code)
  cross join (values ('leave_rules'), ('overtime_rules'), ('notice_period'), ('probation_rules')) as pt(policy_type)
  left join policy_versions pv
    on pv.country_code = cc.code
    and pv.policy_type::text = pt.policy_type
    and pv.payload ->> 'phase2b_seed_marker' = 'leave_policy_configuration'
  order by cc.code, pt.policy_type;
$$;
