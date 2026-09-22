-- Bootstrap data for a fresh project. `countries` is safe to load as-is —
-- it's non-sensitive reference data, not something that needs an audited
-- review (unlike `companies`, which is created through the Sys Admin UI
-- instead so it goes through the normal audit trail).
--
-- The policy content below is different: it lands as DRAFTS only, on
-- purpose. It is a starting point, not a legal opinion — every number
-- below (leave entitlement, notice period, probation length) is a
-- commonly cited statutory MINIMUM at the time this was written, not
-- verified against a current, authoritative source, and several genuinely
-- vary by contract or tenure in ways this seed simplifies. None of it
-- takes effect until a real HR Admin reviews it and a *different* HR
-- Admin or the CEO activates it (the same two-person control every policy
-- goes through — see docs/06-implementation-phases.md and
-- docs/07-risk-register.md risk 4). Do not treat this as a substitute for
-- local legal counsel before go-live in any of these three countries.

insert into countries (code, name, default_currency, week_start_day) values
  ('AE', 'United Arab Emirates', 'AED', 0),  -- work week starts Sunday
  ('SA', 'Saudi Arabia',        'SAR', 0),
  ('PL', 'Poland',              'PLN', 1)    -- work week starts Monday
on conflict (code) do nothing;

-- Placeholder "drafted by" — no real HR Admin exists yet in a fresh
-- project. Whoever reviews and activates these will be a real user;
-- created_by simply records that this draft's content came from the
-- initial seed, not a person, and is never treated as an approval.
do $$
declare
  v_seed_author uuid := '00000000-0000-0000-0000-000000000000';
begin

-- ---------------------------------------------------------------------------
-- United Arab Emirates
-- ---------------------------------------------------------------------------

insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
values (
  '00000000-0000-0000-0000-0000000a0001', 'AE', 'leave_rules', 1, '2026-01-01', 'draft',
  '{"source": "UAE Federal Decree-Law No. 33 of 2021, commonly cited minimums — verify before activating"}',
  v_seed_author
);
insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method, accrual_rate_per_period, max_balance_days, carryover_max_days, carryover_expiry_months, min_service_days_to_accrue, approval_levels_required)
values
  ('00000000-0000-0000-0000-0000000a0001', 'annual', 'Annual leave', 'monthly_accrual', 2.5, 60, 30, 12, 180, 1),
  ('00000000-0000-0000-0000-0000000a0001', 'sick', 'Sick leave', 'annual_grant', null, 90, 0, null, 0, 1);

insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
values (
  '00000000-0000-0000-0000-0000000a0002', 'AE', 'notice_period', 1, '2026-01-01', 'draft',
  '{"default_days": 30, "note": "actual notice period is set by the employment contract, 30-90 days is typical — this is a fallback default only"}',
  v_seed_author
);
insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
values (
  '00000000-0000-0000-0000-0000000a0003', 'AE', 'probation_rules', 1, '2026-01-01', 'draft',
  '{"max_probation_days": 180}',
  v_seed_author
);

insert into public_holidays (country_code, holiday_date, name) values
  ('AE', '2026-01-01', 'New Year''s Day'),
  ('AE', '2026-12-01', 'Commemoration Day'),
  ('AE', '2026-12-02', 'National Day'),
  ('AE', '2026-12-03', 'National Day (observed)')
on conflict (country_code, holiday_date) do nothing;
-- Islamic-calendar holidays (Eid al-Fitr, Eid al-Adha, Islamic New Year,
-- Prophet's Birthday, Arafat Day) are lunar and confirmed by moon-sighting
-- close to the date each year — deliberately not seeded here with a
-- fabricated date. HR adds these once the UAE government announces them.

-- ---------------------------------------------------------------------------
-- Saudi Arabia
-- ---------------------------------------------------------------------------

insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
values (
  '00000000-0000-0000-0000-0000000a0004', 'SA', 'leave_rules', 1, '2026-01-01', 'draft',
  '{"source": "Saudi Labor Law, commonly cited minimums — verify before activating"}',
  v_seed_author
);
insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method, accrual_rate_per_period, max_balance_days, carryover_max_days, carryover_expiry_months, min_service_days_to_accrue, approval_levels_required)
values
  ('00000000-0000-0000-0000-0000000a0004', 'annual', 'Annual leave', 'monthly_accrual', 1.75, 42, 21, 12, 0, 1),
  ('00000000-0000-0000-0000-0000000a0004', 'sick', 'Sick leave', 'annual_grant', null, 120, 0, null, 0, 1);

insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
values (
  '00000000-0000-0000-0000-0000000a0005', 'SA', 'notice_period', 1, '2026-01-01', 'draft',
  '{"default_days": 60, "note": "60 days is typical for unlimited contracts, 30 for limited-term — this is a fallback default only"}',
  v_seed_author
);
insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
values (
  '00000000-0000-0000-0000-0000000a0006', 'SA', 'probation_rules', 1, '2026-01-01', 'draft',
  '{"max_probation_days": 90, "note": "extendable to 180 days by written agreement"}',
  v_seed_author
);

insert into public_holidays (country_code, holiday_date, name) values
  ('SA', '2026-02-22', 'Founding Day'),
  ('SA', '2026-09-23', 'Saudi National Day')
on conflict (country_code, holiday_date) do nothing;
-- Eid al-Fitr and Eid al-Adha are lunar and announced by royal decree close
-- to the date each year — not seeded here for the same reason as the UAE.

-- ---------------------------------------------------------------------------
-- Poland
-- ---------------------------------------------------------------------------

insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
values (
  '00000000-0000-0000-0000-0000000a0007', 'PL', 'leave_rules', 1, '2026-01-01', 'draft',
  '{"source": "Polish Labour Code (Kodeks pracy), commonly cited minimums — verify before activating"}',
  v_seed_author
);
insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method, accrual_rate_per_period, max_balance_days, carryover_max_days, carryover_expiry_months, min_service_days_to_accrue, approval_levels_required)
values
  -- 20 days/year under 10 years' aggregate work experience, 26 days at/after
  -- 10 years — this seed uses the entry-level 20-day figure; HR raises an
  -- individual employee's entitlement once tenure crosses that threshold.
  ('00000000-0000-0000-0000-0000000a0007', 'annual', 'Annual leave (urlop wypoczynkowy)', 'annual_grant', null, 26, 20, 9, 0, 1),
  ('00000000-0000-0000-0000-0000000a0007', 'sick', 'Sick leave (zasiłek chorobowy)', 'annual_grant', null, 33, 0, null, 0, 1);

insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
values (
  '00000000-0000-0000-0000-0000000a0008', 'PL', 'notice_period', 1, '2026-01-01', 'draft',
  '{"tiers": [
      {"min_service_months": 0, "notice": "2 weeks"},
      {"min_service_months": 6, "notice": "1 month"},
      {"min_service_months": 36, "notice": "3 months"}
    ], "note": "tiered by length of service under the Polish Labour Code"}',
  v_seed_author
);
insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
values (
  '00000000-0000-0000-0000-0000000a0009', 'PL', 'probation_rules', 1, '2026-01-01', 'draft',
  '{"max_probation_days": 90}',
  v_seed_author
);

insert into public_holidays (country_code, holiday_date, name) values
  ('PL', '2026-01-01', 'New Year''s Day'),
  ('PL', '2026-01-06', 'Epiphany'),
  ('PL', '2026-05-01', 'Labour Day'),
  ('PL', '2026-05-03', 'Constitution Day'),
  ('PL', '2026-08-15', 'Assumption of Mary'),
  ('PL', '2026-11-01', 'All Saints'' Day'),
  ('PL', '2026-11-11', 'Independence Day'),
  ('PL', '2026-12-25', 'Christmas Day'),
  ('PL', '2026-12-26', 'Second Day of Christmas')
on conflict (country_code, holiday_date) do nothing;
-- Easter Monday and Corpus Christi move with Easter (a computed but
-- non-trivial date) — not seeded here; add each year's actual date once
-- confirmed rather than risk a wrong fabricated one.

end $$;
